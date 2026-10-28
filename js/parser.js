// RTDB `screentime` ノードJSON → 表示用データ（Android版 ScreenTimeParser.kt の防御的パースの移植）。
// どのフィールドが欠けていても、数値がint/float/数値文字列のどれでも、ルートが null でも例外を出さない。
//
// データ形状（すべてプレーンオブジェクト。days だけ Map<'yyyy-MM-dd', DayUsage>）:
//   ScreenTimeData { users: UserData[] }            // 表示順（profile.order → uid）にソート済み
//   UserData { uid, profile, settings|null, days, now|null, agent|null, displayName }
//   profile { name, order, limitYoutubeMin, limitRobloxMin }       // 各 null 可
//   settings { limitYoutubeMin, limitRobloxMin, updatedAt }        // 各 null 可
//   DayUsage { youtubeSec, robloxSec, updatedAt, hoursYoutube|null, hoursRoblox|null }
//   now { app: 'youtube'|'roblox'|'none', at }    agent { version, host, lastRunAt }

import { sortUsers } from './logic.js';

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** JSONプリミティブ(number/数値文字列)を有限の数値に。それ以外・NaN/Infinity は null。 */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!NUM_RE.test(s)) return null;
    const d = Number(s);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}

/** 文字列。数値・真偽値はそのまま文字列化、null/オブジェクト/配列は null。 */
function str(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 四捨五入（Kotlin の roundToInt/roundToLong と同じく半分は正の無限大方向）。-0 は 0 に。 */
function round(d) {
  const r = Math.round(d);
  return r === 0 ? 0 : r;
}

function roundOrNull(v) {
  const d = num(v);
  return d === null ? null : round(d);
}

export function hasHourly(day) {
  return day.hoursYoutube !== null || day.hoursRoblox !== null;
}

/** 文字列 → ScreenTimeData。解釈できないJSONは空データ。 */
export function parse(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { users: [] };
  let root;
  try {
    root = JSON.parse(raw);
  } catch {
    return { users: [] };
  }
  return parseRoot(root);
}

export function parseRoot(root) {
  if (!isObj(root)) return { users: [] };
  const usersEl = root.users;
  const users = [];
  if (isObj(usersEl)) {
    for (const [uid, el] of Object.entries(usersEl)) {
      const u = parseUser(uid, el);
      if (u) users.push(u);
    }
  } else if (Array.isArray(usersEl)) {
    // RTDBは整数キーのみのオブジェクトを配列で返すことがある
    usersEl.forEach((el, i) => {
      const u = parseUser(String(i), el);
      if (u) users.push(u);
    });
  }
  return { users: sortUsers(users) };
}

function parseUser(uid, el) {
  if (!isObj(el)) return null;
  const profile = parseProfile(el.profile);
  const name = profile.name;
  return {
    uid,
    profile,
    settings: parseSettings(el.settings),
    days: parseDays(el.days),
    now: parseNow(el.now),
    agent: parseAgent(el.agent),
    /** 表示名。profile.nameが無ければuid。 */
    displayName: name !== null && name.trim() !== '' ? name : uid,
  };
}

function parseProfile(el) {
  const o = isObj(el) ? el : {};
  return {
    name: str(o.name),
    order: roundOrNull(o.order),
    limitYoutubeMin: roundOrNull(o.limitYoutubeMin),
    limitRobloxMin: roundOrNull(o.limitRobloxMin),
  };
}

/** `settings` が無い/オブジェクト以外なら null。 */
function parseSettings(el) {
  if (!isObj(el)) return null;
  return {
    limitYoutubeMin: roundOrNull(el.limitYoutubeMin),
    limitRobloxMin: roundOrNull(el.limitRobloxMin),
    updatedAt: roundOrNull(el.updatedAt),
  };
}

function sec(v) {
  return round(Math.max(num(v) ?? 0, 0));
}

function parseDays(el) {
  const out = new Map();
  if (!isObj(el)) return out;
  for (const [key, d] of Object.entries(el)) {
    if (!isObj(d)) continue;
    out.set(key, {
      youtubeSec: sec(d.youtube),
      robloxSec: sec(d.roblox),
      updatedAt: roundOrNull(d.updatedAt),
      hoursYoutube: parseHours(d.hoursYoutube),
      hoursRoblox: parseHours(d.hoursRoblox),
    });
  }
  return out;
}

/**
 * 時間別秒数 → 常に24要素の配列。RTDBは配列でもオブジェクト("0".."23"キー、欠損=0)でも返す。
 * 配列/オブジェクト以外・空は null（=時間別データなし）。長さ不足は0埋め、24超と範囲外キーは無視。
 * 要素は float 可（四捨五入）、null/非数/負は0。
 */
function parseHours(el) {
  const out = new Array(24).fill(0);
  if (Array.isArray(el)) {
    if (el.length === 0) return null;
    el.forEach((e, i) => { if (i < 24) out[i] = sec(e); });
  } else if (isObj(el)) {
    const keys = Object.keys(el);
    if (keys.length === 0) return null;
    for (const k of keys) {
      const t = k.trim();
      if (!/^[+-]?\d+$/.test(t)) continue;
      const i = parseInt(t, 10);
      if (i >= 0 && i <= 23) out[i] = sec(el[k]);
    }
  } else {
    return null;
  }
  return out;
}

function parseNow(el) {
  if (!isObj(el)) return null;
  const a = str(el.app)?.trim().toLowerCase();
  const app = a === 'youtube' ? 'youtube' : a === 'roblox' ? 'roblox' : 'none';
  return { app, at: roundOrNull(el.at) };
}

function parseAgent(el) {
  if (!isObj(el)) return null;
  return {
    version: str(el.version),
    host: str(el.host),
    lastRunAt: roundOrNull(el.lastRunAt),
  };
}

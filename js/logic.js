// 画面表示用の純粋ロジック（Android版 ScreenTimeLogic / TotalUsageLogic / SelectionState / LimitSettingsLogic の移植）。
// 電力の表示ロジック・電力設定ステッパーは js/power.js。
// DOMには触れず、Nodeでユニットテストできる。
//
// 日付は "yyyy-MM-dd" 文字列（ローカル日付）で扱う。
// アプリ種別: 'youtube' | 'roblox'、使用量レベル: 'none' | 'ok' | 'warn' | 'over'。

/** `now` バッジを出す鮮度（秒） */
export const NOW_FRESH_SEC = 180;

/** エージェント停止とみなす秒数（これより古いと停止中） */
export const AGENT_STALE_SEC = 10 * 60;

/** 警告開始の割合 */
export const WARN_RATIO = 0.8;

/** 時間別グラフのY軸上限（秒）。1時間=60分で固定。 */
export const HOUR_MAX_SEC = 3600;

/** 週グラフのY軸の最小スケール(秒)。最低1時間を満タンとする。 */
export const WEEK_MIN_Y_SEC = 3600;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']; // Date#getUTCDay の並び

// ---------------- 日付ユーティリティ（"yyyy-MM-dd"） ----------------

const pad2 = (n) => String(n).padStart(2, '0');

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`bad date: ${iso}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** (年, 月, 日) → "yyyy-MM-dd" */
export function isoDate(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

/** epochミリ秒 → 端末ローカルの "yyyy-MM-dd" */
export function localIsoDate(ms) {
  const dt = new Date(ms);
  return isoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** 日付に n 日足す（負数可）。 */
export function addDays(iso, n) {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 曜日1文字（月火水木金土日） */
export function weekdayChar(iso) {
  const { y, m, d } = parseIso(iso);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// ---------------- 時間の整形 ----------------

/** 秒 → "0分" / "45分" / "1時間" / "1時間23分"（分未満は切り捨て、負値は0扱い）。 */
export function formatDuration(sec) {
  const totalMin = Math.floor((sec < 0 ? 0 : sec) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** "10月27日(火)" */
export function formatDateHeader(iso) {
  const { m, d } = parseIso(iso);
  return `${m}月${d}日(${weekdayChar(iso)})`;
}

/** "10/28(水)" */
export function formatDayLabel(iso) {
  const { m, d } = parseIso(iso);
  return `${m}/${d}(${weekdayChar(iso)})`;
}

/** 時間別カードの見出し: 今日なら "今日 10/28(水)"、それ以外は "10/27(火)"。 */
export function hourlyTitle(date, today) {
  return date === today ? `今日 ${formatDayLabel(date)}` : formatDayLabel(date);
}

/** "HH:mm"（0埋め）。ローカル時刻。 */
export function formatClock(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

// ---------------- 上限に対する判定 ----------------

/** 上限(分)が有効（>0）か。null/0/負は「上限なし」。 */
export function hasLimit(limitMin) {
  return limitMin !== null && limitMin !== undefined && limitMin > 0;
}

/** 上限なし='none' / <80%='ok' / 80%〜100%='warn' / >100%='over' */
export function usageLevel(usedSec, limitMin) {
  if (!hasLimit(limitMin)) return 'none';
  const limitSec = limitMin * 60;
  const used = usedSec < 0 ? 0 : usedSec;
  if (used > limitSec) return 'over';
  if (used >= limitSec * WARN_RATIO) return 'warn';
  return 'ok';
}

/** 「上限 2時間」/「上限なし」 */
export function limitText(limitMin) {
  return hasLimit(limitMin) ? `上限 ${formatDuration(limitMin * 60)}` : '上限なし';
}

// ---------------- 7日グラフ ----------------

/** 今日と過去6日（古い順）。欠けた日は0埋め。ラベルは今日=「今日」、他=曜日1文字。 */
export function last7Days(days, today) {
  const out = [];
  for (let back = 6; back >= 0; back--) {
    const date = addDays(today, -back);
    const usage = days.get(date);
    const youtubeSec = Math.max(usage?.youtubeSec ?? 0, 0);
    const robloxSec = Math.max(usage?.robloxSec ?? 0, 0);
    out.push({
      date,
      label: back === 0 ? '今日' : weekdayChar(date),
      youtubeSec,
      robloxSec,
      totalSec: youtubeSec + robloxSec,
      isToday: back === 0,
    });
  }
  return out;
}

// ---------------- 時間別グラフ ----------------

/**
 * その日の時間別24本（0..23時）。時間別データなし（day==null、または両方のhoursが無い旧データ）は null。
 * 片方だけ存在する場合、無い方は0埋め。全て0でも「データあり」（null ではない）。
 */
export function hourlySeries(day) {
  if (!day || (day.hoursYoutube === null && day.hoursRoblox === null)) return null;
  const out = [];
  for (let h = 0; h < 24; h++) {
    const youtubeSec = Math.max(day.hoursYoutube?.[h] ?? 0, 0);
    const robloxSec = Math.max(day.hoursRoblox?.[h] ?? 0, 0);
    out.push({ hour: h, youtubeSec, robloxSec, totalSec: youtubeSec + robloxSec });
  }
  return out;
}

/**
 * 1時間に収まる描画用秒数へクランプ（YouTube下・Roblox上の積み上げ合計が3600を超えない）。
 * @returns [youtubeSec, robloxSec]
 */
export function clampHourSegments(youtubeSec, robloxSec) {
  const y = Math.min(Math.max(youtubeSec, 0), HOUR_MAX_SEC);
  const r = Math.min(Math.max(robloxSec, 0), HOUR_MAX_SEC - y);
  return [y, r];
}

// ---------------- いま使用中 ----------------

/** 鮮度内(now - at <= 180秒)で app != 'none' のときのみそのアプリ。それ以外はnull。 */
export function nowBadge(now, nowEpochSec) {
  if (!now || now.app === 'none') return null;
  if (now.at === null || now.at === undefined) return null;
  return nowEpochSec - now.at <= NOW_FRESH_SEC ? now.app : null;
}

// ---------------- エージェント稼働状況 ----------------

/** ユーザーの最終活動時刻: agent.lastRunAt を優先、無ければ days の最新 updatedAt。 */
export function lastActivityEpoch(user) {
  if (user.agent?.lastRunAt !== null && user.agent?.lastRunAt !== undefined) return user.agent.lastRunAt;
  let max = null;
  for (const d of user.days.values()) {
    if (d.updatedAt !== null && d.updatedAt !== undefined && (max === null || d.updatedAt > max)) max = d.updatedAt;
  }
  return max;
}

/** epoch秒 → 端末ローカルの "HH:mm" */
export function localHHmm(epochSec) {
  const dt = new Date(epochSec * 1000);
  return formatClock(dt.getHours(), dt.getMinutes());
}

/**
 * 全ユーザーのうち最も新しい活動時刻を基準に、10分超古ければ「Mac停止中（最終 HH:mm）」、
 * そうでなければ「最終更新 HH:mm」。活動時刻が全く無い場合は停止扱い。
 * @param {(epochSec:number)=>string} [hhmm] 時刻整形（テストで差し替え可。既定=端末ローカル）
 */
export function agentStatus(users, nowEpochSec, hhmm = localHHmm) {
  let last = null;
  for (const u of users) {
    const e = lastActivityEpoch(u);
    if (e !== null && (last === null || e > last)) last = e;
  }
  if (last === null) return { text: 'Mac停止中（最終 --:--）', stale: true };
  const t = hhmm(last);
  if (nowEpochSec - last > AGENT_STALE_SEC) return { text: `Mac停止中（最終 ${t}）`, stale: true };
  return { text: `最終更新 ${t}`, stale: false };
}

// ---------------- 並び順・上限の解決・カード生成 ----------------

/** profile.order の昇順（無い人は最後）、同順位は uid の昇順。 */
export function sortUsers(users) {
  const key = (u) => u.profile?.order ?? Number.MAX_SAFE_INTEGER;
  return [...users].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
}

/**
 * 実効上限(分)。settingsMin（アプリから設定）があればそれ、無ければ profileMin（Mac側config）。
 * 0以下・どちらも無しは「上限なし」= null。settingsの0はprofileの上限を打ち消す（=上限なし）。
 */
export function effectiveLimitMin(settingsMin, profileMin) {
  const v = settingsMin ?? profileMin ?? null;
  return v !== null && v > 0 ? v : null;
}

export function effectiveYoutubeLimitMin(user) {
  return effectiveLimitMin(user.settings?.limitYoutubeMin, user.profile?.limitYoutubeMin);
}

export function effectiveRobloxLimitMin(user) {
  return effectiveLimitMin(user.settings?.limitRobloxMin, user.profile?.limitRobloxMin);
}

/**
 * 合計（YouTube+Roblox）の実効上限(分)。
 * - settingsTotalMin（`settings.limitTotalMin`）があればそれ（0以下 = 上限なし = null）。
 * - 無ければ個別の実効上限（youtubeMin・robloxMin。null/0は0として数える）の和。和が0なら上限なし。
 * 例: YouTube 60 + Roblox 60 の既存データは移行なしで合計120分の上限になる。
 */
export function effectiveTotalLimitMin(settingsTotalMin, youtubeMin, robloxMin) {
  if (settingsTotalMin !== null && settingsTotalMin !== undefined) {
    return settingsTotalMin > 0 ? settingsTotalMin : null;
  }
  const sum = Math.max(youtubeMin ?? 0, 0) + Math.max(robloxMin ?? 0, 0);
  return sum > 0 ? sum : null;
}

/** ユーザーの合計の実効上限(分)。Android の effectiveTotalLimitMin(user)。 */
export function effectiveTotalLimitMinOf(user) {
  return effectiveTotalLimitMin(
    user.settings?.limitTotalMin ?? null,
    effectiveYoutubeLimitMin(user),
    effectiveRobloxLimitMin(user),
  );
}

export function buildCard(user, today, nowEpochSec) {
  const todayUsage = user.days.get(today);
  const limitMin = effectiveTotalLimitMinOf(user);
  return {
    uid: user.uid,
    name: user.displayName,
    nowApp: nowBadge(user.now, nowEpochSec),
    usage: totalUsageModel(todayUsage?.youtubeSec ?? 0, todayUsage?.robloxSec ?? 0, limitMin),
    bars: last7Days(user.days, today),
    /** 合計の上限（秒）。上限なしなら0（週グラフの破線に使う） */
    limitTotalSec: hasLimit(limitMin) ? limitMin * 60 : 0,
  };
}

// ---------------- 合計（YouTube+Roblox）の使用状況サマリー（TotalUsageLogic.kt） ----------------

/** 上限あり: 軸の最大 = max(上限 × この値, 合計 × AXIS_TOTAL_PAD) */
export const AXIS_LIMIT_FACTOR = 1.3;
/** 上限あり: 合計が軸の右端に張り付かないための余白 */
export const AXIS_TOTAL_PAD = 1.06;
/** 上限なし: 軸の最大 = max(合計 × この値, AXIS_MIN_NO_LIMIT_SEC) */
export const AXIS_NO_LIMIT_FACTOR = 1.1;
/** 上限なし: 軸の最小（1時間） */
export const AXIS_MIN_NO_LIMIT_SEC = 3600;

/** 横棒の1区間（軸全体に対する位置の割合 0..1）。 */
const span = (start, end) => ({ start, end, isEmpty: end <= start });

/** 上限までの残り(分、秒は切り捨て)。上限なし・超過は null。 */
export function remainingMin(totalSec, limitMin) {
  if (!hasLimit(limitMin)) return null;
  const left = limitMin * 60 - Math.max(totalSec, 0);
  if (left < 0) return null;
  return Math.floor(left / 60);
}

/** 上限超過分(分、秒は切り上げ)。上限なし・上限以内は null。 */
export function overMin(totalSec, limitMin) {
  if (!hasLimit(limitMin)) return null;
  const over = totalSec - limitMin * 60;
  if (over <= 0) return null;
  return Math.floor((over + 59) / 60);
}

/** リボンの文言。OK=「あと25分 遊べる」/ WARN=「あと8分」/ OVER=「合計20分オーバー！」/ NONE=「上限なし」。 */
export function ribbonText(level, remaining, over) {
  switch (level) {
    case 'ok': return `あと${formatDuration((remaining ?? 0) * 60)} 遊べる`;
    case 'warn': return `あと${formatDuration((remaining ?? 0) * 60)}`;
    case 'over': return `合計${formatDuration((over ?? 0) * 60)}オーバー！`;
    default: return '上限なし';
  }
}

/**
 * 積み上げ棒の区間。YouTube → Roblox の順に左から積み、合計のうち上限を超えた部分だけを「超過」として
 * （どのアプリの分かに関わらず）上限位置から右へ塗る。上限以内の部分は各アプリの区間のまま。
 * 軸の最大: 上限あり = max(上限×1.3, 合計×1.06) / 上限なし = max(合計×1.1, 1時間)。
 * @returns {{axisMaxSec:number, youtube:{start:number,end:number,isEmpty:boolean}, roblox:object, over:object, limitPos:number|null}}
 */
export function barGeometry(youtubeSec, robloxSec, limitMin) {
  const y = Math.max(youtubeSec, 0);
  const r = Math.max(robloxSec, 0);
  const total = y + r;
  const limited = hasLimit(limitMin);
  const limitSec = limited ? limitMin * 60 : 0;
  const axis = limited
    ? Math.max(limitSec * AXIS_LIMIT_FACTOR, total * AXIS_TOTAL_PAD)
    : Math.max(total * AXIS_NO_LIMIT_FACTOR, AXIS_MIN_NO_LIMIT_SEC);
  // 上限以内に収まる合計（上限なしは全量）
  const within = limited ? Math.min(total, limitSec) : total;
  const yIn = Math.min(y, within);
  const rIn = Math.min(r, within - yIn);
  const f = (sec) => sec / axis;
  return {
    axisMaxSec: axis,
    youtube: span(0, f(yIn)),
    roblox: span(f(yIn), f(yIn + rIn)),
    over: span(f(within), f(total)),
    limitPos: limited ? f(limitSec) : null,
  };
}

/** 今日の YouTube / Roblox 秒数と合計の上限(分)から表示モデルを作る。 */
export function totalUsageModel(youtubeSec, robloxSec, limitMin) {
  const y = Math.max(youtubeSec, 0);
  const r = Math.max(robloxSec, 0);
  const total = y + r;
  const limit = hasLimit(limitMin) ? limitMin : null;
  const level = usageLevel(total, limit);
  const remaining = remainingMin(total, limit);
  const over = overMin(total, limit);
  return {
    youtubeSec: y,
    robloxSec: r,
    totalSec: total,
    youtubeText: formatDuration(y),
    robloxText: formatDuration(r),
    totalText: `合計 ${formatDuration(total)}`,
    limitMin: limit,
    level,
    remainingMin: remaining,
    overMin: over,
    ribbonText: ribbonText(level, remaining, over),
    limitText: limit !== null ? limitText(limit) : null,
    bar: barGeometry(y, r, limit),
  };
}

// ---------------- 週グラフの選択状態 ----------------

/** タップなしでこの時間が経ったら今日に戻す */
export const SELECTION_TIMEOUT_MS = 60_000;

/** 選択できる範囲: 今日と過去6日 */
export const SELECTION_DAYS = 7;

export const Selection = {
  initial(today) {
    return { today, selected: today, lastTapAtMs: 0 };
  },

  /** 日のタップ。表示範囲(今日と過去6日)外は無視。 */
  onTap(state, date, nowMs) {
    const oldest = addDays(state.today, -(SELECTION_DAYS - 1));
    if (date < oldest || date > state.today) return state; // ISO文字列は辞書順=日付順
    return { ...state, selected: date, lastTapAtMs: nowMs };
  },

  /**
   * 時間経過/日付更新の反映。
   * - 日付が変わった(0:00跨ぎ)ら今日に戻す
   * - 今日以外を選択中で、最後のタップから60秒以上経ったら今日に戻す
   */
  onTick(state, today, nowMs) {
    if (today !== state.today) return Selection.initial(today);
    if (state.selected !== state.today && nowMs - state.lastTapAtMs >= SELECTION_TIMEOUT_MS) {
      return { ...state, selected: state.today };
    }
    return state;
  },
};

// ---------------- 上限編集（設定オーバーレイ） ----------------

/** ステッパーの刻み（分） */
export const STEP_MIN = 15;

/** 上限の最大値（分）= 10時間 */
export const MAX_MIN = 600;

/** 範囲 0..MAX_MIN に収める。 */
export function clampLimit(min) {
  return Math.min(Math.max(min, 0), MAX_MIN);
}

/** ＋ボタン: 次の15分刻みへ（15の倍数でない値も次の倍数へ揃える）。最大 MAX_MIN で頭打ち。 */
export function stepUp(min) {
  return Math.min((Math.floor(clampLimit(min) / STEP_MIN) + 1) * STEP_MIN, MAX_MIN);
}

/** −ボタン: 前の15分刻みへ（15の倍数でない値は直前の倍数へ揃える）。最小0で頭打ち。 */
export function stepDown(min) {
  const c = clampLimit(min);
  return c % STEP_MIN === 0 ? Math.max(c - STEP_MIN, 0) : Math.floor(c / STEP_MIN) * STEP_MIN;
}

/** 設定画面の値表示: 0→「上限なし」、他は「1時間30分」「45分」。 */
export function limitValueText(min) {
  return min <= 0 ? '上限なし' : formatDuration(min * 60);
}

/** PATCHの本文JSON `{"limitTotalMin":120,"updatedAt":1793000000}`。個別の上限は送らない。キー順は固定。 */
export function patchBody(totalMin, updatedAtSec) {
  return JSON.stringify({
    limitTotalMin: clampLimit(totalMin),
    updatedAt: updatedAtSec,
  });
}

/**
 * 保存済み(pending)の設定を、サーバーから取得したデータが反映済みか。
 * 取得側に limitTotalMin があり、かつ updatedAt が同じか新しいときだけ反映済み。
 * （旧版・Web旧版が個別の上限だけを新しい updatedAt で書いても、合計の上限が無い間は反映済みとみなさない。）
 */
export function isReflected(fetched, pending) {
  if (fetched?.limitTotalMin === null || fetched?.limitTotalMin === undefined) return false;
  const f = fetched.updatedAt;
  const p = pending?.updatedAt;
  if (f === null || f === undefined || p === null || p === undefined) return false;
  return f >= p;
}

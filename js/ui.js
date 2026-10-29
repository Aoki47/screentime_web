// 画面のHTML文字列生成（Android版 ScreenTimeScreen / Cards / PowerCards / SettingsOverlay / ThemePicker の移植）。
// DOMには触れない（文字列を返すだけ）。寸法は CSS変数 --hs（画面全体）/ --cs（カード）/ --s（設定）を掛けて決める。
// イベントは data-action 属性で main.js が委譲処理する。

import { oopsFaceSvg, smileFaceSvg } from './faces.js';
import {
  MAX_MIN,
  agentStatus,
  buildCard,
  formatDateHeader,
  formatClock,
  formatDayLabel,
  formatDuration,
  hourlySeries,
  hourlyTitle,
  limitValueText,
  localIsoDate,
} from './logic.js';
import { isPowerEmpty } from './parser.js';
import * as Power from './power.js';
import { currentUser, effectivePower } from './store.js';
import {
  ALL_THEMES,
  findThemeOrDefault,
  themeBgCss,
  themeDisplayName,
} from './themes.js';

/** カードのデザイン基準寸法(px)。実寸との比でカード内の文字サイズを決める（Android の *_REF_W / *_REF_H）。 */
export const CARD_REF = {
  summary: { w: 400, h: 215 },
  week: { w: 400, h: 230 },
  hourly: { w: 400, h: 270 },
  'split-usage': { w: 400, h: 400 },
  'power-split': { w: 400, h: 330 },
  'power-numbers': { w: 400, h: 150 },
  'power-week': { w: 400, h: 230 },
  'power-hourly': { w: 400, h: 270 },
};
export const MIN_CARD_SCALE = 0.5;
export const MAX_CARD_SCALE = 2.4;

/** 画面全体のスケール（Android の hs）。 */
export function pageScale(w, h) {
  return Math.min(Math.max(Math.min(w / 400, h / 600), 0.6), 2.0);
}

/** カード1枚のスケール。 */
export function cardScale(kind, w, h) {
  const ref = CARD_REF[kind];
  return Math.min(Math.max(Math.min(w / ref.w, h / ref.h), MIN_CARD_SCALE), MAX_CARD_SCALE);
}

/** 設定オーバーレイのスケール。縦: 幅393/高さ760基準。横: 高さ基準。 */
export function overlayScale(w, h) {
  const wide = isWide(w, h);
  return wide
    ? Math.min(Math.max(h / 420, 0.75), 1.3)
    : Math.min(Math.max(Math.min(w / 393, h / 760), 0.75), 1.5);
}

/** 横向き判定（幅 > 高さ×1.1） */
export function isWide(w, h) {
  return w > h * 1.1;
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------- アイコン（Material Icons のパス） ----------------

const ICON_SETTINGS =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';
const ICON_CLOSE =
  'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';
const ICON_CHECK = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';

const icon = (path) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false"><path d="${path}" fill="currentColor"/></svg>`;

// ---------------- 部品 ----------------

/** 数字は大きく、「時間」「分」の単位は小さく描く。 */
export function durationHtml(text) {
  let out = '';
  for (const ch of text) {
    out += /[0-9]/.test(ch) ? `<span class="du-n">${ch}</span>` : `<span class="du-u">${esc(ch)}</span>`;
  }
  return out;
}

/** 数字（桁区切り・小数点・マイナスを含む）は大きく、単位などは小さく描く（Android の numberWithUnit）。 */
export function numberWithUnitHtml(text, unit) {
  let out = '';
  for (const ch of text) {
    out += /[0-9,.-]/.test(ch) ? `<span class="pn-b">${esc(ch)}</span>` : `<span class="pn-s">${esc(ch)}</span>`;
  }
  if (unit) out += `<span class="pn-s">${esc(unit)}</span>`;
  return out;
}

function nowBadgeHtml(app) {
  if (app === 'youtube') return '<span class="badge badge-yt">▶ いまYouTube中</span>';
  if (app === 'roblox') return '<span class="badge badge-rb">▶ いまRoblox中</span>';
  return '';
}

const APP_LABEL = { youtube: 'YouTube', roblox: 'Roblox' };
const APP_CLASS = { youtube: 'yt', roblox: 'rb' };

const pct = (x) => `${(x * 100).toFixed(3)}%`;

// ---------------- 使用量サマリー（案B） ----------------

/**
 * 状態リボン（全幅の角丸の帯、高さは本文の約1.3倍）。
 * OK=薄い緑の帯＋にっこり顔＋「あと25分 遊べる」 / WARN=琥珀の帯＋ふつうの顔＋「あと8分」 /
 * OVER=深い赤のベタ塗り＋「やっちまった」顔＋白の太字「合計20分オーバー！」 /
 * NONE=ニュートラルな帯「上限なし」（顔なし。高さは同じなので配置が動かない）。
 */
export function ribbonHtml(usage) {
  const faces = { ok: smileFaceSvg(false), warn: smileFaceSvg(true), over: oopsFaceSvg() };
  const face = faces[usage.level];
  return `<div class="ribbon ribbon-${usage.level}">${face ? `<span class="ribbon-face ribbon-face-${usage.level}">${face}</span>` : ''}<span class="ribbon-text">${esc(usage.ribbonText)}</span></div>`;
}

/**
 * 合計の積み上げ棒。左から YouTube（薄い赤）→ Roblox（緑）、上限を超えた部分は深い赤＋斜線。
 * 上限位置に文字色の縦線。区間の位置は logic.js の barGeometry が決める（軸に対する割合）。
 * 合計が0のときはトラックのみ。
 */
export function totalBarHtml(usage) {
  const g = usage.bar;
  const seg = (cls, sp) =>
    sp.isEmpty ? '' : `<i class="${cls}" style="left:${pct(sp.start)};width:${pct(sp.end - sp.start)}"></i>`;
  const fill =
    g.over.end > 0
      ? `<div class="tbar-fill" style="--end:${pct(g.over.end)}">${seg('seg-yt', g.youtube)}${seg('seg-rb', g.roblox)}${seg('seg-over', g.over)}</div>`
      : '';
  const limit = g.limitPos !== null ? `<i class="tbar-limit" style="left:${pct(g.limitPos)}"></i>` : '';
  return `<div class="tbar" role="img" aria-label="${esc(usage.totalText)}"><div class="tbar-track">${fill}</div>${limit}</div>`;
}

/**
 * 棒の下の文字行: 「上限 1時間30分」（控えめ。上限線の真下に中心を合わせる）と、右端の「合計 1時間50分」
 * （太字。超過時は超過色）。上限が無いときは合計だけ。上限文字の位置は main.js が実寸で補正する（captionLimitX）。
 */
export function barCaptionHtml(usage) {
  const lp = usage.bar.limitPos;
  const limit =
    usage.limitText !== null && lp !== null
      ? `<span class="cap-limit" style="left:${pct(lp)}" data-limit-pos="${lp}">${esc(usage.limitText)}</span>`
      : '';
  return `<div class="bar-cap">${limit}<span class="cap-total${usage.level === 'over' ? ' over' : ''}">${esc(usage.totalText)}</span></div>`;
}

/**
 * 「上限 …」文字の左端 x（px）。理想は上限線の真下に中央揃え。ただし左端(0)より左・「合計」文字と gap 未満に近づかない
 * （Android の BarCaption Layout と同じ。整数pxに切り捨て）。
 */
export function captionLimitX(limitPos, width, limitW, totalW, gapPx) {
  const totalX = width - totalW;
  const ideal = Math.trunc(limitPos * width - limitW / 2);
  const maxX = Math.max(totalX - limitW - Math.trunc(gapPx), 0);
  return Math.min(Math.max(ideal, 0), maxX);
}

function appTimeColHtml(app, usage) {
  const text = app === 'youtube' ? usage.youtubeText : usage.robloxText;
  return `<div class="app-col"><div class="app-label" style="color:var(--${APP_CLASS[app]})">${APP_LABEL[app]}</div><div class="app-time">${durationHtml(text)}</div></div>`;
}

/**
 * サマリーの中身: 名前＋「いま使用中」バッジ → 状態リボン → YouTube / Roblox の今日の時間（左右2列）→ 合計の積み上げ棒。
 * compact = true は分割表示用（高さが内容分で、上下の間隔は固定）。
 */
function summaryContentHtml(card, compact) {
  const u = card.usage;
  return `
    <div class="sum${compact ? ' sum-compact' : ''}">
      <div class="summary-top">
        <div class="summary-name">${esc(card.name)}</div>
        ${nowBadgeHtml(card.nowApp)}
      </div>
      ${ribbonHtml(u)}
      <div class="summary-cols">${appTimeColHtml('youtube', u)}${appTimeColHtml('roblox', u)}</div>
      <div class="sum-bar">${totalBarHtml(u)}${barCaptionHtml(u)}</div>
    </div>`;
}

function summaryCardHtml(card) {
  return `
    <section class="card card-summary" data-card="summary" aria-label="今日の使用時間">
      ${summaryContentHtml(card, false)}
    </section>`;
}

// ---------------- 週・時間別カード（使用量） ----------------

function weekColumnsHtml(items, selected) {
  const n = items.length;
  return items
    .map(
      (it, i) =>
        `<button type="button" class="wk-col" data-action="select-day" data-date="${it.date}" style="left:${((i / n) * 100).toFixed(3)}%;width:${(100 / n).toFixed(3)}%" aria-pressed="${it.date === selected}" aria-label="${esc(it.aria)}"></button>`,
    )
    .join('');
}

function weekCardHtml(card, selected) {
  const cols = weekColumnsHtml(
    card.bars.map((b) => ({ date: b.date, aria: `${formatDayLabel(b.date)} 合計${formatDuration(b.totalSec)}` })),
    selected,
  );
  const legend =
    card.limitTotalSec > 0
      ? `<svg class="lim-line" viewBox="0 0 22 10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--limit)" stroke-width="1.6" stroke-dasharray="5 3.5"/></svg><span class="lim-text">合計の上限</span>`
      : '';
  return `
    <section class="card card-week" data-card="week" aria-label="1週間">
      <div class="card-head">
        <h2 class="card-title">1週間</h2>
        ${legend}
      </div>
      <div class="chart-area" data-chart="week">${cols}</div>
    </section>`;
}

function legendItemHtml(app) {
  return `<span class="legend-item"><i class="legend-sw legend-${APP_CLASS[app]}"></i>${APP_LABEL[app]}</span>`;
}

const NO_HOURLY_HTML = '<p class="no-hourly">時間別データなし（Mac側の更新が必要です）</p>';

function hourlyCardHtml(title, totalText, hasHours) {
  return `
    <section class="card card-hourly" data-card="hourly" aria-label="時間別">
      <div class="card-head">
        <h2 class="card-title">${esc(title)}</h2>
        <span class="card-total">合計 ${esc(totalText)}</span>
      </div>
      <div class="chart-area" data-chart="hourly">${hasHours ? '' : NO_HOURLY_HTML}</div>
      <div class="legend">${legendItemHtml('youtube')}${legendItemHtml('roblox')}</div>
    </section>`;
}

// ---------------- 分割表示のカード ----------------

/** カード全体がタップ対象（Enter/Space でも開く）。panel='power'|'usage'。 */
function splitAttrs(kind, panel, label) {
  return `data-card="${kind}" data-action="expand" data-panel="${panel}" role="button" tabindex="0" aria-label="${label}"`;
}

/**
 * 分割表示の使用量カード: 名前・リボン・YouTube/Roblox の時間・合計の棒 → 今日の時間別の積み上げ棒グラフ。
 * @param card null = ユーザーのデータなし（中央メッセージ）
 */
function usageSplitCardHtml(card, hasHours) {
  const attrs = splitAttrs('split-usage', 'usage', '使用量を全画面で開く');
  if (!card) {
    return `<section class="card card-split card-usplit" ${attrs}>
      <div class="no-data"><div class="nd-title">まだデータがありません</div><div class="nd-sub">（Mac側のセットアップを確認）</div></div>
    </section>`;
  }
  return `
    <section class="card card-split card-usplit" ${attrs}>
      ${summaryContentHtml(card, true)}
      <div class="split-head">
        <h2 class="card-title">今日の時間別</h2>
        ${legendItemHtml('youtube')}${legendItemHtml('roblox')}
      </div>
      <div class="chart-area" data-chart="hourly">${hasHours ? '' : NO_HOURLY_HTML}</div>
    </section>`;
}

// ---------------- 電力 ----------------

/**
 * 「いまの消費電力 1,240 W」（左）と「今日の使用量 8.4 / kWh・約260円」（右）。
 * 水準が高いとバッジ、10分以上更新が無ければ数字を薄くして「電力: 更新なし」を出す。num = 数字の基準サイズ(px)。
 */
export function powerNumbersHtml(s, num) {
  const wColor = s.stale ? 'var(--muted)' : s.level === 'high' ? 'var(--warn)' : s.level === 'over' ? 'var(--over)' : 'var(--text)';
  const status = s.stale
    ? `<div class="pw-stale">${esc(Power.STALE_TEXT)}</div>`
    : s.badgeText
      ? `<span class="lv-badge lv-${s.level}">${esc(s.badgeText)}</span>`
      : '';
  return `
    <div class="pw-nums" style="--num:${num}">
      <div class="pw-col">
        <div class="pw-label">いまの消費電力</div>
        <div class="pw-big" style="color:${wColor}">${numberWithUnitHtml(s.wText, ' W')}</div>
        ${status}
      </div>
      <div class="pw-col">
        <div class="pw-label">今日の使用量</div>
        <div class="pw-big" style="color:var(--pw)">${numberWithUnitHtml(s.todayKwhText, '')}</div>
        <div class="pw-sub">kWh・${esc(s.costText)}</div>
      </div>
    </div>`;
}

/** 電力データが何も無いときの中央メッセージ（Web 版は表示専用なので、記録していない旨を出す）。 */
const NO_POWER_HTML =
  '<div class="no-data"><div class="nd-title">電力データなし</div><div class="nd-sub">Redmi で記録されていません</div></div>';

/**
 * 分割表示の電力カード: 数字 → 「今日の時間別 (kWh)」の棒グラフ（常に今日）。
 * @param summary null = 電力データなし
 */
function powerSplitCardHtml(summary) {
  const attrs = splitAttrs('power-split', 'power', '電力を全画面で開く');
  if (!summary) return `<section class="card card-split card-psplit" ${attrs}>${NO_POWER_HTML}</section>`;
  return `
    <section class="card card-split card-psplit" ${attrs}>
      ${powerNumbersHtml(summary, 40)}
      <div class="split-head"><h2 class="card-title">今日の時間別 (kWh)</h2></div>
      <div class="chart-area" data-chart="power-hourly"></div>
    </section>`;
}

/** 全画面の電力: 大きな数字のカード（summary が null なら画面全体のメッセージ）。 */
function powerNumbersCardHtml(summary) {
  return `
    <section class="card card-pnum" data-card="power-numbers" aria-label="電力">
      ${summary ? powerNumbersHtml(summary, 46) : NO_POWER_HTML}
    </section>`;
}

/** 全画面の電力: 「1週間 (kWh)」7日の棒グラフ。右に平均。列タップで日を選択。 */
function powerWeekCardHtml(bars, selected) {
  const avg = Power.weekAverage(bars);
  const cols = weekColumnsHtml(
    bars.map((b) => ({ date: b.date, aria: `${formatDayLabel(b.date)} ${Power.formatKwh(b.kwh)} kWh` })),
    selected,
  );
  return `
    <section class="card card-week" data-card="power-week" aria-label="1週間の電力">
      <div class="card-head">
        <h2 class="card-title">1週間 (kWh)</h2>
        ${avg !== null ? `<span class="card-total">平均 ${Power.formatKwh(avg)}</span>` : ''}
      </div>
      <div class="chart-area" data-chart="power-week">${cols}</div>
    </section>`;
}

/** 全画面の電力: 選択日の時間別カード。タイトルに日付、右にその日の合計kWh。データなしの日は「データなし」を重ねる。 */
function powerHourlyCardHtml(title, totalText, hasData) {
  return `
    <section class="card card-hourly" data-card="power-hourly" aria-label="電力の時間別">
      <div class="card-head">
        <h2 class="card-title">${esc(title)}</h2>
        <span class="card-total">${esc(totalText)} kWh</span>
      </div>
      <div class="chart-area" data-chart="power-hourly">${hasData ? '' : '<p class="no-hourly nodata">データなし</p>'}</div>
    </section>`;
}

function chipsHtml(users, selectedUid) {
  return `<div class="chips" role="group" aria-label="ユーザー切替">${users
    .map(
      (u) =>
        `<button type="button" class="chip" data-action="select-user" data-uid="${esc(u.uid)}" aria-pressed="${u.uid === selectedUid}">${esc(u.displayName)}</button>`,
    )
    .join('')}</div>`;
}

function centerMessageHtml(title, sub) {
  return `<div class="center-msg"><div class="center-title">${esc(title)}</div>${sub ? `<div class="center-sub">${esc(sub)}</div>` : ''}</div>`;
}

// ---------------- ログイン／認証ゲート ----------------

/** Firebase Auth のエラーコード → 表示文言（コードが不明なら汎用文＋コード）。 */
export function loginErrorText(code) {
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'このサイトのドメインが Firebase の承認済みドメインに登録されていません';
    case 'auth/network-request-failed':
      return '通信できませんでした。ネットワークを確認してください';
    case 'auth/user-disabled':
      return 'このアカウントは無効になっています';
    case 'auth/web-storage-unsupported':
      return 'このブラウザではログイン情報を保存できません（プライベートブラウズや Cookie 設定を確認）';
    default:
      return code ? `ログインできませんでした（${code}）` : 'ログインできませんでした';
  }
}

function gateHtml(inner) {
  return `<div class="page"><main class="main"><div class="gate">${inner}</div></main></div>`;
}

/**
 * ログインが済んでいない／許可されていないときの画面。メイン画面を出してよいときは null。
 *  - 状態確定前: 読み込み中
 *  - ログアウト中: アプリ名＋「Google でログイン」
 *  - RTDB が 401/403: 「このアカウント（email）は許可されていません」＋ログアウト
 */
export function renderGate(state) {
  const auth = state.auth;
  if (!auth) return null; // 認証を使わない構成（テスト等）
  if (!auth.ready) return gateHtml('<div class="gate-title">読み込み中…</div>');
  if (!auth.email) {
    const err = auth.error ? `<p class="gate-error" role="alert">${esc(auth.error)}</p>` : '';
    return gateHtml(`
      <h1 class="gate-title">使用時間</h1>
      <p class="gate-sub">Mac の YouTube / Roblox の使用時間</p>
      <button type="button" class="gate-btn" data-action="sign-in">Google でログイン</button>
      ${err}`);
  }
  if (state.status === 'auth-error') {
    return gateHtml(`
      <div class="gate-title">このアカウント（${esc(auth.email)}）は許可されていません</div>
      <p class="gate-sub">許可されたアカウントでログインし直してください</p>
      <button type="button" class="gate-btn" data-action="sign-out">ログアウト</button>`);
  }
  return null;
}

// ---------------- メイン画面 ----------------

/** 全画面のタイトル（ヘッダー中央）。 */
export const PANEL_TITLE = { power: '電力', usage: 'Mac使用時間' };

/**
 * メイン画面（ヘッダー＋分割 / 電力の全画面 / 使用量の全画面）の描画結果。
 * state.expanded: null=分割（縦=上に電力・下に使用量、横=左に電力・右に使用量）/ 'power' / 'usage'。
 * @returns {{html:string, charts:null|Record<string,object>}}
 *   charts は描画後にサイズを測ってSVGを描くための情報（data-chart 名 → 記述子。無ければ null）
 */
export function renderMain(state, vp) {
  const theme = findThemeOrDefault(state.themeId);
  const wide = isWide(vp.width, vp.height);
  const data = state.data;
  const users = data?.users ?? [];
  const user = currentUser(state);
  const expanded = state.expanded ?? null;
  const nowSec = Math.floor(state.nowMs / 1000);
  const nowDate = new Date(state.nowMs);
  const today = localIsoDate(state.nowMs);
  const timeText = formatClock(nowDate.getHours(), nowDate.getMinutes());

  const agent = data && users.length > 0 ? agentStatus(users, nowSec) : null;
  const offline = state.loaded && !state.online;
  // 名前チップは使用量に関係する画面（分割・使用量）だけ。電力の全画面では出さない
  const showChips = users.length > 1 && !!user && expanded !== 'power';
  const chips = showChips ? chipsHtml(users, user.uid) : '';

  const gear = `<button type="button" class="gear" data-action="open-settings" aria-label="設定">${icon(ICON_SETTINGS)}</button>`;
  const header =
    expanded === null
      ? `
    <header class="hdr">
      <div class="hdr-main">
        <div class="hdr-date">${esc(formatDateHeader(today))}</div>
        <div class="hdr-status">
          ${agent ? `<span class="status${agent.stale ? ' stale' : ''}">${esc(agent.text)}</span>` : ''}
          ${offline ? `<span class="offline" style="background:${theme.warn}2E">オフライン</span>` : ''}
        </div>
      </div>
      ${wide ? chips : ''}
      <div class="hdr-clock" aria-label="現在時刻">${timeText}</div>
      ${gear}
    </header>`
      : `
    <header class="hdr hdr-exp">
      <button type="button" class="back" data-action="collapse" aria-label="戻る"><span class="back-ch" aria-hidden="true">‹</span><span class="back-tx">戻る</span></button>
      <div class="hdr-title">${esc(PANEL_TITLE[expanded] ?? '')}</div>
      ${wide ? chips : ''}
      <div class="hdr-clock" aria-label="現在時刻">${timeText}</div>
      ${gear}
    </header>`;
  const chipsRow = !wide && showChips ? `<div class="chips-row">${chips}</div>` : '';

  const power = effectivePower(state);
  const powerSummary = isPowerEmpty(power) ? null : Power.summary(power, today, nowSec);

  let body;
  let charts = null;
  if (data === null && !state.loaded) {
    body = centerMessageHtml('読み込み中…');
  } else if (data === null) {
    body = centerMessageHtml('データを取得できません', 'ネットワーク接続を確認してください');
  } else if (expanded === null) {
    // ---- 分割 ----
    const card = user ? buildCard(user, today, nowSec) : null;
    const hours = user ? hourlySeries(user.days.get(today)) : null;
    const todayPower = power?.days?.get(today) ?? null;
    const pHours = Power.hourlySeries(todayPower);
    const pCard = powerSplitCardHtml(powerSummary);
    const uCard = usageSplitCardHtml(card, hours !== null);
    body = `<div class="dash dash-split${wide ? ' dash-wide' : ''}">${pCard}${uCard}</div>`;
    charts = {};
    if (powerSummary) {
      charts['power-hourly'] = { hours: pHours, yMax: Power.hourlyAxisMax(Math.max(...pHours)), currentHour: nowDate.getHours() };
    }
    if (hours) charts.hourly = { hours, currentHour: nowDate.getHours() };
  } else if (expanded === 'power') {
    // ---- 電力の全画面 ----
    if (!powerSummary) {
      body = `<div class="dash dash-power">${powerNumbersCardHtml(null)}</div>`;
    } else {
      const selected = state.selection.selected;
      const bars = Power.last7Days(power.days, today);
      const selectedDay = power.days.get(selected) ?? null;
      const pHours = Power.hourlySeries(selectedDay);
      const numbers = powerNumbersCardHtml(powerSummary);
      const week = powerWeekCardHtml(bars, selected);
      const hourly = powerHourlyCardHtml(
        hourlyTitle(selected, today),
        Power.formatKwh(Power.dayTotal(selectedDay)),
        selectedDay !== null,
      );
      body = wide
        ? `<div class="dash dash-power dash-wide"><div class="dash-left">${numbers}${week}</div>${hourly}</div>`
        : `<div class="dash dash-power">${numbers}${week}${hourly}</div>`;
      charts = {
        'power-week': { bars, selectedDate: selected, yMax: Power.weeklyAxisMax(Math.max(...bars.map((b) => b.kwh))) },
        'power-hourly': {
          hours: pHours,
          yMax: Power.hourlyAxisMax(Math.max(...pHours)),
          currentHour: selected === today ? nowDate.getHours() : null,
        },
      };
    }
  } else if (users.length === 0 || !user) {
    body = centerMessageHtml('まだデータがありません', '（Mac側のセットアップを確認）');
  } else {
    // ---- 使用量の全画面（従来のダッシュボード） ----
    const selected = state.selection.selected;
    const card = buildCard(user, today, nowSec);
    const selectedBar = card.bars.find((b) => b.date === selected) ?? card.bars[card.bars.length - 1];
    const hours = hourlySeries(user.days.get(selected));
    const currentHour = selected === today ? nowDate.getHours() : null;
    const summary = summaryCardHtml(card);
    const week = weekCardHtml(card, selected);
    const hourly = hourlyCardHtml(hourlyTitle(selected, today), formatDuration(selectedBar.totalSec), hours !== null);
    body = wide
      ? `<div class="dash dash-wide"><div class="dash-left">${summary}${week}</div>${hourly}</div>`
      : `<div class="dash">${summary}${week}${hourly}</div>`;
    charts = {
      week: { bars: card.bars, selectedDate: selected, limitTotalSec: card.limitTotalSec },
      ...(hours ? { hourly: { hours, currentHour } } : {}),
    };
  }

  const hasCharts = charts !== null && Object.keys(charts).length > 0;
  return {
    html: `<div class="page${wide ? ' is-wide' : ''}">${header}${chipsRow}<main class="main">${body}</main></div>`,
    charts: hasCharts ? charts : null,
  };
}

// ---------------- 設定オーバーレイ ----------------

/**
 * 見出しの下に「− 値 ＋」を置く1行（合計の上限・電力設定で共用）。
 * action = ボタンの data-action、extra = 追加の data 属性（例: 'data-field="warn"'）。
 */
function stepperRowHtml({ label, color, swatch, valueText, canDown, canUp, downLabel, upLabel, action, extra = '' }) {
  const ex = extra ? ` ${extra}` : '';
  return `
    <div class="limit-row">
      <div class="limit-name"><i class="limit-sw" style="background:${swatch}"></i><span style="color:${color}">${esc(label)}</span></div>
      <div class="stepper">
        <button type="button" class="step" data-action="${action}"${ex} data-dir="down" ${canDown ? '' : 'disabled'} aria-label="${esc(downLabel)}">−</button>
        <output class="limit-value" aria-live="polite" aria-label="${esc(label)}">${esc(valueText)}</output>
        <button type="button" class="step" data-action="${action}"${ex} data-dir="up" ${canUp ? '' : 'disabled'} aria-label="${esc(upLabel)}">＋</button>
      </div>
    </div>`;
}

/** 保存状態のインライン表示。高さが跳ねないよう、状態が無いときも1行分の領域を確保する。 */
function saveMsgHtml(status) {
  if (status === 'saved') return '<p class="save-msg">保存しました</p>';
  if (status === 'failed') return '<p class="save-msg failed" role="alert">保存できませんでした（通信を確認）</p>';
  return '<p class="save-msg">&nbsp;</p>';
}

function saveBtnHtml(action, saving) {
  return `<button type="button" class="save-btn" data-action="${action}" ${saving ? 'disabled' : ''}>${saving ? '保存中…' : '保存'}</button>`;
}

/** 「上限時間」: YouTube+Roblox の「合計の上限（名前）」1本を −/＋（15分刻み、0〜10時間）で編集して保存。 */
function limitsSectionHtml(draft, saveStatus) {
  if (!draft) {
    return `<h3 class="sec-title">上限時間</h3><p class="sec-empty">ユーザーのデータがありません</p>`;
  }
  return `
    <h3 class="sec-title">上限時間</h3>
    ${stepperRowHtml({
      label: `合計の上限（${draft.name}）`,
      color: 'var(--text)',
      swatch: 'var(--accent)',
      valueText: limitValueText(draft.totalMin),
      canDown: draft.totalMin > 0,
      canUp: draft.totalMin < MAX_MIN,
      downLabel: '合計の上限を15分減らす',
      upLabel: '合計の上限を15分増やす',
      action: 'step',
    })}
    ${saveBtnHtml('save', saveStatus === 'saving')}
    ${saveMsgHtml(saveStatus)}`;
}

const POWER_SWATCH = 'linear-gradient(var(--pw-l), var(--pw))';

/** 「電力」: 警告の目安(W)と電気料金単価(円/kWh)。専用の「保存」で `power/settings` に書く。 */
function powerSectionHtml(draft, saveStatus) {
  if (!draft) return `<h3 class="sec-title">電力</h3>`;
  const row = (o) => stepperRowHtml({ color: 'var(--pw)', swatch: POWER_SWATCH, action: 'power-step', ...o });
  return `
    <h3 class="sec-title">電力</h3>
    <div class="limit-rows">
      ${row({
        label: '警告の目安',
        valueText: Power.warnText(draft.warnW),
        canDown: draft.warnW > Power.WARN_MIN,
        canUp: draft.warnW < Power.WARN_MAX,
        downLabel: '警告の目安を500W減らす',
        upLabel: '警告の目安を500W増やす',
        extra: 'data-field="warn"',
      })}
      ${row({
        label: '電気料金単価',
        valueText: Power.yenText(draft.yenPerKwh),
        canDown: draft.yenPerKwh > Power.YEN_MIN,
        canUp: draft.yenPerKwh < Power.YEN_MAX,
        downLabel: '電気料金単価を1円減らす',
        upLabel: '電気料金単価を1円増やす',
        extra: 'data-field="yen"',
      })}
    </div>
    ${saveBtnHtml('power-save', saveStatus === 'saving')}
    ${saveMsgHtml(saveStatus)}`;
}

function themeSwatchHtml(t) {
  return `<span class="swatch" style="background:${themeBgCss(t)};border-color:${t.cardBorder}">
    <i class="sw-bar" style="background:linear-gradient(${t.youtubeLight},${t.youtube})"></i>
    <i class="sw-bar" style="background:linear-gradient(${t.robloxLight},${t.roblox})"></i>
    <i class="sw-dot" style="background:${t.warn}"></i>
    <i class="sw-dot" style="background:${t.over}"></i>
  </span>`;
}

function themeListHtml(selectedId) {
  return `<div class="theme-list">${ALL_THEMES.map((t) => {
    const sel = t.id === selectedId;
    return `<button type="button" class="theme-row${sel ? ' selected' : ''}" data-action="theme" data-id="${t.id}" aria-pressed="${sel}">
      ${themeSwatchHtml(t)}
      <span class="theme-name">${esc(themeDisplayName(t))}</span>
      ${sel ? `<span class="theme-check" role="img" aria-label="選択中">${icon(ICON_CHECK)}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}

function accountSectionHtml(auth) {
  if (!auth?.email) return '';
  return `
    <h3 class="sec-title">アカウント</h3>
    <div class="account-box">
      <div class="account-email">${esc(auth.email)}</div>
      <button type="button" class="logout-btn" data-action="sign-out">ログアウト</button>
    </div>`;
}

/** 設定オーバーレイ（スクリム＋パネル）。縦=1列、横=左（上限＋電力）・右（テーマ＋アカウント）の2列。 */
export function renderOverlay(state, vp) {
  const wide = isWide(vp.width, vp.height);
  const limits = limitsSectionHtml(state.limitDraft, state.saveStatus);
  const powerSec = powerSectionHtml(state.powerDraft ?? null, state.powerSaveStatus ?? 'idle');
  const themes = `<h3 class="sec-title">テーマ</h3>${themeListHtml(state.themeId)}`;
  const account = accountSectionHtml(state.auth);
  const gap = '<div class="ov-gap"></div>';
  const content = wide
    ? `<div class="ov-cols"><div class="ov-col" data-scroll="limits">${limits}${gap}${powerSec}</div><div class="ov-col" data-scroll="themes">${themes}${account ? `${gap}${account}` : ''}</div></div>`
    : `<div class="ov-scroll" data-scroll="all">${limits}${gap}${powerSec}${gap}${themes}${account ? `${gap}${account}` : ''}</div>`;
  return `
    <div class="ov-scrim${wide ? ' is-wide' : ''}" data-action="scrim">
      <div class="ov-panel" role="dialog" aria-modal="true" aria-label="設定" tabindex="-1">
        <div class="ov-head">
          <h2 class="ov-title">設定</h2>
          <button type="button" class="ov-close" data-action="close-settings" aria-label="閉じる">${icon(ICON_CLOSE)}</button>
        </div>
        ${content}
      </div>
    </div>`;
}

// 画面のHTML文字列生成（Android版 ScreenTimeScreen / Cards / SettingsOverlay / ThemePicker の移植）。
// DOMには触れない（文字列を返すだけ）。寸法は CSS変数 --hs（画面全体）/ --cs（カード）/ --s（設定）を掛けて決める。
// イベントは data-action 属性で main.js が委譲処理する。

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
import { currentUser } from './store.js';
import {
  ALL_THEMES,
  findThemeOrDefault,
  levelColor,
  levelLightColor,
  themeBgCss,
  themeDisplayName,
} from './themes.js';

/** カードのデザイン基準寸法(px)。実寸との比でカード内の文字サイズを決める。 */
export const CARD_REF = {
  summary: { w: 400, h: 170 },
  week: { w: 400, h: 230 },
  hourly: { w: 400, h: 270 },
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

function nowBadgeHtml(app) {
  if (app === 'youtube') return '<span class="badge badge-yt">▶ いまYouTube中</span>';
  if (app === 'roblox') return '<span class="badge badge-rb">▶ いまRoblox中</span>';
  return '';
}

const APP_LABEL = { youtube: 'YouTube', roblox: 'Roblox' };
const APP_CLASS = { youtube: 'yt', roblox: 'rb' };

function usageColumnHtml(app, row, theme) {
  const c = levelColor(theme, row.level, app);
  const l = levelLightColor(theme, row.level, app);
  const timeColor = row.level === 'warn' || row.level === 'over' ? c : 'var(--text)';
  const showFill = row.level !== 'none' && row.progress > 0;
  return `
    <div class="usage">
      <div class="usage-label" style="color:var(--${app === 'youtube' ? 'yt' : 'rb'})">${APP_LABEL[app]}</div>
      <div class="usage-time" style="color:${timeColor}">${durationHtml(row.timeText)}</div>
      <div class="pbar">${showFill ? `<i style="width:${(row.progress * 100).toFixed(2)}%;background:linear-gradient(90deg,${c},${l})"></i>` : ''}</div>
      <div class="usage-foot">
        <span class="usage-limit">${esc(row.limitText)}</span>
        ${row.overText ? `<span class="usage-over">${esc(row.overText)}</span>` : ''}
      </div>
    </div>`;
}

function summaryCardHtml(card, theme) {
  return `
    <section class="card card-summary" data-card="summary" aria-label="今日の使用時間">
      <div class="summary-top">
        <div class="summary-name">${esc(card.name)}</div>
        ${nowBadgeHtml(card.nowApp)}
      </div>
      <div class="summary-cols">
        ${usageColumnHtml('youtube', card.youtube, theme)}
        ${usageColumnHtml('roblox', card.roblox, theme)}
      </div>
    </section>`;
}

function weekCardHtml(card, selected) {
  const n = card.bars.length;
  const cols = card.bars
    .map(
      (b, i) =>
        `<button type="button" class="wk-col" data-action="select-day" data-date="${b.date}" style="left:${((i / n) * 100).toFixed(3)}%;width:${(100 / n).toFixed(3)}%" aria-pressed="${b.date === selected}" aria-label="${esc(formatDayLabel(b.date))} 合計${esc(formatDuration(b.totalSec))}"></button>`,
    )
    .join('');
  const legend =
    card.limitSumSec > 0
      ? `<svg class="lim-line" viewBox="0 0 22 10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--limit)" stroke-width="1.6" stroke-dasharray="5 3.5"/></svg><span class="lim-text">上限の合計</span>`
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

function hourlyCardHtml(title, totalText, hasHours) {
  return `
    <section class="card card-hourly" data-card="hourly" aria-label="時間別">
      <div class="card-head">
        <h2 class="card-title">${esc(title)}</h2>
        <span class="card-total">合計 ${esc(totalText)}</span>
      </div>
      <div class="chart-area" data-chart="hourly">${hasHours ? '' : '<p class="no-hourly">時間別データなし（Mac側の更新が必要です）</p>'}</div>
      <div class="legend">${legendItemHtml('youtube')}${legendItemHtml('roblox')}</div>
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

/**
 * メイン画面（ヘッダー＋3段/2列のカード）の描画結果。
 * @returns {{html:string, charts:null|{week:object, hourly:object}}}
 *   charts は描画後にサイズを測ってSVGを描くための情報（ユーザー無し等は null）
 */
export function renderMain(state, vp) {
  const theme = findThemeOrDefault(state.themeId);
  const wide = isWide(vp.width, vp.height);
  const data = state.data;
  const users = data?.users ?? [];
  const user = currentUser(state);
  const nowSec = Math.floor(state.nowMs / 1000);
  const nowDate = new Date(state.nowMs);
  const today = localIsoDate(state.nowMs);

  const agent = data && !(data.users.length === 0) ? agentStatus(data.users, nowSec) : null;
  const offline = state.loaded && !state.online;
  const showChips = users.length > 1 && user;
  const chips = showChips ? chipsHtml(users, user.uid) : '';

  const header = `
    <header class="hdr">
      <div class="hdr-main">
        <div class="hdr-date">${esc(formatDateHeader(today))}</div>
        <div class="hdr-status">
          ${agent ? `<span class="status${agent.stale ? ' stale' : ''}">${esc(agent.text)}</span>` : ''}
          ${offline ? `<span class="offline" style="background:${theme.warn}2E">オフライン</span>` : ''}
        </div>
      </div>
      ${wide ? chips : ''}
      <div class="hdr-clock" aria-label="現在時刻">${formatClock(nowDate.getHours(), nowDate.getMinutes())}</div>
      <button type="button" class="gear" data-action="open-settings" aria-label="設定">${icon(ICON_SETTINGS)}</button>
    </header>
    ${!wide && showChips ? `<div class="chips-row">${chips}</div>` : ''}`;

  let body;
  let charts = null;
  if (data === null && !state.loaded) {
    body = centerMessageHtml('読み込み中…');
  } else if (data === null) {
    body = centerMessageHtml('データを取得できません', 'ネットワーク接続を確認してください');
  } else if (data.users.length === 0 || !user) {
    body = centerMessageHtml('まだデータがありません', '（Mac側のセットアップを確認）');
  } else {
    const selected = state.selection.selected;
    const card = buildCard(user, today, nowSec);
    const selectedBar = card.bars.find((b) => b.date === selected) ?? card.bars[card.bars.length - 1];
    const hours = hourlySeries(user.days.get(selected));
    const currentHour = selected === today ? nowDate.getHours() : null;
    const summary = summaryCardHtml(card, theme);
    const week = weekCardHtml(card, selected);
    const hourly = hourlyCardHtml(hourlyTitle(selected, today), formatDuration(selectedBar.totalSec), hours !== null);
    body = wide
      ? `<div class="dash dash-wide"><div class="dash-left">${summary}${week}</div>${hourly}</div>`
      : `<div class="dash">${summary}${week}${hourly}</div>`;
    charts = {
      week: { bars: card.bars, selectedDate: selected, limitSumSec: card.limitSumSec },
      hourly: hours ? { hours, currentHour } : null,
    };
  }

  return {
    html: `<div class="page${wide ? ' is-wide' : ''}">${header}<main class="main">${body}</main></div>`,
    charts,
  };
}

// ---------------- 設定オーバーレイ ----------------

function limitRowHtml(app, minutes) {
  const label = APP_LABEL[app];
  return `
    <div class="limit-row">
      <div class="limit-name"><i class="limit-sw legend-${APP_CLASS[app]}"></i><span style="color:var(--${app === 'youtube' ? 'yt' : 'rb'})">${label}</span></div>
      <div class="stepper">
        <button type="button" class="step" data-action="step" data-app="${app}" data-dir="down" ${minutes > 0 ? '' : 'disabled'} aria-label="${label} の上限を15分減らす">−</button>
        <output class="limit-value" aria-live="polite" aria-label="${label} の上限">${esc(limitValueText(minutes))}</output>
        <button type="button" class="step" data-action="step" data-app="${app}" data-dir="up" ${minutes < MAX_MIN ? '' : 'disabled'} aria-label="${label} の上限を15分増やす">＋</button>
      </div>
    </div>`;
}

function limitsSectionHtml(draft, saveStatus) {
  const title = draft ? `上限時間（${esc(draft.name)}）` : '上限時間';
  if (!draft) {
    return `<h3 class="sec-title">${title}</h3><p class="sec-empty">ユーザーのデータがありません</p>`;
  }
  const saving = saveStatus === 'saving';
  const msg =
    saveStatus === 'saved'
      ? '<p class="save-msg">保存しました</p>'
      : saveStatus === 'failed'
        ? '<p class="save-msg failed" role="alert">保存できませんでした（通信を確認）</p>'
        : '<p class="save-msg">&nbsp;</p>';
  return `
    <h3 class="sec-title">${title}</h3>
    <div class="limit-rows">${limitRowHtml('youtube', draft.youtubeMin)}${limitRowHtml('roblox', draft.robloxMin)}</div>
    <button type="button" class="save-btn" data-action="save" ${saving ? 'disabled' : ''}>${saving ? '保存中…' : '保存'}</button>
    ${msg}`;
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

/** 設定オーバーレイ（スクリム＋パネル）。 */
export function renderOverlay(state, vp) {
  const wide = isWide(vp.width, vp.height);
  const limits = limitsSectionHtml(state.limitDraft, state.saveStatus);
  const themes = `<h3 class="sec-title">テーマ</h3>${themeListHtml(state.themeId)}`;
  const account = accountSectionHtml(state.auth);
  const content = wide
    ? `<div class="ov-cols"><div class="ov-col" data-scroll="limits">${limits}</div><div class="ov-col" data-scroll="themes">${themes}${account ? `<div class="ov-gap"></div>${account}` : ''}</div></div>`
    : `<div class="ov-scroll" data-scroll="all">${limits}<div class="ov-gap"></div>${themes}${account ? `<div class="ov-gap"></div>${account}` : ''}</div>`;
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

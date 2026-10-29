// エントリポイント: ストアとDOMをつなぐ（描画・イベント委譲・寸法の反映・ライフサイクル）。

import { hourlyChartSvg, weekChartSvg } from './charts.js';
import { Store, safeStorage } from './store.js';
import { findThemeOrDefault, themeBgColor } from './themes.js';
import { cardScale, isWide, loginErrorText, overlayScale, pageScale, renderGate, renderMain, renderOverlay } from './ui.js';

const root = document.documentElement;
const appEl = document.getElementById('app');
const overlayEl = document.getElementById('overlay');
const themeMeta = document.querySelector('meta[name="theme-color"]');

let rawStorage = null;
try {
  rawStorage = window.localStorage;
} catch {
  rawStorage = null; // プライベートモード等
}

// 認証モジュール（Firebase SDK を CDN から読む）。読み込めなくても画面は出し、ログイン画面でエラーを知らせる。
let authMod = null;
let authLoading = null;
function loadAuth() {
  if (authMod) return Promise.resolve(authMod);
  if (!authLoading) {
    authLoading = import('./auth.js').then(
      (m) => {
        authMod = m;
        return m;
      },
      (e) => {
        authLoading = null; // 次のタップで再試行できるように
        throw e;
      },
    );
  }
  return authLoading;
}

const store = new Store({
  fetchImpl: (...args) => fetch(...args),
  storage: safeStorage(rawStorage),
  getToken: async () => (authMod ? authMod.getToken() : null),
});

let signedIn = false;

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

let lastCharts = null;
let lastWide = null;

// ---------------- テーマ ----------------

function applyTheme(id) {
  const t = findThemeOrDefault(id);
  root.dataset.theme = t.id;
  themeMeta?.setAttribute('content', themeBgColor(t));
}

// ---------------- メイン画面 ----------------

function renderApp() {
  const vp = viewport();
  lastWide = isWide(vp.width, vp.height);
  root.style.setProperty('--hs', pageScale(vp.width, vp.height).toFixed(4));
  // 未ログイン／許可されていないアカウントはゲート画面（ログイン・拒否メッセージ）を出す
  const gate = renderGate(store.state);
  if (gate) {
    appEl.innerHTML = gate;
    lastCharts = null;
    fit();
    return;
  }
  const { html, charts } = renderMain(store.state, vp);
  appEl.innerHTML = html;
  lastCharts = charts;
  fit();
}

/** カードのスケール（--cs）を反映し、チャートを実寸で描く。 */
function fit() {
  const vp = viewport();
  root.style.setProperty('--hs', pageScale(vp.width, vp.height).toFixed(4));

  const cards = appEl.querySelectorAll('[data-card]');
  const scales = {};
  cards.forEach((el) => {
    const cs = cardScale(el.dataset.card, el.offsetWidth, el.offsetHeight);
    scales[el.dataset.card] = cs;
    el.style.setProperty('--cs', cs.toFixed(4));
  });

  if (lastCharts) {
    const weekEl = appEl.querySelector('[data-chart="week"]');
    if (weekEl) {
      weekEl.querySelector(':scope > svg')?.remove();
      const svg = weekChartSvg(
        lastCharts.week.bars,
        lastCharts.week.selectedDate,
        lastCharts.week.limitSumSec,
        weekEl.clientWidth,
        weekEl.clientHeight,
        scales.week ?? 1,
      );
      weekEl.insertAdjacentHTML('afterbegin', svg);
    }
    const hourlyEl = appEl.querySelector('[data-chart="hourly"]');
    if (hourlyEl && lastCharts.hourly) {
      hourlyEl.querySelector(':scope > svg')?.remove();
      const svg = hourlyChartSvg(
        lastCharts.hourly.hours,
        lastCharts.hourly.currentHour,
        hourlyEl.clientWidth,
        hourlyEl.clientHeight,
        scales.hourly ?? 1,
      );
      hourlyEl.insertAdjacentHTML('afterbegin', svg);
    }
  }
  fitOverlay();
}

// ---------------- 設定オーバーレイ ----------------

let wasOverlayOpen = false;

function fitOverlay() {
  if (overlayEl.hidden) return;
  const vp = viewport();
  overlayEl.style.setProperty('--s', overlayScale(vp.width, vp.height).toFixed(4));
}

/** フォーカス中の操作要素を識別する文字列（再描画後に復元する）。 */
function focusSignature() {
  const a = document.activeElement;
  if (!a || !overlayEl.contains(a) || !a.dataset?.action) return null;
  return ['action', 'app', 'dir', 'id'].map((k) => a.dataset[k] ?? '').join('|');
}

function restoreFocus(sig) {
  if (!sig) return;
  const [action, app, dir, id] = sig.split('|');
  for (const el of overlayEl.querySelectorAll('[data-action]')) {
    const d = el.dataset;
    if (d.action === action && (d.app ?? '') === app && (d.dir ?? '') === dir && (d.id ?? '') === id) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

function renderOverlayUi() {
  const open = store.state.showSettings;
  if (!open) {
    overlayEl.hidden = true;
    overlayEl.innerHTML = '';
    document.body.classList.remove('ov-open');
    if (wasOverlayOpen) appEl.querySelector('.gear')?.focus({ preventScroll: true });
    wasOverlayOpen = false;
    return;
  }
  // 再描画でスクロール位置・フォーカスが飛ばないよう退避する
  const scrolls = {};
  overlayEl.querySelectorAll('[data-scroll]').forEach((el) => {
    scrolls[el.dataset.scroll] = el.scrollTop;
  });
  const sig = wasOverlayOpen ? focusSignature() : null;

  overlayEl.hidden = false;
  document.body.classList.add('ov-open');
  overlayEl.innerHTML = renderOverlay(store.state, viewport());
  fitOverlay();

  overlayEl.querySelectorAll('[data-scroll]').forEach((el) => {
    if (scrolls[el.dataset.scroll] !== undefined) el.scrollTop = scrolls[el.dataset.scroll];
  });
  if (!wasOverlayOpen) overlayEl.querySelector('.ov-panel')?.focus({ preventScroll: true });
  else restoreFocus(sig);
  wasOverlayOpen = true;
}

// ---------------- 購読 ----------------

const MAIN_KEYS = ['nowMs', 'data', 'loaded', 'online', 'selection', 'selectedUid', 'themeId', 'pendingSettings', 'status', 'auth'];

store.subscribe((s, p) => {
  if (s.themeId !== p.themeId) applyTheme(s.themeId);
  if (!document.hidden && MAIN_KEYS.some((k) => s[k] !== p[k])) renderApp();
  if (
    s.showSettings !== p.showSettings ||
    s.limitDraft !== p.limitDraft ||
    s.saveStatus !== p.saveStatus ||
    s.themeId !== p.themeId ||
    s.auth !== p.auth
  ) {
    renderOverlayUi();
  }
});

// ---------------- イベント ----------------

document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'open-settings': store.openSettings(); break;
    case 'close-settings': store.closeSettings(); break;
    case 'scrim': if (e.target === el) store.closeSettings(); break; // パネル内のタップでは閉じない
    case 'select-day': store.onSelectDay(d.date); break;
    case 'select-user': store.onSelectUser(d.uid); break;
    case 'step': store.onLimitStep(d.app, d.dir === 'up'); break;
    case 'save': store.saveLimits(); break;
    case 'theme': store.selectTheme(d.id); break;
    case 'sign-in':
      // ポップアップ可否のため、読み込み済みならユーザー操作の同期区間内で呼ぶ
      if (authMod) authMod.signIn();
      else loadAuth().then((m) => m.signIn()).catch(showAuthLoadError);
      break;
    case 'sign-out':
      if (authMod) authMod.signOut();
      break;
    default: break;
  }
});

document.addEventListener('keydown', (e) => {
  if (!store.state.showSettings) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    store.closeSettings();
    return;
  }
  if (e.key === 'Tab') {
    // フォーカスをパネル内に留める
    const items = [...overlayEl.querySelectorAll('button:not([disabled])')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !overlayEl.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !overlayEl.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
});

// iOS: ホーム画面アプリ/タブの復帰は visibilitychange、bfcache復元は pageshow(persisted)
document.addEventListener('visibilitychange', () => {
  if (!signedIn) return;
  if (document.visibilityState === 'visible') store.resume();
  else store.pause();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted && signedIn) store.resume();
});
window.addEventListener('online', () => {
  if (signedIn) store.refresh();
});

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const vp = viewport();
    const wide = isWide(vp.width, vp.height);
    if (wide !== lastWide) {
      renderApp();
      if (store.state.showSettings) renderOverlayUi();
    } else {
      fit();
    }
  });
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// ---------------- 起動 ----------------

function showAuthLoadError() {
  store.setAuthUser(null);
  store.setAuthError('ログイン機能を読み込めませんでした（ネットワークを確認して、もう一度お試しください）');
}

/** ログイン状態の変化: ログイン→取得とポーリング開始 / ログアウト→停止してデータとキャッシュを破棄 */
function onAuthUser(user) {
  const was = signedIn;
  signedIn = !!user;
  store.setAuthUser(user ? { email: user.email || user.displayName || 'アカウント' } : null);
  if (signedIn && !was) {
    store.setAuthError(null);
    store.start();
    if (document.hidden) store.pause();
  } else if (!signedIn && was) {
    store.reset();
  }
}

applyTheme(store.state.themeId);
renderApp(); // 認証状態が確定するまでは「読み込み中…」
loadAuth()
  .then((m) => {
    m.onAuthError((e) => store.setAuthError(e ? loginErrorText(e.code) : null));
    m.onUser(onAuthUser);
  })
  .catch(showAuthLoadError);

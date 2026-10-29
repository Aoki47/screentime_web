// エントリポイント: ストアとDOMをつなぐ（描画・イベント委譲・寸法の反映・ライフサイクル）。

import { renderChart } from './charts.js';
import { demoMode, demoStorage } from './demo.js';
import { KEY_RAW_JSON, Store, safeStorage } from './store.js';
import { findThemeOrDefault, themeBgColor } from './themes.js';
import { captionLimitX, cardScale, isWide, loginErrorText, overlayScale, pageScale, renderGate, renderMain, renderOverlay } from './ui.js';

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

// ローカル確認用デモ（localhost / 127.0.0.1 かつ ?demo=1|under のときだけ。それ以外のホストでは常に null）
const demo = demoMode(window.location);
let demoBackend = null;

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

const baseStorage = safeStorage(rawStorage);
const store = new Store({
  fetchImpl: (...args) => (demoBackend ? demoBackend.fetch(...args) : fetch(...args)),
  storage: demo ? demoStorage(baseStorage, KEY_RAW_JSON) : baseStorage,
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

/** カードのスケール（--cs）を反映し、チャートを実寸で描き、棒の下の文字位置を補正する。 */
function fit() {
  const vp = viewport();
  root.style.setProperty('--hs', pageScale(vp.width, vp.height).toFixed(4));

  const scales = new Map();
  appEl.querySelectorAll('[data-card]').forEach((el) => {
    const cs = cardScale(el.dataset.card, el.offsetWidth, el.offsetHeight);
    scales.set(el, cs);
    el.style.setProperty('--cs', cs.toFixed(4));
  });

  if (lastCharts) {
    appEl.querySelectorAll('[data-chart]').forEach((el) => {
      el.querySelector(':scope > svg')?.remove();
      const svg = renderChart(
        el.dataset.chart,
        lastCharts[el.dataset.chart],
        el.clientWidth,
        el.clientHeight,
        scales.get(el.closest('[data-card]')) ?? 1,
      );
      if (svg) el.insertAdjacentHTML('afterbegin', svg);
    });
  }

  // 合計の棒の下の「上限 …」を、上限線の真下に寄せつつ「合計」文字と重ならないように置く
  appEl.querySelectorAll('.bar-cap').forEach((cap) => {
    const limit = cap.querySelector('.cap-limit');
    const total = cap.querySelector('.cap-total');
    if (!limit || !total) return;
    const cs = scales.get(cap.closest('[data-card]')) ?? 1;
    const x = captionLimitX(Number(limit.dataset.limitPos), cap.clientWidth, limit.offsetWidth, total.offsetWidth, 8 * cs);
    limit.style.transform = 'none';
    limit.style.left = `${x}px`;
  });
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
  return ['action', 'field', 'dir', 'id'].map((k) => a.dataset[k] ?? '').join('|');
}

function restoreFocus(sig) {
  if (!sig) return;
  const [action, field, dir, id] = sig.split('|');
  for (const el of overlayEl.querySelectorAll('[data-action]')) {
    const d = el.dataset;
    if (d.action === action && (d.field ?? '') === field && (d.dir ?? '') === dir && (d.id ?? '') === id) {
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

// ---------------- 全画面パネルと履歴 ----------------
// 「‹ 戻る」ボタンが主な戻り方。加えてブラウザの戻る操作（iPhone のホーム画面アプリのエッジスワイプ等）と Escape でも
// 分割表示へ戻れるよう、全画面に入るときに履歴を1つ積む（戻るボタンは history.back() で積んだ履歴も消費する）。

function expandPanel(panel) {
  if (store.state.expanded === panel) return;
  store.expand(panel);
  try {
    history.pushState({ stPanel: panel }, '');
  } catch { /* 履歴が使えない環境では戻るボタンだけで戻る */ }
}

function collapsePanel() {
  if (store.state.expanded === null) return;
  if (history.state && history.state.stPanel) {
    try {
      history.back(); // popstate で collapse される
      setTimeout(() => store.collapse(), 400); // popstate が来ない環境の保険（collapse は冪等）
      return;
    } catch { /* 下の collapse へ */ }
  }
  store.collapse();
}

window.addEventListener('popstate', () => {
  if (store.state.showSettings) {
    // 設定を開いている間の戻る操作は、まず設定を閉じる（全画面は維持するため履歴を積み直す）
    store.closeSettings();
    if (store.state.expanded !== null) {
      try {
        history.pushState({ stPanel: store.state.expanded }, '');
      } catch { /* 無視 */ }
    }
    return;
  }
  store.collapse();
});

// 再読み込み後は全画面ではないので、残った履歴状態は捨てる
try {
  if (history.state && history.state.stPanel) history.replaceState(null, '');
} catch { /* 無視 */ }

// ---------------- 購読 ----------------

const MAIN_KEYS = ['nowMs', 'data', 'loaded', 'online', 'selection', 'selectedUid', 'themeId', 'pendingSettings', 'pendingPowerSettings', 'expanded', 'status', 'auth'];

store.subscribe((s, p) => {
  if (s.themeId !== p.themeId) applyTheme(s.themeId);
  if (!document.hidden && MAIN_KEYS.some((k) => s[k] !== p[k])) renderApp();
  if (
    s.showSettings !== p.showSettings ||
    s.limitDraft !== p.limitDraft ||
    s.saveStatus !== p.saveStatus ||
    s.powerDraft !== p.powerDraft ||
    s.powerSaveStatus !== p.powerSaveStatus ||
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
    case 'expand': expandPanel(d.panel); break;
    case 'collapse': collapsePanel(); break;
    case 'select-day': store.onSelectDay(d.date); break;
    case 'select-user': store.onSelectUser(d.uid); break;
    case 'step': store.onLimitStep(d.dir === 'up'); break;
    case 'save': store.saveLimits(); break;
    case 'power-step': store.onPowerStep(d.field, d.dir === 'up'); break;
    case 'power-save': store.savePowerSettings(); break;
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
  if (store.state.showSettings) {
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
    return;
  }
  if (e.key === 'Escape' && store.state.expanded !== null) {
    e.preventDefault();
    collapsePanel();
    return;
  }
  // 分割表示のカード（role="button"）は Enter / Space でも開く
  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element) {
    const el = e.target.closest('[role="button"][data-action]');
    if (el) {
      e.preventDefault();
      el.click();
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

/** デモ起動: 認証を使わず、同梱のデモデータ（demo-data.js）で動かす。ネットワークには出ない。 */
function startDemo(mode) {
  import('./demo-data.js').then((m) => {
    demoBackend = m.createDemoBackend(mode);
    const flag = document.createElement('div');
    flag.className = 'demo-flag';
    flag.textContent = `デモデータ（${mode === 'under' ? '上限以内' : '上限超過'}）`;
    document.body.appendChild(flag);
    onAuthUser({ email: 'デモ' });
  });
}

applyTheme(store.state.themeId);
renderApp(); // 認証状態が確定するまでは「読み込み中…」
if (demo) {
  startDemo(demo);
} else {
  loadAuth()
    .then((m) => {
      m.onAuthError((e) => store.setAuthError(e ? loginErrorText(e.code) : null));
      m.onUser(onAuthUser);
    })
    .catch(showAuthLoadError);
}

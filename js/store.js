// アプリの状態管理（Android版 MainViewModel + ScreenTimeRepository + ThemeRepository の移植）。
// DOMには触れない。fetch / localStorage / 時計 / タイマー / ID トークン取得は注入できるので Node でテストできる。

import { FETCH_TIMEOUT_MS, POLL_INTERVAL_MS, powerSettingsUrl, requestUrl, settingsUrl } from './config.js';
import {
  Selection,
  SELECTION_TIMEOUT_MS,
  clampLimit,
  effectiveTotalLimitMinOf,
  isReflected,
  localIsoDate,
  patchBody,
  stepDown,
  stepUp,
} from './logic.js';
import { emptyPower, parse } from './parser.js';
import * as Power from './power.js';
import { findThemeOrDefault } from './themes.js';

export const KEY_RAW_JSON = 'screentime_raw_json';
export const KEY_THEME_ID = 'theme_id';

/** state.status の値。通常は 'ok'、RTDB が 401/403 を返したら 'auth-error'（このアカウントは許可されていない）。 */
export const STATUS_OK = 'ok';
export const STATUS_AUTH_ERROR = 'auth-error';

/** HTTP ステータスが認証・認可エラー（トークン無効 / ルールで拒否）か。 */
export function isAuthStatus(status) {
  return status === 401 || status === 403;
}

/** 表示対象のユーザー（selectedUid → 無ければ先頭）。楽観更新した設定を重ねた実効データ。 */
export function currentUser(state) {
  const users = state.data?.users ?? [];
  const u = users.find((x) => x.uid === state.selectedUid) ?? users[0];
  if (!u) return null;
  const pending = state.pendingSettings[u.uid];
  return pending ? { ...u, settings: pending } : u;
}

/**
 * 電力データ。楽観更新した電力設定を重ねた実効データ（無ければ null）。
 * Android の ScreenTimeUiState.power。
 */
export function effectivePower(state) {
  const p = state.data?.power ?? null;
  const pending = state.pendingPowerSettings;
  if (!pending) return p;
  return { ...(p ?? emptyPower()), settings: pending };
}

/** localStorage 互換のストレージを例外安全に包む（プライベートモード等で投げても無視）。 */
export function safeStorage(raw) {
  return {
    get(key) {
      try { return raw ? raw.getItem(key) : null; } catch { return null; }
    },
    set(key, value) {
      try { raw?.setItem(key, value); } catch { /* 無視 */ }
    },
    remove(key) {
      try { raw?.removeItem(key); } catch { /* 無視 */ }
    },
  };
}

export class Store {
  /**
   * @param {object} deps
   * @param {typeof fetch} deps.fetchImpl
   * @param {{get(k:string):string|null,set(k:string,v:string):void}} deps.storage
   * @param {()=>number} [deps.nowMs]
   * @param {{setTimeout:Function,clearTimeout:Function}} [deps.timers]
   * @param {()=>Promise<string|null>} [deps.getToken] Firebase ID トークンの取得（未ログイン/不要なら null → `?auth` を付けない）
   */
  constructor({ fetchImpl, storage, nowMs = () => Date.now(), getToken = async () => null, timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) } }) {
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.nowMs = nowMs;
    this.getToken = getToken;
    this.timers = timers;
    this.listeners = new Set();

    const now = nowMs();
    this.state = {
      nowMs: now,
      data: null,          // null=まだ何も取得できていない
      loaded: false,       // 初回の取得試行が完了したか
      status: STATUS_OK,   // ok | auth-error（RTDB が 401/403。許可されていないアカウント）
      auth: { ready: false, email: null, error: null }, // Google ログイン状態（main.js が反映）。ready=状態確定済み
      online: true,        // 直近の通信が成功したか。falseならキャッシュ表示で「オフライン」
      isRefreshing: false,
      selection: Selection.initial(localIsoDate(now)),
      selectedUid: null,
      // 起動時に同期復元（フラッシュ防止）
      themeId: findThemeOrDefault(storage.get(KEY_THEME_ID)).id,
      showSettings: false,
      limitDraft: null,    // {uid,name,totalMin} 合計の上限の下書き
      saveStatus: 'idle',  // idle | saving | saved | failed
      pendingSettings: {}, // uid → {limitYoutubeMin:null, limitRobloxMin:null, limitTotalMin, updatedAt}
      expanded: null,      // 全画面で開いているパネル（'power' | 'usage'）。null = 分割表示（電力＋使用量）
      powerDraft: null,    // {warnW, yenPerKwh} 電力設定の下書き
      powerSaveStatus: 'idle', // idle | saving | saved | failed
      pendingPowerSettings: null, // 保存済み(楽観更新)の電力設定 {warnW, yenPerKwh, updatedAt}
    };

    this.clockTimer = null;
    this.pollTimer = null;
    this.revertTimer = null;
    this.statusTimer = null;
    this.powerStatusTimer = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** state を部分更新して購読者へ通知する。 */
  set(patch) {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const fn of this.listeners) fn(this.state, prev);
  }

  // ---------------- ライフサイクル ----------------

  /** 起動時: 時計を開始し、即時取得＋ポーリング開始。 */
  start() {
    this.startClock();
    this.resume();
  }

  /** ログイン状態を反映する。user は { email } かログアウト中の null。 */
  setAuthUser(user) {
    this.set({ auth: { ready: true, email: user?.email ?? null, error: this.state.auth.error } });
  }

  /** ログイン処理のエラー（表示用の文言）。null で消す。 */
  setAuthError(message) {
    this.set({ auth: { ...this.state.auth, error: message ?? null } });
  }

  /** ログアウト時: 通信とタイマーを止め、取得済みデータとキャッシュを破棄する（別アカウントに見せない）。 */
  reset() {
    this.stop();
    this.storage.remove?.(KEY_RAW_JSON);
    this.set({
      data: null,
      loaded: false,
      online: true,
      status: STATUS_OK,
      showSettings: false,
      limitDraft: null,
      saveStatus: 'idle',
      pendingSettings: {},
      expanded: null,
      powerDraft: null,
      powerSaveStatus: 'idle',
      pendingPowerSettings: null,
    });
  }

  /** 時計とポーリングを止める。 */
  stop() {
    this.pause();
    if (this.clockTimer !== null) this.timers.clearTimeout(this.clockTimer);
    this.clockTimer = null;
  }

  /** 前面に戻った（visibilitychange→visible / pageshow）: 即時再取得＋ポーリング再開 */
  resume() {
    this.tickSelection();
    this.refresh();
    this.startPolling();
  }

  /** 背面に回った: ポーリング停止（前面時のみ通信する） */
  pause() {
    if (this.pollTimer !== null) this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** 1分刻みの時計。分の頭に揃えて更新する（0:00跨ぎの日付更新・「いま使用中」の鮮度判定にも使う）。 */
  startClock() {
    if (this.clockTimer !== null) this.timers.clearTimeout(this.clockTimer);
    const loop = () => {
      const now = this.nowMs();
      this.set({ nowMs: now, selection: this.ticked(this.state.selection, now) });
      this.clockTimer = this.timers.setTimeout(loop, 60_000 - (this.nowMs() % 60_000) + 50);
    };
    loop();
  }

  startPolling() {
    this.pause();
    const loop = () => {
      this.pollTimer = this.timers.setTimeout(() => {
        this.refresh();
        loop();
      }, POLL_INTERVAL_MS);
    };
    loop();
  }

  // ---------------- 選択 ----------------

  ticked(selection, nowMs = this.nowMs()) {
    return Selection.onTick(selection, localIsoDate(nowMs), nowMs);
  }

  tickSelection() {
    const now = this.nowMs();
    this.set({ nowMs: now, selection: this.ticked(this.state.selection, now) });
  }

  /** 週グラフの日をタップ。60秒操作がなければ今日に戻す。 */
  onSelectDay(date) {
    const now = this.nowMs();
    const base = Selection.onTick(this.state.selection, localIsoDate(now), now);
    this.set({ nowMs: now, selection: Selection.onTap(base, date, now) });
    if (this.revertTimer !== null) this.timers.clearTimeout(this.revertTimer);
    this.revertTimer = this.timers.setTimeout(() => this.tickSelection(), SELECTION_TIMEOUT_MS + 100);
  }

  /** ヘッダーの名前チップでユーザー切替（選択中の日は維持）。 */
  onSelectUser(uid) {
    this.set({ selectedUid: uid });
  }

  // ---------------- 設定オーバーレイ ----------------

  /** パネルを全画面で開く（'power' | 'usage'）。 */
  expand(panel) {
    this.set({ expanded: panel });
  }

  /** 全画面から分割表示へ戻る。 */
  collapse() {
    if (this.state.expanded !== null) this.set({ expanded: null });
  }

  /**
   * 設定オーバーレイを開く。合計の上限の下書きは現在の実効値（settings.limitTotalMin → 無ければ個別の和）、
   * 電力設定の下書きは現在の実効設定で初期化する。
   */
  openSettings() {
    const u = currentUser(this.state);
    this.set({
      showSettings: true,
      saveStatus: 'idle',
      powerSaveStatus: 'idle',
      powerDraft: Power.draftFrom(effectivePower(this.state)?.settings),
      limitDraft: u
        ? { uid: u.uid, name: u.displayName, totalMin: clampLimit(effectiveTotalLimitMinOf(u) ?? 0) }
        : null,
    });
  }

  /** 設定オーバーレイを閉じる。未保存の編集は破棄する。 */
  closeSettings() {
    if (this.statusTimer !== null) this.timers.clearTimeout(this.statusTimer);
    if (this.powerStatusTimer !== null) this.timers.clearTimeout(this.powerStatusTimer);
    this.set({
      showSettings: false,
      limitDraft: null,
      saveStatus: this.state.saveStatus === 'saving' ? 'saving' : 'idle',
      powerDraft: null,
      powerSaveStatus: this.state.powerSaveStatus === 'saving' ? 'saving' : 'idle',
    });
  }

  /** ステッパー操作。合計の上限の下書き値を15分刻みで増減（0..600分）。 */
  onLimitStep(up) {
    const d = this.state.limitDraft;
    if (!d) return;
    const totalMin = up ? stepUp(d.totalMin) : stepDown(d.totalMin);
    // 編集を再開したら「保存しました/失敗」の表示は消す
    this.set({ limitDraft: { ...d, totalMin }, saveStatus: this.state.saveStatus === 'saving' ? 'saving' : 'idle' });
  }

  /**
   * 下書きの合計の上限を保存する。表示は即時（楽観更新）に反映し、PATCHが失敗したら元に戻して
   * インラインで知らせる。成功したらサーバーの値を再取得する。
   * @returns {Promise<boolean|undefined>} 保存結果（実行しなかった場合は undefined）
   */
  async saveLimits() {
    const draft = this.state.limitDraft;
    if (!draft || this.state.saveStatus === 'saving') return undefined;
    const total = clampLimit(draft.totalMin);
    const nowSec = Math.floor(this.nowMs() / 1000);
    const previous = this.state.pendingSettings[draft.uid];
    if (this.statusTimer !== null) this.timers.clearTimeout(this.statusTimer);
    this.set({
      saveStatus: 'saving',
      pendingSettings: {
        ...this.state.pendingSettings,
        [draft.uid]: { limitYoutubeMin: null, limitRobloxMin: null, limitTotalMin: total, updatedAt: nowSec },
      },
    });

    const ok = await this.saveSettings(draft.uid, total, nowSec);

    if (ok) {
      this.set({ saveStatus: 'saved' });
    } else {
      // 元に戻す（以前の楽観値があればそれ、無ければ取得データの値）
      const reverted = { ...this.state.pendingSettings };
      if (previous) reverted[draft.uid] = previous;
      else delete reverted[draft.uid];
      this.set({ saveStatus: 'failed', pendingSettings: reverted });
    }
    this.statusTimer = this.timers.setTimeout(() => {
      if (this.state.saveStatus !== 'saving') this.set({ saveStatus: 'idle' });
    }, ok ? 3_000 : 4_000);

    if (ok) {
      // 取得中の古い応答に上書きされないよう、取得が終わってから再取得する
      while (this.state.isRefreshing) await new Promise((r) => this.timers.setTimeout(r, 100));
      await this.refresh();
    }
    return ok;
  }

  /** 電力設定のステッパー。field('warn'|'yen') の下書き値を増減（警告=500W刻み 1000..8000、単価=1円刻み 10..80）。 */
  onPowerStep(field, up) {
    const d = this.state.powerDraft;
    if (!d) return;
    const next =
      field === 'warn'
        ? { ...d, warnW: up ? Power.stepWarnUp(d.warnW) : Power.stepWarnDown(d.warnW) }
        : { ...d, yenPerKwh: up ? Power.stepYenUp(d.yenPerKwh) : Power.stepYenDown(d.yenPerKwh) };
    this.set({
      powerDraft: next,
      powerSaveStatus: this.state.powerSaveStatus === 'saving' ? 'saving' : 'idle',
    });
  }

  /**
   * 電力設定の下書きを保存する。上限の保存と同じく楽観更新し、PATCHが失敗したら元に戻す。
   * 成功したらサーバーの値を再取得する。
   * @returns {Promise<boolean|undefined>} 保存結果（実行しなかった場合は undefined）
   */
  async savePowerSettings() {
    const draft = this.state.powerDraft;
    if (!draft || this.state.powerSaveStatus === 'saving') return undefined;
    const warn = Power.clampWarn(draft.warnW);
    const yen = Power.clampYen(draft.yenPerKwh);
    const nowSec = Math.floor(this.nowMs() / 1000);
    const previous = this.state.pendingPowerSettings;
    if (this.powerStatusTimer !== null) this.timers.clearTimeout(this.powerStatusTimer);
    this.set({
      powerSaveStatus: 'saving',
      pendingPowerSettings: { warnW: warn, yenPerKwh: yen, updatedAt: nowSec },
    });

    const ok = await this.savePowerSettingsRemote(warn, yen, nowSec);

    if (ok) this.set({ powerSaveStatus: 'saved' });
    else this.set({ powerSaveStatus: 'failed', pendingPowerSettings: previous });
    this.powerStatusTimer = this.timers.setTimeout(() => {
      if (this.state.powerSaveStatus !== 'saving') this.set({ powerSaveStatus: 'idle' });
    }, ok ? 3_000 : 4_000);

    if (ok) {
      while (this.state.isRefreshing) await new Promise((r) => this.timers.setTimeout(r, 100));
      await this.refresh();
    }
    return ok;
  }

  /** テーマを即時反映し、IDを保存する（オーバーレイは開いたまま。閉じるのはユーザー操作）。 */
  selectTheme(id) {
    const theme = findThemeOrDefault(id);
    this.storage.set(KEY_THEME_ID, theme.id);
    this.set({ themeId: theme.id });
  }

  // ---------------- 通信 ----------------

  async withTimeout(run) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = this.timers.setTimeout(() => ctrl?.abort(), FETCH_TIMEOUT_MS);
    try {
      return await run(ctrl?.signal);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  /** ID トークンを取得する。失敗は null（= `?auth` なしで試す。拒否されれば 401/403 として扱われる）。 */
  async token() {
    try {
      return (await this.getToken()) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * RTDB取得。失敗時は最終成功データ（生JSON）にフォールバック。
   * HTTP 401/403 は authError=true（通信不良ではなく「許可されていない」）。
   */
  async fetchData() {
    try {
      const token = await this.token();
      const body = await this.withTimeout(async (signal) => {
        const res = await this.fetchImpl(requestUrl(token), { method: 'GET', cache: 'no-store', signal });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return res.text();
      });
      this.storage.set(KEY_RAW_JSON, body);
      return { data: parse(body), online: true, authError: false };
    } catch (e) {
      const authError = isAuthStatus(e?.status);
      const cached = this.storage.get(KEY_RAW_JSON);
      return { data: cached !== null ? parse(cached) : null, online: false, authError };
    }
  }

  /** PATCH を送る。成功(2xx)なら true。401/403 は認証エラー状態にする。 */
  async patchJson(url, body) {
    try {
      return await this.withTimeout(async (signal) => {
        const res = await this.fetchImpl(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        });
        if (isAuthStatus(res.status)) this.set({ status: STATUS_AUTH_ERROR });
        return res.ok;
      });
    } catch {
      return false;
    }
  }

  /** 合計の上限を `PATCH /screentime/users/{uid}/settings.json` で書き込む（`{limitTotalMin, updatedAt}` のみ）。成功(2xx)なら true。 */
  async saveSettings(uid, totalMin, updatedAtSec) {
    try {
      const url = settingsUrl(uid, await this.token());
      if (!url) return false;
      return await this.patchJson(url, patchBody(totalMin, updatedAtSec));
    } catch {
      return false;
    }
  }

  /** 電力設定を `PATCH /screentime/power/settings.json` で書き込む。成功(2xx)なら true。 */
  async savePowerSettingsRemote(warn, yen, updatedAtSec) {
    try {
      const url = powerSettingsUrl(await this.token());
      return await this.patchJson(url, Power.patchBody(warn, yen, updatedAtSec));
    } catch {
      return false;
    }
  }

  /** 取得データに反映済みの楽観更新を捨てる（以降は取得データが正）。 */
  reconcilePending(pending, data) {
    if (!data || Object.keys(pending).length === 0) return pending;
    const out = {};
    for (const [uid, p] of Object.entries(pending)) {
      const fetched = data.users.find((u) => u.uid === uid)?.settings;
      if (!isReflected(fetched, p)) out[uid] = p;
    }
    return out;
  }

  /** RTDB再取得。取得中の重複呼び出しは無視する。 */
  async refresh() {
    if (this.state.isRefreshing) return;
    this.set({ isRefreshing: true });
    try {
      const result = await this.fetchData();
      const now = this.nowMs();
      const s = this.state;
      this.set({
        nowMs: now,
        selection: this.ticked(s.selection, now),
        // 失敗かつキャッシュ無しの場合でも、以前の表示データがあれば維持する
        data: result.data ?? s.data,
        loaded: true,
        status: result.authError ? STATUS_AUTH_ERROR : STATUS_OK,
        online: result.online,
        pendingSettings: result.online ? this.reconcilePending(s.pendingSettings, result.data) : s.pendingSettings,
        pendingPowerSettings:
          s.pendingPowerSettings && !(result.online && Power.isReflected(result.data?.power?.settings, s.pendingPowerSettings))
            ? s.pendingPowerSettings
            : null,
      });
    } finally {
      this.set({ isRefreshing: false });
    }
  }
}


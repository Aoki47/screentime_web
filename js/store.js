// アプリの状態管理（Android版 MainViewModel + ScreenTimeRepository + ThemeRepository の移植）。
// DOMには触れない。fetch / localStorage / 時計 / タイマーは注入できるので Node でテストできる。

import { FETCH_TIMEOUT_MS, POLL_INTERVAL_MS, requestUrl, settingsUrl } from './config.js';
import {
  Selection,
  SELECTION_TIMEOUT_MS,
  clampLimit,
  effectiveRobloxLimitMin,
  effectiveYoutubeLimitMin,
  isReflected,
  localIsoDate,
  patchBody,
  stepDown,
  stepUp,
} from './logic.js';
import { parse } from './parser.js';
import { findThemeOrDefault } from './themes.js';

export const KEY_RAW_JSON = 'screentime_raw_json';
export const KEY_THEME_ID = 'theme_id';

/** 表示対象のユーザー（selectedUid → 無ければ先頭）。楽観更新した設定を重ねた実効データ。 */
export function currentUser(state) {
  const users = state.data?.users ?? [];
  const u = users.find((x) => x.uid === state.selectedUid) ?? users[0];
  if (!u) return null;
  const pending = state.pendingSettings[u.uid];
  return pending ? { ...u, settings: pending } : u;
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
  };
}

export class Store {
  /**
   * @param {object} deps
   * @param {typeof fetch} deps.fetchImpl
   * @param {{get(k:string):string|null,set(k:string,v:string):void}} deps.storage
   * @param {()=>number} [deps.nowMs]
   * @param {{setTimeout:Function,clearTimeout:Function}} [deps.timers]
   */
  constructor({ fetchImpl, storage, nowMs = () => Date.now(), timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) } }) {
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.nowMs = nowMs;
    this.timers = timers;
    this.listeners = new Set();

    const now = nowMs();
    this.state = {
      nowMs: now,
      data: null,          // null=まだ何も取得できていない
      loaded: false,       // 初回の取得試行が完了したか
      online: true,        // 直近の通信が成功したか。falseならキャッシュ表示で「オフライン」
      isRefreshing: false,
      selection: Selection.initial(localIsoDate(now)),
      selectedUid: null,
      // 起動時に同期復元（フラッシュ防止）
      themeId: findThemeOrDefault(storage.get(KEY_THEME_ID)).id,
      showSettings: false,
      limitDraft: null,    // {uid,name,youtubeMin,robloxMin}
      saveStatus: 'idle',  // idle | saving | saved | failed
      pendingSettings: {}, // uid → {limitYoutubeMin, limitRobloxMin, updatedAt}
    };

    this.clockTimer = null;
    this.pollTimer = null;
    this.revertTimer = null;
    this.statusTimer = null;
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

  /** 設定オーバーレイを開く。上限の下書きは現在の実効値（settings > profile）で初期化する。 */
  openSettings() {
    const u = currentUser(this.state);
    this.set({
      showSettings: true,
      saveStatus: 'idle',
      limitDraft: u
        ? {
            uid: u.uid,
            name: u.displayName,
            youtubeMin: effectiveYoutubeLimitMin(u) ?? 0,
            robloxMin: effectiveRobloxLimitMin(u) ?? 0,
          }
        : null,
    });
  }

  /** 設定オーバーレイを閉じる。未保存の編集は破棄する。 */
  closeSettings() {
    if (this.statusTimer !== null) this.timers.clearTimeout(this.statusTimer);
    this.set({
      showSettings: false,
      limitDraft: null,
      saveStatus: this.state.saveStatus === 'saving' ? 'saving' : 'idle',
    });
  }

  /** ステッパー操作。app('youtube'|'roblox') の下書き値を15分刻みで増減（0..480分）。 */
  onLimitStep(app, up) {
    const d = this.state.limitDraft;
    if (!d) return;
    const step = (v) => (up ? stepUp(v) : stepDown(v));
    const next = app === 'youtube' ? { ...d, youtubeMin: step(d.youtubeMin) } : { ...d, robloxMin: step(d.robloxMin) };
    // 編集を再開したら「保存しました/失敗」の表示は消す
    this.set({ limitDraft: next, saveStatus: this.state.saveStatus === 'saving' ? 'saving' : 'idle' });
  }

  /**
   * 下書きの上限を保存する。表示は即時（楽観更新）に反映し、PATCHが失敗したら元に戻して
   * インラインで知らせる。成功したらサーバーの値を再取得する。
   * @returns {Promise<boolean|undefined>} 保存結果（実行しなかった場合は undefined）
   */
  async saveLimits() {
    const draft = this.state.limitDraft;
    if (!draft || this.state.saveStatus === 'saving') return undefined;
    const yt = clampLimit(draft.youtubeMin);
    const rb = clampLimit(draft.robloxMin);
    const nowSec = Math.floor(this.nowMs() / 1000);
    const previous = this.state.pendingSettings[draft.uid];
    if (this.statusTimer !== null) this.timers.clearTimeout(this.statusTimer);
    this.set({
      saveStatus: 'saving',
      pendingSettings: {
        ...this.state.pendingSettings,
        [draft.uid]: { limitYoutubeMin: yt, limitRobloxMin: rb, updatedAt: nowSec },
      },
    });

    const ok = await this.saveSettings(draft.uid, yt, rb, nowSec);

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

  /** RTDB取得。失敗時は最終成功データ（生JSON）にフォールバック。 */
  async fetchData() {
    try {
      const body = await this.withTimeout(async (signal) => {
        const res = await this.fetchImpl(requestUrl(), { method: 'GET', cache: 'no-store', signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      });
      this.storage.set(KEY_RAW_JSON, body);
      return { data: parse(body), online: true };
    } catch {
      const cached = this.storage.get(KEY_RAW_JSON);
      return { data: cached !== null ? parse(cached) : null, online: false };
    }
  }

  /** 上限設定を `PATCH /screentime/users/{uid}/settings.json` で書き込む。成功(2xx)なら true。 */
  async saveSettings(uid, youtubeMin, robloxMin, updatedAtSec) {
    try {
      const url = settingsUrl(uid);
      if (!url) return false;
      return await this.withTimeout(async (signal) => {
        const res = await this.fetchImpl(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: patchBody(youtubeMin, robloxMin, updatedAtSec),
          signal,
        });
        return res.ok;
      });
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
        online: result.online,
        pendingSettings: result.online ? this.reconcilePending(s.pendingSettings, result.data) : s.pendingSettings,
      });
    } finally {
      this.set({ isRefreshing: false });
    }
  }
}


// Firebase Authentication（Google ログイン）。ブラウザ専用（CDN から読み込むので Node のテストには含めない）。
// 取得した ID トークンは RTDB REST の `?auth=` に付ける（store.js へ getToken を注入）。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

/** ポップアップが使えない環境ではリダイレクト方式に切り替えるエラーコード */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-environment',
  'auth/web-storage-unsupported',
]);
/** ユーザーが自分で閉じた等、エラー扱いにしないコード */
const IGNORED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

/** 直近のログイン関連エラー（画面表示用）。無ければ null。 */
let lastError = null;
const errorListeners = new Set();
function setError(e) {
  lastError = e ?? null;
  for (const fn of errorListeners) fn(lastError);
}

// リダイレクト方式から戻ってきたときの結果／エラーを回収する（成功時のユーザーは onAuthStateChanged に流れる）
getRedirectResult(auth).catch((e) => {
  if (!IGNORED_CODES.has(e?.code)) setError(e);
});

/**
 * ログイン状態の購読。cb(user|null) は初回の状態確定時から呼ばれる。
 * @returns {() => void} 購読解除
 */
export function onUser(cb) {
  return onAuthStateChanged(auth, (user) => cb(user ?? null));
}

/** ログイン関連エラーの購読（getRedirectResult / signIn 失敗）。cb(error|null)。 */
export function onAuthError(cb) {
  errorListeners.add(cb);
  if (lastError) cb(lastError);
  return () => errorListeners.delete(cb);
}

/** Google でログイン。ポップアップ不可の環境ではリダイレクトにフォールバックする。 */
export async function signIn() {
  setError(null);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = e?.code;
    if (IGNORED_CODES.has(code)) return;
    if (REDIRECT_FALLBACK_CODES.has(code)) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (e2) {
        if (!IGNORED_CODES.has(e2?.code)) setError(e2);
      }
      return;
    }
    setError(e);
  }
}

export async function signOut() {
  await fbSignOut(auth);
}

/** 有効な ID トークン（期限が近ければ SDK が自動更新）。未ログインなら null。 */
export async function getToken() {
  const user = auth.currentUser;
  return user ? user.getIdToken() : null;
}

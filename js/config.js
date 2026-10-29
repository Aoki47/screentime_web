// 接続設定（Android版 ScreenTimeConfig.kt と同じ）。DOMには触れない。
// 認証トークンはここに持たない（公開サイトに静的トークンを置かない）。Google ログインで得た ID トークンを引数で渡す。

/** RTDBのベースURL（末尾スラッシュなし） */
export const BASE_URL = 'https://homecal-49c87-default-rtdb.asia-southeast1.firebasedatabase.app';

/** データが格納されているノードパス */
export const NODE_PATH = 'screentime';

/** ポーリング間隔（ミリ秒） */
export const POLL_INTERVAL_MS = 60 * 1000;

/** 通信タイムアウト（ミリ秒） */
export const FETCH_TIMEOUT_MS = 10 * 1000;

/** 取得URLを組み立てる純粋関数。 */
export function buildUrl(baseUrl, nodePath, authToken) {
  const base = baseUrl.replace(/\/+$/, '');
  const path = nodePath.replace(/^\/+|\/+$/g, '');
  const resource = path === '' ? '/.json' : `/${path}.json`;
  const query = !authToken || authToken.trim() === '' ? '' : `?auth=${encodeURIComponent(authToken)}`;
  return `${base}${resource}${query}`;
}

/** `{BASE_URL}/screentime.json[?auth=token]`。token が null/空なら `?auth` を付けない。 */
export function requestUrl(token) {
  return buildUrl(BASE_URL, NODE_PATH, token);
}

const UID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;

/** 上限設定の書き込みURL `{BASE_URL}/screentime/users/{uid}/settings.json`。uid が不正なら null。 */
export function settingsUrl(uid, token) {
  return UID_REGEX.test(uid) ? buildUrl(BASE_URL, `${NODE_PATH}/users/${uid}/settings`, token) : null;
}

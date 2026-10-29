// ローカル確認用デモモードの判定（DOM 非依存の純粋ロジック）。
// ページが localhost / 127.0.0.1 から配信され、かつ URL に ?demo=1（または ?demo=under）があるときだけ有効。
// それ以外のホスト（公開サイトを含む）では常に null を返し、デモ用データ（demo-data.js）は読み込まれない。

/** デモを許可するホスト名（完全一致のみ）。 */
export const DEMO_HOSTS = Object.freeze(['localhost', '127.0.0.1']);

/**
 * @param {{hostname?:string, search?:string}} loc `window.location` 相当
 * @returns {'over'|'under'|null} 'over'=上限超過の例（?demo=1）、'under'=上限以内の例（?demo=under）、無効なら null
 */
export function demoMode(loc) {
  if (!loc || !DEMO_HOSTS.includes(loc.hostname)) return null;
  const v = new URLSearchParams(loc.search ?? '').get('demo');
  if (v === '1') return 'over';
  if (v === 'under') return 'under';
  return null;
}

/**
 * デモ中は取得データのキャッシュ（生JSON）を localStorage に書かない（本物のキャッシュを汚さない）。
 * それ以外のキー（テーマなど）は元のストレージへ。
 */
export function demoStorage(base, rawKey) {
  let rawJson = null;
  return {
    get: (k) => (k === rawKey ? rawJson : base.get(k)),
    set(k, v) {
      if (k === rawKey) rawJson = v;
      else base.set(k, v);
    },
    remove(k) {
      if (k === rawKey) rawJson = null;
      else base.remove?.(k);
    },
  };
}

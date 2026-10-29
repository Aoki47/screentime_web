// 顔アイコンの SVG 文字列生成（Android版 ui/Faces.kt の移植）。絵文字・画像アセットは使わない。
// 座標は Android の「サイズ s の正方形に対する割合」を 100 倍した viewBox 0 0 100 100 で描く。
// 色は css/style.css の .f-body / .f-ink / .f-sweat クラス（テーマの faceBody / faceInk / faceSweat）。
// DOMには触れない（文字列を返すだけ）。

const f = (n) => Math.round(n * 100) / 100;

const wrap = (inner) =>
  `<svg class="face" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${inner}</svg>`;

/**
 * にっこり顔。neutral=true は口がまっすぐな「ふつう」の顔（注意の段階で使う）。false は笑顔。
 */
export function smileFaceSvg(neutral = false) {
  const mouth = neutral ? 'M34 68L66 68' : 'M28 60Q50 86 72 60';
  return wrap(
    '<circle class="f-body" cx="50" cy="50" r="48"/>' +
      '<circle class="f-ink-fill" cx="34" cy="42" r="6.5"/>' +
      '<circle class="f-ink-fill" cx="66" cy="42" r="6.5"/>' +
      `<path class="f-ink" d="${mouth}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  );
}

/** しずく形（上が尖り下が丸い）のパス。Android の drawSweatDrop と同じ制御点。 */
export function sweatDropPath(cx, top, w, h) {
  const r = w / 2;
  const cy = top + h - r;
  const p = (x, y) => `${f(x)} ${f(y)}`;
  return (
    `M${p(cx, top)}` +
    `C${p(cx + r * 0.25, top + h * 0.28)} ${p(cx + r, cy - r * 0.55)} ${p(cx + r, cy)}` +
    `C${p(cx + r, cy + r * 0.56)} ${p(cx + r * 0.55, cy + r)} ${p(cx, cy + r)}` +
    `C${p(cx - r * 0.55, cy + r)} ${p(cx - r, cy + r * 0.56)} ${p(cx - r, cy)}` +
    `C${p(cx - r, cy - r * 0.55)} ${p(cx - r * 0.25, top + h * 0.28)} ${p(cx, top)}Z`
  );
}

/**
 * 「やっちまった」顔: 黄色い顔・`> <` の目・小さく開いた口・右上の青い汗のしずく。
 * 顔は汗のぶん少し左下寄せ・小さめ。
 */
export function oopsFaceSvg() {
  const strokeAttrs = 'stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  return wrap(
    '<circle class="f-body" cx="46" cy="55" r="42"/>' +
      `<path class="f-ink" d="M20 38L38 49L20 60" ${strokeAttrs}/>` +
      `<path class="f-ink" d="M72 38L54 49L72 60" ${strokeAttrs}/>` +
      '<ellipse class="f-ink-fill" cx="46" cy="77" rx="8.5" ry="7"/>' +
      `<path class="f-sweat" d="${sweatDropPath(85, 4, 17, 27)}"/>`,
  );
}

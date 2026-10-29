// 10テーマのカタログ（Android版 ScreenTimeTheme.kt と同じID・名前・順序・色）と色ユーティリティ。
// DOMには触れない純粋モジュール（Nodeでテスト可能）。
// 色は "#RRGGBB"（不透明）または "#RRGGBBAA"（半透明）の文字列で持つ。

// ---------- 色ユーティリティ ----------

/** "#RRGGBB" / "#RRGGBBAA" → {r,g,b,a}（すべて 0..1） */
export function parseColor(hex) {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) throw new Error(`bad color: ${hex}`);
  const v = parseInt(m[1], 16);
  return {
    r: ((v >> 16) & 255) / 255,
    g: ((v >> 8) & 255) / 255,
    b: (v & 255) / 255,
    a: m[2] ? parseInt(m[2], 16) / 255 : 1,
  };
}

function toHex2(x) {
  const n = Math.max(0, Math.min(255, Math.round(x * 255)));
  return n.toString(16).padStart(2, '0').toUpperCase();
}

/** {r,g,b,a} → "#RRGGBB"（a==1）または "#RRGGBBAA" */
export function formatColor(c) {
  const base = `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}`;
  return c.a >= 1 ? base : base + toHex2(c.a);
}

/** sRGBの相対輝度(0..1) */
export function relativeLuminance(hex) {
  const c = typeof hex === 'string' ? parseColor(hex) : hex;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAGコントラスト比 */
export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 半透明の fg を不透明な bg の上に重ねた見た目の色（不透明の16進） */
export function overOpaque(fg, bg) {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const a = f.a;
  return formatColor({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
    a: 1,
  });
}

/** a→b の線形補間（t=0 で a、t=1 で b） */
export function lerpColor(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  return formatColor({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
    a: x.a + (y.a - x.a) * t,
  });
}

/** HSVの色相(度, 0..360)。無彩色は0。 */
export function hue(hex) {
  const c = parseColor(hex);
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h;
  if (max === c.r) h = (((c.g - c.b) / d) % 6) * 60;
  else if (max === c.g) h = ((c.b - c.r) / d + 2) * 60;
  else h = ((c.r - c.g) / d + 4) * 60;
  return h < 0 ? h + 360 : h;
}

/** アクセント色の上に載せる文字色: 白と濃色のうちコントラストが高い方。 */
export function onAccent(accent) {
  return contrastRatio('#FFFFFF', accent) >= contrastRatio('#111111', accent) ? '#FFFFFF' : '#111111';
}

// ---------- テーマ定義 ----------

const rgb = (v) => '#' + v.toString(16).padStart(6, '0').toUpperCase();
/** rgb(0xRRGGBB) に不透明度（0..1）を付ける。アルファは Android と同じく 0..255 に丸める。 */
const rgba = (v, alpha) => rgb(v) + Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();

const WHITE = rgb(0xffffff);
const SCRIM = rgba(0x000000, 0.45);

// 暗テーマ共通: 白の薄がけでハイライト・補助線を表す
const DARK_SELECTED = rgba(0xffffff, 0.14);
const DARK_HOUR = rgba(0xffffff, 0.09);
const DARK_GRID = rgba(0xffffff, 0.10);
const DARK_LIMIT = rgba(0xffffff, 0.75);

// 明テーマ共通: 黒の薄がけ
const LIGHT_SELECTED = rgba(0x000000, 0.08);
const LIGHT_HOUR = rgba(0x000000, 0.05);
const LIGHT_GRID = rgba(0x000000, 0.10);
const LIGHT_LIMIT = rgba(0x000000, 0.55);

/** 全テーマ共通の色ロール（Android の SignageTheme の既定値つき引数と同じ）。 */
const COMMON = {
  onOverDeep: WHITE, // overDeep の上に載せる文字・アイコン（白系）
  faceBody: rgb(0xffcb3d), // 顔アイコンの顔（黄色）
  faceInk: rgb(0x4a3410), // 顔アイコンの目・口
  faceSweat: rgb(0x4fa8f0), // 「やっちまった」顔の汗（青）
  overStripe: '#00000040', // 合計の棒の上限超過部分に重ねる斜線（半透明の黒）
};

const lumiere = {
  id: 'lumiere', name: 'Lumière', isDark: false, isGlass: false,
  bgColors: [rgb(0xffffff)],
  cardBg: rgb(0xf6f4ee), cardBorder: rgb(0xece8df),
  textPrimary: rgb(0x1a1a18), textSecondary: rgb(0x888780), textMuted: rgb(0x888780),
  track: rgb(0xe4e0d5), selectedBg: LIGHT_SELECTED, currentHourBg: LIGHT_HOUR, grid: LIGHT_GRID, limitLine: LIGHT_LIMIT,
  youtube: rgb(0xd93958), youtubeLight: rgb(0xe47087), roblox: rgb(0x12a06f), robloxLight: rgb(0x46b58f),
  power: rgb(0x2f6feb), powerLight: rgb(0x5e8ef0),
  warn: rgb(0xb26a00), over: rgb(0xc62828), overDeep: rgb(0xa00e1f), none: rgb(0x8a8a85),
  badgeYoutube: rgb(0xd6284a), badgeRoblox: rgb(0x12a06f), badgeText: WHITE,
  accent: rgb(0x1d9e75), scrim: SCRIM, ...COMMON,
};

const noir = {
  id: 'noir', name: 'Noir', isDark: true, isGlass: false,
  bgColors: [rgb(0x0f1216)],
  cardBg: rgb(0x171c23), cardBorder: rgb(0x242a33),
  textPrimary: rgb(0xe8eaf0), textSecondary: rgb(0x8a90a0), textMuted: rgb(0x8a90a0),
  track: rgb(0x2a323d), selectedBg: DARK_SELECTED, currentHourBg: DARK_HOUR, grid: DARK_GRID, limitLine: DARK_LIMIT,
  youtube: rgb(0xf4708a), youtubeLight: rgb(0xf68fa4), roblox: rgb(0x3dd6a0), robloxLight: rgb(0x68dfb5),
  power: rgb(0x5aa2ff), powerLight: rgb(0x82b9ff),
  warn: rgb(0xfbbf24), over: rgb(0xf04438), overDeep: rgb(0xd0192d), none: rgb(0x8a96a6),
  badgeYoutube: rgb(0xe11d48), badgeRoblox: rgb(0x059669), badgeText: WHITE,
  accent: rgb(0x1d9e75), scrim: SCRIM, ...COMMON,
};

const glassLight = {
  id: 'glass_light', name: 'Glass Light', isDark: false, isGlass: true,
  bgColors: [rgb(0xd7e8ff), rgb(0xe7e0ff), rgb(0xd6f3ec)],
  cardBg: rgba(0xffffff, 0.5), cardBorder: rgba(0xffffff, 0.7),
  textPrimary: rgb(0x23203a), textSecondary: rgb(0x5b5873), textMuted: rgb(0x6e6b82),
  track: rgba(0x23203a, 0.14), selectedBg: rgba(0x23203a, 0.10), currentHourBg: rgba(0x23203a, 0.06),
  grid: rgba(0x23203a, 0.12), limitLine: rgba(0x23203a, 0.60),
  youtube: rgb(0xc9224f), youtubeLight: rgb(0xd86080), roblox: rgb(0x0e8f63), robloxLight: rgb(0x43a885),
  power: rgb(0x2563eb), powerLight: rgb(0x5b8bef),
  warn: rgb(0x8f5300), over: rgb(0xb3261e), overDeep: rgb(0x940b1e), none: rgb(0x6e6b82),
  badgeYoutube: rgb(0xc81e4b), badgeRoblox: rgb(0x0e8f63), badgeText: WHITE,
  accent: rgb(0x0b5a44), scrim: SCRIM, ...COMMON,
};

const glassDark = {
  id: 'glass_dark', name: 'Glass Dark', isDark: true, isGlass: true,
  bgColors: [rgb(0x1b2340), rgb(0x2a2550), rgb(0x123a44)],
  cardBg: rgba(0xffffff, 0.08), cardBorder: rgba(0xffffff, 0.18),
  textPrimary: rgb(0xeaf0ff), textSecondary: rgb(0xaab4d4), textMuted: rgb(0xaab4d4),
  track: rgba(0xffffff, 0.16), selectedBg: DARK_SELECTED, currentHourBg: DARK_HOUR, grid: DARK_GRID, limitLine: DARK_LIMIT,
  youtube: rgb(0xff7f96), youtubeLight: rgb(0xff9bad), roblox: rgb(0x5fe3b5), robloxLight: rgb(0x82e9c5),
  power: rgb(0x6cb6ff), powerLight: rgb(0x92caff),
  warn: rgb(0xffc247), over: rgb(0xff6e5e), overDeep: rgb(0xd91e34), none: rgb(0xaab4d4),
  badgeYoutube: rgb(0xe11d48), badgeRoblox: rgb(0x059669), badgeText: WHITE,
  accent: rgb(0x5dcaa5), scrim: SCRIM, ...COMMON,
};

const midnight = {
  id: 'midnight', name: 'Midnight', isDark: true, isGlass: false,
  bgColors: [rgb(0x0b1836)],
  cardBg: rgb(0x12234a), cardBorder: rgb(0x1e2f55),
  textPrimary: rgb(0xdce6ff), textSecondary: rgb(0x7e8db8), textMuted: rgb(0x7e8db8),
  track: rgb(0x22345f), selectedBg: DARK_SELECTED, currentHourBg: DARK_HOUR, grid: DARK_GRID, limitLine: DARK_LIMIT,
  youtube: rgb(0xff7a90), youtubeLight: rgb(0xff97a8), roblox: rgb(0x2ed8b0), robloxLight: rgb(0x5ce1c1),
  power: rgb(0x58b4ff), powerLight: rgb(0x7fc6ff),
  warn: rgb(0xffc247), over: rgb(0xff5a4a), overDeep: rgb(0xd0182e), none: rgb(0x7e8db8),
  badgeYoutube: rgb(0xe11d48), badgeRoblox: rgb(0x059669), badgeText: WHITE,
  accent: rgb(0x35d0d0), scrim: SCRIM, ...COMMON,
};

const sakura = {
  id: 'sakura', name: 'Sakura', isDark: false, isGlass: false,
  bgColors: [rgb(0xfff5f8)],
  cardBg: rgb(0xffffff), cardBorder: rgb(0xf4dce5),
  textPrimary: rgb(0x4b1528), textSecondary: rgb(0xa06b7c), textMuted: rgb(0xa06b7c),
  track: rgb(0xf1d9e2), selectedBg: rgba(0xd4537e, 0.12), currentHourBg: rgba(0xd4537e, 0.07),
  grid: rgba(0x4b1528, 0.10), limitLine: rgba(0x4b1528, 0.55),
  youtube: rgb(0xc8386c), youtubeLight: rgb(0xd77095), roblox: rgb(0x3f9660), robloxLight: rgb(0x69ad83),
  power: rgb(0x2f6be0), powerLight: rgb(0x5c8ceb),
  warn: rgb(0xb36200), over: rgb(0xc62828), overDeep: rgb(0xa00e25), none: rgb(0xa06b7c),
  badgeYoutube: rgb(0xc42b63), badgeRoblox: rgb(0x3f9660), badgeText: WHITE,
  accent: rgb(0xd4537e), scrim: SCRIM, ...COMMON,
};

const paper = {
  id: 'paper', name: 'Paper', isDark: false, isGlass: false,
  bgColors: [rgb(0xf3ecdd)],
  cardBg: rgb(0xfbf7ec), cardBorder: rgb(0xe2d6be),
  textPrimary: rgb(0x3a2f1e), textSecondary: rgb(0x8a7a5a), textMuted: rgb(0x8a7a5a),
  track: rgb(0xe2d6be), selectedBg: rgba(0x6b5433, 0.12), currentHourBg: rgba(0x6b5433, 0.07),
  grid: rgba(0x3a2f1e, 0.10), limitLine: rgba(0x3a2f1e, 0.55),
  youtube: rgb(0xb5473a), youtubeLight: rgb(0xca7b71), roblox: rgb(0x678a4b), robloxLight: rgb(0x88a473),
  power: rgb(0x2f66c4), powerLight: rgb(0x5887d3),
  warn: rgb(0x9c6500), over: rgb(0xc0301e), overDeep: rgb(0x9c130d), none: rgb(0x8a7a5a),
  badgeYoutube: rgb(0xb5473a), badgeRoblox: rgb(0x678a4b), badgeText: WHITE,
  accent: rgb(0x6b5433), scrim: SCRIM, ...COMMON,
};

const forest = {
  id: 'forest', name: 'Forest', isDark: true, isGlass: false,
  bgColors: [rgb(0x0e1a12)],
  cardBg: rgb(0x15271b), cardBorder: rgb(0x1e3325),
  textPrimary: rgb(0xddeee0), textSecondary: rgb(0x7fa489), textMuted: rgb(0x7fa489),
  track: rgb(0x223a29), selectedBg: DARK_SELECTED, currentHourBg: DARK_HOUR, grid: DARK_GRID, limitLine: DARK_LIMIT,
  youtube: rgb(0xf5775f), youtubeLight: rgb(0xf79582), roblox: rgb(0x8cd46c), robloxLight: rgb(0xa5dd8c),
  power: rgb(0x4fb0ff), powerLight: rgb(0x79c4ff),
  warn: rgb(0xffc247), over: rgb(0xff5c4a), overDeep: rgb(0xd41c26), none: rgb(0x7fa489),
  badgeYoutube: rgb(0xdc4a36), badgeRoblox: rgb(0x3f9a3f), badgeText: WHITE,
  accent: rgb(0x97c459), scrim: SCRIM, ...COMMON,
};

const mono = {
  id: 'mono', name: 'Mono', isDark: false, isGlass: false,
  bgColors: [rgb(0xffffff)],
  cardBg: rgb(0xf1f1ee), cardBorder: rgb(0xd9d9d4),
  textPrimary: rgb(0x1a1a1a), textSecondary: rgb(0x8a8a85), textMuted: rgb(0x8a8a85),
  track: rgb(0xdadad5), selectedBg: LIGHT_SELECTED, currentHourBg: LIGHT_HOUR, grid: LIGHT_GRID, limitLine: LIGHT_LIMIT,
  // 無彩色テーマでも YouTube=赤 / Roblox=緑 は判別できるよう、彩度を抑えた色にする
  youtube: rgb(0xb9414e), youtubeLight: rgb(0xcd7680), roblox: rgb(0x4e8e5c), robloxLight: rgb(0x75a780),
  power: rgb(0x3b67b8), powerLight: rgb(0x6b8fcb),
  warn: rgb(0x9c6500), over: rgb(0xb71c1c), overDeep: rgb(0x990f1d), none: rgb(0x8a8a85),
  badgeYoutube: rgb(0xb3303f), badgeRoblox: rgb(0x4e8e5c), badgeText: WHITE,
  accent: rgb(0x1a1a1a), scrim: SCRIM, ...COMMON,
};

const sunset = {
  id: 'sunset', name: 'Sunset', isDark: false, isGlass: false,
  bgColors: [rgb(0xffe9d6), rgb(0xfbd9d0), rgb(0xf6cbb0)],
  // 夕焼けのグラデに白を重ねた半透明カード（背景の上に重ねる）
  cardBg: rgba(0xffffff, 0.6), cardBorder: rgb(0xf3c9a8),
  textPrimary: rgb(0x4a1b0c), textSecondary: rgb(0x9a5a3a), textMuted: rgb(0x9a5a3a),
  track: rgba(0x4a1b0c, 0.14), selectedBg: rgba(0x993c1d, 0.14), currentHourBg: rgba(0x993c1d, 0.08),
  grid: rgba(0x4a1b0c, 0.12), limitLine: rgba(0x4a1b0c, 0.60),
  youtube: rgb(0xc64839), youtubeLight: rgb(0xd67b70), roblox: rgb(0x1b9a78), robloxLight: rgb(0x4db096),
  power: rgb(0x2b5fd0), powerLight: rgb(0x5c86dd),
  warn: rgb(0x8f5300), over: rgb(0xb3261e), overDeep: rgb(0x9a100b), none: rgb(0x9a5a3a),
  badgeYoutube: rgb(0xc23a2a), badgeRoblox: rgb(0x1b9a78), badgeText: WHITE,
  accent: rgb(0x993c1d), scrim: SCRIM, ...COMMON,
};

/** 表示順(1 Lumière 〜 10 Sunset) */
export const ALL_THEMES = Object.freeze([lumiere, noir, glassLight, glassDark, midnight, sakura, paper, forest, mono, sunset]);

/** 既定テーマ: 2 Noir */
export const DEFAULT_THEME = noir;

/** 保存済みIDからテーマを引く。null・未知のIDは既定(Noir)にフォールバックする。 */
export function findThemeOrDefault(id) {
  return ALL_THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** 「1 Lumière」形式の表示名 */
export function themeDisplayName(theme) {
  return `${ALL_THEMES.indexOf(theme) + 1} ${theme.name}`;
}

/** システムバー等に使う代表背景色(グラデは中間色) */
export function themeBgColor(theme) {
  return theme.bgColors[Math.floor(theme.bgColors.length / 2)];
}

/** 背景のCSS値。単色はその色、複数色は左上→右下(135°)の線形グラデ。 */
export function themeBgCss(theme) {
  return theme.bgColors.length === 1
    ? theme.bgColors[0]
    : `linear-gradient(135deg, ${theme.bgColors.join(', ')})`;
}

/** アプリ固有の基本色（app = 'youtube' | 'roblox'） */
export function appColor(theme, app) {
  return app === 'youtube' ? theme.youtube : theme.roblox;
}

/** アプリ固有の明るい側の色（グラデーション用） */
export function appLightColor(theme, app) {
  return app === 'youtube' ? theme.youtubeLight : theme.robloxLight;
}

/** WARN/OVER の明るい側を作るときの白への混合率 */
export const LEVEL_LIGHTEN = 0.2;

/** 使用量レベル('none'|'ok'|'warn'|'over')に対応する色。OKは app 自身の色。 */
export function levelColor(theme, level, app) {
  switch (level) {
    case 'ok': return appColor(theme, app);
    case 'warn': return theme.warn;
    case 'over': return theme.over;
    default: return theme.none;
  }
}

/** levelColor のグラデーション明るい側。WARN/OVER は基本色を白へ寄せて作る。 */
export function levelLightColor(theme, level, app) {
  switch (level) {
    case 'ok': return appLightColor(theme, app);
    case 'warn': return lerpColor(theme.warn, '#FFFFFF', LEVEL_LIGHTEN);
    case 'over': return lerpColor(theme.over, '#FFFFFF', LEVEL_LIGHTEN);
    default: return theme.none;
  }
}

// ---------- CSS変数 ----------

/** テーマ → CSSカスタムプロパティ（css/themes.css の生成と、テストでの同期確認に使う） */
export function themeCssVars(t) {
  return {
    '--bg': themeBgCss(t),
    '--bg-c': themeBgColor(t),
    '--card': t.cardBg,
    '--card-border': t.cardBorder,
    '--text': t.textPrimary,
    '--text2': t.textSecondary,
    '--muted': t.textMuted,
    '--track': t.track,
    '--sel': t.selectedBg,
    '--hour': t.currentHourBg,
    '--grid': t.grid,
    '--limit': t.limitLine,
    '--yt': t.youtube,
    '--yt-l': t.youtubeLight,
    '--rb': t.roblox,
    '--rb-l': t.robloxLight,
    '--pw': t.power,
    '--pw-l': t.powerLight,
    '--warn': t.warn,
    '--over': t.over,
    '--over-deep': t.overDeep,
    '--on-over-deep': t.onOverDeep,
    '--none': t.none,
    '--badge-yt': t.badgeYoutube,
    '--badge-rb': t.badgeRoblox,
    '--badge-text': t.badgeText,
    '--accent': t.accent,
    '--on-accent': onAccent(t.accent),
    '--scrim': t.scrim,
    '--face-body': t.faceBody,
    '--face-ink': t.faceInk,
    '--face-sweat': t.faceSweat,
    '--over-stripe': t.overStripe,
    'color-scheme': t.isDark ? 'dark' : 'light',
  };
}

/** css/themes.css の全文を生成する。 */
export function generateThemesCss() {
  const out = ['/* 自動生成: node tools/gen-theme-css.mjs （js/themes.js が正。直接編集しない） */\n'];
  for (const t of ALL_THEMES) {
    const sel = t.id === DEFAULT_THEME.id ? `:root,\n:root[data-theme="${t.id}"]` : `:root[data-theme="${t.id}"]`;
    const body = Object.entries(themeCssVars(t)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
    out.push(`/* ${themeDisplayName(t)} */\n${sel} {\n${body}\n}\n`);
  }
  return out.join('\n');
}

// 電力（Nature Remo E lite）の表示ロジックと電力設定ステッパー
// （Android版 logic/PowerLogic.kt / logic/PowerSettingsLogic.kt の移植）。DOMには触れず、Nodeでユニットテストできる。
// Web 版は表示専用（Nature の取得・RTDB への記録は Redmi だけが行うので PowerRecorder は移植しない）。
//
// 日付は "yyyy-MM-dd" 文字列（ローカル日付）。電力データ（PowerData）の形は js/parser.js のコメントを参照。

import { addDays, weekdayChar } from './logic.js';

/** 画面で開いているパネル（state.expanded の値）。null = 分割表示。 */
export const PANEL_POWER = 'power';
export const PANEL_USAGE = 'usage';

export const DEFAULT_WARN_W = 3000;
export const DEFAULT_YEN_PER_KWH = 31;

/** 目安のこの割合（0.6）以上で「やや多い」。比較は整数演算（level） */
export const HIGH_RATIO = 0.6;

/** `now.at` がこれより古いと「更新なし」（秒） */
export const STALE_SEC = 10 * 60;

/** 時間別グラフY軸の最小上限(kWh)と刻み */
export const HOURLY_MIN_MAX = 0.5;
export const HOURLY_STEP = 0.5;

/** 週グラフY軸の最小上限(kWh)と刻み */
export const WEEKLY_MIN_MAX = 5;
export const WEEKLY_STEP = 5;

/** 更新なしのときのステータス文言 */
export const STALE_TEXT = '電力: 更新なし';

// ---------------- 設定の解決 ----------------

/** 実効の警告目安(W)。未設定・0以下は既定。 */
export function warnW(settings) {
  const v = settings?.warnW;
  return v !== null && v !== undefined && v > 0 ? v : DEFAULT_WARN_W;
}

/** 実効の電気料金単価(円/kWh)。未設定・0以下は既定。 */
export function yenPerKwh(settings) {
  const v = settings?.yenPerKwh;
  return v !== null && v !== undefined && v > 0 ? v : DEFAULT_YEN_PER_KWH;
}

// ---------------- 文字列 ----------------

/** 3桁区切り（en-US）。整数のみ。 */
function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 小数 digits 桁へ四捨五入（Java の %.Nf と同じく、表記上の十進数で半分は切り上げ）。 */
function fixed(v, digits) {
  const k = 10 ** digits;
  return (Math.round(Number((v * k).toPrecision(15))) / k).toFixed(digits);
}

/** 「1,240」。負（逆潮流）は0として表示。 */
export function formatWatts(w) {
  return groupThousands(Math.max(Math.round(w), 0));
}

/** 小数1桁「8.4」。負は0.0。 */
export function formatKwh(kwh) {
  return fixed(Math.max(kwh, 0), 1);
}

/** 今日のkWh×単価を円に四捨五入。 */
export function costYen(todayKwh, yen) {
  return Math.round(Math.max(todayKwh, 0) * yen);
}

/** 「約260円」（3桁区切り）。 */
export function costText(todayKwh, yen) {
  return `約${groupThousands(costYen(todayKwh, yen))}円`;
}

/** グラフ軸の目盛り表記: 整数は「5」、それ以外は小数2桁までの末尾0除去（0.25 / 1.5）。 */
export function formatAxis(v) {
  return fixed(v, 2).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------------- 水準・鮮度 ----------------

/** w < 0.6×目安 → 'normal' / 目安未満 → 'high' / 目安以上 → 'over'。負のwは normal。 */
export function level(w, warn) {
  if (w >= warn) return 'over';
  // 浮動小数を避け整数で 0.6×目安 を比較（w ≥ 0.6×warnW ⇔ 10w ≥ 6×warnW）
  if (w * 10 >= warn * 6) return 'high';
  return 'normal';
}

/** バッジ文言。normal は null（バッジなし）。 */
export function levelBadgeText(lv) {
  if (lv === 'high') return 'やや多い';
  if (lv === 'over') return '多い';
  return null;
}

/** 電力が古い（`now.at` が無い、または10分より古い）か。ちょうど10分は新鮮。 */
export function isStale(now, nowEpochSec) {
  const at = now?.at;
  if (at === null || at === undefined) return true;
  return nowEpochSec - at > STALE_SEC;
}

/**
 * 「いま／今日」のまとめ。power が null でも例外を出さない（呼び出し側は isPowerEmpty で無表示にする）。
 * @returns {{wText:string, stale:boolean, level:string, badgeText:string|null, todayKwhText:string, costText:string}}
 */
export function summary(power, today, nowEpochSec) {
  const now = power?.now ?? null;
  const stale = isStale(now, nowEpochSec);
  const lv = stale || now === null ? 'normal' : level(now.w, warnW(power?.settings));
  const kwh = todayKwh(power, today);
  return {
    wText: now === null ? '--' : formatWatts(now.w),
    stale,
    level: lv,
    badgeText: levelBadgeText(lv),
    todayKwhText: formatKwh(kwh),
    costText: costText(kwh, yenPerKwh(power?.settings)),
  };
}

// ---------------- 系列 ----------------

/** 今日のkWh = 今日の日合計。データなしは0。 */
export function todayKwh(power, today) {
  const t = power?.days?.get(today)?.total;
  return t === null || t === undefined ? 0 : Math.max(t, 0);
}

/** 今日と過去6日（古い順）。欠けた日は kwh=0・hasData=false。使用量の7日グラフと同じ並び・ラベル。 */
export function last7Days(days, today) {
  const out = [];
  for (let back = 6; back >= 0; back--) {
    const date = addDays(today, -back);
    const day = days.get(date);
    out.push({
      date,
      label: back === 0 ? '今日' : weekdayChar(date),
      kwh: day ? Math.max(day.total, 0) : 0,
      hasData: !!day,
      isToday: back === 0,
    });
  }
  return out;
}

/**
 * 週平均(kWh)。データのある日の平均。今日は途中なので、他にデータのある日があれば除く
 * （今日しかなければ今日）。データが全く無ければ null。
 */
export function weekAverage(bars) {
  const withData = bars.filter((b) => b.hasData);
  const others = withData.filter((b) => !b.isToday);
  const basis = others.length > 0 ? others : withData;
  if (basis.length === 0) return null;
  return basis.reduce((a, b) => a + b.kwh, 0) / basis.length;
}

/** 選択日の時間別24値(kWh)。データなし(null/undefined)は全て0。 */
export function hourlySeries(day) {
  return Array.from({ length: 24 }, (_, h) => Math.max(day?.hours?.[h] ?? 0, 0));
}

/** 選択日の合計(kWh)。データなしは0。 */
export function dayTotal(day) {
  return day ? Math.max(day.total ?? 0, 0) : 0;
}

// ---------------- Y軸 ----------------

/** 時間別: max(0.5, ceil(max/0.5)×0.5) kWh */
export function hourlyAxisMax(maxKwh) {
  return axisMax(maxKwh, HOURLY_MIN_MAX, HOURLY_STEP);
}

/** 週: max(5, ceil(max/5)×5) kWh */
export function weeklyAxisMax(maxKwh) {
  return axisMax(maxKwh, WEEKLY_MIN_MAX, WEEKLY_STEP);
}

function axisMax(maxKwh, min, step) {
  const m = Number.isNaN(maxKwh) ? 0 : Math.max(maxKwh, 0);
  // 浮動小数の誤差で 1.0000000001 が次の刻みに上がらないよう、わずかに引いてから切り上げる
  return Math.max(min, Math.ceil(m / step - 1e-9) * step);
}

// ---------------- 電力設定（警告の目安・電気料金単価）のステッパー ----------------

export const WARN_STEP = 500;
export const WARN_MIN = 1000;
export const WARN_MAX = 8000;

export const YEN_STEP = 1;
export const YEN_MIN = 10;
export const YEN_MAX = 80;

const coerce = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function clampWarn(w) {
  return coerce(w, WARN_MIN, WARN_MAX);
}

export function clampYen(y) {
  return coerce(y, YEN_MIN, YEN_MAX);
}

/** ＋: 次の500W刻みへ（倍数でない値も次の倍数へ）。最大 WARN_MAX で頭打ち。 */
export function stepWarnUp(w) {
  return Math.min((Math.floor(clampWarn(w) / WARN_STEP) + 1) * WARN_STEP, WARN_MAX);
}

/** −: 前の500W刻みへ（倍数でない値は直前の倍数へ）。最小 WARN_MIN で頭打ち。 */
export function stepWarnDown(w) {
  const c = clampWarn(w);
  const next = c % WARN_STEP === 0 ? c - WARN_STEP : Math.floor(c / WARN_STEP) * WARN_STEP;
  return Math.max(next, WARN_MIN);
}

export function stepYenUp(y) {
  return Math.min(clampYen(y) + YEN_STEP, YEN_MAX);
}

export function stepYenDown(y) {
  return Math.max(clampYen(y) - YEN_STEP, YEN_MIN);
}

/** 「3,000 W」 */
export function warnText(w) {
  return `${formatWatts(w)} W`;
}

/** 「31 円/kWh」 */
export function yenText(y) {
  return `${y} 円/kWh`;
}

/** 現在の実効設定から下書きを作る（範囲外は範囲内へ寄せる）。 @returns {{warnW:number, yenPerKwh:number}} */
export function draftFrom(settings) {
  return { warnW: clampWarn(warnW(settings)), yenPerKwh: clampYen(yenPerKwh(settings)) };
}

/** PATCH本文 `{"warnW":3000,"yenPerKwh":31,"updatedAt":1793000000}`。値は範囲内にクランプ。キー順固定。 */
export function patchBody(warn, yen, updatedAtSec) {
  return JSON.stringify({
    warnW: clampWarn(warn),
    yenPerKwh: clampYen(yen),
    updatedAt: updatedAtSec,
  });
}

/** 保存した設定がサーバーから取得したデータに反映済みか（updatedAt が同じか新しい）。 */
export function isReflected(fetched, pending) {
  const f = fetched?.updatedAt;
  const p = pending?.updatedAt;
  if (f === null || f === undefined || p === null || p === undefined) return false;
  return f >= p;
}

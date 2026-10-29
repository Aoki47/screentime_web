// 週グラフ・時間別グラフのSVG文字列生成（Android版 WeekChart / HourlyChart / BarDraw の移植）。
// DOMには触れない（文字列を返すだけ）。色はCSS変数（--yt など）経由で、棒のグラデーションは
// index.html の <defs> にある #gYt / #gRb を参照する（上=明るい色 → 下=基本色）。
//
// scale は「カードの大きさに応じた文字・線のスケール」（Android の Dim.scale 相当）。

import { clampHourSegments, HOUR_MAX_SEC, WEEK_MIN_Y_SEC } from './logic.js';
import { formatAxis, formatKwh } from './power.js';

const f = (n) => Math.round(n * 100) / 100;

/** 文字列のおおよその幅（px）。全角=1em、半角=0.58em。レイアウト計算用の近似。 */
export function estimateTextWidth(text, size) {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) < 0x2000 ? 0.58 : 1;
  return w * size;
}

/** 上端だけ角丸の棒のパス。角丸は幅・高さに収まるよう自動で縮める。描けない寸法なら ''。 */
export function barPath(left, top, width, height, topRadius) {
  if (!(width > 0) || !(height > 0)) return '';
  const r = Math.max(0, Math.min(topRadius, width / 2, height));
  const x0 = left;
  const x1 = left + width;
  const y0 = top;
  const y1 = top + height;
  if (r <= 0) return `M${f(x0)} ${f(y1)}V${f(y0)}H${f(x1)}V${f(y1)}Z`;
  return (
    `M${f(x0)} ${f(y1)}V${f(y0 + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)}` +
    `H${f(x1 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)}V${f(y1)}Z`
  );
}

const GRAD = { youtube: 'url(#gYt)', roblox: 'url(#gRb)', power: 'url(#gPw)' };

/**
 * 下（bottom）から segs の順に積み上げる。各区間が自前のグラデーションを持ち、
 * 角丸は最上段の上端だけ（区間の継ぎ目は平ら）。segs: [{h, app}]（app: 'youtube' / 'roblox' / 'power'）
 */
export function stackedBar(left, bottom, width, segs, radius, opacity = 1) {
  let cursor = bottom;
  let out = '';
  segs.forEach((sg, i) => {
    const top = cursor - sg.h;
    const d = barPath(left, top, width, sg.h, i === segs.length - 1 ? radius : 0);
    if (d) out += `<path d="${d}" fill="${GRAD[sg.app]}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`;
    cursor = top;
  });
  return out;
}

/**
 * 7日間の積み上げ棒グラフ（下: YouTube、上: Roblox）。選択中の日は列全体を角丸の背景でハイライトしラベルを太字に。
 * 上限合計 > 0 なら破線を引く。Y軸は自動スケール（最低1時間）。
 * @param {{date:string,label:string,youtubeSec:number,robloxSec:number,totalSec:number,isToday:boolean}[]} bars
 */
export function weekChartSvg(bars, selectedDate, limitSumSec, w, h, scale) {
  if (!bars.length || w <= 0 || h <= 0) return '';
  const labelSize = 15 * scale;
  const labelH = labelSize * 1.2;
  const padV = 4 * scale;
  const gap = 3 * scale;
  const chartTop = padV + 2 * scale;
  const chartBottom = Math.max(h - labelH - gap - padV, chartTop + 1);
  const chartH = chartBottom - chartTop;

  const maxTotal = Math.max(...bars.map((b) => b.totalSec));
  const yMax = Math.max(maxTotal, limitSumSec, WEEK_MIN_Y_SEC) * 1.08;

  const slot = w / bars.length;
  const barW = slot * 0.56;
  const minSeg = 2;
  const barRadius = barW * 0.22;

  let s = '';
  bars.forEach((bar, i) => {
    const cx = slot * i + slot / 2;
    const left = cx - barW / 2;
    const selected = bar.date === selectedDate;

    if (selected) {
      const rr = 10 * scale;
      s += `<rect x="${f(slot * i + slot * 0.05)}" y="0" width="${f(slot * 0.9)}" height="${f(h)}" rx="${f(rr)}" fill="var(--sel)"/>`;
    }
    const opacity = selected ? 1 : bar.isToday ? 0.85 : 0.5;
    const segs = [];
    if (bar.youtubeSec > 0) segs.push({ h: Math.max((bar.youtubeSec / yMax) * chartH, minSeg), app: 'youtube' });
    if (bar.robloxSec > 0) segs.push({ h: Math.max((bar.robloxSec / yMax) * chartH, minSeg), app: 'roblox' });
    s += stackedBar(left, chartBottom, barW, segs, barRadius, opacity);

    const color = selected || bar.isToday ? 'var(--text)' : 'var(--text2)';
    const weight = selected ? 700 : 400;
    s += `<text x="${f(cx)}" y="${f(chartBottom + gap + labelSize * 0.92)}" text-anchor="middle" font-size="${f(labelSize)}" font-weight="${weight}" fill="${color}">${bar.label}</text>`;
  });

  // ベースライン
  s += `<line x1="0" y1="${f(chartBottom)}" x2="${f(w)}" y2="${f(chartBottom)}" stroke="var(--track)" stroke-width="1.5"/>`;

  // 上限合計の破線
  if (limitSumSec > 0) {
    const y = chartBottom - (limitSumSec / yMax) * chartH;
    s += `<line x1="0" y1="${f(y)}" x2="${f(w)}" y2="${f(y)}" stroke="var(--limit)" stroke-width="${f(1.6 * scale)}" stroke-dasharray="10 7"/>`;
  }

  return `<svg width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" aria-hidden="true" focusable="false">${s}</svg>`;
}

/**
 * 時間別の積み上げ棒グラフ（0..23時の24本。下: YouTube、上: Roblox）。
 * Y軸は 0..60分 固定（1時間を超える値は枠内にクランプ）。30分/60分に薄いグリッド線。
 * X軸ラベルは 0時 6時 12時 18時 24時。currentHour が非nullなら(今日のみ)その時台を薄くハイライト。
 * @param {{hour:number,youtubeSec:number,robloxSec:number}[]} hours
 */
export function hourlyChartSvg(hours, currentHour, w, h, scale) {
  if (!hours.length || w <= 0 || h <= 0) return '';
  const labelSize = 13 * scale;
  const axisSize = 11 * scale;
  const xLabels = [0, 6, 12, 18, 24].map((hr) => ({ hr, text: `${hr}時` }));
  const labelH = labelSize * 1.2;
  const axisH = axisSize * 1.2;
  const gap = 3 * scale;

  const axisW = Math.max(estimateTextWidth('30分', axisSize), estimateTextWidth('60分', axisSize));
  const chartLeft = axisW + 5 * scale;
  const chartRight = w - estimateTextWidth('24時', labelSize) / 2;
  const chartTop = axisH / 2 + 1;
  const chartBottom = Math.max(h - labelH - gap, chartTop + 1);
  const chartH = chartBottom - chartTop;
  const chartW = Math.max(chartRight - chartLeft, 1);
  const slot = chartW / 24;
  const yOf = (sec) => chartBottom - (sec / HOUR_MAX_SEC) * chartH;

  let s = '';

  // 現在時刻の時台（今日のみ）
  if (currentHour !== null && currentHour !== undefined && currentHour >= 0 && currentHour <= 23) {
    s += `<rect x="${f(chartLeft + slot * currentHour)}" y="${f(chartTop)}" width="${f(slot)}" height="${f(chartH)}" rx="${f(3 * scale)}" fill="var(--hour)"/>`;
  }

  // グリッド（30分 / 60分）
  const y30 = yOf(1800);
  const y60 = yOf(3600);
  s += `<line x1="${f(chartLeft)}" y1="${f(y30)}" x2="${f(chartRight)}" y2="${f(y30)}" stroke="var(--grid)" stroke-width="1"/>`;
  s += `<line x1="${f(chartLeft)}" y1="${f(y60)}" x2="${f(chartRight)}" y2="${f(y60)}" stroke="var(--grid)" stroke-width="1"/>`;
  const axisBase = axisSize * 0.36; // 縦中央揃えの近似
  s += `<text x="0" y="${f(y30 + axisBase)}" font-size="${f(axisSize)}" fill="var(--muted)">30分</text>`;
  s += `<text x="0" y="${f(y60 + axisBase)}" font-size="${f(axisSize)}" fill="var(--muted)">60分</text>`;

  // 棒
  const barW = slot * 0.68;
  const minSeg = 2;
  const barRadius = Math.min(barW * 0.3, 4 * scale);
  for (const hb of hours) {
    if (hb.hour < 0 || hb.hour > 23) continue;
    const [ySec, rSec] = clampHourSegments(hb.youtubeSec, hb.robloxSec);
    const left = chartLeft + slot * hb.hour + (slot - barW) / 2;
    const segs = [];
    if (ySec > 0) segs.push({ h: Math.max((ySec / HOUR_MAX_SEC) * chartH, minSeg), app: 'youtube' });
    if (rSec > 0) segs.push({ h: Math.max((rSec / HOUR_MAX_SEC) * chartH, minSeg), app: 'roblox' });
    s += stackedBar(left, chartBottom, barW, segs, barRadius);
  }

  // ベースライン
  s += `<line x1="${f(chartLeft)}" y1="${f(chartBottom)}" x2="${f(chartRight)}" y2="${f(chartBottom)}" stroke="var(--track)" stroke-width="1.5"/>`;

  // X軸ラベル（時刻の境界に中央揃え）
  for (const { hr, text } of xLabels) {
    const x = chartLeft + slot * hr;
    s += `<text x="${f(x)}" y="${f(chartBottom + gap + labelSize * 0.92)}" text-anchor="middle" font-size="${f(labelSize)}" fill="var(--text2)">${text}</text>`;
  }

  return `<svg width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" aria-hidden="true" focusable="false">${s}</svg>`;
}

// ---------------- 電力のグラフ（PowerCharts.kt の移植） ----------------

/**
 * 電力の時間別棒グラフ（0..23時の24本、単色のグラデーション棒）。
 * Y軸は 0..yMax kWh（hourlyAxisMax）。上端と中間に薄いグリッド線と目盛り。
 * X軸ラベルは 0時 6時 12時 18時 24時。currentHour が非nullならその時台を薄くハイライト。
 * @param {number[]} hours 24個のkWh（足りない分は0扱い）
 */
export function powerHourlyChartSvg(hours, yMax, currentHour, w, h, scale) {
  if (w <= 0 || h <= 0) return '';
  const top = yMax > 0 ? yMax : 0.5;
  const labelSize = 13 * scale;
  const axisSize = 11 * scale;
  const xLabels = [0, 6, 12, 18, 24].map((hr) => ({ hr, text: `${hr}時` }));
  const labelH = labelSize * 1.2;
  const axisH = axisSize * 1.2;
  const gap = 3 * scale;

  const axisTopText = formatAxis(top);
  const axisMidText = formatAxis(top / 2);
  const axisW = Math.max(estimateTextWidth(axisTopText, axisSize), estimateTextWidth(axisMidText, axisSize));
  const chartLeft = axisW + 5 * scale;
  const chartRight = w - estimateTextWidth('24時', labelSize) / 2;
  const chartTop = axisH / 2 + 1;
  const chartBottom = Math.max(h - labelH - gap, chartTop + 1);
  const chartH = chartBottom - chartTop;
  const chartW = Math.max(chartRight - chartLeft, 1);
  const slot = chartW / 24;
  const yOf = (kwh) => chartBottom - (kwh / top) * chartH;

  let s = '';
  if (currentHour !== null && currentHour !== undefined && currentHour >= 0 && currentHour <= 23) {
    s += `<rect x="${f(chartLeft + slot * currentHour)}" y="${f(chartTop)}" width="${f(slot)}" height="${f(chartH)}" rx="${f(3 * scale)}" fill="var(--hour)"/>`;
  }

  // グリッド（中間 / 上端）
  const yMid = yOf(top / 2);
  const yTop = yOf(top);
  s += `<line x1="${f(chartLeft)}" y1="${f(yMid)}" x2="${f(chartRight)}" y2="${f(yMid)}" stroke="var(--grid)" stroke-width="1"/>`;
  s += `<line x1="${f(chartLeft)}" y1="${f(yTop)}" x2="${f(chartRight)}" y2="${f(yTop)}" stroke="var(--grid)" stroke-width="1"/>`;
  const axisBase = axisSize * 0.36; // 縦中央揃えの近似
  s += `<text x="0" y="${f(yMid + axisBase)}" font-size="${f(axisSize)}" fill="var(--muted)">${axisMidText}</text>`;
  s += `<text x="0" y="${f(yTop + axisBase)}" font-size="${f(axisSize)}" fill="var(--muted)">${axisTopText}</text>`;

  // 棒
  const barW = slot * 0.68;
  const minH = 2;
  const barRadius = Math.min(barW * 0.3, 4 * scale);
  for (let hr = 0; hr < 24; hr++) {
    const v = Math.min(Math.max(hours[hr] ?? 0, 0), top);
    if (v <= 0) continue;
    const barH = Math.max((v / top) * chartH, minH);
    const left = chartLeft + slot * hr + (slot - barW) / 2;
    s += stackedBar(left, chartBottom, barW, [{ h: barH, app: 'power' }], barRadius);
  }

  // ベースライン
  s += `<line x1="${f(chartLeft)}" y1="${f(chartBottom)}" x2="${f(chartRight)}" y2="${f(chartBottom)}" stroke="var(--track)" stroke-width="1.5"/>`;

  // X軸ラベル（時刻の境界に中央揃え）
  for (const { hr, text } of xLabels) {
    const x = chartLeft + slot * hr;
    s += `<text x="${f(x)}" y="${f(chartBottom + gap + labelSize * 0.92)}" text-anchor="middle" font-size="${f(labelSize)}" fill="var(--text2)">${text}</text>`;
  }
  return `<svg width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" aria-hidden="true" focusable="false">${s}</svg>`;
}

/**
 * 電力の7日間棒グラフ（日合計kWh）。選択中の日は列全体を背景でハイライトしラベルを太字に。
 * 棒の上に小さく値(kWh)を表示する。Y軸は 0..yMax（weeklyAxisMax）。データの無い日は棒も値も描かない。
 * @param {{date:string,label:string,kwh:number,hasData:boolean,isToday:boolean}[]} bars
 */
export function powerWeekChartSvg(bars, selectedDate, yMax, w, h, scale) {
  if (!bars.length || w <= 0 || h <= 0) return '';
  const top = yMax > 0 ? yMax : 5;
  const labelSize = 15 * scale;
  const valueSize = 11 * scale;
  const labelH = labelSize * 1.2;
  const valueH = valueSize * 1.2;
  const padV = 4 * scale;
  const gap = 3 * scale;
  const chartTop = padV + valueH + gap;
  const chartBottom = Math.max(h - labelH - gap - padV, chartTop + 1);
  const chartH = chartBottom - chartTop;

  const slot = w / bars.length;
  const barW = slot * 0.56;
  const minH = 2;
  const barRadius = barW * 0.22;

  let s = '';
  bars.forEach((bar, i) => {
    const cx = slot * i + slot / 2;
    const left = cx - barW / 2;
    const selected = bar.date === selectedDate;

    if (selected) {
      s += `<rect x="${f(slot * i + slot * 0.05)}" y="0" width="${f(slot * 0.9)}" height="${f(h)}" rx="${f(10 * scale)}" fill="var(--sel)"/>`;
    }
    const opacity = selected ? 1 : bar.isToday ? 0.85 : 0.5;
    if (bar.hasData && bar.kwh > 0) {
      const barH = Math.max((Math.min(bar.kwh, top) / top) * chartH, minH);
      s += stackedBar(left, chartBottom, barW, [{ h: barH, app: 'power' }], barRadius, opacity);
      s += `<text x="${f(cx)}" y="${f(chartBottom - barH - gap - valueSize * 0.28)}" text-anchor="middle" font-size="${f(valueSize)}" fill="var(--text2)">${formatKwh(bar.kwh)}</text>`;
    }
    const color = selected || bar.isToday ? 'var(--text)' : 'var(--text2)';
    const weight = selected ? 700 : 400;
    s += `<text x="${f(cx)}" y="${f(chartBottom + gap + labelSize * 0.92)}" text-anchor="middle" font-size="${f(labelSize)}" font-weight="${weight}" fill="${color}">${bar.label}</text>`;
  });

  s += `<line x1="0" y1="${f(chartBottom)}" x2="${f(w)}" y2="${f(chartBottom)}" stroke="var(--track)" stroke-width="1.5"/>`;
  return `<svg width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" aria-hidden="true" focusable="false">${s}</svg>`;
}

/**
 * data-chart 名 → SVG 文字列（ui.js の charts 記述子を実寸で描く）。未知の名前・記述子なしは ''。
 * 名前: 'week' / 'hourly'（使用量）、'power-week' / 'power-hourly'（電力）。
 */
export function renderChart(name, d, w, h, scale) {
  if (!d) return '';
  switch (name) {
    case 'week': return weekChartSvg(d.bars, d.selectedDate, d.limitTotalSec, w, h, scale);
    case 'hourly': return hourlyChartSvg(d.hours, d.currentHour, w, h, scale);
    case 'power-week': return powerWeekChartSvg(d.bars, d.selectedDate, d.yMax, w, h, scale);
    case 'power-hourly': return powerHourlyChartSvg(d.hours, d.yMax, d.currentHour, w, h, scale);
    default: return '';
  }
}

// lib/series.js

// ------------------------
// Stats & windows
// ------------------------
export function computeStats(series) {
  const vals = series.filter(v => typeof v === "number");
  if (!vals.length) return { avg: null, min: null, max: null, count: 0 };
  let sum = 0, min = vals[0], max = vals[0];
  for (const v of vals) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { avg: sum / vals.length, min, max, count: vals.length };
}

export function fillSmallGapsLinear(values, maxGap = 8) {
  const out = values.slice();
  let i = 0;
  while (i < out.length) {
    if (typeof out[i] === "number") { i++; continue; }

    const gapStart = i;
    while (i < out.length && typeof out[i] !== "number") i++;
    const gapEnd = i - 1;
    const gapLen = gapEnd - gapStart + 1;

    if (gapLen > maxGap) continue;

    const leftIdx = gapStart - 1;
    const rightIdx = gapEnd + 1;
    if (leftIdx < 0 || rightIdx >= out.length) continue;

    const left = out[leftIdx];
    const right = out[rightIdx];
    if (typeof left !== "number" || typeof right !== "number") continue;

    const step = (right - left) / (gapLen + 1);
    for (let k = 1; k <= gapLen; k++) {
      out[gapStart + (k - 1)] = left + step * k;
    }
  }
  return out;
}

export function cheapestWindow(series, slots) {
  let best = null;
  for (let i = 0; i <= series.length - slots; i++) {
    let ok = true;
    let sum = 0;
    for (let k = 0; k < slots; k++) {
      const v = series[i + k];
      if (typeof v !== "number") { ok = false; break; }
      sum += v;
    }
    if (!ok) continue;
    const avg = sum / slots;
    if (!best || avg < best.avg) best = { startIdx: i, endIdx: i + slots - 1, avg };
  }
  return best;
}

export function buildHighlightSeries(series, win) {
  if (!win) return null;
  const out = series.map(() => null);
  for (let i = win.startIdx; i <= win.endIdx; i++) {
    out[i] = series[i];
  }
  return out;
}

// ------------------------
// Labels & series builders
// ------------------------

/**
 * Bygger labels för ett dygn från day.points[].time
 */
export function buildDayLabels(day) {
  return (day?.points || []).map(p => p ? p.time : "");
}

/**
 * Bygger series (värden) för ett dygn från day.points[] och vald metric
 */
export function buildDaySeries(day, metric) {
  return (day?.points || []).map(p =>
    (p && typeof p[metric] === "number") ? p[metric] : null
  );
}

/**
 * Returnerar senaste nDays datum-keys (YYYY-MM-DD) från days-objektet
 */
export function buildRangeKeys(daysObj, nDays) {
  const keys = Object.keys(daysObj || {}).sort();
  if (!keys.length) return [];
  return keys.slice(-nDays);
}

/**
 * Bygger labels + series + refs för ett datumintervall (keys)
 * - labels: "MM-DD HH:MM"
 * - series: värde eller null
 * - refs: {dayKey, time} för windowTimeTextRange()
 *
 * slotToTimeFn(i, resolutionMinutes) måste ges in (kommer från app.js)
 */
export function buildRangeLabelsAndSeries(daysObj, keys, metric, slotToTimeFn) {
  const labels = [];
  const series = [];
  const refs = [];

  for (const dayKey of keys) {
    const day = daysObj?.[dayKey];
    if (!day?.points) continue;

    for (let i = 0; i < day.points.length; i++) {
      const p = day.points[i];
      const t = slotToTimeFn(i, day.resolutionMinutes);
      labels.push(`${dayKey.slice(5)} ${t}`);
      series.push((p && typeof p[metric] === "number") ? p[metric] : null);
      refs.push({ dayKey, time: t });
    }
  }

  return { labels, series, refs };
}

// ------------------------
// Window time text helpers
// ------------------------

/**
 * Text för fönster inom ett dygn: "YYYY-MM-DD HH:MM → YYYY-MM-DD HH:MM"
 * slotToTimeFn(startIdx, rm) måste ges in (kommer från app.js)
 */
export function windowTimeTextSingleDay(dayKey, day, win, slotToTimeFn) {
  if (!win) return "—";
  const rm = day?.resolutionMinutes ?? 15;
  const start = slotToTimeFn(win.startIdx, rm);
  const end = slotToTimeFn(win.endIdx, rm);
  return `${dayKey} ${start} → ${dayKey} ${end}`;
}

/**
 * Text för fönster i en labels/range-serie (refs-array):
 * "YYYY-MM-DD HH:MM → YYYY-MM-DD HH:MM"
 */
export function windowTimeTextRange(refs, win) {
  if (!win) return "—";
  const a = refs?.[win.startIdx];
  const b = refs?.[win.endIdx];
  if (!a?.dayKey || !a?.time || !b?.dayKey || !b?.time) return "—";
  return `${a.dayKey} ${a.time} → ${b.dayKey} ${b.time}`;
}

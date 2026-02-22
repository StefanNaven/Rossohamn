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

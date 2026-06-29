// lib/series.js

const DEFAULT_TIME_ZONE = "Europe/Stockholm";

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

export function interpolateSmallGapsLinear(values, maxGap = 8) {
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

// Bakåtkompatibelt exportnamn för eventuell extern kod.
export const fillSmallGapsLinear = interpolateSmallGapsLinear;

export function cheapestWindow(series, slots) {
  if (!Number.isInteger(slots) || slots <= 0) return null;

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

export function slotsForHours(hours, resolutionMinutes) {
  const rm = Number(resolutionMinutes);
  const h = Number(hours);
  if (!Number.isFinite(rm) || rm <= 0 || !Number.isFinite(h) || h <= 0) return 0;
  return Math.max(1, Math.round((h * 60) / rm));
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
// Date/time helpers
// ------------------------
function formatUtcParts(utcValue, timeZone = DEFAULT_TIME_ZONE) {
  const dt = utcValue instanceof Date ? utcValue : new Date(utcValue);
  if (!Number.isFinite(dt.getTime())) return null;

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(dt);

  const get = type => parts.find(p => p.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  if (![year, month, day, hour, minute].every(Boolean)) return null;

  return {
    dayKey: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    text: `${year}-${month}-${day} ${hour}:${minute}`
  };
}

export function formatUtcDateTime(utcValue, timeZone = DEFAULT_TIME_ZONE) {
  return formatUtcParts(utcValue, timeZone)?.text ?? null;
}

function fallbackEndText(dayKey, endIdx, resolutionMinutes, slotToTimeFn) {
  const rm = Number(resolutionMinutes) || 15;
  const totalMinutes = (endIdx + 1) * rm;
  const dayOffset = Math.floor(totalMinutes / (24 * 60));
  const minuteOfDay = totalMinutes % (24 * 60);
  const [y, m, d] = String(dayKey).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dayOffset));
  const endDay = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  const endTime = slotToTimeFn(Math.round(minuteOfDay / rm), rm);
  return `${endDay} ${endTime}`;
}

// ------------------------
// Labels & series builders
// ------------------------
function inferDayBaseUtcMs(day) {
  const rm = Number(day?.resolutionMinutes) || 15;
  const slotMs = rm * 60 * 1000;
  const points = day?.points || [];
  for (let i = 0; i < points.length; i++) {
    const utcMs = points[i]?.utc ? new Date(points[i].utc).getTime() : NaN;
    if (Number.isFinite(utcMs)) return utcMs - i * slotMs;
  }
  return null;
}

function inferredUtcForDayIndex(day, index) {
  const baseUtcMs = inferDayBaseUtcMs(day);
  if (!Number.isFinite(baseUtcMs)) return null;
  const rm = Number(day?.resolutionMinutes) || 15;
  return new Date(baseUtcMs + index * rm * 60 * 1000).toISOString();
}

/**
 * Bygger labels för ett dygn från day.points[].time
 */
export function buildDayLabels(day) {
  const rm = Number(day?.resolutionMinutes) || 15;
  return (day?.points || []).map((p, i) => {
    if (p?.time) return p.time;
    const inferredUtc = inferredUtcForDayIndex(day, i);
    const inferredTime = inferredUtc ? formatUtcParts(inferredUtc)?.time : null;
    if (inferredTime) return inferredTime;
    const total = i * rm;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
}

/**
 * Bygger serie (värden) för ett dygn från day.points[] och vald metric
 */
export function buildDaySeries(day, metric) {
  return (day?.points || []).map(p =>
    (p && typeof p[metric] === "number") ? p[metric] : null
  );
}

/**
 * Returnerar senaste nDays datum-keys (YYYY-MM-DD) fram till och med endDate.
 * Framtida datum tas inte med.
 */
export function buildRangeKeys(daysObj, nDays, endDate = null) {
  const keys = Object.keys(daysObj || {})
    .filter(k => !endDate || k <= endDate)
    .sort();
  if (!keys.length) return [];
  return keys.slice(-nDays);
}

/**
 * Bygger labels + series + refs för ett datumintervall (keys).
 */
export function buildRangeLabelsAndSeries(daysObj, keys, metric, slotToTimeFn) {
  const labels = [];
  const series = [];
  const refs = [];

  for (const dayKey of keys) {
    const day = daysObj?.[dayKey];
    if (!day?.points) continue;

    const rm = Number(day.resolutionMinutes) || 15;
    const baseUtcMs = inferDayBaseUtcMs(day);
    for (let i = 0; i < day.points.length; i++) {
      const p = day.points[i];
      const inferredUtc = Number.isFinite(baseUtcMs)
        ? new Date(baseUtcMs + i * rm * 60 * 1000).toISOString()
        : null;
      const utc = p?.utc ?? inferredUtc;
      const utcParts = utc ? formatUtcParts(utc) : null;
      const t = p?.time ?? utcParts?.time ?? slotToTimeFn(i, rm);
      labels.push(`${dayKey.slice(5)} ${t}`);
      series.push((p && typeof p[metric] === "number") ? p[metric] : null);
      refs.push({ dayKey, time: t, utc, resolutionMinutes: rm });
    }
  }

  return { labels, series, refs };
}

/**
 * Bygger ett exakt UTC-baserat fönster runt nuvarande tid.
 * Intervallet är slutexklusivt och fungerar över midnatt och DST-skiften.
 */
export function buildUtcWindowSeries(
  daysObj,
  metric,
  nowValue = new Date(),
  hoursBack = 2,
  hoursForward = 18,
  timeZone = DEFAULT_TIME_ZONE
) {
  const days = daysObj || {};
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Ogiltig tid för tidsfönster");

  const nowParts = formatUtcParts(now, timeZone);
  const today = nowParts?.dayKey ? days[nowParts.dayKey] : null;
  const firstDay = Object.keys(days).sort().map(k => days[k]).find(Boolean);
  const rm = Number(today?.resolutionMinutes ?? firstDay?.resolutionMinutes) || 15;
  const slotMs = rm * 60 * 1000;

  const pointMap = new Map();
  for (const day of Object.values(days)) {
    if (!Array.isArray(day?.points)) continue;
    for (const p of day.points) {
      if (!p?.utc) continue;
      const utcMs = new Date(p.utc).getTime();
      if (Number.isFinite(utcMs)) pointMap.set(utcMs, p);
    }
  }

  const currentSlotStartMs = Math.floor(nowMs / slotMs) * slotMs;
  const startUtcMs = currentSlotStartMs - hoursBack * 60 * 60 * 1000;
  const endUtcMs = currentSlotStartMs + hoursForward * 60 * 60 * 1000;

  const labels = [];
  const series = [];
  const refs = [];

  for (let utcMs = startUtcMs; utcMs < endUtcMs; utcMs += slotMs) {
    const parts = formatUtcParts(utcMs, timeZone);
    const p = pointMap.get(utcMs);
    labels.push(parts?.text ?? new Date(utcMs).toISOString());
    series.push((p && typeof p[metric] === "number") ? p[metric] : null);
    refs.push({
      dayKey: parts?.dayKey ?? "",
      time: parts?.time ?? "",
      utc: new Date(utcMs).toISOString(),
      resolutionMinutes: rm
    });
  }

  return {
    labels,
    series,
    refs,
    resolutionMinutes: rm,
    startUtcMs,
    endUtcMs,
    currentSlotStartMs
  };
}

// ------------------------
// Window time text helpers
// ------------------------

/**
 * Text för fönster inom ett dygn. Sluttiden är slutexklusiv.
 */
export function windowTimeTextSingleDay(dayKey, day, win, slotToTimeFn, timeZone = DEFAULT_TIME_ZONE) {
  if (!win) return "—";
  const rm = Number(day?.resolutionMinutes) || 15;
  const startUtc = day?.points?.[win.startIdx]?.utc ?? inferredUtcForDayIndex(day, win.startIdx);
  const endUtc = day?.points?.[win.endIdx]?.utc ?? inferredUtcForDayIndex(day, win.endIdx);

  if (startUtc && endUtc) {
    const startText = formatUtcDateTime(startUtc, timeZone);
    const endText = formatUtcDateTime(new Date(endUtc).getTime() + rm * 60 * 1000, timeZone);
    if (startText && endText) return `${startText} → ${endText}`;
  }

  const start = slotToTimeFn(win.startIdx, rm);
  const endText = fallbackEndText(dayKey, win.endIdx, rm, slotToTimeFn);
  return `${dayKey} ${start} → ${endText}`;
}

/**
 * Text för fönster i en range-serie. Sluttiden är slutexklusiv.
 */
export function windowTimeTextRange(refs, win, timeZone = DEFAULT_TIME_ZONE) {
  if (!win) return "—";
  const a = refs?.[win.startIdx];
  const b = refs?.[win.endIdx];
  if (!a || !b) return "—";

  if (a.utc && b.utc) {
    const rm = Number(b.resolutionMinutes) || 15;
    const startText = formatUtcDateTime(a.utc, timeZone);
    const endText = formatUtcDateTime(new Date(b.utc).getTime() + rm * 60 * 1000, timeZone);
    if (startText && endText) return `${startText} → ${endText}`;
  }

  if (!a.dayKey || !a.time || !b.dayKey || !b.time) return "—";
  return `${a.dayKey} ${a.time} → ${b.dayKey} ${b.time}`;
}

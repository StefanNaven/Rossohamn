import { attachCostExamples } from "./cost-examples.js";

(() => {
  const DEFAULT_SRC = "history.json";
  const el = (id) => document.getElementById(id);

  const state = {
    data: null,
    tab: "today",          // today|tomorrow|day|7d|14d|30d
    selectedDate: null,
    metric: "oreKwh",
    fillGaps: false,
    krLines: false,
  };

  // används av plugin för att skriva text i graf 2 när imorgon saknas
  let publishWindowHasTomorrow = true;

  // Cost-examples hooks (modul)
  let costHookMain = null;
  let costHook14 = null;

  // ----- Time helpers -----
  function stockholmTodayIsoDate() {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const d = parts.find(p => p.type === "day").value;
    return `${y}-${m}-${d}`;
  }

  function addDays(yyyyMmDd, deltaDays) {
    const [y,m,d] = yyyyMmDd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m-1, d));
    dt.setUTCDate(dt.getUTCDate() + deltaDays);
    const y2 = dt.getUTCFullYear();
    const m2 = String(dt.getUTCMonth()+1).padStart(2,"0");
    const d2 = String(dt.getUTCDate()).padStart(2,"0");
    return `${y2}-${m2}-${d2}`;
  }

  function slotToTime(slotIndex, resolutionMinutes) {
    const rm = Number(resolutionMinutes) || 15;
    const total = slotIndex * rm;
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    return String(hh).padStart(2,"0") + ":" + String(mm).padStart(2,"0");
  }

  function timeToIndex(timeStr, resolutionMinutes) {
    const [hh, mm] = timeStr.split(":").map(Number);
    const rm = Number(resolutionMinutes) || 15;
    return Math.floor((hh * 60 + mm) / rm);
  }

  function getParam(name) {
    const u = new URL(location.href);
    return u.searchParams.get(name);
  }

  function fmtNum(v, decimals=2) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Number(v).toFixed(decimals);
  }

  function decimals() {
    return (state.metric === "oreKwh") ? 2 : 4;
  }

  function unitLabel() {
    switch (state.metric) {
      case "oreKwh": return "öre/kWh";
      case "sekKwh": return "SEK/kWh";
      case "eurMwh": return "EUR/MWh";
      default: return state.metric;
    }
  }

  function sekKwhToMetricY(sekKwhValue) {
    if (typeof sekKwhValue !== "number") return null;

    if (state.metric === "sekKwh") return sekKwhValue;
    if (state.metric === "oreKwh") return sekKwhValue * 100.0;

    if (state.metric === "eurMwh") {
      const eursek = Number(state.data?.meta?.eursek);
      if (!eursek || Number.isNaN(eursek)) return null;

      const sekPerMwh = sekKwhValue * 1000.0;
      const eurPerMwh = sekPerMwh / eursek;
      return eurPerMwh;
    }

    return null;
  }

  function computeStats(series) {
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

  function fillSmallGapsLinear(values, maxGap = 8) {
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

  function buildDayLabels(day) {
    return day.points.map(p => p ? p.time : "");
  }

  function buildDaySeries(day) {
    return day.points.map(p => (p && typeof p[state.metric] === "number") ? p[state.metric] : null);
  }

  function buildRangeKeys(nDays) {
    const keys = Object.keys(state.data?.days || {}).sort();
    if (!keys.length) return [];
    return keys.slice(-nDays);
  }

  function buildRangeLabelsAndSeries(keys) {
    const labels = [];
    const series = [];
    const refs = [];

    for (const dayKey of keys) {
      const day = state.data.days[dayKey];
      if (!day?.points) continue;

      for (let i = 0; i < day.points.length; i++) {
        const p = day.points[i];
        const t = slotToTime(i, day.resolutionMinutes);
        labels.push(`${dayKey.slice(5)} ${t}`);
        series.push((p && typeof p[state.metric] === "number") ? p[state.metric] : null);
        refs.push({ dayKey, time: t });
      }
    }
    return { labels, series, refs };
  }

  function cheapestWindow(series, slots) {
    let best = null;
    for (let i = 0; i <= series.length - slots; i++) {
      let ok = true;
      let sum = 0;
      for (let k = 0; k < slots; k++) {
        const v = series[i+k];
        if (typeof v !== "number") { ok = false; break; }
        sum += v;
      }
      if (!ok) continue;
      const avg = sum / slots;
      if (!best || avg < best.avg) best = { startIdx: i, endIdx: i + slots - 1, avg };
    }
    return best;
  }

  function buildHighlightSeries(series, win) {
    if (!win) return null;
    const out = series.map(() => null);
    for (let i = win.startIdx; i <= win.endIdx; i++) out[i] = series[i];
    return out;
  }

  function lineGradientColor(ctx) {
    const { chart } = ctx;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return "#9fd4ff";

    const g = c.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    g.addColorStop(0.00, "#2ecc71");
    g.addColorStop(0.50, "#3498db");
    g.addColorStop(1.00, "#e74c3c");
    return g;
  }

  // "Now" vertical line (chart + chart14)
  const nowLinePlugin = {
    id: "nowLine",
    afterDraw(chart) {
      const isMain = chart?.canvas?.id === "chart";
      const is14   = chart?.canvas?.id === "chart14";

      if (!isMain && !is14) return;
      if (isMain && state.tab !== "today") return; // huvudgrafen: bara i "Idag"

      const xScale = chart.scales.x;
      if (!xScale) return;

      const now = new Date();
      const hh = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit" }).format(now));
      const mm = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", minute: "2-digit" }).format(now));

      const rm =
        Number(state.data?.days?.[stockholmTodayIsoDate()]?.resolutionMinutes) ||
        15;

      const slotsPerHour = Math.max(1, Math.round(60 / rm));
      const slotNow = hh * slotsPerHour + Math.floor(mm / rm);

      let xIndex = slotNow;

      if (is14) {
        const startIdx = Math.floor((14 * 60) / rm);
        const slotsPerDay = Math.floor((24 * 60) / rm);

        if (slotNow >= startIdx) {
          xIndex = slotNow - startIdx;               // idag-delen
        } else {
          xIndex = (slotsPerDay - startIdx) + slotNow; // imorgon-delen (före 14:00)
        }
      }

      const x = xScale.getPixelForValue(xIndex);
      if (!Number.isFinite(x)) return;

      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  // Text-overlay i graf 2 när imorgon saknas
  const publishWindowNoticePlugin = {
    id: "publishWindowNotice",
    afterDraw(chart) {
      if (chart?.canvas?.id !== "chart14") return;
      if (publishWindowHasTomorrow) return;

      const area = chart.chartArea;
      if (!area) return;

      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(255, 220, 220, 0.92)";
      ctx.textAlign = "center";

      const x = (area.left + area.right) / 2;
      const y = area.top + 18;

      ctx.fillText("Morgondagens priser är ännu inte publicerade", x, y);
      ctx.restore();
    }
  };

  Chart.register(nowLinePlugin, publishWindowNoticePlugin);

  let chart = null;
  let chart14 = null;

  function windowTimeTextSingleDay(dayKey, day, win) {
    if (!win) return "—";
    const rm = day?.resolutionMinutes ?? 15;
    const start = slotToTime(win.startIdx, rm);
    const end = slotToTime(win.endIdx, rm);
    return `${dayKey} ${start} → ${dayKey} ${end}`;
  }

  function windowTimeTextRange(refs, win) {
    if (!win) return "—";
    const a = refs?.[win.startIdx];
    const b = refs?.[win.endIdx];
    if (!a?.dayKey || !a?.time || !b?.dayKey || !b?.time) return "—";
    return `${a.dayKey} ${a.time} → ${b.dayKey} ${b.time}`;
  }

  function renderSummary({ stats, win2h, win4h, win8h, infoText, timeText2h, timeText4h, timeText8h }) {
    const dec = decimals();

    el("summaryNote").textContent = state.fillGaps
      ? "Billigaste fönster kan använda extrapolerade punkter (≤8 null i rad). Rådata ändras inte."
      : "Billigaste fönster kräver komplett fönster (inga null).";

    const row = (label, win, hours, timeText) => {
      if (!win) return `
        <tr>
          <td>${label}</td><td>—</td><td>—</td><td>Inget komplett ${hours}h-fönster</td>
        </tr>`;
      return `
        <tr>
          <td>${label}</td>
          <td><b>${fmtNum(win.avg, dec)}</b> ${unitLabel()}</td>
          <td>${timeText}</td>
          <td>${state.fillGaps ? "Kan inkludera extrapolerade punkter" : "Endast rådata utan null"}</td>
        </tr>`;
    };

    el("summary").innerHTML = `
      <div class="row">
        <span class="pill">${infoText}</span>
        <span class="pill">Medel: <b>${fmtNum(stats.avg, dec)}</b> ${unitLabel()}</span>
        <span class="pill">Min: <b>${fmtNum(stats.min, dec)}</b></span>
        <span class="pill">Max: <b>${fmtNum(stats.max, dec)}</b></span>
        <span class="pill">Punkter: <b>${stats.count}</b></span>
        ${state.fillGaps ? `<span class="pill">Extrapolering: <b>ON</b> (≤8)</span>` : `<span class="pill">Extrapolering: <b>OFF</b></span>`}
      </div>

      <table style="margin-top:10px;">
        <thead><tr><th>Fönster</th><th>Medel</th><th>Tidsintervall</th><th>Not</th></tr></thead>
        <tbody>
          ${row("Billigaste 2h", win2h, 2, timeText2h)}
          ${row("Billigaste 4h", win4h, 4, timeText4h)}
          ${row("Billigaste 8h", win8h, 8, timeText8h)}
        </tbody>
      </table>
    `;
  }

  function renderSummaryTo(noteElId, summaryElId, { stats, win2h, win4h, win8h, infoText, timeText2h, timeText4h, timeText8h, noteText }) {
    const dec = decimals();
    el(noteElId).textContent = noteText;

    const row = (label, win, hours, timeText) => {
      if (!win) return `
        <tr>
          <td>${label}</td><td>—</td><td>—</td><td>Inget komplett ${hours}h-fönster</td>
        </tr>`;
      return `
        <tr>
          <td>${label}</td>
          <td><b>${fmtNum(win.avg, dec)}</b> ${unitLabel()}</td>
          <td>${timeText}</td>
          <td>${state.fillGaps ? "Kan inkludera extrapolerade punkter" : "Endast rådata utan null"}</td>
        </tr>`;
    };

    el(summaryElId).innerHTML = `
      <div class="row">
        <span class="pill">${infoText}</span>
        <span class="pill">Medel: <b>${fmtNum(stats.avg, dec)}</b> ${unitLabel()}</span>
        <span class="pill">Min: <b>${fmtNum(stats.min, dec)}</b></span>
        <span class="pill">Max: <b>${fmtNum(stats.max, dec)}</b></span>
        <span class="pill">Punkter: <b>${stats.count}</b></span>
        ${state.fillGaps ? `<span class="pill">Extrapolering: <b>ON</b> (≤8)</span>` : `<span class="pill">Extrapolering: <b>OFF</b></span>`}
      </div>

      <table style="margin-top:10px;">
        <thead><tr><th>Fönster</th><th>Medel</th><th>Tidsintervall</th><th>Not</th></tr></thead>
        <tbody>
          ${row("Billigaste 2h", win2h, 2, timeText2h)}
          ${row("Billigaste 4h", win4h, 4, timeText4h)}
          ${row("Billigaste 8h", win8h, 8, timeText8h)}
        </tbody>
      </table>
    `;
  }

  function legendOnClick(e, legendItem, legend) {
    const chart = legend.chart;
    const idx = legendItem.datasetIndex;
    const ds = chart.data.datasets[idx];
    if (!ds) return;

    if (idx === 0) return;

    const meta = chart.getDatasetMeta(idx);
    meta.hidden = meta.hidden === null ? !chart.data.datasets[idx].hidden : null;
    chart.update();
  }

  // --- Cost-examples: initiera hooks en gång, och bind:a när charts skapas/återskapas ---
  function ensureCostHooks() {
    if (costHookMain && costHook14) return;

    costHookMain = attachCostExamples({
      chartGetter: () => chart,
      labelGetter: (ch, i) => ch.data.labels?.[i] ?? "",
      valueGetter: (ch, i) => ch.data.datasets?.[0]?.data?.[i],
      metricGetter: () => state.metric,
      eursekGetter: () => Number(state.data?.meta?.eursek),
      metricLabelGetter: () => unitLabel(),
      cardElementId: "costCard"
    });

    costHook14 = attachCostExamples({
      chartGetter: () => chart14,
      labelGetter: (ch, i) => ch.data.labels?.[i] ?? "",
      valueGetter: (ch, i) => ch.data.datasets?.[0]?.data?.[i],
      metricGetter: () => state.metric,
      eursekGetter: () => Number(state.data?.meta?.eursek),
      metricLabelGetter: () => unitLabel(),
      cardElementId: "costCard"
    });
  }

  function bindCostClicksIfReady() {
    ensureCostHooks();
    costHookMain?.bind?.();
    costHook14?.bind?.();
  }

  function renderChartSingleDay(dateKey) {
    const day = state.data?.days?.[dateKey];
    const ctx = el("chart").getContext("2d");

    if (!day) {
      if (chart) chart.destroy();
      chart = null;
      el("summary").innerHTML = `<div>Inget dygn hittades för <b>${dateKey}</b>.</div>`;
      return;
    }

    const labels = buildDayLabels(day);
    const rawSeries = buildDaySeries(day);
    const series = state.fillGaps ? fillSmallGapsLinear(rawSeries, 8) : rawSeries;

    const stats = computeStats(series);

    const win2h = cheapestWindow(series, 8);
    const win4h = cheapestWindow(series, 16);
    const win8h = cheapestWindow(series, 32);

    const hi2 = buildHighlightSeries(series, win2h);
    const hi4 = buildHighlightSeries(series, win4h);
    const hi8 = buildHighlightSeries(series, win8h);

    const datasets = [
      {
        label: unitLabel(),
        data: series,
        spanGaps: false,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
        borderColor: lineGradientColor,
        borderJoinStyle: "round",
        borderCapStyle: "round"
      }
    ];

    if (hi8) datasets.push({ label: "Billigaste 8h", data: hi8, pointRadius: 0, borderWidth: 6, tension: 0.2, borderColor: "rgba(255,255,255,0.40)" });
    if (hi4) datasets.push({ label: "Billigaste 4h", data: hi4, pointRadius: 0, borderWidth: 5, tension: 0.2, borderColor: "rgba(120,220,255,0.85)" });
    if (hi2) datasets.push({ label: "Billigaste 2h", data: hi2, pointRadius: 0, borderWidth: 6, tension: 0.2, borderColor: "rgba(255,215,120,0.95)" });

    if (state.krLines) {
      const y1 = sekKwhToMetricY(1);
      const y2 = sekKwhToMetricY(2);
      const y3 = sekKwhToMetricY(3);

      const addH = (y, label) => {
        if (typeof y !== "number" || Number.isNaN(y)) return;
        datasets.push({
          label,
          data: labels.map(() => y),
          pointRadius: 0,
          borderWidth: 1,
          borderDash: [4,4],
          borderColor: "rgba(255,255,255,0.25)"
        });
      };

      addH(y1, "≈ 1 kr/kWh");
      addH(y2, "≈ 2 kr/kWh");
      addH(y3, "≈ 3 kr/kWh");
    }

    const title = `${dateKey} (${unitLabel()}) – present ${day.present}/${day.expected}` +
      (state.fillGaps ? " (extrapolerat ≤8 null)" : "");

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, onClick: legendOnClick },
          title: { display: true, text: title },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (items) => items?.[0]?.label || "",
              label: (c) => {
                const v = c.parsed?.y;
                if (v === null || v === undefined || Number.isNaN(v)) return "—";
                return `${c.dataset.label}: ${v.toFixed(decimals())}`;
              },
              afterLabel: (c) => {
                const idx = c.dataIndex;
                const p = day?.points?.[idx];
                if (!p?.utc) return "";
                const note = (p && typeof p[state.metric] === "number")
                  ? ""
                  : (state.fillGaps ? " (extrapolerad punkt)" : " (saknas i rådata)");
                return `UTC: ${p.utc}${note}`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { title: { display: true, text: unitLabel() } }
        }
      }
    });

    bindCostClicksIfReady();

    renderSummary({
      stats,
      win2h,
      win4h,
      win8h,
      infoText: `Dygn: <b>${dateKey}</b> (${day.resolutionMinutes ?? "—"} min)`,
      timeText2h: windowTimeTextSingleDay(dateKey, day, win2h),
      timeText4h: windowTimeTextSingleDay(dateKey, day, win4h),
      timeText8h: windowTimeTextSingleDay(dateKey, day, win8h),
    });
  }

  function renderChartRange(nDays) {
    const ctx = el("chart").getContext("2d");
    const keys = buildRangeKeys(nDays);

    if (!keys.length) {
      if (chart) chart.destroy();
      chart = null;
      el("summary").innerHTML = `<div>Ingen historik hittades.</div>`;
      return;
    }

    const { labels, series: rawSeries, refs } = buildRangeLabelsAndSeries(keys);
    const series = state.fillGaps ? fillSmallGapsLinear(rawSeries, 8) : rawSeries;

    const stats = computeStats(series);

    const win2h = cheapestWindow(series, 8);
    const win4h = cheapestWindow(series, 16);
    const win8h = cheapestWindow(series, 32);

    const hi2 = buildHighlightSeries(series, win2h);
    const hi4 = buildHighlightSeries(series, win4h);
    const hi8 = buildHighlightSeries(series, win8h);

    const datasets = [
      {
        label: `${unitLabel()} (${nDays}d)`,
        data: series,
        spanGaps: false,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.15,
        borderColor: lineGradientColor,
        borderJoinStyle: "round",
        borderCapStyle: "round"
      }
    ];

    if (hi8) datasets.push({ label: "Billigaste 8h", data: hi8, pointRadius: 0, borderWidth: 6, tension: 0.15, borderColor: "rgba(255,255,255,0.40)" });
    if (hi4) datasets.push({ label: "Billigaste 4h", data: hi4, pointRadius: 0, borderWidth: 5, tension: 0.15, borderColor: "rgba(120,220,255,0.85)" });
    if (hi2) datasets.push({ label: "Billigaste 2h", data: hi2, pointRadius: 0, borderWidth: 6, tension: 0.15, borderColor: "rgba(255,215,120,0.95)" });

    if (state.krLines) {
      const y1 = sekKwhToMetricY(1);
      const y2 = sekKwhToMetricY(2);
      const y3 = sekKwhToMetricY(3);

      const addH = (y, label) => {
        if (typeof y !== "number" || Number.isNaN(y)) return;
        datasets.push({
          label,
          data: labels.map(() => y),
          pointRadius: 0,
          borderWidth: 1,
          borderDash: [4,4],
          borderColor: "rgba(255,255,255,0.25)"
        });
      };

      addH(y1, "≈ 1 kr/kWh");
      addH(y2, "≈ 2 kr/kWh");
      addH(y3, "≈ 3 kr/kWh");
    }

    const title = `Senaste ${nDays} dagar (${unitLabel()})` + (state.fillGaps ? " (extrapolerat ≤8 null)" : "");

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, onClick: legendOnClick },
          title: { display: true, text: title },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (items) => items?.[0]?.label || "",
              label: (c) => {
                const v = c.parsed?.y;
                if (v === null || v === undefined || Number.isNaN(v)) return "—";
                return `${c.dataset.label}: ${v.toFixed(decimals())}`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: { title: { display: true, text: unitLabel() } }
        }
      }
    });

    bindCostClicksIfReady();

    renderSummary({
      stats,
      win2h,
      win4h,
      win8h,
      infoText: `Intervall: <b>${keys[0]}</b> → <b>${keys[keys.length-1]}</b>`,
      timeText2h: windowTimeTextRange(refs, win2h),
      timeText4h: windowTimeTextRange(refs, win4h),
      timeText8h: windowTimeTextRange(refs, win8h),
    });
  }

  // rendera graf 14:00->framåt från history.json.
  // Om imorgon saknas: fyll ändå upp hela imorgon med null-värden så x-axeln blir komplett.
function renderPublishWindowFromHistory() {
  const ctx = el("chart14")?.getContext?.("2d");
  if (!ctx) return;

  const days = state.data?.days || {};
  const todayKey = stockholmTodayIsoDate();
  const tomorrowKey = addDays(todayKey, 1);

  const today = days[todayKey];
  const tomorrow = days[tomorrowKey];

  if (!today || !Array.isArray(today.points)) {
    if (chart14) chart14.destroy();
    chart14 = null;
    el("summaryNote14").textContent = "Saknar data för idag.";
    el("summary14").innerHTML = "";
    return;
  }

  const rm = Number(today.resolutionMinutes) || 15;
  const slotsPerDay = Math.floor((24 * 60) / rm);

  // --- Nuvarande tid (Stockholm) ---
  const now = new Date();
  const hh = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit" }).format(now));
  const mm = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", minute: "2-digit" }).format(now));

  const slotNow = Math.floor((hh * 60 + mm) / rm);

  const slotsBack = Math.floor((2 * 60) / rm);
  const slotsForward = Math.floor((18 * 60) / rm);

  const startAbs = slotNow - slotsBack;
  const endAbs = slotNow + slotsForward;

  const labels = [];
  const rawSeries = [];
  const refs = [];

  for (let abs = startAbs; abs <= endAbs; abs++) {

    let dayKey, dayObj, slotIndex;

    if (abs < 0) {
      // igår (stöds ej → null)
      continue;
    }
    else if (abs < slotsPerDay) {
      dayKey = todayKey;
      dayObj = today;
      slotIndex = abs;
    }
    else {
      dayKey = tomorrowKey;
      dayObj = tomorrow;
      slotIndex = abs - slotsPerDay;
    }

    const t = slotToTime(slotIndex, rm);
    labels.push(`${dayKey} ${t}`);

    if (dayObj && Array.isArray(dayObj.points)) {
      const p = dayObj.points[slotIndex];
      rawSeries.push((p && typeof p[state.metric] === "number") ? p[state.metric] : null);
    } else {
      rawSeries.push(null);
    }

    refs.push({ dayKey, time: t });
  }

  const series = state.fillGaps ? fillSmallGapsLinear(rawSeries, 8) : rawSeries;
  const stats = computeStats(series);

  const win2h = cheapestWindow(series, Math.floor((2*60)/rm));
  const win4h = cheapestWindow(series, Math.floor((4*60)/rm));
  const win8h = cheapestWindow(series, Math.floor((8*60)/rm));

  const hi2 = buildHighlightSeries(series, win2h);
  const hi4 = buildHighlightSeries(series, win4h);
  const hi8 = buildHighlightSeries(series, win8h);

  const datasets = [{
    label: `${unitLabel()} (nu -2h → +18h)`,
    data: series,
    spanGaps: false,
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.2,
    borderColor: lineGradientColor
  }];

  if (hi8) datasets.push({ label: "Billigaste 8h", data: hi8, pointRadius: 0, borderWidth: 6 });
  if (hi4) datasets.push({ label: "Billigaste 4h", data: hi4, pointRadius: 0, borderWidth: 5 });
  if (hi2) datasets.push({ label: "Billigaste 2h", data: hi2, pointRadius: 0, borderWidth: 6 });

  if (chart14) chart14.destroy();

  chart14 = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, onClick: legendOnClick },
        title: {
          display: true,
          text: `Nu -2h → +18h (${unitLabel()})`
        }
      },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
        y: { title: { display: true, text: unitLabel() } }
      }
    }
  });

  renderSummaryTo("summaryNote14", "summary14", {
    stats,
    win2h,
    win4h,
    win8h,
    infoText: "Rörligt fönster runt nuvarande tid",
    timeText2h: windowTimeTextRange(refs, win2h),
    timeText4h: windowTimeTextRange(refs, win4h),
    timeText8h: windowTimeTextRange(refs, win8h),
    noteText: "Saknade timmar visas som tomma."
  });
}


  function render() {
    if (!state.data?.days) return;

    // alltid rendera 14:00-grafen (den följer metric/fillGaps/krLines)
    renderPublishWindowFromHistory();

    if (state.tab === "today") {
      state.selectedDate = stockholmTodayIsoDate();
      el("datePick").value = state.selectedDate || "";
      renderChartSingleDay(state.selectedDate);
      return;
    }

    if (state.tab === "tomorrow") {
      const tmr = addDays(stockholmTodayIsoDate(), 1);
      state.selectedDate = tmr;
      el("datePick").value = state.selectedDate || "";
      renderChartSingleDay(state.selectedDate);
      return;
    }

    if (state.tab === "day") {
      state.selectedDate = el("datePick").value || state.selectedDate;
      el("datePick").value = state.selectedDate || "";
      renderChartSingleDay(state.selectedDate);
      return;
    }

    if (state.tab === "7d") return renderChartRange(7);
    if (state.tab === "14d") return renderChartRange(14);
    if (state.tab === "30d") return renderChartRange(30);
  }

  function setTab(tab) {
    state.tab = tab;

    const ids = ["today","tomorrow","day","7d","14d","30d"];
    ids.forEach(t => el(`tab-${t}`).classList.toggle("active", tab === t));

    render();
  }

  function renderMeta() {
    const m = state.data?.meta;
    if (!m) { el("meta").textContent = ""; return; }

    el("meta").innerHTML = `
      <div class="row">
        <span class="pill">area: <b>${m.area}</b></span>
        <span class="pill">documentType: <b>${m.documentType}</b></span>
        <span class="pill">tz: <b>${m.timeZone}</b></span>
        <span class="pill">EUR/SEK: <b>${m.eursek}</b> (${m.eursekDate})</span>
        <span class="pill">updatedAt: <b>${m.updatedAt}</b></span>
      </div>
      <div class="small" style="margin-top:8px;">
        request: ${m.request?.periodStart ?? "—"} → ${m.request?.periodEnd ?? "—"}
      </div>
    `;
  }

  function populateDatePick() {
    const days = state.data?.days || {};
    const keys = Object.keys(days).sort();
    const dp = el("datePick");

    dp.innerHTML = keys.map(k => {
      const d = days[k];
      return `<option value="${k}">${k} (${d.present}/${d.expected})</option>`;
    }).join("");

    const today = stockholmTodayIsoDate();
    state.selectedDate = keys.includes(today) ? today : (keys[keys.length - 1] || null);
    dp.value = state.selectedDate || "";
  }

  async function loadHistory(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} vid GET ${url}`);
    return await r.json();
  }

  function loadSettings() {
    const fg = localStorage.getItem("rossohamn_fillGaps");
    state.fillGaps = (fg === "1");
    el("fillGaps").checked = state.fillGaps;

    const kl = localStorage.getItem("rossohamn_krLines");
    state.krLines = (kl === "1");
    el("krLines").checked = state.krLines;
  }

  function saveSettings() {
    localStorage.setItem("rossohamn_fillGaps", state.fillGaps ? "1" : "0");
    localStorage.setItem("rossohamn_krLines", state.krLines ? "1" : "0");
  }

  function stepDay(delta) {
    const keys = Object.keys(state.data?.days || {}).sort();
    if (!keys.length) return;

    const current = el("datePick").value || state.selectedDate;
    const idx = keys.indexOf(current);
    if (idx === -1) return;

    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= keys.length) return;

    state.selectedDate = keys[nextIdx];
    el("datePick").value = state.selectedDate;
    setTab("day");
  }

  async function bootstrap() {
    const src = getParam("src") || DEFAULT_SRC;
    el("src").value = src;

    state.metric = el("metric").value;
    loadSettings();

    try {
      state.data = await loadHistory(src);
      renderMeta();
      populateDatePick();

      ensureCostHooks();

      setTab("today");
      bindCostClicksIfReady();
    } catch (e) {
      el("meta").innerHTML = `<div style="color:#ff9a9a;"><b>Fel:</b> ${e.message}</div>`;

      if (chart) chart.destroy();
      chart = null;

      if (chart14) chart14.destroy();
      chart14 = null;

      publishWindowHasTomorrow = true;

      el("summary").innerHTML = "";
      el("summaryNote").textContent = "";
      el("summary14").innerHTML = "";
      el("summaryNote14").textContent = "";
    }
  }

  // ----- Events -----
  el("reload").addEventListener("click", bootstrap);

  el("tab-today").addEventListener("click", () => setTab("today"));
  el("tab-tomorrow").addEventListener("click", () => setTab("tomorrow"));
  el("tab-day").addEventListener("click", () => setTab("day"));
  el("tab-7d").addEventListener("click", () => setTab("7d"));
  el("tab-14d").addEventListener("click", () => setTab("14d"));
  el("tab-30d").addEventListener("click", () => setTab("30d"));

  el("metric").addEventListener("change", () => {
    state.metric = el("metric").value;
    render();
  });

  el("datePick").addEventListener("change", () => {
    state.selectedDate = el("datePick").value;
    setTab("day");
  });

  el("fillGaps").addEventListener("change", () => {
    state.fillGaps = el("fillGaps").checked;
    saveSettings();
    render();
  });

  el("krLines").addEventListener("change", () => {
    state.krLines = el("krLines").checked;
    saveSettings();
    render();
  });

  el("prevDay").addEventListener("click", () => stepDay(-1));
  el("nextDay").addEventListener("click", () => stepDay(1));

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") stepDay(-1);
    if (e.key === "ArrowRight") stepDay(1);
  });

  bootstrap();
})();

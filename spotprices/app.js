import { attachCostExamples } from "./cost-examples.js";

import {
  computeStats,
  interpolateSmallGapsLinear,
  cheapestWindow,
  buildHighlightSeries,
  windowTimeTextSingleDay,
  windowTimeTextRange,
  buildDayLabels,
  buildDaySeries,
  buildRangeKeys,
  buildRangeLabelsAndSeries,
  buildUtcWindowSeries,
  slotsForHours
} from "./lib/series.js";

import {
  lineGradientColor,
  legendOnClick,
  makeNowLinePlugin,
  makePublishWindowNoticePlugin,
  registerChartPlugins
} from "./lib/chart-utils.js";

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
    chartMode: "auto",     // auto|line|bar
  };

  // används av plugin för att skriva text i graf 2 när imorgon saknas
  let publishWindowHasTomorrow = true;

  // används av "nowLine"-plugin för att veta hur chart14 indexeras
  let chart14Window = null; // { rm, startUtcMs, endUtcMs }

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
  
  function getEffectiveChartMode(scope) {
    if (state.chartMode === "line") return "line";
    if (state.chartMode === "bar") return "bar";
  
    // auto
    if (scope === "singleDay") return "bar";
    if (scope === "publishWindow") return "bar";
    if (scope === "range") return "line";
  
    return "line";
  }

  function buildBarColors(series, win2h, win4h, win8h) {
    const isInside = (idx, win) =>
      !!win &&
      Number.isInteger(win.startIdx) &&
      Number.isInteger(win.endIdx) &&
      idx >= win.startIdx &&
      idx <= win.endIdx;
  
    return {
      backgroundColor: series.map((v, idx) => {
        if (v === null || v === undefined || Number.isNaN(v)) {
          return "rgba(0,0,0,0)";
        }
  
        if (isInside(idx, win2h)) return "rgba(46, 204, 113, 0.95)";
        if (isInside(idx, win4h)) return "rgba(46, 204, 113, 0.65)";
        if (isInside(idx, win8h)) return "rgba(46, 204, 113, 0.35)";
  
        return "rgba(120,190,255,0.65)";
      }),
  
      borderColor: series.map((v, idx) => {
        if (v === null || v === undefined || Number.isNaN(v)) {
          return "rgba(0,0,0,0)";
        }
  
        if (isInside(idx, win2h)) return "rgba(46, 204, 113, 1)";
        if (isInside(idx, win4h)) return "rgba(46, 204, 113, 0.85)";
        if (isInside(idx, win8h)) return "rgba(46, 204, 113, 0.60)";
  
        return "rgba(120,190,255,0.95)";
      })
    };
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

  // ----- Plugins (via chart-utils.js) -----
  const nowLinePlugin = makeNowLinePlugin({
    isMainTabToday: () => state.tab === "today",
    getMainResolutionMinutes: () =>
      Number(state.data?.days?.[stockholmTodayIsoDate()]?.resolutionMinutes) || 15,
    getChart14Window: () => chart14Window
  });

  const publishWindowNoticePlugin = makePublishWindowNoticePlugin({
    getHasTomorrow: () => publishWindowHasTomorrow
  });

  registerChartPlugins(Chart, [nowLinePlugin, publishWindowNoticePlugin]);

  let chart = null;
  let chart14 = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function summaryMarkup({ stats, win2h, win4h, win8h, infoText, timeText2h, timeText4h, timeText8h }) {
    const dec = decimals();
    const safeUnit = escapeHtml(unitLabel());

    const row = (label, win, hours, timeText) => {
      if (!win) return `
        <tr>
          <td>${escapeHtml(label)}</td><td>—</td><td>—</td><td>Inget komplett ${hours}h-fönster</td>
        </tr>`;
      return `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td><b>${escapeHtml(fmtNum(win.avg, dec))}</b> ${safeUnit}</td>
          <td>${escapeHtml(timeText)}</td>
          <td>${state.fillGaps ? "Kan inkludera interpolerade punkter" : "Endast rådata utan null"}</td>
        </tr>`;
    };

    return `
      <div class="row">
        <span class="pill">${escapeHtml(infoText)}</span>
        <span class="pill">Medel: <b>${escapeHtml(fmtNum(stats.avg, dec))}</b> ${safeUnit}</span>
        <span class="pill">Min: <b>${escapeHtml(fmtNum(stats.min, dec))}</b></span>
        <span class="pill">Max: <b>${escapeHtml(fmtNum(stats.max, dec))}</b></span>
        <span class="pill">Punkter: <b>${escapeHtml(stats.count)}</b></span>
        ${state.fillGaps ? `<span class="pill">Interpolering: <b>ON</b> (≤8)</span>` : `<span class="pill">Interpolering: <b>OFF</b></span>`}
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

  function renderSummary(args) {
    el("summaryNote").textContent = state.fillGaps
      ? "Billigaste fönster kan använda interpolerade punkter (≤8 null i rad). Rådata ändras inte."
      : "Billigaste fönster kräver komplett fönster (inga null).";
    el("summary").innerHTML = summaryMarkup(args);
  }

  function renderSummaryTo(noteElId, summaryElId, args) {
    el(noteElId).textContent = args.noteText;
    el(summaryElId).innerHTML = summaryMarkup(args);
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
      el("summary").textContent = `Inget dygn hittades för ${dateKey}.`;
      return;
    }

    const labels = buildDayLabels(day);
    const rawSeries = buildDaySeries(day, state.metric);
    const series = state.fillGaps ? interpolateSmallGapsLinear(rawSeries, 8) : rawSeries;
    const chartMode = getEffectiveChartMode("singleDay");

    const stats = computeStats(series);

    const rm = Number(day.resolutionMinutes) || 15;
    const win2h = cheapestWindow(series, slotsForHours(2, rm));
    const win4h = cheapestWindow(series, slotsForHours(4, rm));
    const win8h = cheapestWindow(series, slotsForHours(8, rm));

    const barColors = buildBarColors(series, win2h, win4h, win8h);

    const hi2 = buildHighlightSeries(series, win2h);
    const hi4 = buildHighlightSeries(series, win4h);
    const hi8 = buildHighlightSeries(series, win8h);

    const datasets = [
      chartMode === "bar"
        ? {
          type: "bar",
          label: unitLabel(),
          data: series,
          backgroundColor: barColors.backgroundColor,
          borderColor: barColors.borderColor,
          borderWidth: 1,
          barPercentage: 1.0,
          categoryPercentage: 1.0
        }
        : {
            type: "line",
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

    if (chartMode === "bar") {
      datasets.push(
        {
          type: "line",
          label: "Billigaste 8h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.35)"
        },
        {
          type: "line",
          label: "Billigaste 4h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.65)"
        },
        {
          type: "line",
          label: "Billigaste 2h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.95)"
        }
      );
    }

    if (chartMode === "line") {
      if (hi8) datasets.push({ type: "line", label: "Billigaste 8h", data: hi8, pointRadius: 0, borderWidth: 6, tension: 0.2, borderColor: "rgba(255,255,255,0.40)" });
      if (hi4) datasets.push({ type: "line", label: "Billigaste 4h", data: hi4, pointRadius: 0, borderWidth: 5, tension: 0.2, borderColor: "rgba(120,220,255,0.85)" });
      if (hi2) datasets.push({ type: "line", label: "Billigaste 2h", data: hi2, pointRadius: 0, borderWidth: 6, tension: 0.2, borderColor: "rgba(255,215,120,0.95)" });
    }

    if (state.krLines) {
      const y1 = sekKwhToMetricY(1);
      const y2 = sekKwhToMetricY(2);
      const y3 = sekKwhToMetricY(3);

      const addH = (y, label) => {
        if (typeof y !== "number" || Number.isNaN(y)) return;
        datasets.push({
          type: "line",
          label,
          data: labels.map(() => y),
          isReferenceLine: true,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          borderWidth: 1,
          borderDash: [6, 6],
          borderColor: "rgba(255,255,255,0.35)",
          fill: false,
          tension: 0,
          spanGaps: true
        });
      };

      addH(y1, "≈ 1 kr/kWh");
      addH(y2, "≈ 2 kr/kWh");
      addH(y3, "≈ 3 kr/kWh");
    }

    const title = `${dateKey} (${unitLabel()}) – present ${day.present}/${day.expected}` +
      (state.fillGaps ? " (interpolerat ≤8 null)" : "");

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: chartMode,
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
            filter: (item) => !item.dataset?.isReferenceLine,
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
                  : (state.fillGaps ? " (interpolerad punkt)" : " (saknas i rådata)");
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
      infoText: `Dygn: ${dateKey} (${day.resolutionMinutes ?? "—"} min)`,
      timeText2h: windowTimeTextSingleDay(dateKey, day, win2h, slotToTime),
      timeText4h: windowTimeTextSingleDay(dateKey, day, win4h, slotToTime),
      timeText8h: windowTimeTextSingleDay(dateKey, day, win8h, slotToTime),
    });
  }

  function renderChartRange(nDays) {
    const ctx = el("chart").getContext("2d");
    const keys = buildRangeKeys(state.data?.days, nDays, stockholmTodayIsoDate());

    if (!keys.length) {
      if (chart) chart.destroy();
      chart = null;
      el("summary").textContent = "Ingen historik hittades.";
      return;
    }

    const { labels, series: rawSeries, refs } =
      buildRangeLabelsAndSeries(state.data.days, keys, state.metric, slotToTime);

    const series = state.fillGaps ? interpolateSmallGapsLinear(rawSeries, 8) : rawSeries;
    const stats = computeStats(series);
    const rm = Number(state.data?.days?.[keys[0]]?.resolutionMinutes) || 15;

    const win2h = cheapestWindow(series, slotsForHours(2, rm));
    const win4h = cheapestWindow(series, slotsForHours(4, rm));
    const win8h = cheapestWindow(series, slotsForHours(8, rm));

    const hi2 = buildHighlightSeries(series, win2h);
    const hi4 = buildHighlightSeries(series, win4h);
    const hi8 = buildHighlightSeries(series, win8h);
    const chartMode = getEffectiveChartMode("range");
    const barColors = buildBarColors(series, win2h, win4h, win8h);

    const datasets = [
      chartMode === "bar"
        ? {
            type: "bar",
            label: `${unitLabel()} (${nDays}d)`,
            data: series,
            backgroundColor: barColors.backgroundColor,
            borderColor: barColors.borderColor,
            borderWidth: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0
          }
        : {
            type: "line",
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

    if (chartMode === "bar") {
      datasets.push(
        {
          type: "line",
          label: "Billigaste 8h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.35)"
        },
        {
          type: "line",
          label: "Billigaste 4h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.65)"
        },
        {
          type: "line",
          label: "Billigaste 2h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.95)"
        }
      );
    } else {
      if (hi8) datasets.push({ type: "line", label: "Billigaste 8h", data: hi8, pointRadius: 0, borderWidth: 6, tension: 0.15, borderColor: "rgba(255,255,255,0.40)" });
      if (hi4) datasets.push({ type: "line", label: "Billigaste 4h", data: hi4, pointRadius: 0, borderWidth: 5, tension: 0.15, borderColor: "rgba(120,220,255,0.85)" });
      if (hi2) datasets.push({ type: "line", label: "Billigaste 2h", data: hi2, pointRadius: 0, borderWidth: 6, tension: 0.15, borderColor: "rgba(255,215,120,0.95)" });
    }

    if (state.krLines) {
      const y1 = sekKwhToMetricY(1);
      const y2 = sekKwhToMetricY(2);
      const y3 = sekKwhToMetricY(3);

      const addH = (y, label) => {
        if (typeof y !== "number" || Number.isNaN(y)) return;
        datasets.push({
          type: "line",
          label,
          data: labels.map(() => y),
          isReferenceLine: true,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          borderWidth: 1,
          borderDash: [6, 6],
          borderColor: "rgba(255,255,255,0.35)",
          fill: false,
          tension: 0,
          spanGaps: true
        });
      };

      addH(y1, "≈ 1 kr/kWh");
      addH(y2, "≈ 2 kr/kWh");
      addH(y3, "≈ 3 kr/kWh");
    }

    const title = `Senaste ${nDays} dagar (${unitLabel()})` + (state.fillGaps ? " (interpolerat ≤8 null)" : "");

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: chartMode,
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
            filter: (item) => !item.dataset?.isReferenceLine,
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
      infoText: `Intervall: ${keys[0]} → ${keys[keys.length - 1]}`,
      timeText2h: windowTimeTextRange(refs, win2h),
      timeText4h: windowTimeTextRange(refs, win4h),
      timeText8h: windowTimeTextRange(refs, win8h),
    });
  }

  // Graf 2: exakt UTC-baserat fönster nu −2h → +18h. Sluttiden är exkluderad.
  function renderPublishWindowFromHistory() {
    const ctx = el("chart14")?.getContext?.("2d");
    if (!ctx) return;

    const days = state.data?.days || {};
    const todayKey = stockholmTodayIsoDate();
    const tomorrowKey = addDays(todayKey, 1);

    if (!Object.keys(days).length) {
      if (chart14) chart14.destroy();
      chart14 = null;
      publishWindowHasTomorrow = true;
      chart14Window = null;
      el("summaryNote14").textContent = "Saknar prisdata.";
      el("summary14").textContent = "";
      return;
    }

    let windowData;
    try {
      windowData = buildUtcWindowSeries(days, state.metric, new Date(), 2, 18, "Europe/Stockholm");
    } catch (error) {
      if (chart14) chart14.destroy();
      chart14 = null;
      publishWindowHasTomorrow = true;
      chart14Window = null;
      el("summaryNote14").textContent = `Kunde inte bygga tidsfönstret: ${error?.message || "okänt fel"}`;
      el("summary14").textContent = "";
      return;
    }

    const {
      labels,
      series: rawSeries,
      refs,
      resolutionMinutes: rm,
      startUtcMs,
      endUtcMs
    } = windowData;

    chart14Window = { rm, startUtcMs, endUtcMs };

    const windowUsesTomorrow = refs.some(ref => ref.dayKey === tomorrowKey);
    const tomorrow = days[tomorrowKey];
    publishWindowHasTomorrow = !windowUsesTomorrow || (
      !!tomorrow &&
      Array.isArray(tomorrow.points) &&
      Number(tomorrow.present) > 0
    );

    const series = state.fillGaps ? interpolateSmallGapsLinear(rawSeries, 8) : rawSeries;
    const stats = computeStats(series);

    const win2h = cheapestWindow(series, slotsForHours(2, rm));
    const win4h = cheapestWindow(series, slotsForHours(4, rm));
    const win8h = cheapestWindow(series, slotsForHours(8, rm));

    const hi2 = buildHighlightSeries(series, win2h);
    const hi4 = buildHighlightSeries(series, win4h);
    const hi8 = buildHighlightSeries(series, win8h);
    const chartMode = getEffectiveChartMode("publishWindow");
    const barColors = buildBarColors(series, win2h, win4h, win8h);

    const datasets = [
      chartMode === "bar"
        ? {
            type: "bar",
            label: `${unitLabel()} (nu −2h → +18h)`,
            data: series,
            backgroundColor: barColors.backgroundColor,
            borderColor: barColors.borderColor,
            borderWidth: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0
          }
        : {
            type: "line",
            label: `${unitLabel()} (nu −2h → +18h)`,
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

    if (chartMode === "bar") {
      datasets.push(
        {
          type: "line",
          label: "Billigaste 8h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.35)"
        },
        {
          type: "line",
          label: "Billigaste 4h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.65)"
        },
        {
          type: "line",
          label: "Billigaste 2h",
          data: labels.map(() => null),
          pointRadius: 0,
          borderWidth: 6,
          borderColor: "rgba(46, 204, 113, 0.95)"
        }
      );
    }

    if (chartMode === "line") {
      if (hi8) datasets.push({
        type: "line",
        label: "Billigaste 8h",
        data: hi8,
        pointRadius: 0,
        borderWidth: 6,
        tension: 0.2,
        borderColor: "rgba(255,255,255,0.40)"
      });

      if (hi4) datasets.push({
        type: "line",
        label: "Billigaste 4h",
        data: hi4,
        pointRadius: 0,
        borderWidth: 5,
        tension: 0.2,
        borderColor: "rgba(120,220,255,0.85)"
      });

      if (hi2) datasets.push({
        type: "line",
        label: "Billigaste 2h",
        data: hi2,
        pointRadius: 0,
        borderWidth: 6,
        tension: 0.2,
        borderColor: "rgba(255,215,120,0.95)"
      });
    }

    if (state.krLines) {
      const y1 = sekKwhToMetricY(1);
      const y2 = sekKwhToMetricY(2);
      const y3 = sekKwhToMetricY(3);

      const addH = (y, label) => {
        if (typeof y !== "number" || Number.isNaN(y)) return;
        datasets.push({
          type: "line",
          label,
          data: labels.map(() => y),
          isReferenceLine: true,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          borderWidth: 1,
          borderDash: [6, 6],
          borderColor: "rgba(255,255,255,0.35)",
          fill: false,
          tension: 0,
          spanGaps: true
        });
      };

      addH(y1, "≈ 1 kr/kWh");
      addH(y2, "≈ 2 kr/kWh");
      addH(y3, "≈ 3 kr/kWh");
    }

    if (chart14) chart14.destroy();

    chart14 = new Chart(ctx, {
      type: chartMode,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, onClick: legendOnClick },
          title: { display: true, text: `Nu −2h → +18h (${unitLabel()})` },
          tooltip: {
            filter: (item) => !item.dataset?.isReferenceLine
          }
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { title: { display: true, text: unitLabel() } }
        }
      }
    });

    bindCostClicksIfReady();

    renderSummaryTo("summaryNote14", "summary14", {
      stats,
      win2h,
      win4h,
      win8h,
      infoText: "Rörligt fönster runt nuvarande tid",
      timeText2h: windowTimeTextRange(refs, win2h),
      timeText4h: windowTimeTextRange(refs, win4h),
      timeText8h: windowTimeTextRange(refs, win8h),
      noteText: "Saknade prisintervall visas som tomma. Fönstret omfattar exakt 20 timmar."
    });
  }

  function render() {
    if (!state.data?.days) return;

    // alltid rendera graf 2 (den följer metric/fillGaps/krLines)
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

  function appendMetaPill(row, label, value, suffix = "") {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.append(document.createTextNode(`${label}: `));
    const strong = document.createElement("b");
    strong.textContent = value ?? "—";
    pill.append(strong);
    if (suffix) pill.append(document.createTextNode(` ${suffix}`));
    row.append(pill);
  }

  function renderMeta() {
    const container = el("meta");
    const m = state.data?.meta;
    container.replaceChildren();
    if (!m) return;

    const row = document.createElement("div");
    row.className = "row";
    appendMetaPill(row, "area", m.area);
    appendMetaPill(row, "documentType", m.documentType);
    appendMetaPill(row, "tz", m.timeZone);
    appendMetaPill(row, "EUR/SEK", m.eursek, `(${m.eursekDate ?? "—"})`);
    appendMetaPill(row, "updatedAt", m.updatedAt);
    container.append(row);

    const request = document.createElement("div");
    request.className = "small";
    request.style.marginTop = "8px";
    request.textContent = `request: ${m.request?.periodStart ?? "—"} → ${m.request?.periodEnd ?? "—"}`;
    container.append(request);
  }

  function populateDatePick() {
    const days = state.data?.days || {};
    const keys = Object.keys(days).sort();
    const dp = el("datePick");
    dp.replaceChildren();

    for (const key of keys) {
      const day = days[key] || {};
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${key} (${day.present ?? "—"}/${day.expected ?? "—"})`;
      dp.append(option);
    }

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
  
    const cm = localStorage.getItem("rossohamn_chartMode");
    state.chartMode = (cm === "line" || cm === "bar" || cm === "auto") ? cm : "auto";
  
    const chartModeEl = el("chartMode");
    if (chartModeEl) chartModeEl.value = state.chartMode;
  }

  function saveSettings() {
    localStorage.setItem("rossohamn_fillGaps", state.fillGaps ? "1" : "0");
    localStorage.setItem("rossohamn_krLines", state.krLines ? "1" : "0");
    localStorage.setItem("rossohamn_chartMode", state.chartMode);
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

  async function bootstrap(sourceOverride = null) {
    const src = sourceOverride || getParam("src") || DEFAULT_SRC;
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
      const meta = el("meta");
      meta.replaceChildren();
      const errorBox = document.createElement("div");
      errorBox.style.color = "#ff9a9a";
      errorBox.textContent = `Fel: ${e?.message || "okänt fel"}`;
      meta.append(errorBox);

      if (chart) chart.destroy();
      chart = null;

      if (chart14) chart14.destroy();
      chart14 = null;

      publishWindowHasTomorrow = true;
      chart14Window = null;

      el("summary").innerHTML = "";
      el("summaryNote").textContent = "";
      el("summary14").innerHTML = "";
      el("summaryNote14").textContent = "";
    }
  }

  // ----- Events -----
  el("reload").addEventListener("click", () => {
    const requestedSource = el("src").value.trim() || DEFAULT_SRC;
    bootstrap(requestedSource);
  });

  el("chartMode")?.addEventListener("change", () => {
    state.chartMode = el("chartMode").value;
    saveSettings();
    render();
  });

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

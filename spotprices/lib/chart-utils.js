// lib/chart-utils.js
// Innehåller Chart.js-helpers + plugins, utan beroende av appens globala state.
// Appen skickar in getters så att detta kan hållas rent.

export function lineGradientColor(ctx) {
  const { chart } = ctx;
  const { ctx: c, chartArea } = chart;
  if (!chartArea) return "#9fd4ff";

  const g = c.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  g.addColorStop(0.00, "#2ecc71");
  g.addColorStop(0.50, "#3498db");
  g.addColorStop(1.00, "#e74c3c");
  return g;
}

export function legendOnClick(e, legendItem, legend) {
  const chart = legend.chart;
  const idx = legendItem.datasetIndex;
  const ds = chart.data.datasets[idx];
  if (!ds) return;

  // dataset[0] = huvudserien; den ska alltid vara synlig
  if (idx === 0) return;

  const meta = chart.getDatasetMeta(idx);
  meta.hidden = meta.hidden === null ? !chart.data.datasets[idx].hidden : null;
  chart.update();
}

/**
 * "Nu"-linjen för chart och chart14.
 *
 * @param {Object} deps
 * @param {() => boolean} deps.isMainTabToday   true om huvudgrafen ska rita nu-linje (ex state.tab==="today")
 * @param {() => number}  deps.getMainResolutionMinutes  resolutionMinutes för "today" (fallback 15)
 * @param {() => ({rm:number, slotsPerDay:number, startAbsUsed:number, endAbsUsed:number} | null)} deps.getChart14Window
 */
export function makeNowLinePlugin({ isMainTabToday, getMainResolutionMinutes, getChart14Window }) {
  return {
    id: "nowLine",
    afterDraw(chart) {
      const isMain = chart?.canvas?.id === "chart";
      const is14   = chart?.canvas?.id === "chart14";

      if (!isMain && !is14) return;
      if (isMain && !isMainTabToday()) return;

      const xScale = chart.scales.x;
      if (!xScale) return;

      const now = new Date();
      const hh = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit" }).format(now));
      const mm = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", minute: "2-digit" }).format(now));

      // Default: huvudgrafen
      let rm = Number(getMainResolutionMinutes?.()) || 15;
      let slotsPerHour = Math.max(1, Math.round(60 / rm));
      let slotNow = hh * slotsPerHour + Math.floor(mm / rm);
      let xIndex = slotNow;

      // chart14 använder fönster-meta för att mappa "nu" till rätt x-index
      if (is14) {
        const w = getChart14Window?.();
        if (!w) return;

        const rm14 = Number(w.rm) || 15;
        const slotsPerHour14 = Math.max(1, Math.round(60 / rm14));
        const slotNow14 = hh * slotsPerHour14 + Math.floor(mm / rm14);

        const absNow = slotNow14; // "idag"-slot i chart14-fönstrets absoluta index
        if (absNow < w.startAbsUsed || absNow > w.endAbsUsed) return;

        xIndex = absNow - w.startAbsUsed;
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
}

/**
 * Text-overlay i graf 2 när imorgon saknas
 * @param {Object} deps
 * @param {() => boolean} deps.getHasTomorrow  true om morgondagen finns publicerad
 */
export function makePublishWindowNoticePlugin({ getHasTomorrow }) {
  return {
    id: "publishWindowNotice",
    afterDraw(chart) {
      if (chart?.canvas?.id !== "chart14") return;
      if (getHasTomorrow?.()) return;

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
}

export function registerChartPlugins(Chart, plugins) {
  if (!Chart || !Array.isArray(plugins)) return;
  Chart.register(...plugins);
}

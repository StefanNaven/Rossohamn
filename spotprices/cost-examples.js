// cost-examples.js
// Klick på en datapunkt -> räkna kostnadsexempel i SEK
// Förval kan justeras och sparas i localStorage.

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function fmtSek(v) {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2) + " kr";
}

function getLS(key, fallback = null) {
  const v = localStorage.getItem(key);
  return (v === null || v === "") ? fallback : v;
}

function setLS(key, val) {
  localStorage.setItem(key, val ?? "");
}

// Konvertera valt metric-värde till SEK/kWh
function metricValueToSekPerKwh(metric, metricValue, eursek) {
  if (!Number.isFinite(metricValue)) return null;

  if (metric === "sekKwh") return metricValue;
  if (metric === "oreKwh") return metricValue / 100.0;

  if (metric === "eurMwh") {
    const e = Number(eursek);
    if (!Number.isFinite(e) || e <= 0) return null;
    // EUR/MWh -> SEK/MWh -> SEK/kWh
    return (metricValue * e) / 1000.0;
  }
  return null;
}

function buildDefaultPresets() {
  // Förval enligt källor + beräknade antaganden (kan ändras i UI)
  return [
    { key: "dishwasher_kwh", label: "Diskmaskin (kWh/körning)", mode: "kwh", value: 1.35 },
    { key: "washer_kwh",     label: "Tvätt (kWh/körning)",      mode: "kwh", value: 0.98 },
    { key: "dryer_kwh",      label: "Torktumla (kWh/körning)",  mode: "kwh", value: 4.5 },

    // Dusch: kWh per 10 min + minuter
    { key: "shower_kwh10",   label: "Dusch (kWh/10 min)",       mode: "kwh10min", value: 1.42, minutes: 10 },

    // Golvvärme: W/m² + area + timmar -> kWh
    { key: "ufh_wm2",        label: "Golvvärme (W/m²)",         mode: "ufh", wm2: 120, area: 5, hours: 1 }
  ];
}

function loadPresets(presets) {
  for (const p of presets) {
    if (p.mode === "kwh") {
      const v = safeNum(getLS("rossohamn_" + p.key, p.value));
      p.value = (v ?? p.value);
    } else if (p.mode === "kwh10min") {
      const v = safeNum(getLS("rossohamn_" + p.key, p.value));
      const m = safeNum(getLS("rossohamn_shower_minutes", p.minutes));
      p.value = (v ?? p.value);
      p.minutes = (m ?? p.minutes);
    } else if (p.mode === "ufh") {
      const wm2 = safeNum(getLS("rossohamn_ufh_wm2", p.wm2));
      const area = safeNum(getLS("rossohamn_ufh_area", p.area));
      const hrs = safeNum(getLS("rossohamn_ufh_hours", p.hours));
      p.wm2 = (wm2 ?? p.wm2);
      p.area = (area ?? p.area);
      p.hours = (hrs ?? p.hours);
    }
  }
  return presets;
}

function savePreset(p, patch) {
  Object.assign(p, patch);

  if (p.mode === "kwh") {
    setLS("rossohamn_" + p.key, String(p.value ?? ""));
  } else if (p.mode === "kwh10min") {
    setLS("rossohamn_" + p.key, String(p.value ?? ""));
    setLS("rossohamn_shower_minutes", String(p.minutes ?? ""));
  } else if (p.mode === "ufh") {
    setLS("rossohamn_ufh_wm2", String(p.wm2 ?? ""));
    setLS("rossohamn_ufh_area", String(p.area ?? ""));
    setLS("rossohamn_ufh_hours", String(p.hours ?? ""));
  }
}

function calcKwhForPreset(p) {
  if (p.mode === "kwh") return safeNum(p.value);
  if (p.mode === "kwh10min") {
    const kwh10 = safeNum(p.value);
    const minutes = safeNum(p.minutes);
    if (!Number.isFinite(kwh10) || !Number.isFinite(minutes)) return null;
    return kwh10 * (minutes / 10.0);
  }
  if (p.mode === "ufh") {
    const wm2 = safeNum(p.wm2);
    const area = safeNum(p.area);
    const hrs = safeNum(p.hours);
    if (!Number.isFinite(wm2) || !Number.isFinite(area) || !Number.isFinite(hrs)) return null;
    // W/m² * m² = W -> kW -> kWh
    return (wm2 * area / 1000.0) * hrs;
  }
  return null;
}

function presetEditorRow(p) {
  if (p.mode === "kwh") {
    return `
      <div class="row" style="gap:10px; margin-top:6px;">
        <label class="small" style="min-width:220px;">${p.label}</label>
        <input data-pkey="${p.key}" data-ptype="kwh" value="${p.value ?? ""}" style="max-width:140px;" />
      </div>`;
  }

  if (p.mode === "kwh10min") {
    return `
      <div class="row" style="gap:10px; margin-top:6px;">
        <label class="small" style="min-width:220px;">${p.label}</label>
        <input data-pkey="${p.key}" data-ptype="kwh10" value="${p.value ?? ""}" style="max-width:140px;" />
        <span class="small">Minuter:</span>
        <input data-pkey="shower_minutes" data-ptype="minutes" value="${p.minutes ?? 10}" style="max-width:80px;" />
      </div>`;
  }

  if (p.mode === "ufh") {
    return `
      <div class="row" style="gap:10px; margin-top:6px;">
        <label class="small" style="min-width:220px;">Golvvärme</label>

        <span class="small">W/m²</span>
        <input data-pkey="ufh_wm2" data-ptype="ufh_wm2" value="${p.wm2 ?? ""}" style="max-width:90px;" />

        <span class="small">Area (m²)</span>
        <input data-pkey="ufh_area" data-ptype="ufh_area" value="${p.area ?? ""}" style="max-width:90px;" />

        <span class="small">Timmar</span>
        <input data-pkey="ufh_hours" data-ptype="ufh_hours" value="${p.hours ?? ""}" style="max-width:90px;" />
      </div>`;
  }

  return "";
}

function renderCostCard(container, { labelText, sekPerKwh, presets, metricLabel }) {
  const rows = presets.map(p => {
    const kwh = calcKwhForPreset(p);
    if (!Number.isFinite(kwh)) {
      return `
        <tr>
          <td>${p.mode === "ufh" ? "Golvvärme" : p.label}</td>
          <td>—</td>
          <td class="small">Saknar värde</td>
        </tr>`;
    }
    const cost = sekPerKwh * kwh;
    return `
      <tr>
        <td>${p.mode === "ufh" ? "Golvvärme" : p.label}</td>
        <td><b>${fmtSek(cost)}</b></td>
        <td class="small">${kwh.toFixed(3)} kWh × ${sekPerKwh.toFixed(4)} SEK/kWh</td>
      </tr>`;
  }).join("");

  const editors = presets.map(p => presetEditorRow(p)).join("");

  container.style.display = "block";
  container.querySelector("#costWhen").textContent = labelText || "—";

  container.querySelector("#costBody").innerHTML = `
    <div class="row">
      <span class="pill">Pris vid klick: <b>${sekPerKwh.toFixed(4)}</b> SEK/kWh</span>
      <span class="pill">Visad serie: <b>${metricLabel}</b></span>
    </div>

    <table style="margin-top:10px;">
      <thead><tr><th>Exempel</th><th>Kostnad</th><th>Beräkning</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="margin-top:14px;">
      <div style="font-weight:700;">Justera typvärden</div>
      <div class="small">Sparas i din webbläsare (localStorage).</div>
      ${editors}
    </div>
  `;

  // bind editor inputs
  container.querySelectorAll("input[data-ptype]").forEach(inp => {
    inp.addEventListener("change", () => {
      const ptype = inp.getAttribute("data-ptype");
      const pkey = inp.getAttribute("data-pkey");
      const v = safeNum(inp.value);

      const shower = presets.find(x => x.mode === "kwh10min");
      const ufh = presets.find(x => x.mode === "ufh");
      const simple = presets.find(x => x.key === pkey && x.mode === "kwh");

      if (ptype === "kwh" && simple) savePreset(simple, { value: v });
      if (ptype === "kwh10" && shower) savePreset(shower, { value: v });
      if (ptype === "minutes" && shower) savePreset(shower, { minutes: v });
      if (ptype === "ufh_wm2" && ufh) savePreset(ufh, { wm2: v });
      if (ptype === "ufh_area" && ufh) savePreset(ufh, { area: v });
      if (ptype === "ufh_hours" && ufh) savePreset(ufh, { hours: v });

      // trigga omrender via callback (sidan kopplar den)
      const evt = new CustomEvent("rossohamn_cost_presets_changed");
      window.dispatchEvent(evt);
    });
  });
}

// Export: koppla kostmodulen till en Chart.js-instans
export function attachCostExamples({
  chartGetter,        // () => Chart instance
  labelGetter,        // (chart, index) => label text
  valueGetter,        // (chart, index) => y-value (number|null)
  metricGetter,       // () => "oreKwh"|"sekKwh"|"eurMwh"
  eursekGetter,       // () => eursek number|null
  metricLabelGetter,  // () => "öre/kWh" etc
  cardElementId = "costCard"
}) {
  const card = document.getElementById(cardElementId);
  if (!card) return;

  const presets = loadPresets(buildDefaultPresets());

  let last = { labelText: null, metricValue: null };

  function recalcAndRender() {
    if (!last || !Number.isFinite(last.metricValue)) return;

    const metric = metricGetter();
    const eursek = eursekGetter();
    const sekPerKwh = metricValueToSekPerKwh(metric, last.metricValue, eursek);
    if (!Number.isFinite(sekPerKwh)) return;

    renderCostCard(card, {
      labelText: last.labelText,
      sekPerKwh,
      presets,
      metricLabel: metricLabelGetter()
    });
  }

  // lyssna när användaren ändrar typvärden
  window.addEventListener("rossohamn_cost_presets_changed", () => {
    loadPresets(presets);
    recalcAndRender();
  });

  // Hooka klick: vi patchar chart.options.onClick på *nuvarande* instans
  function bind() {
    const ch = chartGetter();
    if (!ch) return;

    ch.options.onClick = (evt) => {
      const points = ch.getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
      if (!points?.length) return;

      const idx = points[0].index;

      const y = valueGetter(ch, idx);
      if (!Number.isFinite(y)) return;

      last = {
        labelText: labelGetter(ch, idx),
        metricValue: y
      };

      recalcAndRender();
    };

    ch.update();
  }

  // Exponera bind-funktion så sidan kan kalla efter att den skapat/re-creatat Chart-instansen
  return { bind, recalcAndRender };
}

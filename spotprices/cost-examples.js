// cost-examples.js
//
// Klick på en datapunkt i grafen visar:
//
// - Spotpris exklusive moms
// - Elhandlarens påslag exklusive moms
// - Moms på spotpris och påslag
// - Nätöverföring inklusive moms
// - Energiskatt inklusive moms
// - Totalt rörligt pris per kWh
//
// Besökarens inställningar sparas i localStorage.

const DEFAULT_SETTINGS = {
  supplierMarkupOreExVat: 4.21,
  gridTransferOreIncVat: 26.00,
  energyTaxOreIncVat: 45.00,
  vatPercent: 25
};

const STORAGE_KEYS = {
  supplierMarkupOreExVat: "rossohamn_supplierMarkupOreExVat",
  gridTransferOreIncVat: "rossohamn_gridTransferOreIncVat",
  energyTaxOreIncVat: "rossohamn_energyTaxOreIncVat",
  vatPercent: "rossohamn_vatPercent"
};

function safeNum(value) {
  if (typeof value === "string") {
    value = value.trim().replace(",", ".");
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatOre(value) {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatSek(value) {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("sv-SE", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
}

function formatCostSek(value) {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + " kr";
}

function readStoredNumber(key, fallback) {
  const storedValue = localStorage.getItem(key);

  if (storedValue === null || storedValue === "") {
    return fallback;
  }

  const number = safeNum(storedValue);
  return number ?? fallback;
}

function loadSettings() {
  return {
    supplierMarkupOreExVat: readStoredNumber(
      STORAGE_KEYS.supplierMarkupOreExVat,
      DEFAULT_SETTINGS.supplierMarkupOreExVat
    ),

    gridTransferOreIncVat: readStoredNumber(
      STORAGE_KEYS.gridTransferOreIncVat,
      DEFAULT_SETTINGS.gridTransferOreIncVat
    ),

    energyTaxOreIncVat: readStoredNumber(
      STORAGE_KEYS.energyTaxOreIncVat,
      DEFAULT_SETTINGS.energyTaxOreIncVat
    ),

    vatPercent: readStoredNumber(
      STORAGE_KEYS.vatPercent,
      DEFAULT_SETTINGS.vatPercent
    )
  };
}

function saveSettings(settings) {
  localStorage.setItem(
    STORAGE_KEYS.supplierMarkupOreExVat,
    String(settings.supplierMarkupOreExVat)
  );

  localStorage.setItem(
    STORAGE_KEYS.gridTransferOreIncVat,
    String(settings.gridTransferOreIncVat)
  );

  localStorage.setItem(
    STORAGE_KEYS.energyTaxOreIncVat,
    String(settings.energyTaxOreIncVat)
  );

  localStorage.setItem(
    STORAGE_KEYS.vatPercent,
    String(settings.vatPercent)
  );
}

function resetSettings() {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
  }

  return { ...DEFAULT_SETTINGS };
}

// Konverterar den valda grafseriens värde till öre/kWh exklusive moms.
function metricValueToOrePerKwh(metric, metricValue, eursek) {
  if (!Number.isFinite(metricValue)) return null;

  if (metric === "oreKwh") {
    return metricValue;
  }

  if (metric === "sekKwh") {
    return metricValue * 100;
  }

  if (metric === "eurMwh") {
    const exchangeRate = Number(eursek);

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return null;
    }

    // EUR/MWh × SEK/EUR = SEK/MWh
    // SEK/MWh ÷ 10 = öre/kWh
    return (metricValue * exchangeRate) / 10;
  }

  return null;
}

function calculateElectricityPrice(spotOreExVat, settings) {
  const markupOreExVat = settings.supplierMarkupOreExVat;
  const vatRate = settings.vatPercent / 100;

  // Endast spotpris och elhandlarpåslag är angivna exklusive moms.
  const vatOre =
    (spotOreExVat + markupOreExVat) * vatRate;

  // Nätöverföring och energiskatt är redan angivna inklusive moms.
  const totalOreIncVat =
    spotOreExVat +
    markupOreExVat +
    vatOre +
    settings.gridTransferOreIncVat +
    settings.energyTaxOreIncVat;

  return {
    spotOreExVat,
    markupOreExVat,
    vatOre,
    gridTransferOreIncVat: settings.gridTransferOreIncVat,
    energyTaxOreIncVat: settings.energyTaxOreIncVat,
    totalOreIncVat,
    totalSekIncVat: totalOreIncVat / 100
  };
}

function settingsMarkup(settings) {
  return `
    <details style="margin-top:16px;">
      <summary style="cursor:pointer; font-weight:700;">
        ⚙ Inställningar
      </summary>

      <div class="small" style="margin-top:8px;">
        Inställningarna sparas endast lokalt i denna webbläsare.
      </div>

      <div
        style="
          display:grid;
          grid-template-columns:minmax(190px, 1fr) minmax(110px, 160px);
          gap:10px 14px;
          align-items:center;
          margin-top:12px;
        "
      >
        <label for="electricityMarkup">
          Elhandlarpåslag
          <div class="small">öre/kWh, exklusive moms</div>
        </label>

        <input
          id="electricityMarkup"
          inputmode="decimal"
          value="${escapeHtml(settings.supplierMarkupOreExVat)}"
        >

        <label for="electricityGridTransfer">
          Nätöverföring
          <div class="small">öre/kWh, inklusive moms</div>
        </label>

        <input
          id="electricityGridTransfer"
          inputmode="decimal"
          value="${escapeHtml(settings.gridTransferOreIncVat)}"
        >

        <label for="electricityEnergyTax">
          Energiskatt
          <div class="small">öre/kWh, inklusive moms</div>
        </label>

        <input
          id="electricityEnergyTax"
          inputmode="decimal"
          value="${escapeHtml(settings.energyTaxOreIncVat)}"
        >

        <label for="electricityVat">
          Moms
          <div class="small">procent på spotpris och elhandlarpåslag</div>
        </label>

        <input
          id="electricityVat"
          inputmode="decimal"
          value="${escapeHtml(settings.vatPercent)}"
        >
      </div>

      <button
        id="resetElectricitySettings"
        class="btn"
        type="button"
        style="margin-top:14px;"
      >
        Återställ grundvärden
      </button>
    </details>
  `;
}

function costExamplesMarkup(totalSekPerKwh) {
  const examples = [
    {
      label: "Diskmaskin",
      kwh: 1.35
    },
    {
      label: "Tvättmaskin",
      kwh: 0.98
    },
    {
      label: "Torktumlare",
      kwh: 4.5
    },
    {
      label: "Dusch, 10 minuter",
      kwh: 1.42
    }
  ];

  const rows = examples.map(example => {
    const cost = totalSekPerKwh * example.kwh;

    return `
      <tr>
        <td>${escapeHtml(example.label)}</td>
        <td>${formatOre(example.kwh * 1000)} Wh</td>
        <td><b>${formatCostSek(cost)}</b></td>
      </tr>
    `;
  }).join("");

  return `
    <div style="margin-top:18px;">
      <div style="font-weight:700;">Kostnadsexempel med totalpriset</div>

      <table style="margin-top:10px;">
        <thead>
          <tr>
            <th>Exempel</th>
            <th>Förbrukning</th>
            <th>Kostnad</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderPriceCard(container, {
  labelText,
  spotOreExVat,
  settings
}) {
  const price = calculateElectricityPrice(
    spotOreExVat,
    settings
  );

  container.style.display = "block";

  const whenElement = container.querySelector("#costWhen");

  if (whenElement) {
    whenElement.textContent = labelText || "—";
  }

  const body = container.querySelector("#costBody");

  body.innerHTML = `
    <div class="row">
      <span class="pill">
        Spotpris:
        <b>${formatOre(price.spotOreExVat)}</b>
        öre/kWh exkl. moms
      </span>

      <span class="pill">
        Totalt:
        <b>${formatSek(price.totalSekIncVat)}</b>
        kr/kWh
      </span>
    </div>

    <table style="margin-top:12px;">
      <thead>
        <tr>
          <th>Del av priset</th>
          <th>öre/kWh</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>
            Spotpris
            <div class="small">Exklusive moms</div>
          </td>
          <td>${formatOre(price.spotOreExVat)}</td>
        </tr>

        <tr>
          <td>
            Elhandlarens påslag
            <div class="small">Exklusive moms</div>
          </td>
          <td>${formatOre(price.markupOreExVat)}</td>
        </tr>

        <tr>
          <td>
            Moms
            <div class="small">
              ${formatOre(settings.vatPercent)} % på spotpris och påslag
            </div>
          </td>
          <td>${formatOre(price.vatOre)}</td>
        </tr>

        <tr>
          <td>
            Nätöverföring
            <div class="small">Inklusive moms</div>
          </td>
          <td>${formatOre(price.gridTransferOreIncVat)}</td>
        </tr>

        <tr>
          <td>
            Energiskatt
            <div class="small">Inklusive moms</div>
          </td>
          <td>${formatOre(price.energyTaxOreIncVat)}</td>
        </tr>

        <tr>
          <td><b>Totalt rörligt elpris</b></td>
          <td>
            <b>${formatOre(price.totalOreIncVat)}</b>
            öre/kWh
          </td>
        </tr>
      </tbody>
    </table>

    <div
      style="
        margin-top:14px;
        padding:14px;
        border:1px solid rgba(255,255,255,0.14);
        border-radius:12px;
      "
    >
      <div class="small">Totalt pris inklusive moms</div>

      <div style="font-size:1.8rem; font-weight:800; margin-top:4px;">
        ${formatSek(price.totalSekIncVat)} kr/kWh
      </div>
    </div>

    ${costExamplesMarkup(price.totalSekIncVat)}

    ${settingsMarkup(settings)}
  `;

  bindSettingsEvents(container);
}

let currentContainer = null;
let currentSettings = loadSettings();
let currentSelection = null;

function rerenderCurrentSelection() {
  if (!currentContainer || !currentSelection) {
    return;
  }

  renderPriceCard(currentContainer, {
    labelText: currentSelection.labelText,
    spotOreExVat: currentSelection.spotOreExVat,
    settings: currentSettings
  });
}

function readInputNumber(container, id, fallback) {
  const input = container.querySelector(`#${id}`);

  if (!input) {
    return fallback;
  }

  return safeNum(input.value) ?? fallback;
}

function bindSettingsEvents(container) {
  const inputIds = [
    "electricityMarkup",
    "electricityGridTransfer",
    "electricityEnergyTax",
    "electricityVat"
  ];

  for (const id of inputIds) {
    const input = container.querySelector(`#${id}`);

    if (!input) continue;

    input.addEventListener("change", () => {
      currentSettings = {
        supplierMarkupOreExVat: readInputNumber(
          container,
          "electricityMarkup",
          currentSettings.supplierMarkupOreExVat
        ),

        gridTransferOreIncVat: readInputNumber(
          container,
          "electricityGridTransfer",
          currentSettings.gridTransferOreIncVat
        ),

        energyTaxOreIncVat: readInputNumber(
          container,
          "electricityEnergyTax",
          currentSettings.energyTaxOreIncVat
        ),

        vatPercent: readInputNumber(
          container,
          "electricityVat",
          currentSettings.vatPercent
        )
      };

      saveSettings(currentSettings);
      rerenderCurrentSelection();
    });
  }

  const resetButton =
    container.querySelector("#resetElectricitySettings");

  resetButton?.addEventListener("click", () => {
    currentSettings = resetSettings();
    rerenderCurrentSelection();
  });
}

// Kopplar kalkylen till en Chart.js-instans.
export function attachCostExamples({
  chartGetter,
  labelGetter,
  valueGetter,
  metricGetter,
  eursekGetter,
  metricLabelGetter,
  cardElementId = "costCard"
}) {
  const card = document.getElementById(cardElementId);

  if (!card) {
    return;
  }

  currentContainer = card;
  currentSettings = loadSettings();

  function bind() {
    const chart = chartGetter();

    if (!chart) {
      return;
    }

    chart.options.onClick = event => {
      const points = chart.getElementsAtEventForMode(
        event,
        "nearest",
        { intersect: true },
        true
      );

      if (!points?.length) {
        return;
      }

      const index = points[0].index;
      const metricValue = valueGetter(chart, index);

      if (!Number.isFinite(metricValue)) {
        return;
      }

      const spotOreExVat = metricValueToOrePerKwh(
        metricGetter(),
        metricValue,
        eursekGetter()
      );

      if (!Number.isFinite(spotOreExVat)) {
        return;
      }

      currentSelection = {
        labelText: labelGetter(chart, index),
        spotOreExVat
      };

      rerenderCurrentSelection();
    };

    chart.update();
  }

  return {
    bind,
    recalcAndRender: rerenderCurrentSelection
  };
}

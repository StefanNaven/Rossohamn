const CONFIG = {
  latestJsonUrl: './data/latest.json',
  garbageTableJsonUrl: './data/garbagetable.json',
  sourceUrl:
    'https://www.stromstad.se/byggaboochmiljo/avfallochatervinning/sophamtning.4.47f506a2157fa40ebf68316c.html?query=Konrad+Olssons+v%C3%A4g+10',
  fallbackAddress: 'Konrad Olssons väg 10',
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? '–';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseIsoDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(dateStr) {
  const date = parseIsoDate(dateStr);
  if (!date) return dateStr || '–';

  return date.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isTomorrow(dateStr) {
  const date = parseIsoDate(dateStr);
  if (!date) return false;

  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
}

function renderDateValue(elementId, dateStr) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const formatted = formatDate(dateStr);

  if (isTomorrow(dateStr)) {
    el.innerHTML = `${escapeHtml(formatted)} <span class="gc-badge">I morgon</span>`;
  } else {
    el.textContent = formatted;
  }
}

async function loadJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.json();
}

function renderLatest(data) {
  setText('addressValue', data.address || CONFIG.fallbackAddress);
  setText('updatedAtValue', data.updatedAt || '–');

  renderDateValue('matavfallValue', data.matavfall);
  renderDateValue('restavfallValue', data.restavfall);
}

function renderTable(rows) {
  const tbody = document.getElementById('pickupTableBody');
  if (!tbody) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2">Ingen infotabell tillgänglig.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.ordinaryDay || '')}</td>
        <td>${escapeHtml(row.collectedDay || '')}</td>
      </tr>
    `)
    .join('');
}

async function init() {
  let latestOk = false;
  let tableOk = false;

  try {
    const latest = await loadJson(CONFIG.latestJsonUrl);
    renderLatest(latest);
    latestOk = true;
  } catch (error) {
    setText('addressValue', CONFIG.fallbackAddress);
    setText('updatedAtValue', '–');
    setText('matavfallValue', 'Kunde inte läsa');
    setText('restavfallValue', 'Kunde inte läsa');
  }

  try {
    const tableData = await loadJson(CONFIG.garbageTableJsonUrl);
    renderTable(tableData.rows || []);
    setText('tableUpdatedAtValue', tableData.updatedAt || '–');
    setText('tableMessage', 'Visar publicerad infotabell.');
    tableOk = true;
  } catch (error) {
    renderTable([]);
    setText('tableUpdatedAtValue', '–');
    setText('tableMessage', 'Kunde inte läsa garbagetable.json.');
  }

  if (latestOk && tableOk) {
    setText('sourceMode', 'GitHub JSON');
  } else if (latestOk || tableOk) {
    setText('sourceMode', 'Delvis tillgänglig');
  } else {
    setText('sourceMode', 'Ingen data tillgänglig');
  }
}

init();

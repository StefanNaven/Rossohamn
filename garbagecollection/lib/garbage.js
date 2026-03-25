const CONFIG = {
  publishedJsonUrl: './data/latest.json',
  sourceUrl:
    'https://www.stromstad.se/byggaboochmiljo/avfallochatervinning/sophamtning.4.47f506a2157fa40ebf68316c.html?query=Konrad+Olssons+v%C3%A4g+10',
  sourceContainerId: 'svid12_4bb4c22719afcbb65a037948',
  fallbackAddress: 'Konrad Olssons väg 10',
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ?? '–';
}

function formatDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '–';

  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function renderRows(rows) {
  const tbody = document.getElementById('pickupTableBody');
  if (!tbody) return;

  if (!Array.isArray(rows) || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4">Ingen tabelldata tillgänglig.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      return `
        <tr>
          <td>${escapeHtml(row.address || '')}</td>
          <td>${escapeHtml(row.type || '')}</td>
          <td>${escapeHtml(row.date || '')}</td>
          <td>${escapeHtml(row.district || '')}</td>
        </tr>
      `;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadPublishedJson() {
  const res = await fetch(CONFIG.publishedJsonUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`latest.json HTTP ${res.status}`);
  }
  return await res.json();
}

function renderPublishedData(data) {
  setText('addressValue', data.address || CONFIG.fallbackAddress);
  setText('matavfallValue', formatDate(data.matavfall));
  setText('restavfallValue', formatDate(data.restavfall));
  setText('updatedAtValue', data.updatedAt || '–');
}

function parseLiveTableFromHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const container = doc.getElementById(CONFIG.sourceContainerId);
  if (!container) {
    throw new Error(`Div saknas: ${CONFIG.sourceContainerId}`);
  }

  const table = container.querySelector('table');
  if (!table) {
    throw new Error('Tabell saknas i source-div');
  }

  const bodyRows = table.querySelectorAll('tbody tr');
  const rows = Array.from(bodyRows).map((tr) => {
    const cells = tr.querySelectorAll('td, th');

    return {
      address: cells[0]?.textContent.trim() || '',
      type: cells[1]?.textContent.trim() || '',
      date: cells[2]?.textContent.trim() || '',
      district: cells[3]?.textContent.trim() || '',
    };
  });

  return rows.filter((row) => row.address || row.type || row.date || row.district);
}

async function loadLiveRows() {
  const res = await fetch(CONFIG.sourceUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Källsidan svarade med HTTP ${res.status}`);
  }

  const html = await res.text();
  return parseLiveTableFromHtml(html);
}

function buildRowsFromPublished(data) {
  const rows = [];

  if (data.matavfall) {
    rows.push({
      address: data.address || CONFIG.fallbackAddress,
      type: 'Matavfall',
      date: data.matavfall,
      district: '',
    });
  }

  if (data.restavfall) {
    rows.push({
      address: data.address || CONFIG.fallbackAddress,
      type: 'Restavfall',
      date: data.restavfall,
      district: '',
    });
  }

  return rows;
}

async function init() {
  let publishedData = null;

  try {
    publishedData = await loadPublishedJson();
    renderPublishedData(publishedData);
    setText('sourceMode', 'Publicerad JSON');
  } catch (error) {
    setText('addressValue', CONFIG.fallbackAddress);
    setText('matavfallValue', '–');
    setText('restavfallValue', '–');
    setText('updatedAtValue', '–');
    setText('sourceMode', 'Ingen JSON-data');
  }

  try {
    const liveRows = await loadLiveRows();
    renderRows(liveRows);
    setText('liveStatusValue', 'OK');
    setText('tableMessage', 'Live-tabell läst direkt från Strömstads kommun.');
  } catch (error) {
    setText('liveStatusValue', 'Misslyckades');

    if (publishedData) {
      renderRows(buildRowsFromPublished(publishedData));
      setText(
        'tableMessage',
        'Live-läsning misslyckades. Tabellen visas från publicerad JSON i stället.'
      );
    } else {
      renderRows([]);
      setText(
        'tableMessage',
        'Live-läsning misslyckades och ingen publicerad JSON kunde läsas.'
      );
    }
  }
}

init();

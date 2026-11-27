import {
  PATHS,
  fetchJson,
  validDate,
  daysUntil,
  addDays,
  ageStatus,
  dateTimeText,
  timestampMs
} from './core.js';

// ============================================================
// Validate garbage collection dates
//
// Publication only occurs when pickup dates change.
// The age of the published file is not a health indicator.
// ============================================================

export function inspectGarbage(j, site, now = new Date()) {
  if (
    !j ||
    !validDate(j.matavfall) ||
    !validDate(j.restavfall)
  ) {
    return {
      state: 'error',
      label: 'Ogiltiga hämtningsdatum',
      detail: 'JSON-schema stämmer inte',
      data: null
    };
  }

  const detail =
    `Senast publicerad: ${dateTimeText(timestampMs(j.updatedAt))}`;

  if (
    daysUntil(j.matavfall, now) < 0 ||
    daysUntil(j.restavfall, now) < 0
  ) {
    return {
      state: 'warn',
      label: 'Datum har passerat',
      detail,
      data: j
    };
  }

  return {
    state: 'ok',
    label: 'Datum ej passerade',
    detail,
    data: j
  };
}

// ============================================================
// Validate alternative collection schedule
// ============================================================

export function inspectTable(j, site, now = new Date()) {
  if (
    !j ||
    !Array.isArray(j.rows) ||
    !j.rows.every(r =>
      r &&
      typeof r.ordinaryDay === 'string' &&
      typeof r.collectedDay === 'string'
    )
  ) {
    return {
      state: 'error',
      label: 'Ogiltig infotabell',
      detail: 'JSON-schema stämmer inte',
      data: null
    };
  }

  return {
    ...ageStatus(
      j.updatedAt,
      site.freshnessHours.garbageTable,
      now
    ),

    detail:
      `${j.rows.length} rader · ` +
      `${dateTimeText(timestampMs(j.updatedAt))}`,

    data: j
  };
}

// ============================================================
// Load garbage collection data
// ============================================================

export async function loadGarbage(site, now = new Date()) {
  try {
    const data = await fetchJson(PATHS.garbage);

    return inspectGarbage(data, site, now);

  } catch (e) {
    return {
      state: 'error',
      label: 'Kunde inte läsa',
      detail: e.message,
      data: null
    };
  }
}

// ============================================================
// Load alternative collection schedule
// ============================================================

export async function loadTable(site, now = new Date()) {
  try {
    const data = await fetchJson(PATHS.garbageTable);

    return inspectTable(data, site, now);

  } catch (e) {
    return {
      state: 'error',
      label: 'Kunde inte läsa',
      detail: e.message,
      data: null
    };
  }
}

// ============================================================
// Calendar export (ICS)
// ============================================================

export function calendarText(j, now = new Date()) {
  if (!j) {
    return '';
  }

  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rossohamn//Garbage Collection//SV',
    'CALSCALE:GREGORIAN'
  ];

  const wasteTypes = [
    ['matavfall', 'Matavfall'],
    ['restavfall', 'Restavfall']
  ];

  for (const [key, title] of wasteTypes) {
    const date = j[key];

    if (
      !validDate(date) ||
      daysUntil(date, now) < 0
    ) {
      continue;
    }

    lines.push(
      'BEGIN:VEVENT',
      `UID:${key}-${date}@rossohamn.se`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${addDays(date, 1).replaceAll('-', '')}`,
      `SUMMARY:Sophämtning - ${title}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}

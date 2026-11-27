import {
  TZ,
  dateKey,
  addDays,
  ageStatus,
  timeText,
  dateTimeText,
  timestampMs,
  numberText,
  fetchJson,
  PATHS,
  getStorage,
  setStorage,
  removeStorage
} from './core.js';

// ============================================================
// Electricity tariff
// ============================================================

export const TARIFF_DEFAULTS = Object.freeze({
  supplierMarkupOreExVat: 5.30,
  gridTransferOreIncVat: 26,
  energyTaxOreIncVat: 45,
  vatPercent: 25
});

export const TARIFF_KEYS = Object.keys(TARIFF_DEFAULTS);

let defaults = { ...TARIFF_DEFAULTS };

let source =
  'Inbyggda exempelvärden (senast kända 2026-11-17; inte liveverifierade).';

let initPromise;

export function validateTariff(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return TARIFF_KEYS.every(k =>
    typeof value[k] === 'number' &&
    Number.isFinite(value[k]) &&
    (k === 'supplierMarkupOreExVat' || value[k] >= 0)
  );
}

export function initializeTariff() {
  return initPromise ??= (async () => {
    try {
      const j = await fetchJson(PATHS.energy);

      if (j.schemaVersion !== 1 || !validateTariff(j)) {
        throw new Error('Ogiltig konfiguration');
      }

      defaults = Object.fromEntries(
        TARIFF_KEYS.map(k => [k, j[k]])
      );

      source = typeof j.source === 'string'
        ? j.source
        : 'Publicerade grundvärden';

      if (timestampMs(j.updatedAt) !== null) {
        source += ` · ${dateTimeText(timestampMs(j.updatedAt))}`;
      }

    } catch {
      source =
        'Konfigurationsfilen kunde inte läsas. Inbyggda exempelvärden används.';
    }

    return defaults;
  })();
}

export function tariffSource() {
  return source;
}

export function tariffSettings() {
  return Object.fromEntries(
    TARIFF_KEYS.map(k => {
      const v = getStorage('rossohamn_' + k);

      const n = v === null || v.trim() === ''
        ? NaN
        : Number(v);

      return [
        k,
        Number.isFinite(n) &&
        (k === 'supplierMarkupOreExVat' || n >= 0)
          ? n
          : defaults[k]
      ];
    })
  );
}

export function saveTariff(settings) {
  if (!validateTariff(settings)) {
    throw new Error('Ogiltiga avgifter');
  }

  const results = TARIFF_KEYS.map(k =>
    setStorage('rossohamn_' + k, String(settings[k]))
  );

  return results.every(Boolean);
}

export function resetTariff() {
  TARIFF_KEYS.forEach(k =>
    removeStorage('rossohamn_' + k)
  );
}

// ============================================================
// Electricity price calculation
// ============================================================

export function calcPrice(spotOre, settings) {
  if (!Number.isFinite(spotOre) || !validateTariff(settings)) {
    return null;
  }

  const vatOre =
    (spotOre + settings.supplierMarkupOreExVat) *
    settings.vatPercent / 100;

  const totalOre =
    spotOre +
    settings.supplierMarkupOreExVat +
    vatOre +
    settings.gridTransferOreIncVat +
    settings.energyTaxOreIncVat;

  return {
    spotOre,
    vatOre,
    totalOre,
    totalSek: totalOre / 100
  };
}

export function metricToOre(metric, value, eursek) {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (metric === 'oreKwh') {
    return value;
  }

  if (metric === 'sekKwh') {
    return value * 100;
  }

  if (
    metric === 'eurMwh' &&
    Number.isFinite(Number(eursek)) &&
    Number(eursek) > 0
  ) {
    return value * Number(eursek) / 10;
  }

  return null;
}

// ============================================================
// Time and daylight saving time
// ============================================================

export function dayBounds(key) {
  const approx = Date.parse(key + 'T00:00:00Z');

  if (!Number.isFinite(approx)) {
    return null;
  }

  const mid = (d) => {
    for (const offset of [1, 2]) {
      const t =
        Date.parse(d + 'T00:00:00Z') -
        offset * 3600000;

      if (
        dateKey(new Date(t)) === d &&
        timeText(t) === '00:00'
      ) {
        return t;
      }
    }

    return null;
  };

  const start = mid(key);
  const end = mid(addDays(key, 1));

  return start !== null && end !== null
    ? [start, end]
    : null;
}

// ============================================================
// Price data validation
// ============================================================

export function inspectPrice(
  data,
  key,
  {
    now = new Date(),
    maxHours = 30,
    expectedAfterHour = 16,
    tomorrow = false
  } = {}
) {
  const bad = (label, state = 'error') => ({
    state,
    label,
    detail: '',
    points: [],
    data: null
  });

  const hour = Number(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ,
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(now)
  );

  if (!data || typeof data !== 'object') {
    return bad('JSON saknas');
  }

  const m = data.meta;

  if (m?.date !== key) {
    return bad(
      tomorrow && hour < expectedAfterHour
        ? 'Inväntar publicering'
        : 'Fel datum i JSON',

      tomorrow && hour < expectedAfterHour
        ? 'warn'
        : 'error'
    );
  }

  const rm = m.resolutionMinutes;
  const bounds = dayBounds(key);

  if (
    ![15, 30, 60].includes(rm) ||
    !bounds ||
    m.area !== 'SE3' ||
    m.timeZone !== TZ ||
    m.includesTransferFee !== false
  ) {
    return bad('Oväntat prisformat');
  }

  const expected =
    (bounds[1] - bounds[0]) / (rm * 60000);

  if (
    m.expected !== expected ||
    !Array.isArray(data.raw?.points) ||
    !Array.isArray(data.timeline) ||
    data.timeline.length !== expected ||
    data.raw.points.length !== expected
  ) {
    return bad('Fel antal tidsintervall');
  }

  const points = [];

  for (let i = 0; i < expected; i++) {
    const t = bounds[0] + i * rm * 60000;
    const p = data.raw.points[i];
    const timeline = data.timeline[i];

    if (Date.parse(timeline?.utc) !== t) {
      return bad('Fel i tidslinjen');
    }

    if (
      p !== null &&
      (
        !p ||
        Date.parse(p.utc) !== t ||
        !(p.oreKwh === null || Number.isFinite(p.oreKwh))
      )
    ) {
      return bad('Fel i rådata');
    }

    points.push({
      t,
      end: t + rm * 60000,
      ore: Number.isFinite(p?.oreKwh)
        ? p.oreKwh
        : null
    });
  }

  const count = points.filter(
    p => p.ore !== null
  ).length;

  const detail =
    `${count}/${expected} intervall · ` +
    `${rm} min · ` +
    `${dateTimeText(timestampMs(m.updatedAt))}`;

  if (m.present !== count) {
    return {
      ...bad('Metadata stämmer inte med rådata'),
      detail
    };
  }

  const age = ageStatus(
    m.updatedAt,
    maxHours,
    now
  );

  if (age.state !== 'ok') {
    return {
      ...age,
      detail,
      points: [],
      data
    };
  }

  if (count !== expected) {
    return {
      state: 'warn',
      label: count === 0
        ? 'Inga prisvärden'
        : 'Ofullständig',
      detail,
      points,
      data
    };
  }

  return {
    state: 'ok',
    label: 'Aktuell',
    detail,
    points,
    data
  };
}

// ============================================================
// Current electricity price
// ============================================================

export function currentPoint(points, now = new Date()) {
  return points.find(p =>
    p.t <= +now &&
    p.end > +now &&
    Number.isFinite(p.ore)
  ) ?? null;
}

// ============================================================
// Cheapest upcoming electricity price window
// ============================================================

export function cheapestUpcoming(
  points,
  hours,
  now = new Date()
) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return null;
  }

  const target = hours * 3600000;

  const a = points
    .filter(p => p.t >= +now)
    .sort((a, b) => a.t - b.t);

  let best = null;

  for (let i = 0; i < a.length; i++) {
    let duration = 0;
    let sum = 0;
    let prev = a[i].t;

    for (
      let j = i;
      j < a.length && duration < target;
      j++
    ) {
      const p = a[j];
      const d = p.end - p.t;

      if (
        !Number.isFinite(p.ore) ||
        p.t !== prev ||
        !Number.isFinite(d) ||
        d <= 0
      ) {
        break;
      }

      duration += d;
      sum += p.ore * d;
      prev = p.end;

      if (duration === target) {
        const avg = sum / target;

        if (!best || avg < best.avg) {
          best = {
            start: a[i].t,
            end: p.end,
            avg
          };
        }
      }
    }
  }

  return best;
}

// ============================================================
// Interval formatting
// ============================================================

export function intervalText(start, end) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return '—';
  }

  const f = t =>
    `${dateKey(new Date(t)).slice(5)} ${timeText(t)}`;

  const offset = t =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: TZ,
      timeZoneName: 'shortOffset'
    })
      .formatToParts(new Date(t))
      .find(p => p.type === 'timeZoneName')
      ?.value ?? '';

  return `${f(start)}–${f(end)}${
    offset(start) !== offset(end)
      ? ` (${offset(start)} → ${offset(end)})`
      : ''
  }`;
}

// ============================================================
// Load price data
//
// Select data using meta.date instead of filename.
// Yesterday's tomorrow.json remains valid after midnight
// until the next publication replaces the daily files.
// ============================================================

export async function loadPriceDays(
  site,
  now = new Date()
) {
  const key = dateKey(now);

  const read = async (path) => {
    try {
      return {
        path,
        data: await fetchJson(path)
      };

    } catch (e) {
      return {
        path,
        error: e.message
      };
    }
  };

  // Fetch both existing API files in parallel.

  const [a, b] = await Promise.all([
    read(PATHS.today),
    read(PATHS.tomorrow)
  ]);

  function select(
    expectedDate,
    isTomorrow,
    preferred,
    alternate
  ) {
    const options = {
      now,
      maxHours: site.freshnessHours.prices,
      expectedAfterHour: site.tomorrowExpectedAfterHour,
      tomorrow: isTomorrow
    };

    // Find the file containing the requested date,
    // regardless of its filename.

    const match = [preferred, alternate].find(
      f => f.data?.meta?.date === expectedDate
    );

    if (match) {
      const result = inspectPrice(
        match.data,
        expectedDate,
        options
      );

      return {
        ...result,
        detail: [
          result.detail,
          match.path.split('/').pop()
        ].filter(Boolean).join(' · ')
      };
    }

    // Report failed downloads.

    const failed = [preferred, alternate].filter(
      f => f.error
    );

    if (failed.length) {
      return {
        state: 'error',
        label: 'Kunde inte läsa',
        detail: failed.map(
          f => f.path.split('/').pop() + ': ' + f.error
        ).join(' · '),
        points: [],
        data: null
      };
    }

    // No matching date has been published.

    const result = inspectPrice(
      preferred.data,
      expectedDate,
      options
    );

    return {
      ...result,
      detail:
        'Förväntat: ' + expectedDate +
        ' · Publicerat: ' +
        [a, b].map(
          f => f.data?.meta?.date ?? 'okänt'
        ).join(' / ')
    };
  }

  const today = select(
    key,
    false,
    a,
    b
  );

  const tomorrow = select(
    addDays(key, 1),
    true,
    b,
    a
  );

  return {
    today,
    tomorrow,
    points: [
      ...today.points,
      ...tomorrow.points
    ]
  };
}

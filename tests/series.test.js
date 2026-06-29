import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRangeKeys,
  buildUtcWindowSeries,
  cheapestWindow,
  interpolateSmallGapsLinear,
  slotsForHours,
  windowTimeTextRange,
  windowTimeTextSingleDay
} from "../spotprices/lib/series.js";

function makeDay(dayKey, count = 96, resolutionMinutes = 15, startUtc = "2026-06-28T22:00:00.000Z") {
  const startMs = new Date(startUtc).getTime();
  return {
    present: count,
    expected: count,
    resolutionMinutes,
    points: Array.from({ length: count }, (_, i) => {
      const utc = new Date(startMs + i * resolutionMinutes * 60000).toISOString();
      const localMinutes = i * resolutionMinutes;
      const time = `${String(Math.floor(localMinutes / 60) % 24).padStart(2, "0")}:${String(localMinutes % 60).padStart(2, "0")}`;
      return { utc, time, oreKwh: i + 1 };
    })
  };
}

test("slotsForHours supports 15, 30 and 60 minute resolution", () => {
  assert.equal(slotsForHours(2, 15), 8);
  assert.equal(slotsForHours(4, 30), 8);
  assert.equal(slotsForHours(8, 60), 8);
});

test("linear interpolation only fills bounded gaps up to maxGap", () => {
  assert.deepEqual(interpolateSmallGapsLinear([0, null, null, 3], 2), [0, 1, 2, 3]);
  assert.deepEqual(interpolateSmallGapsLinear([null, 1, 2], 2), [null, 1, 2]);
  assert.deepEqual(interpolateSmallGapsLinear([0, null, null, null, 4], 2), [0, null, null, null, 4]);
});

test("cheapestWindow rejects incomplete windows", () => {
  assert.deepEqual(cheapestWindow([5, 4, 3, 2], 2), { startIdx: 2, endIdx: 3, avg: 2.5 });
  assert.equal(cheapestWindow([1, null, 2], 2), null);
});

test("range keys end at today and exclude future dates", () => {
  const days = {
    "2026-06-26": {},
    "2026-06-27": {},
    "2026-06-28": {},
    "2026-06-29": {},
    "2026-06-30": {}
  };
  assert.deepEqual(buildRangeKeys(days, 3, "2026-06-29"), ["2026-06-27", "2026-06-28", "2026-06-29"]);
});

test("single-day window displays an exclusive end time", () => {
  const day = makeDay("2026-06-29");
  const win = { startIdx: 50, endIdx: 57, avg: 1 };
  const text = windowTimeTextSingleDay("2026-06-29", day, win, () => "");
  assert.equal(text, "2026-06-29 12:30 → 2026-06-29 14:30");
});

test("range window displays exclusive end across midnight", () => {
  const refs = [
    { dayKey: "2026-06-29", time: "23:45", utc: "2026-06-29T21:45:00.000Z", resolutionMinutes: 15 },
    { dayKey: "2026-06-30", time: "00:00", utc: "2026-06-29T22:00:00.000Z", resolutionMinutes: 15 }
  ];
  assert.equal(
    windowTimeTextRange(refs, { startIdx: 0, endIdx: 1, avg: 1 }),
    "2026-06-29 23:45 → 2026-06-30 00:15"
  );
});

test("UTC publish window contains exactly 20 hours and includes previous day near midnight", () => {
  const days = {
    "2026-06-28": makeDay("2026-06-28", 96, 15, "2026-06-27T22:00:00.000Z"),
    "2026-06-29": makeDay("2026-06-29", 96, 15, "2026-06-28T22:00:00.000Z")
  };
  const result = buildUtcWindowSeries(days, "oreKwh", new Date("2026-06-28T22:30:00.000Z"));
  assert.equal(result.series.length, 80);
  assert.equal(result.refs[0].dayKey, "2026-06-28");
  assert.equal(result.refs.at(-1).dayKey, "2026-06-29");
  assert.equal(result.endUtcMs - result.startUtcMs, 20 * 60 * 60 * 1000);
});

test("UTC publish window keeps fixed duration through spring DST transition", () => {
  const days = { "2026-03-29": { resolutionMinutes: 15, points: [] } };
  const result = buildUtcWindowSeries(days, "oreKwh", new Date("2026-03-29T01:30:00.000Z"));
  assert.equal(result.series.length, 80);
  assert.equal(result.endUtcMs - result.startUtcMs, 20 * 60 * 60 * 1000);
  assert.equal(result.labels.some(label => / 02:/.test(label)), false);
});

test("UTC publish window keeps fixed duration through autumn DST transition", () => {
  const days = { "2026-10-25": { resolutionMinutes: 15, points: [] } };
  const result = buildUtcWindowSeries(days, "oreKwh", new Date("2026-10-25T01:30:00.000Z"));
  assert.equal(result.series.length, 80);
  assert.equal(result.endUtcMs - result.startUtcMs, 20 * 60 * 60 * 1000);
  assert.ok(result.labels.filter(label => / 02:/.test(label)).length > 4);
});

test("UTC publish window respects other resolutions", () => {
  for (const [rm, expected] of [[15, 80], [30, 40], [60, 20]]) {
    const days = { "2026-06-29": { resolutionMinutes: rm, points: [] } };
    const result = buildUtcWindowSeries(days, "oreKwh", new Date("2026-06-29T12:00:00.000Z"));
    assert.equal(result.series.length, expected);
  }
});

test("missing price points remain null in generated UTC window", () => {
  const day = makeDay("2026-06-29");
  day.points[52] = null;
  day.present = 95;
  const result = buildUtcWindowSeries({ "2026-06-29": day }, "oreKwh", new Date("2026-06-29T12:00:00.000Z"));
  assert.ok(result.series.includes(null));
});

"use strict";
/* Fidelity check for coincidenceLimitCheck.js's pure math (per CLAUDE.md: non-trivial
   logic leaves one runnable check behind). Run directly: `node coincidenceLimitCheck.selfcheck.js`. */

const { checkCoincidenceLimit, formatMinuteRanges, DEFAULT_LB_COINCIDENCE_LIMIT, DEFAULT_LS_COINCIDENCE_LIMIT } = require("./coincidenceLimitCheck.js");

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

// ---- Defaults sanity ----
assert(DEFAULT_LB_COINCIDENCE_LIMIT === 30000, "LB default is 30,000 counts/mL (Pamas, the stricter of the two LB figures)");
assert(DEFAULT_LS_COINCIDENCE_LIMIT === 12000, "LS default is 12,000 counts/mL (Pamas, the only figure supplied)");

// ---- Basic exceed/no-exceed, using the confirmed formula: sensorCount = rawCount / ratio ----
{
  // 3 records, ratio 10:1 throughout, limit 1000. Records 0,1 at 5000/10=500 (ok);
  // record 2 at 20000/10=2000 (exceeds).
  const times = [0, 60, 120];
  const rawCounts = [5000, 5000, 20000];
  const ratios = [10, 10, 10];
  const result = checkCoincidenceLimit(times, rawCounts, ratios, 1000);
  assert(result.exceeded === true, "a record whose sensorCount exceeds the limit is flagged");
  assert(result.peakSensorCount === 2000, "peakSensorCount is the highest sensorCount seen (got " + result.peakSensorCount + ")");
  assert(result.offendingMinuteRanges.length === 1 && result.offendingMinuteRanges[0].startMin === 2 && result.offendingMinuteRanges[0].endMin === 2,
    "the single offending record lands on minute 2 (got " + JSON.stringify(result.offendingMinuteRanges) + ")");
}

// ---- No exceedance ----
{
  const result = checkCoincidenceLimit([0, 60], [100, 200], [10, 10], 1000);
  assert(result.exceeded === false, "well within limit: not flagged");
  assert(result.offendingMinuteRanges.length === 0, "no offending ranges when nothing exceeds");
}

// ---- Exactly AT the limit does not count as exceeding (> not >=) ----
{
  const result = checkCoincidenceLimit([0], [1000], [1], 1000);
  assert(result.exceeded === false, "a sensorCount exactly AT the limit is not flagged (strictly greater than, not >=)");
}

// ---- Ratio of 0 means "dilution stage inactive" (undiluted, effective ratio 1), not
// skipped/no-data — confirmed by the user against two real-file cases. ----
{
  // rawCount 50000, ratio 0 -> effective ratio 1 -> sensorCount 50000, limit 30000 -> exceeds.
  const result = checkCoincidenceLimit([0], [50000], [0], 30000);
  assert(result.exceeded === true, "ratio of 0 is treated as undiluted (ratio 1), not skipped (got peak " + result.peakSensorCount + ")");
  assert(result.peakSensorCount === 50000, "ratio-of-0 record computes sensorCount as rawCount/1, not skipped (got " + result.peakSensorCount + ")");
}

// ---- Missing channel entirely (null) is different from a ratio of 0 — nothing to compute ----
{
  const result = checkCoincidenceLimit([0, 60], [50000, 50000], null, 30000);
  assert(result.exceeded === false, "a null ratio channel (doesn't exist in the file) is skipped entirely, not treated as 0/undiluted");
  assert(result.peakSensorCount === null, "no peak computed when the ratio channel doesn't exist");
}

// ---- Individual null/non-finite records within an otherwise-valid series are skipped,
// not treated as 0 ----
{
  const result = checkCoincidenceLimit([0, 60, 120], [50000, null, 50000], [1, 1, 1], 30000);
  assert(result.exceeded === true, "a null record mid-series doesn't break the check for the surrounding valid records");
  assert(result.offendingMinuteRanges.length === 2, "the null record's own minute isn't a phantom offender (got " + JSON.stringify(result.offendingMinuteRanges) + ")");
}

// ---- Range collapsing: adjacent minutes merge, non-adjacent stay separate ----
{
  // Minutes 12,13,14,15 (offending) then 40,41,42 (offending), gap between.
  const times = [];
  const rawCounts = [];
  const ratios = [];
  for (const m of [10, 11, 12, 13, 14, 15, 20, 40, 41, 42, 50]) {
    times.push(m * 60);
    const offending = [12, 13, 14, 15, 40, 41, 42].includes(m);
    rawCounts.push(offending ? 999999 : 1);
    ratios.push(1);
  }
  const result = checkCoincidenceLimit(times, rawCounts, ratios, 1000);
  assert(result.offendingMinuteRanges.length === 2, "two separate ranges collapsed correctly (got " + JSON.stringify(result.offendingMinuteRanges) + ")");
  assert(result.offendingMinuteRanges[0].startMin === 12 && result.offendingMinuteRanges[0].endMin === 15, "first range is 12-15");
  assert(result.offendingMinuteRanges[1].startMin === 40 && result.offendingMinuteRanges[1].endMin === 42, "second range is 40-42");
  assert(formatMinuteRanges(result.offendingMinuteRanges) === "12–15 min, 40–42 min",
    "formatMinuteRanges collapses into the expected display string (got: " + formatMinuteRanges(result.offendingMinuteRanges) + ")");
}

// ---- formatMinuteRanges: a single-point range reads as one minute mark, not a "N-N" range ----
{
  assert(formatMinuteRanges([{ startMin: 5, endMin: 5 }]) === "5 min", "a single offending minute reads as '5 min', not '5-5 min'");
  assert(formatMinuteRanges([]) === "", "no ranges formats as an empty string");
}

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) FAILED.");
if (failures > 0) process.exit(1);

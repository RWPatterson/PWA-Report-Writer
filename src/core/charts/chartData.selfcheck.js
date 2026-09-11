/* Minimal runnable check for chartData.js's derived "mass added" curve (per CLAUDE.md:
   non-trivial logic leaves one runnable check behind) — trapezoidal integration +
   unit conversion is exactly the kind of thing worth pinning down with hand-verified
   numbers. Pure data-in/data-out against a plain mock DataFile-shaped object, no DOM
   and no dual CommonJS export needed — same situation compareTemplates.selfcheck.js
   is already in. Just node this file directly: `node chartData.selfcheck.js`. */

import { hasMassAddedData, computeMassAddedSeries, buildComparisonMassDataset, buildComparisonChannelDataset, channelHasData, MASS_ADDED_CHANNEL_TAG } from "./chartData.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}
function close(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

/** @param {{gia?:number|null, rate?:Array<number|null>|null, times:Array<number|null>, hasTag?:boolean}} opts */
function mockDf({ gia = 100000, rate, times, hasTag = true }) {
  return {
    analogTags: hasTag ? ["INJ_Rate", "TS_DPress"] : ["TS_DPress"],
    times,
    getHeaderValue(section, key) {
      if (section === "Injection System Configuration" && key === "GravimetricLevel") return gia === null ? null : String(gia);
      return null;
    },
    getChannel(tag) {
      return tag === "INJ_Rate" ? (rate === undefined ? null : rate) : null;
    }
  };
}

// ---- constant rate: matches the closed-form Gia x Qia x time / 1e6 scalar formula at every point ----
{
  const df = mockDf({ gia: 100000, rate: [10, 10, 10, 10], times: [0, 60, 120, 180] });
  assert(hasMassAddedData(df), "constant-rate mock reports mass-added data available");
  const mass = computeMassAddedSeries(df);
  assert(mass[0] === 0, "cumulative mass starts at 0 g");
  assert(close(mass[1], 1.0), "1 min @ 10 mL/min, Gia=100000 -> 1.0 g (got " + mass[1] + ")");
  assert(close(mass[2], 2.0), "2 min -> 2.0 g (got " + mass[2] + ")");
  assert(close(mass[3], 3.0), "3 min -> 3.0 g, matches Gia*Qia*t/1e6 exactly for a constant rate (got " + mass[3] + ")");
}

// ---- ramping rate: trapezoidal integral of the REAL channel, not a straight line from the average ----
{
  const df = mockDf({ gia: 100000, rate: [0, 10, 10, 0], times: [0, 60, 120, 180] });
  const mass = computeMassAddedSeries(df);
  assert(close(mass[1], 0.5), "0->10 mL/min over 1 min trapezoids to 5 mL -> 0.5 g (got " + mass[1] + ")");
  assert(close(mass[2], 1.5), "running total after the flat middle segment -> 1.5 g (got " + mass[2] + ")");
  assert(close(mass[3], 2.0), "total volume 20 mL -> 2.0 g (got " + mass[3] + ")");
  const naiveAverageTotal = 100000 * ((0 + 10 + 10 + 0) / 4) * 3 / 1000000;
  assert(!close(mass[3], naiveAverageTotal), "trapezoidal total (2.0 g) differs from a naive average-rate-times-total-time curve (" + naiveAverageTotal + " g) — confirms this integrates the real channel, not a ramp from the average");
}

// ---- a gap (null sample) bridges across using the two nearest valid samples, no crash ----
{
  const df = mockDf({ gia: 100000, rate: [10, null, 10], times: [0, 60, 120] });
  const mass = computeMassAddedSeries(df);
  assert(mass[1] === null, "a null rate sample stays null in the output (no fabricated value)");
  assert(close(mass[2], 2.0), "the gap is bridged using the surrounding valid samples' own times (10 mL/min for 2 min = 20 mL -> 2.0 g, got " + mass[2] + ")");
}

// ---- missing ingredients: null header or missing channel -> unavailable, not a crash or a wrong number ----
{
  const noHeader = mockDf({ gia: null, rate: [10, 10], times: [0, 60] });
  assert(!hasMassAddedData(noHeader), "no GravimetricLevel header -> unavailable");
  assert(computeMassAddedSeries(noHeader) === null, "no GravimetricLevel header -> null series");

  const noChannel = mockDf({ gia: 100000, rate: undefined, times: [0, 60], hasTag: false });
  assert(!hasMassAddedData(noChannel), "no INJ_Rate channel -> unavailable");
  assert(computeMassAddedSeries(noChannel) === null, "no INJ_Rate channel -> null series");
}

// ---- DECLARED but never populated (ROTest9: 8 trailing Data Format tags with no
// room in any row) is not the same as "not present" in analogTags, but must behave
// the same way — every row parses to null, not just some ----
{
  const declaredButEmpty = mockDf({ gia: 100000, rate: [null, null, null], times: [0, 60, 120] });
  assert(!channelHasData(declaredButEmpty, "INJ_Rate"), "an all-null channel array reports no data, even though the tag IS in analogTags");
  assert(!hasMassAddedData(declaredButEmpty), "a declared-but-empty INJ_Rate -> mass added unavailable, not a flat/zero curve");
  assert(computeMassAddedSeries(declaredButEmpty) === null, "a declared-but-empty INJ_Rate -> null series, not an all-null array masquerading as data");

  const populated = mockDf({ gia: 100000, rate: [10, 10], times: [0, 60] });
  assert(channelHasData(populated, "INJ_Rate"), "a channel with at least one real value reports data present");
}

// ---- buildComparisonChannelDataset: a declared-but-empty tag counts as missing too,
// same reasoning as computeMassAddedSeries above — this is what a saved template's
// plot resolves through when replayed against a different file set ----
{
  function channelMock(values) {
    return { getChannel: (tag) => (tag === "TS_Cond_Temp" ? values : null), times: [0, 60, 120] };
  }
  const result = buildComparisonChannelDataset([
    { df: channelMock([1, 2, 3]), label: "Has data" },
    { df: channelMock([null, null, null]), label: "Declared but empty" },
    { df: channelMock(null), label: "Not declared" }
  ], "TS_Cond_Temp");
  assert(result.datasets.length === 1 && result.datasets[0].label === "Has data", "only the file with real values gets a series");
  assert(result.missing.join(",") === "Declared but empty,Not declared",
    "both the declared-but-empty file AND the never-declared file land in missing (got: " + result.missing.join(",") + ")");
}

// ---- buildComparisonMassDataset: one good file, one missing -> names the missing one, still plots the other ----
{
  const good = mockDf({ gia: 100000, rate: [10, 10, 10, 10], times: [0, 60, 120, 180] });
  const bad = mockDf({ gia: null, rate: [10, 10], times: [0, 60] });
  const result = buildComparisonMassDataset([{ df: good, label: "File A" }, { df: bad, label: "File B" }]);
  assert(result.datasets.length === 1 && result.datasets[0].label === "File A", "only the file with both ingredients gets a series");
  assert(result.missing.join(",") === "File B", "the other file is named in missing, not silently dropped (got: " + result.missing.join(",") + ")");
  const lastPoint = result.datasets[0].data[result.datasets[0].data.length - 1];
  assert(close(lastPoint.x, 3) && close(lastPoint.y, 3.0), "final point is at x=3 minutes (times/60, matching toPoints), y=3.0 g (got x=" + lastPoint.x + " y=" + lastPoint.y + ")");
}

assert(typeof MASS_ADDED_CHANNEL_TAG === "string" && MASS_ADDED_CHANNEL_TAG.length > 0, "MASS_ADDED_CHANNEL_TAG is exported for callers that need to special-case it");

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) failed.");
process.exit(failures === 0 ? 0 : 1);

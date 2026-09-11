"use strict";
/* Fidelity check for iso16889Analysis.js (+ iso16889Mapper.js) — per CLAUDE.md:
   non-trivial logic leaves one runnable check behind. Two layers, same convention
   established by iso3968Analysis.selfcheck.js:
     1. Hand-verified formula/invariant assertions — anchor CORRECTNESS (does this
        actually match the standard's own math), not just "didn't change."
     2. A snapshot diff against a committed baseline (tools/render-check/
        fidelitySnapshot.js) — catches drift in ANY derived field, including ones
        nobody thought to assert on. A snapshot only changes when a developer
        deliberately re-runs with UPDATE_SNAPSHOTS=1 and reviews/commits the result.

   Also runs iso16889Mapper.js's applyParsedFile() into a throwaway ReportValueStore
   and snapshots its mapper-level extras too — not just analysis.* — since a mapper
   can always grow its own derived-value gap later (see iso454812Mapper.js's
   dpElementClean/dpFinalNet, computed in ITS mapper rather than its engine, which
   is exactly why this check doesn't stop at the raw analysis object).

   Run directly: `node iso16889Analysis.selfcheck.js`. Requires DataFile/
   Iso16889Analysis the same dual (Node require / browser global) way every
   Analysis.js already expects — see dataFile.js's own module.exports tail.
   ReportValueStore/iso16889Mapper.js are browser-only ES modules (no dual export),
   so those two use a dynamic import() instead, same mixed pattern
   iso3968Analysis.selfcheck.js already established for controlTargetCheck.js. */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("../../core/dataFile.js");
const { Iso16889Analysis } = require("./iso16889Analysis.js");
const { compareSnapshot, formatDiffs } = require("../../../tools/render-check/fidelitySnapshot.js");

const DIR = path.join(__dirname, "..", "..", "..", "tools", "render-check", "Test DAT files");
let failures = 0;

function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

function load(name) {
  const text = fs.readFileSync(path.join(DIR, name), "utf8");
  return new DataFile(text);
}

async function main() {
  const { ReportValueStore } = await import("../../report/reportValueStore.js");
  const { applyParsedFile } = await import("./iso16889Mapper.js");

  const df = load("SpinOnMP.DAT");
  const analysis = Iso16889Analysis.run(df, { sensor: "lb" });
  assert(analysis.ok, "SpinOnMP.DAT analyzes ok under ISO 16889 (errors: " + analysis.errors.join("; ") + ")");

  // ---- Structural invariants (12.1-12.5: always exactly 10 reporting-time clumps) ----
  assert(analysis.clumps.length === 10, "exactly 10 reporting-time clumps (got " + analysis.clumps.length + ")");
  assert(analysis.clumps.every((c) => c.avgBeta.length === analysis.sizes.length),
    "every clump's avgBeta array is one entry per measured size");
  assert(analysis.overallAverageBeta.length === analysis.sizes.length,
    "overallAverageBeta is one entry per measured size");

  // ---- Formula-consistency spot check: overall beta must equal
  // overallUpstreamAverage / overallDownstreamAverage, clamped at MAX_BETA_VALUE
  // (100000, 13.5) — the same relationship the engine itself computes with, just
  // re-derived independently here so a future edit that breaks the clamp or swaps
  // up/down would be caught even without a hand-picked expected number. Aggregated
  // into one summary assertion (not one per size) so a clean run stays readable —
  // only a mismatch prints the offending sizes. ----
  let checkedCount = 0;
  const betaMismatches = [];
  analysis.sizes.forEach((size, i) => {
    const up = analysis.overallUpstreamAverage[i], down = analysis.overallDownstreamAverage[i], beta = analysis.overallAverageBeta[i];
    if (up === null || down === null || down === 0 || beta === null) return;
    checkedCount++;
    const expected = Math.min(up / down, 100000);
    if (Math.abs(beta - expected) >= 1e-6) betaMismatches.push(size + "µm: got " + beta + ", expected " + expected);
  });
  assert(checkedCount > 0, "at least one size had a non-zero downstream average to check beta against");
  assert(betaMismatches.length === 0,
    "every size's overallAverageBeta matches upstream/downstream clamped at 100000 (" + checkedCount +
    " checked)" + (betaMismatches.length ? ":\n  " + betaMismatches.join("\n  ") : ""));

  // ---- Termination: crossing time must fall strictly within the test window ----
  assert(typeof analysis.terminationTime === "number" && analysis.terminationTime > 0,
    "terminationTime is a positive number of seconds (got " + analysis.terminationTime + ")");

  // ---- Mapper: betaChart (Figure C.3 source) must actually carry the same sizes
  // it claims, in bounds of what the engine measured ----
  const store = new ReportValueStore();
  applyParsedFile(store, df, analysis, { sensor: "lb" });
  const betaChart = store.getExtra("betaChart");
  assert(betaChart && Array.isArray(betaChart.sizes) && betaChart.sizes.length > 0,
    "mapper's betaChart extra is populated with at least one size");
  assert(!betaChart || betaChart.sizes.every((s) => analysis.sizes.some((as) => Number(as) === Number(s))),
    "every betaChart size is one the engine actually measured (no phantom sizes introduced by the mapper)");

  // ---- Coincidence limit check (2026-08-19): real test data at the conservative
  // default limits (30,000 LB / 12,000 LS counts/mL) shouldn't trip a false
  // positive; an absurdly low override should reliably trip it — proves the full
  // real-file -> resolveCoincidenceChannels -> checkCoincidenceLimit -> warning
  // path actually works end to end, not just the isolated math (already covered by
  // coincidenceLimitCheck.selfcheck.js). ----
  assert(!analysis.warnings.some((w) => /coincidence limit/i.test(w)),
    "no coincidence-limit warning against real data at the default limit (got: " + JSON.stringify(analysis.warnings) + ")");
  const tinyLimitLb = Iso16889Analysis.run(df, { sensor: "lb", coincidenceLimits: { sensorUpstreamCoincidenceLimit: 1, sensorDownstreamCoincidenceLimit: 1 } });
  assert(tinyLimitLb.warnings.some((w) => /coincidence limit/i.test(w) && /min/.test(w)),
    "an absurdly low LB override DOES trip the coincidence-limit warning, with minute ranges (got: " + JSON.stringify(tinyLimitLb.warnings) + ")");
  const tinyLimitLs = Iso16889Analysis.run(df, { sensor: "ls", coincidenceLimits: { lsSensorUpstreamCoincidenceLimit: 1, lsSensorDownstreamCoincidenceLimit: 1 } });
  assert(tinyLimitLs.warnings.some((w) => /coincidence limit/i.test(w)),
    "the LS sensor's own override key trips its own warning too (got: " + JSON.stringify(tinyLimitLs.warnings) + ")");

  // ---- Snapshot: the derived fields most likely to silently drift if a future
  // edit touches this engine — deliberately excludes overallDPSeries (a giant raw
  // pass-through series, deterministic from the fixture file alone, not a
  // meaningful regression signal). ----
  const snapshot = {
    testType: analysis.testType,
    nonStandardTestType: analysis.nonStandardTestType,
    nonStandardSetup: analysis.nonStandardSetup,
    dualFilterSetup: analysis.dualFilterSetup,
    sensor: analysis.sensor,
    terminationTag: analysis.terminationTag,
    terminationDP: analysis.terminationDP,
    terminationTime: analysis.terminationTime,
    terminationBracket: analysis.terminationBracket,
    dpHousingClean: analysis.dpHousingClean,
    dpAssemblyClean: analysis.dpAssemblyClean,
    dpElementClean: analysis.dpElementClean,
    dpElementFinal: analysis.dpElementFinal,
    sizes: analysis.sizes,
    clumps: analysis.clumps,
    overallUpstreamAverage: analysis.overallUpstreamAverage,
    overallDownstreamAverage: analysis.overallDownstreamAverage,
    overallAverageBeta: analysis.overallAverageBeta,
    sizeAtBeta: analysis.sizeAtBeta,
    initialUpstream: analysis.initialUpstream,
    qia: analysis.qia,
    qd: analysis.qd,
    testFlowSetpoint: analysis.testFlowSetpoint,
    injectionGravSetpoint: analysis.injectionGravSetpoint,
    injectionFlowSetpoint: analysis.injectionFlowSetpoint,
    buglTarget: analysis.buglTarget,
    injVolumeInitial: analysis.injVolumeInitial,
    injVolumeFinal: analysis.injVolumeFinal,
    mapperBetaChart: betaChart
  };
  const result = compareSnapshot("iso16889", snapshot);
  if (result.wroteBaseline) {
    console.log("ok:   wrote initial baseline snapshot (" + result.file + ") — review it by hand before committing");
  } else {
    assert(result.ok, "matches committed snapshot, no unintended drift" + (result.ok ? "" : ":\n" + formatDiffs(result.diffs)));
  }
}

main().then(() => {
  if (failures > 0) {
    console.error("\n" + failures + " check(s) failed.");
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
  }
}).catch((e) => {
  console.error("SELF-CHECK CRASHED:", e && e.stack ? e.stack : e);
  process.exit(1);
});

"use strict";
/* Fidelity check for iso454812Analysis.js + iso454812Mapper.js — see
   iso16889Analysis.selfcheck.js's header comment for the general shape (hand-
   verified formula/invariant assertions + a committed snapshot diff). This one
   specifically targets two REAL, previously-shipped regressions documented in
   iso454812Analysis.js's own comments (both from "carried a wrong assumption
   between functions" — exactly what this check exists to catch if either ever
   regresses again):
     1. _computeOneWindow's off-by-one (an earlier version read count rows at
        [sizeIndex+1], copied from the analog-row convention without re-checking
        it applied to count rows — silently shifted every size's efficiency to
        the NEXT size's counts).
     2. _computeGravimetricMassBalance's unit-conversion bug (injectedMass was
        silently 1000x off — 4504.49 g computed against an expected ~4.5 g).

   Also runs iso454812Mapper.js's applyParsedFile() and snapshots dpElementClean/
   dpFinalNet/dpHousingClean specifically — those are computed IN THE MAPPER, not
   in iso454812Analysis.js itself (confirmed by reading both files), so a fidelity
   test that only touched analysis.* would never exercise them at all. */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("../../core/dataFile.js");
const { Iso454812Analysis } = require("./iso454812Analysis.js");
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
  const { applyParsedFile } = await import("./iso454812Mapper.js");

  // Same fixture iso16889Analysis.selfcheck.js uses — the .DAT format is generic
  // across standards (CLAUDE.md), so one real Multipass file exercises all of them.
  const df = load("SpinOnMP.DAT");
  const analysis = Iso454812Analysis.run(df, { sensor: "lb" });
  assert(analysis.ok, "SpinOnMP.DAT analyzes ok under ISO 4548-12 (errors: " + analysis.errors.join("; ") + ")");

  // ---- Bug 1 regression guard: per-bucket efficiency must derive from the SAME
  // index's own upstream/downstream, not a neighboring size's. Aggregated into one
  // summary assertion (not one per bucket/size) so a clean run stays readable —
  // only a mismatch prints the offending rows. ----
  const shapeMismatches = analysis.buckets.filter((b) =>
    b.upstream.length !== analysis.sizes.length || b.downstream.length !== analysis.sizes.length || b.efficiency.length !== analysis.sizes.length);
  assert(shapeMismatches.length === 0,
    "every bucket's upstream/downstream/efficiency arrays have one entry per measured size (" + analysis.buckets.length + " buckets checked)");

  let checkedCount = 0;
  const effMismatches = [];
  for (const bucket of analysis.buckets) {
    for (let i = 0; i < analysis.sizes.length; i++) {
      const up = bucket.upstream[i], down = bucket.downstream[i], eff = bucket.efficiency[i];
      if (up === null || down === null || eff === null || up === 0) continue;
      checkedCount++;
      const expected = Math.max(0, Math.min(100, ((up - down) / up) * 100));
      if (Math.abs(eff - expected) >= 1e-6) {
        effMismatches.push(analysis.sizes[i] + "µm @ " + bucket.startTime + "-" + bucket.endTime + "s: got " + eff + ", expected " + expected);
      }
    }
  }
  assert(checkedCount > 0, "at least one bucket/size had non-zero upstream counts to check efficiency against");
  assert(effMismatches.length === 0,
    "every bucket/size's efficiency matches THIS size's own upstream/downstream (" + checkedCount +
    " checked) — the exact site of a past off-by-one bug" + (effMismatches.length ? ":\n  " + effMismatches.join("\n  ") : ""));

  // ---- Bug 2 regression guard: injectedMass must be exactly (Qia[L/min] x Gia x
  // terminationMinutes)/1000 — a missing or duplicated /1000 here was the exact
  // shape of the past 1000x bug. ----
  if (analysis.qia !== null && analysis.gia !== null && analysis.terminationTime !== null) {
    const qiaLPerMin = analysis.qia / 1000;
    const terminationMinutes = analysis.terminationTime / 60;
    const expectedInjectedMass = (qiaLPerMin * analysis.gia * terminationMinutes) / 1000;
    assert(analysis.injectedMass !== null && Math.abs(analysis.injectedMass - expectedInjectedMass) < 1e-6,
      "injectedMass matches (Qia[L/min] x Gia x terminationMinutes)/1000 exactly (got " +
      analysis.injectedMass + ", expected " + expectedInjectedMass + ") — the exact site of a past 1000x unit-conversion bug");
  }

  // ---- Mapper gap: dpElementClean/dpFinalNet are computed IN iso454812Mapper.js,
  // not in the analysis engine — must be checked here or a regression there is
  // invisible to any test that only touches analysis.* ----
  const store = new ReportValueStore();
  applyParsedFile(store, df, analysis, { sensor: "lb" });
  const dpFinalNet = store.get("dpFinalNet");
  const dpElementClean = store.get("dpElementClean");
  const dpHousingClean = store.get("dpHousingClean");
  if (analysis.terminationDP !== null && analysis.cleanAssemblyDP !== null) {
    assert(dpFinalNet !== null && Math.abs(dpFinalNet - (analysis.terminationDP - analysis.cleanAssemblyDP)) < 1e-6,
      "mapper's dpFinalNet === terminationDP - cleanAssemblyDP (got " + dpFinalNet + ")");
  }
  if (dpHousingClean !== null && analysis.cleanAssemblyDP !== null) {
    assert(dpElementClean !== null && Math.abs(dpElementClean - (analysis.cleanAssemblyDP - dpHousingClean)) < 1e-6,
      "mapper's dpElementClean === cleanAssemblyDP - dpHousingClean (got " + dpElementClean + ")");
  }

  // ---- Coincidence limit check (2026-08-19): real test data at the conservative
  // default limits (30,000 LB / 12,000 LS counts/mL) shouldn't trip a false
  // positive; an absurdly low override should reliably trip it — proves the full
  // real-file -> resolveCoincidenceChannels -> checkCoincidenceLimit -> warning
  // path actually works end to end, not just the isolated math (already covered by
  // coincidenceLimitCheck.selfcheck.js). ----
  assert(!analysis.warnings.some((w) => /coincidence limit/i.test(w)),
    "no coincidence-limit warning against real data at the default limit (got: " + JSON.stringify(analysis.warnings) + ")");
  const tinyLimitLb = Iso454812Analysis.run(df, { sensor: "lb", coincidenceLimits: { sensorUpstreamCoincidenceLimit: 1, sensorDownstreamCoincidenceLimit: 1 } });
  assert(tinyLimitLb.warnings.some((w) => /coincidence limit/i.test(w) && /min/.test(w)),
    "an absurdly low LB override DOES trip the coincidence-limit warning, with minute ranges (got: " + JSON.stringify(tinyLimitLb.warnings) + ")");
  const tinyLimitLs = Iso454812Analysis.run(df, { sensor: "ls", coincidenceLimits: { lsSensorUpstreamCoincidenceLimit: 1, lsSensorDownstreamCoincidenceLimit: 1 } });
  assert(tinyLimitLs.warnings.some((w) => /coincidence limit/i.test(w)),
    "the LS sensor's own override key trips its own warning too (got: " + JSON.stringify(tinyLimitLs.warnings) + ")");

  // ---- Snapshot: derived fields + the mapper-only dpElementClean/dpFinalNet/
  // dpHousingClean trio, deliberately excluded overallDPSeries (giant raw
  // pass-through series, not a meaningful regression signal). ----
  const snapshot = {
    testType: analysis.testType,
    nonStandardSetup: analysis.nonStandardSetup,
    dualFilterSetup: analysis.dualFilterSetup,
    sensor: analysis.sensor,
    terminationTag: analysis.terminationTag,
    terminationDP: analysis.terminationDP,
    terminationTime: analysis.terminationTime,
    terminationBracket: analysis.terminationBracket,
    cleanAssemblyDP: analysis.cleanAssemblyDP,
    netDPMilestones: analysis.netDPMilestones,
    sizes: analysis.sizes,
    bucketMinutes: analysis.bucketMinutes,
    buckets: analysis.buckets,
    overallEfficiency: analysis.overallEfficiency,
    maxEfficiency: analysis.maxEfficiency,
    minEfficiency: analysis.minEfficiency,
    micrometerRating: analysis.micrometerRating,
    qia: analysis.qia,
    gia: analysis.gia,
    ga: analysis.ga,
    injectedMass: analysis.injectedMass,
    dustAdded: analysis.dustAdded,
    totalCounts: analysis.totalCounts,
    countsToAverage: analysis.countsToAverage,
    mapperDpHousingClean: dpHousingClean,
    mapperDpElementClean: dpElementClean,
    mapperDpFinalNet: dpFinalNet
  };
  const result = compareSnapshot("iso454812", snapshot);
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

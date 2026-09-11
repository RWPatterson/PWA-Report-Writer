"use strict";
/* Fidelity check for iso19438Analysis.js + iso19438Mapper.js — see
   iso16889Analysis.selfcheck.js's header comment for the general shape (hand-
   verified formula/invariant assertions + a committed snapshot diff).

   Like iso454812Mapper.js, iso19438Mapper.js computes dpElementClean/dpFinalNet
   IN THE MAPPER (confirmed by reading it — same pattern, own copy, per CLAUDE.md),
   not in iso19438Analysis.js itself, so this check runs applyParsedFile() and
   checks those two store fields directly rather than trusting analysis.* alone. */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("../../core/dataFile.js");
const { Iso19438Analysis } = require("./iso19438Analysis.js");
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

/** Aggregated efficiency-formula consistency check, shared shape for both the E6
 *  initial-efficiency window and every reporting bucket — one summary assertion
 *  per series rather than one per size/bucket, so a clean run stays readable.
 *  @param {string} label @param {Array<number|null>} upstream @param {Array<number|null>} downstream @param {Array<number|null>} efficiency @param {Array<string|number>} sizes */
function assertEfficiencyMatchesCounts(label, upstream, downstream, efficiency, sizes) {
  let checkedCount = 0;
  const mismatches = [];
  for (let i = 0; i < sizes.length; i++) {
    const up = upstream[i], down = downstream[i], eff = efficiency[i];
    if (up === null || down === null || eff === null || up === 0) continue;
    checkedCount++;
    const expected = Math.max(0, Math.min(100, ((up - down) / up) * 100));
    if (Math.abs(eff - expected) >= 1e-6) mismatches.push(sizes[i] + "µm: got " + eff + ", expected " + expected);
  }
  assert(checkedCount > 0, label + ": at least one size had non-zero upstream counts to check");
  assert(mismatches.length === 0,
    label + ": every size's efficiency matches its own upstream/downstream (" + checkedCount +
    " checked)" + (mismatches.length ? ":\n  " + mismatches.join("\n  ") : ""));
}

async function main() {
  const { ReportValueStore } = await import("../../report/reportValueStore.js");
  const { applyParsedFile } = await import("./iso19438Mapper.js");

  const df = load("SpinOnMP.DAT");
  const analysis = Iso19438Analysis.run(df, { sensor: "lb" });
  assert(analysis.ok, "SpinOnMP.DAT analyzes ok under ISO 19438 (errors: " + analysis.errors.join("; ") + ")");

  // ---- Initial Efficiency (E6, fixed minutes 3:01-6:00 window — a deliberate
  // ISO 19438-specific quirk, distinct from 4548-12's clock-bucket grid) ----
  assertEfficiencyMatchesCounts("initialEfficiency (E6 window)", analysis.initialUpstream, analysis.initialDownstream, analysis.initialEfficiency, analysis.sizes);

  // ---- Reporting buckets — same off-by-one risk class as 4548-12's own
  // documented past bug (both engines share the same _computeOneWindow shape) ----
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
      if (Math.abs(eff - expected) >= 1e-6) effMismatches.push(analysis.sizes[i] + "µm @ " + bucket.startTime + "-" + bucket.endTime + "s: got " + eff + ", expected " + expected);
    }
  }
  assert(checkedCount > 0, "buckets: at least one bucket/size had non-zero upstream counts to check");
  assert(effMismatches.length === 0,
    "every bucket/size's efficiency matches its own upstream/downstream (" + checkedCount +
    " checked)" + (effMismatches.length ? ":\n  " + effMismatches.join("\n  ") : ""));

  // ---- Gravimetric mass balance: Mi = (Qia[L/min] x Gia x terminationMinutes)/1000
  // — same formula shape as 4548-12's own past 1000x-unit-conversion bug site. ----
  if (analysis.qia !== null && analysis.gia !== null && analysis.terminationTime !== null) {
    const qiaLPerMin = analysis.qia / 1000;
    const terminationMinutes = analysis.terminationTime / 60;
    const expectedInjectedMass = (qiaLPerMin * analysis.gia * terminationMinutes) / 1000;
    assert(analysis.injectedMass !== null && Math.abs(analysis.injectedMass - expectedInjectedMass) < 1e-6,
      "injectedMass matches (Qia[L/min] x Gia x terminationMinutes)/1000 exactly (got " +
      analysis.injectedMass + ", expected " + expectedInjectedMass + ")");
  }

  // ---- Mapper gap: dpElementClean/dpFinalNet computed IN iso19438Mapper.js, not
  // in the analysis engine (same pattern as iso454812Mapper.js) ----
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
  const tinyLimitLb = Iso19438Analysis.run(df, { sensor: "lb", coincidenceLimits: { sensorUpstreamCoincidenceLimit: 1, sensorDownstreamCoincidenceLimit: 1 } });
  assert(tinyLimitLb.warnings.some((w) => /coincidence limit/i.test(w) && /min/.test(w)),
    "an absurdly low LB override DOES trip the coincidence-limit warning, with minute ranges (got: " + JSON.stringify(tinyLimitLb.warnings) + ")");
  const tinyLimitLs = Iso19438Analysis.run(df, { sensor: "ls", coincidenceLimits: { lsSensorUpstreamCoincidenceLimit: 1, lsSensorDownstreamCoincidenceLimit: 1 } });
  assert(tinyLimitLs.warnings.some((w) => /coincidence limit/i.test(w)),
    "the LS sensor's own override key trips its own warning too (got: " + JSON.stringify(tinyLimitLs.warnings) + ")");

  // ---- Snapshot ----
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
    initialEfficiency: analysis.initialEfficiency,
    initialUpstream: analysis.initialUpstream,
    initialDownstream: analysis.initialDownstream,
    overallEfficiency: analysis.overallEfficiency,
    initialFilterRating: analysis.initialFilterRating,
    overallFilterRating: analysis.overallFilterRating,
    qia: analysis.qia,
    gia: analysis.gia,
    ga: analysis.ga,
    qu: analysis.qu,
    qd: analysis.qd,
    injectedMass: analysis.injectedMass,
    dustAdded: analysis.dustAdded,
    totalCounts: analysis.totalCounts,
    countsToAverage: analysis.countsToAverage,
    mapperDpHousingClean: dpHousingClean,
    mapperDpElementClean: dpElementClean,
    mapperDpFinalNet: dpFinalNet
  };
  const result = compareSnapshot("iso19438", snapshot);
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

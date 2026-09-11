"use strict";
/* Minimal runnable check for iso3968Analysis.js's file-structure parsing (per
   CLAUDE.md: non-trivial logic leaves one runnable check behind). Runs the real
   sample files already in tools/render-check/Test DAT files/ through Iso3968Analysis
   and asserts the facts confirmed by hand in this file's own header comment — not a
   framework, just node this file directly: `node iso3968Analysis.selfcheck.js`.

   Requires DataFile — loaded the same dual (Node require / browser global) way every
   Analysis.js already expects it, so this only runs under Node where dataFile.js's
   module.exports path is taken. controlTargetCheck.js/iso3968ControlTargets.js are
   browser-only ES modules (no dual export, unlike dataFile.js/analysisMath.js) — those
   two checks use a dynamic import() instead of require(), so the whole file runs as
   an async main(). */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("../../core/dataFile.js");
const { Iso3968Analysis } = require("./iso3968Analysis.js");
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
  // ---- Discrete mode (Continuos=False): exactly 6 points, matching the 6 FlowRate targets ----
  {
    const df = load("P-Q_V2_B9939_02.dat");
    const a = Iso3968Analysis.run(df);
    assert(a.ok, "discrete file analyzes ok (errors: " + a.errors.join("; ") + ")");
    assert(a.continuous === false, "discrete file: continuous === false");
    assert(a.points.length === 6, "discrete file: exactly 6 points (got " + a.points.length + ")");
    assert(a.reversed === false, "discrete file: not reversed");
    const flows = a.points.map((p) => Math.round(p.flowRate));
    assert(JSON.stringify(flows) === JSON.stringify([18, 30, 50, 79, 104, 119]),
      "discrete file: point flow rates land near the 6 targets (got " + flows.join(",") + ")");

    // ---- Per-point Test Flow compliance (±5%, own bespoke check, not the shared engine) ----
    const flowChecks = Iso3968Analysis.checkFlowRateCompliance(a.points, a.flowRateTargets);
    assert(flowChecks.length === 6, "flow compliance: one result per point (got " + flowChecks.length + ")");
    assert(flowChecks.every((c) => c.ok), "flow compliance: every discrete point is within ±5% of its nearest target (deltas: " +
      flowChecks.map((c) => c.deltaPct.toFixed(1)).join(",") + ")");
  }

  // ---- Continuous mode, one direction (Continuos=True): smooth ramp, no reversal ----
  {
    const df = load("P-Q_V2_B9939_01.dat");
    const a = Iso3968Analysis.run(df);
    assert(a.ok, "continuous file analyzes ok (errors: " + a.errors.join("; ") + ")");
    assert(a.continuous === true, "continuous file: continuous === true");
    assert(a.points.length > 6, "continuous file: more than 6 points (got " + a.points.length + ")");
    assert(a.reversed === false, "continuous file: not reversed (one-directional sweep)");
  }

  // ---- Continuous + reverse: peak partway through, exactly 40 points (20 up + 20 down) ----
  {
    const df = load("P-Q_C_R_V3_B20-009_01.DAT");
    const a = Iso3968Analysis.run(df);
    assert(a.ok, "reverse file analyzes ok (errors: " + a.errors.join("; ") + ")");
    assert(a.continuous === true, "reverse file: continuous === true");
    assert(a.points.length === 40, "reverse file: exactly 40 points (got " + a.points.length + ")");
    assert(a.reversed === true, "reverse file: reversed detected");
  }

  // ---- Non-P-Q file correctly rejected, not silently misread ----
  {
    const df = load("Multipass.DAT");
    const a = Iso3968Analysis.run(df);
    assert(!a.ok, "a Multipass file is rejected by ISO 3968's engine");
  }

  // ---- Tare wiring: passing a second (valid P-Q) DataFile populates analysis.tare ----
  {
    const df = load("P-Q_V2_B9939_01.dat");
    const tareDf = load("P-Q_V2_B9939_02.dat");
    const a = Iso3968Analysis.run(df, tareDf);
    assert(a.tare !== null, "tare field populated when a second valid P-Q file is supplied");
    assert(a.tare.points.length === 6, "tare points extracted independently (got " + a.tare.points.length + ")");

    // ---- Curve fits + net (Filter Element) DP: difference of the two curve fits,
    // evaluated at THIS run's own measured flow rates (see the file-top curve-fit note) ----
    assert(a.assemblyFit !== null, "assembly curve fit computed");
    assert(a.tare.fit !== null, "tare curve fit computed");
    assert(a.points.every((p) => isFinite(p.assemblyFitDP)), "every point has a finite assemblyFitDP");
    assert(a.points.every((p) => isFinite(p.housingFitDP)), "every point has a finite housingFitDP (tare present)");
    assert(a.points.every((p) => Math.abs(p.elementDP - (p.assemblyFitDP - p.housingFitDP)) < 1e-9),
      "elementDP is exactly assemblyFitDP - housingFitDP for every point");

    // ---- Snapshot: catches drift in the derived fit/net values beyond what the
    // hand-written assertions above happen to check (see fidelitySnapshot.js and
    // the other 3 standards' *Analysis.selfcheck.js for the same convention) ----
    const snapshot = {
      continuous: a.continuous,
      reversed: a.reversed,
      flowRateTargets: a.flowRateTargets,
      assemblyFit: a.assemblyFit,
      tareFit: a.tare.fit,
      points: a.points
    };
    const result = compareSnapshot("iso3968", snapshot);
    if (result.wroteBaseline) {
      console.log("ok:   wrote initial baseline snapshot (" + result.file + ") — review it by hand before committing");
    } else {
      assert(result.ok, "matches committed snapshot, no unintended drift" + (result.ok ? "" : ":\n" + formatDiffs(result.diffs)));
    }
  }

  // ---- No tare supplied: assemblyFitDP still populated, housingFitDP/elementDP stay null (not 0/NaN) ----
  {
    const df = load("P-Q_V2_B9939_01.dat");
    const a = Iso3968Analysis.run(df);
    assert(a.assemblyFit !== null, "assembly curve fit still computed with no tare");
    assert(a.points.every((p) => isFinite(p.assemblyFitDP)), "assemblyFitDP populated with no tare");
    assert(a.points.every((p) => p.housingFitDP === null), "housingFitDP stays null with no tare (not 0/NaN)");
    assert(a.points.every((p) => p.elementDP === null), "elementDP stays null with no tare (not 0/NaN)");
  }

  // ---- Control targets (Temperature/Conductivity via the shared engine) ----
  // Uses PQ.DAT specifically: P-Q_V2_B9939_02.dat (Version 2.0, 1999) turns out to
  // predate the TestConductivity header field existing at all — confirmed while
  // writing this check, not a bug (the engine correctly reports "not applicable"
  // for that file; a newer-era file is needed to check the applicable/found path).
  {
    const { checkControlTargets } = await import("../../core/controlTargetCheck.js");
    const { ISO3968_CONTROL_TARGETS } = await import("./iso3968ControlTargets.js");
    const df = load("PQ.DAT");
    const results = checkControlTargets(df, ISO3968_CONTROL_TARGETS);
    assert(results.length === 2, "control-target table has exactly 2 rules (Temperature, Conductivity)");
    const temp = results.find((r) => r.parameter === "Test Temperature");
    assert(!!temp && temp.applicable, "Test Temperature rule resolves against a real file");
    const cond = results.find((r) => r.parameter === "Conductivity");
    assert(!!cond && cond.applicable, "Conductivity rule resolves against a real file");
    assert(cond && cond.target === 5500 && cond.tolerance === 4500,
      "Conductivity rule reproduces the [1000, 10000] pS/m range exactly (target=5500, tolerance=4500)");
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

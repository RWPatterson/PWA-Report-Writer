"use strict";
/* Fidelity check for iso23369Analysis.js (+ iso23369Mapper.js) — per CLAUDE.md:
   non-trivial logic leaves one runnable check behind. Two layers, same convention as
   every other standard's selfcheck:
     1. Hand-verified formula/invariant assertions — anchor CORRECTNESS, not just
        "didn't change." Includes a direct check on this engine's one genuinely new
        piece of algorithmic territory: the high/low-flow phase split (see
        iso23369Analysis.js's own file-top note, finding #2).
     2. A snapshot diff against a committed baseline (tools/render-check/
        fidelitySnapshot.js) — includes mapper-level extras too, not just the raw
        analysis object, same "a mapper can grow its own derived-value gap later"
        reasoning iso16889Analysis.selfcheck.js's own comment gives.

   Fixture choice: "50ch CyclicMP.DAT" is the primary fixture, not "Cyclic
   Multipass.DAT" — confirmed by direct testing that "Cyclic Multipass.DAT" only
   covers ~21 minutes of real data (both files), correctly failing the 25-minute
   floor; "50ch CyclicMP.DAT" spans a full ~70 minutes and terminates for real. That
   short fixture is still used below for one negative-control assertion (the
   too-short-test rejection path). A third real pair, "SpinOnCyclicMP.DAT", used to
   be unusable here (dataFile.js dropped its entire data block as malformed — fixed
   2026-08-20, see dataFile.selfcheck.js) — now used below specifically for the
   phase-split regression case, since it's the one real fixture where the whole/half
   Cycle-parity-to-phase mapping runs BACKWARDS from the other two (see
   splitFlowPhasesByCycle's own header comment). NOT used for a Table 2 flow-rate
   assertion — its header's Rate/FlowRatio don't cleanly reconstruct the real
   qMin/qMax the way the other two fixtures' do (Rate=105 there matches the real
   HIGH-flow average, not the low one, unlike "Cyclic Multipass.DAT"/"50ch
   CyclicMP.DAT" where Rate consistently matches the low average) — an unconfirmed,
   separate discrepancy, flagged 2026-08-20 but deliberately NOT touched (inverting
   the qMin/qMax formula to fit this one file would break the two already-confirmed
   fixtures instead).

   Requires DataFile/CyclicCompanionFile/Iso23369Analysis the same dual (Node
   require / browser global) way every Analysis.js already expects.
   ReportValueStore/iso23369Mapper.js are browser-only ES modules (no dual export),
   so those two use a dynamic import() instead, same mixed pattern
   iso16889Analysis.selfcheck.js already established.

   Run directly: `node iso23369Analysis.selfcheck.js`. */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("../../core/dataFile.js");
const { CyclicCompanionFile } = require("../../core/cyclicCompanionFile.js");
const { Iso23369Analysis } = require("./iso23369Analysis.js");
const { compareSnapshot, formatDiffs } = require("../../../tools/render-check/fidelitySnapshot.js");

const DIR = path.join(__dirname, "..", "..", "..", "tools", "render-check", "Test DAT files");
let failures = 0;

function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

function loadPair(primaryName, companionName) {
  const df = new DataFile(fs.readFileSync(path.join(DIR, primaryName), "utf8"));
  const companion = new CyclicCompanionFile(fs.readFileSync(path.join(DIR, companionName), "utf8"));
  companion.alignToPrimary(df);
  return { df, companion };
}

async function main() {
  const { ReportValueStore } = await import("../../report/reportValueStore.js");
  const { applyParsedFile } = await import("./iso23369Mapper.js");

  // ============================================================================
  // Primary fixture: "50ch CyclicMP.DAT" — a real, complete (~70 min) cyclic test
  // ============================================================================
  const { df, companion } = loadPair("50ch CyclicMP.DAT", "50ch CyclicMP-Cyclic.DAT");
  const analysis = Iso23369Analysis.run(df, { sensor: "lb", companionFile: companion });
  assert(analysis.ok, "50ch CyclicMP.DAT analyzes ok under ISO 23369 (errors: " + analysis.errors.join("; ") + ")");
  assert(analysis.companionFileMissing === false, "companion file was supplied and used (companionFileMissing is false)");

  // ---- 10.2.1: q_bar = (q_max+q_min)/2, q_max = q_min x FlowRatio ----
  assert(analysis.qMin === 25, "qMin matches the real header's Test System Configuration/Rate (got " + analysis.qMin + ")");
  assert(analysis.flowRatio === 4, "flowRatio matches the real header's Cyclic Configuration/FlowRatio (got " + analysis.flowRatio + ")");
  assert(analysis.qMax === analysis.qMin * analysis.flowRatio, "qMax === qMin x flowRatio, re-derived independently (got " + analysis.qMax + ")");
  assert(Math.abs(analysis.qAvg - (analysis.qMax + analysis.qMin) / 2) < 1e-9, "qAvg === (qMax+qMin)/2, re-derived independently (got " + analysis.qAvg + ")");

  // ---- Structural invariants (12.1-12.5: always exactly 10 reporting-time buckets) ----
  assert(analysis.clumps.length === 10, "exactly 10 reporting-time buckets (got " + analysis.clumps.length + ")");
  assert(analysis.clumps.every((c) => c.avgRatio.length === analysis.sizes.length),
    "every bucket's avgRatio array is one entry per measured size");
  assert(analysis.overallAverageRatio.length === analysis.sizes.length,
    "overallAverageRatio is one entry per measured size");

  // ---- Formula-consistency spot check: overall ratio must equal
  // overallUpstreamAverage / overallDownstreamAverage, clamped at MAX_RATIO_VALUE ----
  let checkedRatios = 0, hadNonZero = false;
  for (let i = 0; i < analysis.sizes.length; i++) {
    const up = analysis.overallUpstreamAverage[i], down = analysis.overallDownstreamAverage[i];
    if (up === null || down === null) continue;
    checkedRatios++;
    if (down > 0) hadNonZero = true;
    const expected = down > 0 ? Math.min(up / down, 100000) : 100000;
    if (Math.abs(analysis.overallAverageRatio[i] - expected) > 1e-6) {
      assert(false, "size index " + i + ": overallAverageRatio (" + analysis.overallAverageRatio[i] + ") !== up/down clamped (" + expected + ")");
    }
  }
  assert(hadNonZero, "at least one size had a non-zero downstream average to check ratio against");
  assert(checkedRatios === analysis.sizes.length, "every size's overallAverageRatio matches upstream/downstream clamped at 100000 (" + checkedRatios + " checked)");

  // ---- Termination ----
  assert(typeof analysis.terminationTime === "number" && analysis.terminationTime > 0,
    "terminationTime is a positive number of seconds (got " + analysis.terminationTime + ")");
  assert(analysis.terminationTime / 60 > 25, "termination time exceeds the 25-minute floor (got " + (analysis.terminationTime / 60).toFixed(2) + " min)");

  // ---- Finding #3: element vs. assembly direction — dpElementFinal is the RAW header
  // value, terminationDP (assembly target) is derived by ADDING housing, not subtracting ----
  const rawTerminalDPHeader = parseFloat(df.getHeaderValue("General Test Information", "TerminalDP"));
  assert(analysis.dpElementFinal === rawTerminalDPHeader,
    "dpElementFinal is the raw TerminalDP header value directly, not derived (got " + analysis.dpElementFinal + ", header=" + rawTerminalDPHeader + ")");
  assert(Math.abs(analysis.terminationDP - (analysis.dpElementFinal + analysis.dpHousingClean)) < 1e-9,
    "terminationDP (assembly target) === dpElementFinal + dpHousingClean (got " + analysis.terminationDP + ")");

  // ---- Finding #2: phase split — re-derive independently from the raw companion
  // channel, via the file's own Cycle numbering (NOT a qAvg threshold, per the
  // 2026-08-20 fix below), and confirm it lines up with what the engine used ----
  const rateChannel = companion.getChannel("TS_Rate");
  const cycleChannel = companion.getChannel("Cycle");
  const wholeCycleIdx = [], halfCycleIdx = [];
  for (let i = 0; i < cycleChannel.length; i++) {
    if (cycleChannel[i] === null || rateChannel[i] === null) continue;
    (Math.abs(cycleChannel[i] % 1) < 0.25 ? wholeCycleIdx : halfCycleIdx).push(i);
  }
  const avgOf = (idx) => idx.reduce((s, i) => s + rateChannel[i], 0) / idx.length;
  const expectedHighCount = avgOf(wholeCycleIdx) >= avgOf(halfCycleIdx) ? wholeCycleIdx.length : halfCycleIdx.length;
  assert(expectedHighCount > 100, "phase split: a large majority-share of companion rows classify as high-flow (got " + expectedHighCount + " of " + rateChannel.length + ")");
  assert(expectedHighCount < rateChannel.length, "phase split: NOT every companion row classifies as high-flow — the low-flow phase is real and excluded (got " + expectedHighCount + " of " + rateChannel.length + ")");
  // The bucket-1 assemblyDP must land inside the real high-flow DP band, not the
  // low-flow one — a concrete regression guard against the phase split silently
  // reverting to the raw alternating series (which would produce a value near the
  // LOW-flow trough for an early bucket, ~10 kPa here, not the high-flow band).
  assert(analysis.clumps[0].assemblyDP > 50,
    "bucket 1's assemblyDP is drawn from the high-flow-phase band, not the low-flow trough (got " + analysis.clumps[0].assemblyDP + ")");

  // ---- Figure C.1's two-series data (2026-08-20, per the user): companionHighDPSeries/
  // companionLowDPSeries must both resolve for a real companion file, cover every
  // high/low row (matching expectedHighCount above), and the high series' own values
  // must genuinely read higher than the low series' — a concrete guard against the
  // two series accidentally swapping labels ----
  assert(analysis.companionHighDPSeries !== null && analysis.companionLowDPSeries !== null,
    "companionHighDPSeries/companionLowDPSeries both resolve for a real companion file");
  assert(analysis.companionHighDPSeries.times.length === expectedHighCount,
    "companionHighDPSeries covers exactly the high-flow-phase rows (got " + analysis.companionHighDPSeries.times.length + ", expected " + expectedHighCount + ")");
  assert(analysis.companionLowDPSeries.times.length === rateChannel.length - expectedHighCount,
    "companionLowDPSeries covers exactly the remaining (low-flow-phase) rows (got " + analysis.companionLowDPSeries.times.length + ")");
  const avgHighDP = analysis.companionHighDPSeries.values.reduce((s, v) => s + v, 0) / analysis.companionHighDPSeries.values.length;
  const avgLowDP = analysis.companionLowDPSeries.values.reduce((s, v) => s + v, 0) / analysis.companionLowDPSeries.values.length;
  assert(avgHighDP > avgLowDP,
    "companionHighDPSeries reads higher than companionLowDPSeries on average (got high=" + avgHighDP.toFixed(1) + " low=" + avgLowDP.toFixed(1) + ") — not swapped");

  // ---- Finding #5: generalized bucket granularity — this fixture's own count cycle
  // (CountTime+HoldTime) must be what bucket boundaries actually round to ----
  const countCycleMin = (df.countTimeSec + df.holdTimeSec) / 60;
  const cycleAligned = analysis.clumps.every((c) => Math.abs(c.stopMin / countCycleMin - Math.round(c.stopMin / countCycleMin)) < 1e-6);
  assert(cycleAligned, "every bucket's stopMin lands on a whole count-cycle (" + (countCycleMin * 60) + "s) boundary");

  // ---- Mass lens ----
  assert(typeof analysis.qia === "number", "average injection flow rate (qia) computed from the live INJ_Rate channel (got " + analysis.qia + ")");
  assert(analysis.qu !== null && analysis.qd !== null, "both upstream (qu) and downstream (qd) sample flow resolved from the header (got qu=" + analysis.qu + " qd=" + analysis.qd + ")");
  assert(typeof analysis.injVolumeFinal === "number" && analysis.injVolumeFinal < analysis.injVolumeInitial,
    "injVolumeFinal (11.15) is computed and less than injVolumeInitial (reservoir drains) — got initial=" + analysis.injVolumeInitial + " final=" + analysis.injVolumeFinal);

  // ---- 13.3 mass-balance formula shape: term 3 uses qu (not qd, unlike ISO 16889) ----
  {
    const baseInputs = { injectionGravAverage: 9500, testFinalGrav: 50, injVolumeFinal: analysis.injVolumeFinal,
      qia: analysis.qia, qu: analysis.qu, qd: analysis.qd, terminationMinutes: analysis.terminationTime / 60, qAvg: analysis.qAvg };
    const withRealQu = Iso23369Analysis.computeMassBalance(baseInputs);
    const withSwappedQu = Iso23369Analysis.computeMassBalance(Object.assign({}, baseInputs, { qu: baseInputs.qu + 50 }));
    assert(withRealQu.dustRetained !== withSwappedQu.dustRetained,
      "changing qu alone changes dustRetained (13.3) — confirms term 3 actually uses qu, not a dead parameter");
    const withSwappedQd = Iso23369Analysis.computeMassBalance(Object.assign({}, baseInputs, { qd: baseInputs.qd + 50 }));
    assert(withRealQu.dustRetained !== withSwappedQd.dustRetained,
      "changing qd alone ALSO changes dustRetained — confirms term 2 still uses qd");
  }

  // ---- 13.6/13.7: formula 18 reverse interpolation numerically agrees with a
  // hand-computed log-linear interpolation on a synthetic bracket ----
  {
    const sizes = ["4", "5"];
    const avgRatio = [5, 20];
    const detail = Iso23369Analysis.sizeGivenRatioDetail(10, sizes, avgRatio);
    const expectedSize = 4 + (5 - 4) * (Math.log(10) - Math.log(5)) / (Math.log(20) - Math.log(5));
    assert(Math.abs(parseFloat(detail.result) - expectedSize) < 0.05,
      "sizeGivenRatioDetail(10, [4,5], [5,20]) matches hand-computed log-linear interpolation (got " + detail.result + ", expected " + expectedSize.toFixed(1) + ")");
    assert(detail.mode === "interpolated", "synthetic bracket case resolves as 'interpolated' (got " + detail.mode + ")");
    const belowRange = Iso23369Analysis.sizeGivenRatioDetail(1, sizes, avgRatio);
    assert(belowRange.mode === "below-range" && belowRange.result === "<4.0", "a target below every measured ratio reports below-range, not extrapolated (got " + JSON.stringify(belowRange) + ")");
    const aboveRange = Iso23369Analysis.sizeGivenRatioDetail(1000, sizes, avgRatio);
    assert(aboveRange.mode === "above-range" && aboveRange.result === ">5.0", "a target above every measured ratio reports above-range, not extrapolated (got " + JSON.stringify(aboveRange) + ")");
  }

  // ---- coincidence-limit check still fires against real data with an absurdly low override ----
  {
    const tripped = Iso23369Analysis.run(df, { sensor: "lb", companionFile: companion, coincidenceLimits: { sensorUpstreamCoincidenceLimit: 1 } });
    assert(tripped.warnings.some((w) => /coincidence limit/.test(w)), "an absurdly low LB override DOES trip the coincidence-limit warning");
  }

  // ============================================================================
  // Mapper — applyParsedFile into a throwaway store, spot-check a few slots +
  // extras rather than every one (the snapshot below covers the rest)
  // ============================================================================
  const store = new ReportValueStore();
  applyParsedFile(store, df, analysis);
  assert(store.get("reportTitle") === "ISO 23369:2022 — Multi-Pass Test Under Cyclic Flow Conditions Report",
    "mapper: normal-case report title set (got " + JSON.stringify(store.get("reportTitle")) + ")");
  assert(store.get("testFlowrateQ") === analysis.qAvg.toFixed(2), "mapper: testFlowrateQ is q_bar, not a raw header Rate (got " + store.get("testFlowrateQ") + ")");
  assert(store.get("qMinFlow") === analysis.qMin && store.get("qMaxFlow") === analysis.qMax,
    "mapper: qMinFlow/qMaxFlow match the analysis engine's own qMin/qMax");
  assert(store.get("dpClump100ElementDp") !== null, "mapper: the 100% bucket's element ΔP slot is populated");
  const clumps23369 = store.getExtra("clumps23369");
  assert(Array.isArray(clumps23369) && clumps23369.length === 10, "mapper: clumps23369 extra has 10 entries");
  assert(clumps23369.every((c) => c.avgRatio.length === store.getExtra("resolvedDisplaySizes").length),
    "mapper: every clumps23369 entry's avgRatio matches the resolved display-size count");
  const ratioChart = store.getExtra("ratioChart");
  assert(ratioChart && ratioChart.sizes.length === ratioChart.overallRatio.length && ratioChart.sizes.length > 0,
    "mapper: ratioChart extra has matching sizes/overallRatio arrays with real data");
  const ratioVsTimeChart = store.getExtra("ratioVsTimeChart");
  assert(ratioVsTimeChart && ratioVsTimeChart.series.length > 0 && ratioVsTimeChart.series[0].points.length > 0,
    "mapper: ratioVsTimeChart extra has at least one series with real points");

  // ============================================================================
  // Table 2 "Test flow rate ±5%" — real-incident regression guard (2026-08-20): a
  // flat whole-test-average check against a single target ALWAYS fails on a cycling
  // signal, independent of whether the rig is actually tracking correctly. Two
  // checks: the real fixture must NOT false-positive, and a synthetic mismatch must
  // still be caught (so this isn't just "the check never runs").
  // ============================================================================
  assert(!analysis.warnings.some((w) => /Table 2/.test(w)),
    "no false-positive Table 2 flow-rate warning on a real, correctly-tracking rig (both phases within 0.1% of target here)");
  {
    // Synthetic companion: low-flow-phase samples correct (~25, matches this
    // fixture's real qMin), high-flow-phase samples badly wrong (~70 vs the real
    // qMax of 100) — proves the check catches a REAL mismatch, and specifically the
    // HIGH-phase branch (the low-phase-only case is already exercised implicitly by
    // every real-fixture assertion above never tripping it). Cycle column included
    // and alternates whole/.5 per row, matching the real format's own convention —
    // classification is by Cycle parity now (2026-08-20 fix), not a rate threshold,
    // so a synthetic file with no Cycle column would silently skip the check
    // entirely instead of exercising it (splitFlowPhasesByCycle bails out with no
    // cycleChannel). 70 still labels correctly as the HIGH group here even though
    // it's well short of the real 100 target — the classification (relative: 70 >
    // 25) and the target comparison (absolute: 70 vs 100) are deliberately
    // independent checks; this test wants the FIRST to succeed and the SECOND to fail.
    const rows = [];
    for (let i = 0; i < 20; i++) {
      const min = 10 + Math.floor(i / 2);
      const sec = (i % 2) * 30;
      const value = i % 2 === 0 ? 25 : 70;   // low phase correct, high phase undershoots badly
      const cycle = 1.5 + i * 0.5;           // same increment-by-0.5 convention as every real fixture
      rows.push('"00:' + String(min).padStart(2, "0") + ':' + String(sec).padStart(2, "0") + '",' + value + "," + cycle);
    }
    const fakeText = ';Data Format:,TS_Rate,Cycle\n' + rows.join("\n");
    const fakeCompanion = new CyclicCompanionFile(fakeText);
    fakeCompanion.alignToPrimary(df);
    const fakeAnalysis = Iso23369Analysis.run(df, { sensor: "lb", companionFile: fakeCompanion });
    const flowWarning = fakeAnalysis.warnings.find((w) => /Table 2/.test(w));
    assert(!!flowWarning, "a synthetic high-flow-phase mismatch (70 vs target 100) DOES trip a Table 2 warning (got: " + JSON.stringify(fakeAnalysis.warnings) + ")");
    assert(flowWarning && /^High-flow-phase/.test(flowWarning), "the warning correctly names the HIGH phase as the one that failed (got: " + flowWarning + ")");
    assert(flowWarning && !/Low-flow-phase/.test(flowWarning), "the low phase (correctly tracking) does NOT also warn");
  }

  // ============================================================================
  // "SpinOnCyclicMP.DAT" — real regression guard, 2026-08-20 (live user report):
  // this is the one real fixture where whole-vs-.5 Cycle parity maps to high/low
  // flow BACKWARDS from the other two (whole-number Cycle rows average ~26 L/min —
  // the LOW phase — and .5 rows average ~105 — the HIGH phase). Under the OLD
  // rate-vs-qAvg-threshold classification this fixture triggered "didn't have
  // enough high-flow-phase samples" (qAvg computed from this file's own header
  // doesn't land where the real data actually splits — see the file-top note on
  // why that's a SEPARATE, still-unconfirmed header discrepancy, not touched by
  // today's fix). The Cycle-parity split needs no qAvg at all, so it must resolve
  // fully here regardless.
  // ============================================================================
  {
    const spinOn = loadPair("SpinOnCyclicMP.DAT", "SpinOnCyclicMP-Cyclic.DAT");
    const spinOnAnalysis = Iso23369Analysis.run(spinOn.df, { sensor: "lb", companionFile: spinOn.companion });
    assert(spinOn.df.dataExist, "SpinOnCyclicMP.DAT: dataExist is true (dataFile.js width-check fix, 2026-08-20)");
    assert(spinOnAnalysis.ok, "SpinOnCyclicMP.DAT analyzes ok under ISO 23369 (errors: " + spinOnAnalysis.errors.join("; ") + ")");
    assert(!spinOnAnalysis.warnings.some((w) => /enough high-flow-phase samples/.test(w)),
      "SpinOnCyclicMP.DAT: no longer warns about insufficient high-flow-phase samples — this is the exact live bug report the Cycle-parity fix resolves (got: " + spinOnAnalysis.warnings.join(" | ") + ")");
    // clumps[0].assemblyDP must land in the real high-flow DP band (this fixture's
    // own companion TS_DPress high-phase samples run roughly 60-350 kPa across the
    // test) — a concrete guard against the reversed-parity fixture silently
    // mislabeling its LOW phase as high (which would read near its own low-flow
    // trough instead).
    assert(spinOnAnalysis.clumps[0].assemblyDP > 30,
      "SpinOnCyclicMP.DAT: bucket 1's assemblyDP is drawn from the real high-flow-phase band, not the low-flow trough (got " + spinOnAnalysis.clumps[0].assemblyDP + ")");
  }

  // ============================================================================
  // Negative control: "Cyclic Multipass.DAT" — real, but only ~21 minutes of data in
  // BOTH files (confirmed by direct testing) — must be correctly REJECTED by the
  // 25-minute floor, not silently accepted on a truncated dataset
  // ============================================================================
  {
    const short = loadPair("Cyclic Multipass.DAT", "Cyclic Multipass-Cyclic.DAT");
    const shortResult = Iso23369Analysis.run(short.df, { sensor: "lb", companionFile: short.companion });
    assert(!shortResult.ok, "a real but too-short (~21 min) cyclic fixture is correctly rejected, not silently accepted");
    assert(shortResult.errors.some((e) => /25-minute minimum/.test(e)), "rejection reason cites the 25-minute minimum (got: " + shortResult.errors.join("; ") + ")");
    // Real change, 2026-08-21 (per the user): a file this short is now rejected by
    // the cheap, companion-independent _checkMinimumFileSpan check BEFORE the full
    // termination search (or any companion-related warning) ever runs — so
    // terminationTime correctly stays at its unset default, not a computed
    // fallback value, and NO companion-related warning appears on a file that's
    // being rejected regardless of companion presence.
    assert(shortResult.terminationTime === null, "termination search never runs — rejected by the early file-span check first (got " + shortResult.terminationTime + ")");
    assert(!shortResult.warnings.some((w) => /cyclic companion file/i.test(w)),
      "no companion-related warning appears on a file that's rejected regardless of companion presence (got: " + shortResult.warnings.join(" | ") + ")");
  }

  // ============================================================================
  // Companion-file-missing fallback path — must still produce a usable (if coarser)
  // result, not fail outright
  // ============================================================================
  {
    const fallback = Iso23369Analysis.run(df, { sensor: "lb" });   // no companionFile option
    assert(fallback.companionFileMissing === true, "companionFileMissing is true when no companion file is supplied");
    assert(fallback.warnings.some((w) => /No cyclic companion file/.test(w)), "warns clearly about the missing companion file");
    assert(fallback.ok, "the report still analyzes ok using the primary file's coarser samples as a fallback (errors: " + fallback.errors.join("; ") + ")");
    assert(fallback.companionHighDPSeries === null && fallback.companionLowDPSeries === null,
      "companionHighDPSeries/companionLowDPSeries both stay null with no companion file (Figure C.1 falls back to its own single-series primary-channel path)");
  }

  // ============================================================================
  // Snapshot — catches drift in ANY derived field, including ones nobody thought
  // to assert on individually. Includes mapper-level extras too, not just the raw
  // analysis object.
  // ============================================================================
  const snapshot = {
    testType: analysis.testType, nonStandardTestType: analysis.nonStandardTestType,
    qMin: analysis.qMin, qMax: analysis.qMax, qAvg: analysis.qAvg,
    terminationTag: analysis.terminationTag, terminationDP: analysis.terminationDP,
    terminationTime: analysis.terminationTime, dpElementFinal: analysis.dpElementFinal,
    dpHousingClean: analysis.dpHousingClean, dpAssemblyClean: analysis.dpAssemblyClean, dpElementClean: analysis.dpElementClean,
    sizes: analysis.sizes, clumps: analysis.clumps,
    overallUpstreamAverage: analysis.overallUpstreamAverage, overallDownstreamAverage: analysis.overallDownstreamAverage,
    overallAverageRatio: analysis.overallAverageRatio, sizeAtRatio: analysis.sizeAtRatio,
    qia: analysis.qia, qu: analysis.qu, qd: analysis.qd,
    injVolumeInitial: analysis.injVolumeInitial, injVolumeFinal: analysis.injVolumeFinal, buglTarget: analysis.buglTarget,
    warnings: analysis.warnings,
    mapperClumps23369: clumps23369, mapperRatioChart: ratioChart,
    mapperResolvedDisplaySizes: store.getExtra("resolvedDisplaySizes")
  };
  const result = compareSnapshot("iso23369", snapshot);
  if (result.wroteBaseline) {
    console.log("ok:   wrote initial baseline snapshot (" + result.file + ") — review it by hand before committing");
  } else {
    assert(result.ok, "matches committed snapshot, no unintended drift" + (result.ok ? "" : "\n" + formatDiffs(result.diffs)));
  }

  console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) FAILED.");
  if (failures > 0) process.exit(1);
}

main();

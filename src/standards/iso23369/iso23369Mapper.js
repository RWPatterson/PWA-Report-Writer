/* =====================================================================================
   iso23369Mapper.js
   =====================================================================================
   The middle layer for ISO 23369:2022: takes a parsed DataFile plus an
   Iso23369Analysis result and writes From Data values into a ReportValueStore.
   Nothing here computes anything new beyond simple header-value derivations — every
   number here already exists in df or analysis; this file's only job is naming.
   Own copy of iso16889Mapper.js's shape, per CLAUDE.md — report content, never
   shared, even where the pattern matches (title/non-standard-note handling, the
   sensor-flow/dilution-ratio naming-scheme fallbacks, resolveFixedSizes).

   gravimetricSpecs reuses the SAME single-field pattern ISO 16889 uses for its own
   80%/final gravimetric sample (finalGravimetricGf) — per the user's own decision:
   this standard's own text notes "final test grav and 80% are the same thing, the
   80% is a concession made to capture the sample while the test is still running,"
   so it's the identical concept/field, just captured earlier and relabeled.

   See the "NOT AVAILABLE" list at the bottom for report fields this mapper
   deliberately leaves unset.
   ===================================================================================== */

const DISPLAY_SIZES = [4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 20, 25, 30, 40, 50];

/** @param {import("../../report/reportValueStore.js").ReportValueStore} store
 *  @param {DataFile} df @param {*} analysis
 *  @param {{persistedDisplaySizes?: number[]}} [options] */
export function applyParsedFile(store, df, analysis, options = {}) {
  // Report title + retained-mass note — own copy of the same non-standard-test-type/
  // non-standard-setup pattern every clean standard's mapper carries (never shared,
  // per CLAUDE.md). This standard's own "Cyclic Series Multipass" is the one
  // non-standard TestType; TestSetup's Suction/dual-filter values are the same
  // non-standard-setup axis every multipass standard shares.
  const nonStandardParts = [];
  if (analysis.nonStandardTestType) nonStandardParts.push(analysis.testType);
  if (analysis.nonStandardSetup) nonStandardParts.push(df.testSetup);
  store.setFromData("reportTitle", nonStandardParts.length
    ? "Non-Standard " + nonStandardParts.join(" ") + " Test Reported to ISO 23369:2022"
    : "ISO 23369:2022 — Multi-Pass Test Under Cyclic Flow Conditions Report");
  const retainedMassReasons = [];
  if (analysis.nonStandardTestType) retainedMassReasons.push(analysis.retainedMassSuppressedReason);
  if (analysis.dualFilterSetup) retainedMassReasons.push(analysis.dualFilterRetainedMassReason);
  if (retainedMassReasons.length) {
    store.setFromData("retainedMassNote", retainedMassReasons.join(" "));
  }
  if (analysis.companionFileMissing) {
    store.setFromData("companionFileNote",
      "No cyclic companion file (\"-Cyclic.DAT\") was supplied — the differential pressure values below use the primary file's coarser once-a-minute samples.");
  }

  // ---- Top line ----
  store.setFromData("testDate", df.fileDate);
  store.setFromData("operator", df.getHeaderValue("General Test Information", "Operator"));
  store.setFromData("testLab", df.getHeaderValue("General Test Information", "TestLocation"));

  // ---- Filter and element identification ----
  store.setFromData("elementId", df.getHeaderValue("General Test Information", "FilterID"));
  if (df.testSetup) store.setFromData("spinOn", df.testSetup === "Spin On" ? "Yes" : "No");

  // ---- Operating Conditions: Test Fluid ----
  store.setFromData("fluidType", df.getHeaderValue("General Test Information", "OilType"));
  store.setFromData("viscosity", df.getHeaderValue("General Test Information", "OilViscosity"));
  store.setFromData("conductivity", df.getHeaderValue("General Test Information", "TestConductivity"));
  store.setFromData("temperature", df.getHeaderValue("Test System Configuration", "Temperature"), "°C");

  // ---- Operating Conditions: Test Contaminant ----
  store.setFromData("contaminantType", df.getHeaderValue("General Test Information", "DustType"));
  store.setFromData("contaminantBatch", df.getHeaderValue("General Test Information", "BatchNo"));

  // ---- Operating Conditions: Test system ----
  // Ramp Time (t_R,F) — two real naming schemes seen across real fixtures: an older/
  // single-value "RiseTime" (2 of 3 real fixtures) vs. a newer rig's split
  // "RampUpTime"/"RampDownTime" (the one 2025-dated fixture) — same value in the one
  // example checked (0.1/0.1), so RampUpTime stands in when RiseTime is absent.
  const riseTime = df.getHeaderValue("Cyclic Configuration", "RiseTime");
  store.setFromData("rampTime", riseTime !== null ? riseTime : df.getHeaderValue("Cyclic Configuration", "RampUpTime"), "sec");
  const testVolume = df.getHeaderValue("Test System Configuration", "Volume");
  store.setFromData("testVolume", testVolume);
  if (testVolume !== null && testVolume !== undefined) store.setFromData("testVolumeFinal", testVolume);
  // testFlowrateQ (q_bar)/qMinFlow/qMaxFlow/baseUpstreamGravLevel are set below, from
  // the analysis engine — all four are COMPUTED (10.2.1/12.12), not direct header
  // reads, unlike ISO 16889's single steady testFlowrateQ.

  // ---- Operating Conditions: Counting system ----
  const plainSensorFlow = df.getHeaderValues("Dilution System Configuration", "SensorFlow");
  const lbSensorFlow = df.getHeaderValues("Dilution System Configuration", "LBSensorFlow");
  const lsSensorFlow = df.getHeaderValues("Dilution System Configuration", "LSSensorFlow");
  for (const [slot, index] of [["sensorFlowRateUpstream", 0], ["sensorFlowRateDownstream", 1]]) {
    if (plainSensorFlow && plainSensorFlow.length > index) {
      store.setFromData(slot, plainSensorFlow[index]);
    } else {
      const combined = formatPerSensorFlow(lbSensorFlow, lsSensorFlow, index);
      if (combined) store.setFromData(slot, combined);
    }
  }
  const dilutionRatio = df.getHeaderValues("Dilution System Configuration", "DilutionRatio");
  const primaryRatio = df.getHeaderValues("Dilution System Configuration", "PrimaryDilutionRatio");
  const extendedRatio = df.getHeaderValues("Dilution System Configuration", "ExtendedDilutionRatio");
  for (const [slot, index] of [["dilutionRatioUpstream", 0], ["dilutionRatioDownstream", 1]]) {
    if (dilutionRatio && dilutionRatio.length > index) {
      store.setFromData(slot, dilutionRatio[index] + ":1");
    } else {
      const ratio = formatDilutionRatio(primaryRatio, extendedRatio, index);
      if (ratio) store.setFromData(slot, ratio);
    }
  }

  store.setFromData("comments", df.getHeaderValue("General Test Information", "Comments"));

  // ---- From the analysis engine ----
  if (analysis && analysis.ok) {
    store.setFromData("terminationTime", formatElapsed(analysis.terminationTime));
    if (analysis.sensorLabel) store.setFromData("analyzedFilterLabel", analysis.sensorLabel);

    // 10.2.1 — average/min/max test flow, all three engine-computed (this standard
    // has no single steady flow setpoint the way ISO 16889 does).
    if (analysis.qAvg !== null) store.setFromData("testFlowrateQ", analysis.qAvg.toFixed(2), "L/min");
    if (analysis.qMin !== null) store.setFromData("qMinFlow", analysis.qMin, "L/min");
    if (analysis.qMax !== null) store.setFromData("qMaxFlow", analysis.qMax, "L/min");

    // 12.12 — design-target base upstream gravimetric level (c_bar_b), same
    // "derived from setpoints, not a direct header read" reasoning as ISO 16889's
    // own buglTarget, denominator swapped to q_bar per computeAverageBUGL's own note.
    if (analysis.buglTarget !== null) store.setFromData("baseUpstreamGravLevel", analysis.buglTarget.toFixed(1));

    // Differential pressure — all four already computed by the analysis engine.
    if (analysis.dpHousingClean !== null) store.setFromData("dpHousingClean", analysis.dpHousingClean, "kPa");
    if (analysis.dpAssemblyClean !== null) store.setFromData("dpAssemblyClean", analysis.dpAssemblyClean, "kPa");
    if (analysis.dpElementClean !== null) store.setFromData("dpElementClean", analysis.dpElementClean, "kPa");
    if (analysis.dpElementFinal !== null) store.setFromData("dpElementFinal", analysis.dpElementFinal, "kPa");

    // Filtration ratio table (13.7) — six size-at-ratio values.
    for (const [ratio, size] of Object.entries(analysis.sizeAtRatio)) {
      store.setFromData("sizeAtRatio" + ratio, size);
    }

    // Injection reservoir volume — Initial is a direct header read, Final is
    // COMPUTED (11.15, drains at q_bar_i over the test), both from the analysis
    // engine. Final needs rounding — a genuine floating-point computation, not a
    // clean header value.
    if (analysis.injVolumeInitial !== null) store.setFromData("injSystemVolumeInitial", analysis.injVolumeInitial);
    if (analysis.injVolumeFinal !== null) store.setFromData("injSystemVolumeFinal", analysis.injVolumeFinal.toFixed(2));

    // Injection gravimetric Initial/Final/Average (c_i, 12.9) — header fallback
    // shown for all three until a user overrides each independently via the
    // gravimetric dialog, same "no fallback distinguishes Initial from Final"
    // treatment every other standard's own equivalent field already gets.
    if (analysis.injectionGravSetpoint !== null) {
      store.setFromData("injectionGravInitial", analysis.injectionGravSetpoint.toFixed(1));
      store.setFromData("injectionGravFinal", analysis.injectionGravSetpoint.toFixed(1));
      store.setFromData("injectionGravAverage", analysis.injectionGravSetpoint.toFixed(1));
    }

    // Injection flow rate (q_bar_i) — live channel average, already computed at
    // run() time (11.7/12.11).
    if (analysis.qia !== null) store.setFromData("injectionFlowrateQia", analysis.qia.toFixed(2));

    // Page 1's "Differential pressure versus contaminant added" table AND Page 2's
    // particle-count table are built from the SAME 10 reporting-time buckets — same
    // "one computation feeds two pages" pattern ISO 16889 uses. Page 1's table has
    // a fixed row shape (always exactly 10 buckets), filled via plain per-bucket
    // data-slots below; Page 2's has a dynamic column count (one pair per selected
    // display size), kept in the store's extras channel instead.
    // Injected mass (13.2's per-bucket column) is NOT set here — same reason ISO
    // 16889 defers it: it needs injectionGravAverage, which this mapper only ever
    // has as a header-fallback value at best. app.js's own
    // recomputeIso23369GravimetricDerived fills the dpClump*InjectedMass slots
    // right after this mapper runs, using whichever average the store resolves to.
    for (const clump of analysis.clumps) {
      store.setFromData("dpClump" + clump.percent + "TestTime", formatElapsed(Math.round(clump.testTimeMin * 60)));
      if (clump.elementDP !== null) store.setFromData("dpClump" + clump.percent + "ElementDp", clump.elementDP, "kPa");
    }

    const fixedSizes = resolveFixedSizes(df, analysis, options.persistedDisplaySizes);
    const fixedSizeIndices = fixedSizes.map((size) => analysis.sizes.findIndex((s) => Number(s) === size));
    store.setExtra("resolvedDisplaySizes", fixedSizes);

    const clumpsData = analysis.clumps.map((clump) => ({
      percent: clump.percent,
      testTimeMin: clump.testTimeMin,
      elementDP: clump.elementDP,
      elementDPUnit: "kPa",
      sizeLabels: fixedSizes.map((size) => ">" + size + "µmC"),
      avgUp: fixedSizeIndices.map((idx) => (idx < 0 ? null : clump.avgUp[idx])),
      avgDown: fixedSizeIndices.map((idx) => (idx < 0 ? null : clump.avgDown[idx])),
      avgRatio: fixedSizeIndices.map((idx) => (idx < 0 ? null : clump.avgRatio[idx]))
    }));
    store.setExtra("clumps23369", clumpsData);

    // Overall averages (12.7-12.8) — Page 2's "Avg." rows, same slot-by-slot
    // alignment to fixedSizes/fixedSizeIndices as clumps23369 above.
    store.setExtra("overallCounts23369", {
      avgUp: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.overallUpstreamAverage[idx])),
      avgDown: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.overallDownstreamAverage[idx])),
      avgRatio: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.overallAverageRatio[idx]))
    });
    // No "Initial system cleanliness" row — unlike ISO 16889, this engine doesn't
    // compute one in this pass (not asked for by this standard's own Page 1 field
    // list, and no real cyclic fixture has been checked for a matching aux block).
    // Page 2's template still reserves the row structurally (a true mirror of ISO
    // 16889's own page 2 layout, per this standard's outline) — it just renders
    // blank, same as any other not-yet-available cell on that page.

    // Figure C.2 data (overall ratio vs. size) — same fixed-size selection as the
    // buckets above, a plain {sizes, overallRatio} pair for the chart.
    const ratioChart = { sizes: [], overallRatio: [] };
    for (let i = 0; i < fixedSizes.length; i++) {
      const sizeIndex = fixedSizeIndices[i];
      if (sizeIndex < 0) continue;
      if (analysis.overallAverageRatio[sizeIndex] !== null) {
        ratioChart.sizes.push(fixedSizes[i]);
        ratioChart.overallRatio.push(analysis.overallAverageRatio[sizeIndex]);
      }
    }
    store.setExtra("ratioChart", ratioChart);

    // Figures C.3 (ratio vs. % test time) / C.4 (ratio vs. element ΔP) — one series
    // per selected size, 10 points each (one per bucket), built from the same
    // clumpsData already assembled above.
    const ratioVsTimeSeries = [];
    const ratioVsPressureSeries = [];
    for (let i = 0; i < fixedSizes.length; i++) {
      const label = ">" + fixedSizes[i] + " µm(c)";

      const timePoints = clumpsData
        .map((clump) => ({ x: clump.percent, y: clump.avgRatio[i] }))
        .filter((p) => p.y !== null && p.y > 0);
      if (timePoints.length > 0) ratioVsTimeSeries.push({ label, points: timePoints });

      const pressurePoints = clumpsData
        .map((clump) => ({ x: clump.elementDP, y: clump.avgRatio[i] }))
        .filter((p) => p.x !== null && p.x > 0 && p.y !== null && p.y > 0);
      if (pressurePoints.length > 0) ratioVsPressureSeries.push({ label, points: pressurePoints });
    }
    store.setExtra("ratioVsTimeChart", { series: ratioVsTimeSeries });
    store.setExtra("ratioVsPressureChart", { series: ratioVsPressureSeries });
  }
}

/** Turns a saved Machine Profile into THIS standard's own customDefaults map — own
 *  copy of iso16889Mapper.js's buildMachineProfileDefaults, per CLAUDE.md.
 *  @param {import("../../machineProfiles/machineProfilesStore.js").MachineProfileRecord} profile
 *  @returns {Record<string,string>} */
export function buildMachineProfileDefaults(profile) {
  const defaults = {};
  const upstreamRef = buildLocationRef(profile, "Upstream");
  const downstreamRef = buildLocationRef(profile, "Downstream");
  if (upstreamRef) defaults.counterUpstream = upstreamRef;
  if (downstreamRef) defaults.counterDownstream = downstreamRef;
  if (profile.counterCalMethod) defaults.counterCalMethod = profile.counterCalMethod;
  if (profile.counterCalDate) defaults.counterCalDate = profile.counterCalDate;
  if (profile.testLocation) defaults.testLab = profile.testLocation;
  return defaults;
}

/** @param {*} profile @param {"Upstream"|"Downstream"} location @returns {string} */
function buildLocationRef(profile, location) {
  const parts = [];
  const counterLocation = (profile.shareCounter || location === "Upstream") ? "Upstream" : location;
  addRefPart(parts, "Counter", profile["counter" + counterLocation + "Model"], profile["counter" + counterLocation + "Serial"]);
  addRefPart(parts, "Sensor", profile["sensor" + location + "Model"], profile["sensor" + location + "Serial"]);
  if (profile.hasLSSensor) addRefPart(parts, "LS Sensor", profile["lsSensor" + location + "Model"], profile["lsSensor" + location + "Serial"]);
  if (profile.hasLBESensor && location === "Downstream") addRefPart(parts, "LBE Sensor", profile.lbeSensorModel, profile.lbeSensorSerial);
  return parts.join(" / ");
}

/** @param {string[]} parts @param {string} label @param {string} [model] @param {string} [serial] */
function addRefPart(parts, label, model, serial) {
  if (!model && !serial) return;
  parts.push(label + ": " + [model, serial && "SN " + serial].filter(Boolean).join(" "));
}

/** Which up-to-16 sizes fill Page 1's filtration-ratio-adjacent tables and Page 2's
 *  particle-count table, slot by slot — own copy of iso16889Mapper.js's identical-
 *  purpose resolveFixedSizes, per CLAUDE.md.
 *  @param {DataFile} df @param {*} analysis @param {number[]|null|undefined} persistedDisplaySizes
 *  @returns {number[]} up to 16 sizes, ascending */
function resolveFixedSizes(df, analysis, persistedDisplaySizes) {
  const measuredSizes = (analysis.sizes || []).map(Number).filter((n) => isFinite(n));
  const measuredSet = new Set(measuredSizes);

  const headerDisplaySizes = df.getHeaderValues("Particle Counter Configuration", "DisplaySizes");
  const headerSizes = (headerDisplaySizes && headerDisplaySizes.length > 0)
    ? headerDisplaySizes.map(Number).filter((n) => isFinite(n))
    : DISPLAY_SIZES;

  const natural = headerSizes.filter((s) => measuredSet.has(s));
  for (const s of [...measuredSizes].sort((a, b) => a - b)) {
    if (natural.length >= 16) break;
    if (!natural.includes(s)) natural.push(s);
  }
  natural.sort((a, b) => a - b);
  const fileSizes = natural.slice(0, 16);

  const preferred = (persistedDisplaySizes || []).map(Number).filter((n) => isFinite(n));
  const chosen = new Set();
  for (let i = 0; i < 16; i++) {
    const candidate = preferred[i];
    if (candidate !== undefined && measuredSet.has(candidate)) {
      chosen.add(candidate);
    } else if (fileSizes[i] !== undefined) {
      chosen.add(fileSizes[i]);
    }
  }
  for (const s of fileSizes) {
    if (chosen.size >= 16) break;
    chosen.add(s);
  }

  return [...chosen].sort((a, b) => a - b).slice(0, 16);
}

/** @param {string[]|null} primary @param {string[]|null} extended @param {number} index
 *  @returns {string|null} */
function formatDilutionRatio(primary, extended, index) {
  const p = primary && primary.length > index ? primary[index] : null;
  const e = extended && extended.length > index ? extended[index] : null;
  if (p !== null && e !== null) return p + ":1 / " + e + ":1 (ext)";
  if (e !== null) return e + ":1 (ext)";
  if (p !== null) return p + ":1";
  return null;
}

/** @param {string[]|null} lb @param {string[]|null} ls @param {number} index 0=upstream, 1=downstream
 *  @returns {string|null} */
function formatPerSensorFlow(lb, ls, index) {
  const parts = [];
  if (lb && lb.length > index) parts.push(lb[index] + "(LB)");
  if (ls && ls.length > index) parts.push(ls[index] + "(LS)");
  return parts.length > 0 ? parts.join(" ") : null;
}

function formatElapsed(totalSeconds) {
  if (totalSeconds === null || !isFinite(totalSeconds)) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

/* =====================================================================================
   NOT AVAILABLE from a .DAT file — left unset on purpose, template renders them blank:

     housingId, minBubblePoint, fluidRef, fluidBatch, antiStaticYesNo,
     antiStaticType, counterUpstream, counterDownstream, counterCalMethod,
     counterCalDate, bubblePointISO2942, elementIntegrityTestFluid,
     isoMtdMassInjected, isoMtdRetainedCapacity, finalGravimetricGf

   Physical/equipment/lab-process data an operator enters by hand — no test stand
   logs a bubble point or a counter's calibration date. finalGravimetricGf (the 80%
   upstream sample, 12.10) has no header fallback per the standard — it's a lab
   result, hand-entered via gravimetricSpecs. Until it's entered,
   isoMtdMassInjected/isoMtdRetainedCapacity can't be computed either (see
   iso23369Analysis.js's computeMassBalance/checkGravimetricAcceptance and app.js's
   recomputeIso23369GravimetricDerived).

   injectionGravInitial/injectionGravFinal/injectionGravAverage are NOT in this
   list — they DO have a header fallback (the injection system's own
   GravimetricLevel setpoint), shown until a user overrides each independently via
   the gravimetric dialog. See the analysis-derived block above.
   ===================================================================================== */

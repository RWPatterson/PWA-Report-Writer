/* =====================================================================================
   iso16889Mapper.js
   =====================================================================================
   The middle layer for ISO 16889:2022: takes a parsed DataFile plus an Iso16889Analysis
   result and writes From Data values into a ReportValueStore. Nothing here computes
   anything new beyond simple header-value derivations — every number here already
   exists in df or analysis; this file's only job is naming. See the "NOT AVAILABLE"
   list at the bottom for report fields this mapper deliberately leaves unset.

   gravimetricSpecs (the hand-entry dialog, see app.js's STANDARDS registry) reuses
   the SAME field ids as ISO 4548-12/19438 — injectionGravInitial, injectionGravFinal,
   finalGravimetricGf — even though this standard's own text calls the last one
   "Test_Final_Grav" / "80% upstream gravimetric level, c80" (12.10). Same underlying
   concept (a hand-measured post-test gravimetric result with no header fallback), so
   reusing the id lets the existing gravimetricEntryView.js dialog and app.js's
   recompute wiring work unchanged — only the LABEL shown in the dialog differs.
   ===================================================================================== */

const DISPLAY_SIZES = [4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 20, 25, 30, 40, 50];

/** @param {import("../../report/reportValueStore.js").ReportValueStore} store
 *  @param {DataFile} df @param {*} analysis
 *  @param {{persistedDisplaySizes?: number[]}} [options] */
export function applyParsedFile(store, df, analysis, options = {}) {
  // Report title + retained-mass note: own copy of the same non-standard-test-type/
  // non-standard-setup handling iso19438Mapper.js/iso454812Mapper.js each carry (per
  // the user, 2026-07-31/2026-08-03) — never shared, even though the wording pattern
  // is identical, per CLAUDE.md's report-content rule. THREE independent non-standard
  // reasons can combine in one title (e.g. a Single-Pass test on a Suction setup):
  // testType and dualFilterSetup both affect retained-mass validity (see
  // retainedMassNote below); nonStandardSetup alone (plain Suction) does not, since
  // that's still exactly one filter, just mounted differently. `reportTitle`'s
  // data-slot in the template carries the same normal-case string as a static
  // fallback (shown before any file is loaded — see fillSlots' null-handling in
  // reportView.js) — this call ALWAYS still runs once a file IS analyzed, either
  // overwriting it with the identical normal string (no visible change) or the
  // Non-Standard variant. `retainedMassNote` is left unset (blank, collapsed by
  // :empty in app.css) for a normal Multipass/non-Suction/non-dual-filter test.
  const nonStandardParts = [];
  if (analysis.nonStandardTestType) nonStandardParts.push(analysis.testType);
  if (analysis.nonStandardSetup) nonStandardParts.push(df.testSetup);
  store.setFromData("reportTitle", nonStandardParts.length
    ? "Non-Standard " + nonStandardParts.join(" ") + " Test Reported to ISO 16889:2022"
    : "ISO 16889:2022 — Filter Element Multi-Pass Test Report");
  const retainedMassReasons = [];
  if (analysis.nonStandardTestType) retainedMassReasons.push(analysis.retainedMassSuppressedReason);
  if (analysis.dualFilterSetup) retainedMassReasons.push(analysis.dualFilterRetainedMassReason);
  if (retainedMassReasons.length) {
    store.setFromData("retainedMassNote", retainedMassReasons.join(" "));
  }

  // ---- Top line ----
  store.setFromData("testDate", df.fileDate);
  store.setFromData("operator", df.getHeaderValue("General Test Information", "Operator"));
  // "Test Laboratory" IS this standard's test-location field (corrected by the user,
  // 2026-08-12) — no separate testLocation field/row like iso454812/iso19438 have;
  // ISO 16889's own template just labels the same concept "Test Laboratory" instead.
  // Same header key those two mappers already read — reused here per CLAUDE.md's
  // .DAT-handling guidance, not re-derived from scratch. CORRECTION (2026-08-18):
  // this key does NOT actually appear in any real file checked so far (confirmed
  // absent across every project fixture) — per the user, this value gets filled via
  // Custom Default or a Machine Profile in practice, not from data. The from-data
  // read stays as a harmless no-op fallback in case a future file ever carries it.
  store.setFromData("testLab", df.getHeaderValue("General Test Information", "TestLocation"));

  // ---- Filter and element identification ----
  store.setFromData("elementId", df.getHeaderValue("General Test Information", "FilterID"));
  // Derived, not hand-entry: df.testSetup is already confirmed-real (it's how
  // termination itself resolves the DP channel) — "Spin On" is one of exactly three
  // recognized single-filter setup values, so this is an unambiguous yes/no.
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
  store.setFromData("testFlowrateQ", df.getHeaderValue("Test System Configuration", "Rate"), "L/min");
  const testVolume = df.getHeaderValue("Test System Configuration", "Volume");
  store.setFromData("testVolume", testVolume);
  // Final Volume has no header of its own (same reasoning as 4548-12/19438) —
  // defaults to the initial Volume, still data-editable.
  if (testVolume !== null && testVolume !== undefined) store.setFromData("testVolumeFinal", testVolume);
  // baseUpstreamGravLevel (cb) is set below, from analysis.buglTarget — CORRECTED
  // per the user: there is no independently-configured "BUGL setpoint" header
  // field (an earlier version read one anyway, an ASSUMED key that turned out to
  // silently return an unrelated/wrong value — see iso16889Analysis.js's own
  // comment on that fix). The design-target cb is DERIVED from setpoints, not a
  // direct header read, so it belongs with the other analysis-derived fields.

  // ---- Operating Conditions: Injection system ----
  // Initial/Final volume are both set below, from the analysis engine — Initial is
  // a direct header read there, but Final is COMPUTED (the reservoir drains at Qia
  // over the test; see iso16889Analysis.js's _computeInjectionFlowRate), not
  // available until analysis.qia is known, so both live in the analysis-derived
  // block rather than being split across two places.

  // ---- Operating Conditions: Counting system ----
  // getHeaderValues returns an [upstream, downstream] pair (see dataFile.js's own
  // comment) — both locations are populated now, same as counterUpstream/
  // counterDownstream's own two rows, instead of only ever surfacing upstream.
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

    // Base upstream gravimetric level (cb) — the DESIGN-TARGET value 12.12's own
    // formula produces when run against setpoints (see analysis.buglTarget's own
    // comment). Still data-editable — a lab that independently knows a different
    // target can override it.
    if (analysis.buglTarget !== null) store.setFromData("baseUpstreamGravLevel", analysis.buglTarget.toFixed(1));

    // Differential pressure — all four already computed by the analysis engine.
    if (analysis.dpHousingClean !== null) store.setFromData("dpHousingClean", analysis.dpHousingClean, "kPa");
    if (analysis.dpAssemblyClean !== null) store.setFromData("dpAssemblyClean", analysis.dpAssemblyClean, "kPa");
    if (analysis.dpElementClean !== null) store.setFromData("dpElementClean", analysis.dpElementClean, "kPa");
    if (analysis.dpElementFinal !== null) store.setFromData("dpElementFinal", analysis.dpElementFinal, "kPa");

    // Filtration ratio table (13.6) — six Size_At_Beta_x values.
    for (const [beta, size] of Object.entries(analysis.sizeAtBeta)) {
      store.setFromData("sizeAtBeta" + beta, size);
    }

    // Injection reservoir volume — Initial is a direct header read, Final is
    // COMPUTED (drains at Qia over the test), both from the analysis engine. Still
    // data-editable in the report: a real measured final volume overrides the
    // computed estimate. Final specifically needs rounding — it's a genuine
    // floating-point computation (Initial minus a channel-average-derived draw
    // volume), not a clean header value, so left unrounded it can show long
    // decimal tails.
    if (analysis.injVolumeInitial !== null) store.setFromData("injSystemVolumeInitial", analysis.injVolumeInitial);
    if (analysis.injVolumeFinal !== null) store.setFromData("injSystemVolumeFinal", analysis.injVolumeFinal.toFixed(2));

    // Injection gravimetric Initial/Final — header fallback shown for both until a
    // user overrides each independently via the gravimetric dialog (12.9's two
    // samples), same "no fallback distinguishes Initial from Final" treatment
    // 4548-12/19438 already give their own equivalent fields.
    if (analysis.injectionGravSetpoint !== null) {
      store.setFromData("injectionGravInitial", analysis.injectionGravSetpoint.toFixed(1));
      store.setFromData("injectionGravFinal", analysis.injectionGravSetpoint.toFixed(1));
      store.setFromData("injectionGravAverage", analysis.injectionGravSetpoint.toFixed(1));
    }

    // Injection flow rate — live channel average, already computed at run() time.
    if (analysis.qia !== null) store.setFromData("injectionFlowrateQia", analysis.qia.toFixed(2));

    // Both Page 1's "Differential pressure versus contaminant added" table AND
    // Page 2's particle-count table are built from the SAME 10 reporting-time
    // clumps — one computation feeding two report pages, not two independently
    // built tables. Page 1's table has a FIXED row/column shape (always exactly 10
    // clumps, by definition — see iso16889Analysis.js) so it's filled via plain
    // per-clump data-slots below, same as 4548-12's %-net-DP milestone table. Page
    // 2's table additionally has a DYNAMIC column count (one pair per SELECTED
    // display size), so it's kept in the store's extras channel instead and
    // stamped by reportView.js's own iso16889 page-filling logic, same "not a
    // per-size data-slot" precedent 4548-12's bucketsB2 already establishes.
    // Injected mass (13.4) is NOT set here — it needs injectionGravAverage, which
    // this mapper only ever has as a header-fallback value at best; app.js's
    // recomputeIso16889GravimetricDerived fills the same dpClump*InjectedMass slots
    // right after this mapper runs (every call site: initial load AND after a real
    // gravimetric entry), using whichever average the store currently resolves to.
    for (const clump of analysis.clumps) {
      store.setFromData("dpClump" + clump.percent + "TestTime", formatElapsed(Math.round(clump.testTimeMin * 60)));
      if (clump.elementDP !== null) store.setFromData("dpClump" + clump.percent + "ElementDp", clump.elementDP, "kPa");
    }

    const fixedSizes = resolveFixedSizes(df, analysis, options.persistedDisplaySizes);
    const fixedSizeIndices = fixedSizes.map((size) => analysis.sizes.findIndex((s) => Number(s) === size));
    store.setExtra("resolvedDisplaySizes", fixedSizes);

    // Local reference (not inlined straight into setExtra) — reused below to build
    // Figures C.4/C.5's per-size series without re-deriving the fixedSizeIndices
    // alignment a second/third time.
    const clumpsData = analysis.clumps.map((clump) => ({
      percent: clump.percent,
      testTimeMin: clump.testTimeMin,
      elementDP: clump.elementDP,
      elementDPUnit: "kPa",
      // No injectedMassG here — Page 2's particle-count table doesn't display it;
      // Page 1's own copy is the flat dpClump*InjectedMass slots above, kept live
      // by app.js's recomputeIso16889GravimetricDerived, not this array.
      sizeLabels: fixedSizes.map((size) => ">" + size + "µmC"),
      avgUp: fixedSizeIndices.map((idx) => (idx < 0 ? null : clump.avgUp[idx])),
      avgDown: fixedSizeIndices.map((idx) => (idx < 0 ? null : clump.avgDown[idx])),
      avgBeta: fixedSizeIndices.map((idx) => (idx < 0 ? null : clump.avgBeta[idx]))
    }));
    store.setExtra("clumps16889", clumpsData);

    // Overall averages (12.7-12.8) — Page 2's "Avg." rows, same slot-by-slot
    // alignment to fixedSizes/fixedSizeIndices as clumps16889 above (index i here
    // is index i there — both walk the exact same fixedSizes list), so
    // reportView.js's Page 2 filler can zip the two together without re-resolving
    // sizes itself.
    store.setExtra("overallCounts16889", {
      avgUp: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.overallUpstreamAverage[idx])),
      avgDown: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.overallDownstreamAverage[idx])),
      avgBeta: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.overallAverageBeta[idx]))
    });

    // Initial system cleanliness — Page 2's "Initial" row, same fixedSizes/
    // fixedSizeIndices alignment as clumps16889/overallCounts16889 above. Stays all-
    // null (renders blank) whenever analysis.initialUpstream has nothing for this
    // sensor — see iso16889Analysis.js's _computeInitialCleanliness for why.
    store.setExtra("initialUpstream16889", fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.initialUpstream[idx])));

    // Overall averages / Figure C.3 data — same fixed-size selection as the clumps
    // above, just as a plain {sizes, overallBeta} pair for the chart rather than
    // per-slot ids (a chart iterates the whole series; a table addresses one size
    // at a time).
    const betaChart = { sizes: [], overallBeta: [] };
    for (let i = 0; i < fixedSizes.length; i++) {
      const sizeIndex = fixedSizeIndices[i];
      if (sizeIndex < 0) continue;
      if (analysis.overallAverageBeta[sizeIndex] !== null) {
        betaChart.sizes.push(fixedSizes[i]);
        betaChart.overallBeta.push(analysis.overallAverageBeta[sizeIndex]);
      }
    }
    store.setExtra("betaChart", betaChart);

    // Figures C.4 (beta vs. % test time) / C.5 (beta vs. element ΔP) — one series
    // per selected size, 10 points each (one per clump), built from the SAME
    // clumpsData already assembled above rather than re-deriving the size-index
    // alignment again. elementDP stays canonical kPa here — the chart function
    // converts to display units at render time, same "convert at the edges"
    // convention every other DP-bearing field in this app follows.
    const betaVsTimeSeries = [];
    const betaVsPressureSeries = [];
    for (let i = 0; i < fixedSizes.length; i++) {
      const label = ">" + fixedSizes[i] + " µm(c)";

      const timePoints = clumpsData
        .map((clump) => ({ x: clump.percent, y: clump.avgBeta[i] }))
        .filter((p) => p.y !== null && p.y > 0);
      if (timePoints.length > 0) betaVsTimeSeries.push({ label, points: timePoints });

      const pressurePoints = clumpsData
        .map((clump) => ({ x: clump.elementDP, y: clump.avgBeta[i] }))
        .filter((p) => p.x !== null && p.x > 0 && p.y !== null && p.y > 0);
      if (pressurePoints.length > 0) betaVsPressureSeries.push({ label, points: pressurePoints });
    }
    store.setExtra("betaVsTimeChart", { series: betaVsTimeSeries });
    store.setExtra("betaVsPressureChart", { series: betaVsPressureSeries });
  }
}

/** Turns a saved Machine Profile (machineProfiles/machineProfilesStore.js's per-rig
 *  directory, not core/machineProfiles.js's hardcoded quirk table) into THIS
 *  standard's own customDefaults map — how a rig's separate counter/sensor/LS/LBE
 *  identity combines into the single "Counter and sensor ref." column, ONE combined
 *  string per location, is ISO 16889 report content, never shared with another
 *  standard even once one exists (per CLAUDE.md). The standard case (per the user,
 *  2026-08-12) is an independent counter AND sensor at each of Upstream/Downstream;
 *  `shareCounter` covers an older rig that only ever had one counter serving both.
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
  // "Test Laboratory" IS this standard's test-location field — see the mapper's own
  // "Top line" comment above (corrected by the user, 2026-08-12).
  if (profile.testLocation) defaults.testLab = profile.testLocation;
  return defaults;
}

/** One location's ("Upstream"/"Downstream") combined "Counter and sensor ref." text —
 *  Counter (mirrored from Upstream's own fields when profile.shareCounter is set),
 *  Sensor, and (when present) LS Sensor, each "Label: Model SN Serial".
 *  @param {*} profile @param {"Upstream"|"Downstream"} location @returns {string} */
function buildLocationRef(profile, location) {
  const parts = [];
  const counterLocation = (profile.shareCounter || location === "Upstream") ? "Upstream" : location;
  addRefPart(parts, "Counter", profile["counter" + counterLocation + "Model"], profile["counter" + counterLocation + "Serial"]);
  addRefPart(parts, "Sensor", profile["sensor" + location + "Model"], profile["sensor" + location + "Serial"]);
  if (profile.hasLSSensor) addRefPart(parts, "LS Sensor", profile["lsSensor" + location + "Model"], profile["lsSensor" + location + "Serial"]);
  // LBE is a SINGLE sensor, not an Upstream/Downstream pair (per the user, 2026-08-12)
  // — it reads the one shared midstream draw point in series/dual-filter testing,
  // which is simultaneously the pre-filter's OWN downstream sample and the final
  // filter's OWN upstream sample (see dataFile.js's MidstreamFlag note). Defaults to
  // the Downstream row, matching a report on the pre-filter (LB, this standard's
  // DEFAULT_SENSOR) — still data-editable, so reporting the final filter (LS) instead
  // just needs the usual double-click move to the Upstream row.
  if (profile.hasLBESensor && location === "Downstream") addRefPart(parts, "LBE Sensor", profile.lbeSensorModel, profile.lbeSensorSerial);
  return parts.join(" / ");
}

/** @param {string[]} parts @param {string} label @param {string} [model] @param {string} [serial] */
function addRefPart(parts, label, model, serial) {
  if (!model && !serial) return;
  parts.push(label + ": " + [model, serial && "SN " + serial].filter(Boolean).join(" "));
}

/** Which up-to-16 sizes fill Page 1's filtration-ratio-adjacent tables and Page 2's
 *  particle-count table, slot by slot — same precedence/backfill logic as
 *  iso454812Mapper.js's resolveFixedSizes (own copy, per CLAUDE.md): a persisted
 *  preference wins per slot when this file/sensor actually measured that size,
 *  otherwise the file's own natural list (header DisplaySizes, intersected with
 *  what this sensor measured, padded from the sensor's full list) fills the gap.
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
     counterCalDate, validationDate, bubblePointISO2942, elementIntegrityTestFluid,
     isoMtdMassInjected, isoMtdRetainedCapacity, finalGravimetricGf

   Physical/equipment/lab-process data an operator enters by hand — no test stand
   logs a bubble point or a counter's calibration date. finalGravimetricGf (the 80%
   upstream sample, 12.10) has no header fallback per the standard — it's a lab
   result, hand-entered via gravimetricSpecs (app.js's gravimetric dialog). Until
   it's entered, isoMtdMassInjected/isoMtdRetainedCapacity/Average_BUGL's acceptance
   check can't be computed either (see iso16889Analysis.js's computeMassBalance/
   checkGravimetricAcceptance and app.js's recomputeIso16889GravimetricDerived).

   injectionGravInitial/injectionGravFinal/injectionGravAverage are NOT in this
   list — they DO have a header fallback (the injection system's own
   GravimetricLevel setpoint, same as 4548-12/19438's own Gia fallback), shown until
   a user overrides each independently via the gravimetric dialog. See the
   analysis-derived block above.
   ===================================================================================== */

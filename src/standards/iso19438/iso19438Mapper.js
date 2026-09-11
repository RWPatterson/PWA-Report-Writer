/* =====================================================================================
   iso19438Mapper.js
   =====================================================================================
   Same job as iso454812Mapper.js: takes a parsed DataFile plus an Iso19438Analysis
   result and writes From Data values into a ReportValueStore. Nothing here computes
   anything new — every number here already exists in df or analysis; this file's only
   job is naming. Field ids follow the same naming convention as iso454812Mapper.js's
   (camelCase report-field ids) for codebase consistency, even though this is an
   independent standard with its own template.

   Every header/section-key string below reusing ISO 4548-12's own naming (e.g.
   "General Test Information"/"TestLocation") is doing so on solid footing, not a
   coincidence guess — the .DAT format is NOT standard-specific; ISO 16889,
   ISO 4548-12, and ISO 19438 are all multipass standards sharing one file format/
   control program (confirmed by the user — see CLAUDE.md's ".DAT file handling"
   section). Still worth a final check against a real ISO 19438 file once one exists,
   same as iso19438Analysis.js's own note explains.

   DISPLAY_SIZES: fallback particle sizes for the fixed 16-size set Page 1's
   Filtration Efficiencies table AND the per-window clump pages are built from, used
   only when a file's own header doesn't carry a "DisplaySizes" list. Per the user
   (the sizes in ISO 19438's own outline were confirmed to be placeholders, not a
   spec requirement): default to whatever a loaded file's header provides — this
   constant is only the template-filling fallback before any file is loaded / if a
   file's header lacks the list, same role as iso454812Mapper.js's own DISPLAY_SIZES.
   ===================================================================================== */

const DISPLAY_SIZES = [4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 20, 25, 30, 40, 50];
const RATING_TARGET_IDS = { "50": "50", "90": "90", "95": "95", "99": "99" };

/** @param {import("../../report/reportValueStore.js").ReportValueStore} store
 *  @param {DataFile} df @param {*} analysis
 *  @param {{persistedDisplaySizes?: number[]}} [options] */
export function applyParsedFile(store, df, analysis, options = {}) {
  // Report title + retained-mass note: own copy of the same non-standard-test-type/
  // non-standard-setup handling iso454812Mapper.js/iso16889Mapper.js each carry (per
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
    ? "Non-Standard " + nonStandardParts.join(" ") + " Test Reported to ISO 19438:2023"
    : "ISO 19438:2023 — Diesel Fuel Filters — Test Report");
  const retainedMassReasons = [];
  if (analysis.nonStandardTestType) retainedMassReasons.push(analysis.retainedMassSuppressedReason);
  if (analysis.dualFilterSetup) retainedMassReasons.push(analysis.dualFilterRetainedMassReason);
  if (retainedMassReasons.length) {
    store.setFromData("retainedMassNote", retainedMassReasons.join(" "));
  }

  // ---- Test Identification ---- CONFIRMED (2026-08-18) against real files: testTime/
  // operator/projectId's header keys, and testDate/testId's parser-derived fields, all
  // read real values. testLocation is the one exception — "TestLocation" never actually
  // appears in any real file seen so far; per the user, this location gets filled via
  // Custom Default or a Machine Profile instead (see machineProfiles/), not from data.
  // The from-data read stays here as a harmless no-op fallback in case a future file
  // ever does carry it directly.
  store.setFromData("testDate", df.fileDate);
  store.setFromData("testLocation", df.getHeaderValue("General Test Information", "TestLocation"));
  store.setFromData("testId", df.fileName);
  store.setFromData("testTime", df.getHeaderValue("General Test Information", "TestTime"));
  store.setFromData("operator", df.getHeaderValue("General Test Information", "Operator"));
  store.setFromData("projectId", df.getHeaderValue("General Test Information", "ProjectID"));

  // ---- Filter Identification ----
  store.setFromData("filterId", df.getHeaderValue("General Test Information", "FilterID"));
  store.setFromData("housingType", df.getHeaderValue("General Test Information", "HousingType"));
  // Only set on MidstreamFlag (dual-filter) files — same convention as iso454812Mapper.js.
  if (analysis && analysis.sensorLabel) store.setFromData("analyzedFilterLabel", analysis.sensorLabel);

  // ---- Operating Conditions: Test Fluid ----
  store.setFromData("fluidType", df.getHeaderValue("General Test Information", "OilType"));
  store.setFromData("viscosity", df.getHeaderValue("General Test Information", "OilViscosity"));
  store.setFromData("initialConductivity", df.getHeaderValue("General Test Information", "TestConductivity"));
  store.setFromData("temperature", df.getHeaderValue("Test System Configuration", "Temperature"), "°C");

  // ---- Operating Conditions: Test Dust ----
  store.setFromData("dustType", df.getHeaderValue("General Test Information", "DustType"));
  store.setFromData("dustBatch", df.getHeaderValue("General Test Information", "BatchNo"));
  store.setFromData("injectionFlowrateSetpoint", df.getHeaderValue("Injection System Configuration", "Rate"));
  store.setFromData("volumeVi", df.getHeaderValue("Injection System Configuration", "Volume"));

  // ---- Operating Conditions: Test System ----
  store.setFromData("testFlowrateQ", df.getHeaderValue("Test System Configuration", "Rate"), "L/min");
  const testVolume = df.getHeaderValue("Test System Configuration", "Volume");   // CONFIRMED by the user (2026-07-31), L
  store.setFromData("testVolume", testVolume);
  // Final test system volume (Vf) has no header of its own (see
  // iso19438Analysis.js's computeMassBalance note). Per the user: default it to the
  // initial Volume as a starting fallback (still data-editable — a real final-volume
  // reading overrides this) rather than leaving it blank — this also means
  // Non-Retained Mass now actually computes out of the box instead of staying null
  // until Vf is hand-entered, same as ISO 4548-12's own Mnr approximation.
  if (testVolume !== null && testVolume !== undefined) store.setFromData("testVolumeFinal", testVolume);

  // ---- Operating Conditions: Dilution System ----
  // First pass at this section only mapped the plain-key path (DilutionRatio/
  // SensorFlow) and dropped Sample Flow Rate entirely — left most of a real
  // ExRaDs-style machine's Dilution System fields blank, since those machines don't
  // carry the plain keys at all (see dataFile.js's Dilution System schema note).
  // Full ISO 4548-12 fallback chain ported over below, on the same footing this
  // file's header note already explains: same .DAT format, not standard-specific.
  if (df.countTimeSec !== undefined) store.setFromData("sampleTimeS", df.countTimeSec);
  if (df.holdTimeSec !== undefined) store.setFromData("holdTimeS", df.holdTimeSec);
  if (df.countTimeSec !== undefined && df.holdTimeSec !== undefined) {
    store.setFromData("samplingTimeMin", ((df.countTimeSec + df.holdTimeSec) / 60).toFixed(2));
  }

  // CORRECTED per the user after reviewing the actual standard: these two fields'
  // meanings were swapped. Sensor Type (Dilution System, not Counting Method) is
  // what's Light Blocking vs. Light Scattering — exactly which sensor is currently
  // selected, not a separate header field (SENSOR_CHANNELS' own labels in
  // iso19438Analysis.js already say "LB (Light Blocking)"/"LS (Light Scattering)").
  // Counting Method is ONLINE vs. OFFLINE (real-time inline counting during the test
  // vs. bottle samples processed later through a benchtop counter) — a completely
  // different axis from LB/LS. Every .DAT file this app reads is an online-counted
  // multipass test log by construction (see CLAUDE.md's ".DAT file handling" —
  // there's no offline/bottle-sample data path in this codebase at all), so this is
  // a fixed default, not derived from anything per-file — still data-editable, in
  // case a future file somehow represents offline data.
  if (analysis && analysis.sensor) {
    store.setFromData("dilutionSensorType", analysis.sensor === "ls" ? "Light Scattering" : "Light Blocking");
  }
  store.setFromData("countingMethod", "Online");

  // DilutionRatio/SensorFlow/SampleFlow pack upstream+downstream onto one header line
  // ("DilutionRatio,29,23"), so these need getHeaderValues (plural), not
  // getHeaderValue. A ratio of 0:1 is a legitimate, meaningful reading (undiluted
  // sample), NOT a missing value — formatDilutionRatio must not treat "0" as absent.
  const dilutionRatio = df.getHeaderValues("Dilution System Configuration", "DilutionRatio");
  if (dilutionRatio && dilutionRatio.length > 0) {
    store.setFromData("upstreamDilutionRatio", dilutionRatio[0] + ":1");
    if (dilutionRatio.length > 1) store.setFromData("downstreamDilutionRatio", dilutionRatio[1] + ":1");
  } else {
    // ExRaDs machines split DilutionRatio into PrimaryDilutionRatio (stage 1) and
    // ExtendedDilutionRatio (stage 2, "ext"), each its own upstream/downstream pair.
    const primaryRatio = df.getHeaderValues("Dilution System Configuration", "PrimaryDilutionRatio");
    const extendedRatio = df.getHeaderValues("Dilution System Configuration", "ExtendedDilutionRatio");
    const upstreamRatio = formatDilutionRatio(primaryRatio, extendedRatio, 0);
    if (upstreamRatio) store.setFromData("upstreamDilutionRatio", upstreamRatio);
    const downstreamRatio = formatDilutionRatio(primaryRatio, extendedRatio, 1);
    if (downstreamRatio) store.setFromData("downstreamDilutionRatio", downstreamRatio);
  }

  // The template's one "Flow rate" field (unlike ISO 4548-12, which shows Sensor
  // Flow Rate and Sample Flow Rate as two separate fields) — mapped from
  // Dilution System Configuration's SensorFlow, same fallback shape as the ratio
  // above. Not shown as upstream/downstream (both probes draw from the same
  // reservoir at the same setpoint, per the user). ExRaDs machines split it by
  // sensor type instead (LBSensorFlow/LSSensorFlow), shown together tagged when
  // both are present: "25(LB) 10(LS)".
  const plainSensorFlow = df.getHeaderValues("Dilution System Configuration", "SensorFlow");
  if (plainSensorFlow && plainSensorFlow.length > 0) {
    store.setFromData("sensorFlowRate", plainSensorFlow[0]);
  } else {
    const lbSensorFlow = df.getHeaderValues("Dilution System Configuration", "LBSensorFlow");
    const lsSensorFlow = df.getHeaderValues("Dilution System Configuration", "LSSensorFlow");
    const sensorFlowCombined = formatPerSensorFlow(lbSensorFlow, lsSensorFlow);
    if (sensorFlowCombined) store.setFromData("sensorFlowRate", sensorFlowCombined);
  }

  store.setFromData("comments", df.getHeaderValue("General Test Information", "Comments"));

  // ---- From the analysis engine ----
  if (analysis && analysis.ok) {
    store.setFromData("terminationTime", formatElapsed(analysis.terminationTime));

    if (analysis.cleanAssemblyDP !== null) {
      store.setFromData("dpAssemblyClean", analysis.cleanAssemblyDP, "kPa");
      // terminationDP === null is newly reachable (dual-filter Setup, a per-filter
      // view with neither its own nor an overall target active) — guard against a
      // literal "NaN kPa" in that rare case.
      if (analysis.terminationDP !== null) {
        store.setFromData("dpFinalNet", analysis.terminationDP - analysis.cleanAssemblyDP, "kPa");
      }
    }

    const cleanHousingDP = toNumber(df.getHeaderValue("General Test Information", "CleanHousingDP"));   // CONFIRMED by the user (2026-07-31), kPa
    if (cleanHousingDP !== null) store.setFromData("dpHousingClean", cleanHousingDP, "kPa");
    if (cleanHousingDP !== null && analysis.cleanAssemblyDP !== null) {
      store.setFromData("dpElementClean", analysis.cleanAssemblyDP - cleanHousingDP, "kPa");
    }

    // %-net-ΔP milestone table — same 7 milestones/field-id pattern as ISO 4548-12.
    for (const milestone of analysis.netDPMilestones) {
      const suffix = String(milestone.percent).replace(".", "_");
      if (milestone.assyDP !== null) store.setFromData("netDp" + suffix + "AssyDp", milestone.assyDP, "kPa");
      if (milestone.testTimeMin !== null) store.setFromData("netDp" + suffix + "TestTime", formatElapsed(Math.round(milestone.testTimeMin * 60)));
    }

    // Filtration Efficiencies table — 16 fixed sizes, THREE rows per size (Initial/
    // Min./Overall, replacing ISO 4548-12's Max/Min/Overall — see iso19438Analysis.js).
    const fixedSizes = resolveFixedSizes(df, analysis, options.persistedDisplaySizes);
    const fixedSizeIndices = fixedSizes.map((size) => analysis.sizes.findIndex((s) => Number(s) === size));
    store.setExtra("resolvedDisplaySizes", fixedSizes);

    // effChart feeds Figures B.1 (linear) and B.3 (log) — both plot Overall
    // Efficiency vs. Particle Size, same {sizes, overall} pair reused for both scales,
    // same pattern as iso454812Mapper.js's effChart for its own B.2/B.3.
    const effChart = { sizes: [], overall: [] };

    for (let i = 0; i < fixedSizes.length; i++) {
      const size = fixedSizes[i];
      const slot = i + 1;
      store.setFromData("effSizeLabel" + slot, ">" + size + "µmC");
      const sizeIndex = fixedSizeIndices[i];
      if (sizeIndex < 0) continue;
      if (analysis.initialEfficiency[sizeIndex] !== null) store.setFromData("effInitial" + slot, analysis.initialEfficiency[sizeIndex].toFixed(1));
      if (analysis.minEfficiency[sizeIndex] !== null) store.setFromData("effMin" + slot, analysis.minEfficiency[sizeIndex].toFixed(1));
      if (analysis.overallEfficiency[sizeIndex] !== null) {
        store.setFromData("effOverall" + slot, analysis.overallEfficiency[sizeIndex].toFixed(1));
        effChart.sizes.push(size);
        effChart.overall.push(analysis.overallEfficiency[sizeIndex]);
      }
    }
    store.setExtra("effChart", effChart);

    // Per-window clump pages (page 2+) — same fixed 16 sizes as Page 1's table. The
    // FIRST clump (elapsedMin === 6, the Initial Efficiency window) is flagged
    // isInitial so reportView.js's iso19438 clump renderer can label it "Initial
    // Filtration efficiency" instead of plain "Filtration efficiency" — see
    // iso19438Analysis.js's _computeInitialEfficiency (always ends at minute 6).
    const clumps = [];
    if (analysis.initialEfficiency.some((v) => v !== null)) {
      clumps.push({
        isInitial: true,
        elapsedMin: 6,
        dpAtEnd: interpolateDpAt(df, analysis, 6 * 60),
        sizeLabels: fixedSizes.map((size) => ">" + size + "µmC"),
        upstream: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.initialUpstream[idx])),
        downstream: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.initialDownstream[idx])),
        efficiency: fixedSizeIndices.map((idx) => (idx < 0 ? null : analysis.initialEfficiency[idx]))
      });
    }
    for (const bucket of analysis.buckets) {
      clumps.push({
        isInitial: false,
        elapsedMin: bucket.testTimeMin,
        dpAtEnd: bucket.dpAtEnd,
        sizeLabels: fixedSizes.map((size) => ">" + size + "µmC"),
        upstream: fixedSizeIndices.map((idx) => (idx < 0 ? null : bucket.upstream[idx])),
        downstream: fixedSizeIndices.map((idx) => (idx < 0 ? null : bucket.downstream[idx])),
        efficiency: fixedSizeIndices.map((idx) => (idx < 0 ? null : bucket.efficiency[idx]))
      });
    }
    store.setExtra("clumps19438", clumps);

    // Count cycles
    if (analysis.totalCounts !== null) store.setFromData("totalCounts", analysis.totalCounts);
    if (analysis.countsToAverage !== null) store.setFromData("countsToAverage", analysis.countsToAverage);

    // Filter rating table — TWO rows (Initial-based, Overall-based) x 4 targets.
    for (const [target, idSuffix] of Object.entries(RATING_TARGET_IDS)) {
      const initialRating = analysis.initialFilterRating[target];
      if (initialRating) store.setFromData("ratingInitial" + idSuffix, initialRating);
      const overallRating = analysis.overallFilterRating[target];
      if (overallRating) store.setFromData("ratingOverall" + idSuffix, overallRating);
    }

    // Gravimetric mass balance — only the part computable at load time (see
    // iso19438Analysis.js's computeMassBalance note on why Mnr/Cr aren't here).
    if (analysis.qia !== null) store.setFromData("injectionFlowrateQia", analysis.qia.toFixed(2));
    if (analysis.gia !== null) {
      store.setFromData("injectionGravInitial", analysis.gia.toFixed(1));
      store.setFromData("injectionGravFinal", analysis.gia.toFixed(1));
      store.setFromData("injectionGravAverage", analysis.gia.toFixed(1));
    }
    if (analysis.ga !== null) store.setFromData("baseGravimetricGa", analysis.ga.toFixed(2));
    if (analysis.injectedMass !== null) store.setFromData("injectedMassM1", analysis.injectedMass.toFixed(2));
    if (analysis.dustAdded !== null) store.setFromData("dustAddedW", analysis.dustAdded.toFixed(2));
  }
}

/** Interpolates the DP channel's value at a given elapsed second — used only for the
 *  synthetic Initial-Efficiency clump (elapsedMin===6), which isn't one of
 *  analysis.buckets and so has no dpAtEnd of its own already computed.
 *  @param {DataFile} df @param {*} analysis @param {number} atSec @returns {number|null} */
function interpolateDpAt(df, analysis, atSec) {
  const dpChannel = analysis.overallDPSeries || df.getChannel(analysis.terminationTag);
  if (!dpChannel) return null;
  // Reuses the same nearest-sample lookup every other elapsed-time-to-value read in
  // this codebase goes through (see analysisMath.js's interpolateAt) — but that's a
  // classic-<script>-loaded global (window.AnalysisMath), not importable here the ES
  // module way; a tiny local nearest-match is enough for this one display value.
  let best = null, bestDiff = Infinity;
  for (let i = 0; i < df.times.length; i++) {
    const t = df.times[i];
    if (t === null) continue;
    const diff = Math.abs(t - atSec);
    if (diff < bestDiff) { bestDiff = diff; best = dpChannel[i]; }
  }
  return best === null || best === undefined ? null : best;
}

/** Combines an ExRaDs file's PrimaryDilutionRatio + ExtendedDilutionRatio (each an
 *  upstream/downstream pair) into one display string for the given side (0 =
 *  upstream, 1 = downstream). Own copy of iso454812Mapper.js's identical helper —
 *  "0" is a real, meaningful ratio (undiluted sample) here, not a missing value,
 *  checked via array length/index, never falsy-coerced.
 *  @param {string[]|null} primary @param {string[]|null} extended @param {number} index
 *  @returns {string|null} e.g. "11:1 / 19:1 (ext)", or null if neither side has a value */
function formatDilutionRatio(primary, extended, index) {
  const p = primary && primary.length > index ? primary[index] : null;
  const e = extended && extended.length > index ? extended[index] : null;
  if (p !== null && e !== null) return p + ":1 / " + e + ":1 (ext)";
  if (e !== null) return e + ":1 (ext)";
  if (p !== null) return p + ":1";
  return null;
}

/** Combines an ExRaDs file's per-sensor-type flow readings (LBSensorFlow/LSSensorFlow)
 *  into one tagged display string. Own copy of iso454812Mapper.js's identical helper.
 *  @param {string[]|null} lb @param {string[]|null} ls
 *  @returns {string|null} e.g. "25(LB) 10(LS)", or null if neither side has a value */
function formatPerSensorFlow(lb, ls) {
  const parts = [];
  if (lb && lb.length > 0) parts.push(lb[0] + "(LB)");
  if (ls && ls.length > 0) parts.push(ls[0] + "(LS)");
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Which 16 sizes fill Page 1's table and the clump pages — own copy of
 *  iso454812Mapper.js's resolveFixedSizes/buildNaturalSizes (same per-slot
 *  preference/file/fallback precedence), not shared, per CLAUDE.md.
 *  @param {DataFile} df @param {*} analysis @param {number[]|null|undefined} persistedDisplaySizes
 *  @returns {number[]} */
function resolveFixedSizes(df, analysis, persistedDisplaySizes) {
  const measuredSizes = (analysis.sizes || []).map(Number).filter((n) => isFinite(n));
  const measuredSet = new Set(measuredSizes);

  const fileSizes = buildNaturalSizes(df, measuredSizes, measuredSet);
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

/** @param {DataFile} df @param {number[]} measuredSizes @param {Set<number>} measuredSet @returns {number[]} */
function buildNaturalSizes(df, measuredSizes, measuredSet) {
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
  return natural.slice(0, 16);
}

function toNumber(text) {
  if (text === null || text === undefined) return null;
  const n = parseFloat(text);
  return isFinite(n) ? n : null;
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

     fabricationIntegrity, dateConst, finalConductivity,
     initialCleanliness, finalGravimetricGf,
     nonRetainedMassMnr, retainedCapacityCr

   Same "hand-entered, no header fallback" convention iso454812Mapper.js uses.
   finalGravimetricGf (Gf) and testVolumeFinal (Vf, NOT in this list any more — see
   applyParsedFile above, defaults to the initial Volume) together drive Non-Retained
   Mass/Retained Capacity — see iso19438Analysis.js's computeMassBalance.
   dilutionSensorType and countingMethod are ALSO not in this list any more —
   dilutionSensorType is derived from the selected sensor (Light Blocking/Light
   Scattering), countingMethod defaults to a fixed "Online" (see applyParsedFile
   above) — neither is hand-entry-only any more.
   ===================================================================================== */

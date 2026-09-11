/* =====================================================================================
   iso454812Mapper.js
   =====================================================================================
   The middle layer for ISO 4548-12, same job as reportMapper.js: takes a parsed
   DataFile plus an Iso454812Analysis result and writes From Data values into a
   ReportValueStore. Nothing here computes anything new — every number here already
   exists in df or analysis; this file's only job is naming. See the "NOT AVAILABLE"
   list at the bottom for report fields this mapper deliberately leaves unset.

   DISPLAY_SIZES: fallback particle sizes for the fixed 16-size set both Page 1's
   Overall Filter Efficiency table AND Table B.2 are built from, used only when a
   file's own header doesn't carry a "DisplaySizes" list (Particle Counter
   Configuration). Real files DO carry their own lab-configured set (confirmed
   against 2024-083-ROTest9-MP, whose DisplaySizes — 4,5,7,9,10,12,15,18,20,21,22,23,
   24,25,30,35 — differs entirely from this outline's example set), so that header
   value is preferred whenever present, capped/padded to exactly 16 entries — both
   report pages use a FIXED 16-column layout so the printed shape doesn't reflow
   file to file (see resolveFixedSizes below).

   options.persistedDisplaySizes (see iso454812DisplaySizesView.js): a user's saved
   "always show these sizes" preference, applied ahead of the file's own natural list
   — resolveFixedSizes merges the two SLOT BY SLOT, so a preferred size this
   particular file didn't happen to measure falls back to that file's own list for
   just that one slot, rather than the whole preference being discarded. ---------- */

const DISPLAY_SIZES = [5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 20, 25, 30, 35, 40, 50];
const MICROMETER_TARGET_IDS = { "50": "50", "75": "75", "90": "90", "97.8": "97_8", "99": "99" };

/** @param {import("../../report/reportValueStore.js").ReportValueStore} store
 *  @param {DataFile} df @param {*} analysis
 *  @param {{persistedDisplaySizes?: number[]}} [options] */
export function applyParsedFile(store, df, analysis, options = {}) {
  // Report title + retained-mass note: own copy of the same non-standard-test-type/
  // non-standard-setup handling iso19438Mapper.js/iso16889Mapper.js each carry (per
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
    ? "Non-Standard " + nonStandardParts.join(" ") + " Test Reported to ISO 4548-12:2017"
    : "ISO 4548-12:2017 — Full-Flow Lubricating Oil Filters — Test Report");
  const retainedMassReasons = [];
  if (analysis.nonStandardTestType) retainedMassReasons.push(analysis.retainedMassSuppressedReason);
  if (analysis.dualFilterSetup) retainedMassReasons.push(analysis.dualFilterRetainedMassReason);
  if (retainedMassReasons.length) {
    store.setFromData("retainedMassNote", retainedMassReasons.join(" "));
  }

  // ---- Test Identification ----
  store.setFromData("testDate", df.fileDate);
  // "TestLocation" does NOT actually appear in any real file checked so far
  // (confirmed absent across every project fixture, 2026-08-18) — per the user,
  // this value gets filled via Custom Default or a Machine Profile in practice,
  // not from data. Kept as a harmless no-op fallback in case a future file ever
  // carries it directly.
  store.setFromData("testLocation", df.getHeaderValue("General Test Information", "TestLocation"));
  // Test ID reflects the data file's own name — there's no separate "TestID" header
  // key; the file name IS the test's identifier in practice.
  store.setFromData("testId", df.fileName);
  store.setFromData("testTime", df.getHeaderValue("General Test Information", "TestTime"));
  store.setFromData("operator", df.getHeaderValue("General Test Information", "Operator"));
  store.setFromData("projectId", df.getHeaderValue("General Test Information", "ProjectID"));

  // ---- Filter Identification ----
  store.setFromData("filterId", df.getHeaderValue("General Test Information", "FilterID"));
  store.setFromData("housingType", df.getHeaderValue("General Test Information", "HousingType"));
  // Only set on MidstreamFlag (series/dual-filter) files (see iso454812Analysis.js's
  // SENSOR SELECTION note) — a printed page carries no toolbar state, so this is how a
  // dual-filter report identifies which of the two filters it represents. Blank on an
  // ordinary single-filter report, so nothing changes there.
  if (analysis && analysis.sensorLabel) store.setFromData("analyzedFilterLabel", analysis.sensorLabel);

  // ---- Operating Conditions: Test Fluid ----
  store.setFromData("fluidType", df.getHeaderValue("General Test Information", "OilType"));
  store.setFromData("viscosity", df.getHeaderValue("General Test Information", "OilViscosity"));
  store.setFromData("initialConductivity", df.getHeaderValue("General Test Information", "TestConductivity"));
  // Same "Temperature" setpoint the Temperature (Test System) control target already
  // reads — see iso454812ControlTargets.js. Tagged "°C" (the file's native unit) so it
  // actually converts on the SI/US toggle, same as the kPa DP fields below — this was
  // previously untagged and stayed fixed regardless of the toggle.
  store.setFromData("temperature", df.getHeaderValue("Test System Configuration", "Temperature"), "°C");

  // ---- Operating Conditions: Test Dust ----
  store.setFromData("dustType", df.getHeaderValue("General Test Information", "DustType"));
  store.setFromData("dustBatch", df.getHeaderValue("General Test Information", "BatchNo"));
  // Setpoint (target), distinct from the analysis engine's computed actual average
  // (injectionFlowrateQia, below) — same header the control-target table already
  // reads for this rule (see iso454812ControlTargets.js).
  store.setFromData("injectionFlowrateSetpoint", df.getHeaderValue("Injection System Configuration", "Rate"));
  // "Volume Vi" is the injection reservoir volume — Injection System Configuration's
  // own Volume, not Test System's (see testVolume below, a different field).
  store.setFromData("volumeVi", df.getHeaderValue("Injection System Configuration", "Volume"));

  // ---- Operating Conditions: Test System ----
  // Tagged "L/min" (the file's native unit) so it converts to gal/min on the SI/US
  // toggle — unlike the small mL/min injection/sensor/sample flows below, which stay
  // fixed (confirmed with the user: converting those to gal/min would show unreadable
  // tiny fractions). testVolume is a quantity (liters), not a rate — stays untagged,
  // same as every other volume/concentration field in this file.
  store.setFromData("testFlowrateQ", df.getHeaderValue("Test System Configuration", "Rate"), "L/min");
  const testVolume = df.getHeaderValue("Test System Configuration", "Volume");
  store.setFromData("testVolume", testVolume);
  // Final Volume Vf has no header of its own — a separately-measured final system
  // volume isn't tracked (see iso454812Analysis.js's computeMassBalance note). Per
  // the user: default it to the initial Volume as a starting fallback (still
  // data-editable — a real final-volume reading, once known, overrides this) rather
  // than leaving it blank until someone remembers to fill it in by hand.
  if (testVolume !== null && testVolume !== undefined) store.setFromData("testVolumeFinal", testVolume);

  // ---- Operating Conditions: Dilution System — sample/hold time are already-parsed
  // DataFile properties (countTimeSec/holdTimeSec), not header lookups. Sampling time
  // is derived from both, not its own header field: one full cycle = count + hold. ----
  if (df.countTimeSec !== undefined) store.setFromData("sampleTimeS", df.countTimeSec);
  if (df.holdTimeSec !== undefined) store.setFromData("holdTimeS", df.holdTimeSec);
  if (df.countTimeSec !== undefined && df.holdTimeSec !== undefined) {
    store.setFromData("samplingTimeMin", ((df.countTimeSec + df.holdTimeSec) / 60).toFixed(2));
  }

  // DilutionRatio/SensorFlow/SampleFlow pack upstream+downstream onto one header line
  // ("DilutionRatio,29,23"), so these need getHeaderValues (plural), not
  // getHeaderValue — see dataFile.js. Ratios are displayed as "N:1" per the standard's
  // convention, not a bare number.
  //
  // ExRaDs machines don't carry a plain "DilutionRatio" key at all — they split it
  // into PrimaryDilutionRatio (stage 1) and ExtendedDilutionRatio (stage 2, tagged
  // "ext" below), each its own upstream/downstream pair (see dataFile.js's Dilution
  // System schema note). A ratio of 0:1 is a legitimate, meaningful reading here (no
  // clean fluid used — the sample is measured undiluted, useful when a filter is
  // efficient enough that undiluted counts still stay within the counter's coincidence
  // limits), NOT a "missing value" — formatDilutionRatio must not treat "0" as absent.
  const dilutionRatio = df.getHeaderValues("Dilution System Configuration", "DilutionRatio");
  if (dilutionRatio && dilutionRatio.length > 0) {
    store.setFromData("upstreamDilutionRatio", dilutionRatio[0] + ":1");
    if (dilutionRatio.length > 1) store.setFromData("downstreamDilutionRatio", dilutionRatio[1] + ":1");
  } else {
    const primaryRatio = df.getHeaderValues("Dilution System Configuration", "PrimaryDilutionRatio");
    const extendedRatio = df.getHeaderValues("Dilution System Configuration", "ExtendedDilutionRatio");
    const upstreamRatio = formatDilutionRatio(primaryRatio, extendedRatio, 0);
    if (upstreamRatio) store.setFromData("upstreamDilutionRatio", upstreamRatio);
    const downstreamRatio = formatDilutionRatio(primaryRatio, extendedRatio, 1);
    if (downstreamRatio) store.setFromData("downstreamDilutionRatio", downstreamRatio);
  }

  // Sensor Flow Rate (the dilution system's measurement sensor) and Sample Flow Rate
  // (the flow drawn for sampling) are two different, both-important header values —
  // named distinctly rather than one generic "Flowrate" field. Per the user: each
  // line's two comma values are NOT a meaningful upstream/downstream pair here (both
  // probes draw from the same reservoir at the same setpoint), so only ONE value is
  // shown, not "a / b". ExRaDs machines split each field by SENSOR TYPE instead of
  // one plain key — LBSensorFlow/LSSensorFlow for Sensor Flow Rate, and a "SampleFlow"
  // key that repeats once per sensor type's dilution stage for Sample Flow Rate (see
  // dataFile.js's Dilution System schema note and getAllHeaderValues) — shown
  // together, tagged, when both are present: "25(LB) 10(LS)". Shown regardless of
  // which sensor is currently selected — this is static dilution-system config, not
  // something that should change when the sensor toggle does.
  const plainSensorFlow = df.getHeaderValues("Dilution System Configuration", "SensorFlow");
  if (plainSensorFlow && plainSensorFlow.length > 0) {
    store.setFromData("sensorFlowRate", plainSensorFlow[0]);
  } else {
    const lbSensorFlow = df.getHeaderValues("Dilution System Configuration", "LBSensorFlow");
    const lsSensorFlow = df.getHeaderValues("Dilution System Configuration", "LSSensorFlow");
    const sensorFlowCombined = formatPerSensorFlow(lbSensorFlow, lsSensorFlow);
    if (sensorFlowCombined) store.setFromData("sensorFlowRate", sensorFlowCombined);
  }

  const allSampleFlow = df.getAllHeaderValues("Dilution System Configuration", "SampleFlow");
  if (allSampleFlow.length === 1) {
    if (allSampleFlow[0].length > 0) store.setFromData("sampleFlowRate", allSampleFlow[0][0]);
  } else if (allSampleFlow.length > 1) {
    // Positional, confirmed against a real file: the first occurrence sits with the
    // primary/LB dilution stage, the second with the extended/LS stage.
    const sampleFlowCombined = formatPerSensorFlow(allSampleFlow[0], allSampleFlow[1]);
    if (sampleFlowCombined) store.setFromData("sampleFlowRate", sampleFlowCombined);
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

    // Housing/Element DP — reuses the same "CleanHousingDP" header key already
    // confirmed working in reportMapper.js's ISO 16889 pipeline (not a new guess).
    const cleanHousingDP = toNumber(df.getHeaderValue("General Test Information", "CleanHousingDP"));
    if (cleanHousingDP !== null) store.setFromData("dpHousingClean", cleanHousingDP, "kPa");
    if (cleanHousingDP !== null && analysis.cleanAssemblyDP !== null) {
      store.setFromData("dpElementClean", analysis.cleanAssemblyDP - cleanHousingDP, "kPa");
    }

    // %-net-ΔP milestone table
    for (const milestone of analysis.netDPMilestones) {
      const suffix = String(milestone.percent).replace(".", "_");
      if (milestone.assyDP !== null) store.setFromData("netDp" + suffix + "AssyDp", milestone.assyDP, "kPa");
      if (milestone.testTimeMin !== null) store.setFromData("netDp" + suffix + "TestTime", formatElapsed(Math.round(milestone.testTimeMin * 60)));
    }

    // Both Page 1's efficiency table AND Table B.2 (page 2+) use the SAME fixed set
    // of 16 sizes, in the same order — one "which 16 sizes get displayed" decision
    // feeding two report pages, not two independently-sized tables. See
    // resolveFixedSizes below for how a persisted preference and the file's own
    // header combine to produce it.
    const fixedSizes = resolveFixedSizes(df, analysis, options.persistedDisplaySizes);
    const fixedSizeIndices = fixedSizes.map((size) => analysis.sizes.findIndex((s) => Number(s) === size));
    store.setExtra("resolvedDisplaySizes", fixedSizes);

    // effChart feeds Figures B.2/B.3 (overall efficiency vs. particle size) — the
    // same fixed 16-size selection as the table above, just as a plain {sizes,
    // overall} array pair instead of per-slot ids, since a chart needs to iterate
    // the whole series rather than address one size at a time. Only sizes that
    // actually resolved to real data are included (a chart plotting a gap looks
    // like a data point of zero, which isn't what a missing size means).
    const effChart = { sizes: [], overall: [] };

    for (let i = 0; i < fixedSizes.length; i++) {
      const size = fixedSizes[i];
      const slot = i + 1;
      store.setFromData("effSizeLabel" + slot, ">" + size + "µmC");
      const sizeIndex = fixedSizeIndices[i];
      if (sizeIndex < 0) continue;
      if (analysis.maxEfficiency[sizeIndex] !== null) store.setFromData("effMax" + slot, analysis.maxEfficiency[sizeIndex].toFixed(1));
      if (analysis.minEfficiency[sizeIndex] !== null) store.setFromData("effMin" + slot, analysis.minEfficiency[sizeIndex].toFixed(1));
      if (analysis.overallEfficiency[sizeIndex] !== null) {
        store.setFromData("effOverall" + slot, analysis.overallEfficiency[sizeIndex].toFixed(1));
        effChart.sizes.push(size);
        effChart.overall.push(analysis.overallEfficiency[sizeIndex]);
      }
    }
    store.setExtra("effChart", effChart);

    // Table B.2 — one row-group per computed bucket, each carrying the same 16
    // fixed sizes as Page 1's table (fixedSizeIndices, above). Kept as a plain array
    // in the store's "extras" channel (getExtra/setExtra), same "not a per-size
    // data-slot" precedent as the old _effTable: the row COUNT itself varies by test
    // length (a 100-hour test at 10-minute buckets is 600 rows), so a static template
    // can't declare these ids up front — reportView.js's fillTableB2Pages chunks this
    // array into per-sheet pages. dpAtEnd is left in canonical kPa (unconverted) —
    // fillTableB2Pages converts it at render time via the same toDisplayValue() path
    // field-driven slots use, so it still respects the SI/US unit toggle.
    store.setExtra("bucketsB2", analysis.buckets.map((bucket) => ({
      elapsedMin: bucket.testTimeMin,
      dpAtEnd: bucket.dpAtEnd,
      sizeLabels: fixedSizes.map((size) => ">" + size + "µmC"),
      upstream: fixedSizeIndices.map((idx) => (idx < 0 ? null : bucket.upstream[idx])),
      downstream: fixedSizeIndices.map((idx) => (idx < 0 ? null : bucket.downstream[idx])),
      efficiency: fixedSizeIndices.map((idx) => (idx < 0 ? null : bucket.efficiency[idx]))
    })));

    // Count cycles
    if (analysis.totalCounts !== null) store.setFromData("totalCounts", analysis.totalCounts);
    if (analysis.countsToAverage !== null) store.setFromData("countsToAverage", analysis.countsToAverage);

    // Micrometer rating table
    for (const [target, idSuffix] of Object.entries(MICROMETER_TARGET_IDS)) {
      const rating = analysis.micrometerRating[target];
      if (rating) store.setFromData("micrometerRating" + idSuffix, rating);
    }

    // Gravimetric mass balance — only the part computable at load time (see
    // iso454812Analysis.js's file-header note on why Mnr/Cr aren't here).
    if (analysis.qia !== null) store.setFromData("injectionFlowrateQia", analysis.qia.toFixed(2));
    if (analysis.gia !== null) {
      // Header fallback shown for both Initial and Final until a user overrides each
      // independently — no fallback distinguishes them, per the standard.
      store.setFromData("injectionGravInitial", analysis.gia.toFixed(1));
      store.setFromData("injectionGravFinal", analysis.gia.toFixed(1));
      store.setFromData("injectionGravAverage", analysis.gia.toFixed(1));
    }
    if (analysis.ga !== null) store.setFromData("baseGravimetricGa", analysis.ga.toFixed(2));
    if (analysis.injectedMass !== null) store.setFromData("injectedMassM1", analysis.injectedMass.toFixed(2));
    if (analysis.dustAdded !== null) store.setFromData("dustAddedW", analysis.dustAdded.toFixed(2));
  }
}

/**
 * Which 16 sizes fill Page 1's efficiency table and Table B.2, slot by slot.
 *
 * Precedence per slot: a user's persisted preference (iso454812DisplaySizesView.js),
 * IF this file actually measured that size for the SELECTED SENSOR — otherwise a
 * sensor-aware natural list fills that slot instead (see buildNaturalSizes below).
 * This is a per-slot fallback, not "use the preference list or the natural list" as
 * a whole: a preference of 16 sizes where only 3 happen to be missing from this
 * file/sensor still keeps the other 13 preferred sizes, only those 3 slots fall
 * back. Matters for a lab that writes many reports against the same preferred size
 * set across files that don't all measure every one of those sizes.
 *
 * @param {DataFile} df @param {*} analysis @param {number[]|null|undefined} persistedDisplaySizes
 * @returns {number[]} up to 16 sizes, in slot order
 */
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
  // A preferred size and some other slot's positional fallback can land on the same
  // value (dropped by the Set above) — backfill from the natural list so a
  // coincidental collision doesn't cost a display slot.
  for (const s of fileSizes) {
    if (chosen.size >= 16) break;
    chosen.add(s);
  }

  // Always return ascending. Particle counts are cumulative by size threshold, so a
  // report's reader expects each next size to be strictly larger than the last —
  // and a hardware guarantee means the sizes a sensor measures are assigned in
  // ascending order in the first place. Sorting here (rather than trying to keep
  // every step above order-preserving) is what actually guarantees it: preferred[]
  // and fileSizes[] are each independently ascending, but merging them slot-by-slot
  // can still interleave the two out of order relative to each other — confirmed by
  // a real report showing 1.5/1.7/2 µm appended after 25 µm.
  return [...chosen].sort((a, b) => a - b).slice(0, 16);
}

/**
 * The "natural" (no persisted preference) 16 sizes for the CURRENTLY SELECTED
 * SENSOR. The file's header "DisplaySizes" (Particle Counter Configuration) is a
 * naming artifact from when LB was the only sensor this project supported — it is
 * NOT "LBDisplaySizes", but its entries were still only ever configured against
 * LB's own measured range. Using it as-is for LS (or any future non-LB sensor)
 * silently produced size-column headers the sensor never measured at all (blank
 * data cells, label still shown) — confirmed against a real LS file, whose sensor
 * range (1.5-25 µm) doesn't cover several sizes on that file's LB-configured
 * DisplaySizes list (18/30/35 µm, e.g.).
 *
 * Fix: intersect the header list with what THIS sensor actually measured, then pad
 * up to 16 from the sensor's own full measured list (ascending) if the
 * intersection falls short — every slot always gets a size real data exists for,
 * rather than a blank column.
 *
 * @param {DataFile} df @param {number[]} measuredSizes ascending not required
 * @param {Set<number>} measuredSet @returns {number[]} up to 16 sizes
 */
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
  // The header's DisplaySizes list is itself not guaranteed to already be ascending
  // (and even if it is, appending sizes onto the end above breaks that) — sort
  // before returning so this is always ascending regardless of source order.
  natural.sort((a, b) => a - b);
  return natural.slice(0, 16);
}

/** Combines an ExRaDs file's PrimaryDilutionRatio + ExtendedDilutionRatio (each an
 *  upstream/downstream pair — see dataFile.js's Dilution System schema note) into one
 *  display string for the given side (0 = upstream, 1 = downstream). "0" is a real,
 *  meaningful ratio (undiluted sample) here, not a missing value — checked via
 *  array length/index, never falsy-coerced.
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

/** Combines an ExRaDs file's per-sensor-type flow readings (LBSensorFlow/LSSensorFlow,
 *  or the first/second occurrence of a repeated SampleFlow — see getAllHeaderValues)
 *  into one tagged display string. Only the FIRST value of each pair is used — per the
 *  user, the two comma values on these lines aren't a meaningful upstream/downstream
 *  distinction (both probes draw from the same reservoir at the same setpoint).
 *  @param {string[]|null} lb @param {string[]|null} ls
 *  @returns {string|null} e.g. "25(LB) 10(LS)", or null if neither side has a value */
function formatPerSensorFlow(lb, ls) {
  const parts = [];
  if (lb && lb.length > 0) parts.push(lb[0] + "(LB)");
  if (ls && ls.length > 0) parts.push(ls[0] + "(LS)");
  return parts.length > 0 ? parts.join(" ") : null;
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

     bypassValveOperative, fabricationIntegrity, dateOfManufacture,
     finalConductivity, initialCleanliness,
     finalGravimetricGf, dilutionSensorType, nonRetainedMassMnr, retainedCapacityCr

   First group is physical/equipment data an operator enters by hand, same convention
   as reportMapper.js. finalGravimetricGf has no header fallback per the standard (it
   must come from the lab's own gravimetric analysis after the test) — until it's
   entered, nonRetainedMassMnr and retainedCapacityCr can't be computed either (see
   iso454812Analysis.js). testVolumeFinal is NOT in this list any more — it now
   defaults to the initial Volume value (see applyParsedFile above), a real fromData
   value rather than a true hand-entry gap.

   bypassValveOperative: a real file had a "BypassDP,0" header value (General Test
   Information) that MIGHT correlate with whether the bypass valve was active (0 =
   inactive?) — not confirmed across enough files to act on, so left as hand-entry
   rather than guessed. Worth checking against a file with a non-zero BypassDP.
   ===================================================================================== */

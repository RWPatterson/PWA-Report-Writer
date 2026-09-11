/* =====================================================================================
   iso3968Mapper.js
   =====================================================================================
   Same job as the other three standards' Mappers: takes a parsed DataFile plus an
   Iso3968Analysis result and writes From Data values into a ReportValueStore. Nothing
   here computes anything new beyond simple header-value derivations — every number
   here already exists in df or analysis; this file's only job is naming.

   No "Non-Standard ... Test Reported to ISO ..." title logic here, unlike the other
   three standards' Mappers: this standard's TestType is always "P-Q" (that IS the
   standard, not a variant of it) — there's no Single-Pass/Multipass Series/dual-filter-
   Setup concept for a flow/pressure characterization test to be non-standard against.

   options.tareDf/options.tareAnalysis (see app.js's runAnalysisPipeline): the OPTIONAL
   second (empty-housing) file, if the user supplied one — populates Table 2 (the tare's
   own Average ΔP block) on Page 2. NOT the same file/analysis as df/analysis (the
   primary run); see reportView.js's fillIso3968AverageDpTables for how store.getExtra
   carries both through to render time.

   See the "NOT AVAILABLE" list at the bottom for report fields this mapper
   deliberately leaves unset (all pure hand-entry — the software has no way to
   measure them at all, confirmed by the user, 2026-08-03). ---------------------- */

/** Real files show more spelling/case variance for "Spin On" than the multipass
 *  standards' Setup field does ("Spin On", "Spin-on", "SPIN ON" all confirmed) —
 *  normalize before comparing rather than an exact match.
 *  @param {string} testSetup @returns {boolean} */
function isSpinOn(testSetup) {
  return !!testSetup && testSetup.toLowerCase().replace(/[\s-]/g, "") === "spinon";
}

/** @param {import("../../report/reportValueStore.js").ReportValueStore} store
 *  @param {DataFile} df @param {*} analysis
 *  @param {{tareDf?: DataFile, tareAnalysis?: *}} [options] */
export function applyParsedFile(store, df, analysis, options = {}) {
  store.setFromData("reportTitle", "ISO 3968:2017 — Table 3, Report Sheet");

  // ---- Row 1 ----
  // Test Laboratory: no matching header field found in any real P-Q file checked —
  // hand-entry (see NOT AVAILABLE below).
  store.setFromData("testDate", df.fileDate);
  store.setFromData("operator", df.getHeaderValue("General Test Information", "Operator"));

  // ---- Filter and Element Identification ----
  store.setFromData("elementIdentification", df.getHeaderValue("General Test Information", "FilterID"));
  // Housing Identification: NOT the same thing as HousingType (a TYPE like "Spin On"/
  // "Cartridge", confirmed present in real files) — no identifier field exists for
  // this; hand-entry.
  store.setFromData("spinOn", isSpinOn(df.testSetup) ? "Yes" : "No");
  // Filter rated flow rate qR: pure hand-entry, no fallback. An earlier pass derived
  // this as max(flowRateTargets)/1.2 (assuming the test always sweeps to exactly 120%
  // of qR) — removed per the user (2026-08-03): that's an assumption about the test
  // setup, not a value the file stipulates, so the Flow Ratio column should only
  // populate once the user actually supplies qR by hand (see reportView.js's
  // fillIso3968AverageDpTables, which reads store.get("filterRatedFlowRate") live and
  // leaves Flow Ratio blank whenever it's unset).

  // ---- Operating Conditions: Test Fluid ----
  store.setFromData("testFluidType", df.getHeaderValue("General Test Information", "OilType"));
  store.setFromData("testFluidBatch", df.getHeaderValue("General Test Information", "BatchNo"));
  store.setFromData("viscosity", df.getHeaderValue("General Test Information", "OilViscosity"));
  store.setFromData("temperature", df.getHeaderValue("Test System Configuration", "Temperature"), "°C");
  // Test Fluid Ref: no matching header field found — hand-entry.
  // Initial cleanliness (ISO 4406 code): no particle counting during P-Q testing
  // (confirmed by the user) — hand-entry.

  // ---- From the analysis engine (Figure 4 + Page 2's tables) ----
  // Figure 4 and the Average ΔP tables are built directly from store.getExtra
  // ("sourceAnalysis")/("sourceTareAnalysis") at render time (reportView.js), the
  // same way every other standard's DP-vs-time chart reads "sourceDf"/
  // "sourceAnalysis" — nothing to map into named store fields here, since a P-Q
  // curve's points aren't a fixed set of named quantities the way (e.g.) 16 filter
  // sizes are.
  if (options.tareAnalysis) {
    store.setExtra("sourceTareAnalysis", options.tareAnalysis);
  }
}

/* ---- NOT AVAILABLE from a .DAT file — left unset on purpose, template renders
   them blank (data-editable, no fallback tier — same established pattern
   iso16889Mapper.js's testLab/housingId/etc. and iso454812Mapper.js's
   bypassValveOperative/fabricationIntegrity/etc. already use):
     testLaboratory, housingIdentification, filterRatedFlowRate, substituteElement,
     substituteElementDescription, testFluidRef, initialCleanliness,
     bypassOpeningPressure, bypassOpeningFlowRate, bypassClosingPressure,
     bypassClosingFlowRate, leak50Pressure, leak50Rate, leak75Pressure, leak75Rate,
     leak100Pressure, leak100Rate, leak120Pressure, leak120Rate
   Physical/lab-process data an operator enters by hand — no P-Q test stand logs a
   bypass valve's opening pressure, for instance. filterRatedFlowRate is pure hand-
   entry again (see above) — no fallback derivation. -------------------------------- */

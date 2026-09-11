"use strict";
/* =====================================================================================
   iso16889Analysis.js  —  ISO 16889:2022 analysis engine.
   =====================================================================================
   Clean build against the published standard text (clauses 12.1-13.8), not a port of
   the legacy Bonavista-derivative build this project used to also carry (removed —
   see CLAUDE.md's "ISO 16889 — provenance note"). Takes a parsed DataFile and produces the
   numbers the ISO 16889:2022 report needs: termination, the 10 reporting-time "clump"
   table (differential pressure AND filtration ratio per particle size), the six
   Size_At_Beta_x reverse-interpolated values, and the injection-flow/gravimetric mass
   balance (Dust_Injected / Dust_Retained / Average_BUGL).

   -------------------------------------------------------------------------------------
   FILE ORGANIZATION — 3 lenses, same convention as iso454812Analysis.js/
   iso19438Analysis.js, own copy of every procedure per CLAUDE.md even where the SHAPE
   matches (sensor selection, midstream handling): PRESSURE (channels, termination,
   clean/element ΔP), PARTICLE COUNT (sensor selection, the reporting-time clumping
   scheme, beta ratios, Size_At_Beta_x), MASS (injection flow rate, gravimetric mass
   balance). termination is threaded explicitly from run() into the other two lenses'
   methods (see FILE ORGANIZATION in iso454812Analysis.js for the full rationale).

   -------------------------------------------------------------------------------------
   THE REPORTING-TIME CLUMPING SCHEME (12.1-12.5) — genuinely different from
   4548-12/19438's fixed-clock-bucket scheme, not a variant of it
   -------------------------------------------------------------------------------------
   4548-12/19438 divide the test into FIXED-DURATION buckets (5 or 10 minutes each),
   so the bucket COUNT scales with test length. ISO 16889:2022 instead always produces
   exactly 10 clumps — 10%, 20%, ... 100% of whatever the actual termination time turns
   out to be — each clump's boundary rounded UP to a whole minute, with each
   subsequent clump starting the minute right after the previous one's rounded stop
   (so rounding error never compounds/drifts). Reverse-engineered from and verified
   exactly against the standard text's own 86-minute worked example (12.5):
   terminationMinutes=86 -> clump boundaries 4-9, 10-18, 19-26, 27-35, 36-43, 44-52,
   53-61, 62-69, 70-78, 79-86. See _computeReportingTimeClumps for the formula.

   -------------------------------------------------------------------------------------
   Size_At_Beta_x (13.6) — log-linear interpolation, a deliberate correctness
   improvement over the legacy engine, not a port
   -------------------------------------------------------------------------------------
   The removed legacy engine's own _sizeGivenBeta interpolated PLAIN-linear on raw
   beta values. The standard's own text (13.5/13.6) describes these six values as coming
   from "straight-line segments" on a SEMI-LOG plot (beta on the log axis, size on the
   linear axis) — a straight line on semi-log paper is linear in size, LOGARITHMIC in
   beta, which plain-linear interpolation on raw beta gets measurably wrong across the
   wide beta range this standard covers (2 to 100,000+). This engine's own
   _sizeGivenBeta is log-linear instead — see its own comment for the reconstructed
   formula (the pasted 13.6 text has a transcription error, a stray unmatched
   parenthesis, so the formula below is rebuilt from the plain-English description
   plus standard log-linear interpolation math, not implemented literally broken).
   A real file's Size_At_Beta_x values from this engine may differ slightly from the
   legacy engine's for the same file — expected and correct, not a regression.

   -------------------------------------------------------------------------------------
   SENSOR SELECTION (LB vs LS vs LBE) / MIDSTREAM — full parity with 4548-12/19438,
   confirmed with the user even though nothing in the pasted spec explicitly asks for
   either (the spec's own "Counting system" table only shows one Upstream/Downstream
   row pair, no LB/LS split or dual-filter language) — own copy of the SENSOR_CHANNELS/
   resolveDPChannelTag/resolveSensorLabel pattern, same shape as iso454812Analysis.js.
   Midstream dual-filter DP channels (TS_PreDPress/TS_FinalDPress) are CONFIRMED —
   the legacy engine never implemented midstream for this standard at all ("not
   implemented yet"), so unlike termination's single-filter channel (confirmed real,
   proven by the legacy engine's own working use), this is genuinely new ground.

   -------------------------------------------------------------------------------------
   CHANNEL/HEADER CONFIDENCE — better footing than ISO 19438 had
   -------------------------------------------------------------------------------------
   Every `.DAT` file is the same multipass-test log format regardless of which standard
   analyzes it (CLAUDE.md's ".DAT file handling"), so tags already proven by the legacy
   iso16889 engine's own real-file use, or by iso454812ControlTargets.js's "confirmed
   against a real file" tags, are fair game here with confidence, not a guess:
   TS_DPress/TerminalDP (termination — proven directly by the legacy engine),
   TS_Rate/INJ_Rate ("Rate" under Test/Injection System Configuration), TS_Temp,
   TestConductivity, CleanHousingDP/CleanAssemblyDP. Sensor Flow Rate has TWO real
   naming schemes depending on the rig, both listed unconditionally in
   iso16889ControlTargets.js (same "list every variant, let 'channel not present'
   sort it out" pattern already used for LB vs LS itself): an ExRaDs extended-range
   dual-sensor rig uses aQLBU/aQLBD (header LBSensorFlow) and aQLSU/aQLSD (header
   LSSensorFlow); a single-sensor rig uses plain UpSensor/DnSensor (header SensorFlow,
   unprefixed) — CONFIRMED against a real single-sensor file (2026-08-11,
   TwinFSRig-ROTest9-MP.DAT, "ROTest9") after a customer report that the LB/LS-prefixed
   rule alone produced a false "target not found" — same generic-naming fact
   iso454812ControlTargets.js's own comment already flagged as unconfirmed for ISO
   16889 specifically ("don't port this table's shape back... without checking an ISO
   16889 file directly"), now checked. That same file also exposed a second, more
   serious bug from the same wrong assumption: Downstream_Sample_Flow (Qd, 13.2's
   Dust_Retained input) used to average the sensor-flow channel instead of reading the
   real dilution SampleFlow header setpoint — own copy of the exact mistake
   iso19438Analysis.js's Qd had before its 2026-07-31 fix; see HEADER_SAMPLE_FLOW's own
   comment. Only one genuinely NEW quantity this standard's spec introduces has no
   existing confirmed precedent and is marked `// ASSUMED` below: the Test System
   Volume control-target channel. (12.12's Average_BUGL target was originally going to
   need its own ASSUMED header key too, but per a user correction there is no such
   header field at all — the target is DERIVED from three already-confirmed setpoints
   instead; see checkGravimetricAcceptance's own comment.)

   Wrapped in an IIFE — index.html loads this and every other standard's analysis
   engine as classic <script> tags sharing one global scope, so internal names must
   not leak and collide with a sibling standard's own top-level declarations.

   ENCAPSULATION NOTE (per CLAUDE.md's code-hygiene rule): same as iso454812Analysis.js
   — plain public fields, not private #fields + getters. This class is a read-only-by-
   convention result bag iso16889Mapper.js reads directly; there's no invariant here
   for private fields to guard.
   ===================================================================================== */
(function () {

//#region shared
// CONFIRMED by the user (2026-07-31) — per-value meaning, own copy of the same note
// iso19438Analysis.js/iso454812Analysis.js each carry (never shared, per CLAUDE.md,
// even though the set and reasoning are identical across all three standards):
//   Multipass            — the only type this standard's math is actually written for.
//   Single-Pass          — NON-STANDARD but analyzable in the same multipass style: the
//     machine's cleanup filter is ON, so contaminant passes the test filter only once
//     before the cleanup filter (not the test filter) captures it downstream.
//   Multipass Series     — NON-STANDARD, same style: two filters in series, so there's
//     no way to tell which one retained the contaminant.
//   (both of the above: analyzable for efficiency/DP, but NOT for retained mass — see
//   NON_STANDARD_TEST_TYPES and app.js's recomputeIso16889GravimetricDerived)
//   ""                   — pre-dates this header field existing; treated as Multipass.
//   Data Only / PQ / Cyclic Multipass / Cyclic Series Multipass — rejected, same
//   reasons as iso19438Analysis.js's own note.
const VALID_TEST_TYPES = ["Single-Pass", "Multipass", "Multipass Series", ""];
const REJECTED_TEST_TYPES = {
  "Data Only": "This file contains 'Data Only' and cannot generate ISO 16889 reports.",
  "P-Q": "This file contains 'P-Q' data and cannot generate ISO 16889 reports.",   // CONFIRMED real key (2026-08-03), was "PQ" — never matched a real file
  "Cyclic Multipass": "This file contains 'Cyclic Multipass' data (ISO 23369), not ISO 16889.",
  "Cyclic Series Multipass": "This file contains 'Cyclic Series Multipass' data (ISO 23369), not ISO 16889."
};
// Own copy per CLAUDE.md, even though this set/reasoning is identical across all
// three standards — see iso19438Analysis.js's own copy for the full rationale.
const NON_STANDARD_TEST_TYPES = ["Single-Pass", "Multipass Series"];
const NON_STANDARD_RETAINED_MASS_REASON = {
  "Single-Pass": "Retained mass analysis is not valid for a Single-Pass test: the machine's cleanup filter is active, so contaminant that passes the test filter is captured downstream by the cleanup filter rather than recirculated — it cannot be attributed to the test filter alone.",
  "Multipass Series": "Retained mass analysis is not valid for a Multipass Series test: with two filters in series, it is not possible to determine which filter retained the contaminant."
};

const analysisMathLib = (typeof module !== "undefined") ? require("../../helpers/analysisMath.js") : window.AnalysisMath;
const { findCrossingBracket, interpolateAt, toNumber, formatElapsed, sumChannels } = analysisMathLib;
const coincidenceLimitLib = (typeof module !== "undefined") ? require("../../helpers/coincidenceLimitCheck.js") : window.CoincidenceLimitCheck;
const { checkCoincidenceLimit, formatMinuteRanges, DEFAULT_LB_COINCIDENCE_LIMIT, DEFAULT_LS_COINCIDENCE_LIMIT } = coincidenceLimitLib;
//#endregion

//#region pressure lens — channels, termination, clean/element ΔP
// CONFIRMED by the user (2026-07-31) — "Flat Sheet" added: a flat sheet test is just
// a piece of flat media in a universal test housing, single-filter like Spin On/
// Pressure/Suction, not a dual-filter setup. (Previously missing — a real file
// misrouted into the "requires the dual-filter analysis path, not implemented yet"
// error, which was doubly wrong: single-filter, and nothing dual-filter about it.)
const SINGLE_FILTER_SETUPS = ["Spin On", "Pressure", "Suction", "Flat Sheet", ""];
// CONFIRMED by the user (2026-07-31) — a Suction-mounted single filter is analyzable
// (in SINGLE_FILTER_SETUPS above) but is NOT a standard ISO test configuration, so a
// Suction file's report gets the same "Non-Standard ... Test Reported to ISO ..."
// title treatment as a non-standard TEST TYPE (see NON_STANDARD_TEST_TYPES below) —
// title only, no effect on retained-mass validity (unlike a non-standard test type,
// there's still exactly one filter here, just mounted differently). Own copy per
// CLAUDE.md. "Suction & Pressure" (two filters in series — a suction filter plus a
// normal-location filter) is a SEPARATE, not-yet-implemented dual-filter setup — see
// WISHLIST.md's dual-filter termination item, which now also needs to mark that
// setup's own report Non-Standard once built.
// "Two Pressure"/"Suction & Pressure" — two physical filters tested in series (filter
// 1 = prefilter/suction, filter 2 = final filter). CONFIRMED real hardware, per the
// user (2026-08-03); an IMPLEMENTED path now, not a rejected one — see
// _determineDualFilterTermination below.
const DUAL_FILTER_SETUPS = ["Two Pressure", "Suction & Pressure"];
// Both dual-filter setups are ALSO non-standard for the report title, same reasoning
// as plain Suction — series/dual-filter testing itself isn't what the published
// standard describes, regardless of mounting location. Confirmed by the user.
const NON_STANDARD_SETUPS = ["Suction", "Two Pressure", "Suction & Pressure"];
// A SEPARATE trigger from NON_STANDARD_RETAINED_MASS_REASON (TestType-keyed) — a
// dual-filter Setup suppresses retained mass regardless of TestType, for the same
// underlying reason as Multipass Series (can't attribute captured mass to one
// specific filter when two are in series). Confirmed by the user (2026-08-03); the
// two triggers combine (a Single-Pass test run on a dual-filter Setup shows both
// reasons) rather than one silently overriding the other.
const DUAL_FILTER_RETAINED_MASS_REASON =
  "Retained mass analysis is not valid for a dual-filter (series) Test Setup: with " +
  "two filters in series, it is not possible to determine which filter retained the contaminant.";
// Hard floor on test duration — per the user, published guidance recommends >=30
// minute tests; below 25 minutes a report is refused outright rather than generated
// against too little data to be meaningful. Own copy, per CLAUDE.md, matching every
// other standard's identical value.
const MIN_TEST_TIME_MINUTES = 25;

const TERMINATION_HEADER_SECTION = "General Test Information";
const TERMINATION_HEADER_KEY = "TerminalDP";
// Confirmed real against real files.
const DP_CHANNEL_TAG = "TS_DPress";
// CONFIRMED with the user (2026-07-30), no longer assumed: a single-filter test uses
// TS_DPress; a SERIES test uses TS_PreDPress for the PRIMARY filter and TS_FinalDPress
// for the SECONDARY. Same statement iso454812Analysis.js already had confirmed against
// two real files — this standard's own copy of that fact, not a port of it.
const DP_CHANNEL_TAG_PRIMARY = "TS_PreDPress";
const DP_CHANNEL_TAG_SECONDARY = "TS_FinalDPress";

const HEADER_CLEAN_HOUSING_DP = { section: "General Test Information", key: "CleanHousingDP" };
const HEADER_CLEAN_ASSEMBLY_DP = { section: "General Test Information", key: "CleanAssemblyDP" };
// Downstream_Sample_Flow (Qd, 13.2) is a DECLARED header setpoint, not a live channel —
// own copy of the exact fix iso19438Analysis.js's own HEADER_SAMPLE_FLOW already got
// (confirmed by the user, 2026-07-31): UpSensor/DnSensor (or aQLBU/aQLBD/aQLSU/aQLSD on
// an ExRaDs-extended file) are the flow through the particle counter's OWN sensor — the
// same quantity iso16889ControlTargets.js's Sensor Flow Rate rule checks — a much
// smaller number than the dilution SAMPLE draw rate 13.2 actually wants. The sample
// flow itself is only ever declared as Dilution System Configuration's SampleFlow
// header key (see dataFile.js's Dilution System schema note); .DAT files don't log it
// as a time-series channel at all. First occurrence only (the primary dilution stage) —
// dataFile.js's schema note documents SampleFlow repeating a second time for an ExRaDs
// extended stage, not handled here (same scope limit iso19438Analysis.js's copy has).
const HEADER_SAMPLE_FLOW = { section: "Dilution System Configuration", key: "SampleFlow" };

/** @param {DataFile} df @param {string} sensor @returns {string} */
function resolveDPChannelTag(df, sensor) {
  if (!df.midstreamFlag || df.analogTags.indexOf(DP_CHANNEL_TAG) >= 0) return DP_CHANNEL_TAG;
  return sensor === "lb" ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
}
//#endregion

//#region particle count lens — sensor selection, reporting-time clumps, beta ratios
/** @type {Record<string,{sizesProp:string,upProp:string,downProp:string,label:string}>} */
const SENSOR_CHANNELS = {
  lb: { sizesProp: "lbSizes", upProp: "lbu", downProp: "lbd", label: "LB (Light Blocking)" },
  ls: { sizesProp: "lsSizes", upProp: "lsu", downProp: "lsd", label: "LS (Light Scattering)" },
  // LBE: the one-off machine's extra LB-type sensor, midstream-only — see
  // iso454812Analysis.js's own SENSOR_CHANNELS.lbe comment for the physical reasoning
  // (LBD doubles as its "upstream" reference).
  lbe: { sizesProp: "lbeSizes", upProp: "lbd", downProp: "lbe", label: "Secondary Filter (LBE)" }
};
const DEFAULT_SENSOR = "lb";
const MIDSTREAM_SENSOR_LABELS = { lb: "Primary Filter (LB)", ls: "Secondary Filter (LS)" };

/** @param {string} key @param {DataFile} df @returns {string} */
function resolveSensorLabel(key, df) {
  const spec = SENSOR_CHANNELS[key];
  if (!spec) return "";
  return df.midstreamFlag ? (MIDSTREAM_SENSOR_LABELS[key] || spec.label) : spec.label;
}

/** Resolves which dilution-ratio analog-channel tags apply to a given sensor key,
 *  for the coincidence-limit check — own copy per standard, per CLAUDE.md,
 *  effectively an extension of SENSOR_CHANNELS above kept separate since the ratio-
 *  tag scheme depends on df.midstreamFlag, not just the sensor key alone.
 *
 *  THREE schemes, confirmed with the user (2026-08-19):
 *   - Single-sensor rig (df.repeat === 3, no LB/LS split at all): UpRatio/DnRatio,
 *     the same live channels dataFile.js's own schema note already confirms.
 *   - Plain dual-sensor ExRaDs, NOT midstream (df.midstreamFlag === false): LB reads
 *     at the primary dilution stage (aUpPrimRatio/aDnPrimRatio), LS at the
 *     cumulative extended stage (aUpExRatio/aDnExRatio) — CONFIRMED against
 *     SpinOnMP.DAT, same scheme dataFile.js's own DILUTION SYSTEM SCHEMA note
 *     already documents.
 *   - Midstream-bracketing rig (df.midstreamFlag === true): a DIFFERENT naming
 *     scheme — aUpRatio/aMidPrimRatio for LB (upstream / shared midstream point);
 *     aMidExRatio/aDnRatio for LS in the TYPICAL case (LS brackets the secondary
 *     filter — midstream point via extended dilution / true final downstream); or
 *     just aDnRatio for LBE in the RARE case (LBE brackets the secondary filter
 *     instead of LS — LBE has no "up" of its own, reuses LBD directly, per
 *     SENSOR_CHANNELS.lbe.upProp). CONFIRMED against LBLBDataOnly.DAT for the
 *     rare/LBE branch (including that aDnRatio reads 0 on that specific rig because
 *     it has no dilution capability wired to the LBE tap — a machine limitation, not
 *     a wrong channel; the 0-means-undiluted rule below handles this); the typical
 *     LS-brackets-secondary branch is per the user, no real fixture file exists yet
 *     to check it against (same CONFIRMED-vs-stated-by-the-user distinction
 *     dataFile.js already draws elsewhere).
 *  @param {DataFile} df @param {string} sensorKey "lb"|"ls"|"lbe"
 *  @returns {{upRatioTag:string|null, downRatioTag:string|null}|null} null if this
 *    sensor isn't applicable to this file's dilution shape at all */
function resolveCoincidenceChannels(df, sensorKey) {
  if (df.repeat === 3) {
    return { upRatioTag: "UpRatio", downRatioTag: "DnRatio" };
  }
  if (!df.midstreamFlag) {
    if (sensorKey === "lb") return { upRatioTag: "aUpPrimRatio", downRatioTag: "aDnPrimRatio" };
    if (sensorKey === "ls") return { upRatioTag: "aUpExRatio", downRatioTag: "aDnExRatio" };
    return null;
  }
  if (sensorKey === "lb") return { upRatioTag: "aUpRatio", downRatioTag: "aMidPrimRatio" };
  if (sensorKey === "ls") return { upRatioTag: "aMidExRatio", downRatioTag: "aDnRatio" };
  if (sensorKey === "lbe") return { upRatioTag: null, downRatioTag: "aDnRatio" };
  return null;
}

/** Machine Profile field name for a sensor+location's coincidence-limit override —
 *  matches machineProfilesStore.js's own MachineProfileRecord field names exactly,
 *  so app.js can pass its `coincidenceLimits` object straight through, no re-mapping.
 *  @param {string} sensorKey @param {"Upstream"|"Downstream"} location @returns {string} */
function coincidenceOverrideKey(sensorKey, location) {
  if (sensorKey === "lb") return location === "Upstream" ? "sensorUpstreamCoincidenceLimit" : "sensorDownstreamCoincidenceLimit";
  if (sensorKey === "ls") return location === "Upstream" ? "lsSensorUpstreamCoincidenceLimit" : "lsSensorDownstreamCoincidenceLimit";
  return "lbeSensorCoincidenceLimit";
}

const SKIP_MINUTES = 3;   // first 3 minutes of counts disregarded — matches the legacy engine's SKIP_ROWS and the standard's own 12.5 worked example
const STANDARD_BETAS = [2, 10, 75, 100, 200, 1000];   // confirmed standard-derived — matches Page 1's own filtration-ratio table targets, not a house convention
const MAX_BETA_VALUE = 100000;   // confirmed standard-derived — 13.5's own stated ceiling for the semi-log plot
//#endregion

//#region mass lens — injection flow rate, gravimetric mass balance
const HEADER_TEST_FLOWRATE = { section: "Test System Configuration", key: "Rate" };
const HEADER_INJ_FLOWRATE_SETPOINT = { section: "Injection System Configuration", key: "Rate" };
const INJ_RATE_TAG = "INJ_Rate";
// Confirmed real — same key 4548-12/19438 already read successfully for their own
// injection reservoir volume.
const HEADER_INJECTION_VOLUME = { section: "Injection System Configuration", key: "Volume" };
// Injection system's gravimetric SETPOINT — confirmed real (same key 4548-12/19438
// already read successfully), reused here as the target 12.9 checks two HAND-ENTERED
// lab samples against (this standard, unlike 4548-12/19438, treats the injection
// gravimetric level as something a lab measures and compares to setpoint, not
// something read from the header directly).
const HEADER_INJ_GRAVIMETRIC_SETPOINT = { section: "Injection System Configuration", key: "GravimetricLevel" };
// NOTE: there is no separate "BUGL setpoint" header field, and this engine no
// longer assumes one — see checkGravimetricAcceptance's own comment for why (a
// real bug, found by the user: comparing the computed Average_BUGL against a
// directly-read header value compared it against the wrong QUANTITY entirely, not
// just a wrong key guess — the rig has no independently-configured BUGL target at
// all, only an injection concentration/flow setpoint the target BUGL is implicit
// in). The 12.12 target is DERIVED from HEADER_INJ_GRAVIMETRIC_SETPOINT,
// HEADER_INJ_FLOWRATE_SETPOINT, and HEADER_TEST_FLOWRATE instead — all three
// already confirmed-real, all already read elsewhere in this file.

const INJ_FLOWRATE_TOLERANCE_PCT = 5;      // 12.11
const INJ_GRAVIMETRIC_TOLERANCE_PCT = 5;   // 12.9
const BUGL_TOLERANCE_PCT = 10;             // 12.12
//#endregion

/* =====================================================================================
   Iso16889Analysis
   ===================================================================================== */
class Iso16889Analysis {
  //#region construction / state
  constructor() {
    // ---- test type (shared; see NON_STANDARD_TEST_TYPES above) ----
    this.testType = "";
    this.nonStandardTestType = false;         // true for Single-Pass / Multipass Series
    this.retainedMassSuppressedReason = null; // set iff nonStandardTestType, for Mapper's on-page note

    // ---- test setup (shared; see NON_STANDARD_SETUPS above) ----
    this.nonStandardSetup = false;   // true for Suction/Two Pressure/Suction & Pressure — title only
    this.dualFilterSetup = false;             // true for Two Pressure / Suction & Pressure — retained-
                                               // mass suppression trigger, DISTINCT from nonStandardSetup
                                               // (title-only, which also includes plain Suction)
    this.dualFilterRetainedMassReason = null; // set iff dualFilterSetup, for Mapper's on-page note —
                                               // combines with retainedMassSuppressedReason if BOTH apply

    // ---- pressure-view selection (MidstreamFlag:false dual-filter files only; see
    // availablePressureViews/_resolveDualFilterDisplay) ----
    this.pressureView = null;      // "filter1"|"filter2"|"overall"|null
    this.overallDPSeries = null;   // Array<number|null>|null — TS_PreDPress+TS_FinalDPress summed
                                    // sample-by-sample (AnalysisMath.sumChannels), populated ONLY when
                                    // pressureView==="overall". Consumers that normally do
                                    // df.getChannel(terminationTag) must prefer this when non-null.

    // ---- sensor selection ----
    this.sensor = DEFAULT_SENSOR;
    this.sensorLabel = "";

    // ---- termination (pressure lens) ----
    this.terminationTag = "";
    this.terminationDP = null;
    this.terminationTime = null;   // seconds elapsed
    this.terminationBracket = null; // {before:{time,value}, after:{time,value}}|null — the two
                                     // measured samples terminationTime was interpolated between;
                                     // null when termination instead fell back to "last recorded
                                     // time" because the target was never reached. Audit-trail-only —
                                     // no report reads this field.
    this.terminationFilter = 1;

    // ---- clean/element ΔP (pressure lens) ----
    this.dpHousingClean = null;    // kPa, header
    this.dpAssemblyClean = null;   // kPa, header
    this.dpElementClean = null;    // kPa, computed: assembly - housing
    this.dpElementFinal = null;    // kPa, computed: terminationDP - housing

    // ---- reporting-time clumps (particle count lens) — 10 entries, always, by
    // definition (percent-of-total-time based, not duration-scaled like 4548-12/19438) ----
    this.sizes = [];
    /** @type {Array<{percent:number, startMin:number, stopMin:number, testTimeMin:number,
     *  assemblyDP:number|null, elementDP:number|null,
     *  avgUp:Array<number|null>, avgDown:Array<number|null>, avgBeta:Array<number|null>,
     *  countRows:Array<{time:number, up:Array<number|null>, down:Array<number|null>}>}>}
     *  countRows: one entry per data row actually in this clump's rounded count window
     *  (same [startRow,endRow] avgUp/avgDown/avgBeta are summed over), each carrying
     *  every size's raw up/down reading for that row — the actual per-cycle inputs
     *  behind avgUp/avgDown/avgBeta, not just their aggregate. A row where a given
     *  size's up or down is null was NOT included in that size's sum (same null-pair
     *  skip avgUp/avgBeta's own loop already applies) — shown anyway so the audit
     *  trail can display the full window, not a size-filtered subset of it.
     *  Audit-trail-only (see iso16889AuditSteps.js's hover tooltips) — no report page
     *  reads this field. No injectedMassG field — see _computeReportingTimeClumps's
     *  own comment for where that value actually gets computed (app.js, not here). */
    this.clumps = [];
    this.overallUpstreamAverage = [];    // one per size — mean of the 10 clumps' avgUp
    this.overallDownstreamAverage = [];  // one per size — mean of the 10 clumps' avgDown
    this.overallAverageBeta = [];        // one per size — overallUpstreamAverage / overallDownstreamAverage
    this.sizeAtBeta = {};                // { "2": "4.2", "10": "<4.0", ... }

    // Initial system cleanliness — upstream-only counts from the LAST MINUTE OF
    // FLUSHING BEFORE the test/dust injection begins, i.e. NOT part of the 10
    // reporting-time clumps above (all of which start well after this, post-
    // SKIP_MINUTES). See _computeInitialCleanliness for where this actually comes
    // from (a .DAT aux block, confirmed against real files 2026-08-06) — stays
    // all-null here whenever that block is missing or belongs to the other sensor.
    this.initialUpstream = [];   // one per size, same sizes/order as this.sizes

    // ---- mass lens: what's computable at run() time (no hand-entry needed) —
    // Ave_Injection_Flow (Qia) is a live channel average, same treatment 4548-12/
    // 19438 give Qia. Downstream_Sample_Flow (Qd) is a DECLARED header setpoint, not
    // a live channel — see HEADER_SAMPLE_FLOW's own comment for why (own copy of the
    // fix iso19438Analysis.js's Qd already got).
    // Ave_Injection_GravLevel / Test_Final_Grav / Dust_Injected / Dust_Retained /
    // Average_BUGL are NOT here — they need hand-entered gravimetric lab results,
    // computed instead by the static computeMassBalance/checkAcceptanceCriteria
    // methods below, called from app.js once those values exist (same pattern
    // 4548-12/19438 already use for their own Non-Retained Mass). ----
    this.qia = null;              // mL/min — Ave_Injection_Flow, live INJ_Rate channel average
    this.qd = null;               // mL/min — Downstream_Sample_Flow, header SampleFlow setpoint (downstream value)
    this.testFlowSetpoint = null; // L/min — Test_Flow_Setpoint header, needed by 12.12's Average_BUGL denominator
    // Both read at run() time (headers, no hand-entry needed) and exposed here so
    // app.js's recompute-on-gravimetric-entry hook can pass them into
    // checkGravimetricAcceptance without app.js needing to know these header
    // locations itself — that knowledge stays inside this standard's own engine.
    this.injectionGravSetpoint = null;    // mg/L — 12.9's per-sample comparison target
    this.injectionFlowSetpoint = null;    // mL/min — Injection System Configuration's own Rate setpoint, needed (with injectionGravSetpoint/testFlowSetpoint) to DERIVE 12.12's target Average_BUGL — see checkGravimetricAcceptance
    // The DESIGN-TARGET Average_BUGL itself (12.12's formula run against setpoints
    // instead of measured averages — see checkGravimetricAcceptance's own comment
    // for the full story) — needs only the three setpoints above, all available at
    // run() time with no hand-entry dependency, unlike the ACTUAL Average_BUGL
    // (which needs a measured Gia average and IS gravimetric-dependent, computed
    // instead by app.js's recomputeIso16889GravimetricDerived). Displayed directly
    // on Page 1 as "Base upstream gravimetric level, cb" — see iso16889Mapper.js.
    this.buglTarget = null;               // mg/L

    // Injection reservoir volume — Initial is a direct header read; Final is
    // COMPUTED, not a second header value (there isn't one) and not defaulted equal
    // to Initial (unlike Test System's own Vf, which has no better source and
    // legitimately does default that way) — the injection sink actually drains at
    // Qia over the test, so Final = Initial - (Qia x T). Per the user's own worked
    // example: 74 L initial, 250 mL/min for 60 min -> drains 15 L -> 59 L final.
    this.injVolumeInitial = null;   // L
    this.injVolumeFinal = null;     // L — computed, still data-editable in the report (a real measurement can override it)

    this.errors = [];
    this.warnings = [];
  }
  //#endregion

  //#region public API
  /** @param {DataFile} df @param {{sensor?:string, coincidenceLimits?:Record<string,number>}} [options] @returns {Iso16889Analysis} */
  static run(df, options) {
    const analysis = new Iso16889Analysis();
    analysis.sensor = (options && SENSOR_CHANNELS[options.sensor]) ? options.sensor : DEFAULT_SENSOR;
    if (df.midstreamFlag) analysis.sensorLabel = resolveSensorLabel(analysis.sensor, df);

    // Same validate-and-fall-back-to-first pattern `sensor` uses against
    // availableSensors — only meaningful for a MidstreamFlag:false dual-filter Setup
    // file; availablePressureViews returns [] otherwise, leaving pressureView null.
    const views = Iso16889Analysis.availablePressureViews(df);
    analysis.pressureView = (options && options.pressureView && views.some((v) => v.key === options.pressureView))
      ? options.pressureView
      : (views[0] ? views[0].key : null);

    if (!analysis._validateTestType(df)) return analysis;
    if (!analysis._determineTermination(df)) return analysis;   // pressure lens
    analysis._readCleanBaselines(df);                            // pressure lens

    const termination = {
      terminationTime: analysis.terminationTime,
      terminationTag: analysis.terminationTag,
      overallDPSeries: analysis.overallDPSeries
    };
    analysis._computeReportingTimeClumps(df, termination);        // particle count lens
    analysis._computeOverallAverages();                           // particle count lens
    analysis._computeSizeAtBeta();                                // particle count lens
    analysis._computeInitialCleanliness(df);                      // particle count lens
    analysis._checkCoincidenceLimit(df, options && options.coincidenceLimits);   // particle count lens

    analysis._computeInjectionFlowRate(df, termination.terminationTime);   // mass lens
    analysis._computeDownstreamSampleFlow(df);                             // mass lens

    return analysis;
  }

  // Cheap pre-run check, driven by the sidebar to decide which standard buttons stay
  // enabled once a file is loaded — own copy per standard (see CLAUDE.md's no-shared-
  // procedures rule), each just reading its own already-private VALID_TEST_TYPES.
  /** @param {DataFile} df @returns {boolean} */
  static isCompatible(df) {
    return VALID_TEST_TYPES.indexOf(df.testType) >= 0;
  }

  get ok() {
    return this.errors.length === 0;
  }
  //#endregion

  //#region validation
  _validateTestType(df) {
    const testType = df.testType;
    if (Object.prototype.hasOwnProperty.call(REJECTED_TEST_TYPES, testType)) {
      this.errors.push(REJECTED_TEST_TYPES[testType]);
      return false;
    }
    if (VALID_TEST_TYPES.indexOf(testType) < 0) {
      this.errors.push("Unknown test type: '" + testType + "'. Cannot determine ISO 16889 compatibility.");
      return false;
    }

    // Set before the particle-data check below, not after — a file that's valid on
    // test type but fails on missing particle data should still report the CORRECT
    // test type classification (title/retained-mass note), not silently fall back to
    // "" / standard as if this check never ran.
    this.testType = testType;
    this.nonStandardTestType = NON_STANDARD_TEST_TYPES.indexOf(testType) >= 0;
    if (this.nonStandardTestType) {
      this.retainedMassSuppressedReason = NON_STANDARD_RETAINED_MASS_REASON[testType];
      this.warnings.push(this.retainedMassSuppressedReason);
    }

    const spec = SENSOR_CHANNELS[this.sensor];
    if (!df[spec.sizesProp] || df[spec.sizesProp].length === 0) {
      this.errors.push("No " + spec.label + " particle size data found in this file.");
      return false;
    }
    return true;
  }
  //#endregion

  //#region pressure lens — channels, termination, clean/element ΔP
  _determineTermination(df) {
    const isDualFilterSetup = DUAL_FILTER_SETUPS.indexOf(df.testSetup) >= 0;
    if (!isDualFilterSetup && !df.midstreamFlag && SINGLE_FILTER_SETUPS.indexOf(df.testSetup) < 0) {
      this.errors.push(
        "Test Setup '" + df.testSetup + "' requires the dual-filter analysis path, " +
        "which is not implemented yet. Supported: " + SINGLE_FILTER_SETUPS.join(", ") + ".");
      return false;
    }
    this.nonStandardSetup = NON_STANDARD_SETUPS.indexOf(df.testSetup) >= 0;
    this.dualFilterSetup = isDualFilterSetup;

    if (isDualFilterSetup) {
      // Set BEFORE any possible early-return inside the dual-filter path below,
      // same "classify first, validate after" pattern _validateTestType's
      // nonStandardTestType already uses.
      this.dualFilterRetainedMassReason = DUAL_FILTER_RETAINED_MASS_REASON;
      this.warnings.push(this.dualFilterRetainedMassReason);
      return this._determineDualFilterTermination(df);
    }

    // ---- single-filter path — UNCHANGED below this point ----
    const terminalDP = toNumber(df.getHeaderValue(TERMINATION_HEADER_SECTION, TERMINATION_HEADER_KEY));
    if (terminalDP === null || terminalDP <= 0) {
      this.errors.push("Terminal DP setpoint not found or invalid for Test Setup '" + df.testSetup + "'.");
      return false;
    }

    const dpChannelTag = resolveDPChannelTag(df, this.sensor);
    if (df.analogTags.indexOf(dpChannelTag) < 0) {
      this.errors.push("Required pressure channel " + dpChannelTag + " not found in analog data.");
      return false;
    }

    this.terminationTag = dpChannelTag;
    this.terminationDP = terminalDP;
    this.terminationFilter = 1;

    const dpData = df.getChannel(dpChannelTag);
    const times = df.times;
    if (!dpData || !times || dpData.length === 0) {
      this.errors.push("Pressure or time data unavailable; cannot determine termination time.");
      return false;
    }

    const crossing = findCrossingBracket(terminalDP, dpData, times);
    if (crossing === null) {
      this.warnings.push(
        dpChannelTag + " never reached the terminal DP setpoint of " + terminalDP +
        "; using the last recorded time (" + formatElapsed(times[times.length - 1]) + ") instead.");
      this.terminationTime = times[times.length - 1];
    } else {
      this.terminationTime = crossing.crossingTime;
      this.terminationBracket = { before: crossing.before, after: crossing.after };
    }

    if (this.terminationTime === null || this.terminationTime <= 0) {
      this.errors.push("Unable to determine a valid test termination time.");
      return false;
    }

    if (this.terminationTime < MIN_TEST_TIME_MINUTES * 60) {
      this.errors.push(
        "Test duration (" + formatElapsed(this.terminationTime) + ") is under the " +
        MIN_TEST_TIME_MINUTES + "-minute minimum required to generate a report.");
      return false;
    }

    return true;
  }

  /* ---- Dual-filter (series) termination — "Two Pressure"/"Suction & Pressure".
     Own copy of iso19438Analysis.js's identical-purpose method — see that file's own
     extensive comment for the full rationale (header generation detection, -1
     sentinel, overall = TS_PreDPress+TS_FinalDPress, earliest-crossing-wins); not
     repeated here since the mechanism is independently re-derived in THIS file, per
     CLAUDE.md, it just happens to land on the same design (same control program). ---- */
  _determineDualFilterTermination(df) {
    if (df.analogTags.indexOf(DP_CHANNEL_TAG_PRIMARY) < 0 || df.analogTags.indexOf(DP_CHANNEL_TAG_SECONDARY) < 0) {
      this.errors.push(
        "Required pressure channels " + DP_CHANNEL_TAG_PRIMARY + "/" + DP_CHANNEL_TAG_SECONDARY +
        " not found in analog data.");
      return false;
    }

    const times = df.times;
    const primaryData = df.getChannel(DP_CHANNEL_TAG_PRIMARY);
    const secondaryData = df.getChannel(DP_CHANNEL_TAG_SECONDARY);
    if (!primaryData || !secondaryData || !times || primaryData.length === 0) {
      this.errors.push("Pressure or time data unavailable; cannot determine termination time.");
      return false;
    }

    const terminalDPValues = df.getHeaderValues(TERMINATION_HEADER_SECTION, TERMINATION_HEADER_KEY);
    if (!terminalDPValues || terminalDPValues.length === 0) {
      this.errors.push("Terminal DP setpoint not found for Test Setup '" + df.testSetup + "'.");
      return false;
    }

    let overallTarget = null, filter1Target = null, filter2Target = null;
    if (terminalDPValues.length === 1) {
      overallTarget = toNumber(terminalDPValues[0]);
    } else if (terminalDPValues.length === 2) {
      filter1Target = toNumber(terminalDPValues[0]);
      filter2Target = toNumber(terminalDPValues[1]);
    } else {
      overallTarget = toNumber(terminalDPValues[0]);
      filter1Target = toNumber(terminalDPValues[1]);
      filter2Target = toNumber(terminalDPValues[2]);
    }

    const isActive = (v) => v !== null && v > 0;

    const candidates = [];
    if (isActive(overallTarget)) candidates.push({ id: "overall", target: overallTarget, series: sumChannels(primaryData, secondaryData) });
    if (isActive(filter1Target)) candidates.push({ id: "filter1", target: filter1Target, series: primaryData });
    if (isActive(filter2Target)) candidates.push({ id: "filter2", target: filter2Target, series: secondaryData });

    if (candidates.length === 0) {
      this.errors.push(
        "No active Terminal DP target found for Test Setup '" + df.testSetup + "' (TerminalDP: " +
        terminalDPValues.join(", ") + ").");
      return false;
    }

    let winner = null;
    for (const candidate of candidates) {
      candidate.crossing = findCrossingBracket(candidate.target, candidate.series, times);
      if (candidate.crossing !== null && (winner === null || candidate.crossing.crossingTime < winner.crossing.crossingTime)) winner = candidate;
    }

    if (winner === null) {
      const lastTime = times[times.length - 1];
      this.warnings.push(
        "None of the active Terminal DP target(s) (" +
        candidates.map((c) => c.id + ": " + c.target).join(", ") +
        ") were ever reached; using the last recorded time (" + formatElapsed(lastTime) + ") instead.");
      this.terminationTime = lastTime;
    } else {
      this.terminationTime = winner.crossing.crossingTime;
      this.terminationBracket = { before: winner.crossing.before, after: winner.crossing.after };
    }

    if (this.terminationTime === null || this.terminationTime <= 0) {
      this.errors.push("Unable to determine a valid test termination time.");
      return false;
    }
    if (this.terminationTime < MIN_TEST_TIME_MINUTES * 60) {
      this.errors.push(
        "Test duration (" + formatElapsed(this.terminationTime) + ") is under the " +
        MIN_TEST_TIME_MINUTES + "-minute minimum required to generate a report.");
      return false;
    }

    this.terminationFilter = 1;   // dead field, unchanged — no consumer anywhere
    this._resolveDualFilterDisplay(df, { overallTarget, filter1Target, filter2Target });
    return true;
  }

  /** Resolves terminationTag/terminationDP (and, for the "Overall" view only,
   *  overallDPSeries) — purely a DISPLAY concern, resolved AFTER termination TIME is
   *  already known, independent of which target actually ended the test.
   *  @param {DataFile} df @param {{overallTarget:number|null, filter1Target:number|null, filter2Target:number|null}} targets */
  _resolveDualFilterDisplay(df, targets) {
    const { overallTarget, filter1Target, filter2Target } = targets;

    if (df.midstreamFlag) {
      const isFilter1 = this.sensor === "lb";
      this.terminationTag = isFilter1 ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
      const perFilterTarget = isFilter1 ? filter1Target : filter2Target;
      if (perFilterTarget !== null && perFilterTarget > 0) {
        this.terminationDP = perFilterTarget;
      } else if (overallTarget !== null && overallTarget > 0) {
        // No independent per-filter target exists for this generation — fall back
        // to the shared overall target rather than leaving element-ΔP/chart
        // display blank. Confirmed by the user (2026-08-03).
        this.terminationDP = overallTarget;
      } else {
        this.terminationDP = null;
        this.warnings.push(
          "No Terminal DP target is configured for the " + (isFilter1 ? "Primary" : "Secondary") +
          " Filter (or an overall target) in this file's header — element ΔP and the DP-vs-time " +
          "chart's target line cannot be shown for this filter view.");
      }
      return;
    }

    // MidstreamFlag: false — pressureView (validated against availablePressureViews
    // in run()) drives display instead — no filter-identity sensor toggle in this
    // case (LB/LS here is measurement technology viewing the whole assembly, not
    // filter identity).
    if (this.pressureView === "overall") {
      this.terminationTag = "";
      this.terminationDP = overallTarget;
      this.overallDPSeries = sumChannels(df.getChannel(DP_CHANNEL_TAG_PRIMARY), df.getChannel(DP_CHANNEL_TAG_SECONDARY));
    } else if (this.pressureView === "filter2") {
      this.terminationTag = DP_CHANNEL_TAG_SECONDARY;
      this.terminationDP = filter2Target;
    } else {
      this.terminationTag = DP_CHANNEL_TAG_PRIMARY;
      this.terminationDP = filter1Target;
    }
  }

  /** Which pressure views a MidstreamFlag:false dual-filter Setup file supports,
   *  given its TerminalDP header generation.
   *  @param {DataFile} df @returns {Array<{key:string,label:string}>} */
  static availablePressureViews(df) {
    if (df.midstreamFlag) return [];
    if (!df.testSetup || DUAL_FILTER_SETUPS.indexOf(df.testSetup) < 0) return [];
    if (df.analogTags.indexOf(DP_CHANNEL_TAG_PRIMARY) < 0 || df.analogTags.indexOf(DP_CHANNEL_TAG_SECONDARY) < 0) return [];

    const terminalDPValues = df.getHeaderValues(TERMINATION_HEADER_SECTION, TERMINATION_HEADER_KEY);
    if (!terminalDPValues) return [];
    const isActive = (v) => { const n = toNumber(v); return n !== null && n > 0; };

    const views = [];
    if (terminalDPValues.length === 1) {
      if (isActive(terminalDPValues[0])) views.push({ key: "overall", label: "Overall (Filter 1 + Filter 2)" });
    } else if (terminalDPValues.length === 2) {
      if (isActive(terminalDPValues[0])) views.push({ key: "filter1", label: "Filter 1 (Prefilter)" });
      if (isActive(terminalDPValues[1])) views.push({ key: "filter2", label: "Filter 2 (Final Filter)" });
    } else if (terminalDPValues.length >= 3) {
      if (isActive(terminalDPValues[0])) views.push({ key: "overall", label: "Overall (Filter 1 + Filter 2)" });
      if (isActive(terminalDPValues[1])) views.push({ key: "filter1", label: "Filter 1 (Prefilter)" });
      if (isActive(terminalDPValues[2])) views.push({ key: "filter2", label: "Filter 2 (Final Filter)" });
    }
    return views;
  }

  /* ---- Filter housing / clean assembly ΔP (headers), plus the two COMPUTED element
     ΔP readings the report displays alongside them: Clean element = clean assembly -
     housing; Final element = termination DP - housing (12.3's element-DP formula,
     applied once to the clean baseline and once to the terminal reading). ---- */
  _readCleanBaselines(df) {
    this.dpHousingClean = toNumber(df.getHeaderValue(HEADER_CLEAN_HOUSING_DP.section, HEADER_CLEAN_HOUSING_DP.key));
    this.dpAssemblyClean = toNumber(df.getHeaderValue(HEADER_CLEAN_ASSEMBLY_DP.section, HEADER_CLEAN_ASSEMBLY_DP.key));
    if (this.dpHousingClean === null) {
      this.warnings.push("Filter housing ΔP not found in header; element ΔP readings cannot be computed.");
      return;
    }
    if (this.dpAssemblyClean !== null) {
      this.dpElementClean = this.dpAssemblyClean - this.dpHousingClean;
    }
    if (this.terminationDP !== null) {
      this.dpElementFinal = this.terminationDP - this.dpHousingClean;
    }
  }
  //#endregion

  //#region particle count lens — sensor selection, reporting-time clumps, beta ratios
  /** @param {DataFile} df @returns {Array<{key:string,label:string}>} */
  static availableSensors(df) {
    return Object.entries(SENSOR_CHANNELS)
      .filter(([, spec]) => df[spec.sizesProp] && df[spec.sizesProp].length > 0)
      .map(([key]) => ({ key, label: resolveSensorLabel(key, df) }));
  }

  /* ---- The 10 reporting-time clumps (12.1-12.6) — see the file-top note for the
     formula and its verification against the standard's own 86-minute worked example.
     TWO DISTINCT time references per clump, not one: 12.1/12.2 define the reporting
     time itself as the EXACT (unrounded) k/10 fraction of termination time — that's
     what assembly ΔP gets interpolated at (a continuous analog signal, no rounding
     reason to round it) and what's DISPLAYED as "Test time min." 12.5's whole-minute
     rounding (startMin/stopMin) applies ONLY to the particle-COUNT averaging window,
     since counts are recorded per-minute-cycle and can't be averaged over a
     fractional minute — confirmed by the worked example's own table being titled
     specifically for the count-clumping windows, not the ΔP readings. Conflating the
     two (interpolating ΔP at the rounded stop-minute instead of the exact reporting
     time) was an earlier mistake here, caught before shipping. The rounded count
     window is also NOT further clamped to the exact termination instant (a second,
     related mistake, also caught and fixed — see the stopSec comment below): the
     final clump's window rounds UP specifically so it captures the last, necessarily
     PARTIAL count cycle — the one DURING which termination was actually detected —
     not just whatever cycles happened to complete before that instant.
     Each clump gets: its rounded count-window start/stop minute, the exact reporting
     time, the interpolated assembly ΔP AT that exact time (12.2 — for k=10/100%,
     this naturally lands on/at the actual final reading since reportingTimeMin[10]
     === terminationMinutes exactly, no special case needed), the resulting element
     ΔP (12.3), and per-size average up/down counts + beta ratio over the rounded
     count window (12.5-12.6). injectedMassG is left null here — Mass_Injected_
     By_Analog_Time (13.4) needs Ave_Injection_GravLevel, which this engine only
     ever has as a run()-time header FALLBACK (injectionGravSetpoint, below), never
     the live store-resolved value a hand-entered override would win with — filled
     in instead by app.js's recomputeIso16889GravimetricDerived, which has both the
     current resolved average AND this array (currentAnalysis.clumps) available,
     every time it runs (initial load and after a real gravimetric entry alike). ---- */
  _computeReportingTimeClumps(df, termination) {
    const { terminationTime, terminationTag, overallDPSeries } = termination;
    const spec = SENSOR_CHANNELS[this.sensor];
    this.sizes = df[spec.sizesProp];
    const sizeCount = this.sizes.length;

    const terminationMinutes = terminationTime / 60;
    const dpChannel = overallDPSeries || df.getChannel(terminationTag);
    const upRows = df[spec.upProp];
    const downRows = df[spec.downProp];

    let previousStopMin = SKIP_MINUTES;   // clump 1's count window starts the minute right after the disregard period

    for (let k = 1; k <= 10; k++) {
      const percent = k * 10;
      const reportingTimeMin = (k / 10) * terminationMinutes;   // exact — 12.1/12.2
      const reportingTimeSec = Math.min(reportingTimeMin * 60, terminationTime);
      const stopMin = Math.ceil(reportingTimeMin);              // rounded — 12.5 count window only
      const startMin = previousStopMin + 1;
      previousStopMin = stopMin;

      const assemblyDP = dpChannel ? interpolateAt(reportingTimeSec, df.times, dpChannel) : null;
      const elementDP = (assemblyDP !== null && this.dpHousingClean !== null) ? assemblyDP - this.dpHousingClean : null;

      // NOT clamped to terminationTime — stopMin is already rounded UP specifically to
      // capture the final, necessarily-PARTIAL count cycle (a real test essentially
      // never ends exactly on a whole minute; the standard makes no recommendation
      // privileging whole minutes over partial ones). Clamping back down to the exact
      // sub-minute termination instant here would undo that rounding and throw away
      // precisely the cycle DURING which termination was detected — the control
      // system keeps counting and stops as fast as it can AFTER the crossing, so that
      // trailing partial cycle's counts are the real, legitimate measurement of the
      // termination moment, not stale data collected past a meaningful end point.
      // Corrected per the user (2026-08-11), caught reviewing a real file
      // (TwinFSRig-ROTest9-MP.DAT) whose termination fell mid-cycle, as it almost
      // always will. findRowRange naturally can't return rows past whatever's actually
      // in df.times, so stopMin*60 alone is always a safe (if occasionally generous)
      // upper bound — no risk of reaching into data that was never logged.
      const stopSec = stopMin * 60;
      const [startRow, endRow] = findRowRange(df.times, startMin * 60, stopSec);
      const avgUp = new Array(sizeCount).fill(null);
      const avgDown = new Array(sizeCount).fill(null);
      const avgBeta = new Array(sizeCount).fill(null);
      const countRows = [];

      if (startRow !== null && endRow !== null && endRow >= startRow) {
        for (let sizeIndex = 0; sizeIndex < sizeCount; sizeIndex++) {
          let sumUp = 0, sumDown = 0, n = 0;
          for (let row = startRow; row <= endRow; row++) {
            const up = toNumber(upRows[row][sizeIndex]);
            const down = toNumber(downRows[row][sizeIndex]);
            if (up !== null && down !== null) { sumUp += up; sumDown += down; n++; }
          }
          if (n > 0) {
            avgUp[sizeIndex] = sumUp / n;
            avgDown[sizeIndex] = sumDown / n;
            avgBeta[sizeIndex] = (sumDown > 0) ? Math.min(sumUp / sumDown, MAX_BETA_VALUE) : MAX_BETA_VALUE;
          }
        }
        // Raw per-row breakdown, audit-trail-only — see this.clumps' own JSDoc.
        // Same [startRow,endRow] window as the sums above, captured in a second,
        // trivial pass rather than folded into the per-size loop so the actual
        // sum/avg/beta computation above stays byte-for-byte what it already was.
        for (let row = startRow; row <= endRow; row++) {
          countRows.push({
            time: df.times[row],
            up: upRows[row].map((v) => toNumber(v)),
            down: downRows[row].map((v) => toNumber(v))
          });
        }
      }

      this.clumps.push({ percent, startMin, stopMin, testTimeMin: reportingTimeMin, assemblyDP, elementDP, avgUp, avgDown, avgBeta, countRows });
    }
  }

  /* ---- 12.7-12.8: Overall_Upstream_Average / Overall_Downstream_Average are the
     MEAN OF THE 10 CLUMPS' OWN AVERAGES per size (not re-derived from raw records),
     then Overall_Average_BetaRatio = their ratio. ---- */
  _computeOverallAverages() {
    const sizeCount = this.sizes.length;
    this.overallUpstreamAverage = new Array(sizeCount).fill(null);
    this.overallDownstreamAverage = new Array(sizeCount).fill(null);
    this.overallAverageBeta = new Array(sizeCount).fill(null);

    for (let sizeIndex = 0; sizeIndex < sizeCount; sizeIndex++) {
      let sumUp = 0, sumDown = 0, n = 0;
      for (const clump of this.clumps) {
        if (clump.avgUp[sizeIndex] !== null && clump.avgDown[sizeIndex] !== null) {
          sumUp += clump.avgUp[sizeIndex];
          sumDown += clump.avgDown[sizeIndex];
          n++;
        }
      }
      if (n > 0) {
        const overallUp = sumUp / n;
        const overallDown = sumDown / n;
        this.overallUpstreamAverage[sizeIndex] = overallUp;
        this.overallDownstreamAverage[sizeIndex] = overallDown;
        this.overallAverageBeta[sizeIndex] = (overallDown > 0) ? Math.min(overallUp / overallDown, MAX_BETA_VALUE) : MAX_BETA_VALUE;
      }
    }
  }

  /* ---- Initial system cleanliness: an upstream-only per-size particle count taken
     during the last minute of flushing BEFORE dust injection begins — confirmed
     against real files, 2026-08-06 (per the user): the .DAT format carries this as
     a generic NAME_DATA/NAME_ENDDATA auxiliary block (dataFile.js already parses
     these into df.aux without interpreting them — this is where the INTERPRETATION
     lives, per CLAUDE.md's per-standard-procedure rule), positioned between
     ENDHEADER and DATA. Two real naming conventions seen:
       - older/single-sensor rigs: bare "INITIAL_UPCOUNT" (no sensor tag) — e.g.
         TwinFSRig-ROTest9-MP.DAT, which has no LSSizes header at all, so there's
         only ever one sensor this could mean.
       - newer/dual-sensor rigs: "INITIAL_LB_UPCOUNT" or "INITIAL_LS_UPCOUNT",
         explicitly tagging which sensor recorded it — e.g. SpinOnMP.DAT (has
         LSSizes) tags its block INITIAL_LS_UPCOUNT.
     Per the user: an untagged block is ONLY ever the file's one unambiguous sensor
     (confirmed — it never co-occurs with LSSizes in any sample file) and must NOT
     be read as LS data just because the report happens to be viewing the LS
     sensor — only an EXPLICIT _LS_ tag qualifies for an LS report, and likewise
     only an untagged or explicit _LB_ tag qualifies for an LB report. this.sensor
     must already be set (by run(), before this call) for that match to work.
     Genuinely missing (no block, or it belongs to the other sensor) leaves
     initialUpstream all-null — reportView.js renders that as blank, not a
     fabricated value, same convention as every other not-yet-available cell on
     this page. ---- */
  _computeInitialCleanliness(df) {
    const sizeCount = this.sizes.length;
    this.initialUpstream = new Array(sizeCount).fill(null);

    const block = (df.aux || []).find((a) => {
      const match = /^INITIAL_(?:(LB|LS)_)?UPCOUNT$/.exec(a.name);
      if (!match) return false;
      const taggedSensor = match[1] ? match[1].toLowerCase() : "lb";
      return taggedSensor === this.sensor;
    });
    if (!block || block.rows.length === 0) return;

    const values = block.rows[0].map(toNumber);
    for (let i = 0; i < sizeCount && i < values.length; i++) {
      this.initialUpstream[i] = values[i];
    }
  }

  /** Warns if the currently-selected sensor's smallest-size counts, divided by the
   *  ACTUAL per-record dilution ratio, exceed its coincidence limit (ISO 11171) at
   *  any point in the test — see coincidenceLimitCheck.js for the shared math and
   *  resolveCoincidenceChannels above for the channel resolution. Only checks the
   *  CURRENTLY SELECTED sensor (this.sensor), not every sensor present in the file
   *  — per the user, 2026-08-19. `coincidenceLimits` (optional) is a Machine
   *  Profile's own empirically-found override, keyed exactly like
   *  MachineProfileRecord's own fields.
   *  @param {DataFile} df @param {Record<string,number>} [coincidenceLimits] */
  _checkCoincidenceLimit(df, coincidenceLimits) {
    const spec = SENSOR_CHANNELS[this.sensor];
    const channels = resolveCoincidenceChannels(df, this.sensor);
    if (!spec || !channels) return;

    const defaultLimit = this.sensor === "ls" ? DEFAULT_LS_COINCIDENCE_LIMIT : DEFAULT_LB_COINCIDENCE_LIMIT;
    const locations = [
      { label: "Upstream", countProp: spec.upProp, ratioTag: channels.upRatioTag },
      { label: "Downstream", countProp: spec.downProp, ratioTag: channels.downRatioTag }
    ];
    for (const loc of locations) {
      if (!loc.ratioTag) continue;
      const rows = df[loc.countProp];
      if (!rows || rows.length === 0) continue;
      const rawCounts = rows.map((row) => toNumber(row[0]));   // smallest measured size
      const ratioValues = df.getChannel(loc.ratioTag);
      const overrideKey = coincidenceOverrideKey(this.sensor, loc.label);
      const limit = (coincidenceLimits && coincidenceLimits[overrideKey]) || defaultLimit;
      const result = checkCoincidenceLimit(df.times, rawCounts, ratioValues, limit);
      if (result.exceeded) {
        this.warnings.push(spec.label + " " + loc.label + " sensor exceeded its coincidence limit (" +
          limit.toLocaleString() + " counts/mL at the sensor) during: " + formatMinuteRanges(result.offendingMinuteRanges) +
          " (peak " + Math.round(result.peakSensorCount).toLocaleString() + " counts/mL).");
      }
    }
  }

  /* ---- 13.6: Size_At_Beta_x — see the file-top note for why this is log-linear,
     not a port of the legacy engine's plain-linear version. Same bracket/clamp/
     nearest-fallback SHAPE as the legacy engine's _sizeGivenBeta and
     iso454812Analysis.js's _sizeGivenEfficiency (own copy, per CLAUDE.md) — only the
     actual interpolation step differs. ---- */
  _computeSizeAtBeta() {
    for (const targetBeta of STANDARD_BETAS) {
      this.sizeAtBeta[String(targetBeta)] = Iso16889Analysis._sizeGivenBeta(targetBeta, this.sizes, this.overallAverageBeta);
    }
  }

  static _sizeGivenBeta(targetBeta, sizes, avgBeta) {
    return Iso16889Analysis.sizeGivenBetaDetail(targetBeta, sizes, avgBeta).result;
  }

  /** Same interpolation as _sizeGivenBeta, but returns the FULL derivation detail
   *  (which two measured points a result was actually interpolated between, or why
   *  not) instead of just the formatted result string — for the Audit Trail view
   *  (iso16889AuditSteps.js) specifically. Not underscore-prefixed like the other
   *  internal statics here — this one IS meant to be called from outside the
   *  class. _sizeGivenBeta above now just delegates here, so there's exactly one
   *  implementation of this interpolation, not two kept in sync by hand.
   *  @param {number} targetBeta @param {Array<string|number>} sizes @param {Array<number|null>} avgBeta
   *  @returns {{result:string, mode:"interpolated"|"below-range"|"above-range"|"no-data",
   *    bracket:{lowerSize:number,lowerBeta:number,upperSize:number,upperBeta:number}|null, note?:string}} */
  static sizeGivenBetaDetail(targetBeta, sizes, avgBeta) {
    let firstValid = -1, lastValid = -1;
    for (let i = 0; i < avgBeta.length; i++) {
      if (avgBeta[i] !== null && avgBeta[i] > 0) {
        if (firstValid < 0) firstValid = i;
        lastValid = i;
      }
    }
    if (firstValid < 0) return { result: "", mode: "no-data", bracket: null };

    let minBeta = Infinity, maxBeta = 0;
    for (let i = firstValid; i <= lastValid; i++) {
      if (avgBeta[i] !== null && avgBeta[i] > 0) {
        if (avgBeta[i] < minBeta) minBeta = avgBeta[i];
        if (avgBeta[i] > maxBeta) maxBeta = avgBeta[i];
      }
    }

    // 13.6's own caveat: when the target can't be bracketed by measured data, report
    // which bound it falls outside of rather than guessing.
    if (targetBeta < minBeta) return { result: "<" + Number(sizes[firstValid]).toFixed(1), mode: "below-range", bracket: null };
    if (targetBeta > maxBeta) return { result: ">" + Number(sizes[lastValid]).toFixed(1), mode: "above-range", bracket: null };

    // Adjacent-size bracket first — log-linear: linear in size, logarithmic in beta.
    for (let i = firstValid; i < lastValid; i++) {
      if (avgBeta[i] !== null && avgBeta[i] > 0 && avgBeta[i + 1] !== null && avgBeta[i + 1] > 0) {
        const between = (avgBeta[i] <= targetBeta && avgBeta[i + 1] >= targetBeta) ||
                         (avgBeta[i] >= targetBeta && avgBeta[i + 1] <= targetBeta);
        if (between) {
          const size = logLinearInterpolateSize(targetBeta, avgBeta[i], Number(sizes[i]), avgBeta[i + 1], Number(sizes[i + 1]));
          return {
            result: size.toFixed(1), mode: "interpolated",
            bracket: { lowerSize: Number(sizes[i]), lowerBeta: avgBeta[i], upperSize: Number(sizes[i + 1]), upperBeta: avgBeta[i + 1] }
          };
        }
      }
    }

    // Fallback: nearest non-adjacent bracket (handles gaps in the beta progression).
    let lowerIdx = -1, higherIdx = -1, lowerBeta = 0, higherBeta = Infinity;
    for (let i = firstValid; i <= lastValid; i++) {
      if (avgBeta[i] === null || avgBeta[i] <= 0) continue;
      if (avgBeta[i] < targetBeta && avgBeta[i] > lowerBeta) { lowerBeta = avgBeta[i]; lowerIdx = i; }
      if (avgBeta[i] > targetBeta && avgBeta[i] < higherBeta) { higherBeta = avgBeta[i]; higherIdx = i; }
    }
    if (lowerIdx >= 0 && higherIdx >= 0) {
      const size = logLinearInterpolateSize(targetBeta, lowerBeta, Number(sizes[lowerIdx]), higherBeta, Number(sizes[higherIdx]));
      return {
        result: size.toFixed(1), mode: "interpolated",
        bracket: { lowerSize: Number(sizes[lowerIdx]), lowerBeta, upperSize: Number(sizes[higherIdx]), upperBeta: higherBeta },
        note: "gap in the beta progression — nearest non-adjacent measured points used, not the immediately adjacent sizes"
      };
    }

    return { result: "", mode: "no-data", bracket: null };
  }
  //#endregion

  //#region mass lens — injection flow rate, gravimetric mass balance
  /* ---- 12.11: Ave_Injection_Flow — live INJ_Rate channel average (same confirmed
     method 4548-12/19438 already use for their own Qia). Checked against the
     Injection System Configuration Rate setpoint, ±5% (12.11's own "accept the test
     only if" language) — informational warning, not a hard block (confirmed with
     the user: same treatment as every other control target).

     Also computes the injection reservoir's Final volume (12.11's own "initial,
     final injection sink volumes" wording, the OTHER way to reach Ave_Injection_Flow
     — used here for display, not as a second computation path for Qia itself, since
     the live channel average is already the confirmed method 4548-12/19438 use).
     Per the user: the reservoir genuinely drains at Qia over the test — Final is
     Initial minus what was drawn, NOT defaulted equal to Initial the way Test
     System's own Vf is (that field has no better source; this one does). Verified
     against the user's own worked example: 74 L initial, 250 mL/min for 60 min ->
     drains 15 L -> 59 L final. ---- */
  _computeInjectionFlowRate(df, terminationTime) {
    // Read every setpoint/volume this lens needs up front, unconditionally — these
    // feed app.js's gravimetric-recompute hook (checkGravimetricAcceptance)
    // regardless of whether Qia itself or the 12.11 check below succeed.
    this.testFlowSetpoint = toNumber(df.getHeaderValue(HEADER_TEST_FLOWRATE.section, HEADER_TEST_FLOWRATE.key));
    this.injectionGravSetpoint = toNumber(df.getHeaderValue(HEADER_INJ_GRAVIMETRIC_SETPOINT.section, HEADER_INJ_GRAVIMETRIC_SETPOINT.key));
    this.injectionFlowSetpoint = toNumber(df.getHeaderValue(HEADER_INJ_FLOWRATE_SETPOINT.section, HEADER_INJ_FLOWRATE_SETPOINT.key));
    this.injVolumeInitial = toNumber(df.getHeaderValue(HEADER_INJECTION_VOLUME.section, HEADER_INJECTION_VOLUME.key));
    // Design-target Average_BUGL — same formula, setpoint inputs instead of
    // measured ones (see checkGravimetricAcceptance's comment); needs nothing
    // beyond the three setpoints just read above, so it's available here
    // unconditionally, no hand-entry dependency.
    this.buglTarget = Iso16889Analysis.computeAverageBUGL({
      injectionGravAverage: this.injectionGravSetpoint,
      qia: this.injectionFlowSetpoint,
      testFlowSetpoint: this.testFlowSetpoint
    });

    this.qia = averageSeries(df.getChannel(INJ_RATE_TAG));
    if (this.qia === null) {
      this.warnings.push(INJ_RATE_TAG + " channel not found; average injection flow rate (Qia) unavailable.");
      return;
    }

    if (this.injVolumeInitial !== null) {
      const terminationMinutes = terminationTime / 60;
      const drawnLiters = (this.qia * terminationMinutes) / 1000;   // mL/min x min -> mL, /1000 -> L
      this.injVolumeFinal = this.injVolumeInitial - drawnLiters;
    }

    if (this.injectionFlowSetpoint === null || this.injectionFlowSetpoint <= 0) return;

    const deltaPct = Math.abs(this.qia - this.injectionFlowSetpoint) / this.injectionFlowSetpoint * 100;
    if (deltaPct > INJ_FLOWRATE_TOLERANCE_PCT) {
      this.warnings.push(
        "Average injection flow rate (" + this.qia.toFixed(1) + " mL/min) is " + deltaPct.toFixed(1) +
        "% off the " + this.injectionFlowSetpoint.toFixed(1) + " mL/min setpoint — outside the ±" + INJ_FLOWRATE_TOLERANCE_PCT +
        "% the standard requires to accept the test (12.11).");
    }
  }

  /* ---- Downstream_Sample_Flow (Qd), needed by the mass-balance formula (13.2) —
     a DECLARED header setpoint (Dilution System Configuration's SampleFlow, downstream
     value), NOT a live channel — see HEADER_SAMPLE_FLOW's own comment for why this
     does NOT read UpSensor/DnSensor (or aQLBD/aQLSD) the way an earlier version of
     this method mistakenly did, on the same wrong assumption iso19438Analysis.js's Qd
     used to make before its own 2026-07-31 fix. Sensor-independent — the dilution
     sample draw is a property of the RIG's dilution system, not of which particle
     sensor is currently selected, unlike the sensor-flow channel it replaces. ---- */
  _computeDownstreamSampleFlow(df) {
    const sampleFlow = df.getHeaderValues(HEADER_SAMPLE_FLOW.section, HEADER_SAMPLE_FLOW.key);
    this.qd = sampleFlow && sampleFlow.length > 1 ? toNumber(sampleFlow[1]) : null;
    if (this.qd === null) {
      this.warnings.push("Sample Flow header value (Dilution System Configuration/SampleFlow) not found or incomplete; Dust_Retained (13.2) cannot be computed once gravimetric results are entered.");
    }
  }

  /* ---- 13.2: Dust_Injected / Dust_Retained, and 12.12: Average_BUGL — NOT computed
     as part of run(), since Ave_Injection_GravLevel needs two hand-entered injection
     gravimetric samples and Test_Final_Grav needs a hand-entered 80% upstream sample
     (same "Gf has no header fallback" reasoning 4548-12/19438 already apply to their
     own gravimetric fields). Called from the gravimetric entry dialog's save handler
     instead (app.js), once those are known — mirrors computeMassBalance's existing
     shape on the other two standards.
     @param {{injectionGravAverage:number|null, testFinalGrav:number|null,
       testFinalVolume:number|null, qia:number|null, qd:number|null,
       terminationMinutes:number|null, testFlowSetpoint:number|null}} inputs
     @returns {{dustInjected:number|null, dustRetained:number|null}} */
  static computeMassBalance({ injectionGravAverage, testFinalGrav, testFinalVolume, qia, qd, terminationMinutes, testFlowSetpoint }) {
    let dustInjected = null, dustRetained = null;
    if (injectionGravAverage !== null && qia !== null && terminationMinutes !== null) {
      // 13.2: Dust_Injected = Ave_Injection_GravLevel x Ave_Injection_Flow x
      // Final_Test_Time / 1000 — mg/L x mL/min x min, same mL/min->L/min ->g
      // conversion pattern 4548-12/19438's own injectedMass already uses.
      dustInjected = (injectionGravAverage * (qia / 1000) * terminationMinutes) / 1000;
    }

    // BUGL feeds Dust_Retained's flow-weighted terms — computed via the same shared
    // helper 12.12's own acceptance check uses (computeAverageBUGL below), so the two
    // can never silently disagree.
    const bugl = computeAverageBUGL({ injectionGravAverage, qia, testFlowSetpoint });

    if (dustInjected !== null && testFinalGrav !== null && testFinalVolume !== null && qd !== null && terminationMinutes !== null && bugl !== null) {
      const qdLPerMin = qd / 1000;   // same mL/min -> L/min conversion as qia
      // 13.2: Dust_Retained = Dust_Injected - Gf*Vf/1000 - Qd*T*(Gf-BUGL)/1000 -
      // Qd*T*(Gf+BUGL)/2/1000 — pasted exactly as given; unlike ISO 19438's Mnr
      // formula, every term here already carries its own *Final_Test_Time, so no
      // unit-consistency flag is needed. NOTE: uses Downstream_Sample_Flow in BOTH
      // flow-weighted terms — a real difference from ISO 19438's Mnr, which uses the
      // UPSTREAM flow for its second term; implemented per THIS standard's own text,
      // not harmonized against 19438's.
      dustRetained = dustInjected
        - (testFinalGrav * testFinalVolume) / 1000
        - (qdLPerMin * terminationMinutes * (testFinalGrav - bugl)) / 1000
        - (qdLPerMin * terminationMinutes * (testFinalGrav + bugl) / 2) / 1000;
    }

    return { dustInjected, dustRetained };
  }

  /** 12.12: Average_BUGL = Ave_Injection_GravLevel x Ave_Injection_Flow / Test_Flow_Setpoint.
   *  @param {{injectionGravAverage:number|null, qia:number|null, testFlowSetpoint:number|null}} inputs
   *  @returns {number|null} */
  static computeAverageBUGL({ injectionGravAverage, qia, testFlowSetpoint }) {
    if (injectionGravAverage === null || qia === null || testFlowSetpoint === null || testFlowSetpoint <= 0) return null;
    return (injectionGravAverage * (qia / 1000)) / testFlowSetpoint;
  }

  /* ---- 12.9 (injection gravimetric ±5% PER SAMPLE) and 12.12 (BUGL ±10%) —
     informational warnings, confirmed with the user: same treatment as every other
     control target, not a hard block (two of the standard's three "accept the test
     only if" criteria live here rather than iso16889ControlTargets.js, since both
     need hand-entered gravimetric values the generic channel/header engine can't
     produce — 12.11 is the third, already checked at run() time above since Qia is
     live-channel-derived). Returns plain strings so app.js can push them straight
     onto currentAnalysis.gravimetricWarnings (always REASSIGNED there, never
     appended, so repeated edits don't accumulate duplicates — see app.js).

     12.12 — CORRECTED per the user after a real false-failure report (an ASSUMED
     "Test System Configuration" GravimetricLevel header was being compared against
     the computed Average_BUGL directly; that header, whatever it actually is, is
     NOT a BUGL setpoint — the rig has no independently-configured BUGL target at
     all). The standard's own formula (12.12) is Average_BUGL = Ave_Injection_GravLevel
     x Ave_Injection_Flow / Test_Flow_Setpoint — there is no separate "target BUGL"
     input anywhere in that formula OR in the .DAT header; the target has to be
     DERIVED by running the exact same formula against the injection system's own
     concentration/flow SETPOINTS instead of the measured averages (what the rig
     WOULD produce if it hit its setpoints exactly). Implemented by calling
     computeAverageBUGL twice — once with measured inputs (the actual), once with
     setpoint inputs (the target) — rather than a second bespoke formula, so the two
     can never drift out of sync with each other.
     suppressBugl — per the user (2026-08-03): 12.12's Average_BUGL is only valid for
     Filter 1 on a dual-filter (series) test — the particle-size distribution
     challenging Filter 2 is necessarily modified by having already passed through
     Filter 1, so there's no independently-known "what challenged Filter 2" quantity
     to compare a BUGL target against. Suppresses ONLY this 12.12 acceptance-check
     WARNING, not the underlying computed value shown elsewhere on the report (that
     value stays visible regardless of which filter is selected, per the user).
     app.js's recomputeIso16889GravimetricDerived decides WHEN this applies
     (MidstreamFlag:true + Filter 2 currently selected) — this function only knows
     how to skip the block, not why.
     @param {{injectionGravInitial:number|null, injectionGravFinal:number|null,
       injectionGravSetpoint:number|null, injectionFlowSetpoint:number|null,
       testFlowSetpoint:number|null, injectionGravAverage:number|null, qia:number|null,
       suppressBugl?:boolean}} inputs
     @returns {string[]} */
  static checkGravimetricAcceptance({ injectionGravInitial, injectionGravFinal, injectionGravSetpoint, injectionFlowSetpoint, testFlowSetpoint, injectionGravAverage, qia, suppressBugl }) {
    const warnings = [];

    if (injectionGravSetpoint !== null && injectionGravSetpoint > 0) {
      for (const [label, sample] of [["Initial", injectionGravInitial], ["Final", injectionGravFinal]]) {
        if (sample === null) continue;
        const deltaPct = Math.abs(sample - injectionGravSetpoint) / injectionGravSetpoint * 100;
        if (deltaPct > INJ_GRAVIMETRIC_TOLERANCE_PCT) {
          warnings.push(
            label + " injection gravimetric sample (" + sample.toFixed(1) + " mg/L) is " + deltaPct.toFixed(1) +
            "% off the " + injectionGravSetpoint.toFixed(1) + " mg/L setpoint — outside the ±" +
            INJ_GRAVIMETRIC_TOLERANCE_PCT + "% the standard requires to accept the test (12.9).");
        }
      }
    }

    if (!suppressBugl) {
      const actualBugl = Iso16889Analysis.computeAverageBUGL({ injectionGravAverage, qia, testFlowSetpoint });
      const targetBugl = Iso16889Analysis.computeAverageBUGL({ injectionGravAverage: injectionGravSetpoint, qia: injectionFlowSetpoint, testFlowSetpoint });
      if (actualBugl !== null && targetBugl !== null && targetBugl > 0) {
        const deltaPct = Math.abs(actualBugl - targetBugl) / targetBugl * 100;
        if (deltaPct > BUGL_TOLERANCE_PCT) {
          warnings.push(
            "Average base upstream gravimetric level (" + actualBugl.toFixed(1) + " mg/L) is " + deltaPct.toFixed(1) +
            "% off the " + targetBugl.toFixed(1) + " mg/L design target (derived from setpoints) — outside the ±" +
            BUGL_TOLERANCE_PCT + "% the standard requires to accept the test (12.12).");
        }
      }
    }

    return warnings;
  }
  //#endregion
}

//#region module-level helpers
function findRowRange(times, startSec, endSec) {
  let startRow = null, endRow = null;
  for (let i = 0; i < times.length; i++) {
    if (times[i] === null) continue;
    if (startRow === null && times[i] >= startSec) startRow = i;
    if (times[i] <= endSec) endRow = i;
  }
  if (startRow === null || endRow === null || endRow < startRow) return [null, null];
  return [startRow, endRow];
}

function averageSeries(series) {
  if (!series || series.length === 0) return null;
  let sum = 0, n = 0;
  for (const v of series) {
    if (v !== null && isFinite(v)) { sum += v; n++; }
  }
  return n > 0 ? sum / n : null;
}

/* Reconstructed from 13.6's plain-English description ("straight-line segments on
   the semi-log plot") plus standard log-linear interpolation math — see the file-top
   note on why this differs from the legacy engine's plain-linear version, and why the
   pasted formula text isn't implemented literally (a transcription error, unmatched
   parenthesis). Linear in size (x), logarithmic in beta (y). */
function logLinearInterpolateSize(targetBeta, betaA, sizeA, betaB, sizeB) {
  if (targetBeta === betaA) return sizeA;
  if (targetBeta === betaB) return sizeB;
  return sizeA + (sizeB - sizeA) * (Math.log(targetBeta) - Math.log(betaA)) / (Math.log(betaB) - Math.log(betaA));
}

// computeAverageBUGL is called both as Iso16889Analysis.computeAverageBUGL (12.12's
// own check) and, internally, by computeMassBalance's Dust_Retained term — module-
// level alias so computeMassBalance's inline reference above resolves without
// depending on class-definition order at parse time.
function computeAverageBUGL(inputs) {
  return Iso16889Analysis.computeAverageBUGL(inputs);
}
//#endregion

//#region exports (dual: Node require for tests, window global for the browser)
if (typeof module !== "undefined") {
  module.exports = { Iso16889Analysis };
}
if (typeof window !== "undefined") {
  window.Iso16889Analysis = Iso16889Analysis;
}
//#endregion

})();

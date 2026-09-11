"use strict";
/* =====================================================================================
   iso19438Analysis.js  —  ISO 19438:2023 analysis engine.
   =====================================================================================
   Clean build against the standard text the user provided (not a port of anything —
   see CLAUDE.md's provenance note distinguishing this from iso16889). Structurally
   mirrors iso454812Analysis.js's 3-lens organization (this codebase's other clean
   build), since the two standards' report shapes are close, but every procedure below
   is this file's OWN — never shared with iso454812Analysis.js, even where the shape
   matches, per CLAUDE.md.

   -------------------------------------------------------------------------------------
   FIELD-BY-FIELD WALK — RESOLVED 2026-08-18 (WISHLIST.md's "Decided 2026-07-30" #1)
   -------------------------------------------------------------------------------------
   Every `// ASSUMED` channel-tag/header-key constant below has now been checked
   against real .DAT files (SpinOnMP.DAT — an ExRaDs dual-sensor rig — and
   TwinFSRig-ROTest9-MP.DAT — the same single-sensor rig ISO 4548-12's own control-
   target table was confirmed against) and CONFIRMED present. This was expected —
   per the user, the .DAT format itself is NOT standard-specific (ISO 16889,
   ISO 4548-12, and ISO 19438 are all multipass standards logged by the SAME file
   format/control program — see CLAUDE.md's ".DAT file handling" section) — but
   confirmed is not the same as assumed, so it's been done.
   Separately, per the user (2026-08-18): the ISO 19438 and ISO 4548-12 build-out
   documents given to build these engines were produced INDEPENDENTLY of each other,
   each from that standard's own published text, despite the two standards having
   heavy real-world carryover — so where a value here matches ISO 4548-12's own
   (DISREGARDED_CYCLES, the 2-reading temperature compliance shape), that's each
   standard's own text independently landing on the same figure, not one copied
   from the other uncritically.

   -------------------------------------------------------------------------------------
   WHAT'S GENUINELY DIFFERENT FROM ISO 4548-12 (not just a naming/tag guess)
   -------------------------------------------------------------------------------------
   - Initial Efficiency (E6): a FIXED average of minutes 4-6, independent of whichever
     bucket size (5 or 10 min) the intermediate/Min. calc below uses. 4548-12 has no
     equivalent — its three efficiency rows are Max/Min/Overall; 19438's are
     Initial/Min/Overall. Confirmed with the user (see C.2 vs C.3 in the standard text).
   - Filter ratings: TWO curves (Initial-efficiency-based AND Overall-efficiency-based)
     at 4 target percentages (50/90/95/99) — 4548-12 has ONE curve (overall only) at 5
     targets (50/75/90/97.8/99).
   - Non-Retained Mass (Mnr) is a real mass-balance integral needing Qd/Qu (declared
     downstream/upstream sampling-system flow rate) and Vf (final test system volume)
     as new inputs 4548-12's simpler Mnr formula doesn't need at all.
   -------------------------------------------------------------------------------------
   Wrapped in an IIFE for the same reason as iso454812Analysis.js: classic <script>-
   loaded engines share one global scope (see index.html), so internal names must not
   leak. ENCAPSULATION NOTE: same as iso454812Analysis.js — this class is a read-only-
   by-convention result bag iso19438Mapper.js reads directly; plain public fields, not
   private #fields + getters, for the same reason (see that file's own note). --------- */
(function () {

//#region shared
// CONFIRMED by the user (2026-07-31) — same TestType vocabulary as ISO 4548-12/16889
// (same control program), and the same meaning per value:
//   Multipass            — the only type this standard's math is actually written for.
//   Single-Pass          — NON-STANDARD but analyzable in the same multipass style: the
//     machine's cleanup filter is ON, so contaminant passes the test filter only once
//     before the cleanup filter (not the test filter) captures it downstream.
//   Multipass Series     — NON-STANDARD, same style: two filters in series, so there's
//     no way to tell which one retained the contaminant.
//   (both of the above: analyzable for efficiency/DP, but NOT for retained mass — see
//   NON_STANDARD_TEST_TYPES and _computeGravimetricMassBalance's Mnr/Cr suppression)
//   ""                   — pre-dates this header field existing; treated as Multipass.
//   Data Only            — rejected: no termination detail, no report possible at all.
//   PQ                   — rejected: no particle counts (that's ISO 3968's own report,
//     not yet built).
//   Cyclic Multipass / Cyclic Series Multipass — rejected: these are ISO 23369, a
//     different standard (not yet built) with a genuinely different file pair (a
//     matching .cyclic file alongside the .DAT, since flow is cycled through the test).
const VALID_TEST_TYPES = ["Single-Pass", "Multipass", "Multipass Series", ""];
const REJECTED_TEST_TYPES = {
  "Data Only": "This file contains 'Data Only' and cannot generate ISO 19438 reports.",
  "P-Q": "This file contains 'P-Q' data and cannot generate ISO 19438 reports.",   // CONFIRMED real key (2026-08-03), was "PQ" — never matched a real file
  "Cyclic Multipass": "This file contains 'Cyclic Multipass' data (ISO 23369), not ISO 19438.",
  "Cyclic Series Multipass": "This file contains 'Cyclic Series Multipass' data (ISO 23369), not ISO 19438."
};
// Test types that run this standard's normal analysis but can NEVER report retained
// mass (Mnr/Cr) — own copy per CLAUDE.md, even though the SET is identical across all
// three standards this project supports.
const NON_STANDARD_TEST_TYPES = ["Single-Pass", "Multipass Series"];
const NON_STANDARD_RETAINED_MASS_REASON = {
  "Single-Pass": "Retained mass analysis is not valid for a Single-Pass test: the machine's cleanup filter is active, so contaminant that passes the test filter is captured downstream by the cleanup filter rather than recirculated — it cannot be attributed to the test filter alone.",
  "Multipass Series": "Retained mass analysis is not valid for a Multipass Series test: with two filters in series, it is not possible to determine which filter retained the contaminant."
};

const analysisMathLib = (typeof module !== "undefined") ? require("../../helpers/analysisMath.js") : window.AnalysisMath;
const { linearInterpolate, findCrossingBracket, interpolateAt, toNumber, formatElapsed, sumChannels } = analysisMathLib;
const coincidenceLimitLib = (typeof module !== "undefined") ? require("../../helpers/coincidenceLimitCheck.js") : window.CoincidenceLimitCheck;
const { checkCoincidenceLimit, formatMinuteRanges, DEFAULT_LB_COINCIDENCE_LIMIT, DEFAULT_LS_COINCIDENCE_LIMIT } = coincidenceLimitLib;
//#endregion

//#region pressure lens — channels, termination, ΔP milestones
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
// Hard floor on test duration — see this file's own note at the actual check for
// the standard-text confirmation. Own copy per CLAUDE.md, even though the VALUE
// (25 min) is shared across all three standards this project supports.
const MIN_TEST_TIME_MINUTES = 25;
const NET_DP_MILESTONES = [5, 10, 15, 20, 40, 80, 100];   // % of net ΔP rise — confirmed, matches the user's Page 1 outline exactly
const HEADER_CLEAN_ASSEMBLY_DP = { section: "General Test Information", key: "CleanAssemblyDP" };   // CONFIRMED by the user (2026-07-31), kPa

const TERMINATION_HEADER_SECTION = "General Test Information";   // CONFIRMED by the user (2026-07-31)
const TERMINATION_HEADER_KEY = "TerminalDP";   // CONFIRMED by the user (2026-07-31), kPa
// Own copy of the same midstream/dual-filter channel-resolution pattern
// iso454812Analysis.js uses — see that file's SENSOR SELECTION note for the full
// rationale. CONFIRMED with the user (2026-07-30), no longer assumed: single-filter
// tests use TS_DPress; SERIES tests use TS_PreDPress for the PRIMARY filter and
// TS_FinalDPress for the SECONDARY.
const DP_CHANNEL_TAG = "TS_DPress";
const DP_CHANNEL_TAG_PRIMARY = "TS_PreDPress";
const DP_CHANNEL_TAG_SECONDARY = "TS_FinalDPress";

/** @param {DataFile} df @param {string} sensor @returns {string} */
function resolveDPChannelTag(df, sensor) {
  if (!df.midstreamFlag || df.analogTags.indexOf(DP_CHANNEL_TAG) >= 0) return DP_CHANNEL_TAG;
  return sensor === "lb" ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
}
//#endregion

//#region particle count lens — sensor selection, efficiency, sizes, filter ratings
/** lb/ls: CONFIRMED, same shape as ISO 4548-12's sensor channels (own copy per
 *  CLAUDE.md — shape matches, procedure doesn't share code). lbe: CONFIRMED — same
 *  synthetic up/down pair as ISO 16889/4548-12's own SENSOR_CHANNELS.lbe (see
 *  iso454812Analysis.js's own comment for the physical reasoning: LBD doubles as
 *  lbe's "upstream" reference since downstream-of-primary and upstream-of-secondary
 *  are physically the same tap), verified here against dataFile.js's "LBLB" 5-row
 *  shape (analog, LBU, [unused], LBD, LBE) and the user's own confirmation
 *  (2026-08-18) of why LS and LBE data share the same row slot.
 *  @type {Record<string,{sizesProp:string,upProp:string,downProp:string,label:string}>} */
const SENSOR_CHANNELS = {
  lb: { sizesProp: "lbSizes", upProp: "lbu", downProp: "lbd", label: "LB (Light Blocking)" },
  ls: { sizesProp: "lsSizes", upProp: "lsu", downProp: "lsd", label: "LS (Light Scattering)" },
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

// Confirmed against the standard text (10.2.3.1-10.2.3.3, C.2-C.4): first 3 minutes of
// counts always disregarded; Initial Efficiency is always minutes 4-6 exactly,
// regardless of the bucket size the intermediate/Min. calc below uses; intermediate
// buckets are 5 min (test <=60 min) or 10 min (test >60 min).
const SKIP_MINUTES = 3;
const INITIAL_EFF_END_MINUTES = 6;
const FILTER_RATING_TARGETS = [50, 90, 95, 99];   // confirmed — the user's Page 1 "Filtration efficiencies" compound table
//#endregion

//#region mass lens — gravimetric mass balance
// CONFIRMED by the user (2026-07-31): key/section and L/min, EXCEPT on the ~5% of the
// fleet that are older "Life and Efficiency" test stands (SAE J905/J1985 duty, not
// this standard) — those report Test System Rate in L/hour in this same header field,
// no unit tag distinguishing it. Deliberately NOT detected/converted here: per the
// user, this is exactly `src/core/machineProfile.js`'s dormant channel-correction
// pattern (already built for this precise "old machine, wrong stored unit" shape, see
// its own header comment) — it stays unpopulated by design until a real customer on
// one of those stands actually uses this standard (see WISHLIST.md's "machineProfiles.js
// stays dormant" entry, where the gut-check heuristic for detecting the L/hour case
// is recorded so it isn't lost).
const HEADER_TEST_FLOWRATE = { section: "Test System Configuration", key: "Rate" };
const HEADER_GRAVIMETRIC = { section: "Injection System Configuration", key: "GravimetricLevel" };   // CONFIRMED by the user (2026-07-31), mg/L
const HEADER_INJECTION_VOLUME = { section: "Injection System Configuration", key: "Volume" };   // CONFIRMED by the user (2026-07-31), L
const INJ_RATE_TAG = "INJ_Rate";   // CONFIRMED — present in real files' Data Format row
// Qd/Qu (downstream/upstream sampling-system flow, needed by Mnr below) are a
// DECLARED header setpoint, not a live channel. Corrected per the user (2026-07-31):
// this used to reuse the UpSensor/DnSensor channel tags, on the mistaken assumption
// that they were the same thing iso19438ControlTargets.js's Sensor Flow Rate rule
// checks — but UpSensor/DnSensor are the flow through the particle counter's own
// sensor, a much smaller number than the sample draw rate. The sample flow itself is
// only ever declared as Dilution System Configuration's SampleFlow header key (see
// dataFile.js's Dilution System schema note) — .DAT files don't log it as a
// time-series channel at all (only .DB files would).
const HEADER_SAMPLE_FLOW = { section: "Dilution System Configuration", key: "SampleFlow" };   // CONFIRMED by the user (2026-07-31), mL/min
//#endregion

/* =====================================================================================
   Iso19438Analysis
   ===================================================================================== */
class Iso19438Analysis {
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
    this.cleanAssemblyDP = null;

    // ---- %-net-ΔP milestone table (pressure lens) ----
    this.netDPMilestones = [];     // [{ percent, testTimeMin, assyDP, bracket }]

    // ---- filtration efficiency (particle count lens, selected sensor's sizes) ----
    this.sizes = [];
    this.bucketMinutes = null;         // 5 or 10
    this.buckets = [];                 // per-time-bucket { startTime, endTime, testTimeMin, upstream[], downstream[],
                                        // efficiency[], countRows: [{time,up[],down[]}] } — countRows is audit-trail-
                                        // only (see iso19438AuditSteps.js's hover tooltips), the raw per-cycle rows
                                        // actually summed into that bucket's upstream/downstream/efficiency.
    this.initialEfficiency = [];       // one % per size — fixed minutes 4-6 average (E6)
    this.initialUpstream = [];         // averaged upstream counts over the same E6 window
    this.initialDownstream = [];       // averaged downstream counts over the same E6 window
    this.overallEfficiency = [];       // one aggregate % per size, across the whole valid window
    this.minEfficiency = [];           // per size, min across the bucketed intermediate efficiencies
    this.initialFilterRating = {};     // { "50": "4.2", ... } — reverse-interpolated against initialEfficiency
    this.overallFilterRating = {};     // { "50": "4.2", ... } — reverse-interpolated against overallEfficiency

    // ---- gravimetric mass balance (mass lens; computable at load time only) ----
    this.qia = null;      // average injection flow rate, mL/min
    this.gia = null;      // average injection gravimetric level, mg/L (header fallback)
    this.ga = null;       // actual base upstream gravimetric level, mg/L
    this.qd = null;       // downstream sampling-system flow rate (declared header setpoint), L/min
    this.qu = null;       // upstream sampling-system flow rate (declared header setpoint), L/min
    this.injectedMass = null;   // g — Mi
    this.dustAdded = null;      // g — W

    // ---- count cycles (particle count lens) ----
    this.totalCounts = null;
    this.countsToAverage = null;

    this.errors = [];
    this.warnings = [];
  }
  //#endregion

  //#region public API
  /** @param {DataFile} df @param {{sensor?:string, pressureView?:string, coincidenceLimits?:Record<string,number>}} [options] @returns {Iso19438Analysis} */
  static run(df, options) {
    const analysis = new Iso19438Analysis();
    analysis.sensor = (options && SENSOR_CHANNELS[options.sensor]) ? options.sensor : DEFAULT_SENSOR;
    if (df.midstreamFlag) analysis.sensorLabel = resolveSensorLabel(analysis.sensor, df);

    // Same validate-and-fall-back-to-first pattern `sensor` uses against
    // availableSensors — only meaningful for a MidstreamFlag:false dual-filter Setup
    // file; availablePressureViews returns [] otherwise, leaving pressureView null.
    const views = Iso19438Analysis.availablePressureViews(df);
    analysis.pressureView = (options && options.pressureView && views.some((v) => v.key === options.pressureView))
      ? options.pressureView
      : (views[0] ? views[0].key : null);

    if (!analysis._validateTestType(df)) return analysis;
    if (!analysis._determineTermination(df)) return analysis;   // pressure lens
    analysis._readCleanBaseline(df);                             // pressure lens
    analysis._computeNetDPMilestones(df);                        // pressure lens

    // Pressure's termination output is the one value both other lenses depend on —
    // passed explicitly, not read off `this` inside each lens's own methods (same
    // convention as iso454812Analysis.js — see that file's FILE ORGANIZATION note).
    const termination = {
      terminationTime: analysis.terminationTime,
      terminationTag: analysis.terminationTag,
      overallDPSeries: analysis.overallDPSeries
    };
    analysis._computeInitialEfficiency(df, termination);           // particle count lens
    analysis._computeBucketEfficiency(df, termination);            // particle count lens
    analysis._computeFilterRatings();                              // particle count lens
    analysis._computeCountCycles(df, termination);                 // particle count lens
    analysis._checkCoincidenceLimit(df, options && options.coincidenceLimits);   // particle count lens

    analysis._computeGravimetricMassBalance(df, termination.terminationTime);   // mass lens

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
      this.errors.push("Unknown test type: '" + testType + "'. Cannot determine ISO 19438 compatibility.");
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

  //#region pressure lens — channels, termination, ΔP milestones
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
      // Set BEFORE any possible early-return inside the dual-filter path below, same
      // "classify first, validate after" pattern _validateTestType's
      // nonStandardTestType already uses — a file that's a dual-filter Setup but
      // fails validation later should still report the correct classification.
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

    // Confirmed with the user — the standard's own text (10.2.1) recommends >=30
    // minutes; below 25 minutes a report is refused outright rather than generated
    // against too little data to be meaningful.
    if (this.terminationTime < MIN_TEST_TIME_MINUTES * 60) {
      this.errors.push(
        "Test duration (" + formatElapsed(this.terminationTime) + ") is under the " +
        MIN_TEST_TIME_MINUTES + "-minute minimum required to generate a report.");
      return false;
    }

    return true;
  }

  /* ---- Dual-filter (series) termination — "Two Pressure"/"Suction & Pressure".
     CONFIRMED by the user (2026-08-03). The shared TerminalDP header has evolved
     through 3 generations of the control software, distinguished by how many
     comma-separated values it carries:
       1 value  — oldest: a single OVERALL differential target only.
       2 values — field[0] = filter 1 (prefilter) target, field[1] = filter 2 (final
                  filter) target. No overall target in this generation.
       3 values — field[0] = overall, field[1] = filter 1, field[2] = filter 2. Any
                  field the operator didn't use is -1 (sentinel for "not configured").
     "Overall" differential = TS_PreDPress + TS_FinalDPress, summed sample-by-sample
     (no separate overall channel exists — confirmed, not to be second-guessed).
     Termination: whichever ACTIVE (not -1/<=0) target is reached FIRST ends the
     test — earliest-crossing-wins across whichever of {overall, filter1, filter2}
     are active for this file's generation. ---- */
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
      // 3 (or, defensively, more — a 4th+ value would be unexpected/corrupt; ignored
      // rather than erroring, same defensive stance dataFile.js already takes on
      // malformed rows elsewhere).
      overallTarget = toNumber(terminalDPValues[0]);
      filter1Target = toNumber(terminalDPValues[1]);
      filter2Target = toNumber(terminalDPValues[2]);
    }

    // -1 is the control software's sentinel for "operator didn't configure this
    // target" (confirmed) — inactive, not an error; a file can legitimately have
    // only 1 or 2 of the 3 possible targets in play.
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

    // Earliest-crossing-wins across whichever targets are active.
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
      // Existing sensor toggle drives BOTH particle-count data (already does) AND
      // pressure display together (confirmed by the user) — lb = filter 1
      // (primary); anything else (ls/lbe) = filter 2 (secondary).
      const isFilter1 = this.sensor === "lb";
      this.terminationTag = isFilter1 ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
      const perFilterTarget = isFilter1 ? filter1Target : filter2Target;
      if (perFilterTarget !== null && perFilterTarget > 0) {
        this.terminationDP = perFilterTarget;
      } else if (overallTarget !== null && overallTarget > 0) {
        // No independent per-filter target exists for this generation (the real
        // dual-filter file's own case: 1-value generation, overall only) — fall
        // back to the shared overall target rather than leaving the milestone
        // table/chart target line blank. Confirmed by the user (2026-08-03).
        this.terminationDP = overallTarget;
      } else {
        this.terminationDP = null;
        this.warnings.push(
          "No Terminal DP target is configured for the " + (isFilter1 ? "Primary" : "Secondary") +
          " Filter (or an overall target) in this file's header — ΔP milestones and the DP-vs-time " +
          "chart's target line cannot be shown for this filter view.");
      }
      return;
    }

    // MidstreamFlag: false — pressureView (validated against availablePressureViews
    // in run()) drives display instead, since there's no filter-identity sensor
    // toggle in this case (LB/LS here is measurement technology viewing the whole
    // assembly, not filter identity — see iso454812Analysis.js's v1 SCOPE note).
    if (this.pressureView === "overall") {
      this.terminationTag = "";   // no single real channel — see overallDPSeries
      this.terminationDP = overallTarget;
      this.overallDPSeries = sumChannels(df.getChannel(DP_CHANNEL_TAG_PRIMARY), df.getChannel(DP_CHANNEL_TAG_SECONDARY));
    } else if (this.pressureView === "filter2") {
      this.terminationTag = DP_CHANNEL_TAG_SECONDARY;
      this.terminationDP = filter2Target;
    } else {   // "filter1", or null (defensive — shouldn't happen for a file that got this far)
      this.terminationTag = DP_CHANNEL_TAG_PRIMARY;
      this.terminationDP = filter1Target;
    }
  }

  /** Which pressure views a MidstreamFlag:false dual-filter Setup file supports,
   *  given its TerminalDP header generation — [] (no picker shown) for a
   *  MidstreamFlag:true file (uses the sensor toggle instead) or a non-dual-filter
   *  Setup. @param {DataFile} df @returns {Array<{key:string,label:string}>} */
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

  _readCleanBaseline(df) {
    const value = toNumber(df.getHeaderValue(HEADER_CLEAN_ASSEMBLY_DP.section, HEADER_CLEAN_ASSEMBLY_DP.key));
    if (value === null) {
      this.warnings.push("Clean assembly ΔP not found in header; %-net-ΔP milestones cannot be computed.");
    }
    this.cleanAssemblyDP = value;
  }

  _computeNetDPMilestones(df) {
    // terminationDP === null is newly reachable (dual-filter Setup, a per-filter
    // view with neither its own nor an overall target active) — before this
    // feature it was structurally impossible for an ok analysis to reach here with
    // a null terminationDP. Guard rather than push 7 confusing "never reached"
    // warnings on top of the one clear warning _resolveDualFilterDisplay already gave.
    if (this.cleanAssemblyDP === null || this.terminationDP === null) return;

    const dpData = this.overallDPSeries || df.getChannel(this.terminationTag);
    const times = df.times;
    const span = this.terminationDP - this.cleanAssemblyDP;

    for (const percent of NET_DP_MILESTONES) {
      const targetDP = this.cleanAssemblyDP + (percent / 100) * span;
      const crossing = findCrossingBracket(targetDP, dpData, times);
      this.netDPMilestones.push({
        percent,
        testTimeMin: crossing === null ? null : crossing.crossingTime / 60,
        assyDP: crossing === null ? null : targetDP,
        bracket: crossing === null ? null : { before: crossing.before, after: crossing.after }
      });
      if (crossing === null) {
        this.warnings.push("Net ΔP milestone " + percent + "% was never reached.");
      }
    }
  }
  //#endregion

  //#region particle count lens — sensor selection, efficiency, sizes, filter ratings, count cycles
  /** @param {DataFile} df @returns {Array<{key:string,label:string}>} */
  static availableSensors(df) {
    return Object.entries(SENSOR_CHANNELS)
      .filter(([, spec]) => df[spec.sizesProp] && df[spec.sizesProp].length > 0)
      .map(([key]) => ({ key, label: resolveSensorLabel(key, df) }));
  }

  /* ---- Initial Efficiency (E6): a FIXED average of minutes [disregardThrough, 6:00],
     independent of the intermediate/Min. calc's bucket size. `termination` is
     Pressure's output, passed in explicitly — see run(). A test shorter than 6 minutes
     can't produce this figure at all; left blank (all-null) rather than guessing a
     shorter window the standard doesn't define. ---- */
  _computeInitialEfficiency(df, termination) {
    const { terminationTime } = termination;
    const spec = SENSOR_CHANNELS[this.sensor];
    this.sizes = df[spec.sizesProp];
    const sizeCount = this.sizes.length;

    const skipSeconds = SKIP_MINUTES * 60;
    const disregardThrough = skipSeconds + 1;
    const endSeconds = INITIAL_EFF_END_MINUTES * 60;

    if (endSeconds > terminationTime || disregardThrough >= endSeconds) {
      this.warnings.push("Test duration is shorter than the " + INITIAL_EFF_END_MINUTES + "-minute Initial Efficiency window; Initial Eff. not computed.");
      this.initialEfficiency = new Array(sizeCount).fill(null);
      this.initialUpstream = new Array(sizeCount).fill(null);
      this.initialDownstream = new Array(sizeCount).fill(null);
      return;
    }

    const window = this._computeOneWindow(df, disregardThrough, endSeconds, sizeCount, spec);
    this.initialEfficiency = window.efficiency;
    this.initialUpstream = window.upstream;
    this.initialDownstream = window.downstream;
  }

  /* ---- Intermediate/Min. efficiency: own copy of the same bucket-window mechanism
     iso454812Analysis.js uses (fixed clock grid, first bucket shortened by the
     disregard cutoff rather than the grid shifting, no shared boundary rows between
     consecutive buckets) — see that file's own extensive comment for the full
     rationale; not repeated here since the mechanism, not just the outcome, is
     independently re-derived in THIS file (own copy per CLAUDE.md), it just happens
     to land on the same design.

     Unlike 4548-12, this file does NOT track a per-bucket Max — 19438's report has no
     "Max Eff." row (its three rows are Initial/Min./Overall, not Max/Min/Overall). ---- */
  _computeBucketEfficiency(df, termination) {
    const { terminationTime, terminationTag, overallDPSeries } = termination;
    const spec = SENSOR_CHANNELS[this.sensor];
    const sizeCount = this.sizes.length;

    const terminationMinutes = terminationTime / 60;
    this.bucketMinutes = terminationMinutes > 60 ? 10 : 5;

    const skipSeconds = SKIP_MINUTES * 60;
    const disregardThrough = skipSeconds + 1;
    const bucketSeconds = this.bucketMinutes * 60;

    if (disregardThrough >= terminationTime) {
      this.warnings.push("Test duration is shorter than the " + SKIP_MINUTES + "-minute disregard period; no efficiency buckets computed.");
      this.overallEfficiency = new Array(sizeCount).fill(null);
      this.minEfficiency = new Array(sizeCount).fill(null);
      return;
    }

    const dpChannel = overallDPSeries || df.getChannel(terminationTag);

    let windowStart = disregardThrough;
    let gridEnd = bucketSeconds;
    while (windowStart < terminationTime) {
      const windowEnd = Math.min(gridEnd, terminationTime);
      if (windowStart <= windowEnd) {
        const bucket = this._computeOneWindow(df, windowStart, windowEnd, sizeCount, spec);
        bucket.dpAtEnd = dpChannel ? interpolateAt(windowEnd, df.times, dpChannel) : null;
        this.buckets.push(bucket);
      }
      windowStart = windowEnd + 1;
      gridEnd += bucketSeconds;
    }

    // Overall: aggregate counts across the whole valid window — NOT an average of the
    // per-bucket efficiencies above, matching "Overall Eff." being its own row.
    const overall = this._computeOneWindow(df, disregardThrough, terminationTime, sizeCount, spec);
    this.overallEfficiency = overall.efficiency;

    this.minEfficiency = new Array(sizeCount).fill(null);
    for (const bucket of this.buckets) {
      for (let i = 0; i < sizeCount; i++) {
        const eff = bucket.efficiency[i];
        if (eff === null) continue;
        if (this.minEfficiency[i] === null || eff < this.minEfficiency[i]) this.minEfficiency[i] = eff;
      }
    }
  }

  /* _computeOneWindow: own copy of iso454812Analysis.js's identical-purpose method —
     average upstream/downstream counts and the resulting efficiency % for every size
     of the selected sensor, over [startSec, endSec]. Shared by the Initial-Efficiency
     calc, the per-bucket loop, and the whole-window "overall" calc above.

     NO +1 OFFSET on sizeIndex — count rows carry no leading timestamp field, unlike
     analog rows (see CLAUDE.md's ".DAT file handling" rule and iso454812Analysis.js's
     own note on this exact mistake class; holds for ISO 19438 files too, since it's a
     property of the FILE FORMAT, not the standard — not standard-specific to begin
     with, so there was never really anything to confirm here). */
  _computeOneWindow(df, startSec, endSec, sizeCount, spec) {
    const [startRow, endRow] = findRowRange(df.times, startSec, endSec);
    const upstream = new Array(sizeCount).fill(null);
    const downstream = new Array(sizeCount).fill(null);
    const efficiency = new Array(sizeCount).fill(null);
    const countRows = [];
    const upRows = df[spec.upProp];
    const downRows = df[spec.downProp];

    if (startRow !== null && endRow !== null && endRow >= startRow) {
      for (let sizeIndex = 0; sizeIndex < sizeCount; sizeIndex++) {
        let sumUp = 0, sumDown = 0, n = 0;
        for (let row = startRow; row <= endRow; row++) {
          const up = toNumber(upRows[row][sizeIndex]);
          const down = toNumber(downRows[row][sizeIndex]);
          if (up !== null && down !== null) { sumUp += up; sumDown += down; n++; }
        }
        if (n > 0 && sumUp > 0) {
          upstream[sizeIndex] = sumUp / n;
          downstream[sizeIndex] = sumDown / n;
          efficiency[sizeIndex] = Math.max(0, Math.min(100, ((sumUp - sumDown) / sumUp) * 100));
        }
      }
      // Raw per-row breakdown, audit-trail-only — see this.buckets' own comment.
      // Same [startRow,endRow] window as the sums above, captured in a second,
      // trivial pass rather than folded into the per-size loop so the actual
      // sum/avg/efficiency computation above stays byte-for-byte what it already was.
      for (let row = startRow; row <= endRow; row++) {
        countRows.push({
          time: df.times[row],
          up: upRows[row].map((v) => toNumber(v)),
          down: downRows[row].map((v) => toNumber(v))
        });
      }
    }

    return {
      startTime: startSec, endTime: endSec, testTimeMin: endSec / 60,
      upstream, downstream, efficiency, countRows
    };
  }

  /* ---- Filter ratings: TWO curves (Initial-efficiency-based, Overall-efficiency-
     based), each at the same 4 target percentages — see FILTER_RATING_TARGETS.
     _sizeGivenEfficiency below is this file's own copy of the reverse-interpolation
     technique iso454812Analysis.js's _sizeGivenEfficiency uses (same bracket/clamp/
     nearest-fallback shape) — kept local rather than shared for the same reason that
     file states: a generic-looking numeric technique still counts as this standard's
     own analysis procedure once it's wired to this standard's specific targets/data,
     per CLAUDE.md. ---- */
  _computeFilterRatings() {
    for (const target of FILTER_RATING_TARGETS) {
      this.initialFilterRating[String(target)] = Iso19438Analysis._sizeGivenEfficiency(target, this.sizes, this.initialEfficiency);
      this.overallFilterRating[String(target)] = Iso19438Analysis._sizeGivenEfficiency(target, this.sizes, this.overallEfficiency);
    }
  }

  static _sizeGivenEfficiency(targetEff, sizes, effs) {
    return Iso19438Analysis.sizeGivenEfficiencyDetail(targetEff, sizes, effs).result;
  }

  /** Same interpolation as _sizeGivenEfficiency, but returns the FULL derivation
   *  detail (which two measured points a result was actually interpolated
   *  between, or why not) instead of just the formatted result string — for the
   *  Audit Trail view (iso19438AuditSteps.js) specifically. Not underscore-
   *  prefixed like the other internal statics here — this one IS meant to be
   *  called from outside the class. _sizeGivenEfficiency above now just delegates
   *  here, so there's exactly one implementation of this interpolation, not two
   *  kept in sync by hand. Own copy of the same-shaped iso454812Analysis.js
   *  method, per CLAUDE.md.
   *  @param {number} targetEff @param {Array<string|number>} sizes @param {Array<number|null>} effs
   *  @returns {{result:string, mode:"interpolated"|"below-range"|"above-range"|"no-data",
   *    bracket:{lowerSize:number,lowerEff:number,upperSize:number,upperEff:number}|null, note?:string}} */
  static sizeGivenEfficiencyDetail(targetEff, sizes, effs) {
    let firstValid = -1, lastValid = -1;
    for (let i = 0; i < effs.length; i++) {
      if (effs[i] !== null) {
        if (firstValid < 0) firstValid = i;
        lastValid = i;
      }
    }
    if (firstValid < 0) return { result: "", mode: "no-data", bracket: null };

    let minEff = Infinity, maxEff = -Infinity;
    for (let i = firstValid; i <= lastValid; i++) {
      if (effs[i] === null) continue;
      if (effs[i] < minEff) minEff = effs[i];
      if (effs[i] > maxEff) maxEff = effs[i];
    }

    if (targetEff < minEff) return { result: "<" + Number(sizes[firstValid]).toFixed(1), mode: "below-range", bracket: null };
    if (targetEff > maxEff) return { result: ">" + Number(sizes[lastValid]).toFixed(1), mode: "above-range", bracket: null };

    for (let i = firstValid; i < lastValid; i++) {
      if (effs[i] === null || effs[i + 1] === null) continue;
      const between = (effs[i] <= targetEff && effs[i + 1] >= targetEff) ||
                       (effs[i] >= targetEff && effs[i + 1] <= targetEff);
      if (between) {
        const size = linearInterpolate(targetEff, effs[i], Number(sizes[i]), effs[i + 1], Number(sizes[i + 1]));
        return {
          result: size.toFixed(1), mode: "interpolated",
          bracket: { lowerSize: Number(sizes[i]), lowerEff: effs[i], upperSize: Number(sizes[i + 1]), upperEff: effs[i + 1] }
        };
      }
    }

    let lowerIdx = -1, higherIdx = -1, lowerEff = -Infinity, higherEff = Infinity;
    for (let i = firstValid; i <= lastValid; i++) {
      if (effs[i] === null) continue;
      if (effs[i] < targetEff && effs[i] > lowerEff) { lowerEff = effs[i]; lowerIdx = i; }
      if (effs[i] > targetEff && effs[i] < higherEff) { higherEff = effs[i]; higherIdx = i; }
    }
    if (lowerIdx >= 0 && higherIdx >= 0) {
      const size = linearInterpolate(targetEff, lowerEff, Number(sizes[lowerIdx]), higherEff, Number(sizes[higherIdx]));
      return {
        result: size.toFixed(1), mode: "interpolated",
        bracket: { lowerSize: Number(sizes[lowerIdx]), lowerEff, upperSize: Number(sizes[higherIdx]), upperEff: higherEff },
        note: "gap in the efficiency progression — nearest non-adjacent measured points used, not the immediately adjacent sizes"
      };
    }

    return { result: "", mode: "no-data", bracket: null };
  }

  _computeCountCycles(df, termination) {
    const { terminationTime } = termination;
    const [startRow, endRow] = findRowRange(df.times, 0, terminationTime);
    if (startRow === null || endRow === null) return;

    // CONFIRMED (2026-08-18) — same figure as ISO 4548-12's own DISREGARDED_CYCLES (3),
    // the number of initial count cycles excluded from the averaged total, but landed
    // on independently: per the user, the ISO 19438 and ISO 4548-12 build-out
    // documents were each derived from that standard's own published text separately,
    // not one copied from the other — this value matching is real carryover between
    // the two standards' own texts, not an unchecked assumption.
    const disregardedCycles = 3;
    this.totalCounts = endRow - startRow + 1;
    this.countsToAverage = Math.max(0, this.totalCounts - disregardedCycles);
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
  //#endregion

  //#region mass lens — gravimetric mass balance
  /* ---- Gravimetric mass balance — the part computable without hand-entered
     results (Gf and Vf — see computeMassBalance below for why those two specifically
     stay hand-entered). `terminationTime` is Pressure's output, passed explicitly. ---- */
  _computeGravimetricMassBalance(df, terminationTime) {
    const injRate = df.getChannel(INJ_RATE_TAG);
    this.qia = averageSeries(injRate);   // mL/min
    if (this.qia === null) {
      this.warnings.push(INJ_RATE_TAG + " channel not found; average injection flow rate (Qia) unavailable.");
    }

    this.gia = toNumber(df.getHeaderValue(HEADER_GRAVIMETRIC.section, HEADER_GRAVIMETRIC.key));
    if (this.gia === null) {
      this.warnings.push("Gravimetric level not found in header; enter initial/final gravimetric results by hand.");
    }

    // Qd/Qu — downstream/upstream sampling-system flow rate, needed by Mnr (see
    // computeMassBalance). A DECLARED header setpoint, not a channel average — see
    // the HEADER_SAMPLE_FLOW note above for why this no longer reads UpSensor/
    // DnSensor. First occurrence only (the primary dilution stage) — dataFile.js's
    // schema note documents SampleFlow repeating a second time for an ExRaDs
    // extended stage, not handled here.
    // CONFIRMED by the user (2026-07-31): SampleFlow is recorded in mL/min (125
    // mL/min typical, 50 mL/min on low-flow dilution systems) but Mnr's formula
    // wants L/min, so /1000 below — same conversion qia gets, no longer a flagged
    // unknown for this specific field.
    const sampleFlow = df.getHeaderValues(HEADER_SAMPLE_FLOW.section, HEADER_SAMPLE_FLOW.key);
    const sampleFlowUpMLPerMin = sampleFlow && sampleFlow.length > 0 ? toNumber(sampleFlow[0]) : null;
    const sampleFlowDownMLPerMin = sampleFlow && sampleFlow.length > 1 ? toNumber(sampleFlow[1]) : null;
    this.qu = sampleFlowUpMLPerMin === null ? null : sampleFlowUpMLPerMin / 1000;
    this.qd = sampleFlowDownMLPerMin === null ? null : sampleFlowDownMLPerMin / 1000;
    if (this.qd === null || this.qu === null) {
      this.warnings.push("Sample Flow header value (Dilution System Configuration/SampleFlow) not found or incomplete; Non-Retained Mass cannot be computed once Gf/Vf are entered.");
    }

    // Ga divides by Test System's L/min flow rate; Injected Mass multiplies by an
    // mg/L concentration — both need qia in L/min, not the mL/min it's stored/
    // displayed in (same conversion iso454812Analysis.js documents needing — this is
    // unit math following from how qia is stored, not a standard-specific claim, so
    // there was nothing standard-text-dependent to confirm here).
    const qiaLPerMin = this.qia === null ? null : this.qia / 1000;

    const testFlowQ = toNumber(df.getHeaderValue(HEADER_TEST_FLOWRATE.section, HEADER_TEST_FLOWRATE.key));
    if (qiaLPerMin !== null && this.gia !== null && testFlowQ !== null && testFlowQ > 0) {
      // 10.2.2.7: Ga = (Gia x Qia) / Q
      this.ga = (this.gia * qiaLPerMin) / testFlowQ;
    }

    if (qiaLPerMin !== null && this.gia !== null) {
      // 10.2.5: Mi = (Qia x Gia x T) / 1000
      const terminationMinutes = terminationTime / 60;
      this.injectedMass = (qiaLPerMin * this.gia * terminationMinutes) / 1000;   // mg -> g
    }

    const injectionVolume = toNumber(df.getHeaderValue(HEADER_INJECTION_VOLUME.section, HEADER_INJECTION_VOLUME.key));
    if (this.gia !== null && injectionVolume !== null) {
      this.dustAdded = (this.gia * injectionVolume) / 1000;   // mg -> g
    }
    // Non-retained mass / retained capacity: NOT computed here — see computeMassBalance.
  }

  /** Non-Retained Mass (Mnr) / Retained Capacity (Cr) — NOT computed as part of run(),
   *  since Gf (final test gravimetric level) has no header fallback (matches
   *  iso454812Analysis.js's own reasoning) AND Vf (final test system volume) is ALSO
   *  hand-entered here — unlike 4548-12, which has no distinct final-volume field at
   *  all and just assumes initial volume, 19438's outline lists "Final volume, Vf: L"
   *  as its own report field (Operating Conditions, Row 10), separate from the
   *  initial Volume — but nothing in the standard text the user provided says Vf
   *  comes from a header, so it's treated as hand-entry (general field edit, not the
   *  gravimetric dialog — Vf is a system volume, not an mg/L lab result) until a real
   *  file shows otherwise. Called once Gf/Vf are both known (app.js).
   *
   *  10.2.6: Mnr = [Vf*Gf + Qd*T*(Gf-Ga) + Qu*((Gf-Ga)/2)] / 1000
   *
   *  UNIT-CONSISTENCY FLAG, not silently "corrected": the user's pasted formula has
   *  Qd multiplied by T (test duration, minutes) but Qu is NOT — Vf*Gf (L x mg/L) and
   *  Qd*T*(Gf-Ga) (L/min x min x mg/L) both resolve to mg, but Qu*((Gf-Ga)/2) (L/min x
   *  mg/L) resolves to mg/min, not mg — a real unit mismatch as literally given.
   *  Implemented exactly as provided (no T on the Qu term) rather than guessing it
   *  should be Qu*T*((Gf-Ga)/2) to fix the units — check this specific term against
   *  the actual published standard text or a worked numeric example before trusting
   *  a real Mnr value out of this function.
   *  @param {{vf:number|null, gf:number|null, qd:number|null, qu:number|null, ga:number|null, terminationMinutes:number|null, injectedMass:number|null}} inputs
   *  @returns {{nonRetainedMass:number|null, retainedCapacity:number|null}} */
  static computeMassBalance({ vf, gf, qd, qu, ga, terminationMinutes, injectedMass }) {
    if ([vf, gf, qd, qu, ga, terminationMinutes, injectedMass].some((v) => v === null || v === undefined)) {
      return { nonRetainedMass: null, retainedCapacity: null };
    }
    const nonRetainedMass = (vf * gf + qd * terminationMinutes * (gf - ga) + qu * ((gf - ga) / 2)) / 1000;   // mg -> g
    return { nonRetainedMass, retainedCapacity: injectedMass - nonRetainedMass };
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
//#endregion

//#region exports (dual: Node require for tests, window global for the browser)
if (typeof module !== "undefined") {
  module.exports = { Iso19438Analysis };
}
if (typeof window !== "undefined") {
  window.Iso19438Analysis = Iso19438Analysis;
}
//#endregion

})();

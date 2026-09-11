"use strict";
/* =====================================================================================
   iso454812Analysis.js  —  ISO 4548-12:2017 analysis engine.
   =====================================================================================
   Clean build against the standard text (per WISHLIST.md's distinction for new
   standards), not a port of anything. Takes a parsed DataFile and produces the numbers
   ISO 4548-12's report needs: termination, the %-net-ΔP milestone table, per-time-
   bucket and overall filtration efficiency (all measured sizes for the SELECTED sensor
   — which up to 16 are displayed is the mapper's concern, not this engine's),
   micrometer ratings, and the gravimetric mass-balance values that are computable
   without a user-entered final gravimetric level.

   -------------------------------------------------------------------------------------
   FILE ORGANIZATION — 3 lenses, one shared dependency
   -------------------------------------------------------------------------------------
   Internally organized as 3 domain "lenses," each its own region: PRESSURE (channels,
   termination-time detection, element/housing/%-net ΔP), PARTICLE COUNT (sensor
   selection, efficiency/beta-style calculations, which sizes get reported), and MASS
   (injection rate, base upstream gravimetric level, retained mass). They're genuinely
   separable — this session's own bug history landed squarely in one lens at a time and
   barely touched the others — but not independent: termination time (Pressure's output)
   gates count aggregation AND mass integration in the other two. That dependency is
   passed as an explicit parameter from run() into each lens's methods (see `termination`
   below), not left as an implicit `this.terminationTime` read buried inside them — so
   the one real cross-lens dependency is visible at the call site, not just documented.
   Deliberately NOT split into separate files: these engines load as classic <script>
   tags (see the IIFE note below), so a file split would mean new <script> tags, new
   window.* globals, and new service-worker precache entries for no behavior change —
   real overhead this reorganization doesn't need to pay to get the actual benefit.

   -------------------------------------------------------------------------------------
   SENSOR SELECTION (LB vs LS vs LBE) — also doubles as FILTER selection on
   MidstreamFlag files
   -------------------------------------------------------------------------------------
   A 5-row file carries TWO independent up/down count pairs for the same test. Exactly
   one of them drives the report at a time; run(df, {sensor}) picks which (default
   "lb", matching every file that only ever had LB to begin with). SENSOR_CHANNELS is
   the one place that maps a sensor key to its DataFile row/size property names — every
   other method reads through that, never df.lbu/df.lbSizes literally.

   On an ORDINARY (MidstreamFlag: false) LBLS file, LB and LS are two measurement
   TECHNOLOGIES bracketing the SAME single filter — "sensor" really does mean "which
   technology to view."

   On a MidstreamFlag: true file, that is NOT true: the machine has been reconfigured
   to bracket a PRIMARY filter (always LB) and a SECONDARY filter in series — LB and LS
   (or LB and LBE, on the one-off LBLB-shaped machine) are two DIFFERENT filters, not
   two views of one. "sensor" is still the mechanism used to pick which one's numbers
   the report shows (see availableSensors, which relabels the choices "Primary
   Filter"/"Secondary Filter" in this mode so the toggle is honest about what it does),
   but conflating this with the ordinary LB-vs-LS case would silently mislabel a
   secondary filter's numbers as an alternate view of the primary. LBE's up/down pair is
   synthetic (see SENSOR_CHANNELS.lbe) — it has no independent probe of its own, LBD is
   reused as its "upstream" reference, since downstream-of-primary and
   upstream-of-secondary are physically the same tap.

   -------------------------------------------------------------------------------------
   v1 SCOPE
   -------------------------------------------------------------------------------------
   - Series/multi-filter testing is supported only for MidstreamFlag: true files (see
     SENSOR SELECTION above) — one filter's numbers at a time, selected the same way
     LB vs. LS is chosen on an ordinary file. MidstreamFlag: false dual-filter setups
     ("Two Pressure" etc. without MidstreamFlag — independent-ΔP series testing where LB
     and LS redundantly measure the whole assembly) remain deferred; run() reports a
     clear validation error for those rather than guessing. Termination detection is
     INLINED into this file (_determineTermination), not shared: each standard owns its
     own analysis procedures (see CLAUDE.md). The algorithm currently matches ISO
     16889's because both .DAT files are logged by the same control program, but the
     two copies are deliberately independent. Termination itself is NOT filter-aware —
     the file carries only one recorded ΔP channel (one physical transducer across the
     whole assembly), so the same termination row is valid for computing either
     filter's efficiency.
   - Non-retained mass / retained capacity are NOT computed here. Per the standard,
     the final test gravimetric level (Gf) has no header fallback — it must be entered
     by hand after the file loads, and this engine runs once at load time, before any
     user input exists. Those two fields stay blank (same "hand-entered, NOT AVAILABLE"
     convention iso16889's v1 already uses for isoMtdMassInjected/etc.) until a live
     recompute-on-edit mechanism is worth building — not in this pass.

   -------------------------------------------------------------------------------------
   HEADER KEYS — confirmed against a real ISO 4548-12 .DAT file (2024-083-ROTest9-MP)
   -------------------------------------------------------------------------------------
   Every header lookup below, including HEADER_GRAVIMETRIC ("Injection System
   Configuration"/"GravimetricLevel") and HEADER_TEST_FLOWRATE ("Test System
   Configuration"/"Rate" — note: "Rate", not "Flowrate"; both Test System and
   Injection System Configuration use "Rate" for their setpoint), is now confirmed
   against real file content, not guessed. INJ_Rate, TS_Rate, TS_Temp, INJ_Temp,
   DS_Temp, TS_Conductivity, INJ_Conductivity all exist as real analog channels in
   that file's Data Format row.

   Wrapped in an IIFE — index.html loads this and every other standard's analysis
   engine as classic <script> tags sharing one global scope, so internal names must
   not leak and collide with a sibling standard's own top-level declarations.

   ENCAPSULATION NOTE (per CLAUDE.md's code-hygiene rule): this class's fields are
   intentionally left as plain public properties, not private #fields + getters. Its
   entire job is to be a read-only-by-convention RESULT BAG — iso454812Mapper.js reads
   nearly every field directly (buckets, overallEfficiency, qia, gia, ...). Getter-izing
   all of them would mean rewriting every read site for ceremony, not protection: there
   is no invariant here for private fields to guard the way ReportValueStore's tier
   resolution needs guarding. Regions + JSDoc (below) are where this file's hygiene
   pass actually earns its keep. ---------------------------------------------------- */
(function () {

//#region shared
// CONFIRMED by the user (2026-07-31) — per-value meaning, own copy of the same note
// iso19438Analysis.js carries (never shared, per CLAUDE.md, even though the set and
// reasoning are identical across all three standards this project supports):
//   Multipass            — the only type this standard's math is actually written for.
//   Single-Pass          — NON-STANDARD but analyzable in the same multipass style: the
//     machine's cleanup filter is ON, so contaminant passes the test filter only once
//     before the cleanup filter (not the test filter) captures it downstream.
//   Multipass Series     — NON-STANDARD, same style: two filters in series, so there's
//     no way to tell which one retained the contaminant.
//   (both of the above: analyzable for efficiency/DP, but NOT for retained mass — see
//   NON_STANDARD_TEST_TYPES and app.js's recomputeIso454812GravimetricDerived)
//   ""                   — pre-dates this header field existing; treated as Multipass.
//   Data Only / PQ / Cyclic Multipass / Cyclic Series Multipass — rejected, same
//   reasons as iso19438Analysis.js's own note.
const VALID_TEST_TYPES = ["Single-Pass", "Multipass", "Multipass Series", ""];
const REJECTED_TEST_TYPES = {
  "Data Only": "This file contains 'Data Only' and cannot generate ISO 4548-12 reports.",
  "P-Q": "This file contains 'P-Q' data and cannot generate ISO 4548-12 reports.",   // CONFIRMED real key (2026-08-03), was "PQ" — never matched a real file
  "Cyclic Multipass": "This file contains 'Cyclic Multipass' data (ISO 23369), not ISO 4548-12.",
  "Cyclic Series Multipass": "This file contains 'Cyclic Series Multipass' data (ISO 23369), not ISO 4548-12."
};
// Own copy per CLAUDE.md, even though this set/reasoning is identical across all
// three standards — see iso19438Analysis.js's own copy for the full rationale.
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
// "" (no Setup header key at all — df.testSetup defaults to "" when absent, see
// dataFile.js) is its own valid single-filter setup, not a validation failure: it
// means the file predates this header field existing at all, from back when a
// standard 2-LB-sensor multipass test had no other setup variant to distinguish
// itself from — there was nothing for the field to express yet. Same treatment as
// VALID_TEST_TYPES already gives "" above, for the same reason.
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
// against too little data to be meaningful. Applied to all three standards this
// project supports (own copy here, per CLAUDE.md, even though the VALUE is shared).
const MIN_TEST_TIME_MINUTES = 25;
const NET_DP_MILESTONES = [5, 10, 15, 20, 40, 80, 100];   // % of net ΔP rise
const HEADER_CLEAN_ASSEMBLY_DP = { section: "General Test Information", key: "CleanAssemblyDP" };

// Termination detection is INLINED into this file (_determineTermination below), not
// pulled from a shared module. Each standard owns its own analysis procedures so one
// can diverge without touching another — see CLAUDE.md's "standards are self-contained"
// rule. The algorithm currently matches ISO 16889's copy because both .DAT files are
// logged by the same control program, but they are deliberately independent. These are
// this standard's own header/channel choices.
const TERMINATION_HEADER_SECTION = "General Test Information";
const TERMINATION_HEADER_KEY = "TerminalDP";
// An ordinary single-filter file logs one differential-pressure channel, TS_DPress.
// A MidstreamFlag: true (dual-filter) file has no TS_DPress at all — confirmed
// against two real files (one "Pressure", one "Two Pressure" Setup) — it logs
// TS_PreDPress (the PRIMARY filter's own ΔP) and TS_FinalDPress (the SECONDARY
// filter's own ΔP) instead, per the user's confirmation. So termination genuinely IS
// per-filter on these files, not shared as originally assumed — resolveDPChannelTag
// picks the right one for whichever filter is currently selected.
const DP_CHANNEL_TAG = "TS_DPress";
const DP_CHANNEL_TAG_PRIMARY = "TS_PreDPress";
const DP_CHANNEL_TAG_SECONDARY = "TS_FinalDPress";

/** @param {DataFile} df @param {string} sensor @returns {string} */
function resolveDPChannelTag(df, sensor) {
  if (!df.midstreamFlag || df.analogTags.indexOf(DP_CHANNEL_TAG) >= 0) return DP_CHANNEL_TAG;
  return sensor === "lb" ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
}
//#endregion

//#region particle count lens — sensor selection, efficiency, sizes, micrometer ratings
/** @type {Record<string,{sizesProp:string,upProp:string,downProp:string,label:string}>}
 *  sensor key -> which DataFile properties carry that sensor's sizes/up/down rows */
const SENSOR_CHANNELS = {
  lb: { sizesProp: "lbSizes", upProp: "lbu", downProp: "lbd", label: "LB (Light Blocking)" },
  ls: { sizesProp: "lsSizes", upProp: "lsu", downProp: "lsd", label: "LS (Light Scattering)" },
  // LBE: the one-off machine's extra LB-type sensor, used only on MidstreamFlag files
  // (see the SENSOR SELECTION note below). It has no up/down pair of its own — LBD
  // (downstream of the primary filter) doubles as its "upstream" reference, since
  // downstream-of-primary and upstream-of-secondary are physically the same tap.
  lbe: { sizesProp: "lbeSizes", upProp: "lbd", downProp: "lbe", label: "Secondary Filter (LBE)" }
};
const DEFAULT_SENSOR = "lb";

// Sensor labels on a MidstreamFlag: true file — "lb"/"ls" are relabeled by FILTER
// ROLE rather than technology name (see the SENSOR SELECTION note above); "lbe"
// already reads correctly as-is via SENSOR_CHANNELS.lbe.label.
const MIDSTREAM_SENSOR_LABELS = { lb: "Primary Filter (LB)", ls: "Secondary Filter (LS)" };

/** The display label for a sensor key, aware of MidstreamFlag context (used by both
 *  availableSensors, for the toolbar picker, and run(), for the report's own
 *  self-identifying "which filter is this" field — same resolution, one place).
 *  @param {string} key @param {DataFile} df @returns {string} */
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
 *     SENSOR_CHANNELS.lbe.upProp above). CONFIRMED against LBLBDataOnly.DAT for the
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

const SKIP_MINUTES = 3;                          // first 3 minutes of counts disregarded (bucket efficiency)
const DISREGARDED_CYCLES = 3;                    // initial count cycles excluded from the averaged total (report field)
const MICROMETER_EFFICIENCY_TARGETS = [50, 75, 90, 97.8, 99];
//#endregion

//#region mass lens — gravimetric mass balance
const HEADER_TEST_FLOWRATE = { section: "Test System Configuration", key: "Rate" };
const HEADER_GRAVIMETRIC = { section: "Injection System Configuration", key: "GravimetricLevel" };
const HEADER_INJECTION_VOLUME = { section: "Injection System Configuration", key: "Volume" };
const INJ_RATE_TAG = "INJ_Rate";
//#endregion

/* =====================================================================================
   Iso454812Analysis
   ===================================================================================== */
class Iso454812Analysis {
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
    /** @type {string} "lb"/"ls"/"lbe" — which sensor's counts this result was computed from */
    this.sensor = DEFAULT_SENSOR;
    /** @type {string} MidstreamFlag-aware display label for `sensor` (see resolveSensorLabel) —
     *  set by run() ONLY on MidstreamFlag files, so the report's self-identifying "which
     *  filter is this" field stays blank on an ordinary single-filter report */
    this.sensorLabel = "";

    // ---- termination (pressure lens) ----
    this.terminationTag = "";
    this.terminationDP = null;
    this.terminationTime = null;   // seconds elapsed, DataFile's time convention
    this.terminationBracket = null; // {before:{time,value}, after:{time,value}}|null — the two
                                     // measured samples terminationTime was interpolated between;
                                     // null when termination instead fell back to "last recorded
                                     // time" because the target was never reached. Audit-trail-only —
                                     // no report reads this field.
    this.terminationFilter = 1;

    this.cleanAssemblyDP = null;   // kPa, the %-net-ΔP baseline

    // ---- %-net-ΔP milestone table (pressure lens) ----
    this.netDPMilestones = [];     // [{ percent, testTimeMin, assyDP, bracket }], one per NET_DP_MILESTONES entry

    // ---- filtration efficiency (particle count lens, selected sensor's sizes) ----
    this.sizes = [];
    this.bucketMinutes = null;     // 5 or 10, per the standard's rule
    this.buckets = [];             // per-time-bucket { startTime, endTime, testTimeMin, upstream[], downstream[],
                                    // efficiency[], countRows: [{time,up[],down[]}] } — countRows is audit-trail-only
                                    // (see iso454812AuditSteps.js's hover tooltips), the raw per-cycle rows actually
                                    // summed into that bucket's upstream/downstream/efficiency, not just the aggregate.
    this.overallEfficiency = [];   // one aggregate efficiency % per size, across the whole valid window
    this.maxEfficiency = [];       // per size, max across buckets
    this.minEfficiency = [];       // per size, min across buckets
    this.micrometerRating = {};    // { "50": "4.2", "75": ">50.0", ... }

    // ---- gravimetric mass balance (mass lens; computable at load time only — see file header) ----
    this.qia = null;               // average injection flow rate over the test, L/min
    this.gia = null;               // average injection gravimetric level, mg/L (header fallback)
    this.ga = null;                // actual base upstream gravimetric level, mg/L
    this.injectedMass = null;      // g — M1, mass actually delivered over the test (flow x concentration x time)
    this.dustAdded = null;         // g — W, total dust measured into the injection reservoir (concentration x reservoir volume)

    // ---- count cycles (particle count lens) ----
    this.totalCounts = null;       // raw record count within the test window, unmodified
    this.countsToAverage = null;   // totalCounts minus the disregarded initial cycles

    this.errors = [];
    this.warnings = [];
  }
  //#endregion

  //#region public API
  /** @param {DataFile} df @param {{sensor?:string, coincidenceLimits?:Record<string,number>}} [options] @returns {Iso454812Analysis} */
  static run(df, options) {
    const analysis = new Iso454812Analysis();
    analysis.sensor = (options && SENSOR_CHANNELS[options.sensor]) ? options.sensor : DEFAULT_SENSOR;
    // Only set on MidstreamFlag files — a printed page needs this to know which of the
    // two filters it represents, but an ordinary single-filter report has nothing to
    // disambiguate, so the report field stays blank there (see resolveSensorLabel).
    if (df.midstreamFlag) analysis.sensorLabel = resolveSensorLabel(analysis.sensor, df);

    // Same validate-and-fall-back-to-first pattern `sensor` uses against
    // availableSensors — only meaningful for a MidstreamFlag:false dual-filter Setup
    // file; availablePressureViews returns [] otherwise, leaving pressureView null.
    const views = Iso454812Analysis.availablePressureViews(df);
    analysis.pressureView = (options && options.pressureView && views.some((v) => v.key === options.pressureView))
      ? options.pressureView
      : (views[0] ? views[0].key : null);

    if (!analysis._validateTestType(df)) return analysis;
    if (!analysis._determineTermination(df)) return analysis;   // pressure lens
    analysis._readCleanBaseline(df);                             // pressure lens
    analysis._computeNetDPMilestones(df);                        // pressure lens

    // Pressure's termination output is the one value both other lenses depend on —
    // passed explicitly from here rather than left as an implicit `this` read inside
    // each lens's own methods, so the dependency is visible at the call site, not
    // just documented in a comment (see FILE ORGANIZATION at the top of this file).
    const termination = {
      terminationTime: analysis.terminationTime,
      terminationTag: analysis.terminationTag,
      overallDPSeries: analysis.overallDPSeries
    };
    analysis._computeBucketEfficiency(df, termination);           // particle count lens
    analysis._computeMicrometerRatings();                          // particle count lens
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
  /* ---- Test type validation. Same acceptance rules as the removed legacy ISO 16889
     engine used — flagged assumption pending confirmation this standard's files use
     the same TestType vocabulary (reasonable default: same control program logs both). ---- */
  _validateTestType(df) {
    const testType = df.testType;
    if (Object.prototype.hasOwnProperty.call(REJECTED_TEST_TYPES, testType)) {
      this.errors.push(REJECTED_TEST_TYPES[testType]);
      return false;
    }
    if (VALID_TEST_TYPES.indexOf(testType) < 0) {
      this.errors.push("Unknown test type: '" + testType + "'. Cannot determine ISO 4548-12 compatibility.");
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
  /* ---- Termination — setup validation + terminal-DP crossing. Inlined per
     standard (see the file-top note): sets this.* directly and returns ok/not-ok. ---- */
  _determineTermination(df) {
    // MidstreamFlag files with a non-dual-filter Setup still go through the
    // unchanged single-filter path below (`Setup` text alone isn't a reliable
    // signal on its own: real files use "Pressure" on one machine and "Two
    // Pressure" on another for the same MidstreamFlag: true scenario — see the
    // SENSOR SELECTION note at the top of this file) — resolveDPChannelTag already
    // handles that case's TS_PreDPress/TS_FinalDPress fallback correctly.
    // "Two Pressure"/"Suction & Pressure" now get their OWN dual-filter path
    // (below), keyed directly off TestSetup per dataFile.js's corrected
    // MidstreamFlag/TestSetup independent-axes note, regardless of MidstreamFlag.
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
      // A real miss means the channel never reached the setpoint — informative, not a
      // silent fallback to whatever the last data point happens to be.
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
        // to the shared overall target rather than leaving the milestone
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
    // in run()) drives display instead — no filter-identity sensor toggle in this
    // case (LB/LS here is measurement technology viewing the whole assembly, not
    // filter identity — see this file's own v1 SCOPE note).
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

  /* ---- Clean assembly ΔP, the %-net-ΔP baseline. ---- */
  _readCleanBaseline(df) {
    const value = toNumber(df.getHeaderValue(HEADER_CLEAN_ASSEMBLY_DP.section, HEADER_CLEAN_ASSEMBLY_DP.key));
    if (value === null) {
      this.warnings.push("Clean assembly ΔP not found in header; %-net-ΔP milestones cannot be computed.");
    }
    this.cleanAssemblyDP = value;
  }

  /* ---- %-net-ΔP milestone table. For each target %, the corresponding
     absolute ΔP is cleanAssemblyDP + pct/100 * (terminalDP - cleanAssemblyDP); the
     crossing time for that absolute value is found the same way termination itself
     is (findCrossingBracket), so the milestone's recorded ΔP is exact by construction —
     no second interpolation needed. ---- */
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

  //#region particle count lens — sensor selection, efficiency, sizes, micrometer ratings, count cycles
  /** Which sensors this file actually has usable (sizes + up/down pair) data for —
   *  the UI's sensor picker is built from this, not from a hardcoded list.
   *  @param {DataFile} df @returns {Array<{key:string,label:string}>} */
  static availableSensors(df) {
    return Object.entries(SENSOR_CHANNELS)
      .filter(([, spec]) => df[spec.sizesProp] && df[spec.sizesProp].length > 0)
      .map(([key]) => ({ key, label: resolveSensorLabel(key, df) }));
  }

  /* Bucket size is 5 minutes for tests up to 1 hour, 10 minutes beyond that.

     Buckets are anchored to a FIXED clock grid measured from test start — 0,
     bucketMinutes, 2*bucketMinutes, ... — not to the disregard cutoff. The first
     SKIP_MINUTES of counts are excluded entirely, which shortens whichever bucket
     the cutoff falls inside; it does NOT push every bucket's boundary forward by
     SKIP_MINUTES. (An earlier version of this code anchored the grid at the skip
     cutoff instead, which gave bucket 1 a full-width span starting right after the
     disregard period — e.g. minutes ~4-8 for a 5-minute bucket — rather than the
     correct, intentionally-shorter minutes-4-5 remainder of the [0,5) grid slot.)

     disregardThrough nudges the cutoff one second past the literal 3-minute mark so
     a row recorded AT exactly SKIP_MINUTES is treated as disregarded too, not kept —
     safe because DataFile.buildTimes rounds every timestamp to a whole second, so a
     1-second nudge can never accidentally swallow a different, legitimate row.

     NO SHARED BOUNDARY ROWS between consecutive buckets: _computeOneWindow's row
     lookup is inclusive on both ends, so if bucket N's window and bucket N+1's window
     both touch the same grid mark, the row sitting exactly on that mark would get
     counted in both — real double-counting, not just a cosmetic overlap. Each
     bucket's window therefore starts at the PREVIOUS bucket's last included time + 1
     second (windowStart, threaded through the loop below), not at the raw grid mark;
     only the END of each window stays pinned to the fixed grid. Confirmed against a
     real file: bucket 1 = minutes 4-5, bucket 2 = minutes 6-10 — bucket 2 starts at
     minute 6, the first UNUSED minute, not minute 5 again.

     `termination` is Pressure's output ({terminationTime, terminationTag}), passed
     in explicitly by run() rather than read off `this` — see FILE ORGANIZATION. */
  _computeBucketEfficiency(df, termination) {
    const { terminationTime, terminationTag, overallDPSeries } = termination;
    const spec = SENSOR_CHANNELS[this.sensor];
    this.sizes = df[spec.sizesProp];
    const sizeCount = this.sizes.length;

    const terminationMinutes = terminationTime / 60;
    this.bucketMinutes = terminationMinutes > 60 ? 10 : 5;

    const skipSeconds = SKIP_MINUTES * 60;
    const disregardThrough = skipSeconds + 1;
    const bucketSeconds = this.bucketMinutes * 60;

    if (disregardThrough >= terminationTime) {
      this.warnings.push("Test duration is shorter than the " + SKIP_MINUTES + "-minute disregard period; no efficiency buckets computed.");
      this.overallEfficiency = new Array(sizeCount).fill(null);
      this.maxEfficiency = new Array(sizeCount).fill(null);
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
        // Table B.2 (per-bucket report page) shows the instantaneous ΔP at each
        // bucket's end time, not an average over the bucket — matches the reference
        // report's "Differential pressure (kPa)" column.
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

    this.maxEfficiency = new Array(sizeCount).fill(null);
    this.minEfficiency = new Array(sizeCount).fill(null);
    for (const bucket of this.buckets) {
      for (let i = 0; i < sizeCount; i++) {
        const eff = bucket.efficiency[i];
        if (eff === null) continue;
        if (this.maxEfficiency[i] === null || eff > this.maxEfficiency[i]) this.maxEfficiency[i] = eff;
        if (this.minEfficiency[i] === null || eff < this.minEfficiency[i]) this.minEfficiency[i] = eff;
      }
    }
  }

  /* _computeOneWindow: average upstream/downstream counts and the resulting
     efficiency % for every size of the SELECTED sensor, over [startSec, endSec].
     Shared by both the per-bucket loop and the single whole-window "overall"
     calculation above. `spec` names which DataFile up/down row arrays to read —
     never hardcoded to df.lbu/df.lbd, so the same method serves LB or LS.

     NO +1 OFFSET on sizeIndex: count rows carry NO leading timestamp field, unlike
     analog rows — a row measuring sizeCount sizes is exactly sizeCount fields wide,
     valid indices 0..sizeCount-1 (verified against real .DAT text: a 32-size file's
     count rows are exactly 32 fields wide). An earlier version of this file read
     [sizeIndex + 1], copied from the analog-row convention without re-checking it
     applied to count rows — it doesn't. That silently shifted every size's
     computed efficiency to the NEXT size's counts, and for the last size in the
     list specifically, read one index past the end of the row (undefined ->
     always null) — the size stayed permanently blank rather than just wrong. This
     changes every previously-displayed ISO 4548-12 efficiency number (Page 1,
     Table B.2, Figures B.2/B.3, micrometer ratings) to the CORRECT size-to-count
     alignment — see CLAUDE.md's ".DAT file handling" rule on this exact class of
     mistake. */
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

  /* ---- Micrometer rating at each standard efficiency target — reverse-
     interpolation against the overall-efficiency-vs-size curve. Same bracket/clamp/
     nearest-fallback shape as the removed legacy ISO 16889 engine's own
     _sizeGivenBeta, retargeted to efficiency % instead of beta ratio (kept local
     rather than shared: the resolution
     rules differ enough — bounded 0-100 here vs. unbounded beta — that forcing a
     shared helper would just add an options object neither engine really needs). ---- */
  _computeMicrometerRatings() {
    for (const targetEff of MICROMETER_EFFICIENCY_TARGETS) {
      this.micrometerRating[String(targetEff)] =
        Iso454812Analysis._sizeGivenEfficiency(targetEff, this.sizes, this.overallEfficiency);
    }
  }

  static _sizeGivenEfficiency(targetEff, sizes, effs) {
    return Iso454812Analysis.sizeGivenEfficiencyDetail(targetEff, sizes, effs).result;
  }

  /** Same interpolation as _sizeGivenEfficiency, but returns the FULL derivation
   *  detail (which two measured points a result was actually interpolated
   *  between, or why not) instead of just the formatted result string — for the
   *  Audit Trail view (iso454812AuditSteps.js) specifically. Not underscore-
   *  prefixed like the other internal statics here — this one IS meant to be
   *  called from outside the class. _sizeGivenEfficiency above now just delegates
   *  here, so there's exactly one implementation of this interpolation, not two
   *  kept in sync by hand.
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

  /* ---- Count cycles. totalCounts is the raw, unmodified number of particle-
     count records within the test window (0 to termination); countsToAverage is that
     total minus the initial DISREGARDED_CYCLES records — a plain cycle count, distinct
     from _computeBucketEfficiency's SKIP_MINUTES (a time-based window used for the
     efficiency calculation itself, not this display figure). `termination` is
     Pressure's output, passed in explicitly — see FILE ORGANIZATION. ---- */
  _computeCountCycles(df, termination) {
    const { terminationTime } = termination;
    const [startRow, endRow] = findRowRange(df.times, 0, terminationTime);
    if (startRow === null || endRow === null) return;

    this.totalCounts = endRow - startRow + 1;
    this.countsToAverage = Math.max(0, this.totalCounts - DISREGARDED_CYCLES);
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
  /* ---- Gravimetric mass balance — only the part computable without a
     user-entered final gravimetric level (see file header note). `terminationTime`
     is Pressure's output, passed in explicitly — see FILE ORGANIZATION. ---- */
  _computeGravimetricMassBalance(df, terminationTime) {
    const injRate = df.getChannel(INJ_RATE_TAG);
    this.qia = averageSeries(injRate);   // mL/min — matches the channel/header unit, kept as-is for display
    if (this.qia === null) {
      this.warnings.push(INJ_RATE_TAG + " channel not found; average injection flow rate (Qia) unavailable.");
    }

    this.gia = toNumber(df.getHeaderValue(HEADER_GRAVIMETRIC.section, HEADER_GRAVIMETRIC.key));
    if (this.gia === null) {
      this.warnings.push("Gravimetric level not found in header; enter initial/final gravimetric results by hand.");
    }

    // Ga divides by the Test System's L/min flow rate, and Injected Mass multiplies by
    // an mg/L concentration to get a mass — both need qia in L/min, not the mL/min it's
    // stored/displayed in. Converted once here rather than inline per formula: an
    // earlier version divided Ga's FINAL result by 1000 to compensate for this same
    // missing conversion, which happened to be numerically equivalent for Ga alone but
    // was never applied to Injected Mass, which was silently off by 1000x as a result
    // (confirmed against a real file: computed 4504.49 g against an expected ~4.5 g).
    const qiaLPerMin = this.qia === null ? null : this.qia / 1000;

    const testFlowQ = toNumber(df.getHeaderValue(HEADER_TEST_FLOWRATE.section, HEADER_TEST_FLOWRATE.key));
    if (qiaLPerMin !== null && this.gia !== null && testFlowQ !== null && testFlowQ > 0) {
      this.ga = (this.gia * qiaLPerMin) / testFlowQ;
    }

    if (qiaLPerMin !== null && this.gia !== null) {
      const terminationMinutes = terminationTime / 60;
      this.injectedMass = (qiaLPerMin * this.gia * terminationMinutes) / 1000;   // mg -> g
    }

    // Dust Added W: total dust measured into the injection reservoir — gravimetric
    // level (mg/L) x the reservoir's own total volume (L, Injection System
    // Configuration's "Volume", same header volumeVi displays) / 1000 (mg -> g). NOT
    // the same quantity as Injected Mass M1 above (that's mass actually delivered
    // over the test's duration, via flow-rate integration) — W is simply "how much
    // dust went into the batch," independent of how much of it got pumped through.
    const injectionVolume = toNumber(df.getHeaderValue(HEADER_INJECTION_VOLUME.section, HEADER_INJECTION_VOLUME.key));
    if (this.gia !== null && injectionVolume !== null) {
      this.dustAdded = (this.gia * injectionVolume) / 1000;   // mg -> g
    }
    // Non-retained mass / retained capacity: NOT computed here — see file header note.
  }

  /** Non-Retained Mass (Mnr) / Retained Capacity (Cr) — NOT computed as part of run()
   *  since Gf (final test gravimetric level) has no header fallback; it only exists
   *  once a lab enters it by hand after processing gravimetric samples post-test (see
   *  the file-header note). Called from the gravimetric entry dialog's save handler
   *  instead (app.js), once Gf is actually known.
   *
   *  Per the user: Mnr = final test volume (assumed equal to the test's initial
   *  Volume, since a separately-measured final volume isn't tracked) x Gf, mg -> g;
   *  Cr = what was injected (M1) minus what wasn't retained (Mnr).
   *  @param {{testVolume:number|null, gf:number|null, injectedMass:number|null}} inputs
   *  @returns {{nonRetainedMass:number|null, retainedCapacity:number|null}} */
  static computeMassBalance({ testVolume, gf, injectedMass }) {
    if (testVolume === null || testVolume === undefined ||
        gf === null || gf === undefined ||
        injectedMass === null || injectedMass === undefined) {
      return { nonRetainedMass: null, retainedCapacity: null };
    }
    const nonRetainedMass = (testVolume * gf) / 1000;   // L x mg/L -> mg, /1000 -> g
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
  module.exports = { Iso454812Analysis };
}
if (typeof window !== "undefined") {
  window.Iso454812Analysis = Iso454812Analysis;
}
//#endregion

})();

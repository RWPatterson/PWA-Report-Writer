"use strict";
/* =====================================================================================
   iso23369Analysis.js  —  ISO 23369:2022 analysis engine (cyclic multipass).
   =====================================================================================
   Clean build against the published standard's outline text (clauses 10.2-13.8).
   Explicitly modeled on iso16889Analysis.js (same beta/filtration-ratio math shape,
   same 10%-100% reporting-time bucket structure) — own copy of every procedure per
   CLAUDE.md, even where the shape matches, NOT a shared base class.

   -------------------------------------------------------------------------------------
   WHAT'S GENUINELY DIFFERENT FROM ISO 16889, AND WHY
   -------------------------------------------------------------------------------------
   1. TWO FILES PER TEST. The rig also writes a "-Cyclic.DAT" companion file (parsed by
      core/cyclicCompanionFile.js), sampled ~5s vs. the primary file's ~60s — needed
      because the primary file's cadence can't resolve a ~10s flow cycle. Threaded in
      as options.companionFile; falls back to the primary file's own coarser channel
      (warn, don't block) when absent — see companionFileMissing / _resolveDPSource.

   2. THE Δp SIGNAL OSCILLATES — TERMINATION NEEDS A PHASE SPLIT. Confirmed against a
      real fixture: the companion file's TS_DPress alternates every ~5s between a
      low-flow trough (~50 kPa) and a high-flow peak (~345 kPa), one of each per flow
      cycle. Feeding that raw alternating series into findCrossingBracket (which
      assumes a monotonically-trending signal) would trigger on the very first
      high-flow upswing. Fix: classify each companion row as high-flow or low-flow by
      its own Cycle number's parity (whole integer vs. ".5" — the file's own
      structural phase marker, confirmed to increment by exactly 0.5/row across every
      real fixture), NOT a TS_Rate-vs-qAvg threshold — see splitFlowPhasesByCycle's
      own header comment for the real bug (2026-08-20, live user report) that
      threshold approach had: a header-derived qAvg can be wrong/off-scale relative
      to the companion file's own real TS_Rate values, which can starve or empty a
      phase entirely under a magnitude threshold even with plenty of real samples.
      Then run termination search AND reporting-time ΔP interpolation (12.2) against
      the HIGH-FLOW-PHASE sub-series only — see splitFlowPhasesByCycle/_resolveDPSource.
      // ASSUMED: this phase-split approach is this engine's own derivation from the
      real fixture data, not stated in the standard's own text — flag for confirmation.

   3. CLEAN/FINAL ΔP DIRECTION IS REVERSED FOR THE FINAL PAIR (not the clean pair).
      ISO 16889 treats header TerminalDP as the ASSEMBLY-level crossing target and
      DERIVES element ΔP (= terminationDP - housing). This standard's own text (11.3)
      states the opposite: TerminalDP is the final ELEMENT ΔP directly, and assembly
      ΔP (= elementFinal + housing) is the derived value used as the crossing target.
      // ASSUMED: implemented per the standard's own quoted text; the one available
      real fixture has CleanHousingDP=0, which makes the two directions numerically
      indistinguishable there — needs a second fixture or the published text to fully
      confirm. The CLEAN pair (11.2) is unchanged from ISO 16889's own direction.

   4. RETAINED CAPACITY (13.3, formula 16) differs from ISO 16889's Dust_Retained in
      two real, standard-specific ways, not zero: term 3 uses UPSTREAM sample flow
      (qu), matching ISO 19438's Mnr pattern — NOT ISO 16889's, which uses downstream
      (qd) in both flow-weighted terms; and term 1 uses the computed final INJECTION
      volume (11.15), not a test-system volume field. See computeMassBalance's own
      comment for the full diff.

   5. RATIO/BUCKET GRANULARITY GENERALIZES PAST WHOLE MINUTES. ISO 16889 rounds bucket
      boundaries up to whole MINUTES because every one of its fixtures has a ~60s
      count cycle. This standard's own text explicitly anticipates shorter cycles
      (a 15s worked example). Buckets here round up to the next whole COUNT-CYCLE
      LENGTH (df.countTimeSec + df.holdTimeSec) instead of a hardcoded 60 — see
      _computeReportingTimeClumps. Validated against the standard's own 15s example:
      180s / 15s = 12 disregarded counts, exactly as stated.

   -------------------------------------------------------------------------------------
   Terminology: this standard calls its filtration ratio "a" (a_x,t / a_bar_x(c)), not
   "beta" — fields/constants below are named accordingly (avgRatio, STANDARD_RATIOS,
   sizeAtRatio) even though the underlying upstream/downstream math is the same shape
   as ISO 16889's beta.

   ENCAPSULATION NOTE (per CLAUDE.md's code-hygiene rule): plain public fields, not
   private #fields + getters — same precedent as iso16889Analysis.js/iso454812Analysis.js:
   this class is a read-only-by-convention result bag iso23369Mapper.js reads directly;
   there's no invariant here for private fields to guard.

   Deliberately NOT built in this pass: an "initial system cleanliness" pre-injection
   count table (ISO 16889's own _computeInitialCleanliness) — not asked for by this
   standard's own Page 1 field list, and no real cyclic fixture has been checked for a
   matching aux block. Add it later, following ISO 16889's own pattern, if wanted.

   Wrapped in an IIFE — index.html loads this and every other standard's analysis
   engine as classic <script> tags sharing one global scope, so internal names must
   not leak and collide with a sibling standard's own top-level declarations.
   ===================================================================================== */
(function () {

//#region shared
// This standard is CYCLIC-flow only — the four existing standards' own TestType
// rejection tables already anticipate this by name (own copy of that same fact here,
// pointed the other way).
const VALID_TEST_TYPES = ["Cyclic Multipass", "Cyclic Series Multipass", ""];
const REJECTED_TEST_TYPES = {
  "Data Only": "This file contains 'Data Only' and cannot generate ISO 23369 reports.",
  "P-Q": "This file contains 'P-Q' data and cannot generate ISO 23369 reports.",
  "Multipass": "This file contains steady-flow 'Multipass' data (ISO 16889/4548-12/19438), not cyclic-flow ISO 23369.",
  "Single-Pass": "This file contains steady-flow 'Single-Pass' data (ISO 16889/4548-12/19438), not cyclic-flow ISO 23369.",
  "Multipass Series": "This file contains steady-flow 'Multipass Series' data (ISO 16889/4548-12/19438), not cyclic-flow ISO 23369."
};
// // ASSUMED: no "Cyclic Single-Pass"-equivalent TestType value found in any real
// fixture or in the standard's own text — only the series variant is modeled as
// non-standard here, unlike ISO 16889's two-entry NON_STANDARD_TEST_TYPES.
const NON_STANDARD_TEST_TYPES = ["Cyclic Series Multipass"];
const NON_STANDARD_RETAINED_MASS_REASON = {
  "Cyclic Series Multipass": "Retained mass analysis is not valid for a Cyclic Series Multipass test: with two filters in series, it is not possible to determine which filter retained the contaminant."
};

const analysisMathLib = (typeof module !== "undefined") ? require("../../helpers/analysisMath.js") : window.AnalysisMath;
const { findCrossingBracket, interpolateAt, toNumber, formatElapsed, sumChannels } = analysisMathLib;
const coincidenceLimitLib = (typeof module !== "undefined") ? require("../../helpers/coincidenceLimitCheck.js") : window.CoincidenceLimitCheck;
const { checkCoincidenceLimit, formatMinuteRanges, DEFAULT_LB_COINCIDENCE_LIMIT, DEFAULT_LS_COINCIDENCE_LIMIT } = coincidenceLimitLib;
//#endregion

//#region pressure lens — channels, flow rates, termination, clean/element ΔP
// Own copies of ISO 16889's TestSetup vocabulary/values — same underlying rig concept
// (confirmed generic .DAT format), replicated per CLAUDE.md's never-share rule even
// though none of the three real cyclic fixtures exercise anything but the plain
// single-filter path (no "Setup" header key present in any of them — // ASSUMED
// generalization, unconfirmed by a real cyclic fixture).
const SINGLE_FILTER_SETUPS = ["Spin On", "Pressure", "Suction", "Flat Sheet", ""];
const DUAL_FILTER_SETUPS = ["Two Pressure", "Suction & Pressure"];
const NON_STANDARD_SETUPS = ["Suction", "Two Pressure", "Suction & Pressure"];
const DUAL_FILTER_RETAINED_MASS_REASON =
  "Retained mass analysis is not valid for a dual-filter (series) Test Setup: with " +
  "two filters in series, it is not possible to determine which filter retained the contaminant.";
const MIN_TEST_TIME_MINUTES = 25;

const TERMINATION_HEADER_SECTION = "General Test Information";
const TERMINATION_HEADER_KEY = "TerminalDP";
const DP_CHANNEL_TAG = "TS_DPress";
const DP_CHANNEL_TAG_PRIMARY = "TS_PreDPress";
const DP_CHANNEL_TAG_SECONDARY = "TS_FinalDPress";
// The companion file's own flow-rate channel — confirmed real (same tag as the
// primary file's own TS_Rate), read for its OWN value (Table 2's flow-rate check,
// _checkTestFlowRateTolerance) once a row's phase is already known.
const CYCLIC_RATE_TAG = "TS_Rate";
// The companion file's own cycle-number channel (cyclicCompanionFile.js — every
// real fixture confirmed to increment by exactly 0.5 per row). Used to classify
// each row into the high-flow/low-flow phase — see splitFlowPhasesByCycle's own
// header comment for why this replaced a rate-vs-qAvg threshold comparison.
const CYCLIC_CYCLE_TAG = "Cycle";

const HEADER_CLEAN_HOUSING_DP = { section: "General Test Information", key: "CleanHousingDP" };
const HEADER_CLEAN_ASSEMBLY_DP = { section: "General Test Information", key: "CleanAssemblyDP" };
// Test System Configuration's own "Rate" — for ISO 16889 this is the one steady test
// flow; for this standard it's q_min, the LOW-flow setpoint (confirmed against two
// real fixtures: 12.5 and 25 L/min, each matching that fixture's own observed
// low-flow band exactly).
const HEADER_TEST_FLOWRATE_MIN = { section: "Test System Configuration", key: "Rate" };
// // ASSUMED formula (not a confirmed header key): q_max = q_min x FlowRatio. No
// separate "q_max" setpoint exists anywhere in any of the three real fixtures'
// headers — confirmed by exhaustive search — but this formula reproduces the
// observed high-flow band exactly in BOTH fixtures checked (12.5x4=50, 25x4=100).
const HEADER_FLOW_RATIO = { section: "Cyclic Configuration", key: "FlowRatio" };
// Both upstream (index 0) and downstream (index 1) — this standard's own
// Dust_Retained formula (13.3) needs BOTH, unlike ISO 16889's Dust_Retained (which
// only ever needs the downstream value) — see computeMassBalance's own comment.
const HEADER_SAMPLE_FLOW = { section: "Dilution System Configuration", key: "SampleFlow" };

/** @param {DataFile} df @param {string} sensor @returns {string} */
function resolveDPChannelTag(df, sensor) {
  if (!df.midstreamFlag || df.analogTags.indexOf(DP_CHANNEL_TAG) >= 0) return DP_CHANNEL_TAG;
  return sensor === "lb" ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
}
//#endregion

//#region particle count lens — sensor selection, reporting-time buckets, ratio math
/** @type {Record<string,{sizesProp:string,upProp:string,downProp:string,label:string}>} */
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

/** Own copy of iso16889Analysis.js's identical-purpose resolver — see that file's own
 *  extensive comment for the three-scheme rationale (single-sensor/plain-dual/
 *  midstream). Re-derived here per CLAUDE.md, same underlying rig concept.
 *  @param {DataFile} df @param {string} sensorKey @returns {{upRatioTag:string|null, downRatioTag:string|null}|null} */
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

/** @param {string} sensorKey @param {"Upstream"|"Downstream"} location @returns {string} */
function coincidenceOverrideKey(sensorKey, location) {
  if (sensorKey === "lb") return location === "Upstream" ? "sensorUpstreamCoincidenceLimit" : "sensorDownstreamCoincidenceLimit";
  if (sensorKey === "ls") return location === "Upstream" ? "lsSensorUpstreamCoincidenceLimit" : "lsSensorDownstreamCoincidenceLimit";
  return "lbeSensorCoincidenceLimit";
}

const SKIP_SECONDS = 180;   // first 3 minutes of counts disregarded (12.5a) — same
                             // total disregard period as ISO 16889, expressed in
                             // seconds so it can round to a non-60s count cycle (finding #5)
const STANDARD_RATIOS = [2, 10, 75, 100, 200, 1000];   // confirmed standard-derived — Page 1's own filtration-ratio table columns
const MAX_RATIO_VALUE = 100000;   // confirmed standard-derived — 13.6's own stated ceiling for the semi-log plot
//#endregion

//#region mass lens — injection flow rate, gravimetric mass balance
const HEADER_INJ_FLOWRATE_SETPOINT = { section: "Injection System Configuration", key: "Rate" };
const INJ_RATE_TAG = "INJ_Rate";
const HEADER_INJECTION_VOLUME = { section: "Injection System Configuration", key: "Volume" };
const HEADER_INJ_GRAVIMETRIC_SETPOINT = { section: "Injection System Configuration", key: "GravimetricLevel" };

const INJ_FLOWRATE_TOLERANCE_PCT = 5;      // 11.7 / Table 2
const INJ_GRAVIMETRIC_TOLERANCE_PCT = 5;   // 12.9
const BUGL_TOLERANCE_PCT = 10;             // 12.12 / Table 2
const TEST_FLOWRATE_TOLERANCE_PCT = 5;     // Table 2 — checked per-phase, see _checkTestFlowRateTolerance
//#endregion

/* =====================================================================================
   Iso23369Analysis
   ===================================================================================== */
class Iso23369Analysis {
  //#region construction / state
  constructor() {
    // ---- test type ----
    this.testType = "";
    this.nonStandardTestType = false;
    this.retainedMassSuppressedReason = null;

    // ---- test setup ----
    this.nonStandardSetup = false;
    this.dualFilterSetup = false;
    this.dualFilterRetainedMassReason = null;

    // ---- pressure-view selection (MidstreamFlag:false dual-filter files only) ----
    this.pressureView = null;
    /** @type {{times:Array<number|null>, values:Array<number|null>}|null} set only
     *  when pressureView==="overall" — see _resolveDualFilterDisplay */
    this.overallDPSource = null;
    /** @type {{times:Array<number|null>, values:Array<number|null>}|null} the
     *  companion file's own high/low-flow-phase ΔP sub-series against the SINGLE-
     *  filter termination channel (terminationTag) — set once, single-filter path
     *  only, by _computeCompanionPhaseDPSeries. Report-content consumption (Figure
     *  C.1's own two-series plot) reads these directly rather than re-deriving the
     *  phase split itself, per CLAUDE.md (phase-splitting is analysis PROCEDURE,
     *  owned here, never re-derived in reportView.js). null whenever no usable
     *  companion file is present, or for the dual-filter/"overall" pressure view
     *  (unconfirmed by any real cyclic fixture — same scope note build23369MassInjectedData's own comment gives). */
    this.companionHighDPSeries = null;
    this.companionLowDPSeries = null;

    // ---- sensor selection ----
    this.sensor = DEFAULT_SENSOR;
    this.sensorLabel = "";

    // ---- flow rates (10.2.1) ----
    this.qMin = null;       // L/min — Test System Configuration/Rate (the low-flow setpoint)
    this.flowRatio = null;  // Cyclic Configuration/FlowRatio
    this.qMax = null;       // L/min — computed: qMin x flowRatio (// ASSUMED formula — see file-top note)
    this.qAvg = null;       // L/min — 10.2.1: (qMax+qMin)/2; also the high/low-flow-phase classification threshold

    // ---- cyclic companion file ----
    this.companionFileMissing = true;   // see run() — true whenever no usable companion was supplied

    // ---- termination (pressure lens) ----
    this.terminationTag = "";
    this.terminationDP = null;       // the DERIVED assembly-level crossing target (finding #3)
    this.terminationTime = null;     // seconds elapsed
    this.terminationBracket = null;
    this.terminationFilter = 1;

    // ---- clean/element ΔP (pressure lens) ----
    this.dpHousingClean = null;
    this.dpAssemblyClean = null;
    this.dpElementClean = null;   // 11.2 — computed: assembly - housing, SAME direction as ISO 16889
    this.dpElementFinal = null;   // 11.3 — supplied DIRECTLY by the header (finding #3, reversed from ISO 16889)

    // ---- reporting-time buckets (particle count lens) — 10 entries, always ----
    this.sizes = [];
    /** @type {Array<{percent:number, startMin:number, stopMin:number, testTimeMin:number,
     *  assemblyDP:number|null, elementDP:number|null,
     *  avgUp:Array<number|null>, avgDown:Array<number|null>, avgRatio:Array<number|null>,
     *  countRows:Array<{time:number, up:Array<number|null>, down:Array<number|null>}>}>} */
    this.clumps = [];
    this.overallUpstreamAverage = [];
    this.overallDownstreamAverage = [];
    this.overallAverageRatio = [];
    this.sizeAtRatio = {};   // { "2": "4.2", "10": "<4.0", ... }

    // ---- mass lens: what's computable at run() time (no hand-entry needed) ----
    this.qia = null;   // mL/min — Ave_Injection_Flow, live INJ_Rate channel average
    this.qu = null;    // mL/min — upstream Sample Flow header setpoint (13.3's term 3)
    this.qd = null;    // mL/min — downstream Sample Flow header setpoint (13.3's term 2)
    this.injectionGravSetpoint = null;
    this.injectionFlowSetpoint = null;
    this.buglTarget = null;   // mg/L — design-target BUGL, setpoints run through computeAverageBUGL
    this.injVolumeInitial = null;   // L
    this.injVolumeFinal = null;     // L — computed (11.15), still user-editable in the report

    this.errors = [];
    this.warnings = [];
  }
  //#endregion

  //#region public API
  /** @param {DataFile} df @param {{sensor?:string, pressureView?:string,
   *    companionFile?:import("../../core/cyclicCompanionFile.js").CyclicCompanionFile,
   *    coincidenceLimits?:Record<string,number>}} [options] @returns {Iso23369Analysis} */
  static run(df, options) {
    const analysis = new Iso23369Analysis();
    analysis.sensor = (options && SENSOR_CHANNELS[options.sensor]) ? options.sensor : DEFAULT_SENSOR;
    if (df.midstreamFlag) analysis.sensorLabel = resolveSensorLabel(analysis.sensor, df);

    const views = Iso23369Analysis.availablePressureViews(df);
    analysis.pressureView = (options && options.pressureView && views.some((v) => v.key === options.pressureView))
      ? options.pressureView
      : (views[0] ? views[0].key : null);

    const companion = (options && options.companionFile) || null;

    // Order matters here, per the user (2026-08-21, live report): a file that can
    // NEVER be reportable regardless of companion file should be rejected BEFORE
    // any companion-related warning is generated — seeing "no companion file
    // supplied" on a test that's being thrown out anyway (and was never even
    // offered the auto-prompt to supply one — that's also gated on analysis.ok, see
    // app.js's maybePromptForCompanionFile) reads as confusing, backwards ordering.
    if (!analysis._validateTestType(df)) return analysis;
    if (!analysis._checkMinimumFileSpan(df)) return analysis;

    analysis.companionFileMissing = !companion || !companion.dataExist;
    // Real gap found 2026-08-20: CyclicCompanionFile.warnings (alignToPrimary's own
    // wrong-file/timestamp-mismatch check, plus app.js's own filename-mismatch
    // check) was never actually read anywhere — a warning could sit in that array
    // and never reach the user. Merged in here, once, so it flows through the same
    // warnings dialog/inline-marker pipeline as every other warning this engine
    // produces, rather than needing its own separate display path.
    if (companion) analysis.warnings.push(...companion.warnings);
    if (analysis.companionFileMissing) {
      analysis.warnings.push(
        "No cyclic companion file (\"-Cyclic.DAT\") was supplied — falling back to the primary " +
        "file's own once-a-minute samples for the assembly ΔP trend. This cannot fully resolve " +
        "the flow cycle (11.11); Table C.3's differential-pressure values may be less precise than " +
        "the standard intends. Add the matching \"-Cyclic.DAT\" file for the full-resolution result.");
    }

    analysis._computeFlowRates(df);           // 10.2.1 — needed before the phase split below
    analysis._checkTestFlowRateTolerance(companion);   // Table 2 — independent of termination succeeding
    analysis._readCleanBaselines(df);          // 11.2 — needed before termination (finding #3)
    if (!analysis._determineTermination(df, companion)) return analysis;

    const termination = {
      terminationTime: analysis.terminationTime,
      terminationTag: analysis.terminationTag,
      overallDPSource: analysis.overallDPSource
    };
    analysis._computeReportingTimeClumps(df, companion, termination);
    analysis._computeOverallAverages();
    analysis._computeSizeAtRatio();
    analysis._checkCoincidenceLimit(df, options && options.coincidenceLimits);

    analysis._computeInjectionFlowRate(df, termination.terminationTime);
    analysis._computeSampleFlows(df);

    return analysis;
  }

  // Cheap pre-run check, driven by the sidebar to decide which standard buttons stay
  // enabled once a file is loaded — own copy per standard (see CLAUDE.md's no-shared-
  // procedures rule), each just reading its own already-private VALID_TEST_TYPES. A
  // CyclicCompanionFile never reaches here (app.js keeps every standard button enabled
  // when currentDf is a companion file, since it has no .testType of its own).
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
      this.errors.push("Unknown test type: '" + testType + "'. Cannot determine ISO 23369 compatibility.");
      return false;
    }

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

  /** Cheap, companion-independent early rejection — see run()'s own comment on WHY
   *  this runs before any companion-related warning is generated. The PRIMARY
   *  file's own recorded span is an upper bound on whatever terminationTime the
   *  full search could ever resolve to (a genuinely matching companion file
   *  observes the SAME physical test, not a longer one — see
   *  cyclicCompanionFile.js's own PLAUSIBLE_START_OFFSET_SEC note), so a primary
   *  file whose own recording is already shorter than the 25-minute minimum can
   *  be rejected immediately, without running the full crossing search — or
   *  touching companion-file logic — at all. NOT a replacement for the precise
   *  post-termination check in _determineTermination/_determineDualFilterTermination
   *  (a file that spans long enough overall can still cross its target — or run
   *  out of real data — well before the 25-minute mark); this only catches the
   *  unambiguous case where the file could never reach it regardless.
   *  @param {DataFile} df @returns {boolean} true if long enough to proceed */
  _checkMinimumFileSpan(df) {
    const times = df.times.filter((t) => t !== null);
    const spanSec = times.length > 0 ? times[times.length - 1] - times[0] : 0;
    if (spanSec < MIN_TEST_TIME_MINUTES * 60) {
      this.errors.push(
        "Test duration (" + formatElapsed(spanSec) + ") is under the " +
        MIN_TEST_TIME_MINUTES + "-minute minimum required to generate a report.");
      return false;
    }
    return true;
  }
  //#endregion

  //#region pressure lens — flow rates, channels, termination, clean/element ΔP, DP source resolution
  /** 10.2.1: q_bar = (q_max+q_min)/2. q_min is the confirmed Test System Rate header;
   *  q_max has no confirmed header of its own — derived as q_min x FlowRatio
   *  (// ASSUMED formula, see file-top note). @param {DataFile} df */
  _computeFlowRates(df) {
    this.qMin = toNumber(df.getHeaderValue(HEADER_TEST_FLOWRATE_MIN.section, HEADER_TEST_FLOWRATE_MIN.key));
    this.flowRatio = toNumber(df.getHeaderValue(HEADER_FLOW_RATIO.section, HEADER_FLOW_RATIO.key));
    if (this.qMin === null || this.flowRatio === null) {
      this.warnings.push("Test flow rate (Test System Configuration/Rate) or Flow Ratio (Cyclic Configuration/FlowRatio) " +
        "not found in header; average test flow (q̄, 10.2.1) cannot be computed.");
      return;
    }
    this.qMax = this.qMin * this.flowRatio;
    this.qAvg = (this.qMax + this.qMin) / 2;
  }

  /** Table 2's "Test flow rate ±5%" — own analysis-level check, NOT a
   *  iso23369ControlTargets.js row (see that file's own comment for why the generic
   *  channelTag/headerFallback engine can't express this correctly). TS_Rate spends
   *  the whole test alternating between q_min and q_max, so a flat whole-test
   *  average compared against ONE target is checking the wrong quantity entirely —
   *  real incident, 2026-08-20: a rig genuinely tracking its setpoints correctly
   *  still failed a flat q_min-only check, because the flat average necessarily
   *  landed somewhere between q_min and q_max, nowhere near either. Fix: classify
   *  the companion file's own TS_Rate samples into high/low phase (same
   *  splitFlowPhasesByCycle termination/ΔP-interpolation already use) and check
   *  EACH phase's own average against its own target independently.
   *  Needs the companion file's higher resolution — the primary file's once-a-minute
   *  TS_Rate samples land at effectively random phase against a ~10s cycle (aliased),
   *  so this is silently skipped without one; companionFileMissing's own warning
   *  already explains the broader reduced-fidelity consequence.
   *  @param {import("../../core/cyclicCompanionFile.js").CyclicCompanionFile|null} companion */
  _checkTestFlowRateTolerance(companion) {
    if (!companion || !companion.dataExist || this.qMin === null || this.qMax === null || this.qAvg === null) return;
    const rateChannel = companion.getChannel(CYCLIC_RATE_TAG);
    const cycleChannel = companion.getChannel(CYCLIC_CYCLE_TAG);
    if (!rateChannel || !cycleChannel) return;

    const { highIndices, lowIndices } = splitFlowPhasesByCycle(rateChannel, cycleChannel);
    const highAvg = averageSeries(projectByIndices(rateChannel, highIndices));
    const lowAvg = averageSeries(projectByIndices(rateChannel, lowIndices));

    const checkPhase = (label, actual, target) => {
      if (actual === null || target === null || target <= 0) return;
      const deltaPct = Math.abs(actual - target) / target * 100;
      if (deltaPct > TEST_FLOWRATE_TOLERANCE_PCT) {
        this.warnings.push(
          label + "-flow-phase test flow rate (" + actual.toFixed(2) + " L/min, from the companion file) is " +
          deltaPct.toFixed(1) + "% off the " + target.toFixed(2) + " L/min target — outside the ±" +
          TEST_FLOWRATE_TOLERANCE_PCT + "% the standard requires (Table 2).");
      }
    };
    checkPhase("Low", lowAvg, this.qMin);
    checkPhase("High", highAvg, this.qMax);
  }

  /* ---- Filter housing / clean assembly ΔP (headers), plus the ONE computed value
     that's unchanged from ISO 16889's own direction: clean element = clean assembly -
     housing (11.2). The FINAL pair is handled inside _determineTermination instead —
     see finding #3, it's the reversed one. ---- */
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
  }

  /** Resolves which {times, values} series to search/interpolate assembly ΔP
   *  against — the companion file's own high-flow-phase sub-series when usable (see
   *  finding #2), or the primary file's raw channel directly as a fallback (no phase
   *  split needed there — its own once-a-minute sampling already can't resolve
   *  individual cycles).
   *  @param {DataFile} df @param {import("../../core/cyclicCompanionFile.js").CyclicCompanionFile|null} companion
   *  @param {string} dpChannelTag @returns {{times:Array<number|null>, values:Array<number|null>}|null} */
  _resolveDPSource(df, companion, dpChannelTag) {
    if (companion && companion.dataExist) {
      const rateChannel = companion.getChannel(CYCLIC_RATE_TAG);
      const cycleChannel = companion.getChannel(CYCLIC_CYCLE_TAG);
      const dpChannel = companion.getChannel(dpChannelTag);
      if (rateChannel && cycleChannel && dpChannel &&
          rateChannel.length === dpChannel.length && cycleChannel.length === dpChannel.length &&
          companion.times.length === dpChannel.length) {
        const { highIndices } = splitFlowPhasesByCycle(rateChannel, cycleChannel);
        if (highIndices.length >= 2) {
          return { times: projectByIndices(companion.times, highIndices), values: projectByIndices(dpChannel, highIndices) };
        }
        this.warnings.push("The cyclic companion file didn't have enough high-flow-phase samples to resolve " +
          "a pressure trend; falling back to the primary file's coarser samples.");
      } else {
        this.warnings.push("The cyclic companion file is present but doesn't have the channels needed (" +
          CYCLIC_RATE_TAG + "/" + CYCLIC_CYCLE_TAG + "/" + dpChannelTag + ") to resolve the high-flow-phase " +
          "pressure trend; falling back to the primary file's coarser samples.");
      }
    }
    const primaryValues = df.getChannel(dpChannelTag);
    const primaryTimes = df.times;
    if (!primaryValues || !primaryTimes || primaryValues.length === 0) return null;
    return { times: primaryTimes, values: primaryValues };
  }

  /** Populates companionHighDPSeries/companionLowDPSeries (see their own field
   *  comments) — BOTH phases of the companion file's own ΔP signal against
   *  dpChannelTag, for Figure C.1's two-series plot. Own small duplicate of
   *  _resolveDPSource's channel-fetching (rather than having that function grow a
   *  second return shape) — _resolveDPSource is called from several places for
   *  several different tags (termination search, reporting-time interpolation,
   *  dual-filter variants); this is called exactly ONCE, from the single-filter
   *  termination path, for the one tag Figure C.1 actually plots
   *  (terminationTag) — see that field's own scope note.
   *  @param {import("../../core/cyclicCompanionFile.js").CyclicCompanionFile|null} companion
   *  @param {string} dpChannelTag */
  _computeCompanionPhaseDPSeries(companion, dpChannelTag) {
    if (!companion || !companion.dataExist) return;
    const rateChannel = companion.getChannel(CYCLIC_RATE_TAG);
    const cycleChannel = companion.getChannel(CYCLIC_CYCLE_TAG);
    const dpChannel = companion.getChannel(dpChannelTag);
    if (!rateChannel || !cycleChannel || !dpChannel ||
        rateChannel.length !== dpChannel.length || cycleChannel.length !== dpChannel.length ||
        companion.times.length !== dpChannel.length) return;

    const { highIndices, lowIndices } = splitFlowPhasesByCycle(rateChannel, cycleChannel);
    if (highIndices.length >= 2) {
      this.companionHighDPSeries = { times: projectByIndices(companion.times, highIndices), values: projectByIndices(dpChannel, highIndices) };
    }
    if (lowIndices.length >= 2) {
      this.companionLowDPSeries = { times: projectByIndices(companion.times, lowIndices), values: projectByIndices(dpChannel, lowIndices) };
    }
  }

  _determineTermination(df, companion) {
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
      this.dualFilterRetainedMassReason = DUAL_FILTER_RETAINED_MASS_REASON;
      this.warnings.push(this.dualFilterRetainedMassReason);
      return this._determineDualFilterTermination(df, companion);
    }

    // ---- single-filter path ----
    if (this.dpHousingClean === null) {
      this.errors.push("Filter housing ΔP not found in header; cannot derive the assembly-level termination target.");
      return false;
    }
    // finding #3: TerminalDP is the final ELEMENT ΔP directly (11.3); the
    // ASSEMBLY-level crossing target is the derived value, the reverse of ISO 16889.
    const dpElementFinalHeader = toNumber(df.getHeaderValue(TERMINATION_HEADER_SECTION, TERMINATION_HEADER_KEY));
    if (dpElementFinalHeader === null || dpElementFinalHeader <= 0) {
      this.errors.push("Terminal DP setpoint not found or invalid for Test Setup '" + df.testSetup + "'.");
      return false;
    }

    const dpChannelTag = resolveDPChannelTag(df, this.sensor);
    if (df.analogTags.indexOf(dpChannelTag) < 0) {
      this.errors.push("Required pressure channel " + dpChannelTag + " not found in analog data.");
      return false;
    }
    this.terminationTag = dpChannelTag;
    this.terminationFilter = 1;
    this.dpElementFinal = dpElementFinalHeader;
    this.terminationDP = dpElementFinalHeader + this.dpHousingClean;
    this._computeCompanionPhaseDPSeries(companion, dpChannelTag);   // Figure C.1's own two-series plot, see that field's comment

    const source = this._resolveDPSource(df, companion, dpChannelTag);
    if (!source) {
      this.errors.push("Pressure or time data unavailable; cannot determine termination time.");
      return false;
    }

    const crossing = findCrossingBracket(this.terminationDP, source.values, source.times);
    if (crossing === null) {
      const lastTime = source.times[source.times.length - 1];
      this.warnings.push(
        dpChannelTag + " never reached the derived assembly-level terminal DP of " + this.terminationDP.toFixed(1) +
        "; using the last recorded time (" + formatElapsed(lastTime) + ") instead.");
      this.terminationTime = lastTime;
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
     Own copy of iso16889Analysis.js's identical-shaped method, adapted for finding #3
     (each configured TerminalDP value is an ELEMENT-level target; the assembly-level
     search target is elementTarget + housing) and finding #2 (each candidate's series
     is resolved via _resolveDPSource, i.e. phase-split when a companion file is
     usable). ---- */
  _determineDualFilterTermination(df, companion) {
    if (df.analogTags.indexOf(DP_CHANNEL_TAG_PRIMARY) < 0 || df.analogTags.indexOf(DP_CHANNEL_TAG_SECONDARY) < 0) {
      this.errors.push(
        "Required pressure channels " + DP_CHANNEL_TAG_PRIMARY + "/" + DP_CHANNEL_TAG_SECONDARY +
        " not found in analog data.");
      return false;
    }
    if (this.dpHousingClean === null) {
      this.errors.push("Filter housing ΔP not found in header; cannot derive the assembly-level termination target(s).");
      return false;
    }

    const terminalDPValues = df.getHeaderValues(TERMINATION_HEADER_SECTION, TERMINATION_HEADER_KEY);
    if (!terminalDPValues || terminalDPValues.length === 0) {
      this.errors.push("Terminal DP setpoint not found for Test Setup '" + df.testSetup + "'.");
      return false;
    }

    let overallElementTarget = null, filter1ElementTarget = null, filter2ElementTarget = null;
    if (terminalDPValues.length === 1) {
      overallElementTarget = toNumber(terminalDPValues[0]);
    } else if (terminalDPValues.length === 2) {
      filter1ElementTarget = toNumber(terminalDPValues[0]);
      filter2ElementTarget = toNumber(terminalDPValues[1]);
    } else {
      overallElementTarget = toNumber(terminalDPValues[0]);
      filter1ElementTarget = toNumber(terminalDPValues[1]);
      filter2ElementTarget = toNumber(terminalDPValues[2]);
    }
    const isActive = (v) => v !== null && v > 0;
    const housing = this.dpHousingClean;

    const primarySource = this._resolveDPSource(df, companion, DP_CHANNEL_TAG_PRIMARY);
    const secondarySource = this._resolveDPSource(df, companion, DP_CHANNEL_TAG_SECONDARY);
    if (!primarySource || !secondarySource) {
      this.errors.push("Pressure or time data unavailable; cannot determine termination time.");
      return false;
    }
    const sameAxis = primarySource.times.length === secondarySource.times.length;

    const candidates = [];
    if (isActive(overallElementTarget) && sameAxis) {
      candidates.push({
        id: "overall", target: overallElementTarget + housing,
        times: primarySource.times, values: sumChannels(primarySource.values, secondarySource.values)
      });
    }
    if (isActive(filter1ElementTarget)) {
      candidates.push({ id: "filter1", target: filter1ElementTarget + housing, times: primarySource.times, values: primarySource.values });
    }
    if (isActive(filter2ElementTarget)) {
      candidates.push({ id: "filter2", target: filter2ElementTarget + housing, times: secondarySource.times, values: secondarySource.values });
    }

    if (candidates.length === 0) {
      this.errors.push(
        "No active Terminal DP target found for Test Setup '" + df.testSetup + "' (TerminalDP: " +
        terminalDPValues.join(", ") + ").");
      return false;
    }

    let winner = null;
    for (const candidate of candidates) {
      candidate.crossing = findCrossingBracket(candidate.target, candidate.values, candidate.times);
      if (candidate.crossing !== null && (winner === null || candidate.crossing.crossingTime < winner.crossing.crossingTime)) winner = candidate;
    }

    if (winner === null) {
      const lastTime = primarySource.times[primarySource.times.length - 1];
      this.warnings.push(
        "None of the active Terminal DP target(s) (" +
        candidates.map((c) => c.id + ": " + c.target.toFixed(1)).join(", ") +
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

    this.terminationFilter = 1;
    this._resolveDualFilterDisplay(df, companion, { overallElementTarget, filter1ElementTarget, filter2ElementTarget }, housing);
    return true;
  }

  /** Resolves terminationTag/dpElementFinal/terminationDP (and, for the "Overall"
   *  view only, overallDPSource) — a DISPLAY concern, resolved AFTER termination TIME
   *  is already known, independent of which target actually ended the test. Own copy
   *  of iso16889Analysis.js's identical-purpose method, adapted for finding #3
   *  (element-first, assembly derived) and finding #2 (phase-split source). */
  _resolveDualFilterDisplay(df, companion, targets, housing) {
    const { overallElementTarget, filter1ElementTarget, filter2ElementTarget } = targets;

    if (df.midstreamFlag) {
      const isFilter1 = this.sensor === "lb";
      this.terminationTag = isFilter1 ? DP_CHANNEL_TAG_PRIMARY : DP_CHANNEL_TAG_SECONDARY;
      const perFilterElementTarget = isFilter1 ? filter1ElementTarget : filter2ElementTarget;
      let elementTarget = null;
      if (perFilterElementTarget !== null && perFilterElementTarget > 0) {
        elementTarget = perFilterElementTarget;
      } else if (overallElementTarget !== null && overallElementTarget > 0) {
        elementTarget = overallElementTarget;
      } else {
        this.warnings.push(
          "No Terminal DP target is configured for the " + (isFilter1 ? "Primary" : "Secondary") +
          " Filter (or an overall target) in this file's header — element ΔP and the DP-vs-time " +
          "chart's target line cannot be shown for this filter view.");
      }
      this.dpElementFinal = elementTarget;
      this.terminationDP = elementTarget !== null ? elementTarget + housing : null;
      return;
    }

    if (this.pressureView === "overall") {
      this.terminationTag = "";
      this.dpElementFinal = overallElementTarget;
      const primarySource = this._resolveDPSource(df, companion, DP_CHANNEL_TAG_PRIMARY);
      const secondarySource = this._resolveDPSource(df, companion, DP_CHANNEL_TAG_SECONDARY);
      if (primarySource && secondarySource && primarySource.times.length === secondarySource.times.length) {
        this.overallDPSource = { times: primarySource.times, values: sumChannels(primarySource.values, secondarySource.values) };
      }
    } else if (this.pressureView === "filter2") {
      this.terminationTag = DP_CHANNEL_TAG_SECONDARY;
      this.dpElementFinal = filter2ElementTarget;
    } else {
      this.terminationTag = DP_CHANNEL_TAG_PRIMARY;
      this.dpElementFinal = filter1ElementTarget;
    }
    this.terminationDP = this.dpElementFinal !== null ? this.dpElementFinal + housing : null;
  }

  /** @param {DataFile} df @returns {Array<{key:string,label:string}>} */
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
  //#endregion

  //#region particle count lens — sensor selection, reporting-time buckets, ratio math
  /** @param {DataFile} df @returns {Array<{key:string,label:string}>} */
  static availableSensors(df) {
    return Object.entries(SENSOR_CHANNELS)
      .filter(([, spec]) => df[spec.sizesProp] && df[spec.sizesProp].length > 0)
      .map(([key]) => ({ key, label: resolveSensorLabel(key, df) }));
  }

  /* ---- The 10 reporting-time buckets (12.1-12.6). Same two-time-reference shape as
     ISO 16889's own clumps (exact fraction for ΔP interpolation, rounded/
     non-compounding window for count averaging) — see finding #5 for the one genuine
     difference: the rounding unit generalizes to the file's own count-cycle length
     instead of a hardcoded whole minute. assemblyDP is read from the phase-split
     companion source when usable (finding #2), or the primary file's raw channel
     otherwise — via _resolveDPSource, same as termination. ---- */
  _computeReportingTimeClumps(df, companion, termination) {
    const { terminationTime, terminationTag, overallDPSource } = termination;
    const spec = SENSOR_CHANNELS[this.sensor];
    this.sizes = df[spec.sizesProp];
    const sizeCount = this.sizes.length;

    const terminationMinutes = terminationTime / 60;
    const dpSource = overallDPSource || this._resolveDPSource(df, companion, terminationTag);
    const upRows = df[spec.upProp];
    const downRows = df[spec.downProp];

    // finding #5: round to the next whole COUNT-CYCLE, not a hardcoded 60s minute.
    // Validated against the standard's own 15s worked example: ceil(180/15)=12.
    const countCycleSec = df.countTimeSec + df.holdTimeSec;
    const skipCycles = Math.ceil(SKIP_SECONDS / countCycleSec);
    let previousStopSec = skipCycles * countCycleSec;

    for (let k = 1; k <= 10; k++) {
      const percent = k * 10;
      const reportingTimeMin = (k / 10) * terminationMinutes;   // exact — 12.1/12.2
      const reportingTimeSec = Math.min(reportingTimeMin * 60, terminationTime);
      const stopSec = Math.ceil(reportingTimeSec / countCycleSec) * countCycleSec;
      const startSec = previousStopSec + countCycleSec;
      previousStopSec = stopSec;

      const assemblyDP = dpSource ? interpolateAt(reportingTimeSec, dpSource.times, dpSource.values) : null;
      const elementDP = (assemblyDP !== null && this.dpHousingClean !== null) ? assemblyDP - this.dpHousingClean : null;

      const [startRow, endRow] = findRowRange(df.times, startSec, stopSec);
      const avgUp = new Array(sizeCount).fill(null);
      const avgDown = new Array(sizeCount).fill(null);
      const avgRatio = new Array(sizeCount).fill(null);
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
            avgRatio[sizeIndex] = (sumDown > 0) ? Math.min(sumUp / sumDown, MAX_RATIO_VALUE) : MAX_RATIO_VALUE;
          }
        }
        for (let row = startRow; row <= endRow; row++) {
          countRows.push({
            time: df.times[row],
            up: upRows[row].map((v) => toNumber(v)),
            down: downRows[row].map((v) => toNumber(v))
          });
        }
      }

      this.clumps.push({
        percent, startMin: startSec / 60, stopMin: stopSec / 60, testTimeMin: reportingTimeMin,
        assemblyDP, elementDP, avgUp, avgDown, avgRatio, countRows
      });
    }
  }

  /* ---- 12.7-12.8: overall average counts are the MEAN OF THE 10 BUCKETS' OWN
     AVERAGES per size, then the overall ratio is their quotient. ---- */
  _computeOverallAverages() {
    const sizeCount = this.sizes.length;
    this.overallUpstreamAverage = new Array(sizeCount).fill(null);
    this.overallDownstreamAverage = new Array(sizeCount).fill(null);
    this.overallAverageRatio = new Array(sizeCount).fill(null);

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
        this.overallAverageRatio[sizeIndex] = (overallDown > 0) ? Math.min(overallUp / overallDown, MAX_RATIO_VALUE) : MAX_RATIO_VALUE;
      }
    }
  }

  /** Warns if the currently-selected sensor's smallest-size counts, divided by the
   *  actual per-record dilution ratio, exceed its coincidence limit (ISO 11171) at
   *  any point in the test. Own copy of iso16889Analysis.js's identical-purpose
   *  method — same particle-counting hardware, same shared math (coincidenceLimitCheck.js).
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
      const rawCounts = rows.map((row) => toNumber(row[0]));
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

  /* ---- 13.6/13.7: size at a given filtration ratio "a" — log-linear interpolation,
     algebraically identical to formula 18 (verified by hand: x = (x1-x2)*log(a_xC/a_x1)
     / log(a_x1/a_x2) + x1 reduces to the same ratio-of-logs expression as
     logLinearInterpolateSize below, bracket points labeled in the opposite order).
     Own copy of iso16889Analysis.js's Size_At_Beta_x, renamed to this standard's own
     "a" terminology — same bracket/clamp/nearest-fallback shape. ---- */
  _computeSizeAtRatio() {
    for (const targetRatio of STANDARD_RATIOS) {
      this.sizeAtRatio[String(targetRatio)] = Iso23369Analysis._sizeGivenRatio(targetRatio, this.sizes, this.overallAverageRatio);
    }
  }

  static _sizeGivenRatio(targetRatio, sizes, avgRatio) {
    return Iso23369Analysis.sizeGivenRatioDetail(targetRatio, sizes, avgRatio).result;
  }

  /** @param {number} targetRatio @param {Array<string|number>} sizes @param {Array<number|null>} avgRatio
   *  @returns {{result:string, mode:"interpolated"|"below-range"|"above-range"|"no-data",
   *    bracket:{lowerSize:number,lowerRatio:number,upperSize:number,upperRatio:number}|null, note?:string}} */
  static sizeGivenRatioDetail(targetRatio, sizes, avgRatio) {
    let firstValid = -1, lastValid = -1;
    for (let i = 0; i < avgRatio.length; i++) {
      if (avgRatio[i] !== null && avgRatio[i] > 0) {
        if (firstValid < 0) firstValid = i;
        lastValid = i;
      }
    }
    if (firstValid < 0) return { result: "", mode: "no-data", bracket: null };

    let minRatio = Infinity, maxRatio = 0;
    for (let i = firstValid; i <= lastValid; i++) {
      if (avgRatio[i] !== null && avgRatio[i] > 0) {
        if (avgRatio[i] < minRatio) minRatio = avgRatio[i];
        if (avgRatio[i] > maxRatio) maxRatio = avgRatio[i];
      }
    }

    if (targetRatio < minRatio) return { result: "<" + Number(sizes[firstValid]).toFixed(1), mode: "below-range", bracket: null };
    if (targetRatio > maxRatio) return { result: ">" + Number(sizes[lastValid]).toFixed(1), mode: "above-range", bracket: null };

    for (let i = firstValid; i < lastValid; i++) {
      if (avgRatio[i] !== null && avgRatio[i] > 0 && avgRatio[i + 1] !== null && avgRatio[i + 1] > 0) {
        const between = (avgRatio[i] <= targetRatio && avgRatio[i + 1] >= targetRatio) ||
                         (avgRatio[i] >= targetRatio && avgRatio[i + 1] <= targetRatio);
        if (between) {
          const size = logLinearInterpolateSize(targetRatio, avgRatio[i], Number(sizes[i]), avgRatio[i + 1], Number(sizes[i + 1]));
          return {
            result: size.toFixed(1), mode: "interpolated",
            bracket: { lowerSize: Number(sizes[i]), lowerRatio: avgRatio[i], upperSize: Number(sizes[i + 1]), upperRatio: avgRatio[i + 1] }
          };
        }
      }
    }

    let lowerIdx = -1, higherIdx = -1, lowerRatio = 0, higherRatio = Infinity;
    for (let i = firstValid; i <= lastValid; i++) {
      if (avgRatio[i] === null || avgRatio[i] <= 0) continue;
      if (avgRatio[i] < targetRatio && avgRatio[i] > lowerRatio) { lowerRatio = avgRatio[i]; lowerIdx = i; }
      if (avgRatio[i] > targetRatio && avgRatio[i] < higherRatio) { higherRatio = avgRatio[i]; higherIdx = i; }
    }
    if (lowerIdx >= 0 && higherIdx >= 0) {
      const size = logLinearInterpolateSize(targetRatio, lowerRatio, Number(sizes[lowerIdx]), higherRatio, Number(sizes[higherIdx]));
      return {
        result: size.toFixed(1), mode: "interpolated",
        bracket: { lowerSize: Number(sizes[lowerIdx]), lowerRatio, upperSize: Number(sizes[higherIdx]), upperRatio: higherRatio },
        note: "gap in the ratio progression — nearest non-adjacent measured points used, not the immediately adjacent sizes"
      };
    }

    return { result: "", mode: "no-data", bracket: null };
  }
  //#endregion

  //#region mass lens — injection flow rate, gravimetric mass balance
  /* ---- 11.7/12.11: Ave_Injection_Flow (q_bar_i) — live INJ_Rate channel average,
     same confirmed method ISO 16889 uses (its own 12.11 makes the identical
     departure from the standard's literal "initial/final volume" formula 13, for the
     same reason: no live continuous-metering assumption). Checked against the
     Injection System Configuration Rate setpoint, ±5% (11.7's own "flag with any
     injection variation tolerance failure" instruction) — warning, not a hard block.

     Also computes the injection reservoir's Final volume (11.15) — Initial minus
     what was drawn at q_bar_i over the test, same "reservoir genuinely drains"
     reasoning and formula ISO 16889's own injVolumeFinal already uses. ---- */
  _computeInjectionFlowRate(df, terminationTime) {
    this.injectionGravSetpoint = toNumber(df.getHeaderValue(HEADER_INJ_GRAVIMETRIC_SETPOINT.section, HEADER_INJ_GRAVIMETRIC_SETPOINT.key));
    this.injectionFlowSetpoint = toNumber(df.getHeaderValue(HEADER_INJ_FLOWRATE_SETPOINT.section, HEADER_INJ_FLOWRATE_SETPOINT.key));
    this.injVolumeInitial = toNumber(df.getHeaderValue(HEADER_INJECTION_VOLUME.section, HEADER_INJECTION_VOLUME.key));

    // Design-target BUGL — same formula (12.12), setpoint inputs instead of measured
    // ones — see checkGravimetricAcceptance's own comment.
    this.buglTarget = Iso23369Analysis.computeAverageBUGL({
      injectionGravAverage: this.injectionGravSetpoint,
      qia: this.injectionFlowSetpoint,
      qAvg: this.qAvg
    });

    this.qia = averageSeries(df.getChannel(INJ_RATE_TAG));
    if (this.qia === null) {
      this.warnings.push(INJ_RATE_TAG + " channel not found; average injection flow rate (q̄_i) unavailable.");
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
        "% off the " + this.injectionFlowSetpoint.toFixed(1) + " mL/min setpoint — outside the ±" +
        INJ_FLOWRATE_TOLERANCE_PCT + "% the standard requires to accept the test (11.7).");
    }
  }

  /* ---- Sample flow, BOTH directions — 13.3's Dust_Retained (formula 16) needs the
     UPSTREAM value (qu, term 3) as well as the downstream one (qd, term 2), unlike
     ISO 16889's own Dust_Retained (which only ever needs downstream) — see
     computeMassBalance's own comment. Declared header setpoints (Dilution System
     Configuration/SampleFlow, index 0 = upstream / index 1 = downstream), not live
     channels — same "SampleFlow, not the sensor-flow channel" distinction ISO 16889's
     own HEADER_SAMPLE_FLOW note already documents. ---- */
  _computeSampleFlows(df) {
    const sampleFlow = df.getHeaderValues(HEADER_SAMPLE_FLOW.section, HEADER_SAMPLE_FLOW.key);
    this.qu = sampleFlow && sampleFlow.length > 0 ? toNumber(sampleFlow[0]) : null;
    this.qd = sampleFlow && sampleFlow.length > 1 ? toNumber(sampleFlow[1]) : null;
    if (this.qu === null || this.qd === null) {
      this.warnings.push("Sample Flow header value (Dilution System Configuration/SampleFlow) not found or " +
        "incomplete; Dust_Retained (13.3) cannot be computed once gravimetric results are entered.");
    }
  }

  /* ---- 13.2 (m_i) / 13.3 (m_r) — NOT computed as part of run(), since both need
     hand-entered gravimetric samples (injection average, 80% upstream sample) —
     same reasoning ISO 16889/4548-12/19438 all apply to their own gravimetric
     fields. Called from the gravimetric entry dialog's save handler instead
     (app.js), mirroring computeMassBalance's existing shape on the other standards.

     DIFFS FROM ISO 16889'S OWN Dust_Retained — two real, standard-specific ones
     (not zero, not a copying error):
       (1) term 3 uses UPSTREAM sample flow (qu), matching ISO 19438's Mnr pattern —
           NOT ISO 16889's, which uses downstream (qd) in BOTH flow-weighted terms.
       (2) term 1 uses the computed final INJECTION volume (11.15, injVolumeFinal),
           not a test-system volume field — a different reservoir's leftover
           contaminant than ISO 16889's own term 1 represents.
     The outline's own pasted formula 16 doesn't show a trailing /1000 on term 3 the
     other three terms have — implemented WITH /1000 for unit consistency with the
     other three (almost certainly a paraphrase inconsistency, not a real 1000x
     factor), flagged here rather than silently assumed away.
     @param {{injectionGravAverage:number|null, testFinalGrav:number|null,
       injVolumeFinal:number|null, qia:number|null, qu:number|null, qd:number|null,
       terminationMinutes:number|null, qAvg:number|null}} inputs
     @returns {{dustInjected:number|null, dustRetained:number|null}} */
  static computeMassBalance({ injectionGravAverage, testFinalGrav, injVolumeFinal, qia, qu, qd, terminationMinutes, qAvg }) {
    let dustInjected = null, dustRetained = null;
    if (injectionGravAverage !== null && qia !== null && terminationMinutes !== null) {
      // 13.2: m_i = c_bar_i x q_bar_i x t_f / 1000 — mg/L x mL/min x min, same
      // mL/min->L/min ->g conversion pattern every other standard's own injected
      // mass already uses. (13.5's m_p is the identical value, re-labeled for the
      // Figure C.1 x-axis — no separate computation.)
      dustInjected = (injectionGravAverage * (qia / 1000) * terminationMinutes) / 1000;
    }

    const bugl = Iso23369Analysis.computeAverageBUGL({ injectionGravAverage, qia, qAvg });

    if (dustInjected !== null && testFinalGrav !== null && injVolumeFinal !== null && qu !== null && qd !== null && terminationMinutes !== null && bugl !== null) {
      const qdLPerMin = qd / 1000;
      const quLPerMin = qu / 1000;
      // 13.3: m_r = m_i - c_80*V_if/1000 - qd*t_f*(c_80-c_bar_b)/1000 - qu*t_f*(c_80+c_bar_b)/2/1000
      dustRetained = dustInjected
        - (testFinalGrav * injVolumeFinal) / 1000
        - (qdLPerMin * terminationMinutes * (testFinalGrav - bugl)) / 1000
        - (quLPerMin * terminationMinutes * (testFinalGrav + bugl) / 2) / 1000;
    }

    return { dustInjected, dustRetained };
  }

  /** 12.12: Average_BUGL = c_bar_i x q_bar_i / q_bar — SAME formula shape as ISO
   *  16889's own computeAverageBUGL, but the denominator is q_bar (10.2.1's average
   *  TEST flow), not a single steady Test_Flow_Setpoint — this standard has no such
   *  steady setpoint to divide by.
   *  @param {{injectionGravAverage:number|null, qia:number|null, qAvg:number|null}} inputs
   *  @returns {number|null} */
  static computeAverageBUGL({ injectionGravAverage, qia, qAvg }) {
    if (injectionGravAverage === null || qia === null || qAvg === null || qAvg <= 0) return null;
    return (injectionGravAverage * (qia / 1000)) / qAvg;
  }

  /* ---- 12.9 (injection gravimetric ±5% per sample) and 12.12 (BUGL ±10%) —
     informational warnings, same treatment as every other control target, not a
     hard block. Own copy of iso16889Analysis.js's checkGravimetricAcceptance,
     denominator swapped to qAvg per computeAverageBUGL's own note.
     suppressBugl — same reasoning as ISO 16889's own dual-filter case: BUGL is only
     valid for Filter 1 on a series test, since Filter 2's own challenge is already
     modified by having passed through Filter 1 first.
     @param {{injectionGravInitial:number|null, injectionGravFinal:number|null,
       injectionGravSetpoint:number|null, injectionFlowSetpoint:number|null,
       qAvg:number|null, injectionGravAverage:number|null, qia:number|null,
       suppressBugl?:boolean}} inputs
     @returns {string[]} */
  static checkGravimetricAcceptance({ injectionGravInitial, injectionGravFinal, injectionGravSetpoint, injectionFlowSetpoint, qAvg, injectionGravAverage, qia, suppressBugl }) {
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
      const actualBugl = Iso23369Analysis.computeAverageBUGL({ injectionGravAverage, qia, qAvg });
      const targetBugl = Iso23369Analysis.computeAverageBUGL({ injectionGravAverage: injectionGravSetpoint, qia: injectionFlowSetpoint, qAvg });
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

/* Linear in size (x), logarithmic in ratio (y) — algebraically identical to formula
   18, see the class-level note above sizeGivenRatioDetail. */
function logLinearInterpolateSize(targetRatio, ratioA, sizeA, ratioB, sizeB) {
  if (targetRatio === ratioA) return sizeA;
  if (targetRatio === ratioB) return sizeB;
  return sizeA + (sizeB - sizeA) * (Math.log(targetRatio) - Math.log(ratioA)) / (Math.log(ratioB) - Math.log(ratioA));
}

/** Splits companion rows into the two flow-cycle phases using the file's own Cycle
 *  numbering (cyclicCompanionFile.js — confirmed to increment by exactly 0.5 every
 *  row, no gaps/dupes, across all 3 real fixture pairs), NOT a rate-vs-qAvg
 *  threshold comparison. Real bug, found 2026-08-20 from a live user report: qAvg is
 *  derived from the HEADER (q_min x FlowRatio, 10.2.1) and can be wrong or off-scale
 *  relative to the companion file's own real TS_Rate values for reasons that have
 *  nothing to do with whether the rig is actually cycling correctly — a per-row
 *  magnitude threshold against a bad qAvg can starve or entirely empty one phase
 *  even though the file has plenty of real high/low samples. Cycle parity needs no
 *  header value at all and is a clean, exact structural split — the user's own
 *  suggestion, confirmed against all 3 real fixtures (0 disagreements against the
 *  old rate-threshold method on any of them).
 *
 *  Only the WHOLE-vs-HALF-integer PARITY is reliable — which parity means "high" is
 *  NOT fixed across files: confirmed real (SpinOnCyclicMP-Cyclic.DAT) that whole-
 *  number Cycle rows are the LOW phase there and .5 rows are HIGH — the opposite of
 *  the other two fixtures. So the two parity groups are clustered first, then
 *  LABELED by comparing their own average rates against EACH OTHER — whichever
 *  group averages higher IS "high," by definition — never against qAvg, which is
 *  exactly the value that can be wrong.
 *  @param {Array<number|null>} rateChannel @param {Array<number|null>} cycleChannel
 *  @returns {{highIndices:number[], lowIndices:number[]}} */
function splitFlowPhasesByCycle(rateChannel, cycleChannel) {
  const groupA = [], groupB = [];   // A = whole-number Cycle, B = .5-fraction Cycle
  const n = Math.min(rateChannel.length, cycleChannel.length);
  for (let i = 0; i < n; i++) {
    if (rateChannel[i] === null || cycleChannel[i] === null) continue;
    const frac = Math.abs(cycleChannel[i] % 1);
    (frac < 0.25 ? groupA : groupB).push(i);
  }
  const avgRate = (indices) => indices.length ? indices.reduce((sum, i) => sum + rateChannel[i], 0) / indices.length : -Infinity;
  return (avgRate(groupA) >= avgRate(groupB))
    ? { highIndices: groupA, lowIndices: groupB }
    : { highIndices: groupB, lowIndices: groupA };
}

/** @param {Array<number|null>} series @param {number[]} indices @returns {Array<number|null>} */
function projectByIndices(series, indices) {
  return indices.map((i) => series[i]);
}
//#endregion

//#region exports (dual: Node require for tests, window global for the browser)
if (typeof module !== "undefined") {
  module.exports = { Iso23369Analysis };
}
if (typeof window !== "undefined") {
  window.Iso23369Analysis = Iso23369Analysis;
}
//#endregion

})();

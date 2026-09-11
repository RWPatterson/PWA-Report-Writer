"use strict";
/* =====================================================================================
   iso3968Analysis.js  —  ISO 3968:2017 analysis engine.
   =====================================================================================
   SCOPE OF THIS FILE, DELIBERATELY LIMITED (per the user, 2026-08-03): this builds the
   BASIC FILE STRUCTURE for a P-Q (flow-rate vs. differential-pressure) test — reading
   which mode a file was run in, extracting its raw (flow, DP) points, detecting an
   ascending+descending ("reverse") sweep, and checking the 3 control targets the user
   has given so far (Test Temperature, Conductivity — see iso3968ControlTargets.js —
   and Test Flow Rate — see this file's own checkFlowRateCompliance). It does NOT
   compute a net (tare-subtracted) DP, and does NOT decide any report content (page
   layout, which curve/table the report shows, filter rating, etc.) — none of that has
   been specified yet, and per the user's explicit instruction, this file must not
   guess at it. See NOT YET IMPLEMENTED below for exactly what's deferred and why.

   NOT WIRED INTO THE APP YET, ON PURPOSE: no entry in app.js's STANDARDS registry, no
   report template, no Mapper, no <script> tag in index.html, not in service-worker.js's
   PRECACHE_URLS. Wiring any of those in requires report content this file doesn't have
   yet — adding them now would be exactly the kind of guessing the user asked not to do.

   -------------------------------------------------------------------------------------
   REAL FILE FINDINGS (confirmed directly against files already in this repo — see
   tools/render-check/Test DAT files/ — not guessed)
   -------------------------------------------------------------------------------------
   - TestType is literally "P-Q" (hyphenated), NOT "PQ". The other three standards'
     REJECTED_TEST_TYPES dictionaries key on "PQ" and so never actually match a real
     P-Q file — fixed alongside this file (see those three Analysis.js files' own
     REJECTED_TEST_TYPES, key changed from "PQ" to "P-Q").
   - Mode is NOT encoded by filename convention (a red herring in this repo's sample
     filenames) — it's the "General Test Information" header field
     "ContinuosFlagStatus": "True"/"False" in newer files, "#TRUE#"/"#FALSE#" in older
     ones (same boolean-serialization variance dataFile.js already documents for
     MidstreamFlag). CONFIRMED against a real matched pair with identical FlowRate
     targets and only this flag differing (P-Q_V2_B9939_01.dat vs _02.dat):
       - Continuos=False (discrete/6-point mode): exactly 6 analog records, ~60 seconds
         apart, each settled at one of the 6 "FlowRate" header targets (verified: real
         TS_Rate readings 18.28/30.04/49.79/79.39/104.11/118.98 against configured
         targets 18/30/50/80/105/120).
       - Continuos=True (continuous-sweep mode): a smooth, continuously-ramping
         TS_Rate/TS_DPress with no discrete holds — however many records the sweep
         produces (observed ~20-26 for a one-directional sweep).
   - "Repeat in reverse" has NO header field at all — confirmed by checking a real
     file whose name suggested reverse (P-Q_C_R_V3_B20-009_01.DAT): its TS_Rate trace
     climbs 9.98->20.07 then descends back to 9.995, exactly 40 records (20 up + 20
     down). Detected here purely from the point sequence's shape (see
     _detectReversed), not from any declared flag.
   - "FlowRate" header always carries up to 6 comma-separated values: min/max in slots
     0 and 5, with the middle 4 either evenly-spaced intermediate targets or 0
     (unused) if the operator configured a bare min/max continuous sweep. Read via
     getHeaderValues (need every value), zero/blank entries filtered out.
   - Record/channel shape needed exactly ONE dataFile.js fix, not a P-Q-specific one:
     the same generic 3-row (older files: TS_Rate/TS_Temp/TS_Press/TS_DPress/INJ_Rate/
     INJ_Temp/DS_Temp/UpRatio/UpSensor/DnRatio/DnSensor, no LB/LS split) or 5-row
     (newer files, LB/LS split) record shape covers P-Q files fine — but
     P-Q_V2_B9939_02.dat surfaced a real, pre-existing dataFile.js bug: some files
     wrap the ENTIRE ";Data Format:" row (prefix AND every channel name) inside one
     pair of quotes, so the old parser saw it as a single field and silently produced
     `analogTags = []` (zero channels, not specific to P-Q — any standard reading a
     file shaped this way would have failed the same way). Fixed at the root in
     dataFile.js itself (see its own comment there), not worked around here. Count/
     particle-count rows are constant filler in every P-Q file checked (a P-Q test
     doesn't inject contaminant or count particles), simply never read here.
   - No file property marks a run as a "tare" (empty-housing) test — checked FilterID/
     HousingType/Comments across every sample, found nothing. Matches the user's own
     description: tare-vs-not is a workflow decision (does the user supply a second
     file), not a file property.

   -------------------------------------------------------------------------------------
   Net (tare-subtracted) DP — curve-fit method (per the user, 2026-08-03)
   -------------------------------------------------------------------------------------
   The primary file's points and (if supplied) the tare file's points routinely land
   at DIFFERENT flow rates — the sweep's own targets rarely repeat exactly between two
   independent runs — so a raw point-to-point subtraction doesn't line up. Per the
   user: fit BOTH the assembly's own ΔP-vs-flow curve and the tare's ΔP-vs-flow curve
   (quadratic, forced through the origin — see analysisMath.js's fitQuadraticNoIntercept
   — a standard Darcy-Forchheim laminar+turbulent form), then take the DIFFERENCE OF
   THE TWO CURVES, evaluated at each of the assembly's own measured flow rates (not the
   tare's) — "relative differential based on the curve," in the user's words, precisely
   because the source data's flow points are mismatched. See `assemblyFit`/`tare.fit`
   and each point's `assemblyFitDP`/`housingFitDP`/`elementDP` below.

   -------------------------------------------------------------------------------------
   NOT YET IMPLEMENTED (deliberately — do not guess these in)
   -------------------------------------------------------------------------------------
   - Any report content: which curve/table gets shown, filter rating derivation,
     page layout, field ids — none of this exists as a Mapper/template/STANDARDS
     entry yet, per the file-top SCOPE note.

   Wrapped in an IIFE for the same reason as the other three standards' engines:
   classic <script>-loaded files share one global scope (once this one is ever added
   to index.html), so internal names must not leak. ---------------------------------- */
(function () {

//#region shared
// Only "P-Q" is this standard's own test type; every other value belongs to one of
// the other three (already-built) standards or a not-yet-built one. Own copy per
// CLAUDE.md, even though the REJECTED_TEST_TYPES shape mirrors theirs.
const VALID_TEST_TYPES = ["P-Q"];
const REJECTED_TEST_TYPES = {
  "Data Only": "This file contains 'Data Only' and cannot generate ISO 3968 reports.",
  "Multipass": "This file contains 'Multipass' data (a multipass filtration test), not a P-Q flow/pressure characterization test.",
  "Single-Pass": "This file contains 'Single-Pass' data (a multipass-style filtration test), not a P-Q flow/pressure characterization test.",
  "Multipass Series": "This file contains 'Multipass Series' data (a multipass-style filtration test), not a P-Q flow/pressure characterization test.",
  "Cyclic Multipass": "This file contains 'Cyclic Multipass' data (ISO 23369), not ISO 3968.",
  "Cyclic Series Multipass": "This file contains 'Cyclic Series Multipass' data (ISO 23369), not ISO 3968."
};

const HEADER_SECTION = "General Test Information";
const FLOW_RATE_TAG = "TS_Rate";     // same tag TS_Rate already confirmed by all 3 other standards
const DP_TAG = "TS_DPress";          // same tag TS_DPress already confirmed by all 3 other standards

const analysisMathLib = (typeof module !== "undefined") ? require("../../helpers/analysisMath.js") : window.AnalysisMath;
const { toNumber, fitQuadraticNoIntercept, evalQuadratic } = analysisMathLib;

/** "True"/"False" in newer files, "#TRUE#"/"#FALSE#" in older ones — same boolean-
 *  serialization variance dataFile.js documents for MidstreamFlag. Own copy here
 *  (not promoted to dataFile.js) since ContinuosFlagStatus is meaningful only to
 *  this standard, unlike MidstreamFlag/TestSetup which affect all three others'
 *  termination logic. @param {string|null} raw @returns {boolean} */
function parseFlag(raw) {
  return !!raw && raw.toUpperCase().indexOf("TRUE") >= 0;
}
//#endregion

/* =====================================================================================
   Iso3968Analysis
   ===================================================================================== */
class Iso3968Analysis {
  //#region construction / state
  constructor() {
    this.testType = "";
    this.continuous = false;     // ContinuosFlagStatus
    this.reversed = false;       // detected from the point sequence — see _detectReversed
    this.flowRateTargets = [];   // up to 6 configured target flow rates (0/blank entries dropped)

    /** @type {Array<{time:number, flowRate:number, dp:number, assemblyFitDP:(number|null), housingFitDP:(number|null), elementDP:(number|null)}>}
     *  one entry per analog record, in file order — the raw P-Q curve, ascending-
     *  then-descending if `reversed`. assemblyFitDP/housingFitDP/elementDP are added
     *  by _computeNetDP (see the file-top curve-fit note) — null wherever the
     *  relevant fit isn't available (e.g. housingFitDP/elementDP with no tare). */
    this.points = [];

    /** @type {{a:number,b:number}|null} this run's own ΔP = a·Q + b·Q² fit (see
     *  analysisMath.js's fitQuadraticNoIntercept) — null if too few points to fit. */
    this.assemblyFit = null;

    /** @type {{points:Array<{time:number,flowRate:number,dp:number}>, fit:({a:number,b:number}|null)}|null}
     *  set iff a valid tare DataFile was supplied to run() — raw points from the tare
     *  (empty-housing) run, plus that run's own quadratic fit (see the file-top
     *  curve-fit note). */
    this.tare = null;

    this.errors = [];
    this.warnings = [];
  }
  //#endregion

  //#region public API
  /** @param {DataFile} df @param {DataFile} [tareDf] optional empty-housing run to
   *  extract alongside df, for a future net-DP calc @returns {Iso3968Analysis} */
  static run(df, tareDf) {
    const analysis = new Iso3968Analysis();
    if (!analysis._validateTestType(df)) return analysis;

    analysis._readMode(df);
    analysis._extractPoints(df);
    analysis._detectReversed();

    if (tareDf) {
      const tareAnalysis = new Iso3968Analysis();
      if (tareAnalysis._validateTestType(tareDf)) {
        tareAnalysis._extractPoints(tareDf);
        analysis.tare = { points: tareAnalysis.points, fit: null };
      } else {
        analysis.warnings.push(
          "Supplied tare file is not a valid P-Q test (TestType '" + tareDf.testType +
          "'); ignoring it — points above are NOT net of a tare.");
      }
    }

    analysis._fitCurves();
    analysis._computeNetDP();

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
      this.errors.push("Unknown test type: '" + testType + "'. Cannot determine ISO 3968 compatibility.");
      return false;
    }
    this.testType = testType;
    return true;
  }
  //#endregion

  //#region mode / points
  _readMode(df) {
    this.continuous = parseFlag(df.getHeaderValue(HEADER_SECTION, "ContinuosFlagStatus"));

    const rawTargets = df.getHeaderValues(HEADER_SECTION, "FlowRate");
    if (rawTargets) {
      this.flowRateTargets = rawTargets
        .map((v) => toNumber(v))
        .filter((v) => v !== null && v > 0);
    }
    if (this.flowRateTargets.length === 0) {
      this.warnings.push("No FlowRate targets found in header.");
    }
  }

  /** One point per analog record, in file order — no bucketing/averaging: a
   *  discrete-mode record IS the settled reading at one target; a continuous-mode
   *  record is just the next sample along the ramp. Both are equally valid "points"
   *  for a P-Q curve. */
  _extractPoints(df) {
    const times = df.times;
    const flowData = df.getChannel(FLOW_RATE_TAG);
    const dpData = df.getChannel(DP_TAG);
    if (!times || !flowData || !dpData) {
      this.errors.push("Required channels " + FLOW_RATE_TAG + "/" + DP_TAG + " not found in analog data.");
      return;
    }

    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const flowRate = flowData[i];
      const dp = dpData[i];
      if (time === null || flowRate === null || dp === null) continue;
      this.points.push({ time, flowRate, dp });
    }

    if (this.points.length === 0) {
      this.errors.push("No usable " + FLOW_RATE_TAG + "/" + DP_TAG + " readings found.");
    }
  }

  /** "Repeat in reverse" has no header flag (confirmed — see file-top note): detect
   *  it from the shape of the flow-rate sequence itself. A reversed run climbs to a
   *  peak partway through, then descends — plain ascending (or plain descending, on
   *  the off chance a file starts high) never does. Sets nothing on a points array
   *  too short to have a meaningful shape (<3 points). */
  _detectReversed() {
    const n = this.points.length;
    if (n < 3) return;

    let peakIndex = 0;
    for (let i = 1; i < n; i++) {
      if (this.points[i].flowRate > this.points[peakIndex].flowRate) peakIndex = i;
    }
    // Reversed iff the peak sits strictly inside the sequence (not at either end) —
    // an ascending-only or descending-only run always peaks at one of the two ends.
    this.reversed = peakIndex > 0 && peakIndex < n - 1;
  }
  //#endregion

  //#region curve fits / net DP
  /** Fits this run's own ΔP-vs-flow curve, and the tare's if one was supplied — see
   *  the file-top curve-fit note for why (quadratic, forced through the origin). */
  _fitCurves() {
    this.assemblyFit = fitQuadraticNoIntercept(this.points.map((p) => ({ x: p.flowRate, y: p.dp })));
    if (this.tare) {
      this.tare.fit = fitQuadraticNoIntercept(this.tare.points.map((p) => ({ x: p.flowRate, y: p.dp })));
    }
  }

  /** Per the user (2026-08-03): the net (Filter Element) ΔP is the DIFFERENCE OF THE
   *  TWO CURVE FITS — not a raw point subtraction — evaluated at each of THIS run's
   *  own measured flow rates, since the assembly and tare runs' actual flow points
   *  routinely don't match. Sets assemblyFitDP/housingFitDP/elementDP on every point
   *  in `this.points`; all three stay null wherever the relevant fit is unavailable
   *  (no tare supplied, or too few points to fit either curve). */
  _computeNetDP() {
    const tareFit = this.tare ? this.tare.fit : null;
    for (const point of this.points) {
      point.assemblyFitDP = evalQuadratic(this.assemblyFit, point.flowRate);
      point.housingFitDP = evalQuadratic(tareFit, point.flowRate);
      point.elementDP = (point.assemblyFitDP === null || point.housingFitDP === null)
        ? null : point.assemblyFitDP - point.housingFitDP;
    }
  }
  //#endregion

  //#region control targets
  /** Test Flow Rate compliance (±5%, confirmed by the user, 2026-08-03) — deliberately
   *  NOT part of iso3968ControlTargets.js/the shared controlTargetCheck.js engine:
   *  that engine checks one whole-test channel average against one fixed target,
   *  which doesn't fit here since flow is the swept variable across a P-Q test, not
   *  a constant. Checks EACH point's actual flow against its NEAREST configured
   *  target instead. For discrete mode this naturally pairs each of the 6 points
   *  with its own target one-to-one (the targets are spaced far enough apart that
   *  "nearest" is unambiguous). For continuous mode, an in-between point's "nearest"
   *  target is just wherever the sweep momentarily is passing through, not a
   *  settled reading at that target — such points can show a large deltaPct by
   *  design, not because anything is actually wrong; this is a known rough edge the
   *  user was shown before endorsing this shape, not an oversight.
   *  @param {Array<{time:number,flowRate:number,dp:number}>} points
   *  @param {number[]} flowRateTargets
   *  @param {number} [tolerancePct] default 5, per the user
   *  @returns {Array<{pointIndex:number, actual:number, target:number, deltaPct:number, ok:boolean}>} */
  static checkFlowRateCompliance(points, flowRateTargets, tolerancePct) {
    const tolerance = (tolerancePct === undefined || tolerancePct === null) ? 5 : tolerancePct;
    if (!flowRateTargets || flowRateTargets.length === 0) return [];

    return points.map((point, pointIndex) => {
      let nearest = flowRateTargets[0];
      for (const target of flowRateTargets) {
        if (Math.abs(point.flowRate - target) < Math.abs(point.flowRate - nearest)) nearest = target;
      }
      const deltaPct = Math.abs(point.flowRate - nearest) / nearest * 100;
      return { pointIndex, actual: point.flowRate, target: nearest, deltaPct, ok: deltaPct <= tolerance };
    });
  }
  //#endregion
}

//#region exports (dual: Node require for tests, window global for the browser)
if (typeof module !== "undefined") {
  module.exports = { Iso3968Analysis };
}
if (typeof window !== "undefined") {
  window.Iso3968Analysis = Iso3968Analysis;
}
//#endregion

})();

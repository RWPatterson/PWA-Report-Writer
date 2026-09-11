"use strict";
/* =====================================================================================
   analysisMath.js  —  shared numeric helpers for report-standard analysis engines.
   =====================================================================================
   No DOM, no UI, no knowledge of any one standard's data shape. Extracted out of
   iso16889Analysis.js so other standards (ISO 23369, ISO 19438, etc.) can share the
   same interpolation and formatting primitives instead of re-deriving them. These are
   generic HELPERS (per CLAUDE.md's procedures-vs-helpers rule), which is why they're
   shared across standards rather than duplicated the way termination detection is.

   Wrapped in an IIFE so linearInterpolate/findCrossingTime/etc. stay local to this
   file instead of becoming top-level bindings in the shared classic-script global
   scope (index.html loads this and every standard's own Analysis.js as plain
   <script> tags, not modules) — otherwise a consumer destructuring the same names
   off AnalysisMath at its own top level collides with these as duplicate global
   declarations.
   ===================================================================================== */
(function () {

//#region interpolation
/** y at x, linearly between two known points. Exact match on x1/x2 short-circuits,
 *  same as the VBA's LinearInterpolation.
 *  @param {number} x @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 *  @returns {number} */
function linearInterpolate(x, x1, y1, x2, y2) {
  if (x === x1) return y1;
  if (x === x2) return y2;
  return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
}

/** Same search as findCrossingTime, but returns the two bracketing samples
 *  themselves (their own time+value), not just the interpolated crossing time —
 *  findCrossingTime below is now a thin wrapper around this, so there's exactly
 *  ONE implementation of the search, not two kept in sync by hand. Added for the
 *  Audit Trail view (src/audit/): showing "the target was crossed at time T" is
 *  not the same as showing WHICH TWO measured samples that was interpolated
 *  between — the audit trail needs the latter, the report only ever needed the
 *  former, which is why this was never exposed until now.
 *  @param {number} yTarget @param {Array<number|null>} yValues @param {Array<number|null>} xTimes
 *  @returns {{crossingTime:number, before:{time:number,value:number}, after:{time:number,value:number}}|null}
 *    null if the series never reaches yTarget */
function findCrossingBracket(yTarget, yValues, xTimes) {
  for (let i = 0; i < yValues.length - 1; i++) {
    const y1 = yValues[i], y2 = yValues[i + 1];
    if (y1 === null || y2 === null) continue;
    if ((y1 <= yTarget && y2 >= yTarget) || (y1 >= yTarget && y2 <= yTarget)) {
      return {
        crossingTime: linearInterpolate(yTarget, y1, xTimes[i], y2, xTimes[i + 1]),
        before: { time: xTimes[i], value: y1 },
        after: { time: xTimes[i + 1], value: y2 }
      };
    }
  }
  return null;
}

/** First x (from a sorted-by-x series) at which y crosses yTarget, linearly interpolated
 *  between the bracketing samples. Port of FastLinearInterpolation as used in
 *  SetTerminationTime: DP is x-as-if-y (it interpolates TIME as a function of PRESSURE).
 *  @param {number} yTarget @param {Array<number|null>} yValues @param {Array<number|null>} xTimes
 *  @returns {number|null} null if the series never reaches yTarget */
function findCrossingTime(yTarget, yValues, xTimes) {
  const bracket = findCrossingBracket(yTarget, yValues, xTimes);
  return bracket ? bracket.crossingTime : null;
}

/** Value of a y-series at a specific x (time), by finding the bracketing samples and
 *  interpolating. Off the end of the data, clamps to the nearest sample rather than
 *  extrapolating. Used for the clump pressure table.
 *  @param {number} xTarget @param {Array<number|null>} xTimes @param {Array<number>} yValues
 *  @returns {number} */
function interpolateAt(xTarget, xTimes, yValues) {
  for (let i = 0; i < xTimes.length - 1; i++) {
    if (xTimes[i] === null || xTimes[i + 1] === null) continue;
    if (xTimes[i] <= xTarget && xTimes[i + 1] >= xTarget) {
      return linearInterpolate(xTarget, xTimes[i], yValues[i], xTimes[i + 1], yValues[i + 1]);
    }
  }
  // Off the end of the data: clamp to the nearest sample rather than extrapolate.
  if (xTarget <= xTimes[0]) return yValues[0];
  return yValues[yValues.length - 1];
}
//#endregion

//#region curve fitting
/** Least-squares fit of y = a*x + b*x^2, intercept forced to 0 (y=0 at x=0 is
 *  physical for a ΔP-vs-flow curve, not just a convenience) — solves the 2x2 normal-
 *  equations system directly. This basis (x, x^2) is linear in a/b, so ordinary
 *  least squares applies even though the fitted curve itself is quadratic in x.
 *  Generic curve fit — which standard uses this, on what data, and how the result
 *  is applied are that standard's own analysis-procedure decisions (see CLAUDE.md),
 *  not this helper's concern.
 *  @param {Array<{x:number,y:number}>} points @returns {{a:number,b:number}|null}
 *    null if fewer than 2 usable points or the system is singular (e.g. every x is 0) */
function fitQuadraticNoIntercept(points) {
  const pts = (points || []).filter((p) => isFinite(p.x) && isFinite(p.y));
  if (pts.length < 2) return null;
  let Sxx = 0, Sxx2 = 0, Sx2x2 = 0, Sxy = 0, Sx2y = 0;
  for (const p of pts) {
    const x = p.x, x2 = x * x;
    Sxx += x * x; Sxx2 += x * x2; Sx2x2 += x2 * x2;
    Sxy += x * p.y; Sx2y += x2 * p.y;
  }
  const det = Sxx * Sx2x2 - Sxx2 * Sxx2;
  if (Math.abs(det) < 1e-12) return null;
  return {
    a: (Sxy * Sx2x2 - Sx2y * Sxx2) / det,
    b: (Sxx * Sx2y - Sxx2 * Sxy) / det
  };
}

/** y at x for a fitQuadraticNoIntercept result. @param {{a:number,b:number}|null} fit
 *  @param {number} x @returns {number|null} */
function evalQuadratic(fit, x) {
  if (!fit || !isFinite(x)) return null;
  return fit.a * x + fit.b * x * x;
}
//#endregion

//#region channel combination
/** Element-wise sum of two same-length channel series — e.g. a dual-filter test's
 *  synthetic "overall" differential (TS_PreDPress + TS_FinalDPress), which has no
 *  channel of its own in the .DAT file.
 *  @param {Array<number|null>|null} seriesA @param {Array<number|null>|null} seriesB
 *  @returns {Array<number|null>|null} null if either input is missing or the lengths
 *    mismatch; otherwise one entry per index — null if EITHER side is null at that
 *    index (can't sum a partial reading), the sum otherwise. */
function sumChannels(seriesA, seriesB) {
  if (!seriesA || !seriesB || seriesA.length !== seriesB.length) return null;
  const result = new Array(seriesA.length);
  for (let i = 0; i < seriesA.length; i++) {
    result[i] = (seriesA[i] === null || seriesB[i] === null) ? null : seriesA[i] + seriesB[i];
  }
  return result;
}
//#endregion

//#region parsing / formatting
/** parseFloat that returns null instead of NaN for bad/empty input.
 *  @param {*} text @returns {number|null} */
function toNumber(text) {
  const n = parseFloat(text);
  return isFinite(n) ? n : null;
}

/** seconds -> "H:MM:SS". Kept small and standalone on purpose so analysis engines have
 *  zero dependency on dataFile.js — they only need the DataFile *instance* passed into
 *  run(), not the class itself. (Formerly a duplicate of a DataFile.fmtElapsed static
 *  method; that copy was dead code — nothing ever called it — and was removed.)
 *  @param {number|null} totalSeconds @returns {string} */
function formatElapsed(totalSeconds) {
  if (totalSeconds === null || !isFinite(totalSeconds)) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}
//#endregion

//#region exports (dual: Node require for tests, window global for the browser)
const AnalysisMath = { linearInterpolate, findCrossingTime, findCrossingBracket, interpolateAt, toNumber, formatElapsed, sumChannels, fitQuadraticNoIntercept, evalQuadratic };

if (typeof module !== "undefined") {
  module.exports = AnalysisMath;
}
if (typeof window !== "undefined") {
  window.AnalysisMath = AnalysisMath;
}
//#endregion

})();

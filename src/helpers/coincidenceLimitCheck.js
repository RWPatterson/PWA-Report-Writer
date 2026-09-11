"use strict";
/* =====================================================================================
   coincidenceLimitCheck.js  —  shared coincidence-limit math for particle-counting
   analysis engines.
   =====================================================================================
   No DOM, no UI, no knowledge of channel names, sensor keys, or which standard is
   calling it — a generic HELPER (per CLAUDE.md's procedures-vs-helpers rule), same
   category as analysisMath.js, which is why this is shared across iso16889/iso454812/
   iso19438's own Analysis.js files rather than duplicated. Each standard resolves ITS
   OWN count/dilution-ratio channels (own copy per standard, per CLAUDE.md, even though
   the resolution logic is currently identical) and calls checkCoincidenceLimit with
   plain arrays — this file only does the arithmetic.

   Answers one data-quality question: did a particle counter sensor exceed its
   coincidence limit — the maximum reliable count rate (ISO 11171) before multiple
   small particles start registering as one large one, corrupting the data — at any
   point in the test.

   FORMULA (confirmed by the user, 2026-08-19): a .DAT file's reported counts are
   already scaled UP by the dilution system, so sensorCount = reportedCount /
   dilutionRatio recovers what the sensor itself actually saw. The channel checked is
   always the SMALLEST measured size (highest cumulative count — the one most likely
   to hit the limit first) — the caller extracts that column before calling in.

   RATIO-VALUE-OF-0 RULE (confirmed by the user against two independent real-file
   cases): a dilution ratio channel reading exactly 0 means that dilution STAGE is
   inactive (an effective ratio of 1, i.e. undiluted), not "no data." A channel that
   doesn't exist in the file at all is different — the caller passes null for that and
   this file skips it entirely (nothing to compute).

   Wrapped in an IIFE for the same reason as analysisMath.js — index.html loads this
   and every standard's own Analysis.js as plain <script> tags, not modules, so an
   unwrapped top-level function here would become a shared global colliding with any
   consumer's own same-named local.
   ===================================================================================== */
(function () {

/** Pamas LB, counts/mL at the sensor — conservative default (Klotz LB is 50,000; using
 *  the stricter Pamas figure means an unknown-brand LB sensor is never under-warned).
 *  Also used for LBE (same light-blocking technology). */
const DEFAULT_LB_COINCIDENCE_LIMIT = 30000;
/** Pamas LS, counts/mL at the sensor — the only manufacturer figure supplied. */
const DEFAULT_LS_COINCIDENCE_LIMIT = 12000;

/**
 * @param {number[]} times elapsed seconds per record (df.times)
 * @param {Array<number|null>} rawCounts smallest-size cumulative count per record, same index alignment as `times`
 * @param {Array<number|null>|null} ratioValues actual dilution ratio per record, same index alignment (0 = undiluted); null if the channel doesn't exist in this file at all
 * @param {number} limit max allowable counts/mL AT THE SENSOR
 * @returns {{exceeded:boolean, peakSensorCount:number|null, offendingMinuteRanges:Array<{startMin:number,endMin:number}>}}
 */
function checkCoincidenceLimit(times, rawCounts, ratioValues, limit) {
  if (!ratioValues || !rawCounts || !times) {
    return { exceeded: false, peakSensorCount: null, offendingMinuteRanges: [] };
  }

  let peakSensorCount = null;
  const offendingMinutes = new Set();
  for (let i = 0; i < times.length; i++) {
    const rawCount = rawCounts[i];
    const ratio = ratioValues[i];
    if (rawCount === null || rawCount === undefined || !isFinite(rawCount)) continue;
    if (ratio === null || ratio === undefined || !isFinite(ratio)) continue;
    const effectiveRatio = ratio === 0 ? 1 : ratio;   // 0 = dilution stage inactive, not "no data"

    const sensorCount = rawCount / effectiveRatio;
    if (peakSensorCount === null || sensorCount > peakSensorCount) peakSensorCount = sensorCount;
    if (sensorCount > limit) offendingMinutes.add(Math.round(times[i] / 60));
  }

  return {
    exceeded: offendingMinutes.size > 0,
    peakSensorCount,
    offendingMinuteRanges: collapseToRanges([...offendingMinutes].sort((a, b) => a - b))
  };
}

/** Collapses a sorted, deduped list of integer minute marks into consecutive-run
 *  ranges. @param {number[]} minutes sorted ascending, no duplicates
 *  @returns {Array<{startMin:number,endMin:number}>} */
function collapseToRanges(minutes) {
  const ranges = [];
  for (const minute of minutes) {
    const last = ranges[ranges.length - 1];
    if (last && minute === last.endMin + 1) {
      last.endMin = minute;
    } else {
      ranges.push({ startMin: minute, endMin: minute });
    }
  }
  return ranges;
}

/** @param {Array<{startMin:number,endMin:number}>} ranges @returns {string} e.g. "12–15 min, 40–42 min" */
function formatMinuteRanges(ranges) {
  return ranges
    .map((r) => (r.startMin === r.endMin ? r.startMin + " min" : r.startMin + "–" + r.endMin + " min"))
    .join(", ");
}

//#region exports (dual: Node require for tests, window global for the browser)
const CoincidenceLimitCheck = { checkCoincidenceLimit, formatMinuteRanges, DEFAULT_LB_COINCIDENCE_LIMIT, DEFAULT_LS_COINCIDENCE_LIMIT };

if (typeof module !== "undefined") {
  module.exports = CoincidenceLimitCheck;
}
if (typeof window !== "undefined") {
  window.CoincidenceLimitCheck = CoincidenceLimitCheck;
}
//#endregion

})();

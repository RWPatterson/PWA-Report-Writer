"use strict";
/* =====================================================================================
   cyclicCompanionFile.js  —  parses a "-Cyclic.DAT" companion file into structured arrays.
   =====================================================================================
   ISO 23369 (cyclic multipass) rigs write TWO files per test: the normal .DAT file
   (parsed by DataFile, dataFile.js) plus a same-named "-Cyclic.DAT" companion, sampled
   much faster (~5s vs. the primary file's ~60s), that records the flow/pressure signal
   densely enough to resolve the flow cycle itself (e.g. a real fixture's CycleTime=10s —
   the primary file's own once-a-minute sampling can't resolve that on its own).

   Confirmed against three real fixture pairs (tools/render-check/Test DAT files/
   "Cyclic Multipass(-Cyclic).DAT", "50ch CyclicMP(-Cyclic).DAT",
   "SpinOnCyclicMP(-Cyclic).DAT") that this companion format is STRUCTURALLY DIFFERENT
   from the primary .DAT format, not a variant of it — no HEADER/ENDHEADER/DATA/ENDDATA
   markers at all (confirmed absent by exhaustive search). Just one ";Data Format:" tag
   row, followed directly by flat data rows, one row per sample
   ("<HH:MM:SS>", <value>, <value>, ...) — no LBU/LBD-style repeat-grouping. Whether the
   file ends with a trailing bare "ENDDATA" line is INCONSISTENT across the three real
   pairs (present in 2, absent in 1), so this parser never relies on one being there —
   every line after the tag row is a data row, unconditionally.

   This is why it's a separate sibling file/class to DataFile rather than folded into
   it: same tag vocabulary and filename convention, genuinely different container
   format (core/machineProfile.js + core/machineProfiles.js already establish the
   "related-but-distinct concerns get sibling files" precedent in this directory).
   Reuses DataFile.splitLine (quote-aware CSV splitting) and DataFile.parseClockSeries
   (HH:MM:SS + midnight-rollover parsing) rather than re-deriving either.
   ===================================================================================== */

// NOT named `DataFile` — dataFile.js is NOT IIFE-wrapped (see its own header
// comment), so `class DataFile` is a real top-level lexical binding in the shared
// classic-script global scope, not just a window property. A same-named top-level
// `const DataFile` here would collide with it ("Identifier 'DataFile' has already
// been declared") — exactly the trap analysisMath.js's own header comment warns
// about for exactly this reason.
const DataFileClass = (typeof module !== "undefined") ? require("./dataFile.js").DataFile : window.DataFile;

// See alignToPrimary's own comment — a primary file's own first record only gets
// written once a full count cycle completes (confirmed by the user, 2026-08-20;
// ~99% of fielded machines run a 60s count cycle), so a genuinely matching
// companion file's own first row lands within about that same cycle length of
// the primary's start, not an arbitrary "usually close" observation. 10 minutes
// is a deliberately generous multiple of that (safe even for an unusually long
// count cycle) before treating it as a mismatched-file warning.
const PLAUSIBLE_START_OFFSET_SEC = 600;

class CyclicCompanionFile {

//#region construction & parsing

  /** @param {string} [fileText] */
  constructor(fileText) {
    /** @type {string[]} channel names from the one ";Data Format:" row (arbitrary count/order — never hardcoded) */
    this.tags = [];
    /** @type {string[]} raw "HH:MM:SS" strings, one per data row */
    this.timeRaw = [];
    /** @type {Array<number|null>} elapsed seconds, aligned to a primary DataFile's own zero reference — empty until alignToPrimary() runs */
    this.times = [];
    /** @type {Array<string[]>} one row per sample; shape mirrors DataFile.prototype.analog: [timeRaw, val1, ..., valN] */
    this.analog = [];
    /** @type {string[]} */
    this.warnings = [];
    /** @type {boolean} */
    this.dataExist = false;

    if (typeof fileText === "string") {
      this.parse(fileText);
    }
  }

  /** @param {string} fileText */
  parse(fileText) {
    const lines = fileText.split(/\r\n|\n|\r/);
    const rows = lines.map(DataFileClass.splitLine);

    function rowIsEmpty(row) {
      if (!row || row.length === 0) return true;
      for (const field of row) { if (field !== "") return false; }
      return true;
    }

    // The first non-empty line MUST be the ";Data Format:" row — this format has no
    // header/markers preceding it, unlike the primary .DAT format.
    let tagRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rowIsEmpty(rows[i])) continue;
      if (rows[i][0].startsWith(";Data Format")) tagRowIndex = i;
      break;
    }
    if (tagRowIndex < 0) {
      this.warnings.push("First non-empty line is not a \";Data Format:\" row. This does not look like a valid cyclic companion file.");
      return;
    }

    if (rows[tagRowIndex].length > 1) {
      this.tags = rows[tagRowIndex].slice(1);
    } else {
      // Same "whole row wrapped in one pair of quotes" shape dataFile.js's own
      // ;Data Format: capture defends against (confirmed real on a primary-format
      // file, P-Q_V2_B9939_02.dat) — cheap to guard here too, same underlying risk.
      const colonIdx = rows[tagRowIndex][0].indexOf(":");
      const afterColon = colonIdx >= 0 ? rows[tagRowIndex][0].slice(colonIdx + 1) : rows[tagRowIndex][0];
      this.tags = afterColon.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    }

    for (let i = tagRowIndex + 1; i < rows.length; i++) {
      if (rowIsEmpty(rows[i])) continue;
      // Not relied on (confirmed absent in 1 of 3 real fixtures), but when a bare
      // "ENDDATA" sentinel line IS present (confirmed in 2 of 3), it must not be
      // misparsed as a 1-field data row — skip it explicitly, same as dataFile.js
      // treats ENDDATA as a marker, never data.
      if (rows[i][0] === "ENDDATA") continue;
      this.analog.push(rows[i]);
      this.timeRaw.push(rows[i][0]);
    }

    this.dataExist = this.analog.length > 0;
    if (this.tags.length === 0) {
      this.warnings.push("\";Data Format:\" row had no channel names.");
    }
    if (!this.dataExist) {
      this.warnings.push("No data rows found after the \";Data Format:\" row.");
    }
  }
//#endregion

//#region time alignment

  /* alignToPrimary: computes this.times (elapsed seconds) using the exact same
     absolute zero-reference (startTimeDay) as the given primary DataFile — NOT an
     independently-computed one. The two files' own wall-clock timestamps are close
     but not exactly aligned (confirmed: the companion file typically starts a little
     BEFORE the primary file's first row), and the companion file has no CountTime/
     HoldTime header of its own to derive a zero point from independently — the only
     defensible shared zero point is the primary file's own already-computed one, so
     that a companion time and a primary time are directly comparable/interpolatable
     on one shared axis.
     @param {import("./dataFile.js").DataFile} primaryDf */
  alignToPrimary(primaryDf) {
    if (!primaryDf || typeof primaryDf.startTimeDay !== "number") {
      this.warnings.push("Cannot align to the primary file's time axis — primary file has no valid timestamps.");
      this.times = this.timeRaw.map(function () { return null; });
      return;
    }
    const absoluteDays = DataFileClass.parseClockSeries(this.timeRaw);
    this.times = absoluteDays.map(function (day) {
      return day === null ? null : Math.round((day - primaryDf.startTimeDay) * 86400);
    });

    // Sanity check, added 2026-08-20 after a real live report: a companion file
    // whose own wall-clock timestamps don't actually belong to this primary file's
    // session (e.g. the wrong "-Cyclic.DAT" got attached — a same-day rig can easily
    // produce more than one) used to align "successfully" with no warning at all —
    // the arithmetic is well-defined for any two files, it just produces a wildly
    // wrong elapsed-time axis (a real case: 4.5 HOURS off), which silently poisons
    // termination time, every reporting-time bucket, and the injection-volume
    // calculation without ever surfacing as an error. A genuinely matching pair's
    // own first rows land within about a minute of each other by construction, not
    // coincidence — confirmed by the user: a primary file's own first record only
    // gets written once a full count cycle completes, ~60s for ~99% of fielded
    // machines (see CLAUDE.md's ".DAT file handling"). PLAUSIBLE_START_OFFSET_SEC
    // is a deliberately generous multiple of that, so this only fires on a genuine
    // mismatch, not ordinary logging-start jitter or an unusually long count cycle.
    const firstOffset = this.times.length > 0 ? this.times[0] : null;
    if (firstOffset !== null && Math.abs(firstOffset) > PLAUSIBLE_START_OFFSET_SEC) {
      this.warnings.push(
        "This companion file's own timestamps start " + Math.round(Math.abs(firstOffset) / 60) +
        " minutes " + (firstOffset > 0 ? "AFTER" : "before") + " the primary file's start — far more than the " +
        "few seconds of jitter a genuinely matching pair normally shows. This looks like the wrong \"-Cyclic.DAT\" " +
        "file for this primary file (check for another one from the same day); using it as-is will produce a " +
        "badly wrong termination time and reporting-time buckets.");
    }
  }
//#endregion

//#region channel access

  /* getChannel: full time series for one named tag, in file order. Returns null if
     the tag isn't in this.tags. Byte-identical shape/semantics to
     DataFile.prototype.getChannel (+1 offset for the leading timestamp field) — works
     unmodified because this.analog mirrors DataFile's own row shape, so the same
     helpers (interpolateAt, findCrossingBracket in helpers/analysisMath.js) work
     against a CyclicCompanionFile exactly as they do against a DataFile.
     @param {string} tagName @returns {Array<number|null>|null} */
  getChannel(tagName) {
    const index = this.tags.indexOf(tagName);
    if (index < 0) return null;
    const values = [];
    for (const row of this.analog) {
      const raw = row[index + 1];   // +1: field 0 is the timestamp
      const num = parseFloat(raw);
      values.push(isFinite(num) ? num : null);
    }
    return values;
  }
//#endregion
}

//#region exports (dual: Node require for tests, window global for the browser)
if (typeof module !== "undefined") module.exports = { CyclicCompanionFile };
if (typeof window !== "undefined") window.CyclicCompanionFile = CyclicCompanionFile;
//#endregion

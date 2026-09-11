"use strict";
/* Fidelity check for dataFile.js's ENDDATA recovery (per CLAUDE.md: non-trivial
   logic leaves one runnable check behind). Built from a real fixture file, not a
   hand-typed one — per CLAUDE.md's ".DAT file handling" rule, "verify against a
   real file" applies to test fixtures too, not just the parser itself.

   Run directly: `node dataFile.selfcheck.js`. */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("./dataFile.js");

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

const FIXTURE = path.join(__dirname, "..", "..", "tools", "render-check", "Test DAT files", "SpinOnMP.DAT");
const realText = fs.readFileSync(FIXTURE, "utf8");

// ---- Control: the real, well-formed file (has a real bare "ENDDATA" line) ----
assert(/^ENDDATA\s*$/m.test(realText), "fixture precondition: SpinOnMP.DAT really does have a bare ENDDATA line");
const wellFormed = new DataFile(realText);
assert(wellFormed.dataExist, "well-formed file: dataExist is true");
assert(wellFormed.analog.length > 0, "well-formed file: real records parsed (got " + wellFormed.analog.length + ")");
assert(!wellFormed.warnings.some((w) => /ENDDATA/.test(w)), "well-formed file: no ENDDATA-related warning");
assert(wellFormed.truncated === false, "well-formed file: truncated flag stays false");

// ---- Truncated: same real file, ENDDATA line removed (simulates an interrupted
// test — the control program never got to write the closing marker) ----
const truncatedText = realText.replace(/^ENDDATA\s*$/m, "");
const truncated = new DataFile(truncatedText);
assert(truncated.dataExist, "truncated file (no ENDDATA): recovered — dataExist is true");
assert(truncated.analog.length === wellFormed.analog.length,
  "truncated file: recovers the SAME record count as the well-formed file (got " + truncated.analog.length + ", expected " + wellFormed.analog.length + ")");
assert(truncated.warnings.some((w) => /ENDDATA/.test(w) && /truncat/i.test(w)),
  "truncated file: warns that ENDDATA was missing and the file appears truncated (got: " + truncated.warnings.join(" | ") + ")");
assert(truncated.truncated === true, "truncated file: truncated flag is set (what app.js's alertIfTruncated checks)");

// ---- Negative control: DATA marker itself also missing — nothing to recover from,
// must still fail closed (no records), not silently misparse the header block as data ----
const noDataMarkerText = realText.replace(/^DATA\s*$/m, "").replace(/^ENDDATA\s*$/m, "");
const noDataMarker = new DataFile(noDataMarkerText);
assert(!noDataMarker.dataExist, "file missing DATA marker entirely: dataExist stays false (nothing recoverable)");
assert(noDataMarker.analog.length === 0, "file missing DATA marker entirely: no records parsed");
assert(noDataMarker.warnings.some((w) => /DATA marker not found/.test(w)),
  "file missing DATA marker entirely: warns DATA marker not found (got: " + noDataMarker.warnings.join(" | ") + ")");
assert(noDataMarker.fileName !== "", "file missing DATA marker entirely: header still parses fine (fileName=" + noDataMarker.fileName + ")");
assert(noDataMarker.truncated === false, "file missing DATA marker entirely: truncated flag stays false (nothing was recovered, so nothing to alert about)");

// ---- Truncated file mid-record: drop the last (incomplete) data row too, on top of
// removing ENDDATA — the existing leftoverRows trim should drop the partial trailing
// record, same as it already does for a well-formed file with a malformed data block ----
const lines = truncatedText.split(/\r\n|\n|\r/);
const lastRealLineIndex = lines.map((l) => l.trim()).lastIndexOf(lines.map((l) => l.trim()).filter((l) => l !== "").pop());
const midRecordText = lines.slice(0, lastRealLineIndex).join("\n"); // drop the final data row entirely
const midRecord = new DataFile(midRecordText);
assert(midRecord.dataExist, "truncated mid-record: still recovers the complete records that ARE present");
assert(midRecord.analog.length === wellFormed.analog.length - 1,
  "truncated mid-record: drops exactly the one incomplete trailing record (got " + midRecord.analog.length + ", expected " + (wellFormed.analog.length - 1) + ")");
assert(midRecord.warnings.some((w) => /not a multiple of/.test(w)),
  "truncated mid-record: also warns about the incomplete trailing record, same as a well-formed file with a malformed data block would");

// ---- The realistic power-outage case: the very last line is genuinely CUT SHORT
// mid-write (fewer fields than a real row of that type has), not just absent —
// this is what the new row-width validation specifically catches, distinct from
// the whole-row-missing case above (which only ever exercised the pre-existing
// leftoverRows trim). Chop the last data line down to half its fields. ----
const lastLine = lines[lastRealLineIndex];
const lastLineFields = lastLine.split(",");
const cutShortLine = lastLineFields.slice(0, Math.floor(lastLineFields.length / 2)).join(",");
assert(cutShortLine.split(",").length !== lastLineFields.length, "test precondition: the cut-short line really is narrower than the real one");
const cutShortText = lines.slice(0, lastRealLineIndex).concat([cutShortLine]).join("\n");
const cutShort = new DataFile(cutShortText);
assert(cutShort.truncated === true, "cut-short trailing line: truncated flag is set");
assert(cutShort.warnings.some((w) => /malformed/i.test(w) && /mid-line/i.test(w)),
  "cut-short trailing line: warns about a malformed row cut off mid-line (got: " + cutShort.warnings.join(" | ") + ")");
assert(cutShort.analog.length === wellFormed.analog.length - 1,
  "cut-short trailing line: drops exactly the one record the cut-short row belonged to (got " + cutShort.analog.length + ", expected " + (wellFormed.analog.length - 1) + ")");
// Confirm every record BEFORE the cut-short one round-trips identically to the
// well-formed file — the fix doesn't perturb good data ahead of the bad row.
assert(JSON.stringify(cutShort.analog) === JSON.stringify(wellFormed.analog.slice(0, cutShort.analog.length)),
  "cut-short trailing line: every record before the bad one is byte-for-byte identical to the well-formed parse");

// ---- Real regression, 2026-08-20: SpinOnCyclicMP.DAT has TWO independent width
// quirks in one file — analog rows 24 fields wide against only 22 declared
// ";Data Format:" tags (extra, undeclared trailing columns — harmless, getChannel
// reads by index and never looks past what it needs), AND LBSizes/LSSizes each
// declare a trailing "0" padding sentinel that count rows never actually carry a
// value for (33 declared, 32 real). Before the fix, the malformed-trailing-row scan
// (built to catch a genuine power-outage mid-write) treated every row in the WHOLE
// 600-row data block as malformed for one of these two reasons, and dropped all of
// it. Real, ENDDATA-terminated file — reported live by the user via exactly this
// symptom ("the file clearly has an end data tag") on a different, similarly-shaped
// file; this fixture reproduces the same underlying bug byte-for-byte. ----
const CYCLIC_FIXTURE = path.join(__dirname, "..", "..", "tools", "render-check", "Test DAT files", "SpinOnCyclicMP.DAT");
const cyclicText = fs.readFileSync(CYCLIC_FIXTURE, "utf8");
assert(/^ENDDATA\s*$/m.test(cyclicText), "fixture precondition: SpinOnCyclicMP.DAT really does have a bare ENDDATA line");
const wideRows = new DataFile(cyclicText);
assert(wideRows.dataExist, "wide-row fixture: dataExist is true (not dropped as fully malformed)");
assert(wideRows.truncated === false, "wide-row fixture: truncated flag stays false — nothing genuinely truncated here");
assert(wideRows.analog.length === 120, "wide-row fixture: every real record recovered (got " + wideRows.analog.length + ", expected 120)");
assert(wideRows.warnings.length === 0, "wide-row fixture: no spurious malformed-row warning (got: " + wideRows.warnings.join(" | ") + ")");
assert(wideRows.lbSizes.length === 32, "wide-row fixture: trailing '0' sentinel stripped from LBSizes (got " + wideRows.lbSizes.length + ", expected 32)");
assert(wideRows.lsSizes.length === 32, "wide-row fixture: trailing '0' sentinel stripped from LSSizes (got " + wideRows.lsSizes.length + ", expected 32)");
assert(wideRows.lbu[0].length === 32, "wide-row fixture: count rows read at their real width (32), matching the stripped size list");

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) FAILED.");
if (failures > 0) process.exit(1);

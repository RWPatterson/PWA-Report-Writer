"use strict";
/* Fidelity check for cyclicCompanionFile.js (per CLAUDE.md: non-trivial logic leaves
   one runnable check behind). Built from THREE real fixture pairs, not a hand-typed
   one — per CLAUDE.md's ".DAT file handling" rule, "verify against a real file"
   applies to test fixtures too. The three real companion files differ in ways worth
   covering on purpose: quoted vs. fully-unquoted CSV style, 12 tags vs. 8 tags, and
   presence vs. absence of a trailing bare "ENDDATA" line.

   Run directly: `node cyclicCompanionFile.selfcheck.js`. */

const path = require("path");
const fs = require("fs");
const { DataFile } = require("./dataFile.js");
const { CyclicCompanionFile } = require("./cyclicCompanionFile.js");

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

const DIR = path.join(__dirname, "..", "..", "tools", "render-check", "Test DAT files");
function readFixture(name) {
  return fs.readFileSync(path.join(DIR, name), "utf8");
}

function assertCyclesStepEvenly(companion, label, expectedFirst, expectedLast) {
  const cycles = companion.getChannel("Cycle");
  assert(cycles !== null, label + ": has a Cycle channel");
  assert(cycles[0] === expectedFirst, label + ": Cycle starts at " + expectedFirst + " (got " + cycles[0] + ")");
  assert(cycles[cycles.length - 1] === expectedLast,
    label + ": Cycle ends at " + expectedLast + " (got " + cycles[cycles.length - 1] + ")");
  let stepsOk = true;
  for (let i = 1; i < cycles.length; i++) {
    if (Math.abs((cycles[i] - cycles[i - 1]) - 0.5) > 1e-9) { stepsOk = false; break; }
  }
  assert(stepsOk, label + ": Cycle increments by exactly 0.5 every row, no gaps/dupes");
}

// ---- Fixture 1: "Cyclic Multipass-Cyclic.DAT" — quoted style, 12 tags, NO trailing ENDDATA ----
const cm = new CyclicCompanionFile(readFixture("Cyclic Multipass-Cyclic.DAT"));
assert(cm.dataExist, "Cyclic Multipass-Cyclic.DAT: dataExist is true");
assert(cm.warnings.length === 0, "Cyclic Multipass-Cyclic.DAT: no warnings (got: " + cm.warnings.join(" | ") + ")");
assert(cm.tags.length === 12, "Cyclic Multipass-Cyclic.DAT: 12 tags (got " + cm.tags.length + ")");
assert(cm.tags[0] === "TS_Rate" && cm.tags[3] === "TS_DPress" && cm.tags[11] === "Cycle",
  "Cyclic Multipass-Cyclic.DAT: tag order matches the primary file's own ;Data Format: row (got: " + cm.tags.join(",") + ")");
assert(cm.analog.length === 248, "Cyclic Multipass-Cyclic.DAT: exactly 248 data rows (got " + cm.analog.length + ")");
assert(cm.timeRaw.length === 248, "Cyclic Multipass-Cyclic.DAT: timeRaw matches analog length");
assertCyclesStepEvenly(cm, "Cyclic Multipass-Cyclic.DAT", 1.5, 125);

// ---- Fixture 2: "50ch CyclicMP-Cyclic.DAT" — quoted style, 12 tags, HAS trailing ENDDATA ----
const ch50 = new CyclicCompanionFile(readFixture("50ch CyclicMP-Cyclic.DAT"));
assert(ch50.dataExist, "50ch CyclicMP-Cyclic.DAT: dataExist is true");
assert(ch50.analog.length === 842,
  "50ch CyclicMP-Cyclic.DAT: exactly 842 data rows — the trailing bare ENDDATA line is excluded, not counted as row 843 (got " + ch50.analog.length + ")");
assert(ch50.analog.every((row) => row[0] !== "ENDDATA"), "50ch CyclicMP-Cyclic.DAT: no row's timestamp field is the literal string \"ENDDATA\"");
assertCyclesStepEvenly(ch50, "50ch CyclicMP-Cyclic.DAT", 1.5, 422);

// ---- Fixture 3: "SpinOnCyclicMP-Cyclic.DAT" — FULLY UNQUOTED style, only 8 tags
// (no UpRatio/UpSensor/DnRatio/DnSensor — confirms the tag list is read per-file, not
// hardcoded to 12), HAS trailing ENDDATA ----
const spinOn = new CyclicCompanionFile(readFixture("SpinOnCyclicMP-Cyclic.DAT"));
assert(spinOn.dataExist, "SpinOnCyclicMP-Cyclic.DAT: dataExist is true (confirms unquoted CSV style parses fine, same splitLine as the primary format)");
assert(spinOn.tags.length === 8, "SpinOnCyclicMP-Cyclic.DAT: 8 tags, not hardcoded to 12 (got " + spinOn.tags.length + ": " + spinOn.tags.join(",") + ")");
assert(spinOn.analog.length === 1439, "SpinOnCyclicMP-Cyclic.DAT: exactly 1439 data rows, trailing ENDDATA excluded (got " + spinOn.analog.length + ")");
assertCyclesStepEvenly(spinOn, "SpinOnCyclicMP-Cyclic.DAT", 1.5, 720.5);

// ---- getChannel: correctness + graceful miss ----
const tsRate = cm.getChannel("TS_Rate");
assert(Math.abs(tsRate[0] - 12.9553605201512) < 1e-9,
  "Cyclic Multipass-Cyclic.DAT: getChannel('TS_Rate')[0] matches the real fixture value exactly (got " + tsRate[0] + ")");
assert(cm.getChannel("NoSuchTag") === null, "getChannel returns null for a tag that isn't in this file, not an empty/garbage array");

// ---- Negative control: a NORMAL primary .DAT file (HEADER/ENDHEADER/DATA/ENDDATA
// wrapped) must be correctly REJECTED, not silently misparsed as a companion file ----
const normalDatText = readFixture("SpinOnMP.DAT");
const rejectedAsCompanion = new CyclicCompanionFile(normalDatText);
assert(!rejectedAsCompanion.dataExist, "a normal HEADER-wrapped .DAT file is NOT accepted as a cyclic companion file");
assert(rejectedAsCompanion.warnings.some((w) => /Data Format/.test(w)),
  "a normal .DAT file produces the 'not a valid cyclic companion file' warning (got: " + rejectedAsCompanion.warnings.join(" | ") + ")");

// ---- alignToPrimary: shares the primary file's own zero reference, not an
// independently-computed one ----
const primaryDf = new DataFile(readFixture("Cyclic Multipass.DAT"));
assert(primaryDf.dataExist, "primary Cyclic Multipass.DAT precondition: parses ok");
assert(typeof primaryDf.startTimeDay === "number", "primary DataFile exposes startTimeDay (the dataFile.js refactor)");
cm.alignToPrimary(primaryDf);
assert(cm.times.length === cm.analog.length, "alignToPrimary: times has one entry per data row");
assert(cm.times.every((t) => t !== null), "alignToPrimary: every companion row got a real elapsed-time value");
let monotonic = true;
for (let i = 1; i < cm.times.length; i++) { if (cm.times[i] < cm.times[i - 1]) { monotonic = false; break; } }
assert(monotonic, "alignToPrimary: times is monotonically non-decreasing (companion's own wall-clock progresses forward)");
assert(cm.times[0] < primaryDf.times[0],
  "alignToPrimary: the companion file's first row lands BEFORE the primary file's first row on the shared axis " +
  "(confirmed real: companion logging starts before the primary file's first analog sample) — got companion=" +
  cm.times[0] + "s, primary=" + primaryDf.times[0] + "s");

assert(!cm.warnings.some((w) => /wrong.*Cyclic\.DAT|far more than/.test(w)),
  "alignToPrimary: a genuinely matching pair does NOT trigger the mismatched-file warning");

// ---- Real regression, 2026-08-20 (live user report): a companion file whose own
// wall-clock timestamps don't belong to this primary file's session at all (e.g. the
// wrong "-Cyclic.DAT" got attached — confirmed real: a user's report showed a
// termination time of 5:56 for a test that actually ran 1:25, traced to exactly this)
// used to align "successfully" with no warning, silently producing a wildly wrong
// elapsed-time axis. Synthetic companion, same tag shape as a real fixture, but its
// timestamps sit ~4.5 hours after Cyclic Multipass.DAT's own start (15:46:27) ----
{
  const mismatchedText = ';Data Format:,TS_Rate,Cycle\n"20:15:00",25,1.5\n"20:15:05",100,2.0\n';
  const mismatched = new CyclicCompanionFile(mismatchedText);
  assert(mismatched.dataExist, "mismatched-timestamp companion: still parses fine structurally");
  mismatched.alignToPrimary(primaryDf);
  assert(mismatched.warnings.some((w) => /wrong.*Cyclic\.DAT|far more than/.test(w)),
    "alignToPrimary: a companion file whose timestamps are hours off from the primary file's own session DOES warn (got: " + mismatched.warnings.join(" | ") + ")");
}

// alignToPrimary with no usable primary must fail safe, not throw
const orphan = new CyclicCompanionFile(readFixture("Cyclic Multipass-Cyclic.DAT"));
orphan.alignToPrimary(null);
assert(orphan.times.every((t) => t === null), "alignToPrimary(null): fails safe to an all-null times array, doesn't throw");
assert(orphan.warnings.some((w) => /align/i.test(w)), "alignToPrimary(null): warns that alignment couldn't happen");

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) FAILED.");
if (failures > 0) process.exit(1);

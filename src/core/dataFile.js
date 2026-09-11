"use strict";
/* =====================================================================================
   dataFile.js  —  parses a .DAT test file into structured arrays.
   =====================================================================================
   No DOM, no UI. This is the single source of truth for the .DAT format across every
   tool in this project (Data File Explorer, report writers, future tools). If the file
   format changes or a new field is needed, this is the only file that should change.

   -------------------------------------------------------------------------------------
   CHANGE LOG vs. the version shipped in the Data File Explorer
   -------------------------------------------------------------------------------------
   FIXED: 5-row record order for LB+LS files.
     Old (wrong):  analog, LBU, LBD, LSU, LSD   (grouped by sensor)
     New (right):  analog, LBU, LSU, LBD, LSD   (grouped by up/down)
     Verified against 2022-054-Test1S2-MP.DAT: computing beta = upstream/downstream
     under the old order gives beta < 1 (physically impossible — a filter cannot pass
     more particles than enter it) in 27 of 27 records. Under the corrected order,
     0 of 27 records violate that constraint, and LB beta (~2000-7800) and LS beta
     (~1-21, climbing smoothly over the test) both fall in physically sane ranges.
     This bug traces to the original DataFileExplorerV1.xltm VBA; the newer report
     writer's DataFileMod.bas has the corrected order, which this file now matches.

   ADDED: a second 5-row record shape ("LBLB"), for files with LBESizes instead of
     LSSizes: analog, LBU, [unused], LBD, LBE. Detected the same way the report
     writer detects it: LSSizes present -> LBLS order, else -> LBLB order.

   ADDED: TestSetup, MidstreamFlag, HoldTime header fields, and a getChannel()
     accessor for pulling one named analog channel's full time series — all needed
     by the ISO 16889 analysis engine's termination logic.

   ADDED: DataFile.parseClockSeries() (extracted from buildTimes(), same behavior)
     and this.startTimeDay (the absolute day-fraction buildTimes() already computed
     as its zero-reference epoch, now exposed as a property instead of staying a
     local variable). Both needed by core/cyclicCompanionFile.js, which parses a
     same-named "-Cyclic.DAT" companion file (ISO 23369) that shares this file's
     HH:MM:SS timestamp convention but has no HEADER/DATA wrapper of its own to
     compute an independent zero reference from — it aligns onto the PRIMARY file's
     own startTimeDay instead. Pure refactor otherwise; buildTimes()'s own behavior
     is unchanged.

   -------------------------------------------------------------------------------------
   DILUTION SYSTEM SCHEMA (background knowledge, not yet parsed into named properties —
   preserved here so it isn't lost; see WISHLIST.md for the control-target-compliance
   feature this was gathered for)
   -------------------------------------------------------------------------------------
   All under ;Dilution System Configuration in the header:

     PrimaryDilutionRatio,<up>,<down>   Stage 1 setpoint. Each dilution stage can
     ExtendedDilutionRatio,<up>,<down>  perform a dilution factor of 10 (a 9:1 ratio).
                                        A single-stage machine tops out at 9:1; a
                                        standard two-stage machine at 99:1 cumulative.
                                        ExRaDs-equipped machines (see MidstreamFlag
                                        below) add a third stage with a dilution
                                        factor of 20, for a 1999:1 cumulative maximum.
                                        ExtendedDilutionRatio is the CUMULATIVE target
                                        through whichever stages are active, not an
                                        incremental second-stage-only value.

     LBSensorFlow,<up>,<down>          Setpoints for the particle counter's own
     LSSensorFlow,<up>,<down>          sample draw flow, separate per sensor type —
                                        ONLY on an ExRaDs-equipped, extended-range
                                        dual-sensor rig (see MidstreamFlag below).
                                        Verified against a real file: LBSensorFlow
                                        25,25 matches the aQLBU/aQLBD channels
                                        (~25.07/24.89 at test start); LSSensorFlow
                                        10,10 matches aQLSU/aQLSD (~10.01/9.93).

     SensorFlow,<up>,<down>            The SAME quantity as LBSensorFlow/LSSensorFlow
                                        above, but on a single-sensor rig — no LB/LS
                                        split, no prefix, matching the live UpSensor/
                                        DnSensor channels (not aQLBU/aQLBD — a single-
                                        sensor rig doesn't use the aQ-prefixed naming
                                        at all). CONFIRMED against a real file
                                        (2026-08-11, TwinFSRig-ROTest9-MP.DAT,
                                        "ROTest9"): "SensorFlow,25,25" with
                                        UpSensor/DnSensor live channels, no
                                        LBSensorFlow/aQLBU/aQLBD anywhere in the file.
                                        Do not confuse this with SampleFlow below —
                                        a real, much larger, separately-tracked
                                        quantity (a past bug in iso16889Analysis.js's
                                        Downstream_Sample_Flow conflated the two).

     SampleFlow,<up>,<down>            CAUTION: this key appears TWICE in this
                                        section — once for the primary stage (right
                                        after PrimaryDilutionRatio) and again for the
                                        extended stage (right after
                                        ExtendedDilutionRatio). getHeaderValue()
                                        returns only the FIRST match for a key within
                                        a section, so it can't distinguish the two —
                                        use getAllHeaderValues() instead (returns
                                        every occurrence, in file order) when this
                                        distinction matters, as iso454812Mapper.js's
                                        Sample Flow Rate field now does.

   Corresponding measured channels — a NON-midstream ExRaDs extended-range dual-sensor
   rig prefixes these aU.../aD... for actual-Upstream/actual-Downstream; a single-
   sensor rig uses its own, differently-prefixed names for the same quantities (see
   SensorFlow above). A MidstreamFlag:true rig uses a THIRD, different naming scheme
   entirely — see below, don't assume this one applies there too:
     aUpPrimRatio, aDnPrimRatio   Actual stage-1 dilution ratio.
     aUpExRatio,   aDnExRatio     Actual CUMULATIVE dilution ratio through every
                                  active stage (confirmed: not incremental).
     aQLBU, aQLBD                Actual LB sensor sample flow (matches LBSensorFlow).
     aQLSU, aQLSD                Actual LS sensor sample flow (matches LSSensorFlow).
     UpRatio, DnRatio             Single-sensor rig's own dilution ratio channel — no
                                  primary/extended stage split (confirmed, ROTest9).
     UpSensor, DnSensor           Single-sensor rig's own sensor-flow channel (matches
                                  SensorFlow, NOT SampleFlow — confirmed, ROTest9).

   MidstreamFlag:true dilution-ratio channels — CONFIRMED against LBLBDataOnly.DAT,
   gathered while scoping the coincidence-limit check (see helpers/
   coincidenceLimitCheck.js and each standard's own resolveCoincidenceChannels):
     aUpRatio                    LB's own upstream (LBU) actual dilution ratio.
     aMidPrimRatio                LB's own downstream (LBD) — the SHARED midstream
                                  point (see MidstreamFlag below): the pre-filter's
                                  own downstream sample IS the final filter's own
                                  upstream sample, one physical draw.
     aMidExRatio, aDnRatio        The secondary filter's own bracketing pair — per
                                  the user, TYPICALLY this is LS (aMidExRatio =
                                  LS's upstream, reading the same midstream point
                                  via the extended dilution stage; aDnRatio = LS's
                                  true final downstream). On the RARE machines where
                                  LBE brackets the secondary filter instead of LS,
                                  aDnRatio alone describes LBE's own reading (it has
                                  no "up" of its own — reuses aMidPrimRatio's own
                                  midstream point directly) and aMidExRatio goes
                                  unused. Only the rare/LBE case has a real fixture
                                  file confirming it so far; the typical LS case is
                                  per the user, no file exists yet to check it
                                  against.
     RATIO-VALUE-OF-0 RULE: a ratio channel reading exactly 0 means that dilution
                                  STAGE is inactive (an effective ratio of 1, i.e.
                                  undiluted), not "no data" — confirmed via
                                  LBLBDataOnly.DAT's own PrimaryDilutionRatio:0,0
                                  header setpoint (aUpRatio/aMidPrimRatio both read
                                  0 in that file for exactly that reason) AND,
                                  independently, via aDnRatio reading 0 on that same
                                  rig's LBE tap specifically because THAT machine has
                                  no dilution capability wired to it at all (a
                                  machine limitation, not a wrong channel — a future
                                  machine built the same way could populate it for
                                  real). A channel that's MISSING from the file
                                  entirely is different from one that's merely 0.

   No ISO standard prescribes a control tolerance for dilution ratio itself, so this
   isn't part of the control-target-compliance rule table — kept here purely as
   schema knowledge for whoever next touches dilution-related parsing. (The
   coincidence-limit check DOES use these ratios directly, but that's a hardware-
   sensitivity check per ISO 11171, not a standard's own Allowable Test Condition
   Variation table, so it stays a separate feature — see helpers/
   coincidenceLimitCheck.js.)

   -------------------------------------------------------------------------------------
   MidstreamFlag — what it actually means (corrected twice now; an earlier version of
   this file's comment called it "dual-filter dilution system present," which was
   wrong, and a later version conflated it with independent per-filter pressure
   measurement, which was also wrong — corrected by the user 2026-07-30)
   -------------------------------------------------------------------------------------
   Only meaningful on ExRaDs-equipped machines (4 in the fleet as of this writing).
   When true, the hydraulic system has been reconfigured so a MIDSTREAM fluid sample is
   drawn for particle counting BETWEEN two filters — bracketing a PRIMARY filter with
   the LB (light-blocking) sensors and a SECONDARY filter with the LS (light-scattering)
   sensors — a non-standard "filter assembly" test, not a strict single-filter test.
   That is the whole of what MidstreamFlag itself tells you: where the particle-count
   sample point is. It does NOT tell you whether pressure is measured independently on
   each filter — a MidstreamFlag: true file can still log a single TS_DPress channel
   with no per-filter split. **TestSetup is the field that answers the pressure
   question**: "Two Pressure" and "Suction & Pressure" are the setups where the two
   filters' pressure is measured independently (TS_PreDPress/TS_FinalDPress instead of
   TS_DPress — see iso454812Analysis.js's confirmed pattern, since reused by
   iso16889/iso19438); other TestSetup values with MidstreamFlag: true still have a
   midstream particle-count sample point but a single, unsplit pressure channel. The two
   axes (particle-count sample point vs. pressure-channel split) are independent —
   don't gate one on the other's flag. Whichever analysis path ends a test on "either of
   two independent termination DP targets" should key that behavior off TestSetup, not
   off MidstreamFlag alone — not implemented in any of the three standards' engines yet
   (each rejects the relevant TestSetup values with a clear "not implemented yet" error
   rather than silently mishandling them). Whoever builds that path should start here.
   ===================================================================================== */

class DataFile {

  constructor(fileText) {
    // ---- Header ----
    this.fileName = "";
    this.fileDate = "";
    this.testType = "";
    this.testSetup = "";        // "Spin On" | "Pressure" | "Suction" | "Suction & Pressure" | "Two Pressure"
    this.midstreamFlag = false; // ExRaDs hydraulic reconfiguration in use — see the
                                 // DILUTION SYSTEM / ExRaDs note below. NOT simply
                                 // "dual filter"; earlier versions of this comment said
                                 // that and were wrong.
    this.sections = [];
    this.analogTags = [];       // channel names from ;Data Format: (no time tag)
    this.lbSizes = [];
    this.lsSizes = [];
    this.lbeSizes = [];
    this.countTimeSec = 60;
    this.holdTimeSec = 0;

    // ---- Data ----
    this.repeat = 0;            // 3, or 5 (in either the LBLS or LBLB shape)
    this.fiveRowShape = "";     // "LBLS" | "LBLB" | "" (only meaningful when repeat === 5)
    this.analog = [];
    this.lbu = [];
    this.lbd = [];
    this.lsu = [];
    this.lsd = [];
    this.lbe = [];
    this.timeRaw = [];
    this.times = [];
    this.startTimeDay = null;   // absolute day-fraction this.times is measured from —
                                 // see buildTimes(); exposed so a companion file (e.g.
                                 // core/cyclicCompanionFile.js) can align its own
                                 // elapsed-seconds axis to this exact same zero point.
    this.aux = [];
    this.dataExist = false;
    // true when the data block had to be recovered from an incomplete write —
    // ENDDATA missing and/or malformed trailing row(s) trimmed off (see parse()) —
    // a real, known failure mode (e.g. a power outage halting the machine mid-test),
    // not just a formatting quirk. Callers should surface this prominently (an
    // alert on load, not just a passive warning line) since it means the report may
    // be built from less than the full intended test. See this.warnings for detail.
    this.truncated = false;

    this.warnings = [];

    if (typeof fileText === "string") {
      this.parse(fileText);
    }
  }

  static splitLine(line) {
    let delimiter = ",";
    if (line.indexOf("\t") >= 0) {
      delimiter = "\t";
    }
    const fields = [];
    let currentField = "";
    let insideQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const character = line[i];
      if (character === '"') {
        insideQuotes = !insideQuotes;
      } else if (character === delimiter && !insideQuotes) {
        fields.push(currentField.trim());
        currentField = "";
      } else {
        currentField += character;
      }
    }
    fields.push(currentField.trim());
    while (fields.length > 0 && fields[fields.length - 1] === "") {
      fields.pop();
    }
    return fields;
  }

  parse(fileText) {
    const lines = fileText.split(/\r\n|\n|\r/);
    const rows = [];
    for (const line of lines) {
      rows.push(DataFile.splitLine(line));
    }

    function firstField(i) {
      if (rows[i] && rows[i].length > 0) return rows[i][0];
      return "";
    }
    function rowIsEmpty(i) {
      if (!rows[i] || rows[i].length === 0) return true;
      for (const field of rows[i]) {
        if (field !== "") return false;
      }
      return true;
    }

    // ---- Structure markers ----
    let headerRow = -1, endHeaderRow = -1, dataRow = -1, endDataRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const marker = firstField(i);
      if (marker === "HEADER" && headerRow < 0) headerRow = i;
      else if (marker === "ENDHEADER" && endHeaderRow < 0) endHeaderRow = i;
      else if (marker === "DATA" && dataRow < 0) dataRow = i;
      else if (marker === "ENDDATA" && endDataRow < 0) endDataRow = i;
    }

    if (headerRow !== 0) {
      this.warnings.push("First line is not HEADER. This does not look like a valid data file.");
      return;
    }
    if (endHeaderRow < 0) {
      this.warnings.push("ENDHEADER marker not found.");
      return;
    }
    if (dataRow < 0) {
      this.warnings.push("DATA marker not found. Header parsed only.");
    } else if (endDataRow < 0) {
      // Recoverable, not fatal: a real file ends up missing ENDDATA when the control
      // program never finished writing it — the test was interrupted (power loss,
      // operator abort, crash) partway through, after DATA and at least some real
      // records but before the closing marker. The rows are still right there in the
      // file; discarding them entirely (the old behavior) throws away real data for
      // no reason. Recover by treating the rest of the file as the data block —
      // endDataRow falls back to EOF (rows.length) below, and the existing
      // incomplete-trailing-record trim (leftoverRows, further down) already handles
      // a partial final record exactly like it always has for a well-formed file.
      this.warnings.push("ENDDATA marker not found — file appears truncated (e.g. an interrupted test). Recovered using the data present through the end of the file.");
      endDataRow = rows.length;
      this.truncated = true;
    }

    // ---- Header sections ----
    // NOTE: ";Data Format:,<channels...>" is NOT captured here even though it also
    // starts with ";" like a section marker — in every real file seen, that row sits
    // AFTER the DATA marker (it's the data block's own column-label comment, not a
    // header section), so it never falls inside this headerRow+1..endHeaderRow range.
    // It's captured below instead, by scanning the whole file. An earlier version of
    // this loop had a dead branch here that special-cased ";Data Format" as if it
    // could appear in-range — it never fired against any real file, and looked like a
    // second working capture path when it wasn't one; removed rather than left as
    // misleading dead code.
    let currentSection = null;
    for (let i = headerRow + 1; i < endHeaderRow; i++) {
      if (rowIsEmpty(i)) continue;
      const row = rows[i];
      if (row[0].startsWith(";")) {
        const sectionName = row[0].replace(/^;+/, "");
        currentSection = { name: sectionName, rows: [] };
        this.sections.push(currentSection);
      } else if (currentSection !== null) {
        currentSection.rows.push(row);
      } else {
        currentSection = { name: "General", rows: [row] };
        this.sections.push(currentSection);
      }
    }

    const sections = this.sections;
    function findHeaderRow(sectionNameContains, keyName) {
      for (const section of sections) {
        if (section.name.indexOf(sectionNameContains) < 0) continue;
        for (const row of section.rows) {
          if (row[0] === keyName) return row;
        }
      }
      for (const section of sections) {
        for (const row of section.rows) {
          if (row[0] === keyName) return row;
        }
      }
      return null;
    }

    // Some real rigs (confirmed: SpinOnCyclicMP.DAT, LBLBDataOnly.DAT — both real
    // fixtures, found 2026-08-20 chasing a "malformed row" false positive) declare a
    // fixed-length size array and leave an unused trailing slot at its default "0"
    // rather than omitting it — e.g. "LBSizes,4,5,...,70,0". A genuine declared size
    // is always a real, ascending, non-zero micron value in every file seen; a
    // trailing "0" is that padding slot, not a 33rd real bucket. Left in place, count
    // rows (which never carry a value for the padding slot — see CLAUDE.md's ".DAT
    // file handling") read one column short of the declared list's length, tripping
    // the malformed-trailing-row check below on EVERY row, not just a genuinely
    // truncated tail. Stripped here so lbSizes/lsSizes/lbeSizes.length matches what
    // count rows actually carry.
    function stripTrailingZeroSizeSentinel(sizes) {
      return (sizes.length > 1 && sizes[sizes.length - 1] === "0") ? sizes.slice(0, -1) : sizes;
    }

    let found;

    found = findHeaderRow("General Test Information", "FileName");
    if (found && found.length > 1) this.fileName = found[1];

    found = findHeaderRow("General Test Information", "TestDate");
    if (found && found.length > 1) this.fileDate = found[1];

    found = findHeaderRow("General Test Information", "TestType");
    if (found && found.length > 1) this.testType = found[1];

    found = findHeaderRow("Test System Configuration", "Setup");
    if (found && found.length > 1) this.testSetup = found[1];

    found = findHeaderRow("Dilution System Configuration", "MidstreamFlag");
    if (found && found.length > 1) {
      // Only "TRUE" (case-insensitive) is confirmed against real files — every
      // MidstreamFlag file seen has been literally "True"/"False". "#TRUE#"/"1" were
      // guessed defensive hedges for an Excel/VBA boolean-serialization variant never
      // actually observed; removed rather than kept as unverified guesses.
      this.midstreamFlag = (found[1].toUpperCase() === "TRUE");
    }

    found = findHeaderRow("Particle", "CountTime");
    if (found && found.length > 1) {
      const seconds = parseFloat(found[1]);
      if (isFinite(seconds) && seconds > 0) this.countTimeSec = seconds;
    }
    found = findHeaderRow("Particle", "HoldTime");
    if (found && found.length > 1) {
      const seconds = parseFloat(found[1]);
      if (isFinite(seconds) && seconds >= 0) this.holdTimeSec = seconds;
    }

    found = findHeaderRow("Particle", "LBSizes");
    // Confirmed legacy fallback: real pre-LB/LS/LBE-naming files use a bare "Sizes" key.
    if (!found) found = findHeaderRow("Particle", "Sizes");
    if (found) this.lbSizes = stripTrailingZeroSizeSentinel(found.slice(1));

    found = findHeaderRow("Particle", "LSSizes");
    if (found) this.lsSizes = stripTrailingZeroSizeSentinel(found.slice(1));

    found = findHeaderRow("Particle", "LBESizes");
    if (found) this.lbeSizes = stripTrailingZeroSizeSentinel(found.slice(1));

    // ";Data Format:,<channels...>" — the data block's own column-label comment (see
    // the header-sections note above), so this is the ONLY capture site for
    // analogTags, not a fallback for a header-sections branch that never fires.
    if (this.analogTags.length === 0) {
      for (let i = 0; i < rows.length; i++) {
        if (firstField(i).startsWith(";Data Format")) {
          if (rows[i].length > 1) {
            this.analogTags = rows[i].slice(1);
          } else {
            // Some real files (confirmed: P-Q_V2_B9939_02.dat) wrap the ENTIRE row —
            // ";Data Format:" prefix AND every channel name — inside one pair of
            // quotes, e.g. ";Data Format: TS_Rate, TS_Temp, ...". splitLine only
            // splits on a delimiter OUTSIDE quotes, so that whole line comes back as
            // ONE field, not one field per channel, and `rows[i].slice(1)` above
            // silently yields []. Re-split the remainder after the first colon
            // ourselves rather than relying on per-field quoting for this shape.
            const colonIdx = rows[i][0].indexOf(":");
            const afterColon = colonIdx >= 0 ? rows[i][0].slice(colonIdx + 1) : rows[i][0];
            this.analogTags = afterColon.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
          }
          break;
        }
      }
    }

    // ---- Auxiliary blocks: NAME_DATA ... NAME_ENDDATA ----
    for (let i = 0; i < rows.length; i++) {
      const match = /^([A-Za-z0-9_]+)_DATA$/.exec(firstField(i));
      if (match === null) continue;
      const blockName = match[1];
      const endMarker = blockName + "_ENDDATA";
      const blockRows = [];
      let j = i + 1;
      while (j < rows.length && firstField(j) !== endMarker) {
        if (!rowIsEmpty(j)) blockRows.push(rows[j]);
        j++;
      }
      if (j < rows.length && blockRows.length > 0) {
        this.aux.push({ name: blockName, rows: blockRows });
      }
      i = j;
    }

    // ---- Record shape ----
    // Repeat count: 5 if either LSSizes or MidstreamFlag is present, else 3.
    // (MidstreamFlag alone can imply a 5-row layout even without LS data present;
    // matches the report writer's BuildWorksheetCache rule.)
    if (this.lsSizes.length > 0 || this.midstreamFlag) {
      this.repeat = 5;
    } else {
      this.repeat = 3;
    }

    // Which 5-row shape: LB+LS interleaved (LBLS) if LSSizes is present,
    // otherwise LB+LBE (LBLB) if this is a 5-row file without LS data.
    if (this.repeat === 5) {
      this.fiveRowShape = (this.lsSizes.length > 0) ? "LBLS" : "LBLB";
    }

    if (dataRow < 0) return;

    let dataBlockRows = [];
    for (let i = dataRow + 1; i < endDataRow; i++) {
      if (rowIsEmpty(i)) continue;
      if (rows[i][0].startsWith(";")) continue;
      dataBlockRows.push(rows[i]);
    }

    // Drop trailing rows whose field count is SHORT of what their position in the
    // record implies — a real symptom of a write cut off mid-line (e.g. a power
    // outage halting the machine mid-record, per the user), not just a missing
    // ENDDATA marker. Checked from the END backward only: this format is written
    // sequentially and, per the user, only ever cut off at the tail — a genuinely
    // well-formed row never appears again after a malformed one, so there's nothing
    // to gain (and real data to lose) by scanning the whole block. Requires reliable
    // expected widths to mean anything — skipped entirely if analogTags or any size
    // list this shape actually uses came up empty (already its own separate warning
    // below), rather than validating against a width of 0 and rejecting good rows.
    //
    // A row's width only needs to be AT LEAST expectedWidth, not exactly equal — a
    // real bug (found 2026-08-20, user hit it live on a valid, ENDDATA-terminated
    // file): SpinOnCyclicMP.DAT's own analog rows are 24 fields wide against only 22
    // declared ";Data Format:" tags (2 real, undeclared trailing columns). getChannel
    // reads by tag index (row[index+1]) and simply never looks at the extra columns,
    // so a WIDER row is harmless — but the old exact-match check flagged every single
    // row as "malformed" (each one differed from expectedWidth the same way), walked
    // the ENTIRE data block back to front, and dropped all 600 real rows, not just a
    // genuinely truncated tail. Only a NARROWER-than-expected row is actually missing
    // data and still correctly caught below.
    const sizesReliable = this.analogTags.length > 0 && this.lbSizes.length > 0 &&
      (this.fiveRowShape !== "LBLS" || this.lsSizes.length > 0) &&
      (this.fiveRowShape !== "LBLB" || this.lbeSizes.length > 0);
    if (sizesReliable) {
      let malformedTrailing = 0;
      for (let k = dataBlockRows.length - 1; k >= 0; k--) {
        const slot = k % this.repeat;
        let expectedWidth;
        if (slot === 0) expectedWidth = this.analogTags.length + 1;   // analog row: leading timestamp + one value per tag
        else if (this.repeat === 3) expectedWidth = this.lbSizes.length;   // slots 1,2 = LBU,LBD
        else if (this.fiveRowShape === "LBLS") expectedWidth = (slot === 1 || slot === 3) ? this.lbSizes.length : this.lsSizes.length;
        else if (slot === 2) break;   // LBLB shape's unused placeholder row — nothing reliable to check it against, stop here
        else expectedWidth = (slot === 4) ? this.lbeSizes.length : this.lbSizes.length;

        if (dataBlockRows[k].length >= expectedWidth) break;   // well-formed (or wider-than-expected) row reached — stop trimming
        malformedTrailing++;
      }
      if (malformedTrailing > 0) {
        this.warnings.push(
          "Dropped " + malformedTrailing + " malformed row(s) at the very end of the data block " +
          "(field count didn't match what that row's position expects — most likely the file was cut " +
          "off mid-line, e.g. a power outage). Every complete row before that point was kept.");
        this.truncated = true;
        dataBlockRows = dataBlockRows.slice(0, dataBlockRows.length - malformedTrailing);
      }
    }

    const leftoverRows = dataBlockRows.length % this.repeat;
    if (leftoverRows !== 0) {
      this.warnings.push(
        "Data block has " + dataBlockRows.length + " rows, not a multiple of " +
        this.repeat + " rows per record. Ignoring the last " + leftoverRows + " row(s).");
      dataBlockRows = dataBlockRows.slice(0, dataBlockRows.length - leftoverRows);
    }

    const recordCount = dataBlockRows.length / this.repeat;
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
      const base = recordIndex * this.repeat;
      this.analog.push(dataBlockRows[base]);

      if (this.repeat === 3) {
        this.lbu.push(dataBlockRows[base + 1]);
        this.lbd.push(dataBlockRows[base + 2]);
      } else if (this.fiveRowShape === "LBLS") {
        // analog, LBU, LSU, LBD, LSD  (verified order — see change log above)
        this.lbu.push(dataBlockRows[base + 1]);
        this.lsu.push(dataBlockRows[base + 2]);
        this.lbd.push(dataBlockRows[base + 3]);
        this.lsd.push(dataBlockRows[base + 4]);
      } else {
        // LBLB shape: analog, LBU, [unused], LBD, LBE
        this.lbu.push(dataBlockRows[base + 1]);
        this.lbd.push(dataBlockRows[base + 3]);
        this.lbe.push(dataBlockRows[base + 4]);
      }
    }

    this.buildTimes();
    this.dataExist = recordCount > 0;

    if (this.analogTags.length === 0) {
      this.warnings.push("No ;Data Format: row found; analog columns are unlabeled.");
    }
    if (this.lbSizes.length === 0) {
      this.warnings.push("No LBSizes / Sizes row found; count columns are unlabeled.");
    }
    if (this.analogTags.length > 0 && this.analog.length > 0) {
      const widthsSeen = new Set();
      for (const analogRow of this.analog) widthsSeen.add(analogRow.length);
      if (widthsSeen.size > 1) {
        const sortedWidths = Array.from(widthsSeen).sort(function (a, b) { return a - b; });
        this.warnings.push("Analog rows are not a consistent width (" + sortedWidths.join(", ") + " fields).");
      }
      // A Data-Format-declared-count vs. actual-field-count mismatch used to warn here
      // too (with a "Col n" naming explanation) — removed per the user: useful as a
      // Bonavista-facing diagnostic, not something to surface to customers, and this
      // project has no user-access-tier system to gate it behind. The underlying
      // graceful degradation (unlabeled columns shown as "Col n", missing ones blank —
      // see explorerView.js) is UNCHANGED, only the warning text is gone.
    }
  }

  /* parseClockSeries: converts raw timestamp strings ("HH:MM:SS[.ms]", or an already-
     numeric day-fraction) into absolute day-fraction numbers, tracking midnight
     rollover across the series (each rollover adds a full day). Shared clock-parsing
     primitive — used by buildTimes() below and by CyclicCompanionFile's own
     alignToPrimary() (core/cyclicCompanionFile.js), which needs the identical
     HH:MM:SS/rollover handling for a "-Cyclic.DAT" companion file's own timestamps.
     Returns one entry per input, null where that entry wasn't parseable. */
  static parseClockSeries(rawTimestamps) {
    function toDayFraction(value) {
      if (value === undefined || value === "") return null;
      const clockMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(value);
      if (clockMatch !== null) {
        const hours = parseFloat(clockMatch[1]);
        const minutes = parseFloat(clockMatch[2]);
        let seconds = 0;
        if (clockMatch[3] !== undefined) seconds = parseFloat(clockMatch[3]);
        return (hours * 3600 + minutes * 60 + seconds) / 86400;
      }
      const numeric = parseFloat(value);
      if (isFinite(numeric)) return numeric;
      return null;
    }

    const absoluteDays = [];
    let previousTime = 0;
    let rolloverDays = 0;
    for (const rawTimestamp of rawTimestamps) {
      let time = toDayFraction(rawTimestamp);
      if (time === null) { absoluteDays.push(null); continue; }
      if (time + rolloverDays < previousTime) rolloverDays += 1;
      time += rolloverDays;
      absoluteDays.push(time);
      previousTime = time;
    }
    return absoluteDays;
  }

  buildTimes() {
    for (const analogRow of this.analog) this.timeRaw.push(analogRow[0]);
    const absoluteDays = DataFile.parseClockSeries(this.timeRaw);

    let firstTime;
    for (const day of absoluteDays) {
      if (day !== null) { firstTime = day; break; }
    }
    if (firstTime === undefined) {
      this.times = absoluteDays.map(function () { return null; });
      return;
    }

    this.startTimeDay = firstTime - (this.countTimeSec + this.holdTimeSec) / 86400;
    this.times = [];
    for (const day of absoluteDays) {
      this.times.push(day === null ? null : Math.round((day - this.startTimeDay) * 86400));
    }
  }

  /* getChannel: full time series for one named analog channel, in file order.
     Returns null if the channel name isn't in analogTags. Equivalent to the report
     writer's GetAnalogTagIndex + GetAnalogTagData pair, collapsed into one call. */
  getChannel(tagName) {
    const index = this.analogTags.indexOf(tagName);
    if (index < 0) return null;
    const values = [];
    for (const row of this.analog) {
      const raw = row[index + 1];   // +1: field 0 is the timestamp
      const num = parseFloat(raw);
      values.push(isFinite(num) ? num : null);
    }
    return values;
  }

  /* getHeaderValue: generic lookup into the parsed header sections, for any key
     not already promoted to a named property (fileName, testType, etc). Same
     section-then-anywhere search order as the internal header lookups above,
     e.g. getHeaderValue("General Test Information", "TerminalDP"). */
  getHeaderValue(sectionNameContains, keyName) {
    for (const section of this.sections) {
      if (sectionNameContains !== null && section.name.indexOf(sectionNameContains) < 0) continue;
      for (const row of section.rows) {
        if (row[0] === keyName) return row.length > 1 ? row[1] : null;
      }
    }
    for (const section of this.sections) {
      for (const row of section.rows) {
        if (row[0] === keyName) return row.length > 1 ? row[1] : null;
      }
    }
    return null;
  }

  /* getHeaderValues: like getHeaderValue, but returns every comma-separated value
     after the key instead of just the first — for header lines that pack more than
     one value onto a row (e.g. "DilutionRatio,29,23" -> ["29", "23"], an upstream/
     downstream pair). Same section-then-anywhere search order. Returns null if the
     key isn't found (not an empty array, so callers can tell "missing" from "found
     but empty"). */
  getHeaderValues(sectionNameContains, keyName) {
    for (const section of this.sections) {
      if (sectionNameContains !== null && section.name.indexOf(sectionNameContains) < 0) continue;
      for (const row of section.rows) {
        if (row[0] === keyName) return row.slice(1);
      }
    }
    for (const section of this.sections) {
      for (const row of section.rows) {
        if (row[0] === keyName) return row.slice(1);
      }
    }
    return null;
  }

  /* getAllHeaderValues: like getHeaderValues, but returns EVERY occurrence of a
     repeated key within a section (in file order), not just the first — for header
     lines whose key repeats with a different value set per occurrence. Confirmed
     against a real ExRaDs file: "SampleFlow" appears TWICE in Dilution System
     Configuration — once immediately after PrimaryDilutionRatio (that stage's/LB's
     sample flow) and again immediately after ExtendedDilutionRatio (the extended
     stage's/LS's) — getHeaderValues alone can't distinguish the two (see the
     Dilution System schema note above this class, which flagged this as needing a
     positional/ordered lookup). Returns [] if the key isn't found at all (each
     element is that occurrence's row.slice(1), same shape getHeaderValues returns). */
  getAllHeaderValues(sectionNameContains, keyName) {
    const all = [];
    for (const section of this.sections) {
      if (sectionNameContains !== null && section.name.indexOf(sectionNameContains) < 0) continue;
      for (const row of section.rows) {
        if (row[0] === keyName) all.push(row.slice(1));
      }
    }
    if (all.length > 0) return all;
    for (const section of this.sections) {
      for (const row of section.rows) {
        if (row[0] === keyName) all.push(row.slice(1));
      }
    }
    return all;
  }
}

if (typeof module !== "undefined") module.exports = { DataFile };
if (typeof window !== "undefined") window.DataFile = DataFile;

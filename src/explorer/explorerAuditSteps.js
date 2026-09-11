/* =====================================================================================
   explorerAuditSteps.js
   =====================================================================================
   Report CONTENT for the Audit Trail view (src/audit/auditView.js) — but unlike every
   other <id>AuditSteps.js in this tree, this one doesn't narrate a STANDARD's own
   calculations at all. It audits src/core/dataFile.js's own raw PARSING: that a
   declared size/channel actually lines up with the data column dataFile.js reads for
   it, and that every per-record array stays row-aligned. Standard-agnostic by design —
   reads only `df`, ignores `analysis` — registered as a special "explorer" entry in
   auditView.js's AUDIT_STANDARDS (see that file's own comment), selectable from
   #auditSwitch's "Data File Explorer" button (app.js).

   Per the user (2026-08-12): "show index relations, like sizes track the correct
   columns, analogs track the correct columns, rows are tracked properly." The THREE
   index relationships dataFile.js's own parse()/getChannel() rely on, each verified
   here against real values rather than just asserted in prose:
     1. ANALOG columns: analogTags[i] <-> analog[row][i + 1] — field 0 of an analog row
        is that record's own timestamp, so a channel's data is offset ONE field past
        its own tag's position in analogTags (see getChannel's own +1).
     2. COUNT columns: <sensor>Sizes[i] <-> <sensor-array>[row][i] — NO offset (count
        rows carry no leading timestamp field at all, confirmed against real files —
        see dataFile.js's own header comment and CLAUDE.md's ".DAT file handling" rule).
        The OPPOSITE convention from (1) on a superficially similar row shape — exactly
        the kind of assumption CLAUDE.md warns against carrying between functions
        without re-checking, so this is spot-checked with real values, not asserted.
     3. ROW alignment: analog/lbu/lbd/[lsu,lsd|lbe]/times are all pushed once per
        record inside the SAME loop (dataFile.js's own parse()) — they must all end up
        the same length, or a row got dropped/duplicated/misrouted somewhere in it.

   Step shape (auditView.js owns rendering/formatting, this file only supplies
   content): { id, title, clause, formula?, inputs?, output?, table?, note? }
   ===================================================================================== */
import { sampleTable, sampleWideTable } from "../audit/auditSampling.js";

/** @param {*} analysis unused — this audit is standard-agnostic, see file header
 *  @param {DataFile|null} df @param {*} store unused
 *  @returns {Array<Object>} */
export function buildAuditSteps(analysis, df, store) {
  if (!df) return [];
  const steps = [];
  // Same rounding as auditView.js's own fmt() (duplicated, not imported — see any
  // other AuditSteps.js's own note on why: no dependency between auditView.js and
  // the files it imports FROM, in either direction).
  const formatElapsed = (typeof window !== "undefined" && window.AnalysisMath) ? window.AnalysisMath.formatElapsed : (s) => String(s);
  /** parseFloat that returns null (not NaN) for a bad/missing count-row field —
   *  same convention every <id>Analysis.js's own toNumber uses. */
  function toNum(v) {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  steps.push({
    id: "record-shape",
    title: "Record shape detection",
    clause: "How many raw rows make up one time record, and what each one is",
    formula: "repeat = 5 if (lsSizes.length > 0 OR midstreamFlag), else 3. When repeat === 5: fiveRowShape = 'LBLS' if lsSizes.length > 0, else 'LBLB'. This governs which raw row gets pushed into which array below — get it wrong and EVERY size/channel reads another sensor's data instead of its own.",
    inputs: [
      { label: "lsSizes.length", value: df.lsSizes.length },
      { label: "midstreamFlag", value: df.midstreamFlag },
      { label: "repeat", value: df.repeat },
      { label: "fiveRowShape", value: df.fiveRowShape || null }
    ],
    output: {
      label: "Row order this implies",
      value: df.repeat === 3 ? "analog, LBU, LBD"
        : df.fiveRowShape === "LBLS" ? "analog, LBU, LSU, LBD, LSD"
        : df.fiveRowShape === "LBLB" ? "analog, LBU, [unused], LBD, LBE"
        : null
    },
    note: df.fiveRowShape === "LBLS"
      ? "Grouped by up/down, not by sensor — a real, previously-shipped bug here (LBU,LBD,LSU,LSD order) produced physically-impossible β < 1; see dataFile.js's own change-log note."
      : null
  });

  // ---- Row alignment: every per-record array must end up the same length — see
  // this file's own header note #3. Only lists arrays this file's shape actually
  // populates (lsu/lsd only under LBLS, lbe only under LBLB). ----
  const arrayLengths = [["analog", df.analog.length], ["lbu", df.lbu.length], ["lbd", df.lbd.length]];
  if (df.fiveRowShape === "LBLS") { arrayLengths.push(["lsu", df.lsu.length], ["lsd", df.lsd.length]); }
  if (df.fiveRowShape === "LBLB") { arrayLengths.push(["lbe", df.lbe.length]); }
  arrayLengths.push(["times", df.times.length], ["timeRaw", df.timeRaw.length]);
  const lengthsMatch = arrayLengths.every((pair) => pair[1] === arrayLengths[0][1]);
  steps.push({
    id: "row-alignment",
    title: "Row alignment",
    clause: "Every per-record array is pushed exactly once per record, inside the same loop (dataFile.js's own parse())",
    formula: "A mismatched length here means a row got dropped, duplicated, or misrouted somewhere in that loop — every array below MUST be the same length.",
    table: { columns: ["Array", "Length"], rows: arrayLengths },
    note: lengthsMatch
      ? "All arrays are the same length (" + arrayLengths[0][1] + " records) — rows are staying aligned."
      : "MISMATCH — these arrays are NOT all the same length; see analysis above for which row(s) this affects."
  });

  const timeSample = sampleTable(
    ["Raw timestamp (timeRaw)", "Elapsed time (times)"],
    df.timeRaw.map((raw, i) => [raw, formatElapsed(df.times[i])]),
    "ends"
  );
  steps.push({
    id: "row-timestamps",
    title: "Row timestamps",
    clause: "timeRaw[i] is analog[i]'s own field 0, exactly as logged; times[i] is that value converted to whole seconds elapsed since test start",
    formula: "buildTimes() parses a clock-time (HH:MM:SS) or day-fraction, tracks midnight rollover, then rounds to the nearest whole second relative to the first record minus (CountTime + HoldTime) — the moment the FIRST count cycle would have started, not the first record's own timestamp.",
    table: { columns: timeSample.columns, rows: timeSample.rows },
    note: timeSample.note
  });

  if (df.analogTags.length && df.analog.length) {
    const channelSeries = df.analogTags.map((tag) => df.getChannel(tag));
    const analogTable = sampleWideTable(
      ["Row #", "Elapsed time (s)"],
      df.analogTags,
      df.analog.map((row, i) => ({ fixed: [i, df.times[i]], bySize: channelSeries.map((series) => series[i]) })),
      { rowMode: "ends", columnUnit: "channels" }
    );
    steps.push({
      id: "analog-columns",
      title: "Analog channel column index",
      clause: "getChannel(tag): index = analogTags.indexOf(tag); value = analog[row][index + 1]",
      formula: "Field 0 of every analog row is that record's OWN timestamp — so a channel's data is offset ONE field past its own tag's position in analogTags. Values below are read via getChannel() itself (the same accessor every standard's engine uses), not re-derived here, so this proves the mechanism actually in use, not a second copy of it.",
      table: { columns: analogTable.columns, rows: analogTable.rows },
      note: analogTable.note
    });
  }

  function buildCountColumnStep(id, label, sizes, countRows) {
    if (!sizes.length || !countRows.length) return null;
    const sizeLabels = sizes.map((s) => s + "µm");
    const countTable = sampleWideTable(
      ["Row #", "Elapsed time (s)"],
      sizeLabels,
      countRows.map((row, i) => ({ fixed: [i, df.times[i]], bySize: row.map((v) => toNum(v)) })),
      { rowMode: "ends" }
    );
    return {
      id,
      title: "Count column index — " + label,
      clause: "size[i] <-> " + id + "[row][i] — NO offset",
      formula: "Count rows carry NO leading timestamp field (unlike an analog row, above) — a file with N declared sizes has count rows exactly N fields wide, so size[i] maps DIRECTLY to column i. The opposite convention from analog columns on a superficially similar row shape — confirmed against real file text, not assumed by analogy.",
      table: { columns: countTable.columns, rows: countTable.rows },
      note: countTable.note
    };
  }

  steps.push(buildCountColumnStep("lbu", "LB upstream", df.lbSizes, df.lbu));
  steps.push(buildCountColumnStep("lbd", "LB downstream", df.lbSizes, df.lbd));
  if (df.fiveRowShape === "LBLS") {
    steps.push(buildCountColumnStep("lsu", "LS upstream", df.lsSizes, df.lsu));
    steps.push(buildCountColumnStep("lsd", "LS downstream", df.lsSizes, df.lsd));
  } else if (df.fiveRowShape === "LBLB") {
    steps.push(buildCountColumnStep("lbe", "LBE", df.lbeSizes, df.lbe));
  }

  return steps.filter(Boolean);
}

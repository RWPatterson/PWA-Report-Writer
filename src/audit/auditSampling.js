/* =====================================================================================
   auditSampling.js
   =====================================================================================
   Generic sampling MACHINERY for the Audit Trail's *AuditSteps.js files: decides WHICH
   rows/columns of a large per-size/per-clump/per-bucket/per-point table to show, and how
   to label them. Has no opinion on what a row's cells mean or which standard it came
   from — purely "which indices, what label" — so per CLAUDE.md's helpers-may-be-shared
   rule this is shared across every standard's own AuditSteps.js, unlike the tables'
   actual CONTENT (which stays each standard's own, never shared).

   Full, un-sampled data always stays available in auditView.js's raw-JSON dump; this
   only trims what a human reads step-by-step. Matches the user's own framing for what a
   sample should prove: "show the first and second clump, and the final clump so we can
   tell the rule has been established and is being followed" (rows — ends mode) / "the
   first and last count channel, and some middle size, so we feel confident indexing is
   working" (columns — middle mode).
   ===================================================================================== */

//#region index picking
/** Picks a representative subset of indices out of a length-N sequence.
 *  @param {number} n
 *  @param {"ends"|"middle"} [mode] "ends" (default) = 1st, 2nd, last — proves a rule
 *    established on item 1 is still being followed on item 2, then still holds at the
 *    end (clump/bucket rows: consecutive windows following one procedure). "middle" =
 *    1st, middle, last — proves indexing across the full span is correct (size/point
 *    columns, where a middle entry matters more than the second one).
 *  @returns {Array<{index:number,label:string}>} ascending index order, deduped (small
 *    n collapses naturally — e.g. n=2 "ends" yields just 1st/last, n=1 yields just 1st) */
export function sampleIndices(n, mode) {
  if (!n || n <= 0) return [];
  const picks = mode === "middle"
    ? [{ index: 0, label: "1st" }, { index: Math.floor((n - 1) / 2), label: "middle" }, { index: n - 1, label: "last" }]
    : [{ index: 0, label: "1st" }, { index: 1, label: "2nd" }, { index: n - 1, label: "last" }];
  const seen = new Set();
  return picks
    .filter((p) => p.index >= 0 && p.index < n && !seen.has(p.index) && seen.add(p.index))
    .sort((a, b) => a.index - b.index);
}
//#endregion

//#region table sampling
/** Row-only sampling: builds an audit-step {columns,rows} table (see auditView.js's
 *  step.table shape) showing only a representative sample of a larger row set, with a
 *  disclosure note. Prepends a "#" column carrying each shown row's sample label so a
 *  reader can see WHERE in the full sequence it sits. For flat tables with no per-size
 *  column spread — e.g. ISO 3968's per-point table. For the clumps/buckets shape (fixed
 *  columns + one column per size), use sampleWideTable instead.
 *  @param {Array<*>} columns
 *  @param {Array<Array<*>>} allRows one already-formatted row per source item
 *  @param {"ends"|"middle"} [mode]
 *  @returns {{columns:Array<*>, rows:Array<Array<*>>, note:string}} */
export function sampleTable(columns, allRows, mode) {
  const n = allRows.length;
  const picks = sampleIndices(n, mode);
  const note = picks.length < n
    ? "Showing " + picks.length + " of " + n + " rows as a representative sample (full data in the raw JSON dump below)."
    : "Showing all " + n + " row" + (n === 1 ? "" : "s") + ".";
  return { columns: ["#"].concat(columns), rows: picks.map((p) => [p.label].concat(allRows[p.index])), note };
}

/** Two-dimensional sampling for the "wide" per-size tables — fixed leading columns per
 *  row, plus ONE column per size (the clumps/buckets tables' own shape). Samples WHICH
 *  rows (default "ends": 1st/2nd/last, proving a rule holds across consecutive windows)
 *  and WHICH size-columns (always "middle": 1st/middle/last size, proving indexing is
 *  correct across the full measured range) to show, instead of a wall of every size for
 *  every window.
 *  @param {Array<*>} fixedColumns leading column headers, same for every row
 *  @param {Array<string>} sizeLabels full size list's already-formatted labels (e.g.
 *    "4.5µm"), in the same order each row's `bySize` array is in
 *  @param {Array<{fixed:Array<*>, bySize:Array<*>}>} allRows one entry per source row
 *  @param {{rowMode?:"ends"|"middle", columnUnit?:string, cellTitle?:(rowIndex:number,colIndex:number,row:*)=>(string|null)}} [opts]
 *    cellTitle, if given, is called for every shown bySize CELL (never a fixed-column
 *    cell) with the ORIGINAL (pre-sampling) row/size indices — lets a caller attach a
 *    hover tooltip (e.g. the raw per-cycle counts a beta cell was summed from) without
 *    this generic helper needing any opinion on what that detail means. Has no opinion
 *    on rendering either — auditView.js's buildTable turns the returned strings into
 *    actual `title` attributes. columnUnit names what the column dimension actually
 *    is for the disclosure note's own wording — defaults to "sizes" (every existing
 *    caller genuinely is per-size); explorerAuditSteps.js's analog-tag table passes
 *    "channels", since a tag isn't a size and saying so would be actively misleading.
 *  @returns {{columns:Array<*>, rows:Array<Array<*>>, note:string, cellTitles?:Array<Array<string|null>>}} */
export function sampleWideTable(fixedColumns, sizeLabels, allRows, opts) {
  const rowMode = (opts && opts.rowMode) || "ends";
  const columnUnit = (opts && opts.columnUnit) || "sizes";
  const cellTitle = opts && opts.cellTitle;
  const rowPicks = sampleIndices(allRows.length, rowMode);
  const colPicks = sampleIndices(sizeLabels.length, "middle");
  const columns = ["#"].concat(fixedColumns, colPicks.map((c) => sizeLabels[c.index] + " (" + c.label + ")"));
  const rows = [];
  const cellTitles = cellTitle ? [] : undefined;
  for (const rp of rowPicks) {
    const row = allRows[rp.index];
    rows.push([rp.label].concat(row.fixed, colPicks.map((cp) => row.bySize[cp.index])));
    if (cellTitle) {
      cellTitles.push([null].concat(row.fixed.map(() => null), colPicks.map((cp) => cellTitle(rp.index, cp.index, row))));
    }
  }
  const note = "Showing " + rowPicks.length + " of " + allRows.length + " rows × " + colPicks.length + " of " +
    sizeLabels.length + " " + columnUnit + " as a representative sample (full data in the raw JSON dump below).";
  return cellTitles ? { columns, rows, note, cellTitles } : { columns, rows, note };
}
//#endregion

/* =====================================================================================
   auditWidgets.js
   =====================================================================================
   Generic INTERACTIVE presentation machinery for the Audit Trail's *AuditSteps.js
   files — DOM-building, unlike auditSampling.js's pure data-in/data-out sampling
   helpers (which stay Node-runnable on purpose, for their own selfcheck). Has no
   opinion on what a row/size means or which standard it's from, so per CLAUDE.md's
   helpers-may-be-shared rule this is shared across every standard's own
   AuditSteps.js, the same as auditSampling.js.

   Does NOT import from auditView.js — a standard's AuditSteps.js calls this file
   directly and hands the resulting live element back as a step's `customBody`
   (see auditView.js's own buildStepEl); auditView.js imports buildAuditSteps FROM
   each AuditSteps.js, so the reverse import would be circular.
   ===================================================================================== */

//#region size-picker table
/** Builds a live widget: a <select> picking ONE size, and a table showing EVERY row
 *  (not sampled — unlike sampleWideTable, the whole point here is a reader can see
 *  all of them) with that size's own value as the last column, re-rendering on
 *  selection change. Optional per-cell hover tooltip (native `title`, screen-only —
 *  see app.css's `.has-tooltip`), recomputed for whichever size is currently shown.
 *  @param {Object} opts
 *  @param {Array<string>} opts.fixedColumns leading column headers, same for every row
 *  @param {Array<string>} opts.sizeLabels full size list's already-formatted labels
 *  @param {string} opts.valueColumnSuffix appended to the currently-selected size's
 *    label to form the last column's header, e.g. "4µm" + " β" -> "4µm β"
 *  @param {Array<{fixed:Array<*>, bySize:Array<*>}>} opts.rows one entry per row, in
 *    the SAME order sizeLabels' index into `bySize`
 *  @param {number} [opts.defaultSizeIndex] which size the picker starts on (default 0)
 *  @param {(rowIndex:number, sizeIndex:number, row:*) => (string|null)} [opts.cellTitle]
 *    hover tooltip text for the value cell, given the REAL row/size indices
 *  @returns {HTMLElement} */
export function buildSizePickerTable(opts) {
  const { fixedColumns, sizeLabels, valueColumnSuffix, rows, cellTitle } = opts;
  let selectedIndex = opts.defaultSizeIndex || 0;

  const select = el("select", { class: "audit-size-picker" },
    ...sizeLabels.map((label, i) => el("option", { value: String(i) }, label)));
  select.value = String(selectedIndex);

  const tableHost = el("div");

  function render() {
    tableHost.innerHTML = "";
    const columns = fixedColumns.concat([sizeLabels[selectedIndex] + " " + valueColumnSuffix]);
    tableHost.appendChild(el("div", { class: "audit-table-wrap" },
      el("table", { class: "audit-table datatbl" },
        el("thead", {}, el("tr", {}, ...columns.map((c) => el("th", {}, String(c))))),
        el("tbody", {}, ...rows.map((row, rowIndex) => {
          const title = cellTitle ? cellTitle(rowIndex, selectedIndex, row) : null;
          return el("tr", {},
            ...row.fixed.map((cell) => el("td", {}, fmtCell(cell))),
            el("td", title ? { class: "has-tooltip", title } : {}, fmtCell(row.bySize[selectedIndex])));
        }))
      )));
  }
  render();

  select.addEventListener("change", () => { selectedIndex = Number(select.value); render(); });

  return el("div", { class: "audit-size-picker-wrap" },
    el("label", { class: "audit-size-picker-label" }, "Size: ", select),
    tableHost);
}
//#endregion

//#region formatting (own copy of auditView.js's fmt() number-rounding — see that
// file's own note on why this isn't imported: no circular import)
function fmtCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!isFinite(value)) return String(value);
    const rounded = Math.abs(value) >= 100 ? Math.round(value * 10) / 10
      : Math.abs(value) >= 1 ? Math.round(value * 1000) / 1000
      : Math.round(value * 100000) / 100000;
    return String(rounded);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
//#endregion

//#region dom helper (own copy of auditView.js's own el() — see fmtCell's note above)
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
//#endregion

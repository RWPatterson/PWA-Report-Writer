/* =====================================================================================
   warningsDialogView.js
   =====================================================================================
   Full-detail replacement for what used to be a console.warn-only surface: analysis
   errors, analysis warnings, and control-target-out-of-tolerance failures were
   previously only visible in the browser console (plus a truncated, first-error-only
   status-bar line — see app.js's old runAnalysisPipeline). This dialog is the complete
   list, all three groups, every entry — nothing dropped or truncated. Standard-agnostic:
   takes plain strings/ControlTargetResult objects the caller (app.js) already has,
   no idea which standard is loaded.

   Reuses the .modal-overlay/.modal-box/.modal-actions components (see
   gravimetricEntryView.js) and the .warnings/⚠ box convention already established by
   explorerView.js for df.warnings — same visual language, not a new one.
   ===================================================================================== */

//#region dialog
/**
 * @param {{
 *   standardLabel: string,
 *   fileName: string,
 *   errors: string[],
 *   warnings: string[],
 *   controlFailures: import("../core/controlTargetCheck.js").ControlTargetResult[]
 * }} params
 */
export function openWarningsDialog({ standardLabel, fileName, errors, warnings, controlFailures }) {
  const sections = [];
  if (errors.length) sections.push(buildSection("Errors", errors.map(e => "⚠ " + e)));
  if (warnings.length) sections.push(buildSection("Warnings", warnings.map(w => "⚠ " + w)));
  if (controlFailures.length) {
    sections.push(buildSection("Control target failures",
      controlFailures.map(f => "⚠ " + f.parameter + ": " + f.message)));
  }

  if (!sections.length) return;

  const dialog = el("div", { class: "modal-box warnings-dialog" },
    el("h3", {}, "Report Warnings — " + fileName),
    el("p", { class: "hint" }, standardLabel + " analysis flagged the following. Fields with a matching " +
      "⚠ marker on the report page point back to a specific control-target failure here."),
    ...sections,
    el("div", { class: "modal-actions" },
      el("button", { class: "act primary", onclick: close }, "Close"))
  );

  const overlay = el("div", { class: "modal-overlay" }, dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
//#endregion

//#region helpers
/** @param {string} title @param {string[]} lines @returns {HTMLElement} */
function buildSection(title, lines) {
  const box = el("div", { class: "warnings" });
  lines.forEach(line => box.appendChild(el("div", {}, line)));
  return el("div", { class: "warnings-section" },
    el("label", { class: "field-label" }, title),
    box
  );
}

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}
//#endregion

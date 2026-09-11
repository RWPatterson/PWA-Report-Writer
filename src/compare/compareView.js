/* =====================================================================================
   compareView.js
   =====================================================================================
   Renders the Compare Files view: a shelf of loaded files (independent of whatever's
   open in the Explorer/Report views), then — once at least one file is loaded —
   hands off to the comparison report builder (compareTemplateView.js), which owns
   the "what's shared across these files" dimension summary too (its channels row
   doubles as the toggle control once a template exists — see that file's own note
   on why that's rendered there, not here), the toggle palette, and a paginated,
   printable preview of the active custom template.

   Deliberately NOT a report page and NOT a custom tab: custom tabs are "one
   definition, redrawn against whichever single file is currently loaded"; this is
   "these specific N files, together, regardless of anything else loaded." Different
   enough that folding one into the other would blur both.
   ===================================================================================== */
import { commonDimensions } from "./compareFiles.js";
import { renderCompareReport } from "./compareTemplateView.js";
import { destroyChartsIn } from "../core/charts/chartView.js";

/**
 * @param {HTMLElement} container
 * @param {import("./compareFiles.js").CompareFileSet} fileSet
 * @param {import("./compareTemplates.js").CompareTemplateRegistry} templateRegistry
 * @param {string|null} activeTemplateId
 * @param {Object} callbacks onAddFiles/onRemoveFile (file shelf) plus every
 *   compareTemplateView.js callback (template manager/toggle palette) — see that
 *   file's own header comment for the full list. Print-time chart sizing is NOT
 *   threaded through here — see compareTemplateView.js's redrawComparePlots, called
 *   directly by app.js's print hooks against whatever this function last rendered.
 */
export function renderCompareView(container, fileSet, templateRegistry, activeTemplateId, callbacks) {
  const { onAddFiles, onRemoveFile } = callbacks;

  destroyChartsIn(container);   // clean up any chart from the previous render before wiping
  container.innerHTML = "";

  container.appendChild(buildShelf(fileSet, onAddFiles, onRemoveFile));

  if (fileSet.list().length === 0) {
    container.appendChild(el("div", { class: "hint-box" },
      "Add two or more files to compare them. Files loaded here are independent of the ",
      "Data File Explorer and Report views — nothing here affects, or is affected by, ",
      "what's open there."));
    return;
  }

  const dims = commonDimensions(fileSet);

  // A dedicated mount point, not `container` itself — renderCompareReport owns and
  // fully clears whatever container IT is handed (same "destroy charts, then wipe"
  // convention this file's own top-level render uses), which would otherwise wipe
  // out the shelf/dimension-summary this function just appended above it.
  const reportMount = el("div", {});
  container.appendChild(reportMount);
  renderCompareReport(reportMount, fileSet.list(), dims, templateRegistry, activeTemplateId, callbacks);
}

/* ---- File shelf ---- */
function buildShelf(fileSet, onAddFiles, onRemoveFile) {
  const chips = fileSet.list().map(entry =>
    el("span", { class: "chip" }, entry.label,
      el("button", { class: "chip-remove", title: "Remove from comparison", onclick: () => onRemoveFile(entry.id) }, "×")));

  const fileInput = el("input", {
    type: "file", accept: ".dat,.DAT,.sav,.SAV,.txt,.csv", multiple: "multiple", style: "display:none",
    onchange: (e) => { if (e.target.files.length) onAddFiles(e.target.files); e.target.value = ""; }
  });
  const addBtn = el("button", { class: "act primary", onclick: () => fileInput.click() }, "+ Add file(s) to compare");

  return el("div", { class: "compare-shelf" }, ...chips, addBtn, fileInput);
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

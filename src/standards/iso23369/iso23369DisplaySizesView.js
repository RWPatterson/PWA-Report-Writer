/* =====================================================================================
   iso23369DisplaySizesView.js
   =====================================================================================
   Own copy of iso16889DisplaySizesView.js's shape, per CLAUDE.md — same two jobs:

     loadPersistedDisplaySizes / savePersistedDisplaySizes — persist a user's "always
       show these sizes" preference, scoped PER SENSOR, using the same reserved-key-
       inside-customDefaults mechanism every clean standard's DisplaySizesView uses.

     openDisplaySizesDialog — the modal for picking up to 16 of the CURRENTLY loaded
       file's measured sizes (for whichever sensor is selected), pre-checked from
       whatever's currently resolved.

   16 sizes matches Page 2's own table width — this standard's own outline states
   Page 2 "directly mirrors ISO 16889's page 2" layout, same 16-size-column shape.
   Confirmed real: sensor generality (LB+LS) is exercised by a real cyclic fixture
   (SpinOnCyclicMP.DAT has genuine LSSizes data), so this dialog is needed, not just
   defensively built.
   ===================================================================================== */
import { loadCustomDefaults, saveCustomDefaults } from "../../report/customDefaults.js";

//#region persistence
/** @param {string} sensor @returns {string} reserved key inside the per-standard customDefaults blob — not a report field id */
function displaySizesKey(sensor) {
  return "__iso23369DisplaySizes__" + sensor;
}

/** @param {string} standardId @param {string} sensor @returns {number[]|null} the saved list for this sensor, or null if none/invalid */
export function loadPersistedDisplaySizes(standardId, sensor) {
  const raw = loadCustomDefaults(standardId)[displaySizesKey(sensor)];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const sizes = parsed.map(Number).filter((n) => isFinite(n));
    return sizes.length > 0 ? sizes : null;
  } catch (err) {
    return null;
  }
}

/** @param {string} standardId @param {string} sensor @param {number[]} sizes */
export function savePersistedDisplaySizes(standardId, sensor, sizes) {
  const persisted = loadCustomDefaults(standardId);
  persisted[displaySizesKey(sensor)] = JSON.stringify(sizes);
  saveCustomDefaults(standardId, persisted);
}
//#endregion

//#region dialog
const MAX_SIZES = 16;

/* openDisplaySizesDialog: builds a modal, appends it to <body>, and calls
   onSave(sizesArray) if the person completes it. Removes itself either way.
   Reuses the .modal-overlay/.modal-box/.chk-list/.chk-row components the custom-tab
   creation dialog already established, for visual consistency. */
/** @param {{availableSizes:Array<string|number>, currentSizes:number[], onSave:(sizes:number[])=>void}} params */
export function openDisplaySizesDialog({ availableSizes, currentSizes, onSave }) {
  if (!availableSizes || availableSizes.length === 0) {
    alert("Load a data file first — there's nothing to choose sizes from yet.");
    return;
  }

  const currentSet = new Set((currentSizes || []).map(Number));
  const sortedSizes = [...availableSizes].map(Number).filter((n) => isFinite(n)).sort((a, b) => a - b);

  const checkboxes = sortedSizes.map((size) => {
    const input = el("input", { type: "checkbox", value: String(size) });
    if (currentSet.has(size)) input.checked = true;
    return { size, input, row: el("label", { class: "chk-row" }, input, " >" + size + " µmC") };
  });
  const sizeList = el("div", { class: "chk-list" }, ...checkboxes.map((c) => c.row));

  const countLine = el("div", { class: "hint" }, "");
  function refreshCount() {
    const checkedCount = checkboxes.filter((c) => c.input.checked).length;
    countLine.textContent = checkedCount + " of " + MAX_SIZES + " selected";
    const atCap = checkedCount >= MAX_SIZES;
    for (const c of checkboxes) {
      if (!c.input.checked) c.input.disabled = atCap;
    }
  }
  checkboxes.forEach((c) => c.input.addEventListener("change", refreshCount));
  refreshCount();

  const errorLine = el("div", { class: "warnings", style: "display:none" });

  const dialog = el("div", { class: "modal-box" },
    el("h3", {}, "Select display sizes"),
    el("p", { class: "hint" }, "Up to " + MAX_SIZES + " sizes fill Page 1's filtration ratio table and Page 2's particle-count table. This choice is saved as a default for future " +
      "ISO 23369 reports using THIS sensor only — LB and LS keep separate saved lists. A size not measured by some later file falls back to that file's own configured sizes for just that slot."),
    sizeList,
    countLine,
    errorLine,
    el("div", { class: "modal-actions" },
      el("button", { class: "act", onclick: close }, "Cancel"),
      el("button", { class: "act primary", onclick: save }, "Save"))
  );

  const overlay = el("div", { class: "modal-overlay" }, dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  function save() {
    const picked = checkboxes.filter((c) => c.input.checked).map((c) => c.size);
    if (picked.length === 0) {
      errorLine.textContent = "⚠ Pick at least one size.";
      errorLine.style.display = "";
      return;
    }
    onSave(picked);
    close();
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
//#endregion

//#region DOM helper
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

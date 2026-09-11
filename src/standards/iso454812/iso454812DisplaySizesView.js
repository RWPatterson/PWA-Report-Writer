/* =====================================================================================
   iso454812DisplaySizesView.js
   =====================================================================================
   Two jobs, same split as customTabsView.js's buildCustomTabDefs/openCreateTabDialog:

     loadPersistedDisplaySizes / savePersistedDisplaySizes — persist a user's "always
       show these sizes" preference using the SAME per-standard localStorage blob
       customDefaults.js already provides for scalar report fields, just under a
       reserved key that no report template's data-slot will ever collide with. The
       value is a JSON-encoded array (customDefaults' storage is otherwise scalar
       strings/numbers, so this key deliberately looks different from a normal field).

       Scoped PER SENSOR (key includes the sensor id) — LB and LS are different
       hardware with different measured size ranges, so a size preference formed
       while looking at one sensor's data doesn't transfer to the other's. Before
       this was sensor-scoped, switching sensors reused the same saved list and
       iso454812Mapper.js's resolveFixedSizes would keep whichever entries happened
       to numerically overlap the new sensor's range — a confusing partial carryover
       a person never asked for, not a real preference for that sensor.

     openDisplaySizesDialog — the modal for picking up to 16 of the CURRENTLY loaded
       file's measured sizes (for whichever sensor is selected), pre-checked from
       whatever's currently resolved (iso454812Mapper.js's resolveFixedSizes). Built
       dynamically, not a static template, because which sizes are even choosable
       depends on the loaded file and sensor.
   ===================================================================================== */
import { loadCustomDefaults, saveCustomDefaults } from "../../report/customDefaults.js";

//#region persistence
/** @param {string} sensor @returns {string} reserved key inside the per-standard customDefaults blob — not a report field id */
function displaySizesKey(sensor) {
  return "__iso454812DisplaySizes__" + sensor;
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
    // Cap enforcement: once MAX_SIZES are checked, disable the rest so a person can't
    // check a 17th — clearer in the moment than accepting the click and rejecting it
    // on Save.
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
    el("p", { class: "hint" }, "Up to " + MAX_SIZES + " sizes fill Page 1's efficiency table and Table B.2. This choice is saved as a default for future " +
      "ISO 4548-12 reports using THIS sensor only — LB and LS keep separate saved lists. A size not measured by some later file falls back to that file's own configured sizes for just that slot."),
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

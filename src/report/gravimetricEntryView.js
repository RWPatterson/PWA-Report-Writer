/* =====================================================================================
   gravimetricEntryView.js
   =====================================================================================
   A shared, standard-agnostic dialog for entering post-test gravimetric results — a
   lab weighs samples/pads/cups AFTER the test finishes, so these numbers can never
   come from the .DAT file itself. Modeled on the old Excel/VBA report writer's frmGrav
   dialog: each quantity supports three input paths, live-recomputed on every
   keystroke same as that form's own _Change handlers —

     - a direct mg/L value (the default), or
     - a value calculated from Volume + Dirt Weight, where EACH of those can itself be
       entered directly, or derived from raw weighings (Full Cup - Empty Cup, divided
       by a shared Specific Gravity, for Volume; Dirty Pad - Clean Pad for Dirt
       Weight). Calculated Grav Level = DirtWeight(g) x 1,000,000 / Volume(mL).

   Generic: takes a `specs` array the CALLER defines — this file has no idea what
   "Initial Injection Gravimetric" means, or how many quantities there are, only how
   to collect one mg/L number per spec. The FORMULA that turns these numbers into
   report fields (e.g. ISO 4548-12's Non-Retained Mass / Retained Capacity) is each
   standard's own concern, computed by the caller's onSave — never here (see
   CLAUDE.md: analysis procedures are never shared between standards, even when they
   look identical; only this UI shell is shared). ===================================== */

//#region dialog
/** @typedef {{id:string, label:string}} GravSpec */

/* openGravimetricDialog: builds a modal, appends it to <body>, and calls
   onSave(results) if the person completes it. Removes itself either way. Reuses the
   .modal-overlay/.modal-box/.modal-actions/.mode-row components the other dialogs in
   this project already established, for visual consistency. */
/** @param {{specs:GravSpec[], currentValues?:Record<string,number|null>, onSave:(results:Record<string,number|null>)=>void}} params */
export function openGravimetricDialog({ specs, currentValues, onSave }) {
  if (!specs || specs.length === 0) return;

  const specificGravityInput = el("input", { type: "number", step: "any", placeholder: "e.g. 0.87" });

  const sections = specs.map((spec) =>
    buildSection(spec, (currentValues && currentValues[spec.id] !== undefined) ? currentValues[spec.id] : null, () => toNumber(specificGravityInput.value)));

  // Typing Specific Gravity affects every section using the cup-weighing path, not
  // just whichever section's own inputs changed — refresh all of them.
  specificGravityInput.addEventListener("input", () => sections.forEach((s) => s.refreshPreview()));

  const dialog = el("div", { class: "modal-box grav-dialog" },
    el("h3", {}, "Gravimetric Results"),
    el("p", { class: "hint" }, "Enter a direct mg/L value, or switch a section to “Calculate from measurements” to derive it " +
      "from Volume and Dirt Weight — each of those can also be derived from raw cup/pad weighings."),
    el("label", { class: "field-label" }, "Specific Gravity (only needed for the cup-weighing path)"),
    specificGravityInput,
    ...sections.map((s) => s.element),
    el("div", { class: "modal-actions" },
      el("button", { class: "act", onclick: close }, "Cancel"),
      el("button", { class: "act primary", onclick: save }, "Save"))
  );

  const overlay = el("div", { class: "modal-overlay" }, dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }

  function save() {
    const results = {};
    for (const s of sections) results[s.id] = s.resolve();
    onSave(results);
    close();
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
//#endregion

//#region section builder
/** One gravimetric quantity's input section — direct value, or calculate from Volume +
 *  Dirt Weight (each itself direct or derived from raw weighings). Exposes its own
 *  refreshPreview so the shared Specific Gravity field can refresh every section, not
 *  just whichever one's own inputs changed.
 *  @param {GravSpec} spec @param {number|null} currentValue @param {() => number|null} getSpecificGravity
 *  @returns {{id:string, element:HTMLElement, resolve:() => number|null, refreshPreview:() => void}} */
function buildSection(spec, currentValue, getSpecificGravity) {
  const modeDirect = el("input", { type: "radio", name: "mode-" + spec.id, value: "direct", checked: "checked" });
  const modeCalc = el("input", { type: "radio", name: "mode-" + spec.id, value: "calc" });

  const directInput = el("input", { type: "number", step: "any", placeholder: "mg/L" });
  if (currentValue !== null) directInput.value = String(currentValue);

  // ---- Volume: direct mL entry, or (Full Cup - Empty Cup) / Specific Gravity ----
  const volModeDirect = el("input", { type: "radio", name: "volmode-" + spec.id, value: "direct", checked: "checked" });
  const volModeCup = el("input", { type: "radio", name: "volmode-" + spec.id, value: "cup" });
  const volumeInput = el("input", { type: "number", step: "any", placeholder: "Volume (mL)" });
  const fullCupInput = el("input", { type: "number", step: "any", placeholder: "Full cup weight (g)" });
  const emptyCupInput = el("input", { type: "number", step: "any", placeholder: "Empty cup weight (g)" });
  const cupRow = el("div", { class: "grav-subrow", style: "display:none" }, fullCupInput, emptyCupInput);

  function resolveVolume() {
    if (volModeCup.checked) {
      const full = toNumber(fullCupInput.value), empty = toNumber(emptyCupInput.value), sg = getSpecificGravity();
      if (full === null || empty === null || !sg) return null;
      return (full - empty) / sg;
    }
    return toNumber(volumeInput.value);
  }
  function syncVolMode() {
    volumeInput.style.display = volModeCup.checked ? "none" : "";
    volumeInput.disabled = volModeCup.checked;
    cupRow.style.display = volModeCup.checked ? "" : "none";
    refreshPreview();
  }
  [fullCupInput, emptyCupInput, volumeInput].forEach((inp) => inp.addEventListener("input", refreshPreview));
  [volModeDirect, volModeCup].forEach((r) => r.addEventListener("change", syncVolMode));

  // ---- Dirt Weight: direct g entry, or Dirty Pad - Clean Pad ----
  const dwModeDirect = el("input", { type: "radio", name: "dwmode-" + spec.id, value: "direct", checked: "checked" });
  const dwModePad = el("input", { type: "radio", name: "dwmode-" + spec.id, value: "pad" });
  const dirtWeightInput = el("input", { type: "number", step: "any", placeholder: "Dirt weight (g)" });
  const dirtyPadInput = el("input", { type: "number", step: "any", placeholder: "Dirty pad weight (g)" });
  const cleanPadInput = el("input", { type: "number", step: "any", placeholder: "Clean pad weight (g)" });
  const padRow = el("div", { class: "grav-subrow", style: "display:none" }, dirtyPadInput, cleanPadInput);

  function resolveDirtWeight() {
    if (dwModePad.checked) {
      const dirty = toNumber(dirtyPadInput.value), clean = toNumber(cleanPadInput.value);
      if (dirty === null || clean === null) return null;
      return dirty - clean;
    }
    return toNumber(dirtWeightInput.value);
  }
  function syncDwMode() {
    dirtWeightInput.style.display = dwModePad.checked ? "none" : "";
    dirtWeightInput.disabled = dwModePad.checked;
    padRow.style.display = dwModePad.checked ? "" : "none";
    refreshPreview();
  }
  [dirtyPadInput, cleanPadInput, dirtWeightInput].forEach((inp) => inp.addEventListener("input", refreshPreview));
  [dwModeDirect, dwModePad].forEach((r) => r.addEventListener("change", syncDwMode));

  // ---- Calculated Grav Level preview ----
  const previewValue = el("span", {}, "—");
  function refreshPreview() {
    const grav = resolveCalculated();
    previewValue.textContent = grav === null ? "—" : grav.toFixed(2);
  }
  function resolveCalculated() {
    const volume = resolveVolume(), dirtWeight = resolveDirtWeight();
    return (volume && dirtWeight !== null) ? (dirtWeight * 1000000) / volume : null;
  }

  const calcBlock = el("div", { class: "grav-calc", style: "display:none" },
    el("label", { class: "field-label" }, "Volume"),
    el("div", { class: "mode-row" },
      el("label", {}, volModeDirect, " Enter directly"),
      el("label", {}, volModeCup, " From cup weights")),
    volumeInput, cupRow,
    el("label", { class: "field-label" }, "Dirt Weight"),
    el("div", { class: "mode-row" },
      el("label", {}, dwModeDirect, " Enter directly"),
      el("label", {}, dwModePad, " From pad weights")),
    dirtWeightInput, padRow,
    el("div", { class: "grav-preview" }, "Calculated: ", previewValue, " mg/L")
  );

  function syncOuterMode() {
    directInput.style.display = modeCalc.checked ? "none" : "";
    calcBlock.style.display = modeCalc.checked ? "" : "none";
  }
  [modeDirect, modeCalc].forEach((r) => r.addEventListener("change", syncOuterMode));

  const element = el("div", { class: "grav-section" },
    el("label", { class: "field-label" }, spec.label),
    el("div", { class: "mode-row" },
      el("label", {}, modeDirect, " Direct value"),
      el("label", {}, modeCalc, " Calculate from measurements")),
    directInput,
    calcBlock
  );

  function resolve() {
    return modeCalc.checked ? resolveCalculated() : toNumber(directInput.value);
  }

  return { id: spec.id, element, resolve, refreshPreview };
}
//#endregion

//#region helpers
/** @param {*} value @returns {number|null} */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
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

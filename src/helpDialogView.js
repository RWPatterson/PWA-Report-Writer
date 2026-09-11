/* =====================================================================================
   helpDialogView.js
   =====================================================================================
   In-app "how this app works" guide — static, app-wide content, not owned by any one
   product (Explorer/Report/Compare/Machine Profiles), so this lives at src/ top level
   rather than being forced into one of those folders. Reuses the .modal-overlay/
   .modal-box components and the local-el()-helper/close-on-overlay-click pattern every
   other dialog in this project already established (see report/warningsDialogView.js,
   the closest precedent) — no new interaction pattern.

   Content is static (no arguments) — added 2026-08-21 per the user, reached via a
   sidebar "? Help" button rather than a dedicated tab, so opening it never disrupts
   whichever view is currently active.
   ===================================================================================== */

//#region dialog
export function openHelpDialog() {
  const dialog = el("div", { class: "modal-box help-dialog" },
    el("h3", {}, "How this app works"),
    el("p", { class: "hint" },
      "This tool turns filtration-test .DAT files into printable ISO test reports, " +
      "plus a raw data explorer and a cross-file comparer."),

    el("h4", { class: "mp-subhead" }, "1. Load a file"),
    el("p", {}, "The \"Load data file\" button (top left) accepts the rig's .DAT file. " +
      "A cyclic-flow (ISO 23369) test also needs its matching \"-Cyclic.DAT\" companion " +
      "file — you'll be prompted for it automatically once a cyclic file loads."),

    el("h4", { class: "mp-subhead" }, "2. Data File Explorer"),
    el("p", {}, "Inspect the raw contents of whatever's loaded: header info, analog " +
      "channels, particle counts. Build your own plot tabs (\"+ Add Plot Tab\") to " +
      "overlay any channels you want to look at, independent of any standard."),

    el("h4", { class: "mp-subhead" }, "3. Standard Report"),
    el("p", {}, "Pick a standard from the sidebar; the report fills in automatically " +
      "from the loaded file. Fields highlighted on double-click are physical specs the " +
      ".DAT file can't supply (Element ID, Housing ID, etc.) — enter them by hand; " +
      "they're remembered as defaults for next time. Switch standards at any point, " +
      "even with a file loaded, to see how the same data reports under a different one."),

    el("h4", { class: "mp-subhead" }, "4. Compare Files"),
    el("p", {}, "A second, independent set of loaded files, for looking at several " +
      "tests side by side. Nothing here affects, or is affected by, what's open in " +
      "Explorer or Report."),

    el("h4", { class: "mp-subhead" }, "5. Machine Profiles"),
    el("p", {}, "Save per-rig defaults (counter/sensor identity, calibration info, " +
      "test location), keyed by the .DAT file's own Serial Number. Once saved, a file " +
      "from that rig fills these in automatically. Save/load the whole directory as " +
      "one file to share the same settings across multiple terminals."),

    el("h4", { class: "mp-subhead" }, "Other things worth knowing"),
    el("p", {}, "Save/Load session (.json) to pick a report back up later; the SI/US " +
      "unit toggle and paper size (sidebar, bottom) apply everywhere; Print report " +
      "uses whichever paper size is selected."),

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

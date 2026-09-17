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
    el("p", {}, "The \"Load File\" button (File, top left) accepts the rig's .DAT file, " +
      "or a previously saved report (.json) — it figures out which from the file " +
      "itself, so there's one button for both. A cyclic-flow (ISO 23369) test also " +
      "needs its matching \"-Cyclic.DAT\" companion file — you'll be prompted for it " +
      "automatically once a cyclic file loads."),

    el("h4", { class: "mp-subhead" }, "2. Data File Explorer"),
    el("p", {}, "Inspect the raw contents of whatever's loaded: header info, analog " +
      "channels, particle counts. Build your own plot tabs (\"+ Add Plot Tab\") to " +
      "overlay any channels you want to look at, independent of any standard. " +
      "Save/Load chart tabs (Actions) to reuse the same set later, or on a different file."),

    el("h4", { class: "mp-subhead" }, "3. Standard Report"),
    el("p", {}, "Pick a standard from the Mode section; the report fills in automatically " +
      "from the loaded file. Once a file's loaded, \"Report Options\" (under Standard " +
      "Report) holds sensor/size/gravimetric and similar per-standard choices. Fields " +
      "with a pencil (✎) are physical specs the .DAT file can't supply (Element ID, " +
      "Housing ID, etc.) — click the pencil to enter them by hand; they're remembered " +
      "as defaults for next time. Switch standards at any point, even with a file " +
      "loaded, to see how the same data reports under a different one."),

    el("h4", { class: "mp-subhead" }, "4. Compare Files"),
    el("p", {}, "A second, independent set of loaded files, for looking at several " +
      "tests side by side. Nothing here affects, or is affected by, what's open in " +
      "Explorer or Report. Still evolving (BETA) as real usage shapes what it needs."),

    el("h4", { class: "mp-subhead" }, "5. Machine Profiles"),
    el("p", {}, "Under Configuration. Save per-rig defaults (counter/sensor identity, " +
      "calibration info, test location), keyed by the .DAT file's own Serial Number. " +
      "Once saved, a file from that rig fills these in automatically. Save/load the " +
      "whole directory as one file to share the same settings across multiple terminals."),

    el("h4", { class: "mp-subhead" }, "Other things worth knowing"),
    el("p", {}, "Save Report to pick things back up later (Actions, while viewing a " +
      "Standard Report) — Load File (File, top left) reads it back the same way it " +
      "reads a .DAT file. Units, Paper size, and Report Logo (Configuration) apply " +
      "everywhere; Print Report uses whichever paper size is selected."),

    el("div", { class: "modal-actions" },
      el("button", { class: "act primary", onclick: close }, "Close"))
  );

  const overlay = el("div", { class: "modal-overlay" }, dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
//#endregion

//#region version info dialog
/* openVersionInfoDialog: this project has no formal semver (see CHANGELOG.md's own
   note) — service-worker.js's CACHE_NAME is the one real version marker, bumped
   whenever a precached file changes. Rather than duplicating that string as a
   second constant here (guaranteed to drift the moment someone bumps one and
   forgets the other), this reads it live from the Cache Storage entry the service
   worker itself created on activation (caches.open(CACHE_NAME) in
   service-worker.js) — single source of truth, always reflects whatever's ACTUALLY
   active, not a guess. Populated async: the dialog opens immediately with a
   "Checking..." placeholder, filled in once caches.keys() resolves. No cache
   found (service worker never registered — not served over http/https, or
   registration failed) reports that plainly rather than showing nothing. */
export function openVersionInfoDialog() {
  const versionRow = el("p", {}, el("b", {}, "Cache version: "), "Checking…");

  const dialog = el("div", { class: "modal-box help-dialog" },
    el("h3", {}, "Version Info"),
    el("p", {}, el("b", {}, "Application: "), "WebReportWriter"),
    versionRow,
    el("div", { class: "modal-actions" },
      el("button", { class: "act primary", onclick: close }, "Close"))
  );

  const overlay = el("div", { class: "modal-overlay" }, dialog);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  if ("caches" in window) {
    caches.keys()
      .then(names => names.find(n => n.startsWith("webreportwriter-")))
      .then(name => {
        versionRow.textContent = "";
        versionRow.append(el("b", {}, "Cache version: "), name || "Not available (offline caching isn't active this session)");
      })
      .catch(() => {
        versionRow.textContent = "";
        versionRow.append(el("b", {}, "Cache version: "), "Not available");
      });
  } else {
    versionRow.textContent = "";
    versionRow.append(el("b", {}, "Cache version: "), "Not available");
  }
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

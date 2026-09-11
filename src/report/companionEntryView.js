/* =====================================================================================
   companionEntryView.js
   =====================================================================================
   ISO 23369's "-Cyclic.DAT" companion-file picker — own copy of tareEntryView.js's
   shape, per CLAUDE.md (not a shared component: that file's own copy text is
   hardcoded to the tare-file question, so this needed its own file rather than a
   parameter added to it). Standard-agnostic shell otherwise — this file has no idea
   what the companion file MEANS to the analysis, only how to ask for it and hand
   back the chosen File. Reuses the same .modal-overlay/.modal-box/.modal-actions
   components every other dialog in this project already established.

   Unlike the tare prompt (a "would you like to" yes/no ask), this one is framed as
   a straight request — the companion file is functionally load-bearing for a
   correct report (see iso23369Analysis.js's companionFileMissing note), not a
   fully-optional add-on — so there's no "No, continue without" vs. "Yes, choose
   file" split; declining is just closing the dialog (the overlay's own click-
   outside-to-close, same as every other dialog here), and the toolbar's own
   companion-file button stays available to add one later.
   ===================================================================================== */

//#region dialog
/** @param {{onFileChosen:(file:File)=>void}} params */
export function openCompanionFilePrompt({ onFileChosen }) {
  const fileInput = el("input", {
    type: "file", accept: ".dat,.DAT,.sav,.SAV,.txt,.csv", style: "display:none",
    onchange: (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) { close(); onFileChosen(file); }
    }
  });

  const dialog = el("div", { class: "modal-box" },
    el("h3", {}, "Add Cyclic Companion File"),
    el("p", { class: "hint" },
      "This is a cyclic-flow (ISO 23369) test. The rig also writes a matching " +
      "\"-Cyclic.DAT\" file alongside this one, sampled much faster — it's needed to " +
      "resolve the flow cycle for accurate differential-pressure results (clause " +
      "11.11). Without it, the report still renders, using the primary file's " +
      "coarser once-a-minute samples instead."),
    fileInput,
    el("div", { class: "modal-actions" },
      el("button", { class: "act", onclick: close }, "Skip for now"),
      el("button", { class: "act primary", onclick: () => fileInput.click() }, "Choose file"))
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

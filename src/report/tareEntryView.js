/* =====================================================================================
   tareEntryView.js
   =====================================================================================
   ISO 3968's optional "tare" (empty-housing) file prompt — per the user, 2026-08-03:
   after a P-Q file loads, ask whether a matching tare run should be supplied too.
   Standard-agnostic shell, same as gravimetricEntryView.js's own header note explains
   for itself — this file has no idea what a tare file MEANS to the report, only how
   to ask the question and hand back the chosen File. Reuses the same
   .modal-overlay/.modal-box/.modal-actions components every other dialog in this
   project already established.

   Owns its own hidden file input (same shape compareView.js's "+ Add file(s)"
   button uses) rather than making the caller build one — app.js only needs to know
   what to do once a File is actually chosen, not how the picker gets triggered.
   ===================================================================================== */

//#region dialog
/** @param {{onFileChosen:(file:File)=>void}} params */
export function openTarePrompt({ onFileChosen }) {
  const fileInput = el("input", {
    type: "file", accept: ".dat,.DAT,.sav,.SAV,.txt,.csv", style: "display:none",
    onchange: (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) { close(); onFileChosen(file); }
    }
  });

  const dialog = el("div", { class: "modal-box" },
    el("h3", {}, "Tare File"),
    el("p", { class: "hint" },
      "Do you want to supply a tare file — the same P-Q test run against an empty " +
      "housing? Supplying one adds the housing's own pressure-drop curve to Page 2, " +
      "alongside the loaded test's own result."),
    fileInput,
    el("div", { class: "modal-actions" },
      el("button", { class: "act", onclick: close }, "No, continue without"),
      el("button", { class: "act primary", onclick: () => fileInput.click() }, "Yes, choose file"))
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

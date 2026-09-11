/* =====================================================================================
   chartAxisControls.js
   =====================================================================================
   Lets a user override a chart's axis min/max, preview the result, save it for the
   rest of the session, or revert to the computed default — the same three-step
   workflow the legacy report writer offered. SESSION-ONLY: overrides live in the Map
   below, in memory, for as long as this page stays loaded. Nothing here is written to
   localStorage or exported into a saved .json (chart tabs file or report session
   file) — a reload or a freshly loaded file always starts from each chart's computed
   default.

   Entry point is an explicit "Edit Chart" button placed to the right of the plot (an
   earlier version made the whole chart canvas clickable instead — dropped because
   Chart.js's own hit-testing meant only certain parts of the canvas actually
   responded, which read as broken/inconsistent rather than discoverable). This file
   knows nothing about Chart.js configs or chart data shapes — callers hand it a
   `redraw(override)` function and this file only manages the override map + the
   generic button/form UI.
   ===================================================================================== */

/** @typedef {{xMin?:number, xMax?:number, yMin?:number, yMax?:number}} AxisOverride */

//#region override store
/** @type {Map<string, AxisOverride>} chartId -> saved override (session-only, in memory) */
const overrides = new Map();

/** @param {string} chartId @returns {AxisOverride|null} */
export function getAxisOverride(chartId) {
  return overrides.get(chartId) || null;
}

/** @param {string} chartId */
export function clearAxisOverride(chartId) {
  overrides.delete(chartId);
}

/** Clears every saved override whose chartId matches `predicate` — used when a unit
 *  toggle would make a saved override's numbers refer to the wrong unit system.
 *  @param {(chartId: string) => boolean} predicate */
export function clearAxisOverridesWhere(predicate) {
  for (const id of [...overrides.keys()]) {
    if (predicate(id)) overrides.delete(id);
  }
}
//#endregion

//#region click-to-edit UI
/* buildAxisControls: builds an "Edit Chart" button and a collapsed-by-default form
   (X min/X max/Y min/Y max, Preview/Save/Revert) the button toggles. Returns both for
   the caller to place — the button belongs beside the plot (a caller-specific layout
   decision, e.g. to its right), the form belongs below it — this function inserts
   neither itself.

   Some callers redraw the SAME canvas repeatedly across the chart's own lifetime —
   report figures on every unit toggle/field edit/print, Compare Files on every replot
   — rather than getting a fresh <canvas> each time (unlike Explorer custom tabs, whose
   whole panel is torn down and rebuilt on every tab switch). Calling this function
   again for a canvas it's already bound to must NOT build a second button/form, and
   must NOT hand back controls that a stale first-call closure still controls — both
   real bugs an earlier version of this function had. Fixed by stashing the built DOM +
   a mutable {chartId, redraw} record ON the canvas element (same "track state on the
   element itself" convention chartView.js already uses for _chartInstance): a second
   call for the same canvas updates that record in place and returns the SAME button/
   panel nodes, rather than building new, unreachable ones. */
/**
 * @param {string} chartId stable id for this chart's override slot — may legitimately
 *   differ between calls for the same canvas (e.g. Compare Files replots a different
 *   selection into the same canvas); the controls re-target themselves to the new id
 * @param {HTMLCanvasElement} canvasEl the chart's canvas — used only as the stash key
 *   for the "don't rebuild for the same chart" idempotency above, not a click target
 * @param {(override: AxisOverride|null) => void} redraw redraws the chart with (or
 *   without) an override applied — caller-supplied, this file doesn't know how
 * @param {{axes?: {x?:boolean, y?:boolean}}} [options] which axis pairs of inputs to
 *   show — defaults to both. Set x/y false to omit an axis that isn't overridable on
 *   this particular chart (e.g. Figure B.3's fixed log-scale Y axis).
 * @returns {{button: HTMLElement, panel: HTMLElement}} the "Edit Chart" button and its
 *   (initially collapsed) panel — place the button beside the plot, the panel below it
 */
export function buildAxisControls(chartId, canvasEl, redraw, options = {}) {
  if (canvasEl._axisControls) {
    const existing = canvasEl._axisControls;
    existing.state.chartId = chartId;
    existing.state.redraw = redraw;
    existing.fillInputsFrom(getAxisOverride(chartId));
    return { button: existing.button, panel: existing.panel };
  }

  const showX = !options.axes || options.axes.x !== false;
  const showY = !options.axes || options.axes.y !== false;

  /** @type {{chartId:string, redraw:(o:AxisOverride|null)=>void}} mutable — kept current by repeat calls above */
  const state = { chartId, redraw };

  const xMinInput = el("input", { type: "number", step: "any", placeholder: "auto" });
  const xMaxInput = el("input", { type: "number", step: "any", placeholder: "auto" });
  const yMinInput = el("input", { type: "number", step: "any", placeholder: "auto" });
  const yMaxInput = el("input", { type: "number", step: "any", placeholder: "auto" });

  function fillInputsFrom(override) {
    xMinInput.value = (override && override.xMin !== undefined) ? override.xMin : "";
    xMaxInput.value = (override && override.xMax !== undefined) ? override.xMax : "";
    yMinInput.value = (override && override.yMin !== undefined) ? override.yMin : "";
    yMaxInput.value = (override && override.yMax !== undefined) ? override.yMax : "";
  }
  fillInputsFrom(getAxisOverride(chartId));

  function readForm() {
    /** @type {AxisOverride} */
    const values = {};
    if (showX) {
      if (xMinInput.value !== "") values.xMin = parseFloat(xMinInput.value);
      if (xMaxInput.value !== "") values.xMax = parseFloat(xMaxInput.value);
    }
    if (showY) {
      if (yMinInput.value !== "") values.yMin = parseFloat(yMinInput.value);
      if (yMaxInput.value !== "") values.yMax = parseFloat(yMaxInput.value);
    }
    return values;
  }

  const panel = el("div", { class: "axis-controls" },
    showX ? el("div", { class: "group" },
      el("label", {}, "X min"), xMinInput,
      el("label", {}, "X max"), xMaxInput) : null,
    showY ? el("div", { class: "group" },
      el("label", {}, "Y min"), yMinInput,
      el("label", {}, "Y max"), yMaxInput) : null,
    el("div", { class: "group" },
      el("button", { class: "act", onclick: () => state.redraw(readForm()) }, "Preview"),
      el("button", { class: "act primary", onclick: () => setAndRedraw() }, "Save"),
      el("button", { class: "act", onclick: () => revert() }, "Revert to default"))
  );
  panel.style.display = "none";

  function setAndRedraw() {
    const values = readForm();
    overrides.set(state.chartId, values);
    state.redraw(values);
  }

  function revert() {
    overrides.delete(state.chartId);
    fillInputsFrom(null);
    state.redraw(null);
  }

  // A pencil glyph, not "Edit Chart" text — a labeled button read as visually larger
  // than the plot area it sits beside, which is exactly what it shouldn't call
  // attention to. title= carries the same meaning a text label would, as a tooltip.
  const button = el("button", {
    class: "act edit-chart-btn",
    title: "Edit chart axes",
    "aria-label": "Edit chart axes",
    onclick: () => { panel.style.display = (panel.style.display === "none") ? "" : "none"; }
  }, "✎");

  canvasEl._axisControls = { button, panel, state, fillInputsFrom };
  return { button, panel };
}
//#endregion

//#region dom helper
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c) e.append(c);
  return e;
}
//#endregion

/* =====================================================================================
   reportView.js
   =====================================================================================
   Loads a report template fragment and fills it from a ReportValueStore. This file
   has no idea where store values came from (dummy data, a real .DAT file, or a user
   edit) — it only knows how to read data-slot hooks, convert unit-bearing
   values to the selected display system, and write into the page.

   Multi-page support: templateCache holds one cached HTML string per template URL, so
   re-rendering a standard already viewed this session doesn't re-fetch its templates.
   Which pages exist at all is reportPages.js's job, not this file's.

   ALL of a standard's pages render concatenated in one continuous scroll (renderReportPages)
   rather than one-at-a-time behind a page picker — printing was a one-page-at-a-time
   ordeal otherwise. Each page keeps its own top-level element (class="report-page",
   see the templates). Some pages are stamped out dynamically N times from a
   <template> (Table B.2 — see fillTableB2Pages), so the number of .report-page
   elements is not fixed by the template list alone. */
import { toDisplayValue, toCanonicalValue, formatNumber, displayUnit, formatSignificant } from "../helpers/units.js";
import { renderDPFigureChart, renderEfficiencyFigureChart, renderMassPressureFigureChart, renderFiltrationRatioFigureChart, renderBetaVsTimeFigureChart, renderBetaVsPressureFigureChart, renderPQFigureChart, renderCountsVsTimeFigureChart, destroyChartsIn } from "../core/charts/chartView.js";
import { getAxisOverride, buildAxisControls } from "../core/charts/chartAxisControls.js";
import { loadCompanyLogo } from "./companyLogoStore.js";

/** @type {string} shared "this slot exists in the static template but this file
 *  doesn't use it" class (app.css) — used by ISO16889 Page 2, Table B.2, and
 *  ISO19438's clump pages alike to hide an unused size column or clump slot. */
const RPT_SLOT_HIDDEN_CLASS = "rpt-slot-hidden";

//#region template fetch/cache
/** @type {Map<string,string>} templateUrl -> fetched HTML text */
const templateCache = new Map();

/** @param {string} templateUrl @returns {Promise<string>} */
async function fetchTemplate(templateUrl) {
  let html = templateCache.get(templateUrl);
  if (html === undefined) {
    const response = await fetch(templateUrl);
    html = await response.text();
    templateCache.set(templateUrl, html);
  }
  return html;
}
//#endregion

//#region public render API
/**
 * Fetches (or reuses cached) HTML for every page of a standard, concatenates them into
 * `container`, and fills every data-slot hook.
 * @param {HTMLElement} container
 * @param {import("./reportValueStore.js").ReportValueStore} store
 * @param {"SI"|"US"} units
 * @param {Array<{templateUrl:string}>} pages
 * @returns {Promise<void>}
 */
export async function renderReportPages(container, store, units, pages) {
  const htmlBlocks = await Promise.all(pages.map(page => fetchTemplate(page.templateUrl)));
  destroyChartsIn(container);   // wiping innerHTML below drops the old canvases without this
  container.innerHTML = htmlBlocks.join("\n");
  fillTemplate(container, store, units);
}

/** Re-fills whatever's already rendered in `container` (unit toggle, field edit) — a
 *  no-op if nothing has been rendered into it yet.
 *  @param {HTMLElement} container
 *  @param {import("./reportValueStore.js").ReportValueStore} store
 *  @param {"SI"|"US"} units */
export function refreshReport(container, store, units) {
  if (container.querySelector("[data-slot]")) {
    fillTemplate(container, store, units);
  }
}

/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillTemplate(root, store, units) {
  fillSlots(root, store, units);
  fillTableB2Pages(root, store, units);
  fillTable19438Pages(root, store, units);
  fillTable16889Page2(root, store, units);
  fillTable23369Page2(root, store, units);
  fillIso3968AverageDpTables(root, store, units);
  fillReportCharts(root, store, units);
  applyControlWarningMarkers(root, store);
  applyCompanyLogo(root);
}
//#endregion

//#region company logo (letterhead — global, not per-standard; see companyLogoStore.js)
/* applyCompanyLogo: runs LAST in fillTemplate, so every .report-page that exists by
   then — every static template page AND every page fillTableB2Pages/fillTable19438Pages
   etc. just stamped out above — gets one. Pure chrome (a positioned image), not report
   CONTENT any standard decides, so per CLAUDE.md this is legitimate shared, standard-
   agnostic presentation machinery rather than something to duplicate per template.
   Idempotent: remove-then-rebuild, same pattern applyControlWarningMarkers uses, so a
   unit-toggle/field-edit re-render never doubles the image up. Reads the logo directly
   from companyLogoStore, not the store param — it isn't per-file report data and must
   survive file loads/standard switches untouched.

   Print-only (app.css's .report-logo is display:none outside @media print) — the
   screen preview's .report-page has no equivalent of print's reserved page-bottom
   margin, so a screen-visible version of this same placement sat on top of real
   content instead of below it; per the user, 2026-09-09, not worth reproducing print's
   layout on screen just for this preview.

   ISO 16889/23369 Page 2 print landscape by rotating an inner block 90deg inside the
   (unrotated) portrait .report-page box — see app.css's own note on .w16889-p2-rotate/
   .w23369-p2-rotate. Appending the logo there instead of at .report-page's own root
   makes it rotate WITH the content, so app.css's plain bottom-center rule on
   .report-logo means "bottom-center of the landscape reading orientation" on those two
   pages too, with no separate rotation math needed here. */
/** @param {HTMLElement} root */
function applyCompanyLogo(root) {
  root.querySelectorAll(".report-logo").forEach(img => img.remove());

  const logo = loadCompanyLogo();
  if (!logo) return;

  root.querySelectorAll(".report-page").forEach(page => {
    const rotateBlock = page.querySelector(".w16889-p2-rotate, .w23369-p2-rotate");
    const img = document.createElement("img");
    img.className = "report-logo";
    img.src = logo.dataUrl;
    img.alt = "";
    (rotateBlock || page).appendChild(img);
  });
}
//#endregion

//#region slot filling (data-slot)
/* fillSlots: the data-slot substitution, factored out of fillTemplate so it can also
   be run on freshly-cloned Table B.2 pages (see fillTableB2Pages) — those are built
   AFTER the initial whole-container pass, so they need their own header fields filled
   by the same rules. Runs over whatever `root` is handed: the whole report container,
   or one cloned page. */
/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillSlots(root, store, units) {
  root.querySelectorAll("[data-slot]").forEach(el => {
    const id = el.dataset.slot;
    const raw = store.get(id);
    const canonicalUnit = store.getUnit(id);

    // A null store value means "nothing to show YET," not "show nothing" — for a
    // data-editable field (a real result the user can hand-enter/clear) that still
    // means blank, so "clear override" reads back as empty. For anything else
    // (structural chrome like a report title), leave whatever's already in the DOM
    // alone: a full render (renderReportPages) always rebuilds container.innerHTML
    // from the template's own text first, so at this point that's exactly the
    // template's own static default, e.g. a hardcoded title — never a stale value
    // from a previously-rendered file, since nothing renders here without that reset
    // happening first. refreshReport (in-place re-fill, no reset) never turns a
    // real data-editable value into null except via the explicit "clear override"
    // path, which must still blank — hence the attribute check, not a blanket skip.
    if (raw === null || raw === undefined) {
      if (el.hasAttribute("data-editable")) {
        el.textContent = "";
        el.classList.remove("overridden");
      }
      return;
    }

    let text;
    if (canonicalUnit) {
      text = formatNumber(toDisplayValue(raw, canonicalUnit, units), 1);
    } else {
      text = String(raw);
    }

    el.textContent = text;
    el.classList.toggle("overridden", store.isOverridden(id));

    // Every active standard's templates print a value's unit as a static sibling
    // <span class="unit"> — that text was hardcoded and never relabeled on a
    // unit-system toggle even though the VALUE itself was already converting
    // correctly, which read as broken. Relabel it here,
    // generically, for any data-slot field that actually has a canonical unit — a
    // field with no canonical unit (sizes, flow rates, concentrations — this project
    // deliberately never converts those, see units.js) leaves its sibling untouched.
    if (canonicalUnit) {
      const unitEl = el.nextElementSibling;
      if (unitEl && unitEl.classList.contains("unit")) unitEl.textContent = displayUnit(canonicalUnit, units);
    }
  });
}
//#endregion

//#region inline control-target warning markers
/* applyControlWarningMarkers: app.js stashes the same ControlTargetResult[] the
   warnings dialog uses (see warningsDialogView.js) into store.setExtra("controlResults",
   ...) after every checkControlTargets() run — this file has no idea what a "control
   target" is beyond that. Only a result with BOTH reportFieldId set (see
   controlTargetCheck.js's typedef — deliberately absent for rules with no single
   displayed field) AND applicable/!ok gets a marker; everything else (passing rules,
   rules with no reportFieldId) is still visible in the full-detail dialog, just not
   pinned to a page field. Idempotent: removes markers from a prior fillTemplate call
   before adding fresh ones, same "remove-then-rebuild" pattern fillTableB2Pages uses
   for .b2-generated pages, so a unit-toggle re-render never doubles them up. */
/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store */
function applyControlWarningMarkers(root, store) {
  root.querySelectorAll(".field-warn").forEach(m => m.remove());

  const results = store.getExtra("controlResults");
  if (!results) return;

  for (const r of results) {
    if (!r.reportFieldId || !r.applicable || r.ok !== false) continue;
    const target = root.querySelector('[data-slot="' + r.reportFieldId + '"]');
    if (!target) continue;

    const marker = document.createElement("span");
    marker.className = "field-warn";
    marker.textContent = "⚠";
    marker.title = r.parameter + ": " + r.message;

    // Right after the VALUE itself (before the .unit span, if any) — not appended
    // to the end of .field, which would land it after the unit instead.
    target.insertAdjacentElement("afterend", marker);
  }
}
//#endregion

//#region print-explicit chart sizing
/* computePrintFigureSizePx: see chartView.js's "Explicit print sizing" note on
   renderEfficiencyFigureChart for WHY this exists — measuring a print-styled
   container from JS turned out not to be reliable (figures kept rendering short
   regardless of what CSS height was specified, tried at several different values
   with no visible change), so print figure sizing is computed directly from these
   constants instead of ever reading the DOM. MUST be kept in sync BY HAND with
   app.css's @page rule and .single-fig/.double-fig .figure-wrap print heights —
   there is no way to derive one from the other automatically here, so a comment at
   each of those CSS rules points back to this function as a reminder.

   PRINT_DPI is CSS's fixed, device-independent 96px = 1in conversion — not any
   actual printer's DPI, which is irrelevant here: @page sizes/margins and Chart.js's
   canvas pixel dimensions are both expressed in CSS px, and CSS defines that
   conversion as a universal constant, not something to measure. */
const PRINT_DPI = 96;
/** @type {{top:number,right:number,bottom:number,left:number}} inches — MUST match
 *  app.css's @page margin (currently 0.5in all sides). Kept in sync by hand; see the
 *  right-margin history/warning in app.css's @page comment before changing `right`. */
const PAGE_MARGIN_IN = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };
/** @type {Record<"letter"|"a4", number>} inches */
const PAPER_WIDTH_IN = { letter: 8.5, a4: 8.27 };
/** @type {number} px — app.css's .chart-wrap padding, lost from the canvas on EACH side */
const CHART_WRAP_PADDING_PX = 10;
/** @type {Record<"single"|"double"|"pq3968", number>} inches — app.css's print
 *  .figure-wrap/.iso3968-page1 .chart-wrap heights. "pq3968" is a first-pass
 *  estimate, not yet measured against a real printed sheet — see app.css's own note
 *  on that rule. */
const FIGURE_HEIGHT_IN = { single: 7.7, double: 3.85, pq3968: 4 };

/** @param {"letter"|"a4"} paperSize @param {"single"|"double"|"pq3968"} kind @returns {{width:number,height:number}} */
function computePrintFigureSizePx(paperSize, kind) {
  const usableWidthIn = (PAPER_WIDTH_IN[paperSize] || PAPER_WIDTH_IN.letter) - PAGE_MARGIN_IN.left - PAGE_MARGIN_IN.right;
  return {
    width: Math.round(usableWidthIn * PRINT_DPI - CHART_WRAP_PADDING_PX * 2),
    height: Math.round(FIGURE_HEIGHT_IN[kind] * PRINT_DPI - CHART_WRAP_PADDING_PX * 2)
  };
}
//#endregion

//#region report figures (ISO 4548-12 Figures B.1-B.3)
/* fillReportCharts: finds any [data-report-chart] canvases in the current page set
   and draws the matching figure into them. No-op per-canvas if the page doesn't have
   one (most standards/pages don't) or if the data it needs isn't available (e.g. a
   loaded SESSION file has no "sourceDf"/"sourceAnalysis" extras — see buildDPFigureData
   — since a raw DataFile/analysis instance can't round-trip through JSON the way
   ordinary store fields do; the canvas is simply left blank rather than erroring).
   The DP chart's ΔP axis now respects the SI/US toggle (renderDPFigureChart converts
   at the point of use, kPa canonical -> display unit — see chartView.js). The
   efficiency figures (B.2/B.3) have no unit-bearing axis (percent and µmC only), so
   there's nothing for them to convert.

   `paperSize` ("letter"|"a4"), when passed, means "this redraw is for print" — each
   render call gets an explicit pixel size computed by computePrintFigureSizePx above
   instead of trusting Chart.js's own container measurement (see chartView.js's note
   on renderEfficiencyFigureChart for why). Omitted for the normal on-screen redraw
   paths (refreshReport/fillTemplate), which keep the original auto-measuring
   behavior — only app.js's print-triggered redraw passes it.

   Exported as redrawReportCharts (below) so app.js's print hooks can call it
   directly on the LIVE #view-report container — a full rebuild (destroy + fresh
   `new Chart()`) rather than calling .resize() on the existing instances, because
   construction always measures its container's CURRENT computed layout from
   scratch, with no dependency on when a previously-built instance last measured
   itself. resize()-ing a stale instance turned out not to be reliable enough
   across the beforeprint/matchMedia timing gap — see app.js. */
/* Each figure's redraw closure is handed to buildAxisControls as its `redraw`
   callback (see chartAxisControls.js) — the "Edit Chart" button it returns goes right
   into that figure's .chart-wrap (found via the canvas's own .closest, so no extra
   template markup is needed for the button itself), the panel goes into the mount
   point the template reserves right after that figure's caption
   ([data-axis-controls-for], see iso454812_page3.html/_page4.html). "report:" +
   slot is the override's session-only storage key. */
/** @param {HTMLElement} root @param {string} slot @param {HTMLCanvasElement} canvas
 *  @param {(override: import("../core/charts/chartAxisControls.js").AxisOverride|null) => void} redraw
 *  @param {{axes?:{x?:boolean,y?:boolean}}} [options] */
function mountAxisControls(root, slot, canvas, redraw, options) {
  const { button, panel } = buildAxisControls("report:" + slot, canvas, redraw, options);

  const chartWrap = canvas.closest(".chart-wrap");
  if (chartWrap) chartWrap.appendChild(button);   // appendChild moves the SAME button node across redraws — see buildAxisControls' idempotency note

  const panelMount = root.querySelector('[data-axis-controls-for="' + slot + '"]');
  if (panelMount) { panelMount.innerHTML = ""; panelMount.appendChild(panel); }
}

/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units
 *  @param {"letter"|"a4"} [paperSize] present only for the print-triggered redraw — see the note above */
function fillReportCharts(root, store, units, paperSize) {
  const dpSize = paperSize ? computePrintFigureSizePx(paperSize, "single") : null;
  const dpCanvas = root.querySelector('[data-report-chart="dpVsTime"]');
  if (dpCanvas) {
    const redraw = (override) => renderDPFigureChart(dpCanvas, buildDPFigureData(store), units, override, dpSize);
    redraw(getAxisOverride("report:dpVsTime"));
    mountAxisControls(root, "dpVsTime", dpCanvas, redraw);
  }

  const figSize = paperSize ? computePrintFigureSizePx(paperSize, "double") : null;
  const effLinearCanvas = root.querySelector('[data-report-chart="effLinear"]');
  if (effLinearCanvas) {
    const redraw = (override) => renderEfficiencyFigureChart(effLinearCanvas, store.getExtra("effChart"), { logScale: false }, override, figSize);
    redraw(getAxisOverride("report:effLinear"));
    mountAxisControls(root, "effLinear", effLinearCanvas, redraw);
  }

  const effLogCanvas = root.querySelector('[data-report-chart="effLog"]');
  if (effLogCanvas) {
    // Y is fixed on the log-scale figure — see renderEfficiencyFigureChart's jsdoc.
    const redraw = (override) => renderEfficiencyFigureChart(effLogCanvas, store.getExtra("effChart"), { logScale: true }, override, figSize);
    redraw(getAxisOverride("report:effLog"));
    mountAxisControls(root, "effLog", effLogCanvas, redraw, { axes: { x: true, y: false } });
  }

  // ---- ISO 19438: same 3-figure shape, own canvas ids/override keys (deliberately
  // NOT reusing "dpVsTime"/"effLinear"/"effLog" — only one standard's report is ever
  // shown at a time, but a SAVED axis override from a previous session on the OTHER
  // standard must never leak in just because the string key happened to match) ----
  const dp19438Canvas = root.querySelector('[data-report-chart="dpVsTime19438"]');
  if (dp19438Canvas) {
    // rightAxisMode "even": ISO 19438's Figure B.2 wants plain -10%-to-110% ticks,
    // not 4548-12's 7 milestone-snapped ones — see chartView.js.
    const redraw = (override) => renderDPFigureChart(dp19438Canvas, buildDPFigureData(store), units, override, dpSize, "even");
    redraw(getAxisOverride("report:dpVsTime19438"));
    mountAxisControls(root, "dpVsTime19438", dp19438Canvas, redraw);
  }

  const effLinear19438Canvas = root.querySelector('[data-report-chart="effLinear19438"]');
  if (effLinear19438Canvas) {
    const redraw = (override) => renderEfficiencyFigureChart(effLinear19438Canvas, store.getExtra("effChart"), { logScale: false }, override, figSize);
    redraw(getAxisOverride("report:effLinear19438"));
    mountAxisControls(root, "effLinear19438", effLinear19438Canvas, redraw);
  }

  const effLog19438Canvas = root.querySelector('[data-report-chart="effLog19438"]');
  if (effLog19438Canvas) {
    const redraw = (override) => renderEfficiencyFigureChart(effLog19438Canvas, store.getExtra("effChart"), { logScale: true }, override, figSize);
    redraw(getAxisOverride("report:effLog19438"));
    mountAxisControls(root, "effLog19438", effLog19438Canvas, redraw, { axes: { x: true, y: false } });
  }

  // ---- ISO 16889:2022: Figures C.2-C.5, own canvas ids/override keys — same
  // "never reuse another standard's key" reasoning as the ISO 19438 block above. ----
  const massPressureCanvas = root.querySelector('[data-report-chart="massPressure16889"]');
  if (massPressureCanvas) {
    const redraw = (override) => renderMassPressureFigureChart(massPressureCanvas, build16889MassPressureData(store), units, override, figSize);
    redraw(getAxisOverride("report:massPressure16889"));
    mountAxisControls(root, "massPressure16889", massPressureCanvas, redraw);
  }

  const filtrationRatioCanvas = root.querySelector('[data-report-chart="filtrationRatio16889"]');
  if (filtrationRatioCanvas) {
    // Y is fixed (standard-defined beta band) — same convention as effLog's own X-only editing.
    const redraw = (override) => renderFiltrationRatioFigureChart(filtrationRatioCanvas, store.getExtra("betaChart"), override, figSize);
    redraw(getAxisOverride("report:filtrationRatio16889"));
    mountAxisControls(root, "filtrationRatio16889", filtrationRatioCanvas, redraw, { axes: { x: true, y: false } });
  }

  const betaVsTimeCanvas = root.querySelector('[data-report-chart="betaVsTime16889"]');
  if (betaVsTimeCanvas) {
    const redraw = (override) => renderBetaVsTimeFigureChart(betaVsTimeCanvas, store.getExtra("betaVsTimeChart"), override, figSize);
    redraw(getAxisOverride("report:betaVsTime16889"));
    mountAxisControls(root, "betaVsTime16889", betaVsTimeCanvas, redraw, { axes: { x: true, y: false } });
  }

  const betaVsPressureCanvas = root.querySelector('[data-report-chart="betaVsPressure16889"]');
  if (betaVsPressureCanvas) {
    const redraw = (override) => renderBetaVsPressureFigureChart(betaVsPressureCanvas, store.getExtra("betaVsPressureChart"), units, override, figSize);
    redraw(getAxisOverride("report:betaVsPressure16889"));
    mountAxisControls(root, "betaVsPressure16889", betaVsPressureCanvas, redraw, { axes: { x: true, y: false } });
  }

  // ---- ISO 23369:2022: Figures C.1-C.4, own canvas ids/override keys — same
  // "never reuse another standard's key" reasoning as the ISO 16889 block above.
  // ratioLabel is "a" (this standard's own filtration-ratio symbol), not ISO
  // 16889's "β" — see chartView.js's ratioLabel parameterization. ----
  const massInjectedCanvas = root.querySelector('[data-report-chart="massInjected23369"]');
  if (massInjectedCanvas) {
    const redraw = (override) => renderMassPressureFigureChart(massInjectedCanvas, build23369MassInjectedData(store), units, override, figSize);
    redraw(getAxisOverride("report:massInjected23369"));
    mountAxisControls(root, "massInjected23369", massInjectedCanvas, redraw);
  }

  const ratioSizeCanvas = root.querySelector('[data-report-chart="filtrationRatio23369"]');
  if (ratioSizeCanvas) {
    // renderFiltrationRatioFigureChart's `data` shape ({sizes, overallBeta}) is
    // generic drawing-machinery internal naming, not an ISO-16889-specific field —
    // only the axis TEXT is standard content (ratioLabel, below). iso23369Mapper.js's
    // own extra is named overallRatio (this standard's own terminology), adapted to
    // the shape the shared function reads right here at the call site, rather than
    // renaming the generic function's own parameter to fit one caller.
    const redraw = (override) => {
      const c = store.getExtra("ratioChart");
      const data = c ? { sizes: c.sizes, overallBeta: c.overallRatio } : null;
      return renderFiltrationRatioFigureChart(ratioSizeCanvas, data, override, figSize, "a");
    };
    redraw(getAxisOverride("report:filtrationRatio23369"));
    mountAxisControls(root, "filtrationRatio23369", ratioSizeCanvas, redraw, { axes: { x: true, y: false } });
  }

  const ratioVsTimeCanvas = root.querySelector('[data-report-chart="ratioVsTime23369"]');
  if (ratioVsTimeCanvas) {
    const redraw = (override) => renderBetaVsTimeFigureChart(ratioVsTimeCanvas, store.getExtra("ratioVsTimeChart"), override, figSize, "a");
    redraw(getAxisOverride("report:ratioVsTime23369"));
    mountAxisControls(root, "ratioVsTime23369", ratioVsTimeCanvas, redraw, { axes: { x: true, y: false } });
  }

  const ratioVsPressureCanvas = root.querySelector('[data-report-chart="ratioVsPressure23369"]');
  if (ratioVsPressureCanvas) {
    const redraw = (override) => renderBetaVsPressureFigureChart(ratioVsPressureCanvas, store.getExtra("ratioVsPressureChart"), units, override, figSize, "a");
    redraw(getAxisOverride("report:ratioVsPressure23369"));
    mountAxisControls(root, "ratioVsPressure23369", ratioVsPressureCanvas, redraw, { axes: { x: true, y: false } });
  }

  // ---- ISO 3968: Figure 4, on the same page as its identification fields (not a
  // dedicated figure page) — own "pq3968" print-size kind, since it shares a sheet
  // with other content instead of getting the full single/double figure-page height. ----
  const pqSize = paperSize ? computePrintFigureSizePx(paperSize, "pq3968") : null;
  const pqCanvas = root.querySelector('[data-report-chart="pq3968"]');
  if (pqCanvas) {
    const redraw = (override) => renderPQFigureChart(pqCanvas, buildPQFigureData(store), units, override, pqSize);
    redraw(getAxisOverride("report:pq3968"));
    mountAxisControls(root, "pq3968", pqCanvas, redraw);
  }

  // ---- "Add Count Details" (optional page): Upstream/Downstream Counts vs. Time —
  // iso16889/iso454812/iso19438 only (iso3968 has no particle counting at all). Own canvas ids/
  // override keys per standard, same never-reuse-another-standard's-key rule as every
  // other block above. Upstream gets NO mountAxisControls call at all — no edit
  // button — since only downstream needs to be user-editable (per the user) and no
  // existing chart demonstrates a button-present-but-disabled state. ----
  for (const suffix of ["454812", "16889", "19438", "23369"]) {
    const upCanvas = root.querySelector('[data-report-chart="upstreamCountsVsTime' + suffix + '"]');
    const downCanvas = root.querySelector('[data-report-chart="downstreamCountsVsTime' + suffix + '"]');
    if (!upCanvas && !downCanvas) continue;

    const countsData = buildCountsVsTimeData(store);

    if (upCanvas) {
      renderCountsVsTimeFigureChart(upCanvas, countsData && countsData.upstream, countsData && countsData.defaultYMax, null, figSize);
    }
    if (downCanvas) {
      const slot = "downstreamCountsVsTime" + suffix;
      const redraw = (override) => renderCountsVsTimeFigureChart(downCanvas, countsData && countsData.downstream, countsData && countsData.defaultYMax, override, figSize);
      redraw(getAxisOverride("report:" + slot));
      mountAxisControls(root, slot, downCanvas, redraw);
    }
  }
}

/** @param {HTMLElement} container @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units
 *  @param {"letter"|"a4"} [paperSize] pass only from the print-triggered redraw — see fillReportCharts' note */
export function redrawReportCharts(container, store, units, paperSize) {
  fillReportCharts(container, store, units, paperSize);
}

/* buildDPFigureData: reads the "sourceDf"/"sourceAnalysis" store extras (stashed by
   app.js's loadFileText right alongside the mapper call — the only place both a live
   DataFile and its analysis result exist together) to build the DP-vs-time figure's
   points — ISO 4548-12's Figure B.1 AND ISO 19438's Figure B.2 (the two standards'
   Analysis engines expose the same terminationTag/terminationTime/terminationDP/
   injectedMass/netDPMilestones/cleanAssemblyDP fields, so this one function serves
   both; renderDPFigureChart's rightAxisMode is what actually differs between them).
   Everything past analysis.terminationTime is dropped — the report describes the
   test up to termination, not whatever extra logging happened after. */
/** @param {import("./reportValueStore.js").ReportValueStore} store @returns {*|null} */
function buildDPFigureData(store) {
  const df = store.getExtra("sourceDf");
  const analysis = store.getExtra("sourceAnalysis");
  if (!df || !analysis || !analysis.ok) return null;

  const dpValues = analysis.overallDPSeries || df.getChannel(analysis.terminationTag);
  if (!dpValues) return null;

  const points = [];
  for (let i = 0; i < dpValues.length; i++) {
    const t = df.times[i];
    if (t === null || dpValues[i] === null || t > analysis.terminationTime) continue;
    points.push({ minutes: t / 60, dp: dpValues[i] });
  }

  return {
    points,
    terminationMinutes: analysis.terminationTime / 60,
    terminationDP: analysis.terminationDP,
    injectedMassTotal: analysis.injectedMass,
    // The right axis's 7 major ticks (5/10/15/20/40/80/100% net ΔP rise) are the
    // SAME milestone rows already on Page 1's %-net-ΔP table — reusing
    // analysis.netDPMilestones directly (rather than recomputing the percent->kPa
    // formula here) guarantees the chart's gridlines land on exactly the ΔP values
    // Page 1 reports, not a second, independently-rounded computation of the same
    // thing that could drift out of sync with it.
    netDPMilestones: analysis.netDPMilestones,
    // Only used by rightAxisMode:"even" (ISO 19438's Figure B.2) to compute its
    // evenly-spaced -10%-to-110% ticks — see chartView.js's pctToKpa. Harmless,
    // unused extra field for ISO 4548-12's own milestone-snapped Figure B.1.
    cleanAssemblyDP: analysis.cleanAssemblyDP
  };
}
//#endregion

//#region ISO 16889:2022 Figure C.2 data (own copy — genuinely different shape from
// buildDPFigureData above: no netDPMilestones/cleanAssemblyDP concept, and the
// x-axis is contaminant MASS directly, not time with a secondary mass axis, since
// the standard doesn't ask for a right axis on this figure the way B.1/B.2 get one)
/* build16889MassPressureData: same "read sourceDf/sourceAnalysis, walk the
   termination channel" shape as buildDPFigureData, but each point's x is mass, not
   minutes — computed the same proportional way buildDPFigureData's own x2 axis
   already does (13.4: Mass_Injected_By_Analog_Time = Ave_Injection_GravLevel x
   Ave_Injection_Flow x Analog_Record_Time / 1000, which reduces to "this point's
   share of the total injected mass, by elapsed-time proportion" once the total is
   already known). The total (isoMtdMassInjected, 13.2) lives on the STORE, not
   analysis — it's gravimetric-dependent, computed by app.js's
   recomputeIso16889GravimetricDerived, same reason Page 1's own copy of that field
   is blank until a gravimetric entry (or its header-fallback average) exists. If
   it's not resolvable yet, every point's mass comes out null and gets filtered by
   renderMassPressureFigureChart — the chart simply doesn't render yet, same as any
   other gravimetric-dependent report content. */
/** @param {import("./reportValueStore.js").ReportValueStore} store @returns {*|null} */
function build16889MassPressureData(store) {
  const df = store.getExtra("sourceDf");
  const analysis = store.getExtra("sourceAnalysis");
  if (!df || !analysis || !analysis.ok) return null;

  const dpValues = analysis.overallDPSeries || df.getChannel(analysis.terminationTag);
  if (!dpValues) return null;

  const terminationMinutes = analysis.terminationTime / 60;
  const injectedMassTotal = parseFloat(store.get("isoMtdMassInjected"));
  const massTotal = isFinite(injectedMassTotal) ? injectedMassTotal : null;

  const points = [];
  for (let i = 0; i < dpValues.length; i++) {
    const t = df.times[i];
    if (t === null || dpValues[i] === null || t > analysis.terminationTime) continue;
    const minutes = t / 60;
    const mass = (massTotal === null || !terminationMinutes) ? null : (minutes / terminationMinutes) * massTotal;
    points.push({ mass, dp: dpValues[i] });
  }

  return { points, terminationDP: analysis.terminationDP };
}

/* build23369MassInjectedData: same "read sourceDf/sourceAnalysis, walk a channel,
   x is this point's proportional share of the total injected mass" shape as
   build16889MassPressureData above.

   Two series (high-flow-phase and low-flow-phase companion ΔP) when the companion
   file resolved both — per the user, 2026-08-20: a single series here previously
   read as JUST the high-flow phase (the primary file's once-a-minute sampling
   happens to alias onto one phase when its interval is a near-multiple of the
   flow cycle length, rather than genuinely averaging/mixing both), which looked
   like data was missing rather than being an intentional choice. analysis.
   companionHighDPSeries/companionLowDPSeries are read directly (iso23369Analysis.
   js's own _computeCompanionPhaseDPSeries), not re-derived here — phase-splitting
   is analysis PROCEDURE content, owned there, per CLAUDE.md.
   Falls back to the PRIMARY file's own single channel (df.getChannel(analysis.
   terminationTag)) whenever no companion file resolved both phases — same
   coarser-but-always-available series this figure used before either fix existed.
   For a dual-filter "overall" pressureView, terminationTag is "" (see
   iso23369Analysis.js's _resolveDualFilterDisplay) and companionHighDPSeries/
   companionLowDPSeries are never populated either (own scope note on that field) —
   this returns no data rather than re-deriving the primary-channel sum here; that
   combination is unconfirmed by any real cyclic fixture, not worth speculative
   untested code. */
/** @param {import("./reportValueStore.js").ReportValueStore} store @returns {*|null} */
function build23369MassInjectedData(store) {
  const df = store.getExtra("sourceDf");
  const analysis = store.getExtra("sourceAnalysis");
  if (!df || !analysis || !analysis.ok || !analysis.terminationTag) return null;

  const terminationMinutes = analysis.terminationTime / 60;
  const injectedMassTotal = parseFloat(store.get("isoMtdMassInjected"));
  const massTotal = isFinite(injectedMassTotal) ? injectedMassTotal : null;

  const toMassPoints = (times, values) => {
    const points = [];
    for (let i = 0; i < values.length; i++) {
      const t = times[i];
      if (t === null || values[i] === null || t > analysis.terminationTime) continue;
      const minutes = t / 60;
      const mass = (massTotal === null || !terminationMinutes) ? null : (minutes / terminationMinutes) * massTotal;
      points.push({ mass, dp: values[i] });
    }
    return points;
  };

  if (analysis.companionHighDPSeries && analysis.companionLowDPSeries) {
    return {
      points: toMassPoints(analysis.companionHighDPSeries.times, analysis.companionHighDPSeries.values),
      seriesLabel: "High-flow phase",
      secondarySeries: {
        label: "Low-flow phase",
        points: toMassPoints(analysis.companionLowDPSeries.times, analysis.companionLowDPSeries.values)
      },
      terminationDP: analysis.terminationDP
    };
  }

  const dpValues = df.getChannel(analysis.terminationTag);
  if (!dpValues) return null;
  return { points: toMassPoints(df.times, dpValues), terminationDP: analysis.terminationDP };
}

/* buildPQFigureData: ISO 3968's Figure 4. Unlike buildDPFigureData/
   build16889MassPressureData, no channel-walking is needed at all — Iso3968Analysis
   already extracts {time, flowRate, dp} points directly (see iso3968Analysis.js's
   own file-structure note), so this is just a straight pass-through of
   analysis.points into the shape renderPQFigureChart expects. No terminationDP-style
   target line — a P-Q sweep has no single termination point. */
/** @param {import("./reportValueStore.js").ReportValueStore} store @returns {*|null} */
function buildPQFigureData(store) {
  const analysis = store.getExtra("sourceAnalysis");
  if (!analysis || !analysis.ok || !analysis.points || analysis.points.length === 0) return null;
  return { points: analysis.points };
}
//#endregion

//#region "Add Count Details" data (iso16889/iso454812/iso19438's own optional page)
/* COUNT_CHANNEL_PROPS: NOT a copy of any standard's own SENSOR_CHANNELS (each of
   iso16889Analysis.js/iso454812Analysis.js/iso19438Analysis.js defines its own,
   privately, per CLAUDE.md's no-shared-analysis-procedures rule — and being private to
   each file's own module scope, they can't be imported from here anyway). This is
   DataFile's own row/size property naming — a .DAT FORMAT fact (see dataFile.js),
   not a standard's decision — confirmed identical across all three standards' own maps
   for exactly the 3 fields needed here. chartData.js's SENSOR_SPECS (Explorer) encodes
   the same underlying fact in a different shape. */
/** @type {Record<string,{sizesProp:string,upProp:string,downProp:string}>} */
const COUNT_CHANNEL_PROPS = {
  lb: { sizesProp: "lbSizes", upProp: "lbu", downProp: "lbd" },
  ls: { sizesProp: "lsSizes", upProp: "lsu", downProp: "lsd" },
  lbe: { sizesProp: "lbeSizes", upProp: "lbd", downProp: "lbe" }
};

/* buildCountsVsTimeData: reads the same "sourceDf"/"sourceAnalysis" extras
   buildDPFigureData does, plus "resolvedDisplaySizes" (the same currently-selected size
   list already driving Table B.2/the efficiency table for this standard — see
   iso454812Mapper.js etc.), and builds one {x: minutes, y: count} series per selected
   size, for upstream and downstream separately. Sizes are matched by VALUE (indexOf
   into the file's own size list), not by position — same idiom as chartData.js's
   buildComparisonSizeDataset, since a display size's column index into df[sizesProp]
   isn't guaranteed to equal its position in resolvedDisplaySizes. Points past
   analysis.terminationTime are dropped, same as buildDPFigureData. defaultYMax is the
   max value across every plotted UPSTREAM point only (count channels are cumulative —
   the smallest size's line is already the tallest — so this single reduction gives the
   correct "0 to max upstream count" default for both charts without needing to single
   out "the smallest size" as a special case). @param {import("./reportValueStore.js").ReportValueStore} store
   @returns {{upstream:{series:*[]}, downstream:{series:*[]}, defaultYMax:number}|null} */
function buildCountsVsTimeData(store) {
  const df = store.getExtra("sourceDf");
  const analysis = store.getExtra("sourceAnalysis");
  const displaySizes = store.getExtra("resolvedDisplaySizes");
  if (!df || !analysis || !analysis.ok || !displaySizes || displaySizes.length === 0) return null;

  const props = COUNT_CHANNEL_PROPS[analysis.sensor];
  if (!props) return null;

  const fileSizes = df[props.sizesProp];
  const upRows = df[props.upProp];
  const downRows = df[props.downProp];
  if (!fileSizes || !upRows || !downRows || upRows.length === 0) return null;

  // fileSizes holds RAW STRINGS straight from the header row (see dataFile.js —
  // never parsed to Number there), while resolvedDisplaySizes holds NUMBERS (see
  // iso454812Mapper.js's resolveFixedSizes, which .map(Number)s explicitly) — an
  // indexOf(Number(size)) against the raw string array always misses. Convert once
  // here, same as resolveFixedSizes' own (analysis.sizes || []).map(Number).
  const numericFileSizes = fileSizes.map(Number);

  const upSeries = [];
  const downSeries = [];
  let defaultYMax = 0;

  for (const size of displaySizes) {
    const sizeIndex = numericFileSizes.indexOf(Number(size));
    if (sizeIndex < 0) continue;

    const upPoints = [];
    const downPoints = [];
    for (let i = 0; i < upRows.length; i++) {
      const t = df.times[i];
      if (t === null || t > analysis.terminationTime) continue;
      const up = parseFloat(upRows[i][sizeIndex]);
      const down = parseFloat(downRows[i][sizeIndex]);
      const minutes = t / 60;
      if (isFinite(up)) { upPoints.push({ x: minutes, y: up }); if (up > defaultYMax) defaultYMax = up; }
      if (isFinite(down)) downPoints.push({ x: minutes, y: down });
    }

    const label = size + " µm";
    upSeries.push({ label, data: upPoints });
    downSeries.push({ label, data: downPoints });
  }

  return { upstream: { series: upSeries }, downstream: { series: downSeries }, defaultYMax };
}
//#endregion

//#region shared repeatable-page + size-block machinery (standard-agnostic — see CLAUDE.md)
/* Standard-AGNOSTIC presentation machinery shared by the per-standard table blocks below
   (Table B.2 / ISO 19438 per-window pages). fillRepeatablePages owns HOW a repeatable
   report page is stamped out; fillSizeBlock owns HOW a size block's cells are filled.
   Neither owns WHAT a given standard's report says — every standard's own decision (which
   template, clumps per page, data source, how one clump row reads, which column class its
   template uses) arrives as a parameter, so a change here changes pagination/cell
   mechanics for all callers at once and cannot alter one standard's content on another's
   behalf. Per-standard content stays in each block's own fill*Clump (CLAUDE.md: "report
   CONTENT is never shared between standards" + the tail-chasing test).

   Why real per-page <template>s (this whole mechanism) instead of one giant table with a
   repeating <thead>: the giant table relied on the browser's natural flow to decide page
   breaks, so the last clump on a page could spill or get orphaned when print typography
   changed — that stranded a clump and forced an extra page. Explicit N-clumps-per-page
   sheets give predictable, self-contained pages, each carrying its own identification
   header; pagination is then just ".report-page { page-break-after: always }" (app.css),
   independent of where any shared table happens to break. */

/**
 * @typedef {Object} RepeatablePageSpec
 * @property {string} templateId  CSS id selector of the per-page <template> (e.g. "#b2PageTemplate")
 * @property {string} anchorId    CSS id selector of the marker the generated pages are inserted after
 * @property {string} generatedClass  class stamped on every page this makes (and removed first, so re-render is idempotent)
 * @property {string} extraKey    store.getExtra key holding this standard's array of per-page items
 * @property {number} clumpsPerPage  items per sheet — hand-tuned PER STANDARD against real print output, never unified
 * @property {(tbody: HTMLElement, item: *, units: "SI"|"US") => void} fillClump  this standard's own per-clump row fill
 * @property {*} placeholderItem  a single fake item, shaped exactly like a real one but with
 *   every value blank/null, sized to THIS standard's own max column count — used only when
 *   there are no real items yet (no file loaded), so the page's shape is still inspectable.
 *   Own copy per standard (not derived generically in here) since the shape a standard's
 *   own fillClump expects — how many size columns it has — is itself a per-standard fact.
 */

/** Stamps one filled copy of a per-page <template> per group of clumpsPerPage items and
 *  drops them in after the anchor. Idempotent: first removes any pages a prior call
 *  generated (unit toggle, field edit, re-render all re-run this), then rebuilds from the
 *  pristine <template>, which is inert markup that never itself gets filled or removed.
 *  No-op when the current page set has no such template (the id only exists in the owning
 *  standard's page HTML), so calling it unconditionally from fillTemplate is harmless for
 *  every other standard.
 *  @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store
 *  @param {"SI"|"US"} units @param {RepeatablePageSpec} spec */
function fillRepeatablePages(root, store, units, spec) {
  const tmpl = root.querySelector(spec.templateId);
  const anchor = root.querySelector(spec.anchorId);
  if (!tmpl || !anchor) return;

  root.querySelectorAll("." + spec.generatedClass).forEach(p => p.remove());

  const items = store.getExtra(spec.extraKey) || [];

  if (items.length === 0) {
    // No real items yet (no file loaded) — still show ONE page in its full shape
    // (slot 1 filled with a blank placeholder, every optional column visible)
    // rather than rendering nothing at all, so the page's shape can be inspected.
    // Only slot 1, not all clumpsPerPage slots — enough to show the shape without
    // a wall of identical empty blocks.
    if (spec.placeholderItem) {
      const page = tmpl.content.firstElementChild.cloneNode(true);
      page.classList.add(spec.generatedClass);
      fillSlots(page, store, units);
      for (let slot = 1; slot <= spec.clumpsPerPage; slot++) {
        const tbody = page.querySelector('tbody[data-clump-slot="' + slot + '"]');
        if (!tbody) continue;
        if (slot === 1) {
          tbody.classList.remove(RPT_SLOT_HIDDEN_CLASS);
          spec.fillClump(tbody, spec.placeholderItem, units);
        } else {
          tbody.classList.add(RPT_SLOT_HIDDEN_CLASS);
        }
      }
      anchor.after(page);
    }
    return;
  }

  const frag = document.createDocumentFragment();
  let pageIndex = 0;
  for (let start = 0; start < items.length; start += spec.clumpsPerPage, pageIndex++) {
    const group = items.slice(start, start + spec.clumpsPerPage);
    const page = tmpl.content.firstElementChild.cloneNode(true);
    page.classList.add(spec.generatedClass);

    // Big title on the first sheet only; continuation sheets keep the identification
    // header (so each stands alone) but not a repeated title — matches the reference report.
    if (pageIndex > 0) {
      const h1 = page.querySelector("h1");
      if (h1) h1.remove();
    }

    fillSlots(page, store, units);   // identification header fields on this sheet

    for (let slot = 1; slot <= spec.clumpsPerPage; slot++) {
      const tbody = page.querySelector('tbody[data-clump-slot="' + slot + '"]');
      if (!tbody) continue;
      const item = group[slot - 1];
      if (item) {
        tbody.classList.remove(RPT_SLOT_HIDDEN_CLASS);
        spec.fillClump(tbody, item, units);
      } else {
        tbody.classList.add(RPT_SLOT_HIDDEN_CLASS);   // fewer than clumpsPerPage real items left, last sheet only
      }
    }

    frag.appendChild(page);
  }
  anchor.after(frag);
}

/** Fills one 8-wide size block (blockNum 1 = sizes 0-7, 2 = sizes 8-15) within an
 *  already-existing clump slot: sets .textContent on each size-column cell that maps to a
 *  real selected size, hides any past however many sizes the item actually has (fewer than
 *  16 selected). The column-cell class is the ONLY thing that differs between standards'
 *  templates, so it's a parameter — the fill logic is identical and standard-agnostic.
 *  Never creates/removes a row or cell.
 *  @param {HTMLElement} tbody @param {1|2} blockNum @param {*} item
 *  @param {string} sizeColClass  size-column cell class this standard's template uses (e.g. "b2-size-col") */
function fillSizeBlock(tbody, blockNum, item, sizeColClass) {
  const startIdx = (blockNum - 1) * 8;
  const sizeCount = item.sizeLabels.length;

  /** @param {string} field @param {Array<*>} source @param {(v:*) => string} format */
  function fillBlockRow(field, source, format) {
    const tr = tbody.querySelector('tr[data-block="' + blockNum + '"][data-field="' + field + '"]');
    if (!tr) return;
    tr.querySelectorAll("." + sizeColClass).forEach((cell, i) => {
      const idx = startIdx + i;
      if (idx < sizeCount) {
        const v = source[idx];
        cell.textContent = (v === null || v === undefined) ? "" : format(v);
        cell.classList.remove(RPT_SLOT_HIDDEN_CLASS);
      } else {
        cell.textContent = "";
        cell.classList.add(RPT_SLOT_HIDDEN_CLASS);
      }
    });
  }

  fillBlockRow("size", item.sizeLabels, (l) => l);
  fillBlockRow("upstream", item.upstream, fmtCount);
  fillBlockRow("downstream", item.downstream, fmtCount);
  fillBlockRow("efficiency", item.efficiency, (v) => formatNumber(v, 1));
}
//#endregion

//#region Table B.2 (ISO 4548-12 repeatable per-bucket pages)
/* fillTableB2Pages: Table B.2's repeatable per-bucket sheets. The page mechanism lives in
   fillRepeatablePages (above, standard-agnostic); this only names Table B.2's own
   template/anchor/data (#b2PageTemplate + #b2PagesAnchor + the "bucketsB2" extra, all in
   iso454812_page2.html) and its per-clump fill (fillB2Clump). Each clump's 16 sizes render
   as TWO 8-wide blocks, not one 16-wide row: high dust-load tests produce counts in the
   millions, which don't fit legibly in a 1/16th-width column. */
// Back to 5 (was 4; originally 6, then an earlier 5 attempt overflowed and it was
// dropped to 4 for margin — see CHANGELOG). Revisited now that each page's shape is
// fully static (see iso454812_page2.html's own header comment): a real byte-count
// against the CURRENT print sizing (8.5px font, 1px 4px cell padding, 7px spacer,
// per-clump ~130px: meta row ~15px + 8 data rows ~107px + spacer ~8px) gives
// 5 clumps + the page header (h1 + 2 field-rows, ~53px) ~= 702px against the ~864px
// (9in) usable page — ~162px (~19%) of real margin, not just barely fitting. That's
// a notably bigger cushion than similar hand-counts elsewhere in this file have had
// when they turned out right, but this exact count (5, at THIS exact CSS) was never
// itself real-print-tested before — the ORIGINAL "5 overflowed" failure may well
// have been at different sizing that was later tightened for "4," not this config.
// Needs a real print to confirm before trusting it as hard as the current 4 is.
/** @type {number} */
const CLUMPS_PER_PAGE = 5;

// Blank placeholder, shaped exactly like a real bucket (see fillB2Clump/fillSizeBlock)
// but with every value null/blank — used only when there are no real buckets yet (no
// file loaded), so Table B.2's shape (16 size columns, both blocks) stays inspectable.
// See fillRepeatablePages' RepeatablePageSpec.placeholderItem note on why this is its
// own copy here rather than built generically.
const B2_PLACEHOLDER_ITEM = {
  dpAtEnd: null, elapsedMin: null,
  sizeLabels: Array(16).fill(""), upstream: Array(16).fill(null),
  downstream: Array(16).fill(null), efficiency: Array(16).fill(null)
};

/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillTableB2Pages(root, store, units) {
  fillRepeatablePages(root, store, units, {
    templateId: "#b2PageTemplate",
    anchorId: "#b2PagesAnchor",
    generatedClass: "b2-generated",
    extraKey: "bucketsB2",
    clumpsPerPage: CLUMPS_PER_PAGE,
    fillClump: fillB2Clump,
    placeholderItem: B2_PLACEHOLDER_ITEM
  });
}

/** @param {HTMLElement} tbody @param {*} bucket @param {"SI"|"US"} units */
function fillB2Clump(tbody, bucket, units) {
  const dpText = bucket.dpAtEnd === null || bucket.dpAtEnd === undefined
    ? ""
    : formatNumber(toDisplayValue(bucket.dpAtEnd, "kPa", units), 1);

  // Elapsed time is the clump's LAST minute, not its duration — the minute count
  // was confusing to show and isn't asked for anywhere.
  tbody.querySelector('[data-field="time"]').textContent = formatHoursMinutesSeconds(bucket.elapsedMin);
  tbody.querySelector('[data-field="dpUnit"]').textContent = units === "SI" ? "kPa" : "PSI";
  tbody.querySelector('[data-field="dp"]').textContent = dpText;

  fillSizeBlock(tbody, 1, bucket, "b2-size-col");
  fillSizeBlock(tbody, 2, bucket, "b2-size-col");
}

/** @param {number|null} v @returns {string} */
function fmtCount(v) {
  return v === null || v === undefined ? "" : formatNumber(v, 1);
}

/* formatHoursMinutes (H:MM, rounding to the nearest whole minute) replaced by this —
   a 37.55-minute bucket end printed as "0:38", a real precision loss for anyone
   cross-checking a clump's elapsed time against the raw data, not just cosmetic
   rounding. bucket.elapsedMin was itself derived from a whole-second value
   (dataFile.js rounds every timestamp to a whole second — see CLAUDE.md), so
   multiplying back by 60 and rounding ONCE here recovers that exact original integer
   rather than compounding a second rounding step on top of the first. */
/** @param {number|null} totalMinutes @returns {string} "H:MM:SS" */
function formatHoursMinutesSeconds(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || !isFinite(totalMinutes)) return "";
  const totalSeconds = Math.round(totalMinutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}
//#endregion

//#region ISO 19438 repeatable per-window pages ("Presentation of Test Results")
/* fillTable19438Pages: ISO 19438's per-window sheets. Shares the page mechanism with
   Table B.2 via fillRepeatablePages (see that region) — pagination is standard-agnostic —
   but keeps its OWN fillClump (fill19438Clump), because the CONTENT genuinely differs, not
   just the data: decimal-minute elapsed time ("Elapsed time: 6.00 min", not 4548-12's
   "h:mm"), an "Initial " label prefix on the first clump (the fixed E6 window — see
   iso19438Analysis.js/iso19438Mapper.js), a taller spacer after it, and UPSTREAM/
   DOWNSTREAM/EFFICIENCY row labels matching the user's outline (4548-12 uses Title Case).
   That content stays per-standard (CLAUDE.md); only the scaffold is shared. The
   #w19438PageTemplate/#w19438PagesAnchor ids exist only in iso19438_page2.html, so the
   shared helper's own `if (!tmpl || !anchor) return` makes this a no-op for every other
   standard's pages. */
// Own constant, independently adjustable from ISO 4548-12's CLUMPS_PER_PAGE — 19438's
// page-2 identification header is the same size as B.2's, so the same per-page budget
// math roughly applies, but this is its own number since the two tables' row heights
// aren't identical (different label text/column count). Per the user: 5 first, adjust
// from real print feedback the same way ISO 4548-12's own constant was tuned (6 -> 5
// -> 4, each step after an actual overflow) rather than re-deriving the exact budget.
const CLUMPS_PER_PAGE_19438 = 5;

// Blank placeholder, shaped exactly like a real clump (see fill19438Clump/
// fillSizeBlock) but with every value null/blank — used only when there are no real
// clumps yet (no file loaded), so the page's shape (16 size columns, both blocks)
// stays inspectable. Own copy, independent of B2_PLACEHOLDER_ITEM — see
// fillRepeatablePages' RepeatablePageSpec.placeholderItem note.
const W19438_PLACEHOLDER_ITEM = {
  dpAtEnd: null, elapsedMin: null, isInitial: false,
  sizeLabels: Array(16).fill(""), upstream: Array(16).fill(null),
  downstream: Array(16).fill(null), efficiency: Array(16).fill(null)
};

/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillTable19438Pages(root, store, units) {
  fillRepeatablePages(root, store, units, {
    templateId: "#w19438PageTemplate",
    anchorId: "#w19438PagesAnchor",
    generatedClass: "w19438-generated",
    extraKey: "clumps19438",
    clumpsPerPage: CLUMPS_PER_PAGE_19438,
    fillClump: fill19438Clump,
    placeholderItem: W19438_PLACEHOLDER_ITEM
  });
}

/** @param {HTMLElement} tbody @param {*} clump @param {"SI"|"US"} units */
function fill19438Clump(tbody, clump, units) {
  const dpText = clump.dpAtEnd === null || clump.dpAtEnd === undefined
    ? "" : formatNumber(toDisplayValue(clump.dpAtEnd, "kPa", units), 1);

  tbody.querySelector('[data-field="label"]').textContent = clump.isInitial ? "Initial Filtration efficiency" : "Filtration efficiency";
  tbody.querySelector('[data-field="time"]').textContent = formatHoursMinutesSeconds(clump.elapsedMin);
  tbody.querySelector('[data-field="dpUnit"]').textContent = units === "SI" ? "kPa" : "PSI";
  tbody.querySelector('[data-field="dp"]').textContent = dpText;

  fillSizeBlock(tbody, 1, clump, "w19438-size-col");
  fillSizeBlock(tbody, 2, clump, "w19438-size-col");

  // Extra-tall spacer specifically after the Initial clump — it's a different KIND
  // of result (the fixed E6 window, not one of the regular bucketed windows that
  // follow), so it reads better set visually apart from the run of ordinary clumps
  // rather than blending into them with the same thin gap every other pair gets.
  // Toggled (not just added once) since a slot can be re-filled with a DIFFERENT
  // clump across re-renders (unit toggle) as display-size selection changes.
  tbody.querySelector(".b2-spacer").classList.toggle("w19438-spacer-after-initial", !!clump.isInitial);
}
//#endregion

//#region ISO 16889:2022 Page 2 (particle counts / filtration ratio)
/* fillTable16889Page2: the table's full shape — 34 rows x 18 columns (2 label + all
   16 possible display sizes) — is already in iso16889_page2.html, present before
   this ever runs. This function only ever sets .textContent on a .w16889-size-col
   cell that already exists and toggles RPT_SLOT_HIDDEN_CLASS on any size column
   past however many are actually selected (never creates/removes a node) — see
   that template's own header comment for why (5 real-print round trips fighting a
   table that had no real shape to tune against, before this rewrite).

   Each row's 16 .w16889-size-col cells are filled BY POSITION (document order),
   matching the same index into resolvedDisplaySizes/clump arrays every row uses —
   no per-cell id needed, since the template always lists them left-to-right in
   that same order. */
/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillTable16889Page2(root, store, units) {
  const table = root.querySelector(".w16889-p2-table");
  if (!table) return;

  const sizes = store.getExtra("resolvedDisplaySizes") || [];

  // No sizes resolved yet (no file loaded) — show every column's shape rather than
  // collapsing all 16 of them; there's nothing to fill in that state (no size means
  // no value to show), so every cell just stays visible and blank, same "shape
  // visible, no fabricated data" rule the repeatable pages/report figures use.
  const noSizesYet = sizes.length === 0;

  /** @param {NodeListOf<Element>|Element[]} cells @param {Array<string|number>|null} values
   *  @param {(v:string|number) => string} format */
  function fillCells(cells, values, format) {
    cells.forEach((cell, i) => {
      if (noSizesYet || i < sizes.length) {
        const v = (noSizesYet || !values) ? null : values[i];
        cell.textContent = (v === null || v === undefined) ? "" : format(v);
        cell.classList.remove(RPT_SLOT_HIDDEN_CLASS);
      } else {
        cell.textContent = "";
        cell.classList.add(RPT_SLOT_HIDDEN_CLASS);
      }
    });
  }

  fillCells(table.querySelectorAll(".w16889-p2-header .w16889-size-col"), sizes, (size) => ">" + size + " µm(c)");

  /** @param {string} rowKey @param {Array<number|null>|null} values */
  function fillRow(rowKey, values) {
    const tr = table.querySelector('tr[data-row="' + rowKey + '"]');
    if (!tr) return;
    fillCells(tr.querySelectorAll(".w16889-size-col"), values, (v) => formatSignificant(v, 3));
  }

  // Initial: upstream-only per-size counts from the last minute of flushing before
  // dust injection (one row directly, no Up/Down/ß split, matching the reference
  // table's own single "Initial" row of raw values) — see iso16889Analysis.js's
  // _computeInitialCleanliness for the real .DAT source (confirmed 2026-08-06) and
  // iso16889Mapper.js for the fixedSizes alignment. Blank (not "0"/"--"), same
  // fillRow convention every other cell on this page already uses, whenever the
  // file has no matching-sensor block for this — genuinely missing, not zero.
  fillRow("initial", store.getExtra("initialUpstream16889"));

  // A clump with no valid reporting-time window (its [start,end) falls entirely
  // within the mandatory first-3-minutes disregard period — always possible on a
  // short test's 10% clump, sometimes 20%) has avgUp/avgDown/avgBeta all null by
  // construction (iso16889Analysis.js's findRowRange returns [null,null] for an
  // inverted/empty range, and every downstream average/overall-average step is
  // gated on that null check) — fillRow already renders that as a blank cell, not
  // "0" or garbage, matching the reference table's own blank first-clump row.
  const clumps = store.getExtra("clumps16889") || [];
  for (const clump of clumps) {
    fillRow(clump.percent + "-up", clump.avgUp);
    fillRow(clump.percent + "-down", clump.avgDown);
    fillRow(clump.percent + "-beta", clump.avgBeta);
  }

  const overall = store.getExtra("overallCounts16889") || { avgUp: [], avgDown: [], avgBeta: [] };
  fillRow("avg-up", overall.avgUp);
  fillRow("avg-down", overall.avgDown);
  fillRow("avg-beta", overall.avgBeta);
}
//#endregion

//#region ISO 23369:2022 Page 2 (particle counts / filtration ratio)
/* fillTable23369Page2: own copy of fillTable16889Page2's shape, per CLAUDE.md — this
   standard's own outline states Page 2 "directly mirrors ISO 16889's page 2," so the
   template (iso23369_page2.html) is a literal structural copy (own .w23369-* class
   names/data-row keys to avoid any CSS-selector collision with ISO 16889's own page),
   filled the same fully-static, fill-by-position way (never creates/removes a node).

   No "initial" row data exists for this standard in this build (see
   iso23369Mapper.js's own comment — not asked for by this standard's own Page 1
   field list, no aux-block precedent checked yet) — fillRow("initial", undefined)
   below still renders the row's cells blank via the same "genuinely missing, not
   zero" convention every other not-yet-available cell on this page already uses;
   the row stays structurally present (a true mirror of ISO 16889's own layout). */
/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillTable23369Page2(root, store, units) {
  const table = root.querySelector(".w23369-p2-table");
  if (!table) return;

  const sizes = store.getExtra("resolvedDisplaySizes") || [];
  const noSizesYet = sizes.length === 0;

  /** @param {NodeListOf<Element>|Element[]} cells @param {Array<string|number>|null} values
   *  @param {(v:string|number) => string} format */
  function fillCells(cells, values, format) {
    cells.forEach((cell, i) => {
      if (noSizesYet || i < sizes.length) {
        const v = (noSizesYet || !values) ? null : values[i];
        cell.textContent = (v === null || v === undefined) ? "" : format(v);
        cell.classList.remove(RPT_SLOT_HIDDEN_CLASS);
      } else {
        cell.textContent = "";
        cell.classList.add(RPT_SLOT_HIDDEN_CLASS);
      }
    });
  }

  fillCells(table.querySelectorAll(".w23369-p2-header .w23369-size-col"), sizes, (size) => ">" + size + " µm(c)");

  /** @param {string} rowKey @param {Array<number|null>|null} values */
  function fillRow(rowKey, values) {
    const tr = table.querySelector('tr[data-row="' + rowKey + '"]');
    if (!tr) return;
    fillCells(tr.querySelectorAll(".w23369-size-col"), values, (v) => formatSignificant(v, 3));
  }

  fillRow("initial", store.getExtra("initialUpstream23369"));

  const clumps = store.getExtra("clumps23369") || [];
  for (const clump of clumps) {
    fillRow(clump.percent + "-up", clump.avgUp);
    fillRow(clump.percent + "-down", clump.avgDown);
    fillRow(clump.percent + "-ratio", clump.avgRatio);
  }

  const overall = store.getExtra("overallCounts23369") || { avgUp: [], avgDown: [], avgRatio: [] };
  fillRow("avg-up", overall.avgUp);
  fillRow("avg-down", overall.avgDown);
  fillRow("avg-ratio", overall.avgRatio);
}
//#endregion

/* fillIso3968AverageDpTables: ONE merged table, row i = the assembly's i-th measured
   point — see iso3968_page2.html's own header note for why this is a static 40-row
   table, not fillRepeatablePages (a CLOSED set of 4 known row counts, not an
   unbounded one), and why there's no second tare table anymore (per the user,
   2026-08-03: "Filter housing" IS the tare values, shown as extra columns on the
   assembly's own row, not a separate table).

   Everything here is computed LIVE from store.getExtra("sourceAnalysis")/
   ("sourceTareAnalysis") + qR (filterRatedFlowRate — pure hand-entry, NO fallback;
   an earlier "max configured flow = 120% of qR" assumption was removed per the user)
   — not pre-computed by iso3968Mapper.js, since a HAND OVERRIDE of qR must still flow
   through to Flow Ratio; this function re-runs on every render (including after a qR
   edit), same as fillSlots itself. The curve-fit values (assemblyFitDP/housingFitDP/
   elementDP) are computed once per Iso3968Analysis.run() call (see
   iso3968Analysis.js's _computeNetDP) and just read here. */
// The row count is a CLOSED set of 4 known values — 6/12/20/40 (discrete, discrete+
// reverse, continuous, continuous+reverse — see iso3968_page2.html's own header note
// and iso3968Analysis.selfcheck.js's "discrete file: exactly 6 points" assertion) —
// so 6 is the guaranteed MINIMUM for any real test, never fewer. The no-file
// placeholder below shows that many blank rows, not just one, so the table's shape
// isn't understated.
const ISO3968_MIN_ROWS = 6;

/** @param {HTMLElement} root @param {import("./reportValueStore.js").ReportValueStore} store @param {"SI"|"US"} units */
function fillIso3968AverageDpTables(root, store, units) {
  const rows = root.querySelectorAll('#pqAverageDpRows > tr[data-row-slot]');
  if (rows.length === 0) return;   // not the ISO 3968 template

  const qRRaw = store.get("filterRatedFlowRate");
  const qR = (qRRaw !== null && qRRaw !== undefined && qRRaw !== "" && isFinite(parseFloat(qRRaw))) ? parseFloat(qRRaw) : null;

  const analysis = store.getExtra("sourceAnalysis");
  const points = (analysis && analysis.ok) ? analysis.points : [];
  const tareAnalysis = store.getExtra("sourceTareAnalysis");
  const tarePoints = (tareAnalysis && tareAnalysis.ok) ? tareAnalysis.points : [];

  const toDisp = (v) => formatNumber(toDisplayValue(v, "kPa", units), 1);

  rows.forEach((tr, i) => {
    const point = points[i];
    if (!point) {
      // No real points at all (no file loaded) — still show the guaranteed-minimum
      // ISO3968_MIN_ROWS rows in their full blank shape (every column present, just
      // empty) rather than hiding the whole table. A real file with fewer than 40
      // points still hides every row past its actual count, unchanged.
      const showBlankPlaceholder = points.length === 0 && i < ISO3968_MIN_ROWS;
      tr.classList.toggle(RPT_SLOT_HIDDEN_CLASS, !showBlankPlaceholder);
      if (showBlankPlaceholder) tr.querySelectorAll("[data-field]").forEach(cell => { cell.textContent = ""; });
      return;
    }
    tr.classList.remove(RPT_SLOT_HIDDEN_CLASS);

    const set = (field, text) => {
      const cell = tr.querySelector('[data-field="' + field + '"]');
      if (cell) cell.textContent = text;
    };

    set("flow", formatNumber(point.flowRate, 2));

    // Flow Ratio is shown as a PERCENTAGE of qR (per the user, 2026-08-03) — blank
    // (not "0%") unless the user has actually hand-entered qR, per the user's
    // instruction that we not assume it from anywhere else.
    const ratioPct = (qR && qR > 0) ? (point.flowRate / qR) * 100 : null;
    set("ratio", ratioPct === null ? "" : ratioPct.toFixed(1) + "%");

    set("assembly", toDisp(point.dp));
    set("assemblyFit", point.assemblyFitDP === null || point.assemblyFitDP === undefined ? "" : toDisp(point.assemblyFitDP));

    const tarePoint = tarePoints[i];
    set("housing", tarePoint ? toDisp(tarePoint.dp) : "");
    set("housingFit", point.housingFitDP === null || point.housingFitDP === undefined ? "" : toDisp(point.housingFitDP));
    set("element", point.elementDP === null || point.elementDP === undefined ? "" : toDisp(point.elementDP));
  });
}
//#endregion

//#region unit-aware field helpers (used by app.js's editable-field handler)
/* Reads the current display value of a unit-bearing field, and converts a typed
   replacement back to canonical before it's stored — used by the double-click
   override handler in app.js so a user editing while viewing PSI doesn't
   accidentally get their number stored (and later re-displayed) as if it were kPa. */
/** @param {import("./reportValueStore.js").ReportValueStore} store @param {string} id @param {"SI"|"US"} units @returns {string} */
export function currentDisplayValue(store, id, units) {
  const raw = store.get(id);
  const canonicalUnit = store.getUnit(id);
  if (!canonicalUnit) return raw ?? "";
  return formatNumber(toDisplayValue(raw, canonicalUnit, units), 1);
}

/** @param {import("./reportValueStore.js").ReportValueStore} store @param {string} id
 *  @param {string} typedValue @param {"SI"|"US"} units @returns {*} */
export function toStorableValue(store, id, typedValue, units) {
  const canonicalUnit = store.getUnit(id);
  if (!canonicalUnit) return typedValue;
  return toCanonicalValue(typedValue, canonicalUnit, units);
}

//#endregion

//#region DOM helper
/** @param {string} tag @param {Object<string,string>} attrs @param {...(Node|string)} children @returns {HTMLElement} */
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}
//#endregion

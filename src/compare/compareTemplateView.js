/* =====================================================================================
   compareTemplateView.js
   =====================================================================================
   Renders the Compare Files "report builder": a template manager (new/duplicate/
   rename/delete/select, mirroring customTabsView.js's dialog shape one level up), a
   toggle palette built from whatever channels/sizes/standard-curves the loaded file
   set actually has (replacing the old radio+dropdown single-chart picker), and a
   paginated, print-ready preview of the active template's pages (2-or-4-plot grids,
   mirroring the single-file Report view's `.report-page` / page-break convention).

   This file owns NO mutation logic of its own — every add/remove/rename/reorder goes
   through the injected `callbacks`, which app.js executes against the
   CompareTemplateRegistry (and, for standard-derived plots, each standard's own
   run()/applyMapper() — see app.js's runStandardCurve) and then re-renders. Same
   "dumb view, callbacks own the mutation" split compareView.js already uses for
   CompareFileSet.
   ===================================================================================== */
import { specsMatch } from "./compareTemplates.js";
import { buildComparisonChannelDataset, buildComparisonSizeDataset, buildComparisonStandardCurveDataset, buildComparisonMassDataset, comparisonSensorOptions, MASS_ADDED_CHANNEL_TAG, MASS_ADDED_LABEL } from "../core/charts/chartData.js";
import { renderComparisonChart, destroyChartsIn } from "../core/charts/chartView.js";
import { getAxisOverride, buildAxisControls } from "../core/charts/chartAxisControls.js";

const MAX_SIZES = 3;

/** Real channel tags display as themselves; the one synthetic "channel" (mass
 *  added) gets its own readable label instead of its internal tag string.
 *  @param {string} tag @returns {string} */
function channelDisplayLabel(tag) {
  return tag === MASS_ADDED_CHANNEL_TAG ? MASS_ADDED_LABEL : tag;
}

/**
 * @param {HTMLElement} container
 * @param {Array<{id:string,df:DataFile,label:string}>} files fileSet.list()
 * @param {{channels:Array,lbSizes:Array,lsSizes:Array,fileCount:number}} dims commonDimensions(fileSet)
 * @param {import("./compareTemplates.js").CompareTemplateRegistry} templateRegistry
 * @param {string|null} activeTemplateId
 * @param {Object} callbacks see this file's header comment
 */
export function renderCompareReport(container, files, dims, templateRegistry, activeTemplateId, callbacks) {
  destroyChartsIn(container);
  container.innerHTML = "";

  const templates = templateRegistry.list();
  container.appendChild(buildTemplateManagerBar(templates, activeTemplateId, callbacks));

  const active = templates.find(t => t.id === activeTemplateId);
  // Channels live here — not as a second, separate list further down — so the
  // "what channels do these files share" readout IS the toggle control once a
  // template exists, rather than one static summary plus a duplicate interactive
  // one underneath it. LB/LS sizes stay plain tags here too (their own interactive
  // picker below needs an explicit multi-select-then-commit step anyway — see
  // buildTogglePalette — so showing them twice reads less redundant than channels did).
  container.appendChild(buildDimensionSummary(dims, active, callbacks));

  if (!active) {
    container.appendChild(el("div", { class: "hint-box" },
      templates.length === 0
        ? "No comparison templates yet — click “+ New template” to start building one."
        : "Pick a template above to build or view its pages."));
    return;
  }

  container.appendChild(buildTogglePalette(active, files, dims, callbacks));
  container.appendChild(buildPagesPreview(active, files, callbacks));
}

//#region dimension summary (channels are clickable once a template is active)
function buildDimensionSummary(dims, template, callbacks) {
  function sizeTagList(entries, unit) {
    if (!entries.length) return el("span", { class: "dim-empty" }, "none");
    return el("span", {}, ...entries.map(e =>
      el("span", { class: "dim-tag" + (e.count < dims.fileCount ? " dim-partial" : "") },
        e.key + (unit || "") + " (" + e.count + "/" + dims.fileCount + ")", " ")));
  }

  function channelTagList() {
    if (!dims.channels.length) return el("span", { class: "dim-empty" }, "none");
    if (!template) {
      return el("span", {}, ...dims.channels.map(c =>
        el("span", { class: "dim-tag" + (c.count < dims.fileCount ? " dim-partial" : "") },
          channelDisplayLabel(c.key) + " (" + c.count + "/" + dims.fileCount + ")", " ")));
    }
    const flatPlots = template.pages.flatMap(p => p.plots);
    return el("span", {}, ...dims.channels.map(c => {
      const spec = { kind: "channel", channelTag: c.key };
      const on = flatPlots.some(p => specsMatch(p, spec));
      const btn = el("button", {
        class: "dim-tag toggle-chip" + (on ? " on" : "") + (c.count < dims.fileCount ? " dim-partial" : ""),
        title: (on ? "Remove from" : "Add to") + " \"" + template.title + "\"",
        onclick: () => {
          if (on) {
            const existing = flatPlots.find(p => specsMatch(p, spec));
            callbacks.onRemovePlot(template.id, existing.id);
          } else {
            callbacks.onAddPlot(template.id, spec);
          }
        }
      }, channelDisplayLabel(c.key) + " (" + c.count + "/" + dims.fileCount + ")");
      return btn;
    }));
  }

  return el("div", { class: "dim-summary" },
    el("div", {}, el("strong", {}, "Channels: "), channelTagList()),
    el("div", {}, el("strong", {}, "LB sizes: "), sizeTagList(dims.lbSizes, "µm")),
    el("div", {}, el("strong", {}, "LS sizes: "), sizeTagList(dims.lsSizes, "µm")),
    el("div", { class: "footer-note" },
      "Faded tags aren't present in every loaded file — you can still plot them; files missing that dimension will be named, not silently dropped." +
      (template ? " Click a channel to add/remove its plot." : "")));
}
//#endregion

//#region template manager bar
function buildTemplateManagerBar(templates, activeTemplateId, callbacks) {
  const active = templates.find(t => t.id === activeTemplateId);

  const select = el("select", {
    onchange: (e) => callbacks.onSelectTemplate(e.target.value)
  }, ...templates.map(t => {
    const opt = el("option", { value: t.id }, t.title);
    if (t.id === activeTemplateId) opt.selected = true;
    return opt;
  }));
  select.disabled = templates.length === 0;

  const newBtn = el("button", {
    class: "act primary",
    onclick: () => {
      const title = prompt("New template name:", "Untitled template");
      if (title) callbacks.onNewTemplate(title.trim() || "Untitled template", "2up");
    }
  }, "+ New template");

  const dupBtn = el("button", {
    class: "act",
    onclick: () => {
      if (!active) return;
      const title = prompt("Duplicate as:", active.title + " copy");
      if (title) callbacks.onDuplicateTemplate(active.id, title.trim() || (active.title + " copy"));
    }
  }, "Duplicate");

  const renameBtn = el("button", {
    class: "act",
    onclick: () => {
      if (!active) return;
      const title = prompt("Rename template:", active.title);
      if (title) callbacks.onRenameTemplate(active.id, title.trim() || active.title);
    }
  }, "Rename");

  const deleteBtn = el("button", {
    class: "act",
    onclick: () => { if (active) callbacks.onDeleteTemplate(active.id); }
  }, "Delete");

  [dupBtn, renameBtn, deleteBtn].forEach(b => { b.disabled = !active; });

  const defaultModeSelect = el("select", {
    title: "Page mode used when a new page is auto-created",
    onchange: (e) => { if (active) callbacks.onSetDefaultPageMode(active.id, e.target.value); }
  },
    el("option", { value: "2up" }, "2 plots/page"),
    el("option", { value: "4up" }, "4 plots/page"));
  if (active) defaultModeSelect.value = active.defaultPageMode;
  defaultModeSelect.disabled = !active;

  return el("div", { class: "compare-template-bar" },
    el("span", { class: "count" }, "Template:"), select,
    newBtn, dupBtn, renameBtn, deleteBtn,
    el("span", { class: "count" }, "New pages:"), defaultModeSelect);
}
//#endregion

//#region toggle palette
/* Channels are NOT rendered here — they're the dim-summary's own tags, made
   clickable (see buildDimensionSummary) — one list, not two. This function only
   covers what genuinely needs its own dedicated picker UI: particle sizes (a
   multi-select-then-commit group, up to MAX_SIZES) and standard-derived curves. */
function buildTogglePalette(template, files, dims, callbacks) {
  const flatPlots = template.pages.flatMap(p => p.plots);
  const has = (spec) => flatPlots.some(p => specsMatch(p, spec));

  //#region particle sizes — multi-select-then-commit, combined onto one plot (up to MAX_SIZES)
  // Only offer a sensor if the loaded files actually have that pool of sizes —
  // e.g. no point listing "LS Up/Down Counts" when every loaded file's LS sizes
  // list is empty; that sensor would just show an unchecked, permanently-empty box.
  const sensorOptions = comparisonSensorOptions().filter(s =>
    ((s.key === "lsu" || s.key === "lsd") ? dims.lsSizes : dims.lbSizes).length > 0);

  let sizesSection;
  if (sensorOptions.length === 0) {
    sizesSection = [el("div", { class: "dim-empty" }, "none of the loaded files have any particle-size data")];
  } else {
    const sensorSelect = el("select", { class: "size-sensor-select" }, ...sensorOptions.map(s => el("option", { value: s.key }, s.label)));
    const sizeListEl = el("div", { class: "chk-list" });

    function currentSizePool() {
      const key = sensorSelect.value;
      return (key === "lsu" || key === "lsd") ? dims.lsSizes : dims.lbSizes;
    }
    function enforceMaxSizes() {
      const boxes = [...sizeListEl.querySelectorAll('input[type="checkbox"]')];
      const checkedCount = boxes.filter(b => b.checked).length;
      boxes.forEach(b => { if (!b.checked) b.disabled = checkedCount >= MAX_SIZES; });
    }
    function rebuildSizeCheckboxes() {
      sizeListEl.innerHTML = "";
      currentSizePool().forEach(s => {
        const box = el("input", { type: "checkbox", value: s.key, onchange: enforceMaxSizes });
        sizeListEl.appendChild(el("label", { class: "chk-row" }, box, " " + s.key + " µm (" + s.count + "/" + dims.fileCount + ")"));
      });
    }
    sensorSelect.addEventListener("change", rebuildSizeCheckboxes);
    rebuildSizeCheckboxes();

    const addSizesBtn = el("button", {
      class: "act",
      onclick: () => {
        const picked = [...sizeListEl.querySelectorAll('input[type="checkbox"]:checked')].map(b => b.value);
        if (picked.length === 0) return;
        const added = callbacks.onAddPlot(template.id, { kind: "sizes", sensorKey: sensorSelect.value, sizes: picked });
        if (added !== false) {
          sizeListEl.querySelectorAll('input[type="checkbox"]').forEach(b => { b.checked = false; b.disabled = false; });
        }
      }
    }, "+ Add sizes plot");

    const existingSizePlots = flatPlots.filter(p => p.kind === "sizes").map(p =>
      el("span", { class: "chip" }, p.sensorKey.toUpperCase() + ": " + p.sizes.join(", ") + " µm",
        el("button", { class: "chip-remove", title: "Remove this plot", onclick: () => callbacks.onRemovePlot(template.id, p.id) }, "×")));

    sizesSection = [
      el("div", { class: "mode-row" }, sensorSelect, addSizesBtn),
      sizeListEl,
      existingSizePlots.length ? el("div", { class: "toggle-row" }, ...existingSizePlots) : null
    ];
  }
  //#endregion

  //#region standard-derived plots — instant toggle. standardId/sensor/size here are a
  // TRANSIENT "what to add next" picker (app.js's compareCurvePickerStandard/Sensor/
  // Size), NOT stored on the template — per the user, a template can hold curves from
  // several different standards (or the same standard at more than one sensor) side
  // by side, so there's no single "the" standard for a template to remember.
  const standardOptions = callbacks.standardCurveOptions || [];
  const pickerStandardId = callbacks.pickerStandard;
  // standardOptions is one entry PER CURVE now (a standard with several curves —
  // e.g. ISO 16889's four — contributes several rows, see app.js's
  // compareStandardCurveOptions), so the STANDARD picker itself needs its own
  // dedup pass — mapping every row straight to an <option> (the old, one-curve-per-
  // standard-era code) produced one duplicate "ISO 16889:2022" option per curve,
  // all setting the exact same pickerStandardId, which is why they looked like
  // separate entries that all "revealed the same options" once clicked.
  const uniqueStandards = [];
  const seenStandardIds = new Set();
  for (const s of standardOptions) {
    if (seenStandardIds.has(s.id)) continue;
    seenStandardIds.add(s.id);
    uniqueStandards.push(s);
  }
  const standardSelect = el("select", { class: "standard-select", onchange: (e) => callbacks.onSetStandard(e.target.value || null) },
    el("option", { value: "" }, "— none —"),
    ...uniqueStandards.map(s => el("option", { value: s.id }, s.standardLabel)));
  standardSelect.value = pickerStandardId || "";

  const df0 = files.length ? files[0].df : null;
  const pickerSensors = (pickerStandardId && df0) ? callbacks.availableSensorsFor(pickerStandardId, df0) : [];
  const pickerSensor = callbacks.pickerSensor || (pickerSensors[0] && pickerSensors[0].key) || null;
  const standardSensorSelect = el("select", { class: "standard-sensor-select", onchange: (e) => callbacks.onSetStandardSensor(e.target.value) },
    ...pickerSensors.map(s => el("option", { value: s.key }, s.label)));
  if (pickerSensors.length) standardSensorSelect.value = pickerSensor || pickerSensors[0].key;
  standardSensorSelect.style.display = pickerStandardId ? "" : "none";
  standardSensorSelect.disabled = pickerSensors.length === 0;
  // A standard's curves are "sensor-ready" once EITHER it needs no sensor at all
  // (ISO 3968's P-Q curve — pickerSensors is empty, pickerSensor stays null forever)
  // OR one's actually been picked. The old version of this gate required a truthy
  // pickerSensor unconditionally, which silently locked out any curve from a
  // sensor-less standard — real bug, found while wiring ISO 3968's P-Q curve in.
  const sensorReady = pickerSensors.length === 0 || !!pickerSensor;

  // Multi-series curves (one line per particle size — e.g. ISO 16889's β vs. %
  // test time / vs. element ΔP) need ONE size picked before they mean anything —
  // same "pick a size, one line per file" shape the particle-sizes picker above
  // already uses. Pool follows the currently picked sensor (LSU/LSD -> LS sizes,
  // else LB sizes), same convention as the particle-sizes section's own
  // currentSizePool(). Shown only when the current standard actually has a
  // multiSize curve — no dead-end control for standards that don't.
  const curvesForStandard = standardOptions.filter(s => s.id === pickerStandardId);
  const standardNeedsSize = curvesForStandard.some(s => s.multiSize);
  const sizePool = (pickerSensor === "lsu" || pickerSensor === "lsd") ? dims.lsSizes : dims.lbSizes;
  const pickerSize = callbacks.pickerSize || null;
  const standardSizeSelect = el("select", { class: "standard-size-select", onchange: (e) => callbacks.onSetStandardSize(e.target.value || null) },
    el("option", { value: "" }, "— pick a size —"),
    ...sizePool.map(s => el("option", { value: s.key }, s.key + " µm")));
  standardSizeSelect.value = pickerSize || "";
  standardSizeSelect.style.display = (pickerStandardId && standardNeedsSize) ? "" : "none";

  const curveChips = pickerStandardId
    ? curvesForStandard.map(s => {
        const sizeReady = !s.multiSize || !!pickerSize;
        const ready = sensorReady && sizeReady;
        const spec = { kind: "standardPlot", standardId: pickerStandardId, sensor: pickerSensor, plotId: s.curveId, size: s.multiSize ? pickerSize : undefined };
        const on = ready ? has(spec) : false;
        const btn = el("button", {
          class: "toggle-chip" + (on ? " on" : ""),
          onclick: () => {
            if (!ready) return;
            if (on) {
              const existing = flatPlots.find(p => specsMatch(p, spec));
              callbacks.onRemovePlot(template.id, existing.id);
            } else {
              callbacks.onAddPlot(template.id, spec);
            }
          }
        }, s.standardLabel + " — " + s.curveLabel +
           (pickerSensor ? " (" + pickerSensor.toUpperCase() + ")" : "") +
           (s.multiSize && pickerSize ? " @ " + pickerSize + "µm" : ""));
        btn.disabled = !ready;
        return btn;
      })
    : [];
  //#endregion

  return el("div", { class: "compare-picker" },
    el("h3", {}, "Particle sizes"),
    ...sizesSection,

    el("h3", {}, "Standard-derived plots"),
    el("div", { class: "mode-row" }, standardSelect, standardSensorSelect, standardSizeSelect),
    (pickerStandardId && standardNeedsSize && !pickerSize) ? el("div", { class: "dim-empty" }, "this standard has at least one plot that draws one line per particle size (e.g. β vs. % test time) — pick a size above to enable it; its other plots below don't need one") : null,
    pickerStandardId ? el("div", { class: "toggle-row" }, ...curveChips) : el("div", { class: "dim-empty" }, "pick a standard above to plot its own curves (e.g. β vs. size) — you can add plots from more than one standard to the same template"));
}
//#endregion

//#region paginated preview
/** PLOT_HEIGHT_IN: own copy of reportView.js's print-figure-sizing idea (see that
 *  file's computePrintFigureSizePx) — a DIFFERENT document from the single-file
 *  report, so its own constants, not shared (per CLAUDE.md's report-content rule).
 *  "2up" reuses the exact numbers already proven for iso454812's stacked-figure
 *  pages (2 full-width figures, ~3.85in tall each); "4up" is a new 2x2 grid, each
 *  cell roughly half that height. Tune against a real print preview — see the plan's
 *  Verification note; this codebase has never gotten chart print-sizing right on the
 *  first guess. */
const PRINT_DPI = 96;
const PAGE_MARGIN_IN = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };
const PAPER_WIDTH_IN = { letter: 8.5, a4: 8.27 };
const CHART_WRAP_PADDING_PX = 10;
const PLOT_HEIGHT_IN = { "2up": 3.85, "4up": 1.85 };
const GRID_COLS = { "2up": 1, "4up": 2 };

/** @param {"letter"|"a4"} paperSize @param {"2up"|"4up"} mode @returns {{width:number,height:number}} */
function computePrintPlotSizePx(paperSize, mode) {
  const usableWidthIn = (PAPER_WIDTH_IN[paperSize] || PAPER_WIDTH_IN.letter) - PAGE_MARGIN_IN.left - PAGE_MARGIN_IN.right;
  const widthIn = usableWidthIn / GRID_COLS[mode];
  return {
    width: Math.round(widthIn * PRINT_DPI - CHART_WRAP_PADDING_PX * 2),
    height: Math.round(PLOT_HEIGHT_IN[mode] * PRINT_DPI - CHART_WRAP_PADDING_PX * 2)
  };
}

function plotTitle(spec, standardOptions) {
  if (spec.kind === "channel") return channelDisplayLabel(spec.channelTag);
  if (spec.kind === "sizes") return spec.sensorKey.toUpperCase() + ": " + spec.sizes.join(", ") + " µm";
  // standardId+curveId together — "effVsSize" alone is ambiguous between
  // iso454812/iso19438 now that a template can hold curves from several standards.
  const opt = (standardOptions || []).find(s => s.id === spec.standardId && s.curveId === spec.plotId);
  const label = opt ? (opt.standardLabel + " — " + opt.curveLabel) : spec.plotId;
  return label + (spec.sensor ? " (" + spec.sensor.toUpperCase() + ")" : "") + (spec.size ? " @ " + spec.size + "µm" : "");
}

/** Resolves one PlotSpec against the loaded file set into the {datasets,missing,...}
 *  shape renderComparisonChart already draws. standardPlot specs run each file's own
 *  standard analysis via the injected callback (app.js) — see this file's header
 *  comment on why that logic doesn't live here. Each spec carries its OWN
 *  standardId/sensor now (see compareTemplates.js's header note), so this needs no
 *  template-level standard/sensor to resolve against. */
function resolveDataset(spec, files, callbacks) {
  if (spec.kind === "channel") {
    if (spec.channelTag === MASS_ADDED_CHANNEL_TAG) return buildComparisonMassDataset(files);
    return buildComparisonChannelDataset(files, spec.channelTag);
  }
  if (spec.kind === "sizes") return buildComparisonSizeDataset(files, spec.sensorKey, spec.sizes);

  // standardPlot
  const opt = (callbacks.standardCurveOptions || []).find(s => s.id === spec.standardId && s.curveId === spec.plotId);
  const curveLabel = opt ? (opt.standardLabel + " — " + opt.curveLabel) : spec.plotId;
  const perFileCurves = files.map(entry => ({
    label: entry.label,
    curve: callbacks.runStandardCurve(spec.standardId, spec.sensor, entry.df, spec.plotId, spec.size)
  }));
  return buildComparisonStandardCurveDataset(perFileCurves, curveLabel, opt ? opt.yAxisLabel : "Value", opt ? opt.xAxisLabel : undefined);
}

function buildPagesPreview(template, files, callbacks) {
  if (template.pages.length === 0) {
    return el("div", { class: "hint-box" }, "Toggle a channel, size group, or standard curve above to start filling pages.");
  }

  const pageEls = template.pages.map(page => {
    const modeSelect = el("select", {
      title: "This page's plot grid",
      onchange: (e) => callbacks.onSetPageMode(template.id, page.id, e.target.value)
    },
      el("option", { value: "2up" }, "2-up"),
      el("option", { value: "4up" }, "4-up"));
    modeSelect.value = page.mode;

    const grid = el("div", { class: "compare-plot-grid mode-" + page.mode });

    for (const spec of page.plots) {
      const result = resolveDataset(spec, files, callbacks);
      const canvas = el("canvas", {});
      const chartWrap = el("div", { class: "chart-wrap" }, canvas);

      const warn = (!result || result.datasets.length === 0)
        ? el("div", { class: "warnings" }, "⚠ " + (result && result.missing && result.missing.length
            ? "Not present in: " + result.missing.join(", ")
            : "No data to plot."))
        : (result.missing && result.missing.length
            ? el("div", { class: "warnings" }, "⚠ Not present in: " + result.missing.join(", ") + " (plotting the rest)")
            : null);

      const box = el("div", { class: "compare-plot-box" },
        el("div", { class: "compare-plot-title" },
          plotTitle(spec, callbacks.standardCurveOptions),
          el("button", { class: "chip-remove", title: "Remove this plot", onclick: () => callbacks.onRemovePlot(template.id, spec.id) }, "×")),
        warn,
        chartWrap);
      grid.appendChild(box);

      if (result && result.datasets.length > 0) {
        const chartId = "template:" + template.id + ":" + spec.id;
        renderComparisonChart(canvas, result, getAxisOverride(chartId));
        const { button, panel } = buildAxisControls(chartId, canvas, (override) => renderComparisonChart(canvas, result, override));
        chartWrap.appendChild(button);
        box.appendChild(panel);
        // Stashed for redrawComparePlots (print) — see that function's own note on
        // why print must redraw onto this EXACT existing canvas, not a freshly
        // rebuilt one.
        canvas._compareChartRedraw = (printPaperSize) => {
          const printSizePx = printPaperSize ? computePrintPlotSizePx(printPaperSize, page.mode) : null;
          renderComparisonChart(canvas, result, getAxisOverride(chartId), printSizePx);
        };
      }
    }

    return el("div", { class: "compare-report-page" },
      el("div", { class: "compare-page-tools" }, modeSelect),
      grid);
  });

  return el("div", { class: "compare-pages" }, ...pageEls);
}

/* redrawComparePlots: the narrow, print-triggered redraw — redraws EVERY already-
   rendered comparison chart onto its EXISTING <canvas>, exactly reportView.js's
   redrawReportCharts's own approach (touch the canvases already in the DOM, don't
   rebuild the page around them). This matters more than it looks: the old
   print path called the FULL renderCompareReport (destroy everything, rebuild the
   whole template/palette/pages DOM, including brand-new <canvas> elements) from
   inside the beforeprint handler itself — meaning every chart Chromium's print
   pipeline had to rasterize was on a canvas that had NEVER been laid out or painted
   before that same synchronous handler ran. The single-file report never has this
   problem: its canvases are part of the static page template and already exist
   (already laid out, already painted at least once on screen) well before
   beforeprint ever fires; redrawReportCharts only ever re-draws INTO them. This
   function gives Compare the same property — call it instead of rebuilding
   anything for the print path.
   @param {HTMLElement} container @param {"letter"|"a4"} [paperSize] */
export function redrawComparePlots(container, paperSize) {
  container.querySelectorAll(".compare-plot-box canvas").forEach(canvas => {
    if (canvas._compareChartRedraw) canvas._compareChartRedraw(paperSize);
  });
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

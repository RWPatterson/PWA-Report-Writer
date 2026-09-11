/* =====================================================================================
   chartView.js
   =====================================================================================
   Draws a {datasets} object (see chartData.js — each series is a {x, y} point array,
   a genuine linear time/size axis, not a category scale) onto a <canvas> using
   Chart.js. Chart.js is loaded as a classic <script> in index.html (window.Chart),
   same pattern as DataFile/Iso16889Analysis — see the note there on why.

   NOTE FOR THE EVENTUAL SINGLE-FILE BUNDLE: Chart.js is currently loaded from a CDN
   (cdnjs) for development convenience. That will NOT work on an offline customer
   machine. When building the offline bundle, vendor the actual chart.umd.min.js file
   into the project and inline/concatenate it like everything else — do not ship a CDN
   <script> tag in the offline build.
   ===================================================================================== */
import { toDisplayValue, displayUnit } from "../../helpers/units.js";

//#region color
/* Golden-angle hue cycling: any number of series gets visually distinct colors without
   needing a fixed palette table sized for a guessed maximum channel count. */
/** @param {number} i @returns {string} an hsl() color string */
function colorForIndex(i) {
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 70%, 45%)`;
}
//#endregion

//#region axis override
/* axisMinMax: builds a Chart.js scale-config fragment ({min, max}) from a user's axis
   override (see chartAxisControls.js) — only the bounds actually present are included,
   so an axis with no override falls through to whatever that scale would otherwise
   resolve to (Chart.js auto-scale here; a computed standard-defined default in the
   report-figure functions below, which fold overrides into their own locals instead
   of using this helper — see their notes). */
/** @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null|undefined} override @param {"x"|"y"} axis @returns {{min?:number,max?:number}} */
function axisMinMax(override, axis) {
  if (!override) return {};
  const out = {};
  const min = override[axis + "Min"];
  const max = override[axis + "Max"];
  if (min !== undefined) out.min = min;
  if (max !== undefined) out.max = max;
  return out;
}
//#endregion

//#region chart instance lifecycle
/* Chart instances are tracked ON THEIR OWN CANVAS ELEMENT (canvasEl._chartInstance),
   not in a single shared variable. With multiple custom plot tabs — each with its own
   canvas — a single "the current chart" variable would destroy the wrong instance
   when switching between tabs. Chart.js registers a window resize listener per
   instance that isn't cleaned up automatically, so an un-destroyed instance whose
   canvas gets removed from the DOM (a tab switch, a new file loaded) leaks that
   listener — destroyChart / destroyChartsIn exist so callers can clean up before
   removing chart-bearing content from the page. */

/** @param {HTMLCanvasElement} canvasEl */
export function destroyChart(canvasEl) {
  if (canvasEl && canvasEl._chartInstance) {
    canvasEl._chartInstance.destroy();
    canvasEl._chartInstance = null;
  }
}

/** Destroys every chart instance found on any `<canvas>` inside `container`.
 *  @param {HTMLElement} container */
export function destroyChartsIn(container) {
  if (!container) return;
  container.querySelectorAll("canvas").forEach(destroyChart);
}
//#endregion

//#region single-file chart
/** @param {HTMLCanvasElement} canvasEl @param {import("./chartData.js").ChartDataset|null} chartData
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride] see chartAxisControls.js
 *  @returns {*|null} the Chart.js instance, or null if chartData was empty */
export function renderChart(canvasEl, chartData, axisOverride) {
  destroyChart(canvasEl);
  if (!chartData) return null;

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      datasets: chartData.datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,   // {x: minutes, y: value} points — see chartData.js's toPoints
        borderColor: colorForIndex(i),
        backgroundColor: colorForIndex(i),
        borderWidth: 1.5,
        pointRadius: 0,       // hundreds of points per series — points would just be noise
        spanGaps: true,
        tension: 0.1
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,       // up to 32+ series — skip animation, redraw stays snappy
      parsing: false,         // data is already {x, y} — skip Chart.js re-parsing it
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: true, text: chartData.title },
        legend: {
          display: true,
          position: "right",
          labels: { boxWidth: 12, font: { size: 10 } },
          // Click-to-toggle is Chart.js's default legend behavior — exactly what's
          // needed for picking one channel out of 32 overlaid lines.
        }
      },
      scales: {
        x: { type: "linear", title: { display: true, text: "Elapsed time (min)" }, ...axisMinMax(axisOverride, "x") },
        y: { title: { display: true, text: chartData.yAxisLabel }, ...axisMinMax(axisOverride, "y") }
      }
    }
  });

  canvasEl._chartInstance = chart;
  return chart;
}
//#endregion

//#region cross-file comparison chart
/* renderComparisonChart: draws cross-file comparison data (see chartData.js's
   buildComparisonChannelDataset/buildComparisonSizeDataset) — each series carries its
   own {x, y} points rather than sharing one labels array, so the x scale has to be
   genuinely numeric/linear, not the categorical axis renderChart uses. Kept as a
   separate function rather than a branch in renderChart because the Chart.js config
   differs enough (scale type, tooltip point format) that merging them would make
   both harder to read for no real benefit — same "different problem, different
   function" call made elsewhere in this project (see units.js vs machineProfile.js). */
/** Own copy of renderDPFigureChart's FIGURE_ASPECT_RATIO idea, own value — a SAFETY
 *  NET for when explicitSizePx is in play (print), not the normal sizing path: with
 *  maintainAspectRatio:false, Chart.js fills whatever it measures for the canvas's
 *  container at CONSTRUCTION time, before the explicit chart.resize() below ever
 *  runs — and if that measurement lands on a zero/unresolved height (e.g. print
 *  layout hasn't settled yet at the exact synchronous moment this runs, the same
 *  "measuring a print-styled container from JS turned out not to be reliable" issue
 *  documented above), Chart.js's own default 2:1 fallback produces a squashed
 *  initial paint. A comparison box is roughly twice as wide as tall at both this
 *  file's 2up/4up print sizes (see compareTemplateView.js's computePrintPlotSizePx),
 *  so this fallback already lands close to correct even in the worst case, same
 *  reasoning FIGURE_ASPECT_RATIO documents for the single-file report's own figures. */
const COMPARISON_ASPECT_RATIO = 1.9;

/** @param {HTMLCanvasElement} canvasEl @param {import("./chartData.js").ComparisonDataset|null} comparisonData
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride] see chartAxisControls.js
 *  @param {{width:number,height:number}} [explicitSizePx] print-time explicit sizing — same idiom as the
 *    report-figure functions below (see renderDPFigureChart's jsdoc); omitted for the normal on-screen
 *    responsive:true auto-measuring every existing caller (custom tabs, today's Compare picker) already relies on
 *  @returns {*|null} the Chart.js instance, or null if there was nothing to plot */
export function renderComparisonChart(canvasEl, comparisonData, axisOverride, explicitSizePx) {
  destroyChart(canvasEl);
  if (!comparisonData || comparisonData.datasets.length === 0) return null;

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      datasets: comparisonData.datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: colorForIndex(i),
        backgroundColor: colorForIndex(i),
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
        tension: 0.1
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...(explicitSizePx ? { aspectRatio: COMPARISON_ASPECT_RATIO } : {}),
      animation: false,
      parsing: false,   // data is already {x, y} — skip Chart.js re-parsing it
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: true, text: comparisonData.title },
        legend: { display: true, position: "right", labels: { boxWidth: 12, font: { size: 10 } } }
      },
      scales: {
        x: { type: "linear", title: { display: true, text: comparisonData.xAxisLabel }, ...axisMinMax(axisOverride, "x") },
        y: { title: { display: true, text: comparisonData.yAxisLabel }, ...axisMinMax(axisOverride, "y") }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}
//#endregion

//#region report figures (ISO 4548-12's Figure B.1/B.2/B.3)
/* Both figures below plot exactly ONE line/series each — the outline's second axis on
   each (top X = contaminant added in grams, right Y = net ΔP %) is NOT a second data
   series, just an alternate, exactly-proportional reading of the same one line. Per
   the report writer's own request: rather than compute the second axis's values
   independently (risking them drifting out of alignment with the first), the second
   axis is given the SAME numeric domain as the first (same min/max) and only its tick
   LABELS are recomputed via a callback — so a tick on the top axis sits at the exact
   same pixel column as the time value it corresponds to on the bottom axis, and
   likewise for the right/left ΔP-vs-% pair. This only works because both relationships
   are linear (constant injection rate assumed for grams; %net ΔP is linear in ΔP by
   definition) — a non-linear secondary axis would need real independent scaling. */

/* FIGURE_ASPECT_RATIO is a SAFETY NET, not the normal sizing path: with
   maintainAspectRatio:false the chart fills its container's real height whenever
   Chart.js can measure one. But if it's ever built while its container has no
   resolved height (e.g. measured a hair too early in the print reflow, or while the
   report view is momentarily display:none), Chart.js falls back to aspectRatio — and
   the DEFAULT fallback is 2:1 (short/wide), which is exactly the "figures print half
   the page" failure we hit. Forcing a tall fallback ratio means even the worst-case
   mis-measure still produces a page-filling figure, not a squashed one. */
/** @type {number} width:height — tall, matches a full-page figure box */
const FIGURE_ASPECT_RATIO = 0.85;

/** ISO 19438's Figure B.2 right-axis tick set, rightAxisMode:"even" — confirmed with
 *  the user: every 10%, -10 through 110 inclusive (13 ticks). See renderDPFigureChart's
 *  pctToKpa for how each percent maps to an actual kPa position. */
const EVEN_RIGHT_AXIS_PERCENTS = [-10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];

/* PLACEHOLDER axis domains, used ONLY when a report figure has no real data yet
   (no file loaded, or — for a couple of figures — real data that just hasn't
   reached the point a given series depends on, e.g. no gravimetric entry yet).
   Every value below is an arbitrary round number picked purely so the axes/
   gridlines/labels are legible to inspect — NONE of it is derived from any
   standard's clause or any real test, unlike the fixed bounds already used
   elsewhere in this file (BETA_CHART_MAX, EFF_LOG_PENETRATION_MIN/MAX). Real data
   always overrides these; see each render*FigureChart's own `hasData` branch. */
const DP_FIGURE_PLACEHOLDER_X_MAX = 60;      // minutes
const DP_FIGURE_PLACEHOLDER_Y_MAX = 100;     // kPa, pre-display-unit-conversion
const MASS_PRESSURE_PLACEHOLDER_X_MAX = 100; // grams
const MASS_PRESSURE_PLACEHOLDER_Y_MAX = 100; // kPa, pre-display-unit-conversion
const PQ_PLACEHOLDER_X_MAX = 100;            // L/min
const PQ_PLACEHOLDER_Y_MAX = 100;            // kPa, pre-display-unit-conversion
const COUNTS_PLACEHOLDER_X_MAX = 60;         // minutes
// Shared by B.2/B.3/C.3's particle-size X axis — generic chart-axis convenience,
// not a standard's decision (contrast BETA_CHART_MAX, which IS one and stays its
// own copy per figure) — legitimate to share as plain drawing machinery.
const PARTICLE_SIZE_PLACEHOLDER_MIN = 1;     // µm(c)
const PARTICLE_SIZE_PLACEHOLDER_MAX = 40;    // µm(c)
const BETA_VS_PRESSURE_PLACEHOLDER_MIN = 1;   // kPa, log axis
const BETA_VS_PRESSURE_PLACEHOLDER_MAX = 1000; // kPa, log axis

/**
 * @typedef {Object} NetDPMilestone
 * @property {number} percent
 * @property {number|null} assyDP kPa value this % net-ΔP milestone was reached at
 *
 * @typedef {Object} DPFigureData
 * @property {Array<{minutes:number,dp:number}>} points
 * @property {number} terminationMinutes
 * @property {number|null} terminationDP
 * @property {number|null} injectedMassTotal
 * @property {NetDPMilestone[]} netDPMilestones
 * @property {number|null} [cleanAssemblyDP] kPa — only needed by rightAxisMode:"even" (ISO 19438), to
 *   compute the %-net-ΔP -> kPa mapping for arbitrary percents rather than 7 fixed milestone points
 */

/* renderDPFigureChart: Figure B.1 (ISO 4548-12) / Figure B.2 (ISO 19438) —
   Differential Pressure vs. Time. terminationDP/injectedMassTotal/netDPMilestones
   may be null/empty (not every file has a computed injected mass yet, see
   iso454812Analysis.js) — the corresponding secondary axis just shows no ticks
   rather than failing to render the primary line.

   The left (ΔP) axis's min/max come from the ACTUAL data range (see yMin/dataMax
   above) — NOT pinned to a fixed 0 floor. An earlier version forced the left axis
   to always start at 0, per the user's own specific direction for ISO 4548-12's
   Figure B.1 at the time; the same assumption was never given for ISO 19438's
   Figure B.2, and per the user, forcing it there produced a worse-looking chart than
   just auto-scaling from the data — so this no longer assumes 0 has to be shown for
   EITHER standard's DP figure. rightAxisMode:"even" (ISO 19438) still computes its
   own explicit range from the %-net-ΔP -10/110 bounds regardless (see pctToKpa
   above), unaffected by this change either way. The right (% net ΔP) axis (
   "milestones" mode, ISO 4548-12) shows ONLY its 7 defined milestone ticks
   (5/10/15/20/40/80/100%,
   analysis.netDPMilestones — the exact same rows as Page 1's %-net-ΔP table), and
   THOSE 7 lines are the chart's only horizontal gridlines; the left axis gets short
   border tick marks (no ruled lines) at its own evenly-spaced values, so the grid
   reads unambiguously as "% of net ΔP rise," not a second, denser kPa grid
   competing with it.

   The 7 milestones are all labeled now (an earlier version skipped labels that
   landed within 5% of each other, because several cluster near the DP knee). With
   the figures now getting a full page each — see the templates / app.css — the axis
   is tall enough that even the clustered milestones (76.8-101.6 kPa on this file)
   have room for their own labels, so nothing is dropped. */
/** @param {HTMLCanvasElement} canvasEl @param {DPFigureData|null} data @param {"SI"|"US"} [units]
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride] see chartAxisControls.js —
 *    folded into the same locals both the primary (x/y) and secondary (x2/y2) scales derive from, so the two stay in sync
 *  @param {{width:number,height:number}} [explicitSizePx] see this file's "explicit print sizing" note below renderEfficiencyFigureChart
 *  @param {"milestones"|"even"} [rightAxisMode] "milestones" (default) snaps the right axis's ticks to the
 *    7 standard %-net-ΔP milestone points (ISO 4548-12's Figure B.1) — "even" (ISO 19438's Figure B.2) instead
 *    shows plain, evenly-spaced ticks from -10% to 110% every 10%, computed from cleanAssemblyDP/terminationDP
 *    rather than snapped to the 7-milestone list. Both modes share every other piece of this chart (primary
 *    axis, x2 contaminant-mass axis, data conversion) — this is generic parameterization of a shared chart-
 *    drawing helper, not a standard's-own-decision procedure living in the wrong place (see CLAUDE.md).
 *  @returns {*|null} */
export function renderDPFigureChart(canvasEl, data, units, axisOverride, explicitSizePx, rightAxisMode) {
  destroyChart(canvasEl);
  const hasData = !!(data && data.points && data.points.length > 0);

  // All ΔP figures arrive from the analysis engine canonically in kPa (see
  // iso454812Analysis.js) — converted here, at the point of use, to whatever system
  // the toggle is set to, the same "convert at the edges" rule units.js documents for
  // every other report field. Both the left (ΔP) and right (Net ΔP %) axes share one
  // numeric domain (see the file-top note on why), so the milestones' assyDP values
  // must be converted too, not just the plotted points — otherwise the right axis's
  // ticks would land at the OLD kPa positions against a rescaled left axis.
  const dpUnit = displayUnit("kPa", units);
  const toDisp = (v) => toDisplayValue(v, "kPa", units);

  let convertedPoints, injectedMassTotal, trueXMax, yMin, yMax, milestones, y2Ticks;

  if (hasData) {
    let terminationMinutes, terminationDP, netDPMilestones, cleanAssemblyDP;
    ({ terminationMinutes, terminationDP, injectedMassTotal, netDPMilestones, cleanAssemblyDP } = data);
    convertedPoints = data.points.map(p => ({ minutes: p.minutes, dp: toDisp(p.dp) }));
    // yMin/dataMax computed from the ACTUAL data range, not assumed — per the user, a
    // fixed 0-floor was specific advice for ISO 4548-12's Figure B.1, never given for
    // ISO 19438's Figure B.2, and in practice ISO 19438's own axis (its "even" branch
    // below, unaffected by this) already reads better without one. Reduce, not
    // Math.min/max(...array) — this can be a large array (long multipass tests),
    // spreading it risks a call-stack blowup Math.min/max(...) has no protection against.
    const firstDp = convertedPoints[0].dp;
    const dataMin = convertedPoints.reduce((m, p) => Math.min(m, p.dp), firstDp);
    const dataMax = convertedPoints.reduce((m, p) => Math.max(m, p.dp), firstDp);
    yMin = dataMin;
    const terminationDPDisp = (terminationDP === null || terminationDP === undefined) ? null : toDisp(terminationDP);
    yMax = terminationDPDisp === null ? dataMax : terminationDPDisp;
    const cleanDPDisp = (cleanAssemblyDP === null || cleanAssemblyDP === undefined) ? null : toDisp(cleanAssemblyDP);
    // pctToKpa: the same %-net-ΔP -> kPa mapping the milestone list itself is built
    // from (cleanAssemblyDP + pct/100 * (terminalDP - cleanAssemblyDP)), exposed here
    // as a function of arbitrary percent rather than only the 7 fixed milestones, so
    // rightAxisMode:"even" can place ticks at any percent, not just those 7.
    const pctToKpa = (pct) => (cleanDPDisp === null || terminationDPDisp === null)
      ? null : cleanDPDisp + (pct / 100) * (terminationDPDisp - cleanDPDisp);
    // "even" mode's whole point is showing -10% through 110% — the default 0-to-
    // terminalDP left-axis range (right for "milestones" mode, whose 0%/100% ARE 0/
    // terminalDP) would clip those two ends off-chart, so widen the default domain to
    // match before axisOverride (below) gets its usual final say.
    if (rightAxisMode === "even" && cleanDPDisp !== null && terminationDPDisp !== null) {
      yMin = pctToKpa(-10);
      yMax = pctToKpa(110);
    }
    // trueXMax is the test's actual end time — kept separate from xMax (below) because
    // the x2 axis's "contaminant added (g)" ticks are a proportion of the WHOLE test's
    // injected mass, computed against the real test duration. If a user overrides xMax
    // to crop/zoom the visible window, that proportion must still be figured against the
    // true duration, not the cropped one, or the gram values on a zoomed-in view would
    // be wrong (too large).
    trueXMax = terminationMinutes || (data.points[data.points.length - 1].minutes || 1);
    milestones = (netDPMilestones || [])
      .filter(m => m.assyDP !== null)
      .map(m => ({ percent: m.percent, assyDP: toDisp(m.assyDP) }));
    // y2Ticks: the right axis's tick set, in the SAME {percent, assyDP} shape either
    // way, so the afterBuildTicks/callback pair below doesn't need its own branch —
    // only which list feeds them differs by rightAxisMode.
    y2Ticks = rightAxisMode === "even"
      ? EVEN_RIGHT_AXIS_PERCENTS
          .map(percent => ({ percent, assyDP: pctToKpa(percent) }))
          .filter(t => t.assyDP !== null)
      : milestones;
  } else {
    // See the PLACEHOLDER axis domain note above EVEN_RIGHT_AXIS_PERCENTS — arbitrary,
    // just for legible axes with no real test to derive a range from.
    convertedPoints = [];
    injectedMassTotal = null;
    yMin = 0;
    yMax = toDisp(DP_FIGURE_PLACEHOLDER_Y_MAX);
    trueXMax = DP_FIGURE_PLACEHOLDER_X_MAX;
    milestones = [];
    // "even" mode's ticks are pure percent-of-[-10,110]-range positions against
    // whatever the y domain is — reproduces the same values real data would give
    // (see pctToKpa above: both are the unique line through the -10%/110% endpoints),
    // so this reads as a genuine (if placeholder) right axis, not a fabricated one.
    y2Ticks = rightAxisMode === "even"
      ? EVEN_RIGHT_AXIS_PERCENTS.map(percent => ({ percent, assyDP: yMin + ((percent + 10) / 120) * (yMax - yMin) }))
      : [];
  }

  let xMin = 0;
  let xMax = trueXMax;
  if (axisOverride) {
    if (axisOverride.xMin !== undefined) xMin = axisOverride.xMin;
    if (axisOverride.xMax !== undefined) xMax = axisOverride.xMax;
    if (axisOverride.yMin !== undefined) yMin = axisOverride.yMin;
    if (axisOverride.yMax !== undefined) yMax = axisOverride.yMax;
  }

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      datasets: [{
        label: "Differential Pressure",
        data: convertedPoints.map(p => ({ x: p.minutes, y: p.dp })),
        borderColor: "hsl(210, 70%, 45%)",
        backgroundColor: "hsl(210, 70%, 45%)",
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
        tension: 0.1,
        xAxisID: "x",
        yAxisID: "y"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: false },   // caption rendered as HTML below the chart instead — see the templates
        legend: { display: false }
      },
      scales: {
        x: {
          type: "linear", position: "bottom", min: xMin, max: xMax,
          title: { display: true, text: "Test time (minutes)" }
        },
        x2: {
          type: "linear", position: "top", min: xMin, max: xMax,
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Contaminant added (g)" },
          ticks: {
            callback: (value) => (injectedMassTotal === null || injectedMassTotal === undefined || !trueXMax)
              ? "" : ((value / trueXMax) * injectedMassTotal).toFixed(1)
          }
        },
        y: {
          type: "linear", position: "left", min: yMin, max: yMax,
          grid: { drawOnChartArea: false, drawTicks: true, tickLength: 6 },
          title: { display: true, text: "Differential Pressure (" + dpUnit + ")" }
        },
        y2: {
          type: "linear", position: "right", min: yMin, max: yMax,
          grid: { drawOnChartArea: true, drawTicks: true, color: "rgba(0,0,0,0.15)" },
          title: { display: true, text: "Net ΔP (Percentage)" },
          // Fixes the tick POSITIONS to exactly y2Ticks' values, now in whatever
          // unit the chart itself is displaying (not Chart.js's own auto-generated
          // "nice number" ticks) — afterBuildTicks is the documented way to override
          // a linear axis's computed tick set. "milestones" mode: every one of the 7
          // gets its own label, the full-page-tall axis has room for all of them.
          // "even" mode: 13 plain ticks, -10% to 110% every 10%.
          afterBuildTicks: (axis) => {
            axis.ticks = y2Ticks.map(t => ({ value: t.assyDP }));
          },
          ticks: {
            font: { size: 11 },
            callback: (value) => {
              const match = y2Ticks.find(t => Math.abs(t.assyDP - value) < 1e-6);
              return match ? match.percent + "%" : "";
            }
          }
        }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}

// B.3's log-scale Y axis, in penetration terms (100 - efficiency%): the boundary
// values the axis is deliberately built around (0/90/99/99.9% efficiency <->
// 100/10/1/0.1% penetration), each pair one decade apart so each of the three
// resulting bands gets equal vertical space. See EFF_LOG_PENETRATION_MAX's note.
const EFF_LOG_PENETRATION_TICKS = [0.1, 1, 10, 100];
// Fixed top of scale at 99.9% efficiency (penetration 0.1) — a reading above 99.9%
// clips off the top of the chart, same as any today's linear chart's values already
// clip at their axis bounds. Not data-driven: the whole point is a stable, always-
// three-equal-bands reference a reader can learn once, not a scale that reshuffles
// its own bands file to file.
const EFF_LOG_PENETRATION_MIN = 0.1;
const EFF_LOG_PENETRATION_MAX = 100;

/* renderEfficiencyFigureChart: Figures B.2 (linear) and B.3 (log scale) — overall
   efficiency vs. particle size, same {sizes, overall} data either way (the
   "effChart" store extra set by iso454812Mapper.js), only the Y scale differs.

   B.3's log scale plots log(100 - efficiency) — PENETRATION, not efficiency itself —
   reversed so the axis still reads bottom-to-top as increasing efficiency. Log of
   efficiency directly (an earlier version of this chart) compresses the high-
   efficiency end into a sliver at the top, the opposite of the intent; log of
   penetration does the reverse, since log spreads out values approaching zero. The
   result: each 10x reduction in penetration (100/10/1/0.1, i.e. 0/90/99/99.9%
   efficiency) gets an equal band of vertical space — three even bands: 0-90%,
   90-99%, 99-99.9%. Penetration = 0 (an exact 100% efficiency reading) can't sit on
   a log axis, so — same as an earlier version dropped 0%-efficiency points for the
   old log(efficiency) axis — this drops 100%-efficiency points instead. */
/* Explicit print sizing (explicitSizePx, both figure functions): responsive:true
   normally measures the canvas's own container and fills it — the right approach for
   the on-screen view, which genuinely does need to adapt to whatever size the report
   panel happens to be. For PRINT specifically, that measurement turned out to be
   unreliable in practice (figures kept rendering short no matter what CSS height was
   specified — retried at several different heights with no visible change, which
   ruled out simple mistuning) — measuring a print-styled container's real size from
   JS at the right moment is a genuinely hard cross-browser timing problem, and this
   project already tried the standard fixes for it (beforeprint + matchMedia + a
   requestAnimationFrame delay, see app.js's redrawForPrint) without it actually
   resolving. Rather than keep chasing that timing race, explicitSizePx sidesteps
   measurement entirely for print: reportView.js computes the intended pixel size
   directly from the SAME constants app.css's print rules use (paper size, @page
   margins, the figure's own CSS height) — no DOM measurement involved — and
   chart.resize(width, height) is called directly with that known-correct value right
   after construction, overriding whatever responsive:true's own measurement decided.
   Screen rendering (explicitSizePx omitted) is completely unaffected. */
/** @param {HTMLCanvasElement} canvasEl @param {{sizes:Array<string|number>,overall:Array<number|null>}|undefined} data
 *  @param {{logScale?:boolean}} [options]
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride] see chartAxisControls.js —
 *    the log-scale (B.3) Y axis is a fixed standard-defined band and is NOT overridable, only its X axis is;
 *    the linear (B.2) chart takes both X and Y like everything else
 *  @param {{width:number,height:number}} [explicitSizePx] see the note above this function
 *  @returns {*|null} */
export function renderEfficiencyFigureChart(canvasEl, data, options, axisOverride, explicitSizePx) {
  destroyChart(canvasEl);
  const hasData = !!(data && data.sizes && data.sizes.length > 0);
  const sizes = hasData ? data.sizes : [];
  const overall = hasData ? data.overall : [];

  const logScale = !!(options && options.logScale);
  const points = sizes
    .map((size, i) => ({ x: Number(size), eff: overall[i] }))
    .filter(p => p.eff !== null && p.eff !== undefined && isFinite(p.eff))
    .map(p => ({ x: p.x, y: logScale ? (100 - p.eff) : p.eff }))
    .filter(p => !logScale || p.y > 0);   // penetration = 0 (100% eff exactly) can't log-scale

  // A filter performing at (or very near) 100% across every measured size is a
  // real, valid result — it just means EVERY point gets dropped by the y>0 filter
  // above (log mode), leaving nothing to plot. That's fine, per the user — but this
  // used to `return null` right here when it happened, which skipped building a
  // chart AT ALL, so the axis itself vanished too, not just the (correctly absent)
  // line. Chart.js's own auto-scaling of an EMPTY dataset falls back to a
  // meaningless default range (min 0, max 1) rather than the real particle-size
  // domain, which reads as broken, not "100% efficient." Fix: keep building the
  // chart regardless of how many points survived, and give the X axis an EXPLICIT
  // range from the full measured size list (allSizes below), not from whatever
  // (possibly empty) points happen to remain — so the axis always shows the sizes
  // that were actually tested, whether or not any of them has a plottable point.
  // No sizes at all (no file loaded) falls back to the arbitrary PARTICLE_SIZE
  // placeholder domain (see the note above EVEN_RIGHT_AXIS_PERCENTS) — same idea,
  // one level up: an explicit range beats Chart.js's meaningless empty-data default.
  const allSizes = sizes.map(Number).filter(n => isFinite(n));
  const sizeMin = allSizes.length ? Math.min(...allSizes) : PARTICLE_SIZE_PLACEHOLDER_MIN;
  const sizeMax = allSizes.length ? Math.max(...allSizes) : PARTICLE_SIZE_PLACEHOLDER_MAX;

  // Draws the "why is this empty" explanation directly on the canvas (not an HTML
  // overlay) specifically so it also shows up in print, the same as everything else
  // on this figure — an HTML element positioned over the chart would need its own
  // separate print handling to appear on paper at all. Log-scale only: the linear
  // chart (B.2/B.1) never drops points this way (see the y>0 filter above), so an
  // empty linear chart means genuinely missing data, not "100% efficient" — a
  // different situation this message shouldn't claim. hasData is also required —
  // otherwise a genuinely no-file placeholder chart would wrongly claim "every size
  // filtered / >99.9% efficiency" instead of just showing an empty shell.
  const noPlottablePointsPlugin = {
    id: "noPlottablePointsMessage",
    afterDraw(chartInstance) {
      if (!logScale || !hasData || points.length > 0) return;
      const { ctx, chartArea } = chartInstance;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "13px ui-sans-serif, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
      ctx.fillStyle = "#5a6472";   // matches app.css's --ink-soft
      ctx.fillText("No visible plot points — every size filtered", cx, cy - 9);
      ctx.fillText(">99.9% efficiency", cx, cy + 9);
      ctx.restore();
    }
  };

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    plugins: [noPlottablePointsPlugin],
    data: {
      datasets: [{
        label: "Overall Efficiency",
        data: points,
        borderColor: "hsl(150, 60%, 35%)",
        backgroundColor: "hsl(150, 60%, 35%)",
        borderWidth: 1.5,
        pointRadius: 3,
        spanGaps: true,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,   // safety fallback only — see renderDPFigureChart's note
      animation: false,
      parsing: false,
      plugins: {
        title: { display: false },   // caption rendered as HTML below the chart instead — see the templates
        legend: { display: false },
        tooltip: logScale ? { callbacks: { label: (ctx) => "Efficiency: " + (100 - ctx.parsed.y).toFixed(2) + "%" } } : {}
      },
      scales: {
        x: { type: "linear", title: { display: true, text: "Particle size (µmC)" }, min: sizeMin, max: sizeMax, ...axisMinMax(axisOverride, "x") },
        y: logScale
          ? {
              type: "logarithmic", reverse: true,
              min: EFF_LOG_PENETRATION_MIN, max: EFF_LOG_PENETRATION_MAX,
              title: { display: true, text: "Overall efficiency (Percentage) — log scale" },
              // Fixed tick POSITIONS at exactly the three band boundaries (not
              // Chart.js's own auto-generated "nice number" ticks for a log axis,
              // which would show every 1-9x10^n) — same afterBuildTicks pattern
              // renderDPFigureChart uses for its milestone axis. Y is deliberately NOT
              // overridable here (see this function's jsdoc) — min/max stay fixed.
              afterBuildTicks: (axis) => { axis.ticks = EFF_LOG_PENETRATION_TICKS.map(v => ({ value: v })); },
              // Same "Percentage" title + "%" on every tick pattern as the DP figure's
              // right axis — one label reads its own unit rather than relying on the
              // axis title alone.
              ticks: { callback: (value) => (100 - value).toString() + "%" }
            }
          : { type: "linear", min: 0, max: 100, title: { display: true, text: "Overall efficiency (Percentage)" },
              ticks: { callback: (value) => value + "%" }, ...axisMinMax(axisOverride, "y") }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}
//#endregion

//#region report figures (ISO 16889:2022's Figures C.2/C.3/C.4/C.5)
/* None of the 4 figures below reuse renderDPFigureChart/renderEfficiencyFigureChart
   directly — both are hardcoded to exactly one data series, and C.4/C.5 need
   several (one per selected particle size). Each borrows a PATTERN from existing
   code (the report-figure sizing/print idiom from the two functions above, the
   multi-series/color-cycling plumbing from renderChart/renderComparisonChart) —
   see the plan for the full reasoning on why nothing here is a direct reuse. */

/** Standard-derived ceiling for a filtration-ratio log axis — 13.5's own stated
 *  "Overall_Average_BetaRatio = 100 000 as the highest value plotted," matching
 *  iso16889Analysis.js's own MAX_BETA_VALUE (own copy, not shared — see
 *  CLAUDE.md — this one is a chart-axis bound, that one an analysis clamp; they
 *  happen to agree because both trace to the same standard clause, not because
 *  either depends on the other). */
const BETA_CHART_MAX = 100000;

/** Chart.js's own auto-generated logarithmic ticks, over a wide range like this
 *  axis's 1-100,000, pick "nice" round numbers that aren't evenly spaced on the
 *  log scale itself (e.g. landing a 70,000 tick right under the 100,000 max) —
 *  reported directly by the user as crowded, confusing double-looking gridlines
 *  near the top. Replaces them with exactly the clean powers of ten in range
 *  (1, 10, 100, ...), evenly spaced by construction on a log axis. Reads
 *  axis.min/max (not the hardcoded module constants) so it still adapts
 *  correctly if a user's axis-editor override changes the range.
 *  @param {*} axis a Chart.js scale instance, as passed to afterBuildTicks */
function useCleanLogTicks(axis) {
  const ticks = [];
  for (let v = axis.min; v <= axis.max; v *= 10) ticks.push({ value: v });
  if (ticks.length === 0 || ticks[ticks.length - 1].value < axis.max) ticks.push({ value: axis.max });
  axis.ticks = ticks;
}

/** Figure C.2: Differential Pressure vs. contaminant injected. One series by
 *  default, both axes linear — the simplest of the 4, closest precedent
 *  renderDPFigureChart's report-figure idiom (explicitSizePx, FIGURE_ASPECT_RATIO
 *  fallback) minus its x2/y2 secondary axes (mass IS the primary x-axis here, not
 *  a secondary one; the standard doesn't ask for a right axis on this figure the
 *  way B.1/B.2 get one).
 *  data.points' `mass` is null wherever the gravimetric average needed to compute
 *  it isn't known yet (before a gravimetric entry) — those points are dropped, not
 *  plotted at x=0, and if that empties the series entirely this returns null same
 *  as a genuinely-missing-data chart would (a blank canvas until gravimetric entry
 *  is a smaller thing to explain than a fabricated x=0 pileup).
 *
 *  data.secondarySeries (optional): a SECOND line on the same axes — added for
 *  ISO 23369's own Figure C.1 (per the user, 2026-08-20: the companion file's
 *  high-flow and low-flow phase ΔP shown as two separate series, not one —
 *  otherwise the single-series version reads as whichever phase the primary
 *  file's own once-a-minute sampling happens to alias onto). Generic drawing
 *  capability only (an optional extra dataset any caller MAY supply), same
 *  parameterization pattern as renderFiltrationRatioFigureChart's own
 *  ratioLabel — absent for every existing caller (ISO 16889's Figure C.2), so
 *  their own chart is byte-for-byte unchanged. data.seriesLabel names the FIRST
 *  series when a second one is present (so two lines aren't both captioned
 *  "Differential Pressure"); defaults to that same label when absent, matching
 *  the single-series callers' existing legend-less look.
 *  @param {HTMLCanvasElement} canvasEl
 *  @param {{points:Array<{mass:number|null,dp:number}>, terminationDP:number|null,
 *    seriesLabel?:string, secondarySeries?:{label:string, points:Array<{mass:number|null,dp:number}>}}|null} data
 *  @param {"SI"|"US"} [units]
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride]
 *  @param {{width:number,height:number}} [explicitSizePx]
 *  @returns {*|null} */
export function renderMassPressureFigureChart(canvasEl, data, units, axisOverride, explicitSizePx) {
  destroyChart(canvasEl);

  const dpUnit = displayUnit("kPa", units);
  const toDisp = (v) => toDisplayValue(v, "kPa", units);
  const toPlottable = (points) => (points || [])
    .filter(p => p.mass !== null && p.mass !== undefined && isFinite(p.mass))
    .map(p => ({ x: p.mass, y: toDisp(p.dp) }));

  const plottable = toPlottable(data && data.points);
  const hasSecondary = !!(data && data.secondarySeries && data.secondarySeries.points && data.secondarySeries.points.length);
  const plottable2 = hasSecondary ? toPlottable(data.secondarySeries.points) : [];
  const allPoints = hasSecondary ? plottable.concat(plottable2) : plottable;

  // No plottable points — no file, OR a file with no gravimetric entry yet (mass is
  // null on every point until then, see this function's own jsdoc) — same "arbitrary
  // placeholder domain" fallback as every other report figure now uses, not a blank
  // canvas; a shell chart is a smaller thing to explain either way it happens.
  let yMin, yMax, xMin, xMax;
  if (allPoints.length > 0) {
    const firstDp = allPoints[0].y;
    const dataMin = allPoints.reduce((m, p) => Math.min(m, p.y), firstDp);
    const dataMax = allPoints.reduce((m, p) => Math.max(m, p.y), firstDp);
    yMin = dataMin;
    const terminationDPDisp = (data.terminationDP === null || data.terminationDP === undefined) ? null : toDisp(data.terminationDP);
    yMax = terminationDPDisp === null ? dataMax : Math.max(terminationDPDisp, dataMax);

    const firstMass = allPoints[0].x;
    xMin = 0;
    xMax = allPoints.reduce((m, p) => Math.max(m, p.x), firstMass);
  } else {
    yMin = 0;
    yMax = toDisp(MASS_PRESSURE_PLACEHOLDER_Y_MAX);
    xMin = 0;
    xMax = MASS_PRESSURE_PLACEHOLDER_X_MAX;
  }
  if (axisOverride) {
    if (axisOverride.xMin !== undefined) xMin = axisOverride.xMin;
    if (axisOverride.xMax !== undefined) xMax = axisOverride.xMax;
    if (axisOverride.yMin !== undefined) yMin = axisOverride.yMin;
    if (axisOverride.yMax !== undefined) yMax = axisOverride.yMax;
  }

  const datasets = [{
    label: (data && data.seriesLabel) || "Differential Pressure",
    data: plottable,
    borderColor: "hsl(210, 70%, 45%)",
    backgroundColor: "hsl(210, 70%, 45%)",
    borderWidth: 1.5,
    pointRadius: 0,
    spanGaps: true,
    tension: 0.1
  }];
  if (hasSecondary) {
    datasets.push({
      label: data.secondarySeries.label,
      data: plottable2,
      borderColor: "hsl(30, 80%, 50%)",
      backgroundColor: "hsl(30, 80%, 50%)",
      borderWidth: 1.5,
      pointRadius: 0,
      spanGaps: true,
      tension: 0.1
    });
  }

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: false },
        legend: { display: hasSecondary }
      },
      scales: {
        x: { type: "linear", min: xMin, max: xMax, title: { display: true, text: "Contaminant injected (g)" } },
        y: { type: "linear", min: yMin, max: yMax, title: { display: true, text: "Differential Pressure (" + dpUnit + ")" } }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}

/** ISO 3968 Figure 4: Differential pressure versus flow rate — a P-Q curve. Both
 *  axes linear, same shape as renderMassPressureFigureChart just above (copied
 *  almost verbatim per the plan — that function is already proof this file's axis
 *  code isn't hardcoded to a time X axis: its X is contaminant mass, this one's is
 *  flow rate, neither is time). No termination-DP target line (unlike that chart's
 *  terminationDP) — a P-Q sweep has no single termination point the way a
 *  time-based multipass test does; the chart is just whatever range the sweep
 *  covered. Flow rate is NOT unit-converted (this project deliberately never
 *  converts flow rates — see units.js) — only the DP (Y) axes respond to the SI/US
 *  toggle.
 *
 *  Filter Assembly Curve Fit ΔP and Filter Housing Curve Fit ΔP (when a tare is
 *  present) both plot too, as dashed lines on the SAME (left) axis as the raw
 *  measured points — per the user, 2026-08-05: the curve fits themselves need to be
 *  visible, not just the net result. Sorted by flow rate (not left in the raw
 *  points' time order) since each is a pure function of flow — a reversed sweep's
 *  raw trace legitimately draws a hysteresis loop (up then back down), but its FIT
 *  value at a given flow is single-valued, so re-sorting avoids the line
 *  retracing itself. Filter Element ΔP (net, curve-fit-based — see
 *  iso3968Analysis.js's _computeNetDP), when present on any point, plots as its OWN
 *  series on a SECOND (right) Y axis — per the user, 2026-08-03: "the differential
 *  will be plotted to the second Y axis," kept separate from the raw/left axis since
 *  the net values are typically a much smaller range than the raw assembly ΔP.
 *  Fit/net series and the second axis are each absent entirely (not drawn as an
 *  empty/zeroed series) whenever no point actually has that value yet — e.g. too
 *  few points to fit a curve, or no tare supplied.
 *  @param {HTMLCanvasElement} canvasEl
 *  @param {{points:Array<{flowRate:number, dp:number, assemblyFitDP?:(number|null), housingFitDP?:(number|null), elementDP?:(number|null)}>}|null} data
 *  @param {"SI"|"US"} [units]
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride]
 *  @param {{width:number,height:number}} [explicitSizePx]
 *  @returns {*|null} */
export function renderPQFigureChart(canvasEl, data, units, axisOverride, explicitSizePx) {
  destroyChart(canvasEl);

  const dpUnit = displayUnit("kPa", units);
  const toDisp = (v) => toDisplayValue(v, "kPa", units);
  const points = (data && data.points) ? data.points : [];

  // A fit series (function of flow only, single-valued) reads as a clean curve when
  // sorted by X — the raw series deliberately keeps file order instead (see the
  // file-top note: a reversed sweep's hysteresis loop is real, meaningful data).
  const byFlow = (a, b) => a.x - b.x;
  // isFinite(null) is true in JS (Number(null) === 0) — an explicit null/undefined
  // check comes FIRST so a not-yet-available fit value (null, e.g. no tare supplied)
  // isn't plotted as a phantom 0-ish point.
  /** @param {(p:*) => (number|null|undefined)} pick */
  const seriesFor = (pick, sorted) => {
    const pts = points
      .filter(p => p.flowRate !== null && p.flowRate !== undefined && isFinite(p.flowRate) &&
        pick(p) !== null && pick(p) !== undefined && isFinite(pick(p)))
      .map(p => ({ x: p.flowRate, y: toDisp(pick(p)) }));
    return sorted ? pts.sort(byFlow) : pts;
  };

  const plottable = seriesFor(p => p.dp, false);
  const assemblyFitPlottable = seriesFor(p => p.assemblyFitDP, true);
  const housingFitPlottable = seriesFor(p => p.housingFitDP, true);
  const netPlottable = seriesFor(p => p.elementDP, false);
  const hasNet = netPlottable.length > 0;

  // No raw measured points — no file loaded — falls back to the same arbitrary
  // placeholder domain every other report figure uses; no fit/net series exist
  // either in that case (both are derived from the same empty `points`).
  let yMin, yMax, xMin, xMax;
  if (plottable.length > 0) {
    const leftSeries = [plottable, assemblyFitPlottable, housingFitPlottable].filter(s => s.length > 0);
    const firstDp = leftSeries[0][0].y;
    yMin = leftSeries.reduce((m, s) => s.reduce((m2, p) => Math.min(m2, p.y), m), firstDp);
    yMax = leftSeries.reduce((m, s) => s.reduce((m2, p) => Math.max(m2, p.y), m), firstDp);

    const firstFlow = plottable[0].x;
    xMin = plottable.reduce((m, p) => Math.min(m, p.x), firstFlow);
    xMax = plottable.reduce((m, p) => Math.max(m, p.x), firstFlow);
  } else {
    yMin = 0;
    yMax = toDisp(PQ_PLACEHOLDER_Y_MAX);
    xMin = 0;
    xMax = PQ_PLACEHOLDER_X_MAX;
  }

  let y2Min = 0, y2Max = 0;
  if (hasNet) {
    const firstNet = netPlottable[0].y;
    y2Min = netPlottable.reduce((m, p) => Math.min(m, p.y), firstNet);
    y2Max = netPlottable.reduce((m, p) => Math.max(m, p.y), firstNet);
  }

  if (axisOverride) {
    if (axisOverride.xMin !== undefined) xMin = axisOverride.xMin;
    if (axisOverride.xMax !== undefined) xMax = axisOverride.xMax;
    if (axisOverride.yMin !== undefined) yMin = axisOverride.yMin;
    if (axisOverride.yMax !== undefined) yMax = axisOverride.yMax;
  }

  const datasets = [{
    label: "Filter Assembly ΔP (measured)",
    data: plottable,
    borderColor: "hsl(210, 70%, 45%)",
    backgroundColor: "hsl(210, 70%, 45%)",
    borderWidth: 1.5,
    pointRadius: 2,
    spanGaps: true,
    tension: 0.1,
    yAxisID: "y"
  }];
  if (assemblyFitPlottable.length > 0) {
    datasets.push({
      label: "Filter Assembly Curve Fit ΔP",
      data: assemblyFitPlottable,
      borderColor: "hsl(210, 70%, 45%)",
      backgroundColor: "hsl(210, 70%, 45%)",
      borderWidth: 1.5,
      borderDash: [6, 3],
      pointRadius: 0,
      spanGaps: true,
      tension: 0.1,
      yAxisID: "y"
    });
  }
  if (housingFitPlottable.length > 0) {
    datasets.push({
      label: "Filter Housing Curve Fit ΔP (Tare)",
      data: housingFitPlottable,
      borderColor: "hsl(160, 60%, 35%)",
      backgroundColor: "hsl(160, 60%, 35%)",
      borderWidth: 1.5,
      borderDash: [6, 3],
      pointRadius: 0,
      spanGaps: true,
      tension: 0.1,
      yAxisID: "y"
    });
  }
  if (hasNet) {
    datasets.push({
      label: "Filter Element ΔP (net)",
      data: netPlottable,
      borderColor: "hsl(25, 80%, 45%)",
      backgroundColor: "hsl(25, 80%, 45%)",
      borderWidth: 1.5,
      pointRadius: 2,
      spanGaps: true,
      tension: 0.1,
      yAxisID: "y2"
    });
  }

  const scales = {
    x: { type: "linear", min: xMin, max: xMax, title: { display: true, text: "Flow rate (L/min)" } },
    y: { type: "linear", position: "left", min: yMin, max: yMax, title: { display: true, text: "Differential Pressure (" + dpUnit + ")" } }
  };
  if (hasNet) {
    scales.y2 = {
      type: "linear", position: "right", min: y2Min, max: y2Max,
      grid: { drawOnChartArea: false },
      title: { display: true, text: "Filter Element ΔP, net (" + dpUnit + ")" }
    };
  }

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: false },
        legend: { display: true, position: "bottom" }
      },
      scales
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}

/** Figure C.3: Overall Average Filtration Ratio (β) vs. particle size, semi-log —
 *  single series. Closest precedent renderEfficiencyFigureChart's logScale branch
 *  (proves a log Y axis works for this kind of curve, and its explicit-X-domain-
 *  even-when-empty fix is worth carrying over), but beta's native 2-100,000+ range
 *  needs its own axis bounds, not 4548-12's fixed penetration band — and unlike
 *  that chart's "100% efficiency -> penetration=0 can't log-scale" case, beta is
 *  never exactly 0 here (iso16889Analysis.js clamps a zero-downstream-count window
 *  to BETA_CHART_MAX rather than letting it divide out to Infinity/0), so there's
 *  no equivalent false-emptiness to special-case with a canvas message.
 *  @param {HTMLCanvasElement} canvasEl
 *  @param {{sizes:Array<string|number>, overallBeta:Array<number|null>}|undefined} data
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride] X only — Y is a fixed standard band, same convention as B.3
 *  @param {{width:number,height:number}} [explicitSizePx]
 *  @param {string} [ratioLabel] the ratio symbol shown in the Y-axis title — defaults to
 *    ISO 16889's own "β"; a sibling standard using different terminology (e.g. ISO
 *    23369's "a") passes its own symbol here. Generic drawing machinery, per CLAUDE.md
 *    — this parameterization is what makes reuse across standards legitimate.
 *  @returns {*|null} */
export function renderFiltrationRatioFigureChart(canvasEl, data, axisOverride, explicitSizePx, ratioLabel = "β") {
  destroyChart(canvasEl);
  const sizes = (data && data.sizes) ? data.sizes : [];
  const overallBeta = (data && data.overallBeta) ? data.overallBeta : [];

  const points = sizes
    .map((size, i) => ({ x: Number(size), y: overallBeta[i] }))
    .filter(p => p.y !== null && p.y !== undefined && isFinite(p.y) && p.y > 0);

  // No sizes at all (no file loaded) falls back to the same arbitrary particle-size
  // placeholder domain renderEfficiencyFigureChart uses — see the note above
  // EVEN_RIGHT_AXIS_PERCENTS. The Y (β) axis below is already a fixed standard band,
  // independent of data, so it needs no fallback of its own.
  const allSizes = sizes.map(Number).filter(n => isFinite(n));
  const sizeMin = allSizes.length ? Math.min(...allSizes) : PARTICLE_SIZE_PLACEHOLDER_MIN;
  const sizeMax = allSizes.length ? Math.max(...allSizes) : PARTICLE_SIZE_PLACEHOLDER_MAX;

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      datasets: [{
        label: "Overall Average Filtration Ratio",
        data: points,
        borderColor: "hsl(150, 60%, 35%)",
        backgroundColor: "hsl(150, 60%, 35%)",
        borderWidth: 1.5,
        pointRadius: 3,
        spanGaps: true,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,
      animation: false,
      parsing: false,
      plugins: {
        title: { display: false },
        legend: { display: false }
      },
      scales: {
        x: { type: "linear", title: { display: true, text: "Particle size (µmC)" }, min: sizeMin, max: sizeMax, ...axisMinMax(axisOverride, "x") },
        y: {
          type: "logarithmic", min: 1, max: BETA_CHART_MAX,
          title: { display: true, text: "Overall Average Filtration Ratio (" + ratioLabel + ") — log scale" },
          afterBuildTicks: useCleanLogTicks
        }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}

/* Figures C.4/C.5: filtration ratio vs. % test time (C.4, semi-log) and vs. element ΔP
   (C.5, log-log) — both MULTI-series, one line per selected particle size (up to 16),
   genuinely new territory for this codebase: nothing else combines multi-series (the
   colorForIndex/legend plumbing renderChart/renderComparisonChart established) with a
   log axis (proven only single-series, on C.3/B.3). The two figures are identical apart
   from their x-axis (and C.5's kPa->display x conversion), so they share
   renderBetaMultiSeriesFigure below. Both are ISO 16889's OWN figures, so this is
   within-standard reuse, not cross-standard sharing (see CLAUDE.md). */

/** Shared construction for ISO 16889's two multi-series β figures (C.4/C.5). Owns
 *  everything the two have in common — datasets/colors, the hard-won multi-series
 *  legend/interaction/layout tuning documented inline below, the log-β y-axis, and the
 *  print-sizing lifecycle (destroy, resize, return). The caller passes its already-
 *  prepared series (converted/filtered as needed) and its own x-scale object; nothing
 *  standard-specific lives here beyond "ISO 16889's β axis," which both callers share.
 *  @param {HTMLCanvasElement} canvasEl
 *  @param {Array<{label:string,points:Array<{x:number,y:number}>}>} series prepared by the caller
 *  @param {Object} xScale a Chart.js x-axis scale config (type/title/min/max/ticks + any axisMinMax override)
 *  @param {{width:number,height:number}} [explicitSizePx]
 *  @param {string} [ratioLabel] the ratio symbol shown in the Y-axis title — see
 *    renderFiltrationRatioFigureChart's own note; defaults to "β" for ISO 16889.
 *  @returns {*|null} */
function renderBetaMultiSeriesFigure(canvasEl, series, xScale, explicitSizePx, ratioLabel = "β") {
  destroyChart(canvasEl);
  const safeSeries = series || [];

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      datasets: safeSeries.map((s, i) => ({
        label: s.label,
        data: s.points,
        borderColor: colorForIndex(i),
        backgroundColor: colorForIndex(i),
        borderWidth: 1.5,
        pointRadius: 2,
        spanGaps: true,
        tension: 0.1
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,
      animation: false,
      parsing: false,
      // Chart.js's legend has no documented option for spacing between the
      // legend and the plot area itself (checked before adding this) — the
      // closest real lever is layout.padding, which pads the whole chart area
      // in from the canvas edges. Doesn't create a gap between plot and legend
      // specifically, but does keep the legend off the canvas's own right edge.
      layout: { padding: { right: 14 } },
      // mode:"nearest" + axis:"x" + intersect:false (an earlier version of this
      // config) matches every dataset sharing the nearest X pixel, not just one —
      // with up to 16 series sharing the same 10 x-positions, that meant EVERY
      // series' value showed in one stacked tooltip on any hover, unusable. This
      // requires the cursor to actually be near a SPECIFIC point (both axes, not
      // just x) so only that one series' value shows.
      interaction: { mode: "nearest", intersect: true },
      plugins: {
        title: { display: false },
        // maxHeight caps how tall a single column of entries is allowed to get —
        // without it, all 16 entries tried to stack in ONE column taller than the
        // chart itself, overflowing past the plot area into the x-axis title (a
        // real, reported overlap). Chart.js wraps into additional COLUMNS once a
        // column hits maxHeight, which also directly addresses the "too much
        // empty space to the right" complaint: a 2-column layout uses roughly
        // twice the width a 1-column list did, filling that space with actual
        // entries instead of leaving it blank. align:"center" centers the
        // resulting block vertically against the plot area, same as before.
        legend: { display: true, position: "right", align: "center", maxHeight: 150, labels: { boxWidth: 10, padding: 6, font: { size: 8.5 } } }
      },
      scales: {
        x: xScale,
        y: {
          type: "logarithmic", min: 1, max: BETA_CHART_MAX,
          title: { display: true, text: "Filtration Ratio (" + ratioLabel + ") — log scale" },
          afterBuildTicks: useCleanLogTicks
        }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}

/** Figure C.4: filtration ratio (β) vs. % test time, semi-log, multi-series. X is a
 *  linear 0-100% test-time axis and the series pass through unconverted; construction is
 *  delegated to renderBetaMultiSeriesFigure.
 *  @param {HTMLCanvasElement} canvasEl
 *  @param {{series:Array<{label:string,points:Array<{x:number,y:number}>}>}|null} data
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride]
 *  @param {{width:number,height:number}} [explicitSizePx]
 *  @param {string} [ratioLabel] see renderFiltrationRatioFigureChart's own note; defaults to "β".
 *  @returns {*|null} */
export function renderBetaVsTimeFigureChart(canvasEl, data, axisOverride, explicitSizePx, ratioLabel = "β") {
  return renderBetaMultiSeriesFigure(canvasEl, (data && data.series) ? data.series : [], {
    type: "linear", min: 0, max: 100,
    title: { display: true, text: "Test time (Percentage)" },
    ticks: { callback: (value) => value + "%" },
    ...axisMinMax(axisOverride, "x")
  }, explicitSizePx, ratioLabel);
}

/** Figure C.5: filtration ratio (β) vs. element ΔP, log-log, multi-series. X is a
 *  logarithmic ΔP axis; the series' x is canonical kPa, converted to display units here
 *  (and empty series dropped) before construction is delegated to
 *  renderBetaMultiSeriesFigure.
 *  @param {HTMLCanvasElement} canvasEl
 *  @param {{series:Array<{label:string,points:Array<{x:number,y:number}>}>}|null} data x is canonical kPa, converted here
 *  @param {"SI"|"US"} [units]
 *  @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride]
 *  @param {{width:number,height:number}} [explicitSizePx]
 *  @param {string} [ratioLabel] see renderFiltrationRatioFigureChart's own note; defaults to "β".
 *  @returns {*|null} */
export function renderBetaVsPressureFigureChart(canvasEl, data, units, axisOverride, explicitSizePx, ratioLabel = "β") {
  const dpUnit = displayUnit("kPa", units);
  const toDisp = (v) => toDisplayValue(v, "kPa", units);

  const series = (!data || !data.series) ? [] : data.series
    .map(s => ({ label: s.label, points: s.points.map(p => ({ x: toDisp(p.x), y: p.y })) }))
    .filter(s => s.points.length > 0);

  // No series (no file loaded) — unlike C.4's fixed 0-100% x-axis, this one has no
  // standard-defined domain to fall back to, so give it the same arbitrary
  // placeholder-domain treatment as the other log-DP axes in this file.
  const domain = series.length > 0
    ? {}
    : { min: BETA_VS_PRESSURE_PLACEHOLDER_MIN, max: BETA_VS_PRESSURE_PLACEHOLDER_MAX };

  return renderBetaMultiSeriesFigure(canvasEl, series, {
    type: "logarithmic",
    title: { display: true, text: "Element Differential Pressure (" + dpUnit + ") — log scale" },
    ...domain,
    ...axisMinMax(axisOverride, "x")
  }, explicitSizePx, ratioLabel);
}
//#endregion

//#region report figures ("Add Count Details" — Upstream/Downstream Counts vs. Time)
/* renderCountsVsTimeFigureChart: one line per particle size, full test duration —
   shared across iso16889/iso454812/iso19438's own "Add Count Details" page (legitimate
   core/ sharing, same footing as renderDPFigureChart/renderEfficiencyFigureChart: draws
   whatever series/labels it's handed, knows nothing about what a "size" or "upstream"
   means). Deliberately NOT built on renderBetaMultiSeriesFigure despite the shared
   multi-series/color-cycling shape — that function's config (pointRadius 2, log Y axis,
   intersect:true tuned for 16 series sharing only 10 x-positions) doesn't fit this
   chart's few-hundred-point-per-series continuous time series, and forcing one shared
   inner builder would need as many parameters as it'd save. Y axis is plain linear,
   defaulting to [0, defaultYMax] (the caller already computed this from the upstream
   chart's own data — see reportView.js's buildCountsVsTimeData) unless axisOverride
   supplies its own bounds. */
/** @typedef {Object} CountsVsTimeData
 *  @property {Array<{label:string,data:Array<{x:number,y:number}>}>} series one per particle size
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {CountsVsTimeData|null} data
 * @param {number|null} defaultYMax computed by the caller from the UPSTREAM chart's own data —
 *   both the upstream and downstream charts default to this same ceiling, per the user
 * @param {{xMin?:number,xMax?:number,yMin?:number,yMax?:number}|null} [axisOverride] see chartAxisControls.js
 * @param {{width:number,height:number}} [explicitSizePx]
 * @returns {*|null} */
export function renderCountsVsTimeFigureChart(canvasEl, data, defaultYMax, axisOverride, explicitSizePx) {
  destroyChart(canvasEl);
  const series = (data && data.series) ? data.series : [];

  const yMin = (axisOverride && axisOverride.yMin !== undefined) ? axisOverride.yMin : 0;
  // defaultYMax already falls back to 1 with no data — only the X axis (elapsed
  // time) needs its own placeholder, since it has no such fallback today.
  const yMax = (axisOverride && axisOverride.yMax !== undefined) ? axisOverride.yMax : (defaultYMax || 1);
  const xDomain = series.length > 0 ? {} : { min: 0, max: COUNTS_PLACEHOLDER_X_MAX };

  const chart = new window.Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: colorForIndex(i),
        backgroundColor: colorForIndex(i),
        borderWidth: 1.5,
        pointRadius: 0,   // hundreds of points per series over the full test — points would just be noise
        spanGaps: true,
        tension: 0.1
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      aspectRatio: FIGURE_ASPECT_RATIO,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        title: { display: false },   // caption rendered as HTML below the chart, same as every other report figure
        // Same up-to-16-series legend-overflow tuning as renderBetaMultiSeriesFigure —
        // see that function's own comment for why maxHeight/2-column wrapping matters.
        legend: { display: true, position: "right", align: "center", maxHeight: 150, labels: { boxWidth: 10, padding: 6, font: { size: 8.5 } } }
      },
      layout: { padding: { right: 14 } },
      scales: {
        x: { type: "linear", title: { display: true, text: "Elapsed time (min)" }, ...xDomain, ...axisMinMax(axisOverride, "x") },
        y: { type: "linear", min: yMin, max: yMax, title: { display: true, text: "Particle count" } }
      }
    }
  });

  canvasEl._chartInstance = chart;
  if (explicitSizePx) chart.resize(explicitSizePx.width, explicitSizePx.height);
  return chart;
}
//#endregion

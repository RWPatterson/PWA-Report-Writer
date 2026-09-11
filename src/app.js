/* =====================================================================================
   app.js  —  entry point. Wires the drop zone, view switching (Explorer / Report /
   Compare), the Standard switcher, custom plot tabs, cross-file comparison, save/load
   session, and the pipeline: parse -> machine profile corrections -> analyze (per
   selected standard) -> map (per selected standard) -> machine profile defaults ->
   persisted custom defaults -> control target check -> render. The Report view always
   renders EVERY page of the selected standard concatenated in one scroll (see
   pagesForCurrentStandard / reportView.js's renderReportPages) — no per-page picker.

   DataFile, Iso16889Analysis, AnalysisMath, Iso454812Analysis, and Iso19438Analysis
   are loaded as plain globals (see index.html — they're included via classic
   <script> tags before this module runs). Chart.js is loaded the same way
   (window.Chart). Everything else is a proper ES module import.

   STANDARDS is the one place that knows which analysis engine + mapper belongs to a
   given standardId — adding a third standard means one more entry here, not touching
   the pipeline logic below it. Switching standards after a file is already loaded DOES
   retroactively re-run analysis against that same (already-parsed) file — see
   runAnalysisPipeline and the standard switcher region. This was a documented
   limitation in an earlier version ("reload the file after switching"); it silently
   left a mismatched standard's report rendering against another standard's stale
   analysis, which is worse than the cost of one extra re-run.

   NOTE: there is no longer a separate "Charts" view. Custom plot tabs (see
   customTabs.js / customTabsView.js) generalize what that view did — "LB Up Counts
   overlay" or "DP vs Time" are now just tabs a person creates — while also adding
   persistence across file loads and arbitrary multi-channel overlays, which a single
   dropdown-driven view couldn't do.
   ===================================================================================== */

//#region imports
import { ReportValueStore } from "./report/reportValueStore.js";
import { applyParsedFile as applyIso16889Mapper, buildMachineProfileDefaults as buildIso16889MachineProfileDefaults } from "./standards/iso16889/iso16889Mapper.js";
import { ISO16889_CONTROL_TARGETS } from "./standards/iso16889/iso16889ControlTargets.js";
import { applyParsedFile as applyIso454812Mapper } from "./standards/iso454812/iso454812Mapper.js";
import { ISO454812_CONTROL_TARGETS } from "./standards/iso454812/iso454812ControlTargets.js";
import { applyParsedFile as applyIso19438Mapper } from "./standards/iso19438/iso19438Mapper.js";
import { ISO19438_CONTROL_TARGETS } from "./standards/iso19438/iso19438ControlTargets.js";
import { applyParsedFile as applyIso3968Mapper } from "./standards/iso3968/iso3968Mapper.js";
import { ISO3968_CONTROL_TARGETS } from "./standards/iso3968/iso3968ControlTargets.js";
import { applyParsedFile as applyIso23369Mapper, buildMachineProfileDefaults as buildIso23369MachineProfileDefaults } from "./standards/iso23369/iso23369Mapper.js";
import { ISO23369_CONTROL_TARGETS } from "./standards/iso23369/iso23369ControlTargets.js";
import { checkControlTargets } from "./core/controlTargetCheck.js";
import { REPORT_PAGES } from "./report/reportPages.js";
import { MACHINE_PROFILES } from "./core/machineProfiles.js";
import { lookupProfile, applyChannelCorrections, applyCustomDefaults } from "./core/machineProfile.js";
import { loadCustomDefaults, saveCustomDefaults } from "./report/customDefaults.js";
import { renderExplorer } from "./explorer/explorerView.js";
import { renderReportPages, refreshReport, redrawReportCharts, currentDisplayValue, toStorableValue } from "./report/reportView.js";
import { CustomTabRegistry } from "./explorer/customTabs.js";
import { buildCustomTabDefs, openCreateTabDialog } from "./explorer/customTabsView.js";
import { destroyChartsIn } from "./core/charts/chartView.js";
import { clearAxisOverridesWhere } from "./core/charts/chartAxisControls.js";
import { CompareFileSet } from "./compare/compareFiles.js";
import { renderCompareView } from "./compare/compareView.js";
import { loadMachineProfiles, saveMachineProfiles } from "./machineProfiles/machineProfilesStore.js";
import { renderMachineProfilesView } from "./machineProfiles/machineProfilesView.js";
import { renderAuditPage } from "./audit/auditView.js";
import { CompareTemplateRegistry } from "./compare/compareTemplates.js";
import { redrawComparePlots } from "./compare/compareTemplateView.js";
import { computeMassAddedSeries } from "./core/charts/chartData.js";
import { loadPersistedDisplaySizes as loadIso16889DisplaySizes, savePersistedDisplaySizes as saveIso16889DisplaySizes, openDisplaySizesDialog as openIso16889DisplaySizesDialog } from "./standards/iso16889/iso16889DisplaySizesView.js";
import { loadPersistedDisplaySizes as loadIso454812DisplaySizes, savePersistedDisplaySizes as saveIso454812DisplaySizes, openDisplaySizesDialog as openIso454812DisplaySizesDialog } from "./standards/iso454812/iso454812DisplaySizesView.js";
import { loadPersistedDisplaySizes as loadIso19438DisplaySizes, savePersistedDisplaySizes as saveIso19438DisplaySizes, openDisplaySizesDialog as openIso19438DisplaySizesDialog } from "./standards/iso19438/iso19438DisplaySizesView.js";
import { loadPersistedDisplaySizes as loadIso23369DisplaySizes, savePersistedDisplaySizes as saveIso23369DisplaySizes, openDisplaySizesDialog as openIso23369DisplaySizesDialog } from "./standards/iso23369/iso23369DisplaySizesView.js";
import { openGravimetricDialog } from "./report/gravimetricEntryView.js";
import { openWarningsDialog } from "./report/warningsDialogView.js";
import { openTarePrompt } from "./report/tareEntryView.js";
import { openCompanionFilePrompt } from "./report/companionEntryView.js";
import { loadAddCountDetails, saveAddCountDetails } from "./report/addCountDetails.js";
import { loadCompanyLogo, saveCompanyLogo, clearCompanyLogo } from "./report/companyLogoStore.js";
import { openHelpDialog } from "./helpDialogView.js";
//#endregion

//#region standards registry & module state
/**
 * @typedef {Object} StandardEntry
 * @property {string} label
 * @property {(df: DataFile) => boolean} isCompatible
 *   Cheap TestType check (own copy per standard, per CLAUDE.md), used by the sidebar
 *   to gray out a standard's button once a loaded file's TestType doesn't match —
 *   see updateReportingControlsVisibility. Never called against a CyclicCompanionFile
 *   (it has no .testType of its own; the sidebar treats that file kind as "compatible
 *   with everything" — see the isCompatible call site).
 * @property {(df: DataFile, opts: {sensor?: string}) => *} run   runs that standard's analysis engine
 * @property {(store: ReportValueStore, df: DataFile, analysis: *, opts?: Object) => void} applyMapper
 * @property {import("./core/controlTargetCheck.js").ControlTargetRule[]|null} controlTargets
 * @property {((df: DataFile) => Array<{key:string,label:string}>)|null} availableSensors
 *   null for a standard with no sensor choice (iso3968 only — a P-Q test has no
 *   particle counting at all); iso16889/iso454812/iso19438 each supply their own
 *   Analysis.availableSensors. `run`/`applyMapper` take a `{sensor}`/
 *   `{persistedDisplaySizes}` options object either way — a standard with no sensor
 *   choice just ignores the extra argument, same as any unused parameter.
 * @property {((df: DataFile) => Array<{key:string,label:string}>)|null} availablePressureViews
 *   Same shape/null convention as availableSensors, for the "Pressure view" picker —
 *   only ever non-empty for a MidstreamFlag:false dual-filter ("Two Pressure"/
 *   "Suction & Pressure") Setup file, where there's no filter-identity sensor toggle
 *   to reuse. `run` takes the resolved choice as `{pressureView}` in the same options
 *   object as `{sensor}`.
 * @property {Array<{id:string,label:string}>|null} gravimetricSpecs
 *   null for a standard with no hand-entry gravimetric workflow (iso3968 only — no
 *   particle counting, no gravimetric measurements); iso16889/iso454812/iso19438
 *   each supply the quantities their own report needs (see openGravimetricDialog
 *   below).
 * @property {{load:Function,save:Function,openDialog:Function}|null} displaySizesView
 *   null for a standard with no sensor/display-size choice (iso3968 only); each of
 *   iso16889/iso454812/iso19438 supplies its OWN DisplaySizesView module's trio (own
 *   file per standard, per CLAUDE.md — the dialog copy names the standard by name).
 * @property {boolean} [usesTareFile]
 *   true for iso3968 only — drives the tare-file prompt/toolbar button generically
 *   instead of hardcoding currentStandardId === "iso3968" checks at each call site.
 *   Omitted (falsy) everywhere else.
 * @property {boolean} [usesCompanionFile]
 *   true for iso23369 only — a cyclic-flow test's rig also writes a "-Cyclic.DAT"
 *   companion file the primary .DAT can't be fully analyzed without (see
 *   core/cyclicCompanionFile.js). Drives the companion-file auto-prompt/toolbar
 *   button generically, own independent state — structurally inspired by
 *   usesTareFile above, per CLAUDE.md NOT sharing its code (the companion file is
 *   functionally load-bearing, warn-not-block if skipped, unlike the tare file's
 *   fully optional role; and it needs no second run()/applyMapper() pass of its
 *   own — it's raw supplementary data Iso23369Analysis.run() consumes inline via
 *   options.companionFile, not a second full analysis). Omitted (falsy) everywhere else.
 * @property {boolean} [hasCountDetails]
 *   true for iso16889/iso454812/iso19438 — drives the "Add Count Details" toolbar
 *   checkbox generically (see updateReportingControlsVisibility). Omitted (falsy) for
 *   iso3968 (no particle counting at all).
 * @property {((profile:*) => Record<string,string>)|undefined} machineProfileFields
 *   Turns a saved Machine Profiles tab record (machineProfiles/machineProfilesStore.js)
 *   into THIS standard's own customDefaults map (see applyMachineProfileFields) —
 *   undefined for a standard with no report fields to feed yet. iso16889 and iso23369
 *   (per the user, 2026-09-09 — coincidence-limit fields apply to any particle-counting
 *   report, and iso23369's Page 1 has the identical counter/sensor/cal slots); iso454812
 *   and iso19438's Page 1 still has no matching counter/sensor/cal fields, and iso3968
 *   has no particle counting at all.
 */

/** @type {Record<string, StandardEntry>} standardId -> its analysis engine, mapper, and rule table */
const STANDARDS = {
  // Clean build against the published ISO 16889:2022 text — see
  // CLAUDE.md's "ISO 16889 — provenance note". Full parity with iso454812/iso19438
  // (sensor selection, midstream, control targets, gravimetric workflow), confirmed
  // with the user even though the pasted spec itself doesn't ask for LB/LS/midstream.
  iso16889: {
    label: "ISO 16889:2022",
    isCompatible: (df) => window.Iso16889Analysis.isCompatible(df),
    run: (df, opts) => window.Iso16889Analysis.run(df, opts),
    applyMapper: applyIso16889Mapper,
    controlTargets: ISO16889_CONTROL_TARGETS,
    availableSensors: (df) => window.Iso16889Analysis.availableSensors(df),
    availablePressureViews: (df) => window.Iso16889Analysis.availablePressureViews(df),
    // finalGravimetricGf doubles as this standard's "80% upstream gravimetric level,
    // c80" (12.10) — same field id as 4548-12/19438's own Gf, different label; see
    // iso16889Mapper.js's own header comment for why reusing the id is deliberate.
    gravimetricSpecs: [
      { id: "injectionGravInitial", label: "Initial Injection Gravimetric" },
      { id: "injectionGravFinal", label: "Final Injection Gravimetric" },
      { id: "finalGravimetricGf", label: "80% Upstream Gravimetric Level (c₈₀)" }
    ],
    displaySizesView: { load: loadIso16889DisplaySizes, save: saveIso16889DisplaySizes, openDialog: openIso16889DisplaySizesDialog },
    hasCountDetails: true,
    machineProfileFields: buildIso16889MachineProfileDefaults
  },
  iso454812: {
    label: "ISO 4548-12",
    isCompatible: (df) => window.Iso454812Analysis.isCompatible(df),
    run: (df, opts) => window.Iso454812Analysis.run(df, opts),
    applyMapper: applyIso454812Mapper,
    controlTargets: ISO454812_CONTROL_TARGETS,
    availableSensors: (df) => window.Iso454812Analysis.availableSensors(df),
    availablePressureViews: (df) => window.Iso454812Analysis.availablePressureViews(df),
    gravimetricSpecs: [
      { id: "injectionGravInitial", label: "Initial Injection Gravimetric (Gia)" },
      { id: "injectionGravFinal", label: "Final Injection Gravimetric (Gia)" },
      { id: "finalGravimetricGf", label: "Final Test Gravimetric (Gf)" }
    ],
    displaySizesView: { load: loadIso454812DisplaySizes, save: saveIso454812DisplaySizes, openDialog: openIso454812DisplaySizesDialog },
    hasCountDetails: true
  },
  iso19438: {
    label: "ISO 19438:2023",
    isCompatible: (df) => window.Iso19438Analysis.isCompatible(df),
    run: (df, opts) => window.Iso19438Analysis.run(df, opts),
    applyMapper: applyIso19438Mapper,
    controlTargets: ISO19438_CONTROL_TARGETS,
    availableSensors: (df) => window.Iso19438Analysis.availableSensors(df),
    availablePressureViews: (df) => window.Iso19438Analysis.availablePressureViews(df),
    // Vf (final test system volume) is ALSO needed for Non-Retained Mass, but unlike
    // Gf it's not a gravimetric lab result (mg/L from weighings) — it's a system
    // volume, hand-entered through the report's general double-click-to-edit
    // mechanism (see iso19438_page1.html's data-editable testVolumeFinal), not this
    // dialog. See iso19438Analysis.js's computeMassBalance note.
    gravimetricSpecs: [
      { id: "injectionGravInitial", label: "Initial Injection Gravimetric (Gia)" },
      { id: "injectionGravFinal", label: "Final Injection Gravimetric (Gia)" },
      { id: "finalGravimetricGf", label: "Final Test Gravimetric (Gf)" }
    ],
    displaySizesView: { load: loadIso19438DisplaySizes, save: saveIso19438DisplaySizes, openDialog: openIso19438DisplaySizesDialog },
    hasCountDetails: true
  },
  // File-structure parsing + control targets only (see iso3968Analysis.js's own
  // SCOPE note) — a P-Q test has no sensor selection, no midstream/dual-filter
  // pressure-view concept, no gravimetric hand-entry workflow, and no display-size
  // choice (no particle counting at all), so this entry is the minimal shape among
  // the active standards. usesTareFile is the one thing genuinely new to this standard.
  iso3968: {
    label: "ISO 3968:2017",
    isCompatible: (df) => window.Iso3968Analysis.isCompatible(df),
    run: (df, opts) => window.Iso3968Analysis.run(df, opts && opts.tareDf),
    applyMapper: applyIso3968Mapper,
    controlTargets: ISO3968_CONTROL_TARGETS,
    availableSensors: null,
    availablePressureViews: null,
    gravimetricSpecs: null,
    displaySizesView: null,
    usesTareFile: true
  },
  // Clean build against the standard's own outline text — cyclic-flow multipass,
  // explicitly modeled on ISO 16889 (see iso23369Analysis.js's own file-top note for
  // the genuine differences: phase-split termination, element-vs-assembly ΔP
  // direction, generalized bucket granularity, the mass-balance formula diff).
  // Full sensor-selection parity with iso16889 (LB/LS/LBE + midstream), confirmed
  // real by a cyclic fixture with genuine LS data — see iso23369DisplaySizesView.js.
  iso23369: {
    label: "ISO 23369:2022",
    isCompatible: (df) => window.Iso23369Analysis.isCompatible(df),
    run: (df, opts) => window.Iso23369Analysis.run(df, opts),
    applyMapper: applyIso23369Mapper,
    controlTargets: ISO23369_CONTROL_TARGETS,
    availableSensors: (df) => window.Iso23369Analysis.availableSensors(df),
    availablePressureViews: (df) => window.Iso23369Analysis.availablePressureViews(df),
    // finalGravimetricGf doubles as this standard's own "80% upstream concentration,
    // c80" (12.10) — same single-field pattern ISO 16889's own Gf uses (per the
    // user's own decision: "final test grav and 80% are the same thing, the 80% is
    // a concession made to capture the sample while the test is still running").
    gravimetricSpecs: [
      { id: "injectionGravInitial", label: "Initial Injection Concentration" },
      { id: "injectionGravFinal", label: "Final Injection Concentration" },
      { id: "finalGravimetricGf", label: "80% Upstream Concentration (c₈₀)" }
    ],
    displaySizesView: { load: loadIso23369DisplaySizes, save: saveIso23369DisplaySizes, openDialog: openIso23369DisplaySizesDialog },
    hasCountDetails: true,
    usesCompanionFile: true,
    machineProfileFields: buildIso23369MachineProfileDefaults
  }
};

/* STANDARD_CURVES: static metadata for Compare Files' "standard-derived plots" —
   which curves each standard's own report already computes, and how to pull each
   one's points out of that standard's already-completed run()/applyMapper() pass
   (never re-derived here — see CLAUDE.md's "Project organization" rule; a curve's
   `resolve` is just a reader over analysis/df/the mapper's own store extras, the
   exact same fields each standard's OWN report figure already reads — see
   reportView.js's buildDPFigureData/build16889MassPressureData/buildPQFigureData
   for the report-side counterparts these mirror).
   iso3968 has one curve despite having no sensor/particle-counting at all — see the
   sensor-gating note in compareTemplateView.js's buildTogglePalette for why that
   needed its own fix.
   `multiSize`: true means `resolve` returns `{series:[{label,points:[{x,y}]}]}`
   (one line per particle size, e.g. ISO 16889's Figures C.4/C.5) rather than a
   single `{sizes,values}` line — runStandardCurve extracts ONE size's line by
   label match, same "pick one, compare across files" shape the particle-size
   picker already uses for raw counts (buildComparisonSizeDataset). A multiSize
   curve MUST also supply `sizeLabelFor(size)`, building the exact label string
   that standard's own mapper puts on each series (e.g. iso16889Mapper.js's
   betaVsTimeSeries/betaVsPressureSeries use ">4 µm(c)", not a generic "4 µm" —
   found the hard way: a first version of this assumed one shared format across
   curves and silently matched nothing). Report content stays standard-owned even
   here — this registry only reads it, never invents its own formatting. */
const STANDARD_CURVES = {
  iso16889: [
    { curveId: "betaVsSize", curveLabel: "Overall Average Filtration Ratio (β) vs. Size", xAxisLabel: "Particle size (µm)", yAxisLabel: "Overall Average Filtration Ratio (β)",
      resolve: ({ store }) => { const c = store.getExtra("betaChart"); return (c && c.overallBeta) ? { sizes: c.sizes, values: c.overallBeta } : null; } },
    { curveId: "dpVsMass", curveLabel: "Differential Pressure vs. Injected Mass", xAxisLabel: "Mass added (g)", yAxisLabel: "Differential Pressure (kPa)",
      resolve: ({ analysis, df }) => resolveDPvsMassXY(analysis, df) },
    { curveId: "betaVsTime", curveLabel: "Filtration Ratio (β) vs. % Test Time", xAxisLabel: "Test time (%)", yAxisLabel: "Filtration Ratio (β)", multiSize: true,
      sizeLabelFor: (size) => ">" + size + " µm(c)",
      resolve: ({ store }) => store.getExtra("betaVsTimeChart") },
    { curveId: "betaVsPressure", curveLabel: "Filtration Ratio (β) vs. Element ΔP", xAxisLabel: "Element differential pressure (kPa)", yAxisLabel: "Filtration Ratio (β)", multiSize: true,
      sizeLabelFor: (size) => ">" + size + " µm(c)",
      resolve: ({ store }) => store.getExtra("betaVsPressureChart") }
  ],
  iso454812: [
    { curveId: "effVsSize", curveLabel: "Overall Efficiency vs. Size", xAxisLabel: "Particle size (µm)", yAxisLabel: "Overall Efficiency (%)",
      resolve: ({ store }) => { const c = store.getExtra("effChart"); return (c && c.overall) ? { sizes: c.sizes, values: c.overall } : null; } },
    { curveId: "dpVsTime", curveLabel: "Differential Pressure vs. Time", xAxisLabel: "Elapsed time (min)", yAxisLabel: "Differential Pressure (kPa)",
      resolve: ({ analysis, df }) => resolveDPvsTimeXY(analysis, df) }
  ],
  iso19438: [
    { curveId: "effVsSize", curveLabel: "Overall Efficiency vs. Size", xAxisLabel: "Particle size (µm)", yAxisLabel: "Overall Efficiency (%)",
      resolve: ({ store }) => { const c = store.getExtra("effChart"); return (c && c.overall) ? { sizes: c.sizes, values: c.overall } : null; } },
    { curveId: "dpVsTime", curveLabel: "Differential Pressure vs. Time", xAxisLabel: "Elapsed time (min)", yAxisLabel: "Differential Pressure (kPa)",
      resolve: ({ analysis, df }) => resolveDPvsTimeXY(analysis, df) }
  ],
  iso3968: [
    { curveId: "pqCurve", curveLabel: "Flow Rate vs. Differential Pressure", xAxisLabel: "Flow rate (L/min)", yAxisLabel: "Differential Pressure (kPa)",
      resolve: ({ analysis }) => (analysis.points && analysis.points.length) ? { sizes: analysis.points.map((p) => p.flowRate), values: analysis.points.map((p) => p.dp) } : null }
  ]
};

/* resolveDPvsTimeXY: ISO 4548-12's Figure B.1 / ISO 19438's Figure B.2 data,
   without the report-only milestone/mass-axis decoration buildDPFigureData adds —
   own copy here (not imported from reportView.js, which isn't a shared module and
   shouldn't become one just for this) reading the identical analysis fields:
   overallDPSeries (dual-filter channel sum, when applicable) falling back to the
   plain termination channel, truncated at terminationTime same as the report. */
/** @param {*} analysis @param {DataFile} df @returns {{sizes:number[],values:number[]}|null} */
function resolveDPvsTimeXY(analysis, df) {
  if (!analysis || analysis.terminationTime === null || analysis.terminationTime === undefined) return null;
  const dpValues = analysis.overallDPSeries || df.getChannel(analysis.terminationTag);
  if (!dpValues) return null;

  const sizes = [], values = [];
  for (let i = 0; i < dpValues.length; i++) {
    const t = df.times[i];
    if (t === null || dpValues[i] === null || t > analysis.terminationTime) continue;
    sizes.push(t / 60);
    values.push(dpValues[i]);
  }
  return sizes.length ? { sizes, values } : null;
}

/* resolveDPvsMassXY: ISO 16889:2022's Figure C.2, Compare-specific x-axis source —
   the report's OWN build16889MassPressureData reads store.get("isoMtdMassInjected"),
   a HAND-ENTERED gravimetric total (see recomputeIso16889GravimetricDerived) that a
   throwaway run()/applyMapper() pass into a fresh store never populates (that
   recompute only ever runs against the live report's own store, interactively).
   Uses computeMassAddedSeries(df) instead — the same header-GravimetricLevel-based
   mass curve Compare's own "Mass Added (calc.)" channel already exposes (see
   chartData.js's own note on why that's the only Gia this df-only context can
   read) — so a file's dpVsMass curve here can differ slightly from that same
   file's own Report page total, exactly like Mass Added already does. */
/** @param {*} analysis @param {DataFile} df @returns {{sizes:number[],values:number[]}|null} */
function resolveDPvsMassXY(analysis, df) {
  if (!analysis || analysis.terminationTime === null || analysis.terminationTime === undefined) return null;
  const dpValues = analysis.overallDPSeries || df.getChannel(analysis.terminationTag);
  const massSeries = computeMassAddedSeries(df);
  if (!dpValues || !massSeries) return null;

  const sizes = [], values = [];
  for (let i = 0; i < dpValues.length; i++) {
    const t = df.times[i];
    if (t === null || dpValues[i] === null || massSeries[i] === null || t > analysis.terminationTime) continue;
    sizes.push(massSeries[i]);
    values.push(dpValues[i]);
  }
  return sizes.length ? { sizes, values } : null;
}

/** @returns {Array<{id:string,standardLabel:string,curveId:string,curveLabel:string,xAxisLabel:string,yAxisLabel:string,multiSize:boolean}>}
 *  compareTemplateView.js's palette/preview never sees STANDARDS itself (see the
 *  Compare Files region below) — just this flattened, standard-agnostic list, one
 *  entry per curve (a standard with several curves contributes several entries). */
function compareStandardCurveOptions() {
  const options = [];
  for (const [id, curves] of Object.entries(STANDARD_CURVES)) {
    for (const curve of curves) {
      options.push({
        id, standardLabel: STANDARDS[id].label,
        curveId: curve.curveId, curveLabel: curve.curveLabel,
        xAxisLabel: curve.xAxisLabel, yAxisLabel: curve.yAxisLabel,
        multiSize: !!curve.multiSize
      });
    }
  }
  return options;
}

/** Runs standardId's OWN run()/applyMapper() (per CLAUDE.md, never re-derived here)
 *  against a throwaway ReportValueStore, and hands back curveId's points —
 *  {sizes, values} (the name is inherited from this shape's original single use;
 *  it's really just "x values, y values" — every curve here reuses it, not only
 *  size-indexed ones) — or null if the file doesn't validate under that standard, the
 *  curve doesn't resolve for this file (flagged/excluded by the caller, same
 *  "missing" convention every other comparison dataset already uses), or (for a
 *  multiSize curve) `size` wasn't supplied or has no matching line in this file.
 *  @param {string} standardId @param {string} sensor @param {DataFile} df
 *  @param {string} curveId @param {string|number} [size] required only for a multiSize curve
 *  @returns {{sizes:Array, values:Array}|null} */
function runStandardCurve(standardId, sensor, df, curveId, size) {
  const standard = STANDARDS[standardId];
  const curves = STANDARD_CURVES[standardId];
  const curveSpec = curves && curves.find((c) => c.curveId === curveId);
  if (!standard || !curveSpec) return null;

  const analysis = standard.run(df, { sensor });
  if (!analysis || analysis.ok === false) return null;

  const tmpStore = new ReportValueStore();   // side-effect-free: applyMapper never touches localStorage/customDefaults
  standard.applyMapper(tmpStore, df, analysis, { sensor });
  const result = curveSpec.resolve({ analysis, df, store: tmpStore });
  if (!result) return null;

  if (curveSpec.multiSize) {
    if (!size || !result.series) return null;
    const label = curveSpec.sizeLabelFor ? curveSpec.sizeLabelFor(size) : (size + " µm");
    const line = result.series.find((s) => s.label === label);
    if (!line || !line.points || line.points.length === 0) return null;
    return { sizes: line.points.map((p) => p.x), values: line.points.map((p) => p.y) };
  }
  return (result.sizes && result.values) ? result : null;
}

// Remembers the last-selected standard across sessions — most customers repeatedly
// report against the same one for their media type (hydraulic -> 16889, fuel ->
// 19438, lube -> 4548-12), so defaulting to ISO 16889 every visit regardless of which
// one was actually used last was pure friction. A single global preference, NOT
// scoped per standard like customDefaults.js's field defaults (which store each
// standard's OWN data and must stay separate) — this is just "which one to open to."
const LAST_STANDARD_KEY = "webreportwriter-last-standard";

/** @returns {string|null} the persisted standardId, or null if none/invalid/unavailable */
function loadLastStandardId() {
  try {
    const id = localStorage.getItem(LAST_STANDARD_KEY);
    return (id && STANDARDS[id]) ? id : null;
  } catch (err) {
    return null;
  }
}

/** @param {string} id */
function saveLastStandardId(id) {
  try {
    localStorage.setItem(LAST_STANDARD_KEY, id);
  } catch (err) {
    // Storage disabled (private browsing, quota, etc.) — degrade to non-persistent,
    // same as customDefaults.js.
  }
}

/** @type {ReportValueStore} the current report's resolved field values */
let store = new ReportValueStore();
/** @type {DataFile|import("./core/cyclicCompanionFile.js").CyclicCompanionFile|null}
 *  the currently loaded (Explorer/Report) file — a CyclicCompanionFile only when
 *  loaded standalone via "Load data file" (see loadFileText's own detection);
 *  explorable but never analyzable (runAnalysisPipeline's own guard handles that). */
let currentDf = null;
/** @type {*} the current file's analysis-engine result */
let currentAnalysis = null;
/** @type {import("./core/controlTargetCheck.js").ControlTargetResult[]} the current
 *  file's control-target check results (ALL of them, pass and fail alike) — [] for a
 *  standard with no rule table yet (ISO 16889 v1) or before any file is loaded. Full
 *  detail lives here now; see warningsDialogView.js (the dialog) and reportView.js's
 *  applyControlWarningMarkers (the inline ⚠ field markers), both fed from this same
 *  array so the two surfaces can never disagree. */
let currentControlResults = [];
/** @type {string} display name of the currently loaded file */
let sourceFileName = "";
/** @type {string} raw .DAT text of the currently loaded file — kept alongside
 *  currentDf (which doesn't retain it) so a saved session can carry the original
 *  file forward for a full re-parse on load. See loadSessionData. */
let sourceFileText = "";
/** @type {string} standardId of the standard currently selected — defaults to
 *  whichever was last used (see LAST_STANDARD_KEY), falling back to ISO 16889 on a
 *  first-ever visit or if storage is unavailable. */
let currentStandardId = loadLastStandardId() || "iso16889";
/** @type {string|null} the Audit Trail view's OWN selection (#auditSwitch), independent
 *  of currentStandardId — null means "follow currentStandardId" (the normal case, kept
 *  in sync whenever a real standard is picked from EITHER switcher); "explorer" means
 *  show the Data File Explorer's own raw-parsing audit instead, which has no
 *  currentStandardId equivalent (it isn't a real standard — see effectiveAuditId). */
let auditSelectedId = null;
/** @type {string} sensor key the CURRENT file's analysis was run against (e.g. "lb"/"ls")
 *  — always resets to "lb" on a new file load, never persisted (see the sensor-selector
 *  UX decision: this is a structural per-file choice, unlike display sizes below). */
let currentSensor = "lb";
/** @type {string|null} pressure-view key ("filter1"/"filter2"/"overall") the CURRENT
 *  file's analysis was run against — only meaningful for a MidstreamFlag:false
 *  dual-filter ("Two Pressure"/"Suction & Pressure") Setup file (see
 *  availablePressureViews); null otherwise. Same reset-on-new-file/round-trips-
 *  through-a-saved-session convention as currentSensor, just with a null default
 *  instead of "lb" — there's no single sensible pressure view to fall back to before
 *  a file's own availablePressureViews is known. */
let currentPressureView = null;
/** @type {DataFile|null} ISO 3968 only — the optional "tare" (empty-housing)
 *  reference run, held alongside currentDf, NOT fed into the primary standard.run()/
 *  applyMapper() pipeline the way currentDf is. null until the user supplies one via
 *  the tare prompt/toolbar button (see openTarePrompt/loadTareFileText). Deliberately
 *  NOT built on CompareFileSet — that machinery is for N unordered peer files with no
 *  primary/secondary concept; this is exactly one optional file paired with a primary. */
let tareDf = null;
/** @type {string} display name of the loaded tare file, "" if none */
let tareFileName = "";
/** @type {string} raw .DAT text of the loaded tare file, mirroring sourceFileText —
 *  kept so a saved session can carry it forward for a full re-parse on load. */
let tareFileText = "";
/** @type {boolean} whether the tare prompt has already been shown for the CURRENTLY
 *  loaded primary file — reset alongside tareDf on every new file load, so declining
 *  once doesn't mean declining forever, but also doesn't re-prompt on every re-render. */
let tarePromptShown = false;
/** @type {*} ISO 23369 only — the "-Cyclic.DAT" companion file a cyclic-flow test's
 *  rig also writes (see core/cyclicCompanionFile.js). Own independent state,
 *  structurally mirroring tareDf/tareFileName/tareFileText/tarePromptShown above
 *  (per CLAUDE.md, NOT sharing code with that iso3968-only mechanism) — but unlike
 *  the tare file, this one is functionally load-bearing (warn, don't block, if
 *  skipped — see iso23369Analysis.js's companionFileMissing) and needs no second
 *  run()/applyMapper() pass of its own; it's threaded straight into
 *  Iso23369Analysis.run()'s own options bag. null until supplied via the
 *  companion-file prompt/toolbar button. */
let companionDf = null;
/** @type {string} display name of the loaded companion file, "" if none */
let companionFileName = "";
/** @type {string} raw text of the loaded companion file, mirroring tareFileText —
 *  kept so a saved session can carry it forward for a full re-parse on load. */
let companionFileText = "";
/** @type {boolean} whether the companion-file prompt has already been shown for the
 *  CURRENTLY loaded primary file — same reset-on-new-file convention as
 *  tarePromptShown. */
let companionPromptShown = false;
/** @type {CustomTabRegistry} user-created Explorer plot tab definitions */
let customTabs = new CustomTabRegistry();
/** @type {string|null} id of the Explorer tab currently showing */
let activeExplorerTabId = null;
/** @type {CompareFileSet} the independent set of files loaded for Compare Files */
let compareFiles = new CompareFileSet();
/** @type {CompareTemplateRegistry} user-created comparison report template definitions */
let compareTemplates = new CompareTemplateRegistry();
/** @type {string|null} id of the comparison template currently shown/edited */
let activeCompareTemplateId = null;
/** @type {string|null} the "what to add next" standard-derived-curve picker's
 *  current standard selection — NOT stored on the template itself (a template can
 *  hold curves from several different standards side by side, per the user's own
 *  call — see compareTemplates.js's header note), just a transient convenience so
 *  repeatedly toggling curves from the same standard doesn't require re-picking it
 *  every time. */
let compareCurvePickerStandard = null;
/** @type {string|null} the picker's current sensor selection, same transience as above */
let compareCurvePickerSensor = null;
/** @type {string|null} the picker's current size selection — only meaningful for a
 *  multiSize curve (e.g. ISO 16889's β vs. Time/Pressure), same transience as above */
let compareCurvePickerSize = null;
/** @type {*} the current file's machine profile (needed again on every sensor/size
 *  re-run, not just the initial load, for applyCustomDefaults) */
let currentProfile = null;

/** @param {string} id @returns {HTMLElement} */
const byId = (id) => document.getElementById(id);

/** @param {*} value @returns {number|null} */
const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(value);
  return isFinite(n) ? n : null;
};

/** Every REPORT_PAGES entry for currentStandardId, in declared order — what
 *  renderReportPages renders, concatenated, all at once. No more one-page-at-a-time
 *  picker: scrolling (on screen) and page-break-after (printing, see app.css) do the
 *  "next page" job instead.
 *  @returns {Array<*>} */
function pagesForCurrentStandard() {
  const includeCountDetails = loadAddCountDetails(currentStandardId);
  return REPORT_PAGES.filter(p => p.standardId === currentStandardId && (!p.optional || includeCountDetails));
}

/** Fills store's Custom Default tier from the browser's persisted, customer-facing
 *  defaults (customDefaults.js), scoped to the current report STANDARD so different
 *  standards never leak defaults into each other. Applied AFTER the machine profile's
 *  own (rare, rep-maintained, per-rig) customDefaults so a persisted default wins on a
 *  field both happen to set.
 *  @param {ReportValueStore} store */
function applyPersistedCustomDefaults(store) {
  applyCustomDefaults(store, { customDefaults: loadCustomDefaults(currentStandardId) });
}

/** Fills store's Custom Default tier from the CURRENT file's saved Machine Profiles
 *  tab entry (machineProfiles/machineProfilesStore.js — the user-editable per-rig
 *  directory, distinct from core/machineProfiles.js's hardcoded quirk table), for
 *  whichever fields the current standard knows how to derive from one (see
 *  STANDARDS[..].machineProfileFields — iso16889 and iso23369 today). Applied LAST — after
 *  both the hardcoded per-rig quirk profile and the global persisted defaults — so a
 *  specific rig's own saved identity wins on any field more than one tier sets: the
 *  whole point of a per-rig profile is to be MORE specific than a standard-wide
 *  default, per the user. No-ops with no file loaded (nothing to look a serial number
 *  up against) or for a standard with no machineProfileFields adapter yet.
 *  @param {ReportValueStore} store */
function applyMachineProfileFields(store) {
  const standard = STANDARDS[currentStandardId];
  if (!standard.machineProfileFields || !currentDf) return;
  const serialNumber = currentDf.getHeaderValue("Software Information", "SerialNumber");
  const profile = lookupProfile(loadMachineProfiles(), serialNumber);
  if (!profile) return;
  applyCustomDefaults(store, { customDefaults: standard.machineProfileFields(profile) });
}
//#endregion

//#region view switching (Explorer / Report / Compare)
// Remembers the last-used mode across sessions, same reasoning and pattern as
// LAST_STANDARD_KEY above — a repeat customer doing mostly report writing, or mostly
// raw-file inspection, shouldn't have to re-click into that mode every visit.
const LAST_VIEW_KEY = "webreportwriter-last-view";
// "audit" deliberately EXCLUDED, unlike every other view — it's a hidden route
// (see the Ctrl+Alt+Shift+Click handler below) that must not persist across a new
// instance of the program at all, reload included. A stray "audit" value here would
// let a reload silently land back on the audit view/content with the nav button
// still hidden — bypassing the reveal gesture entirely, not just skipping it.
const VALID_VIEWS = ["explorer", "report", "compare", "machineProfiles"];

/** @returns {string|null} the persisted view name, or null if none/invalid/unavailable */
function loadLastView() {
  try {
    const name = localStorage.getItem(LAST_VIEW_KEY);
    return VALID_VIEWS.indexOf(name) >= 0 ? name : null;
  } catch (err) {
    return null;
  }
}

/** @param {string} name */
function saveLastView(name) {
  try {
    localStorage.setItem(LAST_VIEW_KEY, name);
  } catch (err) {
    // Storage disabled (private browsing, quota, etc.) — degrade to non-persistent,
    // same as customDefaults.js.
  }
}

/** @param {"explorer"|"report"|"compare"|"audit"} name */
function showView(name) {
  // Never persist "audit" as the last view — see VALID_VIEWS's own comment; the
  // hidden route must not survive a reload, not even as a stale, never-restored key.
  if (name !== "audit") saveLastView(name);
  // ">" (direct children only): #standardSwitch's own buttons are nested INSIDE
  // .view-switch too (so it visually expands under the Report button — see
  // index.html), and they carry data-standard, not data-view — the plain
  // ".view-switch button" descendant selector would also match them and, since
  // b.dataset.view is undefined for those, incorrectly clear whichever standard
  // button was active every time this runs.
  document.querySelectorAll(".view-switch > button").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  // Each mode's own controls live in its own .context-toolbar (index.html) — shown/
  // hidden the same way .view is, so switching mode swaps both the content AND
  // which controls are relevant at once.
  document.querySelectorAll(".context-toolbar").forEach(t => t.classList.toggle("active", t.id === "context-" + name));
  // The standard sub-menu only makes sense while looking at a report — expands
  // under "Report" when it's the active mode, same idea as the context toolbars.
  // #auditSwitch is Audit's OWN, separate picker (see its own region below) — only
  // lists what's actually auditable, not Report's full standard list.
  byId("standardSwitch").classList.toggle("active", name === "report");
  byId("auditSwitch").classList.toggle("active", name === "audit");
  if (name === "explorer") {
    // Same "always re-render this view's own render function on switch" convention
    // every other branch below already follows — without this, #view-explorer never
    // gets its empty-state placeholder (rerenderExplorer's own guard) on first load,
    // since nothing else calls it before a file loads. Idempotent/cheap once a file
    // IS loaded, same as every other branch's own redundant-call cost.
    rerenderExplorer();
  } else if (name === "report") {
    renderReportPages(byId("view-report"), store, byId("unitSelect").value, pagesForCurrentStandard())
      .catch(err => console.error("Report render failed:", err));
  } else if (name === "compare") {
    rerenderCompare();
  } else if (name === "machineProfiles") {
    rerenderMachineProfiles();
  } else if (name === "audit") {
    syncAuditSwitchActiveState();   // currentStandardId may have changed via #standardSwitch since Audit was last open
    renderAuditPage(byId("view-audit"), store, effectiveAuditId());
  }
  updateReportingControlsVisibility();
}
document.querySelectorAll(".view-switch > button").forEach(b => {
  b.addEventListener("click", () => showView(b.dataset.view));
});

// ---- Hidden route: the Audit Trail tab (developer-only, see auditView.js's own
// header comment on why — never surfaced to a customer). No URL param, no visible
// affordance: Ctrl+Alt+Shift+Click on the status text (an element every user sees
// but never has reason to click) toggles it, same "inconspicuous existing element"
// pattern already used elsewhere for hidden dev buttons. Deliberately NOT persisted
// anywhere (no localStorage/sessionStorage) — per the user, the reveal must not
// carry over to a new instance of the program; every fresh load starts hidden and
// needs the gesture again, in-memory only for the life of this page load. ----
function setAuditNavVisible(visible) {
  byId("auditNavBtn").style.display = visible ? "" : "none";
}
byId("statusText").addEventListener("click", (e) => {
  if (!(e.ctrlKey && e.altKey && e.shiftKey)) return;
  const nowVisible = byId("auditNavBtn").style.display === "none";
  setAuditNavVisible(nowVisible);
});
//#endregion

//#region Compare Files
/* A second, independent set of loaded files, plus a registry of custom comparison
   report TEMPLATES (compareTemplates.js) built against that set — a template's
   pages/plots persist across whichever files happen to be loaded, the same
   "definition vs. whichever data is loaded" split customTabs.js already uses one
   level up. Parsing and machine profile channel corrections apply the same as the
   main pipeline (so a legacy rig's data is still correct when compared).

   Standard-derived plots (beta/efficiency vs. size) DO now run a standard's own
   analysis engine (runStandardCurve, above) — read-only, into a throwaway
   ReportValueStore — but nothing here ever writes into currentDf/store/
   currentAnalysis or touches localStorage/customDefaults; the main single-file
   Explorer/Report pipeline is completely unaffected either way. */

/** @param {FileList} fileList */
function addCompareFiles(fileList) {
  const readers = [...fileList].map(file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve({ text: reader.result, name: file.name });
    reader.readAsText(file);
  }));
  Promise.all(readers).then(results => {
    for (const { text, name } of results) {
      const df = new window.DataFile(text);
      alertIfTruncated(df, name);
      const serialNumber = df.getHeaderValue("Software Information", "SerialNumber");
      const profile = lookupProfile(MACHINE_PROFILES, serialNumber);
      if (profile) applyChannelCorrections(df, profile);
      compareFiles.add(df, name);
    }
    rerenderCompare();
  });
}

/** @param {string} id */
function removeCompareFile(id) {
  compareFiles.remove(id);
  rerenderCompare();
}

/** Re-renders the whole Compare view — file shelf, dimension summary, template
 *  manager, toggle palette, and paginated preview — from current state. Called after
 *  every mutation (same "rebuild everything" pattern addCompareFiles/removeCompareFile
 *  already used before templates existed). NOT used for the print-triggered redraw
 *  (see redrawForPrint) — that goes through the narrower redrawComparePlots instead,
 *  which redraws onto already-existing canvases rather than rebuilding this whole
 *  tree (rebuilding fresh <canvas> elements inside the beforeprint handler itself
 *  was the actual cause of Compare's multi-chart print pages coming out blank). */
function rerenderCompare() {
  if (activeCompareTemplateId && !compareTemplates.get(activeCompareTemplateId)) activeCompareTemplateId = null;
  if (!activeCompareTemplateId && compareTemplates.list().length) activeCompareTemplateId = compareTemplates.list()[0].id;

  renderCompareView(byId("view-compare"), compareFiles, compareTemplates, activeCompareTemplateId, {
    onAddFiles: addCompareFiles,
    onRemoveFile: removeCompareFile,
    onNewTemplate: (title, defaultPageMode) => {
      activeCompareTemplateId = compareTemplates.add({ title, defaultPageMode }).id;
      rerenderCompare();
    },
    onDuplicateTemplate: (id, title) => {
      const copy = compareTemplates.duplicate(id, title);
      if (copy) activeCompareTemplateId = copy.id;
      rerenderCompare();
    },
    onRenameTemplate: (id, title) => { compareTemplates.rename(id, title); rerenderCompare(); },
    onDeleteTemplate: (id) => {
      compareTemplates.remove(id);
      if (activeCompareTemplateId === id) activeCompareTemplateId = null;
      rerenderCompare();
    },
    onSelectTemplate: (id) => { activeCompareTemplateId = id; rerenderCompare(); },
    onSetDefaultPageMode: (id, mode) => { compareTemplates.setDefaultPageMode(id, mode); rerenderCompare(); },
    onSetPageMode: (id, pageId, mode) => { compareTemplates.setPageMode(id, pageId, mode); rerenderCompare(); },
    // These two mutate the PICKER, not any template — see compareCurvePickerStandard's
    // own note above on why a template no longer carries a single standard/sensor.
    onSetStandard: (standardId) => {
      compareCurvePickerStandard = standardId;
      // Auto-pick the first available sensor right away, matching what the sensor
      // <select> shows by default (compareTemplateView.js falls back to
      // pickerSensors[0] visually) — without this, a standardPlot toggle clicked
      // before ever touching the sensor dropdown would read the picker sensor as
      // still null and refuse to plot, even though the dropdown visibly shows a choice.
      const df0 = compareFiles.list()[0] && compareFiles.list()[0].df;
      const sensors = (standardId && df0 && STANDARDS[standardId].availableSensors) ? STANDARDS[standardId].availableSensors(df0) : [];
      compareCurvePickerSensor = sensors.length ? sensors[0].key : null;
      compareCurvePickerSize = null;   // stale from a previous standard's own size pool otherwise
      rerenderCompare();
    },
    onSetStandardSensor: (sensor) => { compareCurvePickerSensor = sensor; rerenderCompare(); },
    onSetStandardSize: (size) => { compareCurvePickerSize = size; rerenderCompare(); },
    onAddPlot: (id, spec) => { const added = compareTemplates.addPlot(id, spec); rerenderCompare(); return added; },
    onRemovePlot: (id, plotId) => { compareTemplates.removePlot(id, plotId); rerenderCompare(); },
    standardCurveOptions: compareStandardCurveOptions(),
    availableSensorsFor: (standardId, df) => (STANDARDS[standardId].availableSensors ? STANDARDS[standardId].availableSensors(df) : []),
    pickerStandard: compareCurvePickerStandard,
    pickerSensor: compareCurvePickerSensor,
    pickerSize: compareCurvePickerSize,
    runStandardCurve
  });
}

// ---- Comparison template save/load (definitions only — reused across many file sets) ----
byId("saveCompareTemplatesBtn").addEventListener("click", () => {
  download("compare_templates.json", JSON.stringify(compareTemplates.toJSON(), null, 1), "application/json");
  byId("statusText").textContent = "Saved comparison templates " + new Date().toLocaleTimeString();
});

byId("loadCompareTemplatesBtn").addEventListener("click", () => byId("loadCompareTemplatesInput").click());
byId("loadCompareTemplatesInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      compareTemplates = CompareTemplateRegistry.fromJSON(JSON.parse(reader.result));
      activeCompareTemplateId = null;
      rerenderCompare();
      byId("statusText").textContent = "Loaded comparison templates from " + file.name;
    } catch (err) {
      byId("statusText").textContent = "Could not read " + file.name + ": not a valid comparison template file";
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});
//#endregion

//#region Machine Profiles
/* The user-editable per-rig directory (machineProfiles/machineProfilesStore.js) behind
   the Machine Profiles tab — see applyMachineProfileFields above for how a saved
   profile actually reaches a report. Unlike Compare's templates/customTabs, this is a
   flat Record<serialNumber, record> persisted straight to localStorage on every save/
   delete (no in-memory registry — rerenderMachineProfiles simply reloads the map fresh
   on every call rather than tracking a separate copy of it).

   Save/load AS A WHOLE FILE (added 2026-08-21, per the user: distributing a shared set
   of profiles to multiple terminals in an organization) is its own separate concern
   from the per-record onSave/onDelete above — see the save/load button handlers below,
   right after this function. */
function rerenderMachineProfiles() {
  renderMachineProfilesView(byId("view-machineProfiles"), loadMachineProfiles(), {
    onSave: (serialNumber, record) => {
      const profiles = loadMachineProfiles();
      profiles[serialNumber] = record;
      saveMachineProfiles(profiles);
      rerenderMachineProfiles();
      // Reflect the edit on an already-open report immediately, same immediacy the
      // gravimetric dialog's onSave already gives — this isn't a manual override, but
      // a rig fact that should feed the currently-loaded file's report right away.
      if (currentDf) runAnalysisPipeline(sourceFileName);
    },
    onDelete: (serialNumber) => {
      const profiles = loadMachineProfiles();
      delete profiles[serialNumber];
      saveMachineProfiles(profiles);
      rerenderMachineProfiles();
      if (currentDf) runAnalysisPipeline(sourceFileName);
    },
    currentSerialNumber: currentDf ? currentDf.getHeaderValue("Software Information", "SerialNumber") : null
  });
}

// ---- Whole-directory save/load — confirmed with the user, 2026-08-21: loading
// MERGES into this terminal's own local directory (imported entries win on a
// serial-number collision; any local-only profiles are left untouched), NOT a full
// replace like this app's own chart-tabs/comparison-templates load buttons — wiping
// out a terminal's own local-only profiles on every import would be actively
// destructive for the actual "distribute shared settings" use case this exists for. ----
byId("saveMachineProfilesBtn").addEventListener("click", () => {
  download("machine_profiles.json", JSON.stringify(loadMachineProfiles(), null, 1), "application/json");
  byId("statusText").textContent = "Saved machine profiles " + new Date().toLocaleTimeString();
});

byId("loadMachineProfilesBtn").addEventListener("click", () => byId("loadMachineProfilesInput").click());
byId("loadMachineProfilesInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a profile directory");
      const merged = Object.assign({}, loadMachineProfiles(), parsed);   // imported entries win on collision
      saveMachineProfiles(merged);
      rerenderMachineProfiles();
      if (currentDf) runAnalysisPipeline(sourceFileName);
      byId("statusText").textContent = "Loaded machine profiles from " + file.name +
        " (" + Object.keys(parsed).length + " entr" + (Object.keys(parsed).length === 1 ? "y" : "ies") + " merged in)";
    } catch (err) {
      byId("statusText").textContent = "Could not read " + file.name + ": not a valid machine profiles file";
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});
//#endregion

//#region standard switcher
/* Switching standards while a file is already loaded used to be a documented
   limitation ("reload the file after switching") — currentAnalysis/store stayed
   whatever the PREVIOUS standard computed, so the newly selected standard's report
   templates rendered against data that was never actually analyzed for them: mostly
   blank fields, and any control gated on currentAnalysis.ok (e.g. the "Select display
   sizes" button) staying hidden if the stale analysis happened not to validate under
   the standard it was actually computed for. Now that runAnalysisPipeline exists as
   its own reusable step (added for the sensor/display-size re-runs below), there's no
   reason to keep that limitation: re-run the SAME already-parsed currentDf through
   the newly selected standard's own analysis engine immediately.

   selectStandard is the shared operation both #standardSwitch (under Report) and
   #auditSwitch (under Audit — see its own region below) trigger; extracted so
   there's exactly one implementation of "make this the current standard," not two
   kept in sync by hand across the two pickers. */
function selectStandard(id) {
  if (id === currentStandardId) return;   // already selected — nothing to do
  currentStandardId = id;
  saveLastStandardId(currentStandardId);
  currentSensor = "lb";   // reset — a sensor choice from the previous standard has no meaning here
  currentPressureView = null;   // same reset, for the same reason
  if (currentDf) {
    runAnalysisPipeline(sourceFileName);   // re-analyzes the loaded file for the new standard; also updates visibility
    // Covers the "load a file, THEN switch to ISO 3968" order — loadFileText's own
    // call only fires when ISO 3968 was ALREADY selected at load time. tarePromptShown
    // stays false in exactly this case (it's only reset by a genuinely new file
    // load), so this won't re-ask if the user already answered under ISO 3968 and
    // switched away and back.
    maybePromptForTareFile();
    // Same "covers the load-then-switch order" reasoning as maybePromptForTareFile's
    // own comment just above, own copy for the companion-file case.
    maybePromptForCompanionFile();
  } else {
    applyPersistedCustomDefaults(store);   // no file yet — just carry the new standard's own persisted defaults
    if (byId("view-report").classList.contains("active")) {
      renderReportPages(byId("view-report"), store, byId("unitSelect").value, pagesForCurrentStandard())
        .catch(err => console.error("Report render failed:", err));
    }
    updateReportingControlsVisibility();
  }
  document.querySelectorAll("#standardSwitch button").forEach(sb => sb.classList.toggle("active", sb.dataset.standard === id));
  syncAuditSwitchActiveState();   // keep #auditSwitch's own highlight in sync too, even when triggered from Report
}
document.querySelectorAll("#standardSwitch button").forEach(b => {
  b.addEventListener("click", () => selectStandard(b.dataset.standard));
});
//#endregion

//#region audit switcher
/* Audit's OWN picker (#auditSwitch, index.html) — deliberately separate from
   #standardSwitch above: lists the same 4 real standards (each has its own
   AuditSteps.js, per auditView.js's AUDIT_STANDARDS registry) PLUS the Data File
   Explorer's own raw-parsing checks, which #standardSwitch has no equivalent of.
   Picking a real standard here calls the exact same selectStandard() #standardSwitch
   uses (full re-analysis, tare prompts, etc. — reachable without detouring through
   Report first); picking "Data File Explorer" only changes what the Audit view
   itself displays — see auditSelectedId's own comment. */
function effectiveAuditId() {
  return auditSelectedId || currentStandardId;
}
function syncAuditSwitchActiveState() {
  const id = effectiveAuditId();
  document.querySelectorAll("#auditSwitch button").forEach(b => b.classList.toggle("active", b.dataset.audit === id));
}
document.querySelectorAll("#auditSwitch button").forEach(b => {
  b.addEventListener("click", () => {
    const id = b.dataset.audit;
    if (id === "explorer") {
      auditSelectedId = "explorer";
      syncAuditSwitchActiveState();
    } else {
      selectStandard(id);   // no-ops (but still falls through below) if already the current standard
      auditSelectedId = null;
      syncAuditSwitchActiveState();
    }
    if (byId("view-audit").classList.contains("active")) {
      renderAuditPage(byId("view-audit"), store, effectiveAuditId());
    }
  });
});
//#endregion

//#region standard compatibility (sidebar disable + tooltip)
/* Once a file is loaded, a standard whose own isCompatible(df) rejects the file's
   TestType gets its sidebar button disabled with a title tooltip — steers the user
   toward the standard that actually applies (a cyclic-flow file only works under ISO
   23369, a P-Q file only under ISO 3968, etc.) instead of letting them pick a
   standard whose report will just show today's "wrong test type" rejection. No file
   loaded -> every standard stays enabled (inspecting any standard's blank template
   is still allowed, per the user).

   The CURRENTLY selected standard/audit entry is never disabled here even when
   incompatible — per the user, an already-mismatched selection should "stay put"
   and keep showing its own existing rejection message (driven by currentAnalysis.
   errors, same as always), not be yanked out from under the user or show a
   contradictory disabled-but-active button.

   A CyclicCompanionFile loaded standalone (Explorer-only, no .testType at all) is
   naturally incompatible with EVERY standard here for free: isCompatible(df) reads
   df.testType, which is undefined on that class, and no standard's own
   VALID_TEST_TYPES list contains undefined — no special case needed to get "a
   companion file disables every standard" out of the same generic check. */
function updateStandardCompatibility() {
  const disabledReason = (id) => {
    if (currentDf instanceof window.CyclicCompanionFile) {
      return "This is a cyclic companion file (“-Cyclic.DAT”) — it can only be explored, not analyzed by any standard. Load its matching primary .DAT file to report against " + STANDARDS[id].label + ".";
    }
    return STANDARDS[id].label + " does not apply to this file's test type (“" + (currentDf.testType || "none") + "”).";
  };
  document.querySelectorAll("#standardSwitch button").forEach(b => {
    const id = b.dataset.standard;
    const compatible = !currentDf || id === currentStandardId || STANDARDS[id].isCompatible(currentDf);
    b.disabled = !compatible;
    b.title = compatible ? "" : disabledReason(id);
  });
  document.querySelectorAll("#auditSwitch button").forEach(b => {
    const id = b.dataset.audit;
    if (id === "explorer") return;   // the generic Explorer handles every file kind — never disabled
    const compatible = !currentDf || id === effectiveAuditId() || STANDARDS[id].isCompatible(currentDf);
    b.disabled = !compatible;
    b.title = compatible ? "" : disabledReason(id);
  });
}
//#endregion

//#region report empty-state banner
/* Shown only while no file is loaded — orients a first-time visitor to what they're
   looking at (a blank standard template, previewable on purpose — see the standard
   switcher's own "inspecting any standard's blank template is still allowed" note
   just above) rather than leaving the fully-blank report to speak for itself. Lives
   in #context-report's own #reportEmptyStateHint element (index.html), never inside
   #view-report itself — renderReportPages fully replaces that container's innerHTML
   on every re-render (standard switch, sensor switch, ...), which would wipe
   anything prepended there. Per the user, 2026-08-21. */
function updateReportEmptyStateBanner() {
  const banner = byId("reportEmptyStateHint");
  if (currentDf) {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "";
  banner.textContent = "You're previewing the " + STANDARDS[currentStandardId].label +
    " report template with no file loaded. Load a .DAT file (top left) to fill it in " +
    "— switch standards any time, even with a file loaded, to see how the same data " +
    "reports under a different one.";
}
//#endregion

//#region sensor + display-size selection
/* The Sensor dropdown and "Select display sizes" button only matter while looking at
   a Report for a standard that actually has a sensor choice — hidden the rest of the
   time (Explorer/Compare views, ISO 3968, or a file with only one usable sensor)
   rather than always visible-but-irrelevant. Re-run after every view switch,
   standard switch, and file/sensor/size change — see the call sites below. */
function updateReportingControlsVisibility() {
  updateStandardCompatibility();
  updateReportEmptyStateBanner();
  const reportActive = byId("view-report").classList.contains("active");
  const standard = STANDARDS[currentStandardId];
  const sensors = (reportActive && standard.availableSensors && currentDf) ? standard.availableSensors(currentDf) : [];
  const showSensor = sensors.length > 1;
  const pressureViews = (reportActive && standard.availablePressureViews && currentDf) ? standard.availablePressureViews(currentDf) : [];
  const showPressureView = pressureViews.length > 1;   // same "hide if nothing to actually pick" rule as sensor
  const showDisplaySizes = reportActive && !!standard.availableSensors && !!currentAnalysis && currentAnalysis.ok;
  const showGravimetric = reportActive && !!standard.gravimetricSpecs && !!currentAnalysis && currentAnalysis.ok;
  const showTare = reportActive && !!standard.usesTareFile && !!currentAnalysis && currentAnalysis.ok;
  const showCompanion = reportActive && !!standard.usesCompanionFile && !!currentAnalysis && currentAnalysis.ok;
  // Unlike showDisplaySizes/showGravimetric, NOT gated on currentAnalysis.ok — this is
  // a report-shape preference like paper size, settable whether or not a file is
  // currently loaded/valid.
  const showAddCountDetails = reportActive && !!standard.hasCountDetails;

  byId("sensorDivider").style.display = showSensor ? "" : "none";
  byId("sensorGroup").style.display = showSensor ? "" : "none";
  byId("pressureViewDivider").style.display = showPressureView ? "" : "none";
  byId("pressureViewGroup").style.display = showPressureView ? "" : "none";
  byId("displaySizesGroup").style.display = showDisplaySizes ? "" : "none";
  byId("gravimetricGroup").style.display = showGravimetric ? "" : "none";
  byId("tareGroup").style.display = showTare ? "" : "none";
  if (showTare) byId("tareBtn").textContent = tareDf ? "Change Tare File (" + tareFileName + ")" : "Add Tare File";
  byId("companionGroup").style.display = showCompanion ? "" : "none";
  if (showCompanion) {
    byId("companionBtn").textContent = companionDf ? "Change Companion File (" + companionFileName + ")" : "Add Companion File";
    byId("companionBtn").classList.toggle("warn-btn", !companionDf);
  }
  byId("addCountDetailsGroup").style.display = showAddCountDetails ? "" : "none";
  if (showAddCountDetails) byId("addCountDetailsCheck").checked = loadAddCountDetails(currentStandardId);

  if (showSensor) populateSensorSelect(sensors);
  if (showPressureView) populatePressureViewSelect(pressureViews);

  // Warnings button: visible whenever there's a loaded file's worth of issues to
  // show, regardless of currentAnalysis.ok — a failed analysis (e.g. the 25-minute
  // test-time cutoff) is exactly the case where the button matters most, since
  // currentAnalysis.errors is the only place that reason is explained in full.
  // gravimetricWarnings (ISO 16889 only — see recomputeIso16889GravimetricDerived)
  // is read defensively; the other standards simply never set that field.
  const warningsBtn = byId("warningsBtn");
  const issueCount = currentAnalysis
    ? currentAnalysis.errors.length + currentAnalysis.warnings.length +
      (currentAnalysis.gravimetricWarnings || []).length +
      currentControlResults.filter(r => r.applicable && !r.ok).length
    : 0;
  warningsBtn.style.display = (reportActive && issueCount) ? "" : "none";
  warningsBtn.textContent = "⚠ Warnings (" + issueCount + ")";
}

/** @param {Array<{key:string,label:string}>} sensors */
function populateSensorSelect(sensors) {
  const select = byId("sensorSelect");
  select.innerHTML = "";
  for (const s of sensors) {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.label;
    select.appendChild(opt);
  }
  if (!sensors.find(s => s.key === currentSensor)) currentSensor = sensors[0].key;
  select.value = currentSensor;
}

byId("sensorSelect").addEventListener("change", (e) => {
  currentSensor = e.target.value;
  if (currentDf) runAnalysisPipeline(sourceFileName);
});

/** @param {Array<{key:string,label:string}>} views */
function populatePressureViewSelect(views) {
  const select = byId("pressureViewSelect");
  select.innerHTML = "";
  for (const v of views) {
    const opt = document.createElement("option");
    opt.value = v.key;
    opt.textContent = v.label;
    select.appendChild(opt);
  }
  if (!views.find(v => v.key === currentPressureView)) currentPressureView = views[0].key;
  select.value = currentPressureView;
}

byId("pressureViewSelect").addEventListener("change", (e) => {
  currentPressureView = e.target.value;
  if (currentDf) runAnalysisPipeline(sourceFileName);
});

byId("displaySizesBtn").addEventListener("click", () => {
  if (!currentDf || !currentAnalysis || !currentAnalysis.ok) return;
  const displaySizesView = STANDARDS[currentStandardId].displaySizesView;
  if (!displaySizesView) return;
  displaySizesView.openDialog({
    availableSizes: currentAnalysis.sizes || [],
    currentSizes: store.getExtra("resolvedDisplaySizes") || [],
    onSave: (sizes) => {
      displaySizesView.save(currentStandardId, currentSensor, sizes);
      runAnalysisPipeline(sourceFileName);
    }
  });
});

/* "Add Count Details" toggle: only changes WHICH pages render (pagesForCurrentStandard
   reads the persisted flag) — no store data changes, so unlike display sizes this just
   re-renders rather than re-running the whole analysis pipeline. */
byId("addCountDetailsCheck").addEventListener("change", (e) => {
  saveAddCountDetails(currentStandardId, e.target.checked);
  renderReportPages(byId("view-report"), store, byId("unitSelect").value, pagesForCurrentStandard())
    .catch(err => console.error("Report render failed:", err));
});

/* Gravimetric entry's onSave deliberately does NOT call runAnalysisPipeline (unlike
   display sizes above) — that rebuilds `store` from scratch and would silently
   discard any OTHER manual edit made earlier in the session (Housing Type, Filter ID,
   ...), which matters a lot more here: lab gravimetric results often come back days
   after everything else on a report was already filled in. Instead it writes directly
   into the existing store and just re-renders. */
byId("gravimetricBtn").addEventListener("click", () => {
  const standard = STANDARDS[currentStandardId];
  if (!currentDf || !currentAnalysis || !currentAnalysis.ok || !standard.gravimetricSpecs) return;

  const currentValues = {};
  for (const spec of standard.gravimetricSpecs) currentValues[spec.id] = toNumber(store.get(spec.id));

  openGravimetricDialog({
    specs: standard.gravimetricSpecs,
    currentValues,
    onSave: (results) => {
      for (const [id, value] of Object.entries(results)) {
        if (value === null) store.clearUserEntry(id);
        else store.setUserEntry(id, value);
      }
      recomputeGravimetricDerived(currentStandardId);
      // gravimetricWarnings (ISO 16889 only) can change here — refresh the toolbar
      // button/count immediately rather than waiting for the next file load or
      // standard switch (the only other places this already runs).
      updateReportingControlsVisibility();
      refreshReport(byId("view-report"), store, byId("unitSelect").value);
    }
  });
});

// Skips the yes/no tare prompt (openTarePrompt) — clicking this button already IS
// the "yes." Works both for adding a tare that was declined at load time, and for
// swapping in a different tare file later.
byId("tareBtn").addEventListener("click", () => {
  const standard = STANDARDS[currentStandardId];
  if (!currentDf || !currentAnalysis || !currentAnalysis.ok || !standard.usesTareFile) return;
  byId("tareFileInput").click();
});
byId("tareFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) readTareFile(file);
});

// Skips the companion-file prompt (openCompanionFilePrompt) — clicking this button
// already IS the request. Works both for adding a companion file that was skipped
// at load time, and for swapping in a different one later.
byId("companionBtn").addEventListener("click", () => {
  const standard = STANDARDS[currentStandardId];
  if (!currentDf || !currentAnalysis || !currentAnalysis.ok || !standard.usesCompanionFile) return;
  byId("companionFileInput").click();
});
byId("companionFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) readCompanionFile(file);
});

// Global letterhead, not per-file — no currentDf/currentAnalysis gate, unlike
// tareBtn/companionBtn above.
byId("companyLogoBtn").addEventListener("click", () => byId("companyLogoFileInput").click());
byId("companyLogoFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) readCompanyLogoFile(file);
});
byId("removeCompanyLogoBtn").addEventListener("click", () => {
  clearCompanyLogo();
  updateCompanyLogoButtonState();
  refreshReport(byId("view-report"), store, byId("unitSelect").value);
});

byId("warningsBtn").addEventListener("click", () => {
  if (!currentAnalysis) return;
  const standard = STANDARDS[currentStandardId];
  openWarningsDialog({
    standardLabel: standard.label,
    fileName: sourceFileName,
    errors: currentAnalysis.errors,
    warnings: [...currentAnalysis.warnings, ...(currentAnalysis.gravimetricWarnings || [])],
    controlFailures: currentControlResults.filter(r => r.applicable && !r.ok)
  });
});

/* Injection grav. Average, Non-Retained Mass, and Retained Capacity all DERIVE from
   Initial/Final/Gf (see iso454812Analysis.js's computeMassBalance) rather than being
   entered directly — recomputed from whatever's CURRENTLY resolved in the store
   (store.get, not a specific save's results), so this gives the same answer whether
   it's called right after the gravimetric dialog saves, or after runAnalysisPipeline
   restores previously-entered values following a sensor/standard switch. Without this
   second call site, Initial/Final/Gf themselves would survive a sensor switch (see
   runAnalysisPipeline's User Entry preservation) but these three derived fields would
   silently go blank again, since nothing else ever recomputes them. */
function recomputeIso454812GravimetricDerived() {
  const initialGrav = toNumber(store.get("injectionGravInitial"));
  const finalGrav = toNumber(store.get("injectionGravFinal"));
  if (initialGrav !== null && finalGrav !== null) {
    store.setFromData("injectionGravAverage", ((initialGrav + finalGrav) / 2).toFixed(1));
  }

  // testVolumeFinal (Vf), not testVolume (initial) — iso454812Mapper.js now defaults
  // Vf to the initial Volume, but a hand-edited Vf must actually feed this
  // calculation, not be silently ignored in favor of the original initial-volume
  // read (which is what reading "testVolume" here unconditionally would do).
  // Retained mass is not a valid figure for a Single-Pass/Multipass Series test OR a
  // dual-filter (Two Pressure/Suction & Pressure) Setup (per the user, 2026-07-31/
  // 2026-08-03 — see iso454812Analysis.js's NON_STANDARD_TEST_TYPES/
  // DUAL_FILTER_RETAINED_MASS_REASON notes): leave nonRetainedMassMnr/
  // retainedCapacityCr unset entirely rather than computing a number the standard
  // doesn't actually support reporting. The template's retainedMassNote field (set
  // by iso454812Mapper.js) explains why on the page itself.
  if (currentAnalysis && (currentAnalysis.nonStandardTestType || currentAnalysis.dualFilterSetup)) return;

  const testVolume = toNumber(store.get("testVolumeFinal"));
  const gf = toNumber(store.get("finalGravimetricGf"));
  const injectedMass = currentAnalysis ? currentAnalysis.injectedMass : null;
  const { nonRetainedMass, retainedCapacity } = window.Iso454812Analysis.computeMassBalance({ testVolume, gf, injectedMass });
  if (nonRetainedMass !== null) store.setFromData("nonRetainedMassMnr", nonRetainedMass.toFixed(2));
  if (retainedCapacity !== null) store.setFromData("retainedCapacityCr", retainedCapacity.toFixed(2));
}

/* ISO 19438's own version of the same derive-on-recompute need above — own function,
   not shared, per CLAUDE.md (the formula itself is genuinely different — see
   iso19438Analysis.js's computeMassBalance). Needs more inputs than 4548-12's: Vf
   (final test system volume, hand-entered — see the STANDARDS registry note on why
   it's not part of the gravimetric dialog) and Qd/Qu/Ga/terminationMinutes, all
   already resolved on currentAnalysis at load time. */
function recomputeIso19438GravimetricDerived() {
  const initialGrav = toNumber(store.get("injectionGravInitial"));
  const finalGrav = toNumber(store.get("injectionGravFinal"));
  if (initialGrav !== null && finalGrav !== null) {
    store.setFromData("injectionGravAverage", ((initialGrav + finalGrav) / 2).toFixed(1));
  }

  // Retained mass is not a valid figure for a Single-Pass/Multipass Series test OR a
  // dual-filter (Two Pressure/Suction & Pressure) Setup (per the user, 2026-07-31/
  // 2026-08-03 — see iso19438Analysis.js's NON_STANDARD_TEST_TYPES/
  // DUAL_FILTER_RETAINED_MASS_REASON notes): leave nonRetainedMassMnr/
  // retainedCapacityCr unset entirely rather than computing a number the standard
  // doesn't actually support reporting. The template's retainedMassNote field (set
  // by iso19438Mapper.js) explains why on the page itself.
  if (currentAnalysis && (currentAnalysis.nonStandardTestType || currentAnalysis.dualFilterSetup)) return;

  const vf = toNumber(store.get("testVolumeFinal"));
  const gf = toNumber(store.get("finalGravimetricGf"));
  const qd = currentAnalysis ? currentAnalysis.qd : null;
  const qu = currentAnalysis ? currentAnalysis.qu : null;
  const ga = currentAnalysis ? currentAnalysis.ga : null;
  const terminationMinutes = (currentAnalysis && currentAnalysis.terminationTime !== null) ? currentAnalysis.terminationTime / 60 : null;
  const injectedMass = currentAnalysis ? currentAnalysis.injectedMass : null;
  const { nonRetainedMass, retainedCapacity } = window.Iso19438Analysis.computeMassBalance({ vf, gf, qd, qu, ga, terminationMinutes, injectedMass });
  if (nonRetainedMass !== null) store.setFromData("nonRetainedMassMnr", nonRetainedMass.toFixed(2));
  if (retainedCapacity !== null) store.setFromData("retainedCapacityCr", retainedCapacity.toFixed(2));
}

/* ISO 16889:2022's own version — own function, not shared, per CLAUDE.md. Two
   differences from the other two standards' versions: the field being derived is
   named isoMtdMassInjected/isoMtdRetainedCapacity here (this standard's own report
   terms), not nonRetainedMassMnr/retainedCapacityCr; and it ALSO evaluates
   checkGravimetricAcceptance (12.9's per-sample check, 12.12's Average_BUGL check)
   into currentAnalysis.gravimetricWarnings — a SEPARATE array from
   currentAnalysis.warnings, always REASSIGNED here (never appended), so repeated
   gravimetric edits don't accumulate duplicate warnings. The warnings dialog and
   the toolbar button's issue count both read this array too (see below) — plain
   analysis-level warnings, not routed through the generic control-target engine,
   since both checks need hand-entered values that engine has no way to read (see
   iso16889ControlTargets.js's own header comment). */
function recomputeIso16889GravimetricDerived() {
  const initialGrav = toNumber(store.get("injectionGravInitial"));
  const finalGrav = toNumber(store.get("injectionGravFinal"));
  let injectionGravAverage = null;
  if (initialGrav !== null && finalGrav !== null) {
    injectionGravAverage = (initialGrav + finalGrav) / 2;
    store.setFromData("injectionGravAverage", injectionGravAverage.toFixed(1));
  }

  const testFinalGrav = toNumber(store.get("finalGravimetricGf"));
  const testFinalVolume = toNumber(store.get("testVolumeFinal"));
  const qia = currentAnalysis ? currentAnalysis.qia : null;
  const qd = currentAnalysis ? currentAnalysis.qd : null;
  const testFlowSetpoint = currentAnalysis ? currentAnalysis.testFlowSetpoint : null;
  const terminationMinutes = (currentAnalysis && currentAnalysis.terminationTime !== null) ? currentAnalysis.terminationTime / 60 : null;

  const { dustInjected, dustRetained } = window.Iso16889Analysis.computeMassBalance({
    injectionGravAverage, testFinalGrav, testFinalVolume, qia, qd, terminationMinutes, testFlowSetpoint
  });
  if (dustInjected !== null) store.setFromData("isoMtdMassInjected", dustInjected.toFixed(2));
  // Retained capacity is not a valid figure for a Single-Pass/Multipass Series test
  // OR a dual-filter (Two Pressure/Suction & Pressure) Setup (per the user,
  // 2026-07-31/2026-08-03 — see iso16889Analysis.js's NON_STANDARD_TEST_TYPES/
  // DUAL_FILTER_RETAINED_MASS_REASON notes): dustInjected above stays valid (it's
  // just mass injected, not filter-specific), but leave isoMtdRetainedCapacity
  // unset. The template's retainedMassNote field (set by iso16889Mapper.js)
  // explains why on the page itself.
  if (dustRetained !== null && !(currentAnalysis && (currentAnalysis.nonStandardTestType || currentAnalysis.dualFilterSetup))) {
    store.setFromData("isoMtdRetainedCapacity", dustRetained.toFixed(2));
  }

  // Page 1's "Differential pressure versus contaminant added" table's Injected
  // mass column (13.4: Mass_Injected_By_Analog_Time, one value per reporting-time
  // clump) — needs the SAME injectionGravAverage/qia this function already has, so
  // it lives here rather than at analysis run() time (iso16889Mapper.js leaves
  // these blank initially for exactly this reason). Runs on every call site this
  // function already has (initial load via the header-fallback average, and again
  // after a real gravimetric entry), so the column is populated from the start,
  // not just after someone opens the gravimetric dialog.
  if (currentAnalysis && injectionGravAverage !== null && qia !== null) {
    for (const clump of currentAnalysis.clumps) {
      const massG = (injectionGravAverage * (qia / 1000) * clump.testTimeMin) / 1000;
      store.setFromData("dpClump" + clump.percent + "InjectedMass", massG.toFixed(2));
    }
  }

  if (currentAnalysis) {
    // injectionFlowSetpoint (with injectionGravSetpoint/testFlowSetpoint) is what
    // 12.12's target Average_BUGL gets DERIVED from inside checkGravimetricAcceptance
    // — there's no separate "BUGL setpoint" header value to pass through here (see
    // iso16889Analysis.js's own comment on that fix).
    // 12.12's Average_BUGL is only valid for Filter 1 — per the user (2026-08-03),
    // the particle-size distribution challenging Filter 2 is necessarily modified by
    // having already passed through Filter 1, so there's no independently-known
    // "what challenged Filter 2" quantity to compare a BUGL target against. Scoped
    // to the MidstreamFlag:true per-filter-view case only — MidstreamFlag:false
    // dual-Setup files have no per-filter view concept to guard.
    const suppressBugl = !!(currentDf && currentDf.midstreamFlag && currentAnalysis.sensor !== "lb");
    currentAnalysis.gravimetricWarnings = window.Iso16889Analysis.checkGravimetricAcceptance({
      injectionGravInitial: initialGrav,
      injectionGravFinal: finalGrav,
      injectionGravSetpoint: currentAnalysis.injectionGravSetpoint,
      injectionFlowSetpoint: currentAnalysis.injectionFlowSetpoint,
      testFlowSetpoint,
      injectionGravAverage, qia, suppressBugl
    });
  }
}

/* ISO 23369:2022's own version — own function, not shared, per CLAUDE.md. Same
   overall shape as recomputeIso16889GravimetricDerived (isoMtdMassInjected/
   isoMtdRetainedCapacity field names, gravimetricWarnings array, per-bucket
   injected-mass column), with the real formula differences iso23369Analysis.js's
   own computeMassBalance/computeAverageBUGL already carry: injVolumeFinal (not a
   test-system volume) feeds term 1, qu/qd both feed the mass balance (not qd
   alone), and q_bar (not a single steady flow setpoint) is the BUGL denominator. */
function recomputeIso23369GravimetricDerived() {
  const initialGrav = toNumber(store.get("injectionGravInitial"));
  const finalGrav = toNumber(store.get("injectionGravFinal"));
  let injectionGravAverage = null;
  if (initialGrav !== null && finalGrav !== null) {
    injectionGravAverage = (initialGrav + finalGrav) / 2;
    store.setFromData("injectionGravAverage", injectionGravAverage.toFixed(1));
  }

  const testFinalGrav = toNumber(store.get("finalGravimetricGf"));
  const injVolumeFinal = toNumber(store.get("injSystemVolumeFinal"));
  const qia = currentAnalysis ? currentAnalysis.qia : null;
  const qu = currentAnalysis ? currentAnalysis.qu : null;
  const qd = currentAnalysis ? currentAnalysis.qd : null;
  const qAvg = currentAnalysis ? currentAnalysis.qAvg : null;
  const terminationMinutes = (currentAnalysis && currentAnalysis.terminationTime !== null) ? currentAnalysis.terminationTime / 60 : null;

  const { dustInjected, dustRetained } = window.Iso23369Analysis.computeMassBalance({
    injectionGravAverage, testFinalGrav, injVolumeFinal, qia, qu, qd, terminationMinutes, qAvg
  });
  if (dustInjected !== null) store.setFromData("isoMtdMassInjected", dustInjected.toFixed(2));
  // Retained capacity is not a valid figure for a Cyclic Series Multipass test OR a
  // dual-filter Setup — same reasoning as ISO 16889's own identical guard.
  if (dustRetained !== null && !(currentAnalysis && (currentAnalysis.nonStandardTestType || currentAnalysis.dualFilterSetup))) {
    store.setFromData("isoMtdRetainedCapacity", dustRetained.toFixed(2));
  }

  // Page 1's DP-vs-contaminant table's Injected mass column (13.2, one value per
  // reporting-time bucket) — same formula/reasoning as ISO 16889's own identical block.
  if (currentAnalysis && injectionGravAverage !== null && qia !== null) {
    for (const clump of currentAnalysis.clumps) {
      const massG = (injectionGravAverage * (qia / 1000) * clump.testTimeMin) / 1000;
      store.setFromData("dpClump" + clump.percent + "InjectedMass", massG.toFixed(2));
    }
  }

  if (currentAnalysis) {
    // Same MidstreamFlag+per-filter-view BUGL-suppression scope as ISO 16889's own
    // identical guard — see that function's own comment for the full reasoning.
    const suppressBugl = !!(currentDf && currentDf.midstreamFlag && currentAnalysis.sensor !== "lb");
    currentAnalysis.gravimetricWarnings = window.Iso23369Analysis.checkGravimetricAcceptance({
      injectionGravInitial: initialGrav,
      injectionGravFinal: finalGrav,
      injectionGravSetpoint: currentAnalysis.injectionGravSetpoint,
      injectionFlowSetpoint: currentAnalysis.injectionFlowSetpoint,
      qAvg,
      injectionGravAverage, qia, suppressBugl
    });
  }
}

/** @param {string} standardId */
function recomputeGravimetricDerived(standardId) {
  if (standardId === "iso16889") recomputeIso16889GravimetricDerived();
  else if (standardId === "iso454812") recomputeIso454812GravimetricDerived();
  else if (standardId === "iso19438") recomputeIso19438GravimetricDerived();
  else if (standardId === "iso23369") recomputeIso23369GravimetricDerived();
}

/** ISO 3968 only — runs the tare (empty-housing) file through its OWN, independent
 *  Iso3968Analysis.run() call (no tare-of-a-tare) so iso3968Mapper.js can populate
 *  Page 2's Table 2. Same per-standardId dispatch shape as
 *  recomputeGravimetricDerived just above, for the same reason: this behavior
 *  doesn't generalize to the other standards, so it stays an explicit switch here
 *  rather than a new STANDARDS-registry function slot for a single current user.
 *  @param {string} standardId @param {DataFile|null} tareDf @returns {*|null} */
function computeTareAnalysis(standardId, tareDf) {
  if (!tareDf) return null;
  if (standardId === "iso3968") return window.Iso3968Analysis.run(tareDf);
  return null;
}
//#endregion

//#region custom plot tabs (Explorer view)
function rerenderExplorer() {
  if (!currentDf) {
    // Nothing else ever writes to #view-explorer before a file loads (renderExplorer
    // itself is never called until currentDf is real) — without this it stays a
    // literal empty <div>, per the user, 2026-08-21. Plain innerHTML, not
    // explorerView.js's own el() helper: that's a private, unexported function, and
    // one static hint-box with no event handlers doesn't warrant a new export for it.
    byId("view-explorer").innerHTML = '<div class="hint-box">Load a .DAT file above to ' +
      "explore its raw contents — header info, analog channels, particle counts — " +
      "before generating a report. A cyclic test's own “-Cyclic.DAT” companion file " +
      "can be loaded here directly too, to inspect it on its own.</div>";
    return;
  }
  // Destroy any live charts BEFORE renderExplorer wipes the container — a tab's own
  // cleanup hook handles switching between tabs within one render, but a full
  // re-render (new file, tab added/removed) replaces the whole container at once.
  destroyChartsIn(byId("view-explorer"));
  renderExplorer(byId("view-explorer"), currentDf, sourceFileName, {
    extraTabs: buildCustomTabDefs(customTabs, onRemoveTab),
    onAddTab: () => openCreateTabDialog(currentDf, onTabCreated),
    activeTabId: activeExplorerTabId,
    onTabChange: (id) => { activeExplorerTabId = id; },
    // ISO 23369 only, whenever it's populated — a primary file's own attached
    // "-Cyclic.DAT" companion (see companionDf's own declaration) gets its own
    // Explorer tab alongside the primary file's normal tabs, not just when a
    // companion file is loaded standalone (explorerView.js's isCyclicCompanion
    // branch handles that other case). Harmless to always pass: explorerView.js
    // itself checks companionDf.dataExist before doing anything with it.
    companionDf
  });
}

/** @param {{title:string, kind:string, channels?:string[], sensorKey?:string}} definition */
function onTabCreated(definition) {
  const tab = customTabs.add(definition);
  activeExplorerTabId = tab.id;   // jump straight to the new tab
  rerenderExplorer();
}

/** @param {string} id */
function onRemoveTab(id) {
  customTabs.remove(id);
  if (activeExplorerTabId === id) activeExplorerTabId = null;
  rerenderExplorer();
}
//#endregion

//#region file intake & analysis pipeline
/** Pops a blocking alert when a just-loaded file needed data recovery (see
 *  dataFile.js's `truncated` flag) — a real, known failure mode (e.g. a power
 *  outage halting the machine mid-test), not just a formatting quirk, so it's
 *  surfaced immediately rather than left to Explorer's own passive warning line
 *  (df.warnings), which someone opening straight into Report/Compare would never
 *  see. Called from every site that constructs a DataFile a user is actively
 *  trying to review — same risk (a report/comparison silently built from less
 *  than the full intended test) regardless of which load path it came through.
 *  @param {DataFile} df @param {string} [label] e.g. a compare file's own name, so
 *  a multi-file load's alerts don't all read as if they're about the same file */
function alertIfTruncated(df, label) {
  if (!df.truncated) return;
  const prefix = label ? "\"" + label + "\" looks incomplete: " : "This file looks incomplete: ";
  alert(prefix + df.warnings.join(" ") +
    "\n\nThis can happen when a test is interrupted (e.g. a power outage). Whatever was built from it uses only the complete data that was recovered.");
}

/** @param {string} text raw .DAT file contents @param {string} name display filename */
function loadFileText(text, name) {
  sourceFileName = name;
  sourceFileText = text;
  currentSensor = "lb";   // always reset on a new file load — see the sensor-selector decision
  currentPressureView = null;   // same reset, for the same reason
  // A genuinely NEW primary file means any previously-loaded tare no longer applies
  // (it was a reference run for a DIFFERENT test) — same reasoning as the sensor/
  // pressure-view resets just above.
  tareDf = null;
  tareFileName = "";
  tareFileText = "";
  tarePromptShown = false;
  // Same reasoning as the tare reset just above: a previously-loaded cyclic
  // companion file was paired with the OLD primary file, not this new one.
  companionDf = null;
  companionFileName = "";
  companionFileText = "";
  companionPromptShown = false;
  // A genuinely NEW file must not inherit the previous file's manual edits — reset
  // here explicitly. runAnalysisPipeline (below) no longer resets the store itself;
  // it preserves User Entries across a re-run so re-analyzing the SAME file (sensor
  // switch, display-size save, standard switch) doesn't discard them.
  store = new ReportValueStore();

  // The "Load data file" button accepts either of the two real .DAT-family shapes —
  // the primary format, or a cyclic test's own "-Cyclic.DAT" companion loaded
  // standalone (see core/cyclicCompanionFile.js's own header comment for why these
  // are genuinely different formats, not variants of one). Try the primary format
  // first (the overwhelmingly common case). primaryAttempt.sections.length===0 (NOT
  // !dataExist alone) is the precise "this text isn't DataFile-shaped at all"
  // signal — a valid header-only DataFile (real HEADER/ENDHEADER, no DATA marker
  // yet) still has real sections, just no records, and must NOT be misdetected as a
  // companion file.
  const primaryAttempt = new window.DataFile(text);
  if (primaryAttempt.sections.length > 0) {
    currentDf = primaryAttempt;
    alertIfTruncated(currentDf);

    // Machine profile: fix known per-rig data-recording quirks BEFORE analysis runs,
    // so everything downstream (the analysis engine, custom tabs, the report) sees correct SI.
    // Stashed in currentProfile (not a local) because runAnalysisPipeline needs it again
    // on every sensor/display-size re-run, not just this first one.
    const serialNumber = currentDf.getHeaderValue("Software Information", "SerialNumber");
    currentProfile = lookupProfile(MACHINE_PROFILES, serialNumber);
    if (currentProfile) {
      const corrected = applyChannelCorrections(currentDf, currentProfile);
      if (corrected.length) console.info("Machine profile (" + serialNumber + ") corrected channels:", corrected.join(", "));
    }
  } else {
    // Not DataFile-shaped — try the cyclic companion format. A companion file has
    // no TestType/header at all, so it's explorable but never analyzable under any
    // standard — runAnalysisPipeline's own guard (see its own comment) takes this
    // straight to Explorer-only behavior rather than needing every call site here
    // to know to skip analysis. Falls back to the primary parser's own (failed)
    // result when NEITHER shape matches, so an actually-unrecognized file still
    // surfaces DataFile's own established "doesn't look like a valid data file"
    // warning exactly as it always has.
    const companionAttempt = new window.CyclicCompanionFile(text);
    currentDf = companionAttempt.dataExist ? companionAttempt : primaryAttempt;
    currentProfile = null;
  }

  runAnalysisPipeline(name);
  maybePromptForTareFile();
  maybePromptForCompanionFile();
}

/* maybePromptForTareFile: per the user, 2026-08-03 — after a P-Q file loads, ask
   whether a matching tare (empty-housing) run should be supplied too. Gated on
   standard.usesTareFile (ISO 3968 only) rather than a hardcoded standardId check,
   and on tarePromptShown so switching sensors/standards/tabs afterward doesn't
   re-ask — only a genuinely NEW primary file (which resets tarePromptShown in
   loadFileText) does. Declining just closes the dialog; the toolbar's tare button
   (see updateReportingControlsVisibility) stays available to add one later without
   re-showing this yes/no prompt, since clicking that button already IS the "yes." */
function maybePromptForTareFile() {
  const standard = STANDARDS[currentStandardId];
  if (!standard.usesTareFile || tarePromptShown || !currentAnalysis || !currentAnalysis.ok) return;
  tarePromptShown = true;
  openTarePrompt({ onFileChosen: (file) => readTareFile(file) });
}

/** @param {File} file */
function readTareFile(file) {
  const reader = new FileReader();
  reader.onload = () => loadTareFileText(reader.result, file.name);
  reader.readAsText(file);
}

/** @param {string} text raw .DAT file contents @param {string} name display filename */
function loadTareFileText(text, name) {
  tareFileName = name;
  tareFileText = text;
  tareDf = new window.DataFile(text);
  alertIfTruncated(tareDf, "tare file");
  const serialNumber = tareDf.getHeaderValue("Software Information", "SerialNumber");
  const profile = lookupProfile(MACHINE_PROFILES, serialNumber);
  if (profile) applyChannelCorrections(tareDf, profile);
  runAnalysisPipeline(sourceFileName);   // re-runs the WHOLE pipeline (cheap, same as a sensor switch) so the Mapper picks up the new tareDf/tareAnalysis
}

//#region company logo (letterhead — companyLogoStore.js)
/** @type {string[]} */
const COMPANY_LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg"];
/** @type {number} bytes — keeps a base64'd logo from bloating localStorage */
const COMPANY_LOGO_MAX_BYTES = 1.5 * 1024 * 1024;

/* readCompanyLogoFile: unlike readTareFile/readCompanionFile above (plain text,
   handed straight to a parser), a logo needs real validation before it's trusted —
   the file input's own `accept` attribute is just a picker hint, not a guarantee.
   Three checks, cheapest first: declared MIME type, size cap, then an actual decode
   via Image() to catch a corrupt or mislabeled file the first two checks wouldn't. */
/** @param {File} file */
function readCompanyLogoFile(file) {
  if (!COMPANY_LOGO_ALLOWED_TYPES.includes(file.type)) {
    alert("Company logo must be a PNG or JPEG image.");
    return;
  }
  if (file.size > COMPANY_LOGO_MAX_BYTES) {
    alert("Company logo is too large (max 1.5 MB) — please use a smaller image.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const img = new Image();
    img.onload = () => {
      saveCompanyLogo({ dataUrl, mimeType: file.type, fileName: file.name, savedAt: new Date().toISOString() });
      updateCompanyLogoButtonState();
      refreshReport(byId("view-report"), store, byId("unitSelect").value);
    };
    img.onerror = () => alert("That file couldn't be read as an image — please choose a valid PNG or JPEG.");
    img.src = dataUrl;
  };
  reader.onerror = () => alert("Couldn't read that file.");
  reader.readAsDataURL(file);
}

/** Reflects whatever's currently stored (or not) in the toolbar button/remove-link —
 *  called once at startup and after every upload/remove. */
function updateCompanyLogoButtonState() {
  const logo = loadCompanyLogo();
  byId("companyLogoBtn").textContent = logo ? "Change Company Logo (" + logo.fileName + ")" : "Add Company Logo";
  byId("removeCompanyLogoBtn").style.display = logo ? "" : "none";
}
//#endregion

/* maybePromptForCompanionFile: auto-prompts for the matching "-Cyclic.DAT" file the
   moment a cyclic-flow primary file loads successfully — unlike maybePromptForTareFile,
   NOT a "would you like to" yes/no dialog first; the companion data is load-bearing
   (Table C.3's own precision values need it — see iso23369Analysis.js's own
   companionFileMissing note), so this goes straight to the file picker. Declining
   (closing the picker) still leaves the report usable via the coarser primary-file
   fallback, with a prominent warning — not a hard block. Gated on
   standard.usesCompanionFile (iso23369 only) and companionPromptShown, same
   once-per-primary-file-load convention as the tare prompt. */
function maybePromptForCompanionFile() {
  const standard = STANDARDS[currentStandardId];
  if (!standard.usesCompanionFile || companionPromptShown || !currentAnalysis || !currentAnalysis.ok) return;
  companionPromptShown = true;
  openCompanionFilePrompt({ onFileChosen: (file) => readCompanionFile(file) });
}

/** @param {File} file */
function readCompanionFile(file) {
  const reader = new FileReader();
  reader.onload = () => loadCompanionFileText(reader.result, file.name);
  reader.readAsText(file);
}

/** @param {string} text raw companion-file contents @param {string} name display filename */
function loadCompanionFileText(text, name) {
  companionFileName = name;
  companionFileText = text;
  companionDf = new window.CyclicCompanionFile(text);
  // Filename check FIRST (cheap, doesn't need parsed content) — per the user, a
  // genuine live mix-up (2026-08-20): two similarly-named same-day tests, e.g.
  // "Test-01.DAT" and "Test-02.DAT", each write their own "-Cyclic" companion at
  // the same time, and nothing stops the file picker from attaching "Test-02-
  // Cyclic.DAT" to "Test-01.DAT" — the content still parses and (if the two tests
  // happened close enough in time) can even align "successfully". This check is a
  // pure filename comparison, so it catches that exact case even when
  // alignToPrimary's own timestamp-plausibility check wouldn't. Own function here
  // (not on CyclicCompanionFile itself) — that class only ever sees file TEXT,
  // never a filename, by design.
  const nameMismatch = checkCompanionFileNameMatch(sourceFileName, name);
  if (nameMismatch) companionDf.warnings.push(nameMismatch);
  if (currentDf) companionDf.alignToPrimary(currentDf);
  runAnalysisPipeline(sourceFileName);   // re-runs the WHOLE pipeline so the engine picks up the new companionDf
}

/** Compares a companion file's name against the primary file's own name plus the
 *  expected "-Cyclic" suffix (e.g. "Test-01.DAT" -> "Test-01-Cyclic.DAT") — see
 *  loadCompanionFileText's own comment for why this check exists.
 *  @param {string} primaryName @param {string} companionName @returns {string|null} warning text, or null if it matches */
function checkCompanionFileNameMatch(primaryName, companionName) {
  const stripExt = (name) => name.replace(/\.[^.\\/]+$/, "");
  const primaryBase = stripExt(primaryName);
  const companionBase = stripExt(companionName);
  if (companionBase.toLowerCase() === (primaryBase + "-Cyclic").toLowerCase()) return null;
  return "This companion file's name (\"" + companionName + "\") doesn't look like it belongs to the loaded " +
    "primary file (\"" + primaryName + "\") — expected a name like \"" + primaryBase + "-Cyclic\" plus the same " +
    "extension. This looks like a companion file from a DIFFERENT, similarly-named test; double-check the right " +
    "\"-Cyclic\" file was selected.";
}

/* runAnalysisPipeline: analyze -> map -> render, for whichever currentDf is already
   parsed (and profile-corrected) in memory. Factored out of loadFileText so the
   Sensor dropdown and "Select display sizes" dialog — which change what the SAME
   already-loaded file should be analyzed/mapped as, not which file — can re-run just
   this part instead of duplicating it. @param {string} name display filename for the
   status line (always sourceFileName outside the initial load call). */
function runAnalysisPipeline(name) {
  // A loaded CyclicCompanionFile (see loadFileText) has no analysis meaning at all —
  // no TestType, no header, nothing any standard's run() can work with. Guarded
  // HERE, once, rather than at every one of this function's several call sites
  // (sensor switch, standard switch, display-size save, session load, ...) —
  // Explorer rendering is always safe/generic (explorerView.js's own
  // isCyclicCompanion branch), so this just takes the report/analysis side to a
  // clean "nothing to analyze" state instead of crashing deep inside a standard's
  // engine on a field it assumes exists.
  if (!(currentDf instanceof window.DataFile)) {
    currentAnalysis = null;
    currentControlResults = [];
    rerenderExplorer();
    // Same "always re-render Report, only refresh Audit if visible" pair the normal
    // tail below uses — without this, switching to/loading a companion file while
    // Report was already showing a PREVIOUS file's report left that stale report on
    // screen instead of reflecting "nothing to analyze" (store is already a fresh
    // ReportValueStore from loadFileText; renderReportPages already handles a null
    // currentAnalysis, same as the "no file loaded yet" case).
    renderReportPages(byId("view-report"), store, byId("unitSelect").value, pagesForCurrentStandard())
      .catch(err => console.error("Report render failed:", err));
    if (byId("view-audit").classList.contains("active")) {
      renderAuditPage(byId("view-audit"), store, effectiveAuditId());
    }
    updateReportingControlsVisibility();
    byId("statusText").textContent = currentDf
      ? "Loaded " + name + " — a cyclic companion file (explore only; no standard can analyze this file type)"
      : "";
    return;
  }

  const standard = STANDARDS[currentStandardId];
  // tareAnalysis: computed here, not inside standard.run — the STANDARDS entry's own
  // `run` wrapper already threads tareDf into Iso3968Analysis.run(df, tareDf) for the
  // PRIMARY file's own dual-filter-style options bag; the tare file needs its OWN,
  // independent Iso3968Analysis.run() call (no "tare of a tare"), same dispatch shape
  // recomputeGravimetricDerived below already uses for other per-standard behavior.
  const tareAnalysis = standard.usesTareFile ? computeTareAnalysis(currentStandardId, tareDf) : null;

  // Machine Profile's own coincidence-limit overrides (if any) — a second, cheap,
  // independent lookup from applyMachineProfileFields' own (kept separate rather
  // than refactored into one shared call, to keep this diff small). Resolved BEFORE
  // run(), unlike applyMachineProfileFields' report-field defaults: the coincidence
  // check happens INSIDE the analysis engine now (it's a real math input, not a
  // display default), so standard.run() needs it up front, not after.
  const machineProfile = currentDf
    ? lookupProfile(loadMachineProfiles(), currentDf.getHeaderValue("Software Information", "SerialNumber"))
    : null;
  const coincidenceLimits = machineProfile ? {
    sensorUpstreamCoincidenceLimit: machineProfile.sensorUpstreamCoincidenceLimit,
    sensorDownstreamCoincidenceLimit: machineProfile.sensorDownstreamCoincidenceLimit,
    lsSensorUpstreamCoincidenceLimit: machineProfile.lsSensorUpstreamCoincidenceLimit,
    lsSensorDownstreamCoincidenceLimit: machineProfile.lsSensorDownstreamCoincidenceLimit,
    lbeSensorCoincidenceLimit: machineProfile.lbeSensorCoincidenceLimit
  } : null;

  currentAnalysis = standard.run(currentDf, {
    sensor: currentSensor, pressureView: currentPressureView,
    tareDf: standard.usesTareFile ? tareDf : null,
    companionFile: standard.usesCompanionFile ? companionDf : null,
    coincidenceLimits
  });

  // iso454812/iso19438 each have their own persisted display-size preference, scoped
  // per sensor (LB and LS are different hardware with different measured ranges —
  // see either standard's own DisplaySizesView.js); ISO 16889 has no displaySizesView
  // at all (null), hence the guard — unlike the single-standard version this
  // replaced, standardId alone isn't enough to safely call a function that might not
  // exist for this standard.
  const persistedDisplaySizes = standard.displaySizesView
    ? standard.displaySizesView.load(currentStandardId, currentSensor)
    : null;

  // A re-run against the SAME already-loaded file (sensor switch, display-size save,
  // standard switch) must not discard manual edits made before it — gravimetric
  // entries, double-click overrides — those are user-provided facts independent of
  // which sensor/standard just got (re)analyzed, not derived analysis output. A
  // genuinely NEW file resets `store` itself in loadFileText, so getUserEntries()
  // correctly returns {} here in that case — nothing stale to carry forward.
  const preservedUserEntries = store.getUserEntries();

  store = new ReportValueStore();
  standard.applyMapper(store, currentDf, currentAnalysis, { persistedDisplaySizes, tareDf, tareAnalysis });
  applyCustomDefaults(store, currentProfile);   // profile defaults fill gaps the file itself didn't supply
  applyPersistedCustomDefaults(store);          // persisted customer defaults fill gaps too, and win over the profile's
  applyMachineProfileFields(store);             // the Machine Profiles tab's own per-rig save, and wins over both above
  for (const [id, value] of Object.entries(preservedUserEntries)) store.setUserEntry(id, value);
  // Injection grav. Average / Non-Retained Mass / Retained Capacity derive from
  // Initial/Final/Gf (just restored above, if previously entered) rather than being
  // entered directly — recompute them here too, or they'd silently go blank on a
  // sensor/standard switch even though the values they derive from survived it.
  recomputeGravimetricDerived(currentStandardId);

  // Stashed for reportView.js's report-figure charts (e.g. Figure B.1, DP vs. time),
  // which need the raw time series a ReportValueStore field can't hold. NOT part of
  // store.toJSON()/fromJSON() — a DataFile/analysis instance can't round-trip through
  // JSON, and a loaded session file is expected to leave figure charts blank rather
  // than error (see reportView.js's buildDPFigureData).
  store.setExtra("sourceDf", currentDf);
  store.setExtra("sourceAnalysis", currentAnalysis);
  // ISO 23369 only — the companion file's own contribution, for iso23369AuditSteps.js's
  // narration (row count, cadence, which reporting times used it vs. fell back to the
  // primary file). null for every other standard, same as sourceDf/sourceAnalysis
  // being generically read but only ever populated meaningfully by the relevant Mapper.
  store.setExtra("sourceCompanionFile", standard.usesCompanionFile ? companionDf : null);

  // Control target compliance — full results (pass and fail) computed up front so
  // both the warnings dialog and reportView.js's inline ⚠ field markers read the
  // exact same array (see currentControlResults' own comment). Not every standard has
  // a rule table yet (ISO 16889 v1).
  currentControlResults = standard.controlTargets ? checkControlTargets(currentDf, standard.controlTargets) : [];
  store.setExtra("controlResults", currentControlResults);

  // Custom tabs are NOT reset here — that's the point. Same tab definitions,
  // redrawn against the new file, staying on whatever tab was active.
  rerenderExplorer();

  // Always fully (re)render the Report view here, not just refresh whatever's
  // already in the DOM — a file loaded while sitting on the Explorer tab means
  // #view-report has never been rendered at all yet (refreshReport's "only if a
  // page is already there" guard would no-op), so switching to Report afterward
  // showed nothing until the standard/tab was touched again. Rendering eagerly on
  // every load means the Report tab is always ready the instant it's clicked,
  // whichever tab was active when the file came in.
  renderReportPages(byId("view-report"), store, byId("unitSelect").value, pagesForCurrentStandard())
    .catch(err => console.error("Report render failed:", err));

  // Unlike Report above, only refreshed when actually visible — Audit is a hidden
  // dev route rarely open, so there's no "tab ready the instant it's clicked"
  // reason to render it eagerly on every sensor/standard/file change. Covers a
  // standard switch triggered from #auditSwitch while already looking at Audit
  // (that click handler also re-renders, but a sensor/display-size change routed
  // through here wouldn't otherwise reach it) and a plain re-run while sitting on
  // Audit with "Data File Explorer" selected (harmless — re-parses nothing, just
  // rebuilds the same DOM from the same already-loaded df).
  if (byId("view-audit").classList.contains("active")) {
    renderAuditPage(byId("view-audit"), store, effectiveAuditId());
  }

  updateReportingControlsVisibility();

  // Status text stays short — full detail (every error, every warning, every
  // control-target failure) now lives in the warnings dialog (see warningsBtn's click
  // handler below and warningsDialogView.js), not truncated to "first error only" /
  // console-only the way this used to work.
  const status = byId("statusText");
  const controlFailures = currentControlResults.filter(r => r.applicable && !r.ok);
  const issueCount = currentAnalysis.errors.length + currentAnalysis.warnings.length +
    (currentAnalysis.gravimetricWarnings || []).length + controlFailures.length;

  if (currentAnalysis.ok) {
    status.textContent = "Parsed " + name + " — " + standard.label + " analysis OK";
  } else {
    status.textContent = "Parsed " + name + " — " + standard.label + " analysis failed";
  }
  if (issueCount) status.textContent += " — " + issueCount + " issue(s), see ⚠ Warnings";

  if (currentAnalysis.warnings.length) console.warn(standard.label + " warnings:", currentAnalysis.warnings);
  if (controlFailures.length) console.warn("Control target failures:", controlFailures);
}

/** @param {File} file */
function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => loadFileText(reader.result, file.name);
  reader.readAsText(file);
}

const fileInput = byId("fileInput");
byId("loadDataBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ""; });

// Always available, no currentDf/state gating — same "always there" treatment as
// Print report, not the file-dependent toolbar buttons.
byId("helpBtn").addEventListener("click", () => openHelpDialog());
//#endregion

//#region downloads / session persistence
/** Triggers a browser download of in-memory text.
 *  @param {string} name @param {string} text @param {string} type MIME type */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---- Session save/load (report store) ----
/* Session file format v2 ("report-session"): wraps store.toJSON() with everything else
   needed to fully resume — the ORIGINAL .DAT text, which standard/sensor were selected,
   and which display sizes were in effect — so a load can replay the exact parse ->
   analyze -> map pipeline a live file load uses (runAnalysisPipeline), not just restore
   resolved field text. Without the source text, per the user: plot values came back
   blank (buildDPFigureData needs the live sourceDf/sourceAnalysis extras, which can't
   round-trip through JSON), switching standards after load had no file to re-analyze,
   and the display-size/gravimetric-entry buttons stayed permanently disabled (both
   gated on currentDf/currentAnalysis being set). v1 files (bare store.toJSON(), tool:
   "report-value-store") still load — see loadSessionData's isWrapped check — just
   without any of the above, same limited behavior as before. */
byId("saveBtn").addEventListener("click", () => {
  const baseName = (sourceFileName ? sourceFileName.replace(/\.[^.]+$/, "") : "report") + "_session";
  const typed = prompt("Save session as:", baseName);
  if (!typed) return;   // cancelled
  const fileName = (typed.toLowerCase().endsWith(".json") ? typed : typed + ".json");

  const session = {
    tool: "report-session",
    version: 2,
    savedAt: new Date().toISOString(),
    standardId: currentStandardId,
    sensor: currentSensor,
    pressureView: currentPressureView,
    sourceFileName,
    sourceFileText: currentDf ? sourceFileText : null,
    // ISO 3968's optional tare file — mirrors sourceFileName/sourceFileText exactly,
    // so a saved-and-reloaded session doesn't silently lose it (the same failure
    // mode a past fix already addressed once for the primary file itself).
    tareFileName,
    tareFileText: tareDf ? tareFileText : null,
    // ISO 23369's cyclic companion file — mirrors tareFileName/tareFileText's own
    // save shape exactly, same reasoning (own copy, per CLAUDE.md).
    companionFileName,
    companionFileText: companionDf ? companionFileText : null,
    // Whatever sizes the mapper actually resolved for this render (persisted default,
    // or a one-off dialog choice) — replayed into that same persisted-default slot on
    // load (see loadSessionData) so the report comes back showing the same sizes
    // regardless of what's since become the browser's current default.
    displaySizes: store.getExtra("resolvedDisplaySizes") || null,
    valueStore: store.toJSON()
  };
  download(fileName, JSON.stringify(session, null, 1), "application/json");
  byId("statusText").textContent = "Saved " + fileName;
});

byId("loadBtn").addEventListener("click", () => byId("loadInput").click());
byId("loadInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadSessionData(JSON.parse(reader.result), file.name);
      byId("statusText").textContent = "Loaded " + file.name;
    } catch (err) {
      byId("statusText").textContent = "Could not read " + file.name + ": not a valid session file";
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});

/** Restores a parsed report_session.json (see the save handler's format comment above).
 *  @param {*} data parsed session JSON @param {string} fallbackName used if the session
 *  itself has no sourceFileName (v1 files, or a v2 file saved with no file loaded) */
function loadSessionData(data, fallbackName) {
  const isWrapped = data && data.tool === "report-session";
  const storeData = isWrapped ? data.valueStore : data;   // v1 files ARE the store JSON directly
  const savedStandardId = isWrapped && STANDARDS[data.standardId] ? data.standardId : null;
  const savedText = isWrapped ? data.sourceFileText : null;

  // Seeded here (not left as whatever `store` already held) so runAnalysisPipeline's
  // own getUserEntries() — the same "preserve manual edits across a re-run" mechanism
  // already used for a sensor/standard switch — carries the SAVED User Entries forward
  // once it rebuilds `store` from scratch below. fromData/customDefault tiers are
  // deliberately NOT carried through as-is; they get freshly recomputed against the
  // re-parsed file and the browser's current persisted defaults, exactly like any other
  // re-run — a portable session file shouldn't freeze a stale customDefault into place.
  store = ReportValueStore.fromJSON(storeData);

  if (typeof savedText !== "string" || !savedText.length) {
    // No source file to replay (v1 file, or saved with nothing loaded) — nothing to
    // re-analyze; just fill whatever's already rendered, the same as before this fix.
    renderReportPages(byId("view-report"), store, byId("unitSelect").value, pagesForCurrentStandard())
      .catch(err => console.error("Report render failed:", err));
    return;
  }

  if (savedStandardId) {
    currentStandardId = savedStandardId;
    document.querySelectorAll("#standardSwitch button").forEach(b => b.classList.toggle("active", b.dataset.standard === currentStandardId));
    auditSelectedId = null;   // a loaded session always reflects a real standard, never "explorer"
    syncAuditSwitchActiveState();
  }

  sourceFileName = (isWrapped && data.sourceFileName) || fallbackName;
  sourceFileText = savedText;
  currentDf = new window.DataFile(savedText);
  alertIfTruncated(currentDf);
  currentSensor = (isWrapped && data.sensor) || "lb";
  currentPressureView = (isWrapped && data.pressureView) || null;

  const serialNumber = currentDf.getHeaderValue("Software Information", "SerialNumber");
  currentProfile = lookupProfile(MACHINE_PROFILES, serialNumber);
  if (currentProfile) applyChannelCorrections(currentDf, currentProfile);

  // ISO 3968's optional tare file — mirrors sourceFileText's own restore exactly.
  // tarePromptShown is set regardless of whether a tare was actually saved: loading
  // a session means the tare choice (supply one or decline) was already made when
  // it was FIRST saved — the yes/no prompt shouldn't reappear just because the
  // session round-tripped through a file.
  const savedTareText = isWrapped ? data.tareFileText : null;
  tarePromptShown = true;
  if (typeof savedTareText === "string" && savedTareText.length) {
    tareFileName = data.tareFileName || "";
    tareFileText = savedTareText;
    tareDf = new window.DataFile(savedTareText);
    alertIfTruncated(tareDf, "tare file");
    const tareSerialNumber = tareDf.getHeaderValue("Software Information", "SerialNumber");
    const tareProfile = lookupProfile(MACHINE_PROFILES, tareSerialNumber);
    if (tareProfile) applyChannelCorrections(tareDf, tareProfile);
  } else {
    tareDf = null;
    tareFileName = "";
    tareFileText = "";
  }

  // ISO 23369's cyclic companion file — mirrors the tare restore block just above,
  // own copy per CLAUDE.md. alignToPrimary needs currentDf, already set above.
  const savedCompanionText = isWrapped ? data.companionFileText : null;
  companionPromptShown = true;
  if (typeof savedCompanionText === "string" && savedCompanionText.length) {
    companionFileName = data.companionFileName || "";
    companionFileText = savedCompanionText;
    companionDf = new window.CyclicCompanionFile(savedCompanionText);
    companionDf.alignToPrimary(currentDf);
  } else {
    companionDf = null;
    companionFileName = "";
    companionFileText = "";
  }

  const standard = STANDARDS[currentStandardId];
  const savedSizes = isWrapped ? data.displaySizes : null;
  if (savedSizes && savedSizes.length && standard.displaySizesView) {
    standard.displaySizesView.save(currentStandardId, currentSensor, savedSizes);
  }

  runAnalysisPipeline(sourceFileName);
}

// ---- Chart tab layout save/load (definitions only — reused across many files) ----
byId("saveTabsBtn").addEventListener("click", () => {
  download("chart_tabs.json", JSON.stringify(customTabs.toJSON(), null, 1), "application/json");
  byId("statusText").textContent = "Saved chart tabs " + new Date().toLocaleTimeString();
});

byId("loadTabsBtn").addEventListener("click", () => byId("loadTabsInput").click());
byId("loadTabsInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      customTabs = CustomTabRegistry.fromJSON(JSON.parse(reader.result));
      activeExplorerTabId = null;
      rerenderExplorer();
      byId("statusText").textContent = "Loaded chart tabs from " + file.name;
    } catch (err) {
      byId("statusText").textContent = "Could not read " + file.name + ": not a valid chart tab file";
    }
    e.target.value = "";
  };
  reader.readAsText(file);
});
//#endregion

//#region units / print
byId("unitSelect").addEventListener("change", () => {
  // A saved report-figure axis override was entered in whatever unit system was
  // showing at the time (Figure B.1's ΔP axis is unit-bearing) — toggling units would
  // silently misrepresent it against the newly-converted chart, so drop it rather than
  // risk showing a wrong-unit range (see chartAxisControls.js).
  clearAxisOverridesWhere(id => id.startsWith("report:"));
  refreshReport(byId("view-report"), store, byId("unitSelect").value);
});
byId("printBtn").addEventListener("click", () => window.print());
// Same action as printBtn (window.print() doesn't care which view is active) — a
// separate button, in Compare's own context-toolbar, only so its label can say
// "comparison report" rather than the single-file report's own wording (same
// per-view-label convention the save/load buttons already use). redrawForPrint's
// own beforeprint hook (below) already checks which view is active and redraws
// accordingly, regardless of which of these two buttons triggered the print.
byId("printCompareBtn").addEventListener("click", () => window.print());
// Same action again, own button/label for Audit's own toolbar. No canvases on this
// view (unlike Report/Compare), so redrawForPrint's own beforeprint hook has
// nothing audit-specific to do — plain CSS (see app.css's Audit print rules)
// handles this one entirely on its own.
byId("printAuditBtn").addEventListener("click", () => window.print());

// Report-figure charts (Chart.js, responsive+maintainAspectRatio:false) are normally
// sized off their container's on-screen CSS box. Earlier versions of this hook tried
// to make that measurement work reliably for PRINT specifically — chart.resize() with
// getBoundingClientRect() dimensions, then rebuilding from scratch on beforeprint +
// afterprint + matchMedia's "print" change event, each with a requestAnimationFrame
// delay to give the browser one more paint cycle to settle print layout first. None
// of it actually worked: figures kept printing short no matter what, confirmed across
// several rounds of testing at different CSS heights with no visible change — a
// browser-print-layout-timing race that plain JS delays couldn't reliably win.
//
// Current approach sidesteps DOM measurement for print entirely: reportView.js's
// redrawReportCharts, when passed a paperSize, computes the figures' intended pixel
// size directly from known constants (paper size, @page margins, the figure's own
// CSS height — see reportView.js's computePrintFigureSizePx) and forces that exact
// size via chart.resize(), with no dependency on whether print-media layout has
// settled in the DOM at the moment of the call. The beforeprint/afterprint/matchMedia
// triggers and rAF-delayed second call are kept anyway (belt-and-suspenders — cheap,
// and still needed for report FIELDS/tables to reflect current print layout even if
// the figures no longer depend on it), but redrawForPrint (entering print) passes the
// current paper size; redrawForScreen (leaving print, or never printing) omits it,
// restoring normal auto-measured on-screen sizing.
function redrawForPrint() {
  applyPrintFooter();   // stamp the current date into the footer before the sheet renders
  const paperSize = byId("paperSizeSelect").value;
  redrawReportCharts(byId("view-report"), store, byId("unitSelect").value, paperSize);
  requestAnimationFrame(() => redrawReportCharts(byId("view-report"), store, byId("unitSelect").value, paperSize));
  // redrawComparePlots redraws onto the SAME canvases already sitting in the DOM —
  // it does NOT rebuild the template/palette/pages tree the way rerenderCompare
  // does. That distinction turned out to matter: an earlier version of this hook
  // called rerenderCompare() (full teardown + rebuild, brand-new <canvas> elements)
  // from inside this very handler, so every chart Chromium's print pipeline had to
  // rasterize sat on a canvas that had never been laid out or painted before —
  // unlike the single-file report's own canvases, which are part of the static
  // template and already exist (already painted at least once on screen) well
  // before beforeprint ever fires. Matching that same "redraw into an
  // already-existing, already-painted canvas" property fixed multi-chart Compare
  // pages that were printing blank. See redrawComparePlots's own note.
  if (byId("view-compare").classList.contains("active")) {
    redrawComparePlots(byId("view-compare"), paperSize);
    requestAnimationFrame(() => redrawComparePlots(byId("view-compare"), paperSize));
  }
}
function redrawForScreen() {
  redrawReportCharts(byId("view-report"), store, byId("unitSelect").value);
  requestAnimationFrame(() => redrawReportCharts(byId("view-report"), store, byId("unitSelect").value));
  if (byId("view-compare").classList.contains("active")) {
    redrawComparePlots(byId("view-compare"));
    requestAnimationFrame(() => redrawComparePlots(byId("view-compare")));
  }
}
window.addEventListener("beforeprint", redrawForPrint);
window.addEventListener("afterprint", redrawForScreen);
const printMedia = window.matchMedia("print");
function handlePrintMediaChange() {
  if (printMedia.matches) redrawForPrint(); else redrawForScreen();
}
if (printMedia.addEventListener) {
  printMedia.addEventListener("change", handlePrintMediaChange);
} else if (printMedia.addListener) {
  printMedia.addListener(handlePrintMediaChange);   // Safari < 14 fallback
}

/** Writes the "Printed: <date>" half of the print footer into the @bottom-left page
 *  margin box (the page-number half is static in app.css's @page). CSS can't compute
 *  today's date, so it's injected as a generated-content string here. Refreshed on
 *  every print trigger (redrawForPrint) so a long-open session still prints the actual
 *  print date, not the load date. Where a browser doesn't implement page margin boxes
 *  this simply has no visible effect — see app.css. */
function applyPrintFooter() {
  const printed = new Date().toLocaleDateString();
  byId("printFooterStyle").textContent =
    '@page { @bottom-left { content: "Printed: ' + printed + '"; ' +
    'font: 8pt \'Segoe UI\', \'Helvetica Neue\', Arial, sans-serif; color: #666; } }';
}
applyPrintFooter();
updateCompanyLogoButtonState();

/* Paper size (Letter/A4) — @page doesn't support conditional selectors, so the chosen
   size is written directly into the #paperSizeStyle <style> tag (see index.html /
   app.css's @page note) rather than toggled via a CSS class. body.dataset.paper is
   a second, complementary mechanism for the ONE place that DOES need a conditional
   selector on paper size — ISO 16889 Page 2's rotated-landscape sizing (app.css's
   body[data-paper="a4"] .w16889-p2-rotate rule) — since that page's usable-area
   dimensions differ between Letter and A4 and can't be expressed as a single
   fixed-size rule the way the rest of the report's print CSS is. */
/** @param {"letter"|"a4"} size */
function applyPaperSize(size) {
  byId("paperSizeStyle").textContent = "@page { size: " + (size === "a4" ? "A4" : "letter") + "; }";
  document.body.dataset.paper = size === "a4" ? "a4" : "letter";
}
byId("paperSizeSelect").addEventListener("change", (e) => applyPaperSize(e.target.value));
applyPaperSize(byId("paperSizeSelect").value);
//#endregion

//#region editable report fields (double-click to override)
/* Reads/writes through reportView's unit helpers so a value typed while viewing PSI
   is converted back to canonical kPa before it's stored, and vice versa.

   With a file loaded, an edit is a per-file User Entry — exactly as before, never
   persisted beyond an explicit "Save session" file. With NO file loaded, an edit
   instead sets/clears a persisted Custom Default (customDefaults.js), so it survives
   reloads and pre-fills every future report until cleared. */
document.getElementById("view-report").addEventListener("dblclick", (e) => {
  const target = e.target.closest("[data-editable]");
  if (!target) return;
  const id = target.dataset.slot;
  const units = byId("unitSelect").value;
  const current = currentDisplayValue(store, id, units);

  if (currentDf) {
    const next = prompt("Override value for \"" + id + "\" (leave blank to clear override):", current);
    if (next === null) return;
    if (next === "") {
      store.clearUserEntry(id);
    } else {
      store.setUserEntry(id, toStorableValue(store, id, next, units));
    }
  } else {
    const next = prompt("Set default value for \"" + id + "\" (leave blank to clear default):", current);
    if (next === null) return;
    const standardId = currentStandardId;
    const persisted = loadCustomDefaults(standardId);
    if (next === "") {
      store.clearCustomDefault(id);
      delete persisted[id];
    } else {
      const value = toStorableValue(store, id, next, units);
      store.setCustomDefault(id, value);
      persisted[id] = value;
    }
    saveCustomDefaults(standardId, persisted);
  }
  refreshReport(byId("view-report"), store, units);
});
//#endregion

//#region service worker (offline support)
if ("serviceWorker" in navigator) {
  // updateViaCache: "none" — without this, the BROWSER's own HTTP cache (not the
  // service worker's Cache Storage, a separate layer) can serve a stale
  // service-worker.js byte-for-byte on registration, so the browser never notices
  // CACHE_NAME changed and never installs the new worker at all. This forces every
  // registration check to hit the network for the worker script itself.
  navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).catch(err => {
    console.warn("Service worker registration failed (expected if not served over http/https):", err);
  });
}
//#endregion

//#region startup
// index.html hardcodes ISO 16889 (2022) as #standardSwitch's/#auditSwitch's own
// active button — correct that to match a persisted non-default currentStandardId
// (see LAST_STANDARD_KEY above).
document.querySelectorAll("#standardSwitch button").forEach(b => b.classList.toggle("active", b.dataset.standard === currentStandardId));
syncAuditSwitchActiveState();

applyPersistedCustomDefaults(store);   // fill the empty-state store before the report is ever shown

showView(loadLastView() || "explorer");
//#endregion

/* =====================================================================================
   auditView.js
   =====================================================================================
   Renders the (hidden, developer-only) Audit Trail view: a human-legible, step-by-
   step derivation of the CURRENTLY loaded file's analysis, for checking a
   standard's own math against its published text. Generic renderer ONLY — every
   standard's own narration lives in that standard's own <id>AuditSteps.js (report
   CONTENT, never shared between standards, per CLAUDE.md), imported directly here
   since each is a pure function of (analysis, df, store) with no dependency on
   window globals or app.js's STANDARDS.run/applyMapper — no circularity risk, no
   callback-injection plumbing needed the way Compare's standard-registry situation
   required.

   No file-load control of its own: reads whatever's already sitting in
   store.getExtra("sourceAnalysis")/("sourceDf")/("controlResults") — the SAME
   mechanism reportView.js's report-figure chart builders already read from (see
   app.js's runAnalysisPipeline). Nothing here re-runs analysis or touches the main
   Explorer/Report pipeline.
   ===================================================================================== */
import { buildAuditSteps as buildIso16889Steps } from "../standards/iso16889/iso16889AuditSteps.js";
import { buildAuditSteps as buildIso454812Steps } from "../standards/iso454812/iso454812AuditSteps.js";
import { buildAuditSteps as buildIso19438Steps } from "../standards/iso19438/iso19438AuditSteps.js";
import { buildAuditSteps as buildIso3968Steps } from "../standards/iso3968/iso3968AuditSteps.js";
import { buildAuditSteps as buildIso23369Steps } from "../standards/iso23369/iso23369AuditSteps.js";
import { buildAuditSteps as buildExplorerSteps } from "../explorer/explorerAuditSteps.js";

/** @type {Record<string,{label:string,buildSteps:Function}>} key -> its own audit-
 *  step builder. The 4 real standards PLUS "explorer", a special, non-standard entry
 *  (see app.js's auditSelectedId/#auditSwitch) auditing the Data File Explorer's own
 *  raw-parsing/column-index correctness instead of a standard's calculation —
 *  buildSteps still takes (analysis, df, store) for a uniform call site below, but
 *  explorerAuditSteps.js's own version reads only df, standard-agnostic by design. */
const AUDIT_STANDARDS = {
  iso16889: { label: "ISO 16889:2022", buildSteps: buildIso16889Steps },
  iso454812: { label: "ISO 4548-12", buildSteps: buildIso454812Steps },
  iso19438: { label: "ISO 19438:2023", buildSteps: buildIso19438Steps },
  iso3968: { label: "ISO 3968:2017", buildSteps: buildIso3968Steps },
  iso23369: { label: "ISO 23369:2022", buildSteps: buildIso23369Steps },
  explorer: { label: "Data File Explorer", buildSteps: buildExplorerSteps }
};

/**
 * @param {HTMLElement} container
 * @param {import("../report/reportValueStore.js").ReportValueStore} store
 * @param {string|null} standardId
 */
export function renderAuditPage(container, store, standardId) {
  container.innerHTML = "";

  const entry = AUDIT_STANDARDS[standardId];
  if (!entry) {
    container.appendChild(el("div", { class: "hint-box" },
      "No audit trail is available for " + (standardId || "this standard") + "."));
    return;
  }

  container.appendChild(el("h2", {}, entry.label + " — Audit Trail"));

  const analysis = store ? store.getExtra("sourceAnalysis") : null;
  const df = store ? store.getExtra("sourceDf") : null;
  if (!analysis) {
    container.appendChild(el("div", { class: "hint-box" }, "Load a .DAT file first — nothing has been analyzed yet."));
    return;
  }

  container.appendChild(buildFileIdentitySection(df));

  const steps = entry.buildSteps(analysis, df, store) || [];
  steps.forEach((step) => container.appendChild(buildStepEl(step)));

  // "explorer" isn't a real standard — no control-target rule table to check
  // compliance against (that's per-STANDARD, tied to whichever real standard is
  // actually active, unrelated to this entry), and its own raw dump is more
  // useful showing the parsed DataFile than whichever real standard's analysis
  // object happens to be sitting in the store.
  if (standardId === "explorer") {
    container.appendChild(buildRawDump(df, df, standardId, "parsed file object", "raw-datafile"));
    return;
  }

  const controlResults = store ? store.getExtra("controlResults") : null;
  const controlSection = buildControlTargetsSection(controlResults);
  if (controlSection) container.appendChild(controlSection);

  container.appendChild(buildRawDump(analysis, df, standardId, "analysis object", "raw-analysis"));
}

//#region file identity
/** Identifying details for whichever file is currently loaded — file name, when the
 *  test was run, who ran it — shown at the very top of the trail, before any of the
 *  standard's own derivation steps below it. Generic: reads straight off `df`'s
 *  header, no standard-specific knowledge, so unlike everything below it this is
 *  NOT part of any standard's own <id>AuditSteps.js — one rendering here covers all
 *  four active standards. "General Test Information"/Operator/TestTime are
 *  CONFIRMED-common keys — every standard's own Mapper.js already reads them the
 *  same way (df.fileName/df.fileDate are DataFile's own parsed convenience
 *  properties for FileName/TestDate; TestTime and Operator are read directly since
 *  DataFile has no dedicated property for either).
 *  @param {DataFile|null} df */
function buildFileIdentitySection(df) {
  return buildStepEl({
    title: "Test file",
    inputs: [
      { label: "File name", value: df ? df.fileName : null },
      { label: "Test date", value: df ? df.fileDate : null },
      { label: "Test time", value: df ? df.getHeaderValue("General Test Information", "TestTime") : null },
      { label: "Operator", value: df ? df.getHeaderValue("General Test Information", "Operator") : null }
    ]
  });
}
//#endregion

//#region step rendering
/** @param {{id?:string,title:string,clause?:string,formula?:string,inputs?:Array<{label:string,value:*,unit?:string}>,output?:{label:string,value:*,unit?:string},table?:{columns:Array<*>,rows:Array<Array<*>>},customBody?:HTMLElement,note?:string}} step
 *  customBody: an already-built live element for a step whose body isn't a plain
 *  declarative table — e.g. an interactive size-picker widget (see
 *  ../../audit/auditWidgets.js). Built by that standard's own AuditSteps.js (which
 *  needs no import from this file to do so — just DOM APIs — so no circular-import
 *  risk with auditView.js importing buildAuditSteps FROM it). Takes the table's
 *  place when present; a step should supply one or the other, not both. */
function buildStepEl(step) {
  const parts = [
    el("h3", {}, step.title),
    step.clause ? el("div", { class: "audit-clause" }, step.clause) : null,
    step.formula ? el("div", { class: "audit-formula" }, step.formula) : null
  ];

  if (step.inputs && step.inputs.length) {
    parts.push(el("div", { class: "audit-inputs" },
      ...step.inputs.map((i) => el("span", { class: "audit-kv" }, i.label + ": " + fmt(i.value, i.unit)))));
  }
  if (step.output) {
    parts.push(el("div", { class: "audit-output" }, step.output.label + ": ", el("strong", {}, fmt(step.output.value, step.output.unit))));
  }
  if (step.customBody) {
    parts.push(step.customBody);
  } else if (step.table && step.table.rows && step.table.rows.length) {
    parts.push(buildTable(step.table));
  }
  if (step.note) {
    parts.push(el("div", { class: "audit-note" }, step.note));
  }

  return el("div", { class: "audit-step" }, ...parts.filter(Boolean));
}

/** @param {{columns:Array<*>,rows:Array<Array<*>>,cellTitles?:Array<Array<string|null>>}} t
 *  cellTitles, if given (see auditSampling.js's sampleWideTable), is the SAME shape as
 *  rows — a per-cell hover tooltip (native `title` attribute — no print output, no
 *  custom popover component to build/position; degrades to nothing on paper, which is
 *  fine, per the user: this is a screen-only convenience). A cell with a title also
 *  gets the `.has-tooltip` class so CSS can hint it's hoverable (see app.css). */
function buildTable(t) {
  return el("div", { class: "audit-table-wrap" },
    el("table", { class: "audit-table datatbl" },
      el("thead", {}, el("tr", {}, ...t.columns.map((c) => el("th", {}, String(c))))),
      el("tbody", {}, ...t.rows.map((row, ri) => el("tr", {}, ...row.map((cell, ci) => {
        const title = t.cellTitles && t.cellTitles[ri] ? t.cellTitles[ri][ci] : null;
        return el("td", title ? { class: "has-tooltip", title } : {}, fmt(cell));
      }))))));
}

/** Only shows rules APPLICABLE to this file — some rule tables deliberately list
 *  multiple real naming variants for the same quantity unconditionally (e.g. ISO
 *  16889's Sensor Flow Rate: LB/LS-prefixed on an ExRaDs extended-range rig vs.
 *  plain SensorFlow on a standard single-sensor rig — see iso16889ControlTargets.js),
 *  relying on "channel/header not present -> not applicable" to sort out which
 *  variant fits a given file. A file only ever matches ONE variant; showing every
 *  non-matching one as a bogus "target not found" row here would bury the rules that
 *  actually apply to THIS file under noise from rig configurations it isn't. Same
 *  "not applicable is not a failure" semantics app.js's own warnings dialog already
 *  uses (`results.filter(r => r.applicable && !r.ok)`) — this just also hides the
 *  passing-but-inapplicable ones, since a bare compliance table has no "only show
 *  failures" reason not to.
 *  @param {Array<{parameter:string,applicable:boolean,ok:boolean|null,target:*,actual:*,tolerance:*,toleranceType:string,message:string}>|null} results */
function buildControlTargetsSection(results) {
  if (!results || !results.length) return null;
  const applicable = results.filter((r) => r.applicable);
  if (!applicable.length) return null;
  const skipped = results.length - applicable.length;
  return el("div", { class: "audit-step" },
    el("h3", {}, "Control-target compliance"),
    el("div", { class: "audit-clause" }, "src/core/controlTargetCheck.js — standard-agnostic engine, rule table is this standard's own"),
    buildTable({
      columns: ["Parameter", "OK", "Target", "Actual", "Tolerance", "Message"],
      rows: applicable.map((r) => [r.parameter, r.ok, r.target, r.actual,
        (r.tolerance !== undefined ? r.tolerance + (r.toleranceType === "percent" ? "%" : "") : null), r.message])
    }),
    skipped ? el("div", { class: "audit-note" },
      skipped + " rule" + (skipped === 1 ? "" : "s") + " not applicable to this file's configuration omitted " +
      "(e.g. a naming variant for hardware this rig doesn't have) — see that standard's own <id>ControlTargets.js for the full rule table.")
      : null);
}

/** @param {*} value the object to dump/download — analysis for a real standard, df
 *  for "explorer" (see renderAuditPage's own call sites)
 *  @param {DataFile|null} df @param {string|null} standardId
 *  @param {string} label human-readable, e.g. "analysis object" / "parsed file
 *    object" — goes in the summary text only
 *  @param {string} fileKind short, filename-safe, e.g. "raw-analysis" /
 *    "raw-datafile" — kept separate from `label` so the 4 real standards' existing
 *    "<file>_<standardId>_raw-analysis.json" naming doesn't shift just because a
 *    longer label reads better on screen */
function buildRawDump(value, df, standardId, label, fileKind) {
  const json = safeStringify(value);
  const fileName = rawDumpFileName(df, standardId, fileKind);
  const saveBtn = el("button", { class: "act", type: "button", onclick: () => downloadJSON(fileName, json) }, "Save as JSON");
  return el("details", { class: "audit-raw-details" },
    el("summary", {}, "Raw " + label + " (for drilling into anything not narrated above)"),
    el("div", { class: "audit-raw-actions" }, saveBtn),
    el("pre", { class: "audit-raw" }, json));
}

/** @param {DataFile|null} df @param {string|null} standardId @param {string} fileKind
 *  @returns {string} */
function rawDumpFileName(df, standardId, fileKind) {
  const base = (df && df.fileName ? df.fileName : "audit").replace(/[^\w.-]+/g, "_");
  return base + "_" + (standardId || "audit") + "_" + fileKind + ".json";
}

/** Own copy of app.js's identical-purpose `download` helper (plus revoking the
 *  object URL after the click, which that copy doesn't bother with) —
 *  auditView.js has no dependency on app.js in either direction (app.js imports
 *  renderAuditPage FROM here; the reverse would be circular), so this small,
 *  standard-agnostic browser-download mechanic is duplicated rather than
 *  imported, same as every other tiny helper this file already keeps local
 *  (fmt, el, safeStringify).
 *  @param {string} name @param {string} text */
function downloadJSON(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/** JSON.stringify with circular/DataFile-heavy references guarded — the live
 *  analysis object is plain data, but this stays defensive since it's a raw dump
 *  of whatever a future engine change might attach to it. */
function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 1);
  } catch (err) {
    return "(could not stringify: " + err.message + ")";
  }
}

/** @param {*} value @param {string} [unit] @returns {string} */
function fmt(value, unit) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (!isFinite(value)) return String(value);
    const rounded = Math.abs(value) >= 100 ? Math.round(value * 10) / 10
      : Math.abs(value) >= 1 ? Math.round(value * 1000) / 1000
      : Math.round(value * 100000) / 100000;
    return rounded + (unit ? " " + unit : "");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value) + (unit ? " " + unit : "");
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
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}
//#endregion

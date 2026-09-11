/* =====================================================================================
   iso3968AuditSteps.js
   =====================================================================================
   Report CONTENT for the Audit Trail view (src/audit/auditView.js) — narrates ISO
   3968:2017's OWN derivation from iso3968Analysis.js's already-computed result
   object. Never shared with another standard's audit steps, per CLAUDE.md.

   Shaped very differently from the 3 multipass standards' step lists — a P-Q sweep
   has no termination/clumps/buckets, just a mode-detection step, curve fits, and a
   per-point table. Points table is sampled (1st/middle/last, via
   ../../audit/auditSampling.js) same as the multipass standards' per-size tables —
   a continuous-mode sweep can run to several dozen points, and the user's own ask
   was for a representative sample everywhere, not just the biggest tables.

   checkFlowRateCompliance is a static method NOT called by run() itself (see
   iso3968Analysis.js's own SCOPE note) — called directly here since it's already-
   exposed, existing logic, just not auto-invoked; matches this file's own "use
   what's already there" v1 scope. Iso3968Analysis is a classic-<script> global
   (window.Iso3968Analysis), not an ES export — same reason app.js's own STANDARDS
   registry reaches it the same way, not via `import`.
   ===================================================================================== */
import { sampleTable } from "../../audit/auditSampling.js";

/** @param {import("./iso3968Analysis.js").Iso3968Analysis|null} analysis @param {DataFile|null} df
 *  @param {import("../../report/reportValueStore.js").ReportValueStore} [store] unused — this
 *  standard's whole trail comes straight off analysis.*, nothing computed in its mapper
 *  @returns {Array<Object>} */
export function buildAuditSteps(analysis, df, store) {
  if (!analysis) return [];
  const steps = [];

  steps.push({
    id: "mode",
    title: "Sweep mode detection",
    clause: "Continuous vs. discrete; reversed vs. one-directional",
    formula: "Continuous: read from the ContinuosFlagStatus header flag. Reversed: the flow-rate sweep peaks strictly INSIDE the point sequence (not at either end) — shape-based, no header flag exists for this.",
    table: {
      columns: ["", "Value"],
      rows: [
        ["Continuous", analysis.continuous],
        ["Reversed", analysis.reversed],
        ["Point count", analysis.points.length],
        ["Flow rate targets (L/min)", (analysis.flowRateTargets || []).join(", ")]
      ]
    }
  });

  if (analysis.points.length && typeof window !== "undefined" && window.Iso3968Analysis) {
    const compliance = window.Iso3968Analysis.checkFlowRateCompliance(analysis.points, analysis.flowRateTargets);
    steps.push({
      id: "flow-compliance",
      title: "Flow-rate compliance",
      clause: "Nearest-target matching, ±5% default tolerance",
      formula: "Each point is matched to its NEAREST flow-rate target (not paired by position) and checked within ±5%.",
      table: {
        columns: ["Point #", "Actual (L/min)", "Nearest target", "Δ%", "OK?"],
        rows: compliance.map((c) => [c.pointIndex, c.actual, c.target, c.deltaPct, c.ok ? "yes" : "no"])
      },
      note: "Continuous-mode points BETWEEN targets can show a large Δ% by design — that's not necessarily a failure, see iso3968Analysis.js's own note."
    });
  }

  steps.push({
    id: "curve-fits",
    title: "Curve fits (assembly & tare)",
    clause: "Quadratic, forced through the origin — ΔP = a·Q + b·Q²",
    formula: "Least-squares fit of this run's own points; the tare (housing-only) run, if supplied, is fit independently the same way.",
    table: {
      columns: ["", "a", "b"],
      rows: [
        ["Assembly fit", analysis.assemblyFit ? analysis.assemblyFit.a : null, analysis.assemblyFit ? analysis.assemblyFit.b : null],
        ["Tare fit", analysis.tare && analysis.tare.fit ? analysis.tare.fit.a : null, analysis.tare && analysis.tare.fit ? analysis.tare.fit.b : null]
      ]
    },
    note: "Net (Filter Element) ΔP is the DIFFERENCE of the two fitted curves evaluated at each of the assembly's own flow rates — not raw point-to-point subtraction, since assembly and tare flow points rarely coincide. See iso3968Analysis.js's own file-top banner for why this was a deliberate design choice."
  });

  const pointSample = sampleTable(
    ["Time (s)", "Flow (L/min)", "Measured ΔP", "Assembly fit ΔP", "Housing fit ΔP", "Element ΔP (net)"],
    analysis.points.map((p) => [p.time, p.flowRate, p.dp, p.assemblyFitDP, p.housingFitDP, p.elementDP]),
    "middle"
  );
  steps.push({
    id: "points",
    title: "Per-point measured & fitted values",
    clause: "Raw points plus each fit evaluated at that point's own flow rate",
    formula: "elementDP = assemblyFitDP − housingFitDP (only when a tare was supplied — otherwise stays null, not 0).",
    table: { columns: pointSample.columns, rows: pointSample.rows },
    note: pointSample.note
  });

  return steps;
}

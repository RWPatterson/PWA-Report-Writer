/* =====================================================================================
   iso23369AuditSteps.js
   =====================================================================================
   Report CONTENT for the Audit Trail view (src/audit/auditView.js) — narrates ISO
   23369:2022's OWN derivation, from iso23369Analysis.js's already-computed result
   object, in the order the standard's own clauses build on each other (10.2.1
   through 13.7). Own copy of iso16889AuditSteps.js's shape, per CLAUDE.md — never
   shared, even where the pattern matches. Two genuinely new steps this standard's
   own math needs that ISO 16889 has no equivalent of: "flow rates" (10.2.1's
   q_min/q_max/q_bar) and "companion file" (11.11's twice-per-cycle recording, the
   phase-split this engine's termination/ΔP-interpolation both depend on).

   No "initial system cleanliness" step — this build doesn't compute one for this
   standard (see iso23369Analysis.js's own file-top note); adding the step back is
   as simple as copying ISO 16889's own equivalent once that data source exists.

   Step shape (auditView.js owns rendering/formatting, this file only supplies
   content): { id, title, clause, formula?, inputs?:[{label,value,unit?}],
   output?:{label,value,unit?}, table?:{columns,rows}, customBody?:HTMLElement, note? }
   ===================================================================================== */
import { sampleTable } from "../../audit/auditSampling.js";
import { buildSizePickerTable } from "../../audit/auditWidgets.js";

/** @param {import("./iso23369Analysis.js").Iso23369Analysis|null} analysis @param {DataFile|null} df
 *  @param {import("../../report/reportValueStore.js").ReportValueStore} [store] used
 *  here (unlike iso16889AuditSteps.js) to read the companion-file extra app.js's
 *  runAnalysisPipeline stashes — no other step needs it, analysis already carries
 *  everything else. @returns {Array<Object>} */
export function buildAuditSteps(analysis, df, store) {
  if (!analysis) return [];
  const steps = [];
  const formatElapsed = (typeof window !== "undefined" && window.AnalysisMath) ? window.AnalysisMath.formatElapsed : (s) => String(s);

  steps.push({
    id: "test-type",
    title: "Test type & setup",
    clause: "General",
    output: { label: "Test type", value: analysis.testType },
    note: [
      analysis.nonStandardTestType ? "Non-standard test type — " + analysis.retainedMassSuppressedReason : null,
      analysis.dualFilterSetup ? "Dual-filter setup — " + analysis.dualFilterRetainedMassReason : null
    ].filter(Boolean).join(" ") || null
  });

  steps.push({
    id: "sensor",
    title: "Sensor selection",
    clause: "Counting system",
    output: { label: "Sensor", value: analysis.sensorLabel || analysis.sensor },
    note: analysis.pressureView ? "Pressure view: " + analysis.pressureView : null
  });

  steps.push({
    id: "flow-rates",
    title: "Average / min / max test flow",
    clause: "10.2.1",
    formula: "q_max = q_min × FlowRatio (no separate q_max setpoint exists in the header). q̄ = (q_max + q_min) / 2 — also the threshold this engine uses to classify a companion-file row as high-flow or low-flow phase (see the companion-file step below).",
    inputs: [
      { label: "q_min (Test System Configuration/Rate)", value: analysis.qMin, unit: "L/min" },
      { label: "FlowRatio (Cyclic Configuration/FlowRatio)", value: analysis.flowRatio }
    ],
    table: {
      columns: ["", "Value (L/min)"],
      rows: [
        ["q_min", analysis.qMin],
        ["q_max", analysis.qMax],
        ["q̄ (average)", analysis.qAvg]
      ]
    },
    note: (analysis.qMin === null || analysis.flowRatio === null)
      ? "q_min or FlowRatio not found in header — q̄ could not be computed; termination/ΔP interpolation fall back to the primary file's raw samples."
      : null
  });

  const companion = store ? store.getExtra("sourceCompanionFile") : null;
  steps.push({
    id: "companion-file",
    title: "Cyclic companion file (\"-Cyclic.DAT\")",
    clause: "11.11 — assembly ΔP recorded twice per flow cycle",
    formula: "Each companion row is classified as high-flow or low-flow phase by its own TS_Rate value, threshold q̄ (the exact midpoint of q_min/q_max by definition). Termination search (below) and reporting-time ΔP interpolation both use the HIGH-FLOW-PHASE sub-series only — the raw alternating series can't be fed directly to a crossing search that assumes a monotonic trend (see iso23369Analysis.js's own file-top note).",
    output: analysis.companionFileMissing
      ? { label: "Status", value: "Not supplied" }
      : { label: "Status", value: "Supplied" + (companion && companion.analog ? " — " + companion.analog.length + " rows" : "") },
    note: analysis.companionFileMissing
      ? "No companion file was supplied — falling back to the primary file's own once-a-minute samples. Table C.3's differential-pressure values may be less precise than the standard intends."
      : null
  });

  const termBracket = analysis.terminationBracket;
  steps.push({
    id: "termination",
    title: "Termination detection",
    clause: "12.1 — crossing the terminal ΔP",
    formula: "First time the assembly ΔP channel (" + (analysis.terminationTag || "—") +
      "), read from the companion file's high-flow-phase sub-series when available, crosses the derived assembly-level target, linearly interpolated between the two bracketing samples: t = t1 + (target − ΔP1) × (t2 − t1) / (ΔP2 − ΔP1).",
    inputs: [
      { label: "Final element ΔP (header TerminalDP, direct)", value: analysis.dpElementFinal, unit: "kPa" },
      { label: "Housing ΔP (clean)", value: analysis.dpHousingClean, unit: "kPa" },
      { label: "Derived assembly-level target", value: analysis.terminationDP, unit: "kPa" },
      { label: "Bracket sample 1 — time", value: termBracket ? formatElapsed(termBracket.before.time) : null },
      { label: "Bracket sample 1 — ΔP", value: termBracket ? termBracket.before.value : null, unit: "kPa" },
      { label: "Bracket sample 2 — time", value: termBracket ? formatElapsed(termBracket.after.time) : null },
      { label: "Bracket sample 2 — ΔP", value: termBracket ? termBracket.after.value : null, unit: "kPa" }
    ],
    output: { label: "Termination time", value: formatElapsed(analysis.terminationTime) },
    note: [
      "Unlike ISO 16889: the header's TerminalDP is the final ELEMENT ΔP directly (11.3) — the assembly-level search target is the DERIVED value (element + housing), the reverse of ISO 16889's own direction.",
      termBracket ? null : "No bracket — the channel never reached the terminal ΔP target; termination fell back to the last recorded sample."
    ].filter(Boolean).join(" ")
  });

  steps.push({
    id: "clean-baselines",
    title: "Clean element ΔP baseline",
    clause: "11.2",
    formula: "Element ΔP (clean) = Assembly ΔP (clean) − Housing ΔP (clean) — same direction as ISO 16889's own clean pair.",
    inputs: [
      { label: "Housing ΔP (clean)", value: analysis.dpHousingClean, unit: "kPa" },
      { label: "Assembly ΔP (clean)", value: analysis.dpAssemblyClean, unit: "kPa" }
    ],
    output: { label: "Element ΔP (clean)", value: analysis.dpElementClean, unit: "kPa" }
  });

  steps.push({
    id: "reporting-time-selection",
    title: "Reporting-time selection & count-averaging window",
    clause: "12.1-12.2 (exact reporting time) + 12.5 (rounded count window) — always exactly 10, at 10%/20%/…/100% of termination time",
    formula: "reportingTime_k = (k/10) × terminationTime, for k=1..10 — exact, no rounding. Count window: windowStop_k = ceil(reportingTime_k / countCycle) × countCycle; windowStart_k = windowStop_(k-1) + countCycle — rounded to this FILE'S OWN count-cycle length (CountTime+HoldTime), not a hardcoded whole minute, since the standard's own text anticipates count cycles shorter than 60s.",
    inputs: [
      { label: "Count cycle length (CountTime + HoldTime)", value: (df ? df.countTimeSec + df.holdTimeSec : null), unit: "sec" }
    ],
    table: {
      columns: ["%", "Exact reporting time", "Exact reporting time (min)", "Count window (min)"],
      rows: analysis.clumps.map((c) => [c.percent, formatElapsed(c.testTimeMin * 60), c.testTimeMin, c.startMin.toFixed(2) + "–" + c.stopMin.toFixed(2)])
    },
    note: "Assembly ΔP below is interpolated at the EXACT reporting time column; the count window column is what the ratio table below actually sums counts over — they are NOT the same instant, by design."
  });

  function fmtTooltipNum(v) {
    if (v === null || v === undefined) return "—";
    if (!isFinite(v)) return String(v);
    const rounded = Math.abs(v) >= 100 ? Math.round(v * 10) / 10
      : Math.abs(v) >= 1 ? Math.round(v * 1000) / 1000
      : Math.round(v * 100000) / 100000;
    return String(rounded);
  }
  /** @param {*} clump @param {number} sizeIndex @param {string} sizeLabel */
  function buildRatioCellTitle(clump, sizeIndex, sizeLabel) {
    const lines = [sizeLabel + " — bucket " + clump.percent + "% (count window " + clump.startMin.toFixed(2) + "–" + clump.stopMin.toFixed(2) + " min)"];
    if (!clump.countRows.length) {
      lines.push("No data rows found in this count window — ratio could not be computed (shown as \"—\").");
      return lines.join("\n");
    }
    let sumUp = 0, sumDown = 0, n = 0;
    for (const row of clump.countRows) {
      const up = row.up[sizeIndex], down = row.down[sizeIndex];
      if (up === null || down === null) {
        lines.push("  " + formatElapsed(row.time) + ": up=" + fmtTooltipNum(up) + " down=" + fmtTooltipNum(down) + " (skipped, incomplete pair)");
        continue;
      }
      sumUp += up; sumDown += down; n++;
      lines.push("  " + formatElapsed(row.time) + ": up=" + fmtTooltipNum(up) + " down=" + fmtTooltipNum(down));
    }
    lines.push("Σup=" + fmtTooltipNum(sumUp) + "  Σdown=" + fmtTooltipNum(sumDown) + "  n=" + n + " row" + (n === 1 ? "" : "s"));
    lines.push(n > 0
      ? "a = min(Σup/Σdown, 100000) = " + fmtTooltipNum(sumDown > 0 ? Math.min(sumUp / sumDown, 100000) : 100000)
      : "Every row in this window had an incomplete up/down pair for this size — ratio could not be computed (shown as \"—\").");
    return lines.join("\n");
  }

  const sizeLabels = analysis.sizes.map((s) => s + "µm");
  const clumpRatioWidget = buildSizePickerTable({
    fixedColumns: ["%", "Count window (min)", "Assy ΔP (kPa)", "Elem ΔP (kPa)"],
    sizeLabels,
    valueColumnSuffix: "a",
    rows: analysis.clumps.map((c) => ({ fixed: [c.percent, c.startMin.toFixed(2) + "–" + c.stopMin.toFixed(2), c.assemblyDP, c.elementDP], bySize: c.avgRatio })),
    defaultSizeIndex: 0,
    cellTitle: (rowIndex, sizeIndex) => buildRatioCellTitle(analysis.clumps[rowIndex], sizeIndex, sizeLabels[sizeIndex])
  });
  steps.push({
    id: "clump-ratio",
    title: "Filtration ratio a per bucket (12.5-12.6)",
    clause: "12.5-12.6 — computed over each bucket's own count-averaging window established above",
    formula: "a (per bucket, per size) = min(Σ upstream counts / Σ downstream counts, 100,000) — summed over every count-cycle row in that bucket's own count window (13.6's own stated ceiling). Hover an a cell to see the actual per-row counts it was summed from.",
    customBody: clumpRatioWidget,
    note: "All 10 buckets shown for whichever size is selected above — watch consecutive rows to confirm the SAME averaging rule is applied bucket-to-bucket, holding through the last one."
  });

  const overallSample = sampleTable(
    ["Size (µm)", "Mean upstream", "Mean downstream", "Overall a"],
    analysis.sizes.map((s, i) => [s, analysis.overallUpstreamAverage[i], analysis.overallDownstreamAverage[i], analysis.overallAverageRatio[i]]),
    "middle"
  );
  steps.push({
    id: "overall-averages",
    title: "Overall averages (12.7-12.8)",
    clause: "12.7-12.8",
    formula: "Mean of the 10 buckets' own upstream/downstream averages, per size; Overall a = mean(upstream) / mean(downstream), clamped at 100,000.",
    table: { columns: overallSample.columns, rows: overallSample.rows },
    note: overallSample.note
  });

  const Iso23369Analysis = (typeof window !== "undefined") ? window.Iso23369Analysis : null;
  const sizeAtRatioRows = Object.keys(analysis.sizeAtRatio || {}).map((ratio) => {
    const detail = Iso23369Analysis
      ? Iso23369Analysis.sizeGivenRatioDetail(Number(ratio), analysis.sizes, analysis.overallAverageRatio)
      : { result: analysis.sizeAtRatio[ratio], bracket: null };
    return [ratio, detail.result,
      detail.bracket ? detail.bracket.lowerSize : null, detail.bracket ? detail.bracket.lowerRatio : null,
      detail.bracket ? detail.bracket.upperSize : null, detail.bracket ? detail.bracket.upperRatio : null];
  });
  steps.push({
    id: "size-at-ratio",
    title: "Particle size at filtration ratio a (13.7)",
    clause: "13.6-13.7",
    formula: "Size = lowerSize + (upperSize − lowerSize) × (ln(targetA) − ln(lowerA)) / (ln(upperA) − ln(lowerA)) — " +
      "log-linear reverse interpolation (formula 18), linear in particle SIZE but LOGARITHMIC in a, between the two bracketing " +
      "measured points shown in the table below — algebraically identical to ISO 16889's own Size_At_Beta_x, per iso23369Analysis.js's own file-top note.",
    table: {
      columns: ["Target a", "Size (µm)", "Bracket: lower size", "lower a", "upper size", "upper a"],
      rows: sizeAtRatioRows
    },
    note: "Blank bracket columns mean the target fell outside the measured a range (result shown as \"<x\"/\">x\") rather than being interpolated."
  });

  steps.push({
    id: "injection-flow",
    title: "Injection flow rate & reservoir volume (11.7, 11.15)",
    clause: "11.7 (flow rate) / 11.15 (final volume, computed)",
    inputs: [
      { label: "Injection flow setpoint", value: analysis.injectionFlowSetpoint, unit: "mL/min" },
      { label: "q̄ (average test flow)", value: analysis.qAvg, unit: "L/min" }
    ],
    table: {
      columns: ["", "Value"],
      rows: [
        ["Measured q̄_i (mL/min)", analysis.qia],
        ["Upstream sample flow, qu (mL/min)", analysis.qu],
        ["Downstream sample flow, qd (mL/min)", analysis.qd],
        ["Injection reservoir volume, initial (L)", analysis.injVolumeInitial],
        ["Injection reservoir volume, final, computed (L)", analysis.injVolumeFinal]
      ]
    },
    note: "Final = Initial − (q̄_i × termination time) — the injection reservoir drains at q̄_i over the test. Both qu and qd (not qd alone, unlike ISO 16889) feed 13.3's retained-capacity formula — see computeMassBalance's own comment."
  });

  steps.push({
    id: "bugl-target",
    title: "Average base upstream gravimetric level target (12.12)",
    clause: "12.12",
    formula: "c̄_b = (Injection gravimetric setpoint × Injection flow setpoint[L/min]) / q̄ — the DESIGN target, computed from setpoints alone. Denominator is q̄ (10.2.1's average test flow), not a single steady flow setpoint the way ISO 16889's own equivalent divides. The ACTUAL c̄_b uses the same formula against MEASURED values instead, once a gravimetric result is entered — see the Report view, not this trail.",
    inputs: [
      { label: "Injection gravimetric setpoint", value: analysis.injectionGravSetpoint, unit: "mg/L" },
      { label: "Injection flow setpoint", value: analysis.injectionFlowSetpoint, unit: "mL/min" },
      { label: "q̄ (average test flow)", value: analysis.qAvg, unit: "L/min" }
    ],
    output: { label: "Target c̄_b", value: analysis.buglTarget, unit: "mg/L" }
  });

  return steps;
}

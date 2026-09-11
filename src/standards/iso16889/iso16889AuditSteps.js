/* =====================================================================================
   iso16889AuditSteps.js
   =====================================================================================
   Report CONTENT for the Audit Trail view (src/audit/auditView.js) — narrates ISO
   16889:2022's OWN derivation, from iso16889Analysis.js's already-computed result
   object, in the order the standard's own clauses build on each other (12.1 through
   13.6). Never shared with another standard's audit steps, per CLAUDE.md — even
   though one shared auditView.js renders whatever step list this returns.

   v2: every interpolated value now shows the actual two bracketing measured points it
   was computed from (terminationBracket on the analysis object; sizeGivenBetaDetail's
   bracket, called directly here) — not just the final answer — and most per-size
   tables show a labeled representative SAMPLE (via ../../audit/auditSampling.js)
   rather than a full dump, per the user's own framing: show enough rows/columns to
   prove a rule is established and indexing is correct, not every one of 10 clumps ×
   32 sizes. Full data remains in auditView.js's raw JSON dump regardless.

   v3: reversed that sampling choice specifically for the β-per-clump table, per the
   user (2026-08-11) — it now shows all 10 clumps with an INTERACTIVE size picker
   (../../audit/auditWidgets.js's buildSizePickerTable) instead of a 3x3 sample, since
   a dropdown covers all 32 sizes without a wall of columns, and the hover-tooltip
   detail stays available for whichever size is selected. Everywhere else still uses
   the static sampleTable/sampleWideTable approach — this was a targeted reversal for
   one table the user found the sampling less useful for, not a wholesale rule change.

   Step shape (auditView.js owns rendering/formatting, this file only supplies
   content): { id, title, clause, formula?, inputs?:[{label,value,unit?}],
   output?:{label,value,unit?}, table?:{columns,rows}, customBody?:HTMLElement, note? }
   ===================================================================================== */
import { sampleTable } from "../../audit/auditSampling.js";
import { buildSizePickerTable } from "../../audit/auditWidgets.js";

/** @param {import("./iso16889Analysis.js").Iso16889Analysis|null} analysis @param {DataFile|null} df
 *  @param {import("../../report/reportValueStore.js").ReportValueStore} [store] unused here — iso16889Analysis.js
 *  computes dpElementClean/dpElementFinal itself, unlike iso454812/iso19438 (see those standards' own AuditSteps.js).
 *  Accepted anyway so auditView.js can call every standard's buildAuditSteps with the same signature.
 *  @returns {Array<Object>} */
export function buildAuditSteps(analysis, df, store) {
  if (!analysis) return [];
  const steps = [];
  // Elapsed times (termination, bracket sample times) are computed and stored in
  // SECONDS throughout the engine — that doesn't change here. Only the AUDIT DISPLAY
  // converts to H:MM:SS, matching how the report itself shows termination time
  // (iso16889Mapper.js's own formatElapsed call) — same AnalysisMath.formatElapsed
  // the report uses, reached as a classic-script global (analysisMath.js isn't an ES
  // module) same as this file's own window.Iso16889Analysis reference below.
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

  const termBracket = analysis.terminationBracket;
  steps.push({
    id: "termination",
    title: "Termination detection",
    clause: "12.1 — crossing the terminal ΔP",
    formula: "First time the assembly ΔP channel (" + (analysis.terminationTag || "—") +
      ") crosses the configured Terminal ΔP target, linearly interpolated between the two bracketing " +
      "samples: t = t1 + (target − ΔP1) × (t2 − t1) / (ΔP2 − ΔP1).",
    inputs: [
      { label: "Terminal ΔP target", value: analysis.terminationDP, unit: "kPa" },
      { label: "Bracket sample 1 — time", value: termBracket ? formatElapsed(termBracket.before.time) : null },
      { label: "Bracket sample 1 — ΔP", value: termBracket ? termBracket.before.value : null, unit: "kPa" },
      { label: "Bracket sample 2 — time", value: termBracket ? formatElapsed(termBracket.after.time) : null },
      { label: "Bracket sample 2 — ΔP", value: termBracket ? termBracket.after.value : null, unit: "kPa" }
    ],
    output: { label: "Termination time", value: formatElapsed(analysis.terminationTime) },
    note: termBracket ? null : "No bracket — the channel never reached the terminal ΔP target; termination fell back to the last recorded sample."
  });

  steps.push({
    id: "clean-baselines",
    title: "Clean / element ΔP baselines",
    clause: "General",
    formula: "Element ΔP (clean) = Assembly ΔP (clean) − Housing ΔP (clean).  Element ΔP (final) = Termination ΔP − Housing ΔP (clean).",
    inputs: [
      { label: "Housing ΔP (clean)", value: analysis.dpHousingClean, unit: "kPa" },
      { label: "Assembly ΔP (clean)", value: analysis.dpAssemblyClean, unit: "kPa" }
    ],
    table: {
      columns: ["", "Value (kPa)"],
      rows: [
        ["Element ΔP (clean)", analysis.dpElementClean],
        ["Element ΔP (final)", analysis.dpElementFinal]
      ]
    }
  });

  // ---- How the 10 reporting-TIME stamps themselves were chosen (12.1-12.2, 12.5) —
  // deliberately its own step, separate from the β CALCULATION below (per the user):
  // TWO DISTINCT time references per clump, not one. reportingTime is the EXACT k/10
  // fraction of termination time (12.1/12.2) — what assembly ΔP is interpolated at,
  // no rounding reason to round a continuous analog signal. The count-AVERAGING
  // window is different: rounded UP to a whole minute (12.5), because counts are
  // recorded per-minute count-cycle and can't be averaged over a fractional one, with
  // each window starting the minute right after the PREVIOUS window's rounded stop —
  // never re-anchored to the exact reporting time — so rounding error never
  // compounds/drifts across the 10 clumps. Shown IN FULL (all 10, not sampled): the
  // whole point is watching the progression establish and hold the rule, which a 3-row
  // sample would undercut. See iso16889Analysis.js's own file-top note for the
  // formula's derivation and its verification against the standard's own 86-minute
  // worked example. ----
  steps.push({
    id: "reporting-time-selection",
    title: "Reporting-time selection & count-averaging window",
    clause: "12.1-12.2 (exact reporting time) + 12.5 (rounded count window) — always exactly 10, at 10%/20%/…/100% of termination time",
    formula: "reportingTime_k = (k/10) × terminationTime, for k=1..10 — exact, no rounding (what assembly ΔP is interpolated at). " +
      "Count window: windowStop_k = ceil(reportingTime_k) whole minutes; windowStart_k = windowStop_(k-1) + 1 " +
      "(clump 1 starts the minute right after the disregard period ends, not from time zero).",
    table: {
      columns: ["%", "Exact reporting time", "Exact reporting time (min)", "Count window (min)"],
      rows: analysis.clumps.map((c) => [c.percent, formatElapsed(c.testTimeMin * 60), c.testTimeMin, c.startMin + "–" + c.stopMin])
    },
    note: "Assembly ΔP below is interpolated at the EXACT reporting time column; the count window column is what the β table below actually sums counts over — they are NOT the same instant, by design."
  });

  // Same rounding as auditView.js's own fmt() (duplicated, not imported — importing
  // FROM auditView.js here would create the exact import cycle auditSampling.js was
  // split out to avoid, since auditView.js imports buildAuditSteps FROM this file).
  // Plain-text only (native `title` attribute, no HTML) — see buildBetaCellTitle.
  function fmtTooltipNum(v) {
    if (v === null || v === undefined) return "—";
    if (!isFinite(v)) return String(v);
    const rounded = Math.abs(v) >= 100 ? Math.round(v * 10) / 10
      : Math.abs(v) >= 1 ? Math.round(v * 1000) / 1000
      : Math.round(v * 100000) / 100000;
    return String(rounded);
  }
  /** One clump/size beta cell's hover tooltip: every count-cycle row actually summed
   *  into that cell's β, not just the aggregate — the "input counts" a reader can't
   *  otherwise see without opening the raw JSON dump and cross-referencing row indices
   *  by hand. @param {*} clump @param {number} sizeIndex @param {string} sizeLabel */
  function buildBetaCellTitle(clump, sizeIndex, sizeLabel) {
    const lines = [sizeLabel + " — clump " + clump.percent + "% (count window " + clump.startMin + "–" + clump.stopMin + " min)"];
    if (!clump.countRows.length) {
      lines.push("No data rows found in this count window — β could not be computed (shown as \"—\").");
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
      ? "β = min(Σup/Σdown, 100000) = " + fmtTooltipNum(sumDown > 0 ? Math.min(sumUp / sumDown, 100000) : 100000)
      : "Every row in this window had an incomplete up/down pair for this size — β could not be computed (shown as \"—\").");
    return lines.join("\n");
  }

  // Reversed an earlier design choice per the user (2026-08-11): rather than a static
  // 3-row x 3-size SAMPLE, show ALL 10 clumps at once (same "watch the rule hold
  // across the full progression" reasoning as the reporting-time step above) with an
  // interactive size picker for WHICH size's β column to display, defaulted to the
  // smallest measured size — a dropdown covers all 32 sizes without the wall-of-
  // columns problem sampling was originally solving, and keeps the hover-tooltip
  // detail (still extremely useful, per the user) working for whichever size is
  // currently selected.
  const sizeLabels = analysis.sizes.map((s) => s + "µm");
  const clumpBetaWidget = buildSizePickerTable({
    fixedColumns: ["%", "Count window (min)", "Assy ΔP (kPa)", "Elem ΔP (kPa)"],
    sizeLabels,
    valueColumnSuffix: "β",
    rows: analysis.clumps.map((c) => ({ fixed: [c.percent, c.startMin + "–" + c.stopMin, c.assemblyDP, c.elementDP], bySize: c.avgBeta })),
    defaultSizeIndex: 0,   // smallest measured size
    // Hover a β cell to see the actual per-count-cycle up/down readings it was
    // summed from — screen-only (see app.css's .has-tooltip), not part of the
    // printed page. rowIndex here IS the clump index directly (all 10 shown, no
    // sampling remap needed); sizeIndex is whichever the picker currently selects.
    cellTitle: (rowIndex, sizeIndex) => buildBetaCellTitle(analysis.clumps[rowIndex], sizeIndex, sizeLabels[sizeIndex])
  });
  steps.push({
    id: "clump-beta",
    title: "β ratio per clump (12.5-12.6)",
    clause: "12.5-12.6 — computed over each clump's own count-averaging window established above",
    formula: "β (per clump, per size) = min(Σ upstream counts / Σ downstream counts, 100,000) — summed over every count-cycle row in that clump's own count window (13.5's own stated ceiling). Hover a β cell to see the actual per-row counts it was summed from.",
    customBody: clumpBetaWidget,
    note: "All 10 clumps shown for whichever size is selected above — watch consecutive rows to confirm the SAME averaging rule is applied clump-to-clump, holding through the last one."
  });

  const overallSample = sampleTable(
    ["Size (µm)", "Mean upstream", "Mean downstream", "Overall β"],
    analysis.sizes.map((s, i) => [s, analysis.overallUpstreamAverage[i], analysis.overallDownstreamAverage[i], analysis.overallAverageBeta[i]]),
    "middle"
  );
  steps.push({
    id: "overall-averages",
    title: "Overall averages (12.7-12.8)",
    clause: "12.7-12.8",
    formula: "Mean of the 10 clumps' own upstream/downstream averages, per size; Overall β = mean(upstream) / mean(downstream), clamped at 100,000.",
    table: { columns: overallSample.columns, rows: overallSample.rows },
    note: overallSample.note
  });

  const Iso16889Analysis = (typeof window !== "undefined") ? window.Iso16889Analysis : null;
  const sizeAtBetaRows = Object.keys(analysis.sizeAtBeta || {}).map((beta) => {
    const detail = Iso16889Analysis
      ? Iso16889Analysis.sizeGivenBetaDetail(Number(beta), analysis.sizes, analysis.overallAverageBeta)
      : { result: analysis.sizeAtBeta[beta], bracket: null };
    return [beta, detail.result,
      detail.bracket ? detail.bracket.lowerSize : null, detail.bracket ? detail.bracket.lowerBeta : null,
      detail.bracket ? detail.bracket.upperSize : null, detail.bracket ? detail.bracket.upperBeta : null];
  });
  steps.push({
    id: "size-at-beta",
    title: "Size_At_Beta_x (13.6)",
    clause: "13.5-13.6",
    formula: "Size = lowerSize + (upperSize − lowerSize) × (ln(targetβ) − ln(lowerβ)) / (ln(upperβ) − ln(lowerβ)) — " +
      "log-linear reverse interpolation, linear in particle SIZE but LOGARITHMIC in β, between the two bracketing " +
      "measured points shown in the table below (a deliberate correctness fix over the legacy engine's plain-linear " +
      "interpolation; see iso16889Analysis.js's own file-top note).",
    table: {
      columns: ["Target β", "Size (µm)", "Bracket: lower size", "lower β", "upper size", "upper β"],
      rows: sizeAtBetaRows
    },
    note: "Blank bracket columns mean the target fell outside the measured β range (result shown as \"<x\"/\">x\") rather than being interpolated."
  });

  const initialSample = sampleTable(
    ["Size (µm)", "Initial upstream count"],
    analysis.sizes.map((s, i) => [s, analysis.initialUpstream[i]]),
    "middle"
  );
  steps.push({
    id: "initial-cleanliness",
    title: "Initial system cleanliness",
    clause: "General",
    formula: "Upstream-only counts from the last minute of flushing BEFORE dust injection begins — not one of the 10 reporting-time clumps above.",
    table: { columns: initialSample.columns, rows: initialSample.rows },
    note: initialSample.note
  });

  steps.push({
    id: "injection-flow",
    title: "Injection flow rate & reservoir volume (12.11)",
    clause: "12.11",
    inputs: [
      { label: "Injection flow setpoint", value: analysis.injectionFlowSetpoint, unit: "mL/min" },
      { label: "Test flow setpoint", value: analysis.testFlowSetpoint, unit: "L/min" }
    ],
    table: {
      // Raw numbers, not pre-concatenated "value + unit" strings — units live in
      // the row label instead, so auditView.js's fmt() still rounds every cell
      // consistently (a pre-concatenated string bypasses that rounding entirely).
      columns: ["", "Value"],
      rows: [
        ["Measured Qia (mL/min)", analysis.qia],
        ["Downstream sample flow Qd (mL/min)", analysis.qd],
        ["Injection reservoir volume, initial (L)", analysis.injVolumeInitial],
        ["Injection reservoir volume, final, computed (L)", analysis.injVolumeFinal]
      ]
    },
    note: "Final = Initial − (Qia × termination time) — the injection reservoir drains at Qia over the test."
  });

  steps.push({
    id: "bugl-target",
    title: "Average_BUGL target (12.12)",
    clause: "12.12",
    formula: "Average_BUGL = (Injection gravimetric setpoint × Injection flow setpoint[L/min]) / Test flow setpoint — the DESIGN target, computed from setpoints alone (no gravimetric lab result needed yet). The ACTUAL Average_BUGL uses the same formula against MEASURED values instead, once a gravimetric result is entered — see the Report view, not this trail.",
    inputs: [
      { label: "Injection gravimetric setpoint", value: analysis.injectionGravSetpoint, unit: "mg/L" },
      { label: "Injection flow setpoint", value: analysis.injectionFlowSetpoint, unit: "mL/min" },
      { label: "Test flow setpoint", value: analysis.testFlowSetpoint, unit: "L/min" }
    ],
    output: { label: "Target Average_BUGL", value: analysis.buglTarget, unit: "mg/L" }
  });

  return steps;
}

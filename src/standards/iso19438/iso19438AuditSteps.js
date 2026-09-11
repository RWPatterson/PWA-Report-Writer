/* =====================================================================================
   iso19438AuditSteps.js
   =====================================================================================
   Report CONTENT for the Audit Trail view (src/audit/auditView.js) — narrates ISO
   19438:2023's OWN derivation from iso19438Analysis.js's already-computed result
   object. Never shared with another standard's audit steps, per CLAUDE.md.

   Same "Element/Housing ΔP computed in the mapper, not the engine" situation as
   iso454812AuditSteps.js — confirmed by reading iso19438Mapper.js directly (same
   dpFinalNet/dpElementClean pattern, own copy) — so this file also reads `store`
   for those three fields.

   v2: every interpolated value now shows the actual two bracketing measured points it
   was computed from (terminationBracket / each milestone's own bracket, both already
   on the analysis object; sizeGivenEfficiencyDetail's bracket, called directly here
   for BOTH the Initial and Overall rating curves) — not just the final answer — and
   most per-size tables show a labeled representative SAMPLE (via
   ../../audit/auditSampling.js) rather than a full dump. Full data remains in
   auditView.js's raw JSON dump regardless.

   v3 (2026-08-11): same treatment ISO 16889's audit trail got — a dedicated step
   explaining how the bucket WINDOWS themselves are chosen (own copy of ISO
   4548-12's identical mechanism — see that file's own AuditSteps.js comment), and
   the bucket efficiency table itself reversed from a static 3x3 sample to all
   buckets shown at once with an interactive size picker
   (../../audit/auditWidgets.js), keeping the hover-tooltip raw count detail
   working for whichever size is currently selected.
   ===================================================================================== */
import { sampleTable } from "../../audit/auditSampling.js";
import { buildSizePickerTable } from "../../audit/auditWidgets.js";

/** @param {import("./iso19438Analysis.js").Iso19438Analysis|null} analysis @param {DataFile|null} df
 *  @param {import("../../report/reportValueStore.js").ReportValueStore} [store] needed for
 *  dpHousingClean/dpElementClean/dpFinalNet — computed in iso19438Mapper.js, not here
 *  @returns {Array<Object>} */
export function buildAuditSteps(analysis, df, store) {
  if (!analysis) return [];
  const steps = [];
  const g = (id) => (store ? store.get(id) : null);
  // Buckets are computed in SECONDS on purpose (a count cycle isn't guaranteed to be
  // exactly 1 minute, and the standard's disregard/window cutoffs are minutes-of-test,
  // not count-cycles) — the calculation stays in seconds. Only the AUDIT DISPLAY of a
  // bucket's window converts to H:MM:SS, matching how the report itself shows
  // termination/milestone times (iso19438Mapper.js's own formatElapsed call) — same
  // AnalysisMath.formatElapsed the report uses, reached as a classic-script global
  // (analysisMath.js isn't an ES module) same as this file's own window.Iso19438Analysis reference below.
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

  const termBracket = analysis.terminationBracket;
  steps.push({
    id: "termination",
    title: "Termination detection",
    clause: "Crossing the terminal ΔP",
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
    title: "Clean / element / net ΔP",
    clause: "General — computed in iso19438Mapper.js, not the analysis engine",
    formula: "Element ΔP (clean) = Assembly ΔP (clean) − Housing ΔP (clean).  Net final ΔP = Termination ΔP − Assembly ΔP (clean).",
    inputs: [
      { label: "Housing ΔP (clean, header CleanHousingDP)", value: g("dpHousingClean"), unit: "kPa" },
      { label: "Assembly ΔP (clean)", value: analysis.cleanAssemblyDP, unit: "kPa" }
    ],
    table: {
      columns: ["", "Value (kPa)"],
      rows: [
        ["Element ΔP (clean)", g("dpElementClean")],
        ["Net final ΔP", g("dpFinalNet")]
      ]
    }
  });

  steps.push({
    id: "net-dp-milestones",
    title: "% Net ΔP milestones",
    clause: "7-point %-of-net-ΔP-rise table",
    formula: "targetΔP = Clean assembly ΔP + (percent/100) × (Termination ΔP − Clean assembly ΔP); the crossing time is found the same way termination itself is, and every row's own bracket (the two measured samples it was interpolated between) is shown alongside it.",
    table: {
      columns: ["% Net ΔP", "Test time (min)", "Assembly ΔP (kPa)", "Bracket t1", "ΔP1", "Bracket t2", "ΔP2"],
      rows: analysis.netDPMilestones.map((m) => [m.percent, m.testTimeMin, m.assyDP,
        m.bracket ? formatElapsed(m.bracket.before.time) : null, m.bracket ? m.bracket.before.value : null,
        m.bracket ? formatElapsed(m.bracket.after.time) : null, m.bracket ? m.bracket.after.value : null])
    },
    note: "A blank bracket means this milestone was never reached (see analysis.warnings)."
  });

  const initialSample = sampleTable(
    ["Size (µm)", "Upstream", "Downstream", "Efficiency %"],
    analysis.sizes.map((s, i) => [s, analysis.initialUpstream[i], analysis.initialDownstream[i], analysis.initialEfficiency[i]]),
    "middle"
  );
  steps.push({
    id: "initial-efficiency",
    title: "Initial Efficiency (E6)",
    clause: "Fixed minutes 3:01–6:00 window — a deliberate ISO 19438-specific quirk (contrast ISO 4548-12's clock-bucket grid, which has no equivalent fixed window)",
    formula: "Same efficiency formula as a reporting bucket, over this ONE fixed window.",
    table: { columns: initialSample.columns, rows: initialSample.rows },
    note: initialSample.note
  });

  // ---- How the bucket WINDOWS themselves are chosen — own copy of ISO 4548-12's
  // identical mechanism (fixed clock grid, anchored at test start, disregard period
  // shortens the first bucket rather than shifting the grid, no shared boundary rows
  // between consecutive buckets, last window clamped to the exact termination time)
  // — see that standard's own AuditSteps.js comment for the full rationale; not
  // repeated here since it's independently re-derived in THIS file's own engine
  // (own copy per CLAUDE.md), it just happens to land on the same design. Shown IN
  // FULL (not sampled), same reasoning as ISO 16889's reporting-time step. ----
  steps.push({
    id: "bucket-time-selection",
    title: "Bucket window selection",
    clause: "Fixed-duration clock grid — " + (analysis.bucketMinutes || "?") + " min each (5 if termination ≤60 min, else 10), anchored at test start",
    formula: "windowEnd = min(next grid mark, termination time); windowStart = PREVIOUS bucket's windowEnd + 1 second " +
      "(bucket 1 starts right after the disregard period, not at the raw grid mark) — no shared boundary rows between " +
      "consecutive buckets. ΔP is read at windowEnd (instantaneous reading, not a window average).",
    table: {
      columns: ["Bucket #", "Window", "Test time (min)", "ΔP at window end (kPa)"],
      rows: analysis.buckets.map((b, i) => [i + 1, formatElapsed(b.startTime) + "–" + formatElapsed(b.endTime), b.testTimeMin, b.dpAtEnd])
    },
    note: "The count window below is what the efficiency table below actually sums counts over."
  });

  // Reversed from a static sample to ALL buckets + an interactive size picker, per
  // the user (2026-08-11) — same reasoning/mechanism as ISO 16889's β-per-clump table.
  const sizeLabels = analysis.sizes.map((s) => s + "µm");
  // Same rounding as auditView.js's own fmt() (duplicated, not imported — see
  // iso16889AuditSteps.js's own note on why: avoiding a circular import).
  function fmtTooltipNum(v) {
    if (v === null || v === undefined) return "—";
    if (!isFinite(v)) return String(v);
    const rounded = Math.abs(v) >= 100 ? Math.round(v * 10) / 10
      : Math.abs(v) >= 1 ? Math.round(v * 1000) / 1000
      : Math.round(v * 100000) / 100000;
    return String(rounded);
  }
  /** One bucket/size efficiency cell's hover tooltip: every count-cycle row actually
   *  summed into it, not just the aggregate. @param {*} bucket @param {number} sizeIndex @param {string} sizeLabel */
  function buildEfficiencyCellTitle(bucket, sizeIndex, sizeLabel) {
    const lines = [sizeLabel + " — window " + formatElapsed(bucket.startTime) + "–" + formatElapsed(bucket.endTime)];
    if (!bucket.countRows.length) {
      lines.push("No data rows found in this window — efficiency could not be computed (shown as \"—\").");
      return lines.join("\n");
    }
    let sumUp = 0, sumDown = 0, n = 0;
    for (const row of bucket.countRows) {
      const up = row.up[sizeIndex], down = row.down[sizeIndex];
      if (up === null || down === null) {
        lines.push("  " + formatElapsed(row.time) + ": up=" + fmtTooltipNum(up) + " down=" + fmtTooltipNum(down) + " (skipped, incomplete pair)");
        continue;
      }
      sumUp += up; sumDown += down; n++;
      lines.push("  " + formatElapsed(row.time) + ": up=" + fmtTooltipNum(up) + " down=" + fmtTooltipNum(down));
    }
    lines.push("Σup=" + fmtTooltipNum(sumUp) + "  Σdown=" + fmtTooltipNum(sumDown) + "  n=" + n + " row" + (n === 1 ? "" : "s"));
    lines.push(n > 0 && sumUp > 0
      ? "efficiency% = clamp(0,100, (Σup−Σdown)/Σup × 100) = " + fmtTooltipNum(Math.max(0, Math.min(100, ((sumUp - sumDown) / sumUp) * 100)))
      : "Σup was 0 (or every row had an incomplete pair) — efficiency could not be computed (shown as \"—\").");
    return lines.join("\n");
  }

  const bucketWidget = buildSizePickerTable({
    fixedColumns: ["Bucket #", "Window", "Test time (min)"],
    sizeLabels,
    valueColumnSuffix: "eff%",
    rows: analysis.buckets.map((b, i) => ({ fixed: [i + 1, formatElapsed(b.startTime) + "–" + formatElapsed(b.endTime), b.testTimeMin], bySize: b.efficiency })),
    defaultSizeIndex: 0,   // smallest measured size
    cellTitle: (rowIndex, sizeIndex) => buildEfficiencyCellTitle(analysis.buckets[rowIndex], sizeIndex, sizeLabels[sizeIndex])
  });
  steps.push({
    id: "buckets",
    title: "Time-bucket efficiency",
    clause: "Fixed-duration buckets — " + (analysis.bucketMinutes || "?") + " min each, windows established above",
    formula: "Per size: efficiency% = clamp(0,100, ((Σupstream − Σdownstream) / Σupstream) × 100) over that bucket's own window. Hover an efficiency cell to see the actual per-row counts it was summed from.",
    customBody: bucketWidget,
    note: "All buckets shown for whichever size is selected above — watch consecutive rows to confirm the SAME formula is applied window-to-window, holding through the last one."
  });

  const overallSample = sampleTable(
    ["Size (µm)", "Overall %"],
    analysis.sizes.map((s, i) => [s, analysis.overallEfficiency[i]]),
    "middle"
  );
  steps.push({
    id: "overall-efficiency",
    title: "Overall efficiency",
    clause: "Same formula as a bucket, run against the WHOLE valid window (not an average of the per-bucket values)",
    table: { columns: overallSample.columns, rows: overallSample.rows },
    note: overallSample.note
  });

  const Iso19438Analysis = (typeof window !== "undefined") ? window.Iso19438Analysis : null;
  function ratingRows(curveValues) {
    return Object.keys(analysis.initialFilterRating || {}).map((eff) => {
      const detail = Iso19438Analysis
        ? Iso19438Analysis.sizeGivenEfficiencyDetail(Number(eff), analysis.sizes, curveValues)
        : { result: null, bracket: null };
      return [eff, detail.result,
        detail.bracket ? detail.bracket.lowerSize : null, detail.bracket ? detail.bracket.lowerEff : null,
        detail.bracket ? detail.bracket.upperSize : null, detail.bracket ? detail.bracket.upperEff : null];
    });
  }
  const ratingColumns = ["Target efficiency %", "Size (µm)", "Bracket: lower size", "lower eff%", "upper size", "upper eff%"];
  const ratingFormula = "Size = lowerSize + (targetEfficiency − lowerEff) × (upperSize − lowerSize) / (upperEff − lowerEff) — " +
    "plain-linear reverse interpolation (size as a linear function of efficiency) between the two bracketing measured " +
    "points shown in the table below.";
  steps.push({
    id: "filter-rating-initial",
    title: "Filter rating — Initial (E6) curve",
    clause: "Reverse-interpolated against the Initial (E6) efficiency curve above, bounded 0-100%",
    formula: ratingFormula,
    table: { columns: ratingColumns, rows: ratingRows(analysis.initialEfficiency) },
    note: "Blank bracket columns mean the target fell outside the measured efficiency range (result shown as \"<x\"/\">x\") rather than being interpolated."
  });
  steps.push({
    id: "filter-rating-overall",
    title: "Filter rating — Overall curve",
    clause: "Reverse-interpolated against the Overall efficiency curve above, bounded 0-100%",
    formula: ratingFormula,
    table: { columns: ratingColumns, rows: ratingRows(analysis.overallEfficiency) },
    note: "Blank bracket columns mean the target fell outside the measured efficiency range (result shown as \"<x\"/\">x\") rather than being interpolated."
  });

  steps.push({
    id: "gravimetric",
    title: "Gravimetric mass balance",
    clause: "10.2.2.7 / 10.2.5 — injection flow/gravimetric averages, mass injected/added",
    formula: "Ga = (Gia × Qia[L/min]) / Test flow.  Injected mass Mi = (Qia[L/min] × Gia × termination min) / 1000.  Dust added W = (Gia × injection volume) / 1000.",
    table: {
      // Raw numbers, not pre-concatenated "value + unit" strings — units live in
      // the row label instead, so auditView.js's fmt() still rounds every cell
      // consistently (a pre-concatenated string bypasses that rounding entirely).
      columns: ["", "Value"],
      rows: [
        ["Qia, measured (mL/min)", analysis.qia],
        ["Gia, header (mg/L)", analysis.gia],
        ["Ga, computed (mg/L)", analysis.ga],
        ["Qu, upstream sampling flow (L/min)", analysis.qu],
        ["Qd, downstream sampling flow (L/min)", analysis.qd],
        ["Injected mass Mi (g)", analysis.injectedMass],
        ["Dust added W (g)", analysis.dustAdded]
      ]
    },
    note: "Non-Retained Mass (computed later, once Gf/Vf are hand-entered) uses Qd, not Qu, in its own formula — a probable real unit inconsistency in the source standard text, implemented literally, not corrected. See iso19438Analysis.js's own comment."
  });

  return steps;
}

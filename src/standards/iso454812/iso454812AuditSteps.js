/* =====================================================================================
   iso454812AuditSteps.js
   =====================================================================================
   Report CONTENT for the Audit Trail view (src/audit/auditView.js) — narrates ISO
   4548-12:2017's OWN derivation from iso454812Analysis.js's already-computed result
   object. Never shared with another standard's audit steps, per CLAUDE.md.

   Unlike iso16889, this standard's Element/Housing ΔP subtraction happens IN
   iso454812Mapper.js, not in iso454812Analysis.js itself (confirmed by reading
   both files — see iso454812Analysis.selfcheck.js's own header note on the same
   gap) — so this file reads `store` for dpHousingClean/dpElementClean/dpFinalNet,
   the only three values in this trail that don't come from `analysis` directly.

   v2: every interpolated value now shows the actual two bracketing measured points it
   was computed from (terminationBracket / each milestone's own bracket, both already
   on the analysis object; sizeGivenEfficiencyDetail's bracket, called directly here)
   — not just the final answer — and most per-size tables show a labeled
   representative SAMPLE (via ../../audit/auditSampling.js) rather than a full dump.
   Full data remains in auditView.js's raw JSON dump regardless.

   v3 (2026-08-11): same treatment ISO 16889's audit trail got — a dedicated step
   explaining how the bucket WINDOWS themselves are chosen (fixed clock grid, not
   percentile-based like ISO 16889's clumps, so no separate "exact vs rounded" time
   split — see that step's own comment for the mechanism), and the bucket efficiency
   table itself reversed from a static 3x3 sample to all buckets shown at once with an
   interactive size picker (../../audit/auditWidgets.js), keeping the hover-tooltip raw
   count detail working for whichever size is currently selected.
   ===================================================================================== */
import { sampleTable } from "../../audit/auditSampling.js";
import { buildSizePickerTable } from "../../audit/auditWidgets.js";

/** @param {import("./iso454812Analysis.js").Iso454812Analysis|null} analysis @param {DataFile|null} df
 *  @param {import("../../report/reportValueStore.js").ReportValueStore} [store] needed for
 *  dpHousingClean/dpElementClean/dpFinalNet — computed in iso454812Mapper.js, not here
 *  @returns {Array<Object>} */
export function buildAuditSteps(analysis, df, store) {
  if (!analysis) return [];
  const steps = [];
  const g = (id) => (store ? store.get(id) : null);
  // Buckets are computed in SECONDS on purpose (a count cycle isn't guaranteed to be
  // exactly 1 minute, and the standard's disregard/window cutoffs are minutes-of-test,
  // not count-cycles) — the calculation stays in seconds. Only the AUDIT DISPLAY of a
  // bucket's window converts to H:MM:SS, matching how the report itself shows
  // termination/milestone times (iso454812Mapper.js's own formatElapsed call) — same
  // AnalysisMath.formatElapsed the report uses, reached as a classic-script global
  // (analysisMath.js isn't an ES module) same as this file's own window.Iso454812Analysis reference below.
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
    clause: "General — computed in iso454812Mapper.js, not the analysis engine",
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
    clause: "5/10/15/20/40/80/100% of the clean-to-terminal ΔP rise",
    formula: "targetΔP = Clean assembly ΔP + (percent/100) × (Termination ΔP − Clean assembly ΔP); the crossing time is found the same way termination itself is, and every row's own bracket (the two measured samples it was interpolated between) is shown alongside it.",
    table: {
      columns: ["% Net ΔP", "Test time (min)", "Assembly ΔP (kPa)", "Bracket t1", "ΔP1", "Bracket t2", "ΔP2"],
      rows: analysis.netDPMilestones.map((m) => [m.percent, m.testTimeMin, m.assyDP,
        m.bracket ? formatElapsed(m.bracket.before.time) : null, m.bracket ? m.bracket.before.value : null,
        m.bracket ? formatElapsed(m.bracket.after.time) : null, m.bracket ? m.bracket.after.value : null])
    },
    note: "A blank bracket means this milestone was never reached (see analysis.warnings)."
  });

  // ---- How the bucket WINDOWS themselves are chosen — deliberately its own step,
  // separate from the efficiency CALCULATION below (per the user, same split ISO
  // 16889's audit trail got). Fixed clock grid, unlike ISO 16889's percentile-based
  // clumps: bucketMinutes (5 or 10) is fixed for the whole test, and the grid is
  // anchored at TEST START (0, bucketMinutes, 2×bucketMinutes, ...), NOT at the
  // disregard cutoff — the first SKIP_MINUTES of counts are disregarded entirely,
  // which SHORTENS whichever bucket that cutoff falls inside rather than shifting
  // every later bucket's boundary forward. Each bucket's own window START is the
  // PREVIOUS bucket's last included time + 1 second (not the raw grid mark), so no
  // data row is ever double-counted across a boundary; each window's END stays
  // pinned to the fixed grid, clamped to the exact termination time for the last
  // bucket — see iso454812Analysis.js's own _computeBucketEfficiency comment for
  // the full rationale and its confirmation against a real file. Shown IN FULL (not
  // sampled) — the whole point is watching the rule hold across every bucket. ----
  steps.push({
    id: "bucket-time-selection",
    title: "Bucket window selection",
    clause: "Fixed-duration clock grid — " + (analysis.bucketMinutes || "?") + " min each (5 if termination ≤60 min, else 10), anchored at test start",
    formula: "windowEnd = min(next grid mark, termination time); windowStart = PREVIOUS bucket's windowEnd + 1 second " +
      "(bucket 1 starts right after the disregard period, not at the raw grid mark) — no shared boundary rows between " +
      "consecutive buckets. ΔP is read at windowEnd (Table B.2's instantaneous reading, not a window average).",
    table: {
      columns: ["Bucket #", "Window", "Test time (min)", "ΔP at window end (kPa)"],
      rows: analysis.buckets.map((b, i) => [i + 1, formatElapsed(b.startTime) + "–" + formatElapsed(b.endTime), b.testTimeMin, b.dpAtEnd])
    },
    note: "The count window below is what the efficiency table below actually sums counts over."
  });

  // Reversed from a static sample to ALL buckets + an interactive size picker, per
  // the user (2026-08-11) — same reasoning/mechanism as ISO 16889's β-per-clump
  // table (see that file's own comment for the full rationale).
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
    ["Size (µm)", "Overall %", "Max %", "Min %"],
    analysis.sizes.map((s, i) => [s, analysis.overallEfficiency[i], analysis.maxEfficiency[i], analysis.minEfficiency[i]]),
    "middle"
  );
  steps.push({
    id: "overall-efficiency",
    title: "Overall / Max / Min efficiency",
    clause: "Overall = same formula as a bucket, run against the WHOLE valid window (not an average of the per-bucket values); Max/Min = across all buckets",
    table: { columns: overallSample.columns, rows: overallSample.rows },
    note: overallSample.note
  });

  const Iso454812Analysis = (typeof window !== "undefined") ? window.Iso454812Analysis : null;
  const ratingRows = Object.keys(analysis.micrometerRating || {}).map((eff) => {
    const detail = Iso454812Analysis
      ? Iso454812Analysis.sizeGivenEfficiencyDetail(Number(eff), analysis.sizes, analysis.overallEfficiency)
      : { result: analysis.micrometerRating[eff], bracket: null };
    return [eff, detail.result,
      detail.bracket ? detail.bracket.lowerSize : null, detail.bracket ? detail.bracket.lowerEff : null,
      detail.bracket ? detail.bracket.upperSize : null, detail.bracket ? detail.bracket.upperEff : null];
  });
  steps.push({
    id: "micrometer-rating",
    title: "Micrometer rating",
    clause: "Reverse-interpolated against the Overall efficiency curve above, bounded 0-100%",
    formula: "Size = lowerSize + (targetEfficiency − lowerEff) × (upperSize − lowerSize) / (upperEff − lowerEff) — " +
      "plain-linear reverse interpolation (size as a linear function of efficiency, not log-linear like ISO 16889's " +
      "β-based Size_At_Beta_x) between the two bracketing measured points shown in the table below.",
    table: {
      columns: ["Target efficiency %", "Size (µm)", "Bracket: lower size", "lower eff%", "upper size", "upper eff%"],
      rows: ratingRows
    },
    note: "Blank bracket columns mean the target fell outside the measured efficiency range (result shown as \"<x\"/\">x\") rather than being interpolated."
  });

  steps.push({
    id: "gravimetric",
    title: "Gravimetric mass balance",
    clause: "Injection flow/gravimetric averages, mass injected/added",
    formula: "Ga = (Gia × Qia[L/min]) / Test flow.  Injected mass M1 = (Qia[L/min] × Gia × termination min) / 1000.  Dust added W = (Gia × injection volume) / 1000.",
    table: {
      // Raw numbers, not pre-concatenated "value + unit" strings — units live in
      // the row label instead, so auditView.js's fmt() still rounds every cell
      // consistently (a pre-concatenated string bypasses that rounding entirely).
      columns: ["", "Value"],
      rows: [
        ["Qia, measured (mL/min)", analysis.qia],
        ["Gia, header (mg/L)", analysis.gia],
        ["Ga, computed (mg/L)", analysis.ga],
        ["Injected mass M1 (g)", analysis.injectedMass],
        ["Dust added W (g)", analysis.dustAdded]
      ]
    },
    note: "The exact site of a past 1000x unit-conversion bug on injectedMass — see iso454812Analysis.selfcheck.js."
  });

  return steps;
}

/* =====================================================================================
   iso3968ControlTargets.js
   =====================================================================================
   ISO 3968:2017's Allowable Test Condition Variation table — Temperature and
   Conductivity ONLY (confirmed by the user, 2026-08-03). Own copy, not shared with
   the other three standards' tables, per CLAUDE.md.

   Test Flow (±5%) is DELIBERATELY NOT here, even though the user gave it alongside
   Temperature/Conductivity — it needs a PER-POINT check (each point's actual flow
   against its own commanded target), not a single whole-test channel average vs. one
   fixed target, which is the shape src/core/controlTargetCheck.js's shared engine
   assumes (and which fits Temperature/Conductivity fine here). Confirmed with the
   user: flow is the swept variable across a P-Q test (6 discrete targets, or a
   continuous sweep), so there's no single "the test flow rate" to average and check
   the way a constant-flow multipass test has. See iso3968Analysis.js's own
   `checkFlowRateCompliance` for that per-point check instead.

   Injection and Dilution systems are NOT used during P-Q testing (confirmed by the
   user) — no rules for those here at all, unlike the other three standards' tables.
   ===================================================================================== */

export const ISO3968_CONTROL_TARGETS = [
  {
    parameter: "Test Temperature",
    channelTag: "TS_Temp",   // same tag already confirmed by all three other standards
    targetSource: { section: "Test System Configuration", key: "Temperature" },   // CONFIRMED against a real P-Q file
    toleranceType: "absolute", tolerance: 1
  },
  {
    // "1,000 to 10,000 pS/m" (confirmed by the user) is a RANGE, not a target ±
    // tolerance — re-expressed here as an absolute tolerance around the range's own
    // midpoint so it reuses the existing engine exactly, not a new tolerance shape:
    // 5500 ± 4500 = [1000, 10000]. Neither 5500 nor 4500 is independently meaningful;
    // don't "simplify" them without preserving the exact [1000, 10000] bounds.
    //
    // headerFallback-only (no channelTag), same SHAPE the other three standards use
    // for conductivity, but for a DIFFERENT reason: their reasoning is that a live
    // channel drifts upward over a multipass test as dust is injected. This standard
    // has no injection at all (confirmed by the user), so that specific drift
    // concern doesn't apply — the real reason here is that FLOW, not conductivity,
    // is the swept variable across a P-Q test, so (unlike a constant-flow multipass
    // test) there's no single steady-state window to average a live channel over in
    // the first place. Revisit if a real P-Q file's TS_Conductivity channel (present
    // in newer-format files, confirmed absent in older ones) turns out to hold
    // steady enough to check directly.
    parameter: "Conductivity",
    headerFallback: { section: "General Test Information", key: "TestConductivity" },   // CONFIRMED against real P-Q files (both eras)
    target: 5500,
    toleranceType: "absolute", tolerance: 4500
  }
];

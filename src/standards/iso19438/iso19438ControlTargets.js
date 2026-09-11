/* =====================================================================================
   iso19438ControlTargets.js
   =====================================================================================
   ISO 19438:2023's Allowable Test Condition Variation table, as data only — the
   checking logic is the standard-agnostic src/core/controlTargetCheck.js. Own copy,
   not shared with iso454812's table, per CLAUDE.md — an edition update to one standard
   must never risk silently changing another's tolerances, even where the tolerance
   VALUES happen to match today.

   RESOLVED 2026-08-18 (WISHLIST.md's "Decided 2026-07-30" #1): every channelTag/
   targetSource/headerFallback below has been checked against real .DAT files
   (SpinOnMP.DAT, TwinFSRig-ROTest9-MP.DAT — the same single-sensor rig ISO 4548-12's
   own table was confirmed against) and CONFIRMED present, same tags ISO 4548-12
   uses. The 5 tolerance VALUES came directly from the user and were never in
   question. The Temperature compliance shape (Test System + Injection System, no
   Dilution System) and the count-cycle-exclusion figure elsewhere in this standard
   both matched ISO 4548-12's own — per the user, that's real carryover between the
   two standards' independently-produced build-out documents (each derived from
   that standard's own published text separately), not one uncritically copied from
   the other.

   reportFieldId (see controlTargetCheck.js's typedef): only set where this rule's
   ACTUAL value has one clear, single displayed report field to mark on failure —
   upstream/downstream Sensor Flow Rate and Temperature (Injection System) are
   deliberately left without one, since the report either combines those into one
   field or doesn't display them separately at all; those rules still show up in
   the full warnings dialog, just without an inline page marker.
   ===================================================================================== */

export const ISO19438_CONTROL_TARGETS = [
  {
    parameter: "Test Flow Rate",
    channelTag: "TS_Rate",   // CONFIRMED — same tag as ISO 4548-12
    // Header key/section CONFIRMED by the user (2026-07-31) — see iso19438Analysis.js's
    // HEADER_TEST_FLOWRATE note for the one caveat (older Life and Efficiency stands
    // report this in L/hour, not L/min; harmless HERE since a percent-tolerance check
    // is scale-invariant as long as the channel and target share the same native unit,
    // unlike the Ga formula in Analysis.js which needs to know which unit it actually is).
    targetSource: { section: "Test System Configuration", key: "Rate" },
    toleranceType: "percent", tolerance: 5,
    reportFieldId: "testFlowrateQ"
  },
  {
    parameter: "Injection Flow Rate",
    channelTag: "INJ_Rate",   // CONFIRMED
    targetSource: { section: "Injection System Configuration", key: "Rate" },   // CONFIRMED
    toleranceType: "percent", tolerance: 5,
    // Points at the ACTUAL measured average (injectionFlowrateQia), not the setpoint
    // field (injectionFlowrateSetpoint) — this rule is checking the real channel
    // reading against its target, so the marker belongs on the reading, not the goal.
    reportFieldId: "injectionFlowrateQia"
  },
  {
    // Named "Sensor Flow Rate", NOT "Sampling Flow Rate" (this row's name until
    // corrected 2026-07-31) — UpSensor/DnSensor measure flow through the particle
    // counter's own sensor, matching ISO 4548-12's confirmed "Sensor Flow Rate" pair
    // (checked against SensorFlow, same shape here), and 19438's Operating
    // Conditions table's own "Sensor Flow Rate:" field (Row 12). This is a distinct,
    // much smaller number than the Sample Flow / Sampling time fields nearby, which
    // is a declared header setpoint (SampleFlow key) with no matching live channel
    // at all — see iso19438Analysis.js's HEADER_SAMPLE_FLOW note. Don't reuse this
    // rule's channelTag for anything needing the sample (not sensor) flow rate.
    parameter: "Sensor Flow Rate (upstream)",
    channelTag: "UpSensor",   // CONFIRMED — present in real single-sensor-rig files (ExRaDs dual-sensor rigs use aQLBU/aQLSU/aQLBD/aQLSD instead, not handled by this rule, same known scope limit ISO 4548-12's own table has)
    targetSource: { section: "Dilution System Configuration", key: "SensorFlow", index: 0 },   // header key CONFIRMED by the user (2026-07-31), mL/min
    toleranceType: "percent", tolerance: 3
  },
  {
    parameter: "Sensor Flow Rate (downstream)",
    channelTag: "DnSensor",   // CONFIRMED — see the upstream rule's own note on scope
    targetSource: { section: "Dilution System Configuration", key: "SensorFlow", index: 1 },   // header key CONFIRMED by the user (2026-07-31), mL/min
    toleranceType: "percent", tolerance: 3
  },
  {
    // 19438's Operating Conditions table has ONE Temperature field (Row 1, Test
    // Fluid section) plus Test System's own implicit temperature — CONFIRMED
    // (2026-08-18) to be the same 2-reading compliance shape (Test System +
    // Injection System) 4548-12 uses, minus 4548-12's third Dilution System
    // reading: per the user, 19438's own text was worked independently of
    // 4548-12's and lands on this same shape, it isn't a copy.
    parameter: "Temperature (Test System)",
    channelTag: "TS_Temp",   // CONFIRMED
    targetSource: { section: "Test System Configuration", key: "Temperature" },   // CONFIRMED
    toleranceType: "absolute", tolerance: 2,
    reportFieldId: "temperature"
  },
  {
    parameter: "Temperature (Injection System)",
    channelTag: "INJ_Temp",   // CONFIRMED
    targetSource: { section: "Injection System Configuration", key: "Temperature" },   // CONFIRMED
    toleranceType: "absolute", tolerance: 2
  },
  {
    // Fuel media (unlike 4548-12's lube oil) makes conductivity load-bearing rather
    // than incidental — the user gave ONE conductivity target (1500 ±500 pS/m), not
    // per-system readings. Modeled as a single Test System row rather than 4548-12's
    // Test+Injection pair, since the outline's Operating Conditions table only shows
    // "Initial Conductivity"/"Final Conductivity" as TEST fluid readings, no
    // separate injection-system conductivity field.
    //
    // channelTag DELIBERATELY omitted (same fix applied to iso454812ControlTargets.js
    // after a confirmed false-failure report there) — a live TS_Conductivity channel
    // legitimately drifts upward over a multipass test as dust is injected, so
    // averaging it across the whole test and comparing that average to a fixed
    // target produces false failures even when the test-fluid's INITIAL conductivity
    // was well within range. The report's "Initial Conductivity" field
    // (reportFieldId below) reads TestConductivity from the header directly, never a
    // live channel — this rule reads the same header value, so the checked quantity
    // and the displayed quantity always agree.
    parameter: "Conductivity (Test System)",
    headerFallback: { section: "General Test Information", key: "TestConductivity" },   // CONFIRMED
    target: 1500,
    toleranceType: "absolute", tolerance: 500,
    reportFieldId: "initialConductivity"
  }
];

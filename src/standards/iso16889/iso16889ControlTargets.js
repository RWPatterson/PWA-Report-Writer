/* =====================================================================================
   iso16889ControlTargets.js
   =====================================================================================
   ISO 16889:2022's "Measurement Variation allowance" table, as data only — the
   checking logic is the standard-agnostic src/core/controlTargetCheck.js. Own copy,
   not shared with any other standard's table, per CLAUDE.md.

   Only the targets checkControlTargets' generic channel/header engine can actually
   evaluate live here — Injection Flow Rate, Injection Gravimetric Level, and Base
   Upstream Gravimetric Level (the standard's other three targets, all with "accept
   the test only if" language in the standard text) are NOT rows in this file. Two of
   them need hand-entered gravimetric lab results the generic engine has no way to
   read, and the third is a computed rate rather than a raw channel/header value —
   all three are checked instead by iso16889Analysis.js's own
   checkGravimetricAcceptance/_computeInjectionFlowRate, surfacing as plain analysis
   warnings (see app.js's gravimetricWarnings wiring). Confirmed with the user: all
   informational/warning-only either way, same severity as the rows below — this
   split is about WHERE a check can run, not how seriously a failure is treated.

   CONFIRMED-real tags, not guessed: TS_Rate/TS_Temp/TestConductivity and the LB/LS
   Sensor Flow Rate pairs are all proven either by the legacy iso16889 engine's own
   working use, or by iso454812ControlTargets.js's "confirmed against a real file"
   tags — reused here on the strength of the shared-.DAT-format fact (see CLAUDE.md's
   ".DAT file handling"), not a coincidental guess. Only Test System Volume has no
   existing confirmed precedent anywhere in the codebase — flagged `// ASSUMED`.

   SENSOR FLOW RATE HAS TWO REAL NAMING SCHEMES, both listed unconditionally below —
   an ExRaDs extended-range dual-sensor rig uses LB/LS-prefixed names (aQLBU/aQLBD/
   aQLSU/aQLSD, header LBSensorFlow/LSSensorFlow); a single-sensor rig uses plain
   UpSensor/DnSensor against an unprefixed SensorFlow header, exactly
   iso454812ControlTargets.js's own confirmed shape (same control program) — its own
   comment originally flagged this as unconfirmed for ISO 16889 specifically ("don't
   port this table's shape back... without checking an ISO 16889 file directly").
   CONFIRMED 2026-08-11 against a real single-sensor file (TwinFSRig-ROTest9-MP.DAT,
   "ROTest9") after a customer report that the LB/LS-prefixed rows alone produced a
   false "target value not found in header" on that file. Same "list every real
   variant, let checkOne's channel-not-present handling sort out which applies per
   file" pattern already used for the LB-vs-LS split itself — a real file only ever
   has one of the two naming schemes present.

   reportFieldId (see controlTargetCheck.js's typedef): only set where this rule's
   ACTUAL value has one clear, single displayed report field to mark on failure. The
   six Sensor Flow Rate rows and Test System Volume are deliberately left without
   one — the report doesn't display a single field matching each; those rules still
   show up in the full warnings dialog, just without an inline page marker.

   Conductivity is header-only from the start (no channelTag) — built the way ISO
   4548-12's and ISO 19438's own Conductivity rules were JUST FIXED to work, after a
   live-channel-average version produced false failures there (a fluid's conductivity
   legitimately drifts as dust is injected, so a whole-test average compared against
   a fixed setpoint checks the wrong thing). Never given the same bug a chance to
   exist here in the first place.
   ===================================================================================== */

export const ISO16889_CONTROL_TARGETS = [
  {
    parameter: "Test Flow Rate",
    channelTag: "TS_Rate",
    targetSource: { section: "Test System Configuration", key: "Rate" },
    toleranceType: "percent", tolerance: 5,
    reportFieldId: "testFlowrateQ"
  },
  {
    // Listing both LB and LS sensor-flow pairs unconditionally, not just whichever
    // sensor happens to be selected in the UI right now — a real file only ever has
    // ONE sensor's channels present, so checkOne's existing "channel not present ->
    // not applicable" handling naturally shows only the relevant pair per file. No
    // new engine logic needed for this; same pattern already relied on elsewhere.
    parameter: "Sensor Flow Rate — LB (upstream)",
    channelTag: "aQLBU",
    targetSource: { section: "Dilution System Configuration", key: "LBSensorFlow", index: 0 },
    toleranceType: "percent", tolerance: 3
  },
  {
    parameter: "Sensor Flow Rate — LB (downstream)",
    channelTag: "aQLBD",
    targetSource: { section: "Dilution System Configuration", key: "LBSensorFlow", index: 1 },
    toleranceType: "percent", tolerance: 3
  },
  {
    parameter: "Sensor Flow Rate — LS (upstream)",
    channelTag: "aQLSU",
    targetSource: { section: "Dilution System Configuration", key: "LSSensorFlow", index: 0 },
    toleranceType: "percent", tolerance: 3
  },
  {
    parameter: "Sensor Flow Rate — LS (downstream)",
    channelTag: "aQLSD",
    targetSource: { section: "Dilution System Configuration", key: "LSSensorFlow", index: 1 },
    toleranceType: "percent", tolerance: 3
  },
  {
    // A single-sensor rig has no LB/LS split at all — its one sensor's flow channels
    // are plain UpSensor/DnSensor against an unprefixed SensorFlow header setpoint,
    // exactly iso454812ControlTargets.js's already-confirmed shape (same control
    // program). Listed unconditionally alongside the LB/LS-prefixed rows above, same
    // "let checkOne's channel-not-present handling sort it out per file" pattern —
    // a real file only ever has ONE of these two naming schemes present. CONFIRMED
    // against a real ISO 16889 file (2026-08-11, TwinFSRig-ROTest9-MP.DAT): its
    // Dilution System Configuration has "SensorFlow,25,25" (not LBSensorFlow), and its
    // Data Format line lists UpSensor/DnSensor (not aQLBU/aQLBD) — the LB/LS-prefixed
    // rows alone left this file's Sensor Flow Rate checks reporting a false "target
    // value not found in header".
    parameter: "Sensor Flow Rate (upstream)",
    channelTag: "UpSensor",
    targetSource: { section: "Dilution System Configuration", key: "SensorFlow", index: 0 },
    toleranceType: "percent", tolerance: 3
  },
  {
    parameter: "Sensor Flow Rate (downstream)",
    channelTag: "DnSensor",
    targetSource: { section: "Dilution System Configuration", key: "SensorFlow", index: 1 },
    toleranceType: "percent", tolerance: 3
  },
  {
    // ONE row only — the pasted spec's own Measurement Variation table lists a
    // single "Temperature" target, and Page 1's own layout only displays one
    // Temperature field (under Test Fluid), unlike 4548-12's separate Test/
    // Injection/Dilution-system rows. Not assumed to need the same 3-way split
    // without the spec actually asking for it.
    parameter: "Temperature",
    channelTag: "TS_Temp",
    targetSource: { section: "Test System Configuration", key: "Temperature" },
    toleranceType: "absolute", tolerance: 2,
    reportFieldId: "temperature"
  },
  {
    parameter: "Conductivity",
    headerFallback: { section: "General Test Information", key: "TestConductivity" },
    target: 1500,
    toleranceType: "absolute", tolerance: 500,
    reportFieldId: "conductivity"
  },
  {
    // channelTag CONFIRMED with the user (2026-07-30): TS_Vol is real, logged on
    // machines with level-height measurement on their test sink — a relatively new
    // feature, so it won't be present on every file (controlTargetCheck's existing
    // "channel not present -> not applicable" handling covers that, same pattern the
    // LB/LS Sensor Flow Rate rows above already rely on). Its purpose is confirming
    // test system volume doesn't deviate during the test. targetSource is still
    // ASSUMED, though — no confirmed precedent for a "Volume" key under Test System
    // Configuration specifically; guessed by analogy to TS_Rate/TS_Temp's own
    // "TS_<Quantity>" pairing with a same-named header setpoint.
    //
    // DELIBERATELY no headerFallback here (per the user, 2026-07-30), unlike
    // Conductivity below: a "did the volume deviate during the test" check needs
    // something to compare ACROSS the test — a live channel's per-record readings.
    // A static header value is one number; comparing it to itself can't show
    // deviation. A headerFallback would only be meaningful paired with a real
    // hand-entered FINAL volume reading, which this report writer doesn't currently
    // prompt for. So on a file without TS_Vol, this rule is correctly skipped
    // (not-applicable) rather than given a fallback that would silently check
    // nothing. Not important enough to build that entry field — noted so nobody
    // "fixes" this by adding a meaningless headerFallback later.
    parameter: "Test System Volume",
    channelTag: "TS_Vol",
    targetSource: { section: "Test System Configuration", key: "Volume" },
    toleranceType: "percent", tolerance: 5
  }
];

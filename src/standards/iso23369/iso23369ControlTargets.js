/* =====================================================================================
   iso23369ControlTargets.js
   =====================================================================================
   ISO 23369:2022's Table 2 ("Test Condition Variation"), as data only — the checking
   logic is the standard-agnostic src/core/controlTargetCheck.js. Own copy, not shared
   with any other standard's table, per CLAUDE.md.

   Table 2's full list: Conductivity ±500 pS/m (fixed 1500 target), BUGL ±10%,
   Injection flow rate ±5%, Test flow rate ±5%, APC sensor/dilution flow rates ±3%,
   Temperature ±2°C, Filter test system volume ±5%. BUGL, Injection flow rate, AND
   Test flow rate are NOT rows here — BUGL/Injection flow rate for the same reason
   ISO 16889's own table excludes them (need hand-entered gravimetric results or are
   themselves derived/live-computed values the generic channelTag/headerFallback
   engine can't express as a simple channel-vs-header-setpoint check). Checked
   instead by iso23369Analysis.js's own checkGravimetricAcceptance/
   _computeInjectionFlowRate, surfacing as analysis warnings (see app.js's
   gravimetricWarnings wiring).

   Test Flow Rate is excluded for a DIFFERENT, standard-specific reason, confirmed by
   a real false-positive (2026-08-20): TS_Rate spends the whole test alternating
   between q_min and q_max, so a flat whole-test average compared against ONE target
   is checking the wrong quantity — the average necessarily lands somewhere BETWEEN
   q_min and q_max, nowhere near either one, regardless of whether the rig is
   actually tracking its setpoints correctly. Table 2's real intent needs q_min and
   q_max checked SEPARATELY, each against its own high/low-flow-phase average from
   the companion file — the generic engine has no phase concept, so this is now
   iso23369Analysis.js's own _checkTestFlowRateTolerance instead, same "computed
   value, not a raw channel/header read" reasoning as BUGL/Injection flow rate.

   Sensor Flow Rate has the same two real naming schemes ISO 16889's own table
   documents (LB/LS-prefixed on an ExRaDs dual-sensor rig; plain UpSensor/DnSensor on
   a single-sensor rig) — reused here on the strength of the confirmed-shared .DAT
   format, not a fresh guess (see CLAUDE.md's ".DAT file handling").

   Test System Volume: channelTag "TS_Vol" is CONFIRMED real (per ISO 16889's own
   table — logged on machines with sink level-height measurement); targetSource
   (Test System Configuration/Volume) is // ASSUMED, no confirmed precedent for that
   specific key, guessed by analogy to TS_Rate/TS_Temp's own "TS_<Quantity>"/same-
   named-setpoint pairing. Deliberately no headerFallback — a static header value
   can't show deviation DURING the test, same reasoning ISO 16889's own row states.
   ===================================================================================== */

export const ISO23369_CONTROL_TARGETS = [
  {
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
    parameter: "Filter Test System Volume",
    channelTag: "TS_Vol",
    targetSource: { section: "Test System Configuration", key: "Volume" },
    toleranceType: "percent", tolerance: 5
  }
];

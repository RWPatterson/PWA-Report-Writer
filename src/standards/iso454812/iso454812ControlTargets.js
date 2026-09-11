/* =====================================================================================
   iso454812ControlTargets.js
   =====================================================================================
   ISO 4548-12:2017's Allowable Test Condition Variation table, as data only — the
   checking logic is the standard-agnostic src/controlTargetCheck.js. Kept as this
   standard's own copy (not shared with iso16889's draft table in WISHLIST.md) even
   though the channel tags happen to match — same control program logs both, but each
   standard's rule table stays independently editable, since an edition update to one
   standard should never risk silently changing another's tolerances.

   All rules confirmed against a real ISO 4548-12 .DAT file (2024-083-ROTest9-MP). Note
   this file's Dilution System Configuration is single-stage (one "SensorFlow,25,25"
   row, one "UpSensor"/"DnSensor" channel pair) — no LB/LS split the way WISHLIST.md's
   ISO 16889 draft has (aQLBU/aQLBD/aQLSU/aQLSD, LBSensorFlow/LSSensorFlow). Channel/
   header naming isn't as universal across standards as originally assumed; don't port
   this table's shape back to ISO 16889 without checking an ISO 16889 file directly.

   reportFieldId (see controlTargetCheck.js's typedef): only set where this rule's
   ACTUAL value has one clear, single displayed report field to mark on failure —
   upstream/downstream Sensor Flow Rate and the Injection/Dilution System
   temperature/conductivity rules are deliberately left without one, since the
   report either combines those into one field or doesn't display them separately
   at all; those rules still show up in the full warnings dialog, just without an
   inline page marker.
   ===================================================================================== */

export const ISO454812_CONTROL_TARGETS = [
  {
    parameter: "Test Flow Rate",
    channelTag: "TS_Rate",
    targetSource: { section: "Test System Configuration", key: "Rate" },
    toleranceType: "percent", tolerance: 5,
    reportFieldId: "testFlowrateQ"
  },
  {
    parameter: "Injection Flow Rate",
    channelTag: "INJ_Rate",
    targetSource: { section: "Injection System Configuration", key: "Rate" },
    toleranceType: "percent", tolerance: 5,
    // Points at the ACTUAL measured average (injectionFlowrateQia), not the setpoint
    // field (injectionFlowrateSetpoint) — this rule is checking the real channel
    // reading against its target, so the marker belongs on the reading, not the goal.
    reportFieldId: "injectionFlowrateQia"
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
    parameter: "Temperature (Test System)",
    channelTag: "TS_Temp",
    targetSource: { section: "Test System Configuration", key: "Temperature" },
    toleranceType: "absolute", tolerance: 2,
    reportFieldId: "temperature"
  },
  {
    parameter: "Temperature (Injection System)",
    channelTag: "INJ_Temp",
    targetSource: { section: "Injection System Configuration", key: "Temperature" },
    toleranceType: "absolute", tolerance: 2
  },
  {
    parameter: "Temperature (Dilution System)",
    channelTag: "DS_Temp",
    targetSource: { section: "Dilution System Configuration", key: "Temperature" },
    toleranceType: "absolute", tolerance: 2
  },
  {
    // channelTag DELIBERATELY omitted — confirmed bug fix. TS_Conductivity is a LIVE
    // channel that legitimately drifts upward over a multipass test as dust is
    // injected (that's the whole point of measuring it), so averaging it across the
    // full test and comparing that average to a fixed 1500±500 target produced false
    // failures on files where the test-fluid's INITIAL conductivity was well within
    // range (e.g. actual 1540, flagged as out-of-tolerance because the channel's
    // whole-test average had drifted past 2000). The report's own "Initial
    // Conductivity" field (reportFieldId below) reads TestConductivity from the
    // header directly, never the live channel — this rule now reads the exact same
    // header value, so the checked quantity and the displayed quantity always agree.
    parameter: "Conductivity (Test System)",
    headerFallback: { section: "General Test Information", key: "TestConductivity" },
    target: 1500,
    toleranceType: "absolute", tolerance: 500,
    reportFieldId: "initialConductivity"
  },
  {
    // Same fix as above, same reasoning — INJ_Conductivity would drift for the same
    // reason even though this rule has no reportFieldId to visibly disagree with.
    parameter: "Conductivity (Injection System)",
    headerFallback: { section: "General Test Information", key: "InjConductivity" },
    target: 1500,
    toleranceType: "absolute", tolerance: 500
  }
];

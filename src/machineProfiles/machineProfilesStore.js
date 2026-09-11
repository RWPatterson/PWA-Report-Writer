/* =====================================================================================
   machineProfilesStore.js
   =====================================================================================
   Persists the USER-EDITABLE machine profile directory (Machine Profiles tab) — a
   flat Record<serialNumber, ProfileRecord> in one localStorage blob, same load/save-
   to-one-key shape customDefaults.js already uses. Distinct from core/machineProfiles.js
   (MACHINE_PROFILES): that file is a small, hardcoded, developer-maintained table of
   rare legacy-fleet channel-unit quirks; this one is the customer-facing directory of
   rig facts (counter/sensor identity, cal method/date, test location) a report preparer
   maintains through the UI. Both are looked up the same way — by SerialNumber, via
   core/machineProfile.js's lookupProfile — but this module owns none of that apply
   logic itself, only persistence.

   No DOM, no knowledge of ReportValueStore/DataFile — load/save only.

   The standard rig (per the user, 2026-08-12) has an INDEPENDENT counter and sensor
   at each of Upstream/Downstream — not one shared identity — so Counter and Sensor
   each carry their own Upstream/Downstream Model+Serial pair. `shareCounter` covers
   an older rig that only ever had one counter serving both locations (the counter's
   own Upstream fields are then used for Downstream too — see iso16889Mapper.js's
   buildMachineProfileDefaults). The optional LS sensor set mirrors that same
   Upstream/Downstream shape as the primary Sensor.

   The optional LBE (extended Light Blocking) sensor is DIFFERENT — a single sensor,
   not a pair (corrected by the user, 2026-08-12): in series/dual-filter testing, the
   pre-filter's downstream sample point IS the final filter's upstream sample point
   (one shared midstream draw, per dataFile.js's own MidstreamFlag note) — an LBE rig
   has exactly one extra physical sensor reading that shared point, not one each side.

   The optional coincidence-limit fields (2026-08-19) let a rig override the
   conservative manufacturer default (Pamas LB 30,000 / Klotz LB 50,000, using the
   stricter Pamas figure by default; Pamas LS 12,000 — see helpers/
   coincidenceLimitCheck.js) once the REAL limit has been empirically found for that
   specific sensor, rather than relying on the conservative guess. Same per-physical-
   slot granularity as Model/Serial — LBE gets one value (it's a single sensor, no
   Upstream/Downstream split), everything else gets its own Upstream/Downstream pair.

   @typedef {Object} MachineProfileRecord
   @property {string} label                     friendly name shown in the profile list
   @property {boolean} [shareCounter]            true = one counter serves both locations (older rigs)
   @property {string} [counterUpstreamModel]
   @property {string} [counterUpstreamSerial]
   @property {string} [counterDownstreamModel]   unused when shareCounter is true
   @property {string} [counterDownstreamSerial]  unused when shareCounter is true
   @property {string} [sensorUpstreamModel]
   @property {string} [sensorUpstreamSerial]
   @property {string} [sensorDownstreamModel]
   @property {string} [sensorDownstreamSerial]
   @property {boolean} [hasLSSensor]
   @property {string} [lsSensorUpstreamModel]
   @property {string} [lsSensorUpstreamSerial]
   @property {string} [lsSensorDownstreamModel]
   @property {string} [lsSensorDownstreamSerial]
   @property {boolean} [hasLBESensor]            one-off extended Light Blocking sensor — a SINGLE sensor, see above
   @property {string} [lbeSensorModel]
   @property {string} [lbeSensorSerial]
   @property {number} [sensorUpstreamCoincidenceLimit]     counts/mL at the sensor — empirically-found override; blank uses the conservative manufacturer default (see coincidenceLimitCheck.js)
   @property {number} [sensorDownstreamCoincidenceLimit]
   @property {number} [lsSensorUpstreamCoincidenceLimit]
   @property {number} [lsSensorDownstreamCoincidenceLimit]
   @property {number} [lbeSensorCoincidenceLimit]
   @property {string} [testLocation]
   @property {string} [counterCalMethod]
   @property {string} [counterCalDate]
   ===================================================================================== */

const STORAGE_KEY = "webreportwriter-machine-profiles";

/** Always returns an object (empty on missing/corrupt/disabled storage).
 *  @returns {Record<string, MachineProfileRecord>} */
export function loadMachineProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch (err) {
    return {};
  }
}

/** Silently degrades to non-persistent if storage is unavailable, same as
 *  customDefaults.js. @param {Record<string, MachineProfileRecord>} profiles */
export function saveMachineProfiles(profiles) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    // Storage disabled (private browsing, quota, etc.) — degrade to non-persistent.
  }
}

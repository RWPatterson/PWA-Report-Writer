/* =====================================================================================
   machineProfile.js
   =====================================================================================
   Two distinct responsibilities, kept in one file because they're both "things a
   machine profile can do," but they act at different points in the pipeline and on
   different kinds of problem:

     applyChannelCorrections — fixes MEASURED DATA that a specific rig recorded in the
       wrong unit (e.g. an old machine logging TS_Rate in L/hr instead of the fleet-
       standard L/min). Runs immediately after parsing, before Iso16889Analysis, so
       everything downstream sees correct canonical SI and never has to know this
       correction happened.

     applyCustomDefaults — fills the ReportValueStore's Custom Default tier with
       report metadata a rig can supply for free (e.g. "this stand always has counter
       X mounted"). This is a report-writing convenience, not a data correction, and
       is explicitly the tier a User Entry can still override and a From Data value
       can still supersede if the file ever does carry it directly.

   This is NOT the same conversion logic as units.js. units.js converts correct
   canonical values for DISPLAY (SI vs US, every render). This file corrects incorrect
   raw values at the SOURCE (once, at parse time). Different problems on purpose.
   ===================================================================================== */

/** @type {Record<string,(v:number)=>number>} "storedAs->canonical" -> correction fn */
const CHANNEL_CORRECTION_FACTORS = {
  "L/hr->L/min": (v) => v / 60,
  "L/min->L/hr": (v) => v * 60
};

/** @param {Record<string,*>} profiles the MACHINE_PROFILES table
 *  @param {string} serialNumber the file's SerialNumber @returns {*|null} */
export function lookupProfile(profiles, serialNumber) {
  if (!serialNumber) return null;
  return profiles[serialNumber] || null;
}

/* applyChannelCorrections: mutates df.analog in place. Returns which channels were
   actually corrected (empty if the profile names a channel this particular file
   doesn't have — not an error, just nothing to do). */
/** @param {DataFile} df @param {*} profile @returns {string[]} corrected channel tags */
export function applyChannelCorrections(df, profile) {
  const corrected = [];
  if (!profile || !profile.channelCorrections) return corrected;

  for (const [tag, rule] of Object.entries(profile.channelCorrections)) {
    const index = df.analogTags.indexOf(tag);
    if (index < 0) continue;   // this file doesn't carry that channel — nothing to fix

    const factor = CHANNEL_CORRECTION_FACTORS[rule.storedAs + "->" + rule.canonical];
    if (!factor) continue;

    for (const row of df.analog) {
      const value = parseFloat(row[index + 1]);   // +1: field 0 is the timestamp
      if (isFinite(value)) row[index + 1] = String(factor(value));
    }
    corrected.push(tag);
  }
  return corrected;
}

/** Fill the store's Custom Default tier from a profile's customDefaults map.
 *  @param {import("../report/reportValueStore.js").ReportValueStore} store @param {*} profile */
export function applyCustomDefaults(store, profile) {
  if (!profile || !profile.customDefaults) return;
  for (const [id, value] of Object.entries(profile.customDefaults)) {
    store.setCustomDefault(id, value);
  }
}

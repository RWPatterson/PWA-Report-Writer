/* =====================================================================================
   machineProfiles.js
   =====================================================================================
   One row per machine that needs special handling — keyed by the .DAT header's
   SerialNumber field (which is really the project designation that follows a rig from
   order through build to field use, per Bonavista's numbering — see project notes).

   This is the fix for the old "unique report writer file per machine" problem: instead
   of cloning the whole tool per rig, a rig that needs something different gets one row
   here. This file is meant to be small and diffable — a PR adding one machine should
   be a five-line change, not a new file.

   Deliberately empty for now. Nothing has been populated because we haven't confirmed
   the exact old-fleet flow-rate quirk (which serial numbers, which channel, L/hr vs
   something else) against a real file from one of those machines yet. Populate an
   entry here once that's confirmed — see machineProfile.js for the two things a
   profile can specify.

   Example shape (not real data):
   "2019-011": {
     channelCorrections: {
       TS_Rate: { storedAs: "L/hr", canonical: "L/min" }
     },
     customDefaults: {
       counterUpstream: "APC HRLD-400 / SN 20481"
     }
   }
   ===================================================================================== */

export const MACHINE_PROFILES = {
  // populate as legacy-fleet quirks are confirmed
};

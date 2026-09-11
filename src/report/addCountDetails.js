/* =====================================================================================
   addCountDetails.js
   =====================================================================================
   Persists whether a standard's optional "Add Count Details" report page (Upstream/
   Downstream Counts vs. Time) should render — a page-presence PREFERENCE, not report
   content, so unlike display-size selection (genuinely different data per standard)
   this is a content-free boolean wrapper around customDefaults.js's existing per-
   standardId storage. Scoped per standard the same way every customDefaults.js
   consumer already is (see that file's own header note on why).
   ===================================================================================== */
import { loadCustomDefaults, saveCustomDefaults } from "./customDefaults.js";

const ADD_COUNT_DETAILS_KEY = "__addCountDetails__";

/** @param {string} standardId @returns {boolean} */
export function loadAddCountDetails(standardId) {
  return !!loadCustomDefaults(standardId)[ADD_COUNT_DETAILS_KEY];
}

/** @param {string} standardId @param {boolean} value */
export function saveAddCountDetails(standardId, value) {
  const persisted = loadCustomDefaults(standardId);
  persisted[ADD_COUNT_DETAILS_KEY] = !!value;
  saveCustomDefaults(standardId, persisted);
}

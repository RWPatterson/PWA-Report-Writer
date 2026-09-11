/* =====================================================================================
   customDefaults.js
   =====================================================================================
   Persists ReportValueStore's Custom Default tier across browser sessions, keyed by the
   same field ids used everywhere else (see reportValueStore.js's resolution rule). This
   is the customer-facing counterpart to machineProfile.js's per-rig customDefaults: a
   validation date or test lab set here applies to nearly every report this installation
   produces, not just one rig.

   Scoped per STANDARD (reportPages.js's standardId), one localStorage entry each — not
   global and not per-page. Two pages of the same standard (e.g. ISO 16889 page 1/2)
   intentionally share one ReportValueStore already, so they share defaults too. Two
   different standards (ISO 16889 vs ISO 4548-12) must NOT: a customer may use different
   media suppliers per standard, and a shared default would silently leak one standard's
   value onto another's report. Matches this project's existing practice of keeping each
   report standard in its own files rather than merging them.

   No DOM, no knowledge of DataFile/ReportValueStore — this module only knows how to
   read and write a flat {id: value} object to localStorage, one per standardId.
   ===================================================================================== */

const STORAGE_KEY_PREFIX = "webreportwriter-custom-defaults::";

/** Read the persisted custom defaults for one standard. Always returns an object
 *  (empty on missing/corrupt/disabled storage). @param {string} standardId
 *  @returns {Record<string,*>} */
export function loadCustomDefaults(standardId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + standardId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch (err) {
    return {};
  }
}

/** Persist the custom defaults for one standard. Silently degrades to non-persistent
 *  if storage is unavailable. @param {string} standardId @param {Record<string,*>} defaults */
export function saveCustomDefaults(standardId, defaults) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + standardId, JSON.stringify(defaults));
  } catch (err) {
    // Storage disabled (private browsing, quota, etc.) — degrade to non-persistent.
  }
}

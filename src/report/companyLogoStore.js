/* =====================================================================================
   companyLogoStore.js
   =====================================================================================
   Persists ONE company logo (the installation's own letterhead) as a data URL in
   localStorage — global, not per-standard and not per-machine-profile, since a report
   preparer's branding applies uniformly to every standard's report. Same load/save-to-
   one-key, try/catch-degrade shape customDefaults.js/machineProfilesStore.js already
   use. No DOM, no image validation, no knowledge of ReportValueStore/templates — this
   module only knows how to read and write the one stored record.

   @typedef {Object} CompanyLogoRecord
   @property {string} dataUrl     the logo image, as a data: URL (PNG or JPEG)
   @property {string} mimeType    "image/png" | "image/jpeg"
   @property {string} fileName    original filename, for the toolbar button's label
   @property {string} savedAt     ISO timestamp
   ===================================================================================== */

const STORAGE_KEY = "webreportwriter-company-logo";

/** @returns {CompanyLogoRecord|null} null if none stored, or storage is missing/corrupt/disabled */
export function loadCompanyLogo() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && parsed.dataUrl) ? parsed : null;
  } catch (err) {
    return null;
  }
}

/** Silently degrades to non-persistent if storage is unavailable, same as
 *  customDefaults.js. @param {CompanyLogoRecord} record */
export function saveCompanyLogo(record) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    // Storage disabled (private browsing, quota, etc.) — degrade to non-persistent.
  }
}

export function clearCompanyLogo() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // Storage disabled — nothing to clear.
  }
}

/* =====================================================================================
   compareFiles.js
   =====================================================================================
   A second, independent place to hold parsed files — separate from the single
   `currentDf` the Explorer/Report views use. Loading a file for comparison never
   touches, and is never touched by, whatever's open in the main Explorer. The report
   pipeline deliberately never sees this: no ISO 16889 standard is written for
   comparing multiple tests, so ReportValueStore/reportMapper/Iso16889Analysis stay
   single-file, exactly as they already are — nothing about them needs to change for
   this feature to exist.
   ===================================================================================== */
import { MASS_ADDED_CHANNEL_TAG, hasMassAddedData, channelHasData } from "../core/charts/chartData.js";

/**
 * @typedef {Object} CompareEntry
 * @property {string} id
 * @property {DataFile} df       the parsed file
 * @property {string} sourceName the picked filename
 * @property {string} label      "SerialNumber / FileName" display label
 */

export class CompareFileSet {
  //#region private state
  /** @type {CompareEntry[]} the loaded comparison files, in add order */
  #files = [];
  //#endregion

  //#region mutate
  /** @param {DataFile} df @param {string} sourceName @returns {CompareEntry} */
  add(df, sourceName) {
    const entry = {
      id: "cmp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      df,
      sourceName,
      label: describeFile(df, sourceName)
    };
    this.#files.push(entry);
    return entry;
  }

  /** @param {string} id */
  remove(id) {
    this.#files = this.#files.filter(f => f.id !== id);
  }

  clear() {
    this.#files = [];
  }
  //#endregion

  //#region read
  /** @returns {CompareEntry[]} the live list (read-only by convention) */
  list() {
    return this.#files;
  }
  //#endregion
}

/* describeFile: "SerialNumber / FileName" — the label convention settled on for this
   feature, since a serial number (a Bonavista project designation, see
   machineProfiles.js) can have several test files against it, and a comparison set
   often spans more than one machine. Falls back to the picked filename if the header
   has no FileName of its own. */
export function describeFile(df, sourceName) {
  const serial = df.getHeaderValue("Software Information", "SerialNumber") || "Unknown machine";
  const name = df.fileName || sourceName;
  return serial + " / " + name;
}

/* commonDimensions: union of analog channels and particle sizes across every loaded
   file, each with a count of how many files actually have it. Union rather than
   strict intersection on purpose — a channel present in 5 of 6 files is still worth
   surfacing (the person can decide whether to plot it and see the gap noted), not
   worth hiding just because one file lacks it.
   A tag DECLARED in a file's Data Format header but never actually carrying a value
   at any row doesn't count as "having" the channel here — per the user (found via a
   real file, ROTest9, whose Data Format lists 8 trailing tags no row has room for):
   an option with nothing to plot isn't worth offering. channelHasData does the real
   check; a merely-declared-but-empty tag is skipped for THIS file exactly like a
   file that never declared the tag at all — if every loaded file's copy is empty,
   the channel never appears in the list at all. */
export function commonDimensions(fileSet) {
  const channelCounts = new Map();
  const lbSizeCounts = new Map();
  const lsSizeCounts = new Map();

  for (const entry of fileSet.list()) {
    for (const tag of entry.df.analogTags) {
      if (!channelHasData(entry.df, tag)) continue;
      channelCounts.set(tag, (channelCounts.get(tag) || 0) + 1);
    }
    // Derived, not logged — never in analogTags — added here so it rides the same
    // toggle-palette "Channels" row as a real one (see chartData.js's own note on
    // MASS_ADDED_CHANNEL_TAG for why it's modeled as a channel at all).
    if (hasMassAddedData(entry.df)) {
      channelCounts.set(MASS_ADDED_CHANNEL_TAG, (channelCounts.get(MASS_ADDED_CHANNEL_TAG) || 0) + 1);
    }
    for (const size of entry.df.lbSizes) {
      lbSizeCounts.set(size, (lbSizeCounts.get(size) || 0) + 1);
    }
    for (const size of entry.df.lsSizes) {
      lsSizeCounts.set(size, (lsSizeCounts.get(size) || 0) + 1);
    }
  }

  const total = fileSet.list().length;
  function toSortedList(counts) {
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, total }))
      .sort((a, b) => {
        const na = parseFloat(a.key), nb = parseFloat(b.key);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return a.key.localeCompare(b.key);
      });
  }

  return {
    fileCount: total,
    channels: toSortedList(channelCounts),
    lbSizes: toSortedList(lbSizeCounts),
    lsSizes: toSortedList(lsSizeCounts)
  };
}

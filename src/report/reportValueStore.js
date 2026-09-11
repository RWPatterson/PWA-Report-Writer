/* =====================================================================================
   reportValueStore.js
   =====================================================================================
   Resolution rule: User Entry -> Custom Default -> From Data -> null. Same rule as the
   workbook's SaveDataTable, keyed by stable string IDs instead of row numbers.
   No knowledge of .DAT files, analysis, or templates lives here — this module only
   knows how to store and resolve values.
   ===================================================================================== */

/**
 * @typedef {Object} FieldTiers
 * @property {*} [fromData]       value supplied by the parser/analysis (lowest priority)
 * @property {*} [customDefault]  persisted/profile default (middle priority)
 * @property {*} [userEntry]      explicit user override (highest priority)
 * @property {string} [unit]      canonical unit (e.g. "kPa"), if the value is unit-bearing
 */

export class ReportValueStore {
  //#region private state
  /** @type {Map<string, FieldTiers>} id -> the three value tiers + unit */
  #fields = new Map();

  /**
   * Per-render, standard-specific payloads (Table B.2 buckets, figure chart source
   * refs, the ISO 16889 clump table, ...) that don't fit the field/unit model. Held
   * behind getExtra/setExtra rather than sprayed onto the instance as `store._foo`,
   * so it's clear these are an extension channel, not first-class fields. Deliberately
   * NOT part of toJSON(): they're live objects (DataFile/analysis references, derived
   * arrays) rebuilt on every file load, not saved session state.
   * @type {Map<string, *>}
   */
  #extras = new Map();
  //#endregion

  //#region field tiers — write
  /**
   * @param {string} id
   * @param {*} value
   * @param {string} [unit] canonical unit; omit for plain text / already-formatted values
   */
  setFromData(id, value, unit) {
    const field = this.#ensure(id);
    field.fromData = value;
    if (unit !== undefined) field.unit = unit;
  }

  /** @param {string} id @param {*} value */
  setUserEntry(id, value) {
    this.#ensure(id).userEntry = value;
  }

  /** @param {string} id */
  clearUserEntry(id) {
    if (this.#fields.has(id)) this.#fields.get(id).userEntry = undefined;
  }

  /** @param {string} id @param {*} value */
  setCustomDefault(id, value) {
    this.#ensure(id).customDefault = value;
  }

  /** @param {string} id */
  clearCustomDefault(id) {
    if (this.#fields.has(id)) this.#fields.get(id).customDefault = undefined;
  }
  //#endregion

  //#region field tiers — read (resolution rule)
  /** Resolved value by the User Entry -> Custom Default -> From Data -> null rule.
   *  @param {string} id @returns {*} */
  get(id) {
    const field = this.#fields.get(id);
    if (!field) return null;
    if (field.userEntry !== undefined && field.userEntry !== "") return field.userEntry;
    if (field.customDefault !== undefined && field.customDefault !== "") return field.customDefault;
    if (field.fromData !== undefined && field.fromData !== "") return field.fromData;
    return null;
  }

  /** @param {string} id @returns {boolean} whether a non-empty User Entry is winning */
  isOverridden(id) {
    const field = this.#fields.get(id);
    return !!(field && field.userEntry !== undefined && field.userEntry !== "");
  }

  /** The field's canonical unit (e.g. "kPa"), if it has one. Set once via setFromData's
   *  third argument; a User Entry or Custom Default overriding the value does not change
   *  what physical quantity the field represents.
   *  @param {string} id @returns {string|undefined} */
  getUnit(id) {
    const field = this.#fields.get(id);
    return field ? field.unit : undefined;
  }

  /** Every field with a non-empty User Entry, id -> value. Used to carry manual edits
   *  across a store rebuild that would otherwise silently discard them — e.g.
   *  app.js's runAnalysisPipeline re-running analysis for a different sensor against
   *  the SAME loaded file: a user-provided fact (gravimetric results, a double-click
   *  override) doesn't stop being true just because the selected sensor changed.
   *  @returns {Record<string,*>} */
  getUserEntries() {
    const out = {};
    for (const [id, field] of this.#fields) {
      if (field.userEntry !== undefined && field.userEntry !== "") out[id] = field.userEntry;
    }
    return out;
  }

  /** @param {string} id @returns {FieldTiers} the field record, creating it if absent */
  #ensure(id) {
    if (!this.#fields.has(id)) this.#fields.set(id, {});
    return this.#fields.get(id);
  }
  //#endregion

  //#region extras (live per-render payloads, off the public surface)
  /** @param {string} key @returns {*} the stashed payload, or undefined */
  getExtra(key) {
    return this.#extras.get(key);
  }

  /** @param {string} key @param {*} value @returns {*} value (for convenient chaining) */
  setExtra(key, value) {
    this.#extras.set(key, value);
    return value;
  }
  //#endregion

  //#region serialization (fields only — extras are live, never saved)
  /** @returns {{tool:string, version:number, savedAt:string, fields:Object}} */
  toJSON() {
    const out = {};
    for (const [id, field] of this.#fields) out[id] = field;
    return { tool: "report-value-store", version: 1, savedAt: new Date().toISOString(), fields: out };
  }

  /** @param {*} data a parsed report_session.json @returns {ReportValueStore} */
  static fromJSON(data) {
    const store = new ReportValueStore();
    const fields = (data && data.fields) || {};
    for (const id of Object.keys(fields)) store.#fields.set(id, fields[id]);
    return store;
  }
  //#endregion
}

/* =====================================================================================
   customTabs.js
   =====================================================================================
   Holds the DEFINITIONS of user-created plot tabs — a title and which channels or
   sensor to plot. Deliberately knows nothing about any particular .DAT file: a
   definition like "Cooling Control: TS_Temp, DS_Temp, INJ_Temp" is meaningful before
   any file is loaded and stays meaningful across every file loaded afterward, which is
   the whole point — load file A, look at the plot, load file B, see the same plot
   redrawn for B's data without recreating the tab.

   Two kinds of definition:
     { kind: "channels", channels: ["TS_Temp", "DS_Temp"] }   — arbitrary analog overlay
     { kind: "sensorCounts", sensorKey: "lbu" }                — all sizes of one sensor

   Rendering a definition against a specific file is chartData.js's job, not this
   file's — this file only manages the list.
   ===================================================================================== */

/**
 * @typedef {Object} TabDefinition
 * @property {string} id
 * @property {string} title
 * @property {"channels"|"sensorCounts"} kind
 * @property {string[]} channels    channel tags for kind "channels"
 * @property {string|null} sensorKey sensor key for kind "sensorCounts"
 */

export class CustomTabRegistry {
  //#region private state
  /** @type {TabDefinition[]} the ordered list of tab definitions */
  #tabs = [];
  //#endregion

  //#region mutate
  /** Add a tab from a partial definition, assigning it a fresh id.
   *  @param {{title:string, kind:string, channels?:string[], sensorKey?:string}} definition
   *  @returns {TabDefinition} the stored tab (with its id) */
  add(definition) {
    const tab = {
      id: "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      title: definition.title,
      kind: definition.kind,
      channels: definition.channels || [],
      sensorKey: definition.sensorKey || null
    };
    this.#tabs.push(tab);
    return tab;
  }

  /** @param {string} id */
  remove(id) {
    this.#tabs = this.#tabs.filter(t => t.id !== id);
  }
  //#endregion

  //#region read
  /** @returns {TabDefinition[]} the live list (read-only by convention) */
  list() {
    return this.#tabs;
  }
  //#endregion

  //#region serialization
  /** @returns {{tool:string, version:number, savedAt:string, tabs:TabDefinition[]}} */
  toJSON() {
    return { tool: "custom-chart-tabs", version: 1, savedAt: new Date().toISOString(), tabs: this.#tabs };
  }

  /** @param {*} data a parsed chart_tabs.json @returns {CustomTabRegistry} */
  static fromJSON(data) {
    const registry = new CustomTabRegistry();
    registry.#tabs = (data && Array.isArray(data.tabs)) ? data.tabs : [];
    return registry;
  }
  //#endregion
}

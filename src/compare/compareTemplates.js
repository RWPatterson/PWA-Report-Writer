/* =====================================================================================
   compareTemplates.js
   =====================================================================================
   Holds the DEFINITIONS of custom comparison report templates — a title and an
   ordered set of pages, each a fixed-capacity (2 or 4) grid of plots. Deliberately
   knows nothing about any particular loaded file set: a template like "DP +
   Beta@5/15/25µm, 4-up" is meaningful before any comparison files are loaded and
   stays meaningful across whichever set gets loaded afterward — same "definition vs.
   whichever data is loaded" split customTabs.js already established for single-file
   plot tabs, one level up (a template's pages vs. a tab's one chart).

   Three plot kinds:
     { kind: "channel",      channelTag }                              — one named analog channel, one file per line
     { kind: "sizes",        sensorKey, sizes: string[] }               — up to 3 particle sizes from one sensor, combined onto one plot
     { kind: "standardPlot", standardId, sensor, plotId }               — a curve from ONE standard's analysis (e.g. iso16889's "betaVsSize")

   standardPlot carries its OWN standardId/sensor per plot, not a template-wide
   field — per the user: "if a user wants to add a figure from one standard and then
   another, I think that's fine to do." A template can freely mix an ISO 16889 beta
   curve with an ISO 4548-12 efficiency curve on the same page; each plot resolves
   independently (compareTemplateView.js runs each spec's own standardId/sensor
   through app.js's runStandardCurve — no standard's analysis is shared with another,
   per CLAUDE.md, it's just invoked once per plot instead of once per template).

   Rendering a template against a specific file set is compareTemplateView.js's job,
   not this file's — this file only manages the list and the page layout.
   ===================================================================================== */

/**
 * @typedef {{kind:"channel", channelTag:string}} ChannelPlotSpec
 * @typedef {{kind:"sizes", sensorKey:string, sizes:string[]}} SizesPlotSpec
 * @typedef {{kind:"standardPlot", standardId:string, sensor:string, plotId:string, size?:string}} StandardPlotSpec size is set only for a multiSize curve (e.g. ISO 16889's β vs. Time/Pressure)
 * @typedef {(ChannelPlotSpec|SizesPlotSpec|StandardPlotSpec) & {id:string}} PlotSpec
 *
 * @typedef {Object} TemplatePage
 * @property {string} id
 * @property {"2up"|"4up"} mode
 * @property {PlotSpec[]} plots
 *
 * @typedef {Object} CompareTemplate
 * @property {string} id
 * @property {string} title
 * @property {"2up"|"4up"} defaultPageMode  page mode used when auto-flow creates a NEW page
 * @property {TemplatePage[]} pages
 */

/** @type {Record<"2up"|"4up", number>} */
const PAGE_CAPACITY = { "2up": 2, "4up": 4 };

/** @returns {string} */
function freshId(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

//#region plot spec matching
/* specsMatch: identity for de-duplication/toggle purposes — "is this already in the
   template" — NOT object identity, since a freshly-built spec from the palette never
   shares a reference with one already stored. Sizes compares its size list
   order-independently (a group is the same group regardless of which order the
   checkboxes happened to be ticked in). */
/** @param {PlotSpec|{kind:string,channelTag?:string,sensorKey?:string,sizes?:string[],standardId?:string,sensor?:string,plotId?:string,size?:string}} a @param {*} b @returns {boolean} */
export function specsMatch(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "channel") return a.channelTag === b.channelTag;
  // standardId+sensor+plotId+size together, not plotId alone — "effVsSize" is the
  // same curveId for BOTH iso454812 and iso19438, and per the user, a template can
  // hold curves from several standards (and the same standard at more than one
  // sensor) side by side, so all four must match for two standardPlot specs to be
  // "the same plot." size is undefined for every non-multiSize curve, so it drops
  // out of this comparison for them exactly like it always has (undefined ===
  // undefined) — only a multiSize curve (e.g. ISO 16889's β vs. Time/Pressure)
  // actually distinguishes on it, one plot per size chosen.
  if (a.kind === "standardPlot") return a.standardId === b.standardId && a.sensor === b.sensor && a.plotId === b.plotId && a.size === b.size;
  if (a.kind === "sizes") {
    if (a.sensorKey !== b.sensorKey) return false;
    const sa = [...a.sizes].sort(), sb = [...b.sizes].sort();
    return sa.length === sb.length && sa.every((s, i) => s === sb[i]);
  }
  return false;
}
//#endregion

//#region layout / reflow
/* retile: the one piece of real logic here. Flattens every page's plots into one
   ordered list (order is always toggle order — addPlot pushes, removePlot splices,
   neither ever reorders), then re-chunks:
     1. Walk the template's EXISTING pages in order, refilling each from the front of
        the flat list up to its own capacity — an existing page's mode survives a
        defaultPageMode change, and surviving pages keep their relative position.
     2. Drop a page left with zero plots (its slot's worth of content moved earlier,
        or there was nothing left to give it).
     3. Anything left over after existing pages are full spills into brand-new pages
        created at template.defaultPageMode.
   Mutates template.pages in place and returns it, for convenient chaining. */
/** @param {CompareTemplate} template @returns {TemplatePage[]} */
export function retile(template) {
  const flat = template.pages.flatMap(p => p.plots);
  const existingModes = template.pages.map(p => p.mode);

  const pages = [];
  let cursor = 0;
  for (const mode of existingModes) {
    const capacity = PAGE_CAPACITY[mode];
    const slice = flat.slice(cursor, cursor + capacity);
    if (slice.length === 0) continue;   // trailing now-empty page — drop it
    cursor += slice.length;
    pages.push({ id: freshId("page"), mode, plots: slice });
  }
  while (cursor < flat.length) {
    const capacity = PAGE_CAPACITY[template.defaultPageMode];
    const slice = flat.slice(cursor, cursor + capacity);
    cursor += slice.length;
    pages.push({ id: freshId("page"), mode: template.defaultPageMode, plots: slice });
  }

  template.pages = pages;
  return pages;
}
//#endregion

export class CompareTemplateRegistry {
  //#region private state
  /** @type {CompareTemplate[]} */
  #templates = [];
  //#endregion

  //#region mutate — registry
  /** @param {{title:string, defaultPageMode?:"2up"|"4up"}} definition @returns {CompareTemplate} */
  add(definition) {
    const template = {
      id: freshId("cmptpl"),
      title: definition.title,
      defaultPageMode: definition.defaultPageMode || "2up",
      pages: []
    };
    this.#templates.push(template);
    return template;
  }

  /** @param {string} id @param {string} newTitle @returns {CompareTemplate|null} */
  duplicate(id, newTitle) {
    const source = this.get(id);
    if (!source) return null;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = freshId("cmptpl");
    copy.title = newTitle;
    this.#templates.push(copy);
    return copy;
  }

  /** @param {string} id */
  remove(id) {
    this.#templates = this.#templates.filter(t => t.id !== id);
  }

  /** @param {string} id @param {string} title */
  rename(id, title) {
    const t = this.get(id);
    if (t) t.title = title;
  }
  //#endregion

  //#region mutate — a template's own fields
  /** @param {string} id @param {"2up"|"4up"} mode */
  setDefaultPageMode(id, mode) {
    const t = this.get(id);
    if (t) t.defaultPageMode = mode;
  }

  /** @param {string} id @param {string} pageId @param {"2up"|"4up"} mode */
  setPageMode(id, pageId, mode) {
    const t = this.get(id);
    if (!t) return;
    const page = t.pages.find(p => p.id === pageId);
    if (!page) return;
    page.mode = mode;
    retile(t);
  }
  //#endregion

  //#region mutate — plots (auto-flow add, reflow remove)
  /** Adds a plot spec to the end of the template (auto-flow placement — see retile),
   *  unless an equivalent spec is already present. @param {string} id
   *  @param {{kind:string,channelTag?:string,sensorKey?:string,sizes?:string[],standardId?:string,sensor?:string,plotId?:string}} spec
   *  @returns {boolean} true if it was actually added */
  addPlot(id, spec) {
    const t = this.get(id);
    if (!t) return false;
    const flat = t.pages.flatMap(p => p.plots);
    if (flat.some(p => specsMatch(p, spec))) return false;
    t.pages.push({ id: freshId("page"), mode: t.defaultPageMode, plots: [{ ...spec, id: freshId("plot") }] });
    retile(t);
    return true;
  }

  /** @param {string} id @param {string} plotId */
  removePlot(id, plotId) {
    const t = this.get(id);
    if (!t) return;
    for (const page of t.pages) page.plots = page.plots.filter(p => p.id !== plotId);
    retile(t);
  }
  //#endregion

  //#region read
  /** @returns {CompareTemplate[]} the live list (read-only by convention) */
  list() {
    return this.#templates;
  }

  /** @param {string} id @returns {CompareTemplate|undefined} */
  get(id) {
    return this.#templates.find(t => t.id === id);
  }
  //#endregion

  //#region serialization
  /** @returns {{tool:string, version:number, savedAt:string, templates:CompareTemplate[]}} */
  toJSON() {
    return { tool: "compare-templates", version: 1, savedAt: new Date().toISOString(), templates: this.#templates };
  }

  /** @param {*} data a parsed compare_templates.json @returns {CompareTemplateRegistry} */
  static fromJSON(data) {
    const registry = new CompareTemplateRegistry();
    registry.#templates = (data && Array.isArray(data.templates)) ? data.templates : [];
    return registry;
  }
  //#endregion
}

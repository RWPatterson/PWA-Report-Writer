/* =====================================================================================
   explorerView.js
   =====================================================================================
   Renders a parsed DataFile — OR a CyclicCompanionFile (core/cyclicCompanionFile.js),
   a structurally simpler "-Cyclic.DAT" companion, no header sections, no LB/LS/LBE
   split, just N named channels vs. time — as tabs and tables. Direct port of the
   rendering logic from the standalone Data File Explorer tool, adapted to operate on
   a container element instead of fixed document IDs, so it can live inside the PWA
   shell alongside other views. No parsing logic lives here — this only displays what
   the two parser classes produced.

   isCyclicCompanion (an instanceof check, not duck-typing — both classes are real,
   distinctly-named globals) is the ONE branch point: a companion file has no
   sections/LB/LS/LBE/aux concept at all, so it gets its own short tab list (a
   single flat channel table) instead of the DataFile-shaped tab set below. Every
   OTHER function here (tableModel/renderDataPanel/DataFileFmtElapsed/metaField) is
   already generic — it only reads a plain {tags, rows, timeField} spec, so it works
   unchanged for either file kind once dataTableSpec hands it the right one.

   options.companionDf covers the OTHER way a companion file reaches this view: a
   primary ISO 23369 file loaded normally, with its "-Cyclic.DAT" companion attached
   via the existing Add/Change Companion File flow (app.js's companionDf, separate
   from currentDf — the report needs BOTH files, not one replacing the other). That
   case still renders the primary df's normal tab set, with one more "Cyclic Data"
   tab appended reading FROM companionDf instead of df — same generic table
   machinery, just a different data source for that one tab id. Never true at the
   same time as isCyclicCompanion (that's the OTHER, standalone-load case, where df
   itself already IS the companion file). */

export function renderExplorer(container, df, sourceName, options = {}) {
  const { extraTabs = [], onAddTab = null, activeTabId = null, onTabChange = null, companionDf = null } = options;
  container.innerHTML = "";

  const isCyclicCompanion = df instanceof window.CyclicCompanionFile;
  const hasAttachedCompanion = !isCyclicCompanion && companionDf && companionDf.dataExist;

  const meta = el("div", { class: "meta" },
    metaField("File", df.fileName || sourceName),
    metaField("Test type", df.testType || "n/a"),
    metaField("Test setup", df.testSetup || "n/a"),
    metaField("Test date", df.fileDate || "n/a"),
    metaField("Records", String(df.analog.length)),
    metaField("Format", isCyclicCompanion
      // df.repeat/df.fiveRowShape don't exist on a CyclicCompanionFile \u2014 reading them
      // unguarded here used to render "undefined-row (LB only)" rather than crashing,
      // real but wrong output, not just a missing-field gap.
      ? "Cyclic companion (" + df.tags.length + " channel" + (df.tags.length === 1 ? "" : "s") + ")"
      : (df.dataExist ? (df.repeat + "-row (" + (df.fiveRowShape || "LB only") + ")") : "header only"))
  );
  container.appendChild(meta);

  if (df.warnings.length > 0) {
    const warnBox = el("div", { class: "warnings" });
    df.warnings.forEach(w => warnBox.appendChild(el("div", {}, "\u26A0 " + w)));
    container.appendChild(warnBox);
  }

  // A companion file has no header sections to show at all, and none of the
  // sensor-specific count blocks (no LB/LS/LBE split, no aux blocks) \u2014 just its own
  // one flat channel-vs-time table.
  const tabDefs = isCyclicCompanion ? [{ id: "cyclicData", label: "Cyclic Data" }] : [{ id: "header", label: "Header" }];
  if (!isCyclicCompanion) {
    if (df.analog.length) tabDefs.push({ id: "analog", label: "Analog Data" });
    if (df.lbu.length) tabDefs.push({ id: "lbu", label: "LB Up Counts" }, { id: "lbd", label: "LB Down Counts" });
    if (df.lsu.length) tabDefs.push({ id: "lsu", label: "LS Up Counts" }, { id: "lsd", label: "LS Down Counts" });
    if (df.lbe.length) tabDefs.push({ id: "lbe", label: "LBE Counts" });
    df.aux.forEach((a, i) => tabDefs.push({ id: "aux" + i, label: prettyAuxName(a.name) }));
    if (hasAttachedCompanion) tabDefs.push({ id: "cyclicData", label: "Cyclic Data" });
  }

  // extraTabs entries carry their own render(panelEl, df) function (custom plot tabs,
  // see customTabsView.js) — this file doesn't need to know what a chart is.
  const allTabs = tabDefs.concat(extraTabs);

  const tabBar = el("div", { class: "tabs" });
  const panel = el("div", { class: "panel" });
  let currentPanelTabId = null;

  function selectTab(id, button) {
    tabBar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    button.classList.add("active");
    renderAnyPanel(id);
    if (onTabChange) onTabChange(id);
  }

  function renderAnyPanel(id) {
    // If the tab we're leaving supplied a cleanup hook (custom plot tabs do, to
    // destroy their chart before the panel content is wiped), run it first. This
    // file never needs to know WHAT cleanup does — just that it might exist.
    if (currentPanelTabId) {
      const leaving = extraTabs.find(t => t.id === currentPanelTabId);
      if (leaving && leaving.cleanup) leaving.cleanup(panel);
    }
    currentPanelTabId = id;

    const extra = extraTabs.find(t => t.id === id);
    if (extra) {
      panel.innerHTML = "";
      extra.render(panel, df);
    } else {
      renderPanel(panel, (hasAttachedCompanion && id === "cyclicData") ? companionDf : df, id);
    }
  }

  const startTabId = (activeTabId && allTabs.some(t => t.id === activeTabId)) ? activeTabId : allTabs[0].id;

  allTabs.forEach((tab) => {
    const button = el("button", {
      onclick: (e) => selectTab(tab.id, e.target)
    }, tab.label);
    if (tab.id === startTabId) button.classList.add("active");
    tabBar.appendChild(button);
  });

  if (onAddTab) {
    tabBar.appendChild(el("button", { class: "add-tab", onclick: onAddTab, title: "Create a new plot tab" }, "+ Add Plot Tab"));
  }

  container.appendChild(tabBar);
  container.appendChild(panel);
  renderAnyPanel(startTabId);
}

function renderPanel(panel, df, tabId) {
  panel.innerHTML = "";
  if (tabId === "header") {
    renderHeaderPanel(panel, df);
  } else {
    renderDataPanel(panel, df, tabId);
  }
}

function renderHeaderPanel(panel, df) {
  df.sections.forEach(section => {
    const maxColumns = section.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const table = el("table", {}, el("tbody", {},
      ...section.rows.map(row => el("tr", {},
        ...Array.from({ length: maxColumns }, (_, c) => el("td", {}, row[c] ?? ""))))
    ));
    panel.appendChild(el("div", { class: "hdr-section" },
      el("h3", {}, section.name),
      el("div", { class: "tblwrap" }, table)));
  });
}

function dataTableSpec(df, tabId) {
  switch (tabId) {
    case "cyclicData": return { name: "CyclicData", tags: df.tags, rows: df.analog, timeField: true };
    case "analog": return { name: "AnalogData", tags: df.analogTags, rows: df.analog, timeField: true };
    case "lbu": return { name: "LB_Up_Counts", tags: df.lbSizes, rows: df.lbu };
    case "lbd": return { name: "LB_Down_Counts", tags: df.lbSizes, rows: df.lbd };
    case "lsu": return { name: "LS_Up_Counts", tags: df.lsSizes, rows: df.lsu };
    case "lsd": return { name: "LS_Down_Counts", tags: df.lsSizes, rows: df.lsd };
    case "lbe": return { name: "LBE_Counts", tags: df.lbeSizes, rows: df.lbe };
    default: {
      const aux = df.aux[parseInt(tabId.slice(3), 10)];
      const tags = aux.name.includes("LS") ? df.lsSizes : aux.name.includes("LB") ? df.lbSizes : [];
      return { name: aux.name, tags, rows: aux.rows, noTime: true };
    }
  }
}

function tableModel(df, spec) {
  const shift = spec.timeField ? 1 : 0;
  let cols = spec.tags.length + shift;
  spec.rows.forEach(r => { if (r.length > cols) cols = r.length; });

  const heads = [];
  if (!spec.noTime) heads.push("Elapsed Time");
  if (spec.timeField) heads.push("Time");
  for (let c = shift; c < cols; c++) {
    heads.push(spec.tags[c - shift] !== undefined ? spec.tags[c - shift] : "Col " + (c + 1 - shift));
  }

  function rowCells(row, i) {
    const cells = [];
    if (!spec.noTime) cells.push(DataFileFmtElapsed(df.times[i]));
    for (let c = 0; c < cols; c++) cells.push(row[c] ?? "");
    return cells;
  }

  return { heads, rowCells, cols };
}

function renderDataPanel(panel, df, tabId) {
  const spec = dataTableSpec(df, tabId);
  const model = tableModel(df, spec);

  panel.appendChild(el("div", { class: "panel-tools" },
    el("span", { class: "count" }, spec.rows.length + " records \u00D7 " + model.cols + " columns")));

  const thead = el("thead", {}, el("tr", {}, ...model.heads.map(h => el("th", {}, h))));
  const tbody = el("tbody", {}, ...spec.rows.map((r, i) =>
    el("tr", {}, ...model.rowCells(r, i).map(v => el("td", {}, v)))));

  panel.appendChild(el("div", { class: "tblwrap" }, el("table", {}, thead, tbody)));
}

function prettyAuxName(name) {
  return name.split("_").map(w => (w === "LS" || w === "LB") ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

function DataFileFmtElapsed(sec) {
  if (sec === null || !isFinite(sec)) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function metaField(label, value) {
  return el("span", {}, el("span", { class: "k" }, label), value);
}

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

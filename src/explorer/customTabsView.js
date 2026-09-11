/* =====================================================================================
   customTabsView.js
   =====================================================================================
   Two jobs:
     buildCustomTabDefs — turns registry definitions into the {id, label, render,
       cleanup} shape explorerView.js's extraTabs option expects. This is the ONLY
       file that connects "a custom tab definition" to "an actual chart on screen."
     openCreateTabDialog — the modal for defining a new plot tab: title, mode
       (arbitrary channel overlay vs. one sensor's full count array), and the
       channel/sensor picker itself, built from whatever the currently loaded file
       actually has available.
   ===================================================================================== */
import { availableChannels, availableSensors, buildMultiChannelDataset, buildCountsDataset } from "../core/charts/chartData.js";
import { renderChart, destroyChartsIn } from "../core/charts/chartView.js";
import { getAxisOverride, buildAxisControls } from "../core/charts/chartAxisControls.js";

export function buildCustomTabDefs(registry, onRemove) {
  return registry.list().map(tab => ({
    id: tab.id,
    label: tab.title,
    render(panelEl, df) {
      panelEl.appendChild(el("div", { class: "panel-tools" },
        el("span", { class: "count" }, describeTab(tab)),
        el("button", { class: "act", onclick: () => onRemove(tab.id) }, "Remove tab")));

      const dataResult = tab.kind === "sensorCounts"
        ? buildCountsDataset(df, tab.sensorKey)
        : buildMultiChannelDataset(df, tab.channels);

      if (!dataResult || dataResult.datasets.length === 0) {
        panelEl.appendChild(el("div", { class: "warnings" },
          "\u26A0 This file has none of the data this tab plots" +
          (dataResult && dataResult.missing.length ? " (looked for: " + dataResult.missing.join(", ") + ")" : "") + "."));
        return;
      }
      if (dataResult.missing && dataResult.missing.length) {
        panelEl.appendChild(el("div", { class: "warnings" },
          "\u26A0 Not present in this file: " + dataResult.missing.join(", ") + " (plotting the rest)"));
      }

      const wrap = el("div", { class: "chart-wrap" });
      const canvas = el("canvas", {});
      wrap.appendChild(canvas);
      panelEl.appendChild(wrap);

      const chartId = "tab:" + tab.id;
      renderChart(canvas, dataResult, getAxisOverride(chartId));
      const { button, panel } = buildAxisControls(chartId, canvas, (override) => renderChart(canvas, dataResult, override));
      wrap.appendChild(button);
      panelEl.appendChild(panel);
    },
    cleanup(panelEl) {
      destroyChartsIn(panelEl);
    }
  }));
}

function describeTab(tab) {
  return tab.kind === "sensorCounts"
    ? "All sizes, " + tab.sensorKey.toUpperCase()
    : tab.channels.join(", ");
}

/* openCreateTabDialog: builds a modal, appends it to <body>, and calls onCreate(def)
   if the person completes it. Removes itself either way. Built dynamically (not a
   static template) because its content — which channels are even choosable — depends
   on whichever file happens to be loaded when it's opened. */
export function openCreateTabDialog(df, onCreate) {
  if (!df) { alert("Load a data file first — there's nothing to plot yet."); return; }

  const channels = availableChannels(df);
  const sensors = availableSensors(df);

  const titleInput = el("input", { type: "text", placeholder: "e.g. Cooling Control" });

  const channelBoxes = channels.map(tag =>
    el("label", { class: "chk-row" },
      el("input", { type: "checkbox", value: tag }),
      " " + tag));
  const channelList = el("div", { class: "chk-list" }, ...channelBoxes);

  const sensorSelect = el("select", {}, ...sensors.map(s => el("option", { value: s.key }, s.label)));

  const modeChannels = el("input", { type: "radio", name: "tabMode", value: "channels", checked: "checked" });
  const modeSensor = el("input", { type: "radio", name: "tabMode", value: "sensorCounts" });

  function syncMode() {
    channelList.style.display = modeChannels.checked ? "" : "none";
    sensorSelect.style.display = modeChannels.checked ? "none" : "";
  }
  modeChannels.addEventListener("change", syncMode);
  modeSensor.addEventListener("change", syncMode);

  const errorLine = el("div", { class: "warnings", style: "display:none" });

  const dialog = el("div", { class: "modal-box" },
    el("h3", {}, "New plot tab"),
    el("label", { class: "field-label" }, "Title"),
    titleInput,
    el("label", { class: "field-label" }, "What to plot"),
    el("div", { class: "mode-row" },
      el("label", {}, modeChannels, " Overlay analog channels"),
      el("label", {}, modeSensor, " One sensor, all particle sizes")),
    channelList,
    sensorSelect,
    errorLine,
    el("div", { class: "modal-actions" },
      el("button", { class: "act", onclick: close }, "Cancel"),
      el("button", { class: "act primary", onclick: create }, "Create tab"))
  );

  sensorSelect.style.display = "none";
  if (!sensors.length) { modeSensor.disabled = true; }
  if (!channels.length) { modeChannels.disabled = true; modeSensor.checked = true; syncMode(); }

  const overlay = el("div", { class: "modal-overlay" }, dialog);
  document.body.appendChild(overlay);
  titleInput.focus();

  function close() { overlay.remove(); }

  function create() {
    const title = titleInput.value.trim();
    if (!title) { showError("Give the tab a title."); return; }

    if (modeChannels.checked) {
      const picked = channelList.querySelectorAll("input:checked");
      if (picked.length === 0) { showError("Pick at least one channel."); return; }
      onCreate({ title, kind: "channels", channels: [...picked].map(c => c.value) });
    } else {
      onCreate({ title, kind: "sensorCounts", sensorKey: sensorSelect.value });
    }
    close();
  }

  function showError(msg) {
    errorLine.textContent = "\u26A0 " + msg;
    errorLine.style.display = "";
  }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
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

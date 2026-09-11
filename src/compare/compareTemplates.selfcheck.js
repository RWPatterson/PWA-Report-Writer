/* Minimal runnable check for compareTemplates.js's retile/reflow logic (per CLAUDE.md:
   non-trivial logic leaves one runnable check behind). Pure data-in/data-out, no DOM
   and no dual CommonJS export needed — same situation as controlTargetCheck.js, which
   iso3968Analysis.selfcheck.js already loads via plain ES import. Just node this file
   directly: `node compareTemplates.selfcheck.js`. */

import { CompareTemplateRegistry, retile, specsMatch } from "./compareTemplates.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

function plotIds(page) { return page.plots.map(p => p.channelTag || p.plotId || p.sensorKey); }

// ---- Auto-flow: fills a page to capacity, then overflows to a new page at defaultPageMode ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "T1", defaultPageMode: "2up" });
  reg.addPlot(t.id, { kind: "channel", channelTag: "A" });
  reg.addPlot(t.id, { kind: "channel", channelTag: "B" });
  assert(t.pages.length === 1 && t.pages[0].plots.length === 2, "2 plots fit on one 2up page");

  reg.addPlot(t.id, { kind: "channel", channelTag: "C" });
  assert(t.pages.length === 2, "a 3rd plot overflows to a new page (got " + t.pages.length + " pages)");
  assert(plotIds(t.pages[0]).join(",") === "A,B", "page 1 keeps its original 2 plots, in toggle order");
  assert(plotIds(t.pages[1]).join(",") === "C", "page 2 holds the overflow plot");

  reg.addPlot(t.id, { kind: "channel", channelTag: "D" });
  assert(t.pages.length === 2 && plotIds(t.pages[1]).join(",") === "C,D",
    "a 4th plot fills page 2's remaining capacity rather than creating a 3rd page");
}

// ---- Remove reflows later plots up and drops an emptied trailing page ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "T2", defaultPageMode: "2up" });
  ["A", "B", "C", "D"].forEach(tag => reg.addPlot(t.id, { kind: "channel", channelTag: tag }));
  // starting layout: [A,B] [C,D]
  const bId = t.pages[0].plots[1].id;
  reg.removePlot(t.id, bId);
  assert(t.pages.length === 2, "removing B still leaves 2 pages (C shifts up to fill the gap)");
  assert(plotIds(t.pages[0]).join(",") === "A,C", "page 1 reflows to A,C after B is removed");
  assert(plotIds(t.pages[1]).join(",") === "D", "page 2 keeps D, shifted into the freed slot's wake");

  const cId = t.pages[0].plots[1].id;
  const dId = t.pages[1].plots[0].id;
  reg.removePlot(t.id, cId);
  reg.removePlot(t.id, dId);
  assert(t.pages.length === 1, "removing down to 1 plot drops the now-empty trailing page (got " + t.pages.length + ")");
  assert(plotIds(t.pages[0]).join(",") === "A", "the single remaining plot survives on page 1");
}

// ---- Existing pages keep their own mode across a defaultPageMode change ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "T3", defaultPageMode: "2up" });
  reg.addPlot(t.id, { kind: "channel", channelTag: "A" });
  reg.addPlot(t.id, { kind: "channel", channelTag: "B" });
  assert(t.pages.length === 1 && t.pages[0].mode === "2up", "page 1 starts as 2up, full");

  reg.setDefaultPageMode(t.id, "4up");
  reg.addPlot(t.id, { kind: "channel", channelTag: "C" });
  assert(t.pages.length === 2, "a 3rd plot spills to a new page rather than growing page 1");
  assert(t.pages[0].mode === "2up", "page 1's mode is untouched by the later defaultPageMode change");
  assert(t.pages[1].mode === "4up", "the NEW page uses the updated defaultPageMode");
}

// ---- Manually widening a page's own mode absorbs later plots on retile ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "T4", defaultPageMode: "2up" });
  ["A", "B", "C"].forEach(tag => reg.addPlot(t.id, { kind: "channel", channelTag: tag }));
  // [A,B] [C]
  reg.setPageMode(t.id, t.pages[0].id, "4up");
  assert(t.pages.length === 1, "widening page 1 to 4up absorbs page 2's plot, leaving one page");
  assert(plotIds(t.pages[0]).join(",") === "A,B,C", "page 1 now holds all 3 plots in order");
}

// ---- addPlot de-duplicates by spec identity, not object identity ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "T5" });
  assert(reg.addPlot(t.id, { kind: "channel", channelTag: "TS_DPress" }) === true, "first add succeeds");
  assert(reg.addPlot(t.id, { kind: "channel", channelTag: "TS_DPress" }) === false, "re-adding the same channel is a no-op");
  assert(t.pages.flatMap(p => p.plots).length === 1, "no duplicate plot was inserted");

  assert(reg.addPlot(t.id, { kind: "sizes", sensorKey: "lbu", sizes: ["5", "15"] }) === true, "sizes add succeeds");
  assert(reg.addPlot(t.id, { kind: "sizes", sensorKey: "lbu", sizes: ["15", "5"] }) === false,
    "the same size set in a different order is recognized as the same plot");
}

// ---- specsMatch is exported and order-independent for sizes ----
{
  assert(specsMatch({ kind: "sizes", sensorKey: "lsu", sizes: ["5", "15", "25"] },
    { kind: "sizes", sensorKey: "lsu", sizes: ["25", "5", "15"] }) === true, "specsMatch ignores size order");
  assert(specsMatch({ kind: "sizes", sensorKey: "lsu", sizes: ["5"] },
    { kind: "sizes", sensorKey: "lsd", sizes: ["5"] }) === false, "specsMatch respects sensorKey");
}

// ---- Registry-level rename/duplicate/remove + JSON round-trip ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "Original", defaultPageMode: "4up" });
  reg.addPlot(t.id, { kind: "standardPlot", standardId: "iso16889", sensor: "lbu", plotId: "betaVsSize" });
  reg.rename(t.id, "Renamed");
  assert(reg.get(t.id).title === "Renamed", "rename updates the stored title");

  const copy = reg.duplicate(t.id, "Copy");
  assert(copy.id !== t.id, "duplicate gets a fresh id");
  assert(copy.pages.length === t.pages.length && plotIds(copy.pages[0]).join(",") === plotIds(t.pages[0]).join(","),
    "duplicate carries the same page/plot content");

  const json = reg.toJSON();
  const reloaded = CompareTemplateRegistry.fromJSON(JSON.parse(JSON.stringify(json)));
  assert(reloaded.list().length === 2, "fromJSON restores every template");
  assert(reloaded.get(t.id).title === "Renamed", "fromJSON round-trips field values");

  reg.remove(t.id);
  assert(reg.list().length === 1, "remove drops exactly the targeted template");
}

// ---- A template can mix standardPlot entries from several different standards
// (and the same standard at more than one sensor) — per the user's own call ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "Multi-standard", defaultPageMode: "4up" });
  const betaLB = reg.addPlot(t.id, { kind: "standardPlot", standardId: "iso16889", sensor: "lbu", plotId: "betaVsSize" });
  const betaLS = reg.addPlot(t.id, { kind: "standardPlot", standardId: "iso16889", sensor: "lsu", plotId: "betaVsSize" });
  const eff4548 = reg.addPlot(t.id, { kind: "standardPlot", standardId: "iso454812", sensor: "lbu", plotId: "effVsSize" });
  const eff19438 = reg.addPlot(t.id, { kind: "standardPlot", standardId: "iso19438", sensor: "lbu", plotId: "effVsSize" });
  assert(betaLB && betaLS && eff4548 && eff19438, "all 4 standard/sensor combinations were added, none rejected as duplicates");
  assert(t.pages.flatMap(p => p.plots).length === 4, "all 4 coexist in the same template (got " +
    t.pages.flatMap(p => p.plots).length + ")");

  // Same standardId+sensor+plotId a second time IS a duplicate.
  const dup = reg.addPlot(t.id, { kind: "standardPlot", standardId: "iso16889", sensor: "lbu", plotId: "betaVsSize" });
  assert(dup === false, "re-adding the exact same standard+sensor+curve is a no-op");
  assert(t.pages.flatMap(p => p.plots).length === 4, "still exactly 4 plots after the duplicate attempt");
}

// ---- retile() is safely idempotent when called directly on an already-tiled template ----
{
  const reg = new CompareTemplateRegistry();
  const t = reg.add({ title: "T6", defaultPageMode: "2up" });
  ["A", "B", "C"].forEach(tag => reg.addPlot(t.id, { kind: "channel", channelTag: tag }));
  const before = JSON.stringify(t.pages.map(p => ({ mode: p.mode, ids: plotIds(p) })));
  retile(t);
  const after = JSON.stringify(t.pages.map(p => ({ mode: p.mode, ids: plotIds(p) })));
  assert(before === after, "calling retile again with no changes leaves page contents/modes unchanged");
}

if (failures > 0) {
  console.error("\n" + failures + " check(s) failed.");
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}

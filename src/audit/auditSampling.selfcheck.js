/* Minimal runnable check for auditSampling.js's index/table sampling (per CLAUDE.md:
   non-trivial logic leaves one runnable check behind). Pure data-in/data-out, no DOM —
   same situation as compareTemplates.js. Just node this file directly:
   `node auditSampling.selfcheck.js`. */

import { sampleIndices, sampleTable, sampleWideTable } from "./auditSampling.js";

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok:   " + msg);
}

// ---- sampleIndices: "ends" mode (1st/2nd/last) ----
{
  const picks = sampleIndices(10, "ends");
  assert(picks.length === 3, "ends mode on n=10 picks exactly 3 (got " + picks.length + ")");
  assert(picks.map(p => p.index).join(",") === "0,1,9", "ends mode picks indices 0,1,9 (got " + picks.map(p => p.index).join(",") + ")");
  assert(picks.map(p => p.label).join(",") === "1st,2nd,last", "ends mode labels are 1st,2nd,last");
}

// ---- sampleIndices: "middle" mode (1st/middle/last) ----
{
  const picks = sampleIndices(11, "middle");
  assert(picks.map(p => p.index).join(",") === "0,5,10", "middle mode on n=11 picks 0,5,10 (got " + picks.map(p => p.index).join(",") + ")");
}

// ---- sampleIndices: small-n collapse (no duplicate indices) ----
{
  assert(sampleIndices(1, "ends").map(p => p.index).join(",") === "0", "n=1 collapses to just index 0");
  assert(sampleIndices(2, "ends").map(p => p.index).join(",") === "0,1", "n=2 ends collapses to 0,1 (no duplicate 'last')");
  assert(sampleIndices(0, "ends").length === 0, "n=0 yields no picks");
}

// ---- sampleTable: row-only sampling + disclosure note ----
{
  const rows = [[10], [20], [30], [40], [50]];
  const t = sampleTable(["Value"], rows, "ends");
  assert(t.columns.join(",") === "#,Value", "sampleTable prepends a '#' label column");
  assert(t.rows.length === 3, "sampleTable('ends') on 5 rows keeps 3");
  assert(t.rows.map(r => r[1]).join(",") === "10,20,50", "sampleTable keeps rows 1st,2nd,last by VALUE (got " + t.rows.map(r => r[1]).join(",") + ")");
  assert(/Showing 3 of 5/.test(t.note), "sampleTable's note discloses how many of how many were shown");
}

// ---- sampleTable: no sampling needed when everything already fits ----
{
  const t = sampleTable(["Value"], [[1], [2]], "ends");
  assert(/Showing all 2 rows/.test(t.note), "sampleTable reports 'showing all' when nothing was actually trimmed");
}

// ---- sampleWideTable: 2D sampling (rows=clumps, columns=sizes) ----
{
  const sizeLabels = ["4µm", "7µm", "14µm", "21µm", "30µm"];
  // 4 "clumps", each with one β value per size — value encodes (clumpIndex*100 + sizeIndex) so the test can verify EXACTLY which cell survived sampling.
  const allRows = [0, 1, 2, 3].map(ci => ({
    fixed: ["clump" + ci],
    bySize: sizeLabels.map((_, si) => ci * 100 + si)
  }));
  const t = sampleWideTable(["Window"], sizeLabels, allRows, { rowMode: "ends" });
  assert(t.rows.length === 3, "sampleWideTable('ends') on 4 rows keeps 3 (1st/2nd/last)");
  assert(t.columns.length === 1 + 1 + 3, "sampleWideTable keeps '#' + 1 fixed column + 3 sampled size columns (got " + t.columns.length + ")");
  // row 0 (clump0): fixed columns are ["1st","clump0"], then sampled sizes 0,2,4 -> values 0,2,4
  assert(t.rows[0].join(",") === "1st,clump0,0,2,4", "clump0's row keeps the 1st/middle/last SIZE columns (got " + t.rows[0].join(",") + ")");
  // last sampled row is clump3 (index 3): values 300,302,304
  assert(t.rows[2].join(",") === "last,clump3,300,302,304", "the LAST sampled row is clump3, same size columns (got " + t.rows[2].join(",") + ")");
  assert(/3 of 4 rows.*3 of 5 sizes/.test(t.note), "sampleWideTable's note discloses both row and column sample sizes (got: " + t.note + ")");
}

// ---- sampleWideTable: columnUnit overrides the note's own wording — default stays "sizes" for every existing caller, opt-in only ----
{
  const sizeLabels = ["4µm", "7µm", "14µm", "21µm", "30µm"];
  const allRows = [0, 1, 2, 3].map(ci => ({ fixed: ["row" + ci], bySize: sizeLabels.map((_, si) => ci * 100 + si) }));
  const defaultUnit = sampleWideTable(["Window"], sizeLabels, allRows, { rowMode: "ends" });
  assert(/sizes as a representative/.test(defaultUnit.note), "columnUnit defaults to 'sizes' when not given (got: " + defaultUnit.note + ")");
  const customUnit = sampleWideTable(["Window"], sizeLabels, allRows, { rowMode: "ends", columnUnit: "channels" });
  assert(/channels as a representative/.test(customUnit.note), "columnUnit overrides the note's wording when given (got: " + customUnit.note + ")");
}

// ---- sampleWideTable: optional cellTitle hook — no title without it, one per bySize cell (never a fixed column) with it ----
{
  const sizeLabels = ["4µm", "7µm", "14µm", "21µm", "30µm"];
  const allRows = [0, 1, 2, 3].map(ci => ({ fixed: ["clump" + ci], bySize: sizeLabels.map((_, si) => ci * 100 + si) }));

  const withoutHook = sampleWideTable(["Window"], sizeLabels, allRows, { rowMode: "ends" });
  assert(withoutHook.cellTitles === undefined, "no cellTitle option -> no cellTitles key at all");

  const calls = [];
  const withHook = sampleWideTable(["Window"], sizeLabels, allRows, {
    rowMode: "ends",
    cellTitle: (rowIndex, colIndex, row) => { calls.push(rowIndex + "," + colIndex); return "r" + rowIndex + "c" + colIndex; }
  });
  assert(Array.isArray(withHook.cellTitles) && withHook.cellTitles.length === 3, "cellTitles has one row per SHOWN table row");
  assert(withHook.cellTitles[0].length === withHook.rows[0].length, "each cellTitles row is the same width as its data row");
  assert(withHook.cellTitles[0][0] === null && withHook.cellTitles[0][1] === null, "the '#' and fixed-column cells get no title (null)");
  assert(withHook.cellTitles[0].slice(2).join(",") === "r0c0,r0c2,r0c4", "bySize cells 1st/middle/last get titles built from the ORIGINAL row/col indices (got " + withHook.cellTitles[0].slice(2).join(",") + ")");
  assert(withHook.cellTitles[2].slice(2).join(",") === "r3c0,r3c2,r3c4", "the LAST sampled row's titles use ITS OWN original row index (3), not its display position (got " + withHook.cellTitles[2].slice(2).join(",") + ")");
  assert(calls.length === 9, "cellTitle called once per shown bySize cell only — 3 rows x 3 cols, never for fixed columns (got " + calls.length + ")");
}

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " check(s) failed.");
process.exit(failures === 0 ? 0 : 1);

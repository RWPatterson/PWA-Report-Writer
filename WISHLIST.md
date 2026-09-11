# Wishlist

Not scheduled, not scoped in detail — just tracked so it doesn't only live in chat
history that won't travel with the project. Move an item to `CHANGELOG.md` once it's
actually built, with real detail on what shipped.

## Audit Trail v2 (deferred scope, not started)

Built 2026-08-10 (see CHANGELOG) deliberately scoped to "narrate what each analysis
engine already exposes" — no engine changes. Real gaps found during that pass, left
for if/when actually needed rather than pre-emptively built:

- **DONE 2026-08-10 — interpolation transparency + representative sampling** (see
  CHANGELOG). Every interpolated result (termination, %-net-ΔP milestones,
  Size_At_Beta_x, micrometer/filter ratings) now shows the two bracketing measured
  points it actually came from, via additive engine changes
  (`terminationBracket`, each milestone's own `.bracket`, the new public
  `sizeGivenBetaDetail`/`sizeGivenEfficiencyDetail` statics) — the
  `_sizeGivenBeta`/`_sizeGivenEfficiency`/termination-time fields all just
  delegate to the richer version now, zero behavior change. Large per-size/per-
  clump/per-bucket/per-point tables now show a labeled 1st/2nd/last (rows) ×
  1st/middle/last (size columns) sample instead of a full dump
  (`src/audit/auditSampling.js`), with a "showing N of M" disclosure; full data
  stays in the raw JSON dump.
- **Currently-discarded intermediates** would make several steps more complete:
  per-window sample counts (`n`) behind an average (currently invisible — a clump/
  bucket with 1 sample and one with 50 look identical in the trail today), and the
  LOSING dual-filter termination candidates' crossing times (only the winner
  survives — `_determineDualFilterTermination` in iso16889/iso454812/iso19438
  already computes every active candidate's own bracket via `findCrossingBracket`
  before picking a winner; exposing the losers too would need the same additive
  "store it as a new field" treatment already used for the winner's own bracket).
- **DONE 2026-08-10 — printing.** `printAuditBtn` added (see CHANGELOG) — no
  Chart.js canvases on this view, so it needed none of Report/Compare's JS-timing
  print fighting, just plain CSS. One known, accepted limitation: the widest
  tables (ISO 16889's 10-clump table, ~20 size columns) can clip a few of the
  largest sizes at the page's right edge — ordinary HTML table columns shrink to
  fit, but not infinitely; not worth fighting further for a hidden dev tool
  unless it actually gets in someone's way. A "save as JSON" export (for handing
  a trail to someone outside the tree without printing it) is still open.
- **`controlTargetCheck.js` instrumentation**: its result object has target/actual/
  tolerance but not the resolved bounds (`lo`/`hi`) as their own fields, nor which
  path (`channelTag` vs `headerFallback`) supplied `actual`, nor the sample count
  behind a channel average — all folded into the `message` string today. Fine for
  a pass/fail table; would need light instrumentation for a fuller derivation view.

## Known bugs (unresolved)

- **`tools/render-check/pdf-compare.js`'s `page.pdf()`-based verification cannot be
  trusted for the "multiple charts per printed page" case — it does not match real
  Chrome print behavior.** History: while adding Compare Files' print support
  (2026-08-10), a page with 2+ charts came back with only the LAST chart's canvas
  showing real content in the generated PDF — every earlier chart blank. Initial
  investigation (via `page.pdf()`) concluded this was a pre-existing, app-wide
  Chromium print-pipeline bug affecting the single-file Report too (its own
  "double-fig" pages showed the identical symptom under the same test method). The
  user then supplied a REAL printed PDF of an ISO 4548-12 report (Figures B.2/B.3
  together, Add Count Details' Upstream/Downstream together — 2 charts per page,
  both cases) showing BOTH charts rendering correctly on paper — directly
  contradicting that conclusion. Re-running `pdf-report.js` against the exact same
  standard/scenario still reproduced the "only last chart" failure via `page.pdf()`,
  confirming the automated tool itself doesn't faithfully reproduce real print
  output for this case — **not the app**. Anything `pdf-compare.js`/`pdf-report.js`
  report about MULTI-chart pages should be treated as unreliable; single-chart-page
  checks (`pdf-compare-single.js`) still appear trustworthy.
  - **A real, separate bug WAS found and fixed along the way**, independent of the
    above: Compare's print path called `rerenderCompare()` (full teardown + rebuild
    of the whole template/palette/pages DOM, including brand-new `<canvas>`
    elements) from inside the `beforeprint` handler itself — meaning every printed
    chart sat on a canvas that had never been laid out or painted before that same
    synchronous handler ran. The single-file Report never had this problem: its
    canvases are part of the static page template and already exist (already
    painted at least once on screen) well before `beforeprint` fires;
    `redrawReportCharts` only ever redraws INTO them. Fixed by adding
    `redrawComparePlots` (`compareTemplateView.js`) — redraws onto the SAME,
    already-existing canvases via a stashed `canvas._compareChartRedraw` closure,
    exactly mirroring `redrawReportCharts`'s approach — and switching app.js's print
    hooks to call it instead of `rerenderCompare`. This is very likely the actual
    fix for what the user originally saw (their first attempted print showed ALL
    plots blank, worse than the "only last one" pattern `page.pdf()` was showing
    after the CSS-grid fix) — but **still needs a real print to confirm**, since the
    only verification tool available (`page.pdf()`) is the thing just proven
    unreliable for this exact scenario.
  - Also fixed, confirmed correct via `pdf-compare-single.js` (single-chart pages,
    which page.pdf() DOES render faithfully): a CSS Grid item's default
    `min-width:auto` was keeping `.compare-plot-grid`'s 2/4-up columns from
    narrowing to the true print-page width — added `min-width:0` on
    `.compare-plot-box`/`.chart-wrap` + `canvas{max-width:100%}`.
  - Next step: have the user confirm with an actual print whether the
    `redrawComparePlots` fix resolved it. If it did, treat `page.pdf()`'s
    multi-canvas-page unreliability as a standing caveat for this tree's dev tooling
    (worth a one-line warning at the top of `pdf-report.js` too). If it didn't,
    the "only last chart" symptom is real after all and needs further isolation
    with a method OTHER than `page.pdf()` (e.g. a human manually using the print
    dialog while screen-recording, since headless automation's own print pipeline
    is now a suspect, not a trusted oracle).

- **`page.pdf()` also cannot be trusted for the rotated-landscape page's vertical
  fit (ISO 16889/23369 Page 2 — `.w16889-p2-rotate`/`.w23369-p2-rotate`).** A second,
  distinct case of the same underlying unreliability as the multi-chart one above,
  found the same way: adding a print-only company-logo letterhead (2026-09-09),
  centered below every page's content, `page.pdf()`-rendered output showed the logo
  landing on top of real data cells on the rotated particle-count table (which is
  tuned to fill its rotated footprint edge-to-edge, per `app.css`'s own "structural
  guarantee" note on `.w16889-p2-table`) — implying there was no room for it there.
  The user then supplied a REAL printed PDF of an ISO 16889 report showing the logo
  sitting cleanly below the table with clear margin, no overlap at all, on that exact
  same page. So: real Chrome print leaves more vertical slack on this rotated page
  than `page.pdf()` shows — the app's layout is fine; the tool's rotated-page
  rendering isn't. Anything `page.pdf()`-based reports about content proximity to the
  bottom edge of `.w16889-p2-rotate`/`.w23369-p2-rotate` specifically should be
  treated as unreliable; a real print (or the user's own print preview) is the only
  trustworthy check for that one page.

## Decided 2026-07-30 (approved — listed in build order; several now done)

A pass over every open/partial item in the tree, with the user's call on each. Items
below are approved; the sections further down hold their detail. Marked DONE where
built since — see CHANGELOG.md for what actually shipped.

1. **DONE 2026-08-18 — walked the ISO 19438 report template, field by field.** All
   ~20 `// ASSUMED` markers across its Analysis/ControlTargets/Mapper checked
   against real `.DAT` files (SpinOnMP.DAT, TwinFSRig-ROTest9-MP.DAT — the same
   single-sensor rig ISO 4548-12's own control-target table was confirmed against)
   and now CONFIRMED — every channel tag and header key was really there. Two items
   needed the user's own knowledge rather than a file (both confirmed, 2026-08-18):
   `DISREGARDED_CYCLES` (3) and the Temperature compliance shape (Test System +
   Injection System, no Dilution System) both match ISO 4548-12's own figures, but
   as real independent carryover — the two standards' build-out documents were each
   produced separately from that standard's own published text, not one copied from
   the other. Also confirmed correct along the way (not a bug, despite looking like
   one at first): `SENSOR_CHANNELS.lbe`'s `upProp: "lbd"` deliberately aliases LB's
   own downstream reading, since the pre-filter's downstream sample point IS the
   final filter's upstream sample point in series/dual-filter testing — see
   iso19438Analysis.js's own SENSOR_CHANNELS comment. One related, broader finding:
   `testLocation`/`TestLocation` (read by all three multipass standards' mappers)
   doesn't appear in ANY real file checked — confirmed by the user this value is
   meant to come from Custom Default/Machine Profile, not from data; the from-data
   read stays as a harmless no-op fallback.
2. **DONE 2026-08-07 — Compare Files: add a standard picker.** Built as part of custom
   comparison report templates (see CHANGELOG) — a template now runs a chosen
   standard's own `run()`/`applyMapper()` per loaded file. Scoped to the size-indexed
   curves each standard's mapper already computes (beta/efficiency vs. size), NOT
   `computeMassBalance` — the two null-returning mass stubs in `chartData.js`
   (`buildInjectedMassVsDPDataset`, `buildComparisonMassDataset`) and the
   permanently-disabled "Injected mass vs. time" toggle are still unbuilt. Wiring mass
   in is now a smaller, well-precedented addition (follow `runStandardCurve`'s exact
   shape in `app.js`, reading `computeMassBalance`'s output instead of a `betaChart`/
   `effChart` extra) rather than a new architectural decision.
3. **DONE (partially) 2026-08-07 — Compare Files: cross-file summary table**
   (comparative efficiency/beta) — delivered as CHARTS (one plot, one line per file,
   x = particle size), not a literal table — see CHANGELOG. If a genuine side-by-side
   NUMBER table (not a chart) is still wanted for a comparison report page, that's the
   remaining open piece.
4. **Control-target compliance: exclude a startup/stabilization period** — see that
   section below; the open question is now answered, only N is undecided.
5. **Chart/picker UX** — both items below.
6. **ISO 3968:2017** — the fourth standard. DONE as a build: fully wired and
   selectable (STANDARDS entry, Mapper, both report pages, Figure 4 chart, optional
   tare-file workflow with its own toolbar button/prompt) — see CHANGELOG.md's
   entries for the full build history rather than re-deriving any of this from
   scratch. Three specific pieces still open:
   - **Net (tare-subtracted) DP** — Page 2 Table 1's Filter housing/Filter Element
     columns stay blank. The user confirmed interpolating the tare run's DP-vs-flow
     curve at each primary point's actual flow rate is the right shape, but the EXACT
     interpolation method still needs to be prescribed before this can be built (see
     `iso3968Analysis.js`'s own NOT YET IMPLEMENTED note).
   - **Figure 4's print height** (`app.css`'s `.iso3968-page1 .chart-wrap` / 
     `reportView.js`'s `FIGURE_HEIGHT_IN.pq3968`, currently 4in) is a first-pass
     estimate — this is the first standard to mix fixed content and a chart on the
     SAME page (every other standard's charts get a dedicated one-figure page), so
     there's no measured precedent to copy. Needs tuning against a real printed sheet
     the same iterative way ISO 4548-12's/16889's own figure heights were.
   - The `PQ.DAT`-family Test/Filter Identification fields not confirmed against a
     real file (`testLaboratory`, `housingIdentification`, `filterRatedFlowRate`,
     `testFluidRef`, `initialCleanliness`) are hand-entry by design (no
     software-produced source exists), not a gap to close later.

Also decided, no work implied:

- **`machineProfiles.js` stays dormant.** The pattern was created intentionally; it
  gets populated when a real machine needs it, not before. Low priority by design —
  don't keep raising it.
  - **Known future instance (2026-07-31, per the user):** older "Life and Efficiency"
    test stands — machines primarily testing to SAE J905/SAE J1985, maybe 5% of the
    fleet — report Test System Rate (`Test System Configuration`/`Rate` header) in
    L/hour instead of the fleet-standard L/min, with no unit tag distinguishing it.
    Exactly `machineProfile.js`'s existing `"L/hr->L/min"` channel-correction shape,
    just needed on a header value instead of a channel — not built, since checking
    for it on every analysis is wasted work for such a small segment; wait for an
    actual customer on one of these stands before adding it.
    **Gut-check heuristic to detect it** (per the user, each ISO standard dictates a
    relationship between system volume and system flow rate): standard expectation
    is 0-60 L/min, where system volume = numeric flow value / 2 (minimum 6 L); above
    60 L/min, system volume = numeric flow value / 4. E.g. a stand with a 6 L system
    volume (the allowed minimum) reporting "360" is almost certainly 360 L/hour
    (= 6 L/min), not 360 L/min, since 360 L/min would demand a system volume far
    larger than 6 L. Cross-checking the reported Rate against `Test System
    Configuration`/`Volume` this way is how a future fix would flag/correct the
    L/hour case, once it's worth building.

## Chart / picker UX
- **Display sizes vs. all sizes.** A way to plot only the particle sizes actually
  displayed/reported on (vs. every size a sensor measures) — relevant to both custom
  plot tabs' sensor-counts mode and Compare Files' size picker.
- **Select all / select none for size checkboxes.** Custom tabs and Compare Files both
  have up-to-32-checkbox lists for particle sizes; a single toggle beats clicking each
  one when someone genuinely wants the full set.

## Control target compliance (pre-screening against standard tolerances)

Check analog channels stayed within their configured control tolerance during a test
(e.g. test flow ±5%, temperature ±2°C), surfaced as a pre-screening warning and/or a
report field. See `dataFile.js`'s DILUTION SYSTEM SCHEMA and MidstreamFlag comments
for background gathered while scoping this — not duplicated here.

Rule table drafted for ISO 16889 (target values confirmed against a real file's
header, not guessed):

| Parameter | Channel(s) | Target source | Tolerance |
|---|---|---|---|
| Injection Flow Rate | `INJ_Rate` | Injection System Configuration → `Rate` | ±5% |
| Test Flow Rate | `TS_Rate` | Test System Configuration → `Rate` | ±5% |
| Sensor Flow Rate | `aQLBU`/`aQLBD` | Dilution System Configuration → `LBSensorFlow` | ±3% |
| | `aQLSU`/`aQLSD` | Dilution System Configuration → `LSSensorFlow` | ±3% |
| Temperature | `TS_Temp` | Test System Configuration → `Temperature` | ±2°C |
| | `INJ_Temp` | Injection System Configuration → `Temperature` | ±2°C |
| | `DS_Temp` | Dilution System Configuration → `Temperature` | ±2°C |
| Conductivity | `TS_Conductivity` (if present) else `TestConductivity` header | General Test Info (scalar; the value itself is the check) | 1500 ± 500 pS/m |
| | `INJ_Conductivity` (if present) else `InjConductivity` header | same | 1500 ± 500 pS/m |

Explicitly NOT in scope: dilution ratio (Primary/ExtendedDilutionRatio vs.
aUpPrimRatio/aUpExRatio/aDnPrimRatio/aDnExRatio) — no ISO standard prescribes a
tolerance for it, so it's not a compliance check candidate, just schema knowledge.

Open questions before building:
- **Compliance window — ANSWERED 2026-07-30: exclude a startup/stabilization
  period.** `controlTargetCheck.js` currently averages every record of the test, which
  lets a normal ramp-up trip a false failure. Still undecided: how long the excluded
  period is, and whether it's expressed in records or minutes. Note this makes the
  window per-standard CONTENT, not engine behavior — each standard's rule table owns
  its own value, one copy each, even if they start out identical.
- **Target-value source for non-header-derivable cases.** Most targets above ARE in
  the header now that the schema's confirmed — but this was initially a real gap
  (target values often aren't structured data) and won't be true for every future
  standard. Keep `ReportValueStore`'s Custom Default tier in mind as the fallback
  path, not `machineProfiles.js` — a target belongs to what's being tested, not
  which rig is running it.
- **`SampleFlow` duplicate-key parsing** — noted in `dataFile.js`, not yet needed by
  this feature (dilution ratio/flow isn't in the compliance table), but blocks
  reading it accurately if a future need arises.
- **Dual-filter path** — now BUILT (see CHANGELOG.md, 2026-08-03) in all three
  Analysis engines: earliest-of-up-to-3-active-targets termination for "Two
  Pressure"/"Suction & Pressure" Setups. Still out of scope for THIS control-target
  compliance feature specifically (this is about checking tolerance on live channels
  like flow rate/temperature, not termination) — no dependency remains.

Proposed shape (partially built): each standard's control-target rule table lives in
its own folder (e.g. `src/standards/iso454812/iso454812ControlTargets.js`), fed to the
standard-agnostic `src/core/controlTargetCheck.js` engine (already built, reusable
across standards).

## Second data format: SQLite (newer machines) — NOT scheduled

Newer rigs serialize test data into a SQLite database instead of (or alongside) the
`.DAT` text format — currently only used as a high-speed datafile for analog
inspection, never as a report input. Explicitly a **future improvement, not being
implemented now** (per the user, 2026-07-30) — recorded here so the schema knowledge
gathered while scoping it isn't lost before it's picked up.

Schema, as provided (LB-only example file):
```sql
CREATE TABLE Header ([Section] TEXT PRIMARY KEY, [JsonData] TEXT)
CREATE TABLE AnalogInputs ([Time] TEXT, [IJ_Volume] DOUBLE, [IJ_Temp] DOUBLE, [IJ_Rate] DOUBLE, [TS_Temp] DOUBLE, [TS_Rate] DOUBLE, [TS_DPress] DOUBLE, [TS_UpPress] DOUBLE, [DS_Temp] DOUBLE, [IJ_Heater_Temp] DOUBLE, [TestI_Heater_Temp] DOUBLE, [TestII_HeaterTemp] DOUBLE)
CREATE TABLE AnalogOutputs ([Time] TEXT, [IJ_CircRPM] DOUBLE, [IJ_MeteringRPM] DOUBLE, [IJ_WaterValve] DOUBLE, [TS_CircRPM] DOUBLE, [TS_PumpRPM] DOUBLE, [TS_WaterValve] DOUBLE, [DS_UpSamplePumpRPM] DOUBLE, [DS_DownSamplePumpRPM] DOUBLE, [DS_WaterValve] DOUBLE)
CREATE TABLE Period ([Time] TEXT, [A] DOUBLE, [B] DOUBLE, [C] DOUBLE, [D] DOUBLE, [E] DOUBLE, [F] DOUBLE, [G] DOUBLE, [H] DOUBLE, [I] DOUBLE, [J] DOUBLE, [Clean_Fluid] DOUBLE)
CREATE TABLE LBU ([Time] TEXT, [4] DOUBLE, [5] DOUBLE, [6] DOUBLE, [7] DOUBLE, [8] DOUBLE, [9] DOUBLE, [10] DOUBLE, [11] DOUBLE, [12] DOUBLE, [13] DOUBLE, [14] DOUBLE, [15] DOUBLE, [16] DOUBLE, [17] DOUBLE, [18] DOUBLE, [19] DOUBLE, [20] DOUBLE, [21] DOUBLE, [22] DOUBLE, [23] DOUBLE, [24] DOUBLE, [25] DOUBLE, [30] DOUBLE, [35] DOUBLE, [38] DOUBLE, [40] DOUBLE, [45] DOUBLE, [50] DOUBLE, [55] DOUBLE, [60] DOUBLE, [65] DOUBLE, [70] DOUBLE, [Ratio] DOUBLE, [Error] DOUBLE)
CREATE TABLE LBD ([Time] TEXT, [4] DOUBLE, [5] DOUBLE, [6] DOUBLE, [7] DOUBLE, [8] DOUBLE, [9] DOUBLE, [10] DOUBLE, [11] DOUBLE, [12] DOUBLE, [13] DOUBLE, [14] DOUBLE, [15] DOUBLE, [16] DOUBLE, [17] DOUBLE, [18] DOUBLE, [19] DOUBLE, [20] DOUBLE, [21] DOUBLE, [22] DOUBLE, [23] DOUBLE, [24] DOUBLE, [25] DOUBLE, [30] DOUBLE, [35] DOUBLE, [38] DOUBLE, [40] DOUBLE, [45] DOUBLE, [50] DOUBLE, [55] DOUBLE, [60] DOUBLE, [65] DOUBLE, [70] DOUBLE, [Ratio] DOUBLE, [Error] DOUBLE)
```

Confirmed with the user (2026-07-30):
- **The `.db` is a strict superset of the `.dat` for any given test** — any data present
  in a `.DAT` file will also be present in the `.db`, at the same or greater resolution.
  This is the key feasibility fact: full parity with the existing `.DAT`-based pipeline
  isn't in question, just tag-name mapping and, per the sampling-rate note below,
  bucketing the higher-resolution channels down to what the analysis engines expect.
  It also means the missing `TS_PreDPress`/`TS_FinalDPress`-equivalent columns noted
  below must exist SOMEWHERE in the full schema (a table not yet shared), not that
  these rigs lack dual-pressure support.
- **`Period`** = the online dilution system's oval gear flowmeter readings, throughout
  the test. Columns `A`–`J` are the dilution system's individual BRANCHES (per-branch
  flow rate), not arbitrary labels. `Clean_Fluid` is a SEPARATE oval meter used outside
  of testing, for machine control — not test data, likely not report-relevant.
- **`LBU`/`LBD`'s `Ratio`** = the SUM dilution ratio measured during that count cycle
  (a dilution-system reading, NOT a filtration beta ratio — corrects an initial
  guess). **`Error`** = flags whether the particle counter itself reported an error
  during that count cycle.
- **Only LB tables exist in this example** because it's an LB-only test file — same
  pattern as `.DAT`'s "only the sensor types actually present get count rows/sizes."
  `LSU`/`LSD`/an LBE-equivalent table would exist on a file that used those sensors.
- **Sampling rate is far higher than `.DAT`'s per-minute cadence**: `AnalogInputs` at
  0.1s, `Period` at 0.3s. Confirmed: `.DAT`, when it reports these same channels,
  already bundles them into minute averages — so a parser targeting the existing
  analysis engines (which assume per-minute records) would need to BUCKET this
  higher-rate data into the same per-minute/per-count-cycle granularity, at least
  initially. Taking advantage of the finer resolution for something the per-minute
  engines can't do today is a separate, later design question, not a given.

Open, unconfirmed:
- **Channel tag mismatch, already spotted, not just hypothetical**: `.DAT`'s confirmed
  injection tags are `INJ_Rate`/`INJ_Temp` (see every standard's `Analysis.js`); this
  schema uses `IJ_Rate`/`IJ_Temp`/`IJ_Volume` — no `N`. A future parser must NOT reuse
  the `.DAT`-side tag constants verbatim; this is exactly the "assumption carried from
  one function into a superficially similar one without re-checking" mistake class
  CLAUDE.md's ".DAT file handling" section already warns about, just for a second format.
- **No `TS_PreDPress`/`TS_FinalDPress`-equivalent columns** in `AnalogInputs` — only
  `TS_DPress`/`TS_UpPress`. Per the superset confirmation above, these must exist in
  some table not yet shared (this excerpt is one LB-only example file, not the full
  schema) rather than being genuinely absent — find that table before assuming a gap.
- Whether `Header`'s per-section JSON blobs use the same section/key NAMES as `.DAT`'s
  text header, or different ones — not yet checked against a real key.

**Mapping will be easy to verify, not guesswork**: these newer rigs currently produce
BOTH a `.dat` and a `.db` for every single test, specifically because reporting from
the `.db` is a known future step. That means whenever this gets built, every tag/header
mapping question above (does `IJ_Rate` really equal `.DAT`'s `INJ_Rate`? do `Header`'s
JSON section/key names match `.DAT`'s text header? which table carries the dual-
pressure channels?) can be answered by diffing a matched `.dat`/`.db` pair from the SAME
test, not by inference or asking the user to explain each field individually — a much
stronger verification path than most of this project's `// ASSUMED` markers ever had
(see CLAUDE.md's ".DAT file handling" — this is that same "verify against a real file"
discipline, just easier here since a known-correct reference file exists for free).

Build shape, if/when picked up: a new sibling parser (e.g. `src/core/sqliteDataFile.js`)
using a WASM SQLite reader (sql.js or similar — a genuinely new dependency, but one that
still fits the single-file offline ship format via inlining, same as everything else).
Per `dataFile.js`'s own role as "the single source of truth for the .DAT format," this
second parser should produce the SAME `DataFile`-shaped output, so every standard's
Analysis/Mapper/ControlTargets file needs ZERO changes — the format boundary already
lives entirely in the parser layer, and a second input format is exactly what that
boundary exists to make possible without touching per-standard code. One genuinely
positive finding: `Header`'s one-JSON-blob-per-section shape structurally CANNOT
reproduce `.DAT`'s confirmed `SampleFlow`-appears-twice-per-section gotcha (a JSON
object can't have a duplicate key) — this format is cleaner there, not just different.

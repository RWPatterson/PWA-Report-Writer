# WebReportWriter — development README

This is the **development** source tree: modular ES modules, a service worker, a
manifest — built to run as a PWA so it's easy to work on file-by-file and test in a
real browser. This is NOT the shipping format for offline customer sites. See
"Packaging for distribution" at the bottom.

See `CLAUDE.md` **first** for the project conventions that govern where code goes and
how to write it — the organization rule (standards are self-contained; procedures vs.
helpers), the folder map, the ISO 16889 provenance warning, and the code-hygiene / `.DAT`
directives. CLAUDE.md is authoritative for structure; this README is the narrative
companion (how to run it, per-file detail, gotchas).

See `CHANGELOG.md` for what changed and when.

See `WISHLIST.md` for future work that's been raised but not scheduled or scoped.

## Standards folder — where each report standard's own files live

Everything specific to one ISO standard — its analysis engine, mapper, page list,
control-target rule table (if built), and templates — lives in
`src/standards/<standardId>/` (e.g. `src/standards/iso16889/`,
`src/standards/iso454812/`), plus that standard's own `templates/<standardId>/`
folder. This is deliberate: removing or replacing an edition of a standard should mean
deleting one folder and updating the couple of aggregator files below, not hunting
through shared files for scattered references. Genuinely shared code lives OUTSIDE the
standards: generic utilities in `src/helpers/` (`units.js`, `analysisMath.js`) and
standard-agnostic infrastructure in `src/core/` (`dataFile.js`, `controlTargetCheck.js`,
machine profiles, `charts/`). Note: analysis PROCEDURES (e.g. termination detection) are
NOT shared — each standard owns its own copy, inlined into its `…Analysis.js`. See
CLAUDE.md for that rule and the full folder map.

The four biggest aggregator files that stitch a new standard into the app:
- `src/report/reportPages.js` — imports and concatenates every standard's `*Pages.js`.
- `src/app.js`'s `STANDARDS` object — maps a `standardId` to its `run`/`applyMapper`
  functions; this is also where the "Standard" selector's options come from.
- `index.html` — one `<script>` tag per standard's classic-script analysis engine.
- `service-worker.js`'s `PRECACHE_URLS` — every standard's files need an entry to work
  offline.

**These four aren't the whole list.** `CLAUDE.md`'s folder-map section has the
complete, ordered 9-point wiring checklist (also `index.html`'s two separate
sidebar button groups, `auditView.js`'s own `AUDIT_STANDARDS` registry,
`run-all-selfchecks.js`, and two smaller/optional pieces) — this list used to stop
at four and it was a real gap (found adding ISO 23369, 2026-08-20); follow
CLAUDE.md's copy, not this shorter one, when actually adding a standard.

## Why two formats exist

- **Dev (this tree):** multi-file, `import`/`export`, service worker, needs to be
  served over `http://` or `https://` (Live Server, `python3 -m http.server`, GitHub
  Pages, etc.). Optimized for "only touch the file that changed."
- **Ship (not built yet):** a single self-contained `.html` file, no server, no
  service worker, no ES modules — opens from a double-click on a completely offline
  machine, same shape as the earlier Gravimetric Worksheet and Data File Explorer
  tools. Built from this tree by a bundling step when we're ready to distribute.

Decision log: a PWA was ruled out as the *shipping* format because its entire value
(install prompt, offline-after-first-load) depends on an initial visit over a real
server, which an offline customer site can never provide. It's kept here purely as
the development environment, because serving over `localhost` gives real ES modules,
real service worker behavior, and a real browser DevTools loop — better dev ergonomics
than any file:// workflow.

## File map — what each file is responsible for

| File | Responsibility | Touch it when... |
|---|---|---|
| `src/core/dataFile.js` | Parses `.DAT` file text into structured header/analog/count arrays. Plain `class DataFile`, loaded as a classic script (not a module) so it attaches to `window`. | The `.DAT` file format changes, or a new file variant needs support (e.g. a new sensor type). |
| `src/core/cyclicCompanionFile.js` | Parses a cyclic test's "-Cyclic.DAT" companion file (ISO 23369 only, so far) — a structurally different format (no HEADER/DATA markers) sampled much faster than the primary file. Sibling class to `DataFile`, not merged into it; `alignToPrimary(primaryDf)` shares the primary file's time-zero reference. | The companion-file format changes, or a future standard needs the same "second file" pattern (see CLAUDE.md's `.DAT` file handling section for the template). |
| `src/helpers/units.js` | Converts canonical (SI) values to a display system (SI/US) and back. Values are stored canonical always; conversion happens only at render time and when a user override is entered/read back. | A new convertible quantity is needed (e.g. temperature is already wired; flow rate isn't yet), or a conversion factor needs correcting. |
| `src/helpers/analysisMath.js` | Generic, standard-agnostic numeric helpers (linear interpolation, crossing-time, elapsed formatting). Classic script (`window.AnalysisMath`). No native JS equivalents for most of these. | A shared numeric primitive is needed by more than one standard's analysis. |
| `src/core/machineProfiles.js` | Data table, one row per machine needing special handling, keyed by the file's `SerialNumber` (the Bonavista project designation). Deliberately empty until real legacy-fleet data is confirmed. | Adding a machine-specific override — should be a small diff, not a new file. |
| `src/core/machineProfile.js` | Applies a profile's channel corrections (fixes mis-recorded raw data, pre-analysis) and custom defaults (fills the store's Custom Default tier, post-mapping). Two different problems, kept in one file because both are "things a profile does." | The correction/default application logic itself changes — not for adding a new machine, that's `machineProfiles.js`. |
| `src/core/controlTargetCheck.js` | Standard-agnostic engine that checks a file's analog channels against a per-standard tolerance rule table (the tables live in each standard's folder). | The tolerance-checking mechanism changes (not the rules themselves). |
| `src/report/reportValueStore.js` | The resolution rule: User Entry → Custom Default → From Data → null. Knows nothing about .DAT files, units, or report content. | Rarely — this is the most stable file in the project. |
| `src/report/reportPages.js` | Aggregator only — imports and concatenates every standard's own `*Pages.js` (e.g. `src/standards/iso454812/iso454812Pages.js`). Adding a page is one entry in that standard's own `*Pages.js` file plus one template file — see the README section above. | Adding a new standard's page list to the aggregation (rare); page-list content itself lives in each standard's own file. |
| `src/core/charts/chartData.js` | Shapes `DataFile` output into `{labels, datasets}` — pure data, no chart library, no DOM. | Adding a new chart type, or changing what data feeds an existing one. |
| `src/core/charts/chartView.js` | The only file that knows Chart.js exists. Draws a `{labels, datasets}` object onto a canvas. Also owns chart instance lifecycle (`destroyChart`/`destroyChartsIn`) — call these before removing chart-bearing content from the page, or Chart.js's resize listeners leak. | Chart styling, legend behavior, swapping charting libraries, or lifecycle bugs. |
| `src/explorer/customTabs.js` | `CustomTabRegistry` — the list of user-created plot tab *definitions* (title + channels/sensor). File-independent on purpose: a definition stays meaningful across every `.DAT` file loaded afterward. Save/load as JSON, same explicit-file pattern as the report session. | The definition shape itself changes (a new plot type beyond channel-overlay / sensor-counts). |
| `src/explorer/customTabsView.js` | Turns registry definitions into actual chart tabs (`buildCustomTabDefs`) and provides the tab-creation modal (`openCreateTabDialog`). The only file that connects "a saved definition" to "a chart on screen." | The creation dialog's UI, or how a definition gets rendered. |
| `src/explorer/explorerAuditSteps.js` | Audit Trail content for the "Data File Explorer" entry (see the Audit Trail section below) — standard-agnostic, audits `dataFile.js`'s own raw parsing (analog/count column indices, row alignment) instead of a standard's calculations. Registered in `auditView.js`'s `AUDIT_STANDARDS` as a special `"explorer"` key. | What index relationships get verified, or how they're sampled/displayed. |
| `src/compare/compareFiles.js` | `CompareFileSet` — a second, independent set of loaded files for cross-file comparison. Never touches, and is never touched by, the single `currentDf` the Explorer/Report use. Also computes which channels/sizes are actually shared across the loaded set (`commonDimensions`). | Changing how files are labeled (currently "SerialNumber / FileName"), or what counts as a comparable dimension. |
| `src/compare/compareView.js` | The Compare Files view's outer shell: file shelf and dimension summary, then delegates to `compareTemplateView.js` for the actual report builder. | The file shelf or dimension-summary display. |
| `src/compare/compareTemplates.js` | `CompareTemplateRegistry` — the list of user-created comparison report *template* definitions (title, standard/sensor, pages of plot specs). File-set-independent on purpose, same "definition vs. loaded data" split as `customTabs.js`. Owns the auto-flow page layout (`retile`). Save/load as JSON, same explicit-file pattern as chart tabs. | The template/page/plot data shape itself changes, or the auto-flow layout rule changes. |
| `src/compare/compareTemplateView.js` | Turns registry templates into the toggle palette (channels/sizes/standard-derived curves) and the paginated, printable plot-grid preview. Runs a standard's own `run()`/`applyMapper()` (via an app.js-injected callback) for standard-derived curves — the only place Compare Files touches a standard's analysis engine. | The toggle palette's UI, the plot-grid/print layout, or which standard curves are offered. |
| `src/machineProfiles/machineProfilesStore.js` | Persists the user-editable Machine Profiles directory — `Record<serialNumber, record>` in one localStorage blob, no DOM. Distinct from `core/machineProfiles.js`'s hardcoded, developer-maintained legacy-fleet quirk table; this is the customer-facing one behind the Machine Profiles tab. | The persisted record shape, or the storage key/mechanism. |
| `src/machineProfiles/machineProfilesView.js` | Renders the Machine Profiles tab: rig list (`table.datatbl`) plus an inline add/edit form (not a modal — a persistent tab). Collects a rig's raw fields only; turning them into a specific standard's report text is that standard's own mapper's job (e.g. `iso16889Mapper.js`'s `buildMachineProfileDefaults`), per CLAUDE.md. | The list/form UI itself, not what a saved profile means to any given standard. |
| `src/audit/auditView.js` | Generic renderer for the (hidden, developer-only) Audit Trail view — see its own section below. Imports each active standard's own `<id>AuditSteps.js` directly (`buildAuditSteps(analysis, df, store)`) and renders whatever step list comes back: formula, inputs, output, a data table OR a `customBody` live element (see `auditWidgets.js`), an optional note. No file-load control of its own — reads `store.getExtra("sourceAnalysis")`/`("sourceDf")`/`("controlResults")`, the same mechanism reportView.js's report-figure chart builders already use. | The step-card/table layout or rendering mechanism itself changes (not a standard's own narration — that's its `<id>AuditSteps.js`, one per standard, never shared, per CLAUDE.md). |
| `src/audit/auditSampling.js` | Generic row/column sampling MACHINERY for a standard's `AuditSteps.js` — `sampleTable`/`sampleWideTable` pick which rows (1st/2nd/last) and, for wide per-size tables, which size columns (1st/middle/last) to show out of a larger set, plus a "showing N of M" disclosure note. No opinion on what a row means or which standard it's from, so shared across all four, per CLAUDE.md's helpers-may-be-shared rule. Pure data-in/data-out (Node-runnable, has its own selfcheck) — no DOM. | The sampling RULE itself changes (which indices, how many, how labeled) — never a specific standard's table content. |
| `src/audit/auditWidgets.js` | Generic INTERACTIVE presentation MACHINERY for a standard's `AuditSteps.js` — DOM-building, unlike `auditSampling.js`. `buildSizePickerTable` returns a live `<select>` + table widget (all rows shown, one size column re-rendered on selection) for a step to supply as `customBody`. No opinion on content, shared across standards the same way. Deliberately does NOT import from `auditView.js` (would be circular, since `auditView.js` imports each standard's `buildAuditSteps`). | The widget's own behavior (what it re-renders on selection, its DOM shape) changes — never a specific standard's use of it. |
| `src/explorer/explorerView.js` | Renders a parsed `DataFile` OR a standalone `CyclicCompanionFile` as tabs/tables — one `isCyclicCompanion` (`instanceof`) branch point swaps in a single flat "Cyclic Data" tab instead of the normal header/LB/LS/LBE tab set; every other rendering function is generic enough to serve either. Pure rendering — no parsing logic. | The Data File Explorer's tab/table display needs to change. |
| `src/report/reportView.js` | Fetches report page templates, fills `data-slot`/`data-label` hooks from the store, converts unit-bearing values via `helpers/units.js`, and renders every page of a standard in one scroll. | The template-filling or unit-conversion mechanism itself changes (not template content — see below). |
| `templates/iso454812/iso454812_page1.html` | Page 1's markup. Plain HTML with `data-slot="id"` hooks, no logic. Sibling files (page2, figures) live alongside. | Report layout, wording, or which fields appear on that page changes. |
| `src/app.js` | Entry point. Wires the drop zone, view switch (Explorer/Report/Compare/Audit — the last one hidden, see below), the standard switcher, machine-profile pipeline hooks, save/load session, print, and unit-aware field overrides. | Adding a new view/tab, or changing the overall pipeline order. |
| `src/helpDialogView.js` | Static "How this app works" guide, opened from the sidebar's own "? Help" button — app-wide content, not owned by any one product, hence living at `src/` top level rather than inside `report/`/`explorer/`/etc. | The guide's own copy/section list. |
| `css/app.css` | All styling, shared across every view. | Visual changes. |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | PWA plumbing — install prompt, offline caching. **Dev/optional-hosting only**, not part of the shipping product. Bump `CACHE_NAME` in `service-worker.js` whenever any precached file changes. | Rarely, and only relevant if actually hosting this tree somewhere (GitHub Pages, etc.) rather than bundling it. |

The dependency direction only runs one way: `app.js` depends on everything;
`reportValueStore.js` depends on nothing. If you're ever unsure which file to edit,
ask "which of these boxes does my change belong to" — the boundaries were drawn so
each answer is unambiguous.

## Running it

```
cd pwa
python3 -m http.server 8000        # or: npx serve .   or: VS Code Live Server
```
Open `http://localhost:8000`. Opening `index.html` directly (`file://`) will not
work — ES modules and the service worker both require a real server, even a local one.

## The edit-test loop, and its one gotcha

Save a file, the browser (or Live Server) reloads, you see the change. The one thing
that breaks this: **the service worker caches what it fetched, and can hand back a
stale version instead of your edit.** If a change stops appearing, this is almost
always why. Two fixes, pick one per DevTools session:

- DevTools → Application → Service Workers → check **"Update on reload"** (cleanest).
- Or comment out `navigator.serviceWorker.register(...)` at the bottom of `app.js`
  while iterating quickly, uncomment when you want to test real offline behavior.

## Worked example: adding a second report page (e.g. a new standard's Page 2)

The mechanism for this is real now, not hypothetical — see any multi-page standard
(`src/standards/iso454812/`, `src/standards/iso19438/`) for a working example:

1. **`templates/<standardId>/<standardId>_page2.html`** — new markup file, same
   `data-slot` pattern as page 1. No script tags, no logic.
2. **`src/standards/<standardId>/<standardId>Pages.js`** — add the page-2 entry.
   That's the whole registration step; `src/report/reportPages.js` just aggregates
   it automatically.
3. **`src/standards/<standardId>/<standardId>Mapper.js`** — add any new field IDs
   page 2 needs that page 1 didn't. If the data's already in `analysis`, this is just
   another `store.setFromData(...)` line. If a value has a unit, pass it as the third
   argument (see the units note below) so SI/US conversion works automatically.
4. Nothing in `app.js`, `reportView.js`, or `index.html` needs to change — the page
   switcher already iterates `REPORT_PAGES`.

Nothing in `dataFile.js`, that standard's own `Analysis.js`, or `reportValueStore.js`
should need to change for this — that's the architecture doing its job. If adding a
report page ever forces an edit to one of those three, that's worth pausing on, since
it usually means a responsibility boundary was drawn in the wrong place.

## Units — how to make a new field unit-aware

Store the raw canonical number with its canonical unit, don't pre-format a string:
```js
store.setFromData("someField", 42.2, "kPa");   // not store.setFromData("someField", "42.2")
```
`reportView.js` converts to the selected display system and formats at render time.
Currently wired: `kPa`↔`PSI` (pressure), `°C`↔`°F` (temperature, defined but not yet
used by any mapped field). Adding a new convertible quantity means one entry each in
`units.js`'s `UNIT_QUANTITY`, `SYSTEM_UNIT`, and `CONVERTERS` tables. A field with no
unit argument is treated as plain text/already-formatted and passed through unchanged
— that's the right choice for things like `terminationTime` ("0:26:22") that aren't a
raw convertible number.

## Two path-resolution gotchas worth knowing (both cost real debugging time)

- **`import`/`export` specifiers resolve relative to the *importing file's own
  location***. `src/report/reportView.js` importing `../helpers/units.js` reaches
  `src/helpers/units.js` — the `../` climbs out of `report/`, then down into `helpers/`.
- **`fetch()` and `serviceWorker.register()` resolve relative to the *document's*
  location** (`index.html`, i.e. the project root) — a completely different rule.
  A template URL in `reportPages.js` should be written `"./templates/foo.html"`,
  not `"../../templates/foo.html"`, even though `reportPages.js` itself lives two
  directories deep. Getting this backwards stays invisible when testing from a
  server root (extra `../` segments get silently clamped at the root) and only
  breaks once actually deployed under a subpath, like GitHub Pages'
  `username.github.io/reponame/`. Test against a subpath before trusting a fetch
  path, not just against `localhost:8000/`.

## Charts: the CDN dependency and the offline bundle

`index.html` currently loads Chart.js from cdnjs for development convenience. That
**will not work** in the eventual offline single-file build — vendor the actual
`chart.umd.min.js` source and inline/concatenate it like every other module, the
same way the bundler will handle everything else. Noted in `chartView.js` too, so
it's not just here.

## Custom plot tabs — persistence and lifecycle

There is no longer a separate "Charts" view. `chartData.js`/`chartView.js` used to
feed one dropdown-driven canvas; they now feed `customTabsView.js`, which puts N
user-defined plot tabs directly in the Explorer view's own tab bar, alongside
Header/Analog Data/etc. Each tab remembers what to plot (channel names or a sensor
key), not any particular file's data — loading a new file redraws every existing tab
against the new data and stays on whichever tab was active. A channel a tab expects
but the current file doesn't have is reported, not fatal; the rest of the tab's
series still render.

**Chart lifecycle rule:** Chart.js instances must be explicitly `destroy()`ed before
their canvas is removed from the page, or a window resize listener leaks. Two call
sites handle this: `explorerView.js` calls a tab's own `cleanup()` hook when switching
away from it (within one render), and `app.js`'s `rerenderExplorer()` calls
`destroyChartsIn()` on the whole container before any full re-render (new file, tab
added/removed). If you add a third place that removes chart-bearing DOM, it needs the
same treatment.

## Compare Files — a second, independent set of loaded files

`compareFiles.js` / `compareView.js` let you load several `.DAT` files side by side.
`compareTemplates.js` / `compareTemplateView.js` build **custom, printable, multi-page
comparison report templates** on top of that set: toggle channels, particle-size
groups (up to 3, combined onto one plot), or a standard's own size-indexed curve
(e.g. ISO 16889's beta vs. size) on and off, and each toggle adds/removes a plot,
auto-flowing across 2-or-4-plot pages (`compareTemplates.js`'s `retile`). A template
is a saved, reusable *shape* — save/load as `compare_templates.json`, same explicit-file
pattern as chart tabs — replayable against a completely different file set later.
Deliberately separate from everything else:

- **Mostly not the report pipeline** — but not fully isolated from it either.
  Channel/size plots never touch any standard: loading a file here only parses it and
  applies machine profile channel corrections (so a legacy rig's data is still correct
  when compared). Standard-derived plots DO run that standard's own
  `run()`/`applyMapper()` — read-only, into a throwaway `ReportValueStore` — but
  never write into the main Explorer/Report's `currentDf`/`store`/`currentAnalysis`.
  A single PLOT always resolves against exactly one standard for every loaded file
  (no per-file standard mixing WITHIN one curve), but a template can freely hold
  curves from several DIFFERENT standards side by side — each `standardPlot` spec
  carries its own `standardId`/sensor (see `compareTemplates.js`'s header note) —
  per the user's own call.
  **Each standard offers every curve its own report draws**, not just one — see
  `app.js`'s `STANDARD_CURVES` (β/efficiency vs. size, DP vs. time or injected mass,
  ISO 3968's P-Q sweep). A curve whose report figure draws one line PER PARTICLE
  SIZE (ISO 16889's β vs. % test time / vs. element ΔP) needs a size picked in the
  palette first (`multiSize: true` on its spec) — Compare shows one size's line per
  file, same "pick one, compare across files" shape the particle-size picker
  already uses for raw counts, not all ~16 sizes × every file at once.
- **Not custom tabs.** A custom tab is one definition redrawn against whichever
  single file happens to be loaded; a comparison template is pages of plots against a
  fixed set of specific files, regardless of what else is open. Different enough
  mental models that merging them would blur both.
- **Series use independent {x, y} points, not a shared labels array.** Different
  files have different record counts and (rarely) different `CountTime` intervals,
  so each file's elapsed time has to be its own axis, not indexed against one shared
  array the way same-file series can be. `renderComparisonChart` (linear x scale) is
  the counterpart to `renderChart` (categorical x scale, single-file only) — don't
  use one where the other's needed. The same shape serves a standard's curve too
  (x = particle size instead of elapsed time).
- **Labeling:** `"SerialNumber / FileName"` — a serial (really a Bonavista project
  designation, see `machineProfiles.js`) can have several test files against it, and
  a comparison set often spans more than one machine.
- **"Mass Added" is a derived channel, not a logged one.** `chartData.js`'s
  `computeMassAddedSeries` integrates the real `INJ_Rate` channel (trapezoidal,
  against the file's own elapsed time) times the header `GravimetricLevel`,
  standard-agnostic (all three multipass standards' own scalar mass figures use the
  identical inputs). Modeled as a synthetic `{kind:"channel"}` spec
  (`MASS_ADDED_CHANNEL_TAG`) so it rides the existing channel toggle/save/reload
  path with no new plumbing — appears in the Channels row alongside real ones
  wherever a file has both ingredients, with no standard-type gating (checked
  against a real ISO 3968 fixture: the rig logs both fields unconditionally
  regardless of test type, so there's no reliable data-only signal to gate on, and
  no other channel here is gated by standard either).
- **Scope, deliberately limited for now:** no drag-and-drop plot reordering (toggle
  order only); no per-file mixed standards within a single curve (a beta-vs-size
  plot's files are all analyzed under the same standard+sensor — mixing standards
  across DIFFERENT plots in one template is supported, see above).

## Audit Trail — hidden, developer-only derivation view

`src/audit/auditView.js` renders a step-by-step derivation of whatever file is
currently loaded — termination detection, every averaging window, every formula
substitution — for checking a standard's own math against its published clause text.
Deliberately **not** in the visible nav: no customer writing a report should ever
see it.

- **Reveal it**: Ctrl+Alt+Shift+Click the sidebar's status text ("No file loaded" /
  the current filename) — the pattern already used elsewhere for hidden dev
  buttons. Deliberately **not** persisted anywhere (no localStorage/
  sessionStorage) — per the user, the reveal must not carry over to a new
  instance of the program, so every fresh load starts hidden again and needs the
  gesture repeated; `"audit"` is excluded from the last-view-restore key
  (`webreportwriter-last-view`) for the same reason, so a reload can't silently
  land back on the audit view/content either, even with the button hidden.
  No URL parameter is involved on purpose — nothing to guess or bookmark that
  would advertise the feature's existence.
- **Its own switcher, `#auditSwitch`** (per the user, 2026-08-12), expands under
  "Audit Trail" the same way `#standardSwitch` expands under "Standard Report" —
  but deliberately a SEPARATE element/state (`app.js`'s `auditSelectedId`/
  `effectiveAuditId()`), not a re-skin of `#standardSwitch`: it lists only what's
  actually auditable (the 4 active standards, auto-excluding the frozen ISO 16889
  Legacy that `#standardSwitch` still offers for Report) plus a 5th, non-standard
  entry, "Data File Explorer" (see below). Picking one of the 4 real standards
  calls the exact same `selectStandard(id)` `#standardSwitch` uses — full
  re-analysis, tare prompts, both switchers' highlighted button kept in sync,
  reachable without detouring through Report first. Picking "Data File Explorer"
  only changes what the Audit view itself shows — `currentStandardId` (and
  therefore Report/Explorer) is untouched.
- **"Data File Explorer" — a standard-agnostic audit of `dataFile.js`'s own raw
  parsing** (per the user, 2026-08-12), not a standard's calculations: verifies the
  THREE index relationships every standard's engine depends on but never checks
  itself — analog columns (`analogTags[i]` ↔ `analog[row][i+1]`, offset by the
  leading timestamp field), count columns (`<sensor>Sizes[i]` ↔
  `<sensor-array>[row][i]`, NO offset — count rows carry no timestamp, the OPPOSITE
  convention on a superficially similar row shape), and row alignment (every
  per-record array — analog/lbu/lbd/[lsu,lsd|lbe]/times — must end up the same
  length). New `src/explorer/explorerAuditSteps.js` (own product folder, like every
  other product's audit content — not `src/audit/`, which stays generic/
  standard-agnostic machinery only), registered as a special `"explorer"` key in
  `auditView.js`'s `AUDIT_STANDARDS` (skips the control-target section — not a real
  standard — and its raw dump is the parsed `DataFile`, not an analysis object).
- **No separate pipeline.** It reads `store.getExtra("sourceAnalysis")`/
  `("sourceDf")`/`("controlResults")` — exactly what `runAnalysisPipeline`
  (app.js) already stashes for the report-figure charts to use — so opening it
  never re-parses or re-analyzes anything; it just narrates whatever the normal
  Explorer/Report flow already computed.
- **A "Test file" identity section at the very top** (per the user, 2026-08-11) —
  file name, test date/time, operator, read straight off `df`'s header
  (`df.fileName`/`df.fileDate` are DataFile's own parsed convenience properties;
  TestTime/Operator read directly via `df.getHeaderValue`, confirmed-common keys
  every standard's own Mapper.js already reads the same way). Rendered once in
  `auditView.js` itself (`buildFileIdentitySection`), not duplicated per standard —
  unlike everything else in the trail, this genuinely has no standard-specific
  content, so it isn't part of any `<id>AuditSteps.js`.
- **"Save as JSON" button on the raw analysis dump** (per the user, 2026-08-12) —
  downloads the exact same object the `<pre>` block shows, named
  `<fileName>_<standardId>_raw-analysis.json` (the header's own self-recorded
  `FileName`, same convention the "Test file" section uses, not the uploaded
  filesystem name — those can differ). `auditView.js`'s own tiny `download`
  mechanic, duplicated from app.js's identical-purpose helper rather than
  imported (no dependency between the two files in either direction — app.js
  imports `renderAuditPage` FROM here).
- **Per-standard content, generic rendering** — same split as everything else in
  this codebase: `auditView.js` only knows how to lay out a step (title, clause,
  formula, inputs, output, a data table, a note); each standard's own
  `<id>AuditSteps.js` (`src/standards/<id>/`) supplies WHAT those steps say,
  walking that standard's own `analysis.*` fields in the order its own clauses
  build on each other. Never shared between standards, per CLAUDE.md, even though
  one `auditView.js` renders all four.
- **Interpolation transparency**: every interpolated result shows the actual two
  bracketing measured points it was computed from, not just the final answer —
  termination detection and the %-net-ΔP milestones show `{before,after}` (via
  `AnalysisMath.findCrossingBracket`, exposed as `analysis.terminationBracket` /
  each milestone's own `.bracket`); Size_At_Beta_x / micrometer & filter ratings
  show `{lowerSize,lowerBeta/Eff,upperSize,upperBeta/Eff}` (via each engine's own
  public `sizeGivenBetaDetail`/`sizeGivenEfficiencyDetail` static, called directly
  from that standard's `AuditSteps.js`). All additive — the existing
  `_sizeGivenBeta`/`_sizeGivenEfficiency`/termination fields now just delegate to
  the richer version, zero behavior change, verified via the fidelity snapshots.
- **Representative sampling, not a full dump**, for the large per-size/per-clump/
  per-bucket/per-point tables — `src/audit/auditSampling.js`'s `sampleTable`/
  `sampleWideTable` pick 1st/2nd/last rows (proves a rule holds across consecutive
  windows) and, for "wide" tables with one column per size, ALSO 1st/middle/last
  size columns (proves indexing is correct across the full range) — e.g. ISO
  16889's 10-clump × 32-size table becomes 3 rows × 3 columns, clearly labeled,
  with a "showing N of M" disclosure. Generic sampling MACHINERY (which indices,
  what label) shared across every standard's `AuditSteps.js`, same as any other
  standard-agnostic helper — never the tables' own content. Full, un-sampled data
  always stays in the raw JSON dump below.
- **Screen-only hover tooltips** on table cells (a native `title` attribute — no
  popover component, no print output, per the user: it's fine if this doesn't
  work on paper) — ISO 16889's β ratio table is the first consumer: hovering a β
  cell shows every count-cycle row's raw up/down counts that were actually summed
  into it, not just the aggregate. Needed `analysis.clumps[k].countRows` added to
  the engine (`iso16889Analysis.js`, additive — a second, trivial pass over the
  same [startRow,endRow] window the sum/average loop already computes, not a
  change to that loop itself).
- **The 10 reporting-time TIMESTAMPS get their own step**, separate from the β
  calculation (per the user) — ISO 16889 has TWO distinct time references per
  clump, not one: the exact `(k/10) × terminationTime` reporting time (what
  assembly ΔP is interpolated at) vs. the whole-minute-rounded count-averaging
  window (12.5) that β is actually summed over. Shown in full (all 10 rows, not
  sampled) — the whole point is watching the rule hold across the progression.
- **The β-per-clump table itself reversed the sampling choice** (per the user,
  2026-08-11): it now shows all 10 clumps with an INTERACTIVE size-picker dropdown
  (defaulted to the smallest measured size) instead of a static 3-row x 3-size
  sample — `src/audit/auditWidgets.js`'s `buildSizePickerTable`, new generic
  DOM-building machinery (unlike `auditSampling.js`'s pure-data helpers) shared the
  same way, just with live re-rendering on selection change; the hover-tooltip
  detail above stays wired to whichever size is currently selected. A step
  supplies this via a new `customBody: HTMLElement` field (`auditView.js`'s
  `buildStepEl` renders it in place of a plain `table`) — content built directly
  with DOM APIs inside that standard's own `AuditSteps.js`, no import from
  `auditView.js` needed (avoids the exact circular-import shape `auditSampling.js`
  was already split out to avoid).
- **ISO 4548-12 and ISO 19438 got the same treatment** (per the user, 2026-08-11):
  a "Bucket window selection" step (own copy per standard, but the same fixed
  clock-grid mechanism — bucketMinutes 5/10, anchored at test start, disregard
  period shortens the first bucket rather than shifting the grid, no shared
  boundary rows between buckets) shown in full, plus the time-bucket efficiency
  table reversed the same way ISO 16889's was — all buckets, `buildSizePickerTable`
  size picker, hover tooltips built from a new `analysis.buckets[i].countRows`
  field (`_computeOneWindow`, additive, own copy per engine — same pattern as
  ISO 16889's `clumps[k].countRows`).
- Narrates whatever each analysis engine already exposes plus the additive detail
  above — most standards already carry per-window upstream/downstream/efficiency
  arrays, not just final numbers.
- **Printable** via its own `printAuditBtn` toolbar button — no Chart.js canvases
  on this view (unlike Report/Compare), so none of their JS-timing print problems
  apply; plain HTML tables shrink their own columns to fit the page on their own.
  The widest tables (ISO 16889's 10-clump table, ~20 size columns) can still clip
  a few of the largest sizes at the page's right edge at print time — a known,
  accepted limitation for this hidden dev tool, not worth fighting further unless
  it actually gets in someone's way (the on-screen version always has the full
  data via horizontal scroll).
- Verify it end-to-end: `node tools/render-check/audit-view-check.js` (Playwright,
  drives the real reveal gesture + a real file load + a standard switch) and
  `node tools/render-check/pdf-audit.js` (a REAL print PDF, not emulated media).

## Fidelity tests — catching an analysis regression before it ships

Each active standard's `<id>Analysis.selfcheck.js` (same directory as the engine it
tests, same `node <file>.js`, no-framework convention `iso3968Analysis.selfcheck.js`
originally established) now does two things, not just hand-written assertions:

1. **Hand-verified formula/invariant spot checks** — re-derive a value independently
   (e.g. β = upstream/downstream, clamped) and confirm the engine's own result
   matches, specifically targeting calculations with a documented past-bug history
   (ISO 4548-12's `_computeOneWindow` off-by-one, its gravimetric 1000x unit bug).
2. **A snapshot diff against a committed baseline**
   (`tools/render-check/fidelity-snapshots/<standardId>.snapshot.json`, via the
   shared `tools/render-check/fidelitySnapshot.js` helper) — catches drift in ANY
   derived field, not just ones someone remembered to hand-assert on. A snapshot
   only changes when a developer deliberately re-runs with `UPDATE_SNAPSHOTS=1` and
   reviews/commits the result — that's the actual "did fidelity change by mistake"
   gate this exists for.

Each check also runs that standard's own mapper (`applyParsedFile`) into a
throwaway `ReportValueStore`, not just the raw analysis engine — ISO 4548-12 and
ISO 19438 both compute `dpElementClean`/`dpFinalNet` in their MAPPER, not their
engine, so a test that only touched `analysis.*` would never exercise those fields.

**Run them all**: `node tools/render-check/run-all-selfchecks.js` (one consolidated
pass/fail summary; also runs `compareTemplates.selfcheck.js` and
`src/audit/auditSampling.selfcheck.js`). Run this whenever touching a standard's
`Analysis.js` or `Mapper.js` — it's the fastest way to know whether a change
actually altered a real report number.

## Two real bugs found and fixed while building the above (worth knowing about)

- **Count-row off-by-one in `buildCountsDataset`.** Copied the analog-row pattern
  ("+1, field 0 is the timestamp") into the count-row function without checking
  whether it applied — it doesn't; count rows carry no timestamp field at all
  (verified: a file with 32 declared sizes has count rows exactly 32 fields wide).
  Every size's plotted line was silently showing the *next* size's data, and the
  last size plotted as nothing. Fixed; verified against raw parsed values, not just
  that the chart "looked plausible." Affected the sensor-counts-overlay option in
  custom plot tabs; did not affect the Explorer's own tables (that code never made
  the same assumption) or the parser.
- **`fetch()`/`serviceWorker.register()` vs. `import` path resolution** (from an
  earlier round, worth restating here since it's the same *class* of mistake as
  above — an assumption carried from one function into a superficially similar one
  without re-checking it holds). See "Two path-resolution gotchas" above.

## Internal testing distribution — LAN, not the public web

Before the offline single-file "ship" build below exists, coworkers can still test
this dev tree without any public hosting. A plain network file share (opening
`index.html` from a mapped drive, double-click) does **not** work, same as "Running
it" above says about `file://` — ES modules and the service worker both need a real
HTTP origin, and a UNC/mapped-drive path is still `file://` to the browser. Two
scripts cover the two things "internal distribution" can mean:

- **`tools/serve-local.ps1 [port]`** — for a real, *installed* PWA. Run it on the
  tester's own machine (right-click > Run with PowerShell, or
  `powershell -ExecutionPolicy Bypass -File tools\serve-local.ps1`); it opens the
  default browser at `http://localhost:8000`. Because that's literally `localhost`,
  the browser treats it as a secure context, so Chrome/Edge's real install
  affordance (address-bar icon, or menu > "Install WebReportWriter…") appears —
  each coworker gets their own local install: a standalone window, a Start Menu
  entry, and (per `service-worker.js`'s cache-first strategy) a fully working
  offline app once installed, no server needing to stay running afterward. Pure
  PowerShell (`System.Net.HttpListener`), no Node/Python required on the tester's
  machine — copy the tree over, run the script once, install, done. To push an
  update later: bump `CACHE_NAME` (as always), then have the tester re-run the
  script and relaunch the installed app once while it's running so the service
  worker's update check (`updateViaCache: "none"`) can see the new files.
- **`node tools/serve-lan.js [port]`** — for quick shared access with no install,
  e.g. letting several people poke at one running instance. Same static-file-server
  shape as `render-check/pdf-report.js`'s own throwaway server, bound to every
  network interface instead of localhost-only. Prints every LAN address to hand out.
  **Caveat:** a LAN IP/hostname over plain `http://` is NOT a secure context, so it
  will never show an install prompt or register the service worker — the app still
  works fully (report generation, Explorer, Compare all function normally), it just
  stays a plain browser tab, not an installed app.

## Packaging for distribution

Not built yet — deferred until there's an actual customer deployment to target. The
plan: a small Node build script that concatenates the modules in dependency order
(stripping `import`/`export`, inlining the template HTML and CSS) into one `.html`
file with no server dependency, matching the Gravimetric Worksheet / Data File
Explorer shipping pattern. This tree is the source; that file will be the product.

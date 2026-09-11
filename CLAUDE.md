# CLAUDE.md — project conventions (read first)

This file is loaded into every session automatically. It is the authoritative statement
of how this project is organized and how to write code for it. **Follow it.** When a
change you make contradicts something here, update this file in the same change.

For dev-vs-ship format, how to run it, and the per-file responsibility map, see
`README.md`. For future work not yet scoped, `WISHLIST.md`. For what changed and when,
`CHANGELOG.md`.

## What this project is

A browser tool that turns filtration-test `.DAT` files into printable ISO test reports,
plus a data explorer and a cross-file comparer. Several ISO standards are supported, each
as its own self-contained module. Dev format is multi-file ES modules served over http;
the eventual shipping format is a single self-contained offline `.html` (see README).

## ISO 16889 — provenance note (historical; resolved)

`iso16889` used to be a DERIVATIVE of the legacy Excel/VBA "Bonavista" workbook —
carrying years of customer-specific one-off accretions, not a faithful rendering of
the published standard. That derivative was rebuilt clean against the published
standard text the same way ISO 4548-12/ISO 19438 were, moved aside to `iso16889legacy`
for a transition period, and — once the clean build had produced reports checked
against known-good output — **removed from the project entirely** (per the user,
2026-08-18): `src/standards/iso16889legacy/`, `templates/iso16889legacy/`, its sidebar
entry, and every aggregator reference. There is no legacy ISO 16889 build in this
tree anymore; `iso16889` is simply the standard, with no disambiguation needed.

One artifact worth remembering: `Size_At_Beta_x`'s reverse interpolation is log-linear
(linear in size, log in beta, matching the standard's own "straight-line segments on
the semi-log plot" description), a deliberate correctness fix made during the clean
rebuild — the old legacy engine used plain-linear interpolation on raw beta instead,
so a file's `Size_At_Beta_x` values from this engine can differ slightly from what
that removed engine used to report for the same file. The new one is correct.

## Project organization — the rule

There are three kinds of code here, and the lines between them are load-bearing:

- **Analysis PROCEDURES** — logic that encodes a standard's own decisions (termination
  detection, sensor selection, which setups are valid, how buckets are formed). These are
  **NEVER shared between standards.** Each standard owns its own copy, even when two
  standards' copies are currently identical. Duplicating a small analysis-directing
  function is CORRECT here — the cost of that duplication is far less than the cost of one
  standard's needs silently constraining another's. (This is why `testTermination.js` was
  deleted and its logic inlined into each `…Analysis.js`.)
- **Report CONTENT (per-standard rendering)** — what a standard's report *says*: which
  rows/figures/buckets/pages it contains, their order, labels, thresholds, and any
  standard-specific formatting. **Each standard's report is an independent document, and
  its content is NEVER shared between standards** — the same rule as analysis procedures,
  and it holds even though several standards' rendering blocks physically share
  `reportView.js` and `chartView.js`. A change made for one standard MUST NOT be able to
  alter another standard's output. Sharing content-rendering across standards to save
  duplication is the mistake that leads to chasing a fix back and forth between standards;
  don't.
- **Generic HELPERS** — stateless, standard-agnostic utilities that encode no standard's
  decisions (math primitives, unit conversion, and — for the report/chart side — a DOM
  table-builder, a slot-filler, an axis-tick formatter: machinery that renders whatever
  content it's handed). These MAY be shared. Standard-agnostic math/unit helpers live in
  `src/helpers/`; presentation machinery may live alongside the rendering it serves
  (`renderDPFigureChart`'s parameterization is the model — one drawing helper, each
  standard's own content passed in).

**The tail-chasing test** (apply on every reuse decision in the report/chart pass): a
shared change is legitimate ONLY if it changes *how arbitrary content is rendered*, never
*what a given standard's report says*. If you can't make the change without asking "but is
that correct for ISO 16889 specifically?", it belongs in that standard's own block, copied,
not shared. When in doubt, leave it duplicated.

Everything else follows from that, plus "each product gets its own folder."

## Folder map (authoritative)

```
src/
  app.js              entry point / wiring
  helpers/            generic, standard-agnostic utilities (units.js, analysisMath.js)
  core/               shared infrastructure — NOT per-standard procedures
    dataFile.js       the .DAT parser (single source of truth for the file format)
    charts/           chart data-shaping (chartData.js) + Chart.js rendering (chartView.js)
    machineProfile.js  machineProfiles.js  controlTargetCheck.js
  standards/<id>/     one fully self-contained standard: Analysis (termination inlined),
                      Mapper, Pages, control-target table, analysis notes, AuditSteps
                      (that standard's own audit-trail narration — see audit/ below)
  report/             Report Writer product (reportView, reportValueStore, reportPages,
                      customDefaults)
  explorer/           Data Explorer product (explorerView, customTabs, customTabsView)
  compare/            Compare Files product (compareFiles, compareView)
  machineProfiles/    Machine Profiles product — user-editable, per-rig custom defaults
                      (machineProfilesStore.js persists; machineProfilesView.js renders
                      the tab). Keyed by .DAT SerialNumber like core/machineProfile.js's
                      hardcoded quirk table, but a separate, customer-facing directory —
                      not the same file, not merged with it.
  audit/              Audit Trail product — HIDDEN, developer-only (auditView.js).
                      Generic step renderer only; each standard's own <id>AuditSteps.js
                      lives in that standard's own folder, not here (report content,
                      never shared — see the rule above)
templates/<id>/       each standard's report page HTML — kept at PROJECT ROOT because
                      fetch() resolves template URLs relative to the document, not to src/
```

**Placement test for a new file:** Does it encode a *standard's decisions*? → that
standard's folder. Is it a *product*? → that product's folder. Is it a *generic utility*?
→ `helpers/`. Is it *shared infrastructure* used across products but standard-agnostic? →
`core/`.

**When adding a standard, the full wiring checklist is 9 touchpoints, not 4** (a
gap found and closed 2026-08-20 while adding ISO 23369 — README used to list only
the first four below; the other five are just as real and just as easy to miss):

1. `report/reportPages.js` — import the standard's own `*Pages.js` + spread its
   array into `REPORT_PAGES`. **Skip this and the standard's engine/mapper both run
   fine while the Report view silently renders nothing** — `pagesForCurrentStandard()`
   filters `REPORT_PAGES` by `standardId`, so an unregistered standard just gets an
   empty page list, no error.
2. `app.js`'s `STANDARDS` object — new entry (`run`/`applyMapper`/`controlTargets`/
   `availableSensors`/etc.) + the import lines it needs. Include `isCompatible:
   (df) => window.<Id>Analysis.isCompatible(df)` — every standard's `Analysis.js`
   needs its own `static isCompatible(df)` (own copy per standard, reading that
   file's own already-private `VALID_TEST_TYPES`; see any existing standard's
   `Analysis.js` for the one-liner). Unlike #8 below, this one isn't a safe skip:
   `updateStandardCompatibility` (app.js) calls `STANDARDS[id].isCompatible(df)`
   unconditionally for every registered standard, so a missing entry throws the
   moment ANY file loads, not just quietly under-featuring the new standard.
3. `index.html` — a classic `<script src=".../<id>Analysis.js">` tag (before the
   Chart.js CDN tag) so `window.<Id>Analysis` exists before `app.js` runs.
4. `service-worker.js`'s `PRECACHE_URLS` — every new template + JS file, **and bump
   `CACHE_NAME` in the same change** (see "Service worker cache" below — this part
   is its own rule, easy to forget since it isn't literally a new list entry).
5. `index.html`'s **two separate** sidebar button groups — `#standardSwitch` (the
   report-view switcher) AND `#auditSwitch` (the Audit Trail's own switcher) each
   need their own new `<button>`. Missing one is easy not to notice: the standard
   still works, just isn't reachable from that one switcher.
6. `src/audit/auditView.js`'s **own separate** `AUDIT_STANDARDS` registry (import +
   entry) — a third per-standard registry, distinct from `STANDARDS` above, easy to
   forget precisely because it isn't one of the "big" aggregators.
7. `tools/render-check/run-all-selfchecks.js`'s `CHECKS` array — one relative path
   per new `*.selfcheck.js` file (a standard's `Analysis.selfcheck.js`, and any new
   parser-level selfcheck like `cyclicCompanionFile.selfcheck.js`).
8. `src/app.js`'s `STANDARD_CURVES` object — optional (Compare Files' curve
   enrichment); ISO 3968 shipped a long time with zero entries here, so skipping it
   is a legitimate, smaller diff, not an oversight.
9. `tools/render-check/fidelity-snapshots/<id>.snapshot.json` — never hand-created;
   auto-written the first time the new selfcheck runs, then needs a human
   review-before-commit pass.

Update `CHANGELOG.md` and this file (folder map / provenance notes as needed) in
the same change too — not a numbered wiring step, but the established convention
for a standard-sized addition or removal (see the ISO 19438 addition / ISO
16889-legacy removal entries in `CHANGELOG.md` for the level of detail expected).

## Code hygiene (for code you write here)

- **Collapsible regions.** Structure files into foldable sections with `//#region <name>`
  … `//#endregion` so a reader can collapse a file to an outline. Use them for the natural
  divisions (constants, each phase of a class, the export block).
- **Type-annotate with JSDoc.** This is a plain-JS project (no TS build step), but the
  editor type-checks JSDoc. Annotate fields, params, and returns —
  `/** @type {number|null} */`, `/** @param {DataFile} df @returns {boolean} */` — so the
  editor catches mismatches. Prefer this over untyped code.
- **Encapsulate; use properties for scope control.** Prefer private class fields (`#x`)
  with accessor properties (`get`/`set`) over public mutable fields. Expose only what
  callers need, through a property, so mutation/scope is controlled rather than everything
  being reachable and writable. (Some older classes predate this and use public fields;
  new code and substantial rewrites should follow the encapsulated pattern.)
- **A new `core/` file that's NOT IIFE-wrapped shares the real global lexical
  scope with every other non-wrapped classic `<script>`.** `dataFile.js` declares
  `class DataFile` at its own top level (no IIFE — it only ever exports that one
  name, so there's nothing to hide) — that makes `DataFile` a genuine global
  binding, not just a `window` property. A sibling `core/` file that also writes a
  top-level `const DataFile = ...` (even just to hold a reference to the same
  class for local convenience) collides with it — `Identifier 'DataFile' has
  already been declared`, thrown at page-load time, silently breaking the whole
  app (real incident, `cyclicCompanionFile.js`, 2026-08-20 — see
  `helpers/analysisMath.js`'s own header comment, which already warns about this
  exact trap for IIFE-wrapped files that destructure a shared global's members).
  If you need another file's top-level class/const by name, alias it
  (`const DataFileClass = ...`), don't reuse the original identifier.

These apply to NEW code and any file you substantially rewrite — don't churn untouched
files just to retrofit them.

## How to work — ponytail (lazy senior dev mode)

Adopted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail). Lazy
means efficient, not careless. The best code is the code never written.

**Precedence:** where ponytail's reuse bias (rung 2 below) meets this project's
between-standards independence rules — analysis PROCEDURES and report CONTENT are both
**never shared between standards** (see "Project organization — the rule") — **the
project rules win.** Duplicating a standard's analysis-directing logic or its report
content is the correct, deliberate choice here, not over-building; and in the report/chart
files, apply the "tail-chasing test" before treating any two standards' rendering as
shareable. Ponytail governs everything else.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's
   already here, don't re-write it. (Subject to the precedence note above.)
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and
the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the
function you touch and fix the shared function once — one guard there is a smaller diff
than one per caller, and patching only the path the ticket names leaves a sibling caller
still broken.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest
  change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size — lazy
  means less code, not the flimsier algorithm.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global
  lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming the ceiling and
  upgrade path.

Not lazy about: understanding the problem (read it fully and trace the real flow before
picking a rung — a small diff you don't understand is just laziness dressed up as
efficiency), input validation at trust boundaries, error handling that prevents data
loss, security, accessibility, the calibration real hardware needs (the platform is
never the spec ideal — a clock drifts, a sensor reads off), anything explicitly
requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE
runnable check behind, the smallest thing that fails if the logic breaks (an
assert-based demo/self-check or one small test file; no frameworks, no fixtures).
Trivial one-liners need no test.

**Each standard's `<id>Analysis.js` specifically also gets a snapshot check**, on
top of (not instead of) hand-verified assertions — see any `<id>Analysis.selfcheck.js`
for the pattern: run the engine against a real fixture file, diff the derived
fields against a committed baseline in `tools/render-check/fidelity-snapshots/`,
fail on ANY drift. Assertions alone only catch regressions someone thought to write
one for; a report-writing tool's whole job is producing the right NUMBERS, so
"did this edit silently change a number nobody was watching" is exactly the failure
mode worth a second, broader net for. `tools/render-check/fidelitySnapshot.js` is
the shared (standard-agnostic — a generic HELPER, may be shared per the rule above)
diff helper; `tools/render-check/run-all-selfchecks.js` runs every check in one
command. Run it after touching any standard's `Analysis.js`/`Mapper.js`.

## .DAT file handling

- **The `.DAT` format itself is NOT standard-specific.** It's a generic multipass-test
  data log — the same file format/control program produces the data for ISO 16889,
  ISO 4548-12, and ISO 19438 alike (confirmed by the user); they're all multipass
  testing standards, differing only in analysis/reporting, not in what the rig logs.
  A new standard's channel tags and header keys are therefore reasonable to START from
  an existing standard's already-confirmed ones (e.g. `TS_Rate`, `INJ_Rate`,
  `TS_Conductivity`) rather than guessed from nothing — but "same format" is not the
  same as "every specific key is confirmed present for this standard's own test
  configuration": still verify against a real file per the next bullet before
  trusting a value, especially for fields no other standard's mapper already reads
  (e.g. ISO 19438's sampling-system flow channels, still unconfirmed as of this
  writing).
- **`src/core/dataFile.js` is the single source of truth for the `.DAT` format.** All
  format knowledge — record shapes, header sections, sensor row order — lives there.
  Change format handling ONLY in that file; never re-derive parsing elsewhere.
- **Verify format assumptions against a real `.DAT` file — never guess.** Two real bugs in
  this project came from carrying an assumption from one function into a superficially
  similar one without re-checking it. Header keys, channel tags, and row layouts must be
  confirmed against actual file content.
- **Count rows carry NO leading timestamp field** (unlike analog rows). A file with N
  declared sizes has count rows exactly N fields wide. Do not copy the analog-row "field 0
  is the timestamp, so +1" indexing onto count rows. **N is the count of REAL sizes, which
  is not always `LBSizes`/`LSSizes`/`LBESizes`'s raw declared length** — confirmed real
  (`SpinOnCyclicMP.DAT`, `LBLBDataOnly.DAT`, found 2026-08-20 chasing a live user-reported
  "malformed row" false positive that dropped an entire otherwise-valid, ENDDATA-terminated
  file): some rigs pad that header row with a trailing literal `"0"` sentinel slot the count
  rows never actually carry a value for (`LBSizes,4,5,...,70,0` — 33 declared, 32 real per
  row). `dataFile.js`'s `stripTrailingZeroSizeSentinel` strips it at parse time so
  `lbSizes.length` etc. already reflect the real per-row width everywhere else in the file —
  don't re-derive N from the raw header value a second time elsewhere.
- **A row can also be WIDER than its declared tag/size count** (confirmed real, same
  fixtures: `SpinOnCyclicMP.DAT`'s analog rows are 24 fields wide against only 22 declared
  `;Data Format:` tags) — harmless (`getChannel` reads by index and never looks past what
  it needs), but the trailing-malformed-row truncation check in `dataFile.js` must treat
  "row is AT LEAST the expected width" as well-formed, not "row is EXACTLY the expected
  width" — an exact-match check misclassifies every row in a file with this quirk as
  malformed and can silently drop the entire data block. Only a row NARROWER than expected
  is genuinely truncated.
- **5-row record order is LBU, LSU, LBD, LSD** — grouped by up/down, not by sensor.
  Verified against real data (the wrong order yields physically-impossible beta < 1).
- **A cyclic-flow test (ISO 23369) writes a SECOND file, not covered by the "one
  `.DAT` file" assumption above.** The rig also produces a same-named `-Cyclic.DAT`
  companion, sampled far faster than the primary file — a structurally different
  format (no HEADER/ENDHEADER/DATA/ENDDATA markers at all) parsed by its own
  sibling class, `src/core/cyclicCompanionFile.js`, not by `DataFile`. If a future
  standard turns out to need a second file too, that file is the template to
  follow (own parser class, `alignToPrimary(primaryDf)` to share the primary
  file's time-zero reference via `DataFile`'s own exposed `startTimeDay`) — not
  ISO 3968's unrelated optional-tare-file mechanism (`app.js`'s `tareDf`/
  `tareEntryView.js`), which is a genuinely different case: fully optional, no
  time-alignment needed, its own independent `run()` pass.
- **A primary file's own first record is never at elapsed 0:00 — it lands after
  one full COUNT CYCLE has passed** (confirmed by the user, 2026-08-20): a
  record only gets written once a counting cycle completes, and ~99% of fielded
  machines run a 60-second count cycle, hence every real fixture's own first
  analog row sitting at 0:01:00, not 0:00:00. This is WHY a genuinely matching
  primary/companion pair's own timestamps land within about a minute of each
  other, not a coincidence of the 3 fixtures on hand — the basis for
  `cyclicCompanionFile.js`'s `PLAUSIBLE_START_OFFSET_SEC` mismatched-companion-
  file guard (real incident, 2026-08-20: a user attached test "-02"'s own
  companion file to test "-01"'s primary file — same-day, similarly-named,
  nothing else caught it). A file with an unusual (non-60s) count cycle would
  still land within roughly one cycle of its companion, so the guard's 10-minute
  threshold stays a safe, generous margin either way.

## Service worker cache

Whenever you change any file in `service-worker.js`'s `PRECACHE_URLS`, bump `CACHE_NAME`
(`webreportwriter-vN` → `vN+1`) in the same change and tell the user the new version. It is
the practical "did the browser actually get my change" marker; a stale cache serving old
files has repeatedly masked real edits during testing.

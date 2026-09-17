# Changelog

A curated, human-readable record of notable changes — "if you pulled a fresh copy,
here's what's different from the last one you might be holding." Not every edit gets
an entry: small tweaks, and the back-and-forth of getting one feature right, collapse
into a single entry for that feature. Commit-by-commit history is git's job once this
tree is in git (see the README); this file is the milestone layer above that.

Newest entry at the top. No semver — this project doesn't version formally.

## 2026-09-17 — Report field editability audit (all 5 standards)

Full field-by-field `data-editable` reclassification, deferred from the 2026-09-11
sidebar/pencil-edit redesign (see WISHLIST.md's now-resolved entry). The rule: any
field whose value comes FROM the .DAT file (a header or channel) or is CALCULATED
from values that are, is locked — overriding it would misrepresent what the rig
actually measured. Decided with the user across three genuine judgment calls before
implementing:

- **Administrative identity fields stay editable** even where header-sourced (Test
  Date, Operator, Element/Filter ID, Test ID, Project ID, Test Time) — correcting a
  misrecorded name/ID/date isn't the same risk as overriding a measured quantity.
- **Documented "estimate now, override later" fields stay editable** — Test Volume
  Final (all 4 particle-counting standards), and ISO 16889/23369's Injection System
  Volume Initial/Final and Base Upstream Gravimetric Level. Each mapper's own
  comments already say so explicitly (e.g. "no header of its own... still
  data-editable") — treated as a third exception class alongside the existing
  pressure (already locked, no UI) and gravimetric (dialog-routed) cases, not
  locked, since the codebase already built these as overridable estimates on
  purpose.
- **Calculated fields are locked outright**, including the two true gravimetric
  lab results' own downstream calculations: Non-Retained Mass (Mnr) and Retained
  Capacity (Cr) (ISO 4548-12/19438), and Injection Gravimetric Average (all 4
  particle-counting standards). Per the user: "editable fields that deal with
  calculations [should] push the user into the standard operation path" — a
  correction belongs in the real inputs (Injection Gravimetric Initial/Final,
  routed to the Add/Edit Gravimetrics dialog), which already auto-recompute these
  outputs, not a direct override of the output itself (today's bare `prompt()`
  path for these three could go silently stale on the next recompute anyway).

Free-text `comments` stays editable everywhere despite technically reading a
`Comments` .DAT header key in most standards — locking an annotation field would
defeat its purpose regardless of what that header happens to contain. ISO 19438's
`dilutionSensorType` is locked (a genuine live per-file derived value — which
sensor, LB or LS, the analysis selected); its `countingMethod` stays editable (a
hardcoded literal, "Online," with no real per-file data behind it either way).
ISO 3968's dozen bypass-valve/leak-rate fields (Page 2) are untouched — confirmed
zero .DAT concept of either exists anywhere in that standard's engine/mapper, so
these were never a lock candidate to begin with.

- Mechanically: `data-editable` attribute removed from the locked fields'
  `<span>`/`<td>` elements across all 5 standards' Page 1 templates (plus one
  `<span>` nested in a `<td>` for ISO 19438's Mnr/Cr). No code changes needed
  beyond the templates — `applyFieldEditButtons` and the pencil-click routing
  (`reportView.js`/`app.js`) both key purely off `[data-editable]` presence, so
  removing the attribute is sufficient on its own.
- Verified: full `run-all-selfchecks.js` and Playwright regression suite
  (`session-save-load-check.js`, `compare-templates-check.js`,
  `machine-profiles-save-load-check.js`, `audit-view-check.js`) all pass. A
  dedicated Playwright check confirmed the exact expected editable-field set for
  all 5 standards against real fixtures (including ISO 23369 with its companion
  file), spot-checking that locked/kept-editable fields land exactly as decided.
- Cache version it left the tree at: webreportwriter-v181

## 2026-09-17 — Empty leftover toolbars removed; Machine Profiles table scrolls

Fourth round of sidebar feedback, same day.

- **Removed three now-empty `.context-toolbar` divs** (`#context-explorer`,
  `#context-compare`, `#context-machineProfiles`) — leftover from the
  2026-09-11/17 rounds that relocated their buttons into the sidebar, they were
  never deleted, just emptied. `.toolbar`'s own card styling (padding/border/
  background) rendered them as a visible empty box above Explorer/Compare/
  Machine Profiles' content for no reason. Confirmed nothing referenced them by
  id anywhere before deleting outright (`showView`'s `.context-toolbar`
  querySelectorAll loop just does one fewer no-op iteration per removed mode).
  Relocated the still-relevant "merge, don't replace" doc comment for machine
  profile imports to sit next to the actual Save/Load buttons in the sidebar,
  rather than losing it.
- **Machine Profiles table now scrolls horizontally instead of clipping** — a
  rig with a full Counter/Sensor/LS/LBE summary plus Cal Method/Date can run
  wider than the content column. Wrapped in a new `.mp-table-wrap`
  (`overflow-x:auto`), the same pattern already established for the audit
  trail's own wide tables (`.audit-table-wrap`) and ISO 16889/23369's page-2
  rotated tables (`.w16889-p2-scroll`) — this table just hadn't gotten the same
  treatment yet.
- Verified: a Playwright check confirmed all three context-toolbar ids are
  genuinely gone from the DOM, and that `.mp-table-wrap` has `overflow-x:auto`
  around a table forced wider than its container by a long label. Full
  regression suite (`run-all-selfchecks.js`, `session-save-load-check.js`,
  `compare-templates-check.js`, `machine-profiles-save-load-check.js`,
  `audit-view-check.js`) still passes.
- Cache version it left the tree at: webreportwriter-v180

## 2026-09-17 — Sidebar polish round 2: disabled states, active-color consistency, scroll, one button style

Third round of feedback on the sidebar work.

- **Save Report disabled with no file loaded** — greyed out (`css/app.css`'s
  shared `button:disabled` treatment) rather than silently producing a
  near-empty session; `updateReportingControlsVisibility()` sets
  `saveBtn.disabled = !currentDf` and a "Load a file first" title.
- **Report content no longer pinned above the scroll.** `.content` (not `.view`)
  now owns the scrollbar — context-toolbar and view scroll together as one
  normal unit. This is NOT a return to the earlier `position:sticky` attempt
  that had a real, documented bug in this exact shell (see `app.css`'s own
  history note, preserved) — just letting go of the "pin chrome above scrolling
  content" idea entirely, since nothing left in a context-toolbar needs pinning
  now that Report Options/Print/Save/etc. all live in the always-visible
  sidebar.
- **Save/Load machine profiles buttons relocated to sidebar Actions**, shown
  only while on the Machine Profiles view — same gating pattern as
  Report/Compare/Explorer's own Actions buttons.
- **Disclosure toggle buttons (Configuration, Report Options, Report Logo,
  Units, Paper) now get `.active` styling while their panel is expanded** —
  reuses the exact same solid-accent treatment `showView` already gives
  "Standard Report" while Report is the active mode, via a new shared
  `wireDisclosureToggle` helper (`app.js`) replacing five near-identical
  one-line toggle handlers.
- **"Change Company Logo (filename)" → "Change Logo (filename)"** — shorter,
  fits the sidebar width better once a logo's already set.
- **One button style for the whole sidebar.** Previously a mix: File/Actions/
  About used a bordered white box that inverted to solid black on hover, while
  Mode/Configuration's nested items were already borderless with an accent-soft
  hover. Unified onto the borderless style everywhere — `.sidebar-group button`
  and `.sidebar-group.view-switch button` merged into one rule (`css/app.css`);
  `.active`/`.primary` both read as a permanent, border-free accent fill rather
  than reintroducing a border for emphasis.
- **Found along the way, fixed as found (both pre-existing, unrelated to this
  round's actual changes):** `tools/render-check/machine-profiles-save-load-check.js`
  never got updated when Machine Profiles moved under Configuration two rounds
  ago (2026-09-11) — it was clicking a nav button no longer visible without
  expanding Configuration first, silently never re-run since. Separately,
  `audit-view-check.js` asserted `#auditSwitch` shows "4 standards + Explorer"
  (5 buttons) — stale since ISO 23369 became the 5th standard; actual/correct
  count is 6. Both fixed; both dev-tooling-only, no shipped-app impact.
- Verified: full `run-all-selfchecks.js`, `session-save-load-check.js`,
  `compare-templates-check.js`, `machine-profiles-save-load-check.js`, and
  `audit-view-check.js` all pass. A one-off Playwright check confirmed
  Save Report's disabled↔enabled transition, Configuration's active background
  color literally matching Standard Report's (`rgb(47, 93, 138)` both), Machine
  Profiles' Actions buttons appearing correctly, and `.content`/`.view`'s
  overflow ownership swap.
- Cache version it left the tree at: webreportwriter-v179

## 2026-09-17 — Sidebar follow-up: Configuration as a real disclosure, Actions per-mode, About

Second round of internal feedback on the 2026-09-11 sidebar redesign below.

- **Configuration now mirrors Mode's own shape exactly**: Machine Profiles stays a
  direct-navigation button; Report Logo, Units, and Paper are each their OWN
  nested disclosure (same `.standard-switch` expand pattern, one level deeper),
  revealing their actual controls only once clicked — the same way `#standardSwitch`
  reveals standards under "Standard Report." Units/Paper are now one button per
  choice (`#unitsPanel`'s `[data-unit]`, `#paperPanel`'s `[data-paper]`) instead of
  a `<select>`.
- **The underlying `<select id="unitSelect">`/`<select id="paperSizeSelect">`
  elements were NOT removed** — kept as hidden state stores, driven by the new
  buttons via a small generic `wireButtonGroupToSelect` helper (`app.js`) that
  sets `.value` and dispatches a real `"change"` event. Every existing
  `byId("unitSelect").value` read (18+ call sites) and both selects' own
  `"change"` listeners keep working completely unchanged — only the visible
  control changed. `pdf-report.js`/`pdf-audit.js`/`pdf-compare.js`/
  `compare-templates-check.js` updated to click through the new buttons instead
  of Playwright's `selectOption` (which requires visibility — a hidden select
  would have silently no-op'd inside a `.catch()` in three of those four
  scripts). Verified: a generated A4 PDF's actual `/MediaBox` is 594.96×841.92pt,
  confirming the click-through genuinely reaches `applyPaperSize`, not a no-op.
- **Explorer's "Save/Load chart tabs" relocated to the sidebar Actions group**,
  shown only while Data File Explorer is the active mode — same mode-gating
  pattern `showView` already uses for Report's/Compare's own Actions buttons.
- **New "About" labeled group**: "About Me" renamed to "Help" (same dialog,
  same `helpBtn` id); new "Version Info" button opens a small dialog reading the
  live active Cache Storage entry name (`caches.keys()`) rather than a second,
  hand-maintained copy of `service-worker.js`'s `CACHE_NAME` — single source of
  truth, can't drift out of sync with the real bumped value the way a duplicated
  constant could.
- Verified: full `run-all-selfchecks.js` suite, `session-save-load-check.js`,
  `compare-templates-check.js` (including its updated Paper-reachability
  assertion) all pass; a one-off Playwright check confirmed the button-driven
  Units/Paper selection correctly propagates through to `document.body.dataset.paper`
  and the hidden selects' own values, exactly as a real `<select>` change would.
- Cache version it left the tree at: webreportwriter-v178

## 2026-09-11 — Sidebar redesign: File / Mode / Configuration, Report Options, pencil-edit

Internal team feedback pass. Restructures the sidebar into three consistently
labeled groups and replaces double-click-to-edit with a discoverable pencil icon.

- **Sidebar reorganized into File / Mode / Configuration** groups (each with the
  same uppercase label styling Units/Paper already used). Mode lists Standard
  Report, Data File Explorer, then Compare Files (now labeled BETA — still
  evolving). Machine Profiles moved out of Mode into a new Configuration
  disclosure (alongside Add Company Logo, Units, Paper), since it's a settings
  screen, not a report mode. `showView`'s active-button selector broadened from
  `.view-switch > button` to `button[data-view]` so this relocation doesn't break
  active-state tracking — confirmed `data-view` is a reliable global marker, never
  present on `#standardSwitch`/`#auditSwitch`'s own nested buttons.
- **"Load File" replaces separate "Load data file"/"Load session" controls** — one
  input (`.dat,.DAT,.json`), dispatched by extension in `app.js`'s `fileInput`
  change handler; `.csv`/`.txt`/`.sav` dropped (unneeded), legacy `.SAVE` files
  from older report-writer tools deliberately not addressed yet. `readFile`/
  `loadFileText`/`loadSessionData` themselves are unchanged — `loadFileText`
  unconditionally resets sensor/tare/companion/store state in ways a session
  restore must not do, so the two flows stay structurally separate underneath
  the one entry point.
- **New "Report Options" sidebar disclosure** (same expand-under-parent pattern
  as `#standardSwitch`) holds every per-standard report-shaping control formerly
  spread across the report toolbar: sensor/pressure-view pickers, display sizes,
  gravimetrics, count details, tare/companion file. Shown only once a file is
  loaded. Auto-collapses on leaving Report mode.
- **Print/Save relocated to the sidebar** ("Load File → Create Report → Print or
  Save Report" now visible as actual navigation) — Save Report (renamed from
  "Save session (.json)", id unchanged) and Print Report for the Standard Report
  flow, Save/Load comparison templates and Print for Compare Files. Mode-gated in
  `showView` exactly as they always were by their old `.context-toolbar` ancestor
  — relocation only, no visibility-rule change.
- **Double-click-to-edit replaced by a pencil (✎) icon** next to every editable
  report field, reusing the existing chart-axis-edit glyph idiom
  (`chartAxisControls.js`). New `applyFieldEditButtons` in `reportView.js`,
  idempotent and sibling-inserted like `applyControlWarningMarkers`. Gravimetric
  fields' pencil (`injectionGravInitial`/`injectionGravFinal`/`finalGravimetricGf`)
  now opens the existing Add/Edit Gravimetrics dialog instead of a bare prompt —
  fixes a real inconsistency where editing those fields inline skipped the
  dialog's `recomputeGravimetricDerived()`/warnings-count refresh. Every other
  editable field keeps the same prompt()-based override flow, just triggered by
  the pencil instead of a double-click.
- **Real bug fixed while wiring the pencil**: `fillSlots`' unit-relabeling read
  `el.nextElementSibling`, assuming it was always the `.unit` span — true only
  until something else (a `.field-warn` marker, now also a pencil button) gets
  inserted as a sibling, after which SI/US toggling silently stopped relabeling
  that field's unit text. This was already live for any control-target-linked
  unit field carrying a warning marker, not just newly introduced by this change.
  Fixed by scoping the lookup to the parent `.field`'s own `.unit` child instead.
- Verified: full `run-all-selfchecks.js` fidelity suite (unaffected, as expected —
  no analysis/mapper logic touched) plus `session-save-load-check.js` (updated for
  the consolidated file input and pencil-click edit, confirmed the field it
  exercises — `testLab` — isn't a gravimetric spec id) all pass; a one-off
  Playwright check confirmed a gravimetric field's pencil opens the dialog with no
  native `prompt()`, while a non-gravimetric field's pencil still does.
- Deferred, not part of this pass: a full field-by-field `data-editable`
  audit/lockdown; a "truncate report to an earlier termination point" editable
  field (needs its own analysis-engine design, not a display-only edit); loading
  legacy `.SAVE` files; any manual acknowledge/dismiss for control-target
  warnings.
- **Follow-up fix (same day, reported by the user from a real screenshot)**:
  `applyFieldEditButtons`' sibling-insertion assumed `[data-editable]` was always
  a `<span>`/`<div>` — true almost everywhere, but ISO 16889/23369's Injection
  System and Counting System tables put `[data-editable]` directly on a `<td>`.
  Inserting "afterend" there made the pencil a direct child of `<tr>`, an illegal
  table child the browser recovers from by inventing an anonymous cell — visible
  as stray boxes and shifted columns in exactly those two tables. Fixed by
  appending the button INSIDE the cell instead when the target is a `<td>`/`<th>`,
  safe under the same fillSlots-wipes-then-this-refills per-render ordering as
  the sibling case. Verified: a Playwright structural check confirms zero
  `<button>` elements land as direct `<tr>` children after the fix, plus a fresh
  screenshot of both tables and a full session-save-load-check.js re-run.
- Cache version it left the tree at: webreportwriter-v177

The practical "version" marker is `service-worker.js`'s `CACHE_NAME`. It's bumped
whenever a precached file changes (so a returning browser gets the update instead of a
stale cache), and it's the quickest way to answer "did I actually get this change" —
compare the cache name in DevTools → Application against the entry's stated version.
Each entry that changed a precached file records the cache version it left the tree at.

Format per entry:
```
## YYYY-MM-DD — short title
- What changed, in plain language, one bullet per notable thing.
- Call out anything that changes behavior a person might already be relying on
  (a bug fix that shifts displayed numbers, a removed view, a renamed file).
- Cache version it left the tree at, if a precached file changed: webreportwriter-vN
```

## 2026-09-09 — Internal Installation Guide (Word doc)

New `WebReportWriter - Internal Installation Guide.docx` at the project root, per
the user: a coworker-facing document covering what to include/exclude when copying
the tree for internal testing, step-by-step install instructions for
`serve-local.ps1`/`serve-lan.js` (see the entry below), a command reference, how to
push an update to an already-installed copy, and troubleshooting (execution policy,
port conflicts, no install icon, stuck-on-old-version, uninstalling). Not part of
the app itself — a standalone reference document, not precached, not linked from
`index.html`. States the app version it was written against
(webreportwriter-v175) in its own header; re-generate/update it if that drifts far
enough to matter.

## 2026-09-09 — Local install + LAN distribution for internal coworker testing

Per the user: ahead of the offline single-file "ship" build (still not built — see
"Packaging for distribution" below), coworkers need a way to test this dev tree
that isn't a public web host and isn't a raw network file share (which can't work —
same `file://` restriction on ES modules/service worker "Running it" already
documents). Two new dev-only scripts cover two different needs:

- **`tools/serve-local.ps1 [port]`** — the one that actually gets a REAL installed
  PWA: pure PowerShell (`System.Net.HttpListener`), no Node/Python needed on the
  tester's machine, bound strictly to `http://localhost:port` (no URL-ACL/admin
  elevation needed for that specific prefix). Because `localhost` is a secure
  context, Chrome/Edge's real install affordance shows up — each coworker installs
  their own local copy, which then runs fully offline via `service-worker.js`'s
  cache-first strategy with no server needing to keep running. Opens the default
  browser automatically once listening. Verified end-to-end (`index.html`,
  `manifest.webmanifest`, and an ES module all served with correct content-types).
- **`tools/serve-lan.js [port]`** — for quick shared access with no install (several
  people poking at one running instance). Same static-file-server shape as
  `render-check/pdf-report.js`'s own throwaway Playwright-test server, bound to
  every network interface instead of localhost-only. A LAN IP/hostname over plain
  `http://` is NOT a secure context, so this one never shows an install prompt or
  registers the service worker — the app still works fully, it just stays a plain
  browser tab.
- No new dependencies in either — both reuse the plain-static-server pattern
  already in this tree rather than pulling in `serve`/`http-server`.
- Documented in README.md ("Internal testing distribution — LAN, not the public
  web"). Neither script is precached / part of `PRECACHE_URLS` — they serve the
  tree, they aren't part of the tree being served. No cache version bump needed.

## 2026-09-09 — Machine Profiles now also fill ISO 23369 reports

Per the user: coincidence-limit/counter-identity fields apply to any particle-counting
report, not just ISO 16889 specifically — ISO 23369's Page 1 has the identical
`counterUpstream`/`counterDownstream`/`counterCalMethod`/`counterCalDate`/`testLab`
slots, so a saved rig profile should fill them there too.

- `app.js`'s `STANDARDS.iso23369` entry gained `machineProfileFields:
  buildIso23369MachineProfileDefaults`, imported from `iso23369Mapper.js` (that
  mapper already had its own `buildMachineProfileDefaults` copy, per CLAUDE.md —
  it just wasn't wired into the registry yet).
- ISO 4548-12 and ISO 19438 are unchanged — their Page 1 templates have no matching
  counter/sensor/cal fields. ISO 3968 has no particle counting at all.
- Updated the stale "iso16889 only for now" comments in `app.js`.
- Reworded the Machine Profiles tab's own hint text (`machineProfilesView.js`) to
  name the real split: counter details (identity/cal/location) propagate to the
  ISO 16889 and ISO 23369 report formats specifically (template-gated), while
  sensor coincidence limits apply to all standards that process particle counter
  data (iso16889/iso454812/iso19438/iso23369 alike — that lookup in `app.js` was
  already standard-agnostic, not gated by `machineProfileFields`).
- Cache version it left the tree at: webreportwriter-v175

## 2026-09-08/09 — Company logo (letterhead) on every report page

New feature, per the user: report preparers can now upload a company logo (PNG or
JPEG) that prints on every report page, across every standard, sized to fit without
stretching/deforming.

- New `src/report/companyLogoStore.js` — one global logo record (data URL + mime
  type + filename), persisted in localStorage. Global on purpose, not per-standard
  and not per-machine-profile: it's the installation's own letterhead, not report
  content any single standard owns.
- Upload/remove controls added to the Report toolbar (`companyLogoBtn` /
  `removeCompanyLogoBtn`), same button+hidden-input pattern as the existing tare/
  companion-file controls. Validates declared MIME type, a ~1.5 MB size cap, and a
  real `Image()` decode before accepting — rejects anything else with an `alert()`.
- `reportView.js`'s `fillTemplate` gained a final `applyCompanyLogo` step that
  stamps the stored logo onto every `.report-page` in the DOM — static template
  pages and dynamically-generated ones (Table B.2, ISO 19438 windows) alike — so no
  individual template file needed editing. `max-width`/`max-height` with `width`/
  `height: auto` on the `<img>` guarantees it only ever scales down, never distorts.
- **Corrected 2026-09-09, from a real print** (the on-screen/`page.pdf()` checks that
  originally validated placement had missed this): top-right placement sat directly
  over the Test Laboratory/Test Date/Operator identification row, reading as if it
  were IN that field. Moved to bottom-right and doubled in size per the user.
  Bottom-right only works because `.report-page` also picked up a print-only
  `min-height` (10in/10.69in letter/A4, matching `.w16889-p2-page`'s own explicit
  height) — it's an ordinary auto-height block otherwise, so its box ends right after
  its own last content row, nowhere near the physical sheet's real bottom edge,
  which put "bottom:12px" ON the last content instead of below it (same root cause,
  same fix).
- Also corrected: ISO 16889/23369 Page 2 print landscape by rotating an inner block
  90deg inside the (unrotated) portrait `.report-page` box. A logo positioned
  bottom-right of that outer box doesn't land in the reader's visual bottom-right once
  the content inside is rotated — it cuts across whatever rotated table data occupies
  that unrotated corner instead. `applyCompanyLogo` now appends the logo inside
  `.w16889-p2-rotate`/`.w23369-p2-rotate` instead, so it rotates WITH the content.
- **Corrected again 2026-09-09, per the user**: bottom-right (on screen) was itself
  covering real report fields, because the screen preview's `.report-page` has no
  equivalent of print's reserved page-bottom margin — the min-height fix above is
  print-only. Rather than reproduce print's layout on screen too, `.report-logo` is
  now `display: none` outside `@media print` entirely — the logo only ever appears in
  actual print output, not the live page. Also recentered from bottom-right to
  bottom-center (`left: 50%` + `translateX(-50%)`) per the user.
- **Resolved**: this tool's own `page.pdf()`-based print checks showed the centered
  logo landing on real data cells on ISO 16889/23369 Page 2's rotated particle-count
  table (tuned to fill its landscape footprint edge-to-edge — see `app.css`'s own
  "structural guarantee" note on `.w16889-p2-table`). The user supplied a REAL printed
  ISO 16889 report showing the logo sitting cleanly below that same table with clear
  margin, no overlap at all — `page.pdf()` doesn't faithfully reproduce real Chrome
  print output for this rotated page, a second, distinct case of the same tooling
  unreliability already documented for multi-chart pages (see `WISHLIST.md`'s "Known
  bugs" section for the full history of both). No app change needed; the app's layout
  was correct the whole time.
- Sized up again per the user, from a real print preview: 130x64 max -> 195x96 max
  (150% of the prior size).
- Cache version it left the tree at: webreportwriter-v173

## 2026-08-21 — In-app user guidance: a Help dialog + two real empty-state gaps

New feature, per the user: the app had no onboarding content of its own beyond
scattered `title=` tooltips, and two of its five views showed nothing useful
before a file was loaded — Data File Explorer was a literal empty `<div>`, and
Standard Report rendered its full template with every field blank and zero
orientation text. Compare/Audit/Machine Profiles already had a decent "what to
do next" hint box, so those were left alone.

- New `src/helpDialogView.js` — `openHelpDialog()`, modeled directly on
  `report/warningsDialogView.js`'s exact shape (same `.modal-overlay`/
  `.modal-box` components, same local-`el()`-helper/close-on-overlay-click
  pattern, no new interaction mechanism). Static content, one scrollable
  dialog: Load a file, Data File Explorer, Standard Report, Compare Files,
  Machine Profiles, plus a closing "other things worth knowing" note (session
  save/load, units/paper size, print). Reached via a new always-available
  "About Me" button (`#helpBtn` — id unchanged, only its label/position moved,
  same day, per the user: relabeled from "? Help", and moved into its own
  group below Paper size from an initial spot in the sidebar's first group)
  — a dialog, not a dedicated tab, so opening it never disrupts whichever view
  is currently active. New `.help-dialog` CSS width modifier, same pattern as
  `.warnings-dialog`/`.grav-dialog`; section headings reuse the existing
  `.mp-subhead` class as-is.
- **Data File Explorer empty state**: `rerenderExplorer()`'s `if (!currentDf)
  return;` (a silent no-op, leaving `#view-explorer` however it last was — empty,
  on a fresh page load) now renders a `.hint-box` placeholder instead, same
  visual convention as Compare/Audit/Machine Profiles' own empty states.
  `showView`'s `"explorer"` branch also gained an explicit `rerenderExplorer()`
  call (every other view branch already had its own) — without it nothing ever
  called this on initial load, so the placeholder would never actually appear.
- **Standard Report empty-state banner**: new `#reportEmptyStateHint` element
  living in `#context-report` (the Report toolbar), NOT inside `#view-report`
  itself — `renderReportPages` fully replaces that container's `innerHTML` on
  every re-render (standard switch, sensor switch, ...), which would silently
  wipe anything prepended there. New `updateReportEmptyStateBanner()` in
  `app.js`, called from `updateReportingControlsVisibility()` (the same
  single-hook-point already used for `updateStandardCompatibility()`), toggles
  it and fills in the CURRENTLY selected standard's own label dynamically —
  updates live when switching standards with no file loaded.

Verified in a real browser: Explorer's placeholder appears on a genuinely fresh
load (not just after some other interaction); Report's banner names the right
standard and updates on a standard switch, then disappears once a file loads
and stays gone; the Help dialog opens from multiple different views, closes
via both the Close button and clicking the overlay background, and re-opens
cleanly. No console errors.

Cache version: webreportwriter-v169

## 2026-08-21 — Machine Profiles: save/load the whole directory as one file

New feature, per the user: distribute a shared set of machine profiles across
multiple terminals in an organization. New "Save machine profiles (.json)" /
"Load machine profiles (.json)" buttons in the Machine Profiles tab's own
toolbar (`context-machineProfiles`, new — that tab had no toolbar of its own
before this).

Confirmed with the user directly: loading **merges** into whatever's already
saved locally on that terminal — an imported entry wins on a serial-number
collision, but any local-only profile (a serial number not present in the
imported file at all) is left completely untouched. Deliberately NOT a full
replace like this app's existing chart-tabs/comparison-templates load buttons
— wiping out a terminal's own local-only profiles on every import would be
actively destructive for the actual use case this exists for (a terminal may
have both org-wide shared profiles AND rigs unique to that location).

New permanent regression check, `tools/render-check/machine-profiles-save-
load-check.js` (Playwright, same shape/precedent as `session-save-load-
check.js` — not part of `run-all-selfchecks.js`'s Node-only suite, since this
needs a real browser to exercise the download/upload round-trip): adds a local
profile, saves it, then loads a synthetic "imported" file with one colliding
serial number (different data) and one brand-new one, and confirms the
collision is won by the import, the brand-new one is added, and a THIRD,
untouched local-only profile survives the import unchanged.

Cache version: webreportwriter-v166

## 2026-08-21 — ISO 23369: too-short files no longer show a confusing companion-file warning

User report: loading a second cyclic file after finishing a report for a first
one, the companion-file auto-prompt didn't fire — read initially as a stale-
state bug ("we should flush any companion file on file load"). Traced instead
to a genuine, different file: `0-sec-offsettest-02.DAT`, a real 10-minute test,
correctly rejected by the standard's own 25-minute minimum (`Iso23369Analysis.
run`'s `MIN_TEST_TIME_MINUTES` check, unchanged) — `currentAnalysis.ok` is
false, and BOTH the auto-prompt (`app.js`'s `maybePromptForCompanionFile`) and
the toolbar's companion button (`updateReportingControlsVisibility`'s
`showCompanion`) are already, correctly, gated on that flag. Verified the
"flush on load" theory directly first, with a real-browser test loading two
different cyclic files back to back — `loadFileText` already resets
`companionDf`/`companionFileName`/`companionPromptShown` unconditionally on
every new file, confirmed working exactly as designed.

**The real, separate issue the user found along the way:** `run()` pushed the
"No cyclic companion file supplied" warning (and merged in any companion.
warnings) BEFORE checking whether the file could ever be reportable at all —
so a file this short showed that warning (and a "TS_DPress never reached
target" warning from a termination search that had no chance of succeeding)
even though it was being rejected regardless of companion presence, and even
though the user was never offered the chance to supply one. Per the user: "I
wouldn't expect a file to be processed for length before flagging the file
cannot be reported, seems like an operation order that will be unintuitive to
customers."

Fixed with a new early, cheap, companion-independent gate: `_checkMinimumFileSpan`
rejects a file whose own PRIMARY recording (no companion file needed to know
this) is already shorter than 25 minutes, run immediately after `_validateTestType`
and before any companion-related code executes at all. A genuinely matching
companion file observes the same physical test, never a longer one, so the
primary file's own recorded span is always a safe upper bound — this never
rejects a file that would otherwise have passed. The existing, more precise
checks inside `_determineTermination`/`_determineDualFilterTermination` (which
catch a test that crossed its target — or ran out of real data — well before
the 25-minute mark, even in a file that spans long enough overall) are
unchanged and still the authoritative check once termination search actually runs.

Verified in a real browser: the Warnings dialog for a genuinely too-short file
now shows only the actual rejection reason, no companion-file warning at all.
`iso23369Analysis.selfcheck.js`'s existing too-short-fixture negative control
updated to match (`terminationTime` now correctly stays unset rather than
resolving a fallback value that's immediately discarded, and a new assertion
confirms no companion-related warning appears).

Cache version: webreportwriter-v165

## 2026-08-20 — Figure C.1 (ISO 23369) now shows both flow phases as two series

Per the user: the Differential Pressure figure showed one series, and it looked
like just the high-flow curve. It was — the primary file's once-a-minute
sampling can alias onto a single phase of the flow cycle when its interval is a
near-multiple of the cycle length, making one phase look like the entire signal
rather than a deliberate choice. Fixed by plotting the companion file's own
high-flow and low-flow phase ΔP as two separate series instead, when a companion
file resolved both.

`iso23369Analysis.js` gained two new fields, `companionHighDPSeries`/
`companionLowDPSeries` (each `{times, values}` or null), computed once by new
`_computeCompanionPhaseDPSeries` in the single-filter termination path — a small
deliberate duplicate of `_resolveDPSource`'s own channel-fetching (that function
is called from several places for several different tags; this needed exactly
one call, for the one tag Figure C.1 plots). `chartView.js`'s
`renderMassPressureFigureChart` gained an optional `data.secondarySeries`/
`data.seriesLabel` — a second line on the same axes, generic drawing capability
only (absent for every other caller, so ISO 16889's own identical-function
Figure C.2 is byte-for-byte unchanged; same parameterization pattern as
`ratioLabel`'s own earlier addition). `reportView.js`'s
`build23369MassInjectedData` reads the two new analysis fields directly (never
re-derives the phase split itself, per CLAUDE.md — that's analysis PROCEDURE
content, owned by `iso23369Analysis.js`) and falls back to the original
single-series primary-channel behavior whenever no companion file resolved both
phases, unchanged from before this fix.

Verified in a real browser: both series render with real, differently-colored
points and a legend, high-flow phase consistently reading well above low-flow
phase, both rising toward filter loading near the end of the test. New
selfcheck coverage confirms the fields resolve to the expected row counts and
the high series genuinely reads higher than the low series (a guard against the
two accidentally swapping labels), and that both stay `null` in the
no-companion-file fallback case.

Cache version: webreportwriter-v164

## 2026-08-20 — Real bug traced to a mismatched companion file; new mismatch guards

Follow-up to the phase-split fix above, from continuing to chase the same live
report: after that fix, the "not enough high-flow-phase samples" warning was
gone, but the report showed a negative injection-system final volume and Page
2's particle-count table went blank after the 30% row. Both traced to the same
root cause: `terminationTime` came out as 5:55:55 (5h56m) against a real test
that ran exactly 1h25m.

Diagnosis, cross-checked against real numbers the user pulled from the Explorer
(built earlier today): the companion file's own elapsed-time values (first
record 4:31:24, last 5:56:24) were internally self-consistent (both differ from
the companion's own wall-clock `Time` field by exactly 09:51:32 — a real,
correctly-anchored primary-file zero-reference, confirmed against the primary
file's own first/last records: `9:52:32 − 0:01:00 = 9:51:32`,
`11:17:10 − 1:25:38 = 9:51:32`). So `alignToPrimary`'s arithmetic was never
wrong — the companion file's own wall-clock timestamps (14:22:56–15:47:56)
simply don't belong to the same test session as the primary file's
(9:52:32–11:17:10), a ~4.5-hour gap. Checked all 3 reference fixture pairs
directly to rule out a systemic issue: every one has its companion file starting
within about a minute of its own primary file, confirming this was a one-off,
not a format quirk this codebase needed to generalize for.

**Confirmed by the user: genuine mismatched file** — two similarly-named
same-day tests (e.g. "-01"/"-02"), each writing its own "-Cyclic" companion at
roughly the same time of day, and the wrong one got attached. Nothing caught
this before — the content parses and (for two same-day tests close enough in
time) can even "align" without visibly breaking, silently poisoning termination
time, every reporting-time bucket, and the injection-volume calculation.

**Two new guards, independent of each other (catch different failure shapes):**
1. `app.js`'s new `checkCompanionFileNameMatch` — a companion file is expected
   to be named `<primary file name>-Cyclic<same extension>`; anything else
   warns immediately, before content is even parsed. Runs on both the initial
   auto-prompt and the toolbar's "Add/Change Companion File" button.
2. `cyclicCompanionFile.js`'s `alignToPrimary` — new plausibility check: every
   real confirmed-matching pair starts within about a minute of each other;
   warns if the companion's first row is more than 10 minutes off the primary
   file's own start (a deliberately generous multiple of that, so it only fires
   on a genuine mismatch).

**A real, separate gap found while wiring the second check in: `CyclicCompanionFile.warnings`
was never actually read anywhere in the app** — not even the PRE-EXISTING
"can't align, primary file has no valid timestamps" warning ever reached a
user, only a selfcheck. Fixed by merging `companion.warnings` into
`analysis.warnings` once, in `Iso23369Analysis.run()`, so every companion-file
warning (old and new) flows through the same Warnings dialog / inline-marker
pipeline as everything else. Verified via a real-browser Playwright pass:
attached a real, structurally-valid-but-wrong companion file, confirmed both
new warnings actually appear in the Warnings dialog.

Cache version: webreportwriter-v163

## 2026-08-20 — ISO 23369 phase-split now uses Cycle parity, not a rate threshold

Follow-up to the dataFile.js fix below — once it let a real cyclic file's data
block parse at all, the report still failed with "The cyclic companion file
didn't have enough high-flow-phase samples to resolve a pressure trend," on a
file with 720 recorded cycles (plenty of real samples). User's own diagnosis:
"Are you using the cycle indicators N and N.5 denoting the high and low phase of
each cycle for organizing the high and low cycles?" — the answer was no, and it
should have been.

**Root cause:** the phase split (used by both the Table 2 flow-rate check and the
ΔP-source resolution for termination/reporting-time interpolation) classified
each companion-file row by comparing its own `TS_Rate` sample against `q̄`
(`(q_max+q_min)/2`, computed from the HEADER's `Rate`/`FlowRatio`). If `q̄` is
wrong or off-scale relative to what the companion file's real `TS_Rate` values
actually are, a per-row magnitude threshold can starve or empty one phase
entirely — independent of whether the rig is cycling correctly, and independent
of how much data the file actually has.

**Fix:** classify by the companion file's own `Cycle` column parity instead
(confirmed to increment by exactly 0.5/row across every real fixture — see
`cyclicCompanionFile.selfcheck.js`) — a structural split needing no header value
at all. Verified against all 3 real fixture pairs: 0 disagreements against the
old rate-threshold method on the two fixtures where it worked, and a full
recovery on the one where it didn't. One real wrinkle found doing that
verification: **which parity (whole-number vs. `.5`) means "high" is NOT fixed
across files** — confirmed reversed on `SpinOnCyclicMP-Cyclic.DAT` (whole-number
Cycle rows are the LOW phase there; the other two fixtures have it the other way
around). So the two parity groups are clustered first, then labeled by comparing
their own average rates against EACH OTHER — never against `q̄`, which is exactly
the value that can be wrong. New `splitFlowPhasesByCycle` replaces
`highFlowPhaseIndices`/`lowFlowPhaseIndices` at both call sites
(`_checkTestFlowRateTolerance`, `_resolveDPSource`).

**A second, separate discrepancy surfaced (not fixed) while verifying against
`SpinOnCyclicMP.DAT`**, now usable as a fixture for the first time since the
dataFile.js fix below unblocked it: its header's `Rate`/`FlowRatio` don't
reconstruct the real `q_min`/`q_max` the way the other two fixtures' do (`Rate=105`
there matches the real HIGH-flow average, not the low one — the opposite of
"Cyclic Multipass.DAT"/"50ch CyclicMP.DAT", where `Rate` consistently matches the
low average). Left `// ASSUMED`/unconfirmed rather than guessed at — inverting the
formula to fit this one file would break the two already-confirmed ones. Produces
two Table 2 flow-rate warnings against that specific fixture that may or may not
be real; flagged in `iso23369Analysis.selfcheck.js`'s own header comment for
whoever investigates next.

New regression coverage in `iso23369Analysis.selfcheck.js`: the phase-split
re-derivation now uses Cycle parity (matching what the engine actually does,
rather than incidentally agreeing via the old threshold math), the synthetic
Table-2-mismatch fixture gained a `Cycle` column (without one, the new
classification silently skips the check instead of exercising it), and a new
`SpinOnCyclicMP.DAT` test block guards the reversed-parity case directly.

Cache version: webreportwriter-v162

## 2026-08-20 — Real bug: valid, ENDDATA-terminated files silently dropped as "malformed"

User-reported, live: a file with a confirmed real `ENDDATA` marker still triggered
"Dropped 600 malformed row(s)... file was cut off mid-line," discarding the entire
data block. Reproduced exactly (byte-for-byte, 600 dropped rows) against an
already-in-repo fixture, `SpinOnCyclicMP.DAT` — this was the exact `dataFile.js`
gap CLAUDE.md's own ".DAT file handling" section had already flagged as a known,
unfixed issue while building ISO 23369 ("affects every standard equally, not
ISO-23369-specific"). Two independent, genuinely different root causes in the same
file, both in `dataFile.js`'s trailing-malformed-row detector (built to catch a
file genuinely cut off mid-write, e.g. a power outage):
1. **A row can legitimately be WIDER than its declared tag/size count.**
   `SpinOnCyclicMP.DAT`'s analog rows are 24 fields wide against only 22 declared
   `;Data Format:` tags (2 real, undeclared trailing columns) — harmless, since
   `getChannel` reads by index and never looks past what it needs. The old check
   required an EXACT width match, so it misclassified every single analog row in
   the file as malformed. Fixed: the check now only flags a row NARROWER than
   expected — the genuine truncation signature — not a wider one.
2. **`LBSizes`/`LSSizes`/`LBESizes` can carry a trailing `"0"` padding sentinel
   that count rows never actually have a value for** (confirmed in two independent
   real fixtures, `SpinOnCyclicMP.DAT` and `LBLBDataOnly.DAT`: `LBSizes,4,5,...,
   70,0` — 33 declared, 32 real per row; a genuine declared size is always a real,
   ascending, non-zero micron value in every fixture checked). New
   `stripTrailingZeroSizeSentinel` strips it at parse time, so `lbSizes.length`
   (etc.) already reflects each count row's real width everywhere downstream,
   matching CLAUDE.md's own stated "N declared sizes = N fields wide" invariant
   instead of quietly violating it.
Both fixes are additive/more-permissive only — a file that already parsed
correctly is unaffected; a file that used to be wrongly emptied now parses in
full, with zero warnings, when nothing was actually wrong with it. The real,
intentional truncation-detection behavior (a genuinely cut-short trailing row) is
unchanged and still covered by `dataFile.selfcheck.js`'s existing cases. New
regression case added there against `SpinOnCyclicMP.DAT` directly (not a
synthetic file), since a hand-built row can't reproduce a quirk this specific.

Cache version: webreportwriter-v161

## 2026-08-20 — ISO 23369 control-target fix; Explorer/sidebar now file-type-aware

Follow-up to the ISO 23369 build below, from reviewing a real cyclic file's
warnings/control targets against the user's own machine.

**Real bug: Table 2's "Test Flow Rate" row false-positived on every cyclic file.**
`TS_Rate` spends the whole test alternating between q_min/q_max, so the generic
control-target engine's flat whole-test average necessarily lands somewhere BETWEEN
the two — nowhere near either, regardless of whether the rig is actually tracking
its setpoints correctly (the user's own file: reported "12.567 L/min vs. a 7 L/min
setpoint," when the real setpoints are q_min=7/q_max=14 and the rig was tracking
both fine). Fixed by removing "Test Flow Rate" from `iso23369ControlTargets.js`
entirely and replacing it with a new phase-aware analysis-level check:
`iso23369Analysis.js`'s new `_checkTestFlowRateTolerance(companion)` splits the
companion file's own rows into high-flow/low-flow phases (reusing the same
`TS_Rate`-vs-q̄ split the termination search already established) and checks each
phase's own average against its OWN target (q_max/q_min) independently — same
"computed value, not a raw channel/header read" reasoning that already put BUGL and
Injection Flow Rate in the analysis-level camp rather than the generic table.
Verified both that a real correctly-tracking file produces NO false positive and
that a synthetic mismatch on just the high-flow phase IS caught, naming which phase
failed.

**Data File Explorer now reads a standalone `-Cyclic.DAT` companion file on its
own — no ISO 23369 report needed first.** Per the user: "the data file explorer
does not have any function to add the cyclic tab... I would prefer if the data
file explorer can handle cyclic files all on its own. It's expected to be a
generic file reader." `loadFileText` (`app.js`) now tries the primary `DataFile`
shape first and falls back to `CyclicCompanionFile` when the text has no
HEADER/DATA sections at all; `explorerView.js` gained one `isCyclicCompanion`
branch point (an `instanceof` check) that swaps in a single flat "Cyclic Data" tab
instead of the normal header/LB/LS/LBE tab set — every other rendering function
there was already generic enough to need no changes. `runAnalysisPipeline` gained
one guard at its top (not one per call site) that takes the report/analysis side
to a clean "nothing to analyze" state whenever `currentDf` isn't a `DataFile` —
covers every path that can re-trigger analysis (sensor switch, standard switch,
session load), not just the initial load. Also fixed `chartData.js`'s
`availableChannels` (`df.analogTags` doesn't exist on a companion file; falls back
to `df.tags`) so custom plot tabs work against a loaded companion file too.

**Real gap found post-verification: the standalone-load case above wasn't the only
way a companion file reaches the app.** The far more common path is the existing
auto-prompt (`companionEntryView.js`) attaching a companion to an already-loaded
PRIMARY file — and that path left Data File Explorer with no way to see the
companion's own data at all, since `renderExplorer` only ever rendered `currentDf`
(the primary file), with no connection to `app.js`'s separate `companionDf` state.
User: "I do not see the tab where I can view the -cyclic data under the data file
explorer" — this was it. Fixed by threading a `companionDf` option through
`renderExplorer`: when present alongside a normal primary `df` (not the
standalone-companion case above — never both at once), one more "Cyclic Data" tab
is appended to the primary file's normal tab set, reading from `companionDf`
instead of `df` for that one tab only — same generic table machinery both cases
already share. `app.js`'s `rerenderExplorer` now always passes its own
`companionDf` through; harmless when null/not yet attached.

**Sidebar now restricts which standards a loaded file can be reported under.** Per
the user: "Cyclic files shouldn't be able to be checked by the other standards,
PQ file reports should only be available with PQ files... give users some
indication that the proper standard is available to view." Each standard's
`Analysis.js` gained a `static isCompatible(df)` (own copy per standard, per
CLAUDE.md — each just reads that file's own already-private `VALID_TEST_TYPES`),
exposed on the `STANDARDS` registry and checked by a new `app.js`
`updateStandardCompatibility()`. A standard whose `isCompatible` rejects the
loaded file's TestType gets its `#standardSwitch`/`#auditSwitch` button disabled
(new `.standard-switch button:disabled` CSS, grayed out) with a `title` tooltip
explaining the mismatch — both sidebar picker groups, not just one. No file loaded
→ every standard stays enabled, unchanged. The CURRENTLY selected standard is
NEVER disabled even when incompatible — confirmed with the user ("stay put, let
today's rejection show") — only sibling buttons gray out, so an already-mismatched
selection keeps showing its own existing rejection message instead of being pulled
out from under the user. A standalone companion file (no `.testType` at all) comes
out incompatible with all 5 standards for free — `isCompatible` just reads
`df.testType`, `undefined` isn't in any standard's `VALID_TEST_TYPES`, no special
case needed.

Verified via a real-browser Playwright pass (not just the Node selfcheck suite,
which stayed green throughout): standalone companion-file load renders the Cyclic
Data tab/table and a working custom plot tab; loading a cyclic primary file
disables the other 4 standards with the TestType named in the tooltip; loading a
standalone companion file disables all 5 (companion-specific tooltip wording);
switching between standards live re-evaluates which buttons are exempt.

Cache version: webreportwriter-v160

## 2026-08-20 — ISO 23369:2022 added as a new standard (cyclic multipass)

Fifth standard, built clean against the standard's own outline text — explicitly
modeled on ISO 16889 (same beta/filtration-ratio math shape, same 10%-100%
reporting-time-bucket structure) but with the test flow CYCLED between q_min/q_max
instead of held steady. Own `src/standards/iso23369/` folder (Analysis, Mapper,
Pages, ControlTargets, AuditSteps, DisplaySizesView, Analysis.selfcheck) and own
`templates/iso23369/` (4 required pages + 1 optional "Add Count Details" page) — no
analysis procedure or report content shared with ISO 16889 even where the shape
matches, per CLAUDE.md. Verified end-to-end against three real fixture pairs
already in `tools/render-check/Test DAT files/`, both via Node-level selfchecks and
a real headless-browser run (file load → companion-file prompt → full report
render, all 4 charts, Audit Trail).

**Genuinely new capability, not just a new standard folder: a cyclic test's rig
writes TWO files, not one.** The primary `.DAT` file plus a same-named
`-Cyclic.DAT` companion, sampled far faster (~5s vs. the primary's ~60s) —
required because the primary file's own cadence can't resolve a ~10s flow cycle.
- New `src/core/cyclicCompanionFile.js` (+ its own `.selfcheck.js`) — a sibling
  parser to `dataFile.js`, not merged into it: the companion format has NO
  HEADER/ENDHEADER/DATA/ENDDATA markers at all (confirmed absent across 3 real
  fixture pairs), just one `;Data Format:` row followed by flat per-sample rows.
  Reuses `DataFile.splitLine`; `DataFile.parseClockSeries` was extracted from
  `buildTimes()` (pure refactor) and `DataFile` now exposes `this.startTimeDay` so
  the companion file can align its own elapsed-time axis onto the primary file's
  exact zero reference.
- New `src/report/companionEntryView.js` — own copy of `tareEntryView.js`'s shape
  (ISO 3968's optional-tare-file prompt), NOT reused directly: that file's copy
  text is hardcoded to the tare question. Auto-prompts the moment a cyclic file
  loads (unlike the tare file's yes/no ask) — the companion data is load-bearing
  for a correct report, not a fully-optional add-on. Skipping still renders a
  report (warn, don't block) using the primary file's coarser samples, flagged via
  a new `companionFileMissing` field and a warn-styled toolbar button.
- **The companion ΔP signal oscillates and can't be fed to `findCrossingBracket`
  raw** — confirmed against real data: it alternates every ~5s between a low-flow
  trough and a high-flow peak. Fixed by classifying each companion row as
  high-flow/low-flow phase via its own `TS_Rate` value (threshold: q̄, the exact
  midpoint of q_min/q_max by construction) and running termination search +
  reporting-time ΔP interpolation against the high-flow-phase sub-series only —
  new analysis PROCEDURE content, own to `iso23369Analysis.js`.

**Other real differences from ISO 16889, not copying errors:**
- Clean/final ΔP direction is REVERSED for the final pair only: the header's
  `TerminalDP` is the final ELEMENT ΔP directly (11.3), and assembly ΔP (the
  crossing-search target) is the derived value — the opposite of ISO 16889's own
  direction. `// ASSUMED` — implemented per the standard's own quoted text; the one
  fully-analyzed fixture's `CleanHousingDP=0` makes the two directions numerically
  indistinguishable there.
- Retained capacity's mass-balance formula (13.3) uses UPSTREAM sample flow (qu) in
  its third term, matching ISO 19438's `Mnr` pattern — not ISO 16889's, which uses
  downstream (qd) in both flow-weighted terms — and its first term uses the
  computed final INJECTION volume (11.15), not a test-system volume field.
- Reporting-time bucket boundaries round up to the file's own count-cycle length
  (`CountTime+HoldTime`) instead of a hardcoded whole minute — this standard's own
  text anticipates count cycles under 60s; validated against its own 15s worked
  example (180s / 15s = 12 disregarded counts, exactly as stated).
- 12.12's BUGL target denominator is q̄ (10.2.1's average test flow), not a single
  steady flow setpoint — this standard has no such setpoint to divide by.
- `chartView.js`'s `renderFiltrationRatioFigureChart`/`renderBetaVsTimeFigureChart`/
  `renderBetaVsPressureFigureChart` gained an optional `ratioLabel` parameter
  (default `"β"`, ISO 16889's existing 3 call sites unchanged) so this standard's
  own "a" ratio symbol shows on its own charts — generic drawing machinery, per
  CLAUDE.md, since only axis TEXT changes, not what's plotted.
- Formula 18 (13.7's reverse interpolation) is algebraically identical to ISO
  16889's log-linear `Size_At_Beta_x` — verified by hand — so `sizeGivenRatioDetail`
  is the same ratio-of-logs math, renamed to this standard's own terminology.

**Three real bugs found and fixed via the real-browser smoke test** (Node-level
selfchecks alone didn't catch any of these — worth remembering next time a Node
check passes and the temptation is to skip the browser pass):
1. `cyclicCompanionFile.js` declared a top-level `const DataFile = ...` in the
   shared classic-script global scope — `dataFile.js` isn't IIFE-wrapped, so
   `class DataFile` is a real global lexical binding there, and the redeclaration
   threw `Identifier 'DataFile' has already been declared`, silently breaking page
   init. Renamed to `DataFileClass` — exactly the trap `analysisMath.js`'s own
   header comment already warns about.
2. `iso23369Pages.js` was written but never imported into `reportPages.js`'s
   `REPORT_PAGES` aggregator — the Report view rendered nothing for this standard
   (`pagesForCurrentStandard()` filtered to an empty list) even though the
   analysis/mapper both ran fine.
3. `renderFiltrationRatioFigureChart`'s `data` argument shape (`{sizes,
   overallBeta}`) is generic-function-internal naming, not standard content —
   `iso23369Mapper.js`'s own `ratioChart` extra is shaped `{sizes, overallRatio}`
   (this standard's own terminology), so Figure C.2 rendered a correct axis/scale
   with zero points until the call site adapted the shape.

Also touched: `reportView.js` (`fillTable23369Page2` — literal structural copy of
`fillTable16889Page2`'s static-grid-fill-by-position pattern, per this standard's
own outline stating Page 2 "directly mirrors ISO 16889's page 2"; `build23369MassInjectedData`
for Figure C.1, deliberately reading the PRIMARY file's smoother ΔP series rather
than the companion's oscillating one); `app.css` (`.w23369-p2-*` print rules, own
copy of `.w16889-p2-*`'s hard-won 18-column/34-row/rotated-landscape numbers, same
table shape); `auditView.js`/`run-all-selfchecks.js`/`index.html` (both sidebar
switcher button groups, 2 new `<script>` tags) — the full wiring checklist this
build surfaced (9 real touchpoints, only 4 previously documented) is now recorded
in CLAUDE.md's own folder-map section.

**No `.DAT`-format changes needed for the primary file** (confirmed generic per the
2026-07-28 entry below) — only the new companion format needed new parsing.
**Not built in this pass**: an "initial system cleanliness" pre-injection count row
(ISO 16889 has one; this standard's own outline doesn't ask for it and no real
cyclic fixture has been checked for a matching aux block) — Page 2's template
still reserves the row structurally, renders blank. **A pre-existing, unrelated
`dataFile.js` gap surfaced during fixture testing**: one real cyclic fixture
(`SpinOnCyclicMP.DAT`) has analog rows 24 fields wide against only 22 declared
`;Data Format:` tags — the existing parser drops the whole data block as
malformed. Affects every standard equally, not ISO-23369-specific; flagged, not
fixed here.

Cache version: webreportwriter-v158

## 2026-08-19 — Coincidence limit check (particle counter data-quality warning)
Per the user. APCs have two calibration-time sensitivity bounds: a noise floor
(handled entirely during calibration, no per-test check) and a coincidence limit —
the maximum reliable count rate before multiple small particles start registering
as one large one, corrupting the data (ISO 11171, referenced by all three
particle-counting standards). New warning: did any point in the test exceed the
CURRENTLY SELECTED sensor's coincidence limit, and if so, which minutes.
- New shared, standard-agnostic math — `src/helpers/coincidenceLimitCheck.js`
  (dual Node/browser module, same shape as `analysisMath.js`, loaded as a classic
  `<script>` before the analysis engines): `sensorCount = reportedCount /
  dilutionRatio` per record (a ratio of exactly 0 means that dilution stage is
  inactive — an effective ratio of 1 — not "no data," confirmed against two
  independent real-file cases), compared against a limit, offending minutes
  collapsed into ranges (`"12–15 min, 40–42 min"`). Conservative defaults: LB/LBE
  30,000 counts/mL (Pamas, the stricter of Pamas/Klotz's own LB figures), LS
  12,000 (Pamas, the only figure supplied).
- Each of `iso16889Analysis.js`/`iso454812Analysis.js`/`iso19438Analysis.js` gets
  its own `resolveCoincidenceChannels` (own copy per CLAUDE.md, mirrors
  `SENSOR_CHANNELS`'s existing duplication) resolving which live dilution-ratio
  channel feeds which sensor — THREE schemes depending on the file: single-sensor
  rig (`UpRatio`/`DnRatio`), plain dual-sensor ExRaDs (`aUpPrimRatio`/`aDnPrimRatio`
  for LB, `aUpExRatio`/`aDnExRatio` for LS — already-documented scheme), and
  MidstreamFlag-bracketing rigs (`aUpRatio`/`aMidPrimRatio` for LB;
  `aMidExRatio`/`aDnRatio` for LS in the typical case or just `aDnRatio` for LBE in
  the rare case — a NEWLY confirmed scheme, added to `dataFile.js`'s own DILUTION
  SYSTEM SCHEMA documentation). Only checks the report's currently selected sensor,
  not every channel present in the file. `iso3968Analysis.js` untouched (no
  particle counting there).
- Machine Profile extension: 5 new optional coincidence-limit override fields
  (`sensorUpstreamCoincidenceLimit`/`sensorDownstreamCoincidenceLimit`/
  `lsSensorUpstreamCoincidenceLimit`/`lsSensorDownstreamCoincidenceLimit`/
  `lbeSensorCoincidenceLimit`), same per-physical-slot granularity as Model/Serial,
  for when the real limit has been empirically found instead of relying on the
  conservative default — resolved in `app.js`'s `runAnalysisPipeline` and passed
  into `standard.run()`'s options bag (a real math input consumed by the Analysis
  engine itself, unlike every other Machine Profile field, which only ever feeds a
  Mapper's report text).
- No new UI surfacing needed: the warning lands in the same `analysis.warnings`
  array the existing Warnings dialog/badge already reads.
- New `src/helpers/coincidenceLimitCheck.selfcheck.js` (pure math), plus each
  standard's own `<id>Analysis.selfcheck.js` extended with a real-file, tiny-
  override-limit assertion proving the full resolver → engine → warning path
  works, not just the isolated math.
- Cache version: webreportwriter-v157

## 2026-08-18 — dataFile.js: recover truncated .DAT files instead of discarding them
Per the user: a rare but known real-world failure — a power outage or crash halting
the machine mid-test leaves the `.DAT` file incompletely written. Previously, a
missing `ENDDATA` marker (whether or not `DATA` was found) caused the parser to
discard EVERY record and return header-only, even when real, complete rows were
sitting right there in the file.
- **ENDDATA missing, DATA present**: now recoverable — falls back to end-of-file as
  the data block boundary instead of aborting, so a well-formed file just missing
  its closing marker parses exactly as if it had one.
- **The realistic failure mode — a line cut off mid-write**: added a row-width
  validation pass that checks each trailing row's field count against what its
  position in the record implies, walking backward from the end of the file and
  stopping at the first genuinely well-formed row. Catches a partially-written
  final line (fewer fields, not just a whole row missing), not just a missing
  marker. Only trims from the tail (this format is written sequentially and only
  ever cut off at the end, never corrupted mid-file), and is skipped entirely if
  `analogTags`/size lists aren't reliably known, so it never guesses.
- **DATA marker itself missing**: unchanged, correctly still fails closed — nothing
  to recover from without a start point.
- New `DataFile.truncated` flag, set whenever either recovery path fires. `app.js`
  now pops a blocking alert on load whenever it's set, at all 5 places a `DataFile`
  gets constructed from a file a user is actively reviewing (primary load, Compare
  Files, the ISO 3968 tare file, and both session-restore paths) — previously the
  only signal was `df.warnings`, a passive line in the Data File Explorer tab that
  someone opening straight into Report/Compare would never see.
- New `src/core/dataFile.selfcheck.js` (first selfcheck for this file), built from a
  real fixture file with its `ENDDATA` line removed/its last line cut short, not a
  hand-typed one — registered in `run-all-selfchecks.js`.
- Cache version: webreportwriter-v156

## 2026-08-18 — ISO 19438: field-by-field walk resolved (WISHLIST.md #1)
Comment/documentation-only pass — no runtime behavior changed. Closes the top item
from WISHLIST.md's "Decided 2026-07-30" list: all ~20 `// ASSUMED` channel-tag/
header-key markers across `iso19438Analysis.js`/`iso19438ControlTargets.js`/
`iso19438Mapper.js` checked against real `.DAT` files (`SpinOnMP.DAT`, an ExRaDs
dual-sensor rig; `TwinFSRig-ROTest9-MP.DAT`, the same single-sensor rig ISO 4548-12's
own control-target table was confirmed against) and upgraded to CONFIRMED.
- Two items needed the user's own standard-text knowledge rather than a file, both
  now confirmed: `DISREGARDED_CYCLES` (3) and the Temperature compliance shape
  (Test System + Injection System, no Dilution System) match ISO 4548-12's own
  figures as genuine independent carryover — the two standards' build-out documents
  were each produced separately from that standard's own published text, not one
  copied from the other.
- Confirmed correct along the way, not a bug despite looking like one at first
  glance: `SENSOR_CHANNELS.lbe`'s `upProp: "lbd"` deliberately aliases LB's own
  downstream reading (the pre-filter's downstream sample point IS the final
  filter's upstream sample point in series/dual-filter testing) — same pattern
  ISO 16889/4548-12 already use, just cross-checked against `dataFile.js`'s "LBLB"
  5-row shape and the user's own explanation of why LS/LBE data share a row slot.
- **Real finding, broader than ISO 19438 alone**: `testLocation`/`TestLocation`
  (read by all three multipass standards' mappers, including ISO 16889's `testLab`
  field, added last session) does not appear in ANY real file checked so far —
  confirmed by the user this value is meant to come from Custom Default or a
  Machine Profile, not from data. Corrected an inaccurate "confirmed present in
  real files" claim introduced into `iso16889Mapper.js` last session; the from-data
  reads stay in all three mappers as harmless no-op fallbacks.

## 2026-08-18 — ISO 16889 Legacy removed from the project
Per the user. The legacy Bonavista-derivative engine had been kept aside as
`iso16889legacy` since the clean ISO 16889:2022 build (`iso16889`) was written,
purely for continuity during the transition — WISHLIST.md always scoped its removal
for once the clean build had produced reports checked against known-good output.
That condition is now met, so it's gone outright rather than kept indefinitely.
- **Deleted**: `src/standards/iso16889legacy/` and `templates/iso16889legacy/` in
  full (analysis engine, mapper, page list, template, its own `ISO16889LEGACY_
  ANALYSIS.md`).
- **Removed every aggregator/wiring reference**: `app.js` (STANDARDS entry, classic
  `<script>` global), `index.html` (sidebar button, script tag), `service-worker.js`
  (precache entries), `reportPages.js` (import/concat).
- **Removed now-dead generic machinery from `reportView.js`**: legacy's report page
  was the ONLY template using the `data-label`/`data-slot-label` indirection (`LABELS`/
  `unitDependentLabels`) and the only one with a `#clumpTable` (`fillClumpTable`) —
  every other active standard's template already used plain static text and its own
  named `data-slot` fields, so this was confirmed-unused once legacy left, not a
  behavior change for any current standard.
- `auditView.js`/`audit-view-check.js`: legacy never had an audit trail entry (already
  excluded), so no functional change there — just removed the now-stale "excluded on
  purpose" commentary/assertions that referenced it by name.
- Updated dangling comment references across `iso16889Analysis.js`,
  `iso454812Analysis.js`, `iso16889_page1.html`/`iso454812_page1.html`'s header
  comments, `CLAUDE.md`'s "ISO 16889 — provenance note" (kept as history, operational
  guidance retired), `README.md`, and `WISHLIST.md` (its scoped-removal entry, now
  fulfilled, removed).
- Cache version: webreportwriter-v155

## 2026-08-12 — ISO 16889: Machine Profiles tab (per-rig custom defaults) + Counting System fix
Per the user: the Counting System table showed one merged Flow Rate/Dilution Ratio cell
for both Upstream and Downstream, inconsistent with the Counter ref. column's own two
rows — and separately, a single location running several rigs needs counter/sensor/cal
facts associated per RIG, not one global default shared by every report.
- **`iso16889Mapper.js`/`iso16889_page1.html`**: `getHeaderValues` already returns an
  `[upstream, downstream]` pair for `SensorFlow`/`DilutionRatio` (and the LB/LS,
  Primary/Extended fallbacks) — the mapper was reading only index `[0]`, silently
  discarding the downstream value. Split into `sensorFlowRateUpstream`/
  `sensorFlowRateDownstream` and `dilutionRatioUpstream`/`dilutionRatioDownstream`,
  both now real, populated fields; the template shows two real rows instead of one
  `rowspan="2"` cell. Any previously-saved Custom Default under the old
  `sensorFlowRate`/`dilutionRatio` ids is now orphaned and needs re-entering as
  Upstream/Downstream.
- **New Machine Profiles tab** (`src/machineProfiles/`, sidebar button beneath Compare
  Files): a user-editable, localStorage-persisted directory of rigs keyed by the
  `.DAT` file's `SerialNumber` — Particle Counter, Sensor, an optional Light
  Scattering (LS) sensor set, an optional one-off extended Light Blocking (LBE)
  sensor, Test Location, Counter Calibration Method/Date. Distinct from
  `core/machineProfiles.js`'s hardcoded, developer-maintained legacy-fleet
  channel-quirk table — same `SerialNumber` key and the same `lookupProfile`/
  `applyCustomDefaults` apply mechanism (reused unchanged), but a separate,
  customer-facing file.
- Per the user: the standard rig has its OWN counter and sensor at each of
  Upstream/Downstream (not one shared identity), so Counter and Sensor each collect
  an independent Upstream/Downstream Model+Serial pair — a "Share counter" toggle
  (default off) covers an older rig that only ever had one counter for both
  locations. The LS sensor set mirrors that same Upstream/Downstream shape. LBE is
  DIFFERENT — a single sensor, not a pair: in series/dual-filter testing the
  pre-filter's own downstream sample point IS the final filter's own upstream sample
  point (one shared midstream draw), so an LBE-equipped rig has exactly one extra
  physical sensor reading it, not one each side. Defaults to appearing in the
  Downstream ref. (matching a report on the pre-filter, this standard's default
  sensor) — still hand-editable if reporting the final filter instead.
- Wired into ISO 16889:2022 only for this pass (the only standard whose Page 1 already
  has matching Counting System/cal fields) via a new `STANDARDS.iso16889.
  machineProfileFields` adapter (`iso16889Mapper.js`'s `buildMachineProfileDefaults`) —
  ISO 4548-12/19438/3968 have no matching report fields yet. Applied LAST in
  `runAnalysisPipeline`, after both the hardcoded quirk profile and the global
  persisted Custom Defaults, so the more-specific rig profile wins when more than one
  tier sets the same field.
- Each location's Counter + Sensor (+ LS/LBE, if present) combine into ISO 16889's
  existing single "Counter and sensor ref." column — one combined string per
  location (`counterUpstream`/`counterDownstream`), still hand-editable per row.
- ISO 16889's existing "Test Laboratory" field (`testLab`) IS this standard's
  test-location field (corrected by the user, 2026-08-12, after an initial pass
  wrongly added a separate `testLocation` row/field, confused by ISO 4548-12/19438
  labeling the same concept differently) — no new report row. `testLab` now reads
  the exact `General Test Information → TestLocation` header key those two
  standards' mappers already read, and the Machine Profile's Test Location value
  fills the same field.
- Cache version: webreportwriter-v154

## 2026-08-12 — Compare Files: the rest of each standard's own plots, now available
Per the user: several plots each standard's own single-file report draws weren't
available in Compare Files at all — only one curve per standard (β/efficiency vs.
size) was ever offered, and ISO 3968 had none.
- **`STANDARD_CURVES`** (`app.js`) restructured from one curve per standard to a
  list — each entry a `{curveId, curveLabel, xAxisLabel, yAxisLabel, resolve}` that
  reads the SAME fields that standard's own report figure already reads (analysis
  fields, or the mapper's own store extras from the identical throwaway
  run()/applyMapper() pass this already did) — no analysis PROCEDURE re-derived,
  per CLAUDE.md. New curves:
  - **ISO 16889**: DP vs. Injected Mass (Figure C.2). Reads `computeMassAddedSeries(df)`
    (chartData.js, the same header-`GravimetricLevel`-based curve "Mass Added
    (calc.)" already exposes) rather than the report's own hand-entered gravimetric
    total, which a throwaway store never has — can differ slightly from that
    standard's own Page 1 total for the same reason Mass Added already can.
  - **ISO 4548-12 / ISO 19438**: DP vs. Time (Figures B.1/B.2) — own copies (own
    curveId, same "never re-derived, own reader function" — CLAUDE.md), each
    reading `overallDPSeries` (dual-filter channel sum, when applicable) or the
    plain termination channel, truncated at `terminationTime`.
  - **ISO 3968**: Flow Rate vs. Differential Pressure (Figure 4, the raw P-Q sweep)
    — this standard had ZERO curves offered before. Exposing it surfaced a real,
    separate bug: the curve-chip "sensor readiness" gate required a truthy sensor
    UNCONDITIONALLY, which permanently locked out any curve from a standard with no
    sensor at all (ISO 3968 has none). Fixed in `compareTemplateView.js`: ready now
    means "no sensor to pick, or one's been picked" — a real bug independent of
    this session's request, not just new-feature wiring.
  - **ISO 16889**: β vs. % Test Time / β vs. Element ΔP (Figures C.4/C.5) — the
    standard's OWN figures draw one line per particle size (up to 16); Compare's
    version needs one size PICKED first (`multiSize: true` on the curve spec, a new
    size `<select>` in the toggle palette, same "pick one, one line per file across
    the comparison" shape the particle-size picker already uses for raw counts).
    Found and fixed a real label-matching bug while wiring this in: the standard's
    own series labels are `">4 µm(c)"`, not the generically-assumed `"4 µm"` — a
    plot silently showed "not present in" every file until traced. Fixed with an
    explicit `sizeLabelFor(size)` per multiSize curve, reading the exact format
    each standard's own mapper actually uses rather than assuming one shared shape.
- `compareTemplates.js`'s `StandardPlotSpec` gained an optional `size` field;
  `specsMatch` compares it too (two β-vs-time plots for different sizes are
  different plots).
- `chartData.js`'s `buildComparisonStandardCurveDataset` gained an `xAxisLabel`
  parameter (was hardcoded to "Particle size (µm)" — wrong for a DP/mass/flow
  x-axis); every pre-existing caller keeps its exact prior behavior when omitted.
- New `tools/render-check/compare-standard-curves-check.js` — drives every new
  curve through the real UI, including the multiSize size-picker's disabled ->
  enabled transition and the ISO 3968 sensor-less path.
- **Found right after, per the user**: the standard PICKER `<select>` itself (not
  the curve chips) mapped one `<option>` per row of `compareStandardCurveOptions()`
  — which is now one row per CURVE, not per standard — so any standard offering more
  than one curve (every standard now) showed as several identical, indistinguishable
  duplicate entries, all silently setting the same `pickerStandardId` (hence
  "clicking any of them reveals the same options"). Fixed by deduplicating by
  standard id before building the `<option>` list (`compareTemplateView.js`);
  `compare-standard-curves-check.js` gained a regression assertion for it.
- Cache version: webreportwriter-v152

## 2026-08-12 — Compare Files: declared-but-empty channels no longer offered
Per the user, found against a real file (ROTest9): a `.DAT` file's Data Format
header can declare a channel tag that no row actually has room for — ROTest9
declares 21 analog tags but every row only carries 13 values, so the trailing 8
(`TS_Cond_Temp`, `INJ_Conductivity`, `TS_Volume`, `INJ_Volume`, `TS_FinalDPress`,
`Ambient_Humidity`, `Aux3`, `Aux4`) parse to `null` at every single row, not just a
few missing samples. Previously these still showed up as toggleable options in
Compare Files' channel picker, with nothing to plot behind them.
- New `channelHasData(df, tag)` (`src/core/charts/chartData.js`) — true only if at
  least one row has a real value, not just whether the tag is declared in
  `analogTags`.
- `commonDimensions()` (`compareFiles.js`) now skips a declared-but-empty tag when
  building each file's contribution to the Channels list — same treatment as a tag
  the file never declared at all. If every loaded file's copy is empty, the channel
  never appears in the picker.
- `buildComparisonChannelDataset` and `computeMassAddedSeries` (mass added's own
  `INJ_Rate` read) apply the same rule when RESOLVING a plot, not just when listing
  options — so a saved template's plot, replayed against a file where the tag turns
  out empty, is named in `missing` instead of silently rendering a blank line.
- Verified against the real ROTest9 fixture (`tools/render-check/Test DAT files/
  TwinFSRig-ROTest9-MP.DAT`): all 8 empty tags confirmed absent from the channel
  list, real channels (e.g. `TS_DPress`) confirmed still present.
- Cache version: webreportwriter-v150

## 2026-08-12 — Compare Files: a derived "Mass Added" curve
Per the user: a mass-added field, tacked onto Compare Files' channel picker, for
plotting how much dust has been injected over time across a comparison set. Answered
via clarifying question: integrates the real `INJ_Rate` channel (a running
trapezoidal integral), not a straight line from the file's average rate.
- **`computeMassAddedSeries(df)`** (`src/core/charts/chartData.js`) — cumulative
  injected mass (g) at every row: `GravimetricLevel` header (mg/L) × a running
  trapezoidal integral of the `INJ_Rate` channel (mL/min) against the file's own
  elapsed time. Same `Gia × Qia × time / 1,000,000` conversion every standard's own
  scalar `injectedMass`/`dustInjected` figure already uses — at a constant rate the
  two are identical by construction (verified: this file's SpinOnMP.DAT fixture
  integrates to the same ~46.8 g the ISO 4548-12/19438 selfchecks already pin down
  as that file's scalar total) — just integrated point-by-point so the curve shows
  real injection-pump behavior (ramp-up, pauses) instead of a straight line. A gap
  in `INJ_Rate` (null sample) is bridged using the two nearest valid samples rather
  than guessing a rate.
- Reads the header `GravimetricLevel`, not a hand-entered lab-measured
  initial/final average — Compare Files only ever has the parsed `DataFile`, never
  a `ReportValueStore` (by design, see `compareFiles.js`'s own file-top note), so
  that's the only Gia this context can read. Matches ISO 4548-12/ISO 19438's own
  `gia` field exactly; for ISO 16889 files this can differ slightly from that
  standard's own Page 1 Mass Injected total, which prefers a hand-entered average
  when the gravimetric dialog has been run — not reachable here by construction.
- **Not gated by standard/test-type.** Checked by hand against a real P-Q (ISO
  3968) fixture expecting it to be naturally excluded (no dust injection in that
  standard) — disproved: the rig logs `GravimetricLevel`/`INJ_Rate` unconditionally
  regardless of which standard's test is running, so a P-Q file has both
  ingredients too. Compare Files has no standard-id to gate against in the first
  place, and gates no other channel by test-type today, so this offers "Mass
  Added" wherever a file has both ingredients, same as any other channel — the
  user judges relevance the same way they already do for every other raw channel.
- Surfaced as a **synthetic channel** (`MASS_ADDED_CHANNEL_TAG`, never colliding
  with a real analog tag) in `commonDimensions()`'s Channels list
  (`compareFiles.js`) and the toggle palette (`compareTemplateView.js`) — not a new
  `PlotSpec` kind, since `{kind:"channel", channelTag}` already round-trips through
  saved templates with no changes needed. Replaces the long-stale
  `buildComparisonMassDataset` stub (its "engine doesn't compute mass yet" reasoning
  was outdated — all three multipass engines already do).
- New `src/core/charts/chartData.selfcheck.js` (hand-verified constant-rate,
  ramping-rate, gap-bridging, and missing-ingredient cases) and
  `tools/render-check/compare-mass-added-check.js` (drives the real toggle
  palette/plot/print path).
- Cache version: webreportwriter-v149

## 2026-08-12 — Audit Trail: its own standard switcher + a new "Data File Explorer" audit
Per the user: give the Audit Trail a Report-style standard switcher, reachable
without detouring through Report first, and — as one more entry in that same
switcher — a new audit trail for the Data File Explorer's own raw parsing (index
relations: sizes/analogs tracking the right columns, rows tracked properly).
- **New `#auditSwitch`** (index.html/app.js), expanding under "Audit Trail" the
  same way `#standardSwitch` expands under "Standard Report" — but a genuinely
  separate element and state, not a re-skin of `#standardSwitch`: only lists what's
  actually auditable (the 4 active standards, never the frozen ISO 16889 Legacy
  Report's own switcher still offers) plus "Data File Explorer". Extracted the
  standard-switching logic Report's `#standardSwitch` already had into a shared
  `selectStandard(id)` (full re-analysis, tare prompts, both switchers' active
  buttons kept in sync) so there's exactly one implementation, called from either
  picker — not two kept in sync by hand. New `auditSelectedId`/`effectiveAuditId()`
  track the Audit view's OWN selection independent of `currentStandardId`, since
  "Data File Explorer" isn't a real standard and must not become one just by being
  picked (Report/Explorer stay on whatever standard was already active).
  `runAnalysisPipeline` now also refreshes the Audit view when it's the one
  currently visible (mirrors the existing always-refresh-Report behavior, but only
  when actually open — Audit isn't a frequently-visited tab worth rendering eagerly
  on every change the way Report is).
- **New "Data File Explorer" audit** (`src/explorer/explorerAuditSteps.js`) —
  unlike every other `<id>AuditSteps.js`, this one doesn't narrate a standard's
  calculations at all; it verifies `src/core/dataFile.js`'s own raw parsing.
  Registered as a special `"explorer"` key in `auditView.js`'s `AUDIT_STANDARDS`
  (skips the control-target section — not a real standard — and its raw-dump
  "Save as JSON" downloads the parsed `DataFile`, not an analysis object, with its
  own distinct filename suffix). Six steps, each verified against real sampled
  values, not just asserted in prose:
  - **Record shape detection** — how `repeat`/`fiveRowShape` get chosen from
    `lsSizes.length`/`midstreamFlag`, and what row order that implies.
  - **Row alignment** — every per-record array's length, with a pass/fail summary
    (a mismatch would mean a row got dropped/duplicated/misrouted somewhere).
  - **Row timestamps** — `timeRaw[i]` (the raw logged field) alongside `times[i]`
    (the converted elapsed-seconds value), sampled 1st/2nd/last.
  - **Analog channel column index** — `analogTags[i]` against `getChannel(tag)`'s
    own output (the SAME accessor every standard's engine uses — proves the real
    mechanism, not a second copy of it), sampled rows × channels.
  - **Count column index — LB/LS upstream/downstream** (one step per array this
    file's shape actually populates) — `<sensor>Sizes[i]` against the raw count
    value at column `i`, NO +1 offset (the opposite convention from analog columns
    on a superficially similar row shape).
- `auditSampling.js`'s `sampleWideTable` gained an optional `columnUnit` (default
  `"sizes"`, unchanged for every existing caller) — its disclosure note used to
  hardcode the word "sizes," which was actively wrong once reused for the analog
  table (channel tags aren't sizes); caught by actually looking at the rendered
  print PDF, not just the passing test.
- Verified: `run-all-selfchecks.js` (new `columnUnit` case), and
  `audit-view-check.js` extended with real assertions — `#auditSwitch` visible on
  Audit only, switching a standard from it without ever visiting Report, "Data File
  Explorer" leaves `currentStandardId` untouched, all 6 explorer steps present with
  real content, its own raw-dump filename/summary text, switching back to a real
  standard from explorer mode. All passed on the first run. Also checked real print
  PDFs for the explorer audit (all steps render cleanly, both LB and LS count
  tables show real distinct values).
- Cache version: webreportwriter-v148

## 2026-08-12 — Audit Trail: "Save as JSON" button on the raw analysis dump
Per the user: add a way to save the raw analysis object the trail already lets you
inspect (the collapsible "Raw analysis object" `<pre>` block at the bottom).
- `buildRawDump` (`src/audit/auditView.js`) now also takes `df`/`standardId` and
  renders a "Save as JSON" button (reusing the existing generic `button.act` style
  — no new CSS needed beyond a small `.audit-raw-actions` spacing rule) that
  downloads the exact same JSON already shown in the `<pre>`, named
  `<fileName>_<standardId>_raw-analysis.json` — `fileName` is `df.fileName` (the
  header's own self-recorded value, same convention the "Test file" section
  already uses; can differ from the uploaded filesystem name).
- New local `downloadJSON` helper — auditView.js's own copy of app.js's
  identical-purpose `download` function (plus revoking the object URL after the
  click, which that copy skips), duplicated rather than imported since there's no
  dependency between the two files in either direction (app.js imports
  `renderAuditPage` FROM `auditView.js`; the reverse would be circular) — same
  reasoning as every other tiny helper this file already keeps local.
  Already covered by the print stylesheet's existing `.audit-raw-details {
  display: none; }` rule — the button never appears on paper, same as the rest of
  the raw-dump section.
- Verified: extended `audit-view-check.js` to actually expand the details, click
  the button, capture the real Playwright download event, and confirm both the
  filename and that the downloaded file parses as the real analysis object (all
  10 clumps present).
- Cache version: webreportwriter-v146

## 2026-08-11 — Audit Trail: "Test file" identity section at the top
Per the user: show identifying details — file name, date run, operator — at the
top of each audit, before any of the standard's own derivation steps.
- New `buildFileIdentitySection` in `src/audit/auditView.js`, reusing the existing
  `buildStepEl` renderer (a plain step descriptor with `inputs`, no new rendering
  code needed) — shows File name / Test date / Test time / Operator, read straight
  off `df`'s header. Rendered ONCE, generically, for all four active standards —
  this content has no standard-specific narration at all (unlike everything else
  in the trail), so unlike the rest of the step list it does NOT live in any
  standard's own `<id>AuditSteps.js`; adding it required touching only
  `auditView.js`, not any of the four `AuditSteps.js` files.
- Field sources confirmed, not guessed: `df.fileName`/`df.fileDate` are DataFile's
  own parsed convenience properties (`FileName`/`TestDate` header keys); TestTime
  and Operator are read directly via `df.getHeaderValue("General Test
  Information", ...)` — the exact same keys every standard's own `Mapper.js`
  already reads for the report's own Operator/Test Date fields, so this is
  reusing an already-verified convention, not a new guess.
- Verified on real files for all 4 standards, including ISO 3968 (structurally the
  most different — a P-Q sweep, no clumps/buckets): the section renders first,
  before any derivation step, with real values (e.g. "File name:
  2023-033-5782-02MP | Test date: 6/19/2025 | Test time: 14:08 | Operator: RWP").
  Extended `audit-view-check.js` with real assertions (section present, positioned
  first, values non-blank for a loaded file). Prints normally — no print-specific
  handling needed, unlike the hover tooltips/raw JSON dump.
- Cache version: webreportwriter-v145

## 2026-08-11 — ISO 4548-12 / ISO 19438 Audit Trail: same bucket-window + size-picker treatment
Per the user: apply the same audit-trail depth work just built for ISO 16889 (below)
to the other two multipass standards — "how the bucket times were chosen, then a
table for each bucket where I can select a size and hover over to inspect the
actual count values used in the calculation."
- **New "Bucket window selection" step**, own copy per standard but the same
  underlying mechanism (confirmed identical in both engines by reading both):
  fixed clock grid, `bucketMinutes` = 5 or 10 depending on total test length,
  anchored at TEST START (not the disregard cutoff — the first `SKIP_MINUTES` of
  counts are disregarded entirely, which SHORTENS whichever bucket that cutoff
  falls inside rather than shifting every later boundary forward), each bucket's
  window START is the PREVIOUS bucket's last included time + 1 second (no shared
  boundary rows, no double-counting), each window's END stays pinned to the grid
  (clamped to the exact termination time for the last bucket). Shown in full (every
  bucket, not sampled), same reasoning as ISO 16889's reporting-time step. Simpler
  than ISO 16889's version: no separate "exact vs. rounded" time split needed, since
  a bucket's own window boundary IS both when ΔP is read (`bucket.dpAtEnd`) and what
  counts are summed over — one time reference, not two.
- **The "Time-bucket efficiency" table reversed from a static 3x3 sample to all
  buckets + an interactive size picker**, identical mechanism to ISO 16889's
  β-per-clump table (`auditWidgets.js`'s `buildSizePickerTable`, already generic/
  reusable from that work) — defaulted to the smallest measured size, hover a cell
  to see the actual per-count-cycle up/down readings summed into it.
- Needed `analysis.buckets[i].countRows` added to both engines'
  `_computeOneWindow` (own copies, iso454812Analysis.js and iso19438Analysis.js) —
  purely additive, a second trivial pass over the same `[startRow,endRow]` window
  the existing sum/average loop already computes, not a change to that loop.
  Fidelity snapshots reviewed (diff was exclusively new `countRows` fields
  appearing) and regenerated.
- Verified: extended `audit-view-check.js` with a shared `assertBucketWidget`
  helper run against both standards (bucket count matches the window-selection
  step, picker defaults to smallest size, changing it updates header/values/
  tooltip together) — the "one runnable check" for this interactive logic, same
  as ISO 16889's. Also checked real print PDFs for both — bucket window table and
  the size-picker widget both render cleanly.
- Cache version: webreportwriter-v144

## 2026-08-11 — ISO 16889 Audit Trail: β-per-clump table reversed to all-10-rows + size picker
Per the user: the earlier 3-row x 3-size SAMPLE for the β-per-clump table wasn't
what they wanted after all — reversed to showing all 10 clumps with an interactive
dropdown for which size's β to display (default: smallest measured size), keeping
the hover-tooltip count detail (called out as "extremely helpful") working for
whichever size is currently selected.
- New `src/audit/auditWidgets.js` — `buildSizePickerTable`, generic DOM-building
  presentation MACHINERY (unlike `auditSampling.js`'s pure-data helpers): a live
  `<select>` + table that re-renders its one size-dependent column (values AND
  hover tooltips) on selection change. Shared/standard-agnostic the same way
  `auditSampling.js` is; deliberately does NOT import from `auditView.js` to avoid
  the exact circular-import shape `auditSampling.js` was already split out to avoid.
- `auditView.js`'s step shape gained an optional `customBody: HTMLElement` field —
  `buildStepEl` renders it in place of a plain declarative `table` when present, so
  a standard's `AuditSteps.js` can supply genuinely interactive content without
  `auditView.js` needing any special-case knowledge of what that content is.
- `iso16889AuditSteps.js`'s "β ratio per clump" step now builds this widget instead
  of calling `sampleWideTable` — the only step affected; every other sampled table
  in the Audit Trail (overall averages, initial cleanliness, ISO 4548-12/19438's
  bucket tables, etc.) is unchanged, this was a targeted reversal for one table,
  not a wholesale rule change.
- Verified: extended `audit-view-check.js` with real assertions (all 10 rows
  present, picker defaults to the smallest size, changing it updates the column
  header/values/tooltip together) — this is the "one runnable check" for the new
  interactive logic, since it can't run standalone in Node like `auditSampling.js`'s
  own DOM-free selfcheck. Also checked a real print PDF: the `<select>` renders
  as a normal form control showing its current value, nothing broken on paper.
- Cache version: webreportwriter-v143

## 2026-08-11 — ISO 16889 bug fix: last clump's β dropped the terminal partial count cycle
Found by the user while using the new hover tooltips (above) to check the final
clump's count window against the raw data on a real file (`TwinFSRig-ROTest9-MP.DAT`).
- **The bug**: `_computeReportingTimeClumps`'s count-averaging window rounds its stop
  minute UP specifically to capture the final, necessarily-PARTIAL count cycle (a
  real test essentially never ends exactly on a whole minute) — but the very next
  line then clamped that rounded value back DOWN to the exact sub-minute termination
  instant (`Math.min(stopMin * 60, terminationTime)`), undoing the rounding and
  silently excluding precisely the cycle DURING which termination was detected. Per
  the user: the standard makes no recommendation privileging whole minutes over
  partial ones, and the control system keeps counting and stops as fast as it can
  AFTER the ΔP crossing — so that trailing partial cycle is the real, legitimate
  measurement of the termination moment, not stale data collected past a meaningful
  end point. Root cause confirmed by tracing the actual file: termination (37:33.1s)
  interpolates between real logged rows at 37:00 and 37:44 (a 44-second final cycle,
  the file's very last row) — the old code excluded that 37:44 row because
  2264s > terminationTime (2253.1s), even though `stopMin*60` (2280s) already
  rounded up to include it.
- **The fix**: `stopSec` is now just `stopMin * 60` — no clamp to `terminationTime`.
  Only ever changes behavior for the LAST clump (k=10) — for clumps 1-9 the clamp
  was already a no-op, since their `stopMin*60` is always well before
  `terminationTime`. `findRowRange` can't return rows beyond what's actually logged,
  so this is a safe widening, not a risk of reaching into nonexistent data.
- **Real numeric impact, not just display**: this changes an actual computed value —
  the last clump's `avgUp`/`avgDown`/`avgBeta`, and therefore
  `overallUpstreamAverage`/`overallDownstreamAverage`/`overallAverageBeta`/
  `sizeAtBeta` too (all derived from all 10 clumps). Verified end-to-end on
  ROTest9: the last clump's 4µm β cell's hover tooltip now shows 4 rows (35:00,
  36:00, 37:00, 37:44) instead of 3, with the 37:44 row's counts folded into the
  sum. Fidelity snapshot reviewed and regenerated (`SpinOnMP.DAT`'s own termination
  also falls mid-cycle, as expected — same trailing-row correction there too).
- Cache version: webreportwriter-v142

## 2026-08-11 — ISO 16889 Audit Trail: reporting-time step + hover-tooltip count detail
Per the user: the 10 reporting-time TIMESTAMPS deserved their own explanation
separate from the β calculation, and a hover showing the raw counts behind a β
value would help confirm the math (accepted it won't do anything useful on paper).
- **New step "Reporting-time selection & count-averaging window"**, split out of
  the old "The 10 reporting-time clumps" step, shown in FULL (all 10 rows, not
  sampled — the whole point is watching the rule hold across the progression).
  Explains the two DISTINCT time references per clump that were previously only
  documented in code comments, not the audit trail itself: the exact `(k/10) ×
  terminationTime` reporting time (12.1/12.2 — what assembly ΔP is interpolated
  at) vs. the whole-minute-rounded count-averaging window (12.5 — what β is
  actually summed over, anchored to the PREVIOUS clump's rounded stop, not
  re-derived from the exact time, so rounding error never compounds).
- **The β step (renamed "β ratio per clump")** now states the literal formula
  (`β = min(Σup/Σdown, 100,000)`) and, per size/clump cell, a hover tooltip
  listing every count-cycle row's raw up/down counts that were actually summed
  into it — via a new `analysis.clumps[k].countRows` field
  (`iso16889Analysis.js`, purely additive: a second, trivial pass over the same
  row window the existing sum/average loop already computes, not a change to
  that loop). Verified the tooltip's own recomputed β matches the cell's real
  displayed value exactly (spot-checked: 4µm/clump-1 tooltip summed to 4271.3,
  identical to the table cell).
- New reusable mechanism, not ISO-16889-specific: `auditSampling.js`'s
  `sampleWideTable` gained an optional `cellTitle` callback (generic MACHINERY —
  which cell, what tooltip text — no opinion on content, so available to any
  standard's future wide table); `auditView.js`'s `buildTable` renders it as a
  native `title` attribute with a `.has-tooltip` dotted-underline CSS hint,
  explicitly suppressed under `@media print` since hovering can't happen on paper.
- Verified: all fidelity snapshots (the `countRows` diff was reviewed by hand —
  purely additive, only that one new field appeared), a new `auditSampling.selfcheck.js`
  case for `cellTitle`, `audit-view-check.js`, and a real print PDF (10-row
  timestamp table and the β table both render cleanly; no leftover dotted
  underline on paper).
- Cache version: webreportwriter-v141

## 2026-08-11 — Audit Trail: rating/size-interpolation steps now show the literal formula
Per the user: ISO 4548-12's "Micrometer rating" step's `clause` text ("Reverse
interpolation (plain-linear, bounded 0-100%) against the Overall efficiency curve
above") described WHICH KIND of interpolation was used, but not the actual
calculation — even though the bracket inputs (lower/upper size, lower/upper eff%)
were already sitting right there in the table. Same gap existed in ISO 19438's two
filter-rating steps and, to a lesser extent, ISO 16889's Size_At_Beta_x (which had
a `formula` field, but it also only named the interpolation TYPE, not the equation).
- `iso454812AuditSteps.js`'s "Micrometer rating" and `iso19438AuditSteps.js`'s
  "Filter rating — Initial (E6) curve"/"Filter rating — Overall curve" steps now
  have a proper `formula` field with the literal equation: `Size = lowerSize +
  (targetEfficiency − lowerEff) × (upperSize − lowerSize) / (upperEff − lowerEff)`,
  the exact plain-linear interpolation `sizeGivenEfficiencyDetail` performs. The
  descriptive "which curve, bounded 0-100%" text moved to `clause` where it belongs.
- `iso16889AuditSteps.js`'s Size_At_Beta_x formula expanded to include its own
  literal equation too: `Size = lowerSize + (upperSize − lowerSize) × (ln(targetβ)
  − ln(lowerβ)) / (ln(upperβ) − ln(lowerβ))` — the log-linear form
  `sizeGivenBetaDetail` actually computes.
- Content-only; no engine or table-data change. Verified via a real print PDF for
  both standards — the formula box now renders the equation directly above the
  bracket table it explains.
- Cache version: webreportwriter-v140

## 2026-08-11 — Audit Trail reveal no longer persists across a reload
Per the user: the hidden Audit Trail route must not carry its unlocked state over
to a new instance of the program. Reversed the original design (which deliberately
persisted via `localStorage` so a developer wouldn't repeat the gesture every
reload — see the Audit Trail's own original CHANGELOG entry below).
- `app.js`'s Ctrl+Alt+Shift+Click handler no longer reads/writes
  `webreportwriter-audit-unlocked` at all — purely in-memory now, so every fresh
  page load starts hidden and needs the gesture again.
- Found and fixed a second, related leak while making this change: `"audit"` was
  also in `VALID_VIEWS`, the last-view-restore list (`webreportwriter-last-view`)
  — so a developer who unlocked it, opened it, then reloaded would land right back
  on the Audit Trail's rendered CONTENT on startup even with the button hidden,
  bypassing the reveal gesture entirely rather than merely requiring it again.
  Removed `"audit"` from `VALID_VIEWS` (so a stale stored value is never honored)
  and `showView` no longer persists `"audit"` as the last view in the first place.
- `tools/render-check/audit-view-check.js`'s own persistence assertion inverted to
  match: now confirms BOTH the button and the view itself are hidden after reload.
- Cache version: webreportwriter-v139

## 2026-08-11 — Audit Trail: termination/bracket/milestone times also displayed as H:MM:SS
Follow-up to the bucket-window formatting fix below — the user pointed out ISO
16889's termination time was still showing raw seconds ("2253.1 s"). Extended the
same display-only `AnalysisMath.formatElapsed` treatment to every other elapsed-time
value in the termination-detection lens, across all 3 multipass standards
(`iso16889AuditSteps.js`, `iso454812AuditSteps.js`, `iso19438AuditSteps.js`):
termination time itself, its bracket's two sample times, and the %-net-ΔP
milestone table's "Bracket t1"/"Bracket t2" columns. "2253.1 s" now reads "0:37:33",
matching the report's own termination-time display exactly. Display-only, verified
against the real ROTest9 file end-to-end (termination step, bracket inputs, and the
full milestone table all render correctly in H:MM:SS, no console errors) — no
change to any stored/computed value or the fidelity snapshots. ISO 3968's per-point
"Time (s)" column was deliberately left alone: unlike termination/milestones, no
report page anywhere displays a P-Q sweep point's time as elapsed H:MM:SS, so
there's no report convention to match there.
- Cache version: webreportwriter-v138

## 2026-08-11 — Audit Trail: bucket windows displayed as H:MM:SS, not raw seconds
Per the user: ISO 4548-12/19438's time-bucket calculation deliberately stays in
SECONDS (a count cycle isn't guaranteed to be exactly 1 minute, and the standard's
disregard/window cutoffs are minutes-of-test, not count-cycles — that's not
changing), but the Audit Trail's bucket table was displaying that raw-seconds window
("181–600") instead of the same H:MM:SS format the report itself already uses for
termination/milestone times. `iso454812AuditSteps.js`/`iso19438AuditSteps.js`'s
bucket table now formats each window's start/end through `AnalysisMath.formatElapsed`
(reached as the same classic-script global these files already use for
`window.Iso454812Analysis`/`window.Iso19438Analysis`) — "0:03:01–0:10:00" instead of
"181–600". Display-only; no change to `bucketMinutes`/`startTime`/`endTime` or any
computed value. ISO 16889's clump table needed no change — its own window is already
computed and displayed in whole minutes.
- Cache version: webreportwriter-v137

## 2026-08-11 — Audit Trail: hide control-target rules not applicable to the loaded file
Follow-up to the fixes below, per the user: a rule table that unconditionally lists
every real naming variant for a quantity (e.g. ISO 16889's Sensor Flow Rate — LB/LS-
prefixed for an ExRaDs extended-range rig vs. plain for a single-sensor rig) was
dumping every non-matching variant into the Audit Trail's control-target table as a
bogus "target not found" row — noise, not signal, for the file actually loaded.
`buildControlTargetsSection` (`src/audit/auditView.js`) now filters to `applicable`
rules only, same "not applicable is not a failure" semantics app.js's own warnings
dialog already uses (`results.filter(r => r.applicable && !r.ok)`) — just extended to
also hide the passing-but-inapplicable ones, since a bare compliance table has no
"only show failures" reason to keep them. Dropped the now-redundant "Applicable"
column (every remaining row is, by construction); added a one-line disclosure note
("N rules not applicable to this file's configuration omitted") so it's clear rows
were filtered, not that the rule table only has 5 entries. Verified against the real
ROTest9 file: control-target compliance now shows exactly its 5 applicable rules
(Test Flow Rate, Sensor Flow Rate ×2, Temperature, Conductivity) instead of 9.
- Cache version: webreportwriter-v136

## 2026-08-11 — ISO 16889: single-sensor Sensor Flow Rate + Downstream_Sample_Flow (Qd) bug fixes
Found by the user while reviewing the new Audit Trail content depth (below) against a
real single-sensor file, `TwinFSRig-ROTest9-MP.DAT` ("ROTest9"). Two real bugs, both
from the same root cause: `iso16889Analysis.js`/`iso16889ControlTargets.js` had only
ever been confirmed against ExRaDs extended-range dual-sensor files (LB/LS-prefixed
channel and header naming), not a plain single-sensor rig.
- **Sensor Flow Rate control-target rows falsely failed** with "Target value not
  found in header (Dilution System Configuration / LBSensorFlow)" on a single-sensor
  file — it has no `LBSensorFlow`/`LSSensorFlow` header keys at all, only unprefixed
  `SensorFlow,25,25`, with live channels `UpSensor`/`DnSensor` (not `aQLBU`/`aQLBD`).
  `iso454812ControlTargets.js` already had this exact generic naming confirmed (its
  own comment even flagged it as unconfirmed for ISO 16889 specifically) — added two
  new unconditional rows to `iso16889ControlTargets.js` ("Sensor Flow Rate
  (upstream)/(downstream)", `UpSensor`/`DnSensor` against header `SensorFlow`)
  alongside the existing LB/LS-prefixed rows, same "list every real variant, let
  channel-presence sort out which applies" pattern already used for LB vs LS itself.
- **`Downstream_Sample_Flow` (Qd, feeds 13.2's Dust_Retained formula) was reading the
  wrong channel entirely** — averaging the sensor-flow channel (`aQLBD`/`aQLSD`, or
  on a single-sensor file, nothing, hence "no value" in the trail) instead of the real
  dilution `SampleFlow` header setpoint, a ~5x-larger, physically different quantity.
  Own copy of the exact mistake `iso19438Analysis.js`'s Qd had before its 2026-07-31
  fix — never ported to iso16889 at the time. Fixed the same way: `qd` now reads
  `Dilution System Configuration`'s `SampleFlow` header value directly (own
  `HEADER_SAMPLE_FLOW` constant), not a live channel — removed the now-dead
  `upFlowTag`/`downFlowTag` fields from `SENSOR_CHANNELS`. This wasn't just a display
  bug: any file WITH an `aQLBD`/`aQLSD` channel present would have silently computed
  Dust_Retained against the wrong flow rate, not just shown a blank Qd.
  Fidelity snapshot updated (`qd: 25.04 -> 125` on the `SpinOnMP.DAT` fixture,
  reviewed and confirmed correct — matches its own header's `SampleFlow` exactly).
- `src/core/dataFile.js`'s Dilution System schema note updated to document the
  single-sensor rig's plain `SensorFlow`/`UpSensor`/`DnSensor`/`UpRatio`/`DnRatio`
  naming alongside the extended-range `LBSensorFlow`/`aQLBU`/`aQLBD` naming it
  already had — the single source of truth for `.DAT` format knowledge, per CLAUDE.md.
- Cache version: webreportwriter-v135

## 2026-08-10 — Audit Trail content depth: interpolation brackets + representative sampling
Follow-up to the Audit Trail view below, after reviewing its shipped content: showing
a result wasn't enough — an interpolated value needs its actual inputs, and a huge
per-size/per-clump table needs to prove a rule holds without dumping every cell.
- **Interpolation transparency**: every step that interpolates a value now shows the
  two real bracketing measured points it came from, not just the final answer.
  Termination detection and the %-net-ΔP milestones show `{before,after}` (time +
  value) via a new `AnalysisMath.findCrossingBracket` (in `src/helpers/
  analysisMath.js` — `findCrossingTime` is now a thin wrapper around it), exposed as
  new `analysis.terminationBracket` / each milestone's own `.bracket` field on
  iso16889/iso454812/iso19438's engines (single- AND dual-filter termination paths).
  Size_At_Beta_x, micrometer rating, and ISO 19438's Initial/Overall filter ratings
  show `{lowerSize, lowerBeta/Eff, upperSize, upperBeta/Eff}` via each engine's own
  new public static — `sizeGivenBetaDetail` (iso16889) / `sizeGivenEfficiencyDetail`
  (iso454812, iso19438) — called directly from that standard's own `AuditSteps.js`.
  All additive: the existing `_sizeGivenBeta`/`_sizeGivenEfficiency`/termination-time
  logic now just delegates to the richer version, zero behavior change to any
  existing caller — verified via the fidelity snapshots (regenerated, diff reviewed
  by hand: only the new bracket fields appeared, nothing else moved).
- **Representative sampling** for the large per-size/per-clump/per-bucket/per-point
  tables, instead of a full dump: new `src/audit/auditSampling.js`
  (`sampleTable`/`sampleWideTable`, generic MACHINERY shared across all 4 standards'
  `AuditSteps.js`, per CLAUDE.md — has no opinion on a table's content). Picks
  1st/2nd/last ROWS (proves a rule holds across consecutive clumps/buckets/points)
  and, for "wide" tables with one column per size (clumps, buckets), ALSO
  1st/middle/last SIZE COLUMNS (proves indexing is correct across the full measured
  range) — e.g. ISO 16889's 10-clump × 32-size table becomes 3 × 3, clearly labeled
  ("1st"/"2nd"/"middle"/"last"), with a "showing N of M" disclosure note. Full,
  un-sampled data still lives in the existing raw JSON dump. New self-check:
  `src/audit/auditSampling.selfcheck.js` (added to `run-all-selfchecks.js`).
- All 4 standards' `<id>AuditSteps.js` rewritten to use both of the above. Verified
  with `run-all-selfchecks.js`, `audit-view-check.js`, and real print PDFs
  (`pdf-audit.js`) for all 4 standards — bracket columns and sampled tables render
  correctly on paper, no console errors.
- Cache version: webreportwriter-v134

## 2026-08-10 — Analysis fidelity tests + a hidden Audit Trail view
- **Fidelity tests**: every active standard (ISO 16889, ISO 4548-12, ISO 19438 —
  new; ISO 3968 — extended) now has an `<id>Analysis.selfcheck.js` that combines
  hand-verified formula/invariant spot checks (targeting the two documented past
  regressions in ISO 4548-12: the `_computeOneWindow` off-by-one, the gravimetric
  1000x unit bug) with a snapshot diff against a committed baseline
  (`tools/render-check/fidelity-snapshots/<id>.snapshot.json`). A snapshot only
  changes when a developer deliberately re-runs with `UPDATE_SNAPSHOTS=1` and
  reviews/commits the result — catches drift in ANY derived field, not just ones
  someone remembered to assert on. Each check also runs that standard's own
  `applyParsedFile()` mapper, not just the raw analysis engine — ISO 4548-12 and
  ISO 19438 both compute `dpElementClean`/`dpFinalNet` in their MAPPER, not their
  engine, so analysis-only testing would never have exercised those fields.
  New shared helper: `tools/render-check/fidelitySnapshot.js`. New orchestrator:
  `tools/render-check/run-all-selfchecks.js` (one command, one consolidated
  pass/fail summary, runs all 5 selfchecks including `compareTemplates`'s).
  Verified the regression-catching actually works: deliberately broke a real
  formula, confirmed both the spot check and the snapshot diff caught it, reverted.
- **Audit Trail**: a new hidden, developer-only 4th view narrating a loaded file's
  full derivation — every averaging window, every formula substitution — step by
  step, for checking a standard's math against its own published clause text.
  Reached by Ctrl+Alt+Shift+Click on the sidebar's status text (no URL param, no
  visible affordance — never surfaced to a customer), persists via `localStorage`.
  No separate file-load pipeline: reads `store.getExtra("sourceAnalysis")`/
  `("sourceDf")`/`("controlResults")`, the same mechanism reportView.js's report-
  figure charts already use, so opening it never re-parses or re-analyzes
  anything. New files: `src/audit/auditView.js` (generic step-card/table
  renderer) + one `<id>AuditSteps.js` per active standard (report CONTENT, never
  shared — each narrates that standard's own `analysis.*` fields in clause
  order). v1 narrates only what each engine already exposes — no changes to any
  shipped calculation code. `iso16889legacy` has no audit trail (frozen,
  excluded on purpose).
- **Audit Trail printing**: added `printAuditBtn` to Audit's own toolbar (same
  `window.print()` pattern as Report/Compare's own print buttons). Unlike
  Report/Compare, no Chart.js canvases live on this view, so none of their JS-
  timing print problems apply — plain CSS handles it entirely; verified against a
  REAL print PDF (`tools/render-check/pdf-audit.js`), not just emulated print
  media, confirming a page.pdf()-based check IS trustworthy here (ordinary HTML
  tables shrink their own columns to fit the page, unlike a canvas's JS-forced
  pixel size — see WISHLIST.md's "Known bugs" entry on why that's NOT true for
  multi-canvas pages elsewhere in this app). Also fixed a real formatting bug
  found while building this: three gravimetric/flow-rate table cells (across all
  3 multipass standards' `AuditSteps.js`) were pre-concatenating a raw,
  unrounded number with its unit as a string, which bypassed auditView.js's own
  `fmt()` rounding entirely (printed as e.g. "63.144056467711664 L" instead of
  "63.144 L") — fixed by moving the unit into the row label and passing the raw
  number through, matching the convention already used successfully everywhere
  else in these files.
- Cache version: webreportwriter-v133

## 2026-08-10 — Compare Files print fixes
- Fixed: the builder UI (file shelf, template manager, dimension summary/channel
  toggles, sizes/standard-curve picker) was printing along with the actual report
  pages — none of it had print-hiding rules. Now only `.compare-pages` prints,
  matching the single-file Report's own "chrome vs. content" split.
- Added a `min-width:0` fix on `.compare-plot-box`/`.chart-wrap` + `canvas{max-width:
  100%}` — a CSS Grid item's default `min-width:auto` was keeping the 2/4-up columns
  from narrowing to the real print-page width, since a canvas's already-painted pixel
  size doesn't shrink on its own.
- **The real fix for blank printed plots**: Compare's print path used to call
  `rerenderCompare()` — a full teardown + rebuild of the whole template/palette/
  pages DOM, including brand-new `<canvas>` elements — from inside the `beforeprint`
  handler itself. Every chart Chromium's print pipeline had to rasterize therefore
  sat on a canvas that had never been laid out or painted before that same
  synchronous handler ran. The single-file Report never had this problem: its
  canvases are part of the static page template and already exist (already painted
  at least once on screen) well before `beforeprint` fires — `redrawReportCharts`
  only ever redraws INTO them. Added `redrawComparePlots` (`compareTemplateView.js`)
  to give Compare the same property: it redraws onto the SAME already-existing
  canvases (via a stashed `canvas._compareChartRedraw` closure) rather than
  rebuilding anything, and app.js's print hooks now call it instead of
  `rerenderCompare`. `rerenderCompare`/`renderCompareView`/`renderCompareReport` all
  dropped their now-unused `paperSize` parameter as part of this — print sizing is
  no longer threaded through the normal rebuild path at all.
- Along the way, initial investigation (via `tools/render-check/pdf-compare.js`'s
  `page.pdf()`-based testing) wrongly concluded this was a pre-existing, app-wide
  bug also affecting the single-file Report's multi-figure pages. The user supplied
  a real printed PDF showing the Report's own multi-chart pages (Figures B.2/B.3;
  Add Count Details' Upstream/Downstream) rendering correctly, disproving that — the
  automated `page.pdf()` tool itself doesn't faithfully reproduce real print output
  for multi-canvas pages, independent of any app bug. See `WISHLIST.md`'s "Known
  bugs" section for the full corrected account; `pdf-report.js`/`pdf-compare.js` now
  carry a header warning not to trust that specific case from them.
- New dev tooling: `tools/render-check/pdf-compare.js` (real print-PDF generation
  for a Compare template, mirrors `pdf-report.js`), `pdf-compare-single.js`, and
  `pdf-454812.js` (reproduces the user's own working multi-chart case for
  comparison).
- **Still needs a real print to confirm** the `redrawComparePlots` fix actually
  resolves what the user saw, since `page.pdf()` can no longer be trusted as the
  verification method for this specific scenario.
- Cache version: webreportwriter-v131

## 2026-08-07 — Compare Files: custom, printable comparison report templates
- Replaces the old radio+dropdown single-chart picker with a toggle palette: click a
  channel, a particle-size group (up to 3, combined onto one plot — unchanged from
  before), or (new) a standard's own size-indexed curve (ISO 16889's Overall Average
  Filtration Ratio (β) vs. Size; ISO 4548-12/19438's Overall Efficiency vs. Size) to
  add/remove it from the active template. Plots auto-flow across 2-or-4-plot pages
  (`compareTemplates.js`'s `retile`), printable the same page-break-after way the
  single-file Report view already is.
- Templates are named, saved, reusable shapes — independent of which files happen to
  be loaded (same split `customTabs.js` already established for single-file plot
  tabs) — save/load via new "Save/Load comparison templates" buttons
  (`compare_templates.json`).
- Standard-derived plots run that standard's own `run()`/`applyMapper()` (read-only,
  into a throwaway `ReportValueStore`) — the first time Compare Files touches a
  standard's analysis engine at all. A file that doesn't validate under a given
  curve's standard is named as excluded, not silently dropped or crashed on.
- Per the user's own follow-up call: a template can hold standard-derived curves from
  SEVERAL different standards side by side (e.g. ISO 16889's β-vs-size AND ISO
  4548-12's efficiency-vs-size on the same page) — each `standardPlot` spec carries
  its own `standardId`/`sensor` rather than the template picking just one. The
  standard/sensor pickers in the palette are a transient "what to add next" control
  (`app.js`'s `compareCurvePickerStandard`/`Sensor`), not template state.
- Per the user: the dimension summary's "Channels" tags ARE the toggle control once a
  template is active (click a channel tag to add/remove its plot) — an earlier pass
  of this feature had accidentally built a second, separate, redundant channels list
  in the palette below instead of turning the existing readout into the buttons.
  `compareView.js`'s dimension summary moved into `compareTemplateView.js` so it can
  see the active template; LB/LS size tags stay read-only there (their own picker
  below needs a multi-select-then-commit step regardless).
- Fixed: the particle-size sensor picker no longer offers LS Up/Down Counts when
  none of the loaded files actually have LS data (was previously always listing all
  4 sensors regardless of what the files contained, per `comparisonSensorOptions`'s
  static list — now filtered against `commonDimensions`' actual `lsSizes`/`lbSizes`).
- New files: `src/compare/compareTemplates.js` (+ `.selfcheck.js`),
  `src/compare/compareTemplateView.js`. `compareView.js` shrinks back to the file
  shelf + delegating to the report builder.
- **Printing reached the Compare tab.** All the print-sizing plumbing
  (`.compare-report-page`/`.compare-plot-grid` page-break CSS, `computePrintPlotSizePx`,
  `renderComparisonChart`'s new `explicitSizePx` param, `rerenderCompare(paperSize)`
  wired into the existing `beforeprint`/`afterprint`/`matchMedia` hooks) was already
  built in this same pass, but there was no actual way to REACH it: `printBtn` and
  `paperSizeSelect` both lived only inside `#context-report`, invisible while on the
  Compare tab. Fixed by moving `paperSizeSelect` to the sidebar (it applies regardless
  of mode now, not just to the single-file report — one shared setting) and adding a
  `printCompareBtn` ("Print comparison report") to `#context-compare`, same
  `window.print()` action as the report's own button, just its own label.
- Cache version: webreportwriter-v130

## 2026-08-05 — ISO 3968: ⓘ info icon on Filter rated flow rate (qR)
- Per the user: a small ⓘ icon next to the Filter rated flow rate (qR) field on
  Page 1, explaining it needs to be filled in for Page 2's Flow Ratio column to
  show anything. Native `title`-attribute tooltip, same shape
  `applyControlWarningMarkers`' existing ⚠ field markers already use (`.field-warn`
  in `app.css`) — no new JS/framework, just a new neutral-colored `.field-info`
  class since this one is a static hint written directly in the template, not a
  JS-inserted conditional warning. Screen-only (a hover tooltip means nothing on
  paper), hidden under `@media print`.
- Cache version: webreportwriter-v121

## 2026-08-05 — ISO 3968 Figure 4: curve fit lines + always-on legend
- Per the user ("I'd like the curve fit plotted as well, but I don't see it and I
  don't see a legend"): Figure 4 previously only ever drew the raw measured Filter
  Assembly ΔP points, plus (once a tare was supplied) the net Filter Element ΔP on
  the second axis — the curve fits themselves, added to the analysis a pass ago,
  were never actually drawn. Now Filter Assembly Curve Fit ΔP always plots (dashed,
  same left axis as the raw points), and Filter Housing Curve Fit ΔP (Tare) plots
  too once a tare is supplied — both sorted by flow rate rather than left in the
  raw points' file/time order, since each is a pure function of flow and a reversed
  sweep's raw hysteresis-loop order would otherwise make the fit line retrace
  itself. The legend is now always shown (previously only when a net series was
  present), so the series are actually identifiable (`chartView.js`'s
  `renderPQFigureChart`).
- **Fixed a real bug found while wiring this in**: the refactor introduced a filter
  using bare `isFinite(value)` to decide whether a fit value should be plotted —
  but `isFinite(null)` is `true` in JS (`Number(null) === 0`), so a not-yet-available
  fit (null — e.g. no tare supplied) was being plotted as a phantom point instead of
  correctly excluded. Caught by browser verification (the chart showed a "Filter
  Housing Curve Fit ΔP"/"Filter Element ΔP (net)" series even before any tare file
  was supplied) before it shipped. Fixed with an explicit null/undefined check
  ahead of `isFinite`.
- Cache version: webreportwriter-v120

## 2026-08-04 — ISO 3968 Page 2 table: fixed a real header-wrapping bug
- The Page 2 Average DP table's 7 headers were overflowing wide instead of wrapping
  — root cause: a pre-existing, overly broad `th, td { white-space: nowrap; ... }`
  rule in `app.css` (meant for the Data Explorer's own `.tblwrap` tables) was leaking
  into every report table's headers, harmlessly for the short 1-2 word headers other
  standards use, but forcing this table's longer multi-word headers onto one
  un-wrapping line and blowing the table out wide. Fixed at the root:
  `table.datatbl th` now sets `white-space: normal` explicitly.
- Also gave each of the 7 headers an explicit `<br>` at a natural word break (e.g.
  "Filter Assembly<br>Curve Fit ΔP") so they wrap at a clean, consistent point
  rather than wherever the browser happens to break the line
  (`templates/iso3968/iso3968_page2.html`).
- Cache version: webreportwriter-v119

## 2026-08-04 — ISO 3968: net DP via curve fits, qR fallback removed, tables merged
- **qR (Filter rated flow rate) is pure hand-entry again** — the previous pass's
  auto-derivation (max configured flow / 1.2) is REMOVED per the user: that was an
  assumption about the test setup, not a value the file stipulates. Flow Ratio now
  stays blank until the user actually types qR in (`iso3968Mapper.js`,
  `reportView.js`'s `fillIso3968AverageDpTables`).
- **Net (tare-subtracted) differential pressure is now computed**, closing the
  "NOT YET IMPLEMENTED" gap left in the ISO 3968 report-build entries below. Per the
  user: the assembly and tare runs' measured flow points routinely don't match, so a
  raw point-to-point subtraction doesn't line up — instead, BOTH the assembly's and
  the tare's ΔP-vs-flow curves get their own quadratic fit (ΔP = a·Q + b·Q², forced
  through the origin — new `fitQuadraticNoIntercept`/`evalQuadratic` in
  `analysisMath.js`, a generic curve-fit helper; which standard uses it and how is
  `iso3968Analysis.js`'s own decision, see its new `_fitCurves`/`_computeNetDP`), and
  Filter Element ΔP is the DIFFERENCE OF THE TWO CURVES, evaluated at each of the
  assembly's own measured flow rates.
- **Page 2's Average ΔP table is ONE merged table now, not two** — per the user,
  there's no reason for a full second tare table; "Filter housing" details are just
  extra columns on the assembly's own row. New column set: Measured Flow, Flow
  Ratio, Filter Assembly ΔP, Filter Assembly Curve Fit ΔP, Filter Housing ΔP (Tare —
  the tare run's own i-th raw point, blank past its own point count), Filter Housing
  Curve Fit ΔP (the tare's fit evaluated at the assembly's flow — this is what
  actually lines up mismatched flow points), Filter Element ΔP (Assembly − Tare).
  `templates/iso3968/iso3968_page2.html`'s `#pqTareBlock`/`#pqTareDpRows` are gone.
- **Figure 4 gains a second Y axis** for Filter Element ΔP (net) when present — per
  the user: "the differential will be plotted to the second Y axis." Absent entirely
  (no axis, no series, no legend) when no tare is supplied yet, rather than showing
  an empty/zeroed axis (`chartView.js`'s `renderPQFigureChart`).
- Cache version: webreportwriter-v118

## 2026-08-03 — ISO 3968 Flow Ratio: qR auto-derived, column shown as a percentage
- Per the user: their test setup always sweeps flow up to exactly 120% of the filter
  rated flow rate (qR) as its max configured point — a fixed ISO 3968 test-range
  convention, not something that varies file to file. `iso3968Mapper.js` now derives
  qR as `max(flowRateTargets) / 1.2` (the CONFIGURED targets, not the noisier
  measured points) and sets it as a From Data value — same tier as any other
  computed default (e.g. `iso19438Mapper.js`'s `testVolumeFinal`), still
  hand-overridable via the template's existing `data-editable`. Page 2's Flow Ratio
  column reads qR live at render time either way, so a hand override still flows
  through correctly.
- Per the user's explicit instruction, we are NOT attempting to derive Filter
  housing/Filter Element percentages, or any ratio not built from a stipulated qR —
  only the qV/qR ratio itself is computed, for every measured point.
- Table 1 and Table 2's Flow Ratio column now displays as a percentage
  (`(flowRate / qR) * 100`, e.g. "55.0%") instead of a raw decimal, matching the
  column header "Flow Ratio qV/qR (%)".
- Cache version: webreportwriter-v117

## 2026-08-03 — ISO 3968 report built and wired in: Page 1/2, Figure 4, tare workflow
- ISO 3968:2017 is now a fully selectable standard (new toolbar button), per the
  user's given page layout:
  - **Page 1** ("Table 3 - Report Sheet"): identification/operating-conditions
    fields (`src/standards/iso3968/iso3968Mapper.js`) + Figure 4 (Differential
    pressure vs. flow rate) on the SAME page — confirmed with the user, unlike every
    other standard's dedicated one-figure-per-page convention. `df.testSetup`-derived
    Spin On Yes/No normalizes real files' "Spin On"/"Spin-on"/"SPIN ON" spelling
    variance. Test Laboratory, Housing Identification, Substitute Element, Test Fluid
    Ref, and Initial Cleanliness are hand-entry only (no software-produced source
    exists for any of them, confirmed). Filter rated flow rate (qR) is now a derived
    From Data default, not hand-entry — see the entry below.
  - **Page 2** ("Test Results"): a 40-row static Average ΔP table (Flow Ratio qV/qR,
    Filter Assembly, Filter housing, Filter Element) — a CLOSED set of 4 possible row
    counts (6/12/20/40, matching the 4 mode/reverse combinations already detected),
    so this reuses the existing per-row `.rpt-slot-hidden` show/hide idiom
    (`fillB2Clump`/`fillSizeBlock`'s convention) rather than the unbounded
    page-cloning mechanism ISO 16889/19438 use for their own variable-length tables.
    Flow Ratio/Filter Assembly are computed LIVE at render time
    (`reportView.js`'s `fillIso3968AverageDpTables`) from the hand-entered qR, since
    qR is entered after the Mapper already ran. Filter housing/Filter Element stay
    blank — net DP needs a prescribed interpolation method, still not given. Bypass
    Valve Characteristics and Leakage Rate (4 fixed rows: 50/75/100/120% opening
    pressure) are pure hand-entry, the same established no-fallback `data-editable`
    pattern `iso454812Mapper.js`'s bypass-valve fields already use.
  - **Tare (empty-housing) file workflow** — genuinely new app-level UI: after a P-Q
    file loads, a new `src/report/tareEntryView.js` prompt asks whether to supply a
    tare run; declining leaves a new "Add Tare File" toolbar button available to add
    one later. Deliberately NOT built on the Compare Files (`CompareFileSet`)
    machinery — that's for N unordered peer files with no primary/secondary concept,
    a worse fit than a small dedicated `tareDf`/`tareFileName`/`tareFileText` state
    mirroring the primary file's own. Caught in end-to-end browser verification (not
    just the unit-level self-check): the prompt only fired when ISO 3968 was ALREADY
    the selected standard at file-load time — loading a file under a different
    standard and then switching to ISO 3968 never asked at all. Fixed by also
    calling the same prompt-check from the standard-switch handler, guarded by the
    same `tarePromptShown` flag so it still won't re-ask once answered. When
    supplied, its own points render as a
    SEPARATE second table block (Flow Ratio + Filter housing only — confirmed with
    the user, Filter Assembly/Element don't apply to a housing-only run), and its
    raw text round-trips through session save/load the same way the primary file's
    already does.
  - **Control targets**: Test Temperature (±1°C) and Conductivity (1,000-10,000
    pS/m) via the shared `controlTargetCheck.js` engine
    (`iso3968ControlTargets.js`); Test Flow (±5%) via the bespoke per-point
    `checkFlowRateCompliance` built in the previous entry (flow is the swept
    variable, not a constant, so it doesn't fit the shared engine's one-average-vs-
    one-target shape). No Injection/Dilution rules — confirmed unused during P-Q
    testing.
  - New `renderPQFigureChart` (`chartView.js`) + `buildPQFigureData` (`reportView.js`)
    for Figure 4 — copied from `renderMassPressureFigureChart`'s already-generic
    non-time-X-axis shape (proof this project's chart code was never hardcoded to a
    time X axis, just happened to only have time-X precedents before this).
- Cache version: webreportwriter-v116

## 2026-08-03 — ISO 3968 groundwork: file-structure parsing only, plus a real dataFile.js bug fix
- Started ISO 3968:2017 (P-Q — flow rate vs. differential pressure). Per the user,
  this pass is deliberately scoped to the BASIC FILE STRUCTURE only — no report
  content, no Mapper, no template, no app.js/STANDARDS wiring — since none of that
  has been specified yet. New `src/standards/iso3968/iso3968Analysis.js` (plus
  `iso3968Analysis.selfcheck.js`, the runnable check) reads a P-Q file and:
  - Validates `TestType` (only `"P-Q"` is this standard's own; others rejected with
    a clear redirect message, same shape as the other three standards).
  - Detects discrete (6-point) vs. continuous-sweep mode from the `ContinuosFlagStatus`
    header flag — confirmed against a real matched pair of files (identical `FlowRate`
    targets, differing only in this flag) that discrete mode produces exactly 6
    settled records and continuous mode produces a smooth uninterrupted ramp.
  - Detects an ascending+descending ("repeat in reverse") sweep purely from the
    shape of the recorded flow-rate sequence — confirmed there's no header flag for
    this at all; a real reverse file's `TS_Rate` climbs to a peak partway through
    (not at either end) then descends, exactly 40 records (20 up + 20 down).
  - Extracts raw `{time, flowRate, dp}` points from `TS_Rate`/`TS_DPress`, and (if a
    second DataFile is passed as a tare run) the tare's own points independently.
  - Deliberately does NOT compute a net (tare-subtracted) DP — the user confirmed
    interpolating the tare curve at each point's actual flow rate is the right shape,
    but the exact interpolation method still needs to be prescribed before that's
    built.
  - Also fixed: `TestType` is actually `"P-Q"` (hyphenated) in every real file, not
    `"PQ"` — the other three standards' (and the legacy engine's) `REJECTED_TEST_TYPES`
    all keyed on `"PQ"` and so never actually matched a real P-Q file; a real one fell
    through to a confusing "Unknown test type" error instead of the intended "that's
    ISO 3968's own report" message. Fixed the key in all four.
  - Control targets, per the user: new `src/standards/iso3968/iso3968ControlTargets.js`
    covers Test Temperature (±1°C) and Conductivity (1,000-10,000 pS/m, re-expressed
    as 5500±4500 to reuse the shared `controlTargetCheck.js` engine exactly) — both
    fit that engine's one-whole-test-average-vs-one-target shape fine. Test Flow
    (±5%) does NOT fit that shape (flow is the variable a P-Q test sweeps, not a
    constant) — implemented instead as a bespoke PER-POINT check
    (`Iso3968Analysis.checkFlowRateCompliance`): each point's actual flow against its
    nearest configured target. Injection/Dilution systems are confirmed unused during
    P-Q testing, so — unlike the other three standards — no rules for those at all.
- **Real `dataFile.js` bug found and fixed** while building the check above (not
  P-Q-specific — would have silently broken ANY standard reading a file shaped this
  way): some real files wrap the entire `;Data Format:` row — the prefix AND every
  channel name — inside one pair of quotes, so the old parser saw it as a single
  field and silently produced `analogTags = []` (zero usable channels) instead of
  erroring or warning. Fixed at the root by re-splitting that row's remainder when
  it comes back as a single field, rather than assuming per-field quoting. Verified
  no regression against a normal multipass file (channel count/order unchanged).
- Cache version: webreportwriter-v115

## 2026-08-03 — Dual-filter (series) pressure termination: "Two Pressure"/"Suction & Pressure"
- Built the dual-filter termination path (WISHLIST.md's item #2) all three standards
  (`iso16889`, `iso454812`, `iso19438`) previously rejected outright with "requires
  the dual-filter analysis path, which is not implemented yet." `TestSetup` values
  `"Two Pressure"` and `"Suction & Pressure"` both mean two physical filters tested
  in series (filter 1 = prefilter/suction, filter 2 = final filter) — confirmed real
  hardware, per the user.
- The shared `TerminalDP` header has gone through 3 generations of the control
  software, detected by how many comma-separated values it carries: 1 (an overall
  target only), 2 (filter 1 + filter 2 targets, no overall), or 3 (overall + filter 1
  + filter 2, with `-1` marking a target the operator didn't configure). "Overall"
  differential = `TS_PreDPress + TS_FinalDPress` summed sample-by-sample (no separate
  overall channel exists). The test ends at whichever ACTIVE target is reached FIRST.
- Display (which channel/target the %-net-ΔP milestone table and DP-vs-time chart
  show) is a separate concern from termination TIME: on a `MidstreamFlag:true` file,
  the existing sensor toggle (lb/ls) drives both particle-count data and pressure
  display together, per the user — never showing Filter 1's particle counts against
  Filter 2's pressure. If a file's header generation never configured an independent
  target for the viewed filter (the one real file's case — 1-value generation), the
  shared overall target is shown instead of leaving the milestone table/chart blank.
  On a `MidstreamFlag:false` file there's no filter-identity sensor toggle to reuse
  (LB/LS there means measurement technology, not filter identity) — a NEW toolbar
  "Pressure view" dropdown lets the user pick Filter 1/Filter 2/Overall, offering
  only whichever views that file's header generation actually supports.
- Dual-filter Setups now ALSO make the report title Non-Standard and suppress
  retained mass (Mnr/Cr / ISO MTD retained capacity) — same reasoning as
  `Multipass Series` test type: with two filters in series, it's not possible to
  attribute captured contaminant mass to one specific filter. This is a NEW,
  independent trigger alongside the existing TestType-based one; both combine in one
  title/note if both apply. Injected Mass is unaffected (not filter-specific).
- ISO 16889 only: the BUGL (12.12) acceptance-check warning is now suppressed when
  viewing Filter 2 on a `MidstreamFlag:true` dual-filter file — per the user, the
  particle-size distribution challenging Filter 2 is necessarily modified by having
  already passed through Filter 1, so there's no independently-known "what
  challenged Filter 2" quantity to compare a BUGL target against. Only the warning
  is suppressed, not the underlying computed value shown elsewhere on the report.
- New shared helper: `src/helpers/analysisMath.js`'s `sumChannels` (element-wise sum
  of two channel series) — standard-agnostic, used by all three engines' synthetic
  "overall" series.
- Cache version: webreportwriter-v114

## 2026-07-31 — Non-standard report title bugs: dropped edition year, missing Suction setup
- Per the user: the non-standard report title built last entry
  ("Non-Standard Single-Pass Test Reported to ISO 19438") dropped the standard's
  edition year — fixed to "ISO 16889:2022"/"ISO 4548-12:2017"/"ISO 19438:2023" in all
  three Mappers.
- A Suction-mounted single-filter test is analyzable (already in `SINGLE_FILTER_SETUPS`)
  but per the user is NOT a standard ISO test configuration, so it now also gets the
  Non-Standard title treatment — a NEW independent reason alongside non-standard test
  type, since a Suction test's retained mass is still perfectly valid (one filter,
  just mounted differently) unlike Single-Pass/Multipass Series. The two reasons
  combine in one title if both apply (e.g. a Single-Pass test run on a Suction setup).
  Each standard's `Analysis.js` gained its own `NON_STANDARD_SETUPS`/`nonStandardSetup`
  (own copy per CLAUDE.md).
- "Suction & Pressure" (a suction filter + a normal-location filter in series — real
  hardware, confirmed by the user) still can't produce any report at all: that's the
  separately-scoped dual-filter termination work in WISHLIST.md, not fixed here. Noted
  there that once built, that setup must ALSO get the Non-Standard title.
- Cache version: webreportwriter-v113

## 2026-07-31 — Control-target warning messages now show enough precision to be legible
- The user found near-boundary control-target failures whose message read as
  nonsensical, e.g. "9.7 not in [9.7, 10.3]" — `controlTargetCheck.js`'s pass/fail
  comparison always used full floating-point precision (correct), but the MESSAGE
  rounded actual/lo/hi to 1 decimal, so a real (if tiny) miss like 9.6968 vs a 9.7000
  boundary printed as if the value equaled its own boundary. Per the user: fix the
  message's precision, not the comparison (a real miss should still fail) — bumped the
  message to 3 decimals. Standard-agnostic engine (`src/core/`), so this fixes the
  warnings dialog for all three standards at once.
- Cache version: webreportwriter-v112

## 2026-07-31 — "Flat Sheet" Test Setup was misrouted into the dual-filter error
- All three active standards' `SINGLE_FILTER_SETUPS` list (`iso16889`, `iso454812`,
  `iso19438`) was missing `"Flat Sheet"`, so a real flat-sheet-media file hit "Test
  Setup 'Flat Sheet' requires the dual-filter analysis path, which is not implemented
  yet" — wrong on both counts, per the user: a flat sheet test is just a piece of flat
  media in a universal test housing, single-filter exactly like Spin On/Pressure/
  Suction, nothing dual-filter about it. Added to all three standards' lists.
- Cache version: webreportwriter-v111

## 2026-07-31 — Non-standard test types (Single-Pass/Multipass Series) now retitle the report and suppress retained mass
- All three active standards (`iso16889`, `iso454812`, `iso19438` — not `iso16889legacy`)
  treated `Single-Pass` and `Multipass Series` exactly like `Multipass`: same title, same
  Non-Retained Mass/Retained Capacity figures. Per the user (2026-07-31), that's wrong on
  both counts for those two types:
  - **Title**: a report generated from a Single-Pass or Multipass Series file now reads
    "Non-Standard Single-Pass Test Reported to ISO \<standard\>" (or "...Multipass Series
    Test...") instead of the standard's normal title. Each standard's `<h1>` is now a
    `data-slot="reportTitle"` filled entirely by that standard's own Mapper — no static
    title text left in the templates.
  - **Retained mass**: Non-Retained Mass/Retained Capacity (`nonRetainedMassMnr`/
    `retainedCapacityCr` for 4548-12/19438, `isoMtdRetainedCapacity` for 16889) are no
    longer computed at all for these two test types. Reason, per the user: a Single-Pass
    test has the machine's cleanup filter active, so contaminant that passes the test
    filter is captured downstream by the cleanup filter, not recirculated — it can't be
    attributed to the test filter. A Multipass Series test has two filters in series, so
    there's no way to tell which one retained the contaminant. A new `retainedMassNote`
    report field (blank and invisible on a normal Multipass report — see app.css's
    `.report-note:empty`) prints this explanation directly on the page for the two
    non-standard types, in addition to the existing warnings dialog. Injected Mass
    (Mi/`isoMtdMassInjected`) is unaffected — it isn't filter-specific, so it stays valid
    and computed for all three test types.
  - Each standard's `Analysis.js` now exposes `testType`/`nonStandardTestType`/
    `retainedMassSuppressedReason` — own copy per standard per CLAUDE.md, even though the
    logic is identical across all three.
- Cache version: webreportwriter-v110

## 2026-07-31 — Fixed ISO 19438 Mnr's Qd/Qu source (was reading the wrong channels)
- Per the user: `iso19438Analysis.js`'s Non-Retained Mass (Mnr) calc was averaging the
  `UpSensor`/`DnSensor` channels for Qd/Qu (downstream/upstream sampling-system flow) —
  those are the particle counter's own sensor draw flow, a much smaller number than the
  actual sample flow rate. The sample flow is only ever declared as a header setpoint
  (`Dilution System Configuration`'s `SampleFlow` key) — .DAT files don't log it as a
  time-series channel at all (only .DB files would). Switched Qd/Qu to read that header
  value directly instead of averaging a channel. Per the user, this header value is
  recorded in mL/min (125 mL/min typical, 50 mL/min on low-flow dilution systems), while
  Mnr's formula wants L/min — added the /1000 conversion, same as Qia already gets.
- Renamed `iso19438ControlTargets.js`'s "Sampling Flow Rate (upstream/downstream)" rule
  to "Sensor Flow Rate" — it correctly checks `UpSensor`/`DnSensor` against `SensorFlow`
  (matching ISO 4548-12's confirmed-correct rule of the same name), but the old name
  collided with the unrelated Sample Flow field and is what led the Mnr calc astray in
  the first place.
- Followed up by walking every other `// ASSUMED` header value in the ISO 19438 engine
  that feeds an actual calculation (CleanAssemblyDP, TerminalDP, CleanHousingDP, Test
  System Rate/Volume, Injection GravimetricLevel/Volume, Dilution SensorFlow) with the
  user; all confirmed correct as assumed, upgraded to CONFIRMED in the source comments.
  One deferred item surfaced: older "Life and Efficiency" (SAE J905/J1985) stands,
  ~5% of the fleet, report Test System Rate in L/hour instead of L/min in the same
  header field — a known instance of `machineProfile.js`'s existing dormant
  channel-correction pattern, intentionally left unhandled until a real customer on
  one of those stands needs it (see WISHLIST.md's `machineProfiles.js` entry for the
  gut-check heuristic that would detect it).
- Cache version: webreportwriter-v109

## 2026-07-30 — Removed the "Data Format declares N channels but rows carry M" warning
- Per the user: this `dataFile.js` parser warning (shown in the Data Explorer's ⚠ box)
  is a useful Bonavista-facing diagnostic but not something to show customers, and this
  project has no user-access-tier system to gate it behind (none planned either). Removed
  the check entirely rather than trying to hide it selectively. The graceful degradation
  it was describing — unlabeled analog columns shown as "Col n", missing ones left blank
  — is unchanged; only the warning text is gone. The sibling "no ;Data Format: row
  found" / "no LBSizes row found" / "rows aren't a consistent width" warnings are
  untouched — the user only called out this one message.
- Cache version: webreportwriter-v108

## 2026-07-30 — Session save/load now carries the source file (v2 format)
- Per the user: a loaded session gave no plot values, switching standards after loading
  had no file to re-analyze, and the Select Display Sizes / Add-Edit Gravimetrics buttons
  stayed permanently disabled — all because a session file only ever saved `store`'s
  resolved field values, never the underlying `.DAT`. Every one of those features is
  gated on `currentDf`/`currentAnalysis`, which a fields-only file can't rebuild.
- **New session format ("report-session", v2)**: wraps `store.toJSON()` with the
  ORIGINAL `.DAT` text, `standardId`, `sensor`, and whichever display sizes were
  resolved for that render. Loading now re-parses the source text and replays the exact
  same parse -> analyze -> map pipeline a live file load uses (`runAnalysisPipeline`),
  with the saved User Entries (gravimetric results, manual field overrides) carried
  forward on top via the same "preserve manual edits across a re-run" mechanism already
  used for a sensor/standard switch — `fromData`/`customDefault` tiers are deliberately
  NOT frozen into the file; they're recomputed fresh against the current browser's
  persisted defaults, same as any other re-run. Old v1 files (bare `store.toJSON()`)
  still load, with the same limited behavior as before.
- **Save now prompts for a filename** (defaulting to `<source file>_session.json`),
  reusing the same plain `prompt()` pattern the double-click-to-edit fields already use
  — per the user, "at least use the original file name" as the floor, prompting as the
  better option.
- New `tools/render-check/session-save-load-check.js` (Playwright, not shipped/precached)
  exercises the full round trip in a real browser: manual edit -> save -> prompted
  filename -> fresh page with nothing rendered yet -> load -> plot canvases present,
  edit survived, standard switch works. All checks pass.
- Cache version: webreportwriter-v107

## 2026-07-30 — Fixed: loading a saved report session did nothing on a fresh page
- **"Load session" (report_session.json) silently failed to repopulate the report** when
  the Report tab's page templates hadn't been rendered into the DOM yet — e.g. right
  after opening the app, before any `.DAT` file was loaded. The handler called
  `refreshReport`, which `reportView.js` documents as "a no-op if nothing has been
  rendered into it yet" (it only re-fills an already-present `[data-slot]` template).
  Same trap already found and fixed for the `.DAT`-load path (see `runAnalysisPipeline`'s
  own "always fully render, not refreshReport" comment) — the session-load handler in
  `app.js` still had it. Fixed by calling `renderReportPages` there too, so loading a
  session always renders the current standard's pages fresh before filling them,
  regardless of what was or wasn't already in the DOM.
- Cache version: webreportwriter-v106

## 2026-07-30 — Plot pages: white space between the two stacked figures
- The double-figure pages (ISO 16889's C.2/C.3 and C.4/C.5; ISO 4548-12/19438's B.2/B.3)
  bunched both plots at the top with the bottom of the sheet left blank. Now that the
  report margins are 0.5in (see the entry below), the ~1in of freed vertical space is
  spent as WHITE SPACE BETWEEN THE PLOTS — the two spread down the page instead of
  crowding the top, per the user. Chart heights are unchanged (3.85in each), so no
  `FIGURE_HEIGHT_IN`/canvas change; only `.double-fig .figure-wrap`'s margin grew (0.3in
  top / 0.15in bottom). Content lands ~9.6in on the 10in usable page, still safely under
  the ceiling that would spill it to an extra sheet. Verified with a headless render at
  real letter size (`tools/render-check/shot-fig.js`).
- Cache version: webreportwriter-v102

## 2026-07-30 — Report margins cut to 0.5in; ISO 16889 Page 2 table enlarged
- **`@page` margins reduced from `1in 0.7in 1in 0.5in` to `0.5in` on all sides**, per the
  user ("we only need about 1/2 inch"). Affects every standard's report (shared
  infrastructure). `reportView.js`'s `PAGE_MARGIN_IN` updated to match — kept in sync by
  hand, since the figure print-sizing computes from it. **The right margin's 0.7in was a
  deliberate printer-hardware buffer** (a physical printer once clipped page 1's right
  edge — see the v58 entry); it is now 0.5in like the rest at the user's request, with a
  WARNING preserved in both `app.css` and `reportView.js` to restore 0.7in there if a
  printer clips again.
- **ISO 16889 Page 2's rotated particle-counts table enlarged to fill the roomier page** —
  the rotate/page boxes are sized to the new 7.5x10in (letter) usable area and the print
  font is 9px→11px. An interim 9px bump (v99) did nothing visible and is superseded: a
  headless-Chromium render proved the landscape rotation makes the browser shrink-to-fit
  the whole page to its printable width, which scales font AND columns together — so font
  size alone never changes the printed size, only the roomier box does. 11px is the largest
  that still keeps an 8-digit count (10s-of-millions, a high-concentration test) on one line.
- **New dev tooling, `tools/render-check/`** (Playwright + headless Chromium): renders the
  real report to PDF/PNG and reads it back, so print-layout changes are measured and seen
  before shipping instead of hand-guessed (this file's history is full of print guesses
  that missed). Not part of the shipped app, not precached.
- Cache version: webreportwriter-v101

## 2026-07-30 — Test/elapsed times shown as h:mm:ss instead of decimal minutes
- Fields that displayed decimal minutes now show h:mm:ss (e.g. "6.00 min" -> "0:06:00"),
  per the user — decimal minutes read as unintuitive. Covers ISO 16889's Page 1 "Test time"
  column, ISO 4548-12 & ISO 19438's "% Net ΔP" test-time row, and ISO 19438's per-window
  "Elapsed time" label; the "(min)" column/label text became "(h:mm:ss)" to match. Reuses
  each mapper's existing `formatElapsed` (and reportView's `formatHoursMinutesSeconds`,
  the same helper Table B.2 already used), so the whole report is now consistent on this
  format (termination time and Table B.2 were already h:mm:ss). Left as decimal on purpose:
  the "Sampling time" config field (a setting, flagged to the user) and the ISO 16889
  Legacy report (deprecated).
- Cache version: webreportwriter-v100

## 2026-07-30 — chartView: merged ISO 16889's Figures C.4/C.5 into one shared renderer
- C.4 and C.5 were near-identical multi-series β charts. Extracted the shared construction
  into `renderBetaMultiSeriesFigure` (chartView.js); `renderBetaVsTimeFigureChart` and
  `renderBetaVsPressureFigureChart` are now thin wrappers passing their own x-axis (and
  C.5's kPa->display conversion). Behavior-preserving — same exported signatures and output.
  Both are ISO 16889's own figures, so this is within-standard reuse, not cross-standard
  sharing.
- Cache version: webreportwriter-v98

## 2026-07-30 — reportView: shared repeatable-page + size-block machinery (Table B.2 / ISO 19438)
- Table B.2 and ISO 19438's per-window pages had near-duplicate page-stamping and
  size-block-fill code. Extracted `fillRepeatablePages` and `fillSizeBlock` (reportView.js)
  as standard-AGNOSTIC presentation machinery; each standard's `fillTableB2Pages`/
  `fillTable19438Pages` is now a thin wrapper passing its own template/data/clump-fill.
  Behavior-preserving. Only the scaffold is shared — each standard's own report CONTENT
  (which rows/labels/formatting) stays in its own `fill*Clump`, per the report-content-
  independence rule newly written into CLAUDE.md this session.
- Cache version: webreportwriter-v97

## 2026-07-30 — Adopted the "ponytail" lazy-senior-dev working rules (CLAUDE.md)
- Added the ponytail decision ladder (reuse before writing, delete over add, smallest safe
  diff) to CLAUDE.md as the project's how-to-work guide, with a precedence note that the
  project's between-standards independence rules win over ponytail's reuse bias. Also newly
  documented in CLAUDE.md: **report CONTENT is never shared between standards** (the same
  rule as analysis procedures, now extended explicitly to the reportView/chartView rendering
  blocks), plus a "tail-chasing test" for deciding when rendering code may legitimately be
  shared. Docs/conventions only — no precached file changed, so no cache bump.

## 2026-07-29 — One more Chart.js-native legend attempt (user chose not to do the custom-legend rewrite)
- Asked the user whether to replace Chart.js's built-in legend with a custom HTML/
  CSS one (real flexbox centering, but bigger — touches print-width calculations
  too) or keep tuning Chart.js's own options for the "legend sits too close to
  the plot" complaint. They chose to keep tuning.
- Added `layout: { padding: { right: 14 } }` to both C.4/C.5 chart configs —
  Chart.js has no documented option for spacing between the legend and the plot
  area specifically (checked before adding this, not present in v4's Legend
  option list); `layout.padding` is the closest real lever, padding the whole
  chart area in from the canvas edges. This keeps the legend off the canvas's
  own right edge but does NOT create a gap between the plot and legend
  themselves — flagged as a real ceiling of the built-in legend, not something
  this change fully resolves.
- Cache version: webreportwriter-v96

## 2026-07-29 — Clean log-axis ticks; legend padding eased back up
- **Beta-ratio log axis (C.3, C.4, C.5) had crowded, confusing gridlines near the
  top** — Chart.js's own "nice number" tick generation over the 1-100,000 range
  picked round-looking but unevenly-log-spaced values (e.g. a 70,000 tick sitting
  right under the 100,000 max), reported directly as "double lines" and crowding.
  New shared `useCleanLogTicks` (chartView.js) replaces Chart.js's auto ticks with
  exactly the clean powers of ten in range (1, 10, 100, ...) via `afterBuildTicks`
  — evenly spaced by construction on a log scale, reads the axis's actual
  min/max so it still adapts to an axis-editor override. Applied to all three
  charts sharing this axis.
- Eased the multi-series legend's item padding/font back up slightly (6px/8.5px,
  from 3px/8px) — the aggressive tightening from the previous round turned out
  unnecessary once `maxHeight` was already capping overflow, and just made
  entries feel needlessly cramped.
- Flagged directly to the user, not yet fixed: the legend still sits snug against
  the plot with unused space beyond it, because Chart.js's built-in legend
  doesn't have an option to center its content within extra reserved space —
  it only ever "fits to content, abuts the plot." A real fix needs a custom
  HTML/CSS legend (flexbox gives real centering control) in place of Chart.js's
  own, which also means recalculating these two figures' print width (currently
  computed assuming the chart alone fills the available space) to leave room for
  it — a bigger change than a config tweak, pending the user's call on priority.
- Cache version: webreportwriter-v95

## 2026-07-29 — Multi-series legend: force column-wrap instead of overflowing past the plot
- The tooltip/legend fix below (v93) wasn't enough on its own — with 16 legend
  entries in a single column, the legend was simply TALLER than the chart itself,
  overflowing past the plot area into the x-axis title (visibly overlapping "Test
  time (Percentage)" / "Element Differential Pressure..."), while leaving a wide
  strip of genuinely unused white space to the right of that narrow one-column
  list — both reported directly from a real print.
- Added `maxHeight: 150` to the same two legends (Figures C.4/C.5) — Chart.js
  wraps legend entries into additional COLUMNS once a column hits that height
  cap, rather than letting one column grow past the available space. This fixes
  both complaints from the same root cause: no more single tall column to
  overflow, and a multi-column layout naturally uses more of the width that was
  sitting empty. `align: "center"` (already set) centers the resulting block
  against the plot area vertically. Also tightened `labels.padding` (3, down
  from Chart.js's default 10) and `font.size` (8, down from 9) so more entries
  fit per column before another wrap is needed.
- Cache version: webreportwriter-v94

## 2026-07-29 — Fixes from v92 review: real column-width guarantee, more B.2 clumps/page, toner, chart tooltips/legend
- **ISO16889 Page 2 was STILL silently losing columns** — v92's real print (text
  layer) looked complete, but the user confirmed on screen that only 13 of 16
  sizes were actually visible, recreating the original data-loss bug. Root cause:
  a THIRD hand-calculated font-size/padding guess, still wrong — `.w16889-p2-page`'s
  own `overflow:hidden` backstop was quietly cropping the 3 columns that didn't
  fit, and a PDF's text layer can retain text for content that's visually clipped,
  which is why the extracted text looked fine while the real rendering wasn't.
  Stopped trying to calculate an exact width fit a fourth time: `.w16889-p2-table`
  now uses `table-layout: fixed` with an explicit `<colgroup>` (2% label columns +
  16 equal-share size columns), making column width a STRUCTURAL guarantee — the
  table is physically incapable of exceeding its container, full stop, regardless
  of font-size or how wide any value is. `white-space` switched from `nowrap` to
  `normal` + `overflow-wrap: break-word` so a value that doesn't fit its column
  wraps to a second line instead of overflowing or forcing the table wider. Font
  bumped back to a comfortably legible 8px, since correctness no longer depends on
  that number being exactly right.
- **ISO 4548-12's Table B.2 bumped from 4 to 5 clumps per page.** The 4-clump
  figure predated this session's static-shape rewrite (from when the table's real
  print footprint couldn't be measured directly, only guessed at); re-counted
  against the current, real, static shape (8.5px font, 1px 4px padding): 5 clumps
  + the page header comes to ~702px against the ~864px (9in) usable page, ~19%
  real margin. Added a 5th clump slot to `iso454812_page2.html` to match. Flagged
  in-code that this specific count was never itself real-print-verified before —
  the original "5 clumps overflowed" failure this app's history cites may have
  been at different (larger) sizing that was later tightened specifically for 4.
- **h2 section headings no longer force their solid fill to print.** The
  `print-color-adjust: exact` added last round successfully forced the ink-heavy
  background back on — which meant every printed copy burned toner on a solid
  black bar per heading, exactly the outcome a customer printing hard copies
  wouldn't want. Removed; the border-only outline (already added for the same
  "boxed shape should persist" reason) is what actually holds now, and a user who
  has explicitly enabled "print background graphics" in their own dialog still
  gets the filled version — this only stops overriding the default.
- ISO16889's Figures C.4/C.5 zigzag pattern (a `>5 µm(c)` series spiking to the
  beta clamp and back) was raised and confirmed by the user to be a real,
  expected artifact of this file's own data under the standard's prescribed
  interpretation, not a chart bug — no change made.
- **Multi-series chart tooltips fixed** (Figures C.4/C.5, up to 16 lines each):
  `interaction: { mode: "nearest", axis: "x", intersect: false }` matched every
  series sharing the nearest X pixel — since all series share the same 10 x-
  positions, hovering ANYWHERE showed all 16 values stacked in one tooltip.
  Changed to `{ mode: "nearest", intersect: true }`, which requires the cursor to
  actually be near a specific point (both axes), showing only that one series'
  value. Also added `align: "center"` to those two charts' legends per the
  reported off-center/sloppy look.
- Cache version: webreportwriter-v93

## 2026-07-29 — Static, fill-only report tables: retired the JS-built-table pattern (Page 2, Table B.2, ISO 19438)
- Root-cause fix for the whole run of Page 2 print problems above: the table's DOM
  was empty in the static template and got built node-by-node at render time
  (`el("td", ...)` appended in a loop). Every print-sizing decision was tuning
  against a HYPOTHETICAL fully-populated table, never something real to look at —
  which is why it took 5 real-print round trips to land (scrollbar baked into a
  printed page, wrong column count, over-rounded values, a stretch-scale that
  looked ugly). Per the user directly: "I don't like that the shape of these
  tables is not present until you add data, you just see some partial malformed
  table. These standard reports really shouldn't be morphing at all from template
  shape, it should just be fillable and repeatable."
- Checked and confirmed this wasn't unique to the new work: Table B.2
  (`iso454812_page2.html`) and ISO 19438's clump pages used the identical
  pattern — `<table class="datatbl b2-table"></table>`, completely empty, built
  from scratch every render. Per the user's own choice when asked, the redesign
  covers all three, not just ISO16889 Page 2.
- **The pattern, applied 3x**: every template's table now has its FULL real shape
  authored directly in the HTML — every row and column slot it could ever need,
  always present, visible with no JS run at all. Fill functions changed from
  *build* to *fill*: they never create/append/remove a node, only (a) set
  `.textContent` on a cell that already exists (by fixed position, or a
  `data-row`/`data-field`/`data-block` attribute) and (b) toggle the new shared
  `rpt-slot-hidden` class (app.css) to hide a slot this file doesn't need — an
  unused size column (fewer than 16 sizes selected) or, for B.2/19438, an entire
  unused clump slot (fewer real clumps than the page holds, only possible on the
  last generated sheet) — always on a count the app already knows exactly, never
  a runtime measurement/guess.
  - `iso16889_page2.html` / `fillTable16889Page2`: 18 columns (16 size slots + 2
    label) x 34 rows, all real cells. **Dropped the print-time JS measure-and-
    scale fallback (`fitPage2TableForPrint`) entirely** — no more `transform`, no
    more `offsetWidth`/`scrollWidth` measurement, per the user's own choice.
    Print font-size/padding is now a direct, hand-tuned value derived from real
    print evidence (documented in app.css) against the real, inspectable shape
    instead of a guess against a hypothetical one.
  - `iso454812_page2.html` / `fillTableB2Pages` (+ new `fillB2Clump`/
    `fillB2SizeBlock`, replacing `appendClump`/`appendSizeBlock`): kept the
    repeatable-page-per-`CLUMPS_PER_PAGE` mechanism (clump count is genuinely
    unbounded by test duration, so some repeating-page mechanism stays
    necessary) — but each cloned page's internal shape is now fully static: 4
    pre-built clump slots, each with its meta row and two 8-wide size blocks
    already in the markup.
  - `iso19438_page2.html` / `fillTable19438Pages` (+ new `fill19438Clump`/
    `fill19438SizeBlock`, replacing `append19438Clump`/`append19438SizeBlock`):
    same pattern, 5 static slots per page, "Initial" label/spacer kept as a
    class toggle rather than a structural difference.
- **Regression fix, found along the way**: printing ISO 4548-12 (previously
  print-verified, working) had started overflowing to an extra page. Traced to
  this session's own `.report-page h2 { border: 1.5px solid ... }` (added to
  persist the heading's boxed shape when print backgrounds don't render) — adds
  ~3px of height to every h2, and 4548-12's Page 1 (confirmed 4 h2 / 10 h3 / 23
  field-rows) is exactly the page app.css's own print-sizing history describes as
  tuned to ~0.74in of real margin, the tightest budget in the app. Fixed by
  trimming ~3px of margin/padding off the same rule so h2's total height returns
  to what it was before the border existed — keeps the boxed-shape fallback
  without re-overflowing that page.
- Cache version: webreportwriter-v92

## 2026-07-29 — ISO 16889 Page 2: reverted the independent-axis scale, it looked distorted
- The prior fix (independent scaleX/scaleY, below) was confirmed by a real print to
  look bad — "stretch, ugly," the user's own words — visibly uneven monospace
  digits wherever the two axes needed different ratios, which they did.
- `fitPage2TableForPrint` reverted to a single UNIFORM scale (never distorts aspect
  ratio), capped at 1 (never grows) — a pure safety net now, shrinking the whole
  table by whichever axis needs it more if it still doesn't fit at its natural
  size, nothing fancier.
- The actual leftover-vertical-space problem this was trying to paper over belongs
  in CSS, not a transform: bumped `.w16889-p2-table`'s top/bottom cell padding from
  2.5px to 5.5px so the table's own NATURAL (unscaled) proportions need less
  correcting in the first place — a rough estimate against the real print that
  showed the gap, not a precise fit; still needs confirming.
- Cache version: webreportwriter-v91

## 2026-07-29 — ISO 16889 Page 2: scale to fill BOTH axes, not just shrink-to-fit; centered table values app-wide
- A real print confirmed the previous fix (v89): all 18 columns now print, no more
  clipping. But the table read too small — the shrink-only scale needed to fix the
  width also shrunk the height by the same ratio, even though the height axis had
  real slack to begin with, leaving the table visibly smaller than its available
  box on both axes with dead space around it.
- `fitPage2TableForPrint` now computes scaleX and scaleY INDEPENDENTLY (available
  width/height each measured against the table's own needed width/height) and
  applies `scale(scaleX, scaleY)` — the table now fills the rotated footprint on
  both axes, shrinking whichever axis is too big and growing whichever has slack,
  rather than one shared ratio. Available height excludes the rotated box's other
  children (the h2 title, identification field-row), or the table would be sized
  to overflow past them. Trade-off: this can stretch/compress monospace digits
  unevenly when the two axes need different ratios — accepted deliberately over
  the alternative (correctly sized on one axis, swimming in blank space on the
  other); worth revisiting if a real print shows the distortion itself hurts
  legibility more than the whitespace did.
- **Table values switched from right- to center-aligned** app-wide, per the user's
  general preference (not iso16889-specific) — `table.datatbl th, table.datatbl td`
  (the shared style backing every clean standard's Page 1 tables) now centers data
  values, not just headers/first-column labels as before. Table B.2/19438 and
  ISO 16889 Page 2 were already centered, so this brings Page 1's own tables in
  line with the rest of the report rather than changing anything there.
- Cache version: webreportwriter-v90

## 2026-07-29 — ISO 16889 Page 2: measure-and-scale instead of guessing a third font size; h2 print outline
- A follow-up print preview (after v88's fix below) still showed only 15 of the
  table's 18 columns fitting the rotated 9in width budget — the overflow-auto
  scrollbar was gone as intended, but the real column-width need turned out to be
  meaningfully more than hand-estimated from font metrics (twice now). Rather than
  guess a third font-size/padding combination, `reportView.js`'s new
  `fitPage2TableForPrint` measures the table's actual rendered width at print time
  (`table.scrollWidth` vs. `.w16889-p2-rotate`'s own `offsetWidth` — layout-based
  measurements, unaffected by the ancestor's rotate transform, unlike
  `getBoundingClientRect`) and applies `transform: scale()` to shrink it to fit if
  it's still too wide. Same "measure real dimensions, don't trust hand calculation"
  precedent `computePrintFigureSizePx` already established for chart figures —
  wired into `fillReportCharts`'s existing print/screen redraw pass alongside them.
- Also bumped Page 2's row (not column) padding — a real print showed the 34 rows
  leaving real vertical space unused in the ~7.3in row budget; only vertical
  padding was touched (1px 3px -> 2.5px 3px) since horizontal padding is what
  drives column width and needed to stay put.
- **Page 1/3's h2 section headings (solid dark background on screen) print with no
  background at all**, read by the user as an odd indent relative to h3
  subheadings once the fill disappears. Browsers drop background-color from print
  output by default to save ink unless the page opts back in — added
  `print-color-adjust: exact` (plus the `-webkit-` prefix) to try to get the real
  fill back, and a `1.5px solid` border as a fallback so the boxed-heading SHAPE
  persists even on an engine that ignores that request (some respect the user's own
  "print background graphics" setting over it regardless).
- Cache version: webreportwriter-v89

## 2026-07-29 — ISO 16889: real print of the rotation redesign turned up three more bugs
- **Page 2 printed only ~13 of 16 size columns, with a scrollbar rendered onto the
  page instead of the rest.** Root cause: `.w16889-p2-scroll`'s `overflow-x:auto`
  (a screen-only fallback, meant for a narrow viewport) was never turned off for
  print, so the print engine treated it as a real scrollable viewport and rendered
  only whatever was scrolled into view, with scrollbar chrome baked into the page —
  there's no such thing as "scrolling" a printed sheet. Fixed by forcing
  `overflow: visible` on that element inside `@media print`; `.w16889-p2-page`'s
  own `overflow:hidden` remains as the real backstop if the table is ever still too
  wide. Also reduced Page 2's print font/padding to B.2/19438's own proven-safe
  minimum (8.5px / 1px 3px, down from 9.5px / 2px 4px) for extra margin, since the
  first real print showed this needs to stay conservative until confirmed otherwise.
- **Particle counts were displaying over-rounded, not "3 significant digits."**
  `formatSignificant`'s handling of values at or past 3 digits (>=100) was rounding
  them DOWN to only 3 significant figures (e.g. 217432 -> "217000") instead of
  showing the full integer. Per the user's correction, the standard's "three digits
  of precision" is about giving SMALL values enough decimal places to reach 3
  digits (1.75, 20.1) — not about coarsening large ones. Fixed: decimals now only
  ever shrinks toward 0 as magnitude grows, never goes negative into "round to a
  coarser unit" territory — a value >=100 now prints as a plain, full-precision
  integer (217432, not 217000).
- **Page 1 read as noticeably under-filled** (real print confirmed roughly half
  the sheet blank below Comments). Root cause: the shared `.report-page` print
  sizing (`app.css`) was hard-won compact specifically to prevent a DIFFERENT,
  denser standard's Page 1 from overflowing (see that rule's own history) — ISO
  16889's Page 1 has meaningfully less content (3 h2 / 10 h3 / 15 field-rows vs.
  that page's 4 / 10 / 23) and was never at overflow risk, so the same compaction
  just left the extra room unused. New `.w16889-page1`-scoped override (own class
  added to `iso16889_page1.html`'s outer div) bumps headings/fields/tables ~10%
  larger, sized against a real element-count budget for THIS page (documented in
  the CSS) that leaves ~1.4in of margin — deliberately more cushion than the ~0.74in
  that was shown elsewhere in this file to sometimes still not be enough. Comments'
  own sizing (the one unbounded-length field) is left untouched, same risk as before.
- All three found by the user from one real print PDF — no code-review substitute
  for actually printing it. Every fix above still needs a follow-up real print to
  confirm, especially Page 2's column count and Page 1's fill.
- Cache version: webreportwriter-v88

## 2026-07-29 — ISO 16889 Page 2: reshaped to one-column-per-size, landscape via rotation instead of portrait chunks
- The portrait-chunks fallback below (v85) technically worked but was rejected: the
  user pasted the source workbook's own version of this table, which fits all 16
  sizes on a single landscape sheet using a more compact shape than this app had —
  ONE column per particle size (not two), with Up/Down/ß as three stacked ROWS per
  clump instead of two Count|β sub-columns per size. That halves the column count
  (17 total for all 16 sizes at once, vs. 33) at the cost of more rows (34 fixed
  rows vs. 23) — a trade this standard can afford for free, since its row count was
  already fixed by definition (always 10 clumps) regardless of test duration.
- Page 2 is a single static page again (`fillTable16889Page2` in `reportView.js`,
  replacing `fillTable16889Page2Pages` — the `<template>`/anchor repeatable-page
  mechanism from v85 is gone; no longer needed once 16 sizes fit in 17 columns).
- Landscape print, attempted a second way: rather than CSS named pages (`@page
  <name> { size: ... landscape }`, confirmed by the user's own print output NOT to
  rotate the physical page at all — see v85's entry), this uses the older, far more
  broadly-supported "rotate a content block for sideways print" trick — plain
  `transform`/`position`, not a Paged-Media-specific feature. `.w16889-p2-page` is
  sized to the portrait page's own usable content area; `.w16889-p2-rotate` is
  sized to those same two dimensions swapped (the landscape footprint) and rotated
  into view via `rotate(90deg) translateY(-100%)`. A new `body[data-paper]`
  attribute (set by `app.js`'s `applyPaperSize`, alongside its existing
  `#paperSizeStyle` write) lets this rotation sizing react to the Letter/A4 choice,
  which plain `@page` selectors can't do. **Still needs a real print/print-preview
  check** — higher confidence than the named-page attempt since `transform` has
  much more consistent print support, but not yet confirmed against actual output.
- Investigated the user's separate report of a short test's early clump (e.g. 10%)
  showing no data at all: traced `_computeReportingTimeClumps`/`findRowRange` and
  confirmed this is already handled correctly, not a bug — a clump whose
  [start,end) reporting-time window falls entirely within the mandatory first-3-
  minutes disregard period gets an inverted range (`endRow < startRow`), which
  `findRowRange` already detects and returns `[null,null]` for, leaving that
  clump's avgUp/avgDown/avgBeta correctly `null` (rendered as a blank row, never
  "0" or garbage) and correctly excluded from the overall-average computation.
  Matches the reference workbook's own blank first-clump row on a short file.
- Cache version: webreportwriter-v87

## 2026-07-29 — ISO 16889: Page 1's cb field had the same wrong-header bug as 12.12's check
- Found while reviewing the user's own print output, a direct follow-on to the
  12.12 BUGL fix below: Page 1's "Base upstream gravimetric level, cb" field had
  its OWN separate copy of the same wrong assumption (`iso16889Mapper.js`'s own
  `HEADER_BUGL_SETPOINT` constant, not caught by the first pass since it lived in
  a different file from the one already fixed).
- Fixed the same way — cb now shows `analysis.buglTarget`, the setpoint-derived
  design target `checkGravimetricAcceptance` already compares the actual
  Average_BUGL against (12.12's own formula, run against setpoints instead of
  measured averages — needs no gravimetric hand-entry, so it's available
  immediately, computed once in `iso16889Analysis.js` and read directly by the
  mapper rather than recomputed there, keeping with the mapper's own "nothing here
  computes anything new" rule).
- Cache version: webreportwriter-v86

## 2026-07-29 — ISO 16889 Page 2: dropped landscape, paginated into portrait chunks instead
- Real print output (from the user) confirmed the landscape attempt failed on both
  fronts it needed to work on: on screen, the wide table had no horizontal scroll
  containment at all and just overflowed the page; in print preview, the named
  `@page iso16889-landscape` rule's orientation wasn't honored — the physical sheet
  stayed portrait-shaped and the wide table got shrunk to fit inside it rather than
  the page itself rotating. Per the plan's own pre-flagged fallback ("if it doesn't
  hold up... splitting the table across narrower portrait pages"), rather than
  keep tuning a CSS feature with unreliable browser support.
- Page 2 is now a REPEATABLE page, same `<template>` + anchor mechanism Table B.2
  already uses (`fillTable16889Page2Pages`, own copy per CLAUDE.md) — but chunking
  COLUMNS (8 display sizes per sheet, `SIZES_PER_CHUNK_16889`) instead of rows,
  since this standard's row count is always fixed at 23 regardless of test
  duration. A 16-size file now produces two ordinary portrait sheets instead of
  one landscape sheet; each carries its own identification header and a "sizes
  1-8 of 16" label, same self-contained-sheet convention every other multi-page
  report content in this app already follows.
- Removed entirely: `.landscape-page`, `@page iso16889-landscape`, and the
  `#landscapePageStyle` dynamic paper-size wiring in `app.js`/`index.html` — no
  longer needed, and per this fix, not something to keep relying on.
- Added `.w16889-p2-scroll` (on-screen horizontal scroll containment) as a
  belt-and-suspenders measure — 8-sizes-per-sheet rarely needs it, but a narrow
  viewport now degrades to a scrollbar instead of overflowing the page.
- Cache version: webreportwriter-v85

## 2026-07-29 — ISO 16889: 12.12's BUGL check compared the wrong quantity entirely
- Real conceptual bug, not just a wrong header guess — per the user: there is no
  independently-configured "base upstream gravimetric level setpoint" anywhere on
  the rig. The engine was reading an ASSUMED "Test System Configuration"/
  `GravimetricLevel` header value and comparing the COMPUTED Average_BUGL directly
  against it — that header (whatever it actually is) is a concentrated-injection-
  scale value, not a dilute main-loop BUGL target, so the comparison was checking
  two different KINDS of quantity against each other, not just an unconfirmed key.
- Fixed by DERIVING the target instead of reading it: 12.12's own formula
  (Average_BUGL = Ave_Injection_GravLevel x Ave_Injection_Flow / Test_Flow_Setpoint)
  has no separate "target" input — the target is what that same formula produces
  when fed the injection concentration/flow SETPOINTS instead of measured
  averages. `computeAverageBUGL` (already existed, used for the actual value) is
  now called a second time with setpoint inputs to get the target, so the two can
  never drift out of sync with each other. Removed the ASSUMED `HEADER_BUGL_SETPOINT`
  header key entirely — no longer needed, and per the user, doesn't correspond to
  anything real.
- `iso16889Analysis.js` now exposes `injectionFlowSetpoint` (Injection System
  Configuration's own Rate setpoint) as a proper field, promoted from a value that
  was previously only a local variable inside `_computeInjectionFlowRate`.
- Cache version: webreportwriter-v84

## 2026-07-29 — ISO 16889 Pages 3-4: Figures C.2-C.5 (final content pages)
- All four remaining figures, replacing the placeholder pages — the ISO 16889:2022
  build is now feature-complete across all 4 pages.
- Four genuinely new `chartView.js` render functions — none of the 4 figures could
  reuse `renderDPFigureChart`/`renderEfficiencyFigureChart` directly (both hardcoded
  to one data series):
  - **Figure C.2** (ΔP vs. contaminant injected): single series, linear-linear.
    Closest precedent `renderDPFigureChart`'s report-figure sizing idiom, minus its
    x2/y2 secondary axes — mass is the primary x-axis here, the standard doesn't
    ask for a right axis on this one. Data-shaping (`build16889MassPressureData`,
    reportView.js) mirrors `buildDPFigureData`'s "walk the termination channel"
    approach but computes each point's x as its proportional share of the total
    injected mass — which is gravimetric-dependent (`isoMtdMassInjected`, itself
    blank until a gravimetric entry or its header-fallback average exists), so the
    figure simply doesn't render until that's resolvable, same treatment any other
    gravimetric-dependent report content already gets.
  - **Figure C.3** (filtration ratio vs. particle size, semi-log): single series.
    Closest precedent `renderEfficiencyFigureChart`'s log-scale branch, retargeted
    to beta's native 2-100,000 range (standard's own stated ceiling, 13.5) instead
    of 4548-12's fixed penetration band — auto-generated log ticks instead of
    B.3's pinned 3-tick set, which suits this much wider range better.
  - **Figures C.4/C.5** (filtration ratio vs. % test time / vs. element ΔP):
    MULTI-series — one line per selected display size, up to 16 — genuinely new
    territory, combining the multi-series/color-cycling plumbing from
    `renderChart`/`renderComparisonChart` with a log axis for the first time (C.5
    log-log on both axes). Each clump contributes one point per series.
- Cache version: webreportwriter-v83

## 2026-07-29 — ISO 16889 Page 2: particle counts / filtration ratio table (landscape)
- Real content in place of the placeholder — the 23-row (1 Initial-up + 10 clumps x
  Up/Down + 1 Avg x Up/Down) x up to 16-size table, built in `reportView.js`'s new
  `fillTable16889Page2`. Row count is fixed (this standard always produces exactly
  10 clumps); only the column count is dynamic, keyed off `resolvedDisplaySizes` —
  so unlike Table B.2/19438's per-clump PAGE stamping, this fills header + data
  cells into a static row skeleton already in the template, not clones of a
  `<template>`.
- Column semantics: each size gets a Count sub-column and a β sub-column; beta is
  only meaningful once both Up and Down are known, so it's shown on the Down row
  (and Avg. Down) only, left blank on Up rows.
- "Initial up" row has no confirmed `.DAT` source yet (flagged in the plan as the
  lowest-confidence single field in this build) — shows "--" per the user's own
  literal instruction, with a shaded box where beta would go.
- **Landscape print orientation** — the single highest-risk piece of the whole ISO
  16889 build, per the plan: CSS named pages (`@page iso16889-landscape`, assigned
  via a new `.landscape-page` class), with paper size/print-date written
  dynamically into two new style tags (`#landscapePageStyle`, plus an extra rule in
  the existing `#printFooterStyle`) mirroring how the default page's own size
  already works. Untested against a real printer/print-preview — browser support
  for named pages varies; needs a real check.
- Cache version: webreportwriter-v82

## 2026-07-29 — ISO 16889: Injected mass column was never actually wired up
- Page 1's "Differential pressure versus contaminant added" table's Injected mass
  column stayed blank — the analysis engine's own comment claimed "filled in by the
  mapper once gravimetric values exist," but that fill-in code was never actually
  written anywhere. Fixed in `app.js`'s `recomputeIso16889GravimetricDerived`
  (13.4: `Mass_Injected_By_Analog_Time`, one value per reporting-time clump, using
  whichever injection gravimetric average the store currently resolves to) — runs
  on every call site this function already had, so the column populates from the
  first load (via the just-added header fallback), not only after a gravimetric
  entry. Removed the now-dead `injectedMassG` field from the clump object shape and
  the Page 2 extras array, both of which were unused leftovers from the
  never-implemented original design.
- Cache version: webreportwriter-v81

## 2026-07-29 — ISO 16889: injection gravimetric header fallback + real Final volume calc
- Two real gaps in the Page 1 checkpoint, both found by the user testing against a
  real file:
- Injection gravimetric Initial/Final weren't populating at all — the mapper had
  them marked hand-entry-only, but 4548-12/19438 both already show a header
  fallback (the injection system's own `GravimetricLevel` setpoint) until a user
  overrides each independently via the gravimetric dialog. Missed replicating this
  in the new build; fixed to match (`analysis.injectionGravSetpoint`, now exposed
  by `iso16889Analysis.js`, feeds `injectionGravInitial`/`injectionGravFinal`/
  `injectionGravAverage`).
- Injection system Final volume was defaulting to Initial volume (copying the
  pattern used for Test System's own Vf) — wrong for this field specifically: per
  the user, the injection reservoir actually drains at the injection rate over the
  test, not a static quantity with no better source. Now computed as
  `Initial − (Qia × test time)` in `iso16889Analysis.js`'s `_computeInjectionFlowRate`
  (still data-editable — a real measured final volume overrides the computed
  estimate). Verified against the user's own worked example: 74 L initial,
  250 mL/min for 60 min → drains 15 L → 59 L final.
- Cache version: webreportwriter-v80

## 2026-07-29 — ISO 16889:2022 clean build: Analysis engine + Page 1 (Pages 2-4 placeholders)
- First checkpoint of the whole-cloth ISO 16889:2022 build (own `src/standards/iso16889/`
  folder, claiming the identity `iso16889legacy` gave up — see the entry below).
  `iso16889Analysis.js`, `iso16889Mapper.js`, `iso16889ControlTargets.js`,
  `iso16889Pages.js`, `iso16889DisplaySizesView.js`, and `templates/iso16889/
  iso16889_page1.html` are real; Pages 2-4 are placeholder stubs (landscape
  particle-count table and four new chart types not built yet) so Page 1 could be
  checked against a real file before that harder work is invested in.
- Full sensor-selection (LB/LS/LBE) and midstream dual-filter parity with ISO
  4548-12/19438, confirmed with the user even though the pasted standard text itself
  never asks for either.
- The 10-reporting-time clumping scheme (12.1-12.6) — a genuinely different
  algorithm from 4548-12/19438's fixed-duration bucket scheme, not a variant of it —
  was reverse-engineered from and verified exactly against the standard's own
  86-minute worked example before being trusted.
- `Size_At_Beta_x` (13.6) uses log-linear interpolation (linear in size, log in
  beta), a deliberate correctness fix over the legacy engine's plain-linear version
  — the two will report slightly different values for the same file; the new one is
  correct, matching the standard's own "straight-line segments on the semi-log
  plot" description.
- New `formatSignificant()` helper (`src/helpers/units.js`) for the standard's
  "three significant digits" display convention (12.5/12.6) — distinct from
  `formatNumber()`'s fixed-decimal convention every other standard uses.
- Two of the standard's three "accept the test only if" acceptance criteria (12.9
  injection gravimetric ±5%, 12.12 base upstream gravimetric level ±10%) need
  hand-entered gravimetric results, so they're evaluated by a new
  `recomputeIso16889GravimetricDerived` (app.js), same trigger points as the other
  standards' own gravimetric-derived recomputes — surfacing as
  `currentAnalysis.gravimetricWarnings`, folded into the existing warnings button/
  dialog. The third (12.11, injection flow rate) is live-channel-derived and checked
  at analysis run() time instead, same as every other control target. Confirmed
  with the user: all informational/warning-only, no new report-blocking behavior.
- Conductivity's control-target rule is header-only from the start (no live-channel
  average) — built already knowing about the false-failure bug just fixed on the
  other two standards' Conductivity rules, not repeating it.
- `STANDARDS.iso16889` is now the default first-visit standard (previously
  `iso16889legacy` during the interim, before this build existed).
- Cache version: webreportwriter-v79

## 2026-07-29 — ISO 16889 legacy build moved to `iso16889legacy`, freeing `iso16889` for a clean 2022 build
- The original Bonavista-workbook-derivative ISO 16889 engine — `iso16889Analysis.js`/
  `iso16889Mapper.js`/`iso16889Pages.js`/`iso16889_page1.html` — moved to
  `src/standards/iso16889legacy/` / `templates/iso16889legacy/`, standardId
  `iso16889legacy`, sidebar label "ISO 16889 (Legacy)". Globals renamed
  (`Iso16889Analysis` → `Iso16889LegacyAnalysis`) so they can coexist with the new
  engine's own globals. Behavior is UNCHANGED — this is a pure move/rename, nothing
  about how it analyzes a file or renders a report was touched.
- Per the user: kept fully wired and selectable in the sidebar, not deleted —
  "deprecated," not "removed." Nothing about report-generation capability regresses.
- This frees the `iso16889` id/folder/sidebar slot for a clean, whole-cloth
  ISO 16889:2022 build (see the next entry) — matching how ISO 4548-12 and ISO 19438
  were both built directly from their standard texts, rather than continuing to treat
  ISO 16889 as a special case tied to the legacy workbook's report shape. CLAUDE.md's
  "ISO 16889 — provenance warning" section rewritten to describe the new
  arrangement instead of warning about it.
- Cache version: webreportwriter-v78

## 2026-07-28 — Conductivity control-target false failures; marker placement fix
- **Real bug, found via the new inline markers**: ISO 4548-12's Conductivity (Test
  System) rule was flagging in-range files as out of tolerance (e.g. actual 1540
  pS/m, well inside the 1000-2000 band, marked failing). Root cause: the rule
  checked TS_Conductivity's whole-test channel AVERAGE against the fixed 1500±500
  target, but the report's own "Initial Conductivity" field never reads that channel
  at all — it reads the `TestConductivity` header setpoint directly. Conductivity
  legitimately drifts upward over a multipass test as dust is injected (that's the
  point of measuring it), so its whole-test average is a fundamentally different,
  and often out-of-band, quantity from the initial setpoint the target was written
  against. Fixed by dropping `channelTag` from both 4548-12 Conductivity rules (Test
  System, Injection System) and ISO 19438's, so all three now read the same
  `TestConductivity`/`InjConductivity` header value the report itself displays —
  checked and displayed quantities can no longer disagree. `channelTag` is now
  documented as optional in `controlTargetCheck.js`, for exactly this case.
- Inline ⚠ field markers now land right after the data value (before the `.unit`
  span), not appended to the end of `.field` — per the user, that read as attached to
  the unit label rather than the value it's actually about.
- Cache version: webreportwriter-v77

## 2026-07-28 — Warnings dialog, inline ⚠ field markers, and a 25-minute test-time floor
- **ISO 19438 field-meaning correction**: Sensor Type (Dilution System) is Light
  Blocking vs. Light Scattering — the value that was previously (incorrectly) written
  into Counting Method. Counting Method is Online vs. Offline (real-time inline
  counting vs. bottle samples through a benchtop counter); every file this app reads
  is online-counted by construction, so it's now a fixed "Online" default, not
  derived from the sensor selection. Fixed in `iso19438Mapper.js`.
- **25-minute hard test-time floor, all three standards**: below 25 minutes of test
  time, analysis now refuses to produce a report at all (an error, same mechanism as
  an invalid termination) rather than generating one against too little data to be
  meaningful — the standards themselves recommend ≥30 minutes. Own
  `MIN_TEST_TIME_MINUTES` constant duplicated in each standard's own
  `*Analysis.js._determineTermination` per CLAUDE.md (own copy per standard, even
  though the value is shared).
- **Warnings dialog** (new `src/report/warningsDialogView.js`): every analysis error,
  every analysis warning, and every control-target failure, in full — previously only
  the FIRST analysis error reached the status bar and everything else was
  console-only. A new "⚠ Warnings (N)" button in the Report toolbar (next to Print,
  hidden when there's nothing to report) opens it; the status bar line is now short
  ("N issue(s), see ⚠ Warnings") instead of carrying truncated detail inline.
- **Inline ⚠ field markers**: a control-target rule can now declare a
  `reportFieldId` (`controlTargetCheck.js`'s `ControlTargetRule`/`ControlTargetResult`
  typedefs) naming the report field its ACTUAL value is displayed as; on failure,
  reportView.js's new `applyControlWarningMarkers` stamps a small ⚠ (hover for detail)
  right on that field, idempotently rebuilt every render like the B.2/w19438
  generated-page pattern. Wired for ISO 4548-12's and ISO 19438's Test Flow Rate,
  Injection Flow Rate, Temperature (Test System), and Conductivity (Test System)
  rules; deliberately left unset (no single displayed field to point at) for the
  upstream/downstream Sensor/Sampling Flow Rate pair and the Injection-system
  temperature rules — those still appear in the dialog's full list.
- Both the dialog and the inline markers read the exact same
  `store.getExtra("controlResults")` array app.js populates once per analysis run, so
  the two surfaces can never disagree.
- Cache version: webreportwriter-v76

## 2026-07-28 — ISO 19438:2023 added as a new standard
- Third standard, built clean against the standard text the user provided (not a port
  of anything), following ISO 4548-12's own file/folder pattern: own
  `src/standards/iso19438/` folder (Analysis, ControlTargets, Mapper, Pages,
  DisplaySizesView) and own `templates/iso19438/` (4 pages) — no analysis procedure
  shared with ISO 4548-12 even where the shape matches, per CLAUDE.md.
- Genuinely different from ISO 4548-12, not just relabeled: an "Initial Efficiency"
  concept (fixed minutes 4-6 average) 4548-12 doesn't have, alongside Min./Overall;
  TWO filter-rating curves (Initial- and Overall-based) at 4 target percentages
  instead of 4548-12's one curve at 5; a real mass-balance integral for Non-Retained
  Mass needing new Qd/Qu/Vf inputs; Figure B.2's right axis uses plain, evenly-spaced
  -10%-to-110% ticks (confirmed with the user, every 10%) instead of 4548-12's 7
  milestone-snapped ticks.
- Shared/reused where genuinely standard-agnostic: `renderEfficiencyFigureChart`
  (Figures B.1/B.3) reused as-is from `chartView.js`; `buildDPFigureData` in
  reportView.js now serves both standards' DP figures (their Analysis engines expose
  the same field shape); `renderDPFigureChart` gained a `rightAxisMode` option
  ("milestones" vs "even") rather than a full duplicate function, since only the
  right-axis tick generation differs between the two standards' otherwise-identical
  charts; `computePrintFigureSizePx`'s existing single/double-fig print-sizing
  categories apply unchanged.
- **No real ISO 19438 `.DAT` file is available yet.** Every header/channel-tag
  constant is marked `// ASSUMED` (starting guess: same naming as ISO 4548-12's
  files) throughout `iso19438Analysis.js`/`iso19438ControlTargets.js`/
  `iso19438Mapper.js` — re-verify each one against a real file's header/Data Format
  row per CLAUDE.md's ".DAT file handling" rule before trusting a real report out of
  this standard. One formula (Non-Retained Mass's Qu term) is flagged as a possible
  unit-consistency issue in the user's own pasted formula text, implemented exactly
  as given rather than silently "corrected" — see `computeMassBalance`'s comment.
- Cache version: webreportwriter-v67

## 2026-07-28 — .DAT format confirmed standard-agnostic (docs/comments only)
- Per the user: the `.DAT` file itself is NOT standard-specific — ISO 16889,
  ISO 4548-12, and ISO 19438 are all multipass testing standards logged by the same
  file format/control program, differing in analysis, not in what the rig records.
  Added this as a documented fact in CLAUDE.md's ".DAT file handling" section (not
  previously stated), and softened the "ASSUMED, coincidental guess" framing in
  yesterday's new `iso19438Analysis.js`/`iso19438ControlTargets.js`/
  `iso19438Mapper.js` comments to reflect that reusing ISO 4548-12's channel/header
  naming is on genuinely solid footing — still not a substitute for checking a real
  ISO 19438 file once one exists, just no longer framed as a shot in the dark.
- Cache version: webreportwriter-v68

## 2026-07-28 — ISO 19438 fixes: Dilution System fields, clump table styling, page density
- Dilution System fields were mostly blank: the first pass at `iso19438Mapper.js`
  only mapped the plain-key path (`DilutionRatio`/`SensorFlow`) and dropped the
  ExRaDs fallback chains (`PrimaryDilutionRatio`/`ExtendedDilutionRatio`,
  `LBSensorFlow`/`LSSensorFlow`) that a real multi-stage-dilution machine actually
  needs — ported the full fallback logic over from `iso454812Mapper.js` (own copy,
  per CLAUDE.md), on the strength of yesterday's confirmation that the `.DAT` format
  is shared across standards. Also added Counting Method (Light Blocking vs. Light
  Scattering) as a DERIVED field — it's just whichever sensor is selected, not a
  separate header value — instead of leaving it as unnecessary hand-entry.
- Bigger find: the ISO 19438 clump table (`.w19438-table`) wasn't picking up ANY of
  Table B.2's visual styling (monospace font, the spacer row's height, bold size
  labels, the block-divider border) — every one of those CSS rules was scoped to
  `.b2-table` specifically, which `.w19438-table` never matched. Regrouped the
  selectors to cover both tables' class names (shared VISUAL styling, not an
  analysis procedure — the underlying clump data/labels are still built by fully
  separate code). This alone likely explains most of the "no whitespace between
  clumps" complaint — the spacer row had silently collapsed to 0 height.
- Added extra visual separation specifically after the Initial clump (a taller
  spacer + bottom border) so it reads apart from the regular bucketed clumps that
  follow, on top of the general spacer-height fix above.
- `CLUMPS_PER_PAGE_19438`: 4 -> 5, per the user (own constant, independent of ISO
  4548-12's own separately-tuned value).
- Cache version: webreportwriter-v69

## 2026-07-28 — Subscripted variable labels + Vf fallback (ISO 4548-12 & ISO 19438)
- Standard-notation field labels (Q<sub>ia</sub>, G<sub>ia</sub>, G<sub>a</sub>,
  G<sub>f</sub>, V<sub>i</sub>, V<sub>f</sub>, ΔP<sub>1-5</sub>, M<sub>1</sub>/M<sub>i</sub>,
  M<sub>nr</sub>, C<sub>r</sub>) now render with real subscripts (`<sub>`) instead of
  plain concatenated text like "Qia", across both standards' Page 1 templates.
- Final Volume V<sub>f</sub> now defaults to the initial Volume reading (still
  data-editable — a real final-volume reading overrides it) instead of sitting blank
  until hand-entered. For ISO 4548-12 this matches the approximation
  `computeMassBalance` already made internally, just now actually visible in the
  field instead of only implicit in the calculation. For ISO 19438 this is a real
  functional fix: Non-Retained Mass could never compute at all before this (Vf was
  always null until hand-entered), so it now works out of the box using the same
  approximation, exactly as intended.
- Also rewired both standards' Non-Retained Mass recompute (app.js) to read the
  (now-defaulted, still-editable) V<sub>f</sub> field itself rather than always
  reading the original initial-Volume field regardless of any edit — hand-editing
  V<sub>f</sub> now actually affects the calculation instead of being silently
  ignored.
- Cache version: webreportwriter-v70

## 2026-07-28 — Indent h3 subsection content + stop rounding Table B.2's elapsed time
- Operating Conditions/Test Results field-rows, tables, and the Comments box now
  indent under their h3 subheading (Test Fluid, Test Dust, Differential Pressure,
  ...) instead of sitting flush with it — a general sibling CSS selector
  (`h3 ~ .field-row` etc.), not a template rewrite, since every h3-less section
  (Test/Filter Identification) happens to come before the first h3 in these
  templates. Applies to both ISO 4548-12 and ISO 19438 (shared, standard-agnostic
  CSS) — confirmed ISO 16889's template has no `<h3>` at all, so it's unaffected.
- Table B.2's per-clump elapsed time was rounding to the nearest whole minute
  ("Elapsed Time (h:mm)" — a 37.55-minute bucket printed as "0:38", losing real
  precision, not just cosmetic). Switched to "h:mm:ss" — lossless, since the
  underlying value was always derived from a whole-second timestamp to begin with.
- Cache version: webreportwriter-v71

## 2026-07-28 — DP figure Y-axis no longer forces 0; efficiency chart axis survives no-data
- The DP-vs-time figure's left (ΔP) axis no longer forces a 0 floor. That was
  specific advice for ISO 4548-12's Figure B.1 at the time; never given for ISO
  19438's Figure B.2, and per the user, forcing it there actually made the chart
  read worse than auto-scaling from the real data range does. Both standards' DP
  figures now compute Y min/max from the actual data (`rightAxisMode:"even"`'s own
  -10%/110% range, unaffected, still applies for ISO 19438 regardless).
- The overall-efficiency-vs-size log chart (Figure B.3/B.3): a filter reading 100%
  efficient across every measured size is a valid result with nothing left to plot
  (penetration=0 can't sit on a log axis) — that's fine, per the user. But the chart
  used to `return null` in that case, which dropped the axis too, not just the
  (correctly absent) line — Chart.js's own auto-scaling of an empty dataset falls
  back to a meaningless 0-1 default range instead of the real particle-size domain.
  Fixed: the chart always builds now, with the X axis explicitly ranged from the
  full measured size list rather than from whatever points happen to survive
  filtering — so the axis labels are always correct, whether or not there's a line
  to go with them.
- Cache version: webreportwriter-v72

## 2026-07-28 — Empty-plot explanation on the log-scale efficiency chart
- The log-scale efficiency chart (B.3) now draws "No visible plot points — every
  size filtered >99.9% efficiency" directly on the canvas when there's nothing to
  plot (every measured size read at the axis's own ceiling) — otherwise a perfect
  result looked identical to a broken/empty chart. Canvas-drawn, not an HTML overlay,
  so it also appears in print. Log-scale only — the linear chart never drops points
  this way, so an empty linear chart means genuinely missing data, a different
  situation this message doesn't claim.
- Cache version: webreportwriter-v73

## 2026-07-28 — DP figure's right axis: "Percentage" spelled out, ticks show "%"
- The DP-vs-time figure's right axis title reads "Net ΔP (Percentage)" now (was
  "Net ΔP (%)"), and each tick label carries its own "%" symbol (was a bare number)
  — applies to both standards' DP figures (ISO 4548-12's Figure B.1 and ISO 19438's
  Figure B.2), shared code.
- Cache version: webreportwriter-v74

## 2026-07-28 — "Percentage" + "%" ticks applied to the other efficiency-vs-size axes
- Same pattern just applied to the DP figure's right axis, extended to the
  overall-efficiency-vs-size figures' Y axis: "Overall efficiency (Percentage)"
  (linear, was "(%)") and "Overall efficiency (Percentage) — log scale" (log), each
  tick now carrying its own "%" (was a bare number either way). Checked the rest of
  chartView.js/chartData.js for any other percentage-based axis — these two plus the
  DP figure's right axis (done previously) were the only ones.
- Cache version: webreportwriter-v75

## 2026-07-27 — Standard-year label + gravimetric button relabel
- Sidebar's standard sub-menu now reads "ISO 4548-12 (2017)", tagging it with the
  published standard's year since that module is a clean build against the actual
  standard text. "ISO 16889" is deliberately left untagged — that module is derivative
  of the legacy Bonavista Excel/VBA workbook, not a fresh rewrite against a specific
  published edition, so a year would misrepresent its provenance (see this file's ISO
  16889 provenance warning).
- Report context toolbar's gravimetric button relabeled "Add/Edit Gravimetrics" (was
  "Gravimetric results") to read as an action rather than a report section name.
- Cache version: webreportwriter-v53

## 2026-07-27 — App icon: red Chaucer "B" for Bonavista Technologies
- Replaced the icon's abstract "M"-like glyph with a capital "B" (Chaucer font, falling
  back to Herculanum/Copperplate/serif since Chaucer isn't a standard installed/web
  font), in red, on the app's cream background — standing for Bonavista Technologies,
  Inc.
- Cache version: webreportwriter-v54

## 2026-07-27 — Sidebar label: "Report" → "Standard Report"
- Sidebar mode button relabeled for clarity.
- Cache version: webreportwriter-v55

## 2026-07-27 — Editable chart axes (click a chart to override its min/max)
- Every chart in the app — Explorer custom plot tabs, Compare Files, and ISO 4548-12's
  Figures B.1/B.2/B.3 — can now have its X and Y axis min/max overridden by clicking
  directly on the chart (no separate button; a small hint line under each chart says
  so). The form that opens offers Preview (try values without committing), Save (keep
  the override for the rest of the session — it now survives unit toggles, field
  edits, tab switches, and printing), and Revert to default (back to auto-scale).
- SESSION-ONLY by design: overrides live in memory only (`chartAxisControls.js`) and
  are never written to localStorage or exported into a saved chart-tabs/report-session
  `.json`. A reload or a freshly loaded file always starts from each chart's computed
  default.
- Figure B.3 (the log-scale efficiency chart) only exposes an X-axis override — its Y
  axis is a fixed, standard-defined 3-decade band and isn't overridable.
- Toggling the SI/US unit switch clears any saved report-figure overrides, since a
  saved override's numbers were entered in whichever unit system was showing at the
  time and would otherwise silently misrepresent the chart after conversion.
- Under the hood: `chartData.js`'s single-file dataset builders (particle counts, a
  named channel, multi-channel overlays) now emit `{x: minutes, y: value}` points
  instead of a shared category-axis label list, so their charts get a genuine linear
  time axis — required for a numeric X-axis override to mean anything. Removed the
  now-dead `formatElapsedMinutes` helper this replaced.
- Cache version: webreportwriter-v56

## 2026-07-27 — "Edit Chart" button (replacing click-on-chart) + print fixes
- Replaced the "click anywhere on the chart to edit its axes" interaction with an
  explicit "Edit Chart" button beside each plot — clicking the canvas directly only
  worked in certain spots (Chart.js's own hit-testing), which read as broken rather
  than discoverable. Same Preview/Save/Revert form as before, just opened by a real
  button now. `chart-wrap` is now a flex row (the plot's own sizing box +
  the button) across Explorer custom tabs, Compare Files, and the ISO 4548-12 report
  figures.
- Fixed a print regression this uncovered before it shipped: forcing `.chart-wrap`
  back to `display:block` for print (to hide the button) would have collapsed the
  chart's height to 0, since it relies on flex's stretch behavior for sizing, not an
  explicit height — left it as `display:flex` and just hidden the button itself.
- ISO 4548-12 Page 1 print sizing: a real print overflowed page 1 onto a second page
  by about a line. Trimmed the whitespace around h2/h3/field-row/table elements
  (not font sizes or line-height, to leave readability alone) — page 1 stacks enough
  of these that even a 1-2px-per-element trim recovers several lines.
- Cache version: webreportwriter-v57

## 2026-07-27 — Widened the print page's right margin (physical-printer clipping)
- A real printed copy showed the right edge of page 1's tables clipped, but the
  browser's own print preview (a screenshot of it) showed nothing wrong — the CSS
  layout fits inside the requested margin fine, so the cause is that printer's own
  non-printable hardware margin being wider than the 0.5in we were asking for on that
  edge, not a layout bug. `@page`'s margin is now `1in 0.7in 1in 0.5in` (top/right/
  bottom/left) — 0.7in of safety buffer on the right specifically, since that's the
  edge it was observed on; left/top/bottom unchanged since no issue was reported there.
  If 0.7in still isn't enough for a given printer, the number to widen further is this
  same `@page` rule.
- Cache version: webreportwriter-v58

## 2026-07-27 — Squarer B.2/B.3 figures + pencil-icon edit button
- Confirmed via a real print preview: page margins and page-1 pagination are both
  fixed now (v58's margin widen + earlier compaction). Two follow-up refinements from
  that same screenshot:
- Figures B.2/B.3 (the double-fig page) are now ~1.37:1 (was ~1.97:1) and a bit
  taller — 3.8in tall x 5.2in max-width, centered, up from a full-width 3.7in-tall
  strip — reads as squarer plots using more of the page, still within the page's
  actual vertical budget (recomputed: ~7.75in available for both charts, 3.8in x 2 =
  7.6in keeps a small safety margin so this doesn't reopen the page-overflow issue
  just fixed). Figure B.1 (single-fig) untouched.
- The "Edit Chart" button is now a small pencil-icon (✎) square instead of a
  text-labeled button — the label made the button read as visually enlarging the plot
  area beside it. `title`/`aria-label` carry the same meaning as a tooltip.
- Cache version: webreportwriter-v59

## 2026-07-27 — Pencil button moved into the plot's lower-right corner
- The edit-axes pencil button is now a floating overlay in the plot's lower-right
  corner (`position:absolute` within `.chart-wrap`) instead of sitting beside the
  chart in its own column. This let `.chart-wrap` drop the flex-row layout entirely —
  `.chart-canvas-box` just fills its parent via plain width/height:100% now, no flex
  involved, which also removed the flex-vs-print-reset complexity noted in v57/v59's
  CSS comments (no longer applicable now that there's no flex to reset).
- No JS changes needed — the button was already just a DOM sibling of
  `.chart-canvas-box` inside `.chart-wrap`; only the CSS positioning changed.
- Cache version: webreportwriter-v60

## 2026-07-27 — B.2/B.3 back to full width, height maxed within the page budget
- Reverted the max-width/centering from the previous change — it made the figures
  read as smaller overall (narrower, without meaningfully taller), not the intended
  improvement. Figures B.2/B.3 are full page width again, matching Figure B.1's width
  on the preceding page, per the user's correction.
- Height: the true "15% taller than the original 3.7in" (~4.26in) doesn't fit —
  recomputed the page's actual non-chart overhead (~1.25in: header + 2 captions + 2
  figure-wrap margins) against the ~9in usable height and it's short by about 0.75in,
  enough to spill Figure B.3 onto its own extra page. Landed on 3.85in each (~4%
  taller, the tallest that still keeps a small safety margin) rather than the exact
  7.75in ceiling with zero room for rendering variance, given this page already
  overflowed once at a tighter height.
- Cache version: webreportwriter-v61

## 2026-07-27 — Root-caused the "figures never actually get taller" bug
- The last two rounds of resizing B.2/B.3 (v59-v61) kept producing the same amount of
  blank space at the bottom of the page no matter what height value was used — a
  strong sign the CSS height wasn't actually the bottleneck. Root cause: the
  .chart-canvas-box wrapper added for the button's flex-row layout sized itself with
  height:100% (a PERCENTAGE, depending on its parent having already resolved a height
  in the same layout pass) instead of an explicit height — and this project has
  hit and fixed this exact class of bug before (see app.js's redrawForPrint comment:
  "figures visibly not filling anywhere near the printed page's height"). The
  percentage indirection reintroduced it.
- Fix: removed .chart-canvas-box entirely. The button became a position:absolute
  overlay two changes ago and never needed to share a sizing box with the canvas in
  the first place — canvas is a direct child of .chart-wrap again, measuring against
  its EXPLICIT height, same as before this whole feature was added. No height/width
  values changed in this entry; this is the same 3.85in/full-width from v61, now
  actually reaching that size in print.
- Cache version: webreportwriter-v62

## 2026-07-27 — Report figures: stop measuring the DOM for print, use known dimensions
- The "figures print short" problem predates today's session and survived several
  rounds of CSS height changes with zero visible effect — a sign the CSS height was
  never actually the bottleneck. Ruled out a mismatched selector and a stray
  conflicting rule (there weren't any) before concluding this is a browser
  print-layout measurement-timing race that this project had already tried the
  standard fixes for (beforeprint + matchMedia + rAF-delayed rebuild) without it
  actually working.
- New approach: stop trying to measure the print-styled container at all.
  `reportView.js`'s new `computePrintFigureSizePx` computes each figure's intended
  canvas pixel size directly from known constants (paper size, `@page` margins, the
  figure's own CSS height) — no DOM measurement involved — and
  `renderDPFigureChart`/`renderEfficiencyFigureChart` (chartView.js) now accept an
  optional `explicitSizePx` that calls `chart.resize(width, height)` with that
  known-correct value right after construction, overriding whatever Chart.js's own
  auto-measurement would have decided. Screen rendering (`explicitSizePx` omitted)
  is unaffected — only `app.js`'s print-triggered redraw computes and passes it, now
  split into `redrawForPrint` (passes the current paper size) vs `redrawForScreen`
  (afterprint / leaving print mode — reverts to normal auto-measured sizing).
- These new JS constants duplicate values already in `app.css`'s `@page` and
  `.figure-wrap` print rules — cross-referencing comments added at both ends since
  nothing keeps them in sync automatically.
- Cache version: webreportwriter-v63

## 2026-07-27 — Real safety margin for page-1 and Table B.2 pagination
- The figure-sizing fix (v63) confirmed working — plots print correctly now. But a
  different test file (not the one page-1's spacing and Table B.2's clump count were
  tuned against) overflowed both again: page 1 pushed content to page 2, and a Table
  B.2 sheet bled a clump onto an extra page. Not a regression from v63's chart
  changes (unrelated code) — both fixes had been tuned to JUST fit one specific
  file's field-value lengths and bucket count, with too little margin for a different
  file's slightly longer text/more buckets.
- Page 1: trimmed h1/h2/h3/field-row/table spacing further (still no font-size or
  line-height changes) — enough to absorb a field wrapping to an extra line, not
  just enough for one file.
- Table B.2: `CLUMPS_PER_PAGE` 5 → 4 (this is the second time it's been ratcheted
  down — was 6 originally, then 5, now 4 — each step after a real print overflowed
  at the previous count). Trades some extra pages on files with many buckets for
  actually not overflowing.
- Cache version: webreportwriter-v64

## 2026-07-27 — Page 1 print overflow: fixed with an actual count, not another guess
- Two prior rounds of trimming page-1 print spacing both undershot because they
  guessed at the element counts driving the page's height ("8 h3 + ~15 field-rows")
  instead of counting them. Grepped the actual template: 4 h2, 10 h3, 23 field-rows,
  4 tables (13 rows) — meaningfully more than either earlier guess assumed, which is
  why trims sized against the wrong count kept overflowing on real files.
- Re-sized against the real counts, verified by adding up every element's actual
  height contribution: ~793.5px (~8.26in) of content against the ~9in usable page,
  ~0.74in of real margin. Also cut `.report-page`'s line-height 1.3 → 1.25 (applies
  to every print page, all standards, still comfortably readable) — with 50+ lines
  of text on this one page, a small per-line saving outweighs any single element's
  margin, and it's a net positive for every other print page too, not just this one.
- Cache version: webreportwriter-v65

## 2026-07-27 — Page 1: give Comments its own smaller font, overshoot the margin
- Still overflowed on a third file — this time the Comments free-text note wrapped
  to 2 lines. The prior round's hand-computed ~0.74in margin should have covered
  that on paper, but didn't in practice: real browser font-metric rounding eats more
  margin than a flat line-height multiplier can predict exactly across 50+ lines of
  compounding content.
- Comments is also the one field on this page with genuinely UNBOUNDED length (free
  text a technician types, unlike every other bounded label/value) — no fixed
  layout budget can fully guarantee it always fits, no matter how much margin exists
  elsewhere. Gave it its own smaller print font (9.5px, matching the numeric tables'
  precedent) so a long note is less likely to wrap at all, and costs less when it
  does. Also cut line-height again (1.25 → 1.2, still readable) — this round
  deliberately overshoots the margin rather than computing to another exact edge.
- Cache version: webreportwriter-v66

(Older entries below were written under a since-retired workflow — whole-project edits
exported as a `.zip`, one entry per zip. Kept as-is for the record.)

---

## 2026-07-27 — Replaced sticky sidebar/header with a fixed-height shell + internal scroll
- The v51 z-index/stacking-context fix (`isolation: isolate`) did NOT resolve the
  reported bug — scrolled report content was still visible above the sticky header,
  in the gap between the browser's own chrome and wherever the header had stuck.
  That confirmed the cause wasn't (purely) paint order, so rather than keep guessing
  at the exact sticky-in-flexbox mechanism, switched to a fundamentally more robust
  pattern that sidesteps the whole problem: `.wrap` is now a FIXED-HEIGHT shell
  (`height: 100vh; overflow: hidden`), not a normally-scrolling page. `.sidebar` and
  the active `.context-toolbar` are simply never inside a scrolling ancestor at all —
  nothing to "stick" to, no position:sticky anywhere anymore. `.content` is a flex
  column; `.view.active` is the ONE actual scrolling pane (`flex: 1; overflow-y:
  auto`), filling whatever height is left below the context toolbar.
- `@media print` resets every one of these constraints (`height: auto; overflow:
  visible`) on `.wrap`/`.content`/`.view.active` — critical, since without that reset
  the printed report would be clipped to a single viewport's worth of content instead
  of flowing across sheets naturally.
- Narrow-viewport fallback (`max-width: 720px`) falls back further, to the ORIGINAL
  whole-page-scrolls model (sidebar stacks above content, nothing height-constrained)
  — the fixed-shell/internal-scroll approach is a desktop-width refinement, not
  something worth preserving on narrow screens where it was never the point.
- Cache version: webreportwriter-v52

---

## 2026-07-27 — Fixed sticky header letting scrolled report content paint over it
- Follow-up to the same-day sticky sidebar/context-toolbar work: scrolling a report
  showed content painting ABOVE the sticky header instead of staying underneath it —
  a z-index comparison gone wrong. `.wrap` (sidebar + content) had no explicit
  stacking-context boundary, so the sticky header's z-index was only guaranteed to
  win against elements compared within whatever stacking context they actually ended
  up in — several plain, unpositioned levels down inside `.content > .view >
  .report-page`, that comparison wasn't landing where expected.
- Fixed: `.wrap` now sets `isolation: isolate`, pinning down ONE predictable stacking
  context for the whole layout (sidebar, every context toolbar, every report page) —
  z-index comparisons happen in that one place instead of wherever they'd otherwise
  fall. `.sidebar`/`.context-toolbar.active`'s z-index also raised 5 -> 10 for extra
  headroom.
- Cache version: webreportwriter-v51

---

## 2026-07-27 — Remembers the last-used mode (Explorer/Report/Compare) across sessions
- Follow-up to the same-day last-standard preference, same reasoning: the app now
  opens to whichever mode (Data File Explorer / Report / Compare Files) was last
  used, instead of always defaulting to Explorer. New `loadLastView`/`saveLastView`
  in `app.js` (`localStorage` key `webreportwriter-last-view`), saved on every
  `showView()` call (including the startup one, harmlessly re-saving the same value)
  and validated against the 3 known view names on read.
- Cache version: webreportwriter-v50

---

## 2026-07-27 — Remembers the last-used standard across sessions
- `currentStandardId` now defaults to whichever standard was last selected
  (`localStorage`, key `webreportwriter-last-standard`), falling back to ISO 16889
  only on a first-ever visit or if storage is unavailable — per the user, most
  customers repeatedly report against the same standard for their media type
  (hydraulic -> 16889, fuel -> 19438, lube -> 4548-12), so re-selecting it every
  session was pure friction.
- New `loadLastStandardId`/`saveLastStandardId` in `app.js` — deliberately NOT using
  `customDefaults.js`'s per-standard storage (that persists each standard's OWN field
  data and must stay scoped separately); this is one global "which one to open to"
  preference. Saved on every `#standardSwitch` click; `#standardSwitch`'s active
  button is corrected at startup to match (`index.html` hardcodes ISO 16889 active,
  needs fixing up when a different standard was persisted).
- Cache version: webreportwriter-v49

---

## 2026-07-27 — Sidebar and context toolbar stay pinned while scrolling a report
- `.sidebar` and `.context-toolbar.active` are now `position: sticky; top: 20px`, so
  scrolling down a long report leaves navigation and Print/Paper size/etc. visible
  at the top of the viewport instead of scrolling away with the report content —
  the user's actual goal: reach Print without scrolling back up first.
- No structural change needed — `.wrap`'s existing `align-items: flex-start` (F-layout
  work, same day) is what makes `position: sticky` meaningful on a flex item at all
  (a stretched item already spans the full row height with nowhere to "stick" to).
  Both already had solid backgrounds (`.sidebar-group`/`.toolbar`'s `var(--card)`), so
  scrolled report content doesn't show through underneath them.
- Print output unaffected — `.sidebar`/`.context-toolbar` are already `display:none`
  at print time, which overrides `position: sticky` entirely.
- Cache version: webreportwriter-v48

---

## 2026-07-27 — Standard selector moved into an expanding sidebar sub-menu
- Follow-up refinement to the same-day F-layout: the Standard dropdown (`select`) in
  Report's context toolbar is gone — `#standardSwitch`, a small button sub-menu, now
  expands directly under the "Report" sidebar button instead (visible only while
  Report is the active mode, same show/hide mechanism `app.js`'s `showView()` already
  used for context toolbars).
- `#standardSwitch`'s buttons are nested INSIDE `.sidebar-group.view-switch` (so they
  visually read as Report's children) — this meant the existing `.view-switch button`
  descendant selectors in `showView()` would also match them (they carry
  `data-standard`, not `data-view`) and incorrectly clear whichever standard was
  active on every mode switch. Fixed by scoping those two selectors to
  `.view-switch > button` (direct children only) — caught before it shipped, not a
  live bug.
- Cache version: webreportwriter-v47

---

## 2026-07-27 — F-layout: sidebar navigation + per-mode contextual toolbars
- Replaced the single horizontal toolbar (every control, every mode, always visible)
  and the large dropzone region with an F-layout: a left `.sidebar` (Load data file,
  the 3 mode buttons, Units — the only truly cross-mode control) and a `.content`
  area holding one contextual toolbar per mode, shown/hidden by `showView()` the same
  way `.view`/`.view.active` already worked (`app.js`'s `showView()` now also toggles
  `.context-toolbar.active`, one added line).
- Placement of the two ambiguous controls was grounded in what the code actually
  does, not guessed: Standard selector and Save/Load session (.json) both turned out
  to be Report-view-only already (`explorerView.js` never reads `currentStandardId`;
  "Load session" only ever calls `refreshReport`) — moved into Report's context
  toolbar along with Sensor/Select display sizes/Gravimetric results (existing,
  conditional)/Paper size/Print. Save/Load chart tabs moved into Explorer's context
  toolbar. Compare Files needed no context toolbar — `compareView.js` already manages
  its own controls inside its view.
- Dropzone removed entirely, not just visually — drag-and-drop-a-file-onto-the-page
  is gone, per the user; "Load data file" in the sidebar opens the same `#fileInput`
  picker the dropzone used to.
- The double-click-editing explanation (`.footer-note`, previously global below every
  view regardless of mode) moved into Report's context toolbar as a `.hint.hint-full`
  line, since it only describes Report-view behavior.
- Every existing element kept its id — only parent containers moved — so no other
  file's DOM selectors needed changes; `updateReportingControlsVisibility()` targets
  `sensorGroup`/`displaySizesGroup`/`gravimetricGroup`/`sensorDivider` by id
  regardless of which toolbar now contains them.
- `@media print` now hides `.sidebar`/`.context-toolbar` (was `.toolbar`/
  `.view-switch`/`#dropzone`) and un-flexes `.wrap` for print so the printed report
  isn't constrained by the sidebar's flex row.
- Cache version: webreportwriter-v46

---

## 2026-07-27 — iso454812Analysis.js reorganized into 3 domain lenses
- Pure reorganization, no behavior change: `iso454812Analysis.js`'s regions (and
  constants above the class) are now grouped by domain concern — Pressure (channels,
  termination, ΔP milestones), Particle Count (sensor selection, efficiency, sizes,
  micrometer ratings, count cycles), Mass (gravimetric mass balance) — plus a small
  Validation region, instead of by execution-step number.
- The one real cross-lens dependency (termination time/tag, Pressure's output, read
  by both Count and Mass) is now an EXPLICIT parameter — `_computeBucketEfficiency`,
  `_computeCountCycles`, and `_computeGravimetricMassBalance` take it as an argument
  instead of reading `this.terminationTime`/`this.terminationTag` implicitly. `run()`
  now reads as the dependency wiring diagram: Pressure runs first, its output is
  captured into one `termination` object, then explicitly threaded into Count and
  Mass. Intra-lens reads (e.g. `_computeNetDPMilestones` reading `this.cleanAssemblyDP`,
  set by `_readCleanBaseline` just before it, same lens) are untouched.
- Deliberately kept as ONE file (not split into 3), and the external result-object
  shape (every flat property `iso454812Mapper.js`/`app.js`/`reportView.js` reads) is
  completely unchanged — zero edits needed in any of those 3 files. See the plan file
  for the full reasoning (classic-script loading makes a real file split meaningfully
  more expensive here than in a typical ES-module codebase, for no behavior gain).
- Cache version: webreportwriter-v45

---

## 2026-07-27 — Removed dead DataFile.fmtElapsed
- Follow-up to the same-day dataFile.js audit: `DataFile.fmtElapsed` (static) was
  never called anywhere in the project — superseded by `helpers/analysisMath.js`'s
  own `formatElapsed`, already the one actually used by both analysis engines and the
  mapper (deliberately duplicated there so analysis engines have zero dependency on
  `dataFile.js` itself). Removed; updated `analysisMath.js`'s comment, which
  referenced the now-deleted method.
- Cache version: webreportwriter-v44

---

## 2026-07-27 — dataFile.js audit: dead code + unverified guesses
- Full pass over `dataFile.js` at the user's request, checking for illogical ordering
  (reading a flag/field before it's set) and unconfirmed assumptions.
- **Dead code, not a live bug**: `analogTags` (the `;Data Format` channel list) had
  two apparent capture sites — one inline in the header-sections loop, one a
  commented "fallback" that rescans the whole file. In every real file this session,
  `;Data Format:,<channels...>` sits AFTER the `DATA` marker (it's the data block's
  own column-label comment, not a header section), so the inline branch's loop bounds
  never reach it — it never fired against any real file. The "fallback" was actually
  the only working path. Removed the dead inline branch; relabeled the real capture
  site's comment so it no longer reads as a fallback for a mechanism that never
  worked.
- **Confirmed, left as-is**: `testSetup`'s full documented value set (Spin On /
  Suction / Suction & Pressure, alongside Pressure / Two Pressure already confirmed
  this session); the `LBSizes` -> bare `"Sizes"` legacy-key fallback (confirmed
  against a real pre-LB/LS/LBE-naming file — comment strengthened to say so).
- **Guessed, removed**: `MidstreamFlag` accepted `"TRUE"`, `"#TRUE#"`, and `"1"`
  (case-insensitive). Only `"TRUE"` is confirmed — every real file this session
  spelled it `"True"`/`"False"`. `"#TRUE#"`/`"1"` were defensive guesses for an
  Excel/VBA boolean-serialization variant never actually observed; low-risk either
  way (the field already defaults to `false`, so a real unmatched variant would be a
  false negative, not a false positive), but not evidence-based, so dropped.
- No behavior change for any file structure seen so far — the dead code never ran,
  and no real file has used `"#TRUE#"`/`"1"`/`"Suction & Pressure"`-adjacent unverified
  forms differently than before.
- Cache version: webreportwriter-v43

---

## 2026-07-27 — Manual entries no longer wiped by a sensor/standard switch
- Root cause of a real bug: `app.js`'s `runAnalysisPipeline` (the function behind the
  Sensor dropdown, Select Display Sizes, and the Standard switcher — anything that
  re-analyzes an already-loaded file) always did `store = new ReportValueStore()`, a
  completely fresh store, on every re-run. Since manual entries (gravimetric results,
  any double-click override) exist ONLY in the in-memory store, switching sensors —
  or anything else that re-ran the pipeline — silently discarded them. This predates
  the gravimetric dialog; that feature just made the data loss newly costly (lab
  results entered, then gone after one sensor click) instead of a purely theoretical
  gap.
- Fixed: `ReportValueStore` gains `getUserEntries()` (every field with a non-empty
  User Entry, id -> value). `runAnalysisPipeline` now snapshots these BEFORE rebuilding
  the store and re-applies them after — a genuinely NEW file load (`loadFileText`)
  resets `store` itself first, so there's nothing stale to carry into a different
  file; a re-run on the SAME file now preserves every manual entry across it.
  Rebuilding the store fresh (rather than reusing the old instance in place) was kept
  deliberately — it avoids a DIFFERENT staleness risk, a conditionally-set `fromData`
  field from the old sensor/standard's analysis lingering when the new one doesn't
  set it.
- Injection grav. Average / Non-Retained Mass / Retained Capacity derive FROM
  Initial/Final/Gf rather than being entered directly, so preserving the raw values
  alone wasn't enough — they'd survive a switch while their own derived fields went
  blank again. Factored the shared computation into `recomputeIso454812GravimetricDerived()`,
  now called both after the gravimetric dialog saves and after `runAnalysisPipeline`
  restores previously-entered values.
- Cache version: webreportwriter-v42

---

## 2026-07-27 — ISO 4548-12: gravimetric dialog now recomputes Injection Grav. Average
- Follow-up fix to the same-day gravimetric entry dialog: "Injection grav. Average
  Gia" was only ever set once at load time from the raw header value
  (`analysis.gia`), before Initial/Final could be entered independently — saving the
  dialog updated Initial/Final (visibly highlighted as overridden) but left Average
  stale. Fixed: the dialog's save handler now recomputes Average as the mean of
  whatever's currently resolved for Initial and Final (`store.get`, so a slot left
  untouched this save still falls back to its own existing value rather than being
  treated as missing), same "iso454812-specific, computed after user entries are
  applied" pattern already used for Mnr/Cr.
- Cache version: webreportwriter-v41

---

## 2026-07-27 — ISO 4548-12: gravimetric results dialog + Non-Retained Mass / Retained Capacity
**New:**
- A "Gravimetric results" toolbar button opens a dialog for entering the 3 gravimetric
  quantities a `.DAT` file can never supply on its own — Initial/Final Injection
  Gravimetric and Final Test Gravimetric (Gf) — since they require processing lab
  samples after the test finishes. Modeled on the lab's old Excel/VBA `frmGrav`
  dialog: each quantity supports a direct mg/L value (default) or a value calculated
  from Volume + Dirt Weight, where each of THOSE can itself be entered directly or
  derived from raw weighings (Full Cup − Empty Cup ÷ a new Specific Gravity input, for
  Volume; Dirty Pad − Clean Pad, for Dirt Weight) — live-recomputed on every
  keystroke, same as the old form's behavior. New file: `src/report/
  gravimetricEntryView.js` — deliberately standard-agnostic (takes a caller-supplied
  `specs` list), so a future ISO 16889 wiring wouldn't need to touch this file, only
  supply its own specs and formula.
- Non-Retained Mass (Mnr) and Retained Capacity (Cr) are now computed once Gf is
  entered: `Mnr (g) = testVolume (L) × Gf (mg/L) / 1000` (final test volume assumed
  equal to the test's initial Volume, per the user — a separately-measured final
  volume isn't tracked), `Cr = M1 − Mnr`. New `Iso454812Analysis.computeMassBalance()`
  — kept in the analysis engine, not the mapper, per this project's "mapper only
  names, never computes" rule. Previously these two fields could never populate at
  all (Gf had no computation path even once entered).
- Saving the dialog does **not** re-run the full analysis pipeline (unlike the
  existing Select Display Sizes dialog) — it writes directly into the current
  `ReportValueStore` and re-renders in place. Re-running the full pipeline rebuilds
  the store from scratch, which would silently discard any OTHER manual edit made
  earlier in the session — a real risk here specifically, since lab gravimetric
  results often come back days after the rest of a report was already filled in.
- Cache version: webreportwriter-v40

---

## 2026-07-27 — ISO 4548-12: Sensor/Sample Flow Rate corrected to per-sensor-type, not up/down
- Follow-up correction to the same-day dilution ratio fix: Sensor Flow Rate and Sample
  Flow Rate's two comma values on a given header line are NOT a meaningful upstream/
  downstream pair (per the user — both probes draw from the same reservoir at the
  same setpoint), so the "a / b" display from the previous fix was wrong. Only ONE
  value is now shown, and the sensor-selection-dependent LBSensorFlow/LSSensorFlow
  fallback from that same fix is replaced: both sensor types now show together,
  tagged, regardless of which one is currently selected (e.g. `"25(LB) 10(LS)"`) —
  this is static dilution-system config, not something that should change with the
  sensor toggle.
- Sample Flow Rate's ExRaDs case needed a real fix in `dataFile.js`: its "SampleFlow"
  key repeats (once for the primary/LB stage, again for the extended/LS stage) and
  `getHeaderValue`/`getHeaderValues` only ever return the FIRST match — a gap that
  file's own header comment had flagged as "not implemented" since earlier this
  session. Added `getAllHeaderValues()` (returns every occurrence, in file order);
  confirmed against a real file that the first occurrence sits with the primary/LB
  stage and the second with the extended/LS stage.
- Cache version: webreportwriter-v39

---

## 2026-07-27 — ISO 4548-12: dilution ratio / sensor flow rate for ExRaDs files
- ExRaDs machines don't carry a plain "DilutionRatio"/"SensorFlow" header key — they
  split dilution into `PrimaryDilutionRatio` (stage 1) + `ExtendedDilutionRatio`
  (stage 2), and sensor flow into `LBSensorFlow`/`LSSensorFlow`. The mapper only ever
  looked for the plain keys, so these files showed nothing for either field —
  `dataFile.js` had a whole comment block flagging this exact schema as "background
  knowledge, not yet parsed," now acted on.
- Dilution Ratio falls back to Primary+Extended when the plain key is absent, shown
  together per the user (e.g. `"11:1 / 19:1 (ext)"`) rather than combined into one
  number — multiplying them would be wrong (a real file's downstream Primary=0,
  Extended=19 would multiply to 0:1, but 0:1 is itself a legitimate reading here: no
  clean fluid used, sample measured undiluted — useful when a filter is efficient
  enough that undiluted counts still stay within the counter's coincidence limits).
  `formatDilutionRatio` in `iso454812Mapper.js` checks presence by array index, never
  by truthiness, so a real "0" ratio is never mistaken for a missing one.
- Sensor Flow Rate falls back to `LBSensorFlow`/`LSSensorFlow` for whichever sensor is
  CURRENTLY SELECTED, same sensor-awareness the display-size picker already has.
- Cache version: webreportwriter-v38

---

## 2026-07-27 — ISO 4548-12: "Dust added W" now computed
- `dustAddedW` was in the mapper's "NOT AVAILABLE" list (left blank, hand-entry only).
  Per the user, it's computable: injection gravimetric level (mg/L) x the injection
  reservoir's own total volume (L, header's Injection System Configuration/Volume) /
  1000 (mg -> g). Added as `analysis.dustAdded` in `iso454812Analysis.js`'s
  `_computeGravimetricMassBalance` (computation lives in the analysis engine, not the
  mapper, per this project's "mapper only names, never computes" convention) and wired
  into the mapper same as the other gravimetric fields.
- NOT the same quantity as Injected Mass M1 (mass actually delivered over the test's
  duration, via flow-rate integration) — W is simply how much dust was measured into
  the batch, independent of how much was pumped through. Both are now computed,
  distinctly, from the same header gravimetric level.
- Cache version: webreportwriter-v37

---

## 2026-07-27 — Figure B.1 (DP vs. Time) now respects the SI/US toggle
- Figure B.1's left (ΔP) axis, its values, and the right axis's 7 milestone ticks
  (which share the left axis's numeric domain — see chartView.js's file-top note)
  were hardcoded to kPa regardless of the unit toggle — a documented, known gap from
  when the figure was first built. `renderDPFigureChart` now takes a `units` param and
  converts at the point of use (kPa canonical -> display unit), same "convert at the
  edges" rule as every other report field; the axis title also relabels
  (`displayUnit("kPa", units)`).
- Threaded `units` from `app.js`'s unit-toggle handler and print-redraw hook, through
  `reportView.js`'s `fillReportCharts`/`redrawReportCharts`, to `renderDPFigureChart`.
  Figures B.2/B.3 unaffected — they have no unit-bearing axis (percent and µmC only).
- Cache version: webreportwriter-v36

---

## 2026-07-25 — Units toggle: "US" relabeled "Eng"
- `index.html`'s Units dropdown now shows "Eng" instead of "US", matching typical shop
  usage. The underlying `value="US"` (and every `"SI"|"US"` code path in units.js,
  reportView.js, etc.) is unchanged — display text only, no behavior change.
- Cache version: webreportwriter-v35

---

## 2026-07-25 — ISO 4548-12: Test System Flowrate Q now converts to gal/min
- `units.js` gains a "flow" quantity (L/min <-> US gal/min, 1 gal = 3.785411784 L),
  kept deliberately separate from the small mL/min injection/sensor/sample flow
  fields, which stay fixed — converting those to gal/min would show unreadable tiny
  fractions (e.g. 25 mL/min ~ 0.0066 gal/min), confirmed with the user as out of scope.
- `testFlowrateQ` (Test System's "Flowrate Q") is now tagged `"L/min"` in
  `iso454812Mapper.js`, so both its value and its unit label (via the sibling-`.unit`
  relabeling added in the previous entry) convert on the SI/US toggle. `testVolume` is
  a quantity, not a rate, and stays untagged like every other volume/concentration
  field in this file.
- Cache version: webreportwriter-v34

---

## 2026-07-25 — ISO 4548-12: unit toggle now relabels + converts pressure and temperature
- Investigated a report that "the SI/US toggle changed nothing" — turned out nothing had
  regressed; two separate pre-existing v1 gaps, now closed:
- The ΔP fields' VALUES already converted correctly (kPa->PSI math was fine), but each
  one's unit label was static template text (`<span class="unit">kPa</span>`) that
  never relabeled — a converted number sitting next to a label still claiming "kPa"
  read as broken even though the number was right. Fixed generically in
  `reportView.js`'s `fillSlots`: any `[data-slot]` field with a canonical unit now
  relabels its sibling `.unit` span via `displayUnit()` — works for any current or
  future unit-tagged field in either standard's templates, not a per-field fix.
- Temperature was never unit-tagged in `iso454812Mapper.js` at all, so it neither
  converted nor relabeled — now tagged `"°C"`, using the same `°C<->°F` conversion
  `units.js` already implements. Flow rate, volume, and concentration fields are
  confirmed correctly NOT converting (deliberate — this project always shows liters/
  mg-per-L regardless of the SI/US toggle, there's no gallon equivalent wanted).
- Cache version: webreportwriter-v33

---

## 2026-07-25 — ISO 4548-12: Figure B.3's log scale now plots penetration, not efficiency
- Figure B.3's Y axis previously plotted `log(efficiency%)` directly — this compresses
  the HIGH-efficiency end into a sliver at the top of the chart (log compresses large
  values together), the opposite of the intent (making 90-99.9% legible for
  high-efficiency filters). Switching log base (log10 -> ln) would NOT have fixed this:
  a log base change is just a linear rescale of the same shape, normalized away by
  Chart.js's min/max regardless.
- Fixed: the axis now plots `log(100 - efficiency)` — PENETRATION — reversed so it
  still reads bottom-to-top as increasing efficiency, with ticks fixed at exactly
  0/90/99/99.9% (`EFF_LOG_PENETRATION_TICKS`/`afterBuildTicks` in `chartView.js`, same
  pattern already used for Figure B.1's milestone axis). Each 10x reduction in
  penetration is one decade of log space, so 0-90%, 90-99%, and 99-99.9% now each get
  an EQUAL third of the chart's vertical space — the standard filtration-industry
  semi-log efficiency plot, and exactly the "three even bands" behavior asked for.
- Scale top is fixed at 99.9% (not data-driven) — a reading above 99.9% clips off the
  top, same as any axis clips values past its bounds; a fixed reference means the same
  three bands mean the same thing on every report, not different bands file to file.
  A 100%-efficiency point (penetration = 0) still can't sit on a log axis and is
  dropped, mirroring the previous version's 0%-efficiency drop.
- Cache version: webreportwriter-v32

---

## 2026-07-25 — ISO 4548-12: dual-filter files use per-filter ΔP channels, not TS_DPress
- The dual-filter/MidstreamFlag termination path added earlier assumed the file's ΔP
  channel was shared/single (`TS_DPress`, same as an ordinary single-filter file) — a
  real "Two Pressure" file surfaced this as a hard error ("Required pressure channel
  TS_DPress not found in analog data"). Per the user: `MidstreamFlag` files don't have
  `TS_DPress` at all — they log `TS_PreDPress` (the PRIMARY filter's own ΔP) and
  `TS_FinalDPress` (the SECONDARY filter's own ΔP) instead, confirming termination
  genuinely IS per-filter on these files, not shared as originally assumed.
- Fixed: `resolveDPChannelTag(df, sensor)` picks `TS_DPress` for ordinary files,
  `TS_PreDPress` for the primary filter and `TS_FinalDPress` for the secondary filter on
  `MidstreamFlag` files. Selecting a filter now re-derives termination against that
  filter's own ΔP channel, not one shared channel — changes previously-blocked
  dual-filter files from a hard rejection to actually analyzing.
- Cache version: webreportwriter-v31

---

## 2026-07-25 — ISO 4548-12: accept a missing Test Setup as a valid single-filter file
- `SINGLE_FILTER_SETUPS` now includes `""` alongside "Spin On"/"Pressure"/"Suction".
  Some real files have no `Setup` header key at all (`df.testSetup` defaults to `""`
  when absent) — these predate the field existing, from back when a standard 2-LB-
  sensor multipass test had no other setup variant to distinguish itself from. These
  were previously rejected with "Test Setup '' requires the dual-filter analysis path,
  which is not implemented yet" — wrong, since a missing Setup isn't dual-filter at
  all, there was just nothing yet for the field to express. Same treatment
  `VALID_TEST_TYPES` already gives `""`, for the same reason.
- Cache version: webreportwriter-v30

---

## 2026-07-25 — ISO 4548-12: Table B.2 / Page 1 efficiency table legibility
- Each Table B.2 clump shows 16 sizes as two 8-size blocks (see `appendSizeBlock` in
  `reportView.js`). Added a darker top border (`.b2-block2` in `app.css`) on the second
  block's first row, matching the existing darker-border convention already used to set
  off each clump's meta row — the two blocks now read as visually distinct groups
  instead of one undifferentiated run of 8 rows.
- The particle-size VALUES in both Table B.2 (`.b2-size-row`) and Page 1's Overall
  Filter Efficiency table (`table.eff-table thead td.betarow`) are now bolded
  (font-weight 600) to match their own row's `<th>` label — previously only the label
  ("Particle size") was bold, the sizes themselves were plain. Scoped to size rows only
  — the Upstream/Downstream/Efficiency and Max/Min/Overall data rows are untouched.
- No data/layout changes — CSS (+ one class addition in `reportView.js`) only.
- Cache version: webreportwriter-v29

---

## 2026-07-25 — ISO 4548-12: series/dual-filter (MidstreamFlag) reporting

**New:**
- Files with `MidstreamFlag: True` — a machine reconfigured to bracket TWO filters in
  series (a primary and a secondary), not one — are no longer rejected outright. The
  existing Sensor selector now doubles as a FILTER selector for these files: on an
  ExRaDs LB/LS machine the choices become "Primary Filter (LB)" / "Secondary Filter
  (LS)" (LSU/LSD is a real, independently-measured bracket of the secondary filter in
  this mode, not an alternate view of the primary — verified against a real file); on a
  one-off machine with an extra LB-type sensor (LBE), the choice is "LB (Light
  Blocking)" / "Secondary Filter (LBE)", computing the secondary filter's efficiency as
  `1 - LBE/LBD` (LBD reused as the secondary's own upstream reference, since
  downstream-of-primary and upstream-of-secondary are physically the same tap —
  confirmed byte-for-byte against a real file, where the placeholder row the file
  format reserves for this duplicates LBD exactly).
- Page 1 gains a "Filter Analyzed" field, populated only on `MidstreamFlag` files — a
  printed page carries no toolbar state, so this is how a dual-filter report identifies
  which of the two filters it represents. Blank on an ordinary single-filter report.

**Design notes:**
- One filter's report at a time, same mechanism as the existing LB/LS toggle — not a
  simultaneous two-filter report. Selecting a filter re-analyzes and re-renders using
  the same single-filter templates already in place; no new pages.
- Termination detection is unchanged and NOT filter-aware: the `.DAT` file carries only
  one recorded ΔP channel (one physical transducer across the whole assembly), so the
  same termination row is valid for computing either filter's efficiency — verified via
  the `Data Format` header row in two real sample files (one `TS_Press`/`TS_PreDPress`/
  `TS_FinalDPress` triplet, not a pair).
- Deliberately out of scope, not to be confused with this: `DualFilters: True` with
  `MidstreamFlag: False` (a "series test" mode where LB and LS both redundantly measure
  the *whole* assembly while pressure is monitored per-filter out-of-band) — a
  different, undesigned report shape, still rejected. Also out of scope: newer-software
  `.DAT` files where `TerminalDP`/`CleanHousingDP`/`CleanAssemblyDP`/`BypassDP` carry
  multiple comma-separated values (`-1` = unsupplied) for true per-filter DP targets —
  no real sample of this format exists yet, so it isn't guessed at.
- **LBE math is not yet verified end-to-end.** The only real LBE sample file available
  has `TestType: Data Only`, which is correctly rejected before analysis runs (as it
  always was) — it was useful only for confirming the row layout, not for confirming
  the `1 - LBE/LBD` computation against a real report. Needs a real reportable
  (Single-Pass/Multipass) LBE file to fully verify.

- Cache version: webreportwriter-v27

---

## 2026-07-25 — ISO 4548-12: LS sensor support, display-size picker, and a count-row indexing fix (both standards)

**New:**
- The ISO 4548-12 analysis engine now supports either sensor on a 5-row LBLS file —
  LB (light-blocking) or LS (light-scattering) — not just LB. A Sensor selector
  appears on the Report view whenever a loaded file has more than one usable sensor;
  switching it re-analyzes the already-loaded file, no re-upload needed.
- A "Select display sizes" button (Report view) lets you choose up to 16 of the
  currently-selected sensor's measured sizes to fill Page 1's efficiency table and
  Table B.2. The choice is saved as a persisted default for future reports; a saved
  size a later file doesn't measure falls back to that file's own configured sizes
  for just that one slot.
- Switching the Standard dropdown after a file is already loaded now re-analyzes
  that file for the newly selected standard immediately, instead of leaving the
  report rendering against the previous standard's stale analysis (a documented
  limitation up to this point — "reload the file after switching").

**Fixed — changes previously-displayed ISO 4548-12 numbers:**
- `iso454812Analysis.js`'s per-bucket efficiency calculation read count rows with a
  `[sizeIndex + 1]` offset copied from the analog-row convention, which does not
  apply to count rows (they carry no leading timestamp field — verified against
  real `.DAT` text: an N-size file's count rows are exactly N fields wide). This
  silently computed every size's efficiency from the NEXT size's counts, and always
  read past the end of the row for the LAST size (permanently null, not just
  wrong). Fixed. Every previously-displayed ISO 4548-12 efficiency number — Page 1's
  table, Table B.2, Figures B.2/B.3, and the micrometer rating table — will now show
  different (correct) values.
- The display-size fallback (when no size is picked yet) used the file's header
  "DisplaySizes" list unconditionally, even when the LS sensor was selected —  that
  header is a naming artifact from when LB was the only sensor, so its entries
  aren't guaranteed to be within LS's own measured range. Fixed: the fallback list
  is now built from sizes the SELECTED sensor actually measured, padded from that
  sensor's own full size list where the header's list falls short.
- The identical `[sizeIndex + 1]` count-row indexing bug also existed in
  `iso16889Analysis.js`'s beta ratio calculation (`_computeBetaTable`) — same root
  cause, same fix, applied in the same pass at the user's request despite ISO 16889
  rework otherwise being deferred (see CLAUDE.md). **Changes every previously-
  displayed ISO 16889 beta ratio and dust-holding-capacity number.** Confirmed this
  is the ONLY other place the bug existed: `machineProfile.js` and `dataFile.js`'s
  `getChannel()` also use a `+1` offset, but those correctly index ANALOG rows
  (which do carry a leading timestamp field, unlike count rows) — left untouched.

- The display-size list itself could come out NOT fully ascending: `buildNaturalSizes`
  appended sizes the header's list didn't cover onto the END of the array instead of
  merging them into sorted position, and `resolveFixedSizes`'s per-slot merge
  (preferred size, else the file's natural list) combines two independently-ascending
  lists slot-by-slot, which can interleave them out of order relative to each other
  even though neither list was individually out of order. Confirmed by a real report:
  a 5-row LBLS file's LS sensor showed `4,5,7,9,10,12,15,20,21,22,23,24,25,1.5,1.7,2`
  — 13 sizes from the header's list, then 3 smaller LS-only sizes tacked on after.
  Particle counts are cumulative by size threshold and a sensor's measured sizes are
  hardware-assigned in ascending order, so this wasn't just visually odd — it also
  broke the line connecting points on Figures B.2/B.3 (Chart.js draws a line in
  array order, not sorted by x). Fixed: both functions now always return their
  result sorted ascending. No analysis math changed by this one — display-size list
  ORDERING only.
- The persisted display-size preference itself was scoped only by standard, not by
  sensor — LB and LS shared one saved list, which is what let the previous bug's
  partial-overlap merge happen at all (a preference formed against one sensor's
  measured range silently, partially applying to the other). Fixed:
  `loadPersistedDisplaySizes`/`savePersistedDisplaySizes` (`iso454812DisplaySizesView.js`)
  now take a `sensor` parameter and store under a per-sensor key
  (`__iso454812DisplaySizes__lb` / `__iso454812DisplaySizes__ls`). Switching sensors
  now wholesale swaps to that sensor's own saved preference (or its own natural
  default if none saved yet) — never a merge across sensors. **This orphans any
  preference saved under the old unscoped key** — it isn't migrated; re-save via
  "Select display sizes" for each sensor you use.

- Cache version: webreportwriter-v26

---

## 2026-07-24 — ISO 4548-12 report: Table B.2, figures, and the print pipeline

Page 1 was already working; this brought in the rest of the ISO 4548-12 report —
Table B.2, the three figures, and a real print layout. One consolidated entry for a
run of work spanning cache versions v2–v17 (the intermediate bumps were iteration on
these same features).

**Report infrastructure (also affects ISO 16889):**
- The Report view renders EVERY page of the selected standard in one continuous
  scroll; the per-page "Report page" picker is gone, and printing outputs the whole
  report at once. Each page template's root element is now `class="report-page"` (was
  `id="reportPage"`), since several pages now coexist in the view.
- Loading a file fills the Report view right away, even from the Explorer tab —
  previously the report could stay blank until something re-triggered a render.

**Table B.2 — new, per-bucket filtration efficiency:**
- Upstream/downstream counts and efficiency for the 16 displayed sizes, per 5-minute
  time bucket (10-minute once a test runs past an hour); the first 3 minutes are
  disregarded. Rendered from a repeatable page template stamped out once per 5
  buckets, so a short test is one sheet and a long test is many — each sheet carrying
  its own identification header.
- Bucketing is anchored to a fixed clock grid from test start (…/5/10/15 min), with
  the 3-minute disregard trimming only the first bucket. The first bucket is therefore
  intentionally shorter, and no data row is counted in two buckets.

**Page 1:**
- Overall Filter Efficiency is a fixed 16-size layout (two 8-wide tables whose columns
  now line up), instead of a table whose column count changed file to file.
- Lone fields (e.g. Injection Flowrate Qia) no longer stretch their underline across
  the full page width.

**Figures — new:**
- Figure B.1 (own page): Differential Pressure vs. Time. Left ΔP axis starts at 0; the
  right axis marks the 5/10/15/20/40/80/100 % net-ΔP milestones (the same values as
  Page 1's table), and a top axis reads cumulative contaminant added in grams.
- Figures B.2 & B.3 (shared page): overall efficiency vs. particle size, linear and
  log scale — same data at two scales.

**Print pipeline:**
- Margins 1 in top/bottom, 0.5 in left/right, with print-specific compaction so Page 1
  fits one sheet.
- Every page gets a footer: "Printed: <date>" and "Page X of Y" (CSS paged-media
  margin boxes — renders where the browser implements them; Chrome/Edge do).
- Charts are rebuilt at print time so they size to the printed page, not the screen.

- Cache version: webreportwriter-v17

---

## 2026-07-22 — Project rename: WebReportWriter
- Renamed project-level identity from "ISO 16889 Test Data Explorer"/"ISO 16889 Report
  Tool" to **WebReportWriter**, now that the project covers more than one standard
  (ISO 4548-12 joined ISO 16889) — carrying a single-standard name forward stopped
  making sense. Updated: `index.html`'s `<title>`, `manifest.webmanifest`'s
  `name`/`short_name`/`description`, `README.md`'s title.
- `service-worker.js`'s `CACHE_NAME` prefix changed from `iso16889-explorer-*` to
  `webreportwriter-*`, reset to `webreportwriter-v1`. The old prefix's caches are
  cleaned up automatically (the activate handler already deletes any cache name that
  doesn't match the current one).
- `customDefaults.js`'s localStorage key prefix changed from
  `iso16889-explorer-custom-defaults::` to `webreportwriter-custom-defaults::`. **This
  orphans any custom defaults saved under the old prefix** — they aren't migrated, per
  the decision not to carry proof-of-concept artifacts forward. Re-enter any custom
  defaults you had set (double-click a report field with no file loaded).
- No functional/report-output changes — naming only.
- Cache version: webreportwriter-v1

---

## 2026-07-21 — HoldTime elapsed-time fix
- `dataFile.js`'s elapsed-time offset now uses `countTimeSec + holdTimeSec`, matching
  `iso16889Analysis.js`'s clump-windowing math (which already used both). Previously
  only `countTimeSec` was applied, so files with a nonzero `HoldTime` would have every
  elapsed time (including termination time) off by `holdTimeSec` seconds.
- No effect on either real test file on hand — both report `HoldTime: 0`. Verified with
  a synthetic file (`HoldTime: 15`) that every record shifts by exactly +15s versus the
  same file with `HoldTime: 0`.
- Cache version: iso16889-explorer-v5

*Changelog started 2026-07-21. Earlier project history — the initial `.DAT` parser,
the row-order bug fix, the ISO 16889 analysis engine, the single-file-to-PWA
architecture decision, and the PWA rebuild itself — predates this file and isn't
reconstructed here. That context currently only exists in chat history, which won't
travel with the project; worth keeping that in mind next time a similarly large
chunk of design reasoning happens in conversation rather than in code comments or
here.

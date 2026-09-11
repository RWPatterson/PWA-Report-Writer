/* =====================================================================================
   reportPages.js
   =====================================================================================
   The list of report pages this app can render. reportView.js knows how to fill any
   page given its template URL; this file is just the list. Adding a second page (most
   ISO standards are multi-page) means: write templates/<standard>/<standard>_page2.html,
   add one entry to that standard's own *Pages.js file, done — no changes needed in
   reportView.js, app.js, or index.html beyond the page switcher already wired to
   iterate this list.
   URL NOTE: templateUrl is fetched via fetch(), which resolves relative to the
   DOCUMENT's location (index.html, i.e. the project root) — NOT relative to this
   file's own location the way an `import` specifier would. So these paths should be
   written relative to the project root ("./templates/...", not "../../templates/...").
   Getting this backwards is an easy mistake (import and fetch use different resolution
   rules) and one that stays invisible when testing from a server root, only surfacing
   once deployed under a subpath like GitHub Pages' username.github.io/reponame/.

   standardId: which report STANDARD a page belongs to (not which page) — every page of
   a multi-page report shares one standardId, since they already share one
   ReportValueStore. Used by customDefaults.js to keep persisted custom defaults scoped
   per standard: pages of the same standard share defaults on purpose, but two different
   standards must never see each other's.

   This file is an AGGREGATOR ONLY: every standard defines its own page list in its own
   folder (src/standards/<standard>/<standard>Pages.js) and gets imported and
   concatenated below, so a standard's report structure stays fully contained in that
   standard's own files — removing a standard later means deleting its folder and one
   line here, not hunting through this file's contents.
   ===================================================================================== */
import { ISO16889_PAGES } from "../standards/iso16889/iso16889Pages.js";
import { ISO454812_PAGES } from "../standards/iso454812/iso454812Pages.js";
import { ISO19438_PAGES } from "../standards/iso19438/iso19438Pages.js";
import { ISO3968_PAGES } from "../standards/iso3968/iso3968Pages.js";
import { ISO23369_PAGES } from "../standards/iso23369/iso23369Pages.js";

export const REPORT_PAGES = [...ISO16889_PAGES, ...ISO454812_PAGES, ...ISO19438_PAGES, ...ISO3968_PAGES, ...ISO23369_PAGES];

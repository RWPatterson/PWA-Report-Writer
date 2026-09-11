/* =====================================================================================
   iso16889Pages.js
   =====================================================================================
   This standard's own page list — same shape as reportPages.js's REPORT_PAGES, kept
   separate and imported/concatenated there rather than defined inline, so this
   standard's report structure stays fully contained in its own folder (mirrors
   iso454812Pages.js). 4 registered pages, matching the user's own spec exactly:
   identification/operating-conditions/test-results, the particle-count table
   (page2 — a single static page, one column per display size with Up/Down/ß as
   three stacked rows per clump, rendered landscape via a print-time rotation —
   see iso16889_page2.html), then two figure pages.
   ===================================================================================== */

export const ISO16889_PAGES = [
  { id: "iso16889-page1", standardId: "iso16889", label: "Page 1", templateUrl: "./templates/iso16889/iso16889_page1.html" },
  { id: "iso16889-page2", standardId: "iso16889", label: "Page 2", templateUrl: "./templates/iso16889/iso16889_page2.html" },
  { id: "iso16889-page3", standardId: "iso16889", label: "Page 3", templateUrl: "./templates/iso16889/iso16889_page3.html" },
  { id: "iso16889-page4", standardId: "iso16889", label: "Page 4", templateUrl: "./templates/iso16889/iso16889_page4.html" },
  // Optional "Add Count Details" page — only included when app.js's
  // pagesForCurrentStandard sees the toolbar checkbox's persisted state on (see
  // addCountDetails.js).
  { id: "iso16889-page5", standardId: "iso16889", label: "Add Count Details", templateUrl: "./templates/iso16889/iso16889_page5.html", optional: true }
];

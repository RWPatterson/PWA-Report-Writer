/* =====================================================================================
   iso454812Pages.js
   =====================================================================================
   This standard's own page list — same shape as reportPages.js's REPORT_PAGES, kept
   separate and imported/concatenated there rather than defined inline, so this
   standard's report structure stays fully contained in its own folder.
   ===================================================================================== */

export const ISO454812_PAGES = [
  { id: "iso454812-page1", standardId: "iso454812", label: "Page 1", templateUrl: "./templates/iso454812/iso454812_page1.html" },
  { id: "iso454812-page2", standardId: "iso454812", label: "Table B.2", templateUrl: "./templates/iso454812/iso454812_page2.html" },
  { id: "iso454812-page3", standardId: "iso454812", label: "Figure B.1", templateUrl: "./templates/iso454812/iso454812_page3.html" },
  { id: "iso454812-page4", standardId: "iso454812", label: "Figures B.2-B.3", templateUrl: "./templates/iso454812/iso454812_page4.html" },
  // Figure B.3 shares page 4 with B.2 (same data, two scales) — B.1 stays alone on
  // page 3 for its dual-axis / milestone-label room. iso454812_page5.html was
  // formerly retired; it's now reused for the optional "Add Count Details" page
  // below (`optional: true` — only included when app.js's pagesForCurrentStandard
  // sees the toolbar checkbox's persisted state on, see addCountDetails.js).
  { id: "iso454812-page5", standardId: "iso454812", label: "Add Count Details", templateUrl: "./templates/iso454812/iso454812_page5.html", optional: true }
];

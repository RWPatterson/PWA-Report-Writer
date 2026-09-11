/* =====================================================================================
   iso19438Pages.js
   =====================================================================================
   This standard's own page list — same shape as reportPages.js's REPORT_PAGES, kept
   separate and imported/concatenated there rather than defined inline, so this
   standard's report structure stays fully contained in its own folder.
   ===================================================================================== */

export const ISO19438_PAGES = [
  { id: "iso19438-page1", standardId: "iso19438", label: "Page 1", templateUrl: "./templates/iso19438/iso19438_page1.html" },
  { id: "iso19438-page2", standardId: "iso19438", label: "Presentation of Results", templateUrl: "./templates/iso19438/iso19438_page2.html" },
  { id: "iso19438-page3", standardId: "iso19438", label: "Figure B.2", templateUrl: "./templates/iso19438/iso19438_page3.html" },
  { id: "iso19438-page4", standardId: "iso19438", label: "Figures B.1 & B.3", templateUrl: "./templates/iso19438/iso19438_page4.html" },
  // Figure B.2 (Differential Pressure vs Time) stands alone on page 3 for its dual-
  // axis room, same "DP figure needs the room" logic as iso454812's B.1 — but
  // note the NUMBERING is swapped between the two standards: 19438's DP figure is
  // B.2, not B.1. Figures B.1 + B.3 (both Overall Efficiency vs Particle Size,
  // linear then log) share page 4, same page-grouping logic as iso454812's B.2+B.3.
  // Optional "Add Count Details" page — only included when app.js's
  // pagesForCurrentStandard sees the toolbar checkbox's persisted state on (see
  // addCountDetails.js).
  { id: "iso19438-page5", standardId: "iso19438", label: "Add Count Details", templateUrl: "./templates/iso19438/iso19438_page5.html", optional: true }
];

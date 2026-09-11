/* =====================================================================================
   iso23369Pages.js
   =====================================================================================
   ISO 23369:2022's own page list — own copy of iso16889Pages.js's shape, per
   CLAUDE.md. 4 required pages (matching the standard's own outline exactly: Table
   C.3; particle counts/filtration ratio, mirroring ISO 16889's page 2; Figures
   C.1+C.2; Figures C.3+C.4) plus one optional "Add Count Details" page, matching
   every other clean-build multipass standard's own parity feature.

   templateUrl is fetched relative to the DOCUMENT, not this file — always
   "./templates/...", never a relative-to-this-file import path (see
   reportPages.js's own note).
   ===================================================================================== */
export const ISO23369_PAGES = [
  { id: "iso23369-page1", standardId: "iso23369", label: "Page 1", templateUrl: "./templates/iso23369/iso23369_page1.html" },
  { id: "iso23369-page2", standardId: "iso23369", label: "Page 2", templateUrl: "./templates/iso23369/iso23369_page2.html" },
  { id: "iso23369-page3", standardId: "iso23369", label: "Page 3", templateUrl: "./templates/iso23369/iso23369_page3.html" },
  { id: "iso23369-page4", standardId: "iso23369", label: "Page 4", templateUrl: "./templates/iso23369/iso23369_page4.html" },
  { id: "iso23369-page5", standardId: "iso23369", label: "Add Count Details", templateUrl: "./templates/iso23369/iso23369_page5.html", optional: true }
];

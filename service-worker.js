/* =====================================================================================
   service-worker.js
   =====================================================================================
   Cache-first app shell. Bump CACHE_NAME whenever any precached file changes, so
   returning visitors get the update instead of a stale cache. Only the app shell is
   precached — .DAT files and session .json files are handled entirely in memory / via
   the browser's download mechanism, never sent anywhere, so there's nothing user-data-
   related to cache here.
   ===================================================================================== */

const CACHE_NAME = "webreportwriter-v175";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./icons/icon.svg",
  "./templates/iso16889/iso16889_page1.html",
  "./templates/iso16889/iso16889_page2.html",
  "./templates/iso16889/iso16889_page3.html",
  "./templates/iso16889/iso16889_page4.html",
  "./templates/iso16889/iso16889_page5.html",
  "./templates/iso454812/iso454812_page1.html",
  "./templates/iso454812/iso454812_page2.html",
  "./templates/iso454812/iso454812_page3.html",
  "./templates/iso454812/iso454812_page4.html",
  "./templates/iso454812/iso454812_page5.html",
  "./templates/iso19438/iso19438_page1.html",
  "./templates/iso19438/iso19438_page2.html",
  "./templates/iso19438/iso19438_page3.html",
  "./templates/iso19438/iso19438_page4.html",
  "./templates/iso19438/iso19438_page5.html",
  "./templates/iso3968/iso3968_page1.html",
  "./templates/iso3968/iso3968_page2.html",
  "./templates/iso23369/iso23369_page1.html",
  "./templates/iso23369/iso23369_page2.html",
  "./templates/iso23369/iso23369_page3.html",
  "./templates/iso23369/iso23369_page4.html",
  "./templates/iso23369/iso23369_page5.html",
  "./src/app.js",
  "./src/helpDialogView.js",
  // helpers/ — generic, standard-agnostic utilities
  "./src/helpers/analysisMath.js",
  "./src/helpers/coincidenceLimitCheck.js",
  "./src/helpers/units.js",
  // core/ — shared infrastructure (common substrate, not per-standard procedures)
  "./src/core/dataFile.js",
  "./src/core/cyclicCompanionFile.js",
  "./src/core/controlTargetCheck.js",
  "./src/core/machineProfiles.js",
  "./src/core/machineProfile.js",
  "./src/core/charts/chartData.js",
  "./src/core/charts/chartView.js",
  "./src/core/charts/chartAxisControls.js",
  // standards/ — each self-contained (termination inlined into each Analysis.js)
  "./src/standards/iso16889/iso16889Analysis.js",
  "./src/standards/iso16889/iso16889Mapper.js",
  "./src/standards/iso16889/iso16889Pages.js",
  "./src/standards/iso16889/iso16889ControlTargets.js",
  "./src/standards/iso16889/iso16889DisplaySizesView.js",
  "./src/standards/iso16889/iso16889AuditSteps.js",
  "./src/standards/iso454812/iso454812Analysis.js",
  "./src/standards/iso454812/iso454812Mapper.js",
  "./src/standards/iso454812/iso454812Pages.js",
  "./src/standards/iso454812/iso454812ControlTargets.js",
  "./src/standards/iso454812/iso454812DisplaySizesView.js",
  "./src/standards/iso454812/iso454812AuditSteps.js",
  "./src/standards/iso19438/iso19438Analysis.js",
  "./src/standards/iso19438/iso19438Mapper.js",
  "./src/standards/iso19438/iso19438Pages.js",
  "./src/standards/iso19438/iso19438ControlTargets.js",
  "./src/standards/iso19438/iso19438DisplaySizesView.js",
  "./src/standards/iso19438/iso19438AuditSteps.js",
  "./src/standards/iso3968/iso3968Analysis.js",
  "./src/standards/iso3968/iso3968Mapper.js",
  "./src/standards/iso3968/iso3968Pages.js",
  "./src/standards/iso3968/iso3968ControlTargets.js",
  "./src/standards/iso3968/iso3968AuditSteps.js",
  "./src/standards/iso23369/iso23369Analysis.js",
  "./src/standards/iso23369/iso23369Mapper.js",
  "./src/standards/iso23369/iso23369Pages.js",
  "./src/standards/iso23369/iso23369ControlTargets.js",
  "./src/standards/iso23369/iso23369DisplaySizesView.js",
  "./src/standards/iso23369/iso23369AuditSteps.js",
  // report/ — Report Writer product
  "./src/report/reportView.js",
  "./src/report/reportValueStore.js",
  "./src/report/reportPages.js",
  "./src/report/customDefaults.js",
  "./src/report/companyLogoStore.js",
  "./src/report/addCountDetails.js",
  "./src/report/gravimetricEntryView.js",
  "./src/report/warningsDialogView.js",
  "./src/report/tareEntryView.js",
  "./src/report/companionEntryView.js",
  // explorer/ — Data Explorer product
  "./src/explorer/explorerView.js",
  "./src/explorer/customTabs.js",
  "./src/explorer/customTabsView.js",
  "./src/explorer/explorerAuditSteps.js",
  // compare/ — Compare Files product
  "./src/compare/compareFiles.js",
  "./src/compare/compareView.js",
  "./src/compare/compareTemplates.js",
  "./src/compare/compareTemplateView.js",
  // machineProfiles/ — Machine Profiles product (per-rig custom defaults)
  "./src/machineProfiles/machineProfilesStore.js",
  "./src/machineProfiles/machineProfilesView.js",
  // audit/ — Audit Trail product (hidden, developer-only — see auditView.js's own
  // header comment; still precached like everything else, just never linked in the
  // visible nav)
  "./src/audit/auditView.js",
  "./src/audit/auditSampling.js",
  "./src/audit/auditWidgets.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache same-origin GETs opportunistically so a page visited once works offline.
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

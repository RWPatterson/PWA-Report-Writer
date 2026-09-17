/* =====================================================================================
   machineProfilesView.js
   =====================================================================================
   Renders the Machine Profiles tab: a directory of test rigs, keyed by the .DAT file's
   own SerialNumber, each holding facts about that specific machine (particle counter,
   sensor, optional LS sensor set, optional LBE sensor, test location, counter
   calibration, optional coincidence-limit overrides) that get applied whenever a file
   from that rig loads — the per-rig equivalent of what customDefaults.js already does
   per standard (see app.js's applyMachineProfileFields).

   The coincidence-limit fields (2026-08-19) are consumed DIFFERENTLY from every other
   field here: not by a standard's Mapper (report text), but by its Analysis engine
   directly (see app.js's runAnalysisPipeline building `coincidenceLimits` and passing
   it into standard.run()) — a real, math-affecting input, not a display default. This
   file still just collects the raw numbers; it has no opinion on how they're used.

   Per the user (2026-08-12): the standard rig has its OWN counter and sensor at both
   Upstream and Downstream — two independent locations, not one shared identity — so
   Counter and Sensor each collect an Upstream AND a Downstream Model/Serial pair.
   Older rigs only ever had one counter for both locations, hence "Share counter"
   (default OFF — two independent counters is the normal case). An optional Light
   Scattering (LS) sensor set mirrors the same Upstream/Downstream pattern. An optional
   extended Light Blocking (LBE) sensor is DIFFERENT — a single sensor, not a pair — a
   one-off some rigs carry for series/dual-filter testing's shared midstream sample
   point (the pre-filter's own downstream point IS the final filter's own upstream
   point; see iso16889Mapper.js's buildLocationRef for the full reasoning).

   A persistent tab, not a modal dialog (unlike gravimetricEntryView.js/tareEntryView.js)
   — the add/edit form renders inline into the view, same shelf-then-detail shape
   compareView.js already established for its own product tab. No standard-specific
   knowledge lives here: this file only collects a rig's raw fields and hands them to
   app.js's onSave; turning them into a particular standard's report text (e.g. ISO
   16889's combined "Counter and sensor ref." string, one per location) is that
   standard's own mapper's job (iso16889Mapper.js's buildMachineProfileDefaults), per
   CLAUDE.md.
   ===================================================================================== */

/**
 * @param {HTMLElement} container
 * @param {Record<string, import("./machineProfilesStore.js").MachineProfileRecord>} profiles
 * @param {{onSave:(serialNumber:string, record:*) => void, onDelete:(serialNumber:string) => void, currentSerialNumber:string|null}} callbacks
 */
export function renderMachineProfilesView(container, profiles, { onSave, onDelete, currentSerialNumber }) {
  container.innerHTML = "";

  const entries = Object.entries(profiles).sort(([a], [b]) => a.localeCompare(b));
  const formMount = el("div", { class: "mp-form-mount" });

  container.append(
    el("p", { class: "hint" },
      "Per-rig defaults, keyed by the .DAT file's own Serial Number. Counter details will propagate to the ",
      "ISO 16889 and ISO 23369 report formats, while sensor limits will apply to all standards that process ",
      "particle counter data."),
    el("button", { class: "act primary", onclick: () => showForm(null) }, "+ Add profile"),
    entries.length
      ? buildTable(entries)
      : el("div", { class: "hint-box" }, "No machine profiles yet. Add one to save a rig's counter/sensor identity, calibration info, and test location."),
    formMount
  );

  // Wrapped in a scrolling container, same "wide table gets its own overflow-x:auto
  // wrapper" pattern already established for the audit trail's tables
  // (auditView.js's .audit-table-wrap) and ISO 16889/23369's page-2 rotated tables
  // — a rig with a full Counter/Sensor/LS/LBE summary plus Cal Method/Date can run
  // wider than the content column; scroll rather than silently clip.
  function buildTable(rows) {
    return el("div", { class: "mp-table-wrap" },
      el("table", { class: "datatbl mp-list" },
        el("thead", {}, el("tr", {},
          el("th", {}, "Serial Number"), el("th", {}, "Label"), el("th", {}, "Test Location"),
          el("th", {}, "Counter / Sensor"), el("th", {}, "Cal Method / Date"), el("th", {}, ""))),
        el("tbody", {}, ...rows.map(([serial, p]) => el("tr", {},
          el("td", {}, serial),
          el("td", {}, p.label || ""),
          el("td", {}, p.testLocation || ""),
          el("td", {}, summarize(p)),
          el("td", {}, [p.counterCalMethod, p.counterCalDate].filter(Boolean).join(" / ")),
          el("td", { class: "mp-actions" },
            el("button", { class: "act", onclick: () => showForm(serial) }, "Edit"),
            el("button", { class: "act", onclick: () => onDelete(serial) }, "Delete"))
        )))
      )
    );
  }

  /* List-table summary column — its own compact wording, independent of ISO 16889's
     own "Counter: X / Sensor: Y" report string (that combination is report CONTENT,
     built in iso16889Mapper.js, never here — see CLAUDE.md). */
  function summarize(p) {
    const bits = [];
    if (p.counterUpstreamModel || p.counterUpstreamSerial) {
      bits.push("Counter: " + [p.counterUpstreamModel, p.counterUpstreamSerial].filter(Boolean).join(" ") + (p.shareCounter ? " (shared)" : ""));
    }
    if (p.sensorUpstreamModel || p.sensorDownstreamModel) {
      bits.push("Sensor: " + [p.sensorUpstreamModel, p.sensorDownstreamModel].filter(Boolean).join(" / "));
    }
    if (p.hasLSSensor) bits.push("+LS");
    if (p.hasLBESensor) bits.push("+LBE");
    return bits.join(" · ");
  }

  function showForm(editingSerial) {
    formMount.innerHTML = "";
    formMount.appendChild(buildForm(editingSerial));
    formMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function buildForm(editingSerial) {
    const existing = editingSerial ? profiles[editingSerial] : null;

    // Prefilled from whichever file is currently loaded (if any) on a NEW profile —
    // the serial must match the .DAT header's SerialNumber exactly (lookupProfile
    // does a plain key lookup), so starting from the real value avoids typos.
    const serialInput = el("input", { type: "text", placeholder: "e.g. 2019-011" });
    serialInput.value = editingSerial || currentSerialNumber || "";
    if (editingSerial) serialInput.disabled = true;   // the map key — delete + re-add to rename

    const labelInput = textInput(existing, "label", "e.g. Triple Loop Multipass");

    // ---- Particle Counter: Upstream + Downstream, with a "share" toggle for older
    // rigs that only ever had one counter serving both locations. ----
    const counterPair = buildLocationPair(existing, "counter", "e.g. Pamas 4132");
    const shareCounterToggle = el("input", { type: "checkbox" });
    shareCounterToggle.checked = !!(existing && existing.shareCounter);
    function syncShareCounter() { counterPair.downstreamCol.style.display = shareCounterToggle.checked ? "none" : ""; }
    shareCounterToggle.addEventListener("change", syncShareCounter);
    syncShareCounter();

    // ---- Sensor: always Upstream + Downstream, no share toggle — the standard case ----
    const sensorPair = buildLocationPair(existing, "sensor", "e.g. HCB-25/25");

    // ---- Optional Light Scattering sensor set — mirrors the same Upstream/Downstream
    // pattern as the primary sensor above ----
    const lsToggle = el("input", { type: "checkbox" });
    lsToggle.checked = !!(existing && existing.hasLSSensor);
    const lsPair = buildLocationPair(existing, "lsSensor", "e.g. HCB-25/25");
    const lsBlock = el("div", { class: "mp-toggle-block", style: lsToggle.checked ? "" : "display:none" }, lsPair.element);
    lsToggle.addEventListener("change", () => { lsBlock.style.display = lsToggle.checked ? "" : "none"; });

    // ---- Optional extended Light Blocking (LBE) sensor — a one-off some rigs also
    // carry. Unlike LS above, this is a SINGLE sensor, not an Upstream/Downstream
    // pair: in series/dual-filter testing the pre-filter's downstream sample point
    // IS the final filter's upstream sample point (one shared midstream draw), so an
    // LBE rig has exactly one extra physical sensor reading it — per the user,
    // 2026-08-12. ----
    const lbeToggle = el("input", { type: "checkbox" });
    lbeToggle.checked = !!(existing && existing.hasLBESensor);
    const lbeModelInput = textInput(existing, "lbeSensorModel", "e.g. HCB-25/25");
    const lbeSerialInput = textInput(existing, "lbeSensorSerial", "Serial number");
    const lbeBlock = el("div", { class: "mp-toggle-block", style: lbeToggle.checked ? "" : "display:none" },
      el("label", { class: "field-label" }, "LBE Sensor Model"), lbeModelInput,
      el("label", { class: "field-label" }, "LBE Sensor Serial"), lbeSerialInput);
    lbeToggle.addEventListener("change", () => { lbeBlock.style.display = lbeToggle.checked ? "" : "none"; });

    // ---- Optional coincidence-limit overrides — leave blank to use the
    // conservative manufacturer default (see helpers/coincidenceLimitCheck.js); set
    // once the REAL limit has been empirically found for a specific sensor. Same
    // per-physical-slot granularity as Model/Serial above — LBE gets one value (a
    // single sensor, no Upstream/Downstream split), everything else gets its own pair. ----
    const sensorUpstreamLimitInput = numberInput(existing, "sensorUpstreamCoincidenceLimit", "e.g. 30000 (Pamas default)");
    const sensorDownstreamLimitInput = numberInput(existing, "sensorDownstreamCoincidenceLimit", "e.g. 30000 (Pamas default)");
    const lsUpstreamLimitInput = numberInput(existing, "lsSensorUpstreamCoincidenceLimit", "e.g. 12000 (Pamas default)");
    const lsDownstreamLimitInput = numberInput(existing, "lsSensorDownstreamCoincidenceLimit", "e.g. 12000 (Pamas default)");
    const lbeLimitInput = numberInput(existing, "lbeSensorCoincidenceLimit", "e.g. 30000 (Pamas default)");

    const lsLimitBlock = el("div", { class: "mp-toggle-block", style: lsToggle.checked ? "" : "display:none" },
      el("div", { class: "mp-pair" },
        el("div", {}, el("label", { class: "field-label" }, "LS Upstream Limit (counts/mL)"), lsUpstreamLimitInput),
        el("div", {}, el("label", { class: "field-label" }, "LS Downstream Limit (counts/mL)"), lsDownstreamLimitInput)));
    lsToggle.addEventListener("change", () => { lsLimitBlock.style.display = lsToggle.checked ? "" : "none"; });

    const lbeLimitBlock = el("div", { class: "mp-toggle-block", style: lbeToggle.checked ? "" : "display:none" },
      el("label", { class: "field-label" }, "LBE Limit (counts/mL)"), lbeLimitInput);
    lbeToggle.addEventListener("change", () => { lbeLimitBlock.style.display = lbeToggle.checked ? "" : "none"; });

    const testLocationInput = textInput(existing, "testLocation", "e.g. Triple Loop Multipass");
    const counterCalMethodInput = textInput(existing, "counterCalMethod", "e.g. NIST-traceable latex spheres");
    const counterCalDateInput = textInput(existing, "counterCalDate", "e.g. 2026-06-01");

    function save() {
      const serial = editingSerial || serialInput.value.trim();
      if (!serial) return;
      onSave(serial, {
        label: labelInput.value.trim(),
        shareCounter: shareCounterToggle.checked,
        ...counterPair.values(),
        ...sensorPair.values(),
        hasLSSensor: lsToggle.checked,
        ...lsPair.values(),
        hasLBESensor: lbeToggle.checked,
        lbeSensorModel: lbeModelInput.value.trim(), lbeSensorSerial: lbeSerialInput.value.trim(),
        sensorUpstreamCoincidenceLimit: toOptionalNumber(sensorUpstreamLimitInput),
        sensorDownstreamCoincidenceLimit: toOptionalNumber(sensorDownstreamLimitInput),
        lsSensorUpstreamCoincidenceLimit: toOptionalNumber(lsUpstreamLimitInput),
        lsSensorDownstreamCoincidenceLimit: toOptionalNumber(lsDownstreamLimitInput),
        lbeSensorCoincidenceLimit: toOptionalNumber(lbeLimitInput),
        testLocation: testLocationInput.value.trim(),
        counterCalMethod: counterCalMethodInput.value.trim(), counterCalDate: counterCalDateInput.value.trim()
      });
      formMount.innerHTML = "";
    }

    return el("div", { class: "mp-form" },
      el("h3", {}, editingSerial ? "Edit profile — " + editingSerial : "Add machine profile"),
      el("label", { class: "field-label" }, "Serial Number (matches the .DAT file's Serial Number exactly)"), serialInput,
      el("label", { class: "field-label" }, "Label"), labelInput,

      el("h4", { class: "mp-subhead" }, "Particle Counter"),
      el("label", { class: "mp-toggle" }, shareCounterToggle, " Same counter serves both Upstream and Downstream (older rigs)"),
      counterPair.element,

      el("h4", { class: "mp-subhead" }, "Sensor"),
      sensorPair.element,

      el("label", { class: "mp-toggle" }, lsToggle, " Add Light Scattering (LS) sensor set"),
      lsBlock,
      el("label", { class: "mp-toggle" }, lbeToggle, " Add extended Light Blocking (LBE) sensor — single sensor used for series testing"),
      lbeBlock,

      el("h4", { class: "mp-subhead" }, "Coincidence Limit (optional)"),
      el("p", { class: "hint" }, "Leave blank to use the conservative default (30,000 counts/mL for LB/LBE, 12,000 for LS). Only set this once the real limit has been empirically found for this specific sensor."),
      el("div", { class: "mp-pair" },
        el("div", {}, el("label", { class: "field-label" }, "Sensor Upstream Limit (counts/mL)"), sensorUpstreamLimitInput),
        el("div", {}, el("label", { class: "field-label" }, "Sensor Downstream Limit (counts/mL)"), sensorDownstreamLimitInput)),
      lsLimitBlock,
      lbeLimitBlock,

      el("label", { class: "field-label" }, "Test Location"), testLocationInput,
      el("label", { class: "field-label" }, "Counter Calibration Method"), counterCalMethodInput,
      el("label", { class: "field-label" }, "Counter Calibration Date"), counterCalDateInput,
      el("div", { class: "modal-actions" },
        el("button", { class: "act", onclick: () => { formMount.innerHTML = ""; } }, "Cancel"),
        el("button", { class: "act primary", onclick: save }, "Save"))
    );
  }

  /* One Upstream/Downstream Model+Serial pair — shared shape for Counter, Sensor, and
     LS Sensor (NOT LBE Sensor, which is deliberately a single field — see its own
     comment above), since these three collect the exact same four fields under a
     "<prefix>UpstreamModel"/"<prefix>UpstreamSerial"/"<prefix>DownstreamModel"/
     "<prefix>DownstreamSerial" key scheme (read back by iso16889Mapper.js's
     buildMachineProfileDefaults the same way). downstreamCol is exposed separately so
     the Counter section can hide it when "share counter" is checked. */
  function buildLocationPair(existing, prefix, modelPlaceholder) {
    const upModel = textInput(existing, prefix + "UpstreamModel", modelPlaceholder);
    const upSerial = textInput(existing, prefix + "UpstreamSerial", "Serial number");
    const downModel = textInput(existing, prefix + "DownstreamModel", modelPlaceholder);
    const downSerial = textInput(existing, prefix + "DownstreamSerial", "Serial number");
    const downstreamCol = el("div", {},
      el("label", { class: "field-label" }, "Downstream Model"), downModel,
      el("label", { class: "field-label" }, "Downstream Serial"), downSerial);
    const element = el("div", { class: "mp-pair" },
      el("div", {},
        el("label", { class: "field-label" }, "Upstream Model"), upModel,
        el("label", { class: "field-label" }, "Upstream Serial"), upSerial),
      downstreamCol);
    return {
      element, downstreamCol,
      values: () => ({
        [prefix + "UpstreamModel"]: upModel.value.trim(), [prefix + "UpstreamSerial"]: upSerial.value.trim(),
        [prefix + "DownstreamModel"]: downModel.value.trim(), [prefix + "DownstreamSerial"]: downSerial.value.trim()
      })
    };
  }

  function textInput(existing, field, placeholder) {
    const input = el("input", { type: "text", placeholder });
    if (existing && existing[field]) input.value = existing[field];
    return input;
  }

  /** Same as textInput, but type="number" and reads back as a number, not a string
   *  — used only by the coincidence-limit override fields (real math inputs, unlike
   *  Model/Serial/etc., which stay free text everywhere else in this form). */
  function numberInput(existing, field, placeholder) {
    const input = el("input", { type: "number", placeholder });
    if (existing && existing[field] !== undefined && existing[field] !== null) input.value = String(existing[field]);
    return input;
  }

  /** @param {HTMLInputElement} input @returns {number|undefined} undefined (not
   *  saved at all) when left blank or non-numeric — "not overridden," so the
   *  conservative default applies. */
  function toOptionalNumber(input) {
    const trimmed = input.value.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return isFinite(n) ? n : undefined;
  }
}

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

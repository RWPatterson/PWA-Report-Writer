/* =====================================================================================
   chartData.js
   =====================================================================================
   Pure data shaping — no Chart.js, no canvas, no DOM. Takes a DataFile (and for the DP
   chart, nothing else — it reads TS_DPress directly, so it works even before/without a
   successful Iso16889Analysis run) and returns {datasets}, each series a {x, y} point
   array (see ChartPoint below) — the shape Chart.js wants. chartView.js is the only
   file that knows what a chart looks like; this file only knows what the numbers are.
   ===================================================================================== */

/**
 * @typedef {Object} ChartPoint
 * @property {number} x elapsed minutes
 * @property {number} y
 *
 * @typedef {Object} ChartSeries
 * @property {string} label
 * @property {ChartPoint[]} data
 *
 * @typedef {Object} ChartDataset
 * @property {ChartSeries[]} datasets
 * @property {string} [yAxisLabel]
 * @property {string} title
 * @property {string[]} [missing] channels/sizes requested but not present in a file
 */

//#region single-file datasets
/** @type {Record<string,{rows:string,sizes:string,label:string}>} sensor key -> DataFile row/size property names */
const SENSOR_SPECS = {
  lbu: { rows: "lbu", sizes: "lbSizes", label: "LB Up Counts" },
  lbd: { rows: "lbd", sizes: "lbSizes", label: "LB Down Counts" },
  lsu: { rows: "lsu", sizes: "lsSizes", label: "LS Up Counts" },
  lsd: { rows: "lsd", sizes: "lsSizes", label: "LS Down Counts" },
  lbe: { rows: "lbe", sizes: "lbeSizes", label: "LBE Counts" }
};

/** @param {DataFile} df @returns {Array<{key:string,label:string}>} sensors this file actually has data for */
export function availableSensors(df) {
  return Object.entries(SENSOR_SPECS)
    .filter(([, spec]) => df[spec.rows] && df[spec.rows].length > 0)
    .map(([key, spec]) => ({ key, label: spec.label }));
}

/* buildCountsDataset: one line per particle size, all overlaid on a shared time axis.
   Up to 32+ series — chartView.js is responsible for making that legible (color
   cycling, legend toggling), this function just produces the raw series. Each series
   is a {x: minutes, y: value} point array (see the "internal helpers" toPoints below)
   so chartView.js can draw a genuine linear time axis — needed so a user-entered X-axis
   min/max (see chartAxisControls.js) means what it says, rather than a category-scale
   label position. */
/** @param {DataFile} df @param {string} sensorKey @returns {ChartDataset|null} */
export function buildCountsDataset(df, sensorKey) {
  const spec = SENSOR_SPECS[sensorKey];
  if (!spec) return null;
  const rows = df[spec.rows];
  const sizes = df[spec.sizes];
  if (!rows || rows.length === 0) return null;

  const datasets = sizes.map((size, sizeIndex) => {
    const values = rows.map(row => {
      const n = parseFloat(row[sizeIndex]);   // count rows have NO timestamp field, unlike analog rows —
                                               // verified: a 32-size file's count rows are exactly 32 fields wide
      return isFinite(n) ? n : null;
    });
    return { label: size + " µm", data: toPoints(df.times, values) };
  });

  return { datasets, yAxisLabel: "Particle count", title: spec.label + " vs. Time" };
}

/* buildChannelDataset: a single named analog channel vs. time — e.g. TS_DPress. Works
   directly off the parsed file, independent of Iso16889Analysis, so it's available even
   for files that fail ISO 16889 validation (P-Q files, non-terminating tests, etc.) —
   matches the "Explorer used as a QC review tool" use case, not just the report path. */
/** @param {DataFile} df @param {string} channelTag @param {string} [seriesLabel] @returns {ChartDataset|null} */
export function buildChannelDataset(df, channelTag, seriesLabel) {
  const values = df.getChannel(channelTag);
  if (!values) return null;
  return {
    datasets: [{ label: seriesLabel || channelTag, data: toPoints(df.times, values) }],
    yAxisLabel: seriesLabel || channelTag,
    title: (seriesLabel || channelTag) + " vs. Time"
  };
}

/* availableChannels: the analog channel names this file actually has, for a channel
   picker UI. Just df.analogTags, wrapped so callers don't need to know DataFile's
   internal property name. */
/** @param {DataFile} df @returns {string[]} */
/* df.analogTags is a DataFile's own channel-name array; a CyclicCompanionFile calls
   the identical concept df.tags instead (see core/cyclicCompanionFile.js — its own
   getChannel() is otherwise byte-identical in shape to DataFile's). Reading
   analogTags unguarded here used to throw the instant a custom plot tab was opened
   against a loaded companion file. */
export function availableChannels(df) {
  return (df.analogTags || df.tags).slice();
}

/* channelHasData: a tag can be DECLARED in a file's own Data Format header (so it's
   in df.analogTags) while every row is genuinely too short to carry a value for it —
   confirmed against a real file (ROTest9): its Data Format lists 21 tags, but every
   analog row only has 13 values, so the trailing 8 tags (TS_Cond_Temp onward) parse
   to null at every single row, not just a few missing samples. getChannel() already
   returns null for those rows (out-of-range index -> parseFloat(undefined) -> NaN ->
   null), so "declared but empty" is exactly "every value in the returned array is
   null" — no separate row-width check needed here. */
/** @param {DataFile} df @param {string} tag @returns {boolean} true if at least one row has a real value for this channel */
export function channelHasData(df, tag) {
  const values = df.getChannel(tag);
  return !!values && values.some(v => v !== null);
}

/* buildMultiChannelDataset: overlay any number of named analog channels on one time
   axis — the general case a custom plot tab needs (e.g. TS_Temp + DS_Temp + INJ_Temp
   together). Channels the current file doesn't have are skipped, not fatal — reported
   back in `missing` so the caller can show a clear note instead of a silent gap or a
   crash. This is what makes a saved custom tab safe to reuse across files that don't
   all have identical channel sets. */
/** @param {DataFile} df @param {string[]} channelTags @param {Record<string,string>} [labelOverrides] @returns {ChartDataset} */
export function buildMultiChannelDataset(df, channelTags, labelOverrides = {}) {
  const datasets = [];
  const missing = [];

  for (const tag of channelTags) {
    const values = df.getChannel(tag);
    if (!values) { missing.push(tag); continue; }
    datasets.push({ label: labelOverrides[tag] || tag, data: toPoints(df.times, values) });
  }

  return {
    datasets,
    missing,
    yAxisLabel: "Value",
    title: channelTags.join(" / ") + " vs. Time"
  };
}

/* buildInjectedMassVsDPDataset: NOT YET AVAILABLE. Iso16889Analysis v1 does not compute
   the injection mass balance (needs GD_InjInitial/Final, IS_Rate, etc. — see the note
   in reportMapper.js). Kept here, returning null, so chartView.js has one clear place
   to check "is this ready yet" rather than the option silently not existing. */
/** @returns {null} */
export function buildInjectedMassVsDPDataset() {
  return null;
}
//#endregion

//#region cross-file comparison
/* Different case from everything above: those functions all plot several series from
   ONE file, which share exactly one elapsed-time array. Comparing across files can't
   assume that — different test durations, different record counts, and (rarely,
   see machineProfile.js) different CountTime intervals mean each file's elapsed time
   has to be carried as its own independent {x, y} points (same ChartPoint shape the
   single-file builders above already use — both go through the same toPoints helper
   below), not indexed against a single shared array. renderComparisonChart in
   chartView.js is the counterpart that draws this. */

/**
 * @typedef {Object} ComparisonPoint
 * @property {number} x elapsed minutes
 * @property {number} y
 *
 * @typedef {Object} ComparisonDataset
 * @property {Array<{label:string,data:ComparisonPoint[]}>} datasets
 * @property {string[]} missing
 * @property {string} xAxisLabel
 * @property {string} yAxisLabel
 * @property {string} title
 */

/** @type {Record<string,{rows:string,sizes:string,label:string}>} */
const COMPARISON_SENSOR_SPECS = {
  lbu: { rows: "lbu", sizes: "lbSizes", label: "LB Up Counts" },
  lbd: { rows: "lbd", sizes: "lbSizes", label: "LB Down Counts" },
  lsu: { rows: "lsu", sizes: "lsSizes", label: "LS Up Counts" },
  lsd: { rows: "lsd", sizes: "lsSizes", label: "LS Down Counts" }
};

/** @returns {Array<{key:string,label:string}>} */
export function comparisonSensorOptions() {
  return Object.entries(COMPARISON_SENSOR_SPECS).map(([key, spec]) => ({ key, label: spec.label }));
}

/* buildComparisonChannelDataset: one series per loaded file, same named analog
   channel, each file's own elapsed time as its x values. A file missing the channel
   is named in `missing`, not fatal — the rest still plot. A tag DECLARED in a file
   but never actually populated (see channelHasData) counts as missing here too —
   otherwise a saved template's plot, replayed against a file where the tag turns
   out empty, would silently render a blank line with no explanation instead of
   being named. */
/** @param {Array<{df:DataFile,label:string}>} files @param {string} channelTag @returns {ComparisonDataset} */
export function buildComparisonChannelDataset(files, channelTag) {
  const datasets = [];
  const missing = [];

  for (const entry of files) {
    const values = entry.df.getChannel(channelTag);
    if (!values || !values.some(v => v !== null)) { missing.push(entry.label); continue; }
    datasets.push({ label: entry.label, data: toPoints(entry.df.times, values) });
  }

  return {
    datasets, missing,
    xAxisLabel: "Elapsed time (min)",
    yAxisLabel: channelTag,
    title: channelTag + " — file comparison"
  };
}

/* buildComparisonSizeDataset: for each loaded file, for each requested particle size,
   one series — so N files x up to 3 sizes. A size is looked up by its declared value
   in EACH file's own size list (not by column position), since files can list sizes
   in a different order, or not carry a given size at all. Count rows carry NO leading
   timestamp field (verified against a real file: a 32-size file's count rows are
   exactly 32 fields wide) — unlike analog rows, so no +1 offset here. */
/** @param {Array<{df:DataFile,label:string}>} files @param {string} sensorKey @param {string[]} sizes @returns {ComparisonDataset} */
export function buildComparisonSizeDataset(files, sensorKey, sizes) {
  const spec = COMPARISON_SENSOR_SPECS[sensorKey];
  const datasets = [];
  const missing = [];
  if (!spec) return { datasets, missing, xAxisLabel: "Elapsed time (min)", yAxisLabel: "Count", title: "" };

  for (const entry of files) {
    const df = entry.df;
    const rows = df[spec.rows];
    const fileSizes = df[spec.sizes];

    if (!rows || rows.length === 0) {
      missing.push(entry.label + " (no " + spec.label + " data)");
      continue;
    }

    for (const size of sizes) {
      const sizeIndex = fileSizes.indexOf(size);
      if (sizeIndex < 0) {
        missing.push(entry.label + " / " + size + " µm");
        continue;
      }
      const values = rows.map(row => {
        const n = parseFloat(row[sizeIndex]);
        return isFinite(n) ? n : null;
      });
      datasets.push({ label: entry.label + " / " + size + " µm", data: toPoints(df.times, values) });
    }
  }

  return {
    datasets, missing,
    xAxisLabel: "Elapsed time (min)",
    yAxisLabel: "Particle count",
    title: spec.label + " — file comparison"
  };
}

/* buildComparisonStandardCurveDataset: one series per loaded file, each file's own
   standard-analysis curve (e.g. ISO 16889's beta-vs-size, ISO 4548-12/19438's
   efficiency-vs-size, or any other curve app.js's STANDARD_CURVES registry knows how
   to resolve — DP vs. time, DP vs. mass, a P-Q sweep, one particle size's β vs. %
   test time, etc.) ALREADY RESOLVED by the caller — this function has no idea what a
   "standard" is, matching this file's own rule (see the file-top note: this file
   only knows what the numbers are), and no idea what the x-axis actually represents
   either — despite the {sizes, values} field names (kept as-is; they're just the
   original, still-accurate names for the FIRST curve shape this served) x can be a
   particle size, a time, a pressure, a mass, or a flow rate, entirely up to the
   caller-supplied xAxisLabel. app.js runs each file's own standard's
   run()/applyMapper() (per CLAUDE.md, that logic is never re-derived here) and hands
   back a plain {sizes, values} curve, or null for a file that failed that standard's
   validation; this just shapes those into the same ComparisonDataset shape every
   other comparison chart already uses, so it draws through the existing
   renderComparisonChart with no new chart-view code. */
/**
 * @param {Array<{label:string, curve:{sizes:Array<string|number>, values:Array<number|null>}|null}>} perFileCurves
 * @param {string} curveLabel e.g. "Overall Average Filtration Ratio (β) vs. Size"
 * @param {string} yAxisLabel
 * @param {string} [xAxisLabel] defaults to the original "Particle size (µm)" — every
 *   pre-existing caller (beta/efficiency vs. size) keeps its exact prior behavior
 *   without passing this
 * @returns {ComparisonDataset}
 */
export function buildComparisonStandardCurveDataset(perFileCurves, curveLabel, yAxisLabel, xAxisLabel) {
  const datasets = [];
  const missing = [];

  for (const entry of perFileCurves) {
    if (!entry.curve || !entry.curve.sizes || entry.curve.sizes.length === 0) {
      missing.push(entry.label);
      continue;
    }
    const points = entry.curve.sizes
      .map((size, i) => ({ x: Number(size), y: entry.curve.values[i] }))
      .filter(p => isFinite(p.x) && p.y !== null && p.y !== undefined && isFinite(p.y))
      .sort((a, b) => a.x - b.x);
    if (points.length === 0) { missing.push(entry.label); continue; }
    datasets.push({ label: entry.label, data: points });
  }

  return {
    datasets, missing,
    xAxisLabel: xAxisLabel || "Particle size (µm)",
    yAxisLabel,
    title: curveLabel + " — file comparison"
  };
}

/* Mass added — a DERIVED time series, not a logged channel, so it has no entry in
   df.analogTags. Surfaced in the comparison UI as a synthetic "channel" (see
   compareTemplateView.js) rather than a new PlotSpec kind, since {kind:"channel",
   channelTag} already round-trips through templates/save-load with no changes
   needed — MASS_ADDED_CHANNEL_TAG just never collides with a real tag (every real
   one follows dataFile.js's <Prefix>_<Name> convention; this one starts with "__"
   and has no underscore-separated prefix). All three multipass standards
   (iso16889/iso454812/iso19438Analysis.js) compute their own scalar injected-mass
   total from the identical inputs read here — same header key, same channel, same
   mg/L x mL/min x min -> g conversion — confirming this is a generic, standard-
   agnostic HELPER per CLAUDE.md, not a duplicated per-standard procedure.
   NOT gated by standard/test-type, deliberately: a real P-Q (ISO 3968) fixture
   was checked by hand and turns out to log a live, non-zero INJ_Rate channel and
   a GravimetricLevel header anyway (the rig logs both unconditionally, regardless
   of which standard's test is running — confirmed, not assumed; an earlier version
   of this comment claimed ISO 3968 was excluded "for free" by data absence, which
   this check disproved). There is no reliable data-only signal for "was
   contaminant genuinely being monitored as part of THIS test," and Compare Files
   has no standard-id to check against in the first place (see compareFiles.js's
   own file-top note) — nor does it gate ANY other channel by test-type today, so a
   one-off heuristic here would be an inconsistent special case, not a fix. If a
   loaded file has both ingredients, Mass Added is offered, same as any other
   channel; the user judges relevance the same way they already do for every other
   raw channel in this tool. */
const HEADER_GRAVIMETRIC = { section: "Injection System Configuration", key: "GravimetricLevel" };
const INJ_RATE_TAG = "INJ_Rate";
export const MASS_ADDED_CHANNEL_TAG = "__massAdded";
export const MASS_ADDED_LABEL = "Mass Added (calc.)";

/** @param {DataFile} df @returns {boolean} */
export function hasMassAddedData(df) {
  const gia = parseFloat(df.getHeaderValue(HEADER_GRAVIMETRIC.section, HEADER_GRAVIMETRIC.key));
  // channelHasData, not a bare analogTags check — a declared-but-empty INJ_Rate tag
  // (see channelHasData's own note) shouldn't offer a flat/meaningless mass curve
  // any more than it should offer itself as a plain channel option.
  return isFinite(gia) && channelHasData(df, INJ_RATE_TAG);
}

/* computeMassAddedSeries: cumulative injected dust mass (g) at each row — a running
   trapezoidal integral of the real INJ_Rate channel (mL/min) against the file's own
   elapsed time (df.times, seconds), times the header's GravimetricLevel (mg/L).
   Same mg/L x mL/min x min -> g conversion every standard's own scalar
   injectedMass/dustInjected figure already uses (Gia x Qia x time / 1,000,000 —
   /1000 mL->L, /1000 mg->g), just integrated point-by-point instead of
   averaged-then-multiplied-by-total-time, so the curve reflects real injection-pump
   behavior (ramp-up, pauses) instead of a straight line — at a constant rate the two
   are identical by construction.
   Uses the header GravimetricLevel, not a hand-entered lab-measured initial/final
   average — Compare Files only ever has the parsed DataFile (see compareFiles.js's
   own file-top note: no ReportValueStore here), so that's the only Gia this
   engine-independent context can read. This matches iso454812/iso19438's own gia
   field exactly (same header read, no hand-entry fallback needed there); for ISO
   16889 files, that standard's OWN report figure prefers a hand-entered
   initial/final gravimetric average when the user has run the gravimetric dialog —
   not reachable here by construction, so this curve's total can differ slightly
   from that standard's Page 1 Mass Injected total for the same file.
   A gap in INJ_Rate (null sample) is bridged by carrying the cumulative total
   forward with no added volume for that gap, rather than guessing a rate — ponytail:
   under-integrating across a real gap in a badly-logged file is the known ceiling
   here, not corrected further absent a reason to. */
/** @param {DataFile} df @returns {number[]|null} grams, one per row, or null if this file has neither ingredient */
export function computeMassAddedSeries(df) {
  const gia = parseFloat(df.getHeaderValue(HEADER_GRAVIMETRIC.section, HEADER_GRAVIMETRIC.key));
  const rate = df.getChannel(INJ_RATE_TAG);
  // A declared-but-never-populated tag (see channelHasData) parses to an array of
  // ALL nulls, not a null array itself — checked here too, not just in
  // hasMassAddedData's gate, so a caller that reaches this directly (e.g. a saved
  // template's plot, resolved against a newly loaded file set) gets a proper
  // "missing" instead of a silently empty curve.
  if (!isFinite(gia) || !rate || !rate.some(v => v !== null)) return null;

  const times = df.times;
  const massG = new Array(rate.length).fill(null);
  let cumulativeVolMl = 0;
  let prevIndex = -1;
  for (let i = 0; i < rate.length; i++) {
    if (times[i] === null || rate[i] === null) continue;
    if (prevIndex >= 0) {
      const dtMin = (times[i] - times[prevIndex]) / 60;
      const avgRateMlPerMin = (rate[prevIndex] + rate[i]) / 2;
      cumulativeVolMl += avgRateMlPerMin * dtMin;
    }
    massG[i] = (gia * cumulativeVolMl) / 1000000;
    prevIndex = i;
  }
  return massG;
}

/** @param {Array<{df:DataFile,label:string}>} files @returns {ComparisonDataset} */
export function buildComparisonMassDataset(files) {
  const datasets = [];
  const missing = [];

  for (const entry of files) {
    const massG = computeMassAddedSeries(entry.df);
    if (!massG) { missing.push(entry.label); continue; }
    datasets.push({ label: entry.label, data: toPoints(entry.df.times, massG) });
  }

  return {
    datasets, missing,
    xAxisLabel: "Elapsed time (min)",
    yAxisLabel: "Mass added (g)",
    title: MASS_ADDED_LABEL + " — file comparison"
  };
}
//#endregion

//#region internal helpers
/* toPoints: shared by both the single-file builders above and the comparison builders
   below — every ChartPoint/ComparisonPoint in this file is built by this one function,
   so "skip a null/undefined sample" and "elapsed time is in minutes" are each defined
   in exactly one place. */
/** @param {Array<number|null>} times @param {Array<number|null>} values @returns {ChartPoint[]} */
function toPoints(times, values) {
  const points = [];
  for (let i = 0; i < values.length; i++) {
    const t = times[i];
    if (t === null || values[i] === null || values[i] === undefined) continue;
    points.push({ x: t / 60, y: values[i] });
  }
  return points;
}
//#endregion

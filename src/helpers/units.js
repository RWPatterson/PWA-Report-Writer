/* =====================================================================================
   units.js
   =====================================================================================
   Values are always stored canonically (the .DAT file's native SI units). This module
   only converts at the edges: toDisplayValue() when painting the report, toCanonicalValue()
   when a user types an override while viewing in US units. Nothing in between ever
   carries a non-canonical number.

   This is deliberately separate from machineProfile.js's channel corrections. That
   module fixes MEASURED DATA that was recorded in the wrong unit by a specific rig
   (a data-quality problem, resolved once at parse time). This module converts CORRECT
   canonical data for DISPLAY (a presentation choice, resolved every render). Different
   problems, different files, on purpose.
   ===================================================================================== */

//#region conversion tables
/** @type {Record<string,string>} canonical unit -> physical quantity it measures */
const UNIT_QUANTITY = {
  "kPa": "pressure", "PSI": "pressure",
  "°C": "temperature", "°F": "temperature",
  // Deliberately its own quantity, not shared with any mL/min flow — converting a
  // small (10-275 mL/min) injection/sensor/sample flow to gal/min would show
  // unreadable tiny fractions (confirmed with the user); only the L/min-scale test
  // system flow rate converts.
  "L/min": "flow", "gal/min": "flow"
};

/** @type {Record<string,{SI:string,US:string}>} quantity -> its unit in each system */
const SYSTEM_UNIT = {
  pressure: { SI: "kPa", US: "PSI" },
  temperature: { SI: "°C", US: "°F" },
  flow: { SI: "L/min", US: "gal/min" }
};

/** @type {Record<string,(v:number)=>number>} "from->to" -> conversion function */
const CONVERTERS = {
  "kPa->PSI": (v) => v * 0.1450377,
  "PSI->kPa": (v) => v / 0.1450377,
  "°C->°F": (v) => (v * 9 / 5) + 32,
  "°F->°C": (v) => (v - 32) * 5 / 9,
  "L/min->gal/min": (v) => v * 0.2641720524,   // US gallon (1 gal = 3.785411784 L)
  "gal/min->L/min": (v) => v / 0.2641720524
};
//#endregion

//#region internal helpers
/** parseFloat that returns null (not NaN) for blank/bad input; passes numbers through.
 *  @param {*} value @returns {number|null} */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return isFinite(n) ? n : null;
}

/** @param {number} value @param {string} fromUnit @param {string} toUnit @returns {number} */
function rawConvert(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  const fn = CONVERTERS[fromUnit + "->" + toUnit];
  return fn ? fn(value) : value;
}
//#endregion

//#region public API
/** Which unit a canonical unit becomes under a given system. Falls back to the canonical
 *  unit itself for quantities with no known SI/US distinction (e.g. µm size, pS/m
 *  conductivity) — those are correctly left alone rather than mis-converted.
 *  @param {string} canonicalUnit @param {"SI"|"US"} system @returns {string} */
export function displayUnit(canonicalUnit, system) {
  const quantity = UNIT_QUANTITY[canonicalUnit];
  if (!quantity) return canonicalUnit;
  return (SYSTEM_UNIT[quantity] && SYSTEM_UNIT[quantity][system]) || canonicalUnit;
}

/** Canonical value -> the number to show under `system`. Non-numeric or unit-less input
 *  passes through unchanged. @param {*} value @param {string} canonicalUnit
 *  @param {"SI"|"US"} system @returns {*} */
export function toDisplayValue(value, canonicalUnit, system) {
  const num = toNumber(value);
  if (num === null || !canonicalUnit) return value;
  return rawConvert(num, canonicalUnit, displayUnit(canonicalUnit, system));
}

/** A value typed while viewing `system` -> the canonical number to store. Inverse of
 *  toDisplayValue. @param {*} value @param {string} canonicalUnit @param {"SI"|"US"} system
 *  @returns {*} */
export function toCanonicalValue(value, canonicalUnit, system) {
  const num = toNumber(value);
  if (num === null || !canonicalUnit) return value;
  return rawConvert(num, displayUnit(canonicalUnit, system), canonicalUnit);
}

/** Fixed-decimal string for a number; "" for null/undefined, the raw string otherwise.
 *  @param {*} value @param {number} [decimals=1] @returns {string} */
export function formatNumber(value, decimals = 1) {
  const num = toNumber(value);
  return num === null ? (value === null || value === undefined ? "" : String(value)) : num.toFixed(decimals);
}

/** Significant-figure string for a number — distinct from formatNumber's FIXED decimal
 *  places. Built for ISO 16889:2022's clumping calcs (12.5/12.6), which ask for "three
 *  digits of precision" over a value range spanning orders of magnitude (beta ratios
 *  from ~1 to 100,000+) where a fixed decimal count would be meaningless at one end
 *  (400.00) or useless at the other (0). Never emits scientific notation, unlike
 *  Number.toPrecision, so it reads naturally in a printed report at any magnitude.
 *  @param {*} value @param {number} [sigFigs=3] @returns {string} */
export function formatSignificant(value, sigFigs = 3) {
  const num = toNumber(value);
  if (num === null) return "";
  if (num === 0) return (0).toFixed(Math.max(0, sigFigs - 1));
  const magnitude = Math.floor(Math.log10(Math.abs(num)));
  // decimals only ever REDUCES toward 0 as magnitude grows, never negative — a
  // value at or past sigFigs digits (>=100 at sigFigs=3) shows as a plain integer,
  // full precision, not rounded further to only sigFigs significant digits. The
  // standard's own "three digits of precision" examples (1,75 / 20,1 / 400) are
  // about ensuring small values get enough DECIMAL places to reach 3 digits, not
  // about coarsening large ones — 217432 should print "217432", not "217000".
  const decimals = Math.max(0, sigFigs - 1 - magnitude);
  return num.toFixed(decimals);
}
//#endregion

/* =====================================================================================
   controlTargetCheck.js
   =====================================================================================
   Standard-agnostic control-target compliance engine — checks that analog channels
   (or, where a rig doesn't log one live, a header setpoint) stayed within a standard's
   configured tolerance during a test. See WISHLIST.md's "Control target compliance"
   section, drafted against ISO 16889 but explicitly scoped as reusable: a target
   belongs to what's being tested, not which rig is running it, and the same is true of
   the checking logic — it belongs to no standard in particular. ISO 4548-12 is the
   first consumer; ISO 16889 can adopt the same rule-table format later for free.

   A rule table is an array of:
     { parameter, channelTag?, targetSource?: {section, key, index?}, target?: number,
       headerFallback?: {section, key}, toleranceType: "percent"|"absolute", tolerance }

   Exactly one of targetSource/target should be given: targetSource reads the setpoint
   from the file's own header at check time (most targets); target is a fixed constant
   (e.g. conductivity's 1500 pS/m midpoint isn't stored per-file). targetSource.index
   (default 0) picks which comma-separated value to use for header lines that pack more
   than one setpoint onto a row (e.g. "SensorFlow,25,25" — index 0 for upstream, 1 for
   downstream); most keys only have one value, so index is omitted in most rules.
   channelTag, if given, is checked against the file's analog channels first; if that
   channel isn't present and headerFallback is given, the check falls back to a single
   header value instead of a per-record average — matches the pattern some rigs log a
   live channel and others only ever recorded a header value for the same quantity.
   channelTag is OPTIONAL: omit it entirely (headerFallback-only) for a quantity where
   averaging a live channel across the whole test would check the wrong thing — e.g.
   conductivity's live channel legitimately drifts upward over a multipass test as
   dust is injected, so a whole-test average compared against a fixed setpoint target
   produced false failures even when the test-fluid's actual starting conductivity was
   in range (see iso454812ControlTargets.js's Conductivity rules for the fix and the
   full story). Rule of thumb: only give channelTag when "should stay steady near the
   target for the WHOLE test" is actually what the standard means to check.

   No knowledge of any one standard's field ids or report layout lives here — this
   module only knows how to evaluate a rule against a DataFile.

   NOTE: analysisMath.js is a classic <script>-loaded global (see index.html), not an
   ES module, so it can't be `import`ed from here — this file duplicates the same
   tiny toNumber() rather than reach across that boundary, same as reportMapper.js
   already does.
   ===================================================================================== */

/**
 * @typedef {Object} ControlTargetRule
 * @property {string} parameter                        human label ("Test Flow Rate")
 * @property {string} channelTag                       analog channel checked first
 * @property {{section:string,key:string,index?:number}} [targetSource] read setpoint from header
 * @property {number} [target]                         fixed constant setpoint (use instead of targetSource)
 * @property {{section:string,key:string}} [headerFallback] used when channelTag isn't logged live
 * @property {"percent"|"absolute"} toleranceType
 * @property {number} tolerance
 * @property {string} [reportFieldId] the report's data-slot id this rule's ACTUAL value is
 *   displayed as, if any — lets a caller mark that specific field with an inline warning on
 *   failure. Omitted for rules with no single displayed field to point at (e.g. upstream/
 *   downstream pairs the report shows combined into one field) — those still show up in a
 *   full-detail warnings list, just without a page-level marker.
 *
 * @typedef {Object} ControlTargetResult
 * @property {string} parameter
 * @property {boolean} applicable  false if the target or actual couldn't be resolved
 * @property {boolean|null} ok      pass/fail, or null when not applicable
 * @property {number|null} target
 * @property {number|null} actual
 * @property {number} tolerance
 * @property {string} toleranceType
 * @property {string} message
 * @property {string} [reportFieldId] copied through from the rule, see above
 */

/** parseFloat that returns null (not NaN) for blank/bad input. @param {*} value @returns {number|null} */
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return isFinite(n) ? n : null;
}

//#region public API
/** @param {DataFile} df @param {ControlTargetRule[]} rules @returns {ControlTargetResult[]} */
export function checkControlTargets(df, rules) {
  return rules.map((rule) => checkOne(df, rule));
}
//#endregion

//#region rule evaluation
/** @param {DataFile} df @param {ControlTargetRule} rule @returns {ControlTargetResult} */
function checkOne(df, rule) {
  const result = {
    parameter: rule.parameter, applicable: false, ok: null,
    target: null, actual: null, tolerance: rule.tolerance, toleranceType: rule.toleranceType,
    message: "", reportFieldId: rule.reportFieldId
  };

  const target = rule.targetSource
    ? toNumber(readTargetSourceValue(df, rule.targetSource))
    : toNumber(rule.target);
  if (target === null) {
    result.message = "Target value not found in header (" +
      (rule.targetSource ? rule.targetSource.section + " / " + rule.targetSource.key : "fixed target") + ").";
    return result;
  }
  result.target = target;

  const actual = readActual(df, rule);
  if (actual === null) {
    result.message = rule.channelTag
      ? "Channel " + rule.channelTag + " not present in this file" +
        (rule.headerFallback ? " and no header fallback value found." : ".")
      : "Header value not found (" +
        (rule.headerFallback ? rule.headerFallback.section + " / " + rule.headerFallback.key : "no source configured") + ").";
    return result;
  }
  result.actual = actual;
  result.applicable = true;

  const [lo, hi] = toleranceBounds(target, rule.toleranceType, rule.tolerance);
  result.ok = actual >= lo && actual <= hi;
  // 3 decimals, not 1: the pass/fail comparison above always uses full precision, but
  // a 1-decimal message could print a genuine (if tiny) miss as e.g. "9.7 not in
  // [9.7, 10.3]" — technically correct (9.6968 < 9.7) but illegible, since rounding
  // hides the very margin the message is trying to explain. Per the user
  // (2026-07-31): fix the message's precision, not the comparison — a real miss
  // should still fail, just be readable when it does.
  result.message = result.ok
    ? "Within tolerance (" + lo.toFixed(3) + " to " + hi.toFixed(3) + ")."
    : "Out of tolerance: " + actual.toFixed(3) + " not in [" + lo.toFixed(3) + ", " + hi.toFixed(3) + "].";
  return result;
}

function readTargetSourceValue(df, targetSource) {
  const values = df.getHeaderValues(targetSource.section, targetSource.key);
  if (!values) return null;
  const index = targetSource.index || 0;
  return index < values.length ? values[index] : null;
}

function readActual(df, rule) {
  if (rule.channelTag && df.analogTags.indexOf(rule.channelTag) >= 0) {
    return averageChannel(df.getChannel(rule.channelTag));
  }
  if (rule.headerFallback) {
    return toNumber(df.getHeaderValue(rule.headerFallback.section, rule.headerFallback.key));
  }
  return null;
}

function averageChannel(series) {
  if (!series || series.length === 0) return null;
  let sum = 0, n = 0;
  for (const v of series) {
    if (v !== null && isFinite(v)) { sum += v; n++; }
  }
  return n > 0 ? sum / n : null;
}

function toleranceBounds(target, toleranceType, tolerance) {
  if (toleranceType === "percent") {
    const delta = target * (tolerance / 100);
    return [target - delta, target + delta];
  }
  return [target - tolerance, target + tolerance];   // "absolute"
}
//#endregion

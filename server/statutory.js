/**
 * statutory.js — per-job VAT determination (brief §9.1).
 *
 * The pricer previously carried a flat `isIreland ? 13.5 : 20`. That is the
 * failure §9 describes: nothing prevents the last job's answer being inherited,
 * and on some jobs VAT is the largest single number on the page. A contractor
 * who is told 20% on a job that qualifies for 5% loses the work; one told 5% on
 * a job that does not is exposed for the difference.
 *
 * This never silently changes a rate. It returns a determination WITH ITS
 * REASONING plus the queries that must be settled before the first application,
 * so the answer can be defended and so the tells that are never labelled
 * ("inherited", "empty for years", a wet room next to a ground-floor bedroom)
 * are raised rather than missed.
 *
 * Reliefs are time-limited and the thresholds move. Every rule carries the
 * notice it comes from so it can be re-checked, and ESM_SUNSET is asserted by a
 * test that fails once the date is in the past.
 */

// Zero-rated installation of energy-saving materials runs to this date, then
// reverts to the reduced rate. Notice 708/6.
const ESM_SUNSET = '2027-03-31';
const ESM_REVERT_RATE = 5;

const RATES = {
  UK_STANDARD: 20,
  UK_REDUCED: 5,
  UK_ZERO: 0,
  IE_REDUCED: 13.5,
  IE_STANDARD: 23,
};

function has(text, re) { return re.test(String(text || '')); }

/**
 * @param {object} job
 *   jurisdiction   'GB' | 'SCOTLAND' | 'IE'  (Scotland is GB for VAT; kept for callers)
 *   projectType    free text, e.g. "Garage conversion", "New build dwelling"
 *   description    the brief / scope text — searched for the unlabelled tells
 *   enquiryText    the customer's own words (often where "inherited" appears)
 *   today          ISO date, for the ESM sunset test (defaults to now)
 * @returns {{rate:number, basis:string, confidence:string, reasoning:string[],
 *            queries:string[], warnings:string[]}}
 */
function determineVat(job = {}) {
  const jurisdiction = String(job.jurisdiction || 'GB').toUpperCase();
  const blob = [job.projectType, job.description, job.enquiryText].filter(Boolean).join(' \n ');
  const today = job.today || new Date().toISOString().slice(0, 10);

  const reasoning = [];
  const queries = [];
  const warnings = [];

  // ── Ireland ─────────────────────────────────────────────────────────────
  if (jurisdiction === 'IE') {
    reasoning.push('Republic of Ireland: construction services to a private individual are charged at the 13.5% reduced rate.');
    queries.push('Confirm the employer is not a principal contractor — the construction reverse charge needs the CUSTOMER to be a principal contractor, and that answer must not be inherited from the same client\'s commercial work.');
    warnings.push('Two-thirds rule: if VAT-exclusive materials exceed two thirds of the charge, the WHOLE supply moves to 23%. A rising kitchen PC sum is what typically moves it — state the headroom.');
    return {
      rate: RATES.IE_REDUCED, basis: 'IE reduced rate (13.5%)',
      confidence: 'medium', reasoning, queries, warnings,
    };
  }

  // ── UK ──────────────────────────────────────────────────────────────────
  // Garage conversion: 20%, no relief. Contractors routinely assume 5%,
  // because s7's reduced rate reaches non-residential buildings — and a garage
  // occupied with a dwelling is not one.
  if (has(blob, /garage conversion|convert(ing)? (the )?garage/i)) {
    reasoning.push('Garage conversion is standard rated at 20%. The Notice 708 s7 reduced rate reaches the conversion of a NON-RESIDENTIAL building; a garage occupied together with a dwelling is not a non-residential building, so no relief applies.');
    warnings.push('Contractors commonly assume 5% here. State the 20% and the reason on the face of the offer.');
    return { rate: RATES.UK_STANDARD, basis: 'UK standard rate (garage conversion, no relief)', confidence: 'high', reasoning, queries, warnings };
  }

  // Empty property 5% — Notice 708 s8. The single highest-value question, and
  // the tells are in the customer's own wording, not in any drawing.
  const emptyTell = /\binherit(ed|ance)?\b|\bprobate\b|\bexecutry\b|long[- ]term vacant|\bempty\b|been (empty|vacant)|just taken it on|deceased/i;
  if (has(blob, emptyTell)) {
    reasoning.push('Notice 708 s8: works to a dwelling that has been EMPTY for two years or more immediately before the work qualify for the 5% reduced rate.');
    queries.push('RAISE FIRST: has the dwelling been empty for two years or more immediately before the work starts? Evidence: council tax records, empty-property records, or a letter from the managing agent. This must be settled BEFORE the first application, not at final account.');
    warnings.push('This routinely dwarfs every other saving on a refurbishment. Price at 20% with VAT as a live driver and show both totals until it is confirmed.');
    return {
      rate: RATES.UK_STANDARD, basis: 'UK standard rate pending the empty-property test (5% if satisfied)',
      confidence: 'low', reasoning, queries, warnings,
    };
  }

  // Demolish-and-rebuild — Note 18. Four conditions, each stated.
  if (has(blob, /demolish(ed)? (and|then) rebuild|rebuild(ing)? (after|following) demolition|complete rebuild|razed/i)) {
    reasoning.push('Sch 8 Group 5 Note 18 may zero rate a demolish-and-rebuild. All four conditions must hold, and each should be evidenced from the specification rather than recited.');
    queries.push('Note 18 condition 1: is statutory consent in place and are the works being carried out in accordance with it?');
    queries.push('Note 18 condition 2: is the existing building demolished COMPLETELY TO GROUND LEVEL, including foundations within the new footprint? Quote the demolition specification back as the evidence.');
    queries.push('Note 18 condition 3: is the result a single dwelling with no prohibition on separate disposal?');
    warnings.push('Professional fees remain a SEPARATE STANDARD-RATED supply — run two VAT lines, do not blend them.');
    warnings.push('Blocked goods (washing machine, fridge, dishwasher, carpets) cannot be zero rated. Word the kitchen provisional sum as units, worktops, sinks and taps.');
    return { rate: RATES.UK_STANDARD, basis: 'UK standard rate pending the Note 18 conditions (0% if all satisfied)', confidence: 'low', reasoning, queries, warnings };
  }

  // New build. NOT automatically zero rated — the relief reaches dwellings and
  // relevant residential/charitable buildings only.
  if (has(blob, /new build|newbuild|new dwelling|new house|new-build/i)) {
    const ancillary = has(blob, /plant room|game larder|garage block|outbuilding|store|stable|workshop/i);
    reasoning.push('Sch 8 Group 5 zero rates the construction of a DWELLING or a relevant residential/charitable building. It is not a general new-build relief.');
    if (ancillary) {
      warnings.push('This job includes a building that may not itself be a dwelling (e.g. a plant room, store or outbuilding). Those are standard rated even where the dwelling alongside them is zero rated — and even where a previous new build for the same contractor was zero rated throughout.');
      queries.push('Split the bill so any non-dwelling building carries its own VAT line.');
      return { rate: RATES.UK_STANDARD, basis: 'Mixed: dwelling may zero rate, ancillary buildings standard rated', confidence: 'low', reasoning, queries, warnings };
    }
    queries.push('Confirm the building is a dwelling (or relevant residential/charitable) and that there is no prohibition on separate disposal.');
    return { rate: RATES.UK_ZERO, basis: 'UK zero rate — new dwelling, Sch 8 Group 5', confidence: 'medium', reasoning, queries, warnings };
  }

  // Disabled adaptations — Notice 701/7 Group 12. The tells are never labelled.
  const adaptationTells = [
    [/wet ?room/i, 'a wet room'],
    [/level[- ]access shower/i, 'a level-access shower'],
    [/grab rail|drop[- ]down rail/i, 'grab or drop-down rails'],
    [/part m ramp|access ramp|wheelchair/i, 'a Part M ramp or wheelchair access'],
    [/stair ?lift/i, 'a supply for a stair lift'],
    [/widen(ed|ing)? (the )?(door|opening)/i, 'widened door openings'],
    [/ground floor bedroom|bedroom.*ground floor/i, 'a ground-floor bedroom'],
  ];
  const found = adaptationTells.filter(([re]) => has(blob, re)).map(([, label]) => label);
  if (found.length >= 2) {
    reasoning.push(`Notice 701/7 Group 12 may zero rate goods and services supplied to a disabled person for their domestic use. The tells here are ${found.join(', ')} — these jobs are never labelled "disabled adaptations".`);
    queries.push('Confirm whether the works are for a disabled person in their own home, and obtain the customer eligibility declaration before the first application.');
    warnings.push('Only the qualifying elements zero rate. Keep them in their own bill section so the relief is separately identifiable.');
    return { rate: RATES.UK_STANDARD, basis: 'UK standard rate pending the Group 12 eligibility declaration', confidence: 'low', reasoning, queries, warnings };
  }

  // Energy-saving materials — Notice 708/6, and the trap that costs the relief.
  if (has(blob, /solar|photovoltaic|\bpv\b|heat pump|ashp|gshp|insulation|energy saving|battery storage/i)) {
    const sunsetPassed = today > ESM_SUNSET;
    const esmRate = sunsetPassed ? ESM_REVERT_RATE : RATES.UK_ZERO;
    reasoning.push(`Notice 708/6: installation of energy-saving materials in residential accommodation is zero rated to ${ESM_SUNSET}, reverting to ${ESM_REVERT_RATE}% thereafter. On today's date (${today}) the applicable rate is ${esmRate}%.`);
    if (has(blob, /solar farm|commercial generation|ground[- ]mount/i)) {
      reasoning.push('A commercial generation asset (e.g. a solar farm) is 20% throughout — 708/6 reaches residential accommodation.');
      return { rate: RATES.UK_STANDARD, basis: 'UK standard rate — commercial generation asset', confidence: 'high', reasoning, queries, warnings };
    }
    warnings.push('THE TRAP: absorbed into a larger project that is not itself zero rated, HMRC treats the whole as one standard-rated supply of refurbishment. Put the ESMs in their OWN bill section and advise a separately identified supply with its own valuation — that is a decision before signing, not at final account.');
    queries.push(`Re-test the ${ESM_SUNSET} sunset date at tender — it moves.`);
    return { rate: esmRate, basis: `UK ${esmRate}% — energy-saving materials, if separately supplied`, confidence: 'medium', reasoning, queries, warnings };
  }

  // Default: standard rated, and say so as a determination rather than a default.
  reasoning.push('No relief identified on the information available: repairs, alterations and extensions to an existing dwelling are standard rated at 20%.');
  queries.push('If the property has been empty for two years or more, or the works are adaptations for a disabled occupant, the rate changes — confirm both before the first application.');
  return { rate: RATES.UK_STANDARD, basis: 'UK standard rate (20%)', confidence: 'medium', reasoning, queries, warnings };
}

// CIS domestic reverse charge turns on END USER status, which the contractor
// must evidence in writing before the first application.
function cisReverseChargeQuery(job = {}) {
  if (String(job.jurisdiction || 'GB').toUpperCase() === 'IE') return null;
  if (!job.customerIsBusiness) return null;
  return 'CIS domestic reverse charge turns on end-user status. Obtain a WRITTEN end user statement from the customer before the first application.';
}

module.exports = { determineVat, cisReverseChargeQuery, ESM_SUNSET, RATES };

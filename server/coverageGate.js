/**
 * coverageGate.js — does the rate library actually cover this job?
 *
 * The pricer will always return a number. Every path through it ends in a rate:
 * a library rate, the model's assumed rate, or a keyword guess. Nothing in it
 * can say "I do not know what this costs", so nothing in it ever does — and a
 * bill of 114 invented rates is indistinguishable, on the page, from a bill of
 * 114 researched ones. It reconciles. It totals. It prints.
 *
 * Two delivered bills are why this module exists:
 *
 *   Forest Mead    chat said GBP 1,170,875, the workbook said GBP 141,123.
 *   Wolfe Pavilion chat said GBP 1,252,782, the workbook said GBP 700,001 —
 *                  a 470 m2 commercial sports pavilion priced as a domestic
 *                  extension, every one of its rates multiplied by 0.3198 so
 *                  the total would land on 250 m2 x GBP 2,800.
 *
 * So this gate asks the question the pricer structurally cannot:
 *
 *     Of the money in this bill, how much rests on a rate somebody stands
 *     behind, and is this even the kind of building the library is for?
 *
 * and returns one of three verdicts:
 *
 *   issue    the bill is supportable as it stands
 *   qualify  issuable, but it must carry a stated limitation naming what is
 *            estimated and what would firm it up
 *   decline  do not produce a bill. Say what is missing instead.
 *
 * `decline` is a real answer, not a failure. A quantity surveyor who cannot
 * price a package says so and asks for a subcontract quotation; they do not
 * publish a plausible number. No BOQ is the correct output when the alternative
 * is a fictional one.
 */

const { detectBuildingClass, BASE_RATES } = require('./deterministicPricer');

// Share of BILL VALUE that must rest on an evidenced or library rate.
const COVERAGE_ISSUE = 65;    // at or above: issuable without qualification
const COVERAGE_DECLINE = 35;  // below: not a bill, a guess with a total

// Packages that are bought, not built. A library rate for these is a budget
// allowance and nothing more, and when they dominate a bill the honest output
// names them and asks for quotations.
const SUBCONTRACT_PACKAGES = [
  ['curtain walling / structural glazing', /curtain wall|structural glazing|shopfront/i],
  ['mechanical services', /\bahu\b|\bhrvu\b|air handling|heat[- ]recovery|\bvrf\b|\bvrv\b|ductwork|chiller|\bashp\b|air source heat pump/i],
  ['electrical services', /electrical installation|distribution board|\btp&n\b|photovoltaic|\bpv\b array|lighting installation/i],
  ['fire and life safety', /sprinkler|dry riser|wet riser|fire alarm|smoke (?:vent|extract)|mansafe|fall restraint/i],
  ['structural steelwork', /structural steel|steelwork to (?:se|engineer)/i],
  ['lift installation', /\blift\b|passenger lift|platform lift|hoist/i],
  ['piling / specialist substructure', /piling|\bcfa\b|underpinning|ground improvement/i],
  ['catering fit-out', /catering|commercial kitchen|extract canopy|servery/i],
  ['asbestos removal', /asbestos/i],
];

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function allItems(pricedResult) {
  const secs = (pricedResult && pricedResult.sections) || [];
  return secs.flatMap((s) => (s.items || []));
}

/**
 * Which subcontract packages this bill contains, and what share of its value
 * they carry. A pavilion where 45% of the money is mechanical services and
 * curtain walling is a bill that needs two quotations, not two more estimates.
 */
function subcontractExposure(items) {
  const total = items.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const found = [];
  for (const [name, re] of SUBCONTRACT_PACKAGES) {
    const matched = items.filter((i) => re.test(String(i.description || i.key || '')));
    if (!matched.length) continue;
    const value = matched.reduce((s, i) => s + (Number(i.total) || 0), 0);
    // Only the ones NOT resting on an evidenced or library rate are a problem.
    const guessed = matched.filter((i) => i.rate_source === 'ai_estimated'
      || i.rate_source === 'fallback_estimated' || i.rate_source === 'fallback_corrected'
      || i.rate_source === 'ceiling_clipped');
    found.push({
      package: name,
      lines: matched.length,
      value: Math.round(value * 100) / 100,
      value_pct: pct(value, total),
      unevidenced_lines: guessed.length,
      unevidenced_value: Math.round(guessed.reduce((s, i) => s + (Number(i.total) || 0), 0) * 100) / 100,
    });
  }
  return found.sort((a, b) => b.value - a.value);
}

/**
 * Allowances carrying a rate the pricer invented because no figure was stated.
 * These are the lines a reader most reasonably assumes are firm.
 */
function unpricedAllowances(items) {
  const re = /provisional|p\.?\s?sum|prime cost|\bpc sum\b|\ballowance\b|\bto be confirmed\b|\btbc\b/i;
  return items
    .filter((i) => re.test(String(i.description || i.key || '')))
    .filter((i) => i.rate_source === 'fallback_estimated' || i.rate_source === 'ai_estimated')
    .map((i) => ({
      description: String(i.description || i.key || '').slice(0, 100),
      rate: i.rate, qty: i.qty, total: i.total, rate_source: i.rate_source,
    }));
}

/**
 * @param {object} pricedResult  the return value of priceLockedQuantities
 * @param {object} opts
 *   lockedItems     the takeoff, if the priced result did not classify it
 *   projectTitle    free text, used for building classification
 *   strict          treat `qualify` as blocking too (default false)
 * @returns {object} verdict
 */
function assessCoverage(pricedResult, opts = {}) {
  const items = allItems(pricedResult);
  const summary = (pricedResult && pricedResult.summary) || {};
  const cov = summary.rate_source_coverage || { coverage_pct: 0, estimated_pct: 0, library_pct: 0, evidenced_pct: 0 };
  const capEvents = pricedResult.cap_events || [];
  const buildingClass = pricedResult.building_class
    || detectBuildingClass(opts.lockedItems || items, `${pricedResult.project_type || ''} ${opts.projectTitle || ''}`);

  const total = items.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const lineCoverage = pct(items.filter((i) => i.rate_source === 'base_library'
    || i.rate_source === 'client_verified' || i.rate_source === 'override').length, items.length);

  // Does the takeoff actually reach the commercial half of the library, or did
  // it fall through to the domestic keyword ladder? On a non-residential job
  // these two answers are very different bills.
  const commercialLines = items.filter((i) => String(i.key || '').startsWith('comm_')).length;

  const reasons = [];
  const packages = subcontractExposure(items);
  const allowances = unpricedAllowances(items);

  let verdict = 'issue';
  const fail = (r) => { verdict = 'decline'; reasons.push(r); };
  const warn = (r) => { if (verdict !== 'decline') verdict = 'qualify'; reasons.push(r); };

  // ── 1. A bill whose rates were rewritten to hit a target is not a bill.
  const rescales = capEvents.filter((e) => e.action === 'rescaled');
  for (const e of rescales) {
    fail(`Every rate in ${e.section ? `section "${e.section}"` : 'the bill'} was multiplied by ${e.scale} to bring the total to ${Math.round(e.to).toLocaleString('en-GB')}. `
      + `${e.lines} line rate${e.lines === 1 ? '' : 's'} are now numbers no one worked out. A total that is over its envelope is a question about the quantities, not a licence to rescale the rates.`);
  }

  // ── 2. Is this even the right library?
  if (buildingClass.klass === 'non_residential') {
    if (commercialLines === 0 && items.length > 0) {
      fail(`This reads as ${buildingClass.sector || 'non-residential'} work (${buildingClass.signals.slice(0, 4).join(', ')}) but not one line was priced from the commercial rate library. `
        + `Every rate here came from a domestic library or a guess.`);
    } else if (pct(commercialLines, items.length) < 25) {
      warn(`This reads as ${buildingClass.sector || 'non-residential'} work but only ${pct(commercialLines, items.length)}% of lines mapped to a commercial rate; the rest fell back to domestic rates or estimates.`);
    }
  }

  // ── 3. How much of the money rests on something real.
  if (cov.coverage_pct < COVERAGE_DECLINE) {
    fail(`Only ${cov.coverage_pct}% of the value rests on an evidenced or library rate — ${100 - cov.coverage_pct}% is estimated. `
      + `At that level the total is an order-of-magnitude indication, and presenting it as a bill of quantities misrepresents it.`);
  } else if (cov.coverage_pct < COVERAGE_ISSUE) {
    warn(`${cov.coverage_pct}% of the value rests on an evidenced or library rate; ${cov.estimated_pct}% is estimated.`);
  }
  if (items.length >= 10 && lineCoverage < 15) {
    warn(`Only ${lineCoverage}% of the ${items.length} lines matched a library rate — most descriptions did not resolve to a known item.`);
  }

  // ── 4. Packages that should be quoted, not estimated.
  const bigGuessedPackages = packages.filter((p) => p.unevidenced_value > 0 && p.value_pct >= 8);
  if (bigGuessedPackages.length) {
    const worst = bigGuessedPackages.slice(0, 4)
      .map((p) => `${p.package} (${p.value_pct}% of the bill, ${p.unevidenced_lines} estimated line${p.unevidenced_lines === 1 ? '' : 's'})`);
    const share = bigGuessedPackages.reduce((s, p) => s + p.value_pct, 0);
    if (share >= 40) {
      fail(`${Math.round(share)}% of this bill is specialist subcontract packages carrying estimated rates: ${worst.join('; ')}. These are bought on quotation. Estimating them is guessing at somebody else's price.`);
    } else {
      warn(`Specialist packages carrying estimated rates: ${worst.join('; ')}. Firm these with subcontract quotations before the figure is relied on.`);
    }
  }

  // ── 5. Allowances presented as prices.
  if (allowances.length) {
    const v = allowances.reduce((s, a) => s + (Number(a.total) || 0), 0);
    warn(`${allowances.length} provisional sum / allowance line${allowances.length === 1 ? '' : 's'} carry a rate this system invented (${Math.round(v).toLocaleString('en-GB')} in total) because no figure was stated for them. State the sums or remove the lines.`);
  }

  // ── 6. Caps that reported rather than rescaled — worth saying, not blocking.
  for (const e of capEvents.filter((x) => x.action === 'reported_only')) {
    warn(`Construction is ${Math.round(e.cost_per_m2).toLocaleString('en-GB')}/m2 against a ${Math.round(e.envelope).toLocaleString('en-GB')}/m2 envelope, measured against a floor area inferred from the slab line rather than a stated GIA. No rates were changed. Confirm the gross internal floor area.`);
  }

  const blocking = verdict === 'decline' || (opts.strict === true && verdict === 'qualify');

  return {
    verdict,
    blocking,
    building_class: buildingClass,
    coverage: {
      value_coverage_pct: cov.coverage_pct,
      estimated_pct: cov.estimated_pct,
      line_coverage_pct: lineCoverage,
      commercial_lines: commercialLines,
      lines: items.length,
      value: Math.round(total * 100) / 100,
    },
    cap_events: capEvents,
    packages,
    unpriced_allowances: allowances,
    reasons,
    statement: buildStatement(verdict, reasons, cov, buildingClass),
    remedy: buildRemedy(verdict, packages, allowances, buildingClass, cov),
  };
}

/** The sentence that goes to the client, or in place of the bill. */
function buildStatement(verdict, reasons, cov, buildingClass) {
  if (verdict === 'decline') {
    return 'I am not going to produce a bill of quantities for this. '
      + reasons[0]
      + ' A bill I cannot support is worse than no bill: it reads as a price, it gets relied on, and nothing on the page shows which figures were worked out and which were filled in.';
  }
  if (verdict === 'qualify') {
    return `This is issuable as a budget estimate, not a tender bill. ${cov.coverage_pct}% of the value rests on an evidenced or library rate and ${cov.estimated_pct}% is estimated`
      + (buildingClass.klass === 'non_residential' ? `; the job is ${buildingClass.sector || 'non-residential'} work, where specialist packages move the total more than the measured fabric does` : '')
      + '. The qualifications below say which figures are which.';
  }
  return `Priced from the rate library: ${cov.coverage_pct}% of the value on evidenced or library rates, ${cov.estimated_pct}% estimated.`;
}

/** What would actually move this to issuable. Concrete, not "get more info". */
function buildRemedy(verdict, packages, allowances, buildingClass, cov) {
  if (verdict === 'issue') return [];
  const out = [];
  const quoteable = packages.filter((p) => p.unevidenced_value > 0).slice(0, 6);
  for (const p of quoteable) {
    out.push(`Subcontract quotation for ${p.package} — ${p.lines} line${p.lines === 1 ? '' : 's'}, currently ${Math.round(p.value).toLocaleString('en-GB')} estimated.`);
  }
  if (allowances.length) {
    out.push(`Stated figures for the ${allowances.length} provisional sum / allowance line${allowances.length === 1 ? '' : 's'}, from the employer's requirements or the tender documents.`);
  }
  if (buildingClass.klass === 'non_residential') {
    out.push('Confirmed gross internal floor area and storey heights, so the bill can be benchmarked against a non-domestic cost-per-m2 range rather than a domestic one.');
  }
  if (cov.coverage_pct < COVERAGE_ISSUE) {
    out.push('Your own confirmed rates for the trades you self-deliver — each one moves that trade from estimated to evidenced and off this list.');
  }
  return out;
}

module.exports = {
  assessCoverage,
  subcontractExposure,
  unpricedAllowances,
  statedSumCheck: unpricedAllowances,
  COVERAGE_ISSUE,
  COVERAGE_DECLINE,
  SUBCONTRACT_PACKAGES,
};

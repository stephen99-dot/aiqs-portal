/**
 * billCredibility.js — checks that a bill means what it says.
 *
 * Written from a real delivered tender (Wolfe Pavilion) that passed every
 * existing gate and was still not issuable. Three distinct failures, none of
 * which the recalc or pre-issue gates can see, because the workbook was
 * internally perfect:
 *
 * 1. THE NARRATIVE STATED A DIFFERENT TOTAL FROM THE BILL. The chat reported
 *    £1,252,782 construction; the spreadsheet's lines summed to £700,001. The
 *    recalc gate compares the PRICER to the DOCUMENT — both said £700,001, so
 *    it passed. The £1.25m was a third number, written in prose by the model.
 *    Any figure a human reads has to come from the priced result.
 *
 * 2. FIXED PROVISIONAL SUMS WERE RE-PRICED INSTEAD OF CARRIED. The tender
 *    named 13 provisional sums totalling exactly £75,000. The bill priced them
 *    through the rate library and carried £50,846 — £24,154 short. A
 *    provisional sum with a stated amount is not an estimate; it is a figure
 *    the tender documents fix, and it must appear at its stated value.
 *
 * 3. EVERY LUMP SUM WAS A MULTIPLE OF ONE FALLBACK RATE. On that job every
 *    "Item" line came back as an integer multiple of £319.79 — 3x, 6x, 8x,
 *    50x — because nothing matched the (residential) rate library and no
 *    assumed_rate was supplied, so a generic estimator priced the whole job.
 *    The arithmetic is flawless and the bill is commercially meaningless.
 */

// A bill where this share of value rests on generic fallback estimates is not
// a priced bill, whatever its arithmetic says.
const FALLBACK_VALUE_WARN = 0.30;
const FALLBACK_VALUE_BLOCK = 0.60;

// Rates that are all integer multiples of one base betray a single estimator.
const MULTIPLE_TOLERANCE = 0.005;   // 0.5% — allows for rounding
const MIN_LINES_FOR_MULTIPLE_TEST = 6;

const FALLBACK_SOURCES = new Set(['fallback_estimated', 'fallback_corrected', 'ceiling_clipped']);

function money(n) { return '£' + Math.round(Number(n) || 0).toLocaleString('en-GB'); }

function allItems(sections) {
  const out = [];
  for (const s of sections || []) for (const i of (s.items || [])) out.push(i);
  return out;
}

/**
 * Every £ figure a human will read must come from the priced result. Compares
 * the totals stated in the narrative against the bill.
 */
function checkNarrativeTotals(replyText, summary) {
  const findings = [];
  const text = String(replyText || '');
  if (!text || !summary) return findings;

  const construction = Number(summary.construction_total) || 0;
  const grand = Number(summary.grand_total) || 0;
  if (!construction && !grand) return findings;

  // £1,252,782 / £1.25m / £1,252,782.00
  const seen = new Set();
  const re = /£\s?([\d][\d,]*(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 10000) continue;  // ignore rates and small allowances
    if (seen.has(value)) continue;
    seen.add(value);

    // A stated figure is fine if it matches a real total, a section subtotal,
    // or the VAT — anything the priced result actually contains.
    const near = (target) => target > 0 && Math.abs(value - target) / target < 0.01;
    if (near(construction) || near(grand) || near(grand - construction)) continue;

    // Or a section subtotal.
    const sectionTotals = (summary.__sectionTotals || []);
    if (sectionTotals.some(near)) continue;

    findings.push({
      id: 'narrative_total_mismatch', severity: 'high',
      stated: value,
      message: `The reply states ${money(value)}, which is not the construction total (${money(construction)}), `
        + `the grand total (${money(grand)}) or any section subtotal. Every figure a client reads must come from `
        + `the priced result — a number written in prose is not a price.`,
    });
  }
  return findings;
}

/**
 * A provisional sum whose amount is stated in the tender must be carried at
 * that amount, not re-priced.
 */
function checkProvisionalSums(sections, statedSums) {
  const findings = [];
  const items = allItems(sections);
  const provisional = items.filter((i) => /provisional sum|p\.?\s?sum\s?\d/i.test(String(i.description || '')));
  if (!provisional.length) return findings;

  const carried = provisional.reduce((a, i) => a + (Number(i.total) || 0), 0);

  if (Number(statedSums) > 0) {
    const stated = Number(statedSums);
    if (Math.abs(carried - stated) > Math.max(1, stated * 0.005)) {
      findings.push({
        id: 'provisional_sums_repriced', severity: 'high',
        carried, stated, shortfall: stated - carried,
        message: `${provisional.length} provisional sums are carried at ${money(carried)} against ${money(stated)} `
          + `stated in the tender — ${money(Math.abs(stated - carried))} ${carried < stated ? 'short' : 'over'}. `
          + `A provisional sum with a stated amount is fixed by the tender documents and must appear at that value, `
          + `not be re-priced through the rate library.`,
      });
    }
  } else {
    // No stated total supplied, but flag any provisional sum that was priced
    // by the estimator rather than carried — the tell is a non-round figure.
    const estimated = provisional.filter((i) => FALLBACK_SOURCES.has(String(i.rate_source || '')));
    if (estimated.length) {
      findings.push({
        id: 'provisional_sums_estimated', severity: 'high',
        message: `${estimated.length} of ${provisional.length} provisional sums were priced by the estimator rather `
          + `than carried at a stated value. Check each against the tender's provisional sum schedule and carry the `
          + `stated figure.`,
      });
    }
  }
  return findings;
}

/** How much of the bill's value rests on generic estimates. */
function checkFallbackConcentration(sections) {
  const items = allItems(sections);
  const total = items.reduce((a, i) => a + (Number(i.total) || 0), 0);
  if (!total) return [];

  const fallback = items.filter((i) => FALLBACK_SOURCES.has(String(i.rate_source || '')));
  const fallbackValue = fallback.reduce((a, i) => a + (Number(i.total) || 0), 0);
  const share = fallbackValue / total;
  if (share < FALLBACK_VALUE_WARN) return [];

  return [{
    id: 'fallback_concentration',
    severity: share >= FALLBACK_VALUE_BLOCK ? 'high' : 'medium',
    share: Math.round(share * 1000) / 10,
    value: fallbackValue,
    lines: fallback.length,
    message: `${Math.round(share * 100)}% of this bill's value (${money(fallbackValue)} across ${fallback.length} lines) `
      + `comes from generic fallback estimates rather than library or client rates. The arithmetic is sound and the `
      + `pricing is not: this usually means the job is outside the rate library's coverage. Supply rates for these `
      + `lines, or issue it as an order-of-cost estimate and say so.`,
  }];
}

/**
 * Rates that are all integer multiples of one base betray a single estimator
 * pricing the whole job. On the Wolfe job every Item rate was n x £319.79.
 */
/**
 * Find the base rate that explains the most lines as near-integer multiples.
 *
 * An exact GCD is no good here: on the Wolfe job 49 of 56 lump-sum lines were
 * multiples of £319.79 and seven were not, and those seven collapse the GCD to
 * noise. The estimator's fingerprint has to survive outliers, so instead score
 * candidate bases and keep the best.
 */
function dominantBase(rates) {
  const candidates = new Set();
  for (const r of rates) {
    for (let k = 1; k <= 60; k++) {
      const c = r / k;
      if (c >= 1) candidates.add(Math.round(c * 100) / 100);
    }
  }
  let best = null;
  for (const base of candidates) {
    if (base < 1) continue;
    let hits = 0;
    for (const r of rates) {
      const k = r / base;
      if (k < 0.99 || k > 200) continue;
      if (Math.abs(k - Math.round(k)) < 0.01) hits++;
    }
    if (!best || hits > best.hits || (hits === best.hits && base > best.base)) best = { base, hits };
  }
  return best;
}

/**
 * Rates that are integer multiples of one base betray a single estimator
 * pricing that whole family of lines.
 *
 * Tested PER UNIT, because that is the real signature. On the Wolfe job the
 * measured units (m2, m3, m) were properly rated from the library while 49 of
 * the 56 lump-sum "Item" lines — which carry most of the money on a commercial
 * job — were multiples of £319.79. Averaged across all units that disappears.
 */
function checkRateMonoculture(sections) {
  const byUnit = new Map();
  for (const i of allItems(sections)) {
    const rate = Number(i.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const unit = String(i.unit || 'Item').trim().toLowerCase() || 'item';
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push({ rate, total: Number(i.total) || 0 });
  }

  const findings = [];
  for (const [unit, lines] of byUnit) {
    if (lines.length < MIN_LINES_FOR_MULTIPLE_TEST) continue;
    const rates = lines.map((l) => l.rate);
    const best = dominantBase(rates);
    if (!best) continue;
    const share = best.hits / rates.length;
    // A properly-priced bill of round-pound rates will find a base of £1 and
    // "explain" everything — that is rates being round, not one estimator.
    if (best.base <= 1) continue;
    if (share < 0.8) continue;

    const value = lines.reduce((a, l) => a + l.total, 0);
    const mult = rates.map((r) => Math.round(r / best.base)).filter((k) => k >= 1).slice(0, 6);
    findings.push({
      id: 'rate_monoculture', severity: 'high', unit, base: best.base,
      lines: lines.length, matched: best.hits, value,
      message: `${best.hits} of ${lines.length} "${unit}" lines (${money(value)}) are integer multiples of `
        + `${money(best.base)} (${mult.map((m) => m + 'x').join(', ')}…). That is one estimator pricing the whole `
        + `family, not a priced bill — the numbers reconcile perfectly and mean nothing. On a commercial job the `
        + `lump-sum lines carry most of the value, so this is where the bill is decided. Price them from real rates.`,
    });
  }
  return findings;
}

/**
 * @param {object} priced      the pricer result
 * @param {object} opts        { replyText, statedProvisionalSums }
 */
function checkBillCredibility(priced, opts = {}) {
  const sections = (priced && priced.sections) || [];
  const summary = (priced && priced.summary) || {};
  summary.__sectionTotals = sections.map((s) => (s.items || []).reduce((a, i) => a + (Number(i.total) || 0), 0));

  const findings = [
    ...checkFallbackConcentration(sections),
    ...checkRateMonoculture(sections),
    ...checkProvisionalSums(sections, opts.statedProvisionalSums),
    ...checkNarrativeTotals(opts.replyText, summary),
  ];
  delete summary.__sectionTotals;

  const blocking = findings.some((f) => f.severity === 'high');
  return {
    findings, blocking,
    summary: findings.length === 0
      ? 'Bill credibility: no issues.'
      : `Bill credibility: ${findings.length} issue(s), ${findings.filter((f) => f.severity === 'high').length} high.`,
  };
}

module.exports = {
  checkBillCredibility, checkNarrativeTotals, checkProvisionalSums,
  checkFallbackConcentration, checkRateMonoculture,
  FALLBACK_VALUE_WARN, FALLBACK_VALUE_BLOCK,
};

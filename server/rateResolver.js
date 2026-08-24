/**
 * rateResolver.js — one precedence ladder for "what does this item cost?", with
 * provenance attached to every answer.
 *
 * Today five code paths each resolve rates their own way and disagree with each other.
 * This module is the single ladder they will all eventually call. Phase 1 implements
 * only the rungs that exist today — override, client-verified, base library — so its
 * output is provably identical to deterministicPricer's inline ladder. Later phases add
 * own-history medians, resource build-ups and first-principles scoping ABOVE and BELOW
 * those rungs without touching the callers again.
 *
 * Two properties are deliberate and worth preserving:
 *
 *   1. Pure and DB-free, like deterministicPricer. The caller passes clientRate in; this
 *      module never opens a database. forUser() below builds the closure that does the
 *      one query, so the ~8 pricing call sites don't each grow query logic.
 *
 *   2. One-way dependency. rateResolver requires deterministicPricer (for the rate
 *      library and its guards), never the reverse — the pricer takes the resolver by
 *      injection. That keeps the pricer's zero-require purity intact and avoids a cycle.
 *
 * Parity is the hard part, not the ladder. The subtleties that a naive reimplementation
 * gets wrong, all of which are reproduced here:
 *
 *   - override and client rates are NOT location-adjusted; base-library and fallback
 *     rates ARE. A client's own rate is already their real price; a library rate is a
 *     UK average that still needs the regional factor.
 *   - a client rate more than 5x or less than 0.1x the location-adjusted base rate is
 *     rejected back to base — a guard against corrupted client_rate_library rows.
 *   - a library rate is ignored when the line's unit family disagrees with the key's.
 *   - the unit ceiling clip and the AI total-cost cap run AFTER the ladder and can
 *     rewrite the basis to fallback_corrected on any path.
 */

const {
  BASE_RATES,
  unitFamily,
  ceilingFor,
  statedSumInDescription,
  estimateFallbackRate,
} = require('./deterministicPricer');

// Maps a resolver basis to the rate_source string deterministicPricer records, so the
// two can be compared directly in shadow mode and so coverage tiering stays consistent.
const BASIS_TO_RATE_SOURCE = {
  override:         'override',
  client_verified:  'client_verified',
  composite:        'base_library',
  ai_estimated:     'ai_estimated',
  fallback:         'fallback_estimated',
  fallback_clipped: 'fallback_corrected',
  ceiling_clipped: 'ceiling_clipped',
  stated_sum: 'stated_sum',
};

// Confidence per basis. Coarse on purpose: it is a label for how much the number rests
// on evidence, not a calibrated probability. Real confidence arrives with sample counts
// once price_evidence is actually read for pricing.
const BASIS_CONFIDENCE = {
  override:         1.00,
  client_verified:  0.85,
  composite:        0.60,
  ai_estimated:     0.30,
  fallback:         0.20,
  fallback_clipped: 0.15,
  ceiling_clipped: 0.15,
  stated_sum: 1.0,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve one line's rate.
 *
 * @param {object}  p
 * @param {string}  p.itemKey       canonical item key (may be unknown to the library)
 * @param {string}  p.description   free text, used by the fallback keyword ladder
 * @param {string}  p.unit          the line's unit
 * @param {number}  p.qty           needed only by the AI total-cost sanity cap
 * @param {number}  p.locFactor     regional factor, already including GBP→EUR if Irish
 * @param {number} [p.overrideRate] explicit per-line override
 * @param {number} [p.clientRate]   this builder's confirmed rate for the key
 * @param {number} [p.assumedRate]  the model's assumed_rate for an unknown key
 * @param {string} [p.region]       label only, carried into provenance
 * @param {string} [p.projectType]  label only, carried into provenance
 *
 * @returns {{rate:number, basis:string, rateSource:string, confidence:number,
 *            provenance:Array, adjustments:Array, sampleCount:number,
 *            needsReview:boolean, warnings:string[]}}
 */
function resolveRate(p = {}) {
  const {
    itemKey, description = '', unit = '', qty = 1,
    locFactor = 1, overrideRate, clientRate, assumedRate,
    region = null, projectType = null,
    // Non-domestic work uses the commercial ceiling table. Threaded through
    // rather than re-detected here: the pricer classifies the building once, and
    // two classifiers would eventually disagree on the same job.
    nonResidential = false,
  } = p;

  const item = { key: itemKey, description, unit, qty, assumed_rate: assumedRate };
  const known = BASE_RATES[itemKey];
  const provenance = [];
  const warnings = [];
  let rate;
  let basis;

  const noteFallback = () => {
    // The model's own guess is preferred over the keyword ladder, matching the pricer.
    if (assumedRate) {
      rate = assumedRate * locFactor;
      basis = 'ai_estimated';
      provenance.push({ source_type: 'model_estimate', value: assumedRate, weight: 0.25 });
    } else {
      const est = estimateFallbackRate(item);
      rate = est * locFactor;
      basis = 'fallback';
      provenance.push({ source_type: 'keyword_ladder', value: est, weight: 0.10 });
    }
  };

  // ── Rung 1 — explicit per-line override. Always wins, never location-adjusted.
  if (overrideRate && overrideRate > 0) {
    rate = overrideRate;
    basis = 'override';
    provenance.push({ source_type: 'line_override', value: overrideRate, weight: 1.0 });

  // ── Rung 2 — this builder's confirmed rate. Also not location-adjusted: it is
  //    already the price they actually charge in their own region.
  } else if (clientRate && clientRate > 0) {
    rate = clientRate;
    basis = 'client_verified';
    provenance.push({ source_type: 'client_library', value: clientRate, weight: 0.55 });

    // Sanity ratio against the library. Catches corrupted rows (the classic being
    // scaffolding stored at £2,245 against a £22 base) that would otherwise sail
    // straight into a quote.
    if (known && known.rate > 0) {
      const baseWithLoc = known.rate * locFactor;
      const ratio = rate / baseWithLoc;
      if (ratio > 5 || ratio < 0.1) {
        warnings.push(`Client rate for '${itemKey}' is ${ratio.toFixed(1)}x the base rate — using base rate instead`);
        rate = baseWithLoc;
        basis = 'composite';
        provenance.push({ source_type: 'base_library', value: known.rate, weight: 0.40, rejected_client_rate: clientRate });
      }
    }

  // ── Rung 6 — the base library composite, location-adjusted.
  } else if (known) {
    const itemFam = unitFamily(unit);
    const keyFam = unitFamily(known.unit);
    const desc = String(description).toLowerCase();

    // Same-unit wrong-key: the whole-system "extend central heating to a new
    // extension" allowance applied to a single radiator move. Both units read Item, so
    // the family guard below cannot see it.
    const heatingMisuse = itemKey === 'heating_extension'
      && /radiator/.test(desc) && /relocat|reposition|\bmove\b|shift|existing/.test(desc)
      && !/new\s*extension|throughout|whole|entire/.test(desc);

    const familyMismatch = itemFam && keyFam
      && itemFam !== 'item' && keyFam !== 'item' && itemFam !== keyFam;

    if (familyMismatch) {
      warnings.push(`Key '${itemKey}' prices per ${known.unit} but the line is per ${unit} — likely the wrong rate key`);
      noteFallback();
    } else if (heatingMisuse) {
      warnings.push(`Key 'heating_extension' was applied to a single-radiator move — wrong rate`);
      noteFallback();
    } else {
      rate = known.rate * locFactor;
      basis = 'composite';
      provenance.push({ source_type: 'base_library', value: known.rate, weight: 0.40 });
    }

  // ── No key at all.
  } else {
    warnings.push(`No base rate for '${itemKey}' — estimated`);
    noteFallback();
  }

  // ── Post-ladder guards. These run on EVERY path and can rewrite the basis, which is
  //    why they live here and not inside a branch above.

  // Unit ceiling. The last line of defence against a physically impossible rate
  // arriving from any source, including a client rate for a key with no base rate.
  const ceiling = ceilingFor(unit, { commercial: nonResidential });
  if (ceiling) {
    const ceilingLocal = ceiling * locFactor;
    if (rate > ceilingLocal) {
      // Clip TO THE CEILING. Kept byte-for-byte in step with the same guard in
      // deterministicPricer.js — the parity test asserts the two agree. See the
      // comment there for why replacing the rate with estimateFallbackRate()
      // was wrong (it cut real lines by up to 428x).
      const fallback = estimateFallbackRate(item) * locFactor;
      const clipped = Math.min(ceilingLocal, Math.max(fallback, ceilingLocal));
      warnings.push(`Rate for '${itemKey}' exceeds the per-unit ceiling — clipped to the ceiling. Source was ${basis}.`);
      rate = clipped;
      basis = 'ceiling_clipped';
    }
  }

  // A stated provisional / prime-cost sum overrides the ladder and skips both the
  // location factor and the ceiling. Kept in step with deterministicPricer.js.
  const statedSum = statedSumInDescription(description || itemKey);
  if (statedSum != null && (Number(qty) || 1) === 1 && basis !== 'override' && basis !== 'client_verified') {
    rate = statedSum;
    basis = 'stated_sum';
    provenance.push({ source_type: 'stated_in_documents', value: statedSum, weight: 1.0 });
  }

  // An AI-assumed rate that looks like a total rather than a per-unit price.
  // Kept in step with the same guard in deterministicPricer.js — see the comment
  // there for why non-domestic work needs a different trigger and a different
  // reference rate (45 m2 of curtain walling at an ordinary GBP 1,240/m2 is a
  // GBP 56k line, and the domestic keyword ladder answers GBP 45/m2 for it).
  if (basis === 'ai_estimated' && qty > 1) {
    const itemTotal = qty * rate;
    if (itemTotal > (nonResidential ? 250000 : 50000) && rate > 500) {
      const expected = (nonResidential
        ? (ceilingFor(unit, { commercial: true }) || estimateFallbackRate(item))
        : estimateFallbackRate(item)) * locFactor;
      if (rate > expected * 5) {
        warnings.push(`Rate for '${itemKey}' looks too high (${Math.round(itemTotal)} total) — using fallback`);
        rate = expected;
        basis = 'fallback_clipped';
      }
    }
  }

  for (const entry of provenance) {
    entry.region = region;
    entry.project_type = projectType;
  }

  return {
    rate: round2(rate),
    basis,
    rateSource: BASIS_TO_RATE_SOURCE[basis] || basis,
    confidence: BASIS_CONFIDENCE[basis] ?? 0.2,
    provenance,
    // Populated in Phase 5, when entity priors become labelled price adjustments.
    adjustments: [],
    sampleCount: provenance.length,
    // Nothing in Phase 1 needs review: every rung here is a rung that already ships.
    // The first-principles path in a later phase always sets this.
    needsReview: false,
    warnings,
  };
}

/**
 * Bind a resolver to one builder, doing the single client_rate_library read up front.
 *
 * One query per job rather than one per line, and it keeps the ~8 pricing call sites
 * from each reimplementing the same SELECT (which is how clientRates ended up
 * hand-assembled in eight places today).
 *
 * Returns null when the rates cannot be read, so a caller can simply skip the shadow
 * rather than handle an error.
 */
function forUser(db, userId) {
  let clientRates = {};
  try {
    const rows = db.prepare(
      'SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1'
    ).all(userId);
    for (const r of rows) clientRates[r.item_key] = r.value;
  } catch (e) {
    return null;
  }
  return function resolveForItem(params) {
    return resolveRate({
      ...params,
      clientRate: params.clientRate != null ? params.clientRate : clientRates[params.itemKey],
    });
  };
}

module.exports = {
  resolveRate,
  forUser,
  BASIS_TO_RATE_SOURCE,
  BASIS_CONFIDENCE,
};

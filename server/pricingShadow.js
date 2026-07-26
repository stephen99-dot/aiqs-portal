/**
 * pricingShadow.js — the two-line glue that turns shadow mode on at a pricing call site.
 *
 * deterministicPricer takes an injected resolver and returns a `shadow` block; shadowLog
 * persists the disagreements. This module exists so a call site needs neither of those
 * details: it wraps the flag check, the resolver construction and all the error handling
 * in one place, so the ~8 pricing call sites stay one line each and cannot drift apart.
 *
 * Usage:
 *
 *   const priced = deterministicPricer.priceLockedQuantities(
 *     items, location, clientRates,
 *     pricingShadow.withShadow({ contingency_pct, ohp_pct }, { userId })
 *   );
 *   pricingShadow.record(db, priced, { userId, jobRef });
 *
 * Nothing here can break a quote. withShadow() returns the options object unchanged if
 * anything at all goes wrong, and record() swallows and logs its own failures. That
 * matters because shadow mode is on by default.
 */

const db = require('./database');
const shadowLog = require('./shadowLog');

let rateResolver;
try {
  rateResolver = require('./rateResolver');
} catch (e) {
  console.error('[PricingShadow] rateResolver unavailable — shadow mode disabled:', e.message);
}

/**
 * Add `resolveRate` to a pricing options object when shadow mode is on.
 *
 * Returns the options untouched when shadow mode is off, the resolver is unavailable, or
 * the client-rate read fails — in which case priceLockedQuantities behaves exactly as it
 * did before, with no shadow key on the result.
 */
function withShadow(options = {}, { userId } = {}) {
  try {
    if (!shadowLog.isEnabled() || !rateResolver) return options;
    const resolveRate = rateResolver.forUser(db, userId);
    if (!resolveRate) return options;
    return { ...options, resolveRate };
  } catch (e) {
    console.error('[PricingShadow] could not attach resolver:', e.message);
    return options;
  }
}

/**
 * Persist any mismatches from a priced result. A no-op when shadow mode was off, when the
 * resolver agreed on every line, or on any failure.
 *
 * @returns {number} rows written
 */
function record(database, priced, ctx = {}) {
  try {
    if (!priced || !priced.shadow) return 0;
    const written = shadowLog.recordMismatches(database || db, priced.shadow, {
      jobRef: ctx.jobRef,
      userId: ctx.userId,
      region: priced.location && priced.location.label,
      projectType: priced.project_type,
    });
    if (written > 0) {
      console.log(`[PricingShadow] ${written} resolver mismatch(es) on ${ctx.jobRef || 'a job'}`);
    }
    return written;
  } catch (e) {
    console.error('[PricingShadow] could not record mismatches:', e.message);
    return 0;
  }
}

module.exports = { withShadow, record };

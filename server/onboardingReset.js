// onboardingReset.js — put an account back to "not onboarded" so it can be
// done again, e.g. a South African client who onboarded while the portal was
// UK-only and answered UK questions with UK (£) rates.
//
// What a reset does:
//   - clears onboarding_completed_at / onboarding_skipped and stamps
//     onboarding_reset_at, which sends the user straight back into onboarding
//     on their next visit to the dashboard;
//   - deactivates the AI memories that onboarding wrote (source 'onboarding');
//   - deactivates personal rates written in a different currency from the
//     account's (a Rand account's £ / € rates). Rates already in the account's
//     currency are kept, and re-doing onboarding overwrites the ones it asks.
// Nothing is deleted: rows are set is_active = 0, so an admin can restore them.
// Earlier onboarding_submissions rows are kept as history.

const countries = require('./lib/countries');

// A unit carries its currency: '£/m2', '€/day', 'R/day'. The Rand test needs
// the R on its own so 'PER/day' or 'HR/day' is not read as Rand.
const OTHER_CURRENCY_UNITS = { GBP: /€|(^|[^A-Za-z])R\s*\//, EUR: /£|(^|[^A-Za-z])R\s*\//, ZAR: /[£€]/ };

function resetOnboarding(db, userId) {
  const user = db.prepare('SELECT id, country, region, country_name FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const currency = countries.countryForUser(user).currency;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET onboarding_completed_at = NULL, onboarding_skipped = 0,
                onboarding_reset_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(userId);

    let memories = 0;
    try {
      memories = db.prepare(`UPDATE user_memories SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                             WHERE user_id = ? AND source = 'onboarding' AND is_active = 1`).run(userId).changes;
    } catch (e) { /* memories table optional in tests */ }

    let rates = 0;
    const foreign = OTHER_CURRENCY_UNITS[currency];
    if (foreign) {
      const rows = db.prepare('SELECT id, unit FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
      const off = db.prepare('UPDATE client_rate_library SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const r of rows) if (foreign.test(r.unit || '')) { off.run(r.id); rates++; }
    }
    return { memories, rates };
  });
  const cleared = tx();
  return { userId, currency, memoriesCleared: cleared.memories, ratesCleared: cleared.rates };
}

module.exports = { resetOnboarding };

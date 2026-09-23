// userPricing.js — what the pricer needs to know about the person a job is
// priced for: their own confirmed rates and their country.
//
// Every pricing call site used to run the same client_rate_library query and
// build the map itself. They now call this, so a country rule lives in one
// place:
//
//   - A South African account prices in Rand, so any personal rate still
//     denominated in £ or € (UK defaults seeded at signup, rates entered while
//     the account was UK-adapted) is set aside rather than read as Rand.
//   - `skipMemoryRates` tells the caller not to blend in the shared memory
//     engine's learned rates, which are UK GBP figures.

const db = require('./database');
const countries = require('./lib/countries');

const FOREIGN_UNIT = { ZAR: /[£€]/ };

function userRow(userId) {
  try { return db.prepare('SELECT id, country, region, country_name FROM users WHERE id = ?').get(userId) || null; }
  catch (e) { return null; }
}

function pricingContext(userId, location) {
  const user = userRow(userId);
  const options = countries.pricingOptions(user, location || '');
  const currency = options.countryPricing ? options.countryPricing.currency : null;
  const foreign = currency && FOREIGN_UNIT[currency];
  const clientRates = {};
  try {
    const rows = db.prepare('SELECT item_key, value, unit FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
    for (const r of rows) {
      if (foreign && foreign.test(r.unit || '')) continue;
      clientRates[r.item_key] = r.value;
    }
  } catch (e) {}
  return { clientRates, pricingOptions: options, skipMemoryRates: !!currency, user };
}

module.exports = { pricingContext };

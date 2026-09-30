// Pricing preferences round-trip: the per-trade markup map lives in the client
// playbook next to ohp_pct / contingency_pct and comes back cleaned.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { getPricingPrefs, setPricingPrefs } = require('./playbooks');

test('trade_markup persists with ohp_pct and comes back normalised', () => {
  const db = new Database(':memory:');
  const uid = 'u1';
  assert.deepStrictEqual(getPricingPrefs(db, uid), { ohp_pct: 0, contingency_pct: 0, trade_markup: {} });

  let p = setPricingPrefs(db, uid, { ohp_pct: 20, trade_markup: { electrical: '10', 'Plumbing & Heating': 10, Bogus: 40 } });
  assert.strictEqual(p.ohp_pct, 20);
  assert.deepStrictEqual(p.trade_markup, { Electrical: 10, 'Plumbing & Heating': 10 });

  // Changing only the default leaves the map alone.
  p = setPricingPrefs(db, uid, { ohp_pct: 18 });
  assert.strictEqual(p.ohp_pct, 18);
  assert.deepStrictEqual(p.trade_markup, { Electrical: 10, 'Plumbing & Heating': 10 });

  // The map is replaced whole: a trade left out falls back to the default.
  p = setPricingPrefs(db, uid, { trade_markup: { Electrical: 12 } });
  assert.deepStrictEqual(p.trade_markup, { Electrical: 12 });

  // null clears every per-trade override.
  p = setPricingPrefs(db, uid, { trade_markup: null });
  assert.deepStrictEqual(p.trade_markup, {});
  assert.strictEqual(getPricingPrefs(db, uid).ohp_pct, 18);
});

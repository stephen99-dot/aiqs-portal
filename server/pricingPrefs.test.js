// Pricing preferences round-trip: the per-trade markup map lives in the client
// playbook next to ohp_pct / contingency_pct and comes back cleaned.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { getPricingPrefs, setPricingPrefs, setHouseRates, getPlaybook } = require('./playbooks');

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

test('house rates from onboarding land in the playbook without disturbing the margins', () => {
  const db = new Database(':memory:');
  // ensureSchema runs once per process, so a second in-memory database in
  // this file has to make the table itself.
  db.exec('CREATE TABLE client_playbooks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, playbook_json TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  const uid = 'u2';
  setPricingPrefs(db, uid, { ohp_pct: 12 });
  let r = setHouseRates(db, uid, { day: 360, hourly: 45, materials_markup: '15' });
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.rates, { day: 360, hourly: 45 });
  assert.strictEqual(r.materials_markup, 15);
  assert.strictEqual(getPricingPrefs(db, uid).ohp_pct, 12);
  const pb = getPlaybook(db, uid);
  assert.deepStrictEqual(pb.rates, { day: 360, hourly: 45 });
  assert.strictEqual(pb.materials_markup, 15);

  // Same answers again: nothing changes, no new version.
  const before = db.prepare('SELECT COUNT(*) AS c FROM client_playbooks WHERE user_id = ?').get(uid).c;
  r = setHouseRates(db, uid, { day: 360, hourly: 45, materials_markup: 15 });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM client_playbooks WHERE user_id = ?').get(uid).c, before);

  // Junk and blanks leave the stored values alone; a markup is clamped.
  r = setHouseRates(db, uid, { day: 'abc', hourly: -5, materials_markup: 250 });
  assert.deepStrictEqual(r.rates, { day: 360, hourly: 45 });
  assert.strictEqual(r.materials_markup, 100);
  assert.strictEqual(setHouseRates(db, uid, {}).changed, false);
});

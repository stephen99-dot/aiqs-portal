// Tests for tradeRates.saveTradeRates — the onboarding trade day-rates path.
//
// The properties that matter: rates land in client_rate_library in the same
// shape the My Rates page writes (so the pricer/chat pick them up), re-running
// onboarding updates rather than duplicates, and junk values never insert.
//
// In-memory database throughout — never the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { saveTradeRates, saveTradeItemRates, slugKey, DEFAULT_TRADE_DAY_RATES, CATEGORY } = require('./tradeRates');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE client_rate_library (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      item_key TEXT NOT NULL,
      display_name TEXT,
      value REAL,
      unit TEXT,
      confidence REAL DEFAULT 0.75,
      original_value REAL,
      client_note TEXT,
      times_applied INTEGER DEFAULT 0,
      times_confirmed INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

const all = (db, userId) =>
  db.prepare('SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1 ORDER BY item_key').all(userId);

test('saves each trade as a £/day rate in the labour category', () => {
  const db = freshDb();
  const { saved } = saveTradeRates(db, { userId: 'u1', rates: { 'Electrician': 360, 'Plumber / heating': 340 } });
  assert.strictEqual(saved, 2);

  const rows = all(db, 'u1');
  assert.strictEqual(rows.length, 2);
  const elec = rows.find(r => r.item_key === 'electrician_day');
  assert.ok(elec, 'expected electrician_day row');
  assert.strictEqual(elec.category, CATEGORY);
  assert.strictEqual(elec.value, 360);
  assert.strictEqual(elec.unit, '£/day');
  assert.strictEqual(elec.display_name, 'Electrician (Day Rate)');
  // Slash-and-space trade names collapse to the same slug the import path uses.
  assert.ok(rows.some(r => r.item_key === 'plumber_heating_day'));
});

test('re-running onboarding updates values instead of duplicating rows', () => {
  const db = freshDb();
  saveTradeRates(db, { userId: 'u1', rates: { 'Roofer': 300 } });
  const { saved } = saveTradeRates(db, { userId: 'u1', rates: { 'Roofer': 325 } });
  assert.strictEqual(saved, 1);

  const rows = all(db, 'u1');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].value, 325);
});

test('rejects junk without failing the batch', () => {
  const db = freshDb();
  const { saved } = saveTradeRates(db, {
    userId: 'u1',
    rates: { 'Electrician': 'abc', 'Roofer': 0, 'Plasterer': -50, 'Groundworker': 25000, '  ': 200, 'Tiler': 280 },
  });
  assert.strictEqual(saved, 1);
  const rows = all(db, 'u1');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item_key, 'tiler_day');
});

test('no rates, wrong shapes and missing user are safe no-ops', () => {
  const db = freshDb();
  assert.strictEqual(saveTradeRates(db, { userId: 'u1', rates: {} }).saved, 0);
  assert.strictEqual(saveTradeRates(db, { userId: 'u1', rates: null }).saved, 0);
  assert.strictEqual(saveTradeRates(db, { userId: 'u1', rates: [280, 300] }).saved, 0);
  assert.strictEqual(saveTradeRates(db, { userId: null, rates: { Roofer: 300 } }).saved, 0);
  assert.strictEqual(all(db, 'u1').length, 0);
});

test('rates are tenant-scoped — one user\'s save never touches another\'s row', () => {
  const db = freshDb();
  saveTradeRates(db, { userId: 'u1', rates: { 'Roofer': 300 } });
  saveTradeRates(db, { userId: 'u2', rates: { 'Roofer': 500 } });
  assert.strictEqual(all(db, 'u1')[0].value, 300);
  assert.strictEqual(all(db, 'u2')[0].value, 500);
});

test('default trade list is sane — every entry would save', () => {
  const db = freshDb();
  const { saved } = saveTradeRates(db, { userId: 'u1', rates: DEFAULT_TRADE_DAY_RATES });
  assert.strictEqual(saved, Object.keys(DEFAULT_TRADE_DAY_RATES).length);
});

test('rate-sheet items save with the catalogue label and unit under the trade category', () => {
  const db = freshDb();
  const { saved } = saveTradeItemRates(db, {
    userId: 'u1', trade: 'Electrician',
    values: { rewire_3bed: 4200, double_socket_installed: 85 },
  });
  assert.strictEqual(saved, 2);
  const rows = all(db, 'u1');
  const rewire = rows.find(r => r.item_key === 'rewire_3bed');
  assert.strictEqual(rewire.category, 'electrician');
  assert.strictEqual(rewire.value, 4200);
  assert.strictEqual(rewire.unit, '£/job');
  assert.strictEqual(rewire.display_name, 'Full rewire — 3-bed house');
  assert.strictEqual(rows.find(r => r.item_key === 'double_socket_installed').unit, '£/point');
});

test('rate-sheet blanks, junk and unknown keys are simply not saved', () => {
  const db = freshDb();
  const { saved } = saveTradeItemRates(db, {
    userId: 'u1', trade: 'Electrician',
    values: { rewire_3bed: '', eicr_3bed: 'abc', made_up_key: 500, downlight_fitted: -5 },
  });
  assert.strictEqual(saved, 0);
  assert.strictEqual(all(db, 'u1').length, 0);
});

test('rate-sheet re-submission updates values instead of duplicating', () => {
  const db = freshDb();
  saveTradeItemRates(db, { userId: 'u1', trade: 'Plasterer', values: { skim_walls_m2: 18 } });
  saveTradeItemRates(db, { userId: 'u1', trade: 'Plasterer', values: { skim_walls_m2: 20 } });
  const rows = all(db, 'u1');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].value, 20);
});

test('rate-sheet save is a no-op for a trade the catalogue does not know', () => {
  const db = freshDb();
  const { saved } = saveTradeItemRates(db, { userId: 'u1', trade: 'Thatcher', values: { anything: 100 } });
  assert.strictEqual(saved, 0);
});

test('slugKey matches the my-rates import slug rule', () => {
  assert.strictEqual(slugKey('Carpenter / joiner'), 'carpenter_joiner');
  assert.strictEqual(slugKey('  Plumber & Heating  '), 'plumber_heating');
});

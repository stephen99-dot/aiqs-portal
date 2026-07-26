// Tests for the price_evidence store and its backfill.
//
// Uses an in-memory database throughout: the backfill writes hundreds of rows and must
// never touch the developer's real data/ database to be tested.
//
// The properties that matter here are idempotency and tenant scoping. Idempotency
// because the backfill is meant to be safe on every boot — if it duplicated, 324 base
// rates would become 648 after one restart and every future median would be wrong.
// Tenant scoping because one builder's rates reaching another builder's quote is the
// kind of bug you only find out about from a customer.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const pe = require('./priceEvidence');
const { BASE_RATES } = require('./deterministicPricer');

// A database with just the tables the backfill reads, so each test starts clean.
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE client_rate_library (
      id TEXT PRIMARY KEY, user_id TEXT, category TEXT, item_key TEXT, display_name TEXT,
      value REAL, unit TEXT, confidence REAL, times_applied INTEGER, times_confirmed INTEGER,
      is_active INTEGER DEFAULT 1, updated_at TEXT
    );
    CREATE TABLE memory_rates (
      id TEXT PRIMARY KEY, scope TEXT, user_id TEXT, item_key TEXT, region TEXT,
      project_type TEXT, rate REAL, sample_count INTEGER, stddev REAL, confidence REAL,
      last_seen TEXT
    );
    CREATE TABLE rates (
      id TEXT PRIMARY KEY, code TEXT, trade TEXT, description TEXT, unit TEXT,
      labour_rate REAL, material_rate REAL, total_rate REAL, updated_at TEXT
    );
  `);
  pe.initEvidenceTables(db);
  return db;
}

function count(db, where = '', ...args) {
  return db.prepare(`SELECT COUNT(*) c FROM price_evidence ${where}`).get(...args).c;
}

test('initEvidenceTables is idempotent', () => {
  const db = freshDb();
  pe.initEvidenceTables(db);
  pe.initEvidenceTables(db);
  assert.strictEqual(count(db), 0, 'no rows created by DDL');
});

test('the base library backfills one row per rate key', () => {
  const db = freshDb();
  const stats = pe.backfill(db);
  assert.strictEqual(stats.base_library, Object.keys(BASE_RATES).length);
  assert.strictEqual(
    count(db, "WHERE source_type = 'base_library'"),
    Object.keys(BASE_RATES).length,
    'every library key is represented'
  );
  const brick = db.prepare(
    "SELECT * FROM price_evidence WHERE item_key = 'brick_outer_leaf' AND source_type = 'base_library'"
  ).get();
  assert.strictEqual(brick.value, BASE_RATES.brick_outer_leaf.rate);
  assert.strictEqual(brick.unit, BASE_RATES.brick_outer_leaf.unit);
  assert.strictEqual(brick.user_id, null, 'the library is not builder-specific');
  assert.strictEqual(brick.sample_weight, pe.SOURCE_WEIGHTS.base_library);
  assert.ok(JSON.parse(brick.raw_json).labour > 0, 'labour/materials split preserved');
});

test('backfill is idempotent — running it twice adds nothing', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO client_rate_library
    (id,user_id,item_key,display_name,value,unit,is_active,updated_at)
    VALUES ('c1','u1','brick_outer_leaf','Facing brick',95,'m²',1,'2026-01-01')`).run();
  db.prepare(`INSERT INTO rates
    (id,code,trade,description,unit,labour_rate,material_rate,total_rate)
    VALUES ('r1','GW-001','Groundworks','Reduce level excavation','m³',8.5,0,8.5)`).run();

  const first = pe.backfill(db);
  const total = count(db);
  const second = pe.backfill(db);

  assert.strictEqual(count(db), total, 'second run added no rows');
  for (const source of Object.keys(second)) {
    assert.strictEqual(second[source], 0, `${source} re-inserted rows on the second pass`);
  }
  assert.ok(first.base_library > 300, 'the first pass really did insert');
});

test('a changed value is a NEW observation, not an overwrite', () => {
  // The store is append-only on purpose: the history of what a rate was is the data.
  const db = freshDb();
  pe.record(db, {
    item_key: 'x', canonical_desc: 'x', unit: 'm²', value: 50,
    source_type: 'client_library', source_ref: 'ref1', user_id: 'u1',
  });
  pe.record(db, {
    item_key: 'x', canonical_desc: 'x', unit: 'm²', value: 60,
    source_type: 'client_library', source_ref: 'ref1', user_id: 'u1',
  });
  assert.strictEqual(count(db, "WHERE item_key = 'x'"), 2, 'both observations kept');
});

test('re-recording an identical observation is a no-op', () => {
  const db = freshDb();
  const obs = {
    item_key: 'y', canonical_desc: 'y', unit: 'm²', value: 50,
    source_type: 'client_library', source_ref: 'ref1', user_id: 'u1',
  };
  const a = pe.record(db, obs);
  const b = pe.record(db, obs);
  assert.strictEqual(a.inserted, true);
  assert.strictEqual(b.inserted, false, 'the duplicate was ignored');
  assert.strictEqual(a.id, b.id, 'same content produces the same id');
  assert.strictEqual(count(db, "WHERE item_key = 'y'"), 1);
});

test('client rates land against their builder, with the right weight', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO client_rate_library
    (id,user_id,item_key,display_name,value,unit,confidence,times_confirmed,is_active,updated_at)
    VALUES ('c1','builder-1','brick_outer_leaf','Facing brick',95,'m²',0.9,3,1,'2026-03-01')`).run();
  const stats = pe.backfill(db);
  assert.strictEqual(stats.client_library, 1);
  const row = db.prepare("SELECT * FROM price_evidence WHERE source_type='client_library'").get();
  assert.strictEqual(row.user_id, 'builder-1');
  assert.strictEqual(row.value, 95);
  assert.strictEqual(row.sample_weight, pe.SOURCE_WEIGHTS.client_library);
  assert.strictEqual(row.observed_at, '2026-03-01', 'the source timestamp is preserved');
});

test('inactive client rates are not backfilled', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO client_rate_library
    (id,user_id,item_key,value,unit,is_active) VALUES ('c1','u1','k',95,'m²',0)`).run();
  const stats = pe.backfill(db);
  assert.strictEqual(stats.client_library, 0, 'a deactivated rate is not evidence');
});

test('memory_rates keeps global rows anonymous and client rows attributed', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO memory_rates
    (id,scope,user_id,item_key,region,project_type,rate,sample_count,stddev,confidence,last_seen)
    VALUES ('m1','global','u1','k1','north_west','extension',88,6,3.2,0.7,'2026-02-01')`).run();
  db.prepare(`INSERT INTO memory_rates
    (id,scope,user_id,item_key,region,project_type,rate,sample_count,stddev,confidence,last_seen)
    VALUES ('m2','client','u1','k2','wales','refurbishment',77,4,2.1,0.6,'2026-02-02')`).run();

  pe.backfill(db);
  const global = db.prepare("SELECT * FROM price_evidence WHERE source_ref='memory_rates:m1'").get();
  const client = db.prepare("SELECT * FROM price_evidence WHERE source_ref='memory_rates:m2'").get();

  assert.strictEqual(global.user_id, null, "scope='global' must not be attributed to a builder");
  assert.strictEqual(client.user_id, 'u1', "scope='client' keeps its builder");
  assert.strictEqual(client.region, 'wales', 'region carried through');
  assert.strictEqual(client.project_type, 'refurbishment', 'project type carried through');
  assert.strictEqual(JSON.parse(client.raw_json).sample_count, 4);
});

test('the seeded rates table lands unmapped but searchable', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO rates
    (id,code,trade,description,unit,labour_rate,material_rate,total_rate)
    VALUES ('r1','GW-001','Groundworks','Reduce level excavation (machine)','m³',8.5,0,8.5)`).run();
  const stats = pe.backfill(db);
  assert.strictEqual(stats.rate_book_local, 1);
  const row = db.prepare("SELECT * FROM price_evidence WHERE source_type='rate_book_local'").get();
  assert.strictEqual(row.item_key, null, 'no canonical key yet — mapping is a later phase');
  assert.strictEqual(row.canonical_desc, 'Reduce level excavation (machine)');
  assert.strictEqual(row.value, 8.5);
  assert.strictEqual(JSON.parse(row.raw_json).code, 'GW-001', 'the code is retained for mapping later');
});

test('zero and null rates are not recorded as evidence', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO rates (id,code,trade,description,unit,total_rate)
    VALUES ('r1','X','T','zero rate','m²',0)`).run();
  db.prepare(`INSERT INTO rates (id,code,trade,description,unit,total_rate)
    VALUES ('r2','Y','T','null rate','m²',NULL)`).run();
  db.prepare(`INSERT INTO client_rate_library (id,user_id,item_key,value,unit,is_active)
    VALUES ('c1','u1','k',NULL,'m²',1)`).run();
  const stats = pe.backfill(db);
  assert.strictEqual(stats.rate_book_local, 0, 'a zero or null rate is not a price');
  assert.strictEqual(stats.client_library, 0);
});

test('forKey never leaks one builder evidence to another', () => {
  const db = freshDb();
  pe.record(db, { item_key: 'k', canonical_desc: 'k', unit: 'm²', value: 80, source_type: 'base_library' });
  pe.record(db, { item_key: 'k', canonical_desc: 'k', unit: 'm²', value: 95, source_type: 'client_library', user_id: 'u1' });
  pe.record(db, { item_key: 'k', canonical_desc: 'k', unit: 'm²', value: 70, source_type: 'client_library', user_id: 'u2' });

  const asU1 = pe.forKey(db, { itemKey: 'k', userId: 'u1' });
  const asU2 = pe.forKey(db, { itemKey: 'k', userId: 'u2' });
  const anon = pe.forKey(db, { itemKey: 'k' });

  assert.deepStrictEqual(asU1.map(r => r.value).sort(), [80, 95], 'u1 sees shared + its own');
  assert.deepStrictEqual(asU2.map(r => r.value).sort(), [70, 80], 'u2 sees shared + its own');
  assert.deepStrictEqual(anon.map(r => r.value), [80], 'anonymous sees only shared');
  for (const rows of [asU1, asU2]) {
    assert.ok(!rows.some(r => r.user_id && r.user_id !== rows.find(x => x.user_id)?.user_id),
      'no foreign builder rows present');
  }
});

test('forKey returns best-weighted evidence first', () => {
  const db = freshDb();
  pe.record(db, { item_key: 'k', canonical_desc: 'k', unit: 'm²', value: 80, source_type: 'base_library' });
  pe.record(db, { item_key: 'k', canonical_desc: 'k', unit: 'm²', value: 90, source_type: 'own_history' });
  pe.record(db, { item_key: 'k', canonical_desc: 'k', unit: 'm²', value: 99, source_type: 'invoice_paid' });
  const rows = pe.forKey(db, { itemKey: 'k' });
  assert.deepStrictEqual(rows.map(r => r.source_type), ['invoice_paid', 'own_history', 'base_library'],
    'what was actually paid outranks history, which outranks the generic library');
});

test('a missing source table does not abort the rest of the backfill', () => {
  const db = new Database(':memory:');
  pe.initEvidenceTables(db);   // no client_rate_library / memory_rates / rates at all
  const stats = pe.backfill(db);
  assert.strictEqual(stats.base_library, Object.keys(BASE_RATES).length,
    'the library still backfills when the other sources are absent');
  assert.ok(String(stats.client_library).startsWith('error:'), 'the missing table is reported, not thrown');
});

test('summary reports what was actually stored', () => {
  const db = freshDb();
  pe.backfill(db);
  const s = pe.summary(db);
  assert.strictEqual(s.total, count(db));
  const base = s.by_source.find(r => r.source_type === 'base_library');
  assert.strictEqual(base.rows, Object.keys(BASE_RATES).length);
  assert.strictEqual(base.mapped_keys, Object.keys(BASE_RATES).length, 'library rows are all mapped');
});

test('source weights are ordered so paid facts outrank opinions', () => {
  const w = pe.SOURCE_WEIGHTS;
  assert.ok(w.final_account > w.invoice_paid, 'the final account is the strongest evidence');
  assert.ok(w.invoice_paid > w.subbie_quote, 'paid beats quoted');
  assert.ok(w.subbie_quote > w.own_history);
  assert.ok(w.own_history > w.client_library);
  assert.ok(w.client_library > w.base_library, "a builder's own rate beats a generic one");
  assert.ok(w.base_library > w.model_estimate, 'a curated rate beats a guess');
  assert.ok(w.model_estimate <= 0.25, 'the model can never be authoritative on its own');
});

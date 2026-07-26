// Tests for the resolver shadow log.
//
// The log's job is to answer one question across many jobs: which item keys does
// rateResolver get wrong, and how much money do they represent? So the properties under
// test are that it ranks by money rather than frequency, that re-pricing the same job
// does not inflate the counts, and that it cannot throw — it runs on the pricing path by
// default, so a failure here must degrade to "no diagnostics", never to a failed quote.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const shadowLog = require('./shadowLog');
const { priceLockedQuantities } = require('./deterministicPricer');
const { resolveRate } = require('./rateResolver');

function freshDb() {
  const db = new Database(':memory:');
  shadowLog.initShadowTables(db);
  return db;
}

const shadowOf = (mismatches) => ({ compared: mismatches.length, matched: 0, errors: 0, mismatches });

const MISMATCH = (over) => ({
  key: 'k', unit: 'm²', qty: 10,
  pricer_rate: 100, resolver_rate: 110,
  pricer_source: 'base_library', resolver_basis: 'composite',
  delta_pct: 10, value_at_risk: 100,
  ...over,
});

test('shadow mode is on unless explicitly disabled', () => {
  const original = process.env.RATE_RESOLVER_SHADOW;
  try {
    delete process.env.RATE_RESOLVER_SHADOW;
    assert.strictEqual(shadowLog.isEnabled(), true, 'unset means on');
    process.env.RATE_RESOLVER_SHADOW = '1';
    assert.strictEqual(shadowLog.isEnabled(), true);
    process.env.RATE_RESOLVER_SHADOW = 'yes';
    assert.strictEqual(shadowLog.isEnabled(), true, 'only "0" turns it off');
    process.env.RATE_RESOLVER_SHADOW = '0';
    assert.strictEqual(shadowLog.isEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.RATE_RESOLVER_SHADOW;
    else process.env.RATE_RESOLVER_SHADOW = original;
  }
});

test('initShadowTables is idempotent', () => {
  const db = freshDb();
  shadowLog.initShadowTables(db);
  shadowLog.initShadowTables(db);
  assert.strictEqual(shadowLog.report(db).totals.mismatches, 0);
});

test('a matching job writes nothing', () => {
  const db = freshDb();
  assert.strictEqual(shadowLog.recordMismatches(db, shadowOf([])), 0);
  assert.strictEqual(shadowLog.recordMismatches(db, { compared: 5, matched: 5, mismatches: [] }), 0);
  assert.strictEqual(shadowLog.recordMismatches(db, null), 0, 'a missing shadow block is not an error');
  assert.strictEqual(shadowLog.recordMismatches(db, {}), 0);
  assert.strictEqual(shadowLog.report(db).totals.mismatches, 0, 'confirmations are not stored');
});

test('re-pricing the same job does not inflate the log', () => {
  // The portal re-prices a job on every recalc. Without content-addressed ids one
  // divergence would look like twenty.
  const db = freshDb();
  const shadow = shadowOf([MISMATCH()]);
  shadowLog.recordMismatches(db, shadow, { jobRef: 'job-1' });
  shadowLog.recordMismatches(db, shadow, { jobRef: 'job-1' });
  shadowLog.recordMismatches(db, shadow, { jobRef: 'job-1' });
  assert.strictEqual(shadowLog.report(db).totals.mismatches, 1, 'recorded once');
});

test('re-recording preserves the ORIGINAL seen_at', () => {
  // INSERT OR IGNORE, not OR REPLACE. A re-price must not stamp the row with today's
  // date: since_days windows and "when did this start?" both depend on first-seen, and
  // a job re-priced daily would otherwise look permanently new.
  const db = freshDb();
  const shadow = shadowOf([MISMATCH()]);
  shadowLog.recordMismatches(db, shadow, { jobRef: 'job-1' });
  db.prepare("UPDATE resolver_shadow_log SET seen_at = '2020-01-01 00:00:00'").run();
  shadowLog.recordMismatches(db, shadow, { jobRef: 'job-1' });
  const row = db.prepare('SELECT seen_at FROM resolver_shadow_log').get();
  assert.strictEqual(row.seen_at, '2020-01-01 00:00:00', 'first-seen survives a re-price');
});

test('a genuinely different divergence on the same job is a new row', () => {
  const db = freshDb();
  shadowLog.recordMismatches(db, shadowOf([MISMATCH({ resolver_rate: 110 })]), { jobRef: 'job-1' });
  shadowLog.recordMismatches(db, shadowOf([MISMATCH({ resolver_rate: 130 })]), { jobRef: 'job-1' });
  assert.strictEqual(shadowLog.report(db).totals.mismatches, 2, 'a changed divergence is new information');
});

test('the same key diverging on two jobs is counted twice', () => {
  const db = freshDb();
  shadowLog.recordMismatches(db, shadowOf([MISMATCH()]), { jobRef: 'job-1' });
  shadowLog.recordMismatches(db, shadowOf([MISMATCH()]), { jobRef: 'job-2' });
  const r = shadowLog.report(db);
  assert.strictEqual(r.totals.mismatches, 2);
  assert.strictEqual(r.totals.jobs_affected, 2);
  assert.strictEqual(r.by_key[0].occurrences, 2, 'grouped under one key');
});

test('the report ranks by money at risk, not by how often it happens', () => {
  const db = freshDb();
  // A small divergence on a big package, against a large one on a trivial line.
  shadowLog.recordMismatches(db, shadowOf([
    MISMATCH({ key: 'big_package', qty: 1, pricer_rate: 40000, resolver_rate: 40800, delta_pct: 2, value_at_risk: 800 }),
  ]), { jobRef: 'job-1' });
  for (let i = 0; i < 5; i++) {
    shadowLog.recordMismatches(db, shadowOf([
      MISMATCH({ key: 'trivial_line', qty: 1, pricer_rate: 30, resolver_rate: 45, delta_pct: 50, value_at_risk: 15 }),
    ]), { jobRef: `job-${i + 2}` });
  }
  const r = shadowLog.report(db);
  assert.strictEqual(r.by_key[0].item_key, 'big_package',
    'the £800 divergence outranks five £15 ones, despite being rarer');
  assert.strictEqual(r.by_key[1].item_key, 'trivial_line');
  assert.strictEqual(r.by_key[1].occurrences, 5);
});

test('the report carries the context needed to diagnose a divergence', () => {
  const db = freshDb();
  shadowLog.recordMismatches(db, shadowOf([MISMATCH()]), {
    jobRef: 'job-1', userId: 'u1', region: 'North West', projectType: 'extension',
  });
  const row = db.prepare('SELECT * FROM resolver_shadow_log').get();
  assert.strictEqual(row.item_key, 'k');
  assert.strictEqual(row.pricer_source, 'base_library');
  assert.strictEqual(row.resolver_basis, 'composite');
  assert.strictEqual(row.region, 'North West');
  assert.strictEqual(row.project_type, 'extension');
  assert.strictEqual(row.user_id, 'u1');
  assert.ok(row.seen_at, 'timestamped');

  const r = shadowLog.report(db);
  assert.ok(r.by_key[0].pricer_sources.includes('base_library'), 'sources surfaced in the report');
  assert.ok(r.by_key[0].resolver_bases.includes('composite'));
});

test('a non-finite resolver rate is stored as null rather than corrupting the log', () => {
  const db = freshDb();
  shadowLog.recordMismatches(db, shadowOf([
    MISMATCH({ resolver_rate: NaN, delta_pct: NaN, value_at_risk: NaN }),
  ]), { jobRef: 'job-1' });
  const row = db.prepare('SELECT * FROM resolver_shadow_log').get();
  assert.strictEqual(row.resolver_rate, null);
  assert.strictEqual(row.delta_pct, null);
  assert.strictEqual(row.value_at_risk, 0, 'unrankable divergences sort last rather than breaking SUM');
  assert.ok(Number.isFinite(shadowLog.report(db).totals.total_value_at_risk));
});

test('clear empties the log', () => {
  const db = freshDb();
  shadowLog.recordMismatches(db, shadowOf([MISMATCH()]), { jobRef: 'job-1' });
  assert.strictEqual(shadowLog.clear(db), 1);
  assert.strictEqual(shadowLog.report(db).totals.mismatches, 0);
});

test('nothing throws when the database is unusable', () => {
  // Diagnostics must never be able to break a quote.
  const broken = { prepare() { throw new Error('database is gone'); }, exec() { throw new Error('database is gone'); } };
  assert.strictEqual(shadowLog.recordMismatches(broken, shadowOf([MISMATCH()]), {}), 0);
  assert.strictEqual(shadowLog.clear(broken), 0);
  const r = shadowLog.report(broken);
  assert.ok(r.error, 'the failure is reported');
  assert.deepStrictEqual(r.by_key, [], 'and degrades to an empty report');
});

test('since_days narrows the window', () => {
  const db = freshDb();
  shadowLog.recordMismatches(db, shadowOf([MISMATCH()]), { jobRef: 'job-1' });
  db.prepare("UPDATE resolver_shadow_log SET seen_at = datetime('now','-30 days')").run();
  shadowLog.recordMismatches(db, shadowOf([MISMATCH({ key: 'recent' })]), { jobRef: 'job-2' });
  assert.strictEqual(shadowLog.report(db, { sinceDays: 7 }).totals.mismatches, 1, 'only the recent one');
  assert.strictEqual(shadowLog.report(db).totals.mismatches, 2, 'both without a window');
});

test('end to end: the real resolver logs nothing on a realistic job', () => {
  // The Phase 1 success criterion. If this ever starts writing rows, the resolver has
  // diverged from the shipping ladder and the report names exactly where.
  const db = freshDb();
  const items = () => ([
    { key: 'brick_outer_leaf', qty: 120, unit: 'm²' },
    { key: 'blockwork_inner_leaf_100mm', qty: 120, unit: 'm²' },
    { key: 'concrete_slab_150mm', qty: 60, unit: 'm²' },
    { key: 'roof_tiles_interlocking', qty: 80, unit: 'm²' },
    { key: 'scaffolding', qty: 200, unit: 'm²' },
    { key: 'plasterboard_skim_walls', qty: 200, unit: 'm²' },
    { key: 'kitchen_fitout_mid', qty: 1, unit: 'Nr' },
    { key: 'odd_bespoke_thing', qty: 2, unit: 'Nr', description: 'bespoke curved oak screen' },
  ]);
  for (const region of ['Manchester', 'London SW1A 1AA', 'Cardiff', 'Dublin', 'Swansea']) {
    const priced = priceLockedQuantities(items(), region, { scaffolding: 24 },
      { contingency_pct: 5, ohp_pct: 15, resolveRate });
    shadowLog.recordMismatches(db, priced.shadow, { jobRef: `job-${region}` });
  }
  const r = shadowLog.report(db);
  assert.strictEqual(r.totals.mismatches, 0,
    `resolver diverged: ${JSON.stringify(r.by_key, null, 2)}`);
});

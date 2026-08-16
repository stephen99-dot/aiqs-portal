// Tests for the Super Brain — the cross-app knowledge exchange.
//
// Two properties matter most here:
//   1. Anonymisation: the export pack must never carry user ids, memory text,
//      entity names or any per-account identifier. It is aggregates only.
//   2. Isolation: an imported pack lands in brain_shared_* tables and nowhere
//      else — it must never write into memory_rates or anything a live
//      pricing path reads.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const memoryEngine = require('./memoryEngine');
const superBrain = require('./superBrain');

function freshDb() {
  const db = new Database(':memory:');
  memoryEngine.initMemoryTables(db);
  superBrain.ensureSchema(db);
  return db;
}

function seedKnowledge(db) {
  memoryEngine.recordRate(db, {
    itemKey: 'brick_cavity_wall', rate: 245, region: 'south_east',
    projectType: 'extension', userId: 'user-alpha', source: 'confirmed_boq',
  });
  memoryEngine.recordRate(db, {
    itemKey: 'brick_cavity_wall', rate: 255, region: 'south_east',
    projectType: 'extension', userId: 'user-beta', source: 'confirmed_boq',
  });
  db.prepare(`
    INSERT INTO memory_quantities (id, project_type, item_key, unit, floor_area_m2, qty, qty_per_m2, confirmed)
    VALUES ('q1', 'extension', 'floor_screed', 'm2', 30, 30, 1.0, 1)`).run();
  db.prepare(`
    INSERT INTO memory_patterns (id, item_key_a, item_key_b, co_occurrence_count, project_type)
    VALUES ('p1', 'excavation', 'muck_away', 4, 'extension')`).run();
}

test('export pack aggregates rates and carries no per-user identifiers', () => {
  const db = freshDb();
  seedKnowledge(db);

  const pack = superBrain.exportPack(db);
  assert.strictEqual(pack.version, superBrain.PACK_VERSION);
  assert.strictEqual(pack.source, superBrain.APP_ID);
  assert.ok(pack.rates.length >= 1);
  assert.strictEqual(pack.quantities.length, 1);
  assert.strictEqual(pack.patterns.length, 1);

  // Two users' rates collapse into one anonymous aggregate row.
  const wall = pack.rates.filter(r => r.item_key === 'brick_cavity_wall' && r.region === 'south_east');
  assert.strictEqual(wall.length, 1);
  assert.ok(wall[0].rate >= 245 && wall[0].rate <= 255);
  assert.ok(wall[0].sample_count >= 2);

  const raw = JSON.stringify(pack);
  assert.ok(!raw.includes('user_id'), 'pack must not contain user_id fields');
  assert.ok(!raw.includes('user-alpha') && !raw.includes('user-beta'), 'pack must not contain user ids');
});

test('import stores the pack in shared tables only, and sync log records it', () => {
  const source = freshDb();
  seedKnowledge(source);
  const pack = { ...superBrain.exportPack(source), source: 'aitradespilot' };

  const target = freshDb();
  const before = target.prepare('SELECT COUNT(*) AS n FROM memory_rates').get().n;

  const result = superBrain.importPack(target, pack, { via: 'pull' });
  assert.strictEqual(result.source, 'aitradespilot');
  assert.ok(result.imported.rates >= 1);
  assert.strictEqual(result.imported.quantities, 1);
  assert.strictEqual(result.imported.patterns, 1);

  // Isolation: memory_rates untouched.
  assert.strictEqual(target.prepare('SELECT COUNT(*) AS n FROM memory_rates').get().n, before);
  assert.strictEqual(
    target.prepare('SELECT COUNT(*) AS n FROM brain_shared_rates WHERE source_app = ?').get('aitradespilot').n,
    result.imported.rates
  );

  const log = target.prepare('SELECT * FROM brain_sync_log ORDER BY created_at DESC').get();
  assert.strictEqual(log.direction, 'in');
  assert.strictEqual(log.peer_app, 'aitradespilot');
  assert.strictEqual(log.via, 'pull');
});

test('re-importing replaces the peer photograph instead of accumulating', () => {
  const source = freshDb();
  seedKnowledge(source);
  const pack = { ...superBrain.exportPack(source), source: 'aitradespilot' };

  const target = freshDb();
  superBrain.importPack(target, pack);
  const first = target.prepare('SELECT COUNT(*) AS n FROM brain_shared_rates').get().n;
  superBrain.importPack(target, pack);
  const second = target.prepare('SELECT COUNT(*) AS n FROM brain_shared_rates').get().n;
  assert.strictEqual(first, second);
});

test('import rejects its own app, bad versions and junk rows', () => {
  const db = freshDb();
  assert.throws(() => superBrain.importPack(db, { version: 99, source: 'x', rates: [] }), /version/);
  assert.throws(() => superBrain.importPack(db, { version: 1, source: superBrain.APP_ID, rates: [] }), /same app/);
  assert.throws(() => superBrain.importPack(db, null), /pack/i);

  const result = superBrain.importPack(db, {
    version: 1, source: 'aitradespilot',
    rates: [
      { item_key: 'good_item', region: 'wales', project_type: 'any', rate: 100, sample_count: 3, confidence: 0.7 },
      { item_key: 'bad_rate', rate: -5 },
      { rate: 50 }, // no item_key
    ],
    quantities: [{ project_type: 'extension', item_key: 'x', avg_qty_per_m2: 0 }],
    patterns: [{ item_key_a: 'a' }], // missing b
  });
  assert.deepStrictEqual(result.imported, { rates: 1, quantities: 0, patterns: 0 });
});

test('recallSharedRate prefers exact region and project type matches', () => {
  const db = freshDb();
  superBrain.importPack(db, {
    version: 1, source: 'aitradespilot',
    rates: [
      { item_key: 'roof_tiling', region: 'uk_average', project_type: 'any', rate: 80, sample_count: 10 },
      { item_key: 'roof_tiling', region: 'london', project_type: 'extension', rate: 96, sample_count: 3 },
    ],
  });
  const hits = superBrain.recallSharedRate(db, { itemKey: 'roof_tiling', region: 'london', projectType: 'extension' });
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].rate, 96);
  assert.strictEqual(superBrain.recallSharedRate(db, { itemKey: 'nope' }).length, 0);
});

test('formatSharedKnowledgeForPrompt is empty without shared data, advisory with it', () => {
  const db = freshDb();
  assert.strictEqual(superBrain.formatSharedKnowledgeForPrompt(db, {}), '');

  superBrain.importPack(db, {
    version: 1, source: 'aitradespilot',
    rates: [
      { item_key: 'roof_tiling', region: 'london', project_type: 'extension', rate: 96, sample_count: 3, confidence: 0.6 },
      { item_key: 'roof_tiling', region: 'scotland', project_type: 'extension', rate: 70, sample_count: 5, confidence: 0.6 },
    ],
    patterns: [{ item_key_a: 'excavation', item_key_b: 'muck_away', project_type: 'extension', co_occurrence_count: 4 }],
  });

  const block = superBrain.formatSharedKnowledgeForPrompt(db, { region: 'london', projectType: 'extension' });
  assert.ok(block.includes('CROSS-APP ADVISORY'));
  assert.ok(block.includes('NEVER price from this'));
  assert.ok(block.includes('roof_tiling: ~£96.00'));
  assert.ok(!block.includes('£70.00'), 'other regions must be filtered out');
  assert.ok(block.includes('excavation → muck_away'));
});

test('buildMemoryContext carries the cross-app advisory block', () => {
  const db = freshDb();
  superBrain.importPack(db, {
    version: 1, source: 'aitradespilot',
    rates: [{ item_key: 'roof_tiling', region: 'uk_average', project_type: 'any', rate: 80, sample_count: 10, confidence: 0.7 }],
  });
  const ctx = memoryEngine.buildMemoryContext(db, {
    userId: 'user-alpha', projectType: 'extension', region: 'uk_average',
  });
  assert.ok(ctx.includes('CROSS-APP ADVISORY'));
  assert.ok(ctx.includes('roof_tiling'));

  // And without shared knowledge the block stays out entirely.
  const empty = freshDb();
  const ctx2 = memoryEngine.buildMemoryContext(empty, {
    userId: 'user-alpha', projectType: 'extension', region: 'uk_average',
  });
  assert.ok(!ctx2.includes('CROSS-APP ADVISORY'));
});

test('snapshot reports layers, the shared layer and recent learnings', () => {
  const db = freshDb();
  seedKnowledge(db);
  const source = freshDb();
  seedKnowledge(source);
  superBrain.importPack(db, { ...superBrain.exportPack(source), source: 'aitradespilot' });

  const snap = superBrain.snapshot(db);
  assert.ok(snap.totalKnowledge > 0);
  const keys = snap.layers.map(l => l.key);
  assert.ok(keys.includes('rates') && keys.includes('quantities') && keys.includes('patterns'));
  assert.strictEqual(snap.shared.length, 1);
  assert.strictEqual(snap.shared[0].source_app, 'aitradespilot');
  assert.ok(snap.recentLearnings.length > 0);
  assert.ok(snap.lastSync && snap.lastSync.direction === 'in');
});

// Tests for the delivery gate.
//
// The bug this closes: a job priced 76% from estimateFallbackRate's keyword guesses used
// to reach a client looking exactly like one priced entirely from known rates. The
// transition that marks a project delivered was literally
//
//     SET status = CASE WHEN status IN ('completed','delivered') THEN 'delivered'
//                  ELSE 'delivered' END
//
// — unconditional — and needs_admin_review was written in agenticTakeoff and read
// nowhere. Nothing looked at the price before it went out.
//
// The gate logic is duplicated here rather than imported because it lives inside
// deliverableRoutes, which pulls in express, multer and the real database on require.
// The duplication is deliberate and the last test pins the two together: it asserts the
// source of deliverableRoutes still contains the three decisions this file models, so the
// copy cannot silently drift from the original.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { assessPricingConfidence, priceLockedQuantities } = require('./deterministicPricer');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, user_id TEXT, title TEXT, status TEXT,
      pricing_confidence TEXT, pricing_reviewed_at DATETIME, pricing_reviewed_by TEXT
    );
  `);
  return db;
}

// Mirrors assessDeliveryGate in deliverableRoutes.js.
function assessDeliveryGate(db, projectId) {
  try {
    const row = db.prepare(
      'SELECT pricing_confidence, pricing_reviewed_at FROM projects WHERE id = ?'
    ).get(projectId);
    if (!row || !row.pricing_confidence) return { blocked: false, reason: 'no assessment recorded' };
    if (row.pricing_reviewed_at) return { blocked: false, reason: 'signed off by a human' };
    const conf = JSON.parse(row.pricing_confidence);
    if (conf.level !== 'blocked') return { blocked: false, level: conf.level };
    return { blocked: true, level: conf.level, reason: `${conf.estimated_pct}% of the value is estimated`, confidence: conf };
  } catch (e) {
    return { blocked: false, reason: 'gate error, failing open' };
  }
}

const addProject = (db, id, confidence, reviewedAt = null) =>
  db.prepare('INSERT INTO projects (id,user_id,status,pricing_confidence,pricing_reviewed_at) VALUES (?,?,?,?,?)')
    .run(id, 'u1', 'completed', confidence ? JSON.stringify(confidence) : null, reviewedAt);

test('a job priced from known rates delivers', () => {
  const db = freshDb();
  addProject(db, 'p1', assessPricingConfidence([
    { total: 10000, rate_source: 'base_library', unit: 'm²' },
  ]));
  assert.strictEqual(assessDeliveryGate(db, 'p1').blocked, false);
});

test('a job that is mostly guesswork is held back', () => {
  const db = freshDb();
  addProject(db, 'p1', assessPricingConfidence([
    { total: 1000, rate_source: 'base_library', unit: 'm²' },
    { total: 9000, rate_source: 'fallback_estimated', unit: 'm²' },
  ]));
  const gate = assessDeliveryGate(db, 'p1');
  assert.strictEqual(gate.blocked, true);
  assert.match(gate.reason, /90% of the value is estimated/);
  assert.ok(gate.confidence.flagged_lines.length > 0, 'the offending lines come back with it');
});

test('a large guessed lump sum is held back even on a mostly-known job', () => {
  const db = freshDb();
  addProject(db, 'p1', assessPricingConfidence([
    { total: 200000, rate_source: 'base_library', unit: 'm²' },
    { key: 'pool_shell', total: 12000, rate_source: 'fallback_estimated', unit: 'Item' },
  ]));
  assert.strictEqual(assessDeliveryGate(db, 'p1').blocked, true,
    'nothing bounds how wrong a guessed lump sum can be, so it must not go out unseen');
});

test('a human sign-off clears the gate', () => {
  const db = freshDb();
  const conf = assessPricingConfidence([
    { total: 1000, rate_source: 'base_library', unit: 'm²' },
    { total: 9000, rate_source: 'fallback_estimated', unit: 'm²' },
  ]);
  addProject(db, 'p1', conf);
  assert.strictEqual(assessDeliveryGate(db, 'p1').blocked, true);

  db.prepare("UPDATE projects SET pricing_reviewed_at = CURRENT_TIMESTAMP, pricing_reviewed_by = 'qs@example.com' WHERE id = 'p1'").run();

  const after = assessDeliveryGate(db, 'p1');
  assert.strictEqual(after.blocked, false);
  assert.match(after.reason, /signed off/);
  assert.strictEqual(
    db.prepare("SELECT pricing_reviewed_by AS b FROM projects WHERE id='p1'").get().b,
    'qs@example.com',
    'who signed it off is recorded — that is the question asked when a job goes wrong'
  );
});

test('the gate fails OPEN on projects with no assessment', () => {
  // Every project created before this column existed has none, and all of them are fine.
  // A gate that stranded them would be worse than the problem it solves.
  const db = freshDb();
  addProject(db, 'p1', null);
  assert.strictEqual(assessDeliveryGate(db, 'p1').blocked, false);
  assert.strictEqual(assessDeliveryGate(db, 'does-not-exist').blocked, false);
});

test('the gate fails OPEN on a corrupt assessment rather than stranding the job', () => {
  const db = freshDb();
  db.prepare("INSERT INTO projects (id,user_id,status,pricing_confidence) VALUES ('p1','u1','completed','not json{')").run();
  assert.strictEqual(assessDeliveryGate(db, 'p1').blocked, false);
});

test('a review-level job still delivers — only a block holds it', () => {
  // 'review' means worth a look, not worth stopping. Blocking on it would train people to
  // click through, which is how a gate stops working.
  const db = freshDb();
  addProject(db, 'p1', assessPricingConfidence([
    { total: 100000, rate_source: 'base_library', unit: 'm²' },
    { total: 6000, rate_source: 'fallback_estimated', unit: 'm²' },
  ]));
  const conf = JSON.parse(db.prepare("SELECT pricing_confidence AS c FROM projects WHERE id='p1'").get().c);
  assert.strictEqual(conf.level, 'review');
  assert.strictEqual(assessDeliveryGate(db, 'p1').blocked, false);
});

test('end to end: the awkward job blocks, the ordinary one does not', () => {
  const db = freshDb();
  const priceIt = (items, loc) => priceLockedQuantities(items, loc, {}, { project_type: 'refurbishment' });

  const awkward = priceIt([
    { key: 'swimming_pool_shell', qty: 1, unit: 'Item', description: 'reinforced concrete pool shell with tanking' },
    { key: 'basement_excavation_restricted', qty: 140, unit: 'm³', description: 'basement dig by conveyor, spoil barrowed to street' },
    { key: 'brick_outer_leaf', qty: 90, unit: 'm²' },
  ], 'London SW1A 1AA');
  addProject(db, 'awkward', awkward.summary.pricing_confidence);
  assert.strictEqual(assessDeliveryGate(db, 'awkward').blocked, true);

  const ordinary = priceIt([
    { key: 'brick_outer_leaf', qty: 120, unit: 'm²' },
    { key: 'concrete_slab_150mm', qty: 60, unit: 'm²' },
    { key: 'roof_tiles_interlocking', qty: 80, unit: 'm²' },
  ], 'Manchester');
  addProject(db, 'ordinary', ordinary.summary.pricing_confidence);
  assert.strictEqual(assessDeliveryGate(db, 'ordinary').blocked, false);
});

test('deliverableRoutes still makes the three decisions modelled above', () => {
  // Pins the copy in this file to the original. If the route stops consulting the gate,
  // stops honouring sign-off, or goes back to an unconditional transition, this fails.
  const src = fs.readFileSync(path.join(__dirname, 'deliverableRoutes.js'), 'utf8');
  assert.match(src, /function assessDeliveryGate/, 'the gate function still exists');
  // Specifically the early return, not just a mention of the column — the column also
  // appears in the read route and the sign-off route, so a loose match passes even after
  // the gate stops honouring sign-off.
  assert.match(
    src,
    /if \(row\.pricing_reviewed_at\) return \{ blocked: false/,
    'a human sign-off must still clear the gate'
  );
  assert.match(src, /const gate = assessDeliveryGate\(projectId\)/, 'the upload route still consults it');
  assert.match(src, /if \(gate\.blocked\)/, 'and branches on the verdict');
  assert.doesNotMatch(
    src,
    /CASE WHEN status IN \('completed', 'delivered'\) THEN 'delivered' ELSE 'delivered' END/,
    'the old unconditional transition must not come back'
  );
});

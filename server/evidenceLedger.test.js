const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const {
  initEvidenceTables, recordProven, getLedger, checkRegressions,
  checkResubmission, recordFingerprints,
} = require('./evidenceLedger');

function freshDb() {
  const db = new Database(':memory:');
  initEvidenceTables(db);
  return db;
}

// The documented near-miss: a combined multi-storey plan was proved distorted
// and each storey re-measured; a later pass then re-derived from the combined
// figures again and silently raised windows 11 -> 13.
const NEAR_MISS = {
  userId: 'u1', takeoffId: 'tk1', itemKey: 'windows', unit: 'Nr',
  qty: 11, source: 'per-storey plans, re-measured',
  rejected: [{ qty: 13, source: 'combined multi-storey plan', why: 'that plan was proved distorted' }],
};

test('a quantity moving back toward a rejected value is flagged', () => {
  const db = freshDb();
  recordProven(db, NEAR_MISS);
  const flags = checkRegressions(db, 'tk1', [{ key: 'windows', qty: 13, source: 'combined plan' }]);
  assert.strictEqual(flags.length, 1);
  assert.strictEqual(flags[0].proven, 11);
  assert.strictEqual(flags[0].rejected, 13);
  assert.match(flags[0].message, /proved distorted/);
  assert.match(flags[0].message, /Re-read the ledger/);
});

test('a move AWAY from the rejected value is not flagged', () => {
  const db = freshDb();
  recordProven(db, NEAR_MISS);
  // 9 is further from the rejected 13 than from the proven 11 — a legitimate
  // re-measure, not a regression.
  assert.strictEqual(checkRegressions(db, 'tk1', [{ key: 'windows', qty: 9 }]).length, 0);
});

test('an unchanged quantity is silent', () => {
  const db = freshDb();
  recordProven(db, NEAR_MISS);
  assert.strictEqual(checkRegressions(db, 'tk1', [{ key: 'windows', qty: 11 }]).length, 0);
  assert.strictEqual(checkRegressions(db, 'tk1', [{ key: 'windows', qty: 11.1 }]).length, 0, 'within tolerance');
});

test('a source discredited once stays discredited across updates', () => {
  const db = freshDb();
  recordProven(db, NEAR_MISS);
  // A later pass re-proves the same item from a new source and forgets to
  // restate the earlier rejection.
  recordProven(db, {
    userId: 'u1', takeoffId: 'tk1', itemKey: 'windows', unit: 'Nr',
    qty: 11, source: 'window schedule', rejected: [],
  });
  const ledger = getLedger(db, 'tk1');
  assert.strictEqual(ledger[0].rejected.length, 1, 'the earlier rejection must be carried forward');
  // …and the guard still fires.
  assert.strictEqual(checkRegressions(db, 'tk1', [{ key: 'windows', qty: 13 }]).length, 1);
});

test('an item with no ledger entry is not second-guessed', () => {
  const db = freshDb();
  recordProven(db, NEAR_MISS);
  assert.strictEqual(checkRegressions(db, 'tk1', [{ key: 'doors', qty: 40 }]).length, 0);
});

// ── Resubmission ─────────────────────────────────────────────────────────
const PACK_A = Buffer.from('%PDF-1.7 three sheet domestic pack, scope: full refurbishment including rear extension');

test('a file already priced is recognised as a resubmission', () => {
  const db = freshDb();
  const first = checkResubmission(db, 'u1', [{ name: 'pack.pdf', buffer: PACK_A }]);
  assert.strictEqual(first.isResubmission, false);
  recordFingerprints(db, { userId: 'u1', takeoffId: 'tk1', projectName: '12 Hill St', prints: first.prints });

  const again = checkResubmission(db, 'u1', [{ name: 'pack-v2.pdf', buffer: PACK_A }]);
  assert.strictEqual(again.isResubmission, true);
  assert.strictEqual(again.matches[0].projectName, '12 Hill St');
  assert.match(again.note, /SCOPE wording/);
  assert.match(again.note, /Re-prove the scale/);
});

test("another user's job never matches", () => {
  const db = freshDb();
  const first = checkResubmission(db, 'u1', [{ name: 'pack.pdf', buffer: PACK_A }]);
  recordFingerprints(db, { userId: 'u1', takeoffId: 'tk1', projectName: '12 Hill St', prints: first.prints });
  assert.strictEqual(checkResubmission(db, 'u2', [{ name: 'pack.pdf', buffer: PACK_A }]).isResubmission, false);
});

test('the same sheet twice in one pack is reported as a duplicate', () => {
  const db = freshDb();
  const r = checkResubmission(db, 'u1', [
    { name: 'sheet-01.pdf', buffer: PACK_A },
    { name: 'sheet-01-copy.pdf', buffer: PACK_A },
    { name: 'sheet-02.pdf', buffer: Buffer.from('different sheet') },
  ]);
  assert.strictEqual(r.duplicatesInPack.length, 2);
  assert.ok(r.duplicatesInPack.includes('sheet-01.pdf'));
});

// What the admin sees under "Recent changes" on a client's rate library:
// which rates changed, what they were before, and how — newest first.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { recentChanges, sqliteTimestamp } = require('./rateHistory');

const NOW = Date.parse('2026-11-05T15:00:00Z');
const at = (hoursAgo) => sqliteTimestamp(NOW - hoursAgo * 3600000);

function harness() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE client_rate_library (
      id TEXT PRIMARY KEY, user_id TEXT, category TEXT, item_key TEXT, display_name TEXT,
      value REAL, unit TEXT, client_note TEXT, is_active INTEGER DEFAULT 1,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE rate_corrections_log (
      id TEXT PRIMARY KEY, rate_id TEXT, user_id TEXT, old_value REAL, new_value REAL,
      correction_source TEXT, raw_message TEXT, created_at TEXT
    );
  `);
  const rate = (id, user, key, value, { created, updated = created, active = 1, note = null, category = 'labour', name = key } = {}) =>
    db.prepare('INSERT INTO client_rate_library VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, user, category, key, name, value, 'per day', note, active, created, updated);
  const correction = (id, rateId, old, next, source, msg, created) =>
    db.prepare('INSERT INTO rate_corrections_log VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, rateId, 'u1', old, next, source, msg, created);
  return { db, rate, correction, run: (opts) => recentChanges(db, 'u1', { now: () => NOW, ...opts }) };
}

test('a corrected rate shows what it was, how it was changed, and comes first', () => {
  const h = harness();
  h.rate('sys1', '__system_default__', 'electrician_day', 280, { created: at(24 * 90) });
  h.rate('r1', 'u1', 'electrician_day', 320, { created: at(24 * 60), updated: at(2), name: 'Electrician day rate' });
  h.correction('c1', 'r1', 280, 320, 'chat', 'my sparky is 320 a day', at(2));
  h.rate('r2', 'u1', 'labourer_day', 150, { created: at(5) });               // added, untouched since
  h.rate('r3', 'u1', 'plasterer_day', 200, { created: at(24 * 60) });        // old, unchanged — not listed
  h.rate('r4', 'u1', 'tiler_m2', 45, { created: at(24 * 60), updated: at(1), active: 0 }); // deleted an hour ago

  const { changes, truncated } = h.run();
  assert.strictEqual(truncated, false);
  assert.deepStrictEqual(changes.map((c) => c.id), ['r4', 'r1', 'r2']);

  const [removed, corrected, added] = changes;
  assert.strictEqual(removed.kind, 'removed');
  assert.strictEqual(corrected.kind, 'updated');
  assert.strictEqual(corrected.display_name, 'Electrician day rate');
  assert.strictEqual(corrected.old_value, 280);
  assert.strictEqual(corrected.value, 320);
  assert.strictEqual(corrected.source, 'chat / My Rates edit');
  assert.strictEqual(corrected.raw_message, 'my sparky is 320 a day');
  assert.strictEqual(corrected.changed_at, at(2));
  assert.strictEqual(added.kind, 'added');
  assert.strictEqual(added.old_value, null);
  assert.strictEqual(added.source, null);
});

test('an edited default falls back to the seeded value as "was"; a stale correction is ignored', () => {
  const h = harness();
  h.rate('sys1', '__system_default__', 'brick_m2', 60, { created: at(24 * 90) });
  // Corrected in chat a month ago, then overwritten by an import today: the
  // old chat entry must not be presented as what today's import replaced.
  h.rate('r1', 'u1', 'brick_m2', 75, { created: at(24 * 90), updated: at(3) });
  h.correction('c1', 'r1', 60, 70, 'auto_chat', 'bricks are 70 a metre', at(24 * 35));

  const { changes } = h.run();
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].kind, 'updated');
  assert.strictEqual(changes[0].old_value, 60, 'seeded default stands in for the previous value');
  assert.strictEqual(changes[0].source, null);
  assert.strictEqual(changes[0].raw_message, null);
});

test('window and limit: old changes drop off, and the list says when it was cut short', () => {
  const h = harness();
  h.rate('r_old', 'u1', 'old_item', 10, { created: at(24 * 31) });
  for (let i = 0; i < 5; i++) h.rate('r' + i, 'u1', 'item_' + i, i, { created: at(i + 1) });

  const all = h.run();
  assert.strictEqual(all.changes.length, 5);
  assert.ok(!all.changes.some((c) => c.id === 'r_old'));

  const cut = h.run({ limit: 3 });
  assert.strictEqual(cut.changes.length, 3);
  assert.strictEqual(cut.truncated, true);
  assert.deepStrictEqual(cut.changes.map((c) => c.id), ['r0', 'r1', 'r2']);

  const wide = h.run({ days: 60 });
  assert.ok(wide.changes.some((c) => c.id === 'r_old'));
  assert.strictEqual(wide.days, 60);
});

test('only the asked-for client is listed', () => {
  const h = harness();
  h.rate('mine', 'u1', 'x', 1, { created: at(1) });
  h.rate('theirs', 'u2', 'x', 1, { created: at(1) });
  assert.deepStrictEqual(h.run().changes.map((c) => c.id), ['mine']);
});

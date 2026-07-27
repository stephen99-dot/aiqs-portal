// Tests for the entity store.
//
// The property under test above all others is TENANT ISOLATION. This table holds personal
// data about named individuals, and some of it is a performance judgement about a named
// subcontractor. One builder's entities reaching another builder is not a bug you find in
// a log — it is one you hear about from a customer, or a regulator. So every exported
// reader is asserted in both directions, and every one is asserted to refuse a call that
// omits userId at all.
//
// In-memory database throughout: these tests create and delete real rows and must never
// touch the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const es = require('./entityStore');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE estimator_clients (
      id TEXT PRIMARY KEY, user_id TEXT, name TEXT, email TEXT, phone TEXT,
      address TEXT, notes TEXT
    );
  `);
  es.initEntityTables(db);
  return db;
}

const mk = (db, userId, kind, name) =>
  es.upsertEntity(db, { userId, kind, displayName: name }).entity;

// ── normalisation ─────────────────────────────────────────────────────────────

test('normaliseName folds the ways a firm gets typed', () => {
  const same = ['Mullan Groundworks Ltd', 'MULLAN GROUNDWORKS', 'mullan  groundworks.', 'Mullan Groundworks Limited'];
  const keys = same.map(es.normaliseName);
  assert.strictEqual(new Set(keys).size, 1, `expected one key, got ${JSON.stringify(keys)}`);
  assert.strictEqual(keys[0], 'mullan groundworks');
});

test('normaliseName sees through ampersands and trading suffixes', () => {
  // "Kerr & Co Architects Limited" on an invoice and "Kerr Architects" typed into a job
  // are the same practice, and the builder should not end up with two records.
  assert.strictEqual(es.normaliseName('Kerr & Co Architects Limited'), es.normaliseName('Kerr Architects'));
  assert.strictEqual(es.normaliseName('Smith and Jones Builders'), es.normaliseName('Smith Jones Builders'));
  // And an ampersand on its own must not become an entity named "and".
  assert.strictEqual(es.normaliseName('&'), '');
});

test('normaliseName does not fold two genuinely different firms together', () => {
  assert.notStrictEqual(es.normaliseName('Kerr Architects'), es.normaliseName('Kean Architects'));
  assert.notStrictEqual(es.normaliseName('Mullan Groundworks'), es.normaliseName('Mullen Groundworks'));
});

test('a name that normalises to nothing is rejected, not stored blank', () => {
  const db = freshDb();
  for (const junk of ['', '   ', 'Ltd', '...', '&', 'the']) {
    assert.throws(
      () => es.upsertEntity(db, { userId: 'u1', kind: 'supplier', displayName: junk }),
      /displayName is required|normalises to nothing/,
      `"${junk}" must be refused`
    );
  }
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 0, 'nothing was stored');
});

// ── tenant isolation ──────────────────────────────────────────────────────────

test('no reader returns another builder\'s entity', () => {
  const db = freshDb();
  const a = mk(db, 'builder-a', 'end_client', 'Mrs Hughes');
  mk(db, 'builder-b', 'end_client', 'Mr Okafor');

  assert.strictEqual(es.getEntity(db, { userId: 'builder-b', id: a.id }), null, 'getEntity leaked');
  assert.deepStrictEqual(
    es.listEntities(db, { userId: 'builder-b' }).map(e => e.display_name),
    ['Mr Okafor'],
    'listEntities leaked'
  );
  assert.deepStrictEqual(es.listFacts(db, { userId: 'builder-b', entityId: a.id }), [], 'listFacts leaked');
  assert.deepStrictEqual(es.listEvents(db, { userId: 'builder-b', entityId: a.id }), [], 'listEvents leaked');
  assert.strictEqual(es.summary(db, { userId: 'builder-b' }).total, 1, 'summary leaked');
});

test('no writer can modify another builder\'s entity', () => {
  const db = freshDb();
  const a = mk(db, 'builder-a', 'subcontractor', 'Mullan Groundworks');

  assert.strictEqual(es.renameEntity(db, { userId: 'builder-b', id: a.id, displayName: 'Hijacked' }), false);
  assert.strictEqual(es.deleteEntity(db, { userId: 'builder-b', id: a.id }), false);
  assert.throws(() => es.addFact(db, { userId: 'builder-b', entityId: a.id, content: 'injected' }),
    /unknown entity/, 'addFact must refuse a foreign entity');
  assert.throws(() => es.addEvent(db, { userId: 'builder-b', entityId: a.id, eventType: 'quoted' }),
    /unknown entity/, 'addEvent must refuse a foreign entity');

  const still = es.getEntity(db, { userId: 'builder-a', id: a.id });
  assert.strictEqual(still.display_name, 'Mullan Groundworks', 'the original survived untouched');
});

test('merging cannot pull an entity across builders', () => {
  const db = freshDb();
  const a = mk(db, 'builder-a', 'supplier', 'Selco');
  const b = mk(db, 'builder-b', 'supplier', 'Jewson');
  assert.strictEqual(es.mergeEntities(db, { userId: 'builder-b', fromId: a.id, intoId: b.id }), false);
  assert.strictEqual(es.mergeEntities(db, { userId: 'builder-a', fromId: a.id, intoId: b.id }), false);
  assert.strictEqual(es.getEntity(db, { userId: 'builder-a', id: a.id }).merged_into, null);
});

test('every exported reader and writer refuses a call with no userId', () => {
  const db = freshDb();
  const calls = {
    getEntity:     () => es.getEntity(db, { id: 'x' }),
    listEntities:  () => es.listEntities(db, {}),
    renameEntity:  () => es.renameEntity(db, { id: 'x', displayName: 'y' }),
    mergeEntities: () => es.mergeEntities(db, { fromId: 'x', intoId: 'y' }),
    deleteEntity:  () => es.deleteEntity(db, { id: 'x' }),
    addFact:       () => es.addFact(db, { entityId: 'x', content: 'y' }),
    listFacts:     () => es.listFacts(db, { entityId: 'x' }),
    expireFact:    () => es.expireFact(db, { id: 'x' }),
    deleteFact:    () => es.deleteFact(db, { id: 'x' }),
    addEvent:      () => es.addEvent(db, { entityId: 'x', eventType: 'quoted' }),
    listEvents:    () => es.listEvents(db, { entityId: 'x' }),
    recordDecline: () => es.recordDecline(db, { name: 'x' }),
    isDeclined:    () => es.isDeclined(db, { name: 'x' }),
    summary:       () => es.summary(db, {}),
    upsertEntity:  () => es.upsertEntity(db, { kind: 'supplier', displayName: 'x' }),
  };
  for (const [name, call] of Object.entries(calls)) {
    assert.throws(call, /userId is required/, `${name} must refuse a call with no userId`);
  }
});

// ── entities ──────────────────────────────────────────────────────────────────

test('upsert is idempotent for the same builder, name and kind', () => {
  const db = freshDb();
  const a = es.upsertEntity(db, { userId: 'u1', kind: 'subcontractor', displayName: 'Mullan Groundworks Ltd' });
  const b = es.upsertEntity(db, { userId: 'u1', kind: 'subcontractor', displayName: 'MULLAN GROUNDWORKS' });
  assert.strictEqual(a.created, true);
  assert.strictEqual(b.created, false, 'the second call matched rather than inserting');
  assert.strictEqual(a.entity.id, b.entity.id);
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 1);
});

test('the same name in two different roles is two entities', () => {
  // A firm can genuinely be both — they supply materials and they subcontract labour.
  const db = freshDb();
  const sup = mk(db, 'u1', 'supplier', 'Mullan');
  const sub = mk(db, 'u1', 'subcontractor', 'Mullan');
  assert.notStrictEqual(sup.id, sub.id);
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 2);
  assert.strictEqual(es.listEntities(db, { userId: 'u1', kind: 'supplier' }).length, 1);
});

test('an unknown kind is refused', () => {
  const db = freshDb();
  assert.throws(() => es.upsertEntity(db, { userId: 'u1', kind: 'wizard', displayName: 'Gandalf' }), /unknown kind/);
});

test('rename recomputes the match key so the new name is findable', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'end_client', 'Mrs Hughs');
  assert.strictEqual(es.renameEntity(db, { userId: 'u1', id: e.id, displayName: 'Mrs Hughes' }), true);
  const again = es.upsertEntity(db, { userId: 'u1', kind: 'end_client', displayName: 'MRS HUGHES' });
  assert.strictEqual(again.created, false, 'the corrected name now matches');
  assert.strictEqual(again.entity.id, e.id);
});

// ── merge ─────────────────────────────────────────────────────────────────────

test('merge moves facts and events across and is soft, not destructive', () => {
  const db = freshDb();
  const dup = mk(db, 'u1', 'subcontractor', 'Mullan');
  const keep = mk(db, 'u1', 'subcontractor', 'Mullan Groundworks');
  es.addFact(db, { userId: 'u1', entityId: dup.id, content: 'Prefers to price groundworks by the day' });
  es.addEvent(db, { userId: 'u1', entityId: dup.id, eventType: 'quoted', jobId: 'job-1' });

  assert.strictEqual(es.mergeEntities(db, { userId: 'u1', fromId: dup.id, intoId: keep.id }), true);
  assert.strictEqual(es.listFacts(db, { userId: 'u1', entityId: keep.id }).length, 1, 'fact moved');
  assert.strictEqual(es.listEvents(db, { userId: 'u1', entityId: keep.id }).length, 1, 'event moved');
  assert.strictEqual(es.getEntity(db, { userId: 'u1', id: dup.id }).merged_into, keep.id,
    'the loser survives, pointing at the winner — the decision stays auditable');
  assert.deepStrictEqual(es.listEntities(db, { userId: 'u1' }).map(e => e.id), [keep.id],
    'merged entities drop out of the default list');
});

test('an entity cannot be merged into itself', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'supplier', 'Selco');
  assert.throws(() => es.mergeEntities(db, { userId: 'u1', fromId: e.id, intoId: e.id }), /into itself/);
});

// ── facts ─────────────────────────────────────────────────────────────────────

test('facts expire rather than vanish, and expired ones stay quiet', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'end_client', 'Mrs Hughes');
  const f = es.addFact(db, { userId: 'u1', entityId: e.id, content: 'Wants the kitchen as a PC sum' });
  assert.strictEqual(es.listFacts(db, { userId: 'u1', entityId: e.id }).length, 1);

  assert.strictEqual(es.expireFact(db, { userId: 'u1', id: f.id }), true);
  assert.strictEqual(es.listFacts(db, { userId: 'u1', entityId: e.id }).length, 0,
    'an expired judgement must stop colouring today\'s job');
  assert.strictEqual(es.listFacts(db, { userId: 'u1', entityId: e.id, includeExpired: true }).length, 1,
    'but the record that it was once believed survives');
});

test('the same fact recorded twice is stored once', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'architect', 'Kerr Architects');
  es.addFact(db, { userId: 'u1', entityId: e.id, content: 'Drainage missing from the drawings' });
  es.addFact(db, { userId: 'u1', entityId: e.id, content: 'Drainage missing from the drawings' });
  assert.strictEqual(es.listFacts(db, { userId: 'u1', entityId: e.id }).length, 1);
});

test('a fact cannot be attached to an entity that does not exist', () => {
  const db = freshDb();
  assert.throws(() => es.addFact(db, { userId: 'u1', entityId: 'nope', content: 'x' }), /unknown entity/);
});

// ── events ────────────────────────────────────────────────────────────────────

test('replaying the same job history does not multiply its events', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'end_client', 'Mrs Hughes');
  const at = '2026-03-01T00:00:00.000Z';
  for (let i = 0; i < 3; i++) {
    es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'quoted', jobId: 'job-1', occurredAt: at });
  }
  assert.strictEqual(es.listEvents(db, { userId: 'u1', entityId: e.id }).length, 1);
});

test('distinct events on the same job are all kept', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'end_client', 'Mrs Hughes');
  es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'quoted', jobId: 'job-1', occurredAt: '2026-01-01T00:00:00Z' });
  es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'won',    jobId: 'job-1', occurredAt: '2026-01-05T00:00:00Z' });
  const events = es.listEvents(db, { userId: 'u1', entityId: e.id });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].event_type, 'won', 'most recent first');
});

// ── declines ──────────────────────────────────────────────────────────────────

test('a declined name stays declined, however it is typed next time', () => {
  const db = freshDb();
  es.recordDecline(db, { userId: 'u1', name: 'Dave at the merchants' });
  assert.strictEqual(es.isDeclined(db, { userId: 'u1', name: 'DAVE AT THE MERCHANTS' }), true,
    'the same passing mention must not be re-proposed every turn');
  assert.strictEqual(es.isDeclined(db, { userId: 'u1', name: 'Kerr Architects' }), false);
  assert.strictEqual(es.isDeclined(db, { userId: 'u2', name: 'Dave at the merchants' }), false,
    'declines are per builder');
});

// ── deletion ──────────────────────────────────────────────────────────────────

test('delete removes the entity and everything hanging off it', () => {
  const db = freshDb();
  const e = mk(db, 'u1', 'crew_member', 'Dave Mullan');
  es.addFact(db, { userId: 'u1', entityId: e.id, content: 'Runs the groundworks gang' });
  es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'task_completed', jobId: 'job-1' });

  assert.strictEqual(es.deleteEntity(db, { userId: 'u1', id: e.id }), true);
  assert.strictEqual(es.getEntity(db, { userId: 'u1', id: e.id }), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM entity_facts').get().c, 0, 'facts erased too');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM entity_events').get().c, 0, 'events erased too');
});

test('deleting a merge target does not strand the entity that pointed at it', () => {
  const db = freshDb();
  const dup = mk(db, 'u1', 'supplier', 'Selco Trade');
  const keep = mk(db, 'u1', 'supplier', 'Selco');
  es.mergeEntities(db, { userId: 'u1', fromId: dup.id, intoId: keep.id });
  es.deleteEntity(db, { userId: 'u1', id: keep.id });
  const survivor = es.getEntity(db, { userId: 'u1', id: dup.id });
  assert.strictEqual(survivor.merged_into, null, 'the pointer was cleared, not left dangling');
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 1, 'and it is visible again');
});

// ── backfill ──────────────────────────────────────────────────────────────────

test('backfill seeds end clients from estimator_clients, idempotently', () => {
  const db = freshDb();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name,email,phone) VALUES ('c1','u1','Mrs Hughes','h@x.com','0123')").run();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c2','u1','Mr Okafor')").run();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c3','u2','Other Builder Client')").run();

  const first = es.backfillFromClients(db);
  assert.strictEqual(first.created, 3);
  const second = es.backfillFromClients(db);
  assert.strictEqual(second.created, 0, 'a second run creates nothing');
  assert.strictEqual(second.existing, 3);

  const u1 = es.listEntities(db, { userId: 'u1' });
  assert.strictEqual(u1.length, 2, 'each builder only got their own');
  assert.ok(u1.every(e => e.kind === 'end_client' && e.source === 'estimator_clients'));
  const hughes = u1.find(e => e.display_name === 'Mrs Hughes');
  assert.strictEqual(JSON.parse(hughes.external_refs).email, 'h@x.com', 'contact details carried over');
});

test('backfill skips unusable client rows instead of failing', () => {
  const db = freshDb();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c1','u1','')").run();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c2',NULL,'No Owner')").run();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c3','u1','Ltd')").run();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c4','u1','Real Client')").run();
  const stats = es.backfillFromClients(db);
  assert.strictEqual(stats.created, 1, 'only the usable row became an entity');
  assert.strictEqual(stats.skipped, 3);
});

test('backfill can be scoped to one builder', () => {
  const db = freshDb();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c1','u1','A Client')").run();
  db.prepare("INSERT INTO estimator_clients (id,user_id,name) VALUES ('c2','u2','B Client')").run();
  es.backfillFromClients(db, { userId: 'u1' });
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 1);
  assert.strictEqual(es.listEntities(db, { userId: 'u2' }).length, 0);
});

test('backfill survives the table being absent', () => {
  const db = new Database(':memory:');
  es.initEntityTables(db);   // no estimator_clients at all
  const stats = es.backfillFromClients(db);
  assert.ok(stats.error, 'the failure is reported rather than thrown');
  assert.strictEqual(stats.created, 0);
});

test('the same event with a different payload is a new record, not an overwrite', () => {
  // The payload is part of the event's identity, for the same reason price_evidence
  // hashes its value: an identical replay collides and is ignored, but the same event
  // carrying genuinely different detail must not silently rewrite what was there.
  const db = freshDb();
  const e = mk(db, 'u1', 'end_client', 'Mrs Hughes');
  const at = '2026-03-01T00:00:00.000Z';
  es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'quoted', jobId: 'j1', occurredAt: at, payload: { value: 84000 } });
  es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'quoted', jobId: 'j1', occurredAt: at, payload: { value: 84000 } });
  assert.strictEqual(es.listEvents(db, { userId: 'u1', entityId: e.id }).length, 1, 'identical replay ignored');

  es.addEvent(db, { userId: 'u1', entityId: e.id, eventType: 'quoted', jobId: 'j1', occurredAt: at, payload: { value: 91000 } });
  const events = es.listEvents(db, { userId: 'u1', entityId: e.id });
  assert.strictEqual(events.length, 2, 'a different value is a different observation');
  const values = events.map(ev => JSON.parse(ev.payload).value).sort((a, b) => a - b);
  assert.deepStrictEqual(values, [84000, 91000], 'the original survived alongside the new one');
});

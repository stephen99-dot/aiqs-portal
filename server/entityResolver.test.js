// Tests for entity resolution and card rendering.
//
// Resolution is a confidence ladder, and the thing worth defending is its conservatism.
// A duplicate entity is a visible annoyance the builder can merge away on the Memory
// page. A WRONG match is invisible and quietly attributes one firm's history — and later,
// one firm's prices — to another. So these tests care more about what the resolver
// refuses to match than about what it matches.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const es = require('./entityStore');
const er = require('./entityResolver');

function freshDb() {
  const db = new Database(':memory:');
  es.initEntityTables(db);
  return db;
}

function seed(db, userId = 'u1') {
  const mk = (kind, name) => es.upsertEntity(db, { userId, kind, displayName: name }).entity;
  return {
    mullan: mk('subcontractor', 'Mullan Groundworks Ltd'),
    kerr: mk('architect', 'Kerr Architects'),
    hughes: mk('end_client', 'Mrs Hughes'),
  };
}

// ── matching ──────────────────────────────────────────────────────────────────

test('the ways one firm gets typed all resolve to it', async () => {
  const db = freshDb();
  const { mullan } = seed(db);
  for (const name of ['Mullan Groundworks Ltd', 'MULLAN GROUNDWORKS', 'mullan groundworks limited', 'Mullan']) {
    const r = await er.resolveName(db, { userId: 'u1', name });
    assert.strictEqual(r.status, 'matched', `"${name}" should match`);
    assert.strictEqual(r.entity.id, mullan.id, `"${name}" matched the wrong entity`);
  }
});

test('a lone trade word never identifies a firm', () => {
  // "groundworks" is what they do, not which company they are. Matching it would
  // silently attribute a whole job to one subcontractor.
  const db = freshDb();
  seed(db);
  for (const word of ['groundworks', 'architects', 'roofing', 'plumbing']) {
    assert.strictEqual(er.isContainment(word, 'mullan groundworks'), false, `"${word}" must not contain-match`);
  }
  // But a distinctive single word still does.
  assert.strictEqual(er.isContainment('mullan', 'mullan groundworks'), true);
  assert.strictEqual(er.isContainment('kerr', 'kerr architects'), true);
});

test('a lone trade word is proposed at most, never matched', async () => {
  const db = freshDb();
  seed(db);
  const r = await er.resolveName(db, { userId: 'u1', name: 'groundworks' });
  assert.notStrictEqual(r.status, 'matched', 'a trade word must not resolve on its own');
});

test('short fragments do not match everything', () => {
  assert.strictEqual(er.isContainment('ab', 'ab construction group'), false, 'two letters is not an identity');
  assert.strictEqual(er.isContainment('jd', 'jd builders'), false);
});

test('a genuinely different firm is not matched', async () => {
  const db = freshDb();
  seed(db);
  for (const name of ['Kean Architects', 'Mullen Groundworks', 'Totally Different Co']) {
    const r = await er.resolveName(db, { userId: 'u1', name });
    assert.notStrictEqual(r.status, 'matched', `"${name}" must not silently match an existing entity`);
  }
});

test('a person sharing a firm name is proposed, not merged into the firm', async () => {
  // "Dave Mullan" and "Mullan Groundworks Ltd" are related but not the same record, and
  // deciding that is the builder's call, not the resolver's.
  const db = freshDb();
  seed(db);
  const r = await er.resolveName(db, { userId: 'u1', name: 'dave mullan' });
  assert.strictEqual(r.status, 'propose');
  assert.ok(r.candidates.length > 0, 'the likely firm is offered as a candidate');
});

test('an unrelated name resolves to nothing at all', async () => {
  const db = freshDb();
  seed(db);
  const r = await er.resolveName(db, { userId: 'u1', name: 'Zeta Coastal Marine' });
  assert.strictEqual(r.status, 'none');
});

test('resolution is scoped to one builder', async () => {
  const db = freshDb();
  seed(db, 'u1');
  const r = await er.resolveName(db, { userId: 'u2', name: 'Mullan Groundworks Ltd' });
  assert.strictEqual(r.status, 'none', 'another builder\'s entity is invisible');
  await assert.rejects(() => er.resolveName(db, { name: 'x' }), /userId is required/);
});

test('kind narrows the search', async () => {
  const db = freshDb();
  seed(db);
  const asArchitect = await er.resolveName(db, { userId: 'u1', name: 'Mullan Groundworks', kind: 'architect' });
  assert.notStrictEqual(asArchitect.status, 'matched', 'a subcontractor is not an architect');
  const asSub = await er.resolveName(db, { userId: 'u1', name: 'Mullan Groundworks', kind: 'subcontractor' });
  assert.strictEqual(asSub.status, 'matched');
});

test('matching works identically with embeddings unavailable', async () => {
  // Voyage is an enhancement, never a dependency — the same guarantee memoryStore makes.
  const db = freshDb();
  const { mullan } = seed(db);
  const withOut = await er.resolveName(db, { userId: 'u1', name: 'Mullan', useEmbeddings: false });
  assert.strictEqual(withOut.status, 'matched');
  assert.strictEqual(withOut.entity.id, mullan.id);
});

// ── creation policy ───────────────────────────────────────────────────────────

test('a trusted source creates silently', async () => {
  const db = freshDb();
  const r = await er.resolveOrPropose(db, {
    userId: 'u1', name: 'Kerr Architects', kind: 'architect', source: 'job_field', trusted: true,
  });
  assert.strictEqual(r.status, 'created');
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 1);
});

test('a name from free chat is proposed, not created', async () => {
  const db = freshDb();
  const r = await er.resolveOrPropose(db, {
    userId: 'u1', name: 'Dave at the merchants', kind: 'supplier', source: 'chat',
  });
  assert.strictEqual(r.status, 'propose');
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 0, 'nothing was stored');
});

test('a declined name is not proposed again', async () => {
  const db = freshDb();
  const first = await er.resolveOrPropose(db, { userId: 'u1', name: 'Dave at the merchants', kind: 'supplier' });
  assert.strictEqual(first.status, 'propose');

  er.decline(db, { userId: 'u1', name: 'Dave at the merchants' });

  const second = await er.resolveOrPropose(db, { userId: 'u1', name: 'DAVE AT THE MERCHANTS', kind: 'supplier' });
  assert.strictEqual(second.status, 'declined', 'the same passing mention must not be raised every turn');
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 0);
});

test('a decline does not block a trusted source later', async () => {
  // Declining a chat mention says "don't guess", not "this firm may never exist".
  const db = freshDb();
  er.decline(db, { userId: 'u1', name: 'Kerr Architects' });
  const r = await er.resolveOrPropose(db, {
    userId: 'u1', name: 'Kerr Architects', kind: 'architect', trusted: true,
  });
  assert.strictEqual(r.status, 'created');
});

test('an already-known name matches rather than re-proposing', async () => {
  const db = freshDb();
  seed(db);
  const r = await er.resolveOrPropose(db, { userId: 'u1', name: 'Mullan Groundworks', kind: 'subcontractor' });
  assert.strictEqual(r.status, 'matched');
});

test('an empty name is ignored rather than stored', async () => {
  const db = freshDb();
  for (const junk of ['', '  ', '&', 'Ltd']) {
    const r = await er.resolveOrPropose(db, { userId: 'u1', name: junk, kind: 'supplier', trusted: true });
    assert.strictEqual(r.status, 'ignored', `"${junk}" must be ignored`);
  }
  assert.strictEqual(es.listEntities(db, { userId: 'u1' }).length, 0);
});

// ── cards ─────────────────────────────────────────────────────────────────────

test('cards carry the name, the history and the facts', () => {
  const db = freshDb();
  const { hughes, kerr } = seed(db);
  es.addFact(db, { userId: 'u1', entityId: hughes.id, content: 'Always wants the kitchen priced as a PC sum' });
  es.addEvent(db, { userId: 'u1', entityId: hughes.id, eventType: 'quoted', jobId: 'j1', occurredAt: '2026-03-01T00:00:00Z' });
  es.addEvent(db, { userId: 'u1', entityId: hughes.id, eventType: 'won', jobId: 'j1', occurredAt: '2026-03-09T00:00:00Z' });
  es.addFact(db, { userId: 'u1', entityId: kerr.id, content: 'Drainage omitted from the drawings on 3 of 4 sets' });

  const text = er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [hughes.id, kerr.id] }));
  assert.match(text, /END CLIENT · Mrs Hughes/);
  assert.match(text, /ARCHITECT · Kerr Architects/);
  assert.match(text, /kitchen priced as a PC sum/);
  assert.match(text, /Drainage omitted/);
  assert.match(text, /1 job/, 'job count summarised');
  assert.match(text, /1 won/, 'outcome summarised');
});

test('expired facts do not appear on a card', () => {
  const db = freshDb();
  const { hughes } = seed(db);
  const f = es.addFact(db, { userId: 'u1', entityId: hughes.id, content: 'Was very slow to pay in 2023' });
  es.expireFact(db, { userId: 'u1', id: f.id });
  const text = er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [hughes.id] }));
  assert.doesNotMatch(text, /slow to pay/, 'an expired judgement must stop reaching the model');
});

test('cards are bounded so a long history cannot inflate every turn', () => {
  const db = freshDb();
  const { hughes } = seed(db);
  for (let i = 0; i < 30; i++) {
    es.addFact(db, { userId: 'u1', entityId: hughes.id, content: `Fact number ${i}` });
  }
  const cards = er.buildCards(db, { userId: 'u1', entityIds: [hughes.id] });
  assert.strictEqual(cards[0].facts.length, 4, 'facts are capped per entity');
});

test('no entities means an empty string, so callers can append unconditionally', () => {
  const db = freshDb();
  assert.strictEqual(er.formatCardsForPrompt([]), '');
  assert.strictEqual(er.formatCardsForPrompt(null), '');
  assert.strictEqual(er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [] })), '');
});

test('cards never cross builders', () => {
  const db = freshDb();
  const { hughes } = seed(db, 'u1');
  const cards = er.buildCards(db, { userId: 'u2', entityIds: [hughes.id] });
  assert.deepStrictEqual(cards, [], 'another builder\'s entity renders nothing');
  assert.throws(() => er.buildCards(db, { entityIds: [] }), /userId is required/);
});

test('a merged-away entity is not rendered', () => {
  const db = freshDb();
  const dup = es.upsertEntity(db, { userId: 'u1', kind: 'supplier', displayName: 'Selco Trade Centre' }).entity;
  const keep = es.upsertEntity(db, { userId: 'u1', kind: 'supplier', displayName: 'Selco' }).entity;
  es.mergeEntities(db, { userId: 'u1', fromId: dup.id, intoId: keep.id });
  const text = er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [dup.id, keep.id] }));
  assert.strictEqual((text.match(/SUPPLIER/g) || []).length, 1, 'the merged duplicate is gone');
  assert.match(text, /Selco\b/);
});

test('card rendering is deterministic for the same inputs', () => {
  // Cards live in the per-turn tail rather than the cached prefix, but determinism still
  // matters: a block that reordered itself would make the prompt diff noise on every turn.
  const db = freshDb();
  const { hughes, kerr } = seed(db);
  es.addFact(db, { userId: 'u1', entityId: hughes.id, content: 'Pays within 7 days' });
  es.addFact(db, { userId: 'u1', entityId: kerr.id, content: 'Drawings usually lack drainage' });
  const once = er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [hughes.id, kerr.id] }));
  const twice = er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [hughes.id, kerr.id] }));
  assert.strictEqual(once, twice);
});

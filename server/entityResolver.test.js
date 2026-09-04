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

// ── who is on THIS job ────────────────────────────────────────────────────────
// The card block asserts that the people on it are on the job in hand. Handing it
// the builder's whole address book tells the model that last month's end client is
// on today's drawings, and the model has no way to know better — that is how a bill
// comes back headed with another job's employer.

test('only the people named in the conversation are on the job', () => {
  const db = freshDb();
  const { hughes, kerr, mullan } = seed(db);
  const ids = er.selectJobEntities(db, {
    userId: 'u1',
    context: 'Revised drawings for Mrs Hughes at The Mount — Kerr have reissued the elevations.',
  });
  assert.deepStrictEqual(ids.sort(), [hughes.id, kerr.id].sort());
  assert.ok(!ids.includes(mullan.id), 'a firm nobody mentioned is not on this job');
});

test('a job nobody is named on gets no cards at all', () => {
  const db = freshDb();
  seed(db);
  const ids = er.selectJobEntities(db, { userId: 'u1', context: 'Revised drawings for The Mount attached.' });
  assert.deepStrictEqual(ids, []);
  assert.strictEqual(er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: ids })), '');
});

test('a firm is on the job when it is named the short way people name it', () => {
  const db = freshDb();
  const { mullan } = seed(db);
  assert.deepStrictEqual(
    er.selectJobEntities(db, { userId: 'u1', context: 'Mullan are back on site Monday' }),
    [mullan.id]
  );
});

test('a lone trade word does not put a firm on the job', () => {
  const db = freshDb();
  seed(db);
  assert.deepStrictEqual(
    er.selectJobEntities(db, { userId: 'u1', context: 'Price the groundworks and the architects fees' }),
    [],
    'naming a trade is not naming the firm that does it'
  );
});

test('a short fragment of a name does not put a firm on the job', () => {
  const db = freshDb();
  seed(db);
  assert.deepStrictEqual(er.selectJobEntities(db, { userId: 'u1', context: 'Ker ker ker' }), []);
});

test('selection never crosses builders', () => {
  const db = freshDb();
  seed(db, 'u1');
  const other = seed(db, 'u2');
  const ids = er.selectJobEntities(db, { userId: 'u2', context: 'Mrs Hughes at The Mount' });
  assert.deepStrictEqual(ids, [other.hughes.id]);
});

test('an empty conversation selects nobody rather than everybody', () => {
  const db = freshDb();
  seed(db);
  assert.deepStrictEqual(er.selectJobEntities(db, { userId: 'u1', context: '' }), []);
  assert.deepStrictEqual(er.selectJobEntities(db, { userId: 'u1', context: null }), []);
});

test('selection is bounded, so one turn cannot carry an address book', () => {
  const db = freshDb();
  const names = [];
  for (let i = 0; i < 20; i++) {
    names.push(`Bramble${i} Homes`);
    es.upsertEntity(db, { userId: 'u1', kind: 'end_client', displayName: `Bramble${i} Homes` });
  }
  const ids = er.selectJobEntities(db, { userId: 'u1', context: names.join(', '), limit: 12 });
  assert.strictEqual(ids.length, 12);
});

test('a merged-away entity is never selected', () => {
  const db = freshDb();
  const { kerr } = seed(db);
  const dupe = es.upsertEntity(db, { userId: 'u1', kind: 'architect', displayName: 'Kerr Architectural' }).entity;
  es.mergeEntities(db, { userId: 'u1', fromId: dupe.id, intoId: kerr.id });
  const ids = er.selectJobEntities(db, { userId: 'u1', context: 'Kerr Architectural have reissued' });
  assert.ok(!ids.includes(dupe.id), 'the merged-away record must not come back as a second card');
});

test('selection requires a builder, like every other read', () => {
  const db = freshDb();
  assert.throws(() => er.selectJobEntities(db, { context: 'Mrs Hughes' }), /userId is required/);
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

// ── the cache boundary ────────────────────────────────────────────────────────
// chat.js sends `stableSystemBase` with cache_control: ephemeral, and the per-turn tail
// is literally `systemPrompt.slice(stableSystemBase.length)` — a POSITIONAL split. So
// anything per-job appended before that capture silently changes the cached prefix on
// every job and destroys prompt caching. There is no runtime symptom: the answers stay
// correct and the bill goes up. These assertions are made against the source of chat.js
// because that is where the mistake would be made.

const fs = require('node:fs');
const path = require('node:path');
const CHAT_SRC = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
const chatLineOf = (needle) => {
  const idx = CHAT_SRC.indexOf(needle);
  assert.ok(idx > 0, `expected to find ${JSON.stringify(needle)} in chat.js`);
  return CHAT_SRC.slice(0, idx).split('\n').length;
};

test('entity cards are injected AFTER the cached prefix is captured', () => {
  const captureLine = chatLineOf('const stableSystemBase = systemPrompt;');
  const injectLine = chatLineOf('entityResolver.formatCardsForPrompt(');
  assert.ok(
    injectLine > captureLine,
    `entity cards are injected at line ${injectLine}, which is at or above the cached-prefix `
    + `capture at line ${captureLine}. Per-job content above that line is baked into the `
    + `cached prefix and breaks prompt caching on every job.`
  );
});

test('chat.js builds the cards from this job, not the whole address book', () => {
  // The behaviour is covered above; this guards the wiring, because the mistake is
  // invisible from the outside — the prompt still looks well-formed, it is just
  // telling the model about people who are on a different job.
  const cardsCall = CHAT_SRC.slice(0, CHAT_SRC.indexOf('entityResolver.formatCardsForPrompt('));
  const lastSelect = cardsCall.lastIndexOf('selectJobEntities(');
  const lastListAll = cardsCall.lastIndexOf('.listEntities(db, { userId })');
  assert.ok(lastSelect > 0, 'entity cards must be built from entityResolver.selectJobEntities');
  assert.ok(lastSelect > lastListAll, 'entity cards must not be built from every entity the builder has');
});

test('entity cards are appended, never spliced into the prefix', () => {
  // The tail only works because every injection is a `systemPrompt +=`. A direct
  // assignment or a splice would break the slice() that derives the tail.
  const after = CHAT_SRC.slice(CHAT_SRC.indexOf('const stableSystemBase = systemPrompt;'));
  const injection = after.slice(after.indexOf('entityResolver.formatCardsForPrompt('));
  const statementStart = injection.lastIndexOf('systemPrompt', 0) === 0;
  assert.ok(
    /systemPrompt \+=\s*[\s\S]{0,120}entityResolver\.formatCardsForPrompt\(/.test(after) || statementStart,
    'entity cards must be appended with `systemPrompt +=`'
  );
});

test('the cached prefix is identical for two different jobs', () => {
  // The behavioural counterpart to the source check above: whatever the cards say, the
  // bytes before the cache breakpoint must not move.
  const db = freshDb();
  const { hughes, kerr } = seed(db);
  es.addFact(db, { userId: 'u1', entityId: hughes.id, content: 'Wants the kitchen as a PC sum' });
  es.addFact(db, { userId: 'u1', entityId: kerr.id, content: 'Drawings usually lack drainage' });

  // Stand in for buildSystemPrompt: the same base for this user on any job.
  const base = 'IDENTITY + RULES + RATE LIBRARY (stable for this user)';
  const jobA = base + er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [hughes.id] }));
  const jobB = base + er.formatCardsForPrompt(er.buildCards(db, { userId: 'u1', entityIds: [kerr.id] }));

  assert.strictEqual(jobA.slice(0, base.length), jobB.slice(0, base.length), 'cached prefix moved');
  assert.notStrictEqual(jobA, jobB, 'the tails genuinely differ, so this test is not vacuous');
  assert.match(jobA.slice(base.length), /Mrs Hughes/);
  assert.match(jobB.slice(base.length), /Kerr Architects/);
});

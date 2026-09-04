// Tests for cross-session recall.
//
// A conversation summary is JOB-shaped: it names the client, the site and the scope.
// The block it lands in is headed "RELEVANT PAST CONVERSATIONS", so whatever comes back
// is offered to the model as continuity with the job in hand. Handing over the three
// most recent conversations because nothing better was found is not a weak answer, it is
// a wrong one — it puts the last job's client in front of a brand-new set of drawings.
//
// Voyage embeddings are unavailable in tests (no key), which is also how the portal runs
// whenever VOYAGE_API_KEY is unset — so this is the path these tests exercise.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const autoLearn = require('./autoLearn');

function freshDb() {
  const db = new Database(':memory:');
  // The same shape ensureSchema creates. Declared here because ensureSchema
  // remembers that it has run, and these tests want a clean database each time.
  db.exec(`CREATE TABLE conversation_summaries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    title TEXT,
    summary TEXT NOT NULL,
    msg_count INTEGER DEFAULT 0,
    embedding BLOB,
    embedding_model TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

function addSummary(db, { id, userId = 'u1', sessionId, title, summary, updatedAt }) {
  db.prepare(`INSERT INTO conversation_summaries (id, user_id, session_id, title, summary, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId, sessionId, title, summary, updatedAt);
}

function seed(db) {
  addSummary(db, {
    id: 's1', sessionId: 'cs_nhs', title: 'Northfield NHS Trust ward refurbishment',
    summary: 'Priced a ward refurbishment for Northfield NHS Trust under their framework. Employer is the Trust, CA ref NHS-771.',
    updatedAt: '2026-03-01T10:00:00Z',
  });
  addSummary(db, {
    id: 's2', sessionId: 'cs_mount', title: 'The Mount — barn conversion',
    summary: 'Measured the barn conversion at The Mount for Mr and Mrs Ellis. Oak frame, underfloor heating.',
    updatedAt: '2026-02-01T10:00:00Z',
  });
}

test('a past conversation about this job is recalled', async () => {
  const db = freshDb();
  seed(db);
  const hits = await autoLearn.retrieveRelevantSummaries(db, {
    userId: 'u1', query: 'revised drawings for the Mount barn conversion', excludeSessionId: 'cs_new',
  });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].session_id, 'cs_mount');
});

test('the most recent job is not handed over as "relevant" to a different one', async () => {
  const db = freshDb();
  seed(db);
  const hits = await autoLearn.retrieveRelevantSummaries(db, {
    userId: 'u1', query: 'quote for a two storey side extension in Harrogate', excludeSessionId: 'cs_new',
  });
  assert.deepStrictEqual(hits, [], 'recency is not relevance — the NHS job has nothing to do with this one');
});

test('a single word in common is not enough to recall a job', async () => {
  const db = freshDb();
  seed(db);
  const hits = await autoLearn.retrieveRelevantSummaries(db, {
    userId: 'u1', query: 'here are the revised drawings, please reprice the framework', excludeSessionId: 'cs_new',
  });
  assert.deepStrictEqual(hits, []);
});

test('the conversation in progress is never recalled into itself', async () => {
  const db = freshDb();
  seed(db);
  const hits = await autoLearn.retrieveRelevantSummaries(db, {
    userId: 'u1', query: 'Northfield NHS Trust ward framework', excludeSessionId: 'cs_nhs',
  });
  assert.deepStrictEqual(hits, []);
});

test('recall never crosses builders', async () => {
  const db = freshDb();
  seed(db);
  const hits = await autoLearn.retrieveRelevantSummaries(db, { userId: 'u2', query: 'Northfield NHS Trust ward framework' });
  assert.deepStrictEqual(hits, []);
});

test('an empty query recalls nothing rather than everything', async () => {
  const db = freshDb();
  seed(db);
  assert.deepStrictEqual(await autoLearn.retrieveRelevantSummaries(db, { userId: 'u1', query: '' }), []);
});

test('recall is capped', async () => {
  const db = freshDb();
  for (let i = 0; i < 6; i++) {
    addSummary(db, {
      id: `s${i}`, sessionId: `cs_${i}`, title: 'Mount barn conversion',
      summary: 'Barn conversion at The Mount for Mr and Mrs Ellis.',
      updatedAt: '2026-03-01T10:00:00Z',
    });
  }
  const hits = await autoLearn.retrieveRelevantSummaries(db, { userId: 'u1', query: 'Mount barn conversion Ellis', topK: 3 });
  assert.strictEqual(hits.length, 3);
});

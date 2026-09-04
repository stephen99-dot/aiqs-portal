// Tests for memory retrieval.
//
// The block these memories land in is headed "USER-VERIFIED MEMORY … treat them as
// authoritative", so what retrieval hands back is not a suggestion to the model — it is
// stated as fact about the job in hand. That makes the interesting question not "did we
// find something" but "did we find something RELEVANT", because the failure mode is
// silent: the previous job's client and site, returned as the best of a bad set, are read
// as this job's and end up on the bill.
//
// Voyage embeddings are unavailable in tests (no key), so these exercise the keyword and
// no-match paths — which is also how the portal runs whenever VOYAGE_API_KEY is unset.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const memoryStore = require('./memoryStore');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      source TEXT DEFAULT 'chat',
      confidence REAL DEFAULT 0.8,
      embedding BLOB,
      embedding_model TEXT,
      is_active INTEGER DEFAULT 1,
      use_count INTEGER DEFAULT 0,
      last_used_at DATETIME,
      source_session_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE VIRTUAL TABLE user_memories_fts USING fts5(
      content, category, user_id UNINDEXED, memory_id UNINDEXED,
      tokenize = 'porter unicode61'
    );
  `);
  return db;
}

async function seed(db) {
  await memoryStore.createMemory(db, {
    userId: 'u1', category: 'commercial',
    content: 'Northfield NHS Trust job: employer is the Trust, CA ref NHS-771, priced under a framework',
  });
  await memoryStore.createMemory(db, {
    userId: 'u1', category: 'markup',
    content: 'Overheads and profit are always taken at 12 per cent',
  });
}

test('a memory that matches the turn is retrieved', async () => {
  const db = freshDb();
  await seed(db);
  const hits = await memoryStore.retrieveRelevant(db, { userId: 'u1', query: 'what overheads should I be using' });
  assert.strictEqual(hits.length, 1);
  assert.match(hits[0].content, /12 per cent/);
});

test('nothing relevant means nothing injected, not the pick of a bad set', async () => {
  const db = freshDb();
  await seed(db);
  const hits = await memoryStore.retrieveRelevant(db, {
    userId: 'u1',
    query: 'revised drawings for The Mount TM-104 elevations',
  });
  assert.deepStrictEqual(hits, [], 'an unrelated job\'s memories must not be stated as facts about this one');
});

test('one word of trade vocabulary in common is not relevance', async () => {
  const db = freshDb();
  await memoryStore.createMemory(db, {
    userId: 'u1', category: 'commercial',
    content: 'Northfield NHS Trust: drawings issued in three packages, employer is the Trust',
  });
  const hits = await memoryStore.retrieveRelevant(db, {
    userId: 'u1',
    query: 'here are the revised drawings for The Mount, please reprice',
  });
  assert.deepStrictEqual(hits, [], 'both jobs have drawings; that says nothing about this one');
});

test('memories never cross builders', async () => {
  const db = freshDb();
  await seed(db);
  const hits = await memoryStore.retrieveRelevant(db, { userId: 'u2', query: 'overheads' });
  assert.deepStrictEqual(hits, []);
});

test('an inactive memory stays out of retrieval', async () => {
  const db = freshDb();
  await seed(db);
  const all = memoryStore.listMemories(db, { userId: 'u1' });
  const markup = all.find(m => m.category === 'markup');
  await memoryStore.updateMemory(db, { id: markup.id, userId: 'u1', isActive: false });
  const hits = await memoryStore.retrieveRelevant(db, { userId: 'u1', query: 'overheads and profit' });
  assert.deepStrictEqual(hits, []);
});

test('no query at all still returns something to work with', async () => {
  // The caller asked for memories without saying what about, so recency is all
  // there is — and it was asked for, rather than substituted for relevance.
  const db = freshDb();
  await seed(db);
  const hits = await memoryStore.retrieveRelevant(db, { userId: 'u1', query: '' });
  assert.strictEqual(hits.length, 2);
});

test('an empty store is empty, not an error', async () => {
  const db = freshDb();
  assert.deepStrictEqual(await memoryStore.retrieveRelevant(db, { userId: 'u1', query: 'anything' }), []);
});

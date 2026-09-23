// Tests for the credits a new self-signup starts with.
//
// What matters: everyone gets 150 message credits; the free BOQ credit goes
// only to people who didn't buy a pack before signing up; it never doubles.
//
// In-memory database throughout — never the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { grantSignupCredits } = require('./signupCredits');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, free_credits INTEGER DEFAULT 0, message_credits INTEGER DEFAULT 0, updated_at DATETIME);
    CREATE TABLE usage_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
    CREATE TABLE pending_credits (id TEXT PRIMARY KEY, stripe_session_id TEXT, email TEXT, credits INTEGER, claimed_at DATETIME);
  `);
  return db;
}
const balance = (db, id) => db.prepare('SELECT free_credits, message_credits FROM users WHERE id = ?').get(id);

test('a fresh signup gets 150 message credits and 1 free BOQ credit', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, role) VALUES ('u1', 'joe@example.com', 'client')").run();
  assert.deepStrictEqual(grantSignupCredits({ id: 'u1', email: 'joe@example.com', role: 'client' }, { db }), { messages: 150, boq: 1 });
  assert.deepStrictEqual(balance(db, 'u1'), { free_credits: 1, message_credits: 150 });
});

test('someone who bought a pack before signing up gets no free BOQ credit', () => {
  const db = freshDb();
  db.prepare("INSERT INTO pending_credits (id, stripe_session_id, email, credits) VALUES ('p1', 'cs_1', 'Buyer@Example.com', 5)").run();
  db.prepare("INSERT INTO users (id, email, role) VALUES ('u2', 'buyer@example.com', 'client')").run();
  grantSignupCredits({ id: 'u2', email: 'buyer@example.com', role: 'client' }, { db });
  assert.deepStrictEqual(balance(db, 'u2'), { free_credits: 0, message_credits: 150 });
});

test('a payment whose amount matched no pack still counts as buying first', () => {
  const db = freshDb();
  db.prepare("INSERT INTO pending_credits (id, stripe_session_id, email, credits) VALUES ('p1', 'cs_1', 'odd@example.com', 0)").run();
  db.prepare("INSERT INTO users (id, email, role) VALUES ('u3', 'odd@example.com', 'client')").run();
  grantSignupCredits({ id: 'u3', email: 'odd@example.com', role: 'client' }, { db });
  assert.strictEqual(balance(db, 'u3').free_credits, 0);
});

test('a payment an earlier account already claimed does not cost a new signup its free BOQ', () => {
  const db = freshDb();
  db.prepare("INSERT INTO pending_credits (id, stripe_session_id, email, credits, claimed_at) VALUES ('p1', 'cs_1', 'again@example.com', 5, CURRENT_TIMESTAMP)").run();
  db.prepare("INSERT INTO users (id, email, role) VALUES ('u9', 'again@example.com', 'client')").run();
  grantSignupCredits({ id: 'u9', email: 'again@example.com', role: 'client' }, { db });
  assert.deepStrictEqual(balance(db, 'u9'), { free_credits: 1, message_credits: 150 });
});

test('granting twice does not double up', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, role) VALUES ('u4', 'a@example.com', 'client')").run();
  grantSignupCredits({ id: 'u4', email: 'a@example.com', role: 'client' }, { db });
  assert.deepStrictEqual(grantSignupCredits({ id: 'u4', email: 'a@example.com', role: 'client' }, { db }), { messages: 0, boq: 0 });
  assert.deepStrictEqual(balance(db, 'u4'), { free_credits: 1, message_credits: 150 });
});

test('admins get nothing (they are unlimited anyway)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, role) VALUES ('a1', 'admin@example.com', 'admin')").run();
  grantSignupCredits({ id: 'a1', email: 'admin@example.com', role: 'admin' }, { db });
  assert.deepStrictEqual(balance(db, 'a1'), { free_credits: 0, message_credits: 0 });
});

test('accounts made another way get the message credits but no free BOQ credit from here', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, role, free_credits) VALUES ('u5', 'email@example.com', 'client', 1)").run();
  assert.deepStrictEqual(grantSignupCredits({ id: 'u5', email: 'email@example.com', role: 'client' }, { freeBoq: false, db }), { messages: 150, boq: 0 });
  assert.deepStrictEqual(balance(db, 'u5'), { free_credits: 1, message_credits: 150 });
});

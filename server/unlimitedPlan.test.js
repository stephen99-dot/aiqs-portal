// Tests for the Unlimited plan: unlimited BOQs (never deducted) and the
// message grant that comes with it.
//
// What matters: an Unlimited client's BOQ balance reads as unlimited and a
// spend never touches their stored credits; applying the plan tops messages
// up to the plan figure without ever reducing a higher balance or doubling
// up on re-save; removing the plan puts them back on their stored credits.
//
// In-memory database throughout — never the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const { getBoqBalance, consumeBoqCredit } = require('./boqCredits');
const { grantUnlimitedPlan, hasUnlimitedBoqs, isUnlimitedPlan, UNLIMITED_PLAN, UNLIMITED_PLAN_MESSAGES } = require('./unlimitedPlan');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, role TEXT DEFAULT 'client', plan TEXT DEFAULT 'starter',
      free_credits INTEGER DEFAULT 0, bonus_docs INTEGER DEFAULT 0, message_credits INTEGER DEFAULT 0,
      credits_out_at DATETIME, credit_reminder_stage INTEGER DEFAULT 0, updated_at DATETIME
    );
    CREATE TABLE usage_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
    CREATE TABLE drawing_submissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
  `);
  return db;
}
const addUser = (db, id, cols = {}) => {
  const all = { email: id + '@example.com', role: 'client', plan: 'starter', free_credits: 0, bonus_docs: 0, message_credits: 0, ...cols };
  const keys = Object.keys(all);
  db.prepare(`INSERT INTO users (id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`).run(id, ...keys.map(k => all[k]));
};
const row = (db, id) => db.prepare('SELECT plan, free_credits, bonus_docs, message_credits, credits_out_at, credit_reminder_stage FROM users WHERE id = ?').get(id);

test('hasUnlimitedBoqs: admins and Unlimited-plan clients only', () => {
  assert.strictEqual(hasUnlimitedBoqs({ role: 'admin', plan: 'starter' }), true);
  assert.strictEqual(hasUnlimitedBoqs({ role: 'client', plan: UNLIMITED_PLAN }), true);
  assert.strictEqual(hasUnlimitedBoqs({ role: 'client', plan: 'starter' }), false);
  assert.strictEqual(hasUnlimitedBoqs({ role: 'client', plan: 'professional' }), false);
  assert.strictEqual(hasUnlimitedBoqs({ role: 'client', plan: 'premium' }), false);
  assert.strictEqual(hasUnlimitedBoqs(null), false);
  assert.strictEqual(isUnlimitedPlan({ role: 'admin', plan: 'starter' }), false);
  assert.strictEqual(UNLIMITED_PLAN, 'unlimited');
  assert.strictEqual(UNLIMITED_PLAN_MESSAGES, 1000);
});

test('a pay-as-you-go client still spends: bonus first, then purchased credits', () => {
  const db = freshDb();
  addUser(db, 'payg', { free_credits: 2, bonus_docs: 1 });
  const before = getBoqBalance('payg', { db });
  assert.deepStrictEqual(before, { total: 3, free: 2, bonus: 1, used: 0, isAdmin: false, unlimited: false });
  const after = consumeBoqCredit('payg', { db });
  assert.strictEqual(after.total, 2);
  assert.deepStrictEqual(row(db, 'payg').bonus_docs, 0);
  assert.deepStrictEqual(row(db, 'payg').free_credits, 2);
});

test('an Unlimited client reads as unlimited and a spend never touches their stored credits', () => {
  const db = freshDb();
  addUser(db, 'unl', { plan: UNLIMITED_PLAN, free_credits: 2, bonus_docs: 1 });
  const bal = getBoqBalance('unl', { db });
  assert.strictEqual(bal.total, Infinity);
  assert.strictEqual(bal.unlimited, true);
  assert.strictEqual(bal.isAdmin, false);
  assert.strictEqual(bal.free, 2);
  assert.strictEqual(bal.bonus, 1);

  for (let i = 0; i < 5; i++) {
    const after = consumeBoqCredit('unl', { db });
    assert.strictEqual(after.total, Infinity);
    assert.strictEqual(after.unlimited, true);
  }
  const r = row(db, 'unl');
  assert.strictEqual(r.free_credits, 2);
  assert.strictEqual(r.bonus_docs, 1);
});

test('an Unlimited client with no stored credits is still unlimited', () => {
  const db = freshDb();
  addUser(db, 'unl0', { plan: UNLIMITED_PLAN });
  assert.strictEqual(getBoqBalance('unl0', { db }).total, Infinity);
  assert.strictEqual(consumeBoqCredit('unl0', { db }).total, Infinity);
  assert.strictEqual(row(db, 'unl0').free_credits, 0);
});

test('lifetime usage is still counted for an Unlimited client (for the admin screens)', () => {
  const db = freshDb();
  addUser(db, 'unl', { plan: UNLIMITED_PLAN });
  db.prepare("INSERT INTO usage_log (id, user_id, action) VALUES ('l1', 'unl', 'doc_generated')").run();
  db.prepare("INSERT INTO usage_log (id, user_id, action) VALUES ('l2', 'unl', 'doc_revision')").run();
  db.prepare("INSERT INTO drawing_submissions (id, user_id) VALUES ('s1', 'unl')").run();
  assert.strictEqual(getBoqBalance('unl', { db }).used, 2);
});

test('admins are unchanged: unlimited, no stored credits reported, never charged', () => {
  const db = freshDb();
  addUser(db, 'adm', { role: 'admin', free_credits: 4 });
  assert.deepStrictEqual(getBoqBalance('adm', { db }), { total: Infinity, free: 0, bonus: 0, used: 0, isAdmin: true, unlimited: true });
  consumeBoqCredit('adm', { db });
  assert.strictEqual(row(db, 'adm').free_credits, 4);
});

test('applying the plan tops the message balance up to the plan figure', () => {
  const db = freshDb();
  addUser(db, 'u1', { message_credits: 150 });
  const grant = grantUnlimitedPlan('u1', { db });
  assert.deepStrictEqual(grant, { wasUnlimited: false, messagesBefore: 150, messagesAfter: 1000, messagesGranted: 850 });
  const r = row(db, 'u1');
  assert.strictEqual(r.plan, UNLIMITED_PLAN);
  assert.strictEqual(r.message_credits, 1000);
  assert.strictEqual(getBoqBalance('u1', { db }).total, Infinity);
});

test('applying the plan never reduces a higher message balance', () => {
  const db = freshDb();
  addUser(db, 'rich', { message_credits: 1500 });
  const grant = grantUnlimitedPlan('rich', { db });
  assert.strictEqual(grant.messagesGranted, 0);
  assert.strictEqual(row(db, 'rich').message_credits, 1500);
});

test('re-saving the plan on someone already on it does not re-grant messages', () => {
  const db = freshDb();
  addUser(db, 'u2', { message_credits: 0 });
  grantUnlimitedPlan('u2', { db });
  db.prepare('UPDATE users SET message_credits = 400 WHERE id = ?').run('u2'); // they've chatted a while
  const again = grantUnlimitedPlan('u2', { db });
  assert.deepStrictEqual(again, { wasUnlimited: true, messagesBefore: 400, messagesAfter: 400, messagesGranted: 0 });
  assert.strictEqual(row(db, 'u2').message_credits, 400);
  // ...unless the top-up is asked for explicitly.
  const forced = grantUnlimitedPlan('u2', { db, topUpMessages: true });
  assert.strictEqual(forced.messagesAfter, 1000);
  assert.strictEqual(row(db, 'u2').message_credits, 1000);
});

test('applying the plan stops the out-of-credits reminder drip', () => {
  const db = freshDb();
  addUser(db, 'dry', { credits_out_at: '2026-09-01 10:00:00', credit_reminder_stage: 3 });
  grantUnlimitedPlan('dry', { db });
  const r = row(db, 'dry');
  assert.strictEqual(r.credits_out_at, null);
  assert.strictEqual(r.credit_reminder_stage, 0);
});

test('removing the plan puts the client back on their stored credits', () => {
  const db = freshDb();
  addUser(db, 'back', { free_credits: 2, message_credits: 100 });
  grantUnlimitedPlan('back', { db });
  consumeBoqCredit('back', { db }); // free while unlimited
  db.prepare("UPDATE users SET plan = 'starter' WHERE id = ?").run('back');
  const bal = getBoqBalance('back', { db });
  assert.deepStrictEqual(bal, { total: 2, free: 2, bonus: 0, used: 0, isAdmin: false, unlimited: false });
  assert.strictEqual(consumeBoqCredit('back', { db }).total, 1);
  assert.strictEqual(row(db, 'back').message_credits, 1000); // the granted messages stay
});

test('granting to an unknown user is a no-op', () => {
  const db = freshDb();
  assert.strictEqual(grantUnlimitedPlan('ghost', { db }), null);
});

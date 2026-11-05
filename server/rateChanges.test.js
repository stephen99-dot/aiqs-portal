// Rate-change roll-ups: one bell + one email per client once they've stopped
// editing, never twice, never for admins.
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { createTracker, QUIET_MS, MAX_WAIT_MS } = require('./rateChanges');

function harness() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, full_name TEXT, company TEXT, role TEXT);
    CREATE TABLE client_rate_library (id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, type TEXT, title TEXT, detail TEXT, icon TEXT, read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users VALUES ('u1', 'jo@builder.co.uk', 'Jo Builder', 'Builder Ltd', 'client');
    INSERT INTO users VALUES ('a1', 'hello@crmwizardai.com', 'Admin', NULL, 'admin');
    INSERT INTO client_rate_library VALUES ('r1', 'u1', 1), ('r2', 'u1', 1), ('r3', 'u1', 0);
  `);
  let clock = 1_000_000;
  const mails = [], activity = [];
  const tracker = createTracker({
    db,
    mailer: { sendMail: async (m) => { mails.push(m); return { ok: true }; }, BASE_URL: 'https://portal.test' },
    logActivity: (e) => activity.push(e),
    adminEmail: 'hello@crmwizardai.com',
    now: () => clock,
  });
  return { db, tracker, mails, activity, tick: (ms) => { clock += ms; }, now: () => clock };
}

test('changes roll up into one alert, sent after the quiet window, once', async () => {
  const h = harness();
  const jo = { id: 'u1', role: 'client' };
  assert.strictEqual(h.tracker.record(jo, { source: 'manual', updated: 1 }), true);
  h.tick(60_000);
  h.tracker.record(jo, { source: 'import', added: 3, updated: 2 });
  h.tracker.record(jo, { source: 'manual', removed: 1 });

  // Still editing: nothing goes out.
  assert.deepStrictEqual(await h.tracker.sweep(), []);
  assert.strictEqual(h.mails.length, 0);

  h.tick(QUIET_MS + 1);
  const sent = await h.tracker.sweep();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].who, 'Jo Builder');
  assert.strictEqual(sent[0].counts, '3 rates updated · 3 rates added · 1 rate removed');
  assert.strictEqual(sent[0].how, 'via the My Rates page and an Excel import');
  assert.strictEqual(sent[0].total, 2, 'counts active rates only');

  const bell = h.db.prepare('SELECT * FROM notifications').all();
  assert.strictEqual(bell.length, 1);
  assert.strictEqual(bell[0].type, 'rates_updated');
  assert.strictEqual(bell[0].title, 'Jo Builder updated their rates');
  assert.match(bell[0].detail, /3 rates updated · 3 rates added · 1 rate removed — via the My Rates page and an Excel import/);

  assert.strictEqual(h.mails.length, 1);
  assert.strictEqual(h.mails[0].to, 'hello@crmwizardai.com');
  assert.match(h.mails[0].subject, /^Rates updated — Jo Builder \(3 rates updated/);
  assert.ok(h.mails[0].paragraphs[0].includes('Builder Ltd') && h.mails[0].paragraphs[0].includes('jo@builder.co.uk'));
  assert.strictEqual(h.mails[0].ctaUrl, 'https://portal.test/admin/users');

  assert.strictEqual(h.activity.length, 1);
  assert.strictEqual(h.activity[0].event_type, 'rates_updated');

  // Never twice.
  h.tick(QUIET_MS);
  assert.deepStrictEqual(await h.tracker.sweep(), []);
  assert.strictEqual(h.mails.length, 1);
});

test('a client who keeps editing still gets reported at the maximum wait', async () => {
  const h = harness();
  const jo = { id: 'u1', role: 'client' };
  h.tracker.record(jo, { source: 'manual', updated: 1 });
  // An edit every 4 minutes keeps resetting the quiet window…
  for (let i = 0; i < 4; i++) {
    h.tick(4 * 60_000);
    h.tracker.record(jo, { source: 'manual', updated: 1 });
    assert.strictEqual((await h.tracker.sweep()).length, 0, 'not yet at edit ' + i);
  }
  // …but 20 minutes after the first change it goes regardless.
  h.tick(4 * 60_000 + 1);
  assert.ok(h.now() - 1_000_000 > MAX_WAIT_MS);
  const sent = await h.tracker.sweep();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].counts, '5 rates updated');
});

test('admins and empty changes are ignored; each client gets their own roll-up', async () => {
  const h = harness();
  assert.strictEqual(h.tracker.record({ id: 'a1', role: 'admin' }, { source: 'manual', updated: 1 }), false);
  assert.strictEqual(h.tracker.record({ id: 'u1', role: 'client' }, { source: 'manual' }), false);
  assert.strictEqual(h.tracker.record(null, { updated: 1 }), false);
  h.db.prepare("INSERT INTO users VALUES ('u2', 'sam@roofs.co.uk', 'Sam', NULL, 'client')").run();
  h.tracker.record({ id: 'u1' }, { source: 'chat', updated: 2 });
  h.tracker.record({ id: 'u2' }, { source: 'tender_return', updated: 1 });
  h.tick(QUIET_MS + 1);
  const sent = await h.tracker.sweep();
  assert.deepStrictEqual(sent.map((s) => s.who).sort(), ['Jo Builder', 'Sam']);
  assert.strictEqual(h.mails.length, 2);
  assert.strictEqual(h.db.prepare('SELECT COUNT(*) AS c FROM rate_change_digests').get().c, 0);
});

test('a roll-up whose user has since been deleted is dropped quietly', async () => {
  const h = harness();
  h.tracker.record({ id: 'ghost' }, { source: 'manual', updated: 1 });
  h.tick(QUIET_MS + 1);
  assert.deepStrictEqual(await h.tracker.sweep(), []);
  assert.strictEqual(h.mails.length, 0);
  assert.strictEqual(h.db.prepare('SELECT COUNT(*) AS c FROM rate_change_digests').get().c, 0);
});

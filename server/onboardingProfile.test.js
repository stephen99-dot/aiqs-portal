// Tests for onboarding submission storage and the admin download.
//
// What matters: a completed onboarding is kept verbatim and comes back out —
// in the admin list, as ordered label/value rows, and as a valid workbook —
// and junk input can't corrupt any of that.
//
// In-memory database throughout — never the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const op = require('./onboardingProfile');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, full_name TEXT, company TEXT
    );
    CREATE TABLE user_branding (
      user_id TEXT PRIMARY KEY, logo_filename TEXT
    );
  `);
  db.prepare("INSERT INTO users (id, email, full_name, company) VALUES ('u1', 'joe@example.com', 'Joe Bloggs', 'Bloggs Electrics')").run();
  return db;
}

const QUAL = {
  years_trading: '3–10 years',
  team_size: '2–5',
  regions: 'Kent',
  typical_job_value: '£5k – £25k',
  day_rate: 360,
  specialisms: ['Rewires', 'EV chargers'],
  certifications: ['NICEIC'],
};

test('saveSubmission keeps the whole submission and getSubmission joins the user', () => {
  const db = freshDb();
  const row = op.saveSubmission(db, { userId: 'u1', trade: 'Electrician', qualifying: QUAL, notes: 'Mostly domestic.' });
  assert.ok(row.id.startsWith('ob_'));

  const full = op.getSubmission(db, row.id);
  assert.strictEqual(full.trade, 'Electrician');
  assert.strictEqual(full.full_name, 'Joe Bloggs');
  assert.strictEqual(full.notes, 'Mostly domestic.');
  assert.deepStrictEqual(JSON.parse(full.qualifying).specialisms, ['Rewires', 'EV chargers']);
});

test('listSubmissions surfaces who submitted and whether a logo is downloadable', () => {
  const db = freshDb();
  op.saveSubmission(db, { userId: 'u1', trade: 'Electrician', qualifying: QUAL, notes: '' });
  let rows = op.listSubmissions(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].email, 'joe@example.com');
  assert.strictEqual(rows[0].has_logo, 0);

  db.prepare("INSERT INTO user_branding (user_id, logo_filename) VALUES ('u1', 'logo.png')").run();
  rows = op.listSubmissions(db);
  assert.strictEqual(rows[0].has_logo, 1);
});

test('re-running onboarding keeps history as separate submissions', () => {
  const db = freshDb();
  op.saveSubmission(db, { userId: 'u1', trade: 'Electrician', qualifying: QUAL });
  op.saveSubmission(db, { userId: 'u1', trade: 'Solar PV installer', qualifying: { day_rate: 400 } });
  assert.strictEqual(op.listSubmissions(db).length, 2);
});

test('answerRows come out in question order with human labels', () => {
  const db = freshDb();
  const row = op.saveSubmission(db, { userId: 'u1', trade: 'Electrician', qualifying: QUAL });
  const rows = op.answerRows(op.getSubmission(db, row.id));
  const labels = rows.map(r => r[0]);
  assert.ok(labels[0].startsWith('How long have you been'), 'expected question order, got: ' + labels[0]);
  const spec = rows.find(r => r[0].includes('kind of work'));
  assert.strictEqual(spec[1], 'Rewires, EV chargers');
});

test('answerRows survives an id the catalogue no longer knows', () => {
  const db = freshDb();
  const row = op.saveSubmission(db, { userId: 'u1', trade: 'Electrician', qualifying: { retired_question: 'yes', day_rate: 360 } });
  const rows = op.answerRows(op.getSubmission(db, row.id));
  assert.ok(rows.some(r => r[0] === 'retired_question' && r[1] === 'yes'));
});

test('junk input is bounded, not fatal', () => {
  const db = freshDb();
  const row = op.saveSubmission(db, {
    userId: 'u1',
    trade: 'x'.repeat(500),
    qualifying: ['not', 'an', 'object'],
    notes: 'n'.repeat(9000),
  });
  assert.strictEqual(row.trade.length, 80);
  assert.strictEqual(row.notes.length, 4000);
  assert.deepStrictEqual(JSON.parse(row.qualifying), {});
  assert.strictEqual(op.saveSubmission(db, { userId: null }), null);
});

test('buildWorkbook produces a real xlsx with the answers on it', async () => {
  const db = freshDb();
  const row = op.saveSubmission(db, { userId: 'u1', trade: 'Electrician', qualifying: QUAL, notes: 'Mostly domestic.' });
  const wb = await op.buildWorkbook(op.getSubmission(db, row.id), null);
  const ws = wb.getWorksheet('Onboarding profile');
  assert.ok(ws, 'worksheet missing');

  const cells = [];
  ws.eachRow(r => r.eachCell(c => cells.push(String(c.value))));
  assert.ok(cells.some(v => v.includes('Joe Bloggs')));
  assert.ok(cells.includes('Electrician'));
  assert.ok(cells.includes('Rewires, EV chargers'));
  assert.ok(cells.includes('Mostly domestic.'));

  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.length > 1000, 'workbook suspiciously small');
});

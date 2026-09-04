// Tests for "a revision of WHAT?".
//
// The rule being defended is a promise to a paying customer: one revision included
// per BOQ. It used to be tested against the account's most recently generated
// document rather than the job in hand, so a builder uploading revised drawings for
// one job could be refused because a DIFFERENT job had already used its revision —
// and refused by name for a project they had never mentioned. So these tests care
// most about the two ways that goes wrong: matching a job that is not this one, and
// failing to match the job that is.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const rs = require('./revisionScope');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE usage_log (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT, detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE drawing_submissions (
      id TEXT PRIMARY KEY, user_id TEXT, site_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

let n = 0;
function logDoc(db, { userId = 'u1', action = 'doc_generated', detail, when = '2026-04-01 09:00:00' }) {
  db.prepare('INSERT INTO usage_log (id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
    .run('ul_' + (++n), userId, action, detail, when);
}
function logSubmission(db, { userId = 'u1', site, when = '2026-03-01 09:00:00' }) {
  db.prepare('INSERT INTO drawing_submissions (id, user_id, site_address, created_at) VALUES (?,?,?,?)')
    .run('sub_' + (++n), userId, site, when);
}

// ── name matching ─────────────────────────────────────────────────────────────

test('the same site written two ways is the same job', () => {
  assert.ok(rs.sameJob('The Mount', 'the mount'));
  assert.ok(rs.sameJob('The Mount', 'The Mount, Harrogate'));
  assert.ok(rs.sameJob('Mount Farm Barn', 'the mount farm barn (revised)'));
});

test('two different jobs are not the same job', () => {
  assert.ok(!rs.sameJob('The Mount', 'Northfield NHS Trust — Ward 4'));
  assert.ok(!rs.sameJob('14 Mill Lane', '14 Mill Road'));
});

test('a name too thin to identify anything matches nothing', () => {
  assert.ok(!rs.sameJob('Flat 2', 'Flat 2, Bramble Court'));
  assert.ok(!rs.sameJob('', 'The Mount'));
  assert.ok(!rs.sameJob('Project', 'Project'), 'the placeholder name must never match a real job');
});

test('containment is whole words, not letters', () => {
  assert.ok(!rs.sameJob('The Mount', 'Mountain View Lodge'));
});

// ── finding the original ──────────────────────────────────────────────────────

test('another job\'s BOQ is not this job\'s original', () => {
  const db = freshDb();
  logDoc(db, { detail: 'Northfield NHS Trust — Ward 4', when: '2026-04-01 09:00:00' });
  assert.strictEqual(rs.findOriginalBoq(db, { userId: 'u1', projectName: 'The Mount, Harrogate' }), null);
});

test('this job\'s own BOQ is found even when a newer one exists for another job', () => {
  const db = freshDb();
  logDoc(db, { detail: 'The Mount', when: '2026-03-02 09:00:00' });
  logDoc(db, { detail: 'Northfield NHS Trust — Ward 4', when: '2026-04-01 09:00:00' });
  const found = rs.findOriginalBoq(db, { userId: 'u1', projectName: 'The Mount, Harrogate' });
  assert.strictEqual(found.name, 'The Mount');
  assert.strictEqual(found.source, 'chat');
});

test('an original bought through Submit Drawings still counts', () => {
  // The case that started this: the first set went through the Submit Drawings
  // page, the revision through the chat. Only usage_log was searched, so the
  // chat could not see the original and matched the wrong job instead.
  const db = freshDb();
  logSubmission(db, { site: 'The Mount, Harrogate' });
  const found = rs.findOriginalBoq(db, { userId: 'u1', projectName: 'The Mount' });
  assert.strictEqual(found.source, 'submission');
});

test('originals never cross accounts', () => {
  const db = freshDb();
  logDoc(db, { userId: 'u2', detail: 'The Mount' });
  logSubmission(db, { userId: 'u2', site: 'The Mount' });
  assert.strictEqual(rs.findOriginalBoq(db, { userId: 'u1', projectName: 'The Mount' }), null);
});

test('an unnamed job has no original rather than any original', () => {
  const db = freshDb();
  logDoc(db, { detail: 'The Mount' });
  assert.strictEqual(rs.findOriginalBoq(db, { userId: 'u1', projectName: '' }), null);
  assert.strictEqual(rs.findOriginalBoq(db, { userId: 'u1', projectName: 'Project' }), null);
});

test('missing tables are an empty answer, not a failed turn', () => {
  const db = new Database(':memory:');
  assert.strictEqual(rs.findOriginalBoq(db, { userId: 'u1', projectName: 'The Mount' }), null);
  assert.strictEqual(rs.countRevisions(db, { userId: 'u1', projectName: 'The Mount' }), 0);
});

// ── counting revisions ────────────────────────────────────────────────────────

test('another job\'s revision does not spend this job\'s', () => {
  const db = freshDb();
  logDoc(db, { action: 'doc_revision', detail: 'Northfield NHS Trust — Ward 4' });
  assert.strictEqual(rs.countRevisions(db, { userId: 'u1', projectName: 'The Mount' }), 0);
});

test('this job\'s revisions are counted, however the site was typed', () => {
  const db = freshDb();
  logDoc(db, { action: 'doc_revision', detail: 'The Mount, Harrogate' });
  assert.strictEqual(rs.countRevisions(db, { userId: 'u1', projectName: 'the mount' }), 1);
});

test('an original is not counted as a revision of itself', () => {
  const db = freshDb();
  logDoc(db, { action: 'doc_generated', detail: 'The Mount' });
  assert.strictEqual(rs.countRevisions(db, { userId: 'u1', projectName: 'The Mount' }), 0);
});

test('a job named only by its type never matches another of the same type', () => {
  // A take-off falls back to the project type when the drawings carry no address,
  // so two unrelated jobs can both be called "Loft Conversion". Sharing a revision
  // allowance between them would refuse one customer over the other's BOQ.
  assert.ok(!rs.sameJob('Loft Conversion', 'Loft Conversion'));
  assert.ok(!rs.sameJob('Residential Extension', 'Residential Extension'));
  assert.ok(!rs.sameJob('Full Refurbishment', 'Full Refurbishment, Leeds'));
});

test('a real site keeps matching even when it carries a type word', () => {
  assert.ok(rs.sameJob('The Mount — Full Refurbishment', 'The Mount'));
});

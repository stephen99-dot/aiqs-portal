process.env.PARTNER_ROUTES_FACTORY_ONLY = '1';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { createPartnerRouter } = require('./partnerRoutes');

// The account link AI Trades Pilot uses: peer key → lookup → link with the
// AI QS password → the linked user's BOQs, and nothing else.

const KEY = 'shared-peer-key';
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, full_name TEXT, company TEXT, suspended INTEGER DEFAULT 0, google_id TEXT);
    CREATE TABLE authorized_emails (id TEXT PRIMARY KEY, user_id TEXT, email TEXT UNIQUE, password_hash TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, project_type TEXT, description TEXT, location TEXT, status TEXT, total_value REAL, currency TEXT, item_count INTEGER, boq_filename TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE project_deliverables (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, filename TEXT, original_name TEXT, version INTEGER DEFAULT 1, is_latest INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  const hash = bcrypt.hashSync('Correct-Horse-9', 4);
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company) VALUES ('u1', 'bob@brickworks.co.uk', ?, 'Bob Mason', 'Brickworks Ltd')").run(hash);
  db.prepare("INSERT INTO users (id, email, password_hash, full_name) VALUES ('u2', 'other@example.com', ?, 'Someone Else')").run(hash);
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, google_id) VALUES ('u3', 'google@example.com', '', 'Google Only', 'g-1')").run();
  db.prepare("INSERT INTO projects (id, user_id, title, status, total_value, boq_filename) VALUES ('p1', 'u1', 'Loft conversion', 'completed', 48200, 'loft.xlsx')").run();
  db.prepare("INSERT INTO projects (id, user_id, title, status) VALUES ('p2', 'u1', 'Not priced yet', 'in_progress')").run();
  db.prepare("INSERT INTO projects (id, user_id, title, status) VALUES ('p3', 'u1', 'Delivered via deliverable', 'completed')").run();
  db.prepare("INSERT INTO project_deliverables (id, project_id, kind, filename, original_name) VALUES ('d1', 'p3', 'boq', 'garage.xlsx', 'Garage BOQ.xlsx')").run();
  db.prepare("INSERT INTO projects (id, user_id, title, status, boq_filename) VALUES ('p9', 'u2', 'Someone else''s job', 'completed', 'theirs.xlsx')").run();
  return db;
}

function serve(db, outputsDir) {
  const app = express();
  app.use(express.json());
  app.use('/api', createPartnerRouter({ db, outputsDir, getKey: () => KEY }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
function call(server, method, p, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p, method, headers: { 'Content-Type': 'application/json', ...(headers || {}) } }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch (e) {} resolve({ status: res.statusCode, json, text: buf, headers: res.headers }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const peer = { 'x-brain-key': KEY, 'x-brain-app': 'aitradespilot' };

test('every partner route refuses callers without the peer key', async () => {
  const server = await serve(freshDb(), os.tmpdir());
  try {
    assert.strictEqual((await call(server, 'POST', '/api/partner/account-lookup', { body: { email: 'bob@brickworks.co.uk' } })).status, 401);
    assert.strictEqual((await call(server, 'POST', '/api/partner/account-lookup', { body: { email: 'bob@brickworks.co.uk' }, headers: { 'x-brain-key': 'wrong' } })).status, 401);
    assert.strictEqual((await call(server, 'GET', '/api/partner/projects')).status, 401);
  } finally { server.close(); }
});

test('lookup says only whether the email has an account and how many BOQs', async () => {
  const server = await serve(freshDb(), os.tmpdir());
  try {
    const yes = await call(server, 'POST', '/api/partner/account-lookup', { body: { email: '  BOB@Brickworks.co.uk ' }, headers: peer });
    assert.deepStrictEqual(yes.json, { exists: true, boqs: 2 });
    const no = await call(server, 'POST', '/api/partner/account-lookup', { body: { email: 'nobody@example.com' }, headers: peer });
    assert.deepStrictEqual(no.json, { exists: false, boqs: 0 });
  } finally { server.close(); }
});

test('link needs the right AI QS password and then unlocks only that user\'s BOQs', async () => {
  const outputs = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-partner-'));
  fs.writeFileSync(path.join(outputs, 'loft.xlsx'), 'xlsx-bytes');
  const server = await serve(freshDb(), outputs);
  try {
    const bad = await call(server, 'POST', '/api/partner/link', { body: { email: 'bob@brickworks.co.uk', password: 'nope' }, headers: peer });
    assert.strictEqual(bad.status, 401);
    assert.strictEqual(bad.json.code, 'WRONG_PASSWORD');
    const google = await call(server, 'POST', '/api/partner/link', { body: { email: 'google@example.com', password: 'x' }, headers: peer });
    assert.strictEqual(google.json.code, 'GOOGLE_ONLY');

    const ok = await call(server, 'POST', '/api/partner/link', { body: { email: 'bob@brickworks.co.uk', password: 'Correct-Horse-9' }, headers: peer });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.json.link_token);
    assert.strictEqual(ok.json.user.fullName, 'Bob Mason');
    assert.strictEqual(ok.json.boqs, 2);

    const bearer = { ...peer, Authorization: 'Bearer ' + ok.json.link_token };
    const list = await call(server, 'GET', '/api/partner/projects', { headers: bearer });
    assert.deepStrictEqual(list.json.projects.map((p) => p.id).sort(), ['p1', 'p3'], 'priced projects only, and only Bob\'s');
    assert.ok(!('user_id' in list.json.projects[0]), 'no internal columns leak');

    const file = await call(server, 'GET', '/api/partner/projects/p1/boq', { headers: bearer });
    assert.strictEqual(file.status, 200);
    assert.strictEqual(file.text, 'xlsx-bytes');
    const theirs = await call(server, 'GET', '/api/partner/projects/p9/boq', { headers: bearer });
    assert.strictEqual(theirs.status, 404, 'another user\'s project is invisible');

    // A token signed with a different key, or the peer key alone, is not a link.
    const forged = await call(server, 'GET', '/api/partner/projects', { headers: { ...peer, Authorization: 'Bearer not-a-token' } });
    assert.strictEqual(forged.status, 401);
  } finally { server.close(); }
});

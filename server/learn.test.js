// The how-to videos: the catalogue, ticking them off per account, and the
// next steps that follow what the account has done.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-learn-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.MAX_ROLLOUT = 'all';

const db = require('./database');
const express = require('express');
const { generateToken } = require('./auth');

const app = express();
app.use(express.json());
app.use('/api', require('./routes'));
app.use('/api/learn', require('./learnRoutes'));
const server = app.listen(0);
const PORT = server.address().port;

// Alice has the Visualiser; Cara has MAX from the rollout and nothing else.
for (const [id, email, name, overrides] of [['a', 'alice@t.t', 'Alice Anderson', '{"visualiser":true}'], ['c', 'cara@t.t', 'Cara Cole', null]]) {
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country, feature_overrides) VALUES (?, ?, 'x', ?, 'Co', 'client', 'GB', ?)").run(id, email, name, overrides);
}
const tokenA = generateToken({ id: 'a', email: 'alice@t.t', role: 'client' });
const tokenC = generateToken({ id: 'c', email: 'cara@t.t', role: 'client' });

function req(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const r = http.request({ port: PORT, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': data.length } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let parsed = null; try { parsed = buf.length ? JSON.parse(buf.toString('utf8')) : null; } catch (e) { parsed = null; } resolve({ status: res.statusCode, body: parsed }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
test.after(() => server.close());

test('the catalogue, with nothing watched, and the next steps for each package', async () => {
  let r = await req('GET', '/learn', tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.body.videos.length, 10);
  assert.ok(r.body.videos.every((v) => v.watched_at === null && /^\/videos\/[a-z]+\.mp4$/.test(v.src) && /\.jpg$/.test(v.poster)));
  assert.deepEqual(r.body.progress, { watched: 0, total: 10 });
  assert.deepEqual(r.body.entitlements, { max: true, visualiser: true });
  const keys = r.body.next.map((s) => s.key);
  assert.deepEqual(keys, ['submit', 'job', 'max', 'visualiser', 'rates', 'branding'], 'every step, none done, nothing to upgrade');
  assert.ok(r.body.next.every((s) => s.done === false && s.path && s.video));
  r = await req('GET', '/learn', tokenC);
  assert.deepEqual(r.body.entitlements, { max: true, visualiser: false });
  assert.ok(!r.body.next.some((s) => s.key === 'visualiser'), 'no Visualiser step without the package');
  assert.equal((await req('GET', '/learn')).status, 401);
});

test('the one-time pointer to the videos shows once per account, and never counts as a video', async () => {
  let r = await req('GET', '/learn', tokenA);
  assert.equal(r.body.intro_seen, false);
  r = await req('POST', '/learn/intro/seen', tokenA, {});
  assert.equal(r.status, 200);
  r = await req('GET', '/learn', tokenA);
  assert.equal(r.body.intro_seen, true);
  assert.equal(r.body.progress.watched, 0, 'the prompt is not a video');
  assert.equal((await req('GET', '/learn', tokenC)).body.intro_seen, false, 'per account');
});

test('ticking a video off is per account, can be undone, and an unknown video is refused', async () => {
  let r = await req('POST', '/learn/max/watched', tokenA, { watched: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.watched_at);
  assert.deepEqual(r.body.progress, { watched: 1, total: 10 });
  r = await req('GET', '/learn', tokenA);
  assert.ok(r.body.videos.find((v) => v.key === 'max').watched_at);
  assert.equal(r.body.progress.watched, 1);
  r = await req('GET', '/learn', tokenC);
  assert.equal(r.body.progress.watched, 0, "Cara's list is her own");
  r = await req('POST', '/learn/max/watched', tokenA, {});
  assert.ok(r.body.watched_at, 'no body means watched');
  r = await req('POST', '/learn/max/watched', tokenA, { watched: false });
  assert.equal(r.body.watched_at, null);
  assert.equal(r.body.progress.watched, 0);
  assert.equal((await req('POST', '/learn/nope/watched', tokenA, {})).status, 404);
});

test('a step is done once the account has done the thing', async () => {
  db.prepare("INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit) VALUES ('r1', 'a', 'decorating', 'emulsion_walls_two_coats', 'Mist and two coats', 9.5, 'm²')").run();
  db.prepare("INSERT INTO room_surveys (id, user_id, title) VALUES ('s1', 'a', 'Job one')").run();
  const r = await req('GET', '/learn', tokenA);
  const done = Object.fromEntries(r.body.next.map((s) => [s.key, s.done]));
  assert.equal(done.rates, true);
  assert.equal(done.job, true);
  assert.equal(done.submit, false);
  assert.equal(done.branding, false);
});

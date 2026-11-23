// Connect your email: a builder's own Gmail / Outlook mailbox is used for the
// mail they send to their clients; tokens are sealed at rest; a broken
// connection falls back to the shared account and tells the builder once;
// the connect callback only completes in the browser that started it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-email-conn-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.PORTAL_BASE_URL = 'https://portal.test';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.MICROSOFT_CLIENT_ID = 'ms-client';
process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
process.env.SMTP_USER = 'hello@platform.test';
process.env.SMTP_PASS = 'smtp-pass';
delete process.env.GMAIL_CLIENT_ID;
delete process.env.GMAIL_CLIENT_SECRET;
delete process.env.EMAIL_TOKEN_KEY;
delete process.env.MAIL_FROM;

// ── The shared SMTP account: record instead of sending ───────────────────────
const nodemailer = require('nodemailer');
const smtpSent = [];
nodemailer.createTransport = () => ({ sendMail: async (m) => { smtpSent.push(m); return { messageId: 'x' }; } });

// ── Google / Microsoft: a scripted fetch; localhost goes to the real one ─────
const realFetch = global.fetch;
const calls = [];
let routes = [];
function onFetch(match, respond) { routes.push({ match, respond }); }
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  calls.push({ url: u, opts });
  const r = routes.find((x) => (typeof x.match === 'string' ? u.startsWith(x.match) : x.match.test(u)));
  if (!r) throw new Error('unexpected fetch: ' + u);
  return r.respond(u, opts);
};
function reset() { calls.length = 0; routes = []; smtpSent.length = 0; }
function bodyOf(call) { return new URLSearchParams(String(call.opts.body)); }

const db = require('./database');
// routes.js adds this column at startup; authMiddleware selects it.
try { db.exec('ALTER TABLE users ADD COLUMN monthly_boq_quota INTEGER DEFAULT 0'); } catch (e) {}
const conn = require('./emailConnection');
const mailer = require('./mailer');

function fakeIdToken(claims) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b({ alg: 'none' }) + '.' + b(claims) + '.sig';
}

let n = 0;
function makeBuilder(extra = {}) {
  const id = 'u' + (++n);
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, has_estimator) VALUES (?, ?, 'x', ?, ?, 1)")
    .run(id, extra.email || ('builder' + n + '@example.com'), 'Stephen Gormley', 'Gormley Property Solutions');
  return id;
}

const GOOD_GOOGLE_TOKENS = {
  access_token: 'ya29.ACCESS-ONE',
  refresh_token: '1//REFRESH-ONE',
  expires_in: 3599,
  scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send',
  id_token: fakeIdToken({ email: 'Gormley.Builds@gmail.com', email_verified: true }),
};

async function connectGoogle(userId) {
  onFetch('https://oauth2.googleapis.com/token', () => json(200, GOOD_GOOGLE_TOKENS));
  return conn.connect(userId, 'google', 'auth-code', conn.newVerifier());
}

function quoteMail(userId, to = 'customer@example.com') {
  return mailer.sendMail({
    userId, type: 'quote_send', to,
    subject: 'Quote Q-1 from Gormley Property Solutions',
    heading: 'Your quote', paragraphs: ['Total: £3,720.00.'],
    ctaText: 'View and accept your quote', ctaUrl: 'https://portal.test/q/abc',
  });
}

function lastLog(userId) {
  return db.prepare('SELECT * FROM mail_log WHERE user_id = ? ORDER BY rowid DESC LIMIT 1').get(userId);
}

// ─────────────────────────────────────────────────────────────────────────────

test('tokens are sealed: they round-trip, and tampering is caught', () => {
  const sealed = conn._seal('1//secret-refresh-token');
  assert.ok(!sealed.includes('secret-refresh-token'));
  assert.strictEqual(conn._unseal(sealed), '1//secret-refresh-token');
  const parts = sealed.split(':');
  const flipped = Buffer.from(parts[3], 'base64');
  flipped[0] ^= 1;
  parts[3] = flipped.toString('base64');
  assert.throws(() => conn._unseal(parts.join(':')), (e) => e.code === 'UNREADABLE' && e.reconnect === true);
  assert.throws(() => conn._unseal('not-sealed'), (e) => e.code === 'UNREADABLE');
});

test('the Google consent link asks for send-only access, offline, with PKCE', () => {
  const verifier = conn.newVerifier();
  const url = new URL(conn.authorizeUrl('google', { state: 'S', verifier }));
  assert.strictEqual(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.send'));
  assert.ok(!scopes.some((s) => /gmail\.(readonly|modify|compose)|mail\.google\.com/.test(s)), 'never asks to read mail');
  assert.strictEqual(url.searchParams.get('access_type'), 'offline');
  assert.strictEqual(url.searchParams.get('prompt'), 'consent');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://portal.test/api/email-connection/callback/google');
  assert.strictEqual(url.searchParams.get('code_challenge'), conn.challengeFor(verifier));
  assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!/\+/.test(url.search), 'spaces encoded as %20');
});

test('connecting Gmail saves the mailbox with tokens encrypted at rest', async () => {
  reset();
  const uid = makeBuilder();
  const verifier = conn.newVerifier();
  onFetch('https://oauth2.googleapis.com/token', () => json(200, GOOD_GOOGLE_TOKENS));
  const r = await conn.connect(uid, 'google', 'auth-code', verifier);
  assert.deepStrictEqual(r, { provider: 'google', email: 'gormley.builds@gmail.com' });

  const sent = bodyOf(calls[0]);
  assert.strictEqual(sent.get('grant_type'), 'authorization_code');
  assert.strictEqual(sent.get('code'), 'auth-code');
  assert.strictEqual(sent.get('code_verifier'), verifier);

  const row = db.prepare('SELECT * FROM email_connections WHERE user_id = ?').get(uid);
  assert.strictEqual(row.status, 'active');
  assert.ok(!row.refresh_token.includes('REFRESH-ONE') && !row.access_token.includes('ACCESS-ONE'));
  assert.strictEqual(conn.status(uid).connection.email, 'gormley.builds@gmail.com');
});

test('unticking "send email" on the Google consent screen is refused', async () => {
  reset();
  const uid = makeBuilder();
  onFetch('https://oauth2.googleapis.com/token', () => json(200, { ...GOOD_GOOGLE_TOKENS, scope: 'openid email' }));
  await assert.rejects(conn.connect(uid, 'google', 'code', conn.newVerifier()), (e) => e.code === 'SCOPE_MISSING');
  assert.strictEqual(conn.getConnection(uid), null);
});

test("a quote goes out through the builder's Gmail, in their name and address", async () => {
  reset();
  const uid = makeBuilder();
  await connectGoogle(uid);
  calls.length = 0;
  let raw = null;
  onFetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send', (u, o) => {
    raw = Buffer.from(o.body).toString('utf8');
    return json(200, { id: 'm1' });
  });

  const r = await quoteMail(uid);
  assert.deepStrictEqual({ ok: r.ok, via: r.via, from: r.from }, { ok: true, via: 'google', from: 'gormley.builds@gmail.com' });
  assert.strictEqual(calls.length, 1, 'fresh token: no refresh needed');
  assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer ya29.ACCESS-ONE');
  assert.strictEqual(calls[0].opts.headers['Content-Type'], 'message/rfc822');
  assert.match(raw, /^From: "?Gormley Property Solutions"? <gormley\.builds@gmail\.com>\r?$/m);
  assert.match(raw, /^To: customer@example\.com\r?$/m);
  assert.doesNotMatch(raw, /^Reply-To:/m, 'replies go to the mailbox it came from');
  assert.match(raw, /Subject: Quote Q-1 from Gormley Property Solutions/);
  assert.strictEqual(smtpSent.length, 0, 'the shared account was not used');
  assert.strictEqual(lastLog(uid).sent_via, 'google');
  assert.ok(conn.getConnection(uid).last_sent_at);
});

test('platform mail (to the builder) never goes through their mailbox', async () => {
  reset();
  const uid = makeBuilder();
  await connectGoogle(uid);
  calls.length = 0;
  const r = await mailer.sendMail({ userId: uid, platform: true, type: 'quote_accepted', to: 'builder@example.com', subject: 'Accepted', heading: 'h', paragraphs: [] });
  assert.strictEqual(r.via, 'shared');
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(smtpSent.length, 1);
  assert.match(smtpSent[0].from, /^"AI QS" <hello@platform\.test>$/);
});

test('without a connection nothing changes: shared account, reply-to the builder', async () => {
  reset();
  const uid = makeBuilder({ email: 'stephen@example.com' });
  const r = await quoteMail(uid);
  assert.strictEqual(r.via, 'shared');
  assert.strictEqual(smtpSent[0].from, '"Gormley Property Solutions" <hello@platform.test>');
  assert.strictEqual(smtpSent[0].replyTo, 'stephen@example.com');
  assert.strictEqual(lastLog(uid).sent_via, 'shared');
});

test('an expired access token is refreshed before sending', async () => {
  reset();
  const uid = makeBuilder();
  await connectGoogle(uid);
  db.prepare('UPDATE email_connections SET token_expiry = ? WHERE user_id = ?').run(Date.now() - 1000, uid);
  calls.length = 0; routes = [];
  onFetch('https://oauth2.googleapis.com/token', () => json(200, { access_token: 'ya29.ACCESS-TWO', expires_in: 3599, scope: GOOD_GOOGLE_TOKENS.scope }));
  onFetch('https://gmail.googleapis.com/', () => json(200, { id: 'm2' }));

  const r = await quoteMail(uid);
  assert.strictEqual(r.via, 'google');
  assert.strictEqual(bodyOf(calls[0]).get('grant_type'), 'refresh_token');
  assert.strictEqual(bodyOf(calls[0]).get('refresh_token'), '1//REFRESH-ONE');
  assert.strictEqual(calls[1].opts.headers.Authorization, 'Bearer ya29.ACCESS-TWO');
  // Google sent no new refresh token: the old one is kept.
  assert.strictEqual(conn._unseal(conn.getConnection(uid).refresh_token), '1//REFRESH-ONE');
});

test('a revoked Gmail falls back to the shared account and tells the builder once', async () => {
  reset();
  const uid = makeBuilder({ email: 'owner@example.com' });
  await connectGoogle(uid);
  db.prepare('UPDATE email_connections SET token_expiry = ? WHERE user_id = ?').run(Date.now() - 1000, uid);
  routes = [];
  onFetch('https://oauth2.googleapis.com/token', () => json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));

  const r = await quoteMail(uid);
  assert.strictEqual(r.ok, true, 'the client still gets the quote');
  assert.strictEqual(r.via, 'shared');
  const c = conn.getConnection(uid);
  assert.strictEqual(c.status, 'needs_reconnect');
  assert.match(c.last_error, /revoked/);

  await new Promise((resolve) => setImmediate(resolve));
  const quote = smtpSent.find((m) => m.to === 'customer@example.com');
  const notice = smtpSent.find((m) => m.to === 'owner@example.com');
  assert.ok(quote && quote.replyTo === 'owner@example.com');
  assert.ok(notice, 'builder told to reconnect');
  assert.match(notice.subject, /Reconnect your Gmail/);
  assert.match(lastLogOfType(uid, 'quote_send').error, /shared account/);

  // Next send: straight to the shared account, no second notice.
  smtpSent.length = 0; calls.length = 0;
  await quoteMail(uid, 'second@example.com');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(smtpSent.map((m) => m.to), ['second@example.com']);
});

function lastLogOfType(userId, type) {
  return db.prepare('SELECT * FROM mail_log WHERE user_id = ? AND type = ? ORDER BY rowid DESC LIMIT 1').get(userId, type);
}

test('a rate limit is a passing failure: fallback, but the connection stays', async () => {
  reset();
  const uid = makeBuilder();
  await connectGoogle(uid);
  onFetch('https://gmail.googleapis.com/', () => json(403, { error: { code: 403, message: 'User-rate limit exceeded.' } }));
  const r = await quoteMail(uid);
  assert.strictEqual(r.via, 'shared');
  assert.strictEqual(conn.getConnection(uid).status, 'active');
});

test('the test email never falls back to the shared account', async () => {
  reset();
  const uid = makeBuilder();
  await connectGoogle(uid);
  onFetch('https://gmail.googleapis.com/', () => json(500, { error: { message: 'Backend Error' } }));
  const r = await mailer.sendMail({ userId: uid, type: 'email_connection_test', to: 'gormley.builds@gmail.com', connectedOnly: true, subject: 't', heading: 'h', paragraphs: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Backend Error/);
  assert.strictEqual(smtpSent.length, 0);
});

test('Outlook: connects via Graph, sends MIME to /me/sendMail, keeps rotated refresh tokens', async () => {
  reset();
  const uid = makeBuilder();
  onFetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => json(200, {
    access_token: 'EwB-ONE', refresh_token: 'M.R-ONE', expires_in: 3600,
    scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read openid email',
  }));
  onFetch('https://graph.microsoft.com/v1.0/me?', () => json(200, { mail: null, userPrincipalName: 'Gormley@Outlook.com' }));
  const r = await conn.connect(uid, 'microsoft', 'code', conn.newVerifier());
  assert.strictEqual(r.email, 'gormley@outlook.com');

  db.prepare('UPDATE email_connections SET token_expiry = ? WHERE user_id = ?').run(Date.now() - 1000, uid);
  calls.length = 0; routes = [];
  onFetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', () => json(200, { access_token: 'EwB-TWO', refresh_token: 'M.R-TWO', expires_in: 3600, scope: 'Mail.Send User.Read' }));
  let mime = null;
  onFetch('https://graph.microsoft.com/v1.0/me/sendMail', (u, o) => {
    mime = Buffer.from(String(o.body), 'base64').toString('utf8');
    return new Response(null, { status: 202 });
  });

  const sent = await quoteMail(uid);
  assert.strictEqual(sent.via, 'microsoft');
  assert.ok(bodyOf(calls[0]).get('scope').includes('Mail.Send'), 'Microsoft refresh names the scopes');
  assert.strictEqual(calls[1].opts.headers['Content-Type'], 'text/plain');
  assert.match(mime, /^From: "?Gormley Property Solutions"? <gormley@outlook\.com>\r?$/m);
  assert.strictEqual(conn._unseal(conn.getConnection(uid).refresh_token), 'M.R-TWO');
});

// ── The routes ───────────────────────────────────────────────────────────────

async function withServer(fn) {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/email-connection', require('./emailConnectionRoutes'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/email-connection';
  try { await fn(base); } finally { server.close(); }
}

function bearer(uid) {
  return 'Bearer ' + require('jsonwebtoken').sign({ id: uid, role: 'client' }, 'test-secret');
}

test('routes: connect → callback in the same browser saves the mailbox', async () => {
  reset();
  const uid = makeBuilder();
  await withServer(async (base) => {
    const start = await realFetch(base + '/connect', {
      method: 'POST',
      headers: { Authorization: bearer(uid), 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', return_to: '/branding' }),
    });
    assert.strictEqual(start.status, 200);
    const { url } = await start.json();
    const cookie = start.headers.get('set-cookie');
    assert.match(cookie, /aiqs_email_pkce=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Path=\/api\/email-connection/);
    const state = new URL(url).searchParams.get('state');
    const verifier = decodeURIComponent(cookie.match(/aiqs_email_pkce=([^;]+)/)[1]);
    assert.strictEqual(new URL(url).searchParams.get('code_challenge'), conn.challengeFor(verifier));

    // Someone else's browser (no cookie) cannot finish this connect.
    const stolen = await realFetch(base + '/callback/google?code=c&state=' + encodeURIComponent(state), { redirect: 'manual' });
    assert.strictEqual(stolen.status, 302);
    assert.strictEqual(stolen.headers.get('location'), '/branding?email=badstate&provider=google');
    assert.strictEqual(conn.getConnection(uid), null);

    // Nor can the state be replayed against the other provider.
    const crossed = await realFetch(base + '/callback/microsoft?code=c&state=' + encodeURIComponent(state), {
      redirect: 'manual', headers: { Cookie: 'aiqs_email_pkce=' + verifier },
    });
    assert.match(crossed.headers.get('location'), /email=badstate/);

    onFetch('https://oauth2.googleapis.com/token', () => json(200, GOOD_GOOGLE_TOKENS));
    const done = await realFetch(base + '/callback/google?code=c&state=' + encodeURIComponent(state), {
      redirect: 'manual', headers: { Cookie: 'aiqs_email_pkce=' + verifier },
    });
    assert.strictEqual(done.headers.get('location'), '/branding?email=connected&provider=google');
    assert.match(done.headers.get('set-cookie') || '', /aiqs_email_pkce=;/, 'cookie cleared');
    assert.strictEqual(bodyOf(calls.find((c) => c.url.startsWith('https://oauth2'))).get('code_verifier'), verifier);
    assert.strictEqual(conn.getConnection(uid).email, 'gormley.builds@gmail.com');

    const status = await (await realFetch(base + '/status', { headers: { Authorization: bearer(uid) } })).json();
    assert.strictEqual(status.connection.email, 'gormley.builds@gmail.com');
    assert.strictEqual(status.providers.google.configured, true);
    assert.strictEqual(status.shared_sender, 'hello@platform.test');
  });
});

test('routes: denied consent and junk state come back as a clear result', async () => {
  await withServer(async (base) => {
    const denied = await realFetch(base + '/callback/google?error=access_denied', { redirect: 'manual' });
    assert.strictEqual(denied.headers.get('location'), '/branding?email=denied&provider=google');
    const junk = await realFetch(base + '/callback/google?code=c&state=forged', { redirect: 'manual' });
    assert.strictEqual(junk.headers.get('location'), '/branding?email=badstate&provider=google');
  });
});

test('routes: disconnect forgets the mailbox and revokes it at Google', async () => {
  reset();
  const uid = makeBuilder();
  await connectGoogle(uid);
  calls.length = 0;
  onFetch('https://oauth2.googleapis.com/revoke', () => new Response(null, { status: 200 }));
  await withServer(async (base) => {
    const r = await realFetch(base + '/disconnect', { method: 'POST', headers: { Authorization: bearer(uid) } });
    assert.strictEqual(r.status, 200);
  });
  assert.strictEqual(conn.getConnection(uid), null);
  assert.strictEqual(bodyOf(calls[0]).get('token'), '1//REFRESH-ONE');
});

test('routes: accounts without the estimator add-on are turned away', async () => {
  const id = 'no-estimator';
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, has_estimator) VALUES (?, 'plain@example.com', 'x', 'Plain', 0)").run(id);
  const prev = process.env.MAX_ROLLOUT;
  process.env.MAX_ROLLOUT = 'admins';
  try {
    await withServer(async (base) => {
      const r = await realFetch(base + '/status', { headers: { Authorization: bearer(id) } });
      assert.strictEqual(r.status, 403);
    });
  } finally {
    if (prev === undefined) delete process.env.MAX_ROLLOUT; else process.env.MAX_ROLLOUT = prev;
  }
});

test.after(() => {
  global.fetch = realFetch;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECT YOUR EMAIL — server/emailConnection.js
//
// Lets a builder send their quotes, invoices, variations and reminders from
// their OWN mailbox (Gmail / Google Workspace, or Outlook / Microsoft 365)
// instead of the shared AI QS SMTP account. The client sees the builder's real
// address in "From", and the email lands in the builder's own Sent folder.
//
// Flow (same shape as the Xero connection in xeroClient.js):
//   1. POST /api/email-connection/connect      → { url } to send the builder to
//                                                 Google / Microsoft
//   2. GET  /api/email-connection/callback/:p  → swap the code for tokens, save
//   3. mailer.sendMail()                        → uses the connected mailbox for
//                                                 every builder-branded email
//
// Scopes are send-only: Gmail `gmail.send`, Microsoft Graph `Mail.Send`. The
// portal can never read the builder's inbox.
//
// Tokens are encrypted at rest (AES-256-GCM, key from EMAIL_TOKEN_KEY, else
// derived from JWT_SECRET). If the key changes, the stored tokens can no longer
// be opened and the connection simply asks to be reconnected.
//
// If a send through the connected mailbox fails, mailer.js falls back to the
// shared SMTP account so the client still gets their quote, and the builder is
// told to reconnect (see markNeedsReconnect).
// ═══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const MailComposer = require('nodemailer/lib/mail-composer');
const db = require('./database'); // table: email_connections (database.js)

function portalBaseUrl() {
  return (process.env.PORTAL_BASE_URL || process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com').replace(/\/+$/, '');
}

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Env is read when used (not at require time) so tests and a redeploy with new
// keys both behave.
const PROVIDERS = {
  google: {
    label: 'Gmail',
    // A separate Google Cloud client can be used for mail; otherwise the
    // sign-in client (GOOGLE_CLIENT_ID) is reused with one more scope.
    clientId: () => process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: () => process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', GMAIL_SEND_SCOPE],
    // offline + consent: Google only hands out a refresh token on a forced
    // consent screen, and without one the connection dies after an hour.
    authParams: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    label: 'Outlook',
    clientId: () => process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET || '',
    // 'common' accepts work/school (Microsoft 365) and personal
    // (outlook.com / hotmail / live) accounts.
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read'],
    authParams: { response_mode: 'query', prompt: 'select_account' },
  },
};

function isProvider(p) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, p);
}

function isConfigured(provider) {
  const p = PROVIDERS[provider];
  return !!(p && p.clientId() && p.clientSecret() && tokenKey());
}

function redirectUri(provider) {
  return portalBaseUrl() + '/api/email-connection/callback/' + provider;
}

class EmailConnectionError extends Error {
  constructor(message, code, { reconnect = false } = {}) {
    super(message);
    this.code = code;
    this.reconnect = reconnect;
  }
}

// ─── Token encryption ─────────────────────────────────────────────────────────

function tokenKey() {
  const raw = process.env.EMAIL_TOKEN_KEY || process.env.JWT_SECRET ||
    (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-change-in-production');
  if (!raw) return null;
  return crypto.createHash('sha256').update('aiqs-email-connection:' + raw).digest();
}

function seal(plain) {
  const key = tokenKey();
  if (!key) throw new EmailConnectionError('No encryption key is set on the server.', 'NO_KEY');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function unseal(sealed) {
  const key = tokenKey();
  const parts = String(sealed || '').split(':');
  if (!key || parts.length !== 4 || parts[0] !== 'v1') {
    throw new EmailConnectionError('Stored email credentials could not be read.', 'UNREADABLE', { reconnect: true });
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    throw new EmailConnectionError('Stored email credentials could not be read.', 'UNREADABLE', { reconnect: true });
  }
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────
// The verifier lives in an httpOnly cookie on the browser that started the
// connect (see emailConnectionRoutes.js). Only that browser can finish the
// exchange, so a connect link can't be forwarded to someone else to attach
// THEIR mailbox to the sender's account.

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newVerifier() {
  return base64url(crypto.randomBytes(32));
}

function challengeFor(verifier) {
  return base64url(crypto.createHash('sha256').update(String(verifier)).digest());
}

function authorizeUrl(provider, { state, verifier }) {
  const p = PROVIDERS[provider];
  const params = {
    client_id: p.clientId(),
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: p.scopes.join(' '),
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    ...p.authParams,
  };
  // encodeURIComponent → spaces as %20, which every provider accepts.
  const qs = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  return p.authorizeUrl + '?' + qs;
}

// ─── Token exchange / refresh ─────────────────────────────────────────────────

async function tokenRequest(provider, body) {
  const p = PROVIDERS[provider];
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.clientId(), client_secret: p.clientSecret(), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const code = data.error || ('http_' + res.status);
    // invalid_grant = the refresh token was revoked, expired, or the password
    // changed. Nothing to retry — the builder has to connect again.
    const reconnect = code === 'invalid_grant' || code === 'unauthorized_client' || code === 'invalid_client';
    throw new EmailConnectionError(
      (p.label + ' sign-in failed: ' + (data.error_description || code)).slice(0, 300),
      reconnect ? 'NEEDS_RECONNECT' : 'TOKEN_FAILED',
      { reconnect }
    );
  }
  return data;
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) {
    return {};
  }
}

// Which mailbox did they connect? Google: the id_token that came straight
// back from Google's token endpoint over TLS. Microsoft: Graph /me (personal
// accounts often carry no email claim in the id_token).
async function mailboxAddress(provider, data) {
  if (provider === 'google') {
    const claims = decodeJwtPayload(data.id_token);
    if (claims.email && claims.email_verified !== false) return String(claims.email).toLowerCase();
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + data.access_token },
    });
    const info = await res.json().catch(() => ({}));
    return info.email ? String(info.email).toLowerCase() : null;
  }
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: 'Bearer ' + data.access_token },
  });
  const me = await res.json().catch(() => ({}));
  const addr = me.mail || me.userPrincipalName || decodeJwtPayload(data.id_token).email;
  return addr && String(addr).includes('@') ? String(addr).toLowerCase() : null;
}

function grantedSend(provider, data) {
  const granted = String(data.scope || '').toLowerCase();
  // Google lets the user untick individual permissions on the consent screen.
  if (provider === 'google') return granted.split(/\s+/).includes(GMAIL_SEND_SCOPE);
  return /(^|[\s/])mail\.send(\s|$)/.test(granted);
}

// Called by the OAuth callback. Saves (or replaces) the builder's connection.
async function connect(userId, provider, code, verifier) {
  if (!isProvider(provider)) throw new EmailConnectionError('Unknown email provider.', 'BAD_PROVIDER');
  const data = await tokenRequest(provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(provider),
    code_verifier: verifier,
  });
  if (!grantedSend(provider, data)) {
    throw new EmailConnectionError('Permission to send email was not granted.', 'SCOPE_MISSING');
  }
  if (!data.refresh_token) {
    throw new EmailConnectionError('No long-term access was granted. Please try connecting again.', 'NO_REFRESH_TOKEN');
  }
  const email = await mailboxAddress(provider, data);
  if (!email) throw new EmailConnectionError('Could not read the email address of that account.', 'NO_EMAIL');

  const expiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  db.prepare(`
    INSERT INTO email_connections (user_id, provider, email, refresh_token, access_token, token_expiry, status, last_error, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider, email = excluded.email,
      refresh_token = excluded.refresh_token, access_token = excluded.access_token,
      token_expiry = excluded.token_expiry, status = 'active', last_error = NULL,
      connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  `).run(userId, provider, email, seal(data.refresh_token), seal(data.access_token), expiry);
  return { provider, email };
}

function getConnection(userId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM email_connections WHERE user_id = ?').get(userId) || null;
}

// The connection mailer.js should send through, or null for the shared SMTP.
function getActive(userId) {
  const row = getConnection(userId);
  return row && row.status === 'active' && isProvider(row.provider) ? row : null;
}

// Returns true when this call flipped a working connection to broken, so the
// caller tells the builder once rather than on every failed send.
function markNeedsReconnect(userId, reason) {
  const r = db.prepare(
    "UPDATE email_connections SET status = 'needs_reconnect', last_error = ?, access_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'active'"
  ).run(String(reason || '').slice(0, 300) || null, userId);
  return r.changes > 0;
}

const refreshing = new Map(); // userId → Promise<string>, so parallel sends refresh once

async function accessToken(conn, { force = false } = {}) {
  if (!force && conn.access_token && Number(conn.token_expiry) > Date.now() + 60 * 1000) {
    return unseal(conn.access_token);
  }
  if (refreshing.has(conn.user_id)) return refreshing.get(conn.user_id);
  const job = (async () => {
    const body = { grant_type: 'refresh_token', refresh_token: unseal(conn.refresh_token) };
    if (conn.provider === 'microsoft') body.scope = PROVIDERS.microsoft.scopes.join(' ');
    const data = await tokenRequest(conn.provider, body);
    const expiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    const sealedAccess = seal(data.access_token);
    // Microsoft rotates the refresh token on every refresh; Google usually
    // keeps the old one and sends none back.
    const sealedRefresh = data.refresh_token ? seal(data.refresh_token) : conn.refresh_token;
    db.prepare(
      'UPDATE email_connections SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?'
    ).run(sealedAccess, sealedRefresh, expiry, conn.user_id);
    conn.access_token = sealedAccess;
    conn.refresh_token = sealedRefresh;
    conn.token_expiry = expiry;
    return data.access_token;
  })();
  refreshing.set(conn.user_id, job);
  try {
    return await job;
  } finally {
    refreshing.delete(conn.user_id);
  }
}

// ─── Sending ──────────────────────────────────────────────────────────────────

// Nodemailer-style message → RFC 822 bytes. Same composer nodemailer's SMTP
// transport uses, so attachments, the inline logo (cid) and the text/html
// alternative come out exactly as before.
function buildMime(mail) {
  return new Promise((resolve, reject) => {
    new MailComposer(mail).compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

function deliver(provider, token, raw) {
  if (provider === 'google') {
    // The media-upload endpoint takes the raw message (up to 35 MB) without
    // base64-wrapping it in JSON. Gmail files it in the builder's Sent folder.
    return fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'message/rfc822' },
      body: raw,
    });
  }
  // Graph accepts a whole MIME message as base64 text and saves it to Sent Items.
  return fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain' },
    body: raw.toString('base64'),
  });
}

async function errorDetail(res) {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    const e = j.error || {};
    return String(e.message || e.code || j.error_description || text).slice(0, 300);
  } catch (_) {
    return text.slice(0, 300) || ('HTTP ' + res.status);
  }
}

// Throws EmailConnectionError; err.reconnect says whether the builder needs to
// connect again (revoked / permission removed) or it was a passing failure.
async function sendViaConnection(conn, mail) {
  const label = (PROVIDERS[conn.provider] || {}).label || 'Email';
  const raw = await buildMime(mail);
  let token = await accessToken(conn);
  let res = await deliver(conn.provider, token, raw);
  if (res.status === 401) {
    // The token can be revoked before it expires — refresh once and retry.
    token = await accessToken(conn, { force: true });
    res = await deliver(conn.provider, token, raw);
  }
  if (res.ok) {
    db.prepare('UPDATE email_connections SET last_sent_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(conn.user_id);
    return;
  }
  const detail = await errorDetail(res);
  const throttled = res.status === 429 || /rate ?limit|limitexceeded|quota|throttl/i.test(detail);
  const reconnect = !throttled && (res.status === 401 || res.status === 403);
  throw new EmailConnectionError(label + ' refused the email: ' + detail, reconnect ? 'NEEDS_RECONNECT' : 'SEND_FAILED', { reconnect });
}

// ─── Status / disconnect ──────────────────────────────────────────────────────

function status(userId) {
  const row = getConnection(userId);
  const providers = {};
  for (const [key, p] of Object.entries(PROVIDERS)) providers[key] = { label: p.label, configured: isConfigured(key) };
  return {
    providers,
    connection: row ? {
      provider: row.provider,
      label: (PROVIDERS[row.provider] || {}).label || row.provider,
      email: row.email,
      status: row.status,
      last_error: row.last_error || null,
      connected_at: row.connected_at || null,
      last_sent_at: row.last_sent_at || null,
    } : null,
  };
}

async function disconnect(userId) {
  const row = getConnection(userId);
  if (!row) return { ok: true };
  db.prepare('DELETE FROM email_connections WHERE user_id = ?').run(userId);
  // Best effort: tell Google to drop the grant too. Microsoft has no revoke
  // endpoint for a single app grant; the builder can remove it at
  // account.microsoft.com → Privacy → Apps and services.
  if (row.provider === 'google') {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: unseal(row.refresh_token) }),
      });
    } catch (e) { /* already gone, or unreadable — the row is deleted either way */ }
  }
  return { ok: true };
}

module.exports = {
  PROVIDERS,
  EmailConnectionError,
  isProvider,
  isConfigured,
  redirectUri,
  newVerifier,
  challengeFor,
  authorizeUrl,
  connect,
  getConnection,
  getActive,
  markNeedsReconnect,
  sendViaConnection,
  buildMime,
  status,
  disconnect,
  // exposed for tests
  _seal: seal,
  _unseal: unseal,
};

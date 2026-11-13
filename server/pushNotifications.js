// Push notifications to the iOS app (Apple Push Notification service).
//
// The app registers its device token after sign-in (src/native/push.js →
// POST /api/push/register); the places that already email a customer call
// sendToUser() alongside the email. Push is always an extra, never the only
// channel: with nothing configured, no device registered, or Apple
// unreachable, sendToUser() quietly does nothing and the email still goes.
//
// Configuration (Render → Environment). All three are needed to send:
//   APNS_KEY        the .p8 key from developer.apple.com → Keys (Apple Push
//                   Notifications service). Paste the whole file; literal
//                   "\n" sequences and a base64 copy are both accepted.
//   APNS_KEY_ID     the key's 10-character Key ID
//   APPLE_TEAM_ID   the 10-character Team ID (already set for universal links)
//   IOS_BUNDLE_ID   optional, defaults to uk.co.theaiqs.portal
//
// A device token only works against the APNs environment the build was
// signed for: App Store and TestFlight builds use production, a build run
// from Xcode uses the sandbox. The first send to a token tries production
// and falls back to the sandbox, then remembers which one answered.
const express = require('express');
const http2 = require('http2');
const jwt = require('jsonwebtoken');
const db = require('./database');
const { authMiddleware } = require('./auth');

const DEFAULT_BUNDLE_ID = 'uk.co.theaiqs.portal';
const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_devices (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ios',
      sandbox INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
  `);
} catch (e) {
  console.error('[Push] could not create push_devices:', e.message);
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────

// An APNs device token is 32 bytes as hex (64 chars); Apple reserves the
// right to lengthen it, so accept up to 200.
function isValidToken(token) {
  return typeof token === 'string' && /^[0-9a-fA-F]{64,200}$/.test(token);
}

// The .p8 as it survives being pasted into an environment variable: real
// newlines, literal "\n", or the whole file base64-encoded.
function normaliseKey(raw) {
  let k = String(raw || '').trim();
  if (!k) return '';
  if (!k.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(k)) {
    try {
      const decoded = Buffer.from(k, 'base64').toString('utf8');
      if (decoded.includes('BEGIN')) k = decoded.trim();
    } catch (e) { /* not base64 */ }
  }
  k = k.replace(/\\n/g, '\n');
  if (!k.includes('BEGIN')) {
    // The bare key body with the header and footer lines stripped off.
    k = '-----BEGIN PRIVATE KEY-----\n' + k.replace(/\s+/g, '\n') + '\n-----END PRIVATE KEY-----';
  }
  return k + '\n';
}

function readConfig(env = process.env) {
  const key = normaliseKey(env.APNS_KEY);
  const keyId = String(env.APNS_KEY_ID || '').trim();
  const teamId = String(env.APPLE_TEAM_ID || '').trim();
  const bundleId = String(env.IOS_BUNDLE_ID || DEFAULT_BUNDLE_ID).trim();
  const missing = [];
  if (!key) missing.push('APNS_KEY');
  if (!keyId) missing.push('APNS_KEY_ID');
  if (!teamId) missing.push('APPLE_TEAM_ID');
  return { configured: missing.length === 0, missing, key, keyId, teamId, bundleId };
}

// What the phone shows, plus where a tap should land in the app.
function buildPayload({ title, body, path }) {
  const payload = {
    aps: {
      alert: { title: String(title || 'AI QS').slice(0, 120), body: String(body || '').slice(0, 300) },
      sound: 'default',
    },
  };
  if (path && /^\/[^/]/.test(String(path))) payload.path = String(path).slice(0, 300);
  return payload;
}

// What to do with one device after Apple's answer.
//   ok            delivered to Apple
//   other_env     wrong environment for this token — try the other host
//   drop          the token is dead (app deleted, or never valid) — forget it
//   fail          anything else — keep the token, report the reason
function classifyResponse(status, reason) {
  if (status === 200) return 'ok';
  if (status === 400 && reason === 'BadDeviceToken') return 'other_env';
  if (status === 410 || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return 'drop';
  return 'fail';
}

// ── Sending ────────────────────────────────────────────────────────────────

// Apple accepts a provider token for up to an hour and throttles anyone who
// mints them more often than every 20 minutes.
let cachedJwt = null;
function providerToken(cfg) {
  const now = Date.now();
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && now - cachedJwt.at < 40 * 60 * 1000) return cachedJwt.token;
  const token = jwt.sign({ iss: cfg.teamId }, cfg.key, { algorithm: 'ES256', keyid: cfg.keyId });
  cachedJwt = { token, keyId: cfg.keyId, at: now };
  return token;
}

// One HTTP/2 request to APNs → { status, reason }.
function apnsRequest(host, deviceToken, payload, cfg) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let client;
    try { client = http2.connect(host); } catch (e) { return done({ status: 0, reason: e.message }); }
    client.on('error', (e) => done({ status: 0, reason: e.message }));
    const timer = setTimeout(() => { try { client.destroy(); } catch (e) { /* ignore */ } done({ status: 0, reason: 'timeout' }); }, 10000);
    let req;
    try {
      req = client.request({
        ':method': 'POST',
        ':path': '/3/device/' + deviceToken,
        authorization: 'bearer ' + providerToken(cfg),
        'apns-topic': cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch (e) {
      clearTimeout(timer);
      try { client.close(); } catch (err) { /* ignore */ }
      return done({ status: 0, reason: e.message });
    }
    let status = 0;
    let data = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = Number(headers[':status']) || 0; });
    req.on('data', (chunk) => { data += chunk; });
    req.on('error', (e) => { clearTimeout(timer); done({ status: 0, reason: e.message }); });
    req.on('end', () => {
      clearTimeout(timer);
      let reason = '';
      try { reason = (JSON.parse(data || '{}').reason) || ''; } catch (e) { /* no body */ }
      try { client.close(); } catch (e) { /* ignore */ }
      done({ status, reason });
    });
    req.end(JSON.stringify(payload));
  });
}

// Deliver one notification to one device row, learning its environment.
// `request` is injectable so the flow can be tested without Apple.
async function deliver(device, payload, cfg, request = apnsRequest) {
  const order = device.sandbox === 1 ? ['sandbox', 'production'] : ['production', 'sandbox'];
  let last = { status: 0, reason: 'not sent' };
  for (const env of order) {
    last = await request(HOSTS[env], device.token, payload, cfg);
    const verdict = classifyResponse(last.status, last.reason);
    if (verdict === 'ok') return { outcome: 'ok', sandbox: env === 'sandbox' ? 1 : 0 };
    if (verdict === 'drop') return { outcome: 'drop', reason: last.reason || String(last.status) };
    if (verdict === 'fail') return { outcome: 'fail', reason: last.reason || String(last.status) };
    // other_env → try the next host
  }
  // Rejected as a bad token by both environments: it is not a token for this app.
  return { outcome: 'drop', reason: last.reason || 'BadDeviceToken' };
}

/**
 * Send a notification to every device a user has signed in on.
 *   → { configured, devices, sent, dropped, failed, reasons }
 * Never throws; callers fire and forget.
 */
async function sendToUser(userId, { title, body, path } = {}) {
  const result = { configured: false, devices: 0, sent: 0, dropped: 0, failed: 0, reasons: [] };
  try {
    const cfg = readConfig();
    result.configured = cfg.configured;
    if (!cfg.configured) { result.reasons.push('Not configured: ' + cfg.missing.join(', ')); return result; }
    const devices = db.prepare('SELECT token, sandbox FROM push_devices WHERE user_id = ?').all(userId);
    result.devices = devices.length;
    if (!devices.length) return result;
    const payload = buildPayload({ title, body, path });
    for (const device of devices) {
      const r = await deliver(device, payload, cfg);
      if (r.outcome === 'ok') {
        result.sent++;
        if (device.sandbox !== r.sandbox) db.prepare('UPDATE push_devices SET sandbox = ? WHERE token = ?').run(r.sandbox, device.token);
      } else if (r.outcome === 'drop') {
        result.dropped++;
        db.prepare('DELETE FROM push_devices WHERE token = ?').run(device.token);
      } else {
        result.failed++;
        result.reasons.push(r.reason);
      }
    }
    if (result.failed) console.error('[Push] ' + result.failed + ' failed for user ' + userId + ': ' + result.reasons.join(', '));
  } catch (e) {
    result.failed++;
    result.reasons.push(e.message);
    console.error('[Push] send error:', e.message);
  }
  return result;
}

// ── Routes ─────────────────────────────────────────────────────────────────
const router = express.Router();

// The app calls this after sign-in and whenever iOS hands it a new token. A
// token belongs to whoever is signed in on that phone now, so registering
// moves it from any previous account.
router.post('/push/register', authMiddleware, (req, res) => {
  const token = String((req.body && req.body.token) || '').trim();
  if (!isValidToken(token)) return res.status(400).json({ error: 'Invalid device token' });
  const platform = String((req.body && req.body.platform) || 'ios').slice(0, 20);
  db.prepare(
    'INSERT INTO push_devices (token, user_id, platform) VALUES (?, ?, ?) '
    + 'ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen_at = CURRENT_TIMESTAMP'
  ).run(token.toLowerCase(), req.user.id, platform);
  res.json({ ok: true });
});

// On sign-out, so a phone handed to someone else stops receiving the
// previous user's job alerts.
router.post('/push/unregister', authMiddleware, (req, res) => {
  const token = String((req.body && req.body.token) || '').trim().toLowerCase();
  if (token) db.prepare('DELETE FROM push_devices WHERE token = ? AND user_id = ?').run(token, req.user.id);
  res.json({ ok: true });
});

// "Send test notification" in the app's menu: pushes to the caller's own
// devices and says plainly what happened, so set-up can be checked without
// delivering a real job.
router.post('/push/test', authMiddleware, async (req, res) => {
  const r = await sendToUser(req.user.id, {
    title: 'AI QS',
    body: 'Notifications are working on this iPhone.',
    path: '/dashboard',
  });
  let message;
  if (!r.configured) message = 'Push is not set up on the server yet (' + r.reasons.join('; ') + ').';
  else if (!r.devices && !r.dropped) message = 'No iPhone is registered for this account. Allow notifications for AI QS in iOS Settings, then reopen the app.';
  else if (r.sent) message = 'Sent to ' + r.sent + ' device' + (r.sent === 1 ? '' : 's') + '. It should arrive within a few seconds.';
  else if (r.dropped) message = 'Apple no longer recognises this device. Close and reopen the app, then try again.';
  else message = 'Apple rejected the notification: ' + (r.reasons.join(', ') || 'unknown reason') + '.';
  res.json({ ok: r.sent > 0, message, ...r });
});

module.exports = {
  router, sendToUser,
  // exported for tests
  isValidToken, normaliseKey, readConfig, buildPayload, classifyResponse, deliver, HOSTS,
};

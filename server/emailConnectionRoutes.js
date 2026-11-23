// ═══════════════════════════════════════════════════════════════════════════════
// CONNECT YOUR EMAIL — ROUTES — server/emailConnectionRoutes.js
// (mounted at /api/email-connection)
//
//   GET  /callback/:provider  ← Google / Microsoft redirect here (public:
//                                identified by the signed `state` plus the
//                                PKCE cookie, not a Bearer token)
//   GET  /status              → { providers, connection, shared_sender, ... }
//   POST /connect             → { url } to send the builder to the provider
//   POST /test                → send a test email through the connected mailbox
//   POST /disconnect          → forget the mailbox (and revoke it at Google)
//
// Why a cookie as well as `state`: the signed state proves WHICH builder
// started the connect, but not that the person approving at Google is that
// builder. Without the cookie, a builder could send someone else their connect
// link and end up sending email as that person's mailbox. The PKCE verifier is
// set as an httpOnly cookie by the builder's own signed-in browser, so only
// that browser can finish the exchange.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authMiddleware, requireEstimator } = require('./auth');
const emailConnection = require('./emailConnection');
const mailer = require('./mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? null : 'dev-secret-change-in-production');

const COOKIE = 'aiqs_email_pkce';
const COOKIE_PATH = '/api/email-connection';
const FLOW_MINUTES = 15;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax: sent on the top-level GET redirect back from Google / Microsoft.
    sameSite: 'lax',
    path: COOKIE_PATH,
  };
}

function safeReturnTo(raw) {
  const v = String(raw || '/branding');
  return v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : '/branding';
}

function sameHash(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// ─── Public callback ──────────────────────────────────────────────────────────
router.get('/callback/:provider', async (req, res) => {
  const provider = String(req.params.provider || '');
  let payload = null;
  try { payload = req.query.state ? jwt.verify(String(req.query.state), JWT_SECRET) : null; } catch (_) { payload = null; }

  const backTo = (result) => {
    res.clearCookie(COOKIE, cookieOptions());
    const dest = safeReturnTo(payload && payload.return_to);
    const sep = dest.includes('?') ? '&' : '?';
    res.redirect(dest + sep + 'email=' + encodeURIComponent(result) + (emailConnection.isProvider(provider) ? '&provider=' + provider : ''));
  };

  try {
    if (req.query.error) return backTo('denied');
    if (!req.query.code || !payload) return backTo('badstate');
    if (payload.purpose !== 'email_connect' || !payload.uid || payload.provider !== provider) return backTo('badstate');

    const verifier = req.cookies && req.cookies[COOKIE];
    if (!verifier || !sameHash(emailConnection.challengeFor(verifier), payload.vh)) return backTo('badstate');

    await emailConnection.connect(payload.uid, provider, String(req.query.code), verifier);
    backTo('connected');
  } catch (err) {
    console.error('[EmailConnection] callback error:', err.code || '', err.message);
    if (err.code === 'SCOPE_MISSING') return backTo('scope_missing');
    backTo('failed');
  }
});

// ─── Authenticated routes ─────────────────────────────────────────────────────
router.use(authMiddleware, requireEstimator);

router.get('/status', (req, res) => {
  try {
    res.json({
      ...emailConnection.status(req.user.id),
      shared_sender: mailer.sharedSender(),
      account_email: req.user.email,
    });
  } catch (err) {
    console.error('[EmailConnection] status error:', err);
    res.status(500).json({ error: 'Failed to check your email connection.' });
  }
});

router.post('/connect', (req, res) => {
  try {
    const provider = String((req.body && req.body.provider) || '');
    if (!emailConnection.isProvider(provider)) {
      return res.status(400).json({ error: 'Choose Gmail or Outlook.', code: 'BAD_PROVIDER' });
    }
    if (!emailConnection.isConfigured(provider)) {
      return res.status(503).json({
        error: emailConnection.PROVIDERS[provider].label + ' connection is not set up on the server yet.',
        code: 'NOT_CONFIGURED',
      });
    }
    if (!JWT_SECRET) {
      return res.status(503).json({ error: 'Server is missing its signing secret.', code: 'NO_SECRET' });
    }
    const verifier = emailConnection.newVerifier();
    const state = jwt.sign({
      uid: req.user.id,
      purpose: 'email_connect',
      provider,
      vh: emailConnection.challengeFor(verifier),
      return_to: safeReturnTo(req.body && req.body.return_to),
    }, JWT_SECRET, { expiresIn: FLOW_MINUTES + 'm' });
    res.cookie(COOKIE, verifier, { ...cookieOptions(), maxAge: FLOW_MINUTES * 60 * 1000 });
    res.json({ url: emailConnection.authorizeUrl(provider, { state, verifier }) });
  } catch (err) {
    console.error('[EmailConnection] connect error:', err);
    res.status(500).json({ error: 'Failed to start the email connection.' });
  }
});

router.post('/test', async (req, res) => {
  try {
    const conn = emailConnection.getConnection(req.user.id);
    if (!conn) return res.status(400).json({ error: 'Connect your email first.', code: 'NOT_CONNECTED' });
    if (conn.status !== 'active') {
      return res.status(400).json({ error: 'Your email connection needs reconnecting first.', code: 'NEEDS_RECONNECT' });
    }
    const mail = await mailer.sendMail({
      userId: req.user.id,
      type: 'email_connection_test',
      to: conn.email,
      connectedOnly: true,
      subject: 'Test email from AI QS',
      heading: 'Your email is connected',
      paragraphs: [
        'This test was sent through ' + conn.email + ', the same way your quotes, invoices and reminders will be.',
        'Your clients will see this address in "From", replies come straight back to this inbox, and a copy of everything you send appears in your Sent folder.',
      ],
    });
    if (!mail.ok) {
      return res.status(502).json({ error: mail.error || 'The test email could not be sent.', code: 'SEND_FAILED' });
    }
    res.json({ ok: true, to: conn.email });
  } catch (err) {
    console.error('[EmailConnection] test error:', err);
    res.status(500).json({ error: 'Failed to send the test email.' });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    await emailConnection.disconnect(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[EmailConnection] disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect your email.' });
  }
});

module.exports = router;

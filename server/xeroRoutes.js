// ═══════════════════════════════════════════════════════════════════════════════
// XERO — ROUTES — server/xeroRoutes.js   (mounted at /api/xero)
//
//   GET  /api/xero/callback        ← Xero redirects here (public: identified by
//                                     the signed `state`, not a Bearer token)
//   GET  /api/xero/status          → { configured, connected, tenant_name }
//   POST /api/xero/connect         → { url } to send the builder to Xero
//   POST /api/xero/disconnect      → forget the tokens
//   POST /api/xero/push            → create sent/paid invoices in Xero
//   POST /api/xero/push/:invoiceId → push a single invoice
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const jwt = require('jsonwebtoken');
const { authMiddleware, requireEstimator } = require('./auth');
const xero = require('./xeroClient');

const router = express.Router();

// Same secret the rest of auth uses; the state token is a short-lived, signed
// proof of which builder started the connect so the public callback can trust it.
const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? null : 'dev-secret-change-in-production');

function safeReturnTo(raw) {
  const v = String(raw || '/money');
  return v.startsWith('/') && !v.startsWith('//') ? v : '/money';
}

// ─── Public callback ──────────────────────────────────────────────────────────
// Registered BEFORE the auth middleware below: Xero calls this straight from the
// builder's browser with no Authorization header, so we identify them from the
// signed `state` instead.
router.get('/callback', async (req, res) => {
  const backTo = (extra) => {
    let dest = '/money';
    try { if (req.query.state) dest = safeReturnTo(jwt.verify(req.query.state, JWT_SECRET).return_to); } catch (_) {}
    const sep = dest.includes('?') ? '&' : '?';
    res.redirect(dest + sep + extra);
  };
  try {
    const { code, state, error } = req.query;
    if (error || !code || !state) return backTo('xero=denied');

    let payload;
    try { payload = jwt.verify(state, JWT_SECRET); } catch (_) { return backTo('xero=badstate'); }
    if (!payload || payload.purpose !== 'xero_connect' || !payload.uid) return backTo('xero=badstate');

    await xero.connect(payload.uid, String(code));
    backTo('xero=connected');
  } catch (err) {
    console.error('[Xero] callback error:', err);
    backTo('xero=failed');
  }
});

// ─── Authenticated routes ─────────────────────────────────────────────────────
router.use(authMiddleware, requireEstimator);

router.get('/status', (req, res) => {
  try {
    res.json(xero.status(req.user.id));
  } catch (err) {
    console.error('[Xero] status error:', err);
    res.status(500).json({ error: 'Failed to check Xero status.' });
  }
});

router.post('/connect', (req, res) => {
  try {
    if (!xero.isConfigured()) {
      return res.status(503).json({ error: 'Xero is not set up on the server yet.', code: 'XERO_NOT_CONFIGURED' });
    }
    if (!JWT_SECRET) {
      return res.status(503).json({ error: 'Server is missing its signing secret.', code: 'NO_SECRET' });
    }
    const return_to = safeReturnTo(req.body && req.body.return_to);
    const state = jwt.sign({ uid: req.user.id, purpose: 'xero_connect', return_to }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ url: xero.authorizeUrl(state) });
  } catch (err) {
    console.error('[Xero] connect error:', err);
    res.status(500).json({ error: 'Failed to start the Xero connection.' });
  }
});

router.post('/disconnect', (req, res) => {
  try {
    xero.clearTokens(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Xero] disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Xero.' });
  }
});

async function handlePush(req, res, invoiceId) {
  try {
    const result = await xero.pushInvoices(req.user.id, invoiceId);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'NOT_CONNECTED') {
      return res.status(400).json({ error: 'Connect Xero first.', code: 'NOT_CONNECTED' });
    }
    if (err.code === 'NEEDS_RECONNECT') {
      return res.status(400).json({ error: err.message, code: 'NEEDS_RECONNECT' });
    }
    console.error('[Xero] push error:', err);
    res.status(500).json({ error: 'Failed to send to Xero' + (err.message ? ': ' + err.message : '.') });
  }
}

router.post('/push', (req, res) => handlePush(req, res, null));
router.post('/push/:invoiceId', (req, res) => handlePush(req, res, String(req.params.invoiceId)));

module.exports = router;

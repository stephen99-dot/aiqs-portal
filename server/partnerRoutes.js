// ═══════════════════════════════════════════════════════════════════════════
// partnerRoutes.js — the account link between the AI QS portal and AI Trades
// Pilot (the sibling app). Mounted at /api/partner/*.
//
// A builder who already has an AI QS account can connect it from inside AI
// Trades Pilot. AI Trades Pilot (the peer) calls these routes server-to-server:
//
//   POST /api/partner/account-lookup   { email }            → { exists, boqs }
//   POST /api/partner/link             { email, password }  → { link_token, user, boqs }
//   GET  /api/partner/projects          Bearer <link_token>  → { projects: [...] }
//   GET  /api/partner/projects/:id/boq  Bearer <link_token>  → the delivered BOQ file
//
// Trust: every call carries the shared peer key (x-brain-key: SUPER_BRAIN_KEY,
// the same key the Super Brain exchange already uses), so nobody but the
// sibling app can ask. The link token is a JWT signed with that key, scoped to
// one AI QS user, and only ever unlocks that user's own projects. Passwords are
// checked here exactly as /auth/login checks them and are never stored.
//
// createPartnerRouter(deps) exists so the tests can run it against an
// in-memory database; the default export is wired to the real one.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('./publicRateLimit');

const LINK_SCOPE = 'partner-link';
const LINK_TTL = '365d';

function createPartnerRouter({ db, outputsDir, logActivity = () => {}, getKey = () => process.env.SUPER_BRAIN_KEY || '', appId = process.env.SUPER_BRAIN_APP_ID || 'aiqs-portal' }) {
  const router = express.Router();

  function keyMatches(given) {
    const key = getKey();
    if (!key || !given) return false;
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(key));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Only the sibling app, proven by the shared key.
  function requirePeer(req, res, next) {
    if (!getKey()) return res.status(503).json({ error: 'Account linking is not configured on this server (SUPER_BRAIN_KEY is unset).' });
    if (!keyMatches(req.get('x-brain-key'))) return res.status(401).json({ error: 'Peer key required.' });
    req.peerApp = req.get('x-brain-app') || 'peer';
    next();
  }

  // …and, for project routes, a link token that names one AI QS user.
  function requireLink(req, res, next) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Link token required.' });
    try {
      const decoded = jwt.verify(auth.slice(7).trim(), getKey());
      if (decoded.scope !== LINK_SCOPE || !decoded.sub) throw new Error('wrong scope');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.sub);
      if (!user) return res.status(401).json({ error: 'That AI QS account no longer exists.', code: 'LINK_INVALID' });
      if (user.suspended) return res.status(403).json({ error: 'That AI QS account is suspended.', code: 'SUSPENDED' });
      req.linkedUser = user;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'The link to this AI QS account has expired — connect it again.', code: 'LINK_INVALID' });
    }
  }

  const normEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 254);

  // A primary account, or an authorised sign-in email that maps onto one.
  function resolveAccount(email) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) return { user, delegate: null };
    let delegate = null;
    try { delegate = db.prepare('SELECT * FROM authorized_emails WHERE email = ?').get(email); } catch (e) { delegate = null; }
    if (!delegate) return null;
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(delegate.user_id);
    return owner ? { user: owner, delegate } : null;
  }

  // The user's projects that have a delivered BOQ (the spreadsheet AI Trades
  // Pilot turns into a job). Mirrors the dashboard's own query: prefer the
  // synced projects.boq_filename, fall back to the latest BOQ deliverable.
  function pricedProjects(userId) {
    const rows = db.prepare(`
      SELECT p.*,
             (SELECT d.filename FROM project_deliverables d
               WHERE d.project_id = p.id AND d.kind = 'boq' AND d.is_latest = 1
                 AND (d.filename LIKE '%.xlsx' OR d.filename LIKE '%.xls')
               ORDER BY d.version DESC, d.created_at DESC LIMIT 1) AS boq_deliverable_filename,
             (SELECT d.original_name FROM project_deliverables d
               WHERE d.project_id = p.id AND d.kind = 'boq' AND d.is_latest = 1
               ORDER BY d.version DESC, d.created_at DESC LIMIT 1) AS boq_original_name
        FROM projects p
       WHERE p.user_id = ?
       ORDER BY p.updated_at DESC, p.created_at DESC
    `).all(userId);
    return rows
      .map((p) => ({ ...p, boq_filename: p.boq_filename || p.boq_deliverable_filename || null }))
      .filter((p) => p.boq_filename);
  }

  const publicShape = (p) => ({
    id: p.id,
    title: p.title,
    project_type: p.project_type || null,
    description: p.description || null,
    location: p.location || null,
    status: p.status || null,
    total_value: p.total_value != null ? Number(p.total_value) : null,
    currency: p.currency || 'GBP',
    item_count: p.item_count != null ? Number(p.item_count) : null,
    boq_filename: p.boq_filename,
    boq_original_name: p.boq_original_name || p.boq_filename,
    created_at: p.created_at,
    updated_at: p.updated_at,
  });

  const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
  const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

  // Does this email have an AI QS account? Yes/no and a BOQ count — nothing
  // that identifies the person.
  router.post('/partner/account-lookup', requirePeer, lookupLimiter, (req, res) => {
    const email = normEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const acct = resolveAccount(email);
    if (!acct || acct.user.suspended) return res.json({ exists: false, boqs: 0 });
    res.json({ exists: true, boqs: pricedProjects(acct.user.id).length });
  });

  // Prove ownership with the AI QS password and get a link token back.
  router.post('/partner/link', requirePeer, linkLimiter, async (req, res) => {
    try {
      const email = normEmail(req.body && req.body.email);
      const password = req.body && req.body.password;
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
      const acct = resolveAccount(email);
      if (!acct) return res.status(404).json({ error: 'No AI QS account uses that email.', code: 'NO_ACCOUNT' });
      const { user, delegate } = acct;
      const hash = delegate ? delegate.password_hash : user.password_hash;
      if (!hash) {
        if (!delegate && user.google_id) return res.status(400).json({ error: 'That AI QS account signs in with Google, so it has no password. Set one with "Forgot password?" on the AI QS portal, then connect it here.', code: 'GOOGLE_ONLY' });
        return res.status(400).json({ error: 'That AI QS account has no password yet. Set one with "Forgot password?" on the AI QS portal, then connect it here.', code: 'NO_PASSWORD' });
      }
      const ok = await bcrypt.compare(String(password), hash);
      if (!ok) return res.status(401).json({ error: 'That password is not right for the AI QS account.', code: 'WRONG_PASSWORD' });
      if (user.suspended) return res.status(403).json({ error: 'That AI QS account is suspended.', code: 'SUSPENDED' });

      const link_token = jwt.sign({ sub: user.id, scope: LINK_SCOPE, iss: appId, peer: req.peerApp }, getKey(), { expiresIn: LINK_TTL });
      const boqs = pricedProjects(user.id).length;
      try {
        logActivity({ event_type: 'partner_link', title: (user.full_name || user.email) + ' connected their AI QS account to ' + (req.peerApp === 'aitradespilot' ? 'AI Trades Pilot' : req.peerApp), user_id: user.id, user_name: user.full_name, user_email: user.email });
      } catch (e) { /* the log is a nicety */ }
      res.json({ link_token, user: { id: user.id, email: user.email, fullName: user.full_name, company: user.company || null }, boqs });
    } catch (err) {
      console.error('[partner] link failed:', err);
      res.status(500).json({ error: 'Could not connect the account. Please try again.' });
    }
  });

  router.get('/partner/projects', requirePeer, requireLink, (req, res) => {
    res.json({ projects: pricedProjects(req.linkedUser.id).map(publicShape) });
  });

  router.get('/partner/projects/:id/boq', requirePeer, requireLink, (req, res) => {
    const p = pricedProjects(req.linkedUser.id).find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'No delivered BOQ for that project.' });
    const safeName = path.basename(p.boq_filename);
    const filePath = path.join(outputsDir, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'BOQ file not found on the server.' });
    res.download(filePath, p.boq_original_name || safeName);
  });

  return router;
}

module.exports = createPartnerRouter;
module.exports.createPartnerRouter = createPartnerRouter;

// The real wiring, used by index.js. Guarded so a test that only wants the
// factory never opens the production database.
if (require.main !== module && !process.env.PARTNER_ROUTES_FACTORY_ONLY) {
  try {
    const db = require('./database');
    const { logActivity } = require('./activityRoutes');
    const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
    module.exports.router = createPartnerRouter({ db, outputsDir: path.join(DATA_DIR, 'outputs'), logActivity });
  } catch (e) {
    // Leave router undefined; index.js reports it.
    module.exports.routerError = e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxRollout.js
//
// Who can use MAX right now. Two modes:
//
//   'admin'  (default)  admins only — plus any client an admin has given
//                       feature_overrides {"max": true} for early access
//   'all'               every signed-in client
//
// The mode comes from the `max_rollout` row in app_settings when an admin has
// set one (Admin → MAX → "MAX for everyone", or PUT /api/max/settings), and
// otherwise from the MAX_ROLLOUT env var, and otherwise 'admin'. Flipping it
// needs no redeploy: the next request sees the new mode.
//
// requireMax is the server-side gate on everything MAX-only (/api/max,
// /api/transcribe). The client hides the same surfaces from `user.maxEnabled`,
// but the server is the authority — a hand-typed request from a client MAX is
// not on for gets a 403 whatever the UI shows.
//
// MAX includes the estimator: a client MAX is on for can read, edit, export and
// send the estimates MAX drafts for them (auth.js requireEstimator asks here).
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');

const MODES = ['admin', 'all'];
const KEY = 'max_rollout';

function envMode() {
  const v = String(process.env.MAX_ROLLOUT || '').trim().toLowerCase();
  return MODES.includes(v) ? v : 'admin';
}

function storedMode() {
  try {
    const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY);
    return r && MODES.includes(r.value) ? r.value : null;
  } catch (e) { return null; }
}

function mode() { return storedMode() || envMode(); }

function setMode(next, actorId) {
  const m = String(next || '').trim().toLowerCase();
  if (!MODES.includes(m)) throw new Error('Rollout mode must be "admin" or "all".');
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) '
    + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP'
  ).run(KEY, m, actorId || null);
  return m;
}

// users.feature_overrides is JSON text; anything unreadable counts as empty.
function parseOverrides(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}

// Give (or take away) one client's early access, whatever the rollout mode.
function setUserAccess(userId, enabled, actorId) {
  const row = db.prepare('SELECT id, feature_overrides FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  const o = parseOverrides(row.feature_overrides);
  if (enabled) o.max = true; else delete o.max;
  db.prepare('UPDATE users SET feature_overrides = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(Object.keys(o).length ? JSON.stringify(o) : null, userId);
  return { userId, enabled: !!enabled, actorId: actorId || null };
}

// user: a users row (role, feature_overrides) — req.user or a SELECT * row.
function isEnabledFor(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (mode() === 'all') return true;
  const o = parseOverrides(user.feature_overrides);
  return o.max === true;
}

function hasOverride(user) {
  return !!(user && parseOverrides(user.feature_overrides).max === true);
}

function requireMax(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (isEnabledFor(req.user)) return next();
  return res.status(403).json({
    error: "MAX isn't switched on for your account yet. It's rolling out shortly.",
    code: 'MAX_NOT_ENABLED',
  });
}

module.exports = { MODES, mode, envMode, storedMode, setMode, parseOverrides, setUserAccess, isEnabledFor, hasOverride, requireMax };

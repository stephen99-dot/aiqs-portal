// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxRoutes.js   (mounted at /api/max)
//
//   GET  /api/max/status            is MAX on for me, the small-job limits, voice, my allowance
//   POST /api/max/chat              { message, messages?, context? }        → SSE
//   POST /api/max/confirm           { token, approve, edits? }              → SSE
//   GET  /api/max/suggestions       ?path=                                  → JSON
//   GET  /api/max/search?q=         find anything the builder has stored
//   GET  /api/max/activity          what MAX did and what the builder approved
//
//   GET  /api/max/settings          admin: rollout mode, thresholds, allowance, usage
//   PUT  /api/max/settings          admin: change them live — no redeploy
//   PUT  /api/max/users/:id/access  admin: { enabled } early access for one client
//
// Both SSE POSTs stream the events described in maxEngine.js, one JSON object
// per `data:` line, and end after the `done` event (a `memories` event may
// follow it). The tools call this same server back over loopback with the
// builder's own credentials, so the request's Authorization header is
// forwarded as-is. Every route runs behind authMiddleware and every query is
// scoped to req.user.id; everything but /status needs MAX switched on for the
// account (maxRollout.js).
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');
const rollout = require('./maxRollout');
const settings = require('./maxSettings');
const engine = require('./maxEngine');

const router = express.Router();
router.use(authMiddleware);

// ── Fair use ──────────────────────────────────────────────────────────────────
// One usage_log row per model round (action 'max'), so a turn that prices a job
// and reports back counts twice. The daily cap is admin-set (maxSettings) and
// visible to the builder on /status. Admins bypass. The guard never blocks on
// its own failure — a broken limiter must not take out the feature.
function usedToday(userId) {
  try {
    return db.prepare("SELECT COUNT(*) AS c FROM usage_log WHERE user_id = ? AND action = 'max' AND created_at >= datetime('now', '-1 day')").get(userId).c;
  } catch (e) { return 0; }
}
function fairUse(req, res, next) {
  try {
    if (!req.user || req.user.role === 'admin') return next();
    const cap = settings.dailyTurns();
    if (usedToday(req.user.id) >= cap) {
      return res.status(429).json({
        error: "You've reached today's MAX allowance (" + cap + ' in 24 hours). It frees up again tomorrow — if you need more for genuine day-to-day work, contact support and we\'ll raise it.',
        code: 'FAIR_USE_DAILY',
      });
    }
    next();
  } catch (err) {
    console.warn('[max] fair-use check failed open:', err.message);
    next();
  }
}

// Admin only. A non-admin sees 404, not a hint.
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(404).json({ error: 'Not found' });
}

// Where the tools reach the app. The request arrived on this very server, so
// its local port is the one to call back on; an env override covers a proxy
// that terminates TLS on another port.
function loopbackBase(req) {
  if (process.env.MAX_LOOPBACK_URL) return process.env.MAX_LOOPBACK_URL;
  const port = (req.socket && req.socket.localPort) || process.env.PORT || 3001;
  return 'http://127.0.0.1:' + port;
}

function forwardedHeaders(req) {
  const h = {};
  if (req.headers.authorization) h.Authorization = req.headers.authorization;
  else if (req.headers.cookie) h.Cookie = req.headers.cookie;
  if (req.headers['x-estimator-key']) h['x-estimator-key'] = req.headers['x-estimator-key'];
  return h;
}

// Who is asking, for the audit trail.
function auditInfo(req) {
  return { ip: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) };
}

function cleanContext(b) {
  const c = b.context && typeof b.context === 'object' ? b.context : {};
  return {
    path: String(c.path || '').slice(0, 300),
    threadId: c.threadId ? String(c.threadId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) : undefined,
    voice: c.voice === true,
  };
}

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
  const emit = (evt) => {
    if (res.writableEnded) return;
    res.write('data: ' + JSON.stringify(evt) + '\n\n');
  };
  const close = () => { clearInterval(heartbeat); if (!res.writableEnded) res.end(); };
  return { emit, close };
}

// ── Status: open to every signed-in user (it says whether MAX is on) ─────────
router.get('/status', (req, res) => {
  const enabled = rollout.isEnabledFor(req.user);
  const lim = settings.limits();
  let stt = false;
  try { stt = require('./stt').isConfigured(); } catch (e) { stt = false; }
  const cap = settings.dailyTurns();
  const used = enabled && req.user.role !== 'admin' ? usedToday(req.user.id) : 0;
  res.json({
    enabled,
    reason: enabled ? null : "MAX isn't switched on for your account yet.",
    limits: { notice_gbp: lim.notice_gbp, limit_gbp: lim.limit_gbp },
    voice: { stt: enabled && stt },
    allowance: { daily_turns: cap, used_today: used, remaining_today: req.user.role === 'admin' ? null : Math.max(0, cap - used) },
    ai_configured: !!process.env.ANTHROPIC_API_KEY,
  });
});

// ── Admin: who MAX is on for, the thresholds, the allowance ──────────────────
function adminSnapshot() {
  const snap = settings.snapshot();
  let usage = { turns_24h: 0, turns_30d: 0, cost_30d_usd: 0, estimates_30d: 0, over_limit_30d: 0, early_access: 0 };
  try {
    usage.turns_24h = db.prepare("SELECT COUNT(*) AS c FROM usage_log WHERE action IN ('max', 'max_takeoff') AND created_at >= datetime('now', '-1 day')").get().c;
    usage.turns_30d = db.prepare("SELECT COUNT(*) AS c FROM usage_log WHERE action IN ('max', 'max_takeoff') AND created_at >= datetime('now', '-30 days')").get().c;
    usage.cost_30d_usd = Math.round((db.prepare("SELECT COALESCE(SUM(cost_estimate), 0) AS s FROM usage_log WHERE action IN ('max', 'max_takeoff', 'dictation_stt') AND created_at >= datetime('now', '-30 days')").get().s) * 100) / 100;
    usage.estimates_30d = db.prepare("SELECT COUNT(*) AS c FROM quotes WHERE source = 'max' AND created_at >= datetime('now', '-30 days')").get().c;
    usage.over_limit_30d = db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE event_type = 'max_over_limit' AND created_at >= datetime('now', '-30 days')").get().c;
    usage.early_access = db.prepare("SELECT COUNT(*) AS c FROM users WHERE feature_overrides LIKE '%\"max\":true%'").get().c;
  } catch (e) { /* counters only */ }
  let stt = null;
  try { stt = require('./stt').provider(); } catch (e) { stt = null; }
  return { rollout: rollout.mode(), rollout_source: rollout.storedMode() ? 'setting' : 'env', env_default: rollout.envMode(), ...snap, usage, voice: { stt: !!stt, provider: stt, ai_configured: !!process.env.ANTHROPIC_API_KEY } };
}

router.get('/settings', requireAdmin, (req, res) => {
  try { res.json(adminSnapshot()); } catch (err) { res.status(500).json({ error: 'Could not load MAX settings.' }); }
});

router.put('/settings', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const changes = [];
    if (b.rollout !== undefined) {
      const wanted = String(b.rollout || '').trim().toLowerCase();
      if (!rollout.MODES.includes(wanted)) return res.status(400).json({ error: 'rollout must be "admin" or "all".' });
      const before = rollout.mode();
      rollout.setMode(wanted, req.user.id);
      if (before !== wanted) changes.push('rollout ' + before + ' → ' + wanted);
    }
    const numeric = {};
    for (const k of ['notice_gbp', 'limit_gbp', 'daily_turns']) {
      if (b[k] !== undefined && b[k] !== null && b[k] !== '') {
        if (!Number.isFinite(Number(b[k]))) return res.status(400).json({ error: k + ' must be a number.' });
        numeric[k] = Number(b[k]);
      }
    }
    if (numeric.notice_gbp !== undefined && numeric.limit_gbp !== undefined && numeric.notice_gbp > numeric.limit_gbp) {
      return res.status(400).json({ error: 'The notice level cannot be above the limit.' });
    }
    if (Object.keys(numeric).length) {
      const before = settings.snapshot();
      settings.update(numeric, req.user.id);
      const after = settings.snapshot();
      for (const k of Object.keys(numeric)) if (before[k] !== after[k]) changes.push(k + ' ' + before[k] + ' → ' + after[k]);
    }
    if (changes.length) {
      try {
        require('./activityRoutes').logActivity({ event_type: 'max_settings', title: 'MAX settings changed', detail: changes.join('; '), user_id: req.user.id, user_name: req.user.full_name, user_email: req.user.email });
      } catch (e) { /* audit only */ }
    }
    res.json({ ...adminSnapshot(), changes });
  } catch (err) {
    console.error('[max] settings change failed:', err);
    res.status(500).json({ error: err.message || 'Could not save MAX settings.' });
  }
});

router.put('/users/:id/access', requireAdmin, (req, res) => {
  try {
    const enabled = req.body && (req.body.enabled === true || req.body.enabled === 'true');
    const out = rollout.setUserAccess(req.params.id, enabled, req.user.id);
    if (!out) return res.status(404).json({ error: 'User not found' });
    const u = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(req.params.id);
    try {
      require('./activityRoutes').logActivity({ event_type: 'max_access', title: (u.full_name || u.email) + (enabled ? ' — MAX early access on' : ' — MAX early access off'), user_id: u.id, user_name: u.full_name, user_email: u.email });
    } catch (e) { /* audit only */ }
    res.json({ id: req.params.id, maxAccess: enabled, maxEnabled: rollout.isEnabledFor(db.prepare('SELECT role, feature_overrides FROM users WHERE id = ?').get(req.params.id)) });
  } catch (err) {
    console.error('[max] access change failed:', err);
    res.status(500).json({ error: 'Could not change MAX access.' });
  }
});

// ── Everything below needs MAX on for the account ────────────────────────────
router.use(rollout.requireMax);

// No model key on the server: say so plainly instead of streaming a generic failure.
function requireAi(req, res, next) {
  if (process.env.ANTHROPIC_API_KEY) return next();
  return res.status(503).json({ error: "MAX isn't connected to the AI service on this server yet (ANTHROPIC_API_KEY is not set).", code: 'AI_NOT_CONFIGURED' });
}

router.post('/chat', requireAi, fairUse, async (req, res) => {
  const b = req.body || {};
  const text = String(b.message || '').trim();
  if (!text) return res.status(400).json({ error: 'Say what you need.' });
  const { emit, close } = openStream(res);
  try {
    await engine.runTurn({
      user: req.user,
      text,
      messages: b.messages,
      context: cleanContext(b),
      api: engine.makeApi({ baseUrl: loopbackBase(req), headers: forwardedHeaders(req) }),
      emit,
      audit: auditInfo(req),
    });
  } catch (err) {
    console.error('[max] chat failed:', err);
    emit({ type: 'error', message: 'Something went wrong on our side. Try that again.' });
    emit({ type: 'done', messages: null, awaiting: false });
  } finally {
    close();
  }
});

// The approval card's answer. `approve` is only ever true from the Approve
// button's own click (the panel never sets it from a transcript); `edits`
// carries the fields the card marked editable (the customer's email).
router.post('/confirm', requireAi, fairUse, async (req, res) => {
  const b = req.body || {};
  if (!b.token || typeof b.token !== 'string') return res.status(400).json({ error: 'Missing approval token.' });
  const { emit, close } = openStream(res);
  try {
    await engine.resumeTurn({
      user: req.user,
      token: b.token,
      approve: b.approve === true || b.approve === 'true',
      edits: b.edits && typeof b.edits === 'object' ? b.edits : null,
      api: engine.makeApi({ baseUrl: loopbackBase(req), headers: forwardedHeaders(req) }),
      emit,
      audit: auditInfo(req),
    });
  } catch (err) {
    console.error('[max] confirm failed:', err);
    emit({ type: 'error', message: 'Something went wrong on our side. Try that again.' });
    emit({ type: 'done', messages: null, awaiting: false });
  } finally {
    close();
  }
});

router.get('/suggestions', (req, res) => {
  res.json({ suggestions: engine.suggestionsFor({ path: String(req.query.path || '') }).slice(0, 4) });
});

// GET /api/max/search?q=anderson%20drawings&type=drawing,boq&limit=12
router.get('/search', (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 200);
    if (!q.trim()) return res.json({ query: q, results: [], total: 0 });
    const types = String(req.query.type || '').split(',').map((t) => t.trim()).filter(Boolean);
    const out = require('./maxSearch').search(req.user.id, q, { types, limit: parseInt(req.query.limit, 10) || 12 });
    res.json(out);
  } catch (err) {
    console.error('[max] search failed:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
});

// Only this builder's rows.
router.get('/activity', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = db.prepare(
      "SELECT id, event_type, title, detail, created_at FROM activity_log WHERE user_id = ? AND event_type LIKE 'max_%' ORDER BY created_at DESC, id DESC LIMIT ?"
    ).all(req.user.id, limit);
    res.json({ activities: rows.map((r) => { let d = null; try { d = r.detail ? JSON.parse(r.detail) : null; } catch (e) { d = { text: r.detail }; } return { ...r, detail: d }; }) });
  } catch (err) {
    console.error('[max] activity failed:', err);
    res.status(500).json({ error: 'Could not load MAX activity.' });
  }
});

module.exports = router;
module.exports._internals = { fairUse, usedToday, cleanContext, loopbackBase, forwardedHeaders };

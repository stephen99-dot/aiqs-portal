// 3D Builder API (Phase 1) — admin-only for now.
//
// The page sends a parametric building model; this returns a priced element
// breakdown derived from the geometry and the seeded UK Master Rates library.
// Gated with adminMiddleware so it's only visible to the operator while the
// feature is being proven out (per the build plan). When it's opened up to
// subscribers, swap adminMiddleware for requireEstimator.

'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, adminMiddleware } = require('./auth');
const { priceModel } = require('./builder3dEngine');
const { streamBuilder3dPdf } = require('./builder3dPdf');

const router = express.Router();

// Self-contained schema (same pattern as rateRoutes.js). Stores the input
// params as JSON; the priced breakdown is always recomputed on read so it stays
// in step with rate-library changes.
db.exec(`
  CREATE TABLE IF NOT EXISTS builder3d_models (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    params TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_builder3d_models_user ON builder3d_models(user_id);
`);

// Branding + user display, read the same way the estimator PDF route does.
function getBranding(userId) {
  return db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId) || {
    primary_colour: '#1B2A4A', accent_colour: '#F59E0B', company_name: null, logo_filename: null,
  };
}
function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company, phone FROM users WHERE id = ?').get(userId);
}

router.use(authMiddleware, adminMiddleware);

// Resolve a rate by code first (fast, exact), falling back to a description
// LIKE so the engine still prices even if a deployment seeded a different code.
// Prepared statements are created lazily so this module doesn't assume the
// `rates` table exists at require-time.
let byCodeStmt = null;
let byDescStmt = null;
function lookupRate(code, descLike) {
  try {
    if (!byCodeStmt) {
      byCodeStmt = db.prepare(
        'SELECT description, unit, labour_rate, material_rate, total_rate FROM rates WHERE code = ? LIMIT 1'
      );
      byDescStmt = db.prepare(
        'SELECT description, unit, labour_rate, material_rate, total_rate FROM rates WHERE LOWER(description) LIKE ? LIMIT 1'
      );
    }
    const exact = byCodeStmt.get(code);
    if (exact) return exact;
    if (descLike) {
      const hit = byDescStmt.get('%' + String(descLike).toLowerCase() + '%');
      if (hit) return hit;
    }
  } catch (err) {
    console.error('[Builder3D] rate lookup failed:', err.message);
  }
  return null;
}

// POST /api/builder3d/price — params -> priced breakdown + geometry.
router.post('/price', (req, res) => {
  try {
    res.json(priceModel(req.body || {}, lookupRate));
  } catch (err) {
    console.error('[Builder3D] price error:', err);
    res.status(500).json({ error: 'Could not price the model.' });
  }
});

// ── Saved models ───────────────────────────────────────────────────────────

// GET /models — list the user's saved models (newest first).
router.get('/models', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, params, created_at, updated_at FROM builder3d_models WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.user.id);
  res.json({ models: rows.map((r) => ({ ...r, params: safeParse(r.params) })) });
});

// POST /models — { name, params } -> create.
router.post('/models', (req, res) => {
  const name = String(req.body?.name || '').trim() || 'Untitled model';
  const params = req.body?.params;
  if (!params || typeof params !== 'object') return res.status(400).json({ error: 'params required' });
  const id = uuidv4();
  db.prepare('INSERT INTO builder3d_models (id, user_id, name, params) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, name, JSON.stringify(params));
  res.json({ id, name, params });
});

// PUT /models/:id — { name?, params? } -> update (scoped to the owner).
router.put('/models/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM builder3d_models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Model not found.' });
  const name = req.body?.name != null ? String(req.body.name).trim() : existing.name;
  const params = req.body?.params != null ? JSON.stringify(req.body.params) : existing.params;
  db.prepare('UPDATE builder3d_models SET name = ?, params = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(name, params, req.params.id, req.user.id);
  res.json({ id: req.params.id, name, params: safeParse(params) });
});

// DELETE /models/:id
router.delete('/models/:id', (req, res) => {
  const info = db.prepare('DELETE FROM builder3d_models WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Model not found.' });
  res.json({ ok: true });
});

// POST /pdf — { name?, params } -> branded estimate PDF (works for unsaved
// models too; the page posts whatever is on screen).
router.post('/pdf', (req, res) => {
  try {
    const params = req.body?.params || req.body || {};
    const result = priceModel(params, lookupRate);
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    streamBuilder3dPdf(res, req.body?.name || 'Outline estimate', result, branding, userInfo);
  } catch (err) {
    console.error('[Builder3D] PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}

module.exports = router;

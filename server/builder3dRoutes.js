// 3D Builder API (Phase 1) — admin-only for now.
//
// The page sends a parametric building model; this returns a priced element
// breakdown derived from the geometry and the seeded UK Master Rates library.
// Gated with adminMiddleware so it's only visible to the operator while the
// feature is being proven out (per the build plan). When it's opened up to
// subscribers, swap adminMiddleware for requireEstimator.

'use strict';

const express = require('express');
const db = require('./database');
const { authMiddleware, adminMiddleware } = require('./auth');
const { priceModel } = require('./builder3dEngine');

const router = express.Router();

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

// POST /api/builder3d/price — { length, width, wallHeight, storeys, roofPitch,
// windows, doors, wallType, roofCovering, ohpPct, vatPct } -> priced breakdown.
router.post('/price', (req, res) => {
  try {
    const result = priceModel(req.body || {}, lookupRate);
    res.json(result);
  } catch (err) {
    console.error('[Builder3D] price error:', err);
    res.status(500).json({ error: 'Could not price the model.' });
  }
});

module.exports = router;

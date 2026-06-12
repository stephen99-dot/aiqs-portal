// surveyRoutes.js — in-portal feedback surveys.
//
// One row per (user, survey_key). The popup asks three things: star rating,
// ease-of-navigation score out of 10, and a feature wish. Submitting completes
// the survey permanently; "not now" is only snoozed client-side so a gentle
// re-ask happens next session. Admins read the results aggregated.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();

let schemaReady = false;
function ensureSchema() {
  if (schemaReady) return;
  db.exec(`CREATE TABLE IF NOT EXISTS user_surveys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    survey_key TEXT NOT NULL,
    stars INTEGER,
    nav_score INTEGER,
    feature_request TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, survey_key)
  )`);
  schemaReady = true;
}

// GET /api/survey/status?key=portal_2026_06 — has this user already answered?
router.get('/survey/status', authMiddleware, (req, res) => {
  try {
    ensureSchema();
    const key = String(req.query.key || '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'key required' });
    const row = db.prepare('SELECT id FROM user_surveys WHERE user_id = ? AND survey_key = ?').get(req.user.id, key);
    res.json({ completed: !!row });
  } catch (e) {
    console.error('[Survey] status error:', e.message);
    res.status(500).json({ error: 'Failed to check survey status' });
  }
});

// POST /api/survey — { survey_key, stars (1-5), nav_score (1-10), feature_request }
router.post('/survey', authMiddleware, (req, res) => {
  try {
    ensureSchema();
    const b = req.body || {};
    const key = String(b.survey_key || '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'survey_key required' });
    const stars = parseInt(b.stars, 10);
    if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'A star rating (1-5) is required.' });
    const navRaw = parseInt(b.nav_score, 10);
    const navScore = navRaw >= 1 && navRaw <= 10 ? navRaw : null;
    const feature = String(b.feature_request || '').trim().slice(0, 2000) || null;

    db.prepare(`
      INSERT INTO user_surveys (id, user_id, survey_key, stars, nav_score, feature_request)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, survey_key) DO UPDATE SET
        stars = excluded.stars, nav_score = excluded.nav_score, feature_request = excluded.feature_request
    `).run(uuidv4(), req.user.id, key, stars, navScore, feature);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Survey] submit error:', e.message);
    res.status(500).json({ error: 'Failed to save survey' });
  }
});

// GET /api/admin/surveys?key=... — responses + averages (all keys if none given)
router.get('/admin/surveys', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    ensureSchema();
    const key = String(req.query.key || '').slice(0, 64) || null;
    const where = key ? 'WHERE s.survey_key = ?' : '';
    const params = key ? [key] : [];
    const rows = db.prepare(`
      SELECT s.*, u.full_name, u.email, u.company
      FROM user_surveys s JOIN users u ON u.id = s.user_id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT 500
    `).all(...params);
    const summary = db.prepare(`
      SELECT s.survey_key, COUNT(*) AS responses,
             ROUND(AVG(s.stars), 2) AS avg_stars,
             ROUND(AVG(s.nav_score), 2) AS avg_nav_score,
             SUM(CASE WHEN s.feature_request IS NOT NULL THEN 1 ELSE 0 END) AS feature_requests
      FROM user_surveys s ${where ? where.replace('s.survey_key', 's.survey_key') : ''}
      GROUP BY s.survey_key
      ORDER BY MAX(s.created_at) DESC
    `).all(...params);
    res.json({ responses: rows, summary });
  } catch (e) {
    console.error('[Survey] admin list error:', e.message);
    res.status(500).json({ error: 'Failed to load survey results' });
  }
});

module.exports = router;

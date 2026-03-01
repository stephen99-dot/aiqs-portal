const express = require('express');
const router = express.Router();
const db = require('./database');
const { authMiddleware, adminMiddleware } = require('./auth');

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOG — tracks signups, project submissions, plan changes
// Uses SQLite (same as rest of the app)
// ═══════════════════════════════════════════════════════════════════

// Create table on load
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    user_id TEXT,
    user_name TEXT,
    user_email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// ─── Helper: log an activity event ───
function logActivity({ event_type, title, detail, user_id, user_name, user_email }) {
  try {
    db.prepare(
      'INSERT INTO activity_log (event_type, title, detail, user_id, user_name, user_email) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(event_type, title, detail || null, user_id || null, user_name || null, user_email || null);
  } catch (err) {
    console.error('Failed to log activity:', err.message);
  }
}

// ─── GET /api/admin/activity — fetch activity log ───
router.get('/admin/activity', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type || null;

    let query = 'SELECT * FROM activity_log';
    const params = [];
    if (type) {
      query += ' WHERE event_type = ?';
      params.push(type);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const activities = db.prepare(query).all(...params);

    let countQuery = 'SELECT COUNT(*) as count FROM activity_log';
    const countParams = [];
    if (type) {
      countQuery += ' WHERE event_type = ?';
      countParams.push(type);
    }
    const total = db.prepare(countQuery).get(...countParams).count;

    res.json({ activities, total, limit, offset });
  } catch (err) {
    console.error('Failed to fetch activity:', err);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// ─── DELETE /api/admin/activity/:id ───
router.delete('/admin/activity/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare('DELETE FROM activity_log WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

module.exports = { router, logActivity };

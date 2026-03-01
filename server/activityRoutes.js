const express = require('express');
const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOG — tracks signups, project submissions, plan changes
// Mount: app.use('/api', activityRoutes);
// Also call logActivity() from your existing auth/project routes
// ═══════════════════════════════════════════════════════════════════

let pool;

function init(dbPool) {
  pool = dbPool;

  // Create activity_log table
  pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      detail TEXT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name VARCHAR(255),
      user_email VARCHAR(255),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(event_type);
  `).catch(err => console.error('Activity log table creation error:', err));

  return router;
}

// ─── Helper: log an activity event ───
// Call this from your auth routes, project routes, etc.
async function logActivity({ event_type, title, detail, user_id, user_name, user_email, metadata }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO activity_log (event_type, title, detail, user_id, user_name, user_email, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event_type, title, detail || null, user_id || null, user_name || null, user_email || null, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    console.error('Failed to log activity:', err.message);
  }
}

// ─── GET /api/admin/activity — fetch activity log ───
router.get('/admin/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type || null;

    let query = 'SELECT * FROM activity_log';
    const params = [];
    if (type) {
      query += ' WHERE event_type = $1';
      params.push(type);
    }
    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Also get total count
    let countQuery = 'SELECT COUNT(*) FROM activity_log';
    const countParams = [];
    if (type) {
      countQuery += ' WHERE event_type = $1';
      countParams.push(type);
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      activities: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('Failed to fetch activity:', err);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

// ─── DELETE /api/admin/activity/:id — delete single entry ───
router.delete('/admin/activity/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM activity_log WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

module.exports = { init, logActivity };

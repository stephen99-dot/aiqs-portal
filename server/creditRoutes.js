// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT ROUTES — server/creditRoutes.js
// Manages free project credits and enforces limits
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const db = require('./database');

// ─── GET /api/credits — Get current user's credit info ──────────────────────
router.get('/', (req, res) => {
  try {
    const user = db.prepare(`
      SELECT free_credits, total_projects, role FROM users WHERE id = ?
    `).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Admins have unlimited credits
    if (user.role === 'admin') {
      return res.json({
        free_credits: 999,
        total_projects: user.total_projects,
        can_submit: true,
        is_admin: true,
      });
    }

    res.json({
      free_credits: user.free_credits || 0,
      total_projects: user.total_projects || 0,
      can_submit: (user.free_credits || 0) > 0,
      is_admin: false,
    });
  } catch (err) {
    console.error('Credits check error:', err);
    res.status(500).json({ error: 'Failed to check credits' });
  }
});

// ─── POST /api/credits/use — Consume 1 credit (called when submitting a project)
router.post('/use', (req, res) => {
  try {
    const user = db.prepare('SELECT free_credits, role FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Admins don't use credits
    if (user.role === 'admin') {
      return res.json({ success: true, remaining: 999 });
    }

    if ((user.free_credits || 0) <= 0) {
      return res.status(403).json({
        error: 'No free credits remaining',
        upgrade_required: true,
      });
    }

    db.prepare(`
      UPDATE users 
      SET free_credits = free_credits - 1, 
          total_projects = total_projects + 1,
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(req.user.id);

    res.json({
      success: true,
      remaining: (user.free_credits || 0) - 1,
    });
  } catch (err) {
    console.error('Use credit error:', err);
    res.status(500).json({ error: 'Failed to use credit' });
  }
});

// ─── POST /api/admin/credits/grant — Admin: give credits to a user ──────────
router.post('/grant', (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId, credits } = req.body;
    if (!userId || !credits || credits < 1) {
      return res.status(400).json({ error: 'userId and credits (>0) required' });
    }

    const user = db.prepare('SELECT id, free_credits FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.prepare(`
      UPDATE users SET free_credits = free_credits + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(credits, userId);

    res.json({
      success: true,
      userId,
      new_balance: (user.free_credits || 0) + credits,
    });
  } catch (err) {
    console.error('Grant credits error:', err);
    res.status(500).json({ error: 'Failed to grant credits' });
  }
});

module.exports = router;

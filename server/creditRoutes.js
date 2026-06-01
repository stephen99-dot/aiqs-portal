// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT ROUTES — server/creditRoutes.js
// Manages free project credits and enforces limits
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const db = require('./database');
const { getBoqBalance, consumeBoqCredit } = require('./boqCredits');

// ─── GET /api/credits — Get current user's credit info ──────────────────────
// `free_credits` here is the SINGLE spendable balance (free_credits + bonus_docs
// + monthly allowance remaining), kept for backwards-compatibility with the
// frontend which reads `credits.free_credits` as "BOQ credits remaining".
router.get('/', (req, res) => {
  try {
    const user = db.prepare('SELECT id, total_projects, role FROM users WHERE id = ?').get(req.user.id);
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

    const { total } = getBoqBalance(user.id);

    res.json({
      free_credits: total,
      total_projects: user.total_projects || 0,
      can_submit: total > 0,
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
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Admins don't use credits
    if (user.role === 'admin') {
      return res.json({ success: true, remaining: 999 });
    }

    const before = getBoqBalance(user.id);
    if (before.total <= 0) {
      return res.status(403).json({
        error: 'No BOQ credits remaining',
        upgrade_required: true,
      });
    }

    db.prepare('UPDATE users SET total_projects = total_projects + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    const after = consumeBoqCredit(user.id, { eventAlreadyLogged: false });

    res.json({
      success: true,
      remaining: after.total,
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

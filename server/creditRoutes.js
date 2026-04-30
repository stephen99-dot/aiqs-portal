// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT ROUTES — server/creditRoutes.js
// Manages free project credits and enforces limits
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const db = require('./database');

function getCycleStart(user) {
  if (user && user.billing_cycle_start) return user.billing_cycle_start;
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Compute spendable BOQ credits across ALL the columns BOQ credits live in.
// There are three independent sources, all of which look like 'credits' to the user:
//   1. free_credits   — written by Stripe top-ups & signup
//   2. bonus_docs     — written by the legacy admin grant UI
//   3. monthly_boq_quota minus drawing_submissions this billing cycle
//      — written by the User Management 'Documents / BOQs' allowance field
function spendableBoqCredits(user) {
  const free = user.free_credits || 0;
  const bonus = user.bonus_docs || 0;
  const monthlyQuota = user.monthly_boq_quota || 0;
  let monthlyRemaining = 0;
  if (monthlyQuota > 0) {
    const cycleStart = getCycleStart(user);
    const used = db.prepare(
      'SELECT COUNT(*) AS c FROM drawing_submissions WHERE user_id = ? AND created_at >= ?'
    ).get(user.id, cycleStart).c;
    monthlyRemaining = Math.max(0, monthlyQuota - used);
  }
  return { free, bonus, monthlyRemaining, total: free + bonus + monthlyRemaining };
}

// ─── GET /api/credits — Get current user's credit info ──────────────────────
router.get('/', (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, free_credits, bonus_docs, monthly_boq_quota, billing_cycle_start,
             total_projects, role
      FROM users WHERE id = ?
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

    const { total } = spendableBoqCredits(user);

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
    const user = db.prepare('SELECT free_credits, bonus_docs, role FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Admins don't use credits
    if (user.role === 'admin') {
      return res.json({ success: true, remaining: 999 });
    }

    const free = user.free_credits || 0;
    const bonus = user.bonus_docs || 0;
    if (free + bonus <= 0) {
      return res.status(403).json({
        error: 'No free credits remaining',
        upgrade_required: true,
      });
    }

    // Spend free_credits first, then bonus_docs.
    if (free > 0) {
      db.prepare(`
        UPDATE users
        SET free_credits = free_credits - 1,
            total_projects = total_projects + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.user.id);
    } else {
      db.prepare(`
        UPDATE users
        SET bonus_docs = bonus_docs - 1,
            total_projects = total_projects + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.user.id);
    }

    res.json({
      success: true,
      remaining: free + bonus - 1,
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

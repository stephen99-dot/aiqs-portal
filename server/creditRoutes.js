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

// ─── GET /api/credits/pending — Admin: list unclaimed Stripe payments ───────
// Payments that couldn't be matched to an account at webhook time (e.g. paid
// via Payment Link with a different email). Surfaced here so they can be
// reconciled instead of silently lost.
router.get('/pending', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const rows = db.prepare(
      'SELECT * FROM pending_credits WHERE claimed_at IS NULL ORDER BY created_at DESC'
    ).all();
    res.json({ pending: rows });
  } catch (err) {
    console.error('List pending credits error:', err);
    res.status(500).json({ error: 'Failed to list pending credits' });
  }
});

// ─── POST /api/credits/pending/:id/assign — Admin: grant a pending payment ──
// Assigns the recorded credits to a chosen user (by userId) or, if omitted, to
// the user whose email matches the payment.
router.post('/pending/:id/assign', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const row = db.prepare('SELECT * FROM pending_credits WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pending credit not found' });
    if (row.claimed_at) return res.status(409).json({ error: 'Already claimed' });

    const userId = req.body.userId;
    const user = userId
      ? db.prepare('SELECT id, email, free_credits FROM users WHERE id = ?').get(userId)
      : (row.email ? db.prepare('SELECT id, email, free_credits FROM users WHERE LOWER(email) = ?').get(row.email.toLowerCase()) : null);
    if (!user) return res.status(404).json({ error: 'No target user — pass a userId or ensure a user with the payment email exists' });

    const credits = row.credits > 0 ? row.credits : (req.body.credits || 0);
    if (credits < 1) return res.status(400).json({ error: 'This payment had no mapped credits — pass an explicit credits amount' });

    db.prepare('UPDATE users SET free_credits = COALESCE(free_credits, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(credits, user.id);
    db.prepare('UPDATE pending_credits SET claimed_at = CURRENT_TIMESTAMP, claimed_by = ? WHERE id = ?').run(user.id, row.id);

    res.json({ success: true, userId: user.id, email: user.email, credits, new_balance: (user.free_credits || 0) + credits });
  } catch (err) {
    console.error('Assign pending credit error:', err);
    res.status(500).json({ error: 'Failed to assign pending credit' });
  }
});

module.exports = router;

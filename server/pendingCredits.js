// ═══════════════════════════════════════════════════════════════════════════════
// PENDING CREDITS — server/pendingCredits.js
//
// Safety net for Stripe one-off BOQ credit-pack payments that arrive without a
// matching portal user (the classic case: a buyer pays via a static Payment
// Link using a different email than their account, so the webhook can't tell
// whose account to credit).
//
// Instead of silently dropping the payment, the webhook records it here. The
// credits are then auto-claimed the moment a user with that email next logs in
// or registers, and an admin can list/reconcile anything still outstanding.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');
const { v4: uuidv4 } = require('uuid');

// Record a paid-but-unmatched checkout so it can be reconciled later.
// `credits` is the number of BOQ credits the payment was worth (0 when even the
// amount couldn't be mapped to a known pack — still worth recording for audit).
function recordPendingCredit(session, email, credits, reason) {
  try {
    db.prepare(
      'INSERT OR IGNORE INTO pending_credits (id, stripe_session_id, email, amount_total, credits, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      'pc_' + uuidv4().slice(0, 8),
      session.id || null,
      email ? email.toLowerCase() : null,
      session.amount_total || 0,
      credits || 0,
      reason || null
    );
  } catch (e) {
    console.error('[PendingCredits] Failed to record pending credit:', e.message);
  }
}

// Grant any unclaimed credits that belong to this user's email. Called on login
// and registration. Returns the number of credits granted (0 if none).
function claimPendingCredits(user) {
  if (!user || !user.email) return 0;
  let granted = 0;
  try {
    const rows = db.prepare(
      'SELECT * FROM pending_credits WHERE claimed_at IS NULL AND credits > 0 AND LOWER(email) = ?'
    ).all(user.email.toLowerCase());
    for (const row of rows) {
      db.prepare('UPDATE users SET free_credits = COALESCE(free_credits, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(row.credits, user.id);
      db.prepare('UPDATE pending_credits SET claimed_at = CURRENT_TIMESTAMP, claimed_by = ? WHERE id = ?')
        .run(user.id, row.id);
      granted += row.credits;
      console.log(`[PendingCredits] Auto-claimed ${row.credits} BOQ credit(s) for ${user.email} (session ${row.stripe_session_id})`);
    }
  } catch (e) {
    console.error('[PendingCredits] claimPendingCredits failed:', e.message);
  }
  return granted;
}

module.exports = { recordPendingCredit, claimPendingCredits };

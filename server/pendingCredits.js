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
      // Close the loop with the admin: the earlier "needs review" payment has
      // resolved itself, so they know NOT to also add the credits by hand.
      notifyAutoClaimed(user, row);
    }
  } catch (e) {
    console.error('[PendingCredits] claimPendingCredits failed:', e.message);
  }
  return granted;
}

// Admin bell + email: a previously-unmatched payment just landed on the right
// account by itself. Fire-and-forget — must never break a login.
function notifyAutoClaimed(user, row) {
  const who = (user.full_name || user.email) + ' (' + user.email + ')';
  try {
    db.prepare('INSERT INTO notifications (id, type, title, detail, icon) VALUES (?, ?, ?, ?, ?)').run(
      uuidv4(), 'credits_auto_claimed',
      row.credits + ' pending credit(s) auto-applied — ' + (user.full_name || user.email),
      'The earlier unmatched Stripe payment matched this email and was applied automatically. No action needed.',
      'credit-card'
    );
  } catch (e) { /* bell is best-effort */ }
  try {
    const mailer = require('./mailer');
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';
    mailer.sendMail({
      platform: true,
      type: 'pending_credit_claimed_admin',
      to: ADMIN_EMAIL,
      subject: 'Resolved: pending Stripe payment auto-applied — ' + user.email + ' (+' + row.credits + ' credit' + (row.credits === 1 ? '' : 's') + ')',
      heading: 'Pending payment resolved itself',
      paragraphs: [
        'The Stripe payment flagged "needs review" for ' + (row.email || 'unknown email') + ' has now been matched: ' + who + ' signed in and ' + row.credits + ' BOQ credit(s) were applied automatically.',
        'No action needed — do NOT add these credits manually, they are already on the account.',
        'Stripe session: ' + (row.stripe_session_id || 'n/a'),
      ],
    }).catch(() => {});
  } catch (e) { /* mail is best-effort */ }
}

// Admin has just SET a user's balance by hand (the "Save credits" control).
// Any payment for this email still sitting unclaimed is considered reconciled
// by that manual set — mark it claimed so the user's next login doesn't add it
// AGAIN on top (the classic "I credited 5, they logged in, now it's 10").
function absorbPendingCredits(user, adminId) {
  if (!user || !user.email) return 0;
  let absorbed = 0;
  try {
    const rows = db.prepare(
      'SELECT * FROM pending_credits WHERE claimed_at IS NULL AND LOWER(email) = ?'
    ).all(user.email.toLowerCase());
    for (const row of rows) {
      db.prepare("UPDATE pending_credits SET claimed_at = CURRENT_TIMESTAMP, claimed_by = ?, reason = COALESCE(reason, '') || ' | reconciled by admin set-credits' WHERE id = ?")
        .run(user.id, row.id);
      absorbed += row.credits || 0;
      console.log(`[PendingCredits] Absorbed pending ${row.credits} credit(s) for ${user.email} into admin manual set (session ${row.stripe_session_id}, by admin ${adminId || 'unknown'})`);
    }
  } catch (e) {
    console.error('[PendingCredits] absorbPendingCredits failed:', e.message);
  }
  return absorbed;
}

module.exports = { recordPendingCredit, claimPendingCredits, absorbPendingCredits };

// ═══════════════════════════════════════════════════════════════════════════════
// BOQ CREDITS — server/boqCredits.js
//
// Single source of truth for a user's spendable BOQ credit balance.
//
// The balance is a simple, persistent top-up number — it does NOT reset monthly.
// New accounts start at 0. An admin can set it to any value (and the portal shows
// exactly that). Buying BOQs in the portal adds to it. Generating a BOQ in the
// chatbot or submitting drawings spends exactly one.
//
//     balance = free_credits + bonus_docs
//
//   • free_credits — purchased (Stripe packs) or admin-set "credits"
//   • bonus_docs   — admin-granted bonus
//
// The legacy `monthly_boq_quota` (a subscription allowance that reset each billing
// cycle) is no longer part of the balance — we don't run on monthly quotas.
// `used` below is the lifetime count of BOQs spent and is only used cosmetically
// to render the dashboard's used/total bar.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');

// Pull only the columns we need, fresh from the DB. We never trust a passed-in
// user object because the auth middleware's req.user omits free_credits.
function loadUser(userId) {
  return db.prepare(
    'SELECT id, role, free_credits, bonus_docs FROM users WHERE id = ?'
  ).get(userId);
}

// Lifetime BOQ consumptions — original BOQs generated in the chatbot
// (doc_generated) plus Submit-Drawings jobs. Revisions are logged as
// 'doc_revision' (not 'doc_generated') so they are naturally excluded — a
// revision does not consume a credit. Cosmetic only (drives the used/total bar).
function boqUsedTotal(userId) {
  let gen = 0;
  let subs = 0;
  try {
    gen = db.prepare(
      "SELECT COUNT(*) AS c FROM usage_log WHERE user_id = ? AND action = 'doc_generated'"
    ).get(userId).c || 0;
  } catch (e) { /* usage_log may not exist in some envs */ }
  try {
    subs = db.prepare(
      'SELECT COUNT(*) AS c FROM drawing_submissions WHERE user_id = ?'
    ).get(userId).c || 0;
  } catch (e) { /* table may not exist yet */ }
  return gen + subs;
}

// The single spendable balance, broken down so callers can show detail if they
// want. Admins are effectively unlimited.
function getBoqBalance(userId) {
  const u = loadUser(userId);
  if (!u) {
    return { total: 0, free: 0, bonus: 0, used: 0, isAdmin: false };
  }
  if (u.role === 'admin') {
    return { total: Infinity, free: 0, bonus: 0, used: 0, isAdmin: true };
  }
  const free = u.free_credits || 0;
  const bonus = u.bonus_docs || 0;
  return {
    total: free + bonus,
    free, bonus,
    used: boqUsedTotal(u.id),
    isAdmin: false,
  };
}

// Charge exactly one BOQ credit and return the resulting balance. Spends
// bonus_docs first, then free_credits. The caller gates on a positive balance;
// if nothing is left we let the event stand rather than throw mid-request.
function consumeBoqCredit(userId, opts = {}) {
  const u = loadUser(userId);
  if (!u || u.role === 'admin') return getBoqBalance(userId);

  if ((u.bonus_docs || 0) > 0) {
    db.prepare('UPDATE users SET bonus_docs = bonus_docs - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  } else if ((u.free_credits || 0) > 0) {
    db.prepare('UPDATE users SET free_credits = free_credits - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  }

  return getBoqBalance(userId);
}

module.exports = { getBoqBalance, consumeBoqCredit };

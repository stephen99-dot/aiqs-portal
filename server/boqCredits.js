// ═══════════════════════════════════════════════════════════════════════════════
// BOQ CREDITS — server/boqCredits.js
//
// Single source of truth for a user's spendable BOQ credit balance.
//
// Historically there were two parallel, inconsistent systems:
//   • a decrementing balance  → free_credits + bonus_docs  (packs, admin grants)
//   • a usage-counting quota   → monthly_boq_quota minus BOQs used this cycle
// They were read in different places and the chatbot never touched the balance,
// so a granted credit never visibly went down when a job was submitted or a BOQ
// was generated. This module collapses them into ONE number that every screen
// and every consuming path (Submit Drawings + chatbot BOQ generation) shares.
//
// A user's balance is:
//     free_credits  +  bonus_docs  +  max(0, monthly_boq_quota − usedThisCycle)
//
// "usedThisCycle" = original BOQs generated in the chatbot (doc_generated) plus
// Submit-Drawings jobs (drawing_submissions) recorded since the cycle start.
// Consumption order is monthly allowance first (it expires each cycle), then
// bonus_docs, then free_credits (which never expire — spend them last).
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');
const { getBillingCycleStart } = require('./billingCycle');

// Pull only the columns we need, fresh from the DB. We never trust a passed-in
// user object because the auth middleware's req.user omits free_credits and
// billing_cycle_start.
function loadUser(userId) {
  return db.prepare(
    'SELECT id, role, free_credits, bonus_docs, monthly_boq_quota, billing_cycle_start FROM users WHERE id = ?'
  ).get(userId);
}

// `created_at` columns default to SQLite's CURRENT_TIMESTAMP, which is UTC in
// "YYYY-MM-DD HH:MM:SS" form. getBillingCycleStart() returns an ISO string
// ("…THH:MM:SS.sssZ"). A raw string compare fails on the cycle-start day
// because ' ' (0x20) sorts before 'T' (0x54), wrongly excluding same-day rows.
// Normalise the anchor to the same shape so the comparison is correct.
function toSqlTimestamp(iso) {
  try { return new Date(iso).toISOString().slice(0, 19).replace('T', ' '); }
  catch (e) { return iso; }
}

// BOQ consumptions charged to this billing cycle. Revisions are logged as
// 'doc_revision' (not 'doc_generated') so they are naturally excluded — a
// revision does not consume a credit.
function boqUsedThisCycle(userId, cycleStart) {
  const since = toSqlTimestamp(cycleStart);
  let gen = 0;
  let subs = 0;
  try {
    gen = db.prepare(
      "SELECT COUNT(*) AS c FROM usage_log WHERE user_id = ? AND action = 'doc_generated' AND created_at >= ?"
    ).get(userId, since).c || 0;
  } catch (e) { /* usage_log may not exist in some envs */ }
  try {
    subs = db.prepare(
      'SELECT COUNT(*) AS c FROM drawing_submissions WHERE user_id = ? AND created_at >= ?'
    ).get(userId, since).c || 0;
  } catch (e) { /* table may not exist yet */ }
  return gen + subs;
}

// The single spendable balance, broken down so callers can show detail if they
// want. Admins are effectively unlimited.
function getBoqBalance(userId) {
  const u = loadUser(userId);
  if (!u) {
    return { total: 0, free: 0, bonus: 0, monthlyQuota: 0, monthlyRemaining: 0, used: 0, isAdmin: false };
  }
  if (u.role === 'admin') {
    return { total: Infinity, free: 0, bonus: 0, monthlyQuota: 0, monthlyRemaining: Infinity, used: 0, isAdmin: true };
  }
  const free = u.free_credits || 0;
  const bonus = u.bonus_docs || 0;
  const monthlyQuota = u.monthly_boq_quota || 0;
  const cycleStart = getBillingCycleStart(u);
  const used = boqUsedThisCycle(u.id, cycleStart);
  const monthlyRemaining = Math.max(0, monthlyQuota - used);
  return {
    total: free + bonus + monthlyRemaining,
    free, bonus, monthlyQuota, monthlyRemaining, used,
    isAdmin: false,
  };
}

// Charge exactly one BOQ credit and return the resulting balance.
//
// `eventAlreadyLogged` tells us whether the consuming event (the doc_generated
// or drawing_submission row) has ALREADY been written when we're called. We
// need the monthly "remaining" measured BEFORE this consumption to decide
// whether the monthly allowance absorbs it or we dip into bonus/free credits.
//   • Submit Drawings calls this BEFORE inserting its row → eventAlreadyLogged: false
//   • The chatbot calls this AFTER logging doc_generated   → eventAlreadyLogged: true
function consumeBoqCredit(userId, opts = {}) {
  const eventAlreadyLogged = opts.eventAlreadyLogged || false;
  const u = loadUser(userId);
  if (!u || u.role === 'admin') return getBoqBalance(userId);

  const monthlyQuota = u.monthly_boq_quota || 0;
  const cycleStart = getBillingCycleStart(u);
  let used = boqUsedThisCycle(u.id, cycleStart);
  if (eventAlreadyLogged) used = Math.max(0, used - 1);
  const monthlyRemainingBefore = Math.max(0, monthlyQuota - used);

  if (monthlyRemainingBefore > 0) {
    // The monthly allowance covers it — the logged event row IS the deduction,
    // so there's no column to touch.
  } else if ((u.bonus_docs || 0) > 0) {
    db.prepare('UPDATE users SET bonus_docs = bonus_docs - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  } else if ((u.free_credits || 0) > 0) {
    db.prepare('UPDATE users SET free_credits = free_credits - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  }
  // If nothing was available the caller should have gated already; we still let
  // the event stand rather than throw mid-request.

  return getBoqBalance(userId);
}

module.exports = { getBoqBalance, consumeBoqCredit, boqUsedThisCycle };

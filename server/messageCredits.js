// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE CREDITS — server/messageCredits.js
//
// Single source of truth for a user's spendable chatbot-message balance.
//
// Mirrors boqCredits.js: a simple, persistent top-up number that does NOT reset
// monthly. New accounts start at 0. An admin sets it to any value (the portal
// shows exactly that). Each chatbot message the user sends spends one credit.
//
//     balance = message_credits
//
// `used` is the lifetime count of messages sent and is cosmetic only (drives the
// dashboard's used/total bar).
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');

function loadUser(userId) {
  return db.prepare('SELECT id, role, message_credits FROM users WHERE id = ?').get(userId);
}

// Lifetime messages sent — cosmetic, drives the used/total bar.
function messagesUsedTotal(userId) {
  try {
    return db.prepare(
      "SELECT COUNT(*) AS c FROM usage_log WHERE user_id = ? AND action = 'chat_message'"
    ).get(userId).c || 0;
  } catch (e) {
    return 0;
  }
}

// The single spendable message balance. Admins are effectively unlimited.
function getMessageBalance(userId) {
  const u = loadUser(userId);
  if (!u) return { total: 0, used: 0, isAdmin: false };
  if (u.role === 'admin') return { total: Infinity, used: 0, isAdmin: true };
  return {
    total: u.message_credits || 0,
    used: messagesUsedTotal(u.id),
    isAdmin: false,
  };
}

// Charge exactly one message credit and return the resulting balance. The caller
// gates on a positive balance; we never let it go below 0.
function consumeMessageCredit(userId) {
  const u = loadUser(userId);
  if (!u || u.role === 'admin') return getMessageBalance(userId);
  if ((u.message_credits || 0) > 0) {
    db.prepare('UPDATE users SET message_credits = message_credits - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  }
  return getMessageBalance(userId);
}

module.exports = { getMessageBalance, consumeMessageCredit };

// ═══════════════════════════════════════════════════════════════════════════════
// UNLIMITED PLAN — server/unlimitedPlan.js
//
// The Unlimited plan gives a client:
//
//   • unlimited BOQs — generating a BOQ in the chatbot or submitting drawings
//     never deducts a credit while they are on the plan (exactly how admins
//     are treated today). Any purchased/granted credits they already hold are
//     left untouched, so they are still there if the plan is ever removed.
//   • UNLIMITED_PLAN_MESSAGES chatbot messages — granted when the plan is
//     applied by topping the persistent message balance UP to that figure
//     (never down). Messages still tick down per message as normal; an admin
//     can top up again from Users → Manage at any time.
//
// `plan = 'unlimited'` on the users row is the single switch. hasUnlimitedBoqs()
// is the one predicate every spend path uses, so admins and Unlimited clients
// always get the same treatment.
// ═══════════════════════════════════════════════════════════════════════════════

const UNLIMITED_PLAN = 'unlimited';
const UNLIMITED_PLAN_MESSAGES = parseInt(process.env.UNLIMITED_PLAN_MESSAGES, 10) || 1000;

function isUnlimitedPlan(user) {
  return !!user && user.plan === UNLIMITED_PLAN;
}

// Admins have always been unlimited; Unlimited-plan clients join them.
function hasUnlimitedBoqs(user) {
  return !!user && (user.role === 'admin' || isUnlimitedPlan(user));
}

// Put a user on the Unlimited plan and grant the plan's messages. The message
// top-up happens when the plan is first applied (or re-applied after being
// removed); saving the plan again on someone already on it leaves their
// balance alone unless `topUpMessages` is forced. Returns what changed.
function grantUnlimitedPlan(userId, { db = require('./database'), topUpMessages } = {}) {
  const before = db.prepare('SELECT id, role, plan, message_credits FROM users WHERE id = ?').get(userId);
  if (!before) return null;

  const wasUnlimited = before.plan === UNLIMITED_PLAN;
  const messagesBefore = before.message_credits || 0;
  const topUp = topUpMessages === undefined ? !wasUnlimited : !!topUpMessages;
  const messagesAfter = topUp ? Math.max(messagesBefore, UNLIMITED_PLAN_MESSAGES) : messagesBefore;

  db.prepare('UPDATE users SET plan = ?, message_credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(UNLIMITED_PLAN, messagesAfter, userId);

  // They can no longer run out of BOQ credits, so stop any top-up reminder
  // drip that was running. Columns live in creditNotifications.js and may not
  // exist in every environment.
  try {
    db.prepare('UPDATE users SET credits_out_at = NULL, credit_reminder_stage = 0 WHERE id = ?').run(userId);
  } catch (e) { /* reminder columns not present */ }

  return {
    wasUnlimited,
    messagesBefore,
    messagesAfter,
    messagesGranted: messagesAfter - messagesBefore,
  };
}

module.exports = { UNLIMITED_PLAN, UNLIMITED_PLAN_MESSAGES, isUnlimitedPlan, hasUnlimitedBoqs, grantUnlimitedPlan };

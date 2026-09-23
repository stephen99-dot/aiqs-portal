// ═══════════════════════════════════════════════════════════════════════════════
// SIGNUP CREDITS — server/signupCredits.js
//
// What a brand-new account starts with:
//
//   • 150 chatbot message credits — every new account, however it was made
//     (self-signup, Google, email submission, added by an admin).
//   • 1 free BOQ credit — self-signups only (freeBoq: true), and only if they
//     did NOT buy a pack before signing up. Someone who paid through Stripe
//     first has a pending_credits row for their email; they get exactly the
//     credits they bought (claimed by claimPendingCredits) and no free one.
//     Email-submission accounts already start with their free credit, and
//     admin-created ones get whatever the admin sets.
//
// Idempotent per user via a 'signup_credits' usage_log row.
// ═══════════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');

const SIGNUP_MESSAGE_CREDITS = parseInt(process.env.SIGNUP_MESSAGE_CREDITS, 10) || 150;
const SIGNUP_FREE_BOQ_CREDITS = 1;

// True when a Stripe payment for this email arrived before the account existed.
// Any row counts, claimed or not, including payments whose amount matched no
// pack: they still bought first.
function boughtBeforeSignup(db, email) {
  if (!email) return false;
  try {
    return !!db.prepare('SELECT 1 FROM pending_credits WHERE LOWER(email) = ? LIMIT 1').get(String(email).toLowerCase());
  } catch (e) {
    return false; // table missing in some envs: treat as no purchase
  }
}

function grantSignupCredits(user, { freeBoq = true, db = require('./database') } = {}) {
  if (!user || !user.id || user.role === 'admin') return { messages: 0, boq: 0 };
  const already = db.prepare("SELECT 1 FROM usage_log WHERE user_id = ? AND action = 'signup_credits'").get(user.id);
  if (already) return { messages: 0, boq: 0 };

  const boq = freeBoq && !boughtBeforeSignup(db, user.email) ? SIGNUP_FREE_BOQ_CREDITS : 0;
  db.prepare(`UPDATE users SET message_credits = COALESCE(message_credits, 0) + ?,
              free_credits = COALESCE(free_credits, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(SIGNUP_MESSAGE_CREDITS, boq, user.id);
  db.prepare('INSERT INTO usage_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(
    'ul_' + uuidv4().slice(0, 8), user.id, 'signup_credits',
    `${SIGNUP_MESSAGE_CREDITS} message credits` + (boq ? `, ${boq} free BOQ credit` : freeBoq ? ', no free BOQ credit (bought a pack before signing up)' : '')
  );
  console.log(`[SignupCredits] ${user.email}: +${SIGNUP_MESSAGE_CREDITS} message credits, +${boq} free BOQ credit`);
  return { messages: SIGNUP_MESSAGE_CREDITS, boq };
}

module.exports = { grantSignupCredits, boughtBeforeSignup, SIGNUP_MESSAGE_CREDITS, SIGNUP_FREE_BOQ_CREDITS };

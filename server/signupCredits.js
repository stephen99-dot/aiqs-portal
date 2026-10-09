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

// True when a Stripe payment for this email arrived before the account existed
// and is still waiting to be claimed — this new account is about to receive
// it. Payments whose amount matched no pack count too: they still bought
// first. A payment an EARLIER account already claimed does not: those credits
// went to that account, so they must not cost a fresh signup on the same
// email (a deleted-and-recreated account, or a test purchase) its free BOQ.
function boughtBeforeSignup(db, email) {
  if (!email) return false;
  try {
    return !!db.prepare('SELECT 1 FROM pending_credits WHERE LOWER(email) = ? AND claimed_at IS NULL LIMIT 1').get(String(email).toLowerCase());
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

// What the admin's "new signup" alert says about the account's starting
// balance, worded from the live row (free_credits / message_credits after
// grantSignupCredits and claimPendingCredits have both run) so it can never
// drift from what the portal shows. `claimed` is the number of BOQ credits
// claimPendingCredits pulled in from a pack bought before the account existed.
function describeSignupCredits({ freeCredits, messageCredits, claimed } = {}) {
  const boq = Math.max(0, Number(freeCredits) || 0);
  const bought = Math.max(0, Number(claimed) || 0);
  const messages = Math.max(0, Number(messageCredits) || 0);
  const n = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');
  let boqLine;
  if (bought > 0) {
    boqLine = n(boq, 'BOQ credit') + ' — ' + n(bought, 'credit') + ' bought before signing up, applied automatically (nothing to add by hand)';
  } else if (boq > 0) {
    boqLine = n(boq, 'free BOQ credit');
  } else {
    boqLine = 'None — pays per BOQ';
  }
  return { boq: boqLine, messages: n(messages, 'message credit') };
}

module.exports = { grantSignupCredits, boughtBeforeSignup, describeSignupCredits, SIGNUP_MESSAGE_CREDITS, SIGNUP_FREE_BOQ_CREDITS };

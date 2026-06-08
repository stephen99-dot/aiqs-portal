const db = require('./database');
const { recordPendingCredit } = require('./pendingCredits');

// Price ID to plan mapping
const PRICE_TO_PLAN = {
  'price_1T52aREOVz3JQx7Ah7HHz1oh': { plan: 'professional', msgQuota: 100, boqQuota: 10 },
  'price_1T6phnEOVz3JQx7A08xGJ8er': { plan: 'professional', msgQuota: 100, boqQuota: 10 }, // legacy £299/mo
  'price_1T52g5EOVz3JQx7AP7CnGabY': { plan: 'premium', msgQuota: 200, boqQuota: 20 },
};

module.exports = async function stripeWebhook(req, res) {
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  if (!STRIPE_SECRET) {
    console.error('[Stripe] No STRIPE_SECRET_KEY set');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  let event;

  // Verify webhook signature if secret is set
  if (WEBHOOK_SECRET) {
    const stripe = require('stripe')(STRIPE_SECRET);
    const sig = req.headers['stripe-signature'];

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err) {
      console.error('[Stripe] Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }
  } else {
    // No webhook secret — parse body directly (less secure, ok for initial setup)
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      console.error('[Stripe] Failed to parse webhook body:', err.message);
      return res.status(400).json({ error: 'Invalid payload' });
    }
  }

  console.log(`[Stripe] Event received: ${event.type}`);

  try {
    switch (event.type) {
      // New subscription created or updated
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutComplete(session, STRIPE_SECRET);
        break;
      }

      // Subscription renewed or plan changed
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription, STRIPE_SECRET);
        break;
      }

      // Subscription cancelled
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCancelled(subscription);
        break;
      }

      // Subscription invoice paid — resets billing cycle
      case 'invoice.paid': {
        const invoice = event.data.object;
        await handleInvoicePaid(invoice, STRIPE_SECRET);
        break;
      }

      // One-time payment completed (PAYG)
      case 'payment_intent.succeeded': {
        console.log('[Stripe] Payment intent succeeded:', event.data.object.id);
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe] Error handling ${event.type}:`, err);
  }

  // Always return 200 to acknowledge receipt
  res.json({ received: true });
};

// ─── Helper: find user by subscription ID, then by customer email ───────────
// This is the key fix — if stripe_subscription_id wasn't set during checkout,
// we fall back to finding the user by customer email from Stripe.
async function findUserForSubscription(subscription, stripeSecret) {
  // 1. Try by subscription ID (fast path)
  let user = db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').get(subscription.id);
  if (user) return user;

  // 2. Try by customer email from Stripe
  if (subscription.customer) {
    try {
      const stripe = require('stripe')(stripeSecret);
      const customer = await stripe.customers.retrieve(subscription.customer);
      if (customer && customer.email) {
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(customer.email.toLowerCase());
        if (user) {
          // Link the subscription ID for future lookups
          console.log(`[Stripe] Linking subscription ${subscription.id} to ${user.email} (was missing)`);
          db.prepare('UPDATE users SET stripe_subscription_id = ? WHERE id = ?').run(subscription.id, user.id);
          return user;
        }
      }
    } catch (err) {
      console.error('[Stripe] Customer lookup failed:', err.message);
    }
  }

  return null;
}

async function handleCheckoutComplete(session, stripeSecret) {
  const customerEmail = session.customer_email || session.customer_details?.email;

  if (!customerEmail) {
    console.log('[Stripe] No customer email in checkout session');
    return;
  }

  console.log(`[Stripe] Checkout complete for: ${customerEmail}`);

  // If this is a subscription checkout, get the subscription details
  if (session.mode === 'subscription' && session.subscription) {
    const stripe = require('stripe')(stripeSecret);
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const priceId = subscription.items.data[0]?.price?.id;

    if (priceId && PRICE_TO_PLAN[priceId]) {
      const planInfo = PRICE_TO_PLAN[priceId];
      // Set billing_cycle_start to subscription's current period start
      const cycleStart = new Date(subscription.current_period_start * 1000).toISOString();
      updateUserPlan(customerEmail, planInfo.plan, planInfo.msgQuota, planInfo.boqQuota, subscription.id, cycleStart);
    } else {
      console.error(`[Stripe] Unknown price ID: ${priceId} — customer: ${customerEmail}, amount: ${session.amount_total}. Add this price to PRICE_TO_PLAN in stripe-webhook.js`);
    }
  }

  // Handle one-time payment (PAYG BOQ credit-pack purchase)
  if (session.mode === 'payment' && session.payment_status === 'paid') {
    grantPackCredits(session, customerEmail);
  }
}

// Map a one-off Stripe payment to a number of BOQ credits. Tries the exact
// amount paid, then the pre-tax subtotal (so a pack still maps if VAT was added
// on top at checkout). Overridable via STRIPE_BOQ_PACKS env var as JSON,
// e.g. '{"9900":1,"30000":5}'.
function resolvePackCredits(session) {
  let PACKS = { 9900: 1, 7900: 1, 30000: 5 };
  if (process.env.STRIPE_BOQ_PACKS) {
    try {
      const parsed = JSON.parse(process.env.STRIPE_BOQ_PACKS);
      PACKS = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [parseInt(k, 10), parseInt(v, 10)]));
    } catch (e) {
      console.error('[Stripe] Bad STRIPE_BOQ_PACKS JSON, using defaults:', e.message);
    }
  }
  const credits = PACKS[session.amount_total] || (session.amount_subtotal ? PACKS[session.amount_subtotal] : 0) || 0;
  return { credits, PACKS };
}

// Grant BOQ credits for a paid one-off checkout. Resolves the portal user by
// the logged-in account id (client_reference_id, the reliable signal) first,
// then falls back to the email typed at Stripe. A payment that can't be matched
// — or whose amount maps to no known pack — is recorded in pending_credits and
// logged loudly so it is never silently lost.
function grantPackCredits(session, customerEmail) {
  const { v4: uuidv4 } = require('uuid');
  const email = (customerEmail || '').toLowerCase();

  // Idempotency: Stripe can deliver the same webhook more than once. Skip if
  // we've already granted (usage_log row) or already recorded (pending_credits)
  // for this checkout session.
  const alreadyGranted = db.prepare("SELECT 1 FROM usage_log WHERE action = 'doc_paid' AND detail = ?").get('Stripe checkout ' + session.id);
  const alreadyPending = db.prepare('SELECT 1 FROM pending_credits WHERE stripe_session_id = ?').get(session.id);
  if (alreadyGranted || alreadyPending) {
    console.log(`[Stripe] Checkout ${session.id} already processed — skipping duplicate webhook`);
    return;
  }

  const { credits, PACKS } = resolvePackCredits(session);

  if (!credits) {
    console.error(`[Stripe] PAID checkout ${session.id} from ${email || 'unknown email'} — amount ${session.amount_total} (subtotal ${session.amount_subtotal}) matched no BOQ pack (known: ${Object.keys(PACKS).join(', ')}). Recording as unclaimed for review.`);
    recordPendingCredit(session, email, 0, 'amount_unmatched');
    return;
  }

  // Resolve the portal user: account id first, then email.
  let user = null;
  if (session.client_reference_id) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.client_reference_id);
  }
  if (!user && email) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }

  if (!user) {
    console.error(`[Stripe] PAID checkout ${session.id} worth ${credits} BOQ credit(s) (£${(session.amount_total / 100).toFixed(2)}) from ${email || 'unknown email'} could NOT be matched to a portal user (client_reference_id=${session.client_reference_id || 'none'}). Recording as PENDING — will auto-claim when that email logs in.`);
    recordPendingCredit(session, email, credits, 'user_not_found');
    return;
  }

  db.prepare('INSERT INTO usage_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(
    'ul_' + uuidv4().slice(0, 8), user.id, 'doc_paid', 'Stripe checkout ' + session.id
  );
  db.prepare('UPDATE users SET free_credits = COALESCE(free_credits, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(credits, user.id);
  console.log(`[Stripe] Granted ${credits} BOQ credit(s) to ${user.email} (£${(session.amount_total / 100).toFixed(2)}, session ${session.id})`);
}

async function handleSubscriptionUpdate(subscription, stripeSecret) {
  const priceId = subscription.items.data[0]?.price?.id;

  if (!priceId || !PRICE_TO_PLAN[priceId]) {
    console.error(`[Stripe] Unknown price ID on update: ${priceId} — subscription: ${subscription.id}. Add this price to PRICE_TO_PLAN in stripe-webhook.js`);
    return;
  }

  // Find user — tries subscription ID first, then customer email
  const user = await findUserForSubscription(subscription, stripeSecret);

  if (!user) {
    console.log(`[Stripe] No user found for subscription: ${subscription.id} — tried sub ID and customer email`);
    return;
  }

  const planInfo = PRICE_TO_PLAN[priceId];

  if (subscription.status === 'active') {
    const cycleStart = new Date(subscription.current_period_start * 1000).toISOString();
    console.log(`[Stripe] Subscription active for ${user.email} — plan: ${planInfo.plan}, cycle start: ${cycleStart}`);
    db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, monthly_boq_quota = ?, billing_cycle_start = ?, stripe_subscription_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(planInfo.plan, planInfo.msgQuota, planInfo.boqQuota, cycleStart, subscription.id, user.id);
  } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    console.log(`[Stripe] Subscription ${subscription.status} for ${user.email}`);
    // Optionally downgrade or flag — for now just log
  }
}

async function handleInvoicePaid(invoice, stripeSecret) {
  // Only handle subscription invoices (not one-off payments)
  if (!invoice.subscription) return;

  // Find user by subscription ID first
  let user = db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').get(invoice.subscription);

  if (!user) {
    // Try finding by email as fallback
    const email = invoice.customer_email;
    if (email) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
      if (user) {
        console.log(`[Stripe] invoice.paid — matched ${email} by email, linking subscription ID`);
        db.prepare('UPDATE users SET stripe_subscription_id = ? WHERE id = ?').run(invoice.subscription, user.id);
      }
    }
  }

  if (!user) {
    // Last resort: look up the customer from Stripe to get their email
    try {
      const stripe = require('stripe')(stripeSecret);
      if (invoice.customer) {
        const customer = await stripe.customers.retrieve(invoice.customer);
        if (customer && customer.email) {
          user = db.prepare('SELECT * FROM users WHERE email = ?').get(customer.email.toLowerCase());
          if (user) {
            console.log(`[Stripe] invoice.paid — matched ${customer.email} via Stripe customer lookup, linking subscription`);
            db.prepare('UPDATE users SET stripe_subscription_id = ? WHERE id = ?').run(invoice.subscription, user.id);
          }
        }
      }
    } catch (err) {
      console.error('[Stripe] Customer lookup for invoice.paid failed:', err.message);
    }
  }

  if (!user) {
    console.log(`[Stripe] invoice.paid — no user found for subscription: ${invoice.subscription}`);
    return;
  }

  // Get the subscription to read current_period_start
  const stripe = require('stripe')(stripeSecret);
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const cycleStart = new Date(subscription.current_period_start * 1000).toISOString();
  const priceId = subscription.items.data[0]?.price?.id;
  const planInfo = priceId ? PRICE_TO_PLAN[priceId] : null;

  console.log(`[Stripe] Invoice paid for ${user.email} — billing cycle reset to ${cycleStart}`);

  // Update billing cycle AND ensure plan/quotas are correct
  if (planInfo) {
    db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, monthly_boq_quota = ?, billing_cycle_start = ?, stripe_subscription_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(planInfo.plan, planInfo.msgQuota, planInfo.boqQuota, cycleStart, invoice.subscription, user.id);
  } else {
    db.prepare('UPDATE users SET billing_cycle_start = ?, stripe_subscription_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(cycleStart, invoice.subscription, user.id);
  }
}

async function handleSubscriptionCancelled(subscription) {
  const user = db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').get(subscription.id);

  if (!user) {
    console.log(`[Stripe] No user found for cancelled subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Stripe] Subscription cancelled for ${user.email} — reverting to starter`);

  db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, monthly_boq_quota = ?, stripe_subscription_id = NULL, billing_cycle_start = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('starter', 0, 0, user.id);
}

function updateUserPlan(email, plan, msgQuota, boqQuota, subscriptionId, cycleStart) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  if (!user) {
    console.log(`[Stripe] No portal user found for email: ${email}`);
    return;
  }

  console.log(`[Stripe] Updating ${email} to ${plan} (messages: ${msgQuota}, BOQs: ${boqQuota}, cycle: ${cycleStart})`);

  db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, monthly_boq_quota = ?, stripe_subscription_id = ?, billing_cycle_start = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(plan, msgQuota, boqQuota, subscriptionId, cycleStart, user.id);
}

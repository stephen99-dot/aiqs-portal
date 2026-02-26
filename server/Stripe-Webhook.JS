const db = require('./database');

// Price ID to plan mapping
const PRICE_TO_PLAN = {
  'price_1T52aREOVz3JQx7Ah7HHz1oh': { plan: 'professional', quota: 10 },
  'price_1T52g5EOVz3JQx7AP7CnGabY': { plan: 'premium', quota: 20 },
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
        await handleSubscriptionUpdate(subscription);
        break;
      }

      // Subscription cancelled
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCancelled(subscription);
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
      updateUserPlan(customerEmail, planInfo.plan, planInfo.quota, subscription.id);
    } else {
      console.log(`[Stripe] Unknown price ID: ${priceId}`);
    }
  }
}

async function handleSubscriptionUpdate(subscription) {
  const priceId = subscription.items.data[0]?.price?.id;

  if (!priceId || !PRICE_TO_PLAN[priceId]) {
    console.log(`[Stripe] Unknown price ID on update: ${priceId}`);
    return;
  }

  // Find user by stripe subscription ID
  const user = db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').get(subscription.id);

  if (!user) {
    console.log(`[Stripe] No user found for subscription: ${subscription.id}`);
    return;
  }

  const planInfo = PRICE_TO_PLAN[priceId];

  if (subscription.status === 'active') {
    console.log(`[Stripe] Subscription active for ${user.email} — setting plan to ${planInfo.plan}`);
    db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(planInfo.plan, planInfo.quota, user.id);
  } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    console.log(`[Stripe] Subscription ${subscription.status} for ${user.email}`);
    // Optionally downgrade or flag — for now just log
  }
}

async function handleSubscriptionCancelled(subscription) {
  const user = db.prepare('SELECT * FROM users WHERE stripe_subscription_id = ?').get(subscription.id);

  if (!user) {
    console.log(`[Stripe] No user found for cancelled subscription: ${subscription.id}`);
    return;
  }

  console.log(`[Stripe] Subscription cancelled for ${user.email} — reverting to starter`);

  db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, stripe_subscription_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('starter', 0, user.id);
}

function updateUserPlan(email, plan, quota, subscriptionId) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

  if (!user) {
    console.log(`[Stripe] No portal user found for email: ${email}`);
    return;
  }

  console.log(`[Stripe] Updating ${email} to ${plan} (quota: ${quota})`);

  db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, stripe_subscription_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(plan, quota, subscriptionId, user.id);
}

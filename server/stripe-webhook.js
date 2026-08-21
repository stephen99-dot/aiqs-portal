const db = require('./database');
const { recordPendingCredit } = require('./pendingCredits');

// Price ID to plan mapping
const PRICE_TO_PLAN = {
  'price_1T52aREOVz3JQx7Ah7HHz1oh': { plan: 'professional', msgQuota: 100, boqQuota: 10 },
  'price_1T6phnEOVz3JQx7A08xGJ8er': { plan: 'professional', msgQuota: 100, boqQuota: 10 }, // legacy £299/mo
  'price_1T52g5EOVz3JQx7AP7CnGabY': { plan: 'premium', msgQuota: 200, boqQuota: 20 },
};

// ─── Office in a Box add-on ─────────────────────────────────────────────────
// Paying the Office in a Box subscription flips the user's has_estimator flag
// on (and cancelling flips it off). Match is by Stripe Price ID when configured
// via STRIPE_OFFICE_PRICE_ID / STRIPE_OFFICE_PRICE_IDS (comma-separated);
// otherwise we fall back to matching the amount: £100/mo (legacy link),
// £199/mo (Unlimited) or £249/mo (Bundle). Set the env var to lock it to
// exact prices later.
function officePriceIds() {
  const raw = process.env.STRIPE_OFFICE_PRICE_IDS || process.env.STRIPE_OFFICE_PRICE_ID || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function isOfficeSubscription(subscription) {
  const item = subscription && subscription.items && subscription.items.data && subscription.items.data[0];
  const priceId = item && item.price && item.price.id;
  const amount = item && item.price && item.price.unit_amount;
  const ids = officePriceIds();
  if (ids.length) return ids.includes(priceId);
  // £100 legacy OiB, £199 Unlimited, £249 Bundle (2026-08 repricing).
  return amount === 10000 || amount === 19900 || amount === 24900;
}
function activateOffice(user, subscriptionId) {
  if (!user) return;
  db.prepare('UPDATE users SET has_estimator = 1, office_subscription_id = COALESCE(?, office_subscription_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(subscriptionId || null, user.id);
  console.log(`[Stripe] Office in a Box ACTIVATED for ${user.email} (sub ${subscriptionId || 'n/a'})`);
}
function deactivateOffice(user) {
  if (!user) return;
  db.prepare('UPDATE users SET has_estimator = 0, office_subscription_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(user.id);
  console.log(`[Stripe] Office in a Box DEACTIVATED for ${user.email}`);
}
// ─── Purchase confirmation email ────────────────────────────────────────────
// Portal-branded ("AI QS" sender) thank-you sent to the buyer whenever a
// checkout completes — plan upgrade, Office in a Box, or a BOQ credit pack.
// Fire-and-forget: a mail failure must never affect webhook handling.
function sendPurchaseEmail({ email, name, packageName, detailLines, amountTotal, currency }) {
  try {
    const { sendEmail } = require('./routes'); // lazy — avoids any load-order tangle
    if (!email || typeof sendEmail !== 'function') return;
    const firstName = (name || 'there').split(' ')[0];
    const portalUrl = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
    const sym = (currency || 'gbp').toLowerCase() === 'eur' ? '€' : '£';
    const amountText = typeof amountTotal === 'number'
      ? sym + (amountTotal / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })
      : null;
    const details = [...(detailLines || [])];
    if (amountText) details.push(`Amount paid: ${amountText}`);
    const detailHtml = details
      .map(d => `<p style="margin:0 0 6px;font-size:14px;color:#1E293B;">${d}</p>`)
      .join('');
    sendEmail({
      to: email,
      subject: `Purchase confirmed — ${packageName}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:28px;font-weight:800;color:#0F172A;">AI <span style="color:#F59E0B;">QS</span></div>
            <div style="font-size:10px;letter-spacing:3px;color:#94A3B8;text-transform:uppercase;margin-top:2px;">Quantity Surveying</div>
          </div>
          <h2 style="font-size:20px;color:#0F172A;margin:0 0 12px;">Thanks for your purchase, ${firstName}!</h2>
          <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 20px;">You've purchased <strong>${packageName}</strong>. It's live on your account now — no action needed.</p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px;margin:0 0 24px;">
            ${detailHtml}
          </div>
          <div style="text-align:center;margin:28px 0;">
            <a href="${portalUrl}/dashboard" style="display:inline-block;padding:14px 36px;background:#F59E0B;color:#0F172A;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Go to Your Dashboard</a>
          </div>
          <p style="font-size:13px;color:#94A3B8;line-height:1.5;">Questions about your purchase? Just reply to this email and we'll help.</p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
          <p style="font-size:11px;color:#CBD5E1;text-align:center;">AI QS — Automated Quantity Surveying<br/><a href="https://theaiqs.co.uk" style="color:#94A3B8;">theaiqs.co.uk</a></p>
        </div>
      `,
    }).catch(err => console.error('[Stripe] Purchase email failed:', err.message));
  } catch (err) {
    console.error('[Stripe] Purchase email failed:', err.message);
  }
}

// Resolve the portal account for a checkout: account id (client_reference_id,
// stamped by withUserRef) first — exact and reliable — then the email typed.
function resolveCheckoutUser(session, email) {
  if (session.client_reference_id) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(session.client_reference_id);
    if (u) return u;
  }
  if (email) return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  return null;
}
// Find the account behind an Office subscription event: by the stored
// office_subscription_id first, then by the Stripe customer's email.
async function findUserForOfficeSub(subscription, stripeSecret) {
  let user = db.prepare('SELECT * FROM users WHERE office_subscription_id = ?').get(subscription.id);
  if (user) return user;
  if (subscription.customer) {
    try {
      const stripe = require('stripe')(stripeSecret);
      const customer = await stripe.customers.retrieve(subscription.customer);
      if (customer && customer.email) {
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(customer.email.toLowerCase());
        if (user) return user;
      }
    } catch (err) {
      console.error('[Stripe] Office customer lookup failed:', err.message);
    }
  }
  return null;
}

module.exports = async function stripeWebhook(req, res) {
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  // Separate endpoint secret for "events on connected accounts" (Stripe
  // Connect). Builders' invoice payments arrive signed with this one.
  const CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!STRIPE_SECRET) {
    console.error('[Stripe] No STRIPE_SECRET_KEY set');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  let event;

  // Verify webhook signature if secret is set
  if (WEBHOOK_SECRET || CONNECT_WEBHOOK_SECRET) {
    const stripe = require('stripe')(STRIPE_SECRET);
    const sig = req.headers['stripe-signature'];

    for (const secret of [WEBHOOK_SECRET, CONNECT_WEBHOOK_SECRET].filter(Boolean)) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
        break;
      } catch (err) { /* try the next secret */ }
    }
    if (!event) {
      console.error('[Stripe] Webhook signature verification failed for all configured secrets');
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
  // A3: invoice "Pay now" — the checkout session carries invoice_id metadata.
  // Handle and stop: this payment is the builder's money, not a platform plan.
  if (session.metadata && session.metadata.invoice_id) {
    handleInvoicePaymentComplete(session);
    return;
  }

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

    // Office in a Box add-on — flip has_estimator on and stop.
    if (isOfficeSubscription(subscription)) {
      const user = resolveCheckoutUser(session, customerEmail);
      if (user) {
        activateOffice(user, subscription.id);
        sendPurchaseEmail({
          email: user.email,
          name: user.full_name,
          packageName: 'Office in a Box',
          detailLines: ['Estimator, quotes, invoices and payment tools are now unlocked on your account.'],
          amountTotal: session.amount_total,
          currency: session.currency,
        });
      }
      else console.error(`[Stripe] Office subscription paid (${subscription.id}) but no portal user matched (client_reference_id=${session.client_reference_id || 'none'}, email=${customerEmail || 'none'})`);
      return;
    }

    if (priceId && PRICE_TO_PLAN[priceId]) {
      const planInfo = PRICE_TO_PLAN[priceId];
      // Set billing_cycle_start to subscription's current period start
      const cycleStart = new Date(subscription.current_period_start * 1000).toISOString();
      const user = updateUserPlan(customerEmail, planInfo.plan, planInfo.msgQuota, planInfo.boqQuota, subscription.id, cycleStart);
      const planName = planInfo.plan.charAt(0).toUpperCase() + planInfo.plan.slice(1) + ' plan';
      sendPurchaseEmail({
        email: (user && user.email) || customerEmail,
        name: user && user.full_name,
        packageName: planName,
        detailLines: [
          `${planInfo.msgQuota} AI messages per month`,
          `${planInfo.boqQuota} BOQs per month`,
        ],
        amountTotal: session.amount_total,
        currency: session.currency,
      });
    } else {
      console.error(`[Stripe] Unknown price ID: ${priceId} — customer: ${customerEmail}, amount: ${session.amount_total}. Add this price to PRICE_TO_PLAN in stripe-webhook.js`);
    }
  }

  // Handle one-time payment (PAYG BOQ credit-pack purchase)
  if (session.mode === 'payment' && session.payment_status === 'paid') {
    grantPackCredits(session, customerEmail);
  }
}

// A3: a client paid a builder's invoice through the "Pay now" link. Mark it
// paid, settle any linked payment-schedule stage, and tell the builder
// (notification bell + email).
function handleInvoicePaymentComplete(session) {
  try {
    if (session.payment_status && session.payment_status !== 'paid') {
      console.log('[Stripe] Invoice checkout not paid yet:', session.id);
      return;
    }
    const invoiceId = session.metadata.invoice_id;
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (!inv) {
      console.error('[Stripe] Paid invoice not found:', invoiceId);
      return;
    }
    if (inv.status === 'paid') return; // idempotent — webhooks can repeat

    const paidAmount = session.amount_total ? session.amount_total / 100 : inv.grand_total;
    const { v4: uuidv4 } = require('uuid');
    db.prepare(
      "UPDATE invoices SET status='paid', paid_amount=?, paid_at=CURRENT_TIMESTAMP, "
      + 'stripe_payment_intent_id=COALESCE(?, stripe_payment_intent_id), updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(paidAmount, session.payment_intent || null, inv.id);
    db.prepare(
      "UPDATE payment_schedules SET status='paid', paid_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE invoice_id=? AND status='unpaid'"
    ).run(inv.id);

    const sym = inv.currency === 'EUR' ? '€' : '£';
    const amountText = sym + Number(paidAmount).toLocaleString('en-GB', { minimumFractionDigits: 2 });
    const summary = (inv.client_name || 'Your client') + ' paid invoice ' + (inv.invoice_number || '') + ' — ' + amountText + ' received by card.';
    db.prepare('INSERT INTO user_messages (id, user_id, message) VALUES (?, ?, ?)').run(uuidv4(), inv.user_id, summary);

    const mailer = require('./mailer');
    const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(inv.user_id);
    mailer.sendMail({
      userId: inv.user_id,
      platform: true,
      type: 'invoice_paid',
      to: owner?.email,
      subject: 'Paid: invoice ' + (inv.invoice_number || '') + ' — ' + amountText,
      heading: 'You\'ve been paid',
      paragraphs: [summary, 'The invoice has been marked as paid automatically.'],
      ctaText: 'Open the invoice',
      ctaUrl: mailer.BASE_URL + '/invoices/' + inv.id,
    }).catch(() => {});

    console.log('[Stripe] Invoice ' + (inv.invoice_number || inv.id) + ' marked paid (' + amountText + ')');
  } catch (err) {
    console.error('[Stripe] Invoice payment handling failed:', err.message);
  }
}

// Map a one-off Stripe payment to a number of BOQ credits. Tries the exact
// amount paid, then the pre-tax subtotal (so a pack still maps if VAT was added
// on top at checkout). Overridable via STRIPE_BOQ_PACKS env var as JSON,
// e.g. '{"15000":1,"34900":5,"58000":10}'.
function resolvePackCredits(session) {
  // Pence -> BOQ credits. Keep in step with the live pack prices:
  //   £150 single = 1, £349 five-pack = 5, £580 ten-pack = 10, £980 twenty-pack = 20.
  // The £79/£99/£300 entries are legacy/subscriber prices kept for back-compat.
  let PACKS = { 7900: 1, 9900: 1, 15000: 1, 30000: 5, 34900: 5, 58000: 10, 98000: 20 };
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
    try {
      require('./creditNotifications').notifyPackPurchased({
        email, credits: 0, amountPence: session.amount_total, sessionId: session.id, status: 'amount_unmatched',
      });
    } catch (e) { /* never blocks the webhook */ }
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
    try {
      require('./creditNotifications').notifyPackPurchased({
        email, credits, amountPence: session.amount_total, sessionId: session.id, status: 'user_not_found',
      });
    } catch (e) { /* never blocks the webhook */ }
    return;
  }

  db.prepare('INSERT INTO usage_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(
    'ul_' + uuidv4().slice(0, 8), user.id, 'doc_paid', 'Stripe checkout ' + session.id
  );
  db.prepare('UPDATE users SET free_credits = COALESCE(free_credits, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(credits, user.id);
  console.log(`[Stripe] Granted ${credits} BOQ credit(s) to ${user.email} (£${(session.amount_total / 100).toFixed(2)}, session ${session.id})`);

  // Both sides of the sale get told. The BUYER gets the branded purchase
  // confirmation; the ADMIN inbox gets the sale notification with the
  // resulting balance. Fire-and-forget — never blocks the webhook.
  const packName = credits === 1 ? 'BOQ Credit Pack (1 credit)' : `BOQ Credit Pack (${credits} credits)`;
  sendPurchaseEmail({
    email: user.email,
    name: user.full_name,
    packageName: packName,
    detailLines: [`${credits} BOQ credit${credits === 1 ? '' : 's'} added to your account — ready to use straight away.`],
    amountTotal: session.amount_total,
    currency: session.currency,
  });
  try {
    const balance = require('./boqCredits').getBoqBalance(user.id);
    require('./creditNotifications').notifyPackPurchased({
      email: user.email, credits, amountPence: session.amount_total,
      sessionId: session.id, balanceAfter: balance.total,
    });
  } catch (e) { console.error('[Stripe] purchase notification error:', e.message); }
}

async function handleSubscriptionUpdate(subscription, stripeSecret) {
  const priceId = subscription.items.data[0]?.price?.id;

  // Office in a Box add-on — keep has_estimator in step with the subscription.
  if (isOfficeSubscription(subscription)) {
    const user = await findUserForOfficeSub(subscription, stripeSecret);
    if (!user) { console.log(`[Stripe] Office sub ${subscription.id} updated but no user matched`); return; }
    if (subscription.status === 'active' || subscription.status === 'trialing') activateOffice(user, subscription.id);
    else if (['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)) deactivateOffice(user);
    else console.log(`[Stripe] Office sub for ${user.email} is ${subscription.status} — leaving access unchanged`);
    return;
  }

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
  // Office in a Box add-on cancellation — revoke access and stop.
  const officeUser = db.prepare('SELECT * FROM users WHERE office_subscription_id = ?').get(subscription.id);
  if (officeUser) { deactivateOffice(officeUser); return; }

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
    return null;
  }

  console.log(`[Stripe] Updating ${email} to ${plan} (messages: ${msgQuota}, BOQs: ${boqQuota}, cycle: ${cycleStart})`);

  db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, monthly_boq_quota = ?, stripe_subscription_id = ?, billing_cycle_start = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(plan, msgQuota, boqQuota, subscriptionId, cycleStart, user.id);
  return user;
}

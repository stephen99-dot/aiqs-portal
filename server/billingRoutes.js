// ═══════════════════════════════════════════════════════════════════════════════
// MAX packages — server/billingRoutes.js   (mounted at /api/billing)
//
//   GET  /api/billing/max           the two plans, their prices and payment
//                                   links, the free-trial length, and what
//                                   this account has now
//   POST /api/billing/max/verify    just paid: find the subscription at Stripe
//                                   by the account's email and switch it on
//                                   (the webhook usually beats this; it is the
//                                   belt to that brace, as /office/verify is)
//   POST /api/billing/max/change    { plan, interval } switch an existing
//                                   subscription — MAX ⇄ MAX + Visualiser,
//                                   monthly ⇄ yearly — prorated by Stripe
//   POST /api/billing/max/cancel    stop at the end of the paid period
//   POST /api/billing/max/resume    undo that before the period ends
//   POST /api/billing/max/portal    a Stripe customer-portal link (card,
//                                   invoices) — needs the portal switched on
//                                   in the Stripe dashboard
//
// Buying is a Stripe Payment Link (one per plan and interval, from the
// environment — maxPlans.paymentLinks) stamped with the account by the client
// (utils/stripeLinks withUserRef), so checkout.session.completed carries the
// account id. Everything here runs as the signed-in account and only ever
// touches that account's own subscription.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');
const plans = require('./maxPlans');

const router = express.Router();
router.use(authMiddleware);

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}
function freshUser(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function logEvent(user, eventType, text) {
  try {
    require('./activityRoutes').logActivity({ event_type: eventType, title: (user.full_name || user.email) + ' — ' + text, user_id: user.id, user_name: user.full_name, user_email: user.email });
  } catch (e) { /* audit only */ }
}

function current(user) {
  const e = plans.entitlements(user);
  let renders = null;
  try { renders = require('./maxRoutes')._internals.renderAllowance(user); } catch (err) { renders = null; }
  return { ...e, renders };
}

router.get('/max', (req, res) => {
  const user = freshUser(req.user.id) || req.user;
  res.json({
    plans: plans.catalogue(),
    links: plans.paymentLinks(),
    yearly_note: 'Two months free — twelve months for the price of ten.',
    trial_days: plans.trialDays(),
    current: current(user),
    stripe: { configured: !!process.env.STRIPE_SECRET_KEY, links: plans.linksConfigured() },
  });
});

// A live MAX subscription at Stripe under this account's email, switched on.
// A buyer may have more than one customer record there. Used just after a
// checkout (the webhook usually beats it), when an account is created by
// someone who paid first, and when the Plans page opens with no plan on the
// account. Returns the plan activated, or null.
async function attachByEmail(user) {
  if (!user || plans.isSubscribed(user)) return null;
  const stripe = stripeClient();
  if (!stripe) return null;
  const customers = await stripe.customers.list({ email: user.email, limit: 5 });
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 20 });
    for (const sub of subs.data) {
      if (!plans.LIVE_STATUSES.includes(sub.status)) continue;
      const match = plans.fromStripe(sub);
      if (!match) continue;
      plans.activate(user, match);
      logEvent(user, 'max_plan_started', plans.PLANS[match.plan].name + ' started (found at Stripe under ' + user.email + ')');
      return match;
    }
  }
  return null;
}

// Just back from Stripe: look the subscription up and switch the plan on.
router.post('/max/verify', async (req, res) => {
  try {
    const user = freshUser(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (plans.isSubscribed(user)) return res.json({ activated: true, current: current(user) });
    if (!stripeClient()) return res.status(500).json({ error: 'Stripe not configured' });
    const match = await attachByEmail(user);
    res.json({ activated: !!match, current: current(freshUser(user.id)) });
  } catch (err) {
    console.error('[billing] MAX verify failed:', err);
    res.status(500).json({ error: 'Could not check the subscription with Stripe.' });
  }
});

// The user's live Stripe subscription, or a reply explaining why not.
async function liveSubscription(req, res) {
  const user = freshUser(req.user.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return null; }
  if (!plans.isSubscribed(user) || !user.max_subscription_id) {
    res.status(400).json({ error: 'There is no MAX package on this account to change.', code: 'NO_SUBSCRIPTION' });
    return null;
  }
  const stripe = stripeClient();
  if (!stripe) { res.status(500).json({ error: 'Stripe not configured' }); return null; }
  const sub = await stripe.subscriptions.retrieve(user.max_subscription_id);
  if (!sub || !plans.LIVE_STATUSES.includes(sub.status)) {
    plans.syncFromStripe(user, sub || { id: user.max_subscription_id, status: 'canceled', items: { data: [] } });
    res.status(400).json({ error: 'That subscription is no longer live.', code: 'NO_SUBSCRIPTION' });
    return null;
  }
  return { user, stripe, sub };
}

// The Stripe price for a plan and interval: the configured ids, or the
// active GBP price with the plan's amount.
async function priceFor(stripe, plan, interval) {
  const prices = await stripe.prices.list({ active: true, type: 'recurring', limit: 100 });
  for (const p of prices.data) {
    const m = plans.planForPrice(p);
    if (m && m.plan === plan && m.interval === interval) return p;
  }
  return null;
}

router.post('/max/change', async (req, res) => {
  try {
    const plan = String((req.body && req.body.plan) || '').trim();
    const interval = String((req.body && req.body.interval) || '').trim();
    if (!plans.PLANS[plan]) return res.status(400).json({ error: 'Choose MAX or MAX + Visualiser.' });
    if (!plans.INTERVALS.includes(interval)) return res.status(400).json({ error: 'Choose monthly or yearly.' });
    const live = await liveSubscription(req, res);
    if (!live) return;
    const { user, stripe, sub } = live;
    const now = plans.fromStripe(sub);
    if (now && now.plan === plan && now.interval === interval) return res.json({ changed: false, current: current(user) });
    const price = await priceFor(stripe, plan, interval);
    if (!price) return res.status(503).json({ error: 'That price is not set up at Stripe yet. Contact us and we will switch you over.', code: 'PRICE_NOT_FOUND' });
    const item = sub.items.data[0];
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: price.id }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });
    plans.syncFromStripe(user, updated);
    logEvent(user, 'max_plan_changed', (now ? plans.PLANS[now.plan].short + ' ' + now.interval + 'ly → ' : '') + plans.PLANS[plan].short + ' ' + interval + 'ly');
    res.json({ changed: true, current: current(freshUser(user.id)) });
  } catch (err) {
    console.error('[billing] MAX change failed:', err);
    res.status(500).json({ error: 'Could not change the plan. Nothing has been altered — contact us and we will sort it.' });
  }
});

router.post('/max/cancel', async (req, res) => {
  try {
    const live = await liveSubscription(req, res);
    if (!live) return;
    const { user, stripe, sub } = live;
    const updated = sub.cancel_at_period_end ? sub : await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    plans.syncFromStripe(user, updated);
    const ends = plans.fromStripe(updated);
    logEvent(user, 'max_plan_cancelled', 'MAX package cancelled — access ends ' + ((ends && ends.cancels_at) || '').slice(0, 10));
    res.json({ cancelled: true, current: current(freshUser(user.id)) });
  } catch (err) {
    console.error('[billing] MAX cancel failed:', err);
    res.status(500).json({ error: 'Could not cancel just now. Contact us and we will do it for you.' });
  }
});

router.post('/max/resume', async (req, res) => {
  try {
    const live = await liveSubscription(req, res);
    if (!live) return;
    const { user, stripe, sub } = live;
    const updated = sub.cancel_at_period_end ? await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false }) : sub;
    plans.syncFromStripe(user, updated);
    logEvent(user, 'max_plan_resumed', 'MAX package cancellation undone');
    res.json({ resumed: true, current: current(freshUser(user.id)) });
  } catch (err) {
    console.error('[billing] MAX resume failed:', err);
    res.status(500).json({ error: 'Could not resume just now. Contact us and we will do it for you.' });
  }
});

router.post('/max/portal', async (req, res) => {
  try {
    const live = await liveSubscription(req, res);
    if (!live) return;
    const { stripe, sub } = live;
    const portalUrl = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
    const session = await stripe.billingPortal.sessions.create({ customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id, return_url: portalUrl + '/upgrade' });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing] portal session failed:', err.message);
    res.status(503).json({ error: 'The billing page is not available just now. Contact us for invoices or to change your card.' });
  }
});

module.exports = router;
module.exports._internals = { priceFor, current };
module.exports.attachByEmail = attachByEmail;

// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxPlans.js
//
// The two MAX packages, who has one, and what each lets the account do.
//
//   max              AI QS MAX                 £59 a month / £590 a year
//   max_visualiser   AI QS MAX + Visualiser    £79 a month / £790 a year
//
// Yearly is "two months free": twelve months for the price of ten. Every plan
// starts with a free trial (TRIAL_DAYS, or MAX_TRIAL_DAYS on Render): the card
// is taken at checkout and nothing is charged until the trial ends. The trial
// itself lives on the four Stripe Payment Links — scripts/create-max-plans.js
// --trial puts this length on them, so the Plans page and Stripe agree.
//
// The Stripe side is four recurring prices on two products. A subscription arrives
// through stripe-webhook.js (checkout.session.completed, then every
// customer.subscription.updated / deleted) and is written onto the user row:
//
//   max_plan             'max' | 'max_visualiser' | NULL
//   max_plan_status      Stripe's status: active, trialing, past_due, canceled…
//   max_plan_interval    'month' | 'year'
//   max_plan_renews_at   ISO date the current period ends
//   max_plan_cancels_at  set when the builder has cancelled: access ends then
//   max_subscription_id  the Stripe subscription
//
// Which Stripe price is which plan: STRIPE_MAX_PRICE_IDS and
// STRIPE_MAX_VISUALISER_PRICE_IDS (comma-separated, monthly and yearly). When
// neither is set the amount is matched instead — £59/£590 and £79/£790 in GBP
// — so creating the prices with those exact amounts is enough to go live.
//
// Entitlements (what an account can actually do) come from entitlements(user):
//
//   max         admin, or an active subscription to either plan, or early
//               access (feature_overrides {"max": true}), or the rollout set
//               to 'all' (maxRollout.js)
//   visualiser  admin, or an active MAX + Visualiser subscription, or a
//               complimentary grant (feature_overrides {"visualiser": true})
//
// The Visualiser is never switched on by the rollout alone: each render costs
// real money at the image service, so it is only ever on for a paid plan, a
// per-account grant, or an admin.
// ═══════════════════════════════════════════════════════════════════════════════

// The database is opened on first use, not on load: scripts/create-max-plans.js
// reads the catalogue from this file and must not create a scratch database.
let _db = null;
function db() { if (!_db) _db = require('./database'); return _db; }

const PLANS = {
  max: {
    key: 'max',
    name: 'AI QS MAX',
    short: 'MAX',
    tagline: 'Price small jobs in minutes, from your own rates.',
    monthly_gbp: 59,
    yearly_gbp: 590,
    visualiser: false,
    features: [
      'Ask MAX — the AI estimator that prices small jobs from your rates',
      'Editable estimates, sent to the customer as a quote',
      'Scan a room: photos, sizes, doors and windows, finishes and notes per room',
      'LiDAR scanning on iPhone Pro, with the plan drawn for you',
      'AI room survey and quantities, priced by MAX',
      'Branded survey report (PDF) and Excel schedule',
      'Talk to MAX: dictate the job or a site note',
    ],
  },
  max_visualiser: {
    key: 'max_visualiser',
    name: 'AI QS MAX + Visualiser',
    short: 'MAX + Visualiser',
    tagline: 'Everything in MAX, plus the finished room painted onto your photo.',
    monthly_gbp: 79,
    yearly_gbp: 790,
    visualiser: true,
    features: [
      'Everything in AI QS MAX',
      'Show the finished room: the work the customer wants, painted onto your photo',
      'Before and after in the app and in the survey report',
      'A monthly allowance of finished-room renders',
    ],
  },
};
const PLAN_KEYS = Object.keys(PLANS);
const INTERVALS = ['month', 'year'];

// Days free before the first payment. MAX_TRIAL_DAYS overrides it without a
// rebuild (0 means no trial); the Payment Links must match — run
// scripts/create-max-plans.js --trial after changing either.
const TRIAL_DAYS = 7;
function trialDays() {
  const raw = process.env.MAX_TRIAL_DAYS;
  if (raw !== undefined && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 730) return n;
  }
  return TRIAL_DAYS;
}

// Statuses that keep the account's access. past_due stays on while Stripe
// retries the card (it cancels the subscription itself if every retry fails).
const LIVE_STATUSES = ['active', 'trialing', 'past_due'];
const DEAD_STATUSES = ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];

function catalogue() {
  return PLAN_KEYS.map((k) => ({ ...PLANS[k], features: PLANS[k].features.slice() }));
}

function priceIds(plan) {
  const raw = plan === 'max_visualiser' ? process.env.STRIPE_MAX_VISUALISER_PRICE_IDS : process.env.STRIPE_MAX_PRICE_IDS;
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function configuredPriceIds() {
  const out = {};
  for (const k of PLAN_KEYS) for (const id of priceIds(k)) out[id] = k;
  return out;
}

// Stripe Payment Links for each plan and interval, from the environment so a
// change on Render needs no rebuild. Returned to the website only: the iOS
// app never shows them (App Store rule 3.1.1).
function paymentLinks() {
  const e = process.env;
  return {
    max: { month: e.MAX_PAYMENT_LINK_MONTHLY || null, year: e.MAX_PAYMENT_LINK_YEARLY || null },
    max_visualiser: { month: e.MAX_VISUALISER_PAYMENT_LINK_MONTHLY || null, year: e.MAX_VISUALISER_PAYMENT_LINK_YEARLY || null },
  };
}
function linksConfigured() {
  const l = paymentLinks();
  return !!(l.max.month && l.max.year && l.max_visualiser.month && l.max_visualiser.year);
}

// Which plan a Stripe price is. By id when the ids are configured, otherwise
// by amount and interval. Returns { plan, interval } or null.
function planForPrice(price) {
  if (!price) return null;
  const interval = price.recurring && price.recurring.interval;
  const byId = configuredPriceIds();
  if (Object.keys(byId).length) {
    const plan = byId[price.id];
    return plan ? { plan, interval: INTERVALS.includes(interval) ? interval : null } : null;
  }
  if (!INTERVALS.includes(interval)) return null;
  if (price.currency && String(price.currency).toLowerCase() !== 'gbp') return null;
  const amount = Number(price.unit_amount);
  for (const k of PLAN_KEYS) {
    const want = interval === 'year' ? PLANS[k].yearly_gbp : PLANS[k].monthly_gbp;
    if (amount === want * 100) return { plan: k, interval };
  }
  return null;
}
function planForSubscription(subscription) {
  const item = subscription && subscription.items && subscription.items.data && subscription.items.data[0];
  return planForPrice(item && item.price);
}

function iso(unixSeconds) {
  const n = Number(unixSeconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// Write a subscription onto the account. Called on checkout and on every
// subscription update, so it is the one place the plan columns change.
function activate(user, sub) {
  if (!user || !sub || !PLANS[sub.plan]) return null;
  const status = LIVE_STATUSES.includes(sub.status) ? sub.status : (sub.status || 'active');
  const interval = INTERVALS.includes(sub.interval) ? sub.interval : null;
  db().prepare(
    'UPDATE users SET max_plan = ?, max_plan_status = ?, max_plan_interval = ?, max_plan_renews_at = ?, max_plan_cancels_at = ?, '
    + 'max_subscription_id = COALESCE(?, max_subscription_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(sub.plan, status, interval, sub.renews_at || null, sub.cancels_at || null, sub.subscription_id || null, user.id);
  console.log(`[MAX plans] ${PLANS[sub.plan].name} ${status} for ${user.email} (${interval || '?'}ly, sub ${sub.subscription_id || 'n/a'})`);
  return { plan: sub.plan, status, interval };
}

// The subscription has ended: the plan comes off, the id stays for the record.
function deactivate(user, status) {
  if (!user) return;
  db().prepare(
    'UPDATE users SET max_plan = NULL, max_plan_status = ?, max_plan_cancels_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(DEAD_STATUSES.includes(status) ? status : 'canceled', user.id);
  console.log(`[MAX plans] plan ended for ${user.email} (${status || 'canceled'})`);
}

// From a Stripe subscription object to the row values activate() wants.
function fromStripe(subscription) {
  const match = planForSubscription(subscription);
  if (!match) return null;
  // On a free trial the current period is the trial, so renews_at is the day
  // the first payment is taken.
  const trialEnds = subscription.status === 'trialing' ? iso(subscription.trial_end) : null;
  return {
    plan: match.plan,
    interval: match.interval,
    status: subscription.status,
    subscription_id: subscription.id,
    trial_ends_at: trialEnds,
    renews_at: iso(subscription.current_period_end) || trialEnds,
    cancels_at: subscription.cancel_at_period_end ? iso(subscription.cancel_at || subscription.current_period_end) : iso(subscription.cancel_at),
  };
}

// Keep the row in step with a subscription event, whatever its status.
function syncFromStripe(user, subscription) {
  const sub = fromStripe(subscription);
  if (!sub) return null;
  if (LIVE_STATUSES.includes(subscription.status)) return activate(user, sub);
  if (DEAD_STATUSES.includes(subscription.status)) { deactivate(user, subscription.status); return { plan: null, status: subscription.status }; }
  console.log(`[MAX plans] subscription ${subscription.id} is ${subscription.status} — leaving ${user.email} unchanged`);
  return null;
}

function parseOverrides(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}

// A paid plan that is currently live on the account.
function isSubscribed(user) {
  return !!(user && user.max_plan && PLANS[user.max_plan] && LIVE_STATUSES.includes(user.max_plan_status || 'active'));
}

// What the account can do and why. `user` is a users row (role, feature_overrides,
// max_plan, max_plan_status, …) — req.user carries these columns.
function entitlements(user) {
  if (!user) return { max: false, visualiser: false, source: null, plan: null, status: null, interval: null, renews_at: null, cancels_at: null };
  const o = parseOverrides(user.feature_overrides);
  const subscribed = isSubscribed(user);
  const plan = subscribed ? user.max_plan : null;
  let rolloutAll = false;
  try { rolloutAll = require('./maxRollout').mode() === 'all'; } catch (e) { rolloutAll = false; }
  const admin = user.role === 'admin';
  const max = admin || subscribed || o.max === true || rolloutAll;
  const visualiser = admin || (subscribed && PLANS[plan].visualiser) || o.visualiser === true;
  const source = admin ? 'admin' : subscribed ? 'subscription' : o.max === true ? 'early_access' : rolloutAll ? 'rollout' : null;
  return {
    max, visualiser, source, plan,
    plan_name: plan ? PLANS[plan].name : null,
    status: user.max_plan_status || null,
    interval: subscribed ? user.max_plan_interval || null : null,
    renews_at: subscribed ? user.max_plan_renews_at || null : null,
    cancels_at: subscribed ? user.max_plan_cancels_at || null : null,
    visualiser_source: admin ? 'admin' : (subscribed && PLANS[plan].visualiser) ? 'subscription' : o.visualiser === true ? 'grant' : null,
  };
}

// Admin: a complimentary Visualiser for one account, whatever its plan.
function setVisualiserGrant(userId, enabled) {
  const row = db().prepare('SELECT id, feature_overrides FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  const o = parseOverrides(row.feature_overrides);
  if (enabled) o.visualiser = true; else delete o.visualiser;
  db().prepare('UPDATE users SET feature_overrides = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(Object.keys(o).length ? JSON.stringify(o) : null, userId);
  return { userId, enabled: !!enabled };
}
function hasVisualiserGrant(user) {
  return !!(user && parseOverrides(user.feature_overrides).visualiser === true);
}

// Admin: how many accounts are on each plan.
function subscriberCounts() {
  const out = { max: 0, max_visualiser: 0, monthly: 0, yearly: 0, trialing: 0, cancelling: 0, visualiser_grants: 0, early_access: 0 };
  try {
    const rows = db().prepare("SELECT max_plan, max_plan_status, max_plan_interval, max_plan_cancels_at FROM users WHERE max_plan IS NOT NULL AND role != 'admin'").all();
    for (const r of rows) {
      if (!LIVE_STATUSES.includes(r.max_plan_status || 'active')) continue;
      if (out[r.max_plan] !== undefined) out[r.max_plan] += 1;
      if (r.max_plan_interval === 'year') out.yearly += 1; else out.monthly += 1;
      if (r.max_plan_status === 'trialing') out.trialing += 1;
      if (r.max_plan_cancels_at) out.cancelling += 1;
    }
    out.visualiser_grants = db().prepare("SELECT COUNT(*) AS c FROM users WHERE feature_overrides LIKE '%\"visualiser\":true%' AND role != 'admin'").get().c;
    out.early_access = db().prepare("SELECT COUNT(*) AS c FROM users WHERE feature_overrides LIKE '%\"max\":true%' AND role != 'admin'").get().c;
  } catch (e) { /* counters only */ }
  return out;
}

// One-off: accounts that had early access before the packages existed were
// using the Visualiser already. They keep it as a grant (an admin can take it
// off per account from Users) rather than losing it the day the plans go live.
function backfillVisualiserGrants() {
  const KEY = 'max_visualiser_backfill';
  try {
    if (db().prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY)) return 0;
    const rows = db().prepare("SELECT id, feature_overrides FROM users WHERE feature_overrides LIKE '%\"max\":true%' AND role != 'admin'").all();
    let n = 0;
    for (const r of rows) {
      const o = parseOverrides(r.feature_overrides);
      if (o.max !== true || o.visualiser !== undefined) continue;
      o.visualiser = true;
      db().prepare('UPDATE users SET feature_overrides = ? WHERE id = ?').run(JSON.stringify(o), r.id);
      n += 1;
    }
    db().prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(KEY, String(n));
    if (n) console.log(`[MAX plans] ${n} early-access account(s) keep the Visualiser as a grant`);
    return n;
  } catch (e) { console.warn('[MAX plans] visualiser backfill skipped:', e.message); return 0; }
}

module.exports = {
  PLANS, PLAN_KEYS, INTERVALS, LIVE_STATUSES, DEAD_STATUSES, TRIAL_DAYS, trialDays,
  catalogue, paymentLinks, linksConfigured, priceIds, configuredPriceIds,
  planForPrice, planForSubscription, fromStripe, activate, deactivate, syncFromStripe,
  isSubscribed, entitlements, setVisualiserGrant, hasVisualiserGrant, subscriberCounts, backfillVisualiserGrants,
};

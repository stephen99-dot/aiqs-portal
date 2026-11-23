// The MAX packages: which Stripe price is which plan; what a plan, a grant,
// early access, the rollout and an admin each entitle an account to; the
// webhook writing a checkout, a switch, a cancellation and an ending onto the
// account; the billing routes a builder uses to switch and cancel; and the
// one-off grant for accounts that had early access before the plans existed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-plans-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
delete process.env.STRIPE_MAX_PRICE_IDS;
delete process.env.STRIPE_MAX_VISUALISER_PRICE_IDS;
delete process.env.MAX_ROLLOUT;

// ── A pretend Stripe ────────────────────────────────────────────────────────
// Subscriptions by id, customers by id; the webhook and the billing routes
// only ever retrieve, list and update.
const stripeState = { subs: {}, customers: {}, prices: [], updates: [] };
function price(id, amount, interval) { return { id, unit_amount: amount, currency: 'gbp', recurring: { interval }, active: true, type: 'recurring' }; }
stripeState.prices = [price('p_max_m', 5900, 'month'), price('p_max_y', 59000, 'year'), price('p_vis_m', 7900, 'month'), price('p_vis_y', 79000, 'year'), price('p_other', 19900, 'month')];
function sub(id, priceObj, extra) {
  return { id, object: 'subscription', status: 'active', customer: 'cus_1', current_period_start: 1760000000, current_period_end: 1762592000, cancel_at_period_end: false, items: { data: [{ id: 'si_' + id, price: priceObj }] }, ...(extra || {}) };
}
const fakeStripe = {
  subscriptions: {
    retrieve: async (id) => { if (!stripeState.subs[id]) throw new Error('No such subscription: ' + id); return stripeState.subs[id]; },
    list: async ({ customer }) => ({ data: Object.values(stripeState.subs).filter((s) => s.customer === customer) }),
    update: async (id, params) => {
      const s = stripeState.subs[id]; if (!s) throw new Error('No such subscription');
      stripeState.updates.push({ id, params });
      if (params.items) { const p = stripeState.prices.find((x) => x.id === params.items[0].price); s.items.data[0].price = p; }
      if (params.cancel_at_period_end !== undefined) s.cancel_at_period_end = params.cancel_at_period_end;
      return s;
    },
  },
  customers: {
    retrieve: async (id) => stripeState.customers[id] || { id, email: null },
    list: async ({ email }) => ({ data: Object.values(stripeState.customers).filter((c) => c.email === email) }),
  },
  prices: { list: async () => ({ data: stripeState.prices }) },
  billingPortal: { sessions: { create: async ({ customer, return_url }) => ({ url: 'https://billing.stripe.test/' + customer + '?back=' + encodeURIComponent(return_url) }) } },
};
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: () => fakeStripe };

const db = require('./database');
const express = require('express');
const { generateToken } = require('./auth');
const P = require('./maxPlans');
const rollout = require('./maxRollout');
const webhook = require('./stripe-webhook');

const app = express();
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), webhook);
app.use(express.json());
app.use('/api', require('./routes'));
app.use('/api/max', require('./maxRoutes'));
app.use('/api/billing', require('./billingRoutes'));
app.use('/api/surveys', require('./roomSurveyRoutes'));
const server = app.listen(0);
const PORT = server.address().port;

for (const [id, email, name] of [['a', 'alice@t.t', 'Alice Anderson'], ['b', 'bob@t.t', 'Bob Builder'], ['c', 'cara@t.t', 'Cara Cole']]) {
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country) VALUES (?, ?, 'x', ?, 'Co', 'client', 'GB')").run(id, email, name);
}
db.prepare("INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('adm', 'admin@t.t', 'x', 'The Admin', 'admin')").run();
stripeState.customers.cus_1 = { id: 'cus_1', email: 'alice@t.t' };
stripeState.customers.cus_2 = { id: 'cus_2', email: 'bob@t.t' };
const tokenA = generateToken({ id: 'a', email: 'alice@t.t', role: 'client' });
const tokenB = generateToken({ id: 'b', email: 'bob@t.t', role: 'client' });
const tokenC = generateToken({ id: 'c', email: 'cara@t.t', role: 'client' });
const tokenAdmin = generateToken({ id: 'adm', email: 'admin@t.t', role: 'admin' });
const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function req(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const r = http.request({ port: PORT, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': data.length } : {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let parsed = null; try { parsed = buf ? JSON.parse(buf) : null; } catch (e) { parsed = buf; } resolve({ status: res.statusCode, body: parsed }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const event = (type, object) => req('POST', '/stripe/webhook', null, { id: 'evt_' + Math.random().toString(36).slice(2), type, data: { object } });

test.after(() => { server.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tmp */ } });

// ── Which price is which plan ───────────────────────────────────────────────

test('a Stripe price is matched to a plan by amount and interval, or by the configured ids', () => {
  assert.deepEqual(P.planForPrice(price('x', 5900, 'month')), { plan: 'max', interval: 'month' });
  assert.deepEqual(P.planForPrice(price('x', 59000, 'year')), { plan: 'max', interval: 'year' });
  assert.deepEqual(P.planForPrice(price('x', 7900, 'month')), { plan: 'max_visualiser', interval: 'month' });
  assert.deepEqual(P.planForPrice(price('x', 79000, 'year')), { plan: 'max_visualiser', interval: 'year' });
  assert.equal(P.planForPrice(price('x', 7900, 'year')), null, 'the wrong amount for the interval is not a plan');
  assert.equal(P.planForPrice({ ...price('x', 5900, 'month'), currency: 'eur' }), null, 'only GBP');
  assert.equal(P.planForPrice(price('x', 19900, 'month')), null, 'Office in a Box is not a MAX plan');
  assert.equal(P.planForSubscription(sub('s', price('x', 5900, 'month'))).plan, 'max');
  // Configured ids win, and then amounts are ignored.
  process.env.STRIPE_MAX_PRICE_IDS = 'price_m1, price_m2';
  process.env.STRIPE_MAX_VISUALISER_PRICE_IDS = 'price_v1,price_v2';
  try {
    assert.deepEqual(P.planForPrice({ id: 'price_v2', unit_amount: 1, currency: 'usd', recurring: { interval: 'year' } }), { plan: 'max_visualiser', interval: 'year' });
    assert.equal(P.planForPrice(price('x', 5900, 'month')), null);
    assert.equal(Object.keys(P.configuredPriceIds()).length, 4);
  } finally { delete process.env.STRIPE_MAX_PRICE_IDS; delete process.env.STRIPE_MAX_VISUALISER_PRICE_IDS; }
  // The catalogue is what the website sells.
  const cat = P.catalogue();
  assert.deepEqual(cat.map((p) => [p.key, p.monthly_gbp, p.yearly_gbp, p.visualiser]), [['max', 59, 590, false], ['max_visualiser', 79, 790, true]]);
  assert.ok(cat.every((p) => p.yearly_gbp === p.monthly_gbp * 10), 'yearly is two months free');
});

// ── Entitlements ─────────────────────────────────────────────────────────────

test('what an account can do: nothing, early access, a plan, a grant, the rollout, an admin', () => {
  rollout.setMode('admin', 'adm');
  let e = P.entitlements(row('a'));
  assert.deepEqual([e.max, e.visualiser, e.source], [false, false, null]);
  // Early access gives MAX, not the Visualiser.
  rollout.setUserAccess('a', true, 'adm');
  e = P.entitlements(row('a'));
  assert.deepEqual([e.max, e.visualiser, e.source], [true, false, 'early_access']);
  // A grant gives the Visualiser on its own.
  P.setVisualiserGrant('a', true);
  e = P.entitlements(row('a'));
  assert.deepEqual([e.visualiser, e.visualiser_source], [true, 'grant']);
  P.setVisualiserGrant('a', false); rollout.setUserAccess('a', false, 'adm');
  assert.equal(row('a').feature_overrides, null, 'an empty override set is stored as nothing');
  // The MAX plan: MAX yes, Visualiser no. The Visualiser plan: both.
  P.activate(row('a'), { plan: 'max', interval: 'month', status: 'active', subscription_id: 'sub_x', renews_at: '2026-12-01T00:00:00.000Z' });
  e = P.entitlements(row('a'));
  assert.deepEqual([e.max, e.visualiser, e.source, e.plan, e.interval, e.renews_at], [true, false, 'subscription', 'max', 'month', '2026-12-01T00:00:00.000Z']);
  assert.ok(rollout.isEnabledFor(row('a')), 'the rollout gate honours a paid plan');
  P.activate(row('a'), { plan: 'max_visualiser', interval: 'year', status: 'active', subscription_id: 'sub_x' });
  e = P.entitlements(row('a'));
  assert.deepEqual([e.max, e.visualiser, e.plan, e.plan_name, e.visualiser_source], [true, true, 'max_visualiser', 'AI QS MAX + Visualiser', 'subscription']);
  // past_due keeps access (Stripe is retrying); canceled takes it away.
  P.activate(row('a'), { plan: 'max_visualiser', interval: 'year', status: 'past_due', subscription_id: 'sub_x' });
  assert.equal(P.entitlements(row('a')).max, true);
  P.deactivate(row('a'), 'canceled');
  e = P.entitlements(row('a'));
  assert.deepEqual([e.max, e.visualiser, e.plan, e.status], [false, false, null, 'canceled']);
  assert.equal(row('a').max_subscription_id, 'sub_x', 'the subscription id stays for the record');
  assert.ok(!rollout.isEnabledFor(row('a')));
  // The rollout switched to everyone: MAX for all, the Visualiser still not.
  rollout.setMode('all', 'adm');
  e = P.entitlements(row('b'));
  assert.deepEqual([e.max, e.visualiser, e.source], [true, false, 'rollout']);
  rollout.setMode('admin', 'adm');
  // Admins have everything.
  e = P.entitlements(row('adm'));
  assert.deepEqual([e.max, e.visualiser, e.source], [true, true, 'admin']);
});

// ── The webhook ──────────────────────────────────────────────────────────────

test('checkout → the plan is on the account; switch, cancel at period end, ended, and a renewal', async () => {
  rollout.setMode('admin', 'adm');
  // Bob buys MAX + Visualiser yearly. The link was stamped with his account id.
  stripeState.subs.sub_bob = sub('sub_bob', stripeState.prices[3], { customer: 'cus_2' });
  let r = await event('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_bob', client_reference_id: 'b', customer_details: { email: 'bob@t.t' }, amount_total: 79000, currency: 'gbp' });
  assert.equal(r.status, 200);
  let b = row('b');
  assert.deepEqual([b.max_plan, b.max_plan_status, b.max_plan_interval, b.max_subscription_id, b.max_plan_renews_at], ['max_visualiser', 'active', 'year', 'sub_bob', '2025-11-08T08:53:20.000Z']);
  r = await req('GET', '/auth/me', tokenB);
  assert.equal(r.body.maxEnabled, true); assert.equal(r.body.visualiserEnabled, true);
  assert.deepEqual([r.body.maxPlan.plan, r.body.maxPlan.source, r.body.maxPlan.interval], ['max_visualiser', 'subscription', 'year']);
  assert.ok(db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE event_type = 'max_plan_started' AND user_id = 'b'").get().c >= 1);

  // He switches down to plain MAX monthly from the Stripe side: the Visualiser goes.
  stripeState.subs.sub_bob.items.data[0].price = stripeState.prices[0];
  r = await event('customer.subscription.updated', stripeState.subs.sub_bob);
  b = row('b');
  assert.deepEqual([b.max_plan, b.max_plan_interval], ['max', 'month']);
  r = await req('GET', '/auth/me', tokenB);
  assert.equal(r.body.visualiserEnabled, false);

  // Cancels at period end: still on until then, and the account knows the date.
  stripeState.subs.sub_bob.cancel_at_period_end = true;
  await event('customer.subscription.updated', stripeState.subs.sub_bob);
  b = row('b');
  assert.equal(b.max_plan, 'max');
  assert.equal(b.max_plan_cancels_at, '2025-11-08T08:53:20.000Z');
  assert.ok(db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE event_type = 'max_plan_cancelled' AND user_id = 'b'").get().c >= 1);

  // Then it ends.
  await event('customer.subscription.deleted', { ...stripeState.subs.sub_bob, status: 'canceled' });
  b = row('b');
  assert.deepEqual([b.max_plan, b.max_plan_status, b.max_plan_cancels_at], [null, 'canceled', null]);
  r = await req('GET', '/auth/me', tokenB);
  assert.equal(r.body.maxEnabled, false);

  // A renewal invoice refreshes the period; a subscription nobody holds is ignored.
  stripeState.subs.sub_bob = sub('sub_bob', stripeState.prices[0], { customer: 'cus_2', current_period_end: 1765184000 });
  await event('customer.subscription.updated', stripeState.subs.sub_bob);
  await event('invoice.paid', { id: 'in_1', subscription: 'sub_bob', customer: 'cus_2', customer_email: 'bob@t.t' });
  b = row('b');
  assert.deepEqual([b.max_plan, b.max_plan_renews_at, b.stripe_subscription_id || null], ['max', '2025-12-08T08:53:20.000Z', null], 'the legacy plan columns are left alone');
  await event('customer.subscription.deleted', { ...sub('sub_nobody', stripeState.prices[0]), status: 'canceled' });
  assert.equal(row('b').max_plan, 'max', 'another subscription ending changes nothing here');

  // An Office in a Box subscription still takes the Office path, not this one.
  stripeState.subs.sub_office = sub('sub_office', stripeState.prices[4], { customer: 'cus_1' });
  await event('checkout.session.completed', { id: 'cs_2', mode: 'subscription', subscription: 'sub_office', client_reference_id: 'a', customer_details: { email: 'alice@t.t' } });
  const a = row('a');
  assert.equal(a.has_estimator, 1); assert.equal(a.max_plan, null);
  db.prepare("UPDATE users SET has_estimator = 0, office_subscription_id = NULL WHERE id = 'a'").run();
  delete stripeState.subs.sub_office;
  // Matched by the customer's email when the link carried no account id.
  stripeState.subs.sub_cara = sub('sub_cara', stripeState.prices[1], { customer: 'cus_3' });
  stripeState.customers.cus_3 = { id: 'cus_3', email: 'cara@t.t' };
  await event('checkout.session.completed', { id: 'cs_3', mode: 'subscription', subscription: 'sub_cara', customer_details: { email: 'Cara@T.T' } });
  assert.deepEqual([row('c').max_plan, row('c').max_plan_interval], ['max', 'year']);
  db.prepare("UPDATE users SET max_plan = NULL, max_plan_status = NULL, max_subscription_id = NULL WHERE id = 'c'").run();
  delete stripeState.subs.sub_bob;
});

// ── The billing routes ───────────────────────────────────────────────────────

test('the plans page: catalogue and links; verify after checkout; switch, cancel, resume, portal', async () => {
  rollout.setMode('admin', 'adm');
  db.prepare("UPDATE users SET max_plan = NULL, max_plan_status = NULL, max_subscription_id = NULL, max_plan_cancels_at = NULL WHERE id = 'a'").run();
  process.env.MAX_PAYMENT_LINK_MONTHLY = 'https://buy.stripe.test/max-m';
  let r = await req('GET', '/billing/max', tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.body.plans.length, 2);
  assert.equal(r.body.links.max.month, 'https://buy.stripe.test/max-m');
  assert.equal(r.body.links.max.year, null);
  assert.equal(r.body.stripe.links, false, 'not every link is set yet');
  assert.deepEqual([r.body.current.max, r.body.current.visualiser, r.body.current.plan], [false, false, null]);
  delete process.env.MAX_PAYMENT_LINK_MONTHLY;
  // No subscription: nothing to change, cancel or manage.
  for (const p of ['/billing/max/change', '/billing/max/cancel', '/billing/max/resume', '/billing/max/portal']) {
    r = await req('POST', p, tokenA, { plan: 'max', interval: 'month' });
    assert.equal(r.status, 400, p); assert.equal(r.body.code, 'NO_SUBSCRIPTION');
  }
  // Just paid, webhook not yet arrived: verify finds the subscription under her email.
  stripeState.subs.sub_alice = sub('sub_alice', stripeState.prices[0], { customer: 'cus_1' });
  r = await req('POST', '/billing/max/verify', tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.body.activated, true);
  assert.deepEqual([r.body.current.plan, r.body.current.interval, r.body.current.max, r.body.current.visualiser], ['max', 'month', true, false]);
  assert.equal(r.body.current.renders.enabled, false, 'the allowance says the Visualiser is off');
  r = await req('GET', '/surveys', tokenA);
  assert.equal(r.status, 200, 'Scan a room opens with MAX');
  r = await req('GET', '/surveys', tokenC);
  assert.equal(r.status, 403, 'and not without'); assert.equal(r.body.code, 'MAX_NOT_ENABLED');
  // Bad asks.
  r = await req('POST', '/billing/max/change', tokenA, { plan: 'gold', interval: 'month' }); assert.equal(r.status, 400);
  r = await req('POST', '/billing/max/change', tokenA, { plan: 'max', interval: 'week' }); assert.equal(r.status, 400);
  r = await req('POST', '/billing/max/change', tokenA, { plan: 'max', interval: 'month' });
  assert.equal(r.body.changed, false, 'already on it');
  // Add the Visualiser, yearly: Stripe swaps the price with proration, the account follows at once.
  r = await req('POST', '/billing/max/change', tokenA, { plan: 'max_visualiser', interval: 'year' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.changed, true);
  assert.deepEqual([r.body.current.plan, r.body.current.interval, r.body.current.visualiser, r.body.current.renders.enabled], ['max_visualiser', 'year', true, true]);
  const upd = stripeState.updates[stripeState.updates.length - 1];
  assert.deepEqual(upd.params.items, [{ id: 'si_sub_alice', price: 'p_vis_y' }]);
  assert.equal(upd.params.proration_behavior, 'create_prorations');
  r = await req('GET', '/auth/me', tokenA);
  assert.equal(r.body.visualiserEnabled, true);
  // Cancel at period end, then change their mind.
  r = await req('POST', '/billing/max/cancel', tokenA);
  assert.equal(r.body.cancelled, true);
  assert.equal(r.body.current.cancels_at, '2025-11-08T08:53:20.000Z');
  assert.equal(r.body.current.max, true, 'still on until the period ends');
  r = await req('POST', '/billing/max/resume', tokenA);
  assert.equal(r.body.resumed, true);
  assert.equal(r.body.current.cancels_at, null);
  // The customer portal link.
  r = await req('POST', '/billing/max/portal', tokenA);
  assert.equal(r.status, 200);
  assert.ok(/billing\.stripe\.test\/cus_1/.test(r.body.url));
  // A price Stripe does not have: nothing changes.
  stripeState.prices = stripeState.prices.filter((p) => p.id !== 'p_max_y');
  r = await req('POST', '/billing/max/change', tokenA, { plan: 'max', interval: 'year' });
  assert.equal(r.status, 503); assert.equal(r.body.code, 'PRICE_NOT_FOUND');
  assert.equal(row('a').max_plan, 'max_visualiser');
  // Another account cannot touch it.
  r = await req('POST', '/billing/max/cancel', tokenC);
  assert.equal(r.status, 400);
  assert.equal(stripeState.subs.sub_alice.cancel_at_period_end, false);
});

// ── Admin ────────────────────────────────────────────────────────────────────

test('admin: the Visualiser grant per account, subscriber counts, and the plan in the users list', async () => {
  rollout.setMode('admin', 'adm');
  let r = await req('PUT', '/max/users/c/visualiser', tokenAdmin, { enabled: true });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.visualiserGrant, r.body.visualiserEnabled], [true, true]);
  r = await req('GET', '/auth/me', tokenC);
  assert.deepEqual([r.body.maxEnabled, r.body.visualiserEnabled, r.body.maxPlan.visualiserSource], [false, true, 'grant']);
  r = await req('PUT', '/max/users/c/visualiser', tokenC, { enabled: true });
  assert.equal(r.status, 404, 'clients cannot grant themselves anything');
  r = await req('GET', '/max/settings', tokenAdmin);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.plans.subscribers.max_visualiser, r.body.plans.subscribers.yearly, r.body.plans.subscribers.visualiser_grants], [1, 1, 1]);
  assert.equal(r.body.plans.stripe, true);
  assert.equal(r.body.plans.links, false);
  r = await req('GET', '/admin/users', tokenAdmin);
  const alice = r.body.users.find((u) => u.id === 'a');
  const cara = r.body.users.find((u) => u.id === 'c');
  assert.deepEqual([alice.max_plan, alice.max_plan_interval, alice.visualiser_grant], ['max_visualiser', 'year', 0]);
  assert.deepEqual([cara.max_plan, cara.visualiser_grant], [null, 1]);
  r = await req('PUT', '/max/users/c/visualiser', tokenAdmin, { enabled: false });
  assert.equal(r.body.visualiserEnabled, false);
  r = await req('PUT', '/max/users/nobody/visualiser', tokenAdmin, { enabled: true });
  assert.equal(r.status, 404);
});

// ── The one-off grant ────────────────────────────────────────────────────────

test('accounts with early access before the packages keep the Visualiser as a grant, once', () => {
  db.prepare("DELETE FROM app_settings WHERE key = 'max_visualiser_backfill'").run();
  db.prepare("UPDATE users SET feature_overrides = '{\"max\":true}' WHERE id = 'b'").run();
  db.prepare("UPDATE users SET feature_overrides = '{\"max\":true,\"visualiser\":false}' WHERE id = 'c'").run();
  db.prepare("UPDATE users SET feature_overrides = NULL, max_plan = NULL, max_plan_status = NULL WHERE id = 'a'").run();
  assert.equal(P.backfillVisualiserGrants(), 1, 'only the account with early access and no say on the Visualiser');
  assert.equal(P.entitlements(row('b')).visualiser, true);
  assert.equal(P.entitlements(row('c')).visualiser, false, 'an explicit no is kept');
  assert.equal(P.entitlements(row('a')).visualiser, false);
  db.prepare("UPDATE users SET feature_overrides = '{\"max\":true}' WHERE id = 'a'").run();
  assert.equal(P.backfillVisualiserGrants(), 0, 'it never runs twice');
  assert.equal(P.entitlements(row('a')).visualiser, false);
});

test('a package bought under an email before the account existed attaches when the Plans page asks', async () => {
  rollout.setMode('admin', 'adm');
  // Dana paid on the website; her account is created afterwards.
  stripeState.customers.cus_4 = { id: 'cus_4', email: 'dana@t.t' };
  stripeState.subs.sub_dana = sub('sub_dana', stripeState.prices.find((x) => x.id === 'p_vis_m'), { customer: 'cus_4' });
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country) VALUES ('d', 'dana@t.t', 'x', 'Dana', 'Co', 'client', 'GB')").run();
  const match = await require('./billingRoutes').attachByEmail(row('d'));
  assert.deepEqual([match.plan, match.interval, row('d').max_plan, row('d').max_subscription_id], ['max_visualiser', 'month', 'max_visualiser', 'sub_dana']);
  assert.equal(await require('./billingRoutes').attachByEmail(row('d')), null, 'nothing to do the second time');
});

// ── The free trial ───────────────────────────────────────────────────────────

test('the free trial: its length, a trial checkout, the email, the Plans page and the counts', async () => {
  rollout.setMode('admin', 'adm');
  // The length: 7 days unless MAX_TRIAL_DAYS says otherwise; nonsense is ignored.
  delete process.env.MAX_TRIAL_DAYS;
  assert.equal(P.trialDays(), 7);
  for (const [v, want] of [['14', 14], ['0', 0], ['', 7], ['seven', 7], ['-3', 7], ['2.5', 7]]) {
    process.env.MAX_TRIAL_DAYS = v;
    assert.equal(P.trialDays(), want, 'MAX_TRIAL_DAYS=' + JSON.stringify(v));
  }
  delete process.env.MAX_TRIAL_DAYS;

  // Eve starts the trial on MAX yearly: on straight away, nothing paid, and
  // the date the first £590 is taken is the day the trial ends.
  const trialEnd = 1764806400; // 4 December 2025
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country) VALUES ('e', 'eve@t.t', 'x', 'Eve Evans', 'Co', 'client', 'GB')").run();
  const tokenE = generateToken({ id: 'e', email: 'eve@t.t', role: 'client' });
  stripeState.customers.cus_5 = { id: 'cus_5', email: 'eve@t.t' };
  stripeState.subs.sub_eve = sub('sub_eve', stripeState.prices.find((x) => x.id === 'p_max_y') || price('p_max_y', 59000, 'year'), { customer: 'cus_5', status: 'trialing', trial_end: trialEnd, current_period_end: trialEnd });
  const sent = [];
  const routes = require('./routes');
  const realSend = routes.sendEmail;
  routes.sendEmail = async (m) => { sent.push(m); };
  let r;
  try {
    r = await event('checkout.session.completed', { id: 'cs_trial', mode: 'subscription', subscription: 'sub_eve', client_reference_id: 'e', customer_details: { email: 'eve@t.t' }, amount_total: 0, currency: 'gbp' });
    await new Promise((resolve) => setImmediate(resolve));
  } finally { routes.sendEmail = realSend; }
  assert.equal(r.status, 200);
  const e = row('e');
  assert.deepEqual([e.max_plan, e.max_plan_status, e.max_plan_interval, e.max_plan_renews_at], ['max', 'trialing', 'year', '2025-12-04T00:00:00.000Z']);
  assert.equal(P.entitlements(e).max, true, 'MAX is on during the trial');
  const mail = sent.find((m) => m.to === 'eve@t.t');
  assert.ok(mail, 'the trial email went out');
  assert.match(mail.subject, /free trial has started/i);
  assert.match(mail.html, /Free trial until 4 December 2025/);
  assert.match(mail.html, /£590 a year/);
  assert.doesNotMatch(mail.html, /Amount paid/, 'no "£0.00 paid" line on a trial');
  assert.ok(db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE event_type = 'max_plan_started' AND user_id = 'e' AND title LIKE '%free trial until 2025-12-04%'").get().c >= 1);

  // The Plans page knows the trial length and that Eve is on one.
  r = await req('GET', '/billing/max', tokenE);
  assert.equal(r.body.trial_days, 7);
  assert.deepEqual([r.body.current.plan, r.body.current.status, r.body.current.renews_at], ['max', 'trialing', '2025-12-04T00:00:00.000Z']);

  // A subscription event without the period end still has the trial's end.
  const noPeriod = { ...stripeState.subs.sub_eve };
  delete noPeriod.current_period_end;
  assert.equal(P.fromStripe(noPeriod).renews_at, '2025-12-04T00:00:00.000Z');
  assert.equal(P.fromStripe(noPeriod).trial_ends_at, '2025-12-04T00:00:00.000Z');
  assert.equal(P.fromStripe({ ...stripeState.subs.sub_eve, status: 'active' }).trial_ends_at, null);

  // The admin counts show who is on a trial.
  r = await req('GET', '/max/settings', tokenAdmin);
  assert.equal(r.body.plans.subscribers.trialing, 1);

  // The trial ends and the first payment goes through: an ordinary yearly plan.
  stripeState.subs.sub_eve = { ...stripeState.subs.sub_eve, status: 'active', current_period_end: trialEnd + 365 * 86400 };
  await event('customer.subscription.updated', stripeState.subs.sub_eve);
  assert.deepEqual([row('e').max_plan_status, row('e').max_plan_renews_at], ['active', '2026-12-04T00:00:00.000Z']);
  r = await req('GET', '/max/settings', tokenAdmin);
  assert.equal(r.body.plans.subscribers.trialing, 0);
  delete stripeState.subs.sub_eve;
});

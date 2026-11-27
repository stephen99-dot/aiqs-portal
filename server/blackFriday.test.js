// Black Friday 2026: the four deals, when the sale runs, the checkout the
// server opens for a deal, and — the part that matters most — the webhook
// landing the jobs the deal promised. The sale's 10 jobs cost £349, the same
// amount as the normal 5-pack, so the amount alone would land 5.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-bf-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.PORTAL_URL = 'https://portal.test';
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
delete process.env.STRIPE_BOQ_PACKS;
delete process.env.BLACK_FRIDAY_ENABLED;
// The sale is on for these tests, whatever today's date.
process.env.BLACK_FRIDAY_STARTS_AT = new Date(Date.now() - 3600e3).toISOString();
process.env.BLACK_FRIDAY_ENDS_AT = new Date(Date.now() + 86400e3).toISOString();

// ── A pretend Stripe: only Checkout Sessions are created ───────────────────
const created = [];
const fakeStripe = {
  checkout: { sessions: { create: async (params) => { created.push(params); return { id: 'cs_test_bf' + created.length, url: 'https://checkout.stripe.test/' + created.length }; } } },
  customers: { retrieve: async (id) => ({ id, email: null }) },
};
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: () => fakeStripe };

const db = require('./database');
require('./routes'); // its migrations add columns the sign-in check reads
const express = require('express');
const { generateToken } = require('./auth');
const BF = require('./blackFriday');
const webhook = require('./stripe-webhook');

const app = express();
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), webhook);
app.use(express.json());
app.use('/api/black-friday', BF.router);
const server = app.listen(0);
const PORT = server.address().port;

db.prepare("INSERT INTO users (id, email, password_hash, full_name, role, free_credits) VALUES ('u1', 'dan@t.t', 'x', 'Dan Digger', 'client', 0)").run();
db.prepare("INSERT INTO users (id, email, password_hash, full_name, role, free_credits) VALUES ('u2', 'eve@t.t', 'x', 'Eve Earth', 'client', 2)").run();
db.prepare("INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('adm', 'admin@t.t', 'x', 'The Admin', 'admin')").run();
const token = generateToken({ id: 'u1', email: 'dan@t.t', role: 'client' });
const adminToken = generateToken({ id: 'adm', email: 'admin@t.t', role: 'admin' });
const credits = (id) => db.prepare('SELECT free_credits FROM users WHERE id = ?').get(id).free_credits;

function req(method, url, tok, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const r = http.request({ port: PORT, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(data ? { 'Content-Length': data.length } : {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let parsed = null; try { parsed = buf ? JSON.parse(buf) : null; } catch (e) { parsed = buf; } resolve({ status: res.statusCode, body: parsed }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
async function quietly(fn) {
  const routes = require('./routes');
  const real = routes.sendEmail;
  const sent = [];
  routes.sendEmail = async (m) => { sent.push(m); };
  try { await fn(); await new Promise((r) => setImmediate(r)); } finally { routes.sendEmail = real; }
  return sent;
}
const paid = (session) => quietly(() => req('POST', '/stripe/webhook', null, { id: 'evt_' + Math.random().toString(36).slice(2), type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_status: 'paid', currency: 'gbp', ...session } } }));

test.after(() => { server.close(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tmp */ } });

test('the four deals: prices, savings and price per job as the artwork', () => {
  const deals = BF.publicDeals();
  assert.deepEqual(deals.map((d) => [d.jobs, d.was, d.price, d.save, d.per_job]), [
    [1, 150, 99, 51, 99],
    [5, 349, 229, 120, 45.8],
    [10, 580, 349, 231, 34.9],
    [20, 980, 589, 391, 29.45],
  ]);
  assert.deepEqual(deals.filter((d) => d.featured).map((d) => d.jobs), [10], 'the 10-job deal is the recommended one');
});

test('the sale runs from Black Friday to 23:59 on Monday 30 November, UK time, unless told otherwise', () => {
  const saved = { s: process.env.BLACK_FRIDAY_STARTS_AT, e: process.env.BLACK_FRIDAY_ENDS_AT };
  delete process.env.BLACK_FRIDAY_STARTS_AT;
  delete process.env.BLACK_FRIDAY_ENDS_AT;
  try {
    assert.equal(BF.isActive(Date.parse('2026-11-26T23:59:59Z')), false, 'not before Black Friday');
    assert.equal(BF.isActive(Date.parse('2026-11-27T00:00:00Z')), true, 'from midnight on Black Friday');
    assert.equal(BF.isActive(Date.parse('2026-11-30T23:59:30Z')), true, 'still on at 23:59 on Monday');
    assert.equal(BF.isActive(Date.parse('2026-11-30T23:59:59Z')), false, 'over at the end of 23:59');
    assert.equal(BF.isActive(Date.parse('2026-12-01T00:00:00Z')), false, 'and on Tuesday');
    assert.equal(new Date(BF.saleWindow().endsAt).toISOString(), '2026-11-30T23:59:59.000Z');
    process.env.BLACK_FRIDAY_ENDS_AT = '2026-12-07T00:00:00Z';
    assert.equal(BF.isActive(Date.parse('2026-12-03T12:00:00Z')), true, 'an extended end date is honoured');
    process.env.BLACK_FRIDAY_ENABLED = '0';
    assert.equal(BF.isActive(Date.parse('2026-11-28T12:00:00Z')), false, 'switched off early');
  } finally {
    delete process.env.BLACK_FRIDAY_ENABLED;
    process.env.BLACK_FRIDAY_STARTS_AT = saved.s;
    process.env.BLACK_FRIDAY_ENDS_AT = saved.e;
  }
});

test('a builder is offered the sale; an admin, who never runs out, is not', async () => {
  const r = await req('GET', '/black-friday', token);
  assert.equal(r.status, 200);
  assert.equal(r.body.active, true);
  assert.equal(r.body.eligible, true);
  assert.equal(r.body.max_save, 391);
  assert.equal(r.body.deals.length, 4);
  const a = await req('GET', '/black-friday', adminToken);
  assert.equal(a.body.eligible, false);
  assert.equal((await req('GET', '/black-friday', null)).status, 401, 'signed in only');
});

test('checkout opens a Stripe session for the deal, stamped with the account and the jobs', async () => {
  const r = await req('POST', '/black-friday/checkout', token, { deal: 'bf_10' });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/checkout\.stripe\.test\//);
  const s = created[created.length - 1];
  assert.equal(s.mode, 'payment');
  assert.equal(s.client_reference_id, 'u1');
  assert.equal(s.customer_email, 'dan@t.t');
  assert.equal(s.line_items[0].price_data.unit_amount, 34900);
  assert.equal(s.line_items[0].price_data.currency, 'gbp');
  assert.deepEqual(s.metadata, { promo: 'black_friday_2026', deal: 'bf_10', boq_credits: '10', user_id: 'u1' });
  assert.equal(s.success_url, 'https://portal.test/payment-success?credits=1');
  assert.equal(s.cancel_url, 'https://portal.test/dashboard?deals=1');

  assert.equal((await req('POST', '/black-friday/checkout', token, { deal: 'bf_1000' })).status, 400, 'no such deal');
  assert.equal((await req('POST', '/black-friday/checkout', token, { deal: 'bf_10', price: 1 })).status, 200, 'the price is never taken from the request');
  assert.equal(created[created.length - 1].line_items[0].price_data.unit_amount, 34900);
});

test('once the sale has ended, checkout refuses', async () => {
  const saved = process.env.BLACK_FRIDAY_ENDS_AT;
  process.env.BLACK_FRIDAY_ENDS_AT = new Date(Date.now() - 1000).toISOString();
  try {
    const before = created.length;
    const r = await req('POST', '/black-friday/checkout', token, { deal: 'bf_5' });
    assert.equal(r.status, 410);
    assert.equal(created.length, before, 'nothing opened at Stripe');
    assert.equal((await req('GET', '/black-friday', token)).body.active, false);
  } finally { process.env.BLACK_FRIDAY_ENDS_AT = saved; }
});

test('paying the Black Friday 10 jobs (£349) lands 10 credits, not the 5-pack the amount would say', async () => {
  const before = credits('u1');
  const mail = await paid({ id: 'cs_test_bf_ten', amount_total: 34900, amount_subtotal: 34900, client_reference_id: 'u1', customer_details: { email: 'dan@t.t' }, metadata: { promo: 'black_friday_2026', deal: 'bf_10', boq_credits: '10', user_id: 'u1' } });
  assert.equal(credits('u1'), before + 10);
  assert.ok(mail.some((m) => /Black Friday/.test(m.subject || '')), 'the confirmation says it was the Black Friday deal');

  // Stripe sends the same event again: nothing more lands.
  await paid({ id: 'cs_test_bf_ten', amount_total: 34900, client_reference_id: 'u1', customer_details: { email: 'dan@t.t' }, metadata: { boq_credits: '10' } });
  assert.equal(credits('u1'), before + 10);
});

test('every deal lands its own number of jobs', async () => {
  for (const d of BF.DEALS) {
    const before = credits('u2');
    await paid({ id: 'cs_test_each_' + d.key, amount_total: d.price * 100, client_reference_id: 'u2', customer_details: { email: 'eve@t.t' }, metadata: { promo: 'black_friday_2026', deal: d.key, boq_credits: String(d.jobs) } });
    assert.equal(credits('u2'), before + d.jobs, d.key);
  }
});

test('the normal Payment Links still go by amount — £349 without the stamp is still the 5-pack', async () => {
  const before = credits('u2');
  await paid({ id: 'cs_test_plain_five', amount_total: 34900, client_reference_id: 'u2', customer_details: { email: 'eve@t.t' } });
  assert.equal(credits('u2'), before + 5);
});

test('paid under an email with no account yet: the 20 jobs wait for them', async () => {
  await paid({ id: 'cs_test_bf_new', amount_total: 58900, customer_details: { email: 'new@t.t' }, metadata: { promo: 'black_friday_2026', deal: 'bf_20', boq_credits: '20' } });
  const row = db.prepare('SELECT credits, reason FROM pending_credits WHERE stripe_session_id = ?').get('cs_test_bf_new');
  assert.deepEqual({ ...row }, { credits: 20, reason: 'user_not_found' });
});

test('a stamp that is not a sensible number of jobs is ignored', () => {
  assert.equal(BF.creditsFromMetadata({ metadata: { boq_credits: '10' } }), 10);
  for (const bad of ['0', '-5', '2.5', 'ten', '', '5000']) assert.equal(BF.creditsFromMetadata({ metadata: { boq_credits: bad } }), 0, JSON.stringify(bad));
  assert.equal(BF.creditsFromMetadata({}), 0);
  assert.equal(BF.creditsFromMetadata(null), 0);
});

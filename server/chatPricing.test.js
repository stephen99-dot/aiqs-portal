// AI Chat no longer prices: a price, cost, estimate, quote or BOQ ask gets the
// MAX reply with no model call and no credit spent; the routes that price a
// take-off and Atlas refuse; the chat's persona carries no rates and is told
// not to price. CHAT_PRICING=1 brings the old behaviour back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-chatgate-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ENABLE_WEB_SEARCH = '0';
delete process.env.CHAT_PRICING;
delete process.env.MAX_ROLLOUT;

// Any model call is a failure of the gate.
const realClient = require('./anthropicClient');
let modelCalls = 0;
require.cache[require.resolve('./anthropicClient')].exports = { ...realClient, callModel: async () => { modelCalls += 1; return { ok: false, status: 503, error: { message: 'should not be called' } }; } };
const realFetch = global.fetch;
global.fetch = async (url, opts) => { if (/anthropic/.test(String(url))) { modelCalls += 1; throw new Error('should not be called'); } return realFetch(url, opts); };

const db = require('./database');
const express = require('express');
const { generateToken } = require('./auth');
const chatPricing = require('./chatPricing');

const app = express();
app.use(express.json());
app.use('/api', require('./routes'));   // owns the users columns the auth middleware reads
app.use('/api', require('./chat'));
app.use('/api', require('./agentRoutes'));
const server = app.listen(0);
const PORT = server.address().port;

db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country, message_credits) VALUES ('a', 'alice@t.t', 'x', 'Alice', 'Co', 'client', 'GB', 5)").run();
db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country, message_credits, feature_overrides) VALUES ('m', 'max@t.t', 'x', 'Max User', 'Co', 'client', 'GB', 5, '{\"max\":true}')").run();
const tokenA = generateToken({ id: 'a', email: 'alice@t.t', role: 'client' });
const tokenM = generateToken({ id: 'm', email: 'max@t.t', role: 'client' });

function req(method, url, token, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') : null;
    const r = http.request({ port: PORT, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': data.length } : {}), ...(headers || {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let parsed = null; try { parsed = buf ? JSON.parse(buf) : null; } catch (e) { parsed = buf; } resolve({ status: res.statusCode, body: parsed, raw: buf }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

test.after(() => { server.close(); global.fetch = realFetch; try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* tmp */ } });

test('what counts as asking for a price', () => {
  for (const m of ['How much would a 20m2 extension cost?', 'can you price this up', 'rough estimate for a loft conversion', 'what are your rates for plastering', "what's the going rate per m² for render", 'give me a quote', 'generate the BOQ', 'budget for a new kitchen', 'is £45,000 reasonable for this', 'what would it come to roughly']) {
    assert.ok(chatPricing.asksForPrice(m), m);
  }
  for (const m of ['What building regs apply to a rear extension?', 'How should I detail a flat roof upstand?', 'In what order do the trades run on a bathroom refit?', 'what is a cavity tray']) {
    assert.ok(!chatPricing.asksForPrice(m), 'not a price ask: ' + m);
  }
});

test('a price ask gets the MAX reply, no model call, no credit spent', async () => {
  const before = db.prepare("SELECT COUNT(*) AS c FROM usage_log WHERE user_id = 'a'").get().c;
  let r = await req('POST', '/chat', tokenA, { message: 'How much would a 20m2 single storey extension cost roughly?' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.max_upsell, true);
  assert.equal(r.body.max_enabled, false);
  assert.ok(/MAX/.test(r.body.reply) && /Submit Drawings/.test(r.body.reply) && /AI QS MAX package/.test(r.body.reply), r.body.reply);
  assert.ok(!/£|\d+,\d{3}/.test(r.body.reply), 'no figures in the reply');
  assert.equal(modelCalls, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM usage_log WHERE user_id = 'a'").get().c, before, 'nothing logged, nothing spent');
  // An account with MAX is told to ask MAX, not sold the package.
  r = await req('POST', '/chat', tokenM, { message: 'price a 20m2 patio please' });
  assert.equal(r.body.max_upsell, true); assert.equal(r.body.max_enabled, true);
  assert.ok(/Ask MAX/.test(r.body.reply) && !/AI QS MAX package/.test(r.body.reply), r.body.reply);
  // The streamed form carries the same reply and flag.
  r = await req('POST', '/chat/stream', tokenA, { message: 'what is the cost per m2 of a loft conversion' });
  assert.equal(r.status, 200);
  const events = String(r.raw).split('\n').filter((l) => l.startsWith('data:') && !/\[DONE\]/.test(l)).map((l) => JSON.parse(l.slice(5)));
  const done = events.find((e) => e.type === 'done');
  assert.ok(done && done.max_upsell === true && /MAX/.test(done.reply), JSON.stringify(events).slice(0, 300));
  assert.equal(modelCalls, 0);
});

test('the routes that price a take-off, and Atlas, refuse', async () => {
  let r = await req('GET', '/takeoff/some-session/priced', tokenA);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'PRICING_MOVED');
  r = await req('POST', '/tender-return', tokenA, { takeoff_id: 'x', items: [{ key: 'k', actual_rate: 1 }] });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'PRICING_MOVED');
  r = await req('POST', '/agent', tokenA, { scope: 'a 30m2 extension' });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'PRICING_MOVED');
});

test('the chat persona carries no rates or cost benchmarks and is told not to price', () => {
  const chat = require('./chat');
  const prompt = chat._internals.buildSystemPrompt('a', false, null, { pricingContext: true });
  assert.ok(/never give a price, cost, rate, estimate/i.test(prompt), 'the rule is in the prompt');
  assert.ok(/MAX/.test(prompt) && /Submit Drawings/.test(prompt));
  assert.ok(!/FIXED UK RATES/.test(prompt) && !/Typical single storey extension/.test(prompt) && !/CLIENT-SPECIFIC TRAINED RATES/.test(prompt), 'no rate library, no benchmarks');
  assert.ok(!/£\d/.test(prompt), 'no pound figures in the prompt');
});

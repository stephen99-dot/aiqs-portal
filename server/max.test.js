// MAX in The AI QS: small jobs are priced from the builder's own rates and
// drafted as estimates; jobs at or over the limit are refused and sent to the
// AI QS team; sending waits for a tap and is audited; approvals cannot be
// replayed or used by another builder; the rollout gate, the fair-use cap and
// search never cross a tenant line.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-max-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.MAX_ROLLOUT = 'all'; // the builders below are 'client' accounts; the gate has its own tests
process.env.ENABLE_WEB_SEARCH = '0';
process.env.ANTHROPIC_API_KEY = 'test-key'; // the scripted model below answers every call
delete process.env.OPENAI_API_KEY;
delete process.env.DEEPGRAM_API_KEY;

// ── A scripted model ─────────────────────────────────────────────────────────
const realClient = require('./anthropicClient');
const modelCalls = [];
let script = [];
function reply(blocks) {
  return async (opts) => {
    modelCalls.push(opts);
    for (const b of blocks) if (b.type === 'text' && opts.onEvent) opts.onEvent({ type: 'text_delta', delta: b.text });
    return { ok: true, text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''), blocks, toolUse: blocks.filter((b) => b.type === 'tool_use'), usage: { tokensIn: 10, tokensOut: 5 }, stopReason: null };
  };
}
// The take-off call is a forced tool: the engine reads result.json.
function takeoff(json) { return async (opts) => { modelCalls.push(opts); return { ok: true, json, text: '', blocks: [], toolUse: [{ name: 'submit_takeoff', input: json }], usage: { tokensIn: 10, tokensOut: 5 } }; }; }
let toolSeq = 0;
const say = (text) => ({ type: 'text', text });
const use = (name, input) => ({ type: 'tool_use', id: 'tu_' + (++toolSeq), name, input });
require.cache[require.resolve('./anthropicClient')].exports = {
  ...realClient,
  callModel: async (opts) => {
    // Memory extraction / summaries run after a turn with whatever is left; give them nothing.
    if (opts.action === 'memory_extract' || opts.action === 'conversation_summary' || /summar|memory|learn/i.test(opts.action || '')) return { ok: false, status: 503 };
    const next = script.shift();
    if (!next) return { ok: false, status: 503, error: { message: 'nothing scripted for ' + (opts.action || '?') } };
    return next(opts);
  },
};
// autoLearn would call the real API after each turn; keep the tests quiet.
require.cache[require.resolve('./autoLearn')] = { id: require.resolve('./autoLearn'), filename: require.resolve('./autoLearn'), loaded: true, exports: {
  extractAndStore: async () => [], maybeSummariseConversation: async () => null, retrieveRelevantSummaries: async () => [], formatSummariesForPrompt: () => '', ensureSchema() {},
} };

const db = require('./database');
const express = require('express');
const { generateToken, authMiddleware } = require('./auth');
const engine = require('./maxEngine');
const rollout = require('./maxRollout');
const settings = require('./maxSettings');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use('/api', require('./routes'));
app.use('/api', require('./chat'));
app.use('/api', require('./memoryRoutes'));
app.use('/api', require('./deliverableRoutes'));
app.use('/api', require('./activityRoutes').router);
app.use('/api/credits', authMiddleware, require('./creditRoutes'));
app.use('/api/estimator', require('./estimatorRoutes'));
app.use('/api/max', require('./maxRoutes'));
app.use('/api/transcribe', require('./transcribeRoutes'));
const server = app.listen(0);
const PORT = server.address().port;

for (const [id, email, name, company] of [['a', 'alice@t.t', 'Alice Anderson', 'Anderson Builders'], ['b', 'bob@t.t', 'Bob Builder', 'Bob Builds Ltd']]) {
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country) VALUES (?, ?, 'x', ?, ?, 'client', 'GB')").run(id, email, name, company);
}
db.prepare("INSERT INTO users (id, email, password_hash, full_name, role) VALUES ('adm', 'admin@t.t', 'x', 'The Admin', 'admin')").run();
db.prepare("INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit) VALUES ('r1', 'a', 'landscaping', 'paving_slabs_600x600', 'Paving slabs 600x600 laid', 95, 'm²')").run();
db.prepare("INSERT INTO projects (id, user_id, title, project_type, location, status) VALUES ('proj-a', 'a', 'Anderson extension', 'Residential Extension', '7 Birch Close, Bolton', 'in_progress')").run();
db.prepare("INSERT INTO files (id, project_id, filename, original_name, file_type) VALUES ('f-a', 'proj-a', 'anderson-ga.pdf', 'Anderson-GA-plans.pdf', 'application/pdf')").run();

const tokenA = generateToken({ id: 'a', email: 'alice@t.t', role: 'client' });
const tokenB = generateToken({ id: 'b', email: 'bob@t.t', role: 'client' });
const tokenAdmin = generateToken({ id: 'adm', email: 'admin@t.t', role: 'admin' });
const userA = () => db.prepare('SELECT * FROM users WHERE id = ?').get('a');
const userB = () => db.prepare('SELECT * FROM users WHERE id = ?').get('b');
const apiA = engine.makeApi({ baseUrl: 'http://127.0.0.1:' + PORT, headers: { Authorization: 'Bearer ' + tokenA } });
const apiB = engine.makeApi({ baseUrl: 'http://127.0.0.1:' + PORT, headers: { Authorization: 'Bearer ' + tokenB } });

function collect() { const events = []; return { events, emit: (e) => events.push(e), of: (type) => events.filter((e) => e.type === type) }; }
function req(method, url, token, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const r = http.request({ port: PORT, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(headers || {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { let parsed = null; try { parsed = buf ? JSON.parse(buf) : null; } catch (e) { parsed = buf; } resolve({ status: res.statusCode, body: parsed, headers: res.headers }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const auditRows = (type) => db.prepare('SELECT * FROM activity_log WHERE event_type = ? ORDER BY id').all(type);
const lastToolResult = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content)) { const tr = m.content.find((b) => b.type === 'tool_result'); if (tr) return JSON.parse(tr.content); }
  }
  return null;
};

const patioTakeoff = (qty) => ({
  project_name: 'Patio, 12 Oak Lane', project_type: 'Landscaping', confidence: 'high', location: '12 Oak Lane, Manchester M1 1AA',
  items: [
    { section: 'Demolition & Strip-out', item: 'Remove existing slabs', description: 'Break out and remove existing patio slabs', unit: 'm2', qty, working: '5 × 4 = 20', key: 'break_out_existing_slab' },
    { section: 'Preliminaries', item: 'Skip hire', description: '8yd skip for spoil and slabs', unit: 'nr', qty: 1, key: 'skip_hire_8yd' },
    { section: 'External Works', item: 'Sub-base', description: 'Excavate 150mm and lay compacted MOT type 1', unit: 'm2', qty, key: 'hardcore_fill' },
    { section: 'External Works', item: 'Lay slabs', description: 'Lay 600×600 slabs on a full mortar bed', unit: 'm2', qty, key: 'paving_slabs_600x600' },
    { section: 'External Works', item: 'Pointing', description: 'Point joints', unit: 'm2', qty, key: null, assumed_rate: 8 },
  ],
  assumptions: ['Level site with access from the side gate'], exclusions: ['Drainage alterations'], missing_info: [],
});

test.after(() => server.close());

// ── Pricing a small job ──────────────────────────────────────────────────────

test('a small job is measured by the model, priced by the house pricer from the builder\'s own rates, and drafted as an estimate', async () => {
  script = [
    reply([use('price_small_job', { description: 'Price a 20 square metre patio using my usual rates, including taking up the old slabs', location: 'Manchester M1 1AA' })]),
    takeoff(patioTakeoff(20)),
    reply([say('Done — the patio comes to £4,310.80 ex VAT.')]),
  ];
  const c = collect();
  const out = await engine.runTurn({ user: userA(), text: 'price a 20 m² patio', messages: [], context: { path: '/dashboard', threadId: 'th1' }, api: apiA, emit: c.emit });
  assert.equal(out.awaiting, false);
  const done = c.of('tool_done')[0];
  assert.ok(done && done.ok, 'the tool ran: ' + JSON.stringify(done));
  const card = c.of('cards')[0].items[0];
  assert.equal(card.type, 'estimate');
  assert.equal(card.line_count, 5);
  assert.equal(card.estimated_lines, 1, 'the pointing line rests on an assumed rate');
  assert.equal(card.verdict.status, 'ok');
  assert.ok(c.of('navigate').some((e) => e.path === '/estimates/' + card.id), 'the panel opens the estimate');
  assert.ok(c.of('refresh').some((e) => e.scopes.includes('estimates')));

  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(card.id);
  assert.equal(q.user_id, 'a');
  assert.equal(q.source, 'max');
  assert.equal(q.status, 'draft');
  assert.equal(q.location, 'Manchester M1 1AA', 'the site the builder gave wins over the model\'s');
  const meta = JSON.parse(q.max_meta);
  assert.deepEqual(meta.assumptions, ['Level site with access from the side gate']);
  assert.equal(meta.verdict.status, 'ok');
  const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order').all(card.id);
  const slabs = lines.find((l) => l.item === 'Lay slabs');
  assert.equal(slabs.rate, 95, 'the builder\'s own rate is used as-is');
  assert.equal(slabs.est_rate, 0);
  assert.equal(lines.find((l) => l.item === 'Pointing').est_rate, 1);
  assert.ok(Math.abs(q.net_total - lines.reduce((s, l) => s + l.line_total, 0)) < 0.01);

  const result = lastToolResult(out.messages);
  assert.equal(result.estimate_created, true);
  assert.equal(result.rates_used.own_rates, 1);
  assert.equal(result.rates_used.estimated_rates, 1);
  assert.deepEqual(result.estimated_rate_lines, ['Pointing']);
  assert.ok(auditRows('max_action').some((r) => r.user_id === 'a' && /Drafted estimate/.test(r.title)));
  test.estimateId = card.id;
});

test('the other builder cannot see that estimate, through the API or the model\'s tools', async () => {
  const r = await req('GET', '/estimator/quotes/' + test.estimateId, tokenB);
  assert.equal(r.status, 404);
  script = [reply([use('get_estimate', { estimate: test.estimateId })]), reply([say('No such estimate.')])];
  const c = collect();
  const out = await engine.runTurn({ user: userB(), text: 'open it', messages: [], context: {}, api: apiB, emit: c.emit });
  const result = lastToolResult(out.messages);
  assert.ok(/No estimate matches/.test(result.error), result.error);
});

test('at or above the limit MAX makes no estimate and hands the job to the AI QS team', async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE user_id = 'a'").get().n;
  script = [
    reply([use('price_small_job', { description: 'Price a 1,500 square metre commercial car park with slabs', location: 'Manchester' })]),
    takeoff(patioTakeoff(1500)),
    reply([say('That one is too big for me.')]),
  ];
  const c = collect();
  const out = await engine.runTurn({ user: userA(), text: 'price a huge car park', messages: [], context: {}, api: apiA, emit: c.emit });
  const card = c.of('cards')[0].items[0];
  assert.equal(card.type, 'over_limit');
  assert.equal(card.limit_gbp, 100000);
  assert.ok(card.rough_price_ex_vat >= 100000, 'the rough price explains the decision: ' + card.rough_price_ex_vat);
  assert.ok(/^\/submit-drawings\?/.test(card.submit_path));
  assert.ok(/brief=/.test(card.submit_path) && /from=max/.test(card.submit_path));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE user_id = 'a'").get().n, before, 'no estimate was saved');
  assert.equal(c.of('navigate').length, 0, 'the builder is not moved anywhere without asking');
  const result = lastToolResult(out.messages);
  assert.equal(result.over_limit, true);
  assert.equal(result.estimate_created, false);
  assert.ok(auditRows('max_over_limit').some((r) => r.user_id === 'a'));
});

test('between the notice level and the limit the estimate is drafted with a notice', async () => {
  settings.update({ notice_gbp: 4000, limit_gbp: 100000 }, 'adm');
  script = [reply([use('price_small_job', { description: 'Price a 20 m² patio, remove old slabs' })]), takeoff(patioTakeoff(20)), reply([say('Drafted — worth a full take-off.')])];
  const c = collect();
  const out = await engine.runTurn({ user: userA(), text: 'patio again', messages: [], context: {}, api: apiA, emit: c.emit });
  const card = c.of('cards')[0].items[0];
  assert.equal(card.type, 'estimate');
  assert.equal(card.verdict.status, 'notice');
  const result = lastToolResult(out.messages);
  assert.equal(result.verdict, 'notice');
  assert.ok(/full take-off/.test(result.verdict_note));
  settings.update({ notice_gbp: 80000 }, 'adm');
  db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(card.id);
  db.prepare('DELETE FROM quotes WHERE id = ?').run(card.id);
});

test('verdicts: the limits compare the price ex VAT and the notice can never sit above the limit', () => {
  const lim = { notice_gbp: 80000, limit_gbp: 100000 };
  assert.equal(settings.verdictFor(4310.8, lim).status, 'ok');
  assert.equal(settings.verdictFor(80000, lim).status, 'notice');
  assert.equal(settings.verdictFor(99999.99, lim).status, 'notice');
  assert.equal(settings.verdictFor(100000, lim).status, 'over_limit');
  settings.update({ notice_gbp: 150000, limit_gbp: 100000 }, 'adm');
  const l = settings.limits();
  assert.equal(l.limit_gbp, 100000);
  assert.equal(l.notice_gbp, 100000, 'clamped to the limit');
  settings.update({ notice_gbp: 80000 }, 'adm');
  assert.deepEqual(settings.limits(), { notice_gbp: 80000, limit_gbp: 100000 });
});

// ── Revising, rates, the take-off hand-off ──────────────────────────────────

test('revise_estimate changes lines by ref, reworks the totals and re-stamps the verdict', async () => {
  script = [reply([use('revise_estimate', { estimate: 'Patio, 12 Oak Lane', updates: [{ ref: 4, rate: 110 }], add: [{ section: 'External Works', item: 'Edging', description: 'Concrete edging to perimeter', unit: 'm', qty: 18, rate: 24 }], remove: [5] })]), reply([say('Updated.')])];
  const c = collect();
  const out = await engine.runTurn({ user: userA(), text: 'make the slabs £110 and add edging, drop the pointing', messages: [], context: {}, api: apiA, emit: c.emit });
  const result = lastToolResult(out.messages);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.lines, 5);
  const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order').all(test.estimateId);
  assert.equal(lines.find((l) => l.item === 'Lay slabs').rate, 110);
  assert.ok(lines.find((l) => l.item === 'Edging'));
  assert.ok(!lines.find((l) => l.item === 'Pointing'));
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(test.estimateId);
  assert.ok(Math.abs(q.net_total - lines.reduce((s, l) => s + l.line_total, 0)) < 0.01);
  const meta = JSON.parse(q.max_meta);
  assert.equal(meta.verdict.status, 'ok');
  assert.ok(meta.revised_at);
  assert.deepEqual(meta.assumptions, ['Level site with access from the side gate'], 'the original assumptions are kept');
});

test('save_rate lands in this builder\'s library only, and my_rates finds it', async () => {
  script = [reply([use('save_rate', { name: 'Plasterboard skim walls', value: 22, unit: 'm2', category: 'plastering' })]), reply([say('Saved.')])];
  const c = collect();
  await engine.runTurn({ user: userA(), text: 'my skim rate is £22 a metre', messages: [], context: {}, api: apiA, emit: c.emit });
  const row = db.prepare("SELECT * FROM client_rate_library WHERE user_id = 'a' AND item_key = 'plasterboard_skim_walls' AND is_active = 1").get();
  assert.ok(row);
  assert.equal(row.value, 22);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM client_rate_library WHERE user_id = 'b'").get().n, 0);
  const found = require('./maxTools').searchRates('a', 'skim', 5);
  assert.equal(found.own[0].key, 'plasterboard_skim_walls');
  assert.equal(found.own[0].rate, 22);
  assert.equal(require('./maxTools').searchRates('b', 'skim', 5).own.length, 0);
});

test('start_takeoff_request opens Submit drawings with the brief filled in and sends nothing', async () => {
  script = [reply([use('start_takeoff_request', { brief: 'Two-storey side extension, drawings attached', project_type: 'Residential Extension', site_address: '7 Birch Close' })]), reply([say('Submit drawings is open.')])];
  const c = collect();
  await engine.runTurn({ user: userA(), text: 'send this to the team', messages: [], context: {}, api: apiA, emit: c.emit });
  const nav = c.of('navigate')[0];
  assert.ok(nav && nav.path.startsWith('/submit-drawings?'));
  const qs = new URLSearchParams(nav.path.split('?')[1]);
  assert.equal(qs.get('brief'), 'Two-storey side extension, drawings attached');
  assert.equal(qs.get('type'), 'Residential Extension');
  assert.equal(qs.get('address'), '7 Birch Close');
  assert.equal(qs.get('from'), 'max');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM drawing_submissions').get().n, 0);
});

// ── Approval: sending ────────────────────────────────────────────────────────

test('sending an estimate waits for approval; the card shows the recipient and the money, and nothing changes', async () => {
  script = [reply([use('send_estimate', { estimate: test.estimateId, client_email: 'mrs.oak@t.t' })])];
  const c = collect();
  const out = await engine.runTurn({ user: userA(), text: 'send it to mrs.oak@t.t', messages: [], context: {}, api: apiA, emit: c.emit });
  assert.equal(out.awaiting, true);
  const cf = c.of('confirm')[0];
  assert.ok(cf, 'an approval card was raised');
  assert.equal(cf.tool, 'send_estimate');
  assert.equal(cf.card.kind, 'send');
  assert.equal(cf.card.to, 'mrs.oak@t.t');
  assert.ok(cf.editable.includes('client_email'));
  assert.ok(cf.card.amount_inc_vat > 0 && cf.card.amount_ex_vat > 0);
  assert.equal(c.of('tool_start').length, 0, 'nothing ran');
  assert.equal(db.prepare('SELECT status FROM quotes WHERE id = ?').get(test.estimateId).status, 'draft');
  test.sendToken = cf.token;
});

test('another builder cannot use that approval token', async () => {
  const c = collect();
  const out = await engine.resumeTurn({ user: userB(), token: test.sendToken, approve: true, api: apiB, emit: c.emit });
  assert.equal(out, null);
  assert.ok(/expired/.test(c.of('error')[0].message));
  assert.equal(db.prepare('SELECT status FROM quotes WHERE id = ?').get(test.estimateId).status, 'draft');
});

test('tapping Approve (with an edited email) sends it, audits actor, IP and agent, and the token is spent', async () => {
  script = [reply([say('Sent to the customer.')])];
  const c = collect();
  await engine.resumeTurn({ user: userA(), token: test.sendToken, approve: true, edits: { client_email: 'oak.family@t.t', estimate: 'HACK' }, api: apiA, emit: c.emit, audit: { ip: '10.1.2.3', userAgent: 'MAX-test/1.0' } });
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(test.estimateId);
  assert.equal(q.status, 'sent');
  assert.equal(q.client_email, 'oak.family@t.t', 'the editable field was applied');
  assert.ok(q.public_token, 'an acceptance link was minted');
  const row = auditRows('max_approved').at(-1);
  assert.equal(row.user_id, 'a');
  const detail = JSON.parse(row.detail);
  assert.equal(detail.tool, 'send_estimate');
  assert.equal(detail.ip, '10.1.2.3');
  assert.equal(detail.user_agent, 'MAX-test/1.0');
  assert.deepEqual(detail.edited, ['client_email'], 'only declared-editable fields are taken');
  assert.ok(c.of('tool_done').some((e) => e.name === 'send_estimate' && e.ok));
  // Replay: the same token is gone.
  const c2 = collect();
  const again = await engine.resumeTurn({ user: userA(), token: test.sendToken, approve: true, api: apiA, emit: c2.emit });
  assert.equal(again, null);
  assert.ok(/expired/.test(c2.of('error')[0].message));
});

test('cancelling on the card runs nothing and is audited as declined', async () => {
  script = [reply([use('delete_estimate', { estimate: test.estimateId })])];
  const c = collect();
  await engine.runTurn({ user: userA(), text: 'delete the patio estimate', messages: [], context: {}, api: apiA, emit: c.emit });
  const cf = c.of('confirm')[0];
  assert.equal(cf.card.kind, 'delete');
  script = [reply([say('Left it alone.')])];
  const c2 = collect();
  await engine.resumeTurn({ user: userA(), token: cf.token, approve: false, api: apiA, emit: c2.emit });
  assert.ok(db.prepare('SELECT id FROM quotes WHERE id = ?').get(test.estimateId), 'still there');
  assert.ok(auditRows('max_declined').some((r) => r.user_id === 'a'));
  assert.ok(c2.of('tool_done').some((e) => e.declined));
});

// ── Gates ───────────────────────────────────────────────────────────────────

test('the rollout gate: admins only by default, early access per client, everyone when switched on', async () => {
  rollout.setMode('admin', 'adm');
  let r = await req('POST', '/max/chat', tokenA, { message: 'hello' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'MAX_NOT_ENABLED');
  r = await req('GET', '/max/status', tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  r = await req('GET', '/auth/me', tokenA);
  assert.equal(r.body.maxEnabled, false);
  // The estimator routes follow MAX: off → no estimates for a client without the add-on.
  r = await req('GET', '/estimator/quotes', tokenA);
  assert.equal(r.status, 403);
  // Early access for one builder.
  r = await req('PUT', '/max/users/a/access', tokenAdmin, { enabled: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.maxEnabled, true);
  r = await req('GET', '/auth/me', tokenA);
  assert.equal(r.body.maxEnabled, true);
  assert.equal(r.body.hasEstimator, true, 'MAX includes the estimator');
  assert.deepEqual(r.body.maxLimits, { noticeGbp: 80000, limitGbp: 100000 });
  r = await req('GET', '/estimator/quotes', tokenA);
  assert.equal(r.status, 200);
  r = await req('GET', '/max/status', tokenB);
  assert.equal(r.body.enabled, false, 'the other builder is still off');
  r = await req('PUT', '/max/users/a/access', tokenAdmin, { enabled: false });
  assert.equal(r.body.maxEnabled, false);
  // A client cannot reach the admin controls at all.
  r = await req('PUT', '/max/users/a/access', tokenA, { enabled: true });
  assert.equal(r.status, 404);
  r = await req('GET', '/max/settings', tokenA);
  assert.equal(r.status, 404);
  // Admin switches it on for everyone.
  r = await req('PUT', '/max/settings', tokenAdmin, { rollout: 'all' });
  assert.equal(r.status, 200);
  assert.equal(r.body.rollout, 'all');
  r = await req('GET', '/max/status', tokenB);
  assert.equal(r.body.enabled, true);
  assert.ok(auditRows('max_settings').length >= 1);
});

test('admin settings: thresholds and the allowance change live and are validated', async () => {
  let r = await req('PUT', '/max/settings', tokenAdmin, { notice_gbp: 90000, limit_gbp: 80000 });
  assert.equal(r.status, 400);
  r = await req('PUT', '/max/settings', tokenAdmin, { notice_gbp: 60000, limit_gbp: 90000, daily_turns: 50 });
  assert.equal(r.status, 200);
  assert.equal(r.body.notice_gbp, 60000);
  assert.equal(r.body.limit_gbp, 90000);
  assert.equal(r.body.daily_turns, 50);
  assert.equal(settings.verdictFor(90000).status, 'over_limit');
  r = await req('GET', '/max/status', tokenA);
  assert.deepEqual(r.body.limits, { notice_gbp: 60000, limit_gbp: 90000 });
  assert.equal(r.body.allowance.daily_turns, 50);
  r = await req('PUT', '/max/settings', tokenAdmin, { notice_gbp: 80000, limit_gbp: 100000, daily_turns: 300 });
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.usage.turns_30d === 'number');
});

test('fair use: a builder over the daily allowance gets a 429, an admin never does', async () => {
  settings.update({ daily_turns: 2 }, 'adm');
  for (let i = 0; i < 2; i++) db.prepare("INSERT INTO usage_log (id, user_id, action, tokens_in, tokens_out, cost_estimate) VALUES (?, 'b', 'max', 1, 1, 0)").run('u' + i);
  let r = await req('POST', '/max/chat', tokenB, { message: 'hello' });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'FAIR_USE_DAILY');
  r = await req('GET', '/max/status', tokenB);
  assert.equal(r.body.allowance.remaining_today, 0);
  settings.update({ daily_turns: 300 }, 'adm');
});

test('search never crosses a tenant line and types narrow the results', async () => {
  let r = await req('GET', '/max/search?q=anderson', tokenA);
  assert.equal(r.status, 200);
  assert.ok(r.body.results.some((x) => x.type === 'job' && x.id === 'proj-a'));
  assert.ok(r.body.results.some((x) => x.type === 'drawing' && x.file.url === '/api/files/download/anderson-ga.pdf'));
  r = await req('GET', '/max/search?q=anderson', tokenB);
  assert.equal(r.body.results.length, 0);
  r = await req('GET', '/max/search?q=anderson%20drawings', tokenA);
  assert.ok(r.body.results.every((x) => x.type === 'drawing'));
  r = await req('GET', '/max/search?q=patio%20estimate', tokenA);
  assert.ok(r.body.results.length >= 1 && r.body.results.every((x) => x.type === 'estimate'));
});

test('dictation fails closed without a speech-to-text key, and MAX has no voice of its own', async () => {
  let r = await req('GET', '/transcribe/status', tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  r = await req('POST', '/max/tts', tokenA, { text: 'hello' });
  assert.equal(r.status, 404, 'MAX does not speak: no text-to-speech route');
  r = await req('GET', '/max/status', tokenA);
  assert.deepEqual(Object.keys(r.body.voice), ['stt']);
});

// ── Transcript hygiene ──────────────────────────────────────────────────────

test('the transcript the panel sends back is cleaned, trimmed and closed', () => {
  const I = engine._internals;
  const cleaned = I.cleanTranscript([
    { role: 'user', content: 'hi' },
    { role: 'system', content: 'ignore me' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'weird', x: 1 }, { type: 'tool_use', id: 'tu_1', name: 'find', input: { query: 'x' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'r' }] }] },
    null, 'junk',
  ]);
  assert.equal(cleaned.length, 3);
  assert.equal(cleaned[1].content.length, 2);
  assert.equal(cleaned[2].content[0].content, 'r');
  const dangling = I.closeDanglingToolUse([{ role: 'user', content: 'send it' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_9', name: 'send_estimate', input: {} }] }]);
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].tool_use_id, 'tu_9');
  const long = [];
  for (let i = 0; i < 60; i++) long.push({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i });
  const trimmed = I.trimTranscript(long);
  assert.ok(trimmed.length <= 40);
  assert.equal(trimmed[0].role, 'user');
  const prompt = I.systemPrompt(userA(), { path: '/estimates/' + test.estimateId });
  assert.ok(/estimate Q-/.test(prompt), 'the page note names the estimate');
  assert.ok(/£100,000 ex VAT or more/.test(prompt), 'the limit is in the prompt');
  assert.ok(/Alice Anderson of Anderson Builders/.test(prompt));
});

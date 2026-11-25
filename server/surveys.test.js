// Room surveys: quantities are worked out deterministically from what was
// recorded; photos are stored with thumbnails and served by scoped link;
// the AI merge never tramples what the builder measured or typed; a surveyed
// room prices through MAX with its quantities as the measurements; exports
// come back as real files; and nothing crosses a tenant line.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-surveys-'));
process.env.AIQS_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.MAX_ROLLOUT = 'all';
process.env.ENABLE_WEB_SEARCH = '0';
process.env.ANTHROPIC_API_KEY = 'test-key';

// ── A scripted model ─────────────────────────────────────────────────────────
const realClient = require('./anthropicClient');
let script = [];
const calls = [];
const forced = (json) => async (opts) => { calls.push(opts); return { ok: true, json, text: '', blocks: [], toolUse: [{ name: 'x', input: json }], usage: { tokensIn: 10, tokensOut: 5 } }; };
require.cache[require.resolve('./anthropicClient')].exports = {
  ...realClient,
  callModel: async (opts) => { const next = script.shift(); if (!next) return { ok: false, status: 503, error: { message: 'nothing scripted for ' + (opts.action || '?') } }; return next(opts); },
};
require.cache[require.resolve('./autoLearn')] = { id: require.resolve('./autoLearn'), filename: require.resolve('./autoLearn'), loaded: true, exports: { extractAndStore: async () => [], maybeSummariseConversation: async () => null, retrieveRelevantSummaries: async () => [], formatSummariesForPrompt: () => '', ensureSchema() {} } };

const db = require('./database');
const express = require('express');
const { generateToken } = require('./auth');
const G = require('./surveyGeometry');
const vision = require('./surveyVision');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use('/api', require('./routes'));
app.use('/api', require('./chat'));
app.use('/api', require('./memoryRoutes'));
app.use('/api', require('./activityRoutes').router);
app.use('/api/estimator', require('./estimatorRoutes'));
app.use('/api/max', require('./maxRoutes'));
app.use('/api/surveys', require('./roomSurveyRoutes'));
const server = app.listen(0);
const PORT = server.address().port;

// Alice and Bob have the Visualiser (a complimentary grant); Cara has nothing
// beyond the rollout, which gives MAX but never the Visualiser.
for (const [id, email, name, overrides] of [['a', 'alice@t.t', 'Alice Anderson', '{"visualiser":true}'], ['b', 'bob@t.t', 'Bob Builder', '{"visualiser":true}'], ['c', 'cara@t.t', 'Cara Cole', null]]) {
  db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, role, country, feature_overrides) VALUES (?, ?, 'x', ?, 'Co', 'client', 'GB', ?)").run(id, email, name, overrides);
}
db.prepare("INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit) VALUES ('r1', 'a', 'decorating', 'emulsion_walls_two_coats', 'Mist and two coats to walls', 9.5, 'm²')").run();
const tokenA = generateToken({ id: 'a', email: 'alice@t.t', role: 'client' });
const tokenB = generateToken({ id: 'b', email: 'bob@t.t', role: 'client' });
const tokenC = generateToken({ id: 'c', email: 'cara@t.t', role: 'client' });

function req(method, url, token, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8')) : null;
    const r = http.request({ port: PORT, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': data.length } : {}), ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let parsed = null; try { parsed = buf.length ? JSON.parse(buf.toString('utf8')) : null; } catch (e) { parsed = buf; } resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw: buf }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
function multipart(fields, files) {
  const boundary = '----aiqs' + Date.now().toString(36);
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
  for (const f of files || []) parts.push(Buffer.concat([Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + f.field + '"; filename="' + f.name + '"\r\nContent-Type: ' + f.type + '\r\n\r\n'), f.data, Buffer.from('\r\n')]));
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } };
}
async function jpeg(w, h, color) {
  const sharp = require('sharp');
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
}

test.after(() => server.close());

// ── Geometry ─────────────────────────────────────────────────────────────────

test('a rectangular room: floor, walls net of openings, skirting less the doors', () => {
  const q = G.quantities({ shape: 'rectangular', length_m: 5, width_m: 4, height_m: 2.4, openings: JSON.stringify([{ kind: 'door', width_m: 0.8, height_m: 2, count: 1 }, { kind: 'window', width_m: 1.2, height_m: 1.2, count: 2 }]) });
  assert.equal(q.complete, true);
  assert.equal(q.floor_m2, 20);
  assert.equal(q.ceiling_m2, 20);
  assert.equal(q.perimeter_m, 18);
  assert.equal(q.wall_gross_m2, 43.2);
  assert.equal(q.openings_m2, 1.6 + 2.88);
  assert.equal(q.wall_net_m2, Math.round((43.2 - 4.48) * 100) / 100);
  assert.equal(q.skirting_m, 17.2, 'the door width comes off the skirting run');
  assert.equal(q.coving_m, 18);
  assert.equal(q.doors, 1); assert.equal(q.windows, 2);
  assert.equal(q.volume_m3, 48);
});

test('an L-shaped room keeps the perimeter of its bounding rectangle and loses the notch from the floor', () => {
  const q = G.quantities({ shape: 'l_shape', length_m: 6, width_m: 4, height_m: 2.5, notch_length_m: 2, notch_width_m: 1.5 });
  assert.equal(q.floor_m2, 21);
  assert.equal(q.perimeter_m, 20);
  assert.equal(q.wall_count, 6);
  assert.equal(q.wall_gross_m2, 50);
  const o = G.outlineOf({ shape: 'l_shape', length_m: 6, width_m: 4, notch_length_m: 2, notch_width_m: 1.5 });
  assert.equal(o.points.length, 6);
});

test('a custom (LiDAR) room uses its walls and stated floor area; an unmeasured room is incomplete', () => {
  const q = G.quantities({ shape: 'custom', height_m: 2.6, walls: JSON.stringify([{ length_m: 3 }, { length_m: 4 }, { length_m: 3 }, { length_m: 4 }]), floor_area_override_m2: 12 });
  assert.equal(q.perimeter_m, 14); assert.equal(q.floor_m2, 12); assert.equal(q.wall_gross_m2, 36.4);
  assert.equal(G.quantities({ shape: 'rectangular' }).complete, false);
});

test('openings are laid out along their walls without overlapping', () => {
  const layout = G.layoutOpenings({ shape: 'rectangular', length_m: 4, width_m: 3, openings: JSON.stringify([{ kind: 'window', width_m: 1, height_m: 1, count: 2, wall: 'A' }, { kind: 'door', width_m: 0.8, height_m: 2, count: 1 }]) });
  const onA = layout.filter((l) => l.wall === 'A');
  assert.equal(onA.length, 2);
  assert.ok(onA[0].to <= onA[1].from, 'the two windows do not overlap');
  assert.ok(layout.some((l) => l.opening.kind === 'door'), 'an unassigned door still lands on a wall');
});

test('the pricing brief states the quantities as ground truth', () => {
  const room = { name: 'Lounge', room_type: 'Living room', floor_level: 'Ground', shape: 'rectangular', length_m: 5, width_m: 4, height_m: 2.4, dims_source: 'stated', features: JSON.stringify([{ item: 'double socket', count: 6 }]), work_wanted: 'Full redecoration', openings: '[]' };
  const brief = G.describeForPricing(room, G.quantities(room), { address: '12 Oak Lane' });
  assert.ok(/ROOM SURVEY: Lounge/.test(brief));
  assert.ok(/Floor area 20 m²/.test(brief));
  assert.ok(/6 × double socket/.test(brief));
  assert.ok(/WORK TO PRICE \(price only this\): Full redecoration/.test(brief));
  assert.ok(/dimensions given by the builder/.test(brief));
});

// ── The API ──────────────────────────────────────────────────────────────────

test('a survey is created, a room added, its size typed, and the quantities come back', async () => {
  let r = await req('POST', '/surveys', tokenA, { title: '12 Oak Lane', address: '12 Oak Lane, Manchester M1 1AA', customer_name: 'Mrs Oak' });
  assert.equal(r.status, 201);
  test.surveyId = r.body.id;
  r = await req('POST', '/surveys/' + test.surveyId + '/rooms', tokenA, { name: 'Lounge', room_type: 'Living room', floor_level: 'Ground' });
  assert.equal(r.status, 201);
  test.roomId = r.body.room.id;
  assert.equal(r.body.room.status, 'draft');
  r = await req('PATCH', '/surveys/rooms/' + test.roomId, tokenA, { length_m: 5, width_m: 4, height_m: 2.4, openings: [{ kind: 'door', width_m: 0.8, height_m: 2, count: 1, wall: 'B' }], features: [{ item: 'radiator', count: 1, notes: '1200 double' }], work_wanted: 'Full redecoration — mist and two coats, new skirting' });
  assert.equal(r.status, 200);
  assert.equal(r.body.room.dims_source, 'stated', 'typing a size marks it stated');
  assert.equal(r.body.room.quantities.floor_m2, 20);
  assert.equal(r.body.room.openings[0].source, 'user');
  assert.equal(r.body.room.status, 'surveyed');
  r = await req('GET', '/surveys/' + test.surveyId, tokenA);
  assert.equal(r.body.totals.rooms, 1);
  assert.equal(r.body.totals.floor_m2, 20);
  assert.ok(r.body.photo_token);
});

test('photos upload with thumbnails and are served by a scoped link, but never to the other builder', async () => {
  const img = await jpeg(1200, 900, { r: 200, g: 180, b: 160 });
  const mp = multipart({ kind: 'corner' }, [{ field: 'photos', name: 'corner-1.jpg', type: 'image/jpeg', data: img }, { field: 'photos', name: 'corner-2.jpg', type: 'image/jpeg', data: img }]);
  let r = await req('POST', '/surveys/rooms/' + test.roomId + '/photos', tokenA, mp.body, mp.headers);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.photos.length, 2);
  const p = r.body.photos[0];
  assert.equal(p.kind, 'corner');
  assert.ok(p.width === 1200 && p.height === 900, 'dimensions read from the file');
  assert.ok(/\/api\/surveys\/photos\/.+\/thumb\?t=/.test(p.thumb_url));
  test.photoUrl = p.thumb_url;
  // The link works with no bearer token (an <img src>) …
  r = await req('GET', p.thumb_url.replace('/api', ''), null);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.ok(r.raw.length > 500 && r.raw.length < img.length, 'a thumbnail, smaller than the original');
  // … but not with a forged or missing one, even for a signed-in stranger.
  r = await req('GET', p.thumb_url.replace('/api', '').replace(/t=.*$/, 't=nope'), null);
  assert.equal(r.status, 401);
  r = await req('GET', p.file_url || p.url.replace('/api', '').replace(/\?t=.*$/, ''), tokenB);
  assert.equal(r.status, 404);
  r = await req('GET', '/surveys/' + test.surveyId, tokenB);
  assert.equal(r.status, 404);
  r = await req('GET', '/surveys/rooms/' + test.roomId, tokenB);
  assert.equal(r.status, 404);
  r = await req('GET', '/surveys', tokenB);
  assert.equal(r.body.surveys.length, 0);
});

test('the AI survey fills what is missing and leaves what the builder measured or typed alone', async () => {
  script = [forced({
    room_type: 'Living room', summary: 'A square-ish lounge in fair decorative order.', confidence: 'medium',
    dimensions: { length_m: 4.6, width_m: 3.9, height_m: 2.5, source: 'estimated', shape: 'rectangular' },
    assumptions: ['Door height 1.98 m used as the reference'],
    openings: [{ kind: 'window', width_m: 1.5, height_m: 1.3, count: 1, wall: 'A' }, { kind: 'door', width_m: 0.76, height_m: 1.98, count: 1, wall: 'B' }],
    features: [{ item: 'double socket', count: 5 }, { item: 'radiator', count: 1, notes: 'single panel' }, { item: 'ceiling light', count: 1 }],
    finishes: { floor: { type: 'laminate', condition: 'good' }, walls: { type: 'painted plaster', condition: 'fair', notes: 'some cracking by the window' } },
    hazards: ['Textured ceiling — possible Artex, test before sanding'],
    condition_notes: 'Walls need filling before painting.',
    photo_notes: [{ photo: 1, shows: 'Corner with the window', kind: 'corner' }, { photo: 2, shows: 'Door wall', kind: 'wall' }],
  })];
  const r = await req('POST', '/surveys/rooms/' + test.roomId + '/analyse', tokenA, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const room = r.body.room;
  assert.equal(room.length_m, 5, 'the stated length is kept');
  assert.equal(room.dims_source, 'stated');
  assert.equal(room.openings.filter((o) => o.source === 'user').length, 1, 'the builder\'s door stays');
  assert.ok(room.openings.some((o) => o.kind === 'window' && o.source === 'ai'), 'the AI\'s window is added');
  assert.ok(!room.openings.some((o) => o.kind === 'door' && o.source === 'ai'), 'the AI\'s door on the same wall is not duplicated');
  const rad = room.features.find((f) => /radiator/.test(f.item));
  assert.equal(rad.source, 'user'); assert.equal(rad.notes, '1200 double', 'the builder\'s radiator note wins');
  assert.ok(room.features.some((f) => f.item === 'double socket' && f.source === 'ai'));
  assert.equal(room.finishes.walls.condition, 'fair');
  assert.deepEqual(room.hazards, ['Textured ceiling — possible Artex, test before sanding']);
  assert.equal(room.ai_summary, 'A square-ish lounge in fair decorative order.');
  assert.ok(room.analysed_at);
  assert.equal(room.photos[0].ai_notes, 'Corner with the window');
  assert.equal(room.photos[1].kind, 'corner', 'the kind the builder chose is kept over the AI\'s');
  assert.equal(room.photos[1].ai_notes, 'Door wall');
  const sent = calls.at(-1);
  assert.ok(/GROUND TRUTH dimensions \(stated\): 5 m × 4 m/.test(JSON.stringify(sent.messages)), 'the model was told the stated size');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE event_type = 'survey_analysed' AND user_id = 'a'").get().n, 1);
});

test('a second analysis replaces the AI\'s earlier entries but keeps the builder\'s', async () => {
  script = [forced({ room_type: 'Living room', confidence: 'high', dimensions: { length_m: 4.6, width_m: 3.9, height_m: 2.5, source: 'estimated' }, openings: [{ kind: 'window', width_m: 1.8, height_m: 1.2, count: 2, wall: 'A' }], features: [{ item: 'double socket', count: 7 }], photo_notes: [] })];
  const r = await req('POST', '/surveys/rooms/' + test.roomId + '/analyse', tokenA, {});
  const room = r.body.room;
  const windows = room.openings.filter((o) => o.kind === 'window');
  assert.equal(windows.length, 1); assert.equal(windows[0].count, 2); assert.equal(windows[0].width_m, 1.8);
  assert.equal(room.features.find((f) => f.item === 'double socket').count, 7);
  assert.ok(room.features.some((f) => /radiator/.test(f.item) && f.source === 'user'));
  assert.ok(!room.features.some((f) => f.item === 'ceiling light'), 'an AI entry the AI no longer reports is gone');
});

test('pricing a surveyed room goes through MAX with the quantities as the measurements and links the estimate', async () => {
  script = [forced({
    project_name: 'Lounge redecoration', project_type: 'Refurbishment', confidence: 'high',
    items: [
      { section: 'Finishes', item: 'Mist and two coats to walls', description: 'Prepare and paint walls', unit: 'm2', qty: 38.4, working: 'from survey: wall net', key: 'emulsion_walls_two_coats' },
      { section: 'Finishes', item: 'Paint ceiling', description: 'Two coats to ceiling', unit: 'm2', qty: 20, working: 'from survey', key: null, assumed_rate: 7 },
      { section: 'Joinery', item: 'New skirting', description: 'Supply and fit MDF skirting', unit: 'm', qty: 17.2, working: 'from survey: skirting', key: null, assumed_rate: 14 },
    ],
    assumptions: ['Furniture moved by the customer'], exclusions: [], missing_info: [],
  })];
  const r = await req('POST', '/surveys/rooms/' + test.roomId + '/price', tokenA, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.estimate_created, true);
  assert.equal(r.body.cards[0].type, 'estimate');
  assert.equal(r.body.room.estimate_id, r.body.result.estimate_id);
  assert.equal(r.body.room.status, 'priced');
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(r.body.result.estimate_id);
  assert.equal(q.user_id, 'a');
  assert.equal(q.source, 'max');
  assert.equal(q.location, '12 Oak Lane, Manchester M1 1AA', 'the survey address sets the region');
  assert.equal(q.client_name, 'Mrs Oak');
  assert.equal(JSON.parse(q.max_meta).room_id, test.roomId);
  const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ?').all(q.id);
  assert.equal(lines.find((l) => /Mist and two coats/.test(l.item)).rate, 9.5, 'the builder\'s own rate priced the walls');
  const sent = calls.at(-1);
  const msg = JSON.stringify(sent.messages);
  assert.ok(/ROOM SURVEY: Lounge/.test(msg) && /Floor area 20 m²/.test(msg) && /WORK TO PRICE/.test(msg), 'the take-off was handed the survey quantities');
  const rr = await req('GET', '/surveys/rooms/' + test.roomId, tokenA);
  assert.equal(rr.body.estimate.quote_number, q.quote_number);
});

test('a job: the brief is kept, MAX prices the whole job from it and the measured rooms, and the estimate is linked', async () => {
  let r = await req('POST', '/surveys', tokenA, { address: '3 Mill Lane, Leeds LS1 1AA', customer_name: 'Mr Mill', brief: 'Full redecoration of the lounge: skim, two coats, new skirting', visualise: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, '3 Mill Lane, Leeds LS1 1AA', 'the address names the job');
  assert.equal(r.body.brief, 'Full redecoration of the lounge: skim, two coats, new skirting');
  assert.equal(r.body.visualise, 1);
  const sid = r.body.id;
  // The first room from the flow carries the brief as its work wanted.
  r = await req('POST', '/surveys/' + sid + '/rooms', tokenA, { name: 'Lounge', room_type: 'Living room', length_m: 5, width_m: 4, height_m: 2.4, work_wanted: 'Skim, two coats, new skirting' });
  assert.equal(r.status, 201);
  assert.equal(r.body.room.work_wanted, 'Skim, two coats, new skirting');
  r = await req('GET', '/surveys/rooms/' + r.body.room.id, tokenA);
  assert.equal(r.body.survey.visualise, true, 'the room page knows the job asked for the Visualiser');
  assert.ok(/Full redecoration/.test(r.body.survey.brief));
  // Priced as one job.
  script = [forced({
    project_name: 'Lounge redecoration', project_type: 'Refurbishment', confidence: 'high',
    items: [{ section: 'Finishes', item: 'Mist and two coats to walls', description: 'Prepare and paint walls', unit: 'm2', qty: 43.2, working: 'from survey: wall gross', key: 'emulsion_walls_two_coats' }],
    assumptions: [], exclusions: [], missing_info: [],
  })];
  r = await req('POST', '/surveys/' + sid + '/price', tokenA, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.estimate_created, true);
  assert.equal(r.body.survey.estimate_id, r.body.result.estimate_id, 'the estimate is linked to the job');
  assert.equal(r.body.estimate.id, r.body.result.estimate_id);
  const msg = JSON.stringify(calls.at(-1).messages);
  assert.ok(/WHAT NEEDS DONE \(price this\): Full redecoration/.test(msg), 'the brief leads the take-off');
  assert.ok(/ROOMS SURVEYED \(1\)/.test(msg) && /ROOM SURVEY: Lounge/.test(msg) && /Floor area 20 m²/.test(msg), 'the measured room follows with its quantities');
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(r.body.result.estimate_id);
  assert.equal(q.location, '3 Mill Lane, Leeds LS1 1AA');
  assert.equal(q.client_name, 'Mr Mill');
  assert.equal(JSON.parse(q.max_meta).survey_id, sid);
  r = await req('GET', '/surveys/' + sid, tokenA);
  assert.equal(r.body.estimate.quote_number, q.quote_number);
  r = await req('GET', '/surveys', tokenA);
  assert.equal(r.body.surveys.find((s) => s.id === sid).estimate_id, q.id, 'the list shows the job as priced');
  // A job with nothing said yet is refused plainly; another account cannot price it.
  const r2 = await req('POST', '/surveys', tokenA, { address: 'Nowhere Yet' });
  const p = await req('POST', '/surveys/' + r2.body.id + '/price', tokenA, {});
  assert.equal(p.status, 400);
  assert.ok(/what needs done/i.test(p.body.error));
  assert.equal((await req('POST', '/surveys/' + sid + '/price', tokenB, {})).status, 404);
  // The brief can be changed on the way in and is kept.
  script = [forced({ project_name: 'Lounge', project_type: 'Refurbishment', confidence: 'high', items: [{ section: 'Finishes', item: 'Paint ceiling', description: 'Two coats to the ceiling', unit: 'm2', qty: 20, working: 'ceiling', key: null, assumed_rate: 7 }], assumptions: [], exclusions: [], missing_info: [] })];
  r = await req('POST', '/surveys/' + sid + '/price', tokenA, { brief: 'Just the ceiling, two coats' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.survey.brief, 'Just the ceiling, two coats');
  assert.ok(/Just the ceiling/.test(JSON.stringify(calls.at(-1).messages)));
  await req('DELETE', '/surveys/' + r2.body.id, tokenA);
  await req('DELETE', '/surveys/' + sid, tokenA);
});

test('a room without a size or work wanted is refused for pricing with a plain reason', async () => {
  const r0 = await req('POST', '/surveys/' + test.surveyId + '/rooms', tokenA, { name: 'Box room' });
  let r = await req('POST', '/surveys/rooms/' + r0.body.room.id + '/price', tokenA, {});
  assert.equal(r.status, 400);
  assert.ok(/what work/i.test(r.body.error));
  r = await req('POST', '/surveys/rooms/' + r0.body.room.id + '/price', tokenA, { work_wanted: 'paint it' });
  assert.equal(r.status, 400);
  assert.ok(/no dimensions/i.test(r.body.error));
  await req('DELETE', '/surveys/rooms/' + r0.body.room.id, tokenA);
});

test('a RoomPlan capture imports as measured walls, openings and area', async () => {
  const transform = (x, z, deg) => { const a = deg * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 0, z, 1]; };
  const capture = {
    walls: [{ dimensions: [5, 2.4, 0.1], transform: transform(0, -2, 0) }, { dimensions: [5, 2.4, 0.1], transform: transform(0, 2, 0) }, { dimensions: [4, 2.4, 0.1], transform: transform(-2.5, 0, 90) }, { dimensions: [4, 2.4, 0.1], transform: transform(2.5, 0, 90) }],
    doors: [{ dimensions: [0.9, 2.0, 0.1], transform: transform(0, 2, 0) }], windows: [{ dimensions: [1.2, 1.1, 0.1], transform: transform(2.5, 0, 90) }], objects: [{ category: 'sofa' }, { category: 'washerDryer' }],
  };
  const r0 = await req('POST', '/surveys/' + test.surveyId + '/rooms', tokenA, { name: 'Kitchen' });
  const r = await req('POST', '/surveys/rooms/' + r0.body.room.id + '/roomplan', tokenA, { json: capture });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const room = r.body.room;
  assert.equal(room.shape, 'custom');
  assert.equal(room.dims_source, 'measured');
  assert.equal(room.walls.length, 4);
  assert.ok(Math.abs(room.quantities.floor_m2 - 20) < 0.5, 'floor area from the wall polygon: ' + room.quantities.floor_m2);
  assert.equal(room.quantities.perimeter_m, 18);
  assert.equal(room.quantities.doors, 1); assert.equal(room.quantities.windows, 1);
  assert.ok(room.features.some((f) => f.item === 'washer dryer' && f.source === 'measured'));
  assert.equal(room.has_capture, true);
  // The plan the sketch, the 3D view and the PDF draw from: every wall where
  // the scanner put it, the door and window on the walls they were found in.
  assert.ok(room.plan && room.plan.walls.length === 4, 'plan with four walls');
  assert.equal(room.plan.outline.length, 4, 'a closed four-corner outline');
  assert.ok(Math.abs(room.plan.bounds.w - 5) < 0.2 && Math.abs(room.plan.bounds.h - 4) < 0.2, 'bounds 5 × 4: ' + JSON.stringify(room.plan.bounds));
  assert.ok(room.plan.walls.every((w) => w.a && w.b && typeof w.a.x === 'number' && w.a.x >= 0 && w.a.y >= 0), 'wall ends in plan coordinates from the top-left');
  assert.equal(room.plan.walls.filter((w) => w.openings.some((o) => o.kind === 'door')).length, 1, 'the door sits on one wall');
  assert.ok(room.openings.every((o) => o.wall), 'imported openings carry the wall letter the scanner placed them on: ' + JSON.stringify(room.openings.map((o) => [o.kind, o.wall])));
  // Squared up and lettered clockwise from the top: A is the long top wall
  // running left to right, B the right wall, C the bottom (where the door is),
  // D the left. The window on the right wall is on B.
  assert.deepEqual(room.plan.walls.map((w) => w.label), ['A', 'B', 'C', 'D']);
  const A = room.plan.walls[0];
  assert.ok(A.length_m === 5 && A.a.y < 0.05 && A.b.y < 0.05 && A.a.x < A.b.x, 'A runs along the top, left to right: ' + JSON.stringify(A));
  assert.equal(room.openings.find((o) => o.kind === 'door').wall, 'C');
  assert.equal(room.openings.find((o) => o.kind === 'window').wall, 'B');
  assert.deepEqual(room.walls.map((w) => [w.label, w.length_m]), [['A', 5], ['B', 4], ['C', 5], ['D', 4]]);
  assert.deepEqual(room.outline.bounds, room.plan.bounds);
  const scene = G.sceneOf({ shape: 'custom', name: 'Kitchen', capture: JSON.stringify(capture) });
  assert.equal(scene.kind, 'plan'); assert.equal(scene.segments.length, 4); assert.equal(scene.objects.length, 0, 'objects without transforms are not drawn');
  const typed = G.sceneOf({ shape: 'rectangular', length_m: 4, width_m: 3, openings: [{ kind: 'door', width_m: 0.8, height_m: 2, wall: 'C' }] });
  assert.equal(typed.kind, 'outline'); assert.equal(typed.segments.length, 4); assert.equal(typed.segments[2].openings.length, 1);
  assert.ok(Math.abs(typed.centroid.x - 2) < 1e-9 && Math.abs(typed.centroid.y - 1.5) < 1e-9);
  const plan = await req('GET', '/surveys/' + test.surveyId + '/plan.pdf', tokenA);
  assert.equal(plan.status, 200);
  assert.equal(plan.headers['content-type'], 'application/pdf');
  const bad = await req('POST', '/surveys/rooms/' + r0.body.room.id + '/roomplan', tokenA, { json: { walls: [] } });
  assert.equal(bad.status, 400);

  // A room scanned before openings were placed on walls (measured openings
  // without a letter) gets them placed at startup, keeping anything the
  // builder added by hand and refreshing the LiDAR note.
  const stripped = room.openings.map((o) => ({ ...o, wall: null }));
  await req('PATCH', '/surveys/rooms/' + room.id, tokenA, { openings: [...stripped, { kind: 'window', width_m: 0.6, height_m: 0.6, source: 'user' }], assumptions: ['Measured by LiDAR scan (4 walls). Openings are listed without a wall letter — assign them on the plan if you want them drawn in place.', 'Customer wants the door moved.'] });
  let check = await req('GET', '/surveys/rooms/' + room.id, tokenA);
  assert.ok(check.body.room.openings.filter((o) => o.source === 'measured').every((o) => !o.wall), 'walls stripped for the test');
  assert.equal(require('./roomSurveyRoutes')._internals.resyncScannedRooms(), 1, 'one room brought back in step');
  check = await req('GET', '/surveys/rooms/' + room.id, tokenA);
  const measured = check.body.room.openings.filter((o) => o.source === 'measured');
  assert.equal(measured.length, 2); assert.ok(measured.every((o) => o.wall), 'measured openings back on their walls');
  assert.ok(check.body.room.openings.some((o) => o.source === 'user' && o.width_m === 0.6), 'the builder\'s own window kept');
  assert.ok(check.body.room.assumptions.some((a) => /placed on the walls/.test(a)) && check.body.room.assumptions.includes('Customer wants the door moved.'), JSON.stringify(check.body.room.assumptions));
  assert.equal(require('./roomSurveyRoutes')._internals.resyncScannedRooms(), 0, 'nothing left to resync');
});

test('a tilted scan is squared up: same walls, same letters, same openings', async () => {
  const transform = (x, z, deg) => { const a = deg * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 0, z, 1]; };
  // Rotate a RoomPlan transform about the vertical axis (column-major), then shift it.
  const tilt = (m, deg, dx, dz) => { const a = deg * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a); const out = m.slice(); for (let col = 0; col < 4; col++) { const x = m[col * 4]; const z = m[col * 4 + 2]; out[col * 4] = c * x + s * z; out[col * 4 + 2] = -s * x + c * z; } out[12] += dx; out[14] += dz; return out; };
  const T = (x, z, deg) => tilt(transform(x, z, deg), 37, 11.2, -4.6);
  const capture = {
    walls: [{ dimensions: [4, 2.4, 0.1], transform: T(2.5, 0, 90) }, { dimensions: [5, 2.4, 0.1], transform: T(0, 2, 0) }, { dimensions: [4, 2.4, 0.1], transform: T(-2.5, 0, 90) }, { dimensions: [5, 2.4, 0.1], transform: T(0, -2, 0) }],
    doors: [{ dimensions: [0.9, 2.0, 0.1], transform: T(0, 2, 0) }], windows: [{ dimensions: [1.2, 1.1, 0.1], transform: T(2.5, 0, 90) }],
    objects: [{ category: 'sofa', dimensions: [2, 0.8, 0.9], transform: T(-1, 1, 0) }],
  };
  const r0 = await req('POST', '/surveys/' + test.surveyId + '/rooms', tokenA, { name: 'Tilted' });
  const r = await req('POST', '/surveys/rooms/' + r0.body.room.id + '/roomplan', tokenA, { json: capture });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const room = r.body.room;
  assert.ok(Math.abs(room.plan.bounds.w - 5) < 0.05 && Math.abs(room.plan.bounds.h - 4) < 0.05, 'squared up to 5 × 4: ' + JSON.stringify(room.plan.bounds));
  assert.ok(Math.abs(room.quantities.floor_m2 - 20) < 0.5);
  assert.deepEqual(room.plan.walls.map((w) => [w.label, w.length_m]), [['A', 5], ['B', 4], ['C', 5], ['D', 4]]);
  const top = room.plan.walls[0];
  assert.ok(top.a.y < 0.05 && top.b.y < 0.05 && top.a.x < top.b.x, 'the long wall along the top: ' + JSON.stringify(top));
  assert.ok(room.plan.walls.every((w) => w.a.x > -0.01 && w.a.y > -0.01 && w.b.x > -0.01 && w.b.y > -0.01), 'everything in the top-left frame');
  // One wall of each pair is vertical, one horizontal, after the turn.
  for (const w of room.plan.walls) assert.ok(Math.abs(w.a.x - w.b.x) < 0.05 || Math.abs(w.a.y - w.b.y) < 0.05, 'wall ' + w.label + ' is square: ' + JSON.stringify([w.a, w.b]));
  assert.equal(room.openings.filter((o) => o.kind === 'door')[0].wall, 'C', 'the door is on the bottom wall whichever way the phone faced');
  assert.equal(room.openings.filter((o) => o.kind === 'window')[0].wall, 'B');
  assert.equal(room.plan.objects.length, 1);
  const sofa = room.plan.objects[0];
  assert.ok(sofa.centre.x > 0 && sofa.centre.x < 5 && sofa.centre.y > 0 && sofa.centre.y < 4, 'the sofa turned with the room: ' + JSON.stringify(sofa.centre));
  const pdf = await req('GET', '/surveys/' + test.surveyId + '/plan.pdf', tokenA);
  assert.equal(pdf.status, 200);
  await req('DELETE', '/surveys/rooms/' + room.id, tokenA);
});

test('a finished-room render: painted from a photo and the scope, kept with the room, counted against the month', async () => {
  const IR = require('./imageRender');
  const origRender = IR.renderRoom; const origConfigured = IR.isConfigured;
  const settings = require('./maxSettings');
  const sharp = require('sharp');
  try {
    // Without a key the button tells the truth and nothing is charged.
    IR.isConfigured = () => false;
    let r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, {});
    assert.equal(r.status, 503); assert.ok(/not switched on/i.test(r.body.error));
    // A scripted image service: what comes back is "the room, done".
    IR.isConfigured = () => true;
    const seen = [];
    IR.renderRoom = async ({ buffer, mime, width, height, prompt }) => {
      seen.push({ bytes: buffer.length, mime, width, height, prompt });
      return { buffer: await sharp({ create: { width: 640, height: 480, channels: 3, background: '#a8c0a0' } }).png().toBuffer(), model: 'stub-image', quality: 'medium', cost_usd: 0.07 };
    };
    const before = await req('GET', '/surveys/rooms/' + test.roomId, tokenA);
    const source = before.body.room.photos.find((p) => p.kind !== 'render');
    assert.ok(source, 'the room has a real photo to render from');
    assert.ok(before.body.render_allowance && before.body.render_allowance.monthly === 20 && before.body.render_allowance.used === 0, JSON.stringify(before.body.render_allowance));
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, { photo_id: source.id, instructions: 'grey tiles, walk-in shower' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.photo.kind, 'render');
    assert.equal(r.body.photo.render_of, source.id);
    assert.ok(/grey tiles, walk-in shower/.test(r.body.photo.render_prompt) && /camera position, lens and angle/.test(r.body.photo.render_prompt) && /UK-style sockets/.test(r.body.photo.render_prompt), 'the prompt carries the tweak and the guard rails');
    assert.ok(/Finished room — grey tiles/.test(r.body.photo.caption));
    assert.ok(r.body.photo.thumb_url && r.body.photo.url);
    assert.equal(r.body.allowance.used, 1); assert.equal(r.body.allowance.remaining, 19);
    assert.equal(seen.length, 1); assert.ok(seen[0].bytes > 100 && /image\//.test(seen[0].mime));
    assert.ok(/full redecoration|skim|coats/i.test(seen[0].prompt), 'the scope of work is what gets painted: ' + seen[0].prompt.slice(0, 120));
    // The render is served like any photo, with its thumbnail, and sits in the room's photo list.
    const file = await req('GET', '/surveys/photos/' + r.body.photo.id + '/thumb?t=' + encodeURIComponent(before.body.photo_token), null);
    assert.equal(file.status, 200); assert.equal(file.headers['content-type'], 'image/jpeg');
    const after = await req('GET', '/surveys/rooms/' + test.roomId, tokenA);
    assert.ok(after.body.room.photos.some((p) => p.id === r.body.photo.id && p.kind === 'render'));
    assert.equal(after.body.render_allowance.used, 1);
    // A render cannot be re-rendered, and its kind cannot be changed into a plain photo.
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, { photo_id: after.body.room.photos.find((p) => p.kind === 'render').id });
    assert.equal(r.status, 400);
    r = await req('PATCH', '/surveys/photos/' + after.body.room.photos.find((p) => p.kind === 'render').id, tokenA, { kind: 'wall', caption: 'Bathroom, done' });
    assert.equal(r.body.photo.kind, 'render'); assert.equal(r.body.photo.caption, 'Bathroom, done');
    // The monthly allowance holds: at the cap the next one is refused with a plain reason.
    settings.writeNumber('max_renders_per_month', 1, 'test');
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, { photo_id: source.id });
    assert.equal(r.status, 429); assert.ok(/this month/i.test(r.body.error));
    settings.writeNumber('max_renders_per_month', 0, 'test');
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, { photo_id: source.id });
    assert.equal(r.status, 403);
    settings.writeNumber('max_renders_per_month', 20, 'test');
    // Another account cannot render from this room's photo.
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenB, { photo_id: source.id });
    assert.equal(r.status, 404);
    // Without the Visualiser (no MAX + Visualiser plan, no grant) the render
    // is refused before anything else, and the room says so.
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenC, { photo_id: source.id });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'VISUALISER_REQUIRED');
    let own = await req('POST', '/surveys', tokenC, { title: 'Cara\'s flat' });
    own = await req('POST', '/surveys/' + own.body.id + '/rooms', tokenC, { name: 'Hall' });
    own = await req('GET', '/surveys/rooms/' + own.body.room.id, tokenC);
    assert.equal(own.body.max_enabled, true); assert.equal(own.body.visualiser, false); assert.equal(own.body.render_allowance.enabled, false);
    assert.equal(after.body.visualiser, true, 'Alice has it');
    // The status endpoint shows the allowance too.
    r = await req('GET', '/max/status', tokenA);
    assert.equal(r.body.renders.used, 1);
    // Asked for a stream, the same route sends progress, each rough pass as a
    // small data URL, then the finished photo.
    IR.renderRoom = async ({ onPartial }) => {
      const rough = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#777' } }).png().toBuffer();
      if (onPartial) { await onPartial(rough, 0); await onPartial(rough, 1); }
      return { buffer: await sharp({ create: { width: 640, height: 480, channels: 3, background: '#a8c0a0' } }).png().toBuffer(), model: 'stub-image', quality: 'high', cost_usd: 0.19 };
    };
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, { photo_id: source.id }, { Accept: 'text/event-stream' });
    assert.equal(r.status, 200); assert.ok(/text\/event-stream/.test(r.headers['content-type']));
    const events = r.raw.toString('utf8').split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    const partials = events.filter((e) => e.type === 'partial');
    assert.equal(partials.length, 2); assert.ok(/^data:image\/jpeg;base64,/.test(partials[0].b64)); assert.ok(partials[1].pct > partials[0].pct);
    const done = events.find((e) => e.type === 'done');
    assert.ok(done && done.photo.kind === 'render' && done.pct === 100 && Array.isArray(done.photos), 'the stream ends with the finished photo');
    assert.equal(done.allowance.used, 2);
    // A failure mid-stream is an event, not a dropped connection.
    IR.renderRoom = async () => { throw Object.assign(new Error('The image service would not edit that photo.'), { name: 'RenderError', status: 422 }); };
    r = await req('POST', '/surveys/rooms/' + test.roomId + '/render', tokenA, { photo_id: source.id }, { Accept: 'text/event-stream' });
    const errEvt = r.raw.toString('utf8').split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === 'error');
    assert.ok(errEvt && errEvt.status === 422 && /would not edit/.test(errEvt.error));
  } finally { IR.renderRoom = origRender; IR.isConfigured = origConfigured; }
});

test('notes, the report PDF and the Excel schedule', async () => {
  let r = await req('POST', '/surveys/rooms/' + test.roomId + '/notes', tokenA, { text: 'Customer wants the radiator moved to the window wall', source: 'voice' });
  assert.equal(r.status, 201);
  assert.equal(r.body.notes[0].source, 'voice');
  r = await req('GET', '/surveys/' + test.surveyId + '/report.pdf', tokenA);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/pdf');
  assert.ok(r.raw.length > 5000, 'a real document with pages and photos');
  r = await req('GET', '/surveys/' + test.surveyId + '/schedule.xlsx', tokenA);
  assert.equal(r.status, 200);
  assert.ok(/spreadsheetml/.test(r.headers['content-type']));
  assert.ok(r.raw.length > 2000);
  r = await req('GET', '/surveys/' + test.surveyId + '/report.pdf', tokenB);
  assert.equal(r.status, 404);
});

test('deleting a survey removes its rooms, photo rows and files', async () => {
  const files = db.prepare('SELECT filename, thumb_filename FROM survey_photos WHERE survey_id = ?').all(test.surveyId);
  assert.ok(files.length >= 2);
  const { photosDir } = require('./roomSurveyRoutes')._internals;
  assert.ok(fs.existsSync(path.join(photosDir, files[0].filename)));
  const r = await req('DELETE', '/surveys/' + test.surveyId, tokenA);
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM survey_rooms WHERE survey_id = ?').get(test.surveyId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM survey_photos WHERE survey_id = ?').get(test.surveyId).n, 0);
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(!fs.existsSync(path.join(photosDir, files[0].filename)), 'the file is gone too');
});

test('mergeAnalysis on an empty room takes the AI\'s dimensions as estimated', () => {
  const ai = vision.normalise({ room_type: 'Bathroom', dimensions: { length_m: 2.4, width_m: 2.1, height_m: 2.4, source: 'estimated' }, openings: [], features: [], confidence: 'low' });
  const out = vision.mergeAnalysis({ dims_source: 'unknown', openings: '[]', features: '[]' }, ai);
  assert.equal(out.length_m, 2.4); assert.equal(out.dims_source, 'estimated'); assert.equal(out.room_type, 'Bathroom');
});

test('Scan a room is part of MAX: without it every survey route is refused, with the plan it opens', async () => {
  const rollout = require('./maxRollout');
  const P = require('./maxPlans');
  rollout.setMode('admin', 'adm');
  try {
    let r = await req('GET', '/surveys', tokenC);
    assert.equal(r.status, 403); assert.equal(r.body.code, 'MAX_NOT_ENABLED');
    r = await req('POST', '/surveys', tokenC, { title: 'Nope' });
    assert.equal(r.status, 403);
    // A paid MAX plan opens it; the Visualiser is still the other package.
    P.activate(db.prepare('SELECT * FROM users WHERE id = ?').get('c'), { plan: 'max', interval: 'month', status: 'active', subscription_id: 'sub_c' });
    r = await req('GET', '/surveys', tokenC);
    assert.equal(r.status, 200);
    r = await req('GET', '/max/status', tokenC);
    assert.equal(r.body.enabled, true); assert.equal(r.body.renders.enabled, false); assert.equal(r.body.plan.plan, 'max');
    P.activate(db.prepare('SELECT * FROM users WHERE id = ?').get('c'), { plan: 'max_visualiser', interval: 'month', status: 'active', subscription_id: 'sub_c' });
    r = await req('GET', '/max/status', tokenC);
    assert.equal(r.body.renders.enabled, true);
    P.deactivate(db.prepare('SELECT * FROM users WHERE id = ?').get('c'), 'canceled');
    r = await req('GET', '/surveys', tokenC);
    assert.equal(r.status, 403, 'the plan ended');
  } finally { rollout.setMode('all', 'adm'); }
});

test('a render is painted from the photo the right way up, cropped to the frame the render comes back in', async () => {
  const sharp = require('sharp');
  const { renderInput } = require('./roomSurveyRoutes')._internals;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqs-render-in-'));
  // An iPhone photo: 1200 × 900 pixels stored, flagged to be shown turned — a portrait picture.
  const phone = path.join(dir, 'phone.jpg');
  fs.writeFileSync(phone, await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7a8' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
  let input = await renderInput(phone, { mime: 'image/jpeg', width: 1200, height: 900 }, sharp);
  assert.deepEqual([input.width, input.height, input.mime], [1024, 1536, 'image/jpeg'], 'portrait frame for a portrait picture');
  let meta = await sharp(input.buffer).metadata();
  assert.deepEqual([meta.width, meta.height, meta.orientation], [1024, 1536, undefined], 'upright pixels, no flag left to confuse the service');
  // A plain landscape photo: the wide frame, centre-cropped.
  const plain = path.join(dir, 'plain.jpg');
  fs.writeFileSync(plain, await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#88a' } }).jpeg().toBuffer());
  input = await renderInput(plain, { mime: 'image/jpeg', width: 1600, height: 1200 }, sharp);
  meta = await sharp(input.buffer).metadata();
  assert.deepEqual([input.width, input.height, meta.width, meta.height], [1536, 1024, 1536, 1024]);
  // Without sharp the file goes as it is.
  input = await renderInput(plain, { mime: 'image/jpeg', width: 1600, height: 1200 }, null);
  assert.deepEqual([input.width, input.height], [1600, 1200]);
  fs.rmSync(dir, { recursive: true, force: true });
});

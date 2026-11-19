// ═══════════════════════════════════════════════════════════════════════════════
// ROOM SURVEYS — server/roomSurveyRoutes.js   (mounted at /api/surveys)
//
// "Scan a room", done properly. A survey is one property visit; each room in
// it keeps its photographs, dimensions, openings, features, finishes,
// condition, notes and the quantities derived from them — so the builder can
// walk a house room by room on the phone, come back to it on the laptop, hand
// it to MAX to price, send it with the drawings, or give the customer a
// report.
//
//   Surveys    GET /, POST /, GET /:id, PATCH /:id, DELETE /:id
//   Rooms      POST /:id/rooms, GET /rooms/:roomId, PATCH /rooms/:roomId, DELETE /rooms/:roomId
//   Photos     POST /rooms/:roomId/photos (multipart photos[]), PATCH/DELETE /photos/:id,
//              GET /photos/:id/file|thumb?t=   (link-token, so <img src> works)
//   Notes      POST /rooms/:roomId/notes, DELETE /rooms/:roomId/notes/:noteId
//   AI         POST /rooms/:roomId/analyse   (MAX on for the account)
//              POST /rooms/:roomId/price     (MAX: the small-job pricer, quantities as ground truth)
//   LiDAR      POST /rooms/:roomId/roomplan  (Apple RoomPlan JSON: measured walls, openings)
//   Exports    GET /:id/report.pdf, GET /:id/schedule.xlsx, GET /:id/plan.pdf
//
// Every row carries user_id and every query is scoped to it.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, signLink, verifyLink } = require('./auth');
const rollout = require('./maxRollout');
const G = require('./surveyGeometry');

const router = express.Router();

const DATA_DIR = process.env.AIQS_DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data'));
const photosDir = path.join(DATA_DIR, 'room-surveys');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const MAX_PHOTOS_PER_ROOM = 24;
const LINK_TTL = 2 * 60 * 60;
const KINDS = ['corner', 'wall', 'floor', 'ceiling', 'detail', 'general'];
const JSON_COLS = ['walls', 'openings', 'features', 'finishes', 'hazards', 'assumptions', 'notes', 'quantities', 'capture'];

let _sharp;
function getSharp() { if (_sharp === undefined) { try { _sharp = require('sharp'); } catch (e) { _sharp = null; } } return _sharp; }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photosDir),
  filename: (req, file, cb) => cb(null, uuidv4() + ((path.extname(file.originalname || '') || '.jpg').toLowerCase().slice(0, 6))),
});
const upload = multer({ storage, limits: { fileSize: 12 * 1024 * 1024, files: 10 }, fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || '')) });
const uploadJson = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

const linkFor = (surveyId) => signLink('survey:' + surveyId, LINK_TTL);
const clean = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null);
const numOrNull = (v) => { if (v === '' || v == null) return null; const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

// ── Photo bytes: a link token in the query string, or a signed-in owner ──────
function photoAccess(req, res, next) {
  const photo = db.prepare('SELECT * FROM survey_photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).end();
  if (req.query.t && verifyLink(req.query.t, 'survey:' + photo.survey_id)) { req.photo = photo; return next(); }
  return authMiddleware(req, res, () => {
    if (!req.user || (req.user.id !== photo.user_id && req.user.role !== 'admin')) return res.status(404).end();
    req.photo = photo; next();
  });
}
function streamFile(res, filename, mime) {
  const fp = path.join(photosDir, path.basename(filename));
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.setHeader('Content-Type', mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const s = fs.createReadStream(fp);
  s.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
  s.pipe(res);
}
router.get('/photos/:id/file', photoAccess, (req, res) => streamFile(res, req.photo.filename, req.photo.mime));
router.get('/photos/:id/thumb', photoAccess, (req, res) => streamFile(res, req.photo.thumb_filename || req.photo.filename, req.photo.thumb_filename ? 'image/jpeg' : req.photo.mime));

router.use(authMiddleware);

// ── Row helpers ──────────────────────────────────────────────────────────────
function getSurvey(id, userId) { return db.prepare('SELECT * FROM room_surveys WHERE id = ? AND user_id = ?').get(id, userId); }
function getRoom(id, userId) { return db.prepare('SELECT * FROM survey_rooms WHERE id = ? AND user_id = ?').get(id, userId); }
function roomPhotos(roomId) { return db.prepare('SELECT * FROM survey_photos WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC').all(roomId); }
function surveyRooms(surveyId) { return db.prepare('SELECT * FROM survey_rooms WHERE survey_id = ? ORDER BY sort_order ASC, created_at ASC').all(surveyId); }

function statusOf(row, q) {
  if (row.estimate_id) return 'priced';
  if ((q && q.complete) || row.analysed_at) return 'surveyed';
  return 'draft';
}
function photoOut(p, token) {
  const t = token ? '?t=' + encodeURIComponent(token) : '';
  return { id: p.id, room_id: p.room_id, kind: p.kind || 'general', caption: p.caption || '', ai_notes: p.ai_notes || '', width: p.width, height: p.height, file_size: p.file_size, created_at: p.created_at, url: '/api/surveys/photos/' + p.id + '/file' + t, thumb_url: '/api/surveys/photos/' + p.id + '/thumb' + t };
}
function roomOut(row, photos, token, extra) {
  const q = G.quantities(row);
  const out = { ...row };
  for (const k of JSON_COLS) out[k] = G.parseJson(row[k], k === 'finishes' || k === 'capture' ? null : []);
  out.quantities = q;
  out.status = statusOf(row, q);
  out.has_capture = !!row.capture;
  // A scanned room carries its plan (walls in place, openings on them,
  // furniture) so the sketch and the 3D view can draw the real shape.
  out.plan = row.capture ? G.planFromCapture(G.parseJson(row.capture, null), row.name) : null;
  delete out.capture;
  out.photos = (photos || []).map((p) => photoOut(p, token));
  out.photo_count = out.photos.length;
  out.cover_thumb = out.photos.length ? out.photos[0].thumb_url : null;
  out.layout = G.layoutOpenings(row);
  out.outline = out.plan ? { points: out.plan.outline, bounds: out.plan.bounds } : G.outlineOf(row);
  return { ...out, ...(extra || {}) };
}
function surveyTotals(rooms) {
  const t = { rooms: rooms.length, floor_m2: 0, wall_net_m2: 0, ceiling_m2: 0, perimeter_m: 0, doors: 0, windows: 0, photos: 0, priced: 0, surveyed: 0 };
  for (const r of rooms) {
    const q = r.quantities || {};
    t.floor_m2 += q.floor_m2 || 0; t.wall_net_m2 += q.wall_net_m2 || 0; t.ceiling_m2 += q.ceiling_m2 || 0; t.perimeter_m += q.perimeter_m || 0;
    t.doors += q.doors || 0; t.windows += q.windows || 0; t.photos += r.photo_count || 0;
    if (r.status === 'priced') t.priced++; if (r.status !== 'draft') t.surveyed++;
  }
  for (const k of ['floor_m2', 'wall_net_m2', 'ceiling_m2', 'perimeter_m']) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}
function touchSurvey(id) { try { db.prepare('UPDATE room_surveys SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id); } catch (e) { /* fine */ } }

// Write a room's fields (JSON columns stringified), recompute the quantities, return the fresh row.
function saveRoom(row, fields) {
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    sets.push(k + ' = ?');
    vals.push(JSON_COLS.includes(k) ? (v == null ? null : JSON.stringify(v)) : v);
  }
  const merged = { ...row, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => [k, JSON_COLS.includes(k) && v != null ? JSON.stringify(v) : v])) };
  const q = G.quantities(merged);
  sets.push('quantities = ?'); vals.push(JSON.stringify(q));
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(row.id);
  db.prepare('UPDATE survey_rooms SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  touchSurvey(row.survey_id);
  return getRoom(row.id, row.user_id);
}

// ── Field sanitising for PATCH ───────────────────────────────────────────────
function cleanOpenings(list, defaultSource) {
  return (Array.isArray(list) ? list : []).slice(0, 30).map((o, i) => ({
    id: clean(o.id, 20) || 'op' + Date.now().toString(36) + i, kind: ['door', 'window', 'opening'].includes(o.kind) ? o.kind : 'opening',
    width_m: numOrNull(o.width_m) || 0, height_m: numOrNull(o.height_m) || 0, count: Math.max(1, Math.min(20, Math.round(G.num(o.count) || 1))),
    wall: G.WALL_LABELS.includes(String(o.wall || '').toUpperCase()) ? String(o.wall).toUpperCase() : null, notes: clean(o.notes, 120) || '', source: ['ai', 'measured', 'user'].includes(o.source) ? o.source : defaultSource,
  })).filter((o) => o.width_m > 0 && o.height_m > 0);
}
function cleanFeatures(list, defaultSource) {
  return (Array.isArray(list) ? list : []).slice(0, 60).map((f, i) => ({
    id: clean(f.id, 20) || 'ft' + Date.now().toString(36) + i, item: clean(f.item, 80) || '', count: Math.max(0, Math.min(999, Math.round(G.num(f.count)))), notes: clean(f.notes, 160) || '', source: ['ai', 'measured', 'user'].includes(f.source) ? f.source : defaultSource,
  })).filter((f) => f.item);
}
function cleanFinishes(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const k of ['floor', 'walls', 'ceiling', 'woodwork']) {
    const f = v[k];
    if (f && typeof f === 'object' && (f.type || f.condition || f.notes)) out[k] = { type: clean(f.type, 80) || '', condition: ['good', 'fair', 'poor'].includes(f.condition) ? f.condition : '', notes: clean(f.notes, 160) || '' };
  }
  return Object.keys(out).length ? { ...out, source: v.source === 'ai' ? 'ai' : 'user' } : null;
}
function cleanWalls(list) {
  return (Array.isArray(list) ? list : []).slice(0, 24).map((w, i) => ({ label: clean(w.label, 4) || G.WALL_LABELS[i] || String(i + 1), length_m: numOrNull(w.length_m) || 0, height_m: numOrNull(w.height_m) })).filter((w) => w.length_m > 0);
}
const strArray = (v, n, len) => (Array.isArray(v) ? v.map((s) => clean(s, len)).filter(Boolean).slice(0, n) : undefined);

function roomFieldsFrom(b, userId) {
  const f = {};
  if ('name' in b) f.name = clean(b.name, 80) || 'Room';
  if ('room_type' in b) f.room_type = clean(b.room_type, 60);
  if ('floor_level' in b) f.floor_level = clean(b.floor_level, 40);
  if ('shape' in b) f.shape = ['rectangular', 'l_shape', 'custom'].includes(b.shape) ? b.shape : 'rectangular';
  for (const k of ['length_m', 'width_m', 'height_m', 'notch_length_m', 'notch_width_m', 'floor_area_override_m2']) if (k in b) f[k] = numOrNull(b[k]);
  if ('dims_source' in b) f.dims_source = ['measured', 'stated', 'estimated', 'unknown'].includes(b.dims_source) ? b.dims_source : 'stated';
  if ('walls' in b) f.walls = cleanWalls(b.walls);
  if ('openings' in b) f.openings = cleanOpenings(b.openings, 'user');
  if ('features' in b) f.features = cleanFeatures(b.features, 'user');
  if ('finishes' in b) f.finishes = cleanFinishes(b.finishes);
  if ('hazards' in b) f.hazards = strArray(b.hazards, 12, 160) || [];
  if ('assumptions' in b) f.assumptions = strArray(b.assumptions, 12, 240) || [];
  if ('condition_notes' in b) f.condition_notes = clean(b.condition_notes, 2000);
  if ('work_wanted' in b) f.work_wanted = clean(b.work_wanted, 1000);
  if ('sort_order' in b) f.sort_order = Math.max(0, Math.round(G.num(b.sort_order)));
  if ('estimate_id' in b) {
    const id = b.estimate_id ? String(b.estimate_id) : null;
    f.estimate_id = id && db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(id, userId) ? id : null;
  }
  return f;
}

// ── Surveys ──────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM room_surveys WHERE user_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 300").all(req.user.id);
    const out = rows.map((s) => {
      const token = linkFor(s.id);
      const rooms = surveyRooms(s.id).map((r) => { const q = G.parseJson(r.quantities, null) || G.quantities(r); const n = db.prepare('SELECT COUNT(*) AS c FROM survey_photos WHERE room_id = ?').get(r.id).c; return { quantities: q, status: statusOf(r, q), photo_count: n, name: r.name }; });
      const cover = db.prepare('SELECT * FROM survey_photos WHERE survey_id = ? ORDER BY created_at ASC LIMIT 1').get(s.id);
      return { ...s, totals: surveyTotals(rooms), room_names: rooms.map((r) => r.name).slice(0, 6), cover_thumb: cover ? photoOut(cover, token).thumb_url : null };
    });
    res.json({ surveys: out });
  } catch (err) { console.error('[Surveys] list error:', err); res.status(500).json({ error: 'Could not load your surveys.' }); }
});

router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const id = uuidv4();
    let projectId = null;
    if (b.project_id && db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(String(b.project_id), req.user.id)) projectId = String(b.project_id);
    const title = clean(b.title, 120) || clean(b.address, 120) || 'Survey ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    db.prepare('INSERT INTO room_surveys (id, user_id, title, address, customer_name, customer_email, project_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, title, clean(b.address, 200), clean(b.customer_name, 120), clean(b.customer_email, 200), projectId, clean(b.notes, 2000));
    res.status(201).json({ id, ...getSurvey(id, req.user.id) });
  } catch (err) { console.error('[Surveys] create error:', err); res.status(500).json({ error: 'Could not start the survey.' }); }
});

router.get('/:id', (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const token = linkFor(s.id);
    const rooms = surveyRooms(s.id).map((r) => roomOut(r, roomPhotos(r.id), token));
    res.json({ survey: s, rooms, totals: surveyTotals(rooms), photo_token: token });
  } catch (err) { console.error('[Surveys] get error:', err); res.status(500).json({ error: 'Could not open that survey.' }); }
});

router.patch('/:id', (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const b = req.body || {};
    const sets = []; const vals = [];
    const put = (k, v) => { sets.push(k + ' = ?'); vals.push(v); };
    if ('title' in b) put('title', clean(b.title, 120) || s.title);
    if ('address' in b) put('address', clean(b.address, 200));
    if ('customer_name' in b) put('customer_name', clean(b.customer_name, 120));
    if ('customer_email' in b) put('customer_email', clean(b.customer_email, 200));
    if ('notes' in b) put('notes', clean(b.notes, 2000));
    if ('status' in b && ['open', 'complete', 'archived'].includes(b.status)) put('status', b.status);
    if ('project_id' in b) put('project_id', b.project_id && db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(String(b.project_id), req.user.id) ? String(b.project_id) : null);
    if (sets.length) { put('updated_at', new Date().toISOString().replace('T', ' ').slice(0, 19)); vals.push(s.id); db.prepare('UPDATE room_surveys SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals); }
    res.json({ survey: getSurvey(s.id, req.user.id) });
  } catch (err) { console.error('[Surveys] patch error:', err); res.status(500).json({ error: 'Could not save the survey.' }); }
});

function deletePhotoFiles(photos) { for (const p of photos) { for (const f of [p.filename, p.thumb_filename]) if (f) fs.unlink(path.join(photosDir, path.basename(f)), () => {}); } }

router.delete('/:id', (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const photos = db.prepare('SELECT * FROM survey_photos WHERE survey_id = ?').all(s.id);
    db.transaction(() => {
      db.prepare('DELETE FROM survey_photos WHERE survey_id = ?').run(s.id);
      db.prepare('DELETE FROM survey_rooms WHERE survey_id = ?').run(s.id);
      db.prepare('DELETE FROM room_surveys WHERE id = ?').run(s.id);
    })();
    deletePhotoFiles(photos);
    res.json({ ok: true });
  } catch (err) { console.error('[Surveys] delete error:', err); res.status(500).json({ error: 'Could not delete the survey.' }); }
});

// ── Rooms ────────────────────────────────────────────────────────────────────
router.post('/:id/rooms', (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const b = req.body || {};
    const id = uuidv4();
    const count = db.prepare('SELECT COUNT(*) AS c FROM survey_rooms WHERE survey_id = ?').get(s.id).c;
    const f = roomFieldsFrom(b, req.user.id);
    const name = f.name || clean(b.room_type, 60) || 'Room ' + (count + 1);
    db.prepare('INSERT INTO survey_rooms (id, survey_id, user_id, name, room_type, floor_level, shape, length_m, width_m, height_m, dims_source, openings, features, notes, sort_order, quantities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, s.id, req.user.id, name, f.room_type || null, f.floor_level || null, f.shape || 'rectangular', f.length_m ?? null, f.width_m ?? null, f.height_m ?? null, f.length_m && f.width_m ? (f.dims_source || 'stated') : 'unknown', JSON.stringify(f.openings || []), JSON.stringify(f.features || []), '[]', count, '{}');
    const row = saveRoom(getRoom(id, req.user.id), {});
    res.status(201).json({ room: roomOut(row, [], linkFor(s.id)) });
  } catch (err) { console.error('[Surveys] room create error:', err); res.status(500).json({ error: 'Could not add the room.' }); }
});

router.get('/rooms/:roomId', (req, res) => {
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) return res.status(404).json({ error: 'Room not found.' });
    const s = getSurvey(r.survey_id, req.user.id);
    const token = linkFor(r.survey_id);
    const room = roomOut(r, roomPhotos(r.id), token);
    const brief = G.describeForPricing(r, room.quantities, s);
    let estimate = null;
    if (r.estimate_id) { try { estimate = db.prepare('SELECT id, quote_number, status, grand_total, net_total FROM quotes WHERE id = ? AND user_id = ?').get(r.estimate_id, req.user.id) || null; } catch (e) { estimate = null; } }
    res.json({ room, survey: s ? { id: s.id, title: s.title, address: s.address, customer_name: s.customer_name, customer_email: s.customer_email, project_id: s.project_id } : null, pricing_brief: brief, estimate, photo_token: token, max_enabled: rollout.isEnabledFor(req.user) });
  } catch (err) { console.error('[Surveys] room get error:', err); res.status(500).json({ error: 'Could not open that room.' }); }
});

router.patch('/rooms/:roomId', (req, res) => {
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) return res.status(404).json({ error: 'Room not found.' });
    const f = roomFieldsFrom(req.body || {}, req.user.id);
    // Typing a size marks it stated unless the caller says otherwise.
    if ((f.length_m != null || f.width_m != null || f.height_m != null) && !('dims_source' in f) && r.dims_source !== 'measured') f.dims_source = 'stated';
    const row = saveRoom(r, f);
    res.json({ room: roomOut(row, roomPhotos(row.id), linkFor(row.survey_id)) });
  } catch (err) { console.error('[Surveys] room patch error:', err); res.status(500).json({ error: 'Could not save the room.' }); }
});

router.delete('/rooms/:roomId', (req, res) => {
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) return res.status(404).json({ error: 'Room not found.' });
    const photos = roomPhotos(r.id);
    db.transaction(() => { db.prepare('DELETE FROM survey_photos WHERE room_id = ?').run(r.id); db.prepare('DELETE FROM survey_rooms WHERE id = ?').run(r.id); })();
    deletePhotoFiles(photos);
    touchSurvey(r.survey_id);
    res.json({ ok: true });
  } catch (err) { console.error('[Surveys] room delete error:', err); res.status(500).json({ error: 'Could not delete the room.' }); }
});

// ── Photos ───────────────────────────────────────────────────────────────────
function handleUpload(req, res, next) {
  upload.array('photos', 10)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That photo is too big (12 MB max) — try again.' });
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Add up to 10 photos at a time.' });
      console.error('[Surveys] upload error:', err);
      return res.status(400).json({ error: 'Could not save the photos.' });
    }
    next();
  });
}

async function makeThumb(file) {
  const sharp = getSharp();
  if (!sharp) return { thumb: null, width: null, height: null };
  try {
    const img = sharp(file.path).rotate();
    const meta = await img.metadata();
    const thumbName = path.basename(file.filename, path.extname(file.filename)) + '-thumb.jpg';
    await img.resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(path.join(photosDir, thumbName));
    return { thumb: thumbName, width: meta.width || null, height: meta.height || null };
  } catch (e) { return { thumb: null, width: null, height: null }; }
}

router.post('/rooms/:roomId/photos', handleUpload, async (req, res) => {
  const files = req.files || [];
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) { for (const f of files) fs.unlink(f.path, () => {}); return res.status(404).json({ error: 'Room not found.' }); }
    if (!files.length) return res.status(400).json({ error: 'No photos received — try again.' });
    const have = db.prepare('SELECT COUNT(*) AS c FROM survey_photos WHERE room_id = ?').get(r.id).c;
    if (have + files.length > MAX_PHOTOS_PER_ROOM) { for (const f of files) fs.unlink(f.path, () => {}); return res.status(400).json({ error: 'A room holds up to ' + MAX_PHOTOS_PER_ROOM + ' photos.' }); }
    const kind = KINDS.includes(req.body && req.body.kind) ? req.body.kind : 'general';
    const caption = clean(req.body && req.body.caption, 300);
    const ins = db.prepare('INSERT INTO survey_photos (id, room_id, survey_id, user_id, filename, thumb_filename, mime, file_size, width, height, kind, caption, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const created = [];
    let order = have;
    for (const f of files) {
      const t = await makeThumb(f);
      const id = uuidv4();
      ins.run(id, r.id, r.survey_id, req.user.id, f.filename, t.thumb, f.mimetype || 'image/jpeg', f.size || 0, t.width, t.height, kind, caption, order++);
      created.push(id);
    }
    touchSurvey(r.survey_id);
    const token = linkFor(r.survey_id);
    res.status(201).json({ photos: roomPhotos(r.id).map((p) => photoOut(p, token)), added: created });
  } catch (err) { console.error('[Surveys] photo save error:', err); res.status(500).json({ error: 'Could not save the photos.' }); }
});

router.patch('/photos/:id', (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM survey_photos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Photo not found.' });
    const b = req.body || {};
    const sets = []; const vals = [];
    if ('caption' in b) { sets.push('caption = ?'); vals.push(clean(b.caption, 300)); }
    if ('kind' in b && KINDS.includes(b.kind)) { sets.push('kind = ?'); vals.push(b.kind); }
    if ('sort_order' in b) { sets.push('sort_order = ?'); vals.push(Math.max(0, Math.round(G.num(b.sort_order)))); }
    if (sets.length) { vals.push(p.id); db.prepare('UPDATE survey_photos SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals); }
    res.json({ photo: photoOut(db.prepare('SELECT * FROM survey_photos WHERE id = ?').get(p.id), linkFor(p.survey_id)) });
  } catch (err) { console.error('[Surveys] photo patch error:', err); res.status(500).json({ error: 'Could not update the photo.' }); }
});

router.delete('/photos/:id', (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM survey_photos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!p) return res.status(404).json({ error: 'Photo not found.' });
    db.prepare('DELETE FROM survey_photos WHERE id = ?').run(p.id);
    deletePhotoFiles([p]);
    touchSurvey(p.survey_id);
    res.json({ ok: true });
  } catch (err) { console.error('[Surveys] photo delete error:', err); res.status(500).json({ error: 'Could not delete the photo.' }); }
});

// ── Notes (typed or dictated) ────────────────────────────────────────────────
router.post('/rooms/:roomId/notes', (req, res) => {
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) return res.status(404).json({ error: 'Room not found.' });
    const text = clean(req.body && req.body.text, 1500);
    if (!text) return res.status(400).json({ error: 'Nothing to note.' });
    const notes = G.parseJson(r.notes, []) || [];
    notes.push({ id: 'n' + Date.now().toString(36), text, at: new Date().toISOString(), source: req.body.source === 'voice' ? 'voice' : 'typed' });
    const row = saveRoom(r, { notes: notes.slice(-60) });
    res.status(201).json({ notes: G.parseJson(row.notes, []) });
  } catch (err) { console.error('[Surveys] note error:', err); res.status(500).json({ error: 'Could not save the note.' }); }
});
router.delete('/rooms/:roomId/notes/:noteId', (req, res) => {
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) return res.status(404).json({ error: 'Room not found.' });
    const notes = (G.parseJson(r.notes, []) || []).filter((n) => n.id !== req.params.noteId);
    const row = saveRoom(r, { notes });
    res.json({ notes: G.parseJson(row.notes, []) });
  } catch (err) { res.status(500).json({ error: 'Could not delete the note.' }); }
});

// ── AI: survey the room from its photos ──────────────────────────────────────
function fairUse(req, res, next) { try { return require('./maxRoutes')._internals.fairUse(req, res, next); } catch (e) { return next(); } }

router.post('/rooms/:roomId/analyse', rollout.requireMax, fairUse, async (req, res) => {
  try {
    const r = getRoom(req.params.roomId, req.user.id);
    if (!r) return res.status(404).json({ error: 'Room not found.' });
    const s = getSurvey(r.survey_id, req.user.id);
    const photoRows = roomPhotos(r.id);
    const photos = photoRows.map((p) => { const fp = path.join(photosDir, path.basename(p.filename)); return fs.existsSync(fp) ? { id: p.id, buffer: fs.readFileSync(fp), mime: p.mime || 'image/jpeg', kind: p.kind, caption: p.caption } : null; }).filter(Boolean).slice(0, 12);
    if (!photos.length) return res.status(400).json({ error: 'Add a few photos of the room first — two from opposite corners works best.' });
    // Anything the builder typed on the request lands first, so the model sees it.
    const pre = roomFieldsFrom(req.body || {}, req.user.id);
    const base = Object.keys(pre).length ? saveRoom(r, pre) : r;
    const vision = require('./surveyVision');
    const ai = await vision.analyseRoom({ user: req.user, room: base, survey: s, photos });
    const fields = vision.mergeAnalysis(base, ai);
    fields.analysed_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const row = saveRoom(base, fields);
    // What each photo shows, back onto the photo rows.
    const upd = db.prepare('UPDATE survey_photos SET ai_notes = ?, kind = CASE WHEN kind = ? THEN ? ELSE kind END WHERE id = ?');
    for (const pn of ai.photo_notes) { const p = photos[pn.photo - 1]; if (p) upd.run(pn.shows, 'general', pn.kind || 'general', p.id); }
    try { require('./activityRoutes').logActivity({ event_type: 'survey_analysed', title: 'Room surveyed by AI: ' + (row.name || 'Room'), detail: JSON.stringify({ room_id: row.id, survey_id: row.survey_id, photos: photos.length, confidence: ai.confidence }), user_id: req.user.id, user_name: req.user.full_name, user_email: req.user.email }); } catch (e) { /* audit only */ }
    res.json({ room: roomOut(row, roomPhotos(row.id), linkFor(row.survey_id)), analysis: { confidence: ai.confidence, summary: ai.summary } });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Surveys] analyse error:', err);
    res.status(500).json({ error: 'Could not survey the room just now.' });
  }
});

// ── AI: price the room through MAX's small-job pricer ────────────────────────
router.post('/rooms/:roomId/price', rollout.requireMax, fairUse, async (req, res) => {
  try {
    const r0 = getRoom(req.params.roomId, req.user.id);
    if (!r0) return res.status(404).json({ error: 'Room not found.' });
    const work = clean(req.body && req.body.work_wanted, 1000) || r0.work_wanted;
    if (!work) return res.status(400).json({ error: 'Say what work you want priced in this room — e.g. "full redecoration, skim and two coats".' });
    const r = work !== r0.work_wanted ? saveRoom(r0, { work_wanted: work }) : r0;
    const engine = require('./maxEngine');
    const MI = require('./maxRoutes')._internals;
    const api = engine.makeApi({ baseUrl: MI.loopbackBase(req), headers: MI.forwardedHeaders(req) });
    const tool = engine.TOOL_INDEX.price_small_job;
    const ctx = { user: req.user, context: { path: '/surveys/' + r.survey_id + '/rooms/' + r.id }, audit: { ip: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) } };
    const out = await tool.run({ room_id: r.id, description: clean(req.body && req.body.extra, 600) || '' }, api, ctx);
    if (out.result && out.result.error) return res.status(400).json({ error: out.result.error });
    if (out.result && !out.result.over_limit) {
      try { require('./activityRoutes').logActivity({ event_type: 'max_action', title: out.summary || 'Priced a surveyed room', detail: JSON.stringify({ tool: 'price_small_job', room_id: r.id, estimate_id: out.result.estimate_id }), user_id: req.user.id, user_name: req.user.full_name, user_email: req.user.email }); } catch (e) { /* audit only */ }
    }
    const fresh = getRoom(r.id, req.user.id);
    res.json({ result: out.result, cards: out.cards || [], path: out.path || null, room: roomOut(fresh, roomPhotos(fresh.id), linkFor(fresh.survey_id)) });
  } catch (err) {
    console.error('[Surveys] price error:', err);
    res.status(500).json({ error: err && err.message ? err.message : 'Could not price the room just now.' });
  }
});

// ── LiDAR: an Apple RoomPlan capture → measured walls and openings ───────────
function importRoomPlan(raw, room) {
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error("Couldn't read that file — export the scan as RoomPlan JSON and try again."), { status: 400 });
  const pick = (names) => { for (const n of names) { const v = raw[n] || (raw.capturedRoom && raw.capturedRoom[n]) || (raw.room && raw.room[n]); if (Array.isArray(v)) return v; } return []; };
  const dimsOf = (x) => { const d = x && (x.dimensions || x.dimension || x.size); if (Array.isArray(d) && d.length >= 2) return d.map(G.num); if (d && typeof d === 'object') return [G.num(d.x ?? d.width), G.num(d.y ?? d.height), G.num(d.z ?? d.depth)]; return null; };
  const wallDims = pick(['walls']).map(dimsOf).filter(Boolean);
  if (!wallDims.length) throw Object.assign(new Error('No walls found in that file — it needs to be a RoomPlan JSON export.'), { status: 400 });
  // The squared-up plan (longest wall along the top, walls lettered clockwise
  // from it) is the one source for the wall list, the openings' wall letters
  // and what the sketch, the 3D view and the report draw.
  let walls = []; let floorArea = 0; let height = 0; let bounds = null; let plan = null;
  try {
    plan = G.planFromCapture(raw, room.name || 'Room');
    if (plan && plan.walls.length) {
      walls = plan.walls.map((w) => ({ label: w.label, length_m: w.length_m, height_m: w.height_m }));
      floorArea = plan.floor_m2; height = plan.height_m;
      bounds = { w: plan.bounds.w, h: plan.bounds.h };
    } else plan = null;
  } catch (e) { walls = []; plan = null; }
  if (!walls.length) {
    // Dimensions only (no transforms): lengths and a rectangular assumption.
    walls = wallDims.filter((w) => w[0] > 0.1).map((w, i) => ({ label: G.WALL_LABELS[i] || String(i + 1), length_m: Math.round(w[0] * 100) / 100, height_m: Math.round((w[1] || 2.4) * 100) / 100 }));
    height = Math.max(...wallDims.map((w) => w[1] || 0), 0) || 2.4;
    const widths = walls.map((w) => w.length_m).sort((a, b) => b - a);
    const per = widths.reduce((s, x) => s + x, 0);
    const L = widths[0] || 0; const W = per / 2 - L > 0.1 ? per / 2 - L : (widths[1] || L);
    floorArea = L * W; bounds = { w: L, h: W };
  }
  // Doors and windows on the walls the scanner saw them in (the plan matched
  // each to its nearest wall); any it could not place are kept without a wall.
  const openings = [];
  const push = (kind, w, h, wall) => openings.push({ id: 'op' + (openings.length + 1), kind, width_m: Math.round(w * 100) / 100, height_m: Math.round(h * 100) / 100, count: 1, wall: wall || null, notes: '', source: 'measured' });
  if (plan) plan.walls.forEach((w) => (w.openings || []).forEach((o) => push(o.kind, o.width_m, o.height_m, w.label)));
  for (const [kind, key] of [['door', 'doors'], ['window', 'windows'], ['opening', 'openings']]) {
    const all = pick([key]).map(dimsOf).filter(Boolean);
    const placed = openings.filter((o) => o.kind === kind).length;
    for (const d of all.slice(placed)) push(kind, d[0], d[1], null);
  }
  const counts = {};
  for (const o of pick(['objects'])) { const cat = String((o && (o.category || o.type || o.label)) || '').replace(/([A-Z])/g, ' $1').trim().toLowerCase() || 'object'; counts[cat] = (counts[cat] || 0) + 1; }
  const features = Object.entries(counts).map(([item, count], i) => ({ id: 'ft-m' + i, item, count, notes: 'seen by the scanner', source: 'measured' }));
  return {
    shape: 'custom', walls, floor_area_override_m2: Math.round(floorArea * 100) / 100, height_m: Math.round(height * 100) / 100,
    length_m: bounds ? Math.round(bounds.w * 100) / 100 : null, width_m: bounds ? Math.round(bounds.h * 100) / 100 : null,
    dims_source: 'measured', openings, features, capture: raw,
    assumptions: ['Measured by LiDAR scan (' + walls.length + ' walls' + (plan ? ', doors and windows placed on the walls the scanner saw them in' : '') + ').'],
  };
}

router.post('/rooms/:roomId/roomplan', (req, res) => {
  uploadJson.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Could not read that file.' });
    try {
      const r = getRoom(req.params.roomId, req.user.id);
      if (!r) return res.status(404).json({ error: 'Room not found.' });
      let raw = null;
      if (req.file) { try { raw = JSON.parse(req.file.buffer.toString('utf8')); } catch (e) { raw = null; } }
      else if (req.body && typeof req.body.json === 'object') raw = req.body.json;
      else if (req.body && typeof req.body.json === 'string') { try { raw = JSON.parse(req.body.json); } catch (e) { raw = null; } }
      const fields = importRoomPlan(raw, r);
      // Keep the builder's own features alongside what the scanner saw.
      const own = (G.parseJson(r.features, []) || []).filter((f) => f.source === 'user' || f.source === 'ai');
      fields.features = [...own, ...fields.features];
      const row = saveRoom(r, fields);
      res.json({ room: roomOut(row, roomPhotos(row.id), linkFor(row.survey_id)) });
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ error: e.message });
      console.error('[Surveys] roomplan error:', e);
      res.status(500).json({ error: 'Could not read the scan.' });
    }
  });
});

// ── Exports ──────────────────────────────────────────────────────────────────
function brandingFor(userId) {
  let row = null;
  try { row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId); } catch (e) { row = null; }
  return row || { primary_colour: '#1B2A4A', accent_colour: '#F59E0B', company_name: null, logo_filename: null };
}
function reportRooms(s) {
  return surveyRooms(s.id).map((r) => {
    const room = { ...r };
    const q = G.quantities(r);
    const photos = roomPhotos(r.id).map((p) => ({ path: path.join(photosDir, path.basename(p.thumb_filename || p.filename)), caption: p.caption, kind: p.kind, ai_notes: p.ai_notes }));
    return { room, quantities: q, photos };
  });
}

router.get('/:id/report.pdf', (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const userInfo = db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(req.user.id);
    require('./surveyPdf').streamSurveyPdf(res, { survey: s, rooms: reportRooms(s), branding: brandingFor(req.user.id), userInfo });
  } catch (err) { console.error('[Surveys] report error:', err); if (!res.headersSent) res.status(500).json({ error: 'Could not build the report.' }); else res.end(); }
});

router.get('/:id/schedule.xlsx', async (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AI QS';
    const rooms = reportRooms(s);
    const ws = wb.addWorksheet('Rooms');
    ws.columns = [
      { header: 'Room', key: 'name', width: 22 }, { header: 'Type', key: 'type', width: 16 }, { header: 'Floor', key: 'floor', width: 10 },
      { header: 'Length (m)', key: 'l', width: 11 }, { header: 'Width (m)', key: 'w', width: 11 }, { header: 'Height (m)', key: 'h', width: 11 }, { header: 'Source', key: 'src', width: 11 },
      { header: 'Floor m²', key: 'floor_m2', width: 10 }, { header: 'Ceiling m²', key: 'ceiling_m2', width: 11 }, { header: 'Walls gross m²', key: 'wall_gross_m2', width: 14 }, { header: 'Openings m²', key: 'openings_m2', width: 12 }, { header: 'Walls net m²', key: 'wall_net_m2', width: 12 },
      { header: 'Perimeter m', key: 'perimeter_m', width: 12 }, { header: 'Skirting m', key: 'skirting_m', width: 11 }, { header: 'Coving m', key: 'coving_m', width: 10 }, { header: 'Volume m³', key: 'volume_m3', width: 10 },
      { header: 'Doors', key: 'doors', width: 7 }, { header: 'Windows', key: 'windows', width: 9 }, { header: 'Work wanted', key: 'work', width: 40 }, { header: 'Condition', key: 'cond', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const { room, quantities: q } of rooms) {
      ws.addRow({ name: room.name, type: room.room_type || '', floor: room.floor_level || '', l: room.length_m, w: room.width_m, h: q.height_m, src: room.dims_source, floor_m2: q.floor_m2, ceiling_m2: q.ceiling_m2, wall_gross_m2: q.wall_gross_m2, openings_m2: q.openings_m2, wall_net_m2: q.wall_net_m2, perimeter_m: q.perimeter_m, skirting_m: q.skirting_m, coving_m: q.coving_m, volume_m3: q.volume_m3, doors: q.doors, windows: q.windows, work: room.work_wanted || '', cond: room.condition_notes || '' });
    }
    const totals = surveyTotals(rooms.map(({ room, quantities: q }) => ({ quantities: q, status: statusOf(room, q), photo_count: 0 })));
    const tr = ws.addRow({ name: 'TOTAL', floor_m2: totals.floor_m2, ceiling_m2: totals.ceiling_m2, wall_net_m2: totals.wall_net_m2, perimeter_m: totals.perimeter_m, doors: totals.doors, windows: totals.windows });
    tr.font = { bold: true };
    const wo = wb.addWorksheet('Openings');
    wo.columns = [{ header: 'Room', key: 'room', width: 22 }, { header: 'Kind', key: 'kind', width: 10 }, { header: 'Count', key: 'count', width: 7 }, { header: 'Width (m)', key: 'w', width: 10 }, { header: 'Height (m)', key: 'h', width: 10 }, { header: 'Area m²', key: 'a', width: 9 }, { header: 'Wall', key: 'wall', width: 6 }, { header: 'Notes', key: 'notes', width: 30 }, { header: 'Source', key: 'src', width: 10 }];
    wo.getRow(1).font = { bold: true };
    for (const { room } of rooms) for (const o of G.openingsOf(room)) wo.addRow({ room: room.name, kind: o.kind, count: o.count, w: o.width_m, h: o.height_m, a: Math.round(o.width_m * o.height_m * o.count * 100) / 100, wall: o.wall || '', notes: o.notes || '', src: o.source });
    const wf = wb.addWorksheet('Features');
    wf.columns = [{ header: 'Room', key: 'room', width: 22 }, { header: 'Item', key: 'item', width: 28 }, { header: 'Count', key: 'count', width: 7 }, { header: 'Notes', key: 'notes', width: 40 }, { header: 'Source', key: 'src', width: 10 }];
    wf.getRow(1).font = { bold: true };
    for (const { room } of rooms) for (const f of (G.parseJson(room.features, []) || [])) wf.addRow({ room: room.name, item: f.item, count: f.count, notes: f.notes || '', src: f.source || '' });
    const wn = wb.addWorksheet('Finishes & notes');
    wn.columns = [{ header: 'Room', key: 'room', width: 22 }, { header: 'Floor', key: 'floor', width: 26 }, { header: 'Walls', key: 'walls', width: 26 }, { header: 'Ceiling', key: 'ceiling', width: 26 }, { header: 'Woodwork', key: 'wood', width: 26 }, { header: 'Hazards', key: 'haz', width: 36 }, { header: 'Builder notes', key: 'notes', width: 50 }];
    wn.getRow(1).font = { bold: true };
    const finStr = (f) => (f ? [f.type, f.condition].filter(Boolean).join(' — ') : '');
    for (const { room } of rooms) { const fin = G.parseJson(room.finishes, null) || {}; wn.addRow({ room: room.name, floor: finStr(fin.floor), walls: finStr(fin.walls), ceiling: finStr(fin.ceiling), wood: finStr(fin.woodwork), haz: (G.parseJson(room.hazards, []) || []).join('; '), notes: (G.parseJson(room.notes, []) || []).map((n) => n.text).join(' | ') }); }
    const safe = String(s.title || 'survey').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '-room-schedule.xlsx"');
    await require('./docTemplates').writeXlsxStream(wb, res);
    res.end();
  } catch (err) { console.error('[Surveys] schedule error:', err); if (!res.headersSent) res.status(500).json({ error: 'Could not build the schedule.' }); else res.end(); }
});

router.get('/:id/plan.pdf', (req, res) => {
  try {
    const s = getSurvey(req.params.id, req.user.id);
    if (!s) return res.status(404).json({ error: 'Survey not found.' });
    const rooms = surveyRooms(s.id).filter((r) => r.capture).map((r) => ({ room: G.alignCapture(G.parseJson(r.capture, null)), label: r.name || 'Room' })).filter((r) => r.room && Array.isArray(r.room.walls) && r.room.walls.length);
    if (!rooms.length) return res.status(400).json({ error: 'A measured plan needs a LiDAR-scanned room — none in this survey yet.' });
    require('./floorPlanPdf').streamFloorPlanPdf(res, rooms, { company: req.user.company, filename: String(s.title || 'floor-plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-plan' });
  } catch (err) { console.error('[Surveys] plan error:', err); if (!res.headersSent) res.status(500).json({ error: 'Could not draw the plan.' }); else res.end(); }
});

// ── Keeping scanned rooms in step with the plan ──────────────────────────────
// How a scan is read has improved since the first ones were taken (openings
// placed on their walls; the plan squared up with the walls lettered
// clockwise from the top). The scan itself is on the row, so at startup any
// room whose stored wall list no longer matches what the scan reads as today
// is re-derived from it: walls, overall size, the measured openings (keeping
// any the builder or the AI added) and the LiDAR note. Rooms already in step
// are left alone, so this costs nothing after the first run.
function resyncScannedRooms() {
  let rows = [];
  try { rows = db.prepare("SELECT * FROM survey_rooms WHERE capture IS NOT NULL AND capture != ''").all(); } catch (e) { return 0; }
  let n = 0;
  for (const r of rows) {
    try {
      const fresh = importRoomPlan(G.parseJson(r.capture, null), r);
      const key = (list) => JSON.stringify((list || []).map((w) => [w.label, w.length_m]));
      const current = G.parseJson(r.openings, []) || [];
      const wallsChanged = key(G.parseJson(r.walls, [])) !== key(fresh.walls);
      const unplaced = current.some((o) => o.source === 'measured' && !o.wall);
      if (!wallsChanged && !unplaced) continue;
      const kept = current.filter((o) => o.source && o.source !== 'measured');
      const assumptions = (G.parseJson(r.assumptions, []) || []).filter((a) => !/^Measured by LiDAR scan/.test(String(a)));
      saveRoom(r, { walls: fresh.walls, length_m: fresh.length_m, width_m: fresh.width_m, openings: [...kept, ...fresh.openings], assumptions: [...fresh.assumptions, ...assumptions] });
      n++;
    } catch (e) { /* leave that room as it is */ }
  }
  if (n) console.log('[Surveys] brought ' + n + ' scanned room' + (n === 1 ? '' : 's') + ' in step with the current plan reading');
  return n;
}
try { resyncScannedRooms(); } catch (e) { /* never block startup */ }

module.exports = router;
module.exports._internals = { importRoomPlan, roomFieldsFrom, statusOf, surveyTotals, photosDir, resyncScannedRooms };

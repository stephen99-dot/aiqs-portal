// ═══════════════════════════════════════════════════════════════════════════════
// B4 — JOB PHOTOS — server/jobPhotoRoutes.js
//
// Photos taken on site against a job. The client compresses to ≤1600px
// before upload (utils/compressImage.js), so files arrive small; we still
// cap at 8MB. Storage follows the branding-logo pattern: multer to disk
// under DATA_DIR/job-photos, streamed back through an authed route.
//
//   POST   /api/job-photos            (multipart 'photo' + job_id, variation_id?, quote_id?)
//   GET    /api/job-photos?job_id=    — list a job's photos
//   GET    /api/job-photos/:id/file   — stream the image
//   PATCH  /api/job-photos/:id        — caption / attach to a variation or quote
//   DELETE /api/job-photos/:id
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const photosDir = path.join(DATA_DIR, 'job-photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photosDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase().slice(0, 6);
    cb(null, uuidv4() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype || ''));
  },
});

function ensureJob(userId, jobId) {
  return db.prepare('SELECT id FROM estimator_jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
}
function getPhoto(id, userId) {
  return db.prepare('SELECT * FROM job_photos WHERE id = ? AND user_id = ?').get(id, userId);
}

// Wrap multer so upload errors (e.g. oversized file) come back as JSON, not an HTML 500.
function uploadPhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'That photo is too big — please try again.' });
      }
      console.error('[JobPhotos] upload error:', err);
      return res.status(400).json({ error: 'Failed to save the photo.' });
    }
    next();
  });
}

// POST /api/job-photos
router.post('/', uploadPhoto, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo received — try again.' });
    const jobId = (req.body && req.body.job_id) || '';
    const job = ensureJob(req.user.id, jobId);
    if (!job) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'A valid job_id is required.' });
    }
    // Optional links — validated against the same user.
    let variationId = (req.body.variation_id || '').toString() || null;
    if (variationId && !db.prepare('SELECT id FROM estimator_variations WHERE id = ? AND user_id = ?').get(variationId, req.user.id)) variationId = null;
    let quoteId = (req.body.quote_id || '').toString() || null;
    if (quoteId && !db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(quoteId, req.user.id)) quoteId = null;

    const id = uuidv4();
    db.prepare(
      'INSERT INTO job_photos (id, user_id, job_id, variation_id, quote_id, filename, mime, file_size, caption) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, req.user.id, job.id, variationId, quoteId,
      req.file.filename, req.file.mimetype || 'image/jpeg', req.file.size || 0,
      (req.body.caption || '').toString().slice(0, 300) || null
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[JobPhotos] upload error:', err);
    res.status(500).json({ error: 'Failed to save the photo.' });
  }
});

// GET /api/job-photos?job_id=
router.get('/', (req, res) => {
  try {
    const jobId = (req.query.job_id || '').toString();
    const job = ensureJob(req.user.id, jobId);
    if (!job) return res.status(400).json({ error: 'A valid job_id is required.' });
    const rows = db.prepare(
      'SELECT id, job_id, variation_id, quote_id, mime, file_size, caption, created_at FROM job_photos WHERE job_id = ? AND user_id = ? ORDER BY created_at DESC'
    ).all(job.id, req.user.id);
    res.json({ photos: rows });
  } catch (err) {
    console.error('[JobPhotos] list error:', err);
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});

// GET /api/job-photos/:id/file
router.get('/:id/file', (req, res) => {
  try {
    const photo = getPhoto(req.params.id, req.user.id);
    if (!photo) return res.status(404).end();
    const filePath = path.join(photosDir, photo.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.setHeader('Content-Type', photo.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      console.error('[JobPhotos] file stream error:', streamErr);
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[JobPhotos] file error:', err);
    if (!res.headersSent) res.status(500).end();
  }
});

// PATCH /api/job-photos/:id — caption, attach/detach variation or quote.
router.patch('/:id', (req, res) => {
  try {
    const photo = getPhoto(req.params.id, req.user.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found.' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if ('caption' in b) { sets.push('caption = ?'); vals.push(String(b.caption || '').slice(0, 300) || null); }
    if ('variation_id' in b) {
      let vId = b.variation_id || null;
      if (vId && !db.prepare('SELECT id FROM estimator_variations WHERE id = ? AND user_id = ?').get(vId, req.user.id)) {
        return res.status(400).json({ error: 'Change not found.' });
      }
      sets.push('variation_id = ?'); vals.push(vId);
    }
    if ('quote_id' in b) {
      let qId = b.quote_id || null;
      if (qId && !db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(qId, req.user.id)) {
        return res.status(400).json({ error: 'Quote not found.' });
      }
      sets.push('quote_id = ?'); vals.push(qId);
    }
    if (sets.length > 0) {
      vals.push(photo.id);
      db.prepare('UPDATE job_photos SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: photo.id });
  } catch (err) {
    console.error('[JobPhotos] patch error:', err);
    res.status(500).json({ error: 'Failed to update the photo.' });
  }
});

// DELETE /api/job-photos/:id
router.delete('/:id', (req, res) => {
  try {
    const photo = getPhoto(req.params.id, req.user.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found.' });
    db.prepare('DELETE FROM job_photos WHERE id = ?').run(photo.id);
    fs.unlink(path.join(photosDir, photo.filename), () => {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[JobPhotos] delete error:', err);
    res.status(500).json({ error: 'Failed to delete the photo.' });
  }
});

// Used by the PDF renderers — absolute paths for photos attached to a record.
function photoPathsFor(field, recordId) {
  const col = field === 'quote' ? 'quote_id' : 'variation_id';
  const rows = db.prepare('SELECT filename, caption FROM job_photos WHERE ' + col + ' = ? ORDER BY created_at ASC LIMIT 8').all(recordId);
  return rows
    .map(r => ({ path: path.join(photosDir, r.filename), caption: r.caption }))
    .filter(r => fs.existsSync(r.path));
}

module.exports = { router, photoPathsFor };

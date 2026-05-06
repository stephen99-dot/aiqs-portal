// ═══════════════════════════════════════════════════════════════════════════════
// BRANDING ROUTES — server/brandingRoutes.js
//
// Per-customer branding applied to every generated Client Copy / Findings doc.
// Logo lives on disk in DATA_DIR/branding; everything else is in user_branding.
//
//   GET    /api/branding              — read current user's branding (creates default row)
//   PATCH  /api/branding              — update colours, address, template, etc.
//   POST   /api/branding/logo         — upload (or replace) logo (multipart)
//   DELETE /api/branding/logo         — remove logo
//   GET    /api/branding/logo/:userId — owner or admin: stream the logo file
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');
if (!fs.existsSync(brandingDir)) fs.mkdirSync(brandingDir, { recursive: true });

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, brandingDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, 'logo_' + req.user.id + '_' + uuidv4().slice(0, 8) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.includes(ext) || ALLOWED_MIMES.includes(file.mimetype));
  },
});

const VALID_TEMPLATES = ['modern', 'professional', 'heritage', 'minimalist'];
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function ensureBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO user_branding (user_id) VALUES (?)').run(userId);
    row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  }
  return row;
}

router.get('/branding', authMiddleware, (req, res) => {
  try {
    const row = ensureBranding(req.user.id);
    res.json({ branding: row, logo_url: row.logo_filename ? '/api/branding/logo/' + req.user.id : null });
  } catch (err) {
    console.error('[Branding] GET error:', err);
    res.status(500).json({ error: 'Failed to load branding' });
  }
});

router.patch('/branding', authMiddleware, (req, res) => {
  try {
    ensureBranding(req.user.id);

    const updates = [];
    const params = [];
    const fields = ['primary_colour', 'accent_colour', 'company_name', 'company_address', 'footer_text', 'template'];
    for (const f of fields) {
      if (!Object.prototype.hasOwnProperty.call(req.body, f)) continue;
      const v = req.body[f];
      if ((f === 'primary_colour' || f === 'accent_colour') && v && !HEX_COLOUR.test(v)) {
        return res.status(400).json({ error: f + ' must be a #rrggbb hex colour' });
      }
      if (f === 'template' && v && !VALID_TEMPLATES.includes(v)) {
        return res.status(400).json({ error: 'template must be one of ' + VALID_TEMPLATES.join(', ') });
      }
      updates.push(f + ' = ?');
      params.push(v == null || v === '' ? null : String(v));
    }

    if (updates.length === 0) return res.json({ ok: true, unchanged: true });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.user.id);
    db.prepare('UPDATE user_branding SET ' + updates.join(', ') + ' WHERE user_id = ?').run(...params);

    const row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(req.user.id);
    res.json({ ok: true, branding: row, logo_url: row.logo_filename ? '/api/branding/logo/' + req.user.id : null });
  } catch (err) {
    console.error('[Branding] PATCH error:', err);
    res.status(500).json({ error: 'Failed to save branding' });
  }
});

router.post('/branding/logo', authMiddleware, upload.single('logo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No logo uploaded' });
    ensureBranding(req.user.id);

    const prev = db.prepare('SELECT logo_filename FROM user_branding WHERE user_id = ?').get(req.user.id);
    if (prev && prev.logo_filename) {
      const oldPath = path.join(brandingDir, prev.logo_filename);
      if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
    }

    db.prepare(`
      UPDATE user_branding
      SET logo_filename = ?, logo_mime = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(req.file.filename, req.file.mimetype || null, req.user.id);

    const row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(req.user.id);
    res.json({ ok: true, branding: row, logo_url: '/api/branding/logo/' + req.user.id });
  } catch (err) {
    console.error('[Branding] logo upload error:', err);
    res.status(500).json({ error: 'Logo upload failed' });
  }
});

router.delete('/branding/logo', authMiddleware, (req, res) => {
  try {
    const prev = db.prepare('SELECT logo_filename FROM user_branding WHERE user_id = ?').get(req.user.id);
    if (prev && prev.logo_filename) {
      const oldPath = path.join(brandingDir, prev.logo_filename);
      if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
      db.prepare('UPDATE user_branding SET logo_filename = NULL, logo_mime = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(req.user.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Branding] logo delete error:', err);
    res.status(500).json({ error: 'Logo delete failed' });
  }
});

router.get('/branding/logo/:userId', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.id !== req.params.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const row = db.prepare('SELECT logo_filename, logo_mime FROM user_branding WHERE user_id = ?').get(req.params.userId);
    if (!row || !row.logo_filename) return res.status(404).json({ error: 'No logo set' });
    const p = path.join(brandingDir, row.logo_filename);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Logo file missing' });
    res.setHeader('Content-Type', row.logo_mime || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(p).pipe(res);
  } catch (err) {
    console.error('[Branding] logo fetch error:', err);
    res.status(500).json({ error: 'Logo fetch failed' });
  }
});

// ─── Helpers used by document generators ─────────────────────────────────────
// Shared with builderExports.js / boqGenerator.js / findings.

function getBrandingForUser(userId) {
  if (!userId) return null;
  const row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) return null;
  return {
    primary_colour:  row.primary_colour  || '#1B2A4A',
    accent_colour:   row.accent_colour   || '#F59E0B',
    company_name:    row.company_name    || null,
    company_address: row.company_address || null,
    footer_text:     row.footer_text     || null,
    template:        row.template        || 'modern',
    logo_path:       row.logo_filename ? path.join(brandingDir, row.logo_filename) : null,
    logo_mime:       row.logo_mime       || null,
  };
}

module.exports = router;
module.exports.getBrandingForUser = getBrandingForUser;
module.exports.brandingDir = brandingDir;

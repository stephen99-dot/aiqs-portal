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

// Load sharp lazily so the route still works if the native binary is missing.
let _sharp;
function getSharp() {
  if (_sharp === undefined) {
    try { _sharp = require('sharp'); } catch (e) { _sharp = null; }
  }
  return _sharp;
}

// True only when the bytes really are a raster ExcelJS/Word can embed. An SVG or
// mislabeled upload that isn't a real raster would corrupt every generated
// document, so we never store one as a logo.
function isRaster(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;                     // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;  // GIF
  return false;
}

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

// TEMP diagnostic: why a user's logo isn't embedding in generated documents.
// Email-keyed and unauthenticated so it can be opened straight in a browser;
// returns only logo-resolution status (no secrets). Remove once resolved.
router.get('/branding/logo-debug', async (req, res) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'add ?email=you@example.com' });
    const user = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (!user) return res.json({ found_user: false });
    const branding = getBrandingForUser(user.id);
    let sharpOk = false; try { require('sharp'); sharpOk = true; } catch (e) { /* not installed */ }
    const logoPath = branding && branding.logo_path;
    let resolved = null, resolveErr = null;
    try {
      const lg = await require('./docTemplates').resolveLogo(branding);
      resolved = lg ? { extension: lg.extension, w: lg.naturalWidth, h: lg.naturalHeight, bytes: lg.buffer ? lg.buffer.length : 0 } : null;
    } catch (e) { resolveErr = e.message; }
    res.json({
      found_user: true,
      has_logo_path: !!logoPath,
      logo_file: logoPath ? path.basename(logoPath) : null,
      file_exists: logoPath ? fs.existsSync(logoPath) : false,
      logo_mime: branding ? branding.logo_mime : null,
      sharp: sharpOk,
      resolves: !!resolved,
      resolved,
      resolveErr,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

router.post('/branding/logo', authMiddleware, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No logo uploaded' });
    ensureBranding(req.user.id);

    // Normalise whatever was uploaded (PNG / JPG / WebP / SVG) into a clean PNG
    // here, at upload time, so the document generators only ever embed a valid
    // raster. A logo that isn't a real image — or can't be rasterised — is
    // rejected now rather than silently corrupting every generated workbook
    // (the "Excel found a problem with some content" error customers hit).
    const uploadedPath = req.file.path;
    const pngName = 'logo_' + req.user.id + '_' + uuidv4().slice(0, 8) + '.png';
    const pngPath = path.join(brandingDir, pngName);

    let ok = false;
    const sharpLib = getSharp();
    if (sharpLib) {
      try {
        // density helps vector (SVG) logos rasterise crisply; cap the size so a
        // huge upload can't bloat every document.
        await sharpLib(uploadedPath, { density: 300 })
          .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
          .png()
          .toFile(pngPath);
        ok = true;
      } catch (e) { /* fall through to the raw-bytes path */ }
    }
    if (!ok) {
      // No sharp (or it failed): only accept bytes that already are a real
      // PNG/JPEG, copied through unchanged. Anything else is refused.
      try {
        const buf = fs.readFileSync(uploadedPath);
        if (isRaster(buf)) { fs.writeFileSync(pngPath, buf); ok = true; }
      } catch (e) { /* ignore */ }
    }
    // We only keep the normalised copy.
    if (uploadedPath !== pngPath) { try { fs.unlinkSync(uploadedPath); } catch (e) { /* ignore */ } }

    if (!ok) {
      return res.status(400).json({ error: "We couldn't read that image. Please upload a PNG or JPG logo." });
    }

    // Remove the previous logo file (now that the new one is safely written).
    const prev = db.prepare('SELECT logo_filename FROM user_branding WHERE user_id = ?').get(req.user.id);
    if (prev && prev.logo_filename && prev.logo_filename !== pngName) {
      const oldPath = path.join(brandingDir, prev.logo_filename);
      if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
    }

    db.prepare(`
      UPDATE user_branding
      SET logo_filename = ?, logo_mime = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(pngName, 'image/png', req.user.id);

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

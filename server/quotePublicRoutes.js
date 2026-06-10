// ═══════════════════════════════════════════════════════════════════════════════
// A1 — PUBLIC QUOTE ACCEPTANCE — server/quotePublicRoutes.js
//
// The client-facing side of "Send the quote". Mirrors the variation approval
// pattern (estimatorVariationRoutes.js publicRouter): tokened URL, no auth,
// no estimator gate, renders the BUILDER's branding. The /q/<token> page hits
// these endpoints.
//
//   GET  /api/public/quotes/:token          — quote + lines + branding (public shape)
//   GET  /api/public/quotes/:token/logo     — builder's logo, token-gated
//   GET  /api/public/quotes/:token/pdf      — the branded quote PDF
//   POST /api/public/quotes/:token/accept   — name + typed signature -> accepted,
//                                             locks the quote, auto-creates the
//                                             Finance job and seeds its budget
//   POST /api/public/quotes/:token/question — "Ask a question" box -> stored +
//                                             owner notified
//
// Security: tokens are 32-char base64url (~190 bits); lookups are exact-match
// + constant-time compare; invalid tokens always get the same generic 404; the
// whole router is rate-limited per IP.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { streamQuotePdf } = require('./quotePdf');
const { rateLimit, clientIp } = require('./publicRateLimit');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

router.use(rateLimit({ windowMs: 60_000, max: 60 }));
const postLimit = rateLimit({ windowMs: 60_000, max: 5 });

// ─── helpers ────────────────────────────────────────────────────────────────

function num(v, fb = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) { return Math.round(n * 100) / 100; }

function currencySymbol(code) { return code === 'EUR' ? '€' : '£'; }
function fmtMoney(n, code) {
  return currencySymbol(code) + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Constant-time string compare — same pattern as estimatorVariationRoutes.js.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function findByToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const row = db.prepare('SELECT * FROM quotes WHERE public_token = ?').get(token);
  if (!row || !safeEqual(row.public_token || '', token)) return null;
  return row;
}

function getQuoteLines(quoteId) {
  return db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(quoteId);
}

function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = {
      logo_filename: null,
      logo_mime: null,
      primary_colour: '#1B2A4A',
      accent_colour: '#F59E0B',
      company_name: null,
      company_address: null,
      footer_text: null,
    };
  }
  return row;
}

function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(userId);
}

// Public-facing serialiser — internal pricing fields (margins, labour/materials
// splits, AI flags, the builder's raw job description) are stripped on purpose.
function publicShape(q, lines, branding, user) {
  return {
    quote_number: q.quote_number,
    project_name: q.project_name,
    project_type: q.project_type,
    client_name: q.client_name,
    currency: q.currency,
    status: q.status,
    sent_at: q.sent_at,
    created_at: q.created_at,
    accepted_at: q.accepted_at,
    acceptance_name: q.acceptance_name,
    notes: q.notes,
    net_total: q.net_total,
    ohp_pct: q.ohp_pct,
    ohp_amount: q.ohp_amount,
    contingency_pct: q.contingency_pct,
    contingency_amount: q.contingency_amount,
    vat_pct: q.vat_pct,
    vat_amount: q.vat_amount,
    grand_total: q.grand_total,
    lines: lines.map(l => ({
      section: l.section, item: l.item, description: l.description,
      unit: l.unit, qty: l.qty, rate: l.rate, line_total: l.line_total,
    })),
    company: {
      name: branding.company_name || user?.company || user?.full_name || null,
      address: branding.company_address,
      footer_text: branding.footer_text,
      primary_colour: branding.primary_colour,
      accent_colour: branding.accent_colour,
      has_logo: !!branding.logo_filename,
    },
  };
}

// ─── routes ─────────────────────────────────────────────────────────────────

// Stream the builder's logo without exposing the auth-gated branding route.
router.get('/:token/logo', (req, res) => {
  try {
    const q = findByToken(req.params.token);
    if (!q) return res.status(404).end();
    const branding = getBranding(q.user_id);
    if (!branding.logo_filename) return res.status(404).end();
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (!fs.existsSync(logoPath)) return res.status(404).end();
    res.setHeader('Content-Type', branding.logo_mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(logoPath).pipe(res);
  } catch (err) {
    console.error('[QuotePublic] logo error:', err);
    if (!res.headersSent) res.status(500).end();
  }
});

router.get('/:token/pdf', (req, res) => {
  try {
    const q = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: 'This quote link is invalid or has been revoked.' });
    const lines = getQuoteLines(q.id);
    const branding = getBranding(q.user_id);
    const userInfo = getUserDisplay(q.user_id);
    streamQuotePdf(res, q, lines, branding, userInfo);
  } catch (err) {
    console.error('[QuotePublic] pdf error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

router.get('/:token', (req, res) => {
  try {
    const q = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: 'This quote link is invalid or has been revoked.' });
    const lines = getQuoteLines(q.id);
    const branding = getBranding(q.user_id);
    const user = getUserDisplay(q.user_id);
    res.json(publicShape(q, lines, branding, user));
  } catch (err) {
    console.error('[QuotePublic] get error:', err);
    res.status(500).json({ error: 'Failed to load.' });
  }
});

// POST /:token/accept — the client says yes. Captures a typed signature, locks
// the quote, and drops a linked job into Finance so the builder gets the next
// step for free.
router.post('/:token/accept', postLimit, (req, res) => {
  try {
    const q = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: 'This quote link is invalid or has been revoked.' });
    if (q.status === 'accepted') return res.status(409).json({ error: 'This quote has already been accepted.' });

    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 200);
    const signature = String(b.signature || '').trim().slice(0, 200);
    const email = String(b.email || '').trim().slice(0, 200) || null;
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!signature) return res.status(400).json({ error: 'Please type your name as a signature.' });

    const ip = clientIp(req);
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 500) || null;

    let jobId = q.job_id || null;
    const txn = db.transaction(() => {
      db.prepare(
        'UPDATE quotes SET status=?, locked=1, acceptance_name=?, acceptance_email=?, '
        + 'acceptance_signature=?, acceptance_ip=?, acceptance_user_agent=?, accepted_at=CURRENT_TIMESTAMP, '
        + 'updated_at=CURRENT_TIMESTAMP WHERE id=? AND public_token=?'
      ).run('accepted', name, email, signature, ip, ua, q.id, req.params.token);

      // Auto-create the Finance job (unless the quote is already linked to one)
      // and seed its budget from the quote's own numbers.
      if (!jobId) {
        jobId = uuidv4();
        db.prepare(
          'INSERT INTO estimator_jobs (id, user_id, name, client_name, project_type, status, notes) '
          + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          jobId, q.user_id,
          (q.project_name || 'Job from quote').slice(0, 200),
          q.client_name || name,
          q.project_type || null,
          'planned',
          'Created automatically when quote ' + (q.quote_number || '') + ' was accepted.'
        );
        db.prepare('UPDATE quotes SET job_id = ? WHERE id = ?').run(jobId, q.id);

        const lines = getQuoteLines(q.id);
        let plannedLabour = 0;
        let plannedMaterials = 0;
        for (const ln of lines) {
          plannedLabour += num(ln.qty) * num(ln.labour);
          plannedMaterials += num(ln.qty) * num(ln.materials);
        }
        db.prepare(
          'INSERT INTO job_budgets (job_id, user_id, planned_labour, planned_materials, planned_margin_pct, planned_revenue, notes) '
          + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          jobId, q.user_id,
          round2(plannedLabour), round2(plannedMaterials),
          num(q.margin_pct), num(q.grand_total),
          'Seeded from accepted quote ' + (q.quote_number || '') + '.'
        );
      }

      // In-app notification for the builder (notification bell).
      db.prepare('INSERT INTO user_messages (id, user_id, message) VALUES (?, ?, ?)').run(
        uuidv4(), q.user_id,
        name + ' accepted your quote for ' + fmtMoney(q.grand_total, q.currency)
        + (q.quote_number ? ' (' + q.quote_number + ')' : '')
        + '. The job is now in Finance.'
      );
    });
    txn();

    res.json({ ok: true, accepted_at: new Date().toISOString() });
  } catch (err) {
    console.error('[QuotePublic] accept error:', err);
    res.status(500).json({ error: 'Failed to record acceptance.' });
  }
});

// POST /:token/question — "Ask a question" box. Stores the message and pings
// the builder; the quote stays open to accept afterwards.
router.post('/:token/question', postLimit, (req, res) => {
  try {
    const q = findByToken(req.params.token);
    if (!q) return res.status(404).json({ error: 'This quote link is invalid or has been revoked.' });

    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 200);
    const email = String(b.email || '').trim().slice(0, 200) || null;
    const message = String(b.message || '').trim().slice(0, 2000);
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!message) return res.status(400).json({ error: 'Please type your question.' });

    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO quote_messages (id, quote_id, user_id, sender_name, sender_email, message) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), q.id, q.user_id, name, email, message);

      const preview = message.length > 140 ? message.slice(0, 140) + '…' : message;
      db.prepare('INSERT INTO user_messages (id, user_id, message) VALUES (?, ?, ?)').run(
        uuidv4(), q.user_id,
        name + ' asked a question about quote ' + (q.quote_number || '') + ': "' + preview + '"'
      );
    });
    txn();

    res.json({ ok: true });
  } catch (err) {
    console.error('[QuotePublic] question error:', err);
    res.status(500).json({ error: 'Failed to send your question.' });
  }
});

module.exports = router;

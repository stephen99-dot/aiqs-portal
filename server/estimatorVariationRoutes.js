// ═══════════════════════════════════════════════════════════════════════════════
// WAVE 4 — VARIATIONS / CHANGE ORDERS — server/estimatorVariationRoutes.js
//
// Priced changes against an estimator_job. Status flow:
//   draft  -> sent  -> approved | declined
// Approved variations are locked (no edits / no delete). The shareable approval
// link at /v/<token> is what the client sees; the public approve/decline routes
// capture name, signature, IP and timestamp to form the audit trail.
//
//   Owner (auth + estimator + password):
//     GET    /api/variations
//     GET    /api/variations/job/:jobId
//     POST   /api/variations
//     GET    /api/variations/:id
//     PATCH  /api/variations/:id
//     PUT    /api/variations/:id/lines
//     POST   /api/variations/:id/duplicate
//     DELETE /api/variations/:id
//     POST   /api/variations/:id/send
//     GET    /api/variations/:id/approval-url
//     GET    /api/variations/:id/pdf
//
//   Public (NO auth, NO estimator gate — by design):
//     GET    /api/public/variations/:token
//     POST   /api/public/variations/:token/approve
//     POST   /api/public/variations/:token/decline
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');
const mailer = require('./mailer');

const ownerRouter = express.Router();
const publicRouter = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

// ─── helpers ────────────────────────────────────────────────────────────────

function num(v, fb = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) { return Math.round(n * 100) / 100; }

function nextVoNumber(jobId) {
  // Per-job sequential VO-001, VO-002...
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM estimator_variations WHERE job_id = ?"
  ).get(jobId);
  const n = (row?.c || 0) + 1;
  return 'VO-' + String(n).padStart(3, '0');
}

function newApprovalToken() {
  // 32 url-safe chars — cryptographically random.
  return crypto.randomBytes(24).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function ensureJob(userId, jobId) {
  return db.prepare('SELECT * FROM estimator_jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
}

function getVariation(id, userId) {
  return db.prepare('SELECT * FROM estimator_variations WHERE id = ? AND user_id = ?').get(id, userId);
}

function getVariationLines(variationId) {
  return db.prepare(
    'SELECT * FROM estimator_variation_lines WHERE variation_id = ? ORDER BY sort_order ASC, rowid ASC'
  ).all(variationId);
}

function computeTotals(lines, opts) {
  const ohpPct = num(opts.ohp_pct);
  const vatPct = num(opts.vat_pct);
  let net = 0;
  for (const ln of lines) {
    const qty = num(ln.qty);
    const rate = num(ln.rate);
    const lt = qty * rate;
    ln.line_total = round2(lt);
    net += lt;
  }
  const ohp = net * (ohpPct / 100);
  const beforeVat = net + ohp;
  const vat = beforeVat * (vatPct / 100);
  const grand = beforeVat + vat;
  return {
    net_total: round2(net),
    ohp_pct: ohpPct,
    ohp_amount: round2(ohp),
    vat_pct: vatPct,
    vat_amount: round2(vat),
    grand_total: round2(grand),
  };
}

function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = {
      logo_filename: null,
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

function rejectIfLocked(v, res) {
  if (v.locked) {
    res.status(423).json({ error: 'This variation has been approved and is locked. Duplicate it to make changes.', code: 'VARIATION_LOCKED' });
    return true;
  }
  return false;
}

// Constant-time string compare. Used so token lookups don't leak via timing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Public-facing serialiser — strips internal fields the client doesn't need.
function publicShape(v, lines, branding, user, job) {
  return {
    id: v.id,
    vo_number: v.vo_number,
    title: v.title,
    reason: v.reason,
    notes: v.notes,
    currency: v.currency,
    status: v.status,
    locked: !!v.locked,
    sent_at: v.sent_at,
    approval_at: v.approval_at,
    decline_at: v.decline_at,
    decline_reason: v.decline_reason,
    approval_name: v.approval_name,
    approval_signature: v.approval_signature,
    net_total: v.net_total,
    ohp_pct: v.ohp_pct,
    ohp_amount: v.ohp_amount,
    vat_pct: v.vat_pct,
    vat_amount: v.vat_amount,
    grand_total: v.grand_total,
    lines: lines.map(l => ({
      section: l.section, item: l.item, description: l.description,
      unit: l.unit, qty: l.qty, rate: l.rate, line_total: l.line_total,
    })),
    job: {
      name: job?.name,
      client_name: job?.client_name,
      location: job?.location,
    },
    company: {
      name: branding.company_name || user?.company || user?.full_name || null,
      address: branding.company_address,
      footer_text: branding.footer_text,
      primary_colour: branding.primary_colour,
      accent_colour: branding.accent_colour,
      has_logo: !!branding.logo_filename,
      user_id: user?.id,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  OWNER ROUTES (auth + estimator + password)
// ═══════════════════════════════════════════════════════════════════════════

ownerRouter.use(authMiddleware, requireEstimator, requireEstimatorPassword);

// GET /api/variations — list all for the user, optionally newest first
ownerRouter.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT v.*, j.name AS job_name, j.client_name AS job_client
      FROM estimator_variations v
      LEFT JOIN estimator_jobs j ON j.id = v.job_id
      WHERE v.user_id = ?
      ORDER BY v.created_at DESC
      LIMIT 500
    `).all(req.user.id);
    res.json({ variations: rows });
  } catch (err) {
    console.error('[Variations] list error:', err);
    res.status(500).json({ error: 'Failed to load variations.' });
  }
});

// GET /api/variations/job/:jobId
ownerRouter.get('/job/:jobId', (req, res) => {
  try {
    const job = ensureJob(req.user.id, req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const rows = db.prepare(
      'SELECT * FROM estimator_variations WHERE job_id = ? AND user_id = ? ORDER BY created_at DESC'
    ).all(job.id, req.user.id);
    const approvedSum = rows
      .filter(r => r.status === 'approved')
      .reduce((s, r) => s + num(r.grand_total), 0);
    res.json({ variations: rows, approved_total: round2(approvedSum) });
  } catch (err) {
    console.error('[Variations] job-list error:', err);
    res.status(500).json({ error: 'Failed to load variations.' });
  }
});

// POST /api/variations — create draft
ownerRouter.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const job = ensureJob(req.user.id, b.job_id);
    if (!job) return res.status(400).json({ error: 'A valid job_id is required.' });
    const lines = Array.isArray(b.lines) ? b.lines : [];
    const totals = computeTotals(lines, { ohp_pct: b.ohp_pct, vat_pct: b.vat_pct });

    const id = uuidv4();
    const voNumber = nextVoNumber(job.id);

    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO estimator_variations (id, user_id, job_id, vo_number, title, reason, notes, currency, '
        + 'net_total, ohp_pct, ohp_amount, vat_pct, vat_amount, grand_total, status, locked) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
      ).run(
        id, req.user.id, job.id, voNumber,
        (b.title || '').toString().slice(0, 200) || null,
        (b.reason || '').toString().slice(0, 1000) || null,
        (b.notes || '').toString().slice(0, 4000) || null,
        b.currency || 'GBP',
        totals.net_total, totals.ohp_pct, totals.ohp_amount,
        totals.vat_pct, totals.vat_amount, totals.grand_total,
        'draft'
      );
      const ins = db.prepare(
        'INSERT INTO estimator_variation_lines (id, variation_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let order = 0;
      for (const ln of lines) {
        ins.run(
          uuidv4(), id,
          ln.section || 'Change', ln.item || '', ln.description || '',
          ln.unit || 'item', num(ln.qty), num(ln.rate), num(ln.labour), num(ln.materials),
          num(ln.line_total) || round2(num(ln.qty) * num(ln.rate)),
          ln.est_rate ? 1 : 0,
          ln.sort_order != null ? num(ln.sort_order) : order++
        );
      }
    });
    txn();
    res.status(201).json({ id, vo_number: voNumber });
  } catch (err) {
    console.error('[Variations] create error:', err);
    res.status(500).json({ error: 'Failed to create variation.' });
  }
});

// GET /api/variations/:id — read with lines
ownerRouter.get('/:id', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    const lines = getVariationLines(v.id);
    res.json({ variation: v, lines });
  } catch (err) {
    console.error('[Variations] get error:', err);
    res.status(500).json({ error: 'Failed to load variation.' });
  }
});

// PATCH /api/variations/:id — update header
ownerRouter.patch('/:id', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    if (rejectIfLocked(v, res)) return;
    const b = req.body || {};
    const allowed = ['title', 'reason', 'notes', 'currency', 'ohp_pct', 'vat_pct'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (k in b) { sets.push(k + ' = ?'); vals.push(b[k]); }
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(v.id);
      db.prepare('UPDATE estimator_variations SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
      // Recompute totals if pcts changed (lines unchanged).
      if ('ohp_pct' in b || 'vat_pct' in b) {
        const lines = getVariationLines(v.id);
        const newPcts = {
          ohp_pct: 'ohp_pct' in b ? b.ohp_pct : v.ohp_pct,
          vat_pct: 'vat_pct' in b ? b.vat_pct : v.vat_pct,
        };
        const t = computeTotals(lines, newPcts);
        db.prepare(
          'UPDATE estimator_variations SET net_total=?, ohp_amount=?, vat_amount=?, grand_total=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(t.net_total, t.ohp_amount, t.vat_amount, t.grand_total, v.id);
      }
    }
    res.json({ id: v.id });
  } catch (err) {
    console.error('[Variations] patch error:', err);
    res.status(500).json({ error: 'Failed to update variation.' });
  }
});

// PUT /api/variations/:id/lines — replace lines + recompute totals
ownerRouter.put('/:id/lines', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    if (rejectIfLocked(v, res)) return;
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];

    const totals = computeTotals(lines, { ohp_pct: v.ohp_pct, vat_pct: v.vat_pct });

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM estimator_variation_lines WHERE variation_id = ?').run(v.id);
      const ins = db.prepare(
        'INSERT INTO estimator_variation_lines (id, variation_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let order = 0;
      for (const ln of lines) {
        ins.run(
          uuidv4(), v.id,
          ln.section || 'Change', ln.item || '', ln.description || '',
          ln.unit || 'item', num(ln.qty), num(ln.rate), num(ln.labour), num(ln.materials),
          num(ln.line_total) || round2(num(ln.qty) * num(ln.rate)),
          ln.est_rate ? 1 : 0,
          ln.sort_order != null ? num(ln.sort_order) : order++
        );
      }
      db.prepare(
        'UPDATE estimator_variations SET net_total=?, ohp_amount=?, vat_amount=?, grand_total=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(totals.net_total, totals.ohp_amount, totals.vat_amount, totals.grand_total, v.id);
    });
    txn();
    res.json({ id: v.id, ...totals });
  } catch (err) {
    console.error('[Variations] update lines error:', err);
    res.status(500).json({ error: 'Failed to update variation.' });
  }
});

// POST /api/variations/:id/duplicate — useful after a decline, or for a v2 after approval.
ownerRouter.post('/:id/duplicate', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    const lines = getVariationLines(v.id);
    const newId = uuidv4();
    const newVo = nextVoNumber(v.job_id);
    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO estimator_variations (id, user_id, job_id, vo_number, title, reason, notes, currency, '
        + 'net_total, ohp_pct, ohp_amount, vat_pct, vat_amount, grand_total, status, locked) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
      ).run(
        newId, req.user.id, v.job_id, newVo,
        (v.title ? v.title + ' (copy)' : null),
        v.reason, v.notes, v.currency,
        v.net_total, v.ohp_pct, v.ohp_amount, v.vat_pct, v.vat_amount, v.grand_total,
        'draft'
      );
      const ins = db.prepare(
        'INSERT INTO estimator_variation_lines (id, variation_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const ln of lines) {
        ins.run(uuidv4(), newId, ln.section, ln.item, ln.description, ln.unit, ln.qty, ln.rate, ln.labour, ln.materials, ln.line_total, ln.est_rate, ln.sort_order);
      }
    });
    txn();
    res.status(201).json({ id: newId, vo_number: newVo });
  } catch (err) {
    console.error('[Variations] duplicate error:', err);
    res.status(500).json({ error: 'Failed to duplicate variation.' });
  }
});

// DELETE /api/variations/:id — drafts and declined only. Approved are locked.
ownerRouter.delete('/:id', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    if (v.locked || v.status === 'approved') {
      return res.status(423).json({ error: 'Approved variations are locked and cannot be deleted.', code: 'VARIATION_LOCKED' });
    }
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM estimator_variation_lines WHERE variation_id = ?').run(v.id);
      db.prepare('DELETE FROM estimator_variations WHERE id = ?').run(v.id);
    });
    txn();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Variations] delete error:', err);
    res.status(500).json({ error: 'Failed to delete variation.' });
  }
});

// POST /api/variations/:id/send — issue an approval token, status -> sent.
// A2: body may carry { email } — the client gets the approval link by email
// when SMTP is configured; the link is always returned for WhatsApp/text.
ownerRouter.post('/:id/send', async (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    if (rejectIfLocked(v, res)) return;
    if (v.status === 'approved') return res.status(400).json({ error: 'Already approved.' });
    const token = v.approval_token || newApprovalToken();
    db.prepare(
      'UPDATE estimator_variations SET status=?, approval_token=?, sent_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run('sent', token, v.id);

    const clientEmail = (req.body && req.body.email) ? String(req.body.email).trim().slice(0, 200) : null;
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    const companyName = branding.company_name || userInfo?.company || userInfo?.full_name || 'your builder';
    const job = db.prepare('SELECT name FROM estimator_jobs WHERE id = ?').get(v.job_id);
    const mail = await mailer.sendMail({
      userId: req.user.id,
      type: 'variation_send',
      to: clientEmail,
      subject: 'Change to the job' + (job?.name ? ' at ' + job.name : '') + ' — approval needed',
      heading: 'A change to your job needs your approval',
      paragraphs: [
        companyName + ' has priced a change to the job' + (job?.name ? ' "' + job.name + '"' : '') + (v.title ? ': ' + v.title : '') + '.',
        'Cost of the change: ' + fmtMoney(v.grand_total, v.currency) + '.',
        'Tap the button to see the details and approve or decline it.',
      ],
      ctaText: 'Review the change',
      ctaUrl: mailer.BASE_URL + '/v/' + token,
    });

    res.json({
      id: v.id, status: 'sent', approval_token: token,
      delivery: mail.delivery,
      emailed_to: mail.delivery === 'email' ? clientEmail : null,
    });
  } catch (err) {
    console.error('[Variations] send error:', err);
    res.status(500).json({ error: 'Failed to send variation.' });
  }
});

// GET /api/variations/:id/approval-url — owner-facing convenience
ownerRouter.get('/:id/approval-url', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    if (!v.approval_token) return res.status(400).json({ error: 'Not sent yet — send it first to mint a link.' });
    res.json({ token: v.approval_token, path: '/v/' + v.approval_token });
  } catch (err) {
    console.error('[Variations] approval-url error:', err);
    res.status(500).json({ error: 'Failed.' });
  }
});

// ─── PDF export ──────────────────────────────────────────────────────────────

function currencySymbol(code) { return code === 'EUR' ? '€' : '£'; }
function fmtMoney(n, code) {
  const v = num(n);
  return currencySymbol(code) + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

ownerRouter.get('/:id/pdf', (req, res) => {
  try {
    const v = getVariation(req.params.id, req.user.id);
    if (!v) return res.status(404).json({ error: 'Variation not found.' });
    const lines = getVariationLines(v.id);
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    const job = db.prepare('SELECT * FROM estimator_jobs WHERE id = ?').get(v.job_id);
    const cc = v.currency || 'GBP';

    const filename = (v.vo_number || 'variation') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const primary = branding.primary_colour || '#1B2A4A';
    const accent = branding.accent_colour || '#F59E0B';

    // Header band
    doc.rect(0, 0, doc.page.width, 90).fill(primary);
    let titleX = 40;
    if (branding.logo_filename) {
      const logoPath = path.join(brandingDir, branding.logo_filename);
      if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(branding.logo_filename)) {
        try { doc.image(logoPath, 40, 22, { fit: [120, 46] }); titleX = 175; } catch (e) {}
      }
    }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text(branding.company_name || userInfo?.company || userInfo?.full_name || 'Variation', titleX, 28);
    doc.font('Helvetica').fontSize(9)
      .text('Variation ' + (v.vo_number || ''), titleX, 56)
      .text(new Date(v.created_at || Date.now()).toLocaleDateString('en-GB'), titleX, 70);

    // Status banner (approved/declined)
    const statusBannerY = 92;
    if (v.status === 'approved') {
      doc.rect(0, statusBannerY, doc.page.width, 18).fill('#10B981');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('APPROVED', 40, statusBannerY + 4);
    } else if (v.status === 'declined') {
      doc.rect(0, statusBannerY, doc.page.width, 18).fill('#EF4444');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('DECLINED', 40, statusBannerY + 4);
    }

    // Meta block
    let y = (v.status === 'approved' || v.status === 'declined') ? 122 : 110;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14)
      .text(v.title || 'Change order', 40, y);
    y += 22;
    doc.font('Helvetica').fontSize(10).fillColor('#444444');
    if (job?.name) { doc.text('Job: ' + job.name + (job.client_name ? ' (' + job.client_name + ')' : ''), 40, y); y += 14; }
    if (v.reason) { doc.text('Reason: ' + v.reason, 40, y, { width: 515 }); y += doc.heightOfString('Reason: ' + v.reason, { width: 515 }) + 4; }

    // Lines header
    y += 8;
    doc.rect(40, y, 515, 18).fill(primary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('Description', 44, y + 5);
    doc.text('Qty', 320, y + 5, { width: 40, align: 'right' });
    doc.text('Unit', 365, y + 5);
    doc.text('Rate', 400, y + 5, { width: 70, align: 'right' });
    doc.text('Total', 475, y + 5, { width: 80, align: 'right' });
    y += 18;
    doc.fillColor('#111111').font('Helvetica').fontSize(9);

    // Lines
    function ensureRoom(h) {
      if (y + h > doc.page.height - 80) { doc.addPage(); y = 50; }
    }
    let runningNet = 0;
    for (const ln of lines) {
      const descText = (ln.item ? ln.item + ' — ' : '') + (ln.description || '');
      const descH = doc.heightOfString(descText, { width: 270 });
      const rowH = Math.max(14, descH + 4);
      ensureRoom(rowH);
      doc.text(descText, 44, y + 2, { width: 270 });
      doc.text(String(num(ln.qty)), 320, y + 2, { width: 40, align: 'right' });
      doc.text(String(ln.unit || ''), 365, y + 2);
      doc.text(fmtMoney(ln.rate, cc), 400, y + 2, { width: 70, align: 'right' });
      doc.text(fmtMoney(ln.line_total, cc), 475, y + 2, { width: 80, align: 'right' });
      doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + rowH).lineTo(555, y + rowH).stroke();
      runningNet += num(ln.line_total);
      y += rowH;
    }

    // Summary
    ensureRoom(100);
    y += 12;
    doc.rect(310, y, 245, 92).strokeColor(primary).lineWidth(1).stroke();
    let sy = y + 8;
    function row(label, value, bold) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111');
      doc.text(label, 318, sy, { width: 140 });
      doc.text(value, 460, sy, { width: 90, align: 'right' });
      sy += 16;
    }
    row('Net', fmtMoney(v.net_total, cc));
    row('Overheads & profit (' + num(v.ohp_pct).toFixed(1) + '%)', fmtMoney(v.ohp_amount, cc));
    row('VAT (' + num(v.vat_pct).toFixed(1) + '%)', fmtMoney(v.vat_amount, cc));
    sy += 2;
    doc.moveTo(315, sy).lineTo(550, sy).strokeColor('#cbd5e1').stroke();
    sy += 4;
    row('Grand Total', fmtMoney(v.grand_total, cc), true);
    y += 102;

    // Audit footer
    if (v.status === 'approved') {
      ensureRoom(70);
      y += 10;
      doc.rect(40, y, 515, 60).fill('#F0FDF4').strokeColor('#10B981').lineWidth(1).stroke();
      doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(10).text('Approved by client', 50, y + 8);
      doc.font('Helvetica').fontSize(9).fillColor('#065F46');
      doc.text('Name: ' + (v.approval_name || '—'), 50, y + 24);
      doc.text('Signed: ' + (v.approval_signature || '—'), 50, y + 38);
      doc.text('Date: ' + (v.approval_at || ''), 280, y + 24);
      doc.text('IP: ' + (v.approval_ip || '—'), 280, y + 38);
      y += 70;
      doc.fillColor('#111111');
    } else if (v.status === 'declined') {
      ensureRoom(50);
      y += 10;
      doc.rect(40, y, 515, 40).fill('#FEF2F2').strokeColor('#EF4444').lineWidth(1).stroke();
      doc.fillColor('#7F1D1D').font('Helvetica-Bold').fontSize(10).text('Declined by client', 50, y + 8);
      doc.font('Helvetica').fontSize(9).fillColor('#7F1D1D');
      doc.text('Reason: ' + (v.decline_reason || '—'), 50, y + 24, { width: 495 });
      y += 50;
      doc.fillColor('#111111');
    }

    // Notes
    if (v.notes) {
      ensureRoom(40);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(10).text('Notes', 40, y); y += 14;
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(v.notes, 40, y, { width: 515 });
      doc.fillColor('#111111');
    }

    // Footer
    const footY = doc.page.height - 50;
    doc.font('Helvetica').fontSize(8).fillColor('#666666')
      .text(branding.footer_text || 'This variation forms part of the contract upon client approval.', 40, footY, { width: 515, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[Variations] PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES (NO auth, NO estimator gate)
// ═══════════════════════════════════════════════════════════════════════════

// Look up by token without trusting the input directly — fetch by token then
// constant-time compare (sqlite lookup is already by exact match but we mirror
// the pattern used elsewhere in auth.js).
function findByToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  // Pull all sent/approved/declined rows that match — should always be 0 or 1.
  const row = db.prepare('SELECT * FROM estimator_variations WHERE approval_token = ?').get(token);
  if (!row || !safeEqual(row.approval_token || '', token)) return null;
  return row;
}

// A2: bell notification + email to the builder when the client decides.
function notifyOwnerOfDecision(v, decision, clientName, reason) {
  try {
    const job = db.prepare('SELECT name FROM estimator_jobs WHERE id = ?').get(v.job_id);
    const jobLabel = job?.name ? ' on ' + job.name : '';
    const summary = decision === 'approved'
      ? (clientName || 'The client') + ' approved the change' + jobLabel + ' for ' + fmtMoney(v.grand_total, v.currency) + ' (' + (v.vo_number || '') + ').'
      : 'The client declined the change' + jobLabel + ' (' + (v.vo_number || '') + ')' + (reason ? ': "' + reason.slice(0, 140) + '"' : '.');
    db.prepare('INSERT INTO user_messages (id, user_id, message) VALUES (?, ?, ?)').run(uuidv4(), v.user_id, summary);

    const owner = getUserDisplay(v.user_id);
    mailer.sendMail({
      userId: v.user_id,
      type: 'variation_' + decision,
      to: owner?.email,
      subject: decision === 'approved'
        ? 'Change approved' + jobLabel + ' — ' + fmtMoney(v.grand_total, v.currency)
        : 'Change declined' + jobLabel,
      heading: decision === 'approved' ? 'Your change was approved' : 'Your change was declined',
      paragraphs: [summary, decision === 'approved'
        ? 'The signed approval is saved on the variation — it forms part of the contract.'
        : 'You can duplicate it, adjust the price, and send a revised version.'],
      ctaText: 'Open the variation',
      ctaUrl: mailer.BASE_URL + '/change-orders/' + v.id,
    }).catch(() => {});
  } catch (err) {
    console.warn('[Variations] owner notification failed:', err.message);
  }
}

// Stream the builder's logo, but only when invoked from a valid approval link.
// Lets the public approval page render a branded header without exposing the
// auth-gated /api/branding/logo/:userId route.
publicRouter.get('/:token/logo', (req, res) => {
  try {
    const v = findByToken(req.params.token);
    if (!v) return res.status(404).end();
    const branding = getBranding(v.user_id);
    if (!branding.logo_filename) return res.status(404).end();
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (!fs.existsSync(logoPath)) return res.status(404).end();
    res.setHeader('Content-Type', branding.logo_mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(logoPath).pipe(res);
  } catch (err) {
    console.error('[Variations] public logo error:', err);
    if (!res.headersSent) res.status(500).end();
  }
});

publicRouter.get('/:token', (req, res) => {
  try {
    const v = findByToken(req.params.token);
    if (!v) return res.status(404).json({ error: 'This approval link is invalid or has been revoked.' });
    const lines = getVariationLines(v.id);
    const branding = getBranding(v.user_id);
    const user = getUserDisplay(v.user_id);
    user && (user.id = v.user_id);
    const job = db.prepare('SELECT * FROM estimator_jobs WHERE id = ?').get(v.job_id);
    res.json(publicShape(v, lines, branding, user, job));
  } catch (err) {
    console.error('[Variations] public get error:', err);
    res.status(500).json({ error: 'Failed to load.' });
  }
});

publicRouter.post('/:token/approve', (req, res) => {
  try {
    const v = findByToken(req.params.token);
    if (!v) return res.status(404).json({ error: 'This approval link is invalid or has been revoked.' });
    if (v.status === 'approved') return res.status(409).json({ error: 'Already approved.' });
    if (v.status === 'declined') {
      return res.status(409).json({ error: 'This variation was declined. Ask the builder to send a revised version.' });
    }
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 200);
    const signature = String(b.signature || '').trim().slice(0, 200);
    const email = String(b.email || '').trim().slice(0, 200) || null;
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!signature) return res.status(400).json({ error: 'Please type your name as a signature.' });

    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || req.connection?.remoteAddress || null;
    const ua = (req.headers['user-agent'] || '').toString().slice(0, 500) || null;

    db.prepare(
      'UPDATE estimator_variations SET status=?, locked=1, approval_name=?, approval_email=?, '
      + 'approval_signature=?, approval_ip=?, approval_user_agent=?, approval_at=CURRENT_TIMESTAMP, '
      + 'updated_at=CURRENT_TIMESTAMP WHERE id=? AND approval_token=?'
    ).run('approved', name, email, signature, ip, ua, v.id, req.params.token);

    // A2: tell the builder — notification bell + email.
    notifyOwnerOfDecision(v, 'approved', name);

    res.json({ ok: true, approved_at: new Date().toISOString() });
  } catch (err) {
    console.error('[Variations] approve error:', err);
    res.status(500).json({ error: 'Failed to record approval.' });
  }
});

publicRouter.post('/:token/decline', (req, res) => {
  try {
    const v = findByToken(req.params.token);
    if (!v) return res.status(404).json({ error: 'This approval link is invalid or has been revoked.' });
    if (v.locked || v.status === 'approved') return res.status(409).json({ error: 'Already finalised.' });
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 2000);

    db.prepare(
      'UPDATE estimator_variations SET status=?, decline_reason=?, decline_at=CURRENT_TIMESTAMP, '
      + 'updated_at=CURRENT_TIMESTAMP WHERE id=? AND approval_token=?'
    ).run('declined', reason || null, v.id, req.params.token);

    // A2: tell the builder — notification bell + email.
    notifyOwnerOfDecision(v, 'declined', null, reason);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Variations] decline error:', err);
    res.status(500).json({ error: 'Failed to record decline.' });
  }
});

module.exports = { ownerRouter, publicRouter };

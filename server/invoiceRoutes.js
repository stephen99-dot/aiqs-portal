// ═══════════════════════════════════════════════════════════════════════════════
// WAVE 3 — INVOICES & PAYMENTS — server/invoiceRoutes.js
//
// Invoices and payment schedules. An invoice can be standalone, pre-filled from
// a saved quote, or attached to an estimator_job. A payment schedule is a list
// of staged payments on a job (deposit / interim / retention / final) used for
// cashflow visibility — not for payment processing.
//
// Stripe payment link is optional and gated by STRIPE_SECRET_KEY in the env.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

// ─── helpers ────────────────────────────────────────────────────────────────

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function round2(n) { return Math.round(n * 100) / 100; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function dueDateFromTerms(issueDate, days) {
  const d = new Date(issueDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (parseInt(days, 10) || 30));
  return d.toISOString().slice(0, 10);
}

function nextInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const prefix = 'INV-' + year + '-';
  const lastRow = db.prepare(
    "SELECT invoice_number FROM invoices WHERE user_id = ? AND invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1"
  ).get(userId, prefix + '%');
  let next = 1;
  if (lastRow && lastRow.invoice_number) {
    const m = lastRow.invoice_number.match(/(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

function getInvoice(id, userId) {
  return db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, userId);
}
function getInvoiceLines(invoiceId) {
  return db.prepare(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC, rowid ASC'
  ).all(invoiceId);
}

function computeTotals(lines, opts) {
  const vatPct = num(opts.vat_pct);
  const discount = num(opts.discount_amount);
  let net = 0;
  for (const ln of lines) {
    const qty = num(ln.qty);
    const rate = num(ln.rate);
    ln.line_total = round2(qty * rate);
    net += ln.line_total;
  }
  const beforeVat = Math.max(0, net - discount);
  const vat = beforeVat * (vatPct / 100);
  const grand = beforeVat + vat;
  return {
    net_total: round2(net),
    discount_amount: round2(discount),
    vat_pct: vatPct,
    vat_amount: round2(vat),
    grand_total: round2(grand),
  };
}

function rejectIfPaid(inv, res) {
  if (inv.status === 'paid') {
    res.status(423).json({ error: 'Paid invoices are immutable. Void and reissue if you need to change it.', code: 'INVOICE_PAID' });
    return true;
  }
  return false;
}

function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = {
      logo_filename: null, primary_colour: '#1B2A4A', accent_colour: '#F59E0B',
      company_name: null, company_address: null, footer_text: null,
    };
  }
  return row;
}
function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(userId);
}

// Compute "overdue" — invoice was sent, due date in the past, not paid/void.
function overdueState(inv) {
  if (inv.status !== 'sent') return false;
  if (!inv.due_date) return false;
  return inv.due_date < todayIso();
}

// ═══════════════════════════════════════════════════════════════════════════
//  INVOICES
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/invoices
router.get('/', (req, res) => {
  try {
    const status = (req.query.status || '').toString();
    const jobId = (req.query.job_id || '').toString();
    let sql = 'SELECT * FROM invoices WHERE user_id = ?';
    const params = [req.user.id];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (jobId) { sql += ' AND job_id = ?'; params.push(jobId); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const rows = db.prepare(sql).all(...params);
    res.json({ invoices: rows.map(r => ({ ...r, overdue: overdueState(r) })) });
  } catch (err) {
    console.error('[Invoices] list error:', err);
    res.status(500).json({ error: 'Failed to load invoices.' });
  }
});

// POST /api/invoices — create. Body may include from_quote_id to deep-copy lines.
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const userId = req.user.id;

    // If linked to a job, validate ownership.
    let job = null;
    if (b.job_id) {
      job = db.prepare('SELECT * FROM estimator_jobs WHERE id = ? AND user_id = ?').get(b.job_id, userId);
      if (!job) return res.status(400).json({ error: 'Invalid job_id.' });
    }

    // Optional: pre-fill from a quote (deep-copy lines).
    let seededLines = [];
    let seededClient = null;
    let seededVat = num(b.vat_pct, 20);
    let seededCurrency = b.currency || 'GBP';
    if (b.from_quote_id) {
      const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(b.from_quote_id, userId);
      if (!q) return res.status(400).json({ error: 'Quote not found.' });
      const qLines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);
      seededLines = qLines.map(l => ({
        section: l.section, item: l.item, description: l.description,
        unit: l.unit, qty: l.qty, rate: l.rate,
        line_total: l.line_total, sort_order: l.sort_order,
      }));
      if (!b.client_name) seededClient = q.client_name;
      if (b.vat_pct == null) seededVat = num(q.vat_pct, 20);
      seededCurrency = b.currency || q.currency || 'GBP';
    }

    const lines = (Array.isArray(b.lines) && b.lines.length > 0) ? b.lines : seededLines;
    const totals = computeTotals(lines, { vat_pct: seededVat, discount_amount: b.discount_amount });

    const id = uuidv4();
    const invoiceNumber = nextInvoiceNumber(userId);
    const issueDate = b.issue_date || todayIso();
    const paymentTermsDays = num(b.payment_terms_days, 30);
    const dueDate = b.due_date || dueDateFromTerms(issueDate, paymentTermsDays);

    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO invoices (id, user_id, job_id, quote_id, invoice_number, client_name, client_email, '
        + 'client_address, currency, issue_date, due_date, payment_terms_days, notes, net_total, '
        + 'discount_amount, vat_pct, vat_amount, grand_total, status) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, userId, b.job_id || null, b.from_quote_id || b.quote_id || null,
        invoiceNumber,
        (b.client_name || seededClient || job?.client_name || '').toString().slice(0, 200) || null,
        (b.client_email || '').toString().slice(0, 200) || null,
        (b.client_address || '').toString().slice(0, 1000) || null,
        seededCurrency,
        issueDate, dueDate, paymentTermsDays,
        (b.notes || '').toString().slice(0, 4000) || null,
        totals.net_total, totals.discount_amount, totals.vat_pct, totals.vat_amount, totals.grand_total,
        'draft'
      );
      const ins = db.prepare(
        'INSERT INTO invoice_lines (id, invoice_id, section, item, description, unit, qty, rate, line_total, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let order = 0;
      for (const ln of lines) {
        ins.run(
          uuidv4(), id,
          (ln.section || '').toString().slice(0, 80) || null,
          (ln.item || '').toString().slice(0, 200) || null,
          (ln.description || '').toString().slice(0, 500),
          (ln.unit || 'item').toString().slice(0, 20),
          num(ln.qty), num(ln.rate),
          num(ln.line_total) || round2(num(ln.qty) * num(ln.rate)),
          ln.sort_order != null ? num(ln.sort_order) : order++
        );
      }
    });
    txn();

    res.status(201).json({ id, invoice_number: invoiceNumber });
  } catch (err) {
    console.error('[Invoices] create error:', err);
    res.status(500).json({ error: 'Failed to create invoice.' });
  }
});

// GET /api/invoices/:id
router.get('/:id', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    const lines = getInvoiceLines(inv.id);
    res.json({ invoice: { ...inv, overdue: overdueState(inv) }, lines });
  } catch (err) {
    console.error('[Invoices] get error:', err);
    res.status(500).json({ error: 'Failed to load invoice.' });
  }
});

// PATCH /api/invoices/:id
router.patch('/:id', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (rejectIfPaid(inv, res)) return;
    const b = req.body || {};
    const allowed = ['client_name', 'client_email', 'client_address', 'currency', 'issue_date',
      'due_date', 'payment_terms_days', 'notes', 'vat_pct', 'discount_amount', 'job_id', 'status'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (k in b) {
        if (k === 'status' && !['draft', 'sent', 'paid', 'void'].includes(b[k])) continue;
        sets.push(k + ' = ?');
        vals.push(b[k] == null ? null : b[k]);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(inv.id);
      db.prepare('UPDATE invoices SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
      // If vat_pct or discount_amount changed, recompute totals.
      if ('vat_pct' in b || 'discount_amount' in b) {
        const lines = getInvoiceLines(inv.id);
        const newPcts = {
          vat_pct: 'vat_pct' in b ? b.vat_pct : inv.vat_pct,
          discount_amount: 'discount_amount' in b ? b.discount_amount : inv.discount_amount,
        };
        const t = computeTotals(lines, newPcts);
        db.prepare(
          'UPDATE invoices SET net_total=?, discount_amount=?, vat_amount=?, grand_total=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(t.net_total, t.discount_amount, t.vat_amount, t.grand_total, inv.id);
      }
    }
    res.json({ id: inv.id });
  } catch (err) {
    console.error('[Invoices] patch error:', err);
    res.status(500).json({ error: 'Failed to update invoice.' });
  }
});

// PUT /api/invoices/:id/lines
router.put('/:id/lines', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (rejectIfPaid(inv, res)) return;
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const totals = computeTotals(lines, { vat_pct: inv.vat_pct, discount_amount: inv.discount_amount });

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(inv.id);
      const ins = db.prepare(
        'INSERT INTO invoice_lines (id, invoice_id, section, item, description, unit, qty, rate, line_total, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let order = 0;
      for (const ln of lines) {
        ins.run(
          uuidv4(), inv.id,
          (ln.section || '').toString().slice(0, 80) || null,
          (ln.item || '').toString().slice(0, 200) || null,
          (ln.description || '').toString().slice(0, 500),
          (ln.unit || 'item').toString().slice(0, 20),
          num(ln.qty), num(ln.rate),
          num(ln.line_total) || round2(num(ln.qty) * num(ln.rate)),
          ln.sort_order != null ? num(ln.sort_order) : order++
        );
      }
      db.prepare(
        'UPDATE invoices SET net_total=?, vat_amount=?, grand_total=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(totals.net_total, totals.vat_amount, totals.grand_total, inv.id);
    });
    txn();
    res.json({ id: inv.id, ...totals });
  } catch (err) {
    console.error('[Invoices] update lines error:', err);
    res.status(500).json({ error: 'Failed to update invoice.' });
  }
});

// POST /api/invoices/:id/duplicate
router.post('/:id/duplicate', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    const lines = getInvoiceLines(inv.id);
    const newId = uuidv4();
    const newNumber = nextInvoiceNumber(req.user.id);
    const issueDate = todayIso();
    const dueDate = dueDateFromTerms(issueDate, inv.payment_terms_days || 30);

    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO invoices (id, user_id, job_id, quote_id, invoice_number, client_name, client_email, '
        + 'client_address, currency, issue_date, due_date, payment_terms_days, notes, net_total, '
        + 'discount_amount, vat_pct, vat_amount, grand_total, status) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId, req.user.id, inv.job_id, inv.quote_id, newNumber,
        inv.client_name, inv.client_email, inv.client_address,
        inv.currency, issueDate, dueDate, inv.payment_terms_days,
        inv.notes,
        inv.net_total, inv.discount_amount, inv.vat_pct, inv.vat_amount, inv.grand_total,
        'draft'
      );
      const ins = db.prepare(
        'INSERT INTO invoice_lines (id, invoice_id, section, item, description, unit, qty, rate, line_total, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const ln of lines) {
        ins.run(uuidv4(), newId, ln.section, ln.item, ln.description, ln.unit, ln.qty, ln.rate, ln.line_total, ln.sort_order);
      }
    });
    txn();
    res.status(201).json({ id: newId, invoice_number: newNumber });
  } catch (err) {
    console.error('[Invoices] duplicate error:', err);
    res.status(500).json({ error: 'Failed to duplicate invoice.' });
  }
});

// DELETE /api/invoices/:id  — not allowed if paid
router.delete('/:id', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.status === 'paid') {
      return res.status(423).json({ error: 'Paid invoices cannot be deleted. Void it instead.', code: 'INVOICE_PAID' });
    }
    const txn = db.transaction(() => {
      // Unlink any payment schedule rows pointing at this invoice.
      db.prepare('UPDATE payment_schedules SET invoice_id = NULL WHERE invoice_id = ?').run(inv.id);
      db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(inv.id);
      db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
    });
    txn();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Invoices] delete error:', err);
    res.status(500).json({ error: 'Failed to delete invoice.' });
  }
});

// POST /api/invoices/:id/send
router.post('/:id/send', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (rejectIfPaid(inv, res)) return;
    const issueDate = inv.issue_date || todayIso();
    const dueDate = inv.due_date || dueDateFromTerms(issueDate, inv.payment_terms_days || 30);
    db.prepare(
      "UPDATE invoices SET status = 'sent', issue_date = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(issueDate, dueDate, inv.id);
    res.json({ id: inv.id, status: 'sent', issue_date: issueDate, due_date: dueDate });
  } catch (err) {
    console.error('[Invoices] send error:', err);
    res.status(500).json({ error: 'Failed to send invoice.' });
  }
});

// POST /api/invoices/:id/mark-paid
router.post('/:id/mark-paid', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    const b = req.body || {};
    const paidAmount = b.paid_amount != null ? num(b.paid_amount) : num(inv.grand_total);
    const paidAtIso = b.paid_at || new Date().toISOString();
    db.prepare(
      "UPDATE invoices SET status='paid', paid_amount=?, paid_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).run(paidAmount, paidAtIso, inv.id);
    res.json({ id: inv.id, status: 'paid', paid_amount: paidAmount, paid_at: paidAtIso });
  } catch (err) {
    console.error('[Invoices] mark-paid error:', err);
    res.status(500).json({ error: 'Failed to mark paid.' });
  }
});

// POST /api/invoices/:id/void  — keep the row for audit but stop counting it
router.post('/:id/void', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    db.prepare("UPDATE invoices SET status='void', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(inv.id);
    res.json({ id: inv.id, status: 'void' });
  } catch (err) {
    console.error('[Invoices] void error:', err);
    res.status(500).json({ error: 'Failed to void invoice.' });
  }
});

// ─── Stripe link (opt-in) ───────────────────────────────────────────────────

// POST /api/invoices/:id/stripe-link
// Mints a one-off Stripe Checkout payment link for this invoice's grand total.
// Optional — returns 503 with STRIPE_NOT_CONFIGURED if no STRIPE_SECRET_KEY.
// TODO: wire to billing — production rollout needs a webhook handler to flip
// invoices.status to 'paid' on payment_intent.succeeded.
router.post('/:id/stripe-link', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.', code: 'STRIPE_NOT_CONFIGURED' });
    }
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'Already paid.' });
    if (num(inv.grand_total) <= 0) return res.status(400).json({ error: 'Invoice total must be > 0.' });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const currency = (inv.currency || 'GBP').toLowerCase();
    const amount = Math.round(num(inv.grand_total) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: 'Invoice ' + (inv.invoice_number || inv.id.slice(0, 8)),
            description: inv.client_name ? 'For ' + inv.client_name : undefined,
          },
        },
      }],
      metadata: { invoice_id: inv.id, user_id: req.user.id },
    });

    db.prepare(
      'UPDATE invoices SET stripe_payment_link=?, stripe_payment_intent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(session.url, session.payment_intent || null, inv.id);

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Invoices] stripe-link error:', err);
    res.status(500).json({ error: 'Failed to create Stripe link.' });
  }
});

// ─── PDF ────────────────────────────────────────────────────────────────────

function currencySymbol(code) { return code === 'EUR' ? '€' : '£'; }
function fmtMoney(n, code) {
  const v = num(n);
  return currencySymbol(code) + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

router.get('/:id/pdf', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    const lines = getInvoiceLines(inv.id);
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    const cc = inv.currency || 'GBP';

    const filename = (inv.invoice_number || 'invoice') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const primary = branding.primary_colour || '#1B2A4A';

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
      .text(branding.company_name || userInfo?.company || userInfo?.full_name || 'Invoice', titleX, 28);
    doc.font('Helvetica').fontSize(9)
      .text('Invoice ' + (inv.invoice_number || ''), titleX, 56)
      .text('Issued ' + (inv.issue_date || ''), titleX, 70);

    // Status banner
    let topY = 92;
    if (inv.status === 'paid') {
      doc.rect(0, topY, doc.page.width, 18).fill('#10B981');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('PAID', 40, topY + 4);
      topY += 18;
    } else if (inv.status === 'void') {
      doc.rect(0, topY, doc.page.width, 18).fill('#94A3B8');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('VOID', 40, topY + 4);
      topY += 18;
    } else if (overdueState(inv)) {
      doc.rect(0, topY, doc.page.width, 18).fill('#EF4444');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('OVERDUE', 40, topY + 4);
      topY += 18;
    }

    // Two-column block: bill to + company details + dates
    let y = topY + 20;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text('Bill to', 40, y);
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    let by = y + 14;
    if (inv.client_name) { doc.text(inv.client_name, 40, by); by += 13; }
    if (inv.client_address) {
      const lns = String(inv.client_address).split(/\r?\n/);
      for (const ln of lns) { doc.text(ln, 40, by); by += 12; }
    }
    if (inv.client_email) { doc.text(inv.client_email, 40, by); by += 12; }

    // Right column
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text('Invoice details', 320, y, { width: 235 });
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text('Invoice no.: ' + (inv.invoice_number || ''), 320, y + 14, { width: 235 });
    doc.text('Issued: ' + (inv.issue_date || ''), 320, y + 28, { width: 235 });
    doc.text('Due: ' + (inv.due_date || ''), 320, y + 42, { width: 235 });
    if (branding.company_address) {
      const lns = String(branding.company_address).split(/\r?\n/).slice(0, 3);
      let ry = y + 60;
      for (const ln of lns) { doc.text(ln, 320, ry, { width: 235 }); ry += 12; }
    }

    y = Math.max(by, y + 80) + 10;

    // Lines header
    doc.rect(40, y, 515, 18).fill(primary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('Description', 44, y + 5);
    doc.text('Qty',  330, y + 5, { width: 40, align: 'right' });
    doc.text('Unit', 375, y + 5);
    doc.text('Rate', 410, y + 5, { width: 65, align: 'right' });
    doc.text('Total',480, y + 5, { width: 75, align: 'right' });
    y += 18;
    doc.fillColor('#111111').font('Helvetica').fontSize(9);

    function ensureRoom(h) {
      if (y + h > doc.page.height - 80) { doc.addPage(); y = 50; }
    }

    for (const ln of lines) {
      const descText = (ln.item ? ln.item + ' — ' : '') + (ln.description || '');
      const descH = doc.heightOfString(descText, { width: 280 });
      const rowH = Math.max(14, descH + 4);
      ensureRoom(rowH);
      doc.text(descText, 44, y + 2, { width: 280 });
      doc.text(String(num(ln.qty)), 330, y + 2, { width: 40, align: 'right' });
      doc.text(String(ln.unit || ''), 375, y + 2);
      doc.text(fmtMoney(ln.rate, cc), 410, y + 2, { width: 65, align: 'right' });
      doc.text(fmtMoney(ln.line_total, cc), 480, y + 2, { width: 75, align: 'right' });
      doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + rowH).lineTo(555, y + rowH).stroke();
      y += rowH;
    }

    // Summary
    ensureRoom(110);
    y += 10;
    doc.rect(310, y, 245, 100).strokeColor(primary).lineWidth(1).stroke();
    let sy = y + 8;
    function row(label, value, bold) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111');
      doc.text(label, 318, sy, { width: 140 });
      doc.text(value, 460, sy, { width: 90, align: 'right' });
      sy += 16;
    }
    row('Net', fmtMoney(inv.net_total, cc));
    if (num(inv.discount_amount) > 0) row('Discount', '−' + fmtMoney(inv.discount_amount, cc));
    row('VAT (' + num(inv.vat_pct).toFixed(1) + '%)', fmtMoney(inv.vat_amount, cc));
    sy += 2;
    doc.moveTo(315, sy).lineTo(550, sy).strokeColor('#cbd5e1').stroke();
    sy += 4;
    row('Amount due', fmtMoney(inv.grand_total, cc), true);
    if (inv.status === 'paid' && num(inv.paid_amount) > 0) {
      row('Paid', fmtMoney(inv.paid_amount, cc));
    }
    y += 110;

    // Notes / terms
    if (inv.notes) {
      ensureRoom(60);
      y += 8;
      doc.font('Helvetica-Bold').fontSize(10).text('Payment terms / notes', 40, y); y += 14;
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(inv.notes, 40, y, { width: 515 });
      doc.fillColor('#111111');
    }

    const footY = doc.page.height - 50;
    doc.font('Helvetica').fontSize(8).fillColor('#666666')
      .text(branding.footer_text || ('Payment due by ' + (inv.due_date || 'the due date') + '. Please reference the invoice number when paying.'), 40, footY, { width: 515, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[Invoices] PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// ─── Aggregates for the finance dashboard ──────────────────────────────────

router.get('/_aggregates/dashboard', (req, res) => {
  try {
    const userId = req.user.id;
    const today = todayIso();
    const monthStart = today.slice(0, 7) + '-01';
    const outstanding = db.prepare(
      "SELECT COUNT(*) as c, COALESCE(SUM(grand_total),0) as v FROM invoices WHERE user_id = ? AND status = 'sent'"
    ).get(userId);
    const paidThisMonth = db.prepare(
      "SELECT COUNT(*) as c, COALESCE(SUM(paid_amount),0) as v FROM invoices WHERE user_id = ? AND status = 'paid' AND paid_at >= ?"
    ).get(userId, monthStart);
    const overdue = db.prepare(
      "SELECT COUNT(*) as c, COALESCE(SUM(grand_total),0) as v FROM invoices WHERE user_id = ? AND status = 'sent' AND due_date < ?"
    ).get(userId, today);
    res.json({
      outstanding: { count: outstanding.c, value: round2(outstanding.v) },
      paid_this_month: { count: paidThisMonth.c, value: round2(paidThisMonth.v) },
      overdue: { count: overdue.c, value: round2(overdue.v) },
    });
  } catch (err) {
    console.error('[Invoices] aggregates error:', err);
    res.status(500).json({ error: 'Failed to load invoice aggregates.' });
  }
});

module.exports = router;

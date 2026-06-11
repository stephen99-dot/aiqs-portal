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
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');
const { streamInvoicePdf, invoicePdfBuffer } = require('./invoicePdf');
const mailer = require('./mailer');

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

// Same token scheme as quote/variation share links — powers /i/<token>.
function newShareToken() {
  return crypto.randomBytes(24).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function getInvoiceLines(invoiceId) {
  return db.prepare(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC, rowid ASC'
  ).all(invoiceId);
}

function computeTotals(lines, opts) {
  const vatPct = num(opts.vat_pct);
  const discount = num(opts.discount_amount);
  const reverseCharge = opts.reverse_charge ? 1 : 0;
  const cisApplies = opts.cis_applies ? 1 : 0;
  const cisRate = num(opts.cis_rate, 20);
  let net = 0;
  let labour = 0;
  for (const ln of lines) {
    const qty = num(ln.qty);
    const rate = num(ln.rate);
    ln.line_total = round2(qty * rate);
    net += ln.line_total;
    if (ln.is_labour) labour += ln.line_total;
  }
  const beforeVat = Math.max(0, net - discount);
  // A4 — domestic reverse charge: no VAT is charged here; the customer
  // accounts for it to HMRC (the PDF prints the required wording + amount).
  const vat = reverseCharge ? 0 : beforeVat * (vatPct / 100);
  const grand = beforeVat + vat;
  // A4 — CIS: the deduction applies to the labour element only, ex VAT.
  // grand_total stays the gross; deduction and net payable show on the PDF.
  return {
    net_total: round2(net),
    discount_amount: round2(discount),
    vat_pct: vatPct,
    vat_amount: round2(vat),
    grand_total: round2(grand),
    cis_labour_total: cisApplies ? round2(labour) : 0,
    cis_deduction: cisApplies ? round2(labour * (cisRate / 100)) : 0,
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

    // Optional: pre-fill from a quote. Full copy of the lines, or — B5 — a
    // percentage of the quote ("Invoice the deposit (25%)") as one line on
    // the ex-VAT contract value; VAT is then added by the invoice itself.
    let seededLines = [];
    let seededClient = null;
    let seededVat = num(b.vat_pct, 20);
    let seededCurrency = b.currency || 'GBP';
    if (b.from_quote_id) {
      const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(b.from_quote_id, userId);
      if (!q) return res.status(400).json({ error: 'Quote not found.' });
      const pct = num(b.percent, 100);
      if (pct > 0 && pct < 100) {
        const exVat = num(q.grand_total) - num(q.vat_amount);
        seededLines = [{
          description: (String(b.stage_label || '').slice(0, 120) || pct + '% payment')
            + ' — ' + (q.project_name || 'as quoted')
            + (q.quote_number ? ' (' + q.quote_number + ')' : ''),
          unit: 'item', qty: 1, rate: round2(exVat * pct / 100),
        }];
      } else {
        const qLines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);
        seededLines = qLines.map(l => ({
          section: l.section, item: l.item, description: l.description,
          unit: l.unit, qty: l.qty, rate: l.rate,
          line_total: l.line_total, sort_order: l.sort_order,
        }));
      }
      if (!b.client_name) seededClient = q.client_name;
      if (b.vat_pct == null) seededVat = num(q.vat_pct, 20);
      seededCurrency = b.currency || q.currency || 'GBP';
      if (!b.job_id && q.job_id) b.job_id = q.job_id; // keep it on the job automatically
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
      'due_date', 'payment_terms_days', 'notes', 'vat_pct', 'discount_amount', 'job_id', 'status',
      'reminders_enabled', 'cis_applies', 'cis_rate', 'reverse_charge', 'client_vat_number'];
    // Turning CIS on without a rate: default from the builder's Tax & CIS
    // settings (20 verified / 30 unverified).
    if (b.cis_applies && !('cis_rate' in b) && inv.cis_rate == null) {
      b.cis_rate = num(getOibSettings(req.user.id).cis_default_rate, 20);
    }
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
      // Recompute totals if anything that feeds them changed.
      const totalsKeys = ['vat_pct', 'discount_amount', 'cis_applies', 'cis_rate', 'reverse_charge'];
      if (totalsKeys.some(k => k in b)) {
        const lines = getInvoiceLines(inv.id);
        const fresh = getInvoice(inv.id, req.user.id);
        const t = computeTotals(lines, fresh);
        db.prepare(
          'UPDATE invoices SET net_total=?, discount_amount=?, vat_amount=?, grand_total=?, cis_labour_total=?, cis_deduction=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(t.net_total, t.discount_amount, t.vat_amount, t.grand_total, t.cis_labour_total, t.cis_deduction, inv.id);
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
    const totals = computeTotals(lines, inv);

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(inv.id);
      const ins = db.prepare(
        'INSERT INTO invoice_lines (id, invoice_id, section, item, description, unit, qty, rate, line_total, is_labour, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          ln.is_labour ? 1 : 0,
          ln.sort_order != null ? num(ln.sort_order) : order++
        );
      }
      db.prepare(
        'UPDATE invoices SET net_total=?, vat_amount=?, grand_total=?, cis_labour_total=?, cis_deduction=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(totals.net_total, totals.vat_amount, totals.grand_total, totals.cis_labour_total, totals.cis_deduction, inv.id);
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
        + 'discount_amount, vat_pct, vat_amount, grand_total, status, '
        + 'cis_applies, cis_rate, cis_labour_total, cis_deduction, reverse_charge, client_vat_number) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId, req.user.id, inv.job_id, inv.quote_id, newNumber,
        inv.client_name, inv.client_email, inv.client_address,
        inv.currency, issueDate, dueDate, inv.payment_terms_days,
        inv.notes,
        inv.net_total, inv.discount_amount, inv.vat_pct, inv.vat_amount, inv.grand_total,
        'draft',
        inv.cis_applies || 0, inv.cis_rate, inv.cis_labour_total || 0, inv.cis_deduction || 0,
        inv.reverse_charge || 0, inv.client_vat_number
      );
      const ins = db.prepare(
        'INSERT INTO invoice_lines (id, invoice_id, section, item, description, unit, qty, rate, line_total, is_labour, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const ln of lines) {
        ins.run(uuidv4(), newId, ln.section, ln.item, ln.description, ln.unit, ln.qty, ln.rate, ln.line_total, ln.is_labour || 0, ln.sort_order);
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

// POST /api/invoices/:id/send — really send it (A2): mint the public
// /i/<token> link, email the client the PDF when SMTP + a client email exist,
// and always hand back the shareable link for WhatsApp/text.
router.post('/:id/send', async (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (rejectIfPaid(inv, res)) return;
    const issueDate = inv.issue_date || todayIso();
    const dueDate = inv.due_date || dueDateFromTerms(issueDate, inv.payment_terms_days || 30);
    const token = inv.public_token || newShareToken();
    db.prepare(
      "UPDATE invoices SET status = 'sent', issue_date = ?, due_date = ?, public_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(issueDate, dueDate, token, inv.id);

    const fresh = getInvoice(inv.id, req.user.id);
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    const companyName = branding.company_name || userInfo?.company || userInfo?.full_name || 'your builder';
    const link = mailer.BASE_URL + '/i/' + token;

    let attachments = [];
    if (fresh.client_email && mailer.isConfigured()) {
      try {
        const pdf = await invoicePdfBuffer(fresh, getInvoiceLines(fresh.id), branding, userInfo);
        attachments = [{ filename: (fresh.invoice_number || 'invoice') + '.pdf', content: pdf }];
      } catch (e) {
        console.error('[Invoices] PDF attach failed:', e.message);
      }
    }
    const mail = await mailer.sendMail({
      userId: req.user.id,
      type: 'invoice_send',
      to: fresh.client_email || null,
      subject: 'Invoice ' + (fresh.invoice_number || '') + ' from ' + companyName,
      heading: 'Invoice ' + (fresh.invoice_number || ''),
      paragraphs: [
        'Please find your invoice from ' + companyName + (fresh.client_name ? ' for ' + fresh.client_name : '') + '.',
        'Amount due: ' + fmtMoney(fresh.grand_total, fresh.currency) + (dueDate ? ', due by ' + dueDate + '.' : '.'),
        'The invoice is attached as a PDF, or you can view it online below.',
      ],
      ctaText: 'View the invoice',
      ctaUrl: link,
      attachments,
    });

    res.json({
      id: inv.id, status: 'sent', issue_date: issueDate, due_date: dueDate,
      token, path: '/i/' + token,
      delivery: mail.delivery,
      emailed_to: mail.delivery === 'email' ? fresh.client_email : null,
    });
  } catch (err) {
    console.error('[Invoices] send error:', err);
    res.status(500).json({ error: 'Failed to send invoice.' });
  }
});

// GET /api/invoices/:id/share-url — fetch the public link again later.
router.get('/:id/share-url', (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (!inv.public_token) return res.status(400).json({ error: 'Not sent yet — send it first to get a link.' });
    res.json({ token: inv.public_token, path: '/i/' + inv.public_token });
  } catch (err) {
    console.error('[Invoices] share-url error:', err);
    res.status(500).json({ error: 'Failed.' });
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

// ─── Stripe "Pay now" link (opt-in) ─────────────────────────────────────────

function getOibSettings(userId) {
  db.prepare('INSERT OR IGNORE INTO oib_settings (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM oib_settings WHERE user_id = ?').get(userId);
}

// POST /api/invoices/:id/stripe-link
// Mints a one-off Stripe Checkout payment link for this invoice. The webhook
// (stripe-webhook.js) marks the invoice paid on checkout completion via the
// invoice_id metadata. Card fees follow the builder's setting: 'absorb'
// charges the invoice total; 'add' puts the processing fee on top.
// Optional — returns 503 with STRIPE_NOT_CONFIGURED if no STRIPE_SECRET_KEY.
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

    const settings = getOibSettings(req.user.id);
    let chargeTotal = num(inv.grand_total);
    let feeAdded = 0;
    if (settings.card_fee_mode === 'add') {
      feeAdded = round2(chargeTotal * (num(settings.card_fee_pct, 1.5) / 100) + num(settings.card_fee_fixed, 0.20));
      chargeTotal = round2(chargeTotal + feeAdded);
    }
    const amount = Math.round(chargeTotal * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: 'Invoice ' + (inv.invoice_number || inv.id.slice(0, 8)),
            description: [
              inv.client_name ? 'For ' + inv.client_name : null,
              feeAdded > 0 ? 'Includes ' + fmtMoney(feeAdded, inv.currency) + ' card processing fee' : null,
            ].filter(Boolean).join(' · ') || undefined,
          },
        },
      }],
      metadata: { invoice_id: inv.id, user_id: req.user.id },
    });

    db.prepare(
      'UPDATE invoices SET stripe_payment_link=?, stripe_payment_intent_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ).run(session.url, session.payment_intent || null, inv.id);

    res.json({ url: session.url, fee_added: feeAdded });
  } catch (err) {
    console.error('[Invoices] stripe-link error:', err);
    res.status(500).json({ error: 'Failed to create Stripe link.' });
  }
});

// ─── A3: "Chase this payment" — drafted by AI, approved by the builder ──────

const CHASER_SYSTEM = `You draft payment-chasing emails for a UK builder. Firm but always polite and professional — the client relationship matters more than this one invoice. Plain English, no legalese, no threats. 3 short paragraphs maximum. Sign off with the company name only (no placeholder names). Use ONLY the facts provided — never invent amounts, dates or names.`;

// POST /api/invoices/:id/chase-draft — returns { subject, body } for approval.
// NEVER sends anything itself.
router.post('/:id/chase-draft', async (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'This invoice is already paid.' });
    if (inv.status === 'void') return res.status(400).json({ error: 'This invoice is void.' });

    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    const companyName = branding.company_name || userInfo?.company || userInfo?.full_name || 'the builder';
    const job = inv.job_id ? db.prepare('SELECT name FROM estimator_jobs WHERE id = ?').get(inv.job_id) : null;
    const today = todayIso();
    const daysOverdue = inv.due_date && inv.due_date < today
      ? Math.round((new Date(today) - new Date(inv.due_date)) / 86400000)
      : 0;

    const facts = [
      'Company: ' + companyName,
      'Client: ' + (inv.client_name || 'the client'),
      'Invoice number: ' + (inv.invoice_number || ''),
      'Amount due: ' + fmtMoney(inv.grand_total, inv.currency),
      'Issue date: ' + (inv.issue_date || 'unknown'),
      'Due date: ' + (inv.due_date || 'unknown'),
      daysOverdue > 0 ? 'Days overdue: ' + daysOverdue : 'Not yet overdue (chasing ahead of the due date)',
      job?.name ? 'Job: ' + job.name : null,
    ].filter(Boolean).join('\n');

    const { callModel, MODELS } = require('./anthropicClient');
    const result = await callModel({
      model: MODELS.FAST,
      maxTokens: 700,
      temperature: 0.4,
      system: CHASER_SYSTEM,
      messages: [{ role: 'user', content: 'Draft the chaser email now.\n\nFACTS:\n' + facts }],
      tools: [{
        name: 'submit_email',
        description: 'Submit the drafted chaser email.',
        input_schema: {
          type: 'object',
          properties: { subject: { type: 'string' }, body: { type: 'string' } },
          required: ['subject', 'body'],
        },
      }],
      toolChoice: { type: 'tool', name: 'submit_email' },
      userId: req.user.id,
      action: 'invoice_chase_draft',
    });
    if (!result.ok || !result.json) {
      return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
    }

    res.json({
      subject: String(result.json.subject || '').slice(0, 200),
      body: String(result.json.body || '').slice(0, 4000),
      can_email: !!(inv.client_email && mailer.isConfigured()),
      client_email: inv.client_email || null,
      days_overdue: daysOverdue,
    });
  } catch (err) {
    console.error('[Invoices] chase-draft error:', err);
    res.status(500).json({ error: 'Failed to draft the chaser.' });
  }
});

// POST /api/invoices/:id/chase-send { subject, body } — sends the (possibly
// edited) chaser with the invoice PDF attached. Only ever called after the
// builder has seen and approved the draft.
router.post('/:id/chase-send', async (req, res) => {
  try {
    const inv = getInvoice(req.params.id, req.user.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'This invoice is already paid.' });
    if (!inv.client_email) return res.status(400).json({ error: "Add the client's email to the invoice first." });
    if (!mailer.isConfigured()) return res.status(503).json({ error: 'Email is not set up on the server — copy the message and send it by WhatsApp or text instead.', code: 'MAIL_NOT_CONFIGURED' });

    const b = req.body || {};
    const subject = String(b.subject || '').trim().slice(0, 200);
    const bodyText = String(b.body || '').trim().slice(0, 4000);
    if (!subject || !bodyText) return res.status(400).json({ error: 'Subject and message are both needed.' });

    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    let attachments = [];
    try {
      const pdf = await invoicePdfBuffer(inv, getInvoiceLines(inv.id), branding, userInfo);
      attachments = [{ filename: (inv.invoice_number || 'invoice') + '.pdf', content: pdf }];
    } catch (e) {
      console.error('[Invoices] chase PDF attach failed:', e.message);
    }

    const mail = await mailer.sendMail({
      userId: req.user.id,
      type: 'payment_chase',
      to: inv.client_email,
      subject,
      heading: subject,
      paragraphs: bodyText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean),
      ctaText: inv.public_token ? 'View the invoice' : null,
      ctaUrl: inv.public_token ? mailer.BASE_URL + '/i/' + inv.public_token : null,
      attachments,
    });
    if (!mail.ok) {
      return res.status(502).json({ error: 'The email could not be sent' + (mail.error ? ' (' + mail.error + ')' : '') + '. Copy the message and send it by WhatsApp instead.' });
    }
    res.json({ ok: true, sent_to: inv.client_email });
  } catch (err) {
    console.error('[Invoices] chase-send error:', err);
    res.status(500).json({ error: 'Failed to send the chaser.' });
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
    // Rendering lives in invoicePdf.js so the public /i/<token> page and the
    // email attachment use the identical document.
    streamInvoicePdf(res, inv, lines, branding, userInfo);
  } catch (err) {
    console.error('[Invoices] PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// ─── A4: "Send to your accountant" — Xero / QuickBooks CSV exports ──────────

const { buildInvoicesCsv, buildPaymentsCsv } = require('./accountingExport');

function buildExport(userId, what, format) {
  const fmt = format === 'quickbooks' ? 'quickbooks' : 'xero';
  return what === 'payments' ? buildPaymentsCsv(userId, fmt) : buildInvoicesCsv(userId, fmt);
}

// GET /api/invoices/_export/csv?what=invoices|payments&format=xero|quickbooks
router.get('/_export/csv', (req, res) => {
  try {
    const { filename, csv } = buildExport(req.user.id, String(req.query.what || 'invoices'), String(req.query.format || 'xero'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(csv);
  } catch (err) {
    console.error('[Invoices] export error:', err);
    res.status(500).json({ error: 'Failed to build the export.' });
  }
});

// POST /api/invoices/_export/email { what, format } — emails the CSV to the
// accountant's saved address (Settings -> Tax & CIS).
router.post('/_export/email', async (req, res) => {
  try {
    const settings = getOibSettings(req.user.id);
    if (!settings.accountant_email) {
      return res.status(400).json({ error: "No accountant email saved yet — add it in Settings under 'Tax & CIS'." });
    }
    if (!mailer.isConfigured()) {
      return res.status(503).json({ error: 'Email is not set up on the server — download the file and send it yourself instead.', code: 'MAIL_NOT_CONFIGURED' });
    }
    const b = req.body || {};
    const what = String(b.what || 'invoices');
    const format = String(b.format || 'xero');
    const { filename, csv } = buildExport(req.user.id, what, format);
    const userInfo = getUserDisplay(req.user.id);
    const branding = getBranding(req.user.id);
    const companyName = branding.company_name || userInfo?.company || userInfo?.full_name || '';

    const mail = await mailer.sendMail({
      userId: req.user.id,
      type: 'accountant_export',
      to: settings.accountant_email,
      subject: (what === 'payments' ? 'Payments' : 'Invoices') + ' export from ' + companyName,
      heading: 'Books from ' + companyName,
      paragraphs: [
        'Attached: ' + (what === 'payments' ? 'payments received' : 'sales invoices') + ' in '
        + (format === 'quickbooks' ? 'QuickBooks' : 'Xero') + ' import format.',
        'Sent from the AI QS portal on behalf of ' + companyName + '.',
      ],
      attachments: [{ filename, content: Buffer.from(csv, 'utf-8') }],
      replyTo: userInfo?.email,
    });
    if (!mail.ok) return res.status(502).json({ error: 'The email could not be sent. Download the file instead.' });
    res.json({ ok: true, sent_to: settings.accountant_email });
  } catch (err) {
    console.error('[Invoices] export email error:', err);
    res.status(500).json({ error: 'Failed to email the export.' });
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

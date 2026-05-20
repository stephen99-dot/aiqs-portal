// ═══════════════════════════════════════════════════════════════════════════════
// WAVE 3 — PAYMENT SCHEDULES — server/paymentScheduleRoutes.js
//
// A list of staged payments on a job (deposit / stage 1 / final / retention)
// for cashflow visibility. Free-floating until you link a stage to an invoice
// once it's been billed. Status: unpaid | paid.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function round2(n) { return Math.round(n * 100) / 100; }

function ensureJob(userId, jobId) {
  return db.prepare('SELECT * FROM estimator_jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
}

// GET /api/payment-schedules/job/:jobId
router.get('/job/:jobId', (req, res) => {
  try {
    const job = ensureJob(req.user.id, req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const rows = db.prepare(
      'SELECT * FROM payment_schedules WHERE job_id = ? AND user_id = ? ORDER BY sort_order ASC, rowid ASC'
    ).all(job.id, req.user.id);

    const totals = rows.reduce((acc, r) => {
      acc.total += num(r.amount);
      if (r.status === 'paid') acc.paid += num(r.amount);
      else acc.unpaid += num(r.amount);
      return acc;
    }, { total: 0, paid: 0, unpaid: 0 });

    res.json({
      stages: rows,
      total: round2(totals.total),
      paid: round2(totals.paid),
      unpaid: round2(totals.unpaid),
    });
  } catch (err) {
    console.error('[PaymentSchedule] list error:', err);
    res.status(500).json({ error: 'Failed to load payment schedule.' });
  }
});

// POST /api/payment-schedules
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const job = ensureJob(req.user.id, b.job_id);
    if (!job) return res.status(400).json({ error: 'A valid job_id is required.' });

    const id = uuidv4();
    const existing = db.prepare('SELECT COUNT(*) as c FROM payment_schedules WHERE job_id = ?').get(job.id).c;
    const pct = b.percent_of_contract != null ? num(b.percent_of_contract) : null;
    db.prepare(
      'INSERT INTO payment_schedules (id, user_id, job_id, stage_label, amount, percent_of_contract, '
      + 'due_date, due_trigger, status, sort_order) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, req.user.id, job.id,
      (b.stage_label || '').toString().slice(0, 120) || null,
      num(b.amount),
      pct,
      b.due_date || null,
      (b.due_trigger || '').toString().slice(0, 200) || null,
      ['paid', 'unpaid'].includes(b.status) ? b.status : 'unpaid',
      b.sort_order != null ? num(b.sort_order) : existing
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[PaymentSchedule] create error:', err);
    res.status(500).json({ error: 'Failed to create stage.' });
  }
});

// PATCH /api/payment-schedules/:id
router.patch('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM payment_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Stage not found.' });
    const b = req.body || {};
    const allowed = ['stage_label', 'amount', 'percent_of_contract', 'due_date', 'due_trigger', 'sort_order', 'status'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (k in b) {
        if (k === 'status' && !['paid', 'unpaid'].includes(b[k])) continue;
        sets.push(k + ' = ?');
        vals.push(b[k]);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(row.id);
      db.prepare('UPDATE payment_schedules SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: row.id });
  } catch (err) {
    console.error('[PaymentSchedule] patch error:', err);
    res.status(500).json({ error: 'Failed to update stage.' });
  }
});

// POST /api/payment-schedules/:id/mark-paid
router.post('/:id/mark-paid', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM payment_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Stage not found.' });
    const paidAt = (req.body && req.body.paid_at) || new Date().toISOString();
    db.prepare(
      "UPDATE payment_schedules SET status = 'paid', paid_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(paidAt, row.id);
    res.json({ id: row.id, status: 'paid', paid_at: paidAt });
  } catch (err) {
    console.error('[PaymentSchedule] mark-paid error:', err);
    res.status(500).json({ error: 'Failed to mark paid.' });
  }
});

// POST /api/payment-schedules/:id/link-invoice
router.post('/:id/link-invoice', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM payment_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Stage not found.' });
    const invoiceId = (req.body && req.body.invoice_id) || null;
    if (invoiceId) {
      const inv = db.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').get(invoiceId, req.user.id);
      if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
    }
    db.prepare('UPDATE payment_schedules SET invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invoiceId, row.id);
    res.json({ id: row.id, invoice_id: invoiceId });
  } catch (err) {
    console.error('[PaymentSchedule] link-invoice error:', err);
    res.status(500).json({ error: 'Failed to link invoice.' });
  }
});

// DELETE /api/payment-schedules/:id
router.delete('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM payment_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Stage not found.' });
    db.prepare('DELETE FROM payment_schedules WHERE id = ?').run(row.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[PaymentSchedule] delete error:', err);
    res.status(500).json({ error: 'Failed to delete stage.' });
  }
});

module.exports = router;

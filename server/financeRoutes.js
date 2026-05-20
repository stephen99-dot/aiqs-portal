// ═══════════════════════════════════════════════════════════════════════════════
// WAVE 2 — FINANCE HUB — server/financeRoutes.js
//
// Overheads tracker, jobs umbrella, planned budgets, actual cost tracking, and a
// combined dashboard snapshot. Same auth+estimator+password chain as the rest of
// the add-on. Reads/writes only the five Wave 2 tables; never touches the BOQ
// pipeline tables.
//
//   GET    /finance/overheads/current[?month=YYYY-MM]
//   PUT    /finance/overheads/current
//   GET    /finance/overheads/history
//   GET    /finance/jobs
//   POST   /finance/jobs
//   GET    /finance/jobs/:id
//   PATCH  /finance/jobs/:id
//   DELETE /finance/jobs/:id
//   POST   /finance/jobs/:id/link-quote        body: { quote_id }
//   GET    /finance/jobs/:id/budget
//   PUT    /finance/jobs/:id/budget
//   GET    /finance/jobs/:id/costs
//   POST   /finance/jobs/:id/costs
//   DELETE /finance/jobs/:id/costs/:costId
//   GET    /finance/dashboard
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

// ─── helpers ────────────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function round2(n) { return Math.round(n * 100) / 100; }
function currentMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function isMonth(s) { return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s); }

function sumLineItems(items) {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const li of items) {
    total += num(li && li.amount);
  }
  return round2(total);
}

function computeBreakEven(total, workingDays, workingHoursPerDay) {
  const d = num(workingDays);
  const h = num(workingHoursPerDay);
  const day = d > 0 ? total / d : 0;
  const hour = (d > 0 && h > 0) ? total / (d * h) : 0;
  return { break_even_day: round2(day), break_even_hour: round2(hour) };
}

function ensureJob(req, jobId) {
  return db.prepare('SELECT * FROM estimator_jobs WHERE id = ? AND user_id = ?').get(jobId, req.user.id);
}

// ═══════════════════════════════════════════════════════════════════════════
//  OVERHEADS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/overheads/current', (req, res) => {
  try {
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const row = db.prepare('SELECT * FROM overheads WHERE user_id = ? AND month = ?').get(req.user.id, month);
    if (!row) {
      return res.json({
        month,
        line_items: [],
        total: 0,
        working_days: 20,
        working_hours_per_day: 8,
        break_even_day: 0,
        break_even_hour: 0,
        target_margin_pct: null,
        notes: '',
        exists: false,
      });
    }
    let lineItems = [];
    try { lineItems = JSON.parse(row.line_items || '[]'); } catch (e) { /* corrupt — start fresh */ }
    res.json({
      month: row.month,
      line_items: lineItems,
      total: num(row.total),
      working_days: num(row.working_days, 20),
      working_hours_per_day: num(row.working_hours_per_day, 8),
      break_even_day: num(row.break_even_day),
      break_even_hour: num(row.break_even_hour),
      target_margin_pct: row.target_margin_pct,
      notes: row.notes || '',
      exists: true,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('[Finance] overheads GET error:', err);
    res.status(500).json({ error: 'Failed to load overheads.' });
  }
});

router.put('/overheads/current', (req, res) => {
  try {
    const b = req.body || {};
    const month = isMonth(b.month) ? b.month : currentMonth();
    const lineItems = Array.isArray(b.line_items) ? b.line_items.map(li => ({
      name: String((li && li.name) || '').slice(0, 120),
      amount: num(li && li.amount),
    })).filter(li => li.name || li.amount) : [];
    const total = sumLineItems(lineItems);
    const workingDays = num(b.working_days, 20);
    const workingHoursPerDay = num(b.working_hours_per_day, 8);
    const targetMargin = b.target_margin_pct == null ? null : num(b.target_margin_pct);
    const { break_even_day, break_even_hour } = computeBreakEven(total, workingDays, workingHoursPerDay);
    const notes = (b.notes || '').toString().slice(0, 4000);

    const existing = db.prepare('SELECT id FROM overheads WHERE user_id = ? AND month = ?').get(req.user.id, month);
    if (existing) {
      db.prepare(
        'UPDATE overheads SET line_items=?, total=?, working_days=?, working_hours_per_day=?, '
        + 'break_even_day=?, break_even_hour=?, target_margin_pct=?, notes=?, updated_at=CURRENT_TIMESTAMP '
        + 'WHERE id = ?'
      ).run(JSON.stringify(lineItems), total, workingDays, workingHoursPerDay, break_even_day, break_even_hour, targetMargin, notes, existing.id);
    } else {
      db.prepare(
        'INSERT INTO overheads (id, user_id, month, line_items, total, working_days, working_hours_per_day, '
        + 'break_even_day, break_even_hour, target_margin_pct, notes) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), req.user.id, month, JSON.stringify(lineItems), total, workingDays, workingHoursPerDay, break_even_day, break_even_hour, targetMargin, notes);
    }
    res.json({
      month,
      line_items: lineItems,
      total,
      working_days: workingDays,
      working_hours_per_day: workingHoursPerDay,
      break_even_day,
      break_even_hour,
      target_margin_pct: targetMargin,
      notes,
      exists: true,
    });
  } catch (err) {
    console.error('[Finance] overheads PUT error:', err);
    res.status(500).json({ error: 'Failed to save overheads.' });
  }
});

router.get('/overheads/history', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT month, total, working_days, working_hours_per_day, break_even_day, break_even_hour, updated_at '
      + 'FROM overheads WHERE user_id = ? ORDER BY month DESC LIMIT 24'
    ).all(req.user.id);
    res.json({ months: rows });
  } catch (err) {
    console.error('[Finance] overheads history error:', err);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  JOBS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/jobs', (req, res) => {
  try {
    // Join in budget summary and actual totals so the list shows variance at a glance.
    const rows = db.prepare(`
      SELECT j.*,
        b.planned_revenue, b.planned_labour, b.planned_materials, b.planned_overheads, b.planned_other,
        (SELECT COALESCE(SUM(c.total),0) FROM job_costs c WHERE c.job_id = j.id) AS actual_total,
        (SELECT COUNT(*) FROM quotes q WHERE q.job_id = j.id) AS quote_count
      FROM estimator_jobs j
      LEFT JOIN job_budgets b ON b.job_id = j.id
      WHERE j.user_id = ?
      ORDER BY j.created_at DESC
      LIMIT 500
    `).all(req.user.id);
    res.json({ jobs: rows });
  } catch (err) {
    console.error('[Finance] jobs list error:', err);
    res.status(500).json({ error: 'Failed to load jobs.' });
  }
});

router.post('/jobs', (req, res) => {
  try {
    const b = req.body || {};
    const name = (b.name || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Job name is required.' });
    const id = uuidv4();
    db.prepare(
      'INSERT INTO estimator_jobs (id, user_id, name, client_name, project_type, location, status, notes) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, req.user.id, name.slice(0, 200),
      (b.client_name || '').toString().slice(0, 200) || null,
      (b.project_type || '').toString().slice(0, 80) || null,
      (b.location || '').toString().slice(0, 200) || null,
      ['planned', 'active', 'completed', 'cancelled'].includes(b.status) ? b.status : 'planned',
      (b.notes || '').toString().slice(0, 4000) || null
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[Finance] job create error:', err);
    res.status(500).json({ error: 'Failed to create job.' });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const budget = db.prepare('SELECT * FROM job_budgets WHERE job_id = ?').get(job.id) || null;
    const costsAgg = db.prepare(
      "SELECT kind, COALESCE(SUM(total),0) as total FROM job_costs WHERE job_id = ? GROUP BY kind"
    ).all(job.id);
    const quotes = db.prepare(
      'SELECT id, quote_number, project_name, grand_total, status, created_at FROM quotes WHERE job_id = ? ORDER BY created_at DESC'
    ).all(job.id);
    res.json({ job, budget, costsAgg, quotes });
  } catch (err) {
    console.error('[Finance] job get error:', err);
    res.status(500).json({ error: 'Failed to load job.' });
  }
});

router.patch('/jobs/:id', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const b = req.body || {};
    const allowed = ['name', 'client_name', 'project_type', 'location', 'status', 'notes'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (k in b) {
        if (k === 'status' && !['planned', 'active', 'completed', 'cancelled'].includes(b[k])) continue;
        sets.push(k + ' = ?');
        vals.push(b[k] == null ? null : String(b[k]).slice(0, 4000));
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(job.id);
      db.prepare('UPDATE estimator_jobs SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: job.id });
  } catch (err) {
    console.error('[Finance] job patch error:', err);
    res.status(500).json({ error: 'Failed to update job.' });
  }
});

router.delete('/jobs/:id', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM job_costs WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM job_budgets WHERE job_id = ?').run(job.id);
      db.prepare('UPDATE quotes SET job_id = NULL WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM estimator_jobs WHERE id = ?').run(job.id);
    });
    txn();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Finance] job delete error:', err);
    res.status(500).json({ error: 'Failed to delete job.' });
  }
});

router.post('/jobs/:id/link-quote', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const quoteId = (req.body && req.body.quote_id) || '';
    if (!quoteId) return res.status(400).json({ error: 'quote_id is required.' });
    const q = db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(quoteId, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    db.prepare('UPDATE quotes SET job_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(job.id, q.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Finance] link-quote error:', err);
    res.status(500).json({ error: 'Failed to link quote.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  BUDGETS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/jobs/:id/budget', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const row = db.prepare('SELECT * FROM job_budgets WHERE job_id = ?').get(job.id);
    res.json({ budget: row || null });
  } catch (err) {
    console.error('[Finance] budget GET error:', err);
    res.status(500).json({ error: 'Failed to load budget.' });
  }
});

router.put('/jobs/:id/budget', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const b = req.body || {};
    const labour = num(b.planned_labour);
    const materials = num(b.planned_materials);
    const overheads = num(b.planned_overheads);
    const other = num(b.planned_other);
    const margin = num(b.planned_margin_pct);
    const revenue = b.planned_revenue != null
      ? num(b.planned_revenue)
      : round2((labour + materials + overheads + other) * (1 + margin / 100));
    const notes = (b.notes || '').toString().slice(0, 4000);

    const existing = db.prepare('SELECT job_id FROM job_budgets WHERE job_id = ?').get(job.id);
    if (existing) {
      db.prepare(
        'UPDATE job_budgets SET planned_labour=?, planned_materials=?, planned_overheads=?, planned_other=?, '
        + 'planned_margin_pct=?, planned_revenue=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE job_id=?'
      ).run(labour, materials, overheads, other, margin, revenue, notes, job.id);
    } else {
      db.prepare(
        'INSERT INTO job_budgets (job_id, user_id, planned_labour, planned_materials, planned_overheads, planned_other, planned_margin_pct, planned_revenue, notes) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(job.id, req.user.id, labour, materials, overheads, other, margin, revenue, notes);
    }
    res.json({ job_id: job.id, planned_labour: labour, planned_materials: materials, planned_overheads: overheads, planned_other: other, planned_margin_pct: margin, planned_revenue: revenue, notes });
  } catch (err) {
    console.error('[Finance] budget PUT error:', err);
    res.status(500).json({ error: 'Failed to save budget.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ACTUAL COSTS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/jobs/:id/costs', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const rows = db.prepare('SELECT * FROM job_costs WHERE job_id = ? ORDER BY occurred_on DESC, created_at DESC').all(job.id);
    res.json({ costs: rows });
  } catch (err) {
    console.error('[Finance] costs list error:', err);
    res.status(500).json({ error: 'Failed to load costs.' });
  }
});

router.post('/jobs/:id/costs', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const b = req.body || {};
    const kind = ['material', 'labour', 'other'].includes(b.kind) ? b.kind : 'material';
    const qty = num(b.qty);
    const unitCost = num(b.unit_cost);
    const total = b.total != null ? num(b.total) : round2(qty * unitCost);
    const id = uuidv4();
    db.prepare(
      'INSERT INTO job_costs (id, job_id, user_id, kind, description, qty, unit, unit_cost, total, vendor, occurred_on, notes) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, job.id, req.user.id, kind,
      (b.description || '').toString().slice(0, 500),
      qty, (b.unit || '').toString().slice(0, 20), unitCost, total,
      (b.vendor || '').toString().slice(0, 200) || null,
      b.occurred_on || null,
      (b.notes || '').toString().slice(0, 4000) || null
    );
    res.status(201).json({ id, total });
  } catch (err) {
    console.error('[Finance] cost POST error:', err);
    res.status(500).json({ error: 'Failed to record cost.' });
  }
});

router.delete('/jobs/:id/costs/:costId', (req, res) => {
  try {
    const job = ensureJob(req, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const r = db.prepare('DELETE FROM job_costs WHERE id = ? AND job_id = ?').run(req.params.costId, job.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Cost not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Finance] cost DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete cost.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

router.get('/dashboard', (req, res) => {
  try {
    const userId = req.user.id;
    const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    const quotesMonth = db.prepare(
      'SELECT COUNT(*) as c, COALESCE(SUM(grand_total),0) as v FROM quotes WHERE user_id=? AND created_at >= ?'
    ).get(userId, sinceIso);
    const won = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE user_id=? AND status='won'").get(userId).c;
    const lost = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE user_id=? AND status='lost'").get(userId).c;
    const decided = won + lost;
    const winRate = decided > 0 ? Math.round((won / decided) * 100) : null;

    const overheads = db.prepare('SELECT * FROM overheads WHERE user_id=? AND month=?').get(userId, currentMonth());

    const jobsByStatus = db.prepare(
      'SELECT status, COUNT(*) as c FROM estimator_jobs WHERE user_id=? GROUP BY status'
    ).all(userId);

    const variance = db.prepare(`
      SELECT
        COALESCE(SUM(b.planned_revenue), 0) AS planned_revenue,
        COALESCE(SUM(b.planned_labour + b.planned_materials + b.planned_overheads + b.planned_other), 0) AS planned_cost,
        COALESCE((SELECT SUM(c.total) FROM job_costs c WHERE c.user_id = ?), 0) AS actual_cost
      FROM job_budgets b
      WHERE b.user_id = ?
    `).get(userId, userId);

    // Margin creep: jobs where actual_cost > planned_cost.
    const creep = db.prepare(`
      SELECT j.id, j.name,
        COALESCE(b.planned_labour + b.planned_materials + b.planned_overheads + b.planned_other, 0) AS planned_cost,
        COALESCE((SELECT SUM(c.total) FROM job_costs c WHERE c.job_id = j.id), 0) AS actual_cost
      FROM estimator_jobs j
      LEFT JOIN job_budgets b ON b.job_id = j.id
      WHERE j.user_id = ? AND j.status IN ('planned','active')
    `).all(userId).filter(r => r.planned_cost > 0 && r.actual_cost > r.planned_cost * 0.9)
      .map(r => ({
        ...r,
        variance: round2(r.actual_cost - r.planned_cost),
        variance_pct: round2(((r.actual_cost - r.planned_cost) / r.planned_cost) * 100),
      }));

    res.json({
      quotes_this_month: quotesMonth.c,
      quoted_value: round2(quotesMonth.v || 0),
      win_rate: winRate,
      won, lost,
      overheads: overheads ? {
        month: overheads.month,
        total: num(overheads.total),
        break_even_day: num(overheads.break_even_day),
        break_even_hour: num(overheads.break_even_hour),
      } : null,
      jobs: jobsByStatus.reduce((acc, r) => { acc[r.status] = r.c; return acc; }, {}),
      planned_revenue: round2(variance.planned_revenue),
      planned_cost: round2(variance.planned_cost),
      actual_cost: round2(variance.actual_cost),
      margin_creep: creep,
    });
  } catch (err) {
    console.error('[Finance] dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

module.exports = router;

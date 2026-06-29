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
const clientStore = require('./clientStore');

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
//  SETTINGS (A3/A4 — card fees, Tax & CIS, accountant email)
// ═══════════════════════════════════════════════════════════════════════════

function getSettings(userId) {
  db.prepare('INSERT OR IGNORE INTO oib_settings (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM oib_settings WHERE user_id = ?').get(userId);
}

router.get('/settings', (req, res) => {
  try {
    res.json({ settings: getSettings(req.user.id) });
  } catch (err) {
    console.error('[Finance] settings GET error:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

router.put('/settings', (req, res) => {
  try {
    getSettings(req.user.id); // ensure the row exists
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const put = (col, val) => { sets.push(col + ' = ?'); vals.push(val); };
    if ('card_fee_mode' in b && ['absorb', 'add'].includes(b.card_fee_mode)) put('card_fee_mode', b.card_fee_mode);
    if ('card_fee_pct' in b) put('card_fee_pct', Math.min(Math.max(num(b.card_fee_pct), 0), 10));
    if ('card_fee_fixed' in b) put('card_fee_fixed', Math.min(Math.max(num(b.card_fee_fixed), 0), 5));
    if ('vat_registered' in b) put('vat_registered', b.vat_registered ? 1 : 0);
    if ('vat_number' in b) put('vat_number', String(b.vat_number || '').trim().slice(0, 20) || null);
    if ('cis_contractor' in b) put('cis_contractor', b.cis_contractor ? 1 : 0);
    if ('cis_subcontractor' in b) put('cis_subcontractor', b.cis_subcontractor ? 1 : 0);
    if ('cis_default_rate' in b) put('cis_default_rate', [20, 30].includes(num(b.cis_default_rate)) ? num(b.cis_default_rate) : 20);
    if ('accountant_email' in b) put('accountant_email', String(b.accountant_email || '').trim().slice(0, 200) || null);
    // B2 — first-run wizard fields.
    if ('trade_type' in b) put('trade_type', String(b.trade_type || '').trim().slice(0, 80) || null);
    if ('day_rates' in b && b.day_rates && typeof b.day_rates === 'object') {
      const rates = {};
      for (const [k, v] of Object.entries(b.day_rates)) {
        const n = num(v);
        if (n > 0 && n < 10000) rates[String(k).slice(0, 60)] = n;
      }
      put('day_rates', JSON.stringify(rates));
    }
    if (b.setup_completed) put('setup_completed_at', new Date().toISOString());
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(req.user.id);
      db.prepare('UPDATE oib_settings SET ' + sets.join(', ') + ' WHERE user_id = ?').run(...vals);
    }
    res.json({ settings: getSettings(req.user.id) });
  } catch (err) {
    console.error('[Finance] settings PUT error:', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

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
    // Join in budget summary, actual totals, and the money-pipeline numbers
    // the Jobs cards need (quoted / accepted / invoiced / paid / overdue) so
    // the list can show the figure that matters for each job's stage.
    const rows = db.prepare(`
      SELECT j.*,
        b.planned_revenue, b.planned_labour, b.planned_materials, b.planned_overheads, b.planned_other,
        (SELECT COALESCE(SUM(c.total),0) FROM job_costs c WHERE c.job_id = j.id) AS actual_total,
        (SELECT COUNT(*) FROM quotes q WHERE q.job_id = j.id) AS quote_count,
        (SELECT COALESCE(SUM(q.grand_total),0) FROM quotes q WHERE q.job_id = j.id AND q.status != 'lost') AS quoted_total,
        (SELECT COALESCE(SUM(q.grand_total),0) FROM quotes q WHERE q.job_id = j.id AND q.status IN ('accepted','won')) AS accepted_total,
        (SELECT COALESCE(SUM(i.grand_total),0) FROM invoices i WHERE i.job_id = j.id AND i.status IN ('sent','paid')) AS invoiced_total,
        (SELECT COALESCE(SUM(CASE WHEN i.paid_amount > 0 THEN i.paid_amount ELSE i.grand_total END),0)
           FROM invoices i WHERE i.job_id = j.id AND i.status = 'paid') AS paid_total,
        (SELECT COUNT(*) FROM invoices i WHERE i.job_id = j.id AND i.status = 'sent'
           AND i.due_date IS NOT NULL AND date(i.due_date) < date('now')) AS overdue_count
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
    let clientId = null;
    try { clientId = clientStore.findOrCreateClient(db, req.user.id, { name: b.client_name, phone: b.client_phone }); } catch (e) {}
    db.prepare(
      'INSERT INTO estimator_jobs (id, user_id, name, client_name, client_phone, project_type, location, status, notes, client_id) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, req.user.id, name.slice(0, 200),
      (b.client_name || '').toString().slice(0, 200) || null,
      (b.client_phone || '').toString().slice(0, 40) || null,
      (b.project_type || '').toString().slice(0, 80) || null,
      (b.location || '').toString().slice(0, 200) || null,
      ['planned', 'active', 'completed', 'cancelled'].includes(b.status) ? b.status : 'planned',
      (b.notes || '').toString().slice(0, 4000) || null,
      clientId
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[Finance] job create error:', err);
    res.status(500).json({ error: 'Failed to create job.' });
  }
});

// ─── Stripe Connect ─────────────────────────────────────────────────────────
// The builder connects their OWN Stripe account (Standard, hosted onboarding);
// "Pay now" invoice payments then settle straight to their bank. Without a
// connected account the pay-link route falls back to the platform account.

function getOib(userId) {
  db.prepare('INSERT OR IGNORE INTO oib_settings (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM oib_settings WHERE user_id = ?').get(userId);
}

// POST /finance/stripe/connect  body: { return_to?: '/invoices/abc' }
// Creates the connected account on first call, then returns a fresh hosted
// onboarding link (account links are single-use and expire, so we mint one
// per click).
router.post('/stripe/connect', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.', code: 'STRIPE_NOT_CONFIGURED' });
    }
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { BASE_URL } = require('./mailer');
    const settings = getOib(req.user.id);

    let accountId = settings.stripe_account_id;
    if (!accountId) {
      const u = db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(req.user.id);
      const account = await stripe.accounts.create({
        type: 'standard',
        email: (u && u.email) || undefined,
        business_profile: u && (u.company || u.full_name) ? { name: u.company || u.full_name } : undefined,
        metadata: { user_id: req.user.id },
      });
      accountId = account.id;
      db.prepare('UPDATE oib_settings SET stripe_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .run(accountId, req.user.id);
    }

    const rawReturn = String((req.body && req.body.return_to) || '/money');
    const returnTo = rawReturn.startsWith('/') && !rawReturn.startsWith('//') ? rawReturn : '/money';
    const sep = returnTo.includes('?') ? '&' : '?';
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: BASE_URL + returnTo + sep + 'stripe=refresh',
      return_url: BASE_URL + returnTo + sep + 'stripe=return',
      type: 'account_onboarding',
    });
    res.json({ url: link.url });
  } catch (err) {
    console.error('[Finance] stripe connect error:', err);
    res.status(500).json({ error: 'Failed to start Stripe onboarding' + (err && err.message ? ': ' + err.message : '.') });
  }
});

// GET /finance/stripe/status — refreshes charges_enabled from Stripe
router.get('/stripe/status', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.json({ configured: false, connected: false, charges_enabled: false });
    }
    const settings = getOib(req.user.id);
    if (!settings.stripe_account_id) {
      return res.json({ configured: true, connected: false, charges_enabled: false });
    }
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let chargesEnabled = !!settings.stripe_charges_enabled;
    let detailsSubmitted = false;
    try {
      const account = await stripe.accounts.retrieve(settings.stripe_account_id);
      chargesEnabled = !!account.charges_enabled;
      detailsSubmitted = !!account.details_submitted;
      db.prepare('UPDATE oib_settings SET stripe_charges_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .run(chargesEnabled ? 1 : 0, req.user.id);
    } catch (e) {
      // Network/permission blip — fall back to the stored flag rather than
      // telling the builder they're disconnected.
    }
    res.json({ configured: true, connected: true, charges_enabled: chargesEnabled, details_submitted: detailsSubmitted });
  } catch (err) {
    console.error('[Finance] stripe status error:', err);
    res.status(500).json({ error: 'Failed to check Stripe status.' });
  }
});

// ─── Clients ────────────────────────────────────────────────────────────────
// Real client records. Created automatically whenever a job/quote/invoice
// names a customer; the list lazily backfills anything from before the table
// existed, so it's populated on first open.

router.get('/clients', (req, res) => {
  try {
    clientStore.backfillClients(db, req.user.id);
    res.json({ clients: clientStore.listClientsWithTotals(db, req.user.id) });
  } catch (err) {
    console.error('[Finance] clients list error:', err);
    res.status(500).json({ error: 'Failed to load clients.' });
  }
});

router.post('/clients', (req, res) => {
  try {
    const b = req.body || {};
    if (!(b.name || '').toString().trim()) return res.status(400).json({ error: 'Client name is required.' });
    const id = clientStore.findOrCreateClient(db, req.user.id, b);
    // Apply notes/overwrites the find-or-create path doesn't touch
    if (b.notes) db.prepare('UPDATE estimator_clients SET notes = ? WHERE id = ? AND user_id = ?').run(String(b.notes).slice(0, 4000), id, req.user.id);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[Finance] client create error:', err);
    res.status(500).json({ error: 'Failed to save client.' });
  }
});

router.get('/clients/:id', (req, res) => {
  try {
    const detail = clientStore.getClientDetail(db, req.user.id, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Client not found.' });
    res.json(detail);
  } catch (err) {
    console.error('[Finance] client detail error:', err);
    res.status(500).json({ error: 'Failed to load client.' });
  }
});

router.patch('/clients/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM estimator_clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Client not found.' });
    const b = req.body || {};
    const allowed = ['name', 'email', 'phone', 'address', 'notes'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        sets.push(k + ' = ?');
        vals.push(String(b[k] || '').slice(0, k === 'notes' ? 4000 : 300) || null);
      }
    }
    if (!sets.length) return res.json({ ok: true, unchanged: true });
    vals.push(req.params.id);
    db.prepare(`UPDATE estimator_clients SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Finance] client update error:', err);
    res.status(500).json({ error: 'Failed to update client.' });
  }
});

router.delete('/clients/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM estimator_clients WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Client not found.' });
    // Unlink rather than orphan: jobs/quotes/invoices keep their client_name
    // strings, they just stop rolling up to a record.
    db.prepare('UPDATE estimator_jobs SET client_id = NULL WHERE client_id = ?').run(req.params.id);
    db.prepare('UPDATE quotes SET client_id = NULL WHERE client_id = ?').run(req.params.id);
    db.prepare('UPDATE invoices SET client_id = NULL WHERE client_id = ?').run(req.params.id);
    db.prepare('DELETE FROM estimator_clients WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Finance] client delete error:', err);
    res.status(500).json({ error: 'Failed to delete client.' });
  }
});

// Start (or grow) a job from a BOQ already delivered to the portal: creates a
// draft quote seeded from the BOQ's priced line items, ready to send to the
// client. The source document's OH&P is baked into the line rates (same
// philosophy as the Client Copy — no separate margin line shown), and its
// contingency/VAT seed the quote-level percentages, so the quote's bottom
// line lands on the delivered tender sum.
//   body: { project_id, job_id?, client_name?, client_email?, client_phone? }
//   - no job_id  → creates a new job named after the project, then attaches
//   - job_id     → attaches the quote to an existing job ("link any BOQ")
router.post('/jobs/from-project', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { parseBOQ } = require('./builderExports');
    const b = req.body || {};

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .get(b.project_id || '', req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    if (!project.boq_filename) return res.status(400).json({ error: 'That project has no BOQ yet — wait for it to be delivered.' });

    const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
    const filePath = path.join(DATA_DIR, 'outputs', project.boq_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'BOQ file not found on server.' });

    const parsed = await parseBOQ(filePath);
    if (!parsed.sections.length) return res.status(400).json({ error: 'Could not read any line items from the BOQ.' });
    const ss = parsed.source_summary || {};
    const round2 = (v) => Math.round(v * 100) / 100;
    const inOhpScope = (sectionNumber) => {
      if (!Array.isArray(ss.ohp_sections) || ss.ohp_sections.length !== 2) return true;
      const n = parseFloat(sectionNumber);
      return !Number.isFinite(n) || (n >= ss.ohp_sections[0] && n <= ss.ohp_sections[1]);
    };

    // Client record first, so the job and quote both link to it
    let clientId = null;
    try {
      clientId = clientStore.findOrCreateClient(db, req.user.id, {
        name: b.client_name, email: b.client_email, phone: b.client_phone,
      });
    } catch (e) {}

    // Job: reuse an existing one or create one named after the project
    let jobId = b.job_id || null;
    if (jobId) {
      const job = ensureJob(req, jobId);
      if (!job) return res.status(404).json({ error: 'Job not found.' });
      if (!clientId) clientId = job.client_id || null;
    } else {
      jobId = uuidv4();
      db.prepare(
        'INSERT INTO estimator_jobs (id, user_id, name, client_name, client_phone, project_type, location, status, notes, client_id) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        jobId, req.user.id, (project.title || 'Job from BOQ').slice(0, 200),
        (b.client_name || '').toString().slice(0, 200) || null,
        (b.client_phone || '').toString().slice(0, 40) || null,
        (project.project_type || '').slice(0, 80) || null,
        (project.location || '').slice(0, 200) || null,
        'planned',
        'Created from portal BOQ: ' + (project.title || project.id),
        clientId
      );
    }

    // Quote lines from the BOQ. Rate carries the client-facing price (source
    // OH&P baked in, scoped per section); labour/materials stay at raw cost so
    // the budget seeded on acceptance reflects real cost, not price.
    const ohpPct = ss.ohp_pct != null ? ss.ohp_pct : 0;
    const lines = [];
    for (const s of parsed.sections) {
      // Provisional sums are carried exclusive of OH&P — never uplift them.
      const mult = 1 + ((s.provisional ? 0 : (inOhpScope(s.number) ? ohpPct : 0))) / 100;
      for (const it of s.items) {
        // Zero-value lines ("included elsewhere") stay on the quote — they're
        // scope the client should see, they just don't add to the total.
        const base = ((it.labour || 0) + (it.materials || 0)) || (it.total || 0);
        if (!(it.description || '').trim()) continue;
        const qty = it.qty > 0 ? it.qty : 1;
        const lineTotal = round2(base * mult);
        lines.push({
          section: s.title || ('Section ' + s.number),
          item: it.itemRef || '',
          description: it.description || '',
          unit: it.unit || 'item',
          qty,
          rate: round2(lineTotal / qty),
          labour: it.labour || 0,
          materials: it.materials || 0,
        });
      }
    }
    if (lines.length === 0) return res.status(400).json({ error: 'The BOQ has no priced line items.' });

    // Totals — same shape as POST /api/estimator/quotes (OH&P already in the
    // rates, so quote-level ohp stays 0; contingency/VAT follow the source).
    const contPct = ss.contingency_pct != null ? ss.contingency_pct : 0;
    const vatPct = ss.vat_pct != null ? ss.vat_pct : 20;
    let net = 0;
    for (const ln of lines) { ln.line_total = round2(ln.qty * ln.rate); net += ln.qty * ln.rate; }
    const cont = net * (contPct / 100);
    const beforeVat = net + cont;
    const vat = beforeVat * (vatPct / 100);

    const quoteId = uuidv4();
    const d = new Date();
    const quoteNumber = 'Q-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
      + '-' + Math.floor(1000 + Math.random() * 9000);

    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO quotes (id, user_id, client_name, client_email, project_name, project_type, currency, input_text, '
        + 'net_total, ohp_pct, ohp_amount, contingency_pct, contingency_amount, vat_pct, vat_amount, '
        + 'grand_total, target_margin_pct, margin_pct, status, notes, quote_number, job_id, client_id) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        quoteId, req.user.id,
        (b.client_name || '').toString().slice(0, 200) || null,
        (b.client_email || '').toString().slice(0, 200) || null,
        project.title || 'Quote from BOQ', project.project_type || null,
        project.currency === 'EUR' ? 'EUR' : 'GBP',
        'Imported from portal BOQ: ' + project.boq_filename,
        round2(net), 0, 0, contPct, round2(cont), vatPct, round2(vat),
        round2(beforeVat + vat), 0, 0,
        'draft', null, quoteNumber, jobId, clientId
      );
      const ins = db.prepare(
        'INSERT INTO quote_lines (id, quote_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order, source_url) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)'
      );
      lines.forEach((ln, i) => {
        ins.run(uuidv4(), quoteId, ln.section, ln.item, ln.description, ln.unit, ln.qty, ln.rate, ln.labour, ln.materials, ln.line_total, i);
      });
    });
    txn();

    res.status(201).json({
      job_id: jobId,
      quote_id: quoteId,
      quote_number: quoteNumber,
      line_count: lines.length,
      grand_total: round2(beforeVat + vat),
    });
  } catch (err) {
    console.error('[Finance] job from project error:', err);
    res.status(500).json({ error: 'Failed to create job from BOQ: ' + err.message });
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
      'SELECT id, quote_number, project_name, grand_total, status, created_at, public_token FROM quotes WHERE job_id = ? ORDER BY created_at DESC'
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
    // A4: retention_pct + retention_release_date — money held back by the
    // client, released on a date (the PM alerts when it falls due).
    const allowed = ['name', 'client_name', 'client_phone', 'project_type', 'location', 'status', 'notes', 'retention_pct', 'retention_release_date'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (k in b) {
        if (k === 'status' && !['planned', 'active', 'completed', 'cancelled'].includes(b[k])) continue;
        if (k === 'retention_pct') {
          sets.push('retention_pct = ?');
          vals.push(Math.min(Math.max(num(b[k]), 0), 50));
          continue;
        }
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
      // Remove everything that belongs to the job…
      db.prepare('DELETE FROM job_costs WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM job_budgets WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM estimator_variations WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM payment_schedules WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM job_photos WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM schedule_tasks WHERE plan_id IN (SELECT id FROM schedule_plans WHERE job_id = ?)').run(job.id);
      db.prepare('DELETE FROM schedule_plans WHERE job_id = ?').run(job.id);
      // …but keep the financial/paper records, just unlinked from the job.
      db.prepare('UPDATE quotes SET job_id = NULL WHERE job_id = ?').run(job.id);
      db.prepare('UPDATE invoices SET job_id = NULL WHERE job_id = ?').run(job.id);
      db.prepare('UPDATE documents SET job_id = NULL WHERE job_id = ?').run(job.id);
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
    const won = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE user_id=? AND status IN ('won','accepted')").get(userId).c;
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

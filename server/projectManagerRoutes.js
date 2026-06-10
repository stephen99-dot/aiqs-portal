// ═══════════════════════════════════════════════════════════════════════════════
// AI PROJECT MANAGER — PART A: PROACTIVE ALERTS (DETERMINISTIC)
// server/projectManagerRoutes.js
//
// Plain parameterised SQL scoped to req.user.id. No LLM here — these must
// never be wrong. Five rules:
//   1. Variations sent but unapproved for > N days
//   2. Payment stages due within H days or overdue
//   3. Cost actuals over planned budget by > X%
//   4. Quotes sent with no response for > N days
//   5. Job effective day-rate below break-even
//
// Thresholds live in pm_alert_thresholds (seeded with defaults on first read).
// Each card returns { id, severity, title, body, link, meta } so the UI can
// render and link straight to the underlying record.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

// ─── helpers ────────────────────────────────────────────────────────────────

function getThresholds(userId) {
  db.prepare('INSERT OR IGNORE INTO pm_alert_thresholds (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM pm_alert_thresholds WHERE user_id = ?').get(userId);
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (isNaN(target.getTime())) return null;
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  return Math.round((target.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Rule 1: Variations sent but unapproved for > N days ────────────────────

function ruleStaleVariations(userId, thresholds) {
  const N = thresholds.variation_stale_days;
  const rows = db.prepare(`
    SELECT v.id, v.vo_number, v.title, v.grand_total, v.sent_at, v.job_id, j.name AS job_name
    FROM estimator_variations v
    LEFT JOIN estimator_jobs j ON j.id = v.job_id
    WHERE v.user_id = ?
      AND v.status = 'sent'
      AND v.sent_at IS NOT NULL
      AND julianday('now') - julianday(v.sent_at) > ?
    ORDER BY v.sent_at ASC
  `).all(userId, N);
  return rows.map(r => {
    const days = daysSince(r.sent_at);
    return {
      id: 'variation-stale-' + r.id,
      rule: 'variation_stale',
      severity: days > N * 2 ? 'high' : 'medium',
      title: (r.vo_number || 'Variation') + ' — awaiting client approval for ' + days + ' days',
      body: (r.title ? '"' + r.title + '" · ' : '')
        + (r.job_name ? r.job_name + ' · ' : '')
        + 'sent ' + (r.sent_at || '').slice(0, 10)
        + ' · ' + fmtMoney(r.grand_total),
      link: '/change-orders/' + r.id,
      meta: { days_outstanding: days, value: r.grand_total, threshold: N },
    };
  });
}

// ─── Rule 2: Payment stages due within H days or overdue ────────────────────

function rulePaymentsDue(userId, thresholds) {
  const H = thresholds.payment_due_horizon_days;
  const rows = db.prepare(`
    SELECT p.id, p.stage_label, p.amount, p.due_date, p.job_id, j.name AS job_name
    FROM payment_schedules p
    LEFT JOIN estimator_jobs j ON j.id = p.job_id
    WHERE p.user_id = ?
      AND p.status = 'unpaid'
      AND p.due_date IS NOT NULL
      AND date(p.due_date) <= date('now', '+' || ? || ' days')
    ORDER BY p.due_date ASC
  `).all(userId, H);
  const stageCards = rows.map(r => {
    const days = daysUntil(r.due_date);
    const isOverdue = days < 0;
    return {
      id: 'payment-due-' + r.id,
      rule: 'payment_due',
      severity: isOverdue ? 'high' : 'medium',
      title: (r.stage_label || 'Payment stage')
        + ' — ' + (isOverdue ? Math.abs(days) + ' day(s) overdue' : (days === 0 ? 'due today' : 'due in ' + days + ' day(s)')),
      body: (r.job_name ? r.job_name + ' · ' : '')
        + 'due ' + r.due_date + ' · ' + fmtMoney(r.amount),
      link: r.job_id ? '/finance/jobs/' + r.job_id : '/finance',
      meta: { days_to_due: days, value: r.amount, overdue: isOverdue, horizon: H },
    };
  });

  // A3: unpaid invoices due soon or overdue, with the automated-reminder state
  // on the card so the builder knows whether the system is already chasing.
  const invoices = db.prepare(`
    SELECT id, invoice_number, client_name, grand_total, due_date,
           reminders_enabled, reminder_stage, reminder_last_at
    FROM invoices
    WHERE user_id = ?
      AND status = 'sent'
      AND due_date IS NOT NULL
      AND date(due_date) <= date('now', '+' || ? || ' days')
    ORDER BY due_date ASC
  `).all(userId, H);
  const invoiceCards = invoices.map(r => {
    const days = daysUntil(r.due_date);
    const isOverdue = days < 0;
    let reminderNote;
    if (!r.reminders_enabled) reminderNote = 'automatic reminders are off';
    else if (r.reminder_stage > 0) {
      const since = daysSince(r.reminder_last_at);
      reminderNote = 'reminder sent' + (since != null ? ' ' + since + ' day(s) ago' : '');
    } else reminderNote = 'reminders on — first one goes on the due date';
    return {
      id: 'invoice-due-' + r.id,
      rule: 'payment_due',
      severity: isOverdue ? 'high' : 'medium',
      title: 'Invoice ' + (r.invoice_number || '')
        + ' — ' + (isOverdue ? Math.abs(days) + ' day(s) overdue' : (days === 0 ? 'due today' : 'due in ' + days + ' day(s)')),
      body: (r.client_name ? r.client_name + ' · ' : '')
        + fmtMoney(r.grand_total) + ' · due ' + r.due_date + ' · ' + reminderNote,
      link: '/invoices/' + r.id,
      meta: {
        days_to_due: days, value: r.grand_total, overdue: isOverdue, horizon: H,
        reminders_enabled: !!r.reminders_enabled, reminder_stage: r.reminder_stage,
      },
    };
  });

  return [...stageCards, ...invoiceCards];
}

// ─── Rule 3: Cost actuals over planned budget by > X% ───────────────────────
//
// "Planned cost" = planned_labour + planned_materials + planned_overheads
// + planned_other (excludes planned_revenue, which is revenue not cost).
// Actual = SUM(job_costs.total) for the job. Skip jobs with no planned
// figures (nothing to compare against).

function ruleBudgetOverrun(userId, thresholds) {
  const overrunPct = thresholds.budget_overrun_pct;
  const rows = db.prepare(`
    SELECT j.id AS job_id, j.name AS job_name, j.client_name,
           b.planned_labour, b.planned_materials, b.planned_overheads, b.planned_other,
           (COALESCE(b.planned_labour,0) + COALESCE(b.planned_materials,0)
            + COALESCE(b.planned_overheads,0) + COALESCE(b.planned_other,0)) AS planned_total,
           COALESCE(c.actual_total, 0) AS actual_total
    FROM estimator_jobs j
    INNER JOIN job_budgets b ON b.job_id = j.id AND b.user_id = j.user_id
    LEFT JOIN (
      SELECT job_id, SUM(total) AS actual_total
      FROM job_costs
      WHERE user_id = ?
      GROUP BY job_id
    ) c ON c.job_id = j.id
    WHERE j.user_id = ?
  `).all(userId, userId);
  const out = [];
  for (const r of rows) {
    const planned = Number(r.planned_total) || 0;
    const actual = Number(r.actual_total) || 0;
    if (planned <= 0) continue;
    const ratio = actual / planned;
    const overrun = (ratio - 1) * 100;
    if (overrun <= overrunPct) continue;
    out.push({
      id: 'budget-overrun-' + r.job_id,
      rule: 'budget_overrun',
      severity: overrun > overrunPct * 2 ? 'high' : 'medium',
      title: (r.job_name || 'Job') + ' — costs ' + overrun.toFixed(0) + '% over planned',
      body: (r.client_name ? r.client_name + ' · ' : '')
        + 'Planned ' + fmtMoney(planned) + ' · Actual ' + fmtMoney(actual)
        + ' · Over by ' + fmtMoney(actual - planned),
      link: '/finance/jobs/' + r.job_id,
      meta: { planned, actual, overrun_pct: overrun, threshold_pct: overrunPct },
    });
  }
  return out.sort((a, b) => b.meta.overrun_pct - a.meta.overrun_pct);
}

// ─── Rule 4: Quotes sent with no response for > N days ──────────────────────

function ruleStaleQuotes(userId, thresholds) {
  const N = thresholds.quote_stale_days;
  const rows = db.prepare(`
    SELECT id, quote_number, project_name, client_name, grand_total, updated_at
    FROM quotes
    WHERE user_id = ?
      AND status = 'sent'
      AND julianday('now') - julianday(updated_at) > ?
    ORDER BY updated_at ASC
  `).all(userId, N);
  return rows.map(r => {
    const days = daysSince(r.updated_at);
    return {
      id: 'quote-stale-' + r.id,
      rule: 'quote_stale',
      severity: days > N * 2 ? 'high' : 'low',
      title: (r.quote_number || 'Quote') + ' — sent ' + days + ' days ago, no response',
      body: (r.client_name ? r.client_name + ' · ' : '')
        + (r.project_name || '') + ' · ' + fmtMoney(r.grand_total),
      link: '/estimator/' + r.id,
      meta: { days_outstanding: days, value: r.grand_total, threshold: N },
    };
  });
}

// ─── Rule 5: Job effective day-rate below break-even ────────────────────────
//
// Interpretation (per the schema discovery):
//   - Take the user's most recent overheads row → break_even_day.
//   - For each job that has both a budget and a quote-derived contract value:
//       implied_days = planned_labour / break_even_day
//       effective_day_rate = planned_revenue / implied_days
//   - If effective_day_rate < break_even_day, flag.
// Assumes labour is priced at break-even/day. The card shows the assumption
// so the user can sanity-check it. Skip silently when overheads aren't set
// (we can't compute the floor without them).

function ruleDayRateBelowBreakeven(userId) {
  const oh = db.prepare(`
    SELECT break_even_day FROM overheads
    WHERE user_id = ? AND break_even_day IS NOT NULL AND break_even_day > 0
    ORDER BY month DESC LIMIT 1
  `).get(userId);
  if (!oh) return [];
  const floor = Number(oh.break_even_day);

  const rows = db.prepare(`
    SELECT j.id AS job_id, j.name AS job_name, j.client_name,
           b.planned_labour, b.planned_revenue
    FROM estimator_jobs j
    INNER JOIN job_budgets b ON b.job_id = j.id AND b.user_id = j.user_id
    WHERE j.user_id = ?
      AND b.planned_labour > 0
      AND b.planned_revenue > 0
  `).all(userId);

  const out = [];
  for (const r of rows) {
    const labour = Number(r.planned_labour);
    const revenue = Number(r.planned_revenue);
    const impliedDays = labour / floor;
    if (impliedDays <= 0) continue;
    const effectiveRate = revenue / impliedDays;
    if (effectiveRate >= floor) continue;
    const shortfall = floor - effectiveRate;
    out.push({
      id: 'day-rate-' + r.job_id,
      rule: 'day_rate_below_breakeven',
      severity: shortfall > floor * 0.2 ? 'high' : 'medium',
      title: (r.job_name || 'Job') + ' — effective day-rate ' + fmtMoney(effectiveRate) + ' is below break-even',
      body: (r.client_name ? r.client_name + ' · ' : '')
        + 'Break-even ' + fmtMoney(floor) + '/day · '
        + 'Revenue ' + fmtMoney(revenue) + ' over ~' + impliedDays.toFixed(1) + ' days · '
        + 'Short by ' + fmtMoney(shortfall) + '/day',
      link: '/finance/jobs/' + r.job_id,
      meta: { break_even_day: floor, effective_rate: effectiveRate, shortfall, implied_days: impliedDays },
    });
  }
  return out.sort((a, b) => b.meta.shortfall - a.meta.shortfall);
}

// ─── Rule 6 (A4): retention falling due ─────────────────────────────────────
// Builders forget retention money constantly. Alert from 14 days before the
// release date, loudest once it's passed. Amount = retention_pct of the job's
// planned revenue (best available figure).

function ruleRetentionDue(userId) {
  const rows = db.prepare(`
    SELECT j.id, j.name, j.client_name, j.retention_pct, j.retention_release_date,
           b.planned_revenue
    FROM estimator_jobs j
    LEFT JOIN job_budgets b ON b.job_id = j.id
    WHERE j.user_id = ?
      AND j.retention_pct > 0
      AND j.retention_release_date IS NOT NULL
      AND date(j.retention_release_date) <= date('now', '+14 days')
      AND j.status != 'cancelled'
    ORDER BY j.retention_release_date ASC
  `).all(userId);
  return rows.map(r => {
    const days = daysUntil(r.retention_release_date);
    const isDue = days <= 0;
    const amount = (Number(r.planned_revenue) || 0) * (Number(r.retention_pct) || 0) / 100;
    return {
      id: 'retention-due-' + r.id,
      rule: 'retention_due',
      severity: isDue ? 'high' : 'medium',
      title: 'Retention on ' + (r.name || 'a job') + ' — '
        + (isDue ? 'due back now' : 'due back in ' + days + ' day(s)'),
      body: (r.client_name ? r.client_name + ' · ' : '')
        + (amount > 0 ? fmtMoney(amount) + ' held back (' + r.retention_pct + '%) · ' : r.retention_pct + '% held back · ')
        + 'release date ' + r.retention_release_date + ' — invoice it before it gets forgotten',
      link: '/finance/jobs/' + r.id,
      meta: { days_to_due: days, value: amount, retention_pct: r.retention_pct },
    };
  });
}

// ─── Aggregator ─────────────────────────────────────────────────────────────

function gatherAlerts(userId) {
  const thresholds = getThresholds(userId);
  const cards = [
    ...ruleStaleVariations(userId, thresholds),
    ...rulePaymentsDue(userId, thresholds),
    ...ruleBudgetOverrun(userId, thresholds),
    ...ruleStaleQuotes(userId, thresholds),
    ...ruleDayRateBelowBreakeven(userId),
    ...ruleRetentionDue(userId),
  ];
  const severityOrder = { high: 0, medium: 1, low: 2 };
  cards.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));
  return { cards, thresholds, generated_at: new Date().toISOString() };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get('/alerts', (req, res) => {
  try {
    res.json(gatherAlerts(req.user.id));
  } catch (err) {
    console.error('[PM] alerts error:', err);
    res.status(500).json({ error: 'Failed to load alerts.' });
  }
});

router.get('/thresholds', (req, res) => {
  try {
    res.json({ thresholds: getThresholds(req.user.id) });
  } catch (err) {
    console.error('[PM] thresholds get error:', err);
    res.status(500).json({ error: 'Failed to load thresholds.' });
  }
});

router.patch('/thresholds', (req, res) => {
  try {
    getThresholds(req.user.id); // seed row if missing
    const b = req.body || {};
    const sets = [];
    const vals = [];
    function take(key, type) {
      if (!(key in b)) return;
      let v = b[key];
      if (type === 'int') { v = parseInt(v, 10); if (!Number.isFinite(v) || v < 0) return; }
      if (type === 'float') { v = parseFloat(v); if (!Number.isFinite(v) || v < 0) return; }
      sets.push(key + ' = ?');
      vals.push(v);
    }
    take('variation_stale_days', 'int');
    take('quote_stale_days', 'int');
    take('budget_overrun_pct', 'float');
    take('payment_due_horizon_days', 'int');
    if (sets.length === 0) return res.json({ thresholds: getThresholds(req.user.id) });
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(req.user.id);
    db.prepare('UPDATE pm_alert_thresholds SET ' + sets.join(', ') + ' WHERE user_id = ?').run(...vals);
    res.json({ thresholds: getThresholds(req.user.id) });
  } catch (err) {
    console.error('[PM] thresholds patch error:', err);
    res.status(500).json({ error: 'Failed to update thresholds.' });
  }
});

module.exports = router;

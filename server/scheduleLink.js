// ═══════════════════════════════════════════════════════════════════════════
// scheduleLink.js — connect approved change orders to the build schedule.
//
// Phase 2 of PHASED_BUILD_PLAN.md: when a change order (variation) is approved,
// automatically add it to the job's build programme as a costed task, re-flow
// the dates, and snapshot the change. The task carries an explicit cost, so it
// also flows straight into the Phase 1 cash flow.
//
// Owner-portal only: the caller passes the owning user's role and we no-op for
// non-admins, keeping this trial behaviour on the owner's portal while the rest
// of the change-order flow stays available to estimator users.
// ═══════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { computeSchedule } = require('./scheduleEngine');

// Duration heuristic from the change order's labour value. We have no crew size,
// so this is a sensible starting point the owner edits on the timeline:
// ~1 working day per £250 of labour, min 1, capped at 20. Falls back to 1 day
// when there's no labour split (e.g. a materials-only or lump-sum variation).
function estimateDurationDays(lines) {
  const labour = (lines || []).reduce((s, l) => s + (Number(l.labour) || 0), 0);
  if (labour > 0) return Math.min(20, Math.max(1, Math.round(labour / 250)));
  return 1;
}

// Re-flow a plan's dates after a structural change. Mirrors reflowPlan in
// scheduleRoutes.js (kept local to avoid pulling the auth'd router in here).
function reflowPlan(plan) {
  const rows = db.prepare(
    'SELECT id, duration_days, lag_days, depends_on, sort_order, actual_start, actual_end FROM schedule_tasks WHERE plan_id = ?'
  ).all(plan.id);
  if (rows.length === 0) return;
  const computed = computeSchedule(
    rows.map((r) => ({
      id: r.id, duration_days: r.duration_days, lag_days: r.lag_days,
      depends_on: r.depends_on, sort_order: r.sort_order,
      actual_start: r.actual_start, actual_end: r.actual_end,
    })),
    plan.start_date,
    plan.working_days
  );
  const upd = db.prepare('UPDATE schedule_tasks SET planned_start = ?, planned_end = ? WHERE id = ?');
  const txn = db.transaction(() => {
    for (const c of computed) upd.run(c.planned_start, c.planned_end, c.id);
    db.prepare('UPDATE schedule_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(plan.id);
  });
  txn();
}

// Add an approved change order to the job's schedule as a costed task.
// Idempotent: skips if this variation is already on a plan. Returns a small
// result object so the caller can log the outcome, never throws for the normal
// "nothing to do" cases.
//   { added: true,  planId, taskId }
//   { added: false, reason: 'not_owner_portal' | 'not_approved' | 'no_variation'
//                          | 'already_added' | 'no_plan', taskId? }
function addApprovedVariationToSchedule(variationId, ownerRole) {
  if (ownerRole !== 'admin') return { added: false, reason: 'not_owner_portal' };

  const v = db.prepare('SELECT * FROM estimator_variations WHERE id = ?').get(variationId);
  if (!v) return { added: false, reason: 'no_variation' };
  if (v.status !== 'approved') return { added: false, reason: 'not_approved' };

  // Idempotency — never add the same change order twice.
  const existing = db.prepare('SELECT id FROM schedule_tasks WHERE variation_id = ?').get(v.id);
  if (existing) return { added: false, reason: 'already_added', taskId: existing.id };

  // The job's schedule (most recent plan). No programme yet → nothing to add to.
  const plan = db.prepare(
    'SELECT * FROM schedule_plans WHERE job_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(v.job_id);
  if (!plan) return { added: false, reason: 'no_plan' };

  const lines = db.prepare('SELECT labour FROM estimator_variation_lines WHERE variation_id = ?').all(v.id);
  const duration = estimateDurationDays(lines);

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM schedule_tasks WHERE plan_id = ?'
  ).get(plan.id).m;

  // Default the change order to run after the current programme: depend on the
  // latest-finishing dated task. The owner can re-point it on the timeline.
  const last = db.prepare(
    'SELECT id FROM schedule_tasks WHERE plan_id = ? AND planned_end IS NOT NULL '
    + 'ORDER BY planned_end DESC, sort_order DESC LIMIT 1'
  ).get(plan.id);
  const depends = last ? [last.id] : [];

  const label = ('VO ' + (v.vo_number || '') + (v.title ? ': ' + v.title : '')).trim().slice(0, 200);
  const taskId = 'st_' + uuidv4().slice(0, 12);

  db.prepare(
    'INSERT INTO schedule_tasks (id, plan_id, phase, name, sort_order, duration_days, depends_on, '
    + 'status, percent_complete, cost_amount, variation_id, notes) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    taskId, plan.id, 'Variations', label || 'Change order',
    maxOrder + 1, duration, JSON.stringify(depends),
    'not_started', 0, Number(v.grand_total) || 0, v.id,
    'Auto-added from approved change order ' + (v.vo_number || '')
  );

  reflowPlan(plan);

  // Snapshot so the programme change is on record (best-effort).
  try {
    const tasks = db.prepare('SELECT * FROM schedule_tasks WHERE plan_id = ?').all(plan.id);
    db.prepare('INSERT INTO schedule_snapshots (id, plan_id, label, data) VALUES (?, ?, ?, ?)')
      .run('ss_' + uuidv4().slice(0, 12), plan.id, ('Added ' + (label || 'change order')).slice(0, 80), JSON.stringify(tasks));
  } catch (e) { /* snapshot is not critical to the link */ }

  return { added: true, planId: plan.id, taskId };
}

module.exports = { addApprovedVariationToSchedule, estimateDurationDays };

// ═══════════════════════════════════════════════════════════════════════════
// INTELLIGENT BUILD SCHEDULE — server/scheduleRoutes.js  (Wave 6, Stage 1)
//
// Generate a build programme off the back of an estimate, view it as a timeline,
// edit tasks (durations/dependencies re-flow the dates), and export a branded
// PDF. Stage 2 (conversational "tell the bot what happened on site") will add an
// agent tool on top of this same data model.
//
// ADMIN ONLY for now. Mounted at /api/schedule with authMiddleware +
// adminMiddleware. Rolling out to all estimator users later is a one-line gate
// swap (adminMiddleware -> requireEstimator), per BUILD_SCHEDULE_SPEC.md.
//
//   GET    /api/schedule/plans?job_id=       list a job's plans (with window)
//   POST   /api/schedule/plans               generate (AI) or create a blank plan
//   GET    /api/schedule/plans/:id           plan + tasks
//   PATCH  /api/schedule/plans/:id           title/status/start_date/working_days
//   DELETE /api/schedule/plans/:id
//   POST   /api/schedule/plans/:id/tasks     add a task
//   PATCH  /api/schedule/tasks/:id           edit a task (re-flows dates)
//   DELETE /api/schedule/tasks/:id
//   POST   /api/schedule/plans/:id/snapshot  freeze the plan (baseline/re-plan)
//   GET    /api/schedule/plans/:id/export    branded PDF
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { callModel, MODELS } = require('./anthropicClient');
const { authMiddleware, adminMiddleware } = require('./auth');
const { computeSchedule, programmeWindow } = require('./scheduleEngine');
const { streamSchedulePdf } = require('./schedulePdf');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const TASK_STATUSES = new Set(['not_started', 'in_progress', 'done', 'blocked']);
const PLAN_STATUSES = new Set(['draft', 'active', 'complete']);

function getBranding(userId) {
  const row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  return row || {
    user_id: userId, logo_filename: null,
    primary_colour: '#1B2A4A', accent_colour: '#F59E0B',
    company_name: null, company_address: null, footer_text: null, template: 'modern',
  };
}

function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company, phone FROM users WHERE id = ?').get(userId);
}

function ownedJob(jobId, userId) {
  return db.prepare('SELECT * FROM estimator_jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
}

function ownedPlan(planId, userId) {
  return db.prepare('SELECT * FROM schedule_plans WHERE id = ? AND user_id = ?').get(planId, userId);
}

// A task plus its owning plan, scoped to the user. Used by /tasks/:id routes.
function ownedTask(taskId, userId) {
  return db.prepare(
    'SELECT t.*, p.user_id AS plan_user_id, p.start_date AS plan_start, p.working_days AS plan_working_days '
    + 'FROM schedule_tasks t JOIN schedule_plans p ON p.id = t.plan_id '
    + 'WHERE t.id = ? AND p.user_id = ?'
  ).get(taskId, userId);
}

function parseJsonArray(s) {
  if (Array.isArray(s)) return s;
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// Serialise a DB task row for the client (JSON columns -> arrays).
function serialiseTask(t) {
  return {
    ...t,
    depends_on: parseJsonArray(t.depends_on),
    source_line_ids: parseJsonArray(t.source_line_ids),
  };
}

// Recompute planned_start/planned_end for every task in a plan and persist.
// Called after any change that affects dates (durations, dependencies, order,
// the plan's start date or working calendar).
function reflowPlan(plan) {
  const rows = db.prepare('SELECT id, duration_days, depends_on, sort_order FROM schedule_tasks WHERE plan_id = ?').all(plan.id);
  if (rows.length === 0) {
    db.prepare('UPDATE schedule_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(plan.id);
    return;
  }
  const computed = computeSchedule(
    rows.map((r) => ({ id: r.id, duration_days: r.duration_days, depends_on: r.depends_on, sort_order: r.sort_order })),
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

// Freeze the current task list as an immutable snapshot row.
function takeSnapshot(planId, label) {
  const tasks = db.prepare('SELECT * FROM schedule_tasks WHERE plan_id = ? ORDER BY sort_order ASC').all(planId);
  db.prepare('INSERT INTO schedule_snapshots (id, plan_id, label, data) VALUES (?, ?, ?, ?)')
    .run('ss_' + uuidv4().slice(0, 8), planId, label || null, JSON.stringify(tasks));
}

// ─── AI: draft a programme from the estimate ─────────────────────────────────

const SCHEDULE_SYSTEM_PROMPT = `You are a senior UK/Ireland construction planner producing a realistic build programme from a priced estimate.

Output ONLY via the submit_schedule tool — an ordered list of tasks that together deliver the scope.

RULES:
1. Group tasks into trade phases in correct build sequence (e.g. Prelims/Enabling, Groundworks, Substructure, Superstructure/Frame, Roof, External envelope, First fix, Plastering, Second fix, Finishes, External works, Handover/Snagging).
2. Each task has a duration in WORKING days (Mon–Fri), realistic for the quantities implied by the scope.
3. Model sequencing with depends_on: list the ref(s) of the task(s) that must FINISH before this one can start. Tasks with no dependency start at the programme beginning. A task may depend on more than one — use this to capture the real critical path, and allow trades that can run in parallel to do so.
4. Give every task a short unique ref ("t1", "t2", …) and reference those refs in depends_on.
5. Produce 8–30 tasks — enough to manage the build, not a micro-plan. Merge trivial items into a sensible task.
6. Durations are whole working days and must be at least 1.
7. Use UK construction terminology.`;

const SUBMIT_SCHEDULE_TOOL = {
  name: 'submit_schedule',
  description: 'Submit the drafted build programme as an ordered list of tasks with dependencies.',
  input_schema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Unique short id, e.g. "t1"' },
            phase: { type: 'string' },
            name: { type: 'string' },
            duration_days: { type: 'number' },
            depends_on: { type: 'array', items: { type: 'string' }, description: 'refs of tasks that must finish first' },
          },
          required: ['ref', 'name', 'duration_days'],
        },
      },
    },
    required: ['tasks'],
  },
};

async function draftTasksFromQuote({ quote, lines, userId }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const bySection = {};
  for (const ln of lines) {
    const s = (ln.section || 'General').slice(0, 60);
    (bySection[s] = bySection[s] || []).push(ln);
  }
  let scope = '';
  for (const [sec, items] of Object.entries(bySection)) {
    scope += '\n' + sec + ':\n';
    for (const it of items.slice(0, 40)) {
      const label = (it.item || it.description || '').toString().slice(0, 120);
      const qty = (it.qty != null && it.qty !== '') ? ' (' + it.qty + ' ' + (it.unit || '') + ')' : '';
      scope += '  - ' + label + qty + '\n';
    }
  }

  const userMsg = 'Project: ' + (quote.project_name || 'Build')
    + (quote.project_type ? ' (' + quote.project_type + ')' : '')
    + '\n\nPriced scope (from the estimate):\n' + scope.slice(0, 6000)
    + '\n\nProduce the build programme now.';

  const result = await callModel({
    model: MODELS.STANDARD,
    maxTokens: 4000,
    temperature: 0.3,
    system: [{ type: 'text', text: SCHEDULE_SYSTEM_PROMPT }],
    cacheSystem: true,
    messages: [{ role: 'user', content: userMsg }],
    tools: [SUBMIT_SCHEDULE_TOOL],
    toolChoice: { type: 'tool', name: 'submit_schedule' },
    userId,
    action: 'schedule_generate',
  });

  if (!result.ok) {
    const msg = result.error?.error?.message || result.error?.message || '';
    throw new Error('Claude API ' + result.status + ': ' + String(msg).slice(0, 200));
  }
  const tasks = result.json && Array.isArray(result.json.tasks) ? result.json.tasks : null;
  if (!tasks || tasks.length === 0) throw new Error('AI returned no tasks');
  return tasks;
}

// Map AI tasks (ref-based) into DB rows with uuid ids and id-based depends_on.
// Every task gets its own unique id even if the model reuses a ref; the ref→id
// map (first occurrence wins) is only used to resolve dependencies.
function aiTasksToRows(aiTasks) {
  const refToId = new Map();
  const staged = [];
  for (const t of aiTasks) {
    if (!t || !t.name) continue;
    const id = uuidv4();
    if (t.ref && !refToId.has(t.ref)) refToId.set(t.ref, id);
    staged.push({ t, id });
  }
  return staged.map(({ t, id }, i) => ({
    id,
    phase: (t.phase || '').toString().slice(0, 80) || null,
    name: t.name.toString().slice(0, 200),
    duration_days: clampInt(t.duration_days, 1, 365, 1),
    depends_on: (Array.isArray(t.depends_on) ? t.depends_on : [])
      .map((r) => refToId.get(r))
      .filter((d) => d && d !== id),
    sort_order: i,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTES — admin only
// ═══════════════════════════════════════════════════════════════════════════

router.use(authMiddleware, adminMiddleware);

// GET /plans?job_id=
router.get('/plans', (req, res) => {
  try {
    const jobId = String(req.query.job_id || '');
    if (!jobId) return res.status(400).json({ error: 'job_id is required.' });
    if (!ownedJob(jobId, req.user.id)) return res.status(404).json({ error: 'Job not found.' });
    const plans = db.prepare(
      'SELECT p.*, '
      + '(SELECT COUNT(*) FROM schedule_tasks WHERE plan_id = p.id) AS task_count, '
      + '(SELECT MIN(planned_start) FROM schedule_tasks WHERE plan_id = p.id) AS window_start, '
      + '(SELECT MAX(planned_end) FROM schedule_tasks WHERE plan_id = p.id) AS window_end '
      + 'FROM schedule_plans p WHERE p.job_id = ? AND p.user_id = ? ORDER BY p.created_at DESC'
    ).all(jobId, req.user.id);
    res.json({ plans });
  } catch (err) {
    console.error('[Schedule] list error:', err);
    res.status(500).json({ error: 'Failed to load schedules.' });
  }
});

// POST /plans  — generate from a quote (default) or create a blank plan.
// Body: { job_id, quote_id?, start_date?, title?, working_days?, generate? }
router.post('/plans', async (req, res) => {
  try {
    const b = req.body || {};
    const jobId = String(b.job_id || '');
    const job = ownedJob(jobId, req.user.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    // Resolve the quote: explicit id, else the most recent quote on this job.
    let quote = null;
    if (b.quote_id) {
      quote = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(b.quote_id, req.user.id);
      if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    } else {
      quote = db.prepare('SELECT * FROM quotes WHERE job_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(jobId, req.user.id);
    }

    const generate = b.generate !== false;
    const startDate = (b.start_date && /^\d{4}-\d{2}-\d{2}$/.test(b.start_date))
      ? b.start_date
      : new Date().toISOString().slice(0, 10);
    const workingDays = JSON.stringify(
      Array.isArray(b.working_days) && b.working_days.length ? b.working_days : [1, 2, 3, 4, 5]
    );
    const title = (b.title || (quote && quote.project_name) || job.name || 'Build programme').toString().slice(0, 120);

    // Draft tasks up-front (network call) so the DB transaction stays synchronous.
    let rows = [];
    if (generate) {
      if (!quote) {
        return res.status(400).json({ error: 'No quote on this job to generate from. Add a quote first, or create a blank plan.' });
      }
      const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(quote.id);
      if (lines.length === 0) return res.status(400).json({ error: 'That quote has no line items to plan from.' });
      let aiTasks;
      try {
        aiTasks = await draftTasksFromQuote({ quote, lines, userId: req.user.id });
      } catch (err) {
        console.error('[Schedule] AI draft failed:', err.message);
        return res.status(502).json({ error: 'The AI could not draft a schedule right now. Please try again in a moment.' });
      }
      rows = aiTasksToRows(aiTasks);
      const computed = computeSchedule(rows, startDate, workingDays);
      // Merge computed dates back by id.
      const dates = new Map(computed.map((c) => [c.id, c]));
      rows = rows.map((r) => ({ ...r, planned_start: dates.get(r.id)?.planned_start || null, planned_end: dates.get(r.id)?.planned_end || null }));
    }

    const planId = 'sp_' + uuidv4().slice(0, 12);
    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO schedule_plans (id, user_id, job_id, quote_id, title, start_date, working_days, status) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(planId, req.user.id, jobId, quote ? quote.id : null, title, startDate, workingDays, 'draft');

      if (rows.length) {
        const ins = db.prepare(
          'INSERT INTO schedule_tasks (id, plan_id, phase, name, sort_order, duration_days, depends_on, planned_start, planned_end) '
          + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        for (const r of rows) {
          ins.run(r.id, planId, r.phase, r.name, r.sort_order, r.duration_days, JSON.stringify(r.depends_on || []), r.planned_start, r.planned_end);
        }
        takeSnapshot(planId, 'Baseline');
      }
    });
    txn();

    res.status(201).json({ id: planId, task_count: rows.length });
  } catch (err) {
    console.error('[Schedule] create error:', err);
    res.status(500).json({ error: 'Failed to create the schedule.' });
  }
});

// GET /plans/:id
router.get('/plans/:id', (req, res) => {
  try {
    const plan = ownedPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Schedule not found.' });
    const tasks = db.prepare('SELECT * FROM schedule_tasks WHERE plan_id = ? ORDER BY planned_start ASC, sort_order ASC').all(plan.id);
    res.json({
      plan: { ...plan, working_days: parseJsonArray(plan.working_days) },
      tasks: tasks.map(serialiseTask),
      window: programmeWindow(tasks),
    });
  } catch (err) {
    console.error('[Schedule] get error:', err);
    res.status(500).json({ error: 'Failed to load the schedule.' });
  }
});

// PATCH /plans/:id  — header + calendar; re-flows when dates/calendar change.
router.patch('/plans/:id', (req, res) => {
  try {
    const plan = ownedPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Schedule not found.' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let needsReflow = false;

    if ('title' in b) { sets.push('title = ?'); vals.push(String(b.title || '').slice(0, 120) || 'Build programme'); }
    if ('status' in b && PLAN_STATUSES.has(b.status)) { sets.push('status = ?'); vals.push(b.status); }
    if ('start_date' in b) {
      const sd = (b.start_date && /^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) ? b.start_date : null;
      sets.push('start_date = ?'); vals.push(sd); needsReflow = true;
    }
    if ('working_days' in b) {
      const wd = Array.isArray(b.working_days) && b.working_days.length ? b.working_days : [1, 2, 3, 4, 5];
      sets.push('working_days = ?'); vals.push(JSON.stringify(wd)); needsReflow = true;
    }

    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(plan.id);
      db.prepare('UPDATE schedule_plans SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    if (needsReflow) reflowPlan(ownedPlan(plan.id, req.user.id));
    res.json({ id: plan.id });
  } catch (err) {
    console.error('[Schedule] patch plan error:', err);
    res.status(500).json({ error: 'Failed to update the schedule.' });
  }
});

// DELETE /plans/:id
router.delete('/plans/:id', (req, res) => {
  try {
    const plan = ownedPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Schedule not found.' });
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM schedule_tasks WHERE plan_id = ?').run(plan.id);
      db.prepare('DELETE FROM schedule_snapshots WHERE plan_id = ?').run(plan.id);
      db.prepare('DELETE FROM schedule_plans WHERE id = ?').run(plan.id);
    });
    txn();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Schedule] delete plan error:', err);
    res.status(500).json({ error: 'Failed to delete the schedule.' });
  }
});

// Keep only dependency ids that point at real tasks in this plan (not self).
function cleanDepends(planId, taskId, depends) {
  if (!Array.isArray(depends)) return [];
  const ids = new Set(db.prepare('SELECT id FROM schedule_tasks WHERE plan_id = ?').all(planId).map((r) => r.id));
  return Array.from(new Set(depends.filter((d) => d !== taskId && ids.has(d))));
}

// POST /plans/:id/tasks  — add one task, then re-flow.
router.post('/plans/:id/tasks', (req, res) => {
  try {
    const plan = ownedPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Schedule not found.' });
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 200);
    if (!name) return res.status(400).json({ error: 'Give the task a name.' });

    const taskId = 'st_' + uuidv4().slice(0, 12);
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM schedule_tasks WHERE plan_id = ?').get(plan.id).m;
    const depends = cleanDepends(plan.id, taskId, b.depends_on);

    db.prepare(
      'INSERT INTO schedule_tasks (id, plan_id, phase, name, sort_order, duration_days, depends_on, status, percent_complete) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      taskId, plan.id,
      (b.phase || '').toString().slice(0, 80) || null,
      name,
      b.sort_order != null ? clampInt(b.sort_order, 0, 100000, maxOrder + 1) : maxOrder + 1,
      clampInt(b.duration_days, 1, 365, 1),
      JSON.stringify(depends),
      TASK_STATUSES.has(b.status) ? b.status : 'not_started',
      clampInt(b.percent_complete, 0, 100, 0)
    );

    reflowPlan(plan);
    res.status(201).json({ id: taskId });
  } catch (err) {
    console.error('[Schedule] add task error:', err);
    res.status(500).json({ error: 'Failed to add the task.' });
  }
});

// PATCH /tasks/:id  — edit a task; re-flow when scheduling fields change.
router.patch('/tasks/:id', (req, res) => {
  try {
    const task = ownedTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let needsReflow = false;

    if ('name' in b) { sets.push('name = ?'); vals.push(String(b.name || '').slice(0, 200) || 'Task'); }
    if ('phase' in b) { sets.push('phase = ?'); vals.push((b.phase || '').toString().slice(0, 80) || null); }
    if ('notes' in b) { sets.push('notes = ?'); vals.push(b.notes != null ? String(b.notes).slice(0, 1000) : null); }
    if ('status' in b && TASK_STATUSES.has(b.status)) { sets.push('status = ?'); vals.push(b.status); }
    if ('percent_complete' in b) { sets.push('percent_complete = ?'); vals.push(clampInt(b.percent_complete, 0, 100, 0)); }
    if ('actual_start' in b) { sets.push('actual_start = ?'); vals.push((b.actual_start && /^\d{4}-\d{2}-\d{2}$/.test(b.actual_start)) ? b.actual_start : null); }
    if ('actual_end' in b) { sets.push('actual_end = ?'); vals.push((b.actual_end && /^\d{4}-\d{2}-\d{2}$/.test(b.actual_end)) ? b.actual_end : null); }
    if ('duration_days' in b) { sets.push('duration_days = ?'); vals.push(clampInt(b.duration_days, 1, 365, 1)); needsReflow = true; }
    if ('sort_order' in b) { sets.push('sort_order = ?'); vals.push(clampInt(b.sort_order, 0, 100000, task.sort_order)); needsReflow = true; }
    if ('depends_on' in b) {
      const depends = cleanDepends(task.plan_id, task.id, b.depends_on);
      sets.push('depends_on = ?'); vals.push(JSON.stringify(depends)); needsReflow = true;
    }

    if (sets.length) {
      vals.push(task.id);
      db.prepare('UPDATE schedule_tasks SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    if (needsReflow) reflowPlan(ownedPlan(task.plan_id, req.user.id));
    res.json({ id: task.id });
  } catch (err) {
    console.error('[Schedule] patch task error:', err);
    res.status(500).json({ error: 'Failed to update the task.' });
  }
});

// DELETE /tasks/:id  — remove, strip it from other tasks' dependencies, re-flow.
router.delete('/tasks/:id', (req, res) => {
  try {
    const task = ownedTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    const plan = ownedPlan(task.plan_id, req.user.id);
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM schedule_tasks WHERE id = ?').run(task.id);
      // Strip the deleted id out of every remaining task's depends_on.
      const siblings = db.prepare('SELECT id, depends_on FROM schedule_tasks WHERE plan_id = ?').all(plan.id);
      const upd = db.prepare('UPDATE schedule_tasks SET depends_on = ? WHERE id = ?');
      for (const s of siblings) {
        const dep = parseJsonArray(s.depends_on);
        if (dep.includes(task.id)) upd.run(JSON.stringify(dep.filter((d) => d !== task.id)), s.id);
      }
    });
    txn();
    reflowPlan(plan);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Schedule] delete task error:', err);
    res.status(500).json({ error: 'Failed to delete the task.' });
  }
});

// POST /plans/:id/snapshot
router.post('/plans/:id/snapshot', (req, res) => {
  try {
    const plan = ownedPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Schedule not found.' });
    const label = (req.body && req.body.label ? String(req.body.label) : 'Snapshot ' + new Date().toISOString().slice(0, 10)).slice(0, 80);
    takeSnapshot(plan.id, label);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[Schedule] snapshot error:', err);
    res.status(500).json({ error: 'Failed to snapshot the schedule.' });
  }
});

// GET /plans/:id/export  — branded PDF
router.get('/plans/:id/export', (req, res) => {
  try {
    const plan = ownedPlan(req.params.id, req.user.id);
    if (!plan) return res.status(404).json({ error: 'Schedule not found.' });
    const tasks = db.prepare('SELECT * FROM schedule_tasks WHERE plan_id = ? ORDER BY planned_start ASC, sort_order ASC').all(plan.id);
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    streamSchedulePdf(res, plan, tasks, branding, userInfo);
  } catch (err) {
    console.error('[Schedule] export error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate the PDF.' });
  }
});

module.exports = router;

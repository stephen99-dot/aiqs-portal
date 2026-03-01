const express = require('express');
const router = express.Router();
const db = require('./database');
const { authMiddleware, adminMiddleware } = require('./auth');
const { logActivity } = require('./activityRoutes');

// ═══════════════════════════════════════════════════════════════════
// PIPELINE TRACKING — real-time status updates from Pipedream
//
// How it works:
// 1. When a project is submitted, a pipeline_runs row is created
// 2. Each Pipedream step sends a POST to /api/pipeline/status
// 3. The admin Pipeline page polls /api/pipeline/runs to show live progress
// ═══════════════════════════════════════════════════════════════════

// Create tables on load
db.exec(`
  CREATE TABLE IF NOT EXISTS pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    project_title TEXT,
    client_name TEXT,
    client_email TEXT,
    status TEXT DEFAULT 'running',
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS pipeline_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    step_label TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    error_message TEXT,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
  );
`);

// The 11 steps in your Pipedream workflow, in order
const PIPELINE_STEPS = [
  { key: 'trigger',              label: 'Trigger Received',        order: 1 },
  { key: 'normalize_payload',    label: 'Normalise Payload',       order: 2 },
  { key: 'create_folder',        label: 'Create Drive Folder',     order: 3 },
  { key: 'create_subfolders',    label: 'Create Subfolders',       order: 4 },
  { key: 'upload_files',         label: 'Upload Files to Drive',   order: 5 },
  { key: 'generate_boq',         label: 'Generate BOQ',            order: 6 },
  { key: 'match_rates',          label: 'Match Rates',             order: 7 },
  { key: 'build_excel',          label: 'Build Excel BOQ',         order: 8 },
  { key: 'create_doc_report',    label: 'Create Doc Report',       order: 9 },
  { key: 'log_usage',            label: 'Log Usage',               order: 10 },
  { key: 'send_email',           label: 'Send Notification Email', order: 11 },
];

// ─── Start a pipeline run (called from triggerPipedream in routes.js) ───
function startPipelineRun({ project_id, project_title, client_name, client_email }) {
  try {
    const result = db.prepare(
      'INSERT INTO pipeline_runs (project_id, project_title, client_name, client_email) VALUES (?, ?, ?, ?)'
    ).run(project_id, project_title || '', client_name || '', client_email || '');

    const runId = result.lastInsertRowid;

    // Create all step rows as "pending"
    const insertStep = db.prepare(
      'INSERT INTO pipeline_steps (run_id, step_key, step_label, step_order, status) VALUES (?, ?, ?, ?, ?)'
    );
    for (const step of PIPELINE_STEPS) {
      insertStep.run(runId, step.key, step.label, step.order, 'pending');
    }

    return runId;
  } catch (err) {
    console.error('Failed to start pipeline run:', err.message);
    return null;
  }
}

// ─── POST /api/pipeline/status — Pipedream calls this at each step ───
// Body: { project_id, step: "generate_boq", status: "running"|"complete"|"error", error?: "msg" }
// No auth required — Pipedream calls this externally
router.post('/pipeline/status', (req, res) => {
  try {
    const { project_id, step, status, error } = req.body;

    if (!project_id || !step || !status) {
      return res.status(400).json({ error: 'project_id, step, and status are required' });
    }

    // Find the most recent run for this project
    const run = db.prepare(
      'SELECT * FROM pipeline_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1'
    ).get(project_id);

    if (!run) {
      // Auto-create a run if one doesn't exist
      const newRunId = startPipelineRun({ project_id });
      if (!newRunId) return res.status(500).json({ error: 'Failed to create pipeline run' });
      return handleStepUpdate(newRunId, step, status, error, res);
    }

    return handleStepUpdate(run.id, step, status, error, res);
  } catch (err) {
    console.error('Pipeline status update error:', err);
    res.status(500).json({ error: 'Failed to update pipeline status' });
  }
});

function handleStepUpdate(runId, stepKey, status, errorMsg, res) {
  const now = new Date().toISOString();

  const stepRow = db.prepare(
    'SELECT * FROM pipeline_steps WHERE run_id = ? AND step_key = ?'
  ).get(runId, stepKey);

  if (!stepRow) {
    return res.status(404).json({ error: 'Unknown step: ' + stepKey });
  }

  if (status === 'running') {
    db.prepare(
      'UPDATE pipeline_steps SET status = ?, started_at = ? WHERE id = ?'
    ).run('running', now, stepRow.id);
  } else if (status === 'complete') {
    const duration = stepRow.started_at
      ? new Date(now).getTime() - new Date(stepRow.started_at).getTime()
      : null;
    db.prepare(
      'UPDATE pipeline_steps SET status = ?, completed_at = ?, duration_ms = ? WHERE id = ?'
    ).run('complete', now, duration, stepRow.id);
  } else if (status === 'error') {
    db.prepare(
      'UPDATE pipeline_steps SET status = ?, completed_at = ?, error_message = ? WHERE id = ?'
    ).run('error', now, errorMsg || 'Unknown error', stepRow.id);

    // Mark the whole run as failed
    db.prepare(
      'UPDATE pipeline_runs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?'
    ).run('error', errorMsg || 'Step failed: ' + stepKey, now, runId);

    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
    if (run) {
      logActivity({
        event_type: 'error',
        title: 'Pipeline error: ' + (run.project_title || run.project_id),
        detail: 'Failed at: ' + stepKey + (errorMsg ? ' — ' + errorMsg : ''),
        user_name: run.client_name,
        user_email: run.client_email,
      });
    }
  }

  // Check if all steps are complete
  const allSteps = db.prepare('SELECT * FROM pipeline_steps WHERE run_id = ?').all(runId);
  const allDone = allSteps.every(s => s.status === 'complete');
  if (allDone) {
    db.prepare(
      'UPDATE pipeline_runs SET status = ?, completed_at = ? WHERE id = ?'
    ).run('complete', now, runId);

    const run = db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
    if (run) {
      db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('completed', run.project_id);

      logActivity({
        event_type: 'project_completed',
        title: (run.client_name || 'Client') + ' — BOQ complete',
        detail: run.project_title,
        user_name: run.client_name,
        user_email: run.client_email,
      });
    }
  }

  res.json({ ok: true, run_id: runId, step: stepKey, status });
}

// ─── GET /api/pipeline/runs — admin fetches all pipeline runs ───
router.get('/pipeline/runs', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const status = req.query.status || null;

    let query = 'SELECT * FROM pipeline_runs';
    const params = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY started_at DESC LIMIT ?';
    params.push(limit);

    const runs = db.prepare(query).all(...params);

    const getSteps = db.prepare(
      'SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY step_order ASC'
    );

    const result = runs.map(run => ({
      ...run,
      steps: getSteps.all(run.id),
    }));

    res.json(result);
  } catch (err) {
    console.error('Failed to fetch pipeline runs:', err);
    res.status(500).json({ error: 'Failed to fetch pipeline runs' });
  }
});

module.exports = { router, startPipelineRun };

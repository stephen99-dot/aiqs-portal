// Routes for the BOQ agent.
//   POST /api/agent             — start a run (multipart upload)
//   GET  /api/agent/:id         — current snapshot
//   GET  /api/agent/:id/stream  — SSE live stream (replays snapshot then tails)
//   GET  /api/agent             — list recent runs

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');
const db = require('./database');
const agent = require('./agent');
const { runAgent } = require('./agentRunner');

let zipProcessor = null;
try { zipProcessor = require('./zipProcessor'); } catch (e) { console.log('[Agent] zipProcessor not available'); }

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 150 * 1024 * 1024, fieldSize: 50 * 1024 * 1024 },
});

// Take the multer-uploaded files, unpack any ZIPs, and produce a flat
// directory the agent can read by filename via view_pdf_page. Returns
// { tmpDir, extractedNames, pdfNotes } — tmpDir is the root the agent
// will reference.
async function prepareTmpDir(files) {
  const tmpDir = path.join(uploadsDir, 'agent_' + uuidv4().slice(0, 8));
  fs.mkdirSync(tmpDir, { recursive: true });
  const extractedNames = [];
  const pdfNotes = [];

  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext === '.zip' && zipProcessor) {
      try {
        const zipData = await zipProcessor.processZip(f.path, uploadsDir, { skipCleanup: true });
        // Copy each extracted file into tmpDir under its original name so
        // the agent can find it by filename without navigating subfolders.
        for (const fi of (zipData.files || [])) {
          if (!fi.filePath || !fs.existsSync(fi.filePath)) continue;
          const target = path.join(tmpDir, fi.filename);
          try {
            fs.copyFileSync(fi.filePath, target);
            extractedNames.push(fi.filename);
            const sizeMb = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
            pdfNotes.push(`${fi.filename} (${fi.type}, ${sizeMb} MB)`);
          } catch (copyErr) {
            console.warn('[Agent prep] copy failed for', fi.filename, copyErr.message);
          }
        }
        // Clean up zipProcessor's tmp dir — we've copied what we need
        if (zipData.tmpDir) {
          try { fs.rmSync(zipData.tmpDir, { recursive: true, force: true }); } catch (e) {}
        }
      } catch (zipErr) {
        console.error('[Agent prep] ZIP processing failed:', zipErr.message);
        pdfNotes.push(`ZIP ${f.originalname} could not be extracted: ${zipErr.message}`);
      }
      try { fs.unlinkSync(f.path); } catch (e) {}
    } else {
      // Direct file upload — copy to tmpDir under original name
      const target = path.join(tmpDir, f.originalname);
      try {
        fs.copyFileSync(f.path, target);
        extractedNames.push(f.originalname);
        const sizeMb = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
        pdfNotes.push(`${f.originalname} (${sizeMb} MB)`);
      } catch (e) {
        console.warn('[Agent prep] direct copy failed:', e.message);
      }
      try { fs.unlinkSync(f.path); } catch (e) {}
    }
  }
  return { tmpDir, extractedNames, pdfNotes };
}

// ── POST /api/agent — start a run ─────────────────────────────────────
router.post('/agent', authMiddleware, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Upload failed: ' + err.message });
    next();
  });
}, async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

    const files = req.files || [];
    const scopeText = (req.body && req.body.scope) || '';
    let intake = null;
    if (req.body && req.body.intake_json) {
      try { intake = JSON.parse(req.body.intake_json); } catch (e) {}
    }

    if (files.length === 0 && !scopeText) {
      return res.status(400).json({ error: 'Attach at least one drawing or provide a scope description.' });
    }

    // Prepare working dir — unpack ZIPs, copy files flat, get extractedNames
    const { tmpDir, extractedNames, pdfNotes } = await prepareTmpDir(files);

    // Create the run row
    const runId = 'ar_' + uuidv4().slice(0, 12);
    db.prepare(`INSERT INTO agent_runs (id, user_id, session_id, scope_text, intake_json, file_names, tmp_dir)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      runId, req.user.id, req.body.session_id || null,
      scopeText || null,
      intake ? JSON.stringify(intake) : null,
      JSON.stringify(extractedNames),
      tmpDir,
    );

    // Respond immediately with the run id
    res.json({ success: true, run_id: runId });

    // Kick off the agent in the background
    setImmediate(async () => {
      try {
        await runAgent({ runId, userId: req.user.id, apiKey, tmpDir, extractedNames, scopeText, intake, pdfNotes });
      } catch (err) {
        console.error(`[Agent ${runId}] uncaught:`, err.stack || err.message);
        try {
          db.prepare(`UPDATE agent_runs SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(err.message, runId);
          agent.emit(runId, { type: 'error', message: err.message });
        } catch (e) {}
      } finally {
        // Clean up the tmp dir after the run (success or fail). We keep it
        // during the run so view_pdf_page works; once finalized the files
        // are no longer needed.
        try {
          setTimeout(() => {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
          }, 60 * 1000);
        } catch (e) {}
      }
    });
  } catch (err) {
    console.error('[AgentRoutes] start error:', err.stack || err.message);
    res.status(500).json({ error: err.message || 'Failed to start agent' });
  }
});

// SQLite's CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" (UTC) with no
// timezone marker. Without a 'Z', browsers parse it as LOCAL time, causing
// elapsed-time bugs on any non-UTC client (e.g. Europe/Dublin BST = +60min
// drift). Normalise every timestamp field to ISO 8601 with explicit Z so
// the client cannot misinterpret regardless of cache or version.
function normaliseTimestamps(run) {
  const fields = ['created_at', 'updated_at', 'completed_at'];
  const out = { ...run };
  for (const k of fields) {
    const v = out[k];
    if (typeof v === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
      out[k] = (v.includes('T') ? v : v.replace(' ', 'T')) + 'Z';
    }
  }
  return out;
}

// ── GET /api/agent/:id — snapshot ─────────────────────────────────────
router.get('/agent/:id', authMiddleware, (req, res) => {
  try {
    const run = agent.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    let items = [];
    try { items = run.takeoff_json ? JSON.parse(run.takeoff_json) : []; } catch (e) {}
    let priced = null;
    try { priced = run.priced_json ? JSON.parse(run.priced_json) : null; } catch (e) {}
    let downloads = [];
    try { downloads = run.download_files ? JSON.parse(run.download_files) : []; } catch (e) {}
    let sanity_warnings = [];
    try { sanity_warnings = run.sanity_warnings ? JSON.parse(run.sanity_warnings) : []; } catch (e) {}
    res.json({ run: { ...normaliseTimestamps(run), takeoff_items: items, priced, downloads, sanity_warnings } });
  } catch (err) {
    console.error('[AgentRoutes] snapshot error:', err.message);
    res.status(500).json({ error: 'Failed to load run' });
  }
});

// ── GET /api/agent/:id/stream — SSE live stream ───────────────────────
router.get('/agent/:id/stream', authMiddleware, (req, res) => {
  const run = agent.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  if (run.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  function send(evt) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  let items = [];
  try { items = run.takeoff_json ? JSON.parse(run.takeoff_json) : []; } catch (e) {}
  let priced = null;
  try { priced = run.priced_json ? JSON.parse(run.priced_json) : null; } catch (e) {}
  let downloads = [];
  try { downloads = run.download_files ? JSON.parse(run.download_files) : []; } catch (e) {}
  let sanity_warnings = [];
  try { sanity_warnings = run.sanity_warnings ? JSON.parse(run.sanity_warnings) : []; } catch (e) {}
  send({ type: 'snapshot', run: { ...normaliseTimestamps(run), takeoff_items: items, priced, downloads, sanity_warnings } });

  if (run.status === 'completed' || run.status === 'failed') {
    send({ type: 'done' });
    res.end();
    return;
  }

  const unsubscribe = agent.subscribe(req.params.id, send);
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ── POST /api/agent/:id/update-item — edit a single item's qty/rate ───
// Used by the review panel so users can tweak quantities before generation.
router.post('/agent/:id/update-item', authMiddleware, express.json(), (req, res) => {
  try {
    const run = agent.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    if (run.status === 'completed' || run.status === 'failed') return res.status(400).json({ error: 'Run is not editable in its current state' });

    const { key, qty, assumed_rate, description } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing item key' });

    let items = [];
    try { items = run.takeoff_json ? JSON.parse(run.takeoff_json) : []; } catch (e) {}
    const idx = items.findIndex(i => i.key === key);
    if (idx < 0) return res.status(404).json({ error: 'Item not found in this run' });

    if (typeof qty === 'number' && !isNaN(qty)) items[idx].qty = qty;
    if (typeof assumed_rate === 'number' && !isNaN(assumed_rate)) items[idx].assumed_rate = assumed_rate;
    if (typeof description === 'string' && description.trim()) items[idx].description = description;
    items[idx].edited_by_user = true;

    agent.updateRun(req.params.id, { takeoff_json: JSON.stringify(items) });
    agent.emit(req.params.id, { type: 'takeoff_item', action: 'updated', item: items[idx] });
    res.json({ success: true, item: items[idx] });
  } catch (err) {
    console.error('[AgentRoutes] update-item error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/:id/remove-item — delete an item outright ─────────
router.post('/agent/:id/remove-item', authMiddleware, express.json(), (req, res) => {
  try {
    const run = agent.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    if (run.status === 'completed' || run.status === 'failed') return res.status(400).json({ error: 'Run is not editable' });
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing item key' });
    let items = [];
    try { items = run.takeoff_json ? JSON.parse(run.takeoff_json) : []; } catch (e) {}
    const removed = items.find(i => i.key === key);
    items = items.filter(i => i.key !== key);
    agent.updateRun(req.params.id, { takeoff_json: JSON.stringify(items) });
    if (removed) agent.emit(req.params.id, { type: 'takeoff_item', action: 'removed', item: removed });
    res.json({ success: true });
  } catch (err) {
    console.error('[AgentRoutes] remove-item error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/:id/reprice — re-run the pricer with current items ─
router.post('/agent/:id/reprice', authMiddleware, (req, res) => {
  try {
    const run = agent.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

    const pricer = require('./deterministicPricer');
    let items = [];
    try { items = run.takeoff_json ? JSON.parse(run.takeoff_json) : []; } catch (e) {}
    if (items.length === 0) return res.status(400).json({ error: 'No items to price' });

    const clientRates = {};
    try {
      const rates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(run.user_id);
      for (const r of rates) clientRates[r.item_key] = r.value;
    } catch (e) {}
    let location = run.location || '';
    const intakeIsIreland = run.currency === 'EUR' || /ireland/i.test(location);
    if (intakeIsIreland && !/ireland|ir$|\.ie|€/i.test(location)) {
      location = location ? `${location}, Ireland` : 'Ireland';
    }
    let prefs = { ohp_pct: 0, contingency_pct: 0 };
    try { prefs = require('./playbooks').getPricingPrefs(db, run.user_id); } catch (e) {}
    const priced = pricer.priceLockedQuantities(items, location, clientRates, {
      project_type: run.project_type || '',
      floor_area: run.floor_area_m2 || null,
      contingency_pct: prefs.contingency_pct, ohp_pct: prefs.ohp_pct,
      ...(intakeIsIreland ? { currency: 'EUR' } : {}),
    });
    agent.updateRun(req.params.id, {
      priced_json: JSON.stringify(priced),
      construction_total: priced.summary.construction_total || null,
      grand_total: priced.summary.grand_total || null,
      currency: priced.summary.currency || null,
    });
    agent.emit(req.params.id, { type: 'priced', priced });
    res.json({ success: true, priced });
  } catch (err) {
    console.error('[AgentRoutes] reprice error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agent/:id/generate — user approves → produce docs ──────
router.post('/agent/:id/generate', authMiddleware, express.json(), async (req, res) => {
  try {
    const run = agent.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    if (run.status === 'completed') {
      // Already done — return existing downloads. But if the run completed
      // WITHOUT producing any files (the "click does nothing" case), fall
      // through and regenerate rather than returning an empty list.
      let downloads = [];
      try { downloads = run.download_files ? JSON.parse(run.download_files) : []; } catch (e) {}
      if (Array.isArray(downloads) && downloads.length > 0) {
        return res.json({ success: true, already_generated: true, downloads });
      }
    }

    agent.updateRun(req.params.id, { status: 'generating' });
    agent.emit(req.params.id, { type: 'activity', activity: 'Generating Excel + Word deliverables' });

    // Run generation in the background; respond immediately
    res.json({ success: true, generating: true });

    setImmediate(async () => {
      try {
        const findings_notes = (req.body && req.body.findings_notes) || run.findings_notes || '';
        await agent.runGenerationForRun(req.params.id, { findings_notes });
      } catch (err) {
        console.error(`[Agent ${req.params.id}] generation failed:`, err.stack || err.message);
        agent.updateRun(req.params.id, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
        agent.emit(req.params.id, { type: 'error', message: 'Generation failed: ' + err.message });
      }
    });
  } catch (err) {
    console.error('[AgentRoutes] generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agent — list recent runs for current user ────────────────
router.get('/agent', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, status, project_type, location, floor_area_m2, construction_total, grand_total, currency, iteration_count, created_at, updated_at, completed_at
      FROM agent_runs WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).all(req.user.id);
    res.json({ runs: rows.map(normaliseTimestamps) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load runs' });
  }
});

module.exports = router;

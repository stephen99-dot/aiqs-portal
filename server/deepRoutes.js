// Routes for Deep BOQ mode — multi-step server-side job pipeline.
//
// POST /api/deep-boq             — start a job (uploads files)
// GET  /api/deep-boq/:id         — current snapshot (status, steps, outputs)
// GET  /api/deep-boq/:id/stream  — SSE live stream (replays snapshot first, then tails)
// GET  /api/deep-boq             — list recent jobs for the current user

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('./auth');
const deepJobs = require('./deepJobs');
const db = require('./database');

let zipProcessor = null;
try { zipProcessor = require('./zipProcessor'); } catch (e) { console.log('[DeepRoutes] zipProcessor not available — ZIP uploads will be skipped'); }

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 150 * 1024 * 1024, fieldSize: 50 * 1024 * 1024 },
});

// Convert one file (path on disk) into one or more Claude content blocks.
// PDFs and images get inlined as base64 document/image blocks. Excel, DWG,
// and other non-visual formats get a text placeholder so Claude at least
// knows they exist.
function fileToContentBlocks(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const blocks = [];
  try {
    const buf = fs.readFileSync(filePath);
    const b64 = buf.toString('base64');
    if (ext === '.pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
      blocks.push({ type: 'text', text: `(file: ${originalName})` });
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      const mediaType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.png' ? 'image/png'
        : ext === '.gif' ? 'image/gif'
        : 'image/webp';
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
      blocks.push({ type: 'text', text: `(file: ${originalName})` });
    } else {
      blocks.push({ type: 'text', text: `(file uploaded but not directly viewable by Claude: ${originalName})` });
    }
  } catch (readErr) {
    blocks.push({ type: 'text', text: `(failed to read file: ${originalName})` });
  }
  return blocks;
}

// Build the initial user content array from uploaded files.
//
// For ZIPs we layer two sources together:
// 1. zipProcessor gives us structured text context (rooms, dimensions,
//    schedules) + vision blocks for scanned image files.
// 2. On top of that we also push each extracted PDF as a raw document
//    block, so Claude's native PDF vision can read the actual drawings
//    instead of just seeing a note that says "this PDF has no text".
//
// zipProcessor.buildClaudeContent on its own only forwards images and a
// text note for image-based PDFs, which is why the scope step kept
// replying "I cannot access .zip drawings" even after unzipping.
async function buildUserContentFromFiles(files) {
  const content = [];
  const extractedNames = [];
  const MAX_PDF_BYTES = 25 * 1024 * 1024;  // Anthropic document upload limit
  let pdfBytesTotal = 0;

  for (const f of files || []) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext === '.zip' && zipProcessor) {
      try {
        const zipData = await zipProcessor.processZip(f.path, uploadsDir);

        // (1) structured context + vision images from zipProcessor
        const zipContent = zipProcessor.buildClaudeContent(zipData, null);
        for (const block of zipContent) content.push(block);

        // (2) raw PDF document blocks so Claude can actually see the drawings.
        // Cap total PDF payload so we don't blow Anthropic's input limits on
        // huge ZIPs. Skip PDFs whose path we can't resolve.
        const zipPdfs = (zipData.files || []).filter(fi => fi.type === 'pdf' && fi.filePath);
        for (const pdf of zipPdfs) {
          try {
            const buf = fs.readFileSync(pdf.filePath);
            if (pdfBytesTotal + buf.length > MAX_PDF_BYTES) {
              content.push({ type: 'text', text: `[Skipping ${pdf.filename} — attached PDFs already at payload cap]` });
              continue;
            }
            pdfBytesTotal += buf.length;
            content.push({ type: 'text', text: `[PDF drawing: ${pdf.filename}${pdf.doc_type ? ' — ' + pdf.doc_type : ''}]` });
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
            });
          } catch (pdfErr) {
            console.warn(`[DeepRoutes] couldn't attach PDF ${pdf.filename}:`, pdfErr.message);
          }
        }

        for (const entry of (zipData.drawing_index || [])) extractedNames.push(entry.filename);
        const summary = zipProcessor.buildUploadSummary(zipData);
        if (summary) content.push({ type: 'text', text: `[ZIP preprocessed — ${f.originalname}]\n${summary}` });
      } catch (zipErr) {
        console.error('[DeepRoutes] ZIP processing failed:', zipErr.stack || zipErr.message);
        content.push({ type: 'text', text: `(ZIP upload ${f.originalname} could not be extracted: ${zipErr.message})` });
      }
    } else {
      for (const block of fileToContentBlocks(f.path, f.originalname)) content.push(block);
      extractedNames.push(f.originalname);
    }
  }
  return { content, extractedNames };
}

// ── POST /api/deep-boq — start a job ──────────────────────────────────
router.post('/deep-boq', authMiddleware, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Upload failed: ' + err.message });
    next();
  });
}, async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

    const files = req.files || [];
    if (files.length === 0 && !req.body.scope) {
      return res.status(400).json({ error: 'Upload at least one drawing file, or provide a scope description.' });
    }

    const fileNames = files.map(f => f.originalname);
    let intake = null;
    if (req.body.intake_json) {
      try { intake = JSON.parse(req.body.intake_json); } catch (e) {}
    }
    const scopeText = (intake && intake.scope) || req.body.scope || '';

    let jobId;
    if (files.length === 0) {
      // Text-only: no prep needed, fire straight into pipeline
      const userContent = [{ type: 'text', text: scopeText }];
      jobId = await deepJobs.startJob({
        userId: req.user.id, sessionId: req.body.session_id || null,
        intake, fileNames, userContent, apiKey,
      });
    } else {
      // With files: return job_id IMMEDIATELY, process in background so the
      // user sees a live "Preparing drawings..." step instead of a frozen
      // Starting... button while a 3MB ZIP gets unpacked server-side.
      const paths = files.map(f => ({ path: f.path, originalname: f.originalname }));
      const prepareContent = async (log) => {
        if (log) log('Reading ' + paths.length + ' upload(s)...');
        const built = await buildUserContentFromFiles(paths);
        // Clean up originals once they've been base64'd into content blocks
        for (const f of paths) { try { fs.unlinkSync(f.path); } catch (e) {} }
        if (log) log('Extracted ' + built.extractedNames.length + ' drawing(s) / asset(s)');
        const content = built.content.slice();
        if (scopeText) content.push({ type: 'text', text: 'User scope notes: ' + scopeText });
        if (intake) content.push({ type: 'text', text: 'Project intake answers: ' + JSON.stringify(intake) });
        // Validate at least one viewable block exists
        if (content.filter(b => b.type === 'document' || b.type === 'image').length === 0) {
          throw new Error('No viewable drawings found after upload. Supported: PDF, PNG, JPG, WebP — directly or inside a ZIP. DWG/DXF must be exported to PDF first.');
        }
        return { content, extractedNames: built.extractedNames };
      };
      jobId = await deepJobs.startJob({
        userId: req.user.id, sessionId: req.body.session_id || null,
        intake, fileNames, prepareContent, apiKey,
      });
    }

    res.json({ success: true, job_id: jobId });
  } catch (err) {
    console.error('[DeepRoutes] start error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to start deep BOQ' });
  }
});

// ── GET /api/deep-boq/:id — snapshot of job state ─────────────────────
router.get('/deep-boq/:id', authMiddleware, (req, res) => {
  try {
    const job = deepJobs.snapshotJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    res.json({ job });
  } catch (err) {
    console.error('[DeepRoutes] snapshot error:', err.message);
    res.status(500).json({ error: 'Failed to load job' });
  }
});

// ── GET /api/deep-boq/:id/stream — SSE live stream ────────────────────
// Replays the current snapshot as 'snapshot' event, then tails live events.
router.get('/deep-boq/:id/stream', authMiddleware, (req, res) => {
  const job = deepJobs.snapshotJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

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

  // 1. Send the snapshot so the client has the full state up to now
  send({ type: 'snapshot', job });

  // 2. If the job is already finished, close
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    send({ type: 'done' });
    res.end();
    return;
  }

  // 3. Subscribe to live events
  const unsubscribe = deepJobs.subscribe(req.params.id, send);

  // 4. Heartbeat every 20s so proxies don't close us
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ── GET /api/deep-boq — list recent jobs for the current user ─────────
router.get('/deep-boq', authMiddleware, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, status, project_type, location, floor_area_m2, construction_total, grand_total, currency, created_at, updated_at, completed_at
      FROM deep_jobs WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).all(req.user.id);
    res.json({ jobs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

module.exports = router;

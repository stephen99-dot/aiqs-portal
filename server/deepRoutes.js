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
  const pdfNotes = [];  // diagnostic: one line per PDF touched
  // Anthropic limits: 32 MB per PDF, total request up to 100 MB.
  // Keep per-file just under to leave headroom for other blocks.
  const MAX_PDF_BYTES = 30 * 1024 * 1024;
  const MAX_TOTAL_PDF_BYTES = 90 * 1024 * 1024;
  let pdfBytesTotal = 0;

  for (const f of files || []) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext === '.zip' && zipProcessor) {
      try {
        const zipData = await zipProcessor.processZip(f.path, uploadsDir);
        console.log(`[DeepRoutes] ZIP ${f.originalname} unpacked: total_files=${zipData.summary?.total_files}, pdf_count=${zipData.summary?.pdf_count}, image_count=${zipData.summary?.image_count}`);

        // (1) structured context + vision images from zipProcessor
        const zipContent = zipProcessor.buildClaudeContent(zipData, null);
        for (const block of zipContent) content.push(block);

        // (2) raw PDF document blocks so Claude can actually see the drawings.
        const zipPdfs = (zipData.files || []).filter(fi => fi.type === 'pdf');
        console.log(`[DeepRoutes] Considering ${zipPdfs.length} PDF(s) for document-block attachment`);
        for (const pdf of zipPdfs) {
          if (!pdf.filePath) {
            const msg = `${pdf.filename}: no filePath from zipProcessor`;
            console.warn('[DeepRoutes] ' + msg);
            pdfNotes.push(msg);
            continue;
          }
          try {
            const buf = fs.readFileSync(pdf.filePath);
            const sizeMb = (buf.length / 1024 / 1024).toFixed(1);
            if (buf.length > MAX_PDF_BYTES) {
              const msg = `${pdf.filename} is ${sizeMb} MB — exceeds 30 MB per-PDF limit. Split into smaller sections or reduce the PDF resolution.`;
              console.warn('[DeepRoutes] ' + msg);
              pdfNotes.push(msg);
              content.push({ type: 'text', text: `[SKIPPED ${pdf.filename} — ${sizeMb} MB exceeds per-PDF cap]` });
              continue;
            }
            if (pdfBytesTotal + buf.length > MAX_TOTAL_PDF_BYTES) {
              const msg = `${pdf.filename}: total attached PDFs would exceed 90 MB request cap`;
              console.warn('[DeepRoutes] ' + msg);
              pdfNotes.push(msg);
              content.push({ type: 'text', text: `[SKIPPED ${pdf.filename} — request payload cap]` });
              continue;
            }
            pdfBytesTotal += buf.length;
            console.log(`[DeepRoutes] Attached ${pdf.filename} (${sizeMb} MB, running total ${(pdfBytesTotal / 1024 / 1024).toFixed(1)} MB)`);
            content.push({ type: 'text', text: `[PDF drawing: ${pdf.filename}${pdf.doc_type ? ' — ' + pdf.doc_type : ''}]` });
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
            });
            pdfNotes.push(`${pdf.filename}: attached (${sizeMb} MB)`);
          } catch (pdfErr) {
            const msg = `${pdf.filename}: read failed — ${pdfErr.message}`;
            console.warn('[DeepRoutes] ' + msg);
            pdfNotes.push(msg);
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
  return { content, extractedNames, pdfNotes };
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
        if (log) log('Extracted ' + built.extractedNames.length + ' file(s)');
        const content = built.content.slice();
        if (scopeText) content.push({ type: 'text', text: 'User scope notes: ' + scopeText });
        if (intake) content.push({ type: 'text', text: 'Project intake answers: ' + JSON.stringify(intake) });
        // Validate at least one viewable block exists, with a helpful message
        // that tells the user what was ACTUALLY in the upload — not just the
        // generic "no viewable drawings" line.
        const viewableCount = content.filter(b => b.type === 'document' || b.type === 'image').length;
        if (viewableCount === 0) {
          const nameList = built.extractedNames && built.extractedNames.length > 0
            ? built.extractedNames.slice(0, 10).join(', ') + (built.extractedNames.length > 10 ? ', ...' : '')
            : '(nothing extractable)';
          const exts = new Set(built.extractedNames.map(n => (n.split('.').pop() || '').toLowerCase()));
          const cadOnly = [...exts].every(e => ['dwg', 'dxf', 'rvt', 'ifc', 'skp'].includes(e)) && exts.size > 0;
          let hint;
          if (built.pdfNotes && built.pdfNotes.length > 0) {
            // PDFs were present — explain why each one didn't make it
            hint = 'PDFs were found but none could be attached:\n' + built.pdfNotes.map(n => '• ' + n).join('\n');
          } else if (cadOnly) {
            hint = 'Your ZIP only contains CAD files (' + [...exts].join(', ').toUpperCase() + '). Export each drawing to PDF and re-upload.';
          } else if (exts.has('docx') || exts.has('doc') || exts.has('xlsx') || exts.has('xls')) {
            hint = 'Your upload contains documents/spreadsheets but no drawings. Please add PDF, PNG, or JPG drawings.';
          } else if (built.extractedNames.length === 0) {
            hint = 'The ZIP could not be unpacked or contained no readable files. Try a different compression tool or upload the drawings directly.';
          } else {
            hint = 'Supported formats: PDF, PNG, JPG, WebP — directly or inside a ZIP. DWG/DXF must be exported to PDF first.';
          }
          throw new Error('No drawings Claude can read. Found in upload: ' + nameList + '.\n\n' + hint);
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

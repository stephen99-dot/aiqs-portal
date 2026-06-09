// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING SUBMISSION ROUTES — server/submissionRoutes.js
//
// Handles the in-portal "Submit Drawings" form for paying clients.
// Mirrors the public theaiqs.co.uk Pipedream flow: forwards files to the file
// receiver and the JSON payload to the main webhook, decrements one free_credit
// per submission, and records the submission row for tracking.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { getBoqBalance, consumeBoqCredit } = require('./boqCredits');

const router = express.Router();

const MAIN_WEBHOOK = process.env.PIPEDREAM_MAIN_WEBHOOK || 'https://eopd5lfexwf553m.m.pipedream.net';
const FILE_UPLOAD_URL = process.env.PIPEDREAM_FILE_WEBHOOK || 'https://eoinyvk74gbaqvh.m.pipedream.net';

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_FILES = 20;

// Buffer uploads to disk rather than RAM. With memory storage a single
// submission could pin MAX_FILES * MAX_FILE_BYTES (≈2 GB) in the heap, and
// concurrent submissions stacked on top of each other — a real risk of the
// Render instance OOMing. Disk storage keeps memory flat; files are streamed
// to Pipedream from disk and cleaned up when the response finishes.
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'submission-uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

// Delete the temp files multer wrote for this request, whatever the outcome.
// Wired to res 'finish' so every return path (validation rejects, credit
// checks, Pipedream errors, success) cleans up without scattering unlink calls.
function cleanupUploads(req) {
  if (!req.files || req.files.length === 0) return;
  for (const f of req.files) {
    if (f && f.path) {
      fs.unlink(f.path, () => {});
    }
  }
}

// Run multer and translate its errors into clean JSON. Without this, a multer
// error (oversized file, too many files) bypasses the route's try/catch and
// falls through to Express's default handler, which returns an opaque 500 —
// exactly what a client uploading a large ZIP would hit.
function uploadFiles(req, res, next) {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    console.error('[Submissions] Upload error:', err.code || 'UNKNOWN', err.message);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'A file is too large — the maximum size is 100 MB per file. Please compress the ZIP, split it into smaller files, or share a download link in the project details.',
        });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Too many files — please upload at most ' + MAX_FILES + ' files per submission.' });
      }
      return res.status(400).json({ error: 'Upload failed: ' + err.message });
    }
    return res.status(500).json({ error: 'Upload failed — please try again.' });
  });
}

// How many files to forward to Pipedream at once. Files are buffered in memory
// (up to MAX_FILE_BYTES each), so we cap concurrency to avoid spiking memory and
// outbound bandwidth while still turning a slow N-file serial upload into a few
// parallel batches.
const FORWARD_CONCURRENCY = 4;
// Hard ceiling per file so a single stalled connection to Pipedream can't hang
// the whole request indefinitely. Generous enough for a 100 MB file on a slow
// link; a timeout surfaces as a clean 502 rather than a silent hang.
const FORWARD_TIMEOUT_MS = 120000;

async function forwardFile(file, submissionId) {
  const fd = new FormData();
  // openAsBlob backs the Blob with the file on disk, so fetch streams it out
  // without loading the whole file into memory. Fall back to a buffered read on
  // older Node where openAsBlob isn't available.
  const type = file.mimetype || 'application/octet-stream';
  const blob = fs.openAsBlob
    ? await fs.openAsBlob(file.path, { type })
    : new Blob([fs.readFileSync(file.path)], { type });
  fd.append('file', blob, file.originalname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const resp = await fetch(FILE_UPLOAD_URL, {
      method: 'POST',
      headers: { 'X-Submission-Id': submissionId },
      body: fd,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error('Pipedream file upload failed: ' + resp.status);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Pipedream file upload timed out after ' + (FORWARD_TIMEOUT_MS / 1000) + 's: ' + file.originalname);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Forward files to Pipedream in parallel, capped at FORWARD_CONCURRENCY in
// flight. Workers pull from a shared cursor so a mix of large and small files
// stays balanced. The first failure rejects (so the route still reports a clean
// error and charges no credit) without leaving later uploads to drag on.
async function forwardFiles(files, submissionId) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      await forwardFile(file, submissionId);
    }
  };
  const workers = Array.from(
    { length: Math.min(FORWARD_CONCURRENCY, files.length) },
    () => worker()
  );
  await Promise.all(workers);
}

router.post('/', uploadFiles, async (req, res) => {
  // Clean up the temp upload files once the response is sent, regardless of
  // which branch below returns (validation, credit check, error, or success).
  res.on('finish', () => cleanupUploads(req));
  res.on('close', () => cleanupUploads(req));
  try {
    const user = db.prepare(
      'SELECT id, email, full_name, company, phone, role, free_credits, bonus_docs, monthly_boq_quota, billing_cycle_start FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isAdmin = user.role === 'admin';

    // Single spendable balance: free_credits + bonus_docs + monthly allowance left.
    const totalCredits = isAdmin ? Infinity : getBoqBalance(user.id).total;
    if (!isAdmin && totalCredits <= 0) {
      return res.status(403).json({ error: 'No BOQ credits remaining', upgrade_required: true });
    }

    const projectType = (req.body.project_type || '').trim();
    const message = (req.body.message || '').trim();
    const files = req.files || [];

    if (!projectType) return res.status(400).json({ error: 'Project type is required' });
    if (message.length < 20) return res.status(400).json({ error: 'Please describe your project (min 20 characters)' });
    if (files.length === 0) return res.status(400).json({ error: 'Please upload at least one drawing or document' });

    const submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    let pipedreamStatus = 'ok';
    try {
      await forwardFiles(files, submissionId);

      const payload = {
        name: user.full_name,
        email: user.email,
        phone: user.phone || '',
        company: user.company || '',
        project_type: projectType,
        message,
        submission_id: submissionId,
        file_names: files.map(f => f.originalname),
        file_count: files.length,
        submitted_at: new Date().toISOString(),
        source: 'aiqs-portal/submit-drawings',
        portal_user_id: user.id,
      };

      const resp = await fetch(MAIN_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('Pipedream main webhook failed: ' + resp.status);
    } catch (err) {
      console.error('[Submissions] Pipedream forward error:', err.message);
      pipedreamStatus = 'failed: ' + err.message;
      return res.status(502).json({ error: 'Could not forward your submission. Please try again or contact support — no credit has been used.' });
    }

    let creditsRemaining = isAdmin ? 999 : Math.max(0, totalCredits - 1);
    if (!isAdmin) {
      // Charge one BOQ credit (monthly allowance → bonus_docs → free_credits).
      // Called BEFORE the drawing_submissions row is inserted below, so the
      // helper measures this cycle's usage without counting this job yet.
      db.prepare('UPDATE users SET total_projects = total_projects + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      consumeBoqCredit(user.id, { eventAlreadyLogged: false });
    }

    db.prepare(`
      INSERT INTO drawing_submissions
        (id, user_id, submission_id, project_type, message, file_count, file_names, pipedream_status, credits_remaining_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      user.id,
      submissionId,
      projectType,
      message,
      files.length,
      JSON.stringify(files.map(f => f.originalname)),
      pipedreamStatus,
      creditsRemaining
    );

    res.json({
      success: true,
      submission_id: submissionId,
      credits_remaining: creditsRemaining,
    });
  } catch (err) {
    console.error('[Submissions] Error:', err);
    res.status(500).json({ error: 'Submission failed' });
  }
});

router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, submission_id, project_type, file_count, file_names, credits_remaining_after, created_at
      FROM drawing_submissions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id);

    res.json({
      submissions: rows.map(r => ({
        ...r,
        file_names: r.file_names ? JSON.parse(r.file_names) : [],
      })),
    });
  } catch (err) {
    console.error('[Submissions] List error:', err);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// Admin: list every submission across all users
router.get('/admin/all', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const rows = db.prepare(`
      SELECT s.id, s.submission_id, s.project_type, s.message, s.file_count, s.file_names,
             s.pipedream_status, s.credits_remaining_after, s.created_at,
             s.actioned_at, s.actioned_by, s.admin_notes, s.project_id, s.drive_link,
             u.id AS user_id,
             u.full_name AS user_name, u.email AS user_email,
             u.company AS user_company, u.phone AS user_phone
      FROM drawing_submissions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
      LIMIT 500
    `).all();

    res.json({
      submissions: rows.map(r => ({
        ...r,
        file_names: r.file_names ? JSON.parse(r.file_names) : [],
      })),
    });
  } catch (err) {
    console.error('[Submissions] Admin list error:', err);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// Admin: update a submission — toggle actioned state, edit notes, link to a project
router.patch('/admin/:id', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const existing = db.prepare('SELECT id FROM drawing_submissions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Submission not found' });

    const updates = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(req.body, 'actioned')) {
      if (req.body.actioned) {
        updates.push('actioned_at = CURRENT_TIMESTAMP');
        updates.push('actioned_by = ?');
        params.push(req.user.email || req.user.id);
      } else {
        updates.push('actioned_at = NULL');
        updates.push('actioned_by = NULL');
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'admin_notes')) {
      updates.push('admin_notes = ?');
      params.push(req.body.admin_notes || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'project_id')) {
      updates.push('project_id = ?');
      params.push(req.body.project_id || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'drive_link')) {
      const link = (req.body.drive_link || '').trim();
      // Bare-bones URL sanity check so we don't store junk
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ error: 'Drive link must start with http:// or https://' });
      }
      updates.push('drive_link = ?');
      params.push(link || null);
    }

    if (updates.length === 0) return res.json({ ok: true, unchanged: true });

    params.push(req.params.id);
    db.prepare(`UPDATE drawing_submissions SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare(`
      SELECT s.*, u.full_name AS user_name, u.email AS user_email,
             u.company AS user_company, u.phone AS user_phone
      FROM drawing_submissions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `).get(req.params.id);
    if (updated && updated.file_names) {
      try { updated.file_names = JSON.parse(updated.file_names); } catch (e) { updated.file_names = []; }
    }
    res.json({ ok: true, submission: updated });
  } catch (err) {
    console.error('[Submissions] Admin update error:', err);
    res.status(500).json({ error: 'Failed to update submission' });
  }
});

// Admin: turn a submission into a project (so deliverables can be uploaded
// against it). Idempotent — if the submission is already linked, returns the
// existing project_id.
router.post('/admin/:id/create-project', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const sub = db.prepare('SELECT * FROM drawing_submissions WHERE id = ? OR submission_id = ?').get(req.params.id, req.params.id);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    // If we're already linked, only reuse that project when its user_id still
    // matches the submission's user. Otherwise the customer can never see the
    // deliverables — the project belongs to someone else's account. This guards
    // against stale links (e.g. project_id pasted in by hand via PATCH, or the
    // original customer's user_id changing). Re-create cleanly in that case.
    if (sub.project_id) {
      const existing = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(sub.project_id);
      if (existing && existing.user_id === sub.user_id) {
        return res.json({ ok: true, project_id: sub.project_id, created: false });
      }
      if (existing && existing.user_id !== sub.user_id) {
        console.warn(
          '[Submissions] stale link: submission %s pointed at project %s owned by %s, but submission belongs to %s — re-creating',
          sub.id, existing.id, existing.user_id, sub.user_id
        );
      }
    }

    const { v4: uuidv4 } = require('uuid');
    const projectId = uuidv4();
    const title = (req.body && req.body.title) || (sub.project_type ? sub.project_type + ' — ' + new Date(sub.created_at).toLocaleDateString('en-GB') : 'Untitled job');
    const description = sub.message || null;

    db.prepare(`
      INSERT INTO projects (id, user_id, title, project_type, description, status, source)
      VALUES (?, ?, ?, ?, ?, 'in_progress', 'submission')
    `).run(projectId, sub.user_id, title, sub.project_type || 'Other', description);

    db.prepare('UPDATE drawing_submissions SET project_id = ? WHERE id = ?').run(projectId, sub.id);

    res.json({ ok: true, project_id: projectId, created: true });
  } catch (err) {
    console.error('[Submissions] create-project error:', err);
    res.status(500).json({ error: 'Failed to create project: ' + err.message });
  }
});

// Inbound webhook: Pipedream calls this once it has finished uploading the
// customer's drawings to Drive, posting the folder URL back so the inbox
// auto-fills the "Open in Drive" link without any manual pasting.
//
// Configure the Pipedream HTTP step like this:
//   POST  https://<your-portal>/api/submissions/webhook/drive-link
//   Body: { "submission_id": "<the sub id>", "drive_link": "<folder URL>", "secret": "<shared secret>" }
//
// The secret must match DRIVE_LINK_WEBHOOK_SECRET in the portal's env.
// This route does NOT use authMiddleware (it's mounted from index.js with
// auth) — see the override at the bottom of this file.
function driveLinkWebhookHandler(req, res) {
  try {
    const expected = process.env.DRIVE_LINK_WEBHOOK_SECRET;
    if (!expected) {
      console.error('[Drive webhook] DRIVE_LINK_WEBHOOK_SECRET is not set — refusing.');
      return res.status(503).json({ error: 'Drive webhook not configured' });
    }
    const got = (req.body && req.body.secret) || req.get('x-aiqs-webhook-secret');
    if (!got || got !== expected) {
      return res.status(401).json({ error: 'Bad secret' });
    }
    const submissionId = (req.body && req.body.submission_id) || '';
    const driveLink = ((req.body && req.body.drive_link) || '').trim();
    if (!submissionId) return res.status(400).json({ error: 'submission_id is required' });
    if (!driveLink || !/^https?:\/\//i.test(driveLink)) {
      return res.status(400).json({ error: 'drive_link must be a http(s) URL' });
    }
    const result = db.prepare(
      'UPDATE drawing_submissions SET drive_link = ? WHERE submission_id = ? OR id = ?'
    ).run(driveLink, submissionId, submissionId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'No matching submission for ' + submissionId });
    }
    res.json({ ok: true, updated: result.changes });
  } catch (err) {
    console.error('[Drive webhook] error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
}

module.exports = router;
module.exports.driveLinkWebhookHandler = driveLinkWebhookHandler;

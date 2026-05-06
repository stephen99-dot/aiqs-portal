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
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const router = express.Router();

const MAIN_WEBHOOK = process.env.PIPEDREAM_MAIN_WEBHOOK || 'https://eopd5lfexwf553m.m.pipedream.net';
const FILE_UPLOAD_URL = process.env.PIPEDREAM_FILE_WEBHOOK || 'https://eoinyvk74gbaqvh.m.pipedream.net';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
});

async function forwardFile(file, submissionId) {
  const fd = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
  fd.append('file', blob, file.originalname);

  const resp = await fetch(FILE_UPLOAD_URL, {
    method: 'POST',
    headers: { 'X-Submission-Id': submissionId },
    body: fd,
  });
  if (!resp.ok) throw new Error('Pipedream file upload failed: ' + resp.status);
}

function getCycleStart(user) {
  if (user && user.billing_cycle_start) return user.billing_cycle_start;
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

router.post('/', upload.array('files', 20), async (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, email, full_name, company, phone, role, free_credits, bonus_docs, monthly_boq_quota, billing_cycle_start FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isAdmin = user.role === 'admin';

    // Three credit sources: free_credits, bonus_docs, monthly_boq_quota (minus this-cycle submissions)
    const free = user.free_credits || 0;
    const bonus = user.bonus_docs || 0;
    const monthlyQuota = user.monthly_boq_quota || 0;
    let monthlyRemaining = 0;
    if (monthlyQuota > 0) {
      const cycleStart = getCycleStart(user);
      const used = db.prepare(
        'SELECT COUNT(*) AS c FROM drawing_submissions WHERE user_id = ? AND created_at >= ?'
      ).get(user.id, cycleStart).c;
      monthlyRemaining = Math.max(0, monthlyQuota - used);
    }
    const totalCredits = free + bonus + monthlyRemaining;
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
      for (const file of files) {
        await forwardFile(file, submissionId);
      }

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

    let creditsRemaining = isAdmin ? 999 : totalCredits - 1;
    if (!isAdmin) {
      // Spend free_credits first, then bonus_docs, then implicitly the monthly
      // BOQ quota (which is tracked by counting drawing_submissions this cycle).
      if (free > 0) {
        db.prepare(`
          UPDATE users
          SET free_credits = free_credits - 1,
              total_projects = total_projects + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(user.id);
      } else if (bonus > 0) {
        db.prepare(`
          UPDATE users
          SET bonus_docs = bonus_docs - 1,
              total_projects = total_projects + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(user.id);
      } else {
        // Drawing on monthly_boq_quota — no column to decrement, the
        // drawing_submissions row inserted below is the deduction.
        db.prepare(`
          UPDATE users
          SET total_projects = total_projects + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(user.id);
      }
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
             s.actioned_at, s.actioned_by, s.admin_notes, s.project_id,
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

module.exports = router;

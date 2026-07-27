// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT DELIVERABLES — server/deliverableRoutes.js
//
// The "return leg" of the workflow: once the QS team has priced a job, this
// is where they upload BOQs, marked-up drawings, supplier quotes etc. back
// into the customer's portal. The customer then sees them on the project
// page and can download.
//
// - POST  /api/projects/:projectId/deliverables      (admin) upload one or more files
// - GET   /api/projects/:projectId/deliverables      (owner or admin) list latest + history
// - PATCH /api/deliverables/:id                      (admin) edit notes / kind
// - DELETE /api/deliverables/:id                     (admin) soft-delete (is_latest=0)
//
// Files are stored in the existing outputsDir so the long-standing
// /api/downloads/:filename route can serve them with the same auth rules
// as the BOQ / Findings docs.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware } = require('./auth');

const router = express.Router();

/**
 * Should this project be held back from `delivered`?
 *
 * Reads the confidence recorded when the job was priced. Fails OPEN on purpose: an
 * unreadable or absent assessment must not strand a legitimate job, because most projects
 * predate this column and every one of them is fine. Only an explicit `blocked` verdict,
 * not yet signed off by a human, holds a job back.
 */
function assessDeliveryGate(projectId) {
  try {
    const row = db.prepare(
      'SELECT pricing_confidence, pricing_reviewed_at FROM projects WHERE id = ?'
    ).get(projectId);
    if (!row || !row.pricing_confidence) return { blocked: false, reason: 'no assessment recorded' };
    if (row.pricing_reviewed_at) return { blocked: false, reason: 'signed off by a human' };

    const conf = JSON.parse(row.pricing_confidence);
    if (conf.level !== 'blocked') return { blocked: false, level: conf.level };

    return {
      blocked: true,
      level: conf.level,
      reason: `${conf.estimated_pct}% of the value is estimated`,
      confidence: conf,
    };
  } catch (e) {
    console.error('[Deliverables] confidence gate could not read project:', e.message);
    return { blocked: false, reason: 'gate error, failing open' };
  }
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const outputsDir = path.join(DATA_DIR, 'outputs');
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

const ALLOWED_EXT = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.webp', '.dwg', '.dxf', '.zip'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, outputsDir),
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, 'deliv_' + Date.now() + '_' + uuidv4().slice(0, 8) + '_' + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.includes(ext));
  },
});

// Map a free-form "kind" string to a normalised slug — keeps client filtering simple.
function normaliseKind(raw) {
  const k = (raw || '').trim().toLowerCase();
  if (!k) return 'other';
  if (k.includes('boq') || k.includes('quantit')) return 'boq';
  if (k.includes('finding')) return 'findings';
  if (k.includes('drawing') || k.includes('marked') || k.includes('mark')) return 'marked_drawing';
  if (k.includes('quote') || k.includes('supplier')) return 'supplier_quote';
  if (k.includes('schedule')) return 'schedule';
  if (k.includes('client copy') || k.includes('client_copy')) return 'client_copy';
  return k.replace(/[^a-z0-9]+/g, '_').slice(0, 32) || 'other';
}

// Best-effort parser: pull the narrative out of an uploaded Findings Report
// .docx so the customer can edit it. Splits the document on its section
// headers (Project Description, Scope Summary, Key Findings, Assumptions,
// Exclusions, Recommendations) and seeds project_data.findings_json.
//
// If mammoth fails (e.g. corrupt docx) we just skip — the file is still
// available for download from the Documents from your QS panel.
async function seedFindingsFromDocx(projectId, docxPath) {
  if (!docxPath || !fs.existsSync(docxPath)) return;
  let raw;
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: docxPath });
    raw = (result && result.value) || '';
  } catch (e) {
    console.error('[Findings seed] mammoth error:', e.message);
    return;
  }
  if (!raw) return;

  // Block headings we recognise — case-insensitive, optional leading numbering.
  const SECTIONS = [
    { key: 'description',     match: /project description/i },
    { key: 'scope_summary',   match: /scope summary/i },
    { key: 'key_findings',    match: /key findings/i },
    { key: 'assumptions',     match: /assumptions/i },
    { key: 'exclusions',      match: /exclusions/i },
    { key: 'recommendations', match: /recommendations/i },
  ];

  function isHeading(line) {
    const t = line.trim();
    if (!t) return null;
    // Strip leading "1.", "1.1", etc.
    const stripped = t.replace(/^[\d.)\s]+/, '').trim();
    for (const s of SECTIONS) {
      if (s.match.test(stripped) && stripped.length < 60) return s.key;
    }
    return null;
  }

  const lines = raw.split(/\r?\n/);
  const buckets = {};
  let current = null;
  for (const line of lines) {
    const head = isHeading(line);
    if (head) { current = head; buckets[current] = buckets[current] || []; continue; }
    if (current && line.trim()) buckets[current].push(line.trim());
  }

  function collectBullets(arr) {
    return (arr || [])
      .map((s) => s.replace(/^[•\-*•\s]+/, '').trim())
      .filter(Boolean);
  }

  const findings = {
    description: (buckets.description || []).join(' ').trim() || '',
    project_type: '',
    location: '',
    scope_summary: (buckets.scope_summary || []).join(' ').trim() || '',
    key_findings: [],
    assumptions: collectBullets(buckets.assumptions),
    exclusions: collectBullets(buckets.exclusions),
    recommendations: collectBullets(buckets.recommendations),
    cost_summary: null,
    reference: '',
  };

  // For "Key Findings" we treat each bullet as its own finding (title only).
  // The customer can split into title + detail + sub-bullets in the editor.
  findings.key_findings = collectBullets(buckets.key_findings).map((title) => ({
    title, detail: '', items: [],
  }));

  try {
    db.prepare(
      'INSERT OR REPLACE INTO project_data (project_id, data_type, data) VALUES (?, ?, ?)'
    ).run(projectId, 'findings_json', JSON.stringify(findings));
  } catch (e) {
    console.error('[Findings seed] db write error:', e.message);
  }
}

function loadProject(projectId, user) {
  if (!projectId) return null;
  const proj = user.role === 'admin'
    ? db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
    : db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, user.id);
  return proj;
}

// ─── POST upload ──────────────────────────────────────────────────────────────
router.post('/projects/:projectId/deliverables', authMiddleware, upload.array('files', 20), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  try {
    const { projectId } = req.params;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const kind = normaliseKind(req.body.kind);
    const notes = (req.body.notes || '').trim() || null;
    const submissionId = req.body.submission_id || null;

    // Sanity check: if this upload is tied to a submission, the project we're
    // uploading to had better belong to the same customer. Otherwise the files
    // land in someone else's portal and the intended recipient sees nothing.
    if (submissionId) {
      const sub = db.prepare('SELECT user_id FROM drawing_submissions WHERE id = ? OR submission_id = ?').get(submissionId, submissionId);
      if (sub && sub.user_id && sub.user_id !== project.user_id) {
        return res.status(409).json({
          error: 'Recipient mismatch: this project belongs to a different customer than the submission. Re-link the submission and try again.',
          submission_user_id: sub.user_id,
          project_user_id: project.user_id,
        });
      }
    }

    // Mark previous latest of the same kind as superseded
    db.prepare(
      'UPDATE project_deliverables SET is_latest = 0 WHERE project_id = ? AND kind = ?'
    ).run(projectId, kind);

    // Compute next version per (project, kind)
    const lastVer = db.prepare(
      'SELECT MAX(version) AS v FROM project_deliverables WHERE project_id = ? AND kind = ?'
    ).get(projectId, kind);
    let nextVer = (lastVer && lastVer.v ? lastVer.v : 0) + 1;

    const inserted = [];
    const insertStmt = db.prepare(`
      INSERT INTO project_deliverables
        (id, project_id, submission_id, kind, filename, original_name, file_size, mime_type,
         version, notes, uploaded_by, is_latest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertMany = db.transaction((arr) => {
      for (const row of arr) insertStmt.run(...row);
    });

    const rows = files.map((f) => {
      const id = uuidv4();
      inserted.push({
        id,
        project_id: projectId,
        kind,
        filename: f.filename,
        original_name: f.originalname,
        file_size: f.size,
        mime_type: f.mimetype,
        version: nextVer,
        notes,
        uploaded_by: req.user.email || req.user.id,
        is_latest: 1,
        created_at: new Date().toISOString(),
      });
      return [
        id, projectId, submissionId, kind, f.filename, f.originalname,
        f.size, f.mimetype || null, nextVer, notes, req.user.email || req.user.id,
      ];
    });

    insertMany(rows);

    // Wire the upload back into the project so the Builder Pack and the
    // Findings editor work for manually-sent docs (i.e. when the QS uploads
    // a hand-built BOQ.xlsx instead of generating one through the chat).
    // Scan the WHOLE batch — not just the last file — so a BOQ that was
    // uploaded alongside other docs (findings, drawings) still gets wired up.
    // Relying on inserted[last] silently dropped boq_filename whenever the
    // .xlsx wasn't the final file, which then hid the "Got a BOQ?" quote
    // starter from the customer even though the BOQ had been delivered.
    try {
      const boqXlsx = inserted.find((x) => x.kind === 'boq' && /\.xlsx?$/i.test(x.filename));
      if (boqXlsx) {
        db.prepare(
          'UPDATE projects SET boq_filename = ?, status = CASE WHEN status IN (?, ?) THEN ? ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(boqXlsx.filename, 'submitted', 'in_review', 'completed', projectId);
      }
      const findingsDoc = inserted.find((x) => x.kind === 'findings' && /\.docx?$/i.test(x.filename));
      if (findingsDoc) {
        db.prepare(
          'UPDATE projects SET findings_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(findingsDoc.filename, projectId);

        // Best-effort: extract the narrative from the .docx so the customer
        // can edit it on the Findings page. If parsing fails we still leave
        // the file in place and the editor will show "no findings stored".
        await seedFindingsFromDocx(projectId, path.join(outputsDir, findingsDoc.filename));
      }
    } catch (syncErr) {
      console.error('[Deliverables] sync to project error:', syncErr);
    }

    // ── Pricing confidence gate ──
    // A job whose value mostly rests on estimateFallbackRate's keyword guesses must not
    // reach a client on the quiet. This used to be unconditional — the CASE below always
    // evaluated to 'delivered', and needs_admin_review was written in agenticTakeoff and
    // read nowhere at all — so a bill that was 76% guesswork shipped looking exactly like
    // one priced entirely from known rates.
    //
    // The block is on the STATUS transition, not on the upload: the files are already
    // stored above and nothing is lost. A human clears it by signing the job off, which is
    // recorded against them.
    const gate = assessDeliveryGate(projectId);
    if (gate.blocked) {
      console.log(`[Deliverables] ${projectId} not marked delivered — ${gate.reason}`);
    } else {
      // Flip project status to delivered (don't downgrade if it's already there)
      db.prepare(`
        UPDATE projects
        SET status = 'delivered', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(projectId);
    }

    // If the upload was tied to a submission, mark it actioned
    if (submissionId) {
      db.prepare(`
        UPDATE drawing_submissions
        SET actioned_at = COALESCE(actioned_at, CURRENT_TIMESTAMP),
            actioned_by = COALESCE(actioned_by, ?),
            project_id = COALESCE(project_id, ?)
        WHERE submission_id = ? OR id = ?
      `).run(req.user.email || req.user.id, projectId, submissionId, submissionId);
    }

    // The caller is told plainly when a job was held back, and why. Silently not
    // delivering would be its own kind of quiet failure.
    res.json({
      ok: true,
      deliverables: inserted,
      delivered: !gate.blocked,
      ...(gate.blocked ? {
        held_for_review: {
          reason: gate.reason,
          estimated_pct: gate.confidence.estimated_pct,
          flagged_lines: gate.confidence.flagged_lines,
          sign_off_url: `/api/projects/${projectId}/pricing-sign-off`,
        },
      } : {}),
    });
  } catch (err) {
    console.error('[Deliverables] upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ─── Pricing confidence: read, and sign off ──────────────────────────────────

router.get('/projects/:projectId/pricing-confidence', authMiddleware, (req, res) => {
  try {
    const project = loadProject(req.params.projectId, req.user);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const row = db.prepare(
      'SELECT pricing_confidence, pricing_reviewed_at, pricing_reviewed_by FROM projects WHERE id = ?'
    ).get(req.params.projectId);
    res.json({
      confidence: row && row.pricing_confidence ? JSON.parse(row.pricing_confidence) : null,
      reviewed_at: row ? row.pricing_reviewed_at : null,
      reviewed_by: row ? row.pricing_reviewed_by : null,
      gate: assessDeliveryGate(req.params.projectId),
    });
  } catch (e) {
    console.error('[Deliverables] confidence read error:', e.message);
    res.status(500).json({ error: 'Failed to read pricing confidence' });
  }
});

// A human has looked at the flagged lines and accepts the price. Recorded against them,
// because "who signed this off" is the question that gets asked when a job goes wrong.
router.post('/projects/:projectId/pricing-sign-off', authMiddleware, (req, res) => {
  try {
    const project = loadProject(req.params.projectId, req.user);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    db.prepare(`
      UPDATE projects
      SET pricing_reviewed_at = CURRENT_TIMESTAMP, pricing_reviewed_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.email || req.user.id, req.params.projectId);
    res.json({ ok: true, reviewed_by: req.user.email || req.user.id });
  } catch (e) {
    console.error('[Deliverables] sign-off error:', e.message);
    res.status(500).json({ error: 'Failed to record sign-off' });
  }
});

// ─── GET list ────────────────────────────────────────────────────────────────
router.get('/projects/:projectId/deliverables', authMiddleware, (req, res) => {
  try {
    const project = loadProject(req.params.projectId, req.user);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const rows = db.prepare(`
      SELECT * FROM project_deliverables
      WHERE project_id = ?
      ORDER BY created_at DESC
    `).all(req.params.projectId);

    const latest = rows.filter((r) => r.is_latest === 1);
    const history = rows.filter((r) => r.is_latest !== 1);
    res.json({ latest, history });
  } catch (err) {
    console.error('[Deliverables] list error:', err);
    res.status(500).json({ error: 'Failed to list deliverables' });
  }
});

// ─── PATCH (admin only) ───────────────────────────────────────────────────────
router.patch('/deliverables/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const existing = db.prepare('SELECT * FROM project_deliverables WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Deliverable not found' });

    const updates = [];
    const params = [];
    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) {
      updates.push('notes = ?');
      params.push(req.body.notes || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'kind')) {
      updates.push('kind = ?');
      params.push(normaliseKind(req.body.kind));
    }
    if (updates.length === 0) return res.json({ ok: true, unchanged: true });
    params.push(req.params.id);
    db.prepare(`UPDATE project_deliverables SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM project_deliverables WHERE id = ?').get(req.params.id);
    res.json({ ok: true, deliverable: updated });
  } catch (err) {
    console.error('[Deliverables] patch error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ─── DELETE (admin only) ──────────────────────────────────────────────────────
router.delete('/deliverables/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const row = db.prepare('SELECT * FROM project_deliverables WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Deliverable not found' });
    db.prepare('UPDATE project_deliverables SET is_latest = 0 WHERE id = ?').run(req.params.id);
    // Promote the previous version of the same kind back to latest if there is one
    const prev = db.prepare(`
      SELECT id FROM project_deliverables
      WHERE project_id = ? AND kind = ? AND id != ?
      ORDER BY version DESC, created_at DESC LIMIT 1
    `).get(row.project_id, row.kind, row.id);
    if (prev) {
      db.prepare('UPDATE project_deliverables SET is_latest = 1 WHERE id = ?').run(prev.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Deliverables] delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;

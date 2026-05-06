// ═══════════════════════════════════════════════════════════════════════════════
// FINDINGS ROUTES — server/findingsRoutes.js
//
// The structured findings JSON (description, scope, key findings, assumptions,
// exclusions, recommendations) is persisted to project_data with
// data_type='findings_json' when generated. These routes let the customer
// edit it and re-export the .docx with their branding applied.
//
//   GET   /api/projects/:id/findings         — return the structured JSON
//   PATCH /api/projects/:id/findings         — save edits (full replace)
//   POST  /api/projects/:id/findings/export  — render branded .docx of current findings
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { authMiddleware } = require('./auth');
const findingsGen = require('./findingsGenerator');
const { getBrandingForUser } = require('./brandingRoutes');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const outputsDir = path.join(DATA_DIR, 'outputs');
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

function loadProject(req) {
  const { projectId } = req.params;
  return req.user.role === 'admin'
    ? db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
    : db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
}

function readFindings(projectId) {
  const row = db.prepare(
    "SELECT data FROM project_data WHERE project_id = ? AND data_type = 'findings_json'"
  ).get(projectId);
  if (!row || !row.data) return null;
  try { return JSON.parse(row.data); } catch (e) { return null; }
}

function writeFindings(projectId, obj) {
  db.prepare(
    'INSERT OR REPLACE INTO project_data (project_id, data_type, data) VALUES (?, ?, ?)'
  ).run(projectId, 'findings_json', JSON.stringify(obj || {}));
}

router.get('/projects/:projectId/findings', authMiddleware, (req, res) => {
  try {
    const project = loadProject(req);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const findings = readFindings(project.id);
    if (!findings) {
      return res.status(404).json({ error: 'No findings stored for this project yet — generate the BOQ first.' });
    }
    res.json({ findings, project_title: project.title });
  } catch (err) {
    console.error('[Findings] GET error:', err);
    res.status(500).json({ error: 'Failed to load findings' });
  }
});

router.patch('/projects/:projectId/findings', authMiddleware, (req, res) => {
  try {
    const project = loadProject(req);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const existing = readFindings(project.id) || {};
    const incoming = req.body || {};

    // Whitelist: only let customers edit narrative fields. Cost summary stays
    // canonical (pulled from the priced BOQ) so totals can't drift.
    const editable = ['description', 'project_type', 'location', 'scope_summary',
      'key_findings', 'assumptions', 'exclusions', 'recommendations', 'reference'];
    for (const f of editable) {
      if (Object.prototype.hasOwnProperty.call(incoming, f)) {
        existing[f] = incoming[f];
      }
    }

    writeFindings(project.id, existing);
    res.json({ ok: true, findings: existing });
  } catch (err) {
    console.error('[Findings] PATCH error:', err);
    res.status(500).json({ error: 'Failed to save findings' });
  }
});

// Render a branded .docx from the current (or provided) findings JSON.
// If body.findings is set, render that without persisting; otherwise use the
// stored copy. The download streams back as application/vnd.../wordprocessingml.
router.post('/projects/:projectId/findings/export', authMiddleware, async (req, res) => {
  try {
    const project = loadProject(req);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const findings = (req.body && req.body.findings) || readFindings(project.id);
    if (!findings) return res.status(404).json({ error: 'No findings to export — save your edits first.' });

    const owner = db.prepare('SELECT full_name FROM users WHERE id = ?').get(project.user_id);
    const branding = getBrandingForUser(project.user_id);

    const buf = await findingsGen.generateFindingsReport(
      findings,
      owner ? owner.full_name : 'Client',
      project.title || 'Project',
      branding
    );
    const safeTitle = (project.title || 'Findings').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = 'Findings_' + safeTitle + '_' + Date.now() + '.docx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buf);
  } catch (err) {
    console.error('[Findings] export error:', err);
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

module.exports = router;

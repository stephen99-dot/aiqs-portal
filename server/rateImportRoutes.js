// Import the rates a delivered BOQ was priced at into the user's own rate
// library (client_rate_library). Two-step flow so nothing is written silently:
//
//   GET  /projects/:projectId/rate-import/preview
//        Parse the project's BOQ, extract deduplicated unit-rate candidates and
//        say for each one whether the user already holds it — and at what value
//        — so the UI can ask before touching anything.
//
//   POST /projects/:projectId/rate-import/apply
//        Write the rates the user ticked. Existing rates are NEVER overwritten
//        unless that row was explicitly submitted with update_existing: true.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const { authMiddleware } = require('./auth');
const { parseBOQ } = require('./builderExports');
const { extractRateCandidates, itemKey } = require('./rateExtract');
const rateOnboarding = require('./rateOnboarding');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const outputsDir = path.join(DATA_DIR, 'outputs');

function loadProjectForUser(req) {
  const { projectId } = req.params;
  return req.user.role === 'admin'
    ? db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
    : db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
}

// The user's existing rate for a candidate: same item_key, preferring the same
// category (imports may have categorised it differently in the past, and a
// duplicate under another category is still "you already have this").
function findExistingRate(userId, key, category) {
  const rows = db.prepare(
    'SELECT id, category, display_name, value, unit FROM client_rate_library WHERE user_id = ? AND item_key = ? AND is_active = 1'
  ).all(userId, key);
  if (!rows.length) return null;
  return rows.find((r) => r.category === category) || rows[0];
}

router.get('/projects/:projectId/rate-import/preview', authMiddleware, async (req, res) => {
  try {
    const project = loadProjectForUser(req);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.boq_filename) return res.status(400).json({ error: 'No BOQ available yet' });

    const filePath = path.join(outputsDir, project.boq_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'BOQ file not found on server' });

    const parsed = await parseBOQ(filePath);
    const candidates = extractRateCandidates(parsed);

    let newCount = 0, sameCount = 0, differsCount = 0;
    for (const c of candidates) {
      const existing = findExistingRate(req.user.id, c.item_key, c.category);
      if (!existing) {
        c.status = 'new';
        c.existing = null;
        newCount++;
      } else {
        c.existing = existing;
        if (Math.abs((Number(existing.value) || 0) - c.value) < 0.005) {
          c.status = 'exists_same';
          sameCount++;
        } else {
          c.status = 'exists_differs';
          differsCount++;
        }
      }
    }

    res.json({
      currency: project.currency || 'GBP',
      project_title: project.title,
      candidates,
      counts: { total: candidates.length, new: newCount, exists_same: sameCount, exists_differs: differsCount },
    });
  } catch (err) {
    console.error('[RateImport] preview error:', err);
    res.status(500).json({ error: 'Failed to extract rates: ' + err.message });
  }
});

router.post('/projects/:projectId/rate-import/apply', authMiddleware, (req, res) => {
  try {
    const project = loadProjectForUser(req);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const rates = Array.isArray(req.body && req.body.rates) ? req.body.rates : [];
    if (!rates.length) return res.status(400).json({ error: 'No rates submitted' });
    if (rates.length > 1000) return res.status(400).json({ error: 'Too many rates in one import' });

    const note = 'Imported from BOQ — ' + (project.title || 'project');
    const created = [], updated = [], skippedExisting = [];
    let skippedInvalid = 0;

    const insert = db.prepare(
      'INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, client_note, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.85, ?, 1)'
    );
    const update = db.prepare(
      'UPDATE client_rate_library SET value = ?, unit = ?, confidence = 0.85, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );

    const tx = db.transaction(() => {
      for (const r of rates) {
        const name = String((r && r.display_name) || '').trim();
        const value = Math.round((parseFloat(r && r.value) || 0) * 100) / 100;
        const unit = String((r && r.unit) || '').trim() || 'unit';
        const category = String((r && r.category) || '')
          .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'general';
        if (!name || !(value > 0)) { skippedInvalid++; continue; }

        const key = itemKey(name);
        const existing = findExistingRate(req.user.id, key, category);
        if (existing) {
          // Only overwrite when this row was explicitly submitted as an update.
          if (r.update_existing === true) {
            update.run(value, unit, existing.id);
            updated.push({ name, from: existing.value, to: value });
          } else {
            skippedExisting.push({ name, existing_value: existing.value });
          }
        } else {
          insert.run('rl_' + uuidv4().slice(0, 8), req.user.id, category, key, name, value, unit, note);
          created.push({ name, value, unit, category });
        }
      }
    });
    tx();

    if (created.length + updated.length > 0) {
      try { rateOnboarding.markOwnRatesAdded(req.user, { source: 'boq_import', count: created.length + updated.length }); } catch (e) { /* non-fatal */ }
    }

    console.log('[RateImport] ' + req.user.email + ': ' + created.length + ' created, ' + updated.length + ' updated, ' + skippedExisting.length + ' already existed (project ' + project.id + ')');
    res.json({
      success: true,
      created: created.length,
      updated: updated.length,
      skipped_existing: skippedExisting.length,
      skipped_invalid: skippedInvalid,
      created_sample: created.slice(0, 20),
      updated_sample: updated.slice(0, 20),
      skipped_sample: skippedExisting.slice(0, 20),
    });
  } catch (err) {
    console.error('[RateImport] apply error:', err);
    res.status(500).json({ error: 'Failed to import rates: ' + err.message });
  }
});

module.exports = router;

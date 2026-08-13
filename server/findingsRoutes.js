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

// Strip cost-table debris out of the narrative arrays. Findings seeded from a
// .docx before the seeder learned to stop at unknown numbered headings carry
// the flattened COST SUMMARY table as bullets ("4. COST SUMMARY", "Section",
// "Total", "£60,290.00", …). Everything from the COST SUMMARY marker on is
// table junk; bare money/label lines are junk wherever they sit.
const COST_SUMMARY_MARK = /^\W*\d*\.?\s*COST SUMMARY\b/i;
const TABLE_JUNK = /^(section|total|net cost|net total|sum)$|^[£€]\s?[\d,]+(\.\d+)?$|^(grand|net|tender)\s+total$/i;
function cleanNarrativeList(arr) {
  if (!Array.isArray(arr)) return arr;
  const cut = arr.findIndex((s) => COST_SUMMARY_MARK.test(String(s || '')));
  const upto = cut === -1 ? arr : arr.slice(0, cut);
  return upto.filter((s) => !TABLE_JUNK.test(String(s || '').trim()));
}
function sanitizeFindings(f) {
  if (!f || typeof f !== 'object') return f;
  f.assumptions = cleanNarrativeList(f.assumptions);
  f.exclusions = cleanNarrativeList(f.exclusions);
  f.recommendations = cleanNarrativeList(f.recommendations);
  if (Array.isArray(f.key_findings)) {
    f.key_findings = f.key_findings.filter((kf) => {
      const t = String((kf && kf.title) || '').trim();
      return t && !COST_SUMMARY_MARK.test(t) && !TABLE_JUNK.test(t);
    });
    for (const kf of f.key_findings) kf.items = cleanNarrativeList(kf.items || []);
  }
  return f;
}

// The report's Cost Summary is computed LIVE, never served from the stored
// JSON — so the findings .docx corresponds to the numbers the customer
// currently has, even after they edit lines in the Builder Pack. Preference
// order: the saved Builder Pack working state (their edited figures and
// margins, ignored when stale for the current BOQ file), else the delivered
// BOQ parsed fresh with its own printed OH&P / contingency / VAT.
const r2 = (v) => Math.round(v * 100) / 100;
function lineValue(it) {
  const lm = (parseFloat(it.labour) || 0) + (parseFloat(it.materials) || 0);
  return lm !== 0 ? lm : (parseFloat(it.total) || 0);
}
async function currentCostSummary(project) {
  try {
    const cur = project.currency === 'EUR' ? '€' : '£';

    // 1) Saved Builder Pack state — the numbers the customer sees on screen.
    let state = null;
    try { state = project.builder_pack_state ? JSON.parse(project.builder_pack_state) : null; } catch (e) {}
    if (state && state._boq_source && project.boq_filename && state._boq_source !== project.boq_filename) state = null;
    if (state && Array.isArray(state.sections) && state.sections.length) {
      const secs = state.sections.map((s) => ({
        provisional: !!s.provisional,
        number: s.number,
        name: (s.number ? s.number + ' — ' : '') + (s.title || 'Section') + (s.provisional ? ' (provisional, excl. OH&P)' : ''),
        total: r2((s.items || []).reduce((a, it) => a + lineValue(it), 0)),
      }));
      const nonProv = secs.filter((s) => !s.provisional).reduce((a, s) => a + s.total, 0);
      const net = secs.reduce((a, s) => a + s.total, 0);
      const baseFactor = (1 + (parseFloat(state.default_ohp) || 0) / 100) * (1 + (parseFloat(state.profit) || 0) / 100);
      const perTrade = state.per_trade_ohp || {};
      let ohp = 0;
      for (const s of secs) {
        if (s.provisional) continue;
        const f = Object.prototype.hasOwnProperty.call(perTrade, s.number) && Number.isFinite(parseFloat(perTrade[s.number]))
          ? 1 + parseFloat(perTrade[s.number]) / 100 : baseFactor;
        ohp += s.total * (f - 1);
      }
      const ohpPct = Math.round((baseFactor - 1) * 1e4) / 100;
      const contPct = parseFloat(state.contingency) || 0;
      const cont = nonProv * contPct / 100;
      const vatRate = parseFloat(state.vat) || 0;
      const beforeVat = net + ohp + cont;
      return {
        currency: cur,
        sections: secs.map(({ name, total }) => ({ name, total })),
        net_total: r2(net),
        ohp: r2(ohp), ohp_pct: ohpPct,
        contingency: r2(cont), contingency_pct: contPct,
        vat: r2(beforeVat * vatRate / 100), vat_rate: vatRate,
        grand_total: r2(beforeVat * (1 + vatRate / 100)),
      };
    }

    // 2) The delivered BOQ, with the OH&P / contingency / VAT it printed.
    if (!project.boq_filename) return null;
    const fp = path.join(outputsDir, project.boq_filename);
    if (!fs.existsSync(fp)) return null;
    const { parseBOQ } = require('./builderExports');
    const parsed = await parseBOQ(fp);
    if (!parsed.sections.length) return null;
    const ss = parsed.source_summary || {};
    const secs = parsed.sections.map((s) => ({
      provisional: !!s.provisional,
      name: (s.number ? s.number + ' — ' : '') + s.title + (s.provisional ? ' (provisional, excl. OH&P)' : ''),
      total: r2(s.subtotal.total),
    }));
    const nonProv = secs.filter((s) => !s.provisional).reduce((a, s) => a + s.total, 0);
    const net = secs.reduce((a, s) => a + s.total, 0);
    let ohpPct = null;
    if (ss.ohp_pct != null) ohpPct = ss.ohp_pct;
    else if (ss.overhead_pct != null || ss.profit_pct != null) {
      ohpPct = Math.round(((1 + (ss.overhead_pct || 0) / 100) * (1 + (ss.profit_pct || 0) / 100) - 1) * 1e4) / 100;
    }
    const ohp = ohpPct ? nonProv * ohpPct / 100 : 0;
    const contPct = ss.contingency_pct || 0;
    const cont = nonProv * contPct / 100;
    const vatRate = ss.vat_pct != null ? ss.vat_pct : 20;
    const beforeVat = net + ohp + cont;
    return {
      currency: cur,
      sections: secs.map(({ name, total }) => ({ name, total })),
      net_total: r2(net),
      ohp: r2(ohp), ohp_pct: ohpPct || 0,
      contingency: r2(cont), contingency_pct: contPct,
      vat: r2(beforeVat * vatRate / 100), vat_rate: vatRate,
      grand_total: r2(beforeVat * (1 + vatRate / 100)),
    };
  } catch (e) {
    console.error('[Findings] cost summary compute error:', e.message);
    return null;
  }
}

router.get('/projects/:projectId/findings', authMiddleware, async (req, res) => {
  try {
    const project = loadProject(req);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    let findings = readFindings(project.id);
    if (!findings) {
      // Self-heal: some deliveries attach the Findings .docx without seeding
      // the editable JSON (older uploads, files wired up by side channels).
      // Parse the delivered document on the fly and store the result, so Edit
      // works on any project that has the file at all.
      let docx = project.findings_filename;
      if (!docx) {
        const del = db.prepare(
          "SELECT filename FROM project_deliverables WHERE project_id = ? AND kind = 'findings' AND is_latest = 1 "
          + "AND (filename LIKE '%.docx' OR filename LIKE '%.doc') ORDER BY version DESC, created_at DESC LIMIT 1"
        ).get(project.id);
        if (del && del.filename) docx = del.filename;
      }
      if (docx && fs.existsSync(path.join(outputsDir, docx))) {
        try {
          await require('./deliverableRoutes').seedFindingsFromDocx(project.id, path.join(outputsDir, docx));
        } catch (seedErr) {
          console.error('[Findings] lazy seed error:', seedErr.message);
        }
        findings = readFindings(project.id);
      }
    }
    if (!findings) {
      return res.status(404).json({ error: 'No findings stored for this project yet — generate the BOQ first.' });
    }
    // Clean historical cost-table debris out of the narrative (and persist the
    // cleaned copy), then attach the LIVE cost summary so the editor always
    // shows the numbers the project currently carries.
    const before = JSON.stringify(findings);
    sanitizeFindings(findings);
    if (JSON.stringify(findings) !== before) writeFindings(project.id, findings);
    const cs = await currentCostSummary(project);
    if (cs) findings.cost_summary = cs;
    res.json({ findings, project_title: project.title });
  } catch (err) {
    console.error('[Findings] GET error:', err);
    res.status(500).json({ error: 'Failed to load findings' });
  }
});

router.patch('/projects/:projectId/findings', authMiddleware, async (req, res) => {
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

    sanitizeFindings(existing);
    writeFindings(project.id, existing);
    // Echo back with the LIVE cost summary attached (same as GET) so the
    // editor's totals don't blank out after a save.
    const cs = await currentCostSummary(project);
    if (cs) existing.cost_summary = cs;
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

    // Same treatment as the editor read: strip historical cost-table debris,
    // and render the Cost Summary from the LIVE numbers (Builder Pack edits
    // when saved, else the delivered BOQ) so the .docx corresponds to the
    // figures the customer currently has — however they've changed them.
    sanitizeFindings(findings);
    const liveCs = await currentCostSummary(project);
    if (liveCs) findings.cost_summary = liveCs;

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
// Exposed for tests: the narrative sanitizer and the live cost-summary
// computation the GET / export routes run.
module.exports._internals = { sanitizeFindings, currentCostSummary };

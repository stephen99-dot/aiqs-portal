// Routes for user memory, onboarding, and project intake.
// Mounted under /api by index.js.

const express = require('express');
const { authMiddleware, adminMiddleware } = require('./auth');
const db = require('./database');
const memoryStore = require('./memoryStore');
const entityStore = require('./entityStore');
const tradeCatalog = require('./tradeCatalog');
const onboardingProfile = require('./onboardingProfile');

const router = express.Router();

// ── Memories CRUD ─────────────────────────────────────────────────────

router.get('/memories', authMiddleware, (req, res) => {
  try {
    const rows = memoryStore.listMemories(db, { userId: req.user.id, includeInactive: req.query.all === '1' });
    res.json({ memories: rows, count: rows.length });
  } catch (e) {
    console.error('[Memories] list error:', e.message);
    res.status(500).json({ error: 'Failed to load memories' });
  }
});

router.post('/memories', authMiddleware, async (req, res) => {
  try {
    const { content, category, source, confidence } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'content required' });
    if (memoryStore.isDuplicate(db, { userId: req.user.id, content })) {
      return res.json({ skipped: true, reason: 'duplicate' });
    }
    const saved = await memoryStore.createMemory(db, {
      userId: req.user.id,
      content,
      category,
      source: source || 'user',
      confidence,
    });
    res.json({ memory: saved });
  } catch (e) {
    console.error('[Memories] create error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to create memory' });
  }
});

router.put('/memories/:id', authMiddleware, async (req, res) => {
  try {
    const { content, category, is_active } = req.body || {};
    const updated = await memoryStore.updateMemory(db, {
      id: req.params.id,
      userId: req.user.id,
      content,
      category,
      isActive: is_active,
    });
    if (!updated) return res.status(404).json({ error: 'Memory not found' });
    res.json({ memory: updated });
  } catch (e) {
    console.error('[Memories] update error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to update memory' });
  }
});

router.delete('/memories/:id', authMiddleware, (req, res) => {
  try {
    const ok = memoryStore.deleteMemory(db, { id: req.params.id, userId: req.user.id });
    if (!ok) return res.status(404).json({ error: 'Memory not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('[Memories] delete error:', e.message);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// ── Onboarding ────────────────────────────────────────────────────────

// Returns current onboarding status and a suggested question set
router.get('/onboarding', authMiddleware, (req, res) => {
  try {
    const u = db.prepare('SELECT onboarding_completed_at, onboarding_skipped, created_at FROM users WHERE id = ?').get(req.user.id);
    // is_new_account: the dashboard forces brand-new signups (however they
    // arrive — register, login, magic link) into onboarding before anything
    // else. Scoped to recent accounts so the existing back book is nudged by
    // the banner, not marched through a form.
    let isNew = false;
    if (u && u.created_at) {
      const createdIso = String(u.created_at).replace(' ', 'T').replace(/Z?$/, 'Z');
      isNew = (Date.now() - new Date(createdIso).getTime()) / 86400000 <= 14;
    }
    res.json({
      completed_at: u ? u.onboarding_completed_at : null,
      skipped: u ? !!u.onboarding_skipped : false,
      is_new_account: isNew,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load onboarding status' });
  }
});

// The trade list for the live-search picker. Names + aliases only — the
// client filters locally as the user types, no per-keystroke round trips.
router.get('/onboarding/trades', authMiddleware, (req, res) => {
  try {
    res.json({ trades: tradeCatalog.TRADES.map(t => ({ name: t.name, aliases: t.aliases })) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load trades' });
  }
});

// Qualifying questions for a chosen (or typed-in) trade. Unknown trades get
// the common question set, so a custom trade never dead-ends the flow.
router.get('/onboarding/questions', authMiddleware, (req, res) => {
  try {
    const trade = String(req.query.trade || '');
    res.json({
      trade,
      matched: !!tradeCatalog.findTrade(trade),
      questions: tradeCatalog.getQuestionsForTrade(trade),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load questions' });
  }
});

// Save onboarding answers. Each answer becomes a high-confidence user_memory
// marked source='onboarding'. Submitting multiple times updates the completion time.
router.post('/onboarding', authMiddleware, async (req, res) => {
  try {
    const skipped = Boolean(req.body && req.body.skipped);
    const userId = req.user.id;
    const saved = [];

    // New flow: trade + qualifying answers + free-text notes. The legacy
    // `answers` object is still accepted so nothing old breaks.
    const trade = String((req.body && req.body.trade) || '').trim();
    const qualifying = (req.body && req.body.qualifying && typeof req.body.qualifying === 'object' && !Array.isArray(req.body.qualifying))
      ? req.body.qualifying : {};
    const notes = String((req.body && req.body.notes) || '').trim();
    const answers = { ...((req.body && req.body.answers) || {}), ...qualifying };
    if (trade) answers.trade = trade;
    if (notes) answers.extra_notes = notes;

    if (skipped) {
      db.prepare('UPDATE users SET onboarding_skipped = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      return res.json({ success: true, skipped: true });
    }

    // Each question maps to a category + a memory content template.
    // Multi-select fields come as arrays; we save each selection as its own memory.
    // day_rate is deliberately absent: it goes to the rate library below, and a
    // memory copy would just drift from the value the pricer actually uses.
    const mapping = [
      { key: 'trade',                category: 'profile',               template: v => `Trade: ${v}` },
      { key: 'years_trading',        category: 'profile',               template: v => `Experience: ${v}` },
      { key: 'team_size',            category: 'team',                  template: v => `Team size: ${v}` },
      { key: 'typical_job_value',    category: 'commercial',            template: v => `Typical job value: ${v}` },
      { key: 'specialisms',          category: 'project_type',          template: v => `Specialises in: ${v}`, multi: true },
      { key: 'certifications',       category: 'profile',               template: v => `Certification: ${v}`, multi: true },
      { key: 'extra_notes',          category: 'general',               template: v => `Note from onboarding: ${v}` },
      { key: 'role',                 category: 'profile',               template: v => `Company/role: ${v}` },
      { key: 'company_name',         category: 'profile',               template: v => `Company name: ${v}` },
      { key: 'project_types',        category: 'project_type',          template: v => `Typically works on ${v} projects`, multi: true },
      { key: 'regions',              category: 'region',                template: v => `Primary region: ${v}` },
      { key: 'method_of_measurement',category: 'method_of_measurement', template: v => `Standard method of measurement: ${v}` },
      { key: 'contingency_pct',      category: 'contingency',           template: v => `Default contingency: ${v}%` },
      { key: 'ohp_pct',              category: 'markup',                template: v => `Default OH&P / markup: ${v}%` },
      { key: 'standard_exclusions',  category: 'exclusion',             template: v => `Standard exclusion: ${v}` },
      // Advanced
      { key: 'spec_level',           category: 'spec_preference',       template: v => `Preferred spec level: ${v}` },
      { key: 'rate_sources',         category: 'tooling',               template: v => `Rate source: ${v}`, multi: true },
      { key: 'team',                 category: 'team',                  template: v => `Team/composition: ${v}` },
      { key: 'typical_project_size', category: 'commercial',            template: v => `Typical project size: ${v}` },
    ];

    for (const m of mapping) {
      const raw = answers[m.key];
      if (raw == null || raw === '') continue;
      const values = m.multi && Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (v == null || v === '') continue;
        const vStr = String(v).trim();
        if (!vStr) continue;
        const content = m.template(vStr);
        if (memoryStore.isDuplicate(db, { userId, content })) continue;
        try {
          const rec = await memoryStore.createMemory(db, {
            userId,
            content,
            category: m.category,
            source: 'onboarding',
            confidence: 1.0,
          });
          saved.push(rec);
        } catch (err) {
          console.error('[Onboarding] memory save error:', err.message);
        }
      }
    }

    // Keep the submission verbatim and alert the admin (bell + email) so the
    // profile — and their logo — can be downloaded from Admin → Onboarding.
    if (trade || Object.keys(qualifying).length > 0 || notes) {
      try {
        const submission = onboardingProfile.saveSubmission(db, { userId, trade, qualifying, notes });
        if (submission) onboardingProfile.alertAdmin(db, req.user, submission);
      } catch (err) {
        console.error('[Onboarding] submission save error:', err.message);
      }
    }

    // Trade day rates from the onboarding rates step. They go into the rate
    // library (not memories) so the pricer and chat use them like any other
    // client rate. touched=false means the user accepted the prefilled UK
    // defaults unchanged — still worth saving, but not worth the "client
    // added their own rates" admin alert.
    const tradeRates = req.body && req.body.trade_rates;
    if (tradeRates && typeof tradeRates === 'object') {
      try {
        const { saved } = require('./tradeRates').saveTradeRates(db, { userId, rates: tradeRates });
        if (saved > 0) {
          require('./rateOnboarding').markOwnRatesAdded(req.user, {
            source: 'onboarding',
            count: saved,
            silent: !(req.body && req.body.trade_rates_touched),
          });
        }
      } catch (err) {
        console.error('[Onboarding] trade rates save error:', err.message);
      }
    }

    // Contingency/OH&P answers also land in the playbook — that's what the
    // pricer actually reads (getPricingPrefs), not the memory text above.
    const pctAnswers = {};
    if (answers.contingency_pct != null && answers.contingency_pct !== '') pctAnswers.contingency_pct = answers.contingency_pct;
    if (answers.ohp_pct != null && answers.ohp_pct !== '') pctAnswers.ohp_pct = answers.ohp_pct;
    if (Object.keys(pctAnswers).length > 0) {
      try { require('./playbooks').setPricingPrefs(db, userId, pctAnswers); }
      catch (err) { console.error('[Onboarding] pricing prefs save error:', err.message); }
    }

    db.prepare('UPDATE users SET onboarding_completed_at = CURRENT_TIMESTAMP, onboarding_skipped = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    res.json({ success: true, saved_count: saved.length });
  } catch (e) {
    console.error('[Onboarding] save error:', e.message);
    res.status(500).json({ error: 'Failed to save onboarding' });
  }
});

// ── Admin: onboarding submissions ────────────────────────────────────
// The list behind Admin → Onboarding, and the per-submission Excel download
// (logo embedded when they uploaded one). The logo file itself downloads via
// the existing admin-permitted GET /branding/logo/:userId.

router.get('/admin/onboarding-submissions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const rows = onboardingProfile.listSubmissions(db).map(s => ({
      ...s,
      answers: onboardingProfile.answerRows(s).map(([label, value]) => ({ label, value })),
    }));
    res.json({ submissions: rows });
  } catch (e) {
    console.error('[Onboarding] admin list error:', e.message);
    res.status(500).json({ error: 'Failed to load onboarding submissions' });
  }
});

router.get('/admin/onboarding-submissions/:id/download', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const submission = onboardingProfile.getSubmission(db, req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    let logoPath = null;
    if (submission.logo_filename) {
      const path = require('path');
      logoPath = path.join(require('./brandingRoutes').brandingDir, submission.logo_filename);
    }
    const wb = await onboardingProfile.buildWorkbook(submission, logoPath);

    const safeName = String(submission.full_name || submission.email || 'client').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'client';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="onboarding-${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[Onboarding] admin download error:', e.message);
    res.status(500).json({ error: 'Failed to build download' });
  }
});

// ── Pricing margins (per-user BOQ setting) ───────────────────────────
// Default 0/0: BOQ rates are all-in competitive prices with nothing stacked
// on top. Setting these percentages adds a visible Contingency / OH&P block
// to every BOQ summary for this user.

router.get('/pricing-prefs', authMiddleware, (req, res) => {
  try {
    res.json(require('./playbooks').getPricingPrefs(db, req.user.id));
  } catch (e) {
    console.error('[PricingPrefs] load error:', e.message);
    res.status(500).json({ error: 'Failed to load pricing preferences' });
  }
});

router.put('/pricing-prefs', authMiddleware, (req, res) => {
  try {
    const { ohp_pct, contingency_pct } = req.body || {};
    const bad = (v) => v !== undefined && v !== null && v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100);
    if (bad(ohp_pct) || bad(contingency_pct)) {
      return res.status(400).json({ error: 'Percentages must be numbers between 0 and 100' });
    }
    const prefs = require('./playbooks').setPricingPrefs(db, req.user.id, { ohp_pct, contingency_pct });
    res.json(prefs);
  } catch (e) {
    console.error('[PricingPrefs] save error:', e.message);
    res.status(500).json({ error: 'Failed to save pricing preferences' });
  }
});

// ── Project intake ────────────────────────────────────────────────────

// Save intake answers associated with a chat session.
// Called from the frontend modal that appears when files are attached to a new chat.
router.post('/project-intake', authMiddleware, (req, res) => {
  try {
    const { session_id, ...data } = req.body || {};
    const id = memoryStore.saveProjectIntake(db, {
      userId: req.user.id,
      sessionId: session_id || null,
      data,
    });
    res.json({ success: true, id });
  } catch (e) {
    console.error('[Intake] save error:', e.message);
    res.status(500).json({ error: 'Failed to save project intake' });
  }
});

router.get('/project-intake/:sessionId', authMiddleware, (req, res) => {
  try {
    const row = memoryStore.getProjectIntake(db, { userId: req.user.id, sessionId: req.params.sessionId });
    res.json({ intake: row || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load intake' });
  }
});

// ── Entities ──────────────────────────────────────────────────────────
// The people and firms on a builder's jobs. This is personal data, some of it a
// judgement about a named subcontractor, so it must be visible and correctable: if the
// system believes something about someone, the builder can see it, disagree and
// overrule it. Every call is scoped to req.user.id — entityStore throws without one.

router.get('/entities', authMiddleware, (req, res) => {
  try {
    const entities = entityStore.listEntities(db, { userId: req.user.id });
    // Facts and a short history come back with the list: the page shows them inline, and
    // one query per entity beats a request per row from the browser.
    const withDetail = entities.map(e => ({
      ...e,
      external_refs: e.external_refs ? JSON.parse(e.external_refs) : null,
      facts: entityStore.listFacts(db, { userId: req.user.id, entityId: e.id }),
      events: entityStore.listEvents(db, { userId: req.user.id, entityId: e.id, limit: 5 }),
    }));
    res.json({ entities: withDetail, summary: entityStore.summary(db, { userId: req.user.id }) });
  } catch (e) {
    console.error('[Entities] list error:', e.message);
    res.status(500).json({ error: 'Failed to load entities' });
  }
});

router.post('/entities', authMiddleware, (req, res) => {
  try {
    const { name, kind } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    if (!entityStore.KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${entityStore.KINDS.join(', ')}` });
    }
    const { entity, created } = entityStore.upsertEntity(db, {
      userId: req.user.id, kind, displayName: name, source: 'manual',
    });
    res.json({ entity, created });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to create entity' });
  }
});

router.put('/entities/:id', authMiddleware, (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const ok = entityStore.renameEntity(db, { userId: req.user.id, id: req.params.id, displayName: name });
    if (!ok) return res.status(404).json({ error: 'Entity not found' });
    res.json({ entity: entityStore.getEntity(db, { userId: req.user.id, id: req.params.id }) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to rename entity' });
  }
});

router.delete('/entities/:id', authMiddleware, (req, res) => {
  try {
    const ok = entityStore.deleteEntity(db, { userId: req.user.id, id: req.params.id });
    if (!ok) return res.status(404).json({ error: 'Entity not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('[Entities] delete error:', e.message);
    res.status(500).json({ error: 'Failed to delete entity' });
  }
});

// Soft merge — the loser keeps existing and points at the winner, so a merge made in
// error stays visible rather than silently destroying a record.
router.post('/entities/:id/merge', authMiddleware, (req, res) => {
  try {
    const { into } = req.body || {};
    if (!into) return res.status(400).json({ error: 'into required' });
    const ok = entityStore.mergeEntities(db, { userId: req.user.id, fromId: req.params.id, intoId: into });
    if (!ok) return res.status(404).json({ error: 'Entity not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to merge' });
  }
});

router.post('/entities/:id/facts', authMiddleware, (req, res) => {
  try {
    const { content, category } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'content required' });
    const fact = entityStore.addFact(db, {
      userId: req.user.id, entityId: req.params.id, content, category, source: 'user', confidence: 1,
    });
    res.json({ fact });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to add fact' });
  }
});

// Expire rather than delete by default: that something was once believed is worth
// keeping, and an expired fact stops reaching the model either way.
router.delete('/entities/facts/:factId', authMiddleware, (req, res) => {
  try {
    const hard = req.query.hard === '1';
    const ok = hard
      ? entityStore.deleteFact(db, { userId: req.user.id, id: req.params.factId })
      : entityStore.expireFact(db, { userId: req.user.id, id: req.params.factId });
    if (!ok) return res.status(404).json({ error: 'Fact not found' });
    res.json({ success: true, mode: hard ? 'deleted' : 'expired' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove fact' });
  }
});

module.exports = router;

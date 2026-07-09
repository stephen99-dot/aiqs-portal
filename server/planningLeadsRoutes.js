// ═══════════════════════════════════════════════════════════════════════════════
// PLANNING LEADS — routes — server/planningLeadsRoutes.js
//
// "Office in a Box" prospecting tool: scan local councils for recently-granted
// domestic planning applications near the builder, then draft a branded, headed
// letter to the property owner in one click. The draft lands in the normal
// Documents editor for review — nothing is sent anywhere automatically.
//
//   GET  /api/planning-leads/config     — category options for the UI
//   POST /api/planning-leads/search     — scan councils around a postcode
//   POST /api/planning-leads/draft      — draft a headed letter for one lead
//
// ACCESS: locked to a single account (see ALLOWED_EMAILS) while in preview, so
// only the owner's account sees it. Change the allowlist to widen access later.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware } = require('./auth');
const { searchLeads, sampleLeads, CATEGORIES, buildPlanitQueries, recordsOf, PLANIT_BASE, withKey, cooldownRemainingSecs, hasApiKey, USER_AGENT } = require('./planningData');

const router = express.Router();

// ── Access gate: this preview feature is visible to these accounts ONLY. ──────
// Kept here as the single server-side source of truth. The frontend mirrors it
// (src/utils/featureFlags.js) but the gate below is what actually enforces it.
const ALLOWED_EMAILS = new Set(['hello@crmwizardai.com']);

function requirePlanningLeads(req, res, next) {
  const email = String(req.user && req.user.email || '').trim().toLowerCase();
  if (!ALLOWED_EMAILS.has(email)) {
    return res.status(404).json({ error: 'Not found.' }); // 404, not 403 — don't advertise the feature exists.
  }
  next();
}

router.use(authMiddleware, requirePlanningLeads);

// ── Branding helpers (mirror documentsRoutes) ────────────────────────────────
function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) row = { company_name: null, company_address: null };
  return row;
}
function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(userId);
}

// GET /config — surfaces the category list so the UI stays in sync with code.
router.get('/config', (req, res) => {
  res.json({
    categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label })),
    states: [
      { id: 'granted', label: 'Recently granted (ready to build)' },
      { id: 'submitted', label: 'Just submitted (get in early)' },
      { id: 'all', label: 'All applications' },
    ],
  });
});

// GET /diag — connectivity probe. Reports whether THIS server can reach each
// upstream and, if not, the exact reason (403 egress block, DNS, timeout…), so
// an "unreachable" error can be diagnosed on the live box without guesswork.
router.get('/diag', async (req, res) => {
  const probe = async (label, url) => {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      const bodyStart = (await r.text()).slice(0, 160);
      return { label, ok: r.ok, status: r.status, ms: Date.now() - started, bodyStart };
    } catch (e) {
      return { label, ok: false, status: null, ms: Date.now() - started,
        error: e.name + ': ' + e.message, cause: (e.cause && (e.cause.code || e.cause.message)) || null };
    } finally { clearTimeout(timer); }
  };
  // Probe PlanIt with a SINGLE request (the primary query shape) so the check
  // itself doesn't burn the rate limit. If we're already inside a cooldown,
  // don't call PlanIt at all — just report the remaining wait.
  const postcodes = await probe('postcodes.io', 'https://api.postcodes.io/postcodes/SW1A%201AA');
  const cooldown = cooldownRemainingSecs();
  let planit;
  if (cooldown > 0) {
    planit = [{ shape: 'skipped', ok: false, status: 429, note: 'in cooldown — retry in ~' + Math.ceil(cooldown / 60) + ' min', cooldownSecs: cooldown }];
  } else {
    const q = buildPlanitQueries({ lat: 51.501, lng: -0.1419, radiusKm: 5, pageSize: 3 })[0];
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(PLANIT_BASE + '?' + withKey(q.qs), { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      const text = await r.text();
      let count = null; try { count = recordsOf(JSON.parse(text)).length; } catch (_) {}
      planit = [{ shape: q.label, ok: r.ok, status: r.status, ms: Date.now() - started, records: count, bodyStart: r.ok ? undefined : text.slice(0, 160) }];
    } catch (e) {
      planit = [{ shape: q.label, ok: false, status: null, ms: Date.now() - started, error: e.name + ': ' + e.message }];
    } finally { clearTimeout(timer); }
  }
  res.json({ node: process.version, hasFetch: typeof fetch === 'function', apiKey: hasApiKey(), postcodes, planit });
});

// POST /search — scan councils around a postcode.
// Body: { postcode, radiusKm, categories[], state, monthsBack, demo }
router.post('/search', async (req, res) => {
  const b = req.body || {};
  if (b.demo) return res.json(sampleLeads());
  try {
    const out = await searchLeads({
      postcode: b.postcode,
      radiusKm: b.radiusKm,
      categories: b.categories,
      state: b.state,
      monthsBack: b.monthsBack,
    });
    res.json(out);
  } catch (e) {
    const status = e.code === 'NO_POSTCODE' || e.code === 'BAD_POSTCODE' ? 400
      : e.code === 'RATE_LIMITED' ? 429
      : e.code === 'UPSTREAM_UNREACHABLE' ? 502 : 500;
    if (status === 500) console.error('[PlanningLeads] search error:', e);
    res.status(status).json({ error: e.message || 'Scan failed.', code: e.code || null, retryAfter: e.retryAfter || null });
  }
});

const LETTER_SYSTEM = `You draft a short, warm introductory letter from a UK builder to a homeowner whose planning application has just been approved, offering to quote for the building work. Rules:
1. British English, friendly and professional — how a well-regarded local builder writes, never pushy or salesy.
2. Short: 2-3 paragraphs. Open by referencing THEIR specific approved project (use the description and address given) and congratulating them / noting the good news.
3. Explain briefly that you're a local builder who does exactly this kind of work, and offer a free, no-obligation quote or site visit.
4. Use ONLY the facts provided. Never invent prices, dates, credentials or accreditations. Do not claim to have seen the plans in detail.
5. No address block and no sign-off in the body — those are added automatically. End the final paragraph with a clear, low-pressure call to action (a phone call or reply).`;

// POST /draft — turn one lead into a branded, headed letter in the Documents
// editor. Reuses the existing 'letter' template so the headed PDF + branding
// all work unchanged. Returns { id } for the frontend to open /documents/:id.
router.post('/draft', async (req, res) => {
  try {
    const { callModel, MODELS } = require('./anthropicClient');
    const lead = (req.body && req.body.lead) || {};
    const address = String(lead.address || '').trim();
    const description = String(lead.description || '').trim();
    if (!address && !description) {
      return res.status(400).json({ error: 'This lead is missing an address and description to write about.' });
    }

    const userId = req.user.id;
    const branding = getBranding(userId);
    const user = getUserDisplay(userId);
    const companyName = branding.company_name || user?.company || user?.full_name || '';

    const facts = [
      'Builder/company: ' + companyName,
      'Today: ' + new Date().toISOString().slice(0, 10),
      'Homeowner project (approved): ' + (description || '(not specified)'),
      'Property / site address: ' + (address || '(not specified)'),
      lead.council ? 'Local authority: ' + String(lead.council).slice(0, 120) : '',
      lead.ref ? 'Planning reference: ' + String(lead.ref).slice(0, 80) : '',
      lead.decided_date ? 'Approved on: ' + String(lead.decided_date).slice(0, 10) : '',
    ].filter(Boolean);

    const result = await callModel({
      model: MODELS.FAST,
      maxTokens: 900,
      temperature: 0.5,
      system: LETTER_SYSTEM,
      messages: [{ role: 'user', content: 'Draft the introductory letter now.\n\nFACTS:\n' + facts.join('\n') }],
      tools: [{
        name: 'submit_letter',
        description: 'Submit the drafted introductory letter.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short document title, e.g. "Intro letter — 14 Elm Road extension"' },
            subject: { type: 'string', description: 'Letter subject line referencing their project' },
            body: { type: 'string', description: 'The letter body, paragraphs separated by blank lines. No address block, no sign-off.' },
            sign_off: { type: 'string' },
          },
          required: ['title', 'subject', 'body'],
        },
      }],
      toolChoice: { type: 'tool', name: 'submit_letter' },
      userId,
      action: 'planning_lead_draft',
    });
    if (!result.ok || !result.json) {
      return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
    }

    const d = result.json;
    // Addressed to the property — the applicant's name usually isn't in the
    // public feed, so we default to the homeowner and let the builder edit it.
    const recipientName = String(lead.recipient_name || 'The Homeowner').slice(0, 200);
    const recipientAddress = [address, lead.postcode].filter(Boolean).join(', ').slice(0, 300);
    const fields = {
      letter_date: new Date().toISOString().slice(0, 10),
      recipient_name: recipientName,
      recipient_address: recipientAddress,
      subject: String(d.subject || 'Your recently approved building work').slice(0, 200),
      body: String(d.body || '').slice(0, 8000),
      sign_off: String(d.sign_off || 'Kind regards').slice(0, 80),
    };
    const id = uuidv4();
    db.prepare(
      'INSERT INTO documents (id, user_id, job_id, template_id, title, fields) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId, null, 'letter', String(d.title || 'Planning-lead letter').slice(0, 200), JSON.stringify(fields));
    res.status(201).json({ id });
  } catch (err) {
    console.error('[PlanningLeads] draft error:', err);
    res.status(500).json({ error: 'Failed to draft the letter.' });
  }
});

module.exports = router;

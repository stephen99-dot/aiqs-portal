// ═══════════════════════════════════════════════════════════════════════════════
// ESTIMATOR ADD-ON — server/estimatorRoutes.js
//
// A fast, self-contained quote generator. Builder describes a job, AI drafts a
// sectioned itemised quote, builder tweaks, branded PDF/XLSX comes out.
//
// This is the LIGHTWEIGHT pipeline. The heavy drawings -> BOQ pipeline lives in
// boqGenerator.js / zipProcessor.js and is left alone.
//
// All routes are JWT-protected AND gated behind requireEstimator. Admins pass.
//
//   POST   /api/estimator/draft               — Claude drafts JSON; we price from rates
//   GET    /api/estimator/quotes              — list current user's quotes
//   POST   /api/estimator/quotes              — save a new quote (header + lines)
//   GET    /api/estimator/quotes/:id          — read one quote + lines
//   PATCH  /api/estimator/quotes/:id          — update header (totals, status, notes)
//   PUT    /api/estimator/quotes/:id/lines    — replace all lines (used during edit)
//   POST   /api/estimator/quotes/:id/duplicate
//   DELETE /api/estimator/quotes/:id
//   GET    /api/estimator/quotes/:id/pdf      — branded PDF download
//   GET    /api/estimator/quotes/:id/xlsx     — itemised Excel download
//   GET    /api/estimator/stats               — small dashboard strip
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const db = require('./database');
const { callModel, MODELS } = require('./anthropicClient');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');
const { streamQuotePdf } = require('./quotePdf');
const mailer = require('./mailer');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function genQuoteNumber() {
  const d = new Date();
  const stamp = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return 'Q-' + stamp + '-' + suffix;
}

// 32 url-safe chars, cryptographically random — same scheme as variation
// approval tokens. Powers the public /q/<token> acceptance link.
function newShareToken() {
  return crypto.randomBytes(24).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Accepted quotes are the signed audit record — no silent edits.
function rejectIfQuoteLocked(q, res) {
  if (q.locked) {
    res.status(423).json({
      error: 'This quote has been accepted by the client and is locked. Duplicate it to make a revised version.',
      code: 'QUOTE_LOCKED',
    });
    return true;
  }
  return false;
}

function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = {
      user_id: userId,
      logo_filename: null,
      primary_colour: '#1B2A4A',
      accent_colour: '#F59E0B',
      company_name: null,
      company_address: null,
      footer_text: null,
      template: 'modern',
    };
  }
  return row;
}

function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company, phone FROM users WHERE id = ?').get(userId);
}

// Compute totals from a list of lines + percentages. Pure function.
function computeTotals(lines, opts) {
  const ohpPct = num(opts.ohp_pct);
  const contPct = num(opts.contingency_pct);
  const vatPct = num(opts.vat_pct);
  const targetMargin = num(opts.target_margin_pct);

  let net = 0;
  for (const ln of lines) {
    const qty = num(ln.qty);
    const rate = num(ln.rate);
    const lt = qty * rate;
    ln.line_total = Math.round(lt * 100) / 100;
    net += lt;
  }

  const ohp = net * (ohpPct / 100);
  const cont = (net + ohp) * (contPct / 100);
  const beforeVat = net + ohp + cont;
  const vat = beforeVat * (vatPct / 100);
  const grand = beforeVat + vat;

  // Margin: OH&P is the "profit" component. Margin % = OH&P / (net + OH&P).
  const margin = (net + ohp) > 0 ? (ohp / (net + ohp)) * 100 : 0;

  return {
    net_total: round2(net),
    ohp_amount: round2(ohp),
    contingency_amount: round2(cont),
    vat_amount: round2(vat),
    grand_total: round2(grand),
    margin_pct: round2(margin),
    ohp_pct: ohpPct,
    contingency_pct: contPct,
    vat_pct: vatPct,
    target_margin_pct: targetMargin,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ─── Rate lookup — fuzzy match against the seeded `rates` table ─────────────
// Returns { rate, labour, materials, matched } or null.
function lookupRate(line) {
  const desc = (line.description || line.item || '').toLowerCase().trim();
  const unit = (line.unit || '').toLowerCase().trim();
  if (!desc) return null;

  // Strip the most descriptive words and use them as LIKE tokens.
  const words = desc.split(/[^a-z0-9]+/).filter(w => w.length > 3).slice(0, 4);
  if (words.length === 0) return null;

  // Score = number of word hits in description + unit match.
  let candidates;
  try {
    const likeClauses = words.map(() => 'LOWER(description) LIKE ?').join(' OR ');
    const params = words.map(w => '%' + w + '%');
    candidates = db.prepare(
      'SELECT code, trade, description, unit, labour_rate, material_rate, total_rate '
      + 'FROM rates WHERE ' + likeClauses + ' LIMIT 30'
    ).all(...params);
  } catch (err) {
    // rates table may not exist on a brand-new install; degrade gracefully.
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const cd = (c.description || '').toLowerCase();
    let score = 0;
    for (const w of words) if (cd.includes(w)) score += 1;
    if (unit && (c.unit || '').toLowerCase() === unit) score += 1.5;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 2) return null;
  return {
    rate: num(best.total_rate) || (num(best.labour_rate) + num(best.material_rate)),
    labour: num(best.labour_rate),
    materials: num(best.material_rate),
    matched_code: best.code,
    matched_desc: best.description,
  };
}

// ─── Claude — draft JSON quote ──────────────────────────────────────────────

const DRAFT_SYSTEM_PROMPT = `You are a UK Quantity Surveyor producing a first-pass itemised quote for a builder.

You will receive a project description. Output ONLY valid JSON (no prose, no code fences, no explanations).

Schema:
{
  "client_name": string | null,
  "project_name": string,
  "currency": "GBP" | "EUR",
  "sections": [
    {
      "section": string,         // e.g. "Groundworks", "Structure", "Roof", "M&E", "Finishes", "Prelims"
      "items": [
        {
          "item": string,        // short name, e.g. "Strip foundations"
          "description": string, // one-line spec, e.g. "Mass concrete strip foundations, 600mm wide x 1m deep"
          "unit": string,        // m, m2, m3, nr, item, sum, hrs, day, week
          "qty": number,
          "rate": number,        // suggested £ per unit (used as fallback if no rate library match)
          "labour": number,      // suggested labour component of rate
          "materials": number    // suggested materials component of rate
        }
      ]
    }
  ]
}

RULES:
1. Group lines into trade sections in a sensible build order (Prelims, Groundworks, Substructure, Superstructure, Roof, External Envelope, Internal, M&E, Finishes, Externals).
2. Use UK construction terminology and UK units (m, m², m³).
3. Quantities should be plausible for the described scope. If a size isn't given, make a reasonable estimate based on the project type and note the assumption in the description.
4. Rates should be 2024-2026 UK trade rates. They will be overridden by the rate library where matches exist.
5. Always include a Prelims section (welfare, scaffold, skips, supervision).
6. Include 8-30 line items total — enough detail to be useful, not so many that it's overwhelming.
7. Do NOT include VAT, OH&P, contingency or margin lines — those are added separately.
8. Return ONLY the JSON object. No markdown fences. No commentary.`;

async function callClaude(userText, projectType, userId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const userMsg = 'Project type: ' + (projectType || '(not specified)')
    + '\n\nDescription:\n"""\n' + userText + '\n"""\n\nReturn the JSON quote now.';

  // C1 — the builder's own numbers ride in a cached system prefix: their
  // trade + day rates from the set-up wizard, and the rates they've confirmed
  // in their own library. Stable per user, so cacheSystem makes repeat drafts
  // cheap and grounded in THEIR prices instead of national averages.
  const system = [{ type: 'text', text: DRAFT_SYSTEM_PROMPT }];
  const ctx = buildBuilderContext(userId);
  if (ctx) system.push({ type: 'text', text: 'THIS BUILDER:\n' + ctx });

  // Forced JSON via tool use — guaranteed-valid JSON, no fence-stripping.
  // Usage is logged by logEstimatorUsage() at the route, so we don't pass
  // userId here (the wrapper would otherwise double-count it).
  const result = await callModel({
    model: MODELS.STANDARD,
    maxTokens: 4000,
    temperature: 0.3,
    system,
    cacheSystem: true,
    messages: [{ role: 'user', content: userMsg }],
    tools: [{
      name: 'submit_quote',
      description: 'Submit the drafted itemised quote.',
      input_schema: {
        type: 'object',
        properties: {
          client_name: { type: ['string', 'null'] },
          project_name: { type: ['string', 'null'] },
          currency: { type: ['string', 'null'] },
          sections: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        required: ['sections'],
      },
    }],
    toolChoice: { type: 'tool', name: 'submit_quote' },
  });

  if (!result.ok) {
    const errMsg = result.error?.error?.message || result.error?.message || '';
    throw new Error('Claude API ' + result.status + ': ' + String(errMsg).slice(0, 200));
  }

  // Return the Anthropic-shaped usage logEstimatorUsage() expects.
  const usage = { input_tokens: result.usage.tokensIn, output_tokens: result.usage.tokensOut };
  return { json: result.json, usage, model: result.model };
}

// The builder's playbook: trade + day rates from the wizard, plus their most
// used confirmed rates. Kept compact and stable so the prompt prefix caches.
function buildBuilderContext(userId) {
  if (!userId) return '';
  try {
    const parts = [];
    const s = db.prepare('SELECT trade_type, day_rates FROM oib_settings WHERE user_id = ?').get(userId);
    if (s?.trade_type) parts.push('Trade: ' + s.trade_type + '.');
    if (s?.day_rates) {
      try {
        const rates = Object.entries(JSON.parse(s.day_rates))
          .map(([k, v]) => k + ' £' + v + '/day').join(', ');
        if (rates) parts.push('Use these day rates for labour: ' + rates + '.');
      } catch (e) {}
    }
    try {
      const lib = db.prepare(
        'SELECT display_name, value, unit FROM client_rate_library '
        + 'WHERE user_id = ? AND is_active = 1 AND value > 0 AND display_name IS NOT NULL '
        + 'ORDER BY times_applied DESC, times_confirmed DESC LIMIT 25'
      ).all(userId);
      if (lib.length > 0) {
        parts.push('Their confirmed rates (prefer these where they fit): '
          + lib.map(r => r.display_name + ' £' + r.value + (r.unit ? '/' + r.unit : '')).join('; ') + '.');
      }
    } catch (e) { /* table may not exist on a fresh install */ }
    return parts.join('\n');
  } catch (e) {
    return '';
  }
}

// Strip optional code fences and parse JSON defensively.
function parseDraftJson(text) {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Find the first { and last } in case the model added stray text.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = s.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    return null;
  }
}

// Validate + flatten the draft into our line shape, priced from rate library.
function priceDraft(draft) {
  const sections = Array.isArray(draft?.sections) ? draft.sections : [];
  const lines = [];
  let order = 0;
  for (const sec of sections) {
    const section = String(sec.section || 'General').slice(0, 80);
    const items = Array.isArray(sec.items) ? sec.items : [];
    for (const it of items) {
      const aiRate = num(it.rate);
      const aiLabour = num(it.labour);
      const aiMaterials = num(it.materials);
      const lookup = lookupRate({ description: it.description, item: it.item, unit: it.unit });

      let rate, labour, materials, est_rate;
      if (lookup) {
        rate = lookup.rate;
        labour = lookup.labour;
        materials = lookup.materials;
        est_rate = 0;
      } else {
        rate = aiRate;
        labour = aiLabour || (aiRate * 0.6);
        materials = aiMaterials || (aiRate * 0.4);
        est_rate = 1;
      }
      const qty = num(it.qty);

      lines.push({
        id: uuidv4(),
        section,
        item: String(it.item || '').slice(0, 200),
        description: String(it.description || '').slice(0, 500),
        unit: String(it.unit || 'item').slice(0, 20),
        qty: qty,
        rate: round2(rate),
        labour: round2(labour),
        materials: round2(materials),
        line_total: round2(qty * rate),
        est_rate: est_rate,
        sort_order: order++,
      });
    }
  }
  return lines;
}

// ─── Cost logging ────────────────────────────────────────────────────────────

function logEstimatorUsage(userId, action, usage, model) {
  try {
    const id = uuidv4();
    const tokensIn = usage?.input_tokens || 0;
    const tokensOut = usage?.output_tokens || 0;
    // Rough Haiku 4.5 pricing: $1/MTok in, $5/MTok out. Sonnet 4: $3/$15.
    const inPrice = (model && model.includes('sonnet')) ? 3 : 1;
    const outPrice = (model && model.includes('sonnet')) ? 15 : 5;
    const costUsd = (tokensIn * inPrice + tokensOut * outPrice) / 1_000_000;
    db.prepare(
      'INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, action, null, model || null, tokensIn, tokensOut, costUsd);
  } catch (err) {
    // Don't fail the request because of a log row.
    console.warn('[Estimator] usage_log insert failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

// POST /api/estimator/draft
// Body: { input_text, project_type?, currency?, ohp_pct?, contingency_pct?, vat_pct?, target_margin_pct? }
router.post('/draft', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      input_text,
      project_type,
      currency,
      ohp_pct,
      contingency_pct,
      vat_pct,
      target_margin_pct,
    } = req.body || {};

    const text = (input_text || '').toString().trim();
    if (text.length < 10) {
      return res.status(400).json({ error: 'Please describe the job in a bit more detail (at least 10 characters).' });
    }

    let claudeResult;
    try {
      claudeResult = await callClaude(text, project_type, req.user.id);
    } catch (err) {
      console.error('[Estimator] Claude call failed:', err.message);
      return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
    }

    const draft = claudeResult.json;
    if (!draft || !Array.isArray(draft.sections)) {
      return res.status(502).json({ error: 'The AI returned an unexpected response. Please try again or simplify the description.' });
    }

    const lines = priceDraft(draft);
    if (lines.length === 0) {
      return res.status(502).json({ error: 'No quote lines were produced. Please try a more detailed description.' });
    }

    const totals = computeTotals(lines, {
      ohp_pct: ohp_pct == null ? 15 : ohp_pct,
      contingency_pct: contingency_pct == null ? 5 : contingency_pct,
      vat_pct: vat_pct == null ? 20 : vat_pct,
      target_margin_pct: target_margin_pct == null ? 15 : target_margin_pct,
    });

    logEstimatorUsage(req.user.id, 'estimator_draft', claudeResult.usage, claudeResult.model);

    res.json({
      client_name: draft.client_name || null,
      project_name: draft.project_name || (project_type ? project_type + ' project' : 'New quote'),
      project_type: project_type || null,
      currency: currency || draft.currency || 'GBP',
      input_text: text,
      lines,
      ...totals,
      elapsed_ms: Date.now() - t0,
    });
  } catch (err) {
    console.error('[Estimator] /draft error:', err);
    res.status(500).json({ error: 'Failed to generate quote.' });
  }
});

// GET /api/estimator/quotes
router.get('/quotes', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, client_name, project_name, project_type, currency, grand_total, status, quote_number, '
      + 'public_token, sent_at, accepted_at, acceptance_name, locked, created_at, updated_at '
      + 'FROM quotes WHERE user_id = ? ORDER BY created_at DESC LIMIT 500'
    ).all(req.user.id);
    res.json({ quotes: rows });
  } catch (err) {
    console.error('[Estimator] list error:', err);
    res.status(500).json({ error: 'Failed to load quotes.' });
  }
});

// GET /api/estimator/stats
router.get('/stats', (req, res) => {
  try {
    const since = new Date();
    since.setDate(1); since.setHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();
    const month = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(grand_total),0) as v FROM quotes WHERE user_id=? AND created_at >= ?").get(req.user.id, sinceIso);
    // Client-accepted quotes count as wins alongside manually-marked ones.
    const won = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE user_id=? AND status IN ('won','accepted')").get(req.user.id).c;
    const lost = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE user_id=? AND status='lost'").get(req.user.id).c;
    const decided = won + lost;
    const winRate = decided > 0 ? Math.round((won / decided) * 100) : null;
    res.json({
      this_month_count: month.c,
      this_month_value: round2(month.v || 0),
      win_rate: winRate,
      won,
      lost,
    });
  } catch (err) {
    console.error('[Estimator] stats error:', err);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// GET /api/estimator/rates/search?q=plaster&unit=m2&limit=10
// Read-only autocomplete against the seeded `rates` table. Used by the line
// editor to suggest priced items as the builder types.
router.get('/rates/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ results: [] });
    const unit = String(req.query.unit || '').trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 25);

    // Split into tokens (length >= 2) so "double plaster" matches "two-coat plaster"
    // via a multi-LIKE.
    const tokens = q.split(/[^a-z0-9]+/).filter(w => w.length >= 2).slice(0, 4);
    if (tokens.length === 0) return res.json({ results: [] });

    let candidates;
    try {
      const where = tokens.map(() => '(LOWER(description) LIKE ? OR LOWER(trade) LIKE ? OR LOWER(code) LIKE ?)').join(' AND ');
      const params = [];
      for (const tok of tokens) {
        const like = '%' + tok + '%';
        params.push(like, like, like);
      }
      candidates = db.prepare(
        'SELECT code, trade, description, unit, labour_rate, material_rate, total_rate '
        + 'FROM rates WHERE ' + where + ' LIMIT 60'
      ).all(...params);
    } catch (err) {
      return res.json({ results: [] });
    }

    // Score: token hits in description (3pt) + trade (1pt), bonus when the unit matches.
    const scored = candidates.map(c => {
      const cd = (c.description || '').toLowerCase();
      const ct = (c.trade || '').toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (cd.includes(tok)) score += 3;
        if (ct.includes(tok)) score += 1;
      }
      if (unit && (c.unit || '').toLowerCase() === unit) score += 2;
      return { c, score };
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    res.json({
      results: scored.map(({ c }) => ({
        code: c.code,
        trade: c.trade,
        description: c.description,
        unit: c.unit,
        rate: num(c.total_rate) || (num(c.labour_rate) + num(c.material_rate)),
        labour: num(c.labour_rate),
        materials: num(c.material_rate),
      })),
    });
  } catch (err) {
    console.error('[Estimator] rate search error:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
});

// POST /api/estimator/quotes  — save a new quote
router.post('/quotes', (req, res) => {
  try {
    const b = req.body || {};
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) return res.status(400).json({ error: 'A quote needs at least one line.' });

    const totals = computeTotals(lines, b);

    const id = uuidv4();
    const quoteNumber = b.quote_number || genQuoteNumber();
    // Naming a customer creates/links their client record automatically
    let clientId = null;
    try { clientId = require('./clientStore').findOrCreateClient(db, req.user.id, { name: b.client_name, email: b.client_email }); } catch (e) {}
    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO quotes (id, user_id, client_name, client_email, project_name, project_type, currency, input_text, '
        + 'net_total, ohp_pct, ohp_amount, contingency_pct, contingency_amount, vat_pct, vat_amount, '
        + 'grand_total, target_margin_pct, margin_pct, status, notes, quote_number, client_id, job_id) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, req.user.id,
        b.client_name || null, b.client_email || null, b.project_name || 'Untitled quote', b.project_type || null,
        b.currency || 'GBP', b.input_text || null,
        totals.net_total, totals.ohp_pct, totals.ohp_amount,
        totals.contingency_pct, totals.contingency_amount,
        totals.vat_pct, totals.vat_amount,
        totals.grand_total, totals.target_margin_pct, totals.margin_pct,
        b.status || 'draft', b.notes || null, quoteNumber, clientId, b.job_id || null
      );
      const ins = db.prepare(
        'INSERT INTO quote_lines (id, quote_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order, source_url) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let order = 0;
      for (const ln of lines) {
        ins.run(
          ln.id && typeof ln.id === 'string' ? ln.id : uuidv4(),
          id,
          ln.section || 'General',
          ln.item || '',
          ln.description || '',
          ln.unit || 'item',
          num(ln.qty),
          num(ln.rate),
          num(ln.labour),
          num(ln.materials),
          num(ln.line_total) || round2(num(ln.qty) * num(ln.rate)),
          ln.est_rate ? 1 : 0,
          ln.sort_order != null ? num(ln.sort_order) : order++,
          ln.source_url || null
        );
      }
    });
    txn();

    res.status(201).json({ id, quote_number: quoteNumber });
  } catch (err) {
    console.error('[Estimator] save error:', err);
    res.status(500).json({ error: 'Failed to save quote.' });
  }
});

// GET /api/estimator/quotes/:id
router.get('/quotes/:id', (req, res) => {
  try {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);
    res.json({ quote: q, lines });
  } catch (err) {
    console.error('[Estimator] get error:', err);
    res.status(500).json({ error: 'Failed to load quote.' });
  }
});

// PATCH /api/estimator/quotes/:id  — update header + percentages + status
router.patch('/quotes/:id', (req, res) => {
  try {
    const q = db.prepare('SELECT id, locked FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    if (rejectIfQuoteLocked(q, res)) return;
    const b = req.body || {};
    const allowed = ['client_name', 'client_email', 'project_name', 'project_type', 'currency', 'notes', 'status', 'ohp_pct', 'contingency_pct', 'vat_pct', 'target_margin_pct'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (k in b) { sets.push(k + ' = ?'); vals.push(b[k]); }
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(q.id);
      db.prepare('UPDATE quotes SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: q.id });
  } catch (err) {
    console.error('[Estimator] patch error:', err);
    res.status(500).json({ error: 'Failed to update quote.' });
  }
});

// PUT /api/estimator/quotes/:id/lines  — replace all lines + recompute totals
router.put('/quotes/:id/lines', (req, res) => {
  try {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    if (rejectIfQuoteLocked(q, res)) return;
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (lines.length === 0) return res.status(400).json({ error: 'A quote needs at least one line.' });

    const totals = computeTotals(lines, {
      ohp_pct: q.ohp_pct,
      contingency_pct: q.contingency_pct,
      vat_pct: q.vat_pct,
      target_margin_pct: q.target_margin_pct,
    });

    const txn = db.transaction(() => {
      db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(q.id);
      const ins = db.prepare(
        'INSERT INTO quote_lines (id, quote_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order, source_url) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let order = 0;
      for (const ln of lines) {
        ins.run(
          ln.id && typeof ln.id === 'string' ? ln.id : uuidv4(),
          q.id,
          ln.section || 'General',
          ln.item || '',
          ln.description || '',
          ln.unit || 'item',
          num(ln.qty),
          num(ln.rate),
          num(ln.labour),
          num(ln.materials),
          num(ln.line_total) || round2(num(ln.qty) * num(ln.rate)),
          ln.est_rate ? 1 : 0,
          ln.sort_order != null ? num(ln.sort_order) : order++,
          ln.source_url || null
        );
      }
      db.prepare(
        'UPDATE quotes SET net_total=?, ohp_amount=?, contingency_amount=?, vat_amount=?, grand_total=?, margin_pct=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      ).run(
        totals.net_total, totals.ohp_amount, totals.contingency_amount,
        totals.vat_amount, totals.grand_total, totals.margin_pct, q.id
      );
    });
    txn();
    res.json({ id: q.id, ...totals });
  } catch (err) {
    console.error('[Estimator] update lines error:', err);
    res.status(500).json({ error: 'Failed to update quote.' });
  }
});

// POST /api/estimator/quotes/:id/duplicate
router.post('/quotes/:id/duplicate', (req, res) => {
  try {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);

    const newId = uuidv4();
    const newNumber = genQuoteNumber();
    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO quotes (id, user_id, client_name, project_name, project_type, currency, input_text, '
        + 'net_total, ohp_pct, ohp_amount, contingency_pct, contingency_amount, vat_pct, vat_amount, '
        + 'grand_total, target_margin_pct, margin_pct, status, notes, quote_number) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newId, req.user.id,
        q.client_name, (q.project_name || 'Quote') + ' (copy)', q.project_type,
        q.currency, q.input_text,
        q.net_total, q.ohp_pct, q.ohp_amount,
        q.contingency_pct, q.contingency_amount,
        q.vat_pct, q.vat_amount,
        q.grand_total, q.target_margin_pct, q.margin_pct,
        'draft', q.notes, newNumber
      );
      const ins = db.prepare(
        'INSERT INTO quote_lines (id, quote_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const ln of lines) {
        ins.run(uuidv4(), newId, ln.section, ln.item, ln.description, ln.unit, ln.qty, ln.rate, ln.labour, ln.materials, ln.line_total, ln.est_rate, ln.sort_order);
      }
    });
    txn();
    res.status(201).json({ id: newId, quote_number: newNumber });
  } catch (err) {
    console.error('[Estimator] duplicate error:', err);
    res.status(500).json({ error: 'Failed to duplicate quote.' });
  }
});

// DELETE /api/estimator/quotes/:id — accepted quotes are locked (audit record).
router.delete('/quotes/:id', (req, res) => {
  try {
    const q = db.prepare('SELECT id, locked FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    if (rejectIfQuoteLocked(q, res)) return;
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(q.id);
      db.prepare('DELETE FROM quotes WHERE id = ?').run(q.id);
    });
    txn();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Estimator] delete error:', err);
    res.status(500).json({ error: 'Failed to delete quote.' });
  }
});

// ─── A1: send the quote — public acceptance link ─────────────────────────────

// POST /api/estimator/quotes/:id/send — mint the share token (idempotent),
// draft -> sent, and (A2) email the client the acceptance link when SMTP and
// a client email exist. The UI always offers the copyable link for
// WhatsApp/text regardless of delivery.
router.post('/quotes/:id/send', async (req, res) => {
  try {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    if (q.status === 'accepted') return res.status(400).json({ error: 'This quote has already been accepted.' });
    const token = q.public_token || newShareToken();
    const clientEmail = (req.body && req.body.client_email != null)
      ? String(req.body.client_email).trim().slice(0, 200) || null
      : q.client_email;
    db.prepare(
      "UPDATE quotes SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, "
      + 'public_token = ?, client_email = ?, sent_at = COALESCE(sent_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(token, clientEmail, q.id);

    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    const companyName = branding.company_name || userInfo?.company || userInfo?.full_name || 'your builder';
    const link = mailer.BASE_URL + '/q/' + token;
    const mail = await mailer.sendMail({
      userId: req.user.id,
      type: 'quote_send',
      to: clientEmail,
      subject: 'Quote ' + (q.quote_number || '') + ' from ' + companyName,
      heading: 'Your quote' + (q.project_name ? ' — ' + q.project_name : ''),
      paragraphs: [
        companyName + ' has sent you a quote' + (q.project_name ? ' for "' + q.project_name + '"' : '') + '.',
        'Total: ' + fmtMoney(q.grand_total, q.currency) + '.',
        'Tap the button to see the full price breakdown, download the PDF, ask a question, or accept it online.',
      ],
      ctaText: 'View and accept your quote',
      ctaUrl: link,
    });

    res.json({
      id: q.id, status: q.status === 'draft' ? 'sent' : q.status,
      token, path: '/q/' + token,
      delivery: mail.delivery,
      emailed_to: mail.delivery === 'email' ? clientEmail : null,
    });
  } catch (err) {
    console.error('[Estimator] send error:', err);
    res.status(500).json({ error: 'Failed to send the quote.' });
  }
});

// GET /api/estimator/quotes/:id/share-url — fetch the link again later.
router.get('/quotes/:id/share-url', (req, res) => {
  try {
    const q = db.prepare('SELECT id, public_token FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    if (!q.public_token) return res.status(400).json({ error: 'Not sent yet — send it first to get a link.' });
    res.json({ token: q.public_token, path: '/q/' + q.public_token });
  } catch (err) {
    console.error('[Estimator] share-url error:', err);
    res.status(500).json({ error: 'Failed.' });
  }
});

// GET /api/estimator/quotes/:id/messages — questions the client asked from the
// public page. Reading marks them read (clears the notification state).
router.get('/quotes/:id/messages', (req, res) => {
  try {
    const q = db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    const rows = db.prepare(
      'SELECT id, sender_name, sender_email, message, read_at, created_at FROM quote_messages WHERE quote_id = ? ORDER BY created_at DESC'
    ).all(q.id);
    db.prepare('UPDATE quote_messages SET read_at = CURRENT_TIMESTAMP WHERE quote_id = ? AND read_at IS NULL').run(q.id);
    res.json({ messages: rows });
  } catch (err) {
    console.error('[Estimator] messages error:', err);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

// ─── PDF export ──────────────────────────────────────────────────────────────

function currencySymbol(code) {
  if (code === 'EUR') return '€';
  return '£';
}

function fmtMoney(n, code) {
  const v = num(n);
  return currencySymbol(code) + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

router.get('/quotes/:id/pdf', (req, res) => {
  try {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);
    const branding = getBranding(req.user.id);
    const userInfo = getUserDisplay(req.user.id);
    // Rendering lives in quotePdf.js so the public acceptance page streams the
    // identical document. B4: attached site photos print at the end.
    const photos = require('./jobPhotoRoutes').photoPathsFor('quote', q.id);
    streamQuotePdf(res, q, lines, branding, userInfo, photos);
  } catch (err) {
    console.error('[Estimator] PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// ─── XLSX export ─────────────────────────────────────────────────────────────

router.get('/quotes/:id/xlsx', async (req, res) => {
  try {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    const lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);
    const branding = getBranding(req.user.id);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quote');
    const primaryArgb = 'FF' + (branding.primary_colour || '#1B2A4A').replace('#', '').toUpperCase();
    const accentArgb = 'FF' + (branding.accent_colour || '#F59E0B').replace('#', '').toUpperCase();

    ws.columns = [
      { header: 'Section', key: 'section', width: 22 },
      { header: 'Item', key: 'item', width: 28 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Unit', key: 'unit', width: 8 },
      { header: 'Qty', key: 'qty', width: 8 },
      { header: 'Rate', key: 'rate', width: 12 },
      { header: 'Total', key: 'line_total', width: 14 },
      { header: 'Est?', key: 'est_rate', width: 6 },
    ];

    const head = ws.getRow(1);
    head.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryArgb } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });

    for (const ln of lines) {
      ws.addRow({
        section: ln.section,
        item: ln.item,
        description: ln.description,
        unit: ln.unit,
        qty: ln.qty,
        rate: ln.rate,
        line_total: ln.line_total,
        est_rate: ln.est_rate ? 'Yes' : '',
      });
    }

    // Summary rows
    ws.addRow([]);
    function sumRow(label, value, bold) {
      const r = ws.addRow(['', '', '', '', '', label, value]);
      if (bold) r.font = { bold: true };
      r.getCell(7).numFmt = '#,##0.00';
    }
    sumRow('Net', num(q.net_total));
    sumRow('Overheads & profit (' + num(q.ohp_pct) + '%)', num(q.ohp_amount));
    sumRow('Contingency (' + num(q.contingency_pct) + '%)', num(q.contingency_amount));
    sumRow('VAT (' + num(q.vat_pct) + '%)', num(q.vat_amount));
    sumRow('Grand Total', num(q.grand_total), true);

    // Accent stripe on totals column
    ws.getColumn('line_total').eachCell((cell, idx) => {
      if (idx > 1) cell.numFmt = '#,##0.00';
    });
    ws.getColumn('rate').eachCell((cell, idx) => {
      if (idx > 1) cell.numFmt = '#,##0.00';
    });

    const filename = (q.quote_number || 'quote') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[Estimator] XLSX error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate spreadsheet.' });
  }
});

module.exports = router;

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
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

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

async function callClaude(userText, projectType) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const userMsg = 'Project type: ' + (projectType || '(not specified)')
    + '\n\nDescription:\n"""\n' + userText + '\n"""\n\nReturn the JSON quote now.';

  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    temperature: 0.3,
    system: DRAFT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('Claude API ' + resp.status + ': ' + errText.slice(0, 200));
  }

  const data = await resp.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const usage = data.usage || {};
  return { text, usage, model: data.model };
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
      claudeResult = await callClaude(text, project_type);
    } catch (err) {
      console.error('[Estimator] Claude call failed:', err.message);
      return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
    }

    const draft = parseDraftJson(claudeResult.text);
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
      'SELECT id, client_name, project_name, project_type, currency, grand_total, status, quote_number, created_at, updated_at '
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
    const won = db.prepare("SELECT COUNT(*) as c FROM quotes WHERE user_id=? AND status='won'").get(req.user.id).c;
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

// POST /api/estimator/quotes  — save a new quote
router.post('/quotes', (req, res) => {
  try {
    const b = req.body || {};
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) return res.status(400).json({ error: 'A quote needs at least one line.' });

    const totals = computeTotals(lines, b);

    const id = uuidv4();
    const quoteNumber = b.quote_number || genQuoteNumber();
    const txn = db.transaction(() => {
      db.prepare(
        'INSERT INTO quotes (id, user_id, client_name, project_name, project_type, currency, input_text, '
        + 'net_total, ohp_pct, ohp_amount, contingency_pct, contingency_amount, vat_pct, vat_amount, '
        + 'grand_total, target_margin_pct, margin_pct, status, notes, quote_number) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, req.user.id,
        b.client_name || null, b.project_name || 'Untitled quote', b.project_type || null,
        b.currency || 'GBP', b.input_text || null,
        totals.net_total, totals.ohp_pct, totals.ohp_amount,
        totals.contingency_pct, totals.contingency_amount,
        totals.vat_pct, totals.vat_amount,
        totals.grand_total, totals.target_margin_pct, totals.margin_pct,
        b.status || 'draft', b.notes || null, quoteNumber
      );
      const ins = db.prepare(
        'INSERT INTO quote_lines (id, quote_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          ln.sort_order != null ? num(ln.sort_order) : order++
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
    const q = db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
    const b = req.body || {};
    const allowed = ['client_name', 'project_name', 'project_type', 'currency', 'notes', 'status', 'ohp_pct', 'contingency_pct', 'vat_pct', 'target_margin_pct'];
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
        'INSERT INTO quote_lines (id, quote_id, section, item, description, unit, qty, rate, labour, materials, line_total, est_rate, sort_order) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          ln.sort_order != null ? num(ln.sort_order) : order++
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

// DELETE /api/estimator/quotes/:id
router.delete('/quotes/:id', (req, res) => {
  try {
    const q = db.prepare('SELECT id FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!q) return res.status(404).json({ error: 'Quote not found.' });
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
    const cc = q.currency || 'GBP';

    const filename = (q.quote_number || 'quote') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const primary = branding.primary_colour || '#1B2A4A';
    const accent = branding.accent_colour || '#F59E0B';

    // Header band
    doc.rect(0, 0, doc.page.width, 90).fill(primary);

    // Logo (if present)
    let titleX = 40;
    if (branding.logo_filename) {
      const logoPath = path.join(brandingDir, branding.logo_filename);
      if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(branding.logo_filename)) {
        try {
          doc.image(logoPath, 40, 22, { fit: [120, 46] });
          titleX = 175;
        } catch (e) { /* bad image, skip */ }
      }
    }

    doc.fillColor('#ffffff')
      .font('Helvetica-Bold').fontSize(20)
      .text(branding.company_name || userInfo?.company || userInfo?.full_name || 'Quotation', titleX, 28);
    doc.font('Helvetica').fontSize(9)
      .text('Quote ' + (q.quote_number || ''), titleX, 56)
      .text(new Date(q.created_at || Date.now()).toLocaleDateString('en-GB'), titleX, 70);

    // Quote meta block
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14)
      .text(q.project_name || 'Quotation', 40, 110);
    doc.font('Helvetica').fontSize(10).fillColor('#444444');
    let metaY = 130;
    if (q.client_name) { doc.text('Client: ' + q.client_name, 40, metaY); metaY += 14; }
    if (q.project_type) { doc.text('Project type: ' + q.project_type, 40, metaY); metaY += 14; }
    doc.text('Valid for 30 days from issue.', 40, metaY); metaY += 18;

    // Company contact block (right)
    let rightY = 110;
    doc.fontSize(9).fillColor('#333333');
    if (branding.company_name) { doc.text(branding.company_name, 360, rightY, { width: 200, align: 'right' }); rightY += 13; }
    if (branding.company_address) {
      const addrLines = String(branding.company_address).split(/\r?\n/);
      for (const ln of addrLines) { doc.text(ln, 360, rightY, { width: 200, align: 'right' }); rightY += 12; }
    }
    if (userInfo?.email) { doc.text(userInfo.email, 360, rightY, { width: 200, align: 'right' }); rightY += 12; }

    let y = Math.max(metaY, rightY) + 10;

    // Group lines by section
    const sections = {};
    const sectionOrder = [];
    for (const ln of lines) {
      const s = ln.section || 'General';
      if (!sections[s]) { sections[s] = []; sectionOrder.push(s); }
      sections[s].push(ln);
    }

    // Column layout
    const COLS = {
      desc: { x: 40, w: 270 },
      qty:  { x: 315, w: 35, align: 'right' },
      unit: { x: 355, w: 35, align: 'left' },
      rate: { x: 395, w: 70, align: 'right' },
      total:{ x: 470, w: 85, align: 'right' },
    };

    function ensureRoom(h) {
      if (y + h > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }
    }

    function drawHeaderRow() {
      ensureRoom(22);
      doc.rect(40, y, 515, 18).fill(primary);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      doc.text('Description', COLS.desc.x + 4, y + 5, { width: COLS.desc.w - 4 });
      doc.text('Qty',  COLS.qty.x,  y + 5, { width: COLS.qty.w,  align: 'right' });
      doc.text('Unit', COLS.unit.x, y + 5, { width: COLS.unit.w });
      doc.text('Rate', COLS.rate.x, y + 5, { width: COLS.rate.w, align: 'right' });
      doc.text('Total',COLS.total.x,y + 5, { width: COLS.total.w,align: 'right' });
      y += 18;
      doc.fillColor('#111111').font('Helvetica').fontSize(9);
    }

    drawHeaderRow();

    let runningNet = 0;
    for (const sec of sectionOrder) {
      ensureRoom(20);
      doc.rect(40, y, 515, 16).fill(accent);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(sec, 44, y + 3);
      y += 16;
      doc.fillColor('#111111').font('Helvetica').fontSize(9);

      let sectionSubtotal = 0;
      for (const ln of sections[sec]) {
        const descText = (ln.item ? ln.item + ' — ' : '') + (ln.description || '');
        const descHeight = doc.heightOfString(descText, { width: COLS.desc.w - 4 });
        const rowH = Math.max(14, descHeight + 4);
        ensureRoom(rowH);

        const isEst = ln.est_rate ? true : false;
        doc.font('Helvetica').fontSize(9).fillColor('#111111');
        doc.text(descText, COLS.desc.x + 4, y + 2, { width: COLS.desc.w - 4 });
        doc.text(String(num(ln.qty)), COLS.qty.x, y + 2, { width: COLS.qty.w, align: 'right' });
        doc.text(String(ln.unit || ''), COLS.unit.x, y + 2, { width: COLS.unit.w });
        const rateText = fmtMoney(ln.rate, cc) + (isEst ? ' *' : '');
        if (isEst) doc.fillColor('#B45309');
        doc.text(rateText, COLS.rate.x, y + 2, { width: COLS.rate.w, align: 'right' });
        doc.fillColor('#111111');
        doc.text(fmtMoney(ln.line_total, cc), COLS.total.x, y + 2, { width: COLS.total.w, align: 'right' });

        // light divider
        doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + rowH).lineTo(555, y + rowH).stroke();
        sectionSubtotal += num(ln.line_total);
        y += rowH;
      }

      // section subtotal
      ensureRoom(16);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
      doc.text(sec + ' subtotal', COLS.desc.x + 4, y + 3, { width: COLS.desc.w - 4 });
      doc.text(fmtMoney(sectionSubtotal, cc), COLS.total.x, y + 3, { width: COLS.total.w, align: 'right' });
      doc.font('Helvetica').fontSize(9);
      y += 18;
      runningNet += sectionSubtotal;
    }

    // Summary block
    ensureRoom(140);
    y += 10;
    doc.rect(310, y, 245, 130).strokeColor(primary).lineWidth(1).stroke();
    let sy = y + 8;
    function summaryRow(label, value, bold) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111');
      doc.text(label, 318, sy, { width: 140 });
      doc.text(value, 460, sy, { width: 90, align: 'right' });
      sy += 16;
    }
    summaryRow('Net', fmtMoney(q.net_total, cc));
    summaryRow('OH&P (' + num(q.ohp_pct).toFixed(1) + '%)', fmtMoney(q.ohp_amount, cc));
    summaryRow('Contingency (' + num(q.contingency_pct).toFixed(1) + '%)', fmtMoney(q.contingency_amount, cc));
    summaryRow('VAT (' + num(q.vat_pct).toFixed(1) + '%)', fmtMoney(q.vat_amount, cc));
    sy += 4;
    doc.moveTo(315, sy).lineTo(550, sy).strokeColor('#cbd5e1').stroke();
    sy += 6;
    summaryRow('Grand Total', fmtMoney(q.grand_total, cc), true);
    y += 140;

    // est_rate marker explanation
    const anyEst = lines.some(l => l.est_rate);
    if (anyEst) {
      ensureRoom(24);
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#B45309');
      doc.text('* Rate estimated by AI — no match in priced rate library. Confirm before issuing.', 40, y);
      doc.fillColor('#111111');
      y += 14;
    }

    // Notes + terms
    if (q.notes) {
      ensureRoom(60);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(10).text('Notes', 40, y); y += 14;
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(q.notes, 40, y, { width: 515 });
      const h = doc.heightOfString(q.notes, { width: 515 });
      y += h + 6;
      doc.fillColor('#111111');
    }

    // Footer
    const footY = doc.page.height - 50;
    doc.font('Helvetica').fontSize(8).fillColor('#666666')
      .text(branding.footer_text || 'This quotation is valid for 30 days from the date above. Prices exclude VAT unless stated.', 40, footY, { width: 515, align: 'center' });

    doc.end();
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
    sumRow('OH&P (' + num(q.ohp_pct) + '%)', num(q.ohp_amount));
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

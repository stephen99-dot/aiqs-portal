// ═══════════════════════════════════════════════════════════════════════════
// variationDraft.js — AI indicative-cost draft for change orders (Phase 2).
//
// A site manager describes a change in plain English ("plaster 5 sqm, chippy 2
// days"); this drafts priced variation lines the office then reviews and fixes.
// Deliberately self-contained (doesn't reach into the 42KB estimator route
// module): a focused system prompt + forced-JSON tool call, grounded in the
// builder's own day rates and confirmed rates, priced as indicative (est_rate).
//
// Owner-portal only — the route gates with adminMiddleware.
// ═══════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { callModel, MODELS } = require('./anthropicClient');

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const SYSTEM_PROMPT = `You are a UK Quantity Surveyor pricing a SINGLE on-site variation (change order) for a builder.

You receive a short, plain-English description of one change found or requested on site. Interpret trade shorthand and measurements, and output priced line items via the tool.

Interpretation examples:
- "plaster 5 sqm" -> item "Plastering", unit "m2", qty 5
- "chippy 2 days" -> item "Carpenter (labour)", unit "day", qty 2
- "supply and fit 3 sockets" -> item "Socket outlet", unit "nr", qty 3

RULES:
1. This is ONE change, not a whole project — usually 1 to 8 lines.
2. Use UK construction terminology and UK units (m, m², m³, nr, day, item, sum).
3. Quantities come from the description; if a size is implied but not given, make a reasonable estimate and say so in the description.
4. Rates are INDICATIVE 2024-2026 UK trade rates — the office will confirm the workload and fix the cost. Prefer the builder's own rates where given.
5. labour + materials should roughly sum to rate (labour-only lines have materials 0).
6. Do NOT include VAT, OH&P, contingency or margin — those are added separately.`;

// The builder's own numbers, kept compact so the prompt prefix caches well.
function builderContext(userId) {
  if (!userId) return '';
  const parts = [];
  try {
    const s = db.prepare('SELECT trade_type, day_rates FROM oib_settings WHERE user_id = ?').get(userId);
    if (s && s.trade_type) parts.push('Trade: ' + s.trade_type + '.');
    if (s && s.day_rates) {
      try {
        const rates = Object.entries(JSON.parse(s.day_rates)).map(([k, v]) => k + ' £' + v + '/day').join(', ');
        if (rates) parts.push('Use these day rates for labour: ' + rates + '.');
      } catch (e) { /* ignore bad JSON */ }
    }
  } catch (e) { /* oib_settings may be empty */ }
  try {
    const lib = db.prepare(
      'SELECT display_name, value, unit FROM client_rate_library '
      + 'WHERE user_id = ? AND is_active = 1 AND value > 0 AND display_name IS NOT NULL '
      + 'ORDER BY times_applied DESC, times_confirmed DESC LIMIT 20'
    ).all(userId);
    if (lib.length > 0) {
      parts.push('Their confirmed rates (prefer these where they fit): '
        + lib.map(r => r.display_name + ' £' + r.value + (r.unit ? '/' + r.unit : '')).join('; ') + '.');
    }
  } catch (e) { /* table may not exist on a fresh install */ }
  return parts.join('\n');
}

// Flatten the model's JSON into our variation-line shape. Pure + unit-tested.
// Everything is marked est_rate = 1 (indicative) — the office fixes the cost.
function priceVariationDraft(draft) {
  const raw = Array.isArray(draft && draft.lines) ? draft.lines : [];
  const out = [];
  let order = 0;
  for (const it of raw) {
    const rate = num(it.rate);
    const qty = num(it.qty);
    let labour = num(it.labour);
    let materials = num(it.materials);
    if (!labour && !materials && rate > 0) { labour = round2(rate * 0.6); materials = round2(rate * 0.4); }
    out.push({
      id: uuidv4(),
      section: String(it.section || 'Change').slice(0, 80),
      item: String(it.item || '').slice(0, 200),
      description: String(it.description || '').slice(0, 500),
      unit: String(it.unit || 'item').slice(0, 20),
      qty,
      rate: round2(rate),
      labour: round2(labour),
      materials: round2(materials),
      line_total: round2(qty * rate),
      est_rate: 1,
      sort_order: order++,
    });
  }
  return out;
}

async function draftVariationLines(description, userId) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const system = [{ type: 'text', text: SYSTEM_PROMPT }];
  const ctx = builderContext(userId);
  if (ctx) system.push({ type: 'text', text: 'THIS BUILDER:\n' + ctx });

  const result = await callModel({
    model: MODELS.STANDARD,
    maxTokens: 2000,
    temperature: 0.3,
    system,
    cacheSystem: true,
    messages: [{
      role: 'user',
      content: 'On-site change to price:\n"""\n' + String(description).slice(0, 4000) + '\n"""\n\nReturn the priced lines now.',
    }],
    tools: [{
      name: 'submit_change',
      description: 'Submit the priced change-order lines.',
      input_schema: {
        type: 'object',
        properties: { lines: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        required: ['lines'],
      },
    }],
    toolChoice: { type: 'tool', name: 'submit_change' },
  });

  if (!result.ok) {
    const errMsg = (result.error && (result.error.error?.message || result.error.message)) || '';
    throw new Error('Claude API ' + result.status + ': ' + String(errMsg).slice(0, 200));
  }

  const lines = priceVariationDraft(result.json || {});

  // Log the AI call to usage_log, mirroring the estimator's accounting.
  try {
    const tokensIn = (result.usage && result.usage.tokensIn) || 0;
    const tokensOut = (result.usage && result.usage.tokensOut) || 0;
    const model = result.model || '';
    const inPrice = model.includes('sonnet') ? 3 : 1;
    const outPrice = model.includes('sonnet') ? 15 : 5;
    const costUsd = (tokensIn * inPrice + tokensOut * outPrice) / 1_000_000;
    db.prepare(
      'INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, 'variation_ai_draft', null, model || null, tokensIn, tokensOut, costUsd);
  } catch (e) { /* never fail the draft over a log row */ }

  return lines;
}

module.exports = { draftVariationLines, priceVariationDraft, builderContext };

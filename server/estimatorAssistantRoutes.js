// ═══════════════════════════════════════════════════════════════════════════
// estimatorAssistantRoutes.js — update an EXISTING quote by talking to the AI.
//
// The builder opens a saved quote and says what changed ("I've got the
// electrician's quote now — here it is" + upload, "add £400 for the skip",
// "knock 10% off the roof section"). The assistant reads the current quote,
// asks qualifying questions when the request is ambiguous, and — once it is
// sure — proposes a structured changeset via a tool call. NOTHING is written
// to the quote here: the server validates the changeset, previews the new
// totals, and hands it back; the editor page applies it to the on-screen
// lines and saves through the existing PATCH/PUT endpoints, so locked-quote
// rules, totals maths and job links all stay on the one battle-tested path.
//
// Durable preferences ("always use SparkPro's rates for electrics") are saved
// to the user's AI memory (memoryStore) via a second tool, and relevant
// memories are injected into every turn so the assistant remembers next time.
//
//   POST /api/estimator/quotes/:id/assistant   (multipart: message, history,
//        quote_state, files[]) -> { reply, proposal?, memories_saved }
//
// Shared plumbing (uploads -> content blocks, history sanitising, memory
// persistence) lives in assistantCore.js — the builder-pack assistant uses
// the same pieces.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { callModel, MODELS } = require('./anthropicClient');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');
const { computeFinancials, netFromLines } = require('./lib/money');
const { builderContext } = require('./variationDraft');
const core = require('./assistantCore');

const router = express.Router();
const upload = core.createUpload();

function num(v, fb = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) { return Math.round((num(n)) * 100) / 100; }

// ─── Quote snapshot — what the model sees ────────────────────────────────────
// Lines are numbered ref 1..N (position in the CURRENT editor state, which the
// page posts with every message). The changeset addresses lines by ref, so it
// works for unsaved lines too and never depends on DB ids.
function snapshotForPrompt(header, lines) {
  const out = [];
  out.push(`Quote ${header.quote_number || '(unsaved)'} — "${header.project_name || 'Untitled'}"` +
    (header.client_name ? ` for ${header.client_name}` : ''));
  out.push(`Currency: ${header.currency || 'GBP'} | Markup (OH&P): ${num(header.ohp_pct)}% | Contingency: ${num(header.contingency_pct)}% | VAT: ${num(header.vat_pct)}%`);
  if (header.notes) out.push(`Notes/terms: ${String(header.notes).slice(0, 500)}`);
  out.push('');
  out.push('LINES (ref | section | item | description | qty | unit | rate | line total):');
  lines.forEach((ln, i) => {
    out.push(`${i + 1} | ${ln.section || 'General'} | ${ln.item || ''} | ${String(ln.description || '').slice(0, 160)} | ${num(ln.qty)} | ${ln.unit || 'item'} | ${num(ln.rate)} | ${round2(num(ln.qty) * num(ln.rate))}`);
  });
  const net = netFromLines(lines);
  const fin = computeFinancials(net, header);
  out.push('');
  out.push(`Totals: net ${fin.net_total} | OH&P ${fin.ohp_amount} | contingency ${fin.contingency_amount} | VAT ${fin.vat_amount} | GRAND TOTAL ${fin.grand_total}`);
  return out.join('\n');
}

// ─── Tools ───────────────────────────────────────────────────────────────────
const UPDATE_TOOL = {
  name: 'propose_quote_update',
  description: 'Propose changes to the quote. The builder reviews the changes on screen and applies them — nothing is changed until they do. Only include fields that actually change. Rates are NET of VAT, per unit.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two plain-English sentences describing the change, e.g. "Updated the electrics to match SparkPro\'s quote — first fix up to £1,850 and second fix to £1,420."' },
      line_updates: {
        type: 'array',
        description: 'Changes to existing lines, addressed by their ref number from the LINES list.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'integer' },
            qty: { type: 'number' },
            rate: { type: 'number', description: 'New rate per unit, net of VAT' },
            labour: { type: 'number' },
            materials: { type: 'number' },
            item: { type: 'string' },
            description: { type: 'string' },
            unit: { type: 'string' },
            section: { type: 'string' },
          },
          required: ['ref'],
        },
      },
      new_lines: {
        type: 'array',
        description: 'Brand new lines to add.',
        items: {
          type: 'object',
          properties: {
            section: { type: 'string' },
            item: { type: 'string' },
            description: { type: 'string' },
            unit: { type: 'string' },
            qty: { type: 'number' },
            rate: { type: 'number' },
            labour: { type: 'number' },
            materials: { type: 'number' },
          },
          required: ['item', 'qty', 'rate'],
        },
      },
      remove_refs: {
        type: 'array',
        description: 'Ref numbers of lines to remove entirely.',
        items: { type: 'integer' },
      },
      header: {
        type: 'object',
        description: 'Header changes — only when the user asks for them.',
        properties: {
          project_name: { type: 'string' },
          client_name: { type: 'string' },
          notes: { type: 'string' },
          ohp_pct: { type: 'number' },
          contingency_pct: { type: 'number' },
          vat_pct: { type: 'number' },
        },
      },
    },
    required: ['summary'],
  },
};

const SYSTEM_PROMPT = `You are the AI assistant inside a UK builder's quoting tool. The builder has an EXISTING quote open on screen and wants to change it by talking to you — instead of re-typing lines by hand.

Typical requests:
- "I've got the electrician's quote now" + an uploaded PDF/photo/spreadsheet → read it and update the matching lines/section to those costs.
- "Add £400 for a skip" → add a line.
- "The roof's gone up, make it £6,200 all in" → adjust the relevant lines.
- "Take the decorating out" → remove lines.

HOW TO BEHAVE:
1. QUALIFYING QUESTIONS: if the request is ambiguous — you can't tell which lines it means, whether an uploaded quote includes VAT, whether it's supply-only or supply-and-fit, or whether it replaces or adds to existing lines — ask 1-3 short questions in plain text and DO NOT call propose_quote_update yet. Never guess on money.
2. WHEN CONFIDENT, call propose_quote_update with only what changes. The builder sees a before/after preview and taps Apply — you never change anything directly, so don't say "I've updated it"; say what you're proposing.
3. UPLOADED SUPPLIER QUOTES: pull out the line items and totals. Quote lines here are NET of VAT — if the supplier's figures include VAT, strip it (and say so). Map the supplier's items onto the existing lines where they clearly match; add new lines for genuinely new items. If the supplier total replaces several existing lines, update or remove those lines so nothing is double-counted.
4. MEMORY: when the builder states a durable preference (a supplier they now use, a standing exclusion, a markup rule) — or asks you to remember something — call save_memory as well, and tell them it's been remembered. One-off changes to this quote are NOT memories.
5. MONEY DISCIPLINE: rates are per unit, net of VAT. labour + materials should roughly sum to rate where you set them. Don't touch OH&P/contingency/VAT percentages unless asked. Keep everything else exactly as it is.
6. TONE: plain English, short, like a sharp QS talking to a builder. Use £ figures. No corporate waffle.`;

// ─── Changeset validation + preview ─────────────────────────────────────────
// The model's changeset is checked against the snapshot the page sent, then a
// preview of the resulting lines + totals is computed so the builder sees the
// exact before/after without anything being saved.
function validateAndPreview(input, header, lines) {
  const nLines = lines.length;
  const errors = [];

  const lineUpdates = [];
  for (const u of (Array.isArray(input.line_updates) ? input.line_updates : [])) {
    const ref = parseInt(u.ref, 10);
    if (!Number.isInteger(ref) || ref < 1 || ref > nLines) { errors.push(`unknown line ref ${u.ref}`); continue; }
    const clean = { ref };
    if (u.qty != null) clean.qty = round2(num(u.qty));
    if (u.rate != null) clean.rate = round2(num(u.rate));
    if (u.labour != null) clean.labour = round2(num(u.labour));
    if (u.materials != null) clean.materials = round2(num(u.materials));
    if (u.item != null) clean.item = String(u.item).slice(0, 200);
    if (u.description != null) clean.description = String(u.description).slice(0, 500);
    if (u.unit != null) clean.unit = String(u.unit).slice(0, 20);
    if (u.section != null) clean.section = String(u.section).slice(0, 80);
    if (Object.keys(clean).length > 1) lineUpdates.push(clean);
  }

  const newLines = [];
  for (const nl of (Array.isArray(input.new_lines) ? input.new_lines : [])) {
    if (!nl || nl.item == null) continue;
    const rate = round2(num(nl.rate));
    let labour = round2(num(nl.labour));
    let materials = round2(num(nl.materials));
    if (!labour && !materials && rate > 0) { labour = round2(rate * 0.6); materials = round2(rate * 0.4); }
    newLines.push({
      section: String(nl.section || 'General').slice(0, 80),
      item: String(nl.item || '').slice(0, 200),
      description: String(nl.description || '').slice(0, 500),
      unit: String(nl.unit || 'item').slice(0, 20),
      qty: round2(num(nl.qty)),
      rate, labour, materials,
    });
  }

  const removeRefs = [];
  for (const r of (Array.isArray(input.remove_refs) ? input.remove_refs : [])) {
    const ref = parseInt(r, 10);
    if (!Number.isInteger(ref) || ref < 1 || ref > nLines) { errors.push(`unknown remove ref ${r}`); continue; }
    if (!removeRefs.includes(ref)) removeRefs.push(ref);
  }

  let headerChanges = null;
  if (input.header && typeof input.header === 'object') {
    headerChanges = {};
    for (const k of ['project_name', 'client_name', 'notes']) {
      if (input.header[k] != null) headerChanges[k] = String(input.header[k]).slice(0, k === 'notes' ? 2000 : 200);
    }
    for (const k of ['ohp_pct', 'contingency_pct', 'vat_pct']) {
      if (input.header[k] != null) headerChanges[k] = round2(num(input.header[k]));
    }
    if (Object.keys(headerChanges).length === 0) headerChanges = null;
  }

  if (lineUpdates.length === 0 && newLines.length === 0 && removeRefs.length === 0 && !headerChanges) {
    return { ok: false, errors: errors.length ? errors : ['the proposal contained no valid changes'] };
  }

  // Build the would-be lines and diff descriptions.
  const changes = [];
  const nextLines = lines.map((ln, i) => {
    const u = lineUpdates.find(x => x.ref === i + 1);
    if (!u) return ln;
    const next = { ...ln };
    const bits = [];
    if (u.qty != null && round2(num(ln.qty)) !== u.qty) bits.push(`qty ${num(ln.qty)} → ${u.qty}`);
    if (u.rate != null && round2(num(ln.rate)) !== u.rate) bits.push(`rate £${num(ln.rate)} → £${u.rate}`);
    for (const k of ['qty', 'rate', 'labour', 'materials', 'item', 'description', 'unit', 'section']) {
      if (u[k] != null) next[k] = u[k];
    }
    if (u.rate != null) next.est_rate = 0;
    changes.push({
      kind: 'update', ref: u.ref,
      label: `${ln.item || ln.description || 'Line ' + u.ref}${bits.length ? ' — ' + bits.join(', ') : ' — details updated'}`,
    });
    return next;
  }).filter((ln, i) => {
    if (removeRefs.includes(i + 1)) {
      changes.push({ kind: 'remove', ref: i + 1, label: `Removed: ${lines[i].item || lines[i].description || 'line ' + (i + 1)} (£${round2(num(lines[i].qty) * num(lines[i].rate))})` });
      return false;
    }
    return true;
  });
  for (const nl of newLines) {
    changes.push({ kind: 'add', label: `Added: ${nl.item} — ${nl.qty} ${nl.unit} @ £${nl.rate} (£${round2(nl.qty * nl.rate)})` });
    nextLines.push(nl);
  }
  if (headerChanges) {
    for (const [k, v] of Object.entries(headerChanges)) {
      const pretty = { ohp_pct: 'Markup %', contingency_pct: 'Contingency %', vat_pct: 'VAT %', project_name: 'Project name', client_name: 'Client name', notes: 'Notes/terms' }[k] || k;
      changes.push({ kind: 'header', label: `${pretty}: ${num(header[k]) || header[k] || '—'} → ${v}` });
    }
  }

  const effHeader = { ...header, ...(headerChanges || {}) };
  const before = computeFinancials(netFromLines(lines), header);
  const after = computeFinancials(netFromLines(nextLines), effHeader);

  return {
    ok: true,
    proposal: {
      id: 'prop_' + uuidv4().slice(0, 8),
      summary: String(input.summary || '').slice(0, 600),
      line_updates: lineUpdates,
      new_lines: newLines,
      remove_refs: removeRefs,
      header: headerChanges,
      changes,
      before_total: before.grand_total,
      after_total: after.grand_total,
      currency: header.currency || 'GBP',
    },
    warnings: errors,
  };
}

// ─── The route ───────────────────────────────────────────────────────────────
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

router.post('/quotes/:id/assistant', (req, res) => {
  upload.array('files', 5)(req, res, async (err) => {
    try {
      if (err) {
        core.cleanupUploads(req);
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big — 25MB max.' : 'Upload failed: ' + err.message });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        core.cleanupUploads(req);
        return res.status(502).json({ error: 'The AI is not configured on this server.' });
      }

      const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!q) { core.cleanupUploads(req); return res.status(404).json({ error: 'Quote not found.' }); }
      if (q.locked) {
        core.cleanupUploads(req);
        return res.status(423).json({ error: 'This quote has been accepted by the client and is locked. Duplicate it to make a revised version.', code: 'QUOTE_LOCKED' });
      }

      const message = String(req.body.message || '').trim().slice(0, 8000);
      if (!message && (!req.files || req.files.length === 0)) {
        core.cleanupUploads(req);
        return res.status(400).json({ error: 'Say what you want changed (or attach a file).' });
      }

      // The page posts its CURRENT on-screen state so unsaved edits are seen and
      // refs line up with what the builder is looking at. Fall back to the DB.
      let header, lines;
      try {
        const state = req.body.quote_state ? JSON.parse(req.body.quote_state) : null;
        if (state && Array.isArray(state.lines)) {
          header = { ...q, ...state.header };
          lines = state.lines;
        }
      } catch (e) { /* fall through to DB */ }
      if (!lines) {
        header = q;
        lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort_order ASC, rowid ASC').all(q.id);
      }
      if (lines.length > 300) { core.cleanupUploads(req); return res.status(400).json({ error: 'This quote is too large for the assistant.' }); }

      const history = core.sanitizeHistory(req.body.history);

      // System prompt: role + the builder's own numbers + their memories.
      const system = [{ type: 'text', text: SYSTEM_PROMPT }];
      const ctx = builderContext(req.user.id);
      if (ctx) system.push({ type: 'text', text: 'THIS BUILDER:\n' + ctx });
      const memBlock = await core.memoryPromptBlock(db, req.user.id, message || q.project_name);
      if (memBlock) system.push({ type: 'text', text: memBlock });

      // Final user turn: the quote snapshot + uploaded files + the message.
      const content = [{ type: 'text', text: 'THE QUOTE AS IT STANDS NOW:\n' + snapshotForPrompt(header, lines) }];
      content.push(...await core.uploadedFileBlocks(req));
      content.push({ type: 'text', text: 'BUILDER SAYS:\n' + (message || '(no message — just the attached file)') });

      const result = await callModel({
        model: MODELS.STANDARD,
        maxTokens: 3000,
        temperature: 0.2,
        system,
        cacheSystem: true,
        cacheMessages: true,
        messages: [...history, { role: 'user', content }],
        tools: [UPDATE_TOOL, core.MEMORY_TOOL],
        userId: req.user.id,
        action: 'estimator_assistant',
        detail: 'quote:' + q.id,
      });
      core.cleanupUploads(req);

      if (!result.ok) {
        const errMsg = result.error?.error?.message || result.error?.message || '';
        console.error('[EstimatorAssistant] Claude call failed:', result.status, String(errMsg).slice(0, 200));
        return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
      }

      // Handle tool calls: memories persist immediately (cheap + reversible from
      // /ai-memory); the quote changeset only ever comes back as a proposal.
      const memoriesSaved = await core.saveMemoriesFromToolUse(db, req.user.id, result.toolUse, 'estimator_assistant');
      let proposal = null;
      const warnings = [];
      for (const tc of (result.toolUse || [])) {
        if (tc.name === 'propose_quote_update' && tc.input) {
          const v = validateAndPreview(tc.input, header, lines);
          if (v.ok) { proposal = v.proposal; warnings.push(...v.warnings); }
          else warnings.push(...v.errors);
        }
      }

      let reply = (result.text || '').trim();
      if (!reply && proposal) reply = proposal.summary;
      if (!reply && memoriesSaved.length) reply = 'Noted — I\'ll remember that for future quotes.';
      if (!reply) reply = 'Sorry — I couldn\'t work out a change from that. Can you say it another way?';

      res.json({ reply, proposal, memories_saved: memoriesSaved, warnings: warnings.length ? warnings : undefined });
    } catch (e) {
      core.cleanupUploads(req);
      console.error('[EstimatorAssistant] error:', e);
      res.status(500).json({ error: 'The assistant hit a problem. Please try again.' });
    }
  });
});

module.exports = router;
module.exports._test = { validateAndPreview, snapshotForPrompt };

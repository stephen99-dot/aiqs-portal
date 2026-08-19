// ═══════════════════════════════════════════════════════════════════════════
// builderPackAssistantRoutes.js — update the Builder Pack / Client Copy by
// talking to the AI, mirroring the quote assistant (estimatorAssistantRoutes).
//
// The builder has a parsed BOQ open on /project/:id/builder-pack, amending
// figures before generating the client copy. Instead of hand-editing lines
// they say what changed — "I've got the electrician's quote now" + upload,
// "add £400 for a second skip", "set VAT to 20%" — and the assistant proposes
// a changeset. NOTHING is written here: the page applies the changes to its
// on-screen sections/controls (the same state manual edits go through) and its
// existing auto-save persists them, so the exports and share-link stay on the
// one tested path.
//
//   POST /api/projects/:projectId/builder-pack/assistant
//        (multipart: message, history, pack_state, files[])
//        -> { reply, proposal?, memories_saved }
//
// IMPORTANT data shape difference from the quote assistant: builder-pack items
// carry labour/materials as LINE TOTALS (not per-unit rates), and composite
// BOQs carry the money in `total` alone. Refs number the items 1..N in
// document order across all sections.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { callModel, MODELS } = require('./anthropicClient');
const { authMiddleware } = require('./auth');
const { builderContext } = require('./variationDraft');
const core = require('./assistantCore');

const router = express.Router();
const upload = core.createUpload();

function num(v, fb = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) { return Math.round((num(n)) * 100) / 100; }

// Same access rule as every other builder-pack route (variationRoutes.js):
// admins see all projects, users see their own.
function loadProjectForUser(req) {
  const { projectId } = req.params;
  return req.user.role === 'admin'
    ? db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
    : db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
}

// The money value of a line — split BOQs carry labour+materials (line totals),
// composite BOQs carry it in `total` alone. Mirrors lineTotal() on the page.
function lineValue(it) {
  const lm = num(it.labour) + num(it.materials);
  return lm !== 0 ? lm : num(it.total);
}

// Flatten sections to [{ref, s (section idx), i (item idx), section, item}] in
// document order — the changeset addresses items by these refs.
function flattenItems(sections) {
  const flat = [];
  sections.forEach((sec, s) => {
    (sec.items || []).forEach((it, i) => {
      flat.push({ ref: flat.length + 1, s, i, section: sec, item: it });
    });
  });
  return flat;
}

function baseNet(sections) {
  let net = 0;
  for (const sec of sections) for (const it of (sec.items || [])) net += lineValue(it);
  return round2(net);
}

// ─── Snapshot — what the model sees ──────────────────────────────────────────
function snapshotForPrompt(project, sections, controls) {
  const c = controls || {};
  const out = [];
  out.push(`BOQ for project "${project.title || project.id}" — Builder Pack / Client Copy editor.`);
  out.push(`Client-copy controls: overhead ${num(c.overhead_pct)}% | profit ${num(c.profit_pct)}% | contingency ${num(c.contingency_pct)}% | VAT ${num(c.vat_pct)}% | provisional sums £${num(c.provisional_sum)}`);
  out.push('');
  out.push('ITEMS (ref | section | item ref | description | qty | unit | labour £ (line total) | materials £ (line total) | line total £):');
  const flat = flattenItems(sections);
  let lastSection = null;
  for (const f of flat) {
    if (f.section !== lastSection) {
      out.push(`-- Section ${f.section.number || ''}: ${f.section.title || 'Untitled'}${f.section.provisional ? ' (PROVISIONAL — carried excl. OH&P)' : ''}`);
      lastSection = f.section;
    }
    const it = f.item;
    out.push(`${f.ref} | ${f.section.number || ''} | ${it.itemRef || ''} | ${String(it.description || '').slice(0, 160)} | ${num(it.qty)} | ${it.unit || ''} | ${num(it.labour)} | ${num(it.materials)} | ${round2(lineValue(it))}`);
  }
  out.push('');
  out.push(`Net build cost (sum of line totals, before overhead/profit/contingency/VAT): £${baseNet(sections)}`);
  return out.join('\n');
}

// ─── Tools ───────────────────────────────────────────────────────────────────
const UPDATE_TOOL = {
  name: 'propose_pack_update',
  description: 'Propose changes to the BOQ items and/or the client-copy controls. The builder reviews the changes on screen and applies them — nothing changes until they do. Only include fields that actually change. IMPORTANT: labour and materials are LINE TOTALS in £ (not per-unit rates); for composite lines (labour and materials both 0) set `total` instead. All figures are NET of VAT.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two plain-English sentences describing the change.' },
      line_updates: {
        type: 'array',
        description: 'Changes to existing items, addressed by their ref number from the ITEMS list.',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'integer' },
            qty: { type: 'number' },
            labour: { type: 'number', description: 'New labour LINE TOTAL in £, net of VAT' },
            materials: { type: 'number', description: 'New materials LINE TOTAL in £, net of VAT' },
            total: { type: 'number', description: 'New line total in £ — ONLY for composite lines with no labour/materials split' },
            description: { type: 'string' },
            unit: { type: 'string' },
            itemRef: { type: 'string' },
          },
          required: ['ref'],
        },
      },
      new_lines: {
        type: 'array',
        description: 'Brand new items to add. section_number picks which section (from the ITEMS list); omit to add to the last section.',
        items: {
          type: 'object',
          properties: {
            section_number: { type: 'string' },
            description: { type: 'string' },
            unit: { type: 'string' },
            qty: { type: 'number' },
            labour: { type: 'number', description: 'Labour LINE TOTAL in £' },
            materials: { type: 'number', description: 'Materials LINE TOTAL in £' },
          },
          required: ['description', 'qty'],
        },
      },
      remove_refs: {
        type: 'array',
        description: 'Ref numbers of items to remove entirely.',
        items: { type: 'integer' },
      },
      controls: {
        type: 'object',
        description: 'Client-copy control changes — only when the user asks for them.',
        properties: {
          overhead_pct: { type: 'number' },
          profit_pct: { type: 'number' },
          contingency_pct: { type: 'number' },
          vat_pct: { type: 'number' },
          provisional_sum: { type: 'number' },
        },
      },
    },
    required: ['summary'],
  },
};

const SYSTEM_PROMPT = `You are the AI assistant inside a UK Quantity Surveying portal, on the Builder Pack / Client Copy screen. The builder has a priced BOQ open and is amending figures before generating the client copy. They want to change it by talking to you instead of re-typing lines.

Typical requests:
- "I've got the electrician's quote now" + an uploaded PDF/photo/spreadsheet → read it and update the matching items/section to those costs.
- "Add £400 for a second skip" → add an item to the right section.
- "Scaffold's gone up to £21,500" → adjust that item.
- "Take the asbestos lines out" → remove items.
- "Set VAT to 20%" / "add 10% contingency" → change the client-copy controls.

HOW TO BEHAVE:
1. QUALIFYING QUESTIONS: if the request is ambiguous — you can't tell which items it means, whether an uploaded quote includes VAT, whether it's supply-only or supply-and-fit, or whether it replaces or adds to existing items — ask 1-3 short questions in plain text and DO NOT call propose_pack_update yet. Never guess on money.
2. WHEN CONFIDENT, call propose_pack_update with only what changes. The builder sees the changes and taps Apply — you never change anything directly, so don't say "I've updated it"; say what you're proposing.
3. DATA SHAPE: labour and materials are LINE TOTALS in £ (not per-unit rates). A composite line (labour and materials both 0) carries its money in the line total — set \`total\` for those, never invent a labour/materials split. All figures are NET of VAT.
4. UPLOADED SUPPLIER QUOTES: pull out the line items and totals. If the supplier's figures include VAT, strip it (and say so). Map their items onto existing lines where they clearly match; add new items for genuinely new work. If a supplier total replaces several existing items, update or remove those so nothing is double-counted.
5. MEMORY: when the builder states a durable preference (a supplier they now use, a standing exclusion, a markup rule) — or asks you to remember something — call save_memory as well, and tell them it's been remembered. One-off changes to this BOQ are NOT memories.
6. Don't touch overhead/profit/contingency/VAT unless asked. Keep everything else exactly as it is.
7. TONE: plain English, short, like a sharp QS talking to a builder. Use £ figures. No corporate waffle.`;

// ─── Changeset validation + preview ─────────────────────────────────────────
// Checked against the sections the page sent; returns a normalized changeset
// (with each update located by section/item index so the page can apply it
// without re-deriving refs) plus human-readable diffs and a base-net preview.
function validateAndPreview(input, project, sections, controls) {
  const flat = flattenItems(sections);
  const errors = [];

  const lineUpdates = [];
  for (const u of (Array.isArray(input.line_updates) ? input.line_updates : [])) {
    const ref = parseInt(u.ref, 10);
    const loc = flat[ref - 1];
    if (!Number.isInteger(ref) || !loc) { errors.push(`unknown item ref ${u.ref}`); continue; }
    const clean = { ref, s: loc.s, i: loc.i };
    if (u.qty != null) clean.qty = round2(num(u.qty));
    if (u.labour != null) clean.labour = round2(num(u.labour));
    if (u.materials != null) clean.materials = round2(num(u.materials));
    if (u.total != null) clean.total = round2(num(u.total));
    // A split edit and a composite `total` are mutually exclusive — the split
    // wins, otherwise applying `total` would zero the labour/materials just set.
    if (clean.total != null && (clean.labour != null || clean.materials != null)) delete clean.total;
    if (u.description != null) clean.description = String(u.description).slice(0, 500);
    if (u.unit != null) clean.unit = String(u.unit).slice(0, 20);
    if (u.itemRef != null) clean.itemRef = String(u.itemRef).slice(0, 20);
    if (Object.keys(clean).length > 3) lineUpdates.push(clean);
  }

  const newLines = [];
  for (const nl of (Array.isArray(input.new_lines) ? input.new_lines : [])) {
    if (!nl || nl.description == null) continue;
    let sIdx = sections.length - 1;
    if (nl.section_number != null) {
      const found = sections.findIndex(s => String(s.number) === String(nl.section_number));
      if (found >= 0) sIdx = found;
    }
    if (sIdx < 0) { errors.push('no section to add the new item to'); continue; }
    newLines.push({
      s: sIdx,
      section_title: sections[sIdx] ? sections[sIdx].title : '',
      description: String(nl.description || '').slice(0, 500),
      unit: String(nl.unit || 'item').slice(0, 20),
      qty: round2(num(nl.qty)) || 1,
      labour: round2(num(nl.labour)),
      materials: round2(num(nl.materials)),
    });
  }

  const removeRefs = [];
  const removeLocs = [];
  for (const r of (Array.isArray(input.remove_refs) ? input.remove_refs : [])) {
    const ref = parseInt(r, 10);
    const loc = flat[ref - 1];
    if (!Number.isInteger(ref) || !loc) { errors.push(`unknown remove ref ${r}`); continue; }
    if (!removeRefs.includes(ref)) { removeRefs.push(ref); removeLocs.push({ ref, s: loc.s, i: loc.i }); }
  }

  let controlChanges = null;
  if (input.controls && typeof input.controls === 'object') {
    controlChanges = {};
    for (const k of ['overhead_pct', 'profit_pct', 'contingency_pct', 'vat_pct', 'provisional_sum']) {
      if (input.controls[k] != null) controlChanges[k] = round2(num(input.controls[k]));
    }
    if (Object.keys(controlChanges).length === 0) controlChanges = null;
  }

  if (lineUpdates.length === 0 && newLines.length === 0 && removeLocs.length === 0 && !controlChanges) {
    return { ok: false, errors: errors.length ? errors : ['the proposal contained no valid changes'] };
  }

  // Human-readable diffs + the would-be net, computed against a working copy.
  const changes = [];
  const work = sections.map(s => ({ ...s, items: (s.items || []).map(it => ({ ...it })) }));
  for (const u of lineUpdates) {
    const cur = work[u.s].items[u.i];
    const bits = [];
    if (u.qty != null && round2(num(cur.qty)) !== u.qty) bits.push(`qty ${num(cur.qty)} → ${u.qty}`);
    if (u.labour != null && round2(num(cur.labour)) !== u.labour) bits.push(`labour £${num(cur.labour)} → £${u.labour}`);
    if (u.materials != null && round2(num(cur.materials)) !== u.materials) bits.push(`materials £${num(cur.materials)} → £${u.materials}`);
    if (u.total != null && round2(lineValue(cur)) !== u.total) bits.push(`total £${round2(lineValue(cur))} → £${u.total}`);
    changes.push({
      kind: 'update', ref: u.ref,
      label: `${String(cur.description || 'Item ' + u.ref).slice(0, 80)}${bits.length ? ' — ' + bits.join(', ') : ' — details updated'}`,
    });
    for (const k of ['qty', 'labour', 'materials', 'description', 'unit', 'itemRef']) {
      if (u[k] != null) cur[k] = u[k];
    }
    if (u.total != null) { cur.total = u.total; cur.labour = 0; cur.materials = 0; }
  }
  // Remove bottom-up so item indexes stay valid while splicing.
  const sortedRemoves = removeLocs.slice().sort((a, b) => (a.s - b.s) || (a.i - b.i)).reverse();
  for (const loc of sortedRemoves) {
    const it = work[loc.s].items[loc.i];
    changes.push({ kind: 'remove', ref: loc.ref, label: `Removed: ${String(it.description || 'item ' + loc.ref).slice(0, 80)} (£${round2(lineValue(it))})` });
    work[loc.s].items.splice(loc.i, 1);
  }
  for (const nl of newLines) {
    const value = round2(nl.labour + nl.materials);
    changes.push({ kind: 'add', label: `Added to ${nl.section_title || 'section'}: ${nl.description.slice(0, 80)} — ${nl.qty} ${nl.unit} (£${value})` });
    work[nl.s].items.push({ description: nl.description, unit: nl.unit, qty: nl.qty, labour: nl.labour, materials: nl.materials, total: value });
  }
  if (controlChanges) {
    const pretty = { overhead_pct: 'Overhead %', profit_pct: 'Profit %', contingency_pct: 'Contingency %', vat_pct: 'VAT %', provisional_sum: 'Provisional sums £' };
    for (const [k, v] of Object.entries(controlChanges)) {
      changes.push({ kind: 'header', label: `${pretty[k] || k}: ${num((controls || {})[k])} → ${v}` });
    }
  }

  return {
    ok: true,
    proposal: {
      id: 'prop_' + uuidv4().slice(0, 8),
      summary: String(input.summary || '').slice(0, 600),
      line_updates: lineUpdates,
      new_lines: newLines,
      remove_locs: sortedRemoves,
      controls: controlChanges,
      changes,
      // Base net build cost (before overhead/profit/contingency/VAT) — the
      // page's live preview shows the full cascade the moment it's applied.
      before_total: baseNet(sections),
      after_total: baseNet(work),
      totals_note: 'Net build cost before overhead, profit, contingency and VAT — the preview recalculates when you apply.',
      currency: project.currency || 'GBP',
    },
    warnings: errors,
  };
}

// ─── The route ───────────────────────────────────────────────────────────────
router.post('/projects/:projectId/builder-pack/assistant', authMiddleware, (req, res) => {
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

      const project = loadProjectForUser(req);
      if (!project) { core.cleanupUploads(req); return res.status(404).json({ error: 'Project not found.' }); }

      const message = String(req.body.message || '').trim().slice(0, 8000);
      if (!message && (!req.files || req.files.length === 0)) {
        core.cleanupUploads(req);
        return res.status(400).json({ error: 'Say what you want changed (or attach a file).' });
      }

      // The page always posts its CURRENT on-screen sections + controls — the
      // same shape it sends to the download/share endpoints.
      let sections = null, controls = {};
      try {
        const state = req.body.pack_state ? JSON.parse(req.body.pack_state) : null;
        if (state && Array.isArray(state.sections)) {
          sections = state.sections;
          controls = state.controls || {};
        }
      } catch (e) { /* handled below */ }
      if (!sections || sections.length === 0) {
        core.cleanupUploads(req);
        return res.status(400).json({ error: 'No BOQ items to work on — reload the page and try again.' });
      }
      const itemCount = sections.reduce((a, s) => a + ((s.items || []).length), 0);
      if (itemCount > 500) { core.cleanupUploads(req); return res.status(400).json({ error: 'This BOQ is too large for the assistant.' }); }

      const history = core.sanitizeHistory(req.body.history);

      const system = [{ type: 'text', text: SYSTEM_PROMPT }];
      const ctx = builderContext(req.user.id);
      if (ctx) system.push({ type: 'text', text: 'THIS BUILDER:\n' + ctx });
      const memBlock = await core.memoryPromptBlock(db, req.user.id, message || project.title);
      if (memBlock) system.push({ type: 'text', text: memBlock });

      const content = [{ type: 'text', text: 'THE BOQ AS IT STANDS NOW:\n' + snapshotForPrompt(project, sections, controls) }];
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
        action: 'builder_pack_assistant',
        detail: 'project:' + project.id,
      });
      core.cleanupUploads(req);

      if (!result.ok) {
        const errMsg = result.error?.error?.message || result.error?.message || '';
        console.error('[BuilderPackAssistant] Claude call failed:', result.status, String(errMsg).slice(0, 200));
        return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
      }

      const memoriesSaved = await core.saveMemoriesFromToolUse(db, req.user.id, result.toolUse, 'builder_pack_assistant');
      let proposal = null;
      const warnings = [];
      for (const tc of (result.toolUse || [])) {
        if (tc.name === 'propose_pack_update' && tc.input) {
          const v = validateAndPreview(tc.input, project, sections, controls);
          if (v.ok) { proposal = v.proposal; warnings.push(...v.warnings); }
          else warnings.push(...v.errors);
        }
      }

      let reply = (result.text || '').trim();
      if (!reply && proposal) reply = proposal.summary;
      if (!reply && memoriesSaved.length) reply = 'Noted — I\'ll remember that for future jobs.';
      if (!reply) reply = 'Sorry — I couldn\'t work out a change from that. Can you say it another way?';

      res.json({ reply, proposal, memories_saved: memoriesSaved, warnings: warnings.length ? warnings : undefined });
    } catch (e) {
      core.cleanupUploads(req);
      console.error('[BuilderPackAssistant] error:', e);
      res.status(500).json({ error: 'The assistant hit a problem. Please try again.' });
    }
  });
});

module.exports = router;
module.exports._test = { validateAndPreview, snapshotForPrompt, flattenItems, baseNet };

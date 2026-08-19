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
// Deliberately self-contained, same posture as variationDraft.js.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const db = require('./database');
const { callModel, MODELS } = require('./anthropicClient');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');
const { computeFinancials, netFromLines } = require('./lib/money');
const { builderContext } = require('./variationDraft');

let memoryStore;
try { memoryStore = require('./memoryStore'); } catch (e) { console.log('[EstimatorAssistant] memoryStore not found — memories disabled'); }
let mammoth;
try { mammoth = require('mammoth'); } catch (e) { /* docx uploads degrade to "unreadable" */ }
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { /* xlsx uploads degrade to "unreadable" */ }

const router = express.Router();

function num(v, fb = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}
function round2(n) { return Math.round((num(n)) * 100) / 100; }

// ─── Uploads — supplier quotes, invoices, photos of paperwork ────────────────
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.xlsx', '.xls', '.csv', '.docx'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 5, fieldSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      if (!req._rejectedFiles) req._rejectedFiles = [];
      req._rejectedFiles.push(file.originalname);
    }
    cb(null, ALLOWED_EXTS.includes(ext));
  },
});

// Anthropic's request cap is ~25MB; keep the PDF share well under it.
const MAX_PDF_DIRECT_BYTES = 9 * 1024 * 1024;

// Turn one uploaded file into content blocks for the model. PDFs and images go
// in natively; spreadsheets and Word docs are flattened to text (the model only
// needs the figures, not the formatting).
function fileToBlocks(filePath, originalName) {
  const ext = path.extname(filePath).toLowerCase();
  const label = { type: 'text', text: `[Uploaded file: ${originalName}]` };
  try {
    if (ext === '.pdf') {
      const data = fs.readFileSync(filePath);
      if (data.length > MAX_PDF_DIRECT_BYTES) {
        return [{ type: 'text', text: `[Uploaded file ${originalName} is too large to read (over 9MB). Ask the user for a smaller copy or the key figures.]` }];
      }
      return [label, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } }];
    }
    const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    if (imageTypes[ext]) {
      const data = fs.readFileSync(filePath);
      return [label, { type: 'image', source: { type: 'base64', media_type: imageTypes[ext], data: data.toString('base64') } }];
    }
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      if (!XLSX) return [{ type: 'text', text: `[Could not read ${originalName} — spreadsheet reader unavailable.]` }];
      const wb = XLSX.readFile(filePath);
      const parts = [];
      for (const sheetName of wb.SheetNames.slice(0, 5)) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]).trim();
        if (csv) parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
      }
      const text = parts.join('\n\n').slice(0, 40000) || '(empty spreadsheet)';
      return [{ type: 'text', text: `[Uploaded spreadsheet: ${originalName}]\n${text}` }];
    }
    if (ext === '.docx') {
      if (!mammoth) return [{ type: 'text', text: `[Could not read ${originalName} — Word reader unavailable.]` }];
      // mammoth is async; handled by the caller via fileToBlocksAsync.
      return null;
    }
  } catch (e) {
    console.error('[EstimatorAssistant] file read error:', e.message);
  }
  return [{ type: 'text', text: `[Could not read the uploaded file ${originalName}.]` }];
}

async function fileToBlocksAsync(filePath, originalName) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx' && mammoth) {
    try {
      const r = await mammoth.extractRawText({ path: filePath });
      const text = String(r.value || '').trim().slice(0, 40000) || '(empty document)';
      return [{ type: 'text', text: `[Uploaded Word document: ${originalName}]\n${text}` }];
    } catch (e) {
      console.error('[EstimatorAssistant] docx read error:', e.message);
      return [{ type: 'text', text: `[Could not read the uploaded file ${originalName}.]` }];
    }
  }
  return fileToBlocks(filePath, originalName);
}

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

const MEMORY_TOOL = {
  name: 'save_memory',
  description: 'Save a durable preference or fact the builder will want remembered on FUTURE quotes (e.g. "Use SparkPro Electrical for electrics — their 2026 rates are on file", "Always excludes decorating from quotes"). Never use it for one-off changes to this quote.',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The preference/fact, one sentence, self-contained.' },
      category: { type: 'string', description: 'One of: supplier, spec_preference, markup, exclusion, commercial, workflow, rate_note, general.' },
    },
    required: ['content'],
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
    const cleanupFiles = () => {
      for (const f of (req.files || [])) { try { fs.unlinkSync(f.path); } catch (e) {} }
    };
    try {
      if (err) {
        cleanupFiles();
        return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big — 25MB max.' : 'Upload failed: ' + err.message });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        cleanupFiles();
        return res.status(502).json({ error: 'The AI is not configured on this server.' });
      }

      const q = db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!q) { cleanupFiles(); return res.status(404).json({ error: 'Quote not found.' }); }
      if (q.locked) {
        cleanupFiles();
        return res.status(423).json({ error: 'This quote has been accepted by the client and is locked. Duplicate it to make a revised version.', code: 'QUOTE_LOCKED' });
      }

      const message = String(req.body.message || '').trim().slice(0, 8000);
      if (!message && (!req.files || req.files.length === 0)) {
        cleanupFiles();
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
      if (lines.length > 300) { cleanupFiles(); return res.status(400).json({ error: 'This quote is too large for the assistant.' }); }

      // Prior turns (text only, capped) so follow-up answers keep their context.
      let history = [];
      try {
        const h = req.body.history ? JSON.parse(req.body.history) : [];
        if (Array.isArray(h)) {
          history = h.slice(-16)
            .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.text)
            .map(m => ({ role: m.role, content: String(m.text).slice(0, 4000) }));
        }
      } catch (e) { /* start fresh */ }
      // The API requires alternating turns starting with 'user'; drop anything
      // before the first user turn and merge accidental same-role runs.
      while (history.length && history[0].role !== 'user') history.shift();
      history = history.filter((m, i) => i === 0 || m.role !== history[i - 1].role);
      if (history.length && history[history.length - 1].role === 'user') history.pop();

      // System prompt: role + the builder's own numbers + their memories.
      const system = [{ type: 'text', text: SYSTEM_PROMPT }];
      const ctx = builderContext(req.user.id);
      if (ctx) system.push({ type: 'text', text: 'THIS BUILDER:\n' + ctx });
      let memoriesUsed = [];
      if (memoryStore) {
        try {
          memoriesUsed = await memoryStore.retrieveRelevant(db, { userId: req.user.id, query: message || q.project_name, topK: 8 });
          const block = memoryStore.formatForPrompt(memoriesUsed);
          if (block) system.push({ type: 'text', text: block });
          memoryStore.markUsed(db, memoriesUsed.map(m => m.id));
        } catch (e) { /* memories are best-effort */ }
      }

      // Final user turn: the quote snapshot + uploaded files + the message.
      const content = [{ type: 'text', text: 'THE QUOTE AS IT STANDS NOW:\n' + snapshotForPrompt(header, lines) }];
      for (const f of (req.files || [])) {
        const blocks = await fileToBlocksAsync(f.path, f.originalname);
        if (blocks) content.push(...blocks);
      }
      if (req._rejectedFiles && req._rejectedFiles.length) {
        content.push({ type: 'text', text: `[These files were rejected (unsupported type): ${req._rejectedFiles.join(', ')}. Supported: PDF, photos, Excel, CSV, Word.]` });
      }
      content.push({ type: 'text', text: 'BUILDER SAYS:\n' + (message || '(no message — just the attached file)') });

      const result = await callModel({
        model: MODELS.STANDARD,
        maxTokens: 3000,
        temperature: 0.2,
        system,
        cacheSystem: true,
        cacheMessages: true,
        messages: [...history, { role: 'user', content }],
        tools: [UPDATE_TOOL, MEMORY_TOOL],
        userId: req.user.id,
        action: 'estimator_assistant',
        detail: 'quote:' + q.id,
      });
      cleanupFiles();

      if (!result.ok) {
        const errMsg = result.error?.error?.message || result.error?.message || '';
        console.error('[EstimatorAssistant] Claude call failed:', result.status, String(errMsg).slice(0, 200));
        return res.status(502).json({ error: 'The AI is temporarily unavailable. Please try again in a moment.' });
      }

      // Handle tool calls: memories persist immediately (cheap + reversible from
      // /ai-memory); the quote changeset only ever comes back as a proposal.
      let proposal = null;
      const memoriesSaved = [];
      const warnings = [];
      for (const tc of (result.toolUse || [])) {
        if (tc.name === 'save_memory' && memoryStore && tc.input && tc.input.content) {
          try {
            if (!memoryStore.isDuplicate(db, { userId: req.user.id, content: tc.input.content })) {
              const mem = await memoryStore.createMemory(db, {
                userId: req.user.id,
                content: tc.input.content,
                category: tc.input.category,
                source: 'estimator_assistant',
              });
              memoriesSaved.push({ id: mem.id, content: mem.content, category: mem.category });
            }
          } catch (e) { console.error('[EstimatorAssistant] memory save failed:', e.message); }
        } else if (tc.name === 'propose_quote_update' && tc.input) {
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
      cleanupFiles();
      console.error('[EstimatorAssistant] error:', e);
      res.status(500).json({ error: 'The assistant hit a problem. Please try again.' });
    }
  });
});

module.exports = router;
module.exports._test = { validateAndPreview, snapshotForPrompt };

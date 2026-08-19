// ═══════════════════════════════════════════════════════════════════════════
// assistantCore.js — shared plumbing for the "update it by chat" assistants
// (the quote assistant on /estimator/quote/:id and the builder-pack assistant
// on /project/:id/builder-pack). Each surface keeps its own snapshot, tools
// and changeset validation; what they share lives here: turning uploads into
// model content blocks, sanitising the client-held history into valid
// alternating turns, and persisting save_memory tool calls.
// ═══════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

let memoryStore;
try { memoryStore = require('./memoryStore'); } catch (e) { console.log('[AssistantCore] memoryStore not found — memories disabled'); }
let mammoth;
try { mammoth = require('mammoth'); } catch (e) { /* docx uploads degrade to "unreadable" */ }
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { /* xlsx uploads degrade to "unreadable" */ }

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.xlsx', '.xls', '.csv', '.docx'];

// One multer config shared by the assistant routes — supplier quotes, invoices,
// photos of paperwork. 25MB each, 5 per message.
function createUpload() {
  return multer({
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
}

// Anthropic's request cap is ~25MB; keep the PDF share well under it.
const MAX_PDF_DIRECT_BYTES = 9 * 1024 * 1024;

// Turn one uploaded file into content blocks for the model. PDFs and images go
// in natively; spreadsheets and Word docs are flattened to text (the model only
// needs the figures, not the formatting).
async function fileToBlocksAsync(filePath, originalName) {
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
      const r = await mammoth.extractRawText({ path: filePath });
      const text = String(r.value || '').trim().slice(0, 40000) || '(empty document)';
      return [{ type: 'text', text: `[Uploaded Word document: ${originalName}]\n${text}` }];
    }
  } catch (e) {
    console.error('[AssistantCore] file read error:', e.message);
  }
  return [{ type: 'text', text: `[Could not read the uploaded file ${originalName}.]` }];
}

// Content blocks for every uploaded file on the request, plus a note about any
// multer-rejected (unsupported) files so the model can tell the user.
async function uploadedFileBlocks(req) {
  const blocks = [];
  for (const f of (req.files || [])) {
    const b = await fileToBlocksAsync(f.path, f.originalname);
    if (b) blocks.push(...b);
  }
  if (req._rejectedFiles && req._rejectedFiles.length) {
    blocks.push({ type: 'text', text: `[These files were rejected (unsupported type): ${req._rejectedFiles.join(', ')}. Supported: PDF, photos, Excel, CSV, Word.]` });
  }
  return blocks;
}

function cleanupUploads(req) {
  for (const f of (req.files || [])) { try { fs.unlinkSync(f.path); } catch (e) {} }
}

// Prior turns arrive from the page as [{role, text}]. The API requires strictly
// alternating turns starting with 'user' and we're about to append a new user
// turn, so: drop leading non-user turns, merge accidental same-role runs, and
// drop a trailing user turn.
function sanitizeHistory(raw) {
  let history = [];
  try {
    const h = raw ? JSON.parse(raw) : [];
    if (Array.isArray(h)) {
      history = h.slice(-16)
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.text)
        .map(m => ({ role: m.role, content: String(m.text).slice(0, 4000) }));
    }
  } catch (e) { /* start fresh */ }
  while (history.length && history[0].role !== 'user') history.shift();
  history = history.filter((m, i) => i === 0 || m.role !== history[i - 1].role);
  if (history.length && history[history.length - 1].role === 'user') history.pop();
  return history;
}

// The chat drawer renders plain text, so markdown markers show up literally
// (**bold**, ### headings, backticks). The prompts ask for plain conversational
// text; this scrub catches anything that slips through. Bullet dashes become a
// proper bullet dot so lists still read fine.
function stripMarkdown(text) {
  if (!text) return text;
  return String(text)
    .replace(/^#{1,6}\s+/gm, '')            // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // **bold**
    .replace(/__([^_]+)__/g, '$1')          // __bold__
    .replace(/(^|\s)\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1$2') // *italic*
    .replace(/`([^`]+)`/g, '$1')            // `code`
    .replace(/^\s*[-*]\s+/gm, '• ');        // - bullets → • bullets
}

// The save_memory tool, shared by both assistants.
const MEMORY_TOOL = {
  name: 'save_memory',
  description: 'Save a durable preference or fact the builder will want remembered on FUTURE jobs (e.g. "Use SparkPro Electrical for electrics — their 2026 rates are on file", "Always excludes decorating from quotes"). Never use it for one-off changes to this document.',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The preference/fact, one sentence, self-contained.' },
      category: { type: 'string', description: 'One of: supplier, spec_preference, markup, exclusion, commercial, workflow, rate_note, general.' },
    },
    required: ['content'],
  },
};

// Retrieve + format the user's memories for the system prompt. Best-effort.
async function memoryPromptBlock(db, userId, query) {
  if (!memoryStore) return '';
  try {
    const memories = await memoryStore.retrieveRelevant(db, { userId, query, topK: 8 });
    memoryStore.markUsed(db, memories.map(m => m.id));
    return memoryStore.formatForPrompt(memories);
  } catch (e) { return ''; }
}

// Persist any save_memory tool calls; returns what was actually saved.
async function saveMemoriesFromToolUse(db, userId, toolUse, source) {
  const saved = [];
  if (!memoryStore) return saved;
  for (const tc of (toolUse || [])) {
    if (tc.name !== 'save_memory' || !tc.input || !tc.input.content) continue;
    try {
      if (memoryStore.isDuplicate(db, { userId, content: tc.input.content })) continue;
      const mem = await memoryStore.createMemory(db, {
        userId,
        content: tc.input.content,
        category: tc.input.category,
        source,
      });
      saved.push({ id: mem.id, content: mem.content, category: mem.category });
    } catch (e) { console.error('[AssistantCore] memory save failed:', e.message); }
  }
  return saved;
}

module.exports = {
  ALLOWED_EXTS,
  createUpload,
  stripMarkdown,
  fileToBlocksAsync,
  uploadedFileBlocks,
  cleanupUploads,
  sanitizeHistory,
  MEMORY_TOOL,
  memoryPromptBlock,
  saveMemoriesFromToolUse,
};

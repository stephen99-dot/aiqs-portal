const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');
const db = require('./database');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
const outputsDir = path.join(DATA_DIR, 'outputs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DYNAMIC SYSTEM PROMPT — injects client rate library
// ═══════════════════════════════════════════════════════════════════════

function buildSystemPrompt(userId) {
  let clientRateSection = '';
  try {
    const rates = db.prepare(`
      SELECT category, item_key, display_name, value, unit, confidence
      FROM client_rate_library
      WHERE user_id = ? AND is_active = 1
      ORDER BY category, confidence DESC
    `).all(userId);

    if (rates.length > 0) {
      const grouped = {};
      for (const r of rates) {
        if (!grouped[r.category]) grouped[r.category] = [];
        const conf = r.confidence >= 0.85 ? 'VERIFIED' : r.confidence >= 0.7 ? 'EMERGING' : 'NEW';
        grouped[r.category].push(`  - ${r.display_name}: ${r.value} ${r.unit} [${conf}]`);
      }
      clientRateSection = `

=== CLIENT-SPECIFIC TRAINED RATES ===
This client has their own rate library built from previous project feedback.
USE THESE RATES wherever applicable instead of the generic rates above.

${Object.entries(grouped).map(([cat, items]) => `[${cat}]\n${items.join('\n')}`).join('\n\n')}

RATE SOURCE TAGGING: For every cost item in your response, tag where the rate came from:
- Client rate [VERIFIED]: tag as "(your verified rate)"
- Client rate [EMERGING]: tag as "(your rate - calibrating)"  
- Generic/estimated rate: tag as "(generic rate)"
This helps the client see what to review and correct.
=== END CLIENT RATES ===
`;
    }
  } catch (err) {
    console.error('[Chat] Error loading client rates:', err.message);
  }

  return `You are an expert UK Quantity Surveyor AI assistant working for The AI QS (theaiqs.co.uk), a professional AI-powered quantity surveying service covering the UK and Ireland.

Your role is to help construction professionals with:
- Analysing construction drawings and providing quantity take-offs
- Producing detailed Bills of Quantities with line-by-line cost breakdowns
- Giving cost estimates based on current UK market rates
- Advising on specifications, materials, and building regulations
- Identifying scope items, risks, and potential issues in projects

GENERIC UK RATES (baseline — adjust for location):
- Strip foundations 600x250mm: 80-95/m
- Concrete floor slab 100mm: 45-55/m2
- Blockwork below DPC: 58-68/m2
- Cavity wall (block/insulation/brick): 95-120/m2
- Roof structure (cut timber): 85-105/m2
- Roof covering (concrete tiles): 45-60/m2
- UPVC windows (standard): 350-550/each
- Internal doors (painted softwood): 280-380/each
- Kitchen fit-out (mid-range): 8,000-15,000
- Bathroom fit-out (mid-range): 4,000-8,000
- First fix electrical: 2,500-4,500
- First fix plumbing: 2,000-3,500
- Plastering & skim: 18-25/m2
- Painting & decorating: 12-18/m2
- Floor finishes (LVT): 55-70/m2
- Floor finishes (carpet): 22-35/m2
- Render (monocouche): 75-95/m2
- Structural steel (supply, fab & install): 3,200-3,800/T
- Prelims: typically 10-15% of build cost
- Contingency: typically 5-10%

LOCATION FACTORS:
- London/SE: +15-25%
- South Wales: baseline
- Midlands: +5-10%
- North England: -5% to baseline
- Scotland: baseline to +5%
- Ireland: +5-15% (use EUR)
${clientRateSection}
WHEN ANALYSING DRAWINGS:
- Identify all visible elements and measure/estimate quantities
- List items by elemental breakdown
- Apply rates and state assumptions clearly
- Flag anything unclear or missing
- Include section subtotals, contingency (7.5-10%), OH&P (12-15%), VAT
- Tag rate sources if client rates are available

WHEN THE CLIENT CORRECTS A RATE:
If they say things like "fabrication should be 14 not 12.5" or "install rate is too low":
1. Acknowledge the correction clearly
2. List what changed (old -> new value with units)
3. Confirm these will be saved to their rate library for future projects
4. Offer to recalculate with corrected rates

COMMUNICATION STYLE:
- Direct and professional, like a real QS talking to a builder
- UK construction terminology
- Specific numbers, not vague ranges
- State assumptions clearly
- Flag risks
- Honest about limitations

IMPORTANT: Estimates are approximate, subject to detailed measurement and site conditions.`;
}

// ═══════════════════════════════════════════════════════════════════════
// FILE PROCESSING (same as original)
// ═══════════════════════════════════════════════════════════════════════

const VISUAL_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
const TEXT_EXTS = ['.txt', '.csv', '.json', '.xml', '.html', '.htm', '.md'];
const CAD_EXTS = ['.dwg', '.dxf', '.rvt', '.ifc', '.skp'];
const OFFICE_EXTS = ['.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt'];

function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return { ext: '.pdf', mime: 'application/pdf' };
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return { ext: '.png', mime: 'image/png' };
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return { ext: '.gif', mime: 'image/gif' };
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer.length >= 12 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return { ext: '.webp', mime: 'image/webp' };
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) return { ext: '.zip', mime: 'application/zip' };
  return null;
}

function extractFromZip(zipPath) {
  const AdmZip = require('adm-zip');
  const extracted = { visual: [], text: [], skipped: [], cad: [] };
  try {
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = path.basename(entry.entryName);
      if (name.startsWith('._') || name.startsWith('.DS_Store') || entry.entryName.includes('__MACOSX') || name.startsWith('.')) continue;
      const ext = path.extname(name).toLowerCase();

      if (VISUAL_EXTS.includes(ext)) {
        try {
          const outPath = path.join(uploadsDir, `${uuidv4()}${ext}`);
          fs.writeFileSync(outPath, entry.getData());
          extracted.visual.push({ path: outPath, name, ext });
        } catch (err) { extracted.skipped.push(name); }
      } else if (TEXT_EXTS.includes(ext)) {
        try { extracted.text.push({ name, content: entry.getData().toString('utf8') }); }
        catch (err) { extracted.skipped.push(name); }
      } else if (CAD_EXTS.includes(ext)) { extracted.cad.push(name); }
      else if (OFFICE_EXTS.includes(ext)) { extracted.skipped.push(name); }
      else {
        try {
          const fileData = entry.getData();
          const detected = detectFileType(fileData);
          if (detected && VISUAL_EXTS.includes(detected.ext)) {
            const outPath = path.join(uploadsDir, `${uuidv4()}${detected.ext}`);
            fs.writeFileSync(outPath, fileData);
            extracted.visual.push({ path: outPath, name: `${name} (detected as ${detected.ext})`, ext: detected.ext });
          } else { extracted.skipped.push(name); }
        } catch (err) { extracted.skipped.push(name); }
      }
    }
  } catch (err) { console.error('[ZIP] Failed:', err.message); }
  return extracted;
}

function fileToContentBlock(filePath, ext) {
  try {
    const data = fs.readFileSync(filePath);
    const base64 = data.toString('base64');
    if (ext === '.pdf') {
      if (data.length > 30 * 1024 * 1024) return null;
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
    }
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    if (mimeMap[ext]) return { type: 'image', source: { type: 'base64', media_type: mimeMap[ext], data: base64 } };
  } catch (err) { console.error(`[File] Error reading ${filePath}:`, err.message); }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// FILE DOWNLOAD ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

router.get('/downloads/:filename', authMiddleware, (req, res) => {
  const filePath = path.join(outputsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const ext = path.extname(req.params.filename).toLowerCase();
  const mimeTypes = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pdf': 'application/pdf',
  };
  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  res.sendFile(filePath);
});

// ═══════════════════════════════════════════════════════════════════════
// CLIENT RATE LIBRARY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

router.get('/my-rates', authMiddleware, (req, res) => {
  try {
    const rates = db.prepare(`
      SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1 ORDER BY category, item_key
    `).all(req.user.id);
    const stats = db.prepare(`
      SELECT COUNT(*) as total, ROUND(AVG(confidence), 2) as avg_confidence, SUM(times_applied) as total_uses
      FROM client_rate_library WHERE user_id = ? AND is_active = 1
    `).get(req.user.id);
    res.json({ rates, stats });
  } catch (err) { res.status(500).json({ error: 'Failed to load rate library' }); }
});

router.post('/my-rates/corrections', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { corrections, raw_message } = req.body;
    if (!corrections || !Array.isArray(corrections)) return res.status(400).json({ error: 'corrections array required' });

    const results = [];
    const tx = db.transaction(() => {
      for (const corr of corrections) {
        const existing = db.prepare(
          `SELECT id, value FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ?`
        ).get(userId, corr.category, corr.item_key);

        if (existing) {
          db.prepare(`UPDATE client_rate_library SET value = ?, client_note = ?, confidence = MIN(confidence + 0.1, 0.95), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(corr.value, corr.note, existing.id);
          db.prepare(`INSERT INTO rate_corrections_log (id, rate_id, user_id, old_value, new_value, correction_source, raw_message) VALUES (?, ?, ?, ?, ?, 'chat', ?)`)
            .run('rc_' + uuidv4().slice(0, 8), existing.id, userId, existing.value, corr.value, raw_message);
          results.push({ display_name: corr.display_name, old: existing.value, new: corr.value, unit: corr.unit, action: 'updated' });
        } else {
          const id = 'rl_' + uuidv4().slice(0, 8);
          db.prepare(`INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, original_value, client_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, userId, corr.category, corr.item_key, corr.display_name || corr.item_key, corr.value, corr.unit, corr.original_value, corr.note);
          db.prepare(`INSERT INTO rate_corrections_log (id, rate_id, user_id, old_value, new_value, correction_source, raw_message) VALUES (?, ?, ?, ?, ?, 'chat', ?)`)
            .run('rc_' + uuidv4().slice(0, 8), id, userId, corr.original_value, corr.value, raw_message);
          results.push({ display_name: corr.display_name, value: corr.value, unit: corr.unit, action: 'created' });
        }
      }
    });
    tx();
    res.json({ results, saved: results.length });
  } catch (err) {
    console.error('[Rates] Correction save error:', err);
    res.status(500).json({ error: 'Failed to save corrections' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// MAIN CHAT ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

router.post('/chat', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const { message, history } = req.body;
    const userId = req.user.id;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

    let messages = [];
    if (history) {
      try { messages = JSON.parse(history).map(msg => ({ role: msg.role, content: msg.content })); } catch (e) {}
    }

    const currentContent = [];
    let fileNames = [];
    let zipNotes = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname).toLowerCase();
        console.log(`[Upload] File: ${file.originalname}, Size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

        if (ext === '.zip') {
          const extracted = extractFromZip(file.path);
          for (const ef of extracted.visual) {
            const block = fileToContentBlock(ef.path, ef.ext);
            if (block) { currentContent.push(block); fileNames.push(ef.name); }
          }
          for (const tf of extracted.text) {
            currentContent.push({ type: 'text', text: `[Content from ${tf.name}]:\n${tf.content}` });
            fileNames.push(tf.name);
          }
          if (extracted.cad.length > 0) zipNotes.push(`Found ${extracted.cad.length} CAD file(s) (${extracted.cad.join(', ')}) -- export as PDF and re-upload.`);
          if (extracted.skipped.length > 0) zipNotes.push(`${extracted.skipped.length} file(s) couldn't be processed: ${extracted.skipped.join(', ')}`);
          if (extracted.visual.length === 0 && extracted.text.length === 0) {
            zipNotes.push(extracted.cad.length > 0
              ? `ZIP only contains CAD files -- export as PDF and upload those instead.`
              : `No supported files in ZIP. Upload PDFs or images directly.`);
          }
        } else {
          const block = fileToContentBlock(file.path, ext);
          if (block) { currentContent.push(block); fileNames.push(file.originalname); }
        }
      }
    }

    let textMessage = message || '';
    if (zipNotes.length > 0) {
      const noteText = zipNotes.join('\n');
      if (textMessage) textMessage = `[Uploaded: ${fileNames.join(', ')}]\n\n${textMessage}\n\n[System: ${noteText}]`;
      else if (fileNames.length > 0) textMessage = `Please analyse these drawings: ${fileNames.join(', ')}\n\n[System: ${noteText}]`;
      else textMessage = `[System: ${noteText}]\n\nLet the user know about the file issue.`;
    } else if (fileNames.length > 0 && !textMessage) {
      textMessage = `Please analyse these construction drawings: ${fileNames.join(', ')}`;
    } else if (fileNames.length > 0) {
      textMessage = `[Uploaded: ${fileNames.join(', ')}]\n\n${textMessage}`;
    }

    if (textMessage) currentContent.push({ type: 'text', text: textMessage });
    if (currentContent.length === 0) return res.status(400).json({ error: 'Please provide a message or upload a file' });

    messages.push({ role: 'user', content: currentContent });

    // ─── Build dynamic system prompt with client rates ───────────
    const systemPrompt = buildSystemPrompt(userId);

    // ─── Smart model routing: Sonnet for drawings, Haiku for text chat ───
    const hasDrawings = fileNames.length > 0;
    const primaryModel = hasDrawings ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
    const primaryBudget = hasDrawings ? 8000 : 5000;
    const fallbackModel = 'claude-haiku-4-5-20251001';
    console.log(`[API] Using ${hasDrawings ? 'Sonnet (drawings detected)' : 'Haiku (text-only chat)'}`);

    const apiHeaders = { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
    const primaryBody = JSON.stringify({
      model: primaryModel, max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: primaryBudget },
      system: systemPrompt, messages
    });

    let response, lastError, usedFallback = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: apiHeaders, body: primaryBody });
      if (response.ok) break;
      lastError = await response.json().catch(() => ({}));
      const isOverloaded = response.status === 529 || lastError?.error?.type === 'overloaded_error';
      if (isOverloaded && attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 3000));
      } else if (!isOverloaded) {
        return res.status(500).json({ error: 'AI service error -- please try again' });
      }
    }

    // If primary model failed and it was Sonnet, fall back to Haiku
    if (!response.ok && primaryModel !== fallbackModel) {
      console.log('[API] Sonnet overloaded, falling back to Haiku...');
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: apiHeaders,
        body: JSON.stringify({
          model: fallbackModel, max_tokens: 16000,
          thinking: { type: 'enabled', budget_tokens: 5000 },
          system: systemPrompt, messages
        })
      });
      if (!response.ok) return res.status(500).json({ error: 'AI service is currently busy -- try again in a few minutes' });
      usedFallback = true;
    } else if (!response.ok) {
      return res.status(500).json({ error: 'AI service is currently busy -- try again in a few minutes' });
    }

    const data = await response.json();
    let thinking = '', reply = '';
    for (const block of data.content) {
      if (block.type === 'thinking') thinking += (thinking ? '\n' : '') + block.thinking;
      else if (block.type === 'text') reply += (reply ? '\n' : '') + block.text;
    }

    if (usedFallback) reply += '\n\n---\n_Note: Response from lighter model due to high demand. Try again later for full analysis._';

    // ─── Get rate library stats ──────────────────────────────────
    let rateStats = null;
    try {
      const s = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(userId);
      if (s && s.total > 0) rateStats = s;
    } catch (e) {}

    res.json({
      reply,
      thinking: thinking || null,
      rateStats,
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong -- please try again' });
  }
});

module.exports = router;

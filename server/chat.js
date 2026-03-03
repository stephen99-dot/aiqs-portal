const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');
const db = require('./database');

let boqGen, findingsGen;
try { boqGen = require('./boqGenerator'); } catch (e) { console.log('[Chat] ExcelJS not installed — BOQ generation disabled. Run: npm install exceljs'); }
try { findingsGen = require('./findingsGenerator'); } catch (e) { console.log('[Chat] docx not installed — Findings generation disabled. Run: npm install docx'); }

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
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DYNAMIC SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════

function buildSystemPrompt(userId, forDocGen) {
  let clientRateSection = '';
  try {
    const rates = db.prepare(`SELECT category, item_key, display_name, value, unit, confidence FROM client_rate_library WHERE user_id = ? AND is_active = 1 ORDER BY category, confidence DESC`).all(userId);
    if (rates.length > 0) {
      const grouped = {};
      for (const r of rates) {
        if (!grouped[r.category]) grouped[r.category] = [];
        const conf = r.confidence >= 0.85 ? 'VERIFIED' : r.confidence >= 0.7 ? 'EMERGING' : 'NEW';
        grouped[r.category].push(`  - ${r.display_name}: ${r.value} ${r.unit} [${conf}]`);
      }
      clientRateSection = `\n=== CLIENT-SPECIFIC TRAINED RATES ===\nUSE THESE instead of generic rates where applicable.\n\n${Object.entries(grouped).map(([cat, items]) => `[${cat}]\n${items.join('\n')}`).join('\n\n')}\n\nFor items NOT covered, use generic UK rates and mark rate_source as "generic".\nClient rates [VERIFIED] -> rate_source: "verified"\nClient rates [EMERGING] -> rate_source: "emerging"\n===\n`;
    }
  } catch (err) { console.error('[Chat] Rate load error:', err.message); }

  if (forDocGen) {
    return `You are an expert UK Quantity Surveyor. You MUST respond with ONLY valid JSON — no markdown, no backticks, no explanation outside the JSON.

GENERIC UK RATES (baseline):
Strip foundations: 85/m | Concrete slab 100mm: 50/m2 | Blockwork below DPC: 62/m2
Cavity wall: 108/m2 | Roof structure: 95/m2 | Roof covering: 52/m2
UPVC windows: 450/ea | Internal doors: 330/ea | Kitchen mid: 11000/ea
Bathroom mid: 6000/ea | Electrical 1st fix: 3500 | Plumbing 1st fix: 2800
Plaster & skim: 22/m2 | Painting: 15/m2 | LVT: 62/m2 | Carpet: 28/m2
Render: 85/m2 | Structural steel S&F: 3500/T
Location: London +20%, Midlands +7%, North -3%, Scotland +3%, Ireland +10% (EUR)
${clientRateSection}
Respond with this JSON structure:
{
  "sections": [
    {
      "number": "1",
      "title": "Section Name",
      "items": [
        { "item": "1.1", "description": "Work item", "unit": "m2", "qty": 24, "rate": 50, "labour": 600, "materials": 600, "total": 1200, "rate_source": "verified|emerging|generic" }
      ]
    }
  ],
  "findings": {
    "reference": "AI-QS-XXXXX",
    "project_type": "e.g. Single Storey Extension",
    "location": "Location",
    "description": "Project description paragraph",
    "scope_summary": "Scope summary paragraph",
    "key_findings": [{ "title": "Category", "detail": "Detail text", "items": ["bullet1"] }],
    "assumptions": ["Assumption 1"],
    "exclusions": ["Exclusion 1"],
    "cost_summary": {
      "sections": [{ "name": "Section Name", "total": 12345.00 }],
      "net_total": 50000.00,
      "contingency_pct": 7.5, "contingency": 3750.00,
      "ohp_pct": 12, "ohp": 6000.00,
      "grand_total": 59750.00
    },
    "recommendations": ["Recommendation 1"]
  }
}
Include ALL measurable items. Be thorough. Every item needs rate_source.`;
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
- London/SE: +15-25%  |  South Wales: baseline  |  Midlands: +5-10%
- North England: -5% to baseline  |  Scotland: baseline to +5%
- Ireland: +5-15% (use EUR)
${clientRateSection}
WHEN ANALYSING DRAWINGS:
- Identify all visible elements, measure/estimate quantities
- List by elemental breakdown
- Apply rates, state assumptions clearly
- Flag anything unclear or missing
- Include section subtotals, contingency (7.5-10%), OH&P (12-15%), VAT
- Tag rate sources where client rates available: "(your verified rate)", "(your rate - calibrating)", "(generic rate)"

After providing your analysis, tell the client you can generate downloadable Excel BOQ and Word Findings Report if they want — just say "generate documents" or "create BOQ".

COMMUNICATION STYLE: Direct, professional, UK construction terminology. Specific numbers. State assumptions. Flag risks. Honest about limitations.

IMPORTANT: Estimates are approximate, subject to detailed measurement and site conditions.`;
}

// ═══════════════════════════════════════════════════════════════════════
// FILE PROCESSING
// ═══════════════════════════════════════════════════════════════════════

const VISUAL_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
const TEXT_EXTS = ['.txt', '.csv', '.json', '.xml', '.html', '.htm', '.md'];
const CAD_EXTS = ['.dwg', '.dxf', '.rvt', '.ifc', '.skp'];
const OFFICE_EXTS = ['.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt'];

function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0]===0x25&&buffer[1]===0x50&&buffer[2]===0x44&&buffer[3]===0x46) return {ext:'.pdf',mime:'application/pdf'};
  if (buffer[0]===0xFF&&buffer[1]===0xD8&&buffer[2]===0xFF) return {ext:'.jpg',mime:'image/jpeg'};
  if (buffer[0]===0x89&&buffer[1]===0x50&&buffer[2]===0x4E&&buffer[3]===0x47) return {ext:'.png',mime:'image/png'};
  if (buffer[0]===0x47&&buffer[1]===0x49&&buffer[2]===0x46&&buffer[3]===0x38) return {ext:'.gif',mime:'image/gif'};
  if (buffer[0]===0x52&&buffer[1]===0x49&&buffer[2]===0x46&&buffer[3]===0x46&&buffer.length>=12&&buffer[8]===0x57&&buffer[9]===0x45&&buffer[10]===0x42&&buffer[11]===0x50) return {ext:'.webp',mime:'image/webp'};
  if (buffer[0]===0x50&&buffer[1]===0x4B) return {ext:'.zip',mime:'application/zip'};
  return null;
}

function extractFromZip(zipPath) {
  const AdmZip = require('adm-zip');
  const extracted = { visual:[], text:[], skipped:[], cad:[] };
  try {
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = path.basename(entry.entryName);
      if (name.startsWith('._')||name.startsWith('.DS_Store')||entry.entryName.includes('__MACOSX')||name.startsWith('.')) continue;
      const ext = path.extname(name).toLowerCase();
      if (VISUAL_EXTS.includes(ext)) {
        try { const op=path.join(uploadsDir,`${uuidv4()}${ext}`); fs.writeFileSync(op,entry.getData()); extracted.visual.push({path:op,name,ext}); }
        catch(e){ extracted.skipped.push(name); }
      } else if (TEXT_EXTS.includes(ext)) {
        try { extracted.text.push({name,content:entry.getData().toString('utf8')}); }
        catch(e){ extracted.skipped.push(name); }
      } else if (CAD_EXTS.includes(ext)) { extracted.cad.push(name); }
      else if (OFFICE_EXTS.includes(ext)) { extracted.skipped.push(name); }
      else {
        try { const fd=entry.getData(); const dt=detectFileType(fd); if(dt&&VISUAL_EXTS.includes(dt.ext)){const op=path.join(uploadsDir,`${uuidv4()}${dt.ext}`);fs.writeFileSync(op,fd);extracted.visual.push({path:op,name:`${name}(${dt.ext})`,ext:dt.ext});}else{extracted.skipped.push(name);}}
        catch(e){extracted.skipped.push(name);}
      }
    }
  } catch(e){ console.error('[ZIP] Failed:',e.message); }
  return extracted;
}

function fileToContentBlock(filePath, ext) {
  try {
    const data = fs.readFileSync(filePath);
    const b64 = data.toString('base64');
    if (ext==='.pdf') { if(data.length>30*1024*1024) return null; return {type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}}; }
    const mm={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
    if (mm[ext]) return {type:'image',source:{type:'base64',media_type:mm[ext],data:b64}};
  } catch(e){}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

// File downloads
router.get('/downloads/:filename', authMiddleware, (req, res) => {
  const fp = path.join(outputsDir, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const ext = path.extname(req.params.filename).toLowerCase();
  const mt = { '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf':'application/pdf' };
  res.setHeader('Content-Type', mt[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  res.sendFile(fp);
});

// Client rate library
router.get('/my-rates', authMiddleware, (req, res) => {
  try {
    const rates = db.prepare(`SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1 ORDER BY category, item_key`).all(req.user.id);
    const stats = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence, SUM(times_applied) as total_uses FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(req.user.id);
    res.json({ rates, stats });
  } catch(e) { res.status(500).json({ error: 'Failed to load rate library' }); }
});

router.post('/my-rates/corrections', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { corrections, raw_message } = req.body;
    if (!corrections || !Array.isArray(corrections)) return res.status(400).json({ error: 'corrections array required' });
    const results = [];
    const tx = db.transaction(() => {
      for (const corr of corrections) {
        const existing = db.prepare(`SELECT id, value FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ?`).get(userId, corr.category, corr.item_key);
        if (existing) {
          db.prepare(`UPDATE client_rate_library SET value = ?, client_note = ?, confidence = MIN(confidence + 0.1, 0.95), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(corr.value, corr.note, existing.id);
          db.prepare(`INSERT INTO rate_corrections_log (id, rate_id, user_id, old_value, new_value, correction_source, raw_message) VALUES (?, ?, ?, ?, ?, 'chat', ?)`).run('rc_'+uuidv4().slice(0,8), existing.id, userId, existing.value, corr.value, raw_message);
          results.push({ display_name: corr.display_name, old: existing.value, new: corr.value, unit: corr.unit, action: 'updated' });
        } else {
          const id = 'rl_'+uuidv4().slice(0,8);
          db.prepare(`INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, original_value, client_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, corr.category, corr.item_key, corr.display_name||corr.item_key, corr.value, corr.unit, corr.original_value, corr.note);
          db.prepare(`INSERT INTO rate_corrections_log (id, rate_id, user_id, old_value, new_value, correction_source, raw_message) VALUES (?, ?, ?, ?, ?, 'chat', ?)`).run('rc_'+uuidv4().slice(0,8), id, userId, corr.original_value, corr.value, raw_message);
          results.push({ display_name: corr.display_name, value: corr.value, unit: corr.unit, action: 'created' });
        }
      }
    });
    tx();
    res.json({ results, saved: results.length });
  } catch(e) { console.error('[Rates]', e); res.status(500).json({ error: 'Failed to save corrections' }); }
});

// ═══════════════════════════════════════════════════════════════════════
// MAIN CHAT ENDPOINT — normal JSON response
// ═══════════════════════════════════════════════════════════════════════

router.post('/chat', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const { message, history } = req.body;
    const userId = req.user.id;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

    let messages = [];
    if (history) { try { messages = JSON.parse(history).map(m => ({ role: m.role, content: m.content })); } catch(e){} }

    const currentContent = [];
    let fileNames = [], zipNotes = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname).toLowerCase();
        console.log(`[Upload] ${file.originalname} (${(file.size/1024/1024).toFixed(2)}MB)`);
        if (ext === '.zip') {
          const ex = extractFromZip(file.path);
          for (const ef of ex.visual) { const b=fileToContentBlock(ef.path,ef.ext); if(b){currentContent.push(b);fileNames.push(ef.name);} }
          for (const tf of ex.text) { currentContent.push({type:'text',text:`[${tf.name}]:\n${tf.content}`});fileNames.push(tf.name); }
          if (ex.cad.length>0) zipNotes.push(`Found ${ex.cad.length} CAD file(s) (${ex.cad.join(', ')}) -- export as PDF and re-upload.`);
          if (ex.skipped.length>0) zipNotes.push(`${ex.skipped.length} file(s) couldn't be processed.`);
          if (ex.visual.length===0&&ex.text.length===0) zipNotes.push(ex.cad.length>0?'ZIP only contains CAD files -- export as PDF.':'No supported files in ZIP.');
        } else {
          const b = fileToContentBlock(file.path, ext);
          if (b) { currentContent.push(b); fileNames.push(file.originalname); }
        }
      }
    }

    let textMessage = message || '';
    if (zipNotes.length > 0) {
      const n = zipNotes.join('\n');
      if (textMessage) textMessage = `[Uploaded: ${fileNames.join(', ')}]\n\n${textMessage}\n\n[System: ${n}]`;
      else if (fileNames.length > 0) textMessage = `Please analyse these drawings: ${fileNames.join(', ')}\n\n[System: ${n}]`;
      else textMessage = `[System: ${n}]\n\nLet the user know about the file issue.`;
    } else if (fileNames.length > 0 && !textMessage) {
      textMessage = `Please analyse these construction drawings: ${fileNames.join(', ')}`;
    } else if (fileNames.length > 0) {
      textMessage = `[Uploaded: ${fileNames.join(', ')}]\n\n${textMessage}`;
    }

    if (textMessage) currentContent.push({ type: 'text', text: textMessage });
    if (currentContent.length === 0) return res.status(400).json({ error: 'Please provide a message or upload a file' });

    messages.push({ role: 'user', content: currentContent });

    // ─── Build prompt & choose model ─────────────────────────────
    const systemPrompt = buildSystemPrompt(userId, false);
    const hasDrawings = fileNames.length > 0;
    const primaryModel = hasDrawings ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
    const primaryBudget = hasDrawings ? 8000 : 5000;
    console.log(`[API] Using ${hasDrawings ? 'Sonnet (drawings)' : 'Haiku (text chat)'}`);

    const apiHeaders = { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };

    let response, usedFallback = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: apiHeaders,
        body: JSON.stringify({ model: primaryModel, max_tokens: 16000, thinking: { type: 'enabled', budget_tokens: primaryBudget }, system: systemPrompt, messages })
      });
      if (response.ok) break;
      const err = await response.json().catch(() => ({}));
      if ((response.status === 529 || err?.error?.type === 'overloaded_error') && attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 3000));
      } else if (response.status !== 529) {
        return res.status(500).json({ error: 'AI service error -- please try again' });
      }
    }
    if (!response.ok && primaryModel !== 'claude-haiku-4-5-20251001') {
      console.log('[API] Sonnet overloaded, falling back to Haiku...');
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: apiHeaders,
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 16000, thinking: { type: 'enabled', budget_tokens: 5000 }, system: systemPrompt, messages })
      });
      if (!response.ok) return res.status(500).json({ error: 'AI service busy -- try again shortly' });
      usedFallback = true;
    } else if (!response.ok) {
      return res.status(500).json({ error: 'AI service busy -- try again shortly' });
    }

    const data = await response.json();
    let thinking = '', reply = '';
    for (const block of data.content) {
      if (block.type === 'thinking') thinking += (thinking ? '\n' : '') + block.thinking;
      else if (block.type === 'text') reply += (reply ? '\n' : '') + block.text;
    }
    if (usedFallback) reply += '\n\n---\n_Response from lighter model due to high demand._';

    // ─── Check if user wants document generation ─────────────────
    const wantsDocuments = /generat|create|produce|download|excel|boq|xlsx|docx|findings report|make.*report|make.*boq|give.*me.*the.*document/i.test(message || '');
    let downloadFiles = null;

    if (wantsDocuments && boqGen && findingsGen) {
      console.log('[Docs] User requested documents — generating structured data...');

      const clientName = req.user.full_name || req.user.email;
      let projectName = 'Project';
      const nm = reply.match(/(?:project|extension|conversion|renovation|build|works?)\s*(?:at|for|:)?\s*([A-Z][^\n,]{3,40})/i) || reply.match(/#+\s*.*?(?:ESTIMATE|BOQ|COST).*?:\s*(.+)/i);
      if (nm) projectName = nm[1].trim();

      const convMessages = messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      })).filter(m => m.content);
      convMessages.push({ role: 'assistant', content: reply });

      try {
        const docPrompt = buildSystemPrompt(userId, true);
        const structuredMessages = [
          ...convMessages,
          { role: 'user', content: 'Produce the complete structured JSON for the BOQ and findings report. Include every line item. Be thorough.' }
        ];

        const docResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: apiHeaders,
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, system: docPrompt, messages: structuredMessages })
        });

        if (docResp.ok) {
          const docData = await docResp.json();
          const rawText = docData.content.filter(c => c.type === 'text').map(c => c.text).join('');
          const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          const parsed = JSON.parse(cleaned);
          const safeName = projectName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 50);
          const ts = Date.now();
          downloadFiles = [];

          // Excel BOQ
          const sections = parsed.sections || [];
          if (sections.length > 0) {
            console.log('[Docs] Building Excel BOQ...');
            const buf = await boqGen.generateBOQExcel(sections, projectName, clientName, {
              contingency_pct: parsed.findings?.cost_summary?.contingency_pct || 7.5,
              ohp_pct: parsed.findings?.cost_summary?.ohp_pct || 12,
              vat_rate: parsed.findings?.cost_summary?.vat_rate || 20,
            });
            const fname = `BOQ-${safeName}-${ts}.xlsx`;
            fs.writeFileSync(path.join(outputsDir, fname), buf);
            downloadFiles.push({ name: fname, type: 'xlsx', url: `/api/downloads/${fname}` });
            console.log(`[Docs] Excel: ${fname} (${(buf.length/1024).toFixed(1)}KB)`);
          }

          // Word Findings Report
          console.log('[Docs] Building Findings Report...');
          const findings = parsed.findings || {};
          const docBuf = await findingsGen.generateFindingsReport(findings, clientName, projectName);
          const docName = `Findings-${safeName}-${ts}.docx`;
          fs.writeFileSync(path.join(outputsDir, docName), docBuf);
          downloadFiles.push({ name: docName, type: 'docx', url: `/api/downloads/${docName}` });
          console.log(`[Docs] Word: ${docName} (${(docBuf.length/1024).toFixed(1)}KB)`);

          if (downloadFiles.length > 0) {
            reply += '\n\n---\n📥 **Your documents are ready for download:**';
            for (const f of downloadFiles) reply += `\n${f.type === 'xlsx' ? '📊' : '📄'} ${f.name}`;
          }
        } else {
          console.error('[Docs] Structured API call failed:', docResp.status);
        }
      } catch (e) {
        console.error('[Docs] Generation error:', e.message);
      }
    } else if (hasDrawings && !wantsDocuments) {
      reply += '\n\n---\n💡 _Want downloadable documents? Just say **"generate documents"** and I\'ll create an Excel BOQ and Word Findings Report._';
    }

    // ─── Rate stats ──────────────────────────────────────────────
    let rateStats = null;
    try {
      const s = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(userId);
      if (s && s.total > 0) rateStats = s;
    } catch(e) {}

    res.json({ reply, thinking: thinking || null, rateStats, files: downloadFiles });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong -- please try again' });
  }
});

module.exports = router;

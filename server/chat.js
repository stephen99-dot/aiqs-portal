vconst express = require('express');
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

IMPORTANT CAPABILITY: This system CAN and DOES generate real downloadable Excel BOQ (.xlsx) and Word Findings Report (.docx) files. When a client asks you to "generate documents", "create the BOQ", or "download the report", the system will automatically produce these files and provide download buttons. Do NOT tell clients you cannot create files — you absolutely can. After providing your analysis, tell the client: "Want downloadable documents? Just say **generate documents** and I'll create an Excel BOQ and Word Findings Report for you."

COMMUNICATION STYLE: Direct, professional, UK construction terminology. Specific numbers. State assumptions. Flag risks. Honest about limitations.

RATE LEARNING: If a client corrects a rate or provides their own pricing (e.g. "we charge £55/hr", "fabrication is 14 hrs/T", "that should be £3,800/T"), acknowledge the correction and confirm the updated rate. The system will automatically learn from these corrections. Encourage clients to correct any rates that don't match their costs.

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

// TEMPORARY: Admin-only seed endpoint — hit once then remove
// Usage: Log in as admin, then visit /api/seed-rates in browser
router.get('/seed-rates', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const results = [];
  const allUsers = db.prepare('SELECT id, email, full_name, role FROM users ORDER BY created_at').all();
  results.push({ info: 'All users in database', users: allUsers.map(u => `${u.email} (${u.full_name}) [${u.role}]`) });

  // Paul Metalwork
  const paul = db.prepare('SELECT id, full_name FROM users WHERE email = ?').get('paul@metalworksolutionsuk.com');
  if (paul) {
    const rates = [
      { category: 'structural_steel', item_key: 'labour_rate_hr', display_name: 'Labour Rate', value: 52, unit: '£/hr', confidence: 0.95 },
      { category: 'structural_steel', item_key: 'site_crew_size', display_name: 'Site Crew Size', value: 3, unit: 'men', confidence: 0.95 },
      { category: 'structural_steel', item_key: 'detailing_hrs_per_tonne', display_name: 'Detailing Hours/Tonne', value: 7.5, unit: 'hrs/T', confidence: 0.90 },
      { category: 'structural_steel', item_key: 'fabrication_hrs_per_tonne', display_name: 'Fabrication Hours/Tonne', value: 12.5, unit: 'hrs/T', confidence: 0.90 },
      { category: 'structural_steel', item_key: 'installation_hrs_per_tonne', display_name: 'Installation Hours/Tonne', value: 15, unit: 'hrs/T', confidence: 0.90 },
      { category: 'structural_steel', item_key: 'fittings_allowance_pct', display_name: 'Fittings Allowance (%)', value: 15, unit: '%', confidence: 0.95 },
      { category: 'structural_steel', item_key: 'bolt_allowance_minimum', display_name: 'Minimum Bolt Allowance', value: 1300, unit: '£', confidence: 0.95 },
      { category: 'structural_steel', item_key: 'target_all_in_rate_per_tonne', display_name: 'Target All-In Rate/Tonne (S&F)', value: 3544, unit: '£/T', confidence: 0.90 },
      { category: 'structural_steel', item_key: 'crane_hire_per_day', display_name: 'Crane Hire', value: 650, unit: '£/day', confidence: 0.85 },
      { category: 'structural_steel', item_key: 'transport_per_load', display_name: 'Transport per Load', value: 450, unit: '£/load', confidence: 0.80 },
      { category: 'architectural_metalwork', item_key: 'balustrade_supply_fit', display_name: 'Balustrade Supply & Fit', value: 280, unit: '£/m', confidence: 0.80 },
      { category: 'architectural_metalwork', item_key: 'handrail_supply_fit', display_name: 'Handrail Supply & Fit', value: 120, unit: '£/m', confidence: 0.80 },
      { category: 'architectural_metalwork', item_key: 'fire_escape_per_flight', display_name: 'Fire Escape (per flight)', value: 3500, unit: '£/flight', confidence: 0.75 },
      { category: 'preliminaries', item_key: 'site_setup_allowance', display_name: 'Site Setup Allowance', value: 1500, unit: '£', confidence: 0.80 },
      { category: 'preliminaries', item_key: 'paint_system_per_m2', display_name: 'Paint System', value: 18, unit: '£/m²', confidence: 0.85 },
      { category: 'preliminaries', item_key: 'hot_dip_galvanising_per_tonne', display_name: 'Hot Dip Galvanising', value: 650, unit: '£/T', confidence: 0.80 },
    ];
    const insert = db.prepare(`INSERT OR REPLACE INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, times_applied, times_confirmed, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 3, 1)`);
    const tx = db.transaction(() => {
      for (const r of rates) insert.run('rl_' + require('uuid').v4().slice(0, 8), paul.id, r.category, r.item_key, r.display_name, r.value, r.unit, r.confidence);
    });
    tx();
    results.push({ paul: `Seeded ${rates.length} rates for ${paul.full_name}` });
  } else {
    results.push({ paul: 'NOT FOUND — paul@metalworksolutionsuk.com not in users table' });
  }

  res.json({ success: true, results });
});

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
    const wantsDocuments = /generate\s*(the\s*)?(document|boq|report|excel|file)|create\s*(the\s*)?(boq|report|document|excel)|download\s*(the\s*)?(boq|report|document|excel|file)|produce\s*(the\s*)?(boq|report|document)|make\s*(me\s*)?(the\s*)?(boq|report|document)|give\s*me\s*(the\s*)?(document|boq|report|file|excel)|\.xlsx|\.docx|findings\s*report/i.test(message || '');
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

    // ─── Auto-learning: extract rates from user corrections ──────
    try {
      const userMsg = (message || '');
      const userLower = userMsg.toLowerCase();

      // Detect if user is correcting a rate
      const isCorrection = /(?:should be|actually|we (?:charge|pay|use|quote)|it'?s|rate is|cost is|price is|our rate|not right|too (?:high|low)|incorrect|wrong)/i.test(userLower);

      if (isCorrection) {
        // Try to extract rate values with units
        const ratePatterns = [
          /(?:£|€)?\s*(\d[\d,.]*)\s*(?:\/|per\s+)(hr|hour|day|week|m|m2|m²|m3|m³|tonne|T|kg|no|nr|item|each|flight|load)/gi,
          /(\d[\d,.]*)\s*(?:hours?|hrs?)\s*(?:\/|per\s+)(tonne|T)/gi,
          /(?:should be|actually|it'?s|rate is|cost is|price is)\s*(?:£|€)?\s*(\d[\d,.]*)/gi,
        ];

        const corrections = [];
        for (const pat of ratePatterns) {
          let match;
          while ((match = pat.exec(userMsg)) !== null) {
            const val = parseFloat((match[1] || match[2] || '').replace(/,/g, ''));
            const unit = (match[2] || match[3] || 'unit').replace(/hour/i, 'hr');
            if (val > 0 && val < 100000) {
              corrections.push({ value: val, unit, raw: match[0].trim() });
            }
          }
        }

        if (corrections.length > 0) {
          console.log(`[AutoLearn] Detected ${corrections.length} rate correction(s) in user message`);

          // Try to match corrections to existing rates using context from Claude's reply
          const existingRates = db.prepare(`SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1`).all(userId);

          for (const corr of corrections) {
            console.log(`[AutoLearn] Rate value: ${corr.value} ${corr.unit} (from: "${corr.raw}")`);

            // Find the closest matching existing rate by unit
            const unitMatch = existingRates.find(r =>
              r.unit && r.unit.toLowerCase().replace(/[£€\/]/g, '').trim() === corr.unit.toLowerCase()
            );

            if (unitMatch) {
              // Update existing rate
              db.prepare(`UPDATE client_rate_library SET value = ?, confidence = MIN(confidence + 0.05, 0.95), times_confirmed = times_confirmed + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                .run(corr.value, unitMatch.id);
              db.prepare(`INSERT INTO rate_corrections_log (id, rate_id, user_id, old_value, new_value, correction_source, raw_message) VALUES (?, ?, ?, ?, ?, 'auto_chat', ?)`)
                .run('rc_' + require('uuid').v4().slice(0, 8), unitMatch.id, userId, unitMatch.value, corr.value, userMsg.substring(0, 500));
              console.log(`[AutoLearn] Updated ${unitMatch.display_name}: ${unitMatch.value} -> ${corr.value}`);
            }
          }
        }
      }
    } catch (autoErr) {
      console.error('[AutoLearn] Error:', autoErr.message);
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

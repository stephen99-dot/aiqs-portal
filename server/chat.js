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

IMPORTANT CAPABILITY: This system CAN and DOES generate real downloadable Excel BOQ (.xlsx) and Word Findings Report (.docx) files. When a client asks you to "generate documents", "create the BOQ", or "download the report", the system will automatically produce these files and provide download buttons. Do NOT tell clients you cannot create files — you absolutely can. After providing your analysis, tell the client: "Want downloadable documents? Just say **generate documents** and I'll create an Excel BOQ and Word Findings Report for you."

COMMUNICATION STYLE: Direct, professional, UK construction terminology. Specific numbers. State assumptions. Flag risks. Honest about limitations.

RATE LEARNING: If a client corrects a rate or provides their own pricing (e.g. "we charge £55/hr", "fabrication is 14 hrs/T", "that should be £3,800/T"), acknowledge the correction and confirm the updated rate. The system will automatically learn from these corrections. Encourage clients to correct any rates that don't match their costs.

RATE TAGS (CRITICAL - always include these when rates are mentioned):
When a client provides a NEW rate that isn't in their library, or corrects an existing rate, you MUST include a hidden tag at the END of your response on its own line. The client won't see these tags but the system uses them to update the rate library.

For NEW rates the client provides:
[RATE_ADD|category|Rate Name|value|unit]

For CORRECTIONS to existing rates:
[RATE_UPDATE|Rate Name|new_value]

Examples:
- Client says "we charge £60/hr for welding" -> include: [RATE_ADD|structural_steel|Welding Labour Rate|60|/hr]
- Client says "add crane hire at £700 per day" -> include: [RATE_ADD|preliminaries|Crane Hire|700|/day]
- Client says "balustrade is 262 not 280" -> include: [RATE_UPDATE|Balustrade Supply & Fit|262]
- Client says "labour should be £55/hr" -> include: [RATE_UPDATE|Labour Rate|55]
- Client says "you're missing scaffolding, we pay £25/m2" -> include: [RATE_ADD|preliminaries|Scaffolding|25|/m2]

Valid categories: structural_steel, architectural_metalwork, preliminaries, groundworks, masonry, carpentry, roofing, plastering, flooring, electrical, plumbing, mechanical, decorating, kitchen, bathroom, demolition, partitions, general

Always include the tag AND acknowledge the rate to the client naturally. Multiple tags are fine if multiple rates are mentioned.

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

    // --- Account suspension check ---
    if (req.user.suspended) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.', suspended: true, reason: req.user.suspended_reason || null });
    }

    // --- Quota check ---
    const PLAN_LIMITS = {
      starter:      { messages: 10,  docs: 0,   revisions_per_doc: 1, label: 'Starter', pay_per_doc: true, doc_price: 99 },
      professional: { messages: 100, docs: 10,  revisions_per_doc: 1, label: 'Professional' },
      premium:      { messages: 200, docs: 20,  revisions_per_doc: 1, label: 'Premium' },
      admin:        { messages: -1,  docs: -1,  revisions_per_doc: -1, label: 'Admin' },
    };
    if (req.user.role !== 'admin') {
      const plan = req.user.plan || 'starter';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
      var bonusMsgs = req.user.bonus_messages || 0;
      var effectiveLimit = limits.messages + bonusMsgs;
      if (effectiveLimit > 0) {
        var mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
        var monthStr = mStart.toISOString();
        var used = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message' AND created_at>=?").get(userId, monthStr);
        if (used.c >= effectiveLimit) {
          return res.status(429).json({
            error: 'Monthly message limit reached (' + effectiveLimit + ' messages on ' + limits.label + ' plan). Upgrade your plan for more.',
            limit_type: 'messages',
            used: used.c,
            limit: effectiveLimit,
            plan: plan
          });
        }
      }
    }

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

    // --- Log usage ---
    const tokensIn = data.usage ? data.usage.input_tokens : 0;
    const tokensOut = data.usage ? data.usage.output_tokens : 0;
    const modelUsed = usedFallback ? 'claude-haiku-4-5-20251001' : primaryModel;
    const costPerIn = modelUsed.includes('haiku') ? 0.0000008 : 0.000003;
    const costPerOut = modelUsed.includes('haiku') ? 0.000004 : 0.000015;
    const costEstimate = (tokensIn * costPerIn) + (tokensOut * costPerOut);
    try {
      db.prepare('INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        'ul_' + uuidv4().slice(0, 8), userId, 'chat_message', (message || '').substring(0, 200), modelUsed, tokensIn, tokensOut, costEstimate
      );
    } catch(ue) { console.error('[Usage] Log error:', ue.message); }

    let thinking = '', reply = '';
    for (const block of data.content) {
      if (block.type === 'thinking') thinking += (thinking ? '\n' : '') + block.thinking;
      else if (block.type === 'text') reply += (reply ? '\n' : '') + block.text;
    }
    if (usedFallback) reply += '\n\n---\n_Response from lighter model due to high demand._';

    // ─── Check if user wants document generation ─────────────────
    const wantsDocumentsRaw = /generate\s*(the\s*)?(document|boq|report|excel|file)|create\s*(the\s*)?(boq|report|document|excel)|download\s*(the\s*)?(boq|report|document|excel|file)|produce\s*(the\s*)?(boq|report|document)|make\s*(me\s*)?(the\s*)?(boq|report|document)|give\s*me\s*(the\s*)?(document|boq|report|file|excel)|\.xlsx|\.docx|findings\s*report/i.test(message || '');
    let wantsDocuments = wantsDocumentsRaw;
    let downloadFiles = null;

    // Doc generation quota check
    if (wantsDocuments && req.user.role !== 'admin') {
      var dPlan = req.user.plan || 'starter';
      var dStart2 = new Date(); dStart2.setDate(1); dStart2.setHours(0,0,0,0);
      var dMonthStr = dStart2.toISOString();
      var docsGenThisMonth = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(userId, dMonthStr).c;
      var revisionsThisMonth = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND created_at>=?").get(userId, dMonthStr).c;

      if (dPlan === 'starter') {
        // Starter: pay-per-BOQ. Check paid credits.
        var paidCredits = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_paid'").get(userId).c;
        var totalDocsEver = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated'").get(userId).c;
        var totalRevisionsEver = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision'").get(userId).c;
        var originalsEver = totalDocsEver - totalRevisionsEver;
        // Each paid credit = 1 original + 1 revision
        var lastDocDetail = db.prepare("SELECT detail FROM usage_log WHERE user_id=? AND action='doc_generated' ORDER BY created_at DESC LIMIT 1").get(userId);
        // Check if this might be a revision (same project name in recent context)
        var looksLikeRevision = lastDocDetail && totalDocsEver > 0 && /revis|redo|regenerat|update.*doc|fix.*rate/i.test(message || '');

        if (looksLikeRevision && totalRevisionsEver < paidCredits) {
          // Allow as revision
          console.log('[Quota] Starter revision allowed');
        } else if (originalsEver >= paidCredits) {
          // No credit left - show payment link
          var stripeLink = process.env.STRIPE_BOQ_PAYMENT_LINK || 'https://buy.stripe.com/YOUR_LINK';
          reply += '\n\n---\n**To generate your BOQ and Findings Report, a one-off payment of \u00a399 is required.**\n\n[Pay \u00a399 to generate documents](' + stripeLink + '?client_reference_id=' + userId + ')\n\nThis includes:\n- Full Excel BOQ with your trained rates\n- Professional Findings Report\n- 1 revision if rates need adjusting\n\nOnce payment is confirmed, just say **\"generate documents\"** again.';
          wantsDocuments = false;
        }
      } else {
        // Professional: 10 docs, Premium: 20 docs
        var docLimit = dPlan === 'premium' ? 20 : 10;
        var originalsThisMonth = docsGenThisMonth - revisionsThisMonth;
        // Check if this is a revision
        var lastDoc2 = db.prepare("SELECT detail FROM usage_log WHERE user_id=? AND action='doc_generated' ORDER BY created_at DESC LIMIT 1").get(userId);
        var isRevisionCheck = lastDoc2 && /revis|redo|regenerat|update.*doc|fix.*rate/i.test(message || '');
        if (isRevisionCheck) {
          // Count revisions for last project
          var lastProject = lastDoc2.detail;
          var projectRevisions = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND detail=?").get(userId, lastProject).c;
          if (projectRevisions >= 1) {
            reply += '\n\n---\nRevision limit reached for this project (1 revision included per BOQ).';
            wantsDocuments = false;
          }
        } else if (originalsThisMonth >= docLimit) {
          reply += '\n\n---\nDocument limit reached (' + docLimit + ' BOQs on ' + dPlan + ' plan this month).';
          wantsDocuments = false;
        }
      }
    }

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

            // Auto-save project to history
            try {
              var totalVal = 0, itemCount = 0;
              if (parsed.sections) { for (var si=0;si<parsed.sections.length;si++) { var sec=parsed.sections[si]; if(sec.items){for(var ii=0;ii<sec.items.length;ii++){totalVal+=parseFloat(sec.items[ii].total)||0;itemCount++;}} } }
              var summaryText = (parsed.findings && parsed.findings.executive_summary) || '';
              var boqF = downloadFiles.find(function(f){return f.type==='xlsx';});
              var docF = downloadFiles.find(function(f){return f.type==='docx';});
              db.prepare('INSERT INTO chat_projects (id,user_id,title,total_value,currency,boq_filename,findings_filename,summary,item_count) VALUES(?,?,?,?,?,?,?,?,?)').run(
                'cp_'+uuidv4().slice(0,8),userId,projectName,totalVal,reply.includes('EUR')?'EUR':'GBP',boqF?boqF.name:null,docF?docF.name:null,summaryText.substring(0,1000),itemCount
              );
              db.prepare('INSERT INTO usage_log (id,user_id,action,detail,model_used,tokens_in,tokens_out,cost_estimate) VALUES(?,?,?,?,?,?,?,?)').run(
                'ul_'+uuidv4().slice(0,8),userId,'doc_generated',projectName,modelUsed||'sonnet',0,0,0
              );
              console.log('[Project] Saved: '+projectName+' ('+itemCount+' items, '+totalVal.toFixed(0)+')');
            } catch(pe) { console.error('[Project] Save error:', pe.message); }
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

    // --- Auto-learning: extract rates from user corrections ---
    try {
      const userMsg = (message || '');
      const userLower = userMsg.toLowerCase();
      const isCorrection = /(?:should be|actually|we (?:charge|pay|use|quote)|rate is|cost is|price is|our rate|not right|too (?:high|low)|incorrect|wrong|instead of|changed to|now \d|is \d+\s*(?:not|instead))/i.test(userLower);
      if (isCorrection) {
        console.log('[AutoLearn] Correction detected: ' + userMsg.substring(0, 100));
        const existingRates = db.prepare('SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
        if (existingRates.length > 0) {
          let bestMatch = null, bestScore = 0;
          for (const rate of existingRates) {
            const nameWords = rate.display_name.toLowerCase().split(/[\s&,\/\-]+/).filter(w => w.length > 2);
            let score = 0;
            for (const word of nameWords) { if (userLower.includes(word)) score++; }
            const keyParts = rate.item_key.split('_').filter(w => w.length > 2);
            for (const part of keyParts) { if (userLower.includes(part)) score += 0.5; }
            if (score > bestScore) { bestScore = score; bestMatch = rate; }
          }
          let newValue = null;
          const np = [/(?:should be|actually|is|to|now|changed to)\s*(?:\u00a3|\u20ac)?\s*(\d[\d,.]*)(?!\d)/i, /(\d[\d,.]*)\s*(?:not|instead of)\s*\d/i];
          for (const pat of np) { const m = userMsg.match(pat); if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v>0&&v<1000000){newValue=v;break;} } }
          if (!newValue) { const nums = userMsg.match(/\d[\d,.]*(?:\.\d+)?/g); if (nums) newValue = parseFloat(nums[0].replace(/,/g,'')); }
          if (bestMatch && bestScore >= 1 && newValue && newValue !== bestMatch.value) {
            console.log('[AutoLearn] Match: ' + bestMatch.display_name + ' score:' + bestScore + ' ' + bestMatch.value + '->' + newValue);
            db.prepare('UPDATE client_rate_library SET value=?,confidence=MIN(confidence+0.05,0.95),times_confirmed=times_confirmed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newValue, bestMatch.id);
            db.prepare('INSERT INTO rate_corrections_log(id,rate_id,user_id,old_value,new_value,correction_source,raw_message)VALUES(?,?,?,?,?,?,?)').run('rc_'+require('uuid').v4().slice(0,8),bestMatch.id,userId,bestMatch.value,newValue,'auto_chat',userMsg.substring(0,500));
            console.log('[AutoLearn] Updated ' + bestMatch.display_name);
          } else { console.log('[AutoLearn] No match. Best:' + (bestMatch?bestMatch.display_name:'none') + ' score:' + bestScore + ' val:' + newValue); }
        }
      }
    } catch (autoErr) { console.error('[AutoLearn]', autoErr.message); }

    // --- Parse RATE_ADD and RATE_UPDATE tags from Claude reply ---
    try {
      var addMatches = reply.match(/\[RATE_ADD\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/g) || [];
      for (var ai = 0; ai < addMatches.length; ai++) {
        var parts = addMatches[ai].replace(/^\[RATE_ADD\|/, '').replace(/\]$/, '').split('|');
        if (parts.length === 4) {
          var cat = parts[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
          var rName = parts[1].trim();
          var rVal = parseFloat(parts[2].trim().replace(/[^0-9.\-]/g, ''));
          var rUnit = parts[3].trim();
          if (rName && !isNaN(rVal) && rVal > 0 && rUnit) {
            var itemKey = rName.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 100);
            var exists = db.prepare('SELECT id FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ? AND is_active = 1').get(userId, cat, itemKey);
            if (!exists) {
              var rateId = 'rl_' + require('uuid').v4().slice(0, 8);
              db.prepare('INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.75, 1)').run(rateId, userId, cat, itemKey, rName, rVal, rUnit);
              console.log('[RateTag] ADD: ' + rName + ' = ' + rVal + ' ' + rUnit + ' (' + cat + ')');
            } else {
              db.prepare('UPDATE client_rate_library SET value = ?, unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(rVal, rUnit, exists.id);
              console.log('[RateTag] ADD (exists, updated): ' + rName + ' = ' + rVal);
            }
          }
        }
      }
      var updateMatches = reply.match(/\[RATE_UPDATE\|([^|]+)\|([^\]]+)\]/g) || [];
      for (var ui = 0; ui < updateMatches.length; ui++) {
        var uParts = updateMatches[ui].replace(/^\[RATE_UPDATE\|/, '').replace(/\]$/, '').split('|');
        if (uParts.length === 2) {
          var uName = uParts[0].trim().toLowerCase();
          var uVal = parseFloat(uParts[1].trim().replace(/[^0-9.\-]/g, ''));
          if (uName && !isNaN(uVal) && uVal > 0) {
            var allRates = db.prepare('SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
            var found = null;
            for (var ri = 0; ri < allRates.length; ri++) {
              if (allRates[ri].display_name.toLowerCase() === uName || allRates[ri].item_key === uName.replace(/[^a-z0-9]+/g, '_')) { found = allRates[ri]; break; }
            }
            if (!found) {
              for (var ri2 = 0; ri2 < allRates.length; ri2++) {
                var words = uName.split(/[\s&,\/\-]+/).filter(function(w){return w.length>2;});
                var sc = 0;
                for (var wi = 0; wi < words.length; wi++) { if (allRates[ri2].display_name.toLowerCase().includes(words[wi])) sc++; }
                if (sc >= 2) { found = allRates[ri2]; break; }
              }
            }
            if (found && uVal !== found.value) {
              db.prepare('UPDATE client_rate_library SET value=?,confidence=MIN(confidence+0.05,0.95),times_confirmed=times_confirmed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(uVal, found.id);
              db.prepare('INSERT INTO rate_corrections_log(id,rate_id,user_id,old_value,new_value,correction_source,raw_message)VALUES(?,?,?,?,?,?,?)').run('rc_'+require('uuid').v4().slice(0,8),found.id,userId,found.value,uVal,'tag_update',reply.substring(0,200));
              console.log('[RateTag] UPDATE: ' + found.display_name + ' ' + found.value + ' -> ' + uVal);
            }
          }
        }
      }
      // Strip tags from reply
      reply = reply.replace(/\[RATE_ADD\|[^\]]*\]/g, '').replace(/\[RATE_UPDATE\|[^\]]*\]/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    } catch (tagErr) { console.error('[RateTag] Error:', tagErr.message); }




    // ─── Rate stats ──────────────────────────────────────────────
    let rateStats = null;
    try {
      const s = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(userId);
      if (s && s.total > 0) rateStats = s;
    } catch(e) {}

    // --- Quota info for frontend ---
    let quotaInfo = null;
    if (req.user.role !== 'admin') {
      var qPlan = req.user.plan || 'starter';
      var qStart = new Date(); qStart.setDate(1); qStart.setHours(0,0,0,0);
      var qMonth = qStart.toISOString();
      var qMsgs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message' AND created_at>=?").get(userId, qMonth).c;
      var qDocs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(userId, qMonth).c;
      var qRevs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND created_at>=?").get(userId, qMonth).c;
      var qMsgLimit = qPlan === 'starter' ? 10 : qPlan === 'professional' ? 100 : 200;
      var qDocLimit = qPlan === 'starter' ? 0 : qPlan === 'professional' ? 10 : 20;
      quotaInfo = { plan: qPlan, messages_used: qMsgs, messages_limit: qMsgLimit, docs_used: qDocs - qRevs, docs_limit: qDocLimit, revisions_used: qRevs, pay_per_doc: qPlan === 'starter' };
    }

    res.json({ reply, thinking: thinking || null, rateStats, files: downloadFiles, quota: quotaInfo });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong -- please try again' });
  }
});

module.exports = router;

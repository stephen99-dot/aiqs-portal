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

// ── Ensure chat_sessions table exists ────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      messages TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (e) { console.error('[DB] chat_sessions table error:', e.message); }

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
// SERVER-SIDE INSIGHT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

function extractInsightsFromMessage(userId, message) {
  if (!message || message.length < 5) return;

  const msg = message.trim();
  const lower = msg.toLowerCase();

  const patterns = [
    // Supplier patterns
    { regex: /we (?:always |usually |typically )?(?:use|buy from|get .+? from|source from|order from)\s+([A-Z][a-zA-Z\s&]+?)(?:\s+for|\s+as|\s+when|\.|\,|$)/i, category: 'supplier', template: m => `Client uses ${m[1].trim()} as supplier` },
    { regex: /(?:our|my) (?:main |preferred |usual )?supplier(?:s)? (?:is|are)\s+([A-Z][a-zA-Z\s&,]+?)(?:\.|,|$)/i, category: 'supplier', template: m => `Client supplier: ${m[1].trim()}` },
    { regex: /(?:we|I) (?:prefer|go with|stick with|always go to)\s+([A-Z][a-zA-Z\s&]+?)(?:\s+for|\s+when|\.|\,|$)/i, category: 'supplier', template: m => `Client prefers ${m[1].trim()}` },

    // Spec preference patterns
    { regex: /we (?:always |usually |typically )?use\s+(.{5,60}?)\s+(?:for|as|on|in)\s+(?:all|our|every)/i, category: 'spec_preference', template: m => `Client spec: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:standard|usual|default|preferred)\s+(?:spec|specification|finish|material) (?:is|for .+? is)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'spec_preference', template: m => `Standard spec: ${m[1].trim()}` },
    { regex: /we (?:don't|do not|never) use\s+(.{5,60}?)(?:\.|,|$)/i, category: 'spec_preference', template: m => `Client excludes: ${m[1].trim()}` },

    // Markup / commercial patterns
    { regex: /(?:our|my|we use a?)\s+(?:markup|margin|overhead|oh&p|ohp) (?:is|of)\s+(\d+(?:\.\d+)?%?)/i, category: 'markup', template: m => `Client markup: ${m[1].trim()}` },
    { regex: /we (?:charge|quote|add)\s+(\d+(?:\.\d+)?%?)\s+(?:markup|margin|overhead|for overhead)/i, category: 'markup', template: m => `Client markup: ${m[1].trim()}` },

    // Geography patterns
    { regex: /we (?:mainly|mostly|only|primarily) work (?:in|around|across)\s+(.{5,60}?)(?:\.|,|$)/i, category: 'geography', template: m => `Client works in: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:area|region|patch|territory) is\s+(.{5,60}?)(?:\.|,|$)/i, category: 'geography', template: m => `Client area: ${m[1].trim()}` },

    // Project type patterns
    { regex: /we (?:specialise|specialize|focus|mainly do|mostly do) (?:in|on)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'project_type', template: m => `Client speciality: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:main|typical|usual) (?:work|projects?) (?:is|are|involve)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'project_type', template: m => `Typical projects: ${m[1].trim()}` },

    // Team / crew patterns
    { regex: /(?:our|my) (?:team|crew|gang) (?:is|are|has|have)\s+(.{5,60}?)(?:\.|,|$)/i, category: 'team', template: m => `Client team: ${m[1].trim()}` },
    { regex: /we have\s+(\d+\s+(?:men|guys|workers|operatives|people|carpenters|bricklayers|labourers))/i, category: 'team', template: m => `Team size: ${m[1].trim()}` },

    // Exclusion patterns
    { regex: /(?:we|I) (?:don't|do not|never|won't|will not) (?:include|cover|do|price|quote for)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'exclusion', template: m => `Client exclusion: ${m[1].trim()}` },
    { regex: /(?:always |please )?exclude\s+(.{5,80}?)\s+(?:from|in) (?:all|our|every|the)/i, category: 'exclusion', template: m => `Always exclude: ${m[1].trim()}` },
  ];

  const validCategories = ['spec_preference','markup','supplier','scope','geography','trade','standard','feedback','workflow','exclusion','team','project_type','commercial'];

  for (const pattern of patterns) {
    const match = msg.match(pattern.regex);
    if (!match) continue;

    let insightText;
    try { insightText = pattern.template(match); } catch (e) { continue; }

    if (!insightText || insightText.length < 8 || insightText.length > 300) continue;
    if (!validCategories.includes(pattern.category)) continue;

    try {
      const existing = db.prepare('SELECT id, insight, times_reinforced FROM client_insights WHERE user_id = ? AND category = ?').all(userId, pattern.category);
      let isDuplicate = false;

      for (const ex of existing) {
        const existWords = ex.insight.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const newWords = insightText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const overlap = existWords.filter(w => newWords.includes(w)).length;
        if (overlap / Math.max(existWords.length, 1) > 0.5) {
          db.prepare('UPDATE client_insights SET times_reinforced = times_reinforced + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ex.id);
          isDuplicate = true;
          console.log(`[Insight] Reinforced: ${ex.insight}`);
          break;
        }
      }

      if (!isDuplicate) {
        db.prepare('INSERT INTO client_insights (id, user_id, category, insight) VALUES (?, ?, ?, ?)').run(
          'ins_' + uuidv4().slice(0, 8), userId, pattern.category, insightText
        );
        console.log(`[Insight] Saved: [${pattern.category}] ${insightText}`);
      }
    } catch (err) {
      console.error('[Insight] Save error:', err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DYNAMIC SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════

function buildSystemPrompt(userId, forDocGen) {
  let clientRateSection = '';
  let clientInsightsSection = '';
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

  try {
    const insights = db.prepare(`SELECT category, insight, times_reinforced FROM client_insights WHERE user_id = ? ORDER BY times_reinforced DESC, updated_at DESC LIMIT 30`).all(userId);
    if (insights.length > 0) {
      const grouped = {};
      for (const ins of insights) {
        if (!grouped[ins.category]) grouped[ins.category] = [];
        const strength = ins.times_reinforced >= 3 ? ' [STRONG]' : '';
        grouped[ins.category].push(`  - ${ins.insight}${strength}`);
      }
      clientInsightsSection = `\n=== CLIENT PROFILE (learned from past projects) ===\nApply these preferences automatically — the client has told us this before.\n\n${Object.entries(grouped).map(([cat, items]) => `[${cat.toUpperCase()}]\n${items.join('\n')}`).join('\n\n')}\n===\n`;
    }
  } catch (err) { console.error('[Chat] Insight load error:', err.message); }

  if (forDocGen) {
    return `You are an expert UK Quantity Surveyor. You MUST respond with ONLY valid JSON — no markdown, no backticks, no explanation outside the JSON.

FIXED UK RATES — use these exact figures, no deviations:
Strip foundations 600x250mm: 87/m | Concrete slab 100mm reinforced: 50/m2 | DPM 1200g: 10/m2 | Floor insulation 100mm Celotex: 21/m2
Blockwork below DPC 440mm: 63/m2 | Blockwork inner leaf 100mm: 42/m2 | Brick outer leaf facing: 63/m2 | Cavity insulation 100mm: 14/m2
Cavity wall ties: 4/m2 | Structural steel supply fab install: 3500/T | Concrete lintels: 35/ea | Steel lintels Catnic: 75/ea
Roof structure cut timber: 95/m2 | Roof covering concrete tiles: 52/m2 | Breathable membrane: 5/m2 | Tile battens: 7/m2
Lead flashings: 55/m | Fascia soffit uPVC: 33/m | Guttering uPVC: 22/m
UPVC windows standard: 450/ea | Composite external door: 1100/ea | Bi-fold doors per leaf: 650/leaf
Internal doors painted softwood: 330/ea | Plasterboard and skim: 22/m2 | Wall tiling ceramic: 55/m2 | Floor tiling porcelain: 65/m2
Painting emulsion 2 coats: 15/m2 | Painting gloss woodwork: 12/m | LVT flooring: 62/m2 | Carpet mid range: 28/m2 | Screed 50mm: 22/m2
Kitchen fit-out mid range: 11000/ea | Bathroom fit-out mid range: 6000/ea
First fix electrical: 3500/item | Second fix electrical: 1500/item | First fix plumbing: 2800/item | Second fix plumbing: 1400/item
Radiator double panel 600x1000: 230/ea | Render monocouche: 85/m2 | Scaffolding: 20/m2 | Skip hire 8yd: 330/ea
Site setup welfare lump sum: 2000 | Project management allowance: 1500
LOCATION UPLIFT — apply as a multiplier to all rates: London/SE +20% | Midlands +7% | North England -3% | Scotland +3% | Ireland +10% use EUR
YOU MUST USE THESE EXACT RATES. Do not interpolate, estimate, or vary from these figures. If a client rate is marked VERIFIED use that instead.
${clientRateSection}
${clientInsightsSection}

CRITICAL REQUIREMENTS:
1. Include 40-100+ line items depending on project size — DO NOT produce sparse estimates
2. Break down composite items (e.g. cavity wall into inner leaf, insulation, outer leaf, ties)
3. Show proper quantities with working (e.g. "2no. walls @ 5.0m x 2.7m less openings")
4. Include ALL trades: prelims, demo, substructure, superstructure, roof, windows, doors, finishes, MEP, external works
5. Every item needs rate_source: "verified", "emerging", or "generic"
6. Include prelims (scaffolding, skip hire, site setup, project management)
7. The findings report must have detailed assumptions, exclusions, and recommendations

Respond with this JSON structure:
{
  "sections": [
    {
      "number": "1",
      "title": "Section Name",
      "items": [
        { "item": "1.1", "description": "Detailed work item description including spec", "unit": "m2", "qty": 24, "rate": 50, "labour": 600, "materials": 600, "total": 1200, "rate_source": "verified|emerging|generic" }
      ]
    }
  ],
  "findings": {
    "reference": "AI-QS-XXXXX",
    "project_type": "e.g. Single Storey Extension",
    "location": "Location",
    "description": "Detailed project description paragraph explaining scope and context",
    "scope_summary": "Detailed scope summary covering all elements of work",
    "key_findings": [{ "title": "Category", "detail": "Detailed finding text", "items": ["specific point 1", "specific point 2"] }],
    "assumptions": ["Detailed assumption 1", "Detailed assumption 2"],
    "exclusions": ["Specific exclusion 1", "Specific exclusion 2"],
    "cost_summary": {
      "sections": [{ "name": "Section Name", "total": 12345.00 }],
      "net_total": 50000.00,
      "contingency_pct": 7.5, "contingency": 3750.00,
      "ohp_pct": 12, "ohp": 6000.00,
      "grand_total": 59750.00
    },
    "recommendations": ["Specific actionable recommendation 1"]
  }
}
Include ALL measurable items. Be thorough. Every item needs rate_source. Minimum 40 line items for any project.`;
  }

  return `You are an expert UK Quantity Surveyor AI assistant working for The AI QS (theaiqs.co.uk), a professional AI-powered quantity surveying service covering the UK and Ireland.

Your role is to help construction professionals with detailed, thorough quantity surveying. You are NOT a chatbot — you are a professional QS producing work that clients pay for. Every response should demonstrate deep expertise and add genuine value.

CORE CAPABILITIES:
- Analysing construction drawings and providing quantity take-offs with measured dimensions
- Producing detailed Bills of Quantities with line-by-line cost breakdowns
- Giving cost estimates based on current UK market rates with clear methodology
- Advising on specifications, materials, and building regulations
- Identifying scope items, risks, and potential issues in projects

WHEN ANALYSING DRAWINGS — BE THOROUGH:
1. IDENTIFY every visible element: foundations, substructure, superstructure, roof, internal partitions, stairs, windows, doors, finishes, MEP, external works
2. MEASURE or estimate dimensions from the drawings — note scale, dimensions, room sizes
3. CALCULATE quantities properly: wall areas (length x height minus openings), floor areas, roof areas (account for pitch), foundation lengths, concrete volumes
4. BREAK DOWN by element with proper NRM2/SMM7 structure
5. APPLY RATES with clear source attribution — never just guess
6. STATE ALL ASSUMPTIONS clearly (slab thickness, insulation spec, foundation depth, etc.)
7. FLAG anything unclear, missing information, or needing site verification
8. Include PRELIMS (site setup, welfare, skip hire, scaffolding, project management)
9. Include CONTINGENCY (7.5-10%) and OH&P (12-15%)
10. Note whether VAT applies

DETAIL EXPECTATIONS — MINIMUM STANDARDS:
- For a standard single-storey extension: expect 40-60+ line items minimum
- For a two-storey extension or conversion: expect 60-100+ line items
- For a full refurb: expect 80-150+ line items
- NEVER produce a sparse 10-20 item estimate — clients pay for detail
- Break down composite items: e.g. "Cavity wall" should show blockwork inner leaf, insulation, cavity ties, brick outer leaf separately where relevant
- Show working for key quantities: "External wall area: 2no. walls @ 5.0m x 2.7m = 27.0m2, less 2no. windows @ 1.2x1.5m = 3.6m2, net wall area = 23.4m2"

ELEMENTAL BREAKDOWN (use these sections):
1. Preliminaries & General — site setup, welfare, scaffolding, waste, insurance, PM
2. Demolition & Alterations — strip out, demolition, temporary support, waste disposal
3. Substructure — excavation, foundations, concrete slab, DPM, insulation, drainage below ground
4. Superstructure — walls (external, internal), structural steels, lintels, cavity closers, wall ties
5. Roof — structure (rafters, joists, ridge), covering (tiles/slate), felt, battens, flashings, fascia/soffit, guttering
6. Windows & External Doors — supply, fit, cills, reveals, lintels above
7. Internal Doors & Ironmongery — door sets, linings, architraves, ironmongery
8. Internal Finishes — plasterboard, skim coat, tiling (walls and floors)
9. Floor Finishes — screed, LVT, carpet, tiling, underlay, threshold strips
10. Decoration — mist coat, emulsion walls/ceilings, gloss woodwork
11. Kitchen — units, worktops, splashback, appliances, fit-out
12. Bathroom — sanitaryware, brassware, tiling, shower screen/enclosure, fit-out
13. Mechanical & Plumbing — heating (radiators, pipework), hot/cold water, waste, gas
14. Electrical — consumer unit, circuits, sockets, switches, lighting, testing, certification
15. External Works — drainage, paving, landscaping, fencing, retaining walls

FIXED UK RATES (use these exact figures — no ranges):
Strip foundations 600x250mm: 87/m | Concrete slab 100mm reinforced: 50/m2 | DPM 1200g: 10/m2 | Floor insulation 100mm Celotex: 21/m2
Blockwork below DPC 440mm: 63/m2 | Blockwork inner leaf 100mm: 42/m2 | Brick outer leaf facing: 63/m2 | Cavity insulation 100mm: 14/m2
Cavity wall ties: 4/m2 | Structural steel supply fab install: 3500/T | Concrete lintels: 35/ea | Steel lintels Catnic: 75/ea
Roof structure cut timber: 95/m2 | Roof covering concrete tiles: 52/m2 | Breathable membrane: 5/m2 | Tile battens: 7/m2
Lead flashings: 55/m | Fascia soffit uPVC: 33/m | Guttering uPVC: 22/m
UPVC windows standard: 450/ea | Composite external door: 1100/ea | Bi-fold doors per leaf: 650/leaf
Internal doors painted softwood: 330/ea | Plasterboard and skim: 22/m2 | Wall tiling ceramic: 55/m2 | Floor tiling porcelain: 65/m2
Painting emulsion 2 coats: 15/m2 | Painting gloss woodwork: 12/m | LVT flooring: 62/m2 | Carpet mid range: 28/m2 | Screed 50mm: 22/m2
Kitchen fit-out mid range: 11000/ea | Bathroom fit-out mid range: 6000/ea
First fix electrical: 3500/item | Second fix electrical: 1500/item | First fix plumbing: 2800/item | Second fix plumbing: 1400/item
Radiator double panel 600x1000: 230/ea | Render monocouche: 85/m2 | Scaffolding: 20/m2 | Skip hire 8yd: 330/ea
Site setup welfare lump sum: 2000 | Project management allowance: 1500

LOCATION FACTORS:
London/SE: +20% | Midlands: +7% | North England: -3% | Scotland: +3% | Ireland: +10% (use EUR)
${clientRateSection}
${clientInsightsSection}
DOCUMENT GENERATION: This system generates downloadable Excel BOQ and Word Findings Report files. When a client asks to "generate documents" or "create the BOQ", the system produces these automatically. After providing your analysis, mention: "If you want downloadable documents, just say 'generate documents' and I'll create an Excel BOQ and Word Findings Report for you."

COMMUNICATION STYLE — CRITICAL:
You are writing as a professional quantity surveyor, not a chatbot. Follow these rules strictly:
1. NEVER use markdown formatting: no **, no ##, no ---, no bullet points with -, no numbered lists with 1.
2. NEVER use emojis or symbols like checkmarks, warning signs, or arrows
3. Write in plain professional prose — paragraphs and sentences, like a proper QS report
4. Use simple line breaks to separate sections, not markdown headers
5. Present BOQ data as plain text tables using fixed-width spacing or tab-separated columns
6. When listing items, use plain text: "Item 1.1 — Strip foundations 600x250mm, 9.74m at 87/m = 848"
7. Keep the tone direct and professional — like an email from a senior QS to a contractor
8. Do not include "How to use this BOQ" sections or chatbot-style prompts
9. Do not ask multiple questions at the end — one follow-up at most
10. Never say "Need me to..." with a list of options. Just say "Let me know if you want anything adjusted."
11. State assumptions and exclusions in plain sentences, not bullet lists

RATE LEARNING: If a client corrects a rate or provides their own pricing, acknowledge it naturally in conversation. The system auto-learns from corrections.

RATE TAGS (hidden from client — include at END of response):
For NEW rates: [RATE_ADD|category|Rate Name|value|unit]
For CORRECTIONS: [RATE_UPDATE|Rate Name|new_value]

Valid categories: structural_steel, architectural_metalwork, preliminaries, groundworks, masonry, carpentry, roofing, plastering, flooring, electrical, plumbing, mechanical, decorating, kitchen, bathroom, demolition, partitions, general

CLIENT INSIGHT TAGS (hidden from client — include at END of response when you learn something reusable):
[INSIGHT|category|insight text]

Valid insight categories: spec_preference, markup, supplier, scope, geography, trade, standard, feedback, workflow, exclusion, team, project_type, commercial

Only output INSIGHT tags when the client EXPLICITLY states something — do not infer or guess.

All estimates are approximate, subject to detailed measurement and site conditions.`;
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
// CHAT SESSION ROUTES
// ═══════════════════════════════════════════════════════════════════════

router.get('/chat-sessions', authMiddleware, (req, res) => {
  try {
    const sessions = db.prepare(
      `SELECT id, title, created_at, updated_at FROM chat_sessions
       WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`
    ).all(req.user.id);
    res.json({ sessions });
  } catch (e) {
    console.error('[ChatSessions] Load error:', e.message);
    res.json({ sessions: [] });
  }
});

router.get('/chat-sessions/:id', authMiddleware, (req, res) => {
  try {
    const session = db.prepare(
      'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ...session, messages: JSON.parse(session.messages || '[]') });
  } catch (e) {
    console.error('[ChatSessions] Get error:', e.message);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

router.post('/chat-sessions', authMiddleware, (req, res) => {
  try {
    const { id, title, messages } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
    const sessionId = id || 'cs_' + uuidv4().slice(0, 12);
    let sessionTitle = title;
    if (!sessionTitle) {
      const firstUser = messages.find(m => m.role === 'user');
      const content = firstUser ? (typeof firstUser.content === 'string' ? firstUser.content : '') : '';
      sessionTitle = content.substring(0, 60).trim() || 'Chat ' + new Date().toLocaleDateString('en-GB');
    }
    const existing = db.prepare('SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
    if (existing) {
      db.prepare('UPDATE chat_sessions SET title = ?, messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .run(sessionTitle, JSON.stringify(messages), sessionId, req.user.id);
    } else {
      db.prepare('INSERT INTO chat_sessions (id, user_id, title, messages) VALUES (?, ?, ?, ?)')
        .run(sessionId, req.user.id, sessionTitle, JSON.stringify(messages));
    }
    res.json({ id: sessionId, title: sessionTitle });
  } catch (e) {
    console.error('[ChatSessions] Save error:', e.message);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

router.delete('/chat-sessions/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('[ChatSessions] Delete error:', e.message);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE PROJECT ROUTE
// ═══════════════════════════════════════════════════════════════════════

router.delete('/projects/:id', authMiddleware, (req, res) => {
  try {
    const projectId = req.params.id;
    const project = req.user.role === 'admin'
      ? db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
      : db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    db.prepare('DELETE FROM files WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM project_data WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    res.json({ success: true });
  } catch (e) {
    console.error('[Projects] Delete error:', e.message);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// OTHER ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

router.get('/seed-rates', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const results = [];
  const allUsers = db.prepare('SELECT id, email, full_name, role FROM users ORDER BY created_at').all();
  results.push({ info: 'All users in database', users: allUsers.map(u => `${u.email} (${u.full_name}) [${u.role}]`) });
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
      for (const r of rates) insert.run('rl_' + uuidv4().slice(0, 8), paul.id, r.category, r.item_key, r.display_name, r.value, r.unit, r.confidence);
    });
    tx();
    results.push({ paul: `Seeded ${rates.length} rates for ${paul.full_name}` });
  } else {
    results.push({ paul: 'NOT FOUND — paul@metalworksolutionsuk.com not in users table' });
  }
  res.json({ success: true, results });
});

router.get('/downloads/:filename', authMiddleware, (req, res) => {
  const fp = path.join(outputsDir, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const ext = path.extname(req.params.filename).toLowerCase();
  const mt = { '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf':'application/pdf' };
  const fileBuffer = fs.readFileSync(fp);
  res.setHeader('Content-Type', mt[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  res.setHeader('Content-Length', fileBuffer.length);
  res.send(fileBuffer);
});

router.get('/my-rates', authMiddleware, (req, res) => {
  try {
    const rates = db.prepare(`SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1 ORDER BY category, item_key`).all(req.user.id);
    const stats = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence, SUM(times_applied) as total_uses FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(req.user.id);
    res.json({ rates, stats });
  } catch(e) { res.status(500).json({ error: 'Failed to load rate library' }); }
});

router.get('/my-insights', authMiddleware, (req, res) => {
  try {
    const insights = db.prepare(`SELECT * FROM client_insights WHERE user_id = ? ORDER BY times_reinforced DESC, updated_at DESC`).all(req.user.id);
    const stats = db.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT category) as categories FROM client_insights WHERE user_id = ?`).get(req.user.id);
    res.json({ insights, stats });
  } catch(e) { res.status(500).json({ error: 'Failed to load insights' }); }
});

router.delete('/my-insights/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM client_insights WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Insight not found' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to delete insight' }); }
});

router.get('/admin/insights/:userId', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const insights = db.prepare(`SELECT * FROM client_insights WHERE user_id = ? ORDER BY category, times_reinforced DESC`).all(req.params.userId);
    res.json({ insights });
  } catch(e) { res.status(500).json({ error: 'Failed to load insights' }); }
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
// MAIN CHAT ENDPOINT
// ═══════════════════════════════════════════════════════════════════════

router.post('/chat', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const { message, history } = req.body;
    const userId = req.user.id;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

    if (req.user.suspended) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support.', suspended: true, reason: req.user.suspended_reason || null });
    }

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
            error: 'You\'ve used all ' + effectiveLimit + ' messages this month on the ' + limits.label + ' plan. Upgrade to Professional for 100 messages/month, or contact us to add more credits.',
            limit_type: 'messages', used: used.c, limit: effectiveLimit, plan: plan
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
    if (usedFallback) reply += '\n\n(Response from lighter model due to high demand.)';

    const wantsDocumentsRaw = /generate\s*(the\s*)?(document|boq|report|excel|file)|create\s*(the\s*)?(boq|report|document|excel)|download\s*(the\s*)?(boq|report|document|excel|file)|produce\s*(the\s*)?(boq|report|document)|make\s*(me\s*)?(the\s*)?(boq|report|document)|give\s*me\s*(the\s*)?(document|boq|report|file|excel)|\.xlsx|\.docx|findings\s*report/i.test(message || '');
    let wantsDocuments = wantsDocumentsRaw;
    let downloadFiles = null;
    let paymentRequired = null;

    if (wantsDocuments && req.user.role !== 'admin') {
      var dPlan = req.user.plan || 'starter';
      var dStart2 = new Date(); dStart2.setDate(1); dStart2.setHours(0,0,0,0);
      var dMonthStr = dStart2.toISOString();
      var docsGenThisMonth = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(userId, dMonthStr).c;
      var revisionsThisMonth = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND created_at>=?").get(userId, dMonthStr).c;

      if (dPlan === 'starter') {
        var paidCredits = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_paid'").get(userId).c;
        var totalDocsEver = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated'").get(userId).c;
        var totalRevisionsEver = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision'").get(userId).c;
        var originalsEver = totalDocsEver - totalRevisionsEver;
        var lastDocDetail = db.prepare("SELECT detail FROM usage_log WHERE user_id=? AND action='doc_generated' ORDER BY created_at DESC LIMIT 1").get(userId);
        var looksLikeRevision = lastDocDetail && totalDocsEver > 0 && /revis|redo|regenerat|update.*doc|fix.*rate/i.test(message || '');
        if (looksLikeRevision && totalRevisionsEver < paidCredits) {
          console.log('[Quota] Starter revision allowed');
        } else if (originalsEver >= paidCredits) {
          wantsDocuments = false;
          paymentRequired = {
            type: 'boq_payment', plan: 'starter', price: 99, currency: 'GBP',
            url: 'https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01?client_reference_id=' + userId,
            message: 'To generate your BOQ and Findings Report, a one-off payment of £99 is required. This includes a full Excel BOQ with your trained rates, a professional Findings Report, and 1 free revision.',
          };
        }
      } else {
        var docLimit = dPlan === 'premium' ? 20 : 10;
        var originalsThisMonth = docsGenThisMonth - revisionsThisMonth;
        var lastDoc2 = db.prepare("SELECT detail FROM usage_log WHERE user_id=? AND action='doc_generated' ORDER BY created_at DESC LIMIT 1").get(userId);
        var isRevisionCheck = lastDoc2 && /revis|redo|regenerat|update.*doc|fix.*rate/i.test(message || '');
        if (isRevisionCheck) {
          var lastProject = lastDoc2.detail;
          var projectRevisions = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND detail=?").get(userId, lastProject).c;
          if (projectRevisions >= 1) { reply += '\n\nRevision limit reached for this project (1 revision included per BOQ).'; wantsDocuments = false; }
        } else if (originalsThisMonth >= docLimit) {
          reply += '\n\nDocument limit reached (' + docLimit + ' BOQs on ' + dPlan + ' plan this month).';
          wantsDocuments = false;
        }
      }
    }

    if (wantsDocuments && boqGen && findingsGen) {
      console.log('[Docs] User requested documents — generating structured data...');
      const clientName = req.user.full_name || req.user.email;
      let projectName = 'Project';
      const allText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ') + ' ' + reply;
      const addrMatch = allText.match(/(\d+\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}(?:\s+(?:Road|Street|Lane|Drive|Avenue|Close|Way|Crescent|Place|Court|Gardens|Terrace|Grove|Mews|Rise|Hill|Row|Walk|Square|Park|Green|Rd|St|Ln|Dr|Ave|Cl))\b)/i);
      if (addrMatch) {
        projectName = addrMatch[1].trim();
      } else {
        const projMatch = allText.match(/(?:project|extension|conversion|renovation|refurb|build|loft|dormer|garage|kitchen|bathroom)\s+(?:at|for|:|-|–)\s+([A-Z0-9][^\n,]{3,40})/i);
        if (projMatch) projectName = projMatch[1].trim();
      }
      projectName = projectName.replace(/[^\w\s-]/g, '').trim().substring(0, 50);

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
          console.log('[Docs] Parsed JSON — sections:', (parsed.sections || []).length);
          const safeName = projectName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 50) || 'Project';
          const ts = Date.now();
          downloadFiles = [];

          const sections = parsed.sections || [];
          if (sections.length > 0) {
            console.log('[Docs] Building Excel BOQ with', sections.length, 'sections...');
            try {
              const buf = await boqGen.generateBOQExcel(sections, projectName, clientName, {
                contingency_pct: parsed.findings?.cost_summary?.contingency_pct || 7.5,
                ohp_pct: parsed.findings?.cost_summary?.ohp_pct || 12,
                vat_rate: parsed.findings?.cost_summary?.vat_rate || 20,
              });
              if (buf && buf.length > 100) {
                const fname = `BOQ-${safeName}-${ts}.xlsx`;
                fs.writeFileSync(path.join(outputsDir, fname), buf);
                downloadFiles.push({ name: fname, type: 'xlsx', url: `/api/downloads/${fname}` });
                console.log(`[Docs] Excel: ${fname}`);
              }
            } catch (excelErr) { console.error('[Docs] Excel error:', excelErr.message); }
          }

          try {
            console.log('[Docs] Building Findings Report...');
            const findings = parsed.findings || {};
            const docBuf = await findingsGen.generateFindingsReport(findings, clientName, projectName);
            if (docBuf && docBuf.length > 100) {
              const docName = `Findings-${safeName}-${ts}.docx`;
              fs.writeFileSync(path.join(outputsDir, docName), docBuf);
              downloadFiles.push({ name: docName, type: 'docx', url: `/api/downloads/${docName}` });
              console.log(`[Docs] Word: ${docName}`);
            }
          } catch (wordErr) { console.error('[Docs] Word error:', wordErr.message); }

          if (downloadFiles.length > 0) {
            var itemCount = 0, totalVal = 0;
            if (parsed.sections) {
              for (var si=0;si<parsed.sections.length;si++) {
                var sec=parsed.sections[si];
                if(sec.items){for(var ii=0;ii<sec.items.length;ii++){totalVal+=parseFloat(sec.items[ii].total)||0;itemCount++;}}
              }
            }
            const contingencyPct = parsed.findings?.cost_summary?.contingency_pct || 7.5;
            const ohpPct = parsed.findings?.cost_summary?.ohp_pct || 12;
            const contingency = totalVal * (contingencyPct / 100);
            const ohp = (totalVal + contingency) * (ohpPct / 100);
            const grandTotal = totalVal + contingency + ohp;
            var currency = reply.includes('EUR') || reply.includes('€') ? '€' : '£';
            reply = 'Your documents have been generated for ' + projectName + '.\n\n';
            reply += itemCount + ' line items across ' + (parsed.sections || []).length + ' sections.\n\n';
            reply += 'Download your Excel BOQ and Findings Report below. If any rates need adjusting or items adding, just let me know and I can regenerate.';

            try {
              var summaryText = (parsed.findings && parsed.findings.executive_summary) || '';
              var boqF = downloadFiles.find(function(f){return f.type==='xlsx';});
              var docF = downloadFiles.find(function(f){return f.type==='docx';});
              var projCurrency = (reply.includes('EUR') || reply.includes('€')) ? 'EUR' : 'GBP';

              db.prepare('INSERT INTO chat_projects (id,user_id,title,total_value,currency,boq_filename,findings_filename,summary,item_count) VALUES(?,?,?,?,?,?,?,?,?)')
                .run('cp_'+uuidv4().slice(0,8), userId, projectName, totalVal, projCurrency, boqF?boqF.name:null, docF?docF.name:null, summaryText.substring(0,1000), itemCount);

              try {
                const projId = 'proj_' + uuidv4().slice(0, 10);
                // Add boq_filename/findings_filename columns if they don't exist yet
                try { db.exec('ALTER TABLE projects ADD COLUMN boq_filename TEXT'); } catch(e) {}
                try { db.exec('ALTER TABLE projects ADD COLUMN findings_filename TEXT'); } catch(e) {}
                db.prepare(`INSERT INTO projects (id, user_id, title, status, total_value, currency, item_count, project_type, boq_filename, findings_filename) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`)
                  .run(projId, userId, projectName, totalVal, projCurrency, itemCount, (parsed.findings && parsed.findings.project_type) || null, boqF ? boqF.name : null, docF ? docF.name : null);
                console.log('[Project] Saved to projects table: ' + projectName);
              } catch(projErr) {
                console.error('[Project] projects table insert error:', projErr.message);
              }

              db.prepare('INSERT INTO usage_log (id,user_id,action,detail,model_used,tokens_in,tokens_out,cost_estimate) VALUES(?,?,?,?,?,?,?,?)')
                .run('ul_'+uuidv4().slice(0,8), userId, 'doc_generated', projectName, modelUsed||'sonnet', 0, 0, 0);
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
      reply += '\n\nIf you want downloadable documents, just say "generate documents" and I\'ll create an Excel BOQ and Word Findings Report for you.';
    }

    // ── Auto-learning: extract rates from corrections ─────────────
    try {
      const userMsg = (message || '');
      const userLower = userMsg.toLowerCase();
      const isCorrection = /(?:should be|actually|we (?:charge|pay|use|quote)|rate is|cost is|price is|our rate|not right|too (?:high|low)|incorrect|wrong|instead of|changed to|now \d|is \d+\s*(?:not|instead))/i.test(userLower);
      if (isCorrection) {
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
          const np = [/(?:should be|actually|is|to|now|changed to)\s*(?:£|€)?\s*(\d[\d,.]*)(?!\d)/i, /(\d[\d,.]*)\s*(?:not|instead of)\s*\d/i];
          for (const pat of np) { const m = userMsg.match(pat); if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v>0&&v<1000000){newValue=v;break;} } }
          if (!newValue) { const nums = userMsg.match(/\d[\d,.]*(?:\.\d+)?/g); if (nums) newValue = parseFloat(nums[0].replace(/,/g,'')); }
          if (bestMatch && bestScore >= 1 && newValue && newValue !== bestMatch.value) {
            db.prepare('UPDATE client_rate_library SET value=?,confidence=MIN(confidence+0.05,0.95),times_confirmed=times_confirmed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newValue, bestMatch.id);
            db.prepare('INSERT INTO rate_corrections_log(id,rate_id,user_id,old_value,new_value,correction_source,raw_message)VALUES(?,?,?,?,?,?,?)').run('rc_'+uuidv4().slice(0,8),bestMatch.id,userId,bestMatch.value,newValue,'auto_chat',userMsg.substring(0,500));
          }
        }
      }
    } catch (autoErr) { console.error('[AutoLearn]', autoErr.message); }

    // ── Server-side insight extraction ────────────────────────────
    try {
      extractInsightsFromMessage(userId, message);
    } catch (insExtErr) { console.error('[InsightExtract]', insExtErr.message); }

    // ── Parse RATE_ADD / RATE_UPDATE tags ─────────────────────────
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
              db.prepare('INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.75, 1)').run('rl_'+uuidv4().slice(0,8), userId, cat, itemKey, rName, rVal, rUnit);
            } else {
              db.prepare('UPDATE client_rate_library SET value = ?, unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(rVal, rUnit, exists.id);
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
              db.prepare('INSERT INTO rate_corrections_log(id,rate_id,user_id,old_value,new_value,correction_source,raw_message)VALUES(?,?,?,?,?,?,?)').run('rc_'+uuidv4().slice(0,8),found.id,userId,found.value,uVal,'tag_update',reply.substring(0,200));
            }
          }
        }
      }
      reply = reply.replace(/\[RATE_ADD\|[^\]]*\]/g, '').replace(/\[RATE_UPDATE\|[^\]]*\]/g, '').replace(/\[INSIGHT\|[^\]]*\]/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    } catch (tagErr) { console.error('[RateTag] Error:', tagErr.message); }

    // ── Parse INSIGHT tags ────────────────────────────────────────
    try {
      var insightMatches = reply.match(/\[INSIGHT\|([^|]+)\|([^\]]+)\]/g) || [];
      for (var ii2 = 0; ii2 < insightMatches.length; ii2++) {
        var iParts = insightMatches[ii2].replace(/^\[INSIGHT\|/, '').replace(/\]$/, '').split('|');
        if (iParts.length >= 2) {
          var iCat = iParts[0].trim().toLowerCase().replace(/\s+/g, '_');
          var iText = iParts[1].trim();
          var validInsightCats = ['spec_preference','markup','supplier','scope','geography','trade','standard','feedback','workflow','exclusion','team','project_type','commercial'];
          if (validInsightCats.includes(iCat) && iText.length > 5 && iText.length < 300) {
            var existingInsights = db.prepare('SELECT id, insight, times_reinforced FROM client_insights WHERE user_id = ? AND category = ?').all(userId, iCat);
            var isDuplicate = false;
            for (var ei = 0; ei < existingInsights.length; ei++) {
              var existWords = existingInsights[ei].insight.toLowerCase().split(/\s+/);
              var newWords = iText.toLowerCase().split(/\s+/);
              var overlap = existWords.filter(function(w) { return newWords.indexOf(w) >= 0; }).length;
              if (overlap / Math.max(existWords.length, 1) > 0.6) {
                db.prepare('UPDATE client_insights SET times_reinforced = times_reinforced + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(existingInsights[ei].id);
                isDuplicate = true;
                break;
              }
            }
            if (!isDuplicate) {
              db.prepare('INSERT INTO client_insights (id, user_id, category, insight) VALUES (?, ?, ?, ?)').run('ins_'+uuidv4().slice(0,8), userId, iCat, iText);
            }
          }
        }
      }
    } catch (insErr) { console.error('[Insight] Parse error:', insErr.message); }

    reply = reply.replace(/\[RATE_ADD\|[^\]]*\]/g, '').replace(/\[RATE_UPDATE\|[^\]]*\]/g, '').replace(/\[INSIGHT\|[^\]]*\]/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();

    let rateStats = null;
    try {
      const s = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(userId);
      if (s && s.total > 0) rateStats = s;
    } catch(e) {}

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

    res.json({ reply, thinking: thinking || null, rateStats, files: downloadFiles, quota: quotaInfo, payment_required: paymentRequired });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong -- please try again' });
  }
});

module.exports = router;

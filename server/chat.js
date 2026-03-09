const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');
const db = require('./database');

let boqGen, findingsGen, deterministicPricer, benchmarkStore, memoryEngine, zipProcessor;
try { boqGen = require('./boqGenerator'); } catch (e) { console.log('[Chat] ExcelJS not installed — BOQ generation disabled. Run: npm install exceljs'); }
try { findingsGen = require('./findingsGenerator'); } catch (e) { console.log('[Chat] docx not installed — Findings generation disabled. Run: npm install docx'); }
try { deterministicPricer = require('./deterministicPricer'); } catch (e) { console.log('[Chat] deterministicPricer not found — copy deterministicPricer.js to server/'); }
try { benchmarkStore = require('./benchmarkStore'); } catch (e) { console.log('[Chat] benchmarkStore not found — copy benchmarkStore.js to server/'); }
try { memoryEngine = require('./memoryEngine'); } catch (e) { console.log('[Chat] memoryEngine not found — copy memoryEngine.js to server/'); }
try { zipProcessor = require('./zipProcessor'); } catch (e) { console.log('[Chat] zipProcessor not found — copy zipProcessor.js to server/'); }

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
const outputsDir = path.join(DATA_DIR, 'outputs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

// Init benchmark/takeoff tables
try { if (benchmarkStore) benchmarkStore.initBenchmarkTables(db); } catch(e) { console.error('[Benchmarks] Init error:', e.message); }
// Init memory engine tables
try { if (memoryEngine) memoryEngine.initMemoryTables(db); } catch(e) { console.error('[Memory] Init error:', e.message); }

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
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.xlsx', '.xls'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SERVER-SIDE INSIGHT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════

function extractInsightsFromMessage(userId, message) {
  if (!message || message.length < 5) return;
  const msg = message.trim();
  const patterns = [
    { regex: /we (?:always |usually |typically )?(?:use|buy from|get .+? from|source from|order from)\s+([A-Z][a-zA-Z\s&]+?)(?:\s+for|\s+as|\s+when|\.|\,|$)/i, category: 'supplier', template: m => `Client uses ${m[1].trim()} as supplier` },
    { regex: /(?:our|my) (?:main |preferred |usual )?supplier(?:s)? (?:is|are)\s+([A-Z][a-zA-Z\s&,]+?)(?:\.|,|$)/i, category: 'supplier', template: m => `Client supplier: ${m[1].trim()}` },
    { regex: /(?:we|I) (?:prefer|go with|stick with|always go to)\s+([A-Z][a-zA-Z\s&]+?)(?:\s+for|\s+when|\.|\,|$)/i, category: 'supplier', template: m => `Client prefers ${m[1].trim()}` },
    { regex: /we (?:always |usually |typically )?use\s+(.{5,60}?)\s+(?:for|as|on|in)\s+(?:all|our|every)/i, category: 'spec_preference', template: m => `Client spec: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:standard|usual|default|preferred)\s+(?:spec|specification|finish|material) (?:is|for .+? is)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'spec_preference', template: m => `Standard spec: ${m[1].trim()}` },
    { regex: /we (?:don't|do not|never) use\s+(.{5,60}?)(?:\.|,|$)/i, category: 'spec_preference', template: m => `Client excludes: ${m[1].trim()}` },
    { regex: /(?:our|my|we use a?)\s+(?:markup|margin|overhead|oh&p|ohp) (?:is|of)\s+(\d+(?:\.\d+)?%?)/i, category: 'markup', template: m => `Client markup: ${m[1].trim()}` },
    { regex: /we (?:charge|quote|add)\s+(\d+(?:\.\d+)?%?)\s+(?:markup|margin|overhead|for overhead)/i, category: 'markup', template: m => `Client markup: ${m[1].trim()}` },
    { regex: /we (?:mainly|mostly|only|primarily) work (?:in|around|across)\s+(.{5,60}?)(?:\.|,|$)/i, category: 'geography', template: m => `Client works in: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:area|region|patch|territory) is\s+(.{5,60}?)(?:\.|,|$)/i, category: 'geography', template: m => `Client area: ${m[1].trim()}` },
    { regex: /we (?:specialise|specialize|focus|mainly do|mostly do) (?:in|on)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'project_type', template: m => `Client speciality: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:main|typical|usual) (?:work|projects?) (?:is|are|involve)\s+(.{5,80}?)(?:\.|,|$)/i, category: 'project_type', template: m => `Typical projects: ${m[1].trim()}` },
    { regex: /(?:our|my) (?:team|crew|gang) (?:is|are|has|have)\s+(.{5,60}?)(?:\.|,|$)/i, category: 'team', template: m => `Client team: ${m[1].trim()}` },
    { regex: /we have\s+(\d+\s+(?:men|guys|workers|operatives|people|carpenters|bricklayers|labourers))/i, category: 'team', template: m => `Team size: ${m[1].trim()}` },
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
          isDuplicate = true; break;
        }
      }
      if (!isDuplicate) {
        db.prepare('INSERT INTO client_insights (id, user_id, category, insight) VALUES (?, ?, ?, ?)').run('ins_' + uuidv4().slice(0, 8), userId, pattern.category, insightText);
      }
    } catch (err) { console.error('[Insight] Save error:', err.message); }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DYNAMIC SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════

function buildSystemPrompt(userId, forDocGen, benchmarkSection) {
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

  if (forDocGen === 'extract_quantities' || forDocGen === 'extract_quantities_text') {
    // STAGE 1: Extract locked quantities from drawings OR text description
    // AI measures everything, shows working, outputs structured JSON
    // This JSON gets LOCKED and priced deterministically — no re-measuring on generate
    const isTextOnly = forDocGen === 'extract_quantities_text';
    return `You are an expert UK Quantity Surveyor performing a detailed ${isTextOnly ? 'quantity estimation from a project description' : 'measurement exercise from construction drawings'}.

Your ONLY job right now is to MEASURE and EXTRACT quantities. Do NOT price anything. Do NOT generate a BOQ.
${isTextOnly ? '\nYou are working from a TEXT DESCRIPTION only (no drawings). Use your professional QS expertise to estimate realistic quantities based on the project type, dimensions, and specification described. Be conservative — it is better to be slightly under than wildly over. Base quantities on typical UK construction for the project type described.\n' : ''}
You MUST respond with ONLY valid JSON — no markdown, no backticks, no explanation outside the JSON.

MEASUREMENT RULES:
1. ${isTextOnly ? 'Calculate quantities from the dimensions and scope described, using typical UK construction assumptions' : 'Measure every visible element from the drawings with explicit working shown. Read ALL dimensions annotated on the drawings — do not estimate if a dimension is written on the drawing'}
2. Show your working in the "working" field for EVERY item. Format: "Rear wall: 6.2m x 2.7m = 16.74m² less 1no. window 1.2x0.9m = 1.08m², net = 15.66m²". If you cannot show working, flag the item
3. State all assumptions clearly in the "assumption" field
4. Use the exact item keys from the RATE LIBRARY — this is how prices get applied
5. Flag anything uncertain with "flagged": true and explain why
6. Be THOROUGH — you must cover EVERY trade. A missing trade is worse than an imprecise quantity. Check you have items for: demolition, substructure, walls, roof, windows, doors, stairs, internal partitions, plasterboard, floor finishes, decoration, kitchen/bathroom fit-outs, drainage, heating/plumbing, electrical, prelims
7. Break down composite elements into individual components (e.g. cavity wall = brick outer leaf m² + cavity insulation m² + blockwork inner leaf m² + cavity wall ties Nr + DPC m)
8. Use ELEMENT-LEVEL quantities, NOT building-level. Measure each wall, floor, roof slope separately with dimensions shown
9. Do NOT include professional fees (architect, planning, CDM, project management) unless the client specifically mentions them
10. NEVER double-count: if you include first_fix_plumbing do NOT also include individual pipe runs. If you include kitchen_fitout_mid do NOT also include separate worktop/unit items. If you include bathroom_fitout_mid do NOT also include separate sanitaryware items

COMPLETENESS CHECKLIST — you MUST have items for ALL of these sections if they apply to the project. If you are missing an entire section, your takeoff is WRONG:
1. DEMOLITION & SITE PREP — strip out existing (roof, walls, slab, finishes separately), asbestos survey allowance, cut back existing finishes at interface
2. SUBSTRUCTURE — foundations (excavate + concrete separately), ground slab, DPM, insulation, screed (all as separate items)
3. EXTERNAL WALLS — measure the FULL perimeter × FULL height. For a two-storey extension this means ground floor + first floor heights. Include: outer leaf, cavity insulation, inner leaf/frame, wall ties, DPC, cavity closers at EVERY opening, lintels
4. ROOF — For attic/room-in-roof: use attic_trusses_prefab (lump sum £8,000-£15,000 NOT per m²). For simple roofs: use roof_structure_cut_timber per m². Include: sarking, membrane, battens, tiles, lead flashings, fascia/soffit/guttering, insulation, Velux windows
5. WINDOWS & DOORS — Every window and door as SEPARATE line item. Include ground floor AND upper floor windows. Internal doors. Bifold/patio doors. Mastic sealant in linear metres
6. STAIRCASE — include staircase AND stair opening formation as separate items
7. FIRST FLOOR STRUCTURE — joists, chipboard, acoustic insulation (for two-storey)
8. INTERNAL PARTITIONS & LININGS — stud partitions, plasterboard to ALL new walls AND ceilings (measure every surface), fire-rated board where required (party wall, under stairs)
9. FLOOR FINISHES — screed, LVT/carpet/tiles by room, underlay, threshold strips. Do NOT omit floor finishes
10. DECORATION — mist coat + emulsion to ALL new plaster walls and ceilings, gloss to woodwork. Measure total wall area + ceiling area
11. FIT-OUTS — kitchen and/or bathroom as appropriate. Include sanitaryware, tiling, shower screens
12. DRAINAGE — foul drainage (per connection point), rainwater drainage (gutters already in roof — but downpipe connections), surface water if required
13. HEATING/PLUMBING — extend existing heating (radiators, pipework), hot/cold water to new rooms, sanitary connections. Price as lump sums per zone NOT per fitting
14. ELECTRICAL — consumer unit extension, new circuits (lighting, power, extract fans separately), smoke/heat detection. Price as lump sums per circuit NOT per socket
15. PRELIMS — scaffolding (elevation m²), skip hire, building control fees

WALL AREA MEASUREMENT — CRITICAL (most common source of under-counting):
- External wall area = FULL perimeter × FULL height (ground floor to eaves)
- For two-storey: that means perimeter × (ground floor height + first floor height) = typically perimeter × 5.0-5.4m
- THEN deduct window and door openings
- Measure BOTH the outer leaf AND inner leaf/frame (they have similar areas)
- Do NOT just measure one floor — measure the full height

ROOF MEASUREMENT — CRITICAL:
- If the drawings show ATTIC TRUSSES or room-in-roof, use "attic_trusses_prefab" as a LUMP SUM (1 Nr). These cost £8,000-£15,000 depending on span. Do NOT price at £55/m² — that rate is for simple cut timber rafters only
- Velux/roof windows: use the actual size from drawings. Standard centre-pivot ~£1,450, large or balcony types ~£3,800-£4,200

WINDOW & DOOR MEASUREMENT — CRITICAL:
- Read the DOOR SCHEDULE and WINDOW SCHEDULE from the drawings carefully
- List EVERY door and window as a SEPARATE line item with qty 1 — NEVER group them
- Include the schedule reference: "D01 — Shower room door 630x1975mm"
- Pick the correct SIZE variant based on actual dimensions
- Include vent panels, fanlights, sidelights as separate items if shown
- Include mastic sealant measured in LINEAR METRES around all external frames
${isTextOnly ? `\nCRITICAL: Use realistic UK dimensions where not stated — typical storey height 2.4m, typical foundation depth 1m, typical cavity wall 300mm total
For a given floor area, calculate wall perimeters, roof areas (add pitch factor ~1.15 for standard pitch), foundation lengths etc. systematically` : ''}

QUANTITY SANITY CHECKS — before finalising, verify:
- Typical single storey extension (25-40m²): construction cost should be £55,000-£120,000
- Typical two storey extension (40-70m²): construction cost should be £100,000-£200,000
- Typical loft conversion: construction cost should be £40,000-£90,000
- Typical whole-house refurbishment (100-200m²): construction cost should be £100,000-£300,000
- If your total is BELOW these ranges, you are almost certainly MISSING items. Go back and check the completeness checklist above
- No single line item for a residential project should exceed £20,000 unless genuinely high-value (attic trusses, ASHP, large Velux package)
- Scaffolding in m² should be elevation area (perimeter × scaffold height), NOT floor area

REFURBISHMENT-SPECIFIC RULES:
- For refurbishment projects, ALWAYS include strip-out items before new work (you must strip out old finishes before applying new ones)
- Break decoration into per-room items where possible (mist coat + emulsion walls + emulsion ceiling + gloss woodwork)
- For heating replacements, include: strip out old system + new boiler + radiators (per room count) + pipework + controls
- For electrical rewires, include: strip out old + rewire (per m² or per room) + consumer unit + testing certificate
- Use provisional_sum with qty as the £ value (rate=1) for items that cannot be accurately priced yet
- For heritage projects, use lime-based rates NOT cement-based (lime_mortar_repointing, lime_plaster_walls, lime_render_external)

AVAILABLE ITEM KEYS (use these exact strings in the "key" field):

=== NEW BUILD / EXTENSION KEYS ===
Demolition & Site Prep: garage_demolition (~£3,500 lump), strip_out_existing_roof (~£2,200 lump), demolish_existing_walls (~£2,800 lump), break_out_existing_slab (per m² ~£85), cut_back_existing_finishes (~£1,400 lump), existing_wall_interface (~£1,300 lump), asbestos_survey (~£450), asbestos_removal (~£1,500)
Substructure: excavation_strip_foundation (per m³), concrete_strip_foundation (per m³), blockwork_below_dpc, dpc_polythene, hardcore_fill, concrete_slab_150mm, concrete_slab_100mm, pir_insulation_under_slab, dpm_1200g, screed_sand_cement_75mm
Masonry: brick_outer_leaf, cavity_insulation_eps, blockwork_inner_leaf_100mm, cavity_wall_ties_ss, timber_sole_plate, cavity_closers (per m at EVERY opening), stud_wall_plasterboard_both_faces, steel_lintels_catnic, steel_lintels_bespoke
Roof: attic_trusses_prefab (LUMP SUM ~£12,000 for room-in-roof — use this NOT per-m² rates for attic trusses), roof_structure_cut_timber (per m² — simple roofs only), osb_sarking, breather_membrane, tile_battens, roof_tiles_interlocking, box_gutter_lead_lined, fascia_soffit_guttering, lead_flashing_code4, roof_insulation_mineral_wool
Velux: velux_skylight_780x980 (~£1,450), velux_skylight_940x1178 (~£1,450), velux_balcony_940x2520 (~£4,200)
Cladding: timber_cladding_accoya, ventilated_cavity_battens, close_boarded_fence_1800, external_decorations_stain
Windows/Doors (new — SIZE MATTERS, pick the right size variant):
  Bi-fold doors: bifold_door_aluminium_small (up to 2m/2 panels ~£2500), bifold_door_aluminium (2-3m/3 panels ~£3200), bifold_door_aluminium_large (3m+/4-5 panels ~£4500)
  External doors: composite_external_door (~£1250), composite_external_door_std (~£1100)
  Windows: upvc_window_small (up to 600x900mm ~£350), upvc_window_standard (up to 1200x1200mm ~£450), upvc_window_large (over 1200mm ~£580)
  Obscure: window_obscure_small (up to 600x900mm ~£380), window_obscure_standard (~£520)
  Bespoke: window_bespoke_narrow (~£650)
  Other: vent_panel_obscure (~£380), mastic_sealant_allowance (per m ~£12), motorised_rooflight (~£1200)
  Internal doors: internal_door_painted_solid_core (~£380), internal_door_glazed (~£480)

WINDOW & DOOR RULES — CRITICAL:
- List EVERY window and door as a SEPARATE line item with qty 1. Do NOT group windows or doors together
- Reference the door/window schedule numbers (D01, D02, W01, W02 etc.) in each item description
- Choose the correct SIZE variant based on actual dimensions from the drawings
- Include mastic sealant as a measured item in linear metres around all external frames
- Include vent panels separately if shown on drawings

=== REFURBISHMENT / HERITAGE KEYS ===
Strip-out: strip_out_general (per m²), strip_out_kitchen (per Nr), strip_out_bathroom (per Nr), strip_out_heating (per Item), strip_out_electrics (per Item), strip_out_flooring (per m²), strip_out_plaster (per m²), strip_out_ceiling (per m²), soft_strip_room (per Nr)
Heritage masonry: lime_mortar_repointing (per m²), lime_plaster_walls (per m²), lime_render_external (per m²), stone_repair_indent (per Nr), stone_cleaning (per m²), brick_repair_stitch (per m), wall_tie_replacement (per Nr), dpc_injection (per m)
Heritage roofing: natural_slate_roofing (per m²), clay_tile_roofing (per m²), lead_sheet_roofing (per m²), lead_flashing_code5 (per m), flat_roof_felt (per m²), flat_roof_single_ply (per m²), chimney_repair (per Nr), chimney_rebuild (per Nr)
Heritage rainwater: cast_iron_guttering (per m), cast_iron_downpipe (per m), cast_iron_hopper (per Nr), aluminium_guttering (per m)
Heritage windows: sash_window_overhaul (per Nr), sash_window_replacement (per Nr), secondary_glazing (per Nr), timber_casement_window (per Nr), timber_door_refurbish (per Nr), heritage_front_door (per Nr)
Damp/timber: damp_proofing_tanking (per m²), timber_treatment_spray (per m²), timber_repair_splice (per Nr), joist_replacement (per m), floorboard_replacement (per m²), floor_sanding_lacquer (per m²)
Heating: gas_boiler_combi (per Nr), gas_boiler_system (per Nr), oil_boiler (per Nr), hot_water_cylinder (per Nr), radiator_single_panel (per Nr), radiator_double_panel (per Nr), radiator_column_cast (per Nr), heating_pipework_first_fix (per m), heating_controls_upgrade (per Item), gas_supply_meter (per Item), air_source_heat_pump (per Nr), ufh_manifold_kitchen (per Item)
Electrical: full_electrical_rewire (per m² floor area), electrical_rewire_room (per Nr), fire_alarm_system (per Item), intruder_alarm (per Item), tv_data_cabling (per Nr), external_lighting (per Nr), consumer_unit_upgrade, first_fix_electrical, second_fix_electrical, extract_fans, ev_charge_point_ducting, electrical_testing_certificate
Decoration: mist_coat (per m²), emulsion_walls_2coat (per m²), emulsion_ceiling (per m²), gloss_woodwork (per m²), external_masonry_paint (per m²), wallpaper_strip_repaper (per m²), internal_decorations (per m² lump)
Insulation (refurb): loft_insulation_topup (per m²), internal_wall_insulation (per m²), external_wall_insulation (per m²), floor_insulation_suspended (per m²)
Asbestos: asbestos_survey (per Item), asbestos_removal (per Item)

=== SHARED KEYS (both new-build & refurbishment) ===
Internal linings: plasterboard_skim_walls (per m² — measure ALL new wall surfaces), plasterboard_ceilings (per m² — measure ALL new ceiling areas), plasterboard_fire_rated (per m² — under stairs, party walls), plasterboard_moisture_resistant (per m² — utility, wet areas), metal_stud_partition, wedi_wetroom_board
Finishes: screed_ufh_75mm, screed_sand_cement_75mm, skirting_mdf_95mm (per m — measure ALL room perimeters), internal_decorations (per m² — mist coat + emulsion ALL new walls and ceilings)
Internal doors: internal_door_painted_solid_core (~£380 per Nr), internal_door_glazed (~£480 per Nr)
Floor finishes: lvt_flooring_karndean (~£42/m²), lvt_flooring_luxury (~£55/m²), floor_tile_600x600 (~£65/m²), carpet_supply_fit (~£28/m²), engineered_timber_floor (~£55/m²), vinyl_safety_floor
Ceramic tiles: ceramic_wall_tiles_ensuite (~£72/m² — measure tiled wall area in bathrooms), tile_wall_ceramic, tile_wall_large_format
Fit-outs: kitchen_fitout_mid (per Nr ~£8,500), kitchen_fitout_high (per Nr ~£15,000), bathroom_fitout_mid (per Nr ~£5,500), bathroom_fitout_high (per Nr ~£8,500), wc_cloakroom_fitout (per Nr ~£2,800), shower_room_fitout (per Nr ~£4,200)
Drainage: foul_drainage_110mm (~£2,800 per connection), rainwater_drainage (~£1,200 lump), surface_water_drainage (per m ~£65), svp_connection_110mm, foul_drainage_connection, drainage_new_run (per m), manhole_inspection_chamber (per Nr)
Heating/Plumbing: heating_extension (~£4,200 lump — extend existing heating to new rooms), ensuite_sanitary_plumbing (~£3,800 lump), utility_plumbing (~£2,500 lump), first_fix_plumbing, second_fix_plumbing
Electrical: consumer_unit_upgrade (~£3,200 — extend CU for new circuits), lighting_installation (~£1,800 per circuit), power_sockets_circuit (~£1,400 per circuit), smoke_heat_detection (~£850 lump), extract_fans (~£320 each), electrical_testing_certificate
Structural: structural_steelwork (lump sum per structural package)
First floor: chipboard_flooring (22mm P5 chipboard to joists per m²)
Stairs: staircase (~£4,800 complete timber staircase), stair_opening_formation (~£750 — form opening in existing ceiling)
External: external_render (per m²), paving_slabs (per m²), block_paving (per m²), tarmac_driveway (per m²), gravel_driveway (per m²), retaining_wall_block (per m²), garden_wall_brick (per m²), gate_timber (per Nr), gate_metal (per Nr), landscaping_allowance (per Item)
Roof windows: velux_skylight_780x980, custom_velux_940x1178, custom_velux_balcony
Provisional: provisional_sum (use qty as £ value, rate=1), architect_fees, planning_application, cdm_principal_designer, project_management
Prelims: scaffolding (per m² elevation), scaffolding_two_storey, site_setup_scaffold (lump sum), skip_hire_8yd, site_welfare, building_control_fees, party_wall_surveyor, structural_engineer_fees, snagging_clearance

IMPORTANT SCAFFOLDING NOTE: For scaffolding measured in m², use key "scaffolding" or "scaffolding_two_storey" (rate ~£22/m²). Only use "site_setup_scaffold" for the one-off site setup lump sum (1 Nr).

If an element has no matching key, use "key": "custom_[description]" and set "needs_pricing": true.
IMPORTANT: You MUST also include "assumed_rate": <number> with your best estimate of the BASE UK market rate (UK national average, NO location uplift — location factors are applied automatically). NEVER leave assumed_rate as 0 — always provide a realistic per-unit rate in GBP.
CRITICAL: The assumed_rate must be a PER-UNIT rate matching the "unit" field. If unit is "m²", the rate is price per square metre (e.g. 42 not 4200). If unit is "Nr", it is price per number. Do NOT put the total cost in assumed_rate — put the rate per single unit only.

${clientRateSection}
${benchmarkSection || ''}

Respond with ONLY this JSON structure:
{
  "project_type": "e.g. Single Storey Rear Extension",
  "location": "full address or town/postcode",
  "floor_area_m2": 31.5,
  "items": [
    {
      "key": "concrete_slab_150mm",
      "description": "RC ground floor slab 150mm C25/30 A393 mesh on DPM",
      "unit": "m²",
      "qty": 31.5,
      "working": "Ground floor area: 6.3m x 5.0m = 31.5m²",
      "assumption": "150mm slab assumed, subject to engineer confirmation",
      "section": "1. Substructure & Foundations",
      "flagged": false,
      "flag_reason": ""
    }
  ],
  "anomalies": ["List any items that seemed unusually high or low"],
  "missing_info": ["List anything you could not determine from the drawings"],
  "confidence": "high|medium|low",
  "confidence_notes": "Reason for confidence level"
}`
  }

  if (forDocGen === 'generate_findings') {
    return `You are an expert UK Quantity Surveyor writing a professional Findings Report.
You will receive the complete priced BOQ data. Write the findings report narrative only.
You MUST respond with ONLY valid JSON — no markdown, no backticks.

Respond with this JSON structure:
{
  "reference": "AI-QS-XXXXX",
  "project_type": "e.g. Single Storey Rear Extension",
  "location": "Location",
  "description": "Detailed project description paragraph",
  "scope_summary": "Detailed scope summary",
  "key_findings": [{"title": "Category", "detail": "Detailed finding", "items": ["point 1", "point 2"]}],
  "assumptions": ["Detailed assumption 1"],
  "exclusions": ["Specific exclusion 1"],
  "recommendations": ["Specific recommendation 1"]
}`
  }

  if (forDocGen) {
    return `You are an expert UK Quantity Surveyor. You MUST respond with ONLY valid JSON — no markdown, no backticks, no explanation outside the JSON.

FIXED UK RATES — use these exact figures, no deviations:

NEW BUILD / EXTENSION RATES:
Excavation strip foundation: 95/m3 | Concrete strip foundation C25/30: 185/m3 | Blockwork below DPC 140mm: 68/m2 | DPC polythene: 5.50/m | Hardcore fill 200mm: 14/m2
Concrete slab 150mm reinforced: 78/m2 | Concrete slab 100mm: 50/m2 | PIR insulation under slab 150mm: 28/m2 | DPM 1200g: 4.50/m2
Brick outer leaf facing: 95/m2 | Cavity insulation EPS: 18/m2 | Blockwork inner leaf 100mm: 42/m2 | Cavity wall ties SS: 0.85/Nr
Cavity closers: 14/m | Steel lintels Catnic: 75/ea | Steel lintels bespoke: 1850/Item | Stud wall plasterboard both faces: 65/m2
Roof structure cut timber: 55/m2 | OSB sarking 18mm: 18/m2 | Breather membrane: 4.50/m2 | Tile battens: 9.50/m2
Roof tiles interlocking: 52/m2 | Fascia soffit guttering: 48/m | Lead flashing Code 4: 95/m | Roof insulation mineral wool: 28/m2
UPVC windows standard: 450/ea | Composite external door: 1850/ea | Composite external door standard: 1450/ea | Bi-fold door aluminium: 4400/ea

REFURBISHMENT / HERITAGE RATES:
Strip-out: General strip out: 18/m2 | Strip out kitchen: 450/Nr | Strip out bathroom: 350/Nr | Strip out heating: 750/Item | Strip out electrics: 450/Item | Strip out flooring: 8/m2 | Strip out plaster: 12/m2 | Strip out ceiling: 10/m2 | Soft strip room: 350/Nr
Heritage masonry: Lime mortar repointing: 85/m2 | Lime plaster walls: 48/m2 | Lime render external: 65/m2 | Stone repair indent: 125/Nr | Stone cleaning: 35/m2 | Crack stitching: 95/m | Wall tie replacement: 22/Nr | DPC injection: 45/m
Heritage roofing: Natural slate: 95/m2 | Clay plain tiles: 78/m2 | Lead sheet Code 5: 175/m2 | Lead flashing Code 5: 110/m | Flat roof felt: 65/m2 | Single ply membrane: 85/m2 | Chimney repair: 2500/Nr | Chimney rebuild: 4500/Nr
Heritage rainwater: Cast iron gutter: 85/m | Cast iron downpipe: 75/m | Cast iron hopper: 120/Nr | Aluminium gutter: 55/m
Heritage windows: Sash overhaul: 650/Nr | Sash replacement: 1800/Nr | Secondary glazing: 450/Nr | Timber casement: 950/Nr | Door refurbish: 350/Nr | Heritage front door: 2200/Nr
Damp/timber: Tanking slurry: 75/m2 | Timber treatment spray: 12/m2 | Timber splice repair: 185/Nr | Joist replacement: 45/m | Floorboard replacement: 35/m2 | Floor sanding: 28/m2
Heating: Gas combi boiler: 3200/Nr | Gas system boiler: 3800/Nr | Oil boiler: 4500/Nr | Hot water cylinder: 1200/Nr | Single radiator: 280/Nr | Double radiator: 380/Nr | Column radiator: 650/Nr | Heating pipework: 35/m | Heating controls: 450/Item | Gas supply/meter: 850/Item
Electrical: Full rewire: 85/m2 | Rewire per room: 850/Nr | Fire alarm LD2: 1200/Item | Intruder alarm: 1500/Item | TV/data point: 150/Nr | External lighting: 250/Nr
Decoration: Mist coat: 4/m2 | Emulsion walls 2 coat: 6.50/m2 | Emulsion ceiling: 7/m2 | Gloss woodwork: 12/m2 | External masonry paint: 9/m2 | Wallpaper: 18/m2
Insulation (refurb): Loft top-up: 12/m2 | Internal wall insulation: 55/m2 | External wall insulation: 95/m2 | Suspended floor insulation: 32/m2
Asbestos: Survey: 450/Item | Licensed removal: 1500/Item

SHARED RATES:
Internal doors painted solid core: 420/ea | Plasterboard and skim walls: 32/m2 | Plasterboard ceilings: 28/m2 | Metal stud partition: 58/m2
Wall tiling ceramic: 55/m2 | Wall tiling large format: 72/m2 | Floor tiling porcelain 600x600: 65/m2 | LVT flooring Karndean: 42/m2 | Carpet supply and fit: 28/m2 | Engineered timber: 55/m2 | Screed UFH 75mm: 85/m2 | Screed sand cement 75mm: 42/m2
Internal decorations (lump): 8.50/m2 | Skirting MDF 95mm: 18/m | External render two-coat: 55/m2
Kitchen mid: 8500/ea | Kitchen high: 15000/ea | Bathroom mid: 5500/ea | Bathroom high: 8500/ea | WC/cloakroom: 2800/ea | Shower room: 4200/ea
First fix electrical: 1350/item | Second fix electrical: 850/item | First fix plumbing: 1250/item | Second fix plumbing: 650/item
Consumer unit upgrade: 680/item | Extract fans: 320/Nr | Electrical testing certificate: 350/item
Velux skylight 780x980: 1650/Nr | Structural steelwork supply fab install: 3500/Item
Air source heat pump: 9500/Nr | UFH manifold: 1400/item
External: Paving slabs: 65/m2 | Block paving: 85/m2 | Tarmac: 55/m2 | Gravel: 25/m2 | Garden wall brick: 145/m2 | Retaining wall: 185/m2 | Drainage run: 125/m | Inspection chamber: 650/Nr | Landscaping: 2500/Item
Scaffolding: 22/m2 | Site setup scaffold: 2800/Item | Skip hire 8yd: 320/ea | Site welfare: 650/Item
Building control fees: 950/Item | Party wall surveyor: 1200/Item | Structural engineer fees: 2200/Item | Snagging clearance: 650/Item
Professional fees: Architect: 5500/Item | Planning application: 462/Item | CDM principal designer: 1800/Item | Project management: 3500/Item
Provisional sum: use qty as £ value with rate=1

LOCATION UPLIFT — apply as a multiplier to all rates: London/SE +20% | South East +15% | South West +5% | Midlands +7% | North West -2% | Yorkshire/North England -3% | Scotland +3% | Wales -4% | Ireland +10% use EUR
YOU MUST USE THESE EXACT RATES. Do not interpolate, estimate, or vary from these figures. If a client rate is marked VERIFIED use that instead.
${clientRateSection}
${clientInsightsSection}

CRITICAL REQUIREMENTS:
1. Include 40-100+ line items depending on project size — DO NOT produce sparse estimates
2. Break down composite items (e.g. cavity wall into inner leaf, insulation, outer leaf, ties)
3. Show proper quantities with working (e.g. "2no. walls @ 5.0m x 2.7m less openings")
4. Include ALL trades: prelims, demo, substructure, superstructure, roof, windows, doors, finishes, MEP, external works
5. Every item needs rate_source: "verified", "emerging", or "generic"
6. Include prelims (scaffolding, skip hire, site setup) but NOT professional fees (architect, planning, CDM, PM) unless client asks
7. The findings report must have detailed assumptions, exclusions, and recommendations

COST SANITY CHECKS — verify your total before responding:
- Typical single storey extension (25-40m2): construction cost £45,000-£100,000
- Typical two storey extension (40-70m2): construction cost £80,000-£180,000
- Typical loft conversion: construction cost £35,000-£75,000
- Typical whole-house refurbishment (100-200m2): construction cost £80,000-£250,000
- Typical heritage/listed refurbishment: add 15-30% over standard refurbishment
- Cost per m2 for UK residential extensions: typically £1,800-£3,000/m2 (construction only, before contingency/OH&P/VAT)
- Cost per m2 for UK refurbishment: typically £800-£1,800/m2 depending on scope
- AIM FOR THE MIDDLE of these ranges — most projects should fall in the lower half
- If your total is near the TOP of these ranges, re-check quantities for errors: wrong units, doubled areas, overlapping items, or building-level quantities instead of element-level
- No single line item for a residential project should exceed £25,000 unless genuinely high-value (e.g. bi-fold doors, kitchen, ASHP)
- Do NOT double-count: if you break cavity wall into components, do NOT also include a separate cavity wall lump sum
- For refurbishment: ALWAYS include strip-out BEFORE new work. Break decoration per room where scope allows

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
8. Include PRELIMS (site setup, welfare, skip hire, scaffolding) but NOT professional fees (architect, planning, CDM, PM) unless client specifically asks
9. Include CONTINGENCY (7.5%) and OH&P (12%) — use these exact percentages, not ranges
10. Note whether VAT applies
11. NEVER double-count: if you include a fit-out lump sum (kitchen_fitout_mid, bathroom_fitout_mid) do NOT also price individual items within that fit-out. If you include first_fix_plumbing do NOT also price individual pipe runs

DETAIL EXPECTATIONS — MINIMUM STANDARDS:
- For a standard single-storey extension: expect 35-55 line items covering ALL trades
- For a two-storey extension or conversion: expect 50-80 line items covering ALL trades
- For a full refurb: expect 70-120 line items covering ALL trades
- Every trade must be represented — a missing section is WORSE than an imprecise quantity
- If the project involves demolition, you MUST break it down (strip roof, demolish walls, break out slab — NOT just "demolition")
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

FIXED UK RATES (use these exact figures — no ranges, no deviations):
DEMOLITION: Strip out existing roof: 2200/Item | Demolish existing walls: 2800/Item | Break out existing slab: 85/m2 | Cut back existing finishes at interface: 1400/Item | Asbestos survey: 450/Item | Garage demolition: 3500/Item
SUBSTRUCTURE: Excavation strip foundation: 75/m3 | Concrete strip foundation C25/30: 185/m3 | Blockwork below DPC 140mm: 68/m2 | DPC polythene: 5.50/m | Hardcore fill: 14/m2 | Concrete slab 150mm: 78/m2 | PIR insulation 150mm: 28/m2 | DPM 1200g: 4.50/m2 | Screed sand cement 75mm: 42/m2
WALLS: Brick outer leaf facing: 82/m2 | Cavity insulation EPS: 18/m2 | Blockwork inner leaf 100mm: 42/m2 | Cavity wall ties SS: 0.85/Nr | Cavity closers: 14/m | Steel lintels Catnic: 75/ea | Stud wall both faces: 65/m2 | External render: 55/m2
ROOF: Attic trusses prefab (room-in-roof): 12000/Item LUMP SUM | Roof structure cut timber (simple): 55/m2 | OSB sarking: 22/m2 | Breather membrane: 8/m2 | Tile battens: 12/m2 | Roof tiles interlocking: 68/m2 | Fascia soffit guttering: 45/m | Lead flashing Code 4: 95/m | Roof insulation Thermaroof: 82/m2 | Velux 780x980: 1450/Nr | Velux 940x1178: 1450/Nr | Velux balcony 940x2520: 4200/Nr
WINDOWS & DOORS: Bi-fold small (up to 2m): 2500/ea | Bi-fold medium (2-3m): 3200/ea | Bi-fold large (3m+): 4500/ea | UPVC bi-fold/patio: 2400/ea | Composite external door: 1250/ea | UPVC window small: 350/ea | UPVC window standard: 450/ea | UPVC window large: 580/ea | Window obscure small: 380/ea | Window obscure standard: 520/ea | Internal door solid core: 380/ea | Internal door glazed: 480/ea | Mastic sealant: 12/m
INTERNAL: Plasterboard skim walls: 32/m2 | Plasterboard ceilings: 28/m2 | Fire-rated plasterboard: 52/m2 | Moisture-resistant plasterboard: 42/m2 | Metal stud partition: 58/m2 | Skirting MDF 95mm: 18/m
FINISHES: Internal decorations: 8.50/m2 | LVT Karndean: 42/m2 | LVT luxury: 55/m2 | Floor tile 600x600: 65/m2 | Carpet supply fit: 28/m2 | Wall tiling ceramic: 55/m2 | Ceramic tiles en-suite: 72/m2 | Screed UFH 75mm: 85/m2
FIT-OUTS: Kitchen mid: 8500/ea | Kitchen high: 15000/ea | Bathroom mid: 5500/ea | Bathroom high: 8500/ea
STAIRCASE: Timber staircase complete: 4800/ea | Stair opening formation: 750/Item
DRAINAGE: Foul drainage 110mm connection: 2800/Item | Rainwater drainage: 1200/Item | Surface water drainage: 65/m
M&P: Heating extension to new rooms: 4200/Item | En-suite sanitary plumbing: 3800/Item | Utility plumbing: 2500/Item | First fix plumbing: 1250/Item | Second fix plumbing: 650/Item
ELECTRICAL: Consumer unit extend: 3200/Item | Lighting circuit: 1800/Item | Power sockets circuit: 1400/Item | Smoke/heat/CO detection: 850/Item | Extract fans: 320/Nr
PRELIMS: Scaffolding: 22/m2 | Site setup scaffold: 2200/Item | Skip hire 8yd: 320/ea | Building control fees: 950/Item | Structural engineer: 2200/Item

LOCATION FACTORS:
London/SE: +20% | South East: +15% | Midlands: +7% | North West: -2% | Yorkshire/North England: -3% | Scotland: +3% | Wales: -4% | Ireland: +10% (use EUR)

COST SANITY CHECKS — you MUST verify your total before responding:
- Typical single storey extension (25-40m2): construction cost £45,000-£100,000
- Typical two storey extension (40-70m2): construction cost £80,000-£180,000
- Typical loft conversion: construction cost £35,000-£75,000
- Cost per m2 for UK residential extensions: typically £1,800-£3,000/m2 (construction only, before contingency/OH&P/VAT)
- AIM FOR THE MIDDLE of these ranges — most projects should fall in the lower half unless the spec clearly justifies higher
- If your total is near the TOP of these ranges, STOP and re-check for: wrong units, doubled areas, overlapping items, building-level quantities applied at element-level rates, unnecessary items
- No single line item for a residential project should exceed £20,000 unless genuinely high-value (e.g. bi-fold doors, kitchen, ASHP)
- Do NOT double-count: if you break cavity wall into brick + insulation + blockwork + ties, do NOT also include a separate "cavity wall" lump sum
- Do NOT double-count fit-outs: if you use kitchen_fitout_mid or bathroom_fitout_mid, do NOT also include individual items within those fit-outs
- MEP rates above are PER CIRCUIT/ZONE, not per socket or fitting. A typical extension has 1-2 electrical circuits and 1 plumbing circuit
- Do NOT include professional fees (architect, planning, CDM, project management) unless the client specifically requests them
${clientRateSection}
${clientInsightsSection}
DOCUMENT GENERATION — CRITICAL RULES:

Rule 1 — This portal DOES generate real downloadable Excel BOQ and Word Findings Report files directly. NEVER say you cannot generate files. NEVER say you are text-based. NEVER tell a client to copy data into Excel themselves. NEVER suggest the portal "may" generate files elsewhere. The files are generated automatically by the backend the moment the client triggers generation.

Rule 2 — Only refuse to generate if the client has sent a generate command as their VERY FIRST message with absolutely no prior conversation and no drawings uploaded. In that case, ask for drawings or scope first.

Rule 3 — If ANY project information exists in the conversation (drawings, scope description, quantities, location, project type), treat a "generate" command as valid and confirm documents are being generated.

After providing analysis, always end with: "Just say 'generate documents' and I will create your Excel BOQ and Word Findings Report."

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

All estimates are approximate, subject to detailed measurement and site conditions.

WHEN A CLIENT UPLOADS AN EXCEL FILE: Read the data carefully. It may be a BOQ, rate schedule, contractor quote, or project data. Analyse it thoroughly and respond professionally based on its contents. Do not say the file is corrupted or unreadable — always work with what you can extract.`;
}

// ═══════════════════════════════════════════════════════════════════════
// FILE PROCESSING
// ═══════════════════════════════════════════════════════════════════════

const VISUAL_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
const TEXT_EXTS = ['.txt', '.csv', '.json', '.xml', '.html', '.htm', '.md'];
const CAD_EXTS = ['.dwg', '.dxf', '.rvt', '.ifc', '.skp'];
const OFFICE_EXTS = ['.docx', '.doc', '.pptx', '.ppt'];
const EXCEL_EXTS = ['.xlsx', '.xls'];

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

// ── Robust Excel to text conversion ──────────────────────────────
function excelToText(filePath, originalName) {
  try {
    const XLSX = require('xlsx');

    // Read as buffer — cellFormula:true preserves cached formula results in cell.v
    let wb = null;
    const buf = fs.readFileSync(filePath);
    const strategies = [
      { cellFormula: true, cellStyles: false, cellNF: false, WTF: false },
      { cellFormula: false, cellStyles: false, cellNF: false, WTF: false },
      {},
    ];
    for (const opts of strategies) {
      try {
        wb = XLSX.read(buf, opts);
        if (wb && wb.SheetNames && wb.SheetNames.length > 0) break;
      } catch(e) {
        console.log(`[Excel] Read strategy failed: ${e.message}`);
        wb = null;
      }
    }

    if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
      console.error('[Excel] All read strategies failed for:', originalName);
      return null;
    }

    let output = `[Excel file: ${originalName}]\n\n`;
    let totalRows = 0;

    for (const sheetName of wb.SheetNames) {
      try {
        const ws = wb.Sheets[sheetName];
        if (!ws || !ws['!ref']) continue;

        const range = XLSX.utils.decode_range(ws['!ref']);
        const rows = [];

        for (let R = range.s.r; R <= range.e.r; R++) {
          const row = [];
          let hasContent = false;
          for (let C = range.s.c; C <= range.e.c; C++) {
            const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[cellAddr];
            let val = '';
            if (cell) {
              // w = formatted display string (best), v = raw/cached value (fallback)
              if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== '') {
                val = String(cell.w).trim();
              } else if (cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
                val = String(cell.v).trim();
              }
              if (val) hasContent = true;
            }
            row.push(val);
          }
          if (hasContent) {
            rows.push(row.join('\t'));
            totalRows++;
          }
        }

        if (rows.length > 0) {
          output += `Sheet: ${sheetName}\n${rows.join('\n')}\n\n`;
        }
      } catch (sheetErr) {
        console.error(`[Excel] Sheet ${sheetName} error:`, sheetErr.message);
      }
    }

    if (totalRows === 0) {
      console.error('[Excel] No data extracted from:', originalName);
      return null;
    }

    console.log(`[Excel] Extracted ${totalRows} rows from ${wb.SheetNames.length} sheet(s): ${originalName}`);
    return output.trim();

  } catch (err) {
    console.error('[Excel] Fatal parse error:', err.message);
    return null;
  }
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
      } else if (EXCEL_EXTS.includes(ext)) {
        try {
          const tmpPath = path.join(uploadsDir, `${uuidv4()}${ext}`);
          fs.writeFileSync(tmpPath, entry.getData());
          const excelText = excelToText(tmpPath, name);
          if (excelText) extracted.text.push({ name, content: excelText });
          else extracted.skipped.push(name);
          try { fs.unlinkSync(tmpPath); } catch(e) {}
        } catch(e) { extracted.skipped.push(name); }
      } else if (CAD_EXTS.includes(ext)) {
        extracted.cad.push(name);
      } else if (OFFICE_EXTS.includes(ext)) {
        extracted.skipped.push(name);
      } else {
        try {
          const fd=entry.getData(); const dt=detectFileType(fd);
          if(dt&&VISUAL_EXTS.includes(dt.ext)){const op=path.join(uploadsDir,`${uuidv4()}${dt.ext}`);fs.writeFileSync(op,fd);extracted.visual.push({path:op,name:`${name}(${dt.ext})`,ext:dt.ext});}
          else{extracted.skipped.push(name);}
        } catch(e){extracted.skipped.push(name);}
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
    const sessions = db.prepare(`SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`).all(req.user.id);
    res.json({ sessions });
  } catch (e) { console.error('[ChatSessions] Load error:', e.message); res.json({ sessions: [] }); }
});

router.get('/chat-sessions/:id', authMiddleware, (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ...session, messages: JSON.parse(session.messages || '[]') });
  } catch (e) { console.error('[ChatSessions] Get error:', e.message); res.status(500).json({ error: 'Failed to load session' }); }
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
      db.prepare('UPDATE chat_sessions SET title = ?, messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(sessionTitle, JSON.stringify(messages), sessionId, req.user.id);
    } else {
      db.prepare('INSERT INTO chat_sessions (id, user_id, title, messages) VALUES (?, ?, ?, ?)').run(sessionId, req.user.id, sessionTitle, JSON.stringify(messages));
    }
    res.json({ id: sessionId, title: sessionTitle });
  } catch (e) { console.error('[ChatSessions] Save error:', e.message); res.status(500).json({ error: 'Failed to save session' }); }
});

router.delete('/chat-sessions/:id', authMiddleware, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (e) { console.error('[ChatSessions] Delete error:', e.message); res.status(500).json({ error: 'Failed to delete session' }); }
});

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
  } catch (e) { console.error('[Projects] Delete error:', e.message); res.status(500).json({ error: 'Failed to delete project' }); }
});

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
    const tx = db.transaction(() => { for (const r of rates) insert.run('rl_' + uuidv4().slice(0, 8), paul.id, r.category, r.item_key, r.display_name, r.value, r.unit, r.confidence); });
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
  const mt = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf': 'application/pdf' };
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
// TENDER RETURN FEEDBACK — feed real contractor prices back into rates
// ═══════════════════════════════════════════════════════════════════════

router.post('/tender-return', authMiddleware, (req, res) => {
  try {
    const { takeoff_id, items } = req.body;
    // items = [{ key: 'brick_outer_leaf', actual_rate: 78, actual_qty: 45.5, notes: '' }, ...]
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required with actual_rate values' });
    }

    const userId = req.user.id;
    const results = [];

    // Ensure tender_returns table exists
    db.exec(`CREATE TABLE IF NOT EXISTS tender_returns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      takeoff_id TEXT,
      item_key TEXT NOT NULL,
      estimated_rate REAL,
      actual_rate REAL NOT NULL,
      actual_qty REAL,
      variance_pct REAL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    const insertStmt = db.prepare(`INSERT INTO tender_returns (id, user_id, takeoff_id, item_key, estimated_rate, actual_rate, actual_qty, variance_pct, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const upsertRate = db.prepare(`INSERT INTO client_rate_library (id, user_id, item_key, value, source, confidence, is_active, created_at) VALUES (?, ?, ?, ?, 'tender_return', 0.95, 1, CURRENT_TIMESTAMP) ON CONFLICT(user_id, item_key) DO UPDATE SET value = ?, source = 'tender_return', confidence = 0.95, updated_at = CURRENT_TIMESTAMP`);

    const tx = db.transaction(() => {
      for (const item of items) {
        if (!item.key || !item.actual_rate || item.actual_rate <= 0) continue;

        // Get estimated rate from BASE_RATES for variance calculation
        const baseRate = deterministicPricer ? (deterministicPricer.getBaseRate ? deterministicPricer.getBaseRate(item.key) : null) : null;
        const estimatedRate = baseRate ? baseRate.rate : null;
        const variancePct = estimatedRate ? Math.round(((item.actual_rate - estimatedRate) / estimatedRate) * 100 * 10) / 10 : null;

        const trId = 'tr_' + uuidv4().slice(0, 8);
        insertStmt.run(trId, userId, takeoff_id || null, item.key, estimatedRate, item.actual_rate, item.actual_qty || null, variancePct, item.notes || '');

        // Update client rate library with the real tender price
        const crId = 'cr_' + uuidv4().slice(0, 8);
        upsertRate.run(crId, userId, item.key, item.actual_rate, item.actual_rate);

        results.push({
          key: item.key,
          estimated: estimatedRate,
          actual: item.actual_rate,
          variance_pct: variancePct,
          saved: true,
        });

        // Feed into memory engine if available
        if (memoryEngine) {
          try {
            memoryEngine.recordRate(db, {
              itemKey: item.key,
              rate: item.actual_rate,
              source: 'tender_return',
              userId,
              region: 'unknown',
              projectType: 'unknown',
            });
          } catch(me) {}
        }
      }
    });
    tx();

    console.log(`[Tender Return] ${results.length} actual rates saved for user ${userId}`);
    res.json({
      success: true,
      rates_updated: results.length,
      results,
      message: `${results.length} tender return rates saved. These will be used for all future projects.`,
    });
  } catch(e) {
    console.error('[Tender Return] Error:', e.message);
    res.status(500).json({ error: 'Failed to save tender return' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// QUANTITY TAKEOFF ROUTES
// ═══════════════════════════════════════════════════════════════════════

// Get locked takeoff for a session
router.get('/takeoff/:sessionId', authMiddleware, (req, res) => {
  try {
    if (!benchmarkStore) return res.status(503).json({ error: 'Benchmark store not available' });
    const takeoff = benchmarkStore.getTakeoffBySession(db, req.params.sessionId);
    if (!takeoff) return res.status(404).json({ error: 'No takeoff found for this session' });
    if (takeoff.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    res.json({ takeoff });
  } catch (e) { res.status(500).json({ error: 'Failed to load takeoff' }); }
});

// Update takeoff items (user corrections before generating)
router.put('/takeoff/:id', authMiddleware, (req, res) => {
  try {
    if (!benchmarkStore) return res.status(503).json({ error: 'Benchmark store not available' });
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
    const takeoff = benchmarkStore.getTakeoffById(db, req.params.id);
    if (!takeoff) return res.status(404).json({ error: 'Takeoff not found' });
    if (takeoff.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    benchmarkStore.updateTakeoff(db, req.params.id, { items });
    // Re-price with updated items
    const clientRates = {};
    try {
      const dbRates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(req.user.id);
      for (const r of dbRates) clientRates[r.item_key] = r.value;
    } catch(e) {}
    const priced = deterministicPricer.priceLockedQuantities(items, takeoff.location || '', clientRates, { contingency_pct: 7.5, ohp_pct: 12, vat_rate: 20 });
    res.json({ success: true, priced });
  } catch (e) { console.error('[Takeoff] Update error:', e.message); res.status(500).json({ error: 'Failed to update takeoff' }); }
});

// ═══════════════════════════════════════════════════════════════════════
// MEMORY ENGINE ROUTES
// ═══════════════════════════════════════════════════════════════════════

// GET /api/memory/stats — what has the system learned?
router.get('/memory/stats', authMiddleware, (req, res) => {
  try {
    if (!memoryEngine) return res.status(503).json({ error: 'Memory engine not available' });
    const stats = memoryEngine.getMemoryStats(db);
    const clientCtx = memoryEngine.getClientContext(db, req.user.id);
    res.json({ stats, client: clientCtx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/memory/rates — top learned rates for this client
router.get('/memory/rates', authMiddleware, (req, res) => {
  try {
    if (!memoryEngine) return res.status(503).json({ error: 'Memory engine not available' });
    const rates = db.prepare(`
      SELECT item_key, rate, sample_count, confidence, region, project_type, last_seen
      FROM memory_rates
      WHERE (scope='client' AND user_id=?) OR (scope='global')
      ORDER BY scope='client' DESC, confidence DESC, sample_count DESC
      LIMIT 100
    `).all(req.user.id);
    res.json({ rates, count: rates.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/memory/benchmarks/:projectType — quantity ranges for a project type
router.get('/memory/benchmarks/:projectType', authMiddleware, (req, res) => {
  try {
    if (!memoryEngine) return res.status(503).json({ error: 'Memory engine not available' });
    const ranges = memoryEngine.getQuantityRanges(db, {
      projectType: req.params.projectType,
      floorAreaM2: parseFloat(req.query.area) || null,
    });
    const projectStats = memoryEngine.getProjectBenchmarks(db, {
      projectType: req.params.projectType,
      region: req.query.region || 'uk_average',
    });
    res.json({ quantity_ranges: ranges, project_stats: projectStats, project_type: req.params.projectType });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/memory/correction — manual correction entry
router.post('/memory/correction', authMiddleware, (req, res) => {
  try {
    if (!memoryEngine) return res.status(503).json({ error: 'Memory engine not available' });
    const { itemKey, field, oldValue, newValue, reason } = req.body;
    if (!field || newValue === undefined) return res.status(400).json({ error: 'field and newValue required' });
    memoryEngine.recordCorrection(db, { userId: req.user.id, itemKey, field, oldValue, newValue, reason });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      starter:      { messages: 10,  label: 'Starter' },
      professional: { messages: 100, label: 'Professional' },
      premium:      { messages: 200, label: 'Premium' },
      admin:        { messages: -1,  label: 'Admin' },
    };

    if (req.user.role !== 'admin') {
      const plan = req.user.plan || 'starter';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
      const bonusMsgs = req.user.bonus_messages || 0;
      const effectiveLimit = limits.messages + bonusMsgs;
      if (effectiveLimit > 0) {
        const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
        const used = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message' AND created_at>=?").get(userId, mStart.toISOString());
        if (used.c >= effectiveLimit) {
          return res.status(429).json({ error: `You've used all ${effectiveLimit} messages this month on the ${limits.label} plan. Upgrade to Professional for 100 messages/month, or contact us to add more credits.`, limit_type: 'messages', used: used.c, limit: effectiveLimit, plan });
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
          // ── NEW: Smart ZIP pre-processor ────────────────────────────
          // Extracts annotated dimensions, room schedules, opening schedules
          // from PDFs, Excel, Word, and images BEFORE Claude sees anything.
          // Claude gets pre-extracted facts, not raw pixels.
          if (zipProcessor) {
            try {
              console.log(`[ZIP] Running smart pre-processor on ${file.originalname}`);
              const zipData = await zipProcessor.processZip(file.path, uploadsDir);
              req.zipData = zipData; // stash for later use in extraction stage

              // Build structured Claude content from ZIP
              const zipContent = zipProcessor.buildClaudeContent(zipData, null);
              for (const block of zipContent) currentContent.push(block);

              // Add filenames for all files in zip
              for (const f of zipData.drawing_index) fileNames.push(f.filename);

              // Summary note
              const summary = zipProcessor.buildUploadSummary(zipData);
              zipNotes.push(`[ZIP Pre-processed]
${summary}`);

              console.log(`[ZIP] Pre-processing complete: ${zipData.drawing_index.length} files, ${zipData.all_dimensions.length} dimensions, ${zipData.all_rooms.length} rooms`);
            } catch (zipErr) {
              console.error('[ZIP] Smart processor failed, falling back to legacy:', zipErr.message);
              // Fallback to old method
              const ex = extractFromZip(file.path);
              for (const ef of ex.visual) { const b=fileToContentBlock(ef.path,ef.ext); if(b){currentContent.push(b);fileNames.push(ef.name);} }
              for (const tf of ex.text) { currentContent.push({type:'text',text:`[${tf.name}]:\n${tf.content}`}); fileNames.push(tf.name); }
              if (ex.cad.length > 0) zipNotes.push(`Found ${ex.cad.length} CAD file(s) — export as PDF and re-upload.`);
            }
          } else {
            // Legacy ZIP handler (fallback if zipProcessor not installed)
            const ex = extractFromZip(file.path);
            for (const ef of ex.visual) { const b=fileToContentBlock(ef.path,ef.ext); if(b){currentContent.push(b);fileNames.push(ef.name);} }
            for (const tf of ex.text) { currentContent.push({type:'text',text:`[${tf.name}]:\n${tf.content}`}); fileNames.push(tf.name); }
            if (ex.cad.length > 0) zipNotes.push(`Found ${ex.cad.length} CAD file(s) (${ex.cad.join(', ')}) -- export as PDF and re-upload.`);
            if (ex.skipped.length > 0) zipNotes.push(`${ex.skipped.length} file(s) couldn't be processed.`);
            if (ex.visual.length === 0 && ex.text.length === 0) zipNotes.push(ex.cad.length > 0 ? 'ZIP only contains CAD files -- export as PDF.' : 'No supported files in ZIP.');
          }

        } else if (EXCEL_EXTS.includes(ext)) {
          const excelText = excelToText(file.path, file.originalname);
          if (excelText) {
            currentContent.push({ type: 'text', text: excelText });
            fileNames.push(file.originalname);
            console.log(`[Upload] Excel converted successfully: ${file.originalname}`);
          } else {
            // Even if parsing fails, tell Claude about the file and let it respond gracefully
            currentContent.push({ type: 'text', text: `[Excel file uploaded: ${file.originalname}]\n\nNote: The file data could not be fully extracted. Please ask the user to describe the contents or re-save as a simpler Excel format.` });
            fileNames.push(file.originalname);
            console.log(`[Upload] Excel parse failed, sending placeholder: ${file.originalname}`);
          }

        } else {
          const b = fileToContentBlock(file.path, ext);
          if (b) { currentContent.push(b); fileNames.push(file.originalname); }
        }
      }
    }

    // Extract session ID from body for takeoff tracking
    const sessionIdForTakeoff = req.body.session_id || null;
    let textMessage = message || '';
    if (zipNotes.length > 0) {
      const n = zipNotes.join('\n');
      if (textMessage) textMessage = `[Uploaded: ${fileNames.join(', ')}]\n\n${textMessage}\n\n[System: ${n}]`;
      else if (fileNames.length > 0) textMessage = `Please analyse these files: ${fileNames.join(', ')}\n\n[System: ${n}]`;
      else textMessage = `[System: ${n}]\n\nLet the user know about the file issue.`;
    } else if (fileNames.length > 0 && !textMessage) {
      const isExcel = fileNames.some(n => n.match(/\.xlsx?$/i));
      textMessage = isExcel ? `Please review and analyse this spreadsheet: ${fileNames.join(', ')}` : `Please analyse these construction drawings: ${fileNames.join(', ')}`;
    } else if (fileNames.length > 0) {
      textMessage = `[Uploaded: ${fileNames.join(', ')}]\n\n${textMessage}`;
    }

    if (textMessage) currentContent.push({ type: 'text', text: textMessage });
    if (currentContent.length === 0) return res.status(400).json({ error: 'Please provide a message or upload a file' });

    messages.push({ role: 'user', content: currentContent });

    const systemPrompt = buildSystemPrompt(userId, false);
    const hasFiles = fileNames.length > 0;
    const primaryModel = hasFiles ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
    const primaryBudget = hasFiles ? 8000 : 5000;
    console.log(`[API] Using ${hasFiles ? 'Sonnet (files)' : 'Haiku (text chat)'}`);

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

    // ═══════════════════════════════════════════════════════════════
    // 3-STAGE DETERMINISTIC PIPELINE
    // Stage 1: EXTRACT quantities (AI measures, shows working, saves to DB)
    // Stage 2: LOCK quantities (user confirms, stored in quantity_takeoffs)
    // Stage 3: GENERATE (Node.js prices deterministically, AI writes findings)
    // ═══════════════════════════════════════════════════════════════

    const allConvText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ') + ' ' + (message || '');
    const wantsDocumentsRaw = /\bgenerate\b|generate\s*(the\s*)?(document|boq|report|excel|file|findings)|create\s*(the\s*)?(boq|report|document|excel)|download\s*(the\s*)?(boq|report|document|excel|file)|produce\s*(the\s*)?(boq|report|document)|make\s*(me\s*)?(the\s*)?(boq|report|document)|give\s*me\s*(the\s*)?(document|boq|report|file|excel)|\.xlsx|\.docx|findings\s*report/i.test(message || '');
    // Detect if text-only chat describes a construction project worth pricing
    // This triggers the deterministic pricing pipeline even without file uploads
    const describesPricingProject = !hasFiles && !wantsDocumentsRaw && /\b(extension|loft\s*conv|storey|refurb|renovation|conversion|new\s*build|garage|kitchen\s*ext|rear\s*ext|side\s*ext|wrap.?around|dormer|basement|annex|granny\s*flat|garden\s*room|orangery|conservatory|strip\s*out|rewire|repoint|damp\s*proof|heritage|listed\s*build|period\s*property|victorian|edwardian|georgian|whole\s*house|internal\s*&?\s*external|complete\s*refurb|gut\s*renovat|full\s*renovat)\b/i.test(allConvText)
      && /\b(\d+\s*m[2²]|\d+\s*sq|\d+m\s*x\s*\d+m|\d+\s*metre|\d+\s*meter|\d+\s*foot|\d+\s*ft|bedroom|bathroom|kitchen|open\s*plan|room|floor|storey|story)\b/i.test(allConvText);
    const wantsExtract = (hasFiles || describesPricingProject) && !wantsDocumentsRaw; // files uploaded OR text describes a project = extract phase
    const sessionId = req.body.session_id || null;
    let wantsDocuments = wantsDocumentsRaw;
    let downloadFiles = null;
    let paymentRequired = null;
    let takeoffData = null;

    // If session has a locked takeoff and this is a short non-file message (e.g. "Dublin", "yes", "ok"),
    // override the general AI reply with a focused response that acknowledges and moves forward
    if (!hasFiles && !wantsDocuments && sessionId && benchmarkStore) {
      try {
        const existingTakeoff = benchmarkStore.getTakeoffBySession(db, sessionId);
        if (existingTakeoff && existingTakeoff.items && existingTakeoff.items.length > 0) {
          const msgLen = (message || '').trim().length;
          if (msgLen < 80) {
            const isLocation = /dublin|cork|galway|london|manchester|birmingham|edinburgh|glasgow|cardiff|belfast|bristol|leeds|sheffield|liverpool|ireland|uk/i.test(message || '');
            const isConfirm = /^(yes|ok|okay|sure|fine|go|proceed|correct|sounds good|perfect|great)/i.test((message || '').trim());
            if (isLocation || isConfirm) {
              const locLabel = isLocation ? (message || '').trim() : (existingTakeoff.location || 'location noted');
              reply = 'Got it - ' + locLabel + ' noted. Quantities locked (ref: ' + existingTakeoff.id + ') with ' + existingTakeoff.items.length + ' items. Say "generate documents" and I will produce your Excel BOQ and Word Findings Report.';
            }
          }
        }
      } catch(e) {}
    }

    // Guard: refuse doc generation if no project data exists
    if (wantsDocuments) {
      const hasProjectData = fileNames.length > 0 || messages.some(m => {
        const txt = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.filter(c => c.type === 'text').map(c => c.text).join(' ') : '');
        return txt.length > 100;
      });
      if (!hasProjectData) {
        wantsDocuments = false;
        reply = 'To generate a BOQ and Findings Report I need project information first. Please upload your drawings (PDF, images, or ZIP) or describe the scope of works, and I will produce a detailed estimate for you.';
      }
    }

    // ── STAGE 1: QUANTITY EXTRACTION ─────────────────────────────────
    // Triggered when files are uploaded. AI extracts locked quantities with working.

    // Before extracting: check if we know the project address
    // Address = currency + VAT rate + location factor. Without it, everything is wrong.
    // Address detection — extract location from all conversation text
    // We no longer BLOCK extraction, but we note if address is unknown
    // and ask for it alongside the quantity summary
    const allTextForAddr = [message || '', ...messages.map(m => typeof m.content === 'string' ? m.content : '')].join(' ');
    const hasAddress = /\b(\d+\s+[A-Za-z]+.*(?:road|street|lane|avenue|drive|close|way|crescent|place|court|gardens|terrace|grove|row|walk|square|park|rd|st|ave|ln|dr)|dublin|cork|galway|limerick|london|manchester|birmingham|bristol|leeds|edinburgh|glasgow|cardiff|belfast|liverpool|sheffield|newcastle|nottingham|leicester|coventry|exeter|brighton|oxford|cambridge|reading|[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2})/i.test(allTextForAddr);

    if (wantsExtract && deterministicPricer && benchmarkStore && !wantsDocuments) {
      // Check if session already has a locked takeoff — don't re-extract
      let existingTakeoffForExtract = null;
      if (sessionId && benchmarkStore) {
        try { existingTakeoffForExtract = benchmarkStore.getTakeoffBySession(db, sessionId); } catch(e) {}
      }
      const shouldExtract = !existingTakeoffForExtract || !existingTakeoffForExtract.items || existingTakeoffForExtract.items.length === 0;

      if (shouldExtract) {
      console.log(`[Stage 1] Extracting quantities from ${hasFiles ? 'drawings' : 'text description'}...`);
      try {
        // Get project type from conversation context
        const allConvText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ') + ' ' + (message || '');
        const projectTypeGuess = /loft/i.test(allConvText) ? 'Loft Conversion' :
          /two.stor/i.test(allConvText) ? 'Two Storey Extension' :
          /single.stor|rear.ext|side.ext/i.test(allConvText) ? 'Single Storey Extension' :
          /heritage|listed\s*build|grade\s*(i|ii|1|2)/i.test(allConvText) ? 'Heritage Refurbishment' :
          /whole\s*house|complete\s*refurb|full\s*renovat|gut\s*renovat|internal\s*&?\s*external/i.test(allConvText) ? 'Whole House Refurbishment' :
          /refurb|renovation|strip\s*out|rewire|repoint/i.test(allConvText) ? 'Refurbishment' :
          /conversion|flat|apartment/i.test(allConvText) ? 'Conversion' :
          /new.build/i.test(allConvText) ? 'New Build' : 'General';

        // Load full memory context for sanity checking + rate guidance
        const locationGuess = (messages.concat([{role:'user',content:message||''}]))
          .map(m => typeof m.content === 'string' ? m.content : '').join(' ')
          .match(/([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}|[A-Z][a-z]+(?:,?\s[A-Z][a-z]+)*,?\s(?:London|Manchester|Birmingham|Bristol|Edinburgh|Glasgow|Cardiff|Dublin|Cork|Richmond|Surrey|Essex|Kent|Devon|Somerset|Yorkshire|Lancashire|Cheshire|Cumbria|Northampton|Leicester|Nottingham|Derby|Coventry|Oxford|Cambridge|Reading|Brighton|Guildford))/)?.[0] || '';
        const memoryCtx = memoryEngine
          ? memoryEngine.buildMemoryContext(db, { userId, projectType: projectTypeGuess, region: memoryEngine.detectRegion(locationGuess) })
          : (benchmarkStore ? benchmarkStore.formatBenchmarksForPrompt(benchmarkStore.getBenchmarkRanges(db, projectTypeGuess, null), projectTypeGuess) : '');

        const extractPrompt = buildSystemPrompt(userId, hasFiles ? 'extract_quantities' : 'extract_quantities_text', memoryCtx);

        // If ZIP was pre-processed, inject the structured data as additional context
        // This gives Claude pre-extracted dimensions/rooms/schedules as facts to work from
        let extractContent = currentContent;
        if (req.zipData && zipProcessor) {
          const zipFloorArea = req.zipData.summary.total_floor_area_m2;
          if (zipFloorArea > 0) {
            // Use confirmed floor area from room schedule for better sanity checking
            extractContent = [
              ...currentContent,
              {
                type: 'text',
                text: `\n\nCRITICAL: The room schedule in this ZIP shows a total floor area of ${zipFloorArea.toFixed(1)}m². Use this as your primary floor area figure — do NOT estimate it. All floor-area-derived quantities should use ${zipFloorArea.toFixed(1)}m².`,
              },
            ];
          }
        }

        const extractMessages = [...messages, { role: 'user', content: extractContent }];

        const extractResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: apiHeaders,
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            system: extractPrompt,
            messages: extractMessages
          })
        });

        if (extractResp.ok) {
          const extractData = await extractResp.json();
          const rawText = extractData.content.filter(c => c.type === 'text').map(c => c.text).join('');
          const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          const parsed = JSON.parse(cleaned);

          if (parsed.items && parsed.items.length > 0) {
            // ═══════════════════════════════════════════════════════════
            // STAGE 1b: VALIDATION PASS — second AI reviews first pass
            // Like a senior QS checking a junior's takeoff
            // ═══════════════════════════════════════════════════════════
            console.log(`[Stage 1b] Validating ${parsed.items.length} extracted items...`);
            try {
              const validationPrompt = `You are a SENIOR UK Quantity Surveyor reviewing a junior QS's quantity takeoff. Your job is to find errors, not confirm — be critical.

You will receive:
1. The original drawings/project description (in the conversation)
2. The extracted items JSON from the junior QS

YOUR REVIEW CHECKLIST:
1. QUANTITIES — Check every quantity against the working shown. Recalculate key measurements:
   - Wall areas: perimeter × height minus openings (recalculate, don't trust the junior's figure)
   - Floor areas: length × width (check against drawings if visible)
   - Roof areas: floor area × pitch factor (1.0 flat, 1.15 standard pitch, 1.3 steep)
   - Foundation lengths: check perimeter matches drawing dimensions
   - Volume items: length × width × depth (check each dimension)

2. MISSING ITEMS — Check against the drawings for items the junior missed:
   - Every window on the window schedule must appear as a SEPARATE line item
   - Every door on the door schedule must appear as a SEPARATE line item
   - Vent panels, fanlights, sidelights — often missed
   - Mastic sealant measured in linear metres around ALL external frames
   - DPC, cavity closers, wall ties — often forgotten
   - Lintels above every opening
   - Threshold strips, silicone, architraves

3. DOUBLE-COUNTING — Flag any overlaps:
   - kitchen_fitout_mid AND separate worktop/unit items = double count
   - bathroom_fitout_mid AND separate sanitaryware = double count
   - first_fix_plumbing AND individual pipe runs = double count
   - internal_decorations lump AND per-room decoration items = double count
   - Scaffolding as m² AND site_setup_scaffold lump = check not overlapping

4. WRONG SIZE VARIANTS — Check door/window sizes against drawings:
   - A 1770mm wide bifold is SMALL (2 panels) — use bifold_door_aluminium_small
   - A 500x900mm window is SMALL — use upvc_window_small or window_obscure_small
   - A 1800x1350mm window is LARGE — use upvc_window_large

5. ITEM GROUPING — Every window and door MUST be a separate line with qty 1
   - "2 Nr windows" is WRONG — should be "1 Nr W01" and "1 Nr W02" as separate items
   - Reference schedule numbers (D01, W01 etc.) in descriptions

6. PRELIMS CHECK — Are prelims reasonable?
   - Scaffolding m² should be elevation area (perimeter × scaffold height), NOT floor area
   - Skip hire: 1-2 for small extension, 3-4 for large/refurb
   - Do NOT include professional fees (architect, planning, CDM, PM) unless explicitly in scope

Respond with ONLY valid JSON:
{
  "corrections": [
    { "action": "adjust_qty", "item_index": 0, "new_qty": 15.5, "reason": "Wall area recalculated: 5.2m × 2.4m = 12.48m² not 18m²" },
    { "action": "adjust_key", "item_index": 3, "new_key": "bifold_door_aluminium_small", "reason": "1770mm wide is a small 2-panel bifold" },
    { "action": "remove", "item_index": 5, "reason": "Double-counts with bathroom_fitout_mid on item 12" },
    { "action": "split", "item_index": 7, "new_items": [
      { "key": "upvc_window_standard", "description": "W01 - UPVC window 1200x1350mm", "unit": "Nr", "qty": 1, "section": "6. Windows & External Doors", "working": "From window schedule W01" },
      { "key": "upvc_window_small", "description": "W02 - UPVC window 500x900mm obscure", "unit": "Nr", "qty": 1, "section": "6. Windows & External Doors", "working": "From window schedule W02" }
    ], "reason": "Grouped as 2Nr — must be separate items from schedule" },
    { "action": "add", "item": { "key": "mastic_sealant_allowance", "description": "Mastic sealant to all external window and door frames", "unit": "m", "qty": 25, "section": "6. Windows & External Doors", "working": "6 openings × ~4m perimeter average = 24m, round to 25m" }, "reason": "Missing from takeoff — required around all external frames" }
  ],
  "validation_notes": "Brief summary of what you found and overall confidence",
  "items_checked": ${parsed.items.length},
  "errors_found": 3,
  "confidence": "high|medium|low"
}

If the takeoff is accurate with no issues, return: { "corrections": [], "validation_notes": "Takeoff reviewed — no errors found", "items_checked": N, "errors_found": 0, "confidence": "high" }

CRITICAL RULES:
- item_index is 0-based matching the items array order
- Only flag genuine errors with clear reasoning — do not nitpick
- Recalculate quantities yourself, don't just trust the working shown
- Be especially strict on windows and doors — check every single one against the schedule
- If floor area is stated, verify construction total is reasonable (£1,800-£3,000/m² for extensions)`;

              // Build the validation message with original drawings + extracted items
              const validationContent = [
                ...extractContent,
                { type: 'text', text: `\n\nJUNIOR QS TAKEOFF TO REVIEW:\n\`\`\`json\n${JSON.stringify(parsed.items, null, 2)}\n\`\`\`\n\nProject type: ${parsed.project_type || 'Unknown'}\nLocation: ${parsed.location || 'Unknown'}\nFloor area: ${parsed.floor_area_m2 || 'Not stated'}m²\n\nReview every item critically. Check quantities, find missing items, flag double-counts.` }
              ];

              const validationResp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST', headers: apiHeaders,
                body: JSON.stringify({
                  model: 'claude-sonnet-4-20250514',
                  max_tokens: 6000,
                  system: validationPrompt,
                  messages: [{ role: 'user', content: validationContent }]
                })
              });

              if (validationResp.ok) {
                const valData = await validationResp.json();
                const valRaw = valData.content.filter(c => c.type === 'text').map(c => c.text).join('');
                const valCleaned = valRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                const validation = JSON.parse(valCleaned);

                // Log validation cost
                const valTokensIn = valData.usage ? valData.usage.input_tokens : 0;
                const valTokensOut = valData.usage ? valData.usage.output_tokens : 0;
                const valCost = (valTokensIn * 0.000003) + (valTokensOut * 0.000015);
                try {
                  db.prepare('INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
                    'ul_' + uuidv4().slice(0, 8), userId, 'validation_pass', `Stage 1b: ${validation.errors_found || 0} corrections`, 'claude-sonnet-4-20250514', valTokensIn, valTokensOut, valCost
                  );
                } catch(ue) {}

                if (validation.corrections && validation.corrections.length > 0) {
                  console.log(`[Stage 1b] Found ${validation.corrections.length} corrections, applying...`);

                  // Apply corrections in reverse index order to maintain indices
                  const sortedCorrections = [...validation.corrections].sort((a, b) => (b.item_index || 0) - (a.item_index || 0));
                  const addItems = []; // collect items to add at the end

                  for (const corr of sortedCorrections) {
                    const idx = corr.item_index;

                    if (corr.action === 'adjust_qty' && idx >= 0 && idx < parsed.items.length && corr.new_qty > 0) {
                      console.log(`  [1b] Adjust qty: item ${idx} "${parsed.items[idx].description}" ${parsed.items[idx].qty} → ${corr.new_qty} (${corr.reason})`);
                      parsed.items[idx].qty = corr.new_qty;
                      parsed.items[idx].validation_note = corr.reason;
                    }
                    else if (corr.action === 'adjust_key' && idx >= 0 && idx < parsed.items.length && corr.new_key) {
                      console.log(`  [1b] Adjust key: item ${idx} "${parsed.items[idx].key}" → "${corr.new_key}" (${corr.reason})`);
                      parsed.items[idx].key = corr.new_key;
                      parsed.items[idx].validation_note = corr.reason;
                    }
                    else if (corr.action === 'remove' && idx >= 0 && idx < parsed.items.length) {
                      console.log(`  [1b] Remove: item ${idx} "${parsed.items[idx].description}" (${corr.reason})`);
                      parsed.items.splice(idx, 1);
                    }
                    else if (corr.action === 'split' && idx >= 0 && idx < parsed.items.length && corr.new_items && corr.new_items.length > 0) {
                      console.log(`  [1b] Split: item ${idx} into ${corr.new_items.length} items (${corr.reason})`);
                      parsed.items.splice(idx, 1, ...corr.new_items.map(ni => ({
                        ...ni,
                        flagged: false,
                        flag_reason: '',
                        assumption: '',
                        validation_note: corr.reason,
                      })));
                    }
                    else if (corr.action === 'add' && corr.item && corr.item.key && corr.item.qty > 0) {
                      addItems.push({
                        ...corr.item,
                        flagged: false,
                        flag_reason: '',
                        assumption: '',
                        validation_note: `Added by validation: ${corr.reason}`,
                      });
                    }
                  }

                  // Add new items
                  if (addItems.length > 0) {
                    console.log(`  [1b] Adding ${addItems.length} missing items`);
                    parsed.items.push(...addItems);
                  }

                  console.log(`[Stage 1b] After corrections: ${parsed.items.length} items (was ${validation.items_checked})`);
                }

                // Store validation metadata for display
                parsed._validation = {
                  notes: validation.validation_notes || '',
                  errors_found: validation.errors_found || 0,
                  corrections_applied: (validation.corrections || []).length,
                  confidence: validation.confidence || 'unknown',
                };
              }
            } catch (valErr) {
              console.error('[Stage 1b] Validation error (non-fatal):', valErr.message);
              // Non-fatal — continue with unvalidated items
            }

            // Sanity check against memory — flags anomalies before user sees totals
            const anomalies = parsed.anomalies || [];
            if (memoryEngine) {
              const checks = memoryEngine.sanityCheckWithMemory(db, {
                items: parsed.items,
                projectType: parsed.project_type || projectTypeGuess,
                floorAreaM2: parsed.floor_area_m2,
              });
              anomalies.push(...checks.map(c => c.message));

              // Also suggest commonly co-occurring items that are missing
              const presentKeys = parsed.items.map(i => i.key).filter(Boolean);
              const suggested = memoryEngine.getSuggestedItems(db, {
                presentKeys,
                projectType: parsed.project_type || projectTypeGuess,
              });
              if (suggested.length > 0) {
                parsed.missing_info = parsed.missing_info || [];
                const topSuggestions = suggested.slice(0, 5).map(s => `Consider adding: ${s.key} (seen in ${s.strength} similar projects)`);
                parsed.missing_info.push(...topSuggestions);
              }
            } else if (benchmarkStore) {
              const benchmarkRanges = benchmarkStore.getBenchmarkRanges(db, projectTypeGuess, null);
              if (benchmarkRanges) {
                const checks = benchmarkStore.sanityCheckItems(parsed.items, benchmarkRanges);
                anomalies.push(...checks);
              }
            }

            // Save locked takeoff to DB
            // If no session_id yet (first message), create one now so takeoff is linkable
            const floorArea = parsed.floor_area_m2 || null;
            let activeSessionId = sessionId;
            if (!activeSessionId) {
              activeSessionId = 'cs_' + require('crypto').randomBytes(6).toString('hex');
              console.log(`[Takeoff] No session_id — auto-created: ${activeSessionId}`);
            }
            const takeoffId = benchmarkStore.saveTakeoff(db, {
              userId,
              sessionId: activeSessionId,
              projectName: parsed.location || parsed.project_type || 'Project',
              projectType: parsed.project_type || projectTypeGuess,
              location: parsed.location || '',
              items: parsed.items,
              status: 'draft',
            });

            console.log(`[Stage 1] Extracted ${parsed.items.length} items, saved as takeoff ${takeoffId}`);

            // Price them immediately so user sees costs alongside quantities
            const clientRates = {};
            try {
              const dbRates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
              for (const r of dbRates) clientRates[r.item_key] = r.value;
            } catch(e) {}

            const priced = deterministicPricer.priceLockedQuantities(
              parsed.items,
              parsed.location || '',
              clientRates,
              (() => {
                const locText = (parsed.location || message || '').toLowerCase();
                const isIreland = /dublin|cork|galway|limerick|ireland|waterford|kilkenny|wexford|wicklow|kildare|meath|louth|monaghan|cavan|longford|westmeath|offaly|laois|tipperary|clare|limerick|kerry|mayo|sligo|leitrim|roscommon|galway|donegal/.test(locText);
                return {
                  contingency_pct: 7.5,
                  ohp_pct: 12,
                  vat_rate: isIreland ? 13.5 : 20,
                  currency: isIreland ? 'EUR' : 'GBP',
                };
              })()
            );

            // Format quantities summary for user
            const flagged = parsed.items.filter(i => i.flagged);
            const missing = parsed.missing_info || [];

            let quantitySummary = `Quantity takeoff complete for ${parsed.project_type || 'your project'} at ${parsed.location || 'the project address'}.\n\n`;
            quantitySummary += `${parsed.items.length} items extracted across ${priced.sections.length} sections.\n`;
            quantitySummary += `Location: ${priced.location.label}\n`;
            if (parsed._validation) {
              const v = parsed._validation;
              if (v.corrections_applied > 0) {
                quantitySummary += `QA Review: ${v.corrections_applied} corrections applied (${v.notes})\n`;
              } else {
                quantitySummary += `QA Review: Passed — no errors found\n`;
              }
            }
            quantitySummary += '\n';

            // Section summaries with costs — flag any suspiciously large sections
            for (const sec of priced.sections) {
              const sectionPct = priced.summary.construction_total > 0 
                ? (sec.subtotal / priced.summary.construction_total * 100).toFixed(0) 
                : 0;
              const flag = sec.subtotal > 50000 && parseFloat(sectionPct) > 40 ? ' ⚠️ REVIEW' : '';
              quantitySummary += `${sec.name}: £${sec.subtotal.toLocaleString('en-GB', {maximumFractionDigits:0})}${flag}\n`;
              // Warn on individual items with absurd totals
              for (const item of sec.items || []) {
                if (item.total > 25000) {
                  quantitySummary += `  ⚠️ WARNING: ${item.description} = £${item.total.toLocaleString('en-GB', {maximumFractionDigits:0})} — check qty (${item.qty} ${item.unit} × £${item.rate}/${item.unit})\n`;
                }
              }
            }
            quantitySummary += `\nConstruction Total: £${priced.summary.construction_total.toLocaleString('en-GB', {maximumFractionDigits:0})}`;
            quantitySummary += `\nContingency (${priced.summary.contingency_pct}%): £${priced.summary.contingency.toLocaleString('en-GB', {maximumFractionDigits:0})}`;
            quantitySummary += `\nNet Total: £${priced.summary.net_total.toLocaleString('en-GB', {maximumFractionDigits:0})}`;
            quantitySummary += `\nOH&P (${priced.summary.ohp_pct}%): £${priced.summary.ohp.toLocaleString('en-GB', {maximumFractionDigits:0})}`;
            quantitySummary += `\nNet + OH&P: £${priced.summary.net_with_ohp.toLocaleString('en-GB', {maximumFractionDigits:0})}`;
            quantitySummary += `\nVAT (${priced.summary.vat_rate}%): £${priced.summary.vat.toLocaleString('en-GB', {maximumFractionDigits:0})}`;
            quantitySummary += `\nGrand Total: £${priced.summary.grand_total.toLocaleString('en-GB', {maximumFractionDigits:0})}`;

            // Per-m² sanity check — flag unreasonable totals
            const floorAreaForCheck = parsed.floor_area_m2 || floorArea;
            if (floorAreaForCheck && floorAreaForCheck > 0) {
              const costPerM2 = priced.summary.construction_total / floorAreaForCheck;
              const costPerM2Str = `£${Math.round(costPerM2).toLocaleString('en-GB')}/m²`;
              if (costPerM2 > 5000) {
                quantitySummary += `\n\n⚠️ COST CHECK: Construction cost is ${costPerM2Str} (floor area ${floorAreaForCheck.toFixed(1)}m²). Typical UK extensions cost £2,000-3,500/m². This looks too high — please review quantities and rates above for errors.`;
              } else if (costPerM2 > 3500) {
                quantitySummary += `\n\n📊 Cost/m²: ${costPerM2Str} (floor area ${floorAreaForCheck.toFixed(1)}m²) — at the higher end of typical UK rates (£2,000-3,500/m²). Worth a quick review.`;
              } else {
                quantitySummary += `\n\n📊 Cost/m²: ${costPerM2Str} (floor area ${floorAreaForCheck.toFixed(1)}m²) — within typical UK range.`;
              }
            }

            if (flagged.length > 0) {
              quantitySummary += `\n\nItems needing review (${flagged.length}):\n`;
              for (const f of flagged) quantitySummary += `  ${f.description}: ${f.flag_reason}\n`;
            }
            if (anomalies.length > 0) {
              quantitySummary += `\n\nAnomaly checks:\n`;
              for (const a of anomalies) quantitySummary += `  ${a}\n`;
            }
            if (missing.length > 0) {
              quantitySummary += `\n\nMissing information:\n`;
              for (const m of missing) quantitySummary += `  ${m}\n`;
            }
            if (priced.warnings.length > 0) {
              quantitySummary += `\n\nPricing notes:\n`;
              for (const w of priced.warnings) quantitySummary += `  ${w}\n`;
            }

            // Flag items that used annotated vs estimated dimensions
            const flaggedCount = parsed.items.filter(i => i.flagged).length;
            const assumedCount = parsed.items.filter(i => !i.flagged && i.assumption && i.assumption.length > 5).length;
            const confirmedCount = Math.max(0, parsed.items.length - flaggedCount - assumedCount);
            const totalItems = parsed.items.length;
            const confidencePct = totalItems > 0 ? Math.round((confirmedCount / totalItems) * 100) : 0;

            quantitySummary += `\n\n📊 Confidence: ${confidencePct}% from annotated dimensions (${confirmedCount}/${totalItems} items) | ${flaggedCount} flagged for review`;
            if (req.zipData && req.zipData.all_openings.length > 0) {
              quantitySummary += `\n📐 ${req.zipData.all_openings.length} door/window sizes read directly from schedule (no estimation)`;
            }
            if (req.zipData && req.zipData.all_rooms.length > 0) {
              quantitySummary += `\n🏠 Floor area confirmed from room schedule: ${req.zipData.summary.total_floor_area_m2.toFixed(1)}m²`;
            }
            // If no address was provided, ask for it now alongside the quantities
            if (!hasAddress) {
              quantitySummary += `\n\n📍 **One thing needed:** What's the project address or town? This lets me apply the correct local rates and currency (UK £ or Ireland €). Reply with the location and I'll update the pricing before you generate.`;
            }

            quantitySummary += `\n\nQuantities are now locked (ref: ${takeoffId}). Review the figures above. If anything needs adjusting, tell me now. When you are satisfied, say "generate documents" and I will produce the Excel BOQ and Findings Report — the total will be exactly as shown above.`;

            reply = quantitySummary;
            takeoffData = { takeoffId, priced, floorArea, projectType: parsed.project_type, sessionId: activeSessionId };
          }
        }
      } catch (extractErr) {
        console.error('[Stage 1] Extraction error:', extractErr.message);
        // Fall through to normal chat response
      }
      } // end shouldExtract
    }

    // ── QUOTA CHECK ───────────────────────────────────────────────────
    if (wantsDocuments && req.user.role !== 'admin') {
      const dPlan = req.user.plan || 'starter';
      const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
      const dMonthStr = mStart.toISOString();
      const docsGenThisMonth = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(userId, dMonthStr).c;
      const revisionsThisMonth = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND created_at>=?").get(userId, dMonthStr).c;

      if (dPlan === 'starter') {
        const freeTrialQuota = req.user.monthly_quota || 0;
        const paidCredits = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_paid'").get(userId).c;
        const totalAllowed = freeTrialQuota + paidCredits;
        const totalDocsEver = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated'").get(userId).c;
        const totalRevisionsEver = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision'").get(userId).c;
        const originalsEver = totalDocsEver - totalRevisionsEver;
        const looksLikeRevision = totalDocsEver > 0 && /revis|redo|regenerat|update.*doc|fix.*rate/i.test(message || '');
        if (looksLikeRevision && totalRevisionsEver < totalAllowed) {
          console.log('[Quota] Starter revision allowed');
        } else if (originalsEver >= totalAllowed) {
          wantsDocuments = false;
          paymentRequired = {
            type: 'boq_payment', plan: 'starter', price: 99, currency: 'GBP',
            url: 'https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01?client_reference_id=' + userId,
            message: 'To generate your BOQ and Findings Report, a one-off payment of £99 is required. This includes a full Excel BOQ with your trained rates, a professional Findings Report, and 1 free revision.',
          };
          console.log(`[Quota] Payment required — used ${originalsEver}/${totalAllowed}`);
        } else {
          console.log(`[Quota] Free trial — slot ${originalsEver + 1} of ${totalAllowed}`);
        }
      } else {
        const docLimit = dPlan === 'premium' ? 20 : 10;
        const originalsThisMonth = docsGenThisMonth - revisionsThisMonth;
        const lastDoc2 = db.prepare("SELECT detail FROM usage_log WHERE user_id=? AND action='doc_generated' ORDER BY created_at DESC LIMIT 1").get(userId);
        const isRevision = lastDoc2 && /revis|redo|regenerat|update.*doc|fix.*rate/i.test(message || '');
        if (isRevision) {
          const projectRevisions = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND detail=?").get(userId, lastDoc2.detail).c;
          if (projectRevisions >= 1) { reply += '\n\nRevision limit reached for this project (1 revision included per BOQ).'; wantsDocuments = false; }
        } else if (originalsThisMonth >= docLimit) {
          reply += `\n\nDocument limit reached (${docLimit} BOQs on ${dPlan} plan this month).`; wantsDocuments = false;
        }
      }
    }

    // ── STAGE 3: GENERATE DOCUMENTS ──────────────────────────────────
    // Uses locked quantities from DB + deterministic pricing. AI only writes findings narrative.
    if (wantsDocuments && boqGen && findingsGen) {
      console.log('[Stage 3] Generating documents from locked quantities...');
      const clientName = req.user.full_name || req.user.email;

      // Project name from takeoff location or drawings
    // Find locked takeoff for this session
      let lockedTakeoff = null;
      let pricedResult = null;

      if (sessionId && benchmarkStore && deterministicPricer) {
        lockedTakeoff = benchmarkStore.getTakeoffBySession(db, sessionId);
      }

      if (lockedTakeoff && lockedTakeoff.items && lockedTakeoff.items.length > 0) {
        // ✅ DETERMINISTIC PATH: use locked quantities
        console.log(`[Stage 3] Using locked takeoff ${lockedTakeoff.id} with ${lockedTakeoff.items.length} items`);

        const clientRates = {};
        try {
          const dbRates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
          for (const r of dbRates) clientRates[r.item_key] = r.value;
        } catch(e) {}

        // Enrich clientRates with memory engine best rates
        if (memoryEngine) {
          const region = memoryEngine.detectRegion(lockedTakeoff.location || '');
          for (const item of lockedTakeoff.items) {
            if (!clientRates[item.key]) {
              const memRate = memoryEngine.getBestRate(db, {
                itemKey: item.key,
                region,
                projectType: lockedTakeoff.project_type || 'any',
                userId,
              });
              if (memRate && memRate.confidence > 0.65) {
                clientRates[item.key] = memRate.rate;
                console.log(`[Memory] Using ${memRate.source} rate for ${item.key}: £${memRate.rate} (conf ${memRate.confidence.toFixed(2)})`);
              }
            }
          }
        }

        pricedResult = deterministicPricer.priceLockedQuantities(
          lockedTakeoff.items,
          lockedTakeoff.location || '',
          clientRates,
          (() => {
            const locText = (lockedTakeoff.location || message || '').toLowerCase();
            const isIreland = /dublin|cork|galway|limerick|ireland|waterford|kilkenny|wexford|wicklow|kildare|meath|louth|monaghan|cavan|longford|westmeath|offaly|laois|tipperary|clare|limerick|kerry|mayo|sligo|leitrim|roscommon|galway|donegal/.test(locText);
            return {
              contingency_pct: 7.5,
              ohp_pct: 12,
              vat_rate: isIreland ? 13.5 : 20,
              currency: isIreland ? 'EUR' : 'GBP',
            };
          })()
        );

        // Mark takeoff as confirmed
        if (benchmarkStore) benchmarkStore.updateTakeoff(db, lockedTakeoff.id, { status: 'confirmed' });

      } else {
        // ⚠️ NO LOCKED TAKEOFF — block generation, tell user clearly
        // Never silently generate from conversation context — that causes wrong projects
        console.log('[Stage 3] No locked takeoff for session:', sessionId, '— blocking');
        wantsDocuments = false;

        // Check if user has any recent takeoff at all (maybe session mismatch)
        let latestTakeoff = null;
        if (benchmarkStore) {
          try {
            latestTakeoff = db.prepare(
              'SELECT id, project_name, created_at FROM quantity_takeoffs WHERE user_id=? ORDER BY created_at DESC LIMIT 1'
            ).get(userId);
          } catch(e) {}
        }

        if (latestTakeoff) {
          reply = `I can't find the locked quantities for this session.

Your most recent quantity takeoff was for **${latestTakeoff.project_name}** (ref: ${latestTakeoff.id}).

To generate documents, please either:
• Upload your drawings again in this chat to re-run the quantity takeoff, or
• Start a new chat and upload the drawings fresh`;
        } else {
          reply = `To generate documents I need to run a quantity takeoff first.

Please upload your drawings (PDF, images, or ZIP) and I'll extract all measurements. Once quantities are locked you can say "generate documents" and the total will be deterministic.`;
        }
      }

      if (pricedResult && pricedResult.sections && pricedResult.sections.length > 0) {
        const projectName = (lockedTakeoff && lockedTakeoff.project_name) || 'Project';
        const safeName = projectName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 50) || 'Project';
        const ts = Date.now();
        downloadFiles = [];

        // Convert priced sections to boqGenerator format
        const boqSections = deterministicPricer ? deterministicPricer.toPricedSections(pricedResult) : pricedResult.sections;

        // Generate Excel BOQ
        try {
          const buf = await boqGen.generateBOQExcel(boqSections, projectName, clientName, {
            contingency_pct: pricedResult.summary.contingency_pct,
            ohp_pct: pricedResult.summary.ohp_pct,
            vat_rate: pricedResult.summary.vat_rate,
          });
          if (buf && buf.length > 100) {
            const fname = `BOQ-${safeName}-${ts}.xlsx`;
            fs.writeFileSync(path.join(outputsDir, fname), buf);
            downloadFiles.push({ name: fname, type: 'xlsx', url: `/api/downloads/${fname}` });
            console.log(`[Stage 3] Excel: ${fname}`);
          }
        } catch (excelErr) { console.error('[Stage 3] Excel error:', excelErr.message); }

        // Generate Findings Report — AI writes narrative only, not quantities
        try {
          const findingsPrompt = buildSystemPrompt(userId, 'generate_findings');
          const findingsInput = {
            priced_summary: pricedResult.summary,
            sections: pricedResult.sections.map(s => ({ name: s.name, subtotal: s.subtotal })),
            project_name: projectName,
            location: lockedTakeoff ? lockedTakeoff.location : '',
            project_type: lockedTakeoff ? lockedTakeoff.project_type : 'Extension',
            item_count: pricedResult.item_count,
            warnings: pricedResult.warnings,
          };
          const findingsResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers: apiHeaders,
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 4000,
              system: findingsPrompt,
              messages: [{ role: 'user', content: `Write the Findings Report for this project: ${JSON.stringify(findingsInput)}` }]
            })
          });

          let findings = {};
          if (findingsResp.ok) {
            const fData = await findingsResp.json();
            const fText = fData.content.filter(c => c.type === 'text').map(c => c.text).join('');
            const fCleaned = fText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            findings = JSON.parse(fCleaned);
            // Inject the deterministic cost summary
            findings.cost_summary = {
              sections: pricedResult.sections.map(s => ({ name: s.name, total: s.subtotal })),
              net_total: pricedResult.summary.net_total,
              contingency_pct: pricedResult.summary.contingency_pct,
              contingency: pricedResult.summary.contingency,
              ohp_pct: pricedResult.summary.ohp_pct,
              ohp: pricedResult.summary.ohp,
              grand_total: pricedResult.summary.grand_total,
            };
          }

          const docBuf = await findingsGen.generateFindingsReport(findings, clientName, projectName);
          if (docBuf && docBuf.length > 100) {
            const docName = `Findings-${safeName}-${ts}.docx`;
            fs.writeFileSync(path.join(outputsDir, docName), docBuf);
            downloadFiles.push({ name: docName, type: 'docx', url: `/api/downloads/${docName}` });
            console.log(`[Stage 3] Word: ${docName}`);
          }
        } catch (wordErr) { console.error('[Stage 3] Word error:', wordErr.message); }

        if (downloadFiles.length > 0) {
          const itemCount = pricedResult.item_count || 0;
          const grandTotal = pricedResult.summary.grand_total;
          reply = `Documents generated for ${projectName}.\n\n${itemCount} line items priced deterministically from locked quantities.\nGrand Total (inc. VAT): £${grandTotal.toLocaleString('en-GB', {maximumFractionDigits:0})}\n\nThis total is locked — it will not change if you regenerate. Download your Excel BOQ and Word Findings Report below.`;

          if (pricedResult.warnings && pricedResult.warnings.length > 0) {
            reply += '\n\nNotes: ' + pricedResult.warnings.join(' | ');
          }

          // Store project + benchmarks
          try {
            const projCurrency = pricedResult.summary.currency || 'GBP';
            const boqF = downloadFiles.find(f => f.type === 'xlsx');
            const docF = downloadFiles.find(f => f.type === 'docx');

            db.prepare('INSERT INTO chat_projects (id,user_id,title,total_value,currency,boq_filename,findings_filename,summary,item_count) VALUES(?,?,?,?,?,?,?,?,?)')
              .run('cp_'+uuidv4().slice(0,8), userId, projectName, grandTotal, projCurrency, boqF?boqF.name:null, docF?docF.name:null, '', itemCount);

            try {
              const projId = 'proj_' + uuidv4().slice(0, 10);
              try { db.exec('ALTER TABLE projects ADD COLUMN boq_filename TEXT'); } catch(e) {}
              try { db.exec('ALTER TABLE projects ADD COLUMN findings_filename TEXT'); } catch(e) {}
              db.prepare(`INSERT INTO projects (id, user_id, title, status, total_value, currency, item_count, project_type, boq_filename, findings_filename) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`)
                .run(projId, userId, projectName, grandTotal, projCurrency, itemCount, lockedTakeoff ? lockedTakeoff.project_type : null, boqF ? boqF.name : null, docF ? docF.name : null);
            } catch(projErr) { console.error('[Project] projects table insert error:', projErr.message); }

            db.prepare('INSERT INTO usage_log (id,user_id,action,detail,model_used,tokens_in,tokens_out,cost_estimate) VALUES(?,?,?,?,?,?,?,?)')
              .run('ul_'+uuidv4().slice(0,8), userId, 'doc_generated', projectName, modelUsed||'sonnet', 0, 0, 0);

            // ── FULL MEMORY LEARNING ────────────────────────────────────
            // Every confirmed project teaches the system.
            // Rates, quantities, patterns, client profile — all updated.
            if (lockedTakeoff) {
              try {
                if (memoryEngine) {
                  memoryEngine.learnFromConfirmedProject(db, {
                    userId,
                    takeoffId: lockedTakeoff.id,
                    items: lockedTakeoff.items,
                    pricedResult,
                    location: lockedTakeoff.location || '',
                    projectType: lockedTakeoff.project_type || 'General',
                    floorAreaM2: lockedTakeoff.floor_area_m2 || null,
                  });
                } else if (benchmarkStore) {
                  benchmarkStore.extractAndStoreBenchmarks(db, lockedTakeoff.id, lockedTakeoff.floor_area_m2);
                }
                const stats = memoryEngine ? memoryEngine.getMemoryStats(db) : null;
                if (stats) console.log(`[Memory] Total: ${stats.rates?.n} rates, ${stats.quantities?.n} qty records, ${stats.projects?.n} projects`);
              } catch (learnErr) {
                console.error('[Memory] Learning error:', learnErr.message);
              }
            }
          } catch(pe) { console.error('[Project] Save error:', pe.message); }
        }
      }
    } else if (hasFiles && !wantsDocuments && !paymentRequired && !wantsExtract) {
      reply += '\n\nQuantities extracted and locked. Say "generate documents" when you are ready to produce the Excel BOQ and Findings Report.';
    }

    // Auto-learning
    try {
      const userMsg = message || '';
      const userLower = userMsg.toLowerCase();
      const isCorrection = /(?:should be|actually|we (?:charge|pay|use|quote)|rate is|cost is|price is|our rate|not right|too (?:high|low)|incorrect|wrong|instead of|changed to|now \d|is \d+\s*(?:not|instead))/i.test(userLower);
      if (isCorrection && memoryEngine) {
        // Extract correction and store in memory engine
        const numMatch = userMsg.match(/(?:should be|actually|is|to|now|changed to|not|instead of)\s*(?:£|€)?\s*(\d[\d,.]*)/i);
        if (numMatch) {
          const correctedValue = parseFloat(numMatch[1].replace(/,/g,''));
          if (correctedValue > 0 && correctedValue < 1000000) {
            // Try to infer item key from context
            const itemKeyGuess = userLower.match(/(?:excavat|concret|blockwork|brick|roof|plaster|screed|window|door|electric|plumb|drain|scaffold)/)?.[0];
            memoryEngine.recordCorrection(db, {
              userId,
              itemKey: itemKeyGuess || null,
              field: 'rate',
              newValue: correctedValue,
              reason: userMsg.substring(0, 200),
              context: JSON.stringify({ session: sessionId }),
            });
          }
        }
      }
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
          const numPatterns = [/(?:should be|actually|is|to|now|changed to)\s*(?:£|€)?\s*(\d[\d,.]*)(?!\d)/i, /(\d[\d,.]*)\s*(?:not|instead of)\s*\d/i];
          for (const pat of numPatterns) {
            const m = userMsg.match(pat);
            if (m) { const v = parseFloat(m[1].replace(/,/g,'')); if (v>0&&v<1000000){newValue=v;break;} }
          }
          if (!newValue) { const nums = userMsg.match(/\d[\d,.]*(?:\.\d+)?/g); if (nums) newValue = parseFloat(nums[0].replace(/,/g,'')); }
          if (bestMatch && bestScore >= 1 && newValue && newValue !== bestMatch.value) {
            db.prepare('UPDATE client_rate_library SET value=?,confidence=MIN(confidence+0.05,0.95),times_confirmed=times_confirmed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newValue, bestMatch.id);
            db.prepare('INSERT INTO rate_corrections_log(id,rate_id,user_id,old_value,new_value,correction_source,raw_message)VALUES(?,?,?,?,?,?,?)').run('rc_'+uuidv4().slice(0,8),bestMatch.id,userId,bestMatch.value,newValue,'auto_chat',userMsg.substring(0,500));
          }
        }
      }
    } catch (autoErr) { console.error('[AutoLearn]', autoErr.message); }

    try { extractInsightsFromMessage(userId, message); } catch (insExtErr) { console.error('[InsightExtract]', insExtErr.message); }

    // Parse tags
    try {
      const addMatches = reply.match(/\[RATE_ADD\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/g) || [];
      for (const m of addMatches) {
        const parts = m.replace(/^\[RATE_ADD\|/, '').replace(/\]$/, '').split('|');
        if (parts.length === 4) {
          const cat = parts[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const rName = parts[1].trim(); const rVal = parseFloat(parts[2].trim().replace(/[^0-9.\-]/g, '')); const rUnit = parts[3].trim();
          if (rName && !isNaN(rVal) && rVal > 0 && rUnit) {
            const itemKey = rName.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 100);
            const exists = db.prepare('SELECT id FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ? AND is_active = 1').get(userId, cat, itemKey);
            if (!exists) { db.prepare('INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.75, 1)').run('rl_'+uuidv4().slice(0,8), userId, cat, itemKey, rName, rVal, rUnit); }
            else { db.prepare('UPDATE client_rate_library SET value = ?, unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(rVal, rUnit, exists.id); }
          }
        }
      }
      const updateMatches = reply.match(/\[RATE_UPDATE\|([^|]+)\|([^\]]+)\]/g) || [];
      for (const m of updateMatches) {
        const uParts = m.replace(/^\[RATE_UPDATE\|/, '').replace(/\]$/, '').split('|');
        if (uParts.length === 2) {
          const uName = uParts[0].trim().toLowerCase(); const uVal = parseFloat(uParts[1].trim().replace(/[^0-9.\-]/g, ''));
          if (uName && !isNaN(uVal) && uVal > 0) {
            const allRates = db.prepare('SELECT * FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(userId);
            let found = allRates.find(r => r.display_name.toLowerCase() === uName || r.item_key === uName.replace(/[^a-z0-9]+/g, '_'));
            if (!found) { found = allRates.find(r => { const words = uName.split(/[\s&,\/\-]+/).filter(w => w.length > 2); return words.filter(w => r.display_name.toLowerCase().includes(w)).length >= 2; }); }
            if (found && uVal !== found.value) {
              db.prepare('UPDATE client_rate_library SET value=?,confidence=MIN(confidence+0.05,0.95),times_confirmed=times_confirmed+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(uVal, found.id);
              db.prepare('INSERT INTO rate_corrections_log(id,rate_id,user_id,old_value,new_value,correction_source,raw_message)VALUES(?,?,?,?,?,?,?)').run('rc_'+uuidv4().slice(0,8),found.id,userId,found.value,uVal,'tag_update',reply.substring(0,200));
            }
          }
        }
      }
      const insightMatches = reply.match(/\[INSIGHT\|([^|]+)\|([^\]]+)\]/g) || [];
      const validInsightCats = ['spec_preference','markup','supplier','scope','geography','trade','standard','feedback','workflow','exclusion','team','project_type','commercial'];
      for (const m of insightMatches) {
        const iParts = m.replace(/^\[INSIGHT\|/, '').replace(/\]$/, '').split('|');
        if (iParts.length >= 2) {
          const iCat = iParts[0].trim().toLowerCase().replace(/\s+/g, '_'); const iText = iParts[1].trim();
          if (validInsightCats.includes(iCat) && iText.length > 5 && iText.length < 300) {
            const existingInsights = db.prepare('SELECT id, insight, times_reinforced FROM client_insights WHERE user_id = ? AND category = ?').all(userId, iCat);
            let isDuplicate = false;
            for (const ex of existingInsights) {
              const existWords = ex.insight.toLowerCase().split(/\s+/); const newWords = iText.toLowerCase().split(/\s+/);
              const overlap = existWords.filter(w => newWords.includes(w)).length;
              if (overlap / Math.max(existWords.length, 1) > 0.6) { db.prepare('UPDATE client_insights SET times_reinforced = times_reinforced + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(ex.id); isDuplicate = true; break; }
            }
            if (!isDuplicate) { db.prepare('INSERT INTO client_insights (id, user_id, category, insight) VALUES (?, ?, ?, ?)').run('ins_'+uuidv4().slice(0,8), userId, iCat, iText); }
          }
        }
      }
      reply = reply.replace(/\[RATE_ADD\|[^\]]*\]/g, '').replace(/\[RATE_UPDATE\|[^\]]*\]/g, '').replace(/\[INSIGHT\|[^\]]*\]/g, '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    } catch (tagErr) { console.error('[Tags] Error:', tagErr.message); }

    let rateStats = null;
    try {
      const s = db.prepare(`SELECT COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence FROM client_rate_library WHERE user_id = ? AND is_active = 1`).get(userId);
      if (s && s.total > 0) rateStats = s;
    } catch(e) {}

    let quotaInfo = null;
    if (req.user.role !== 'admin') {
      const qPlan = req.user.plan || 'starter';
      const qStart = new Date(); qStart.setDate(1); qStart.setHours(0,0,0,0);
      const qMonth = qStart.toISOString();
      const qMsgs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message' AND created_at>=?").get(userId, qMonth).c;
      const qDocs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(userId, qMonth).c;
      const qRevs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND created_at>=?").get(userId, qMonth).c;
      const qMsgLimit = qPlan === 'starter' ? 10 : qPlan === 'professional' ? 100 : 200;
      const qDocLimit = qPlan === 'starter' ? (req.user.monthly_quota || 0) : qPlan === 'professional' ? 10 : 20;
      quotaInfo = { plan: qPlan, messages_used: qMsgs, messages_limit: qMsgLimit, docs_used: qDocs - qRevs, docs_limit: qDocLimit, revisions_used: qRevs, pay_per_doc: qPlan === 'starter' };
    }

    // Return session_id and takeoff_id so frontend can persist them
    // CRITICAL: Always resolve the active takeoff — even on "generate" turns
    // where takeoffData is null (Stage 1 already ran in a previous turn)
    const responseSessionId = (takeoffData && takeoffData.sessionId) || req.body.session_id || sessionId || null;

    // Try to get takeoff_id from: 1) current extraction, 2) body (frontend sent it), 3) DB lookup by session
    let responseTakeoffId = (typeof takeoffData === 'object' && takeoffData) ? takeoffData.takeoffId : null;
    if (!responseTakeoffId && req.body.takeoff_id) {
      responseTakeoffId = req.body.takeoff_id; // frontend remembered it
    }
    if (!responseTakeoffId && responseSessionId && benchmarkStore) {
      // Last resort: look up from DB by session_id
      try {
        const sessionTakeoff = benchmarkStore.getTakeoffBySession(db, responseSessionId);
        if (sessionTakeoff) {
          responseTakeoffId = sessionTakeoff.id;
          console.log(`[Session] Recovered takeoff_id ${responseTakeoffId} from DB for session ${responseSessionId}`);
        }
      } catch(e) {}
    }

    res.json({
      reply,
      thinking: thinking || null,
      rateStats,
      files: downloadFiles,
      quota: quotaInfo,
      payment_required: paymentRequired,
      session_id: responseSessionId,
      takeoff_id: responseTakeoffId,
      takeoff_locked: responseTakeoffId ? true : false,
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong -- please try again' });
  }
});

module.exports = router;

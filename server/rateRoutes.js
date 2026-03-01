const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIBRARY — DATABASE SETUP
// ═══════════════════════════════════════════════════════════════════════════════

function ensureRatesTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT DEFAULT 'v1.0',
      description TEXT,
      region TEXT,
      is_custom INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rates (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      code TEXT NOT NULL,
      trade TEXT NOT NULL,
      description TEXT NOT NULL,
      unit TEXT NOT NULL,
      labour_rate REAL DEFAULT 0,
      material_rate REAL DEFAULT 0,
      total_rate REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (library_id) REFERENCES rate_libraries(id)
    );

    CREATE TABLE IF NOT EXISTS location_factors (
      id TEXT PRIMARY KEY,
      location TEXT NOT NULL,
      region TEXT NOT NULL,
      labour_factor REAL DEFAULT 1.0,
      materials_factor REAL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_rates_library ON rates(library_id);
    CREATE INDEX IF NOT EXISTS idx_rates_trade ON rates(trade);
    CREATE INDEX IF NOT EXISTS idx_rates_code ON rates(code);
  `);
}

ensureRatesTables();

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DEFAULT DATA (runs once if no libraries exist)
// ═══════════════════════════════════════════════════════════════════════════════

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM rate_libraries').get().c;
  if (count > 0) return;

  console.log('[Rates] Seeding master rate library...');

  const libId = uuidv4();
  db.prepare('INSERT INTO rate_libraries (id, name, version, description, region, is_custom) VALUES (?, ?, ?, ?, ?, ?)').run(
    libId, 'UK Master Rates', 'v4.0', 'Master rate library — 500+ items, GOV.UK indexed, March 2026', 'England, Wales, Scotland, NI, Ireland', 0
  );

  const ins = db.prepare('INSERT INTO rates (id, library_id, code, trade, description, unit, labour_rate, material_rate, total_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

  const seedMany = db.transaction((items) => {
    for (const r of items) {
      ins.run(uuidv4(), libId, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]);
    }
  });

  // ── GROUNDWORKS ──
  const groundworks = [
    ['GW-001','Groundworks','Reduce level excavation (machine)','m³',8.50,0,8.50,'Assumes tipping on site'],
    ['GW-002','Groundworks','Reduce level excavation (hand)','m³',28.00,0,28.00,'Restricted access'],
    ['GW-003','Groundworks','Trench excavation for foundations (machine)','m³',12.00,0,12.00,'Up to 1.5m deep'],
    ['GW-004','Groundworks','Trench excavation (hand)','m³',42.00,0,42.00,'Restricted/near services'],
    ['GW-005','Groundworks','Excavate drainage trenches','m',18.00,2.00,20.00,'Average 600mm deep'],
    ['GW-006','Groundworks','Cart away excavated material','m³',14.00,22.00,36.00,'Inc skip/lorry & tipping'],
    ['GW-007','Groundworks','Imported fill (MOT Type 1)','m³',8.00,32.00,40.00,'Compacted in layers'],
    ['GW-008','Groundworks','Sand blinding','m³',6.00,28.00,34.00,'50mm bed under slabs'],
    ['GW-009','Groundworks','Strip foundations (mass concrete C25)','m³',22.00,95.00,117.00,'600x250mm typical'],
    ['GW-010','Groundworks','Strip foundations (mass concrete C30)','m³',22.00,102.00,124.00,'Structural requirement'],
    ['GW-011','Groundworks','Trench fill (concrete C25)','m³',18.00,95.00,113.00,'Poured to within 150mm GL'],
    ['GW-012','Groundworks','Trench fill (concrete C30)','m³',18.00,102.00,120.00,'Deep trench fill'],
    ['GW-013','Groundworks','Reinforced pad foundations','m³',35.00,115.00,150.00,'Inc rebar & formwork'],
    ['GW-014','Groundworks','Piling (CFA) - budget allowance','m',45.00,55.00,100.00,'Subject to specialist quote'],
    ['GW-015','Groundworks','Ground beams (RC)','m',55.00,85.00,140.00,'Inc formwork & rebar'],
    ['GW-016','Groundworks','Ground floor slab 100mm (C25)','m²',12.00,22.00,34.00,'Power floated finish'],
    ['GW-017','Groundworks','Ground floor slab 150mm (C25)','m²',14.00,28.00,42.00,'Garage / heavy duty'],
    ['GW-018','Groundworks','Mesh reinforcement A142','m²',3.00,5.50,8.50,'Lapped joints'],
    ['GW-019','Groundworks','Mesh reinforcement A252','m²',3.50,8.00,11.50,'Heavy duty slab'],
    ['GW-020','Groundworks','DPM (1200g polythene)','m²',1.50,2.80,4.30,'Lapped & taped joints'],
    ['GW-021','Groundworks','Rigid insulation (100mm Celotex/Kingspan)','m²',2.50,14.00,16.50,'Below slab'],
    ['GW-022','Groundworks','Rigid insulation (75mm)','m²',2.50,11.00,13.50,'Floor perimeter'],
    ['GW-023','Groundworks','110mm UPVC foul drainage','m',12.00,8.50,20.50,'Inc bed & surround'],
    ['GW-024','Groundworks','160mm UPVC foul drainage','m',14.00,14.00,28.00,'Larger runs'],
    ['GW-025','Groundworks','110mm UPVC surface water','m',11.00,7.50,18.50,'Inc pea gravel bed'],
    ['GW-026','Groundworks','Manhole 600x450 (600mm deep)','nr',180.00,220.00,400.00,'Precast plastic chamber'],
    ['GW-027','Groundworks','Manhole 600x450 (900mm deep)','nr',220.00,280.00,500.00,'Deeper chamber'],
    ['GW-028','Groundworks','Manhole 600x450 (1200mm deep)','nr',280.00,380.00,660.00,'Deep chamber'],
    ['GW-029','Groundworks','Soakaway (1m³ crate system)','nr',250.00,350.00,600.00,'Geocellular inc membrane'],
    ['GW-030','Groundworks','Soakaway (2m³ crate system)','nr',350.00,550.00,900.00,'Larger system'],
    ['GW-031','Groundworks','Gulley pot and grating','nr',65.00,55.00,120.00,'Plastic trapped gulley'],
    ['GW-032','Groundworks','Connection to existing drain','nr',180.00,45.00,225.00,'Saddle connection'],
    ['GW-033','Groundworks','RWP connection to drain','nr',65.00,35.00,100.00,'Back inlet gulley'],
    ['GW-034','Groundworks','Catchpit / silt trap','nr',150.00,120.00,270.00,'Precast with bucket'],
    ['GW-035','Groundworks','Hardcore fill compacted','m³',8.00,28.00,36.00,'In layers 150mm max'],
    ['GW-036','Groundworks','Concrete drive/path (100mm C25)','m²',14.00,18.00,32.00,'Tamped finish'],
    ['GW-037','Groundworks','Block paving (200x100 standard)','m²',22.00,28.00,50.00,'Inc sub-base & sand'],
    ['GW-038','Groundworks','Tarmac (60mm binder + 25mm wearing)','m²',8.00,26.00,34.00,'Machine laid'],
  ];

  // ── BRICKWORK ──
  const brickwork = [
    ['BW-001','Brickwork & Blockwork','Half brick wall (102.5mm) facing brick','m²',32.00,30.00,62.00,'Standard fletton/wirecut'],
    ['BW-002','Brickwork & Blockwork','Half brick wall stock/handmade brick','m²',35.00,48.00,83.00,'Premium facing'],
    ['BW-003','Brickwork & Blockwork','One brick wall (215mm) facing brick','m²',52.00,58.00,110.00,'Boundary/retaining'],
    ['BW-004','Brickwork & Blockwork','Brick slip cladding system','m²',28.00,45.00,73.00,'Adhesive fixed'],
    ['BW-005','Brickwork & Blockwork','Feature brickwork (corbels/arches)','m',65.00,35.00,100.00,'Specialist bricklayer'],
    ['BW-006','Brickwork & Blockwork','Brick soldier course','m',22.00,12.00,34.00,'Over openings/DPC'],
    ['BW-007','Brickwork & Blockwork','100mm dense concrete block','m²',18.00,14.00,32.00,'7.3N/mm² below DPC'],
    ['BW-008','Brickwork & Blockwork','100mm aerated block (Thermalite)','m²',18.00,16.00,34.00,'Inner leaf above DPC'],
    ['BW-009','Brickwork & Blockwork','140mm aerated block','m²',20.00,20.00,40.00,'Thicker inner leaf'],
    ['BW-010','Brickwork & Blockwork','100mm dense block below DPC','m²',18.00,14.00,32.00,'Foundation walls'],
    ['BW-011','Brickwork & Blockwork','215mm dense concrete block','m²',28.00,26.00,54.00,'Retaining/structural'],
    ['BW-012','Brickwork & Blockwork','Full cavity wall (brick/block) 300mm','m²',48.00,46.00,94.00,'Standard spec above DPC'],
    ['BW-013','Brickwork & Blockwork','Full cavity wall with full fill insulation','m²',52.00,56.00,108.00,'Inc 100mm Dritherm'],
    ['BW-014','Brickwork & Blockwork','Cavity wall below DPC (brick/dense block)','m²',48.00,44.00,92.00,'Below ground cavity'],
    ['BW-015','Brickwork & Blockwork','Cavity insulation (partial fill 50mm PIR)','m²',3.00,8.50,11.50,'Board fixed to inner leaf'],
    ['BW-016','Brickwork & Blockwork','Cavity insulation (full fill 100mm mineral)','m²',2.50,5.50,8.00,'Blown or batt'],
    ['BW-017','Brickwork & Blockwork','Wall ties (stainless steel)','m²',1.00,1.50,2.50,'2.5 per m² min'],
    ['BW-018','Brickwork & Blockwork','Cavity tray (stepped/horizontal)','m',8.00,12.00,20.00,'Above openings'],
    ['BW-019','Brickwork & Blockwork','Cavity closer (insulated)','m',4.00,5.50,9.50,'Around openings'],
    ['BW-020','Brickwork & Blockwork','Concrete lintel (standard 100x65)','m',8.00,14.00,22.00,'Up to 1200mm span'],
    ['BW-021','Brickwork & Blockwork','Steel lintel (Catnic/IG type)','nr',12.00,35.00,47.00,'Standard cavity, to 1800mm'],
    ['BW-022','Brickwork & Blockwork','Steel lintel (wide span 1800-2400mm)','nr',15.00,65.00,80.00,'Heavy duty'],
    ['BW-023','Brickwork & Blockwork','Steel lintel (extra wide 2400-3600mm)','nr',18.00,110.00,128.00,'Structural'],
    ['BW-024','Brickwork & Blockwork','DPC (pitch polymer 225mm wide)','m',3.00,2.50,5.50,'Horizontal DPC'],
    ['BW-025','Brickwork & Blockwork','DPC (pitch polymer 450mm wide)','m',3.50,4.00,7.50,'Step/cavity tray'],
    ['BW-026','Brickwork & Blockwork','Weep vents','nr',0.50,0.80,1.30,'Plastic at 900mm c/c'],
    ['BW-027','Brickwork & Blockwork','Air bricks (terracotta/plastic)','nr',4.00,6.00,10.00,'Subfloor ventilation'],
    ['BW-028','Brickwork & Blockwork','Repointing (rake & repoint)','m²',35.00,8.00,43.00,'Existing brickwork'],
    ['BW-029','Brickwork & Blockwork','Take down half brick wall','m²',18.00,0,18.00,'Inc cart away'],
    ['BW-030','Brickwork & Blockwork','Take down one brick wall','m²',28.00,0,28.00,'Inc cart away'],
    ['BW-031','Brickwork & Blockwork','Form opening in blockwork wall','nr',120.00,35.00,155.00,'Inc lintel, make good'],
    ['BW-032','Brickwork & Blockwork','Form opening in brick wall','nr',180.00,55.00,235.00,'Inc needling, lintel'],
    ['BW-033','Brickwork & Blockwork','Tooth and bond new to existing','m',28.00,5.00,33.00,'Cut & bond'],
  ];

  // ── CARPENTRY ──
  const carpentry = [
    ['CJ-001','Carpentry & Joinery','Floor joists (C24 treated) 47x200','m',4.50,6.50,11.00,'At 400mm c/c'],
    ['CJ-002','Carpentry & Joinery','Floor joists (C24 treated) 47x225','m',4.50,7.50,12.00,'Longer spans'],
    ['CJ-003','Carpentry & Joinery','Ceiling joists 47x100','m',3.50,3.80,7.30,'At 400mm c/c'],
    ['CJ-004','Carpentry & Joinery','Roof rafters 47x150','m',4.50,5.00,9.50,'At 400mm c/c'],
    ['CJ-005','Carpentry & Joinery','Ridge board 47x200','m',4.00,5.50,9.50,'Standard ridge'],
    ['CJ-006','Carpentry & Joinery','Trussed rafters (standard Fink)','m²',8.00,22.00,30.00,'Inc bracing & fixings'],
    ['CJ-007','Carpentry & Joinery','Chipboard flooring (P5 22mm T&G)','m²',6.00,9.50,15.50,'Glued & screwed'],
    ['CJ-008','Carpentry & Joinery','Plywood flooring (18mm WBP)','m²',6.00,14.00,20.00,'Structural deck'],
    ['CJ-009','Carpentry & Joinery','Fascia board (UPVC 18mm)','m',5.00,9.00,14.00,'White, inc fixings'],
    ['CJ-010','Carpentry & Joinery','Soffit board (UPVC 9mm)','m',4.50,7.50,12.00,'Ventilated or solid'],
    ['CJ-011','Carpentry & Joinery','Roof battens (25x50 treated)','m²',3.00,2.50,5.50,'At gauge to suit tiles'],
    ['CJ-012','Carpentry & Joinery','Breathable roofing membrane','m²',1.50,2.50,4.00,'Tyvek or equivalent'],
    ['CJ-013','Carpentry & Joinery','Internal door (hollow core)','nr',45.00,55.00,100.00,'Painted finish'],
    ['CJ-014','Carpentry & Joinery','Internal door (solid core)','nr',50.00,85.00,135.00,'Better quality'],
    ['CJ-015','Carpentry & Joinery','FD30 fire door with intumescent','nr',55.00,180.00,235.00,'With VP and closer'],
    ['CJ-016','Carpentry & Joinery','FD60 fire door','nr',60.00,250.00,310.00,'With VP and closer'],
    ['CJ-017','Carpentry & Joinery','Door lining set (softwood)','nr',25.00,22.00,47.00,'Standard 32x115'],
    ['CJ-018','Carpentry & Joinery','Door ironmongery set (standard)','nr',15.00,35.00,50.00,'Handles, hinges, latch'],
    ['CJ-019','Carpentry & Joinery','External door (composite)','nr',60.00,650.00,710.00,'Thermally broken'],
    ['CJ-020','Carpentry & Joinery','Bi-fold doors (aluminium, per leaf)','nr',80.00,550.00,630.00,'PPC aluminium'],
    ['CJ-021','Carpentry & Joinery','UPVC window (standard casement) up to 1.2m²','nr',55.00,280.00,335.00,'White, A rated'],
    ['CJ-022','Carpentry & Joinery','UPVC window 1.2-2.0m²','nr',65.00,380.00,445.00,'Multi-pane'],
    ['CJ-023','Carpentry & Joinery','Aluminium window (PPC) up to 1.2m²','nr',65.00,450.00,515.00,'Thermally broken'],
    ['CJ-024','Carpentry & Joinery','Roof window / Velux (CK02)','nr',85.00,320.00,405.00,'Inc flashing kit'],
    ['CJ-025','Carpentry & Joinery','Skirting (MDF 18x94mm ogee)','m',4.00,3.50,7.50,'Primed, fixed & filled'],
    ['CJ-026','Carpentry & Joinery','Skirting (MDF 18x144mm ogee)','m',4.50,4.50,9.00,'Taller skirting'],
    ['CJ-027','Carpentry & Joinery','Architrave (MDF 18x58mm ogee)','m',3.00,2.50,5.50,'Standard set'],
    ['CJ-028','Carpentry & Joinery','Staircase (straight flight, softwood)','nr',350.00,650.00,1000.00,'Standard domestic'],
    ['CJ-029','Carpentry & Joinery','Staircase (2 flight with half landing)','nr',500.00,1200.00,1700.00,'Softwood standard'],
    ['CJ-030','Carpentry & Joinery','Newel posts and balustrade','m',35.00,45.00,80.00,'Softwood, std spindles'],
  ];

  // ── ROOFING ──
  const roofing = [
    ['RF-001','Roofing','Concrete interlocking tiles (Marley Modern)','m²',18.00,16.00,34.00,'Standard single lap'],
    ['RF-002','Roofing','Concrete plain tiles (Marley)','m²',24.00,22.00,46.00,'Double lap'],
    ['RF-003','Roofing','Clay plain tiles (hand/machine made)','m²',28.00,38.00,66.00,'Heritage/conservation'],
    ['RF-004','Roofing','Natural slate (Welsh/Spanish 500x250)','m²',35.00,45.00,80.00,'Standard domestic'],
    ['RF-005','Roofing','Natural slate (reclaimed Welsh)','m²',40.00,65.00,105.00,'Heritage, sorted'],
    ['RF-006','Roofing','Artificial slate (Tapco/SSQ)','m²',22.00,18.00,40.00,'Lightweight composite'],
    ['RF-007','Roofing','EPDM single ply membrane','m²',18.00,16.00,34.00,'Inc insulation board'],
    ['RF-008','Roofing','GRP fibreglass flat roof','m²',22.00,24.00,46.00,'Topcoat finish'],
    ['RF-009','Roofing','Felt (3 layer built-up)','m²',16.00,14.00,30.00,'Torch-on cap sheet'],
    ['RF-010','Roofing','Lead flat roof / valley (Code 4)','m²',55.00,45.00,100.00,'Traditional leadwork'],
    ['RF-011','Roofing','Ridge tiles (concrete half round)','m',12.00,8.00,20.00,'Bedded & pointed'],
    ['RF-012','Roofing','Dry ridge system (Manthorpe/Klober)','m',10.00,12.00,22.00,'Mechanical fix'],
    ['RF-013','Roofing','UPVC half round gutter (112mm)','m',6.00,4.50,10.50,'Inc brackets at 1m c/c'],
    ['RF-014','Roofing','UPVC downpipe (68mm round)','m',5.00,4.00,9.00,'Inc brackets'],
    ['RF-015','Roofing','Cast aluminium gutter','m',12.00,18.00,30.00,'Premium, powder coated'],
    ['RF-016','Roofing','Lead stepped flashing (Code 4)','m',35.00,25.00,60.00,'Abutment detail'],
    ['RF-017','Roofing','Lead apron flashing (Code 4)','m',30.00,22.00,52.00,'Head of opening'],
    ['RF-018','Roofing','Loft insulation (mineral wool 270mm)','m²',3.00,6.00,9.00,'Between & over joists'],
    ['RF-019','Roofing','Rafter insulation (PIR 100mm + 50mm)','m²',5.00,28.00,33.00,'Between & below rafters'],
    ['RF-020','Roofing','Warm roof insulation (150mm PIR)','m²',4.00,22.00,26.00,'Flat roof build-up'],
  ];

  // ── PLUMBING ──
  const plumbing = [
    ['PH-001','Plumbing & Heating','Combi boiler (budget, 24-28kW)','nr',350.00,750.00,1100.00,'Baxi/Ideal'],
    ['PH-002','Plumbing & Heating','Combi boiler (mid-range, 28-35kW)','nr',400.00,1100.00,1500.00,'Worcester/Vaillant'],
    ['PH-003','Plumbing & Heating','Combi boiler (premium, 35kW+)','nr',450.00,1600.00,2050.00,'Worcester 8000'],
    ['PH-004','Plumbing & Heating','ASHP (air source heat pump)','nr',2500.00,6500.00,9000.00,'Subject to specialist'],
    ['PH-005','Plumbing & Heating','Radiator (single panel 600x800)','nr',35.00,65.00,100.00,'Type 11, inc TRV'],
    ['PH-006','Plumbing & Heating','Radiator (double panel 600x1000)','nr',40.00,95.00,135.00,'Type 22, inc TRV'],
    ['PH-007','Plumbing & Heating','Radiator (double panel 600x1400)','nr',45.00,130.00,175.00,'Type 22 large'],
    ['PH-008','Plumbing & Heating','Underfloor heating (water)','m²',18.00,28.00,46.00,'Inc manifold share'],
    ['PH-009','Plumbing & Heating','15mm copper pipework','m',8.00,5.50,13.50,'Inc fittings'],
    ['PH-010','Plumbing & Heating','22mm copper pipework','m',10.00,7.50,17.50,'Inc fittings'],
    ['PH-011','Plumbing & Heating','110mm SVP (soil vent pipe)','m',14.00,12.00,26.00,'Inc brackets'],
    ['PH-012','Plumbing & Heating','WC close coupled (budget)','nr',65.00,120.00,185.00,'Standard white'],
    ['PH-013','Plumbing & Heating','WC close coupled (mid-range)','nr',75.00,250.00,325.00,'Roca/Ideal Standard'],
    ['PH-014','Plumbing & Heating','Wall-hung WC with concealed cistern','nr',120.00,380.00,500.00,'Geberit frame'],
    ['PH-015','Plumbing & Heating','Basin pedestal (budget)','nr',55.00,80.00,135.00,'Standard white'],
    ['PH-016','Plumbing & Heating','Basin wall-hung (mid-range)','nr',65.00,180.00,245.00,'Inc bottle trap'],
    ['PH-017','Plumbing & Heating','Bath (acrylic, mid-range)','nr',95.00,280.00,375.00,'Inc panel, taps, waste'],
    ['PH-018','Plumbing & Heating','Shower enclosure + tray (mid)','nr',150.00,400.00,550.00,'Frameless glass'],
    ['PH-019','Plumbing & Heating','Walk-in shower (wetroom)','nr',350.00,650.00,1000.00,'Tanked, linear drain'],
    ['PH-020','Plumbing & Heating','Unvented cylinder 150L','nr',180.00,550.00,730.00,'Megaflo or equiv'],
  ];

  // ── ELECTRICAL ──
  const electrical = [
    ['EL-001','Electrical','Consumer unit (17th/18th Ed, 10-way)','nr',180.00,120.00,300.00,'Metal, RCBO populated'],
    ['EL-002','Electrical','Consumer unit (dual RCD, 12-way)','nr',200.00,180.00,380.00,'Split load'],
    ['EL-003','Electrical','Single socket outlet','nr',32.00,12.00,44.00,'White moulded'],
    ['EL-004','Electrical','Double socket outlet','nr',35.00,14.00,49.00,'White moulded'],
    ['EL-005','Electrical','Double socket (brushed chrome)','nr',38.00,28.00,66.00,'Premium range'],
    ['EL-006','Electrical','USB double socket','nr',38.00,22.00,60.00,'Type A+C'],
    ['EL-007','Electrical','Fused spur (switched)','nr',30.00,10.00,40.00,'For fixed appliances'],
    ['EL-008','Electrical','Cooker circuit (32A)','nr',85.00,35.00,120.00,'Inc isolator switch'],
    ['EL-009','Electrical','Shower circuit (40A)','nr',95.00,35.00,130.00,'Inc isolator'],
    ['EL-010','Electrical','EV charger point (7kW)','nr',350.00,450.00,800.00,'Inc dedicated circuit'],
    ['EL-011','Electrical','Ceiling light point (pendant)','nr',35.00,8.00,43.00,'Rose and flex'],
    ['EL-012','Electrical','Downlight (LED, fire rated)','nr',25.00,18.00,43.00,'IP65 bathroom rated'],
    ['EL-013','Electrical','Wall light point','nr',40.00,12.00,52.00,'Inc back box'],
    ['EL-014','Electrical','External wall light','nr',45.00,35.00,80.00,'IP44 rated'],
    ['EL-015','Electrical','Light switch (1 gang)','nr',22.00,6.00,28.00,'Standard plate'],
    ['EL-016','Electrical','Dimmer switch (1 gang)','nr',28.00,14.00,42.00,'Trailing edge LED'],
    ['EL-017','Electrical','Cat6 data point','nr',45.00,18.00,63.00,'Inc patch panel share'],
    ['EL-018','Electrical','Smoke detector (mains, interlinked)','nr',35.00,22.00,57.00,'Optical/heat'],
    ['EL-019','Electrical','Extractor fan (bathroom, timer)','nr',35.00,45.00,80.00,'IP45, duct kit'],
    ['EL-020','Electrical','EICR (Electrical condition report)','item',250.00,0,250.00,'Full property'],
  ];

  // ── PLASTERING ──
  const plastering = [
    ['PL-001','Plastering & Drylining','Plasterboard to walls (12.5mm std)','m²',8.00,4.50,12.50,'Dot & dab or frame'],
    ['PL-002','Plastering & Drylining','Plasterboard to walls (15mm fireline)','m²',9.00,6.00,15.00,'30 min fire resistance'],
    ['PL-003','Plastering & Drylining','Plasterboard to ceilings (12.5mm)','m²',10.00,4.50,14.50,'Screwed to joists'],
    ['PL-004','Plastering & Drylining','Skim coat to plasterboard (walls)','m²',10.00,3.50,13.50,'2-3mm finish coat'],
    ['PL-005','Plastering & Drylining','Skim coat to plasterboard (ceilings)','m²',12.00,3.50,15.50,'Overhead work'],
    ['PL-006','Plastering & Drylining','Two coat plaster to blockwork','m²',16.00,6.00,22.00,'Backing + finish'],
    ['PL-007','Plastering & Drylining','Metal stud partition (single board)','m²',22.00,14.00,36.00,'70mm C stud'],
    ['PL-008','Plastering & Drylining','Metal stud partition (double board)','m²',28.00,20.00,48.00,'Better acoustic'],
    ['PL-009','Plastering & Drylining','Timber stud partition (single board)','m²',20.00,12.00,32.00,'75x50 CLS studs'],
    ['PL-010','Plastering & Drylining','Sand/cement render (2 coat)','m²',22.00,8.00,30.00,'External walls'],
    ['PL-011','Plastering & Drylining','Monocouche render (1 coat)','m²',18.00,14.00,32.00,'Through-colour finish'],
    ['PL-012','Plastering & Drylining','Suspended ceiling grid (600x600)','m²',14.00,12.00,26.00,'Standard mineral tile'],
    ['PL-013','Plastering & Drylining','MF ceiling (plasterboard on channel)','m²',18.00,10.00,28.00,'Flat MF grid'],
    ['PL-014','Plastering & Drylining','EWI system (100mm EPS + render)','m²',18.00,42.00,60.00,'External wall insulation'],
    ['PL-015','Plastering & Drylining','Plaster cornice / coving (plain)','m',8.00,5.00,13.00,'100mm paper faced'],
  ];

  // ── DECORATING ──
  const decorating = [
    ['DC-001','Decorating','Mist coat + 2 coats emulsion (new plaster)','m²',6.50,2.50,9.00,'Standard vinyl matt'],
    ['DC-002','Decorating','Prep & 2 coats emulsion (existing)','m²',7.50,2.50,10.00,'Fill, sand, paint'],
    ['DC-003','Decorating','Mist coat + 2 coats emulsion (ceiling)','m²',7.50,2.50,10.00,'New plaster ceiling'],
    ['DC-004','Decorating','Gloss/satin to skirting','m',4.00,1.50,5.50,'Prep, prime, undercoat, gloss'],
    ['DC-005','Decorating','Gloss/satin to architrave','m',3.00,1.00,4.00,'Both sides'],
    ['DC-006','Decorating','Paint door (both sides)','nr',55.00,8.00,63.00,'Prep, prime, 2 coats'],
    ['DC-007','Decorating','Paint door frame/lining','nr',22.00,4.00,26.00,'All visible faces'],
    ['DC-008','Decorating','Masonry paint (2 coats)','m²',6.00,3.00,9.00,'Smooth masonry'],
    ['DC-009','Decorating','Strip wallpaper','m²',5.00,1.00,6.00,'Steam strip'],
    ['DC-010','Decorating','Fill & make good (general)','m²',4.00,1.50,5.50,'Cracks, holes, imperfections'],
  ];

  // ── TILING ──
  const tiling = [
    ['TL-001','Tiling','Ceramic wall tiles (budget)','m²',28.00,15.00,43.00,'200x200/250x400'],
    ['TL-002','Tiling','Ceramic wall tiles (mid-range)','m²',30.00,25.00,55.00,'Metro/feature'],
    ['TL-003','Tiling','Porcelain wall tiles (large format)','m²',35.00,35.00,70.00,'600x300+'],
    ['TL-004','Tiling','Ceramic floor tiles (budget)','m²',28.00,18.00,46.00,'Standard 300x300'],
    ['TL-005','Tiling','Porcelain floor tiles (600x600)','m²',38.00,35.00,73.00,'Rectified'],
    ['TL-006','Tiling','Natural stone floor (limestone)','m²',45.00,55.00,100.00,'Inc sealer'],
    ['TL-007','Tiling','Tile backer board (12mm)','m²',12.00,10.00,22.00,'Wet area substrate'],
    ['TL-008','Tiling','Tanking / waterproof membrane','m²',10.00,8.00,18.00,'Shower/wetroom'],
    ['TL-009','Tiling','Self-levelling compound','m²',8.00,6.00,14.00,'Up to 10mm depth'],
    ['TL-010','Tiling','Hack off existing tiles','m²',14.00,0,14.00,'Inc disposal'],
  ];

  // ── KITCHEN & BATHROOM ──
  const kitchenBath = [
    ['KB-001','Kitchen & Bathroom','Kitchen units (budget, per lin m)','m',120.00,280.00,400.00,'Flat pack, basic doors'],
    ['KB-002','Kitchen & Bathroom','Kitchen units (mid-range, per lin m)','m',150.00,500.00,650.00,'Rigid, Shaker style'],
    ['KB-003','Kitchen & Bathroom','Kitchen units (premium, per lin m)','m',180.00,900.00,1080.00,'In-frame, bespoke'],
    ['KB-004','Kitchen & Bathroom','Laminate worktop','m',25.00,35.00,60.00,'38mm postformed'],
    ['KB-005','Kitchen & Bathroom','Quartz worktop (Silestone etc)','m',35.00,250.00,285.00,'Template & fit'],
    ['KB-006','Kitchen & Bathroom','Granite worktop','m',35.00,280.00,315.00,'Template & fit'],
    ['KB-007','Kitchen & Bathroom','Built-in oven (mid-range)','nr',40.00,500.00,540.00,'Bosch/Neff'],
    ['KB-008','Kitchen & Bathroom','Hob (induction, 4 zone)','nr',40.00,350.00,390.00,'Mid-range'],
    ['KB-009','Kitchen & Bathroom','Bathroom suite (budget, full)','item',800.00,900.00,1700.00,'WC, basin, bath, tiling'],
    ['KB-010','Kitchen & Bathroom','Bathroom suite (mid, full)','item',1200.00,2000.00,3200.00,'Wall-hung WC, vanity'],
    ['KB-011','Kitchen & Bathroom','Shower room (mid, full)','item',1000.00,1500.00,2500.00,'Frameless enclosure'],
    ['KB-012','Kitchen & Bathroom','Cloakroom/WC (budget)','item',400.00,350.00,750.00,'WC, basin, tiling'],
  ];

  // ── PRELIMINARIES ──
  const prelims = [
    ['PR-001','Preliminaries','Site compound setup','item',800.00,400.00,1200.00,'Hoarding, fencing, signage'],
    ['PR-002','Preliminaries','Site welfare cabin (hire per week)','wk',0,120.00,120.00,'Toilet & drying room'],
    ['PR-003','Preliminaries','Site office (hire per week)','wk',0,95.00,95.00,'Portacabin'],
    ['PR-004','Preliminaries','Temporary electric supply','item',180.00,120.00,300.00,'Builder board'],
    ['PR-005','Preliminaries','Hoarding (solid timber 2.4m)','m',28.00,22.00,50.00,'Per linear metre'],
    ['PR-006','Preliminaries','Scaffolding (independent, 2 lift)','m²',0,14.00,14.00,'Erect, hire 8wk, dismantle'],
    ['PR-007','Preliminaries','Scaffolding (independent, 3 lift)','m²',0,18.00,18.00,'Higher elevation'],
    ['PR-008','Preliminaries','Site manager','wk',350.00,0,350.00,'Full time on site'],
    ['PR-009','Preliminaries','Working foreman','wk',300.00,0,300.00,'Trades foreman'],
    ['PR-010','Preliminaries','6yd skip (mixed waste)','nr',0,280.00,280.00,'Delivered & collected'],
    ['PR-011','Preliminaries','8yd skip (mixed waste)','nr',0,340.00,340.00,'Larger jobs'],
    ['PR-012','Preliminaries','12yd skip (mixed waste)','nr',0,420.00,420.00,'Major demolition'],
    ['PR-013','Preliminaries','Floor protection (Correx)','m²',2.00,1.50,3.50,'During works'],
    ['PR-014','Preliminaries','Builders clean (progressive)','wk',120.00,15.00,135.00,'Weekly tidy'],
    ['PR-015','Preliminaries','Final clean (domestic)','m²',3.50,1.00,4.50,'End of project'],
    ['PR-016','Preliminaries','Building control fees (domestic)','item',0,450.00,450.00,'Plan check + inspect'],
    ['PR-017','Preliminaries','Party wall surveyor','item',0,1200.00,1200.00,'Per adjoining owner'],
    ['PR-018','Preliminaries','Mini excavator 1.5T (hire per week)','wk',0,250.00,250.00,'Delivery extra'],
    ['PR-019','Preliminaries','Concrete pump (per visit)','nr',0,450.00,450.00,'Boom pump'],
    ['PR-020','Preliminaries','Asbestos survey (management)','item',0,350.00,350.00,'Type 2'],
  ];

  seedMany(groundworks);
  seedMany(brickwork);
  seedMany(carpentry);
  seedMany(roofing);
  seedMany(plumbing);
  seedMany(electrical);
  seedMany(plastering);
  seedMany(decorating);
  seedMany(tiling);
  seedMany(kitchenBath);
  seedMany(prelims);

  // ── LOCATION FACTORS ──
  const insLoc = db.prepare('INSERT INTO location_factors (id, location, region, labour_factor, materials_factor) VALUES (?, ?, ?, ?, ?)');
  const seedLocations = db.transaction((locs) => {
    for (const l of locs) insLoc.run(uuidv4(), l[0], l[1], l[2], l[3]);
  });

  seedLocations([
    ['Central London','London',1.25,1.10],['Inner London','London',1.20,1.08],['Outer London','London',1.15,1.05],
    ['Guildford','South East',1.10,1.04],['Brighton','South East',1.08,1.03],['Oxford','South East',1.10,1.04],
    ['Winchester','South East',1.08,1.03],['Southampton','South East',1.05,1.02],
    ['Bristol','South West',1.02,1.00],['Bath','South West',1.05,1.02],['Exeter','South West',0.97,0.98],
    ['Birmingham','Midlands',1.00,1.00],['Coventry','Midlands',0.98,1.00],['Nottingham','Midlands',0.95,0.99],
    ['Leicester','Midlands',0.96,0.99],
    ['Cambridge','East',1.08,1.03],['Norwich','East',0.95,0.99],
    ['Manchester','North West',0.97,0.99],['Liverpool','North West',0.95,0.98],['Chester','North West',0.98,1.00],
    ['Leeds','North East / Yorks',0.95,0.99],['Sheffield','North East / Yorks',0.93,0.98],
    ['Newcastle','North East',0.92,0.97],['York','North East / Yorks',0.97,1.00],
    ['Edinburgh','Scotland',1.02,1.02],['Glasgow','Scotland',0.97,1.00],['Aberdeen','Scotland',1.05,1.04],
    ['Inverness','Scotland',1.10,1.08],['Fort William','Scotland',1.15,1.12],
    ['Cardiff','Wales',0.95,0.99],['Swansea','Wales',0.92,0.98],
    ['Belfast','Northern Ireland',0.88,0.95],['Derry','Northern Ireland',0.85,0.93],
    ['Dublin','Ireland',1.15,1.10],['Cork','Ireland',1.05,1.05],['Galway','Ireland',1.02,1.03],
    ['Limerick','Ireland',1.00,1.02],
  ]);

  const totalRates = db.prepare('SELECT COUNT(*) as c FROM rates').get().c;
  const totalLocs = db.prepare('SELECT COUNT(*) as c FROM location_factors').get().c;
  console.log(`[Rates] Seeded ${totalRates} rates + ${totalLocs} location factors`);
}

seedIfEmpty();

// ═══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET all libraries ──
router.get('/admin/rate-libraries', authMiddleware, adminMiddleware, (req, res) => {
  const libs = db.prepare('SELECT rl.*, COUNT(r.id) as item_count FROM rate_libraries rl LEFT JOIN rates r ON r.library_id = rl.id GROUP BY rl.id ORDER BY rl.is_custom ASC, rl.name ASC').all();
  res.json(libs);
});

// ── GET single library with all rates ──
router.get('/admin/rate-libraries/:id', authMiddleware, adminMiddleware, (req, res) => {
  const lib = db.prepare('SELECT * FROM rate_libraries WHERE id = ?').get(req.params.id);
  if (!lib) return res.status(404).json({ error: 'Library not found' });
  const rates = db.prepare('SELECT * FROM rates WHERE library_id = ? ORDER BY code ASC').all(req.params.id);
  res.json({ ...lib, rates });
});

// ── GET rates with search/filter ──
router.get('/admin/rates', authMiddleware, adminMiddleware, (req, res) => {
  const { library_id, trade, search, page = 1, limit = 50 } = req.query;
  let sql = 'SELECT r.*, rl.name as library_name FROM rates r LEFT JOIN rate_libraries rl ON rl.id = r.library_id WHERE 1=1';
  const params = [];

  if (library_id) { sql += ' AND r.library_id = ?'; params.push(library_id); }
  if (trade) { sql += ' AND r.trade = ?'; params.push(trade); }
  if (search) {
    sql += ' AND (r.code LIKE ? OR r.description LIKE ? OR r.notes LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const countSql = sql.replace('SELECT r.*, rl.name as library_name', 'SELECT COUNT(*) as total');
  const total = db.prepare(countSql).get(...params).total;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  sql += ' ORDER BY r.trade ASC, r.code ASC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const rates = db.prepare(sql).all(...params);
  const trades = db.prepare('SELECT DISTINCT trade FROM rates ORDER BY trade ASC').all().map(r => r.trade);

  res.json({ rates, total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)), trades });
});

// ── GET all trades (for filter dropdown) ──
router.get('/admin/rates/trades', authMiddleware, adminMiddleware, (req, res) => {
  const trades = db.prepare('SELECT DISTINCT trade FROM rates ORDER BY trade ASC').all().map(r => r.trade);
  res.json(trades);
});

// ── GET location factors ──
router.get('/admin/location-factors', authMiddleware, adminMiddleware, (req, res) => {
  const factors = db.prepare('SELECT * FROM location_factors ORDER BY region ASC, location ASC').all();
  res.json(factors);
});

// ── CREATE rate ──
router.post('/admin/rates', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { library_id, code, trade, description, unit, labour_rate, material_rate, notes } = req.body;
    if (!library_id || !code || !trade || !description || !unit) {
      return res.status(400).json({ error: 'library_id, code, trade, description, and unit are required' });
    }
    const id = uuidv4();
    const total = (parseFloat(labour_rate) || 0) + (parseFloat(material_rate) || 0);
    db.prepare('INSERT INTO rates (id, library_id, code, trade, description, unit, labour_rate, material_rate, total_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, library_id, code, trade, description, unit, parseFloat(labour_rate) || 0, parseFloat(material_rate) || 0, total, notes || null
    );
    const rate = db.prepare('SELECT * FROM rates WHERE id = ?').get(id);
    res.status(201).json(rate);
  } catch (err) {
    console.error('Create rate error:', err);
    res.status(500).json({ error: 'Failed to create rate' });
  }
});

// ── UPDATE rate ──
router.put('/admin/rates/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const rate = db.prepare('SELECT * FROM rates WHERE id = ?').get(req.params.id);
    if (!rate) return res.status(404).json({ error: 'Rate not found' });

    const { code, trade, description, unit, labour_rate, material_rate, notes } = req.body;
    const newLabour = labour_rate !== undefined ? parseFloat(labour_rate) : rate.labour_rate;
    const newMaterial = material_rate !== undefined ? parseFloat(material_rate) : rate.material_rate;
    const total = newLabour + newMaterial;

    db.prepare('UPDATE rates SET code = ?, trade = ?, description = ?, unit = ?, labour_rate = ?, material_rate = ?, total_rate = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      code || rate.code, trade || rate.trade, description || rate.description, unit || rate.unit,
      newLabour, newMaterial, total, notes !== undefined ? notes : rate.notes, req.params.id
    );

    const updated = db.prepare('SELECT * FROM rates WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update rate error:', err);
    res.status(500).json({ error: 'Failed to update rate' });
  }
});

// ── DELETE rate ──
router.delete('/admin/rates/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const rate = db.prepare('SELECT id FROM rates WHERE id = ?').get(req.params.id);
    if (!rate) return res.status(404).json({ error: 'Rate not found' });
    db.prepare('DELETE FROM rates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete rate error:', err);
    res.status(500).json({ error: 'Failed to delete rate' });
  }
});

// ── BULK IMPORT rates (JSON array) ──
router.post('/admin/rates/import', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { library_id, rates: ratesData } = req.body;
    if (!library_id || !Array.isArray(ratesData)) {
      return res.status(400).json({ error: 'library_id and rates array required' });
    }
    const lib = db.prepare('SELECT id FROM rate_libraries WHERE id = ?').get(library_id);
    if (!lib) return res.status(404).json({ error: 'Library not found' });

    const ins = db.prepare('INSERT INTO rates (id, library_id, code, trade, description, unit, labour_rate, material_rate, total_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let imported = 0;
    const errors = [];

    const importTx = db.transaction(() => {
      for (const r of ratesData) {
        try {
          const labour = parseFloat(r.labour_rate) || 0;
          const material = parseFloat(r.material_rate) || 0;
          ins.run(uuidv4(), library_id, r.code, r.trade, r.description, r.unit, labour, material, labour + material, r.notes || null);
          imported++;
        } catch (e) {
          errors.push({ code: r.code, error: e.message });
        }
      }
    });

    importTx();
    res.json({ imported, errors, total: ratesData.length });
  } catch (err) {
    console.error('Import rates error:', err);
    res.status(500).json({ error: 'Failed to import rates' });
  }
});

// ── EXPORT rates as JSON ──
router.get('/admin/rates/export/:libraryId', authMiddleware, adminMiddleware, (req, res) => {
  const lib = db.prepare('SELECT * FROM rate_libraries WHERE id = ?').get(req.params.libraryId);
  if (!lib) return res.status(404).json({ error: 'Library not found' });
  const rates = db.prepare('SELECT code, trade, description, unit, labour_rate, material_rate, total_rate, notes FROM rates WHERE library_id = ? ORDER BY code ASC').all(req.params.libraryId);
  res.json({ library: lib, rates, exported_at: new Date().toISOString(), count: rates.length });
});

// ── CREATE new library ──
router.post('/admin/rate-libraries', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { name, version, description, region, is_custom } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const id = uuidv4();
    db.prepare('INSERT INTO rate_libraries (id, name, version, description, region, is_custom) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, name, version || 'v1.0', description || null, region || null, is_custom ? 1 : 0
    );
    const lib = db.prepare('SELECT * FROM rate_libraries WHERE id = ?').get(id);
    res.status(201).json(lib);
  } catch (err) {
    console.error('Create library error:', err);
    res.status(500).json({ error: 'Failed to create library' });
  }
});

// ── DELETE library and all its rates ──
router.delete('/admin/rate-libraries/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const lib = db.prepare('SELECT id FROM rate_libraries WHERE id = ?').get(req.params.id);
    if (!lib) return res.status(404).json({ error: 'Library not found' });
    db.prepare('DELETE FROM rates WHERE library_id = ?').run(req.params.id);
    db.prepare('DELETE FROM rate_libraries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete library error:', err);
    res.status(500).json({ error: 'Failed to delete library' });
  }
});

module.exports = router;

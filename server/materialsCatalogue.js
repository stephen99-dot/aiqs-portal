// ═══════════════════════════════════════════════════════════════════════════════
// MATERIALS PRICING — built-in UK catalogue — server/materialsCatalogue.js
//
// A broad catalogue of common UK building materials across every trade, so the
// module ships usefully populated out of the box. Each material gets several
// supplier prices (generated deterministically around a representative base
// price) so the cheapest↔most-expensive comparison is meaningful.
//
// IMPORTANT: these are REPRESENTATIVE SAMPLE prices, not live captures — they
// carry NO source_url (so the "Verify" link never 404s) and captured_via =
// 'estimate'. Replace/augment with real figures via Scrape / CSV import / manual
// entry. ensureCatalogue() is idempotent: it only adds materials not already
// present (matched on canonical_name), so it is safe to run on every boot and
// will not duplicate or overwrite the existing rows.
// ═══════════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');

// Per-supplier price multiplier + account type. Trade merchants tend to be a
// touch cheaper on materials; sheds a touch dearer. Spread drives the compare.
const SUPPLIERS = [
  { name: 'Selco',          account_type: 'trade',  factor: 0.93, website: 'https://www.selcobw.com' },
  { name: 'Toolstation',    account_type: 'retail', factor: 0.98, website: 'https://www.toolstation.com' },
  { name: 'Screwfix',       account_type: 'retail', factor: 1.00, website: 'https://www.screwfix.com' },
  { name: 'MKM',            account_type: 'trade',  factor: 1.02, website: 'https://www.mkmbs.co.uk' },
  { name: 'Jewson',         account_type: 'trade',  factor: 1.03, website: 'https://www.jewson.co.uk' },
  { name: 'Travis Perkins', account_type: 'trade',  factor: 1.05, website: 'https://www.travisperkins.co.uk' },
  { name: 'Wickes',         account_type: 'retail', factor: 1.06, website: 'https://www.wickes.co.uk' },
  { name: 'B&Q',            account_type: 'retail', factor: 1.08, website: 'https://www.diy.com' },
];

// name, category, unit, base (£ representative), aliases. The first 11 names
// match the original seed so they de-duplicate cleanly. This hand-written core
// is combined with generated dimensional variants (see buildVariants) below.
const HAND_CATALOGUE = [
  // ── Timber & carcassing ───────────────────────────────────────────────────
  ['Sawn Timber 47x100mm (4x2) C16 Treated', 'Timber', 'm', 6.20, '4x2,4 by 2,47x100,two by four,2x4,carcassing,stud,joist'],
  ['Sawn Timber 47x75mm (3x2) C16 Treated', 'Timber', 'm', 4.80, '3x2,47x75,three by two,carcassing'],
  ['Sawn Timber 47x150mm (6x2) C16 Treated', 'Timber', 'm', 9.40, '6x2,47x150,six by two,joist'],
  ['Sawn Timber 47x200mm (8x2) C16 Treated', 'Timber', 'm', 13.20, '8x2,47x200,eight by two,joist'],
  ['Sawn Timber 47x225mm (9x2) C24 Joist', 'Timber', 'm', 16.50, '9x2,47x225,c24,floor joist'],
  ['CLS Studwork Timber 38x63mm', 'Timber', 'm', 2.30, 'cls,studwork,partition,38x63'],
  ['CLS Studwork Timber 38x89mm', 'Timber', 'm', 3.10, 'cls,studwork,partition,38x89,4x2 cls'],
  ['Planed Softwood PSE 18x44mm', 'Timber', 'm', 1.60, 'pse,planed,par,batten'],
  ['Planed Softwood PSE 18x69mm', 'Timber', 'm', 2.20, 'pse,planed,par'],
  ['Roofing Batten 25x50mm Treated', 'Timber', 'm', 1.05, 'roof batten,tile batten,25x50'],
  ['Timber Decking Board 28x120mm Treated', 'Timber', 'm', 4.10, 'decking,deck board,28x120'],
  ['Fence Post 100x100mm Treated 2.4m', 'Timber', 'each', 12.50, 'fence post,4x4 post,gate post'],
  ['Featheredge Fence Panel 6x6ft', 'Timber', 'each', 38.00, 'fence panel,closeboard,featheredge'],
  ['Concrete Gravel Board 150mm 1.83m', 'Timber', 'each', 9.00, 'gravel board,fence base'],
  ['Treated Softwood Sleeper 200x100x2.4m', 'Timber', 'each', 22.00, 'sleeper,railway sleeper,raised bed'],

  // ── Sheet materials ───────────────────────────────────────────────────────
  ['OSB3 Board 18mm 2400x1200mm', 'Sheet Materials', 'sheet', 22.00, 'osb,osb3,sterling board,oriented strand board,18mm,8x4'],
  ['OSB3 Board 11mm 2400x1200mm', 'Sheet Materials', 'sheet', 16.00, 'osb,osb3,11mm,roof sheathing'],
  ['OSB3 Board 9mm 2400x1200mm', 'Sheet Materials', 'sheet', 13.50, 'osb,osb3,9mm,hoarding'],
  ['Hardwood Plywood 18mm 2440x1220mm', 'Sheet Materials', 'sheet', 42.00, 'plywood,ply,hardwood ply,18mm'],
  ['WBP Plywood 12mm 2440x1220mm', 'Sheet Materials', 'sheet', 30.00, 'plywood,wbp,12mm ply'],
  ['Marine Plywood 18mm 2440x1220mm', 'Sheet Materials', 'sheet', 60.00, 'marine ply,plywood,18mm'],
  ['MDF Standard 18mm 2440x1220mm', 'Sheet Materials', 'sheet', 26.00, 'mdf,medium density fibreboard,18mm'],
  ['MDF Moisture Resistant 18mm 2440x1220mm', 'Sheet Materials', 'sheet', 33.00, 'mdf mr,moisture resistant mdf,green mdf'],
  ['Chipboard Flooring T&G 22mm 2400x600mm', 'Sheet Materials', 'sheet', 14.00, 'chipboard,flooring,tongue and groove,p5,22mm'],
  ['Chipboard Flooring T&G 18mm 2400x600mm', 'Sheet Materials', 'sheet', 11.00, 'chipboard,flooring,18mm,p5'],
  ['Hardboard 3mm 2440x1220mm', 'Sheet Materials', 'sheet', 8.00, 'hardboard,3mm,floor protection'],

  // ── Plasterboard & plaster ────────────────────────────────────────────────
  ['Plasterboard Standard 12.5mm 2400x1200mm', 'Plasterboard', 'sheet', 9.50, 'plasterboard,gyproc,wallboard,drywall,gypsum,8x4 board'],
  ['Plasterboard Standard 9.5mm 2400x1200mm', 'Plasterboard', 'sheet', 8.00, 'plasterboard,9.5mm,ceiling board'],
  ['Moisture Resistant Plasterboard 12.5mm 2400x1200mm', 'Plasterboard', 'sheet', 14.00, 'mr board,moisture board,green board,bathroom board'],
  ['Fireline Plasterboard 12.5mm 2400x1200mm', 'Plasterboard', 'sheet', 13.00, 'fireline,fire board,pink board'],
  ['Soundbloc Plasterboard 12.5mm 2400x1200mm', 'Plasterboard', 'sheet', 16.00, 'soundbloc,acoustic board,blue board'],
  ['Tapered Edge Plasterboard 15mm 2400x1200mm', 'Plasterboard', 'sheet', 12.00, 'plasterboard,15mm,tapered edge'],
  ['Multi-Finish Plaster 25kg', 'Plaster', 'bag', 11.00, 'multi finish,thistle multi,skim plaster,finish plaster'],
  ['Bonding Coat Plaster 25kg', 'Plaster', 'bag', 9.50, 'bonding,undercoat plaster,thistle bonding'],
  ['Hardwall Plaster 25kg', 'Plaster', 'bag', 9.00, 'hardwall,undercoat,thistle hardwall'],
  ['Browning Plaster 25kg', 'Plaster', 'bag', 9.20, 'browning,undercoat plaster'],
  ['One Coat Plaster 25kg', 'Plaster', 'bag', 10.00, 'one coat,patching plaster'],
  ['Drywall Adhesive 25kg', 'Plaster', 'bag', 8.50, 'dryfix,dot and dab,drywall adhesive,bonding compound'],
  ['Jointing Compound Ready Mixed 25kg', 'Plaster', 'tub', 18.00, 'jointing compound,joint filler,easi-fill,taping'],
  ['Drywall Scrim Tape 90m', 'Plaster', 'roll', 2.50, 'scrim,jointing tape,mesh tape'],
  ['Galvanised Angle Bead 2.4m', 'Plaster', 'each', 1.80, 'angle bead,corner bead,plaster bead'],

  // ── Insulation ────────────────────────────────────────────────────────────
  ['Celotex / PIR Insulation Board 100mm 2400x1200mm', 'Insulation', 'sheet', 38.00, 'celotex,kingspan,pir,rigid insulation,100mm'],
  ['Celotex / PIR Insulation Board 75mm 2400x1200mm', 'Insulation', 'sheet', 30.00, 'celotex,kingspan,pir,75mm'],
  ['Celotex / PIR Insulation Board 50mm 2400x1200mm', 'Insulation', 'sheet', 22.00, 'celotex,kingspan,pir,50mm'],
  ['Celotex / PIR Insulation Board 25mm 2400x1200mm', 'Insulation', 'sheet', 13.00, 'celotex,kingspan,pir,25mm'],
  ['Celotex / PIR Insulation Board 150mm 2400x1200mm', 'Insulation', 'sheet', 55.00, 'celotex,kingspan,pir,150mm'],
  ['Loft Insulation Roll 170mm 5.4m²', 'Insulation', 'roll', 21.00, 'loft roll,mineral wool,glass wool,170mm,quilt'],
  ['Loft Insulation Roll 100mm 8.3m²', 'Insulation', 'roll', 20.00, 'loft roll,mineral wool,100mm,quilt'],
  ['Cavity Wall Batt 100mm', 'Insulation', 'pack', 24.00, 'cavity batt,rockwool,dritherm,cavity insulation'],
  ['Acoustic Mineral Wool Slab 50mm', 'Insulation', 'pack', 18.00, 'acoustic slab,rockwool,sound insulation,rwa45'],
  ['Earthwool Insulation Roll 100mm', 'Insulation', 'roll', 19.00, 'earthwool,knauf,mineral wool,100mm'],
  ['Multifoil Insulation Roll 1.5m x 10m', 'Insulation', 'roll', 45.00, 'multifoil,foil insulation,superquilt'],

  // ── Cement, aggregates & concrete ─────────────────────────────────────────
  ['Portland Cement 25kg', 'Cement & Aggregates', 'bag', 6.20, 'cement,opc,portland,grey cement'],
  ['Rapid Set Cement 25kg', 'Cement & Aggregates', 'bag', 8.00, 'rapid cement,quick set'],
  ['Postcrete Post Mix 20kg', 'Cement & Aggregates', 'bag', 7.00, 'postcrete,post mix,fence post concrete'],
  ['Sharp Sand 25kg (Maxi Bag)', 'Cement & Aggregates', 'bag', 4.20, 'sharp sand,grit sand,concreting sand'],
  ['Building Sand 25kg (Maxi Bag)', 'Cement & Aggregates', 'bag', 4.00, 'building sand,soft sand,plastering sand,bricklaying'],
  ['Ballast 25kg (Maxi Bag)', 'Cement & Aggregates', 'bag', 4.30, 'ballast,aggregate,concrete mix'],
  ['Gravel / Shingle 20mm 25kg', 'Cement & Aggregates', 'bag', 4.50, 'gravel,shingle,20mm,pea gravel'],
  ['MOT Type 1 Sub-base 25kg', 'Cement & Aggregates', 'bag', 4.00, 'mot type 1,sub base,hardcore'],
  ['Ready Mix Concrete 20kg', 'Cement & Aggregates', 'bag', 4.50, 'ready mix,concrete mix,bagged concrete'],
  ['Mortar Mix 20kg', 'Cement & Aggregates', 'bag', 5.00, 'mortar,bricklaying mortar'],
  ['Mortar Plasticiser 5L', 'Cement & Aggregates', 'bottle', 9.00, 'plasticiser,mortar admix,feb'],
  ['SBR Bonding Agent 5L', 'Cement & Aggregates', 'tub', 18.00, 'sbr,bonding agent,primer'],
  ['Bulk Bag Sharp Sand (~800kg)', 'Cement & Aggregates', 'bag', 55.00, 'bulk bag,sharp sand,tonne bag'],
  ['Bulk Bag Ballast (~800kg)', 'Cement & Aggregates', 'bag', 58.00, 'bulk bag,ballast,tonne bag'],
  ['Bulk Bag MOT Type 1 (~800kg)', 'Cement & Aggregates', 'bag', 52.00, 'bulk bag,mot type 1,hardcore,tonne bag'],

  // ── Bricks & blocks ───────────────────────────────────────────────────────
  ['Facing Brick 65mm', 'Bricks & Blocks', 'each', 0.65, 'facing brick,brick,65mm'],
  ['Common Brick', 'Bricks & Blocks', 'each', 0.50, 'common brick,brick'],
  ['Class B Engineering Brick', 'Bricks & Blocks', 'each', 0.70, 'engineering brick,class b,blue brick'],
  ['Dense Concrete Block 7.3N 100mm', 'Bricks & Blocks', 'each', 1.60, 'concrete block,dense block,7.3n,100mm'],
  ['Aircrete Block 100mm', 'Bricks & Blocks', 'each', 1.90, 'aircrete,aerated block,thermalite,celcon,100mm'],
  ['Aircrete Block 140mm', 'Bricks & Blocks', 'each', 2.60, 'aircrete,aerated block,140mm'],
  ['Concrete Pier Cap 305x305mm', 'Bricks & Blocks', 'each', 9.00, 'pier cap,pillar cap'],

  // ── Roofing ───────────────────────────────────────────────────────────────
  ['Concrete Roof Tile', 'Roofing', 'each', 0.95, 'roof tile,concrete tile,marley'],
  ['Plain Clay Roof Tile', 'Roofing', 'each', 0.60, 'clay tile,plain tile,roof tile'],
  ['Concrete Ridge Tile', 'Roofing', 'each', 6.00, 'ridge tile,half round ridge'],
  ['Natural Slate 500x250mm', 'Roofing', 'each', 1.60, 'slate,roof slate,natural slate'],
  ['Shed Roofing Felt 10m', 'Roofing', 'roll', 22.00, 'shed felt,roofing felt,green felt'],
  ['Breathable Roofing Membrane 1x50m', 'Roofing', 'roll', 55.00, 'breathable membrane,roofing felt,tyvek,roofshield'],
  ['Lead Flashing Code 4 300mm x 3m', 'Roofing', 'roll', 45.00, 'lead,flashing,code 4'],
  ['UPVC Half Round Gutter 4m', 'Roofing', 'length', 7.00, 'guttering,gutter,half round'],
  ['UPVC Downpipe 68mm 2.5m', 'Roofing', 'each', 8.00, 'downpipe,rainwater pipe,68mm'],
  ['UPVC Soffit Board 9mm 5m', 'Roofing', 'length', 18.00, 'soffit,soffit board'],
  ['UPVC Fascia Board 18mm 5m', 'Roofing', 'length', 28.00, 'fascia,fascia board'],

  // ── Drainage & groundworks ────────────────────────────────────────────────
  ['Underground Drainage Pipe 110mm 3m', 'Drainage', 'each', 14.00, 'drainage pipe,110mm,underground,soil pipe'],
  ['Drainage Bend 110mm 90°', 'Drainage', 'each', 5.00, 'drainage bend,110mm bend'],
  ['Soil Pipe 110mm 3m', 'Drainage', 'each', 16.00, 'soil pipe,110mm,svp'],
  ['Inspection Chamber 450mm', 'Drainage', 'each', 38.00, 'inspection chamber,manhole'],
  ['Land Drainage Coil 80mm 25m', 'Drainage', 'roll', 26.00, 'land drain,perforated pipe,80mm'],
  ['Geotextile Membrane 4.5x11m', 'Drainage', 'roll', 30.00, 'geotextile,terram,separation membrane'],
  ['Manhole Cover & Frame 450x450mm', 'Drainage', 'each', 28.00, 'manhole cover,drain cover'],
  ['Channel Drain 1m with Grate', 'Drainage', 'each', 18.00, 'channel drain,aco drain,linear drain'],

  // ── Fixings & fasteners ───────────────────────────────────────────────────
  ['Wood Screws 4x40mm (200 pack)', 'Fixings', 'box', 6.00, 'wood screws,4x40,screws'],
  ['Wood Screws 5x70mm (100 pack)', 'Fixings', 'box', 7.00, 'wood screws,5x70,screws'],
  ['Decking Screws 5x60mm (250 pack)', 'Fixings', 'box', 14.00, 'decking screws,5x60'],
  ['Plasterboard Screws 35mm (1000 pack)', 'Fixings', 'box', 9.00, 'plasterboard screws,drywall screws,35mm'],
  ['Masonry Frame Fixings 100mm (50 pack)', 'Fixings', 'box', 12.00, 'frame fixings,masonry fixings,hammer fixings'],
  ['Assorted Wall Plugs (200 pack)', 'Fixings', 'pack', 4.00, 'wall plugs,rawl plugs,plugs'],
  ['Coach Bolts M10x100mm (10 pack)', 'Fixings', 'pack', 6.00, 'coach bolts,m10,carriage bolts'],
  ['Round Wire Nails 100mm 1kg', 'Fixings', 'box', 4.00, 'nails,wire nails,100mm,4 inch'],
  ['Galvanised Clout Nails 30mm 1kg', 'Fixings', 'box', 5.00, 'clout nails,felt nails,galvanised'],
  ['Resin Anchor Studs M10 (10 pack)', 'Fixings', 'pack', 9.00, 'resin anchor,chemical anchor,m10'],
  ['Galvanised Joist Hanger 47mm', 'Fixings', 'each', 1.60, 'joist hanger,47mm'],
  ['Heavy Duty Angle Bracket', 'Fixings', 'each', 2.20, 'angle bracket,fixing bracket'],
  ['Truss Clip / Framing Anchor', 'Fixings', 'each', 1.40, 'truss clip,framing anchor,connector'],

  // ── Adhesives & sealants ──────────────────────────────────────────────────
  ['Clear Silicone Sealant 300ml', 'Adhesives & Sealants', 'tube', 4.00, 'silicone,sealant,clear silicone'],
  ['White Frame Sealant 300ml', 'Adhesives & Sealants', 'tube', 4.00, 'frame sealant,white silicone'],
  ['Grab Adhesive 290ml', 'Adhesives & Sealants', 'tube', 5.00, 'grab adhesive,no more nails,sticks like'],
  ['Expanding Foam 750ml', 'Adhesives & Sealants', 'can', 6.00, 'expanding foam,gap fill,pu foam'],
  ['PVA Wood Adhesive 1L', 'Adhesives & Sealants', 'bottle', 6.00, 'pva,wood glue,adhesive'],
  ['Rapid Set Tile Adhesive 20kg', 'Adhesives & Sealants', 'bag', 16.00, 'tile adhesive,rapid set,floor tile adhesive'],
  ['Tile Grout 5kg', 'Adhesives & Sealants', 'bag', 9.00, 'grout,tile grout,wall grout'],
  ['Bitumen Roof Sealant 5L', 'Adhesives & Sealants', 'tub', 16.00, 'bitumen,roof sealant,flashing compound'],
  ['Decorators Caulk 300ml', 'Adhesives & Sealants', 'tube', 2.20, 'caulk,decorators caulk,painters caulk'],
  ['Contact Adhesive 500ml', 'Adhesives & Sealants', 'tin', 9.00, 'contact adhesive,evostik'],

  // ── Paint & decorating ────────────────────────────────────────────────────
  ['White Matt Emulsion 10L', 'Paint & Decorating', 'tub', 22.00, 'emulsion,white paint,matt,wall paint'],
  ['Magnolia Matt Emulsion 10L', 'Paint & Decorating', 'tub', 22.00, 'emulsion,magnolia,matt'],
  ['White Gloss Paint 2.5L', 'Paint & Decorating', 'tin', 18.00, 'gloss,white gloss,trim paint'],
  ['White Undercoat 2.5L', 'Paint & Decorating', 'tin', 16.00, 'undercoat,primer undercoat'],
  ['Masonry Paint 10L', 'Paint & Decorating', 'tub', 32.00, 'masonry paint,exterior paint,smooth masonry'],
  ['Wood Primer 2.5L', 'Paint & Decorating', 'tin', 17.00, 'wood primer,primer'],
  ['Shed & Fence Paint 5L', 'Paint & Decorating', 'tub', 16.00, 'fence paint,shed paint,timbercare'],
  ['Wood Preserver 5L', 'Paint & Decorating', 'tub', 22.00, 'wood preserver,timber treatment'],
  ['Roller & Tray Set', 'Paint & Decorating', 'each', 6.00, 'roller,paint roller,tray'],
  ['Paint Brush Set (5 piece)', 'Paint & Decorating', 'set', 8.00, 'brushes,paint brush set'],
  ['Cotton Dust Sheet 12x9ft', 'Paint & Decorating', 'each', 7.00, 'dust sheet,cotton twill'],
  ['Masking Tape 50m', 'Paint & Decorating', 'roll', 2.50, 'masking tape,painters tape'],
  ['Multi-purpose Filler 1.5kg', 'Paint & Decorating', 'tub', 6.00, 'filler,polyfilla,wall filler'],
  ['White Spirit 2L', 'Paint & Decorating', 'bottle', 6.00, 'white spirit,brush cleaner,thinner'],

  // ── Plumbing ──────────────────────────────────────────────────────────────
  ['Copper Pipe 15mm 3m', 'Plumbing', 'each', 9.00, 'copper pipe,15mm,plumbing pipe'],
  ['Copper Pipe 22mm 3m', 'Plumbing', 'each', 14.00, 'copper pipe,22mm'],
  ['Push-Fit Barrier Pipe 15mm 3m', 'Plumbing', 'each', 6.00, 'push fit,speedfit,hep2o,15mm pipe'],
  ['Push-Fit Elbow 15mm', 'Plumbing', 'each', 1.50, 'push fit elbow,speedfit elbow,15mm'],
  ['Push-Fit Tee 22mm', 'Plumbing', 'each', 2.50, 'push fit tee,speedfit,22mm'],
  ['Compression Elbow 15mm', 'Plumbing', 'each', 1.80, 'compression fitting,elbow,15mm'],
  ['PTFE Tape 12m', 'Plumbing', 'roll', 0.70, 'ptfe,thread tape,plumbers tape'],
  ['Flexible Tap Connector 15mm', 'Plumbing', 'each', 3.00, 'flexi connector,tap connector'],
  ['Waste Pipe 40mm 3m', 'Plumbing', 'each', 5.00, 'waste pipe,40mm,push fit waste'],
  ['Single Panel Radiator 600x1000mm', 'Plumbing', 'each', 38.00, 'radiator,single panel,central heating'],
  ['Quarter-Turn Ball Valve 1/2"', 'Plumbing', 'each', 6.00, 'ball valve,lever valve'],
  ['Stop Tap 15mm', 'Plumbing', 'each', 7.00, 'stop tap,stopcock,15mm'],
  ['Isolating Valve 15mm', 'Plumbing', 'each', 2.00, 'isolating valve,service valve,15mm'],

  // ── Electrical ────────────────────────────────────────────────────────────
  ['Twin & Earth Cable 2.5mm² 100m', 'Electrical', 'roll', 60.00, 'twin and earth,t&e,2.5mm,ring main cable'],
  ['Twin & Earth Cable 1.5mm² 100m', 'Electrical', 'roll', 42.00, 'twin and earth,t&e,1.5mm,lighting cable'],
  ['3 Core & Earth 1.5mm² 100m', 'Electrical', 'roll', 70.00, '3 core and earth,two way lighting'],
  ['Double Socket 13A', 'Electrical', 'each', 3.50, 'socket,double socket,13a,plug socket'],
  ['1 Gang Light Switch', 'Electrical', 'each', 3.00, 'light switch,1 gang,switch'],
  ['Metal Back Box 35mm', 'Electrical', 'each', 0.80, 'back box,knockout box,35mm'],
  ['10 Way Consumer Unit', 'Electrical', 'each', 55.00, 'consumer unit,fuse board,cu'],
  ['MCB 32A Type B', 'Electrical', 'each', 5.00, 'mcb,circuit breaker,32a'],
  ['Fire Rated LED Downlight', 'Electrical', 'each', 6.00, 'downlight,led,fire rated,spotlight'],
  ['Cable Clips 20mm (100 pack)', 'Electrical', 'pack', 3.00, 'cable clips,20mm'],
  ['Oval Conduit 16mm 2m', 'Electrical', 'each', 1.20, 'conduit,oval conduit,16mm'],
  ['30A Junction Box', 'Electrical', 'each', 1.50, 'junction box,30a'],

  // ── Doors, windows & ironmongery ──────────────────────────────────────────
  ['Primed Internal Door 762mm', 'Doors & Joinery', 'each', 35.00, 'internal door,primed door,30 inch door'],
  ['Oak Veneer Internal Door 762mm', 'Doors & Joinery', 'each', 70.00, 'oak door,veneer door,internal door'],
  ['FD30 Fire Door 762mm', 'Doors & Joinery', 'each', 75.00, 'fire door,fd30,30 minute door'],
  ['Hardwood External Door', 'Doors & Joinery', 'each', 180.00, 'external door,front door,hardwood door'],
  ['Door Lining Set', 'Doors & Joinery', 'each', 22.00, 'door lining,door frame,casing'],
  ['Lever Door Handle Pair', 'Doors & Joinery', 'set', 12.00, 'door handle,lever handle,door furniture'],
  ['Mortice Sashlock', 'Doors & Joinery', 'each', 14.00, 'mortice lock,sashlock,door lock'],
  ['Butt Hinges 100mm (pair)', 'Doors & Joinery', 'pair', 4.00, 'hinges,butt hinge,door hinge'],
  ['Softwood Architrave 2.1m', 'Doors & Joinery', 'length', 4.00, 'architrave,door trim'],
  ['MDF Skirting Board 119mm 4.4m', 'Doors & Joinery', 'length', 9.00, 'skirting,skirting board,mdf skirting'],
  ['Pine Torus Skirting 2.4m', 'Doors & Joinery', 'length', 7.00, 'skirting,pine skirting,torus'],

  // ── Tiling & flooring ─────────────────────────────────────────────────────
  ['Ceramic Wall Tile 200x250mm', 'Tiling & Flooring', 'm2', 12.00, 'wall tile,ceramic tile,bathroom tile'],
  ['Porcelain Floor Tile 600x600mm', 'Tiling & Flooring', 'm2', 22.00, 'floor tile,porcelain tile,600x600'],
  ['Tile Spacers 3mm (250 pack)', 'Tiling & Flooring', 'pack', 2.00, 'tile spacers,3mm'],
  ['Tile Trim 8mm 2.5m', 'Tiling & Flooring', 'each', 4.00, 'tile trim,edge trim'],
  ['Laminate Flooring 8mm', 'Tiling & Flooring', 'm2', 12.00, 'laminate,laminate flooring,8mm'],
  ['LVT Flooring', 'Tiling & Flooring', 'm2', 26.00, 'lvt,luxury vinyl tile,vinyl plank'],
  ['Foam Underlay 5mm', 'Tiling & Flooring', 'm2', 3.00, 'underlay,foam underlay,laminate underlay'],
  ['Floor Levelling Compound 20kg', 'Tiling & Flooring', 'bag', 13.00, 'levelling compound,self levelling,screed'],
  ['Carpet Gripper Rod 0.9m', 'Tiling & Flooring', 'each', 0.60, 'carpet gripper,gripper rod'],

  // ── Landscaping & external ────────────────────────────────────────────────
  ['Concrete Paving Slab 600x600mm', 'Landscaping', 'each', 7.00, 'paving slab,patio slab,600x600'],
  ['Block Paving Brindle', 'Landscaping', 'm2', 22.00, 'block paving,driveway block,brindle'],
  ['Decorative Gravel 20kg', 'Landscaping', 'bag', 5.00, 'decorative gravel,chippings,cotswold'],
  ['Weed Control Membrane 1x14m', 'Landscaping', 'roll', 9.00, 'weed membrane,weed fabric,ground cover'],
  ['Turf Roll', 'Landscaping', 'm2', 4.00, 'turf,lawn turf,grass'],
  ['Topsoil 25kg', 'Landscaping', 'bag', 4.00, 'topsoil,soil,garden soil'],
  ['Concrete Edging 600mm', 'Landscaping', 'each', 3.00, 'edging,path edging,lawn edge'],
  ['Concrete Kerb Stone', 'Landscaping', 'each', 6.00, 'kerb,kerb stone,edging kerb'],

  // ── Site consumables & PPE ────────────────────────────────────────────────
  ['Heavy Duty Rubble Sacks (10 pack)', 'Site & PPE', 'pack', 4.00, 'rubble sacks,builders bags,waste sacks'],
  ['Builders Bucket 14L', 'Site & PPE', 'each', 3.00, 'bucket,builders bucket,gorilla bucket'],
  ['Tarpaulin 6x4m', 'Site & PPE', 'each', 9.00, 'tarpaulin,tarp,cover sheet'],
  ['Cable Ties 200mm (100 pack)', 'Site & PPE', 'pack', 3.00, 'cable ties,zip ties'],
  ['Builders Gloves (pair)', 'Site & PPE', 'pair', 3.00, 'gloves,work gloves,builders gloves'],
  ['Safety Glasses', 'Site & PPE', 'each', 3.00, 'safety glasses,eye protection'],
  ['FFP2 Dust Masks (10 pack)', 'Site & PPE', 'pack', 8.00, 'dust mask,ffp2,respirator'],
  ['Knee Pads (pair)', 'Site & PPE', 'pair', 9.00, 'knee pads,knee protection'],
  ['Tape Measure 8m', 'Site & PPE', 'each', 7.00, 'tape measure,8m,measuring tape'],
  ['Spirit Level 1200mm', 'Site & PPE', 'each', 18.00, 'spirit level,level,1200mm'],
  ['Hi-Vis Vest', 'Site & PPE', 'each', 5.00, 'hi vis,hi-vis vest,safety vest'],
  ['Hard Hat', 'Site & PPE', 'each', 7.00, 'hard hat,safety helmet'],

  // ── Timber & carcassing (extended) ────────────────────────────────────────
  ['Sawn Timber 47x125mm (5x2) C16 Treated', 'Timber', 'm', 11.50, '5x2,47x125,joist'],
  ['Sawn Timber 100x100mm (4x4) Post Treated', 'Timber', 'm', 9.00, '4x4,100x100,post,fence post'],
  ['Sawn Timber 75x75mm (3x3) Treated', 'Timber', 'm', 5.50, '3x3,75x75,post'],
  ['Sawn Timber 50x50mm (2x2) Treated', 'Timber', 'm', 2.10, '2x2,50x50,batten'],
  ['CLS Studwork Timber 38x140mm', 'Timber', 'm', 4.60, 'cls,studwork,38x140,6x2 cls'],
  ['Redwood PAR 25x75mm', 'Timber', 'm', 2.80, 'par,redwood,planed,25x75'],
  ['Redwood PAR 25x100mm', 'Timber', 'm', 3.60, 'par,redwood,planed,25x100'],
  ['Redwood PAR 25x150mm', 'Timber', 'm', 5.40, 'par,redwood,shelving,25x150'],
  ['Pine Quadrant Moulding 19mm 2.4m', 'Timber', 'length', 2.20, 'quadrant,moulding,beading'],
  ['Pine Scotia Moulding 19mm 2.4m', 'Timber', 'length', 2.20, 'scotia,moulding,beading'],
  ['Hardwood Dowel 18mm 2.4m', 'Timber', 'length', 3.00, 'dowel,rod'],
  ['Loglap Cladding 19x120mm', 'Timber', 'm2', 18.00, 'loglap,cladding,log lap'],
  ['Shiplap Cladding 19x125mm', 'Timber', 'm2', 16.00, 'shiplap,cladding'],
  ['Tongue & Groove Cladding 12x95mm', 'Timber', 'm2', 12.00, 'tongue and groove,tgv,cladding,matchboard'],
  ['Scaffold Board 38x225x3.9m', 'Timber', 'each', 12.00, 'scaffold board,staging board'],
  ['Newel Post Pine 90mm', 'Timber', 'each', 18.00, 'newel post,stair post'],
  ['Stair Spindle Pine 41mm', 'Timber', 'each', 3.50, 'spindle,baluster,stair'],
  ['Pine Handrail 2.4m', 'Timber', 'length', 12.00, 'handrail,stair rail'],
  ['Stair Tread & Riser Set', 'Timber', 'each', 22.00, 'stair tread,riser'],
  ['Trellis Panel 6x2ft', 'Timber', 'each', 14.00, 'trellis,garden trellis'],
  ['Decking Handrail 2.4m', 'Timber', 'length', 9.00, 'decking rail,handrail'],
  ['Concrete Fence Post Slotted 100x100x2.4m', 'Timber', 'each', 16.00, 'concrete post,fence post,slotted post'],

  // ── Sheet materials (extended) ────────────────────────────────────────────
  ['MDF Standard 12mm 2440x1220mm', 'Sheet Materials', 'sheet', 18.00, 'mdf,12mm'],
  ['MDF Standard 6mm 2440x1220mm', 'Sheet Materials', 'sheet', 12.00, 'mdf,6mm'],
  ['MDF Standard 25mm 2440x1220mm', 'Sheet Materials', 'sheet', 36.00, 'mdf,25mm'],
  ['Hardwood Plywood 12mm 2440x1220mm', 'Sheet Materials', 'sheet', 30.00, 'plywood,12mm'],
  ['Hardwood Plywood 6mm 2440x1220mm', 'Sheet Materials', 'sheet', 18.00, 'plywood,6mm'],
  ['Far Eastern Plywood 5.5mm 2440x1220mm', 'Sheet Materials', 'sheet', 14.00, 'plywood,5.5mm,lining ply'],
  ['OSB3 Board 15mm 2400x1200mm', 'Sheet Materials', 'sheet', 19.00, 'osb,15mm'],
  ['OSB3 Board 22mm 2400x1200mm', 'Sheet Materials', 'sheet', 27.00, 'osb,22mm,flooring osb'],
  ['Melamine Faced Chipboard White 18mm 2440x1220mm', 'Sheet Materials', 'sheet', 24.00, 'mfc,melamine,white board'],
  ['Fibre Cement Backer Board 12mm 1200x800mm', 'Sheet Materials', 'sheet', 16.00, 'hardiebacker,cement board,tile backer'],
  ['Cement Particle Board 18mm', 'Sheet Materials', 'sheet', 38.00, 'cement particle board,versapanel'],
  ['Plywood Shuttering 18mm 2440x1220mm', 'Sheet Materials', 'sheet', 28.00, 'shuttering ply,formwork,18mm'],

  // ── Plasterboard & plaster (extended) ─────────────────────────────────────
  ['Thermal Laminate Insulated Plasterboard 50mm', 'Plasterboard', 'sheet', 32.00, 'thermal board,insulated plasterboard,thermal laminate,k118'],
  ['Foil Backed Plasterboard 12.5mm 2400x1200mm', 'Plasterboard', 'sheet', 12.00, 'foil backed,vapour board,plasterboard'],
  ['Metal Stud C-Stud 50mm 3.6m', 'Plasterboard', 'each', 5.50, 'metal stud,c stud,partition'],
  ['Metal Stud Track 50mm 3m', 'Plasterboard', 'each', 4.50, 'metal track,u track,partition'],
  ['Resilient Bar 3m', 'Plasterboard', 'each', 3.00, 'resilient bar,acoustic bar'],
  ['Plaster Coving 127mm 2m', 'Plaster', 'length', 5.00, 'coving,cornice,plaster coving'],
  ['Plasterboard Stop Bead 2.4m', 'Plaster', 'each', 1.60, 'stop bead,edge bead'],
  ['Plasterboard Arch Bead', 'Plaster', 'each', 3.50, 'arch bead,archway bead'],
  ['Easi-Fill 45 Jointing Filler 10kg', 'Plaster', 'bag', 12.00, 'easifill,jointing,filler'],

  // ── Insulation (extended) ─────────────────────────────────────────────────
  ['Celotex / PIR Insulation Board 40mm 2400x1200mm', 'Insulation', 'sheet', 18.00, 'pir,celotex,40mm'],
  ['Celotex / PIR Insulation Board 60mm 2400x1200mm', 'Insulation', 'sheet', 26.00, 'pir,celotex,60mm'],
  ['Celotex / PIR Insulation Board 120mm 2400x1200mm', 'Insulation', 'sheet', 46.00, 'pir,celotex,120mm'],
  ['EPS Polystyrene Sheet 50mm 2400x1200mm', 'Insulation', 'sheet', 12.00, 'eps,polystyrene,expanded'],
  ['XPS Extruded Polystyrene 50mm', 'Insulation', 'sheet', 20.00, 'xps,styrofoam,extruded'],
  ['Loft Insulation Roll 200mm 5.9m²', 'Insulation', 'roll', 24.00, 'loft roll,200mm,mineral wool'],
  ['Pipe Insulation Lagging 15mm x 1m', 'Insulation', 'each', 1.20, 'pipe lagging,pipe insulation,15mm'],
  ['Pipe Insulation Lagging 22mm x 1m', 'Insulation', 'each', 1.50, 'pipe lagging,22mm'],
  ['Foil Insulation Tape 50mm x 45m', 'Insulation', 'roll', 5.00, 'foil tape,insulation tape'],

  // ── Cement, aggregates & concrete (extended) ──────────────────────────────
  ['White Cement 25kg', 'Cement & Aggregates', 'bag', 12.00, 'white cement'],
  ['Hydrated Lime 25kg', 'Cement & Aggregates', 'bag', 8.00, 'lime,hydrated lime'],
  ['Mortar Waterproofer Additive 5L', 'Cement & Aggregates', 'bottle', 10.00, 'waterproofer,integral waterproofer'],
  ['Mortar Colour Dye Black 1kg', 'Cement & Aggregates', 'tub', 8.00, 'cement dye,mortar colour,pigment'],

  // ── Bricks, blocks & DPC (extended) ───────────────────────────────────────
  ['Trench Block 255mm', 'Bricks & Blocks', 'each', 3.20, 'trench block,foundation block'],
  ['Coping Stone 600mm', 'Bricks & Blocks', 'each', 12.00, 'coping,wall coping'],
  ['Concrete Lintel 100x65x1200mm', 'Bricks & Blocks', 'each', 11.00, 'lintel,concrete lintel,1200'],
  ['Concrete Padstone 215x140x100mm', 'Bricks & Blocks', 'each', 5.00, 'padstone'],
  ['Steel Box Lintel 1200mm', 'Bricks & Blocks', 'each', 38.00, 'catnic,steel lintel,box lintel,1200'],
  ['Steel Box Lintel 1800mm', 'Bricks & Blocks', 'each', 58.00, 'catnic,steel lintel,1800'],
  ['Steel Box Lintel 2400mm', 'Bricks & Blocks', 'each', 82.00, 'catnic,steel lintel,2400'],
  ['Terracotta Air Brick 215x65mm', 'Bricks & Blocks', 'each', 2.50, 'air brick,airbrick,vent brick'],
  ['Telescopic Underfloor Vent', 'Bricks & Blocks', 'each', 4.50, 'periscope vent,underfloor vent'],
  ['Damp Proof Course 100mm x 30m', 'Bricks & Blocks', 'roll', 9.00, 'dpc,damp proof course,100mm'],
  ['Damp Proof Course 225mm x 30m', 'Bricks & Blocks', 'roll', 18.00, 'dpc,225mm'],
  ['Damp Proof Membrane 1200g 4x25m', 'Bricks & Blocks', 'roll', 45.00, 'dpm,damp proof membrane,visqueen'],
  ['Cavity Closer 100mm 2.4m', 'Bricks & Blocks', 'each', 6.00, 'cavity closer'],
  ['Weep Vent', 'Bricks & Blocks', 'each', 0.40, 'weep vent,weep hole'],
  ['Bed Joint Reinforcement Mesh 3m', 'Bricks & Blocks', 'each', 3.50, 'brickforce,bed joint reinforcement'],
  ['Wall Starter Kit', 'Bricks & Blocks', 'each', 14.00, 'wall starter,profile'],
  ['Cavity Wall Ties (250 pack)', 'Fixings', 'box', 22.00, 'wall ties,cavity ties'],

  // ── Roofing (extended) ────────────────────────────────────────────────────
  ['Dry Verge Unit', 'Roofing', 'each', 4.00, 'dry verge,verge unit'],
  ['Dry Ridge Kit 6m', 'Roofing', 'kit', 55.00, 'dry ridge,ridge kit'],
  ['Roof Vent Tile', 'Roofing', 'each', 16.00, 'vent tile,roof vent'],
  ['Eaves Felt Support Tray 1.5m', 'Roofing', 'each', 5.00, 'eaves tray,felt support'],
  ['Plastic Valley Trough 3m', 'Roofing', 'each', 24.00, 'valley,valley trough'],
  ['EPDM Rubber Roofing (m2)', 'Roofing', 'm2', 12.00, 'epdm,rubber roof,firestone'],
  ['GRP Fibreglass Roof Topcoat 10kg', 'Roofing', 'tub', 60.00, 'grp,fibreglass,topcoat'],
  ['Polycarbonate Roof Sheet 10mm 2.5m', 'Roofing', 'sheet', 26.00, 'polycarbonate,roof sheet'],
  ['Corrugated Bitumen Sheet (Onduline)', 'Roofing', 'sheet', 16.00, 'onduline,corrugated bitumen,coroline'],
  ['Box Profile Steel Roof Sheet 3m', 'Roofing', 'sheet', 28.00, 'box profile,steel roof sheet,tin roof'],
  ['Clear Corrugated PVC Sheet 1.8m', 'Roofing', 'sheet', 12.00, 'corrugated pvc,clear roof sheet'],
  ['Gutter Union Bracket', 'Roofing', 'each', 2.00, 'gutter union,gutter bracket'],
  ['Gutter Running Outlet', 'Roofing', 'each', 3.00, 'running outlet,gutter outlet'],
  ['Gutter Stop End', 'Roofing', 'each', 1.50, 'stop end'],
  ['Gutter Angle 90°', 'Roofing', 'each', 3.50, 'gutter angle,corner'],
  ['Downpipe Clip 68mm', 'Roofing', 'each', 1.20, 'downpipe clip,pipe clip'],
  ['Downpipe Shoe 68mm', 'Roofing', 'each', 2.50, 'downpipe shoe'],
  ['Galvanised Roofing Nails 1kg', 'Fixings', 'box', 5.00, 'roofing nails,clout'],

  // ── Drainage (extended) ───────────────────────────────────────────────────
  ['Bottle Gully 110mm', 'Drainage', 'each', 14.00, 'bottle gully,yard gully'],
  ['Back Inlet Gully 110mm', 'Drainage', 'each', 16.00, 'back inlet gully'],
  ['Rodding Eye 110mm', 'Drainage', 'each', 9.00, 'rodding eye,access point'],
  ['Drainage Coupler 110mm', 'Drainage', 'each', 3.50, 'coupler,drain coupling'],
  ['Drainage Reducer 110-68mm', 'Drainage', 'each', 4.00, 'reducer'],
  ['Air Admittance Valve 110mm', 'Drainage', 'each', 12.00, 'aav,durgo,air admittance'],
  ['Underground Drainage Pipe 160mm 3m', 'Drainage', 'each', 22.00, '160mm pipe,drainage'],
  ['Soakaway Crate', 'Drainage', 'each', 32.00, 'soakaway,attenuation crate'],
  ['Drain Rods Set 10pc', 'Site & PPE', 'set', 18.00, 'drain rods,rodding set'],

  // ── Plumbing (extended) ───────────────────────────────────────────────────
  ['Copper Pipe 10mm 3m', 'Plumbing', 'each', 6.00, 'copper pipe,10mm,microbore'],
  ['Copper Pipe 28mm 3m', 'Plumbing', 'each', 20.00, 'copper pipe,28mm'],
  ['Push-Fit Barrier Pipe 22mm 3m', 'Plumbing', 'each', 8.00, 'push fit,22mm,speedfit'],
  ['Push-Fit Barrier Pipe 28mm 3m', 'Plumbing', 'each', 11.00, 'push fit,28mm'],
  ['Compression Coupler 22mm', 'Plumbing', 'each', 2.20, 'compression,coupler,22mm'],
  ['Compression Tee 22mm', 'Plumbing', 'each', 3.00, 'compression tee,22mm'],
  ['Speedfit Stem Elbow 15mm', 'Plumbing', 'each', 1.80, 'speedfit,stem elbow'],
  ['Underfloor Heating Pipe 16mm 100m', 'Plumbing', 'roll', 55.00, 'ufh,underfloor heating pipe,16mm'],
  ['Pipe Clips 15mm (pack)', 'Plumbing', 'pack', 3.00, 'pipe clip,15mm'],
  ['Lead-Free Solder 250g', 'Plumbing', 'each', 9.00, 'solder,plumbing solder'],
  ['Soldering Flux Paste 100g', 'Plumbing', 'each', 4.00, 'flux,soldering flux'],
  ['Bottle Trap 40mm', 'Plumbing', 'each', 4.00, 'bottle trap,basin trap'],
  ['P-Trap 40mm', 'Plumbing', 'each', 3.50, 'p trap,waste trap'],
  ['Sink Waste Kit', 'Plumbing', 'each', 9.00, 'sink waste,plug and waste'],
  ['Basin Mixer Tap', 'Plumbing', 'each', 38.00, 'basin tap,mixer tap'],
  ['Kitchen Mixer Tap', 'Plumbing', 'each', 55.00, 'kitchen tap,mixer'],
  ['Close Coupled WC Pan & Cistern', 'Plumbing', 'each', 95.00, 'toilet,wc,close coupled,pan,cistern'],
  ['Ceramic Wash Basin 500mm', 'Plumbing', 'each', 45.00, 'basin,wash basin,sink'],
  ['Toilet Seat', 'Plumbing', 'each', 16.00, 'toilet seat'],
  ['Thermostatic Radiator Valve (TRV)', 'Plumbing', 'each', 12.00, 'trv,radiator valve,thermostatic'],
  ['Radiator Valve Pair', 'Plumbing', 'pair', 9.00, 'radiator valve,lockshield'],
  ['Chrome Towel Radiator 500x800mm', 'Plumbing', 'each', 45.00, 'towel rail,heated towel rail'],
  ['Solvent Weld Cement 250ml', 'Plumbing', 'each', 6.00, 'solvent weld,pipe cement'],
  ['Overflow Pipe 21.5mm 3m', 'Plumbing', 'each', 3.00, 'overflow pipe,21.5mm'],
  ['Float Valve 1/2"', 'Plumbing', 'each', 7.00, 'float valve,ballcock'],

  // ── Electrical (extended) ─────────────────────────────────────────────────
  ['Twin & Earth Cable 6mm² 50m', 'Electrical', 'roll', 55.00, '6mm,cooker cable,t&e'],
  ['Twin & Earth Cable 10mm² 50m', 'Electrical', 'roll', 85.00, '10mm,shower cable'],
  ['Twin & Earth Cable 1.0mm² 100m', 'Electrical', 'roll', 32.00, '1mm,lighting cable'],
  ['SWA Armoured Cable 2.5mm² 3-Core (per m)', 'Electrical', 'm', 2.20, 'swa,armoured cable,2.5mm'],
  ['3-Core Flex 0.75mm² 100m', 'Electrical', 'roll', 30.00, 'flex,3 core flex'],
  ['Single Socket 13A', 'Electrical', 'each', 2.80, 'single socket,13a'],
  ['USB Double Socket 13A', 'Electrical', 'each', 12.00, 'usb socket,double socket usb'],
  ['Cooker Control Unit 45A', 'Electrical', 'each', 9.00, 'cooker switch,45a,control unit'],
  ['Fused Connection Unit (Spur)', 'Electrical', 'each', 4.00, 'fused spur,fcu,switched spur'],
  ['2 Gang Light Switch', 'Electrical', 'each', 4.00, '2 gang switch,double switch'],
  ['1 Gang Dimmer Switch', 'Electrical', 'each', 9.00, 'dimmer,dimmer switch'],
  ['Ceiling Rose', 'Electrical', 'each', 1.50, 'ceiling rose'],
  ['Pendant Lampholder Set', 'Electrical', 'each', 2.50, 'pendant,lampholder'],
  ['RCBO 32A', 'Electrical', 'each', 12.00, 'rcbo,breaker'],
  ['100A Main Switch RCD', 'Electrical', 'each', 22.00, 'rcd,main switch'],
  ['PIR Motion Sensor', 'Electrical', 'each', 9.00, 'pir,motion sensor'],
  ['LED Floodlight 30W', 'Electrical', 'each', 16.00, 'floodlight,led flood'],
  ['Extractor Fan 100mm', 'Electrical', 'each', 14.00, 'extractor fan,bathroom fan'],
  ['Mains Smoke Alarm', 'Electrical', 'each', 18.00, 'smoke alarm,smoke detector'],
  ['Carbon Monoxide Alarm', 'Electrical', 'each', 16.00, 'co alarm,carbon monoxide'],
  ['Mini Trunking 16x16mm 3m', 'Electrical', 'each', 2.50, 'trunking,mini trunking'],
  ['Round Conduit 20mm 3m', 'Electrical', 'each', 2.20, 'conduit,round conduit,20mm'],
  ['Earth Rod 1.2m', 'Electrical', 'each', 9.00, 'earth rod,earth spike'],
  ['Wago 221 Connectors (50 pack)', 'Electrical', 'pack', 16.00, 'wago,connectors,lever connector'],
  ['Surface Double Pattress Box', 'Electrical', 'each', 2.00, 'surface box,pattress'],

  // ── Doors, windows & ironmongery (extended) ───────────────────────────────
  ['6 Panel Internal Door 762mm', 'Doors & Joinery', 'each', 45.00, '6 panel door,internal door'],
  ['Glazed Internal Door 762mm', 'Doors & Joinery', 'each', 60.00, 'glazed door,internal door'],
  ['Internal Bifold Door Set', 'Doors & Joinery', 'each', 120.00, 'bifold,folding door'],
  ['Loft Hatch & Ladder Kit', 'Doors & Joinery', 'each', 55.00, 'loft ladder,loft hatch'],
  ['Overhead Door Closer', 'Doors & Joinery', 'each', 18.00, 'door closer,overhead closer'],
  ['Tower Bolt 150mm', 'Doors & Joinery', 'each', 4.00, 'tower bolt,barrel bolt'],
  ['Hasp & Staple 150mm', 'Doors & Joinery', 'each', 5.00, 'hasp and staple,padlock latch'],
  ['Chrome Letter Plate', 'Doors & Joinery', 'each', 9.00, 'letter plate,letterbox'],
  ['Intumescent Fire & Smoke Seal 2.1m', 'Doors & Joinery', 'each', 6.00, 'intumescent strip,fire seal'],
  ['Aluminium Threshold Strip 0.9m', 'Doors & Joinery', 'each', 5.00, 'threshold strip,door bar'],
  ['MDF Window Board 25x225mm 2.4m', 'Doors & Joinery', 'length', 12.00, 'window board,window sill,mdf'],
  ['Softwood Glazing Bead 2.4m', 'Doors & Joinery', 'length', 2.00, 'glazing bead'],
  ['Concealed Cabinet Hinge (pair)', 'Doors & Joinery', 'pair', 2.50, 'cabinet hinge,concealed hinge'],
  ['Cupboard Door Handle', 'Doors & Joinery', 'each', 2.00, 'cupboard handle,cabinet handle'],
  ['Door Draught Excluder Strip', 'Doors & Joinery', 'each', 5.00, 'draught excluder,draft strip'],

  // ── Tiling & flooring (extended) ──────────────────────────────────────────
  ['Mosaic Tile Sheet 300x300mm', 'Tiling & Flooring', 'each', 6.00, 'mosaic,mosaic tile'],
  ['Natural Stone Tile (m2)', 'Tiling & Flooring', 'm2', 35.00, 'stone tile,travertine,marble'],
  ['Tile Backer Board 6mm 1200x600mm', 'Tiling & Flooring', 'sheet', 9.00, 'tile backer,hardiebacker'],
  ['Uncoupling / Decoupling Membrane (m2)', 'Tiling & Flooring', 'm2', 8.00, 'decoupling,ditra,uncoupling'],
  ['Flexible White Tile Adhesive 20kg', 'Tiling & Flooring', 'bag', 18.00, 'tile adhesive,flexible adhesive,white'],
  ['Wide-Joint Tile Grout 10kg', 'Tiling & Flooring', 'bag', 14.00, 'grout,wide joint grout'],
  ['Engineered Oak Flooring (m2)', 'Tiling & Flooring', 'm2', 38.00, 'engineered wood,oak flooring'],
  ['Solid Oak Flooring (m2)', 'Tiling & Flooring', 'm2', 48.00, 'solid oak,oak floor'],
  ['Cushioned Vinyl Flooring (m2)', 'Tiling & Flooring', 'm2', 14.00, 'vinyl,cushion floor,lino'],
  ['Carpet (m2)', 'Tiling & Flooring', 'm2', 12.00, 'carpet'],
  ['Carpet Underlay 10mm (m2)', 'Tiling & Flooring', 'm2', 5.00, 'carpet underlay,underlay'],
  ['Aluminium Stair Nosing 0.9m', 'Tiling & Flooring', 'each', 8.00, 'stair nosing,edge'],
  ['Wood-to-Tile Threshold Trim 0.9m', 'Tiling & Flooring', 'each', 6.00, 'threshold,trim,door bar'],
  ['Laminate Scotia Beading 2.4m', 'Tiling & Flooring', 'length', 3.00, 'scotia,beading,laminate trim'],

  // ── Landscaping & external (extended) ─────────────────────────────────────
  ['Indian Sandstone Paving (m2)', 'Landscaping', 'm2', 26.00, 'indian sandstone,paving,patio'],
  ['Outdoor Porcelain Paving (m2)', 'Landscaping', 'm2', 38.00, 'porcelain paving,patio'],
  ['Patio Jointing Compound 20kg', 'Landscaping', 'tub', 32.00, 'jointing compound,geofix,pointing'],
  ['Kiln Dried Jointing Sand 20kg', 'Landscaping', 'bag', 8.00, 'kiln dried sand,jointing sand,block paving sand'],
  ['Artificial Grass (m2)', 'Landscaping', 'm2', 14.00, 'artificial grass,astro turf,fake grass'],
  ['Bark Mulch 60L', 'Landscaping', 'bag', 6.00, 'bark,mulch,play bark'],
  ['Slate Chippings 20kg', 'Landscaping', 'bag', 6.00, 'slate chippings,plum slate'],
  ['Cobble Setts (m2)', 'Landscaping', 'm2', 24.00, 'cobbles,setts'],
  ['Pond Liner (m2)', 'Landscaping', 'm2', 6.00, 'pond liner'],
  ['Fence Post Cap 100x100mm', 'Landscaping', 'each', 2.50, 'post cap,fence cap'],
  ['Gravel Grid Paver (m2)', 'Landscaping', 'm2', 14.00, 'gravel grid,grass grid'],

  // ── Adhesives & sealants (extended) ───────────────────────────────────────
  ['Fire Rated Intumescent Sealant 300ml', 'Adhesives & Sealants', 'tube', 6.00, 'fire sealant,intumescent,fire mastic'],
  ['Mould-Resistant Sanitary Silicone 300ml', 'Adhesives & Sealants', 'tube', 5.00, 'sanitary silicone,bathroom sealant'],
  ['Roof & Gutter Sealant 300ml', 'Adhesives & Sealants', 'tube', 5.00, 'roof sealant,gutter sealant'],
  ['Polyurethane Adhesive Sealant 290ml', 'Adhesives & Sealants', 'tube', 7.00, 'pu adhesive,ct1'],
  ['Super Glue 20g', 'Adhesives & Sealants', 'each', 3.00, 'super glue,cyanoacrylate'],
  ['2-Part Epoxy Resin', 'Adhesives & Sealants', 'each', 6.00, 'epoxy,araldite'],
  ['Spray Adhesive 500ml', 'Adhesives & Sealants', 'can', 8.00, 'spray adhesive,spray glue'],

  // ── Paint & decorating (extended) ─────────────────────────────────────────
  ['Trade White Matt Emulsion 15L', 'Paint & Decorating', 'tub', 30.00, 'trade emulsion,contract matt'],
  ['Anti-Mould Bathroom Paint 2.5L', 'Paint & Decorating', 'tin', 18.00, 'bathroom paint,anti mould'],
  ['Tile Paint 750ml', 'Paint & Decorating', 'tin', 14.00, 'tile paint'],
  ['Radiator Enamel Paint 750ml', 'Paint & Decorating', 'tin', 12.00, 'radiator paint'],
  ['Hammered Metal Paint 750ml', 'Paint & Decorating', 'tin', 14.00, 'hammerite,metal paint'],
  ['Stain Block Primer Spray 400ml', 'Paint & Decorating', 'can', 8.00, 'stain block,bullseye,primer spray'],
  ['PVA Bonding & Sealer 5L', 'Paint & Decorating', 'tub', 12.00, 'pva,bonding,sealer'],
  ['Wallpaper Paste', 'Paint & Decorating', 'each', 4.00, 'wallpaper paste'],
  ['Filler Knife / Scraper', 'Paint & Decorating', 'each', 4.00, 'filler knife,scraper'],
  ['Sanding Block', 'Paint & Decorating', 'each', 3.00, 'sanding block'],
  ['Abrasive Sandpaper Roll 5m', 'Paint & Decorating', 'roll', 5.00, 'sandpaper,abrasive roll'],

  // ── Tools, site & PPE (extended) ──────────────────────────────────────────
  ['Nitrile Disposable Gloves (100 box)', 'Site & PPE', 'box', 8.00, 'nitrile gloves,disposable gloves'],
  ['Ear Defenders', 'Site & PPE', 'each', 9.00, 'ear defenders,ear protection'],
  ['Disposable Ear Plugs (10 pair)', 'Site & PPE', 'pack', 3.00, 'ear plugs'],
  ['FFP3 Dust Masks (5 pack)', 'Site & PPE', 'pack', 12.00, 'ffp3,respirator,dust mask'],
  ['Disposable Coveralls', 'Site & PPE', 'each', 5.00, 'coveralls,overalls,paint suit'],
  ['Wheelbarrow 90L', 'Site & PPE', 'each', 38.00, 'wheelbarrow,barrow'],
  ['Digging Spade', 'Site & PPE', 'each', 16.00, 'spade,digging spade'],
  ['Digging Fork', 'Site & PPE', 'each', 16.00, 'fork,digging fork'],
  ['Square Mouth Shovel', 'Site & PPE', 'each', 15.00, 'shovel,square shovel'],
  ['Brick Trowel 11"', 'Site & PPE', 'each', 14.00, 'brick trowel,trowel'],
  ['Pointing Trowel', 'Site & PPE', 'each', 6.00, 'pointing trowel'],
  ['Stainless Plasterers Float', 'Site & PPE', 'each', 16.00, 'float,plasterers trowel,finishing trowel'],
  ['Plasterers Hawk', 'Site & PPE', 'each', 12.00, 'hawk,mortar board'],
  ['Bolster Chisel 4"', 'Site & PPE', 'each', 9.00, 'bolster,brick chisel'],
  ['Cold Chisel', 'Site & PPE', 'each', 6.00, 'cold chisel'],
  ['Wood Chisel Set 4pc', 'Site & PPE', 'set', 16.00, 'wood chisel,chisel set'],
  ['Claw Hammer 16oz', 'Site & PPE', 'each', 12.00, 'hammer,claw hammer'],
  ['Lump Hammer 4lb', 'Site & PPE', 'each', 12.00, 'lump hammer,club hammer'],
  ['Hand Saw 22"', 'Site & PPE', 'each', 9.00, 'hand saw,wood saw'],
  ['Tenon Saw', 'Site & PPE', 'each', 8.00, 'tenon saw'],
  ['Hacksaw', 'Site & PPE', 'each', 7.00, 'hacksaw'],
  ['Utility Knife + Blades', 'Site & PPE', 'each', 6.00, 'stanley knife,utility knife,trimming knife'],
  ['Knife Blades (10 pack)', 'Site & PPE', 'pack', 3.00, 'blades,stanley blades'],
  ['Carpenters Pencils (pack)', 'Site & PPE', 'pack', 2.00, 'pencil,carpenters pencil'],
  ['Chalk Line & Chalk', 'Site & PPE', 'each', 7.00, 'chalk line,chalk'],
  ['Try Square 200mm', 'Site & PPE', 'each', 6.00, 'try square,square'],
  ['Combination Square', 'Site & PPE', 'each', 9.00, 'combination square'],
  ['Spirit Level 600mm', 'Site & PPE', 'each', 12.00, 'spirit level,600mm,boat level'],
  ['Plumb Bob', 'Site & PPE', 'each', 5.00, 'plumb bob,plumb line'],
  ['Mixing Paddle / Whisk', 'Site & PPE', 'each', 9.00, 'mixing paddle,whisk,stirrer'],
  ['HSS Drill Bit Set (19pc)', 'Site & PPE', 'set', 12.00, 'drill bits,hss'],
  ['Masonry Drill Bit Set', 'Site & PPE', 'set', 9.00, 'masonry bits,sds bits'],
  ['Sealant / Caulking Gun', 'Site & PPE', 'each', 6.00, 'sealant gun,caulking gun,skeleton gun'],
  ['Wrecking / Pry Bar 24"', 'Site & PPE', 'each', 12.00, 'pry bar,wrecking bar,crowbar'],
  ['Nail Bar / Cats Paw', 'Site & PPE', 'each', 7.00, 'nail bar,cats paw'],
  ['Yard Broom', 'Site & PPE', 'each', 8.00, 'yard broom,broom'],
  ['Stiff Hand Brush', 'Site & PPE', 'each', 3.00, 'hand brush'],
  ['Wire Brush', 'Site & PPE', 'each', 3.00, 'wire brush'],
  ['Gaffer / Duct Tape 50m', 'Site & PPE', 'roll', 5.00, 'gaffer tape,duct tape'],
  ['WD-40 400ml', 'Site & PPE', 'each', 5.00, 'wd40,lubricant'],
  ['Extension Lead 240V 10m', 'Site & PPE', 'each', 16.00, 'extension lead,extension reel'],
  ['Cable Reel 110V 25m', 'Site & PPE', 'each', 45.00, 'cable reel,110v lead'],
  ['Site Transformer 110V', 'Site & PPE', 'each', 55.00, 'transformer,110v transformer'],
  ['LED Work Light 20W', 'Site & PPE', 'each', 22.00, 'work light,site light'],
  ['Site First Aid Kit', 'Site & PPE', 'each', 16.00, 'first aid kit'],
];

// ── Generated dimensional variants ──────────────────────────────────────────
// A merchant's SKU count is dominated by size / grade / length / colour
// variants of the same product. Rather than hand-list thousands, expand product
// families across their natural axes — compact to maintain, large in output.
function buildVariants() {
  const r2 = (n) => Math.round(n * 100) / 100;
  const out = [];
  const add = (name, category, unit, base, aliases) => out.push([name, category, unit, r2(base), aliases]);

  // Sawn carcassing timber: section × grade × treatment × length
  const tSec = [['47x50', 2.6], ['47x75', 3.6], ['47x100', 4.8], ['47x125', 6.1], ['47x150', 7.3], ['47x175', 8.9], ['47x200', 10.5], ['47x225', 12.3]];
  for (const [sec, perm] of tSec)
    for (const [g, gf] of [['C16', 1.0], ['C24', 1.18]])
      for (const [tr, tf] of [['Treated', 1.08], ['Untreated', 1.0]])
        for (const L of [2.4, 3.0, 3.6, 4.2, 4.8, 6.0])
          add(`Sawn Timber ${sec}mm ${g} ${tr} ${L}m`, 'Timber', 'each', perm * gf * tf * L, `${sec},carcassing,timber,${g.toLowerCase()},${tr.toLowerCase()},${L}m`);

  // CLS studwork
  for (const [sec, perm] of [['38x63', 1.9], ['38x89', 2.6], ['38x140', 4.0]])
    for (const L of [2.4, 3.0, 3.6, 4.2])
      add(`CLS Studwork ${sec}mm ${L}m`, 'Timber', 'each', perm * L, `cls,studwork,${sec},${L}m`);

  // Planed redwood (PAR)
  for (const [sec, perm] of [['25x50', 1.0], ['25x75', 1.5], ['25x100', 2.0], ['25x150', 3.0], ['25x175', 3.5]])
    for (const L of [2.4, 3.0, 3.6])
      add(`Redwood PAR ${sec}mm ${L}m`, 'Timber', 'each', perm * L, `par,planed,redwood,${sec},${L}m`);

  // Treated battens
  for (const [sec, perm] of [['25x38', 0.7], ['25x50', 0.9], ['50x50', 1.6]])
    for (const L of [3.0, 3.6, 4.2, 4.8])
      add(`Treated Batten ${sec}mm ${L}m`, 'Timber', 'each', perm * L, `batten,roof batten,${sec},${L}m`);

  // Sheet materials: type × thickness
  const sheets = [
    ['OSB3', { 9: 13.5, 11: 16, 15: 19, 18: 22, 22: 27 }, 'osb,osb3,sterling board'],
    ['MDF', { 6: 12, 9: 15, 12: 18, 18: 26, 25: 36 }, 'mdf'],
    ['Moisture Resistant MDF', { 6: 15, 12: 22, 18: 33 }, 'mdf mr,green mdf'],
    ['Hardwood Plywood', { 6: 18, 9: 24, 12: 30, 18: 42, 25: 60 }, 'plywood,ply,hardwood'],
    ['WBP Plywood', { 9: 22, 12: 30, 18: 40 }, 'plywood,wbp'],
    ['Marine Plywood', { 12: 42, 18: 60 }, 'marine ply,plywood'],
    ['Birch Plywood', { 12: 34, 18: 48, 25: 66 }, 'birch ply,plywood'],
    ['Chipboard Flooring T&G', { 18: 11, 22: 14 }, 'chipboard,flooring,p5'],
  ];
  for (const [type, th, al] of sheets)
    for (const t of Object.keys(th))
      add(`${type} ${t}mm 2440x1220mm`, 'Sheet Materials', 'sheet', th[t], `${al},${t}mm,sheet`);

  // Plasterboard: type × thickness × size
  for (const [tp, tf, tal] of [['Standard', 1.0, 'plasterboard,wallboard'], ['Moisture Resistant', 1.45, 'mr board,green board'], ['Fireline', 1.35, 'fireline,fire board'], ['Soundbloc', 1.7, 'soundbloc,acoustic board']])
    for (const [th, hf] of [['9.5mm', 0.85], ['12.5mm', 1.0], ['15mm', 1.2]])
      for (const [sz, sf] of [['2400x1200mm', 1.0], ['1800x900mm', 0.6]])
        add(`${tp} Plasterboard ${th} ${sz}`, 'Plasterboard', 'sheet', 9.5 * tf * hf * sf, `${tal},plasterboard,${th}`);

  // PIR insulation thicknesses
  for (const t of [25, 30, 40, 50, 60, 70, 75, 80, 90, 100, 120, 150])
    add(`PIR Insulation Board ${t}mm 2400x1200mm`, 'Insulation', 'sheet', 6 + t * 0.32, `pir,celotex,kingspan,insulation,${t}mm`);
  for (const t of [100, 150, 170, 200])
    add(`Loft Insulation Roll ${t}mm`, 'Insulation', 'roll', 16 + t * 0.04, `loft roll,mineral wool,${t}mm`);
  for (const t of [85, 100, 125, 150])
    add(`Cavity Wall Batt ${t}mm`, 'Insulation', 'pack', 18 + t * 0.08, `cavity batt,dritherm,rockwool,${t}mm`);
  for (const d of ['15mm', '22mm', '28mm'])
    for (const L of ['1m', '2m'])
      add(`Pipe Insulation Lagging ${d} x ${L}`, 'Insulation', 'each', 1.0 + parseInt(d) * 0.03, `pipe lagging,insulation,${d}`);

  // Copper & push-fit pipe: diameter × length
  for (const [d, perm] of [['8mm', 2.0], ['10mm', 2.2], ['15mm', 3.0], ['22mm', 4.6], ['28mm', 6.7], ['35mm', 9.5]])
    for (const L of [2, 3])
      add(`Copper Pipe ${d} ${L}m`, 'Plumbing', 'each', perm * L, `copper pipe,${d},${L}m`);
  for (const d of ['10mm', '15mm', '22mm', '28mm'])
    for (const L of [2, 3])
      add(`Push-Fit Barrier Pipe ${d} ${L}m`, 'Plumbing', 'each', (2 + parseInt(d) * 0.18) * L / 2, `push fit,speedfit,${d},${L}m`);

  // Plumbing fittings: system × type × diameter
  for (const [sys, sal] of [['Compression', 'compression'], ['Push-Fit', 'push fit,speedfit']])
    for (const [tp, tb] of [['Elbow', 1.5], ['Equal Tee', 2.0], ['Straight Coupler', 1.3], ['Stop End', 1.1], ['Reducer', 1.6]])
      for (const [d, df] of [['15mm', 1.0], ['22mm', 1.5], ['28mm', 2.1]])
        add(`${sys} ${tp} ${d}`, 'Plumbing', 'each', tb * df, `${sys.toLowerCase()},${tp.toLowerCase()},${d},${sal}`);

  // Cable: T&E size × length, plus SWA
  for (const [s, perm] of [['1.0mm²', 0.32], ['1.5mm²', 0.42], ['2.5mm²', 0.6], ['4mm²', 0.95], ['6mm²', 1.3], ['10mm²', 2.1]])
    for (const L of [50, 100])
      add(`Twin & Earth Cable ${s} ${L}m`, 'Electrical', 'roll', perm * L, `twin and earth,t&e,${s},cable`);
  for (const [s, perm] of [['1.5mm²', 0.7], ['2.5mm²', 0.95], ['4mm²', 1.4], ['6mm²', 1.9]])
    add(`SWA Armoured Cable ${s} 3-Core (per m)`, 'Electrical', 'm', perm, `swa,armoured,${s}`);

  // Paint: finish × colour × tin size
  for (const [fin, ff, fal] of [['Matt Emulsion', 1.0, 'emulsion,matt'], ['Silk Emulsion', 1.06, 'emulsion,silk'], ['Gloss', 1.6, 'gloss'], ['Satinwood', 1.7, 'satinwood'], ['Eggshell', 1.65, 'eggshell'], ['Masonry Paint', 1.4, 'masonry,exterior']])
    for (const col of ['Brilliant White', 'Magnolia', 'Light Grey', 'Cream', 'Black', 'Sage Green', 'Navy', 'Anthracite'])
      for (const [sz, szf] of [['2.5L', 1.0], ['5L', 1.8], ['10L', 3.2]])
        add(`${col} ${fin} ${sz}`, 'Paint & Decorating', 'tin', 8 * ff * szf, `paint,${fal},${col.toLowerCase()},${sz}`);

  // Tiles
  for (const s of ['200x250mm', '250x400mm', '300x600mm', '100x100mm'])
    add(`Ceramic Wall Tile ${s} (m2)`, 'Tiling & Flooring', 'm2', 12, `wall tile,ceramic,${s}`);
  for (const s of ['300x300mm', '450x450mm', '600x600mm', '600x300mm', '800x800mm'])
    add(`Porcelain Floor Tile ${s} (m2)`, 'Tiling & Flooring', 'm2', 22, `floor tile,porcelain,${s}`);

  // Radiators: type × height × width
  for (const [tp, tf] of [['Single Panel', 1.0], ['Double Panel', 1.5], ['Double Panel Plus', 1.8]])
    for (const h of [300, 450, 600])
      for (const w of [400, 600, 800, 1000, 1200, 1400])
        add(`${tp} Radiator ${h}x${w}mm`, 'Plumbing', 'each', tf * (15 + h * 0.02 + w * 0.02), `radiator,${tp.toLowerCase()},central heating`);

  // Doors: type × width
  for (const [w, al] of [['610mm', '24 inch'], ['686mm', '27 inch'], ['762mm', '30 inch'], ['838mm', '33 inch']])
    for (const [tp, b] of [['Primed Internal', 35], ['White Moulded Internal', 30], ['Oak Veneer Internal', 70], ['FD30 Fire', 75], ['Pine Panel Internal', 55]])
      add(`${tp} Door ${w}`, 'Doors & Joinery', 'each', b * (0.85 + parseInt(w) / 900), `door,${tp.toLowerCase()},${al}`);

  // Skirting & architrave: profile × height × material
  const profiles = ['Torus', 'Ogee', 'Bullnose', 'Chamfered', 'Square Edge', 'Ovolo'];
  for (const pf of profiles)
    for (const [h, hf] of [['95mm', 1.0], ['119mm', 1.25], ['144mm', 1.5], ['169mm', 1.75]])
      for (const [mat, mf] of [['MDF', 1.0], ['Pine', 1.15]])
        add(`${mat} ${pf} Skirting ${h} 4.4m`, 'Doors & Joinery', 'length', 8 * hf * mf, `skirting,${pf.toLowerCase()},${mat.toLowerCase()},${h}`);
  for (const pf of profiles)
    for (const [mat, mf] of [['MDF', 1.0], ['Pine', 1.15]])
      add(`${mat} ${pf} Architrave 2.1m`, 'Doors & Joinery', 'length', 4 * mf, `architrave,${pf.toLowerCase()},${mat.toLowerCase()}`);

  // Screws: type × length
  for (const [nm, al, k] of [['Wood Screws', 'wood screws', 0.04], ['Decking Screws', 'decking screws', 0.06], ['Multipurpose Screws', 'multipurpose screws', 0.05]])
    for (const L of [16, 20, 25, 30, 40, 50, 60, 70, 80, 100])
      add(`${nm} 4.0x${L}mm (200 pack)`, 'Fixings', 'box', 4 + L * k, `${al},screws,4x${L}`);
  for (const [nm, L] of [['Round Wire Nails', '65mm'], ['Round Wire Nails', '100mm'], ['Oval Nails', '50mm'], ['Galvanised Clout Nails', '30mm'], ['Lost Head Nails', '50mm'], ['Masonry Nails', '50mm']])
    add(`${nm} ${L} 1kg`, 'Fixings', 'box', 4.5, `nails,${nm.toLowerCase()},${L}`);

  // Blocks
  for (const [tp, b, al] of [['Dense Concrete 7.3N', 1.6, 'concrete block,dense block'], ['Aircrete', 1.9, 'aircrete,aerated,thermalite,celcon']])
    for (const th of ['100mm', '140mm', '215mm'])
      add(`${tp} Block ${th}`, 'Bricks & Blocks', 'each', b * (parseInt(th) / 100), `${al},block,${th}`);

  return out;
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const k = row[0].toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

const CATALOGUE = dedupeRows(HAND_CATALOGUE.concat(buildVariants()));

// Supplier "find this product" search URLs — used as the Verify link for sample
// prices. Search endpoints resolve to a real results page (they don't 404 like a
// fabricated product path), so every item gets a working, honest link.
const SUPPLIER_SEARCH = {
  'Screwfix': 'https://www.screwfix.com/search?search=',
  'Toolstation': 'https://www.toolstation.com/search?q=',
  'Wickes': 'https://www.wickes.co.uk/search?text=',
  'B&Q': 'https://www.diy.com/search?term=',
  'Selco': 'https://www.selcobw.com/search?q=',
  'Jewson': 'https://www.jewson.co.uk/search?text=',
  'Travis Perkins': 'https://www.travisperkins.co.uk/search?q=',
  'MKM': 'https://www.mkmbs.co.uk/search?q=',
};
function searchUrl(supplierName, materialName) {
  const base = SUPPLIER_SEARCH[supplierName];
  return base ? base + encodeURIComponent(materialName) : null;
}

// Deterministic 0..1 from a string (FNV-1a) so generated prices/suppliers are
// stable run-to-run.
function rng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// Idempotently ensure the full catalogue exists. Adds only materials whose
// canonical_name is not already present; generates several supplier sample
// prices for each new material. Safe to call on every boot.
function ensureCatalogue(db) {
  const supId = {};
  for (const s of SUPPLIERS) {
    let row = db.prepare('SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?)').get(s.name);
    if (!row) {
      const id = uuidv4();
      db.prepare('INSERT INTO suppliers (id, name, region, account_type, website) VALUES (?, ?, ?, ?, ?)')
        .run(id, s.name, 'UK', s.account_type, s.website);
      row = { id };
    }
    supId[s.name] = row.id;
  }

  const findMat = db.prepare('SELECT id FROM materials WHERE LOWER(canonical_name) = LOWER(?)');
  const insMat = db.prepare(
    'INSERT INTO materials (id, canonical_name, category, default_unit, search_aliases, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insPrice = db.prepare(
    'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_at, captured_via, in_stock, stale, notes, created_by) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let added = 0, priced = 0;
  const txn = db.transaction(() => {
    for (const [name, category, unit, base, aliases] of CATALOGUE) {
      if (findMat.get(name)) continue; // already in the catalogue — leave it alone
      const mid = uuidv4();
      insMat.run(mid, name, category, unit, aliases || null, 'catalogue');
      added++;

      // Pick a stable subset of suppliers (>= 2) for this material.
      let chosen = SUPPLIERS.filter(s => rng(name + '|' + s.name) < 0.6);
      if (chosen.length < 2) chosen = SUPPLIERS.slice(0, 3);
      if (chosen.length > 5) chosen = chosen.slice(0, 5);

      for (const s of chosen) {
        const jitter = (rng(name + s.name + 'j') - 0.5) * 0.08; // ±4%
        const price = Math.round(base * s.factor * (1 + jitter) * 100) / 100;
        const ageR = rng(name + s.name + 'age');
        const days = ageR < 0.12 ? 35 + Math.floor(ageR * 60) : Math.floor(ageR * 25); // ~1 in 8 is stale
        const capturedAt = new Date(Date.now() - days * 86400000).toISOString();
        const stale = days > 30 ? 1 : 0;
        const inStock = rng(name + s.name + 'stk') < 0.92 ? 1 : 0;
        insPrice.run(uuidv4(), mid, supId[s.name], price, unit, searchUrl(s.name, name), capturedAt, 'estimate', inStock, stale,
          'Representative sample price — Verify opens a supplier search for this item', 'catalogue');
        priced++;
      }
    }
  });
  txn();
  if (added) console.log('[Materials] catalogue ensured: +' + added + ' materials, +' + priced + ' sample prices');
  return { added, priced };
}

// Backfill a working Verify link on sample rows that have none (the original 11
// seed rows + any catalogue rows predating links). Scoped to sample data only
// (created_by IN seed/catalogue) so real user/scrape entries are untouched.
// Idempotent: after the first run those rows already have a source_url.
function backfillSearchUrls(db) {
  try {
    const rows = db.prepare(
      "SELECT pe.id, s.name AS supplier, m.canonical_name AS material "
      + "FROM price_entries pe JOIN suppliers s ON s.id = pe.supplier_id JOIN materials m ON m.id = pe.material_id "
      + "WHERE (pe.source_url IS NULL OR pe.source_url = '') AND pe.created_by IN ('seed', 'catalogue')"
    ).all();
    if (rows.length === 0) return 0;
    const upd = db.prepare('UPDATE price_entries SET source_url = ? WHERE id = ?');
    const txn = db.transaction(() => {
      for (const r of rows) {
        const url = searchUrl(r.supplier, r.material);
        if (url) upd.run(url, r.id);
      }
    });
    txn();
    console.log('[Materials] backfilled ' + rows.length + ' Verify links on sample prices');
    return rows.length;
  } catch (err) {
    console.error('[Materials] backfillSearchUrls failed:', err.message);
    return 0;
  }
}

module.exports = { CATALOGUE, SUPPLIERS, ensureCatalogue, backfillSearchUrls };

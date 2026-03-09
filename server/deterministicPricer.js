/**
 * deterministicPricer.js
 * Pure arithmetic pricing engine — NO AI involved.
 * Same locked quantities + same rate library = identical output every run.
 */

const BASE_RATES = {
  // Substructure
  'excavation_strip_foundation':        { rate: 95,   unit: 'm³',  labour: 0.75, materials: 0.25, description: 'Excavate strip foundations, remove spoil to skip' },
  'concrete_strip_foundation':          { rate: 185,  unit: 'm³',  labour: 0.35, materials: 0.65, description: 'Concrete strip foundations C25/30 incl. A393 mesh' },
  'blockwork_below_dpc':                { rate: 68,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Blockwork below DPC 140mm dense concrete block' },
  'dpc_polythene':                      { rate: 5.5,  unit: 'm',   labour: 0.50, materials: 0.50, description: 'DPC 450mm polythene, two courses, lapped' },
  'hardcore_fill':                      { rate: 14,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Hardcore fill, compact & blind 200mm deep' },
  'concrete_slab_150mm':               { rate: 78,   unit: 'm²',  labour: 0.35, materials: 0.65, description: 'RC ground floor slab 150mm C25/30 A393 mesh on DPM' },
  'concrete_slab_100mm':               { rate: 50,   unit: 'm²',  labour: 0.35, materials: 0.65, description: 'RC ground floor slab 100mm C25/30 on DPM' },
  'pir_insulation_under_slab':         { rate: 28,   unit: 'm²',  labour: 0.15, materials: 0.85, description: 'PIR insulation 150mm under slab Kingspan TP10' },
  'dpm_1200g':                         { rate: 4.5,  unit: 'm²',  labour: 0.20, materials: 0.80, description: 'DPM 1200g polythene lapped & turned up at edges' },
  // Masonry & frame
  'brick_outer_leaf':                  { rate: 95,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Facing brick outer leaf 102mm frost-resistant to match house' },
  'cavity_insulation_eps':             { rate: 18,   unit: 'm²',  labour: 0.30, materials: 0.70, description: 'Cavity fully filled EPS insulation Superfill 34' },
  'blockwork_inner_leaf_100mm':        { rate: 42,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Inner leaf 100mm Aircrete block 1400kg/m³ incl. mortar' },
  'cavity_wall_ties_ss':               { rate: 0.85, unit: 'Nr',  labour: 0.60, materials: 0.40, description: 'Cavity wall ties 250mm stainless steel' },
  'timber_sole_plate':                 { rate: 22,   unit: 'm',   labour: 0.60, materials: 0.40, description: 'Timber sole plate 150x75mm treated SW' },
  'cavity_closers':                    { rate: 14,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Cavity closers insulated proprietary uPVC at openings' },
  'stud_wall_plasterboard_both_faces': { rate: 65,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Timber stud wall 150mm studs plasterboard both faces' },
  'steel_lintels_catnic':              { rate: 75,   unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Steel lintels Catnic supply & fix' },
  'steel_lintels_bespoke':             { rate: 1850, unit: 'Item',labour: 0.50, materials: 0.50, description: 'Steel lintels bespoke to engineer design supply & fix' },
  // Roof
  'roof_structure_cut_timber':         { rate: 55,   unit: 'm²',  labour: 0.65, materials: 0.35, description: 'Roof structure cut timber rafters at 400mm c/c' },
  'osb_sarking':                       { rate: 18,   unit: 'm²',  labour: 0.40, materials: 0.60, description: '18mm OSB/3 sarking board to rafters' },
  'breather_membrane':                 { rate: 4.5,  unit: 'm²',  labour: 0.30, materials: 0.70, description: 'Breather membrane Tyvek Supro lapped & taped' },
  'tile_battens':                      { rate: 9.5,  unit: 'm²',  labour: 0.55, materials: 0.45, description: '25x38mm counter battens and tile battens ventilated cavity' },
  'roof_tiles_interlocking':           { rate: 52,   unit: 'm²',  labour: 0.45, materials: 0.55, description: 'Interlocking roof tiles incl. ridge verge hip fittings' },
  'box_gutter_lead_lined':             { rate: 185,  unit: 'm',   labour: 0.55, materials: 0.45, description: 'Box gutter 100mm wide internal lead-lined to 1:60 fall' },
  'fascia_soffit_guttering':           { rate: 48,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Fascia, soffit, PVC gutter and downpipe all connections' },
  'lead_flashing_code4':               { rate: 95,   unit: 'm',   labour: 0.55, materials: 0.45, description: 'Lead flashing Code 4 at abutment lapped soaked & pointed' },
  'roof_insulation_mineral_wool':      { rate: 28,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Roof insulation 200mm mineral wool between & over rafters' },
  'velux_skylight_780x980':            { rate: 1650, unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Velux-type skylight 780x980mm double glazed incl. flashings' },
  // Cladding
  'timber_cladding_accoya':            { rate: 145,  unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Accoya/Siberian Larch vertical cladding factory pre-treated' },
  'ventilated_cavity_battens':         { rate: 9.5,  unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Ventilated cavity battens behind cladding' },
  'close_boarded_fence_1800':          { rate: 95,   unit: 'm',   labour: 0.55, materials: 0.45, description: '1.8m high close-boarded timber fence incl. posts rails gravel boards' },
  'external_decorations_stain':        { rate: 12,   unit: 'm²',  labour: 0.80, materials: 0.20, description: 'Microporous stain 2-coat system to all exposed timber' },
  // Windows & doors
  'bifold_door_aluminium':             { rate: 4400, unit: 'Nr',  labour: 0.30, materials: 0.70, description: 'Aluminium bi-fold door thermally broken double glazed incl. cill reveals ironmongery' },
  'composite_external_door':           { rate: 1850, unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Timber/aluminium composite external door incl. frame threshold ironmongery' },
  'composite_external_door_std':       { rate: 1450, unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Timber/aluminium composite external door standard incl. frame ironmongery' },
  'upvc_window_standard':              { rate: 450,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'UPVC window standard double glazed trickle vent opening light' },
  'window_obscure_small':              { rate: 680,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Window obscure double glazed UPVC/aluminium trickle vent' },
  'window_bespoke_narrow':             { rate: 850,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Narrow bespoke double glazed window trickle vent' },
  'motorised_rooflight':               { rate: 1200, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'UPVC motorised rooflight bespoke incl. surround' },
  'mastic_sealant_allowance':          { rate: 350,  unit: 'Item',labour: 0.70, materials: 0.30, description: 'Mastic sealant DPC over window/door heads cavity closers at reveals' },
  // Internal finishes
  'plasterboard_skim_walls':           { rate: 32,   unit: 'm²',  labour: 0.65, materials: 0.35, description: '15mm plasterboard & 3mm skim to walls taped & filled' },
  'metal_stud_partition':              { rate: 58,   unit: 'm²',  labour: 0.65, materials: 0.35, description: 'Metal stud 70mm partition plasterboard both faces skim' },
  'wedi_wetroom_board':                { rate: 48,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Wedi board wetroom boards to shower enclosure walls' },
  'plasterboard_ceilings':             { rate: 28,   unit: 'm²',  labour: 0.65, materials: 0.35, description: '12.5mm plasterboard ceilings taped filled & skimmed' },
  'screed_ufh_75mm':                   { rate: 85,   unit: 'm²',  labour: 0.55, materials: 0.45, description: '75mm screed with UFH on 30mm perimeter insulation strip' },
  'screed_sand_cement_75mm':           { rate: 42,   unit: 'm²',  labour: 0.60, materials: 0.40, description: '75mm sand:cement screed finished to receive floor finish' },
  'internal_door_painted_solid_core':  { rate: 420,  unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'Internal door 762x2040mm painted solid core incl. lining architrave ironmongery' },
  'skirting_mdf_95mm':                 { rate: 18,   unit: 'm',   labour: 0.65, materials: 0.35, description: 'Skirting boards 95mm MDF ogee profile incl. angles & fixings' },
  'internal_decorations':              { rate: 8.5,  unit: 'm²',  labour: 0.85, materials: 0.15, description: 'Internal decorations walls & ceilings 2 coats emulsion woodwork gloss' },
  // Floor finishes
  'lvt_flooring_karndean':             { rate: 42,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'LVT flooring Karndean or equal incl. adhesive & trim' },
  'floor_tile_600x600':                { rate: 65,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Floor tile 600x600mm slip-rated incl. adhesive & grout' },
  'vinyl_safety_floor':                { rate: 38,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Vinyl safety floor Polyflor or equal incl. adhesive & coved skirting' },
  'shower_tray_900x900':               { rate: 580,  unit: 'Nr',  labour: 0.60, materials: 0.40, description: 'Shower tray 900x900mm low-profile incl. waste trap & connections' },
  // Drainage & plumbing
  'svp_connection_110mm':              { rate: 850,  unit: 'Item',labour: 0.70, materials: 0.30, description: 'SVP connection 110mm UPVC incl. soil branch fittings access door roof termination' },
  'foul_drainage_connection':          { rate: 145,  unit: 'm',   labour: 0.65, materials: 0.35, description: 'Foul drainage connection to existing sewer incl. inspection chamber' },
  'rainwater_downpipe_relocation':     { rate: 380,  unit: 'Item',labour: 0.70, materials: 0.30, description: 'Rainwater downpipe relocation 68mm UPVC incl. offset/shoes' },
  'rwp_outlet_hopper':                 { rate: 320,  unit: 'Item',labour: 0.65, materials: 0.35, description: 'Box gutter RWP outlet 68mm hopper & downpipe to gully' },
  'first_fix_plumbing':                { rate: 1250, unit: 'Item',labour: 0.70, materials: 0.30, description: 'First fix plumbing hot & cold supply incl. isolation valves' },
  'second_fix_plumbing':               { rate: 650,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'Second fix plumbing shower basin WC utility connection' },
  'ufh_manifold_kitchen':              { rate: 1400, unit: 'Item',labour: 0.55, materials: 0.45, description: 'UFH manifold and pipe circuit connection to existing boiler' },
  // Electrical
  'consumer_unit_upgrade':             { rate: 680,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'Consumer unit upgrade / new circuit breakers RCBO protected' },
  'first_fix_electrical':              { rate: 1350, unit: 'Item',labour: 0.80, materials: 0.20, description: 'First fix wiring power & lighting circuits extract fans USB sockets' },
  'second_fix_electrical':             { rate: 850,  unit: 'Item',labour: 0.75, materials: 0.25, description: 'Second fix electrical sockets light switches pendant/downlights' },
  'extract_fans':                      { rate: 320,  unit: 'Nr',  labour: 0.65, materials: 0.35, description: 'Extract fans humidity sensor Vent Axia or equal' },
  'ev_charge_point_ducting':           { rate: 250,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'EV charge point ducting and draw wire' },
  'electrical_testing_certificate':    { rate: 350,  unit: 'Item',labour: 1.00, materials: 0.00, description: 'Testing inspection & NICEIC certificate' },
  // Structural steelwork & misc
  'custom_structural_steelwork':       { rate: 3500, unit: 'Item',labour: 0.50, materials: 0.50, description: 'Structural steelwork supply & fix UBs, SHS columns, base plates, bolts' },
  'structural_steelwork':              { rate: 3500, unit: 'Item',labour: 0.50, materials: 0.50, description: 'Structural steelwork supply & fix UBs, SHS columns, base plates, bolts' },
  'custom_velux_940x1178':             { rate: 1850, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Velux roof window 940x1178mm double glazed incl. flashings' },
  'custom_velux_balcony':              { rate: 3800, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Velux Cabrio balcony window system double glazed incl. flashings' },
  'custom_chipboard_first_floor':      { rate: 28,   unit: 'm²', labour: 0.45, materials: 0.55, description: '22mm moisture-resistant P5 chipboard flooring to joists' },
  'chipboard_flooring':                { rate: 28,   unit: 'm²', labour: 0.45, materials: 0.55, description: '22mm moisture-resistant P5 chipboard flooring to joists' },
  'custom_staircase':                  { rate: 3200, unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'Timber staircase softwood with newels, balusters, handrail, trimming' },
  'staircase':                         { rate: 3200, unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'Timber staircase softwood with newels, balusters, handrail, trimming' },
  'custom_garage_demolition':          { rate: 3500, unit: 'Item',labour: 0.80, materials: 0.20, description: 'Demolish existing garage structure, cart away debris, make good' },
  'garage_demolition':                 { rate: 3500, unit: 'Item',labour: 0.80, materials: 0.20, description: 'Demolish existing garage structure, cart away debris, make good' },
  'custom_external_render':            { rate: 55,   unit: 'm²', labour: 0.65, materials: 0.35, description: 'External render two-coat system on mesh carrier, smooth finish' },
  'external_render':                   { rate: 55,   unit: 'm²', labour: 0.65, materials: 0.35, description: 'External render two-coat system on mesh carrier, smooth finish' },
  'custom_air_source_heat_pump':       { rate: 9500, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Air source heat pump supply & install incl. controls & MCS certification' },
  'air_source_heat_pump':              { rate: 9500, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Air source heat pump supply & install incl. controls & MCS certification' },
  // ============================================
  // REFURBISHMENT / HERITAGE / RENOVATION RATES
  // ============================================
  // Strip-out & demolition
  'strip_out_general':                 { rate: 18,   unit: 'm²',  labour: 0.85, materials: 0.15, description: 'General strip out of existing finishes, fixtures and fittings' },
  'strip_out_kitchen':                 { rate: 450,  unit: 'Nr',  labour: 0.90, materials: 0.10, description: 'Strip out existing kitchen units, worktops, appliances and dispose' },
  'strip_out_bathroom':                { rate: 350,  unit: 'Nr',  labour: 0.90, materials: 0.10, description: 'Strip out existing bathroom suite, tiling and dispose' },
  'strip_out_heating':                 { rate: 750,  unit: 'Item',labour: 0.90, materials: 0.10, description: 'Strip out existing heating system incl. boiler, radiators, pipework' },
  'strip_out_electrics':               { rate: 450,  unit: 'Item',labour: 0.90, materials: 0.10, description: 'Strip out existing electrical installation and dispose' },
  'strip_out_flooring':                { rate: 8,    unit: 'm²',  labour: 0.90, materials: 0.10, description: 'Strip out existing floor finishes and dispose' },
  'strip_out_plaster':                 { rate: 12,   unit: 'm²',  labour: 0.90, materials: 0.10, description: 'Hack off existing plaster to walls, cart away' },
  'strip_out_ceiling':                 { rate: 10,   unit: 'm²',  labour: 0.90, materials: 0.10, description: 'Strip out existing ceiling, lath and plaster or plasterboard' },
  'soft_strip_room':                   { rate: 350,  unit: 'Nr',  labour: 0.90, materials: 0.10, description: 'Soft strip single room - remove fittings, fixtures, finishes' },
  // Heritage masonry & lime
  'lime_mortar_repointing':            { rate: 85,   unit: 'm²',  labour: 0.75, materials: 0.25, description: 'Rake out and repoint in NHL 3.5 lime mortar to match existing' },
  'lime_plaster_walls':                { rate: 48,   unit: 'm²',  labour: 0.65, materials: 0.35, description: 'Three-coat lime plaster to walls incl. scratch, float and set' },
  'lime_render_external':              { rate: 65,   unit: 'm²',  labour: 0.65, materials: 0.35, description: 'External lime render two-coat NHL 3.5 on mesh carrier' },
  'stone_repair_indent':               { rate: 125,  unit: 'Nr',  labour: 0.65, materials: 0.35, description: 'Cut out and replace damaged stone indent to match existing' },
  'stone_cleaning':                    { rate: 35,   unit: 'm²',  labour: 0.80, materials: 0.20, description: 'Stone cleaning DOFF/TORC system to remove soiling' },
  'brick_repair_stitch':               { rate: 95,   unit: 'm',   labour: 0.70, materials: 0.30, description: 'Crack stitching to masonry walls with helical bars and resin' },
  'wall_tie_replacement':              { rate: 22,   unit: 'Nr',  labour: 0.65, materials: 0.35, description: 'Remedial wall tie replacement stainless steel mechanical fix' },
  'dpc_injection':                     { rate: 45,   unit: 'm',   labour: 0.60, materials: 0.40, description: 'Injection DPC silicone-based with chemical injection' },
  // Heritage roofing
  'natural_slate_roofing':             { rate: 95,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Natural slate roofing Welsh/Spanish on battens incl. fittings' },
  'clay_tile_roofing':                 { rate: 78,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Clay plain tile roofing on battens incl. ridge, hip, valley' },
  'lead_sheet_roofing':                { rate: 175,  unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Lead sheet roofing Code 5 on boarding incl. rolls and drips' },
  'lead_flashing_code5':               { rate: 110,  unit: 'm',   labour: 0.55, materials: 0.45, description: 'Lead flashing Code 5 at abutments lapped soaked and pointed' },
  'flat_roof_felt':                    { rate: 65,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Built-up felt flat roof three-layer system on insulation' },
  'flat_roof_single_ply':              { rate: 85,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Single-ply membrane flat roof (EPDM/TPO) on insulation' },
  'chimney_repair':                    { rate: 2500, unit: 'Nr',  labour: 0.70, materials: 0.30, description: 'Chimney repair incl. repoint, reflash, replace pot and cowl' },
  'chimney_rebuild':                   { rate: 4500, unit: 'Nr',  labour: 0.60, materials: 0.40, description: 'Rebuild chimney stack above roof level incl. pots flaunching' },
  // Heritage rainwater goods
  'cast_iron_guttering':               { rate: 85,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Cast iron half-round gutter 100mm with brackets and fittings' },
  'cast_iron_downpipe':                { rate: 75,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Cast iron circular downpipe 75mm with holderbats and shoe' },
  'cast_iron_hopper':                  { rate: 120,  unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Cast iron hopper head ogee pattern' },
  'aluminium_guttering':               { rate: 55,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Aluminium half-round gutter with brackets and fittings' },
  // Heritage windows & doors
  'sash_window_overhaul':              { rate: 650,  unit: 'Nr',  labour: 0.80, materials: 0.20, description: 'Overhaul existing timber sash window draught strip rebalance' },
  'sash_window_replacement':           { rate: 1800, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Purpose-made timber sliding sash window double glazed to match existing' },
  'secondary_glazing':                 { rate: 450,  unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Secondary glazing unit hinged or sliding to existing window' },
  'timber_casement_window':            { rate: 950,  unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Timber casement window purpose-made double glazed' },
  'timber_door_refurbish':             { rate: 350,  unit: 'Nr',  labour: 0.80, materials: 0.20, description: 'Refurbish existing timber door strip back, repair, redecorate' },
  'heritage_front_door':               { rate: 2200, unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Purpose-made hardwood front door panelled with ironmongery' },
  // Damp & timber treatment
  'damp_proofing_tanking':             { rate: 75,   unit: 'm²',  labour: 0.60, materials: 0.40, description: 'Damp proofing tanking slurry system two-coat' },
  'timber_treatment_spray':            { rate: 12,   unit: 'm²',  labour: 0.70, materials: 0.30, description: 'Timber treatment spray application insecticide/fungicide' },
  'timber_repair_splice':              { rate: 185,  unit: 'Nr',  labour: 0.70, materials: 0.30, description: 'Timber splice repair to joist/rafter with resin and bolts' },
  'joist_replacement':                 { rate: 45,   unit: 'm',   labour: 0.65, materials: 0.35, description: 'Replace timber floor joist treated softwood incl. hangers' },
  'floorboard_replacement':            { rate: 35,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Replace floorboards 22mm T&G softwood to match existing' },
  'floor_sanding_lacquer':             { rate: 28,   unit: 'm²',  labour: 0.75, materials: 0.25, description: 'Sand and lacquer existing timber floor 3 coats polyurethane' },
  // Heating (gas/oil systems, not just ASHP)
  'gas_boiler_combi':                  { rate: 3200, unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Gas combi boiler supply and install incl. flue and controls' },
  'gas_boiler_system':                 { rate: 3800, unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Gas system boiler supply and install incl. flue and controls' },
  'oil_boiler':                        { rate: 4500, unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Oil-fired boiler supply and install incl. flue and controls' },
  'hot_water_cylinder':                { rate: 1200, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Unvented hot water cylinder 210L supply and install' },
  'radiator_single_panel':             { rate: 280,  unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Single panel radiator supply fix and connect' },
  'radiator_double_panel':             { rate: 380,  unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Double panel radiator supply fix and connect' },
  'radiator_column_cast':              { rate: 650,  unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Column/cast iron style radiator supply fix and connect' },
  'heating_pipework_first_fix':        { rate: 35,   unit: 'm',   labour: 0.65, materials: 0.35, description: 'Heating pipework first fix copper 15-22mm incl. fittings' },
  'heating_controls_upgrade':          { rate: 450,  unit: 'Item',labour: 0.50, materials: 0.50, description: 'Heating controls upgrade programmer room stat TRVs' },
  'gas_supply_meter':                  { rate: 850,  unit: 'Item',labour: 0.60, materials: 0.40, description: 'Gas supply and meter relocation/new connection' },
  // Full electrical rewire
  'full_electrical_rewire':            { rate: 85,   unit: 'm²',  labour: 0.75, materials: 0.25, description: 'Full electrical rewire per m² floor area incl. consumer unit' },
  'electrical_rewire_room':            { rate: 850,  unit: 'Nr',  labour: 0.75, materials: 0.25, description: 'Electrical rewire single room ring main lighting and sockets' },
  'fire_alarm_system':                 { rate: 1200, unit: 'Item',labour: 0.60, materials: 0.40, description: 'Fire alarm system Grade D LD2 linked smoke and heat detectors' },
  'intruder_alarm':                    { rate: 1500, unit: 'Item',labour: 0.55, materials: 0.45, description: 'Intruder alarm system wireless with keypad and sensors' },
  'tv_data_cabling':                   { rate: 150,  unit: 'Nr',  labour: 0.65, materials: 0.35, description: 'TV/data point cat6 cable with faceplate' },
  'external_lighting':                 { rate: 250,  unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'External light fitting LED with PIR and wiring' },
  // Decoration (refurbishment detail)
  'mist_coat':                         { rate: 4,    unit: 'm²',  labour: 0.85, materials: 0.15, description: 'Mist coat to new plaster (diluted emulsion)' },
  'emulsion_walls_2coat':              { rate: 6.5,  unit: 'm²',  labour: 0.85, materials: 0.15, description: 'Two coats emulsion paint to prepared walls' },
  'emulsion_ceiling':                  { rate: 7,    unit: 'm²',  labour: 0.85, materials: 0.15, description: 'Two coats emulsion paint to ceiling' },
  'gloss_woodwork':                    { rate: 12,   unit: 'm²',  labour: 0.85, materials: 0.15, description: 'Gloss paint to woodwork undercoat and gloss' },
  'external_masonry_paint':            { rate: 9,    unit: 'm²',  labour: 0.80, materials: 0.20, description: 'External masonry paint two coats Sandtex or equal' },
  'wallpaper_strip_repaper':           { rate: 18,   unit: 'm²',  labour: 0.75, materials: 0.25, description: 'Strip existing wallpaper and repaper lining paper and finish' },
  // Floor finishes (additional refurb types)
  'carpet_supply_fit':                 { rate: 28,   unit: 'm²',  labour: 0.35, materials: 0.65, description: 'Carpet supply and fit 80/20 wool twist with underlay and grippers' },
  'engineered_timber_floor':           { rate: 55,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Engineered timber flooring supply and lay incl. underlay and trims' },
  'tile_wall_ceramic':                 { rate: 55,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Wall tiling ceramic 200x300mm incl. adhesive and grout' },
  'tile_wall_large_format':            { rate: 72,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Wall tiling large format 600x300mm incl. adhesive and grout' },
  // Bathroom & kitchen fit-out
  'kitchen_fitout_mid':                { rate: 8500, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Kitchen fit-out mid range units worktop splashback sink and tap' },
  'kitchen_fitout_high':               { rate: 15000,unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Kitchen fit-out high spec units stone worktop integrated appliances' },
  'bathroom_fitout_mid':               { rate: 5500, unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Bathroom fit-out mid range bath/shower WC basin tiling' },
  'bathroom_fitout_high':              { rate: 8500, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Bathroom fit-out high spec sanitaryware brassware tiling' },
  'wc_cloakroom_fitout':               { rate: 2800, unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'WC/cloakroom fit-out WC basin tiling vanity' },
  'shower_room_fitout':                { rate: 4200, unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Shower room fit-out shower enclosure tray basin WC tiling' },
  // External works
  'paving_slabs':                      { rate: 65,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Concrete paving slabs 600x600mm on mortar bed' },
  'block_paving':                      { rate: 85,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Block paving 200x100mm on sand bed incl. edging' },
  'tarmac_driveway':                   { rate: 55,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Tarmac driveway base and wearing course on sub-base' },
  'gravel_driveway':                   { rate: 25,   unit: 'm²',  labour: 0.45, materials: 0.55, description: 'Gravel driveway 50mm deep on geotextile membrane' },
  'retaining_wall_block':              { rate: 185,  unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Retaining wall concrete block 200mm reinforced' },
  'garden_wall_brick':                 { rate: 145,  unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Garden wall one brick thick in facing bricks' },
  'gate_timber':                       { rate: 450,  unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Timber gate hardwood with ironmongery and posts' },
  'gate_metal':                        { rate: 650,  unit: 'Nr',  labour: 0.45, materials: 0.55, description: 'Metal gate galvanised and painted with posts' },
  'landscaping_allowance':             { rate: 2500, unit: 'Item',labour: 0.60, materials: 0.40, description: 'Landscaping allowance turf planting beds and borders' },
  'drainage_new_run':                  { rate: 125,  unit: 'm',   labour: 0.65, materials: 0.35, description: 'New drainage run 110mm UPVC to fall incl. bed and surround' },
  'manhole_inspection_chamber':        { rate: 650,  unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'Inspection chamber 450mm dia polypropylene to invert' },
  // Asbestos
  'asbestos_survey':                   { rate: 450,  unit: 'Item',labour: 1.00, materials: 0.00, description: 'Asbestos management survey (R&D survey)' },
  'asbestos_removal':                  { rate: 1500, unit: 'Item',labour: 0.80, materials: 0.20, description: 'Licensed asbestos removal and disposal (allowance per location)' },
  // Insulation (refurbishment)
  'loft_insulation_topup':             { rate: 12,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Top up loft insulation to 300mm mineral wool' },
  'internal_wall_insulation':          { rate: 55,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Internal wall insulation 50mm PIR with plasterboard laminate' },
  'external_wall_insulation':          { rate: 95,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'External wall insulation EWI system 90mm with render finish' },
  'floor_insulation_suspended':        { rate: 32,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Insulation to suspended timber floor mineral wool between joists' },
  // Provisional sums & professional fees
  'provisional_sum':                   { rate: 1,    unit: 'Item',labour: 0.00, materials: 1.00, description: 'Provisional sum' },
  'architect_fees':                    { rate: 5500, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Architect fees design and contract administration' },
  'planning_application':              { rate: 462,  unit: 'Item',labour: 0.00, materials: 1.00, description: 'Planning application fee (householder)' },
  'cdm_principal_designer':            { rate: 1800, unit: 'Item',labour: 0.00, materials: 1.00, description: 'CDM Principal Designer fee' },
  'project_management':                { rate: 3500, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Project management fee' },

  // Prelims
  'scaffolding':                       { rate: 22,   unit: 'm²', labour: 0.60, materials: 0.40, description: 'Independent scaffold two-storey incl. erect, adapt, dismantle' },
  'scaffolding_two_storey':            { rate: 22,   unit: 'm²', labour: 0.60, materials: 0.40, description: 'Independent scaffold two-storey incl. erect, adapt, dismantle' },
  'site_setup_scaffold':               { rate: 2800, unit: 'Item',labour: 0.70, materials: 0.30, description: 'Site setup hoarding scaffold incl. scaffold licence if required' },
  'skip_hire_8yd':                     { rate: 320,  unit: 'Nr',  labour: 0.10, materials: 0.90, description: 'Skip hire 8-yard' },
  'site_welfare':                      { rate: 650,  unit: 'Item',labour: 0.50, materials: 0.50, description: 'Site welfare PPE temporary power & water connection' },
  'building_control_fees':             { rate: 950,  unit: 'Item',labour: 0.00, materials: 1.00, description: 'Building Control application & inspection fees' },
  'party_wall_surveyor':               { rate: 1200, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Party Wall surveyor fee (if applicable under PWA 1996)' },
  'structural_engineer_fees':          { rate: 2200, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Structural engineer fees design & site inspections' },
  'snagging_clearance':                { rate: 650,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'Clearance & clean at completion snagging allowance' },
};

/**
 * Estimate a fallback rate when no base rate or AI estimate exists.
 * Uses the item's unit and description keywords to pick a sensible market rate.
 * This ensures we NEVER price something at £0.
 */
function estimateFallbackRate(item) {
  const desc = (item.description || item.key || '').toLowerCase();
  const unit = (item.unit || '').toLowerCase();

  // Per-item / lump sum items — estimate by description keywords
  if (unit === 'item' || unit === 'nr' || unit === 'no' || unit === 'nr.' || unit === 'each') {
    if (desc.includes('demolish') || desc.includes('demolition'))  return 3500;
    if (desc.includes('heat pump') || desc.includes('ashp'))       return 9500;
    if (desc.includes('boiler') && desc.includes('oil'))           return 4500;
    if (desc.includes('boiler') && desc.includes('system'))        return 3800;
    if (desc.includes('boiler'))                                    return 3200;
    if (desc.includes('staircase') || desc.includes('stair'))      return 3200;
    if (desc.includes('kitchen') && desc.includes('high'))         return 15000;
    if (desc.includes('kitchen'))                                   return 8500;
    if (desc.includes('bathroom') && desc.includes('high'))        return 8500;
    if (desc.includes('bathroom') || desc.includes('en-suite') || desc.includes('ensuite')) return 5500;
    if (desc.includes('shower room') || desc.includes('shower-room')) return 4200;
    if (desc.includes('cloakroom') || desc.includes('wc room'))    return 2800;
    if (desc.includes('velux') || desc.includes('rooflight') || desc.includes('skylight')) return 1850;
    if (desc.includes('sash') && desc.includes('replac'))          return 1800;
    if (desc.includes('sash') && desc.includes('overhaul'))        return 650;
    if (desc.includes('secondary glaz'))                            return 450;
    if (desc.includes('door') && desc.includes('bi-fold'))         return 4400;
    if (desc.includes('door') && desc.includes('front') && desc.includes('heritage')) return 2200;
    if (desc.includes('door') && desc.includes('external'))        return 1450;
    if (desc.includes('door') && desc.includes('refurb'))          return 350;
    if (desc.includes('door'))                                      return 420;
    if (desc.includes('casement'))                                  return 950;
    if (desc.includes('window'))                                    return 450;
    if (desc.includes('steel') || desc.includes('structural'))     return 3500;
    if (desc.includes('cylinder') || desc.includes('tank'))        return 1200;
    if (desc.includes('chimney') && desc.includes('rebuild'))      return 4500;
    if (desc.includes('chimney'))                                   return 2500;
    if (desc.includes('radiator') && desc.includes('column'))      return 650;
    if (desc.includes('radiator'))                                  return 380;
    if (desc.includes('sanitaryware') || desc.includes('wc') || desc.includes('toilet')) return 650;
    if (desc.includes('shower'))                                    return 580;
    if (desc.includes('strip out') && desc.includes('heat'))       return 750;
    if (desc.includes('strip out') && desc.includes('kitchen'))    return 450;
    if (desc.includes('strip out') && desc.includes('bath'))       return 350;
    if (desc.includes('strip out') && desc.includes('electr'))     return 450;
    if (desc.includes('strip out') || desc.includes('soft strip')) return 350;
    if (desc.includes('asbestos') && desc.includes('remov'))       return 1500;
    if (desc.includes('asbestos') && desc.includes('survey'))      return 450;
    if (desc.includes('fire alarm'))                                return 1200;
    if (desc.includes('intruder') || desc.includes('burglar'))     return 1500;
    if (desc.includes('heating control'))                           return 450;
    if (desc.includes('gas supply') || desc.includes('meter'))     return 850;
    if (desc.includes('manhole') || desc.includes('inspection chamber')) return 650;
    if (desc.includes('gate') && desc.includes('metal'))           return 650;
    if (desc.includes('gate'))                                      return 450;
    if (desc.includes('landscap'))                                  return 2500;
    if (desc.includes('provisional'))                               return 1;
    if (desc.includes('sundries') || desc.includes('allowance'))   return 500;
    return 750; // generic lump sum fallback
  }

  // Per m² items
  if (unit === 'm²' || unit === 'm2' || unit === 'sqm') {
    if (desc.includes('strip out') || desc.includes('hack off'))   return 15;
    if (desc.includes('lime render'))                               return 65;
    if (desc.includes('lime plaster'))                              return 48;
    if (desc.includes('lime') && desc.includes('repoint'))         return 85;
    if (desc.includes('render'))                                    return 55;
    if (desc.includes('cladding'))                                  return 145;
    if (desc.includes('external wall insulation') || desc.includes('ewi')) return 95;
    if (desc.includes('internal wall insulation'))                  return 55;
    if (desc.includes('loft insulation') || desc.includes('top up')) return 12;
    if (desc.includes('insulation'))                                return 28;
    if (desc.includes('plasterboard') || desc.includes('skim'))    return 32;
    if (desc.includes('damp') || desc.includes('tanking'))         return 75;
    if (desc.includes('wall tile') || desc.includes('wall tiling')) return 55;
    if (desc.includes('tile') || desc.includes('tiling'))          return 65;
    if (desc.includes('screed'))                                    return 42;
    if (desc.includes('floor') && desc.includes('chip'))           return 28;
    if (desc.includes('floor') && desc.includes('sand'))           return 28;
    if (desc.includes('floor') && desc.includes('board'))          return 35;
    if (desc.includes('carpet'))                                    return 28;
    if (desc.includes('engineered') && desc.includes('timber'))    return 55;
    if (desc.includes('floor'))                                     return 42;
    if (desc.includes('lead') && desc.includes('roof'))            return 175;
    if (desc.includes('natural slate') || desc.includes('welsh slate')) return 95;
    if (desc.includes('clay tile'))                                 return 78;
    if (desc.includes('single ply') || desc.includes('epdm'))     return 85;
    if (desc.includes('felt') && desc.includes('roof'))            return 65;
    if (desc.includes('roof'))                                      return 55;
    if (desc.includes('stone clean'))                               return 35;
    if (desc.includes('brick'))                                     return 95;
    if (desc.includes('block') && desc.includes('pav'))            return 85;
    if (desc.includes('block'))                                     return 42;
    if (desc.includes('scaffold'))                                  return 22;
    if (desc.includes('membrane') || desc.includes('dpm'))         return 4.5;
    if (desc.includes('concrete') || desc.includes('slab'))        return 78;
    if (desc.includes('paving') || desc.includes('patio'))         return 65;
    if (desc.includes('tarmac'))                                    return 55;
    if (desc.includes('gravel'))                                    return 25;
    if (desc.includes('mist coat'))                                 return 4;
    if (desc.includes('emulsion'))                                  return 6.5;
    if (desc.includes('gloss'))                                     return 12;
    if (desc.includes('masonry paint'))                             return 9;
    if (desc.includes('wallpaper'))                                 return 18;
    if (desc.includes('decoration') || desc.includes('paint'))     return 8.5;
    if (desc.includes('timber treat'))                              return 12;
    if (desc.includes('rewire'))                                    return 85;
    if (desc.includes('retaining'))                                 return 185;
    if (desc.includes('garden wall'))                               return 145;
    return 45; // generic m² fallback
  }

  // Per linear metre
  if (unit === 'm' || unit === 'lm' || unit === 'm¹') {
    if (desc.includes('skirting'))                                   return 18;
    if (desc.includes('cast iron') && desc.includes('gutter'))     return 85;
    if (desc.includes('cast iron') && desc.includes('down'))       return 75;
    if (desc.includes('aluminium') && desc.includes('gutter'))     return 55;
    if (desc.includes('gutter') || desc.includes('fascia'))        return 48;
    if (desc.includes('lead flash') && desc.includes('code 5'))    return 110;
    if (desc.includes('flashing') || desc.includes('lead'))        return 95;
    if (desc.includes('crack stitch') || desc.includes('helical')) return 95;
    if (desc.includes('dpc') && desc.includes('inject'))           return 45;
    if (desc.includes('drainage') || desc.includes('pipe'))        return 125;
    if (desc.includes('joist'))                                     return 45;
    if (desc.includes('heating') && desc.includes('pipe'))         return 35;
    if (desc.includes('fence') || desc.includes('fencing'))        return 95;
    if (desc.includes('kerb') || desc.includes('edging'))          return 35;
    if (desc.includes('architrave') || desc.includes('dado'))      return 14;
    return 35; // generic linear metre fallback
  }

  // Per m³
  if (unit === 'm³' || unit === 'm3') {
    if (desc.includes('excavat'))                                   return 95;
    if (desc.includes('concrete'))                                  return 185;
    if (desc.includes('fill') || desc.includes('hardcore'))        return 45;
    return 95; // generic m³ fallback
  }

  // Per tonne / kg
  if (unit === 'tonne' || unit === 't' || unit === 'kg') {
    if (desc.includes('steel'))                                     return 3200;
    return 250;
  }

  // Fallback for anything else
  return 500;
}

// Location uplift factors
const LOCATION_FACTORS = {
  'london':         1.20,
  'south_east':     1.15,
  'south_west':     1.05,
  'midlands':       1.07,
  'north_england':  0.97,
  'north_west':     0.98,
  'yorkshire':      0.97,
  'scotland':       1.03,
  'wales':          0.96,
  'ireland':        1.10,
  'default':        1.00,
};

function detectLocationFactor(locationStr) {
  if (!locationStr) return { factor: 1.00, label: 'default' };
  const loc = locationStr.toLowerCase();
  if (loc.includes('london') || loc.includes('tw') || loc.includes('sw') || loc.includes('se') || loc.includes('ec') || loc.includes('wc') || loc.includes('w1') || loc.includes('e1') || loc.includes('n1') || loc.includes('nw') || loc.includes('richmond') || loc.includes('kingston') || loc.includes('wimbledon') || loc.includes('croydon')) return { factor: 1.20, label: 'London/SE (+20%)' };
  if (loc.includes('brighton') || loc.includes('guildford') || loc.includes('oxford') || loc.includes('cambridge') || loc.includes('surrey') || loc.includes('kent') || loc.includes('essex') || loc.includes('hertford') || loc.includes('reading')) return { factor: 1.15, label: 'South East (+15%)' };
  if (loc.includes('bristol') || loc.includes('bath') || loc.includes('exeter') || loc.includes('devon') || loc.includes('somerset') || loc.includes('dorset') || loc.includes('cornwall')) return { factor: 1.05, label: 'South West (+5%)' };
  if (loc.includes('birmingham') || loc.includes('coventry') || loc.includes('leicester') || loc.includes('nottingham') || loc.includes('derby') || loc.includes('northampton') || loc.includes('stoke')) return { factor: 1.07, label: 'Midlands (+7%)' };
  if (loc.includes('manchester') || loc.includes('liverpool') || loc.includes('chester') || loc.includes('lancashire') || loc.includes('cheshire')) return { factor: 0.98, label: 'North West (-2%)' };
  if (loc.includes('leeds') || loc.includes('sheffield') || loc.includes('york') || loc.includes('hull') || loc.includes('bradford')) return { factor: 0.97, label: 'Yorkshire (-3%)' };
  if (loc.includes('newcastle') || loc.includes('sunderland') || loc.includes('durham') || loc.includes('carlisle') || loc.includes('cumbria')) return { factor: 0.97, label: 'North England (-3%)' };
  if (loc.includes('edinburgh') || loc.includes('glasgow') || loc.includes('scotland') || loc.includes('aberdeen') || loc.includes('inverness') || loc.includes('dundee') || loc.includes('fife') || loc.includes('st andrews') || loc.includes('stirling') || loc.includes('perth') || loc.includes('falkirk') || loc.includes('paisley') || loc.includes('kilmarnock') || loc.includes('ayr')) return { factor: 1.03, label: 'Scotland (+3%)' };
  if (loc.includes('cardiff') || loc.includes('wales') || loc.includes('swansea') || loc.includes('newport')) return { factor: 0.96, label: 'Wales (-4%)' };
  if (loc.includes('dublin') || loc.includes('cork') || loc.includes('ireland') || loc.includes('galway') || loc.includes('limerick')) return { factor: 1.10, label: 'Ireland (+10%)' };
  return { factor: 1.00, label: 'UK average' };
}

/**
 * Cross-validate quantities against each other to catch impossible values.
 * Returns warnings for any quantities that don't make sense relative to others.
 */
function crossValidateQuantities(items) {
  const warnings = [];
  const byKey = {};
  for (const item of items) {
    byKey[item.key] = item;
  }

  // Get total floor area from concrete slab items
  const slabItem = byKey['concrete_slab_150mm'] || byKey['concrete_slab_100mm'];
  const floorArea = slabItem ? slabItem.qty : null;

  if (floorArea && floorArea > 0) {
    // Wall area should be roughly perimeter × height. For a square building of area A,
    // perimeter ≈ 4 × sqrt(A), height ≈ 2.4m, so wall area ≈ 9.6 × sqrt(A)
    // For 30m² floor → ~53m² wall area. Allow 2x for internal walls = ~106m²
    const expectedPerimeter = 4 * Math.sqrt(floorArea);
    const maxWallArea = expectedPerimeter * 2.7 * 3; // 3x for generous margin (internal walls, multiple rooms)

    const brickArea = byKey['brick_outer_leaf'] ? byKey['brick_outer_leaf'].qty : 0;
    if (brickArea > maxWallArea) {
      warnings.push(`Brick outer leaf area (${brickArea}m²) seems too high for ${floorArea}m² floor area. Expected max ~${Math.round(maxWallArea)}m² (perimeter × height). Check for doubled quantities.`);
    }

    const blockArea = byKey['blockwork_inner_leaf_100mm'] ? byKey['blockwork_inner_leaf_100mm'].qty : 0;
    if (blockArea > maxWallArea) {
      warnings.push(`Blockwork inner leaf area (${blockArea}m²) seems too high for ${floorArea}m² floor area. Check for doubled quantities.`);
    }

    // Roof area should be roughly floor area × pitch factor (1.1-1.3 typical)
    const roofItem = byKey['roof_structure_cut_timber'];
    if (roofItem && roofItem.qty > floorArea * 2) {
      warnings.push(`Roof structure area (${roofItem.qty}m²) is more than 2x floor area (${floorArea}m²). Check for error — typical pitch factor is 1.1-1.3x.`);
    }

    // Scaffolding should be elevation area (perimeter × height), NOT floor area
    const scaffItem = byKey['scaffolding'] || byKey['scaffolding_two_storey'];
    if (scaffItem) {
      const expectedScaff = expectedPerimeter * 3; // ~3m height for single storey with scaffold
      if (scaffItem.qty > expectedScaff * 3) {
        warnings.push(`Scaffolding area (${scaffItem.qty}m²) seems too high. Expected ~${Math.round(expectedScaff)}m² (perimeter × height). Make sure this is elevation area, not floor area.`);
      }
    }

    // Plasterboard walls shouldn't be more than total internal+external wall area
    const plasterWalls = byKey['plasterboard_skim_walls'];
    if (plasterWalls && plasterWalls.qty > maxWallArea * 1.5) {
      warnings.push(`Plasterboard wall area (${plasterWalls.qty}m²) seems too high for ${floorArea}m² floor area. Check for doubled quantities.`);
    }
  }

  // Cavity wall ties should be proportional to wall area (typically 2.5-4 per m²)
  const tiesItem = byKey['cavity_wall_ties_ss'];
  const brickItem = byKey['brick_outer_leaf'];
  if (tiesItem && brickItem && tiesItem.qty > brickItem.qty * 6) {
    warnings.push(`Cavity wall ties (${tiesItem.qty} Nr) seems too high for ${brickItem.qty}m² of brickwork. Typical density is 2.5-4 ties per m².`);
  }

  return warnings;
}

/**
 * Price a set of locked quantities deterministically.
 * @param {Array} lockedItems - Array of { key, description, unit, qty, override_rate? }
 * @param {string} location - Location string for uplift detection
 * @param {Object} clientRates - Client-specific rates from DB { item_key: value }
 * @param {Object} options - { contingency_pct, ohp_pct, vat_rate, currency }
 * @returns {Object} - Complete priced BOQ structure
 */
function priceLockedQuantities(lockedItems, location, clientRates = {}, options = {}) {
  const {
    contingency_pct = 7.5,
    ohp_pct = 12,
    vat_rate = 20,
    currency = 'GBP',
  } = options;

  const locationInfo = detectLocationFactor(location);
  const locFactor = locationInfo.factor;
  const isIreland = locFactor === 1.10 && currency === 'EUR';

  const pricedItems = [];
  const warnings = [];

  // Cross-validate quantities against each other before pricing
  const crossValidationWarnings = crossValidateQuantities(lockedItems);
  warnings.push(...crossValidationWarnings);

  for (const item of lockedItems) {
    // Rate priority: 1) explicit override in item, 2) client DB rate, 3) base rate library
    let rate, rateSource;
    if (item.override_rate && item.override_rate > 0) {
      rate = item.override_rate;
      rateSource = 'override';
    } else if (clientRates[item.key] && clientRates[item.key] > 0) {
      rate = clientRates[item.key];
      rateSource = 'client_verified';
    } else if (BASE_RATES[item.key]) {
      rate = BASE_RATES[item.key].rate * locFactor;
      rateSource = 'base_library';
    } else {
      // Unknown key — use AI assumed rate, or estimate from unit type
      rate = item.assumed_rate || estimateFallbackRate(item) ;
      rate = rate * locFactor;
      rateSource = item.assumed_rate ? 'ai_estimated' : 'fallback_estimated';
      warnings.push(`No base rate for '${item.key}' — used ${rateSource} rate £${Math.round(rate * 100) / 100}/${item.unit || 'Item'}`);
    }

    // Sanity check: if AI assumed_rate looks like a total cost rather than a per-unit rate, cap it
    if (rateSource === 'ai_estimated' && item.qty > 1) {
      const itemTotal = item.qty * rate;
      // If a single line item exceeds £50k with AI-estimated rate, the rate is likely wrong
      if (itemTotal > 50000 && rate > 500) {
        const expectedRate = estimateFallbackRate(item) * locFactor;
        if (rate > expectedRate * 5) {
          warnings.push(`Rate for '${item.key}' looks too high (£${Math.round(rate)}/${item.unit || 'Item'} × ${item.qty} = £${Math.round(itemTotal).toLocaleString()}). Using fallback rate £${Math.round(expectedRate * 100) / 100}/${item.unit || 'Item'} instead.`);
          rate = expectedRate;
          rateSource = 'fallback_corrected';
        }
      }
    }

    const baseRate = BASE_RATES[item.key] || { labour: 0.5, materials: 0.5, description: item.description };
    const total = Math.round(item.qty * rate * 100) / 100;
    const labour = Math.round(total * baseRate.labour * 100) / 100;
    const materials = Math.round(total * baseRate.materials * 100) / 100;

    // Flag individual items with suspiciously high totals
    if (total > 25000) {
      warnings.push(`High-value item: '${item.description || item.key}' = £${Math.round(total).toLocaleString()} (${item.qty} ${item.unit || 'Item'} × £${Math.round(rate * 100) / 100}) — please verify qty and rate`);
    }

    pricedItems.push({
      key: item.key,
      item_ref: item.item_ref || '',
      description: item.description || baseRate.description,
      unit: item.unit || baseRate.unit || '',
      qty: item.qty,
      rate: Math.round(rate * 100) / 100,
      labour,
      materials,
      total,
      rate_source: rateSource,
      section: item.section || 'General',
      working: item.working || '',
    });
  }

  // Group by section
  const sections = {};
  for (const item of pricedItems) {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  }

  const sectionTotals = Object.entries(sections).map(([name, items]) => ({
    name,
    items,
    subtotal: items.reduce((s, i) => s + i.total, 0),
  }));

  const constructionTotal = sectionTotals.reduce((s, sec) => s + sec.subtotal, 0);
  const contingency = Math.round(constructionTotal * (contingency_pct / 100) * 100) / 100;
  const netTotal = constructionTotal + contingency;
  const ohp = Math.round(netTotal * (ohp_pct / 100) * 100) / 100;
  const netWithOhp = netTotal + ohp;
  const vat = Math.round(netWithOhp * (vat_rate / 100) * 100) / 100;
  const grandTotal = netWithOhp + vat;

  return {
    sections: sectionTotals,
    summary: {
      construction_total: Math.round(constructionTotal * 100) / 100,
      contingency_pct,
      contingency: Math.round(contingency * 100) / 100,
      net_total: Math.round(netTotal * 100) / 100,
      ohp_pct,
      ohp: Math.round(ohp * 100) / 100,
      net_with_ohp: Math.round(netWithOhp * 100) / 100,
      vat_rate,
      vat: Math.round(vat * 100) / 100,
      grand_total: Math.round(grandTotal * 100) / 100,
      currency,
    },
    location: locationInfo,
    warnings,
    item_count: pricedItems.length,
    priced_at: new Date().toISOString(),
  };
}

/**
 * Convert priced result to the sections[] format expected by boqGenerator
 */
function toPricedSections(pricedResult) {
  let itemCounter = 1;
  return pricedResult.sections.map((sec, si) => ({
    number: String(si + 1),
    title: sec.name,
    items: sec.items.map((item, ii) => ({
      item: `${si + 1}.${ii + 1}`,
      description: item.working ? `${item.description}\n  (${item.working})` : item.description,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      labour: item.labour,
      materials: item.materials,
      total: item.total,
      rate_source: item.rate_source,
    })),
  }));
}

module.exports = { priceLockedQuantities, toPricedSections, detectLocationFactor, BASE_RATES, LOCATION_FACTORS };

/**
 * deterministicPricer.js
 * Pure arithmetic pricing engine — NO AI involved.
 * Same locked quantities + same rate library = identical output every run.
 */

const BASE_RATES = {
  // Substructure
  'excavation_strip_foundation':        { rate: 75,   unit: 'm³',  labour: 0.75, materials: 0.25, description: 'Excavate strip foundations to engineer\'s design depth; remove excavated spoil to skip; trim sides and compact base; including earthwork support where required' },
  'concrete_strip_foundation':          { rate: 185,  unit: 'm³',  labour: 0.35, materials: 0.65, description: 'Concrete to strip foundations; grade C25/30; including A393 mesh reinforcement; placing, vibrating and levelling; in accordance with structural engineer\'s design' },
  'blockwork_below_dpc':                { rate: 68,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Blockwork below DPC 140mm dense concrete block' },
  'dpc_polythene':                      { rate: 5.5,  unit: 'm',   labour: 0.50, materials: 0.50, description: 'DPC 450mm polythene, two courses, lapped' },
  'hardcore_fill':                      { rate: 14,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Hardcore fill, compact & blind 200mm deep' },
  'concrete_slab_150mm':               { rate: 78,   unit: 'm²',  labour: 0.35, materials: 0.65, description: 'Reinforced concrete ground floor slab; 150mm thick; grade C25/30; including A393 mesh reinforcement; on DPM; power-floated finish; in accordance with structural engineer\'s specification' },
  'concrete_slab_100mm':               { rate: 50,   unit: 'm²',  labour: 0.35, materials: 0.65, description: 'Reinforced concrete ground floor slab; 100mm thick; grade C25/30; on DPM; power-floated finish' },
  'pir_insulation_under_slab':         { rate: 28,   unit: 'm²',  labour: 0.15, materials: 0.85, description: 'PIR insulation 150mm under slab Kingspan TP10' },
  'dpm_1200g':                         { rate: 4.5,  unit: 'm²',  labour: 0.20, materials: 0.80, description: 'DPM 1200g polythene lapped & turned up at edges' },
  // Masonry & frame
  'brick_outer_leaf':                  { rate: 82,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Facing brick outer leaf; 102mm thick; frost-resistant clay facing bricks to match existing house; laid in stretcher bond with flush pointing; including all cut bricks, closers and forming reveals' },
  'cavity_insulation_eps':             { rate: 18,   unit: 'm²',  labour: 0.30, materials: 0.70, description: 'Cavity fully filled EPS insulation Superfill 34' },
  'blockwork_inner_leaf_100mm':        { rate: 42,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Inner leaf 100mm Aircrete block 1400kg/m³ incl. mortar' },
  'cavity_wall_ties_ss':               { rate: 0.85, unit: 'Nr',  labour: 0.60, materials: 0.40, description: 'Cavity wall ties 250mm stainless steel' },
  'timber_sole_plate':                 { rate: 22,   unit: 'm',   labour: 0.60, materials: 0.40, description: 'Timber sole plate 150x75mm treated SW' },
  'cavity_closers':                    { rate: 14,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Cavity closers insulated proprietary uPVC at openings' },
  'stud_wall_plasterboard_both_faces': { rate: 65,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Timber stud wall 150mm studs plasterboard both faces' },
  'steel_lintels_catnic':              { rate: 75,   unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Steel lintels Catnic supply & fix' },
  'steel_lintels_bespoke':             { rate: 1850, unit: 'Item',labour: 0.50, materials: 0.50, description: 'Steel lintels bespoke to engineer design supply & fix' },
  // Roof
  'attic_trusses_prefab':              { rate: 12000,unit: 'Item',labour: 0.40, materials: 0.60, description: 'Prefabricated attic/room-in-roof truss system delivered and craned into position' },
  'roof_structure_cut_timber':         { rate: 55,   unit: 'm²',  labour: 0.65, materials: 0.35, description: 'Roof structure cut timber rafters at 400mm c/c' },
  'osb_sarking':                       { rate: 22,   unit: 'm²',  labour: 0.40, materials: 0.60, description: '18mm OSB3 structural roof decking fixed to truss top chord' },
  'breather_membrane':                 { rate: 8,    unit: 'm²',  labour: 0.30, materials: 0.70, description: 'Breathable roofing felt/membrane Klober Permo Ultra or equal' },
  'tile_battens':                      { rate: 12,   unit: 'm²',  labour: 0.55, materials: 0.45, description: '50x25mm tanalised counter-battens and tile battens' },
  'roof_tiles_interlocking':           { rate: 68,   unit: 'm²',  labour: 0.45, materials: 0.55, description: 'Concrete interlocking roof tiles to match existing incl. ridge verge hip' },
  'box_gutter_lead_lined':             { rate: 185,  unit: 'm',   labour: 0.55, materials: 0.45, description: 'Box gutter 100mm wide internal lead-lined to 1:60 fall' },
  'fascia_soffit_guttering':           { rate: 45,   unit: 'm',   labour: 0.50, materials: 0.50, description: 'Soffit and fascia boarding 150mm uPVC with gutter and fittings' },
  'lead_flashing_code4':               { rate: 95,   unit: 'm',   labour: 0.55, materials: 0.45, description: 'Lead Code 4 soaker and step flashings at abutment' },
  'roof_insulation_mineral_wool':      { rate: 82,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'Roof insulation 100mm Kingspan Thermaroof TR27 between and over rafters' },
  'velux_skylight_780x980':            { rate: 1450, unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Velux GGL 780x980mm centre-pivot roof window incl. flashings' },
  'velux_skylight_940x1178':           { rate: 1450, unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Velux GGL 940x1178mm standard centre-pivot roof window incl. flashings' },
  'velux_skylight_940x978':            { rate: 1250, unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Velux GGL 940x978mm centre-pivot roof window incl. flashings' },
  'velux_balcony_940x2520':            { rate: 4200, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Velux CVP/GEL PKN19 940x2520mm balcony-style roof window incl. flashings' },
  // Cladding
  'timber_cladding_accoya':            { rate: 145,  unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Accoya/Siberian Larch vertical cladding factory pre-treated' },
  'ventilated_cavity_battens':         { rate: 9.5,  unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Ventilated cavity battens behind cladding' },
  'close_boarded_fence_1800':          { rate: 95,   unit: 'm',   labour: 0.55, materials: 0.45, description: '1.8m high close-boarded timber fence incl. posts rails gravel boards' },
  'external_decorations_stain':        { rate: 12,   unit: 'm²',  labour: 0.80, materials: 0.20, description: 'Microporous stain 2-coat system to all exposed timber' },
  // Windows & doors — SIZE-BASED PRICING
  'bifold_door_aluminium_small':       { rate: 2500, unit: 'Nr',  labour: 0.30, materials: 0.70, description: 'Aluminium bi-fold door small (up to 2m wide, 2 panels) thermally broken double glazed' },
  'bifold_door_aluminium':             { rate: 3200, unit: 'Nr',  labour: 0.30, materials: 0.70, description: 'Aluminium bi-fold door medium (2-3m wide, 3 panels) thermally broken double glazed' },
  'bifold_door_aluminium_large':       { rate: 4500, unit: 'Nr',  labour: 0.30, materials: 0.70, description: 'Aluminium bi-fold door large (3-4m+ wide, 4-5 panels) thermally broken double glazed' },
  'composite_external_door':           { rate: 1250, unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Composite external door solid timber/GRP incl. frame threshold ironmongery' },
  'composite_external_door_std':       { rate: 1100, unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Composite external door standard incl. frame ironmongery' },
  'upvc_window_small':                 { rate: 350,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'UPVC window small (up to 600x900mm) double glazed trickle vent' },
  'upvc_window_standard':              { rate: 450,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'UPVC window standard (up to 1200x1200mm) double glazed trickle vent' },
  'upvc_window_large':                 { rate: 580,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'UPVC window large (over 1200mm wide) double glazed trickle vent' },
  'window_obscure_small':              { rate: 380,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Window obscure small (up to 600x900mm) double glazed UPVC' },
  'window_obscure_standard':           { rate: 520,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Window obscure standard double glazed UPVC/aluminium trickle vent' },
  'window_bespoke_narrow':             { rate: 650,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Narrow bespoke double glazed window trickle vent' },
  'vent_panel_obscure':                { rate: 380,  unit: 'Nr',  labour: 0.35, materials: 0.65, description: 'Vent panel obscure glazed fixed or opening' },
  'mastic_sealant_allowance':          { rate: 12,   unit: 'm',   labour: 0.70, materials: 0.30, description: 'Mastic sealant around window/door frames inside and outside' },
  'motorised_rooflight':               { rate: 1200, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'UPVC motorised rooflight bespoke incl. surround' },
  // Internal finishes
  'plasterboard_skim_walls':           { rate: 32,   unit: 'm²',  labour: 0.65, materials: 0.35, description: '15mm plasterboard & 3mm skim to walls taped & filled' },
  'metal_stud_partition':              { rate: 58,   unit: 'm²',  labour: 0.65, materials: 0.35, description: 'Metal stud 70mm partition plasterboard both faces skim' },
  'wedi_wetroom_board':                { rate: 48,   unit: 'm²',  labour: 0.55, materials: 0.45, description: 'Wedi board wetroom boards to shower enclosure walls' },
  'plasterboard_ceilings':             { rate: 28,   unit: 'm²',  labour: 0.65, materials: 0.35, description: '12.5mm plasterboard ceilings taped filled & skimmed' },
  'screed_ufh_75mm':                   { rate: 85,   unit: 'm²',  labour: 0.55, materials: 0.45, description: '75mm screed with UFH on 30mm perimeter insulation strip' },
  'screed_sand_cement_75mm':           { rate: 42,   unit: 'm²',  labour: 0.60, materials: 0.40, description: '75mm sand:cement screed finished to receive floor finish' },
  'internal_door_painted_solid_core':  { rate: 380,  unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'Internal door 762x2040mm painted solid core incl. lining architrave ironmongery' },
  'internal_door_glazed':              { rate: 480,  unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Internal glazed timber door incl. lining architrave ironmongery' },
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
  // Electrical — price per circuit/zone, NOT per socket
  'consumer_unit_upgrade':             { rate: 3200, unit: 'Item',labour: 0.60, materials: 0.40, description: 'Extend consumer unit / new circuits from existing CU incl. RCBO' },
  'lighting_installation':             { rate: 1800, unit: 'Item',labour: 0.65, materials: 0.35, description: 'Lighting installation complete circuit incl. downlighters/pendants wiring' },
  'power_sockets_circuit':             { rate: 1400, unit: 'Item',labour: 0.65, materials: 0.35, description: 'Power sockets circuit incl. double sockets, USB, outdoor if required' },
  'first_fix_electrical':              { rate: 1350, unit: 'Item',labour: 0.80, materials: 0.20, description: 'First fix wiring power & lighting circuits extract fans USB sockets' },
  'second_fix_electrical':             { rate: 850,  unit: 'Item',labour: 0.75, materials: 0.25, description: 'Second fix electrical sockets light switches pendant/downlights' },
  'extract_fans':                      { rate: 320,  unit: 'Nr',  labour: 0.65, materials: 0.35, description: 'Extract fans humidity sensor Vent Axia or equal' },
  'smoke_heat_detection':              { rate: 850,  unit: 'Item',labour: 0.65, materials: 0.35, description: 'Smoke/heat/CO detection Grade D LD2 linked detectors to Building Regs' },
  'ev_charge_point_ducting':           { rate: 250,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'EV charge point ducting and draw wire' },
  'electrical_testing_certificate':    { rate: 350,  unit: 'Item',labour: 1.00, materials: 0.00, description: 'Testing inspection & NICEIC certificate' },
  // Heating & plumbing — lump sums per zone
  'heating_extension':                 { rate: 4200, unit: 'Item',labour: 0.55, materials: 0.45, description: 'Extend existing central heating to new extension incl. radiators pipework controls' },
  'ensuite_sanitary_plumbing':         { rate: 3800, unit: 'Item',labour: 0.55, materials: 0.45, description: 'En-suite sanitary fittings and connections WC basin shower waste' },
  'utility_plumbing':                  { rate: 2500, unit: 'Item',labour: 0.55, materials: 0.45, description: 'Utility room plumbing provisions washing machine hot/cold waste' },
  // Staircase
  'staircase':                         { rate: 4800, unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'New timber staircase ground to first floor complete with newels balusters handrail' },
  'stair_opening_formation':           { rate: 750,  unit: 'Item',labour: 0.70, materials: 0.30, description: 'Form stair opening in existing ground floor ceiling/first floor structure' },
  // Demolition detail
  'strip_out_existing_roof':           { rate: 2200, unit: 'Item',labour: 0.90, materials: 0.10, description: 'Strip out existing garage/building roof covering rafters and dispose' },
  'demolish_existing_walls':           { rate: 2800, unit: 'Item',labour: 0.90, materials: 0.10, description: 'Demolish existing masonry/block walls and dispose of rubble' },
  'break_out_existing_slab':           { rate: 85,   unit: 'm²',  labour: 0.85, materials: 0.15, description: 'Break out existing concrete floor slab and dispose' },
  'cut_back_existing_finishes':        { rate: 1400, unit: 'Item',labour: 0.85, materials: 0.15, description: 'Cut back existing house wall finishes at interface with new extension' },
  'existing_wall_interface':           { rate: 1300, unit: 'Item',labour: 0.70, materials: 0.30, description: 'Existing house wall interface works: block up old garage opening, make good' },
  // Drainage
  'foul_drainage_110mm':               { rate: 2800, unit: 'Item',labour: 0.55, materials: 0.45, description: 'New 110mm foul drainage connection from extension to existing system' },
  'rainwater_drainage':                { rate: 1200, unit: 'Item',labour: 0.55, materials: 0.45, description: 'New rainwater drainage 112mm uPVC gutters and downpipes to ground' },
  'surface_water_drainage':            { rate: 65,   unit: 'm',   labour: 0.55, materials: 0.45, description: 'Surface water ground drainage around extension perimeter' },
  // Floor finishes (additional)
  'lvt_flooring_luxury':               { rate: 55,   unit: 'm²',  labour: 0.40, materials: 0.60, description: 'LVT luxury vinyl tile supply and lay Amtico/Karndean' },
  'ceramic_wall_tiles_ensuite':        { rate: 72,   unit: 'm²',  labour: 0.50, materials: 0.50, description: 'Ceramic/porcelain wall tiles to en-suite/bathroom incl. adhesive grout' },
  // Fire-rated board
  'plasterboard_fire_rated':           { rate: 52,   unit: 'm²',  labour: 0.60, materials: 0.40, description: 'Two layers 12.5mm fire-rated plasterboard to underside of staircase/party wall' },
  'plasterboard_moisture_resistant':   { rate: 42,   unit: 'm²',  labour: 0.60, materials: 0.40, description: '12.5mm moisture-resistant plasterboard to utility and wet areas' },
  // Structural steelwork & misc
  'custom_structural_steelwork':       { rate: 3500, unit: 'Item',labour: 0.50, materials: 0.50, description: 'Structural steelwork supply & fix UBs, SHS columns, base plates, bolts' },
  'structural_steelwork':              { rate: 3500, unit: 'Item',labour: 0.50, materials: 0.50, description: 'Structural steelwork supply & fix UBs, SHS columns, base plates, bolts' },
  'custom_velux_940x1178':             { rate: 1850, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Velux roof window 940x1178mm double glazed incl. flashings' },
  'custom_velux_balcony':              { rate: 3800, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Velux Cabrio balcony window system double glazed incl. flashings' },
  'custom_chipboard_first_floor':      { rate: 28,   unit: 'm²', labour: 0.45, materials: 0.55, description: '22mm moisture-resistant P5 chipboard flooring to joists' },
  'chipboard_flooring':                { rate: 28,   unit: 'm²', labour: 0.45, materials: 0.55, description: '22mm moisture-resistant P5 chipboard flooring to joists' },
  'custom_staircase':                  { rate: 4800, unit: 'Nr',  labour: 0.55, materials: 0.45, description: 'Timber staircase with newels, balusters, handrail, trimming' },
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
  'site_setup_scaffold':               { rate: 2200, unit: 'Item',labour: 0.70, materials: 0.30, description: 'Site setup hoarding scaffold incl. scaffold licence if required' },
  'skip_hire_8yd':                     { rate: 320,  unit: 'Nr',  labour: 0.10, materials: 0.90, description: 'Skip hire 8-yard' },
  'site_welfare':                      { rate: 650,  unit: 'Item',labour: 0.50, materials: 0.50, description: 'Site welfare PPE temporary power & water connection' },
  'building_control_fees':             { rate: 950,  unit: 'Item',labour: 0.00, materials: 1.00, description: 'Building Control application & inspection fees' },
  'party_wall_surveyor':               { rate: 1200, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Party Wall surveyor fee (if applicable under PWA 1996)' },
  'structural_engineer_fees':          { rate: 2200, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Structural engineer fees design & site inspections' },
  'snagging_clearance':                { rate: 650,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'Clearance & clean at completion snagging allowance' },
  // ============================================
  // INFRASTRUCTURE / UTILITIES / ESB RATES
  // ============================================
  'traffic_management_plan':           { rate: 1300, unit: 'Item',labour: 0.60, materials: 0.40, description: 'Traffic Management Plan — design, installation, hire and dismantle; including all signage, cones, barriers and liaison with Local Authority/County Council; for full duration of contract' },
  'site_fencing_hoarding':             { rate: 850,  unit: 'Item',labour: 0.60, materials: 0.40, description: 'Supply, erect and dismantle all required fencing, hoarding, road plates, pedestrian barriers and safety equipment to allow completion of works safely; including temporary lighting as required' },
  'site_establishment_utility':        { rate: 1200, unit: 'Item',labour: 0.70, materials: 0.30, description: 'Contractor\'s general site establishment; attendance on ESB Networks, school management and local authorities throughout the contract period' },
  'trench_excavation_duct':            { rate: 49.5, unit: 'm',   labour: 0.75, materials: 0.25, description: 'Excavate trench for 125mm ESB duct; average depth 1.00–1.50m; in grass/soft ground; including grading trench bottom and trimming sides; backfill with selected granular material to clause 804, compacted in 300mm layers; including non-degradable marker tape with tracer wire installed 350mm below finished surface; dispose of surplus excavated' },
  'trench_excavation_road':            { rate: 132,  unit: 'm',   labour: 0.70, materials: 0.30, description: 'Excavate trench for 125mm ESB duct; average depth 1.00–1.50m; in existing macadam road surface (approx. 180mm macadam on compacted hardcore); breaking up and lifting road surface prior to excavation; backfill with compacted granular material clause 804; reinstate road surface to match existing with 180mm bitmac and' },
  'concrete_footpath_reinstatement':   { rate: 93.5, unit: 'm',   labour: 0.65, materials: 0.35, description: 'Extra over excavation: breaking up existing 100mm concrete footpath on consolidated hardcore; cutting, lifting and disposing; reinstating with new 100mm concrete path to match existing; including formwork and curing' },
  'surface_water_disposal_excav':      { rate: 880,  unit: 'Item',labour: 0.50, materials: 0.50, description: 'Surface water disposal — pumping, bailing or other means of removing water from excavations as and when required throughout the contract period; allow provisional sum' },
  'granular_backfill_clause804':       { rate: 38.5, unit: 'm³',  labour: 0.40, materials: 0.60, description: 'Granular backfill material to clause 804 compacted in layers above sand bed' },
  'disposal_excavated_material':       { rate: 27.5, unit: 'm³',  labour: 0.60, materials: 0.40, description: 'Disposal of excavated material off site to licensed tip; including loading, transport and tipping charges; 100% bulking allowance' },
  'sand_bed_surround_duct':            { rate: 27.5, unit: 'm',   labour: 0.45, materials: 0.55, description: 'Sand bed and surround to 125mm duct; minimum 150mm bed below duct, 150mm above; compacted; for full external trench length' },
  'cable_duct_125mm':                  { rate: 38.5, unit: 'm',   labour: 0.50, materials: 0.50, description: 'ESB Networks-approved 125mm nominal diameter red-banded HDPE cable duct; laid and jointed in trench in accordance with ESB Networks specification; including all couplings, end caps and draw wire; bedded and surrounded in sand as described' },
  'duct_hole_cavity_wall':             { rate: 198,  unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Extra over 125mm cable duct: forming/cutting hole through existing blockwork cavity wall; 465mm overall thickness; nominal duct size 125mm; including making good both faces; sealing with fire-rated mortar on internal face' },
  'duct_hole_external_wall':           { rate: 132,  unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Extra over 125mm cable duct: forming/cutting hole through existing blockwork external wall; 250mm thickness; nominal duct size 125mm; including making good both faces' },
  'marker_tape_tracer_wire':           { rate: 8.8,  unit: 'm',   labour: 0.30, materials: 0.70, description: 'Non-degradable marker tape with tracer wire installed 350mm below finished surface; for full trench length' },
  'esb_mini_pillar_vault':             { rate: 4950, unit: 'Nr',  labour: 0.50, materials: 0.50, description: 'Supply and install new ESB Networks-approved Mini Pillar at site boundary; including concrete surround/base, all connections, earthing and testing; handover and commissioning with ESB Networks; no overhead poles required' },
  'esb_metering_pillar':               { rate: 2350, unit: 'Nr',  labour: 0.40, materials: 0.60, description: 'Supply and install new ESB Networks-approved Metering Pillar on school grounds at location indicated on drawing; including all connections, earthing, sealing and testing; commissioning with ESB Networks meter installer' },
  'esb_connection_provisional':        { rate: 2500, unit: 'Item',labour: 0.00, materials: 1.00, description: 'Provisional sum: ESB Networks connection charge, meter installation and commissioning fee payable directly to ESB (pass-through; to be confirmed with ESB Networks)' },
  'internal_duct_run':                 { rate: 38,   unit: 'm',   labour: 0.58, materials: 0.42, description: 'Supply and install 125mm nominal diameter ESB-approved conduit/duct through existing attic areas; run from point of entry at foundation/wall level up and through attic to main ESB distribution board; including all supports, fixings, bends, couplings, draw wire and allow for all necessary builders\' work in connection with internal duct runs' },
  'builders_work_internal_duct':       { rate: 750,  unit: 'Item',labour: 0.80, materials: 0.20, description: 'Allow for all necessary builders\' work in connection with internal duct runs; including cutting/forming penetrations through internal partitions, ceilings or structural elements as required; making good all disturbed surfaces; provisional sum' },
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
    if (desc.includes('strip out') && desc.includes('roof'))       return 2200;
    if (desc.includes('demolish') && desc.includes('wall'))        return 2800;
    if (desc.includes('break out') && desc.includes('slab'))       return 85;
    if (desc.includes('cut back') && desc.includes('finish'))      return 1400;
    if (desc.includes('existing wall') && desc.includes('interface')) return 1300;
    if (desc.includes('demolish') || desc.includes('demolition'))  return 3500;
    if (desc.includes('attic truss') || desc.includes('prefab truss')) return 12000;
    if (desc.includes('heat pump') || desc.includes('ashp'))       return 9500;
    if (desc.includes('boiler') && desc.includes('oil'))           return 4500;
    if (desc.includes('boiler') && desc.includes('system'))        return 3800;
    if (desc.includes('boiler'))                                    return 3200;
    if (desc.includes('heating') && desc.includes('extension'))    return 4200;
    if (desc.includes('consumer unit') || desc.includes('fuse board')) return 3200;
    if (desc.includes('lighting') && desc.includes('install'))     return 1800;
    if (desc.includes('power') && desc.includes('socket'))         return 1400;
    if (desc.includes('smoke') || desc.includes('heat detect'))    return 850;
    if (desc.includes('stair') && desc.includes('opening'))        return 750;
    if (desc.includes('staircase') || desc.includes('stair'))      return 4800;
    if (desc.includes('kitchen') && desc.includes('high'))         return 15000;
    if (desc.includes('kitchen'))                                   return 8500;
    if (desc.includes('bathroom') && desc.includes('high'))        return 8500;
    if (desc.includes('bathroom') || desc.includes('en-suite') || desc.includes('ensuite')) return 5500;
    if (desc.includes('shower room') || desc.includes('shower-room')) return 4200;
    if (desc.includes('cloakroom') || desc.includes('wc room'))    return 2800;
    if (desc.includes('velux') && desc.includes('balcon'))          return 4200;
    if (desc.includes('velux') || desc.includes('rooflight') || desc.includes('skylight')) return 1450;
    if (desc.includes('sash') && desc.includes('replac'))          return 1800;
    if (desc.includes('sash') && desc.includes('overhaul'))        return 650;
    if (desc.includes('secondary glaz'))                            return 450;
    if (desc.includes('door') && desc.includes('bi-fold') && (desc.includes('large') || desc.includes('4m') || desc.includes('5m'))) return 4500;
    if (desc.includes('door') && desc.includes('bi-fold') && (desc.includes('small') || desc.includes('2 panel') || desc.includes('1.7') || desc.includes('1.8'))) return 2500;
    if (desc.includes('door') && desc.includes('bi-fold'))         return 3200;
    if (desc.includes('door') && desc.includes('front') && desc.includes('heritage')) return 2200;
    if (desc.includes('door') && desc.includes('external'))        return 1250;
    if (desc.includes('door') && desc.includes('refurb'))          return 350;
    if (desc.includes('door') && desc.includes('glaz'))            return 480;
    if (desc.includes('door'))                                      return 380;
    if (desc.includes('vent panel') || desc.includes('vent light')) return 380;
    if (desc.includes('casement'))                                  return 650;
    if (desc.includes('window') && desc.includes('small'))         return 350;
    if (desc.includes('window') && (desc.includes('large') || desc.includes('1800') || desc.includes('1500'))) return 580;
    if (desc.includes('window'))                                    return 450;
    if (desc.includes('steel') || desc.includes('structural'))     return 3500;
    if (desc.includes('cylinder') || desc.includes('tank'))        return 1200;
    if (desc.includes('chimney') && desc.includes('rebuild'))      return 4500;
    if (desc.includes('chimney'))                                   return 2500;
    if (desc.includes('radiator') && desc.includes('column'))      return 650;
    if (desc.includes('radiator'))                                  return 380;
    if (desc.includes('ensuite') && desc.includes('plumb'))         return 3800;
    if (desc.includes('utility') && desc.includes('plumb'))        return 2500;
    if (desc.includes('foul') && desc.includes('drain'))           return 2800;
    if (desc.includes('rainwater') && desc.includes('drain'))      return 1200;
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
    if (desc.includes('roof') && desc.includes('insulation'))       return 82;
    if (desc.includes('insulation'))                                return 28;
    if (desc.includes('plasterboard') && desc.includes('fire'))    return 52;
    if (desc.includes('plasterboard') && desc.includes('moisture')) return 42;
    if (desc.includes('plasterboard') || desc.includes('skim'))    return 32;
    if (desc.includes('damp') || desc.includes('tanking'))         return 75;
    if (desc.includes('wall tile') && desc.includes('ensuite'))     return 72;
    if (desc.includes('wall tile') || desc.includes('wall tiling')) return 55;
    if (desc.includes('tile') || desc.includes('tiling'))          return 65;
    if (desc.includes('lvt') || desc.includes('luxury vinyl'))     return 55;
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
    if (desc.includes('breather membrane'))                         return 8;
    if (desc.includes('membrane') || desc.includes('dpm'))         return 8;
    if (desc.includes('osb') && desc.includes('sark'))             return 22;
    if (desc.includes('tile batten'))                               return 12;
    if (desc.includes('roof tile') || desc.includes('interlocking')) return 68;
    if (desc.includes('break out') && desc.includes('slab'))       return 85;
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
    if (desc.includes('surface water') && desc.includes('drain'))  return 65;
    if (desc.includes('drainage') || desc.includes('pipe'))        return 125;
    if (desc.includes('mastic') || desc.includes('sealant'))       return 12;
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

// GBP to EUR conversion — applied ON TOP of the Ireland location factor
// Irish construction rates are already higher (captured by the 1.10 factor)
// but currency conversion means the EUR figure is ~1.17x the GBP figure
const GBP_TO_EUR = 1.17;

function detectLocationFactor(locationStr) {
  if (!locationStr) return { factor: 1.00, label: 'default', isIreland: false };
  const loc = locationStr.toLowerCase();
  // Ireland detection — comprehensive list of Irish counties, cities, and patterns
  const irelandPattern = /dublin|cork|galway|limerick|ireland|waterford|kilkenny|wexford|wicklow|kildare|meath|louth|monaghan|cavan|longford|westmeath|offaly|laois|tipperary|clare|kerry|mayo|sligo|leitrim|roscommon|donegal|carlow|eircode|co\.\s*(dublin|cork|galway|limerick|waterford|kilkenny|wexford|wicklow|kildare|meath|louth|monaghan|cavan|longford|westmeath|offaly|laois|tipperary|clare|kerry|mayo|sligo|leitrim|roscommon|donegal|carlow)|lansborough|athlone|mullingar|tullamore|portlaoise|killarney|tralee|ennis|letterkenny|drogheda|dundalk|navan|naas|newbridge|bray|greystones|swords|malahide|clonmel|carrick|thurles|nenagh|castlebar|ballina|sligo town|boyle|ballinasloe|tuam|loughrea|oranmore/;
  if (irelandPattern.test(loc)) return { factor: 1.10, label: 'Ireland (+10%)', isIreland: true };
  if (loc.includes('london') || loc.includes('tw') || loc.includes('sw') || loc.includes('se') || loc.includes('ec') || loc.includes('wc') || loc.includes('w1') || loc.includes('e1') || loc.includes('n1') || loc.includes('nw') || loc.includes('richmond') || loc.includes('kingston') || loc.includes('wimbledon') || loc.includes('croydon')) return { factor: 1.20, label: 'London/SE (+20%)', isIreland: false };
  if (loc.includes('brighton') || loc.includes('guildford') || loc.includes('oxford') || loc.includes('cambridge') || loc.includes('surrey') || loc.includes('kent') || loc.includes('essex') || loc.includes('hertford') || loc.includes('reading')) return { factor: 1.15, label: 'South East (+15%)', isIreland: false };
  if (loc.includes('bristol') || loc.includes('bath') || loc.includes('exeter') || loc.includes('devon') || loc.includes('somerset') || loc.includes('dorset') || loc.includes('cornwall')) return { factor: 1.05, label: 'South West (+5%)', isIreland: false };
  if (loc.includes('birmingham') || loc.includes('coventry') || loc.includes('leicester') || loc.includes('nottingham') || loc.includes('derby') || loc.includes('northampton') || loc.includes('stoke')) return { factor: 1.07, label: 'Midlands (+7%)', isIreland: false };
  if (loc.includes('manchester') || loc.includes('liverpool') || loc.includes('chester') || loc.includes('lancashire') || loc.includes('cheshire')) return { factor: 0.98, label: 'North West (-2%)', isIreland: false };
  if (loc.includes('leeds') || loc.includes('sheffield') || loc.includes('york') || loc.includes('hull') || loc.includes('bradford')) return { factor: 0.97, label: 'Yorkshire (-3%)', isIreland: false };
  if (loc.includes('newcastle') || loc.includes('sunderland') || loc.includes('durham') || loc.includes('carlisle') || loc.includes('cumbria')) return { factor: 0.97, label: 'North England (-3%)', isIreland: false };
  if (loc.includes('edinburgh') || loc.includes('glasgow') || loc.includes('scotland') || loc.includes('aberdeen') || loc.includes('inverness') || loc.includes('dundee') || loc.includes('fife') || loc.includes('st andrews') || loc.includes('stirling') || loc.includes('perth') || loc.includes('falkirk') || loc.includes('paisley') || loc.includes('kilmarnock') || loc.includes('ayr')) return { factor: 1.03, label: 'Scotland (+3%)', isIreland: false };
  if (loc.includes('cardiff') || loc.includes('wales') || loc.includes('swansea') || loc.includes('newport')) return { factor: 0.96, label: 'Wales (-4%)', isIreland: false };
  return { factor: 1.00, label: 'UK average', isIreland: false };
}

/**
 * Cross-validate quantities against each other and AUTO-CORRECT impossible values.
 * Mutates items array in place — caps quantities, removes impossible items.
 * Returns { warnings, corrections } so callers know what changed.
 * This is the last line of defence before pricing.
 */
function crossValidateQuantities(items) {
  const warnings = [];
  const corrections = [];
  const byKey = {};
  for (const item of items) {
    byKey[item.key] = item;
  }

  // Helper: auto-correct a quantity and log it
  function capQty(item, maxQty, reason) {
    const oldQty = item.qty;
    item.qty = maxQty;
    const msg = `AUTO-CORRECTED: ${item.key} qty ${oldQty} → ${maxQty}. ${reason}`;
    warnings.push(msg);
    corrections.push({ key: item.key, old_qty: oldQty, new_qty: maxQty, reason });
  }

  // Helper: remove an item from the array
  function removeItem(key, reason) {
    const idx = items.findIndex(i => i.key === key);
    if (idx >= 0) {
      const removed = items.splice(idx, 1)[0];
      const msg = `AUTO-REMOVED: ${key} (was qty ${removed.qty}). ${reason}`;
      warnings.push(msg);
      corrections.push({ key, old_qty: removed.qty, new_qty: 0, reason, action: 'removed' });
      delete byKey[key];
    }
  }

  // Get total floor area from concrete slab items
  const slabItem = byKey['concrete_slab_150mm'] || byKey['concrete_slab_100mm'];
  const floorArea = slabItem ? slabItem.qty : null;

  if (floorArea && floorArea > 0) {
    const expectedPerimeter = 4 * Math.sqrt(floorArea);
    const maxWallArea = expectedPerimeter * 2.7 * 3; // 3x for generous margin

    // Auto-cap brick outer leaf
    const brickOuter = byKey['brick_outer_leaf'];
    if (brickOuter && brickOuter.qty > maxWallArea) {
      capQty(brickOuter, Math.round(maxWallArea), `Max wall area for ${floorArea}m² floor = ~${Math.round(maxWallArea)}m²`);
    }

    // Auto-cap blockwork inner leaf
    const blockInner = byKey['blockwork_inner_leaf_100mm'];
    if (blockInner && blockInner.qty > maxWallArea) {
      capQty(blockInner, Math.round(maxWallArea), `Max wall area for ${floorArea}m² floor = ~${Math.round(maxWallArea)}m²`);
    }

    // Auto-cap roof structure to 2x floor area
    const roofItem = byKey['roof_structure_cut_timber'];
    if (roofItem && roofItem.qty > floorArea * 2) {
      const capped = Math.round(floorArea * 1.3);
      capQty(roofItem, capped, `Roof capped to ${floorArea}m² × 1.3 pitch factor. Was >2x floor area`);
    }

    // Auto-cap scaffolding
    const scaffItem = byKey['scaffolding'] || byKey['scaffolding_two_storey'];
    if (scaffItem) {
      const expectedScaff = expectedPerimeter * 3;
      if (scaffItem.qty > expectedScaff * 3) {
        capQty(scaffItem, Math.round(expectedScaff * 1.5), `Scaffolding capped to elevation area ~${Math.round(expectedScaff * 1.5)}m²`);
      }
    }

    // Auto-cap plasterboard walls
    const plasterWalls = byKey['plasterboard_skim_walls'];
    if (plasterWalls && plasterWalls.qty > maxWallArea * 1.5) {
      capQty(plasterWalls, Math.round(maxWallArea * 1.2), `Plasterboard capped to ${Math.round(maxWallArea * 1.2)}m²`);
    }

    // Auto-cap ceiling area to 1.3x floor area
    const ceilingItem = byKey['plasterboard_ceilings'];
    if (ceilingItem && ceilingItem.qty > floorArea * 1.3) {
      capQty(ceilingItem, Math.round(floorArea * 1.1), `Ceiling capped to ~floor area (${Math.round(floorArea * 1.1)}m²)`);
    }
  }

  // Cavity wall ties: cap to 4 per m² of brickwork
  const tiesItem = byKey['cavity_wall_ties_ss'];
  const brickItem = byKey['brick_outer_leaf'];
  if (tiesItem && brickItem && tiesItem.qty > brickItem.qty * 6) {
    capQty(tiesItem, Math.round(brickItem.qty * 4), `Cavity ties capped to 4/m² × ${brickItem.qty}m² brickwork`);
  }

  // Cavity insulation: cap to match outer leaf
  const cavInsItem = byKey['cavity_insulation_eps'];
  if (cavInsItem && brickItem && cavInsItem.qty > brickItem.qty * 1.15) {
    capQty(cavInsItem, brickItem.qty, `Cavity insulation matched to brick outer leaf ${brickItem.qty}m²`);
  }

  // Inner leaf: cap to match outer leaf
  const blockItem = byKey['blockwork_inner_leaf_100mm'];
  if (blockItem && brickItem && blockItem.qty > brickItem.qty * 1.2) {
    capQty(blockItem, brickItem.qty, `Inner leaf matched to outer leaf ${brickItem.qty}m²`);
  }

  // DPM, insulation, hardcore: cap to match slab area
  const slabForDpm = byKey['concrete_slab_150mm'] || byKey['concrete_slab_100mm'];
  if (slabForDpm) {
    const dpmItem = byKey['dpm_1200g'];
    if (dpmItem && dpmItem.qty > slabForDpm.qty * 1.15) {
      capQty(dpmItem, slabForDpm.qty, `DPM matched to slab area ${slabForDpm.qty}m²`);
    }
    const pirItem = byKey['pir_insulation_under_slab'];
    if (pirItem && pirItem.qty > slabForDpm.qty * 1.15) {
      capQty(pirItem, slabForDpm.qty, `PIR insulation matched to slab area ${slabForDpm.qty}m²`);
    }
    const hardcoreItem = byKey['hardcore_fill'];
    if (hardcoreItem && hardcoreItem.qty > slabForDpm.qty * 1.15) {
      capQty(hardcoreItem, slabForDpm.qty, `Hardcore matched to slab area ${slabForDpm.qty}m²`);
    }
  }

  // Foundation excavation: cap to 1.5x concrete volume
  const excItem = byKey['excavation_strip_foundation'];
  const concItem = byKey['concrete_strip_foundation'];
  if (excItem && concItem && excItem.qty > concItem.qty * 2) {
    capQty(excItem, Math.round(concItem.qty * 1.5 * 10) / 10, `Excavation capped to 1.5× concrete volume (${concItem.qty}m³)`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ELECTRICAL: HARD CAP at max per circuit type (#1 source of over-pricing)
  // ═══════════════════════════════════════════════════════════════════════
  const elecCaps = [
    { key: 'lighting_installation', max: 2, label: 'Lighting circuits' },
    { key: 'power_sockets_circuit', max: 2, label: 'Power circuits' },
    { key: 'first_fix_electrical', max: 2, label: 'First fix electrical' },
    { key: 'second_fix_electrical', max: 2, label: 'Second fix electrical' },
    { key: 'consumer_unit_upgrade', max: 1, label: 'Consumer unit upgrade' },
    { key: 'smoke_heat_detection', max: 1, label: 'Smoke/heat detection' },
  ];
  for (const ec of elecCaps) {
    const item = byKey[ec.key];
    if (item && item.qty > ec.max) {
      capQty(item, ec.max, `${ec.label} capped at ${ec.max} — per CIRCUIT not per room`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ROOF: Remove duplicate structural items (mutually exclusive)
  // ═══════════════════════════════════════════════════════════════════════
  const atticTrusses = byKey['attic_trusses_prefab'];
  const cutTimberRoof = byKey['roof_structure_cut_timber'];
  if (atticTrusses && cutTimberRoof) {
    removeItem('roof_structure_cut_timber', 'Mutually exclusive with attic_trusses_prefab');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STAIRCASE: Remove if not needed (small extensions use existing stairs)
  // ═══════════════════════════════════════════════════════════════════════
  const staircaseItem = byKey['staircase'];
  if (staircaseItem && floorArea && floorArea < 60) {
    removeItem('staircase', `Extension is only ${floorArea}m² — most use existing staircase`);
    if (byKey['stair_opening_formation']) {
      removeItem('stair_opening_formation', 'Staircase removed — opening not needed either');
    }
  }
  // Cap staircase qty to 1 in any case
  if (byKey['staircase'] && byKey['staircase'].qty > 1) {
    capQty(byKey['staircase'], 1, 'Only 1 staircase needed per project');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FIT-OUTS: Cap kitchen/bathroom quantities
  // ═══════════════════════════════════════════════════════════════════════
  const fitoutCaps = [
    { key: 'kitchen_fitout_mid', max: 2 },
    { key: 'kitchen_fitout_high', max: 2 },
    { key: 'bathroom_fitout_mid', max: 3 },
    { key: 'bathroom_fitout_high', max: 3 },
    { key: 'shower_room_fitout', max: 3 },
    { key: 'wc_cloakroom_fitout', max: 2 },
  ];
  for (const fc of fitoutCaps) {
    const item = byKey[fc.key];
    if (item && item.qty > fc.max) {
      capQty(item, fc.max, `${fc.key} capped at ${fc.max} for residential`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // VELUX/ROOF WINDOWS: Cap total to reasonable count
  // ═══════════════════════════════════════════════════════════════════════
  const veluxKeys = ['velux_skylight_780x980', 'velux_skylight_940x1178', 'velux_skylight_940x978',
    'velux_balcony_940x2520', 'custom_velux_940x1178', 'custom_velux_balcony', 'motorised_rooflight'];
  let totalVelux = 0;
  for (const vk of veluxKeys) {
    if (byKey[vk]) totalVelux += byKey[vk].qty;
  }
  if (totalVelux > 6) {
    // Scale each Velux item proportionally to bring total to 6
    const veluxScale = 6 / totalVelux;
    for (const vk of veluxKeys) {
      if (byKey[vk] && byKey[vk].qty > 0) {
        const newQty = Math.max(1, Math.round(byKey[vk].qty * veluxScale));
        if (newQty < byKey[vk].qty) {
          capQty(byKey[vk], newQty, `Total Velux/roof windows was ${totalVelux} — capped proportionally to max 6 total`);
        }
      }
    }
  }

  // Count windows and doors — warn if suspiciously few
  if (floorArea && floorArea > 20) {
    const windowDoorItems = items.filter(i =>
      i.key && (i.key.includes('window') || i.key.includes('door') || i.key.includes('bifold') || i.key.includes('vent_panel'))
    );
    if (windowDoorItems.length < 3) {
      warnings.push(`Only ${windowDoorItems.length} window/door items for ${floorArea}m² floor area. Most projects have at least 4-6 openings.`);
    }
  }

  return { warnings, corrections };
}

/**
 * Detect duplicate and overlapping items that would cause double-counting.
 * Returns warnings for any items that conflict.
 */
function detectDuplicatesAndOverlaps(items) {
  const warnings = [];

  // Define conflict groups — if both sides present, it's a double-count
  const conflictRules = [
    { group: ['kitchen_fitout_mid', 'kitchen_fitout_high'], conflicts_with_desc: ['worktop', 'kitchen unit', 'kitchen cabinet', 'splashback', 'kitchen appliance'], label: 'kitchen fit-out' },
    { group: ['bathroom_fitout_mid', 'bathroom_fitout_high'], conflicts_with_desc: ['sanitaryware', 'bath ', 'basin', 'wc ', 'toilet', 'shower valve', 'bathroom tap'], label: 'bathroom fit-out' },
    { group: ['shower_room_fitout'], conflicts_with_desc: ['shower valve', 'shower screen', 'shower tray'], label: 'shower room fit-out' },
    { group: ['wc_cloakroom_fitout'], conflicts_with_desc: ['cloakroom basin', 'cloakroom wc'], label: 'WC/cloakroom fit-out' },
    { group: ['internal_decorations'], conflicts_with_keys: ['mist_coat', 'emulsion_walls_2coat', 'emulsion_ceiling', 'gloss_woodwork'], label: 'decoration' },
    { group: ['full_electrical_rewire'], conflicts_with_keys: ['first_fix_electrical', 'second_fix_electrical', 'electrical_rewire_room'], label: 'electrical' },
  ];

  const presentKeys = new Set(items.map(i => i.key));
  const allDescriptions = items.map(i => (i.description || '').toLowerCase());

  for (const rule of conflictRules) {
    const hasGroup = rule.group.some(k => presentKeys.has(k));
    if (!hasGroup) continue;

    if (rule.conflicts_with_keys) {
      const conflicting = rule.conflicts_with_keys.filter(k => presentKeys.has(k));
      if (conflicting.length > 0) {
        warnings.push(`Possible double-count in ${rule.label}: has lump-sum fit-out AND individual items (${conflicting.join(', ')}). Remove one or the other.`);
      }
    }

    if (rule.conflicts_with_desc) {
      for (const desc of allDescriptions) {
        const match = rule.conflicts_with_desc.find(d => desc.includes(d));
        if (match) {
          warnings.push(`Possible double-count in ${rule.label}: has lump-sum fit-out AND item containing "${match}". Check these are not overlapping.`);
          break;
        }
      }
    }
  }

  // Check for exact duplicate keys (same key appearing multiple times — usually wrong)
  const keyCounts = {};
  for (const item of items) {
    keyCounts[item.key] = (keyCounts[item.key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(keyCounts)) {
    // Some keys legitimately appear multiple times (e.g. different rooms)
    if (count > 1 && !['internal_door_painted_solid_core', 'internal_door_glazed', 'upvc_window_standard', 'upvc_window_small', 'upvc_window_large', 'window_obscure_small', 'window_obscure_standard', 'radiator_double_panel', 'radiator_single_panel', 'extract_fans', 'skip_hire_8yd', 'soft_strip_room', 'electrical_rewire_room'].includes(key)) {
      if (count > 2) {
        warnings.push(`Key "${key}" appears ${count} times — likely duplicated. Review and merge if same element.`);
      }
    }
  }

  return warnings;
}

/**
 * Detect project type from items to adjust validation behaviour.
 * Returns a type string so we know whether to apply residential extension caps.
 */
function detectProjectType(items) {
  const keys = new Set(items.map(i => i.key));
  const allDescs = items.map(i => (i.description || '').toLowerCase()).join(' ');

  // Infrastructure / utility project — ESB ducts, cable runs, meter pillars
  if (allDescs.includes('esb') || allDescs.includes('cable duct') || allDescs.includes('mini pillar') ||
      allDescs.includes('metering') || allDescs.includes('electrical supply') || allDescs.includes('duct installation') ||
      allDescs.includes('trench excav') || allDescs.includes('tracer wire')) {
    return 'infrastructure';
  }

  // Refurbishment — dominated by strip-out, rewire, replaster, decoration
  const stripOutCount = items.filter(i => i.key && i.key.startsWith('strip_out')).length;
  const refurbKeys = ['full_electrical_rewire', 'electrical_rewire_room', 'lime_mortar_repointing', 'lime_plaster_walls',
    'sash_window_overhaul', 'sash_window_replacement', 'damp_proofing_tanking', 'timber_treatment_spray'];
  const hasRefurbItems = refurbKeys.some(k => keys.has(k));
  if (stripOutCount >= 3 || hasRefurbItems) return 'refurbishment';

  // Commercial — larger scale, no residential fit-outs
  if (allDescs.includes('school') || allDescs.includes('office') || allDescs.includes('commercial') ||
      allDescs.includes('hospital') || allDescs.includes('church') || allDescs.includes('hotel')) {
    return 'commercial';
  }

  // Has slab/foundation = likely residential extension
  if (keys.has('concrete_slab_150mm') || keys.has('concrete_slab_100mm') || keys.has('excavation_strip_foundation')) {
    return 'residential_extension';
  }

  return 'general';
}

/**
 * Price a set of locked quantities deterministically.
 * @param {Array} lockedItems - Array of { key, description, unit, qty, override_rate? }
 * @param {string} location - Location string for uplift detection
 * @param {Object} clientRates - Client-specific rates from DB { item_key: value }
 * @param {Object} options - { contingency_pct, ohp_pct, vat_rate, currency, project_type }
 * @returns {Object} - Complete priced BOQ structure
 */
function priceLockedQuantities(lockedItems, location, clientRates = {}, options = {}) {
  const locationInfo = detectLocationFactor(location);

  // Auto-detect Ireland from location and set correct defaults
  const isIreland = locationInfo.isIreland || (options.currency === 'EUR');
  const {
    contingency_pct = 7.5,
    ohp_pct = 12,
    vat_rate = isIreland ? 13.5 : 20,
    currency = isIreland ? 'EUR' : 'GBP',
  } = options;

  // Location factor + currency conversion for Ireland (GBP base rates → EUR)
  let locFactor = locationInfo.factor;
  if (isIreland) {
    locFactor = locationInfo.factor * GBP_TO_EUR; // e.g. 1.10 × 1.17 = 1.287 total uplift
  }

  const pricedItems = [];
  const warnings = [];

  // Detect project type to control which auto-corrections apply
  const projectType = options.project_type || detectProjectType(lockedItems);
  const isResidentialExtension = projectType === 'residential_extension';

  // Cross-validate quantities — only apply residential caps for residential extensions
  let crossResult = { warnings: [], corrections: [] };
  if (isResidentialExtension) {
    crossResult = crossValidateQuantities(lockedItems);
  }
  // Detect duplicate/overlapping items
  const duplicateWarnings = detectDuplicatesAndOverlaps(lockedItems);
  warnings.push(...crossResult.warnings);
  warnings.push(...duplicateWarnings);
  if (crossResult.corrections.length > 0) {
    warnings.push(`⚡ ${crossResult.corrections.length} quantities were auto-corrected before pricing to prevent over-counting.`);
  }

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
      const currSym = currency === 'EUR' ? '€' : '£';
      warnings.push(`No base rate for '${item.key}' — used ${rateSource} rate ${currSym}${Math.round(rate * 100) / 100}/${item.unit || 'Item'}`);
    }

    // Sanity check: if AI assumed_rate looks like a total cost rather than a per-unit rate, cap it
    if (rateSource === 'ai_estimated' && item.qty > 1) {
      const itemTotal = item.qty * rate;
      // If a single line item exceeds £50k with AI-estimated rate, the rate is likely wrong
      if (itemTotal > 50000 && rate > 500) {
        const expectedRate = estimateFallbackRate(item) * locFactor;
        if (rate > expectedRate * 5) {
          const cSym = currency === 'EUR' ? '€' : '£';
          warnings.push(`Rate for '${item.key}' looks too high (${cSym}${Math.round(rate)}/${item.unit || 'Item'} × ${item.qty} = ${cSym}${Math.round(itemTotal).toLocaleString()}). Using fallback rate ${cSym}${Math.round(expectedRate * 100) / 100}/${item.unit || 'Item'} instead.`);
          rate = expectedRate;
          rateSource = 'fallback_corrected';
        }
      }
    }

    const baseRate = BASE_RATES[item.key] || { labour: 0.5, materials: 0.5, description: item.description };
    const total = Math.round(item.qty * rate * 100) / 100;
    const labour = Math.round(total * baseRate.labour * 100) / 100;
    const materials = Math.round(total * baseRate.materials * 100) / 100;

    // Build the best possible description:
    // 1) Use AI description if it's detailed (>60 chars) — it likely includes project-specific specs
    // 2) Otherwise prefer BASE_RATES description which has standard specs
    // 3) Fallback to whatever we have
    let bestDescription = item.description || baseRate.description || item.key;
    if (baseRate.description && item.description && item.description.length < 60 && baseRate.description.length > item.description.length) {
      // AI gave a sparse description but we have a richer one in the rate library
      bestDescription = baseRate.description;
    }

    // Flag individual items with suspiciously high totals
    const cs = currency === 'EUR' ? '€' : '£';
    if (total > 25000) {
      warnings.push(`High-value item: '${bestDescription}' = ${cs}${Math.round(total).toLocaleString()} (${item.qty} ${item.unit || 'Item'} × ${cs}${Math.round(rate * 100) / 100}) — please verify qty and rate`);
    }

    pricedItems.push({
      key: item.key,
      item_ref: item.item_ref || '',
      description: bestDescription,
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

  let constructionTotal = sectionTotals.reduce((s, sec) => s + sec.subtotal, 0);

  // Post-pricing cost/m² sanity check — estimate floor area from slab items
  const slabItems = pricedItems.filter(i => i.key === 'concrete_slab_150mm' || i.key === 'concrete_slab_100mm');
  const estimatedFloorArea = slabItems.reduce((s, i) => s + i.qty, 0);
  if (estimatedFloorArea > 0) {
    const costPerM2 = constructionTotal / estimatedFloorArea;
    // UK residential extensions typically cost £1,800-£3,000/m² construction only
    // Hard cap at £3,500/m² — if above this, scale ALL items down proportionally
    if (costPerM2 > 3500 && isResidentialExtension) {
      const targetCostPerM2 = 2800; // middle of typical range
      const scaleFactor = (targetCostPerM2 * estimatedFloorArea) / constructionTotal;
      const cs = currency === 'EUR' ? '€' : '£';
      warnings.push(`COST CAP APPLIED: Construction was ${cs}${Math.round(costPerM2).toLocaleString()}/m² (${estimatedFloorArea.toFixed(1)}m² floor area), exceeds ${cs}3,500/m² cap. All items scaled by ${(scaleFactor * 100).toFixed(0)}% to bring to ~${cs}${targetCostPerM2}/m².`);

      // Scale down every item total proportionally
      for (const item of pricedItems) {
        const labourShare = (item.labour + item.materials > 0) ? item.labour / (item.labour + item.materials) : 0.5;
        item.rate = Math.round(item.rate * scaleFactor * 100) / 100;
        item.total = Math.round(item.qty * item.rate * 100) / 100;
        item.labour = Math.round(item.total * labourShare * 100) / 100;
        item.materials = Math.round((item.total - item.labour) * 100) / 100;
      }

      // Recalculate construction total after scaling
      constructionTotal = sectionTotals.reduce((s, sec) => {
        sec.subtotal = sec.items.reduce((ss, i) => ss + i.total, 0);
        return s + sec.subtotal;
      }, 0);
    }
  }

  const contingency = Math.round(constructionTotal * (contingency_pct / 100) * 100) / 100;
  const netTotal = constructionTotal + contingency;
  const ohp = Math.round(constructionTotal * (ohp_pct / 100) * 100) / 100;
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
    project_type: projectType,
    warnings,
    corrections: crossResult.corrections,
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
    items: sec.items.map((item, ii) => {
      // Format working field to match professional BOQ style
      let formattedWorking = '';
      if (item.working) {
        // If working already starts with "(As specified:" or "(Calculated:", use as-is
        const w = item.working.trim();
        if (w.startsWith('(')) {
          formattedWorking = `\n  ${w}`;
        } else if (w.toLowerCase().startsWith('as specified')) {
          formattedWorking = `\n  (${w})`;
        } else {
          formattedWorking = `\n  (${w})`;
        }
      }
      return {
      item: `${si + 1}.${ii + 1}`,
      description: item.description + formattedWorking,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      labour: item.labour,
      materials: item.materials,
      total: item.total,
      rate_source: item.rate_source,
    };
    }),
  }));
}

function getBaseRate(key) {
  return BASE_RATES[key] || null;
}

module.exports = { priceLockedQuantities, toPricedSections, detectLocationFactor, getBaseRate, BASE_RATES, LOCATION_FACTORS };

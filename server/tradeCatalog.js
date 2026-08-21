// Trade catalogue — server/tradeCatalog.js
//
// Powers the onboarding trade picker (live search over names + aliases) and
// the qualifying questions asked once a trade is chosen. Questions are defined
// here, server-side, so the onboarding screen, the saved submission and the
// admin download all agree on what was asked without a second copy in the UI.
//
// Every trade gets the COMMON questions (experience, team, area, job size,
// day rate). Trades we know well also get their own specialisms and
// certification options; anything typed in that we don't recognise falls back
// to the common set with generic certifications — a custom trade must never
// dead-end the flow.

const COMMON_CERTS = ['CSCS card', 'Public liability insurance', 'VAT registered', 'Constructionline / CHAS'];

// name, aliases (lowercase, for search), then optional:
// certs (single-trade certifications), specialisms, dayRate (prefill £/day).
const TRADES = [
  { name: 'General builder', aliases: ['building contractor', 'main contractor', 'builder'], dayRate: 280,
    specialisms: ['Extensions', 'Refurbishment', 'New builds', 'Structural work', 'Insurance work'] },
  { name: 'Extensions & renovations', aliases: ['extension specialist', 'renovations', 'refurbishment'], dayRate: 280,
    specialisms: ['Single-storey extensions', 'Double-storey extensions', 'Open-plan knock-throughs', 'Full refurbishment'] },
  { name: 'Loft conversion specialist', aliases: ['loft', 'attic conversion', 'dormer'], dayRate: 280,
    specialisms: ['Dormer', 'Hip-to-gable', 'Mansard', 'Velux / rooflight'] },
  { name: 'Electrician', aliases: ['sparky', 'electrical contractor', 'electrics'], dayRate: 360,
    certs: ['NICEIC', 'NAPIT', '18th Edition', 'Part P registered'],
    specialisms: ['Rewires', 'Consumer units', 'EV chargers', 'Solar PV', 'Fire alarms', 'EICR / landlord certificates', 'Data & networking'] },
  { name: 'Plumber', aliases: ['plumbing'], dayRate: 340,
    certs: ['Gas Safe registered', 'WaterSafe / WIAPS', 'Unvented (G3)'],
    specialisms: ['Bathrooms', 'Boilers & heating', 'Underfloor heating', 'Water mains & drainage', 'Leak detection'] },
  { name: 'Heating engineer', aliases: ['gas engineer', 'boiler engineer', 'hvac'], dayRate: 340,
    certs: ['Gas Safe registered', 'OFTEC (oil)', 'Unvented (G3)', 'MCS (heat pumps)'],
    specialisms: ['Boiler installs', 'Heat pumps', 'Underfloor heating', 'Servicing & repair', 'Commercial heating'] },
  { name: 'Carpenter / joiner', aliases: ['carpentry', 'joinery', 'chippy'], dayRate: 280,
    specialisms: ['First & second fix', 'Kitchens', 'Staircases', 'Bespoke joinery', 'Doors & windows', 'Roof carpentry'] },
  { name: 'Roofer', aliases: ['roofing contractor', 'roofing'], dayRate: 300,
    certs: ['NFRC member', 'CompetentRoofer'],
    specialisms: ['Pitched (tile/slate)', 'Flat (felt/GRP/EPDM)', 'Leadwork', 'Fascias & guttering', 'Roof repairs'] },
  { name: 'Plasterer', aliases: ['plastering', 'skimming'], dayRate: 280,
    specialisms: ['Skimming', 'Float & set', 'External render', 'Venetian / polished', 'Coving'] },
  { name: 'Bricklayer', aliases: ['brickwork', 'brickie', 'blockwork'], dayRate: 300,
    specialisms: ['Extensions', 'Garden walls', 'Repointing', 'Chimneys', 'New build packages'] },
  { name: 'Groundworker', aliases: ['groundworks', 'foundations', 'excavation'], dayRate: 300,
    specialisms: ['Foundations', 'Drainage', 'Slabs & oversites', 'Retaining walls', 'Utilities & ducting'] },
  { name: 'Landscaper', aliases: ['landscaping', 'garden design', 'gardener'], dayRate: 260,
    specialisms: ['Patios & paving', 'Decking', 'Fencing', 'Turfing & planting', 'Garden rooms'] },
  { name: 'Tiler', aliases: ['tiling', 'wall and floor tiling'], dayRate: 260,
    specialisms: ['Bathrooms', 'Kitchens', 'Large-format & porcelain', 'Natural stone', 'Commercial floors'] },
  { name: 'Painter & decorator', aliases: ['painting', 'decorating', 'decorator'], dayRate: 220,
    specialisms: ['Interior', 'Exterior', 'Wallpapering', 'Spraying', 'Commercial'] },
  { name: 'Kitchen fitter', aliases: ['kitchen installer', 'kitchens'], dayRate: 280 },
  { name: 'Bathroom fitter', aliases: ['bathroom installer', 'bathrooms', 'wetroom'], dayRate: 280 },
  { name: 'Window & door installer', aliases: ['windows', 'glazing installer', 'double glazing', 'doors'], dayRate: 260,
    certs: ['FENSA', 'CERTASS'] },
  { name: 'Glazier', aliases: ['glass', 'glazing'], dayRate: 260 },
  { name: 'Scaffolder', aliases: ['scaffolding'], dayRate: 300, certs: ['CISRS', 'TG20/TG30 compliant'] },
  { name: 'Steel fabricator / erector', aliases: ['structural steel', 'steelwork', 'welding'], dayRate: 320 },
  { name: 'Damp proofing specialist', aliases: ['damp', 'timber treatment', 'waterproofing'], dayRate: 280, certs: ['PCA member', 'CSSW (waterproofing)'] },
  { name: 'Flooring installer', aliases: ['floor layer', 'flooring', 'carpet fitter', 'lvt'], dayRate: 240 },
  { name: 'Drylining / ceilings', aliases: ['drylining', 'suspended ceilings', 'partitions', 'plasterboard'], dayRate: 260 },
  { name: 'Rendering / external wall insulation', aliases: ['render', 'ewi', 'monocouche', 'k-rend'], dayRate: 280 },
  { name: 'Demolition contractor', aliases: ['demolition', 'strip out', 'soft strip'], dayRate: 300 },
  { name: 'Driveways & paving', aliases: ['driveway', 'block paving', 'resin', 'tarmac'], dayRate: 260 },
  { name: 'Fencing contractor', aliases: ['fencing', 'gates'], dayRate: 240 },
  { name: 'Guttering & fascias', aliases: ['gutters', 'soffits', 'upvc roofline'], dayRate: 240 },
  { name: 'Insulation installer', aliases: ['insulation', 'cavity wall', 'loft insulation'], dayRate: 240 },
  { name: 'Air conditioning / ventilation', aliases: ['aircon', 'ac engineer', 'mvhr', 'ventilation'], dayRate: 320, certs: ['F-Gas certified'] },
  { name: 'Solar PV installer', aliases: ['solar', 'pv', 'renewables', 'battery storage'], dayRate: 320, certs: ['MCS', 'NICEIC'] },
  { name: 'EV charger installer', aliases: ['ev charging', 'car charger'], dayRate: 320, certs: ['OZEV approved', 'NICEIC'] },
  { name: 'Drainage specialist', aliases: ['drains', 'cctv survey', 'soakaway'], dayRate: 300 },
  { name: 'Basement conversion specialist', aliases: ['basement', 'cellar conversion', 'underpinning'], dayRate: 320 },
  { name: 'Shopfitter', aliases: ['shopfitting', 'commercial fit-out', 'fit out'], dayRate: 300 },
  { name: 'Stonemason', aliases: ['stonework', 'masonry', 'stone'], dayRate: 300 },
  { name: 'Locksmith', aliases: ['locks', 'security'], dayRate: 240 },
  { name: 'Handyman', aliases: ['handyperson', 'odd jobs', 'property maintenance'], dayRate: 220 },
  { name: 'Quantity surveyor / estimator', aliases: ['qs', 'quantity surveying', 'estimating', 'cost consultant'], dayRate: 400,
    certs: ['MRICS / FRICS', 'AssocRICS', 'CIOB'],
    specialisms: ['Residential', 'Commercial', 'Civils', 'Contractor-side', 'Client-side / PQS'] },
  { name: 'Architect / architectural services', aliases: ['architecture', 'architectural technician', 'drawings'], dayRate: 400, certs: ['ARB registered', 'RIBA chartered', 'CIAT'] },
];

// The usual jobs each trade prices, offered as an optional rate sheet during
// onboarding. `typical` is a placeholder shown greyed in the input, never
// prefilled: a figure the builder types becomes THEIR rate in the library;
// anything left blank simply isn't saved, so pricing falls back to the
// generic UK rates until they tell us otherwise. Units ride into the rate
// library verbatim. Trades without a list here just get the day-rate question.
const RATE_ITEMS = {
  'General builder': [
    { key: 'single_storey_extension_m2', label: 'Single-storey extension', unit: '£/m²', typical: 2200 },
    { key: 'double_storey_extension_m2', label: 'Double-storey extension', unit: '£/m²', typical: 1900 },
    { key: 'garage_conversion_m2', label: 'Garage conversion', unit: '£/m²', typical: 1200 },
    { key: 'knock_through_rsj', label: 'Knock-through incl. steel (RSJ)', unit: '£/job', typical: 1900 },
    { key: 'full_refurb_m2', label: 'Full refurbishment', unit: '£/m²', typical: 950 },
    { key: 'patio_laid_m2', label: 'Patio laid', unit: '£/m²', typical: 120 },
  ],
  'Extensions & renovations': [
    { key: 'single_storey_extension_m2', label: 'Single-storey extension', unit: '£/m²', typical: 2200 },
    { key: 'double_storey_extension_m2', label: 'Double-storey extension', unit: '£/m²', typical: 1900 },
    { key: 'garage_conversion_m2', label: 'Garage conversion', unit: '£/m²', typical: 1200 },
    { key: 'knock_through_rsj', label: 'Knock-through incl. steel (RSJ)', unit: '£/job', typical: 1900 },
    { key: 'full_refurb_m2', label: 'Full refurbishment', unit: '£/m²', typical: 950 },
    { key: 'kitchen_diner_openup', label: 'Kitchen-diner opening-up', unit: '£/job', typical: 4500 },
  ],
  'Loft conversion specialist': [
    { key: 'dormer_loft_conversion', label: 'Dormer loft conversion', unit: '£/job', typical: 48000 },
    { key: 'velux_loft_conversion', label: 'Velux / rooflight conversion', unit: '£/job', typical: 30000 },
    { key: 'hip_to_gable_conversion', label: 'Hip-to-gable conversion', unit: '£/job', typical: 55000 },
    { key: 'mansard_conversion', label: 'Mansard conversion', unit: '£/job', typical: 65000 },
    { key: 'loft_ensuite_addon', label: 'En-suite added to a loft', unit: '£/job', typical: 6500 },
  ],
  'Electrician': [
    { key: 'rewire_3bed', label: 'Full rewire — 3-bed house', unit: '£/job', typical: 3800 },
    { key: 'consumer_unit_replacement', label: 'Consumer unit replacement', unit: '£/job', typical: 550 },
    { key: 'double_socket_installed', label: 'Double socket added', unit: '£/point', typical: 90 },
    { key: 'downlight_fitted', label: 'Downlight fitted', unit: '£/point', typical: 65 },
    { key: 'eicr_3bed', label: 'EICR — 3-bed house', unit: '£/job', typical: 180 },
    { key: 'ev_charger_install', label: 'EV charger installed', unit: '£/job', typical: 950 },
    { key: 'outside_light_fitted', label: 'Outside light fitted', unit: '£/point', typical: 120 },
  ],
  'Plumber': [
    { key: 'bathroom_install', label: 'Full bathroom installed', unit: '£/job', typical: 4500 },
    { key: 'combi_boiler_swap', label: 'Combi boiler swap', unit: '£/job', typical: 2400 },
    { key: 'radiator_replaced', label: 'Radiator replaced', unit: '£/item', typical: 220 },
    { key: 'toilet_basin_installed', label: 'Toilet & basin installed', unit: '£/job', typical: 400 },
    { key: 'outside_tap_fitted', label: 'Outside tap fitted', unit: '£/job', typical: 120 },
    { key: 'shower_installed', label: 'Shower installed', unit: '£/job', typical: 650 },
  ],
  'Heating engineer': [
    { key: 'combi_boiler_install', label: 'Combi boiler installed', unit: '£/job', typical: 2400 },
    { key: 'system_boiler_install', label: 'System boiler installed', unit: '£/job', typical: 2900 },
    { key: 'heat_pump_install', label: 'Air-source heat pump installed', unit: '£/job', typical: 9500 },
    { key: 'radiator_replaced', label: 'Radiator replaced', unit: '£/item', typical: 220 },
    { key: 'power_flush', label: 'Power flush', unit: '£/job', typical: 450 },
    { key: 'boiler_service', label: 'Boiler service', unit: '£/job', typical: 95 },
  ],
  'Carpenter / joiner': [
    { key: 'internal_door_hung', label: 'Internal door hung', unit: '£/door', typical: 120 },
    { key: 'skirting_fitted_lm', label: 'Skirting fitted', unit: '£/lm', typical: 14 },
    { key: 'kitchen_fitted', label: 'Kitchen fitted (units & worktops)', unit: '£/job', typical: 1600 },
    { key: 'staircase_supplied_fitted', label: 'Staircase supplied & fitted', unit: '£/job', typical: 3500 },
    { key: 'decking_laid_m2', label: 'Decking laid', unit: '£/m²', typical: 160 },
    { key: 'stud_wall_built_m2', label: 'Stud wall built & boarded', unit: '£/m²', typical: 55 },
  ],
  'Roofer': [
    { key: 'retile_pitched_m2', label: 'Re-tile pitched roof', unit: '£/m²', typical: 95 },
    { key: 'flat_roof_grp_m2', label: 'Flat roof — GRP/fibreglass', unit: '£/m²', typical: 110 },
    { key: 'flat_roof_epdm_m2', label: 'Flat roof — EPDM rubber', unit: '£/m²', typical: 90 },
    { key: 'ridge_rebedded_lm', label: 'Ridge re-bedded', unit: '£/lm', typical: 45 },
    { key: 'fascias_soffits_gutters_lm', label: 'Fascias, soffits & guttering', unit: '£/lm', typical: 100 },
    { key: 'chimney_repointed', label: 'Chimney repointed', unit: '£/job', typical: 500 },
    { key: 'lead_flashing_lm', label: 'Lead flashing', unit: '£/lm', typical: 65 },
  ],
  'Plasterer': [
    { key: 'skim_walls_m2', label: 'Skim over existing', unit: '£/m²', typical: 18 },
    { key: 'overboard_skim_m2', label: 'Overboard & skim', unit: '£/m²', typical: 28 },
    { key: 'float_set_m2', label: 'Float & set (hard plaster)', unit: '£/m²', typical: 32 },
    { key: 'external_render_m2', label: 'External render', unit: '£/m²', typical: 60 },
    { key: 'coving_fitted_lm', label: 'Coving fitted', unit: '£/lm', typical: 12 },
    { key: 'ceiling_skimmed', label: 'Ceiling skimmed (average room)', unit: '£/job', typical: 260 },
  ],
  'Bricklayer': [
    { key: 'facing_brickwork_m2', label: 'Facing brickwork', unit: '£/m²', typical: 75 },
    { key: 'blockwork_m2', label: 'Blockwork', unit: '£/m²', typical: 45 },
    { key: 'garden_wall_m2', label: 'Garden wall', unit: '£/m²', typical: 110 },
    { key: 'repointing_m2', label: 'Repointing', unit: '£/m²', typical: 40 },
    { key: 'chimney_rebuild', label: 'Chimney rebuilt (above roofline)', unit: '£/job', typical: 1600 },
  ],
  'Groundworker': [
    { key: 'strip_footings_m3', label: 'Strip footings dug & poured', unit: '£/m³', typical: 220 },
    { key: 'concrete_slab_m2', label: 'Concrete slab / oversite', unit: '£/m²', typical: 85 },
    { key: 'drainage_lm', label: 'Drainage laid', unit: '£/lm', typical: 95 },
    { key: 'block_paving_m2', label: 'Block paving', unit: '£/m²', typical: 95 },
    { key: 'retaining_wall_m2', label: 'Retaining wall', unit: '£/m²', typical: 220 },
  ],
  'Landscaper': [
    { key: 'porcelain_patio_m2', label: 'Porcelain patio laid', unit: '£/m²', typical: 180 },
    { key: 'sandstone_patio_m2', label: 'Sandstone patio laid', unit: '£/m²', typical: 140 },
    { key: 'decking_laid_m2', label: 'Decking laid', unit: '£/m²', typical: 160 },
    { key: 'turf_laid_m2', label: 'Turf laid', unit: '£/m²', typical: 28 },
    { key: 'closeboard_fencing_lm', label: 'Close-board fencing', unit: '£/lm', typical: 95 },
    { key: 'sleeper_bed_lm', label: 'Sleeper raised bed', unit: '£/lm', typical: 110 },
  ],
  'Tiler': [
    { key: 'wall_tiling_m2', label: 'Wall tiling', unit: '£/m²', typical: 45 },
    { key: 'floor_tiling_m2', label: 'Floor tiling', unit: '£/m²', typical: 55 },
    { key: 'large_format_tiling_m2', label: 'Large-format / porcelain', unit: '£/m²', typical: 70 },
    { key: 'natural_stone_tiling_m2', label: 'Natural stone', unit: '£/m²', typical: 85 },
    { key: 'bathroom_tiled', label: 'Bathroom fully tiled', unit: '£/job', typical: 1400 },
  ],
  'Painter & decorator': [
    { key: 'room_painted', label: 'Room painted (walls & ceiling)', unit: '£/room', typical: 350 },
    { key: 'walls_only_m2', label: 'Walls only', unit: '£/m²', typical: 9 },
    { key: 'woodwork_lm', label: 'Woodwork glossed', unit: '£/lm', typical: 8 },
    { key: 'wallpaper_hung_roll', label: 'Wallpaper hung', unit: '£/roll', typical: 60 },
    { key: 'exterior_masonry_m2', label: 'Exterior masonry painted', unit: '£/m²', typical: 14 },
    { key: 'front_door_painted', label: 'Front door painted', unit: '£/job', typical: 180 },
  ],
  'Kitchen fitter': [
    { key: 'kitchen_fitted_standard', label: 'Standard kitchen fitted', unit: '£/job', typical: 1800 },
    { key: 'kitchen_fitted_large', label: 'Large / bespoke kitchen fitted', unit: '£/job', typical: 3200 },
    { key: 'worktop_fitted_lm', label: 'Worktop fitted', unit: '£/lm', typical: 90 },
    { key: 'appliance_installed', label: 'Appliance installed', unit: '£/item', typical: 90 },
  ],
  'Bathroom fitter': [
    { key: 'bathroom_refit_full', label: 'Full bathroom refit', unit: '£/job', typical: 5500 },
    { key: 'shower_installed', label: 'Shower installed', unit: '£/job', typical: 650 },
    { key: 'wetroom_conversion', label: 'Wetroom conversion', unit: '£/job', typical: 8500 },
    { key: 'ensuite_installed', label: 'En-suite installed', unit: '£/job', typical: 4200 },
  ],
  'Window & door installer': [
    { key: 'upvc_window_installed', label: 'uPVC window installed', unit: '£/window', typical: 650 },
    { key: 'composite_door_installed', label: 'Composite front door installed', unit: '£/job', typical: 1600 },
    { key: 'french_doors_installed', label: 'French / patio doors installed', unit: '£/job', typical: 1900 },
    { key: 'bay_window_installed', label: 'Bay window installed', unit: '£/job', typical: 2400 },
  ],
  'Scaffolder': [
    { key: 'scaffold_single_elevation', label: 'Single elevation', unit: '£/job', typical: 750 },
    { key: 'scaffold_full_wrap_3bed', label: 'Full wrap — 3-bed house', unit: '£/job', typical: 1900 },
    { key: 'scaffold_tower_week', label: 'Tower hire', unit: '£/week', typical: 250 },
    { key: 'scaffold_chimney', label: 'Chimney scaffold', unit: '£/job', typical: 900 },
  ],
  'Drylining / ceilings': [
    { key: 'metal_stud_partition_m2', label: 'Metal stud partition', unit: '£/m²', typical: 60 },
    { key: 'suspended_ceiling_m2', label: 'Suspended ceiling', unit: '£/m²', typical: 45 },
    { key: 'mf_ceiling_m2', label: 'MF plasterboard ceiling', unit: '£/m²', typical: 55 },
    { key: 'tape_joint_m2', label: 'Tape & joint', unit: '£/m²', typical: 12 },
  ],
  'Rendering / external wall insulation': [
    { key: 'monocouche_render_m2', label: 'Monocouche / through-colour render', unit: '£/m²', typical: 70 },
    { key: 'sand_cement_render_m2', label: 'Sand & cement render', unit: '£/m²', typical: 55 },
    { key: 'ewi_system_m2', label: 'External wall insulation system', unit: '£/m²', typical: 110 },
  ],
  'Driveways & paving': [
    { key: 'block_paving_drive_m2', label: 'Block paving driveway', unit: '£/m²', typical: 110 },
    { key: 'resin_bound_drive_m2', label: 'Resin-bound driveway', unit: '£/m²', typical: 120 },
    { key: 'tarmac_drive_m2', label: 'Tarmac driveway', unit: '£/m²', typical: 75 },
    { key: 'gravel_drive_m2', label: 'Gravel driveway', unit: '£/m²', typical: 50 },
  ],
  'Fencing contractor': [
    { key: 'closeboard_fencing_lm', label: 'Close-board fencing', unit: '£/lm', typical: 95 },
    { key: 'panel_fencing_lm', label: 'Panel fencing', unit: '£/lm', typical: 70 },
    { key: 'gate_hung', label: 'Garden gate supplied & hung', unit: '£/job', typical: 350 },
  ],
  'Flooring installer': [
    { key: 'lvt_fitted_m2', label: 'LVT fitted', unit: '£/m²', typical: 35 },
    { key: 'laminate_fitted_m2', label: 'Laminate fitted', unit: '£/m²', typical: 22 },
    { key: 'engineered_wood_m2', label: 'Engineered wood fitted', unit: '£/m²', typical: 45 },
    { key: 'carpet_fitted_m2', label: 'Carpet fitted', unit: '£/m²', typical: 12 },
    { key: 'screed_levelling_m2', label: 'Levelling compound / screed', unit: '£/m²', typical: 18 },
  ],
  'Solar PV installer': [
    { key: 'solar_4kw_system', label: '4kW panel system installed', unit: '£/job', typical: 6500 },
    { key: 'battery_storage_installed', label: 'Battery storage added', unit: '£/job', typical: 3000 },
    { key: 'solar_panel_extra', label: 'Additional panel', unit: '£/item', typical: 450 },
  ],
};

// Questions asked for every trade, in screen order. type: 'pills' (single),
// 'pills-multi', 'text', 'number' (with unit). day_rate is prefilled from the
// trade's typical figure and feeds the rate library on save.
function commonQuestions(trade) {
  return [
    { id: 'years_trading', label: 'How long have you been at it?', type: 'pills',
      options: ['Just starting out', '1–3 years', '3–10 years', '10+ years'] },
    { id: 'team_size', label: 'How big is the team?', type: 'pills',
      options: ['Just me', '2–5', '6–15', '16+'] },
    { id: 'regions', label: 'Where do you work?', desc: 'A town, county or region.',
      type: 'text', placeholder: 'e.g. Manchester and the North West' },
    { id: 'typical_job_value', label: 'Typical job value?', type: 'pills',
      options: ['Under £5k', '£5k – £25k', '£25k – £100k', '£100k – £500k', '£500k+'] },
    { id: 'day_rate', label: 'Your day rate', desc: 'What a day of your labour costs a customer. Feeds every estimate — change it any time from My Rates.',
      type: 'number', unit: '£/day', default: trade && trade.dayRate ? trade.dayRate : 280 },
  ];
}

function normalise(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s/&-]/g, '').trim();
}

function findTrade(name) {
  const q = normalise(name);
  if (!q) return null;
  return TRADES.find(t => normalise(t.name) === q)
    || TRADES.find(t => t.aliases.some(a => normalise(a) === q))
    || null;
}

// Live-search ranking: prefix match on the name first, then prefix on an
// alias, then substring anywhere. Stable within each band.
function searchTrades(query, limit = 8) {
  const q = normalise(query);
  if (!q) return TRADES.slice(0, limit).map(t => t.name);
  const bands = [[], [], []];
  for (const t of TRADES) {
    const name = normalise(t.name);
    if (name.startsWith(q)) bands[0].push(t.name);
    else if (t.aliases.some(a => normalise(a).startsWith(q))) bands[1].push(t.name);
    else if (name.includes(q) || t.aliases.some(a => normalise(a).includes(q))) bands[2].push(t.name);
  }
  return bands.flat().slice(0, limit);
}

// The full question set for a trade name — common questions plus the trade's
// specialisms/certifications where we have them. Unknown trades get the
// common set with generic certifications, so a typed-in trade still works.
function getQuestionsForTrade(name) {
  const trade = findTrade(name);
  const questions = commonQuestions(trade);
  if (trade && trade.specialisms) {
    questions.push({ id: 'specialisms', label: 'What kind of work do you take on?', desc: 'Select all that apply.',
      type: 'pills-multi', options: trade.specialisms });
  }
  questions.push({ id: 'certifications', label: 'Certifications & accreditations', desc: 'Select all that apply.',
    type: 'pills-multi', options: [...(trade && trade.certs ? trade.certs : []), ...COMMON_CERTS] });
  return questions;
}

// The optional rate sheet for a trade — the usual jobs with typical figures
// as placeholders. Unknown trades get none (their day rate still saves).
function getRateItemsForTrade(name) {
  const trade = findTrade(name);
  return (trade && RATE_ITEMS[trade.name]) || [];
}

module.exports = { TRADES, RATE_ITEMS, searchTrades, findTrade, getQuestionsForTrade, getRateItemsForTrade };

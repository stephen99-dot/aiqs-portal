// Trade catalogue — server/tradeCatalog.js
//
// Powers the onboarding trade picker (live search over names + aliases), the
// qualifying questions asked once a trade is chosen, and the trade's rate
// sheet. Everything is defined here, server-side, so the onboarding screen,
// the saved submission and the admin download all agree on what was asked
// without a second copy in the UI.
//
// Three things come out of it:
//
//   getQuestionsForTrade(name)  The question set, in screen order. Every
//                               question carries a `section`: 'business'
//                               (who they are, what they take on) or
//                               'pricing' (day rate, how they price, terms).
//                               Known trades add their specialisms and
//                               certifications; a typed-in trade we don't
//                               recognise still gets the common set, so a
//                               custom trade never dead-ends the flow.
//
//   getRateSheetForTrade(name)  The rate sheet as groups of items. Every trade
//                               (custom ones included) gets a Labour group
//                               derived from its day rate and, for site
//                               trades, a Preliminaries group; known trades
//                               add their own groups — the jobs that trade
//                               prices every week, with a typical UK figure
//                               as a placeholder. Nothing is prefilled: a
//                               figure the builder types becomes THEIR rate
//                               in the library; a blank is simply not saved
//                               and pricing falls back to the generic rates.
//
//   getRateItemsForTrade(name)  The same sheet flattened, each item tagged
//                               with its group title — for the save path and
//                               the admin download.
//
// Item keys that match a key in the pricer's base library (BASE_RATES in
// deterministicPricer.js) are deliberate: a rate saved under such a key is
// read straight by the pricer for that line. They are only reused where the
// unit AND the scope match (supply & fit per m², per door, per skip…), because
// a client rate more than 5x or less than 0.1x the base is rejected as corrupt.

const COMMON_CERTS = ['CSCS card', 'Public liability insurance', 'VAT registered', 'Constructionline / CHAS'];

// A day rate to derive labour figures from when a custom trade has none.
const DEFAULT_DAY_RATE = 280;

// name, aliases (lowercase, for search), then optional:
// certs (single-trade certifications), specialisms, dayRate (prefill £/day),
// office (professional services: no site preliminaries, time billed hourly).
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
  { name: 'Kitchen fitter', aliases: ['kitchen installer', 'kitchens'], dayRate: 280,
    specialisms: ['Flat-pack / trade kitchens', 'Bespoke & in-frame', 'Worktops', 'Full kitchen project (plumbing, electrics, tiling)'] },
  { name: 'Bathroom fitter', aliases: ['bathroom installer', 'bathrooms', 'wetroom'], dayRate: 280,
    specialisms: ['Full bathroom refits', 'Wetrooms', 'En-suites & cloakrooms', 'Accessible / mobility bathrooms'] },
  { name: 'Window & door installer', aliases: ['windows', 'glazing installer', 'double glazing', 'doors'], dayRate: 260,
    certs: ['FENSA', 'CERTASS'],
    specialisms: ['uPVC', 'Aluminium', 'Timber', 'Bifolds & sliders', 'Conservatories'] },
  { name: 'Glazier', aliases: ['glass', 'glazing'], dayRate: 260,
    specialisms: ['Double-glazed unit replacement', 'Emergency glazing', 'Shopfronts', 'Balustrades & splashbacks'] },
  { name: 'Scaffolder', aliases: ['scaffolding'], dayRate: 300, certs: ['CISRS', 'TG20/TG30 compliant'],
    specialisms: ['Domestic', 'Commercial', 'Temporary roofs', 'Chimney & access'] },
  { name: 'Steel fabricator / erector', aliases: ['structural steel', 'steelwork', 'welding'], dayRate: 320,
    certs: ['CE / UKCA marking (EN 1090)', 'Coded welder'],
    specialisms: ['Domestic RSJs & goalposts', 'Structural frames', 'Staircases & balustrades', 'Gates & railings'] },
  { name: 'Damp proofing specialist', aliases: ['damp', 'timber treatment', 'waterproofing'], dayRate: 280, certs: ['PCA member', 'CSSW (waterproofing)'],
    specialisms: ['Rising damp', 'Condensation', 'Timber treatment', 'Basement waterproofing'] },
  { name: 'Flooring installer', aliases: ['floor layer', 'flooring', 'carpet fitter', 'lvt'], dayRate: 240,
    specialisms: ['LVT', 'Laminate & wood', 'Carpet', 'Commercial / safety flooring'] },
  { name: 'Drylining / ceilings', aliases: ['drylining', 'suspended ceilings', 'partitions', 'plasterboard'], dayRate: 260,
    specialisms: ['Metal stud partitions', 'Suspended ceilings', 'MF ceilings', 'Tape & joint', 'Fire & acoustic systems'] },
  { name: 'Rendering / external wall insulation', aliases: ['render', 'ewi', 'monocouche', 'k-rend'], dayRate: 280,
    specialisms: ['Monocouche', 'Silicone / thin-coat', 'Sand & cement', 'Lime render', 'EWI systems'] },
  { name: 'Demolition contractor', aliases: ['demolition', 'strip out', 'soft strip'], dayRate: 300,
    certs: ['NFDC member', 'Asbestos awareness (UKATA)'],
    specialisms: ['Full demolition', 'Soft strip', 'Chimney & wall removal', 'Asbestos removal (non-licensed)'] },
  { name: 'Driveways & paving', aliases: ['driveway', 'block paving', 'resin', 'tarmac'], dayRate: 260,
    specialisms: ['Block paving', 'Resin-bound', 'Tarmac', 'Imprinted concrete', 'Patios & paths'] },
  { name: 'Fencing contractor', aliases: ['fencing', 'gates'], dayRate: 240,
    specialisms: ['Close-board', 'Panel fencing', 'Slatted / contemporary', 'Gates', 'Commercial & security'] },
  { name: 'Guttering & fascias', aliases: ['gutters', 'soffits', 'upvc roofline'], dayRate: 240,
    specialisms: ['Full roofline replacement', 'Cap-over', 'Gutter repairs & cleaning', 'Cladding'] },
  { name: 'Insulation installer', aliases: ['insulation', 'cavity wall', 'loft insulation'], dayRate: 240,
    certs: ['PAS 2030 / TrustMark', 'CIGA registered'],
    specialisms: ['Loft', 'Cavity wall', 'Internal wall', 'External wall', 'Underfloor'] },
  { name: 'Air conditioning / ventilation', aliases: ['aircon', 'ac engineer', 'mvhr', 'ventilation'], dayRate: 320, certs: ['F-Gas certified'],
    specialisms: ['Domestic split systems', 'Commercial VRF', 'MVHR', 'Kitchen extract', 'Servicing'] },
  { name: 'Solar PV installer', aliases: ['solar', 'pv', 'renewables', 'battery storage'], dayRate: 320, certs: ['MCS', 'NICEIC'],
    specialisms: ['Domestic PV', 'Battery storage', 'Commercial PV', 'EV chargers'] },
  { name: 'EV charger installer', aliases: ['ev charging', 'car charger'], dayRate: 320, certs: ['OZEV approved', 'NICEIC'],
    specialisms: ['Domestic chargers', 'Workplace / commercial', 'Three-phase', 'Groundworks for cable runs'] },
  { name: 'Drainage specialist', aliases: ['drains', 'cctv survey', 'soakaway'], dayRate: 300,
    specialisms: ['Blockages & jetting', 'CCTV surveys', 'Repairs & lining', 'New drainage', 'Septic tanks & treatment plants'] },
  { name: 'Basement conversion specialist', aliases: ['basement', 'cellar conversion', 'underpinning'], dayRate: 320,
    certs: ['CSSW (waterproofing)', 'Structural warranty provider'],
    specialisms: ['Cellar conversions', 'New-dig basements', 'Underpinning', 'Lightwells'] },
  { name: 'Shopfitter', aliases: ['shopfitting', 'commercial fit-out', 'fit out'], dayRate: 300,
    specialisms: ['Retail', 'Office (Cat A / Cat B)', 'Hospitality', 'Shopfronts & signage'] },
  { name: 'Stonemason', aliases: ['stonework', 'masonry', 'stone'], dayRate: 300,
    specialisms: ['Walling', 'Restoration & repointing', 'Cills, copings & carving', 'Fireplaces', 'Paving'] },
  { name: 'Locksmith', aliases: ['locks', 'security'], dayRate: 240, certs: ['MLA approved', 'DBS checked'],
    specialisms: ['Emergency entry', 'Lock changes & upgrades', 'uPVC door mechanisms', 'Smart locks', 'Safes'] },
  { name: 'Handyman', aliases: ['handyperson', 'odd jobs', 'property maintenance'], dayRate: 220,
    specialisms: ['Small repairs', 'Flat-pack & fitting', 'Decorating', 'Landlord maintenance', 'Garden tidy-ups'] },
  { name: 'Quantity surveyor / estimator', aliases: ['qs', 'quantity surveying', 'estimating', 'cost consultant'], dayRate: 400, office: true,
    certs: ['MRICS / FRICS', 'AssocRICS', 'CIOB'],
    specialisms: ['Residential', 'Commercial', 'Civils', 'Contractor-side', 'Client-side / PQS'] },
  { name: 'Architect / architectural services', aliases: ['architecture', 'architectural technician', 'drawings'], dayRate: 400, office: true,
    certs: ['ARB registered', 'RIBA chartered', 'CIAT'],
    specialisms: ['Extensions & lofts', 'New-build houses', 'Planning applications', 'Building regulations packages', 'Interiors'] },
];

// ── Rate sheet ──────────────────────────────────────────────────────────────

// Rounded to the nearest 5 so derived figures read like a builder would say
// them (£45/hour, not £43.75).
const r5 = (n) => Math.max(5, Math.round(n / 5) * 5);

// One rate-sheet row. `desc` is the hint under the label — say what the
// figure covers (supply & fit vs labour only, what size of job) so two
// builders read the row the same way.
const i = (key, label, unit, typical, desc) => (desc ? { key, label, unit, typical, desc } : { key, label, unit, typical });

// Every trade gets this, derived from its day rate — the figures a customer
// pays for the builder's time beyond the day rate itself (which is asked on
// the pricing screen). Saved under the 'labour' category next to the day
// rate. `scale: false` tells the locale layer the figure is already in the
// account's currency (it came from the localised day rate), so it must not
// be converted again.
function labourGroup(dayRate, office) {
  const hourly = r5(dayRate / 8);
  const lab = (key, label, unit, typical, desc) => ({ ...i(key, label, unit, typical, desc), category: 'labour', scale: false });
  if (office) {
    return {
      key: 'labour', title: 'Your time',
      desc: 'How you charge for time when a job is not a fixed fee. Your day rate is on the previous screen.',
      items: [
        lab('hourly_rate', 'Hourly rate', '£/hour', hourly),
        lab('assistant_hourly_rate', 'Assistant / technician hourly rate', '£/hour', r5(hourly * 0.6)),
        lab('half_day_rate', 'Half-day / minimum charge', '£/visit', r5(dayRate * 0.6), 'The least you will take on a job or visit for.'),
      ],
    };
  }
  return {
    key: 'labour', title: 'Labour',
    desc: 'What a customer pays for your time beyond the day rate. These feed every labour line the AI prices.',
    items: [
      lab('hourly_rate', 'Hourly rate', '£/hour', hourly),
      lab('half_day_rate', 'Half-day / minimum charge', '£/visit', r5(dayRate * 0.6), 'The least you will turn out for.'),
      lab('labourer_day', 'Labourer / mate day rate', '£/day', r5(dayRate * 0.55)),
      lab('apprentice_day', 'Apprentice / improver day rate', '£/day', r5(dayRate * 0.4)),
      lab('weekend_day_rate', 'Weekend / bank holiday day rate', '£/day', r5(dayRate * 1.5)),
      { ...i('emergency_callout', 'Emergency / out-of-hours call-out', '£/call-out', 120, 'Flat charge before any work starts.'), category: 'labour' },
    ],
  };
}

// The extras that go on most site quotes. Saved under 'prelims'. Office
// trades (QS, architect) skip this group.
const PRELIMS_GROUP = {
  key: 'prelims', title: 'Preliminaries & extras',
  desc: 'The extras that go on most quotes. Leave blank where you pass these through at cost.',
  items: [
    i('skip_hire_8yd', 'Skip hire — 8-yard', '£/skip', 320, 'Delivered, collected and tipped.'),
    i('waste_removal_load', 'Waste removal — van load', '£/load', 150),
    i('access_tower_hire_week', 'Access tower hire', '£/week', 250),
    i('travel_charge_day', 'Travel beyond your usual area', '£/day', 40, 'Per day, on top of labour.'),
  ].map((it) => ({ ...it, category: 'prelims' })),
};

// The trade's own groups — the jobs it prices every week. Typical figures are
// UK 2026 supply-and-fit unless the row says labour only. Keep every key
// unique within a trade (the catalogue test checks).
const RATE_SHEETS = {
  'General builder': [
    { key: 'projects', title: 'Extensions & whole-job rates', desc: 'All-in prices you quote by floor area or per job, incl. your subcontractors.', items: [
      i('single_storey_extension_m2', 'Single-storey extension', '£/m²', 2200, 'Shell, roof, first & second fix, finished ready to decorate.'),
      i('double_storey_extension_m2', 'Double-storey extension', '£/m²', 1900),
      i('garage_conversion_m2', 'Garage conversion', '£/m²', 1200),
      i('knock_through_rsj', 'Knock-through incl. steel (RSJ)', '£/job', 1900, 'Typical 3–4m opening, steel supplied & fitted, made good.'),
      i('full_refurb_m2', 'Full refurbishment', '£/m²', 950, 'Strip back, rewire, replumb, replaster, redecorate.'),
      i('new_build_m2', 'New-build house', '£/m²', 1900, 'Shell & finish, excl. land and external works.'),
    ] },
    { key: 'shell', title: 'Shell & structure', desc: 'Supply & fix rates for the trades you carry in-house.', items: [
      i('strip_footings_m3', 'Strip footings dug & poured', '£/m³', 220),
      i('concrete_slab_m2', 'Concrete slab / oversite', '£/m²', 85, 'Hardcore, DPM, insulation and 100–150mm slab.'),
      i('brick_outer_leaf', 'Facing brickwork', '£/m²', 82, 'Supply & lay, half-brick outer leaf.'),
      i('blockwork_m2', 'Blockwork', '£/m²', 45, 'Supply & lay, 100mm.'),
      i('roof_tiles_interlocking', 'Pitched roof — concrete interlocking tiles', '£/m²', 68, 'Supply & fix on battens and membrane.'),
      i('stud_wall_built_m2', 'Stud wall built & boarded', '£/m²', 55),
      i('plasterboard_skim_walls', 'Board & skim walls', '£/m²', 32),
    ] },
    { key: 'finish', title: 'Finishing & externals', items: [
      i('internal_door_standard', 'Internal door supplied & hung', '£/door', 380, 'Incl. lining, architrave and furniture.'),
      i('skirting_mdf_95mm', 'Skirting supplied & fitted', '£/lm', 18),
      i('upvc_window_standard', 'uPVC window supplied & fitted', '£/window', 450, 'Standard size, up to 1200 × 1200mm.'),
      i('bathroom_install', 'Bathroom installed', '£/job', 4500, 'Fitting, plumbing and tiling, excl. sanitaryware.'),
      i('kitchen_fitted', 'Kitchen fitted', '£/job', 1600, 'Labour only, units & worktops.'),
      i('room_painted', 'Room decorated', '£/room', 350, 'Walls, ceiling and woodwork, two coats.'),
      i('patio_laid_m2', 'Patio laid', '£/m²', 120),
    ] },
  ],
  'Extensions & renovations': [
    { key: 'extensions', title: 'Extensions', desc: 'All-in prices by floor area or per job.', items: [
      i('single_storey_extension_m2', 'Single-storey extension', '£/m²', 2200, 'Shell, roof, first & second fix, finished ready to decorate.'),
      i('double_storey_extension_m2', 'Double-storey extension', '£/m²', 1900),
      i('wraparound_extension_m2', 'Wraparound / L-shaped extension', '£/m²', 2400),
      i('garage_conversion_m2', 'Garage conversion', '£/m²', 1200),
      i('knock_through_rsj', 'Knock-through incl. steel (RSJ)', '£/job', 1900, 'Typical 3–4m opening, steel supplied & fitted, made good.'),
      i('kitchen_diner_openup', 'Kitchen-diner opening-up', '£/job', 4500, 'Wall out, steel in, floor levelled, made good — excl. kitchen.'),
    ] },
    { key: 'refurb', title: 'Refurbishment', items: [
      i('full_refurb_m2', 'Full refurbishment', '£/m²', 950, 'Strip back, rewire, replumb, replaster, redecorate.'),
      i('plasterboard_skim_walls', 'Board & skim walls', '£/m²', 32),
      i('bathroom_install', 'Bathroom installed', '£/job', 4500, 'Fitting, plumbing and tiling, excl. sanitaryware.'),
      i('kitchen_fitted', 'Kitchen fitted', '£/job', 1600, 'Labour only, units & worktops.'),
      i('internal_door_standard', 'Internal door supplied & hung', '£/door', 380, 'Incl. lining, architrave and furniture.'),
      i('room_painted', 'Room decorated', '£/room', 350, 'Walls, ceiling and woodwork, two coats.'),
    ] },
    { key: 'externals', title: 'Windows, doors & outside', items: [
      i('upvc_window_standard', 'uPVC window supplied & fitted', '£/window', 450, 'Standard size, up to 1200 × 1200mm.'),
      i('french_doors', 'French doors supplied & fitted', '£/job', 1800),
      i('bifold_doors_3m', 'Bifold doors supplied & fitted', '£/job', 3200, '3m aluminium, three panes.'),
      i('patio_laid_m2', 'Patio laid', '£/m²', 120),
    ] },
  ],
  'Loft conversion specialist': [
    { key: 'conversions', title: 'Conversions', desc: 'All-in, finished ready to decorate, incl. steels, stairs and building control.', items: [
      i('velux_loft_conversion', 'Velux / rooflight conversion', '£/job', 30000),
      i('dormer_loft_conversion', 'Dormer loft conversion', '£/job', 48000, 'Flat-roof rear dormer, bedroom and en-suite.'),
      i('l_shaped_dormer_conversion', 'L-shaped dormer', '£/job', 62000),
      i('hip_to_gable_conversion', 'Hip-to-gable conversion', '£/job', 55000),
      i('mansard_conversion', 'Mansard conversion', '£/job', 65000),
    ] },
    { key: 'addons', title: 'Add-ons & parts of the job', items: [
      i('loft_ensuite_addon', 'En-suite added to a loft', '£/job', 6500, 'Shower, WC and basin, tiled.'),
      i('staircase_supplied_fitted', 'Staircase to loft supplied & fitted', '£/job', 3500),
      i('velux_window_fitted', 'Extra roof window fitted', '£/window', 1200, 'Supply & fit, incl. flashing kit.'),
      i('loft_steel_beams', 'Steel beams supplied & installed', '£/job', 2800, 'Typical pair of floor steels.'),
      i('loft_boarding_m2', 'Loft boarding only (storage)', '£/m²', 45, 'Raised on stilts over insulation.'),
    ] },
  ],
  'Electrician': [
    { key: 'house', title: 'Whole-house & certification', items: [
      i('rewire_2bed', 'Full rewire — 2-bed', '£/job', 3200, 'Incl. consumer unit and certificate.'),
      i('rewire_3bed', 'Full rewire — 3-bed house', '£/job', 3800, 'Incl. consumer unit and certificate.'),
      i('rewire_4bed', 'Full rewire — 4-bed', '£/job', 4800),
      i('electrical_rewire_room', 'Rewire a single room', '£/room', 850, 'Ring main and lighting.'),
      i('consumer_unit_replacement', 'Consumer unit replacement', '£/job', 550, 'Like-for-like, RCBO board, certified.'),
      i('eicr_3bed', 'EICR — 3-bed house', '£/job', 180),
      i('eic_minor_works', 'Installation / minor works certificate', '£/job', 90),
    ] },
    { key: 'points', title: 'Per point (supply & fit)', desc: 'What you charge per point on a first-fix / second-fix job.', items: [
      i('double_socket_installed', 'Double socket added', '£/point', 90),
      i('light_point_installed', 'Light point (switch & pendant)', '£/point', 75),
      i('downlight_fitted', 'Downlight fitted', '£/point', 65),
      i('outside_light_fitted', 'Outside light fitted', '£/point', 120),
      i('cooker_circuit', 'Cooker / hob circuit', '£/job', 350),
      i('shower_circuit', 'Electric shower circuit', '£/job', 450, 'Incl. pull cord and RCD.'),
      i('extractor_fan_fitted', 'Extractor fan fitted', '£/job', 180),
      i('smoke_alarm_point', 'Mains smoke / heat alarm', '£/point', 110),
      i('data_point', 'Data / CAT6 point', '£/point', 85),
    ] },
    { key: 'specialist', title: 'Specialist installs', items: [
      i('ev_charger_install', 'EV charger installed', '£/job', 950, '7kW, supply & fit, standard run.'),
      i('solar_4kw_system', 'Solar PV — 4kW system', '£/job', 6500),
      i('battery_storage_installed', 'Battery storage added', '£/job', 3000),
      i('garden_power_supply', 'Power to garden office / shed', '£/job', 650, 'Armoured cable, small board.'),
      i('hot_tub_supply', 'Hot tub supply', '£/job', 550),
    ] },
  ],
  'Plumber': [
    { key: 'bathrooms', title: 'Bathrooms & sanitaryware', items: [
      i('bathroom_install', 'Full bathroom install', '£/job', 4500, 'Plumbing and fitting, excl. sanitaryware and tiling.'),
      i('toilet_basin_installed', 'Toilet & basin installed', '£/job', 400, 'Labour only.'),
      i('shower_installed', 'Shower installed', '£/job', 650, 'Mixer or electric, labour and pipework.'),
      i('bath_fitted', 'Bath fitted', '£/job', 250, 'Labour only.'),
      i('outside_tap_fitted', 'Outside tap fitted', '£/job', 120),
      i('appliance_plumbed', 'Washing machine / dishwasher plumbed in', '£/job', 120),
    ] },
    { key: 'heating', title: 'Heating & hot water', items: [
      i('combi_boiler_swap', 'Combi boiler swap', '£/job', 2400, 'Like-for-like, supply & fit, mid-range boiler.'),
      i('radiator_standard', 'Radiator supplied & fitted', '£/item', 280),
      i('underfloor_heating_m2', 'Wet underfloor heating', '£/m²', 65, 'Supply & fit, excl. screed.'),
      i('cylinder_replaced', 'Hot water cylinder replaced', '£/job', 1400, 'Unvented, supply & fit.'),
      i('power_flush', 'Power flush', '£/job', 450),
      i('trv_fitted', 'TRV fitted', '£/item', 45),
    ] },
    { key: 'callouts', title: 'Call-outs & repairs', items: [
      i('leak_repair_visit', 'Leak / burst repair', '£/visit', 110, 'First hour, parts extra.'),
      i('blocked_drain_clear', 'Blocked sink / toilet cleared', '£/visit', 140),
      i('tap_replaced', 'Tap replaced', '£/job', 85, 'Labour only.'),
      i('water_main_lm', 'New water main', '£/lm', 95, 'Dug, laid and connected.'),
      i('gas_safety_cert', 'Gas safety certificate (CP12)', '£/job', 80),
    ] },
  ],
  'Heating engineer': [
    { key: 'boilers', title: 'Boilers & systems', items: [
      i('gas_boiler_combi', 'Combi boiler supplied & installed', '£/job', 3200, 'Incl. flue, filter and controls.'),
      i('combi_boiler_swap', 'Like-for-like combi swap', '£/job', 2400),
      i('gas_boiler_system', 'System boiler supplied & installed', '£/job', 3800),
      i('oil_boiler_install', 'Oil boiler supplied & installed', '£/job', 4200),
      i('heat_pump_install', 'Air-source heat pump installed', '£/job', 9500, 'Supply & install, before any grant.'),
      i('cylinder_replaced', 'Hot water cylinder replaced', '£/job', 1400, 'Unvented, supply & fit.'),
      i('full_central_heating_3bed', 'Full central heating system — 3-bed', '£/job', 5500, 'Boiler, 8 radiators, pipework and controls.'),
    ] },
    { key: 'rads', title: 'Radiators & controls', items: [
      i('radiator_standard', 'Radiator supplied & fitted', '£/item', 280),
      i('underfloor_heating_m2', 'Wet underfloor heating', '£/m²', 65, 'Supply & fit, excl. screed.'),
      i('smart_thermostat_fitted', 'Smart thermostat fitted', '£/job', 220),
      i('trv_fitted', 'TRV fitted', '£/item', 45),
      i('magnetic_filter_fitted', 'Magnetic filter fitted', '£/job', 180),
      i('power_flush', 'Power flush', '£/job', 450),
    ] },
    { key: 'service', title: 'Servicing & call-outs', items: [
      i('boiler_service', 'Boiler service', '£/job', 95),
      i('gas_safety_cert', 'Gas safety certificate (CP12)', '£/job', 80),
      i('boiler_repair_callout', 'Breakdown call-out', '£/visit', 110, 'First hour, parts extra.'),
    ] },
  ],
  'Carpenter / joiner': [
    { key: 'first_fix', title: 'First fix', items: [
      i('stud_wall_built_m2', 'Stud wall built & boarded', '£/m²', 55),
      i('roof_carpentry_m2', 'Cut roof carpentry', '£/m²', 85, 'Labour only, per m² of roof.'),
      i('floor_joists_m2', 'Floor joists & decking', '£/m²', 60, 'Supply & fix.'),
      i('door_lining_fitted', 'Door lining fitted', '£/door', 95),
    ] },
    { key: 'second_fix', title: 'Second fix & joinery', items: [
      i('internal_door_standard', 'Internal door supplied & hung', '£/door', 380, 'Incl. lining, architrave and furniture.'),
      i('internal_door_hung', 'Door hung only', '£/door', 120, 'Labour only, customer-supplied door.'),
      i('skirting_mdf_95mm', 'Skirting supplied & fitted', '£/lm', 18),
      i('architrave_fitted_lm', 'Architrave fitted', '£/lm', 12),
      i('kitchen_fitted', 'Kitchen fitted', '£/job', 1600, 'Labour only, units & worktops.'),
      i('staircase_supplied_fitted', 'Staircase supplied & fitted', '£/job', 3500),
      i('loft_hatch_ladder', 'Loft hatch & ladder fitted', '£/job', 350),
      i('built_in_wardrobe', 'Built-in wardrobe (bespoke)', '£/job', 1800),
    ] },
    { key: 'external', title: 'External', items: [
      i('decking_laid_m2', 'Decking laid', '£/m²', 160, 'Supply & fit, softwood.'),
      i('closeboard_fencing_lm', 'Close-board fencing', '£/lm', 95),
      i('gate_hung', 'Garden gate supplied & hung', '£/job', 350),
    ] },
  ],
  'Roofer': [
    { key: 'pitched', title: 'Pitched roofs', desc: 'Strip and re-cover, supply & fit, per m² of roof.', items: [
      i('roof_tiles_interlocking', 'Re-tile — concrete interlocking', '£/m²', 68),
      i('clay_tile_roofing', 'Re-tile — clay plain tiles', '£/m²', 78),
      i('slate_roof_m2', 'Re-roof — natural slate', '£/m²', 120),
      i('refelt_batten_m2', 'Strip, re-felt & batten only', '£/m²', 25, 'Reusing the existing tiles.'),
      i('ridge_rebedded_lm', 'Ridge re-bedded', '£/lm', 45),
      i('velux_window_fitted', 'Roof window fitted', '£/window', 1200, 'Supply & fit, incl. flashing kit.'),
    ] },
    { key: 'flat', title: 'Flat roofs', items: [
      i('flat_roof_grp_m2', 'GRP / fibreglass', '£/m²', 110),
      i('flat_roof_epdm_m2', 'EPDM rubber', '£/m²', 90),
      i('flat_roof_felt_m2', 'Torch-on felt (3-layer)', '£/m²', 70),
    ] },
    { key: 'repairs', title: 'Repairs, leadwork & roofline', items: [
      i('roof_repair_callout', 'Minor repair call-out', '£/visit', 180, 'Slipped tiles, small leaks.'),
      i('lead_flashing_lm', 'Lead flashing', '£/lm', 65),
      i('chimney_repointed', 'Chimney repointed', '£/job', 500),
      i('chimney_removal', 'Chimney stack removed', '£/job', 1800, 'Below roofline and tiled over.'),
      i('fascia_soffit_guttering', 'Fascias, soffits & guttering', '£/lm', 70, 'Full replacement in uPVC.'),
      i('dry_verge_lm', 'Dry verge fitted', '£/lm', 35),
      i('gutter_clean', 'Gutters cleaned', '£/job', 90, 'Typical house.'),
    ] },
  ],
  'Plasterer': [
    { key: 'internal', title: 'Internal plastering', items: [
      i('skim_walls_m2', 'Skim over existing', '£/m²', 18),
      i('plasterboard_skim_walls', 'Overboard & skim', '£/m²', 32, 'Board and skim, walls.'),
      i('dot_dab_board_m2', 'Dot & dab boarding', '£/m²', 28),
      i('float_set_m2', 'Float & set (hard plaster)', '£/m²', 32),
      i('ceiling_skimmed', 'Ceiling skimmed', '£/job', 260, 'Average room.'),
      i('ceiling_overboard_skim', 'Ceiling overboarded & skimmed', '£/job', 380, 'Average room.'),
      i('room_full_replaster', 'Full room re-plastered', '£/job', 1400, 'Walls and ceiling, average bedroom.'),
      i('coving_fitted_lm', 'Coving fitted', '£/lm', 12),
      i('patch_repair_half_day', 'Patch repair', '£/visit', 150, 'Half-day call-out.'),
    ] },
    { key: 'external', title: 'External & specialist', items: [
      i('external_render', 'Sand & cement render', '£/m²', 55, 'Two-coat on mesh, smooth finish.'),
      i('monocouche_render_m2', 'Monocouche / through-colour render', '£/m²', 70),
      i('venetian_polished_m2', 'Venetian / polished plaster', '£/m²', 110),
    ] },
  ],
  'Bricklayer': [
    { key: 'brickwork', title: 'Brick & blockwork', items: [
      i('brick_outer_leaf', 'Facing brickwork — supply & lay', '£/m²', 82, 'Half-brick outer leaf.'),
      i('brickwork_labour_m2', 'Facing brickwork — labour only', '£/m²', 45),
      i('brick_per_1000', 'Labour per 1,000 bricks laid', '£/1000', 550),
      i('blockwork_m2', 'Blockwork — supply & lay', '£/m²', 45, '100mm.'),
      i('cavity_wall_m2', 'Cavity wall — both leaves', '£/m²', 110, 'Supply & build incl. ties and insulation.'),
      i('lintel_installed', 'Lintel installed', '£/item', 220, 'Per opening, supply & fit.'),
    ] },
    { key: 'garden', title: 'Garden walls & repairs', items: [
      i('garden_wall_m2', 'Garden wall', '£/m²', 110, 'Single-skin with piers, supply & build.'),
      i('brick_pier', 'Brick pier', '£/item', 280),
      i('repointing_m2', 'Repointing', '£/m²', 40),
      i('chimney_rebuild', 'Chimney rebuilt', '£/job', 1600, 'Above roofline.'),
    ] },
    { key: 'ground', title: 'Footings & slabs', items: [
      i('strip_footings_m3', 'Strip footings dug & poured', '£/m³', 220),
      i('concrete_slab_m2', 'Concrete slab / oversite', '£/m²', 85),
    ] },
  ],
  'Groundworker': [
    { key: 'foundations', title: 'Foundations & concrete', items: [
      i('strip_footings_m3', 'Strip footings dug & poured', '£/m³', 220),
      i('raft_foundation_m2', 'Raft foundation', '£/m²', 160),
      i('concrete_slab_m2', 'Concrete slab / oversite', '£/m²', 85, 'Hardcore, DPM, insulation and slab.'),
      i('hardcore_oversite_m2', 'Hardcore oversite & blinding', '£/m²', 18),
      i('underpinning_lm', 'Underpinning', '£/lm', 1200, 'Traditional mass concrete, per metre.'),
    ] },
    { key: 'drainage', title: 'Drainage & services', items: [
      i('drainage_lm', 'Drainage laid', '£/lm', 95, '110mm, dug, bedded and backfilled.'),
      i('manhole_installed', 'Inspection chamber / manhole', '£/item', 650),
      i('soakaway_installed', 'Soakaway installed', '£/job', 1200),
      i('utilities_trench_lm', 'Service trench & ducting', '£/lm', 45),
      i('water_main_lm', 'New water main', '£/lm', 95),
    ] },
    { key: 'external', title: 'External works & plant', items: [
      i('block_paving_m2', 'Block paving', '£/m²', 95),
      i('patio_laid_m2', 'Patio laid', '£/m²', 120),
      i('tarmac_drive_m2', 'Tarmac', '£/m²', 75),
      i('retaining_wall_m2', 'Retaining wall', '£/m²', 220),
      i('site_clearance_m2', 'Site clearance & strip', '£/m²', 12),
      i('muck_away_load', 'Muck away', '£/load', 280, 'Per grab load.'),
      i('digger_driver_day', 'Digger & driver', '£/day', 450),
    ] },
  ],
  'Landscaper': [
    { key: 'hard', title: 'Hard landscaping', desc: 'Supply & lay, incl. sub-base.', items: [
      i('porcelain_patio_m2', 'Porcelain patio', '£/m²', 180),
      i('sandstone_patio_m2', 'Sandstone patio', '£/m²', 140),
      i('block_paving_m2', 'Block paving', '£/m²', 95),
      i('gravel_area_m2', 'Gravel area', '£/m²', 40),
      i('decking_laid_m2', 'Decking — softwood', '£/m²', 160),
      i('composite_decking_m2', 'Decking — composite', '£/m²', 220),
      i('artificial_grass_m2', 'Artificial grass', '£/m²', 75),
      i('sleeper_bed_lm', 'Sleeper raised bed / retaining', '£/lm', 110),
    ] },
    { key: 'soft', title: 'Soft landscaping', items: [
      i('turf_laid_m2', 'Turf laid', '£/m²', 28, 'Incl. topsoil and prep.'),
      i('planting_bed_m2', 'Planting', '£/m²', 45, 'Per m² of bed, plants included.'),
      i('hedge_planted_lm', 'Hedge planted', '£/lm', 40),
      i('tree_planted', 'Tree planted', '£/item', 150, 'Standard size.'),
    ] },
    { key: 'structures', title: 'Fencing & structures', items: [
      i('closeboard_fencing_lm', 'Close-board fencing', '£/lm', 95),
      i('panel_fencing_lm', 'Panel fencing', '£/lm', 70),
      i('gate_hung', 'Garden gate supplied & hung', '£/job', 350),
      i('pergola_built', 'Pergola supplied & built', '£/job', 1800),
      i('garden_room_m2', 'Garden room', '£/m²', 1800, 'Insulated, with electrics.'),
      i('shed_base', 'Shed base laid', '£/job', 450),
    ] },
    { key: 'maintenance', title: 'Clearance & maintenance', items: [
      i('garden_clearance_day', 'Garden clearance', '£/day', 350, 'Incl. disposal.'),
      i('lawn_cut_visit', 'Lawn cut', '£/visit', 35),
    ] },
  ],
  'Tiler': [
    { key: 'floor', title: 'Floor tiling', items: [
      i('porcelain_floor_tiles', 'Porcelain floor — supply & fix', '£/m²', 75),
      i('ceramic_floor_tiles', 'Ceramic floor — supply & fix', '£/m²', 65),
      i('natural_stone_tiling_m2', 'Natural stone floor — supply & fix', '£/m²', 85),
      i('floor_tiling_m2', 'Floor tiling — labour only', '£/m²', 35),
      i('underfloor_heating_mat_m2', 'Electric UFH mat under tiles', '£/m²', 55),
    ] },
    { key: 'wall', title: 'Wall tiling', items: [
      i('tile_wall_ceramic', 'Ceramic wall — supply & fix', '£/m²', 55),
      i('wall_tiling_m2', 'Wall tiling — labour only', '£/m²', 30),
      i('large_format_tiling_m2', 'Large-format / 600 × 1200', '£/m²', 70, 'Labour only.'),
      i('mosaic_tiling_m2', 'Mosaic', '£/m²', 95, 'Labour only.'),
      i('tanking_wetroom_m2', 'Tanking / waterproofing', '£/m²', 35),
    ] },
    { key: 'jobs', title: 'Whole jobs & prep', items: [
      i('bathroom_tiled', 'Bathroom fully tiled', '£/job', 1400, 'Labour only, average family bathroom.'),
      i('kitchen_splashback', 'Kitchen splashback', '£/job', 350),
      i('tile_removal_m2', 'Old tiles removed & prepped', '£/m²', 15),
      i('grout_renewal_m2', 'Regrout', '£/m²', 20),
    ] },
  ],
  'Painter & decorator': [
    { key: 'interior', title: 'Interior', items: [
      i('room_painted', 'Room painted', '£/room', 350, 'Walls, ceiling and woodwork, two coats, average bedroom.'),
      i('walls_only_m2', 'Walls only', '£/m²', 9),
      i('ceiling_painted_m2', 'Ceilings only', '£/m²', 8),
      i('woodwork_lm', 'Woodwork glossed', '£/lm', 8),
      i('door_painted', 'Door painted', '£/door', 60, 'Both sides and frame.'),
      i('wallpaper_hung_roll', 'Wallpaper hung', '£/roll', 60),
      i('wallpaper_stripped_m2', 'Wallpaper stripped', '£/m²', 6),
      i('mist_coat_m2', 'Mist coat on new plaster', '£/m²', 6),
      i('hall_stairs_landing', 'Hall, stairs & landing', '£/job', 850),
      i('full_house_3bed', 'Whole house interior — 3-bed', '£/job', 3200),
    ] },
    { key: 'exterior', title: 'Exterior', items: [
      i('exterior_masonry_m2', 'Exterior masonry painted', '£/m²', 14),
      i('front_door_painted', 'Front door painted', '£/job', 180),
      i('exterior_window_painted', 'Window exterior repainted', '£/window', 110),
      i('fascia_painted_lm', 'Fascias & soffits painted', '£/lm', 9),
      i('exterior_full_3bed', 'Full exterior — 3-bed semi', '£/job', 2200),
    ] },
    { key: 'specialist', title: 'Spraying & specialist', items: [
      i('spray_finish_m2', 'Spray finish walls & ceilings', '£/m²', 7),
      i('kitchen_cabinets_sprayed', 'Kitchen cabinets sprayed', '£/job', 1200),
    ] },
  ],
  'Kitchen fitter': [
    { key: 'install', title: 'Installation', items: [
      i('kitchen_fitted_standard', 'Standard kitchen fitted', '£/job', 1800, 'Labour only, 8–12 units.'),
      i('kitchen_fitted_large', 'Large / bespoke kitchen fitted', '£/job', 3200, 'Labour only.'),
      i('kitchen_removed', 'Old kitchen stripped out & disposed', '£/job', 350),
      i('kitchen_worktop_laminate', 'Laminate worktop supplied & fitted', '£/lm', 120),
      i('worktop_fitted_lm', 'Worktop fitted only', '£/lm', 90, 'Labour only, customer-supplied.'),
      i('quartz_worktop_lm', 'Quartz / stone worktop', '£/lm', 450, 'Supply, template and fit.'),
      i('appliance_installed', 'Appliance installed', '£/item', 90),
      i('sink_tap_fitted', 'Sink & tap fitted', '£/job', 180),
    ] },
    { key: 'associated', title: 'Associated trades', desc: 'What you charge when you take the whole project.', items: [
      i('kitchen_plumbing', 'Kitchen plumbing', '£/job', 450, 'Sink, dishwasher, washing machine.'),
      i('kitchen_electrics', 'Kitchen electrics', '£/job', 650, 'Sockets, cooker circuit, lighting.'),
      i('kitchen_splashback', 'Splashback tiled', '£/job', 350),
      i('kitchen_floor_m2', 'Kitchen floor laid', '£/m²', 40),
      i('kitchen_walls_skimmed', 'Walls made good & skimmed', '£/job', 450),
    ] },
  ],
  'Bathroom fitter': [
    { key: 'jobs', title: 'Whole jobs', desc: 'Labour and plumbing, excl. sanitaryware and tiles unless you supply.', items: [
      i('bathroom_refit_full', 'Full bathroom refit', '£/job', 5500),
      i('ensuite_installed', 'En-suite installed', '£/job', 4200),
      i('wetroom_conversion', 'Wetroom conversion', '£/job', 8500),
      i('downstairs_wc', 'Downstairs WC / cloakroom', '£/job', 2800),
      i('bathroom_strip_out', 'Bathroom stripped out & disposed', '£/job', 350),
    ] },
    { key: 'items', title: 'Individual items', items: [
      i('shower_installed', 'Shower installed', '£/job', 650),
      i('bath_fitted', 'Bath fitted', '£/job', 250, 'Labour only.'),
      i('toilet_basin_installed', 'Toilet & basin installed', '£/job', 400, 'Labour only.'),
      i('shower_screen_fitted', 'Shower screen / enclosure fitted', '£/job', 220),
      i('vanity_unit_fitted', 'Vanity unit fitted', '£/job', 280),
      i('extractor_fan_fitted', 'Extractor fan fitted', '£/job', 180),
      i('tanking_wetroom_m2', 'Tanking / waterproofing', '£/m²', 35),
      i('bathroom_tiled', 'Bathroom fully tiled', '£/job', 1400, 'Labour only.'),
      i('underfloor_heating_mat_m2', 'Electric UFH mat', '£/m²', 55),
    ] },
  ],
  'Window & door installer': [
    { key: 'windows', title: 'Windows (supply & fit)', items: [
      i('upvc_window_standard', 'uPVC window — standard', '£/window', 450, 'Up to 1200 × 1200mm.'),
      i('upvc_window_large', 'uPVC window — large', '£/window', 750),
      i('bay_window_installed', 'Bay window', '£/job', 2400),
      i('aluminium_window', 'Aluminium window', '£/window', 950),
      i('timber_window', 'Timber casement window', '£/window', 1100),
      i('sash_window_replacement', 'Sash window replacement', '£/window', 1600),
    ] },
    { key: 'doors', title: 'Doors (supply & fit)', items: [
      i('composite_external_door', 'Composite front door', '£/job', 1250),
      i('upvc_back_door', 'uPVC back door', '£/job', 750),
      i('french_doors', 'French doors', '£/job', 1800),
      i('sliding_patio_door', 'Sliding patio door', '£/job', 2200),
      i('bifold_doors_3m', 'Bifold doors', '£/job', 3200, '3m aluminium, three panes.'),
      i('garage_door_sectional', 'Sectional garage door', '£/job', 1200, 'Insulated, with opener.'),
    ] },
    { key: 'extras', title: 'Labour-only & extras', items: [
      i('window_fitting_labour', 'Window fitted only', '£/window', 150, 'Customer-supplied frame.'),
      i('door_fitting_labour', 'External door fitted only', '£/job', 250),
      i('window_board_fitted', 'Internal window board fitted', '£/window', 45),
    ] },
  ],
  'Glazier': [
    { key: 'replacement', title: 'Replacement glazing', items: [
      i('dgu_replaced', 'Misted / blown double-glazed unit replaced', '£/unit', 180, 'Standard size, supply & fit.'),
      i('single_pane_replaced', 'Single pane replaced', '£/pane', 120),
      i('toughened_glass_m2', 'Toughened safety glass', '£/m²', 220, 'Supply & fit.'),
      i('laminated_glass_m2', 'Laminated glass', '£/m²', 260),
      i('emergency_boardup', 'Emergency board-up', '£/visit', 150),
    ] },
    { key: 'jobs', title: 'Bespoke & commercial', items: [
      i('shopfront_glass_m2', 'Shopfront glazing', '£/m²', 350),
      i('glass_balustrade_lm', 'Glass balustrade', '£/lm', 450),
      i('glass_splashback', 'Glass splashback', '£/job', 350),
      i('mirror_fitted', 'Mirror supplied & fitted', '£/job', 180),
      i('glass_partition_lm', 'Glass partition', '£/lm', 550),
    ] },
  ],
  'Scaffolder': [
    { key: 'domestic', title: 'Domestic jobs', desc: 'Erect, hire period and dismantle.', items: [
      i('scaffold_single_elevation', 'Single elevation', '£/job', 750),
      i('scaffold_full_wrap_3bed', 'Full wrap — 3-bed house', '£/job', 1900),
      i('scaffold_extension', 'Extension scaffold', '£/job', 1400, 'Typical single-storey rear extension.'),
      i('scaffold_loft', 'Loft conversion scaffold', '£/job', 2200, 'Incl. roof-level access.'),
      i('scaffold_chimney', 'Chimney scaffold', '£/job', 900),
      i('scaffold_tower_week', 'Tower hire', '£/week', 250),
    ] },
    { key: 'rates', title: 'Measured rates & extras', items: [
      i('scaffolding_two_storey', 'Independent scaffold — two storey', '£/m²', 22, 'Per m² of elevation.'),
      i('extra_week_hire', 'Extra week hire', '£/week', 150, 'Per elevation beyond the base period.'),
      i('scaffold_adaptation', 'Adaptation / alteration visit', '£/visit', 180),
      i('temporary_roof_m2', 'Temporary roof', '£/m²', 45),
      i('debris_netting_m2', 'Debris netting', '£/m²', 4),
      i('scaffold_alarm_week', 'Scaffold alarm', '£/week', 60),
    ] },
  ],
  'Steel fabricator / erector': [
    { key: 'structural', title: 'Structural steel', items: [
      i('rsj_supplied_installed', 'RSJ / UB supplied & installed', '£/item', 1200, 'Typical 4m domestic beam incl. padstones.'),
      i('goalpost_frame', 'Goalpost frame', '£/job', 3200, 'Supply & fit, typical knock-through.'),
      i('steel_supply_tonne', 'Fabricated structural steel', '£/tonne', 2800, 'Supply only.'),
      i('steel_erect_tonne', 'Erection', '£/tonne', 650, 'Labour and crane.'),
      i('padstone_installed', 'Padstone supplied & bedded', '£/item', 85),
      i('intumescent_paint_m2', 'Intumescent fire protection', '£/m²', 45),
    ] },
    { key: 'fabrication', title: 'Fabrication & architectural', items: [
      i('welding_hour', 'Site welding', '£/hour', 65),
      i('steel_staircase', 'Steel staircase', '£/job', 4500),
      i('steel_balustrade_lm', 'Steel balustrade / handrail', '£/lm', 350),
      i('juliet_balcony', 'Juliet balcony', '£/job', 850),
      i('steel_gates_pair', 'Steel gates', '£/job', 1500, 'Pair, supply & hang.'),
    ] },
  ],
  'Damp proofing specialist': [
    { key: 'damp', title: 'Damp', items: [
      i('damp_survey', 'Damp survey', '£/job', 150),
      i('dpc_injection_lm', 'Chemical DPC injection', '£/lm', 45),
      i('replaster_damp_m2', 'Hack off & replaster', '£/m²', 55, 'Renovating plaster system.'),
      i('tanking_m2', 'Cementitious tanking', '£/m²', 95),
      i('cavity_membrane_m2', 'Cavity drain membrane', '£/m²', 85),
      i('piv_unit_fitted', 'PIV unit fitted', '£/job', 650, 'Condensation control.'),
    ] },
    { key: 'timber', title: 'Timber', items: [
      i('timber_survey', 'Timber survey', '£/job', 120),
      i('woodworm_treatment_m2', 'Woodworm treatment', '£/m²', 18, 'Per m² of floor.'),
      i('dry_rot_treatment', 'Dry rot treatment', '£/job', 1200, 'Typical affected area.'),
      i('joist_end_repair', 'Joist end repair / replacement', '£/item', 65),
    ] },
    { key: 'basement', title: 'Basements', items: [
      i('basement_waterproofing_m2', 'Basement waterproofing system', '£/m²', 180, 'Type C cavity drain system.'),
      i('sump_pump_installed', 'Sump & pump installed', '£/job', 1500),
    ] },
  ],
  'Flooring installer': [
    { key: 'supply_fit', title: 'Supply & fit', items: [
      i('lvt_flooring_karndean', 'LVT', '£/m²', 42),
      i('laminate_flooring', 'Laminate', '£/m²', 25),
      i('engineered_wood_m2', 'Engineered wood', '£/m²', 55),
      i('solid_wood_m2', 'Solid wood', '£/m²', 75),
      i('carpet_supply_fit', 'Carpet', '£/m²', 28, 'Incl. underlay and grippers.'),
      i('vinyl_sheet_m2', 'Sheet vinyl', '£/m²', 22),
      i('safety_flooring_m2', 'Safety / commercial vinyl', '£/m²', 45),
    ] },
    { key: 'labour', title: 'Fitting only', desc: 'Customer-supplied flooring.', items: [
      i('lvt_fit_only_m2', 'LVT fitted', '£/m²', 18),
      i('laminate_fit_only_m2', 'Laminate fitted', '£/m²', 12),
      i('wood_fit_only_m2', 'Wood flooring fitted', '£/m²', 25),
      i('carpet_fit_only_m2', 'Carpet fitted', '£/m²', 6),
      i('stair_carpet_fitted', 'Stairs & landing fitted', '£/job', 180),
    ] },
    { key: 'prep', title: 'Preparation & extras', items: [
      i('screed_levelling_m2', 'Levelling compound / screed', '£/m²', 18),
      i('ply_overlay_m2', 'Plywood overlay', '£/m²', 14),
      i('uplift_disposal_m2', 'Old flooring uplifted & disposed', '£/m²', 5),
      i('sanding_sealing_m2', 'Floor sanding & sealing', '£/m²', 35),
      i('door_bar_fitted', 'Door bar / threshold', '£/item', 15),
    ] },
  ],
  'Drylining / ceilings': [
    { key: 'partitions', title: 'Partitions & linings', items: [
      i('metal_stud_partition_m2', 'Metal stud partition', '£/m²', 60, 'Boarded both sides.'),
      i('stud_wall_built_m2', 'Timber stud wall built & boarded', '£/m²', 55),
      i('dot_dab_board_m2', 'Dot & dab boarding', '£/m²', 28),
      i('insulated_lining_m2', 'Insulated wall lining', '£/m²', 48),
      i('fire_boarding_m2', 'Fire-rated boarding', '£/m²', 35),
    ] },
    { key: 'ceilings', title: 'Ceilings', items: [
      i('suspended_ceiling_m2', 'Suspended ceiling', '£/m²', 45),
      i('mf_ceiling_m2', 'MF plasterboard ceiling', '£/m²', 55),
      i('ceiling_overboard_m2', 'Ceiling overboarded', '£/m²', 22),
    ] },
    { key: 'finish', title: 'Finishing', items: [
      i('tape_joint_m2', 'Tape & joint', '£/m²', 12),
      i('skim_walls_m2', 'Skim finish', '£/m²', 18),
    ] },
  ],
  'Rendering / external wall insulation': [
    { key: 'render', title: 'Render', desc: 'Per m² of wall, excl. scaffold.', items: [
      i('external_render', 'Sand & cement render', '£/m²', 55),
      i('monocouche_render_m2', 'Monocouche / through-colour', '£/m²', 70),
      i('silicone_render_m2', 'Silicone / thin-coat', '£/m²', 85),
      i('lime_render_m2', 'Lime render', '£/m²', 95),
      i('render_repair_m2', 'Render repair', '£/m²', 60),
      i('render_removal_m2', 'Old render hacked off', '£/m²', 20),
    ] },
    { key: 'ewi', title: 'External wall insulation', items: [
      i('ewi_system_m2', 'EWI system — EPS & render', '£/m²', 110),
      i('ewi_mineral_wool_m2', 'EWI system — mineral wool', '£/m²', 130),
      i('ewi_brick_slip_m2', 'EWI with brick slips', '£/m²', 160),
      i('beads_trims_lm', 'Beads & trims', '£/lm', 8),
    ] },
  ],
  'Demolition contractor': [
    { key: 'structural', title: 'Demolition', items: [
      i('house_demolition', 'Full house demolition & clearance', '£/job', 18000, 'Typical 3-bed, excl. asbestos.'),
      i('garage_demolition', 'Garage demolished & cleared', '£/job', 1800),
      i('extension_demolition', 'Single-storey extension demolished', '£/job', 3500),
      i('chimney_breast_removal', 'Chimney breast removed', '£/job', 1800, 'Per floor, incl. support.'),
      i('wall_removal_m2', 'Internal wall removed', '£/m²', 85, 'Non-structural.'),
    ] },
    { key: 'strip', title: 'Strip-out & asbestos', items: [
      i('soft_strip_m2', 'Soft strip', '£/m²', 18, 'Per m² of floor.'),
      i('kitchen_strip_out', 'Kitchen stripped out', '£/job', 350),
      i('bathroom_strip_out', 'Bathroom stripped out', '£/job', 350),
      i('asbestos_survey', 'Asbestos survey', '£/job', 250),
      i('asbestos_removal_m2', 'Asbestos removal (non-licensed)', '£/m²', 55),
    ] },
    { key: 'disposal', title: 'Disposal', items: [
      i('muck_away_load', 'Muck away', '£/load', 280, 'Per grab load.'),
      i('roro_skip_hire', 'Roll-on roll-off skip', '£/skip', 650),
    ] },
  ],
  'Driveways & paving': [
    { key: 'driveways', title: 'Driveways (supply & lay)', desc: 'Incl. dig-out and sub-base.', items: [
      i('block_paving_drive_m2', 'Block paving', '£/m²', 110),
      i('resin_bound_drive_m2', 'Resin-bound', '£/m²', 120),
      i('tarmac_drive_m2', 'Tarmac', '£/m²', 75),
      i('gravel_drive_m2', 'Gravel', '£/m²', 50),
      i('imprinted_concrete_m2', 'Imprinted concrete', '£/m²', 95),
      i('permeable_paving_m2', 'Permeable paving', '£/m²', 120),
    ] },
    { key: 'ground', title: 'Groundwork & edges', items: [
      i('excavation_subbase_m2', 'Dig out & sub-base only', '£/m²', 35),
      i('drainage_channel_lm', 'Linear / ACO drain', '£/lm', 65),
      i('edging_kerb_lm', 'Edging / kerb', '£/lm', 25),
      i('dropped_kerb', 'Dropped kerb', '£/job', 1800, 'Excl. council fees.'),
    ] },
    { key: 'paths', title: 'Paths, patios & cleaning', items: [
      i('patio_laid_m2', 'Patio laid', '£/m²', 120),
      i('path_laid_m2', 'Path laid', '£/m²', 90),
      i('pressure_clean_m2', 'Pressure clean & re-sand', '£/m²', 6),
    ] },
  ],
  'Fencing contractor': [
    { key: 'fencing', title: 'Fencing (supply & fit)', desc: 'Per metre, incl. posts and concrete.', items: [
      i('closeboard_fencing_lm', 'Close-board', '£/lm', 95),
      i('panel_fencing_lm', 'Panel fencing', '£/lm', 70),
      i('slatted_fencing_lm', 'Slatted / contemporary', '£/lm', 140),
      i('concrete_post_gravel_board_lm', 'Concrete posts & gravel boards', '£/lm', 85),
      i('post_rail_lm', 'Post & rail', '£/lm', 45),
      i('chain_link_lm', 'Chain link', '£/lm', 35),
      i('metal_railings_lm', 'Metal railings', '£/lm', 180),
    ] },
    { key: 'gates', title: 'Gates & repairs', items: [
      i('gate_hung', 'Garden gate supplied & hung', '£/job', 350),
      i('driveway_gates_pair', 'Double driveway gates', '£/job', 1200),
      i('fence_post_replaced', 'Fence post replaced', '£/post', 85),
      i('fence_removal_lm', 'Old fence removed & disposed', '£/lm', 10),
      i('trellis_lm', 'Trellis topper', '£/lm', 35),
    ] },
  ],
  'Guttering & fascias': [
    { key: 'roofline', title: 'Roofline (supply & fit)', items: [
      i('fascia_soffit_guttering', 'Fascias, soffits & gutters — full replacement', '£/lm', 70),
      i('fascia_capping_lm', 'Cap-over fascia', '£/lm', 35),
      i('gutter_only_lm', 'Guttering replaced only', '£/lm', 30),
      i('soffit_only_lm', 'Soffits replaced only', '£/lm', 28),
      i('dry_verge_lm', 'Dry verge fitted', '£/lm', 35),
      i('upvc_cladding_m2', 'uPVC cladding', '£/m²', 85),
      i('full_roofline_3bed', 'Full roofline — 3-bed semi', '£/job', 2600),
    ] },
    { key: 'repairs', title: 'Repairs & cleaning', items: [
      i('gutter_clean', 'Gutters cleaned', '£/job', 90, 'Typical house.'),
      i('gutter_repair_visit', 'Gutter repair / realign', '£/visit', 120),
      i('downpipe_replaced', 'Downpipe replaced', '£/item', 110),
    ] },
  ],
  'Insulation installer': [
    { key: 'rates', title: 'Insulation (per m²)', items: [
      i('loft_insulation_m2', 'Loft insulation — 270mm', '£/m²', 15),
      i('cavity_wall_insulation_m2', 'Cavity wall insulation', '£/m²', 12),
      i('internal_wall_insulation_m2', 'Internal wall insulation', '£/m²', 65, 'Boarded, ready for skim.'),
      i('ewi_system_m2', 'External wall insulation', '£/m²', 110),
      i('floor_insulation_m2', 'Underfloor insulation', '£/m²', 35, 'Suspended timber floor.'),
      i('room_in_roof_m2', 'Room-in-roof insulation', '£/m²', 70),
    ] },
    { key: 'jobs', title: 'Whole jobs', items: [
      i('loft_insulation_3bed', 'Loft — 3-bed house', '£/job', 650),
      i('cavity_wall_3bed', 'Cavity walls — 3-bed semi', '£/job', 900),
      i('loft_boarding_m2', 'Loft boarding', '£/m²', 45, 'Raised on stilts over insulation.'),
      i('loft_clearance', 'Loft cleared before insulating', '£/job', 180),
      i('draught_proofing_house', 'Whole-house draught-proofing', '£/job', 350),
    ] },
  ],
  'Air conditioning / ventilation': [
    { key: 'ac', title: 'Air conditioning', items: [
      i('split_system_single', 'Single split system', '£/job', 1600, 'Supply & install, one indoor unit.'),
      i('multi_split_2', 'Multi-split — 2 indoor units', '£/job', 2800),
      i('ac_extra_unit', 'Each additional indoor unit', '£/item', 900),
      i('vrf_per_kw', 'Commercial VRF', '£/kW', 450),
      i('ac_service', 'AC service', '£/visit', 110),
    ] },
    { key: 'vent', title: 'Ventilation', items: [
      i('mvhr_system_3bed', 'MVHR system — 3-bed', '£/job', 5500),
      i('extractor_fan_fitted', 'Extractor fan fitted', '£/job', 180),
      i('piv_unit_fitted', 'PIV unit fitted', '£/job', 650),
      i('ductwork_lm', 'Ductwork', '£/lm', 65),
      i('commercial_kitchen_extract', 'Commercial kitchen extract', '£/job', 6500),
    ] },
  ],
  'Solar PV installer': [
    { key: 'systems', title: 'Systems', items: [
      i('solar_4kw_system', '4kW panel system', '£/job', 6500, 'Supply & install, MCS certified.'),
      i('solar_6kw_system', '6kW panel system', '£/job', 8500),
      i('solar_panel_extra', 'Additional panel', '£/item', 450),
      i('battery_storage_installed', 'Battery storage added', '£/job', 3000),
      i('solar_diverter', 'Solar diverter (hot water)', '£/job', 450),
      i('ev_charger_install', 'EV charger installed', '£/job', 950),
    ] },
    { key: 'extras', title: 'Extras & aftercare', items: [
      i('bird_proofing', 'Bird proofing', '£/job', 350),
      i('inverter_replaced', 'Inverter replaced', '£/job', 1200),
      i('scaffold_solar', 'Scaffold for install', '£/job', 750),
      i('solar_cleaning', 'Panel cleaning', '£/visit', 150),
    ] },
  ],
  'EV charger installer': [
    { key: 'domestic', title: 'Domestic', items: [
      i('ev_charger_install', 'Standard 7kW charger', '£/job', 950, 'Supply & fit, standard cable run.'),
      i('ev_charger_fit_only', 'Fit only', '£/job', 450, 'Customer-supplied charger.'),
      i('ev_charger_22kw', '22kW three-phase charger', '£/job', 1600),
      i('ev_cable_extra_lm', 'Cable run beyond 10m', '£/lm', 18),
      i('consumer_unit_replacement', 'Consumer unit replacement', '£/job', 550),
    ] },
    { key: 'commercial', title: 'Commercial & groundworks', items: [
      i('commercial_charge_bay', 'Commercial charge point', '£/item', 1800, 'Per bay.'),
      i('ev_trenching_lm', 'Trenching for cable', '£/lm', 45),
      i('dno_application', 'DNO application handled', '£/job', 150),
    ] },
  ],
  'Drainage specialist': [
    { key: 'clear', title: 'Surveys & clearing', items: [
      i('cctv_survey', 'CCTV drain survey', '£/job', 180),
      i('blocked_drain_clear', 'Blocked drain cleared', '£/visit', 140),
      i('jetting_hour', 'High-pressure jetting', '£/hour', 110),
    ] },
    { key: 'repair', title: 'Repairs & new drains', items: [
      i('drainage_lm', 'New drain run', '£/lm', 95),
      i('drain_lining_lm', 'Drain lining (no-dig)', '£/lm', 220),
      i('drain_patch_repair', 'Localised patch repair', '£/job', 650),
      i('manhole_installed', 'Inspection chamber / manhole', '£/item', 650),
      i('gully_replaced', 'Gully replaced', '£/item', 280),
      i('soakaway_installed', 'Soakaway installed', '£/job', 1200),
    ] },
    { key: 'offmains', title: 'Off-mains', items: [
      i('septic_tank_install', 'Septic tank installed', '£/job', 6500),
      i('treatment_plant_install', 'Sewage treatment plant installed', '£/job', 9000),
      i('pump_station_install', 'Pump station installed', '£/job', 3500),
    ] },
  ],
  'Basement conversion specialist': [
    { key: 'conversions', title: 'Conversions', items: [
      i('basement_conversion_m2', 'Existing cellar converted', '£/m²', 3500, 'Waterproofed, insulated and finished.'),
      i('basement_new_dig_m2', 'New basement dug', '£/m²', 5500),
      i('underpinning_lm', 'Underpinning', '£/lm', 1200),
      i('lightwell_formed', 'Lightwell formed', '£/job', 8500),
    ] },
    { key: 'elements', title: 'Waterproofing & finishing', items: [
      i('basement_waterproofing_m2', 'Waterproofing system', '£/m²', 180, 'Type C cavity drain system.'),
      i('cavity_membrane_m2', 'Cavity drain membrane only', '£/m²', 85),
      i('sump_pump_installed', 'Sump & pump installed', '£/job', 1500),
      i('basement_slab_m2', 'New slab & insulation', '£/m²', 160),
      i('staircase_supplied_fitted', 'Staircase supplied & fitted', '£/job', 3500),
    ] },
  ],
  'Shopfitter': [
    { key: 'fitout', title: 'Fit-out (per m²)', items: [
      i('retail_fitout_m2', 'Retail fit-out — basic', '£/m²', 450),
      i('office_fitout_m2', 'Office fit-out — Cat B', '£/m²', 650),
      i('hospitality_fitout_m2', 'Restaurant / bar fit-out', '£/m²', 1200),
    ] },
    { key: 'elements', title: 'Elements', items: [
      i('metal_stud_partition_m2', 'Metal stud partition', '£/m²', 60),
      i('glass_partition_lm', 'Glass partition', '£/lm', 550),
      i('suspended_ceiling_m2', 'Suspended ceiling', '£/m²', 45),
      i('commercial_flooring_m2', 'Commercial flooring', '£/m²', 45),
      i('shopfront_installed', 'Shopfront & signage', '£/job', 8500),
      i('counter_bespoke', 'Counter / reception desk', '£/job', 2500, 'Bespoke joinery.'),
      i('display_joinery_lm', 'Display shelving / joinery', '£/lm', 450),
      i('commercial_electrical_point', 'Electrical point (commercial)', '£/point', 110),
    ] },
    { key: 'strip', title: 'Strip-out', items: [
      i('soft_strip_m2', 'Strip-out', '£/m²', 18),
    ] },
  ],
  'Stonemason': [
    { key: 'stonework', title: 'Stonework', items: [
      i('stone_walling_m2', 'Natural stone walling', '£/m²', 220, 'Supply & build.'),
      i('dry_stone_wall_m2', 'Dry stone wall', '£/m²', 180),
      i('stone_cladding_m2', 'Stone cladding', '£/m²', 160),
      i('stone_paving_m2', 'Stone paving', '£/m²', 150),
      i('lime_repointing_m2', 'Lime repointing', '£/m²', 55),
      i('stone_indent_repair', 'Stone indent repair', '£/item', 350, 'Per stone.'),
    ] },
    { key: 'bespoke', title: 'Cills, copings & bespoke', items: [
      i('stone_cill_coping_lm', 'Stone cills / copings', '£/lm', 120),
      i('stone_steps_each', 'Stone step', '£/item', 450),
      i('stone_fireplace', 'Stone fireplace', '£/job', 2800),
    ] },
  ],
  'Locksmith': [
    { key: 'locks', title: 'Locks & entry', items: [
      i('lockout_callout', 'Lock-out / gain entry', '£/visit', 95, 'Daytime.'),
      i('lockout_out_of_hours', 'Out-of-hours entry', '£/visit', 150),
      i('euro_cylinder_changed', 'Euro cylinder changed', '£/job', 85, 'Supply & fit, anti-snap.'),
      i('mortice_lock_fitted', 'BS mortice deadlock fitted', '£/job', 140),
      i('upvc_mechanism_replaced', 'uPVC door mechanism replaced', '£/job', 180),
      i('door_realigned', 'Door realigned / adjusted', '£/job', 90),
    ] },
    { key: 'security', title: 'Security upgrades', items: [
      i('whole_house_locks', 'Whole house locks changed', '£/job', 350, 'Three doors.'),
      i('window_lock_fitted', 'Window lock fitted', '£/item', 35),
      i('smart_lock_fitted', 'Smart / keypad lock fitted', '£/job', 280),
      i('safe_installed', 'Safe installed', '£/job', 350),
      i('security_survey', 'Security survey', '£/job', 80),
    ] },
  ],
  'Handyman': [
    { key: 'jobs', title: 'Common jobs', items: [
      i('tv_mounted', 'TV wall-mounted', '£/job', 90),
      i('shelves_fitted', 'Shelves / brackets fitted', '£/job', 60, 'Per set.'),
      i('flatpack_assembly', 'Flat-pack assembly', '£/item', 70),
      i('internal_door_hung', 'Door hung', '£/door', 120, 'Customer-supplied door.'),
      i('curtain_pole_fitted', 'Curtain pole / blind fitted', '£/item', 45),
      i('tap_replaced', 'Tap replaced', '£/job', 85),
      i('silicone_resealed', 'Bath / shower resealed', '£/job', 90),
      i('light_fitting_changed', 'Light fitting changed', '£/item', 60),
    ] },
    { key: 'repairs', title: 'Repairs & decorating', items: [
      i('plaster_patch_repair', 'Plaster patch repair', '£/job', 120),
      i('room_painted', 'Room painted', '£/room', 350),
      i('door_painted', 'Door painted', '£/door', 60),
      i('gutter_clean', 'Gutters cleaned', '£/job', 90),
      i('fence_panel_replaced', 'Fence panel replaced', '£/item', 85),
      i('garden_tidy_day', 'Garden tidy', '£/day', 280),
    ] },
  ],
  'Quantity surveyor / estimator': [
    { key: 'fees', title: 'Fees', desc: 'Typical domestic / small commercial work.', items: [
      i('fee_pct_contract', 'Fee as % of contract value', '%', 2.5, 'Full QS service.'),
      i('boq_m2_gifa', 'BOQ / cost plan', '£/m²', 6, 'Per m² of gross internal floor area.'),
      i('pre_tender_estimate', 'Pre-tender estimate', '£/job', 850, 'Typical domestic extension.'),
      i('tender_boq_domestic', 'Full BOQ — domestic extension', '£/job', 1800),
      i('feasibility_study', 'Feasibility / budget study', '£/job', 1200),
      i('tender_analysis', 'Tender analysis & report', '£/job', 650),
      i('valuation_visit', 'Interim valuation / site visit', '£/visit', 350),
      i('cost_report_monthly', 'Monthly cost report', '£/item', 450),
      i('final_account', 'Final account', '£/job', 1200),
    ] },
  ],
  'Architect / architectural services': [
    { key: 'fees', title: 'Fees', desc: 'Typical domestic work.', items: [
      i('fee_pct_build', 'Full service fee as % of build cost', '%', 8),
      i('measured_survey', 'Measured survey & existing drawings', '£/job', 650),
      i('planning_drawings_extension', 'Planning drawings — extension', '£/job', 1500),
      i('planning_drawings_new_build', 'Planning drawings — new house', '£/job', 4500),
      i('building_regs_drawings', 'Building regulations package', '£/job', 1800),
      i('planning_application_handling', 'Planning application handled', '£/job', 450, 'Excl. council fee.'),
      i('visuals_3d', '3D visuals', '£/job', 650, 'Per set.'),
      i('tender_package', 'Tender package & specification', '£/job', 1200),
      i('site_visit', 'Site visit / inspection', '£/visit', 250),
    ] },
  ],
};

// ── Questions ───────────────────────────────────────────────────────────────

// Questions asked for every trade, in screen order. type: 'pills' (single),
// 'pills-multi', 'text', 'number' (with unit). Section 'business' is who they
// are and what they take on; 'pricing' is day rate, how they price and their
// terms. day_rate is prefilled from the trade's typical figure and feeds the
// rate library on save; percentage questions are never prefilled (a blank
// means "nothing added", which is what the pricer assumes).
function commonQuestions(trade) {
  return [
    { id: 'years_trading', section: 'business', label: 'How long have you been at it?', type: 'pills',
      options: ['Just starting out', '1–3 years', '3–10 years', '10+ years'] },
    { id: 'team_size', section: 'business', label: 'How big is the team?', type: 'pills',
      options: ['Just me', '2–5', '6–15', '16+'] },
    { id: 'regions', section: 'business', label: 'Where do you work?', desc: 'A town, county or region.',
      type: 'text', placeholder: 'e.g. Manchester and the North West' },
    { id: 'travel_radius', section: 'business', label: 'How far will you travel for a job?', type: 'pills',
      options: ['Up to 10 miles', '10–30 miles', '30–60 miles', 'Anywhere in the country'] },
    { id: 'work_mix', section: 'business', label: 'Who do you mostly work for?', desc: 'Select all that apply.', type: 'pills-multi',
      options: ['Homeowners', 'Landlords & letting agents', 'Commercial clients', 'Developers / new build', 'Main contractors (subcontract)', 'Insurance work', 'Social housing / public sector'] },
    { id: 'typical_job_value', section: 'business', label: 'Typical job value?', type: 'pills',
      options: ['Under £5k', '£5k – £25k', '£25k – £100k', '£100k – £500k', '£500k+'] },
    { id: 'quotes_per_month', section: 'business', label: 'How many quotes do you send a month?', type: 'pills',
      options: ['1–5', '6–15', '16–40', '40+'] },

    { id: 'day_rate', section: 'pricing', label: 'Your day rate', desc: 'What a day of your labour costs a customer. Feeds every estimate — change it any time from My Rates.',
      type: 'number', unit: '£/day', default: trade && trade.dayRate ? trade.dayRate : DEFAULT_DAY_RATE },
    { id: 'pricing_basis', section: 'pricing', label: 'How do you usually price a job?', desc: 'Select all that apply.', type: 'pills-multi',
      options: ['Day rate', 'Per m² / per metre', 'Fixed price per job', 'Per point / per item', 'Schedule of rates', 'Cost plus (materials + labour + %)'] },
    { id: 'materials_supply', section: 'pricing', label: 'Who supplies the materials?', type: 'pills',
      options: ['I supply everything', 'Customer buys the big-ticket items', 'Customer supplies all materials', 'Varies by job'] },
    { id: 'materials_markup_pct', section: 'pricing', label: 'Markup on materials you supply', desc: 'What you add to the cost of materials. Leave blank if you pass them through at cost.',
      type: 'number', unit: '%', placeholder: '15' },
    { id: 'ohp_pct', section: 'pricing', label: 'Overheads & profit added on top', desc: 'Only if you add a separate margin to your bills. Leave blank if your rates are already all-in.',
      type: 'number', unit: '%', placeholder: '15' },
    { id: 'contingency_pct', section: 'pricing', label: 'Contingency you add', desc: 'For the unknowns on a job. Leave blank if none.',
      type: 'number', unit: '%', placeholder: '5' },
    { id: 'payment_terms', section: 'pricing', label: 'How do you take payment?', type: 'pills',
      options: ['Deposit, then balance on completion', 'Staged payments through the job', 'Everything on completion', 'Invoice on 14 / 30-day terms'] },
    { id: 'deposit_pct', section: 'pricing', label: 'Deposit you ask for', type: 'number', unit: '%', placeholder: '25' },
    { id: 'quote_includes', section: 'pricing', label: 'What your prices normally include', desc: 'Select all that apply — the AI lists the rest as exclusions.', type: 'pills-multi',
      options: ['Materials', 'Waste removal & skips', 'Scaffolding & access', 'Making good & decorating', 'Certificates & sign-off', 'Parking & congestion charges', 'Guarantee / warranty'] },
    { id: 'quote_validity', section: 'pricing', label: 'How long are your quotes valid?', type: 'pills',
      options: ['14 days', '30 days', '60 days', '90 days'] },
    { id: 'guarantee', section: 'pricing', label: 'Guarantee on your work', type: 'pills',
      options: ['None', '12 months', '2 years', '5 years', '10 years or more'] },
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

// The full question set for a trade name, in screen order: the business
// questions, then the trade's specialisms and certifications (business too),
// then the pricing questions. Unknown trades get the common set with generic
// certifications, so a typed-in trade still works.
function getQuestionsForTrade(name) {
  const trade = findTrade(name);
  const common = commonQuestions(trade);
  const business = common.filter(q => q.section === 'business');
  const pricing = common.filter(q => q.section === 'pricing');
  if (trade && trade.specialisms) {
    business.push({ id: 'specialisms', section: 'business', label: 'What kind of work do you take on?', desc: 'Select all that apply.',
      type: 'pills-multi', options: trade.specialisms });
  }
  business.push({ id: 'certifications', section: 'business', label: 'Certifications & accreditations', desc: 'Select all that apply.',
    type: 'pills-multi', options: [...(trade && trade.certs ? trade.certs : []), ...COMMON_CERTS] });
  return [...business, ...pricing];
}

// The rate sheet for a trade as groups: Labour (every trade, derived from the
// day rate), Preliminaries (site trades), then the trade's own groups. Pass
// `dayRate` to derive the labour figures from a different day rate — the
// locale layer does, so a Rand account's labour typicals come from its Rand
// day rate. Unknown trades get the universal groups only, so their day rate,
// hourly rate and extras still save.
function getRateSheetForTrade(name, { dayRate } = {}) {
  const trade = findTrade(name);
  const office = !!(trade && trade.office);
  const day = dayRate > 0 ? dayRate : (trade && trade.dayRate) || DEFAULT_DAY_RATE;
  const groups = [labourGroup(day, office)];
  if (!office) groups.push(PRELIMS_GROUP);
  for (const g of (trade && RATE_SHEETS[trade.name]) || []) groups.push(g);
  return groups.map(g => ({ ...g, items: g.items.map(it => ({ ...it })) }));
}

// The same sheet flattened, each item carrying its group title — what the
// save path validates against and the admin download labels from.
function getRateItemsForTrade(name, opts) {
  return getRateSheetForTrade(name, opts).flatMap(g => g.items.map(it => ({ ...it, group: g.title })));
}

module.exports = { TRADES, RATE_SHEETS, DEFAULT_DAY_RATE, searchTrades, findTrade, getQuestionsForTrade, getRateSheetForTrade, getRateItemsForTrade };

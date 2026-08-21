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

module.exports = { TRADES, searchTrades, findTrade, getQuestionsForTrade };

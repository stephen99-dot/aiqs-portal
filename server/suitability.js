// suitability.js — maps suitability-survey answers onto an AI Trades Pilot
// package. Pure config + logic, no DB/I-O, so it's unit-testable.
//
// The popup asks three things: which features they want, how big the team
// is, and how often they price work. Size questions set the BASE tier —
// what the business can realistically carry — and the features they picked
// can pull them up at most ONE tier above that, so a sole trader ticking
// "all of the above" lands on Trade with a growth note, not a £599 plan.
// Tier keys/prices mirror aitradespilot's server/tiers.js (2026-07 pricing).

const TIER_ORDER = ['platform', 'trade', 'builder', 'contractor'];

const TIERS = {
  platform:   { key: 'platform',   label: 'Platform',   monthly: 59,  audience: 'Sole traders & 1–2 person firms' },
  trade:      { key: 'trade',      label: 'Trade',      monthly: 149, audience: 'Small builders, 3–10 on site' },
  builder:    { key: 'builder',    label: 'Builder',    monthly: 399, audience: 'Growing firms pricing every week' },
  contractor: { key: 'contractor', label: 'Contractor', monthly: 599, audience: 'Main contractors, multi-site' },
};

// The survey's feature options. minTier = cheapest ATP tier that includes it
// (per aitradespilot tiers.js feature lists); addon features are available on
// any tier for an extra monthly fee, so they never drive the recommendation.
const FEATURES = {
  ai_call_handler: { label: 'AI call handler & note-taker', minTier: 'platform', addon: true },
  boq:             { label: 'AI-priced BOQs from drawings',  minTier: 'platform' },
  documents:       { label: 'Quotes, RAMS, contracts & invoices', minTier: 'platform' },
  programmes:      { label: 'Programmes & schedules',        minTier: 'platform' },
  materials:       { label: 'Materials price comparison',    minTier: 'platform' },
  valuations:      { label: 'Valuations, variations & RFIs', minTier: 'trade' },
  cost_tracking:   { label: 'Live cost tracking',            minTier: 'trade' },
  crm_leads:       { label: 'CRM & portal lead generation',  minTier: 'trade' },
  site_team:       { label: 'Site tools for your team',      minTier: 'trade' },
  client_signoff:  { label: 'Client sign-off portal',        minTier: 'builder' },
  multi_site:      { label: 'Multi-site overview',           minTier: 'contractor' },
};

const TEAM_SIZES = {
  solo:     { label: 'Just me',       minTier: 'platform' },
  s2_10:    { label: '2–10 people',   minTier: 'trade' },
  s11_25:   { label: '11–25 people',  minTier: 'builder' },
  s26plus:  { label: '25+ people',    minTier: 'contractor' },
};

const JOBS_BANDS = {
  adhoc:   { label: 'Now and then',        minTier: 'platform' },
  monthly: { label: 'About 1 a month',     minTier: 'trade' },
  s2_5:    { label: '2–5 a month',         minTier: 'builder' },
  s6plus:  { label: 'More than 5 a month', minTier: 'contractor' },
};

const rank = (tier) => TIER_ORDER.indexOf(tier);

// → { tier, label, monthly, covered: [ids], addons: [ids], uncovered: [ids] }
// covered/uncovered partition the non-addon features they picked by whether
// the recommended tier includes them; addons are listed separately.
function recommendTier({ features = [], teamSize, jobsPerMonth }) {
  const picked = features.filter((f) => FEATURES[f]);

  const sizeRank = Math.max(
    rank(TEAM_SIZES[teamSize]?.minTier || 'platform'),
    rank(JOBS_BANDS[jobsPerMonth]?.minTier || 'platform'),
  );
  const featureRank = picked.reduce((max, f) => {
    if (FEATURES[f].addon) return max;
    return Math.max(max, rank(FEATURES[f].minTier));
  }, 0);

  const tier = TIER_ORDER[Math.max(sizeRank, Math.min(featureRank, Math.min(sizeRank + 1, TIER_ORDER.length - 1)))];

  const addons = picked.filter((f) => FEATURES[f].addon);
  const covered = picked.filter((f) => !FEATURES[f].addon && rank(FEATURES[f].minTier) <= rank(tier));
  const uncovered = picked.filter((f) => !FEATURES[f].addon && rank(FEATURES[f].minTier) > rank(tier));

  return { tier, label: TIERS[tier].label, monthly: TIERS[tier].monthly, covered, addons, uncovered };
}

module.exports = { TIERS, TIER_ORDER, FEATURES, TEAM_SIZES, JOBS_BANDS, recommendTier };

// suitability.js — maps suitability-survey answers onto an AI Trades Pilot
// package. Pure config + logic, no DB/I-O, so it's unit-testable.
//
// The popup asks three things: which features they want, how big the team
// is, and how often they price work. With the 2026-08 two-plan pricing the
// logic is simple: anyone who wants pricing, documents or job-running tools
// belongs on Unlimited (£199/mo, unlimited AI QS jobs); a business that only
// wants the win-the-work toolkit (CRM, planning leads, letters) fits Sales &
// Marketing (£99/mo); wanting both sides lands on the Bundle (£249/mo, both
// packages, £49 off the pair). Add-on features (the work phone) never drive
// the recommendation. Plan keys/prices mirror aitradespilot's server/tiers.js.

const TIER_ORDER = ['sales', 'unlimited', 'bundle'];

const TIERS = {
  sales:     { key: 'sales',     label: 'Sales & Marketing', monthly: 99,  audience: 'Fill the pipeline — CRM, priced planning leads & letters' },
  unlimited: { key: 'unlimited', label: 'Unlimited',         monthly: 199, audience: 'Run every job — unlimited AI QS priced jobs, contracts & more' },
  bundle:    { key: 'bundle',    label: 'Bundle',            monthly: 249, audience: 'Both packages together — save £49 a month' },
};

// The survey's feature options. minTier = cheapest ATP plan that includes it
// (per aitradespilot tiers.js feature lists); addon features are available on
// any plan for an extra monthly fee, so they never drive the recommendation.
const FEATURES = {
  ai_call_handler: { label: 'AI call handler & note-taker', minTier: 'sales', addon: true },
  crm_leads:       { label: 'CRM & priced planning leads',  minTier: 'sales' },
  letters:         { label: 'Client letter generator',      minTier: 'sales' },
  boq:             { label: 'AI-priced BOQs from drawings', minTier: 'unlimited' },
  documents:       { label: 'Quotes, RAMS, contracts & invoices', minTier: 'unlimited' },
  programmes:      { label: 'Programmes & schedules',       minTier: 'unlimited' },
  materials:       { label: 'Materials price comparison',   minTier: 'unlimited' },
  valuations:      { label: 'Valuations, variations & RFIs', minTier: 'unlimited' },
  cost_tracking:   { label: 'Live cost tracking',           minTier: 'unlimited' },
  site_team:       { label: 'Site tools for your team',     minTier: 'unlimited' },
  client_signoff:  { label: 'Client sign-off portal',       minTier: 'unlimited' },
  multi_site:      { label: 'Multi-site overview',          minTier: 'unlimited' },
};

// Team size no longer changes the price — both plans are per company. It only
// nudges the recommendation: bigger teams are running jobs, which is Unlimited.
const TEAM_SIZES = {
  solo:     { label: 'Just me',       minTier: 'sales' },
  s2_10:    { label: '2–10 people',   minTier: 'sales' },
  s11_25:   { label: '11–25 people',  minTier: 'unlimited' },
  s26plus:  { label: '25+ people',    minTier: 'unlimited' },
};

// Anyone pricing work at all belongs on Unlimited — jobs are unlimited there.
const JOBS_BANDS = {
  adhoc:   { label: 'Now and then',        minTier: 'sales' },
  monthly: { label: 'About 1 a month',     minTier: 'unlimited' },
  s2_5:    { label: '2–5 a month',         minTier: 'unlimited' },
  s6plus:  { label: 'More than 5 a month', minTier: 'unlimited' },
};

const rank = (tier) => TIER_ORDER.indexOf(tier);

// → { tier, label, monthly, covered: [ids], addons: [ids], uncovered: [ids] }
// covered/uncovered partition the non-addon features they picked by whether
// the recommended plan includes them; addons are listed separately. Picking
// from BOTH sides (win-the-work + run-the-job) recommends the Bundle, so
// uncovered is always empty.
function recommendTier({ features = [], teamSize, jobsPerMonth }) {
  const picked = features.filter((f) => FEATURES[f]);
  const nonAddon = picked.filter((f) => !FEATURES[f].addon);

  const wantsSales = nonAddon.some((f) => FEATURES[f].minTier === 'sales');
  const wantsUnlimited = nonAddon.some((f) => FEATURES[f].minTier === 'unlimited')
    || rank(TEAM_SIZES[teamSize]?.minTier || 'sales') > 0
    || rank(JOBS_BANDS[jobsPerMonth]?.minTier || 'sales') > 0;

  const tier = wantsSales && wantsUnlimited ? 'bundle' : wantsUnlimited ? 'unlimited' : 'sales';

  const addons = picked.filter((f) => FEATURES[f].addon);
  const inTier = (f) => tier === 'bundle' || rank(FEATURES[f].minTier) === rank(tier)
    || (tier === 'unlimited' && FEATURES[f].minTier === 'unlimited')
    || (tier === 'sales' && FEATURES[f].minTier === 'sales');
  const covered = nonAddon.filter(inTier);
  const uncovered = nonAddon.filter((f) => !inTier(f));

  return { tier, label: TIERS[tier].label, monthly: TIERS[tier].monthly, covered, addons, uncovered };
}

module.exports = { TIERS, TIER_ORDER, FEATURES, TEAM_SIZES, JOBS_BANDS, recommendTier };

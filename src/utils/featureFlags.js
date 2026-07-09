// Preview feature flags gated to specific accounts.
//
// Planning Leads is in preview and visible to the owner's account ONLY. The
// server enforces the same allowlist (server/planningLeadsRoutes.js) — this is
// just so the nav link and route don't show for anyone else. Keep the two lists
// in sync; widen access by adding emails here and there.

export const PLANNING_LEADS_EMAILS = ['hello@crmwizardai.com'];

export function canUsePlanningLeads(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return PLANNING_LEADS_EMAILS.map(e => e.toLowerCase()).includes(email);
}

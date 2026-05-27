// Returns the ISO start of the user's CURRENT billing cycle.
//
// `billing_cycle_start` is the Stripe anchor (the renewal day, set from
// current_period_start). It is only refreshed when a Stripe webhook fires, so
// if a webhook is missed the stored value stays frozen — which froze both the
// usage counts and the period shown on the dashboard. We instead treat it as an
// anchor and roll it forward in whole-month steps to the most recent occurrence
// on/before now, so usage resets every month regardless of webhook delivery.
function getBillingCycleStart(user) {
  const now = new Date();

  if (user && user.billing_cycle_start) {
    const anchor = new Date(user.billing_cycle_start);
    if (!isNaN(anchor.getTime())) {
      // Anchor in the future (cycle hasn't started yet) — use it as-is.
      if (anchor > now) return anchor.toISOString();

      const months =
        (now.getFullYear() - anchor.getFullYear()) * 12 +
        (now.getMonth() - anchor.getMonth());

      // Always add months to a fresh copy of the anchor so day-of-month
      // adjustments don't compound across iterations.
      let cycle = addMonths(anchor, months);
      if (cycle > now) cycle = addMonths(anchor, months - 1);
      return cycle.toISOString();
    }
  }

  // No anchor on file — fall back to the 1st of the calendar month.
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

module.exports = { getBillingCycleStart };

// ═══════════════════════════════════════════════════════════════════════════
// scheduleCashflow.js — pure cash-flow projection from a build schedule.
// No DB, no I/O. Admin-only feature; the gate lives on the route.
//
// Turns a dated programme into an expected monthly cash flow:
//   • each task carries a share of the contract value — weighted by its priced
//     source lines where known, and by duration for the unpriced remainder;
//   • that value is spread evenly across the task's WORKING days;
//   • the daily spend is bucketed by calendar month;
//   • claims raised to date (invoices) are overlaid month by month.
//
// So changing a duration, a start date, or a cost re-shapes the curve, and the
// planned total always reconciles to the contract value.
//
// Dates are ISO 'YYYY-MM-DD'. All maths is UTC to avoid timezone off-by-one.
// ═══════════════════════════════════════════════════════════════════════════

const { parseISO, normWorkingDays } = require('./scheduleEngine');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function monthKeyOf(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Assign every task a share of the contract value.
//   base weight   = sum of line_total for the task's source_line_ids (priced);
//   residual      = contractValue not tied to any priced line, spread across all
//                   tasks by duration_days so unpriced tasks still carry cost.
// If there's no contract value but there are priced lines, fall back to the
// priced net so the shape still renders. Returns Map(taskId -> cost).
function computeTaskCosts(tasks, lineTotalById, contractValue) {
  const list = Array.isArray(tasks) ? tasks : [];
  const netById = new Map();
  let allocated = 0;
  for (const t of list) {
    let net = 0;
    for (const lid of (t.source_line_ids || [])) net += Number(lineTotalById.get(lid)) || 0;
    netById.set(t.id, net);
    allocated += net;
  }

  const cv = Number(contractValue) || 0;
  const costById = new Map();

  if (cv <= 0) {
    // No contract value to spread — use the priced net directly (may be all 0).
    for (const t of list) costById.set(t.id, netById.get(t.id) || 0);
    return costById;
  }

  const residual = Math.max(0, cv - allocated);
  const totalDuration = list.reduce((s, t) => s + (Number(t.duration_days) || 0), 0);
  for (const t of list) {
    const durShare = totalDuration > 0
      ? residual * ((Number(t.duration_days) || 0) / totalDuration)
      : residual / (list.length || 1);
    costById.set(t.id, (netById.get(t.id) || 0) + durShare);
  }
  return costById;
}

// Spread a task's cost evenly across its working days into `out` (Map month->£).
function spreadTaskAcrossMonths(startISO, endISO, cost, workingSet, out) {
  if (!(Number(cost) > 0)) return;
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start || !end || end < start) return;

  const days = [];
  const d = new Date(start.getTime());
  let guard = 0;
  while (d <= end && guard++ < 100000) {
    if (workingSet.has(d.getUTCDay())) days.push(monthKeyOf(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (days.length === 0) {
    // A span with no working day inside it (e.g. a task pinned to a weekend) —
    // drop the whole cost in the start month so nothing is lost.
    const k = monthKeyOf(start);
    out.set(k, (out.get(k) || 0) + Number(cost));
    return;
  }
  const per = Number(cost) / days.length;
  for (const k of days) out.set(k, (out.get(k) || 0) + per);
}

// Build the monthly cash-flow projection.
//   tasks:        [{ id, duration_days, planned_start, planned_end, source_line_ids }]
//   lineTotalById: Map(quote_line_id -> line_total)
//   contractValue: the quote's grand_total (what the client pays)
//   workingDays:   JSON string or array of weekday numbers (0=Sun..6=Sat)
//   claims:        [{ date: ISO, amount }] — invoices raised to date
// Returns { months:[{month,label,planned,claimed,cumulativePlanned,
//           cumulativeClaimed}], totals:{...} }.
function buildCashflow({ tasks, lineTotalById, contractValue, workingDays, claims }) {
  const set = normWorkingDays(workingDays);
  const costById = computeTaskCosts(tasks, lineTotalById || new Map(), contractValue);

  const plannedByMonth = new Map();
  for (const t of (tasks || [])) {
    spreadTaskAcrossMonths(t.planned_start, t.planned_end, costById.get(t.id) || 0, set, plannedByMonth);
  }

  const claimedByMonth = new Map();
  for (const c of (claims || [])) {
    const d = parseISO(c && c.date);
    const amt = Number(c && c.amount) || 0;
    if (!d || amt <= 0) continue;
    const k = monthKeyOf(d);
    claimedByMonth.set(k, (claimedByMonth.get(k) || 0) + amt);
  }

  const keys = Array.from(new Set([...plannedByMonth.keys(), ...claimedByMonth.keys()])).sort();
  let cumP = 0;
  let cumC = 0;
  const months = keys.map((k) => {
    const planned = round2(plannedByMonth.get(k) || 0);
    const claimed = round2(claimedByMonth.get(k) || 0);
    cumP += planned;
    cumC += claimed;
    return {
      month: k,
      label: monthLabel(k),
      planned,
      claimed,
      cumulativePlanned: round2(cumP),
      cumulativeClaimed: round2(cumC),
    };
  });

  const plannedTotal = round2([...plannedByMonth.values()].reduce((s, v) => s + v, 0));
  const claimedToDate = round2([...claimedByMonth.values()].reduce((s, v) => s + v, 0));
  const cv = round2(Number(contractValue) || 0);
  return {
    months,
    totals: {
      contractValue: cv,
      plannedTotal,
      claimedToDate,
      remainingToClaim: round2(cv - claimedToDate),
    },
  };
}

module.exports = { buildCashflow, computeTaskCosts, round2, monthLabel };

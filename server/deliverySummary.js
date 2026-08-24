/**
 * deliverySummary.js — builds what the chat actually shows after a bill is priced.
 *
 * Two problems this exists to solve, both seen on issued jobs:
 *
 * 1. CONFLICTING NUMBERS. The chat announced a construction total of
 *    £1,170,875 while the delivered spreadsheet's line items summed to
 *    £141,123. The recalc gate detected the £1.03m gap and the bill shipped
 *    anyway, because the gate only warned. A total that does not reconcile to
 *    the document being downloaded must never be stated as fact — the whole
 *    point of the headline is that it is the number in the file.
 *
 * 2. INTERNAL DIAGNOSTICS AS THE DELIVERABLE. The chat dumped every pricer
 *    warning verbatim — "AUTO-CORRECTED: plasterboard_skim_walls qty 1315 →
 *    276", "No base rate for 'skips_waste_removal' — used ai_estimated rate
 *    £17250/Item", raw item keys, internal ceilings. That is engineering
 *    output, not a QS deliverable, and it buries the handful of lines that
 *    genuinely need a human decision.
 *
 * The split this module makes:
 *   - headline   the numbers, ONLY when they reconcile to the document
 *   - needsCheck the short list a QS must settle before signing
 *   - internal   everything else, for the diagnostics drawer, never the answer
 */

const CURRENCY = { GBP: '£', EUR: '€' };

function sym(currency) {
  if (!currency) return '£';
  return CURRENCY[currency] || currency;
}

function money(n, currency) {
  return sym(currency) + Math.round(Number(n) || 0).toLocaleString('en-GB');
}

// ── Warning classification ────────────────────────────────────────────────
// Each rule says: does a human have to DO something about this before the
// bill is signed? If not, it belongs in the diagnostics drawer.
const NEEDS_CHECK_RULES = [
  {
    id: 'ceiling_clipped',
    re: /exceeds the per-unit ceiling/i,
    title: 'Rate capped at the unit ceiling',
    why: 'The priced rate is a bound, not a measurement. A rate this far over the ceiling usually means the unit is wrong — a lump sum billed per m or m².',
  },
  {
    id: 'high_value_unverified',
    re: /High-value item:/i,
    title: 'High-value line to verify',
    why: 'Large allowance derived from the drawings rather than measured from a schedule.',
  },
  {
    id: 'qty_autocorrected',
    re: /AUTO-CORRECTED:.*qty/i,
    title: 'Quantity auto-corrected',
    why: 'The takeoff quantity was implausible and was corrected before pricing. Confirm the corrected figure.',
  },
  {
    id: 'double_count_removed',
    re: /Double-count in/i,
    title: 'Duplicate line removed',
    why: 'A line was already covered by a lump-sum fit-out and was removed to prevent over-counting.',
  },
];

// Pure noise: normal operation of the rate library, not a decision for anyone.
const INTERNAL_ONLY = [
  /^No base rate for/i,
  /^Key '.*' prices per/i,
  /rate source coverage/i,
];

function classifyWarning(text) {
  const s = String(text || '');
  for (const rule of NEEDS_CHECK_RULES) if (rule.re.test(s)) return rule;
  return null;
}

function isInternalOnly(text) {
  const s = String(text || '');
  return INTERNAL_ONLY.some((re) => re.test(s));
}

/**
 * @param {object} priced     the deterministic pricer's result
 * @param {object} recalc     { ok, lineSum, expected, diff } from recalcGate, or null
 * @param {object} opts       { floorAreaM2 }
 */
function buildDeliverySummary(priced, recalc, opts = {}) {
  const summary = (priced && priced.summary) || {};
  const currency = summary.currency || 'GBP';
  const warnings = (priced && priced.warnings) || [];
  const reviewFlags = (priced && priced.review_flags) || [];

  // ── Reconciliation. The document is the deliverable, so the document's
  // line-sum is the authority. If the pricer's total disagrees, we do not get
  // to pick one — we say so and withhold the headline.
  const reconciled = !recalc || recalc.ok === true;
  const reconciliation = {
    reconciled,
    documentTotal: recalc ? recalc.lineSum : null,
    pricerTotal: recalc ? recalc.expected : (summary.construction_total ?? null),
    diff: recalc ? recalc.diff : 0,
  };

  // ── Headline. Only stated when the numbers agree with the file.
  let headline = null;
  if (reconciled) {
    const construction = Number(summary.construction_total) || 0;
    const vatRate = Number(summary.vat_rate) || 0;
    const vat = Number(summary.vat_amount ?? construction * (vatRate / 100)) || 0;
    const area = Number(opts.floorAreaM2) || Number(summary.floor_area_m2) || 0;
    headline = {
      construction, vat, vatRate,
      total: Number(summary.grand_total) || construction + vat,
      perM2: area > 0 ? Math.round(construction / area) : null,
      floorAreaM2: area || null,
      currency,
      formatted: {
        construction: money(construction, currency),
        vat: money(vat, currency),
        total: money(Number(summary.grand_total) || construction + vat, currency),
        perM2: area > 0 ? money(construction / area, currency) + '/m²' : null,
      },
    };
  }

  // ── Sections, largest first — the shape a QS reads.
  const sections = ((priced && priced.sections) || []).map((s) => {
    const total = (s.items || []).reduce((a, it) => a + (Number(it.total) || 0), 0);
    return { title: s.title || s.name || '', total, formatted: money(total, currency), itemCount: (s.items || []).length };
  }).filter((s) => s.total > 0).sort((a, b) => b.total - a.total);

  // ── The short list that needs a human.
  const needsCheck = [];
  const seen = new Set();
  for (const flag of reviewFlags) {
    const key = 'flag:' + flag.key;
    if (seen.has(key)) continue;
    seen.add(key);
    needsCheck.push({
      id: 'ceiling_clipped',
      title: 'Rate capped at the unit ceiling',
      detail: `${flag.key} — ${money(flag.originalRate, currency)}/${flag.unit} priced above the ${money(flag.ceiling, currency)}/${flag.unit} ceiling and was capped.`,
      why: NEEDS_CHECK_RULES[0].why,
    });
  }
  const internal = [];
  for (const w of warnings) {
    const rule = classifyWarning(w);
    if (rule && rule.id !== 'ceiling_clipped') {
      const key = rule.id + ':' + String(w).slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      needsCheck.push({ id: rule.id, title: rule.title, detail: String(w), why: rule.why });
    } else if (!rule || isInternalOnly(w)) {
      internal.push(String(w));
    }
  }

  // ── One sentence a person can act on.
  let statusLine;
  if (!reconciled) {
    statusLine = `These numbers do not yet reconcile to the spreadsheet — the bill's line items total ${money(reconciliation.documentTotal, currency)} against a priced total of ${money(reconciliation.pricerTotal, currency)}. Nothing has been issued; this needs settling before the figures are used.`;
  } else if (needsCheck.length) {
    statusLine = `${needsCheck.length} line${needsCheck.length === 1 ? '' : 's'} need${needsCheck.length === 1 ? 's' : ''} your check before this goes to a client.`;
  } else {
    statusLine = 'The bill reconciles to the spreadsheet and no lines are flagged for review.';
  }

  return {
    reconciled, reconciliation, headline, sections,
    needsCheck, internal, statusLine,
    counts: { sections: sections.length, needsCheck: needsCheck.length, internal: internal.length },
  };
}

module.exports = { buildDeliverySummary, classifyWarning, isInternalOnly };

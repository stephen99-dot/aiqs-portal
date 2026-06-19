// ═══════════════════════════════════════════════════════════════════════════
// money.js — the financial cascade used by quotes and invoices. Pure, no I/O,
// fully unit-tested (money.test.js). Keep ALL pricing maths here so there is one
// audited source of truth instead of the same arithmetic copied across routes.
// ═══════════════════════════════════════════════════════════════════════════

function num(v, fb = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fb;
}

function round2(n) {
  return Math.round((num(n)) * 100) / 100;
}

// Net subtotal + percentages → the full cascade.
// OH&P is applied to net; contingency to (net + OH&P); VAT to the lot.
// Margin % = OH&P / (net + OH&P) — i.e. profit as a share of the marked-up cost.
function computeFinancials(net, opts = {}) {
  net = num(net);
  const ohpPct = num(opts.ohp_pct);
  const contPct = num(opts.contingency_pct);
  const vatPct = num(opts.vat_pct);

  const ohp = net * (ohpPct / 100);
  const cont = (net + ohp) * (contPct / 100);
  const beforeVat = net + ohp + cont;
  const vat = beforeVat * (vatPct / 100);
  const grand = beforeVat + vat;
  const margin = (net + ohp) > 0 ? (ohp / (net + ohp)) * 100 : 0;

  return {
    net_total: round2(net),
    ohp_amount: round2(ohp),
    contingency_amount: round2(cont),
    vat_amount: round2(vat),
    grand_total: round2(grand),
    margin_pct: round2(margin),
  };
}

// CIS deduction is taken from the labour element only (UK construction tax).
function cisDeduction(labourTotal, ratePct) {
  return round2(num(labourTotal) * (num(ratePct) / 100));
}

// Sum qty × rate over lines (does not mutate).
function netFromLines(lines) {
  let net = 0;
  for (const ln of (lines || [])) net += num(ln.qty) * num(ln.rate);
  return round2(net);
}

module.exports = { num, round2, computeFinancials, cisDeduction, netFromLines };

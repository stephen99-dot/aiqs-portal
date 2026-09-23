// Plan and BOQ-pack prices, shown in the viewer's currency.
//
// Payments are taken in GBP through Stripe Payment Links, so the £ figure is
// always what is charged. For a South African account the Rand equivalent is
// shown alongside ("£349 ≈ R8,200") so the price means something locally.
// The rate is REACT_APP_GBP_ZAR (default 23.5), rounded to R100 so it never
// reads as an exact quote.
//
// AuthContext calls setPriceViewer() whenever the signed-in user changes, so
// gbp() can be used anywhere in render without threading the user through.

let viewer = null;
export function setPriceViewer(user) { viewer = user || null; }

const GBP_ZAR = Number(process.env.REACT_APP_GBP_ZAR) || 23.5;

function gbpText(n) {
  const whole = Math.round(n * 100) % 100 === 0;
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// "£349" — or "£349 ≈ R8,200" for a South African account.
export function gbp(n) {
  const base = gbpText(n);
  if (viewer && viewer.currency === 'ZAR') {
    const r = Math.round((n * GBP_ZAR) / 100) * 100;
    return `${base} ≈ R${r.toLocaleString('en-GB')}`;
  }
  return base;
}

// Shown under price lists for accounts not billed in their own currency.
export function billingNote() {
  if (viewer && viewer.currency && viewer.currency !== 'GBP') {
    return 'Billed in GBP (£). The local-currency figure is approximate.';
  }
  return '';
}

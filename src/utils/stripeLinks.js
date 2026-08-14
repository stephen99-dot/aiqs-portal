// Stripe Payment Links are static URLs, so on their own they carry nothing that
// ties a payment back to the logged-in portal account — the webhook is left
// guessing from whatever email the buyer types at Stripe. That's how BOQ-pack
// payments went missing when the email didn't match.
//
// This stamps the current user onto a payment link:
//   • client_reference_id — the account id, passed straight through to the
//     checkout.session.completed webhook for a reliable, exact match.
//   • prefilled_email — pre-fills (and locks) the email so the buyer is far less
//     likely to pay under a different address in the first place.
//
// Both are query params Stripe Payment Links natively support.
// The Office in a Box subscription — sold as the AI Trades Pilot "Unlimited"
// plan, £199/month (2026-08 repricing; legacy £100/month subscribers keep
// their price). A Stripe Payment Link; stamp it with withUserRef() before
// sending the user, so the webhook can match the payment back to this exact
// account and flip on access. Set REACT_APP_OFFICE_PAYMENT_LINK to the new
// £199 Payment Link at build time — the fallback below is the legacy £100
// link so nothing breaks before the new link is configured.
export const OFFICE_PAYMENT_LINK =
  process.env.REACT_APP_OFFICE_PAYMENT_LINK || 'https://buy.stripe.com/8x26oHc3CfrWf3adus73G0i';

export function withUserRef(url, user) {
  if (!url || !user) return url;
  try {
    const u = new URL(url);
    if (user.id) u.searchParams.set('client_reference_id', user.id);
    if (user.email) u.searchParams.set('prefilled_email', user.email);
    return u.toString();
  } catch (e) {
    return url;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT NOTIFICATIONS — server/creditNotifications.js
//
// The emails around the BOQ credit lifecycle, in one place so every spend and
// purchase path behaves the same:
//
//   notifyCreditSpent(user, remaining)   — "1 credit used, N remaining" to the
//     customer after every job submitted / BOQ generated; when the balance is
//     down to LOW_BALANCE_AT or fewer it also sends the LOW credit balance
//     email with the three top-up options.
//   notifyPackPurchased({...})           — tells US (the admin inbox) about
//     every pack purchase, alongside whatever the customer already receives
//     from Stripe. Also used for unmatched/pending payments so money never
//     lands silently.
//
// All sends are fire-and-forget: a mail failure must never break a submission
// or a webhook.
// ═══════════════════════════════════════════════════════════════════════════════

const mailer = require('./mailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';
const LOW_BALANCE_AT = 2;

// Live pack prices + Stripe payment links (same links the dashboard buttons
// use). Overridable via env without a deploy.
const TOPUP_OPTIONS = [
  { label: '1 BOQ — £150', url: process.env.STRIPE_LINK_BOQ_1 || 'https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g' },
  { label: '5 BOQs — £349', url: process.env.STRIPE_LINK_BOQ_5 || 'https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h' },
  { label: '10 BOQs — £580', url: process.env.STRIPE_LINK_BOQ_10 || 'https://buy.stripe.com/9B628raZy2Fa4ow62073G0f' },
  { label: '20 BOQs — £980', url: process.env.STRIPE_LINK_BOQ_20 || 'https://buy.stripe.com/cNi4gz6Ji4Ni3ks2PO73G0l' },
];

function fmtRemaining(n) {
  return n === 1 ? '1 BOQ credit' : n + ' BOQ credits';
}

// Customer-facing: a credit was just spent on a submitted job. `remaining` is
// the balance AFTER the spend. Admins never receive these (they don't spend).
function notifyCreditSpent(user, remaining, jobLabel) {
  if (!user || !user.email) return;
  const n = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;

  mailer.sendMail({
    userId: user.id,
    type: 'credit_spent',
    to: user.email,
    subject: '1 BOQ credit used — ' + fmtRemaining(n) + ' remaining',
    heading: 'Your job is in',
    paragraphs: [
      'We\'ve received ' + (jobLabel ? '"' + jobLabel + '"' : 'your job') + ' and one BOQ credit has been used.',
      'You have ' + fmtRemaining(n) + ' remaining on your account.',
    ],
    ctaText: 'View your projects',
    ctaUrl: mailer.BASE_URL + '/dashboard',
  }).catch(() => {});

  if (n <= LOW_BALANCE_AT) {
    mailer.sendMail({
      userId: user.id,
      type: 'credit_low',
      to: user.email,
      subject: 'LOW credit balance — ' + fmtRemaining(n) + ' left. Top up now',
      heading: 'Your BOQ credits are running low',
      paragraphs: [
        'You have ' + fmtRemaining(n) + ' remaining — top up now so your next job isn\'t held up.',
        'Choose the pack that suits you:',
        ...TOPUP_OPTIONS.map((o) => o.label + ' — ' + o.url),
        'Credits are added to your account the moment payment completes.',
      ],
      ctaText: 'Top up your credits',
      ctaUrl: mailer.BASE_URL + '/dashboard',
    }).catch(() => {});
  }
}

// Admin-facing: a pack was purchased (or a payment arrived that we could not
// match — status 'pending' / 'unmatched' — which needs a human eye).
function notifyPackPurchased({ email, credits, amountPence, sessionId, status, balanceAfter }) {
  const amount = '£' + ((amountPence || 0) / 100).toFixed(2);
  const ok = !status || status === 'granted';
  mailer.sendMail({
    type: ok ? 'pack_purchased_admin' : 'pack_purchase_pending_admin',
    to: ADMIN_EMAIL,
    subject: ok
      ? amount + ' BOQ pack purchased — ' + (email || 'unknown') + ' (+' + credits + ' credit' + (credits === 1 ? '' : 's') + ')'
      : amount + ' Stripe payment NEEDS REVIEW — ' + (email || 'unknown email'),
    heading: ok ? 'BOQ pack purchased' : 'Stripe payment needs review',
    paragraphs: ok
      ? [
        (email || 'A customer') + ' bought a ' + amount + ' pack — ' + credits + ' BOQ credit' + (credits === 1 ? '' : 's') + ' added.',
        balanceAfter != null ? 'Their balance is now ' + fmtRemaining(balanceAfter) + '.' : '',
        'Stripe session: ' + (sessionId || 'n/a'),
      ].filter(Boolean)
      : [
        'A paid Stripe checkout for ' + amount + ' from ' + (email || 'an unknown email') + ' could not be applied automatically (' + status + ').',
        'It has been recorded in pending credits and will auto-claim if that email logs in — but check it hasn\'t been lost.',
        'Stripe session: ' + (sessionId || 'n/a'),
      ],
  }).catch(() => {});
}

module.exports = { notifyCreditSpent, notifyPackPurchased, LOW_BALANCE_AT, TOPUP_OPTIONS, ADMIN_EMAIL };

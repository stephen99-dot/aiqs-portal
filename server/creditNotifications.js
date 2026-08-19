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
//   runCreditReminders() / start()       — once a balance hits zero we anchor
//     users.credits_out_at and a scheduled sweep (same setInterval pattern as
//     paymentReminders.js) chases the top-up on day 2, 4, 6, 8 and 10, then
//     sends one final "you know where we are" email on day 12 and goes quiet.
//     The sweep checks the live balance each pass, so a top-up (Stripe pack,
//     admin grant, anything) stops the drip and re-arms it for next time.
//
// All sends are fire-and-forget: a mail failure must never break a submission
// or a webhook.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');
const mailer = require('./mailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';
const LOW_BALANCE_AT = 2;

// Self-contained migrations, same try/alter pattern as routes.js.
try { db.exec('ALTER TABLE users ADD COLUMN credits_out_at DATETIME'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN credit_reminder_stage INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN credit_reminder_last_at DATETIME'); } catch (e) {}

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
    const out = n === 0;
    if (out) {
      // Anchor the top-up reminder drip. Always restamp: if they topped up and
      // ran dry again between sweeps, the drip must restart from this run-out.
      try {
        db.prepare('UPDATE users SET credits_out_at = CURRENT_TIMESTAMP, credit_reminder_stage = 0 WHERE id = ?').run(user.id);
      } catch (e) { console.error('[Credits] could not anchor run-out:', e.message); }
    }

    mailer.sendMail({
      userId: user.id,
      type: out ? 'credit_out' : 'credit_low',
      to: user.email,
      subject: out
        ? 'You\'re OUT of BOQ credits — top up to price your next job'
        : 'LOW credit balance — ' + fmtRemaining(n) + ' left. Top up now',
      heading: out ? 'You\'re out of BOQ credits' : 'Your BOQ credits are running low',
      paragraphs: [
        out
          ? 'That was your last credit — your balance is now zero, so your next job can\'t be priced until you top up.'
          : 'You have ' + fmtRemaining(n) + ' remaining — top up now so your next job isn\'t held up.',
        'Choose the pack that suits you:',
        ...TOPUP_OPTIONS.map((o) => ({ button: true, label: o.label, url: o.url })),
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

// ═══════════════════════════════════════════════════════════════════════════════
// TOP-UP REMINDER DRIP — days after the balance hit zero. Stages 1-5 chase the
// top-up every other day; stage 6 is the sign-off, after which we go quiet.
// ═══════════════════════════════════════════════════════════════════════════════

const packButtons = () => TOPUP_OPTIONS.map((o) => ({ button: true, label: o.label, url: o.url }));

const CREDIT_STAGES = [
  {
    stage: 1, afterDays: 2,
    subject: 'Still out of BOQ credits — top up when you\'re ready',
    heading: 'Ready for your next job?',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', your BOQ credit balance is still at zero — a quick top-up and you\'re pricing jobs again.',
      'Choose the pack that suits you:',
      ...packButtons(),
      'Credits are added to your account the moment payment completes.',
    ],
  },
  {
    stage: 2, afterDays: 4,
    subject: 'Your AI QS is ready when you are — top up to price your next job',
    heading: 'Your AI QS is ready when you are',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', just a reminder that your account is out of BOQ credits.',
      'Top up now and your next set of drawings can be priced the moment it lands:',
      ...packButtons(),
    ],
  },
  {
    stage: 3, afterDays: 6,
    subject: 'Got a job to price? Your credits are still at zero',
    heading: 'Got a job that needs pricing?',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', your BOQ credits are still at zero — if there\'s a job on your desk, a top-up gets it priced today.',
      'Packs start at £150, and the bigger packs work out much cheaper per BOQ:',
      ...packButtons(),
    ],
  },
  {
    stage: 4, afterDays: 8,
    subject: 'Top up your BOQ credits — packs from £150',
    heading: 'Top up and keep pricing',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', a quick nudge — your account still has no BOQ credits.',
      'The 20-BOQ pack brings each priced job down to £49:',
      ...packButtons(),
    ],
  },
  {
    stage: 5, afterDays: 10,
    subject: 'Don\'t get caught out — top up before the next job lands',
    heading: 'Don\'t let the next job wait',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', your BOQ balance has been at zero for over a week now.',
      'Top up today and the next job goes straight through with no hold-up:',
      ...packButtons(),
    ],
  },
  {
    stage: 6, afterDays: 12,
    subject: 'We\'ll leave you be — here whenever you need us',
    heading: 'You know where we are',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', this is our last reminder about your credits — we won\'t keep filling your inbox.',
      'Whenever you\'ve got drawings to price, a BOQ to check or anything else, your account is right where you left it. Top up any time and you\'re straight back in business:',
      ...packButtons(),
      'Good luck with the jobs — we\'re here when you need us.',
    ],
  },
];

async function runCreditReminders() {
  if (!mailer.isConfigured()) return; // nothing to do without SMTP

  let candidates;
  try {
    candidates = db.prepare(`
      SELECT id, email, full_name, free_credits, bonus_docs, credits_out_at, credit_reminder_stage
      FROM users
      WHERE role = 'client'
        AND COALESCE(suspended, 0) = 0
        AND credits_out_at IS NOT NULL
        AND email IS NOT NULL AND email != ''
        AND COALESCE(credit_reminder_stage, 0) < ${CREDIT_STAGES[CREDIT_STAGES.length - 1].stage}
    `).all();
  } catch (err) {
    console.error('[Credits] reminder query failed:', err.message);
    return;
  }

  for (const u of candidates) {
    try {
      // Topped up since running out (Stripe, admin grant, anything)? Stop the
      // drip and re-arm it for the next run-out.
      if ((u.free_credits || 0) + (u.bonus_docs || 0) > 0) {
        db.prepare('UPDATE users SET credits_out_at = NULL, credit_reminder_stage = 0 WHERE id = ?').run(u.id);
        continue;
      }

      // credits_out_at is SQLite's 'YYYY-MM-DD HH:MM:SS' in UTC — normalise to ISO.
      const outIso = String(u.credits_out_at).replace(' ', 'T').replace(/Z?$/, 'Z');
      const days = (Date.now() - new Date(outIso).getTime()) / 86400000;
      // Highest stage whose threshold has passed and that hasn't been sent yet.
      const target = [...CREDIT_STAGES].reverse().find(s => days >= s.afterDays && s.stage > (u.credit_reminder_stage || 0));
      if (!target) continue;

      const ctx = { first: (u.full_name || '').trim().split(/\s+/)[0] || '' };
      const mail = await mailer.sendMail({
        userId: u.id,
        type: 'credit_topup_reminder_' + target.stage,
        to: u.email,
        subject: target.subject,
        heading: target.heading,
        paragraphs: target.paragraphs(ctx),
        ctaText: 'Top up your credits',
        ctaUrl: mailer.BASE_URL + '/dashboard',
      });

      if (mail.ok) {
        db.prepare('UPDATE users SET credit_reminder_stage = ?, credit_reminder_last_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(target.stage, u.id);
      }
    } catch (err) {
      console.error('[Credits] reminder for ' + u.email + ' failed:', err.message);
    }
  }
}

// Sweep shortly after boot, then twice a day — each stage fires once, so the
// extra runs are harmless and cover servers that restart often.
function start() {
  const boot = setTimeout(() => runCreditReminders().catch(() => {}), 60 * 1000);
  if (boot.unref) boot.unref();
  const timer = setInterval(() => runCreditReminders().catch(() => {}), 12 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { notifyCreditSpent, notifyPackPurchased, runCreditReminders, start, LOW_BALANCE_AT, TOPUP_OPTIONS, ADMIN_EMAIL };

// ═══════════════════════════════════════════════════════════════════════════════
// Black Friday 2026 — server/blackFriday.js   (router mounted at /api/black-friday)
//
//   GET  /api/black-friday           is the sale on, when it ends, the four
//                                    deals, and whether this account should be
//                                    offered them (not admins or Unlimited)
//   POST /api/black-friday/checkout  { deal } → a Stripe Checkout URL for that
//                                    deal, stamped with this account
//
// The deals are BOQ credits ("jobs") at sale prices:
//
//     1 job   £150 → £99      5 jobs  £349 → £229
//    10 jobs  £580 → £349    20 jobs  £980 → £589
//
// Why a Checkout Session and not four more Payment Links: the webhook turns a
// one-off payment into credits BY AMOUNT (stripe-webhook resolvePackCredits),
// and the sale's 10 jobs for £349 is exactly the normal 5-pack's amount — a
// Payment Link would land 5 credits. Each session made here carries
// metadata.boq_credits, which the webhook reads before it looks at the amount,
// so every deal lands the jobs it promised. Only this server (holding the
// Stripe secret key) can create sessions, so the metadata can be trusted.
//
// The sale runs from BLACK_FRIDAY_STARTS_AT to BLACK_FRIDAY_ENDS_AT (ISO
// times; defaults: Black Friday 27 Nov 2026 to 23:59 on Monday 30 Nov, UK
// time — GMT in November, so Z is UK time). BLACK_FRIDAY_ENABLED=0 switches
// it off early. Once it ends, checkout refuses and the popup stops showing;
// sessions already opened can still be paid and still land the right credits.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const db = require('./database');
const { authMiddleware } = require('./auth');
const { rateLimit } = require('./publicRateLimit');

const PROMO = 'black_friday_2026';
const DEFAULT_STARTS_AT = '2026-11-27T00:00:00Z';
const DEFAULT_ENDS_AT = '2026-11-30T23:59:59Z'; // the whole of the 23:59 minute

const DEALS = [
  { key: 'bf_1', tag: 'Try us out', jobs: 1, was: 150, price: 99 },
  { key: 'bf_5', tag: 'Starter package', jobs: 5, was: 349, price: 229 },
  { key: 'bf_10', tag: 'Recommended', jobs: 10, was: 580, price: 349, featured: true },
  { key: 'bf_20', tag: 'Best value', jobs: 20, was: 980, price: 589 },
];

function parseTime(value, fallback) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : Date.parse(fallback);
}

function saleWindow() {
  return {
    startsAt: parseTime(process.env.BLACK_FRIDAY_STARTS_AT, DEFAULT_STARTS_AT),
    endsAt: parseTime(process.env.BLACK_FRIDAY_ENDS_AT, DEFAULT_ENDS_AT),
  };
}

function isActive(now = Date.now()) {
  if (process.env.BLACK_FRIDAY_ENABLED === '0') return false;
  const w = saleWindow();
  return now >= w.startsAt && now < w.endsAt;
}

function dealFor(key) {
  return DEALS.find((d) => d.key === key) || null;
}

// Deals as the popup shows them: what's saved and the price per job.
function publicDeals() {
  return DEALS.map((d) => ({
    ...d,
    featured: !!d.featured,
    save: d.was - d.price,
    per_job: Math.round((d.price / d.jobs) * 100) / 100,
  }));
}

// BOQ credits stamped on a checkout this server created. 0 when the session
// carries none (Payment Links), so the webhook falls back to the amount.
function creditsFromMetadata(session) {
  const m = session && session.metadata;
  if (!m || m.boq_credits == null) return 0;
  const n = Number(m.boq_credits);
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : 0;
}

// Accounts that never run out of BOQs (admins, the Unlimited plan) have
// nothing to buy, so they aren't offered the sale.
function eligible(user) {
  if (!user) return false;
  try {
    return !require('./boqCredits').getBoqBalance(user.id).unlimited;
  } catch (e) {
    return user.role !== 'admin';
  }
}

function portalUrl() {
  return String(process.env.PORTAL_URL || process.env.PORTAL_BASE_URL || 'https://aiqs-portal.onrender.com').replace(/\/+$/, '');
}

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) || req.user;
  const w = saleWindow();
  const deals = publicDeals();
  res.json({
    promo: PROMO,
    active: isActive(),
    starts_at: new Date(w.startsAt).toISOString(),
    ends_at: new Date(w.endsAt).toISOString(),
    eligible: eligible(user),
    can_buy: !!process.env.STRIPE_SECRET_KEY,
    max_save: Math.max(...deals.map((d) => d.save)),
    deals,
  });
});

router.post('/checkout', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  if (!isActive()) return res.status(410).json({ error: 'The Black Friday sale has ended.' });
  const deal = dealFor(String((req.body && req.body.deal) || ''));
  if (!deal) return res.status(400).json({ error: 'That deal does not exist.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Online checkout is not switched on — email hello@theaiqs.co.uk and we will set it up.' });

  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  const jobsText = deal.jobs === 1 ? '1 job' : deal.jobs + ' jobs';
  const metadata = { promo: PROMO, deal: deal.key, boq_credits: String(deal.jobs), user_id: user.id };
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: deal.price * 100,
          product_data: {
            name: 'AI QS — ' + jobsText + ' (Black Friday)',
            description: jobsText + ' (BOQ credit' + (deal.jobs === 1 ? '' : 's') + ') for your AI QS account. Was £' + deal.was + ', save £' + (deal.was - deal.price) + '.',
          },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
      success_url: portalUrl() + '/payment-success?credits=1',
      cancel_url: portalUrl() + '/dashboard?deals=1',
    });
    console.log(`[BlackFriday] Checkout ${session.id} opened for ${user.email}: ${deal.key} (${jobsText}, £${deal.price})`);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[BlackFriday] checkout error:', err && err.message);
    res.status(502).json({ error: 'Could not open the checkout' + (err && err.message ? ': ' + err.message : '.') });
  }
});

module.exports = { PROMO, DEALS, saleWindow, isActive, dealFor, publicDeals, creditsFromMetadata, router };

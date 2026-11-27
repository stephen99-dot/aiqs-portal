// ═══════════════════════════════════════════════════════════════════════════════
// Black Friday 2026 — server/blackFriday.js   (router mounted at /api/black-friday)
//
//   GET  /api/black-friday           is the sale on, when it ends, the four
//                                    deals, and whether this account should be
//                                    offered them (not admins or Unlimited)
//   POST /api/black-friday/checkout  { deal } → a Stripe Checkout URL for that
//                                    deal, stamped with this account
//   GET  /api/public/black-friday/start|done   the same for the website, where
//                                    the visitor isn't signed in (see below)
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

const jobsText = (n) => (n === 1 ? '1 job' : n + ' jobs');

// A Stripe Checkout Session for one deal. Signed in (`user`): stamped with the
// account, back to the portal. From the website (no user): Stripe asks for the
// email, and afterwards /done sends them to log in or create the account under
// it — the webhook has already put the credits on it, or holds them until the
// account exists (pending_credits).
// Named like the normal packs ("BOQ Credit Pack (10 credits)"), so checkout,
// the receipt, the invoice and the purchase email all read the same.
const packName = (n) => 'BOQ Credit Pack (' + n + (n === 1 ? ' credit' : ' credits') + ') — Black Friday';

async function createCheckout(deal, { user = null } = {}) {
  const metadata = { promo: PROMO, deal: deal.key, boq_credits: String(deal.jobs), source: user ? 'portal' : 'website' };
  if (user) metadata.user_id = user.id;
  const description = jobsText(deal.jobs) + ' (BOQ credit' + (deal.jobs === 1 ? '' : 's') + ') for your AI QS account. Was £' + deal.was + ', save £' + (deal.was - deal.price) + '.';
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...(user ? { client_reference_id: user.id, customer_email: user.email || undefined } : {}),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: deal.price * 100,
        product_data: { name: packName(deal.jobs), description },
      },
    }],
    // What a trade buyer needs for their books: the billing address, the
    // company name and VAT number (Stripe's "I'm purchasing as a business"
    // tick box), a Stripe customer record, and a paid invoice afterwards. The
    // invoice has no subscription, so the webhook's invoice.paid handler
    // leaves it alone; the credits come from checkout.session.completed.
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    customer_creation: 'always',
    invoice_creation: {
      enabled: true,
      invoice_data: { description: packName(deal.jobs) + ': ' + description, metadata, footer: 'The AI QS — theaiqs.co.uk' },
    },
    metadata,
    payment_intent_data: { metadata },
    success_url: user ? portalUrl() + '/payment-success?credits=1' : portalUrl() + '/api/public/black-friday/done?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: user ? portalUrl() + '/dashboard?deals=1' : websiteUrl() + '/#pricing',
  });
  console.log(`[BlackFriday] Checkout ${session.id} opened ${user ? 'for ' + user.email : 'from the website'}: ${deal.key} (${jobsText(deal.jobs)}, £${deal.price})`);
  return session;
}

router.post('/checkout', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  if (!isActive()) return res.status(410).json({ error: 'The Black Friday sale has ended.' });
  const deal = dealFor(String((req.body && req.body.deal) || ''));
  if (!deal) return res.status(400).json({ error: 'That deal does not exist.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Online checkout is not switched on — email hello@theaiqs.co.uk and we will set it up.' });

  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  try {
    const session = await createCheckout(deal, { user });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[BlackFriday] checkout error:', err && err.message);
    res.status(502).json({ error: 'Could not open the checkout' + (err && err.message ? ': ' + err.message : '.') });
  }
});

// ── Public: the website (theaiqs.co.uk), mounted at /api/public/black-friday ──
//
//   GET /start?deal=bf_10        straight to Stripe Checkout for that deal; once
//                                the sale is over (or for a deal that doesn't
//                                exist) back to the website's prices instead
//   GET /done?session_id=cs_…    Stripe's return: log in, or create the account
//                                with the email they paid with — then
//                                /payment-success shows the new credits
function websiteUrl() {
  return String(process.env.WEBSITE_URL || 'https://theaiqs.co.uk').replace(/\/+$/, '');
}

const publicRouter = express.Router();
publicRouter.use(rateLimit({ windowMs: 60_000, max: 30 }));

publicRouter.get('/start', async (req, res) => {
  const deal = dealFor(String(req.query.deal || ''));
  if (!deal || !isActive() || !process.env.STRIPE_SECRET_KEY) return res.redirect(302, websiteUrl() + '/#pricing');
  try {
    const session = await createCheckout(deal);
    res.redirect(303, session.url);
  } catch (err) {
    console.error('[BlackFriday] website checkout error:', err && err.message);
    res.status(502).type('html').send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout unavailable</title>'
      + '<body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;line-height:1.6;color:#111">'
      + '<h1 style="font-size:22px">The checkout didn’t open</h1><p>Nothing has been charged. Please go back and try again in a moment, or email '
      + '<a href="mailto:hello@theaiqs.co.uk">hello@theaiqs.co.uk</a> and we’ll sort it out.</p>'
      + '<p><a href="' + websiteUrl() + '/#pricing">Back to the Black Friday deals</a></p></body>'
    );
  }
});

const SESSION_MAX_AGE_S = 7 * 24 * 3600;
publicRouter.get('/done', async (req, res) => {
  const next = '/payment-success?credits=1';
  const to = (page, email, extra) => portalUrl() + page + '?' + new URLSearchParams({ ...(email ? { email } : {}), ...(extra || {}), next }).toString();
  const id = String(req.query.session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(id) || !process.env.STRIPE_SECRET_KEY) return res.redirect(302, to('/login'));
  try {
    const session = await require('stripe')(process.env.STRIPE_SECRET_KEY).checkout.sessions.retrieve(id);
    if (!session || !session.metadata || session.metadata.promo !== PROMO) return res.redirect(302, to('/login'));
    if (session.created && Date.now() / 1000 - session.created > SESSION_MAX_AGE_S) return res.redirect(302, to('/login'));
    const email = String((session.customer_details && session.customer_details.email) || session.customer_email || '').trim().toLowerCase();
    const account = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email) : null;
    if (account || !email) return res.redirect(302, to('/login', email));
    return res.redirect(302, to('/register', email, { from: 'blackfriday' }));
  } catch (err) {
    console.warn('[BlackFriday] return lookup failed:', err && err.message);
    return res.redirect(302, to('/login'));
  }
});

// ── The website's chat assistant, while the sale runs ───────────────────────
// Added to its instructions (siteChatRoutes) so it quotes the sale prices and
// doesn't offer the free first job, which is paused until the sale ends.
function endsText() {
  const end = new Date(saleWindow().endsAt);
  const tz = 'Europe/London';
  const time = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const atMidnight = time === '00:00';
  const day = new Date(end.getTime() - (atMidnight ? 1 : 0)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  return (atMidnight ? 'midnight' : time) + ' on ' + day + ' (UK time)';
}

function chatNote() {
  if (!isActive()) return '';
  return [
    'BLACK FRIDAY SALE — on now, until ' + endsText() + '. Until then this replaces THE OFFER and the BOQ PRICING above:',
    '- The free first job is paused during the sale. Do not offer it. If someone asks, say it comes back after the sale, and that the 1-job deal at £99 is the cheapest way to try us now.',
    '- A "job" is one BOQ (one BOQ credit). Sale prices, quote these exactly:',
    ...publicDeals().map((d) => '  ' + jobsText(d.jobs) + ': £' + d.price + ', was £' + d.was + ' (save £' + d.save + (d.jobs > 1 ? ', £' + d.per_job.toFixed(2) + ' per BOQ' : '') + ').'),
    '- The headline is 10 jobs for the price of 5. New customers, existing customers and credit top-ups all qualify. Credits never expire.',
    '- They buy from the Black Friday deals on this website: a secure Stripe checkout with no account needed first, then they log in or create their account with the same email and the credits are on it. Existing customers can also buy inside the portal.',
    '- Any local-currency prices in a VISITOR note are these sale prices converted; the charge itself is in pounds.',
  ].join('\n');
}

module.exports = { PROMO, DEALS, saleWindow, isActive, dealFor, publicDeals, creditsFromMetadata, chatNote, endsText, router, publicRouter };

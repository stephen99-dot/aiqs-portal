#!/usr/bin/env node
// Create the MAX packages at Stripe — two products, four recurring prices and
// four Payment Links — and print the environment variables to set on Render.
//
//   STRIPE_SECRET_KEY=sk_live_… PORTAL_URL=https://theaiqs.co.uk node scripts/create-max-plans.js
//
// Run it once per Stripe mode (test, then live). It never deletes or changes
// anything that exists: run twice and you get a second set, so set the env
// vars from the run you keep. Prices and names come from server/maxPlans.js,
// so the website, the webhook and Stripe agree on £59 / £590 and £79 / £790.
//
// Afterwards, in the Stripe dashboard:
//   • Developers → Webhooks: the portal's endpoint (/api/stripe/webhook) must
//     receive checkout.session.completed, customer.subscription.updated,
//     customer.subscription.deleted and invoice.paid (it already does if the
//     Office in a Box add-on was wired up).
//   • Settings → Billing → Customer portal: switch it on, so "Manage billing"
//     on the Plans page can show invoices and let the builder change the card.

const path = require('path');
const { PLANS, PLAN_KEYS } = require(path.join(__dirname, '..', 'server', 'maxPlans.js'));

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('Set STRIPE_SECRET_KEY (sk_test_… or sk_live_…) and run again.'); process.exit(1); }
  const portal = (process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com').replace(/\/$/, '');
  const stripe = require('stripe')(key);
  const mode = key.startsWith('sk_live') ? 'LIVE' : 'test';
  console.log(`Creating the MAX packages at Stripe (${mode} mode)…\n`);

  const env = {};
  const ids = { max: [], max_visualiser: [] };
  const linkVar = { max: 'MAX_PAYMENT_LINK', max_visualiser: 'MAX_VISUALISER_PAYMENT_LINK' };
  for (const k of PLAN_KEYS) {
    const plan = PLANS[k];
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.tagline,
      metadata: { aiqs_plan: k },
    });
    console.log(`Product  ${product.id}  ${plan.name}`);
    for (const [interval, gbp] of [['month', plan.monthly_gbp], ['year', plan.yearly_gbp]]) {
      const price = await stripe.prices.create({
        product: product.id,
        currency: 'gbp',
        unit_amount: gbp * 100,
        recurring: { interval },
        nickname: `${plan.name} — ${interval === 'year' ? 'yearly (two months free)' : 'monthly'}`,
        metadata: { aiqs_plan: k, aiqs_interval: interval },
      });
      ids[k].push(price.id);
      console.log(`  Price  ${price.id}  £${gbp} / ${interval}`);
      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        allow_promotion_codes: true,
        after_completion: { type: 'redirect', redirect: { url: `${portal}/payment-success?plan=max` } },
        metadata: { aiqs_plan: k, aiqs_interval: interval },
      });
      env[`${linkVar[k]}_${interval === 'year' ? 'YEARLY' : 'MONTHLY'}`] = link.url;
      console.log(`  Link   ${link.url}`);
    }
  }
  env.STRIPE_MAX_PRICE_IDS = ids.max.join(',');
  env.STRIPE_MAX_VISUALISER_PRICE_IDS = ids.max_visualiser.join(',');

  console.log('\nSet these on Render (Environment → Add) and the Plans page goes live on the next deploy:\n');
  for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
  console.log('\nThe success URL on every link is ' + portal + '/payment-success?plan=max — change PORTAL_URL if the website lives elsewhere.');
}

main().catch((err) => { console.error('\nStripe said:', err.message); process.exit(1); });

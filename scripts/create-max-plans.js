#!/usr/bin/env node
// Create the MAX packages at Stripe — two products, four recurring prices and
// four Payment Links — and print the environment variables to set on Render.
//
//   STRIPE_SECRET_KEY=sk_live_… PORTAL_URL=https://theaiqs.co.uk node scripts/create-max-plans.js
//
// Made the links already and want them to send customers somewhere else
// after paying? This updates the four links in place (nothing new is made,
// the link URLs do not change, Render needs no change):
//
//   STRIPE_SECRET_KEY=sk_live_… node scripts/create-max-plans.js --redirect https://aiqs-portal.onrender.com
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
  if (!key) {
    console.error('No key given. Run it as ONE line, with the key and the command together:\n'
      + '  STRIPE_SECRET_KEY=sk_live_… PORTAL_URL=https://theaiqs.co.uk node scripts/create-max-plans.js');
    process.exit(1);
  }
  if (!/^(sk|rk)_(live|test)_/.test(key)) {
    console.error('That is not a Stripe secret key (it should start with sk_live_ or sk_test_ and be about 100 characters).\n'
      + 'Stripe → Developers → API keys → Create secret key, and copy it from the popup.');
    process.exit(1);
  }
  const stripe = require('stripe')(key);
  const mode = key.startsWith('sk_live') ? 'LIVE' : 'test';
  const redirectArg = process.argv.indexOf('--redirect');
  if (redirectArg !== -1) return redirectLinks(stripe, mode, process.argv[redirectArg + 1]);
  const portal = (process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com').replace(/\/$/, '');
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

// Point every MAX payment link (the ones this script made, found by the
// aiqs_plan tag on them) at <site>/payment-success?plan=max.
async function redirectLinks(stripe, mode, site) {
  const base = String(site || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(base)) {
    console.error('Give the website address after --redirect, e.g. --redirect https://aiqs-portal.onrender.com (no path, no trailing slash).');
    process.exit(1);
  }
  const url = base + '/payment-success?plan=max';
  console.log(`Pointing the MAX payment links at ${url} (${mode} mode)…\n`);
  const links = [];
  for await (const link of stripe.paymentLinks.list({ limit: 100 })) if (link.active && link.metadata && link.metadata.aiqs_plan) links.push(link);
  if (!links.length) { console.error('No MAX payment links found in this Stripe mode. Create them first (run without --redirect).'); process.exit(1); }
  for (const link of links) {
    const was = link.after_completion && link.after_completion.redirect && link.after_completion.redirect.url;
    if (was === url) { console.log(`  ${link.url}  already right`); continue; }
    await stripe.paymentLinks.update(link.id, { after_completion: { type: 'redirect', redirect: { url } } });
    console.log(`  ${link.url}  ${link.metadata.aiqs_plan} ${link.metadata.aiqs_interval || ''}  ${was || '(confirmation page)'} → ${url}`);
  }
  console.log(`\nDone: ${links.length} link(s). The link URLs are unchanged, so Render needs nothing.`);
}

main().catch((err) => { console.error('\nStripe said:', err.message); process.exit(1); });

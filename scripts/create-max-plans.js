#!/usr/bin/env node
// Create the MAX packages at Stripe — two products, four recurring prices and
// four Payment Links — and print the environment variables to set on Render.
//
//   STRIPE_SECRET_KEY=sk_live_… PORTAL_URL=https://theaiqs.co.uk node scripts/create-max-plans.js
//
// Made the links already and want them to send customers somewhere else
// after paying? This updates the four links in place (nothing new is made,
// the link URLs do not change, Render needs no change). It also adds the
// checkout id to the address, which lets the page after checkout greet a
// buyer from the website who is not signed in — "create your account with
// you@example.com" or "log in":
//
//   STRIPE_SECRET_KEY=sk_live_… node scripts/create-max-plans.js --redirect https://aiqs-portal.onrender.com
//
// The free trial (TRIAL_DAYS in server/maxPlans.js, or MAX_TRIAL_DAYS) onto
// the four links, in place — same URLs, nothing to change on Render. From the
// Render shell, where the key is already set, it is just:
//
//   node scripts/create-max-plans.js --trial        the trial the website shows
//   node scripts/create-max-plans.js --trial 7      a set number of days
//   node scripts/create-max-plans.js --trial 0      take the trial off
//
// The links are found by the MAX_PAYMENT_LINK_… URLs set on Render and by the
// aiqs_plan tag this script puts on the links it makes. Only new checkouts
// get the change: anyone already subscribed is left exactly as they are.
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
const { PLANS, PLAN_KEYS, trialDays, paymentLinks } = require(path.join(__dirname, '..', 'server', 'maxPlans.js'));

// Changing the trial on an existing Payment Link arrived in this Stripe API
// version, newer than the one the installed library defaults to. Only the
// --trial run asks for it; nothing else here changes.
const TRIAL_API_VERSION = '2024-12-18.acacia';

// Where a buyer lands after checkout. Stripe fills in {CHECKOUT_SESSION_ID}.
function successUrl(site) {
  return String(site).replace(/\/$/, '') + '/payment-success?plan=max&session_id={CHECKOUT_SESSION_ID}';
}

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
  const mode = key.startsWith('sk_live') ? 'LIVE' : 'test';
  const trialArg = process.argv.indexOf('--trial');
  if (trialArg !== -1) return trialLinks(require('stripe')(key, { apiVersion: TRIAL_API_VERSION }), mode, process.argv[trialArg + 1]);
  const stripe = require('stripe')(key);
  const redirectArg = process.argv.indexOf('--redirect');
  if (redirectArg !== -1) return redirectLinks(stripe, mode, process.argv[redirectArg + 1]);
  const portal = (process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com').replace(/\/$/, '');
  const trial = trialDays();
  console.log(`Creating the MAX packages at Stripe (${mode} mode)${trial ? `, each with a ${trial}-day free trial` : ''}…\n`);

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
        after_completion: { type: 'redirect', redirect: { url: successUrl(portal) } },
        ...(trial ? { subscription_data: { trial_period_days: trial } } : {}),
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
  console.log('\nThe success URL on every link is ' + successUrl(portal) + ' — change PORTAL_URL if the portal lives elsewhere.');
}

// Point every MAX payment link (the ones this script made, found by the
// aiqs_plan tag on them, and the ones set on Render) at
// <site>/payment-success?plan=max&session_id={CHECKOUT_SESSION_ID}.
async function redirectLinks(stripe, mode, site) {
  const base = String(site || '').trim().replace(/\/$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(base)) {
    console.error('Give the website address after --redirect, e.g. --redirect https://aiqs-portal.onrender.com (no path, no trailing slash).');
    process.exit(1);
  }
  const url = successUrl(base);
  console.log(`Pointing the MAX payment links at ${url} (${mode} mode)…\n`);
  const configured = new Set();
  const pl = paymentLinks();
  for (const k of PLAN_KEYS) for (const i of ['month', 'year']) if (pl[k] && pl[k][i]) configured.add(pl[k][i].trim());
  const links = [];
  for await (const link of stripe.paymentLinks.list({ limit: 100 })) if (link.active && ((link.metadata && link.metadata.aiqs_plan) || configured.has(link.url))) links.push(link);
  if (!links.length) { console.error('No MAX payment links found in this Stripe mode. Create them first (run without --redirect).'); process.exit(1); }
  for (const link of links) {
    const was = link.after_completion && link.after_completion.redirect && link.after_completion.redirect.url;
    if (was === url) { console.log(`  ${link.url}  already right`); continue; }
    await stripe.paymentLinks.update(link.id, { after_completion: { type: 'redirect', redirect: { url } } });
    console.log(`  ${link.url}  ${(link.metadata && link.metadata.aiqs_plan) || ''} ${(link.metadata && link.metadata.aiqs_interval) || ''}  ${was || '(confirmation page)'} → ${url}`);
  }
  console.log(`\nDone: ${links.length} link(s). The link URLs are unchanged, so Render needs nothing.`);
}

// Put the free trial on every MAX payment link: the ones whose URLs are set
// on Render (MAX_PAYMENT_LINK_…) and the ones this script made. 0 takes it off.
async function trialLinks(stripe, mode, arg) {
  const given = arg !== undefined && !String(arg).startsWith('--');
  const days = given ? Number(arg) : trialDays();
  if (!Number.isInteger(days) || days < 0 || days > 730) {
    console.error('Give the trial as a whole number of days after --trial, e.g. --trial 7 (or --trial 0 to take it off).');
    process.exit(1);
  }
  if (given && days !== trialDays()) {
    console.warn(`Note: the Plans page says ${trialDays() ? trialDays() + ' days free' : 'there is no free trial'}. Set MAX_TRIAL_DAYS=${days} on Render so it matches.\n`);
  }
  console.log(days ? `Putting a ${days}-day free trial on the MAX payment links (${mode} mode)…\n` : `Taking the free trial off the MAX payment links (${mode} mode)…\n`);

  // Which link is which: by the URL on Render first, then by the tag.
  const wanted = {};
  const configured = paymentLinks();
  for (const k of PLAN_KEYS) for (const interval of ['month', 'year']) {
    const url = configured[k] && configured[k][interval];
    if (url) wanted[url.trim()] = `${k} ${interval}ly`;
  }
  const links = [];
  for await (const link of stripe.paymentLinks.list({ limit: 100 })) {
    if (!link.active) continue;
    if (wanted[link.url] || (link.metadata && link.metadata.aiqs_plan)) links.push(link);
  }
  const missing = Object.keys(wanted).filter((u) => !links.some((l) => l.url === u));
  if (!links.length) {
    console.error('No MAX payment links found in this Stripe mode. Check the key is the ' + (mode === 'LIVE' ? 'live' : 'test') + ' one the links were made with, or create them first (run without --trial).');
    process.exit(1);
  }

  let changed = 0;
  for (const link of links) {
    const label = wanted[link.url] || `${link.metadata.aiqs_plan} ${link.metadata.aiqs_interval ? link.metadata.aiqs_interval + 'ly' : ''}`.trim();
    const was = (link.subscription_data && link.subscription_data.trial_period_days) || 0;
    // A trial must still take the card at checkout, or nothing can be charged
    // when it ends. Links made in the dashboard can be set to skip it.
    const needsCard = days > 0 && link.payment_method_collection && link.payment_method_collection !== 'always';
    if (was === days && !needsCard) { console.log(`  ${link.url}  ${label}  already ${days ? days + ' days free' : 'no trial'}`); continue; }
    // An empty value is how Stripe is told to remove the trial.
    await stripe.paymentLinks.update(link.id, {
      subscription_data: { trial_period_days: days || '' },
      ...(needsCard ? { payment_method_collection: 'always' } : {}),
    });
    if (needsCard) console.log(`  ${link.url}  ${label}  now always takes the card at checkout`);
    const now = await stripe.paymentLinks.retrieve(link.id);
    const set = (now.subscription_data && now.subscription_data.trial_period_days) || 0;
    if (set !== days) {
      console.error(`  ${link.url}  ${label}  Stripe accepted the change but the link still shows ${set ? set + ' days' : 'no trial'}. Set it in the dashboard: Payment Links → this link → Edit → Include a free trial.`);
      process.exitCode = 1;
      continue;
    }
    changed += 1;
    console.log(`  ${link.url}  ${label}  ${was ? was + ' days' : 'no trial'} → ${days ? days + ' days free' : 'no trial'}`);
  }
  for (const u of missing) console.warn(`  ${u}  ${wanted[u]}  is set on Render but is not an active link in this Stripe mode — not changed.`);
  console.log(`\nDone: ${changed} link(s) changed, ${links.length - changed} already right or not changed. The link URLs are unchanged, so Render needs nothing.`);
  console.log('Only new checkouts get this. Subscriptions that already exist keep the terms they signed up on.');
}

main().catch((err) => { console.error('\nStripe said:', err.message); process.exit(1); });

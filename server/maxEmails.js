// ═══════════════════════════════════════════════════════════════════════════════
// MAX emails — server/maxEmails.js
//
// The email a MAX checkout sends, chosen by whether the buyer has an account:
//
//   started        the checkout matched an account: congratulations, MAX is
//                  unlocked, here is what to do first (and, on a free trial,
//                  the day it ends and what is taken then)
//   createAccount  bought on the website with an email that has no account
//                  yet: create one with that email and MAX switches on by
//                  itself (billingRoutes.attachByEmail runs at sign-up)
//
// The icons are PNGs rendered from the SVG sources in public/email-icons
// (scripts/build-email-icons.js) and served by the portal: Gmail strips inline
// SVG and refuses .svg images, and Outlook drops both. The layout is tables
// with inline styles, which every client renders the same way.
// ═══════════════════════════════════════════════════════════════════════════════

const plans = require('./maxPlans');

function portalUrl() {
  return String(process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com').replace(/\/+$/, '');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

function priceText(sub) {
  const plan = plans.PLANS[sub.plan];
  return sub.interval === 'year' ? `£${plan.yearly_gbp} a year (two months free)` : `£${plan.monthly_gbp} a month`;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// ── Building blocks ──────────────────────────────────────────────────────────

function button(label, href) {
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
            <tr><td align="center" bgcolor="#F59E0B" style="border-radius:10px;background:#F59E0B;">
              <a href="${esc(href)}" style="display:inline-block;padding:15px 36px;font-family:${FONT};font-size:16px;font-weight:700;color:#0A0F1C;text-decoration:none;border-radius:10px;">${esc(label)}</a>
            </td></tr>
          </table>`;
}

// One "what you can do" line: a 40px icon tile beside a bold lead and a line.
function featureRow(icon, lead, text, last) {
  return `
              <tr>
                <td width="40" valign="top" style="padding-bottom:${last ? 0 : 18}px;">
                  <img src="${portalUrl()}/email-icons/${icon}.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;" />
                </td>
                <td valign="top" style="padding:1px 0 ${last ? 0 : 18}px 14px;font-family:${FONT};font-size:14px;line-height:1.55;color:#475569;">
                  <strong style="color:#0F172A;font-size:15px;">${lead}</strong><br/>${text}
                </td>
              </tr>`;
}

function features(sub) {
  const rows = [
    ['max-ask', 'Ask MAX to price a job', 'Describe it by text or voice &#8212; a patio, a bathroom, a garden wall &#8212; and MAX prices it from your own rates in about a minute.'],
    ['max-scan', 'Scan a room', 'Photos, sizes, doors and windows, finishes and notes per room. On an iPhone Pro the LiDAR scanner measures it and draws the plan for you.'],
    ['max-quote', 'Send it as a quote', 'Edit any line, then send the estimate to your customer with your logo on it, plus a branded survey report and Excel schedule.'],
  ];
  if (plans.PLANS[sub.plan] && plans.PLANS[sub.plan].visualiser) {
    rows.push(['max-visualiser', 'Show them the finished room', 'The Visualiser paints the work onto your own photo of the room, so the customer sees the result before you start.']);
  }
  return rows.map((r, i) => featureRow(r[0], r[1], r[2], i === rows.length - 1)).join('');
}

// The plan in a box: on a trial, when it ends and what is taken then.
function planBox(sub) {
  const plan = plans.PLANS[sub.plan];
  const row = (label, value, last) => `
              <tr>
                <td valign="top" style="padding:0 12px ${last ? 0 : 10}px 0;font-family:${FONT};font-size:13px;color:#92400E;white-space:nowrap;">${label}</td>
                <td valign="top" style="padding:0 0 ${last ? 0 : 10}px;font-family:${FONT};font-size:14px;font-weight:600;color:#0F172A;">${value}</td>
              </tr>`;
  const trial = sub.status === 'trialing';
  const ends = longDate(sub.trial_ends_at || sub.renews_at);
  const rows = trial
    ? [
        row('Your plan', esc(plan.name)),
        row('Free until', ends ? esc(ends) : 'the end of your free trial'),
        row('Then', esc(priceText(sub)) + (ends ? `, from ${esc(ends)}` : '')),
        row('To stop', 'Cancel on the Plans page before then and you pay nothing.', true),
      ]
    : [
        row('Your plan', esc(plan.name)),
        row('Billed', esc(priceText(sub))),
        row(sub.interval === 'year' ? 'Renews' : 'Next payment', esc(longDate(sub.renews_at) || 'at the end of the period'), true),
      ];
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;">
            <tr><td style="padding:18px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}
              </table>
            </td></tr>
          </table>`;
}

// Numbered steps drawn in HTML (no images), for the create-account email.
function steps(items) {
  return items.map(([lead, text], i) => `
              <tr>
                <td width="32" valign="top" style="padding-bottom:${i === items.length - 1 ? 0 : 16}px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="28" height="28" align="center" valign="middle" bgcolor="#0A0F1C" style="width:28px;height:28px;border-radius:14px;background:#0A0F1C;font-family:${FONT};font-size:13px;font-weight:700;color:#F59E0B;">${i + 1}</td>
                  </tr></table>
                </td>
                <td valign="top" style="padding:3px 0 ${i === items.length - 1 ? 0 : 16}px 12px;font-family:${FONT};font-size:14px;line-height:1.55;color:#475569;">
                  <strong style="color:#0F172A;">${lead}</strong> ${text}
                </td>
              </tr>`).join('');
}

function sectionTitle(text) {
  return `<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94A3B8;margin:0 0 14px;">${text}</div>`;
}

// The page every MAX email sits in: dark header with the logo, a white card,
// a quiet footer.
function layout({ title, preheader, heroIcon, heading, intro, body }) {
  const portal = portalUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F1F5F9" style="background:#F1F5F9;">
  <tr><td align="center" style="padding:28px 12px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td bgcolor="#0A0F1C" style="background:#0A0F1C;border-radius:16px 16px 0 0;padding:20px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:${FONT};font-size:24px;font-weight:800;color:#F8FAFC;letter-spacing:0.3px;">AI <span style="color:#F59E0B;">QS</span></td>
          <td align="right" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#F59E0B;">AI QS MAX</td>
        </tr></table>
      </td></tr>
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 16px 16px;padding:36px 32px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td align="center">
            <img src="${portal}/email-icons/${heroIcon}.png" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border:0;margin:0 auto 20px;" />
            <h1 style="margin:0 0 12px;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:800;color:#0F172A;">${heading}</h1>
            <p style="margin:0 0 28px;font-family:${FONT};font-size:15px;line-height:1.65;color:#475569;">${intro}</p>
          </td></tr>
          ${body}
        </table>
      </td></tr>
      <tr><td align="center" style="padding:22px 20px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#94A3B8;">
        Questions? Reply to this email &#8212; a person reads every one.<br/>
        AI QS &#183; TheAIQS Ltd &#183; <a href="https://theaiqs.co.uk" style="color:#94A3B8;">theaiqs.co.uk</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── The two emails ───────────────────────────────────────────────────────────

// The buyer has an account: MAX is unlocked.
function startedEmail({ user, sub }) {
  const plan = plans.PLANS[sub.plan];
  const portal = portalUrl();
  const first = esc(String((user && user.full_name) || '').trim().split(/\s+/)[0] || '');
  const trial = sub.status === 'trialing';
  const ends = longDate(sub.trial_ends_at || sub.renews_at);
  const subject = trial ? `Your free trial of ${plan.name} has started` : `${plan.name} is unlocked on your account`;
  const heading = `Congratulations${first ? ', ' + first : ''} &#8212; MAX is unlocked`;
  const intro = `<strong style="color:#0F172A;">${esc(plan.name)}</strong> is live on your AI QS account${user && user.email ? ` (${esc(user.email)})` : ''}. Everything below is switched on now &#8212; nothing to set up, nothing to install.`;
  const body = `
          <tr><td style="padding:0 0 28px;">${button('Open MAX', portal + '/dashboard')}</td></tr>
          <tr><td style="padding:0 0 28px;">${planBox(sub)}</td></tr>
          <tr><td style="padding:0 0 8px;">
            ${sectionTitle('What you can do now')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${features(sub)}
            </table>
          </td></tr>
          <tr><td style="padding:24px 0 0;border-top:1px solid #E2E8F0;font-family:${FONT};font-size:13px;line-height:1.6;color:#64748B;">
            MAX is in the portal and the AI QS app on iPhone &amp; Android &#8212; sign in with this email. Change or cancel your plan any time on the <a href="${portal}/upgrade" style="color:#B45309;font-weight:600;">Plans page</a>.
          </td></tr>`;
  const preheader = trial && ends
    ? `MAX is unlocked on your account and free until ${ends}.`
    : 'MAX is unlocked on your account — price your first job now.';
  return { subject, html: layout({ title: subject, preheader, heroIcon: 'max-unlocked-hero', heading, intro, body }) };
}

// Bought on the website with an email that has no account yet.
function createAccountEmail({ email, name, sub }) {
  const plan = plans.PLANS[sub.plan];
  const portal = portalUrl();
  const addr = String(email || '').trim().toLowerCase();
  const first = esc(String(name || '').trim().split(/\s+/)[0] || '');
  const trial = sub.status === 'trialing';
  const register = `${portal}/register?email=${encodeURIComponent(addr)}&from=max&next=${encodeURIComponent('/payment-success?plan=max')}`;
  const subject = `One step left: create your AI QS account to use ${plan.short}`;
  const heading = trial
    ? `${first ? 'Thanks, ' + first + '! ' : ''}Your free trial has started`
    : `${first ? 'Thanks, ' + first + '! ' : ''}You're on ${esc(plan.short)}`;
  const intro = `One step left: create your AI QS account with <strong style="color:#0F172A;">${esc(addr)}</strong> &#8212; the email you used at checkout &#8212; and ${esc(plan.name)} switches on the moment you're in.`;
  const body = `
          <tr><td style="padding:0 0 28px;">${button('Create my account', register)}</td></tr>
          <tr><td style="padding:0 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps([
              ['Create your account', `with ${esc(addr)}. Prefer Google? Choose &#8220;Sign up with Google&#8221; with the same address.`],
              ['MAX switches on by itself.', 'No codes, nothing to activate &#8212; your plan is already waiting for that email.'],
              ['Price your first job.', 'Ask MAX by text or voice, or scan a room on site.'],
            ])}
            </table>
          </td></tr>
          <tr><td style="padding:0 0 28px;">${planBox(sub)}</td></tr>
          <tr><td style="padding:0 0 8px;">
            ${sectionTitle('What is waiting for you')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${features(sub)}
            </table>
          </td></tr>
          <tr><td style="padding:24px 0 0;border-top:1px solid #E2E8F0;font-family:${FONT};font-size:13px;line-height:1.6;color:#64748B;">
            Already have an AI QS account under a different email? Reply to this email and we will move ${esc(plan.short)} across for you.
          </td></tr>`;
  const preheader = `Create your account with ${addr} and ${plan.short} switches on straight away.`;
  return { subject, html: layout({ title: subject, preheader, heroIcon: 'max-account-hero', heading, intro, body }) };
}

function send(to, mail) {
  try {
    const { sendEmail } = require('./routes'); // lazy — avoids a load-order tangle
    if (!to || typeof sendEmail !== 'function') return;
    Promise.resolve(sendEmail({ to, subject: mail.subject, html: mail.html })).catch((err) => console.error('[MAX email] failed:', err.message));
  } catch (err) {
    console.error('[MAX email] failed:', err.message);
  }
}

function sendStarted({ user, sub }) { if (user && sub && plans.PLANS[sub.plan]) send(user.email, startedEmail({ user, sub })); }
function sendCreateAccount({ email, name, sub }) { if (email && sub && plans.PLANS[sub.plan]) send(String(email).trim().toLowerCase(), createAccountEmail({ email, name, sub })); }

module.exports = { startedEmail, createAccountEmail, sendStarted, sendCreateAccount };

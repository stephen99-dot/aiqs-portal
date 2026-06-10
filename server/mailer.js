// ═══════════════════════════════════════════════════════════════════════════════
// A2 — MAILER — server/mailer.js
//
// The ONE module that sends Office-in-a-Box email (quote sends, invoice sends,
// variation sends, acceptance notifications, payment reminders). Distinct from
// the platform emails in routes.js: these go out in the BUILDER's branding
// (user_branding logo + colours) with reply-to set to the builder, so to the
// client it reads as mail from their builder, not from AI QS.
//
// Env (matches the existing routes.js conventions, plus the documented names):
//   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465)
//   SMTP_USER | SMTP_EMAIL, SMTP_PASS | SMTP_PASSWORD
//   MAIL_FROM (default the SMTP user), PORTAL_URL (absolute links)
//
// If SMTP isn't configured the send endpoints still work: sendMail() logs the
// attempt as delivery 'manual' and the UI falls back to "copy the link and
// send it by WhatsApp/text" — which it offers in all cases anyway.
//
// Every send (sent / failed / manual) writes a mail_log row.
// ═══════════════════════════════════════════════════════════════════════════════

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

const BASE_URL = process.env.PORTAL_URL || process.env.PORTAL_BASE_URL || 'https://aiqs-portal.onrender.com';

function smtpUser() { return process.env.SMTP_USER || process.env.SMTP_EMAIL || ''; }
function smtpPass() { return process.env.SMTP_PASS || process.env.SMTP_PASSWORD || ''; }

function isConfigured() {
  return !!(smtpUser() && smtpPass());
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: smtpUser(), pass: smtpPass() },
    });
  }
  return transporter;
}

function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = {
      logo_filename: null, logo_mime: null,
      primary_colour: '#1B2A4A', accent_colour: '#F59E0B',
      company_name: null, company_address: null, footer_text: null,
    };
  }
  return row;
}

function getUser(userId) {
  return db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(userId);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// One branded template for everything — header band in the builder's primary
// colour, optional CTA button in the accent colour, footer from their branding.
function renderHtml({ branding, companyName, heading, paragraphs, ctaText, ctaUrl, hasLogo }) {
  const primary = branding.primary_colour || '#1B2A4A';
  const accent = branding.accent_colour || '#F59E0B';
  const paras = (paragraphs || [])
    .map(p => '<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155;">' + escapeHtml(p) + '</p>')
    .join('');
  const cta = (ctaText && ctaUrl)
    ? '<div style="text-align:center;margin:26px 0 8px;">'
      + '<a href="' + escapeHtml(ctaUrl) + '" style="display:inline-block;padding:14px 32px;background:' + accent + ';color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">'
      + escapeHtml(ctaText) + '</a></div>'
      + '<p style="margin:10px 0 0;font-size:12px;color:#94A3B8;text-align:center;word-break:break-all;">'
      + 'Or copy this link: ' + escapeHtml(ctaUrl) + '</p>'
    : '';
  const logo = hasLogo
    ? '<img src="cid:brandlogo" alt="" style="max-height:44px;max-width:140px;vertical-align:middle;background:#ffffff;border-radius:6px;padding:3px;margin-right:12px;" />'
    : '';
  const footer = branding.footer_text
    ? escapeHtml(branding.footer_text)
    : escapeHtml(companyName || '');
  const address = branding.company_address
    ? '<div style="margin-top:4px;white-space:pre-line;">' + escapeHtml(branding.company_address) + '</div>'
    : '';
  return ''
    + '<div style="background:#F1F5F9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
    +   '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;">'
    +     '<div style="background:' + primary + ';padding:18px 24px;">'
    +       logo
    +       '<span style="color:#ffffff;font-size:18px;font-weight:700;vertical-align:middle;">' + escapeHtml(companyName || '') + '</span>'
    +     '</div>'
    +     '<div style="padding:26px 24px 22px;">'
    +       '<h2 style="margin:0 0 16px;font-size:19px;color:#0F172A;">' + escapeHtml(heading || '') + '</h2>'
    +       paras
    +       cta
    +     '</div>'
    +     '<div style="padding:14px 24px;border-top:1px solid #E2E8F0;font-size:12px;color:#94A3B8;text-align:center;">'
    +       footer + address
    +     '</div>'
    +   '</div>'
    + '</div>';
}

function renderText({ heading, paragraphs, ctaText, ctaUrl }) {
  const parts = [heading, '', ...(paragraphs || [])];
  if (ctaText && ctaUrl) parts.push('', ctaText + ': ' + ctaUrl);
  return parts.join('\n');
}

function logMail({ userId, type, recipient, subject, status, error }) {
  try {
    db.prepare(
      'INSERT INTO mail_log (id, user_id, type, recipient, subject, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId || null, type || null, recipient || null, subject || null, status, error || null);
  } catch (e) {
    console.warn('[Mailer] mail_log insert failed:', e.message);
  }
}

// Send one branded email on behalf of a builder.
//   { userId, type, to, subject, heading, paragraphs, ctaText, ctaUrl,
//     attachments?: [{ filename, content }], replyTo? }
// Returns { ok, delivery: 'email' | 'manual', error? } — never throws.
async function sendMail(opts) {
  const { userId, type, to, subject } = opts;
  const branding = getBranding(userId);
  const user = getUser(userId);
  const companyName = branding.company_name || user?.company || user?.full_name || '';

  if (!to || !isConfigured()) {
    logMail({ userId, type, recipient: to, subject, status: 'manual' });
    return { ok: false, delivery: 'manual' };
  }

  const attachments = [...(opts.attachments || [])];
  let hasLogo = false;
  if (branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath)) {
      attachments.push({ filename: branding.logo_filename, path: logoPath, cid: 'brandlogo' });
      hasLogo = true;
    }
  }

  const html = renderHtml({ ...opts, branding, companyName, hasLogo });
  const text = renderText(opts);
  const from = '"' + (companyName || 'AI QS').replace(/"/g, '') + '" <' + (process.env.MAIL_FROM || smtpUser()) + '>';

  try {
    await getTransporter().sendMail({
      from,
      to,
      replyTo: opts.replyTo || user?.email || undefined,
      subject,
      html,
      text,
      attachments,
    });
    logMail({ userId, type, recipient: to, subject, status: 'sent' });
    return { ok: true, delivery: 'email' };
  } catch (err) {
    console.error('[Mailer] send failed (' + type + ' -> ' + to + '):', err.message);
    logMail({ userId, type, recipient: to, subject, status: 'failed', error: String(err.message || err).slice(0, 500) });
    return { ok: false, delivery: 'manual', error: err.message };
  }
}

module.exports = { sendMail, isConfigured, BASE_URL };

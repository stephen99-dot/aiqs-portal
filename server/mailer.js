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

// The HTML/text rendering lives in mailTemplate.js (pure, testable). Two
// wardrobes on one template: builder branding by default, or the AI QS
// platform look when the caller passes platform: true (mail from the
// platform to the builder or admin — reminders, alerts, receipts).
const { renderHtml, renderText } = require('./mailTemplate');

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
  const platform = !!opts.platform;
  const branding = getBranding(userId);
  const user = getUser(userId);
  const companyName = platform ? 'AI QS' : (branding.company_name || user?.company || user?.full_name || '');

  if (!to || !isConfigured()) {
    logMail({ userId, type, recipient: to, subject, status: 'manual' });
    return { ok: false, delivery: 'manual' };
  }

  const attachments = [...(opts.attachments || [])];
  let hasLogo = false;
  // Platform mail wears the AI QS wordmark, never the recipient's own logo.
  if (!platform && branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath)) {
      attachments.push({ filename: branding.logo_filename, path: logoPath, cid: 'brandlogo' });
      hasLogo = true;
    }
  }

  const html = renderHtml({ ...opts, branding, companyName, hasLogo, platform });
  const text = renderText(opts);
  const from = '"' + (companyName || 'AI QS').replace(/"/g, '') + '" <' + (process.env.MAIL_FROM || smtpUser()) + '>';

  try {
    await getTransporter().sendMail({
      from,
      to,
      // Builder-branded mail replies to the builder; platform mail replies
      // wherever the caller says (or nowhere special — the MAIL_FROM inbox).
      replyTo: opts.replyTo || (platform ? undefined : user?.email) || undefined,
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

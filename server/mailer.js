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
//
// Connect your email (emailConnection.js): when the builder has connected
// their own Gmail or Outlook, builder-branded mail goes out through THAT
// mailbox — their address in "From", a copy in their Sent folder. Platform
// mail (platform: true) always uses the shared SMTP account. If the connected
// mailbox fails, the email is sent through the shared account instead so the
// client still gets it, and the builder is told once to reconnect.
// ═══════════════════════════════════════════════════════════════════════════════

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const emailConnection = require('./emailConnection');

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

function logMail({ userId, type, recipient, subject, status, error, via }) {
  try {
    db.prepare(
      'INSERT INTO mail_log (id, user_id, type, recipient, subject, status, error, sent_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId || null, type || null, recipient || null, subject || null, status, error || null, via || null);
  } catch (e) {
    console.warn('[Mailer] mail_log insert failed:', e.message);
  }
}

function quoteName(name) {
  return '"' + String(name || 'AI QS').replace(/["\\\r\n]/g, '') + '"';
}

// The builder's connected mailbox stopped working: tell them once (the
// connection only flips to 'needs_reconnect' on the first failure).
function notifyReconnect(userId, conn, reason) {
  const user = getUser(userId);
  if (!user || !user.email) return;
  const label = (emailConnection.PROVIDERS[conn.provider] || {}).label || 'email';
  sendMail({
    userId,
    platform: true,
    type: 'email_connection_broken',
    to: user.email,
    subject: 'Reconnect your ' + label + ' to keep sending from ' + conn.email,
    heading: 'Your ' + label + ' connection needs reconnecting',
    paragraphs: [
      'AI QS could not send an email through ' + conn.email + (reason ? ' (' + reason + ')' : '') + '.',
      'Nothing was lost: until you reconnect, your quotes, invoices and reminders are sent from AI QS with your company name, and replies still come to you.',
      'Reconnecting takes a few seconds on the Branding page.',
    ],
    ctaText: 'Reconnect your email',
    ctaUrl: BASE_URL + '/branding',
  }).catch(() => {});
}

// Send one branded email on behalf of a builder.
//   { userId, type, to, subject, heading, paragraphs, ctaText, ctaUrl,
//     attachments?: [{ filename, content }], replyTo?, platform?,
//     connectedOnly? (true = never fall back to the shared account) }
// Returns { ok, delivery: 'email' | 'manual', via?, from?, error? } — never throws.
//   via: 'google' | 'microsoft' (the builder's own mailbox) | 'shared'
async function sendMail(opts) {
  const { userId, type, to, subject } = opts;
  const platform = !!opts.platform;
  const branding = getBranding(userId);
  const user = getUser(userId);
  const companyName = platform ? 'AI QS' : (branding.company_name || user?.company || user?.full_name || '');

  let conn = null;
  if (!platform) {
    try { conn = emailConnection.getActive(userId); } catch (e) { conn = null; }
  }

  if (!to || (!conn && (opts.connectedOnly || !isConfigured()))) {
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

  // 1. The builder's own mailbox. Replies go to that mailbox naturally, so
  //    reply-to is only set when the caller asks for one.
  let fallbackNote = null;
  if (conn) {
    try {
      await emailConnection.sendViaConnection(conn, {
        // Name + address as an object: the composer quotes / encodes the name
        // itself (ampersands, accents, emoji in a company name).
        from: { name: String(companyName || user?.full_name || '').replace(/[\r\n]/g, ''), address: conn.email },
        to,
        replyTo: opts.replyTo || undefined,
        subject,
        html,
        text,
        attachments,
      });
      logMail({ userId, type, recipient: to, subject, status: 'sent', via: conn.provider });
      return { ok: true, delivery: 'email', via: conn.provider, from: conn.email };
    } catch (err) {
      const reason = String(err.message || err).slice(0, 300);
      console.error('[Mailer] connected mailbox send failed (' + type + ' -> ' + to + '):', reason);
      if (err.reconnect && emailConnection.markNeedsReconnect(userId, reason)) {
        notifyReconnect(userId, conn, reason);
      }
      if (opts.connectedOnly || !isConfigured()) {
        logMail({ userId, type, recipient: to, subject, status: 'failed', error: reason, via: conn.provider });
        return { ok: false, delivery: 'manual', via: conn.provider, error: reason };
      }
      fallbackNote = 'Connected ' + conn.provider + ' mailbox failed, sent from the shared account: ' + reason;
    }
  }

  // 2. The shared AI QS account, in the builder's name.
  const from = quoteName(companyName) + ' <' + (process.env.MAIL_FROM || smtpUser()) + '>';
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
    logMail({ userId, type, recipient: to, subject, status: 'sent', error: fallbackNote, via: 'shared' });
    return { ok: true, delivery: 'email', via: 'shared', from: process.env.MAIL_FROM || smtpUser() };
  } catch (err) {
    console.error('[Mailer] send failed (' + type + ' -> ' + to + '):', err.message);
    logMail({ userId, type, recipient: to, subject, status: 'failed', error: String(err.message || err).slice(0, 500), via: 'shared' });
    return { ok: false, delivery: 'manual', error: err.message };
  }
}

// Can this builder's mail go out at all — through their own connected mailbox
// or the shared account?
function canSend(userId) {
  if (isConfigured()) return true;
  try { return !!emailConnection.getActive(userId); } catch (e) { return false; }
}

// The address the shared account sends from (shown on the Branding page).
function sharedSender() {
  return isConfigured() ? (process.env.MAIL_FROM || smtpUser()) : null;
}

module.exports = { sendMail, isConfigured, canSend, sharedSender, BASE_URL };

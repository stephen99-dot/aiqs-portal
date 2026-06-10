// ═══════════════════════════════════════════════════════════════════════════════
// A3 — AUTOMATED PAYMENT REMINDERS — server/paymentReminders.js
//
// A scheduled sweep (same in-process setInterval pattern as the materials
// stale-flag job) over sent, unpaid invoices that have reminders switched on
// (invoices.reminders_enabled — default ON, per-invoice toggle in the editor).
//
// Three escalating-but-always-polite stages keyed off the due date:
//   stage 1 — on/after the due date
//   stage 2 — 7+ days overdue
//   stage 3 — 14+ days overdue
// invoices.reminder_stage records the highest stage already sent, so each
// fires at most once however often the sweep runs. Only runs when SMTP is
// configured and the invoice has a client email — reminders are email-only
// by nature; manual chasing lives on the "Chase this payment" button.
// ═══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const db = require('./database');
const mailer = require('./mailer');

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function fmtMoney(n, code) {
  const sym = code === 'EUR' ? '€' : '£';
  return sym + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function daysOverdue(dueDate) {
  return Math.round((new Date(todayIso()) - new Date(dueDate)) / 86400000);
}
function newShareToken() {
  return crypto.randomBytes(24).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Tone ladder. {amount} {number} {due} {days} {company} are filled in below.
const STAGES = [
  {
    stage: 1, afterDays: 0,
    subject: (i) => 'Invoice ' + i.number + ' — due ' + (i.days > 0 ? 'on ' + i.due : 'today'),
    paragraphs: (i) => [
      'A friendly reminder that invoice ' + i.number + ' for ' + i.amount + (i.days > 0 ? ' was due on ' + i.due + '.' : ' is due today.'),
      'If you\'ve already paid, please ignore this — it can take a day or two to show up.',
      'Any questions about the invoice, just reply to this email.',
    ],
  },
  {
    stage: 2, afterDays: 7,
    subject: (i) => 'Invoice ' + i.number + ' — now ' + i.days + ' days overdue',
    paragraphs: (i) => [
      'Invoice ' + i.number + ' for ' + i.amount + ' was due on ' + i.due + ' and is still showing as unpaid.',
      'We\'d appreciate payment at your earliest convenience. If you\'ve already paid, please ignore this.',
      'If there\'s a problem with the invoice, reply to this email and we\'ll sort it out.',
    ],
  },
  {
    stage: 3, afterDays: 14,
    subject: (i) => 'Overdue invoice ' + i.number + ' — please arrange payment',
    paragraphs: (i) => [
      'Invoice ' + i.number + ' for ' + i.amount + ' is now ' + i.days + ' days past its due date of ' + i.due + '.',
      'Please arrange payment as soon as possible. If something is holding it up, reply to this email and we\'ll work it out together.',
      'Thank you — ' + i.company + '.',
    ],
  },
];

async function runPaymentReminders() {
  if (!mailer.isConfigured()) return; // nothing to do without SMTP

  let due;
  try {
    due = db.prepare(`
      SELECT * FROM invoices
      WHERE status = 'sent'
        AND reminders_enabled = 1
        AND client_email IS NOT NULL AND client_email != ''
        AND due_date IS NOT NULL
        AND date(due_date) <= date('now')
    `).all();
  } catch (err) {
    console.error('[Reminders] query failed:', err.message);
    return;
  }

  for (const inv of due) {
    try {
      const days = daysOverdue(inv.due_date);
      // Highest stage whose threshold has passed and that hasn't been sent yet.
      const target = [...STAGES].reverse().find(s => days >= s.afterDays && s.stage > num(inv.reminder_stage));
      if (!target) continue;

      const branding = db.prepare('SELECT company_name FROM user_branding WHERE user_id = ?').get(inv.user_id);
      const owner = db.prepare('SELECT full_name, company FROM users WHERE id = ?').get(inv.user_id);
      const company = branding?.company_name || owner?.company || owner?.full_name || 'your builder';

      // Make sure there's a public link to put behind the button.
      let token = inv.public_token;
      if (!token) {
        token = newShareToken();
        db.prepare('UPDATE invoices SET public_token = ? WHERE id = ?').run(token, inv.id);
      }

      const ctx = {
        number: inv.invoice_number || '',
        amount: fmtMoney(inv.grand_total, inv.currency),
        due: inv.due_date,
        days,
        company,
      };

      const mail = await mailer.sendMail({
        userId: inv.user_id,
        type: 'payment_reminder_' + target.stage,
        to: inv.client_email,
        subject: target.subject(ctx),
        heading: target.subject(ctx),
        paragraphs: target.paragraphs(ctx),
        ctaText: 'View the invoice',
        ctaUrl: mailer.BASE_URL + '/i/' + token,
      });

      if (mail.ok) {
        db.prepare(
          'UPDATE invoices SET reminder_stage = ?, reminder_last_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(target.stage, inv.id);
      }
    } catch (err) {
      console.error('[Reminders] invoice ' + inv.id + ' failed:', err.message);
    }
  }
}

// Sweep shortly after boot, then twice a day — each stage fires once, so the
// extra runs are harmless and cover servers that restart often.
function start() {
  const boot = setTimeout(() => runPaymentReminders().catch(() => {}), 30 * 1000);
  if (boot.unref) boot.unref();
  const timer = setInterval(() => runPaymentReminders().catch(() => {}), 12 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { start, runPaymentReminders };

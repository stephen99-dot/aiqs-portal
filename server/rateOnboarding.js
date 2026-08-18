// ═══════════════════════════════════════════════════════════════════════════════
// RATE ONBOARDING — server/rateOnboarding.js
//
// Every new account is seeded with the system-default rate library, but the
// product only really works once a builder puts in THEIR rates. This module
// closes that loop from both ends:
//
//   markOwnRatesAdded(user, {source, count})
//     Called from every deliberate rate-entry path (manual add, Excel import,
//     chat/UI corrections). The FIRST time it fires for a user it stamps
//     users.own_rates_added_at, stops the reminders below, and alerts the
//     admin inbox + bell so we can pull their rates into our pricing brain.
//
//   runRateReminders() / start()
//     A scheduled sweep (same in-process setInterval pattern as
//     paymentReminders.js) that nudges clients who signed up but never added
//     their own rates — day 3, day 7 and day 14 after signup, each stage at
//     most once (users.rates_reminder_stage). Only accounts created in the
//     last REMINDER_WINDOW_DAYS are considered, so shipping this never mails
//     the long-standing back book.
//
// All sends are fire-and-forget: a mail failure must never break a rate save.
// ═══════════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const mailer = require('./mailer');
const { logActivity } = require('./activityRoutes');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';

// Only chase accounts younger than this — the feature is for new signups.
const REMINDER_WINDOW_DAYS = 30;

// Self-contained migrations, same try/alter pattern as routes.js.
try { db.exec('ALTER TABLE users ADD COLUMN own_rates_added_at DATETIME'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN rates_reminder_stage INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN rates_reminder_last_at DATETIME'); } catch (e) {}

const SOURCE_LABELS = {
  manual: 'added manually on the My Rates page',
  import: 'imported from Excel',
  correction: 'corrected via chat / rate edits',
  admin_import: 'imported by an admin',
};

// The user just put their own rates in. First call wins; later calls no-op.
// silent=true records the milestone without the admin alert (for imports we
// did ourselves on their behalf — nothing to extract that we don't have).
function markOwnRatesAdded(user, { source, count, silent } = {}) {
  try {
    if (!user || !user.id) return;
    const row = db.prepare('SELECT id, email, full_name, company, role, own_rates_added_at FROM users WHERE id = ?').get(user.id);
    if (!row || row.role === 'admin' || row.role === 'system' || row.own_rates_added_at) return;

    db.prepare('UPDATE users SET own_rates_added_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);

    const who = row.full_name || row.email;
    const how = SOURCE_LABELS[source] || 'added';
    const countLabel = count ? count + ' rate' + (count === 1 ? '' : 's') : 'rates';

    logActivity({
      event_type: 'rates_added',
      title: who + ' added their own rates',
      detail: countLabel + ' ' + how,
      user_id: row.id, user_name: row.full_name, user_email: row.email,
    });

    if (silent) return;

    // Admin bell (same notifications table notifyAdmin in routes.js writes to).
    try {
      db.prepare('INSERT INTO notifications (id, type, title, detail, icon) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), 'rates_added', who + ' added their rates', countLabel + ' ' + how, 'clipboard');
    } catch (e) {
      console.error('[RateOnboarding] notification insert failed:', e.message);
    }

    const total = db.prepare('SELECT COUNT(*) AS c FROM client_rate_library WHERE user_id = ? AND is_active = 1').get(row.id).c;
    mailer.sendMail({
      type: 'rates_added_admin',
      to: ADMIN_EMAIL,
      subject: 'Rates added — ' + who + ' (' + countLabel + ')',
      heading: 'A client just added their rates',
      paragraphs: [
        who + (row.company ? ' (' + row.company + ')' : '') + ' — ' + row.email + ' — just ' + how + ': ' + countLabel + '.',
        'Their rate library now holds ' + total + ' active rate' + (total === 1 ? '' : 's') + '.',
        'Extract their rates and add them to our system so their BOQs price from their own numbers.',
      ],
      ctaText: 'Open user management',
      ctaUrl: mailer.BASE_URL + '/admin/users',
    }).catch(() => {});
  } catch (err) {
    console.error('[RateOnboarding] markOwnRatesAdded failed:', err.message);
  }
}

// Nudge ladder, days after signup. Each stage fires at most once.
const STAGES = [
  {
    stage: 1, afterDays: 3,
    subject: 'Add your rates — get BOQs priced with YOUR numbers',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', your AI QS account is up and running — but it\'s still pricing with standard UK rates.',
      'Add your own rates (or import them from a spreadsheet) and every BOQ, quote and estimate will use your real numbers instead.',
      'It takes a couple of minutes: My Rates → Add Rate, or Import from Excel.',
    ],
  },
  {
    stage: 2, afterDays: 7,
    subject: 'Your BOQs are still using standard rates',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', a week in and your account is still pricing jobs with generic UK rates.',
      'Builders who load their own rates get quotes that match what they actually charge — no reworking the numbers after every BOQ.',
      'Got your rates in a spreadsheet? Import it in one go from the My Rates page.',
    ],
  },
  {
    stage: 3, afterDays: 14,
    subject: 'Last nudge — add your rates to your AI QS',
    paragraphs: (u) => [
      'Hi ' + (u.first || 'there') + ', this is our last reminder about this — promise.',
      'Until your rates are in, every estimate uses standard UK figures. Two minutes on the My Rates page fixes that for every job you run through the system.',
      'Stuck, or want us to load them for you? Just reply to this email with your rates and we\'ll set them up.',
    ],
  },
];

async function runRateReminders() {
  if (!mailer.isConfigured()) return; // nothing to do without SMTP

  let candidates;
  try {
    // Recent clients with no recorded own-rates milestone. The confidence and
    // corrections-log guards catch users who put rates in before this feature
    // existed (imports/corrections set confidence >= 0.85; seeds are 0.75/0.80).
    candidates = db.prepare(`
      SELECT id, email, full_name, company, created_at, rates_reminder_stage
      FROM users u
      WHERE role = 'client'
        AND COALESCE(suspended, 0) = 0
        AND own_rates_added_at IS NULL
        AND email IS NOT NULL AND email != ''
        AND julianday('now') - julianday(created_at) <= ${REMINDER_WINDOW_DAYS}
        AND NOT EXISTS (SELECT 1 FROM rate_corrections_log rc WHERE rc.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM client_rate_library rl WHERE rl.user_id = u.id AND rl.is_active = 1 AND rl.confidence >= 0.85)
    `).all();
  } catch (err) {
    console.error('[RateOnboarding] reminder query failed:', err.message);
    return;
  }

  for (const u of candidates) {
    try {
      // created_at is SQLite's 'YYYY-MM-DD HH:MM:SS' in UTC — normalise to ISO.
      const createdIso = String(u.created_at).replace(' ', 'T').replace(/Z?$/, 'Z');
      const days = (Date.now() - new Date(createdIso).getTime()) / 86400000;
      // Highest stage whose threshold has passed and that hasn't been sent yet.
      const target = [...STAGES].reverse().find(s => days >= s.afterDays && s.stage > (u.rates_reminder_stage || 0));
      if (!target) continue;

      const ctx = { first: (u.full_name || '').trim().split(/\s+/)[0] || '' };
      const mail = await mailer.sendMail({
        userId: u.id,
        type: 'rates_reminder_' + target.stage,
        to: u.email,
        subject: target.subject,
        heading: 'Your rates make the AI QS yours',
        paragraphs: target.paragraphs(ctx),
        ctaText: 'Add your rates now',
        ctaUrl: mailer.BASE_URL + '/my-rates',
      });

      if (mail.ok) {
        db.prepare('UPDATE users SET rates_reminder_stage = ?, rates_reminder_last_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(target.stage, u.id);
      }
    } catch (err) {
      console.error('[RateOnboarding] reminder for ' + u.email + ' failed:', err.message);
    }
  }
}

// Sweep shortly after boot, then twice a day — each stage fires once, so the
// extra runs are harmless and cover servers that restart often.
function start() {
  const boot = setTimeout(() => runRateReminders().catch(() => {}), 45 * 1000);
  if (boot.unref) boot.unref();
  const timer = setInterval(() => runRateReminders().catch(() => {}), 12 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { markOwnRatesAdded, runRateReminders, start, REMINDER_WINDOW_DAYS };

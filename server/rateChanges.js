// ═══════════════════════════════════════════════════════════════════════════════
// RATE CHANGE ALERTS — server/rateChanges.js
//
// rateOnboarding.markOwnRatesAdded tells the admin the FIRST time a client
// puts their own rates in. This covers every change after that — a rate
// edited on My Rates, a fresh Excel import, corrections made in chat, a
// supplier quote fed back in, a rate deleted — because the admin wants to
// know each time, the same way, so the pricing brain can be refreshed.
//
// Changes are rolled up per client: a 40-row import or ten quick edits is
// ONE bell + ONE email, sent once the client has been quiet for QUIET_MS (or
// MAX_WAIT_MS after their first change, whichever comes first). The pending
// roll-ups live in a table, not memory, so a deploy mid-edit loses nothing;
// a sweep every minute sends whatever is due.
//
// All sends are fire-and-forget: a mail failure must never break a rate save.
// ═══════════════════════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');

const QUIET_MS = 5 * 60 * 1000;      // send once the client has stopped for 5 minutes…
const MAX_WAIT_MS = 20 * 60 * 1000;  // …or 20 minutes after their first change, regardless
const SWEEP_MS = 60 * 1000;

const SOURCE_LABELS = {
  manual: 'the My Rates page',
  import: 'an Excel import',
  boq_import: 'a BOQ import',
  correction: 'chat corrections',
  chat: 'the AI chat',
  tender_return: 'supplier quotes',
  onboarding: 'onboarding',
};

function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/**
 * Build a tracker bound to a database. Everything it touches is injected so
 * tests can run it against an in-memory database with a stub mailer; the
 * module-level functions below bind the real ones.
 */
function createTracker({ db, mailer, logActivity, adminEmail, now = Date.now, quietMs = QUIET_MS, maxWaitMs = MAX_WAIT_MS }) {
  db.exec(`CREATE TABLE IF NOT EXISTS rate_change_digests (
    user_id TEXT PRIMARY KEY,
    added INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0,
    sources TEXT NOT NULL DEFAULT '',
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL
  )`);

  // Note a change. Counts accumulate until the roll-up is sent.
  function record(user, { source, added = 0, updated = 0, removed = 0 } = {}) {
    if (!user || !user.id) return false;
    if (user.role === 'admin' || user.role === 'system') return false;
    added = Math.max(0, added | 0); updated = Math.max(0, updated | 0); removed = Math.max(0, removed | 0);
    if (added + updated + removed === 0) return false;
    const t = now();
    const row = db.prepare('SELECT sources FROM rate_change_digests WHERE user_id = ?').get(user.id);
    const sources = new Set((row && row.sources ? row.sources.split(',') : []).filter(Boolean));
    if (source) sources.add(String(source));
    if (row) {
      db.prepare('UPDATE rate_change_digests SET added = added + ?, updated = updated + ?, removed = removed + ?, sources = ?, last_at = ? WHERE user_id = ?')
        .run(added, updated, removed, [...sources].join(','), t, user.id);
    } else {
      db.prepare('INSERT INTO rate_change_digests (user_id, added, updated, removed, sources, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, added, updated, removed, [...sources].join(','), t, t);
    }
    return true;
  }

  function due(t = now()) {
    return db.prepare('SELECT * FROM rate_change_digests WHERE last_at <= ? OR first_at <= ?').all(t - quietMs, t - maxWaitMs);
  }

  function describe(row) {
    const parts = [];
    if (row.updated) parts.push(plural(row.updated, 'rate') + ' updated');
    if (row.added) parts.push(plural(row.added, 'rate') + ' added');
    if (row.removed) parts.push(plural(row.removed, 'rate') + ' removed');
    const sources = String(row.sources || '').split(',').filter(Boolean).map((s) => SOURCE_LABELS[s] || s);
    return { counts: parts.join(' · ') || 'rates changed', how: sources.length ? 'via ' + joinList(sources) : '' };
  }

  // Send one roll-up. The row is deleted first so nothing is ever sent twice.
  async function flush(row) {
    db.prepare('DELETE FROM rate_change_digests WHERE user_id = ?').run(row.user_id);
    const u = db.prepare('SELECT id, email, full_name, company, role FROM users WHERE id = ?').get(row.user_id);
    if (!u || u.role === 'admin' || u.role === 'system') return null;
    const who = u.full_name || u.email;
    const { counts, how } = describe(row);
    const detail = how ? counts + ' — ' + how : counts;
    let total = 0;
    try { total = db.prepare('SELECT COUNT(*) AS c FROM client_rate_library WHERE user_id = ? AND is_active = 1').get(u.id).c; } catch (e) { /* table may not exist in tests */ }

    try {
      logActivity({ event_type: 'rates_updated', title: who + ' updated their rates', detail, user_id: u.id, user_name: u.full_name, user_email: u.email });
    } catch (e) { console.error('[RateChanges] activity log failed:', e.message); }

    try {
      db.prepare('INSERT INTO notifications (id, type, title, detail, icon) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), 'rates_updated', who + ' updated their rates', detail, 'clipboard');
    } catch (e) { console.error('[RateChanges] notification insert failed:', e.message); }

    try {
      await mailer.sendMail({
        platform: true,
        type: 'rates_updated_admin',
        to: adminEmail,
        subject: 'Rates updated — ' + who + ' (' + counts + ')',
        heading: 'A client changed their rates',
        paragraphs: [
          who + (u.company ? ' (' + u.company + ')' : '') + ' — ' + u.email + ' — ' + counts + (how ? ', ' + how : '') + '.',
          'Their rate library now holds ' + plural(total, 'active rate') + '.',
          'Refresh their rates in our system so their BOQs keep pricing from their own numbers.',
        ],
        ctaText: 'Open user management',
        ctaUrl: mailer.BASE_URL + '/admin/users',
      });
    } catch (e) { console.error('[RateChanges] admin email failed:', e.message); }

    return { user_id: u.id, who, counts, how, total };
  }

  async function sweep(t = now()) {
    const sent = [];
    for (const row of due(t)) {
      try { const r = await flush(row); if (r) sent.push(r); }
      catch (e) { console.error('[RateChanges] flush failed for ' + row.user_id + ':', e.message); }
    }
    return sent;
  }

  // Sweep shortly after boot (anything left pending by a restart), then every minute.
  function start() {
    const boot = setTimeout(() => sweep().catch(() => {}), 30 * 1000);
    if (boot.unref) boot.unref();
    const timer = setInterval(() => sweep().catch(() => {}), SWEEP_MS);
    if (timer.unref) timer.unref();
  }

  return { record, due, flush, sweep, start, describe };
}

// The real thing, bound lazily so requiring this module never drags the
// database in during tests or creates require cycles at load time.
let tracker = null;
function live() {
  if (!tracker) {
    tracker = createTracker({
      db: require('./database'),
      mailer: require('./mailer'),
      logActivity: require('./activityRoutes').logActivity,
      adminEmail: process.env.ADMIN_EMAIL || 'hello@crmwizardai.com',
    });
  }
  return tracker;
}

module.exports = {
  createTracker,
  record: (user, change) => live().record(user, change),
  sweep: (t) => live().sweep(t),
  start: () => live().start(),
  SOURCE_LABELS, QUIET_MS, MAX_WAIT_MS,
};

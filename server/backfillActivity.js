// Back-populates activity_log from existing data: signups, chat messages,
// BOQs generated, variations, and project submissions.
// Idempotent: skips rows whose (event_type, user_id, created_at) already exist.

function backfill(db) {
  const counts = { signup: 0, chat: 0, doc_generated: 0, variation: 0, project: 0, skipped: 0 };

  const userCache = new Map();
  function userMeta(userId) {
    if (!userId) return { user_name: null, user_email: null };
    if (userCache.has(userId)) return userCache.get(userId);
    const u = db.prepare('SELECT full_name, email FROM users WHERE id = ?').get(userId);
    const meta = { user_name: u ? u.full_name : null, user_email: u ? u.email : null };
    userCache.set(userId, meta);
    return meta;
  }

  const existsStmt = db.prepare('SELECT 1 FROM activity_log WHERE event_type = ? AND user_id = ? AND created_at = ? LIMIT 1');
  const insertStmt = db.prepare('INSERT INTO activity_log (event_type, title, detail, user_id, user_name, user_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');

  function maybeInsert(evt) {
    if (existsStmt.get(evt.event_type, evt.user_id || null, evt.created_at)) {
      counts.skipped++;
      return false;
    }
    insertStmt.run(
      evt.event_type, evt.title, evt.detail || null,
      evt.user_id || null, evt.user_name || null, evt.user_email || null,
      evt.created_at
    );
    return true;
  }

  const tx = db.transaction(() => {
    // 1. Signups — from users table
    try {
      const users = db.prepare("SELECT id, full_name, email, company, created_at FROM users WHERE role = 'client' ORDER BY created_at").all();
      for (const u of users) {
        if (!u.created_at) continue;
        if (maybeInsert({
          event_type: 'signup',
          title: (u.full_name || u.email || 'A user') + ' signed up',
          detail: u.company || null,
          user_id: u.id, user_name: u.full_name, user_email: u.email,
          created_at: u.created_at,
        })) counts.signup++;
      }
    } catch (e) { console.error('[Backfill] signups:', e.message); }

    // 2. Chat messages — from usage_log (action='chat_message')
    try {
      const chats = db.prepare("SELECT user_id, detail, created_at FROM usage_log WHERE action = 'chat_message' ORDER BY created_at").all();
      for (const c of chats) {
        if (!c.created_at) continue;
        const m = userMeta(c.user_id);
        const preview = (c.detail || '').replace(/\s+/g, ' ').trim().substring(0, 100);
        if (maybeInsert({
          event_type: 'chat',
          title: (m.user_name || m.user_email || 'A user') + ' sent a message',
          detail: preview || null,
          user_id: c.user_id, user_name: m.user_name, user_email: m.user_email,
          created_at: c.created_at,
        })) counts.chat++;
      }
    } catch (e) { console.error('[Backfill] chats:', e.message); }

    // 3. BOQ generations — from usage_log (action='doc_generated')
    try {
      const docs = db.prepare("SELECT user_id, detail, created_at FROM usage_log WHERE action = 'doc_generated' ORDER BY created_at").all();
      for (const d of docs) {
        if (!d.created_at) continue;
        const m = userMeta(d.user_id);
        if (maybeInsert({
          event_type: 'doc_generated',
          title: (m.user_name || m.user_email || 'A user') + ' generated a BOQ',
          detail: d.detail || null,
          user_id: d.user_id, user_name: m.user_name, user_email: m.user_email,
          created_at: d.created_at,
        })) counts.doc_generated++;
      }
    } catch (e) { console.error('[Backfill] docs:', e.message); }

    // 4. Variations — from variations table
    try {
      const variations = db.prepare(`
        SELECT v.user_id, v.vo_number, v.title, v.net_change, v.currency, v.created_at, p.title AS project_title
        FROM variations v LEFT JOIN projects p ON p.id = v.project_id
        ORDER BY v.created_at
      `).all();
      for (const v of variations) {
        if (!v.created_at) continue;
        const m = userMeta(v.user_id);
        const sym = v.currency === 'EUR' ? '€' : '£';
        const net = v.net_change || 0;
        const detail = (v.project_title || '') + (v.title ? (v.project_title ? ' — ' : '') + v.title : '')
          + ' (net ' + (net >= 0 ? '+' : '−') + sym + Math.abs(Math.round(net)).toLocaleString('en-GB') + ')';
        if (maybeInsert({
          event_type: 'variation',
          title: (m.user_name || m.user_email || 'A user') + ' raised ' + (v.vo_number || 'a variation'),
          detail,
          user_id: v.user_id, user_name: m.user_name, user_email: m.user_email,
          created_at: v.created_at,
        })) counts.variation++;
      }
    } catch (e) { console.error('[Backfill] variations:', e.message); }

    // 5. Project submissions — from projects table
    try {
      const projects = db.prepare('SELECT id, user_id, title, project_type, created_at FROM projects ORDER BY created_at').all();
      for (const p of projects) {
        if (!p.created_at) continue;
        const m = userMeta(p.user_id);
        if (maybeInsert({
          event_type: 'project_submitted',
          title: (m.user_name || m.user_email || 'A user') + ' submitted a project',
          detail: (p.title || p.id) + (p.project_type ? ' (' + p.project_type + ')' : ''),
          user_id: p.user_id, user_name: m.user_name, user_email: m.user_email,
          created_at: p.created_at,
        })) counts.project++;
      }
    } catch (e) { console.error('[Backfill] projects:', e.message); }
  });
  tx();

  return counts;
}

module.exports = { backfill };

// Allow running directly via `node server/backfillActivity.js`
if (require.main === module) {
  const db = require('./database');
  const result = backfill(db);
  console.log('Backfill complete:');
  for (const [k, v] of Object.entries(result)) console.log('  ' + k.padEnd(18) + v);
}

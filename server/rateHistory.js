// ═══════════════════════════════════════════════════════════════════════════════
// RATE HISTORY — server/rateHistory.js
//
// The rate alerts (rateOnboarding.js, rateChanges.js) tell the admin THAT a
// client touched their rates. This answers WHICH ones, so a single corrected
// rate can be found in a 450-row library without scrolling for it.
//
// recentChanges(db, userId) lists the rates whose row changed in the last
// `days`, newest first, each tagged added / updated / removed, with the value
// it replaced where we know it: the correction log entry written with the
// change (chat and My Rates corrections keep one), else the seeded system
// default the client's figure overrides.
//
// Everything is injected so the tests run it against an in-memory database.
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 50;
const SYSTEM_DEFAULT_USER_ID = '__system_default__';

// rate_corrections_log.correction_source → how the admin reads it. 'chat' is
// written by POST /my-rates/corrections, which both the chat and the My Rates
// page call, so it cannot be narrowed further.
const SOURCE_LABELS = {
  chat: 'chat / My Rates edit',
  auto_chat: 'picked up in chat',
  tag_update: 'chat',
};

// SQLite's CURRENT_TIMESTAMP is 'YYYY-MM-DD HH:MM:SS' in UTC; the cutoff is
// built in the same shape so a plain string comparison works.
function sqliteTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function recentChanges(db, userId, { days = DEFAULT_DAYS, limit = DEFAULT_LIMIT, now = Date.now } = {}) {
  const cutoff = sqliteTimestamp(now() - days * 86400000);
  const rows = db.prepare(`
    SELECT r.id, r.category, r.item_key, r.display_name, r.value, r.unit, r.client_note,
           r.is_active, r.created_at, r.updated_at,
           d.value AS default_value,
           c.old_value AS corr_old_value, c.correction_source, c.raw_message, c.created_at AS corrected_at
    FROM client_rate_library r
    LEFT JOIN client_rate_library d
      ON d.user_id = ? AND d.is_active = 1 AND d.category = r.category AND d.item_key = r.item_key
    LEFT JOIN rate_corrections_log c
      ON c.id = (SELECT id FROM rate_corrections_log WHERE rate_id = r.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
    WHERE r.user_id = ? AND r.updated_at >= ?
    ORDER BY r.updated_at DESC, r.rowid DESC
    LIMIT ?
  `).all(SYSTEM_DEFAULT_USER_ID, userId, cutoff, limit + 1);

  const changes = rows.slice(0, limit).map((r) => {
    const kind = !r.is_active ? 'removed' : r.created_at === r.updated_at ? 'added' : 'updated';
    // The correction log explains THIS change only if it was written with it
    // (same second or just after the row update); an older entry describes
    // an earlier edit and would show a stale "was" figure.
    const correction = r.corrected_at && r.corrected_at >= r.updated_at ? r : null;
    let old_value = null;
    if (kind !== 'added') {
      if (correction && correction.corr_old_value != null) old_value = correction.corr_old_value;
      else if (r.default_value != null && r.default_value !== r.value) old_value = r.default_value;
    }
    return {
      id: r.id,
      category: r.category,
      item_key: r.item_key,
      display_name: r.display_name || r.item_key,
      value: r.value,
      unit: r.unit,
      client_note: r.client_note || null,
      kind,
      old_value,
      source: correction ? (SOURCE_LABELS[correction.correction_source] || correction.correction_source) : null,
      raw_message: correction && correction.raw_message ? String(correction.raw_message).slice(0, 300) : null,
      changed_at: r.updated_at,
    };
  });

  return { changes, truncated: rows.length > limit, days };
}

module.exports = { recentChanges, sqliteTimestamp, SOURCE_LABELS, DEFAULT_DAYS, DEFAULT_LIMIT };

/**
 * evidenceLedger.js — per-job evidence ledger and resubmission guard (brief §12).
 *
 * AI Memory holds preferences. It does not hold WHAT WAS PROVEN AND WHAT WAS
 * REJECTED, so a later pass can silently undo an earlier correction.
 *
 * The near-miss this exists to prevent: a first pass measured openings and PV
 * modules off a combined multi-storey plan; a later pass proved that plan
 * distorted and re-measured each storey; a subsequent pass then re-derived from
 * the combined figures again and silently raised windows 11 -> 13, openings
 * 15 -> 17 and PV modules 10 -> 12. It was caught only because the job file
 * recorded which source had been discredited.
 *
 * Two guards follow from that:
 *
 *   1. REGRESSION. The tell is a quantity moving BACK toward a value that was
 *      already rejected, with no new evidence. That is flagged, not merged.
 *   2. RESUBMISSION. Match every new upload against jobs already on file before
 *      pricing anything. The same three-sheet PDF came back the day after issue
 *      with only the SCOPE SENTENCE changed, deleting an £11,738 section — the
 *      file fingerprints are what catch it.
 *
 * A resubmission never inherits the earlier scale proof. Re-proving costs one
 * script and it is what makes the second issue a document in its own right.
 */
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// A quantity is "moving back" if the new value is closer to a rejected figure
// than to the proven one. The tolerance keeps ordinary re-measurement noise out.
const REGRESSION_TOLERANCE = 0.02; // 2%

function initEvidenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      takeoff_id TEXT,
      item_key TEXT NOT NULL,
      unit TEXT,
      proven_qty REAL NOT NULL,
      proven_source TEXT NOT NULL,
      rejected TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_takeoff ON evidence_ledger(takeoff_id, item_key)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_fingerprints (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      takeoff_id TEXT,
      project_name TEXT,
      file_name TEXT,
      md5 TEXT NOT NULL,
      byte_size INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fingerprints_md5 ON job_fingerprints(user_id, md5)`);
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Record a proven quantity, and what was rejected to get there.
 * @param {object} entry { userId, takeoffId, itemKey, unit, qty, source,
 *                         rejected: [{ qty, source, why }] }
 */
function recordProven(db, entry) {
  const existing = db.prepare(
    'SELECT * FROM evidence_ledger WHERE takeoff_id = ? AND item_key = ?'
  ).get(entry.takeoffId, entry.itemKey);

  const rejected = Array.isArray(entry.rejected) ? entry.rejected : [];
  if (existing) {
    // Carry the previous rejections forward — a source discredited once stays
    // discredited, which is the whole point of the ledger.
    const prior = JSON.parse(existing.rejected || '[]');
    const merged = [...prior];
    for (const r of rejected) {
      if (!merged.some((p) => p.source === r.source && Number(p.qty) === Number(r.qty))) merged.push(r);
    }
    db.prepare(
      'UPDATE evidence_ledger SET proven_qty = ?, proven_source = ?, rejected = ?, unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(entry.qty, entry.source, JSON.stringify(merged), entry.unit || existing.unit, existing.id);
    return { ...existing, proven_qty: entry.qty, proven_source: entry.source, rejected: merged };
  }

  const id = 'ev_' + uuidv4().slice(0, 12);
  db.prepare(
    'INSERT INTO evidence_ledger (id, user_id, takeoff_id, item_key, unit, proven_qty, proven_source, rejected) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, entry.userId, entry.takeoffId, entry.itemKey, entry.unit || null, entry.qty, entry.source, JSON.stringify(rejected));
  return { id, proven_qty: entry.qty, proven_source: entry.source, rejected };
}

function getLedger(db, takeoffId) {
  const rows = db.prepare('SELECT * FROM evidence_ledger WHERE takeoff_id = ?').all(takeoffId);
  return rows.map((r) => ({ ...r, rejected: JSON.parse(r.rejected || '[]') }));
}

/**
 * Check a proposed set of quantities against the ledger.
 *
 * Flags a quantity that has moved BACK toward a rejected value. It does not
 * block: a genuine re-measurement with new evidence is legitimate, and the
 * ledger's job is to make sure that claim is made explicitly rather than by
 * accident.
 *
 * @param {Array} proposed [{ key, qty, source }]
 * @returns {Array} regressions
 */
function checkRegressions(db, takeoffId, proposed) {
  const ledger = getLedger(db, takeoffId);
  if (!ledger.length) return [];
  const byKey = new Map(ledger.map((l) => [l.item_key, l]));
  const out = [];

  for (const p of (proposed || [])) {
    const entry = byKey.get(p.key);
    if (!entry) continue;
    const proven = Number(entry.proven_qty);
    const next = Number(p.qty);
    if (!Number.isFinite(proven) || !Number.isFinite(next)) continue;
    // Unchanged within tolerance — nothing to say.
    if (proven === 0 ? next === 0 : Math.abs(next - proven) / Math.abs(proven) <= REGRESSION_TOLERANCE) continue;

    for (const rej of entry.rejected) {
      const bad = Number(rej.qty);
      if (!Number.isFinite(bad)) continue;
      const distToRejected = Math.abs(next - bad);
      const distToProven = Math.abs(next - proven);
      if (distToRejected < distToProven) {
        out.push({
          key: p.key, unit: entry.unit,
          proven, provenSource: entry.proven_source,
          rejected: bad, rejectedSource: rej.source, rejectedWhy: rej.why,
          proposed: next, proposedSource: p.source || 'unstated',
          message: `${p.key} is moving back toward ${bad} (${rej.source}), which was rejected because ${rej.why || 'it was discredited'}. The proven figure is ${proven} from ${entry.proven_source}. Re-read the ledger before re-measuring.`,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Fingerprint the uploaded files and look for a job already on file.
 * @param {Array} files [{ name, buffer }]
 */
function checkResubmission(db, userId, files) {
  const prints = (files || [])
    .filter((f) => f && f.buffer)
    .map((f) => ({ name: f.name, md5: md5(f.buffer), size: f.buffer.length }));
  if (!prints.length) return { isResubmission: false, matches: [], prints };

  const matches = [];
  const seenTakeoffs = new Set();
  for (const p of prints) {
    const rows = db.prepare(
      'SELECT * FROM job_fingerprints WHERE user_id = ? AND md5 = ? ORDER BY created_at DESC'
    ).all(userId, p.md5);
    for (const r of rows) {
      if (r.takeoff_id && seenTakeoffs.has(r.takeoff_id)) continue;
      if (r.takeoff_id) seenTakeoffs.add(r.takeoff_id);
      matches.push({ file: p.name, matchedFile: r.file_name, takeoffId: r.takeoff_id, projectName: r.project_name, when: r.created_at });
    }
  }

  // Duplicate sheets WITHIN this upload: a pack routinely contains the same
  // sheet twice, and "plain + TENDER watermarked" copies are the same drawings
  // with different md5s — so equal md5s here are a straight duplicate.
  const counts = prints.reduce((m, p) => m.set(p.md5, (m.get(p.md5) || 0) + 1), new Map());
  const duplicatesInPack = prints.filter((p) => counts.get(p.md5) > 1).map((p) => p.name);

  const isResubmission = matches.length > 0;
  return {
    isResubmission, matches, prints,
    duplicatesInPack: [...new Set(duplicatesInPack)],
    note: isResubmission
      ? `${matches.length} of these files have been priced before (${[...new Set(matches.map((m) => m.projectName).filter(Boolean))].join(', ') || 'an earlier job'}). Compare the SCOPE wording before pricing — a resubmission that changes only the scope sentence has deleted a whole section before. Re-prove the scale from this file; do not inherit it.`
      : null,
  };
}

function recordFingerprints(db, { userId, takeoffId, projectName, prints }) {
  const stmt = db.prepare(
    'INSERT INTO job_fingerprints (id, user_id, takeoff_id, project_name, file_name, md5, byte_size) VALUES (?,?,?,?,?,?,?)'
  );
  for (const p of (prints || [])) {
    stmt.run('fp_' + uuidv4().slice(0, 12), userId, takeoffId || null, projectName || null, p.name || null, p.md5, p.size || null);
  }
}

module.exports = {
  initEvidenceTables, recordProven, getLedger, checkRegressions,
  checkResubmission, recordFingerprints, md5, REGRESSION_TOLERANCE,
};

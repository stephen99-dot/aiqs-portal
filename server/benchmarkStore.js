/**
 * benchmarkStore.js
 * Stores and retrieves quantity benchmarks from confirmed BOQs.
 * After every approved project, we extract per-element benchmarks.
 * On next extraction, AI gets prior ranges to sanity-check against.
 */

const { v4: uuidv4 } = require('uuid');

function initBenchmarkTables(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quantity_takeoffs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        project_name TEXT,
        project_type TEXT,
        location TEXT,
        status TEXT DEFAULT 'draft',
        items TEXT NOT NULL DEFAULT '[]',
        confirmed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_benchmarks (
        id TEXT PRIMARY KEY,
        project_type TEXT NOT NULL,
        element_key TEXT NOT NULL,
        unit TEXT,
        floor_area_m2 REAL,
        qty REAL NOT NULL,
        qty_per_m2 REAL,
        location_zone TEXT,
        source_project TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_benchmarks_type_key
      ON project_benchmarks(project_type, element_key)
    `);
    console.log('[Benchmarks] Tables ready');
  } catch (e) {
    console.error('[Benchmarks] Table init error:', e.message);
  }
}

/**
 * Save a quantity takeoff (draft or confirmed)
 */
function saveTakeoff(db, { userId, sessionId, projectName, projectType, location, items, status = 'draft' }) {
  const id = 'qt_' + uuidv4().slice(0, 10);
  db.prepare(`
    INSERT INTO quantity_takeoffs (id, user_id, session_id, project_name, project_type, location, status, items)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, sessionId || null, projectName, projectType, location, status, JSON.stringify(items));
  return id;
}

/**
 * Update an existing takeoff (e.g. user corrections)
 */
function updateTakeoff(db, id, { items, status }) {
  const updates = [];
  const params = [];
  if (items !== undefined) { updates.push('items = ?'); params.push(JSON.stringify(items)); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (status === 'confirmed') { updates.push('confirmed_at = CURRENT_TIMESTAMP'); }
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  db.prepare(`UPDATE quantity_takeoffs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Get takeoff by session ID (most recent)
 */
function getTakeoffBySession(db, sessionId) {
  const row = db.prepare(`
    SELECT * FROM quantity_takeoffs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(sessionId);
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items || '[]') };
}

/**
 * Get takeoff by ID
 */
function getTakeoffById(db, id) {
  const row = db.prepare('SELECT * FROM quantity_takeoffs WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items || '[]') };
}

/**
 * After a BOQ is confirmed/approved, extract benchmarks for future learning
 */
function extractAndStoreBenchmarks(db, takeoffId, floorAreaM2) {
  try {
    const takeoff = getTakeoffById(db, takeoffId);
    if (!takeoff || takeoff.status !== 'confirmed') return;
    
    const items = takeoff.items;
    const insert = db.prepare(`
      INSERT INTO project_benchmarks (id, project_type, element_key, unit, floor_area_m2, qty, qty_per_m2, location_zone, source_project)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const tx = db.transaction(() => {
      for (const item of items) {
        if (!item.key || !item.qty || item.qty <= 0) continue;
        const qtyPerM2 = floorAreaM2 && floorAreaM2 > 0 ? item.qty / floorAreaM2 : null;
        insert.run(
          'bm_' + uuidv4().slice(0, 8),
          takeoff.project_type || 'unknown',
          item.key,
          item.unit || '',
          floorAreaM2 || null,
          item.qty,
          qtyPerM2,
          takeoff.location || 'unknown',
          takeoffId
        );
      }
    });
    tx();
    console.log(`[Benchmarks] Stored ${items.length} benchmarks from takeoff ${takeoffId}`);
  } catch (e) {
    console.error('[Benchmarks] Extract error:', e.message);
  }
}

/**
 * Get benchmark ranges for a project type — used by AI for sanity checking
 * Returns { element_key: { min, max, avg, p25, p75, count, unit } }
 */
function getBenchmarkRanges(db, projectType, floorAreaM2) {
  try {
    const rows = db.prepare(`
      SELECT element_key, unit, qty_per_m2, qty, floor_area_m2
      FROM project_benchmarks
      WHERE project_type = ?
      ORDER BY element_key
    `).all(projectType);

    if (rows.length === 0) return null;

    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.element_key]) grouped[row.element_key] = [];
      // Use qty_per_m2 if available and we have a floor area, otherwise use raw qty
      const val = (row.qty_per_m2 && floorAreaM2) ? row.qty_per_m2 * floorAreaM2 : row.qty;
      grouped[row.element_key].push({ val, unit: row.unit });
    }

    const ranges = {};
    for (const [key, vals] of Object.entries(grouped)) {
      if (vals.length < 2) continue; // need at least 2 data points
      const sorted = vals.map(v => v.val).sort((a, b) => a - b);
      const count = sorted.length;
      ranges[key] = {
        min: sorted[0],
        max: sorted[count - 1],
        avg: sorted.reduce((s, v) => s + v, 0) / count,
        p25: sorted[Math.floor(count * 0.25)],
        p75: sorted[Math.floor(count * 0.75)],
        count,
        unit: vals[0].unit,
      };
    }
    return Object.keys(ranges).length > 0 ? ranges : null;
  } catch (e) {
    console.error('[Benchmarks] Range query error:', e.message);
    return null;
  }
}

/**
 * Format benchmark ranges as a string for injection into AI prompt
 */
function formatBenchmarksForPrompt(ranges, projectType) {
  if (!ranges) return '';
  const lines = Object.entries(ranges)
    .slice(0, 40) // cap at 40 elements
    .map(([key, r]) => `  ${key}: ${r.min.toFixed(1)}–${r.max.toFixed(1)} ${r.unit} (avg ${r.avg.toFixed(1)}, n=${r.count})`);
  
  if (lines.length === 0) return '';
  return `\n=== HISTORICAL QUANTITY RANGES (${projectType}, ${lines.length} elements from ${Object.values(ranges)[0]?.count || 0}+ past projects) ===\nUse these to SANITY CHECK your measurements. If your extracted quantity falls outside min–max, flag it with ⚠️ WARNING.\n${lines.join('\n')}\n===\n`;
}

/**
 * Sanity check extracted items against benchmarks
 * Returns array of warnings
 */
function sanityCheckItems(items, ranges) {
  if (!ranges || !items) return [];
  const warnings = [];
  for (const item of items) {
    const range = ranges[item.key];
    if (!range || range.count < 3) continue; // need enough data
    if (item.qty < range.min * 0.5) {
      warnings.push(`⚠️ ${item.key}: qty ${item.qty} ${item.unit} is significantly BELOW historical range (${range.min.toFixed(1)}–${range.max.toFixed(1)} ${range.unit})`);
    } else if (item.qty > range.max * 1.5) {
      warnings.push(`⚠️ ${item.key}: qty ${item.qty} ${item.unit} is significantly ABOVE historical range (${range.min.toFixed(1)}–${range.max.toFixed(1)} ${range.unit})`);
    }
  }
  return warnings;
}

module.exports = {
  initBenchmarkTables,
  saveTakeoff,
  updateTakeoff,
  getTakeoffBySession,
  getTakeoffById,
  extractAndStoreBenchmarks,
  getBenchmarkRanges,
  formatBenchmarksForPrompt,
  sanityCheckItems,
};

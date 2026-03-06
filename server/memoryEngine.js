/**
 * memoryEngine.js
 * 
 * The AI QS system's long-term memory. Every confirmed BOQ, every rate
 * correction, every user preference, every anomaly flag — all stored and
 * retrieved to make the next project more accurate.
 *
 * Memory layers:
 *   1. RATE MEMORY        — learned rates per item, per client, per region
 *   2. QUANTITY MEMORY    — typical qty ranges per element per project type
 *   3. PROJECT MEMORY     — project-level stats for macro benchmarking
 *   4. CORRECTION MEMORY  — explicit user corrections with reason + context
 *   5. PATTERN MEMORY     — co-occurrence patterns (if X then usually Y)
 *   6. CLIENT MEMORY      — per-client preferences, spec levels, regions
 */

const { v4: uuidv4 } = require('uuid');

// ─── INITIALISE ALL MEMORY TABLES ────────────────────────────────────────────

function initMemoryTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_rates (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      user_id TEXT,
      item_key TEXT NOT NULL,
      region TEXT DEFAULT 'uk_average',
      project_type TEXT DEFAULT 'any',
      rate REAL NOT NULL,
      sample_count INTEGER DEFAULT 1,
      sum_rates REAL NOT NULL,
      min_rate REAL,
      max_rate REAL,
      stddev REAL DEFAULT 0,
      confidence REAL DEFAULT 0.5,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(scope, user_id, item_key, region, project_type)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_quantities (
      id TEXT PRIMARY KEY,
      project_type TEXT NOT NULL,
      item_key TEXT NOT NULL,
      unit TEXT,
      floor_area_m2 REAL,
      qty REAL NOT NULL,
      qty_per_m2 REAL,
      ratio_to_floor REAL,
      region TEXT DEFAULT 'uk_average',
      source_takeoff_id TEXT,
      confirmed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mem_qty_type_key
    ON memory_quantities(project_type, item_key)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_type TEXT,
      region TEXT,
      floor_area_m2 REAL,
      construction_total REAL,
      grand_total REAL,
      item_count INTEGER,
      cost_per_m2 REAL,
      contingency_pct REAL,
      section_breakdown TEXT,
      confirmed INTEGER DEFAULT 0,
      takeoff_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_corrections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_key TEXT,
      field TEXT NOT NULL,
      old_value REAL,
      new_value REAL,
      reason TEXT,
      context TEXT,
      applied_count INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_patterns (
      id TEXT PRIMARY KEY,
      item_key_a TEXT NOT NULL,
      item_key_b TEXT NOT NULL,
      co_occurrence_count INTEGER DEFAULT 1,
      project_type TEXT DEFAULT 'any',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_key_a, item_key_b, project_type)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_client_profile (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      preferred_regions TEXT DEFAULT '[]',
      project_types TEXT DEFAULT '[]',
      avg_floor_area_m2 REAL,
      avg_project_value REAL,
      spec_level TEXT DEFAULT 'standard',
      contingency_pref REAL DEFAULT 7.5,
      ohp_pref REAL DEFAULT 12,
      vat_registered INTEGER DEFAULT 1,
      total_projects INTEGER DEFAULT 0,
      notes TEXT DEFAULT '[]',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mem_rates_key_region
    ON memory_rates(item_key, region, project_type)
  `);

  console.log('[Memory] All memory tables initialised');
}

// ─── RATE MEMORY ─────────────────────────────────────────────────────────────

/**
 * Record a rate observation (from confirmed BOQ or correction)
 * Updates running stats: mean, min, max, stddev, confidence
 */
function recordRate(db, { itemKey, rate, region = 'uk_average', projectType = 'any', userId = null, scope = 'global' }) {
  if (!itemKey || !rate || rate <= 0) return;
  try {
    const existing = db.prepare(`
      SELECT * FROM memory_rates
      WHERE scope=? AND (user_id=? OR (scope='global' AND user_id IS NULL))
      AND item_key=? AND region=? AND project_type=?
    `).get(scope, userId || null, itemKey, region, projectType);

    if (existing) {
      const n = existing.sample_count + 1;
      const newSum = existing.sum_rates + rate;
      const newMean = newSum / n;
      const newMin = Math.min(existing.min_rate, rate);
      const newMax = Math.max(existing.max_rate, rate);
      // Welford's online variance
      const delta = rate - newMean;
      const newVariance = ((existing.stddev * existing.stddev * (n - 1)) + delta * delta) / n;
      const newStddev = Math.sqrt(newVariance);
      const newConfidence = Math.min(0.98, 0.5 + (n / 20) * 0.48); // grows with sample count, caps at 0.98
      db.prepare(`
        UPDATE memory_rates SET
          rate=?, sample_count=?, sum_rates=?, min_rate=?, max_rate=?,
          stddev=?, confidence=?, last_seen=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(newMean, n, newSum, newMin, newMax, newStddev, newConfidence, existing.id);
    } else {
      db.prepare(`
        INSERT INTO memory_rates (id,scope,user_id,item_key,region,project_type,rate,sample_count,sum_rates,min_rate,max_rate,confidence)
        VALUES (?,?,?,?,?,?,?,1,?,?,?,0.5)
      `).run('mr_'+uuidv4().slice(0,8), scope, userId||null, itemKey, region, projectType, rate, rate, rate, rate);
    }
  } catch (e) { console.error('[Memory] recordRate error:', e.message); }
}

/**
 * Get best rate for an item — prefers client-specific > regional > global
 * Returns { rate, confidence, source, sample_count }
 */
function getBestRate(db, { itemKey, region = 'uk_average', projectType = 'any', userId = null }) {
  try {
    // Priority 1: client-specific rate
    if (userId) {
      const clientRate = db.prepare(`
        SELECT rate, confidence, sample_count FROM memory_rates
        WHERE scope='client' AND user_id=? AND item_key=? AND project_type IN (?, 'any')
        ORDER BY project_type DESC, confidence DESC LIMIT 1
      `).get(userId, itemKey, projectType);
      if (clientRate && clientRate.confidence > 0.6) {
        return { ...clientRate, source: 'client_memory' };
      }
    }

    // Priority 2: regional rate
    const regionalRate = db.prepare(`
      SELECT rate, confidence, sample_count FROM memory_rates
      WHERE scope='global' AND region=? AND item_key=? AND project_type IN (?, 'any')
      ORDER BY project_type DESC, confidence DESC, sample_count DESC LIMIT 1
    `).get(region, itemKey, projectType);
    if (regionalRate && regionalRate.confidence > 0.55) {
      return { ...regionalRate, source: 'regional_memory' };
    }

    // Priority 3: global rate
    const globalRate = db.prepare(`
      SELECT rate, confidence, sample_count FROM memory_rates
      WHERE scope='global' AND item_key=? AND project_type IN (?, 'any')
      ORDER BY confidence DESC, sample_count DESC LIMIT 1
    `).get(itemKey, projectType);
    if (globalRate) return { ...globalRate, source: 'global_memory' };

    return null;
  } catch (e) {
    console.error('[Memory] getBestRate error:', e.message);
    return null;
  }
}

// ─── QUANTITY MEMORY ──────────────────────────────────────────────────────────

/**
 * Record quantity observations from a confirmed takeoff
 */
function recordQuantities(db, { items, projectType, floorAreaM2, region = 'uk_average', takeoffId, confirmed = true }) {
  if (!items || items.length === 0) return;
  try {
    const insert = db.prepare(`
      INSERT INTO memory_quantities (id,project_type,item_key,unit,floor_area_m2,qty,qty_per_m2,ratio_to_floor,region,source_takeoff_id,confirmed)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    const tx = db.transaction(() => {
      for (const item of items) {
        if (!item.key || !item.qty || item.qty <= 0) continue;
        const qtyPerM2 = floorAreaM2 ? item.qty / floorAreaM2 : null;
        const ratio = floorAreaM2 ? item.qty / floorAreaM2 : null;
        insert.run(
          'mq_'+uuidv4().slice(0,8),
          projectType || 'general',
          item.key,
          item.unit || '',
          floorAreaM2 || null,
          item.qty,
          qtyPerM2,
          ratio,
          region,
          takeoffId || null,
          confirmed ? 1 : 0
        );
      }
    });
    tx();
  } catch (e) { console.error('[Memory] recordQuantities error:', e.message); }
}

/**
 * Get quantity ranges for sanity checking
 * Returns { min, max, avg, p25, p75, count, stddev }
 */
function getQuantityRanges(db, { projectType, floorAreaM2 }) {
  try {
    const rows = db.prepare(`
      SELECT item_key, unit, qty_per_m2, qty
      FROM memory_quantities
      WHERE project_type=? AND confirmed=1
      ORDER BY item_key
    `).all(projectType || 'any');

    if (rows.length === 0) return {};

    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.item_key]) grouped[row.item_key] = { vals: [], unit: row.unit };
      const val = (row.qty_per_m2 && floorAreaM2) ? row.qty_per_m2 * floorAreaM2 : row.qty;
      grouped[row.item_key].vals.push(val);
    }

    const result = {};
    for (const [key, data] of Object.entries(grouped)) {
      if (data.vals.length < 2) continue;
      const sorted = [...data.vals].sort((a, b) => a - b);
      const n = sorted.length;
      const avg = sorted.reduce((s, v) => s + v, 0) / n;
      const variance = sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / n;
      result[key] = {
        min: sorted[0], max: sorted[n-1], avg,
        p25: sorted[Math.floor(n * 0.25)],
        p75: sorted[Math.floor(n * 0.75)],
        stddev: Math.sqrt(variance),
        count: n,
        unit: data.unit,
      };
    }
    return result;
  } catch (e) {
    console.error('[Memory] getQuantityRanges error:', e.message);
    return {};
  }
}

// ─── PATTERN MEMORY ───────────────────────────────────────────────────────────

/**
 * Record co-occurrence patterns between items in a project
 * e.g. if bifold_door_aluminium always appears with steel_lintels_bespoke
 */
function recordPatterns(db, { items, projectType = 'any' }) {
  if (!items || items.length < 2) return;
  try {
    const keys = items.map(i => i.key).filter(Boolean);
    const upsert = db.prepare(`
      INSERT INTO memory_patterns (id,item_key_a,item_key_b,project_type,co_occurrence_count)
      VALUES (?,?,?,?,1)
      ON CONFLICT(item_key_a,item_key_b,project_type)
      DO UPDATE SET co_occurrence_count=co_occurrence_count+1
    `);
    const tx = db.transaction(() => {
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const [a, b] = [keys[i], keys[j]].sort();
          upsert.run('mp_'+uuidv4().slice(0,8), a, b, projectType);
        }
      }
    });
    tx();
  } catch (e) { /* patterns are non-critical */ }
}

/**
 * Get likely missing items based on patterns from similar projects
 */
function getSuggestedItems(db, { presentKeys, projectType }) {
  if (!presentKeys || presentKeys.length === 0) return [];
  try {
    const placeholders = presentKeys.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT item_key_b as suggested, SUM(co_occurrence_count) as strength
      FROM memory_patterns
      WHERE item_key_a IN (${placeholders})
      AND project_type IN (?, 'any')
      AND item_key_b NOT IN (${placeholders})
      GROUP BY item_key_b
      HAVING strength > 2
      ORDER BY strength DESC
      LIMIT 10
    `).all(...presentKeys, projectType, ...presentKeys);
    return rows.map(r => ({ key: r.suggested, strength: r.strength }));
  } catch (e) { return []; }
}

// ─── CORRECTION MEMORY ────────────────────────────────────────────────────────

/**
 * Record an explicit user correction
 */
function recordCorrection(db, { userId, itemKey, field, oldValue, newValue, reason, context }) {
  try {
    db.prepare(`
      INSERT INTO memory_corrections (id,user_id,item_key,field,old_value,new_value,reason,context)
      VALUES (?,?,?,?,?,?,?,?)
    `).run('mc_'+uuidv4().slice(0,8), userId, itemKey||null, field, oldValue||null, newValue||null, reason||null, context||null);

    // If it's a rate correction, feed into rate memory
    if (field === 'rate' && newValue && newValue > 0) {
      recordRate(db, { itemKey, rate: newValue, userId, scope: 'client' });
    }
  } catch (e) { console.error('[Memory] recordCorrection error:', e.message); }
}

// ─── PROJECT MEMORY ───────────────────────────────────────────────────────────

/**
 * Record a completed project for macro benchmarking
 */
function recordProject(db, { userId, projectType, region, floorAreaM2, constructionTotal, grandTotal, itemCount, contingencyPct, sectionBreakdown, takeoffId }) {
  try {
    const costPerM2 = floorAreaM2 && floorAreaM2 > 0 ? constructionTotal / floorAreaM2 : null;
    db.prepare(`
      INSERT INTO memory_projects (id,user_id,project_type,region,floor_area_m2,construction_total,grand_total,item_count,cost_per_m2,contingency_pct,section_breakdown,confirmed,takeoff_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
    `).run(
      'mp_'+uuidv4().slice(0,8), userId, projectType||'general', region||'uk_average',
      floorAreaM2||null, constructionTotal, grandTotal, itemCount||0,
      costPerM2, contingencyPct||7.5,
      JSON.stringify(sectionBreakdown||{}), takeoffId||null
    );
  } catch (e) { console.error('[Memory] recordProject error:', e.message); }
}

/**
 * Get project-level benchmarks for a type/region
 */
function getProjectBenchmarks(db, { projectType, region }) {
  try {
    const rows = db.prepare(`
      SELECT construction_total, grand_total, floor_area_m2, cost_per_m2, item_count
      FROM memory_projects
      WHERE confirmed=1
      AND (project_type=? OR project_type='general')
      AND (region=? OR region='uk_average')
      ORDER BY created_at DESC LIMIT 50
    `).all(projectType||'general', region||'uk_average');

    if (rows.length < 2) return null;

    const vals = (field) => rows.map(r => r[field]).filter(v => v != null);
    const stats = (arr) => {
      if (arr.length === 0) return null;
      const sorted = [...arr].sort((a,b) => a-b);
      const avg = arr.reduce((s,v) => s+v, 0) / arr.length;
      return { min: sorted[0], max: sorted[sorted.length-1], avg, count: arr.length };
    };

    return {
      construction_total: stats(vals('construction_total')),
      grand_total: stats(vals('grand_total')),
      floor_area_m2: stats(vals('floor_area_m2')),
      cost_per_m2: stats(vals('cost_per_m2')),
      item_count: stats(vals('item_count')),
      sample_count: rows.length,
    };
  } catch (e) { return null; }
}

// ─── CLIENT PROFILE ───────────────────────────────────────────────────────────

/**
 * Update client profile after a project
 */
function updateClientProfile(db, { userId, projectType, region, floorAreaM2, grandTotal, specLevel }) {
  try {
    const existing = db.prepare(`SELECT * FROM memory_client_profile WHERE user_id=?`).get(userId);
    if (!existing) {
      db.prepare(`
        INSERT INTO memory_client_profile (id,user_id,project_types,preferred_regions,avg_floor_area_m2,avg_project_value,spec_level,total_projects)
        VALUES (?,?,?,?,?,?,?,1)
      `).run('cp_'+uuidv4().slice(0,8), userId,
        JSON.stringify([projectType].filter(Boolean)),
        JSON.stringify([region].filter(Boolean)),
        floorAreaM2||null, grandTotal||null, specLevel||'standard'
      );
    } else {
      const types = JSON.parse(existing.project_types||'[]');
      if (projectType && !types.includes(projectType)) types.push(projectType);
      const regions = JSON.parse(existing.preferred_regions||'[]');
      if (region && !regions.includes(region)) regions.push(region);
      const n = existing.total_projects + 1;
      const newAvgArea = existing.avg_floor_area_m2
        ? ((existing.avg_floor_area_m2 * (n-1)) + (floorAreaM2||0)) / n
        : floorAreaM2;
      const newAvgVal = existing.avg_project_value
        ? ((existing.avg_project_value * (n-1)) + (grandTotal||0)) / n
        : grandTotal;
      db.prepare(`
        UPDATE memory_client_profile SET
          project_types=?, preferred_regions=?, avg_floor_area_m2=?,
          avg_project_value=?, total_projects=?, updated_at=CURRENT_TIMESTAMP
        WHERE user_id=?
      `).run(JSON.stringify(types), JSON.stringify(regions), newAvgArea, newAvgVal, n, userId);
    }
  } catch (e) { console.error('[Memory] updateClientProfile error:', e.message); }
}

/**
 * Get client profile summary for AI context injection
 */
function getClientContext(db, userId) {
  try {
    const profile = db.prepare(`SELECT * FROM memory_client_profile WHERE user_id=?`).get(userId);
    if (!profile || profile.total_projects === 0) return null;

    const recentProjects = db.prepare(`
      SELECT project_type, region, floor_area_m2, grand_total, cost_per_m2, created_at
      FROM memory_projects WHERE user_id=? AND confirmed=1
      ORDER BY created_at DESC LIMIT 5
    `).all(userId);

    const recentCorrections = db.prepare(`
      SELECT item_key, field, old_value, new_value, reason, created_at
      FROM memory_corrections WHERE user_id=?
      ORDER BY created_at DESC LIMIT 20
    `).all(userId);

    return {
      profile,
      recent_projects: recentProjects,
      recent_corrections: recentCorrections,
      project_types: JSON.parse(profile.project_types||'[]'),
      preferred_regions: JSON.parse(profile.preferred_regions||'[]'),
    };
  } catch (e) { return null; }
}

// ─── FULL PROJECT LEARN ───────────────────────────────────────────────────────

/**
 * Master function called after every confirmed BOQ.
 * Feeds ALL memory layers from a single confirmed project.
 */
function learnFromConfirmedProject(db, { userId, takeoffId, items, pricedResult, location, projectType, floorAreaM2 }) {
  const region = detectRegion(location);
  console.log(`[Memory] Learning from project: ${projectType} in ${region} (${items.length} items)`);

  // 1. Record all rates
  for (const item of items) {
    if (item.rate && item.rate > 0) {
      // Global (cross-client anonymised)
      recordRate(db, { itemKey: item.key, rate: item.rate, region, projectType, scope: 'global' });
      // Client-specific
      if (userId) {
        recordRate(db, { itemKey: item.key, rate: item.rate, region, projectType, userId, scope: 'client' });
      }
    }
  }

  // 2. Record quantities
  recordQuantities(db, { items, projectType, floorAreaM2, region, takeoffId, confirmed: true });

  // 3. Record co-occurrence patterns
  recordPatterns(db, { items, projectType });

  // 4. Record project-level stats
  if (pricedResult) {
    recordProject(db, {
      userId, projectType, region, floorAreaM2,
      constructionTotal: pricedResult.summary?.construction_total,
      grandTotal: pricedResult.summary?.grand_total,
      itemCount: pricedResult.item_count,
      contingencyPct: pricedResult.summary?.contingency_pct,
      sectionBreakdown: pricedResult.sections?.reduce((acc, s) => { acc[s.name] = s.subtotal; return acc; }, {}),
      takeoffId,
    });
  }

  // 5. Update client profile
  updateClientProfile(db, {
    userId, projectType, region, floorAreaM2,
    grandTotal: pricedResult?.summary?.grand_total,
  });

  console.log(`[Memory] Learning complete for takeoff ${takeoffId}`);
}

// ─── CONTEXT BUILDER ─────────────────────────────────────────────────────────

/**
 * Build full memory context string for injection into AI system prompt
 * This is what makes the AI smarter on every subsequent project
 */
function buildMemoryContext(db, { userId, projectType, floorAreaM2, region }) {
  const sections = [];

  // Client profile
  const clientCtx = getClientContext(db, userId);
  if (clientCtx && clientCtx.profile.total_projects > 0) {
    const p = clientCtx.profile;
    sections.push(`=== CLIENT HISTORY (${p.total_projects} completed projects) ===
Avg project size: ${p.avg_floor_area_m2 ? p.avg_floor_area_m2.toFixed(0) + 'm²' : 'unknown'}
Avg project value: ${p.avg_project_value ? '£' + Math.round(p.avg_project_value).toLocaleString() : 'unknown'}
Project types: ${clientCtx.project_types.join(', ') || 'various'}
Preferred regions: ${clientCtx.preferred_regions.join(', ') || 'various'}
Spec level: ${p.spec_level || 'standard'}
===`);

    if (clientCtx.recent_projects.length > 0) {
      const recent = clientCtx.recent_projects.slice(0, 3).map(p =>
        `  ${p.project_type || 'project'} ${p.region ? 'in '+p.region : ''}: £${Math.round(p.grand_total||0).toLocaleString()}${p.cost_per_m2 ? ' (£'+Math.round(p.cost_per_m2)+'/m²)' : ''}`
      ).join('\n');
      sections.push(`=== RECENT PROJECTS (for context) ===\n${recent}\n===`);
    }

    if (clientCtx.recent_corrections.length > 0) {
      const corrections = clientCtx.recent_corrections.slice(0, 10).map(c =>
        `  ${c.item_key || 'item'}: ${c.field} ${c.old_value ? 'from '+c.old_value : ''} → ${c.new_value}${c.reason ? ' ('+c.reason+')' : ''}`
      ).join('\n');
      sections.push(`=== RECENT CORRECTIONS (apply these preferences) ===\n${corrections}\n===`);
    }
  }

  // Project benchmarks
  const projBenchmarks = getProjectBenchmarks(db, { projectType, region });
  if (projBenchmarks) {
    const s = projBenchmarks;
    sections.push(`=== PROJECT BENCHMARKS (${s.sample_count} similar projects: ${projectType} in ${region}) ===
Construction total range: £${Math.round(s.construction_total?.min||0).toLocaleString()}–£${Math.round(s.construction_total?.max||0).toLocaleString()} (avg £${Math.round(s.construction_total?.avg||0).toLocaleString()})
Grand total range: £${Math.round(s.grand_total?.min||0).toLocaleString()}–£${Math.round(s.grand_total?.max||0).toLocaleString()}
${s.floor_area_m2 ? `Floor area range: ${Math.round(s.floor_area_m2.min)}–${Math.round(s.floor_area_m2.max)}m²` : ''}
${s.cost_per_m2 ? `Cost/m² range: £${Math.round(s.cost_per_m2.min)}–£${Math.round(s.cost_per_m2.max)}` : ''}
If your total falls significantly outside these ranges, flag it as an anomaly.
===`);
  }

  // Quantity ranges for this project type
  const qtyRanges = getQuantityRanges(db, { projectType, floorAreaM2 });
  const rangeEntries = Object.entries(qtyRanges);
  if (rangeEntries.length > 0) {
    const lines = rangeEntries.slice(0, 50).map(([key, r]) =>
      `  ${key}: ${r.min.toFixed(1)}–${r.max.toFixed(1)} ${r.unit} (avg ${r.avg.toFixed(1)}, σ=${r.stddev.toFixed(1)}, n=${r.count})`
    ).join('\n');
    sections.push(`=== QUANTITY MEMORY (${rangeEntries.length} elements from ${projectType} projects) ===
Flag with ⚠️ if your measurement falls outside min–max range.
${lines}
===`);
  }

  return sections.length > 0 ? '\n' + sections.join('\n\n') + '\n' : '';
}

/**
 * Sanity check extracted items against memory
 * Returns array of { key, qty, expected, severity, message }
 */
function sanityCheckWithMemory(db, { items, projectType, floorAreaM2 }) {
  const ranges = getQuantityRanges(db, { projectType, floorAreaM2 });
  const warnings = [];

  for (const item of items) {
    const range = ranges[item.key];
    if (!range || range.count < 3) continue;
    const tolerance = range.stddev * 2 || range.avg * 0.4;
    const low = Math.max(range.min - tolerance, range.min * 0.5);
    const high = range.max + tolerance;

    if (item.qty < low) {
      warnings.push({
        key: item.key, qty: item.qty,
        expected: `${range.min.toFixed(1)}–${range.max.toFixed(1)} ${range.unit}`,
        severity: item.qty < range.min * 0.3 ? 'high' : 'medium',
        message: `⚠️ ${item.key}: ${item.qty} ${item.unit} seems LOW vs history (${range.min.toFixed(1)}–${range.max.toFixed(1)}, avg ${range.avg.toFixed(1)})`
      });
    } else if (item.qty > high) {
      warnings.push({
        key: item.key, qty: item.qty,
        expected: `${range.min.toFixed(1)}–${range.max.toFixed(1)} ${range.unit}`,
        severity: item.qty > range.max * 2 ? 'high' : 'medium',
        message: `⚠️ ${item.key}: ${item.qty} ${item.unit} seems HIGH vs history (${range.min.toFixed(1)}–${range.max.toFixed(1)}, avg ${range.avg.toFixed(1)})`
      });
    }
  }
  return warnings;
}

// ─── MEMORY STATS ─────────────────────────────────────────────────────────────

/**
 * Get summary stats for admin/debugging
 */
function getMemoryStats(db) {
  try {
    return {
      rates: db.prepare(`SELECT COUNT(*) as n, ROUND(AVG(confidence),3) as avg_conf, SUM(sample_count) as total_samples FROM memory_rates`).get(),
      quantities: db.prepare(`SELECT COUNT(*) as n, COUNT(DISTINCT project_type) as types, COUNT(DISTINCT item_key) as keys FROM memory_quantities WHERE confirmed=1`).get(),
      projects: db.prepare(`SELECT COUNT(*) as n, COUNT(DISTINCT project_type) as types FROM memory_projects WHERE confirmed=1`).get(),
      corrections: db.prepare(`SELECT COUNT(*) as n FROM memory_corrections`).get(),
      patterns: db.prepare(`SELECT COUNT(*) as n FROM memory_patterns`).get(),
    };
  } catch (e) { return {}; }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function detectRegion(location) {
  if (!location) return 'uk_average';
  const loc = location.toLowerCase();
  if (/london|tw|richmond|kingston|wimbledon|sw\d|se\d|e\d|n\d|nw\d|w\d|ec\d|wc\d/.test(loc)) return 'london';
  if (/brighton|surrey|kent|essex|oxford|cambridge|reading|hertford/.test(loc)) return 'south_east';
  if (/bristol|bath|exeter|devon|somerset|cornwall|dorset/.test(loc)) return 'south_west';
  if (/birmingham|coventry|leicester|nottingham|derby|northampton/.test(loc)) return 'midlands';
  if (/manchester|liverpool|chester|lancashire|cheshire/.test(loc)) return 'north_west';
  if (/leeds|sheffield|york|hull|bradford/.test(loc)) return 'yorkshire';
  if (/newcastle|sunderland|durham|carlisle|cumbria/.test(loc)) return 'north_england';
  if (/edinburgh|glasgow|scotland|aberdeen|dundee|inverness/.test(loc)) return 'scotland';
  if (/cardiff|wales|swansea|newport/.test(loc)) return 'wales';
  if (/dublin|cork|ireland|galway|limerick/.test(loc)) return 'ireland';
  return 'uk_average';
}

module.exports = {
  initMemoryTables,
  recordRate,
  getBestRate,
  recordQuantities,
  getQuantityRanges,
  recordPatterns,
  getSuggestedItems,
  recordCorrection,
  recordProject,
  getProjectBenchmarks,
  updateClientProfile,
  getClientContext,
  learnFromConfirmedProject,
  buildMemoryContext,
  sanityCheckWithMemory,
  getMemoryStats,
  detectRegion,
};

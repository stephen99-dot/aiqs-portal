// ═══════════════════════════════════════════════════════════════════════════════
// UK MATERIALS PRICING — server/materialsRoutes.js
//
// A shared, searchable materials catalogue that plugs into the quote builder.
// Each material holds many supplier price_entries; every entry is auditable via
// source_url + captured_at. Powers the standalone compare page AND the
// Description-cell autocomplete in the BOQ/quote builder.
//
// All routes are JWT-protected and gated behind the Office-in-a-Box add-on
// (requireEstimator + requireEstimatorPassword), same as the quote builder.
//
//   GET    /api/materials/search?q=          — fuzzy typeahead (name + aliases)
//   GET    /api/materials                    — list catalogue (?category=)
//   POST   /api/materials                    — create a material
//   GET    /api/materials/:id                — material + its price_entries (?sort=)
//   PATCH  /api/materials/:id                — edit a material
//   DELETE /api/materials/:id                — delete a material + its entries
//   GET    /api/materials/meta/suppliers     — list suppliers
//   POST   /api/materials/meta/suppliers     — create a supplier
//   GET    /api/materials/meta/feasibility   — supplier automation feasibility list
//   POST   /api/materials/price-entries      — add a price entry (manual)
//   PATCH  /api/materials/price-entries/:id   — edit a price entry
//   DELETE /api/materials/price-entries/:id   — delete a price entry
//   POST   /api/materials/import-csv          — bulk import mapped CSV rows
//   POST   /api/materials/scrape              — scrape a public product URL
//   POST   /api/materials/refresh-stale       — re-run the stale flag now
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');
const { scrapeUrl, adapterFor, SUPPORTED_SUPPLIERS } = require('./materialsScrapers');
const { ensureCatalogue, backfillSearchUrls, importLivePrices } = require('./materialsCatalogue');

const router = express.Router();

const STALE_DAYS = 30;

// Suppliers we can realistically automate (public prices) vs manual/CSV only.
// Surfaced verbatim to the UI as the feasibility list (deliverable #4).
const FEASIBILITY = {
  stale_days: STALE_DAYS,
  automatable: [
    { name: 'Screwfix',    note: 'Public product pages, usually JSON-LD structured data.' },
    { name: 'Toolstation', note: 'Public retail prices.' },
    { name: 'Wickes',      note: 'Public retail prices.' },
    { name: 'B&Q',         note: 'Public retail prices (diy.com).' },
    { name: 'Selco',       note: 'Public site exposes prices (trade-oriented but viewable).' },
  ],
  manual_only: [
    { name: 'Travis Perkins', note: 'No public pricing API; trade prices behind login.' },
    { name: 'Jewson',         note: 'No public pricing API; trade prices behind login.' },
    { name: 'MKM',            note: 'No public pricing API; trade prices behind login.' },
    { name: 'Buildbase',      note: 'No public pricing API; trade prices behind login.' },
    { name: 'Howdens',        note: 'No online pricing at all — quote only.' },
  ],
  caveats:
    'No UK merchant publishes an official pricing API. Automated capture is best-effort ' +
    'HTML scraping that respects robots.txt, is rate-limited, and records source_url + ' +
    'captured_at for audit. Manual entry and CSV import are the reliable backbone.',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Collapse a string to a comparable token: lowercase, "by" -> "x", strip
// non-alphanumerics. So "4x2", "4 by 2" and "4 X 2" all become "4x2".
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bby\b/g, 'x')
    .replace(/[^a-z0-9]+/g, '');
}

function aliasList(material) {
  return [material.canonical_name, material.search_aliases, material.category]
    .filter(Boolean)
    .join(' ');
}

// Live staleness — never trust the stored flag alone (it's only as fresh as the
// last job run). captured_at older than STALE_DAYS => stale.
const STALE_SQL = `CASE WHEN julianday('now') - julianday(captured_at) > ${STALE_DAYS} THEN 1 ELSE 0 END`;

// Build the price-entry rows for a material with supplier names + cheapest /
// dearest / stale flags, sorted by price.
function pricesForMaterial(materialId, sort = 'asc') {
  const dir = sort === 'desc' ? 'DESC' : 'ASC';
  const rows = db.prepare(
    `SELECT pe.*, ${STALE_SQL} AS is_stale,
            s.name AS supplier_name, s.account_type AS supplier_account_type, s.region AS supplier_region
       FROM price_entries pe
       JOIN suppliers s ON s.id = pe.supplier_id
      WHERE pe.material_id = ?
      ORDER BY pe.price ${dir}`
  ).all(materialId);
  if (rows.length > 0) {
    let minP = Infinity, maxP = -Infinity;
    for (const r of rows) { if (r.price < minP) minP = r.price; if (r.price > maxP) maxP = r.price; }
    for (const r of rows) {
      r.in_stock = !!r.in_stock;
      r.is_stale = !!r.is_stale;
      r.is_cheapest = r.price === minP;
      r.is_most_expensive = r.price === maxP && maxP !== minP;
    }
  }
  return rows;
}

function priceSummary(materialId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count, MIN(price) AS min_price, MAX(price) AS max_price,
            SUM(${STALE_SQL}) AS stale_count
       FROM price_entries WHERE material_id = ?`
  ).get(materialId);
  return {
    count: row.count || 0,
    min_price: row.min_price,
    max_price: row.max_price,
    stale_count: row.stale_count || 0,
  };
}

// Find a supplier by (case-insensitive) name, or create one.
function resolveSupplier(name, { region, account_type, website } = {}, userId) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  let row = db.prepare('SELECT * FROM suppliers WHERE LOWER(name) = LOWER(?)').get(clean);
  if (row) return row;
  const id = uuidv4();
  db.prepare(
    'INSERT INTO suppliers (id, name, region, account_type, website) VALUES (?, ?, ?, ?, ?)'
  ).run(id, clean, region || null, account_type || 'retail', website || null);
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
}

// ─── Stale-flag background job ────────────────────────────────────────────────
// Marks any price_entry older than STALE_DAYS as stale=1, fresh ones as 0.
function refreshStaleFlags() {
  try {
    const info = db.prepare(
      `UPDATE price_entries SET stale = ${STALE_SQL}`
    ).run();
    return info.changes || 0;
  } catch (err) {
    console.error('[Materials] stale refresh failed:', err.message);
    return 0;
  }
}

// ─── One-time seed (~10 common materials + sample prices) ──────────────────────
function seedIfEmpty() {
  const have = db.prepare('SELECT COUNT(*) AS c FROM materials').get().c;
  if (have > 0) return;
  console.log('[Materials] Seeding catalogue…');

  const suppliers = [
    { name: 'Screwfix',    region: 'UK', account_type: 'retail', website: 'https://www.screwfix.com' },
    { name: 'Toolstation', region: 'UK', account_type: 'retail', website: 'https://www.toolstation.com' },
    { name: 'Wickes',      region: 'UK', account_type: 'retail', website: 'https://www.wickes.co.uk' },
    { name: 'B&Q',         region: 'UK', account_type: 'retail', website: 'https://www.diy.com' },
    { name: 'Selco',       region: 'UK', account_type: 'trade',  website: 'https://www.selcobw.com' },
    { name: 'Jewson',      region: 'UK', account_type: 'trade',  website: 'https://www.jewson.co.uk' },
    { name: 'Travis Perkins', region: 'UK', account_type: 'trade', website: 'https://www.travisperkins.co.uk' },
  ];
  const supIds = {};
  const insSup = db.prepare('INSERT INTO suppliers (id, name, region, account_type, website) VALUES (?, ?, ?, ?, ?)');
  for (const s of suppliers) {
    const id = uuidv4();
    supIds[s.name] = id;
    insSup.run(id, s.name, s.region, s.account_type, s.website);
  }

  // captured_at offsets in days — some deliberately > 30 so STALE shows on day one.
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

  const materials = [
    {
      canonical_name: 'Sawn Timber 47x100mm (4x2) C16 Treated',
      category: 'Timber', default_unit: 'm',
      search_aliases: '4x2,4 by 2,4 x 2,47x100,two by four,2x4,wood,stud,carcassing timber',
      spec_notes: 'C16 graded, kiln-dried, treated for use class 2. Common stud/joist size.',
      prices: [
        { sup: 'Screwfix', price: 6.49, unit: 'm', via: 'manual', stock: 1, d: 3, url: 'https://www.screwfix.com/p/q-mark-treated-timber-47-x-100mm' },
        { sup: 'Wickes', price: 7.20, unit: 'm', via: 'manual', stock: 1, d: 10, url: 'https://www.wickes.co.uk/Wickes-Treated-Sawn-Timber-47-x-100mm' },
        { sup: 'Selco', price: 5.95, unit: 'm', via: 'manual', stock: 1, d: 5, url: 'https://www.selcobw.com/timber/c16-treated-47x100' },
        { sup: 'Travis Perkins', price: 8.10, unit: 'm', via: 'manual', stock: 0, d: 40, url: 'https://www.travisperkins.co.uk/c16-timber-47x100' },
      ],
    },
    {
      canonical_name: 'Plasterboard Standard 12.5mm 2400x1200mm',
      category: 'Plasterboard', default_unit: 'sheet',
      search_aliases: 'plasterboard,gyproc,wallboard,12.5mm board,drywall,gypsum board,8x4 board',
      spec_notes: 'Tapered edge, standard wallboard. 2.88 m² per sheet.',
      prices: [
        { sup: 'Wickes', price: 9.50, unit: 'sheet', via: 'manual', stock: 1, d: 4, url: 'https://www.wickes.co.uk/Wickes-Plasterboard-12.5mm' },
        { sup: 'B&Q', price: 10.20, unit: 'sheet', via: 'manual', stock: 1, d: 8, url: 'https://www.diy.com/departments/plasterboard-12-5mm' },
        { sup: 'Selco', price: 8.75, unit: 'sheet', via: 'manual', stock: 1, d: 6, url: 'https://www.selcobw.com/plasterboard-12-5mm' },
        { sup: 'Jewson', price: 11.40, unit: 'sheet', via: 'manual', stock: 1, d: 35, url: 'https://www.jewson.co.uk/plasterboard-standard-12-5' },
      ],
    },
    {
      canonical_name: 'Moisture Resistant Plasterboard 12.5mm 2400x1200mm',
      category: 'Plasterboard', default_unit: 'sheet',
      search_aliases: 'MR board,moisture board,green board,water resistant plasterboard,bathroom board',
      spec_notes: 'For bathrooms / kitchens. Tapered edge.',
      prices: [
        { sup: 'Wickes', price: 14.00, unit: 'sheet', via: 'manual', stock: 1, d: 5, url: 'https://www.wickes.co.uk/Wickes-Moisture-Resistant-Plasterboard' },
        { sup: 'Selco', price: 12.80, unit: 'sheet', via: 'manual', stock: 1, d: 7, url: 'https://www.selcobw.com/mr-plasterboard-12-5mm' },
        { sup: 'B&Q', price: 15.30, unit: 'sheet', via: 'manual', stock: 1, d: 2, url: 'https://www.diy.com/departments/moisture-resistant-plasterboard' },
      ],
    },
    {
      canonical_name: 'OSB3 Board 18mm 2400x1200mm',
      category: 'Sheet Materials', default_unit: 'sheet',
      search_aliases: 'osb,osb3,oriented strand board,sterling board,18mm osb,8x4 osb',
      spec_notes: 'Load-bearing, moisture-resistant board for flooring / sheathing.',
      prices: [
        { sup: 'Screwfix', price: 22.99, unit: 'sheet', via: 'manual', stock: 1, d: 3, url: 'https://www.screwfix.com/p/osb3-board-18mm' },
        { sup: 'Wickes', price: 24.50, unit: 'sheet', via: 'manual', stock: 1, d: 9, url: 'https://www.wickes.co.uk/Wickes-OSB3-18mm' },
        { sup: 'Selco', price: 21.40, unit: 'sheet', via: 'manual', stock: 1, d: 6, url: 'https://www.selcobw.com/osb3-18mm' },
      ],
    },
    {
      canonical_name: 'OSB3 Board 11mm 2400x1200mm',
      category: 'Sheet Materials', default_unit: 'sheet',
      search_aliases: 'osb 11mm,thin osb,roof sheathing osb,11mm board',
      spec_notes: 'Thinner OSB for roof sheathing / hoarding.',
      prices: [
        { sup: 'Screwfix', price: 16.49, unit: 'sheet', via: 'manual', stock: 1, d: 12, url: 'https://www.screwfix.com/p/osb3-board-11mm' },
        { sup: 'B&Q', price: 17.80, unit: 'sheet', via: 'manual', stock: 1, d: 41, url: 'https://www.diy.com/departments/osb3-11mm' },
      ],
    },
    {
      canonical_name: 'Celotex / PIR Insulation Board 100mm 2400x1200mm',
      category: 'Insulation', default_unit: 'sheet',
      search_aliases: 'celotex,kingspan,pir board,insulation 100mm,rigid insulation,100mm celotex',
      spec_notes: 'Rigid PIR insulation board. Foil-faced both sides.',
      prices: [
        { sup: 'Wickes', price: 39.00, unit: 'sheet', via: 'manual', stock: 1, d: 4, url: 'https://www.wickes.co.uk/Wickes-PIR-Insulation-100mm' },
        { sup: 'Selco', price: 35.50, unit: 'sheet', via: 'manual', stock: 1, d: 8, url: 'https://www.selcobw.com/pir-insulation-100mm' },
        { sup: 'Travis Perkins', price: 42.20, unit: 'sheet', via: 'manual', stock: 0, d: 33, url: 'https://www.travisperkins.co.uk/celotex-100mm' },
      ],
    },
    {
      canonical_name: 'Loft Insulation Roll 170mm 5.4m²',
      category: 'Insulation', default_unit: 'roll',
      search_aliases: 'loft roll,mineral wool,glass wool,170mm insulation,quilt insulation,knauf roll',
      spec_notes: 'Mineral wool quilt for loft / between joists.',
      prices: [
        { sup: 'B&Q', price: 21.00, unit: 'roll', via: 'manual', stock: 1, d: 6, url: 'https://www.diy.com/departments/loft-roll-170mm' },
        { sup: 'Wickes', price: 22.50, unit: 'roll', via: 'manual', stock: 1, d: 11, url: 'https://www.wickes.co.uk/Wickes-Loft-Roll-170mm' },
      ],
    },
    {
      canonical_name: 'Portland Cement 25kg',
      category: 'Cement & Aggregates', default_unit: 'bag',
      search_aliases: 'cement,opc,portland cement,25kg cement,grey cement,bag of cement',
      spec_notes: 'CEM I / general purpose Portland cement, 25 kg bag.',
      prices: [
        { sup: 'Screwfix', price: 6.29, unit: 'bag', via: 'manual', stock: 1, d: 2, url: 'https://www.screwfix.com/p/cement-25kg' },
        { sup: 'Wickes', price: 6.50, unit: 'bag', via: 'manual', stock: 1, d: 7, url: 'https://www.wickes.co.uk/Wickes-Cement-25kg' },
        { sup: 'Selco', price: 5.85, unit: 'bag', via: 'manual', stock: 1, d: 5, url: 'https://www.selcobw.com/cement-25kg' },
        { sup: 'Jewson', price: 7.10, unit: 'bag', via: 'manual', stock: 1, d: 38, url: 'https://www.jewson.co.uk/cement-25kg' },
      ],
    },
    {
      canonical_name: 'Sharp Sand 25kg (Maxi Bag)',
      category: 'Cement & Aggregates', default_unit: 'bag',
      search_aliases: 'sharp sand,grit sand,concreting sand,25kg sand,bag of sand',
      spec_notes: 'Washed sharp sand for concrete / screed.',
      prices: [
        { sup: 'Wickes', price: 4.20, unit: 'bag', via: 'manual', stock: 1, d: 9, url: 'https://www.wickes.co.uk/Wickes-Sharp-Sand-25kg' },
        { sup: 'B&Q', price: 4.50, unit: 'bag', via: 'manual', stock: 1, d: 3, url: 'https://www.diy.com/departments/sharp-sand-25kg' },
        { sup: 'Selco', price: 3.95, unit: 'bag', via: 'manual', stock: 1, d: 14, url: 'https://www.selcobw.com/sharp-sand-25kg' },
      ],
    },
    {
      canonical_name: 'Building Sand 25kg (Maxi Bag)',
      category: 'Cement & Aggregates', default_unit: 'bag',
      search_aliases: 'building sand,soft sand,plastering sand,bricklaying sand,25kg building sand',
      spec_notes: 'Soft sand for bricklaying mortar / render.',
      prices: [
        { sup: 'Wickes', price: 4.00, unit: 'bag', via: 'manual', stock: 1, d: 10, url: 'https://www.wickes.co.uk/Wickes-Building-Sand-25kg' },
        { sup: 'Screwfix', price: 4.35, unit: 'bag', via: 'manual', stock: 1, d: 4, url: 'https://www.screwfix.com/p/building-sand-25kg' },
      ],
    },
    {
      canonical_name: 'Multi-Finish Plaster 25kg',
      category: 'Plaster', default_unit: 'bag',
      search_aliases: 'multi finish,thistle multi,skim plaster,finish plaster,25kg plaster',
      spec_notes: 'Thistle Multi-Finish skim coat plaster.',
      prices: [
        { sup: 'Screwfix', price: 11.49, unit: 'bag', via: 'manual', stock: 1, d: 5, url: 'https://www.screwfix.com/p/thistle-multi-finish-plaster-25kg' },
        { sup: 'Selco', price: 10.20, unit: 'bag', via: 'manual', stock: 1, d: 6, url: 'https://www.selcobw.com/multi-finish-25kg' },
        { sup: 'Wickes', price: 12.00, unit: 'bag', via: 'manual', stock: 1, d: 45, url: 'https://www.wickes.co.uk/Wickes-Multi-Finish-25kg' },
      ],
    },
  ];

  const insMat = db.prepare(
    'INSERT INTO materials (id, canonical_name, category, default_unit, search_aliases, spec_notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insPrice = db.prepare(
    'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_at, captured_via, in_stock, stale, notes, created_by) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const seedTxn = db.transaction(() => {
    for (const m of materials) {
      const mid = uuidv4();
      insMat.run(mid, m.canonical_name, m.category, m.default_unit, m.search_aliases, m.spec_notes, 'seed');
      for (const p of m.prices) {
        const supId = supIds[p.sup];
        if (!supId) continue;
        const capturedAt = daysAgo(p.d);
        const stale = p.d > STALE_DAYS ? 1 : 0;
        // NB: seed rows carry NO source_url on purpose — these are illustrative
        // sample prices, not real captures, so there is nothing to "Verify".
        // Real source links arrive via scrape / CSV import / manual entry.
        insPrice.run(uuidv4(), mid, supId, p.price, p.unit, null, capturedAt, p.via, p.stock, stale, 'Sample seed price — not a verified source', 'seed');
      }
    }
  });
  seedTxn();
  console.log('[Materials] Seeded ' + materials.length + ' materials.');
}

// One-time repair: an earlier seed shipped illustrative (fabricated) product
// URLs that 404 on the live supplier sites. Strip them from seed rows so the
// "Verify" link only ever points at a genuinely captured source. Idempotent —
// after the first run no seed row has an http source_url left to match.
function repairFabricatedSeedUrls() {
  try {
    const info = db.prepare(
      "UPDATE price_entries SET source_url = NULL, notes = 'Sample seed price — not a verified source' "
      + "WHERE created_by = 'seed' AND source_url LIKE 'http%'"
    ).run();
    if (info.changes) console.log('[Materials] cleared ' + info.changes + ' fabricated seed source URLs');
  } catch (err) {
    console.error('[Materials] seed URL repair failed:', err.message);
  }
}

seedIfEmpty();
repairFabricatedSeedUrls();
// Install / top-up the full built-in UK catalogue (idempotent — only adds
// materials that aren't already present).
try { ensureCatalogue(db); } catch (e) { console.error('[Materials] ensureCatalogue failed:', e.message); }
try { backfillSearchUrls(db); } catch (e) { console.error('[Materials] backfillSearchUrls failed:', e.message); }
// Load any real prices captured by the GitHub Actions scraper (committed JSON).
try { importLivePrices(db); } catch (e) { console.error('[Materials] importLivePrices failed:', e.message); }
refreshStaleFlags();
// Re-run the stale flag every 6h while the server is up.
const STALE_JOB_INTERVAL_MS = 6 * 60 * 60 * 1000;
const staleJob = setInterval(refreshStaleFlags, STALE_JOB_INTERVAL_MS);
if (staleJob.unref) staleJob.unref();

// ─── Auth gate (same as the quote builder) ─────────────────────────────────────
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

// ─── Feasibility list (deliverable #4) ─────────────────────────────────────────
router.get('/meta/feasibility', (req, res) => {
  res.json({ ...FEASIBILITY, supported_scrapers: SUPPORTED_SUPPLIERS });
});

// ─── Suppliers ─────────────────────────────────────────────────────────────────
router.get('/meta/suppliers', (req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
  res.json({ suppliers: rows });
});

router.post('/meta/suppliers', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Supplier name is required.' });
    const sup = resolveSupplier(b.name, {
      region: b.region, account_type: b.account_type, website: b.website,
    }, req.user.id);
    res.status(201).json({ supplier: sup });
  } catch (err) {
    console.error('[Materials] create supplier error:', err);
    res.status(500).json({ error: 'Failed to create supplier.' });
  }
});

// ─── Search (fuzzy typeahead across canonical_name + aliases) ──────────────────
router.get('/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 40);
    if (q.length < 2) return res.json({ results: [] });

    const tokens = q.split(/\s+/).map(normalize).filter(Boolean);
    if (tokens.length === 0) return res.json({ results: [] });

    const all = db.prepare('SELECT * FROM materials').all();
    const scored = [];
    for (const m of all) {
      const hay = normalize(aliasList(m));
      const nameNorm = normalize(m.canonical_name);
      let score = 0;
      let allHit = true;
      for (const tok of tokens) {
        if (hay.includes(tok)) {
          score += 3;
          if (nameNorm.includes(tok)) score += 1;
        } else {
          allHit = false;
        }
      }
      if (!allHit || score === 0) continue;
      scored.push({ m, score });
    }
    scored.sort((a, b) => b.score - a.score || a.m.canonical_name.localeCompare(b.m.canonical_name));

    const results = scored.slice(0, limit).map(({ m }) => {
      const summary = priceSummary(m.id);
      return {
        id: m.id,
        canonical_name: m.canonical_name,
        category: m.category,
        default_unit: m.default_unit,
        search_aliases: m.search_aliases,
        spec_notes: m.spec_notes,
        image_url: m.image_url,
        price_count: summary.count,
        min_price: summary.min_price,
        max_price: summary.max_price,
        stale_count: summary.stale_count,
      };
    });
    res.json({ results });
  } catch (err) {
    console.error('[Materials] search error:', err);
    res.status(500).json({ error: 'Search failed.' });
  }
});

// ─── List catalogue ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const category = req.query.category ? String(req.query.category) : null;
    const rows = category
      ? db.prepare('SELECT * FROM materials WHERE category = ? ORDER BY canonical_name ASC').all(category)
      : db.prepare('SELECT * FROM materials ORDER BY category ASC, canonical_name ASC').all();
    const materials = rows.map(m => ({ ...m, ...priceSummary(m.id) }));
    res.json({ materials });
  } catch (err) {
    console.error('[Materials] list error:', err);
    res.status(500).json({ error: 'Failed to load materials.' });
  }
});

// ─── Create material ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    if (!b.canonical_name || !String(b.canonical_name).trim()) {
      return res.status(400).json({ error: 'A material name is required.' });
    }
    const id = uuidv4();
    db.prepare(
      'INSERT INTO materials (id, canonical_name, category, default_unit, search_aliases, spec_notes, image_url, created_by) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, String(b.canonical_name).trim(), b.category || null, b.default_unit || null,
      b.search_aliases || null, b.spec_notes || null, b.image_url || null, req.user.id
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[Materials] create error:', err);
    res.status(500).json({ error: 'Failed to create material.' });
  }
});

// ─── Read one material + its price entries ────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Material not found.' });
    const sort = req.query.sort === 'desc' ? 'desc' : 'asc';
    const prices = pricesForMaterial(m.id, sort);
    res.json({ material: m, prices, stale_days: STALE_DAYS });
  } catch (err) {
    console.error('[Materials] get error:', err);
    res.status(500).json({ error: 'Failed to load material.' });
  }
});

// ─── Update material ─────────────────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  try {
    const m = db.prepare('SELECT id FROM materials WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Material not found.' });
    const b = req.body || {};
    const allowed = ['canonical_name', 'category', 'default_unit', 'search_aliases', 'spec_notes', 'image_url'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in b) { sets.push(k + ' = ?'); vals.push(b[k]); }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(m.id);
      db.prepare('UPDATE materials SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: m.id });
  } catch (err) {
    console.error('[Materials] update error:', err);
    res.status(500).json({ error: 'Failed to update material.' });
  }
});

// ─── Delete material (+ its price entries) ─────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const m = db.prepare('SELECT id FROM materials WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Material not found.' });
    const txn = db.transaction(() => {
      db.prepare('DELETE FROM price_entries WHERE material_id = ?').run(m.id);
      db.prepare('DELETE FROM materials WHERE id = ?').run(m.id);
    });
    txn();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Materials] delete error:', err);
    res.status(500).json({ error: 'Failed to delete material.' });
  }
});

// ─── Price entries CRUD ──────────────────────────────────────────────────────
router.post('/price-entries', (req, res) => {
  try {
    const b = req.body || {};
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(b.material_id);
    if (!material) return res.status(400).json({ error: 'Unknown material.' });
    if (!Number.isFinite(parseFloat(b.price))) return res.status(400).json({ error: 'A numeric price is required.' });

    let supplierId = b.supplier_id;
    if (!supplierId && b.supplier_name) {
      const sup = resolveSupplier(b.supplier_name, {}, req.user.id);
      supplierId = sup && sup.id;
    }
    const supplier = supplierId && db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId);
    if (!supplier) return res.status(400).json({ error: 'A supplier is required.' });

    const id = uuidv4();
    const stale = 0; // brand-new entry
    db.prepare(
      'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_via, in_stock, stale, notes, image_url, created_by) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, b.material_id, supplierId, num(b.price),
      b.unit || material.default_unit || null,
      b.source_url || null,
      b.captured_via || 'manual',
      b.in_stock === false || b.in_stock === 0 ? 0 : 1,
      stale, b.notes || null, b.image_url || null, req.user.id
    );
    res.status(201).json({ id });
  } catch (err) {
    console.error('[Materials] create price error:', err);
    res.status(500).json({ error: 'Failed to add price entry.' });
  }
});

router.patch('/price-entries/:id', (req, res) => {
  try {
    const pe = db.prepare('SELECT * FROM price_entries WHERE id = ?').get(req.params.id);
    if (!pe) return res.status(404).json({ error: 'Price entry not found.' });
    const b = req.body || {};
    const allowed = ['price', 'unit', 'source_url', 'in_stock', 'notes', 'supplier_id', 'captured_via', 'image_url'];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (!(k in b)) continue;
      if (k === 'in_stock') { sets.push('in_stock = ?'); vals.push(b.in_stock ? 1 : 0); }
      else if (k === 'price') { sets.push('price = ?'); vals.push(num(b.price)); }
      else { sets.push(k + ' = ?'); vals.push(b[k]); }
    }
    // Editing a price is a re-verification — refresh capture timestamp + clear stale.
    if ('price' in b || 'source_url' in b || b.reverify) {
      sets.push('captured_at = CURRENT_TIMESTAMP');
      sets.push('stale = 0');
    }
    if (sets.length) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(pe.id);
      db.prepare('UPDATE price_entries SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: pe.id });
  } catch (err) {
    console.error('[Materials] update price error:', err);
    res.status(500).json({ error: 'Failed to update price entry.' });
  }
});

router.delete('/price-entries/:id', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM price_entries WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Price entry not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Materials] delete price error:', err);
    res.status(500).json({ error: 'Failed to delete price entry.' });
  }
});

// ─── CSV bulk import ────────────────────────────────────────────────────────
// Body: { rows: [ { canonical_name, category, default_unit, search_aliases,
//                    supplier_name, price, unit, source_url, in_stock, notes } ] }
// The frontend handles column-mapping; we validate + upsert here. Materials are
// matched on canonical_name (case-insensitive); suppliers resolved/created.
router.post('/import-csv', (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: 'No rows to import.' });
    if (rows.length > 5000) return res.status(400).json({ error: 'Too many rows (max 5000 per import).' });

    const result = { materials_created: 0, prices_added: 0, errors: [] };
    const findMat = db.prepare('SELECT * FROM materials WHERE LOWER(canonical_name) = LOWER(?)');
    const insMat = db.prepare(
      'INSERT INTO materials (id, canonical_name, category, default_unit, search_aliases, spec_notes, image_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insPrice = db.prepare(
      'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_via, in_stock, stale, notes, image_url, created_by) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
    );

    const txn = db.transaction(() => {
      rows.forEach((r, i) => {
        const name = String(r.canonical_name || '').trim();
        const priceNum = parseFloat(r.price);
        if (!name) { result.errors.push({ row: i + 1, error: 'Missing material name' }); return; }
        if (!Number.isFinite(priceNum)) { result.errors.push({ row: i + 1, error: 'Invalid price' }); return; }
        const supName = String(r.supplier_name || '').trim();
        if (!supName) { result.errors.push({ row: i + 1, error: 'Missing supplier' }); return; }

        let mat = findMat.get(name);
        if (!mat) {
          const mid = uuidv4();
          insMat.run(mid, name, r.category || null, r.default_unit || r.unit || null,
            r.search_aliases || null, r.spec_notes || null, r.image_url || null, req.user.id);
          mat = { id: mid, default_unit: r.default_unit || r.unit || null };
          result.materials_created++;
        }
        const sup = resolveSupplier(supName, {
          region: r.region, account_type: r.account_type, website: r.website,
        }, req.user.id);
        const inStock = (r.in_stock === false || r.in_stock === 0 || /^(no|false|0|out)/i.test(String(r.in_stock || '').trim())) ? 0 : 1;
        insPrice.run(uuidv4(), mat.id, sup.id, priceNum, r.unit || mat.default_unit || null,
          r.source_url || null, 'csv', inStock, r.notes || null, r.image_url || null, req.user.id);
        result.prices_added++;
      });
    });
    txn();
    res.json(result);
  } catch (err) {
    console.error('[Materials] csv import error:', err);
    res.status(500).json({ error: 'CSV import failed.' });
  }
});

// ─── Scrape a public product URL ───────────────────────────────────────────────
// Body: { url, material_id }. Resolves the supplier from the URL's adapter,
// scrapes price + stock, writes an auditable price_entry (captured_via=scrape).
router.post('/scrape', async (req, res) => {
  try {
    const b = req.body || {};
    const url = String(b.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'A valid http(s) URL is required.' });
    const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(b.material_id);
    if (!material) return res.status(400).json({ error: 'Unknown material.' });

    const adapter = adapterFor(url);
    if (!adapter) {
      return res.status(422).json({
        error: 'That site has no public-price scraper. Use manual entry or CSV import instead.',
        code: 'UNSUPPORTED_SUPPLIER',
      });
    }

    let scraped;
    try {
      scraped = await scrapeUrl(url);
    } catch (e) {
      return res.status(502).json({ error: e.message || 'Scrape failed.', code: e.code || 'SCRAPE_FAILED' });
    }

    const sup = resolveSupplier(scraped.supplier, { account_type: 'retail', website: 'https://www.' + adapter.hosts[0] }, req.user.id);
    const id = uuidv4();
    db.prepare(
      'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_via, in_stock, stale, notes, image_url, created_by) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
    ).run(
      id, material.id, sup.id, scraped.price, material.default_unit || null,
      scraped.source_url, 'scrape',
      scraped.inStock === false ? 0 : 1,
      'Auto-captured from ' + scraped.supplier, scraped.image || null, req.user.id
    );
    // If the material has no catalogue image yet, adopt the first scraped one.
    if (scraped.image && !material.image_url) {
      db.prepare('UPDATE materials SET image_url = ? WHERE id = ?').run(scraped.image, material.id);
    }
    res.status(201).json({ id, scraped });
  } catch (err) {
    console.error('[Materials] scrape error:', err);
    res.status(500).json({ error: 'Scrape failed.' });
  }
});

// ─── Bulk scrape from a list of public product URLs ────────────────────────────
// Runs SERVER-SIDE, so on a deployment with open outbound (e.g. Render) this
// captures real prices + working Verify links without any shell access. SSRF is
// bounded: scrapeUrl/adapterFor only ever fetch the recognised public-supplier
// hosts; anything else is skipped.
//
// Body: { items: [ { material, category?, unit?, aliases?, urls:[...] } ] }
// (same shape as server/materials-urls.sample.json)
router.post('/scrape-batch', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'No items to scrape.' });
    if (items.length > 100) return res.status(400).json({ error: 'Too many items (max 100 per batch).' });
    const totalUrls = items.reduce((n, it) => n + (Array.isArray(it.urls) ? it.urls.length : (it.url ? 1 : 0)), 0);
    if (totalUrls > 200) return res.status(400).json({ error: 'Too many URLs (max 200 per batch).' });

    const result = { materials: 0, captured: 0, skipped: 0, failed: 0, details: [] };
    const insPrice = db.prepare(
      'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_via, in_stock, stale, notes, image_url, created_by) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
    );

    for (const it of items) {
      const name = String(it.material || '').trim();
      if (!name) { result.details.push({ error: 'Missing material name' }); continue; }
      let material = db.prepare('SELECT * FROM materials WHERE LOWER(canonical_name) = LOWER(?)').get(name);
      if (!material) {
        const mid = uuidv4();
        db.prepare('INSERT INTO materials (id, canonical_name, category, default_unit, search_aliases, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .run(mid, name, it.category || null, it.unit || null, it.aliases || null, req.user.id);
        material = db.prepare('SELECT * FROM materials WHERE id = ?').get(mid);
      }
      result.materials++;
      const urls = Array.isArray(it.urls) ? it.urls : (it.url ? [it.url] : []);
      for (const url of urls) {
        const adapter = adapterFor(url);
        if (!adapter) { result.skipped++; result.details.push({ material: name, url, status: 'skipped (no public scraper)' }); continue; }
        try {
          const s = await scrapeUrl(url);
          const sup = resolveSupplier(s.supplier, { account_type: 'retail', website: 'https://www.' + adapter.hosts[0] }, req.user.id);
          insPrice.run(uuidv4(), material.id, sup.id, s.price, material.default_unit || null,
            s.source_url, 'scrape', s.inStock === false ? 0 : 1, 'Auto-captured from ' + s.supplier, s.image || null, req.user.id);
          if (s.image && !material.image_url) {
            db.prepare('UPDATE materials SET image_url = ? WHERE id = ?').run(s.image, material.id);
            material.image_url = s.image;
          }
          result.captured++;
          result.details.push({ material: name, supplier: s.supplier, price: s.price, status: 'ok' });
        } catch (e) {
          result.failed++;
          result.details.push({ material: name, url, status: 'failed', error: e.message });
        }
      }
    }
    refreshStaleFlags();
    res.json(result);
  } catch (err) {
    console.error('[Materials] scrape-batch error:', err);
    res.status(500).json({ error: 'Bulk scrape failed.' });
  }
});

// ─── Re-run the stale flag on demand ───────────────────────────────────────────
router.post('/refresh-stale', (req, res) => {
  const changes = refreshStaleFlags();
  res.json({ ok: true, stale_days: STALE_DAYS, updated: changes });
});

module.exports = router;

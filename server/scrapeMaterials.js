// ═══════════════════════════════════════════════════════════════════════════════
// MATERIALS PRICING — bulk scrape CLI — server/scrapeMaterials.js
//
// Populates the catalogue with REAL, verifiable supplier prices by scraping a
// list of public product URLs. Each captured row stores the exact source_url
// (so the portal's "Verify" link works) plus the live price, stock and image.
//
// Run this on a host whose network can reach the supplier sites (your own
// server / deployment). It CANNOT run inside an environment whose network
// policy blocks those domains (you'll see HTTP 403 "Host not in allowlist").
//
// USAGE:
//   node server/scrapeMaterials.js [path/to/urls.json]
//   (defaults to server/materials-urls.sample.json)
//
// INPUT FORMAT (JSON array):
//   [
//     {
//       "material": "Portland Cement 25kg",          // canonical name (matched case-insensitively; created if missing)
//       "category": "Cement & Aggregates",            // optional, used only when creating
//       "unit": "bag",                                // optional default unit
//       "aliases": "cement,opc,portland cement",      // optional search aliases
//       "urls": [                                      // one or more PUBLIC product-page URLs
//         "https://www.screwfix.com/p/.../748hn",
//         "https://www.toolstation.com/.../12345"
//       ]
//     }
//   ]
//
// Only the public-price suppliers have scrapers (Screwfix, Toolstation, Wickes,
// B&Q/diy.com, Selco). URLs for other merchants are skipped with a note.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { scrapeUrl, adapterFor } = require('./materialsScrapers');

function findOrCreateMaterial(entry) {
  const name = String(entry.material || '').trim();
  if (!name) return null;
  let row = db.prepare('SELECT * FROM materials WHERE LOWER(canonical_name) = LOWER(?)').get(name);
  if (row) return row;
  const id = uuidv4();
  db.prepare(
    'INSERT INTO materials (id, canonical_name, category, default_unit, search_aliases, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, entry.category || null, entry.unit || null, entry.aliases || null, 'scrape-cli');
  console.log('  + created material "' + name + '"');
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
}

function findOrCreateSupplier(name, adapter) {
  const clean = String(name || '').trim();
  let row = db.prepare('SELECT * FROM suppliers WHERE LOWER(name) = LOWER(?)').get(clean);
  if (row) return row;
  const id = uuidv4();
  db.prepare('INSERT INTO suppliers (id, name, region, account_type, website) VALUES (?, ?, ?, ?, ?)')
    .run(id, clean, 'UK', 'retail', adapter ? 'https://www.' + adapter.hosts[0] : null);
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
}

async function run() {
  const file = process.argv[2] || path.join(__dirname, 'materials-urls.sample.json');
  if (!fs.existsSync(file)) {
    console.error('Input file not found: ' + file);
    process.exit(1);
  }
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Could not parse ' + file + ': ' + e.message);
    process.exit(1);
  }
  if (!Array.isArray(entries)) {
    console.error('Input must be a JSON array.');
    process.exit(1);
  }

  const stats = { materials: 0, captured: 0, skipped: 0, failed: 0 };
  for (const entry of entries) {
    const material = findOrCreateMaterial(entry);
    if (!material) { console.warn('Skipping entry with no "material" name.'); continue; }
    stats.materials++;
    console.log('• ' + material.canonical_name);
    const urls = Array.isArray(entry.urls) ? entry.urls : (entry.url ? [entry.url] : []);
    for (const url of urls) {
      if (!adapterFor(url)) {
        console.log('    - skip (no public scraper): ' + url);
        stats.skipped++;
        continue;
      }
      try {
        const s = await scrapeUrl(url);
        db.prepare(
          'INSERT INTO price_entries (id, material_id, supplier_id, price, unit, source_url, captured_via, in_stock, stale, notes, image_url, created_by) '
          + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
        ).run(
          uuidv4(), material.id, findOrCreateSupplier(s.supplier, adapterFor(url)).id,
          s.price, material.default_unit || null, s.source_url, 'scrape',
          s.inStock === false ? 0 : 1, 'Captured from ' + s.supplier, s.image || null, 'scrape-cli'
        );
        if (s.image && !material.image_url) {
          db.prepare('UPDATE materials SET image_url = ? WHERE id = ?').run(s.image, material.id);
        }
        console.log('    ✓ ' + s.supplier + '  £' + Number(s.price).toFixed(2) + (s.inStock === false ? ' (out of stock)' : ''));
        stats.captured++;
      } catch (e) {
        console.log('    ✗ ' + (e.code || 'FAIL') + ': ' + url + '  — ' + e.message);
        stats.failed++;
      }
    }
  }
  console.log('\nDone. materials=' + stats.materials + ' captured=' + stats.captured + ' skipped=' + stats.skipped + ' failed=' + stats.failed);
  process.exit(0);
}

run();

// ═══════════════════════════════════════════════════════════════════════════════
// MATERIALS PRICING — live scrape → JSON — server/scrapeToJson.js
//
// Designed to run on a host with open internet (GitHub Actions runner). Reads a
// list of real product URLs (server/materials-urls.json), scrapes each for the
// live price + product image + the exact product URL, and writes the results to
// server/materials-live.json. The app imports that file on boot, so committing
// it from CI is what puts REAL data in the catalogue.
//
// Set SCRAPER_API_KEY (ScraperAPI-compatible) so requests route through an
// anti-bot service — the big UK retailers block plain scrapers. See
// materialsScrapers.js for the proxy details.
//
// USAGE:  node server/scrapeToJson.js [path/to/urls.json]
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { scrapeUrl, adapterFor, USING_SCRAPER_API } = require('./materialsScrapers');

async function run() {
  const inFile = process.argv[2] || path.join(__dirname, 'materials-urls.json');
  const outFile = path.join(__dirname, 'materials-live.json');
  if (!fs.existsSync(inFile)) {
    console.error('URL list not found: ' + inFile);
    process.exit(1);
  }
  let items;
  try { items = JSON.parse(fs.readFileSync(inFile, 'utf8')); }
  catch (e) { console.error('Could not parse ' + inFile + ': ' + e.message); process.exit(1); }
  if (!Array.isArray(items)) { console.error('Input must be a JSON array.'); process.exit(1); }

  console.log('Anti-bot scraping API: ' + (USING_SCRAPER_API ? 'ENABLED' : 'DISABLED (direct — retailers will likely block)'));

  // Preserve any prices we already captured for URLs not in this run, so a
  // partial failure doesn't wipe good data.
  const existing = {};
  if (fs.existsSync(outFile)) {
    try { for (const r of JSON.parse(fs.readFileSync(outFile, 'utf8'))) existing[r.source_url] = r; } catch {}
  }

  const results = [];
  let ok = 0, fail = 0, skip = 0;
  for (const it of items) {
    const urls = Array.isArray(it.urls) ? it.urls : (it.url ? [it.url] : []);
    for (const url of urls) {
      if (!adapterFor(url)) { console.log('skip (unsupported): ' + url); skip++; continue; }
      try {
        const s = await scrapeUrl(url);
        results.push({
          material: it.material, category: it.category || null, unit: it.unit || null, aliases: it.aliases || null,
          supplier: s.supplier, price: s.price, currency: s.currency || 'GBP',
          in_stock: s.inStock !== false, image_url: s.image || null,
          source_url: s.source_url, captured_at: s.captured_at,
        });
        console.log('OK   ' + s.supplier.padEnd(14) + '£' + Number(s.price).toFixed(2) + (s.image ? ' [img]' : '') + '  ' + it.material);
        ok++;
      } catch (e) {
        console.log('FAIL ' + (e.code || 'ERR') + '  ' + url + '  — ' + e.message);
        fail++;
        // keep the previous good capture for this URL if we have one
        if (existing[url]) results.push(existing[url]);
      }
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(results, null, 2) + '\n');
  console.log('\nWrote ' + results.length + ' live prices to ' + outFile + '  (ok=' + ok + ' fail=' + fail + ' skip=' + skip + ')');
  // Don't fail the CI job on partial scrape failures — committing what we got is useful.
  process.exit(0);
}

run();

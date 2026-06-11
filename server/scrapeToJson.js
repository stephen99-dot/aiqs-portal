// ═══════════════════════════════════════════════════════════════════════════════
// MATERIALS PRICING — live scrape → JSON — server/scrapeToJson.js
//
// Runs on a host with open internet (the GitHub Actions runner). Three phases:
//
//   1. Re-scrape every hand-curated product URL (server/materials-urls.json).
//   2. Re-scrape every previously DISCOVERED product URL
//      (server/materials-resolved.json — written by phase 3 on earlier runs).
//   3. DISCOVERY: for catalogue materials that have no product URL yet, hit the
//      supplier's public search page, resolve the best-matching product link,
//      scrape it, and cache the resolved URL for future runs. Capped per run
//      (DISCOVER_LIMIT) so the catalogue fills up week by week within a
//      predictable ScraperAPI credit budget.
//
// Output: server/materials-live.json (price + image + exact product URL per
// capture) and the updated resolved cache. The app imports the live file on
// boot — this job is what puts REAL data in the catalogue.
//
// Set SCRAPER_API_KEY (ScraperAPI-compatible) — the big UK retailers block
// plain scrapers. Discovery only returns URLs found on the live search page,
// and every price comes from scraping that product page, so nothing here can
// fabricate data: a bad guess simply fails to scrape and is skipped.
//
// USAGE:  node server/scrapeToJson.js
//   env: DISCOVER_LIMIT (default 120 materials/run)
//        SUPPLIERS_PER_MATERIAL (default 2)
//        DISCOVER_SUPPLIERS (default toolstation,screwfix,wickes,bandq)
//        RETRY_FAILED_AFTER_DAYS (default 21)
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { scrapeUrl, adapterFor, discoverProduct, USING_SCRAPER_API } = require('./materialsScrapers');
const { CATALOGUE } = require('./materialsCatalogue');

const URLS_FILE = path.join(__dirname, 'materials-urls.json');
const RESOLVED_FILE = path.join(__dirname, 'materials-resolved.json');
const OUT_FILE = path.join(__dirname, 'materials-live.json');

const SUPPLIER_NAMES = { screwfix: 'Screwfix', toolstation: 'Toolstation', wickes: 'Wickes', bandq: 'B&Q', selco: 'Selco' };

const DISCOVER_LIMIT = parseInt(process.env.DISCOVER_LIMIT || '120', 10);
const SUPPLIERS_PER_MATERIAL = parseInt(process.env.SUPPLIERS_PER_MATERIAL || '2', 10);
const DISCOVER_SUPPLIERS = (process.env.DISCOVER_SUPPLIERS || 'toolstation,screwfix,wickes,bandq')
  .split(',').map(s => s.trim()).filter(Boolean);
const RETRY_FAILED_AFTER_DAYS = parseInt(process.env.RETRY_FAILED_AFTER_DAYS || '21', 10);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Catalogue rows are [name, category, unit, basePrice, aliases] arrays (or
// objects from older shapes) — normalise.
function catalogueRows() {
  return (CATALOGUE || []).map(r => Array.isArray(r)
    ? { material: r[0], category: r[1], unit: r[2], aliases: r[4] || null }
    : { material: r.canonical_name || r.name || r.material, category: r.category, unit: r.unit || r.default_unit, aliases: r.aliases || r.search_aliases || null }
  ).filter(r => r.material);
}

async function run() {
  console.log('Anti-bot scraping API: ' + (USING_SCRAPER_API ? 'ENABLED' : 'DISABLED (direct — big retailers will likely block)'));
  console.log('Discovery: up to ' + DISCOVER_LIMIT + ' materials × ' + SUPPLIERS_PER_MATERIAL + ' suppliers (' + DISCOVER_SUPPLIERS.join(', ') + ')');

  const handItems = readJson(URLS_FILE, []);
  // resolved: [{ material, category, unit, aliases, supplier_id, url, score, resolved_at }]
  // failures: { "<supplier_id>|<material>": iso-date } — don't burn credits re-searching too soon.
  const resolvedState = readJson(RESOLVED_FILE, { resolved: [], failures: {} });
  const resolved = Array.isArray(resolvedState.resolved) ? resolvedState.resolved : [];
  const failures = resolvedState.failures || {};

  // Keep previous good captures so a partial failure never wipes data.
  const existing = {};
  for (const r of readJson(OUT_FILE, [])) existing[r.source_url] = r;

  const results = [];
  const seenUrls = new Set();
  let ok = 0, fail = 0, discovered = 0;

  async function scrapeInto(url, meta) {
    if (seenUrls.has(url)) return true;
    seenUrls.add(url);
    try {
      const s = await scrapeUrl(url);
      results.push({
        material: meta.material, category: meta.category || null, unit: meta.unit || null, aliases: meta.aliases || null,
        supplier: s.supplier, price: s.price, currency: s.currency || 'GBP',
        in_stock: s.inStock !== false, image_url: s.image || null,
        source_url: s.source_url, captured_at: s.captured_at,
      });
      console.log('OK   ' + s.supplier.padEnd(12) + '£' + Number(s.price).toFixed(2) + (s.image ? ' [img]' : '') + '  ' + meta.material);
      ok++;
      return true;
    } catch (e) {
      console.log('FAIL ' + (e.code || 'ERR') + '  ' + url + '  — ' + e.message);
      fail++;
      if (existing[url]) results.push(existing[url]); // keep the last good capture
      return false;
    }
  }

  // ── Phase 1: hand-curated URLs ──
  for (const it of handItems) {
    const urls = Array.isArray(it.urls) ? it.urls : (it.url ? [it.url] : []);
    for (const url of urls) {
      if (!adapterFor(url)) { console.log('skip (unsupported): ' + url); continue; }
      await scrapeInto(url, it);
    }
  }

  // ── Phase 2: previously discovered URLs ──
  for (const r of resolved) {
    if (!adapterFor(r.url)) continue;
    await scrapeInto(r.url, r);
  }

  // ── Phase 3: discovery for unresolved catalogue materials ──
  const covered = new Set();
  for (const r of results) covered.add(r.material.toLowerCase() + '|' + (r.supplier || '').toLowerCase());
  const resolvedKeys = new Set(resolved.map(r => (r.supplier_id || '') + '|' + r.material.toLowerCase()));
  const now = Date.now();

  let attempted = 0;
  for (const row of catalogueRows()) {
    if (attempted >= DISCOVER_LIMIT) break;
    // How many suppliers already carry this material live?
    const have = DISCOVER_SUPPLIERS.filter(sid =>
      covered.has(row.material.toLowerCase() + '|' + (SUPPLIER_NAMES[sid] || '').toLowerCase())).length;
    if (have >= SUPPLIERS_PER_MATERIAL) continue;

    let gained = have;
    let tried = false;
    for (const sid of DISCOVER_SUPPLIERS) {
      if (gained >= SUPPLIERS_PER_MATERIAL) break;
      const key = sid + '|' + row.material.toLowerCase();
      if (resolvedKeys.has(key)) continue; // already have a cached URL (phase 2 handled it)
      const failedAt = failures[key] ? Date.parse(failures[key]) : 0;
      if (failedAt && now - failedAt < RETRY_FAILED_AFTER_DAYS * 86400000) continue;
      tried = true;
      try {
        const found = await discoverProduct(sid, row.material);
        if (!found) {
          failures[key] = new Date().toISOString();
          console.log('MISS ' + sid.padEnd(12) + 'no confident match  ' + row.material);
          continue;
        }
        const scrapedOk = await scrapeInto(found.url, row);
        if (scrapedOk) {
          resolved.push({ ...row, supplier_id: sid, url: found.url, score: Math.round(found.score * 100) / 100, resolved_at: new Date().toISOString() });
          resolvedKeys.add(key);
          delete failures[key];
          discovered++;
          gained++;
        } else {
          failures[key] = new Date().toISOString();
        }
      } catch (e) {
        failures[key] = new Date().toISOString();
        console.log('MISS ' + sid.padEnd(12) + (e.code || 'ERR') + '  ' + row.material + ' — ' + e.message);
      }
    }
    if (tried) attempted++;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(RESOLVED_FILE, JSON.stringify({ resolved, failures }, null, 2) + '\n');
  console.log('\nWrote ' + results.length + ' live prices (ok=' + ok + ' fail=' + fail + ' newly-discovered=' + discovered + ')');
  console.log('Resolved cache: ' + resolved.length + ' product URLs, ' + Object.keys(failures).length + ' recent misses.');
  // Don't fail CI on partial scrape failures — committing what we got is useful.
  process.exit(0);
}

run();

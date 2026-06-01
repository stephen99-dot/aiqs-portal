// ═══════════════════════════════════════════════════════════════════════════════
// MATERIALS PRICING — PUBLIC-PRICE SCRAPERS — server/materialsScrapers.js
//
// IMPORTANT — legal / feasibility note (keep this in sync with the feasibility
// list surfaced in the UI):
//
//   • NONE of these merchants publish an official pricing API. Capture here is
//     best-effort HTML/JSON-LD scraping that can break when a site changes.
//   • We ONLY automate suppliers whose prices are PUBLIC (no login):
//       Screwfix, Toolstation, Wickes, B&Q (diy.com), Selco public site.
//   • Trade-account merchants (Travis Perkins, Jewson, MKM, Buildbase, Howdens)
//     gate prices behind a login and are NOT scraped — they use manual / CSV.
//   • We honour robots.txt and rate-limit per host. Every captured figure is
//     written back with source_url + captured_at so it stays auditable.
//
// Each adapter exposes:
//   { id, name, hosts:[...], parse(html, url) -> { price, currency, inStock } | null }
// scrapeUrl(url) picks the adapter by hostname, checks robots.txt, throttles,
// fetches, and parses. It throws on failure so the caller can record the reason.
// ═══════════════════════════════════════════════════════════════════════════════

const USER_AGENT =
  'AIQS-MaterialsBot/1.0 (+https://theaiqs.co.uk; respects robots.txt; contact: support@theaiqs.co.uk)';

const MIN_HOST_INTERVAL_MS = 2500; // polite gap between hits to the same host
const FETCH_TIMEOUT_MS = 12000;

// host -> last request timestamp (ms)
const lastHit = new Map();
// host -> { disallow: [paths], fetchedAt } parsed robots.txt cache
const robotsCache = new Map();
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// Optional anti-bot scraping API. Major UK retailers sit behind Cloudflare /
// Akamai, which 403 plain scrapers. Set SCRAPER_API_KEY (ScraperAPI-compatible)
// to route requests through a service that solves the challenge. Without a key,
// requests go direct (and will likely be blocked by those retailers).
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const SCRAPER_API_BASE = process.env.SCRAPER_API_BASE || 'http://api.scraperapi.com/';
const SCRAPER_RENDER = String(process.env.SCRAPER_RENDER || '') === 'true';
const USING_SCRAPER_API = !!SCRAPER_API_KEY;

function proxied(url) {
  if (!SCRAPER_API_KEY) return url;
  const params = new URLSearchParams({ api_key: SCRAPER_API_KEY, url, country_code: 'uk' });
  if (SCRAPER_RENDER) params.set('render', 'true');
  return SCRAPER_API_BASE + '?' + params.toString();
}

async function fetchText(url, { timeout = FETCH_TIMEOUT_MS, raw = false } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch unavailable — Node 18+ required for scraping.');
  }
  // The scraping API can be slow (it renders/retries) — give it more headroom.
  const effTimeout = (!raw && USING_SCRAPER_API) ? Math.max(timeout, 70000) : timeout;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), effTimeout);
  try {
    const res = await fetch(raw ? url : proxied(url), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status + ' from ' + url);
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Minimal robots.txt check: respects the wildcard (User-agent: *) Disallow rules.
async function isAllowedByRobots(url) {
  const host = hostOf(url);
  if (!host) return false;
  let entry = robotsCache.get(host);
  if (!entry || Date.now() - entry.fetchedAt > ROBOTS_TTL_MS) {
    const disallow = [];
    try {
      const origin = new URL(url).origin;
      const txt = await fetchText(origin + '/robots.txt', { timeout: 6000, raw: true });
      let appliesToUs = false;
      for (const raw of txt.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line) continue;
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const field = m[1].toLowerCase();
        const val = m[2].trim();
        if (field === 'user-agent') {
          appliesToUs = val === '*';
        } else if (field === 'disallow' && appliesToUs && val) {
          disallow.push(val);
        }
      }
    } catch {
      // No robots.txt (or unreachable) — treat as allowed but cache the result.
    }
    entry = { disallow, fetchedAt: Date.now() };
    robotsCache.set(host, entry);
  }
  const pathname = new URL(url).pathname;
  return !entry.disallow.some(rule => rule !== '/' ? pathname.startsWith(rule) : true);
}

async function throttle(host) {
  const last = lastHit.get(host) || 0;
  const wait = MIN_HOST_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

// ─── Generic parsers ──────────────────────────────────────────────────────────

// Pull every <script type="application/ld+json"> block and walk it for a
// Product/Offer price. This is the most stable signal across these retailers.
function parseJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { blocks.push(JSON.parse(m[1].trim())); } catch { /* skip malformed */ }
  }
  const found = { price: null, currency: 'GBP', inStock: null, image: null };
  const pickImage = (img) => {
    if (!img) return null;
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) return pickImage(img[0]);
    if (typeof img === 'object') return img.url || img.contentUrl || null;
    return null;
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node.image && !found.image) found.image = pickImage(node.image);
    const offers = node.offers;
    const offerArr = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const o of offerArr) {
      if (!o || typeof o !== 'object') continue;
      const p = parseFloat(o.price ?? o.lowPrice ?? o.highPrice);
      if (Number.isFinite(p) && found.price == null) found.price = p;
      if (o.priceCurrency) found.currency = o.priceCurrency;
      if (typeof o.availability === 'string') {
        found.inStock = /InStock|LimitedAvailability/i.test(o.availability);
      }
    }
    for (const k of Object.keys(node)) {
      if (k !== 'offers') visit(node[k]);
    }
  };
  blocks.forEach(visit);
  return found.price != null ? found : null;
}

// Fallback: meta tags some of these sites emit (og:price / product:price:amount).
function parseMetaPrice(html) {
  const grab = (re) => { const m = html.match(re); return m ? parseFloat(m[1]) : null; };
  const price =
    grab(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([\d.]+)["']/i) ||
    grab(/<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([\d.]+)["']/i) ||
    grab(/itemprop=["']price["'][^>]+content=["']([\d.]+)["']/i);
  if (!Number.isFinite(price)) return null;
  const imgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return { price, currency: 'GBP', inStock: null, image: imgMatch ? imgMatch[1] : null };
}

function genericParse(html) {
  return parseJsonLd(html) || parseMetaPrice(html);
}

// ─── Adapters (public-price suppliers only) ─────────────────────────────────────

const ADAPTERS = [
  { id: 'screwfix',   name: 'Screwfix',   hosts: ['screwfix.com'],   parse: genericParse },
  { id: 'toolstation', name: 'Toolstation', hosts: ['toolstation.com'], parse: genericParse },
  { id: 'wickes',     name: 'Wickes',     hosts: ['wickes.co.uk'],   parse: genericParse },
  { id: 'bandq',      name: 'B&Q',        hosts: ['diy.com'],        parse: genericParse },
  { id: 'selco',      name: 'Selco',      hosts: ['selcobw.com'],    parse: genericParse },
];

function adapterFor(url) {
  const host = hostOf(url);
  if (!host) return null;
  return ADAPTERS.find(a => a.hosts.some(h => host === h || host.endsWith('.' + h))) || null;
}

// Public list for the feasibility UI.
const SUPPORTED_SUPPLIERS = ADAPTERS.map(a => ({ id: a.id, name: a.name, hosts: a.hosts }));

// Scrape a single public product URL. Resolves to
// { price, currency, inStock, supplier, source_url, captured_at } or throws.
async function scrapeUrl(url) {
  const adapter = adapterFor(url);
  if (!adapter) {
    const err = new Error('No public-price scraper for that site. Supported: ' +
      ADAPTERS.map(a => a.name).join(', ') + '. Use manual / CSV for everything else.');
    err.code = 'UNSUPPORTED_SUPPLIER';
    throw err;
  }
  // When routing through the scraping API, the API is our access mechanism;
  // a direct robots.txt fetch would hit the same bot wall, so skip it.
  const allowed = USING_SCRAPER_API ? true : await isAllowedByRobots(url);
  if (!allowed) {
    const err = new Error('Blocked by ' + adapter.name + " robots.txt — not scraping.");
    err.code = 'ROBOTS_DISALLOWED';
    throw err;
  }
  if (!USING_SCRAPER_API) await throttle(hostOf(url));
  const html = await fetchText(url);
  const parsed = adapter.parse(html, url);
  if (!parsed || parsed.price == null) {
    const err = new Error('Could not extract a price from the page (markup may have changed).');
    err.code = 'PRICE_NOT_FOUND';
    throw err;
  }
  return {
    price: parsed.price,
    currency: parsed.currency || 'GBP',
    inStock: parsed.inStock,
    image: parsed.image || null,
    supplier: adapter.name,
    supplierId: adapter.id,
    source_url: url,
    captured_at: new Date().toISOString(),
  };
}

module.exports = { scrapeUrl, adapterFor, SUPPORTED_SUPPLIERS, ADAPTERS, USING_SCRAPER_API };

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

// ─── Search-page discovery ────────────────────────────────────────────────────
// Given a material name, hit the supplier's PUBLIC search page once and pick
// the best-matching product link off it. Only URLs actually present in the
// live search HTML are ever returned — nothing is fabricated — and the caller
// then scrapes that product page, which validates price + image or fails.

const SEARCH_ADAPTERS = {
  screwfix: {
    search: (q) => 'https://www.screwfix.com/search?search=' + encodeURIComponent(q),
    productRe: /href=["']((?:https?:\/\/www\.screwfix\.com)?\/p\/[a-z0-9-]+\/[a-z0-9]+)["']/gi,
    origin: 'https://www.screwfix.com',
  },
  toolstation: {
    search: (q) => 'https://www.toolstation.com/search?q=' + encodeURIComponent(q),
    productRe: /href=["']((?:https?:\/\/www\.toolstation\.com)?\/[a-z0-9-]+\/p\d{4,})["']/gi,
    origin: 'https://www.toolstation.com',
  },
  wickes: {
    search: (q) => 'https://www.wickes.co.uk/search?text=' + encodeURIComponent(q),
    productRe: /href=["']((?:https?:\/\/www\.wickes\.co\.uk)?\/[A-Za-z0-9-+%]+\/p\/\d{5,})["']/gi,
    origin: 'https://www.wickes.co.uk',
  },
  bandq: {
    search: (q) => 'https://www.diy.com/search?term=' + encodeURIComponent(q),
    productRe: /href=["']((?:https?:\/\/www\.diy\.com)?\/departments\/[a-z0-9-]+\/[0-9_]+_BQ\.prd)["']/gi,
    origin: 'https://www.diy.com',
  },
  selco: {
    search: (q) => 'https://www.selcobw.com/search?q=' + encodeURIComponent(q),
    productRe: /href=["']((?:https?:\/\/www\.selcobw\.com)?\/[a-z0-9-]+-[a-z0-9-]+-\d+)["']/gi,
    origin: 'https://www.selcobw.com',
  },
};

// Same token collapsing the catalogue search uses: "4 by 2" == "4x2" == "4X2".
function normToken(s) {
  return String(s || '').toLowerCase().replace(/\bby\b/g, 'x').replace(/[^a-z0-9.]+/g, '');
}
function queryTokens(q) {
  // Fold "4 by 2" -> "4x2" BEFORE splitting, or the words land in separate
  // tokens and the dimension is lost.
  return String(q || '')
    .toLowerCase()
    .replace(/(\d)\s*by\s*(\d)/g, '$1x$2')
    .split(/[\s,/()]+/)
    .map(normToken)
    .filter(tok => tok.length >= 2);
}

// Candidate product links from a search results page: JSON-LD ItemList first
// (the stable signal), then the adapter's product-URL pattern over anchors.
function parseSearchLinks(html, sa) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (!u) return;
    const abs = u.startsWith('http') ? u : sa.origin + u;
    const clean = abs.split('#')[0];
    if (!seen.has(clean)) { seen.add(clean); out.push(clean); }
  };
  // JSON-LD ItemList entries
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const node = JSON.parse(m[1].trim());
      const arr = Array.isArray(node) ? node : [node];
      for (const n of arr) {
        const items = n && n.itemListElement;
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          push(it?.url || it?.item?.url || (typeof it?.item === 'string' ? it.item : null));
        }
      }
    } catch { /* skip malformed */ }
  }
  // Anchor pattern fallback
  let a;
  sa.productRe.lastIndex = 0;
  while ((a = sa.productRe.exec(html))) push(a[1]);
  return out.slice(0, 10);
}

// Score a product URL's slug against the query tokens. The slug carries the
// product name on all five retailers, so this is a cheap relevance check that
// keeps "Multi-Finish Plaster 25kg" from matching a paintbrush.
function scoreCandidate(url, tokens) {
  const slug = normToken(decodeURIComponent(url.replace(/^https?:\/\/[^/]+/, '')));
  let hits = 0;
  for (const tok of tokens) if (slug.includes(tok)) hits++;
  return tokens.length ? hits / tokens.length : 0;
}

// Find the best product URL for `query` on one supplier. Returns
// { url, score } or null. Throws on fetch-level failures so callers can log.
async function discoverProduct(adapterId, query) {
  const sa = SEARCH_ADAPTERS[adapterId];
  if (!sa) return null;
  const searchUrl = sa.search(query);
  const allowed = USING_SCRAPER_API ? true : await isAllowedByRobots(searchUrl);
  if (!allowed) {
    const err = new Error('Search page disallowed by robots.txt');
    err.code = 'ROBOTS_DISALLOWED';
    throw err;
  }
  if (!USING_SCRAPER_API) await throttle(hostOf(searchUrl));
  const html = await fetchText(searchUrl);
  const links = parseSearchLinks(html, sa);
  if (links.length === 0) return null;
  const tokens = queryTokens(query);
  let best = null;
  for (const url of links) {
    const score = scoreCandidate(url, tokens);
    if (!best || score > best.score) best = { url, score };
  }
  // Demand a real overlap: at least a third of the words, two words minimum
  // (one is enough only for single-word queries). Below that, no match is
  // better than a wrong match.
  const minHits = tokens.length === 1 ? 1 : 2;
  if (!best || best.score < 0.34 || Math.round(best.score * tokens.length) < minHits) return null;
  return best;
}

module.exports = { scrapeUrl, adapterFor, SUPPORTED_SUPPLIERS, ADAPTERS, USING_SCRAPER_API, discoverProduct, SEARCH_ADAPTERS, parseSearchLinks, scoreCandidate, queryTokens };

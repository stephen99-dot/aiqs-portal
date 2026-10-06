// trustpilotReviews.js — the real Trustpilot reviews, on the sign-in page.
//
// The sign-in and register pages used to rotate four invented testimonials.
// The business has a public Trustpilot profile (theaiqs.co.uk), so the
// reviews shown should be those, word for word, with the TrustScore and the
// review count beside them, and they should keep up as new reviews arrive.
//
// How: the server reads the public profile page, lifts the reviews out of
// the JSON the page embeds (Next.js __NEXT_DATA__, with the schema.org JSON-LD
// as a fallback), and keeps them in SQLite. The public endpoint serves from
// the table — never from Trustpilot on the request path — and a sync runs at
// boot, every SYNC_INTERVAL_MS, and from the admin Feedback tab's "Sync now".
// A failed sync records why and leaves the last good set in place.
//
// This reads the public page rather than Trustpilot's paid API or TrustBox
// widget. If the page layout changes the sync reports "no reviews found" in
// the Feedback tab and the sign-in page keeps the last good set, so a change
// on their side can never put a blank or a broken page in front of a user.

const crypto = require('crypto');
const express = require('express');
const { authMiddleware, adminMiddleware } = require('./auth');
const { rateLimit } = require('./publicRateLimit');

const TRUSTPILOT_DOMAIN = process.env.TRUSTPILOT_DOMAIN || 'theaiqs.co.uk';
const REVIEW_URL = process.env.TRUSTPILOT_REVIEW_URL || ('https://uk.trustpilot.com/review/' + TRUSTPILOT_DOMAIN);
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;   // re-read the profile four times a day
const FIRST_SYNC_DELAY_MS = 20 * 1000;          // let the server finish booting first
const FETCH_TIMEOUT_MS = 20 * 1000;
const MAX_PAGES = 5;                            // 20 reviews a page on Trustpilot
// Reviews below this rating are imported (the admin sees them all) but not
// rotated on the sign-in page. The TrustScore and count shown beside them are
// the unfiltered figures from Trustpilot, so the panel never overstates.
const MIN_RATING_SHOWN = 4;

// ── Schema ──────────────────────────────────────────────────────────────────
const ready = new WeakSet();
function ensureSchema(db) {
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS trustpilot_reviews (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      rating INTEGER NOT NULL,
      title TEXT,
      body TEXT,
      published_at TEXT,
      experienced_at TEXT,
      verified INTEGER DEFAULT 0,
      country TEXT,
      language TEXT,
      reply TEXT,
      review_url TEXT,
      hidden INTEGER DEFAULT 0,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS trustpilot_sync (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT,
      trust_score REAL,
      number_of_reviews INTEGER,
      stars INTEGER,
      source_url TEXT,
      status TEXT,
      message TEXT,
      imported INTEGER DEFAULT 0,
      last_attempt_at DATETIME,
      last_success_at DATETIME
    );
  `);
  ready.add(db);
}

// ── Parsing ─────────────────────────────────────────────────────────────────
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const text = (v) => (v == null ? '' : String(v)).trim();
const reviewUrl = (id) => 'https://uk.trustpilot.com/reviews/' + id;

function fallbackId(author, published, body) {
  return crypto.createHash('sha1').update(author + '|' + (published || '') + '|' + body.slice(0, 120)).digest('hex').slice(0, 24);
}

// Next.js pages ship their props in <script id="__NEXT_DATA__">. Trustpilot's
// review pages carry pageProps.reviews[] and pageProps.businessUnit.
function parseNextData(html) {
  const m = String(html || '').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { return null; }
  const pp = data && data.props && data.props.pageProps;
  if (!pp) return null;
  const list = Array.isArray(pp.reviews) ? pp.reviews : [];
  const reviews = list
    .filter((r) => r && typeof r === 'object' && num(r.rating) != null && (text(r.text) || text(r.title)))
    .map((r) => {
      const author = text(r.consumer && r.consumer.displayName) || 'Trustpilot reviewer';
      const body = text(r.text);
      const published = text(r.dates && r.dates.publishedDate) || null;
      const id = text(r.id) || fallbackId(author, published, body);
      return {
        id,
        author,
        rating: Math.round(num(r.rating)),
        title: text(r.title),
        body,
        published_at: published,
        experienced_at: text(r.dates && r.dates.experiencedDate) || null,
        verified: !!(r.labels && r.labels.verification && r.labels.verification.isVerified),
        country: text(r.consumer && r.consumer.countryCode) || null,
        language: text(r.language) || null,
        reply: text(r.reply && r.reply.message) || null,
        review_url: reviewUrl(id),
      };
    });
  const bu = pp.businessUnit || {};
  const business = {
    display_name: text(bu.displayName) || null,
    trust_score: num(bu.trustScore),
    number_of_reviews: num(bu.numberOfReviews),
    stars: num(bu.stars),
  };
  const pagination = pp.filters && pp.filters.pagination;
  const total_pages = pagination && num(pagination.totalPages) != null ? Math.max(1, Math.round(num(pagination.totalPages))) : null;
  return { reviews, business, total_pages, source: 'next_data' };
}

// schema.org JSON-LD: Review nodes with author / reviewRating / reviewBody,
// and the business node carrying aggregateRating. Present on the same page,
// read only when __NEXT_DATA__ is missing or has changed shape.
function parseJsonLd(html) {
  const blocks = [...String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) return null;
  const nodes = [];
  for (const b of blocks) {
    let obj;
    try { obj = JSON.parse(b[1]); } catch (e) { continue; }
    const list = Array.isArray(obj) ? obj : (obj && Array.isArray(obj['@graph']) ? obj['@graph'] : [obj]);
    for (const n of list) if (n && typeof n === 'object') nodes.push(n);
  }
  const isType = (n, t) => (Array.isArray(n['@type']) ? n['@type'].includes(t) : n['@type'] === t);
  const reviews = nodes.filter((n) => isType(n, 'Review')).map((n) => {
    const author = text(n.author && (typeof n.author === 'string' ? n.author : n.author.name)) || 'Trustpilot reviewer';
    const body = text(n.reviewBody);
    const published = text(n.datePublished) || null;
    const urlId = text(n['@id'] || n.url).match(/\/reviews\/([a-z0-9]+)/i);
    const id = urlId ? urlId[1] : fallbackId(author, published, body);
    return {
      id,
      author,
      rating: Math.round(num(n.reviewRating && n.reviewRating.ratingValue) || 0),
      title: text(n.headline || n.name),
      body,
      published_at: published,
      experienced_at: null,
      verified: false,
      country: null,
      language: text(n.inLanguage) || null,
      reply: null,
      review_url: reviewUrl(id),
    };
  }).filter((r) => r.rating > 0 && (r.body || r.title));
  const biz = nodes.find((n) => n.aggregateRating && typeof n.aggregateRating === 'object') || {};
  const ar = biz.aggregateRating || {};
  const business = {
    display_name: text(biz.name) || null,
    trust_score: num(ar.ratingValue),
    number_of_reviews: num(ar.reviewCount != null ? ar.reviewCount : ar.ratingCount),
    stars: null,
  };
  if (!reviews.length && business.trust_score == null) return null;
  return { reviews, business, total_pages: null, source: 'json_ld' };
}

// One page of HTML → { reviews, business, total_pages, source }, or null when
// neither shape is present (a block page, a redirect, a redesign).
function parseTrustpilotHtml(html) {
  const next = parseNextData(html);
  if (next && (next.reviews.length || next.business.trust_score != null)) return next;
  return parseJsonLd(html);
}

// ── Fetching ────────────────────────────────────────────────────────────────
async function fetchHtml(url, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('fetch is not available in this Node runtime');
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await doFetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AIQS-Portal/1.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error('Trustpilot answered HTTP ' + res.status);
    return await res.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const pageUrl = (base, page) => (page <= 1 ? base : base + (base.includes('?') ? '&' : '?') + 'page=' + page);

// Every review on the profile, across its pages (capped), plus the business
// figures from the first page.
async function fetchAllReviews({ url = REVIEW_URL, fetchImpl } = {}) {
  const first = parseTrustpilotHtml(await fetchHtml(pageUrl(url, 1), fetchImpl));
  if (!first) throw new Error('The Trustpilot page did not contain any review data (layout changed, or the request was blocked)');
  const seen = new Map();
  for (const r of first.reviews) seen.set(r.id, r);
  const total = first.business.number_of_reviews;
  let pages = first.total_pages != null ? first.total_pages : (total != null ? Math.ceil(total / 20) : 1);
  pages = Math.min(Math.max(pages, 1), MAX_PAGES);
  let complete = pages <= 1 || first.total_pages == null && total != null && seen.size >= total;
  for (let p = 2; p <= pages && !complete; p++) {
    const page = parseTrustpilotHtml(await fetchHtml(pageUrl(url, p), fetchImpl));
    if (!page || !page.reviews.length) break;
    for (const r of page.reviews) seen.set(r.id, r);
    if (p === pages) complete = true;
  }
  // Complete when every page was read, or the profile has no more reviews
  // than we hold. Only a complete read may retire reviews that vanished.
  if (total != null && seen.size >= total) complete = true;
  if (first.total_pages != null && first.total_pages > MAX_PAGES) complete = false;
  return { reviews: [...seen.values()], business: first.business, complete, source: first.source };
}

// ── Sync ────────────────────────────────────────────────────────────────────
let inFlight = null;

function writeMeta(db, patch) {
  ensureSchema(db);
  const cur = db.prepare('SELECT * FROM trustpilot_sync WHERE id = 1').get() || {};
  const row = { ...cur, ...patch, id: 1 };
  db.prepare(`
    INSERT INTO trustpilot_sync (id, display_name, trust_score, number_of_reviews, stars, source_url, status, message, imported, last_attempt_at, last_success_at)
    VALUES (@id, @display_name, @trust_score, @number_of_reviews, @stars, @source_url, @status, @message, @imported, @last_attempt_at, @last_success_at)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name, trust_score = excluded.trust_score, number_of_reviews = excluded.number_of_reviews,
      stars = excluded.stars, source_url = excluded.source_url, status = excluded.status, message = excluded.message,
      imported = excluded.imported, last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at
  `).run({
    id: 1,
    display_name: row.display_name == null ? null : row.display_name,
    trust_score: row.trust_score == null ? null : row.trust_score,
    number_of_reviews: row.number_of_reviews == null ? null : row.number_of_reviews,
    stars: row.stars == null ? null : row.stars,
    source_url: row.source_url || REVIEW_URL,
    status: row.status || null,
    message: row.message || null,
    imported: row.imported || 0,
    last_attempt_at: row.last_attempt_at || null,
    last_success_at: row.last_success_at || null,
  });
}

/**
 * Read the profile and bring the table up to date. Never throws: a failure
 * is recorded on the sync row (status 'failed', message why) and the reviews
 * already held are left untouched.
 *   opts.db         database (defaults to the app's)
 *   opts.fetchImpl  fetch replacement (tests)
 *   opts.url        profile URL (defaults to REVIEW_URL)
 *   → { ok, imported, retired, business, message, source }
 */
async function syncTrustpilotReviews(opts = {}) {
  const db = opts.db || require('./database');
  ensureSchema(db);
  const now = new Date().toISOString();
  let result;
  try {
    const { reviews, business, complete, source } = await fetchAllReviews({ url: opts.url, fetchImpl: opts.fetchImpl });
    if (!reviews.length && business.trust_score == null) {
      throw new Error('The Trustpilot page was read but no reviews were found on it');
    }
    const upsert = db.prepare(`
      INSERT INTO trustpilot_reviews (id, author, rating, title, body, published_at, experienced_at, verified, country, language, reply, review_url, last_seen_at)
      VALUES (@id, @author, @rating, @title, @body, @published_at, @experienced_at, @verified, @country, @language, @reply, @review_url, @now)
      ON CONFLICT(id) DO UPDATE SET
        author = excluded.author, rating = excluded.rating, title = excluded.title, body = excluded.body,
        published_at = excluded.published_at, experienced_at = excluded.experienced_at, verified = excluded.verified,
        country = excluded.country, language = excluded.language, reply = excluded.reply, review_url = excluded.review_url,
        last_seen_at = excluded.last_seen_at
    `);
    let retired = 0;
    db.transaction(() => {
      for (const r of reviews) upsert.run({ ...r, verified: r.verified ? 1 : 0, now });
      // A review Trustpilot no longer shows (removed, or flagged) must not
      // keep appearing here. Only after a complete read — a partial one
      // would retire reviews that merely sat on a page we did not fetch.
      // Retired by id, not by timestamp: two syncs inside one millisecond
      // would otherwise share a last_seen_at and retire nothing.
      if (complete) {
        const ids = reviews.map((r) => r.id);
        retired = ids.length
          ? db.prepare('DELETE FROM trustpilot_reviews WHERE id NOT IN (' + ids.map(() => '?').join(',') + ')').run(...ids).changes
          : db.prepare('DELETE FROM trustpilot_reviews').run().changes;
      }
    })();
    const message = reviews.length + ' review' + (reviews.length === 1 ? '' : 's') + ' imported'
      + (business.trust_score != null ? ' · TrustScore ' + business.trust_score : '')
      + (business.number_of_reviews != null ? ' from ' + business.number_of_reviews + ' on Trustpilot' : '')
      + (complete ? '' : ' (profile longer than ' + MAX_PAGES + ' pages; older reviews not read)');
    writeMeta(db, {
      display_name: business.display_name, trust_score: business.trust_score, number_of_reviews: business.number_of_reviews, stars: business.stars,
      source_url: opts.url || REVIEW_URL, status: 'ok', message, imported: reviews.length, last_attempt_at: now, last_success_at: now,
    });
    result = { ok: true, imported: reviews.length, retired, business, message, source };
  } catch (err) {
    const message = (err && err.message) || String(err);
    writeMeta(db, { status: 'failed', message, last_attempt_at: now, source_url: opts.url || REVIEW_URL });
    console.error('[Trustpilot] sync failed:', message);
    result = { ok: false, imported: 0, retired: 0, business: null, message, source: null };
  }
  return result;
}

// One sync at a time; a second caller shares the running one.
function syncOnce(opts) {
  if (!inFlight) {
    inFlight = syncTrustpilotReviews(opts).finally(() => { inFlight = null; });
  }
  return inFlight;
}

// ── Reading ─────────────────────────────────────────────────────────────────
function readMeta(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM trustpilot_sync WHERE id = 1').get() || null;
}

/**
 * What the sign-in page shows: visible reviews at or above MIN_RATING_SHOWN,
 * newest first, with the business figures as Trustpilot states them.
 */
function getTrustpilotReviews({ db, minRating = MIN_RATING_SHOWN, limit = 20 } = {}) {
  const database = db || require('./database');
  ensureSchema(database);
  const meta = readMeta(database);
  const rows = database.prepare(
    'SELECT id, author, rating, title, body, published_at, verified, review_url FROM trustpilot_reviews '
    + 'WHERE hidden = 0 AND rating >= ? ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?'
  ).all(minRating, limit);
  return {
    business: meta && meta.last_success_at ? {
      display_name: meta.display_name,
      trust_score: meta.trust_score,
      number_of_reviews: meta.number_of_reviews,
      stars: meta.stars,
      url: meta.source_url || REVIEW_URL,
    } : { display_name: null, trust_score: null, number_of_reviews: null, stars: null, url: REVIEW_URL },
    reviews: rows.map((r) => ({ ...r, verified: !!r.verified })),
    synced_at: meta ? meta.last_success_at : null,
  };
}

// Kick off a background sync when the last good one is stale. Called on the
// public read path; never awaited there.
function ensureFresh(db) {
  try {
    const meta = readMeta(db);
    const last = meta && meta.last_success_at ? new Date(meta.last_success_at).getTime() : 0;
    const attempted = meta && meta.last_attempt_at ? new Date(meta.last_attempt_at).getTime() : 0;
    // Back off a failing profile: at most one attempt per interval even when
    // nothing has ever succeeded.
    if (Date.now() - last > SYNC_INTERVAL_MS && Date.now() - attempted > SYNC_INTERVAL_MS) syncOnce({ db }).catch(() => {});
  } catch (e) { /* the read path must never fail on this */ }
}

// Boot-time scheduling: a first read shortly after start, then every interval.
function start() {
  if (process.env.TRUSTPILOT_SYNC === 'off') return;
  const db = require('./database');
  const first = setTimeout(() => syncOnce({ db }).catch(() => {}), FIRST_SYNC_DELAY_MS);
  const every = setInterval(() => syncOnce({ db }).catch(() => {}), SYNC_INTERVAL_MS);
  if (first.unref) first.unref();
  if (every.unref) every.unref();
}

// ── Routes ──────────────────────────────────────────────────────────────────
const router = express.Router();

// GET /api/public/trustpilot — unauthenticated; the sign-in page reads it.
router.get('/public/trustpilot', rateLimit({ windowMs: 60_000, max: 120 }), (req, res) => {
  try {
    const db = require('./database');
    const out = getTrustpilotReviews({ db });
    ensureFresh(db);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/trustpilot — everything imported plus the sync state.
router.get('/admin/trustpilot', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = require('./database');
    ensureSchema(db);
    const reviews = db.prepare('SELECT * FROM trustpilot_reviews ORDER BY COALESCE(published_at, first_seen_at) DESC').all()
      .map((r) => ({ ...r, verified: !!r.verified, hidden: !!r.hidden }));
    res.json({ meta: readMeta(db), reviews, min_rating_shown: MIN_RATING_SHOWN, source_url: REVIEW_URL, syncing: !!inFlight });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/trustpilot/sync — read the profile now and report.
router.post('/admin/trustpilot/sync', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const db = require('./database');
    const result = await syncOnce({ db });
    res.json({ ...result, meta: readMeta(db) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = {
  router, start,
  syncTrustpilotReviews, getTrustpilotReviews, parseTrustpilotHtml, fetchAllReviews, ensureSchema, readMeta,
  REVIEW_URL, MIN_RATING_SHOWN, SYNC_INTERVAL_MS,
};

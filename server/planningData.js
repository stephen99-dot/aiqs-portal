// ═══════════════════════════════════════════════════════════════════════════════
// PLANNING LEADS — data layer — server/planningData.js
//
// Scans local council planning applications and turns recently-granted domestic
// jobs into leads a builder can write to. Two free, keyless data sources:
//
//   • postcodes.io      — postcode -> lat/lng (so we can search a radius)
//   • PlanIt (planit.org.uk/api) — aggregates ~400+ UK councils' planning
//                          registers into one normalised JSON feed.
//
// Rather than scrape each council's Idox/Northgate/Arcus site (brittle, blocked,
// rate-limited, every layout different), we hit PlanIt once for national cover
// and fall back to a small sample set if the network is unavailable so the UI is
// never dead. All state/keyword filtering happens locally for predictability.
//
// NOTE: PlanIt exposes the site ADDRESS, description, dates, council and status
// reliably, but usually NOT the applicant's personal name (that varies council
// to council). That's fine and expected for this kind of prospecting: the letter
// is addressed to the property ("To the homeowner, 14 Elm Road"), which the
// builder can personalise before sending.
// ═══════════════════════════════════════════════════════════════════════════════

const PLANIT_BASE = 'https://www.planit.org.uk/api/applics/json';
const POSTCODES_BASE = 'https://api.postcodes.io/postcodes/';

// Free planning/geo APIs throttle anonymous, unidentified clients hard — some
// down to almost nothing. Identifying the app with a descriptive User-Agent and
// a contact email is standard etiquette and typically lifts the limit. Override
// the contact via PLANIT_CONTACT_EMAIL if you like.
const CONTACT_EMAIL = process.env.PLANIT_CONTACT_EMAIL || 'hello@crmwizardai.com';
const USER_AGENT = 'AIQS-Portal-PlanningLeads/1.0 (+mailto:' + CONTACT_EMAIL + ')';

// Timeout wrapper — never let a slow upstream hang the request. On a non-2xx it
// throws an Error carrying .status, and for rate limits (.status 429) it also
// parses how many seconds to wait (from the Retry-After header or the body's
// "try again in NNNs" message) onto .retryAfter.
async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
    if (!r.ok) {
      const e = new Error('Upstream ' + r.status);
      e.status = r.status;
      if (r.status === 429) {
        let secs = parseInt(r.headers.get('retry-after') || '', 10);
        try { const body = await r.text(); const m = body.match(/(\d+)\s*s/); if (!secs && m) secs = parseInt(m[1], 10); } catch (_) {}
        e.retryAfter = Number.isFinite(secs) ? secs : 60;
      }
      throw e;
    }
    return await r.json();
  } finally { clearTimeout(timer); }
}

// ─── Lead categories ─────────────────────────────────────────────────────────
// Each category matches on the application description (which is where the real
// signal lives — PlanIt's app_type is too coarse to separate an extension from
// a shopfront). Builders pick which categories they care about.
const CATEGORIES = {
  extensions_lofts: {
    label: 'Extensions, lofts & conversions',
    re: /\b(extension|extensions|loft|dormer|garage conversion|convert(ing|ed)? .*garage|outbuilding|garden room|annexe?|orangery|conservatory|porch|single[- ]storey|two[- ]storey|double[- ]storey|rear|side return|wrap[- ]around)\b/i,
  },
  new_dwellings: {
    label: 'New dwellings',
    re: /\b(new dwelling|dwellinghouse|erection of \d*\s*(dwelling|house|home|bungalow)|new build|new house|construction of \d*\s*(dwelling|house)|residential development|self[- ]build)\b/i,
  },
  renovation: {
    label: 'Renovations & alterations',
    re: /\b(alteration|refurbish|renovat|internal remodel|reconfigur|change of use|basement|underpinning|re[- ]?roof)\b/i,
  },
};

// PlanIt "app_state" values we treat as "granted / ready to build".
const GRANTED_STATES = new Set(['permitted', 'conditions', 'referred']);

// Pull a field from a record trying several likely key names — PlanIt has
// shifted field names over time and per-source, so we stay defensive.
function pick(rec, keys, fb = '') {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') return rec[k];
  }
  return fb;
}

// Normalise one raw PlanIt record into our lead shape.
function normalise(rec) {
  return {
    ref: String(pick(rec, ['name', 'uid', 'reference', 'lpa_app_no'])).slice(0, 80),
    council: String(pick(rec, ['area_name', 'authority', 'area'])).slice(0, 120),
    description: String(pick(rec, ['description', 'proposal', 'summary'])).slice(0, 600),
    address: String(pick(rec, ['address', 'site_address', 'location'])).slice(0, 300),
    postcode: String(pick(rec, ['postcode', 'pcode'])).slice(0, 12),
    state: String(pick(rec, ['app_state', 'status', 'state'])).slice(0, 40),
    type: String(pick(rec, ['app_type', 'type'])).slice(0, 60),
    size: String(pick(rec, ['app_size', 'size'])).slice(0, 40),
    submitted_date: String(pick(rec, ['start_date', 'date_received', 'received_date'])).slice(0, 10),
    decided_date: String(pick(rec, ['decided_date', 'decision_date', 'decision_issued_date'])).slice(0, 10),
    url: String(pick(rec, ['url', 'link', 'source_url', 'lpa_app_url'])).slice(0, 500),
    lat: Number(pick(rec, ['lat', 'latitude'], 0)) || latOf(rec) || null,
    lng: Number(pick(rec, ['lng', 'lon', 'longitude'], 0)) || lngOf(rec) || null,
  };
}

// PlanIt sometimes carries the point as location "lat,lng" or a GeoJSON-ish
// { coordinates: [lng, lat] }. Pull them out defensively.
function latOf(rec) {
  const loc = rec.location;
  if (typeof loc === 'string' && loc.includes(',')) return Number(loc.split(',')[0]) || 0;
  if (loc && Array.isArray(loc.coordinates)) return Number(loc.coordinates[1]) || 0;
  return 0;
}
function lngOf(rec) {
  const loc = rec.location;
  if (typeof loc === 'string' && loc.includes(',')) return Number(loc.split(',')[1]) || 0;
  if (loc && Array.isArray(loc.coordinates)) return Number(loc.coordinates[0]) || 0;
  return 0;
}

// Postcode -> { lat, lng, area } via postcodes.io. Accepts full or partial.
async function geocodePostcode(postcode) {
  const pc = String(postcode || '').trim();
  if (!pc) throw Object.assign(new Error('Enter a postcode to scan around.'), { code: 'NO_POSTCODE' });
  // Distinguish a genuinely wrong postcode from an unreachable geocoder so the
  // caller can show the right message (and offer the sample fallback when it's a
  // connectivity problem). postcodes.io returns HTTP 404 for an invalid
  // postcode; anything else (403 egress block, 5xx, network/timeout) means the
  // service didn't answer, not that the postcode is bad.
  let saw404 = false;
  const attempt = async (url) => {
    try {
      const j = await fetchJson(url);
      return (j && j.result) || null;
    } catch (e) {
      if (e && e.status === 404) saw404 = true;
      return null;
    }
  };

  let r = await attempt(POSTCODES_BASE + encodeURIComponent(pc));
  if (r && r.latitude != null) {
    return { lat: r.latitude, lng: r.longitude, area: r.admin_district || r.parliamentary_constituency || '' };
  }
  // Fall back to the outward-code centroid endpoint for partial postcodes.
  const outward = pc.split(/\s+/)[0];
  r = await attempt('https://api.postcodes.io/outcodes/' + encodeURIComponent(outward));
  if (r && r.latitude != null) {
    return { lat: r.latitude, lng: r.longitude, area: (r.admin_district && r.admin_district[0]) || '' };
  }

  if (saw404) {
    throw Object.assign(new Error('Could not find that postcode. Check it and try again.'), { code: 'BAD_POSTCODE' });
  }
  throw Object.assign(
    new Error('The postcode lookup service is unreachable right now. Try again shortly, or use the sample data to preview the tool.'),
    { code: 'UPSTREAM_UNREACHABLE' });
}

const PLANIT_SELECT = 'name,uid,area_name,description,address,postcode,app_state,app_type,app_size,start_date,decided_date,url,location,lat,lng';

// Optional PlanIt API key. PlanIt rate-limits anonymous use hard; registered
// users get much higher limits. Set PLANIT_API_KEY (and PLANIT_AUTH_PARAM if
// PlanIt names the query param something other than "auth") to raise the ceiling.
const PLANIT_API_KEY = process.env.PLANIT_API_KEY || '';
const PLANIT_AUTH_PARAM = process.env.PLANIT_AUTH_PARAM || 'auth';
function withKey(qs) {
  return PLANIT_API_KEY ? qs + '&' + PLANIT_AUTH_PARAM + '=' + encodeURIComponent(PLANIT_API_KEY) : qs;
}

// ─── Background collect: persistent store + throttled work queue ─────────────
// PlanIt's free tier can't sustain live, on-demand scanning — a single request
// can 429 with a multi-minute ban. So the tool NEVER calls PlanIt during a user
// scan. Instead each requested area is remembered in a SQLite table, and a slow
// background worker fills/refreshes it one area at a time, far under the limit.
// Scans read straight from the table, so they're instant and never rate-limited.
const db = require('./database');
db.exec(`
  CREATE TABLE IF NOT EXISTS planning_area_cache (
    area_key   TEXT PRIMARY KEY,
    lat        REAL,
    lng        REAL,
    radius_km  INTEGER,
    area_name  TEXT,
    leads_json TEXT,          -- normalised applications for the whole area
    fetched_at INTEGER,       -- epoch ms of last successful PlanIt fetch (0 = never)
    requested_at INTEGER      -- epoch ms this area was last wanted (drives refresh)
  );
`);

let _cooldownUntilMs = 0;                       // epoch ms; 0 = not rate-limited
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;       // refresh an area at most daily
const WORKER_INTERVAL_MS = 90 * 1000;           // process at most one area / 90s
const _queue = [];                              // area_keys waiting to be fetched
const _queued = new Set();                      // dedupe guard for _queue

function nowMs() { return Date.now(); }
function cooldownRemainingSecs() { return Math.max(0, Math.ceil((_cooldownUntilMs - nowMs()) / 1000)); }
function cacheKey(lat, lng, radiusKm) {
  // Round the centre so nearby postcodes share one cached area fetch.
  return [lat.toFixed(2), lng.toFixed(2), Math.round(radiusKm)].join(':');
}

const _getArea = db.prepare('SELECT * FROM planning_area_cache WHERE area_key = ?');
const _upsertRequest = db.prepare(`
  INSERT INTO planning_area_cache (area_key, lat, lng, radius_km, area_name, leads_json, fetched_at, requested_at)
  VALUES (@area_key, @lat, @lng, @radius_km, @area_name, '[]', 0, @now)
  ON CONFLICT(area_key) DO UPDATE SET requested_at = @now, radius_km = @radius_km, area_name = @area_name
`);
const _saveLeads = db.prepare('UPDATE planning_area_cache SET leads_json = ?, fetched_at = ? WHERE area_key = ?');

// Ask for an area to be (re)fetched: record the request and queue it if it's
// missing or stale. Cheap and idempotent — safe to call on every scan.
function requestArea({ key, lat, lng, radiusKm, areaName }) {
  _upsertRequest.run({ area_key: key, lat, lng, radius_km: radiusKm, area_name: areaName || '', now: nowMs() });
  const row = _getArea.get(key);
  const stale = !row || !row.fetched_at || (nowMs() - row.fetched_at) >= CACHE_TTL_MS;
  if (stale && !_queued.has(key)) { _queued.add(key); _queue.push(key); }
  return row;
}

function queueDepth() { return _queue.length; }

// PlanIt requires a spatial/date/search restriction and has shifted its param
// names over time, so we build a list of candidate spatial queries and use the
// first that PlanIt accepts. Order = most precise first. The same builder feeds
// the /diag probe, so the live server tells us which shape works.
function buildPlanitQueries({ lat, lng, radiusKm, pageSize = 100 }) {
  const km = Number(radiusKm) || 8;
  // Bounding box from centre + radius. GeoJSON bbox order: W,S,E,N.
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map(n => n.toFixed(5)).join(',');
  const common = `pg_sz=${pageSize}&select=${PLANIT_SELECT}`;
  return [
    { label: 'lat/lng/krad', qs: `lat=${lat}&lng=${lng}&krad=${km}&${common}` },
    { label: 'bbox', qs: `bbox=${bbox}&${common}` },
    { label: 'geo/krad', qs: `geo=${lat},${lng}&krad=${km}&${common}` },
  ];
}

// Extract the records array whatever key PlanIt uses.
function recordsOf(j) {
  return (j && (j.records || j.applics || j.results || (Array.isArray(j) ? j : null))) || [];
}

// Fetch raw applications from PlanIt within radiusKm of lat/lng. Issues ONE
// request (the first query shape); only if PlanIt says 400 "wrong shape" do we
// try the next candidate — we never fire all shapes speculatively, to stay
// under the rate limit. A 429 starts a cooldown and is re-thrown so the caller
// can serve cached/sample data with a clear "try again in N" message.
async function fetchPlanit({ lat, lng, radiusKm, pageSize = 100 }) {
  const queries = buildPlanitQueries({ lat, lng, radiusKm, pageSize });
  let lastErr;
  for (const q of queries) {
    try {
      const j = await fetchJson(PLANIT_BASE + '?' + withKey(q.qs), 14000);
      return recordsOf(j).map(normalise);
    } catch (e) {
      lastErr = e;
      if (e && e.status === 429) {
        _cooldownUntilMs = nowMs() + (e.retryAfter || 60) * 1000;
        throw e; // don't try other shapes — they'll all be limited too.
      }
      // A 400 means "wrong query shape" — try the next candidate. Any other
      // status (403 egress, 5xx, network) is a real outage; stop and report it.
      if (e && e.status && e.status !== 400) throw e;
    }
  }
  throw lastErr || new Error('PlanIt returned no usable result.');
}

// Apply the builder's filters to a stored area's raw applications. Kept
// separate so changing filters never needs a re-fetch — it's a local pass over
// data we already hold.
function filterLeads(raw, { categories, stateMode, monthsBack, limit }) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const res = [];
  const seen = new Set();
  for (const lead of raw) {
    if (!categories.some(c => CATEGORIES[c].re.test(lead.description))) continue;
    const st = (lead.state || '').toLowerCase();
    if (stateMode === 'granted' && !GRANTED_STATES.has(st)) continue;
    if (stateMode === 'submitted' && !(st.includes('undecided') || st.includes('pending') || !st)) continue;
    const dateStr = stateMode === 'submitted' ? lead.submitted_date : (lead.decided_date || lead.submitted_date);
    if (dateStr && dateStr < cutoffStr) continue;
    const key = lead.ref || lead.address;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({ ...lead, category: categories.find(c => CATEGORIES[c].re.test(lead.description)) });
  }
  res.sort((a, b) => (b.decided_date || b.submitted_date || '').localeCompare(a.decided_date || a.submitted_date || ''));
  return res.slice(0, limit);
}

// The public entry point. Reads from the local store and never calls PlanIt
// itself. Returns { status: 'ready' | 'collecting', leads, area, ... }.
//   opts: { postcode, radiusKm, categories[], state, monthsBack, limit }
async function searchLeads(opts = {}) {
  const radiusKm = Math.min(Math.max(Number(opts.radiusKm) || 8, 1), 40);
  const categories = (Array.isArray(opts.categories) && opts.categories.length
    ? opts.categories : ['extensions_lofts']).filter(c => CATEGORIES[c]);
  const stateMode = opts.state === 'all' || opts.state === 'submitted' ? opts.state : 'granted';
  const monthsBack = Math.min(Math.max(Number(opts.monthsBack) || 6, 1), 24);
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 80);

  const geo = await geocodePostcode(opts.postcode);
  const key = cacheKey(geo.lat, geo.lng, radiusKm);
  // Record/queue this area for the background worker (idempotent).
  const row = requestArea({ key, lat: geo.lat, lng: geo.lng, radiusKm, areaName: geo.area });

  const hasData = row && row.fetched_at && row.leads_json && row.leads_json !== '[]';
  if (!hasData) {
    // Nothing collected for this area yet — the worker will fetch it shortly.
    const ahead = _queue.indexOf(key);
    const waitSecs = Math.max(cooldownRemainingSecs(), (Math.max(ahead, 0) + 1) * Math.round(WORKER_INTERVAL_MS / 1000));
    return { status: 'collecting', leads: [], area: geo.area, radiusKm, etaSecs: waitSecs, queueDepth: _queue.length };
  }

  let raw = [];
  try { raw = JSON.parse(row.leads_json) || []; } catch (_) { raw = []; }
  const leads = filterLeads(raw, { categories, stateMode, monthsBack, limit });
  const ageMs = nowMs() - row.fetched_at;
  return {
    status: 'ready',
    leads,
    area: geo.area || row.area_name || '',
    radiusKm,
    source: 'planit',
    stale: ageMs >= CACHE_TTL_MS,
    fetchedAt: new Date(row.fetched_at).toISOString(),
    totalInArea: raw.length,
  };
}

// ─── Background worker ───────────────────────────────────────────────────────
// Processes at most one queued area per tick, and only when we're not inside a
// PlanIt cooldown — so we sit far below the rate limit and never escalate a ban.
let _workerTimer = null;
let _lastRun = { at: null, key: null, ok: null, note: '' };

async function processQueue() {
  if (cooldownRemainingSecs() > 0) return;      // wait out any ban
  const key = _queue.shift();
  if (!key) return;
  _queued.delete(key);
  const row = _getArea.get(key);
  if (!row) return;
  // Skip if it went fresh while queued (e.g. requested twice).
  if (row.fetched_at && (nowMs() - row.fetched_at) < CACHE_TTL_MS) return;
  try {
    const raw = await fetchPlanit({ lat: row.lat, lng: row.lng, radiusKm: row.radius_km });
    _saveLeads.run(JSON.stringify(raw), nowMs(), key);
    _lastRun = { at: new Date().toISOString(), key, ok: true, note: raw.length + ' applications' };
  } catch (e) {
    // 429 already set the cooldown inside fetchPlanit; re-queue for later.
    if (!_queued.has(key)) { _queued.add(key); _queue.push(key); }
    _lastRun = { at: new Date().toISOString(), key, ok: false, note: (e.status ? 'HTTP ' + e.status + ' ' : '') + (e.retryAfter ? '(retry ' + e.retryAfter + 's)' : e.message) };
  }
}

// Re-queue every known area that's gone stale — the daily refresh, spread out
// naturally by the worker's throttle.
function enqueueStaleAreas() {
  const rows = db.prepare('SELECT area_key FROM planning_area_cache WHERE fetched_at = 0 OR fetched_at < ?').all(nowMs() - CACHE_TTL_MS);
  for (const r of rows) if (!_queued.has(r.area_key)) { _queued.add(r.area_key); _queue.push(r.area_key); }
}

function startHarvester() {
  if (_workerTimer) return;
  enqueueStaleAreas();
  _workerTimer = setInterval(() => { processQueue().catch(() => {}); }, WORKER_INTERVAL_MS);
  if (_workerTimer.unref) _workerTimer.unref();
  // Re-scan for stale areas a few times a day so cached areas stay current.
  const refresh = setInterval(enqueueStaleAreas, 6 * 60 * 60 * 1000);
  if (refresh.unref) refresh.unref();
}

function harvesterStatus() {
  return { queueDepth: _queue.length, cooldownSecs: cooldownRemainingSecs(), lastRun: _lastRun, intervalSecs: Math.round(WORKER_INTERVAL_MS / 1000) };
}

// ─── Sample data ─────────────────────────────────────────────────────────────
// Shown when the caller passes demo=1, or offered as a fallback when PlanIt is
// unreachable, so the builder can always see how the tool works.
function sampleLeads() {
  const today = new Date();
  const ago = (d) => { const x = new Date(today); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
  return {
    source: 'sample',
    area: 'Sample area',
    radiusKm: 8,
    leads: [
      { ref: 'DEMO/24/0912/HH', council: 'Sample District Council', description: 'Single storey rear extension and internal alterations to existing dwelling.', address: '14 Elm Road, Sampleton', postcode: 'AB1 2CD', state: 'Permitted', type: 'Full', size: 'Small', submitted_date: ago(58), decided_date: ago(9), url: '', lat: null, lng: null, category: 'extensions_lofts' },
      { ref: 'DEMO/24/0887/HH', council: 'Sample District Council', description: 'Loft conversion with rear dormer and two roof lights.', address: '3 Oak Avenue, Sampleton', postcode: 'AB1 3EF', state: 'Conditions', type: 'Full', size: 'Small', submitted_date: ago(70), decided_date: ago(15), url: '', lat: null, lng: null, category: 'extensions_lofts' },
      { ref: 'DEMO/24/0790/FUL', council: 'Neighbouring Borough Council', description: 'Conversion of integral garage to habitable room and new pitched roof porch.', address: '27 Maple Close, Otherford', postcode: 'AB2 1GH', state: 'Permitted', type: 'Full', size: 'Small', submitted_date: ago(84), decided_date: ago(22), url: '', lat: null, lng: null, category: 'extensions_lofts' },
      { ref: 'DEMO/24/0654/FUL', council: 'Neighbouring Borough Council', description: 'Erection of 1 no. detached dwelling with associated parking and landscaping.', address: 'Land adjacent to 9 Birch Lane, Otherford', postcode: 'AB2 4JK', state: 'Permitted', type: 'Full', size: 'Medium', submitted_date: ago(120), decided_date: ago(28), url: '', lat: null, lng: null, category: 'new_dwellings' },
    ],
  };
}

module.exports = {
  searchLeads, sampleLeads, geocodePostcode, CATEGORIES,
  buildPlanitQueries, recordsOf, PLANIT_BASE, fetchJson,
  cooldownRemainingSecs, withKey, hasApiKey: () => !!PLANIT_API_KEY,
  USER_AGENT, startHarvester, harvesterStatus, queueDepth,
  // exported for tests / manual harvest triggering
  processQueue, filterLeads,
};

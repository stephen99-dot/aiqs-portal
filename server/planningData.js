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

// Timeout wrapper — never let a slow upstream hang the request.
async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error('Upstream ' + r.status); e.status = r.status; throw e; }
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
    lat: Number(pick(rec, ['lat', 'latitude'], 0)) || null,
    lng: Number(pick(rec, ['lng', 'lon', 'longitude'], 0)) || null,
  };
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

// Fetch raw applications from PlanIt within radiusKm of lat/lng. Returns the
// normalised, unfiltered list (state/keyword filtering happens in searchLeads).
async function fetchPlanit({ lat, lng, radiusKm, pageSize = 100 }) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    krad: String(radiusKm),
    pg_sz: String(pageSize),
    sort: '-start_date',
    select: 'name,uid,area_name,description,address,postcode,app_state,app_type,app_size,start_date,decided_date,url,lat,lng',
  });
  const j = await fetchJson(PLANIT_BASE + '?' + params.toString(), 14000);
  const records = (j && (j.records || j.applics || j.results)) || [];
  return records.map(normalise);
}

// The public entry point. Returns { leads, source, area }.
//   opts: { postcode, radiusKm, categories[], state, monthsBack, limit }
async function searchLeads(opts = {}) {
  const radiusKm = Math.min(Math.max(Number(opts.radiusKm) || 8, 1), 40);
  const categories = (Array.isArray(opts.categories) && opts.categories.length
    ? opts.categories : ['extensions_lofts']).filter(c => CATEGORIES[c]);
  const stateMode = opts.state === 'all' || opts.state === 'submitted' ? opts.state : 'granted';
  const monthsBack = Math.min(Math.max(Number(opts.monthsBack) || 6, 1), 24);
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 80);

  const geo = await geocodePostcode(opts.postcode);
  let raw;
  try {
    raw = await fetchPlanit({ lat: geo.lat, lng: geo.lng, radiusKm });
  } catch (e) {
    // Network/policy blocked (e.g. sandbox) — surface a clear, non-fatal signal.
    const err = new Error('The planning data service is unreachable right now. Try again shortly, or use the sample data to preview the tool.');
    err.code = 'UPSTREAM_UNREACHABLE';
    err.cause = e;
    throw err;
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const res = [];
  const seen = new Set();
  for (const lead of raw) {
    // Category keyword match.
    if (!categories.some(c => CATEGORIES[c].re.test(lead.description))) continue;
    // State filter.
    const st = lead.state.toLowerCase();
    if (stateMode === 'granted' && !GRANTED_STATES.has(st)) continue;
    if (stateMode === 'submitted' && !(st.includes('undecided') || st.includes('pending') || !st)) continue;
    // Recency: for granted, require a decision within the window (that's the
    // "ready to build now" signal). For submitted, use the submission date.
    const dateStr = stateMode === 'submitted' ? lead.submitted_date : (lead.decided_date || lead.submitted_date);
    if (dateStr && dateStr < cutoffStr) continue;
    // Dedupe by ref (or address if ref missing).
    const key = lead.ref || lead.address;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({ ...lead, category: categories.find(c => CATEGORIES[c].re.test(lead.description)) });
  }

  // Most recently decided first.
  res.sort((a, b) => (b.decided_date || b.submitted_date || '').localeCompare(a.decided_date || a.submitted_date || ''));
  return { leads: res.slice(0, limit), source: 'planit', area: geo.area, radiusKm };
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

module.exports = { searchLeads, sampleLeads, geocodePostcode, CATEGORIES };

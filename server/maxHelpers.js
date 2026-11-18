// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxHelpers.js
//
// The small shared kit every MAX tool is built from: the loopback API client
// (the builder's own token, so every rule the API enforces still applies), the
// name-or-id resolvers for the AI QS records, compact row shapes for the model,
// and money formatting to the penny with VAT made explicit. Split out of
// maxEngine.js so the tool module can use it without a circular require.
// ═══════════════════════════════════════════════════════════════════════════════

class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Every tool talks to the app through this. It forwards the builder's own
// Authorization header so the API sees the request exactly as if the panel had
// made it — the same tenant scoping, the same gates.
function makeApi({ baseUrl, headers }) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  const base = origin + '/api';
  async function call(method, path, body) {
    const init = { method, headers: { ...headers, Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + path, init);
    const ct = res.headers.get('content-type') || '';
    let data = null;
    if (/json/.test(ct)) {
      try { data = await res.json(); } catch (e) { data = null; }
    } else {
      const text = await res.text();
      data = text ? { text: text.slice(0, 500) } : null;
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || ('The app answered HTTP ' + res.status + '.');
      throw new ApiError(res.status, msg, data);
    }
    return data;
  }
  // A file's bytes (a drawing, a PDF, a delivered BOQ), with the same credentials.
  async function raw(path, { maxBytes = 25 * 1024 * 1024 } = {}) {
    const url = path.startsWith('/api/') ? origin + path : base + path;
    const res = await fetch(url, { headers: { ...headers } });
    if (!res.ok) {
      let msg = 'The app answered HTTP ' + res.status + '.';
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* not json */ }
      throw new ApiError(res.status, msg, null);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new ApiError(413, 'That file is too big for me to read here (' + Math.round(buf.length / 1048576) + ' MB).', null);
    return { buffer: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b === undefined ? {} : b),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    raw,
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(num(n) * 100) / 100;
// Whole pounds — for titles and detail lines.
const fmtMoney = (n) => '£' + (Math.round(Number(n) || 0)).toLocaleString('en-GB');
// To the penny — for approval cards and anything that states an amount.
const fmtMoney2 = (n) => '£' + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const todayIso = () => new Date().toISOString().slice(0, 10);

// Find one record by id or by a name fragment. Returns { row } or { error,
// candidates } so the model can ask the builder which one they meant.
function pickOne(rows, query, fields, what) {
  const q = norm(query);
  if (!q) return { error: 'Which ' + what + '? Give a name or id.' };
  const byId = rows.find((r) => String(r.id) === String(query));
  if (byId) return { row: byId };
  const exact = rows.filter((r) => fields.some((f) => norm(r[f]) === q));
  if (exact.length === 1) return { row: exact[0] };
  const partial = rows.filter((r) => fields.some((f) => norm(r[f]).includes(q)));
  const pool = exact.length > 1 ? exact : partial;
  if (pool.length === 1) return { row: pool[0] };
  if (pool.length === 0) return { error: 'No ' + what + ' matches "' + query + '".' };
  return {
    error: 'More than one ' + what + ' matches "' + query + '". Ask the builder which one.',
    candidates: pool.slice(0, 8).map((r) => ({ id: r.id, ...Object.fromEntries(fields.map((f) => [f, r[f]])) })),
  };
}

// The builder's drawings jobs with the AI QS team (projects).
async function resolveProject(api, query) {
  const projects = await api.get('/projects');
  return pickOne(Array.isArray(projects) ? projects : [], query, ['title', 'location', 'project_type'], 'job');
}
// MAX estimates (and any other saved quotes).
async function resolveEstimate(api, query) {
  const { quotes } = await api.get('/estimator/quotes');
  return pickOne(quotes || [], query, ['quote_number', 'project_name', 'client_name'], 'estimate');
}

// Plain-English labels for the drawings-job lifecycle (PORTAL_SPEC.md).
const PROJECT_STATUS_LABEL = {
  submitted: 'Submitted — awaiting the QS team', in_review: 'Being reviewed by the QS team', in_progress: 'Being priced',
  awaiting_payment: 'Awaiting payment', completed: 'Completed', delivered: 'Delivered — documents ready', received: 'With the QS team',
};

// Compact rows: the model needs names, states and money, not every column.
const projectRow = (p) => ({
  id: p.id, title: p.title, project_type: p.project_type, location: p.location || null,
  status: p.status, status_label: PROJECT_STATUS_LABEL[p.status] || p.status,
  drawings: Number(p.fileCount != null ? p.fileCount : p.file_count) || 0,
  documents_back: Number(p.deliverableCount != null ? p.deliverableCount : p.deliverable_count) || 0,
  boq_ready: !!p.boq_filename, total_value: p.total_value != null ? Number(p.total_value) : null, currency: p.currency || 'GBP',
  submitted_at: p.created_at, updated_at: p.updated_at,
});
const estimateRow = (q) => ({
  id: q.id, quote_number: q.quote_number, project_name: q.project_name, client_name: q.client_name || null,
  status: q.status, locked: !!q.locked, source: q.source || 'manual', location: q.location || null,
  net_total_ex_vat: Number(q.net_total) || 0, grand_total_inc_vat: Number(q.grand_total) || 0, currency: q.currency || 'GBP',
  sent_at: q.sent_at || null, accepted_at: q.accepted_at || null, created_at: q.created_at,
});

const lineSchema = {
  type: 'array',
  description: 'Priced lines. qty × rate = the line value, ex VAT.',
  items: {
    type: 'object',
    properties: {
      section: { type: 'string', description: 'Stage or trade heading, e.g. Groundworks' },
      item: { type: 'string', description: 'Short name, 2–5 words' },
      description: { type: 'string' },
      qty: { type: 'number' },
      unit: { type: 'string', description: 'm, m2, m3, nr, item, day, hr…' },
      rate: { type: 'number', description: 'Unit rate in £, ex VAT' },
    },
    required: ['item', 'qty', 'rate'],
  },
};

module.exports = {
  ApiError, makeApi, num, round2, fmtMoney, fmtMoney2, norm, todayIso, pickOne,
  resolveProject, resolveEstimate, projectRow, estimateRow, PROJECT_STATUS_LABEL, lineSchema,
};

// ═══════════════════════════════════════════════════════════════════════════════
// XERO — NATIVE CONNECTION — server/xeroClient.js
//
// A real, one-button "Connect with Xero" integration (OAuth2), sitting alongside
// the CSV export in accountingExport.js. Where the CSV is a file the builder's
// accountant imports by hand, this pushes sales invoices straight into the
// builder's own Xero organisation over the API.
//
// Flow (mirrors the Google OAuth flow in routes.js):
//   1. /api/xero/connect  → redirect the builder to Xero to approve access
//   2. /api/xero/callback → swap the code for tokens, remember which org (tenant)
//   3. /api/xero/push     → create AUTHORISED sales invoices in that org
//
// Tokens live per-builder in oib_settings. Xero access tokens expire after 30
// minutes and the refresh token ROTATES on every refresh, so both are re-saved
// each time — see getValidToken().
//
// VAT is the whole point of the add-on, so tax types are never hard-coded: we
// read the connected org's own tax rates and match by rate/name (see
// resolveTaxType). New Xero orgs number custom rates TAX001, TAX002… so matching
// live is the only reliable way to stay correct across organisations.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');

const CLIENT_ID = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://aiqs-portal.onrender.com';
const REDIRECT_URI = process.env.XERO_REDIRECT_URI || `${PORTAL_BASE_URL}/api/xero/callback`;

// openid/profile/email → identify the org; accounting.* → read tax rates and
// write invoices/contacts; offline_access → get a refresh token so the link
// keeps working after the first 30 minutes.
const SCOPES = [
  'openid', 'profile', 'email',
  'accounting.transactions', 'accounting.contacts', 'accounting.settings',
  'offline_access',
].join(' ');

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const API_BASE = 'https://api.xero.com/api.xro/2.0';

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }

function isoDate(v) {
  if (!v) return undefined;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

// ─── token storage (per builder, in oib_settings) ─────────────────────────────

function getOib(userId) {
  db.prepare('INSERT OR IGNORE INTO oib_settings (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM oib_settings WHERE user_id = ?').get(userId);
}

function saveTokens(userId, { access_token, refresh_token, expires_in }, extra = {}) {
  const expiry = Date.now() + (num(expires_in, 1800) * 1000);
  const cols = ['xero_access_token = ?', 'xero_refresh_token = ?', 'xero_token_expiry = ?'];
  const vals = [access_token, refresh_token, expiry];
  for (const [k, v] of Object.entries(extra)) { cols.push(k + ' = ?'); vals.push(v); }
  cols.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(userId);
  db.prepare('UPDATE oib_settings SET ' + cols.join(', ') + ' WHERE user_id = ?').run(...vals);
}

function clearTokens(userId) {
  db.prepare(
    'UPDATE oib_settings SET xero_access_token = NULL, xero_refresh_token = NULL, ' +
    'xero_token_expiry = NULL, xero_tenant_id = NULL, xero_tenant_name = NULL, ' +
    'xero_connected_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?'
  ).run(userId);
}

function status(userId) {
  const row = getOib(userId);
  return {
    configured: isConfigured(),
    connected: !!(row && row.xero_refresh_token && row.xero_tenant_id),
    tenant_name: (row && row.xero_tenant_name) || null,
    connected_at: (row && row.xero_connected_at) || null,
  };
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

function authorizeUrl(state) {
  // Build the query by hand with encodeURIComponent: it encodes the spaces
  // between scopes as %20. URLSearchParams uses '+' instead, which Xero's
  // identity server rejects with `invalid_scope` (Google tolerates '+', Xero
  // does not).
  const params = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  };
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${AUTHORIZE_URL}?${qs}`;
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error('Xero token exchange failed: ' + (data.error || res.status));
    err.xeroError = data.error || String(res.status);
    throw err;
  }
  return data;
}

async function exchangeCode(code) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
}

// Which organisation did the builder pick? A single login can grant access to
// several — we take the first real organisation.
async function getConnections(accessToken) {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to read Xero connections (' + res.status + ')');
  const list = await res.json();
  return Array.isArray(list) ? list : [];
}

// Complete the OAuth handshake and remember the org. Called from the callback.
async function connect(userId, code) {
  const tokens = await exchangeCode(code);
  const connections = await getConnections(tokens.access_token);
  const org = connections.find(c => c.tenantType === 'ORGANISATION') || connections[0];
  if (!org) throw new Error('No Xero organisation was shared.');
  saveTokens(userId, tokens, {
    xero_tenant_id: org.tenantId,
    xero_tenant_name: org.tenantName || 'Xero',
    xero_connected_at: new Date().toISOString(),
  });
  return { tenant_name: org.tenantName || 'Xero' };
}

// Return a live access token, refreshing (and re-saving the rotated refresh
// token) when the current one is within a minute of expiry.
async function getValidToken(userId) {
  const row = getOib(userId);
  if (!row || !row.xero_refresh_token || !row.xero_tenant_id) {
    const e = new Error('Xero is not connected.'); e.code = 'NOT_CONNECTED'; throw e;
  }
  const fresh = row.xero_token_expiry && Date.now() < (row.xero_token_expiry - 60000);
  if (fresh && row.xero_access_token) {
    return { accessToken: row.xero_access_token, tenantId: row.xero_tenant_id };
  }
  try {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.xero_refresh_token });
    saveTokens(userId, tokens);
    return { accessToken: tokens.access_token, tenantId: row.xero_tenant_id };
  } catch (err) {
    // Refresh tokens expire after 60 days of no use, or if revoked in Xero.
    if (err.xeroError === 'invalid_grant') {
      clearTokens(userId);
      const e = new Error('Your Xero connection has expired — reconnect to carry on.');
      e.code = 'NEEDS_RECONNECT';
      throw e;
    }
    throw err;
  }
}

// ─── Xero API calls ───────────────────────────────────────────────────────────

async function xeroGet(accessToken, tenantId, path) {
  const res = await fetch(API_BASE + path, {
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Xero-tenant-id': tenantId,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error('Xero GET ' + path + ' failed (' + res.status + ')');
  return res.json();
}

async function xeroPost(accessToken, tenantId, path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Xero-tenant-id': tenantId,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Xero returns a validation message we can surface to the builder.
    const msg = data.Message || (data.Elements && data.Elements[0] &&
      data.Elements[0].ValidationErrors && data.Elements[0].ValidationErrors[0] &&
      data.Elements[0].ValidationErrors[0].Message) || ('HTTP ' + res.status);
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

// ─── tax mapping ──────────────────────────────────────────────────────────────
// Match one of our invoices to a tax type that actually exists in THIS org.

async function loadRevenueTaxRates(accessToken, tenantId) {
  const data = await xeroGet(accessToken, tenantId, '/TaxRates');
  const rates = (data && data.TaxRates) || [];
  return rates.filter(r =>
    (r.Status === 'ACTIVE' || !r.Status) &&
    // CanApplyToRevenue is present on UK orgs; keep the rate if the flag is
    // absent so we don't accidentally discard everything on other regions.
    (r.CanApplyToRevenue === undefined || r.CanApplyToRevenue === true));
}

function resolveTaxType(inv, revenueRates) {
  const byName = (needle) => revenueRates.find(r =>
    String(r.Name || '').toLowerCase().includes(needle));
  const byRate = (pct) => revenueRates.find(r => Math.abs(num(r.EffectiveRate) - pct) < 0.001);

  if (inv.reverse_charge) {
    const rc = byName('reverse charge') || byName('domestic reverse') || byName('drc');
    return rc ? rc.TaxType : undefined; // fall back to the account default
  }
  const pct = num(inv.vat_pct);
  if (pct === 0) {
    const zero = byName('zero rated') || byName('no vat') || byRate(0);
    return zero ? zero.TaxType : undefined;
  }
  const match = byRate(pct);
  return match ? match.TaxType : undefined;
}

// ─── invoice push ─────────────────────────────────────────────────────────────

function getPushableInvoices(userId, invoiceId) {
  let sql = "SELECT * FROM invoices WHERE user_id = ? AND status IN ('sent','paid') " +
    "AND (xero_invoice_id IS NULL OR xero_invoice_id = '')";
  const params = [userId];
  if (invoiceId) { sql += ' AND id = ?'; params.push(invoiceId); }
  sql += ' ORDER BY issue_date ASC, created_at ASC';
  return db.prepare(sql).all(...params);
}

function buildXeroInvoice(inv, revenueRates) {
  const lines = db.prepare(
    'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC, rowid ASC'
  ).all(inv.id);
  const jobName = inv.job_id
    ? (db.prepare('SELECT name FROM estimator_jobs WHERE id = ?').get(inv.job_id)?.name || '')
    : '';
  const taxType = resolveTaxType(inv, revenueRates);

  const lineItems = lines.map(ln => {
    const li = {
      Description: [ln.item, ln.description].filter(Boolean).join(' — ') || 'Item',
      Quantity: num(ln.qty, 1),
      UnitAmount: num(ln.rate),   // tax-exclusive — matches LineAmountTypes below
      AccountCode: '200',         // Xero UK default Sales account
    };
    if (taxType) li.TaxType = taxType;
    return li;
  });

  return {
    Type: 'ACCREC',              // accounts receivable = a sales invoice
    Contact: {
      Name: inv.client_name || 'Customer',
      ...(inv.client_email ? { EmailAddress: inv.client_email } : {}),
    },
    InvoiceNumber: inv.invoice_number || undefined,
    Reference: jobName || undefined,
    Date: isoDate(inv.issue_date),
    DueDate: isoDate(inv.due_date),
    LineAmountTypes: 'Exclusive',
    Status: 'AUTHORISED',        // a real, approved invoice (not a draft)
    CurrencyCode: inv.currency || 'GBP',
    LineItems: lineItems,
  };
}

// Push sent/paid invoices into the connected org. Idempotent: an invoice we've
// already pushed carries its Xero InvoiceID and is skipped next time.
async function pushInvoices(userId, invoiceId) {
  const pending = getPushableInvoices(userId, invoiceId);
  if (pending.length === 0) return { pushed: 0, failed: 0, results: [] };

  const { accessToken, tenantId } = await getValidToken(userId);
  const revenueRates = await loadRevenueTaxRates(accessToken, tenantId).catch(() => []);

  const results = [];
  let pushed = 0, failed = 0;
  for (const inv of pending) {
    try {
      const payload = buildXeroInvoice(inv, revenueRates);
      const resp = await xeroPost(accessToken, tenantId, '/Invoices', { Invoices: [payload] });
      const created = resp && resp.Invoices && resp.Invoices[0];
      const xeroId = created && created.InvoiceID;
      if (xeroId) {
        db.prepare('UPDATE invoices SET xero_invoice_id = ? WHERE id = ?').run(xeroId, inv.id);
      }
      pushed++;
      results.push({ id: inv.id, invoice_number: inv.invoice_number, ok: true, xero_id: xeroId });
    } catch (err) {
      failed++;
      results.push({ id: inv.id, invoice_number: inv.invoice_number, ok: false, error: err.message });
    }
  }
  return { pushed, failed, results };
}

module.exports = {
  isConfigured, status, authorizeUrl, connect, clearTokens, pushInvoices,
  REDIRECT_URI,
};

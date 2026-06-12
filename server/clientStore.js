// clientStore.js — real client records for the estimator/Office in a Box.
//
// Quotes, invoices and jobs name their customer as a plain string; this module
// turns those strings into durable records. findOrCreateClient is called from
// every create path (job, quote, invoice), and backfillClients sweeps any
// historical rows that predate the table — so the Clients page is populated
// the first time it's opened, with nothing for the builder to set up.

const { v4: uuidv4 } = require('uuid');

function norm(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

// Match an existing client by email first (strongest signal), then by
// case-insensitive name. Creates the record if nothing matches. Fills in
// blank email/phone/address on the existing record when the caller knows
// more than we stored. Returns the client id, or null when there's no name.
function findOrCreateClient(db, userId, { name, email, phone, address } = {}) {
  const cleanName = norm(name);
  const cleanEmail = norm(email).toLowerCase() || null;
  const cleanPhone = norm(phone) || null;
  const cleanAddress = norm(address) || null;
  if (!cleanName && !cleanEmail) return null;

  let row = null;
  if (cleanEmail) {
    row = db.prepare('SELECT * FROM estimator_clients WHERE user_id = ? AND LOWER(email) = ?')
      .get(userId, cleanEmail);
  }
  if (!row && cleanName) {
    row = db.prepare('SELECT * FROM estimator_clients WHERE user_id = ? AND LOWER(name) = LOWER(?)')
      .get(userId, cleanName);
  }

  if (row) {
    const sets = [];
    const vals = [];
    if (cleanEmail && !row.email) { sets.push('email = ?'); vals.push(cleanEmail); }
    if (cleanPhone && !row.phone) { sets.push('phone = ?'); vals.push(cleanPhone); }
    if (cleanAddress && !row.address) { sets.push('address = ?'); vals.push(cleanAddress); }
    if (sets.length) {
      vals.push(row.id);
      db.prepare(`UPDATE estimator_clients SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
    }
    return row.id;
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO estimator_clients (id, user_id, name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, cleanName || cleanEmail, cleanEmail, cleanPhone, cleanAddress);
  return id;
}

// Sweep jobs/quotes/invoices that have a client_name but no client_id and
// link them up, creating records as needed. Idempotent and cheap on repeat
// runs (the WHERE clauses come back empty once everything is linked).
function backfillClients(db, userId) {
  const sources = [
    { table: 'estimator_jobs', email: null, phone: 'client_phone', address: null },
    { table: 'quotes', email: 'client_email', phone: null, address: null },
    { table: 'invoices', email: 'client_email', phone: null, address: 'client_address' },
  ];
  for (const src of sources) {
    const cols = ['id', 'client_name']
      .concat(src.email ? [src.email] : [], src.phone ? [src.phone] : [], src.address ? [src.address] : [])
      .join(', ');
    let rows = [];
    try {
      rows = db.prepare(
        `SELECT ${cols} FROM ${src.table} WHERE user_id = ? AND client_id IS NULL AND client_name IS NOT NULL AND TRIM(client_name) != ''`
      ).all(userId);
    } catch (e) { continue; }
    for (const r of rows) {
      const clientId = findOrCreateClient(db, userId, {
        name: r.client_name,
        email: src.email ? r[src.email] : null,
        phone: src.phone ? r[src.phone] : null,
        address: src.address ? r[src.address] : null,
      });
      if (clientId) {
        db.prepare(`UPDATE ${src.table} SET client_id = ? WHERE id = ?`).run(clientId, r.id);
      }
    }
  }
}

// Clients with the numbers that matter: jobs, quoted, invoiced, paid, owed.
function listClientsWithTotals(db, userId) {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM estimator_jobs j WHERE j.client_id = c.id) AS job_count,
      (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id) AS quote_count,
      COALESCE((SELECT SUM(q.grand_total) FROM quotes q WHERE q.client_id = c.id AND q.status NOT IN ('lost', 'rejected')), 0) AS quoted_total,
      COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.client_id = c.id AND i.status != 'void'), 0) AS invoiced_total,
      COALESCE((SELECT SUM(i.paid_amount) FROM invoices i WHERE i.client_id = c.id), 0) AS paid_total,
      COALESCE((SELECT SUM(i.grand_total - COALESCE(i.paid_amount, 0)) FROM invoices i
                WHERE i.client_id = c.id AND i.status NOT IN ('paid', 'void', 'draft')), 0) AS owed_total
    FROM estimator_clients c
    WHERE c.user_id = ?
    ORDER BY c.name COLLATE NOCASE
  `).all(userId);
}

function getClientDetail(db, userId, clientId) {
  const client = db.prepare('SELECT * FROM estimator_clients WHERE id = ? AND user_id = ?').get(clientId, userId);
  if (!client) return null;
  const jobs = db.prepare(
    'SELECT id, name, status, created_at FROM estimator_jobs WHERE client_id = ? ORDER BY created_at DESC'
  ).all(clientId);
  const quotes = db.prepare(
    'SELECT id, quote_number, project_name, grand_total, status, created_at FROM quotes WHERE client_id = ? ORDER BY created_at DESC'
  ).all(clientId);
  const invoices = db.prepare(
    'SELECT id, invoice_number, grand_total, paid_amount, status, due_date, created_at FROM invoices WHERE client_id = ? ORDER BY created_at DESC'
  ).all(clientId);
  return { client, jobs, quotes, invoices };
}

module.exports = { findOrCreateClient, backfillClients, listClientsWithTotals, getClientDetail };

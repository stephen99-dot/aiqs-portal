// ═══════════════════════════════════════════════════════════════════════════════
// A4 — ACCOUNTING EXPORT — server/accountingExport.js
//
// CSV exports of invoices and payments in the import formats Xero and
// QuickBooks Online publish (full API integrations are out of scope):
//
//  Xero sales invoices  — Xero's customer-invoice CSV template. Required
//    columns are ContactName + InvoiceNumber; line columns Description,
//    Quantity, UnitAmount (tax-exclusive), AccountCode, TaxType must match
//    Xero's own names. Dates DD/MM/YYYY. TaxType must equal the rate's
//    display name in Xero UK ("20% (VAT on Income)", "5% (VAT on Income)",
//    "Zero Rated Income", "Domestic Reverse Charge @ 20% (VAT on Income)").
//  Xero payments — Xero's bank-statement CSV import: Date + Amount required,
//    Payee/Description/Reference optional.
//  QuickBooks Online invoices — QBO's invoice import columns (InvoiceNo,
//    Customer, InvoiceDate, DueDate, ItemDescription, ItemQuantity, ItemRate,
//    ItemAmount, ItemTaxCode, ItemTaxAmount, Currency); QBO lets the user
//    remap headers at import, so exact names are a convenience not a contract.
//  QuickBooks payments — simple bank-feed CSV (Date, Description, Amount).
//
// Verified against Xero Central "Import customer invoices" and Intuit's
// "Import multiple invoices" guidance, June 2026.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function round2(n) { return Math.round(n * 100) / 100; }

// DD/MM/YYYY — what both importers expect for UK organisations.
function ukDate(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : s;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(headers, rows) {
  const out = [headers.map(csvCell).join(',')];
  for (const r of rows) out.push(headers.map(h => csvCell(r[h])).join(','));
  return out.join('\r\n') + '\r\n';
}

function xeroTaxType(inv) {
  if (inv.reverse_charge) return 'Domestic Reverse Charge @ 20% (VAT on Income)';
  const pct = num(inv.vat_pct);
  if (pct === 20) return '20% (VAT on Income)';
  if (pct === 5) return '5% (VAT on Income)';
  if (pct === 0) return 'Zero Rated Income';
  return pct + '% (VAT on Income)';
}

function getInvoicesWithLines(userId) {
  const invoices = db.prepare(
    "SELECT * FROM invoices WHERE user_id = ? AND status IN ('sent', 'paid') ORDER BY issue_date ASC, created_at ASC"
  ).all(userId);
  const lineStmt = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC, rowid ASC');
  return invoices.map(inv => ({ inv, lines: lineStmt.all(inv.id) }));
}

// ─── Invoices ────────────────────────────────────────────────────────────────

function buildInvoicesCsv(userId, format) {
  const data = getInvoicesWithLines(userId);

  if (format === 'quickbooks') {
    const headers = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'ItemDescription',
      'ItemQuantity', 'ItemRate', 'ItemAmount', 'ItemTaxCode', 'ItemTaxAmount', 'Currency'];
    const rows = [];
    for (const { inv, lines } of data) {
      const taxCode = inv.reverse_charge ? '20.0% RC CIS' : (num(inv.vat_pct) === 0 ? 'Zero-rated' : num(inv.vat_pct) + '% S');
      for (const ln of lines) {
        rows.push({
          InvoiceNo: inv.invoice_number,
          Customer: inv.client_name || 'Customer',
          InvoiceDate: ukDate(inv.issue_date),
          DueDate: ukDate(inv.due_date),
          ItemDescription: [ln.item, ln.description].filter(Boolean).join(' — '),
          ItemQuantity: num(ln.qty),
          ItemRate: num(ln.rate),
          ItemAmount: num(ln.line_total),
          ItemTaxCode: taxCode,
          ItemTaxAmount: inv.reverse_charge ? 0 : round2(num(ln.line_total) * num(inv.vat_pct) / 100),
          Currency: inv.currency || 'GBP',
        });
      }
    }
    return { filename: 'invoices-quickbooks.csv', csv: toCsv(headers, rows) };
  }

  // Default: Xero sales-invoice template.
  const headers = ['ContactName', 'EmailAddress', 'InvoiceNumber', 'Reference', 'InvoiceDate',
    'DueDate', 'Description', 'Quantity', 'UnitAmount', 'AccountCode', 'TaxType', 'Currency'];
  const rows = [];
  for (const { inv, lines } of data) {
    const jobName = inv.job_id
      ? (db.prepare('SELECT name FROM estimator_jobs WHERE id = ?').get(inv.job_id)?.name || '')
      : '';
    for (const ln of lines) {
      rows.push({
        ContactName: inv.client_name || 'Customer',
        EmailAddress: inv.client_email || '',
        InvoiceNumber: inv.invoice_number,
        Reference: jobName,
        InvoiceDate: ukDate(inv.issue_date),
        DueDate: ukDate(inv.due_date),
        Description: [ln.item, ln.description].filter(Boolean).join(' — '),
        Quantity: num(ln.qty),
        UnitAmount: num(ln.rate),  // tax-exclusive — say so when Xero asks at import
        AccountCode: '200',        // Xero UK default Sales account
        TaxType: xeroTaxType(inv),
        Currency: inv.currency || 'GBP',
      });
    }
  }
  return { filename: 'invoices-xero.csv', csv: toCsv(headers, rows) };
}

// ─── Payments ────────────────────────────────────────────────────────────────

function buildPaymentsCsv(userId, format) {
  const paid = db.prepare(
    "SELECT * FROM invoices WHERE user_id = ? AND status = 'paid' ORDER BY paid_at ASC"
  ).all(userId);

  if (format === 'quickbooks') {
    const headers = ['Date', 'Description', 'Amount'];
    const rows = paid.map(inv => ({
      Date: ukDate((inv.paid_at || '').slice(0, 10)),
      Description: 'Payment ' + (inv.invoice_number || '') + (inv.client_name ? ' — ' + inv.client_name : ''),
      Amount: num(inv.paid_amount) || num(inv.grand_total),
    }));
    return { filename: 'payments-quickbooks.csv', csv: toCsv(headers, rows) };
  }

  // Xero bank-statement import: Date + Amount required.
  const headers = ['Date', 'Amount', 'Payee', 'Description', 'Reference'];
  const rows = paid.map(inv => ({
    Date: ukDate((inv.paid_at || '').slice(0, 10)),
    Amount: num(inv.paid_amount) || num(inv.grand_total),
    Payee: inv.client_name || '',
    Description: 'Payment for invoice ' + (inv.invoice_number || ''),
    Reference: inv.invoice_number || '',
  }));
  return { filename: 'payments-xero.csv', csv: toCsv(headers, rows) };
}

module.exports = { buildInvoicesCsv, buildPaymentsCsv };

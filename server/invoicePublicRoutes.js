// ═══════════════════════════════════════════════════════════════════════════════
// A2 — PUBLIC INVOICE VIEW — server/invoicePublicRoutes.js
//
// The client-facing side of "Send the invoice": /i/<token> shows the branded
// invoice with a PDF download. Read-only (no accept action) — A3 adds the
// "Pay now" button here via the stripe_payment_link field. Same security
// posture as quotePublicRoutes.js: high-entropy token, constant-time compare,
// generic 404s, per-IP rate limit, builder's branding only.
//
//   GET /api/public/invoices/:token
//   GET /api/public/invoices/:token/logo
//   GET /api/public/invoices/:token/pdf
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { streamInvoicePdf, overdueState } = require('./invoicePdf');
const { rateLimit } = require('./publicRateLimit');

const router = express.Router();

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

router.use(rateLimit({ windowMs: 60_000, max: 60 }));

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function findByToken(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  const row = db.prepare('SELECT * FROM invoices WHERE public_token = ?').get(token);
  if (!row || !safeEqual(row.public_token || '', token)) return null;
  return row;
}

function getLines(invoiceId) {
  return db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order ASC, rowid ASC').all(invoiceId);
}

function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = {
      logo_filename: null, logo_mime: null,
      primary_colour: '#1B2A4A', accent_colour: '#F59E0B',
      company_name: null, company_address: null, footer_text: null,
    };
  }
  return row;
}

function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(userId);
}

router.get('/:token/logo', (req, res) => {
  try {
    const inv = findByToken(req.params.token);
    if (!inv) return res.status(404).end();
    const branding = getBranding(inv.user_id);
    if (!branding.logo_filename) return res.status(404).end();
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (!fs.existsSync(logoPath)) return res.status(404).end();
    res.setHeader('Content-Type', branding.logo_mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(logoPath).pipe(res);
  } catch (err) {
    console.error('[InvoicePublic] logo error:', err);
    if (!res.headersSent) res.status(500).end();
  }
});

router.get('/:token/pdf', (req, res) => {
  try {
    const inv = findByToken(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invoice link is invalid or has been revoked.' });
    streamInvoicePdf(res, inv, getLines(inv.id), getBranding(inv.user_id), getUserDisplay(inv.user_id));
  } catch (err) {
    console.error('[InvoicePublic] pdf error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

router.get('/:token', (req, res) => {
  try {
    const inv = findByToken(req.params.token);
    if (!inv) return res.status(404).json({ error: 'This invoice link is invalid or has been revoked.' });
    const branding = getBranding(inv.user_id);
    const user = getUserDisplay(inv.user_id);
    res.json({
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      currency: inv.currency,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      status: inv.status,
      overdue: overdueState(inv),
      paid_at: inv.paid_at,
      paid_amount: inv.paid_amount,
      notes: inv.notes,
      net_total: inv.net_total,
      discount_amount: inv.discount_amount,
      vat_pct: inv.vat_pct,
      vat_amount: inv.vat_amount,
      grand_total: inv.grand_total,
      // A3: the "Pay now" button — present only when the builder generated one.
      stripe_payment_link: inv.stripe_payment_link || null,
      lines: getLines(inv.id).map(l => ({
        section: l.section, item: l.item, description: l.description,
        unit: l.unit, qty: l.qty, rate: l.rate, line_total: l.line_total,
      })),
      company: {
        name: branding.company_name || user?.company || user?.full_name || null,
        address: branding.company_address,
        footer_text: branding.footer_text,
        primary_colour: branding.primary_colour,
        accent_colour: branding.accent_colour,
        has_logo: !!branding.logo_filename,
      },
    });
  } catch (err) {
    console.error('[InvoicePublic] get error:', err);
    res.status(500).json({ error: 'Failed to load.' });
  }
});

module.exports = router;

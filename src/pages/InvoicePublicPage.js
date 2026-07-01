import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { LinkIcon, CheckCircleIcon } from '../components/Icons';

// Public invoice page — /i/<token>. What the builder's client opens from the
// email or WhatsApp link. Read-only: see the invoice, download the PDF and —
// when the builder generated a payment link (A3) — pay online. Renders the
// builder's branding, mobile-first.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  return sym + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB'); } catch (e) { return d; }
}

function colours(brand) {
  return {
    bg: '#F8FAFC', card: '#FFFFFF', text: '#111827',
    textSecondary: '#475569', textMuted: '#94A3B8', border: '#E2E8F0',
    primary: brand?.primary_colour || '#1B2A4A',
    accent: brand?.accent_colour || '#F59E0B',
    success: '#10B981', successBg: '#ECFDF5',
    danger: '#EF4444', dangerBg: '#FEF2F2',
  };
}

export default function InvoicePublicPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showLines, setShowLines] = useState(false);

  const base = '/api/public/invoices/' + encodeURIComponent(token);

  const load = useCallback(async () => {
    try {
      const r = await fetch(base);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Unable to load.');
      setData(body);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [base]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', color: '#94A3B8' }}>Loading…</div>;
  }
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: 16 }}>
        <div style={{ maxWidth: 420, padding: 32, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, textAlign: 'center', color: '#111827' }}>
          <div style={{ marginBottom: 8 }}><LinkIcon size={32} /></div>
          <h2 style={{ margin: 0, fontSize: 20 }}>This invoice link isn't working</h2>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 12 }}>
            {error || 'Ask whoever sent it to send you a fresh link.'}
          </p>
        </div>
      </div>
    );
  }

  const c = colours(data.company);
  const cc = data.currency || 'GBP';
  const company = data.company || {};
  const paid = data.status === 'paid';
  const canPay = !paid && data.status !== 'void' && data.stripe_payment_link;

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, paddingBottom: canPay ? 96 : 24 }}>
      {/* Brand band */}
      <div style={{ background: c.primary, padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {company.has_logo && (
          <img src={base + '/logo'} alt="" style={{ height: 40, maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2 }} />
        )}
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{company.name || 'Invoice'}</div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 0' }}>
        {paid && (
          <div style={{ background: c.successBg, border: '1px solid ' + c.success, borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: c.success }}><CheckCircleIcon size={22} /></span>
            <div style={{ fontWeight: 700, color: '#065F46' }}>
              This invoice is paid{data.paid_at ? ' — ' + fmtDate(data.paid_at.slice(0, 10)) : ''}. Thank you.
            </div>
          </div>
        )}
        {data.overdue && (
          <div style={{ background: c.dangerBg, border: '1px solid ' + c.danger, borderRadius: 12, padding: 14, marginBottom: 16, color: '#7F1D1D', fontWeight: 600, fontSize: 14 }}>
            This invoice was due on {fmtDate(data.due_date)} and is now overdue.
          </div>
        )}

        {/* Big number */}
        <div style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, padding: 20, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ color: c.textSecondary, fontSize: 13 }}>{paid ? 'Amount paid' : 'Amount due'}</div>
          <div style={{ fontSize: 34, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {fmt(paid && num(data.paid_amount) > 0 ? data.paid_amount : data.grand_total, cc)}
          </div>
          <div style={{ color: c.textMuted, fontSize: 13, marginTop: 6 }}>
            Invoice {data.invoice_number}
            {data.client_name ? ' · for ' + data.client_name : ''}
          </div>
          <div style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>
            Issued {fmtDate(data.issue_date)}{!paid && data.due_date ? ' · due by ' + fmtDate(data.due_date) : ''}
          </div>
        </div>

        {/* Breakdown */}
        <div style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <button onClick={() => setShowLines(s => !s)} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
            minHeight: 48, padding: '12px 18px', background: 'transparent', border: 'none',
            fontSize: 15, fontWeight: 700, color: c.text, cursor: 'pointer', textAlign: 'left',
          }}>
            <span><span style={{ color: c.accent, marginRight: 8 }}>{showLines ? '▾' : '▸'}</span>What's on this invoice</span>
          </button>
          {showLines && (data.lines || []).map((ln, i) => (
            <div key={i} style={{ padding: '10px 18px 10px 34px', borderTop: '1px dashed ' + c.border, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0, wordBreak: 'break-word' }}>{ln.item || ln.description}</div>
                <div style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(ln.line_total, cc)}</div>
              </div>
              {ln.item && ln.description && <div style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>{ln.description}</div>}
            </div>
          ))}
          <div style={{ padding: '12px 18px', borderTop: '1px solid ' + c.border }}>
            <Row c={c} label="Total before VAT" value={fmt(Math.max(0, num(data.net_total) - num(data.discount_amount)), cc)} />
            {num(data.discount_amount) > 0 && <Row c={c} label="Including discount" value={'−' + fmt(data.discount_amount, cc)} />}
            {num(data.vat_amount) > 0 && <Row c={c} label={'VAT (' + num(data.vat_pct).toFixed(0) + '%)'} value={fmt(data.vat_amount, cc)} />}
            <div style={{ borderTop: '2px solid ' + c.primary, marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
              <span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(data.grand_total, cc)}</span>
            </div>
          </div>
        </div>

        {/* How to pay */}
        {!paid && data.notes && (
          <div style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>How to pay</div>
            <div style={{ color: c.textSecondary, fontSize: 14, whiteSpace: 'pre-line' }}>{data.notes}</div>
          </div>
        )}

        <a href={base + '/pdf'} target="_blank" rel="noopener" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48,
          borderRadius: 10, border: '1px solid ' + c.border, background: c.card, color: c.text,
          fontSize: 15, fontWeight: 600, textDecoration: 'none', marginBottom: 16,
        }}>Download this invoice (PDF)</a>

        <div style={{ textAlign: 'center', color: c.textMuted, fontSize: 12, padding: '8px 0 24px' }}>
          {company.footer_text || (company.name ? 'Invoice from ' + company.name : '')}
          {company.address ? <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>{company.address}</div> : null}
        </div>
      </div>

      {/* Sticky pay bar — only when the builder generated a payment link */}
      {canPay && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          background: c.card, borderTop: '1px solid ' + c.border, boxShadow: '0 -4px 16px rgba(15,23,42,0.08)',
        }}>
          <a href={data.stripe_payment_link} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', maxWidth: 560, margin: '0 auto', minHeight: 52, boxSizing: 'border-box',
            borderRadius: 12, background: c.success, color: '#fff',
            fontSize: 17, fontWeight: 700, textDecoration: 'none',
          }}>Pay now — {fmt(data.grand_total, cc)}</a>
        </div>
      )}
    </div>
  );
}

function Row({ c, label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: c.textSecondary, padding: '3px 0' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: c.text }}>{value}</span>
    </div>
  );
}

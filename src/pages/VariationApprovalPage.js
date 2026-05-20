import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';

// Public-facing approval page. No auth, no estimator gate. Anyone with the
// shareable /v/<token> URL can view + approve/decline. The server captures
// IP, name, signature, timestamp from this request to form the audit trail.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  return sym + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Self-contained palette — this page renders before the user is logged in, so
// it doesn't rely on the in-app ThemeContext. Uses the builder's brand colours
// from the variation payload (company.primary_colour / accent_colour).
function colours(brand) {
  return {
    bg: '#F8FAFC',
    card: '#FFFFFF',
    text: '#111827',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    border: '#E2E8F0',
    primary: brand?.primary_colour || '#1B2A4A',
    accent: brand?.accent_colour || '#F59E0B',
    success: '#10B981',
    successBg: '#ECFDF5',
    danger: '#EF4444',
    dangerBg: '#FEF2F2',
    warning: '#F59E0B',
    warningBg: '#FFFBEB',
  };
}

export default function VariationApprovalPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Approval form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [signature, setSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Decline form
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/variations/' + encodeURIComponent(token));
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Unable to load.');
      setData(body);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const approve = async (e) => {
    if (e) e.preventDefault();
    if (!name.trim()) return setError('Please enter your name.');
    if (!signature.trim()) return setError('Please type your name as a signature.');
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/public/variations/' + encodeURIComponent(token) + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), signature: signature.trim() }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed.');
      await load();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const decline = async (e) => {
    if (e) e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/public/variations/' + encodeURIComponent(token) + '/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed.');
      await load();
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', color: '#94A3B8' }}>Loading…</div>;
  }
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
        <div style={{ maxWidth: 460, padding: 32, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, textAlign: 'center', color: '#111827' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔗</div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Link not found</h2>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 12 }}>{error || 'This approval link is invalid or has been revoked.'}</p>
        </div>
      </div>
    );
  }

  const c = colours(data.company);
  const cc = data.currency || 'GBP';
  const company = data.company || {};
  const job = data.job || {};
  const decided = data.status === 'approved' || data.status === 'declined';
  const logoUrl = company.has_logo ? '/api/public/variations/' + encodeURIComponent(token) + '/logo' : null;

  return (
    <div style={{ minHeight: '100vh', background: c.bg, padding: '24px 16px', color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        {/* Header band */}
        <div style={{ background: c.primary, borderRadius: '12px 12px 0 0', padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoUrl && <img src={logoUrl} alt="" style={{ maxHeight: 56, maxWidth: 140, background: '#fff', padding: 4, borderRadius: 6 }} onError={(e) => { e.target.style.display = 'none'; }} />}
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{company.name || 'Contractor'}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{company.address}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right', color: '#fff' }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Variation</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{data.vo_number}</div>
          </div>
        </div>

        {/* Status banner */}
        {data.status === 'approved' && (
          <div style={{ background: c.success, color: '#fff', padding: '10px 28px', fontSize: 13, fontWeight: 600 }}>
            ✓ Approved by {data.approval_name} on {data.approval_at}
          </div>
        )}
        {data.status === 'declined' && (
          <div style={{ background: c.danger, color: '#fff', padding: '10px 28px', fontSize: 13, fontWeight: 600 }}>
            ✗ Declined on {data.decline_at}
          </div>
        )}

        <div style={{ background: c.card, border: '1px solid ' + c.border, borderTop: 'none', borderRadius: '0 0 12px 12px', padding: 28 }}>
          {/* Job + title */}
          <h1 style={{ margin: 0, fontSize: 22, color: c.text }}>{data.title || 'Change order'}</h1>
          {job.name && <div style={{ color: c.textSecondary, fontSize: 14, marginTop: 6 }}>Job: {job.name}{job.client_name ? ' · ' + job.client_name : ''}</div>}
          {data.reason && (
            <div style={{ marginTop: 12, padding: 12, background: c.bg, borderRadius: 8, border: '1px solid ' + c.border, fontSize: 14, color: c.text }}>
              <div style={{ color: c.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Reason for change</div>
              {data.reason}
            </div>
          )}

          {/* Lines table */}
          <div style={{ marginTop: 20, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: c.primary, color: '#fff' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Description</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', width: 60 }}>Qty</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', width: 60 }}>Unit</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', width: 100 }}>Rate</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', width: 110 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((ln, i) => (
                  <tr key={i} style={{ borderTop: '1px solid ' + c.border }}>
                    <td style={{ padding: '10px' }}>
                      {ln.item && <div style={{ fontWeight: 600 }}>{ln.item}</div>}
                      <div style={{ color: c.textSecondary, fontSize: 12 }}>{ln.description}</div>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{ln.qty}</td>
                    <td style={{ padding: '10px' }}>{ln.unit}</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(ln.rate, cc)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(ln.line_total, cc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ minWidth: 260, border: '1px solid ' + c.border, borderRadius: 8, padding: 16 }}>
              <Row c={c} label="Net" value={fmt(data.net_total, cc)} />
              <Row c={c} label={'OH&P (' + num(data.ohp_pct).toFixed(1) + '%)'} value={fmt(data.ohp_amount, cc)} />
              <Row c={c} label={'VAT (' + num(data.vat_pct).toFixed(1) + '%)'} value={fmt(data.vat_amount, cc)} />
              <div style={{ borderTop: '1px solid ' + c.border, margin: '8px 0' }} />
              <Row c={c} label="Grand Total" value={fmt(data.grand_total, cc)} bold />
            </div>
          </div>

          {data.notes && (
            <div style={{ marginTop: 20, padding: 12, background: c.bg, borderRadius: 8, fontSize: 13, color: c.text }}>
              <div style={{ color: c.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Notes</div>
              {data.notes}
            </div>
          )}

          {/* Action area */}
          {error && <div style={{ marginTop: 16, padding: 10, background: c.dangerBg, color: c.danger, borderRadius: 8 }}>{error}</div>}

          {!decided && !showDecline && (
            <form onSubmit={approve} style={{ marginTop: 24, padding: 20, background: c.bg, borderRadius: 8, border: '1px solid ' + c.border }}>
              <h3 style={{ margin: 0, fontSize: 15, color: c.text }}>Approve this change</h3>
              <div style={{ color: c.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 12 }}>
                By approving, you confirm the change above and agree it forms part of the contract. We record your name, the time, and your IP address as the audit record.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', color: c.textSecondary, fontSize: 12, marginBottom: 4 }}>Your name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} required style={fld(c)} />
                </div>
                <div>
                  <label style={{ display: 'block', color: c.textSecondary, fontSize: 12, marginBottom: 4 }}>Email (optional)</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={fld(c)} />
                </div>
              </div>
              <label style={{ display: 'block', color: c.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 4 }}>Type your name as signature *</label>
              <input value={signature} onChange={e => setSignature(e.target.value)} required style={{ ...fld(c), fontFamily: 'Brush Script MT, cursive', fontSize: 18, fontStyle: 'italic' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <button type="submit" disabled={submitting} style={{ background: c.success, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer' }}>{submitting ? 'Recording…' : 'Approve change'}</button>
                <button type="button" onClick={() => setShowDecline(true)} style={{ background: 'transparent', color: c.danger, border: '1px solid ' + c.danger, borderRadius: 8, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>Decline</button>
              </div>
            </form>
          )}

          {!decided && showDecline && (
            <form onSubmit={decline} style={{ marginTop: 24, padding: 20, background: c.dangerBg, borderRadius: 8, border: '1px solid ' + c.danger + '44' }}>
              <h3 style={{ margin: 0, fontSize: 15, color: c.danger }}>Decline this change</h3>
              <label style={{ display: 'block', color: c.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 4 }}>Reason (optional)</label>
              <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3} style={{ ...fld(c), resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="submit" disabled={submitting} style={{ background: c.danger, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer' }}>Confirm decline</button>
                <button type="button" onClick={() => setShowDecline(false)} style={{ background: 'transparent', color: c.text, border: '1px solid ' + c.border, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          )}

          {data.status === 'approved' && (
            <div style={{ marginTop: 24, padding: 20, background: c.successBg, borderRadius: 8, border: '1px solid ' + c.success + '44', color: c.text }}>
              <h3 style={{ margin: 0, fontSize: 15, color: c.success }}>Approved</h3>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                <strong>{data.approval_name}</strong> approved this change on {data.approval_at}.
                <br />Signed: <span style={{ fontStyle: 'italic' }}>{data.approval_signature}</span>
              </div>
              <div style={{ fontSize: 12, color: c.textSecondary, marginTop: 8 }}>This change now forms part of the contract.</div>
            </div>
          )}

          {data.status === 'declined' && (
            <div style={{ marginTop: 24, padding: 20, background: c.dangerBg, borderRadius: 8, border: '1px solid ' + c.danger + '44', color: c.text }}>
              <h3 style={{ margin: 0, fontSize: 15, color: c.danger }}>Declined</h3>
              {data.decline_reason && <div style={{ fontSize: 13, marginTop: 8 }}>Reason: {data.decline_reason}</div>}
            </div>
          )}

          {company.footer_text && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid ' + c.border, fontSize: 11, color: c.textMuted, textAlign: 'center' }}>
              {company.footer_text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ c, label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 15 : 13, color: c.text }}>
      <div style={{ color: bold ? c.text : c.textSecondary }}>{label}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function fld(c) {
  return { width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid ' + c.border, color: c.text, borderRadius: 6, padding: '10px 12px', fontSize: 14, outline: 'none' };
}

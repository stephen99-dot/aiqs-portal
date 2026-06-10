import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { LinkIcon, CheckCircleIcon } from '../components/Icons';

// Public quote acceptance page — /q/<token>. No auth, no estimator gate.
// This is what the BUILDER'S CLIENT sees on their phone, so it renders the
// builder's branding (never AI QS) and is written in plain English.
// Mobile-first: single column, sticky "Accept this quote" bar, collapsible
// price sections, tap targets >= 44px.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  return sym + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Self-contained palette — the viewer is never logged in, so no ThemeContext.
// Brand colours come from the quote payload (company.primary/accent_colour).
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
  };
}

export default function QuoteAcceptancePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Accept sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [signature, setSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [justAccepted, setJustAccepted] = useState(false);

  // Question box
  const [askOpen, setAskOpen] = useState(false);
  const [qName, setQName] = useState('');
  const [qMessage, setQMessage] = useState('');
  const [qSent, setQSent] = useState(false);

  // Which price sections are expanded
  const [openSections, setOpenSections] = useState({});

  const base = '/api/public/quotes/' + encodeURIComponent(token);

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

  const accept = async (e) => {
    if (e) e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Please enter your name.');
    if (!signature.trim()) return setError('Please type your name to sign.');
    setSubmitting(true);
    try {
      const r = await fetch(base + '/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), signature: signature.trim() }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed.');
      setJustAccepted(true);
      setSheetOpen(false);
      await load();
    } catch (e2) { setError(e2.message); }
    finally { setSubmitting(false); }
  };

  const ask = async (e) => {
    if (e) e.preventDefault();
    setError('');
    if (!qName.trim()) return setError('Please enter your name.');
    if (!qMessage.trim()) return setError('Please type your question.');
    setSubmitting(true);
    try {
      const r = await fetch(base + '/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: qName.trim(), message: qMessage.trim() }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed.');
      setQSent(true);
      setAskOpen(false);
    } catch (e2) { setError(e2.message); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', color: '#94A3B8' }}>Loading…</div>;
  }
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: 16 }}>
        <div style={{ maxWidth: 420, padding: 32, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, textAlign: 'center', color: '#111827' }}>
          <div style={{ marginBottom: 8 }}><LinkIcon size={32} /></div>
          <h2 style={{ margin: 0, fontSize: 20 }}>This quote link isn't working</h2>
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
  const accepted = data.status === 'accepted';

  // Group lines by section, preserving order.
  const sections = [];
  const bySection = {};
  for (const ln of (data.lines || [])) {
    const s = ln.section || 'Works';
    if (!bySection[s]) { bySection[s] = { name: s, lines: [], total: 0 }; sections.push(bySection[s]); }
    bySection[s].lines.push(ln);
    bySection[s].total += num(ln.line_total);
  }

  const input = {
    width: '100%', boxSizing: 'border-box', minHeight: 48, padding: '12px 14px',
    borderRadius: 10, border: '1px solid ' + c.border, fontSize: 16, color: c.text,
    background: '#fff',
  };
  const label = { display: 'block', fontSize: 13, fontWeight: 600, color: c.textSecondary, marginBottom: 6, marginTop: 14 };

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, paddingBottom: accepted ? 24 : 96 }}>
      {/* Brand band */}
      <div style={{ background: c.primary, padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {company.has_logo && (
          <img src={base + '/logo'} alt="" style={{ height: 40, maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 2 }} />
        )}
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{company.name || 'Quotation'}</div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 0' }}>
        {/* Accepted / just accepted banner */}
        {accepted && (
          <div style={{ background: c.successBg, border: '1px solid ' + c.success, borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: c.success, flexShrink: 0, marginTop: 2 }}><CheckCircleIcon size={22} /></span>
            <div>
              <div style={{ fontWeight: 700, color: '#065F46' }}>
                {justAccepted ? 'Done — this quote is accepted' : 'This quote has been accepted'}
              </div>
              <div style={{ color: '#065F46', fontSize: 14, marginTop: 4 }}>
                {justAccepted
                  ? (company.name || 'The builder') + ' has been told. They’ll be in touch.'
                  : 'Accepted by ' + (data.acceptance_name || 'the client') + (data.accepted_at ? ' on ' + new Date(data.accepted_at).toLocaleDateString('en-GB') : '') + '.'}
              </div>
            </div>
          </div>
        )}

        {qSent && (
          <div style={{ background: c.successBg, border: '1px solid ' + c.success, borderRadius: 12, padding: 14, marginBottom: 16, color: '#065F46', fontSize: 14 }}>
            Your question has been sent to {company.name || 'the builder'} — they'll get back to you.
          </div>
        )}

        {/* Quote header */}
        <div style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{data.project_name || 'Quotation'}</div>
          {data.client_name && <div style={{ color: c.textSecondary, fontSize: 14, marginTop: 4 }}>Prepared for {data.client_name}</div>}
          <div style={{ color: c.textMuted, fontSize: 13, marginTop: 6 }}>
            {data.quote_number}{data.created_at ? ' · ' + new Date(data.created_at).toLocaleDateString('en-GB') : ''}
          </div>
        </div>

        {/* Price breakdown */}
        <div style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '14px 18px', fontWeight: 700, fontSize: 15, borderBottom: '1px solid ' + c.border }}>Price breakdown</div>
          {sections.map(sec => {
            const open = !!openSections[sec.name];
            return (
              <div key={sec.name} style={{ borderBottom: '1px solid ' + c.border }}>
                <button
                  onClick={() => setOpenSections(s => ({ ...s, [sec.name]: !open }))}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                    minHeight: 48, padding: '12px 18px', background: 'transparent', border: 'none',
                    fontSize: 15, color: c.text, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    <span style={{ color: c.accent, marginRight: 8 }}>{open ? '▾' : '▸'}</span>{sec.name}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(sec.total, cc)}</span>
                </button>
                {open && sec.lines.map((ln, i) => (
                  <div key={i} style={{ padding: '10px 18px 10px 34px', borderTop: '1px dashed ' + c.border, fontSize: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ color: c.text }}>{ln.item || ln.description}</div>
                      <div style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(ln.line_total, cc)}</div>
                    </div>
                    {ln.item && ln.description && <div style={{ color: c.textMuted, fontSize: 13, marginTop: 2 }}>{ln.description}</div>}
                    <div style={{ color: c.textMuted, fontSize: 12, marginTop: 2 }}>{num(ln.qty)} {ln.unit} × {fmt(ln.rate, cc)}</div>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Totals — plain English, no trade abbreviations */}
          <div style={{ padding: '14px 18px' }}>
            <TotalRow label="Works total" value={fmt(data.net_total, cc)} c={c} />
            {num(data.ohp_amount) > 0 && (
              <TotalRow label={'Overheads & profit (' + num(data.ohp_pct).toFixed(0) + '%)'} value={fmt(data.ohp_amount, cc)} c={c} />
            )}
            {num(data.contingency_amount) > 0 && (
              <TotalRow label={'Contingency (' + num(data.contingency_pct).toFixed(0) + '%)'} value={fmt(data.contingency_amount, cc)} c={c} />
            )}
            {num(data.vat_amount) > 0 && (
              <TotalRow label={'VAT (' + num(data.vat_pct).toFixed(0) + '%)'} value={fmt(data.vat_amount, cc)} c={c} />
            )}
            <div style={{ borderTop: '2px solid ' + c.primary, marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(data.grand_total, cc)}</span>
            </div>
          </div>
        </div>

        {/* Secondary actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <a href={base + '/pdf'} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48,
            borderRadius: 10, border: '1px solid ' + c.border, background: c.card, color: c.text,
            fontSize: 15, fontWeight: 600, textDecoration: 'none',
          }}>Download this quote (PDF)</a>
          {!accepted && (
            <button onClick={() => { setAskOpen(o => !o); setError(''); }} style={{
              minHeight: 48, borderRadius: 10, border: '1px solid ' + c.border, background: c.card,
              color: c.text, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>Ask a question</button>
          )}
        </div>

        {/* Question form */}
        {askOpen && !accepted && (
          <form onSubmit={ask} style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Ask {company.name || 'the builder'} a question</div>
            <label style={label}>Your name</label>
            <input style={input} value={qName} onChange={e => setQName(e.target.value)} autoComplete="name" />
            <label style={label}>Your question</label>
            <textarea style={{ ...input, minHeight: 96, resize: 'vertical' }} value={qMessage} onChange={e => setQMessage(e.target.value)} placeholder="e.g. Does the price include the skip hire?" />
            {error && <div style={{ background: c.dangerBg, color: c.danger, padding: 10, borderRadius: 8, marginTop: 12, fontSize: 14 }}>{error}</div>}
            <button type="submit" disabled={submitting} style={{
              width: '100%', minHeight: 48, marginTop: 14, borderRadius: 10, border: 'none',
              background: c.primary, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}>{submitting ? 'Sending…' : 'Send the question'}</button>
          </form>
        )}

        {/* Builder footer */}
        <div style={{ textAlign: 'center', color: c.textMuted, fontSize: 12, padding: '8px 0 24px' }}>
          {company.footer_text || (company.name ? 'Quotation from ' + company.name : '')}
          {company.address ? <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>{company.address}</div> : null}
        </div>
      </div>

      {/* Sticky accept bar */}
      {!accepted && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          background: c.card, borderTop: '1px solid ' + c.border, boxShadow: '0 -4px 16px rgba(15,23,42,0.08)',
        }}>
          <button onClick={() => { setSheetOpen(true); setError(''); }} style={{
            display: 'block', width: '100%', maxWidth: 560, margin: '0 auto', minHeight: 52,
            borderRadius: 12, border: 'none', background: c.success, color: '#fff',
            fontSize: 17, fontWeight: 700, cursor: 'pointer',
          }}>Accept this quote — {fmt(data.grand_total, cc)}</button>
        </div>
      )}

      {/* Accept sheet */}
      {sheetOpen && !accepted && (
        <div onClick={() => setSheetOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <form onSubmit={accept} onClick={e => e.stopPropagation()} style={{
            background: c.card, width: '100%', maxWidth: 560, borderRadius: '16px 16px 0 0',
            padding: '20px 20px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Accept this quote</div>
            <div style={{ color: c.textSecondary, fontSize: 14, marginTop: 4 }}>
              Typing your name below counts as your signature. {company.name || 'The builder'} will be told straight away.
            </div>
            <label style={label}>Your name</label>
            <input style={input} value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
            <label style={label}>Type your name to sign</label>
            <input style={input} value={signature} onChange={e => setSignature(e.target.value)} placeholder={name || 'Your name'} />
            <label style={label}>Email <span style={{ fontWeight: 400, color: c.textMuted }}>(optional — for your records)</span></label>
            <input style={input} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            {error && <div style={{ background: c.dangerBg, color: c.danger, padding: 10, borderRadius: 8, marginTop: 12, fontSize: 14 }}>{error}</div>}
            <button type="submit" disabled={submitting} style={{
              width: '100%', minHeight: 52, marginTop: 16, borderRadius: 12, border: 'none',
              background: c.success, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}>{submitting ? 'One moment…' : 'Yes — accept this quote'}</button>
            <button type="button" onClick={() => setSheetOpen(false)} style={{
              width: '100%', minHeight: 44, marginTop: 8, borderRadius: 12, border: 'none',
              background: 'transparent', color: c.textSecondary, fontSize: 14, cursor: 'pointer',
            }}>Not yet</button>
          </form>
        </div>
      )}
    </div>
  );
}

function TotalRow({ label, value, c }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: c.textSecondary, padding: '4px 0' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: c.text }}>{value}</span>
    </div>
  );
}

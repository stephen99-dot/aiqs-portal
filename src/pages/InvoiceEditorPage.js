import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import ShareLinkModal from '../components/ShareLinkModal';

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmt(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// A4 — first guess at whether a line is labour (CIS deducts from labour only).
// Always editable line by line; this only sets the starting point.
const LABOUR_RX = /labour|labor|day ?rate|hourly|hours?\b|man[- ]?day|install|fitting|fix(ing)?\b|supervis|attendance|demolit|excavat|groundwork|brickwork|plaster|render|paint|decorat|tiling|joinery|carpentr|making good/i;
function fmt0(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

export default function InvoiceEditorPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const { id } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  // /invoices/:id?chase=1 — the Today screen's "Chase it" lands here and the
  // chase modal opens by itself.
  const chaseRequested = useRef(searchParams.get('chase') === '1');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Header form fields
  const [client, setClient] = useState({ name: '', email: '', address: '' });
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState(30);
  const [vatPct, setVatPct] = useState(20);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [stripeLink, setStripeLink] = useState('');
  const [share, setShare] = useState(null);   // { url, emailedTo } after sending
  const [sending, setSending] = useState(false);
  const [reminders, setReminders] = useState(true);
  // A4 — UK compliance
  const [cisApplies, setCisApplies] = useState(false);
  const [cisRate, setCisRate] = useState(20);
  const [reverseCharge, setReverseCharge] = useState(false);
  const [clientVatNumber, setClientVatNumber] = useState('');
  // A3 chase modal: null | { loading } | { subject, body, canEmail, clientEmail }
  const [chase, setChase] = useState(null);
  const [chaseSending, setChaseSending] = useState(false);
  const [chaseDone, setChaseDone] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/invoices/' + id);
      setInvoice(r.invoice);
      setClient({ name: r.invoice.client_name || '', email: r.invoice.client_email || '', address: r.invoice.client_address || '' });
      setIssueDate(r.invoice.issue_date || '');
      setDueDate(r.invoice.due_date || '');
      setPaymentTerms(num(r.invoice.payment_terms_days, 30));
      setVatPct(num(r.invoice.vat_pct, 20));
      setDiscount(num(r.invoice.discount_amount));
      setNotes(r.invoice.notes || '');
      setStripeLink(r.invoice.stripe_payment_link || '');
      setReminders(r.invoice.reminders_enabled !== 0);
      setCisApplies(!!r.invoice.cis_applies);
      setCisRate(num(r.invoice.cis_rate, 20));
      setReverseCharge(!!r.invoice.reverse_charge);
      setClientVatNumber(r.invoice.client_vat_number || '');
      setLines(r.lines || []);
      setDirty(false);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let net = 0;
    let labour = 0;
    for (const ln of lines) {
      const lt = num(ln.qty) * num(ln.rate);
      net += lt;
      if (ln.is_labour) labour += lt;
    }
    const beforeVat = Math.max(0, net - num(discount));
    const vat = reverseCharge ? 0 : beforeVat * (num(vatPct) / 100);
    const grand = beforeVat + vat;
    const deduction = cisApplies ? labour * (num(cisRate, 20) / 100) : 0;
    return { net, vat, grand, labour, deduction, netPayable: grand - deduction };
  }, [lines, vatPct, discount, reverseCharge, cisApplies, cisRate]);

  const readOnly = invoice?.status === 'paid' || invoice?.status === 'void';

  const updateLine = (idx, patch) => { setLines(prev => prev.map((ln, i) => i === idx ? { ...ln, ...patch } : ln)); setDirty(true); };

  // Turning CIS on guesses labour vs materials from each line's wording —
  // the builder can change any line with the picker that appears.
  const toggleCis = (on) => {
    setCisApplies(on);
    if (on) {
      setLines(prev => prev.map(ln => ln.is_labour
        ? ln
        : { ...ln, is_labour: LABOUR_RX.test((ln.item || '') + ' ' + (ln.description || '')) ? 1 : 0 }));
    }
    setDirty(true);
  };
  const deleteLine = (idx) => { setLines(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };
  const addLine = () => { setLines(prev => [...prev, { description: '', unit: 'item', qty: 1, rate: 0, sort_order: prev.length }]); setDirty(true); };
  const onHeaderChange = () => setDirty(true);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await apiFetch('/invoices/' + id, {
        method: 'PATCH',
        body: JSON.stringify({
          client_name: client.name, client_email: client.email, client_address: client.address,
          issue_date: issueDate, due_date: dueDate, payment_terms_days: num(paymentTerms),
          vat_pct: num(vatPct), discount_amount: num(discount), notes,
          cis_applies: cisApplies ? 1 : 0, cis_rate: num(cisRate, 20),
          reverse_charge: reverseCharge ? 1 : 0, client_vat_number: clientVatNumber || null,
        }),
      });
      await apiFetch('/invoices/' + id + '/lines', {
        method: 'PUT',
        body: JSON.stringify({ lines }),
      });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  // Save any edits first, then send: emails the client when the server has
  // SMTP + a client email, and always opens the share sheet with the /i/ link.
  const send = async () => {
    setSending(true); setError('');
    try {
      if (dirty) await save();
      const r = await apiFetch('/invoices/' + id + '/send', { method: 'POST' });
      setShare({ url: window.location.origin + r.path, emailedTo: r.emailed_to });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };

  // Re-open the share sheet for an already-sent invoice.
  const shareLink = async () => {
    try {
      const r = await apiFetch('/invoices/' + id + '/share-url');
      setShare({ url: window.location.origin + r.path, emailedTo: null });
    } catch (e) { setError(e.message); }
  };

  const markPaid = async () => {
    if (!window.confirm('Mark this invoice as paid? This locks the invoice.')) return;
    try {
      await apiFetch('/invoices/' + id + '/mark-paid', { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (e) { setError(e.message); }
  };

  const voidIt = async () => {
    if (!window.confirm('Void this invoice? It stays for audit but stops counting in totals.')) return;
    try {
      await apiFetch('/invoices/' + id + '/void', { method: 'POST' });
      await load();
    } catch (e) { setError(e.message); }
  };

  const remove = async () => {
    if (!window.confirm('Delete this invoice?')) return;
    try {
      await apiFetch('/invoices/' + id, { method: 'DELETE' });
      nav('/money');
    } catch (e) { setError(e.message); }
  };

  const duplicate = async () => {
    try {
      const r = await apiFetch('/invoices/' + id + '/duplicate', { method: 'POST' });
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const downloadPdf = () => {
    fetch('/api/invoices/' + id + '/pdf', {
      headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() },
    }).then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (invoice.invoice_number || 'invoice') + '.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      }).catch(e => alert(e.message));
  };

  const toggleReminders = async (on) => {
    setReminders(on);
    try {
      await apiFetch('/invoices/' + id, { method: 'PATCH', body: JSON.stringify({ reminders_enabled: on ? 1 : 0 }) });
    } catch (e) { setError(e.message); setReminders(!on); }
  };

  useEffect(() => {
    if (chaseRequested.current && invoice && invoice.status === 'sent') {
      chaseRequested.current = false;
      openChase();
    }
    // openChase is stable enough — this only ever fires once, on first load.
  }, [invoice]); // eslint-disable-line

  // A3: AI drafts the chaser, the builder reads/edits it, nothing sends itself.
  const openChase = async () => {
    setChase({ loading: true });
    setChaseDone('');
    try {
      const r = await apiFetch('/invoices/' + id + '/chase-draft', { method: 'POST' });
      setChase({ subject: r.subject, body: r.body, canEmail: r.can_email, clientEmail: r.client_email });
    } catch (e) {
      setChase(null);
      setError(e.message);
    }
  };

  const sendChase = async () => {
    setChaseSending(true); setError('');
    try {
      const r = await apiFetch('/invoices/' + id + '/chase-send', {
        method: 'POST',
        body: JSON.stringify({ subject: chase.subject, body: chase.body }),
      });
      setChaseDone('Sent to ' + r.sent_to);
      setChase(null);
    } catch (e) { setError(e.message); }
    finally { setChaseSending(false); }
  };

  const genStripeLink = async () => {
    try {
      const r = await apiFetch('/invoices/' + id + '/stripe-link', { method: 'POST' });
      setStripeLink(r.url);
    } catch (e) {
      if (e.data && e.data.code === 'STRIPE_NOT_CONFIGURED') {
        alert('Stripe is not configured on the server. Ask the admin to set STRIPE_SECRET_KEY.');
      } else {
        setError(e.message);
      }
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  if (!invoice) return <div style={{ padding: 40, color: t.danger }}>{error || 'Invoice not found.'}</div>;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <button onClick={() => nav('/money')} style={btnLink(t)}>← Money</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: '6px 0 4px 0', fontSize: 24 }}>
            {invoice.invoice_number} — {client.name || 'No client'}
          </h1>
          <div style={{ color: t.textSecondary, fontSize: 13 }}>
            <StatusPill t={t} status={invoice.status} overdue={invoice.overdue} />
            {invoice.paid_at && <span style={{ marginLeft: 8 }}>Paid {invoice.paid_at.slice(0, 10)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!readOnly && <button onClick={save} disabled={saving || !dirty} style={btnPrimary(t, saving || !dirty)}>{saving ? 'Saving…' : (dirty ? 'Save changes' : 'Saved')}</button>}
          {invoice.status === 'draft' && !readOnly && <button onClick={send} disabled={sending} style={btnPrimary(t, sending)}>{sending ? 'Sending…' : 'Send the invoice'}</button>}
          {invoice.status === 'sent' && !readOnly && <button onClick={shareLink} style={btnSecondary(t)}>Share link</button>}
          {invoice.status === 'sent' && !readOnly && (
            <button onClick={openChase} style={{ ...btnPrimary(t), background: invoice.overdue ? t.danger : t.accent }}>Chase this payment</button>
          )}
          {(invoice.status === 'sent' || invoice.status === 'draft') && !readOnly && <button onClick={markPaid} style={{ ...btnPrimary(t), background: t.success }}>Mark as paid</button>}
          <button onClick={downloadPdf} style={btnSecondary(t)}>PDF</button>
          <button onClick={duplicate} style={btnSecondary(t)}>Duplicate</button>
          {invoice.status !== 'void' && invoice.status !== 'paid' && <button onClick={voidIt} style={btnSecondary(t)}>Void</button>}
          {invoice.status !== 'paid' && <button onClick={remove} style={{ ...btnSecondary(t), color: t.danger }}>Delete</button>}
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {chaseDone && <div style={{ background: t.successBg, color: t.success, padding: 10, borderRadius: 8, marginBottom: 12 }}>{chaseDone}</div>}

      {/* Reminders toggle — visible while there's something to chase */}
      {(invoice.status === 'sent' || invoice.status === 'draft') && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={reminders} onChange={e => toggleReminders(e.target.checked)} style={{ width: 20, height: 20 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Chase this invoice automatically</div>
              <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                We'll email a polite reminder on the due date, then 7 and 14 days after — until it's marked as paid.
              </div>
            </div>
          </label>
        </div>
      )}

      {/* Stripe link panel */}
      {invoice.status !== 'paid' && invoice.status !== 'void' && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Let them pay by card</div>
              <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                Adds a "Pay now" button to the invoice your client sees. When they pay, the invoice marks itself as paid.
              </div>
            </div>
            {stripeLink ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a href={stripeLink} target="_blank" rel="noopener noreferrer" style={{ color: t.accent, fontSize: 12 }}>Open link ↗</a>
                <button onClick={() => navigator.clipboard.writeText(stripeLink)} style={btnSecondary(t)}>Copy</button>
              </div>
            ) : (
              <button onClick={genStripeLink} style={btnSecondary(t)}>Set up card payment</button>
            )}
          </div>
        </div>
      )}

      {/* Header form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Bill to</div>
          <label style={lbl(t)}>Client name</label>
          <input value={client.name} disabled={readOnly} onChange={e => { setClient({ ...client, name: e.target.value }); onHeaderChange(); }} style={fld(t)} />
          <label style={lbl(t, 12)}>Email</label>
          <input value={client.email} disabled={readOnly} onChange={e => { setClient({ ...client, email: e.target.value }); onHeaderChange(); }} style={fld(t)} />
          <label style={lbl(t, 12)}>Address</label>
          <textarea value={client.address} disabled={readOnly} onChange={e => { setClient({ ...client, address: e.target.value }); onHeaderChange(); }} rows={3} style={ta(t)} />
        </div>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Invoice details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbl(t)}>Issue date</label>
              <input type="date" value={issueDate} disabled={readOnly} onChange={e => { setIssueDate(e.target.value); onHeaderChange(); }} style={fld(t)} />
            </div>
            <div>
              <label style={lbl(t)}>Due date</label>
              <input type="date" value={dueDate} disabled={readOnly} onChange={e => { setDueDate(e.target.value); onHeaderChange(); }} style={fld(t)} />
            </div>
            <div>
              <label style={lbl(t)}>Payment terms (days)</label>
              <input type="number" step="1" value={paymentTerms} disabled={readOnly} onChange={e => { setPaymentTerms(e.target.value); onHeaderChange(); }} style={fld(t)} />
            </div>
            <div>
              <label style={lbl(t)}>VAT %</label>
              <input type="number" step="any" value={vatPct} disabled={readOnly} onChange={e => { setVatPct(e.target.value); onHeaderChange(); }} style={fld(t)} />
            </div>
            <div>
              <label style={lbl(t)}>Discount £</label>
              <input type="number" step="any" value={discount} disabled={readOnly} onChange={e => { setDiscount(e.target.value); onHeaderChange(); }} style={fld(t)} />
            </div>
          </div>
        </div>
      </div>

      {/* A4 — Tax & CIS for this invoice */}
      {!readOnly && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Tax & CIS on this invoice</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 12 }}>
            <input type="checkbox" checked={cisApplies} onChange={e => toggleCis(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>CIS applies</div>
              <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                The contractor paying you takes a deduction off the labour (never the materials). We'll split your lines and show the deduction on the invoice.
              </div>
            </div>
          </label>
          {cisApplies && (
            <div style={{ marginLeft: 30, marginBottom: 12 }}>
              <label style={lbl(t)}>Deduction rate</label>
              <select value={num(cisRate, 20)} onChange={e => { setCisRate(num(e.target.value)); onHeaderChange(); }} style={{ ...fld(t), maxWidth: 320 }}>
                <option value={20}>20% — you're verified with HMRC</option>
                <option value={30}>30% — not verified yet</option>
              </select>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={reverseCharge} onChange={e => { setReverseCharge(e.target.checked); onHeaderChange(); }} style={{ width: 20, height: 20, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>VAT reverse charge</div>
              <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                For CIS work for another VAT-registered builder: you don't charge the VAT — they pay it to HMRC. The invoice carries the official wording automatically.
              </div>
            </div>
          </label>
          {reverseCharge && (
            <div style={{ marginLeft: 30, marginTop: 10 }}>
              <label style={lbl(t)}>Customer's VAT number</label>
              <input value={clientVatNumber} onChange={e => { setClientVatNumber(e.target.value); onHeaderChange(); }} placeholder="e.g. GB123456789" style={{ ...fld(t), maxWidth: 320 }} />
            </div>
          )}
        </div>
      )}

      {/* Lines */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ background: t.surface, fontSize: 12, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <th style={{ ...th, width: cisApplies ? '40%' : '50%' }}>Description</th>
                {cisApplies && <th style={{ ...th, width: 110 }}>Labour or materials?</th>}
                <th style={{ ...th, width: 70, textAlign: 'right' }}>Qty</th>
                <th style={{ ...th, width: 70 }}>Unit</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>Rate</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>Total</th>
                {!readOnly && <th style={{ ...th, width: 40 }}></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, idx) => {
                const lineTotal = num(ln.qty) * num(ln.rate);
                return (
                  <tr key={idx} style={{ borderTop: '1px solid ' + t.border }}>
                    <td style={tdCell}>
                      {readOnly ? (
                        <>
                          {ln.item && <div style={{ fontWeight: 600 }}>{ln.item}</div>}
                          <div style={{ color: t.textSecondary, fontSize: 12 }}>{ln.description}</div>
                        </>
                      ) : (
                        <>
                          <input value={ln.item || ''} onChange={e => updateLine(idx, { item: e.target.value })} placeholder="Item (optional)" style={inputInline(t, true)} />
                          <input value={ln.description || ''} onChange={e => updateLine(idx, { description: e.target.value })} placeholder="Description" style={inputInline(t)} />
                        </>
                      )}
                    </td>
                    {cisApplies && (
                      <td style={tdCell}>
                        {readOnly ? (ln.is_labour ? 'Labour' : 'Materials') : (
                          <select value={ln.is_labour ? 1 : 0} onChange={e => updateLine(idx, { is_labour: num(e.target.value) })} style={{ ...inputInline(t), border: '1px solid ' + t.border }}>
                            <option value={1}>Labour</option>
                            <option value={0}>Materials</option>
                          </select>
                        )}
                      </td>
                    )}
                    <td style={{ ...tdCell, textAlign: 'right' }}>
                      {readOnly ? num(ln.qty) : <input type="number" step="any" value={ln.qty} onChange={e => updateLine(idx, { qty: e.target.value })} style={inputNum(t)} />}
                    </td>
                    <td style={tdCell}>
                      {readOnly ? (ln.unit || '') : <input value={ln.unit || ''} onChange={e => updateLine(idx, { unit: e.target.value })} style={inputInline(t)} />}
                    </td>
                    <td style={{ ...tdCell, textAlign: 'right' }}>
                      {readOnly ? fmt(ln.rate) : <input type="number" step="any" value={ln.rate} onChange={e => updateLine(idx, { rate: e.target.value })} style={inputNum(t)} />}
                    </td>
                    <td style={{ ...tdCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(lineTotal)}</td>
                    {!readOnly && <td style={{ ...tdCell, textAlign: 'center' }}><button onClick={() => deleteLine(idx)} style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>×</button></td>}
                  </tr>
                );
              })}
              {!readOnly && (
                <tr>
                  <td colSpan={cisApplies ? 7 : 6} style={{ padding: 12, borderTop: '1px solid ' + t.border }}>
                    <button onClick={addLine} style={btnGhost(t)}>+ Add line</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {share && (
        <ShareLinkModal
          t={t}
          url={share.url}
          title={share.emailedTo ? ('Emailed to ' + share.emailedTo) : 'Send the invoice to your client'}
          message="Here’s your invoice — you can view and download it here:"
          onClose={() => setShare(null)}
        />
      )}

      {/* A3: chase modal — the builder always sees the message before it goes */}
      {chase && (
        <div onClick={() => !chaseSending && setChase(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.card, color: t.text, width: '100%', maxWidth: 560, borderRadius: 14,
            border: '1px solid ' + t.border, padding: 20, maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Chase this payment</div>
            {chase.loading ? (
              <div style={{ color: t.textSecondary, padding: '24px 0' }}>Writing a polite chaser for you…</div>
            ) : (
              <>
                <div style={{ color: t.textSecondary, fontSize: 13, marginBottom: 14 }}>
                  Read it, change anything you like, then send it. Nothing goes without your say-so.
                </div>
                <label style={lbl(t)}>Subject</label>
                <input value={chase.subject} onChange={e => setChase({ ...chase, subject: e.target.value })} style={fld(t)} />
                <label style={lbl(t, 12)}>Message</label>
                <textarea value={chase.body} onChange={e => setChase({ ...chase, body: e.target.value })} rows={9} style={ta(t)} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                  {chase.canEmail ? (
                    <button onClick={sendChase} disabled={chaseSending} style={{ ...btnPrimary(t, chaseSending), minHeight: 44 }}>
                      {chaseSending ? 'Sending…' : 'Send it to ' + chase.clientEmail + ' (invoice attached)'}
                    </button>
                  ) : (
                    <div style={{ background: t.warningBg, color: t.warning, padding: 10, borderRadius: 8, fontSize: 13 }}>
                      {chase.clientEmail ? 'Email isn’t set up on the server — copy the message and send it by WhatsApp or text.' : 'No client email on this invoice — copy the message and send it by WhatsApp or text.'}
                    </div>
                  )}
                  <button
                    onClick={() => navigator.clipboard.writeText(chase.body).then(() => setChaseDone('Message copied — paste it into WhatsApp or a text.')).then(() => setChase(null)).catch(() => {})}
                    style={{ ...btnSecondary(t), minHeight: 44 }}
                  >Copy the message</button>
                  <button onClick={() => setChase(null)} disabled={chaseSending} style={{ background: 'transparent', border: 'none', color: t.textSecondary, fontSize: 13, cursor: 'pointer', minHeight: 36 }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Summary + notes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <label style={lbl(t)}>Payment terms / notes</label>
          <textarea value={notes} disabled={readOnly} onChange={e => { setNotes(e.target.value); onHeaderChange(); }} rows={5} placeholder="e.g. Bank: ... Sort code: ... Account: ...   Late payment interest applies per Late Payment of Commercial Debts Act." style={ta(t)} />
        </div>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <SummaryRow t={t} label="Net" value={fmt(totals.net)} />
          {num(discount) > 0 && <SummaryRow t={t} label="Discount" value={'−' + fmt(num(discount))} />}
          {reverseCharge ? (
            <SummaryRow t={t} label="VAT" value="Reverse charge" />
          ) : (
            <SummaryRow t={t} label={'VAT (' + num(vatPct).toFixed(1) + '%)'} value={fmt(totals.vat)} />
          )}
          <div style={{ borderTop: '1px solid ' + t.border, margin: '8px 0' }} />
          <SummaryRow t={t} label={cisApplies ? 'Total (gross)' : 'Amount due'} value={fmt(totals.grand)} bold={!cisApplies} />
          {cisApplies && (
            <>
              <SummaryRow t={t} label={'CIS deduction (' + num(cisRate, 20).toFixed(0) + '% of labour ' + fmt(totals.labour) + ')'} value={'−' + fmt(totals.deduction)} />
              <SummaryRow t={t} label="Net payable to you" value={fmt(totals.netPayable)} bold />
            </>
          )}
          {reverseCharge && (
            <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: t.warningBg, color: t.warning, fontSize: 12 }}>
              No VAT charged — your customer pays {fmt(Math.max(0, totals.net - num(discount)) * num(vatPct, 20) / 100)} VAT to HMRC. The invoice says so in the official words.
            </div>
          )}
          {invoice.status === 'paid' && num(invoice.paid_amount) > 0 && (
            <SummaryRow t={t} label="Paid" value={fmt(invoice.paid_amount)} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ t, status, overdue }) {
  const tone = overdue ? { bg: t.dangerBg, fg: t.danger, label: 'Overdue' }
    : status === 'paid' ? { bg: t.successBg, fg: t.success, label: 'Paid' }
    : status === 'sent' ? { bg: t.warningBg, fg: t.warning, label: 'Sent' }
    : status === 'void' ? { bg: 'rgba(148,163,184,0.15)', fg: t.textMuted, label: 'Void' }
    : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary, label: 'Draft' };
  return <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{tone.label}</span>;
}

function SummaryRow({ t, label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 16 : 14, color: t.text }}>
      <div style={{ color: bold ? t.text : t.textSecondary }}>{label}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const tdCell = { padding: '8px 10px', fontSize: 13, verticalAlign: 'top' };
function lbl(t, mt) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4, marginTop: mt || 0 }; }
function fld(t) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }; }
function ta(t)  { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }; }
function inputInline(t, bold) { return { width: '100%', background: 'transparent', border: '1px solid transparent', color: t.text, borderRadius: 4, padding: '4px 6px', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontWeight: bold ? 600 : 400 }; }
function inputNum(t)    { return { width: '100%', background: 'transparent', border: '1px solid ' + t.border, color: t.text, borderRadius: 4, padding: '4px 6px', fontSize: 13, textAlign: 'right', outline: 'none', boxSizing: 'border-box' }; }
function btnLink(t)     { return { background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer' }; }
function btnGhost(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }; }
function btnPrimary(t, disabled) { return { background: disabled ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.7 : 1 }; }
function btnSecondary(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }; }

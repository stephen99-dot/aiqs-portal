import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import HelpTip from '../components/HelpTip';

// CLIENTS — the builder's customer book. Records build themselves: every job,
// quote or invoice that names a customer creates/updates one. Each card rolls
// up the money story for that customer (quoted, invoiced, owed) and links to
// their jobs.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt0(n) { return '£' + Math.round(num(n)).toLocaleString('en-GB'); }

export default function ClientsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [clients, setClients] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', address: '' });
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null); // { client, jobs, quotes, invoices }
  const [editing, setEditing] = useState(null); // editable copy of detail.client

  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/finance/clients');
      setClients(r.clients || []);
    } catch (e) { setError(e.message); setClients([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const openClient = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); setEditing(null); return; }
    setOpenId(id); setDetail(null); setEditing(null);
    try {
      const d = await apiFetch('/finance/clients/' + id);
      setDetail(d);
      setEditing({ ...d.client });
    } catch (e) { setError(e.message); }
  };

  const addClient = async () => {
    if (!draft.name.trim()) { setError('Give the client a name.'); return; }
    try {
      await apiFetch('/finance/clients', { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ name: '', email: '', phone: '', address: '' });
      setAdding(false);
      refresh();
    } catch (e) { setError(e.message); }
  };

  const saveEdit = async () => {
    try {
      await apiFetch('/finance/clients/' + editing.id, {
        method: 'PATCH',
        body: JSON.stringify({ name: editing.name, email: editing.email, phone: editing.phone, address: editing.address, notes: editing.notes }),
      });
      refresh();
    } catch (e) { setError(e.message); }
  };

  const removeClient = async (id) => {
    if (!window.confirm('Remove this client? Their jobs, quotes and invoices stay — they just stop rolling up here.')) return;
    try {
      await apiFetch('/finance/clients/' + id, { method: 'DELETE' });
      setOpenId(null); setDetail(null);
      refresh();
    } catch (e) { setError(e.message); }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = clients || [];
    if (q) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q)
        || (c.phone || '').toLowerCase().includes(q));
    }
    // Customers who owe money float to the top, then biggest book first.
    return [...list].sort((a, b) => {
      const aOwes = num(a.owed_total) > 0 ? 1 : 0;
      const bOwes = num(b.owed_total) > 0 ? 1 : 0;
      if (aOwes !== bOwes) return bOwes - aOwes;
      return num(b.invoiced_total) - num(a.invoiced_total);
    });
  }, [clients, search]);

  const input = {
    width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 14px',
    background: t.bg, border: '1px solid ' + t.border, color: t.text,
    borderRadius: 10, fontSize: 15, outline: 'none',
  };

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>
          Clients <HelpTip t={t} title="Clients" text={"One card per customer — every job, quote and invoice that names them rolls up here automatically.\n\nCustomers who owe you money float to the top.\n\nOpen a card to see their full history, or to update their contact details."} />
        </h1>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 14 }}>{error}</div>}

      <button onClick={() => { setAdding(v => !v); setError(''); }} style={{
        minHeight: 52, width: '100%', borderRadius: 12, border: 'none', background: t.accent, color: '#fff',
        fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 14,
      }}>{adding ? 'Cancel' : '+ New client'}</button>

      {adding && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input style={input} placeholder="Name — person or company" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <input style={input} type="email" placeholder="Email (optional)" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
          <input style={input} type="tel" placeholder="Phone (optional)" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
          <input style={input} placeholder="Address (optional)" value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} />
          <button onClick={addClient} style={{ minHeight: 48, borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Save client
          </button>
        </div>
      )}

      {(clients || []).length > 5 && (
        <input style={{ ...input, marginBottom: 14 }} placeholder="Search name, email or phone" value={search} onChange={e => setSearch(e.target.value)} />
      )}

      {clients === null ? (
        <div style={{ color: t.textSecondary, padding: '20px 0' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: '22px 18px', color: t.textMuted, fontSize: 14, lineHeight: 1.6 }}>
          No clients yet. They'll appear here automatically as you create jobs, quotes and invoices — or add one now.
        </div>
      ) : visible.map(c => {
        const owes = num(c.owed_total) > 0;
        const isOpen = openId === c.id;
        return (
          <div key={c.id} style={{
            background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm,
            borderLeft: owes ? '4px solid ' + (t.danger || '#EF4444') : '1px solid ' + t.border,
            borderRadius: 12, padding: '14px 16px', marginBottom: 10,
          }}>
            <div onClick={() => openClient(c.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                {owes && <div style={{ color: t.danger, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>owes {fmt0(c.owed_total)}</div>}
              </div>
              <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2 }}>
                {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details yet'}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12.5, color: t.textSecondary, flexWrap: 'wrap' }}>
                <span>{num(c.job_count)} job{num(c.job_count) === 1 ? '' : 's'}</span>
                <span>Quoted {fmt0(c.quoted_total)}</span>
                <span>Invoiced {fmt0(c.invoiced_total)}</span>
                <span style={{ color: t.success }}>Paid {fmt0(c.paid_total)}</span>
              </div>
            </div>

            {isOpen && (
              <div style={{ borderTop: '1px solid ' + t.border, marginTop: 12, paddingTop: 12 }}>
                {detail === null || !editing ? (
                  <div style={{ color: t.textMuted, fontSize: 13 }}>Loading…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {c.phone && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <a href={'tel:' + c.phone} style={{ flex: 1, textAlign: 'center', minHeight: 42, lineHeight: '42px', borderRadius: 10, background: t.surface, border: '1px solid ' + t.border, color: t.text, textDecoration: 'none', fontSize: 13.5, fontWeight: 700 }}>Call</a>
                        <a href={'https://wa.me/' + c.phone.replace(/[^0-9]/g, '').replace(/^0/, '44')} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', minHeight: 42, lineHeight: '42px', borderRadius: 10, background: t.surface, border: '1px solid ' + t.border, color: t.text, textDecoration: 'none', fontSize: 13.5, fontWeight: 700 }}>WhatsApp</a>
                      </div>
                    )}

                    {(detail.jobs || []).length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Jobs</div>
                        {detail.jobs.map(j => (
                          <button key={j.id} onClick={() => nav('/jobs/' + j.id)} style={{
                            display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8,
                            background: 'none', border: 'none', borderTop: '1px solid ' + t.border,
                            padding: '8px 0', cursor: 'pointer', color: t.text, fontSize: 14, textAlign: 'left',
                          }}>
                            <span style={{ fontWeight: 600 }}>{j.name}</span>
                            <span style={{ color: t.textMuted, fontSize: 12.5, textTransform: 'capitalize', flexShrink: 0 }}>{j.status}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {(detail.quotes || []).length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Quotes</div>
                        {detail.quotes.map(q => (
                          <button key={q.id} onClick={() => nav('/estimator/quote/' + q.id)} style={{
                            display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8,
                            background: 'none', border: 'none', borderTop: '1px solid ' + t.border,
                            padding: '8px 0', cursor: 'pointer', color: t.text, fontSize: 14, textAlign: 'left',
                          }}>
                            <span>{q.project_name || q.quote_number}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, flexShrink: 0 }}>{fmt0(q.grand_total)} <span style={{ color: t.textMuted, fontWeight: 500, textTransform: 'capitalize' }}>· {q.status}</span></span>
                          </button>
                        ))}
                      </div>
                    )}

                    {(detail.invoices || []).length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Invoices</div>
                        {detail.invoices.map(inv => (
                          <button key={inv.id} onClick={() => nav('/invoices/' + inv.id)} style={{
                            display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8,
                            background: 'none', border: 'none', borderTop: '1px solid ' + t.border,
                            padding: '8px 0', cursor: 'pointer', color: t.text, fontSize: 14, textAlign: 'left',
                          }}>
                            <span>{inv.invoice_number}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, flexShrink: 0 }}>{fmt0(inv.grand_total)} <span style={{ color: inv.status === 'paid' ? t.success : t.textMuted, fontWeight: 500, textTransform: 'capitalize' }}>· {inv.status}</span></span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: 12, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Details</div>
                    <input style={input} placeholder="Name" value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                    <input style={input} type="email" placeholder="Email" value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} />
                    <input style={input} type="tel" placeholder="Phone" value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
                    <input style={input} placeholder="Address" value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} />
                    <textarea style={{ ...input, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Notes — gate codes, preferences, anything worth remembering" value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={saveEdit} style={{ flex: 1, minHeight: 44, borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Save details</button>
                      <button onClick={() => removeClient(c.id)} style={{ minHeight: 44, padding: '0 14px', borderRadius: 10, background: 'transparent', border: '1px solid ' + (t.danger || '#EF4444') + '66', color: t.danger || '#EF4444', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

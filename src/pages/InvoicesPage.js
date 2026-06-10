import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

const STATUS = ['draft', 'sent', 'paid', 'void'];
function fmt(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

function statusColour(s, overdue, t) {
  if (overdue) return { bg: t.dangerBg, fg: t.danger };
  switch (s) {
    case 'paid':   return { bg: t.successBg, fg: t.success };
    case 'sent':   return { bg: t.warningBg, fg: t.warning };
    case 'void':   return { bg: 'rgba(148,163,184,0.15)', fg: t.textMuted };
    default:        return { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  }
}

export default function InvoicesPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [invoices, setInvoices] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  // /money?new=1 — the Today screen's "New invoice" opens the create panel.
  const [creating, setCreating] = useState(searchParams.get('new') === '1');
  const [newInv, setNewInv] = useState({ source: 'blank', from_quote_id: '', job_id: '', client_name: '' });
  // A4 — accountant export modal
  const [exporting, setExporting] = useState(false);
  const [exp, setExp] = useState({ what: 'invoices', format: 'xero' });
  const [expMsg, setExpMsg] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [inv, j, q] = await Promise.all([
        apiFetch('/invoices'),
        apiFetch('/finance/jobs'),
        apiFetch('/estimator/quotes'),
      ]);
      setInvoices(inv.invoices || []);
      setJobs(j.jobs || []);
      setQuotes(q.quotes || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    try {
      const body = {};
      if (newInv.source === 'quote' && newInv.from_quote_id) {
        body.from_quote_id = newInv.from_quote_id;
        const q = quotes.find(x => x.id === newInv.from_quote_id);
        if (q && !newInv.client_name) body.client_name = q.client_name;
      }
      if (newInv.job_id) body.job_id = newInv.job_id;
      if (newInv.client_name) body.client_name = newInv.client_name;
      const r = await apiFetch('/invoices', { method: 'POST', body: JSON.stringify(body) });
      setCreating(false);
      setNewInv({ source: 'blank', from_quote_id: '', job_id: '', client_name: '' });
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const downloadPdf = (id) => {
    fetch('/api/invoices/' + id + '/pdf', {
      headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() },
    }).then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'invoice.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      }).catch(e => alert(e.message));
  };

  // A4 — accountant export: download needs the auth headers, so fetch a blob.
  const downloadExport = () => {
    fetch('/api/invoices/_export/csv?what=' + exp.what + '&format=' + exp.format, {
      headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() },
    }).then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = exp.what + '-' + exp.format + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        setExpMsg('Downloaded — attach it to an email or import it straight into ' + (exp.format === 'xero' ? 'Xero' : 'QuickBooks') + '.');
      }).catch(e => setExpMsg(e.message));
  };

  const emailExport = async () => {
    setExpMsg('');
    try {
      const r = await apiFetch('/invoices/_export/email', { method: 'POST', body: JSON.stringify(exp) });
      setExpMsg('Sent to ' + r.sent_to + '.');
    } catch (e) { setExpMsg(e.message); }
  };

  const filtered = filter ? invoices.filter(i => filter === 'overdue' ? i.overdue : i.status === filter) : invoices;

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Invoices</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Issue branded invoices from quotes, jobs, or standalone.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => { setExporting(v => !v); setExpMsg(''); }} style={{ background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' }}>
            Send to your accountant
          </button>
          <button onClick={() => setCreating(v => !v)} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>
            {creating ? 'Cancel' : '+ New invoice'}
          </button>
        </div>
      </div>

      {/* A4 — accountant export */}
      {exporting && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: t.textSecondary, fontSize: 13, marginBottom: 10 }}>
            A spreadsheet your accountant can pull straight into their software. Download it, or email it to them in one tap.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <div>
              <label style={lbl(t)}>What</label>
              <select value={exp.what} onChange={e => setExp({ ...exp, what: e.target.value })} style={fld(t)}>
                <option value="invoices">Invoices you've sent</option>
                <option value="payments">Payments you've received</option>
              </select>
            </div>
            <div>
              <label style={lbl(t)}>Their software</label>
              <select value={exp.format} onChange={e => setExp({ ...exp, format: e.target.value })} style={fld(t)}>
                <option value="xero">Xero</option>
                <option value="quickbooks">QuickBooks</option>
              </select>
            </div>
            <button onClick={downloadExport} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontWeight: 600, cursor: 'pointer' }}>Download the file</button>
            <button onClick={emailExport} style={{ background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '9px 14px', fontWeight: 600, cursor: 'pointer' }}>Email it to your accountant</button>
          </div>
          {expMsg && <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 10 }}>{expMsg}</div>}
        </div>
      )}

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {creating && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr 1fr 120px', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={lbl(t)}>Source</label>
              <select value={newInv.source} onChange={e => setNewInv({ ...newInv, source: e.target.value })} style={fld(t)}>
                <option value="blank">Blank</option>
                <option value="quote">From quote</option>
              </select>
            </div>
            {newInv.source === 'quote' && (
              <div>
                <label style={lbl(t)}>Quote</label>
                <select value={newInv.from_quote_id} onChange={e => setNewInv({ ...newInv, from_quote_id: e.target.value })} style={fld(t)}>
                  <option value="">— Pick —</option>
                  {quotes.map(q => <option key={q.id} value={q.id}>{q.quote_number || q.id.slice(0,8)} · {q.project_name}</option>)}
                </select>
              </div>
            )}
            {newInv.source !== 'quote' && <div />}
            <div>
              <label style={lbl(t)}>Job (optional)</label>
              <select value={newInv.job_id} onChange={e => setNewInv({ ...newInv, job_id: e.target.value })} style={fld(t)}>
                <option value="">— None —</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl(t)}>Client name (optional)</label>
              <input value={newInv.client_name} onChange={e => setNewInv({ ...newInv, client_name: e.target.value })} placeholder="Auto-fills from quote" style={fld(t)} />
            </div>
            <button onClick={create} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' }}>Create</button>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <FilterChip t={t} active={!filter} onClick={() => setFilter('')}>All</FilterChip>
        {STATUS.map(s => <FilterChip key={s} t={t} active={filter === s} onClick={() => setFilter(s)}>{s}</FilterChip>)}
        <FilterChip t={t} active={filter === 'overdue'} onClick={() => setFilter('overdue')} tone="danger">Overdue</FilterChip>
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 40, textAlign: 'center', color: t.textSecondary }}>
          No invoices match.
        </div>
      ) : (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: t.surface, color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  <th style={th}>Invoice</th>
                  <th style={th}>Client</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total</th>
                  <th style={th}>Status</th>
                  <th style={th}>Issued</th>
                  <th style={th}>Due</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const sc = statusColour(inv.status, inv.overdue, t);
                  return (
                    <tr key={inv.id} style={{ borderTop: '1px solid ' + t.border }}>
                      <td style={td}>
                        <a href="#" onClick={(e) => { e.preventDefault(); nav('/invoices/' + inv.id); }} style={{ color: t.accent, textDecoration: 'none', fontWeight: 600 }}>{inv.invoice_number || inv.id.slice(0,8)}</a>
                      </td>
                      <td style={td}>{inv.client_name || <span style={{ color: t.textMuted }}>—</span>}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.grand_total)}</td>
                      <td style={td}>
                        <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{inv.overdue ? 'Overdue' : inv.status}</span>
                      </td>
                      <td style={{ ...td, color: t.textSecondary, fontSize: 13 }}>{inv.issue_date || '—'}</td>
                      <td style={{ ...td, color: t.textSecondary, fontSize: 13 }}>{inv.due_date || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button onClick={() => nav('/invoices/' + inv.id)} style={btnGhost(t)}>Open</button>
                        <button onClick={() => downloadPdf(inv.id)} style={btnGhost(t)}>PDF</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ t, active, onClick, tone, children }) {
  const c = tone === 'danger' ? t.danger : t.accent;
  return (
    <button onClick={onClick} style={{
      background: active ? c : 'transparent',
      color: active ? '#fff' : t.text,
      border: '1px solid ' + (active ? c : t.border),
      borderRadius: 999, padding: '4px 12px', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
    }}>{children}</button>
  );
}

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const td = { padding: '12px 14px', fontSize: 14 };
function fld(t) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }; }
function lbl(t) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }; }
function btnGhost(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 6, padding: '4px 10px', fontSize: 12, marginLeft: 6, cursor: 'pointer' }; }

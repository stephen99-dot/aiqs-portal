import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import HelpTip from '../components/HelpTip';

// MONEY — one place for everything money: what's coming in (invoices),
// what's due in (payment stages + retention), and your numbers (what the
// business costs to run and the day rate that breaks even). A segmented
// control, not tabs-within-tabs. Mobile-first: cards, big numbers, no charts.

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmt0(n) { return '£' + Math.round(num(n)).toLocaleString('en-GB'); }
function shortDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return iso; }
}
function monthLabel(ym) {
  try { return new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); } catch (e) { return ym; }
}

const SEGMENTS = [
  { key: 'in', label: 'Coming in' },
  { key: 'due', label: 'Due in' },
  { key: 'numbers', label: 'Your numbers' },
];

export default function MoneyPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const [segment, setSegment] = useState(searchParams.get('tab') || 'in');
  const [invoices, setInvoices] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [stages, setStages] = useState([]);
  const [overheads, setOverheads] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // "Coming in" state
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(searchParams.get('new') === '1');
  const [newInv, setNewInv] = useState({ job_id: '', from_quote_id: '', client_name: '' });
  // Accountant export
  const [exporting, setExporting] = useState(false);
  const [exp, setExp] = useState({ what: 'invoices', format: 'xero' });
  const [expMsg, setExpMsg] = useState('');
  // "Your numbers" editor
  const [ohItems, setOhItems] = useState([]);
  const [ohDays, setOhDays] = useState(20);
  const [ohHours, setOhHours] = useState(8);
  const [ohTouched, setOhTouched] = useState(false);
  const [ohSaving, setOhSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [inv, j, q, st, oh] = await Promise.all([
        apiFetch('/invoices'),
        apiFetch('/finance/jobs'),
        apiFetch('/estimator/quotes'),
        apiFetch('/payment-schedules'),
        apiFetch('/finance/overheads/current'),
      ]);
      setInvoices(inv.invoices || []);
      setJobs(j.jobs || []);
      setQuotes(q.quotes || []);
      setStages(st.stages || []);
      setOverheads(oh || null);
      setOhItems((oh?.line_items || []).length ? oh.line_items : [{ name: '', amount: '' }]);
      setOhDays(num(oh?.working_days, 20));
      setOhHours(num(oh?.working_hours_per_day, 8));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const jobName = useCallback((jobId) => {
    const j = jobs.find(x => x.id === jobId);
    return j ? [j.client_name, j.name].filter(Boolean).join(' — ') : '';
  }, [jobs]);

  // ── Coming in ──────────────────────────────────────────────────────────────

  const filteredInvoices = useMemo(() => {
    if (!filter) return invoices;
    if (filter === 'overdue') return invoices.filter(i => i.overdue);
    return invoices.filter(i => i.status === filter);
  }, [invoices, filter]);

  const create = async () => {
    try {
      const body = {};
      if (newInv.job_id) body.job_id = newInv.job_id;
      if (newInv.from_quote_id) body.from_quote_id = newInv.from_quote_id;
      if (newInv.client_name) body.client_name = newInv.client_name;
      else if (newInv.job_id) {
        const j = jobs.find(x => x.id === newInv.job_id);
        if (j?.client_name) body.client_name = j.client_name;
      }
      const r = await apiFetch('/invoices', { method: 'POST', body: JSON.stringify(body) });
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

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

  // ── Due in ─────────────────────────────────────────────────────────────────

  // One tap turns an unpaid stage into a draft invoice and links the two.
  const invoiceStage = async (stage) => {
    try {
      const j = jobs.find(x => x.id === stage.job_id);
      const r = await apiFetch('/invoices', { method: 'POST', body: JSON.stringify({
        job_id: stage.job_id || undefined,
        client_name: j?.client_name || stage.job_client || undefined,
        lines: [{ description: stage.stage_label || 'Staged payment', unit: 'item', qty: 1, rate: num(stage.amount) }],
        vat_pct: 20,
      }) });
      await apiFetch('/payment-schedules/' + stage.id + '/link-invoice', { method: 'POST', body: JSON.stringify({ invoice_id: r.id }) });
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const upcomingStages = useMemo(() => stages.filter(s => s.status === 'unpaid'), [stages]);
  const retentions = useMemo(() => jobs.filter(j =>
    num(j.retention_pct) > 0 && j.retention_release_date && j.status !== 'cancelled'
  ), [jobs]);

  // ── Your numbers ───────────────────────────────────────────────────────────

  const ohTotal = useMemo(() => ohItems.reduce((s, li) => s + num(li.amount), 0), [ohItems]);
  const breakEvenDay = ohDays > 0 ? ohTotal / ohDays : 0;

  const saveOverheads = async () => {
    setOhSaving(true); setError('');
    try {
      const r = await apiFetch('/finance/overheads/current', { method: 'PUT', body: JSON.stringify({
        line_items: ohItems.filter(li => li.name || num(li.amount)),
        working_days: num(ohDays, 20),
        working_hours_per_day: num(ohHours, 8),
      }) });
      setOverheads(r);
      setOhTouched(false);
    } catch (e) { setError(e.message); }
    finally { setOhSaving(false); }
  };

  // Month-by-month invoiced vs paid, newest first, last 6 months with activity.
  const months = useMemo(() => {
    const map = {};
    for (const inv of invoices) {
      if (inv.status === 'void' || inv.status === 'draft') continue;
      const issued = (inv.issue_date || inv.created_at || '').slice(0, 7);
      if (issued) {
        map[issued] = map[issued] || { invoiced: 0, paid: 0 };
        map[issued].invoiced += num(inv.grand_total);
      }
      if (inv.status === 'paid' && inv.paid_at) {
        const pm = inv.paid_at.slice(0, 7);
        map[pm] = map[pm] || { invoiced: 0, paid: 0 };
        map[pm].paid += num(inv.paid_amount) > 0 ? num(inv.paid_amount) : num(inv.grand_total);
      }
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [invoices]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const input = {
    width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px',
    background: t.bg, border: '1px solid ' + t.border, color: t.text,
    borderRadius: 10, fontSize: 14, outline: 'none',
  };
  const card = { background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: 16, marginBottom: 12 };
  const primaryBtn = { minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
  const ghostBtn = { minHeight: 44, padding: '0 14px', borderRadius: 10, border: '1px solid ' + t.border, background: 'transparent', color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' };

  const chip = (active) => ({
    flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer',
    background: active ? t.accent : 'transparent',
    color: active ? '#fff' : t.textSecondary,
    border: 'none', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', padding: '0 8px',
  });

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>Money <HelpTip t={t} title="Money" text={"Three views:\n\n'Coming in' — every invoice, with Chase it on anything overdue.\n\n'Due in' — payments you're expecting: stages from payment plans and retention coming back.\n\n'Your numbers' — what the business costs to run each month, and the day rate you need to break even."} /></h1>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 12 }}>{error}</div>}

      {/* Segmented control */}
      <div style={{ display: 'flex', gap: 4, background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 4, marginBottom: 16 }}>
        {SEGMENTS.map(s => (
          <button key={s.key} onClick={() => setSegment(s.key)} style={chip(segment === s.key)}>{s.label}</button>
        ))}
      </div>

      {/* ── COMING IN ── */}
      {segment === 'in' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={() => { setCreating(v => !v); setError(''); }} style={{ ...primaryBtn, flex: 1 }}>{creating ? 'Cancel' : '+ New invoice'}</button>
            <button onClick={() => { setExporting(v => !v); setExpMsg(''); }} style={ghostBtn}>Send to your accountant</button>
          </div>

          {creating && (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.textSecondary, marginBottom: 4 }}>Which job is it for?</div>
                <select value={newInv.job_id} onChange={e => setNewInv({ ...newInv, job_id: e.target.value, from_quote_id: '' })} style={input}>
                  <option value="">No job — a one-off invoice</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{[j.client_name, j.name].filter(Boolean).join(' — ')}</option>)}
                </select>
              </div>
              {newInv.job_id && quotes.some(q => q.job_id === newInv.job_id) && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.textSecondary, marginBottom: 4 }}>Start from the quote? (fills the lines in for you)</div>
                  <select value={newInv.from_quote_id} onChange={e => setNewInv({ ...newInv, from_quote_id: e.target.value })} style={input}>
                    <option value="">Start blank</option>
                    {quotes.filter(q => q.job_id === newInv.job_id).map(q => (
                      <option key={q.id} value={q.id}>Quote · {shortDate(q.created_at)} · {fmt0(q.grand_total)}</option>
                    ))}
                  </select>
                </div>
              )}
              {!newInv.job_id && (
                <input style={input} placeholder="Who's it for? (customer name)" value={newInv.client_name} onChange={e => setNewInv({ ...newInv, client_name: e.target.value })} />
              )}
              <button onClick={create} style={primaryBtn}>Create the invoice</button>
            </div>
          )}

          {exporting && (
            <div style={card}>
              <div style={{ color: t.textSecondary, fontSize: 13, marginBottom: 10 }}>
                A spreadsheet your accountant can pull straight into their software. Download it, or email it to them in one tap.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <select value={exp.what} onChange={e => setExp({ ...exp, what: e.target.value })} style={input}>
                  <option value="invoices">Invoices you've sent</option>
                  <option value="payments">Payments you've received</option>
                </select>
                <select value={exp.format} onChange={e => setExp({ ...exp, format: e.target.value })} style={input}>
                  <option value="xero">Xero</option>
                  <option value="quickbooks">QuickBooks</option>
                </select>
                <button onClick={downloadExport} style={primaryBtn}>Download the file</button>
                <button onClick={emailExport} style={ghostBtn}>Email your accountant</button>
              </div>
              {expMsg && <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 10 }}>{expMsg}</div>}
            </div>
          )}

          {/* Status filter chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['overdue', 'Overdue'], ['paid', 'Paid']].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                minHeight: 36, padding: '0 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: filter === k ? t.accent : t.card,
                color: filter === k ? '#fff' : t.textSecondary,
                border: '1px solid ' + (filter === k ? t.accent : t.border),
              }}>{label}</button>
            ))}
          </div>

          {filteredInvoices.length === 0 ? (
            <div style={{ ...card, borderStyle: 'dashed', textAlign: 'center', padding: 32 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{filter ? 'Nothing here' : 'No invoices yet'}</div>
              <div style={{ color: t.textSecondary, fontSize: 14, marginBottom: filter ? 0 : 14 }}>
                {filter ? 'Try a different filter.' : 'Turn a finished quote into an invoice in one tap — open the job and press the green button.'}
              </div>
              {!filter && <button onClick={() => nav('/jobs')} style={primaryBtn}>Go to your jobs</button>}
            </div>
          ) : filteredInvoices.map(inv => {
            const tone = inv.overdue ? { bg: t.dangerBg, fg: t.danger, label: 'Overdue' }
              : inv.status === 'paid' ? { bg: t.successBg, fg: t.success, label: 'Paid' }
              : inv.status === 'sent' ? { bg: t.warningBg, fg: t.warning, label: 'Sent' }
              : inv.status === 'void' ? { bg: 'rgba(148,163,184,0.15)', fg: t.textMuted, label: 'Void' }
              : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary, label: 'Draft' };
            return (
              <div key={inv.id} style={{ ...card, marginBottom: 10, borderColor: inv.overdue ? t.danger + '66' : t.border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <button onClick={() => nav('/invoices/' + inv.id)} style={{ background: 'none', border: 'none', padding: 0, color: t.text, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}>
                      {inv.client_name || 'Invoice'} · {shortDate(inv.issue_date || inv.created_at)}
                    </button>
                    <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                      {jobName(inv.job_id) || 'No job'}{inv.due_date ? ' · due ' + shortDate(inv.due_date) : ''}{inv.invoice_number ? ' · ' + inv.invoice_number : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt0(inv.grand_total)}</div>
                    <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{tone.label}</span>
                  </div>
                </div>
                {inv.overdue && (
                  <button onClick={() => nav('/invoices/' + inv.id + '?chase=1')} style={{ ...primaryBtn, background: t.danger, marginTop: 10 }}>Chase it</button>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── DUE IN ── */}
      {segment === 'due' && (
        <>
          {upcomingStages.length === 0 && retentions.length === 0 ? (
            <div style={{ ...card, borderStyle: 'dashed', textAlign: 'center', padding: 32 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing scheduled</div>
              <div style={{ color: t.textSecondary, fontSize: 14 }}>
                Paid in stages on a job — deposit, first fix, completion? List the stages on the job page and they'll show up here so nothing slips.
              </div>
            </div>
          ) : (
            <>
              {upcomingStages.map(st => {
                const overdue = st.due_date && st.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <div key={st.id} style={{ ...card, marginBottom: 10, borderColor: overdue ? t.danger + '66' : t.border }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{st.stage_label || 'Staged payment'}</div>
                        <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                          {[st.job_client, st.job_name].filter(Boolean).join(' — ') || 'No job'}
                          {st.due_date ? ' · due ' + shortDate(st.due_date) : ''}
                        </div>
                        {overdue && <div style={{ color: t.danger, fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>Past its due date</div>}
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt0(st.amount)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {st.invoice_id ? (
                        <button onClick={() => nav('/invoices/' + st.invoice_id)} style={ghostBtn}>See the invoice</button>
                      ) : (
                        <button onClick={() => invoiceStage(st)} style={primaryBtn}>Invoice it</button>
                      )}
                      {st.job_id && <button onClick={() => nav('/jobs/' + st.job_id)} style={ghostBtn}>See the job</button>}
                    </div>
                  </div>
                );
              })}

              {retentions.map(j => {
                const amount = num(j.retention_pct) / 100 * num(j.planned_revenue);
                const due = j.retention_release_date <= new Date().toISOString().slice(0, 10);
                return (
                  <div key={'ret-' + j.id} style={{ ...card, marginBottom: 10, borderColor: due ? t.danger + '66' : t.border }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>Retention due back</div>
                        <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                          {[j.client_name, j.name].filter(Boolean).join(' — ')} · {j.retention_pct}% · release {shortDate(j.retention_release_date)}
                        </div>
                        {due && <div style={{ color: t.danger, fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>Due now — invoice it before it gets forgotten</div>}
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{amount > 0 ? fmt0(amount) : j.retention_pct + '%'}</div>
                    </div>
                    <button onClick={() => nav('/jobs/' + j.id)} style={{ ...ghostBtn, marginTop: 10 }}>See the job</button>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {/* ── YOUR NUMBERS ── */}
      {segment === 'numbers' && (
        <>
          <div style={card}>
            <div style={{ fontSize: 16, lineHeight: 1.5 }}>
              Your business costs <strong style={{ fontSize: 20 }}>{fmt0(ohTotal)}</strong> a month to run.
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.5, marginTop: 6 }}>
              You need to earn <strong style={{ fontSize: 20, color: t.accent }}>{fmt0(breakEvenDay)}</strong> a day to break even
              {ohHours > 0 && breakEvenDay > 0 ? <span style={{ color: t.textSecondary }}> (about {fmt0(breakEvenDay / ohHours)} an hour)</span> : null}.
            </div>
            <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 8 }}>
              Anything above that is profit. Quote with this number in your head.
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>What it costs to run the business each month</div>
            <div style={{ color: t.textMuted, fontSize: 12.5, marginBottom: 12 }}>
              Van, insurance, phone, tools, accountant, yard — the bills you pay whether or not you're on a job.
            </div>
            {ohItems.map((li, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input style={{ ...input, flex: 2 }} placeholder="e.g. Van + fuel" value={li.name}
                  onChange={e => { const next = [...ohItems]; next[idx] = { ...li, name: e.target.value }; setOhItems(next); setOhTouched(true); }} />
                <input style={{ ...input, flex: 1 }} type="number" step="any" placeholder="£/month" value={li.amount}
                  onChange={e => { const next = [...ohItems]; next[idx] = { ...li, amount: e.target.value }; setOhItems(next); setOhTouched(true); }} />
                <button onClick={() => { setOhItems(ohItems.filter((_, i) => i !== idx)); setOhTouched(true); }}
                  style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 18, minWidth: 36 }}>×</button>
              </div>
            ))}
            <button onClick={() => setOhItems([...ohItems, { name: '', amount: '' }])} style={{ ...ghostBtn, marginBottom: 12 }}>+ Add a cost</button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textSecondary, marginBottom: 4 }}>Days you work a month</div>
                <input style={input} type="number" min="1" max="31" value={ohDays} onChange={e => { setOhDays(e.target.value); setOhTouched(true); }} />
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textSecondary, marginBottom: 4 }}>Hours a day</div>
                <input style={input} type="number" min="1" max="16" value={ohHours} onChange={e => { setOhHours(e.target.value); setOhTouched(true); }} />
              </div>
            </div>
            <button onClick={saveOverheads} disabled={!ohTouched || ohSaving} style={{ ...primaryBtn, opacity: ohTouched ? 1 : 0.5, width: '100%' }}>
              {ohSaving ? 'Saving…' : (ohTouched ? 'Save your numbers' : 'Saved')}
            </button>
          </div>

          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Month by month</div>
            {months.length === 0 ? (
              <div style={{ color: t.textMuted, fontSize: 13 }}>Once you've sent some invoices, you'll see each month's billing and payments here.</div>
            ) : months.map(([ym, m]) => (
              <div key={ym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '10px 0', borderTop: '1px solid ' + t.border, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{monthLabel(ym)}</div>
                <div style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: t.textSecondary }}>invoiced </span><strong>{fmt0(m.invoiced)}</strong>
                  <span style={{ color: t.textSecondary }}> · paid </span><strong style={{ color: t.success }}>{fmt0(m.paid)}</strong>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

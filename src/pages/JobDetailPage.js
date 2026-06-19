import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import HelpTip from '../components/HelpTip';
import { jobStage, stageColours } from '../utils/jobStages';
import { PhoneIcon } from '../components/Icons';
import JobPhotos from '../components/JobPhotos';
import JobSchedule from '../components/JobSchedule';

// THE JOB PAGE — one screen with everything about one job, sectioned
// vertically: money strip, quotes, invoices & payments, changes, documents,
// notes, then the plan/costs detail. No inner tabs; a sticky section nav
// (horizontal, scrollable — works with a thumb) jumps between sections.

// Job stage choices in builder words — maps onto the existing status values.
const STATUS_LABELS = [
  { value: 'planned', label: 'Not started' },
  { value: 'active', label: 'In progress' },
  { value: 'completed', label: 'Finished' },
  { value: 'cancelled', label: 'Cancelled' },
];

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmt(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt0(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function todayIso() { const d = new Date(); return d.toISOString().slice(0, 10); }
function shortDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return iso; }
}

export default function JobDetailPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const { id } = useParams();
  const nav = useNavigate();

  const [job, setJob] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [editingDetails, setEditingDetails] = useState(false);

  const [budget, setBudget] = useState({
    planned_labour: 0, planned_materials: 0, planned_overheads: 0, planned_other: 0,
    planned_margin_pct: 15, planned_revenue: '', notes: '',
  });
  const [budgetTouched, setBudgetTouched] = useState(false);

  const [costs, setCosts] = useState([]);
  const [newCost, setNewCost] = useState({ kind: 'material', description: '', qty: 1, unit: 'item', unit_cost: 0, vendor: '', occurred_on: todayIso() });
  const [costError, setCostError] = useState('');
  const [variations, setVariations] = useState([]);
  const [variationsApproved, setVariationsApproved] = useState(0);
  const [invoices, setInvoices] = useState([]);
  const [schedule, setSchedule] = useState({ stages: [], total: 0, paid: 0, unpaid: 0 });
  const [newStage, setNewStage] = useState({ stage_label: '', amount: '', due_date: '', due_trigger: '' });
  const [invoiceSheet, setInvoiceSheet] = useState(null); // quote being turned into an invoice
  const [pctChoice, setPctChoice] = useState(25);
  const [documents, setDocuments] = useState([]);
  const [docTemplates, setDocTemplates] = useState([]);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  // Pull a delivered portal BOQ into this job as a ready-to-send draft quote.
  const [boqPickerOpen, setBoqPickerOpen] = useState(false);
  const [portalProjects, setPortalProjects] = useState(null);
  const [boqProjectId, setBoqProjectId] = useState('');
  const [boqImporting, setBoqImporting] = useState(false);

  // Section anchors for the sticky nav.
  const sections = {
    money: useRef(null), quotes: useRef(null), invoices: useRef(null),
    changes: useRef(null), schedule: useRef(null), photos: useRef(null), documents: useRef(null),
    notes: useRef(null), plan: useRef(null),
  };
  const jumpTo = (key) => sections[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [jobR, costsR] = await Promise.all([
        apiFetch('/finance/jobs/' + id),
        apiFetch('/finance/jobs/' + id + '/costs'),
      ]);
      setJob(jobR.job);
      setQuotes(jobR.quotes || []);
      if (jobR.budget) {
        setBudget({
          planned_labour: jobR.budget.planned_labour || 0,
          planned_materials: jobR.budget.planned_materials || 0,
          planned_overheads: jobR.budget.planned_overheads || 0,
          planned_other: jobR.budget.planned_other || 0,
          planned_margin_pct: jobR.budget.planned_margin_pct || 0,
          planned_revenue: jobR.budget.planned_revenue || '',
          notes: jobR.budget.notes || '',
        });
      }
      setCosts(costsR.costs || []);
      try {
        const vr = await apiFetch('/change-orders/job/' + id);
        setVariations(vr.variations || []);
        setVariationsApproved(vr.approved_total || 0);
      } catch (e) { /* surface only the bigger error */ }
      try {
        const ir = await apiFetch('/invoices?job_id=' + id);
        setInvoices(ir.invoices || []);
      } catch (e) {}
      try {
        const sr = await apiFetch('/payment-schedules/job/' + id);
        setSchedule(sr || { stages: [], total: 0, paid: 0, unpaid: 0 });
      } catch (e) {}
      try {
        const [dr, tr] = await Promise.all([
          apiFetch('/documents?job_id=' + id),
          apiFetch('/documents/templates'),
        ]);
        setDocuments(dr.documents || []);
        setDocTemplates(tr.templates || []);
      } catch (e) {}
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  // The money pipeline for the strip: contract value (accepted quotes +
  // approved changes, falling back to everything quoted), what's been
  // invoiced, what's been paid, what's still to invoice.
  const money = useMemo(() => {
    const accepted = quotes.filter(q => q.status === 'accepted' || q.status === 'won')
      .reduce((s, q) => s + num(q.grand_total), 0);
    const allQuoted = quotes.filter(q => q.status !== 'lost')
      .reduce((s, q) => s + num(q.grand_total), 0);
    const contract = (accepted > 0 ? accepted : allQuoted) + num(variationsApproved);
    const invoiced = invoices.filter(i => i.status === 'sent' || i.status === 'paid')
      .reduce((s, i) => s + num(i.grand_total), 0);
    const paid = invoices.filter(i => i.status === 'paid')
      .reduce((s, i) => s + (num(i.paid_amount) > 0 ? num(i.paid_amount) : num(i.grand_total)), 0);
    return { contract, invoiced, paid, toInvoice: Math.max(0, contract - invoiced) };
  }, [quotes, invoices, variationsApproved]);

  // Plan-vs-spend totals (the old variance strip, now in the detail section).
  const totals = useMemo(() => {
    const plannedCost = num(budget.planned_labour) + num(budget.planned_materials) + num(budget.planned_overheads) + num(budget.planned_other);
    const plannedRevenue = budget.planned_revenue !== '' && budget.planned_revenue != null
      ? num(budget.planned_revenue)
      : plannedCost * (1 + num(budget.planned_margin_pct) / 100);
    const plannedProfit = plannedRevenue - plannedCost;
    const actualByKind = { material: 0, labour: 0, other: 0 };
    for (const c of costs) actualByKind[c.kind] = (actualByKind[c.kind] || 0) + num(c.total);
    const actualTotal = actualByKind.material + actualByKind.labour + actualByKind.other;
    const variance = actualTotal - plannedCost;
    const variancePct = plannedCost > 0 ? (variance / plannedCost) * 100 : 0;
    return { plannedCost, plannedRevenue, plannedProfit, actualByKind, actualTotal, variance, variancePct };
  }, [budget, costs]);

  const saveBudget = async () => {
    try {
      await apiFetch('/finance/jobs/' + id + '/budget', { method: 'PUT', body: JSON.stringify({
        planned_labour: num(budget.planned_labour),
        planned_materials: num(budget.planned_materials),
        planned_overheads: num(budget.planned_overheads),
        planned_other: num(budget.planned_other),
        planned_margin_pct: num(budget.planned_margin_pct),
        planned_revenue: budget.planned_revenue === '' ? null : num(budget.planned_revenue),
        notes: budget.notes,
      }) });
      setBudgetTouched(false);
      setSavedAt(new Date());
    } catch (e) { setError(e.message); }
  };

  const updateJob = async (patch) => {
    try {
      await apiFetch('/finance/jobs/' + id, { method: 'PATCH', body: JSON.stringify(patch) });
      setJob(prev => ({ ...prev, ...patch }));
    } catch (e) { setError(e.message); }
  };

  const addCost = async () => {
    setCostError('');
    if (!newCost.description.trim()) { setCostError('Say what it was — e.g. "Bricks (1000)"'); return; }
    try {
      await apiFetch('/finance/jobs/' + id + '/costs', { method: 'POST', body: JSON.stringify({
        ...newCost,
        qty: num(newCost.qty),
        unit_cost: num(newCost.unit_cost),
      }) });
      setNewCost({ kind: 'material', description: '', qty: 1, unit: 'item', unit_cost: 0, vendor: '', occurred_on: todayIso() });
      refresh();
    } catch (e) { setCostError(e.message); }
  };

  const removeCost = async (costId) => {
    if (!window.confirm('Delete this cost row?')) return;
    try {
      await apiFetch('/finance/jobs/' + id + '/costs/' + costId, { method: 'DELETE' });
      refresh();
    } catch (e) { setError(e.message); }
  };

  const deleteJob = async () => {
    if (!window.confirm('Delete this job, its plan, and all logged costs? This cannot be undone.')) return;
    try {
      await apiFetch('/finance/jobs/' + id, { method: 'DELETE' });
      nav('/jobs');
    } catch (e) { setError(e.message); }
  };

  // B5: accepted quote -> invoice. The sheet offers the full amount, a
  // percentage ("Invoice the deposit (25%)"), or a stage from the payment
  // plan — everything pre-filled either way.
  const createFromQuote = async (quote, percent, stageLabel) => {
    try {
      const r = await apiFetch('/invoices', { method: 'POST', body: JSON.stringify({
        from_quote_id: quote.id, job_id: id, client_name: job.client_name || quote.client_name,
        percent: percent || 100, stage_label: stageLabel || undefined,
      }) });
      setInvoiceSheet(null);
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const createFromStage = async (stage) => {
    try {
      const r = await apiFetch('/invoices', { method: 'POST', body: JSON.stringify({
        job_id: id, client_name: job.client_name,
        lines: [{ description: stage.stage_label || 'Staged payment', unit: 'item', qty: 1, rate: num(stage.amount) }],
        vat_pct: 20,
      }) });
      try { await apiFetch('/payment-schedules/' + stage.id + '/link-invoice', { method: 'POST', body: JSON.stringify({ invoice_id: r.id }) }); } catch (e) {}
      setInvoiceSheet(null);
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const newInvoice = async () => {
    try {
      const r = await apiFetch('/invoices', { method: 'POST', body: JSON.stringify({ job_id: id, client_name: job.client_name }) });
      nav('/invoices/' + r.id);
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  if (!job) return <div style={{ padding: 40, color: t.danger }}>Job not found.</div>;

  const stage = jobStage({ ...job,
    quoted_total: quotes.filter(q => q.status !== 'lost').reduce((s, q) => s + num(q.grand_total), 0),
    accepted_total: quotes.filter(q => q.status === 'accepted' || q.status === 'won').reduce((s, q) => s + num(q.grand_total), 0),
    invoiced_total: money.invoiced, paid_total: money.paid,
  });
  const sc = stageColours(stage.key, t);
  const phoneDigits = (job.client_phone || '').replace(/[^\d+]/g, '');

  const card = { background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 14, padding: '16px 16px', marginBottom: 14, scrollMarginTop: 64 };
  const sectionTitle = { fontSize: 15, fontWeight: 700, marginBottom: 10 };
  const chipBtn = (active) => ({
    flexShrink: 0, minHeight: 36, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
    background: t.surface, color: t.textSecondary, border: '1px solid ' + t.border,
    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
  });
  const primaryBtn = { minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
  const ghostBtn = { minHeight: 44, padding: '0 14px', borderRadius: 10, border: '1px solid ' + t.border, background: 'transparent', color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const input = { width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 10, fontSize: 14, outline: 'none' };

  return (
    <div style={{ padding: '16px 16px 40px', color: t.text, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => nav('/jobs')} style={{ background: 'transparent', color: t.textSecondary, border: 'none', padding: '8px 0', fontSize: 13, cursor: 'pointer' }}>← Jobs</button>
        <HelpTip t={t} title="The job page" text={"Everything about this one job on one screen. The chips under the name jump to each section.\n\nThe four figures are the job's money at a glance: what you quoted, what you've invoiced, what's been paid, and what's still to bill.\n\nAccepted quote? The green button turns it into an invoice — full amount, a deposit, or a stage."} />
      </div>

      {/* Header: customer, address, stage, one-tap contact */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>
              {[job.client_name, job.name].filter(Boolean).join(' — ') || job.name}
            </h1>
            {job.location && <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>{job.location}</div>}
          </div>
          <span style={{ background: sc.bg, color: sc.fg, padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{stage.label}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {phoneDigits && (
            <>
              <a href={'tel:' + phoneDigits} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                <PhoneIcon size={15} /> Call {job.client_name ? job.client_name.split(' ')[0] : ''}
              </a>
              <a href={'https://wa.me/' + phoneDigits.replace(/^0/, '44').replace(/^\+/, '')} target="_blank" rel="noopener noreferrer"
                style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', borderColor: '#25D36655', color: '#25D366' }}>
                WhatsApp
              </a>
            </>
          )}
          <select value={job.status} onChange={e => updateJob({ status: e.target.value })} style={{ ...ghostBtn, paddingRight: 8 }}>
            {STATUS_LABELS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={() => setEditingDetails(v => !v)} style={ghostBtn}>{editingDetails ? 'Done' : 'Edit details'}</button>
        </div>

        {editingDetails && (
          <div style={{ ...card, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={input} defaultValue={job.name || ''} placeholder="Job name" onBlur={e => updateJob({ name: e.target.value })} />
            <input style={input} defaultValue={job.client_name || ''} placeholder="Customer name" onBlur={e => updateJob({ client_name: e.target.value })} />
            <input style={input} type="tel" defaultValue={job.client_phone || ''} placeholder="Customer phone — for one-tap call/WhatsApp" onBlur={e => updateJob({ client_phone: e.target.value })} />
            <input style={input} defaultValue={job.location || ''} placeholder="Address" onBlur={e => updateJob({ location: e.target.value })} />
            <button onClick={deleteJob} style={{ ...ghostBtn, color: t.danger, borderColor: t.danger + '55' }}>Delete this job</button>
          </div>
        )}
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 12 }}>{error}</div>}

      {/* Sticky section nav */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: t.bg,
        display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0 10px', marginBottom: 8,
        WebkitOverflowScrolling: 'touch',
      }}>
        <button style={chipBtn()} onClick={() => jumpTo('quotes')}>Quotes</button>
        <button style={chipBtn()} onClick={() => jumpTo('invoices')}>Invoices & payments</button>
        <button style={chipBtn()} onClick={() => jumpTo('changes')}>Changes</button>
        <button style={chipBtn()} onClick={() => jumpTo('schedule')}>Schedule</button>
        <button style={chipBtn()} onClick={() => jumpTo('photos')}>Photos</button>
        <button style={chipBtn()} onClick={() => jumpTo('documents')}>Documents</button>
        <button style={chipBtn()} onClick={() => jumpTo('notes')}>Notes</button>
        <button style={chipBtn()} onClick={() => jumpTo('plan')}>Plan & costs</button>
      </div>

      {/* Money strip */}
      <div ref={sections.money} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
        <MoneyFig t={t} label="Quoted" value={fmt0(money.contract)} />
        <MoneyFig t={t} label="Invoiced" value={fmt0(money.invoiced)} />
        <MoneyFig t={t} label="Paid" value={fmt0(money.paid)} tone="success" />
        <MoneyFig t={t} label="Still to invoice" value={fmt0(money.toInvoice)} tone={money.toInvoice > 0 ? 'warning' : undefined} />
      </div>

      {/* Quotes */}
      <div ref={sections.quotes} style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={sectionTitle}>Quotes</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => {
              setBoqPickerOpen(v => !v);
              if (portalProjects === null) {
                try {
                  const r = await apiFetch('/projects');
                  const list = (r.projects || r || []).filter(p => p.boq_filename);
                  setPortalProjects(list);
                  if (list.length) setBoqProjectId(list[0].id);
                } catch { setPortalProjects([]); }
              }
            }} style={{ ...primaryBtn, background: 'transparent', color: t.text, border: '1px solid ' + t.border }}>
              From portal BOQ
            </button>
            <button onClick={() => nav('/estimator/new?job=' + id)} style={primaryBtn}>+ New quote</button>
          </div>
        </div>
        {boqPickerOpen && (
          <div style={{ borderTop: '1px solid ' + t.border, padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12.5, color: t.textMuted }}>
              Pick a BOQ delivered to your portal — we'll turn its priced line items into a draft quote on this job.
            </div>
            {portalProjects === null ? (
              <div style={{ fontSize: 13, color: t.textMuted }}>Loading your BOQs…</div>
            ) : portalProjects.length === 0 ? (
              <div style={{ fontSize: 13, color: t.textMuted }}>No delivered BOQs in your portal yet.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={boqProjectId} onChange={e => setBoqProjectId(e.target.value)} style={{
                  flex: '1 1 220px', minHeight: 42, padding: '8px 12px', borderRadius: 10, fontSize: 14,
                  background: t.bg, border: '1px solid ' + t.border, color: t.text,
                }}>
                  {portalProjects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title}{p.total_value ? ' — £' + Math.round(p.total_value).toLocaleString('en-GB') : ''}
                    </option>
                  ))}
                </select>
                <button disabled={boqImporting || !boqProjectId} onClick={async () => {
                  setBoqImporting(true);
                  try {
                    await apiFetch('/finance/jobs/from-project', {
                      method: 'POST',
                      body: JSON.stringify({ project_id: boqProjectId, job_id: id, client_name: job?.client_name || '', client_phone: job?.client_phone || '' }),
                    });
                    setBoqPickerOpen(false);
                    refresh();
                  } catch (e) { setError(e.message); }
                  setBoqImporting(false);
                }} style={{ ...primaryBtn, opacity: boqImporting ? 0.7 : 1 }}>
                  {boqImporting ? 'Importing…' : 'Create draft quote'}
                </button>
              </div>
            )}
          </div>
        )}
        {quotes.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 14, padding: '10px 0' }}>
            No quote on this job yet — price it up and it lands here.
          </div>
        ) : quotes.map(q => {
          const accepted = q.status === 'accepted' || q.status === 'won';
          const tone = accepted ? { bg: t.successBg, fg: t.success }
            : q.status === 'lost' ? { bg: t.dangerBg, fg: t.danger }
            : q.status === 'sent' ? { bg: t.warningBg, fg: t.warning }
            : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
          return (
            <div key={q.id} style={{ borderTop: '1px solid ' + t.border, padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div>
                  <button onClick={() => nav('/estimator/quote/' + q.id)} style={{ background: 'none', border: 'none', padding: 0, color: t.text, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}>
                    Quote · {shortDate(q.created_at)}
                  </button>
                  <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                    {q.project_name}{q.quote_number ? ' · ' + q.quote_number : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt0(q.grand_total)}</div>
                  <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>{q.status === 'accepted' ? 'Accepted' : q.status}</span>
                </div>
              </div>
              {accepted && (
                <button onClick={() => { setInvoiceSheet(q); setPctChoice(25); }} style={{ ...primaryBtn, background: t.success, marginTop: 10 }}>
                  Turn into invoice
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Invoices & payments */}
      <div ref={sections.invoices} style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={sectionTitle}>Invoices & payments</div>
          <button onClick={newInvoice} style={primaryBtn}>+ New invoice</button>
        </div>
        {invoices.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 14, padding: '10px 0' }}>
            No invoices yet — turn the quote into one when you're ready to bill.
          </div>
        ) : invoices.map(inv => {
          const tone = inv.overdue ? { bg: t.dangerBg, fg: t.danger, label: 'Overdue' }
            : inv.status === 'paid' ? { bg: t.successBg, fg: t.success, label: 'Paid' }
            : inv.status === 'sent' ? { bg: t.warningBg, fg: t.warning, label: 'Sent' }
            : inv.status === 'void' ? { bg: 'rgba(148,163,184,0.15)', fg: t.textMuted, label: 'Void' }
            : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary, label: 'Draft' };
          return (
            <div key={inv.id} style={{ borderTop: '1px solid ' + t.border, padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div>
                  <button onClick={() => nav('/invoices/' + inv.id)} style={{ background: 'none', border: 'none', padding: 0, color: t.text, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}>
                    Invoice · {shortDate(inv.issue_date || inv.created_at)}
                  </button>
                  <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                    {inv.due_date ? 'Due ' + shortDate(inv.due_date) : 'No due date'}{inv.invoice_number ? ' · ' + inv.invoice_number : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt0(inv.grand_total)}</div>
                  <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{tone.label}</span>
                </div>
              </div>
              {inv.overdue && (
                <button onClick={() => nav('/invoices/' + inv.id + '?chase=1')} style={{ ...primaryBtn, background: t.danger, marginTop: 10 }}>
                  Chase it
                </button>
              )}
            </div>
          );
        })}

        {/* Payment stages */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid ' + t.border }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textSecondary, marginBottom: 6 }}>
            Staged payments {schedule.total > 0 ? '· paid ' + fmt0(schedule.paid) + ' of ' + fmt0(schedule.total) : ''}
          </div>
          {schedule.stages.length === 0 && (
            <div style={{ color: t.textMuted, fontSize: 13, marginBottom: 8 }}>
              Paid in stages — deposit, first fix, completion? List them here so nothing slips.
            </div>
          )}
          {schedule.stages.map(st => (
            <div key={st.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px dashed ' + t.border }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{st.stage_label || 'Stage'}</div>
                <div style={{ color: t.textMuted, fontSize: 12 }}>{st.due_date ? 'Due ' + shortDate(st.due_date) : (st.due_trigger || '')}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt0(st.amount)}</span>
                {st.status === 'paid' ? (
                  <span style={{ background: t.successBg, color: t.success, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Paid</span>
                ) : (
                  <button onClick={async () => {
                    try { await apiFetch('/payment-schedules/' + st.id + '/mark-paid', { method: 'POST', body: JSON.stringify({}) }); refresh(); } catch (e) { setError(e.message); }
                  }} style={{ ...ghostBtn, minHeight: 36, fontSize: 12 }}>Mark as paid</button>
                )}
                <button onClick={async () => {
                  if (!window.confirm('Delete this stage?')) return;
                  try { await apiFetch('/payment-schedules/' + st.id, { method: 'DELETE' }); refresh(); } catch (e) { setError(e.message); }
                }} style={{ background: 'transparent', color: t.danger, border: 'none', cursor: 'pointer', fontSize: 16, minWidth: 32, minHeight: 32 }}>×</button>
              </div>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
            <input value={newStage.stage_label} onChange={e => setNewStage({ ...newStage, stage_label: e.target.value })} placeholder="e.g. Deposit" style={input} />
            <input type="number" step="any" value={newStage.amount} onChange={e => setNewStage({ ...newStage, amount: e.target.value })} placeholder="£" style={input} />
            <input type="date" value={newStage.due_date} onChange={e => setNewStage({ ...newStage, due_date: e.target.value })} style={input} />
            <button onClick={async () => {
              if (!newStage.stage_label && !newStage.amount) return;
              try {
                await apiFetch('/payment-schedules', { method: 'POST', body: JSON.stringify({
                  job_id: id, stage_label: newStage.stage_label, amount: parseFloat(newStage.amount) || 0,
                  due_date: newStage.due_date || null, due_trigger: newStage.due_trigger || null,
                }) });
                setNewStage({ stage_label: '', amount: '', due_date: '', due_trigger: '' });
                refresh();
              } catch (e) { setError(e.message); }
            }} style={primaryBtn}>+ Add stage</button>
          </div>
        </div>

        {/* Retention lives with the money */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid ' + t.border }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textSecondary, marginBottom: 6 }}>Retention</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="number" step="0.5" min="0" max="50" defaultValue={Number(job.retention_pct) || 0}
              onBlur={e => updateJob({ retention_pct: e.target.value })} style={{ ...input, width: 90 }} aria-label="Retention percent" />
            <span style={{ color: t.textSecondary, fontSize: 13 }}>% held back, due back on</span>
            <input type="date" defaultValue={job.retention_release_date || ''}
              onBlur={e => updateJob({ retention_release_date: e.target.value || null })} style={{ ...input, width: 170 }} aria-label="Retention release date" />
          </div>
          <div style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>
            {Number(job.retention_pct) > 0
              ? "You'll get a reminder on Today when it's due — retention money gets forgotten all the time."
              : 'If the client holds money back until the snags are done, put it here so it never gets forgotten.'}
          </div>
        </div>
      </div>

      {/* Changes (variations) */}
      <div ref={sections.changes} style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={sectionTitle}>Changes to the job</div>
            {variationsApproved > 0 && (
              <div style={{ color: t.success, fontSize: 13, fontWeight: 600, marginTop: -6, marginBottom: 8 }}>
                +{fmt0(variationsApproved)} approved on top of the quote
              </div>
            )}
          </div>
          <button onClick={() => nav('/change-orders/new?job=' + id)} style={primaryBtn}>+ New change</button>
        </div>
        {variations.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 14, padding: '10px 0' }}>
            Client wants something extra, or you've hit a surprise? Price the change here and get it signed off before the work.
          </div>
        ) : variations.map(v => {
          const tone = v.status === 'approved' ? { bg: t.successBg, fg: t.success, label: 'Approved' }
            : v.status === 'declined' ? { bg: t.dangerBg, fg: t.danger, label: 'Declined' }
            : v.status === 'sent' ? { bg: t.warningBg, fg: t.warning, label: 'Waiting for answer' }
            : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary, label: 'Draft' };
          return (
            <div key={v.id} style={{ borderTop: '1px solid ' + t.border, padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div>
                <button onClick={() => nav('/change-orders/' + v.id)} style={{ background: 'none', border: 'none', padding: 0, color: t.text, fontWeight: 700, fontSize: 15, cursor: 'pointer', textAlign: 'left' }}>
                  {v.title || 'Change'}
                </button>
                <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
                  {v.vo_number}{v.approval_name ? ' · signed by ' + v.approval_name : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt0(v.grand_total)}</div>
                <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{tone.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Build schedule (Wave 6 Stage 1) — available to all Office in a Box users */}
      <div ref={sections.schedule} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={sectionTitle}>Build schedule</div>
          <span style={{ background: t.accent + '22', color: t.accent, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Beta</span>
        </div>
        <JobSchedule t={t} jobId={id} quotes={quotes} />
      </div>

      {/* Photos */}
      <div ref={sections.photos} style={card}>
        <div style={sectionTitle}>Photos</div>
        <div style={{ color: t.textMuted, fontSize: 13, marginBottom: 10 }}>
          Snap it before it's covered up — photos can go on a change so the client sees exactly what you found.
        </div>
        <JobPhotos t={t} jobId={id} />
      </div>

      {/* Documents */}
      <div ref={sections.documents} style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={sectionTitle}>Documents</div>
          <button onClick={() => setDocPickerOpen(v => !v)} style={primaryBtn}>{docPickerOpen ? 'Cancel' : '+ New document'}</button>
        </div>
        {docPickerOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 }}>
            {docTemplates.map(tpl => (
              <button key={tpl.id} onClick={async () => {
                try {
                  const r = await apiFetch('/documents', { method: 'POST', body: JSON.stringify({ template_id: tpl.id, job_id: id }) });
                  nav('/documents/' + r.id);
                } catch (e) { setError(e.message); }
              }} style={{ background: t.surface, border: '1px solid ' + t.border, borderRadius: 10, padding: 12, textAlign: 'left', cursor: 'pointer', color: t.text, minHeight: 44 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{tpl.label}</div>
                <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>{tpl.description}</div>
              </button>
            ))}
          </div>
        )}
        {documents.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 14, padding: '10px 0' }}>
            No paperwork on this job yet — contracts, terms and letters made here carry your branding.
          </div>
        ) : documents.map(d => (
          <div key={d.id} style={{ borderTop: '1px solid ' + t.border, padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <button onClick={() => nav('/documents/' + d.id)} style={{ background: 'none', border: 'none', padding: 0, color: t.text, fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>{d.title}</button>
              <div style={{ color: t.textMuted, fontSize: 12 }}>{d.template_label} · {shortDate(d.updated_at || d.created_at)}</div>
            </div>
            <button onClick={() => nav('/documents/' + d.id)} style={{ ...ghostBtn, minHeight: 38, fontSize: 12 }}>Open</button>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div ref={sections.notes} style={card}>
        <div style={sectionTitle}>Notes</div>
        <textarea
          defaultValue={job.notes || ''}
          onBlur={e => updateJob({ notes: e.target.value })}
          rows={4}
          placeholder="Anything worth remembering — gate code, dog's name, where the stopcock is…"
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit', minHeight: 90 }}
        />
        <div style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>Saves by itself when you tap away.</div>
      </div>

      {/* Plan & costs (the job side of Finance) */}
      <div ref={sections.plan} style={card}>
        <div style={sectionTitle}>Plan & costs</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
          <MoneyFig t={t} label="Planned to earn" value={fmt0(totals.plannedRevenue)} />
          <MoneyFig t={t} label="Planned to spend" value={fmt0(totals.plannedCost)} />
          <MoneyFig t={t} label="Spent so far" value={fmt0(totals.actualTotal)} tone={totals.variance > 0 ? 'danger' : undefined} />
          <MoneyFig t={t} label="Against plan" value={(totals.variance >= 0 ? '+' : '−') + fmt0(Math.abs(totals.variance))} tone={totals.variance > 0 ? 'danger' : 'success'} />
        </div>

        <details style={{ marginBottom: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: t.textSecondary, minHeight: 44, display: 'flex', alignItems: 'center' }}>
            Set the plan (what you expect to spend and earn)
          </summary>
          <div style={{ paddingTop: 10 }}>
            <PlanField t={t} label="Labour" value={budget.planned_labour} onChange={v => { setBudget({ ...budget, planned_labour: v }); setBudgetTouched(true); }} />
            <PlanField t={t} label="Materials" value={budget.planned_materials} onChange={v => { setBudget({ ...budget, planned_materials: v }); setBudgetTouched(true); }} />
            <PlanField t={t} label="Overheads" value={budget.planned_overheads} onChange={v => { setBudget({ ...budget, planned_overheads: v }); setBudgetTouched(true); }} />
            <PlanField t={t} label="Other" value={budget.planned_other} onChange={v => { setBudget({ ...budget, planned_other: v }); setBudgetTouched(true); }} />
            <PlanField t={t} label="Your markup %" value={budget.planned_margin_pct} onChange={v => { setBudget({ ...budget, planned_margin_pct: v }); setBudgetTouched(true); }} suffix="%" />
            <PlanField t={t} label="Price to the client" value={budget.planned_revenue} onChange={v => { setBudget({ ...budget, planned_revenue: v }); setBudgetTouched(true); }} placeholder="Worked out from costs + markup if left blank" />
            <button onClick={saveBudget} disabled={!budgetTouched} style={{ ...primaryBtn, marginTop: 8, opacity: budgetTouched ? 1 : 0.5 }}>
              {budgetTouched ? 'Save the plan' : (savedAt ? 'Saved' : 'Saved')}
            </button>
          </div>
        </details>

        <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textSecondary, marginBottom: 6 }}>
          Costs you've logged {costs.length > 0 ? '· materials ' + fmt0(totals.actualByKind.material) + ' · labour ' + fmt0(totals.actualByKind.labour) : ''}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 8 }}>
          <select value={newCost.kind} onChange={e => setNewCost({ ...newCost, kind: e.target.value })} style={input}>
            <option value="material">Materials</option>
            <option value="labour">Labour</option>
            <option value="other">Other</option>
          </select>
          <input value={newCost.description} onChange={e => setNewCost({ ...newCost, description: e.target.value })} style={input} placeholder="What was it? e.g. Bricks (1000)" />
          <input type="number" step="any" value={newCost.unit_cost} onChange={e => setNewCost({ ...newCost, unit_cost: e.target.value, qty: newCost.qty || 1 })} style={input} placeholder="Cost £" />
          <button onClick={addCost} style={primaryBtn}>+ Log it</button>
        </div>
        {costError && <div style={{ color: t.danger, fontSize: 12, marginBottom: 8 }}>{costError}</div>}
        {costs.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 13, padding: '6px 0' }}>
            Log what you spend as you go and you'll always know if the job's still making money.
          </div>
        ) : costs.map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px dashed ' + t.border, fontSize: 13 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{c.description}</span>
              <span style={{ color: t.textMuted }}> · {c.kind}{c.vendor ? ' · ' + c.vendor : ''}{c.occurred_on ? ' · ' + shortDate(c.occurred_on) : ''}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(c.total)}</span>
              <button onClick={() => removeCost(c.id)} style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 16, minWidth: 32, minHeight: 32 }}>×</button>
            </div>
          </div>
        ))}
      </div>
      {/* B5 — how much of the quote to invoice */}
      {invoiceSheet && (() => {
        const exVat = num(invoiceSheet.grand_total) - num(invoiceSheet.vat_amount || 0);
        const unpaidStages = (schedule.stages || []).filter(st => st.status === 'unpaid' && !st.invoice_id);
        return (
          <div onClick={() => setInvoiceSheet(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: t.card, color: t.text, width: '100%', maxWidth: 520,
              borderRadius: '16px 16px 0 0', padding: '20px 20px calc(24px + env(safe-area-inset-bottom))',
              border: '1px solid ' + t.border, borderBottom: 'none', boxSizing: 'border-box',
              maxHeight: '85vh', overflowY: 'auto',
            }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>How much do you want to invoice?</div>
              <div style={{ color: t.textSecondary, fontSize: 13.5, marginBottom: 16 }}>
                The quote came to {fmt0(invoiceSheet.grand_total)} ({fmt0(exVat)} before VAT).
              </div>

              <button onClick={() => createFromQuote(invoiceSheet, 100)} style={{ ...primaryBtn, width: '100%', minHeight: 52, marginBottom: 10 }}>
                The full amount — {fmt0(invoiceSheet.grand_total)}
              </button>

              {unpaidStages.map(st => (
                <button key={st.id} onClick={() => createFromStage(st)} style={{ ...ghostBtn, width: '100%', minHeight: 52, marginBottom: 10, textAlign: 'left', paddingLeft: 16 }}>
                  {(st.stage_label || 'Stage')} from your payment plan — {fmt0(st.amount)}
                </button>
              ))}

              <div style={{ border: '1px solid ' + t.border, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Or a part of it</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {[25, 50, 75].map(p => (
                    <button key={p} onClick={() => setPctChoice(p)} style={{
                      flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 15,
                      background: pctChoice === p ? t.accent : 'transparent',
                      color: pctChoice === p ? '#fff' : t.text,
                      border: '1px solid ' + (pctChoice === p ? t.accent : t.border),
                    }}>{p}%</button>
                  ))}
                  <input type="number" min="1" max="99" value={pctChoice}
                    onChange={e => setPctChoice(Math.min(99, Math.max(1, num(e.target.value, 25))))}
                    style={{ width: 70, minHeight: 44, borderRadius: 10, border: '1px solid ' + t.border, background: t.bg, color: t.text, textAlign: 'center', fontSize: 16, outline: 'none' }} />
                </div>
                <button onClick={() => createFromQuote(invoiceSheet, pctChoice, pctChoice === 25 ? 'Deposit' : null)}
                  style={{ ...primaryBtn, width: '100%', minHeight: 48 }}>
                  Invoice {pctChoice}% — {fmt0(exVat * pctChoice / 100)} + VAT
                </button>
              </div>

              <button onClick={() => setInvoiceSheet(null)} style={{ width: '100%', minHeight: 44, marginTop: 10, background: 'transparent', border: 'none', color: t.textSecondary, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function MoneyFig({ t, label, value, tone }) {
  const colour = tone === 'danger' ? t.danger : tone === 'success' ? t.success : tone === 'warning' ? t.warning : t.text;
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ color: t.textSecondary, fontSize: 11.5, fontWeight: 600 }}>{label}</div>
      <div style={{ color: colour, fontSize: 18, fontWeight: 800, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function PlanField({ t, label, value, onChange, suffix, placeholder }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <label style={{ color: t.textSecondary, fontSize: 13.5 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type="number" step="any"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px',
            background: t.bg, border: '1px solid ' + t.border, color: t.text,
            borderRadius: 10, fontSize: 14, outline: 'none', textAlign: 'right',
            paddingRight: suffix ? 24 : 12,
          }}
        />
        {suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: t.textMuted, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

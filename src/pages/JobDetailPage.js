import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

const STATUS = ['planned', 'active', 'completed', 'cancelled'];
function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmt(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt0(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function todayIso() { const d = new Date(); return d.toISOString().slice(0, 10); }

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
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  // Computed totals
  const totals = useMemo(() => {
    const plannedCost = num(budget.planned_labour) + num(budget.planned_materials) + num(budget.planned_overheads) + num(budget.planned_other);
    const plannedRevenue = budget.planned_revenue !== '' && budget.planned_revenue != null
      ? num(budget.planned_revenue)
      : plannedCost * (1 + num(budget.planned_margin_pct) / 100);
    const plannedProfit = plannedRevenue - plannedCost;
    const plannedMarginPct = plannedRevenue > 0 ? (plannedProfit / plannedRevenue) * 100 : 0;
    const actualByKind = { material: 0, labour: 0, other: 0 };
    for (const c of costs) actualByKind[c.kind] = (actualByKind[c.kind] || 0) + num(c.total);
    const actualTotal = actualByKind.material + actualByKind.labour + actualByKind.other;
    const variance = actualTotal - plannedCost;
    const variancePct = plannedCost > 0 ? (variance / plannedCost) * 100 : 0;
    return { plannedCost, plannedRevenue, plannedProfit, plannedMarginPct, actualByKind, actualTotal, variance, variancePct };
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
    if (!newCost.description.trim()) { setCostError('Description required'); return; }
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
    if (!window.confirm('Delete this job, its budget, and all recorded costs? This cannot be undone.')) return;
    try {
      await apiFetch('/finance/jobs/' + id, { method: 'DELETE' });
      nav('/finance/jobs');
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  if (!job) return <div style={{ padding: 40, color: t.danger }}>Job not found.</div>;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <button onClick={() => nav('/finance/jobs')} style={{ background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← Jobs</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>{job.name}</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            {job.client_name || 'No client'} {job.project_type ? ' · ' + job.project_type : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={job.status} onChange={e => updateJob({ status: e.target.value })} style={fld(t, true)}>
            {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={deleteJob} style={{ ...btn(t), color: t.danger }}>Delete job</button>
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {/* Variance strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Stat t={t} label="Planned revenue" value={fmt0(totals.plannedRevenue)} />
        <Stat t={t} label="Planned cost" value={fmt0(totals.plannedCost)} />
        <Stat t={t} label="Planned profit" value={fmt0(totals.plannedProfit)} tone={totals.plannedProfit < 0 ? 'danger' : 'success'} />
        <Stat t={t} label="Actual cost" value={fmt0(totals.actualTotal)} />
        <Stat t={t} label="Variance" value={fmt0(totals.variance) + (totals.plannedCost > 0 ? ' (' + (totals.variance >= 0 ? '+' : '') + totals.variancePct.toFixed(1) + '%)' : '')} tone={totals.variance > 0 ? 'danger' : 'success'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Budget editor */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Planned budget</div>
            <button onClick={saveBudget} disabled={!budgetTouched} style={{ background: budgetTouched ? t.accent : t.surface, color: budgetTouched ? '#fff' : t.textMuted, border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: budgetTouched ? 'pointer' : 'default' }}>
              {budgetTouched ? 'Save budget' : (savedAt ? 'Saved' : 'Saved')}
            </button>
          </div>
          <BudgetField t={t} label="Labour"     value={budget.planned_labour}    onChange={v => { setBudget({ ...budget, planned_labour: v });    setBudgetTouched(true); }} />
          <BudgetField t={t} label="Materials"  value={budget.planned_materials} onChange={v => { setBudget({ ...budget, planned_materials: v }); setBudgetTouched(true); }} />
          <BudgetField t={t} label="Overheads"  value={budget.planned_overheads} onChange={v => { setBudget({ ...budget, planned_overheads: v }); setBudgetTouched(true); }} />
          <BudgetField t={t} label="Other"      value={budget.planned_other}     onChange={v => { setBudget({ ...budget, planned_other: v });     setBudgetTouched(true); }} />
          <BudgetField t={t} label="Margin %"   value={budget.planned_margin_pct} onChange={v => { setBudget({ ...budget, planned_margin_pct: v }); setBudgetTouched(true); }} suffix="%" />
          <BudgetField t={t} label="Revenue (override)" value={budget.planned_revenue} onChange={v => { setBudget({ ...budget, planned_revenue: v }); setBudgetTouched(true); }} placeholder="Auto: cost × (1 + margin%)" />
          <label style={lbl(t, 8)}>Notes</label>
          <textarea value={budget.notes} onChange={e => { setBudget({ ...budget, notes: e.target.value }); setBudgetTouched(true); }} rows={2} style={ta(t)} />
        </div>

        {/* Linked quotes */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>Linked quotes</div>
          {quotes.length === 0 ? (
            <div style={{ color: t.textMuted, fontSize: 13 }}>
              No quotes linked yet. Open a quote in the estimator and use the "Link to job" picker.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {quotes.map(q => (
                <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid ' + t.border }}>
                  <div>
                    <a href="#" onClick={(e) => { e.preventDefault(); nav('/estimator/quote/' + q.id); }} style={{ color: t.accent, textDecoration: 'none', fontWeight: 600 }}>{q.quote_number || q.id.slice(0, 8)}</a>
                    <div style={{ color: t.textMuted, fontSize: 12 }}>{q.project_name} · {q.status}</div>
                  </div>
                  <div style={{ fontVariantNumeric: 'tabular-nums', color: t.text, fontWeight: 600 }}>{fmt0(q.grand_total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Variations / change orders */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Variations / change orders</div>
            <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>
              Approved variations add to the contract value. Original quote + variations = total contract.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {variationsApproved > 0 && (
              <div style={{ color: t.success, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                +{fmt0(variationsApproved)} approved
              </div>
            )}
            <button onClick={() => nav('/change-orders/new?job=' + id)} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ New variation</button>
          </div>
        </div>
        {variations.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 13, padding: '8px 0' }}>No variations on this job yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: t.textSecondary }}>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>VO</th>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Total</th>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Approved by</th>
                  <th style={{ padding: '6px 0' }}></th>
                </tr>
              </thead>
              <tbody>
                {variations.map(v => {
                  const tone = v.status === 'approved' ? { bg: t.successBg, fg: t.success }
                    : v.status === 'declined' ? { bg: t.dangerBg, fg: t.danger }
                    : v.status === 'sent' ? { bg: t.warningBg, fg: t.warning }
                    : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
                  return (
                    <tr key={v.id} style={{ borderTop: '1px solid ' + t.border }}>
                      <td style={{ padding: '10px 0', fontWeight: 600 }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); nav('/change-orders/' + v.id); }} style={{ color: t.accent, textDecoration: 'none' }}>{v.vo_number}</a>
                      </td>
                      <td style={{ padding: '10px 0' }}>{v.title || <span style={{ color: t.textMuted }}>—</span>}</td>
                      <td style={{ padding: '10px 0' }}>
                        <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{v.status}</span>
                      </td>
                      <td style={{ padding: '10px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt0(v.grand_total)}</td>
                      <td style={{ padding: '10px 0', color: t.textSecondary }}>
                        {v.approval_name ? <>{v.approval_name} · <span style={{ fontSize: 11 }}>{v.approval_at}</span></> : '—'}
                      </td>
                      <td style={{ padding: '10px 0', textAlign: 'right' }}>
                        <button onClick={() => nav('/change-orders/' + v.id)} style={{ background: 'transparent', border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Open</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Costs */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Actual costs</div>
          <div style={{ color: t.textMuted, fontSize: 12 }}>
            Materials {fmt0(totals.actualByKind.material)} · Labour {fmt0(totals.actualByKind.labour)} · Other {fmt0(totals.actualByKind.other)}
          </div>
        </div>

        {/* Add row */}
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px 80px 110px 140px 130px 90px', gap: 6, alignItems: 'end', marginBottom: 12 }}>
          <div>
            <label style={lbl(t)}>Kind</label>
            <select value={newCost.kind} onChange={e => setNewCost({ ...newCost, kind: e.target.value })} style={fld(t)}>
              <option value="material">Material</option>
              <option value="labour">Labour</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={lbl(t)}>Description *</label>
            <input value={newCost.description} onChange={e => setNewCost({ ...newCost, description: e.target.value })} style={fld(t)} placeholder="e.g. Bricks (1000)" />
          </div>
          <div>
            <label style={lbl(t)}>Qty</label>
            <input type="number" step="any" value={newCost.qty} onChange={e => setNewCost({ ...newCost, qty: e.target.value })} style={fld(t)} />
          </div>
          <div>
            <label style={lbl(t)}>Unit</label>
            <input value={newCost.unit} onChange={e => setNewCost({ ...newCost, unit: e.target.value })} style={fld(t)} />
          </div>
          <div>
            <label style={lbl(t)}>Unit cost £</label>
            <input type="number" step="any" value={newCost.unit_cost} onChange={e => setNewCost({ ...newCost, unit_cost: e.target.value })} style={fld(t)} />
          </div>
          <div>
            <label style={lbl(t)}>Vendor</label>
            <input value={newCost.vendor} onChange={e => setNewCost({ ...newCost, vendor: e.target.value })} style={fld(t)} placeholder="e.g. Travis Perkins" />
          </div>
          <div>
            <label style={lbl(t)}>Date</label>
            <input type="date" value={newCost.occurred_on} onChange={e => setNewCost({ ...newCost, occurred_on: e.target.value })} style={fld(t)} />
          </div>
          <button onClick={addCost} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 10px', fontWeight: 600, cursor: 'pointer' }}>+ Add</button>
        </div>
        {costError && <div style={{ color: t.danger, fontSize: 12, marginBottom: 8 }}>{costError}</div>}

        {costs.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 13, padding: '12px 0' }}>No costs recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: t.textSecondary }}>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Kind</th>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Unit</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Unit cost</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Total</th>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Vendor</th>
                  <th style={{ padding: '6px 0' }}></th>
                </tr>
              </thead>
              <tbody>
                {costs.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid ' + t.border }}>
                    <td style={{ padding: '8px 0', color: t.textSecondary }}>{c.occurred_on || (c.created_at && c.created_at.slice(0, 10))}</td>
                    <td style={{ padding: '8px 0', textTransform: 'capitalize' }}>{c.kind}</td>
                    <td style={{ padding: '8px 0' }}>{c.description}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right' }}>{c.qty}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right' }}>{c.unit}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.unit_cost)}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(c.total)}</td>
                    <td style={{ padding: '8px 0', color: t.textSecondary }}>{c.vendor || '—'}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right' }}>
                      <button onClick={() => removeCost(c.id)} style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ t, label, value, tone }) {
  const c = tone === 'danger' ? t.danger : tone === 'success' ? t.success : t.text;
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ color: t.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ color: c, fontSize: 18, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function BudgetField({ t, label, value, onChange, suffix, placeholder }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <label style={{ color: t.textSecondary, fontSize: 13 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type="number" step="any"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...fld(t), textAlign: 'right', paddingRight: suffix ? 20 : 10 }}
        />
        {suffix && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: t.textMuted, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function fld(t, narrow) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: narrow ? '6px 8px' : '8px 10px', fontSize: 13, outline: 'none' }; }
function ta(t)  { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }; }
function lbl(t, mt) { return { display: 'block', color: t.textSecondary, fontSize: 11, marginBottom: 4, marginTop: mt || 0 }; }
function btn(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }; }

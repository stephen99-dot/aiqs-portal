import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

const STATUS = ['planned', 'active', 'completed', 'cancelled'];
function fmt(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

function statusColour(s, t) {
  switch (s) {
    case 'active':    return { bg: t.warningBg, fg: t.warning };
    case 'completed': return { bg: t.successBg, fg: t.success };
    case 'cancelled': return { bg: t.dangerBg,  fg: t.danger };
    default:          return { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  }
}

export default function JobsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', client_name: '', project_type: '' });

  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/finance/jobs');
      setJobs(r.jobs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!newJob.name.trim()) return;
    try {
      const r = await apiFetch('/finance/jobs', { method: 'POST', body: JSON.stringify(newJob) });
      setCreating(false);
      setNewJob({ name: '', client_name: '', project_type: '' });
      nav('/finance/jobs/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const setStatus = async (id, status) => {
    try {
      await apiFetch('/finance/jobs/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
      refresh();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <button onClick={() => nav('/finance')} style={{ background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← Finance dashboard</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Jobs</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            A job is the umbrella for one piece of work — its quotes, budget, and actual costs.
          </div>
        </div>
        <button onClick={() => setCreating(v => !v)} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>{creating ? 'Cancel' : '+ New job'}</button>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {creating && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 120px', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={lbl(t)}>Job name *</label>
              <input value={newJob.name} onChange={e => setNewJob({ ...newJob, name: e.target.value })} placeholder="Smith kitchen extension" style={fld(t)} />
            </div>
            <div>
              <label style={lbl(t)}>Client name</label>
              <input value={newJob.client_name} onChange={e => setNewJob({ ...newJob, client_name: e.target.value })} placeholder="Mr & Mrs Smith" style={fld(t)} />
            </div>
            <div>
              <label style={lbl(t)}>Project type</label>
              <input value={newJob.project_type} onChange={e => setNewJob({ ...newJob, project_type: e.target.value })} placeholder="extension" style={fld(t)} />
            </div>
            <button onClick={create} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' }}>Create</button>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 40, textAlign: 'center', color: t.textSecondary }}>
          No jobs yet. Create one to start tracking budgets and actuals.
        </div>
      ) : (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: t.surface, color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  <th style={th}>Job</th>
                  <th style={th}>Client</th>
                  <th style={{ ...th, textAlign: 'right' }}>Planned cost</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actual</th>
                  <th style={{ ...th, textAlign: 'right' }}>Variance</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: 'right' }}>Quotes</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const planned = (j.planned_labour || 0) + (j.planned_materials || 0) + (j.planned_overheads || 0) + (j.planned_other || 0);
                  const actual = j.actual_total || 0;
                  const variance = actual - planned;
                  const sc = statusColour(j.status, t);
                  return (
                    <tr key={j.id} style={{ borderTop: '1px solid ' + t.border }}>
                      <td style={td}>
                        <a href="#" onClick={(e) => { e.preventDefault(); nav('/finance/jobs/' + j.id); }} style={{ color: t.accent, textDecoration: 'none', fontWeight: 600 }}>{j.name}</a>
                      </td>
                      <td style={td}>{j.client_name || <span style={{ color: t.textMuted }}>—</span>}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{planned ? fmt(planned) : <span style={{ color: t.textMuted }}>—</span>}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(actual)}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: planned && variance > 0 ? t.danger : t.text }}>
                        {planned ? fmt(variance) : '—'}
                      </td>
                      <td style={td}>
                        <select value={j.status} onChange={e => setStatus(j.id, e.target.value)} style={{ background: sc.bg, color: sc.fg, border: '1px solid ' + sc.fg + '33', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize', cursor: 'pointer' }}>
                          {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{j.quote_count || 0}</td>
                      <td style={td}>
                        <button onClick={() => nav('/finance/jobs/' + j.id)} style={btn(t)}>Open</button>
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

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const td = { padding: '12px 14px', fontSize: 14 };
function fld(t) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }; }
function lbl(t) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }; }
function btn(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }; }

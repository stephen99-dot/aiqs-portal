import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, getToken } from '../utils/api';

// ── Wave 6 / Stage 1: build schedule on the job page (admin only) ───────────
// Generate a programme from the job's quote, view it as a timeline, edit task
// durations/order/status (dates re-flow on the server), and export a PDF.

function dayIndex(iso) {
  if (!iso) return null;
  const p = String(iso).slice(0, 10).split('-').map(Number);
  if (!p[0]) return null;
  return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}
function shortDate(iso) {
  if (!iso) return '—';
  const p = String(iso).slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function todayIso() { return new Date().toISOString().slice(0, 10); }

const STATUS_OPTS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

export default function JobSchedule({ t, jobId, quotes }) {
  const [plan, setPlan] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [win, setWin] = useState({ start: null, end: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [newTask, setNewTask] = useState({ name: '', phase: '', duration_days: 1 });

  const hasQuote = (quotes || []).length > 0;

  const loadDetail = useCallback(async (planId) => {
    const d = await apiFetch('/schedule/plans/' + planId);
    setPlan(d.plan);
    setTasks(d.tasks || []);
    setWin(d.window || { start: null, end: null });
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/schedule/plans?job_id=' + jobId);
      const plans = r.plans || [];
      if (plans.length === 0) { setPlan(null); setTasks([]); }
      else await loadDetail(plans[0].id);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [jobId, loadDetail]);

  useEffect(() => { refresh(); }, [refresh]);

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/schedule/plans', {
        method: 'POST',
        body: JSON.stringify({ job_id: jobId, start_date: startDate }),
      });
      await loadDetail(r.id);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const regenerate = async () => {
    if (!plan) return;
    if (!window.confirm('Replace this schedule with a fresh one from the quote? Your edits will be lost.')) return;
    setBusy(true); setError('');
    try {
      await apiFetch('/schedule/plans/' + plan.id, { method: 'DELETE' });
      const r = await apiFetch('/schedule/plans', {
        method: 'POST', body: JSON.stringify({ job_id: jobId, start_date: plan.start_date || startDate }),
      });
      await loadDetail(r.id);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const deletePlan = async () => {
    if (!plan) return;
    if (!window.confirm('Delete this whole schedule?')) return;
    try {
      await apiFetch('/schedule/plans/' + plan.id, { method: 'DELETE' });
      setPlan(null); setTasks([]);
    } catch (e) { setError(e.message); }
  };

  const patchPlan = async (patch) => {
    if (!plan) return;
    try {
      await apiFetch('/schedule/plans/' + plan.id, { method: 'PATCH', body: JSON.stringify(patch) });
      await loadDetail(plan.id);
    } catch (e) { setError(e.message); }
  };

  // reflow=true means the change moved dates on the server — reload to get them.
  const patchTask = async (taskId, patch, reflow) => {
    try {
      await apiFetch('/schedule/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify(patch) });
      if (reflow) await loadDetail(plan.id);
      else setTasks(prev => prev.map(x => x.id === taskId ? { ...x, ...patch } : x));
    } catch (e) { setError(e.message); }
  };

  const deleteTask = async (taskId) => {
    try {
      await apiFetch('/schedule/tasks/' + taskId, { method: 'DELETE' });
      await loadDetail(plan.id);
    } catch (e) { setError(e.message); }
  };

  const addTask = async () => {
    const name = newTask.name.trim();
    if (!name) return;
    try {
      await apiFetch('/schedule/plans/' + plan.id + '/tasks', {
        method: 'POST',
        body: JSON.stringify({ name, phase: newTask.phase || null, duration_days: Number(newTask.duration_days) || 1 }),
      });
      setNewTask({ name: '', phase: '', duration_days: 1 });
      await loadDetail(plan.id);
    } catch (e) { setError(e.message); }
  };

  const exportPdf = () => {
    if (!plan) return;
    fetch('/api/schedule/plans/' + plan.id + '/export', { headers: { Authorization: 'Bearer ' + getToken() } })
      .then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (plan.title || 'build-programme').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(e => setError(e.message));
  };

  // ── styles ──
  const primaryBtn = { minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
  const ghostBtn = { minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid ' + t.border, background: 'transparent', color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const input = { boxSizing: 'border-box', minHeight: 40, padding: '8px 10px', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 10, fontSize: 14, outline: 'none' };

  if (loading) return <div style={{ color: t.textMuted, fontSize: 14, padding: '10px 0' }}>Loading schedule…</div>;

  // Timeline geometry.
  const win0 = win.start ? dayIndex(win.start) : 0;
  const win1 = win.end ? dayIndex(win.end) : 0;
  const span = Math.max(1, win1 - win0 + 1);
  const barFor = (task) => {
    const s = dayIndex(task.planned_start);
    const e = dayIndex(task.planned_end);
    if (s == null || e == null || !win.start) return null;
    const left = ((s - win0) / span) * 100;
    const width = Math.max(2, ((e - s + 1) / span) * 100);
    return { left: left + '%', width: width + '%' };
  };
  const barColour = (status) => status === 'done' ? t.success
    : status === 'in_progress' ? t.accent
    : status === 'blocked' ? t.danger
    : t.textSecondary;

  // ── Empty state ──
  if (!plan) {
    return (
      <div>
        <div style={{ color: t.textMuted, fontSize: 13.5, marginBottom: 12, lineHeight: 1.5 }}>
          Turn the quote into a build programme. The AI sequences the priced work into phases with
          durations and dependencies — then you tweak it, and the dates re-flow.
        </div>
        {error && <div style={{ color: t.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {hasQuote ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: t.textSecondary }}>Start</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={input} />
            <button onClick={generate} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Generating…' : 'Generate build schedule'}
            </button>
          </div>
        ) : (
          <div style={{ color: t.textMuted, fontSize: 14 }}>
            Add a quote to this job first — the schedule is built from its priced line items.
          </div>
        )}
      </div>
    );
  }

  // ── With a plan ──
  let lastPhase = null;
  return (
    <div>
      {error && <div style={{ color: t.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{plan.title}</div>
          <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2 }}>
            {win.start ? shortDate(win.start) + ' → ' + shortDate(win.end) : 'No dated tasks'} · {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportPdf} style={ghostBtn}>Export PDF</button>
          <button onClick={regenerate} disabled={busy} style={ghostBtn}>{busy ? '…' : 'Regenerate'}</button>
          <button onClick={deletePlan} style={{ ...ghostBtn, color: t.danger, borderColor: t.danger + '55' }}>Delete</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: t.textSecondary }}>Start date</label>
        <input type="date" defaultValue={plan.start_date || ''} onBlur={e => { if (e.target.value !== plan.start_date) patchPlan({ start_date: e.target.value }); }} style={input} />
      </div>

      {/* Timeline */}
      <div style={{ overflowX: 'auto' }}>
        {tasks.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 14, padding: '8px 0' }}>No tasks yet — add one below.</div>
        ) : tasks.map(task => {
          const showPhase = (task.phase || '') !== (lastPhase || '');
          lastPhase = task.phase || '';
          const bar = barFor(task);
          return (
            <React.Fragment key={task.id}>
              {showPhase && task.phase && (
                <div style={{ fontSize: 12, fontWeight: 800, color: t.accent, textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 4px' }}>
                  {task.phase}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) 2fr auto', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid ' + t.border }}>
                {/* Name + duration */}
                <div style={{ minWidth: 0 }}>
                  <input
                    defaultValue={task.name}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== task.name) patchTask(task.id, { name: e.target.value.trim() }, false); }}
                    style={{ ...input, width: '100%', minHeight: 36, fontWeight: 600 }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <input
                      type="number" min="1" step="1" defaultValue={task.duration_days}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v !== task.duration_days) patchTask(task.id, { duration_days: v }, true); }}
                      style={{ ...input, width: 56, minHeight: 32, padding: '4px 8px' }}
                    />
                    <span style={{ fontSize: 12, color: t.textMuted }}>days · {shortDate(task.planned_start)}–{shortDate(task.planned_end)}</span>
                  </div>
                </div>

                {/* Bar */}
                <div style={{ position: 'relative', height: 26, background: t.bg, borderRadius: 6, border: '1px solid ' + t.border }}>
                  {bar && (
                    <div title={shortDate(task.planned_start) + ' – ' + shortDate(task.planned_end)} style={{
                      position: 'absolute', top: 4, bottom: 4, ...bar,
                      background: barColour(task.status), borderRadius: 4, opacity: 0.9,
                    }} />
                  )}
                </div>

                {/* Status + % + delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select value={task.status} onChange={e => patchTask(task.id, { status: e.target.value }, false)} style={{ ...input, minHeight: 34, padding: '4px 6px', fontSize: 12.5 }}>
                    {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button onClick={() => deleteTask(task.id)} title="Delete task" style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 16, minWidth: 30, minHeight: 30 }}>×</button>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Add a task */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(100px,0.8fr) 70px auto', gap: 8, marginTop: 14 }}>
        <input value={newTask.name} onChange={e => setNewTask({ ...newTask, name: e.target.value })} placeholder="New task" style={input} />
        <input value={newTask.phase} onChange={e => setNewTask({ ...newTask, phase: e.target.value })} placeholder="Phase (optional)" style={input} />
        <input type="number" min="1" value={newTask.duration_days} onChange={e => setNewTask({ ...newTask, duration_days: e.target.value })} placeholder="days" style={input} />
        <button onClick={addTask} style={primaryBtn}>+ Add</button>
      </div>
      <div style={{ color: t.textMuted, fontSize: 11.5, marginTop: 8 }}>
        New tasks run after the current programme. Edit durations and the dates re-flow automatically.
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, getToken } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import useIsMobile from '../utils/useIsMobile';
import AsyncButton from './AsyncButton';

// Compact markdown so the assistant's bold/lists render nicely in a small bubble
// instead of showing raw ** and 1. markers.
const MD_COMPONENTS = {
  p: (props) => <p style={{ margin: '0 0 4px' }} {...props} />,
  ul: (props) => <ul style={{ margin: '4px 0', paddingLeft: 18 }} {...props} />,
  ol: (props) => <ol style={{ margin: '4px 0', paddingLeft: 18 }} {...props} />,
  li: (props) => <li style={{ margin: '2px 0' }} {...props} />,
  strong: (props) => <strong style={{ fontWeight: 700 }} {...props} />,
  code: (props) => <code style={{ fontFamily: 'monospace', fontSize: '0.92em' }} {...props} />,
};

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
function fmtMoney(n) {
  const v = Number(n) || 0;
  return '£' + Math.round(v).toLocaleString('en-GB');
}

const STATUS_OPTS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

export default function JobSchedule({ t, jobId, quotes }) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [plan, setPlan] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [win, setWin] = useState({ start: null, end: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [newTask, setNewTask] = useState({ name: '', phase: '', duration_days: 1 });

  // Stage 2: conversational progress updates.
  const [chat, setChat] = useState([]); // [{ role, content }]
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState(null);

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
    const oldId = plan.id;
    try {
      // Create the new plan first; only remove the old one once that succeeds,
      // so a failed AI call never leaves the job with no schedule.
      const r = await apiFetch('/schedule/plans', {
        method: 'POST', body: JSON.stringify({ job_id: jobId, start_date: plan.start_date || startDate }),
      });
      try { await apiFetch('/schedule/plans/' + oldId, { method: 'DELETE' }); } catch (e) { /* leave the old one if cleanup fails */ }
      setChat([]);
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
    setSavingTaskId(taskId);
    try {
      await apiFetch('/schedule/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify(patch) });
      if (reflow) await loadDetail(plan.id);
      else setTasks(prev => prev.map(x => x.id === taskId ? { ...x, ...patch } : x));
    } catch (e) { setError(e.message); }
    finally { setSavingTaskId(null); }
  };

  const deleteTask = async (taskId) => {
    setSavingTaskId(taskId);
    try {
      await apiFetch('/schedule/tasks/' + taskId, { method: 'DELETE' });
      await loadDetail(plan.id);
    } catch (e) { setError(e.message); }
    finally { setSavingTaskId(null); }
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

  const sendChat = async () => {
    const message = chatInput.trim();
    if (!message || sending) return;
    setSending(true); setError('');
    // Send recent turns for context, but never the error bubbles.
    const history = chat.filter(m => !(m.role === 'assistant' && m.content.startsWith('⚠️'))).slice(-6);
    setChat(prev => [...prev, { role: 'user', content: message }]);
    setChatInput('');
    try {
      const r = await apiFetch('/schedule/plans/' + plan.id + '/assistant', {
        method: 'POST', body: JSON.stringify({ message, history }),
      });
      setChat(prev => [...prev, { role: 'assistant', content: r.reply || 'Done.' }]);
      if (r.tasks) setTasks(r.tasks);
      if (r.window) setWin(r.window);
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: '⚠️ ' + e.message }]);
    } finally { setSending(false); }
  };

  const exportPdf = async () => {
    if (!plan || downloading) return;
    setDownloading(true); setError('');
    try {
      const r = await fetch('/api/schedule/plans/' + plan.id + '/export', { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!r.ok) throw new Error('Download failed');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (plan.title || 'build-programme').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
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

  // "Today" marker position across the programme window, and at-a-glance metrics.
  const todayIdx = dayIndex(todayIso());
  const todayPct = (win.start && todayIdx != null && todayIdx >= win0 && todayIdx <= win1 + 1)
    ? ((todayIdx - win0) / span) * 100 : null;
  const behindCount = tasks.filter(x => (Number(x.lag_days) || 0) > 0 || x.status === 'blocked').length;
  const doneCount = tasks.filter(x => x.status === 'done').length;

  // Month ticks across the window — gives the timeline a real date scale.
  const months = [];
  if (win.start && win.end) {
    const p = String(win.start).slice(0, 10).split('-').map(Number);
    let cur = new Date(Date.UTC(p[0], p[1] - 1, 1));
    let guard = 0;
    while (guard++ < 60) {
      const idx = Math.floor(cur.getTime() / 86400000);
      if (idx > win1) break;
      if (idx >= win0) months.push({ pct: ((idx - win0) / span) * 100, label: cur.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) });
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  }

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
          <button onClick={exportPdf} disabled={downloading} style={{ ...ghostBtn, opacity: downloading ? 0.6 : 1 }}>{downloading ? 'Preparing…' : 'Export PDF'}</button>
          <button onClick={regenerate} disabled={busy} style={ghostBtn}>{busy ? '…' : 'Regenerate'}</button>
          <button onClick={deletePlan} style={{ ...ghostBtn, color: t.danger, borderColor: t.danger + '55' }}>Delete</button>
        </div>
      </div>

      {/* At-a-glance metrics */}
      {tasks.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 12 }}>
          <Stat t={t} label="Completion" value={win.end ? shortDate(win.end) : '—'} />
          <Stat t={t} label="Progress" value={doneCount + ' / ' + tasks.length} />
          <Stat t={t} label="Status"
            value={behindCount > 0 ? behindCount + ' behind' : 'On track'}
            tone={behindCount > 0 ? 'warn' : 'ok'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: t.textSecondary }}>Start date</label>
          <input type="date" defaultValue={plan.start_date || ''} onBlur={e => { if (e.target.value !== plan.start_date) patchPlan({ start_date: e.target.value }); }} style={input} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: t.textMuted, alignItems: 'center' }}>
          <Legend t={t} colour={t.success} label="Done" />
          <Legend t={t} colour={t.accent} label="In progress" />
          <Legend t={t} colour={t.danger} label="Blocked" />
          <Legend t={t} colour={t.textSecondary} label="To do" />
          {todayPct != null && <Legend t={t} colour={t.danger} label="Today" line />}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ overflowX: 'auto' }}>
        {tasks.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : 'minmax(160px, 1.4fr) 2fr auto', gap: 10, alignItems: 'flex-end', paddingBottom: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>Task &amp; duration</div>
            {!isMobile && (
              <div style={{ position: 'relative', height: 14 }}>
                {months.map((m, i) => (
                  <span key={i} style={{ position: 'absolute', left: m.pct + '%', fontSize: 10, color: t.textMuted, whiteSpace: 'nowrap' }}>{m.label}</span>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: 'right' }}>Status</div>
          </div>
        )}
        {tasks.length === 0 ? (
          <div style={{ color: t.textMuted, fontSize: 14, padding: '8px 0' }}>No tasks yet — add one below.</div>
        ) : tasks.map(task => {
          const showPhase = (task.phase || '') !== (lastPhase || '');
          lastPhase = task.phase || '';
          const bar = barFor(task);
          const saving = savingTaskId === task.id;
          return (
            <React.Fragment key={task.id}>
              {showPhase && task.phase && (
                <div style={{ fontSize: 12, fontWeight: 800, color: t.accent, textTransform: 'uppercase', letterSpacing: 0.4, margin: '12px 0 4px' }}>
                  {task.phase}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : 'minmax(160px, 1.4fr) 2fr auto', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid ' + t.border, opacity: saving ? 0.55 : 1, transition: 'opacity 0.15s' }}>
                {/* Name + duration */}
                <div style={{ minWidth: 0 }}>
                  <input
                    defaultValue={task.name}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== task.name) patchTask(task.id, { name: e.target.value.trim() }, false); }}
                    style={{ ...input, width: '100%', minHeight: 36, fontWeight: 600 }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <input
                      type="number" inputMode="decimal" min="1" step="1" defaultValue={task.duration_days}
                      onBlur={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v !== task.duration_days) patchTask(task.id, { duration_days: v }, true); }}
                      style={{ ...input, width: 56, minHeight: 32, padding: '4px 8px' }}
                    />
                    <span style={{ fontSize: 12, color: t.textMuted }}>days · {shortDate(task.planned_start)}–{shortDate(task.planned_end)}</span>
                    {Number(task.lag_days) > 0 && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: t.warning, background: t.warningBg, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                        +{task.lag_days}d late
                      </span>
                    )}
                    {isAdmin && task.variation_id && (
                      <span title="Auto-added from an approved change order" style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, background: t.accent + '22', padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                        change order{Number(task.cost_amount) > 0 ? ' · ' + fmtMoney(task.cost_amount) : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bar */}
                {!isMobile && (
                  <div style={{ position: 'relative', height: 26, background: t.bg, borderRadius: 6, border: '1px solid ' + t.border, overflow: 'hidden' }}>
                    {months.map((m, i) => (m.pct > 0 && m.pct < 100) && (
                      <div key={'g' + i} style={{ position: 'absolute', top: 0, bottom: 0, left: m.pct + '%', width: 1, background: t.border, opacity: 0.6 }} />
                    ))}
                    {bar && (
                      <div title={shortDate(task.planned_start) + ' – ' + shortDate(task.planned_end)} style={{
                        position: 'absolute', top: 4, bottom: 4, ...bar, minWidth: 8,
                        background: barColour(task.status), borderRadius: 4, opacity: 0.92,
                      }} />
                    )}
                    {todayPct != null && (
                      <div title="Today" style={{ position: 'absolute', top: 0, bottom: 0, left: todayPct + '%', width: 2, background: t.danger, opacity: 0.6 }} />
                    )}
                  </div>
                )}

                {/* Status + % + delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select value={task.status} disabled={saving} onChange={e => patchTask(task.id, { status: e.target.value }, false)} style={{ ...input, minHeight: 34, padding: '4px 6px', fontSize: 12.5 }}>
                    {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <button onClick={() => deleteTask(task.id)} disabled={saving} title="Delete task" style={{ background: 'transparent', border: 'none', color: t.danger, cursor: saving ? 'default' : 'pointer', fontSize: 16, minWidth: 30, minHeight: 30 }}>×</button>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Add a task */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(120px,1fr) minmax(100px,0.8fr) 70px auto', gap: 8, marginTop: 14 }}>
        <input value={newTask.name} onChange={e => setNewTask({ ...newTask, name: e.target.value })} placeholder="New task" style={input} />
        <input value={newTask.phase} onChange={e => setNewTask({ ...newTask, phase: e.target.value })} placeholder="Phase (optional)" style={input} />
        <input type="number" inputMode="decimal" min="1" value={newTask.duration_days} onChange={e => setNewTask({ ...newTask, duration_days: e.target.value.replace(/[^0-9]/g, '') })} placeholder="days" style={input} />
        <AsyncButton onClick={addTask} busyLabel="Adding…" style={primaryBtn}>+ Add</AsyncButton>
      </div>
      <div style={{ color: t.textMuted, fontSize: 11.5, marginTop: 8 }}>
        New tasks run after the current programme. Edit durations and the dates re-flow automatically.
      </div>

      {/* Cash flow (admin-only, Phase 1) — expected monthly spend from the
          programme, with claims to date overlaid. */}
      {isAdmin && plan && (
        <CashflowPanel t={t} planId={plan.id} isMobile={isMobile} />
      )}

      {/* Time & cost capture (admin-only, Phase 3) — log site hours against
          tasks; feeds Finance Hub and flags labour overruns. */}
      {isAdmin && plan && (
        <TimeCapturePanel t={t} planId={plan.id} tasks={tasks} isMobile={isMobile} />
      )}

      {/* Stage 2: tell the assistant what happened on site */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid ' + t.border }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Update from site</div>
        <div style={{ color: t.textMuted, fontSize: 12.5, marginBottom: 10 }}>
          Tell me what's happened — e.g. “Roof finished Tuesday, but screed slipped a week waiting on the pump.” I'll update the programme and re-flow the dates.
          {isAdmin && " Mention hours too — “Dan did 8 hours on groundworks” — and I'll log the labour against the job."}
        </div>

        {chat.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {chat.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%', padding: '8px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.45,
                background: m.role === 'user' ? t.accent : t.bg,
                color: m.role === 'user' ? '#fff' : t.text,
                border: m.role === 'user' ? 'none' : '1px solid ' + t.border,
                wordBreak: 'break-word',
              }}>
                {m.role === 'assistant'
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.content}</ReactMarkdown>
                  : m.content}
              </div>
            ))}
            {sending && <div style={{ alignSelf: 'flex-start', color: t.textMuted, fontSize: 12.5 }}>Updating…</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            placeholder="What happened on site?"
            disabled={sending}
            style={{ ...input, flex: 1 }}
          />
          <button onClick={sendChat} disabled={sending || !chatInput.trim()} style={{ ...primaryBtn, opacity: (sending || !chatInput.trim()) ? 0.6 : 1 }}>Send</button>
        </div>
      </div>
    </div>
  );
}

// ── Cash flow panel (admin-only) ─────────────────────────────────────────────
// Loads on demand from GET /schedule/plans/:id/cashflow. Shows the contract
// value spread month-by-month against claims raised to date. Recomputes live on
// the server, so "Refresh" always reflects the current schedule + costs.
function CashflowPanel({ t, planId, isMobile }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/schedule/plans/' + planId + '/cashflow');
      setData(r);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [planId]);

  const downloadPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true); setError('');
    try {
      const r = await fetch('/api/schedule/plans/' + planId + '/cashflow/pdf', { headers: { Authorization: 'Bearer ' + getToken() } });
      if (!r.ok) throw new Error('Download failed');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cash-flow.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setError(e.message); }
    finally { setPdfBusy(false); }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !data) await load();
  };

  const months = data?.months || [];
  const maxVal = months.reduce((m, r) => Math.max(m, r.planned, r.claimed), 0) || 1;
  const totals = data?.totals || {};

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid ' + t.border }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            Cash flow
            <span style={{ background: t.accent + '22', color: t.accent, padding: '1px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 700 }}>Admin</span>
          </div>
          <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2 }}>
            Expected monthly spend from the programme, with claims to date.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {open && data && data.months && data.months.length > 0 && (
            <button onClick={downloadPdf} disabled={pdfBusy} style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid ' + t.border, background: 'transparent', color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: pdfBusy ? 0.6 : 1 }}>{pdfBusy ? 'Preparing…' : 'Show client (PDF)'}</button>
          )}
          {open && <button onClick={load} disabled={loading} style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid ' + t.border, background: 'transparent', color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? '…' : 'Refresh'}</button>}
          <button onClick={toggle} style={{ minHeight: 36, padding: '0 14px', borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {open ? 'Hide' : 'Show cash flow'}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {error && <div style={{ color: t.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {loading && !data && <div style={{ color: t.textMuted, fontSize: 13 }}>Building cash flow…</div>}

          {data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
                <Stat t={t} label="Contract value" value={fmtMoney(totals.contractValue)} />
                {Number(totals.variationsValue) > 0 && (
                  <Stat t={t} label="Change orders" value={'+' + fmtMoney(totals.variationsValue)} tone="ok" />
                )}
                <Stat t={t} label="Programme total" value={fmtMoney(totals.plannedTotal)} />
                <Stat t={t} label="Claimed to date" value={fmtMoney(totals.claimedToDate)} tone="ok" />
                <Stat t={t} label="Left to claim" value={fmtMoney(totals.remainingToClaim)}
                  tone={Number(totals.remainingToClaim) < 0 ? 'warn' : undefined} />
              </div>

              {months.length === 0 ? (
                <div style={{ color: t.textMuted, fontSize: 13.5, padding: '6px 0' }}>
                  {data.hasDatedTasks
                    ? 'No costs to spread yet — add a quote to this job so the schedule has a contract value.'
                    : 'No dated tasks yet — set task durations so the schedule has a timeline to spread costs across.'}
                </div>
              ) : (
                <>
                  {/* Header row */}
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '70px 1fr 80px' : '90px 1fr 100px 100px', gap: 10, alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, paddingBottom: 6 }}>
                    <div>Month</div>
                    <div>Planned {isMobile ? '' : 'vs claimed'}</div>
                    <div style={{ textAlign: 'right' }}>Planned</div>
                    {!isMobile && <div style={{ textAlign: 'right' }}>Claimed</div>}
                  </div>
                  {months.map((m) => (
                    <div key={m.month} style={{ display: 'grid', gridTemplateColumns: isMobile ? '70px 1fr 80px' : '90px 1fr 100px 100px', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid ' + t.border }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.label}</div>
                      <div style={{ position: 'relative', height: 22 }}>
                        {/* planned bar */}
                        <div style={{ position: 'absolute', top: 3, left: 0, height: 7, width: Math.max(1, (m.planned / maxVal) * 100) + '%', background: t.accent, borderRadius: 4, opacity: 0.9 }}
                          title={'Planned ' + fmtMoney(m.planned)} />
                        {/* claimed bar */}
                        <div style={{ position: 'absolute', top: 12, left: 0, height: 7, width: Math.max(m.claimed > 0 ? 1 : 0, (m.claimed / maxVal) * 100) + '%', background: t.success, borderRadius: 4, opacity: 0.9 }}
                          title={'Claimed ' + fmtMoney(m.claimed)} />
                      </div>
                      <div style={{ fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.planned)}</div>
                      {!isMobile && <div style={{ fontSize: 12.5, textAlign: 'right', color: m.claimed > 0 ? t.success : t.textMuted, fontVariantNumeric: 'tabular-nums' }}>{m.claimed > 0 ? fmtMoney(m.claimed) : '—'}</div>}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11.5, color: t.textMuted, alignItems: 'center' }}>
                    <Legend t={t} colour={t.accent} label="Planned spend" />
                    <Legend t={t} colour={t.success} label="Claimed" />
                  </div>
                  <div style={{ color: t.textMuted, fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
                    The contract value is spread across each task's working days — weighted by its priced lines where known, by duration otherwise — then bucketed by month. Claims are invoices raised on this job (sent or paid).
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Time & cost capture panel (admin-only, Phase 3) ──────────────────────────
// Log a day's site work against a task: hours, % complete, cost. It feeds the
// job's actual costs (Finance Hub) and flags where labour is running over the
// priced budget.
function TimeCapturePanel({ t, planId, tasks, isMobile }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blankForm = { task_id: '', entry_date: todayIso(), worker: '', hours: '', hourly_rate: '', percent_complete: '', note: '' };
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await apiFetch('/schedule/plans/' + planId + '/time')); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [planId]);

  const toggle = async () => { const n = !open; setOpen(n); if (n && !data) await load(); };

  const submit = async () => {
    if (busy) return;
    const hours = Number(form.hours) || 0;
    const cost = Number(form.hourly_rate) || 0;
    if (hours <= 0 && cost <= 0) { setError('Enter hours (and a rate) or a labour cost.'); return; }
    setBusy(true); setError('');
    try {
      const body = {
        task_id: form.task_id || null,
        entry_date: form.entry_date,
        worker: form.worker || null,
        hours,
        hourly_rate: cost,
        percent_complete: form.percent_complete === '' ? null : Number(form.percent_complete),
        note: form.note || null,
      };
      const r = await apiFetch('/schedule/plans/' + planId + '/time', { method: 'POST', body: JSON.stringify(body) });
      setData(r);
      setForm({ ...blankForm, entry_date: form.entry_date });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const del = async (id) => {
    try { const r = await apiFetch('/schedule/time/' + id, { method: 'DELETE' }); if (r.rows) setData(r); else await load(); }
    catch (e) { setError(e.message); }
  };

  const input = { boxSizing: 'border-box', minHeight: 38, padding: '7px 9px', background: t.card, border: '1px solid ' + t.border, color: t.text, borderRadius: 9, fontSize: 13.5, outline: 'none' };
  const rows = data?.rows || [];
  const entries = data?.entries || [];
  const totals = data?.totals || {};
  const flags = data?.flags || [];
  const taskName = (id) => (tasks.find(x => x.id === id) || {}).name || '—';

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid ' + t.border }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            Time &amp; cost capture
            <span style={{ background: t.accent + '22', color: t.accent, padding: '1px 7px', borderRadius: 6, fontSize: 10.5, fontWeight: 700 }}>Admin</span>
          </div>
          <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2 }}>
            Log site hours against a task — it updates progress, feeds actual costs, and flags labour overruns.
          </div>
        </div>
        <button onClick={toggle} style={{ minHeight: 36, padding: '0 14px', borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {open ? 'Hide' : 'Capture time'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {error && <div style={{ color: t.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {loading && !data && <div style={{ color: t.textMuted, fontSize: 13 }}>Loading…</div>}

          {/* Flags */}
          {flags.length > 0 && (
            <div style={{ background: t.dangerBg || (t.danger + '18'), border: '1px solid ' + t.danger + '55', borderRadius: 10, padding: '8px 12px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: t.danger, marginBottom: 2 }}>Needs attention</div>
              {flags.map((f, i) => <div key={i} style={{ fontSize: 12.5, color: t.text }}>• {f}</div>)}
            </div>
          )}

          {/* Log form */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.6fr 1fr 0.8fr 0.8fr 0.8fr', gap: 8, marginBottom: 8 }}>
            <select value={form.task_id} onChange={e => setForm({ ...form, task_id: e.target.value })} style={{ ...input, gridColumn: isMobile ? '1 / -1' : 'auto' }}>
              <option value="">— pick a task —</option>
              {tasks.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input value={form.worker} onChange={e => setForm({ ...form, worker: e.target.value })} placeholder="Who" style={input} />
            <input type="number" inputMode="decimal" min="0" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} placeholder="Hours" style={input} />
            <input type="number" inputMode="decimal" min="0" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: e.target.value })} placeholder="£/hr" style={input} />
            <input type="number" inputMode="numeric" min="0" max="100" value={form.percent_complete} onChange={e => setForm({ ...form, percent_complete: e.target.value })} placeholder="% done" style={input} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 160px auto', gap: 8, marginBottom: 14 }}>
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="What was done (optional)" style={input} />
            <input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} style={input} />
            <button onClick={submit} disabled={busy} style={{ minHeight: 38, padding: '0 16px', borderRadius: 9, border: 'none', background: t.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Log time'}</button>
          </div>

          {data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 14 }}>
                <Stat t={t} label="Planned labour" value={fmtMoney(totals.plannedLabour)} />
                <Stat t={t} label="Captured labour" value={fmtMoney(totals.capturedLabour)} tone={Number(totals.variance) > 0 ? 'warn' : undefined} />
                <Stat t={t} label="Hours logged" value={(Number(totals.capturedHours) || 0).toLocaleString('en-GB')} />
                <Stat t={t} label="Variance" value={(Number(totals.variance) > 0 ? '+' : '') + fmtMoney(totals.variance)} tone={Number(totals.variance) > 0 ? 'warn' : 'ok'} />
              </div>

              {/* Planned vs actual per task */}
              {rows.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 70px 70px' : '1.6fr 1fr 1fr 70px 70px', gap: 8, fontSize: 10.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, paddingBottom: 6 }}>
                    <div>Task</div>{!isMobile && <div style={{ textAlign: 'right' }}>Planned</div>}{!isMobile && <div style={{ textAlign: 'right' }}>Captured</div>}<div style={{ textAlign: 'right' }}>{isMobile ? 'Capt.' : 'Hrs'}</div><div style={{ textAlign: 'right' }}>%</div>
                  </div>
                  {rows.map(r => (
                    <div key={r.taskId} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 70px 70px' : '1.6fr 1fr 1fr 70px 70px', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid ' + t.border }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        {r.over && <span title={'£' + Math.round(r.overBy) + ' over'} style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: t.danger, background: t.danger + '22', padding: '1px 6px', borderRadius: 999 }}>over</span>}
                      </div>
                      {!isMobile && <div style={{ fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.plannedLabour)}</div>}
                      {!isMobile && <div style={{ fontSize: 12.5, textAlign: 'right', color: r.over ? t.danger : t.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.capturedLabour)}</div>}
                      <div style={{ fontSize: 12.5, textAlign: 'right', color: t.textMuted }}>{isMobile ? fmtMoney(r.capturedLabour) : r.capturedHours}</div>
                      <div style={{ fontSize: 12.5, textAlign: 'right', color: t.textMuted }}>{r.percent == null ? '—' : r.percent + '%'}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recent entries */}
              {entries.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Recent entries</div>
                  {entries.slice(0, 8).map(e => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid ' + t.border, fontSize: 12.5 }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: t.textMuted }}>{shortDate(e.entry_date)}</span> · {taskName(e.task_id)}
                        {e.worker ? ' · ' + e.worker : ''}{Number(e.hours) ? ' · ' + e.hours + 'h' : ''}
                        {e.note ? <span style={{ color: t.textMuted }}> — {e.note}</span> : ''}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.labour_cost)}</span>
                        <button onClick={() => del(e.id)} title="Delete" style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 15, minWidth: 26 }}>×</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ t, label, value, tone }) {
  const colour = tone === 'warn' ? t.warning : tone === 'ok' ? t.success : t.text;
  return (
    <div style={{ background: t.bg, border: '1px solid ' + t.border, borderRadius: 12, padding: '8px 12px' }}>
      <div style={{ color: t.textSecondary, fontSize: 11, fontWeight: 600 }}>{label}</div>
      <div style={{ color: colour, fontSize: 16, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Legend({ t, colour, label, line }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: line ? 2 : 10, height: 10, background: colour, borderRadius: line ? 0 : 3, display: 'inline-block', opacity: line ? 0.6 : 0.9 }} />
      {label}
    </span>
  );
}

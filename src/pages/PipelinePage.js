import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

// SVG status icons (matching portal style — clean line icons)
const icons = {
  complete: (color = '#10B981') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l3 3 5-5" />
    </svg>
  ),
  running: (color = '#F59E0B') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'pipeline-spin 1.5s linear infinite' }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  ),
  error: (color = '#EF4444') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  ),
  pending: (color = '#475569') => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" strokeDasharray="4 3" />
    </svg>
  ),
};

const stepIcons = {
  trigger:           (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>,
  normalize_payload: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  create_folder:     (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
  create_subfolders: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>,
  upload_files:      (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
  generate_boq:      (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
  match_rates:       (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>,
  build_excel:       (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>,
  create_doc_report: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>,
  log_usage:         (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>,
  send_email:        (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return secs + 's ago';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function formatDuration(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  const secs = (ms / 1000).toFixed(1);
  if (secs < 60) return secs + 's';
  const mins = Math.floor(ms / 60000);
  const remSecs = Math.floor((ms % 60000) / 1000);
  return mins + 'm ' + remSecs + 's';
}

function RunCard({ run, t, expanded, onToggle, onDelete }) {
  const completedSteps = run.steps.filter(s => s.status === 'complete').length;
  const totalSteps = run.steps.length;
  const pct = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  const isError = run.status === 'error';
  const isComplete = run.status === 'complete';
  const statusColor = isError ? '#EF4444' : isComplete ? '#10B981' : '#F59E0B';
  const statusLabel = isError ? 'Error' : isComplete ? 'Complete' : 'Processing';

  return (
    <div style={{ background: t.card, border: '1px solid ' + (isError ? 'rgba(239,68,68,0.3)' : t.border), borderRadius: 14, overflow: 'hidden', boxShadow: t.shadowSm }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', userSelect: 'none', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: statusColor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isComplete ? icons.complete(statusColor) : isError ? icons.error(statusColor) : icons.running(statusColor)}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{run.project_title || 'Untitled Project'}</div>
            <div style={{ fontSize: 12, color: t.textMuted }}>{run.client_name}{run.client_email ? ' — ' + run.client_email : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 250 }}>
          <div style={{ flex: 1, minWidth: 100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{statusLabel}</span>
              <span style={{ fontSize: 10, color: t.textMuted }}>{completedSteps}/{totalSteps}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: t.surfaceHover, overflow: 'hidden' }}>
              <div style={{ width: pct + '%', height: '100%', borderRadius: 3, background: statusColor, transition: 'width 0.5s ease' }} />
            </div>
          </div>
          <span style={{ fontSize: 11, color: t.textDim, whiteSpace: 'nowrap' }}>{timeAgo(run.started_at)}</span>
          <span onClick={(e) => onDelete(run.id, e)} style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.4} title="Delete run">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
          </span>
          <span style={{ fontSize: 16, color: t.textMuted, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid ' + t.border }}>
          {run.steps.map((step, i) => {
            const sColor = step.status === 'complete' ? '#10B981' : step.status === 'running' ? '#F59E0B' : step.status === 'error' ? '#EF4444' : t.textDim;
            const StepIcon = stepIcons[step.step_key];
            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px 12px 24px', borderBottom: i < run.steps.length - 1 ? '1px solid ' + t.border : 'none', background: step.status === 'running' ? (t.surfaceHover || t.surface) : 'transparent', opacity: step.status === 'pending' ? 0.5 : 1 }}>
                <div style={{ width: 18 }}>{icons[step.status](sColor)}</div>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: sColor + '12', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {StepIcon ? StepIcon(sColor) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: step.status === 'running' ? 600 : 400, color: step.status === 'pending' ? t.textDim : t.text }}>{step.step_label}</div>
                  {step.error_message && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 2 }}>{step.error_message}</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {step.duration_ms ? <span style={{ fontSize: 11, color: t.textMuted, fontFamily: 'monospace' }}>{formatDuration(step.duration_ms)}</span> : step.status === 'running' ? <span style={{ fontSize: 11, color: '#F59E0B', fontFamily: 'monospace' }}>running...</span> : null}
                </div>
              </div>
            );
          })}
          {isComplete && (
            <div style={{ padding: '10px 20px', background: 'rgba(16,185,129,0.05)', borderTop: '1px solid ' + t.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>Pipeline complete</span>
              <span style={{ fontSize: 11, color: t.textMuted }}>Total: {formatDuration(run.steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0))}</span>
            </div>
          )}
          {isError && run.error_message && (
            <div style={{ padding: '10px 20px', background: 'rgba(239,68,68,0.05)', borderTop: '1px solid rgba(239,68,68,0.2)' }}>
              <span style={{ fontSize: 12, color: '#EF4444' }}>{run.error_message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const { t } = useTheme();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState({});

  const loadRuns = useCallback(() => {
    const params = new URLSearchParams({ limit: 20 });
    if (filter) params.set('status', filter);
    apiFetch('/pipeline/runs?' + params)
      .then(data => setRuns(data || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Auto-refresh when jobs are running
  useEffect(() => {
    if (!runs.some(r => r.status === 'running')) return;
    const interval = setInterval(loadRuns, 10000);
    return () => clearInterval(interval);
  }, [runs, loadRuns]);

  function deleteRun(id, e) {
    e.stopPropagation();
    if (!window.confirm('Delete this pipeline run?')) return;
    apiFetch('/pipeline/runs/' + id, { method: 'DELETE' })
      .then(() => { setRuns(prev => prev.filter(r => r.id !== id)); })
      .catch(err => console.error('Delete failed:', err));
  }

  function clearAll() {
    if (!window.confirm('Clear ALL pipeline runs? This cannot be undone.')) return;
    apiFetch('/pipeline/runs', { method: 'DELETE' })
      .then(() => { setRuns([]); })
      .catch(err => console.error('Clear failed:', err));
  }

  const runningCount = runs.filter(r => r.status === 'running').length;
  const completeCount = runs.filter(r => r.status === 'complete').length;
  const errorCount = runs.filter(r => r.status === 'error').length;

  return (
    <div style={{ padding: '28px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: t.text, margin: 0 }}>Pipeline</h1>
        <p style={{ fontSize: 13, color: t.textMuted, margin: '4px 0 0' }}>Live BOQ processing tracker — Pipedream workflow status</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Processing', value: runningCount, color: '#F59E0B' },
          { label: 'Completed', value: completeCount, color: '#10B981' },
          { label: 'Errors', value: errorCount, color: '#EF4444' },
          { label: 'Total Runs', value: runs.length, color: t.textSecondary },
        ].map((stat, i) => (
          <div key={i} style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: '16px 18px', boxShadow: t.shadowSm }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, background: t.inputBg || t.surface, border: '1px solid ' + t.border, color: t.text, minWidth: 160 }}>
          <option value="">All Runs</option>
          <option value="running">Processing</option>
          <option value="complete">Complete</option>
          <option value="error">Errors</option>
        </select>
        <button onClick={() => { setLoading(true); loadRuns(); }} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: t.surfaceHover, color: t.textSecondary, border: '1px solid ' + t.border, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          Refresh
        </button>
        {runs.length > 0 && <button onClick={clearAll} style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
          Clear All
        </button>}
        {runningCount > 0 && <span style={{ fontSize: 11, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 5 }}>{icons.running('#F59E0B')} Auto-refreshing every 10s</span>}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: t.textMuted }}>Loading pipeline runs...</div>
      ) : runs.length === 0 ? (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: '60px 20px', textAlign: 'center', boxShadow: t.shadowSm }}>
          <div style={{ marginBottom: 12 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={t.textDim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.textSecondary }}>No pipeline runs yet</div>
          <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>Runs will appear here when clients submit projects</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {runs.map(run => (
            <RunCard key={run.id} run={run} t={t} expanded={!!expanded[run.id]} onToggle={() => setExpanded(prev => ({ ...prev, [run.id]: !prev[run.id] }))} onDelete={deleteRun} />
          ))}
        </div>
      )}

      <style>{`@keyframes pipeline-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

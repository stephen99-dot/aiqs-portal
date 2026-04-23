import React, { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch, getToken } from '../utils/api';
import { useTheme } from '../context/ThemeContext';

// Live BOQ agent panel. Subscribes to /api/agent/:id/stream, renders:
//   • Header: status + elapsed time + ETA based on typical runs
//   • Current activity line ("Viewing X page 3", "Running pricer"...)
//   • Running takeoff items (updates in real time as record_* tools fire)
//   • Priced summary (updates when run_pricer returns)
//   • Tool-call log (last 12 calls, each with timestamp)
//   • Reasoning toggle (exposes Claude's thinking deltas)
//   • Download buttons when finalized
//
// Resumes cleanly after tab close/reload via SSE snapshot.

const TOOL_LABELS = {
  view_pdf_page:       { emoji: '🔍', label: 'Viewing drawing' },
  set_project_metadata:{ emoji: '📋', label: 'Recording project metadata' },
  record_takeoff_item: { emoji: '📐', label: 'Recording BOQ item' },
  update_takeoff_item: { emoji: '✏️', label: 'Updating item' },
  remove_takeoff_item: { emoji: '🗑️', label: 'Removing item' },
  run_pricer:          { emoji: '🧮', label: 'Running pricer' },
  finalize_boq:        { emoji: '✅', label: 'Finalising BOQ' },
};

// Typical elapsed seconds by iteration count — very rough, used for ETA.
// Based on observation: ~15-20s per iteration on Sonnet with thinking.
const SECONDS_PER_ITERATION = 18;
const TYPICAL_ITERATIONS = 22;

function fmtMoney(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  if (n == null || isNaN(n)) return sym + '0';
  return sym + Math.round(n).toLocaleString('en-GB');
}

function fmtElapsed(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function fmtETA(remainingSec) {
  if (remainingSec <= 0) return 'finalising...';
  if (remainingSec < 60) return `~${remainingSec}s remaining`;
  return `~${Math.ceil(remainingSec / 60)} min remaining`;
}

export default function AgentPanel({ runId, onClose, onCompleted }) {
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);
  const [priced, setPriced] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [activity, setActivity] = useState('Connecting...');
  const [toolCalls, setToolCalls] = useState([]);  // [{ ts, tool, input }]
  const [showReasoning, setShowReasoning] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);

  const readerAbortRef = useRef(null);

  // Tick every second for elapsed / ETA
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to the SSE stream
  useEffect(() => {
    if (!runId) return;
    const token = getToken();
    const ac = new AbortController();
    readerAbortRef.current = ac;
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch('/api/agent/' + runId + '/stream', {
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          signal: ac.signal,
        });
        if (!resp.ok) throw new Error('Stream failed ' + resp.status);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;
            let evt; try { evt = JSON.parse(payload); } catch (e) { continue; }
            handleEvent(evt);
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || 'Connection lost');
      }
    })();

    return () => { cancelled = true; ac.abort(); };
  }, [runId]);

  function handleEvent(evt) {
    switch (evt.type) {
      case 'snapshot':
        setRun(evt.run);
        setItems(evt.run.takeoff_items || []);
        setPriced(evt.run.priced || null);
        setDownloads(evt.run.downloads || []);
        setActivity(evt.run.current_activity || (evt.run.status === 'running' ? 'Thinking...' : evt.run.status === 'completed' ? 'Complete' : evt.run.status === 'failed' ? 'Failed' : 'Starting...'));
        if (evt.run.error_message) setError(evt.run.error_message);
        break;
      case 'run_started':
        break;
      case 'iteration_start':
        setRun(r => r ? { ...r, iteration_count: evt.iteration } : r);
        break;
      case 'activity':
        setActivity(evt.activity);
        break;
      case 'text_delta':
        // Skipped from UI — shown only if user opens reasoning
        break;
      case 'thinking_delta':
        setReasoning(r => r + evt.delta);
        break;
      case 'tool_call_start':
        setToolCalls(prev => [{ ts: Date.now(), tool: evt.tool, status: 'pending' }, ...prev].slice(0, 12));
        break;
      case 'tool_call':
        setToolCalls(prev => {
          const next = prev.slice();
          // Update the most recent matching pending entry
          const idx = next.findIndex(x => x.tool === evt.tool && x.status === 'pending');
          if (idx >= 0) next[idx] = { ...next[idx], input: evt.input };
          return next;
        });
        break;
      case 'tool_result':
        setToolCalls(prev => {
          const next = prev.slice();
          const idx = next.findIndex(x => x.tool === evt.tool && x.status === 'pending');
          if (idx >= 0) next[idx] = { ...next[idx], status: evt.is_error ? 'error' : 'done' };
          return next;
        });
        break;
      case 'metadata':
        setRun(r => r ? { ...r, project_type: evt.metadata.project_type, location: evt.metadata.location, floor_area_m2: evt.metadata.floor_area_m2, spec_level: evt.metadata.spec_level } : r);
        break;
      case 'takeoff_item':
        if (evt.action === 'added') setItems(p => [...p, evt.item]);
        else if (evt.action === 'updated') setItems(p => p.map(i => i.key === evt.item.key ? evt.item : i));
        else if (evt.action === 'removed') setItems(p => p.filter(i => i.key !== evt.item.key));
        break;
      case 'priced':
        setPriced(evt.priced);
        break;
      case 'finalized':
        setDownloads(evt.downloads || []);
        break;
      case 'run_complete':
        setRun(r => r ? { ...r, status: 'completed' } : r);
        setActivity('Complete');
        (async () => {
          try {
            const d = await apiFetch('/agent/' + runId);
            if (d.run) {
              setRun(d.run);
              setDownloads(d.run.downloads || []);
              if (onCompleted) onCompleted(d.run);
            }
          } catch (e) {}
        })();
        break;
      case 'error':
        setError(evt.message || 'Agent failed');
        setRun(r => r ? { ...r, status: 'failed', error_message: evt.message } : r);
        setActivity('Failed');
        break;
    }
  }

  const c = isDark ? {
    bg: '#0F1520', card: '#111827', border: 'rgba(255,255,255,0.08)',
    text: '#E2E8F0', muted: '#94A3B8', sub: '#64748B',
    accent: '#F59E0B', accentBg: 'rgba(245,158,11,0.08)',
    done: '#10B981', err: '#EF4444',
    row: 'rgba(255,255,255,0.025)',
  } : {
    bg: '#F8FAFC', card: '#FFFFFF', border: 'rgba(0,0,0,0.08)',
    text: '#1E293B', muted: '#64748B', sub: '#94A3B8',
    accent: '#D97706', accentBg: 'rgba(245,158,11,0.06)',
    done: '#059669', err: '#DC2626',
    row: 'rgba(0,0,0,0.02)',
  };

  const startedAt = run?.created_at ? new Date(run.created_at).getTime() : null;
  const elapsedSec = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const iter = run?.iteration_count || 0;
  const isRunning = run?.status === 'running' || run?.status === 'queued';
  const isComplete = run?.status === 'completed';
  const isFailed = run?.status === 'failed';

  // ETA: estimate remaining iterations * seconds per iteration, minus what we've done
  const totalEstSec = TYPICAL_ITERATIONS * SECONDS_PER_ITERATION;
  const remainingSec = isRunning ? Math.max(0, totalEstSec - elapsedSec) : 0;
  const progressPct = isComplete ? 100 : isFailed ? 100 : Math.min(95, (elapsedSec / totalEstSec) * 100);

  if (!runId) return null;

  return (
    <div style={{ background: c.card, border: '1px solid ' + c.border, borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>

      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + c.border, background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>{isComplete ? '✅' : isFailed ? '❌' : '🛠️'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>
              BOQ Agent · {isComplete ? 'Complete' : isFailed ? 'Failed' : 'Running'}
              {run?.project_type && <span style={{ fontWeight: 400, color: c.muted }}> · {run.project_type}</span>}
            </div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>
              {isComplete && run?.grand_total
                ? <>Grand total {fmtMoney(run.grand_total, run.currency)} · {iter} iterations · {fmtElapsed(elapsedSec)}</>
                : isFailed
                ? <>{error || run?.error_message || 'Agent failed'}</>
                : <>Iteration {iter} · elapsed {fmtElapsed(elapsedSec)} · {fmtETA(remainingSec)}</>}
            </div>
          </div>
          <button
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expand panel' : 'Collapse panel'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 13, padding: '2px 6px', fontWeight: 600 }}
          >
            {collapsed ? '▼ Expand' : '▲ Collapse'}
          </button>
          {onClose && (
            <button onClick={onClose} title="Close panel (job keeps running on the server)" style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 20, padding: '0 4px' }}>×</button>
          )}
        </div>

        {/* Progress bar */}
        {!isFailed && (
          <div style={{ marginTop: 10, height: 3, borderRadius: 3, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
            <div style={{ width: progressPct + '%', height: '100%', background: isComplete ? c.done : c.accent, transition: 'width 0.6s ease' }} />
          </div>
        )}

        {/* Current activity line */}
        {isRunning && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 7, background: c.accentBg, border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: c.accent, fontWeight: 500 }}>
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {[0, 1, 2].map(d => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: c.accent, animation: 'dot 1.4s infinite', animationDelay: (d * 0.2) + 's' }} />)}
            </span>
            <span style={{ flex: 1 }}>{activity}</span>
          </div>
        )}
      </div>

      {/* Body — hidden when collapsed. All sections render fully, no inner
          scroll boxes, so the outer page scrolls naturally and users can
          see the whole panel by scrolling down. */}
      {!collapsed && (
        <>
          {/* Downloads row (if complete) */}
          {isComplete && downloads.length > 0 && (
            <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border, background: isDark ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.04)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.done, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 7 }}>Documents ready</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {downloads.map((f, i) => <DownloadButton key={i} f={f} c={c} isDark={isDark} />)}
              </div>
            </div>
          )}

          {/* Priced summary */}
          {priced && priced.summary && (
            <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.sub, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Current priced estimate</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 3, columnGap: 14, fontSize: 12.5, color: c.text }}>
                <span style={{ color: c.muted }}>Construction</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(priced.summary.construction_total, priced.summary.currency)}</span>
                <span style={{ color: c.muted }}>Contingency ({priced.summary.contingency_pct}%)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(priced.summary.contingency, priced.summary.currency)}</span>
                <span style={{ color: c.muted }}>OH&P ({priced.summary.ohp_pct}%)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(priced.summary.ohp, priced.summary.currency)}</span>
                <span style={{ color: c.muted }}>VAT ({priced.summary.vat_rate}%)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(priced.summary.vat, priced.summary.currency)}</span>
                <span style={{ color: c.text, fontWeight: 700, paddingTop: 4, borderTop: '1px solid ' + c.border, marginTop: 2 }}>Grand total</span>
                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', paddingTop: 4, borderTop: '1px solid ' + c.border, marginTop: 2 }}>{fmtMoney(priced.summary.grand_total, priced.summary.currency)}</span>
              </div>
            </div>
          )}

          {/* Running takeoff items — render all, no inner scroll; for
              huge takeoffs collapse to first 15 with a toggle. */}
          <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: c.sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Takeoff</span>
              <span style={{ fontSize: 11, color: c.muted }}>{items.length} item{items.length !== 1 ? 's' : ''}{run?.floor_area_m2 ? ` · ${run.floor_area_m2}m²` : ''}</span>
              {items.length > 15 && (
                <button onClick={() => setShowAllItems(v => !v)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: c.accent, fontSize: 11, fontWeight: 600, padding: 0, fontFamily: 'inherit' }}>
                  {showAllItems ? `Show first 15` : `Show all ${items.length}`}
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: c.muted, padding: '6px 0' }}>Agent hasn't recorded any items yet.</div>
            ) : (
              <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {(showAllItems ? items : items.slice(0, 15)).map((it, i) => (
                  <div key={it.key + '-' + i} style={{ padding: '5px 8px', borderRadius: 5, background: i % 2 === 0 ? c.row : 'transparent', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.description}>{it.description || it.key}</span>
                    <span style={{ color: c.muted, whiteSpace: 'nowrap' }}>{it.qty} {it.unit}</span>
                    <span style={{ color: c.sub, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{it.section}</span>
                  </div>
                ))}
                {!showAllItems && items.length > 15 && (
                  <div style={{ fontSize: 11, color: c.muted, padding: '6px 8px', fontStyle: 'italic' }}>
                    … {items.length - 15} more items. Click "Show all {items.length}" above to expand.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tool call log */}
          <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.sub, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Recent activity</div>
            {toolCalls.length === 0 ? (
              <div style={{ fontSize: 12, color: c.muted }}>No tool calls yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {toolCalls.map((tc, i) => {
                  const label = TOOL_LABELS[tc.tool] || { emoji: '·', label: tc.tool };
                  const dotColor = tc.status === 'done' ? c.done : tc.status === 'error' ? c.err : c.accent;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <span>{label.emoji}</span>
                      <span style={{ color: c.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label.label}{tc.input && tc.tool === 'view_pdf_page' ? ` — ${tc.input.filename} p${tc.input.page}` : tc.input && tc.tool === 'record_takeoff_item' ? ` — ${tc.input.key}` : ''}
                      </span>
                      <span style={{ color: c.sub, fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(tc.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reasoning toggle */}
          <div style={{ padding: '10px 18px' }}>
            <button
              onClick={() => setShowReasoning(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 11.5, fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
            >
              <span style={{ transform: showReasoning ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', display: 'inline-block', fontSize: 10 }}>▶</span>
              🧠 {showReasoning ? 'Hide' : 'Show'} reasoning ({reasoning.length} chars)
            </button>
            {showReasoning && reasoning && (
              <pre style={{ marginTop: 8, padding: '10px 12px', borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', fontSize: 11.5, color: c.muted, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {reasoning}
              </pre>
            )}
          </div>

          {/* Keep-alive message */}
          {isRunning && (
            <div style={{ padding: '8px 18px 14px', fontSize: 11, color: c.sub, fontStyle: 'italic' }}>
              Agent runs on the server — safe to close the tab and come back. Live panel re-attaches on reload.
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes dot { 0%,80%,100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

function DownloadButton({ f, c, isDark }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const token = getToken();
          const r = await fetch(f.url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
          if (!r.ok) throw new Error();
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = f.name;
          document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        } catch (e) { alert('Download failed — try again.'); }
        finally { setBusy(false); }
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer',
        background: f.type === 'xlsx' ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)',
        border: '1px solid ' + (f.type === 'xlsx' ? 'rgba(16,185,129,0.28)' : 'rgba(59,130,246,0.28)'),
        color: f.type === 'xlsx' ? c.done : '#3B82F6',
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
      }}
    >
      {f.type === 'xlsx' ? '📊' : '📝'} {busy ? 'Downloading...' : 'Download ' + f.name}
    </button>
  );
}

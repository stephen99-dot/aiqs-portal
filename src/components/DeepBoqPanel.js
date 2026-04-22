import React, { useState, useEffect, useRef } from 'react';
import { apiFetch, getToken } from '../utils/api';
import { useTheme } from '../context/ThemeContext';
// Deep BOQ progress timeline.
//
// Subscribes to /api/deep-boq/:id/stream which first replays a snapshot
// (so reloading the page or reconnecting picks up the current state)
// then streams live step_text / step_thinking / step_complete events.
//
// Safe to unmount and remount — the job keeps running server-side.

const STEP_ICONS = {
  scope:    '📋',
  measure:  '📐',
  qa:       '✅',
  rates:    '💷',
  price:    '🧮',
  sanity:   '🔎',
  findings: '📝',
};

function fmtMoney(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  if (n == null || isNaN(n)) return sym + '0';
  return sym + Math.round(n).toLocaleString('en-GB');
}

export default function DeepBoqPanel({ jobId, onClose, onCompleted }) {
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const [job, setJob] = useState(null);
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const readerRef = useRef(null);
  const stepsScrollRef = useRef(null);
  const stepRowRefs = useRef({});  // step_index -> DOM element

  const c = isDark ? {
    bg: '#0F1520', border: 'rgba(255,255,255,0.08)',
    card: '#111827', text: '#E2E8F0', muted: '#94A3B8', sub: '#64748B',
    accent: '#F59E0B', accentBg: 'rgba(245,158,11,0.08)',
    done: '#10B981', err: '#EF4444', pending: '#1E293B',
    stepRowBg: 'rgba(255,255,255,0.02)',
  } : {
    bg: '#F8FAFC', border: 'rgba(0,0,0,0.08)',
    card: '#FFFFFF', text: '#1E293B', muted: '#64748B', sub: '#94A3B8',
    accent: '#D97706', accentBg: 'rgba(245,158,11,0.05)',
    done: '#059669', err: '#DC2626', pending: '#E2E8F0',
    stepRowBg: 'rgba(0,0,0,0.015)',
  };

  // Merge incoming event onto a step in the steps array (immutable update).
  function applyEvent(prevSteps, evt) {
    if (!evt || evt.step_index == null) return prevSteps;
    const next = prevSteps.slice();
    const idx = evt.step_index;
    const existing = next[idx] || { step_index: idx, step_name: evt.step_name, step_title: evt.step_title, status: 'pending', text: '', thinking: '' };
    switch (evt.type) {
      case 'step_started':
        next[idx] = { ...existing, status: 'running', step_name: evt.step_name, step_title: evt.step_title };
        break;
      case 'step_text':
        next[idx] = { ...existing, text: (existing.text || '') + (evt.delta || '') };
        break;
      case 'step_thinking':
        next[idx] = { ...existing, thinking: (existing.thinking || '') + (evt.delta || '') };
        break;
      case 'step_complete':
        // If the step emitted an error payload, mark it as 'error' (not
        // 'complete'). Previously we always set status='complete' here,
        // which made failed steps show as green ticks despite having an
        // error message in the output.
        {
          const isErr = evt.output && (evt.output.error || evt.output.failed);
          next[idx] = {
            ...existing,
            status: isErr ? 'error' : 'complete',
            output: evt.output,
          };
          if (isErr) {
            next[idx].text = (existing.text || '') + (existing.text ? '\n\n' : '') + 'Error: ' + evt.output.error;
          }
        }
        break;
      default:
        return prevSteps;
    }
    return next;
  }

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const token = getToken();
    const url = '/api/deep-boq/' + jobId + '/stream';
    const ac = new AbortController();

    (async () => {
      try {
        const resp = await fetch(url, {
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          signal: ac.signal,
        });
        if (!resp.ok) throw new Error('Stream failed with ' + resp.status);
        const reader = resp.body.getReader();
        readerRef.current = reader;
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
            if (evt.type === 'snapshot') {
              setJob(evt.job);
              setSteps((evt.job.steps || []).map(s => ({
                step_index: s.step_index,
                step_name: s.step_name,
                step_title: s.step_title,
                status: s.status,
                text: s.text || '',
                thinking: s.thinking || '',
                output: s.output_json ? (() => { try { return JSON.parse(s.output_json); } catch (e) { return null; } })() : null,
              })));
            } else if (evt.type === 'job_complete') {
              try {
                const snap = await apiFetch('/deep-boq/' + jobId);
                if (snap.job) {
                  setJob(snap.job);
                  if (onCompleted) onCompleted(snap.job);
                }
              } catch (e) {}
            } else if (evt.type === 'job_error') {
              const errMsg = evt.error || 'Job failed';
              setError(errMsg);
              // Flip the currently-running step to 'error' so the UI doesn't
              // leave it pulsing forever. Also writes the error message into
              // the step text so expanding the row shows what went wrong.
              setSteps(prev => prev.map(s => s.status === 'running'
                ? { ...s, status: 'error', text: (s.text || '') + '\n\nError: ' + errMsg }
                : s));
              setJob(j => j ? { ...j, status: 'failed', error_message: errMsg } : j);
            } else {
              setSteps(prev => applyEvent(prev, evt));
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || 'Connection lost');
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [jobId, onCompleted]);

  // Whenever the running step changes, scroll the panel's internal container
  // so that step is visible. Lets users watch progress without having to
  // manually scroll, and prevents the "can't see step 6+" problem on long runs.
  const runningStep = steps.find(s => s.status === 'running');
  const runningIdx = runningStep ? runningStep.step_index : -1;
  useEffect(() => {
    if (runningIdx < 0) return;
    const el = stepRowRefs.current[runningIdx];
    const container = stepsScrollRef.current;
    if (el && container) {
      // Scroll within the panel's own scroll container, not the page.
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (elTop < viewTop || elBottom > viewBottom) {
        container.scrollTo({ top: Math.max(0, elTop - 20), behavior: 'smooth' });
      }
    }
  }, [runningIdx]);

  if (!jobId) return null;

  const isComplete = job && job.status === 'completed';
  const isFailed = job && job.status === 'failed';

  // Final-output files from the package step
  const files = (() => {
    if (!job || !job.final_output) return [];
    try { return (JSON.parse(job.final_output).files) || []; } catch (e) { return []; }
  })();

  async function downloadFile(f) {
    try {
      const token = getToken();
      const resp = await fetch(f.url, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = f.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed — try again.');
    }
  }

  return (
    <div style={{
      background: c.card, border: '1px solid ' + c.border, borderRadius: 12,
      overflow: 'hidden', marginTop: 12,
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid ' + c.border,
        background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>🔬</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>
            Deep BOQ · {isComplete ? 'Complete' : isFailed ? 'Failed' : 'Running'}
          </div>
          <div style={{ fontSize: 11.5, color: c.muted }}>
            {isComplete && job.grand_total ? (
              <>Grand total {fmtMoney(job.grand_total, job.currency)} · {job.project_type || 'project'}{job.location ? ' · ' + job.location : ''}</>
            ) : isFailed ? (
              <>{error || job.error_message || 'Something went wrong'}</>
            ) : (
              <>Multi-step reasoning — safe to close and come back, job runs on the server</>
            )}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} title="Close panel (job keeps running)" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: c.muted, fontSize: 18, padding: '2px 8px',
          }}>×</button>
        )}
      </div>

      {/* Download buttons — visible once the package step has produced files */}
      {isComplete && files.length > 0 && (
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid ' + c.border,
          background: isDark ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.04)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.done, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Documents ready
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {files.map((f, i) => (
              <button key={i} onClick={() => downloadFile(f)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '9px 14px', borderRadius: 8, cursor: 'pointer',
                background: f.type === 'xlsx' ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)',
                border: '1px solid ' + (f.type === 'xlsx' ? 'rgba(16,185,129,0.28)' : 'rgba(59,130,246,0.28)'),
                color: f.type === 'xlsx' ? c.done : '#3B82F6',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              }}>
                {f.type === 'xlsx' ? '📊' : '📝'} Download {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        ref={stepsScrollRef}
        style={{
          padding: '4px 4px 8px',
          // Cap the panel's height so a long run with lots of step text
          // doesn't push the rest of the chat (and the input bar) off
          // screen. Internal scroll inside the panel; auto-scrolls to
          // whichever step is currently running.
          maxHeight: 'min(60vh, 520px)',
          overflowY: 'auto',
        }}
      >
        {steps.length === 0 && (
          <div style={{ padding: '18px 16px', fontSize: 12, color: c.muted }}>Connecting...</div>
        )}
        {steps.map(step => {
          // Auto-expand error steps so the user sees the failure message
          // without having to click. Explicit clicks still override.
          const isOpen = expanded[step.step_index] !== undefined
            ? expanded[step.step_index]
            : step.status === 'error';
          const colour = step.status === 'complete' ? c.done
            : step.status === 'running' ? c.accent
            : step.status === 'error' ? c.err
            : c.sub;
          const dot = step.status === 'complete' ? '✓'
            : step.status === 'running' ? '●'
            : step.status === 'error' ? '✕'
            : '·';
          return (
            <div
              key={step.step_index}
              ref={el => { if (el) stepRowRefs.current[step.step_index] = el; }}
              style={{
              margin: '4px 8px', borderRadius: 8,
              background: step.status === 'running' ? c.accentBg
                : step.status === 'error' ? (isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)')
                : c.stepRowBg,
              border: '1px solid ' + (step.status === 'running' ? 'rgba(245,158,11,0.2)'
                : step.status === 'error' ? 'rgba(239,68,68,0.25)'
                : 'transparent'),
            }}>
              <button
                onClick={() => setExpanded(p => ({ ...p, [step.step_index]: !p[step.step_index] }))}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  width: '100%', textAlign: 'left', padding: '9px 12px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  color: c.text, fontFamily: 'inherit',
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: step.status === 'complete' ? 'rgba(16,185,129,0.12)' : step.status === 'running' ? 'rgba(245,158,11,0.15)' : 'transparent',
                  color: colour, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                  animation: step.status === 'running' ? 'pulse 1.2s infinite' : 'none',
                }}>{dot}</span>
                <span style={{ fontSize: 13 }}>{STEP_ICONS[step.step_name] || '·'}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: step.status === 'running' ? 600 : 500 }}>
                  {step.step_title || step.step_name}
                </span>
                <span style={{ fontSize: 10, color: c.muted }}>
                  {step.status === 'complete' && step.text ? (step.text.length + ' chars') : ''}
                </span>
                <span style={{ fontSize: 10, color: c.sub, transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
              </button>
              {isOpen && (step.text || step.thinking) && (
                <div style={{ padding: '4px 16px 12px', borderTop: '1px solid ' + c.border }}>
                  {step.thinking && (
                    <details style={{ marginBottom: 8 }}>
                      <summary style={{ fontSize: 11, color: c.muted, cursor: 'pointer', padding: '4px 0' }}>
                        🧠 Reasoning ({step.thinking.length} chars)
                      </summary>
                      <pre style={{
                        fontSize: 11.5, lineHeight: 1.5, color: c.muted,
                        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                        padding: '8px 10px', borderRadius: 6, margin: '4px 0 0',
                        whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      }}>{step.thinking}</pre>
                    </details>
                  )}
                  {step.text && (
                    <pre style={{
                      fontSize: 12, lineHeight: 1.5, color: c.text,
                      margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      maxHeight: 400, overflowY: 'auto',
                    }}>{step.text}</pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!isComplete && !isFailed && (
          <div style={{ padding: '10px 16px', fontSize: 11, color: c.sub, fontStyle: 'italic' }}>
            Keep this tab open for live updates, or close it and check back — the job runs on the server.
          </div>
        )}
      </div>
    </div>
  );
}

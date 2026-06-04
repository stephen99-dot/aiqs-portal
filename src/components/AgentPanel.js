import React, { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch, getToken } from '../utils/api';
import { useTheme } from '../context/ThemeContext';
import { SearchIcon, ClipboardIcon, RulerIcon, EditIcon, TrashIcon, CalculatorIcon, CheckCircleIcon, XCircleIcon, FileTextIcon, PlugIcon, WrenchIcon, AlertTriangleIcon, CheckIcon, BrainIcon, DotIcon } from './Icons';

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
  view_pdf_page:       { emoji: SearchIcon, label: 'Viewing drawing' },
  set_project_metadata:{ emoji: ClipboardIcon, label: 'Recording project metadata' },
  record_takeoff_item: { emoji: RulerIcon, label: 'Recording BOQ item' },
  update_takeoff_item: { emoji: EditIcon, label: 'Updating item' },
  remove_takeoff_item: { emoji: TrashIcon, label: 'Removing item' },
  run_pricer:          { emoji: CalculatorIcon, label: 'Running pricer' },
  finalize_boq:        { emoji: CheckCircleIcon, label: 'Finalising BOQ' },
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
  const { mode, t: tk } = useTheme();
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
  // narration = the prose Claude writes between tool calls ("Now I'll look at
  // the ground floor plan to measure the extension footprint..."). Shown live
  // so the user can see the agent reasoning out loud, claude.ai-style.
  // narrationLog keeps prior iterations; narration is the currently-streaming
  // block for the active iteration.
  const [narration, setNarration] = useState('');
  const [narrationLog, setNarrationLog] = useState([]);  // [{ iteration, text }]
  const [reviewSummary, setReviewSummary] = useState(null);
  const [findingsNotes, setFindingsNotes] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const [generating, setGenerating] = useState(false);
  // Accuracy layer: variance_note compares grand total vs past projects;
  // sanityWarnings flags individual items whose quantities look off vs
  // historical ranges for this project type. Both refresh on each pricer
  // run and again on submit_for_review.
  const [varianceNote, setVarianceNote] = useState(null);
  const [sanityWarnings, setSanityWarnings] = useState([]);  // [{ key, qty, expected, severity, message }]

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

  // ── User review actions ─────────────────────────────────────────────
  async function updateItem(key, patch) {
    try {
      const token = getToken();
      const r = await fetch(`/api/agent/${runId}/update-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ key, ...patch }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Update failed');
      setItems(prev => prev.map(i => i.key === key ? { ...i, ...patch, edited_by_user: true } : i));
    } catch (e) { alert('Edit failed: ' + e.message); }
  }
  async function removeItem(key) {
    if (!window.confirm('Remove this item from the BOQ?')) return;
    try {
      const token = getToken();
      const r = await fetch(`/api/agent/${runId}/remove-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Remove failed'); }
      setItems(prev => prev.filter(i => i.key !== key));
    } catch (e) { alert('Remove failed: ' + e.message); }
  }
  async function reprice() {
    try {
      const token = getToken();
      const r = await fetch(`/api/agent/${runId}/reprice`, {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Reprice failed');
      setPriced(data.priced);
    } catch (e) { alert('Reprice failed: ' + e.message); }
  }
  async function generate() {
    setGenerating(true);
    try {
      const token = getToken();
      const r = await fetch(`/api/agent/${runId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({ findings_notes: findingsNotes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Generate failed');
      if (data.already_generated) {
        setDownloads(data.downloads || []);
        setRun(r => r ? { ...r, status: 'completed' } : r);
      }
      // else — server is generating in background, SSE will deliver finalized event
    } catch (e) { alert('Generate failed: ' + e.message); setGenerating(false); }
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case 'snapshot':
        setRun(evt.run);
        setItems(evt.run.takeoff_items || []);
        setPriced(evt.run.priced || null);
        setDownloads(evt.run.downloads || []);
        setSanityWarnings(evt.run.sanity_warnings || []);
        setVarianceNote(evt.run.variance_note || null);
        if (evt.run.review_summary) setReviewSummary(evt.run.review_summary);
        if (evt.run.findings_notes) setFindingsNotes(evt.run.findings_notes);
        setActivity(evt.run.current_activity || (
          evt.run.status === 'running' ? 'Thinking...' :
          evt.run.status === 'awaiting_review' ? 'Awaiting your review' :
          evt.run.status === 'generating' ? 'Generating documents' :
          evt.run.status === 'completed' ? 'Complete' :
          evt.run.status === 'failed' ? 'Failed' : 'Starting...'));
        if (evt.run.error_message) setError(evt.run.error_message);
        break;
      case 'run_started':
        break;
      case 'iteration_start':
        setRun(r => r ? { ...r, iteration_count: evt.iteration } : r);
        // Roll the previous iteration's narration into the log, start fresh.
        // We also log silent iterations (Claude only called tools, no prose)
        // so the user sees continuous progress, not a confusing gap.
        setNarration(prev => {
          const prevIter = evt.iteration - 1;
          if (prevIter >= 1) {
            setNarrationLog(log => [...log, {
              iteration: prevIter,
              text: prev && prev.trim() ? prev : null,
            }]);
          }
          return '';
        });
        break;
      case 'activity':
        setActivity(evt.activity);
        break;
      case 'text_delta':
        // Stream Claude's prose narration live — shown prominently in panel
        setNarration(r => r + evt.delta);
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
        if (evt.sanity_warnings) setSanityWarnings(evt.sanity_warnings);
        if (evt.variance_note !== undefined) setVarianceNote(evt.variance_note);
        break;
      case 'submitted_for_review':
        setReviewSummary(evt.summary);
        setFindingsNotes(evt.findings_notes || '');
        if (evt.sanity_warnings) setSanityWarnings(evt.sanity_warnings);
        if (evt.variance_note !== undefined) setVarianceNote(evt.variance_note);
        setRun(r => r ? { ...r, status: 'awaiting_review' } : r);
        setActivity('Awaiting your review — edit items below then click Generate');
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

  // Palette derived from theme tokens so the live agent panel matches the theme.
  const c = {
    bg: tk.bg, card: tk.card, border: tk.border,
    text: tk.text, muted: tk.textSecondary, sub: tk.textMuted,
    accent: tk.accent, accentBg: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    done: tk.success, err: tk.danger,
    row: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)',
  };

  // SQLite's CURRENT_TIMESTAMP is UTC but returned without a 'Z' suffix,
  // so JS Date parses it as LOCAL time — giving a ~1hr drift on BST/IST.
  // Normalise by appending 'Z' when there's no explicit timezone indicator.
  const parseUtc = (ts) => {
    if (!ts) return null;
    const hasTZ = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts);
    const normalised = hasTZ ? ts : (ts.includes('T') ? ts + 'Z' : ts.replace(' ', 'T') + 'Z');
    const t = new Date(normalised).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const startedAt = parseUtc(run?.created_at);
  const completedAt = parseUtc(run?.completed_at);
  const updatedAt = parseUtc(run?.updated_at);
  const iter = run?.iteration_count || 0;
  const isRunning = run?.status === 'running' || run?.status === 'queued';
  const isAwaitingReview = run?.status === 'awaiting_review';
  const isGenerating = run?.status === 'generating';
  const isComplete = run?.status === 'completed';
  const isFailed = run?.status === 'failed';
  // Freeze elapsed once the run is no longer actively progressing — otherwise
  // the panel keeps ticking forever even after Atlas has stopped working.
  // For awaiting_review we pin to the last updated_at (when submit_for_review fired).
  const frozenEnd = isComplete || isFailed
    ? (completedAt || updatedAt)
    : isAwaitingReview
      ? updatedAt
      : null;
  const elapsedSec = startedAt
    ? Math.max(0, Math.floor(((frozenEnd || now) - startedAt) / 1000))
    : 0;

  // ETA: estimate remaining iterations * seconds per iteration, minus what we've done
  const totalEstSec = TYPICAL_ITERATIONS * SECONDS_PER_ITERATION;
  const remainingSec = isRunning ? Math.max(0, totalEstSec - elapsedSec) : 0;
  const progressPct = isComplete ? 100 : isFailed ? 100 : Math.min(95, (elapsedSec / totalEstSec) * 100);

  // "Initialising" state — SSE connected but no iteration has started yet.
  // Covers the gap between button press (runId set) and first iteration_start
  // event, which can be 3-8s while ZIPs unpack, Claude warms up, first response
  // starts streaming.
  const isInitialising = runId && (!run || run.status === 'queued' || (run.status === 'running' && iter === 0));

  // Auto-scroll the panel body to the bottom as new content streams in,
  // unless the user has scrolled up to read older content.
  const bodyRef = useRef(null);
  const userScrolledRef = useRef(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length, toolCalls.length, narration, narrationLog.length, priced, downloads.length]);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledRef.current = distFromBottom > 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  if (!runId) return null;

  // Outer positioning — fullscreen mode overlays the whole viewport; otherwise
  // sits inline in the chat with a generous height cap so it's readable.
  // Inline, borderless presentation — flows in the conversation like a Claude
  // message rather than a heavy boxed panel.
  const rootStyle = { marginTop: 6, display: 'flex', flexDirection: 'column', maxHeight: '72vh' };

  return (
    <div style={rootStyle}>

      {/* Header — clean inline status, no box chrome */}
      <div style={{ padding: '12px 2px 8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.accentBg, color: c.accent }}>
            {isComplete ? <CheckCircleIcon size={18} /> : isFailed ? <XCircleIcon size={18} /> : isAwaitingReview ? <ClipboardIcon size={18} /> : isGenerating ? <FileTextIcon size={18} /> : isInitialising ? <PlugIcon size={18} /> : <WrenchIcon size={18} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>
              Atlas · {isComplete ? 'Complete' : isFailed ? 'Failed' : isAwaitingReview ? 'Ready for review' : isGenerating ? 'Generating documents' : isInitialising ? 'Initialising' : 'Working'}
              {run?.project_type && <span style={{ fontWeight: 400, color: c.muted }}> · {run.project_type}</span>}
            </div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>
              {isComplete && run?.grand_total
                ? <>Grand total {fmtMoney(run.grand_total, run.currency)} · {iter} steps · {fmtElapsed(elapsedSec)}</>
                : isFailed
                ? <>{error || run?.error_message || 'Agent failed'}</>
                : isAwaitingReview
                ? <>{items.length} items · {priced?.summary ? fmtMoney(priced.summary.grand_total, priced.summary.currency) + ' grand total' : 'priced'} · review and edit below, then Generate</>
                : isGenerating
                ? <>Producing your Excel + Word — about 10-20 seconds</>
                : isInitialising
                ? <>Reading your drawings{elapsedSec > 2 ? ` · ${fmtElapsed(elapsedSec)}` : ''}</>
                : <>elapsed {fmtElapsed(elapsedSec)} · {fmtETA(remainingSec)}</>}
            </div>
          </div>
          <button
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 12.5, padding: '2px 6px', fontWeight: 600 }}
          >
            {collapsed ? '▼' : '▲'}
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

        {/* Live status — subtle, claude.ai-style "thinking" line (no box) */}
        {(isRunning || isInitialising) && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: c.muted, fontWeight: 500 }}>
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {[0, 1, 2].map(d => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: c.accent, animation: 'dot 1.4s infinite', animationDelay: (d * 0.2) + 's' }} />)}
            </span>
            <span style={{ flex: 1 }}>{isInitialising ? 'Atlas is initialising — preparing your drawings…' : (activity || 'Thinking…')}</span>
          </div>
        )}
      </div>

      {/* Body — hidden when collapsed. The panel itself caps at 85vh so
          it never swallows the whole viewport; the body scrolls internally
          and auto-follows new content (unless you've scrolled up to read
          older notes). */}
      {!collapsed && (
        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>

          {/* Variance warning — shown whenever priced cost/m² is ±30% vs
              user's historical jobs for this project type. Surfaces both
              during running (after run_pricer) and in the review block. */}
          {varianceNote && !isComplete && (
            <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border, background: /^HIGH/.test(varianceNote) ? (isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)') : (isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)'), borderLeft: '3px solid ' + (/^HIGH/.test(varianceNote) ? c.err : c.accent) }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: /^HIGH/.test(varianceNote) ? c.err : c.accent, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
<AlertTriangleIcon size={14} style={{ verticalAlign:'middle', marginRight:6 }} />Cost variance vs your past projects
              </div>
              <div style={{ fontSize: 12.5, color: c.text, lineHeight: 1.5 }}>
                {varianceNote}
              </div>
              {/^LOW/.test(varianceNote) && (
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 4, fontStyle: 'italic' }}>
                  Typically means items missed — check prelims, M&E, external works, scaffolding.
                </div>
              )}
            </div>
          )}

          {/* REVIEW BLOCK — shown when Atlas has paused for user approval.
              Pinned at the top so the user sees the summary + Generate
              button immediately. Items become editable below. */}
          {isAwaitingReview && (
            <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + c.border }}>
              <div style={{ fontSize: 13.5, color: c.text, lineHeight: 1.65, marginBottom: priced?.summary ? 8 : 14 }}>
                {reviewSummary || 'I’ve finished the take-off. Have a look at the quantities below — tweak anything that looks off by clicking a figure — then generate your Excel BOQ and Word findings report.'}
              </div>
              {priced?.summary && (
                <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 14 }}>
                  {items.length} items · Construction {fmtMoney(priced.summary.construction_total, priced.summary.currency)} · Grand total <strong style={{ color: c.text }}>{fmtMoney(priced.summary.grand_total, priced.summary.currency)}</strong> ({priced.summary.currency === 'EUR' ? '€' : '£'}, {priced.summary.vat_rate}% VAT)
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={generate} disabled={generating} style={{ padding: '11px 20px', borderRadius: 10, background: c.done, border: 'none', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: generating ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: generating ? 0.6 : 1, boxShadow: '0 4px 14px rgba(16,185,129,0.28)' }}>
                  {generating ? 'Generating…' : <><CheckIcon size={15} style={{ verticalAlign:'middle', marginRight:7 }} />Generate documents</>}
                </button>
                <button onClick={reprice} style={{ padding: '10px 14px', borderRadius: 9, background: 'transparent', border: '1px solid ' + c.border, color: c.muted, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <CalculatorIcon size={13} style={{ verticalAlign:'middle', marginRight:6 }} />Re-price
                </button>
              </div>
              {/* Findings notes — editable textarea so user can tweak the
                  Word report narrative before generation. */}
              <details style={{ marginTop: 12 }}>
                <summary style={{ fontSize: 11.5, color: c.muted, cursor: 'pointer', fontWeight: 600 }}>
                  Edit findings notes for the Word report
                </summary>
                <textarea
                  value={findingsNotes}
                  onChange={e => setFindingsNotes(e.target.value)}
                  rows={6}
                  style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 6, border: '1px solid ' + c.border, background: c.card, color: c.text, fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.55, boxSizing: 'border-box' }}
                />
              </details>
            </div>
          )}
          {/* Live narration — the agent's prose as it thinks through the
              job. Streams in character-by-character. Prior iterations
              collapse into compact log entries (silent ones flagged so
              you see continuous progress). Current iteration always shown
              inline with a blinking caret while running. */}
          {(narrationLog.length > 0 || narration || isRunning) && (
            <div style={{ padding: '16px 18px', borderBottom: '1px solid ' + c.border }}>
              {/* Prior steps — collapsed, clean labels */}
              {narrationLog.map((entry, i) => entry.text ? (
                <details key={i} style={{ marginBottom: 8 }} open={i === narrationLog.length - 1 && !narration}>
                  <summary style={{ fontSize: 12, color: c.muted, cursor: 'pointer', fontWeight: 600, padding: '3px 0' }}>
                    Step {entry.iteration}
                  </summary>
                  <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: '6px 0 6px 10px', marginTop: 4, borderLeft: '2px solid ' + c.border, opacity: 0.9 }}>
                    {entry.text}
                  </div>
                </details>
              ) : null)}
              {/* Current step — flowing prose, like a Claude reply */}
              {isRunning && (
                <div style={{ fontSize: 13.5, color: c.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: narrationLog.length > 0 ? 12 : 0 }}>
                  {narration || <span style={{ color: c.muted, fontStyle: 'italic' }}>{(activity && !/^thinking/i.test(activity)) ? activity : 'Atlas is studying your drawings…'}</span>}
                  {narration && <span style={{ display: 'inline-block', width: 7, height: 14, background: c.accent, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'pulse 1s infinite' }} />}
                </div>
              )}
            </div>
          )}

          {/* Deliverables — slides in when Atlas finishes, claude.ai-style */}
          {isComplete && downloads.length > 0 && (
            <div style={{ padding: '18px', borderBottom: '1px solid ' + c.border, background: isDark ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.04)', animation: 'agentslide 0.4s cubic-bezier(0.22,1,0.36,1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                <CheckCircleIcon size={20} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: c.text }}>Your documents are ready</div>
                  <div style={{ fontSize: 12, color: c.muted }}>
                    {run?.grand_total ? <>Grand total {fmtMoney(run.grand_total, run.currency)} · </> : null}{downloads.length} file{downloads.length !== 1 ? 's' : ''} · download or open below
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

          {/* Takeoff items — only once recorded (or in review). Editable in the
              awaiting_review state (click a qty to edit, or remove the row). */}
          {(items.length > 0 || isAwaitingReview) && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border }}>
            {sanityWarnings.length > 0 && !isComplete && (
              <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 7, background: isDark ? 'rgba(245,158,11,0.10)' : 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderLeft: '3px solid ' + c.accent }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  <AlertTriangleIcon size={14} style={{ verticalAlign:'middle', marginRight:6 }} />{sanityWarnings.length} quantity warning{sanityWarnings.length !== 1 ? 's' : ''} vs your history
                </div>
                <div style={{ fontSize: 11.5, color: c.text, lineHeight: 1.55 }}>
                  {sanityWarnings.slice(0, 4).map((w, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>{w.message}</div>
                  ))}
                  {sanityWarnings.length > 4 && <div style={{ color: c.muted, fontSize: 11 }}>+ {sanityWarnings.length - 4} more flagged below</div>}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Takeoff</span>
              <span style={{ fontSize: 12, color: c.muted }}>{items.length} item{items.length !== 1 ? 's' : ''}{run?.floor_area_m2 ? ` · ${run.floor_area_m2}m²` : ''}</span>
              {isAwaitingReview && <span style={{ fontSize: 11, color: c.accent, fontWeight: 600, marginLeft: 'auto' }}><EditIcon size={12} style={{ verticalAlign:'middle', marginRight:4 }} />click qty to edit</span>}
              {!isAwaitingReview && items.length > 15 && (
                <button onClick={() => setShowAllItems(v => !v)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: c.accent, fontSize: 11, fontWeight: 600, padding: 0, fontFamily: 'inherit' }}>
                  {showAllItems ? `Show first 15` : `Show all ${items.length}`}
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: c.muted, padding: '6px 0' }}>Agent hasn't recorded any items yet.</div>
            ) : (
              <div style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                {(isAwaitingReview || showAllItems ? items : items.slice(0, 15)).map((it, i) => {
                  const warning = sanityWarnings.find(w => w.key === it.key);
                  return (
                    <ItemRow
                      key={it.key + '-' + i}
                      it={it} zebra={i % 2 === 0}
                      c={c} isDark={isDark}
                      warning={warning}
                      editable={isAwaitingReview}
                      editing={editingKey === it.key}
                      onEdit={() => setEditingKey(it.key)}
                      onCancel={() => setEditingKey(null)}
                      onSave={(patch) => { updateItem(it.key, patch); setEditingKey(null); }}
                      onRemove={() => removeItem(it.key)}
                    />
                  );
                })}
                {!isAwaitingReview && !showAllItems && items.length > 15 && (
                  <div style={{ fontSize: 11, color: c.muted, padding: '6px 8px', fontStyle: 'italic' }}>
                    … {items.length - 15} more items. Click "Show all {items.length}" above to expand.
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Tool call log — only once there's activity */}
          {toolCalls.length > 0 && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + c.border }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.sub, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Recent activity</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {toolCalls.map((tc, i) => {
                  const label = TOOL_LABELS[tc.tool] || { emoji: DotIcon, label: tc.tool };
                  const LabelIcon = label.emoji;
                  const dotColor = tc.status === 'done' ? c.done : tc.status === 'error' ? c.err : c.accent;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}><LabelIcon size={14} /></span>
                      <span style={{ color: c.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label.label}{tc.input && tc.tool === 'view_pdf_page' ? ` — ${tc.input.filename} p${tc.input.page}` : tc.input && tc.tool === 'record_takeoff_item' ? ` — ${tc.input.key}` : ''}
                      </span>
                      <span style={{ color: c.sub, fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(tc.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  );
                })}
              </div>
          </div>
          )}

          {/* Reasoning toggle */}
          <div style={{ padding: '10px 18px' }}>
            <button
              onClick={() => setShowReasoning(v => !v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 11.5, fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
            >
              <span style={{ transform: showReasoning ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', display: 'inline-block', fontSize: 10 }}>▶</span>
              <BrainIcon size={14} style={{ verticalAlign:'middle', marginRight:4 }} />{showReasoning ? 'Hide' : 'Show'} reasoning
            </button>
            {showReasoning && reasoning && (
              <pre style={{ marginTop: 8, padding: '10px 12px', borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', fontSize: 11.5, color: c.muted, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                {reasoning}
              </pre>
            )}
          </div>

        </div>
      )}

      <style>{`
        @keyframes dot { 0%,80%,100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
        @keyframes pulse { 0%,100% { opacity: 0.2; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}

// ItemRow — one line in the takeoff list. In read-only (running) mode
// it displays description/qty/section compactly. In review mode the
// description wraps fully and the qty is click-to-edit with an inline
// form, plus a remove button on hover.
function ItemRow({ it, zebra, c, isDark, warning, editable, editing, onEdit, onCancel, onSave, onRemove }) {
  const [qty, setQty] = useState(it.qty);
  const [rate, setRate] = useState(it.assumed_rate || '');
  const [desc, setDesc] = useState(it.description || '');
  useEffect(() => { setQty(it.qty); setRate(it.assumed_rate || ''); setDesc(it.description || ''); }, [it.qty, it.assumed_rate, it.description, editing]);

  const warnBorder = warning ? (warning.severity === 'high' ? c.err : c.accent) : null;

  if (!editable) {
    return (
      <div style={{ padding: '5px 8px', borderRadius: 5, background: zebra ? c.row : 'transparent', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center', borderLeft: warning ? `3px solid ${warnBorder}` : '3px solid transparent', paddingLeft: 8 }}>
        <span style={{ color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.description}>{it.description || it.key}</span>
        <span style={{ color: warning ? warnBorder : c.muted, whiteSpace: 'nowrap', fontWeight: warning ? 700 : 400 }}>{it.qty} {it.unit}</span>
        {warning ? <span title={warning.message} style={{ fontSize: 11, whiteSpace: 'nowrap' }}><AlertTriangleIcon size={14} /></span> : <span />}
        <span style={{ color: c.sub, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{it.section}</span>
      </div>
    );
  }
  if (editing) {
    return (
      <div style={{ padding: 10, borderRadius: 6, background: isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.28)', marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.sub, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{it.key} · {it.section}</div>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} style={{ width: '100%', padding: 7, borderRadius: 5, border: '1px solid ' + c.border, background: c.card, color: c.text, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 6 }} placeholder="Description with measurement working" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.muted }}>
            Qty: <input type="number" step="any" value={qty} onChange={e => setQty(Number(e.target.value))} style={{ width: 90, padding: '4px 6px', borderRadius: 5, border: '1px solid ' + c.border, background: c.card, color: c.text, fontSize: 12.5, fontFamily: 'inherit' }} />
            <span>{it.unit}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.muted }}>
            Rate override: <input type="number" step="any" value={rate} onChange={e => setRate(e.target.value)} placeholder="auto" style={{ width: 100, padding: '4px 6px', borderRadius: 5, border: '1px solid ' + c.border, background: c.card, color: c.text, fontSize: 12.5, fontFamily: 'inherit' }} />
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button onClick={onCancel} style={{ padding: '5px 12px', borderRadius: 5, background: 'transparent', border: '1px solid ' + c.border, color: c.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={() => onSave({ qty, assumed_rate: rate ? Number(rate) : null, description: desc })} style={{ padding: '5px 14px', borderRadius: 5, background: c.accent, border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: '7px 8px', borderRadius: 5, background: zebra ? c.row : 'transparent', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center', cursor: 'pointer', borderLeft: warning ? `3px solid ${warnBorder}` : '3px solid transparent', paddingLeft: 8 }} onClick={onEdit} title={warning ? warning.message : 'Click to edit'}>
      <span style={{ color: c.text, lineHeight: 1.5, minWidth: 0, overflow: 'hidden' }}>
        {warning && <span title={warning.message} style={{ marginRight: 6 }}><AlertTriangleIcon size={14} /></span>}
        {it.description || it.key}
        {it.edited_by_user && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.15)', color: '#3B82F6', fontWeight: 600 }}>edited</span>}
        {warning && (
          <div style={{ fontSize: 11, color: warnBorder, marginTop: 3, fontStyle: 'italic' }}>
            {warning.message}
          </div>
        )}
      </span>
      <span style={{ color: warning ? warnBorder : c.text, whiteSpace: 'nowrap', fontWeight: 700 }}>{it.qty} {it.unit}</span>
      <span style={{ color: c.sub, fontSize: 10, padding: '1px 6px', borderRadius: 4, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{it.section}</span>
      <button onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.err, fontSize: 14, padding: '0 4px' }}>×</button>
    </div>
  );
}

function fmtFileSize(bytes) {
  if (!bytes || bytes < 1) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function agentOpenInViewer(f) {
  try {
    const token = getToken();
    const r = await fetch('/api/files/sign/' + encodeURIComponent(f.name), { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new Error();
    const { url } = await r.json();
    const ext = (f.type || (f.name || '').split('.').pop() || '').toLowerCase();
    const viewer = ext === 'pdf' ? url : 'https://docs.google.com/viewer?url=' + encodeURIComponent(url) + '&embedded=false';
    window.open(viewer, '_blank', 'noopener');
  } catch { alert('Could not open the file — try downloading it instead.'); }
}

function agentFileMeta(f) {
  const t = (f.type || (f.name || '').split('.').pop() || '').toLowerCase();
  if (t === 'xlsx' || t === 'xls') return { label: 'Excel spreadsheet', ext: 'XLSX', color: '#10B981', bg: 'rgba(16,185,129,0.14)' };
  if (t === 'docx' || t === 'doc') return { label: 'Word document', ext: 'DOCX', color: '#2563EB', bg: 'rgba(37,99,235,0.14)' };
  if (t === 'pdf') return { label: 'PDF document', ext: 'PDF', color: '#DC2626', bg: 'rgba(220,38,38,0.14)' };
  return { label: 'Document', ext: (t || 'FILE').toUpperCase(), color: '#64748B', bg: 'rgba(100,116,139,0.14)' };
}

// claude.ai-style attachment card (matches ChatPage's FileCard).
function DownloadButton({ f, c, isDark }) {
  const [busy, setBusy] = useState(false);
  const m = agentFileMeta(f);
  const idle = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.1)';
  const onClick = async () => {
    if (busy) return;
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
  };
  return (
    <div
      onClick={onClick}
      title={'Download ' + f.name}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12,
        cursor: busy ? 'wait' : 'pointer', maxWidth: 360,
        background: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
        border: '1px solid ' + idle, transition: 'border-color .12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = m.color; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = idle; }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.bg }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
        <div style={{ fontSize: 11, color: c.muted, marginTop: 1 }}>{busy ? 'Downloading…' : m.ext + ' · ' + (f.size ? fmtFileSize(f.size) : m.label)}</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); agentOpenInViewer(f); }}
        title="Open in browser (Google viewer)"
        style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.muted, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
      <div title="Download" style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.muted }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
    </div>
  );
}

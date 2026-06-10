import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch, getToken } from '../utils/api';
import { useTheme } from '../context/ThemeContext';
import { SearchIcon, ClipboardIcon, RulerIcon, EditIcon, TrashIcon, CalculatorIcon, CheckCircleIcon, XCircleIcon, FileTextIcon, PlugIcon, WrenchIcon, AlertTriangleIcon, CheckIcon, BrainIcon, DotIcon } from './Icons';

// Renders the agent's reasoning prose as markdown (headers, bullets, bold
// figures) so it reads like a Claude reply rather than raw text.
function AgentMd({ text, c, muted, caret }) {
  const col = muted ? c.muted : c.text;
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.75, color: col }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        p: ({ node, ...p }) => <p {...p} style={{ margin: '0 0 8px' }} />,
        ul: ({ node, ...p }) => <ul {...p} style={{ margin: '0 0 8px', paddingLeft: 18 }} />,
        ol: ({ node, ...p }) => <ol {...p} style={{ margin: '0 0 8px', paddingLeft: 18 }} />,
        li: ({ node, ...p }) => <li {...p} style={{ margin: '2px 0' }} />,
        h1: ({ node, ...p }) => <h3 {...p} style={{ fontSize: 15, fontWeight: 700, margin: '12px 0 6px', color: c.text }} />,
        h2: ({ node, ...p }) => <h3 {...p} style={{ fontSize: 14.5, fontWeight: 700, margin: '12px 0 6px', color: c.text }} />,
        h3: ({ node, ...p }) => <h4 {...p} style={{ fontSize: 13.5, fontWeight: 700, margin: '10px 0 4px', color: c.text }} />,
        strong: ({ node, ...p }) => <strong {...p} style={{ fontWeight: 700, color: c.text }} />,
        em: ({ node, ...p }) => <em {...p} />,
        code: ({ node, inline, ...p }) => <code {...p} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' }} />,
        a: ({ node, ...p }) => <a {...p} style={{ color: c.accent, textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" />,
        table: ({ node, ...p }) => <div style={{ overflowX: 'auto' }}><table {...p} style={{ borderCollapse: 'collapse', fontSize: 12.5, margin: '0 0 8px' }} /></div>,
        td: ({ node, ...p }) => <td {...p} style={{ border: `1px solid ${c.border}`, padding: '4px 8px' }} />,
        th: ({ node, ...p }) => <th {...p} style={{ border: `1px solid ${c.border}`, padding: '4px 8px', textAlign: 'left', fontWeight: 700 }} />,
      }}>{text || ''}</ReactMarkdown>
      {caret && <span style={{ display: 'inline-block', width: 7, height: 14, background: c.accent, marginLeft: 1, verticalAlign: 'text-bottom', animation: 'pulse 1s infinite' }} />}
    </div>
  );
}

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
  view_pdf_page:       { emoji: SearchIcon, label: 'Reading drawing' },
  zoom_region:         { emoji: SearchIcon, label: 'Zooming into detail' },
  set_project_metadata:{ emoji: ClipboardIcon, label: 'Noting project details' },
  record_takeoff_item: { emoji: RulerIcon, label: 'Measuring' },
  update_takeoff_item: { emoji: EditIcon, label: 'Adjusting' },
  remove_takeoff_item: { emoji: TrashIcon, label: 'Removing item' },
  run_pricer:          { emoji: CalculatorIcon, label: 'Pricing' },
  submit_for_review:   { emoji: ClipboardIcon, label: 'Preparing your review' },
  finalize_boq:        { emoji: CheckCircleIcon, label: 'Finalising BOQ' },
};

// Typical elapsed seconds by iteration count — very rough, used for ETA.
// Based on observation: ~15-20s per iteration on Sonnet with thinking.
const SECONDS_PER_ITERATION = 18;
const TYPICAL_ITERATIONS = 22;

// Collapsible "Thinking" disclosure — claude.ai style. Shows "Thinking" with a
// shimmer/dots while active, "Thought for Xs" when done; expands to the trace.
function ThinkingPill({ c, running, elapsed, eta, text, open, onToggle }) {
  const hasText = !!(text && text.trim());
  return (
    <div>
      <button onClick={hasText ? onToggle : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 999, padding: '4px 12px', cursor: hasText ? 'pointer' : 'default', fontFamily: 'inherit' }}>
        {hasText && <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 9, color: c.sub }}>▶</span>}
        <span style={{ fontSize: 12.5, fontWeight: 600, color: running ? c.sub : c.muted }}>{running ? `Thinking · ${elapsed}` : `Thought for ${elapsed}`}</span>
        {running && <span style={{ display: 'inline-flex', gap: 3 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: c.sub, animation: 'dot 1.4s infinite', animationDelay: (i * 0.2) + 's' }} />)}</span>}
        {running && eta && <span style={{ fontSize: 11.5, fontWeight: 500, color: c.muted, marginLeft: 2 }}>· {eta}</span>}
      </button>
      {open && hasText && (
        <div style={{ marginTop: 8, padding: '8px 0 4px 12px', borderLeft: `2px solid ${c.border}` }}>
          <AgentMd text={text} c={c} muted />
        </div>
      )}
    </div>
  );
}

// Collapsible tool-use chip — a single summary ("Read 3 drawings · measured 24
// items"), expands to the list. Claude shows tool use as one compact card.
function ToolChip({ c, toolCalls, open, onToggle }) {
  const drawings = new Set(); let measured = 0, priced = 0;
  toolCalls.forEach(tc => {
    if (tc.tool === 'view_pdf_page' || tc.tool === 'zoom_region') { if (tc.input && tc.input.filename) drawings.add(tc.input.filename); }
    else if (tc.tool === 'record_takeoff_item') measured++;
    else if (tc.tool === 'run_pricer') priced++;
  });
  const parts = [];
  if (drawings.size) parts.push(`Read ${drawings.size} drawing${drawings.size !== 1 ? 's' : ''}`);
  if (measured) parts.push(`measured ${measured} item${measured !== 1 ? 's' : ''}`);
  if (priced) parts.push('priced');
  const summary = parts.join(' · ') || `${toolCalls.length} step${toolCalls.length !== 1 ? 's' : ''}`;
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={onToggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 8, padding: '4px 11px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 9, color: c.sub }}>▶</span>
        <SearchIcon size={13} color={c.sub} />
        <span style={{ fontSize: 12.5, color: c.sub, fontWeight: 500 }}>{summary}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: '4px 0 4px 12px', borderLeft: `2px solid ${c.border}` }}>
          {toolCalls.slice(-14).map((tc, i) => {
            const label = TOOL_LABELS[tc.tool] || { emoji: DotIcon, label: tc.tool };
            const LI = label.emoji;
            const detail = tc.input && (tc.tool === 'view_pdf_page' || tc.tool === 'zoom_region')
              ? ` — ${tc.input.filename}${tc.input.page ? ` · p${tc.input.page}` : ''}`
              : tc.input && (tc.tool === 'record_takeoff_item' || tc.tool === 'update_takeoff_item') ? ` — ${tc.input.key}` : '';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: c.muted, padding: '2px 0' }}>
                <span style={{ color: c.sub, flexShrink: 0, display: 'inline-flex' }}><LI size={13} /></span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label.label}{detail}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

export default function AgentPanel({ runId, onClose, onCompleted, onGenerate }) {
  const { mode, t: tk } = useTheme();
  const isDark = mode === 'dark';

  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);
  const [priced, setPriced] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [activity, setActivity] = useState('Connecting...');
  const [toolCalls, setToolCalls] = useState([]);  // [{ ts, tool, input }]
  const [showReasoning, setShowReasoning] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
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
      // Show the "generating…" state immediately rather than waiting for SSE.
      setRun(rr => rr ? { ...rr, status: 'generating' } : rr);

      if (data.already_generated) {
        try { const snap = await apiFetch('/agent/' + runId); if (snap && snap.run) { setRun(snap.run); setDownloads(snap.run.downloads || []); if (onCompleted) onCompleted(snap.run); } }
        catch (e) {}
        return;
      }

      // Poll for completion — resilient even if the live SSE stream has dropped
      // by the time the user clicks Generate (it can sit idle at the review step).
      const started = Date.now();
      const poll = async () => {
        try {
          const d = await apiFetch('/agent/' + runId);
          if (d && d.run) {
            if (d.run.status === 'completed') {
              setRun(d.run); setDownloads(d.run.downloads || []);
              if (onCompleted) onCompleted(d.run);
              return;
            }
            if (d.run.status === 'failed') {
              setError(d.run.error_message || 'Document generation failed — please try again.');
              setRun(d.run); setGenerating(false);
              return;
            }
          }
        } catch (e) { /* keep trying */ }
        if (Date.now() - started < 120000) setTimeout(poll, 2500);
        else { setGenerating(false); alert('Generating is taking longer than expected — refresh the page in a moment and your documents should be ready.'); }
      };
      setTimeout(poll, 2500);
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

      {/* No header chrome — Atlas reads like a Claude message */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, padding: '6px 0' }}>

        {/* Failed */}
        {isFailed && (
          <div style={{ padding: '12px 18px', color: c.err, fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <XCircleIcon size={16} /><span>{error || run?.error_message || 'Atlas hit a problem — please try again.'}</span>
          </div>
        )}

        {/* Working — claude-style: mark + Thinking disclosure + tool chip + streaming body */}
        {(isRunning || isInitialising || isGenerating) && (
          <div style={{ padding: '8px 18px 4px', display: 'flex', gap: 12 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.accentBg, color: c.accent, marginTop: 1 }}><WrenchIcon size={15} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ThinkingPill c={c} running={isRunning || isInitialising} elapsed={fmtElapsed(elapsedSec)} eta={isRunning ? fmtETA(remainingSec) : null}
                text={[narrationLog.map(e => e.text).filter(Boolean).join('\n\n'), reasoning].filter(Boolean).join('\n\n')}
                open={showReasoning} onToggle={() => setShowReasoning(v => !v)} />
              {toolCalls.length > 0 && (
                <ToolChip c={c} toolCalls={toolCalls} open={toolsOpen} onToggle={() => setToolsOpen(v => !v)} />
              )}
              <div style={{ marginTop: 10 }}>
                {isGenerating
                  ? <span style={{ fontSize: 14, color: c.text }}>Generating your Excel BOQ and Word findings report…</span>
                  : (narration
                      ? <AgentMd text={narration} c={c} caret />
                      : <span style={{ fontSize: 13.5, color: c.muted, fontStyle: 'italic' }}>{(() => { const a = (activity || '').replace(/\s*\(iteration\s*\d+\/\d+\)/i, '').trim(); return (a && !/^thinking$/i.test(a)) ? a : 'Reading your drawings…'; })()}</span>)}
              </div>
            </div>
          </div>
        )}

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
                <button onClick={() => { if (onGenerate) { setGenerating(true); onGenerate(); } else { generate(); } }} disabled={generating} style={{ padding: '11px 20px', borderRadius: 10, background: c.done, border: 'none', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: generating ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: generating ? 0.6 : 1, boxShadow: '0 4px 14px rgba(16,185,129,0.28)' }}>
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
          {priced && priced.summary && isAwaitingReview && (
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
          {isAwaitingReview && (
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

        </div>

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

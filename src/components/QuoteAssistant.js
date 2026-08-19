import React, { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../utils/api';

// "Update with AI" — a chat drawer on the quote editor. The builder says what
// changed ("I've got the electrician's quote now" + upload, "add £400 for a
// skip"), the assistant asks qualifying questions when it needs to, then comes
// back with a proposed changeset. Nothing touches the quote until the builder
// taps Apply — the parent page then patches its on-screen lines and saves
// through the normal save path.

function fmtMoney(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  const v = Number(n) || 0;
  return sym + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.csv,.docx';

export default function QuoteAssistant({ t, isMobile, quoteId, currency, getQuoteState, onApply }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);   // { role, text, proposal?, applied?, memories? }
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, sending, open]);

  const send = async () => {
    const message = input.trim();
    if ((!message && files.length === 0) || sending) return;
    setError('');
    const userMsg = { role: 'user', text: message || ('📎 ' + files.map(f => f.name).join(', ')) };
    // History is text-only — proposals/files don't round-trip.
    const history = msgs
      .filter(m => m.text)
      .slice(-12)
      .map(m => ({ role: m.role, text: m.text }));
    setMsgs(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('message', message);
      fd.append('history', JSON.stringify(history));
      fd.append('quote_state', JSON.stringify(getQuoteState()));
      for (const f of files) fd.append('files', f);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
      const r = await apiFetch('/estimator/quotes/' + quoteId + '/assistant', { method: 'POST', body: fd });
      setMsgs(prev => [...prev, {
        role: 'assistant',
        text: r.reply || '',
        proposal: r.proposal || null,
        memories: (r.memories_saved && r.memories_saved.length) ? r.memories_saved : null,
      }]);
    } catch (e) {
      setError(e.message || 'Something went wrong — try again.');
    } finally {
      setSending(false);
    }
  };

  const applyProposal = (msgIdx) => {
    const m = msgs[msgIdx];
    if (!m || !m.proposal || m.applied) return;
    onApply(m.proposal);
    setMsgs(prev => prev.map((mm, i) => i === msgIdx ? { ...mm, applied: true } : mm));
  };

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || []).slice(0, 5);
    setFiles(picked);
  };

  // ─── Floating opener ─────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        title="Tell the AI what's changed on this quote"
        style={{
          position: 'fixed', right: 16, bottom: isMobile ? 86 : 24, zIndex: 180,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          minHeight: 50, padding: '0 18px', borderRadius: 999, border: 'none',
          background: t.accent, color: '#fff', fontSize: 14.5, fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        }}
      >
        ✨ Update with AI
      </button>
    );
  }

  const panelStyle = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, top: '12%', zIndex: 220, borderRadius: '16px 16px 0 0' }
    : { position: 'fixed', right: 16, bottom: 16, width: 420, height: 'min(640px, calc(100vh - 100px))', zIndex: 220, borderRadius: 16 };

  return (
    <div style={{
      ...panelStyle,
      background: t.card, border: '1px solid ' + t.border,
      boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid ' + t.border }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: t.text }}>✨ Update this quote</div>
          <div style={{ fontSize: 12, color: t.textMuted }}>Say what's changed — attach a supplier's quote if you've got one</div>
        </div>
        <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: t.textSecondary, fontSize: 20, cursor: 'pointer', padding: 4 }}>×</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.length === 0 && (
          <div style={{ color: t.textSecondary, fontSize: 13.5, lineHeight: 1.55, background: t.surface, borderRadius: 12, padding: 14 }}>
            Try things like:
            <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
              <li>"I've got the electrician's quote now" — attach it and I'll adjust the costs</li>
              <li>"Add £400 for a second skip"</li>
              <li>"The roof section needs to be £6,200 all in"</li>
              <li>"Take the decorating out"</li>
            </ul>
            <div style={{ marginTop: 8 }}>I'll ask if anything's unclear, and you approve every change before it lands.</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
            <div style={{
              background: m.role === 'user' ? t.accent : t.surface,
              color: m.role === 'user' ? '#fff' : t.text,
              borderRadius: 12, padding: '10px 12px', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {m.text}
            </div>

            {/* Proposal card */}
            {m.proposal && (
              <div style={{ marginTop: 8, border: '1.5px solid ' + t.accent, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', background: t.surface }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: t.text, marginBottom: 6 }}>Proposed changes</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', color: t.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
                    {m.proposal.changes.map((c, ci) => (
                      <li key={ci} style={{ color: c.kind === 'remove' ? t.danger : (c.kind === 'add' ? t.success : t.textSecondary) }}>
                        {c.label}
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 10, fontSize: 14, color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(m.proposal.before_total, currency)} → {fmtMoney(m.proposal.after_total, currency)}
                    <span style={{
                      marginLeft: 8, fontSize: 12.5, fontWeight: 700,
                      color: m.proposal.after_total >= m.proposal.before_total ? t.warning : t.success,
                    }}>
                      ({m.proposal.after_total >= m.proposal.before_total ? '+' : '−'}{fmtMoney(Math.abs(m.proposal.after_total - m.proposal.before_total), currency)})
                    </span>
                  </div>
                </div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid ' + t.border, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {m.applied ? (
                    <div style={{ color: t.success, fontSize: 13.5, fontWeight: 700 }}>
                      ✓ Applied and saved — download the new PDF or resend when you're ready.
                    </div>
                  ) : (
                    <button onClick={() => applyProposal(i)} style={{
                      background: t.accent, color: '#fff', border: 'none', borderRadius: 8,
                      padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
                    }}>
                      Apply changes
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Memories saved */}
            {m.memories && m.memories.map(mem => (
              <div key={mem.id} style={{
                marginTop: 6, display: 'inline-block', fontSize: 12, color: t.textSecondary,
                background: t.surface, border: '1px dashed ' + t.border, borderRadius: 999, padding: '4px 10px',
              }}>
                🧠 Remembered: {mem.content} <a href="/ai-memory" style={{ color: t.accent }}>manage</a>
              </div>
            ))}
          </div>
        ))}
        {sending && (
          <div style={{ alignSelf: 'flex-start', color: t.textMuted, fontSize: 13, padding: '6px 2px' }}>
            Reading the quote{files.length ? ' and your file' : ''}…
          </div>
        )}
        {error && (
          <div style={{ background: t.dangerBg, color: t.danger, borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>{error}</div>
        )}
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid ' + t.border, padding: 10 }}>
        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {files.map((f, fi) => (
              <span key={fi} style={{ fontSize: 12, background: t.surface, border: '1px solid ' + t.border, borderRadius: 999, padding: '3px 10px', color: t.textSecondary }}>
                📎 {f.name}
                <button onClick={() => setFiles(prev => prev.filter((_, x) => x !== fi))}
                  style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', marginLeft: 4 }}>×</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button onClick={() => fileRef.current?.click()} disabled={sending} title="Attach a supplier quote (PDF, photo, Excel or Word)"
            style={{ minHeight: 44, width: 44, borderRadius: 10, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>
            📎
          </button>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} onChange={onPickFiles} style={{ display: 'none' }} />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="What's changed on this job?"
            rows={2}
            disabled={sending}
            style={{
              flex: 1, background: t.bg, border: '1px solid ' + t.border, color: t.text,
              borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none',
              resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          <button onClick={send} disabled={sending || (!input.trim() && files.length === 0)} style={{
            minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none',
            background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: sending ? 'wait' : 'pointer', opacity: sending || (!input.trim() && files.length === 0) ? 0.6 : 1, flexShrink: 0,
          }}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

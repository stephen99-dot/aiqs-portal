import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

function getUserStorageKey() {
  try {
    const token = localStorage.getItem('aiqs_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return 'aiqs_chat_' + (payload.id || payload.sub || 'default');
    }
  } catch {}
  return 'aiqs_chat_default';
}

const THINKING_STAGES = [
  { icon: '📄', text: 'Reading your input...' },
  { icon: '🔍', text: 'Analysing project scope...' },
  { icon: '📐', text: 'Measuring quantities...' },
  { icon: '💰', text: 'Calculating costs...' },
  { icon: '📋', text: 'Preparing response...' },
];

export default function ChatPage() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [expandedThinking, setExpandedThinking] = useState({});

  // Session management
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const thinkingInterval = useRef(null);
  const saveTimeout = useRef(null);

  // ── Load sessions on mount ──────────────────────────────────────
  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const data = await apiFetch('/chat-sessions');
      setSessions(data.sessions || []);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadSession(sessionId) {
    try {
      const data = await apiFetch(`/chat-sessions/${sessionId}`);
      setMessages(data.messages || []);
      setCurrentSessionId(sessionId);
      setExpandedThinking({});
      setShowHistory(false);
    } catch (e) {
      console.error('Failed to load session:', e);
    }
  }

  async function deleteSession(sessionId, e) {
    e.stopPropagation();
    try {
      await apiFetch(`/chat-sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  }

  // Auto-save after each message update (debounced)
  const saveSession = useCallback(async (msgs, sessionId) => {
    if (msgs.length === 0) return;
    try {
      const saveable = msgs.map(m => ({
        role: m.role,
        content: m.content,
        thinking: m.thinking || null,
        downloadFiles: m.downloadFiles || null,
        timestamp: m.timestamp,
        error: m.error || false,
      }));
      const data = await apiFetch('/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId || undefined, messages: saveable }),
      });
      if (!sessionId && data.id) {
        setCurrentSessionId(data.id);
        loadSessions();
        return data.id;
      }
      return sessionId;
    } catch (e) {
      console.error('Failed to save session:', e);
    }
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      saveSession(messages, currentSessionId);
    }, 1500);
    return () => clearTimeout(saveTimeout.current);
  }, [messages, currentSessionId, saveSession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingStage]);

  useEffect(() => {
    if (sending) {
      setThinkingStage(0);
      thinkingInterval.current = setInterval(() => {
        setThinkingStage(prev => prev < THINKING_STAGES.length - 1 ? prev + 1 : prev);
      }, 2200);
    } else {
      if (thinkingInterval.current) clearInterval(thinkingInterval.current);
      setThinkingStage(0);
    }
    return () => { if (thinkingInterval.current) clearInterval(thinkingInterval.current); };
  }, [sending]);

  // Block nav while sending
  useEffect(() => {
    window.__aiqs_chat_sending = sending;
    return () => { window.__aiqs_chat_sending = false; };
  }, [sending]);

  // ── Theme colors ────────────────────────────────────────────────
  const colors = isDark ? {
    pageBg: '#06080F',
    containerBg: '#0D1117',
    containerBorder: '#1E293B',
    sidebarBg: '#090D16',
    sidebarBorder: '#1E293B',
    sessionHover: '#111827',
    sessionActive: '#1A2332',
    welcomeBg: '#111827',
    welcomeBorder: '#1E293B',
    userBubble: '#1E3A5F',
    assistantBubble: '#1A1F2E',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    inputBg: '#111827',
    inputBorder: '#1E293B',
    inputText: '#F1F5F9',
    inputPlaceholder: '#64748B',
    accent: '#2563EB',
    suggestionBg: '#111827',
    suggestionBorder: '#1E293B',
    suggestionHover: '#1A2332',
    fileBadgeBg: '#1E293B',
    fileBarBg: '#111827',
    chipBg: '#1E293B',
    chipBorder: '#334155',
    errorText: '#F87171',
    avatarBg: '#1E293B',
    scrollThumb: '#334155',
    thinkingBg: '#111827',
    thinkingBorder: '#1E293B',
    thinkingText: '#94A3B8',
    thinkingAccent: '#F59E0B',
    thinkingHeaderBg: '#0D1117',
    stageActiveBg: 'rgba(37,99,235,0.1)',
    stageActiveText: '#60A5FA',
    stageDoneText: '#10B981',
    stageWaitText: '#3B4D66',
    deleteBtn: '#334155',
  } : {
    pageBg: '#F4F6FA',
    containerBg: '#FFFFFF',
    containerBorder: '#E2E8F0',
    sidebarBg: '#F8FAFC',
    sidebarBorder: '#E2E8F0',
    sessionHover: '#F1F5F9',
    sessionActive: '#EFF6FF',
    welcomeBg: '#F8FAFC',
    welcomeBorder: '#E2E8F0',
    userBubble: '#2563EB',
    assistantBubble: '#F1F5F9',
    textPrimary: '#1E293B',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    inputBg: '#FFFFFF',
    inputBorder: '#CBD5E1',
    inputText: '#1E293B',
    inputPlaceholder: '#94A3B8',
    accent: '#2563EB',
    suggestionBg: '#FFFFFF',
    suggestionBorder: '#E2E8F0',
    suggestionHover: '#F1F5F9',
    fileBadgeBg: '#E2E8F0',
    fileBarBg: '#F8FAFC',
    chipBg: '#F1F5F9',
    chipBorder: '#CBD5E1',
    errorText: '#DC2626',
    avatarBg: '#E2E8F0',
    scrollThumb: '#CBD5E1',
    thinkingBg: '#F8FAFC',
    thinkingBorder: '#E2E8F0',
    thinkingText: '#64748B',
    thinkingAccent: '#D97706',
    thinkingHeaderBg: '#F1F5F9',
    stageActiveBg: 'rgba(37,99,235,0.06)',
    stageActiveText: '#2563EB',
    stageDoneText: '#059669',
    stageWaitText: '#CBD5E1',
    deleteBtn: '#E2E8F0',
  };

  // ── Helpers ─────────────────────────────────────────────────────
  function addFiles(fileList) {
    setFiles(prev => [...prev, ...Array.from(fileList)].slice(0, 5));
  }
  function removeFile(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)); }
  function fileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return { pdf: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', dwg: '📐', dxf: '📐', zip: '📦' }[ext] || '📎';
  }
  function formatSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function startNewChat() {
    setMessages([]);
    setCurrentSessionId(null);
    setExpandedThinking({});
    setShowHistory(false);
  }

  function toggleThinking(idx) {
    setExpandedThinking(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  // ── Send message ────────────────────────────────────────────────
  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;

    const userMessage = {
      role: 'user',
      content: input,
      files: files.map(f => ({ name: f.name, size: f.size })),
      timestamp: new Date().toISOString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    const currentInput = input;
    const currentFiles = [...files];
    setInput('');
    setFiles([]);
    setSending(true);

    try {
      const history = messages
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }));

      const formData = new FormData();
      formData.append('message', currentInput);
      formData.append('history', JSON.stringify(history));
      currentFiles.forEach(f => formData.append('files', f));

      const data = await apiFetch('/chat', { method: 'POST', body: formData });

      const assistantMsg = {
        role: 'assistant',
        content: data.reply,
        thinking: data.thinking || null,
        downloadFiles: data.files || null,
        paymentRequired: data.payment_required || null,
        quota: data.quota || null,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Refresh session list after BOQ generation
      if (data.files && data.files.length > 0) {
        setTimeout(loadSessions, 2000);
      }
    } catch (err) {
      const isQuota = err.message && (err.message.includes('limit') || err.message.includes('Upgrade'));
      const isSuspended = err.message && err.message.includes('suspended');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: isSuspended
          ? 'Your account has been suspended. Please contact support.'
          : isQuota ? err.message : 'Sorry, something went wrong. Please try again.',
        timestamp: new Date().toISOString(),
        error: !isQuota,
        paymentRequired: isQuota ? {
          type: 'upgrade', message: err.message, price: 99, currency: 'GBP',
          url: 'https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01',
        } : null,
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
  }
  function handleDrop(e) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  // ── Sub-components ───────────────────────────────────────────────
  function ThinkingIndicator() {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: 12, background: colors.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>📐</div>
        <div style={{ maxWidth: '70%', borderRadius: '4px 16px 16px 16px', background: colors.assistantBubble, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: colors.thinkingAccent, display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colors.thinkingAccent, animation: 'thinkPulse 1.5s ease-in-out infinite' }} />
    AI is thinking...
  </div>
  <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 500 }}>
    {files.length > 0 ? 'Est. 2–3 min with drawings' : 'Est. 30–60 sec'}
  </span>
</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {THINKING_STAGES.map((stage, i) => {
              const isDone = i < thinkingStage;
              const isActive = i === thinkingStage;
              const isWaiting = i > thinkingStage;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: isActive ? colors.stageActiveBg : 'transparent', opacity: isWaiting ? 0.35 : 1, transition: 'all 0.4s ease' }}>
                  <span style={{ fontSize: 14, flexShrink: 0, filter: isWaiting ? 'grayscale(1)' : 'none' }}>{isDone ? '✅' : stage.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isDone ? colors.stageDoneText : isActive ? colors.stageActiveText : colors.stageWaitText, transition: 'color 0.3s ease' }}>{stage.text}</span>
                  {isActive && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                      {[0, 1, 2].map(d => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: colors.stageActiveText, animation: 'typingPulse 1.4s infinite', animationDelay: `${d * 0.2}s` }} />)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function ThinkingBlock({ thinking, index }) {
    if (!thinking) return null;
    const isExpanded = expandedThinking[index];
    return (
      <div style={{ marginBottom: 8, borderRadius: 10, border: `1px solid ${colors.thinkingBorder}`, overflow: 'hidden' }}>
        <button onClick={() => toggleThinking(index)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: colors.thinkingHeaderBg, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: colors.thinkingAccent }}>
          <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block', fontSize: 10 }}>▶</span>
          <span>🧠</span>
          <span>View AI reasoning</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: colors.textMuted }}>{isExpanded ? 'Click to collapse' : 'Click to expand'}</span>
        </button>
        {isExpanded && (
          <div style={{ padding: '12px 16px', background: colors.thinkingBg, borderTop: `1px solid ${colors.thinkingBorder}`, maxHeight: 300, overflowY: 'auto' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.7, color: colors.thinkingText, fontFamily: "'JetBrains Mono', monospace" }}>{thinking}</pre>
          </div>
        )}
      </div>
    );
  }

  // ── History sidebar ──────────────────────────────────────────────
  function HistorySidebar() {
    return (
      <div style={{
        width: 260, flexShrink: 0,
        background: colors.sidebarBg,
        borderRight: `1px solid ${colors.sidebarBorder}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${colors.sidebarBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chat History</span>
          <button onClick={startNewChat} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 7,
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
            color: '#F59E0B', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            + New
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {loadingSessions ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: colors.textMuted, fontSize: 12 }}>Loading...</div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: colors.textMuted, fontSize: 12 }}>No previous chats yet</div>
          ) : sessions.map(session => (
            <div
              key={session.id}
              onClick={() => loadSession(session.id)}
              style={{
                padding: '9px 10px', borderRadius: 8, marginBottom: 2, cursor: 'pointer',
                background: currentSessionId === session.id ? colors.sessionActive : 'transparent',
                border: currentSessionId === session.id ? `1px solid ${colors.accent}22` : '1px solid transparent',
                transition: 'all 0.12s',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6,
              }}
              onMouseEnter={e => { if (currentSessionId !== session.id) e.currentTarget.style.background = colors.sessionHover; }}
              onMouseLeave={e => { if (currentSessionId !== session.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: colors.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
                  {session.title || 'Untitled chat'}
                </div>
                <div style={{ fontSize: 10.5, color: colors.textMuted }}>{formatDate(session.updated_at)}</div>
              </div>
              <button
                onClick={(e) => deleteSession(session.id, e)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: '2px 4px', borderRadius: 4, fontSize: 13, flexShrink: 0, opacity: 0.5 }}
                title="Delete this chat"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: colors.pageBg }}>
      <style>{`
        @keyframes typingPulse { 0%,80%,100%{opacity:0.3;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
        @keyframes thinkPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .aiqs-messages-area::-webkit-scrollbar{width:6px}
        .aiqs-messages-area::-webkit-scrollbar-track{background:transparent}
        .aiqs-messages-area::-webkit-scrollbar-thumb{background:${colors.scrollThumb};border-radius:3px}
        .aiqs-chat-textarea::placeholder{color:${colors.inputPlaceholder}}
        .session-item:hover .session-delete{opacity:1!important}
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>AI Quantity Surveyor</h1>
          <p style={{ fontSize: 14, color: colors.textSecondary, margin: '4px 0 0 0' }}>Upload drawings and chat about your project — get instant estimates and QS advice</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowHistory(h => !h)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              background: showHistory ? 'rgba(37,99,235,0.08)' : 'transparent',
              border: `1px solid ${showHistory ? colors.accent + '44' : colors.containerBorder}`,
              color: showHistory ? colors.accent : colors.textMuted,
              fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            History
          </button>
          {messages.length > 0 && (
            <button
              onClick={startNewChat}
              style={{ padding: '7px 14px', borderRadius: 8, background: 'transparent', border: `1px solid ${colors.containerBorder}`, color: colors.textMuted, fontSize: 12.5, cursor: 'pointer' }}
            >
              New chat
            </button>
          )}
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 0, borderRadius: 16, overflow: 'hidden', border: `1px solid ${colors.containerBorder}`, background: colors.containerBg }}>

        {/* Sidebar */}
        {showHistory && <HistorySidebar />}

        {/* Chat panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>

          {/* Messages */}
          <div className="aiqs-messages-area" style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center', flex: 1 }}>
                <div style={{ fontSize: 48, marginBottom: 16, background: colors.welcomeBg, border: `1px solid ${colors.welcomeBorder}`, borderRadius: 20, width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📐</div>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: colors.textPrimary, margin: '0 0 8px 0' }}>Ready to analyse your project</h3>
                <p style={{ fontSize: 14, color: colors.textSecondary, margin: '0 0 24px 0', maxWidth: 480 }}>Upload your drawings (PDF, images, or ZIP) and ask me anything — rough costs, spec advice, quantities, building regs, risks to watch for.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {[
                    ['💰', 'Rough cost estimate', 'Can you give me a rough cost estimate for this project?'],
                    ['📊', 'Extract quantities', 'What quantities can you extract from these drawings?'],
                    ['⚠️', 'Identify risks', 'What are the key risks or issues you can see?'],
                    ['📋', 'Building regs', 'What building regulations should I consider?'],
                  ].map(([icon, label, text], i) => (
                    <button key={i} onClick={() => setInput(text)} style={{ background: colors.suggestionBg, border: `1px solid ${colors.suggestionBorder}`, borderRadius: 12, padding: '10px 16px', fontSize: 13, color: colors.textPrimary, cursor: 'pointer' }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <React.Fragment key={i}>
                {msg.role === 'assistant' && msg.thinking && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: -8 }}>
                    <div style={{ width: 36, flexShrink: 0 }} />
                    <div style={{ maxWidth: '70%' }}>
                      <ThinkingBlock thinking={msg.thinking} index={i} />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, background: colors.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {msg.role === 'user' ? '👤' : '📐'}
                  </div>
                  <div style={{
                    maxWidth: '70%', padding: '12px 16px',
                    borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                    background: msg.role === 'user' ? colors.userBubble : colors.assistantBubble,
                    color: msg.role === 'user' ? '#F1F5F9' : msg.error ? colors.errorText : colors.textPrimary,
                    fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word',
                  }}>
                    {msg.role === 'user' && msg.files?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {msg.files.map((f, j) => (
                          <span key={j} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {fileIcon(f.name)} {f.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div>
                      {(msg.content || '').split('\n').map((line, j, arr) => (
                        <React.Fragment key={j}>{line}{j < arr.length - 1 && <br />}</React.Fragment>
                      ))}
                    </div>

                    {/* Download buttons */}
                    {msg.downloadFiles && msg.downloadFiles.length > 0 && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary, opacity: 0.7 }}>Your documents are ready:</div>
                        {msg.downloadFiles.map((f, fi) => (
                          <button key={fi} onClick={async () => {
                            try {
                              const token = localStorage.getItem('aiqs_token');
                              const resp = await fetch(f.url, { headers: { 'Authorization': 'Bearer ' + token } });
                              if (!resp.ok) throw new Error('Download failed');
                              const blob = await resp.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = f.name;
                              document.body.appendChild(a); a.click();
                              document.body.removeChild(a);
                              window.URL.revokeObjectURL(url);
                            } catch { alert('Download failed. Please try again.'); }
                          }} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            padding: '10px 16px', borderRadius: 8,
                            background: f.type === 'xlsx' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)',
                            border: '1px solid ' + (f.type === 'xlsx' ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)'),
                            color: f.type === 'xlsx' ? '#10B981' : '#3B82F6',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          }}>
                            {f.type === 'xlsx' ? '📊' : '📄'} Download {f.name}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Payment required */}
                    {msg.paymentRequired && (
                      <div style={{ marginTop: 14, padding: 16, borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary, marginBottom: 4 }}>{msg.paymentRequired.message || 'Generate your BOQ documents'}</div>
                        <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 14 }}>Choose how to proceed:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <a href="https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 8, background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#0A0F1C', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                            Pay £99 — Generate this BOQ
                          </a>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <a href="https://buy.stripe.com/5kQdR97Nm4Ni9IQ4XW73G02" target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', color: colors.textPrimary, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                              ⭐ Professional — £347/mo <span style={{ fontSize: 11, opacity: 0.65 }}>10 BOQs</span>
                            </a>
                            <a href="https://buy.stripe.com/aFa00j5FebbGaMUcqo73G03" target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', color: colors.textPrimary, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                              👑 Premium — £447/mo <span style={{ fontSize: 11, opacity: 0.65 }}>20 BOQs</span>
                            </a>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: colors.textSecondary, opacity: 0.6, marginTop: 10 }}>Once payment is confirmed, just say "generate documents" again.</div>
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            ))}

            {sending && <ThinkingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* File chips */}
          {files.length > 0 && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 16px', background: colors.fileBarBg, borderTop: `1px solid ${colors.containerBorder}`, overflowX: 'auto' }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: colors.chipBg, border: `1px solid ${colors.chipBorder}`, borderRadius: 10, padding: '6px 10px', fontSize: 12, color: colors.textPrimary, whiteSpace: 'nowrap' }}>
                  <span>{fileIcon(f.name)}</span>
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span style={{ color: colors.textMuted }}>{formatSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 16, padding: '0 0 0 4px', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <form onSubmit={handleSend} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${colors.containerBorder}`, background: colors.containerBg }}>
            <button type="button" onClick={() => fileInputRef.current.click()} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 8, borderRadius: 10, display: 'flex', alignItems: 'center', flexShrink: 0 }} title="Upload drawings">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input ref={fileInputRef} type="file" multiple onChange={e => { console.log('files selected:', e.target.files); if (e.target.files && e.target.files.length > 0) { addFiles(e.target.files); } }} style={{ display: 'none' }} accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.zip" />
            <textarea
              className="aiqs-chat-textarea"
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={files.length > 0 ? 'Ask about these drawings...' : 'Upload drawings or ask a QS question...'}
              rows={1} disabled={sending}
              style={{ flex: 1, background: colors.inputBg, border: `1px solid ${colors.inputBorder}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, color: colors.inputText, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120 }}
            />
            <button type="submit" disabled={sending || (!input.trim() && files.length === 0)} style={{ background: colors.accent, border: 'none', borderRadius: 10, padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: sending || (!input.trim() && files.length === 0) ? 0.4 : 1 }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

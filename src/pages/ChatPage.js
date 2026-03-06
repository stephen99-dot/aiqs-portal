import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

const STAGE_ICONS = {
  file: (col) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  search: (col) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  ruler: (col) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4"/>
      <line x1="7" y1="12" x2="7" y2="12"/><line x1="12" y1="12" x2="12" y2="8"/><line x1="17" y1="12" x2="17" y2="12"/>
    </svg>
  ),
  calculator: (col) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="16" y2="18"/>
    </svg>
  ),
  check: (col) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
  ),
};

const THINKING_STAGES = [
  { iconKey: 'file',       text: 'Reading your input...' },
  { iconKey: 'search',     text: 'Analysing project scope...' },
  { iconKey: 'ruler',      text: 'Measuring quantities...' },
  { iconKey: 'calculator', text: 'Calculating costs...' },
  { iconKey: 'check',      text: 'Preparing response...' },
];

// ── Mobile detection hook ──────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function ChatPage() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const isMobile = useIsMobile();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [expandedThinking, setExpandedThinking] = useState({});

  // On mobile: closed by default. On desktop: open by default.
  const [sidebarOpen, setSidebarOpen] = useState(!window.matchMedia('(max-width: 768px)').matches);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const thinkingInterval = useRef(null);
  const saveTimeout = useRef(null);
  const hadFilesRef = useRef(false);

  // Close sidebar when viewport becomes mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const data = await apiFetch('/chat-sessions');
      setSessions(data.sessions || []);
    } catch (e) { console.error('Failed to load sessions:', e); }
    finally { setLoadingSessions(false); }
  }

  async function loadSession(sessionId) {
    try {
      const data = await apiFetch(`/chat-sessions/${sessionId}`);
      setMessages(data.messages || []);
      setCurrentSessionId(sessionId);
      setExpandedThinking({});
      // Auto-close sidebar on mobile after picking a chat
      if (isMobile) setSidebarOpen(false);
    } catch (e) { console.error('Failed to load session:', e); }
  }

  async function deleteSession(sessionId, e) {
    e.stopPropagation();
    try {
      await apiFetch(`/chat-sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) { setMessages([]); setCurrentSessionId(null); }
    } catch (e) { console.error('Failed to delete session:', e); }
  }

  const saveSession = useCallback(async (msgs, sessionId) => {
    if (msgs.length === 0) return;
    try {
      const saveable = msgs.map(m => ({
        role: m.role, content: m.content,
        thinking: m.thinking || null, downloadFiles: m.downloadFiles || null,
        timestamp: m.timestamp, error: m.error || false,
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
    } catch (e) { console.error('Failed to save session:', e); }
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveSession(messages, currentSessionId), 1500);
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

  useEffect(() => {
    window.__aiqs_chat_sending = sending;
    return () => { window.__aiqs_chat_sending = false; };
  }, [sending]);

  const c = isDark ? {
    pageBg: '#06080F',
    sidebarBg: '#0A0D16',
    sidebarBorder: '#161E2E',
    sidebarHeaderBg: '#080B13',
    sessionHover: '#0F1520',
    sessionActive: '#132040',
    sessionActiveBorder: 'rgba(37,99,235,0.35)',
    sessionActiveText: '#E2EEFF',
    chatBg: '#0D1117',
    chatBorder: '#1A2235',
    userBubble: '#1B3557',
    assistantBubble: '#111827',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted: '#3D5068',
    inputBg: '#111827',
    inputBorder: '#1E293B',
    inputText: '#F1F5F9',
    inputPlaceholder: '#3D5068',
    accent: '#2563EB',
    suggestionBg: '#111827',
    suggestionBorder: '#1E293B',
    fileBarBg: '#0D1117',
    chipBg: '#1A2235',
    chipBorder: '#2A3A55',
    errorText: '#F87171',
    avatarBg: '#1A2235',
    scrollThumb: '#1E293B',
    thinkingBg: '#111827',
    thinkingBorder: '#1E293B',
    thinkingText: '#94A3B8',
    thinkingAccent: '#F59E0B',
    thinkingHeaderBg: '#0D1117',
    stageActiveBg: 'rgba(37,99,235,0.08)',
    stageActiveText: '#60A5FA',
    stageDoneText: '#34D399',
    stageWaitText: '#1E2D40',
    topBarBg: '#080B13',
    topBarBorder: '#161E2E',
    divider: '#161E2E',
    newChatColor: '#F59E0B',
    newChatBg: 'rgba(245,158,11,0.07)',
    newChatBorder: 'rgba(245,158,11,0.18)',
    groupLabelColor: '#2D3E55',
    collapseIconColor: '#2D3E55',
    collapseIconActive: '#3B82F6',
    overlayBg: 'rgba(0,0,0,0.65)',
  } : {
    pageBg: '#F0F4FA',
    sidebarBg: '#FFFFFF',
    sidebarBorder: '#E2E8F0',
    sidebarHeaderBg: '#F8FAFC',
    sessionHover: '#F1F5F9',
    sessionActive: '#EFF6FF',
    sessionActiveBorder: 'rgba(37,99,235,0.2)',
    sessionActiveText: '#1E3A5F',
    chatBg: '#FFFFFF',
    chatBorder: '#E2E8F0',
    userBubble: '#2563EB',
    assistantBubble: '#F1F5F9',
    textPrimary: '#1E293B',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    inputBg: '#F8FAFC',
    inputBorder: '#CBD5E1',
    inputText: '#1E293B',
    inputPlaceholder: '#94A3B8',
    accent: '#2563EB',
    suggestionBg: '#FFFFFF',
    suggestionBorder: '#E2E8F0',
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
    stageActiveBg: 'rgba(37,99,235,0.05)',
    stageActiveText: '#2563EB',
    stageDoneText: '#059669',
    stageWaitText: '#CBD5E1',
    topBarBg: '#FFFFFF',
    topBarBorder: '#E2E8F0',
    divider: '#E2E8F0',
    newChatColor: '#D97706',
    newChatBg: 'rgba(245,158,11,0.06)',
    newChatBorder: 'rgba(245,158,11,0.2)',
    groupLabelColor: '#CBD5E1',
    collapseIconColor: '#CBD5E1',
    collapseIconActive: '#2563EB',
    overlayBg: 'rgba(0,0,0,0.4)',
  };

  function addFiles(fl) { setFiles(prev => [...prev, ...Array.from(fl)].slice(0, 5)); }
  function removeFile(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)); }
  function fileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return { pdf: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', dwg: '📐', dxf: '📐', zip: '📦', xlsx: '📊', xls: '📊' }[ext] || '📎';
  }
  function formatSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function groupSessions(sessions) {
    const today = [], yesterday = [], week = [], older = [];
    const now = new Date();
    sessions.forEach(s => {
      const diff = Math.floor((now - new Date(s.updated_at)) / 86400000);
      if (diff === 0) today.push(s);
      else if (diff === 1) yesterday.push(s);
      else if (diff < 7) week.push(s);
      else older.push(s);
    });
    return [
      { label: 'Today', items: today },
      { label: 'Yesterday', items: yesterday },
      { label: 'Previous 7 days', items: week },
      { label: 'Older', items: older },
    ].filter(g => g.items.length > 0);
  }
  function startNewChat() {
    setMessages([]); setCurrentSessionId(null); setExpandedThinking({});
    if (isMobile) setSidebarOpen(false);
  }
  function toggleThinking(idx) { setExpandedThinking(prev => ({ ...prev, [idx]: !prev[idx] })); }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;
    const userMessage = {
      role: 'user', content: input,
      files: files.map(f => ({ name: f.name, size: f.size })),
      timestamp: new Date().toISOString(),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    const currentInput = input;
    const currentFiles = [...files];
    hadFilesRef.current = files.length > 0;
    setInput(''); setFiles([]); setSending(true);
    try {
      const history = messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
      const formData = new FormData();
      formData.append('message', currentInput);
      formData.append('history', JSON.stringify(history));
      currentFiles.forEach(f => formData.append('files', f));
      const data = await apiFetch('/chat', { method: 'POST', body: formData });
      setMessages(prev => [...prev, {
        role: 'assistant', content: data.reply,
        thinking: data.thinking || null, downloadFiles: data.files || null,
        paymentRequired: data.payment_required || null, quota: data.quota || null,
        timestamp: new Date().toISOString(),
      }]);
      if (data.files && data.files.length > 0) setTimeout(loadSessions, 2000);
    } catch (err) {
      const isQuota = err.message && (err.message.includes('limit') || err.message.includes('Upgrade'));
      const isSuspended = err.message && err.message.includes('suspended');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: isSuspended ? 'Your account has been suspended. Please contact support.'
          : isQuota ? err.message : 'Sorry, something went wrong. Please try again.',
        timestamp: new Date().toISOString(), error: !isQuota,
        paymentRequired: isQuota ? { type: 'upgrade', message: err.message, price: 99, currency: 'GBP', url: 'https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01' } : null,
      }]);
    } finally { setSending(false); }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
  }
  function handleDrop(e) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  function ThinkingIndicator() {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: c.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📐</div>
        <div style={{ maxWidth: '72%', borderRadius: '4px 16px 16px 16px', background: c.assistantBubble, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: c.thinkingAccent, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c.thinkingAccent, animation: 'thinkPulse 1.5s ease-in-out infinite' }} />
              AI is thinking...
            </div>
            <span style={{ fontSize: 11, color: c.textMuted, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {hadFilesRef.current ? 'Est. 2–3 min with drawings' : 'Est. 30–60 sec'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {THINKING_STAGES.map((stage, i) => {
              const isDone = i < thinkingStage;
              const isActive = i === thinkingStage;
              const isWaiting = i > thinkingStage;
              const iconColor = isDone ? c.stageDoneText : isActive ? c.stageActiveText : c.stageWaitText;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 7, background: isActive ? c.stageActiveBg : 'transparent', opacity: isWaiting ? 0.3 : 1, transition: 'all 0.4s ease' }}>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    {isDone
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.stageDoneText} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      : STAGE_ICONS[stage.iconKey](iconColor)
                    }
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: isActive ? 600 : 400, color: isDone ? c.stageDoneText : isActive ? c.stageActiveText : c.stageWaitText, transition: 'color 0.3s ease' }}>{stage.text}</span>
                  {isActive && <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>{[0,1,2].map(d => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: c.stageActiveText, animation: 'typingPulse 1.4s infinite', animationDelay: `${d * 0.2}s` }} />)}</span>}
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
      <div style={{ marginBottom: 8, borderRadius: 10, border: `1px solid ${c.thinkingBorder}`, overflow: 'hidden' }}>
        <button onClick={() => toggleThinking(index)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: c.thinkingHeaderBg, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: c.thinkingAccent }}>
          <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block', fontSize: 10 }}>▶</span>
          <span>🧠</span><span>View AI reasoning</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: c.textMuted }}>{isExpanded ? 'Collapse' : 'Expand'}</span>
        </button>
        {isExpanded && (
          <div style={{ padding: '12px 16px', background: c.thinkingBg, borderTop: `1px solid ${c.thinkingBorder}`, maxHeight: 300, overflowY: 'auto' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.7, color: c.thinkingText, fontFamily: "'JetBrains Mono', monospace" }}>{thinking}</pre>
          </div>
        )}
      </div>
    );
  }

  // ── Sidebar: on mobile = fixed overlay; on desktop = inline panel ──
  const sidebarStyle = isMobile ? {
    position: 'fixed',
    top: 0,
    left: 0,
    height: '100%',
    width: 280,
    zIndex: 200,
    transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.25s ease',
    background: c.sidebarBg,
    borderRight: `1px solid ${c.sidebarBorder}`,
    display: 'flex',
    flexDirection: 'column',
  } : {
    width: sidebarOpen ? 264 : 0,
    minWidth: sidebarOpen ? 264 : 0,
    transition: 'width 0.2s ease, min-width 0.2s ease',
    overflow: 'hidden',
    background: c.sidebarBg,
    borderRight: sidebarOpen ? `1px solid ${c.sidebarBorder}` : 'none',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  };

  return (
    <div style={{ height: 'calc(100vh - 48px)', display: 'flex', overflow: 'hidden', background: c.pageBg, position: 'relative' }}>
      <style>{`
        @keyframes typingPulse { 0%,80%,100%{opacity:0.3;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
        @keyframes thinkPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .aiqs-msgs::-webkit-scrollbar{width:5px}
        .aiqs-msgs::-webkit-scrollbar-track{background:transparent}
        .aiqs-msgs::-webkit-scrollbar-thumb{background:${c.scrollThumb};border-radius:3px}
        .aiqs-sidebar::-webkit-scrollbar{width:4px}
        .aiqs-sidebar::-webkit-scrollbar-track{background:transparent}
        .aiqs-sidebar::-webkit-scrollbar-thumb{background:${c.scrollThumb};border-radius:2px}
        .aiqs-textarea::placeholder{color:${c.inputPlaceholder}}
        .session-row:hover .del-btn{opacity:0.5!important}
        .del-btn:hover{opacity:1!important;color:${c.errorText}!important}
        .suggestion-chip:hover{border-color:${c.accent}44!important;background:${c.sessionHover}!important}
        .new-chat-btn:hover{opacity:0.85}
        .collapse-toggle:hover{opacity:1!important}
      `}</style>

      {/* ── Mobile overlay backdrop — tapping it closes the sidebar ── */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 199,
            background: c.overlayBg,
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <div style={sidebarStyle}>
        <div style={{ padding: '0 12px', height: 52, background: c.sidebarHeaderBg, borderBottom: `1px solid ${c.sidebarBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: c.textPrimary, whiteSpace: 'nowrap' }}>Chat History</span>
            {sessions.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: c.textMuted, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>{sessions.length}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="new-chat-btn" onClick={startNewChat} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, background: c.newChatBg, border: `1px solid ${c.newChatBorder}`, color: c.newChatColor, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'opacity 0.15s' }}>
              + New
            </button>
            {/* Close button — mobile only */}
            {isMobile && (
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textMuted, fontSize: 22, lineHeight: 1, padding: '0 4px' }}>×</button>
            )}
          </div>
        </div>

        <div className="aiqs-sidebar" style={{ flex: 1, overflowY: 'auto', padding: '6px 6px 12px' }}>
          {loadingSessions ? (
            <div style={{ padding: '28px 12px', textAlign: 'center', color: c.textMuted, fontSize: 12 }}>Loading...</div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.4 }}>💬</div>
              <div style={{ fontSize: 12, color: c.textMuted, lineHeight: 1.6 }}>No chats yet. Start a conversation below.</div>
            </div>
          ) : (
            groupSessions(sessions).map(group => (
              <div key={group.label} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: c.groupLabelColor, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 8px 4px' }}>{group.label}</div>
                {group.items.map(session => {
                  const isActive = currentSessionId === session.id;
                  return (
                    <div key={session.id} className="session-row" onClick={() => loadSession(session.id)}
                      style={{ padding: '7px 9px', borderRadius: 8, marginBottom: 1, cursor: 'pointer', background: isActive ? c.sessionActive : 'transparent', border: `1px solid ${isActive ? c.sessionActiveBorder : 'transparent'}`, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.12s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = c.sessionHover; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isActive ? c.accent : c.textMuted} strokeWidth="2" style={{ flexShrink: 0, opacity: isActive ? 1 : 0.5 }}>
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                      </svg>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: isActive ? 600 : 400, color: isActive ? c.sessionActiveText : c.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {session.title || 'Untitled chat'}
                      </span>
                      <button className="del-btn" onClick={e => deleteSession(session.id, e)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textMuted, fontSize: 16, padding: '0 2px', lineHeight: 1, flexShrink: 0, opacity: 0, transition: 'opacity 0.15s, color 0.15s' }}>×</button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ height: 52, flexShrink: 0, background: c.topBarBg, borderBottom: `1px solid ${c.topBarBorder}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10 }}>
          <button className="collapse-toggle" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: `1px solid ${c.topBarBorder}`, cursor: 'pointer', opacity: 0.7, transition: 'opacity 0.15s' }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke={sidebarOpen ? c.collapseIconActive : c.textMuted} strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <div style={{ width: 1, height: 18, background: c.topBarBorder, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: c.textPrimary }}>AI Quantity Surveyor</span>
            {!isMobile && <span style={{ fontSize: 12, color: c.textMuted, marginLeft: 10 }}>Upload drawings · get estimates · generate BOQs</span>}
          </div>
          <button onClick={startNewChat} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, flexShrink: 0, background: 'transparent', border: `1px solid ${c.topBarBorder}`, color: c.textMuted, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"/></svg>
            {!isMobile && 'New chat'}
          </button>
        </div>

        {/* Chat body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: c.chatBg }} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>

          {/* Messages */}
          <div className="aiqs-msgs" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 12px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center', padding: '0 16px' }}>
                <div style={{ width: 68, height: 68, borderRadius: 18, background: isDark ? '#0F1520' : '#F1F5F9', border: `1px solid ${c.topBarBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, marginBottom: 18 }}>📐</div>
                <h3 style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700, color: c.textPrimary, margin: '0 0 8px' }}>Ready to analyse your project</h3>
                <p style={{ fontSize: isMobile ? 13 : 14, color: c.textSecondary, margin: '0 0 24px', maxWidth: 460, lineHeight: 1.65 }}>
                  Upload your drawings (PDF, images, ZIP) or spreadsheets (Excel) and ask anything — rough costs, spec advice, quantities, building regs, risks.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 520 }}>
                  {[
                    ['💰', 'Rough cost estimate', 'Can you give me a rough cost estimate for this project?'],
                    ['📊', 'Extract quantities', 'What quantities can you extract from these drawings?'],
                    ['⚠️', 'Identify risks', 'What are the key risks or issues you can see?'],
                    ['📋', 'Building regs', 'What building regulations should I consider?'],
                  ].map(([icon, label, text], i) => (
                    <button key={i} className="suggestion-chip" onClick={() => setInput(text)}
                      style={{ background: isDark ? '#0F1520' : '#F8FAFC', border: `1px solid ${c.topBarBorder}`, borderRadius: 10, padding: '9px 15px', fontSize: 13, color: c.textPrimary, cursor: 'pointer', transition: 'all 0.15s' }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <React.Fragment key={i}>
                {msg.role === 'assistant' && msg.thinking && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: -8 }}>
                    <div style={{ width: 34, flexShrink: 0 }} />
                    <div style={{ maxWidth: isMobile ? '90%' : '72%' }}>
                      <ThinkingBlock thinking={msg.thinking} index={i} />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: msg.role === 'user' ? c.accent : c.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>
                    {msg.role === 'user' ? '👤' : '📐'}
                  </div>
                  <div style={{ maxWidth: isMobile ? '85%' : '72%', padding: '11px 15px', borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px', background: msg.role === 'user' ? c.userBubble : c.assistantBubble, color: msg.role === 'user' ? '#F1F5F9' : msg.error ? c.errorText : c.textPrimary, fontSize: isMobile ? 13 : 14, lineHeight: 1.65, wordBreak: 'break-word' }}>
                    {msg.role === 'user' && msg.files?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                        {msg.files.map((f, j) => (
                          <span key={j} style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '3px 9px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
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

                    {msg.downloadFiles && msg.downloadFiles.length > 0 && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Documents ready</div>
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
                          }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 8, cursor: 'pointer', background: f.type === 'xlsx' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)', border: '1px solid ' + (f.type === 'xlsx' ? 'rgba(16,185,129,0.25)' : 'rgba(59,130,246,0.25)'), color: f.type === 'xlsx' ? '#10B981' : '#3B82F6', fontSize: 13, fontWeight: 600 }}>
                            {f.type === 'xlsx' ? '📊' : '📄'} Download {f.name}
                          </button>
                        ))}
                      </div>
                    )}

                    {msg.paymentRequired && (
                      <div style={{ marginTop: 14, padding: 16, borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: c.textPrimary, marginBottom: 4 }}>{msg.paymentRequired.message || 'Generate your BOQ documents'}</div>
                        <div style={{ fontSize: 12, color: c.textSecondary, marginBottom: 14 }}>Choose how to proceed:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <a href="https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 8, background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#0A0F1C', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                            Pay £99 — Generate this BOQ
                          </a>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <a href="https://buy.stripe.com/5kQdR97Nm4Ni9IQ4XW73G02" target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', color: c.textPrimary, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                              ⭐ Professional — £347/mo <span style={{ fontSize: 11, opacity: 0.65 }}>10 BOQs</span>
                            </a>
                            <a href="https://buy.stripe.com/aFa00j5FebbGaMUcqo73G03" target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', color: c.textPrimary, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                              👑 Premium — £447/mo <span style={{ fontSize: 11, opacity: 0.65 }}>20 BOQs</span>
                            </a>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: c.textSecondary, opacity: 0.6, marginTop: 10 }}>Once payment is confirmed, just say "generate documents" again.</div>
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
            <div style={{ display: 'flex', gap: 8, padding: '8px 16px', background: c.fileBarBg, borderTop: `1px solid ${c.chatBorder}`, overflowX: 'auto', flexShrink: 0 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: c.chipBg, border: `1px solid ${c.chipBorder}`, borderRadius: 10, padding: '5px 10px', fontSize: 12, color: c.textPrimary, whiteSpace: 'nowrap' }}>
                  <span>{fileIcon(f.name)}</span>
                  <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span style={{ color: c.textMuted }}>{formatSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: c.textMuted, cursor: 'pointer', fontSize: 16, padding: '0 0 0 4px', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: isMobile ? '8px 10px 12px' : '10px 20px 14px', background: c.chatBg, borderTop: `1px solid ${c.chatBorder}`, flexShrink: 0 }}>
            <form onSubmit={handleSend} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: c.inputBg, border: `1px solid ${c.inputBorder}`, borderRadius: 14, padding: '7px 8px 7px 12px' }}>
              <button type="button" onClick={() => fileInputRef.current.click()}
                style={{ background: 'none', border: 'none', color: c.textMuted, cursor: 'pointer', padding: '6px 6px', borderRadius: 8, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                title="Upload files">
                <svg width="19" height="19" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                ref={fileInputRef} type="file" multiple
                onChange={e => { if (e.target.files?.length) addFiles(e.target.files); }}
                style={{ display: 'none' }}
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.zip,.xlsx,.xls"
              />
              <textarea
                className="aiqs-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={files.length > 0 ? 'Ask about these files...' : 'Upload drawings or ask a QS question...'}
                rows={1}
                disabled={sending}
                style={{ flex: 1, background: 'transparent', border: 'none', padding: '6px 4px', fontSize: 14, color: c.inputText, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.55, maxHeight: 140 }}
              />
              <button type="submit" disabled={sending || (!input.trim() && files.length === 0)}
                style={{ background: c.accent, border: 'none', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: sending || (!input.trim() && files.length === 0) ? 0.35 : 1, transition: 'opacity 0.15s' }}>
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2.2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </form>
            <div style={{ fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: 7 }}>
              Drag & drop files · PDF, PNG, JPG, ZIP, Excel supported
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../utils/api';

// Get user-specific storage key to prevent chat leaking between accounts
function getStorageKey() {
  try {
    const token = localStorage.getItem('aiqs_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return `aiqs_chat_${payload.id}`;
    }
  } catch {}
  return 'aiqs_chat_guest';
}

// -- Thinking stages shown while waiting --
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

  const storageKey = getStorageKey();
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [expandedThinking, setExpandedThinking] = useState({});
  const [rateStats, setRateStats] = useState(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const thinkingInterval = useRef(null);

  // Fetch rate library stats on mount
  useEffect(() => {
    apiFetch('/my-rates').then(data => {
      if (data.stats && data.stats.total > 0) setRateStats(data.stats);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingStage]);

  // Cycle through thinking stages while waiting
  useEffect(() => {
    if (sending) {
      setThinkingStage(0);
      thinkingInterval.current = setInterval(() => {
        setThinkingStage(prev => {
          if (prev < THINKING_STAGES.length - 1) return prev + 1;
          return prev; // Stay on last stage
        });
      }, 2200);
    } else {
      if (thinkingInterval.current) clearInterval(thinkingInterval.current);
      setThinkingStage(0);
    }
    return () => { if (thinkingInterval.current) clearInterval(thinkingInterval.current); };
  }, [sending]);

  // Block browser navigation (tab close, refresh) while sending
  // Also set global flag so Layout sidebar can warn before navigating
  useEffect(() => {
    if (!sending) {
      window.__aiqs_chat_sending = false;
      return;
    }
    window.__aiqs_chat_sending = true;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.__aiqs_chat_sending = false;
    };
  }, [sending]);

  // -- Theme colors --
  const colors = isDark ? {
    pageBg: '#06080F',
    containerBg: '#0D1117',
    containerBorder: '#1E293B',
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
    accentHover: '#3B82F6',
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
    stageActiveBg: 'rgba(37, 99, 235, 0.1)',
    stageActiveText: '#60A5FA',
    stageDoneText: '#10B981',
    stageWaitText: '#3B4D66',
  } : {
    pageBg: '#F4F6FA',
    containerBg: '#FFFFFF',
    containerBorder: '#E2E8F0',
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
    accentHover: '#1D4ED8',
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
    stageActiveBg: 'rgba(37, 99, 235, 0.06)',
    stageActiveText: '#2563EB',
    stageDoneText: '#059669',
    stageWaitText: '#CBD5E1',
  };

  const styles = {
    page: {
      padding: '24px',
      height: 'calc(100vh - 48px)',
      display: 'flex',
      flexDirection: 'column',
      background: colors.pageBg,
      transition: 'background 0.3s ease',
    },
    header: { marginBottom: '16px', flexShrink: 0 },
    title: { fontSize: '24px', fontWeight: 700, color: colors.textPrimary, margin: 0 },
    subtitle: { fontSize: '14px', color: colors.textSecondary, margin: '4px 0 0 0' },
    container: {
      flex: 1, display: 'flex', flexDirection: 'column',
      background: colors.containerBg, border: `1px solid ${colors.containerBorder}`,
      borderRadius: '16px', overflow: 'hidden', minHeight: 0,
      transition: 'background 0.3s ease, border-color 0.3s ease',
    },
    messagesArea: {
      flex: 1, overflowY: 'auto', padding: '20px',
      display: 'flex', flexDirection: 'column', gap: '16px',
    },
    welcome: {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 24px', textAlign: 'center', flex: 1,
    },
    welcomeIcon: {
      fontSize: '48px', marginBottom: '16px', background: colors.welcomeBg,
      border: `1px solid ${colors.welcomeBorder}`, borderRadius: '20px',
      width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    welcomeTitle: { fontSize: '20px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 8px 0' },
    welcomeText: { fontSize: '14px', color: colors.textSecondary, margin: '0 0 24px 0', maxWidth: '480px' },
    suggestions: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' },
    suggestionBtn: {
      background: colors.suggestionBg, border: `1px solid ${colors.suggestionBorder}`,
      borderRadius: '12px', padding: '10px 16px', fontSize: '13px',
      color: colors.textPrimary, cursor: 'pointer', transition: 'all 0.15s',
    },
    msgRow: (role) => ({
      display: 'flex', gap: '12px', alignItems: 'flex-start',
      flexDirection: role === 'user' ? 'row-reverse' : 'row',
    }),
    avatar: {
      width: '36px', height: '36px', borderRadius: '12px',
      background: colors.avatarBg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0,
    },
    msgBubble: (role, isError) => ({
      maxWidth: '70%', padding: '12px 16px',
      borderRadius: role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
      background: role === 'user' ? colors.userBubble : colors.assistantBubble,
      color: role === 'user' && isDark ? '#F1F5F9' : role === 'user' && !isDark ? '#FFFFFF' : isError ? colors.errorText : colors.textPrimary,
      fontSize: '14px', lineHeight: '1.6', wordBreak: 'break-word',
    }),
    msgFiles: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' },
    fileBadge: {
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.3)',
      borderRadius: '8px', padding: '4px 10px', fontSize: '12px',
      display: 'flex', alignItems: 'center', gap: '4px',
    },
    fileBar: {
      display: 'flex', gap: '8px', padding: '10px 16px',
      background: colors.fileBarBg, borderTop: `1px solid ${colors.containerBorder}`, overflowX: 'auto',
    },
    chip: {
      display: 'flex', alignItems: 'center', gap: '6px',
      background: colors.chipBg, border: `1px solid ${colors.chipBorder}`,
      borderRadius: '10px', padding: '6px 10px', fontSize: '12px',
      color: colors.textPrimary, whiteSpace: 'nowrap',
    },
    chipRemove: {
      background: 'none', border: 'none', color: colors.textMuted,
      cursor: 'pointer', fontSize: '16px', padding: '0 0 0 4px', lineHeight: 1,
    },
    inputBar: {
      display: 'flex', alignItems: 'flex-end', gap: '8px',
      padding: '12px 16px', borderTop: `1px solid ${colors.containerBorder}`,
      background: colors.containerBg,
    },
    attachBtn: {
      background: 'none', border: 'none', color: colors.textMuted,
      cursor: 'pointer', padding: '8px', borderRadius: '10px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    textarea: {
      flex: 1, background: colors.inputBg, border: `1px solid ${colors.inputBorder}`,
      borderRadius: '12px', padding: '10px 14px', fontSize: '14px',
      color: colors.inputText, resize: 'none', outline: 'none',
      fontFamily: 'inherit', lineHeight: '1.5', maxHeight: '120px',
    },
    sendBtn: {
      background: colors.accent, border: 'none', borderRadius: '10px',
      padding: '10px', cursor: 'pointer', display: 'flex',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      opacity: sending || (!input.trim() && files.length === 0) ? 0.4 : 1,
    },
    clearBtn: {
      background: 'none', border: `1px solid ${colors.containerBorder}`,
      borderRadius: '8px', padding: '6px 12px', fontSize: '12px',
      color: colors.textMuted, cursor: 'pointer', marginLeft: 'auto',
    },
  };

  // -- Helper functions --
  function addFiles(fileList) {
    const newFiles = Array.from(fileList).slice(0, 5);
    setFiles(prev => [...prev, ...newFiles].slice(0, 5));
  }
  function removeFile(i) { setFiles(prev => prev.filter((_, idx) => idx !== i)); }
  function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    return { pdf: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', dwg: '📐', dxf: '📐', zip: '📦' }[ext] || '📎';
  }
  function formatSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function clearChat() {
    setMessages([]);
    setExpandedThinking({});
    sessionStorage.removeItem(storageKey);
  }
  function toggleThinking(idx) {
    setExpandedThinking(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;

    const userMessage = {
      role: 'user',
      content: input,
      files: files.map(f => ({ name: f.name, size: f.size })),
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    const currentFiles = [...files];
    setInput('');
    setFiles([]);
    setSending(true);

    try {
      const history = messages
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content }));

      const formData = new FormData();
      formData.append('message', currentInput);
      formData.append('history', JSON.stringify(history));
      currentFiles.forEach(f => formData.append('files', f));

      const data = await apiFetch('/chat', {
        method: 'POST',
        body: formData,
      });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        thinking: data.thinking || null,
        files: data.files || null,
        timestamp: new Date().toISOString()
      }]);
      if (data.rateStats) setRateStats(data.rateStats);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date().toISOString(),
        error: true
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
  }
  function handleDragOver(e) { e.preventDefault(); }
  function handleDrop(e) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  // -- Thinking stages component --
  function ThinkingIndicator() {
    return (
      <div style={styles.msgRow('assistant')}>
        <div style={styles.avatar}>📐</div>
        <div style={{
          maxWidth: '70%', borderRadius: '4px 16px 16px 16px',
          background: colors.assistantBubble, padding: '16px 20px',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          <div style={{
            fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: colors.thinkingAccent,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{
              display: 'inline-block', width: '8px', height: '8px',
              borderRadius: '50%', background: colors.thinkingAccent,
              animation: 'thinkPulse 1.5s ease-in-out infinite',
            }} />
            AI is thinking...
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {THINKING_STAGES.map((stage, i) => {
              const isDone = i < thinkingStage;
              const isActive = i === thinkingStage;
              const isWaiting = i > thinkingStage;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '6px 10px', borderRadius: '8px',
                  background: isActive ? colors.stageActiveBg : 'transparent',
                  transition: 'all 0.4s ease',
                  opacity: isWaiting ? 0.35 : 1,
                }}>
                  <span style={{ fontSize: '14px', flexShrink: 0, filter: isWaiting ? 'grayscale(1)' : 'none' }}>
                    {isDone ? '✅' : stage.icon}
                  </span>
                  <span style={{
                    fontSize: '13px', fontWeight: isActive ? 600 : 400,
                    color: isDone ? colors.stageDoneText : isActive ? colors.stageActiveText : colors.stageWaitText,
                    transition: 'color 0.3s ease',
                  }}>
                    {stage.text}
                  </span>
                  {isActive && (
                    <span style={{
                      marginLeft: 'auto', display: 'flex', gap: '3px',
                    }}>
                      {[0, 1, 2].map(d => (
                        <span key={d} style={{
                          width: '4px', height: '4px', borderRadius: '50%',
                          background: colors.stageActiveText,
                          animation: 'typingPulse 1.4s infinite',
                          animationDelay: `${d * 0.2}s`,
                        }} />
                      ))}
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

  // -- Collapsible thinking block --
  function ThinkingBlock({ thinking, index }) {
    if (!thinking) return null;
    const isExpanded = expandedThinking[index];

    return (
      <div style={{
        marginBottom: '8px', borderRadius: '10px',
        border: `1px solid ${colors.thinkingBorder}`,
        overflow: 'hidden',
        transition: 'all 0.3s ease',
      }}>
        <button
          onClick={() => toggleThinking(index)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', background: colors.thinkingHeaderBg,
            border: 'none', cursor: 'pointer',
            fontSize: '12px', fontWeight: 600, color: colors.thinkingAccent,
            transition: 'background 0.2s ease',
          }}
        >
          <span style={{
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease', display: 'inline-block',
            fontSize: '10px',
          }}>
            ▶
          </span>
          <span>🧠</span>
          <span>View AI reasoning</span>
          <span style={{
            marginLeft: 'auto', fontSize: '11px', fontWeight: 400,
            color: colors.textMuted,
          }}>
            {isExpanded ? 'Click to collapse' : 'Click to expand'}
          </span>
        </button>
        {isExpanded && (
          <div style={{
            padding: '12px 16px', background: colors.thinkingBg,
            borderTop: `1px solid ${colors.thinkingBorder}`,
            maxHeight: '300px', overflowY: 'auto',
          }}>
            <pre style={{
              margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontSize: '12px', lineHeight: '1.7', color: colors.thinkingText,
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            }}>
              {thinking}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes typingPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes thinkPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .aiqs-messages-area::-webkit-scrollbar { width: 6px; }
        .aiqs-messages-area::-webkit-scrollbar-track { background: transparent; }
        .aiqs-messages-area::-webkit-scrollbar-thumb { background: ${colors.scrollThumb}; border-radius: 3px; }
        .aiqs-chat-textarea::placeholder { color: ${colors.inputPlaceholder}; }
      `}</style>

      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1 style={styles.title}>AI Quantity Surveyor</h1>
              {rateStats && (
                <span style={{
                  background: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
                  color: isDark ? '#34D399' : '#059669',
                  border: `1px solid ${isDark ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)'}`,
                  borderRadius: '20px', padding: '4px 12px', fontSize: '11px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <span style={{ fontSize: '13px' }}>🧠</span>
                  {rateStats.total} trained rate{rateStats.total !== 1 ? 's' : ''}
                  {rateStats.avg_confidence >= 0.85 && ' • High accuracy'}
                </span>
              )}
            </div>
            <p style={styles.subtitle}>Upload drawings and chat about your project -- get instant estimates and QS advice</p>
          </div>
          {messages.length > 0 && (
            <button style={styles.clearBtn} onClick={clearChat}>Clear chat</button>
          )}
        </div>
      </div>

      <div style={styles.container} onDragOver={handleDragOver} onDrop={handleDrop}>
        <div className="aiqs-messages-area" style={styles.messagesArea}>
          {messages.length === 0 && (
            <div style={styles.welcome}>
              <div style={styles.welcomeIcon}>📐</div>
              <h3 style={styles.welcomeTitle}>Ready to analyse your project</h3>
              <p style={styles.welcomeText}>
                Upload your drawings (PDF, images, or ZIP) and ask me anything.
                {rateStats
                  ? ` I'm using your ${rateStats.total} trained rates for accurate pricing. Correct anything that's off and I'll learn for next time.`
                  : ' I\'ll use standard UK rates to start — correct anything that\'s off and I\'ll remember your rates for future projects.'
                }
              </p>
              <div style={styles.suggestions}>
                {[
                  ['💰', 'Rough cost estimate', 'Can you give me a rough cost estimate for this project?'],
                  ['📊', 'Extract quantities', 'What quantities can you extract from these drawings?'],
                  ['⚠️', 'Identify risks', 'What are the key risks or issues you can see?'],
                  ['📋', 'Building regs', 'What building regulations should I consider?'],
                ].map(([icon, label, text], i) => (
                  <button
                    key={i}
                    style={styles.suggestionBtn}
                    onMouseEnter={e => e.target.style.background = colors.suggestionHover}
                    onMouseLeave={e => e.target.style.background = colors.suggestionBg}
                    onClick={() => setInput(text)}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <React.Fragment key={i}>
              {/* Show thinking block above assistant messages */}
              {msg.role === 'assistant' && msg.thinking && (
                <div style={{ ...styles.msgRow('assistant'), marginBottom: '-8px' }}>
                  <div style={{ width: '36px', flexShrink: 0 }} />
                  <div style={{ maxWidth: '70%' }}>
                    <ThinkingBlock thinking={msg.thinking} index={i} />
                  </div>
                </div>
              )}
              <div style={styles.msgRow(msg.role)}>
                <div style={styles.avatar}>
                  {msg.role === 'user' ? '👤' : '📐'}
                </div>
                <div style={styles.msgBubble(msg.role, msg.error)}>
                  {msg.role === 'user' && msg.files?.length > 0 && (
                    <div style={styles.msgFiles}>
                      {msg.files.map((f, j) => (
                        <span key={j} style={styles.fileBadge}>
                          {fileIcon(f.name)} {f.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div>
                    {msg.content.split('\n').map((line, j) => (
                      <React.Fragment key={j}>
                        {line}
                        {j < msg.content.split('\n').length - 1 && <br />}
                      </React.Fragment>
                    ))}
                  </div>
                  {msg.role === 'assistant' && msg.files && msg.files.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}>
                      {msg.files.map((f, j) => (
                        <button
                          key={j}
                          onClick={async () => {
                            try {
                              const token = localStorage.getItem('aiqs_token');
                              const resp = await fetch(f.url, { headers: { 'Authorization': `Bearer ${token}` } });
                              if (!resp.ok) throw new Error('Download failed');
                              const blob = await resp.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = f.name;
                              document.body.appendChild(a); a.click();
                              window.URL.revokeObjectURL(url);
                              document.body.removeChild(a);
                            } catch (err) { alert('Download failed — please try again.'); }
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: isDark ? 'rgba(37,99,235,0.15)' : 'rgba(37,99,235,0.08)',
                            border: `1px solid ${isDark ? 'rgba(37,99,235,0.3)' : 'rgba(37,99,235,0.2)'}`,
                            borderRadius: '10px', padding: '8px 14px',
                            color: isDark ? '#60A5FA' : '#2563EB',
                            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontSize: '16px' }}>{f.type === 'xlsx' ? '📊' : '📄'}</span>
                          <span>Download {f.type === 'xlsx' ? 'Excel BOQ' : 'Findings Report'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          ))}

          {/* Show thinking stages while waiting */}
          {sending && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {files.length > 0 && (
          <div style={styles.fileBar}>
            {files.map((f, i) => (
              <div key={i} style={styles.chip}>
                <span>{fileIcon(f.name)}</span>
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                <span style={{ color: colors.textMuted }}>{formatSize(f.size)}</span>
                <button onClick={() => removeFile(i)} style={styles.chipRemove}>x</button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} style={styles.inputBar}>
          <button
            type="button" style={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            title="Upload drawings (PDF, images, ZIP)"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileInputRef} type="file" multiple
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }}
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.zip"
          />
          <textarea
            className="aiqs-chat-textarea"
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={files.length > 0 ? "Ask about these drawings..." : "Upload drawings or ask a QS question..."}
            rows={1} disabled={sending} style={styles.textarea}
          />
          <button
            type="submit" style={styles.sendBtn}
            disabled={sending || (!input.trim() && files.length === 0)}
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

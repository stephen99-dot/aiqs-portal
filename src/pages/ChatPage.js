import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

// ── Thinking stage icons ───────────────────────────────────────────────
const ICONS = {
  file: c => <svg width="13" height="13" fill="none" stroke={c} strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  search: c => <svg width="13" height="13" fill="none" stroke={c} strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  ruler: c => <svg width="13" height="13" fill="none" stroke={c} strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12h20M2 12l4-4M2 12l4 4"/></svg>,
  calc: c => <svg width="13" height="13" fill="none" stroke={c} strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/></svg>,
  check: c => <svg width="13" height="13" fill="none" stroke={c} strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  lock: c => <svg width="12" height="12" fill="none" stroke={c} strokeWidth="2.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  excel: () => <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="4" fill="#107C41"/><text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="system-ui">X</text></svg>,
  word: () => <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="4" fill="#185ABD"/><text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="system-ui">W</text></svg>,
};

const STAGES = [
  { key: 'file',   text: 'Reading files...' },
  { key: 'search', text: 'Analysing scope...' },
  { key: 'ruler',  text: 'Measuring quantities...' },
  { key: 'calc',   text: 'Calculating costs...' },
  { key: 'check',  text: 'Preparing response...' },
];

function useIsMobile() {
  const [v, set] = useState(() => window.innerWidth <= 768);
  useEffect(() => { const h = () => set(window.innerWidth <= 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return v;
}

export default function ChatPage() {
  const { mode } = useTheme();
  const dark = mode === 'dark';
  const mobile = useIsMobile();

  // ── Core state ─────────────────────────────────────────────────────
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [files, setFiles]             = useState([]);
  const [sending, setSending]         = useState(false);
  const [stage, setStage]             = useState(0);
  const [expanded, setExpanded]       = useState({});

  // ── Session / takeoff tracking ─────────────────────────────────────
  // These are the two critical IDs that must persist through the conversation
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentTakeoffId, setCurrentTakeoffId] = useState(null);

  // ── Sidebar ────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(!mobile);
  const [sessions, setSessions]       = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const bottomRef   = useRef(null);
  const fileRef     = useRef(null);
  const timerRef    = useRef(null);
  const saveRef     = useRef(null);
  const hadFiles    = useRef(false);

  useEffect(() => { if (mobile) setSidebarOpen(false); }, [mobile]);
  useEffect(() => { loadSessions(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, stage]);

  useEffect(() => {
    if (sending) {
      setStage(0);
      timerRef.current = setInterval(() => setStage(p => p < STAGES.length - 1 ? p + 1 : p), 2200);
    } else {
      clearInterval(timerRef.current);
      setStage(0);
    }
    return () => clearInterval(timerRef.current);
  }, [sending]);

  // Auto-save session whenever messages change
  useEffect(() => {
    if (messages.length === 0) return;
    clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => saveSession(messages, currentSessionId), 1500);
    return () => clearTimeout(saveRef.current);
  }, [messages, currentSessionId]);

  // ── Theme colours ──────────────────────────────────────────────────
  const c = dark ? {
    page: '#06080F', side: '#0A0D16', sideBorder: '#161E2E', sideHeader: '#080B13',
    sessHover: '#0F1520', sessActive: '#132040', sessActiveBorder: 'rgba(37,99,235,0.35)',
    sessActiveText: '#E2EEFF', chat: '#0D1117', chatBorder: '#1A2235',
    userBubble: '#1B3557', aiBubble: '#111827', text: '#F1F5F9', textSub: '#94A3B8',
    textMuted: '#3D5068', inputBg: '#111827', inputBorder: '#1E293B', accent: '#2563EB',
    chipBg: '#1A2235', chipBorder: '#2A3A55', error: '#F87171', avatarBg: '#1A2235',
    thinkBg: '#111827', thinkBorder: '#1E293B', thinkText: '#94A3B8', amber: '#F59E0B',
    stageActive: 'rgba(37,99,235,0.08)', stageActiveText: '#60A5FA',
    stageDone: '#34D399', stageWait: '#1E2D40',
    topBar: '#080B13', topBorder: '#161E2E', overlay: 'rgba(0,0,0,0.65)',
    newBg: 'rgba(245,158,11,0.07)', newBorder: 'rgba(245,158,11,0.18)', newText: '#F59E0B',
    lockedBg: 'rgba(16,185,129,0.06)', lockedBorder: 'rgba(16,185,129,0.2)', lockedText: '#34D399',
    warnBg: 'rgba(245,158,11,0.06)', warnBorder: 'rgba(245,158,11,0.2)', warnText: '#F59E0B',
    scroll: '#1E293B', groupLabel: '#2D3E55',
  } : {
    page: '#F0F4FA', side: '#FFFFFF', sideBorder: '#E2E8F0', sideHeader: '#F8FAFC',
    sessHover: '#F1F5F9', sessActive: '#EFF6FF', sessActiveBorder: 'rgba(37,99,235,0.2)',
    sessActiveText: '#1E3A5F', chat: '#FFFFFF', chatBorder: '#E2E8F0',
    userBubble: '#2563EB', aiBubble: '#F1F5F9', text: '#1E293B', textSub: '#475569',
    textMuted: '#94A3B8', inputBg: '#F8FAFC', inputBorder: '#CBD5E1', accent: '#2563EB',
    chipBg: '#F1F5F9', chipBorder: '#CBD5E1', error: '#DC2626', avatarBg: '#E2E8F0',
    thinkBg: '#F8FAFC', thinkBorder: '#E2E8F0', thinkText: '#64748B', amber: '#D97706',
    stageActive: 'rgba(37,99,235,0.05)', stageActiveText: '#2563EB',
    stageDone: '#059669', stageWait: '#CBD5E1',
    topBar: '#FFFFFF', topBorder: '#E2E8F0', overlay: 'rgba(0,0,0,0.4)',
    newBg: 'rgba(245,158,11,0.06)', newBorder: 'rgba(245,158,11,0.2)', newText: '#D97706',
    lockedBg: 'rgba(16,185,129,0.05)', lockedBorder: 'rgba(16,185,129,0.2)', lockedText: '#059669',
    warnBg: 'rgba(245,158,11,0.05)', warnBorder: 'rgba(245,158,11,0.2)', warnText: '#D97706',
    scroll: '#CBD5E1', groupLabel: '#CBD5E1',
  };

  // ── Session helpers ────────────────────────────────────────────────
  async function loadSessions() {
    setLoadingSessions(true);
    try { const d = await apiFetch('/chat-sessions'); setSessions(d.sessions || []); }
    catch (e) { console.error(e); }
    finally { setLoadingSessions(false); }
  }

  async function loadSession(id) {
    try {
      const d = await apiFetch(`/chat-sessions/${id}`);
      const msgs = d.messages || [];
      setMessages(msgs);
      setCurrentSessionId(id);
      setExpanded({});
      if (mobile) setSidebarOpen(false);
      // Recover takeoff_id from message history — critical for "generate" after page reload
      const lastWithTakeoff = [...msgs].reverse().find(m => m.takeoffId || m.takeoff_id);
      if (lastWithTakeoff) {
        const tid = lastWithTakeoff.takeoffId || lastWithTakeoff.takeoff_id;
        setCurrentTakeoffId(tid);
        console.log('[Session] Recovered takeoff_id:', tid);
      } else {
        setCurrentTakeoffId(null);
      }
    } catch (e) { console.error(e); }
  }

  async function deleteSession(id, e) {
    e.stopPropagation();
    try {
      await apiFetch(`/chat-sessions/${id}`, { method: 'DELETE' });
      setSessions(p => p.filter(s => s.id !== id));
      if (currentSessionId === id) newChat();
    } catch (e) { console.error(e); }
  }

  const saveSession = useCallback(async (msgs, sid) => {
    if (msgs.length === 0) return;
    try {
      const saveable = msgs.map(m => ({
        role: m.role, content: m.content,
        thinking: m.thinking || null, downloadFiles: m.downloadFiles || null,
        timestamp: m.timestamp, error: m.error || false,
        takeoffLocked: m.takeoffLocked || false,
      }));
      const d = await apiFetch('/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid || undefined, messages: saveable }),
      });
      if (!sid && d.id) { setCurrentSessionId(d.id); loadSessions(); return d.id; }
      return sid;
    } catch (e) { console.error(e); }
  }, []);

  function newChat() {
    setMessages([]); setCurrentSessionId(null); setCurrentTakeoffId(null);
    setExpanded({}); setFiles([]); setInput('');
    if (mobile) setSidebarOpen(false);
  }

  // ── File helpers ───────────────────────────────────────────────────
  const addFiles = fl => setFiles(p => [...p, ...Array.from(fl)].slice(0, 5));
  const removeFile = i => setFiles(p => p.filter((_, j) => j !== i));
  const fileIcon = n => ({ pdf:'📄', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', zip:'📦', xlsx:'📊', xls:'📊', dwg:'📐', dxf:'📐' })[n?.split('.').pop()?.toLowerCase()] || '📎';
  const fmtSize = b => b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';

  function groupSessions(list) {
    const now = new Date();
    const groups = { Today:[], Yesterday:[], 'Past 7 days':[], Older:[] };
    list.forEach(s => {
      const diff = Math.floor((now - new Date(s.updated_at)) / 86400000);
      if (diff === 0) groups.Today.push(s);
      else if (diff === 1) groups.Yesterday.push(s);
      else if (diff < 7) groups['Past 7 days'].push(s);
      else groups.Older.push(s);
    });
    return Object.entries(groups).filter(([,v]) => v.length > 0);
  }

  // ── SEND ───────────────────────────────────────────────────────────
  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;

    const userMsg = {
      role: 'user', content: input,
      files: files.map(f => ({ name: f.name, size: f.size })),
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    const savedInput = input;
    const savedFiles = [...files];
    hadFiles.current = files.length > 0;
    setInput(''); setFiles([]); setSending(true);

    try {
      const history = messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
      const fd = new FormData();
      fd.append('message', savedInput);
      fd.append('history', JSON.stringify(history));

      // ── CRITICAL: always send session_id and takeoff_id ──────────
      // This is what links "generate documents" back to the locked quantities
      if (currentSessionId) fd.append('session_id', currentSessionId);
      if (currentTakeoffId) fd.append('takeoff_id', currentTakeoffId);

      savedFiles.forEach(f => fd.append('files', f));

      const data = await apiFetch('/chat', { method: 'POST', body: fd });

      // ── Capture session_id and takeoff_id from response ──────────
      // Backend may create/confirm these — always update local state
      if (data.session_id && !currentSessionId) {
        setCurrentSessionId(data.session_id);
        console.log('[Chat] Session established:', data.session_id);
      }
      if (data.takeoff_id) {
        setCurrentTakeoffId(data.takeoff_id);
        console.log('[Chat] Takeoff locked:', data.takeoff_id);
      }

      const aiMsg = {
        role: 'assistant',
        content: data.reply,
        thinking: data.thinking || null,
        downloadFiles: data.files || null,
        paymentRequired: data.payment_required || null,
        quota: data.quota || null,
        takeoffLocked: !!data.takeoff_id,
        sessionId: data.session_id,
        takeoffId: data.takeoff_id,
        timestamp: new Date().toISOString(),
      };
      setMessages(p => [...p, aiMsg]);
      if (data.files?.length) setTimeout(loadSessions, 2000);

    } catch (err) {
      console.error('[Chat] Error:', err.status, err.message, err.data);
      const isQuota = err.status === 429 || err.status === 403 || err.data?.limit_type || err.data?.suspended
        || /limit|upgrade|credits|suspend|quota|no message/i.test(err.message || '');
      const isServerError = !isQuota && err.message && err.message !== 'Something went wrong' && !err.message.includes('Session expired');
      const limitType = err.data?.limit_type || 'messages';
      const userPlan = err.data?.plan || 'starter';
      let displayMessage;
      if (isQuota) {
        displayMessage = err.message || 'You have reached your usage limit.';
        if (!/upgrade|contact|plan/i.test(displayMessage)) {
          displayMessage += ' Upgrade your plan for more credits.';
        }
      } else if (isServerError) {
        displayMessage = err.message;
      } else {
        displayMessage = 'Something went wrong — please try again.';
      }
      setMessages(p => [...p, {
        role: 'assistant',
        content: displayMessage,
        timestamp: new Date().toISOString(),
        error: !isQuota,
        paymentRequired: isQuota ? {
          message: displayMessage,
          type: limitType,
          plan: userPlan,
        } : null,
      }]);
    } finally { setSending(false); }
  }

  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }
  function onDrop(e) { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }

  // ── Sub-components ─────────────────────────────────────────────────
  function Thinking() {
    return (
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
        <div style={{ width:34, height:34, borderRadius:10, background:c.avatarBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>📐</div>
        <div style={{ maxWidth:'72%', borderRadius:'4px 16px 16px 16px', background:c.aiBubble, padding:'14px 18px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:c.amber, display:'inline-block', animation:'pulse 1.5s infinite' }}/>
            <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:c.amber }}>
              {hadFiles.current ? 'Analysing drawings...' : 'Thinking...'}
            </span>
            <span style={{ fontSize:11, color:c.textMuted, marginLeft:'auto' }}>
              {hadFiles.current ? 'Est. 2–3 min' : 'Est. 30s'}
            </span>
          </div>
          {STAGES.map((s, i) => {
            const done = i < stage, active = i === stage, wait = i > stage;
            const col = done ? c.stageDone : active ? c.stageActiveText : c.stageWait;
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'5px 8px', borderRadius:7, background:active ? c.stageActive : 'transparent', opacity:wait ? 0.3 : 1, transition:'all 0.4s' }}>
                <span style={{ flexShrink:0 }}>
                  {done
                    ? <svg width="13" height="13" fill="none" stroke={c.stageDone} strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    : ICONS[s.key](col)}
                </span>
                <span style={{ fontSize:12.5, fontWeight:active?600:400, color:col, transition:'color 0.3s' }}>{s.text}</span>
                {active && <span style={{ marginLeft:'auto', display:'flex', gap:3 }}>{[0,1,2].map(d => <span key={d} style={{ width:4, height:4, borderRadius:'50%', background:c.stageActiveText, animation:'dot 1.4s infinite', animationDelay:`${d*0.2}s` }}/>)}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function ThinkingBlock({ thinking, idx }) {
    if (!thinking) return null;
    const open = expanded[idx];
    return (
      <div style={{ marginBottom:8, borderRadius:10, border:`1px solid ${c.thinkBorder}`, overflow:'hidden' }}>
        <button onClick={() => setExpanded(p => ({...p, [idx]: !p[idx]}))}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:dark?'#0D1117':'#F1F5F9', border:'none', cursor:'pointer', fontSize:12, fontWeight:600, color:c.amber }}>
          <span style={{ transform:open?'rotate(90deg)':'rotate(0)', transition:'transform 0.2s', fontSize:10 }}>▶</span>
          🧠 <span>View reasoning</span>
          <span style={{ marginLeft:'auto', fontSize:11, fontWeight:400, color:c.textMuted }}>{open?'Collapse':'Expand'}</span>
        </button>
        {open && (
          <div style={{ padding:'12px 16px', background:c.thinkBg, borderTop:`1px solid ${c.thinkBorder}`, maxHeight:280, overflowY:'auto' }}>
            <pre style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word', fontSize:12, lineHeight:1.7, color:c.thinkText, fontFamily:"'JetBrains Mono',monospace" }}>{thinking}</pre>
          </div>
        )}
      </div>
    );
  }

  function LockedBanner() {
    if (!currentTakeoffId) return null;
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px', background:c.lockedBg, border:`1px solid ${c.lockedBorder}`, borderRadius:8, fontSize:11.5, color:c.lockedText, fontWeight:600, whiteSpace:'nowrap' }}>
        {ICONS.lock(c.lockedText)} Quantities locked
      </div>
    );
  }

  function Message({ msg, idx }) {
    const isUser = msg.role === 'user';
    return (
      <>
        {!isUser && msg.thinking && (
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ width:34, flexShrink:0 }}/>
            <div style={{ maxWidth: mobile ? '90%' : '72%' }}><ThinkingBlock thinking={msg.thinking} idx={idx}/></div>
          </div>
        )}
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexDirection:isUser?'row-reverse':'row' }}>
          <div style={{ width:34, height:34, borderRadius:10, background:isUser?c.accent:c.avatarBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>
            {isUser ? '👤' : '📐'}
          </div>
          <div style={{ maxWidth: mobile ? '85%' : '72%', padding:'11px 15px', borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px', background: isUser ? c.userBubble : c.aiBubble, color: isUser ? '#F1F5F9' : msg.error ? c.error : c.text, fontSize: mobile ? 13 : 14, lineHeight:1.65, wordBreak:'break-word' }}>

            {/* User file chips */}
            {isUser && msg.files?.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:8 }}>
                {msg.files.map((f,i) => (
                  <span key={i} style={{ background:'rgba(255,255,255,0.12)', borderRadius:6, padding:'3px 9px', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
                    {fileIcon(f.name)} {f.name}
                  </span>
                ))}
              </div>
            )}

            {/* Message text */}
            <div>{(msg.content||'').split('\n').map((l,i,a) => <React.Fragment key={i}>{l}{i<a.length-1&&<br/>}</React.Fragment>)}</div>

            {/* Takeoff locked indicator */}
            {msg.takeoffLocked && (
              <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:c.lockedBg, border:`1px solid ${c.lockedBorder}`, borderRadius:8, fontSize:12, color:c.lockedText, fontWeight:600 }}>
                {ICONS.lock(c.lockedText)}
                Quantities locked — say "generate documents" to produce your Excel BOQ &amp; Word Report
              </div>
            )}

            {/* Download buttons */}
            {msg.downloadFiles?.length > 0 && (
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:11, fontWeight:600, color:c.textSub, textTransform:'uppercase', letterSpacing:'0.05em' }}>Documents ready</div>
                {msg.downloadFiles.map((f,i) => (
                  <button key={i} onClick={async () => {
                    try {
                      const token = localStorage.getItem('aiqs_token');
                      const r = await fetch(f.url, { headers: { 'Authorization': 'Bearer '+token } });
                      if (!r.ok) throw new Error();
                      const blob = await r.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href=url; a.download=f.name;
                      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    } catch { alert('Download failed — please try again.'); }
                  }} style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 14px', borderRadius:8, cursor:'pointer', background: f.type==='xlsx'?'rgba(16,185,129,0.1)':'rgba(59,130,246,0.1)', border:'1px solid '+(f.type==='xlsx'?'rgba(16,185,129,0.25)':'rgba(59,130,246,0.25)'), color: f.type==='xlsx'?'#10B981':'#3B82F6', fontSize:13, fontWeight:600 }}>
                    {f.type==='xlsx'?ICONS.excel():ICONS.word()} Download {f.name}
                  </button>
                ))}
              </div>
            )}

            {/* Payment required */}
            {msg.paymentRequired && (
              <div style={{ marginTop:14, padding:16, borderRadius:10, background:c.warnBg, border:`1px solid ${c.warnBorder}` }}>
                <div style={{ fontSize:13, fontWeight:600, color:c.text, marginBottom:4 }}>{msg.paymentRequired.message || 'Generate your BOQ documents'}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
                  <a href="https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01" target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'11px 18px', borderRadius:8, background:'linear-gradient(135deg,#F59E0B,#D97706)', color:'#0A0F1C', textDecoration:'none', fontSize:13, fontWeight:700 }}>
                    Pay £99 — Generate this BOQ
                  </a>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <a href="https://buy.stripe.com/dRmfZh9VucfK5sA0HG73G04" target="_blank" rel="noopener noreferrer"
                      style={{ flex:1, display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'9px 14px', borderRadius:8, background:'rgba(245,158,11,0.06)', border:`1px solid ${c.warnBorder}`, color:c.text, textDecoration:'none', fontSize:12, fontWeight:600 }}>
                      ⭐ Professional £347/mo
                    </a>
                    <a href="https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05" target="_blank" rel="noopener noreferrer"
                      style={{ flex:1, display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'9px 14px', borderRadius:8, background:'rgba(124,58,237,0.06)', border:'1px solid rgba(124,58,237,0.2)', color:c.text, textDecoration:'none', fontSize:12, fontWeight:600 }}>
                      👑 Premium £447/mo
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Sidebar style ──────────────────────────────────────────────────
  const sideStyle = mobile ? {
    position:'fixed', top:0, left:0, height:'100%', width:280, zIndex:200,
    transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition:'transform 0.25s ease', background:c.side, borderRight:`1px solid ${c.sideBorder}`,
    display:'flex', flexDirection:'column',
  } : {
    width: sidebarOpen ? 264 : 0, minWidth: sidebarOpen ? 264 : 0,
    transition:'width 0.2s ease, min-width 0.2s ease', overflow:'hidden',
    background:c.side, borderRight: sidebarOpen ? `1px solid ${c.sideBorder}` : 'none',
    display:'flex', flexDirection:'column', flexShrink:0,
  };

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ height:'calc(100vh - 48px)', display:'flex', overflow:'hidden', background:c.page, position:'relative' }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes dot{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}
        .msgs::-webkit-scrollbar{width:5px}.msgs::-webkit-scrollbar-track{background:transparent}.msgs::-webkit-scrollbar-thumb{background:${c.scroll};border-radius:3px}
        .sidebar::-webkit-scrollbar{width:4px}.sidebar::-webkit-scrollbar-track{background:transparent}.sidebar::-webkit-scrollbar-thumb{background:${c.scroll};border-radius:2px}
        .ta::placeholder{color:${c.textMuted}}
        .sr:hover .del{opacity:0.5!important}.del:hover{opacity:1!important;color:${c.error}!important}
        .chip:hover{border-color:${c.accent}44!important;background:${c.sessHover}!important}
        .nbtn:hover{opacity:0.85}.ctog:hover{opacity:1!important}
      `}</style>

      {/* Sidebar overlay on mobile */}
      {mobile && sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position:'fixed', inset:0, zIndex:199, background:c.overlay }}/>}

      {/* ── SIDEBAR ── */}
      <div style={sideStyle}>
        <div style={{ padding:'0 12px', height:52, background:c.sideHeader, borderBottom:`1px solid ${c.sideBorder}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:13, fontWeight:700, color:c.text }}>History</span>
            {sessions.length > 0 && <span style={{ fontSize:10, fontWeight:700, color:c.textMuted, background:dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)', borderRadius:20, padding:'1px 7px' }}>{sessions.length}</span>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <button className="nbtn" onClick={newChat} style={{ padding:'5px 12px', borderRadius:7, background:c.newBg, border:`1px solid ${c.newBorder}`, color:c.newText, fontSize:12, fontWeight:700, cursor:'pointer' }}>+ New</button>
            {mobile && <button onClick={() => setSidebarOpen(false)} style={{ background:'none', border:'none', cursor:'pointer', color:c.textMuted, fontSize:22, lineHeight:1, padding:'0 4px' }}>×</button>}
          </div>
        </div>
        <div className="sidebar" style={{ flex:1, overflowY:'auto', padding:'6px 6px 12px' }}>
          {loadingSessions ? (
            <div style={{ padding:'28px 12px', textAlign:'center', color:c.textMuted, fontSize:12 }}>Loading...</div>
          ) : sessions.length === 0 ? (
            <div style={{ padding:'40px 16px', textAlign:'center' }}>
              <div style={{ fontSize:28, opacity:0.4, marginBottom:8 }}>💬</div>
              <div style={{ fontSize:12, color:c.textMuted, lineHeight:1.6 }}>No chats yet</div>
            </div>
          ) : groupSessions(sessions).map(([label, items]) => (
            <div key={label}>
              <div style={{ fontSize:10, fontWeight:700, color:c.groupLabel, textTransform:'uppercase', letterSpacing:'0.08em', padding:'10px 8px 4px' }}>{label}</div>
              {items.map(s => {
                const active = currentSessionId === s.id;
                return (
                  <div key={s.id} className="sr" onClick={() => loadSession(s.id)}
                    style={{ padding:'7px 9px', borderRadius:8, marginBottom:1, cursor:'pointer', background:active?c.sessActive:'transparent', border:`1px solid ${active?c.sessActiveBorder:'transparent'}`, display:'flex', alignItems:'center', gap:8, transition:'all 0.12s' }}
                    onMouseEnter={e => { if(!active) e.currentTarget.style.background=c.sessHover; }}
                    onMouseLeave={e => { if(!active) e.currentTarget.style.background='transparent'; }}>
                    <svg width="13" height="13" fill="none" stroke={active?c.accent:c.textMuted} strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink:0, opacity:active?1:0.5 }}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                    <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:active?600:400, color:active?c.sessActiveText:c.textSub, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{s.title||'Untitled'}</span>
                    <button className="del" onClick={e => deleteSession(s.id,e)} style={{ background:'none', border:'none', cursor:'pointer', color:c.textMuted, fontSize:16, padding:'0 2px', lineHeight:1, flexShrink:0, opacity:0, transition:'opacity 0.15s' }}>×</button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── MAIN CHAT ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>

        {/* Top bar */}
        <div style={{ height:52, flexShrink:0, background:c.topBar, borderBottom:`1px solid ${c.topBorder}`, display:'flex', alignItems:'center', padding:'0 16px', gap:10 }}>
          <button className="ctog" onClick={() => setSidebarOpen(o=>!o)}
            style={{ width:32, height:32, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:`1px solid ${c.topBorder}`, cursor:'pointer', opacity:0.7, transition:'opacity 0.15s', flexShrink:0 }}>
            <svg width="16" height="16" fill="none" stroke={c.textMuted} strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div style={{ width:1, height:18, background:c.topBorder, flexShrink:0 }}/>
          <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:14, fontWeight:700, color:c.text, flexShrink:0 }}>AI Quantity Surveyor</span>
            {!mobile && <span style={{ fontSize:12, color:c.textMuted }}>Upload drawings · lock quantities · generate BOQs</span>}
            {!mobile && currentTakeoffId && <LockedBanner/>}
          </div>
          <button onClick={newChat} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:8, flexShrink:0, background:'transparent', border:`1px solid ${c.topBorder}`, color:c.textMuted, fontSize:12.5, fontWeight:500, cursor:'pointer' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>
            {!mobile && 'New'}
          </button>
        </div>

        {/* Chat body */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0, background:c.chat }} onDragOver={e=>e.preventDefault()} onDrop={onDrop}>

          {/* Messages */}
          <div className="msgs" style={{ flex:1, overflowY:'auto', padding: mobile?'16px 12px':'24px 28px', display:'flex', flexDirection:'column', gap:18 }}>

            {messages.length === 0 && (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, textAlign:'center', padding:'0 16px' }}>
                <div style={{ width:68, height:68, borderRadius:18, background:dark?'#0F1520':'#F1F5F9', border:`1px solid ${c.topBorder}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, marginBottom:18 }}>📐</div>
                <h3 style={{ fontSize: mobile?17:20, fontWeight:700, color:c.text, margin:'0 0 8px' }}>Ready to analyse your project</h3>
                <p style={{ fontSize: mobile?13:14, color:c.textSub, margin:'0 0 24px', maxWidth:460, lineHeight:1.65 }}>
                  Upload a ZIP with drawings, PDFs, or Excel schedules. Quantities get locked before you generate — so the total never changes between runs.
                </p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', maxWidth:520 }}>
                  {[
                    ['📐','Extract quantities','Please extract all quantities from these drawings with full working shown.'],
                    ['💰','Cost estimate','Can you give me a rough cost estimate for this project?'],
                    ['⚠️','Identify risks','What are the key risks or issues you can see?'],
                    ['📋','Building regs','What building regulations apply to this project?'],
                  ].map(([icon,label,text],i) => (
                    <button key={i} className="chip" onClick={() => setInput(text)}
                      style={{ background:dark?'#0F1520':'#F8FAFC', border:`1px solid ${c.topBorder}`, borderRadius:10, padding:'9px 15px', fontSize:13, color:c.text, cursor:'pointer', transition:'all 0.15s' }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => <Message key={i} msg={msg} idx={i}/>)}
            {sending && <Thinking/>}
            <div ref={bottomRef}/>
          </div>

          {/* File chips */}
          {files.length > 0 && (
            <div style={{ display:'flex', gap:8, padding:'8px 16px', background:dark?'#0D1117':'#F8FAFC', borderTop:`1px solid ${c.chatBorder}`, overflowX:'auto', flexShrink:0 }}>
              {files.map((f,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:6, background:c.chipBg, border:`1px solid ${c.chipBorder}`, borderRadius:10, padding:'5px 10px', fontSize:12, color:c.text, whiteSpace:'nowrap' }}>
                  <span>{fileIcon(f.name)}</span>
                  <span style={{ maxWidth:120, overflow:'hidden', textOverflow:'ellipsis' }}>{f.name}</span>
                  <span style={{ color:c.textMuted }}>{fmtSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} style={{ background:'none', border:'none', color:c.textMuted, cursor:'pointer', fontSize:16, padding:'0 0 0 4px', lineHeight:1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: mobile?'8px 10px 12px':'10px 20px 14px', background:c.chat, borderTop:`1px solid ${c.chatBorder}`, flexShrink:0 }}>
            <form onSubmit={handleSend} style={{ display:'flex', alignItems:'flex-end', gap:8, background:c.inputBg, border:`1px solid ${c.inputBorder}`, borderRadius:14, padding:'7px 8px 7px 12px' }}>
              <button type="button" onClick={() => fileRef.current.click()}
                style={{ background:'none', border:'none', color:c.textMuted, cursor:'pointer', padding:'6px', borderRadius:8, display:'flex', alignItems:'center', flexShrink:0 }} title="Upload files">
                <svg width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/>
                </svg>
              </button>
              <input ref={fileRef} type="file" multiple style={{ display:'none' }} accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.zip,.xlsx,.xls,.dwg,.dxf"
                onChange={e => { if (e.target.files?.length) addFiles(e.target.files); }}/>
              <textarea className="ta" value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
                placeholder={
                  currentTakeoffId
                    ? 'Quantities locked — say "generate documents" or ask to adjust...'
                    : files.length > 0
                      ? 'Describe the scope or say "extract quantities"...'
                      : 'Upload drawings or ask a QS question...'
                }
                rows={1} disabled={sending}
                style={{ flex:1, background:'transparent', border:'none', padding:'6px 4px', fontSize:14, color:c.text, resize:'none', outline:'none', fontFamily:'inherit', lineHeight:1.55, maxHeight:140 }}/>
              <button type="submit" disabled={sending || (!input.trim() && files.length === 0)}
                style={{ background:c.accent, border:'none', borderRadius:10, padding:'8px 10px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, opacity: sending||(!input.trim()&&files.length===0)?0.35:1, transition:'opacity 0.15s' }}>
                <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </form>
            <div style={{ fontSize:11, color:c.textMuted, textAlign:'center', marginTop:7 }}>
              {currentTakeoffId
                ? `🔒 Takeoff locked (${currentTakeoffId.slice(0,12)}) · Total is deterministic · Say "generate documents" to produce files`
                : 'Drag & drop · ZIP, PDF, Excel, PNG supported · Quantities locked before generating'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

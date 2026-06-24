import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken, streamChat } from '../utils/api';
import { withUserRef } from '../utils/stripeLinks';
import ProjectIntakeModal from '../components/ProjectIntakeModal';
import BoqTable from '../components/BoqTable';
import AgentPanel from '../components/AgentPanel';
import {
  RulerIcon, BrainIcon, SettingsIcon, AlertTriangleIcon, EditIcon,
  UserIcon, CheckIcon, StarIcon, CrownIcon, ChatIcon, SearchIcon,
  CheckCircleIcon, CoinsIcon, FileTextIcon, ImageIcon, PackageIcon,
  BarChartIcon, PaperclipIcon, ClipboardIcon,
} from '../components/Icons';

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
  { key: 'file',   text: 'Reading files...',           stage: 'upload' },
  { key: 'search', text: 'Analysing scope...',         stage: 'analyse' },
  { key: 'ruler',  text: 'Measuring quantities...',    stage: 'extract' },
  { key: 'check',  text: 'QA review...',               stage: 'validate' },
  { key: 'calc',   text: 'Calculating costs...',       stage: 'price' },
  { key: 'lock',   text: 'Locking quantities...',      stage: 'done' },
];

function useIsMobile() {
  const [v, set] = useState(() => window.innerWidth <= 768);
  useEffect(() => { const h = () => set(window.innerWidth <= 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  return v;
}

// Markdown renderer with QS-appropriate typography. Overrides default HTML
// components so spacing/styling matches the chat bubble look rather than
// default browser defaults.
// Lightweight, dependency-free syntax highlighter. Escapes HTML first, then
// wraps comments / strings / numbers / keywords in coloured spans. Good enough
// for the "claude.ai code block" look without pulling in a heavy library.
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const HL_KEYWORDS = 'const|let|var|function|return|if|else|elif|for|while|do|switch|case|break|continue|new|class|extends|super|this|self|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|yield|static|get|set|public|private|protected|interface|type|enum|namespace|def|lambda|None|True|False|and|or|not|is|pass|with|as|global|nonlocal|print|then|fi|done|echo|select|insert|update|where|join|group|order|limit|null|true|false|undefined|int|float|double|char|bool|boolean|string|struct|func|package|range|defer|chan';
function highlightToHtml(code, lang) {
  const esc = escapeHtml(code);
  const hashComments = /^(py|python|rb|ruby|sh|bash|shell|zsh|yaml|yml|toml|ini|r|perl|pl|makefile|dockerfile)$/i.test(lang || '');
  const commentAlt = hashComments
    ? '\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*'
    : '\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*';
  const re = new RegExp(
    '(' + commentAlt + ')' +
    '|("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)' +
    '|(\\b\\d[\\d_.]*\\b)' +
    '|(\\b(?:' + HL_KEYWORDS + ')\\b)', 'g');
  return esc.replace(re, (m, c, str, num, kw) => {
    if (c) return '<span style="color:#7a8699;font-style:italic">' + c + '</span>';
    if (str) return '<span style="color:#34d399">' + str + '</span>';
    if (num) return '<span style="color:#f59e0b">' + num + '</span>';
    if (kw) return '<span style="color:#c084fc">' + kw + '</span>';
    return m;
  });
}

const LANG_EXT = {
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', jsx: 'jsx', tsx: 'tsx',
  py: 'py', python: 'py', json: 'json', html: 'html', xml: 'xml', css: 'css',
  scss: 'scss', sql: 'sql', sh: 'sh', bash: 'sh', shell: 'sh', yaml: 'yml', yml: 'yml',
  md: 'md', markdown: 'md', java: 'java', go: 'go', rs: 'rs', rust: 'rs',
  c: 'c', cpp: 'cpp', cs: 'cs', rb: 'rb', php: 'php', swift: 'swift', kt: 'kt',
};

// A single fenced code block. Small blocks render inline with a copy button;
// large blocks become a clickable "artifact" card that opens the side panel.
function CodeBlock({ code, lang, mono, color, borderColor, mutedColor, onOpenArtifact }) {
  const [copied, setCopied] = useState(false);
  const lineCount = code.split('\n').length;
  const isArtifact = !!onOpenArtifact && (lineCount >= 12 || code.length >= 500);
  const label = (lang || 'code').toUpperCase();
  const doCopy = async (e) => { e.stopPropagation(); await copyText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); };

  if (isArtifact) {
    return (
      <div onClick={() => onOpenArtifact({ content: code, language: lang || '', title: label + ' snippet', lineCount })}
        style={{ cursor: 'pointer', margin: '2px 0 10px', border: `1px solid ${borderColor}`, borderRadius: 10, overflow: 'hidden', background: borderColor }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
          <span style={{ width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.15)', color: '#F59E0B', flexShrink: 0, fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{'</>'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color }}>{label} snippet</div>
            <div style={{ fontSize: 11.5, color: mutedColor }}>{lineCount} lines · click to open</div>
          </div>
          <span style={{ fontSize: 11.5, color: mutedColor, fontWeight: 600 }}>Open ▸</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ margin: '0 0 10px', borderRadius: 8, overflow: 'hidden', border: `1px solid ${borderColor}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', background: borderColor, fontSize: 11 }}>
        <span style={{ color: mutedColor, fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span>
        <button onClick={doCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: mutedColor, fontSize: 11, fontFamily: 'inherit', padding: '2px 4px' }}>{copied ? 'Copied' : '⧉ Copy'}</button>
      </div>
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', fontFamily: mono, fontSize: 12.5, lineHeight: 1.5, background: 'transparent' }}>
        <code style={{ fontFamily: mono, color }} dangerouslySetInnerHTML={{ __html: highlightToHtml(code, lang) }} />
      </pre>
    </div>
  );
}

function Markdown({ content, color, mutedColor, borderColor, mono, onOpenArtifact }) {
  const base = { color, fontSize: 'inherit', lineHeight: 1.65 };
  const components = useMemo(() => ({
    p:  ({node, ...p}) => <p {...p} style={{ margin: '0 0 10px', ...base }} />,
    h1: ({node, ...p}) => <h1 {...p} style={{ fontSize: 17, fontWeight: 700, margin: '14px 0 8px', ...base }} />,
    h2: ({node, ...p}) => <h2 {...p} style={{ fontSize: 15.5, fontWeight: 700, margin: '14px 0 6px', ...base }} />,
    h3: ({node, ...p}) => <h3 {...p} style={{ fontSize: 14, fontWeight: 700, margin: '12px 0 4px', ...base }} />,
    ul: ({node, ...p}) => <ul {...p} style={{ margin: '0 0 10px', paddingLeft: 20, ...base }} />,
    ol: ({node, ...p}) => <ol {...p} style={{ margin: '0 0 10px', paddingLeft: 20, ...base }} />,
    li: ({node, ...p}) => <li {...p} style={{ margin: '2px 0', ...base }} />,
    strong: ({node, ...p}) => <strong {...p} style={{ fontWeight: 700, color }} />,
    em: ({node, ...p}) => <em {...p} style={{ fontStyle: 'italic' }} />,
    a:  ({node, ...p}) => <a {...p} style={{ color: '#60A5FA', textDecoration: 'underline', textUnderlineOffset: 2 }} target="_blank" rel="noopener noreferrer" />,
    blockquote: ({node, ...p}) => <blockquote {...p} style={{ margin: '0 0 10px', padding: '6px 12px', borderLeft: '3px solid ' + borderColor, color: mutedColor, fontStyle: 'italic' }} />,
    hr: ({node, ...p}) => <hr {...p} style={{ margin: '14px 0', border: 'none', borderTop: '1px solid ' + borderColor }} />,
    code: ({node, inline, className, children, ...p}) => {
      const text = String(Array.isArray(children) ? children.join('') : (children ?? ''));
      const langMatch = /language-(\w+)/.exec(className || '');
      const isBlock = !inline && (langMatch || text.includes('\n'));
      if (!isBlock) {
        return <code {...p} style={{ padding: '1px 5px', borderRadius: 4, background: borderColor, fontFamily: mono, fontSize: '0.92em' }}>{children}</code>;
      }
      return <CodeBlock code={text.replace(/\n$/, '')} lang={langMatch ? langMatch[1] : ''} mono={mono} color={color} borderColor={borderColor} mutedColor={mutedColor} onOpenArtifact={onOpenArtifact} />;
    },
    // CodeBlock renders its own container, so pre is just a passthrough.
    pre: ({node, children, ...p}) => <>{children}</>,
    table: ({node, ...p}) => <div style={{ overflowX: 'auto', margin: '0 0 10px' }}><table {...p} style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }} /></div>,
    thead: ({node, ...p}) => <thead {...p} style={{ background: borderColor }} />,
    th: ({node, ...p}) => <th {...p} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid ' + borderColor, fontWeight: 700, color }} />,
    td: ({node, ...p}) => <td {...p} style={{ padding: '6px 10px', borderBottom: '1px solid ' + borderColor, color }} />,
  }), [color, mutedColor, borderColor, mono, onOpenArtifact]);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content || ''}</ReactMarkdown>;
}

function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  } catch (e) {}
  // Fallback for insecure contexts
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

// File-type metadata for the Claude-style download cards.
function fileMeta(f) {
  const t = (f.type || (f.name || '').split('.').pop() || '').toLowerCase();
  if (t === 'xlsx' || t === 'xls') return { label: 'Excel spreadsheet', ext: 'XLSX', color: '#10B981', bg: 'rgba(16,185,129,0.14)' };
  if (t === 'docx' || t === 'doc') return { label: 'Word document', ext: 'DOCX', color: '#2563EB', bg: 'rgba(37,99,235,0.14)' };
  if (t === 'pdf') return { label: 'PDF document', ext: 'PDF', color: '#DC2626', bg: 'rgba(220,38,38,0.14)' };
  if (t === 'csv') return { label: 'CSV file', ext: 'CSV', color: '#0EA5E9', bg: 'rgba(14,165,233,0.14)' };
  return { label: 'Document', ext: (t || 'FILE').toUpperCase(), color: '#64748B', bg: 'rgba(100,116,139,0.14)' };
}

// Pick a readable ink colour (black/white) for content sitting on a solid bg.
function readableOn(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111111' : '#FFFFFF';
}

function fmtFileSize(bytes) {
  if (!bytes || bytes < 1) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function downloadFile(f) {
  try {
    const token = localStorage.getItem('aiqs_token');
    const r = await fetch(f.url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch { alert('Download failed — please try again.'); }
}

// Open a generated file in the browser via a short-lived signed link: PDFs open
// directly; Excel/Word open in the Google viewer (where you can then open them
// in Google Sheets / Docs).
async function openInViewer(f) {
  try {
    const token = localStorage.getItem('aiqs_token');
    const r = await fetch('/api/files/sign/' + encodeURIComponent(f.name), { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new Error();
    const { url } = await r.json();
    const ext = (f.type || (f.name || '').split('.').pop() || '').toLowerCase();
    const viewer = ext === 'pdf' ? url : 'https://docs.google.com/viewer?url=' + encodeURIComponent(url) + '&embedded=false';
    window.open(viewer, '_blank', 'noopener');
  } catch { alert('Could not open the file — try downloading it instead.'); }
}

// claude.ai-style attachment card: file-type tile, name, type, download arrow.
function FileCard({ f, c, dark }) {
  const m = fileMeta(f);
  const [busy, setBusy] = useState(false);
  const idle = dark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.1)';
  const onClick = async () => { if (busy) return; setBusy(true); await downloadFile(f); setBusy(false); };
  return (
    <div
      onClick={onClick}
      title={'Download ' + f.name}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 12,
        cursor: 'pointer', maxWidth: 360,
        background: dark ? 'rgba(255,255,255,0.03)' : '#FFFFFF',
        border: '1px solid ' + idle, transition: 'border-color .12s ease, transform .12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = m.color; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = idle; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.bg }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
        <div style={{ fontSize: 11, color: c.textMuted, marginTop: 1 }}>{m.ext} · {f.size ? fmtFileSize(f.size) : m.label}</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); openInViewer(f); }}
        title="Open in browser (Google viewer)"
        style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
      <div title="Download" style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textMuted }}>
        {busy
          ? <span style={{ width: 13, height: 13, border: '2px solid ' + c.textMuted, borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { mode, t } = useTheme();
  const { user } = useAuth();
  const dark = mode === 'dark';
  const mobile = useIsMobile();

  // ── Core state ─────────────────────────────────────────────────────
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [files, setFiles]             = useState([]);
  const [sending, setSending]         = useState(false);
  const [stage, setStage]             = useState(0);
  const [stageDetail, setStageDetail] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [expanded, setExpanded]       = useState({});
  // Artifacts side panel — opened when a large code block is clicked.
  const [artifact, setArtifact]       = useState(null);
  const openArtifact = useCallback((a) => setArtifact(a), []);

  // ── Session / takeoff tracking ─────────────────────────────────────
  // These are the two critical IDs that must persist through the conversation
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentTakeoffId, setCurrentTakeoffId] = useState(null);
  const [takeoffStatus, setTakeoffStatus] = useState(null); // 'draft' | 'confirmed' | null

  // ── Quota tracking ────────────────────────────────────────────────
  const [quotaInfo, setQuotaInfo]     = useState(null);

  // ── Sidebar ────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(!mobile);
  const [sessions, setSessions]       = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // ── Project intake modal ──────────────────────────────────────────
  // Shown when files are first attached to a fresh chat — collects scope,
  // floor area, project type etc. so the BOQ is grounded in user-confirmed answers.
  const [intakeOpen, setIntakeOpen]     = useState(false);
  const [intakeDone, setIntakeDone]     = useState(false); // per-session flag
  const [pendingIntake, setPendingIntake] = useState(null); // saved answers

  // ── Editable BOQ table ────────────────────────────────────────────
  // Shown below messages when a takeoff exists for the current session.
  // Tracks a key so we can force the BoqTable to reload after an edit.
  const [boqOpen, setBoqOpen] = useState(true);
  const [boqRefreshKey, setBoqRefreshKey] = useState(0);

  // ── BOQ Agent (opt-in, multi-step tool-use pipeline) ───────────────
  const [agentRunId, setAgentRunId] = useState(null);
  const [agentStarting, setAgentStarting] = useState(false);

  async function startAgent() {
    if (files.length === 0 && !input.trim()) {
      alert('Attach drawings or describe the project before running the Agent.');
      return;
    }
    setAgentStarting(true);

    // Capture files + scope BEFORE we clear state so the POST has them.
    const capturedFiles = [...files];
    const fileSnap = capturedFiles.map(f => ({ name: f.name, size: f.size }));
    const scopeText = input.trim();

    // Optimistically drop the messages in FIRST so the user sees something
    // happening immediately. The POST can take 5-15s to upload + unpack ZIPs,
    // and during that gap we don't want the user staring at an unchanged UI.
    const userMsg = {
      role: 'user',
      content: scopeText || `Atlas run${fileSnap.length > 0 ? ` on ${fileSnap.length} file${fileSnap.length !== 1 ? 's' : ''}` : ''}.`,
      files: fileSnap,
      timestamp: new Date().toISOString(),
    };
    // Placeholder AI message — replaced with a real agentRunId once the POST
    // returns. Flag with agentStarting: true so UI can show spinner inline.
    const placeholderMsg = {
      role: 'assistant',
      content: 'Starting Atlas — uploading your files and initialising the BOQ engine. The live panel will appear below in a few seconds.',
      agentStarting: true,
      timestamp: new Date().toISOString(),
    };
    setMessages(p => [...p, userMsg, placeholderMsg]);
    setInput('');
    setFiles([]);

    try {
      // Ensure the agent run is linked to a chat session from the start.
      // Without this, atlas finishes "headless" and a follow-up "generate
      // documents" in the chat can't find the takeoff. Mint a session_id
      // client-side if one doesn't exist yet; saveSession will upsert it.
      let sessId = currentSessionId;
      if (!sessId) {
        try {
          sessId = 'cs_' + (window.crypto?.randomUUID ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14));
        } catch (e) {
          sessId = 'cs_' + Math.random().toString(36).slice(2, 14);
        }
        setCurrentSessionId(sessId);
      }
      const fd = new FormData();
      if (scopeText) fd.append('scope', scopeText);
      if (pendingIntake) fd.append('intake_json', JSON.stringify(pendingIntake));
      fd.append('session_id', sessId);
      capturedFiles.forEach(f => fd.append('files', f));
      const token = getToken();
      const resp = await fetch('/api/agent', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to start');
      setAgentRunId(data.run_id);

      // Replace the placeholder with the real assistant message carrying
      // the run id so it re-attaches on reload.
      setMessages(p => p.map(m => m.agentStarting
        ? { role: 'assistant', content: 'Atlas is running — watch the live panel below. Safe to close the tab and come back, the panel re-attaches on reload.', agentRunId: data.run_id, timestamp: m.timestamp }
        : m
      ));
    } catch (err) {
      // Replace placeholder with an error message the user can see in-line
      setMessages(p => p.map(m => m.agentStarting
        ? { role: 'assistant', content: `Atlas failed to start: ${err.message}`, timestamp: m.timestamp }
        : m
      ));
    } finally {
      setAgentStarting(false);
    }
  }

  const onAgentCompleted = useCallback((run) => {
    if (!run) return;
    let downloads = [];
    try { downloads = run.download_files ? (typeof run.download_files === 'string' ? JSON.parse(run.download_files) : run.download_files) : []; } catch (e) {}
    const sym = run.currency === 'EUR' ? '€' : '£';
    const grand = run.grand_total ? `${sym}${Math.round(run.grand_total).toLocaleString('en-GB')}` : '(no total)';
    // Lead with the agent's own written summary/findings so the left pane reads
    // like a proper explanation, then the headline.
    let intro = '';
    try {
      const fs = run.findings_structured
        ? (typeof run.findings_structured === 'string' ? JSON.parse(run.findings_structured) : run.findings_structured)
        : null;
      if (run.review_summary) intro += run.review_summary.trim() + '\n\n';
      if (fs && Array.isArray(fs.key_findings) && fs.key_findings.length) {
        intro += fs.key_findings.map(f => `**${f.title}**\n${f.detail || ''}${Array.isArray(f.items) && f.items.length ? '\n' + f.items.map(x => `- ${x}`).join('\n') : ''}`).join('\n\n') + '\n\n';
      } else if (!run.review_summary && run.findings_notes) {
        intro += String(run.findings_notes).trim() + '\n\n';
      }
    } catch (e) { /* fall back to headline only */ }
    setMessages(p => {
      const last = p[p.length - 1];
      if (last && last.role === 'assistant' && last.agentRunCompleted === run.id) return p;
      return [...p, {
        role: 'assistant',
        content: `${intro}**Priced at ${grand}**${run.floor_area_m2 ? ` · ${run.floor_area_m2}m²` : ''}${run.project_type ? ` · ${run.project_type}` : ''}. Your documents are ready below.`,
        agentRunCompleted: run.id,
        downloadFiles: downloads.length > 0 ? downloads : null,
        timestamp: new Date().toISOString(),
      }];
    });
    if (downloads.length > 0) {
      setAgentRunId(null); // the live panel's job is done — dismiss it; the BOQ now flows inline
    }
  }, []);

  // ── Copy feedback + smart auto-scroll ──────────────────────────────
  const [copiedIdx, setCopiedIdx] = useState(null);
  const userScrolledUp = useRef(false);
  const msgsRef = useRef(null);

  const bottomRef   = useRef(null);
  const fileRef     = useRef(null);
  const inputRef    = useRef(null);
  const timerRef    = useRef(null);
  const saveRef     = useRef(null);
  const hadFiles    = useRef(false);
  const abortRef    = useRef(null);
  // Mirror of currentSessionId so the memoized agent-completion callback can
  // read the live value without re-creating (avoids a stale closure).
  const sessionIdRef = useRef(null);
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);

  useEffect(() => { if (mobile) setSidebarOpen(false); }, [mobile]);
  useEffect(() => {
    loadSessions();
    apiFetch('/usage').then(d => {
      if (d) setQuotaInfo({ messages_used: d.messagesUsed || 0, messages_limit: d.messagesLimit || 0, docs_used: d.used || 0, docs_limit: d.quota || 0, plan: d.plan });
    }).catch(() => {});
  }, []);
  // Smart auto-scroll — only follow new content if the user is already near the
  // bottom. If they've scrolled up to read, leave them alone (claude.ai behaviour).
  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, stage, streamingText]);

  // Track whether the user has scrolled away from the bottom
  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = distFromBottom > 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (sending) {
      setStage(0);
      setStageDetail('');
      // Fallback timer in case SSE progress events don't arrive
      timerRef.current = setInterval(() => setStage(p => p < STAGES.length - 1 ? p + 1 : p), 4500);
    } else {
      clearInterval(timerRef.current);
      setStage(0);
      setStageDetail('');
      setStreamingText('');
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
  // Chat palette derived from the active theme tokens, so the whole chat
  // re-skins with the selected theme (AI QS / ChatGPT / Claude / Copilot).
  // Status colours (draft/locked/warn) stay semantic so meaning is preserved.
  const c = {
    page: t.bg, side: t.sidebar, sideBorder: t.sidebarBorder, sideHeader: t.sidebar,
    sessHover: t.surfaceHover, sessActive: t.surfaceHover, sessActiveBorder: t.border, sessActiveText: t.text,
    chat: t.surface, chatBorder: t.border,
    userBubble: t.userBubble, aiBubble: t.card, text: t.text, textSub: t.textSecondary, textMuted: t.textMuted,
    inputBg: t.inputBg, inputBorder: t.border, accent: t.accent,
    chipBg: t.surfaceHover, chipBorder: t.border, error: t.danger, avatarBg: t.surfaceHover,
    thinkBg: t.card, thinkBorder: t.border, thinkText: t.textSecondary, amber: t.accent,
    accentText: t.accentText, accentGradient: t.gradientAccent,
    stageActive: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', stageActiveText: t.accent,
    stageDone: t.success, stageWait: t.border,
    topBar: t.sidebar, topBorder: t.border, overlay: 'rgba(0,0,0,0.55)',
    newBg: 'transparent', newBorder: t.border, newText: t.accent,
    draftBg: 'rgba(245,158,11,0.08)', draftBorder: 'rgba(245,158,11,0.25)', draftText: '#F59E0B',
    lockedBg: 'rgba(16,185,129,0.08)', lockedBorder: 'rgba(16,185,129,0.25)', lockedText: '#10B981',
    warnBg: 'rgba(245,158,11,0.08)', warnBorder: 'rgba(245,158,11,0.25)', warnText: '#F59E0B',
    scroll: t.border, groupLabel: t.textMuted,
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
      // Recover takeoff_id and status from message history — critical for "generate" after page reload
      const lastWithTakeoff = [...msgs].reverse().find(m => m.takeoffId || m.takeoff_id);
      if (lastWithTakeoff) {
        const tid = lastWithTakeoff.takeoffId || lastWithTakeoff.takeoff_id;
        setCurrentTakeoffId(tid);
        setTakeoffStatus(lastWithTakeoff.takeoffStatus || (lastWithTakeoff.takeoffLocked ? 'confirmed' : 'draft'));
        console.log('[Session] Recovered takeoff_id:', tid);
      } else {
        setCurrentTakeoffId(null);
        setTakeoffStatus(null);
      }
      // Recover agent run id from the message history — re-attaches the
      // live panel so tab close/reload doesn't lose progress view.
      const lastWithAgent = [...msgs].reverse().find(m => m.agentRunId);
      if (lastWithAgent) {
        setAgentRunId(lastWithAgent.agentRunId);
        console.log('[Session] Recovered agent_run_id:', lastWithAgent.agentRunId);
      } else {
        setAgentRunId(null);
      }
    } catch (e) { console.error(e); }
  }

  async function deleteSession(id, e) {
    e.stopPropagation();
    // Cancel any pending auto-save BEFORE deleting — prevents the save
    // timer from re-inserting the session after it's been removed from DB
    clearTimeout(saveRef.current);
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
        pipelineLog: m.pipelineLog || null,
        timestamp: m.timestamp, error: m.error || false,
        takeoffLocked: m.takeoffLocked || false,
        takeoffStatus: m.takeoffStatus || null,
        agentRunId: m.agentRunId || null,
        agentRunCompleted: m.agentRunCompleted || null,
        files: m.files || null,
      }));
      const d = await apiFetch('/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sid || undefined, messages: saveable }),
      });
      if (!sid && d.id) setCurrentSessionId(d.id);
      // Always refresh the sidebar so the latest chat (and its auto-generated
      // title) shows immediately — not only for brand-new sessions.
      loadSessions();
      return (!sid && d.id) ? d.id : sid;
    } catch (e) { console.error(e); }
  }, []);

  function newChat() {
    setMessages([]); setCurrentSessionId(null); setCurrentTakeoffId(null); setTakeoffStatus(null);
    setExpanded({}); setFiles([]); setInput('');
    setIntakeDone(false); setPendingIntake(null); setIntakeOpen(false);
    setAgentRunId(null); setAgentStarting(false);
    if (mobile) setSidebarOpen(false);
  }

  // ── File helpers ───────────────────────────────────────────────────
  const addFiles = fl => {
    setFiles(p => {
      const next = [...p, ...Array.from(fl)].slice(0, 5);
      // First time files are attached to a fresh chat → open intake modal.
      // Only open once per session: skip if already done or already has messages.
      if (next.length > 0 && p.length === 0 && !intakeDone && messages.length === 0 && !currentSessionId) {
        setIntakeOpen(true);
      }
      return next;
    });
  };
  const removeFile = i => setFiles(p => p.filter((_, j) => j !== i));
  const fileIcon = n => ({ pdf:FileTextIcon, png:ImageIcon, jpg:ImageIcon, jpeg:ImageIcon, zip:PackageIcon, xlsx:BarChartIcon, xls:BarChartIcon, dwg:RulerIcon, dxf:RulerIcon })[n?.split('.').pop()?.toLowerCase()] || PaperclipIcon;
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
  // overrideText lets callers (e.g. Regenerate button on the BOQ table) send
  // a specific message without needing to funnel it through the input state.
  async function handleSend(e, overrideText, opts = {}) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const textToSend = overrideText != null ? overrideText : input;
    if (!textToSend.trim() && files.length === 0) return;
    // baseMessages lets Regenerate re-run from a truncated history without
    // depending on React state having flushed yet.
    const baseMessages = Array.isArray(opts.baseMessages) ? opts.baseMessages : messages;

    // ── Unified Send — if files are attached (drawings etc.) and there's
    // no active takeoff/agent run yet, route to the BOQ agent. This is the
    // one-button UX: upload + send = full tender-grade BOQ pipeline.
    // Typed-only messages (no files) go through the fast chat path below.
    if (files.length > 0 && !currentTakeoffId && !agentRunId && overrideText == null) {
      await startAgent();
      return;
    }

    const userMsg = {
      role: 'user', content: textToSend,
      files: files.map(f => ({ name: f.name, size: f.size })),
      timestamp: new Date().toISOString(),
    };
    const nextMessages = [...baseMessages, userMsg];
    setMessages(nextMessages);
    const savedInput = textToSend;
    const savedFiles = [...files];
    hadFiles.current = files.length > 0;
    if (overrideText == null) setInput('');
    setFiles([]); setSending(true);

    // Truncate history to last 20 messages and cap each at 4000 chars to avoid exceeding field size limits
    const history = baseMessages.filter(m => m.content).slice(-20).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' && m.content.length > 4000 ? m.content.slice(0, 4000) + '...' : m.content,
    }));
    const fd = new FormData();
    fd.append('message', savedInput);
    fd.append('history', JSON.stringify(history));

    // ── CRITICAL: always send session_id and takeoff_id ──────────
    if (currentSessionId) fd.append('session_id', currentSessionId);
    if (currentTakeoffId) fd.append('takeoff_id', currentTakeoffId);

    // Attach project intake answers (if user filled them out before this send)
    // so the backend can inject them into the system prompt for THIS turn.
    if (pendingIntake) {
      try { fd.append('intake_json', JSON.stringify(pendingIntake)); } catch (e) {}
    }

    savedFiles.forEach(f => fd.append('files', f));

    // Use SSE streaming for real-time progress
    abortRef.current = streamChat(fd, {
      onProgress: (stage, detail) => {
        // Map backend stage names to STAGES array indices
        const stageMap = { upload: 0, analyse: 1, extract: 2, validate: 3, price: 4, generate: 4, done: 5 };
        const idx = stageMap[stage];
        if (idx !== undefined) {
          clearInterval(timerRef.current); // Stop fallback timer once real events arrive
          setStage(idx);
        }
        if (detail) setStageDetail(detail);
      },
      onText: (fullText) => {
        setStreamingText(fullText);
      },
      onDone: (data) => {
        // ── Capture session_id and takeoff_id from response ──────────
        if (data.session_id && !currentSessionId) {
          setCurrentSessionId(data.session_id);
          console.log('[Chat] Session established:', data.session_id);
        }
        if (data.takeoff_id) {
          setCurrentTakeoffId(data.takeoff_id);
          const status = data.takeoff_status || (data.takeoff_locked ? 'confirmed' : 'draft');
          setTakeoffStatus(status);
          console.log('[Chat] Takeoff:', data.takeoff_id, 'status:', status);
        }

        // Persist project intake answers now that we have a session_id
        if (pendingIntake && data.session_id) {
          apiFetch('/project-intake', {
            method: 'POST',
            body: JSON.stringify({ session_id: data.session_id, ...pendingIntake }),
          }).catch(() => {});
          setPendingIntake(null);
        }

        const aiMsg = {
          role: 'assistant',
          content: data.reply,
          thinking: data.thinking || null,
          downloadFiles: data.files || null,
          paymentRequired: data.payment_required || null,
          quota: data.quota || null,
          takeoffLocked: data.takeoff_locked || false,
          takeoffStatus: data.takeoff_status || (data.takeoff_id ? 'draft' : null),
          pipelineLog: data.pipeline_log || null,
          sessionId: data.session_id,
          takeoffId: data.takeoff_id,
          capturedMemories: data.captured_memories || null,
          sources: data.sources || null,
          timestamp: new Date().toISOString(),
        };
        setMessages(p => [...p, aiMsg]);
        if (data.quota) setQuotaInfo(data.quota);
        if (data.files?.length) setTimeout(loadSessions, 2000);
        // Refresh the BOQ table whenever the chat produces a new takeoff
        // or triggers quantity adjustments server-side
        if (data.takeoff_id) setBoqRefreshKey(k => k + 1);
        setSending(false);
      },
      onError: (err) => {
        console.error('[Chat] Stream error:', err.message, err.data);
        const errData = err.data || {};
        const isSuspended = errData.suspended || /suspend/i.test(err.message || '');
        const isQuota = !isSuspended && (errData.limit_type
          || /limit|upgrade|credits|quota|no message/i.test(err.message || ''));
        const limitType = errData.limit_type || 'messages';
        const userPlan = errData.plan || 'starter';
        let displayMessage;
        if (isSuspended) {
          displayMessage = err.message || 'Your account has been suspended. Contact support.';
        } else if (isQuota) {
          displayMessage = err.message || 'You have reached your usage limit.';
          if (!/upgrade|contact|plan/i.test(displayMessage)) {
            displayMessage += ' Upgrade your plan for more credits.';
          }
        } else if (err.message && err.message !== 'Something went wrong' && !err.message.includes('Session expired')) {
          displayMessage = err.message;
        } else {
          displayMessage = 'Something went wrong — please try again.';
        }
        setMessages(p => [...p, {
          role: 'assistant',
          content: displayMessage,
          timestamp: new Date().toISOString(),
          error: isSuspended || !isQuota,
          paymentRequired: isQuota ? {
            message: displayMessage,
            type: limitType,
            plan: userPlan,
          } : null,
        }]);
        setSending(false);
      },
    });
  }

  // ── Edit a previous user message ───────────────────────────────────
  // claude.ai-style: pull the message back into the composer and drop it
  // (and everything after it) so the user can revise and resend from there.
  function editUserMessage(idx) {
    if (sending) return;
    const m = messages[idx];
    if (!m || m.role !== 'user') return;
    const text = typeof m.content === 'string' ? m.content : '';
    setMessages(messages.slice(0, idx));
    setInput(text);
    setTimeout(() => { try { inputRef.current?.focus(); } catch (e) {} }, 0);
  }

  // ── Regenerate an assistant reply ──────────────────────────────────
  // Re-run the user message that produced this reply, replacing it.
  function regenerateFrom(idx) {
    if (sending) return;
    let uIdx = idx - 1;
    while (uIdx >= 0 && messages[uIdx].role !== 'user') uIdx--;
    if (uIdx < 0) return;
    const um = messages[uIdx];
    const userText = typeof um.content === 'string' ? um.content : '';
    if (!userText.trim()) return;
    const base = messages.slice(0, uIdx); // everything before that user turn
    setMessages(base);
    handleSend(null, userText, { baseMessages: base });
  }

  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }
  function onDrop(e) { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }

  // ── Sub-components ─────────────────────────────────────────────────
  function Thinking() {
    return (
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
        <div style={{ width:34, height:34, borderRadius:10, background:c.avatarBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}><RulerIcon size={16} /></div>
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
                <span style={{ fontSize:12.5, fontWeight:active?600:400, color:col, transition:'color 0.3s' }}>
                  {active && stageDetail ? stageDetail : s.text}
                </span>
                {active && <span style={{ marginLeft:'auto', display:'flex', gap:3 }}>{[0,1,2].map(d => <span key={d} style={{ width:4, height:4, borderRadius:'50%', background:c.stageActiveText, animation:'dot 1.4s infinite', animationDelay:`${d*0.2}s` }}/>)}</span>}
              </div>
            );
          })}
          {streamingText && (
            <div style={{ marginTop:10, padding:'8px 10px', background:dark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.02)', borderRadius:8, maxHeight:120, overflowY:'auto' }}>
              <pre style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word', fontSize:12, lineHeight:1.5, color:c.text, fontFamily:'inherit' }}>{streamingText.slice(-300)}</pre>
            </div>
          )}
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
          <BrainIcon size={14} /> <span>View reasoning</span>
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

  function PipelineLog({ log, idx }) {
    if (!log || !log.length) return null;
    const open = expanded['pl_'+idx];
    const stageIcons = { detect: SearchIcon, extract: RulerIcon, validate: CheckCircleIcon, price: CoinsIcon };
    return (
      <div style={{ marginBottom:8, borderRadius:10, border:`1px solid ${c.thinkBorder}`, overflow:'hidden' }}>
        <button onClick={() => setExpanded(p => ({...p, ['pl_'+idx]: !p['pl_'+idx]}))}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:dark?'#0D1117':'#F1F5F9', border:'none', cursor:'pointer', fontSize:12, fontWeight:600, color:'#3B82F6' }}>
          <span style={{ transform:open?'rotate(90deg)':'rotate(0)', transition:'transform 0.2s', fontSize:10 }}>▶</span>
          <span style={{ fontSize:13 }}><SettingsIcon size={13} /></span> <span>View pipeline</span>
          <span style={{ marginLeft:'auto', fontSize:11, fontWeight:400, color:c.textMuted }}>
            {log.length} stage{log.length !== 1 ? 's' : ''} · {open?'Collapse':'Expand'}
          </span>
        </button>
        {open && (
          <div style={{ padding:'10px 14px', background:c.thinkBg, borderTop:`1px solid ${c.thinkBorder}` }}>
            {log.map((entry, i) => {
              const SIco = stageIcons[entry.stage] || SettingsIcon;
              return (
              <div key={i} style={{ display:'flex', gap:10, padding:'8px 0', borderBottom: i < log.length-1 ? `1px solid ${c.thinkBorder}` : 'none' }}>
                <span style={{ fontSize:15, flexShrink:0, marginTop:1 }}><SIco size={15} /></span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:c.text, marginBottom:2 }}>{entry.label}</div>
                  <div style={{ fontSize:11.5, color:c.textMuted, lineHeight:1.5 }}>{entry.detail}</div>
                  {entry.corrections && entry.corrections.length > 0 && (
                    <div style={{ marginTop:6, padding:'6px 10px', borderRadius:6, background:dark?'rgba(245,158,11,0.06)':'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.15)' }}>
                      <div style={{ fontSize:10, fontWeight:700, color:c.amber, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>QA Corrections</div>
                      {entry.corrections.map((corr, ci) => (
                        <div key={ci} style={{ fontSize:11, color:c.thinkText, lineHeight:1.6, paddingLeft:8, borderLeft:`2px solid rgba(245,158,11,0.2)`, marginBottom:3 }}>{corr}</div>
                      ))}
                    </div>
                  )}
                  {entry.warnings && entry.warnings.length > 0 && (
                    <div style={{ marginTop:4 }}>
                      {entry.warnings.map((w, wi) => (
                        <div key={wi} style={{ fontSize:11, color:c.amber, lineHeight:1.5 }}><AlertTriangleIcon size={14} style={{ verticalAlign:'middle' }} /> {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function TakeoffBanner() {
    if (!currentTakeoffId) return null;
    const isDraft = takeoffStatus !== 'confirmed';
    const bg = isDraft ? c.draftBg : c.lockedBg;
    const border = isDraft ? c.draftBorder : c.lockedBorder;
    const color = isDraft ? c.draftText : c.lockedText;
    const label = isDraft ? 'Draft — review & confirm' : 'Quantities locked';
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px', background:bg, border:`1px solid ${border}`, borderRadius:8, fontSize:11.5, color, fontWeight:600, whiteSpace:'nowrap' }}>
        {isDraft ? <EditIcon size={13} color={color} /> : ICONS.lock(color)} {label}
      </div>
    );
  }

  function Message({ msg, idx }) {
    const isUser = msg.role === 'user';
    const isErr = !isUser && msg.error;
    return (
      <>
        {!isUser && (msg.thinking || msg.pipelineLog) && (
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ width:34, flexShrink:0 }}/>
            <div style={{ maxWidth: mobile ? '90%' : '72%' }}>
              {msg.thinking && <ThinkingBlock thinking={msg.thinking} idx={idx}/>}
              {msg.pipelineLog && <PipelineLog log={msg.pipelineLog} idx={idx}/>}
            </div>
          </div>
        )}
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexDirection:isUser?'row-reverse':'row' }}>
          <div style={{ width:34, height:34, borderRadius:10, background:isUser?c.accent:c.avatarBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>
            {isUser ? <UserIcon size={15} /> : <RulerIcon size={15} />}
          </div>
          <div style={{
            maxWidth: isUser ? (mobile ? '85%' : '80%') : '100%',
            padding: isUser ? '11px 15px' : (isErr ? '10px 14px' : '1px 0'),
            borderRadius: isUser ? '16px 4px 16px 16px' : (isErr ? 10 : 0),
            background: isUser ? c.userBubble : (isErr ? (dark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)') : 'transparent'),
            border: isErr ? '1px solid rgba(239,68,68,0.25)' : 'none',
            color: isUser ? readableOn(c.userBubble) : (msg.error ? c.error : c.text),
            fontSize: mobile ? 13 : 14, lineHeight:1.65, wordBreak:'break-word',
          }}>

            {/* User file chips */}
            {isUser && msg.files?.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:8 }}>
                {msg.files.map((f,i) => {
                  const FIco = fileIcon(f.name);
                  return (
                  <span key={i} style={{ background: readableOn(c.userBubble)==='#FFFFFF' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)', borderRadius:6, padding:'3px 9px', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
                    <FIco size={14} /> {f.name}
                  </span>
                  );
                })}
              </div>
            )}

            {/* Message text — markdown for assistant, plain for user (their input is literal) */}
            {isUser ? (
              <>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content || ''}</div>
                {!sending && typeof msg.content === 'string' && msg.content.trim() && (
                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => editUserMessage(idx)}
                      title="Edit & resend"
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 500,
                        padding: '3px 6px', borderRadius: 5, fontFamily: 'inherit',
                        display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.8,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.8'; }}
                    >
                      <EditIcon size={12} /> Edit
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Markdown
                content={msg.content || ''}
                color={msg.error ? c.error : c.text}
                mutedColor={c.textMuted}
                borderColor={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
                mono="'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
                onOpenArtifact={openArtifact}
              />
            )}

            {/* Agent-starting spinner — shown inline while the POST is in
                flight before the live panel attaches. */}
            {msg.agentStarting && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 7, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.22)', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: c.amber, fontWeight: 500 }}>
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  {[0, 1, 2].map(d => <span key={d} style={{ width: 4, height: 4, borderRadius: '50%', background: c.amber, animation: 'dot 1.4s infinite', animationDelay: (d * 0.2) + 's' }} />)}
                </span>
                <span>Uploading files · initialising agent…</span>
              </div>
            )}

            {/* Copy + streaming indicator (assistant only) */}
            {!isUser && msg.content && !msg.streaming && (
              <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={async () => {
                    await copyText(msg.content || '');
                    setCopiedIdx(idx);
                    setTimeout(() => setCopiedIdx(prev => prev === idx ? null : prev), 1400);
                  }}
                  title="Copy reply"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: c.textMuted, fontSize: 11, fontWeight: 500,
                    padding: '3px 6px', borderRadius: 5, fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    opacity: 0.7,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
                >
                  {copiedIdx === idx ? <><CheckIcon size={14} style={{ verticalAlign:'middle' }} /> Copied</> : '⧉ Copy'}
                </button>
                {!sending && !msg.error && (
                  <button
                    onClick={() => regenerateFrom(idx)}
                    title="Regenerate this reply"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: c.textMuted, fontSize: 11, fontWeight: 500,
                      padding: '3px 6px', borderRadius: 5, fontFamily: 'inherit',
                      display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.7,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
                  >
                    ↻ Retry
                  </button>
                )}
              </div>
            )}
            {!isUser && msg.streaming && (
              <span style={{ display: 'inline-block', width: 7, height: 14, background: c.amber, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'pulse 1s infinite' }} />
            )}

            {/* Web search source chips */}
            {!isUser && msg.sources && msg.sources.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: c.textSub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <SearchIcon size={11} /> Sources
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {msg.sources.map((s, si) => {
                    let host = s.url;
                    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch (e) {}
                    return (
                      <a key={si} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title || s.url}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 230, padding: '4px 9px', borderRadius: 999, background: dark ? 'rgba(96,165,250,0.1)' : 'rgba(59,130,246,0.08)', border: '1px solid rgba(96,165,250,0.25)', color: '#60A5FA', fontSize: 11.5, textDecoration: 'none', fontWeight: 500 }}>
                        <span style={{ opacity: 0.7 }}>{si + 1}.</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Remembered-memory chips */}
            {!isUser && msg.capturedMemories && msg.capturedMemories.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {msg.capturedMemories.map((mem, mi) => (
                  <div key={mem.id || mi} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 7,
                    background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.25)',
                    fontSize: 12, color: c.amber,
                  }}>
                    <BrainIcon size={14} />
                    <span style={{ flex: 1, lineHeight: 1.45 }}>
                      <span style={{ fontWeight: 600 }}>Remembered:</span> {mem.content}
                    </span>
                    <button
                      onClick={async () => {
                        if (!mem.id) return;
                        if (!window.confirm('Forget this memory?')) return;
                        try {
                          await apiFetch('/memories/' + mem.id, { method: 'DELETE' });
                          setMessages(p => p.map((pm, pi) => pi === idx
                            ? { ...pm, capturedMemories: (pm.capturedMemories || []).filter(x => x.id !== mem.id) }
                            : pm
                          ));
                        } catch (e) {}
                      }}
                      title="Forget this memory"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: c.amber, fontSize: 14, padding: '0 2px',
                        opacity: 0.6, lineHeight: 1,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Takeoff locked indicator */}
            {(msg.takeoffLocked || msg.takeoffStatus) && (
              <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                background: msg.takeoffStatus === 'confirmed' || msg.takeoffLocked ? c.lockedBg : c.draftBg,
                border: `1px solid ${msg.takeoffStatus === 'confirmed' || msg.takeoffLocked ? c.lockedBorder : c.draftBorder}`,
                borderRadius:8, fontSize:12,
                color: msg.takeoffStatus === 'confirmed' || msg.takeoffLocked ? c.lockedText : c.draftText,
                fontWeight:600 }}>
                {msg.takeoffStatus === 'confirmed' || msg.takeoffLocked ? ICONS.lock(c.lockedText) : <EditIcon size={13} color={c.draftText} />}
                {msg.takeoffStatus === 'confirmed' || msg.takeoffLocked
                  ? 'Quantities locked — say "generate documents" to produce your Excel BOQ & Word Report'
                  : 'Draft quantities — review above, then say "confirm" to lock them in'}
              </div>
            )}

            {/* Download files — claude.ai-style attachment cards */}
            {msg.downloadFiles?.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: c.textSub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {msg.downloadFiles.length === 1 ? '1 file ready' : `${msg.downloadFiles.length} files ready`}
                </div>
                {msg.downloadFiles.map((f, i) => (
                  <FileCard key={i} f={f} c={c} dark={dark} />
                ))}
              </div>
            )}

            {/* Payment required */}
            {msg.paymentRequired && (
              <div style={{ marginTop:14, padding:16, borderRadius:10, background:c.warnBg, border:`1px solid ${c.warnBorder}` }}>
                <div style={{ fontSize:13, fontWeight:600, color:c.text, marginBottom:4 }}>{msg.paymentRequired.message || 'Generate your BOQ documents'}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
                  <a href={withUserRef("https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g", user)} target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'11px 18px', borderRadius:8, background:'linear-gradient(135deg,#F59E0B,#D97706)', color:'#0A0F1C', textDecoration:'none', fontSize:13, fontWeight:700 }}>
                    Pay £150 — Generate this BOQ
                  </a>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <a href="https://buy.stripe.com/dRmfZh9VucfK5sA0HG73G04" target="_blank" rel="noopener noreferrer"
                      style={{ flex:1, display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'9px 14px', borderRadius:8, background:'rgba(245,158,11,0.06)', border:`1px solid ${c.warnBorder}`, color:c.text, textDecoration:'none', fontSize:12, fontWeight:600 }}>
                      <StarIcon size={14} style={{ verticalAlign:'middle' }} /> Professional £347/mo
                    </a>
                    <a href="https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05" target="_blank" rel="noopener noreferrer"
                      style={{ flex:1, display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'9px 14px', borderRadius:8, background:'rgba(124,58,237,0.06)', border:'1px solid rgba(124,58,237,0.2)', color:c.text, textDecoration:'none', fontSize:12, fontWeight:600 }}>
                      <CrownIcon size={14} style={{ verticalAlign:'middle' }} /> Premium £447/mo
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
    <>
    <ProjectIntakeModal
      open={intakeOpen}
      fileNames={files.map(f => f.name)}
      onClose={() => setIntakeOpen(false)}
      onSkip={() => { setIntakeOpen(false); setIntakeDone(true); }}
      onSubmit={(data) => { setPendingIntake(data); setIntakeOpen(false); setIntakeDone(true); }}
    />

    {/* Artifacts side panel — claude.ai-style drawer for large code blocks */}
    {artifact && (
      <div onClick={() => setArtifact(null)}
        style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', justifyContent: 'flex-end', background: c.overlay }}>
        <div onClick={e => e.stopPropagation()}
          style={{ width: mobile ? '100%' : 'min(580px, 94vw)', height: '100%', background: c.chat, borderLeft: `1px solid ${c.chatBorder}`, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${c.chatBorder}` }}>
            <span style={{ width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(245,158,11,0.15)', color: '#F59E0B', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{'</>'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.title || 'Snippet'}</div>
              <div style={{ fontSize: 11.5, color: c.textMuted }}>{(artifact.language || 'text').toUpperCase()}{artifact.lineCount ? ` · ${artifact.lineCount} lines` : ''}</div>
            </div>
            <button onClick={() => copyText(artifact.content)} title="Copy" style={{ background: 'none', border: `1px solid ${c.chatBorder}`, cursor: 'pointer', color: c.textSub, fontSize: 12, fontFamily: 'inherit', padding: '5px 9px', borderRadius: 6 }}>⧉ Copy</button>
            <button onClick={() => {
              try {
                const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'snippet.' + (LANG_EXT[(artifact.language || '').toLowerCase()] || 'txt');
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
              } catch (e) {}
            }} title="Download" style={{ background: 'none', border: `1px solid ${c.chatBorder}`, cursor: 'pointer', color: c.textSub, fontSize: 13, fontFamily: 'inherit', padding: '5px 9px', borderRadius: 6 }}>↓</button>
            <button onClick={() => setArtifact(null)} title="Close" style={{ background: 'none', border: `1px solid ${c.chatBorder}`, cursor: 'pointer', color: c.textSub, fontSize: 13, fontFamily: 'inherit', padding: '5px 9px', borderRadius: 6 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
            <pre style={{ margin: 0, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12.5, lineHeight: 1.6, color: c.text, whiteSpace: 'pre', overflowX: 'auto' }}>
              <code dangerouslySetInnerHTML={{ __html: highlightToHtml(artifact.content, artifact.language) }} />
            </pre>
          </div>
        </div>
      </div>
    )}


    <div style={{ height:'calc(100vh - 48px)', display:'flex', overflow:'hidden', background:c.page, position:'relative' }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes dot{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes agentslide{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
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
              <div style={{ opacity:0.4, marginBottom:8 }}><ChatIcon size={28} /></div>
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
            {!mobile && <span style={{ fontSize:12, color:c.textMuted }}>Beta — for a QS-checked BOQ, use Submit Drawings</span>}
            {!mobile && currentTakeoffId && <TakeoffBanner/>}
          </div>
          {quotaInfo && quotaInfo.messages_limit > 0 && (() => {
            const used = quotaInfo.messages_used || 0;
            const limit = quotaInfo.messages_limit || 0;
            const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
            const atLimit = limit > 0 && used >= limit;
            const low = !atLimit && (limit - used) <= 5;
            const pillColor = atLimit ? '#EF4444' : low ? '#F59E0B' : c.textMuted;
            return (
              <div title={`${used} of ${limit} messages used`} style={{
                display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:8, flexShrink:0,
                background: atLimit ? 'rgba(239,68,68,0.08)' : low ? 'rgba(245,158,11,0.06)' : 'transparent',
                border: `1px solid ${atLimit ? 'rgba(239,68,68,0.2)' : low ? 'rgba(245,158,11,0.15)' : c.topBorder}`,
              }}>
                <svg width="12" height="12" fill="none" stroke={pillColor} strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                <span style={{ fontSize:11, fontWeight:600, color:pillColor, whiteSpace:'nowrap' }}>
                  {mobile ? `${used}/${limit}` : `${used} / ${limit} messages`}
                </span>
                <div style={{ width: mobile ? 30 : 50, height:3, borderRadius:3, background: dark ? '#1E293B' : '#E2E8F0', overflow:'hidden', flexShrink:0 }}>
                  <div style={{ width:`${pct}%`, height:'100%', borderRadius:3, background: atLimit ? '#EF4444' : low ? '#F59E0B' : '#3B82F6', transition:'width 0.3s ease' }}/>
                </div>
              </div>
            );
          })()}
          <button onClick={newChat} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:8, flexShrink:0, background:'transparent', border:`1px solid ${c.topBorder}`, color:c.textMuted, fontSize:12.5, fontWeight:500, cursor:'pointer' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>
            {!mobile && 'New'}
          </button>
        </div>

        {/* Chat body */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0, background:c.chat }} onDragOver={e=>e.preventDefault()} onDrop={onDrop}>

          {/* Messages */}
          <div ref={msgsRef} className="msgs" style={{ flex:1, overflowY:'auto', padding: mobile?'16px 12px':'24px 28px', display:'flex', flexDirection:'column', alignItems:'center' }}>
            {/* Centred readable column — claude.ai-style fixed measure so the
                thread doesn't sprawl on wide monitors. 860 keeps the editable
                BOQ table comfortable; dial toward 768 for a tighter text measure. */}
            <div style={{ width:'100%', maxWidth:860, flex:1, display:'flex', flexDirection:'column', gap:18, minHeight:0 }}>

            {messages.length === 0 && (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, textAlign:'center', padding:'0 16px' }}>
                <div style={{ width:68, height:68, borderRadius:18, background:dark?'#0F1520':'#F1F5F9', border:`1px solid ${c.topBorder}`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:18 }}><RulerIcon size={30} /></div>
                <h3 style={{ fontSize: mobile?17:20, fontWeight:700, color:c.text, margin:'0 0 8px' }}>AI Chat — beta</h3>
                <p style={{ fontSize: mobile?13:14, color:c.textSub, margin:'0 0 14px', maxWidth:460, lineHeight:1.65 }}>
                  Ask questions, sense-check costs, or explore your drawings — the chat is still in its testing phase, so treat its numbers as a guide.
                </p>
                <div style={{
                  display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', justifyContent:'center',
                  padding:'12px 16px', borderRadius:10, margin:'0 0 24px', maxWidth:520,
                  background: dark ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.06)',
                  border:'1px solid rgba(245,158,11,0.25)',
                }}>
                  <span style={{ fontSize: mobile?12.5:13, color:c.text, lineHeight:1.55, flex:1, minWidth:220, textAlign:'left' }}>
                    Need a BOQ you can rely on? Submit your drawings and our QS team will deliver it back to your portal — typically within 24 hours.
                  </span>
                  <Link to="/submit-drawings" style={{
                    padding:'8px 14px', borderRadius:8, whiteSpace:'nowrap',
                    background:'linear-gradient(135deg,#F59E0B,#D97706)', color:'#0A0F1C',
                    textDecoration:'none', fontSize:12.5, fontWeight:700,
                  }}>
                    Submit Drawings
                  </Link>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', maxWidth:520 }}>
                  {[
                    [RulerIcon,'Extract quantities','Please extract all quantities from these drawings with full working shown.'],
                    [CoinsIcon,'Cost estimate','Can you give me a rough cost estimate for this project?'],
                    [AlertTriangleIcon,'Identify risks','What are the key risks or issues you can see?'],
                    [ClipboardIcon,'Building regs','What building regulations apply to this project?'],
                  ].map(([Ico,label,text],i) => (
                    <button key={i} className="chip" onClick={() => setInput(text)}
                      style={{ background:dark?'#0F1520':'#F8FAFC', border:`1px solid ${c.topBorder}`, borderRadius:10, padding:'9px 15px', fontSize:13, color:c.text, cursor:'pointer', transition:'all 0.15s' }}>
                      <Ico size={14} style={{ verticalAlign:'middle' }} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              // The BOQ table renders inline, anchored to the FIRST assistant
              // message that introduced a takeoff — so it stays put, and any
              // new messages (user edits, AI confirmations, further chat)
              // appear BELOW the table like a normal conversation thread.
              const firstTakeoffIdx = (() => {
                for (let j = 0; j < messages.length; j++) {
                  if (messages[j].takeoffId || messages[j].takeoff_id) return j;
                }
                return -1;
              })();
              const showBoqHere = i === firstTakeoffIdx && currentSessionId && currentTakeoffId && boqOpen;
              return (
                <React.Fragment key={i}>
                  <Message msg={msg} idx={i}/>
                  {i === firstTakeoffIdx && currentSessionId && currentTakeoffId && (
                    <div style={{ marginLeft: mobile ? 0 : 46, marginTop: -4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <button
                          onClick={() => setBoqOpen(v => !v)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: c.textSub, fontSize: 11, fontWeight: 600,
                            padding: '4px 0', fontFamily: 'inherit',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}
                        >
                          <span style={{ transform: boqOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', fontSize: 9 }}>▶</span>
                          {boqOpen ? 'Hide' : 'Show'} editable BOQ — click any quantity to adjust
                        </button>
                      </div>
                      {showBoqHere && (
                        <BoqTable
                          key={currentSessionId + '-' + boqRefreshKey}
                          sessionId={currentSessionId}
                          takeoffId={currentTakeoffId}
                          onRegenerate={() => handleSend(null, 'generate documents')}
                        />
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {/* While sending, show the progress stages OR the live streamed text. */}
            {/* If text is streaming, render it as the actual assistant bubble (with markdown + cursor). */}
            {sending && !streamingText && <Thinking/>}
            {sending && streamingText && (
              <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                <div style={{ width:34, height:34, borderRadius:10, background:c.avatarBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}><RulerIcon size={15} /></div>
                <div style={{ maxWidth:'100%', padding:'1px 0', background:'transparent', color:c.text, fontSize: mobile ? 13 : 14, lineHeight:1.65, wordBreak:'break-word' }}>
                  <Markdown
                    content={streamingText}
                    color={c.text}
                    mutedColor={c.textMuted}
                    borderColor={dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
                    mono="'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
                  />

                  {/* Live backend stage — shown once scope-analysis text is in
                      and the deterministic pipeline (extract → validate → price
                      → generate) is still working. Without this the user sees
                      only a pulsing cursor and can't tell if the system is
                      still doing something or has stalled. */}
                  {stage >= 2 && STAGES[stage] ? (
                    <div style={{
                      marginTop: 12, padding: '8px 12px', borderRadius: 8,
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.22)',
                      display: 'flex', alignItems: 'center', gap: 9,
                      fontSize: 12.5, color: c.amber, fontWeight: 500,
                    }}>
                      {ICONS[STAGES[stage].key](c.amber)}
                      <span style={{ flex: 1, lineHeight: 1.4 }}>
                        {stageDetail || STAGES[stage].text}
                      </span>
                      <span style={{ display: 'flex', gap: 3 }}>
                        {[0, 1, 2].map(d => (
                          <span key={d} style={{
                            width: 4, height: 4, borderRadius: '50%', background: c.amber,
                            animation: 'dot 1.4s infinite',
                            animationDelay: (d * 0.2) + 's',
                          }} />
                        ))}
                      </span>
                    </div>
                  ) : (
                    <span style={{ display:'inline-block', width:7, height:14, background:c.amber, marginLeft:2, verticalAlign:'text-bottom', animation:'pulse 1s infinite' }} />
                  )}
                </div>
              </div>
            )}

            {/* Stop button — visible only while a response is in flight */}
            {sending && (
              <div style={{ display:'flex', justifyContent:'center', marginTop:4 }}>
                <button
                  onClick={() => { try { abortRef.current?.abort(); } catch (e) {} setSending(false); }}
                  style={{
                    padding:'5px 14px', borderRadius:999,
                    background:'transparent', border:`1px solid ${c.chatBorder}`,
                    color:c.textMuted, fontSize:11.5, fontWeight:600,
                    cursor:'pointer', fontFamily:'inherit',
                    display:'inline-flex', alignItems:'center', gap:6,
                  }}
                >
                  <span style={{ width:8, height:8, background:c.error, borderRadius:2 }} />
                  Stop
                </button>
              </div>
            )}

            {/* BOQ Agent live panel — attached whenever there is a run in
                progress or a completed run for this chat. Pulls the live SSE
                stream, renders ETA, tool calls, takeoff items, downloads. */}
            {agentRunId && (
              <AgentPanel
                runId={agentRunId}
                onClose={() => setAgentRunId(null)}
                onCompleted={onAgentCompleted}
                onGenerate={() => handleSend(null, 'generate documents')}
              />
            )}

            <div ref={bottomRef}/>
            </div>
          </div>

          {/* File chips */}
          {files.length > 0 && (
            <div style={{ display:'flex', gap:8, padding:'8px 16px', background:dark?'#0D1117':'#F8FAFC', borderTop:`1px solid ${c.chatBorder}`, overflowX:'auto', flexShrink:0 }}>
              {files.map((f,i) => {
                const FIco = fileIcon(f.name);
                return (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:6, background:c.chipBg, border:`1px solid ${c.chipBorder}`, borderRadius:10, padding:'5px 10px', fontSize:12, color:c.text, whiteSpace:'nowrap' }}>
                  <span><FIco size={14} /></span>
                  <span style={{ maxWidth:120, overflow:'hidden', textOverflow:'ellipsis' }}>{f.name}</span>
                  <span style={{ color:c.textMuted }}>{fmtSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} style={{ background:'none', border:'none', color:c.textMuted, cursor:'pointer', fontSize:16, padding:'0 0 0 4px', lineHeight:1 }}>×</button>
                </div>
                );
              })}
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
              <textarea ref={inputRef} className="ta" value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
                placeholder={
                  currentTakeoffId && takeoffStatus === 'confirmed'
                    ? 'Quantities locked — say "generate documents" or ask to adjust...'
                    : currentTakeoffId
                    ? 'Review quantities above — say "confirm" to lock, or ask to adjust...'
                    : files.length > 0
                      ? 'Scope notes (optional) — press Send to run Atlas on these drawings...'
                      : 'Upload drawings or ask a QS question...'
                }
                rows={1} disabled={sending}
                style={{ flex:1, background:'transparent', border:'none', padding:'6px 4px', fontSize:14, color:c.text, resize:'none', outline:'none', fontFamily:'inherit', lineHeight:1.55, maxHeight:140 }}/>
              <button type="submit" disabled={sending || agentStarting || (!input.trim() && files.length === 0)}
                title={files.length > 0 && !currentTakeoffId && !agentRunId ? 'Run Atlas on uploaded files (3-6 min)' : 'Send'}
                style={{ background:c.accent, border:'none', borderRadius:10, padding:'8px 10px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, opacity: sending||agentStarting||(!input.trim()&&files.length===0)?0.35:1, transition:'opacity 0.15s' }}>
                {agentStarting
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={readableOn(c.accent)} strokeWidth="2.2"><circle cx="12" cy="12" r="9" strokeDasharray="42" strokeDashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>
                  : <svg width="18" height="18" fill="none" stroke={readableOn(c.accent)} strokeWidth="2.2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>}
              </button>
            </form>
            <div style={{ fontSize:11, color:c.textMuted, textAlign:'center', marginTop:7 }}>
              {currentTakeoffId && takeoffStatus === 'confirmed'
                ? `Takeoff locked (${currentTakeoffId.slice(0,12)}) · Total is deterministic · Say "generate documents" to produce files`
                : currentTakeoffId
                ? `Draft takeoff (${currentTakeoffId.slice(0,12)}) · Review quantities then say "confirm" to lock`
                : files.length > 0
                  ? 'Send runs Atlas — inspects every drawing, prices, generates Excel + Word (3-6 min)'
                  : 'Drag & drop · ZIP, PDF, Excel, PNG supported · Upload + Send = Atlas'}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_BASE, getToken, apiFetch, authedFetch } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { announceDataChanged } from '../../hooks/useDataChanged';
import useMaxVoice, { shortenForSpeech } from '../../hooks/useMaxVoice';
import { MAX_OPEN_EVENT, fmtMoney2, fmtMoney0 } from '../../utils/max';
import { saveBlob } from '../../native/saveFile';
import { isNative } from '../../native/platform';
import MaxCharacter from './MaxCharacter';
import { useToast } from '../../ui';
import {
  XIcon, ArrowRightIcon, CheckIcon, AlertTriangleIcon, RefreshIcon, ChevronRightIcon, MicIcon, MicOffIcon,
  Volume2Icon, VolumeXIcon, SparklesIcon, BrainIcon, MessageIcon, ShieldCheckIcon, UploadIcon,
} from '../Icons';

// ═══ MAX — the AI estimator and assistant, on every signed-in screen ════════
// Talk or type — "price a 20 m² patio using my usual rates", "where's the
// Anderson job up to?", "my skim rate is £22 a metre" — and it happens: the
// server runs the tools, streams back what it did, shows result cards, and
// tells this panel which page to open and which lists to refresh. Sending an
// estimate to a customer or deleting comes back as an APPROVAL CARD stating
// exactly what will happen; only a tap on Approve sends `approve: true`.
//
// Open it from anywhere:  openMax({ prompt: 'Price a …', send: true })
// Keyboard: ⌘J / Ctrl+J toggles, Esc closes. Full screen on a phone, a side
// panel on a desktop — same component, same thread.

// The thread is kept per ACCOUNT. It used to sit under one shared key, so
// signing out and into another account in the same tab showed the previous
// account's conversation — and sent it to the server as this account's
// history, customer names and all.
const LEGACY_THREAD_KEY = 'aiqs_max_thread';
const threadKey = (userId) => 'aiqs_max_thread_' + (userId || 'none');
const THREAD_VERSION = 2;
const OPEN_KEY = 'aiqs_max_open';

function newThreadId() { return 'mx_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function loadThread(userId) {
  try {
    sessionStorage.removeItem(LEGACY_THREAD_KEY);
    if (!userId) return null;
    const raw = sessionStorage.getItem(threadKey(userId));
    if (!raw) return null;
    const t = JSON.parse(raw);
    // `owner` is checked as well as the key: a thread is only ever restored
    // for the account that wrote it.
    if (!t || t.v !== THREAD_VERSION || t.owner !== userId || !Array.isArray(t.items) || !Array.isArray(t.transcript)) return null;
    return t;
  } catch (e) { return null; }
}
function saveThread(userId, items, transcript, threadId) {
  if (!userId) return;
  try {
    const slim = items.slice(-80).map((it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it)).filter((it) => !(it.kind === 'assistant' && !it.text));
    sessionStorage.setItem(threadKey(userId), JSON.stringify({ v: THREAD_VERSION, owner: userId, items: slim, transcript, threadId }));
  } catch (e) { /* storage blocked: the thread lives for this page only */ }
}

const isPhone = () => !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
const EXT_TONE = { pdf: 'pdf', dwg: 'cad', dxf: 'cad', xlsx: 'xls', xls: 'xls', csv: 'xls', jpg: 'img', jpeg: 'img', png: 'img', docx: 'doc' };
const TYPE_LABEL = { job: 'JOB', drawing: 'DWG', deliverable: 'FILE', boq: 'BOQ', estimate: 'EST' };

// Read a fetch() body that carries server-sent events, one JSON object per
// `data:` line, and hand each to onEvent.
async function readEvents(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line) => {
    if (!line.startsWith('data: ')) return;
    let evt;
    try { evt = JSON.parse(line.slice(6)); } catch (e) { return; }
    onEvent(evt);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(handle);
  }
  if (buffer) handle(buffer);
}

function Md({ text }) {
  return (
    <div className="max-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ node, href, children, ...p }) => <a {...p} href={href} target={/^https?:/.test(href || '') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>,
        h1: ({ node, ...p }) => <strong {...p} />, h2: ({ node, ...p }) => <strong {...p} />, h3: ({ node, ...p }) => <strong {...p} />,
      }}>{text || ''}</ReactMarkdown>
    </div>
  );
}

// ── Result cards (find) ──────────────────────────────────────────────────────
function ResultCard({ item, onOpen }) {
  const ext = (item.file && item.file.original_name ? item.file.original_name.split('.').pop() : item.ext || '').toLowerCase();
  const badgeTone = EXT_TONE[ext] || (item.type === 'job' || item.type === 'estimate' ? 'rec' : null);
  return (
    <button type="button" className="max-result" onClick={() => onOpen(item)}>
      <span className={'max-result__badge' + (badgeTone ? ' max-result__badge--' + badgeTone : '')}>{ext && EXT_TONE[ext] ? ext.toUpperCase() : (TYPE_LABEL[item.type] || 'OPEN')}</span>
      <span className="max-result__body">
        <span className="max-result__title">{item.title}</span>
        {(item.subtitle || item.job) && <span className="max-result__meta">{[item.subtitle, item.job && item.subtitle && !item.subtitle.includes(item.job) ? item.job : null].filter(Boolean).join(' · ')}</span>}
      </span>
      {item.amount != null && item.amount !== '' && <span className="max-result__figure">{fmtMoney2(item.amount)}</span>}
      <ChevronRightIcon size={15} className="max-result__chevron" />
    </button>
  );
}

// ── The estimate MAX just drafted ───────────────────────────────────────────
function EstimateCard({ item, onOpen, onNavigate }) {
  const v = item.verdict || {};
  const status = String(item.status || 'draft');
  const brief = item.title || 'Estimate';
  return (
    <div className="max-estimate" role="group" aria-label={'Estimate ' + (item.quote_number || '')}>
      <div className="max-estimate__eyebrow">{item.fresh ? 'Draft estimate' : status} · {item.quote_number}</div>
      <div className="max-estimate__title">{brief}</div>
      {item.subtitle && <div className="max-estimate__sub">{item.subtitle}</div>}
      <div className="max-estimate__money">
        <div className="max-estimate__fig max-estimate__fig--hero"><div className="max-estimate__fig-k">Price ex VAT</div><div className="max-estimate__fig-v">{fmtMoney2(item.price_ex_vat, item.currency)}</div></div>
        <div className="max-estimate__fig"><div className="max-estimate__fig-k">Total inc VAT{item.vat_pct != null ? ' (' + item.vat_pct + '%)' : ''}</div><div className="max-estimate__fig-v">{fmtMoney2(item.grand_total, item.currency)}</div></div>
      </div>
      <div className="max-estimate__rates">
        <span className="max-estimate__pill">{item.line_count} line{item.line_count === 1 ? '' : 's'}</span>
        {item.coverage_pct != null && <span className={'max-estimate__pill' + (item.coverage_pct >= 90 ? ' max-estimate__pill--own' : '')}>{Math.round(item.coverage_pct)}% from your rates & the library</span>}
        {item.estimated_lines > 0 && <span className="max-estimate__pill max-estimate__pill--est">{item.estimated_lines} estimated rate{item.estimated_lines === 1 ? '' : 's'} to check</span>}
      </div>
      {v.status === 'notice' && (
        <div className="max-estimate__warn"><AlertTriangleIcon size={15} /><span>At {fmtMoney0(v.price_ex_vat, item.currency)} ex VAT this is above {fmtMoney0(v.notice_gbp)}. The estimate stands, but a full take-off by the AI QS team is worth considering before it goes to your customer.</span></div>
      )}
      {Array.isArray(item.assumptions) && item.assumptions.length > 0 && (
        <ul className="max-estimate__list">{item.assumptions.slice(0, 3).map((a, i) => <li key={i}>{a}</li>)}{item.assumptions.length > 3 && <li>…and {item.assumptions.length - 3} more on the estimate</li>}</ul>
      )}
      {Array.isArray(item.missing_info) && item.missing_info.length > 0 && (
        <div className="max-estimate__note">Worth confirming: {item.missing_info.join(' ')}</div>
      )}
      <div className="max-estimate__actions">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--md" onClick={() => onOpen(item.open_path)}>Open estimate <ArrowRightIcon size={14} /></button>
        {v.status === 'notice' && <button type="button" className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => onNavigate('/submit-drawings?from=max&estimate=' + encodeURIComponent(item.id))}><UploadIcon size={14} /> Send to the AI QS team</button>}
      </div>
    </div>
  );
}

// ── Over the limit: MAX stops and offers the team ──────────────────────────
function OverLimitCard({ item, onNavigate }) {
  return (
    <div className="max-estimate max-overlimit" role="group" aria-label="Over the small-job limit">
      <div className="max-estimate__eyebrow"><AlertTriangleIcon size={11} /> Over the small-job limit — no estimate made</div>
      <div className="max-estimate__title">{item.title || 'This job'} needs a full take-off</div>
      <div className="max-overlimit__big">{fmtMoney0(item.rough_price_ex_vat, item.currency)}<small>rough, ex VAT — not a price to quote</small></div>
      <div className="max-estimate__note">MAX prices jobs under {fmtMoney0(item.limit_gbp)} ex VAT. This one is at or above that, so it goes to the AI QS team: attach your drawings and brief and they price it properly, usually within 24 hours.</div>
      <div className="max-estimate__actions">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--md" onClick={() => onNavigate(item.submit_path || '/submit-drawings')}><UploadIcon size={14} /> Send to the AI QS team</button>
      </div>
    </div>
  );
}

// ── The approval card: exactly what will happen, then Approve / Cancel ─────
function ApprovalCard({ it, busy, onAnswer }) {
  const card = it.card || {};
  const editable = it.editable || [];
  const [edits, setEdits] = useState(() => Object.fromEntries(editable.map((k) => [k, card[k] || ''])));
  const settled = it.state !== 'open';
  const Row = ({ k, v, money }) => (v == null || v === '' ? null : <><span className="max-approve__k">{k}</span><span className={'max-approve__v' + (money ? ' max-approve__v--money' : '')}>{v}</span></>);
  const eyebrow = { send: 'Send', delete: 'Delete', money: 'Money' }[card.kind] || 'Approval';
  const LABEL = { client_email: 'Send to (email)' };
  return (
    <div className={'max-approve' + (settled ? ' max-approve--settled' : '')} role="group" aria-label={'Approval: ' + it.title}>
      <div className="max-approve__head">
        <span className="max-approve__eyebrow"><ShieldCheckIcon size={12} /> {eyebrow} — needs your approval</span>
      </div>
      <div className="max-approve__title">{it.title}</div>
      {it.detail && <div className="max-approve__detail">{it.detail}</div>}
      {card.kind === 'send' && (
        <div className="max-approve__rows">
          <Row k="What" v={card.what} />
          {!editable.includes('client_email') && <Row k="To" v={card.to} />}
          <Row k="Customer" v={card.customer} />
          <Row k="Ex VAT" v={card.amount_ex_vat != null ? fmtMoney2(card.amount_ex_vat) : null} money />
          <Row k="Inc VAT" v={card.amount_inc_vat != null ? fmtMoney2(card.amount_inc_vat) : null} money />
        </div>
      )}
      {card.kind === 'delete' && <div className="max-approve__rows"><Row k="Delete" v={card.what} /><Row k="Value" v={card.amount_inc_vat != null ? fmtMoney2(card.amount_inc_vat) + ' inc VAT' : null} money /></div>}
      {card.kind === 'money' && (
        <>
          <div className="max-approve__rows"><Row k="Action" v={card.action} /><Row k="Customer" v={card.customer} /><Row k="Basis" v={card.basis} /><Row k="Ex VAT" v={card.amount_ex_vat != null ? fmtMoney2(card.amount_ex_vat) : null} money /></div>
          {card.amount_inc_vat != null && <div className="max-approve__total"><span>Total inc VAT</span><span>{fmtMoney2(card.amount_inc_vat)}</span></div>}
        </>
      )}
      {it.state === 'open' && editable.map((k) => (
        <label key={k} style={{ display: 'block' }}>
          <span className="max-approve__k" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{LABEL[k] || k}</span>
          <input className="max-approve__edit" value={edits[k] || ''} onChange={(e) => setEdits((d) => ({ ...d, [k]: e.target.value }))} placeholder={k === 'client_email' ? 'customer@example.com' : ''} inputMode={k === 'client_email' ? 'email' : undefined} />
        </label>
      ))}
      {it.state !== 'open' && editable.includes('client_email') && <div className="max-approve__rows"><Row k="To" v={(it.card && it.card.client_email) || card.to} /></div>}
      {card.note && <div className="max-approve__note">{card.note}</div>}
      {it.state === 'open' ? (
        <div className="max-approve__actions">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--md" disabled={busy} onClick={() => onAnswer(it, true, editable.length ? edits : null)}><CheckIcon size={16} /> Approve</button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--md" disabled={busy} onClick={() => onAnswer(it, false)}>Cancel</button>
        </div>
      ) : (
        <div className="max-approve__verdict">{it.state === 'yes' ? 'Approved — you tapped Approve.' : it.state === 'no' ? 'Cancelled.' : 'Skipped.'}</div>
      )}
    </div>
  );
}

export default function MaxPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; } });
  const userId = user ? user.id : null;
  const userIdRef = useRef(userId);
  const [items, setItems] = useState(() => (loadThread(userId) || { items: [] }).items);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatusInfo] = useState(null);   // /max/status
  const [voiceTurn, setVoiceTurn] = useState(false);
  const transcriptRef = useRef((loadThread(userId) || { transcript: [] }).transcript);
  const threadIdRef = useRef((loadThread(userId) || {}).threadId || newThreadId());
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const sendRef = useRef(null);
  const spokenRef = useRef({ got: false, reply: '' });
  const voiceTurnRef = useRef(false);

  const allowed = !!user && !!user.maxEnabled;
  // No floating button where the page already has its own way in: the
  // drawings chat composer, and the estimate editor's "Ask MAX to change it".
  // No floating button where the page has its own pinned bar or microphone:
  // the chat composer, an estimate's sticky total, a room survey's capture flow.
  const hideFab = location.pathname.startsWith('/chat') || /^\/estimates\/[^/]+/.test(location.pathname) || /^\/surveys\/[^/]+\/rooms\//.test(location.pathname);

  // ── Items ─────────────────────────────────────────────────────────────────
  const update = useCallback((fn) => {
    setItems((prev) => {
      const next = fn(prev);
      saveThread(userIdRef.current, next, transcriptRef.current, threadIdRef.current);
      return next;
    });
  }, []);

  const appendText = useCallback((delta) => {
    update((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [...prev, { kind: 'assistant', text: delta, streaming: true, id: Date.now() + Math.random() }];
    });
  }, [update]);

  // ── Voice ─────────────────────────────────────────────────────────────────
  const voice = useMaxVoice({
    onFinal: (text) => { voiceTurnRef.current = true; setVoiceTurn(true); if (sendRef.current) sendRef.current(text, { voice: true }); },
    onError: (msg) => toast.error(msg),
  });

  const speakReply = useCallback((text, spokenVersion) => {
    if (!voiceTurnRef.current || voice.muted) return;
    const say = spokenVersion || shortenForSpeech(text);
    if (!say) return;
    voice.speak(say, { then: voice.conversation ? () => voice.startListening() : null });
  }, [voice]);

  const openPath = useCallback((path) => {
    navigate(path);
    if (isPhone()) setOpen(false);
  }, [navigate]);

  const handleEvent = useCallback((evt) => {
    switch (evt.type) {
      case 'text': appendText(evt.delta || ''); break;
      case 'tool_start':
        update((prev) => [...prev.map((it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it)), { kind: 'action', id: Date.now() + Math.random(), name: evt.name, label: evt.label, read: !!evt.read, status: 'running' }]);
        break;
      case 'tool_done':
        update((prev) => {
          const idx = [...prev].reverse().findIndex((it) => it.kind === 'action' && it.name === evt.name && it.status === 'running');
          const card = { kind: 'action', id: Date.now() + Math.random(), name: evt.name, label: evt.label, read: !!evt.read, status: evt.declined ? 'declined' : (evt.ok ? 'done' : 'failed'), summary: evt.summary || null, error: evt.error || null, path: evt.path || null };
          if (idx === -1) return [...prev, card];
          const at = prev.length - 1 - idx;
          return [...prev.slice(0, at), { ...prev[at], ...card, id: prev[at].id }, ...prev.slice(at + 1)];
        });
        break;
      case 'cards':
        if (Array.isArray(evt.items) && evt.items.length) update((prev) => [...prev, { kind: 'cards', id: Date.now() + Math.random(), items: evt.items, tool: evt.tool }]);
        break;
      case 'navigate':
        if (evt.path) { navigate(evt.path); }
        break;
      case 'refresh':
        announceDataChanged(evt.scopes || []);
        break;
      case 'confirm':
        update((prev) => [...prev.map((it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it)), { kind: 'confirm', id: Date.now() + Math.random(), token: evt.token, tool: evt.tool, title: evt.title, detail: evt.detail || '', card: evt.card || null, amount: evt.amount || 0, editable: evt.editable || [], state: 'open' }]);
        if (voiceTurnRef.current) spokenRef.current.confirm = String(evt.title || 'Ready to go').replace(/\?$/, '') + '. Tap Approve on the card to go ahead — I can\'t take a yes by voice.';
        break;
      case 'sources':
        if (Array.isArray(evt.items) && evt.items.length) update((prev) => [...prev, { kind: 'sources', id: Date.now() + Math.random(), items: evt.items }]);
        break;
      case 'memories':
        if (Array.isArray(evt.items) && evt.items.length) update((prev) => [...prev, { kind: 'memories', id: Date.now() + Math.random(), items: evt.items }]);
        break;
      case 'spoken':
        spokenRef.current.got = true;
        speakReply(spokenRef.current.reply, evt.text);
        break;
      case 'error':
        update((prev) => [...prev.map((it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it)), { kind: 'assistant', id: Date.now() + Math.random(), text: evt.message || 'Something went wrong.', tone: 'error', streaming: false }]);
        break;
      case 'done':
        if (Array.isArray(evt.messages)) transcriptRef.current = evt.messages;
        spokenRef.current.reply = evt.reply || '';
        update((prev) => prev.map((it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it)).filter((it) => !(it.kind === 'assistant' && !it.text)));
        setBusy(false);
        break;
      default: break;
    }
  }, [appendText, navigate, update, speakReply]);

  const stream = useCallback(async (path, body) => {
    setBusy(true);
    spokenRef.current = { got: false, reply: '', confirm: null };
    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(API_BASE + '/max/' + path, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok || !/event-stream/.test(res.headers.get('content-type') || '')) {
        let msg = 'MAX could not be reached. Try again in a moment.';
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* not json */ }
        handleEvent({ type: 'error', message: msg });
        handleEvent({ type: 'done', messages: null });
        return;
      }
      await readEvents(res, handleEvent);
      handleEvent({ type: 'done', messages: null });
      if (voiceTurnRef.current) {
        if (spokenRef.current.confirm) voice.speak(spokenRef.current.confirm);
        else if (!spokenRef.current.got && spokenRef.current.reply) speakReply(spokenRef.current.reply, null);
      }
    } catch (e) {
      handleEvent({ type: 'error', message: 'Lost the connection — check your signal and try again.' });
      handleEvent({ type: 'done', messages: null });
    } finally {
      setBusy(false);
    }
  }, [handleEvent, speakReply, voice]);

  const send = useCallback((text, opts) => {
    const t = String(text || '').trim();
    if (!t || busy) return;
    const byVoice = !!(opts && opts.voice);
    voiceTurnRef.current = byVoice;
    setVoiceTurn(byVoice);
    setInput('');
    update((prev) => [...prev.map((it) => (it.kind === 'confirm' && it.state === 'open' ? { ...it, state: 'skipped' } : it)), { kind: 'user', id: Date.now() + Math.random(), text: t, voice: byVoice }]);
    stream('chat', { message: t, messages: transcriptRef.current, context: { path: location.pathname, threadId: threadIdRef.current, voice: byVoice } });
  }, [busy, location.pathname, stream, update]);
  sendRef.current = send;

  // Only the Approve button's click reaches here with approve=true.
  const answer = useCallback((it, approve, edits) => {
    if (busy) return;
    update((prev) => prev.map((x) => (x.kind === 'confirm' && x.token === it.token ? { ...x, state: approve ? 'yes' : 'no', card: edits ? { ...x.card, ...edits } : x.card } : x)));
    stream('confirm', { token: it.token, approve: approve === true, edits: approve && edits ? edits : undefined });
  }, [busy, stream, update]);

  // "Open" on a card. Files are fetched with the builder's token and opened or
  // saved; records open their page.
  const openItem = useCallback(async (item) => {
    if (item.file && item.file.url) {
      try {
        const r = await authedFetch(item.file.url);
        if (!r.ok) throw new Error('Could not fetch the file.');
        const blob = await r.blob();
        const name = item.file.original_name || item.title || 'file';
        if (!isNative() && /pdf|image/.test(blob.type || '')) {
          const u = URL.createObjectURL(blob);
          window.open(u, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(u), 60000);
        } else {
          await saveBlob(blob, name);
        }
      } catch (e) {
        toast.error(e.message || 'Could not open that file.');
      }
      return;
    }
    if (item.open_path) openPath(item.open_path);
  }, [openPath, toast]);

  const reset = () => {
    voice.stopSpeaking();
    transcriptRef.current = [];
    threadIdRef.current = newThreadId();
    update(() => []);
    try { sessionStorage.removeItem(threadKey(userIdRef.current)); } catch (e) { /* fine */ }
  };

  // A different account signed in without the page reloading: drop what is
  // on screen and in the outgoing transcript, and pick up that account's own
  // thread (normally none).
  useEffect(() => {
    if (userIdRef.current === userId) return;
    userIdRef.current = userId;
    const t = loadThread(userId);
    transcriptRef.current = t ? t.transcript : [];
    threadIdRef.current = (t && t.threadId) || newThreadId();
    setItems(t ? t.items : []);
    setOpen(false);
  }, [userId]);

  // ── Opening, closing, keyboard, outside requests ─────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = (e) => {
      const d = (e && e.detail) || {};
      if (d.open === false) { setOpen(false); return; }
      setOpen(true);
      if (d.prompt) {
        if (d.send) setTimeout(() => sendRef.current && sendRef.current(d.prompt), 50);
        else setInput(String(d.prompt));
      }
      if (d.voice) setTimeout(() => voice.startListening(), 120);
      if (d.keyboard || (d.prompt && !d.send)) setTimeout(() => inputRef.current && inputRef.current.focus(), 120);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(MAX_OPEN_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(MAX_OPEN_EVENT, onOpen); };
  }, [voice]);

  // Only `open` should re-run this: the voice object is stable for the panel's
  // lifetime, and re-running on its state changes would stop a reply mid-word.
  const voiceRef = useRef(voice); voiceRef.current = voice;
  useEffect(() => {
    try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) { /* fine */ }
    if (!open) { voiceRef.current.stopSpeaking(); voiceRef.current.stopListening(); return undefined; }
    if (!isPhone()) { const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 60); return () => clearTimeout(t); }
    return undefined;
  }, [open]);

  // An empty thread opens on suggestions for this page and the small-job limits.
  useEffect(() => {
    if (!open || !allowed) return undefined;
    let gone = false;
    Promise.allSettled([
      apiFetch('/max/suggestions?path=' + encodeURIComponent(location.pathname)),
      apiFetch('/max/status'),
    ]).then(([s, st]) => {
      if (gone) return;
      setSuggestions(s.status === 'fulfilled' ? ((s.value && s.value.suggestions) || []) : []);
      if (st.status === 'fulfilled' && st.value) setStatusInfo(st.value);
    });
    return () => { gone = true; };
  }, [open, allowed, location.pathname]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, open, voice.interim]);

  if (!allowed) return null;

  const firstName = (user.fullName || '').split(' ')[0];
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };
  const state = voice.listening ? 'listening' : voice.transcribing ? 'thinking' : voice.speaking ? 'speaking' : busy ? 'working' : 'ready';
  const stateText = { listening: 'Listening…', thinking: 'Got it — one sec…', speaking: 'Speaking', working: 'Working on it…', ready: 'Ready' }[state];
  const limits = status && status.limits;

  return (
    <>
      {!open && !hideFab && (
        <button type="button" className="max-fab" onClick={() => setOpen(true)} aria-label="Open MAX, your AI estimator" data-tour="max-fab" title="MAX — ⌘J">
          <MicIcon size={20} />
          <span className="max-fab__label">Ask MAX</span>
        </button>
      )}

      {open && (
        <section className="max" role="dialog" aria-label="MAX, your AI estimator" data-tour="max">
          <header className="max__head">
            <span className="max__head-art"><MaxCharacter size={34} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="max__title">MAX</div>
              <div className={'max__status max__status--' + state}><span className="max__status-dot" aria-hidden="true" />{stateText}</div>
            </div>
            {voice.supported && (
              <button type="button" className={'max__icon' + (voice.conversation ? ' max__icon--on' : '')} onClick={() => voice.setConversation(!voice.conversation)} aria-pressed={voice.conversation} aria-label={voice.conversation ? 'Conversation mode on — MAX listens after each reply' : 'Conversation mode off'} title={voice.conversation ? 'Conversation mode: on' : 'Conversation mode: off'}><MessageIcon size={16} /></button>
            )}
            <button type="button" className={'max__icon' + (voice.muted ? ' max__icon--on' : '')} onClick={() => { if (!voice.muted) voice.stopSpeaking(); voice.setMuted(!voice.muted); }} aria-pressed={voice.muted} aria-label={voice.muted ? 'MAX is muted — tap to unmute' : 'Mute MAX\'s voice'} title={voice.muted ? 'Unmute' : 'Mute'}>{voice.muted ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />}</button>
            {items.length > 0 && (
              <button type="button" className="max__icon" onClick={reset} aria-label="Start a new conversation" title="New conversation" disabled={busy}><RefreshIcon size={16} /></button>
            )}
            <button type="button" className="max__icon" onClick={() => setOpen(false)} aria-label="Close"><XIcon size={18} /></button>
          </header>

          <div className="max__list" ref={listRef}>
            {items.length === 0 && (
              <div className="max__empty">
                <p>{firstName ? 'Hello ' + firstName + '. ' : ''}Tell me the job and its size and I'll price it from your rates — or ask about your drawings jobs, your rates, or a file.</p>
                {limits && <div className="max__limits">I price small jobs up to {fmtMoney0(limits.limit_gbp)} ex VAT. Anything bigger goes to the AI QS team for a full take-off — I'll tell you when that's the case.</div>}
                {suggestions.length > 0 && (
                  <div className="max__chips">
                    {suggestions.map((s) => (
                      <button key={s} type="button" className="max-chip" onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {items.map((it) => {
              if (it.kind === 'user') return <div key={it.id} className="max-msg max-msg--user">{it.voice && <MicIcon size={12} style={{ marginRight: 6, verticalAlign: '-2px', opacity: 0.8 }} />}{it.text}</div>;
              if (it.kind === 'assistant') {
                return (
                  <div key={it.id} className={'max-msg max-msg--max' + (it.tone === 'error' ? ' max-msg--error' : '')}>
                    <Md text={it.text} />
                    {it.streaming && <span className="max-caret" aria-hidden="true" />}
                  </div>
                );
              }
              if (it.kind === 'action' && it.read && it.status !== 'failed') {
                return (
                  <div key={it.id} className={'max-step' + (it.status === 'running' ? ' max-step--running' : '')}>
                    {it.status === 'running' ? <span className="max-spinner" aria-hidden="true" /> : <CheckIcon size={13} />}
                    <span>{it.label}{it.status === 'running' ? '…' : ''}</span>
                  </div>
                );
              }
              if (it.kind === 'action') {
                const done = it.status === 'done';
                return (
                  <div key={it.id} className={'max-card max-card--' + it.status}>
                    <span className="max-card__icon">
                      {it.status === 'running' && <span className="max-spinner" aria-hidden="true" />}
                      {done && <CheckIcon size={15} />}
                      {(it.status === 'failed' || it.status === 'declined') && <AlertTriangleIcon size={15} />}
                    </span>
                    <span className="max-card__body">
                      <span className="max-card__title">{done ? (it.summary || it.label) : (it.status === 'running' ? it.label + '…' : (it.status === 'declined' ? 'Not done — you cancelled' : (it.label + ' didn\'t work')))}</span>
                      {it.status === 'failed' && it.error && <span className="max-card__detail">{it.error}</span>}
                    </span>
                    {done && it.path && !/^\/estimates\//.test(it.path) && (
                      <button type="button" className="max-card__open" onClick={() => openPath(it.path)}>Open <ChevronRightIcon size={14} /></button>
                    )}
                  </div>
                );
              }
              if (it.kind === 'cards') {
                return (
                  <div key={it.id} className="max-results">
                    {it.items.map((c, i) => {
                      if (c.type === 'estimate') return <EstimateCard key={'e' + c.id + i} item={c} onOpen={openPath} onNavigate={openPath} />;
                      if (c.type === 'over_limit') return <OverLimitCard key={'o' + i} item={c} onNavigate={openPath} />;
                      return <ResultCard key={c.type + c.id + i} item={c} onOpen={openItem} />;
                    })}
                  </div>
                );
              }
              if (it.kind === 'confirm') return <ApprovalCard key={it.id} it={it} busy={busy} onAnswer={answer} />;
              if (it.kind === 'sources') {
                return <div key={it.id} className="max-sources">{it.items.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>{s.title || s.url}</a>)}</div>;
              }
              if (it.kind === 'memories') {
                return (
                  <Link key={it.id} to="/ai-memory" className="max-memory" title="What MAX remembers about you">
                    <BrainIcon size={13} /> Remembered: {it.items.map((m) => m.content).join(' · ').slice(0, 120)}
                  </Link>
                );
              }
              return null;
            })}
            {busy && !items.some((it) => (it.kind === 'assistant' && it.streaming) || (it.kind === 'action' && it.status === 'running')) && (
              <div className="max-msg max-msg--max max-msg--thinking"><span className="max-dots"><i /><i /><i /></span></div>
            )}
            {(voice.listening || voice.transcribing) && (
              <div className="max__listen" style={{ '--max-level': voice.level }} aria-live="polite">
                <span className="max__listen-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span className="max__listen-text">{voice.transcribing ? 'Writing that down…' : (voice.interim || 'Listening — talk to me, I\'ll stop when you pause.')}</span>
                {voice.listening && <button type="button" className="max__listen-stop" onClick={voice.stopListening}>Done</button>}
              </div>
            )}
          </div>

          <form className="max__composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            {voice.supported && (
              <button type="button"
                className={'max__mic' + (voice.listening ? ' max__mic--on' : '') + (voice.transcribing ? ' max__mic--busy' : '') + (voice.speaking ? ' max__mic--speaking' : '')}
                style={voice.listening ? { '--max-level': (4 + voice.level * 14) + 'px' } : undefined}
                onClick={() => { if (voice.speaking) { voice.stopSpeaking(); voice.startListening(); } else voice.toggleListening(); }}
                aria-pressed={voice.listening}
                aria-label={voice.listening ? 'Stop listening' : voice.speaking ? 'Interrupt MAX and talk' : 'Talk to MAX'}
                title={voice.listening ? 'Tap when done' : 'Talk to MAX'}>
                {voice.listening ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
              </button>
            )}
            <textarea ref={inputRef} className="max__input" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder={busy ? 'Working on it…' : voice.listening ? 'Listening…' : 'Describe the job, or ask MAX…'} aria-label="Type to MAX" />
            <button type="submit" className="max__send" disabled={busy || !input.trim()} aria-label="Send"><ArrowRightIcon size={18} /></button>
          </form>
          <div className="max__foot"><SparklesIcon size={11} /> Sending to a customer and deleting always wait for your tap. {voiceTurn && !voice.muted ? 'Replies are read aloud.' : ''}</div>
        </section>
      )}
    </>
  );
}

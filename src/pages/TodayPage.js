import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import ShareLinkModal from '../components/ShareLinkModal';
import { CheckCircleIcon, FileTextIcon, PoundIcon, ImageIcon, WrenchIcon } from '../components/Icons';
import HelpTip from '../components/HelpTip';

// TODAY — the Office in a Box home screen (/office).
// Glanceable in 5 seconds on a phone: three plain money numbers, the things
// that need chasing (each with ONE obvious action), four big buttons.
// Data loads on mount and silently refetches when the window regains focus —
// builders are never asked to refresh software.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt0(n) { return '£' + Math.round(num(n)).toLocaleString('en-GB'); }

const SEV_COLOUR = { high: '#EF4444', medium: '#F59E0B', low: '#94A3B8' };

export default function TodayPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const { user } = useAuth();
  const nav = useNavigate();

  const [money, setMoney] = useState(null);     // { owed, overdue, quoted }
  const [cards, setCards] = useState(null);     // PM alert cards
  const [error, setError] = useState('');
  const [nudge, setNudge] = useState(null);     // { url } share sheet for a quote follow-up
  // C2 — grounded Q&A over the builder's own data.
  const [thread, setThread] = useState([]);     // [{ role, content }]
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [agg, quotes, alerts, settings] = await Promise.all([
        apiFetch('/invoices/_aggregates/dashboard'),
        apiFetch('/estimator/quotes'),
        apiFetch('/pm/alerts'),
        apiFetch('/finance/settings').catch(() => null),
      ]);
      setNeedsSetup(!!settings && !settings.settings?.setup_completed_at);
      const quoted = (quotes.quotes || [])
        .filter(q => q.status === 'sent')
        .reduce((s, q) => s + num(q.grand_total), 0);
      setMoney({
        owed: num(agg.outstanding?.value),
        overdue: num(agg.overdue?.value),
        quoted,
      });
      setCards(alerts.cards || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load');
    }
  }, []);

  useEffect(() => {
    refresh();
    // Silent refetch whenever the builder comes back to the tab/app.
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const handleAction = async (card) => {
    const a = card.action;
    if (!a) { if (card.link) nav(card.link); return; }
    if (a.kind === 'nudge_quote') {
      try {
        const r = await apiFetch('/estimator/quotes/' + a.quote_id + '/share-url');
        setNudge({ url: window.location.origin + r.path });
      } catch (e) { alert(e.message); }
      return;
    }
    if (a.link) nav(a.link);
  };

  const ask = async (q) => {
    const text = (q || question).trim();
    if (!text || asking) return;
    setQuestion('');
    setThread(prev => [...prev, { role: 'user', content: text }]);
    setAsking(true);
    try {
      const r = await apiFetch('/pm/ask', {
        method: 'POST',
        body: JSON.stringify({ question: text, history: thread.slice(-6) }),
      });
      setThread(prev => [...prev, { role: 'assistant', content: r.answer }]);
    } catch (e) {
      setThread(prev => [...prev, { role: 'assistant', content: e.message || 'That didn\'t work — try again.' }]);
    } finally {
      setAsking(false);
    }
  };

  const firstName = (user?.fullName || '').split(' ')[0];

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
            <h1 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>Today <HelpTip t={t} title="Today" text={"Your home screen.\n\nThe three numbers at the top are your money position right now. Below that, anything that needs chasing — each card has one button that does the obvious thing.\n\nIt updates itself every time you come back to it. You never need to refresh."} /></h1>
            <div style={{ color: t.textSecondary, fontSize: 13.5, marginTop: 2 }}>{today}{firstName ? ' · ' + firstName : ''}</div>
          </div>
          {/* Always-available walkthrough — replays the guided tour on demand. */}
          <button
            onClick={() => window.dispatchEvent(new Event('aiqs:start-office-tour'))}
            style={{
              flexShrink: 0, marginTop: 4, minHeight: 38, padding: '0 14px', borderRadius: 999,
              background: 'rgba(245,158,11,0.1)', border: '1px solid ' + t.accent + '55',
              color: t.accent, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Show me around
          </button>
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 16 }}>{error}</div>}

      {/* B2 — first run: two minutes of set-up, never forced */}
      {needsSetup && (
        <button data-tour="oiab-setup" onClick={() => nav('/office/setup')} style={{
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          background: 'rgba(245,158,11,0.08)', border: '1px solid ' + t.accent + '66',
          borderRadius: 12, padding: '14px 16px', marginBottom: 16, color: t.text,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Two minutes of set-up</div>
          <div style={{ color: t.textSecondary, fontSize: 13.5, marginTop: 4 }}>
            Your name, your logo, your colour — then every quote and invoice goes out looking like yours. Tap to start.
          </div>
        </button>
      )}

      {/* The three numbers */}
      <div data-tour="oiab-money" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 22 }}>
        <BigNumber t={t} label="Owed to you" value={money ? fmt0(money.owed) : '—'} />
        <BigNumber t={t} label="Overdue" value={money ? fmt0(money.overdue) : '—'} tone={money && money.overdue > 0 ? 'danger' : undefined} />
        <BigNumber t={t} label="Quoted, awaiting answer" value={money ? fmt0(money.quoted) : '—'} />
      </div>

      {/* Ask about your jobs — answers come only from your own data */}
      <div data-tour="oiab-ask" style={{
        background: t.card, border: '1.5px solid ' + t.accent + '55', borderRadius: 12,
        padding: 16, marginBottom: 22, boxShadow: '0 2px 12px ' + t.accent + '14',
      }}>
        <style>{'@keyframes askDots{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}'}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: t.accent + '22', color: t.accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
          }}>✦</span>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Ask about your jobs</div>
        </div>
        <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 4, marginBottom: 12 }}>
          Answers come straight from your own quotes, jobs and invoices — nothing made up.
        </div>

        {thread.length === 0 && !asking && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {['Who owes me the most?', 'Am I making money on my jobs?', "What's still to invoice?"].map(sugg => (
              <button key={sugg} onClick={() => ask(sugg)} style={{
                minHeight: 38, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
                background: t.surface, color: t.textSecondary, border: '1px solid ' + t.border,
                fontSize: 12.5, fontWeight: 600,
              }}>{sugg}</button>
            ))}
          </div>
        )}

        {thread.map((m, i) => (
          <div key={i} style={{
            marginBottom: 8, padding: '10px 12px', borderRadius: 10, fontSize: 14, lineHeight: 1.55,
            background: m.role === 'user' ? t.surface : 'rgba(245,158,11,0.07)',
            border: '1px solid ' + (m.role === 'user' ? t.border : t.accent + '33'),
            color: t.text, whiteSpace: 'pre-wrap',
          }}>{m.role === 'user' ? m.content : renderAnswer(m.content)}</div>
        ))}

        {asking && (
          <div style={{
            marginBottom: 8, padding: '12px 14px', borderRadius: 10,
            background: 'rgba(245,158,11,0.07)', border: '1px solid ' + t.accent + '33',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              {[0, 1, 2].map(d => (
                <span key={d} style={{
                  width: 7, height: 7, borderRadius: '50%', background: t.accent,
                  animation: 'askDots 1.2s infinite', animationDelay: (d * 0.18) + 's',
                }} />
              ))}
            </span>
            <span style={{ color: t.textSecondary, fontSize: 13.5, fontWeight: 600 }}>
              Looking through your jobs, quotes and invoices…
            </span>
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); ask(); }} style={{ display: 'flex', gap: 8 }}>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            disabled={asking}
            placeholder="e.g. What did I quote for the Patel job?"
            style={{
              flex: 1, minHeight: 48, padding: '10px 14px', boxSizing: 'border-box',
              background: t.bg, border: '1px solid ' + t.border, color: t.text,
              borderRadius: 10, fontSize: 15, outline: 'none', opacity: asking ? 0.6 : 1,
            }}
          />
          <button type="submit" disabled={asking || !question.trim()} style={askBtnStyle(t, asking || !question.trim())}>
            {asking ? '…' : 'Ask'}
          </button>
        </form>
      </div>

      {/* Needs your attention */}
      <div data-tour="oiab-attention">
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Needs your attention</div>
      {cards === null ? (
        <div style={{ color: t.textSecondary, padding: '20px 0' }}>Loading…</div>
      ) : cards.length === 0 ? (
        <div style={{
          background: t.successBg, border: '1px solid ' + t.success + '44',
          borderRadius: 12, padding: '22px 18px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
        }}>
          <span style={{ color: t.success }}><CheckCircleIcon size={26} /></span>
          <div style={{ color: t.success, fontWeight: 600, fontSize: 15 }}>Nothing needs chasing — you're on top of it.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {cards.map(card => (
            <div key={card.id} style={{
              background: t.card,
              border: '1px solid ' + t.border,
              borderLeft: '4px solid ' + (SEV_COLOUR[card.severity] || SEV_COLOUR.low),
              borderRadius: 12, padding: '14px 16px',
            }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{card.headline || card.title}</div>
              <div style={{ color: t.textSecondary, fontSize: 13.5, marginTop: 4, lineHeight: 1.45 }}>
                {card.situation || card.body}
              </div>
              {(card.action || card.link) && (
                <button
                  onClick={() => handleAction(card)}
                  style={{
                    marginTop: 10, minHeight: 44, padding: '0 18px',
                    background: 'transparent', color: t.accent,
                    border: '1.5px solid ' + t.accent, borderRadius: 10,
                    fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  }}
                >{card.action?.label || 'Have a look'}</button>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      {/* Quick actions */}
      <div data-tour="oiab-quick" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
        <QuickAction t={t} Icon={FileTextIcon} label="New quote" onClick={() => nav('/estimator/new')} primary dataTour="oiab-new-quote" />
        <QuickAction t={t} Icon={PoundIcon} label="New invoice" onClick={() => nav('/money?new=1')} />
        <QuickAction t={t} Icon={ImageIcon} label="Add a photo" onClick={() => nav('/jobs')} />
        <QuickAction t={t} Icon={WrenchIcon} label="Tools" onClick={() => nav('/tools')} />
      </div>


      {nudge && (
        <ShareLinkModal
          t={t}
          url={nudge.url}
          title="Give them a friendly nudge"
          message="Just checking you got the quote — any questions, give me a shout. You can see it here:"
          onClose={() => setNudge(null)}
        />
      )}
    </div>
  );
}

// The assistant answers with **bold** markers — render them as real bold
// instead of showing raw asterisks.
function renderAnswer(text) {
  const parts = String(text || '').split(/\*\*([^*]+)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

function askBtnStyle(t, disabled) {
  return {
    minHeight: 48, padding: '0 18px', borderRadius: 10, border: 'none',
    background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}

function BigNumber({ t, label, value, tone }) {
  const colour = tone === 'danger' ? (t.danger || '#EF4444') : t.text;
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ color: t.textSecondary, fontSize: 12.5, fontWeight: 600 }}>{label}</div>
      <div style={{ color: colour, fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2, letterSpacing: -0.6 }}>{value}</div>
    </div>
  );
}

function QuickAction({ t, Icon, label, onClick, primary, dataTour }) {
  return (
    <button onClick={onClick} data-tour={dataTour} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      minHeight: 56, borderRadius: 12, cursor: 'pointer',
      background: primary ? t.accent : t.card,
      color: primary ? '#fff' : t.text,
      border: primary ? 'none' : '1px solid ' + t.border,
      fontSize: 15, fontWeight: 700,
    }}>
      <Icon size={20} color={primary ? '#fff' : t.accent} />
      {label}
    </button>
  );
}

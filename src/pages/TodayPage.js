import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import ShareLinkModal from '../components/ShareLinkModal';
import { CheckCircleIcon, FileTextIcon, PoundIcon, ImageIcon, WrenchIcon } from '../components/Icons';

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

  const refresh = useCallback(async () => {
    try {
      const [agg, quotes, alerts] = await Promise.all([
        apiFetch('/invoices/_aggregates/dashboard'),
        apiFetch('/estimator/quotes'),
        apiFetch('/pm/alerts'),
      ]);
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

  const firstName = (user?.fullName || '').split(' ')[0];

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>Today</h1>
        <div style={{ color: t.textSecondary, fontSize: 13.5, marginTop: 2 }}>{today}{firstName ? ' · ' + firstName : ''}</div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 16 }}>{error}</div>}

      {/* The three numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 22 }}>
        <BigNumber t={t} label="Owed to you" value={money ? fmt0(money.owed) : '—'} />
        <BigNumber t={t} label="Overdue" value={money ? fmt0(money.overdue) : '—'} tone={money && money.overdue > 0 ? 'danger' : undefined} />
        <BigNumber t={t} label="Quoted, awaiting answer" value={money ? fmt0(money.quoted) : '—'} />
      </div>

      {/* Needs your attention */}
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

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <QuickAction t={t} Icon={FileTextIcon} label="New quote" onClick={() => nav('/estimator/new')} primary />
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

function BigNumber({ t, label, value, tone }) {
  const colour = tone === 'danger' ? (t.danger || '#EF4444') : t.text;
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ color: t.textSecondary, fontSize: 12.5, fontWeight: 600 }}>{label}</div>
      <div style={{ color: colour, fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2, letterSpacing: -0.6 }}>{value}</div>
    </div>
  );
}

function QuickAction({ t, Icon, label, onClick, primary }) {
  return (
    <button onClick={onClick} style={{
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

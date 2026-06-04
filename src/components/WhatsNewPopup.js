import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import {
  XIcon, ArrowRightIcon, SparklesIcon,
  BrainIcon, ClockIcon, SearchIcon, EditIcon, FileTextIcon,
} from './Icons';

// "What's new" announcement shown once per release so every user hears about
// the chatbot upgrades. Suppressed via localStorage after it's dismissed, so
// it never nags. Bump RELEASE_KEY whenever there's a new round of updates to
// announce — that re-shows it to everyone exactly once.

const RELEASE_KEY = 'aiqs_whatsnew_chat_2026_06';
const AMBER = '#F59E0B';
const AMBER_DIM = '#D97706';

const UPDATES = [
  { Icon: BrainIcon,    title: 'It remembers you',         desc: 'The assistant now learns your preferences, suppliers and rates automatically from every chat.' },
  { Icon: ClockIcon,    title: 'Picks up where you left off', desc: 'It recalls relevant past conversations, even in a brand-new chat.' },
  { Icon: SearchIcon,   title: 'Searches the live web',    desc: 'Ask about current prices, products or regs — it looks them up and shows its sources.' },
  { Icon: EditIcon,     title: 'Edit & regenerate',        desc: 'Tweak any message and resend, or regenerate a reply you’re not happy with.' },
  { Icon: FileTextIcon, title: 'Cleaner code & artifacts', desc: 'Syntax-highlighted code blocks, with large outputs opening in a side panel you can copy or download.' },
];

export default function WhatsNewPopup({ onClose }) {
  const { t, mode } = useTheme();
  const navigate = useNavigate();
  const isDark = mode === 'dark';

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let seen;
    try { seen = localStorage.getItem(RELEASE_KEY); } catch (e) {}
    if (seen) { if (onClose) onClose(); return; }
    const timer = setTimeout(() => setVisible(true), 900);
    return () => clearTimeout(timer);
  }, [onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  function dismiss() {
    try { localStorage.setItem(RELEASE_KEY, '1'); } catch (e) {}
    setVisible(false);
    if (onClose) onClose();
  }

  function tryIt() {
    dismiss();
    navigate('/chat');
  }

  if (!visible) return null;

  const cardBg = isDark ? '#0E1626' : '#FFFFFF';
  const border = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)';
  const rowBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.025)';
  const heroBg = isDark
    ? 'radial-gradient(120% 100% at 50% 0%, rgba(245,158,11,0.22) 0%, rgba(245,158,11,0.05) 55%, transparent 100%)'
    : 'radial-gradient(120% 100% at 50% 0%, rgba(245,158,11,0.20) 0%, rgba(245,158,11,0.06) 55%, transparent 100%)';

  return (
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(6,10,20,0.66)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        animation: 'wn-overlay-in 0.22s ease',
      }}
    >
      <style>{`
        @keyframes wn-overlay-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wn-card-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes wn-cta-glow {
          0%,100% { box-shadow: 0 8px 22px rgba(245,158,11,0.35), 0 0 0 0 rgba(245,158,11,0.30); }
          50%     { box-shadow: 0 10px 30px rgba(245,158,11,0.50), 0 0 0 8px rgba(245,158,11,0); }
        }
        .wn-cta { animation: wn-cta-glow 2.2s ease-in-out infinite; transition: transform .12s ease; }
        .wn-cta:hover { transform: translateY(-2px); }
        .wn-cta:active { transform: translateY(0); }
        @media (prefers-reduced-motion: reduce) { .wn-cta { animation: none; } }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        style={{
          position: 'relative',
          width: 'min(500px, 100%)',
          maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
          background: cardBg, border: `1px solid ${border}`, borderRadius: 22,
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
          animation: 'wn-card-in 0.34s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Close */}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            width: 30, height: 30, borderRadius: '50%',
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
            border: 'none', cursor: 'pointer', lineHeight: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <XIcon size={16} color={t.textMuted} />
        </button>

        {/* Hero */}
        <div style={{ position: 'relative', background: heroBg, padding: '24px 26px 14px', textAlign: 'center' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: AMBER_DIM, background: 'rgba(245,158,11,0.14)',
            border: `1px solid rgba(245,158,11,0.35)`, borderRadius: 999, padding: '4px 12px',
          }}>
            <SparklesIcon size={12} color={AMBER_DIM} /> New · Assistant update
          </span>
          <h2 style={{ margin: '14px 0 6px', fontSize: 24, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.03em', color: t.text }}>
            Your AI assistant just got{' '}
            <span style={{
              background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text',
              WebkitTextFillColor: 'transparent', color: AMBER,
            }}>a lot smarter.</span>
          </h2>
          <p style={{ margin: '0 auto', fontSize: 14, lineHeight: 1.5, color: t.textSecondary, maxWidth: 380 }}>
            We've rebuilt the chat to work like the best AI tools out there. Here's what's new:
          </p>
        </div>

        {/* Updates list */}
        <div style={{ padding: '8px 22px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {UPDATES.map(u => (
            <div key={u.title} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '11px 13px', borderRadius: 12, background: rowBg, border: `1px solid ${border}`,
            }}>
              <span style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(245,158,11,0.14)', color: AMBER,
              }}>
                <u.Icon size={17} color={AMBER} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 2 }}>{u.title}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: t.textSecondary }}>{u.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ padding: '14px 26px 24px', textAlign: 'center' }}>
          <button
            className="wn-cta"
            onClick={tryIt}
            style={{
              width: '100%', padding: '14px 18px', borderRadius: 13, border: 'none',
              background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
              color: '#0A0F1C', fontSize: 15.5, fontWeight: 800, letterSpacing: '-0.01em',
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            }}
          >
            Try it now <ArrowRightIcon size={18} color="#0A0F1C" />
          </button>
          <button onClick={dismiss} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, color: t.textMuted, marginTop: 12,
          }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

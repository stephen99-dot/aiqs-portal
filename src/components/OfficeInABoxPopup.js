import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import {
  XIcon, ArrowRightIcon, CheckCircleIcon,
  RulerIcon, BuildingIcon, TrendingUpIcon, CreditCardIcon, FileTextIcon,
} from './Icons';
import OfficeBoxArt from './OfficeBoxArt';

// Centered, high-impact prompt asking non-subscribers whether Office in a Box
// would interest them. "I'm interested" emails the team (the user is logged in,
// so no details are captured here). Persisted via localStorage + a server check
// so it never nags a user who has already responded.

const STORAGE_KEY = 'aiqs_office_interest_v1';
const AMBER = '#F59E0B';
const AMBER_DIM = '#D97706';

const CHIPS = [
  { Icon: RulerIcon,      label: 'Speak a quote' },
  { Icon: CreditCardIcon, label: 'Get paid' },
  { Icon: TrendingUpIcon, label: 'CIS & VAT' },
  { Icon: BuildingIcon,   label: 'Jobs & photos' },
  { Icon: FileTextIcon,   label: 'Paperwork' },
];

export default function OfficeInABoxPopup() {
  const { t, mode } = useTheme();
  const navigate = useNavigate();
  const isDark = mode === 'dark';

  const [visible, setVisible] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let seen;
    try { seen = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (seen) return;

    let timer;
    let alive = true;
    apiFetch('/office-in-a-box/interest')
      .then(d => {
        if (!alive) return;
        if (d.responded) {
          try { localStorage.setItem(STORAGE_KEY, d.status || 'responded'); } catch (e) {}
          return;
        }
        timer = setTimeout(() => { if (alive) setVisible(true); }, 1800);
      })
      .catch(() => { timer = setTimeout(() => { if (alive) setVisible(true); }, 1800); });

    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  function persist(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
  }

  async function record(status) {
    try {
      await apiFetch('/office-in-a-box/interest', {
        method: 'POST',
        body: JSON.stringify({ status, source: 'popup' }),
      });
    } catch (e) { /* best-effort; localStorage still suppresses re-show */ }
  }

  async function onInterested() {
    setSubmitting(true);
    await record('interested');
    persist('interested');
    setSubmitting(false);
    setThanks(true);
    setTimeout(() => setVisible(false), 2800);
  }

  function onLater() {
    persist('not_now');
    record('not_now');
    setVisible(false);
  }

  function onTellMore() {
    persist('seen');
    setVisible(false);
    navigate('/office-in-a-box');
  }

  if (!visible) return null;

  const cardBg = isDark ? '#0E1626' : '#FFFFFF';
  const border = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)';
  const heroBg = isDark
    ? 'radial-gradient(120% 100% at 50% 0%, rgba(245,158,11,0.22) 0%, rgba(245,158,11,0.05) 55%, transparent 100%)'
    : 'radial-gradient(120% 100% at 50% 0%, rgba(245,158,11,0.20) 0%, rgba(245,158,11,0.06) 55%, transparent 100%)';

  return (
    <div
      onClick={onLater}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        background: 'rgba(6,10,20,0.66)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        animation: 'oiab-overlay-in 0.22s ease',
      }}
    >
      <style>{`
        @keyframes oiab-overlay-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes oiab-card-in {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes oiab-cta-glow {
          0%,100% { box-shadow: 0 8px 22px rgba(245,158,11,0.35), 0 0 0 0 rgba(245,158,11,0.30); }
          50%     { box-shadow: 0 10px 30px rgba(245,158,11,0.50), 0 0 0 8px rgba(245,158,11,0); }
        }
        @keyframes oiab-check-pop { 0% { transform: scale(0); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
        .oiab-cta { animation: oiab-cta-glow 2.2s ease-in-out infinite; transition: transform .12s ease; }
        .oiab-cta:hover { transform: translateY(-2px); }
        .oiab-cta:active { transform: translateY(0); }
        @media (prefers-reduced-motion: reduce) { .oiab-cta { animation: none; } }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Office in a Box"
        style={{
          position: 'relative',
          width: 'min(468px, 100%)',
          maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
          background: cardBg, border: `1px solid ${border}`, borderRadius: 22,
          boxShadow: '0 24px 70px rgba(15,23,42,0.28)',
          animation: 'oiab-card-in 0.34s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Close */}
        <button
          onClick={onLater}
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

        {thanks ? (
          <div style={{ padding: '44px 28px 38px', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 18px',
              background: t.successBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'oiab-check-pop 0.4s cubic-bezier(0.22,1,0.36,1)',
            }}>
              <CheckCircleIcon size={34} color={t.success} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.text, marginBottom: 8, letterSpacing: '-0.02em' }}>
              You're on the list!
            </div>
            <div style={{ fontSize: 14, color: t.textSecondary, lineHeight: 1.5, maxWidth: 320, margin: '0 auto' }}>
              Brilliant — we've got your interest. We'll be in touch the moment Office in a Box
              goes live, with your founder pricing locked in.
            </div>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div style={{
              position: 'relative', background: heroBg,
              padding: '22px 24px 8px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: AMBER_DIM, background: 'rgba(245,158,11,0.14)',
                border: `1px solid rgba(245,158,11,0.35)`, borderRadius: 999, padding: '4px 12px',
              }}>
                New add-on · 7 days free
              </span>
              <OfficeBoxArt size={210} style={{ marginTop: 4 }} />
            </div>

            {/* Body */}
            <div style={{ padding: '6px 26px 26px', textAlign: 'center' }}>
              <h2 style={{
                margin: '0 0 8px', fontSize: 25, fontWeight: 800, lineHeight: 1.12,
                letterSpacing: '-0.03em', color: t.text,
              }}>
                Your whole office,{' '}
                <span style={{
                  background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                  WebkitBackgroundClip: 'text', backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent', color: AMBER,
                }}>in one tab.</span>
              </h2>
              <p style={{ margin: '0 auto 16px', fontSize: 14.5, lineHeight: 1.5, color: t.textSecondary, maxWidth: 360 }}>
                Say a job out loud, get a priced quote. Send it by WhatsApp, get it
                accepted, invoiced and paid — CIS and VAT handled. Built for the van.
              </p>

              {/* Feature chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center', marginBottom: 18 }}>
                {CHIPS.map(c => (
                  <span key={c.label} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 11.5, fontWeight: 600, color: t.textSecondary,
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.035)',
                    border: `1px solid ${border}`, borderRadius: 999, padding: '5px 10px',
                  }}>
                    <c.Icon size={13} color={AMBER} /> {c.label}
                  </span>
                ))}
              </div>

              {/* Price */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', color: t.text }}>£100</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: t.textSecondary }}>/month</span>
                </div>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: t.success,
                  background: t.successBg, borderRadius: 6, padding: '4px 8px',
                }}>
                  7 days free
                </span>
              </div>

              {/* CTA */}
              <button
                className="oiab-cta"
                onClick={onInterested}
                disabled={submitting}
                style={{
                  width: '100%', padding: '15px 18px', borderRadius: 13, border: 'none',
                  background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                  color: '#0A0F1C', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
                  cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.75 : 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                }}
              >
                {submitting ? 'Saving…' : 'Yes — count me in'}
                {!submitting && <ArrowRightIcon size={18} color="#0A0F1C" />}
              </button>
              <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 11, lineHeight: 1.4 }}>
                One tap — we already know it's you. No forms, no card.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
                <button onClick={onTellMore} style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, color: AMBER_DIM,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  See everything it does <ArrowRightIcon size={13} color={AMBER_DIM} />
                </button>
                <button onClick={onLater} style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 500, color: t.textMuted,
                }}>
                  Maybe later
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

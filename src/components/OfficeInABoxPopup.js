import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import { ZapIcon, XIcon, ArrowRightIcon, CheckCircleIcon } from './Icons';

// One-time, dismissible prompt asking non-subscribers whether Office in a Box
// would interest them. "I'm interested" emails the team (the user is logged in,
// so no details are captured here). Persisted via localStorage + a server check
// so it never nags a user who has already responded.

const STORAGE_KEY = 'aiqs_office_interest_v1';
const AMBER = '#F59E0B';
const AMBER_DIM = '#D97706';

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
        timer = setTimeout(() => { if (alive) setVisible(true); }, 2500);
      })
      .catch(() => {
        // If the check fails, still show it after the delay.
        timer = setTimeout(() => { if (alive) setVisible(true); }, 2500);
      });

    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

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
    setTimeout(() => setVisible(false), 2600);
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

  const cardBg = isDark ? '#111827' : '#FFFFFF';
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  return (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 400,
      width: 'min(360px, calc(100vw - 32px))',
      background: cardBg, border: `1px solid ${border}`,
      borderRadius: 16, boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
      overflow: 'hidden',
      animation: 'oiab-pop-in 0.32s cubic-bezier(0.22,1,0.36,1)',
    }}>
      <style>{`
        @keyframes oiab-pop-in {
          from { opacity: 0; transform: translateY(14px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Accent strip */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${AMBER}, ${AMBER_DIM})` }} />

      <div style={{ padding: 18 }}>
        {!thanks && (
          <button
            onClick={onLater}
            aria-label="Dismiss"
            style={{
              position: 'absolute', top: 12, right: 12,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 4, borderRadius: 6, lineHeight: 0,
            }}
          >
            <XIcon size={16} color={t.textMuted} />
          </button>
        )}

        {thanks ? (
          <div style={{ textAlign: 'center', padding: '8px 4px' }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', margin: '0 auto 12px',
              background: t.successBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CheckCircleIcon size={24} color={t.success} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 4 }}>
              Thanks — you're on the list!
            </div>
            <div style={{ fontSize: 12.5, color: t.textSecondary, lineHeight: 1.45 }}>
              We'll be in touch the moment Office in a Box is ready.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ZapIcon size={17} color="#0A0F1C" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: t.text, paddingRight: 16 }}>
                New: Office in a Box
              </div>
            </div>

            <div style={{ fontSize: 13, lineHeight: 1.5, color: t.textSecondary, marginBottom: 14 }}>
              Run your whole back-office from the portal — quoting, project management,
              invoicing, cashflow and documents — for <strong style={{ color: t.text }}>£50/month</strong>.
              Would that be useful for your business?
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onInterested}
                disabled={submitting}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none',
                  background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                  color: '#0A0F1C', fontSize: 13, fontWeight: 700,
                  cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {submitting ? 'Saving…' : "I'm interested"}
              </button>
              <button
                onClick={onTellMore}
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'transparent', border: `1px solid ${border}`,
                  color: t.text, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  whiteSpace: 'nowrap',
                }}
              >
                Tell me more <ArrowRightIcon size={13} color={t.text} />
              </button>
            </div>

            <button
              onClick={onLater}
              style={{
                width: '100%', marginTop: 8, padding: '6px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12, color: t.textMuted, fontWeight: 500,
              }}
            >
              Maybe later
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import { XIcon } from './Icons';

// In-portal Trustpilot review ask, shown once per PROMPT_KEY to every
// signed-in user (admins excluded — it's their own product). Replaces the
// old three-question feedback survey: we want the reviews on Trustpilot.
//
// Everyone eligible is asked, whatever they think of us — Trustpilot's
// guidelines forbid pre-screening for happy customers, so there's no rating
// step that decides who gets the link.
//
// "Not now" snoozes locally for 3 days; clicking through (or "I've already
// reviewed") completes it permanently on the server, so it follows the user
// across devices. Bump PROMPT_KEY to ask again later.

const PROMPT_KEY = 'trustpilot_2026_09';
const SNOOZE_KEY = 'aiqs_survey_snooze_' + PROMPT_KEY;
const DONE_KEY = 'aiqs_survey_done_' + PROMPT_KEY;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const TRUSTPILOT_URL = process.env.REACT_APP_TRUSTPILOT_URL || 'https://uk.trustpilot.com/evaluate/theaiqs.co.uk';
const TP_GREEN = '#00B67A';

function TrustpilotStars() {
  return (
    <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} style={{
          width: 30, height: 30, background: TP_GREEN, color: '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, lineHeight: 1,
        }}>★</div>
      ))}
    </div>
  );
}

export default function TrustpilotPopup() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DONE_KEY)) return;
      const snooze = parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10);
      if (snooze && Date.now() - snooze < SNOOZE_MS) return;
    } catch (e) {}
    let cancelled = false;
    // Server is the source of truth — already done on another device?
    apiFetch('/survey/status?key=' + PROMPT_KEY)
      .then((r) => {
        if (cancelled) return;
        if (r.completed) {
          try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
          return;
        }
        // Too new an account — the server says not yet. Don't mark anything
        // locally; we simply re-check next session.
        if (r.eligible === false) return;
        setTimeout(() => { if (!cancelled) setVisible(true); }, 1500);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch (e) {}
    setVisible(false);
  }

  // Fire-and-forget: the link has already opened in a new tab, so a failed
  // save only means we might ask once more on another device.
  function complete(outcome) {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    apiFetch('/survey/complete', {
      method: 'POST',
      body: JSON.stringify({ survey_key: PROMPT_KEY, outcome }),
    }).catch(() => {});
    setDone(true);
    setTimeout(() => setVisible(false), 1800);
  }

  if (!visible) return null;

  const card = {
    width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
    background: isDark ? '#111827' : '#FFFFFF',
    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'),
    borderRadius: 16, padding: '22px 22px 18px',
    boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.35)' : '0 24px 64px rgba(15,23,42,0.24)',
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) snooze(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(10,15,28,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={card}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '26px 8px' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>🙌</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: t.text }}>Thank you — that genuinely helps.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={snooze} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, margin: '-6px -6px 0 0' }}>
                <XIcon size={18} color={t.textMuted} />
              </button>
            </div>

            <TrustpilotStars />

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: t.text }}>Quick one — would you review us on Trustpilot?</div>
              <div style={{ fontSize: 13.5, color: t.textMuted, marginTop: 8, lineHeight: 1.55 }}>
                An honest review helps other contractors find AI QS — and tells us what to build next. It takes about a minute.
              </div>
            </div>

            <a
              href={TRUSTPILOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => complete('clicked')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginTop: 20, minHeight: 48, borderRadius: 10, textDecoration: 'none',
                background: TP_GREEN, color: '#FFFFFF', fontSize: 15, fontWeight: 800,
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>★</span> Review us on Trustpilot
            </a>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <button onClick={snooze} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 13, padding: '8px 4px' }}>
                Not now
              </button>
              <button onClick={() => complete('already_reviewed')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 13, padding: '8px 4px' }}>
                I've already reviewed
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

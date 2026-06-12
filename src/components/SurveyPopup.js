import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import { XIcon } from './Icons';

// In-portal feedback survey, shown once per SURVEY_KEY to every signed-in
// user (admins excluded — it's their own product). Three questions: stars,
// ease of navigation /10, and a feature wish.
//
// "Not now" snoozes locally for 3 days; submitting completes it permanently
// on the server, so it follows the user across devices. Bump SURVEY_KEY to
// run a fresh survey later.

const SURVEY_KEY = 'portal_2026_06';
const SNOOZE_KEY = 'aiqs_survey_snooze_' + SURVEY_KEY;
const DONE_KEY = 'aiqs_survey_done_' + SURVEY_KEY;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const AMBER = '#F59E0B';

function Star({ filled, onClick, onHover, onLeave }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      aria-label={filled ? 'star filled' : 'star'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 34, lineHeight: 1, color: filled ? AMBER : 'rgba(148,163,184,0.45)' }}
    >★</button>
  );
}

export default function SurveyPopup() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const [visible, setVisible] = useState(false);
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [navScore, setNavScore] = useState(0);
  const [feature, setFeature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      if (localStorage.getItem(DONE_KEY)) return;
      const snooze = parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10);
      if (snooze && Date.now() - snooze < SNOOZE_MS) return;
    } catch (e) {}
    let cancelled = false;
    // Server is the source of truth — already answered on another device?
    apiFetch('/survey/status?key=' + SURVEY_KEY)
      .then((r) => {
        if (cancelled) return;
        if (r.completed) {
          try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
          return;
        }
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

  async function submit() {
    if (!stars) { setError('Tap a star rating first — that one matters most.'); return; }
    setSubmitting(true); setError('');
    try {
      await apiFetch('/survey', {
        method: 'POST',
        body: JSON.stringify({ survey_key: SURVEY_KEY, stars, nav_score: navScore || null, feature_request: feature }),
      });
      try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
      setDone(true);
      setTimeout(() => setVisible(false), 1800);
    } catch (e) {
      setError(e.message || 'Failed to send — try again.');
    }
    setSubmitting(false);
  }

  if (!visible) return null;

  const card = {
    width: 'min(480px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
    background: isDark ? '#111827' : '#FFFFFF',
    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'),
    borderRadius: 16, padding: '22px 22px 18px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
  };
  const label = { fontSize: 13.5, fontWeight: 700, color: t.text, marginBottom: 8 };

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
            <div style={{ fontSize: 17, fontWeight: 800, color: t.text }}>Thanks — that genuinely helps.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: t.text }}>Quick one — how are we doing?</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 3 }}>30 seconds. It shapes what we build next.</div>
              </div>
              <button onClick={snooze} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <XIcon size={18} color={t.textMuted} />
              </button>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={label}>How would you rate the portal?</div>
              <div onMouseLeave={() => setHoverStars(0)} style={{ display: 'flex', justifyContent: 'center' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} filled={(hoverStars || stars) >= n} onClick={() => setStars(n)} onHover={() => setHoverStars(n)} />
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={label}>Since the update — how easy is it to find your way around? <span style={{ color: t.textMuted, fontWeight: 500 }}>(1 = lost, 10 = effortless)</span></div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} type="button" onClick={() => setNavScore(n)} style={{
                    flex: '1 0 34px', minHeight: 38, borderRadius: 8, cursor: 'pointer',
                    fontSize: 13.5, fontWeight: 700,
                    background: navScore === n ? AMBER : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
                    color: navScore === n ? '#0A0F1C' : t.textMuted,
                    border: '1px solid ' + (navScore === n ? AMBER : 'transparent'),
                  }}>{n}</button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={label}>What's one feature you'd love to see?</div>
              <textarea
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
                rows={3}
                placeholder="Anything — big or small."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
                  background: isDark ? '#0A0F1C' : '#F8FAFC', color: t.text,
                  border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                  fontSize: 14, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                }}
              />
            </div>

            {error && <div style={{ marginTop: 10, fontSize: 12.5, color: '#EF4444' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
              <button onClick={submit} disabled={submitting} style={{
                flex: 1, minHeight: 46, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: '#0A0F1C',
                fontSize: 14.5, fontWeight: 800, opacity: submitting ? 0.7 : 1,
              }}>{submitting ? 'Sending…' : 'Send feedback'}</button>
              <button onClick={snooze} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 13, padding: '8px 10px' }}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import { XIcon, CheckIcon, ArrowRightIcon, ExternalLinkIcon } from './Icons';

// New-product prompt + suitability survey. Opens with a simple yes/no —
// "We have a new product. Would you like to see it?" — and only a Yes leads
// into the qualifying questions that tailor an AI Trades Pilot package, then
// invite them onto a free trial of it. Three quick screens after the prompt:
// which features they'd love, a bit about the business, then the package
// we'd build for them with a deep link into app.aitradespilot.com (the plan
// rides the ?plan= param all the way to ATP's tier picker).
//
// Shown once per SURVEY_KEY; "No thanks" dismisses it for good on this
// device, "Not now"/close snoozes 3 days, finishing completes it on the
// server so it follows the user across devices. The parent is told via
// onDecided(willShow) so the feedback survey never stacks on top of this
// one. Bump SURVEY_KEY to re-run.

const SURVEY_KEY = 'suitability_2026_08';
const SNOOZE_KEY = 'aiqs_suitability_snooze_' + SURVEY_KEY;
const DONE_KEY = 'aiqs_suitability_done_' + SURVEY_KEY;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

// AI Trades Pilot brand blue — matches AiTradesPilotPage.
const BLUE = '#0071F3';

// Mirrors server/suitability.js — ids must match; labels are display-only.
const FEATURE_OPTIONS = [
  { id: 'ai_call_handler', label: 'AI call handler', blurb: 'A work phone that answers, records and writes up every call' },
  { id: 'valuations',      label: 'Valuations, variations & RFIs', blurb: 'Raise vals, price changes and get them signed off' },
  { id: 'boq',             label: 'AI-priced BOQs', blurb: 'Drawings in, priced bill of quantities back same day' },
  { id: 'cost_tracking',   label: 'Live cost tracking', blurb: 'Planned vs actual, with alerts when margin slips' },
  { id: 'documents',       label: 'Quotes, RAMS & invoices', blurb: 'AI-drafted paperwork on your letterhead' },
  { id: 'materials',       label: 'Materials comparison', blurb: 'Every line priced across merchants before you order' },
  { id: 'crm_leads',       label: 'CRM & priced planning leads', blurb: 'Approved planning near you, priced at your rates on the spot' },
  { id: 'letters',         label: 'Client letter generator', blurb: 'Headed intro and follow-up letters, ready to post' },
  { id: 'programmes',      label: 'Programmes & schedules', blurb: 'A build programme that plans itself' },
  { id: 'site_team',       label: 'Site tools for the team', blurb: 'Clock-in, photo reports and delegated tasks' },
  { id: 'client_signoff',  label: 'Client sign-off portal', blurb: 'Customers approve changes online, signed & dated' },
  { id: 'multi_site',      label: 'Multi-site overview', blurb: 'Every live job in one view' },
];
const FEATURE_LABELS = Object.fromEntries(FEATURE_OPTIONS.map((f) => [f.id, f.label]));

const TEAM_OPTIONS = [
  { id: 'solo', label: 'Just me' },
  { id: 's2_10', label: '2–10' },
  { id: 's11_25', label: '11–25' },
  { id: 's26plus', label: '25+' },
];
const JOBS_OPTIONS = [
  { id: 'adhoc', label: 'Now and then' },
  { id: 'monthly', label: '~1 a month' },
  { id: 's2_5', label: '2–5 a month' },
  { id: 's6plus', label: '5+ a month' },
];

const TIER_BLURBS = {
  sales: 'Fills your pipeline — CRM, priced planning leads and client letters.',
  unlimited: 'Runs the whole job — unlimited AI QS priced jobs, contracts and everything else.',
  bundle: 'Both packages together — win the work, then run it. Save £49 a month.',
};

export default function SuitabilitySurveyPopup({ onDecided }) {
  const { t, mode } = useTheme();
  const navigate = useNavigate();
  const isDark = mode === 'dark';

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState('ask'); // ask → features → about → result
  const [features, setFeatures] = useState([]);
  const [teamSize, setTeamSize] = useState('');
  const [jobs, setJobs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [rec, setRec] = useState(null); // { recommendation, trialUrl }

  useEffect(() => {
    const decide = (willShow) => { if (onDecided) onDecided(willShow); };
    try {
      if (localStorage.getItem(DONE_KEY)) { decide(false); return; }
      const snooze = parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10);
      if (snooze && Date.now() - snooze < SNOOZE_MS) { decide(false); return; }
    } catch (e) {}
    let cancelled = false;
    // Server is the source of truth — already answered on another device?
    apiFetch('/survey/suitability/status?key=' + SURVEY_KEY)
      .then((r) => {
        if (cancelled) return;
        if (r.completed) {
          try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
          decide(false);
          return;
        }
        // Too new an account — the server says not yet. Don't mark anything
        // locally; we simply re-check next session.
        if (r.eligible === false) { decide(false); return; }
        decide(true);
        setTimeout(() => { if (!cancelled) setVisible(true); }, 1500);
      })
      .catch(() => { if (!cancelled) decide(false); });
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

  function finish() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    setVisible(false);
  }

  // A straight "No" to the new-product prompt — don't nag them again.
  function decline() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    setVisible(false);
  }

  const allSelected = features.length === FEATURE_OPTIONS.length;
  function toggleFeature(id) {
    setFeatures((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id]));
  }
  function toggleAll() {
    setFeatures(allSelected ? [] : FEATURE_OPTIONS.map((f) => f.id));
  }

  async function submit() {
    setSubmitting(true); setError('');
    try {
      const r = await apiFetch('/survey/suitability', {
        method: 'POST',
        body: JSON.stringify({ survey_key: SURVEY_KEY, features, team_size: teamSize, jobs_per_month: jobs }),
      });
      try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
      setRec(r);
      setStep('result');
    } catch (e) {
      setError(e.message || 'Failed to send — try again.');
    }
    setSubmitting(false);
  }

  if (!visible) return null;

  const card = {
    width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
    background: isDark ? '#111827' : '#FFFFFF',
    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'),
    borderRadius: 16, padding: '22px 22px 18px',
    boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.35)' : '0 24px 64px rgba(15,23,42,0.24)',
  };
  const chip = (active) => ({
    padding: '9px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700,
    background: active ? BLUE : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'),
    color: active ? '#FFFFFF' : t.textMuted,
    border: '1px solid ' + (active ? BLUE : 'transparent'),
  });
  const primaryBtn = (disabled) => ({
    flex: 1, minHeight: 46, borderRadius: 10, border: 'none', cursor: disabled ? 'default' : 'pointer',
    background: 'linear-gradient(135deg,#0071F3,#0059CE)', color: '#FFFFFF',
    fontSize: 14.5, fontWeight: 800, opacity: disabled ? 0.5 : 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  });
  const label = { fontSize: 13.5, fontWeight: 700, color: t.text, marginBottom: 8 };
  const recommendation = rec?.recommendation;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) { step === 'result' ? finish() : snooze(); } }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(10,15,28,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={card}>
        {/* header — the ask step draws its own centred heading below */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            {step === 'ask' ? null : step !== 'result' ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, color: t.text }}>
                  {step === 'features' ? 'What would make the biggest difference to your business?' : 'Two quick ones about the business'}
                </div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 3 }}>
                  {step === 'features'
                    ? 'Tick everything you’d use — we’ll build a package around it.'
                    : 'So the package fits the size of the firm, not just the wishlist.'}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, color: t.text }}>The package we’d build for you</div>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 3 }}>Tailored from your answers — and we’ve emailed you this too.</div>
              </>
            )}
          </div>
          <button onClick={step === 'result' ? finish : snooze} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <XIcon size={18} color={t.textMuted} />
          </button>
        </div>

        {/* step 0 — the new-product prompt: a simple yes/no before any questions */}
        {step === 'ask' && (
          <div style={{ textAlign: 'center', padding: '6px 8px 8px' }}>
            <span style={{
              display: 'inline-block', fontSize: 10.5, fontWeight: 800,
              letterSpacing: '0.09em', textTransform: 'uppercase',
              color: BLUE, background: isDark ? 'rgba(0,113,243,0.14)' : 'rgba(0,113,243,0.08)',
              border: '1px solid ' + (isDark ? 'rgba(0,113,243,0.4)' : 'rgba(0,113,243,0.3)'),
              borderRadius: 999, padding: '4px 12px',
            }}>
              New product
            </span>
            <div style={{ fontSize: 21, fontWeight: 800, color: t.text, marginTop: 14, letterSpacing: '-0.02em' }}>
              We have a new product.
            </div>
            <div style={{ fontSize: 14.5, color: t.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
              Would you like to see it?
            </div>
            <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 8, lineHeight: 1.5, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
              Answer a few quick questions and we&rsquo;ll tailor the perfect package for you.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => setStep('features')} style={primaryBtn(false)}>
                Yes — show me <ArrowRightIcon size={16} color="#FFFFFF" />
              </button>
              <button onClick={decline} style={{
                flex: '0 0 auto', minHeight: 46, padding: '0 18px', borderRadius: 10, cursor: 'pointer',
                background: 'none', border: '1px solid ' + t.border, color: t.textMuted,
                fontSize: 13.5, fontWeight: 700,
              }}>
                No thanks
              </button>
            </div>
          </div>
        )}

        {/* step 1 — feature multi-select */}
        {step === 'features' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8, marginTop: 16 }}>
              {FEATURE_OPTIONS.map((f) => {
                const active = features.includes(f.id);
                return (
                  <button key={f.id} type="button" onClick={() => toggleFeature(f.id)} style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    background: active ? (isDark ? 'rgba(0,113,243,0.14)' : 'rgba(0,113,243,0.07)') : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'),
                    border: '1px solid ' + (active ? BLUE : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)')),
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 5, flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: active ? BLUE : 'transparent',
                        border: '1.5px solid ' + (active ? BLUE : t.textMuted),
                      }}>{active && <CheckIcon size={11} color="#FFFFFF" />}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{f.label}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, lineHeight: 1.4 }}>{f.blurb}</div>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={toggleAll} style={{ ...chip(allSelected), marginTop: 10, width: '100%', minHeight: 40 }}>
              {allSelected ? 'All of the above — selected ✓' : 'All of the above'}
            </button>
            {error && <div style={{ marginTop: 10, fontSize: 12.5, color: '#EF4444' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
              <button onClick={() => features.length && setStep('about')} disabled={!features.length} style={primaryBtn(!features.length)}>
                Continue <ArrowRightIcon size={16} color="#FFFFFF" />
              </button>
              <button onClick={snooze} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 13, padding: '8px 10px' }}>
                Not now
              </button>
            </div>
          </>
        )}

        {/* step 2 — team size + pricing volume */}
        {step === 'about' && (
          <>
            <div style={{ marginTop: 18 }}>
              <div style={label}>How many people work with you, on and off site?</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TEAM_OPTIONS.map((o) => (
                  <button key={o.id} type="button" onClick={() => setTeamSize(o.id)} style={{ ...chip(teamSize === o.id), flex: '1 0 100px' }}>{o.label}</button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={label}>How often do you price new work?</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {JOBS_OPTIONS.map((o) => (
                  <button key={o.id} type="button" onClick={() => setJobs(o.id)} style={{ ...chip(jobs === o.id), flex: '1 0 100px' }}>{o.label}</button>
                ))}
              </div>
            </div>
            {error && <div style={{ marginTop: 10, fontSize: 12.5, color: '#EF4444' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18 }}>
              <button onClick={() => setStep('features')} style={{ background: 'none', border: '1px solid ' + t.border, borderRadius: 10, cursor: 'pointer', color: t.textMuted, fontSize: 13, fontWeight: 700, padding: '12px 16px' }}>
                Back
              </button>
              <button onClick={submit} disabled={!teamSize || !jobs || submitting} style={primaryBtn(!teamSize || !jobs || submitting)}>
                {submitting ? 'Building your package…' : 'See my package'}
              </button>
            </div>
          </>
        )}

        {/* step 3 — the tailored package + trial invite */}
        {step === 'result' && recommendation && (
          <>
            <div style={{
              marginTop: 16, borderRadius: 12, padding: '16px 18px',
              background: isDark ? 'rgba(0,113,243,0.10)' : 'rgba(0,113,243,0.06)',
              border: '1px solid ' + (isDark ? 'rgba(0,113,243,0.35)' : 'rgba(0,113,243,0.30)'),
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: BLUE }}>{recommendation.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>£{recommendation.monthly}<span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>/month · 14-day free trial</span></div>
              </div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4 }}>{TIER_BLURBS[recommendation.tier]} On AI Trades Pilot — the full platform this portal’s AI QS is part of.</div>

              {recommendation.covered.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {recommendation.covered.map((f) => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.text, marginBottom: 6 }}>
                      <CheckIcon size={14} color={BLUE} /> {FEATURE_LABELS[f] || f}
                    </div>
                  ))}
                  {recommendation.addons.map((f) => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.text, marginBottom: 6 }}>
                      <CheckIcon size={14} color={BLUE} /> {FEATURE_LABELS[f] || f} <span style={{ fontSize: 11, color: t.textMuted }}>(optional add-on)</span>
                    </div>
                  ))}
                </div>
              )}
              {recommendation.uncovered.length > 0 && (
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 8, lineHeight: 1.5 }}>
                  As you grow: {recommendation.uncovered.map((f) => FEATURE_LABELS[f] || f).join(', ')} — one plan up, whenever you’re ready.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
              <a href={rec.trialUrl} target="_blank" rel="noopener noreferrer" onClick={finish} style={{ ...primaryBtn(false), textDecoration: 'none' }}>
                Start my free trial <ExternalLinkIcon size={15} color="#FFFFFF" />
              </a>
            </div>
            <button onClick={() => { finish(); navigate('/ai-trades-pilot'); }} style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: 12.5, padding: '6px' }}>
              See everything AI Trades Pilot does first
            </button>
          </>
        )}
      </div>
    </div>
  );
}

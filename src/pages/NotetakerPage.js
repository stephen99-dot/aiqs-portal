import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';

// ─── Icons ───────────────────────────────────────────────────────────────────
const Mic = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);
const FileText = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
  </svg>
);
const Mail = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);
const Zap = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);
const CheckCircle = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);
const Play = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
);
const Clock = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const Users = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const ArrowRight = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);
const Sparkle = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/>
  </svg>
);

// ─── Animated Waveform ────────────────────────────────────────────────────────
function Waveform({ active }) {
  const bars = 20;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 40 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const height = active
          ? 8 + Math.random() * 28
          : 4 + Math.abs(Math.sin(i * 0.8)) * 12;
        return (
          <div
            key={i}
            style={{
              width: 3,
              borderRadius: 2,
              background: active
                ? `rgba(245,158,11,${0.5 + (i % 3) * 0.2})`
                : 'rgba(255,255,255,0.15)',
              height: `${height}px`,
              transition: active ? `height ${0.1 + i * 0.02}s ease` : 'height 0.5s ease',
              animation: active ? `pulse-bar ${0.4 + (i % 5) * 0.15}s ease-in-out infinite alternate` : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Demo transcript data ─────────────────────────────────────────────────────
const TRANSCRIPT_LINES = [
  { speaker: 'Client', text: 'So the main concern is the RC frame specification for the top two floors.', time: '0:12' },
  { speaker: 'AI QS', text: 'Noted. Are you looking at a flat slab or beam-and-slab arrangement?', time: '0:24' },
  { speaker: 'Client', text: 'Flat slab — the architect wants clear ceiling heights throughout.', time: '0:31' },
  { speaker: 'AI QS', text: 'That will affect the post-tensioning allowance. I\'ll flag that in the BOQ.', time: '0:45' },
  { speaker: 'Client', text: 'Also the M&E package — can we hold a provisional sum for that?', time: '1:02' },
  { speaker: 'AI QS', text: 'Yes, we\'ll carry a £180k provisional. I\'ll note the variation risk in the findings report.', time: '1:14' },
];

const SUMMARY_POINTS = [
  'RC flat slab construction confirmed for floors 6–7 — post-tensioning allowance required',
  'M&E provisional sum agreed at £180,000 — variation risk flagged in findings report',
  'Architect to issue revised ceiling height drawings by end of week',
  'Client requested expedited BOQ turnaround — 3 working days agreed',
];

const ACTION_ITEMS = [
  { text: 'Update BOQ with post-tensioning line item', owner: 'AI QS', done: false },
  { text: 'Insert M&E provisional sum £180k', owner: 'AI QS', done: false },
  { text: 'Issue revised ceiling height drawings', owner: 'Architect', done: false },
  { text: 'Draft follow-up email to client', owner: 'AI QS', done: true },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function NotetakerPage() {
  const { theme: t } = useTheme();
  const [activeTab, setActiveTab] = useState('transcript');
  const [demoStep, setDemoStep] = useState(0); // 0=idle, 1=recording, 2=processing, 3=done
  const [visibleLines, setVisibleLines] = useState(0);
  const [visibleSummary, setVisibleSummary] = useState(0);
  const demoTimer = useRef(null);

  const isDark = t?.bg === '#0A0F1C' || !t?.bg;

  const c = {
    bg: isDark ? '#0A0F1C' : '#F8F9FB',
    surface: isDark ? '#111827' : '#FFFFFF',
    surfaceAlt: isDark ? '#0F1929' : '#F3F4F6',
    border: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    text: isDark ? '#F1F5F9' : '#111827',
    textMuted: isDark ? '#94A3B8' : '#6B7280',
    accent: '#F59E0B',
    accentDim: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.1)',
    accentBorder: 'rgba(245,158,11,0.3)',
    green: '#10B981',
    greenDim: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)',
    blue: '#3B82F6',
    blueDim: isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.08)',
    heroBg: isDark
      ? 'linear-gradient(135deg, #0A0F1C 0%, #111827 50%, #0A0F1C 100%)'
      : 'linear-gradient(135deg, #EFF6FF 0%, #FEF3C7 50%, #F0FDF4 100%)',
  };

  function runDemo() {
    if (demoStep !== 0) { setDemoStep(0); setVisibleLines(0); setVisibleSummary(0); return; }
    setDemoStep(1);
    let line = 0;
    const revealLines = () => {
      if (line < TRANSCRIPT_LINES.length) {
        setVisibleLines(line + 1);
        line++;
        demoTimer.current = setTimeout(revealLines, 900);
      } else {
        setDemoStep(2);
        demoTimer.current = setTimeout(() => {
          setDemoStep(3);
          setActiveTab('summary');
          let s = 0;
          const revealSummary = () => {
            if (s < SUMMARY_POINTS.length) {
              setVisibleSummary(s + 1);
              s++;
              demoTimer.current = setTimeout(revealSummary, 600);
            }
          };
          revealSummary();
        }, 2000);
      }
    };
    setActiveTab('transcript');
    revealLines();
  }

  useEffect(() => () => clearTimeout(demoTimer.current), []);

  const pill = (label, color) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
      background: color === 'amber' ? c.accentDim : color === 'green' ? c.greenDim : c.blueDim,
      color: color === 'amber' ? c.accent : color === 'green' ? c.green : c.blue,
      border: `1px solid ${color === 'amber' ? c.accentBorder : color === 'green' ? 'rgba(16,185,129,0.25)' : 'rgba(59,130,246,0.25)'}`,
    }}>{label}</span>
  );

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text, fontFamily: 'inherit' }}>

      {/* ── HERO ── */}
      <div style={{
        background: c.heroBg,
        borderBottom: `1px solid ${c.border}`,
        padding: '52px 32px 48px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* decorative orbs */}
        <div style={{
          position: 'absolute', top: -60, right: -60, width: 300, height: 300,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -40, left: '30%', width: 200, height: 200,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: 820, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            {pill('New Feature', 'amber')}
            {pill('Powered by AI QS', 'blue')}
          </div>

          <h1 style={{
            fontSize: 'clamp(28px, 4vw, 44px)',
            fontWeight: 800, letterSpacing: '-0.03em',
            lineHeight: 1.1, margin: '0 0 16px',
            color: c.text,
          }}>
            AI QS Notetaker
            <span style={{ display: 'block', color: c.accent, marginTop: 4 }}>
              Every site meeting. Captured. Summarised. Actioned.
            </span>
          </h1>

          <p style={{ fontSize: 17, color: c.textMuted, lineHeight: 1.65, maxWidth: 560, marginBottom: 28 }}>
            Record site visits, client calls, and design team meetings. Our AI transcribes in real time,
            extracts action items, and drafts follow-up emails — all in your AI QS Portal.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button onClick={runDemo} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 10,
              background: demoStep === 1 ? 'rgba(245,158,11,0.15)' : c.accent,
              color: demoStep === 1 ? c.accent : '#0A0F1C',
              border: demoStep === 1 ? `1px solid ${c.accentBorder}` : 'none',
              fontWeight: 700, fontSize: 14, cursor: 'pointer',
              transition: 'all 0.2s',
            }}>
              {demoStep === 1 ? (
                <><span style={{ width: 8, height: 8, borderRadius: '50%', background: c.accent, animation: 'blink 1s infinite' }} /> Recording...</>
              ) : demoStep === 2 ? (
                <><Sparkle size={16} /> Processing...</>
              ) : demoStep === 3 ? (
                <><Play size={16} /> Replay Demo</>
              ) : (
                <><Play size={16} /> Watch Live Demo</>
              )}
            </button>
            <a href="https://getinbo.io" target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 10,
              background: 'transparent',
              color: c.textMuted,
              border: `1px solid ${c.border}`,
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
              textDecoration: 'none', transition: 'all 0.2s',
            }}>
              Learn more <ArrowRight size={14} />
            </a>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, marginTop: 36, paddingTop: 28, borderTop: `1px solid ${c.border}` }}>
            {[
              { val: '< 30s', label: 'Time to summary' },
              { val: '50+', label: 'Construction terms recognised' },
              { val: '100%', label: 'Private — never shared' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.accent, letterSpacing: '-0.02em' }}>{s.val}</div>
                <div style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* HOW IT WORKS */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>
            HOW IT WORKS
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 28px', color: c.text }}>
            Three steps from meeting to action
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              {
                icon: <Mic size={22} color={c.accent} />,
                step: '01',
                title: 'Record',
                desc: 'Start the AI Notetaker before your site visit or call. It captures audio locally on your device — no bots, no third-party servers.',
                tag: 'On-device recording',
              },
              {
                icon: <Zap size={22} color={c.accent} />,
                step: '02',
                title: 'Transcribe & Summarise',
                desc: 'When the meeting ends, AI generates a full transcript with speaker labels, then extracts decisions, action items, and variation risks.',
                tag: 'AI-powered',
              },
              {
                icon: <Mail size={22} color={c.accent} />,
                step: '03',
                title: 'Draft & Deliver',
                desc: 'A follow-up email lands in your drafts — pre-written in your tone, referencing the correct project and parties. Send with one click.',
                tag: 'Auto follow-up',
              },
            ].map(item => (
              <div key={item.step} style={{
                background: c.surface,
                border: `1px solid ${c.border}`,
                borderRadius: 14,
                padding: '24px 22px',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: 16, right: 18,
                  fontSize: 36, fontWeight: 900, color: c.border,
                  letterSpacing: '-0.04em', lineHeight: 1, userSelect: 'none',
                }}>
                  {item.step}
                </div>
                <div style={{
                  width: 42, height: 42, borderRadius: 10,
                  background: c.accentDim,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 14,
                }}>
                  {item.icon}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: c.text }}>{item.title}</div>
                <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.6, marginBottom: 14 }}>{item.desc}</div>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: c.accent, background: c.accentDim, padding: '3px 8px', borderRadius: 6,
                }}>
                  {item.tag}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* LIVE DEMO PANEL */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>
            LIVE DEMO
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 6px', color: c.text }}>
            See it in action
          </h2>
          <p style={{ fontSize: 14, color: c.textMuted, marginBottom: 22 }}>
            Press <strong style={{ color: c.text }}>Watch Live Demo</strong> above to replay a simulated site meeting.
          </p>

          <div style={{
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: 16, overflow: 'hidden',
          }}>
            {/* Demo header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '14px 20px',
              borderBottom: `1px solid ${c.border}`,
              background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                background: demoStep === 1 ? 'rgba(239,68,68,0.15)' : c.accentDim,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${demoStep === 1 ? 'rgba(239,68,68,0.3)' : c.accentBorder}`,
              }}>
                <Mic size={17} color={demoStep === 1 ? '#EF4444' : c.accent} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>
                  Site Meeting — 159 High Street, Wealdstone
                </div>
                <div style={{ fontSize: 11, color: c.textMuted, marginTop: 1 }}>
                  {demoStep === 0 && 'Ready to record'}
                  {demoStep === 1 && <span style={{ color: '#EF4444' }}>● Recording in progress…</span>}
                  {demoStep === 2 && <span style={{ color: c.accent }}>✦ AI processing transcript…</span>}
                  {demoStep === 3 && <span style={{ color: c.green }}>✓ Complete — summary ready</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 11, color: c.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} /> 1:14
                </div>
                <div style={{ fontSize: 11, color: c.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={12} /> 2
                </div>
              </div>
            </div>

            {/* Waveform strip */}
            <div style={{
              padding: '12px 20px',
              borderBottom: `1px solid ${c.border}`,
              background: isDark ? '#080D18' : '#F9FAFB',
            }}>
              <Waveform active={demoStep === 1} />
            </div>

            {/* Tabs */}
            <div style={{
              display: 'flex',
              borderBottom: `1px solid ${c.border}`,
            }}>
              {['transcript', 'summary', 'actions', 'email'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: '10px 18px',
                  fontSize: 12, fontWeight: 600,
                  color: activeTab === tab ? c.accent : c.textMuted,
                  background: 'transparent', border: 'none',
                  borderBottom: activeTab === tab ? `2px solid ${c.accent}` : '2px solid transparent',
                  cursor: 'pointer', textTransform: 'capitalize',
                  transition: 'color 0.15s',
                }}>
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ padding: '20px', minHeight: 260 }}>

              {/* TRANSCRIPT */}
              {activeTab === 'transcript' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {demoStep === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: c.textMuted, fontSize: 13 }}>
                      Press <strong style={{ color: c.text }}>Watch Live Demo</strong> to see the transcript generate in real time.
                    </div>
                  )}
                  {TRANSCRIPT_LINES.slice(0, visibleLines).map((line, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 12,
                      animation: 'fadeSlideIn 0.3s ease',
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        color: line.speaker === 'AI QS' ? c.accent : c.blue,
                        width: 44, flexShrink: 0, paddingTop: 2, letterSpacing: '0.04em',
                      }}>
                        {line.speaker}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, color: c.text, lineHeight: 1.5 }}>{line.text}</div>
                        <div style={{ fontSize: 11, color: c.textMuted, marginTop: 3 }}>{line.time}</div>
                      </div>
                    </div>
                  ))}
                  {demoStep === 2 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '12px 16px', borderRadius: 9,
                      background: c.accentDim, border: `1px solid ${c.accentBorder}`,
                      fontSize: 12, color: c.accent, fontWeight: 600,
                      animation: 'fadeSlideIn 0.3s ease',
                    }}>
                      <Sparkle size={14} /> AI is generating your summary…
                    </div>
                  )}
                </div>
              )}

              {/* SUMMARY */}
              {activeTab === 'summary' && (
                <div>
                  {demoStep === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: c.textMuted, fontSize: 13 }}>
                      Run the demo to generate an AI summary.
                    </div>
                  )}
                  <div style={{ marginBottom: 18 }}>
                    {SUMMARY_POINTS.slice(0, visibleSummary).map((point, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 10, marginBottom: 12,
                        animation: 'fadeSlideIn 0.35s ease',
                      }}>
                        <div style={{ flexShrink: 0, marginTop: 1 }}>
                          <CheckCircle size={15} color={c.green} />
                        </div>
                        <div style={{ fontSize: 13.5, color: c.text, lineHeight: 1.5 }}>{point}</div>
                      </div>
                    ))}
                  </div>
                  {demoStep === 3 && visibleSummary === SUMMARY_POINTS.length && (
                    <div style={{
                      padding: '12px 16px', borderRadius: 9,
                      background: c.greenDim, border: `1px solid rgba(16,185,129,0.25)`,
                      fontSize: 12, color: c.green, fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: 8,
                      animation: 'fadeSlideIn 0.3s ease',
                    }}>
                      <CheckCircle size={13} color={c.green} /> Summary complete — follow-up email drafted automatically
                    </div>
                  )}
                </div>
              )}

              {/* ACTION ITEMS */}
              {activeTab === 'actions' && (
                <div>
                  <div style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>
                    AI-extracted action items from this meeting
                  </div>
                  {ACTION_ITEMS.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 9, marginBottom: 8,
                      background: item.done ? c.greenDim : c.surfaceAlt,
                      border: `1px solid ${item.done ? 'rgba(16,185,129,0.2)' : c.border}`,
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        background: item.done ? c.green : 'transparent',
                        border: `2px solid ${item.done ? c.green : c.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {item.done && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5 3.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1, fontSize: 13, color: item.done ? c.textMuted : c.text, textDecoration: item.done ? 'line-through' : 'none' }}>
                        {item.text}
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                        color: item.owner === 'AI QS' ? c.accent : c.blue,
                        background: item.owner === 'AI QS' ? c.accentDim : c.blueDim,
                        padding: '2px 7px', borderRadius: 5,
                      }}>
                        {item.owner}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* EMAIL DRAFT */}
              {activeTab === 'email' && (
                <div>
                  <div style={{
                    background: c.surfaceAlt, borderRadius: 10, padding: '16px 18px',
                    border: `1px solid ${c.border}`,
                    fontFamily: 'monospace',
                  }}>
                    <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 14, fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div><strong style={{ color: c.text }}>To:</strong> &nbsp;justin.shee@jbpdev.co.uk</div>
                      <div><strong style={{ color: c.text }}>Subject:</strong> &nbsp;Site Meeting Notes — 159 High Street, Wealdstone</div>
                    </div>
                    <div style={{ fontSize: 13, color: c.text, lineHeight: 1.75, fontFamily: 'inherit' }}>
                      <p>Hi Justin,</p>
                      <br />
                      <p>Following today's site meeting, please find below a summary of the key points discussed:</p>
                      <br />
                      <p><strong>RC Structure:</strong> Flat slab arrangement confirmed for floors 6–7. I'll incorporate a post-tensioning allowance into the BOQ accordingly.</p>
                      <br />
                      <p><strong>M&E Package:</strong> A provisional sum of £180,000 has been included. The variation risk is flagged in the findings report.</p>
                      <br />
                      <p>Please send over the revised ceiling height drawings when available. I'll aim to have the updated BOQ with you within 3 working days.</p>
                      <br />
                      <p>Kind regards,<br />Stephen<br />The AI QS</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button style={{
                      padding: '8px 18px', borderRadius: 8,
                      background: c.accent, color: '#0A0F1C',
                      border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    }}>
                      Send Email
                    </button>
                    <button style={{
                      padding: '8px 18px', borderRadius: 8,
                      background: 'transparent', color: c.textMuted,
                      border: `1px solid ${c.border}`, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                    }}>
                      Edit Draft
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* FEATURES GRID */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>
            FEATURES
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 24px', color: c.text }}>
            Built for construction professionals
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            {[
              { icon: '🏗️', title: 'Construction vocabulary', desc: 'Understands QS terms — RC frame, post-tensioning, provisional sums, dayworks, variations, and more.' },
              { icon: '🔒', title: 'Private by design', desc: 'Audio processed on your device. Nothing is uploaded to third-party servers. Your data stays yours.' },
              { icon: '⚡', title: 'Instant summaries', desc: 'From end of call to formatted summary in under 30 seconds. No waiting, no uploading.' },
              { icon: '📧', title: 'Auto follow-up emails', desc: 'Drafts are written in your tone, referencing the correct project, client, and action items.' },
              { icon: '📋', title: 'Variation flagging', desc: 'AI automatically highlights language patterns that indicate a contractual variation.' },
              { icon: '🔗', title: 'Links to your BOQ', desc: 'Meeting notes attach directly to the relevant project inside the AI QS Portal.' },
            ].map(f => (
              <div key={f.title} style={{
                background: c.surface,
                border: `1px solid ${c.border}`,
                borderRadius: 12,
                padding: '18px 18px',
                transition: 'border-color 0.2s',
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = c.accentBorder}
                onMouseLeave={e => e.currentTarget.style.borderColor = c.border}
              >
                <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: c.text, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12.5, color: c.textMuted, lineHeight: 1.55 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* USE CASES */}
        <section style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>
            USE CASES
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 22px', color: c.text }}>
            Where it saves you time
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {[
              {
                title: 'Site visits',
                desc: 'Capture site instructions, progress notes, and defect lists without stopping to type. Review and send the summary on your drive back.',
                color: c.accent,
              },
              {
                title: 'Client briefings',
                desc: 'Never lose a client instruction again. Full transcript gives you a defensible record of what was agreed, and when.',
                color: c.blue,
              },
              {
                title: 'Design team calls',
                desc: 'Architects, engineers, and planners on one call? AI separates the speakers and tracks each party\'s commitments.',
                color: c.green,
              },
            ].map(uc => (
              <div key={uc.title} style={{
                background: c.surface,
                border: `1px solid ${c.border}`,
                borderRadius: 12, padding: '22px 20px',
                borderTop: `3px solid ${uc.color}`,
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: c.text, marginBottom: 8 }}>{uc.title}</div>
                <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.6 }}>{uc.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA BANNER */}
        <div style={{
          background: isDark
            ? 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(59,130,246,0.08) 100%)'
            : 'linear-gradient(135deg, #FEF3C7 0%, #EFF6FF 100%)',
          border: `1px solid ${c.accentBorder}`,
          borderRadius: 16, padding: '32px 32px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c.text, marginBottom: 6 }}>
              Ready to try the AI QS Notetaker?
            </div>
            <div style={{ fontSize: 13, color: c.textMuted }}>
              Powered by Inbo — our AI assistant platform for construction professionals.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a
              href="https://getinbo.io"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 22px', borderRadius: 9,
                background: c.accent, color: '#0A0F1C',
                fontWeight: 700, fontSize: 13, textDecoration: 'none',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              Visit getinbo.io <ArrowRight size={14} />
            </a>
            <button onClick={runDemo} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '11px 22px', borderRadius: 9,
              background: 'transparent', color: c.text,
              border: `1px solid ${c.border}`,
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>
              Watch Demo
            </button>
          </div>
        </div>

      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        @keyframes pulse-bar {
          from { opacity: 0.7; }
          to   { opacity: 1; transform: scaleY(1.15); }
        }
      `}</style>
    </div>
  );
}

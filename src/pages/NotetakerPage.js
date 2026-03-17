import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

// ── Icons ─────────────────────────────────────────────────────────────────────
const MicIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);
const FileTextIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);
const MailIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);
const ShieldIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const ZapIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);
const CheckIcon = ({ size = 13, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const ArrowRightIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>
);
const ClockIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const BatteryIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="6" width="18" height="12" rx="2"/>
    <line x1="23" y1="13" x2="23" y2="11"/>
    <line x1="5" y1="12" x2="10" y2="12"/>
  </svg>
);
const GlobeIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);
const UsersIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4-4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const STRIPE_URL = 'https://buy.stripe.com/14A6oH5Fe1B6cV21LK73G08';

const PRODUCT_IMAGES = [
  'https://m.media-amazon.com/images/I/61bPIiCFMrL._AC_SL1500_.jpg',
  'https://m.media-amazon.com/images/I/71wkS3RRDEL._AC_SL1500_.jpg',
  'https://m.media-amazon.com/images/I/71YCkz1QMIL._AC_SL1500_.jpg',
];

const USE_CASES = {
  site: {
    label: 'Site visits',
    title: 'Never miss a site instruction again',
    body: 'Clip it to your jacket and walk the job. When you get back to the car, your notes, snag list, and action items are already written. The AI flags any language that sounds like a variation instruction.',
    points: ['Full transcript in under 30 seconds', 'Variation flags highlighted automatically', 'Action items extracted with owner and deadline'],
  },
  client: {
    label: 'Client calls',
    title: 'Every agreement. On the record.',
    body: 'Record client briefings and phone calls and get a clean summary the moment they end. A follow-up email draft is generated automatically, referencing the right project, client name, and agreed actions.',
    points: ['Speaker-separated transcript', 'Follow-up email drafted instantly', 'Defensible record of every instruction'],
  },
  design: {
    label: 'Design team meetings',
    title: 'Track every decision across disciplines',
    body: 'Architects, engineers, planners — when everyone is talking, things get missed. The AI Notetaker captures the full conversation, attributes actions to the right party, and connects notes to your project in the portal.',
    points: ['Multi-speaker support up to 4 parties', 'Actions attributed by discipline', 'Links directly to your AI QS Portal project'],
  },
};

export default function NotetakerPage() {
  const { t, mode } = useTheme();
  const [activeImg, setActiveImg] = useState(0);
  const [activeTab, setActiveTab] = useState('site');
  const [imgError, setImgError] = useState({});

  const isDark = mode === 'dark';

  const c = {
    bg:           isDark ? '#0A0F1C' : '#F8F9FB',
    surface:      isDark ? '#111827' : '#FFFFFF',
    surfaceAlt:   isDark ? '#0F1929' : '#F3F4F6',
    border:       isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)',
    text:         isDark ? '#F1F5F9' : '#111827',
    textMuted:    isDark ? '#94A3B8' : '#6B7280',
    accent:       '#F59E0B',
    accentDim:    isDark ? 'rgba(245,158,11,0.10)' : 'rgba(245,158,11,0.08)',
    accentBorder: 'rgba(245,158,11,0.28)',
    green:        '#10B981',
    greenDim:     isDark ? 'rgba(16,185,129,0.10)' : 'rgba(16,185,129,0.08)',
  };

  const BuyButton = ({ label = 'Buy Now — £150', large = false }) => (
    <a
      href={STRIPE_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: large ? '14px 32px' : '11px 22px',
        borderRadius: 9, background: c.accent, color: '#0A0F1C',
        fontWeight: 700, fontSize: large ? 15 : 13.5,
        textDecoration: 'none', letterSpacing: '-0.01em',
        transition: 'opacity 0.18s, transform 0.18s', whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'none'; }}
    >
      {label} <ArrowRightIcon size={14} color="#0A0F1C" />
    </a>
  );

  const specRow = (label, value) => (
    <div key={label} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: `1px solid ${c.border}`,
    }}>
      <span style={{ fontSize: 13, color: c.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{value}</span>
    </div>
  );

  const activeCase = USE_CASES[activeTab];

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text }}>

      {/* ── HERO ── */}
      <div style={{
        borderBottom: `1px solid ${c.border}`,
        background: isDark
          ? 'linear-gradient(160deg, #0A0F1C 0%, #111827 55%, #0A0F1C 100%)'
          : 'linear-gradient(160deg, #F8F9FB 0%, #FFFFFF 55%, #FFFBF0 100%)',
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '52px 28px 56px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) auto',
            gap: 48, alignItems: 'center',
          }}>
            {/* Left copy */}
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 20, marginBottom: 22,
                background: c.accentDim, border: `1px solid ${c.accentBorder}`,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: c.accent,
              }}>
                <MicIcon size={12} color={c.accent} /> New — AI QS Notetaker
              </div>

              <h1 style={{
                fontSize: 'clamp(28px, 4vw, 46px)',
                fontWeight: 800, letterSpacing: '-0.03em',
                lineHeight: 1.1, margin: '0 0 18px', color: c.text,
              }}>
                Record any meeting.<br />
                <span style={{ color: c.accent }}>Get a BOQ-ready summary.</span>
              </h1>

              <p style={{
                fontSize: 16, color: c.textMuted,
                lineHeight: 1.7, margin: '0 0 32px', maxWidth: 500,
              }}>
                A pocket-sized AI voice recorder built for construction professionals.
                Capture site visits, client calls, and design team meetings —
                then get a full transcript, action items, and a draft follow-up
                email delivered straight to your AI QS Portal.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <BuyButton label="Buy Now — £150" large />
                <span style={{ fontSize: 12.5, color: c.textMuted }}>Free shipping · UK &amp; Ireland</span>
              </div>

              <div style={{
                display: 'flex', gap: 24, marginTop: 32, paddingTop: 24,
                borderTop: `1px solid ${c.border}`, flexWrap: 'wrap',
              }}>
                {[
                  { val: '< 30s', sub: 'Time to summary' },
                  { val: '112hrs', sub: 'Battery life' },
                  { val: '112', sub: 'Languages supported' },
                ].map(s => (
                  <div key={s.sub}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: c.accent, letterSpacing: '-0.02em' }}>{s.val}</div>
                    <div style={{ fontSize: 11.5, color: c.textMuted, marginTop: 2 }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — product image */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 210, height: 250, borderRadius: 14,
                background: isDark ? '#0F1929' : '#EFEFEF',
                border: `1px solid ${c.border}`, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {imgError[activeImg] ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <MicIcon size={40} color={c.accentBorder} />
                    <span style={{ fontSize: 11, color: c.textMuted }}>Device image</span>
                  </div>
                ) : (
                  <img
                    src={PRODUCT_IMAGES[activeImg]}
                    alt="AI QS Notetaker"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setImgError(prev => ({ ...prev, [activeImg]: true }))}
                  />
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {PRODUCT_IMAGES.map((src, i) => (
                  <button key={i} onClick={() => setActiveImg(i)} style={{
                    width: 46, height: 54, borderRadius: 8, overflow: 'hidden',
                    border: `2px solid ${activeImg === i ? c.accent : c.border}`,
                    background: c.surfaceAlt, cursor: 'pointer', padding: 0,
                    transition: 'border-color 0.15s',
                  }}>
                    {!imgError[i] && (
                      <img
                        src={src} alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={() => setImgError(prev => ({ ...prev, [i]: true }))}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 28px 80px' }}>

        {/* FEATURES */}
        <section style={{ marginBottom: 60 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>Features</p>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em', margin: '0 0 28px', color: c.text }}>
            Everything a QS needs on site
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {[
              { Icon: MicIcon,       title: '5m recording radius',  desc: '4-MEMS mic array with AI beamforming captures every voice, even in noisy site environments.' },
              { Icon: ClockIcon,     title: '112-hour battery',     desc: 'Lasts the whole working week on standby. Up to 8 hours of continuous recording per charge.' },
              { Icon: FileTextIcon,  title: 'Instant transcript',   desc: 'Full text with speaker labels ready in under 30 seconds once recording ends.' },
              { Icon: ZapIcon,       title: 'AI summary',           desc: 'Key decisions, action items, and variation flags extracted automatically.' },
              { Icon: MailIcon,      title: 'Auto follow-up email', desc: 'Draft written in your tone, linked to the right project in the portal.' },
              { Icon: ShieldIcon,    title: 'Private by design',    desc: 'Audio processed on-device. Nothing shared with third-party servers.' },
              { Icon: GlobeIcon,     title: '112 languages',        desc: 'Transcribes and summarises in English, Irish, Polish and 109 other languages.' },
              { Icon: BatteryIcon,   title: 'Magnetic clip',        desc: 'Attaches to your jacket, collar, or high-vis vest. Stays out of the way.' },
              { Icon: UsersIcon,     title: 'Multi-speaker',        desc: 'Separates up to 4 speakers automatically — so you always know who said what.' },
            ].map(f => (
              <div key={f.title}
                style={{
                  background: c.surface, border: `1px solid ${c.border}`,
                  borderRadius: 12, padding: '18px 16px', transition: 'border-color 0.18s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = c.accentBorder}
                onMouseLeave={e => e.currentTarget.style.borderColor = c.border}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 9, marginBottom: 12,
                  background: c.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <f.Icon size={18} color={c.accent} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.text, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: c.textMuted, lineHeight: 1.55 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* USE CASES */}
        <section style={{ marginBottom: 60 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>Use cases</p>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em', margin: '0 0 24px', color: c.text }}>
            Built for how you actually work
          </h2>

          <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
            {Object.entries(USE_CASES).map(([key, val]) => (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                padding: '8px 16px', borderRadius: 8,
                background: activeTab === key ? c.accent : c.surfaceAlt,
                color: activeTab === key ? '#0A0F1C' : c.textMuted,
                border: `1px solid ${activeTab === key ? c.accent : c.border}`,
                fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {val.label}
              </button>
            ))}
          </div>

          <div style={{
            background: c.surface, border: `1px solid ${c.border}`,
            borderTop: `3px solid ${c.accent}`,
            borderRadius: 12, padding: '26px 26px',
          }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: c.text, margin: '0 0 10px', letterSpacing: '-0.02em' }}>
              {activeCase.title}
            </h3>
            <p style={{ fontSize: 14, color: c.textMuted, lineHeight: 1.7, margin: '0 0 18px', maxWidth: 540 }}>
              {activeCase.body}
            </p>
            {activeCase.points.map(point => (
              <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 9 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  background: c.greenDim, border: `1px solid rgba(16,185,129,0.25)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CheckIcon size={11} color={c.green} />
                </div>
                <span style={{ fontSize: 13.5, color: c.text, lineHeight: 1.55 }}>{point}</span>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section style={{ marginBottom: 60 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>How it works</p>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em', margin: '0 0 24px', color: c.text }}>
            Three steps from meeting to action
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
            {[
              { n: '01', Icon: MicIcon,      title: 'Record',     desc: 'Press record before you walk on site. The device clips to your clothes and captures everything, hands free, with background noise filtered.' },
              { n: '02', Icon: FileTextIcon, title: 'Transcribe', desc: 'When you stop recording, the AI generates a full transcript with speaker labels and a clean bullet-point summary in seconds.' },
              { n: '03', Icon: MailIcon,     title: 'Action',     desc: 'Action items are extracted, a follow-up email is drafted, and everything syncs to the right project in your AI QS Portal.' },
            ].map(step => (
              <div key={step.n} style={{
                background: c.surface, border: `1px solid ${c.border}`,
                borderRadius: 12, padding: '22px 20px', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: 14, right: 16,
                  fontSize: 36, fontWeight: 900, color: c.border,
                  letterSpacing: '-0.04em', lineHeight: 1, userSelect: 'none',
                }}>{step.n}</div>
                <div style={{
                  width: 38, height: 38, borderRadius: 9, background: c.accentDim,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 13,
                }}>
                  <step.Icon size={18} color={c.accent} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 7 }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: c.textMuted, lineHeight: 1.6 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* SPECS */}
        <section style={{ marginBottom: 60 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>Specifications</p>
          <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em', margin: '0 0 24px', color: c.text }}>
            Technical details
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {[
              {
                heading: 'Audio',
                rows: [['Microphones','4 × MEMS + 1 VPU'],['Recording range','Up to 5 metres'],['Audio format','AAC / MP3'],['Sample rate','16kHz / 44.1kHz']],
              },
              {
                heading: 'Battery & Storage',
                rows: [['Standby time','112 hours'],['Recording time','8 hours per charge'],['Storage','64 GB built-in'],['Charging','USB-C, 2 hours']],
              },
              {
                heading: 'AI & Software',
                rows: [['Languages','112'],['Summary speed','< 30 seconds'],['Speakers','Up to 4 separated'],['Portal sync','AI QS Portal']],
              },
            ].map(group => (
              <div key={group.heading} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 12, padding: '20px 20px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>{group.heading}</div>
                {group.rows.map(([label, value]) => specRow(label, value))}
              </div>
            ))}
          </div>
        </section>

        {/* BUY CTA */}
        <div style={{
          background: isDark
            ? 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(245,158,11,0.04) 100%)'
            : 'linear-gradient(135deg, #FFFBF0 0%, #FEF9EE 100%)',
          border: `1px solid ${c.accentBorder}`,
          borderRadius: 16, padding: '36px 32px',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'space-between', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.text, letterSpacing: '-0.025em', marginBottom: 6 }}>
              AI QS Notetaker — £150
            </div>
            <div style={{ fontSize: 14, color: c.textMuted, marginBottom: 16, lineHeight: 1.65 }}>
              One-time purchase. Free shipping to UK &amp; Ireland.<br />
              Works out of the box with your AI QS Portal.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              {['Free UK & Ireland shipping', '30-day returns', 'AI QS Portal included'].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <CheckIcon size={13} color={c.green} />
                  <span style={{ fontSize: 12.5, color: c.textMuted }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <BuyButton label="Order Now — £150" large />
        </div>

      </div>
    </div>
  );
}

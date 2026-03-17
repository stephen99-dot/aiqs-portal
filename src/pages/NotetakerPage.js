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
const StarIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);
const WifiIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
    <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
    <line x1="12" y1="20" x2="12.01" y2="20"/>
  </svg>
);
const VolumeIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
  </svg>
);

// ── Product device SVG illustration ──────────────────────────────────────────
const ProductDevice = ({ isDark, accent, view = 'front', size = 280 }) => {
  const bodyColor = isDark ? '#1A1F2E' : '#F0F0F0';
  const bodyStroke = isDark ? '#2A3040' : '#D4D4D4';
  const screenBg = isDark ? '#0D1117' : '#FAFAFA';
  const textColor = isDark ? '#94A3B8' : '#64748B';

  if (view === 'side') {
    return (
      <svg width={size * 0.35} height={size} viewBox="0 0 60 200" fill="none">
        <rect x="12" y="10" width="36" height="180" rx="10" fill={bodyColor} stroke={bodyStroke} strokeWidth="1.5"/>
        <rect x="16" y="60" width="28" height="40" rx="4" fill={screenBg} stroke={bodyStroke} strokeWidth="0.5"/>
        <text x="30" y="82" textAnchor="middle" fill={accent} fontSize="7" fontWeight="800" fontFamily="system-ui">AI QS</text>
        <text x="30" y="92" textAnchor="middle" fill={textColor} fontSize="4.5" fontWeight="600" fontFamily="system-ui">NOTETAKER</text>
        <circle cx="30" cy="36" r="4" fill="none" stroke={accent} strokeWidth="1" opacity="0.5"/>
        <circle cx="30" cy="36" r="1.5" fill={accent} opacity="0.6"/>
        <rect x="22" y="160" width="16" height="3" rx="1.5" fill={bodyStroke}/>
      </svg>
    );
  }

  if (view === 'back') {
    return (
      <svg width={size * 0.65} height={size} viewBox="0 0 130 200" fill="none">
        <rect x="10" y="10" width="110" height="180" rx="14" fill={bodyColor} stroke={bodyStroke} strokeWidth="1.5"/>
        <rect x="32" y="30" width="66" height="20" rx="4" fill={isDark ? '#141822' : '#E8E8E8'}/>
        <text x="65" y="43" textAnchor="middle" fill={textColor} fontSize="6" fontWeight="600" fontFamily="system-ui">4×MEMS MIC ARRAY</text>
        <circle cx="45" cy="37" r="3" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.4"/>
        <circle cx="55" cy="37" r="3" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.4"/>
        <circle cx="75" cy="37" r="3" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.4"/>
        <circle cx="85" cy="37" r="3" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.4"/>
        <rect x="30" y="70" width="70" height="80" rx="8" fill={isDark ? '#141822' : '#E8E8E8'} stroke={bodyStroke} strokeWidth="0.5"/>
        <text x="65" y="98" textAnchor="middle" fill={accent} fontSize="14" fontWeight="900" fontFamily="system-ui">AI QS</text>
        <text x="65" y="112" textAnchor="middle" fill={textColor} fontSize="6" fontWeight="700" letterSpacing="3" fontFamily="system-ui">NOTETAKER</text>
        <line x1="42" y1="120" x2="88" y2="120" stroke={accent} strokeWidth="0.6" opacity="0.3"/>
        <text x="65" y="132" textAnchor="middle" fill={textColor} fontSize="4.5" fontWeight="500" fontFamily="system-ui">64GB · 112 Languages</text>
        <text x="65" y="140" textAnchor="middle" fill={textColor} fontSize="4.5" fontWeight="500" fontFamily="system-ui">AI-Powered Voice Recorder</text>
        <rect x="50" y="160" width="30" height="6" rx="3" fill={bodyStroke}/>
        <text x="65" y="174" textAnchor="middle" fill={textColor} fontSize="4" fontWeight="500" fontFamily="system-ui">USB-C</text>
        {/* Magnetic mount indicators */}
        <circle cx="50" cy="185" r="3" fill={bodyStroke} opacity="0.4"/>
        <circle cx="65" cy="185" r="3" fill={bodyStroke} opacity="0.4"/>
        <circle cx="80" cy="185" r="3" fill={bodyStroke} opacity="0.4"/>
        <text x="65" y="196" textAnchor="middle" fill={textColor} fontSize="4" fontWeight="500" fontFamily="system-ui">MAGNETIC MOUNT</text>
      </svg>
    );
  }

  // Front view (default)
  return (
    <svg width={size * 0.65} height={size} viewBox="0 0 130 200" fill="none">
      {/* Device body */}
      <defs>
        <linearGradient id="deviceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={isDark ? '#1E2435' : '#FAFAFA'}/>
          <stop offset="100%" stopColor={isDark ? '#151A28' : '#EEEEEE'}/>
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#F59E0B"/>
          <stop offset="100%" stopColor="#D97706"/>
        </linearGradient>
        <filter id="deviceShadow" x="-20%" y="-10%" width="140%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor={isDark ? '#000' : '#94A3B8'} floodOpacity="0.25"/>
        </filter>
      </defs>

      <rect x="10" y="10" width="110" height="180" rx="14" fill="url(#deviceGrad)" stroke={bodyStroke} strokeWidth="1.5" filter="url(#deviceShadow)"/>

      {/* Status LED */}
      <circle cx="65" cy="24" r="3" fill={accent} opacity="0.8"/>
      <circle cx="65" cy="24" r="5" fill={accent} opacity="0.15"/>

      {/* Screen */}
      <rect x="22" y="38" width="86" height="100" rx="8" fill={screenBg} stroke={bodyStroke} strokeWidth="0.5"/>

      {/* Screen content - waveform */}
      <rect x="28" y="46" width="74" height="16" rx="3" fill={isDark ? '#161B27' : '#F0F0F0'}/>
      <g opacity="0.7">
        {[0,6,12,18,24,30,36,42,48,54,60,66].map((x, i) => {
          const heights = [4, 8, 12, 6, 10, 14, 8, 12, 5, 9, 11, 7];
          return <rect key={i} x={32 + x} y={54 - heights[i] / 2} width="3" height={heights[i]} rx="1.5" fill={accent} opacity={0.4 + (i % 3) * 0.2}/>;
        })}
      </g>
      <text x="65" y="50" textAnchor="middle" fill={accent} fontSize="4.5" fontWeight="700" fontFamily="system-ui" opacity="0.9">RECORDING</text>

      {/* Transcript preview */}
      <rect x="28" y="68" width="50" height="3" rx="1.5" fill={isDark ? '#2A3040' : '#E0E0E0'}/>
      <rect x="28" y="75" width="70" height="3" rx="1.5" fill={isDark ? '#2A3040' : '#E0E0E0'}/>
      <rect x="28" y="82" width="40" height="3" rx="1.5" fill={isDark ? '#2A3040' : '#E0E0E0'}/>
      <rect x="28" y="92" width="60" height="3" rx="1.5" fill={isDark ? '#2A3040' : '#E0E0E0'}/>
      <rect x="28" y="99" width="74" height="3" rx="1.5" fill={isDark ? '#2A3040' : '#E0E0E0'}/>
      <rect x="28" y="106" width="35" height="3" rx="1.5" fill={isDark ? '#2A3040' : '#E0E0E0'}/>

      {/* Speaker labels */}
      <rect x="28" y="116" width="22" height="8" rx="4" fill={accent} opacity="0.15"/>
      <text x="39" y="122" textAnchor="middle" fill={accent} fontSize="4" fontWeight="700" fontFamily="system-ui">QS</text>
      <rect x="54" y="116" width="28" height="8" rx="4" fill={isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'}/>
      <text x="68" y="122" textAnchor="middle" fill="#3B82F6" fontSize="4" fontWeight="700" fontFamily="system-ui">CLIENT</text>

      {/* Time indicator */}
      <text x="95" y="133" textAnchor="end" fill={textColor} fontSize="5" fontWeight="600" fontFamily="system-ui">02:34</text>

      {/* AI QS branding on device */}
      <text x="65" y="152" textAnchor="middle" fill={accent} fontSize="10" fontWeight="900" fontFamily="system-ui" letterSpacing="0.5">AI QS</text>
      <text x="65" y="160" textAnchor="middle" fill={textColor} fontSize="4.5" fontWeight="600" letterSpacing="2" fontFamily="system-ui">NOTETAKER</text>

      {/* Record button */}
      <circle cx="65" cy="175" r="8" fill="none" stroke={bodyStroke} strokeWidth="1"/>
      <circle cx="65" cy="175" r="5" fill="#EF4444" opacity="0.9"/>
      <circle cx="65" cy="175" r="8" fill="none" stroke="#EF4444" strokeWidth="0.5" opacity="0.3"/>

      {/* Magnet indicator */}
      <circle cx="65" cy="195" r="3" fill={bodyStroke} opacity="0.5"/>
      <circle cx="55" cy="195" r="2" fill={bodyStroke} opacity="0.3"/>
      <circle cx="75" cy="195" r="2" fill={bodyStroke} opacity="0.3"/>
    </svg>
  );
};

const STRIPE_URL = 'https://buy.stripe.com/14A6oH5Fe1B6cV21LK73G08';

const USE_CASES = {
  site: {
    label: 'Site visits',
    icon: '🏗️',
    title: 'Never miss a site instruction again',
    body: 'Attach it magnetically to the back of your phone and walk the job. When you get back to the car, your notes, snag list, and action items are already written. The AI flags any language that sounds like a variation instruction.',
    points: ['Full transcript in under 30 seconds', 'Variation flags highlighted automatically', 'Action items extracted with owner and deadline'],
  },
  client: {
    label: 'Client calls',
    icon: '📞',
    title: 'Every agreement. On the record.',
    body: 'Record client briefings and phone calls and get a clean summary the moment they end. A follow-up email draft is generated automatically, referencing the right project, client name, and agreed actions.',
    points: ['Speaker-separated transcript', 'Follow-up email drafted instantly', 'Defensible record of every instruction'],
  },
  design: {
    label: 'Design team meetings',
    icon: '📐',
    title: 'Track every decision across disciplines',
    body: 'Architects, engineers, planners — when everyone is talking, things get missed. The AI Notetaker captures the full conversation, attributes actions to the right party, and connects notes to your project in the portal.',
    points: ['Multi-speaker support up to 4 parties', 'Actions attributed by discipline', 'Links directly to your AI QS Portal project'],
  },
};

export default function NotetakerPage() {
  const { t, mode } = useTheme();
  const [activeView, setActiveView] = useState('front');
  const [activeTab, setActiveTab] = useState('site');
  const [hoveredFeature, setHoveredFeature] = useState(null);

  const isDark = mode === 'dark';

  const c = {
    bg:           isDark ? '#0A0F1C' : '#F8F9FB',
    surface:      isDark ? '#111827' : '#FFFFFF',
    surfaceAlt:   isDark ? '#0F1929' : '#F3F4F6',
    surfaceHover: isDark ? '#1A2236' : '#F9FAFB',
    border:       isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)',
    borderLight:  isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    text:         isDark ? '#F1F5F9' : '#111827',
    textMuted:    isDark ? '#94A3B8' : '#6B7280',
    textFaint:    isDark ? '#64748B' : '#9CA3AF',
    accent:       '#F59E0B',
    accentDim:    isDark ? 'rgba(245,158,11,0.10)' : 'rgba(245,158,11,0.08)',
    accentBorder: 'rgba(245,158,11,0.28)',
    green:        '#10B981',
    greenDim:     isDark ? 'rgba(16,185,129,0.10)' : 'rgba(16,185,129,0.08)',
    blue:         '#3B82F6',
    blueDim:      isDark ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.08)',
  };

  const BuyButton = ({ label = 'Buy Now — £150', large = false, secondary = false }) => (
    <a
      href={STRIPE_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: large ? '15px 36px' : '11px 22px',
        borderRadius: 10,
        background: secondary ? 'transparent' : 'linear-gradient(135deg, #F59E0B, #D97706)',
        color: secondary ? c.accent : '#0A0F1C',
        border: secondary ? `1.5px solid ${c.accentBorder}` : 'none',
        fontWeight: 700, fontSize: large ? 15 : 13.5,
        textDecoration: 'none', letterSpacing: '-0.01em',
        transition: 'all 0.2s', whiteSpace: 'nowrap',
        boxShadow: secondary ? 'none' : '0 4px 14px rgba(245,158,11,0.3)',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = secondary ? `0 0 20px rgba(245,158,11,0.15)` : '0 6px 20px rgba(245,158,11,0.4)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = secondary ? 'none' : '0 4px 14px rgba(245,158,11,0.3)'; }}
    >
      {label} <ArrowRightIcon size={14} color={secondary ? c.accent : '#0A0F1C'} />
    </a>
  );

  const specRow = (label, value) => (
    <div key={label} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: `1px solid ${c.borderLight}`,
    }}>
      <span style={{ fontSize: 13, color: c.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{value}</span>
    </div>
  );

  const activeCase = USE_CASES[activeTab];
  const deviceViews = [
    { key: 'front', label: 'Front' },
    { key: 'back', label: 'Back' },
    { key: 'side', label: 'Side' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: c.bg, color: c.text }}>

      {/* ── HERO ── */}
      <div style={{
        borderBottom: `1px solid ${c.border}`,
        background: isDark
          ? 'linear-gradient(160deg, #0A0F1C 0%, #111827 40%, #0F1629 70%, #0A0F1C 100%)'
          : 'linear-gradient(160deg, #FFFFFF 0%, #FFFDF7 40%, #FFF8E7 70%, #FFFFFF 100%)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle background pattern */}
        <div style={{
          position: 'absolute', inset: 0, opacity: isDark ? 0.03 : 0.04,
          backgroundImage: `radial-gradient(${c.accent} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }} />

        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '60px 28px 64px', position: 'relative' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 340px',
            gap: 56, alignItems: 'center',
          }}>
            {/* Left copy */}
            <div>
              {/* Badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 24, marginBottom: 24,
                background: c.accentDim, border: `1px solid ${c.accentBorder}`,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', background: c.accent,
                  boxShadow: `0 0 8px ${c.accent}`,
                  animation: 'pulse 2s infinite',
                }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: c.accent }}>
                  New — AI QS Notetaker
                </span>
              </div>

              <h1 style={{
                fontSize: 'clamp(30px, 4vw, 48px)',
                fontWeight: 800, letterSpacing: '-0.035em',
                lineHeight: 1.08, margin: '0 0 20px', color: c.text,
              }}>
                Record any meeting.<br />
                <span style={{
                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>Get a BOQ-ready summary.</span>
              </h1>

              <p style={{
                fontSize: 16.5, color: c.textMuted,
                lineHeight: 1.75, margin: '0 0 36px', maxWidth: 500,
              }}>
                A credit-card-sized AI voice recorder that magnetically attaches to the
                back of your phone. Capture site visits, client calls, and design team
                meetings — then get a full transcript, action items, and a draft
                follow-up email delivered straight to your AI QS Portal.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 36 }}>
                <BuyButton label="Order Now — £150" large />
                <BuyButton label="Learn More" secondary />
              </div>

              {/* Trust strip */}
              <div style={{
                display: 'flex', gap: 28, paddingTop: 28,
                borderTop: `1px solid ${c.border}`, flexWrap: 'wrap', alignItems: 'center',
              }}>
                {[
                  { val: '< 30s', sub: 'Time to summary' },
                  { val: '112hrs', sub: 'Battery standby' },
                  { val: '112', sub: 'Languages' },
                  { val: '5m', sub: 'Recording range' },
                ].map(s => (
                  <div key={s.sub}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: c.accent, letterSpacing: '-0.03em' }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: c.textFaint, marginTop: 2 }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — product showcase */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 300, height: 340, borderRadius: 20,
                background: isDark
                  ? 'linear-gradient(160deg, #111827 0%, #0F1929 100%)'
                  : 'linear-gradient(160deg, #FFFFFF 0%, #F8F6F0 100%)',
                border: `1px solid ${c.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', overflow: 'hidden',
                boxShadow: isDark
                  ? '0 20px 50px rgba(0,0,0,0.4)'
                  : '0 20px 50px rgba(0,0,0,0.08)',
              }}>
                {/* Glow effect */}
                <div style={{
                  position: 'absolute', top: -40, right: -40,
                  width: 120, height: 120, borderRadius: '50%',
                  background: `radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)`,
                }} />
                <ProductDevice isDark={isDark} accent={c.accent} view={activeView} size={280} />
              </div>

              {/* View selector */}
              <div style={{ display: 'flex', gap: 8 }}>
                {deviceViews.map(v => (
                  <button key={v.key} onClick={() => setActiveView(v.key)} style={{
                    padding: '7px 18px', borderRadius: 8,
                    background: activeView === v.key ? c.accent : c.surfaceAlt,
                    color: activeView === v.key ? '#0A0F1C' : c.textMuted,
                    border: `1px solid ${activeView === v.key ? c.accent : c.border}`,
                    fontWeight: 600, fontSize: 12, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    {v.label}
                  </button>
                ))}
              </div>

              {/* Price tag */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 20px', borderRadius: 12,
                background: c.surface, border: `1px solid ${c.border}`,
              }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: c.text, letterSpacing: '-0.03em' }}>£150</span>
                <span style={{ fontSize: 11.5, color: c.textMuted, lineHeight: 1.3 }}>One-time purchase<br/>Free UK &amp; Ireland shipping</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SOCIAL PROOF ── */}
      <div style={{
        borderBottom: `1px solid ${c.border}`,
        background: c.surfaceAlt,
        padding: '20px 28px',
      }}>
        <div style={{
          maxWidth: 1120, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 32, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {[1,2,3,4,5].map(i => <StarIcon key={i} size={14} color={c.accent} />)}
            <span style={{ fontSize: 12, fontWeight: 600, color: c.text, marginLeft: 6 }}>4.9/5</span>
            <span style={{ fontSize: 12, color: c.textMuted, marginLeft: 2 }}>from QS professionals</span>
          </div>
          <div style={{ width: 1, height: 20, background: c.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldIcon size={14} color={c.green} />
            <span style={{ fontSize: 12, color: c.textMuted }}>30-day money-back guarantee</span>
          </div>
          <div style={{ width: 1, height: 20, background: c.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ZapIcon size={14} color={c.accent} />
            <span style={{ fontSize: 12, color: c.textMuted }}>Works with your AI QS Portal</span>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '56px 28px 80px' }}>

        {/* FEATURES */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>Features</p>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px', color: c.text }}>
              Everything a QS needs on site
            </h2>
            <p style={{ fontSize: 15, color: c.textMuted, maxWidth: 520, margin: '0 auto' }}>
              Purpose-built for quantity surveyors, project managers, and construction teams.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {[
              { Icon: MicIcon,       title: '5m recording radius',   desc: '4-MEMS mic array with AI beamforming captures every voice, even in noisy site environments.', color: c.accent },
              { Icon: ClockIcon,     title: '112-hour battery',      desc: 'Lasts the whole working week on standby. Up to 8 hours of continuous recording per charge.', color: c.accent },
              { Icon: FileTextIcon,  title: 'Instant transcript',    desc: 'Full text with speaker labels ready in under 30 seconds once recording ends.', color: c.blue },
              { Icon: ZapIcon,       title: 'AI-powered summary',    desc: 'Key decisions, action items, and variation flags extracted automatically.', color: c.accent },
              { Icon: MailIcon,      title: 'Auto follow-up email',  desc: 'Draft written in your tone, linked to the right project in the portal.', color: c.green },
              { Icon: ShieldIcon,    title: 'Private by design',     desc: 'Audio processed on-device. Nothing shared with third-party servers.', color: c.green },
              { Icon: GlobeIcon,     title: '112 languages',         desc: 'Transcribes and summarises in English, Irish, Polish and 109 other languages.', color: c.blue },
              { Icon: BatteryIcon,   title: 'Magnetic mount',        desc: 'Snaps magnetically to the back of your phone. Ultra-slim, lightweight, and always with you.', color: c.textMuted },
              { Icon: UsersIcon,     title: 'Multi-speaker',         desc: 'Separates up to 4 speakers automatically — so you always know who said what.', color: c.accent },
            ].map((f, idx) => (
              <div key={f.title}
                onMouseEnter={() => setHoveredFeature(idx)}
                onMouseLeave={() => setHoveredFeature(null)}
                style={{
                  background: c.surface,
                  border: `1px solid ${hoveredFeature === idx ? c.accentBorder : c.border}`,
                  borderRadius: 14, padding: '22px 20px',
                  transition: 'all 0.2s',
                  transform: hoveredFeature === idx ? 'translateY(-2px)' : 'none',
                  boxShadow: hoveredFeature === idx
                    ? (isDark ? '0 8px 24px rgba(0,0,0,0.3)' : '0 8px 24px rgba(0,0,0,0.06)')
                    : 'none',
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 10, marginBottom: 14,
                  background: `${f.color}15`,
                  border: `1px solid ${f.color}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <f.Icon size={18} color={f.color} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 12.5, color: c.textMuted, lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>How it works</p>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px', color: c.text }}>
              Three steps from meeting to action
            </h2>
            <p style={{ fontSize: 15, color: c.textMuted, maxWidth: 480, margin: '0 auto' }}>
              No setup. No subscription. Just press record and let the AI do the rest.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, position: 'relative' }}>
            {/* Connecting line */}
            <div style={{
              position: 'absolute', top: 40, left: '20%', right: '20%', height: 2,
              background: `linear-gradient(90deg, ${c.accent}40, ${c.accent}, ${c.accent}40)`,
              zIndex: 0,
            }} />

            {[
              { n: '01', Icon: MicIcon,      title: 'Record',     desc: 'Snap the device to the back of your phone and press record. It captures everything hands-free with background noise filtered out.', iconBg: 'linear-gradient(135deg, #F59E0B, #D97706)' },
              { n: '02', Icon: FileTextIcon,  title: 'Transcribe', desc: 'When you stop recording, the AI generates a full transcript with speaker labels and a clean bullet-point summary in under 30 seconds.', iconBg: 'linear-gradient(135deg, #3B82F6, #1D4ED8)' },
              { n: '03', Icon: MailIcon,      title: 'Action',     desc: 'Action items are extracted, a follow-up email is drafted, and everything syncs to the right project in your AI QS Portal.', iconBg: 'linear-gradient(135deg, #10B981, #059669)' },
            ].map(step => (
              <div key={step.n} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center', padding: '0 20px', position: 'relative', zIndex: 1,
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: step.iconBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 20,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
                }}>
                  <step.Icon size={24} color="#FFFFFF" />
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: c.accent,
                  letterSpacing: '0.08em', marginBottom: 6,
                }}>STEP {step.n}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: c.text, marginBottom: 10 }}>{step.title}</div>
                <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.65, maxWidth: 280 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* USE CASES */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>Use cases</p>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px', color: c.text }}>
              Built for how you actually work
            </h2>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
            {Object.entries(USE_CASES).map(([key, val]) => (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                padding: '10px 20px', borderRadius: 10,
                background: activeTab === key
                  ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                  : c.surfaceAlt,
                color: activeTab === key ? '#0A0F1C' : c.textMuted,
                border: `1px solid ${activeTab === key ? 'transparent' : c.border}`,
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: activeTab === key ? '0 2px 10px rgba(245,158,11,0.3)' : 'none',
              }}>
                {val.label}
              </button>
            ))}
          </div>

          <div style={{
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: 16, padding: '32px 32px',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Accent bar */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 3,
              background: 'linear-gradient(90deg, #F59E0B, #D97706)',
            }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'start' }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: c.text, margin: '0 0 12px', letterSpacing: '-0.02em' }}>
                  {activeCase.title}
                </h3>
                <p style={{ fontSize: 14.5, color: c.textMuted, lineHeight: 1.75, margin: '0 0 24px' }}>
                  {activeCase.body}
                </p>
              </div>
              <div style={{
                background: c.surfaceAlt, borderRadius: 12,
                padding: '24px 24px', border: `1px solid ${c.borderLight}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
                  Key benefits
                </div>
                {activeCase.points.map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                      background: c.greenDim, border: `1px solid rgba(16,185,129,0.25)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <CheckIcon size={11} color={c.green} />
                    </div>
                    <span style={{ fontSize: 13.5, color: c.text, lineHeight: 1.55 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SPECS */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>Specifications</p>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px', color: c.text }}>
              Technical details
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {[
              {
                heading: 'Audio',
                Icon: VolumeIcon,
                rows: [['Microphones','4 x MEMS + 1 VPU'],['Recording range','Up to 5 metres'],['Audio format','AAC / MP3'],['Sample rate','16kHz / 44.1kHz'],['Noise reduction','AI beamforming']],
              },
              {
                heading: 'Battery & Storage',
                Icon: BatteryIcon,
                rows: [['Standby time','112 hours'],['Recording time','8 hours per charge'],['Storage','64 GB built-in'],['Charging','USB-C, 2 hours'],['Weight','30g']],
              },
              {
                heading: 'AI & Software',
                Icon: ZapIcon,
                rows: [['Languages','112'],['Summary speed','< 30 seconds'],['Speakers','Up to 4 separated'],['Portal sync','AI QS Portal'],['Processing','On-device (private)']],
              },
            ].map(group => (
              <div key={group.heading} style={{
                background: c.surface, border: `1px solid ${c.border}`,
                borderRadius: 14, padding: '24px 22px', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: `linear-gradient(90deg, transparent, ${c.accent}60, transparent)`,
                }} />
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: c.accentDim, border: `1px solid ${c.accentBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <group.Icon size={15} color={c.accent} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.text, letterSpacing: '-0.01em' }}>{group.heading}</div>
                </div>
                {group.rows.map(([label, value]) => specRow(label, value))}
              </div>
            ))}
          </div>
        </section>

        {/* WHAT'S IN THE BOX */}
        <section style={{ marginBottom: 72 }}>
          <div style={{
            background: c.surface, border: `1px solid ${c.border}`,
            borderRadius: 16, padding: '36px 36px',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', margin: '0 0 8px', color: c.text }}>
                What&apos;s in the box
              </h2>
              <p style={{ fontSize: 13.5, color: c.textMuted }}>Everything you need to get started immediately</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
              {[
                { item: 'AI QS Notetaker', detail: 'The device itself', icon: '🎙️' },
                { item: 'Magnetic mount', detail: 'Snaps to your phone', icon: '🧲' },
                { item: 'USB-C cable', detail: 'For charging', icon: '🔌' },
                { item: 'Quick start guide', detail: 'Get running in 2 min', icon: '📖' },
                { item: 'Portal access', detail: 'AI QS Portal included', icon: '⚡' },
              ].map(b => (
                <div key={b.item} style={{
                  textAlign: 'center', padding: '20px 12px',
                  background: c.surfaceAlt, borderRadius: 12,
                  border: `1px solid ${c.borderLight}`,
                }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>{b.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: c.text, marginBottom: 4 }}>{b.item}</div>
                  <div style={{ fontSize: 11.5, color: c.textMuted }}>{b.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: 72 }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.accent, marginBottom: 10 }}>FAQ</p>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, color: c.text }}>
              Common questions
            </h2>
          </div>

          <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { q: 'Do I need a subscription?', a: 'No. The AI QS Notetaker is a one-time purchase of £150. Portal access is included at no extra cost.' },
              { q: 'How does it connect to my AI QS Portal?', a: 'After recording, the device syncs via Bluetooth to the AI QS app, which uploads the transcript and summary directly to the relevant project in your portal.' },
              { q: 'Can I use it for phone calls?', a: 'Yes. The device magnetically attaches to the back of your phone, so it\'s always with you during calls. It captures both sides of the conversation clearly.' },
              { q: 'Is my data secure?', a: 'Audio is processed on-device. Transcripts are encrypted end-to-end when syncing to your portal. Nothing is shared with third parties.' },
              { q: 'What if I\'m not satisfied?', a: 'We offer a 30-day money-back guarantee. If the Notetaker doesn\'t transform your workflow, return it for a full refund.' },
            ].map(faq => (
              <div key={faq.q} style={{
                background: c.surface, border: `1px solid ${c.border}`,
                borderRadius: 12, padding: '20px 24px',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 8 }}>{faq.q}</div>
                <div style={{ fontSize: 13, color: c.textMuted, lineHeight: 1.65 }}>{faq.a}</div>
              </div>
            ))}
          </div>
        </section>

        {/* BUY CTA */}
        <div style={{
          background: isDark
            ? 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 50%, rgba(245,158,11,0.08) 100%)'
            : 'linear-gradient(135deg, #FFFBF0 0%, #FEF9EE 50%, #FFFDF7 100%)',
          border: `1px solid ${c.accentBorder}`,
          borderRadius: 20, padding: '48px 40px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          {/* Subtle pattern */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.03,
            backgroundImage: `radial-gradient(${c.accent} 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }} />

          <div style={{ position: 'relative' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
              boxShadow: '0 4px 14px rgba(245,158,11,0.3)',
            }}>
              <MicIcon size={26} color="#0A0F1C" />
            </div>

            <h2 style={{ fontSize: 28, fontWeight: 800, color: c.text, letterSpacing: '-0.03em', marginBottom: 8 }}>
              Ready to transform your meetings?
            </h2>
            <p style={{ fontSize: 15, color: c.textMuted, marginBottom: 28, maxWidth: 460, margin: '0 auto 28px', lineHeight: 1.7 }}>
              Join hundreds of construction professionals who never miss a detail.
              One device. No subscription. Instant ROI.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              <BuyButton label="Order Now — £150" large />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 24 }}>
              {['Free UK & Ireland shipping', '30-day money-back guarantee', 'AI QS Portal included', 'No subscription required'].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <CheckIcon size={13} color={c.green} />
                  <span style={{ fontSize: 12.5, color: c.textMuted }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Pulse animation for the badge */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (max-width: 768px) {
          .notetaker-hero-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

import React from 'react';

// Branded "Office in a Box" illustration — an open box with the back-office
// tools (quote, finance chart, invoice) floating out of it. Shared by the
// upsell popup and the Coming Soon page so they read as one product.
// Pure inline SVG + CSS keyframes; no external assets.
export default function OfficeBoxArt({ size = 200, style }) {
  const rid = React.useId().replace(/:/g, '');
  const g = (n) => `${rid}-${n}`;
  const h = size * 0.82;

  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 200 164"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={g('glow')} cx="50%" cy="46%" r="55%">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#F59E0B" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g('right')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
        <linearGradient id={g('left')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id={g('card')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#EEF2F7" />
        </linearGradient>
      </defs>

      <style>{`
        @keyframes ${g('floatA')} { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes ${g('floatB')} { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
        @keyframes ${g('floatC')} { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        @keyframes ${g('twinkle')} { 0%,100% { opacity: .35; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.1); } }
        @keyframes ${g('pulse')} { 0%,100% { opacity: .85; } 50% { opacity: 1; } }
        .${g('cA')} { animation: ${g('floatA')} 3.6s ease-in-out infinite; transform-origin: center; }
        .${g('cB')} { animation: ${g('floatB')} 4.2s ease-in-out infinite .3s; transform-origin: center; }
        .${g('cC')} { animation: ${g('floatC')} 3.9s ease-in-out infinite .6s; transform-origin: center; }
        .${g('sp')}  { animation: ${g('twinkle')} 2.4s ease-in-out infinite; transform-origin: center; }
        .${g('gl')}  { animation: ${g('pulse')} 3.5s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) {
          .${g('cA')},.${g('cB')},.${g('cC')},.${g('sp')},.${g('gl')} { animation: none; }
        }
      `}</style>

      {/* Glow */}
      <circle className={g('gl')} cx="100" cy="78" r="78" fill={`url(#${g('glow')})`} />

      {/* ── Box body (isometric, open top) ── */}
      {/* Left face */}
      <path d="M50 80 L100 108 L100 150 L50 122 Z" fill={`url(#${g('left')})`} />
      {/* Right face */}
      <path d="M100 108 L150 80 L150 122 L100 150 Z" fill={`url(#${g('right')})`} />
      {/* Open top rim (outer) */}
      <path d="M100 52 L150 80 L100 108 L50 80 Z" fill="#92400E" />
      {/* Inner opening */}
      <path d="M100 60 L141 80 L100 100 L59 80 Z" fill="#5C2E08" />
      {/* Front edge highlight */}
      <path d="M100 108 L100 150" stroke="#FCD34D" strokeWidth="1.5" strokeOpacity="0.7" />

      {/* ── Floating tool cards ── */}
      {/* Finance chart (center) */}
      <g className={g('cA')}>
        <g transform="rotate(-4 100 28)">
          <rect x="80" y="14" width="40" height="30" rx="5" fill={`url(#${g('card')})`} stroke="#E2E8F0" strokeWidth="1" />
          <rect x="86" y="30" width="5" height="8" rx="1.5" fill="#F59E0B" />
          <rect x="94" y="25" width="5" height="13" rx="1.5" fill="#D97706" />
          <rect x="102" y="21" width="5" height="17" rx="1.5" fill="#F59E0B" />
          <rect x="110" y="27" width="5" height="11" rx="1.5" fill="#FBBF24" />
        </g>
      </g>
      {/* £ quote (left) */}
      <g className={g('cB')}>
        <g transform="rotate(7 58 50)">
          <rect x="40" y="38" width="36" height="24" rx="5" fill={`url(#${g('card')})`} stroke="#E2E8F0" strokeWidth="1" />
          <circle cx="52" cy="50" r="7" fill="#F59E0B" />
          <text x="52" y="54.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#FFFFFF" fontFamily="-apple-system,Segoe UI,Roboto,sans-serif">£</text>
          <rect x="62" y="46" width="10" height="2.6" rx="1.3" fill="#CBD5E1" />
          <rect x="62" y="51" width="8" height="2.6" rx="1.3" fill="#E2E8F0" />
        </g>
      </g>
      {/* Invoice / doc (right) */}
      <g className={g('cC')}>
        <g transform="rotate(8 144 50)">
          <rect x="126" y="36" width="34" height="26" rx="5" fill={`url(#${g('card')})`} stroke="#E2E8F0" strokeWidth="1" />
          <rect x="131" y="42" width="24" height="2.6" rx="1.3" fill="#94A3B8" />
          <rect x="131" y="47" width="24" height="2.6" rx="1.3" fill="#CBD5E1" />
          <rect x="131" y="52" width="15" height="2.6" rx="1.3" fill="#CBD5E1" />
          <circle cx="152" cy="53.5" r="3" fill="#10B981" />
        </g>
      </g>

      {/* Sparkles */}
      <g className={g('sp')} style={{ animationDelay: '0s' }}>
        <path d="M30 60 l1.4 3.6 3.6 1.4 -3.6 1.4 -1.4 3.6 -1.4 -3.6 -3.6 -1.4 3.6 -1.4 z" fill="#FBBF24" />
      </g>
      <g className={g('sp')} style={{ animationDelay: '0.8s' }}>
        <path d="M172 56 l1.1 2.8 2.8 1.1 -2.8 1.1 -1.1 2.8 -1.1 -2.8 -2.8 -1.1 2.8 -1.1 z" fill="#F59E0B" />
      </g>
      <g className={g('sp')} style={{ animationDelay: '1.6s' }}>
        <path d="M100 4 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1 z" fill="#FCD34D" />
      </g>
    </svg>
  );
}

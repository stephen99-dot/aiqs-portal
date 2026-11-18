import React, { useState } from 'react';

// ═══ MAX, the character ═════════════════════════════════════════════════════
// The cut-out artwork lives at public/max/max-character.png (a friendly
// builder in a hard hat with MAX on the chest). The build never depends on the
// file: if it is missing or fails to load, a neat placeholder in the brand
// colours stands in — hard hat, hi-vis, MAX badge — drawn in SVG from the
// theme tokens so it is right in both modes.

export default function MaxCharacter({ size = 160, style, className }) {
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return (
      <img
        src={(process.env.PUBLIC_URL || '') + '/max/max-character.png'}
        alt="MAX, your AI estimator"
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', display: 'block', ...style }}
        onError={() => setFailed(true)}
      />
    );
  }
  return <MaxPlaceholder size={size} style={style} className={className} />;
}

export function MaxPlaceholder({ size = 160, style, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="MAX, your AI estimator" className={className} style={{ display: 'block', ...style }}>
      <defs>
        <radialGradient id="maxGlow" cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="64" r="56" fill="url(#maxGlow)" />
      {/* shoulders / hi-vis */}
      <path d="M22 112c0-22 17-34 38-34s38 12 38 34" fill="var(--accent)" />
      <path d="M40 84l20 10 20-10v28H40z" fill="var(--bg-card)" opacity="0.92" />
      <rect x="51" y="92" width="18" height="10" rx="2" fill="var(--accent)" />
      <text x="60" y="100" textAnchor="middle" fontFamily="var(--font-body)" fontWeight="900" fontSize="7.5" fill="var(--accent-text)">MAX</text>
      {/* head */}
      <circle cx="60" cy="54" r="19" fill="#F3C9A6" />
      <circle cx="53" cy="53" r="2.1" fill="var(--text-primary)" />
      <circle cx="67" cy="53" r="2.1" fill="var(--text-primary)" />
      <path d="M52 61q8 6 16 0" fill="none" stroke="var(--text-primary)" strokeWidth="2.2" strokeLinecap="round" />
      {/* hard hat */}
      <path d="M38 46c0-14 10-22 22-22s22 8 22 22z" fill="var(--accent)" />
      <rect x="33" y="44" width="54" height="6" rx="3" fill="var(--accent-dim, var(--accent))" />
      <rect x="56" y="26" width="8" height="18" rx="3" fill="var(--accent-bright, var(--accent))" opacity="0.85" />
    </svg>
  );
}

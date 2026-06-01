import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

// Product thumbnail with a graceful "No Image." fallback. Used in the materials
// list, the price-comparison table and the builder autocomplete. Falls back when
// no src is given OR when the image fails to load (broken/hotlink-blocked URL).

export default function MaterialThumb({ src, alt = '', size = 40, showLabel = false }) {
  const { t } = useTheme();
  const [broken, setBroken] = useState(false);
  const ok = src && !broken;

  const box = {
    width: size, height: size, flexShrink: 0, borderRadius: 6,
    border: '1px solid ' + t.border, background: t.surface,
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };

  if (ok) {
    return (
      <span style={box} title={alt}>
        <img
          src={src}
          alt={alt}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={box} title="No image">
        <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24" fill="none"
          stroke={t.textMuted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </span>
      {showLabel && <span style={{ fontSize: 12, color: t.textMuted }}>No Image.</span>}
    </span>
  );
}

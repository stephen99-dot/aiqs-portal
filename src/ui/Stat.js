import React from 'react';

// Stat tile. `tone` colours the icon chip from the semantic palette.
//
//   <Stat icon={FolderIcon} tone="accent" value={12} label="Total Projects" />
const TONE_VARS = {
  accent:  { color: 'var(--accent)',  bg: 'var(--accent-glow)' },
  success: { color: 'var(--success)', bg: 'var(--success-bg)' },
  warning: { color: 'var(--warning)', bg: 'var(--warning-bg)' },
  danger:  { color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  info:    { color: 'var(--info)',    bg: 'var(--info-bg)' },
  violet:  { color: 'var(--violet)',  bg: 'var(--violet-bg)' },
  neutral: { color: 'var(--text-muted)', bg: 'var(--surface-hover)' },
};

export default function Stat({ icon: Icon, tone = 'neutral', value, label, accent = false, className = '', ...rest }) {
  const tv = TONE_VARS[tone] || TONE_VARS.neutral;
  return (
    <div className={`ui-stat ${accent ? 'ui-stat--accent' : ''} ${className}`.trim()} {...rest}>
      {Icon && (
        <div className="ui-stat__icon" style={{ background: tv.bg, color: tv.color }}>
          <Icon size={16} color="currentColor" />
        </div>
      )}
      <div className="ui-stat__value">{value}</div>
      <div className="ui-stat__label">{label}</div>
    </div>
  );
}

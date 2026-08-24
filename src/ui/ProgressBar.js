import React from 'react';

// Thin progress bar. `tone` picks a semantic colour; "auto" turns amber at
// 80% and red at 100% (the usage-quota pattern).
export default function ProgressBar({ value = 0, tone = 'accent', height = 5, className = '', ...rest }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone === 'auto'
    ? (pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)')
    : tone === 'gradient' ? 'var(--gradient-amber)'
    : `var(--${tone})`;
  return (
    <div
      className={`ui-progress ${className}`.trim()}
      style={{ height }}
      role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
      {...rest}
    >
      <div className="ui-progress__fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

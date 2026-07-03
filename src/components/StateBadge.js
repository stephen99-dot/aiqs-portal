import React from 'react';
import { lifecycleOf } from '../utils/lifecycle';

// The one shared lifecycle badge. Same five states, same labels, same colours
// on every job surface — dashboard rows, project header, admin inbox.
export default function StateBadge({ status, large = false, style }) {
  const s = lifecycleOf(status);
  return (
    <span
      className={`status-badge${large ? ' large' : ''}`}
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}`, ...style }}
    >
      {s.label}
    </span>
  );
}

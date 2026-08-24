import React from 'react';
import Badge from './Badge';

// The portal's status language — one label + tone per state, used everywhere
// a status appears (dashboard rows, job cards, admin inbox, detail pages).
// PORTAL_SPEC.md's lifecycle is the source of truth; add states here, never
// inline in a page.

export const PROJECT_STATUS = {
  submitted:        { label: 'Submitted',        tone: 'info' },
  in_review:        { label: 'In Review',        tone: 'warning' },
  in_progress:      { label: 'Being Priced',     tone: 'violet' },
  awaiting_payment: { label: 'Awaiting Payment', tone: 'warning' },
  completed:        { label: 'Completed',        tone: 'success' },
  delivered:        { label: 'Delivered',        tone: 'success' },
  // Submission-tracker states (pre-project)
  received:         { label: 'With our QS team', tone: 'warning' },
};

// <StatusBadge status="delivered" /> — for the BOQ-pipeline lifecycle.
export function StatusBadge({ status, size, pill, ...rest }) {
  const st = PROJECT_STATUS[status] || PROJECT_STATUS.submitted;
  return <Badge tone={st.tone} size={size} pill={pill} {...rest}>{st.label}</Badge>;
}

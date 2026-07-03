// The five job lifecycle states from PORTAL_SPEC.md, mapped from the
// projects.status values stored in the DB (presentation-layer only — DB
// values are unchanged). Every surface that shows a job's state (dashboard
// rows, project header, admin inbox) reads THIS file, so labels, colours and
// the one-next-action CTA can never drift between pages.
//
//   submitted        → NEW BRIEF   (customer sent drawings; admin must read)
//   in_review        → IN REVIEW   (admin opened it, not yet priced)
//   in_progress      → PRICING     (BOQ being produced)
//   awaiting_payment → PRICING     (priced, waiting on the customer's payment)
//   delivered        → DELIVERED   (docs in the customer's portal)
//   completed        → CLOSED      (acknowledged; out of the main flow)

export const LIFECYCLE_STEPS = ['NEW_BRIEF', 'IN_REVIEW', 'PRICING', 'DELIVERED', 'CLOSED'];

export const LIFECYCLE = {
  NEW_BRIEF: {
    key: 'NEW_BRIEF', label: 'New Brief',
    color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)',
    customerDesc: 'Your drawings and brief are in. We\'ll begin review shortly.',
  },
  IN_REVIEW: {
    key: 'IN_REVIEW', label: 'In Review',
    color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)',
    customerDesc: 'We\'re reviewing your drawings and project brief.',
  },
  PRICING: {
    key: 'PRICING', label: 'Pricing',
    color: '#A855F7', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)',
    customerDesc: 'Your BOQ is being priced. We\'ll notify you when it\'s ready.',
  },
  DELIVERED: {
    key: 'DELIVERED', label: 'Delivered',
    color: '#10B981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)',
    customerDesc: 'Your priced documents are ready to download.',
  },
  CLOSED: {
    key: 'CLOSED', label: 'Closed',
    color: '#64748B', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)',
    customerDesc: 'This job is complete.',
  },
};

const STATUS_TO_STATE = {
  submitted: 'NEW_BRIEF',
  in_review: 'IN_REVIEW',
  in_progress: 'PRICING',
  awaiting_payment: 'PRICING',
  delivered: 'DELIVERED',
  completed: 'CLOSED',
};

// The one next action per state, per persona. `to` is relative to the job.
const CUSTOMER_CTA = {
  submitted:        { label: 'View brief' },
  in_review:        { label: 'View progress' },
  in_progress:      { label: 'View progress' },
  awaiting_payment: { label: 'Pay now' },
  delivered:        { label: 'Download documents' },
  completed:        { label: 'View job' },
};
const ADMIN_CTA = {
  submitted:        { label: 'Start review' },
  in_review:        { label: 'Continue review' },
  in_progress:      { label: 'Upload priced docs' },
  awaiting_payment: { label: 'Upload priced docs' },
  delivered:        { label: 'Delivered', done: true },
  completed:        { label: 'Closed', done: true },
};

export function lifecycleOf(status) {
  return LIFECYCLE[STATUS_TO_STATE[status] || 'NEW_BRIEF'];
}

export function customerCta(status) {
  return CUSTOMER_CTA[status] || CUSTOMER_CTA.submitted;
}

export function adminCta(status) {
  return ADMIN_CTA[status] || ADMIN_CTA.submitted;
}

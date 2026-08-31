// ═══════════════════════════════════════════════════════════════════════════════
// JOB STAGES — server/jobStages.js
//
// The single definition of how a job moves through the office, shared by the
// API (which validates against it) and the admin inbox (which is handed this
// list at load time rather than keeping its own copy that can drift).
//
// The stages deliberately mirror the steps in the VA's SOP: each one is a thing
// somebody actually does, so "where is this job up to" has a truthful answer at
// every moment rather than only at the end.
// ═══════════════════════════════════════════════════════════════════════════════

const STAGES = [
  {
    key: 'new',
    label: 'New',
    hint: 'Arrived. Nobody has picked it up yet.',
    tone: 'warning',
  },
  {
    key: 'checking',
    label: 'Checking drawings',
    hint: 'Confirming the drawings are readable, scaled and complete — chase the customer here if anything is missing.',
    tone: 'info',
  },
  {
    key: 'takeoff',
    label: 'Take-off',
    hint: 'Quantities being measured off the drawings.',
    tone: 'info',
  },
  {
    key: 'pricing',
    label: 'Pricing',
    hint: 'Rates applied and the BOQ built.',
    tone: 'info',
  },
  {
    key: 'review',
    label: 'Final check',
    hint: 'Priced BOQ checked before it goes to the customer.',
    tone: 'accent',
  },
  {
    key: 'delivered',
    label: 'Delivered',
    hint: 'Documents sent. Nothing left to do.',
    tone: 'success',
    terminal: true,
  },
  {
    key: 'on_hold',
    label: 'On hold',
    hint: 'Waiting on the customer. Still ours, but the clock is not on us.',
    tone: 'neutral',
    parked: true,
  },
];

const STAGE_KEYS = STAGES.map(s => s.key);
const DEFAULT_STAGE = 'new';

// Where a job arrived from. Email and phone enquiries are logged by hand, so
// the queue has to be able to tell them apart from portal submissions —
// otherwise half the work is invisible in any per-source count.
const SOURCES = [
  { key: 'portal', label: 'Portal' },
  { key: 'email',  label: 'Email' },
  { key: 'phone',  label: 'Phone' },
  { key: 'manual', label: 'Added by hand' },
];
const SOURCE_KEYS = SOURCES.map(s => s.key);

// Target turnaround in days, used to fill in due_at when nobody sets one.
// A job with no target date can never be reported as late, so every job gets
// one by default.
const DEFAULT_TURNAROUND_DAYS = Number(process.env.JOB_TURNAROUND_DAYS) > 0
  ? Number(process.env.JOB_TURNAROUND_DAYS)
  : 3;

function isValidStage(stage) {
  return STAGE_KEYS.includes(stage);
}

function isValidSource(source) {
  return SOURCE_KEYS.includes(source);
}

function stageLabel(stage) {
  const found = STAGES.find(s => s.key === stage);
  return found ? found.label : stage;
}

// A job counts as open until it is delivered. On-hold jobs are open — they are
// still the office's problem — but they are excluded from the "late" count
// because the delay is the customer's.
function isOpen(stage) {
  return stage !== 'delivered';
}

function isParked(stage) {
  return stage === 'on_hold';
}

// ISO timestamp DEFAULT_TURNAROUND_DAYS after `from`, for the due date.
function defaultDueAt(from) {
  const base = from ? new Date(from) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + DEFAULT_TURNAROUND_DAYS);
  return base.toISOString();
}

module.exports = {
  STAGES,
  STAGE_KEYS,
  DEFAULT_STAGE,
  SOURCES,
  SOURCE_KEYS,
  DEFAULT_TURNAROUND_DAYS,
  isValidStage,
  isValidSource,
  isOpen,
  isParked,
  stageLabel,
  defaultDueAt,
};

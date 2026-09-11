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
    hint: 'Arrived. Nobody has touched it yet.',
    tone: 'warning',
  },
  {
    key: 'in_progress',
    label: 'In progress',
    hint: 'Being worked. Set automatically the first time somebody opens the drawings, creates the job, adds a note or is assigned.',
    tone: 'info',
  },
  {
    key: 'on_hold',
    label: 'On hold',
    hint: 'Waiting on the customer. Still ours, but the clock is not on us. The one stage that has to be set by hand.',
    tone: 'neutral',
    parked: true,
  },
  {
    key: 'delivered',
    label: 'Delivered',
    hint: 'Documents delivered. Set automatically when the deliverables are uploaded to the customer\'s project.',
    tone: 'success',
    terminal: true,
  },
];

// The stages the queue used to have before it moved to automatic tracking:
// checking drawings, take-off, pricing and final check were each a thing
// somebody was meant to click, and nobody did — the work happens outside the
// portal, so a job sat in "New" until it was delivered. They all fold into
// "in progress". Kept here so old rows and old event text still read.
const LEGACY_STAGES = { checking: 'in_progress', takeoff: 'in_progress', pricing: 'in_progress', review: 'in_progress' };
const LEGACY_LABELS = { checking: 'Checking drawings', takeoff: 'Take-off', pricing: 'Pricing', review: 'Final check' };

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

// Fold a stage read from an old row into the current vocabulary.
function normaliseStage(stage) {
  if (!stage) return DEFAULT_STAGE;
  return LEGACY_STAGES[stage] || stage;
}

function isValidSource(source) {
  return SOURCE_KEYS.includes(source);
}

function stageLabel(stage) {
  const found = STAGES.find(s => s.key === stage);
  if (found) return found.label;
  return LEGACY_LABELS[stage] || stage;
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
  LEGACY_STAGES,
  isValidStage,
  normaliseStage,
  isValidSource,
  isOpen,
  isParked,
  stageLabel,
  defaultDueAt,
};

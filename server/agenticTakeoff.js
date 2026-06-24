// agenticTakeoff.js — Phase 8 (agentic takeoff loop) + Phase 9 (verify/correct).
//
// Replaces the single-pass Stage 1/1b extraction for COMPLEX jobs with a
// plan -> measure -> reconcile loop, then a deterministic verify gate with up to
// two model correction rounds. Simple jobs keep the single-pass path; the router
// (isComplexJob / shouldUseAgenticTakeoff) decides.
//
// It reuses the drawing content blocks the chat handler already built, so there
// is no parallel rendering pipeline. All passes share one cached prefix (system +
// drawings), so with Phase 2 caching the extra passes are cheap.
//
// Entry point: runAgenticTakeoff(...) -> the same `parsed` shape the deterministic
// pipeline consumes ({ items, project_type, location, floor_area_m2, ... }) plus
// `discrepancies` and `verification`.

const { callModel, MODELS } = require('./anthropicClient');
const { verifyTakeoff } = require('./verifyTakeoff');

const MAX_CORRECTION_ROUNDS = 2;

// ── Router ──────────────────────────────────────────────────────────────────
// Complexity signals (Phase 5 threshold): storeys, page count, project type.
function isComplexJob({ zipData, projectType, pageCount, modelTierOverride } = {}) {
  if (modelTierOverride === 'frontier') return true;
  const storeys = detectStoreyCount(zipData, projectType);
  const pages = Number(pageCount) || (zipData && zipData.summary && zipData.summary.pdf_count) || 0;
  if (storeys > 2) return true;
  if (pages > 8) return true;
  if (/heritage|listed|conversion|refurb|reinstat|damage/i.test(projectType || '')) return true;
  return false;
}

function shouldUseAgenticTakeoff(opts) {
  return process.env.AGENTIC_TAKEOFF === '1' && isComplexJob(opts);
}

function detectStoreyCount(zipData, projectType) {
  let n = 1;
  if (/two\s*storey|2\s*storey|double\s*storey/i.test(projectType || '')) n = Math.max(n, 2);
  if (/three\s*storey|3\s*storey/i.test(projectType || '')) n = Math.max(n, 3);
  if (/loft|first floor|second floor/i.test(projectType || '')) n = Math.max(n, 2);
  if (zipData && Array.isArray(zipData.text_context)) {
    const blob = zipData.text_context.join(' ');
    if (/first floor|1st floor/i.test(blob)) n = Math.max(n, 2);
    if (/second floor|2nd floor/i.test(blob)) n = Math.max(n, 3);
  }
  return n;
}

// ── Tools (forced JSON) ─────────────────────────────────────────────────────
const PLAN_TOOL = {
  name: 'record_plan',
  description: 'Record the work plan before any measurement.',
  input_schema: {
    type: 'object',
    properties: {
      storeys: { type: 'array', items: { type: 'string' }, description: 'Distinct scopes to measure (storeys/elevations/sections).' },
      page_map: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Which page covers which storey/elevation/schedule.' },
      annotations: { type: 'array', items: { type: 'string' }, description: 'Every handwritten or typed annotation found, verbatim, per page.' },
      replications: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'e.g. { storey, like } for "as Ground Floor" notes.' },
      project_type: { type: ['string', 'null'] },
      location: { type: ['string', 'null'] },
      floor_area_m2: { type: ['number', 'string', 'null'] },
    },
    required: ['storeys'],
    additionalProperties: true,
  },
};

const ITEMS_TOOL = (name, desc) => ({
  name,
  description: desc,
  input_schema: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      discrepancies: { type: 'array', items: { type: 'string' } },
    },
    required: ['items'],
    additionalProperties: true,
  },
});

const MEASURE_TOOL = ITEMS_TOOL('record_items', 'Record measured items for THIS scope only.');
const RECONCILE_TOOL = ITEMS_TOOL('record_takeoff', 'Record the final reconciled takeoff.');

// ── The loop ─────────────────────────────────────────────────────────────────
async function runAgenticTakeoff({
  drawingsContent,   // the user-message content blocks (drawings + text), as built by chat.js
  extractPrompt,     // the Stage 1 extraction system prompt (buildSystemPrompt 'extract_quantities')
  priorMessages = [],// conversation history before this turn
  zipData = null,
  floorAreaM2 = null,
  projectType = '',
  model = MODELS.OPUS,
  effort = 'high',
  userId,
  onProgress = () => {},
}) {
  // Shared, byte-identical prefix across every pass: system = extractPrompt,
  // and the drawings live in the first user message — both cached.
  const baseMessages = [...priorMessages, { role: 'user', content: drawingsContent }];
  const common = {
    model, system: extractPrompt, userId,
    cacheSystem: true, cacheMessages: true,
    // Fable controls depth via effort alone; Opus 4.6-4.8 and Sonnet 4.6 take
    // adaptive thinking + effort (anthropicClient.buildBody maps each per-model).
    // Only pre-4.6 models fall back to a fixed thinking budget.
    ...(/fable|opus-4-(6|7|8)|sonnet-4-6/.test(model)
      ? { thinking: { type: 'adaptive' }, effort }
      : { thinking: { type: 'enabled', budget_tokens: 4000 } }),
  };

  const call = (extraUser, tool, action, maxTokens) => callModel({
    ...common,
    maxTokens,
    action,
    messages: [...baseMessages, { role: 'user', content: extraUser }],
    tools: [tool],
    toolChoice: { type: 'tool', name: tool.name },
  });

  // 1) PLAN — read annotations and lay out the measurement tasks (cheap).
  onProgress({ stage: 'plan', detail: 'Reading annotations and planning…' });
  const planRes = await call(
    'Before measuring anything, study every page. Call record_plan with: the list of storeys/sections to measure, which page covers which, EVERY handwritten or typed annotation verbatim, and any "as [other storey]" replication notes.',
    PLAN_TOOL, 'agentic_plan', 4000,
  );
  if (!planRes.ok) throw new Error('Agentic plan pass failed: ' + planErr(planRes));
  const plan = planRes.json || { storeys: [] };
  const scopes = (Array.isArray(plan.storeys) && plan.storeys.length) ? plan.storeys : ['Whole project'];

  // 2) MEASURE — one pass per scope, items for that scope only.
  const measured = [];
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    onProgress({ stage: 'measure', detail: `Measuring ${scope}… (${i + 1}/${scopes.length})` });
    const planJson = JSON.stringify(plan);
    const res = await call(
      `Here is the agreed plan:\n${planJson}\n\nMeasure ONLY the scope: "${scope}". Call record_items with the line items for this scope. Read dimension strings off the drawings; apply any replication note for this scope.`,
      MEASURE_TOOL, 'agentic_measure', 8000,
    );
    if (res.ok && res.json && Array.isArray(res.json.items)) {
      for (const it of res.json.items) measured.push({ ...it, _scope: scope });
    }
  }

  // 3) RECONCILE — cross-check against schedules; dedupe; apply replications.
  onProgress({ stage: 'reconcile', detail: 'Cross-checking schedules…' });
  const scheduleBlob = summariseSchedules(zipData);
  const reconcileUser =
    `All measured items (across scopes):\n\`\`\`json\n${JSON.stringify(measured)}\n\`\`\`\n\n` +
    (scheduleBlob ? `Schedules parsed from the files:\n${scheduleBlob}\n\n` : '') +
    'Call record_takeoff with the FINAL deduplicated item list: every schedule entry must appear, no duplicates across storeys, replication notes applied, floor-area-derived quantities consistent. Add a discrepancies array describing anything you could not reconcile.';
  const reconRes = await call(reconcileUser, RECONCILE_TOOL, 'agentic_reconcile', 12000);
  if (!reconRes.ok) throw new Error('Agentic reconcile pass failed: ' + planErr(reconRes));

  let parsed = normaliseParsed(reconRes.json, plan, floorAreaM2, projectType);

  // 4) VERIFY + correct (Phase 9) — deterministic gate, up to 2 model rounds.
  const planNotes = buildPlanNotes(plan, measured);
  let verification = verifyTakeoff({ items: parsed.items, floorAreaM2: parsed.floor_area_m2, projectType: parsed.project_type, zipData, planNotes });
  let round = 0;
  while (!verification.ok && round < MAX_CORRECTION_ROUNDS) {
    round++;
    onProgress({ stage: 'verify', detail: `Fixing ${verification.failures.filter(f => f.severity === 'error').length} issue(s) (round ${round})…` });
    const fixUser =
      `The takeoff failed deterministic checks:\n\`\`\`json\n${JSON.stringify(verification.failures, null, 1)}\n\`\`\`\n\n` +
      `Current items:\n\`\`\`json\n${JSON.stringify(parsed.items)}\n\`\`\`\n\n` +
      'Call record_takeoff again with the corrected item list that resolves every error above. Do not introduce new errors.';
    const fixRes = await call(fixUser, RECONCILE_TOOL, 'agentic_correct', 12000);
    if (!fixRes.ok || !fixRes.json || !Array.isArray(fixRes.json.items)) break;
    parsed = normaliseParsed(fixRes.json, plan, floorAreaM2, projectType);
    verification = verifyTakeoff({ items: parsed.items, floorAreaM2: parsed.floor_area_m2, projectType: parsed.project_type, zipData, planNotes });
  }

  parsed.verification = verification;
  parsed.needs_admin_review = !verification.ok; // never ship silently with failures
  parsed.agentic = { scopes, rounds: round, model: reconRes.model };
  if (Array.isArray(plan.annotations)) parsed.annotations = plan.annotations;
  return parsed;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function planErr(res) {
  return res.error?.error?.message || res.error?.message || ('status ' + res.status);
}

function normaliseParsed(json, plan, floorAreaM2, projectType) {
  const j = json || {};
  return {
    items: Array.isArray(j.items) ? j.items : [],
    project_type: j.project_type || plan.project_type || projectType || '',
    location: j.location || plan.location || '',
    floor_area_m2: j.floor_area_m2 ?? plan.floor_area_m2 ?? floorAreaM2 ?? null,
    discrepancies: Array.isArray(j.discrepancies) ? j.discrepancies : [],
  };
}

function buildPlanNotes(plan, measured) {
  const replications = Array.isArray(plan.replications) ? plan.replications : [];
  const storeyCounts = {};
  for (const it of measured) {
    const s = it._scope || '';
    storeyCounts[s] = (storeyCounts[s] || 0) + 1;
  }
  // Map a "ground" bucket for the verifier's GF comparison.
  for (const s of Object.keys(storeyCounts)) {
    if (/ground/i.test(s)) storeyCounts['ground'] = storeyCounts[s];
  }
  return { replications, storeyCounts };
}

function summariseSchedules(zipData) {
  if (!zipData) return '';
  const lines = [];
  const s = zipData.summary || {};
  if (s.total_floor_area_m2) lines.push(`Total floor area: ${s.total_floor_area_m2} m²`);
  if (s.total_windows != null) lines.push(`Windows in schedule: ${s.total_windows}`);
  if (s.total_doors != null) lines.push(`Doors in schedule: ${s.total_doors}`);
  const rooms = zipData.all_rooms || (s.total_rooms ? [{ count: s.total_rooms }] : null);
  if (Array.isArray(zipData.all_rooms) && zipData.all_rooms.length) {
    lines.push(`Rooms (${zipData.all_rooms.length}): ` + zipData.all_rooms.map(r => r.name || r.ref || '?').slice(0, 30).join(', '));
  }
  return lines.join('\n');
}

module.exports = { runAgenticTakeoff, isComplexJob, shouldUseAgenticTakeoff, detectStoreyCount };

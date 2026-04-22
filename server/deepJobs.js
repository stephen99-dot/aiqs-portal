// Deep BOQ mode.
//
// Runs the full takeoff + pricing pipeline as a server-side background job so
// users can close the tab and come back without losing progress. Each job
// advances through explicit named steps, each one a Claude call with extended
// thinking. Live updates flow via SSE; reconnects replay the job state from
// SQLite and tail live events.
//
// IMPORTANT: this is an alternative path to the single-shot fast chat — it is
// NOT wired into the existing /chat/stream endpoint. Access is via new routes
// mounted by index.js.

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// ── Schema ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS deep_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT DEFAULT 'queued',
    intake_json TEXT,
    file_names TEXT,
    project_type TEXT,
    location TEXT,
    floor_area_m2 REAL,
    construction_total REAL,
    grand_total REAL,
    currency TEXT,
    final_output TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_deep_jobs_user ON deep_jobs(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS deep_job_steps (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    step_title TEXT,
    status TEXT DEFAULT 'pending',
    thinking TEXT,
    text TEXT,
    output_json TEXT,
    started_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_deep_job_steps_job ON deep_job_steps(job_id, step_index);
`);

// ── Event buses ──────────────────────────────────────────────────────
// One EventEmitter per active job. Subscribers get live step_* and job_*
// events. Cleaned up when job completes OR 5 minutes after no listeners.

const buses = new Map();  // jobId -> { emitter, refCount, cleanupTimer }

function getBus(jobId) {
  if (!buses.has(jobId)) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    buses.set(jobId, { emitter, refCount: 0, cleanupTimer: null });
  }
  return buses.get(jobId);
}

function subscribe(jobId, onEvent) {
  const bus = getBus(jobId);
  bus.refCount++;
  if (bus.cleanupTimer) { clearTimeout(bus.cleanupTimer); bus.cleanupTimer = null; }
  bus.emitter.on('event', onEvent);
  return function unsubscribe() {
    bus.emitter.off('event', onEvent);
    bus.refCount = Math.max(0, bus.refCount - 1);
    if (bus.refCount === 0) {
      // GC the bus 5 min after everyone disconnects
      bus.cleanupTimer = setTimeout(() => { buses.delete(jobId); }, 5 * 60 * 1000);
    }
  };
}

function emit(jobId, evt) {
  const bus = buses.get(jobId);
  if (bus) bus.emitter.emit('event', evt);
}

// ── Pipeline definition ──────────────────────────────────────────────
// Each step is a function (ctx) => { thinking, text, output } where output
// is a plain object that subsequent steps can read from ctx.outputs[stepName].

const STEPS = [
  { name: 'scope',        title: 'Reading drawings & identifying scope' },
  { name: 'measure',      title: 'Measuring quantities from drawings' },
  { name: 'qa',           title: 'QA review — cross-checking quantities' },
  { name: 'rates',        title: 'Looking up rates for each item' },
  { name: 'price',        title: 'Applying deterministic pricing' },
  { name: 'sanity',       title: 'Sanity-checking against benchmarks' },
  { name: 'findings',     title: 'Drafting findings report' },
];

// ── Persistence helpers ──────────────────────────────────────────────

function createJob({ userId, sessionId, intake, fileNames }) {
  const id = 'dj_' + uuidv4().slice(0, 12);
  db.prepare(`INSERT INTO deep_jobs (id, user_id, session_id, intake_json, file_names)
    VALUES (?, ?, ?, ?, ?)`).run(
    id, userId, sessionId || null,
    intake ? JSON.stringify(intake) : null,
    fileNames ? JSON.stringify(fileNames) : null
  );
  const insertStep = db.prepare(`INSERT INTO deep_job_steps (id, job_id, step_index, step_name, step_title) VALUES (?, ?, ?, ?, ?)`);
  STEPS.forEach((s, i) => {
    insertStep.run('djs_' + uuidv4().slice(0, 10), id, i, s.name, s.title);
  });
  return id;
}

function getJob(db2, jobId) {
  const job = db2.prepare('SELECT * FROM deep_jobs WHERE id = ?').get(jobId);
  if (!job) return null;
  const steps = db2.prepare('SELECT * FROM deep_job_steps WHERE job_id = ? ORDER BY step_index ASC').all(jobId);
  return { ...job, steps };
}

function updateJob(jobId, patch) {
  const pairs = Object.keys(patch).map(k => `${k} = ?`).join(', ');
  const values = Object.values(patch);
  db.prepare(`UPDATE deep_jobs SET ${pairs}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, jobId);
}

function updateStep(jobId, stepIndex, patch) {
  const pairs = Object.keys(patch).map(k => `${k} = ?`).join(', ');
  const values = Object.values(patch);
  db.prepare(`UPDATE deep_job_steps SET ${pairs} WHERE job_id = ? AND step_index = ?`).run(...values, jobId, stepIndex);
}

// ── Claude streaming helper (extended thinking + text aggregation) ────

async function callClaudeWithThinking({ apiKey, model, system, messages, budgetTokens, onThinkingDelta, onTextDelta }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: budgetTokens || 8000 },
      system,
      messages,
      stream: true,
    }),
  });
  if (!resp.ok) {
    let err = {};
    try { err = await resp.json(); } catch (e) {}
    throw new Error('Claude error ' + resp.status + ': ' + (err?.error?.message || resp.statusText));
  }

  let thinking = '', text = '';
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      let evt; try { evt = JSON.parse(payload); } catch (e) { continue; }
      if (evt.type === 'content_block_delta' && evt.delta) {
        if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
          thinking += evt.delta.thinking;
          if (onThinkingDelta) onThinkingDelta(evt.delta.thinking);
        } else if (evt.delta.type === 'text_delta' && evt.delta.text) {
          text += evt.delta.text;
          if (onTextDelta) onTextDelta(evt.delta.text);
        }
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || 'Stream error');
      }
    }
  }
  return { thinking, text };
}

// Parse a JSON block out of Claude output that may have surrounding prose.
function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (e) {}
  }
  return null;
}

// ── The pipeline itself ──────────────────────────────────────────────

async function runPipeline(jobId, { userContent, apiKey }) {
  const outputs = {};
  // Debounced writer for step text/thinking so we don't write on every token
  function makeFlusher(stepIndex) {
    let pendingText = '', pendingThinking = '', lastFlush = 0;
    let timer = null;
    function flushNow() {
      if (!pendingText && !pendingThinking) return;
      const patches = {};
      if (pendingText) patches.text = pendingText;
      if (pendingThinking) patches.thinking = pendingThinking;
      try {
        const cols = Object.keys(patches).map(k => `${k} = ${k} || ?`).join(', ');
        const vals = Object.values(patches);
        db.prepare(`UPDATE deep_job_steps SET ${cols} WHERE job_id = ? AND step_index = ?`).run(...vals, jobId, stepIndex);
      } catch (e) {}
      pendingText = '';
      pendingThinking = '';
      lastFlush = Date.now();
    }
    return {
      addText: (t) => {
        pendingText += t;
        if (!timer) timer = setTimeout(() => { timer = null; flushNow(); }, 500);
      },
      addThinking: (t) => {
        pendingThinking += t;
        if (!timer) timer = setTimeout(() => { timer = null; flushNow(); }, 500);
      },
      flush: () => { if (timer) { clearTimeout(timer); timer = null; } flushNow(); },
    };
  }

  updateJob(jobId, { status: 'running' });
  emit(jobId, { type: 'job_started', job_id: jobId });

  // Lazy-load the pricer only once
  let pricer = null;
  try { pricer = require('./deterministicPricer'); } catch (e) {}

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    const flusher = makeFlusher(i);
    updateStep(jobId, i, { status: 'running', started_at: new Date().toISOString() });
    emit(jobId, { type: 'step_started', step_index: i, step_name: step.name, step_title: step.title });

    // ───── Deterministic price step (no Claude call) ─────
    if (step.name === 'price') {
      try {
        if (!pricer) throw new Error('Deterministic pricer not available');
        const items = (outputs.rates && outputs.rates.items)
          || (outputs.qa && outputs.qa.items)
          || (outputs.measure && outputs.measure.items)
          || [];
        if (items.length === 0) throw new Error('No items to price');
        const scope = outputs.scope || {};
        const priced = pricer.priceLockedQuantities(
          items,
          scope.location || '',
          {},
          {
            project_type: scope.project_type || '',
            floor_area: scope.total_project_area_m2 || scope.floor_area_new_m2 || null,
          }
        );
        outputs.price = priced;
        const summaryLine = `${priced.summary.currency === 'EUR' ? '€' : '£'}${Math.round(priced.summary.grand_total).toLocaleString('en-GB')} grand total · ${priced.sections.length} sections · ${(priced.warnings || []).length} warnings`;
        updateStep(jobId, i, {
          status: 'complete',
          completed_at: new Date().toISOString(),
          output_json: JSON.stringify(priced),
          text: summaryLine,
        });
        emit(jobId, { type: 'step_text', step_index: i, delta: summaryLine });
        emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: priced });
      } catch (err) {
        console.error(`[DeepJob ${jobId}] price step failed:`, err.message);
        updateStep(jobId, i, { status: 'error', completed_at: new Date().toISOString() });
        updateJob(jobId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
        emit(jobId, { type: 'job_error', error: err.message, at_step: step.name });
        return;
      }
      continue;
    }

    try {
      const prompt = buildStepPrompt(step.name, outputs, userContent);
      const messages = step.name === 'scope'
        ? [{ role: 'user', content: userContent }]   // first step sees the drawings
        : [{ role: 'user', content: prompt.user }];

      const { thinking, text } = await callClaudeWithThinking({
        apiKey,
        model: 'claude-sonnet-4-20250514',
        system: prompt.system,
        messages,
        budgetTokens: 8000,
        onThinkingDelta: (t) => {
          flusher.addThinking(t);
          emit(jobId, { type: 'step_thinking', step_index: i, delta: t });
        },
        onTextDelta: (t) => {
          flusher.addText(t);
          emit(jobId, { type: 'step_text', step_index: i, delta: t });
        },
      });
      flusher.flush();

      // Step-specific output extraction
      let output = null;
      if (step.name === 'scope' || step.name === 'measure' || step.name === 'qa' || step.name === 'rates') {
        output = extractJson(text);
      } else {
        output = { text };
      }
      outputs[step.name] = output || { text };

      updateStep(jobId, i, {
        status: 'complete',
        completed_at: new Date().toISOString(),
        output_json: JSON.stringify(outputs[step.name] || null),
        text,   // final full text
        thinking, // final full thinking
      });
      emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: outputs[step.name] });
    } catch (err) {
      flusher.flush();
      console.error(`[DeepJob ${jobId}] step ${step.name} failed:`, err.message);
      updateStep(jobId, i, { status: 'error', completed_at: new Date().toISOString() });
      updateJob(jobId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
      emit(jobId, { type: 'job_error', error: err.message, at_step: step.name });
      return;
    }
  }

  // Pricing happens in the 'price' step via the deterministic pricer. Save
  // headline numbers onto the job so the list view and the chat can reference
  // them without re-parsing JSON.
  try {
    const priced = outputs.price?.priced || outputs.price;
    if (priced && priced.summary) {
      updateJob(jobId, {
        construction_total: priced.summary.construction_total || null,
        grand_total: priced.summary.grand_total || null,
        currency: priced.summary.currency || null,
        project_type: priced.project_type || null,
        location: priced.location?.label || null,
        floor_area_m2: priced.floor_area || null,
        final_output: JSON.stringify({ priced, findings: outputs.findings?.text || null }),
      });
    }
  } catch (e) { console.error('[DeepJob] save summary error:', e.message); }

  updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() });
  emit(jobId, { type: 'job_complete', job_id: jobId });
}

// ── Step prompt builder ──────────────────────────────────────────────

function buildStepPrompt(stepName, outputs, userContent) {
  const baseSystem = `You are an expert UK/Ireland Quantity Surveyor performing a detailed tender-quality takeoff. Take your time. Use extended thinking to reason carefully through each decision. Show your working. Flag assumptions explicitly.`;

  switch (stepName) {
    case 'scope':
      return {
        system: `${baseSystem}

Step 1 of 7 — SCOPE ANALYSIS.

Read the uploaded drawings and any text context. Identify:
1. Project type (e.g. two-storey rear extension, full-house refurbishment, loft conversion)
2. Location and any factors (London/SE uplift, Ireland, heritage)
3. Approximate floor areas for NEW build vs EXISTING areas being altered
4. Key scope items visible in the drawings (extensions, demolitions, internal alterations)
5. Notable features and spec indicators (passive house, heritage, bespoke glazing, natural stone, etc.)
6. Red flags or unusual items (foul sewer under extension, restricted access, etc.)

Respond with a single JSON object:
{
  "project_type": "precise description of what's being built",
  "location": "town, county, country",
  "floor_area_new_m2": 62,
  "floor_area_altered_m2": 28,
  "total_project_area_m2": 90,
  "spec_level": "standard | mid-range | premium | heritage",
  "scope_items": ["item 1", "item 2", ...],
  "spec_notes": ["notable feature 1", ...],
  "red_flags": ["foul sewer under ext", ...]
}`,
        user: 'Analyse the uploaded drawings and respond with the JSON scope analysis.',
      };

    case 'measure':
      return {
        system: `${baseSystem}

Step 2 of 7 — QUANTITY TAKEOFF.

You previously identified the scope:
${JSON.stringify(outputs.scope, null, 2)}

Now produce a detailed quantity takeoff. Work element by element. For each item show your working in the description field so it can be audited. Use standard key names that map to the base rate library where possible (concrete_slab_150mm, brick_outer_leaf, plasterboard_skim_walls, etc.).

Respond with JSON:
{
  "items": [
    {
      "key": "concrete_slab_150mm",
      "description": "Reinforced concrete GF slab, 150mm, C25/30. Area: 8.2m × 4.0m = 32.8m²",
      "qty": 32.8,
      "unit": "m2",
      "section": "Substructure",
      "working": "measured from proposed GF plan"
    }
  ]
}`,
        user: 'Produce the detailed measurement. Use standard item keys.',
      };

    case 'qa':
      return {
        system: `${baseSystem}

Step 3 of 7 — QA REVIEW.

Review the junior QS's takeoff critically:
${JSON.stringify(outputs.measure, null, 2)}

For each section, check:
1. Did they miss anything obvious? (no radiators listed but heating mentioned, no rainwater goods for a pitched roof, etc.)
2. Are quantities plausible for the floor area?
3. Any double-counts? (e.g. both a "fit-out lump sum" AND individual fittings inside it)
4. Are units correct? (sometimes per-metre items get mis-tagged as per-item)

Respond with JSON:
{
  "items": [ /* corrected + added items, same format as before */ ],
  "qa_notes": [ "adjusted X...", "added Y...", "removed duplicate Z..." ]
}`,
        user: 'Critically review and produce the corrected items list.',
      };

    case 'rates':
      return {
        system: `${baseSystem}

Step 4 of 7 — RATE ASSIGNMENT (AI-assisted).

For each item in the takeoff, the deterministic pricer will next apply base rates from the library where keys match. Flag items it won't recognise so we can put a sensible rate on them.

Takeoff:
${JSON.stringify(outputs.qa, null, 2)}

Respond with JSON:
{
  "items": [ /* same items, with optional assumed_rate added for keys you expect will not be in the base library */ ],
  "notes": [ "assumed £82/m for lead flashing code 5 (Ireland uplift will apply on top)" ]
}

Keep assumed_rate realistic — it is in GBP before any location uplift. Do NOT inflate rates; if unsure, leave it off so the pricer falls back to safe defaults.`,
        user: 'Add assumed_rate only where the key will not be in the base library. Realistic GBP rates.',
      };

    case 'price':
      return {
        system: `${baseSystem}

Step 5 of 7 — DETERMINISTIC PRICING.

(Handled programmatically by the server — no Claude call required.)`,
        user: '',
      };

    case 'sanity':
      return {
        system: `${baseSystem}

Step 6 of 7 — SANITY CHECK.

Priced result:
${JSON.stringify(outputs.price?.summary || outputs.price, null, 2)}

Scope:
${JSON.stringify(outputs.scope, null, 2)}

Warnings from the pricer:
${JSON.stringify((outputs.price?.warnings || []).slice(0, 30), null, 2)}

Check the cost/m² against typical benchmarks for the project type and location. Are any single line items suspiciously high or low? Should anything be flagged for the user before the tender submission?

Respond with plain text (not JSON) — a short professional sanity-check statement.`,
        user: 'Produce the sanity check.',
      };

    case 'findings':
      return {
        system: `${baseSystem}

Step 7 of 7 — FINDINGS REPORT.

You have the complete priced BOQ. Draft a short Findings Report with:
- Headline totals
- Key assumptions made
- Standard exclusions
- Red flags and buildability issues
- Recommendations

Scope: ${JSON.stringify(outputs.scope, null, 2).slice(0, 1500)}
Priced summary: ${JSON.stringify(outputs.price?.summary || {}, null, 2)}
QA notes: ${JSON.stringify(outputs.qa?.qa_notes || [], null, 2)}
Sanity check: ${outputs.sanity?.text || ''}

Write it as concise professional QS prose. Use markdown.`,
        user: 'Write the findings report.',
      };

    default:
      return { system: baseSystem, user: '' };
  }
}

// ── Public surface ────────────────────────────────────────────────────

async function startJob({ userId, sessionId, intake, fileNames, userContent, apiKey }) {
  const jobId = createJob({ userId, sessionId, intake, fileNames });
  // Fire and forget — pipeline runs in the background
  setImmediate(() => {
    runPipeline(jobId, { userContent, apiKey }).catch(err => {
      console.error('[DeepJob] unhandled:', err.message);
      try {
        updateJob(jobId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
        emit(jobId, { type: 'job_error', error: err.message });
      } catch (e) {}
    });
  });
  return jobId;
}

function snapshotJob(jobId) {
  return getJob(db, jobId);
}

module.exports = {
  STEPS,
  startJob,
  snapshotJob,
  subscribe,
};

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
  { name: 'prepare',      title: 'Preparing drawings (unzip / encode)' },
  { name: 'scope',        title: 'Reading drawings & identifying scope' },
  { name: 'measure',      title: 'Measuring quantities from drawings' },
  { name: 'qa',           title: 'QA review — cross-checking quantities' },
  { name: 'rates',        title: 'Looking up rates for each item' },
  { name: 'price',        title: 'Applying deterministic pricing' },
  { name: 'sanity',       title: 'Sanity-checking against benchmarks' },
  { name: 'findings',     title: 'Drafting findings report' },
  { name: 'package',      title: 'Producing Excel BOQ + Word findings' },
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

async function runPipeline(jobId, { userContent, apiKey, skipPrepare = false }) {
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

  if (!skipPrepare) {
    updateJob(jobId, { status: 'running' });
    emit(jobId, { type: 'job_started', job_id: jobId });
  }

  // Lazy-load the pricer, doc generators, and fs/path only once
  let pricer = null, boqGen = null, findingsGen = null;
  try { pricer = require('./deterministicPricer'); } catch (e) {}
  try { boqGen = require('./boqGenerator'); } catch (e) {}
  try { findingsGen = require('./findingsGenerator'); } catch (e) {}
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
  const outputsDir = path.join(DATA_DIR, 'outputs');
  if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    // 'prepare' is handled in startJob BEFORE runPipeline is called — skip here
    if (step.name === 'prepare') continue;
    const flusher = makeFlusher(i);
    updateStep(jobId, i, { status: 'running', started_at: new Date().toISOString() });
    emit(jobId, { type: 'step_started', step_index: i, step_name: step.name, step_title: step.title });

    // ───── Document package step (no Claude call — Excel + Word) ─────
    if (step.name === 'package') {
      try {
        if (!pricer || !boqGen || !findingsGen) {
          throw new Error('Document generators not installed — run npm install exceljs docx');
        }
        const priced = outputs.price;
        if (!priced || !priced.sections) throw new Error('No priced output to package');
        const scope = outputs.scope || {};
        const projectName = scope.project_type || 'Project';
        const safeName = (projectName).replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 50) || 'Project';
        const ts = Date.now();

        const boqSections = pricer.toPricedSections ? pricer.toPricedSections(priced) : priced.sections;
        const downloads = [];

        // Excel BOQ
        try {
          const buf = await boqGen.generateBOQExcel(boqSections, projectName, '', {
            contingency_pct: priced.summary.contingency_pct,
            ohp_pct: priced.summary.ohp_pct,
            vat_rate: priced.summary.vat_rate,
            currency: priced.summary.currency === 'EUR' ? '€' : '£',
          });
          if (buf && buf.length > 100) {
            const fname = `BOQ-${safeName}-${ts}.xlsx`;
            fs.writeFileSync(path.join(outputsDir, fname), buf);
            downloads.push({ name: fname, type: 'xlsx', url: `/api/downloads/${fname}` });
          }
        } catch (excelErr) {
          console.error(`[DeepJob ${jobId}] Excel error:`, excelErr.message);
        }

        // Word findings — use the findings step text, which is already AI-written prose.
        // findingsGen expects a structured findings object; we wrap the step text
        // together with the deterministic cost summary it needs.
        try {
          const findingsText = (outputs.findings && outputs.findings.text) || '';
          const findingsObj = {
            reference: jobId.slice(-8).toUpperCase(),
            project_type: projectName,
            location: scope.location || '',
            description: (scope.spec_notes || []).join(' '),
            scope_summary: (scope.scope_items || []).join('; '),
            key_findings: [{
              title: 'Deep BOQ Analysis',
              detail: findingsText,
              items: scope.red_flags || [],
            }],
            assumptions: (outputs.qa && outputs.qa.qa_notes) || [],
            exclusions: [],
            recommendations: [outputs.sanity && outputs.sanity.text].filter(Boolean),
            cost_summary: {
              sections: priced.sections.map(s => ({ name: s.name, total: s.subtotal })),
              net_total: priced.summary.net_total,
              contingency_pct: priced.summary.contingency_pct,
              contingency: priced.summary.contingency,
              ohp_pct: priced.summary.ohp_pct,
              ohp: priced.summary.ohp,
              grand_total: priced.summary.grand_total,
            },
          };
          const docBuf = await findingsGen.generateFindingsReport(findingsObj, '', projectName);
          if (docBuf && docBuf.length > 100) {
            const docName = `Findings-${safeName}-${ts}.docx`;
            fs.writeFileSync(path.join(outputsDir, docName), docBuf);
            downloads.push({ name: docName, type: 'docx', url: `/api/downloads/${docName}` });
          }
        } catch (wordErr) {
          console.error(`[DeepJob ${jobId}] Word error:`, wordErr.message);
        }

        if (downloads.length === 0) throw new Error('Neither Excel nor Word generated');

        outputs.package = { files: downloads };
        const summaryLine = `Produced ${downloads.map(d => d.name).join(' + ')}`;
        updateStep(jobId, i, {
          status: 'complete',
          completed_at: new Date().toISOString(),
          output_json: JSON.stringify(outputs.package),
          text: summaryLine,
        });
        emit(jobId, { type: 'step_text', step_index: i, delta: summaryLine });
        emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: outputs.package });
      } catch (err) {
        console.error(`[DeepJob ${jobId}] package step failed:`, err.message);
        updateStep(jobId, i, { status: 'error', completed_at: new Date().toISOString() });
        // Packaging failure is non-fatal — the priced BOQ is still valid. Flag and continue.
        emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: { error: err.message } });
      }
      continue;
    }

    // ───── Deterministic price step (no Claude call) ─────
    if (step.name === 'price') {
      try {
        if (!pricer) throw new Error('Deterministic pricer not available — check that deterministicPricer.js loaded on server boot');
        const rawItems = (outputs.rates && outputs.rates.items)
          || (outputs.qa && outputs.qa.items)
          || (outputs.measure && outputs.measure.items)
          || [];
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
          throw new Error(`No items to price. Rates step output shape: ${Object.keys(outputs.rates || {}).join(', ') || 'empty'}. QA step output shape: ${Object.keys(outputs.qa || {}).join(', ') || 'empty'}. Measure step output shape: ${Object.keys(outputs.measure || {}).join(', ') || 'empty'}.`);
        }

        // Sanitise items — the AI sometimes returns qty as a string ("50"),
        // missing unit, or empty key. Normalise so the pricer doesn't choke
        // on obviously malformed entries.
        const items = [];
        const dropped = [];
        for (const raw of rawItems) {
          if (!raw || typeof raw !== 'object') { dropped.push(raw); continue; }
          const key = String(raw.key || '').trim().toLowerCase().replace(/\s+/g, '_');
          const qty = typeof raw.qty === 'string' ? parseFloat(raw.qty) : raw.qty;
          if (!key || !Number.isFinite(qty) || qty <= 0) { dropped.push(raw); continue; }
          items.push({
            ...raw,
            key,
            qty,
            unit: raw.unit ? String(raw.unit).trim() : 'Item',
            description: raw.description || raw.key,
            section: raw.section || 'General',
            assumed_rate: typeof raw.assumed_rate === 'string' ? parseFloat(raw.assumed_rate) : raw.assumed_rate,
          });
        }
        if (dropped.length > 0) {
          console.warn(`[DeepJob ${jobId}] Dropped ${dropped.length} malformed items before pricing`);
        }
        if (items.length === 0) {
          throw new Error(`All ${rawItems.length} items had invalid key/qty — cannot price. Sample first item: ${JSON.stringify(rawItems[0]).slice(0, 300)}`);
        }

        const scope = outputs.scope || {};
        console.log(`[DeepJob ${jobId}] Pricing ${items.length} items (project_type="${scope.project_type || ''}", floor_area=${scope.total_project_area_m2 || scope.floor_area_new_m2 || 'null'})`);

        let priced;
        try {
          priced = pricer.priceLockedQuantities(
            items,
            scope.location || '',
            {},
            {
              project_type: scope.project_type || '',
              floor_area: scope.total_project_area_m2 || scope.floor_area_new_m2 || null,
            }
          );
        } catch (pricerErr) {
          // Surface the pricer's stack + first couple of item keys so we can
          // diagnose from the logs which item shape broke it.
          const sampleKeys = items.slice(0, 3).map(i => `${i.key}(${i.unit}×${i.qty})`).join(', ');
          console.error(`[DeepJob ${jobId}] Pricer threw:`, pricerErr.stack);
          throw new Error(`Pricer failed on ${items.length} items (sample: ${sampleKeys}): ${pricerErr.message}`);
        }

        if (!priced || !priced.summary) {
          throw new Error('Pricer returned empty result');
        }

        outputs.price = priced;
        const summaryLine = `${priced.summary.currency === 'EUR' ? '€' : '£'}${Math.round(priced.summary.grand_total).toLocaleString('en-GB')} grand total · ${priced.sections.length} sections · ${(priced.warnings || []).length} warnings`;
        updateStep(jobId, i, {
          status: 'complete',
          completed_at: new Date().toISOString(),
          output_json: JSON.stringify(priced),
          text: summaryLine + (dropped.length > 0 ? ` (dropped ${dropped.length} malformed items)` : ''),
        });
        emit(jobId, { type: 'step_text', step_index: i, delta: summaryLine });
        emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: priced });
      } catch (err) {
        console.error(`[DeepJob ${jobId}] price step failed:`, err.stack || err.message);
        updateStep(jobId, i, {
          status: 'error',
          completed_at: new Date().toISOString(),
          text: 'Error: ' + err.message,
        });
        updateJob(jobId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
        emit(jobId, { type: 'step_text', step_index: i, delta: 'Error: ' + err.message });
        emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: { error: err.message } });
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
      console.error(`[DeepJob ${jobId}] step ${step.name} failed:`, err.stack || err.message);
      const errText = 'Error: ' + err.message;
      updateStep(jobId, i, {
        status: 'error',
        completed_at: new Date().toISOString(),
        text: errText,
      });
      updateJob(jobId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
      emit(jobId, { type: 'step_text', step_index: i, delta: errText });
      emit(jobId, { type: 'step_complete', step_index: i, step_name: step.name, output: { error: err.message } });
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
        final_output: JSON.stringify({
          priced,
          findings: outputs.findings?.text || null,
          files: (outputs.package && outputs.package.files) || [],
        }),
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

// startJob accepts EITHER pre-built userContent OR a prepareContent async
// function that returns { content, extractedNames }. The prepareContent path
// lets the HTTP handler return the job_id instantly while expensive work
// (ZIP unpacking, base64 encoding) happens in the background as the first
// pipeline step, so the UI shows "Preparing drawings..." with progress
// instead of a dead "Starting..." button for 30-60 seconds.
async function startJob({ userId, sessionId, intake, fileNames, userContent, prepareContent, apiKey }) {
  const jobId = createJob({ userId, sessionId, intake, fileNames });
  setImmediate(async () => {
    try {
      let content = userContent;
      let extractedNames = fileNames;
      if (!content && prepareContent) {
        // Prepare step runs first, visibly, as part of the pipeline
        const prepareIdx = STEPS.findIndex(s => s.name === 'prepare');
        updateStep(jobId, prepareIdx, { status: 'running', started_at: new Date().toISOString() });
        updateJob(jobId, { status: 'running' });
        emit(jobId, { type: 'job_started', job_id: jobId });
        emit(jobId, { type: 'step_started', step_index: prepareIdx, step_name: 'prepare', step_title: STEPS[prepareIdx].title });
        try {
          const prep = await prepareContent((msg) => {
            emit(jobId, { type: 'step_text', step_index: prepareIdx, delta: msg + '\n' });
          });
          content = prep.content;
          extractedNames = prep.extractedNames || fileNames;
          if (!content || content.length === 0) throw new Error('Prepare step produced empty content');
          const summary = `Prepared ${extractedNames.length} file(s): ${extractedNames.slice(0, 5).join(', ')}${extractedNames.length > 5 ? `, +${extractedNames.length - 5} more` : ''}`;
          updateStep(jobId, prepareIdx, {
            status: 'complete', completed_at: new Date().toISOString(),
            text: summary,
          });
          emit(jobId, { type: 'step_complete', step_index: prepareIdx, step_name: 'prepare', output: { extractedNames } });
          // Also update the job's file_names so the admin feed shows what's really in there
          try { updateJob(jobId, { file_names: JSON.stringify(extractedNames) }); } catch (e) {}
        } catch (prepErr) {
          console.error(`[DeepJob ${jobId}] prepare step failed:`, prepErr.stack || prepErr.message);
          updateStep(jobId, prepareIdx, {
            status: 'error', completed_at: new Date().toISOString(),
            text: 'Error: ' + prepErr.message,
          });
          updateJob(jobId, { status: 'failed', error_message: prepErr.message, completed_at: new Date().toISOString() });
          emit(jobId, { type: 'step_complete', step_index: prepareIdx, step_name: 'prepare', output: { error: prepErr.message } });
          emit(jobId, { type: 'job_error', error: prepErr.message, at_step: 'prepare' });
          return;
        }
      }
      await runPipeline(jobId, { userContent: content, apiKey, skipPrepare: true });
    } catch (err) {
      console.error('[DeepJob] unhandled:', err.stack || err.message);
      try {
        updateJob(jobId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
        emit(jobId, { type: 'job_error', error: err.message });
      } catch (e) {}
    }
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

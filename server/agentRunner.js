// Agent runner — executes the Claude tool-use loop for a given agent run.
// Streams text, thinking, and tool-call deltas to subscribers via SSE.
//
// The loop:
//   1. Assemble messages (history + any new tool_results from last turn).
//   2. Call Claude with TOOL_DEFINITIONS + stream: true.
//   3. Parse the streamed response into content blocks (text, thinking,
//      tool_use). Emit deltas to clients as they arrive.
//   4. If response has tool_use blocks: execute each, append tool_results,
//      loop.
//   5. If response has NO tool_use blocks (or submit_for_review was called):
//      we're done.
//
// Max 40 iterations as a safety cap; actual runs are typically 15-25.

const fs = require('fs');
const path = require('path');
const db = require('./database');
const agent = require('./agent');
let pdfGeometry; try { pdfGeometry = require('./pdfGeometry'); } catch (e) { pdfGeometry = null; }
let dxfReader; try { dxfReader = require('./dxfReader'); } catch (e) { dxfReader = null; }
let ocr; try { ocr = require('./ocr'); } catch (e) { ocr = null; }

// Read printed dimensions, areas, schedules (PDF text layer) and CAD geometry
// (DXF) straight off the uploaded files, so the agent starts with authoritative
// numbers rather than eyeballing rasters. Best-effort; returns '' on any issue.
async function buildDrawingGroundTruth(tmpDir, extractedNames) {
  const names = (extractedNames && extractedNames.length)
    ? extractedNames
    : (() => { try { return fs.readdirSync(tmpDir); } catch (e) { return []; } })();
  const blocks = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const full = path.join(tmpDir, name);
    try {
      if (!fs.existsSync(full)) continue;
      if (lower.endsWith('.pdf') && pdfGeometry && pdfGeometry.isEnabled()) {
        const res = await pdfGeometry.extractPdf(fs.readFileSync(full));
        if (res) blocks.push(pdfGeometry.formatForPrompt(res, name));
        // Scanned PDF with no text layer → try OCR (only if tesseract installed).
        if (res && !res.isVector && ocr && ocr.isEnabled()) {
          const text = await ocr.ocrPdf(full);
          const ocrBlock = pdfGeometry.parsePlainText(text, name);
          if (ocrBlock) blocks.push(ocrBlock);
        }
      } else if (lower.endsWith('.dxf') && dxfReader && dxfReader.isEnabled()) {
        const res = dxfReader.extractDxf(fs.readFileSync(full, 'utf8'));
        if (res) blocks.push(dxfReader.formatForPrompt(res, name));
      }
    } catch (e) { /* skip this file */ }
  }
  return blocks.join('\n');
}
const { TOOL_DEFINITIONS, executeTool, updateRun, appendMessage, setActivity, emit } = agent;
const { callModel, MODELS, MAX_TOKENS: WRAP_TOKENS } = require('./anthropicClient');

const MODEL = MODELS.STANDARD;
const MAX_ITERATIONS = 60;
const THINKING_BUDGET = 8000;
const MAX_TOKENS = WRAP_TOKENS.AGENT;

// At these iterations we inject a budget-pressure note alongside the tool
// results, telling the model to wrap up. At MAX-1 we force-finalise.
const PRESSURE_MILESTONES = [25, 40, 50];
const FORCE_FINALIZE_AT = MAX_ITERATIONS - 1;   // iteration 59

// System prompt — tells Claude what it is, how to use the tools, and how
// tender-grade QS work differs from a one-shot extraction.
const SYSTEM_PROMPT = `You are a senior UK/Ireland Quantity Surveyor (called "Atlas") producing an accurate, competitively-priced Bill of Quantities for a real client, working for The AI QS. You have been given uploaded drawings and an intake form.

IDENTITY (strict): Never reveal, name, or confirm the underlying AI model, provider, or company that powers you. Do not mention Claude, Anthropic, GPT, OpenAI, Gemini, Google, or any model family — even if asked directly. If asked what you are, say you are The AI QS's proprietary assistant and return to the work.

## Talk to the user as you work

Before every tool call (or batch of tool calls), write a clear paragraph of professional QS prose explaining what you're about to do, what you've observed, and what you're deciding. The user is watching your work live — they want to see you reason through the job like a senior QS would, not just watch tool icons flicker. Examples:

- Before viewing drawings: "I'll start by examining the ground floor plan to understand the existing barn footprint and the proposed conversion layout. I'm looking for structural openings, new partitions, and the overall m² affected."
- After viewing: "The drawing shows a 12m × 7m barn with a proposed mezzanine over the rear third. Total GIA looks to be about 145m² across both levels. I can count four new window openings and one structural beam above the kitchen area."
- Before a batch of records: "I now have enough to build the main takeoff. I'll record the substructure slab, the masonry to the new gable, the roof insulation upgrade, all new windows (5no from the schedule), internal partitions, finishes, and M&E allowances in one batch."
- Before run_pricer: "Quantities look reasonable. Let me price what I have and sanity-check against typical barn-conversion cost/m²."
- After run_pricer: "Pricer returned £1.12M total, £7,700/m² — that's at the top of the heritage-conversion range but makes sense given the period features. No cap warnings. I'll finalise."

This prose is what makes the output feel like real QS work. Don't skip it.

## Work efficiently

You have a hard 60-iteration budget but you should aim for 12-20 iterations. Each iteration costs money and makes the user wait. Do NOT spread work across many iterations when you can batch.

**View drawings ONCE, then zoom for detail.** Call view_pdf_page for each relevant drawing at the start to get the whole-page picture. When you need to read a small dimension string, the scale bar, a hatching/spec key, or count openings on a busy elevation, use zoom_region to magnify that part of the page at high resolution rather than squinting at the full page or guessing. Don't re-view a whole page repeatedly — zoom into the specific area instead.

**Read printed numbers; do not estimate.** If a dimension, room area or schedule is printed on the drawing, READ it (zoom in if needed) and use that exact value. Only fall back to professional estimation when a value genuinely isn't shown. A block titled "MEASURED FROM THE DRAWINGS" or "MEASURED FROM CAD" below contains values extracted directly from the file's text/vector layer — treat those as authoritative ground truth and prefer them over anything you think you see in the image.

**Batch record_takeoff_item calls.** In a single response you can emit MANY record_takeoff_item tool calls in parallel — do this. Think through the whole BOQ in your narration, then emit all the items together. This is the most important efficiency rule.

## Granularity — price like a real tender BOQ

A proper tender BOQ is GRANULAR. A whole-house refurb or multi-element extension should have **roughly 70–150 line items**, not 20–30 lumped ones. Lumping a whole trade into one "Item" line (e.g. one "Kitchen installation £11k" line, or one "Preliminaries £5k" line) looks amateur and can't be tendered. Break every trade down:

- **Preliminaries** — itemise separately: site establishment & welfare; scaffold (state extent); skips & waste removal; site management & supervision; temporary protection to retained features; CDM/Building Safety duties; asbestos R&D survey (P.Sum); contract insurances; Building Control & structural inspection fees; final clean & handover. That's ~10 lines, not one.
- **Demolition / strip-out** — separate line per element: each chimney breast removal, sanitaryware strip-out, partition removal, ceiling strip, floor lift, services disconnection, etc.
- **Each trade** — split into its real components with specified materials. E.g. external wall = facing brick outer leaf (m²) + cavity insulation (m²) + blockwork inner leaf (m²) + wall ties (Nr) + cavity closers (m) + DPC (m) — separate lines, each with its own rate, not one "external walls" line.
- **Windows & doors** — one line per type from the schedule (each window code, each door), with size/spec, not "new windows" as a single line.
- **Name the spec** in descriptions like a QS does: products, grades, thicknesses, standards (e.g. "Marley Acme single-camber clay plain tiles on battens & breathable membrane", "Catnic steel lintels to openings", "150mm Kingspan TP10 under slab", "FENSA-compliant aluminium double-glazed window 1200×1200"). Generic descriptions ("new kitchen", "internal finishes") are not acceptable.
- Use **P.Sum** (provisional sum) for items that genuinely can't be measured yet (asbestos works, statutory connections), and **Item** only for true lump sums — but prefer measured quantities (m², m, m³, Nr) wherever the drawings allow.

When you have the drawings' ground truth (dimensions, areas, schedules), use it to MEASURE each component so the quantities are real, then record each as its own line. Aim high on granularity: more, well-specified lines is what makes this read like senior QS work rather than a rough estimate. Emit them all in one or two big batched turns.

**Run the pricer 1-2 times max.** Once after recording items, once more after adjustments if needed. Don't re-run repeatedly.

**Call submit_for_review early.** As soon as the pricer result looks reasonable (sensible cost/m², sensible section split, no critical warnings), submit it. The user reviews the items themselves and clicks Generate to produce the documents — you do NOT generate documents directly. Do not keep polishing beyond the obvious.

## The workflow

1. Narrate what you're about to do, then view each uploaded drawing once via view_pdf_page. Build a clear mental picture, and zoom_region into title blocks, scale bars, dimension chains and schedules to read exact values. Cross-check the scale you read against any "MEASURED FROM THE DRAWINGS" block.
2. Narrate what you observed, then call set_project_metadata. CRITICAL — PROPERTY ADDRESS & JURISDICTION: read the full property address from the drawing TITLE BLOCK, including the postcode/Eircode, and put it in the location field. The address on the drawings is AUTHORITATIVE and determines currency + VAT — a UK postcode (e.g. "RH7 6HL", "M1 4WP") means UK pricing in GBP at 20% VAT; an Irish address or Eircode means Ireland in EUR at 13.5%. Use the address you READ on the drawings even if the intake or your prior context assumed a different country. Only fall back to the intake's jurisdiction if the drawings show no address. ONE CURRENCY ONLY: once you've set the jurisdiction, every figure you write — narration, notes, findings, totals — uses that one currency symbol. Never mention the other currency or give dual-currency figures. floor_area_m2 is the TOTAL gross internal floor area (all floors, all affected spaces) — not just an extension footprint. For a barn conversion include the whole barn area; for a full-house refurb include the whole house. If the intake gave a floor area, TRUST IT.
3. Narrate your measurement reasoning, then in ONE or two responses emit record_takeoff_item many times to build the full, GRANULAR takeoff (see "Granularity" above — aim for ~70-150 specified line items on a whole-house or multi-element job, broken down by component with named specs). Include prelims (itemised), demolition/strip-out, substructure, superstructure, roof, windows & doors, internal finishes, floor finishes, decoration, fit-out, drainage, M&E, external works as appropriate. Every item description must include measurement working — e.g. "External wall 8.2m × 2.7m = 22.1m² less 1 window 1.2m² = 20.9m²".
4. Narrate that you're about to price, then call run_pricer. Narrate the result, reading warnings carefully:
   - Cap-fired warnings: if a cap is scaling totals way down, check for over-counts and use update_takeoff_item / remove_takeoff_item to fix them.
   - Rate-clip warnings: your assumed_rate was probably per-m² when it should have been per-m or vice versa — check the units.
   - Cost/m² wildly outside typical range: check for double-counts or missing items.
5. Adjust if needed (narrate why), re-price once, then call submit_for_review with comprehensive findings_notes and a 2-3 sentence review_summary for the user.

## Rates — READ THIS CAREFULLY (most common cause of an over-priced BOQ)

Each assumed_rate is the ALL-IN, keen, current market rate a COMPETITIVE contractor would actually quote to win this work — the rate per single unit, with the contractor's own overhead and profit already inside it, before any location uplift. The system adds NOTHING on top (no automatic contingency, no OH&P stack) — your rates ARE the price the client sees, exactly like a real builder's quote. So price each line at what the job genuinely gets done for locally: not a stripped-back labour-and-materials cost, and not a cautious defensive tender allowance either.

NEVER record a contingency, "overheads & profit", OH&P, margin, markup, or percentage-prelims line item — there is no margin stack to feed, and the pricer strips such lines anyway. (Do itemise REAL prelims with real costs: scaffold, welfare, skips, supervision, Building Control, structural engineer fees. Genuine provisional sums for genuinely unknowable scope are fine. Just never a "% contingency" or "% OH&P" line.)

Sense-check before you submit: would a competent local contractor actually charge this for the job shown? The grand total ex-VAT should read like the winning quote among three local builders. Small remedial/repair jobs are priced keenly — a few hundred to low thousands per item — not at new-build defensive tender rates. If your section subtotals look high for the scope, your rates are probably loaded; bring them back to keen market level.

Use standard item keys from the rate library where possible (concrete_slab_150mm, brick_outer_leaf, plasterboard_skim_walls, kitchen_fitout_high, etc.). For bespoke items, set a realistic all-in assumed_rate in GBP (pre-location uplift only — the location factor is applied automatically).

## Currency and format

For UK/Ireland residential: use NRM2-style section names (Preliminaries, Substructure, Superstructure, Roof, Windows & Doors, Internal Finishes, Floor Finishes, Decoration, Fit-Out, Drainage, M&E, External Works). Irish projects auto-convert to €, 13.5% VAT.

State assumptions and exclusions explicitly in findings_notes — this is what the client reads.

**Remember: narrate before every tool batch. Work in 2-3 big turns of narration + batched tools, not 20 silent single-tool turns.**`;

// Claude's streaming tool-use loop — delegates HTTP + SSE parsing to the shared
// anthropicClient wrapper, which assembles content blocks (text/thinking/tool_use)
// and replays granular events so we can stream them to subscribers via emit().
async function callClaudeStreaming({ apiKey, system, messages, tools, runId, iteration }) {
  const result = await callModel({
    model: MODEL,
    apiKey,
    system,
    messages,
    tools,
    maxTokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
    stream: true,
    // Phase 2 caching: the system prompt is a constant and the message history
    // (drawings + rendered page images in tool_results) grows every iteration but
    // its prefix is byte-identical to the previous turn. Cache the system block and
    // place an incremental breakpoint on the last message so each iteration reads
    // the prior prefix from cache instead of re-billing it at full input price.
    cacheSystem: true,
    cacheLastMessage: true,
    onEvent: (evt) => { try { emit(runId, evt); } catch (e) {} },
  });

  if (!result.ok) {
    const errMsg = result.error?.error?.message || result.error?.message || result.status;
    throw new Error('Atlas engine error ' + (result.status || '') + ': ' + errMsg);
  }

  // Keep the { blocks, usage } shape the loop expects (Anthropic usage shape).
  return {
    blocks: result.blocks,
    usage: { input_tokens: result.usage.tokensIn, output_tokens: result.usage.tokensOut },
  };
}

// Heuristic: detect Ireland from any intake field so currency/defaults are
// set correctly even when the user only types a town ("Dublin", "Galway"…).
function intakeSuggestsIreland(intake) {
  if (!intake) return false;
  const blob = JSON.stringify(intake).toLowerCase();
  return /(\bireland\b|\birish\b|\birl\b|\bdublin\b|\bcork\b|\bgalway\b|\blimerick\b|\bwaterford\b|\bkilkenny\b|\bwexford\b|\bdonegal\b|\bsligo\b|\bmayo\b|\bkerry\b|\btipperary\b|\bclare\b|\blaois\b|\bmeath\b|\bkildare\b|\bwicklow\b|\bcarlow\b|\boffaly\b|\blongford\b|\bcavan\b|\bmonaghan\b|\broscommon\b|\bleitrim\b|\bwestmeath\b|\blouth\b|eircode|€)/i.test(blob);
}

// Build the initial user message content from uploaded files.
// For ZIPs we've already unpacked via zipProcessor; here we just describe
// what's in the tmp directory so the agent knows which files to view_pdf_page.
function buildInitialUserContent({ tmpDir, extractedNames, scopeText, intake, pdfNotes, userMemories, memoriesSuggestIreland, memoryContextBlob, topLearnedRates, drawingGroundTruth }) {
  const content = [];
  const fileList = extractedNames && extractedNames.length > 0
    ? extractedNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n')
    : '(no files — text-only scope)';

  let introText = `You have been given this BOQ request. Uploaded files have been extracted to a working directory; call view_pdf_page with the exact filename to inspect each drawing.\n\nFILES AVAILABLE:\n${fileList}`;

  if (scopeText) introText += `\n\nSCOPE NOTES FROM CLIENT:\n${scopeText}`;

  // Promote country/location into a prominent block the model cannot miss —
  // otherwise it defaults to UK/GBP even when the user's intake or saved
  // memories clearly indicate Ireland.
  if (intakeSuggestsIreland(intake)) {
    introText += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nLIKELY JURISDICTION: IRELAND (€ / 13.5% VAT) — from this job's intake.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nUse this ONLY as a fallback. The property address on the drawing title block is authoritative: if the drawings show a UK postcode/address, price the job as UK (£, 20% VAT) and set a UK location — do NOT force Ireland. If the drawings confirm Ireland (or show no address), set location to the Irish county/city (e.g. "Dublin, Ireland") and price in € at 13.5% VAT.`;
  } else if (memoriesSuggestIreland) {
    // The user has MENTIONED Ireland in saved memories — that says nothing
    // about THIS job. A soft note only; jurisdiction comes from the drawings.
    introText += `\n\nNOTE: this user has worked in Ireland before, but that does not apply to this job unless the drawings say so. Read the jurisdiction off the title block as normal: UK address -> £ at 20% VAT; Irish address/Eircode -> € at 13.5% VAT.`;
  }

  if (intake) {
    introText += `\n\nCLIENT INTAKE ANSWERS (treat as ground truth):\n${JSON.stringify(intake, null, 2)}`;
  }

  // User memories — the "this is who I am" context. Includes their default
  // country, preferred spec level, rate-library signals, past projects.
  if (userMemories && userMemories.length > 0) {
    const byCategory = {};
    for (const m of userMemories) {
      const cat = m.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(m.content);
    }
    const lines = Object.entries(byCategory)
      .map(([cat, items]) => `  ${cat}:\n${items.map(t => `    - ${t}`).join('\n')}`)
      .join('\n');
    introText += `\n\nUSER'S SAVED PROFILE / MEMORY (what this QS has told us about themselves):\n${lines}`;
  }

  if (pdfNotes && pdfNotes.length > 0) introText += `\n\nPDF HANDLING NOTES:\n${pdfNotes.join('\n')}`;

  // Authoritative numbers read straight off the drawings' text/CAD layer.
  if (drawingGroundTruth && drawingGroundTruth.trim()) introText += `\n${drawingGroundTruth}`;

  // Learned rates — inject the user's highest-confidence rates observed on
  // past jobs. Atlas should prefer these over library defaults when the
  // matching item comes up.
  if (topLearnedRates && topLearnedRates.length > 0) {
    // Each rate was learned in its own jurisdiction — label it with ITS
    // currency, not a global guess, or UK jobs get € rates in the prompt.
    const symFor = (r) => /\b(ireland|irish|dublin|cork|galway|limerick)\b/i.test(r.region || '') ? '€' : '£';
    const rateLines = topLearnedRates.slice(0, 20).map(r =>
      `  ${r.item_key} = ${symFor(r)}${Math.round(r.rate)} (${r.project_type === 'any' ? 'all projects' : r.project_type}, ${r.region}, n=${r.sample_count})`
    ).join('\n');
    introText += `\n\nLEARNED RATES FROM THIS USER'S PAST PROJECTS (prefer these when applicable — they reflect their actual observed costs, not library defaults):\n${rateLines}`;
  }

  // Historical benchmarks + quantity ranges + corrections — the memoryEngine
  // already formats this for prompt injection. It tells the agent the range
  // of cost/m² this user has seen and the quantity ranges for each element
  // across their past projects. Atlas should use these to sanity-check its
  // own measurements and final total.
  if (memoryContextBlob && memoryContextBlob.trim()) {
    introText += `\n\nHISTORICAL CONTEXT FROM THIS USER'S PAST WORK (use these ranges to sanity-check your takeoff — flag and investigate anything that falls outside):${memoryContextBlob}`;
  }

  introText += `\n\nPlease proceed methodically: first view each PDF to understand the project, then set_project_metadata (using the jurisdiction/location from the intake above), then build the takeoff in a batched response, sanity-check via run_pricer, iterate if needed, and submit_for_review when satisfied. The user will then review the items and trigger document generation themselves — do NOT try to generate documents yourself.\n\nWhen you report back to the user in submit_for_review, state how the grand total compares to the ranges above if relevant (e.g. "at the top of your typical €X-Y/m² range" or "20% below your usual — I flagged the reason in findings"). This builds trust.`;

  content.push({ type: 'text', text: introText });
  return content;
}

// Build a short nudge paragraph to inject alongside tool_results when the
// iteration budget is getting tight. Shoved as an extra text content block
// in the next user turn so Claude sees it before generating its reply.
function budgetNudge(iteration, itemsCount) {
  const left = MAX_ITERATIONS - iteration;
  if (iteration >= 50) {
    return `[BUDGET WARNING] Iteration ${iteration}/${MAX_ITERATIONS}. You have ${left} iterations left. STOP recording new items and STOP viewing drawings. In your NEXT response: if you haven't run_pricer recently, call it once, then call submit_for_review immediately. Currently ${itemsCount} items recorded — that's enough, finalize now.`;
  }
  if (iteration >= 40) {
    return `[BUDGET NOTE] Iteration ${iteration}/${MAX_ITERATIONS}. Wrap up in the next 2-3 iterations. Currently ${itemsCount} items. Record any critical gaps in ONE batched response, then run_pricer, then submit_for_review.`;
  }
  if (iteration >= 25) {
    return `[BUDGET NOTE] Iteration ${iteration}/${MAX_ITERATIONS}. You've used ${iteration} iterations. Currently ${itemsCount} items recorded. Please BATCH any remaining items into a single response (many record_takeoff_item calls in parallel), then run_pricer once, then submit_for_review. Don't spread work across more turns.`;
  }
  return null;
}

// When we've hit the cap without submitting for review, we invoke
// submit_for_review programmatically so the user can still see the
// takeoff, edit if needed, and generate. Better than "failed" with
// nothing to show — they retain full control.
async function forceSubmitForReview(runId, runState) {
  const agent = require('./agent');
  const notes = `Agent reached iteration budget (${MAX_ITERATIONS}) without calling submit_for_review itself. Auto-submitting the ${runState.items.length} items collected so far — please review carefully before generating.`;
  const summary = `Takeoff paused at iteration cap with ${runState.items.length} items. Review below and adjust any quantities that look off before clicking Generate.`;
  try {
    const result = await agent.executeTool(runId, 'submit_for_review', { findings_notes: notes, review_summary: summary }, runState);
    console.log(`[Agent ${runId}] force-submitted for review: ${result?.content?.substring(0, 100)}`);
    return true;
  } catch (e) {
    console.error(`[Agent ${runId}] force-submit failed:`, e.message);
    return false;
  }
}

// Main runner — blocks until the run completes, fails, or hits the iteration cap.
async function runAgent({ runId, userId, apiKey, tmpDir, extractedNames, scopeText, intake, pdfNotes }) {
  // Pull user memories so the agent picks up the user's home country /
  // default rates / spec preferences. This is the "memory" wiring that
  // makes the system feel like it knows the user, not a cold start.
  let userMemories = [];
  try {
    const memoryStore = require('./memoryStore');
    userMemories = memoryStore.listMemories(db, { userId }).filter(m => m.is_active);
  } catch (e) { /* memory store may not be loaded */ }
  const memoryBlob = userMemories.map(m => m.content).join(' ').toLowerCase();
  const memoriesSuggestIreland = /(\bireland\b|\birish\b|\beur\b|€|dublin|cork|galway|limerick|waterford)/.test(memoryBlob);

  // Pull past-project benchmarks, client history, quantity ranges, and
  // learned rates from memoryEngine. This is what makes pricing accurate —
  // Atlas sees "your last 3 barn conversions in Ireland came in at
  // €1,950-2,150/m²" and measures / rates accordingly, instead of starting
  // from generic library defaults every time.
  let memoryContextBlob = '';
  let topLearnedRates = [];
  try {
    const memoryEngine = require('./memoryEngine');
    const region = memoryEngine.detectRegion(intake?.location || '');
    const projectType = intake?.project_type || 'any';
    memoryContextBlob = memoryEngine.buildMemoryContext(db, {
      userId,
      projectType,
      floorAreaM2: intake?.floor_area_m2 || null,
      region,
    }) || '';
    // Also pull the user's top-confidence rates so the agent picks the
    // right assumed_rate first time rather than relying on library defaults.
    try {
      topLearnedRates = db.prepare(`
        SELECT item_key, rate, region, project_type, sample_count, confidence
        FROM memory_rates
        WHERE (scope = 'client' AND user_id = ?)
           OR (scope = 'regional' AND region = ?)
        ORDER BY confidence DESC, sample_count DESC
        LIMIT 25
      `).all(userId, region);
    } catch (e) {}
  } catch (e) { /* memoryEngine optional — degrade gracefully */ }

  // Pre-seed the runState with intake-derived hints (Ireland jurisdiction,
  // suggested currency). The pricer falls back to these when the agent
  // set_project_metadata with a weak or UK-looking location string.
  // Job-level signal ONLY. Memories mentioning Ireland must never force a
  // currency override on an unrelated UK job.
  const intakeCurrency = intakeSuggestsIreland(intake) ? 'EUR' : null;

  const runState = {
    userId,
    tmpDir,
    intake,
    intakeCurrency,
    metadata: null,
    items: [],
    lastPriced: null,
    finalized: false,
  };

  updateRun(runId, { status: 'running' });
  emit(runId, { type: 'run_started', runId });

  let drawingGroundTruth = '';
  try { drawingGroundTruth = await buildDrawingGroundTruth(tmpDir, extractedNames); }
  catch (e) { console.error('[Agent] ground-truth extraction error:', e.message); }

  const initialContent = buildInitialUserContent({ tmpDir, extractedNames, scopeText, intake, pdfNotes, userMemories, memoriesSuggestIreland, memoryContextBlob, topLearnedRates, drawingGroundTruth });
  const messages = [{ role: 'user', content: initialContent }];
  appendMessage(runId, 0, 'user', initialContent);

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    updateRun(runId, { iteration_count: iteration });
    emit(runId, { type: 'iteration_start', iteration });
    setActivity(runId, `Thinking (iteration ${iteration}/${MAX_ITERATIONS})`);

    let result;
    try {
      result = await callClaudeStreaming({ apiKey, system: SYSTEM_PROMPT, messages, tools: TOOL_DEFINITIONS, runId, iteration });
    } catch (err) {
      console.error(`[Agent ${runId}] Claude call failed:`, err.stack || err.message);
      updateRun(runId, { status: 'failed', error_message: err.message, completed_at: new Date().toISOString() });
      emit(runId, { type: 'error', message: err.message });
      return;
    }

    // Update cost counters
    const usageRow = db.prepare('SELECT total_input_tokens, total_output_tokens FROM agent_runs WHERE id = ?').get(runId);
    updateRun(runId, {
      total_input_tokens: (usageRow?.total_input_tokens || 0) + (result.usage.input_tokens || 0),
      total_output_tokens: (usageRow?.total_output_tokens || 0) + (result.usage.output_tokens || 0),
    });

    // Append the assistant's full response to history
    messages.push({ role: 'assistant', content: result.blocks });
    appendMessage(runId, iteration, 'assistant', result.blocks);

    // Find any tool_use blocks
    const toolUseBlocks = result.blocks.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      // No tools called — Claude is done speaking. If we have items but
      // weren't finalised, force-finalise so the user gets downloads.
      if (!runState.finalized && runState.items.length > 0) {
        setActivity(runId, 'Auto-finalising (agent stopped without submit_for_review)');
        await forceSubmitForReview(runId, runState);
      } else {
        updateRun(runId, { status: 'completed', completed_at: new Date().toISOString() });
      }
      emit(runId, { type: 'run_complete', reason: runState.finalized ? 'finalized' : 'no_more_tools' });
      return;
    }

    // Execute each tool, build tool_result blocks for next turn
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      let result2;
      try {
        result2 = await executeTool(runId, tu.name, tu.input || {}, runState);
      } catch (toolErr) {
        console.error(`[Agent ${runId}] Tool ${tu.name} threw:`, toolErr.stack || toolErr.message);
        result2 = { type: 'tool_result', content: `Tool error: ${toolErr.message}`, is_error: true };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: result2.content,
        ...(result2.is_error ? { is_error: true } : {}),
      });
      emit(runId, { type: 'tool_result', tool: tu.name, is_error: !!result2.is_error });

      // If submit_for_review (or legacy submit_for_review) was called and it
      // set runState.finalized, log the result and exit — the run is now
      // paused awaiting user approval in the UI.
      if ((tu.name === 'submit_for_review' || tu.name === 'submit_for_review') && runState.finalized) {
        messages.push({ role: 'user', content: toolResults });
        appendMessage(runId, iteration, 'user', toolResults);
        emit(runId, { type: 'run_complete', reason: 'awaiting_review' });
        return;
      }
    }

    // Inject a budget-pressure nudge if appropriate (as an extra text block
    // in the user turn alongside the tool_results). This forces the model
    // to see the warning before its next reply.
    const nudge = PRESSURE_MILESTONES.includes(iteration) ? budgetNudge(iteration, runState.items.length) : null;
    const userContent = nudge ? [...toolResults, { type: 'text', text: nudge }] : toolResults;
    messages.push({ role: 'user', content: userContent });
    appendMessage(runId, iteration, 'user', userContent);

    // Safety net: if we're about to burn the last iteration and Claude
    // still hasn't finalised, stop and force-finalise now so the user
    // gets their downloads from whatever the agent did manage.
    if (iteration >= FORCE_FINALIZE_AT && !runState.finalized && runState.items.length > 0) {
      setActivity(runId, 'Hit iteration cap — auto-finalising with items collected so far');
      const ok = await forceSubmitForReview(runId, runState);
      if (ok) {
        emit(runId, { type: 'run_complete', reason: 'force_finalized' });
      } else {
        updateRun(runId, {
          status: 'failed',
          error_message: 'Hit iteration cap and force-finalise failed.',
          completed_at: new Date().toISOString(),
        });
        emit(runId, { type: 'error', message: 'max_iterations_reached' });
      }
      return;
    }
  }

  // Ran the full loop without break — genuinely failed
  if (!runState.finalized && runState.items.length > 0) {
    await forceSubmitForReview(runId, runState);
    emit(runId, { type: 'run_complete', reason: 'force_finalized_end' });
    return;
  }
  updateRun(runId, {
    status: 'failed',
    error_message: `Hit max iterations (${MAX_ITERATIONS}) without items to salvage.`,
    completed_at: new Date().toISOString(),
  });
  emit(runId, { type: 'error', message: 'max_iterations_reached' });
}

module.exports = { runAgent, SYSTEM_PROMPT, MAX_ITERATIONS };

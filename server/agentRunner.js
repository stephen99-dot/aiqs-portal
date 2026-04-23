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
//   5. If response has NO tool_use blocks (or finalize_boq was called):
//      we're done.
//
// Max 40 iterations as a safety cap; actual runs are typically 15-25.

const fs = require('fs');
const path = require('path');
const db = require('./database');
const agent = require('./agent');
const { TOOL_DEFINITIONS, executeTool, updateRun, appendMessage, setActivity, emit } = agent;

const MODEL = 'claude-sonnet-4-20250514';
const MAX_ITERATIONS = 60;
const THINKING_BUDGET = 8000;
const MAX_TOKENS = 20000;

// At these iterations we inject a budget-pressure note alongside the tool
// results, telling the model to wrap up. At MAX-1 we force-finalise.
const PRESSURE_MILESTONES = [25, 40, 50];
const FORCE_FINALIZE_AT = MAX_ITERATIONS - 1;   // iteration 59

// System prompt — tells Claude what it is, how to use the tools, and how
// tender-grade QS work differs from a one-shot extraction.
const SYSTEM_PROMPT = `You are a senior UK/Ireland Quantity Surveyor producing a tender-grade Bill of Quantities for a real client. You have been given uploaded drawings and an intake form.

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

**View drawings ONCE.** Call view_pdf_page for each relevant drawing at the start. Study it carefully in one look. Don't re-view the same page unless you're verifying one specific dimension you clearly missed.

**Batch record_takeoff_item calls.** In a single response you can emit MANY record_takeoff_item tool calls in parallel — do this. A single turn should typically record 15-40 items in one go, not one at a time. Think through the whole BOQ in your narration, then emit all the items together. This is the most important efficiency rule.

**Run the pricer 1-2 times max.** Once after recording items, once more after adjustments if needed. Don't re-run repeatedly.

**Call finalize_boq early.** As soon as the pricer result looks reasonable (sensible cost/m², sensible section split, no critical warnings), finalise. Do not keep polishing.

## The workflow

1. Narrate what you're about to do, then view each uploaded drawing once via view_pdf_page. Build a clear mental picture.
2. Narrate what you observed, then call set_project_metadata. CRITICAL: floor_area_m2 is the TOTAL gross internal floor area (all floors, all affected spaces) — not just an extension footprint. For a barn conversion include the whole barn area; for a full-house refurb include the whole house. If the intake gave a floor area, TRUST IT.
3. Narrate your measurement reasoning, then in ONE response emit record_takeoff_item many times to build the full takeoff. Include prelims, substructure, superstructure, roof, windows & doors, internal finishes, floor finishes, decoration, fit-out, drainage, M&E, external works as appropriate. Every item description must include measurement working — e.g. "External wall 8.2m × 2.7m = 22.1m² less 1 window 1.2m² = 20.9m²".
4. Narrate that you're about to price, then call run_pricer. Narrate the result, reading warnings carefully:
   - Cap-fired warnings: if a cap is scaling totals way down, check for over-counts and use update_takeoff_item / remove_takeoff_item to fix them.
   - Rate-clip warnings: your assumed_rate was probably per-m² when it should have been per-m or vice versa — check the units.
   - Cost/m² wildly outside typical range: check for double-counts or missing items.
5. Adjust if needed (narrate why), re-price once, then call finalize_boq with comprehensive findings_notes.

## Rate library hints

Use standard item keys from the rate library where possible (concrete_slab_150mm, brick_outer_leaf, plasterboard_skim_walls, kitchen_fitout_high, etc.). For bespoke items, set a realistic assumed_rate in GBP (pre-location uplift).

## Currency and format

For UK/Ireland residential: use NRM2-style section names (Preliminaries, Substructure, Superstructure, Roof, Windows & Doors, Internal Finishes, Floor Finishes, Decoration, Fit-Out, Drainage, M&E, External Works). Irish projects auto-convert to €, 13.5% VAT.

State assumptions and exclusions explicitly in findings_notes — this is what the client reads.

**Remember: narrate before every tool batch. Work in 2-3 big turns of narration + batched tools, not 20 silent single-tool turns.**`;

// Claude's streaming SSE parser (tool-use aware)
async function callClaudeStreaming({ apiKey, system, messages, tools, runId, iteration }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
      system,
      messages,
      tools,
      stream: true,
    }),
  });

  if (!resp.ok) {
    let err = {};
    try { err = await resp.json(); } catch (e) {}
    throw new Error('Claude error ' + resp.status + ': ' + (err?.error?.message || resp.statusText));
  }

  // Accumulators: per-block state during streaming
  const blocks = [];     // final assembled content blocks
  const blockStates = {}; // index -> { type, partialJson, accumulatedText, toolName, toolId }
  let usage = { input_tokens: 0, output_tokens: 0 };

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

      switch (evt.type) {
        case 'message_start':
          if (evt.message?.usage) usage.input_tokens = evt.message.usage.input_tokens || 0;
          break;

        case 'content_block_start': {
          const idx = evt.index;
          const block = evt.content_block;
          if (block.type === 'text') {
            blockStates[idx] = { type: 'text', accumulatedText: '' };
            blocks[idx] = { type: 'text', text: '' };
          } else if (block.type === 'thinking') {
            blockStates[idx] = { type: 'thinking', accumulatedText: '' };
            blocks[idx] = { type: 'thinking', thinking: '', signature: '' };
          } else if (block.type === 'tool_use') {
            blockStates[idx] = { type: 'tool_use', toolId: block.id, toolName: block.name, partialJson: '' };
            blocks[idx] = { type: 'tool_use', id: block.id, name: block.name, input: {} };
            emit(runId, { type: 'tool_call_start', tool: block.name, id: block.id });
          }
          break;
        }

        case 'content_block_delta': {
          const idx = evt.index;
          const state = blockStates[idx];
          if (!state) break;
          if (evt.delta.type === 'text_delta') {
            state.accumulatedText += evt.delta.text;
            blocks[idx].text = state.accumulatedText;
            emit(runId, { type: 'text_delta', delta: evt.delta.text });
          } else if (evt.delta.type === 'thinking_delta') {
            state.accumulatedText += evt.delta.thinking;
            blocks[idx].thinking = state.accumulatedText;
            emit(runId, { type: 'thinking_delta', delta: evt.delta.thinking });
          } else if (evt.delta.type === 'input_json_delta') {
            state.partialJson = (state.partialJson || '') + (evt.delta.partial_json || '');
          } else if (evt.delta.type === 'signature_delta') {
            blocks[idx].signature = (blocks[idx].signature || '') + (evt.delta.signature || '');
          }
          break;
        }

        case 'content_block_stop': {
          const idx = evt.index;
          const state = blockStates[idx];
          if (state && state.type === 'tool_use') {
            try { blocks[idx].input = JSON.parse(state.partialJson || '{}'); }
            catch (e) { blocks[idx].input = {}; }
            emit(runId, { type: 'tool_call', tool: state.toolName, input: blocks[idx].input });
          }
          break;
        }

        case 'message_delta':
          if (evt.usage?.output_tokens != null) usage.output_tokens = evt.usage.output_tokens;
          break;

        case 'error':
          throw new Error(evt.error?.message || 'Stream error');
      }
    }
  }

  // Filter out undefined holes (shouldn't happen but defensive)
  const finalBlocks = blocks.filter(b => b);
  return { blocks: finalBlocks, usage };
}

// Build the initial user message content from uploaded files.
// For ZIPs we've already unpacked via zipProcessor; here we just describe
// what's in the tmp directory so Claude knows which files to view_pdf_page.
function buildInitialUserContent({ tmpDir, extractedNames, scopeText, intake, pdfNotes }) {
  const content = [];
  const fileList = extractedNames && extractedNames.length > 0
    ? extractedNames.map((n, i) => `  ${i + 1}. ${n}`).join('\n')
    : '(no files — text-only scope)';

  let introText = `You have been given this BOQ request. Uploaded files have been extracted to a working directory; call view_pdf_page with the exact filename to inspect each drawing.\n\nFILES AVAILABLE:\n${fileList}`;

  if (scopeText) introText += `\n\nSCOPE NOTES FROM CLIENT:\n${scopeText}`;
  if (intake) introText += `\n\nCLIENT INTAKE ANSWERS (treat as ground truth):\n${JSON.stringify(intake, null, 2)}`;
  if (pdfNotes && pdfNotes.length > 0) introText += `\n\nPDF HANDLING NOTES:\n${pdfNotes.join('\n')}`;

  introText += `\n\nPlease proceed methodically: first view each PDF to understand the project, then set_project_metadata, then build the takeoff item by item, sanity-check via run_pricer, iterate if needed, and finalize_boq when satisfied.`;

  content.push({ type: 'text', text: introText });
  return content;
}

// Build a short nudge paragraph to inject alongside tool_results when the
// iteration budget is getting tight. Shoved as an extra text content block
// in the next user turn so Claude sees it before generating its reply.
function budgetNudge(iteration, itemsCount) {
  const left = MAX_ITERATIONS - iteration;
  if (iteration >= 50) {
    return `[BUDGET WARNING] Iteration ${iteration}/${MAX_ITERATIONS}. You have ${left} iterations left. STOP recording new items and STOP viewing drawings. In your NEXT response: if you haven't run_pricer recently, call it once, then call finalize_boq immediately. Currently ${itemsCount} items recorded — that's enough, finalize now.`;
  }
  if (iteration >= 40) {
    return `[BUDGET NOTE] Iteration ${iteration}/${MAX_ITERATIONS}. Wrap up in the next 2-3 iterations. Currently ${itemsCount} items. Record any critical gaps in ONE batched response, then run_pricer, then finalize_boq.`;
  }
  if (iteration >= 25) {
    return `[BUDGET NOTE] Iteration ${iteration}/${MAX_ITERATIONS}. You've used ${iteration} iterations. Currently ${itemsCount} items recorded. Please BATCH any remaining items into a single response (many record_takeoff_item calls in parallel), then run_pricer once, then finalize_boq. Don't spread work across more turns.`;
  }
  return null;
}

// When we've hit the cap without finalising, we invoke finalize_boq
// programmatically so the user still gets downloads from whatever the
// agent did manage to record. Better than "failed" with nothing to show.
async function forceFinalise(runId, runState) {
  const agent = require('./agent');
  const itemsNote = `Agent reached iteration budget (${MAX_ITERATIONS}) without calling finalize_boq itself. Auto-finalising with ${runState.items.length} items as-is. Client should review.`;
  try {
    const result = await agent.executeTool(runId, 'finalize_boq', { findings_notes: itemsNote }, runState);
    console.log(`[Agent ${runId}] force-finalised at cap: ${result?.content?.substring(0, 100)}`);
    return true;
  } catch (e) {
    console.error(`[Agent ${runId}] force-finalise failed:`, e.message);
    return false;
  }
}

// Main runner — blocks until the run completes, fails, or hits the iteration cap.
async function runAgent({ runId, userId, apiKey, tmpDir, extractedNames, scopeText, intake, pdfNotes }) {
  const runState = {
    userId,
    tmpDir,
    metadata: null,
    items: [],
    lastPriced: null,
    finalized: false,
  };

  updateRun(runId, { status: 'running' });
  emit(runId, { type: 'run_started', runId });

  const initialContent = buildInitialUserContent({ tmpDir, extractedNames, scopeText, intake, pdfNotes });
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
        setActivity(runId, 'Auto-finalising (agent stopped without finalize_boq)');
        await forceFinalise(runId, runState);
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

      // If finalize_boq was called, still add the tool result but exit after
      if (tu.name === 'finalize_boq' && runState.finalized) {
        messages.push({ role: 'user', content: toolResults });
        appendMessage(runId, iteration, 'user', toolResults);
        emit(runId, { type: 'run_complete', reason: 'finalized' });
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
      const ok = await forceFinalise(runId, runState);
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
    await forceFinalise(runId, runState);
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

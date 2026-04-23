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
const MAX_ITERATIONS = 40;
const THINKING_BUDGET = 10000;
const MAX_TOKENS = 16000;

// System prompt — tells Claude what it is, how to use the tools, and how
// tender-grade QS work differs from a one-shot extraction.
const SYSTEM_PROMPT = `You are a senior UK/Ireland Quantity Surveyor producing a tender-grade Bill of Quantities for a real client. You have been given uploaded drawings and an intake form. Your job is to:

1. First, inspect EVERY uploaded drawing using view_pdf_page. Look at floor plans, elevations, sections, schedules, and any other relevant drawings. Build a clear picture of what's being built.

2. Record the project metadata using set_project_metadata as soon as you have a clear picture. CRITICAL: floor_area_m2 is the TOTAL gross internal floor area (all floors, all affected spaces) — not just an extension footprint. For a barn conversion include the whole barn area; for a full-house refurb include the whole house.

3. Work through the BOQ element-by-element. Use standard item keys from the rate library where possible (concrete_slab_150mm, brick_outer_leaf, plasterboard_skim_walls, kitchen_fitout_high, etc.). For bespoke items, set a realistic assumed_rate in GBP (pre-location uplift). Every item description should include the measurement working — "2no. walls @ 5.0m × 2.7m less 2no. windows @ 1.2 × 1.5m = 23.4m²".

4. Partway through and near the end, call run_pricer to sanity-check. READ THE WARNINGS CAREFULLY. If:
   - Any cap is firing and scaling your totals WAY down (e.g. a section cap or absolute construction cap), investigate — the pricer assumes typical extension economics. For barn conversions, heritage projects, large refurbs, the caps may be incorrectly tight. Use update_takeoff_item / remove_takeoff_item to fix obvious over-counts that triggered them.
   - Any rate is getting clipped by the unit ceiling, the assumed_rate you provided was probably wrong for that unit — double-check or let the fallback apply.
   - The cost per m² is wildly outside the typical range for the project type, something's off. Go back and check.

5. Iterate. Run the pricer, adjust, run again. This is normal — a first-pass takeoff is rarely correct.

6. Only when the priced result makes QS sense (reasonable cost/m², sensible section proportions, no suspect warnings), call finalize_boq with your findings notes.

IMPORTANT:
- Do NOT rush straight to record_takeoff_item without looking at the drawings. The uploaded PDFs are attached as text summaries only — you MUST call view_pdf_page for each relevant drawing to actually see them.
- Include prelims, scaffolding, skip hire, welfare — these are real costs.
- For UK/Ireland residential: use NRM2-style sections (Preliminaries, Substructure, Superstructure, Roof, Windows & Doors, Internal Finishes, Floor Finishes, Decoration, Fit-Out, Drainage, M&E, External Works). Irish projects use €, 13.5% VAT.
- If the intake form gave a floor area, TRUST IT over anything you infer from drawings.
- State assumptions and exclusions explicitly in findings_notes.
- The client pays for this work. Rigour matters more than speed.

You have up to 40 tool-use iterations; most good runs use 15-25. Work methodically.`;

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
    setActivity(runId, `Thinking (iteration ${iteration})`);

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
      // No tools called — Claude is done speaking
      updateRun(runId, { status: 'completed', completed_at: new Date().toISOString() });
      emit(runId, { type: 'run_complete', reason: 'no_more_tools' });
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
        return;
      }
    }

    messages.push({ role: 'user', content: toolResults });
    appendMessage(runId, iteration, 'user', toolResults);
  }

  // Hit the iteration cap without finalizing
  updateRun(runId, {
    status: 'failed',
    error_message: `Hit max iterations (${MAX_ITERATIONS}) without finalize_boq. Check agent_messages for trail.`,
    completed_at: new Date().toISOString(),
  });
  emit(runId, { type: 'error', message: 'max_iterations_reached' });
}

module.exports = { runAgent, SYSTEM_PROMPT, MAX_ITERATIONS };

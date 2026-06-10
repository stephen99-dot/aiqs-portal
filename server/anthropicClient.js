// anthropicClient.js — the ONE module allowed to call the Anthropic API.
//
// Every other module (chat.js, agentRunner.js, autoLearn.js, enhance-brief.js,
// estimatorRoutes.js, pdfScaleReader.js, variationRoutes.js) goes through
// callModel() here. This centralises:
//   - model selection (MODELS registry)
//   - pricing + usage_log writes (PRICING map, one source of truth)
//   - retry/backoff on overload, and dropping tools when the API rejects them
//   - prompt caching (cache_control) so the hot path can read drawings/system
//     from cache instead of re-paying full input price (Phase 2)
//   - the two SSE parsers that used to live in chat.js (text/thinking/sources)
//     and agentRunner.js (tool-use-aware block assembly), unified here.
//
// Ground rules honoured: never log the API key or raw drawing base64.

const { v4: uuidv4 } = require('uuid');

let db;
try { db = require('./database'); } catch (e) { db = null; }

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ── Model registry ────────────────────────────────────────────────────────
// FAST: cheap text/JSON work. STANDARD: drawing extraction + chat with files.
// FRONTIER: hard jobs (Phase 5 router). Use the registry, not raw strings.
const MODELS = {
  FAST: 'claude-haiku-4-5-20251001',
  STANDARD: 'claude-sonnet-4-6',
  FRONTIER: 'claude-fable-5',
};

// ── Pricing, USD per token ──────────────────────────────────────────────────
// Verified against Anthropic's published per-million-token rates on 2026-06-10:
//   Haiku 4.5   $1 / $5      Sonnet 4.6  $3 / $15
//   Fable 5     $10 / $50    Opus 4.x    $5 / $25
// Cache writes bill at 1.25x input (5-min TTL); cache reads at ~0.1x input.
// Keep this table the single source of truth — call sites must not hardcode rates.
const PER_M = (input, output) => ({
  input: input / 1e6,
  output: output / 1e6,
  cacheWrite: (input * 1.25) / 1e6,
  cacheRead: (input * 0.1) / 1e6,
});
const PRICING = {
  'claude-haiku-4-5-20251001': PER_M(1, 5),
  'claude-haiku-4-5': PER_M(1, 5),
  'claude-sonnet-4-6': PER_M(3, 15),
  'claude-fable-5': PER_M(10, 50),
  // Legacy ids still referenced by historic usage_log rows / in-flight migration.
  'claude-sonnet-4-20250514': PER_M(3, 15),
  'claude-opus-4-5': PER_M(5, 25),
  'claude-opus-4-8': PER_M(5, 25),
};

// Friendly tier label for usage_log.model_tier so cost-per-job by tier is queryable.
function tierFor(model) {
  if (!model) return null;
  if (model === MODELS.FRONTIER) return 'frontier';
  if (model.includes('haiku')) return 'fast';
  if (model.includes('sonnet')) return 'standard';
  if (model.includes('fable')) return 'frontier';
  if (model.includes('opus')) return 'frontier';
  return 'standard';
}

function priceFor(model) {
  return PRICING[model] || PRICING['claude-sonnet-4-6'];
}

// ── max_tokens, right-sized per call site (Phase 3) ─────────────────────────
// These are output ceilings, not targets — sized to the largest realistic output
// for each call so we never truncate, without leaving 16-20k headroom everywhere.
const MAX_TOKENS = {
  CHAT: 4000,        // conversational reply (deterministic pricer does the maths)
  EXTRACTION: 12000, // Stage 1 — big item arrays
  VALIDATION: 6000,  // Stage 1b — corrections array
  FINDINGS: 4000,    // narrative report JSON
  SCALE_READER: 2000,// per-drawing measurement JSON
  AGENT: 12000,      // one agent turn (narration + tool calls)
};

function computeCost(model, u) {
  const p = priceFor(model);
  return (u.tokensIn || 0) * p.input
    + (u.tokensOut || 0) * p.output
    + (u.cacheWrite || 0) * p.cacheWrite
    + (u.cacheRead || 0) * p.cacheRead;
}

// ── Cache helpers ───────────────────────────────────────────────────────────
// cache_control marks the prefix boundary. Any byte change before it misses the
// cache, so callers must keep the cached portion byte-identical across calls.
const EPHEMERAL = { type: 'ephemeral' };

// Put a breakpoint on the final block of a system prompt (string or block array).
function withCachedSystem(system) {
  if (!system) return system;
  if (typeof system === 'string') {
    return [{ type: 'text', text: system, cache_control: EPHEMERAL }];
  }
  if (Array.isArray(system) && system.length) {
    const blocks = system.map((b) => ({ ...b }));
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPHEMERAL };
    return blocks;
  }
  return system;
}

// Put a breakpoint on the last content block of the most-recent user message that
// carries document/image blocks, so extraction/validation/agent iterations read
// the drawings from cache instead of re-uploading them at full price.
function withCachedMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    const hasDoc = m.content.some((b) => b && (b.type === 'document' || b.type === 'image'));
    if (!hasDoc) continue;
    const content = m.content.map((b) => ({ ...b }));
    content[content.length - 1] = { ...content[content.length - 1], cache_control: EPHEMERAL };
    out[i] = { ...m, content };
    break;
  }
  return out;
}

// Incremental breakpoint: cache_control on the last content block of the LAST
// message, regardless of type. Used by the agent loop so each iteration's growing
// history (system + drawings + prior tool results) is read from cache on the next
// iteration. The breakpoint "moves forward" as messages append.
function withCachedLastMessage(messages) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: EPHEMERAL }];
  } else if (Array.isArray(last.content) && last.content.length) {
    const content = last.content.map((b) => ({ ...b }));
    content[content.length - 1] = { ...content[content.length - 1], cache_control: EPHEMERAL };
    last.content = content;
  }
  out[out.length - 1] = last;
  return out;
}

function readUsage(raw) {
  const u = (raw && raw.usage) || {};
  return {
    tokensIn: u.input_tokens || 0,
    tokensOut: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
}

function logUsage({ userId, action, detail, model, usage, cost }) {
  if (!db || !userId) return;
  try {
    db.prepare(
      'INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cache_creation_input_tokens, cache_read_input_tokens, model_tier, cost_estimate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'ul_' + uuidv4().slice(0, 8), userId, action || 'api_call', detail ? String(detail).slice(0, 200) : null,
      model, usage.tokensIn || 0, usage.tokensOut || 0, usage.cacheWrite || 0, usage.cacheRead || 0,
      tierFor(model), cost || 0
    );
  } catch (e) {
    console.error('[anthropicClient] usage_log error:', e.message);
  }
}

// ── Request body assembly ───────────────────────────────────────────────────
function buildBody({ model, system, messages, maxTokens, thinking, tools, toolChoice, effort, temperature, cacheSystem, cacheMessages, cacheLastMessage }) {
  const isFrontier = model === MODELS.FRONTIER || model.includes('fable');
  let msgs = messages;
  if (cacheMessages) msgs = withCachedMessages(msgs);
  if (cacheLastMessage) msgs = withCachedLastMessage(msgs);
  const body = { model, max_tokens: maxTokens, messages: msgs };
  if (system) body.system = cacheSystem ? withCachedSystem(system) : system;
  if (tools && tools.length) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  if (isFrontier) {
    // Fable: adaptive thinking only — never send a thinking block (400s).
    // Control depth via effort; sampling params are not accepted.
    if (effort) body.output_config = { effort };
  } else {
    if (thinking) body.thinking = thinking;
    if (effort) body.output_config = { effort };
    if (temperature != null) body.temperature = temperature;
  }
  return body;
}

function buildHeaders(apiKey, betaHeaders) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey || process.env.ANTHROPIC_API_KEY,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (betaHeaders) {
    headers['anthropic-beta'] = Array.isArray(betaHeaders) ? betaHeaders.join(',') : betaHeaders;
  }
  return headers;
}

function isOverload(status, errType) {
  return status === 529 || status === 429 || errType === 'overloaded_error' || errType === 'rate_limit_error';
}

// ── Non-streaming call ──────────────────────────────────────────────────────
async function callOnce(headers, body) {
  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (fetchErr) {
    return { ok: false, status: 0, error: { message: fetchErr.message } };
  }
  if (!resp.ok) {
    let err = {};
    try { err = await resp.json(); } catch (e) {}
    return { ok: false, status: resp.status, error: err };
  }
  const raw = await resp.json();
  return { ok: true, status: 200, raw };
}

// ── Streaming call (unifies chat.js + agentRunner SSE parsers) ──────────────
// onDelta(text)  — called for each text delta (chat token-by-token streaming)
// onEvent(evt)   — called for granular events the agent needs:
//                  { type:'text_delta'|'thinking_delta', delta }
//                  { type:'tool_call_start', tool, id }
//                  { type:'tool_call', tool, input }
async function callStream(headers, body, onDelta, onEvent) {
  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }) });
  } catch (fetchErr) {
    return { ok: false, status: 0, error: { message: fetchErr.message } };
  }
  if (!resp.ok) {
    let err = {};
    try { err = await resp.json(); } catch (e) {}
    return { ok: false, status: resp.status, error: err };
  }

  const blocks = [];            // assembled content blocks (text/thinking/tool_use)
  const blockStates = {};       // index -> streaming state
  let text = '';
  let thinking = '';
  const usage = { tokensIn: 0, tokensOut: 0, cacheWrite: 0, cacheRead: 0 };
  const sources = [];
  const seenSourceUrls = new Set();
  const addSource = (url, title) => {
    if (!url || seenSourceUrls.has(url)) return;
    seenSourceUrls.add(url);
    sources.push({ url, title: title || url });
  };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
        let evt;
        try { evt = JSON.parse(payload); } catch (e) { continue; }
        switch (evt.type) {
          case 'message_start':
            if (evt.message && evt.message.usage) {
              const u = evt.message.usage;
              usage.tokensIn = u.input_tokens || 0;
              usage.cacheWrite = u.cache_creation_input_tokens || 0;
              usage.cacheRead = u.cache_read_input_tokens || 0;
            }
            break;
          case 'content_block_start': {
            const idx = evt.index;
            const block = evt.content_block || {};
            if (block.type === 'text') {
              blockStates[idx] = { type: 'text' };
              blocks[idx] = { type: 'text', text: '' };
            } else if (block.type === 'thinking') {
              blockStates[idx] = { type: 'thinking' };
              blocks[idx] = { type: 'thinking', thinking: '', signature: '' };
            } else if (block.type === 'tool_use') {
              blockStates[idx] = { type: 'tool_use', partialJson: '', toolName: block.name };
              blocks[idx] = { type: 'tool_use', id: block.id, name: block.name, input: {} };
              if (onEvent) { try { onEvent({ type: 'tool_call_start', tool: block.name, id: block.id }); } catch (e) {} }
            } else if (block.type === 'web_search_tool_result') {
              const results = block.content;
              if (Array.isArray(results)) {
                for (const r of results) {
                  if (r && r.type === 'web_search_result' && r.url) addSource(r.url, r.title);
                }
              }
            }
            break;
          }
          case 'content_block_delta': {
            const idx = evt.index;
            const d = evt.delta || {};
            if (d.type === 'text_delta' && d.text) {
              text += d.text;
              if (blocks[idx]) blocks[idx].text = (blocks[idx].text || '') + d.text;
              if (onDelta) { try { onDelta(d.text); } catch (e) {} }
              if (onEvent) { try { onEvent({ type: 'text_delta', delta: d.text }); } catch (e) {} }
            } else if (d.type === 'thinking_delta' && d.thinking) {
              thinking += d.thinking;
              if (blocks[idx]) blocks[idx].thinking = (blocks[idx].thinking || '') + d.thinking;
              if (onEvent) { try { onEvent({ type: 'thinking_delta', delta: d.thinking }); } catch (e) {} }
            } else if (d.type === 'signature_delta' && blocks[idx]) {
              blocks[idx].signature = (blocks[idx].signature || '') + (d.signature || '');
            } else if (d.type === 'input_json_delta' && blockStates[idx]) {
              blockStates[idx].partialJson = (blockStates[idx].partialJson || '') + (d.partial_json || '');
            } else if (d.type === 'citations_delta' && d.citation) {
              if (d.citation.url) addSource(d.citation.url, d.citation.title);
            }
            break;
          }
          case 'content_block_stop': {
            const idx = evt.index;
            const state = blockStates[idx];
            if (state && state.type === 'tool_use') {
              try { blocks[idx].input = JSON.parse(state.partialJson || '{}'); }
              catch (e) { blocks[idx].input = {}; }
              if (onEvent) { try { onEvent({ type: 'tool_call', tool: state.toolName, input: blocks[idx].input }); } catch (e) {} }
            }
            break;
          }
          case 'message_delta':
            if (evt.usage && evt.usage.output_tokens != null) usage.tokensOut = evt.usage.output_tokens;
            break;
          case 'error':
            return { ok: false, status: 500, error: evt.error || evt, text, thinking, usage, blocks: blocks.filter(Boolean), sources };
        }
      }
    }
  } catch (streamErr) {
    console.error('[anthropicClient] stream read error:', streamErr.message);
    if (text || blocks.filter(Boolean).length) {
      return { ok: true, text, thinking, usage, blocks: blocks.filter(Boolean), sources, partial: true };
    }
    return { ok: false, status: 0, error: { message: streamErr.message } };
  }

  return { ok: true, text, thinking, usage, blocks: blocks.filter(Boolean), sources };
}

// ── Public entry point ──────────────────────────────────────────────────────
async function callModel(opts) {
  const {
    model = MODELS.STANDARD,
    system, messages, maxTokens = 4096,
    thinking, tools, toolChoice, effort, temperature,
    cacheSystem = false, cacheMessages = false, cacheLastMessage = false,
    stream = false, onDelta, onEvent,
    apiKey, betaHeaders, maxAttempts = 3,
    userId, action, detail,
  } = opts;

  const headers = buildHeaders(apiKey, betaHeaders);
  let useTools = !!(tools && tools.length);

  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = buildBody({
      model, system, messages, maxTokens, thinking,
      tools: useTools ? tools : undefined, toolChoice: useTools ? toolChoice : undefined,
      effort, temperature, cacheSystem, cacheMessages, cacheLastMessage,
    });

    result = stream
      ? await callStream(headers, body, onDelta, onEvent)
      : await callOnce(headers, body);

    if (result.ok) break;

    const errType = result.error?.error?.type || result.error?.type;
    const errMsg = result.error?.error?.message || result.error?.message || '';
    console.error(`[anthropicClient] attempt ${attempt} failed: status=${result.status} type=${errType || ''} msg=${String(errMsg).slice(0, 160)}`);

    // The API rejected the tool set — drop tools and retry once (matches chat.js).
    if (useTools && !isOverload(result.status, errType) && /tool|web_search/i.test(errMsg)) {
      useTools = false;
      continue;
    }
    // Overload — exponential backoff with jitter, then retry.
    if (isOverload(result.status, errType) && attempt < maxAttempts) {
      const wait = attempt * 3000 + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    break; // non-retryable, or out of attempts
  }

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, droppedTools: !useTools && !!(tools && tools.length) };
  }

  // Normalise success shape across stream / non-stream paths.
  let text, thinkingOut, usage, blocks, toolUse, sources, stopReason, modelUsed;
  if (stream) {
    text = result.text;
    thinkingOut = result.thinking;
    usage = result.usage;
    blocks = result.blocks || [];
    sources = result.sources || [];
    toolUse = blocks.filter((b) => b.type === 'tool_use');
    stopReason = result.partial ? 'partial' : null;
    modelUsed = model;
  } else {
    const raw = result.raw;
    blocks = raw.content || [];
    text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    thinkingOut = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('');
    toolUse = blocks.filter((b) => b.type === 'tool_use');
    usage = readUsage(raw);
    sources = [];
    stopReason = raw.stop_reason || null;
    modelUsed = raw.model || model;
  }

  const cost = computeCost(modelUsed, usage);
  logUsage({ userId, action, detail, model: modelUsed, usage, cost });

  return {
    ok: true,
    text,
    thinking: thinkingOut,
    blocks,
    toolUse,
    // Convenience for forced-JSON-via-tool callers: the first tool_use input,
    // which (with tool_choice forcing the tool) is guaranteed-valid JSON — no
    // fence-stripping or brace-matching recovery needed.
    json: (toolUse && toolUse[0]) ? toolUse[0].input : null,
    sources,
    usage,
    cost,
    model: modelUsed,
    stopReason,
    refusal: stopReason === 'refusal',
    partial: !!result.partial,
  };
}

// ── Batch API (Phase 6) — 50% cheaper for non-latency-sensitive work ────────
// Submits a Message Batch, polls to completion, returns results keyed by
// custom_id. Falls back to synchronous callModel on any batch-level error so a
// failed batch never silently drops the work.
const BATCH_URL = 'https://api.anthropic.com/v1/messages/batches';

async function batchCall(requests, { apiKey, pollMs = 5000, timeoutMs = 23 * 60 * 60 * 1000, userId, action } = {}) {
  const headers = buildHeaders(apiKey);
  const body = {
    requests: requests.map((r) => ({
      custom_id: r.custom_id,
      params: buildBody({
        model: r.model || MODELS.FAST, system: r.system, messages: r.messages,
        maxTokens: r.maxTokens || 1024, thinking: r.thinking, tools: r.tools,
        toolChoice: r.toolChoice, effort: r.effort, temperature: r.temperature,
      }),
    })),
  };

  try {
    const submit = await fetch(BATCH_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!submit.ok) throw new Error('batch submit ' + submit.status);
    const batch = await submit.json();
    const id = batch.id;

    const start = Date.now();
    let status = batch;
    while (status.processing_status !== 'ended') {
      if (Date.now() - start > timeoutMs) throw new Error('batch timeout');
      await new Promise((r) => setTimeout(r, pollMs));
      const poll = await fetch(`${BATCH_URL}/${id}`, { headers });
      if (!poll.ok) throw new Error('batch poll ' + poll.status);
      status = await poll.json();
    }

    const resultsResp = await fetch(status.results_url, { headers });
    const text = await resultsResp.text();
    const out = {};
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch (e) { continue; }
      const res = row.result;
      if (res && res.type === 'succeeded' && res.message) {
        const norm = normaliseRaw(res.message, res.message.model);
        // Batch is billed at 50% — reflect that in logged cost.
        logUsage({ userId, action, model: norm.model, usage: norm.usage, cost: norm.cost * 0.5 });
        out[row.custom_id] = { ok: true, ...norm };
      } else {
        out[row.custom_id] = { ok: false, error: (res && res.error) || { message: res && res.type } };
      }
    }
    return out;
  } catch (err) {
    console.error('[anthropicClient] batch failed, falling back to sync:', err.message);
    const out = {};
    for (const r of requests) {
      out[r.custom_id] = await callModel({ ...r, apiKey, userId, action });
    }
    return out;
  }
}

// Normalise a non-streaming raw message into our result shape (shared by batch).
function normaliseRaw(raw, model) {
  const blocks = raw.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const toolUse = blocks.filter((b) => b.type === 'tool_use');
  const usage = readUsage(raw);
  const modelUsed = model || raw.model;
  const cost = computeCost(modelUsed, usage);
  return { text, blocks, toolUse, json: toolUse[0] ? toolUse[0].input : null, usage, cost, model: modelUsed, stopReason: raw.stop_reason || null };
}

// Single background request through the batch lane (convenience for callers like
// autoLearn). Polls to completion — only use off the interactive path.
async function batchOne(opts) {
  const res = await batchCall([{ custom_id: 'one', ...opts }], opts);
  return res.one;
}

module.exports = { callModel, batchCall, batchOne, MODELS, PRICING, MAX_TOKENS, computeCost, tierFor };

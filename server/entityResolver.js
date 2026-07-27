/**
 * entityResolver.js — turning the messy way people type names into one entity, and
 * turning what we know about those entities into something the chatbot can use.
 *
 * Two jobs:
 *
 *   1. RESOLVE. "Mullan", "Mullan Groundworks Ltd" and "dave mullan" have to land on one
 *      record. The pipeline is a confidence ladder — exact, then word overlap, then
 *      embedding — and it never guesses: below the match threshold it PROPOSES rather
 *      than creating, so the graph stays clean and the builder is asked once.
 *
 *   2. RENDER. Build the compact card block the chat prompt carries, so the assistant
 *      knows who is on this job without being told.
 *
 * ── Why the cards go in the per-turn tail ────────────────────────────────────────
 *
 * chat.js splits its system prompt at `stableSystemBase` (chat.js:2072), which is sent
 * with `cache_control: ephemeral`; everything appended after that point is the
 * uncached tail. The split is POSITIONAL — the tail is literally
 * `systemPrompt.slice(stableSystemBase.length)` — so anything injected before that
 * capture silently changes the cached prefix on every job and destroys prompt caching
 * with no visible symptom beyond the bill. Entity cards are per-job by definition, so
 * they must be appended after it, exactly where memoryStore.formatForPrompt already is.
 *
 * Reuses rather than reinvents: the word-overlap ratio is the same heuristic as
 * memoryStore.isDuplicate (memoryStore.js:92), and embeddings degrade to null without
 * VOYAGE_API_KEY exactly as memoryStore.retrieveRelevant does.
 */

const entityStore = require('./entityStore');

let embeddings;
try {
  embeddings = require('./embeddings');
} catch (e) {
  embeddings = null;
}

// Match thresholds. Deliberately conservative: a wrong merge is worse than a duplicate,
// because a duplicate is visible on the Memory page and a wrong merge quietly attributes
// one firm's history to another.
const WORD_OVERLAP_MATCH = 0.75;   // same ratio memoryStore.isDuplicate uses
const EMBEDDING_MATCH = 0.86;
const EMBEDDING_PROPOSE = 0.72;    // between these two, ask rather than assume

/** Word-overlap ratio between two normalised names, 0..1. */
function overlapRatio(a, b) {
  const wa = String(a || '').split(/\s+/).filter(w => w.length > 2);
  const wb = String(b || '').split(/\s+/).filter(w => w.length > 2);
  if (wa.length === 0 || wb.length === 0) return 0;
  const common = wa.filter(w => wb.includes(w)).length;
  return common / Math.max(wa.length, wb.length);
}

// Trade and sector words that describe WHAT a firm does, never WHICH firm it is. A lone
// one of these must not resolve to a company: a builder typing "groundworks" means the
// trade, and matching it to "Mullan Groundworks" would silently attribute the whole job
// to one subcontractor. (Several sibling words — builders, construction, contractors —
// are already stripped by normaliseName's suffix list, so they never reach here.)
const TRADE_WORDS = new Set([
  'groundworks', 'roofing', 'plumbing', 'electrical', 'electrics', 'joinery', 'carpentry',
  'scaffolding', 'plastering', 'rendering', 'glazing', 'flooring', 'tiling', 'painting',
  'decorating', 'landscaping', 'drainage', 'masonry', 'brickwork', 'steelwork', 'heating',
  'insulation', 'demolition', 'excavation', 'design', 'architects', 'architecture',
  'engineers', 'engineering', 'surveyors', 'interiors', 'developments', 'properties',
]);

/**
 * Is one name contained in the other? "Mullan" against "Mullan Groundworks" — every word
 * of the shorter name appears in the longer one.
 *
 * Two guards, both learned from false positives: a minimum length, because short
 * fragments match everything; and a refusal to match on a lone trade word, because
 * "groundworks" identifies a trade rather than a company.
 */
function isContainment(a, b) {
  const wa = String(a || '').split(/\s+/).filter(Boolean);
  const wb = String(b || '').split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.join('').length < 4) return false;
  if (short.length === 1 && TRADE_WORDS.has(short[0])) return false;
  return short.every(w => long.includes(w));
}

/**
 * Find the entity a name refers to.
 *
 * @returns {{ status: 'matched'|'propose'|'none', entity?, candidates?, confidence?, method? }}
 *   'matched' — confident enough to use without asking
 *   'propose' — plausible candidates, ask the builder
 *   'none'    — nothing close; a new entity, if the caller's policy allows one
 */
async function resolveName(db, { userId, name, kind = null, useEmbeddings = true }) {
  if (!userId) throw new Error('entityResolver.resolveName: userId is required');
  const normalised = entityStore.normaliseName(name);
  if (!normalised) return { status: 'none', candidates: [] };

  const pool = entityStore.listEntities(db, { userId, kind });

  // 1 ── exact match on the folded key.
  const exact = pool.find(e => e.normalised_name === normalised);
  if (exact) return { status: 'matched', entity: exact, confidence: 1, method: 'exact' };

  // 2 ── containment, then word overlap. Cheap, deterministic, and works with no API key.
  const scored = pool
    .map(e => ({
      entity: e,
      contained: isContainment(normalised, e.normalised_name),
      ratio: overlapRatio(normalised, e.normalised_name),
    }))
    .filter(s => s.contained || s.ratio > 0)
    .sort((a, b) => (b.contained - a.contained) || (b.ratio - a.ratio));

  const best = scored[0];
  if (best && (best.contained || best.ratio >= WORD_OVERLAP_MATCH)) {
    return {
      status: 'matched',
      entity: best.entity,
      confidence: best.contained ? 0.9 : best.ratio,
      method: best.contained ? 'containment' : 'word_overlap',
    };
  }

  // 3 ── embeddings, when configured. Catches what the string tiers cannot:
  // "Kerr Architects" against "Kerr Architectural Design".
  if (useEmbeddings && embeddings && embeddings.isEnabled() && pool.length > 0) {
    try {
      const vec = await embeddings.embed(name, { inputType: 'query' });
      if (vec) {
        const sims = pool
          .filter(e => e.embedding)
          .map(e => ({ entity: e, score: embeddings.cosineSimilarity(vec, embeddings.blobToVector(e.embedding)) }))
          .sort((a, b) => b.score - a.score);
        const top = sims[0];
        if (top && top.score >= EMBEDDING_MATCH) {
          return { status: 'matched', entity: top.entity, confidence: top.score, method: 'embedding' };
        }
        if (top && top.score >= EMBEDDING_PROPOSE) {
          return { status: 'propose', candidates: [top.entity], confidence: top.score, method: 'embedding' };
        }
      }
    } catch (e) {
      // Embeddings are an enhancement, never a dependency. Fall through to the string
      // tiers' answer rather than failing the turn.
      console.error('[Entities] embedding match failed:', e.message);
    }
  }

  // 4 ── plausible but not certain: hand the shortlist back and let the builder decide.
  const plausible = scored.filter(s => s.ratio >= 0.4).slice(0, 3).map(s => s.entity);
  if (plausible.length > 0) {
    return { status: 'propose', candidates: plausible, confidence: best.ratio, method: 'word_overlap' };
  }

  return { status: 'none', candidates: [] };
}

/**
 * Resolve a name and act on it according to where the name came from.
 *
 * Structured sources (a client record, a job's architect field) are real records the
 * builder already created, so they create silently. Names scraped out of free
 * conversation are proposed instead — "I spoke to Dave at the merchants" must not mint an
 * entity — and a previous decline is honoured so the same mention is not raised twice.
 */
async function resolveOrPropose(db, { userId, name, kind, source = 'chat', trusted = false }) {
  if (!userId) throw new Error('entityResolver.resolveOrPropose: userId is required');
  if (!entityStore.normaliseName(name)) return { status: 'ignored', reason: 'empty_name' };

  const found = await resolveName(db, { userId, name, kind });
  if (found.status === 'matched') return { status: 'matched', entity: found.entity, method: found.method };

  // Trusted sources are checked BEFORE declines, and the order matters. Declining a chat
  // guess means "stop guessing from conversation", not "this firm may never be recorded".
  // If the builder later types the same name into a job's architect field, that is an
  // explicit act and must create — otherwise one dismissed suggestion permanently
  // blocks a real record.
  if (trusted) {
    const { entity, created } = entityStore.upsertEntity(db, { userId, kind, displayName: name, source });
    return { status: created ? 'created' : 'matched', entity };
  }

  if (entityStore.isDeclined(db, { userId, name })) {
    return { status: 'declined', reason: 'previously_declined' };
  }

  return {
    status: 'propose',
    name,
    kind,
    candidates: found.candidates || [],
  };
}

/** The builder said no. Remember it so the same name is not raised again. */
function decline(db, { userId, name }) {
  return entityStore.recordDecline(db, { userId, name });
}

// ── prompt rendering ──────────────────────────────────────────────────────────

const KIND_LABEL = {
  customer: 'CUSTOMER', end_client: 'END CLIENT', subcontractor: 'SUBCONTRACTOR',
  supplier: 'SUPPLIER', architect: 'ARCHITECT', engineer: 'ENGINEER',
  building_control: 'BUILDING CONTROL', crew_member: 'CREW', site_manager: 'SITE MANAGER',
};

function summariseEvents(events) {
  if (!events || events.length === 0) return null;
  const counts = {};
  for (const e of events) counts[e.event_type] = (counts[e.event_type] || 0) + 1;
  const jobs = new Set(events.filter(e => e.job_id).map(e => e.job_id)).size;
  const parts = [];
  if (jobs > 0) parts.push(`${jobs} job${jobs === 1 ? '' : 's'}`);
  const last = events[0] && events[0].occurred_at;
  if (last) parts.push(`last ${String(last).slice(0, 10)}`);
  for (const [type, n] of Object.entries(counts)) {
    if (type !== 'quoted' && n > 0) parts.push(`${n} ${type.replace(/_/g, ' ')}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Build one card per entity on this job.
 *
 * Bounded on purpose: this text is sent on every turn, so an unbounded card block would
 * cost real money on a builder with a long history. Facts are capped per entity and
 * ordered by confidence, so what survives the cap is what we are most sure of.
 */
function buildCards(db, { userId, entityIds, maxFactsPerEntity = 4 }) {
  if (!userId) throw new Error('entityResolver.buildCards: userId is required');
  const cards = [];
  for (const id of (entityIds || [])) {
    const entity = entityStore.getEntity(db, { userId, id });
    if (!entity || entity.merged_into) continue;
    cards.push({
      entity,
      facts: entityStore.listFacts(db, { userId, entityId: id }).slice(0, maxFactsPerEntity),
      summary: summariseEvents(entityStore.listEvents(db, { userId, entityId: id, limit: 40 })),
    });
  }
  return cards;
}

/**
 * Render cards for the prompt. Returns '' when there is nothing to say, so the caller can
 * append unconditionally without risking an empty header.
 *
 * MUST be appended to the per-turn tail, never the cached prefix — see the module header.
 */
function formatCardsForPrompt(cards) {
  if (!cards || cards.length === 0) return '';
  const lines = [];
  for (const { entity, facts, summary } of cards) {
    const label = KIND_LABEL[entity.kind] || entity.kind.toUpperCase();
    lines.push(`[${label} · ${entity.display_name}]${summary ? '  ' + summary : ''}`);
    for (const f of facts) lines.push(`  - ${f.content}`);
  }
  return `\n=== WHO IS ON THIS JOB ===\nWhat you already know about the people involved. Use it naturally — refer to them by name and recall what happened before. Do not invent history beyond what is listed.\n\n${lines.join('\n')}\n===\n`;
}

module.exports = {
  resolveName,
  resolveOrPropose,
  decline,
  buildCards,
  formatCardsForPrompt,
  overlapRatio,
  isContainment,
  WORD_OVERLAP_MATCH,
  EMBEDDING_MATCH,
  EMBEDDING_PROPOSE,
};

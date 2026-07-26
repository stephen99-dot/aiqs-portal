# Second Brain for the AI QS Pricer — architecture & phased build plan

> Status: **proposed.** Nothing here is built yet. Written in the house style of
> `PHASED_BUILD_PLAN.md` — each phase independently shippable, admin-gated first.
>
> Origin: make the AI QS chatbot materially more accurate on rates, quantities and
> scope completeness; give it a memory of *people* as well as prices; and let it
> scope and price genuinely unusual jobs instead of guessing.
>
> Companion documents: `PORTAL_SPEC.md` (product constitution),
> `PHASED_BUILD_PLAN.md` (schedule / cost-tracking roadmap — converges with this one
> at the Xero bills pull), `server/evals/README.md` (the accuracy gate).
>
> Standing rule inherited from `PHASED_BUILD_PLAN.md` and unchanged here:
> **AI stays advisory on money. It drafts and flags; a human fixes cost and signs off.**

## Context

**The ask.** Build a "second brain" linked to the AI QS chatbot pricer so it becomes
dramatically more accurate, and so it can *scope and price jobs that are out of the
ordinary* rather than guessing. Target: the most accurate QS chatbot on the market.

**What I found.** The portal does not have a missing-brain problem. It has a
**fragmented-truth problem**. There are already six memory layers, an embeddings
stack, a correction flywheel, a deterministic verifier, a recalc gate and an eval
harness — most of it well built. But:

| Symptom | Evidence |
| --- | --- |
| **Five pricing engines that don't share rate data** | `deterministicPricer.priceLockedQuantities()` (BOQ), `estimatorRoutes.priceDraft()` (quotes), `builder3dEngine.priceModel()` (3D), `variationDraft.js` (VOs), `materialsRoutes` (materials page) |
| **Four copies of rate data that disagree** | `BASE_RATES` (336 keys, `deterministicPricer.js:33`), the `rates` table (228 seeded rows, `rateRoutes.js:82+`), two prose crib-sheets retyped inside prompts (`chat.js:645-691` and `chat.js:822-834`), and `client_rate_library`. The two prompt copies contradict **each other** and the pricer — under a header that reads *"FIXED UK RATES — use these exact figures, no deviations"*: excavation £95 vs £75, facing brick £95 vs £82, OSB sarking £18 vs £22, breather membrane £4.50 vs £8, tile battens £9.50 vs £12. The pricer holds the second value in every case. |
| **Two different financial cascades** | `deterministicPricer.js:1752` computes contingency and OH&P *both off construction total*; `lib/money.js:25` compounds contingency on `(net + ohp)`. Same job, same percentages, two different grand totals. |
| **Live material prices never reach the BOQ** | 564 scraped products in `server/materials-live.json`, refreshed twice weekly by CI, consumed **only** by `materialsRoutes.js` and `builder3dLiveRates.js`. `deterministicPricer` is blind to them. |
| **Region matching is substring-based, and it is live-buggy** | `detectLocationFactor()` (`deterministicPricer.js:654`) tests `loc.includes('sw')` for London, before the Wales test. Verified by running it: **Swansea prices as London +20%** when it should be Wales −4% — a 25-point swing on every Swansea job going out today. **Swindon** the same. Bolton falls through to UK average. |
| **The better location data is orphaned** | The `location_factors` table has 37 towns with **separate labour and materials factors** (`rateRoutes.js:366`) — read only for display. The pricer applies one blended scalar to the whole rate, so London gets +20% on facing brick *materials* as well as bricklayer labour. Materials vary maybe ±4% regionally; labour ±30%. Dimensionally wrong. |
| **Unusual jobs fall off a cliff** | `estimateFallbackRate()` (`deterministicPricer.js:431-626`) is a ~190-branch `desc.includes(...)` ladder terminating in `return 750`. That is the current answer for anything unfamiliar. |
| **Caps silently rewrite every rate** | Section caps, £/m² caps and an absolute cap each *rescale every line's rate proportionally* to force a target total (`:1639`, `:1699`, `:1740`). The output rates are then no rate anyone ever quoted, and caps can compound in one call. |
| **The accuracy gate is vacuous** | `.github/workflows/evals.yml` blocks merges on >5% drift — against **one synthetic 8-item fixture**. `npm test` (11 test files) never runs in CI at all. |

**Intended outcome.** One authoritative pricing knowledge service that every path
calls; every priced line carries provenance and confidence; unusual jobs get a
first-principles build-up with an explicit band and a hard human-review gate; and
accuracy becomes a number we can watch go up.

**Owner decisions already taken** (do not re-litigate):
- All four weak areas in scope: rates, unusual jobs, scope completeness, take-off.
- All four data sources approved: merchant scraping, **licensed BCIS/SPON'S**,
  **bulk import of own historic jobs**, **subcontractor quote/invoice capture**.
- Unusual jobs: **price them, then hard-route to human QS review** before delivery.
  This matches the standing rule in `PHASED_BUILD_PLAN.md` — *"AI stays advisory on
  money. It drafts and flags; a human fixes cost and signs off."*

---

## Target architecture

Three layers. Everything below is additive — no existing pricing path is deleted
until its replacement is proven by the eval harness.

The brain has **two halves**, and they are equally important:

- **The *what* half** — evidence about things. What a square metre of facing brick
  costs, from every source we can get.
- **The *who* half** — memory of people and organisations. Which builder, which end
  client, which subbie, which architect, which gang. The same job priced for two
  different builders, drawn by two different architects, built by two different
  gangs, is genuinely two different prices — and today the system cannot tell them
  apart.

```
┌─ LAYER 3 · CONSUMERS ───────────────────────────────────────────────┐
│ deterministicPricer  estimatorRoutes  builder3dEngine  variationDraft│
│ chat.js (via lookup_rate tool)   agent.js (via run_pricer)           │
└───────────────────────────┬──────────────────────────────────────────┘
                            │  resolveRate({ ..., entities }) / resolveScope()
┌─ LAYER 2 · RESOLVERS (deterministic, no AI) ─────────────────────────┐
│ server/rateResolver.js   — one precedence ladder, provenance on every │
│ server/scopeEngine.js    — first-principles path for unknown items    │
│ server/scopeChecklist.js — omission detection (prelims, BWIC, access) │
│ server/entityResolver.js — who is on this job, and what do we know    │
└──────────┬────────────────────────────────────────┬──────────────────┘
           │ reads                                  │ reads
┌─ LAYER 1a · EVIDENCE (the *what*) ──────┐  ┌─ LAYER 1b · ENTITIES (the *who*) ─────┐
│ price_evidence · rate_recipes           │  │ entities · entity_facts               │
│ labour_gang_rates · cost_indices        │  │ entity_events · entity_links          │
│ + existing memory_rates / _quantities   │  │ entity_priors  ← changes the price    │
│   / _projects / _patterns               │  │ + existing user_memories, playbooks,  │
└─────────────────────────────────────────┘  │   conversation_summaries              │
        ▲          ▲          ▲       ▲      └───────────────────────────────────────┘
   base library  merchant  BCIS/    own              ▲         ▲        ▲        ▲
   (336 keys)     live     SPON'S  history      time entries  Xero   quotes/  chat +
                 (564)   (licensed) +subbie      (workers)  contacts   VOs    emails
```

### Layer 1a — `price_evidence`: one table, every observation

The brain is not "more memory tables". It is **one append-only evidence log** that
every source writes into and the resolver reads from. Rates become *derived*, not
stored.

```sql
CREATE TABLE price_evidence (
  id TEXT PRIMARY KEY,
  item_key TEXT,                 -- canonical key, nullable for unmapped evidence
  canonical_desc TEXT NOT NULL,  -- normalised description (embedding source)
  unit TEXT NOT NULL,
  value REAL NOT NULL,
  value_type TEXT NOT NULL,      -- composite | labour | material | plant | subbie | paid
  source_type TEXT NOT NULL,     -- base_library | bcis | spons | merchant_live
                                 -- | own_history | subbie_quote | invoice_paid
                                 -- | client_library | model_estimate
  source_ref TEXT,               -- job id, invoice id, product url, rate-book ref
  region TEXT, project_type TEXT, spec_level TEXT,
  observed_at TEXT NOT NULL,     -- for time-indexing to today via cost_indices
  sample_weight REAL DEFAULT 1,
  redistributable INTEGER DEFAULT 1,  -- 0 for licensed rate-book rows
  raw_json TEXT,
  embedding BLOB, embedding_model TEXT
);
```

Supporting tables:
- `cost_indices(index_name, region, period, value)` — ONS/DBT published indices.
  Lets a 2023 invoice become a 2026 rate instead of quiet under-pricing.
- `labour_gang_rates(gang, region, hourly_rate, effective_from)` — e.g.
  `bricklayer_2_1`, `groundworks_gang_3`, `carpenter_1`.
- `rate_recipes(item_key, labour_hours_per_unit, gang, materials_json, plant_json,
  waste_pct)` — the resource build-up (Tier B below).
- `material_baskets(item_key, material_id, qty_per_unit, unit)` — the missing link
  that lets a merchant price move a rate: `brick_outer_leaf` → 60 bricks/m²,
  0.045 m³ mortar/m², 2.5 wall ties/m².

#### Source weights and the promotion rule

Not all evidence is equal, and the weighting must be explicit and tunable in one place:

| `source_type` | weight | why |
| --- | --- | --- |
| `final_account` | 1.00 | what the job actually cost. Gold. |
| `invoice_paid` | 0.95 | actually paid |
| `subbie_quote` (accepted) | 0.85 | committed price |
| `qs_correction` | 0.85 | human expert, in-app |
| `bcis` / `spons` | 0.90 | **`redistributable = 0`** — calibration only |
| `merchant_live` | 0.80 | materials component only, never a whole rate |
| `own_history` (tender won) | 0.75 | market-validated |
| `own_history` (tender) | 0.55 | your view, unvalidated |
| `base_library` | 0.40 | the current 336 |
| `model_estimate` | 0.25 | **never promotes on its own** |

**Promotion is deterministic, no AI** (`brain/promote.js`): a
`(key, region, project_type)` goes `emerging → authoritative` when effective weight
≥ 3.0, coefficient of variation ≤ 0.35, at least one observation in the last 12
months, and the result sits within 0.5×–2.0× the anchor. Outside that, it routes to
the **existing** `flywheel_suggestions` approval queue rather than auto-applying —
reusing a UI pattern that is already built. Recency decays on a 24-month half-life.

#### Two-tier rate model — do *not* rewrite 336 rates as build-ups

The obvious move is to replace every composite rate with a first-principles build-up.
That is the wrong move: it is thousands of output constants and gang compositions you
don't have, every one you get wrong silently changes a live price, and it throws away
the calibration in 336 rates that have been winning work.

Keep the composite as the **anchor** and use the build-up as the **transmission
mechanism**:

```
Tier A — Indexed composite   (default for all 336 keys, day one)
   rate = anchor
        × (1 + Σ_c w_c × (index_c(now)/index_c(anchor_date) − 1))
        × region_labour_factor^w_labour × region_material_factor^w_material

Tier B — Full build-up       (opt-in per key, once QS-verified)
   rate = Σ(resource_qty × resource_rate) × (1 + waste) × (1 + oh)
```

Tier A needs only **weights**, not absolute resource quantities — and you already
have a defensible default weight vector: every `BASE_RATES` entry carries
`labour`/`materials` fractions, and `defaultSplitForSection()`
(`deterministicPricer.js:10`) gives a per-trade split for anything missing. So every
rate can be index-linked on day one at 2-component granularity, then refined.

It is also error-tolerant: if the brick weight for `brick_outer_leaf` is 0.30 when it
should be 0.35, an 8% brick rise moves the rate 2.4% instead of 2.8%. A wrong full
build-up is wrong by the whole amount.

Migration: rank keys by **cumulative value contribution** across historic priced work
— expect ~60 keys to carry ~85% of value. Those get hand-authored, QS-verified Tier B
build-ups. The tail gets LLM-drafted build-ups used **only to refine Tier A weights**,
never to set a rate. A key is promoted to Tier B only when its recomputed build-up
lands within ±15% of the anchor or a human writes down why it doesn't.

**Reuse, don't rebuild.** `server/embeddings.js` (Voyage + BLOB pack/unpack +
cosine) and the FTS5 fallback pattern in `memoryStore.js:112` already do exactly
what the evidence store needs for semantic lookup. `memoryEngine.recordRate()`'s
Welford online mean/stddev/confidence maths (`memoryEngine.js:210-226`) is the right
aggregation — move it to operate over `price_evidence` rather than its own table.

**Stay on SQLite.** Do not move to Postgres/pgvector yet. Evidence volume for a
single-tenant owner portal is thousands of rows, not millions; brute-force cosine
over a few thousand Float32 BLOBs is sub-10ms. Revisit only when `price_evidence`
passes ~250k rows or the portal goes genuinely multi-tenant. Migrating the DB is a
separate project and would stall every phase below.

### Layer 1b — entity memory: remembering people, not just prices

Today the portal holds person-shaped data in four disconnected places and learns from
none of it:

| What exists | Where | What's wrong with it |
| --- | --- | --- |
| The builder's own profile | `memory_client_profile` (`memoryEngine.js:112`) | Keyed on the *portal user*. Knows nothing about anyone else on the job. |
| The builder's end clients | `estimator_clients` (`database.js:371`) | Name, email, phone, notes. Inert — nothing is ever derived from it. |
| Named site workers + their hours | `schedule_time_entries.worker` (`database.js:838`, written at `scheduleRoutes.js:906`) | **Free text**, capped at 120 chars. Logged with hours, hourly rate and % complete — a per-person productivity dataset that is written on every site update and never read. |
| Merchants | `suppliers` (`database.js:645`) | Global, not per-builder. No notion of *this* builder's account or discount. |

And there is **no entity whatsoever** for subcontractors, architects, engineers or
building control — despite whose drawings you're pricing being one of the strongest
predictors of how much scope you'll have to add later.

#### Schema

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,          -- ALWAYS scoped to one builder. Never shared.
  kind TEXT NOT NULL,             -- customer | end_client | subcontractor | supplier
                                  -- | architect | engineer | building_control
                                  -- | crew_member | site_manager
  display_name TEXT NOT NULL,
  normalised_name TEXT NOT NULL,  -- for matching
  external_refs TEXT,             -- {xero_contact_id, email, phone, companies_house}
  embedding BLOB, embedding_model TEXT,
  merged_into TEXT,               -- soft-merge target when duplicates are resolved
  created_at TEXT, updated_at TEXT
);

CREATE TABLE entity_facts (            -- durable, human-readable, editable
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL,
  category TEXT,                       -- preference | commercial | quality | logistics
  content TEXT NOT NULL,               -- "always wants underfloor heating priced as an option"
  confidence REAL, source TEXT, source_ref TEXT,
  valid_from TEXT, valid_to TEXT,      -- facts expire; people change
  embedding BLOB
);

CREATE TABLE entity_events (           -- episodic memory: what happened, when
  id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, job_id TEXT,
  event_type TEXT NOT NULL,            -- quoted | won | lost | invoiced | paid_late
                                       -- | variation_raised | correction_applied
                                       -- | drawings_supplied | task_completed | dispute
  payload TEXT, occurred_at TEXT NOT NULL
);

CREATE TABLE entity_links (            -- the graph
  from_entity_id TEXT, to_entity_id TEXT,
  relation TEXT,                       -- works_for | subcontracts_to | supplies
                                       -- | drew_plans_for | referred_by
  strength REAL, first_seen TEXT, last_seen TEXT
);

CREATE TABLE entity_priors (           -- ← the bit that actually moves a price
  entity_id TEXT, prior_type TEXT, value REAL,
  confidence REAL, sample_count INTEGER, updated_at TEXT
);
```

#### The priors — where "remembering someone" becomes money

`entity_priors` is derived on a schedule from data the portal is **already writing**.
Each one is a labelled, auditable adjustment, never a silent fudge:

| Prior | Derived from | Effect on a price |
| --- | --- | --- |
| `labour_productivity_factor` | `schedule_time_entries` — planned vs actual hours per named worker/gang | Labour hours in a resource build-up scale by the gang's real record |
| `drawing_completeness_score` | `correction_diffs` — items the QS *added* after take-off, grouped by who drew the plans | Raises contingency and pre-loads the omissions checklist for that practice |
| `subbie_rate_delta` | subbie quotes vs your estimate for that trade | Prices that trade at what that subbie actually charges |
| `merchant_discount_pct` | invoices/bills vs list price, per merchant per builder | Materials in a build-up use *your* buying price, not shelf price |
| `variation_propensity` | `variations` / `estimator_variations` £ as % of contract, per end client | Flags likely VO exposure at quote time |
| `payment_behaviour` | days-to-pay from `invoices` | Feeds prelims/finance cost and the existing cash-flow projection |
| `negotiation_delta` | quoted vs accepted value | Tells you what this client will actually sign |

So the resolver's output gains an `adjustments[]` array alongside `provenance[]`:

> *"Labour +12% — Mullan Groundworks has run 12% over planned hours across 7 tasks."*
> *"Contingency +3% — drawings from Kerr Architects have needed 6 added items on average across 4 jobs."*
> *"Blockwork £39/m² not £42 — your Selco account averages 8% under list."*

Every one is legible, attributable and can be switched off per line. That is the
difference between a brain and a black box.

#### Entity resolution

Names arrive messy and inconsistent ("Mullan", "Mullan Groundworks Ltd", "dave
mullan"). The pipeline: normalise → exact match on `normalised_name` → embedding
match → **ask the user once**, then remember the answer. Reuse the word-overlap
heuristic in `memoryStore.isDuplicate()` (`memoryStore.js:92`) plus
`embeddings.cosineSimilarity`. Seed the graph cleanly from **Xero contacts** —
`xeroClient.js` already requests the `accounting.contacts` scope, so the builder's
real supplier and subcontractor list is one API call away. Backfill
`schedule_time_entries.worker` free text into `crew_member` entities with a one-time
confirm screen.

#### Conversational recall — "remembers individuals"

This is what makes the chatbot *feel* like it has a brain. When a job or a chat
mentions entities, `entityResolver` builds a compact card per entity and injects it
into the **per-turn tail** of the prompt (never the cached prefix — see the caching
risk below):

```
[END CLIENT · Mrs Hughes, St Andrews Road]  3 jobs · last Mar 2026 · avg £84k
  - Always wants the kitchen priced as a PC sum, not a fixed line.
  - Raised 4 variations on the last job (+£11.2k, 14% of contract).
  - Pays within 7 days.
[ARCHITECT · Kerr Architects]  4 jobs
  - Drainage omitted from the drawings on 3 of 4 sets.
```

The existing `user_memories` / `conversation_summaries` retrieval stays as-is for
free-form recall; entity cards are the structured complement, retrieved by *who is on
this job* rather than by semantic similarity to the last message.

#### Governance — this part is not optional

`entity_facts` and `entity_priors` are personal data about named individuals, and
some of it is a performance judgement about a named subcontractor. Non-negotiables:

- **Hard tenant scope.** Every entity row carries `user_id` and is never read across
  builders. Note that `memoryEngine.learnFromConfirmedProject()` currently writes rate
  observations at both `scope:'client'` *and* `scope:'global'` (`memoryEngine.js:567`)
  — anonymised rates crossing tenants is defensible; entity data crossing tenants is
  not. Enforce this in the query layer, not by convention.
- **Visible and correctable.** Extend `src/pages/AIMemoryPage.js` — already the
  view/edit/delete surface for `user_memories` — with an Entities tab. If the system
  believes a gang is 12% slow, the builder must be able to see that, disagree, and
  overrule it.
- **Facts expire.** `valid_from` / `valid_to` exist so a two-year-old judgement stops
  silently pricing today's job.
- **Retention + export/delete** per entity, for UK GDPR subject requests.

### Layer 2 — `rateResolver.js`: one ladder, provenance on every line

```js
resolveRate({ itemKey, description, unit, region, projectType, specLevel,
              userId, asOfDate,
              entities })   // { customer, endClient, architect, subcontractor, suppliers[] }
// →
{ rate, currency,
  basis: 'composite' | 'buildup' | 'analogue' | 'first_principles',
  buildup: { labour: { hours, gang, gangRate, cost },
             materials: [{ product, qty, unitPrice, supplier, capturedAt }],
             plant, wastePct },
  confidence: 0..1,
  band: { low, high },                 // ± range, widens as confidence drops
  provenance: [{ source_type, source_ref, value, weight, observed_at }],
  adjustments: [{ entity_id, prior_type, delta_pct, reason, sample_count }],
  sampleCount, stalenessDays,
  needsReview: bool }
```

`provenance` answers *where did this number come from*; `adjustments` answers *why is
it different for this job*. Both are rendered on the BOQ line and both are
individually dismissable by the QS — and a dismissal is itself a training signal.

Precedence ladder — explicit, documented, unit-tested:

| # | Source | Condition |
| --- | --- | --- |
| 1 | Line `override_rate` | Always wins |
| 2 | Client verified rate | `times_confirmed >= 2` and within sanity ratio |
| 3 | **Own history** median for key+region+project_type | `n >= 3`, time-indexed to today |
| 4 | **Licensed rate book** (BCIS/SPON'S) for key+region | Licensed, `redistributable = 0` |
| 5 | **Resource build-up** from `rate_recipes` + live merchant prices + gang rate | Recipe exists |
| 6 | Base library composite × location factor | The current default |
| 7 | **Nearest-neighbour analogue** via embedding over `canonical_desc` | cosine > 0.80 |
| 8 | **First-principles scoping engine** (`scopeEngine.js`) | Always `needsReview: true` |

Rungs 3, 4, 5, 7 and 8 are all new. Rung 8 replaces `estimateFallbackRate()`'s
keyword ladder — keep the old function as the last-ditch safety net behind rung 8,
but every hit on it should be counted as a coverage failure.

**The provenance contract is the headline feature.** Today `rate_source` already
exists on every priced line (`deterministicPricer.js:1579`) but only as a string.
Widening it to the full provenance object means the BOQ can show, per line, *"£82/m²
— your own rate, median of 6 jobs in the North West, last seen March 2026, ±8%"*.
That is what makes it defensible in front of a client and what turns the QS's
correction into a labelled training signal.

### Layer 3 — how each consumer changes

- **`deterministicPricer.priceLockedQuantities`** — replace the inline ladder at
  `:1457-1513` with a `resolveRate()` call. Keep every guardrail (ceilings, section
  caps, £/m² caps) but change cap behaviour: **flag rather than silently rescale**.
  A cap breach should raise `needsReview` and a warning, not rewrite 80 line items
  into rates nobody quoted. Rescaling is currently the largest source of
  unexplainable numbers in the output.
- **`estimatorRoutes.priceDraft`** — drop the `LIKE '%word%'` fuzzy scoring at
  `:131-172` in favour of `resolveRate()` with embedding-based matching. Fixes the
  quote/BOQ divergence for free.
- **`builder3dEngine.priceModel`, `variationDraft`** — same swap.
- **`chat.js`** — this is the "10x the chatbot" change. Delete the three prose rate
  tables from the prompt (`chat.js:443-507`, `645-691`, `822-834`) and give the model
  a **`lookup_rate` tool** instead, plus a compact job-relevant slice retrieved from
  the evidence store. Three wins at once: the prompt stops disagreeing with the
  pricer, the cached prefix shrinks by thousands of tokens, and the model can look
  up any of 336+ keys instead of the ~70 that fit in the crib-sheet.
- **`lib/money.js` vs the pricer cascade** — pick one. Recommend the pricer's
  (contingency and OH&P both off construction total, matching how UK QSs present a
  BOQ) and make `lib/money.js` delegate to it. `playbooks.ohp_treatment`
  (`buried|visible|stripped`) is the existing reconciliation point.

---

## The unusual-job scoping engine

New: `server/scopeEngine.js`. Triggered when the resolver reaches rung 8, or when
the take-off contains an item with no key and no analogue above threshold.

1. **Retrieve analogues** — embed the item/job description, pull the k nearest
   `price_evidence` rows plus any relevant `user_memories` and past
   `conversation_summaries`. Reuse `memoryStore.retrieveRelevant()`'s pattern.
2. **Method statement** — one forced-tool call (Opus, adaptive thinking) producing:
   sequence of operations, crew composition and size, plant, duration, materials
   with quantities, access/temp-works constraints, risks, and what is *excluded*.
   This is the step a human QS does in their head and the system currently skips.

   **The governing constraint: the model emits resources, never money.** It outputs
   hours, gang codes, plant days and material quantities — with a stated basis for
   each ("2-man gang, 8m²/day → 1.0 hr/m²"). Deterministic code multiplies those by
   rates. The model's engineering judgement about *what the work needs* is the part
   worth having; its arithmetic is never trusted. This is what makes an unusual price
   auditable instead of hallucinated, and it keeps `deterministicPricer` pure.
3. **Price the method, not the description** — convert the method statement into a
   resource build-up and price it through the resolver's rung-5 machinery: real
   gang rates × real hours + real merchant prices × real quantities + plant.
4. **Emit a band, not a point** — `{ price, band: ±%, assumptions[], exclusions[],
   confidence, needsReview: true }`. Band width derives from how much of the
   build-up came from evidence vs. model judgement.
5. **Hard review gate** — the job cannot advance to `DELIVERED` (per the lifecycle in
   `PORTAL_SPEC.md`) while any line has `needsReview`. The hook already exists:
   `agenticTakeoff.js:178` sets `needs_admin_review` when verification fails, and the
   delivered transition is a single statement at `deliverableRoutes.js:265` — gate
   there. Surface as a blocking banner in the admin review page, listing exactly
   which lines are unreviewed and why.
6. **Learn on sign-off** — when the QS corrects and approves, write the corrected
   build-up back as `price_evidence` with `source_type = 'own_history'` and create a
   `rate_recipes` row if one didn't exist. The same odd job is a known job next time.
   `flywheel.logCorrections()` already captures the diff; this closes the loop from
   "logged" to "learned".

Reuse: `agenticTakeoff.js`'s plan → measure → reconcile → verify → correct loop is
exactly the right shape and its `verifyTakeoff` feedback mechanism should wrap the
scoping engine too.

---

## Scope completeness

New: `server/scopeChecklist.js`. Three signals combined.

- **Curated NRM2 rules with derivable quantities** — a data file (not code), ~60
  rules of the shape *trigger → required key → quantity formula*, so the checker
  proposes a priced line rather than a nag:

  | Code | Trigger | Requires | Quantity |
  | --- | --- | --- | --- |
  | `MUC-001` | any excavation m³ > 0 | `muck_away_grab` | `Σ excav_m³ × 1.25` (bulking) |
  | `SCF-001` | roof/external wall work AND (storeys ≥ 2 OR eaves > 3.5m) | `scaffold_independent` | `perimeter × (eaves + 1.5)` m² |
  | `BWK-001` | any M&E first fix present | `builders_work_in_connection` | `3.5% × Σ(M&E value)` |
  | `TMP-001` | opening formed in a loadbearing wall | `temporary_propping` | per opening, by span |
  | `PRO-001` | works to an occupied property | `protection_dust_screens` | floor area |

  The 20 seeded `PR-` prelim rates in `rateRoutes.js` and
  `playbooks.standing_prelims` / `prelims_style` are the starting content.

- **Prelims driven by the programme, not a percentage.** This is a real
  differentiator and it reuses machinery you already have and already test:
  `scheduleEngine.js` computes task durations and `scheduleCashflow.js` already
  spreads value across working days. So `prelims = Σ(weekly prelim resource ×
  programme_weeks)` instead of a flat %. A flat prelims percentage is the most common
  source of a loss-making number on small works.
- **Learned co-occurrence** — `memoryEngine.getSuggestedItems()` already computes
  "if X then usually Y" from `memory_patterns`, and `chat.js:3075` already calls it —
  but only to append advisory strings to `parsed.missing_info`. Nothing acts on them.
  Promote the signal from advisory text to a verifier finding: *"in 14 of 16
  comparable jobs a steel lintel appeared alongside these bifold doors — missing here."*
- **Entity-conditioned priors** — the checklist is not the same for every job. Condition
  it on who drew the plans: *"drainage was missing from 3 of the last 4 sets from this
  practice — check before pricing."* This comes free from `drawing_completeness_score`
  in `entity_priors`, and it is the single clearest example of why the *who* half of
  the brain matters: the omission pattern is a property of the person, not the project.

Output feeds `verifyTakeoff()` as new failure codes (`MISSING_EXPECTED_ELEMENT`,
severity `warn` when learned, `error` when a curated must-have for that project type
is absent). Because `agenticTakeoff` already loops on verify failures for up to two
correction rounds, omissions get fixed automatically with no new orchestration.

---

## Ingestion pipelines

### (a) Merchant prices — the fix is not more scrapers
`materialsScrapers.js` covers Screwfix, Toolstation, Wickes, B&Q, Selco, and
`builder3dLiveRates.js` documents exactly why it refuses to push those prices further:

> *"We deliberately do NOT substitute retail pack prices into area/volume trade rates
> … that would make the estimate less accurate."*

That reasoning is **correct given a composite rate model**, and it stops being correct
the moment a rate knows what fraction of itself is bricks. So the unlock is
`material_baskets` (above) plus Tier A weights — not another scraper.

Two things must land alongside it or scraped prices will make the BOQ *worse*:
- **Trade vs retail calibration.** Screwfix/B&Q shelf prices run 20–40% above a trade
  account. `suppliers.account_type` already exists (`database.js:649`); add a learned
  `trade_discount` per supplier, calibrated against real Xero bills from (d). Never
  feed retail prices in raw.
- **Sane aggregation.** Match on `(material_id, supplier_id, date)` and take the
  lowest in-stock *trade* price per material per week as the basket input — not the
  mean across eight merchants, which is a number nobody pays.

Then extend coverage to the trade merchants that matter for a builder's real cost
base: Travis Perkins, Jewson, MKM, Buildbase. Respect robots.txt and the existing
2.5s per-host throttle. Trade-account prices behind a login are not scrapeable —
realistically that's a monthly price file from the account manager, which is fine.
Do the boring thing.

### (b) Licensed rate books — BCIS / SPON'S. **Read this before spending.**

You approved buying these, and the plan still includes them — but narrower and later
than you probably expect, for one reason: **BCIS and SPON'S are licensed per named
seat, and embedding their rate data in a product you resell is very likely outside
that licence.** Baking a bought rate book into a multi-tenant estimating SaaS is the
kind of thing rights-holders do enforce. I have not read your licence terms, so treat
this as a flag, not a finding — but get it confirmed **in writing** before money moves.

The good news is that the highest-value thing you wanted from them is available free:

- **ONS Construction Output Price Indices** and **DBT monthly Building Materials
  Price Indices** are published, free, monthly, and are exactly the right input for
  Tier A inflation indexing. Lead with these. They do the time-correction job with no
  licence risk at all.
- Buy BCIS/SPON'S for what they're genuinely irreplaceable at: **an independent
  calibration check on your own rates**, and proper **regional split labour/materials
  factors** (replacing the hardcoded blended `LOCATION_FACTORS` and the orphaned
  37-row `location_factors` table).

Enforce the constraint in architecture, not in policy:
- `licensed_sources.redistributable = 0` for BCIS/SPON'S, set unconditionally at ingest.
- The resolver filters `WHERE redistributable = 1` for any non-admin context.
- A rate-book row may set an internal calibration target and raise an
  `OUT_OF_BAND_VS_RATEBOOK` flag. It may **never** appear in the `provenance` of a
  customer-facing deliverable.
- A unit test asserts that no non-redistributable evidence can reach a non-admin
  priced line. Make it a test, not a habit.

### (c) Own historic jobs — the biggest accuracy lever
An importer for the owner's back catalogue of BOQs, quotes and **final accounts**.
Final accounts matter most: they are what the job actually cost, and they are the only
thing that lets us measure MAPE at all.
- Accept XLSX/CSV (via the existing `xlsx`/`exceljs` deps) and PDF (via `pdf-parse`).
- LLM maps free-text descriptions → canonical `item_key` + unit, in batch through
  `anthropicClient.batchOne()` (already wired, 50% cheaper, `USE_BATCH_API=1`).
- Human confirms the mapping in a review screen — reuse the existing rate-review UI
  pattern from `MyRatesPage.js` rather than inventing one.
- Each accepted line → `price_evidence` (`own_history`), time-indexed on import.
- Where a quote and its final account both exist, store both and the delta. That
  delta *is* the accuracy training set.

### (d) Subcontractor quotes and invoices — what you actually pay
- **Xero bills pull** (read scope). `xeroClient.js` already has OAuth2, rotating
  refresh tokens and per-builder token storage; only push is implemented. Pull is
  already Phase 5 of `PHASED_BUILD_PLAN.md`, so this serves two roadmaps at once.
- **Email ingest** — a dedicated inbox for subbie quotes; parse attachments through
  the same importer as (c).
- **Upload** — drop a subbie quote on a job, parse, offer to learn from it.
- All land as `price_evidence` with `value_type='paid'|'subbie'`. Paid invoices carry
  the highest `sample_weight` in the resolver: it is the only source that is a fact
  rather than an opinion.

---

## Connectors — worth it vs. noise

**Worth building.** Xero bills pull (real paid prices, OAuth already there) · BCIS
API for indices (tiny payload, huge leverage) · merchant trade APIs or punchout where
obtainable (Travis Perkins, Jewson — real trade prices, not shelf prices) · a subbie-
quote email inbox · postcodes.io/OS for accurate region + urban/rural (partly present
via `planningData.js`) · **PlanIt**, already integrated — it can tell you a site is
listed or in a conservation area, which should automatically drive the heritage
uplift instead of waiting for someone to type "heritage".

**Noise.** Weather APIs, generic CRM connectors, WhatsApp integration (already on the
`CANDIDATES_FOR_REMOVAL.md` hitlist), QuickBooks API (CSV export already covers it),
and any "AI marketplace" connector. None of them move a rate.

---

## Proving "10x" — measurement

You cannot claim most-accurate-on-the-market without a number. Metrics, in order of
how much they matter:

| Metric | Definition | Available when |
| --- | --- | --- |
| **MAPE vs final account** | \|predicted − actual\| / actual, per job and per element | After (c) backfills final accounts |
| **Rate-source coverage** | % of construction value priced from evidence (rungs 1-5) vs. fallback (rungs 6-8) | **Immediately** — `rate_source` is already on every line |
| **Correction magnitude** | Median \|Δ\| the QS applies before delivery | **Immediately** — `correction_diffs` is already logged |
| **Item recall / precision** | vs. the QS's corrected BOQ | Immediately, from the same diffs |
| **£/m² band hit rate** | % of jobs landing inside `PER_M2_BANDS` first time | Immediately |
| **Review-gate rate** | % of jobs blocked by `needsReview`, and why | After the scoping engine |
| **Prior-adjustment accuracy** | For each entity prior: did applying it move the number *toward* the final account? A prior that doesn't earn its keep gets retired. | After Phase 5 |

Two of the top metrics are computable **today** from data already being written and
never read. That is the cheapest possible start.

Harness work: expand `server/evals/fixtures` from its one synthetic job to 20+ golden
jobs. The machinery is already there and unexercised — `flywheel.promoteToFixture()`
is exposed at `routes.js:1621` for one-click promotion of a delivered job, so this is
an operational habit to start, not code to write. Add `npm test` to CI (11 test files
exist and CI never runs them). Add an admin accuracy dashboard reading the metrics
above.

---

## Phased build plan

House style follows `PHASED_BUILD_PLAN.md`: each phase independently shippable,
effort S/M/L relative, admin-gated first.

### Phase 0 — Reconcile the truth *(no new capability, everything after depends on it)*
- Delete the three prose rate tables in `chat.js` (`:443-507`, `:645-691`, `:822-834`);
  generate that block from `BASE_RATES` at boot so prompt and pricer cannot diverge.
- Unify the two financial cascades (`deterministicPricer.js:1752` vs `lib/money.js:25`).
- Emit `rate_source_coverage` in every `priceLockedQuantities` result.
- **Fix the region substring bug** — Swansea and Swindon currently price as London
  +20%. A one-line ordering/word-boundary fix, worth shipping on its own.
- Run `npm test` in CI; add `.env.example` (54 env vars, none documented).
- **Effort:** S · **Risk:** Low · **Deps:** none
- **Files:** `chat.js`, `deterministicPricer.js`, `lib/money.js`, `.github/workflows/`

### Phase 1 — Evidence store + resolver in shadow mode
- Create `price_evidence`, `cost_indices`, `labour_gang_rates`, `rate_recipes`.
- Backfill from `BASE_RATES`, the `rates` table, `client_rate_library`, `memory_rates`.
- Build `server/rateResolver.js` with rungs 1, 2, 6 (parity with today) + provenance.
- Run it **shadow**: compute alongside the existing ladder, log deltas, ship nothing.
- **Effort:** M–L · **Risk:** Low (shadow) · **Deps:** Phase 0
- **Files:** new `rateResolver.js`, `database.js`, `deterministicPricer.js`

### Phase 2 — Entity graph + conversational recall *(the "remembers individuals" win)*
- `entities` / `entity_facts` / `entity_events` / `entity_links` + `entityResolver.js`.
- Seed from **Xero contacts** (`accounting.contacts` scope already requested in
  `xeroClient.js`); backfill `estimator_clients`; one-time confirm screen to promote
  free-text `schedule_time_entries.worker` strings into `crew_member` entities.
- Entity cards injected into the chat's per-turn tail. Entities tab on
  `src/pages/AIMemoryPage.js` — view, edit, merge, delete.
- No priors yet. This phase ships the *feel* of a brain: it knows who your client is,
  who drew the plans, who's on site, and what happened last time.
- **Effort:** M · **Risk:** Low–Med (entity resolution is fiddly) · **Deps:** Phase 1
- **Files:** new `entityResolver.js`, `database.js`, `chat.js`, `xeroClient.js`, `AIMemoryPage.js`

### Phase 3 — Chatbot retrieval refactor
- `lookup_rate` tool + job-relevant retrieved slice replaces the prompt crib-sheets.
- Shrinks the cached prefix, removes prompt/pricer drift, unlocks all 336+ keys.
- Lands alongside Phase 2's entity cards, so the chatbot improvement is felt at once.
- **Effort:** M · **Risk:** Med (touches the hot path; gate on evals) · **Deps:** Phases 1, 2

### Phase 4 — Historic job import, entity-attributed
- Importer for XLSX/CSV/PDF BOQs, quotes and **final accounts**; batch LLM
  key-mapping via `anthropicClient.batchOne()`; human confirm screen.
- Each imported job is attributed to its entities (client, architect, subbies) as it
  lands — which is what makes Phase 5 possible at all.
- Turn on resolver rung 3. First real accuracy gain, and the only way to get a MAPE.
- **Effort:** L · **Risk:** Med (messy inputs) · **Deps:** Phases 1, 2

### Phase 5 — Entity priors → priced adjustments *(where memory becomes money)*
- Derive `entity_priors` on a schedule: labour productivity from
  `schedule_time_entries`, drawing completeness from `correction_diffs`, variation
  propensity from `variations`, payment behaviour from `invoices`, merchant discount
  from bills.
- Wire into `resolveRate()` as the `adjustments[]` array — labelled, attributable,
  individually dismissable. Ship behind a per-builder toggle, off by default until
  the deltas have been eyeballed on real jobs.
- **Effort:** M · **Risk:** Med (a wrong prior silently skews every job — hence the
  toggle and the visible labels) · **Deps:** Phases 2, 4

### Phase 6 — Scope completeness engine
- `scopeChecklist.js`: curated NRM2 element library + promote
  `memoryEngine.getSuggestedItems()` from advisory text to a verifier finding +
  entity-conditioned omission priors. New `verifyTakeoff` failure codes.
- **Effort:** M · **Risk:** Low · **Deps:** Phases 0, 5

### Phase 7 — Unusual-job scoping engine + review gate
- `scopeEngine.js` (analogue retrieval → method statement → build-up → band).
- Blocking `needsReview` gate before `DELIVERED`; learn-on-sign-off write-back.
- **Effort:** M–L · **Risk:** Med · **Deps:** Phases 1, 4, 6

### Phase 8 — Tier A: live materials reach the pricer + split regional model
- `material_baskets` for the top ~80 material-heavy keys; component weight vectors
  seeded from the existing `labour`/`materials` fractions.
- `cost_indices` from **free ONS/DBT published indices** — no licence needed.
- Trade-vs-retail calibration per supplier before any merchant feeds pricing.
- Replace the blended location scalar with **separate labour and materials factors**
  (`location_factors` already has both columns) and a proper postcode lookup.
- Ships behind `RATE_MODEL=indexed` with a shadow log. Rates start moving here.
- **Effort:** M · **Risk:** Med (needs the shadow period) · **Deps:** Phases 1, 5

### Phase 9 — Subbie quote & invoice capture
- Xero **bills pull** (also completes roadmap Phase 5), email ingest, per-job upload.
- Highest-weight evidence: what you actually paid — and it attributes straight onto
  the subbie and supplier entities from Phase 2, sharpening their priors. Also
  provides the trade-discount calibration Phase 8 depends on going forward.
- **Effort:** M–L · **Risk:** Med (external API) · **Deps:** Phases 2, 4

### Phase 10 — Tier B: resource build-ups for the top-value keys
- Value-rank the keys; hand-author QS-verified build-ups for the ~60 carrying ~85%
  of cumulative value. LLM-draft the tail as **weights only**, `verified = 0`.
- `labour_gang_rates`, `plant_rates`. Validation gate: recomputed build-up within
  ±15% of the anchor, or a human writes down why not. Per-key promotion.
- The build-up shown on the deliverable is the visible "most accurate on the market"
  artefact — a client can see the hours and the materials behind the number.
- **Effort:** L · **Risk:** Med–High · **Deps:** Phases 8, 9

### Phase 11 — Licensed rate books, calibration only
Deliberately last of the data sources: licence-constrained, and a cross-check rather
than a foundation.
- **Written licence confirmation before any spend.**
- `licensed_sources`, `redistributable = 0` at ingest, admin-only import.
- `OUT_OF_BAND_VS_RATEBOOK` flags on your own rates; a calibration report.
- Test asserting no non-redistributable evidence can reach a non-admin priced line.
- **Effort:** M · **Risk:** **High — legal, not technical** · **Deps:** Phase 1

### Phase 12 — Accuracy dashboard + eval expansion
- 20+ golden fixtures via the existing `flywheel.promoteToFixture()` route.
- Admin dashboard: MAPE, coverage, correction magnitude, band hit rate, review rate,
  and **prior-adjustment accuracy** (did the entity adjustments move the number the
  right way?).
- Baseline-relative CI gating (fail on regression vs last green, not just absolute
  ±5%) plus a non-failing shadow-model report job.
- **Effort:** M · **Risk:** Low · **Deps:** Phases 0, 4

```
Phase 0   Reconcile the truth + fix Swansea  (S)   ← everything depends on it
Phase 1   Evidence store + resolver shadow   (M-L)
Phase 2   Entity graph + recall              (M)   ← the brain starts remembering people
Phase 3   Chatbot retrieval refactor         (M)   ← biggest single chatbot lever
Phase 4   Historic job import                (L)   ← biggest single accuracy lever
Phase 5   Entity priors → adjustments        (M)   ← where memory becomes money
Phase 6   Scope completeness                 (M)
Phase 7   Unusual-job scoping + gate         (M-L)
Phase 8   Tier A indexing + split regions    (M)
Phase 9   Subbie quotes + Xero bills pull    (M-L)
Phase 10  Tier B build-ups (top 60 keys)     (L)
Phase 11  Licensed rate books (calibration)  (M)   ← legal gate, deliberately late
Phase 12  Accuracy dashboard + evals         (M)
```

Phases 2–3 are the ones you'll *feel* first — the bot starts knowing who everyone is.
Phases 4–5 are the ones that move the number. Phases 6 and 2 touch disjoint files and
can run in parallel.

---

## Risks and things to watch

- **Licence terms (Phase 7).** BCIS and SPON'S licences restrict redistribution.
  Treat licensed rows as internal-only (`redistributable = 0`) and get the terms
  reviewed before a single row reaches a client-facing document. This is a
  commercial risk, not a technical one, and it is the one that can bite hardest.
- **Prompt-cache invalidation.** `chat.js:2285` splits the system prompt into a cached
  stable base plus a per-turn tail, and `playbooks.js` deliberately renders
  byte-stably to preserve that. Injecting large retrieved memory blocks into the
  *stable* half would destroy caching and multiply cost. Retrieved content belongs in
  the per-turn tail, or behind the `lookup_rate` tool.
- **Cap rescaling.** Changing caps from silent-rescale to flag-and-review will make
  some totals visibly move on day one. That is the point, but it needs a heads-up
  and a shadow period.
- **SQLite ceiling.** Fine now. Revisit at ~250k evidence rows or genuine
  multi-tenancy. Don't pre-emptively migrate.
- **`chat.js` is 4,090 lines** with a 2,200-line handler and a 700-line prompt builder.
  Phases 0 and 3 both touch it. Carve out `buildSystemPrompt` into its own module as
  part of Phase 0 — the eval README already asks for this so the harness can drive
  extraction in-process.
- **Circular learning — the one that would quietly rot the brain.** If
  `model_estimate` evidence can promote into `rate_facts`, the system starts learning
  from its own guesses and confidence rises while accuracy doesn't. Controls:
  `model_estimate` carries weight 0.25 and **can never promote on its own**; every
  authoritative fact must include at least one human-anchored source class
  (`final_account`, `invoice_paid`, `qs_correction`, `own_history`) in its effective
  weight. Enforce in `promote.js`, and test it.
- **Scraped retail prices making the BOQ worse.** Feeding shelf prices into trade
  rates inflates them 20–40%. Materials may only ever reach a rate through Tier A
  weights, and a supplier must be trade-calibrated against real bills before it is
  allowed to influence pricing at all.
- **Scope engine will raise totals.** That is the point — the omissions are real
  money you're currently leaving out — but it will look like a regression on day one.
  Ship it advisory-only first (a checklist the QS ticks), report the £ delta
  explicitly, and price it in second.
- **Entity priors are personal data and a performance judgement.** Covered in the
  governance block above; the short version is that it must be visible, correctable,
  expiring, tenant-scoped and off by default.
- **`PORTAL_SPEC.md` is out of date** — it lists "Invoice / accounting integration" as
  out of scope while Xero, Stripe and Invoices have shipped. Phase 10 makes the
  conflict worse. Reconcile the spec, since it is meant to be the gate on new work.

## Verification

- **Phase 0:** `npm test` green in CI; grep confirms no rate literals remain in
  `chat.js` prompt strings; a fixed job priced through both cascades gives one total;
  `detectLocationFactor('Swansea')` returns Wales, not London.
- **Phase 1:** shadow-mode delta log shows resolver output **byte-identical** to the
  current ladder on all eval fixtures (`node server/evals/runEval.js` → 0 drift).
  A zero-diff refactor is the whole point of this phase.
- **Phases 2–3:** a unit test asserting the **cached system prefix is byte-stable
  across two different jobs for the same user** — entity cards and retrieved context
  must land in the per-turn tail, never the cached prefix. `playbooks.renderPlaybook()`
  already sorts keys for exactly this reason; copy the pattern and lock it with a test.
  Manually: start a fresh chat and confirm the bot names the client, the architect and
  what happened on the last job without being told.
- **Phase 5:** every entity adjustment on a priced line renders a human-readable
  reason and a sample count, and can be dismissed. Toggle off → totals return to
  Phase 4 values exactly.
- **Phase 2+:** `node server/evals/runEval.js --value-threshold 5` on 20+ real
  fixtures; `node server/evals/parity.js` for the median/worst report; MAPE vs final
  account trending down on the dashboard.
- **Phase 5:** submit a deliberately odd job (e.g. a listed-building chimney rebuild
  with restricted access) end-to-end through the running portal; confirm a method
  statement, a banded price, explicit assumptions/exclusions, and a blocking review
  gate before `DELIVERED`.
- **Every phase:** rate-source coverage % must not regress.

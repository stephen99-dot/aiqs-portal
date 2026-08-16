# Super Brain — one view of everything learned, shared across both apps

> Status: **Phase 1 shipped.** Additive only — no existing pricing path reads
> the shared layer yet; that wiring is later phases, gated by the eval harness
> per the standing rule in `PRICING_BRAIN_PLAN.md`.

The AI QS Portal and AI Trades Pilot each grow their own knowledge as jobs are
confirmed and corrected: learned rates, quantity benchmarks, project
benchmarks, corrections, scope patterns, client profiles, user memories,
playbooks, the correction flywheel, entities and price evidence. The Super
Brain does two things with that:

1. **One picture.** `server/superBrain.js#snapshot()` reads every layer and
   the admin-only **Super Brain** page (`/super-brain`) shows it: counts,
   confidence, freshness, recent learnings.
2. **Cross-app exchange.** The two apps pull each other's anonymised
   knowledge packs, so a rate the Trades Pilot learns from a confirmed job
   also informs the QS portal, and vice versa.

## What is (and is not) shared

Shared: aggregate learned **rates** (weighted average per item/region/project
type), **quantity benchmarks** (avg qty/m² per element per project type) and
**scope patterns** (co-occurrence counts). All grouped across users before
export — no `user_id` survives aggregation.

Never shared: user memories, client profiles, entities, playbooks,
conversations, project records, or anything with a name or account on it.

Imports land in their own `brain_shared_rates` / `brain_shared_quantities` /
`brain_shared_patterns` tables tagged with the source app. Nothing writes
into `memory_rates` or any table a live pricing path reads. Each sync
replaces the peer's previous photograph rather than accumulating.

## Setup

Set on **both** apps:

| Env | Value |
| --- | --- |
| `SUPER_BRAIN_KEY` | Shared secret — the **same** value on both apps |
| `SUPER_BRAIN_PEER_URL` | Base URL of the sibling app (e.g. `https://app.aitradespilot.com`) |
| `SUPER_BRAIN_APP_ID` | Optional; defaults to this repo's app id |

Then, as admin, open **Super Brain** in the sidebar and press **Sync now**
(or `POST /api/super-brain/sync`). Sync is pull-based; run it from each app
to move knowledge both ways.

## Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/super-brain/snapshot` | admin | Dashboard feed |
| `GET /api/super-brain/export` | admin **or** `x-brain-key` header | The anonymised pack |
| `POST /api/super-brain/sync` | admin | Pull the peer's pack and import it |
| `POST /api/super-brain/import` | admin | Import a pack pasted manually |

## Later phases (not built)

- **Consume:** let `rateResolver.js` treat shared rates as one more evidence
  source (lowest precedence, provenance-tagged), gated by the parity evals.
- **Advisory in chat:** a `recallSharedRate()` helper exists for the chat to
  cite what the sibling app has seen, without pricing off it.
- **Scheduled sync:** a daily cron hitting `/api/super-brain/sync` on both
  apps, instead of the manual button.

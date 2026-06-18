# Intelligent Build Schedule (Wave 6) — Spec

> Status: **Stage 1 + Stage 2 built (admin-only)**. Admin-only rollout first,
> then flip the gate to all estimator users.
>
> **Stage 2 is implemented** behind the admin gate:
> - Engine: `scheduleEngine.js` now honours `actual_start` / `actual_end`
>   (a recorded date pins the task and downstream flows from the real finish) and
>   `lag_days` (accumulated slip that pushes a task and everything after it back).
>   New `schedule_tasks.lag_days` column (created + migrated in `database.js`).
> - Assistant: `POST /api/schedule/plans/:id/assistant` runs a short tool loop
>   with the `update_schedule_progress` tool — resolves tasks by id or name,
>   records status / actual dates / % / slip, re-flows, snapshots, and replies
>   with the new completion date.
> - UI: an "Update from site" chat box on the Build schedule section
>   (`src/components/JobSchedule.js`); the timeline updates live from the reply.
>
> **Design note:** Stage 2 was specified as "an agent tool wired into the
> existing chat loop". In practice the general `/chat` endpoint (`chat.js`) only
> runs web-search, with no custom tool-dispatch loop, and the `agent.js` tool
> framework is the drawings→BOQ takeoff agent (wrong context). Rather than bolt a
> tool loop onto the 265KB streaming chat, Stage 2 ships as a focused, self-
> contained assistant under the already-admin-gated `/api/schedule`, surfaced
> where the schedule lives. Same outcome — "explain what happened → the bot
> updates the schedule" — with the job context implicit and far lower risk. The
> general-chat integration remains available as a later enhancement.
>
> **Stage 1 is implemented** behind the admin gate:
> - DB: `schedule_plans`, `schedule_tasks`, `schedule_snapshots` (`server/database.js`).
> - Date-flow engine: `server/scheduleEngine.js` (durations + dependencies over a
>   working calendar; cycle- and bad-input-safe).
> - API: `server/scheduleRoutes.js`, mounted at `/api/schedule`
>   (`authMiddleware` + `adminMiddleware`). AI generation via `callModel`
>   (`schedule_generate`, logged to `usage_log`).
> - PDF: `server/schedulePdf.js` (branded landscape Gantt-style programme).
> - UI: `src/components/JobSchedule.js`, surfaced as an admin-only "Build
>   schedule" section + chip on the job page (`src/pages/JobDetailPage.js`).
>
> To roll out to all estimator users: swap `adminMiddleware` → `requireEstimator`
> in `scheduleRoutes.js`, and gate the job-page section/chip on `hasEstimator`
> instead of `isAdmin`.

## The ask (customer, verbatim intent)

> "An intelligent build schedule option. Produce a schedule off the back of the
> estimate, then feed in site progress by explaining what's been done to the AI
> bot. If the bot could update the schedule it would be amazing. It's the single
> most important part of what we do, but the hardest thing to keep updated."

Two halves:

1. **Generate** a build programme automatically from an existing estimate.
2. **Maintain** it conversationally — the builder tells the bot what happened on
   site in plain English, and the bot re-flows the dates.

The maintenance half is the differentiator. Generating a Gantt chart is common;
keeping it honest with zero admin overhead is the part that "never works
properly" in the tools they use today.

## Why this fits the existing portal

| Need | Already in the portal |
| --- | --- |
| Source data for the schedule | `quotes` → `quote_lines` (section, item, qty, labour, materials) and `estimator_jobs` as the parent — `server/database.js` |
| AI that drafts structured output from priced lines | Estimator quote drafting — `server/estimatorRoutes.js` |
| AI that mutates data via tool-use | Agent tool loop — `server/agentRunner.js`, tool defs in `server/agent.js` |
| AI that extracts structured facts from plain English | Auto-learning — `server/autoLearn.js` |
| Construction-domain reasoning (trade sequencing) | "Atlas" QS persona — `server/agentRunner.js` |
| Branded PDF export | Existing PDF pipeline used by quotes / change orders |

The only genuinely new ground is the **scheduling data model** (no tasks,
durations, dependencies, or timeline UI exist today) and a **timeline view**.

## Rollout plan (admin-only → everyone)

We reuse the two gating mechanisms already in the codebase so the later flip is a
one-line change, not a refactor.

**Phase A — admin only (initial):**

- **Backend:** mount all routes behind `adminMiddleware` (`server/auth.js:32`).
- **Frontend:** add the nav entry with `adminOnly: true`, which the existing
  filter at `src/components/Layout.js:222` already honours
  (`if (item.adminOnly && !isAdmin) return false;`).

This means only the admin account (`hello@crmwizardai.com` / `role = 'admin'`)
sees or can call anything. Zero risk to existing users.

**Phase B — roll out to everyone (later, when we're happy):**

- Swap `adminMiddleware` → `requireEstimator` on the routes. That helper
  (`server/auth.js:38`) already lets admins through *and* gates normal users on
  the `has_estimator` flag — exactly the pattern Waves 2–4 use.
- Change the nav flag from `adminOnly: true` to estimator-gated (mirror how
  `/jobs`, `/finance`, etc. are shown in `Layout.js`).
- Optionally add a temporary password lock like `requireEstimatorPassword`
  (`server/auth.js:52`) for a soft launch.

No data migration is needed between phases — the tables are identical; only the
gate changes.

## Data model (new tables)

Idempotent schema block in `server/database.js`, following the existing
convention. Prefixed `schedule_` to avoid collisions.

### `schedule_plans`

One programme per job. Keeping the plan as its own row (rather than columns on
`estimator_jobs`) lets a job carry a baseline plus the live version.

| Column | Notes |
| --- | --- |
| `id` | PK |
| `user_id` | owner |
| `job_id` | FK → `estimator_jobs.id` |
| `quote_id` | nullable FK → `quotes.id` the plan was generated from |
| `title` | e.g. "Main build programme" |
| `start_date` | programme start (working-calendar anchor) |
| `status` | `draft` \| `active` \| `complete` |
| `working_days` | JSON, e.g. Mon–Fri; drives date math (reuse overheads' working-days idea) |
| `created_at` / `updated_at` | |

### `schedule_tasks`

The actual programme rows.

| Column | Notes |
| --- | --- |
| `id` | PK |
| `plan_id` | FK → `schedule_plans.id` |
| `phase` | groups tasks (Groundworks, Frame, First Fix, …) |
| `name` | task label |
| `sort_order` | display order within phase |
| `duration_days` | planned working days |
| `depends_on` | JSON array of `schedule_tasks.id` (dependency chain → date flow) |
| `planned_start` / `planned_end` | computed from dependencies + durations |
| `actual_start` / `actual_end` | nullable; filled from site updates |
| `percent_complete` | 0–100 |
| `status` | `not_started` \| `in_progress` \| `done` \| `blocked` |
| `source_line_ids` | JSON; which `quote_lines` this task came from (traceability) |
| `notes` | free text (e.g. "waiting on screed pump") |

### `schedule_snapshots`

The baseline-vs-actual record. **This is what makes "it's slipping" visible** and
is the whole point of the feature — included from day one even if its UI lands
later.

| Column | Notes |
| --- | --- |
| `id` | PK |
| `plan_id` | FK |
| `label` | e.g. "Baseline", "Re-plan 2026-07-01" |
| `taken_at` | timestamp |
| `data` | JSON freeze of all tasks at that moment |

`estimator_jobs` is unchanged except for being the parent — no destructive
migration.

## Stage 1 — Generate + view (low risk, demoable)

**Flow:** open a job → "Generate build schedule" → AI drafts phases/tasks from
the linked quote → editable timeline.

- **Endpoint:** `POST /api/schedule/plans` `{ job_id, quote_id, start_date }`.
  - Loads the quote's lines, sends them to Claude with a sequencing prompt
    (reuse the estimator drafting pattern in `server/estimatorRoutes.js`).
  - Claude returns phases → tasks with durations and a dependency chain.
  - Server computes `planned_start`/`planned_end` across the working calendar and
    writes the rows + a "Baseline" snapshot.
  - Model tier: **STANDARD** (`claude-sonnet-4-6`) is the right balance; log the
    call to `usage_log` like every other AI call (`server/anthropicClient.js`).
- **UI:** new page (e.g. `/schedule` or a tab on `/finance/jobs/:id`).
  - Simple horizontal bar timeline first — **not** a full MS-Project clone.
  - Inline edit of task name / duration / dependency; drag can come later.
  - "Export PDF" via the existing branded PDF pipeline.

**CRUD routes (all `adminMiddleware` in Phase A):**

```
GET    /api/schedule/plans?job_id=        list plans for a job
POST   /api/schedule/plans                generate (AI) or create blank
GET    /api/schedule/plans/:id            plan + tasks
PATCH  /api/schedule/plans/:id            rename, set start_date, status
DELETE /api/schedule/plans/:id
POST   /api/schedule/plans/:id/tasks      add task
PATCH  /api/schedule/tasks/:id            edit a task (re-flows dependents)
DELETE /api/schedule/tasks/:id
POST   /api/schedule/plans/:id/snapshot   manual snapshot
GET    /api/schedule/plans/:id/export     branded PDF
```

## Stage 2 — Conversational progress updates (the magic)

The builder describes site progress in chat; the bot updates the plan and
re-flows downstream dates.

> "We got the roof on Tuesday but the screed slipped a week waiting on the pump."
> → roof task marked done with `actual_end` = Tue; screed start pushed +1 week;
> every dependent task shifts; a snapshot is taken so the slip is on record.

- **New agent tool** `update_schedule_progress`, registered alongside the
  existing tools in `server/agent.js` and handled in the loop in
  `server/agentRunner.js` (same mechanism as `record_takeoff_item`). Input shape
  roughly: `{ plan_id, updates: [{ task ref, status, actual_start/end,
  percent_complete, delay_days, note }] }`.
- The tool resolves task references by name fuzzily (the bot already reasons in
  trade terms), applies updates, **re-runs the date-flow** over dependencies, and
  writes a snapshot.
- The bot replies with a plain-English summary of what moved and the new
  finish date ("handover now 8 Aug, was 1 Aug").
- Lean on the existing date-flow function from Stage 1 — the tool just sets
  actuals/delays and re-triggers it; no second scheduling engine.

## Out of scope (for now)

- Resource/crew allocation and levelling.
- Critical-path optimisation beyond a simple dependency chain.
- Drag-to-reschedule Gantt interactions (Stage 1 is inline edit).
- Client-facing shared schedule link (could mirror the change-order public-token
  pattern later).
- Calendar/Google sync.

## Open questions

1. **Home for the UI** — standalone `/schedule` page, or a tab inside
   `/finance/jobs/:id`? (Leaning: a tab on the job, since a schedule is always
   per-job.)
2. **Working calendar** — fixed Mon–Fri to start, or per-plan configurable
   (and do we honour UK/IE bank holidays)?
3. **Durations** — should the AI infer them purely from labour hours in the
   quote lines, or do we want a small editable "typical duration per trade"
   default table the admin can tune?
4. **Granularity** — phase-level tasks only (~10–20 rows) for v1, or down to
   individual quote lines? (Leaning: phase-level for a usable first cut.)

## Suggested build order

1. ✅ Schema (`schedule_plans`, `schedule_tasks`, `schedule_snapshots`).
2. ✅ Date-flow helper (durations + dependencies → dates over a working calendar).
3. ✅ Stage 1 routes (admin-gated) + AI generation.
4. ✅ Timeline UI + PDF export.
5. ✅ Stage 2 assistant (`update_schedule_progress`) + conversational re-flow.
6. ⬜ Flip the gate from `adminMiddleware` → `requireEstimator` and surface in nav
   for all estimator users.

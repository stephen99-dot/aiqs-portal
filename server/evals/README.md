# Takeoff eval harness (Phase 7)

The regression measuring stick. It compares a captured takeoff against an agreed
"golden" takeoff for the same job and reports **item-count delta**, **total
construction-value delta %**, and **missing / extra items**. It exits non-zero
when a job drifts past the thresholds, so it can gate CI on any change to
prompts, models, or the takeoff pipeline (Phase 11).

## Run it

```bash
node server/evals/runEval.js
node server/evals/runEval.js --fixtures server/evals/fixtures --value-threshold 5
```

A synthetic fixture (`fixtures/example-extension`) ships so the harness runs out
of the box and demonstrates a failing job (a dropped window line + an inflated
slab quantity). Delete it once you have real jobs.

Exit codes: `0` all good · `1` at least one job regressed (CI fails) · `2` no
fixtures directory.

## Fixture layout

```
server/evals/fixtures/<job-name>/
  expected.json   # the agreed golden takeoff
  actual.json     # the takeoff a run produced (optional)
```

**expected.json**

```json
{
  "location": "Manchester",
  "project_type": "Single-storey rear extension",
  "options": { "currency": "GBP" },
  "items": [
    { "key": "ground_slab", "description": "...", "unit": "m2", "qty": 24, "section": "1. Substructure" }
  ]
}
```

- `items` — the line items (same shape the deterministic pricer consumes:
  `key`, `description`, `unit`, `qty`, `section`). Items are matched across runs
  by `key`, falling back to a normalised `description`.
- `location` / `options` — passed to `deterministicPricer.priceLockedQuantities`
  so the value comparison uses production pricing.

**actual.json** — just `{ "items": [...] }`. If absent, the job is reported
`PENDING` (not a failure) until you capture a run.

## Metrics & thresholds

- **Value** — the construction total (priced line-item sum, before
  contingency/OHP/VAT %). Stable because it excludes config-driven add-ons.
  Default gate: `±5%`.
- **Missing items** — any `expected` item with no match in `actual` fails the
  job (a missing-item regression). Extra items are reported but don't fail.

## Capturing a golden job (Phase 11 "promote to fixture")

1. Run a real job through the portal and review/correct it as normal.
2. Save the agreed line items as `expected.json` (this is the human-blessed
   answer).
3. Save the items the pipeline first produced as `actual.json` to baseline the
   model's current behaviour.
4. Target 10+ golden jobs across project types (extension, refurb, new-build,
   heritage/conversion) so the harness covers the routing matrix.

## Capturing `actual.json` from the live pipeline

The extraction pipeline currently lives inside the `/api/chat` drawing-upload
flow, so the cleanest capture today is: upload the job's drawings through the
running portal and export the locked takeoff items the pipeline produced into
`actual.json`. A future improvement is to expose the Stage 1 extraction as a
standalone function (export `buildSystemPrompt` from `chat.js`) so the harness
can drive extraction in-process with an `ANTHROPIC_API_KEY` and no running
server — wiring that adapter is a follow-up, kept out of this change to avoid
touching the hot path.

## CI

Add a job that runs `node server/evals/runEval.js` on changes to the prompts,
models, or takeoff pipeline. A non-zero exit blocks the merge. Tune
`--value-threshold` to your tolerance (the master prompt targets >5% total-value
drift or any missing-item regression as the block condition).

# Schedule, Cost Tracking & Change Orders — Phased Build Plan

> Status: **living plan.** Phase 1 (Cash flow from the schedule) is the first
> feature under construction. Everything here is built as an **admin-only
> extension of "Office in a Box"** — see *Gating* below.
>
> Origin: a builder client's feature wishlist covering (1) turning the schedule
> into a client cash flow, (2) live cost tracking against budget, and (3) an
> on-site change-order / VO app. This plan maps that wishlist onto the portal's
> existing rails (Finance Hub, Build Schedule, Variations, Xero) and sequences
> the work.

## Guiding principles

- **Build on what exists.** The portal has already shipped six "waves" —
  Finance Hub, Invoices, Variations/Change Orders, Xero push, Documents, and an
  Intelligent Build Schedule with a conversational "update from site" bot. Most
  of the wishlist is an extension of something already here.
- **AI stays advisory on money.** It drafts and flags; a human fixes cost and
  signs off. Every existing money flow already works this way — keep it.
- **Each phase is independently demoable** and ends in something usable.

## Gating — admin-only, inside Office in a Box

The owner asked that these features be available **only on their own portal**
(not rolled out to estimator subscribers yet), and live inside the **Office in a
Box** section.

The portal has exactly two levers, and the owner is the `admin` account:

- **Backend:** new routes mount behind `adminMiddleware` (`server/auth.js`) →
  only the admin account can call them. Note the existing Build Schedule routes
  are `requireEstimator` (all subscribers); **new** capabilities are gated
  *tighter* with `adminMiddleware` layered on the specific route.
- **Frontend:** nav entries flagged `adminOnly: true` are filtered out for
  everyone else by the existing rule at `Layout.js` (`if (item.adminOnly &&
  !isAdmin) return false`). Admin-only *views inside* an existing shared
  component (e.g. the cash flow panel on the schedule) are gated with
  `useAuth()` → `user.role === 'admin'`.

**Standing rule for every phase below:** all new routes `adminMiddleware`; all
new nav entries `adminOnly: true`; all new pages under the `/office` route
family so they stay inside the group. Selling to subscribers later is the same
one-line-per-route swap the codebase already uses — but the default is: owner
only.

> ⚠️ **One enabling change, done when first needed:** today `adminOnly` is only
> honoured on *top-level* nav items, not on *children inside a group*
> (`OfficeGroup` doesn't filter its children). Adding an admin-only child to the
> Office in a Box group requires a ~5-line filter in `OfficeGroup`. Not needed
> for Phase 1 (the cash flow lives inside the existing job-page schedule
> section), so it's deferred until a phase adds a dedicated nav entry.

---

## Phase 0 — Turn on / expose what's already built

- ✅ Build Schedule (generate from quote, date-flow engine, conversational site
  updates, branded PDF) — *built, already live for estimator users*.
- ✅ Variations/Change Orders (priced VOs, photo capture, client e-approval +
  audit trail, lock-on-approval) — *built*.
- ⬜ `OfficeGroup` admin-child filter (deferred until a phase needs a nav entry).

**Effort:** S · **Risk:** Low

## Phase 1 — Cash flow from the schedule  *(in progress)*

Expected monthly cash flow spread across the programme, with claims to date
overlaid. All inputs already exist — task dates, the quote's contract value, and
invoices ("claims"). Admin-only.

- ✅ Pure projection module `server/scheduleCashflow.js` — spreads the contract
  value across each task's working days (weighted by priced source lines where
  known, by duration otherwise), buckets by calendar month, overlays claims.
- ✅ Unit tests `server/scheduleCashflow.test.js`.
- ✅ `GET /api/schedule/plans/:id/cashflow` — **`adminMiddleware`** (tighter than
  the rest of the schedule). Returns monthly planned vs claimed + totals.
- ✅ Cash flow panel in `src/components/JobSchedule.js`, admin-only via
  `useAuth()`. Monthly table + bars + contract/planned/claimed/remaining totals.
- ✅ "Show client" branded PDF — `server/cashflowPdf.js` +
  `GET /api/schedule/plans/:id/cashflow/pdf` (admin-only). Portrait A4 with the
  builder's branding: totals cards + a month-by-month planned/cumulative/claimed
  table. "Show client (PDF)" button in the cash flow panel.

**Effort:** M · **Risk:** Low · **Deps:** Phase 0

## Phase 2 — Close the change-order "site app" loop  *(in progress)*

- ✅ Photo + measurements + rates on a variation, client e-sign with audit,
  lock-on-approval — *built*.
- ✅ On approval: **auto-add to the schedule/timeline** and re-flow dates —
  `server/scheduleLink.js`. When a change order is approved, a costed task
  ("VO N: title", phase *Variations*) is appended to the job's programme,
  scheduled to run after the current work, and the plan re-flows + snapshots.
  Duration is estimated from the change order's labour (~1 day / £250, capped).
  Idempotent (never double-adds). **Owner-portal only** — no-ops unless the
  owning user is admin.
- ✅ On approval: roll into the cost-tracking + cash flow doc — the added task
  carries an explicit `cost_amount`, so the Phase 1 cash flow shows the change
  order stacked on the contract value (new "Change orders" total + a timeline
  badge). No double counting: explicit-cost tasks are excluded from the
  contract-value spread.
- ✅ AI **indicative cost** auto-draft from measurements/rates —
  `server/variationDraft.js` + `POST /api/change-orders/ai-draft`. The site
  manager describes the change in plain English ("plaster 5 sqm, chippy 2
  days"); the AI drafts priced lines (grounded in the builder's own day/confirmed
  rates), marked indicative so the office confirms the workload and fixes the
  cost. Surfaced as an admin-only "AI indicative cost" box in the change-order
  editor that merges the drafted lines into the existing line editor. Doesn't
  auto-save — the office reviews, then the normal save persists. **Owner-portal
  only** (`adminMiddleware`).
- ⬜ Mobile-friendly polish of the existing public pages.
- ⬜ FOC toggle + RFI/design-update routing (Phase 8 territory).

**Effort:** M · **Risk:** Low–Med · **Deps:** Phases 0–1

## Phase 3 — Site time & cost capture  *(in progress)*

- ✅ Plain-English site update → progress + date re-flow + slip flag — *built*.
- ✅ Capture hours + % complete per task — `schedule_time_entries` table +
  `POST/GET/DELETE /api/schedule/plans/:id/time` (admin-only). Each entry logs
  who/date/hours/rate/%/note against a task; logging updates the task's %
  complete and status.
- ✅ Compare captured vs planned & feed Finance Hub — `server/timeCapture.js`
  rolls captured labour up per task against the priced labour (from each task's
  source quote lines) and flags overruns; every logged entry also writes a
  `job_costs` (labour) row so the existing budget-vs-actual + PM over-budget
  alerts pick it up automatically. Deleting an entry removes its cost row.
- ✅ Alert when labour is over — deterministic flags in the rollup (per task and
  overall), shown as a "Needs attention" banner in the capture panel.
- ⬜ Conversational capture — let the "Update from site" bot log hours too (next
  slice; extends the existing `update_schedule_progress` tool).
- ⬜ Captured costs → approve → update invoice for sign-off (overlaps Phase 6's
  per-package billing).

**Effort:** M · **Risk:** Med · **Deps:** Phase 0

## Phase 4 — Expanded bars + weekly client update

- ✅ `schedule_tasks.source_line_ids` links tasks to priced lines — *data there*.
- ✅ `schedule_snapshots` records baseline-vs-actual — *built*.
- ⬜ Expand a schedule bar to show the included/priced tasks in that window.
- ⬜ Auto-generate a weekly progress/changes/delays narrative + client view.

**Effort:** M · **Risk:** Low · **Deps:** Phase 1

## Phase 5 — Xero invoice pull + package allocation + anomaly detection

- ✅ Xero OAuth, token refresh, tenant handling — *built (push side)*.
- ⬜ Pull bills/invoices from Xero (read scope).
- ⬜ Allocate to jobs/packages (rules + manual override).
- ⬜ Anomaly check against package quotes; feed budget-vs-actual + alerts.

**Effort:** L · **Risk:** Med–High (external API) · **Deps:** Phase 3

## Phase 6 — Per-package billing method

- ✅ Invoices, staged payment schedules, "invoice from quote" — *built*.
- ⬜ Per-package toggle: **Bill by % complete** *or* **Bill by actual M&L**.
- ⬜ Drive invoice generation from the chosen method + captured progress/costs.

**Effort:** M · **Risk:** Med · **Deps:** Phases 3 & 5

## Phase 7 — Procurement, lead times & critical path

- ⬜ Procurement items: order dates, delivery lead times, supplier.
- ⬜ Tie lead times into the schedule engine (delivery gates a task's start).
- ⬜ Critical-path calculation + highlight; surface on the timeline.

**Effort:** L · **Risk:** Med · **Deps:** Phase 0 schedule engine

## Phase 8 — Personnel, RFIs & as-built loop

- ⬜ Personnel/resource model → assign crew to tasks; specific on-site expectations.
- ⬜ RFIs to design/office (reuse photo + public-link machinery).
- ⬜ Notify design team of required drawing/as-built updates on approved changes.

**Effort:** M–L · **Risk:** Low–Med · **Deps:** Phases 2 & 3

---

## Sequencing at a glance

```
Phase 0  Expose existing schedule + VO           (S)  ← foundation
Phase 1  Cash flow from schedule                 (M)  ← first feature (in progress)
Phase 2  Close change-order site loop            (M)
Phase 3  Site time/cost capture                  (M)
Phase 4  Expanded bars + weekly update           (M)
Phase 5  Xero pull + allocation + anomalies      (L)  ← biggest integration
Phase 6  Per-package billing method              (M)
Phase 7  Procurement / lead times / critical path (L) ← most net-new
Phase 8  Personnel / RFIs / as-builts            (M-L)
```

Effort labels are relative (S/M/L), not calendar estimates.

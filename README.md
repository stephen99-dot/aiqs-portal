# AI QS — Customer Portal

A client-facing web app for AI-powered quantity surveying. Customers can create accounts, upload construction drawings, submit project briefs, and track their BOQ orders.

## Tech Stack
- **Frontend:** React 18 + React Router
- **Backend:** Express.js REST API
- **Database:** SQLite (via better-sqlite3)
- **Auth:** JWT tokens + bcrypt
- **Uploads:** Multer (local file storage)

## Deployed on Render

### Environment Variables
- `JWT_SECRET` — Any random secret string
- `NODE_ENV` — `production`
- `PORT` — `5000`

### Build Command
npm install && npm run build

### Start Command
node server/index.js

## Estimator add-on

A lightweight quote generator that lives at `/estimator`. Builder describes a job in
plain English (or fills a short form), Claude drafts an itemised quote, the rate
library prices each line, the builder edits, and a branded PDF / Excel is exported.

This is **separate from the heavy drawings -> BOQ pipeline** (which still lives at
`/submit-drawings` and goes through `server/boqGenerator.js`). The estimator never
touches that flow.

### Feature flag

All estimator routes and UI are gated behind `users.has_estimator`:
- Backend: `requireEstimator` middleware in `server/auth.js` (admins pass through).
- Frontend: sidebar entry + page content render only when `user.hasEstimator` is true.
- Toggle for a user via `PUT /api/admin/users/:id/estimator` with `{ "enabled": true }`.

### Environment variables (in addition to the existing ones)

- `ANTHROPIC_API_KEY` — required for the AI draft step. (Already used by chat.)
- `ESTIMATOR_PASSWORD` — **required**. A shared password that locks every estimator
  page and API route. If this env var is unset, the entire estimator returns a 503
  (`ESTIMATOR_LOCKED`) — fail safe. Users enter the password once per browser; it's
  stored in `localStorage` and sent as the `x-estimator-key` header on every estimator
  request. To rotate, change the env var and redeploy — every browser will be
  reprompted on next use. Remove the env var to take the lock off (and reopen access
  via the `has_estimator` flag only).

### Stripe wiring (Phase 2 TODO)

The £50/month add-on is currently flag-only. To self-serve subscribers, add the new
price ID to the `PRICE_TO_PLAN` map in `server/stripe-webhook.js` and set
`has_estimator = 1` from the `customer.subscription.updated` handler. Search for
`TODO: wire to billing` in `server/routes.js` for the hook point.

### Render notes

- The `quotes` and `quote_lines` tables are created automatically by the idempotent
  schema block in `server/database.js`; the `has_estimator` column is added by the
  migrations array. No manual migration step is needed.
- `pdfkit` is included as a dependency — no extra buildpack required.
- PDFs are generated server-side and streamed straight to the browser; nothing is
  persisted to disk.

### Input modes

The estimator builder offers three ways to start a quote:

1. **Describe the job** — paste a plain-English description; AI drafts the lines.
2. **Quick form** — a few dropdowns and fields when you'd rather not type prose.
3. **Site measurements** — add elements (Floor / Wall / Ceiling / Roof / Linear /
   Volume / Count / Custom), enter dimensions, and the tool computes quantities
   automatically (e.g. wall = perimeter × height). Those structured measurements
   are sent to Claude so the quote uses your real numbers, not guesses.

### Rate autocomplete

The line editor's **item** field is a typeahead over the seeded `rates` table:
start typing ("plaster", "concrete C25", etc.) and pick a suggestion to fill the
item, description, unit, rate and labour/materials split in one click. Picking a
suggestion clears the `est_rate` flag on that line. Endpoint:
`GET /api/estimator/rates/search?q=<terms>&unit=<unit>&limit=<n>`.

## Finance Hub (Wave 2)

A second section gated behind the same estimator capability flag + password. Lives
at `/finance` in the UI and `/api/finance/*` on the backend. Five new tables, all
created by the idempotent schema block in `server/database.js`:
`estimator_jobs`, `overheads`, `job_budgets`, `job_costs`, plus a nullable
`quotes.job_id` link.

- **`/finance`** — dashboard cards: quotes this month, win rate, current
  break-even rate, planned vs actual, jobs by status, and a margin-creep list
  flagging jobs where actual cost is closing on (or above) planned.
- **`/finance/overheads`** — monthly fixed-cost line items + working days/hours.
  Computes total overhead, break-even day rate, break-even hour rate. Saves a
  snapshot per month so you can compare months.
- **`/finance/jobs`** — list of jobs with planned cost, actual, variance and
  status. Create new jobs inline.
- **`/finance/jobs/:id`** — single job: editable planned budget (labour /
  materials / overheads / other / margin %), actual cost log (material / labour /
  other rows with vendor + date), variance strip, linked quotes list.

The estimator builder is now overhead-aware: on every quote it shows whether the
chosen OH&P clears one day of overhead, and the quote header has a "Link to job"
picker so the saved quote appears on its job's page.

### Wave roadmap (still to ship)

- **Wave 3** — Quotes → Invoices → Payments: invoice generator, payment schedules,
  optional Stripe payment link.
- **Wave 4** — Variations & Change Orders: priced change orders, client e-approval
  with name/timestamp/IP audit trail, lock-on-approval.
- **Wave 5** — Documents & Compliance library + builder calculators.

### Earlier Phase 2 TODOs (still open)

- Stripe self-serve billing for the £50 add-on.
- Client login / approval portal for issued quotes (will be revisited in Wave 4).
- Bulk import of historical rates per user (`client_rate_library` is already there
  but isn't yet consulted by the estimator — easy follow-up).


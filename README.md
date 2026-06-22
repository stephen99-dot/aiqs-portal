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
- `VOYAGE_API_KEY` — optional; enables semantic memory retrieval (falls back to FTS keyword search if unset).
- `ENABLE_WEB_SEARCH` — optional; the chat uses Anthropic's live `web_search` tool by default. Set to `0` to disable it (e.g. to avoid per-search billing).

### Drawing reading & quote accuracy
The take-off pipeline reads the numbers printed on the drawings rather than only eyeballing the image:
- **PDF text-layer extraction** (`server/pdfGeometry.js`) — pulls the drawing scale, sheet size, room areas, dimension strings and door/window schedules straight from vector PDFs and injects them as authoritative ground truth ("read, do not estimate"). Also gives deterministic scale calibration (real mm per pixel) from the scale label + render DPI.
- **CAD/DXF import** (`server/dxfReader.js`) — when a user exports DXF, exact wall lengths (by layer), closed-polygon areas and door/window block counts are computed from the vector geometry. DWG should be exported to DXF or PDF.
- **Zoom tool** — the BOQ agent has a `zoom_region` tool to magnify any part of a sheet (scale bar, dimension chains, schedules) at high effective DPI, like a surveyor with a loupe.
- **Higher-res rendering** — page raster quality raised across the chat/agent paths so dimension text stays legible.
- **OCR for scanned drawings** (`server/ocr.js`) — optional. Lazy-loads `tesseract.js`; if a PDF has no text layer, printed dimensions/areas/schedules are recovered via OCR. To enable in production: `npm install tesseract.js`.

### Chat memory & learning
The chat assistant now mirrors the claude.ai front end's "remembers and learns" behaviour:
- **Always-on learning** — after every turn, durable facts/preferences about the user are extracted (`server/autoLearn.js`) and saved to `user_memories`, so they're recalled in future chats. They appear on the AI Memory page tagged "Learned automatically".
- **Cross-session recall** — each conversation is summarised (`conversation_summaries` table) and the most relevant past conversations are injected into the system prompt of new sessions.
- **Live web search** — Anthropic's `web_search` tool is offered on text chats for current prices, products and regulations.
- **Edit & regenerate** — edit a previous message and resend, or regenerate the last reply, from the chat UI.

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

## Variations & Change Orders (Wave 4)

Priced change orders against a job, with a defensible client e-approval audit
trail. Two new tables, `estimator_variations` and `estimator_variation_lines`,
created by the idempotent schema block in `server/database.js`. Named with the
`estimator_` prefix so they don't collide with the BOQ-pipeline `variations`
table that's owned by the existing `/api/variations/:projectId` route.

### Status flow

`draft` (fully editable) → `sent` (locked from editing, approval link issued)
→ `approved` (server-side locked, audit row written) **or** `declined` (still
editable; revise and re-send, or duplicate).

### Approval audit

When a client opens the public link `/v/<token>` and approves, the server
captures (and refuses to let the builder change afterwards):

- `approval_name` — typed by the client
- `approval_signature` — typed signature
- `approval_email` — optional
- `approval_ip` — read from `x-forwarded-for` / `req.ip`
- `approval_user_agent`
- `approval_at` — server timestamp

Once approved, `locked = 1` and any PATCH / PUT / DELETE on the row returns
`423 Locked`. The branded PDF carries the audit footer.

### Routes

```
# Owner — mounted at /api/change-orders to avoid colliding with the existing
# /api/variations/:projectId BOQ route. The UI label is still "Variations".
GET/POST/PATCH/PUT/DELETE under /api/change-orders/*
POST  /api/change-orders/:id/send             mints the approval token
GET   /api/change-orders/:id/pdf              branded PDF (audit footer if approved)

# Public — no auth, no estimator gate
GET   /api/public/variations/:token           payload for the approval page
GET   /api/public/variations/:token/logo      builder's logo, scoped to the token
POST  /api/public/variations/:token/approve   { name, email?, signature }
POST  /api/public/variations/:token/decline   { reason? }
```

### UI

- `/finance/jobs/:id` — a "Variations / change orders" panel under the costs
  table. Lists every variation with status pill, total and approver. Shows the
  approved-variations roll-up as `+£X approved` next to "+ New variation".
- `/change-orders/new?job=<id>` — variation editor (uses the same
  `RateAutocomplete` as the quote editor).
- `/change-orders/:id` — same editor for drafts; read-only with audit panel
  once approved.
- `/v/:token` — public branded approval page. Renders outside `ProtectedRoute`
  in `App.js`; works without an account or password. Approve / decline buttons
  capture the audit fields.

## Invoices & Payments (Wave 3)

Branded invoices and a per-job payment schedule for cashflow visibility. Three
new tables added by the idempotent schema block in `server/database.js`:
`invoices`, `invoice_lines`, `payment_schedules`.

### Invoices

- **`/invoices`** — list with status filters (Draft / Sent / Paid / Void / Overdue).
- **`/invoices/:id`** — editor. Bill-to block, line table, VAT %, discount,
  payment terms, notes/bank details. Read-only when paid or void.
- Can be created blank, **from a saved quote** (deep-copies the lines so the
  invoice stays editable independently), or attached to an estimator job.
- Auto-numbered per year per user: `INV-2026-0001`, `INV-2026-0002`, …
- Status flow: `draft → sent → paid` (or `void`). **Paid invoices are immutable**
  (server returns `423 INVOICE_PAID` on edit/delete; the UI hides controls).
- Branded PDF via `pdfkit`, consistent with the quote / variation PDFs.
- Overdue derived: `status === 'sent' && due_date < today` — shown in red on
  the list and the dashboard.

### Payment schedules

Per-job staged payments (Deposit / Stage X / Retention / Final). Each stage has
a label, amount (or % of contract), due date or trigger, paid/unpaid status,
and an optional link to the invoice that billed it. Shown on `/finance/jobs/:id`
in a compact panel with a `Paid £X of £Y` summary.

This is cashflow visibility — **no payment processing**.

### Stripe payment link (optional)

If `STRIPE_SECRET_KEY` is set on the server, the invoice editor shows a
"Generate Stripe link" button that creates a Stripe Checkout session and stamps
the URL onto the invoice. If the env var is unset, the endpoint returns
`503 STRIPE_NOT_CONFIGURED` and the button is hidden cleanly. **Live
reconciliation (webhook → invoice paid) is a separate small follow-up** — see
the `TODO: wire to billing` note in `server/invoiceRoutes.js`.

### Finance dashboard additions

The `/finance` dashboard now surfaces **Outstanding** (sum of sent-not-paid),
**Paid this month**, and **Overdue** cards. Click-through to the invoices list.

### Sidebar

A new **Invoices** entry below Finance, gated on `hasEstimator` like the rest.

## Documents & Calculators (Wave 5)

Branded, fillable document templates plus a set of client-side material
calculators. One new table (`documents`) added by the idempotent schema block;
calculators are stateless and need no schema.

### Document templates

Five code-defined templates render via `pdfkit` with the user's branding:

- **Contract for works** — parties, scope, sum, programme, retention, payment, variations, governing law, signatures.
- **Terms & Conditions** — small-builder boilerplate with merge fields for jurisdiction, payment days, warranty period.
- **Scope of work** — overview + inclusions / exclusions / assumptions; ideal as a quote attachment.
- **Payment terms** — schedule + retention + late-payment clauses; auto-converts `10%` to `£X` when the contract sum is filled.
- **Health & Safety / RAMS** — task, hazards, controls, PPE, emergency arrangements.

Templates are **fixed in code**, not user-editable (same approach as the
existing XLSX/DOCX templates in `PORTAL_SPEC.md`). Each template has a JSON
field schema (text / textarea / date / number / checkbox / list); the user's
filled values are stored as a JSON blob on the `documents` row, so the same
doc can be reopened, edited, and re-exported.

### UI

- **`/documents`** — list with template-tile picker (with optional job attach).
- **`/documents/:id`** — generated form from the template's schema, save / PDF / duplicate / delete. Editable title.
- **`/finance/jobs/:id`** — new "Documents" panel mirrors the picker, scoped to the job.

### Calculators

`/calculators` — five client-side, stateless tools (no API, no DB):

- **Brick / block** — wall L × H × bricks-per-m² (60 / 10) + waste %
- **Concrete volume** — L × W × D + waste %
- **Plaster / drylining** — wall + ceiling area ÷ coverage per 25kg bag
- **Roof area** — plan L × W × pitch factor; tile count × per-m² × waste %
- **Paint** — area × coats ÷ spread rate (default 12 m²/L) × waste %

Coverage / pitch / spread-rate values are editable inputs so the user can override defaults for their preferred products.

### Sidebar additions

Two new entries below Invoices: **Documents** and **Calculators**, both gated on `hasEstimator`.

### Wave roadmap (optional follow-ups)

- **Wave 3.5** — Stripe webhook → automatic invoice-paid status.
- **Public calculator mirror** — same components at `/calc/<name>` outside `ProtectedRoute` for SEO / top-of-funnel.
- **Wave 4** — Variations & Change Orders: priced change orders, client e-approval
  with name/timestamp/IP audit trail, lock-on-approval.
- **Wave 5** — Documents & Compliance library + builder calculators.

### Earlier Phase 2 TODOs (still open)

- Stripe self-serve billing for the £50 add-on.
- Client login / approval portal for issued quotes (will be revisited in Wave 4).
- Bulk import of historical rates per user (`client_rate_library` is already there
  but isn't yet consulted by the estimator — easy follow-up).

## 3D Builder (admin preview)

A PriceAJob-style parametric estimator at `/builder3d`. Define a building with a
few inputs and a three.js model renders brick walls + a roof; the server derives
construction quantities from the geometry and prices them against the seeded
**UK Master Rates** library (`rates`) into an estimate sidebar
(Structure → Roof → Services → Finishes, with a cost → OH&P → VAT → total
rollup). The estimate matches the picture because the **engine is the single
source of truth for geometry** — `priceModel()` returns the footprint outline +
roof rectangles in its response and the renderer draws exactly that.

- **Gating:** admin-only for now. The router (`server/builder3dRoutes.js`) uses
  `authMiddleware + adminMiddleware` and the page self-guards on role. To open it
  to subscribers, swap `adminMiddleware` for `requireEstimator` and drop
  `adminOnly` from the sidebar entry in `Layout.js`.
- **Engine** (`server/builder3dEngine.js`, unit-tested): rectangular / L / T / U
  footprints (a `wing` fraction sizes the notch/stem), hipped or gable roof. Area
  and perimeter come from the footprint polygon; roof slope area is
  `footprint / cos(pitch)`; ridge/hip/eaves linear metres are summed per
  rectangle (slightly over-counts at wing junctions — a known approximation).
  Rates resolve by code with a description fallback, so it prices across seed
  variations. Services are floor-area-scaled allowances.
- **Saved models + export:** `builder3d_models` table (created idempotently in
  the router). `GET/POST/PUT/DELETE /api/builder3d/models[/:id]` plus
  `POST /api/builder3d/pdf` for a branded estimate PDF (`server/builder3dPdf.js`,
  same header/branding as the quote PDF). The page has a name field,
  save / save-as / load / delete and Export PDF.
- **Dependency:** `three`.

### Known Phase-2 limits

- Rectangular wings only (L/T/U); openings are panels on the wall, not cut
  through the brick; roofs over adjoining wings intersect rather than forming
  proper valleys (so ridge/eaves metres are indicative). Area-based quantities —
  the bulk of the cost — stay exact.


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

### Phase 2 TODOs (not built)

- Stripe self-serve billing for the add-on.
- Client login / approval portal for issued quotes.
- Bulk import of historical rates per user (`client_rate_library` is already there
  but isn't yet consulted by the estimator — easy follow-up).


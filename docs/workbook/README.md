# AI QS Portal — Job Submission Workbook

A 24-sheet slideshow that teaches someone (typically a VA working on an owner's
behalf) how to get their own login and how to submit drawings for a BOQ.

- `index.html` — the workbook. Self-contained: open it in any browser, no server,
  no network. Arrow keys move between sheets, `C` opens the contents, `Ctrl`/`Cmd`+`P`
  prints it as a paper workbook (one sheet per page).
- `screenshots/` — the same screenshots as standalone WebP files, for reuse in
  training emails, PDFs or a help centre.

## What it covers

| Section | Sheets | Contents |
| --- | --- | --- |
| A · Orientation | 2–3 | What the portal does, the five job states, contents |
| B · Her account | 4–9 | Authorized sign-in email vs. a separate account, adding her, her first sign-in, what she can see |
| C · Submitting | 10–17 | The six steps of a submission, writing a brief, AI enhance, mobile |
| D · After sending | 18–22 | Tracking, collecting the pack, credits, rates and branding, the admin view |
| E · Reference | 23–24 | Troubleshooting table, one-page routine card |

## The screenshots are real

Every screenshot was captured from this codebase running locally against a seeded
database — not mocked up. A submission was genuinely sent through
`POST /api/submissions` to produce the confirmation screen on sheet 16.

To recapture after a UI change:

1. `npm install && npm run build`
2. Seed a demo account, a delegate on it, and a few jobs across the lifecycle
   (an admin user, a client user, rows in `authorized_emails`, `projects`,
   `project_deliverables` and `drawing_submissions`).
3. `NODE_ENV=production PORT=3001 JWT_SECRET=... node server/index.js`
4. Drive Chromium with Playwright over the pages listed in the table above.
   Suppress the overlays first or they sit on top of the UI — set these
   localStorage keys before first paint:
   - `atp_promo_dismissed` = `1` (the AI Trades Pilot card, injected by
     `public/index.html`)
   - `aiqs_suitability_done_<SURVEY_KEY>` = `1`
   - `aiqs_survey_done_<SURVEY_KEY>` = `1`
   - `aiqs_tour_complete_<userId>` = the current `TOUR_VERSION`
5. Resize to 1500px wide, encode WebP at quality 80, and inline each one as a
   `data:` URI so the workbook stays a single portable file.

## Facts the workbook asserts

These come from the code, and are what to re-check if the workbook is ever
updated:

| Claim | Source |
| --- | --- |
| Adding an authorized sign-in email is admin-only | `POST /api/admin/users/:id/authorized-emails` sits behind `adminMiddleware` (`server/routes.js`) |
| A delegate signs in with their own password but lands in the owner's account | `POST /api/auth/login` falls through to `authorized_emails` (`server/routes.js`) |
| An email can't be both a user and an authorized email | Conflict checks in `server/routes.js` |
| Invite links last 7 days | `invite_expires_at` set to `Date.now() + 7 days` |
| 20 files max, 100 MB each | `MAX_FILES` / `MAX_FILE_BYTES` in `server/submissionRoutes.js` |
| Brief must be 20+ characters, Terms tick enforced server-side | Validation in `POST /api/submissions` |
| One BOQ credit per submission, not charged on failure | `consumeBoqCredit` runs only after the submission is recorded |
| Credit pack prices | `SubmitDrawingsPage.js` top-up panel |
| Five job states | `PROJECT_STATUS` in `src/ui/status.js`, `PORTAL_SPEC.md` |

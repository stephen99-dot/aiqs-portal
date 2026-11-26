# AI QS — Customer Portal

A client-facing web app for AI-powered quantity surveying. Customers can create accounts, upload construction drawings, submit project briefs, and track their BOQ orders.

## Tech Stack
- **Frontend:** React 18 + React Router
- **Backend:** Express.js REST API
- **Database:** SQLite (via better-sqlite3)
- **Auth:** JWT tokens + bcrypt
- **Uploads:** Multer (local file storage)
- **iOS app:** the same React build wrapped by Capacitor 8 (`ios/`, Swift Package Manager, iPhone only).
  `npm run ios` builds, syncs and opens Xcode. Everything from first run to App Review is in
  **[docs/IOS_APP.md](docs/IOS_APP.md)** — including the App Store rules the app is shaped around
  (no in-app Stripe links, no Google button in the app, in-app account deletion) and the device
  matrix with the iPhone Duo.

## MAX — the AI estimator and assistant

MAX is the chat-and-voice assistant on every signed-in screen (the **Ask MAX** box on the
dashboard, the **Ask MAX** entry in the menu, the floating button, ⌘J / Ctrl+J). Its headline
job is **pricing small jobs**: the builder says *"Price a 20 m² patio using my usual rates,
including removal of the existing slabs"* and an editable estimate appears with every quantity,
rate and assumption shown.

How a small job is priced (`server/maxPricing.js`):

1. **Take-off (the model).** One forced-tool call turns the description into measurable lines —
   section, description, unit, quantity, the working behind the quantity — and the rate-library
   key (or the builder's own rate key) each line is priced from. The model emits quantities and
   keys, never money, except an *assumed rate* for work no key covers, which is flagged.
2. **Pricing (deterministic).** `deterministicPricer.priceLockedQuantities` — the same engine that
   prices the QS team's BOQs — applies the builder's own rates first (`client_rate_library`), the
   base library adjusted for the site's region second, and the assumed rate last. Totals use the
   builder's OH&P / contingency (AI Memory → Pricing margins) and VAT. Every line records where
   its rate came from; lines on an estimated rate are marked for checking.
3. **The threshold (`server/maxSettings.js`).** The price ex VAT is compared with two admin-set
   limits (defaults £80,000 notice, £100,000 limit; Admin → MAX, or `MAX_SMALL_JOB_*` env).
   Below the notice the estimate is drafted as normal. From the notice it carries a "worth a full
   take-off" note. **At or above the limit MAX makes no estimate**: it shows a warning card with
   the rough figure and a button that opens Submit Drawings with the brief filled in, so the AI QS
   team prices it from drawings. The refusal is logged (`max_over_limit`).

Estimates are rows in `quotes` (`source = 'max'`, assumptions and provenance in `max_meta`), so
they use the existing branded PDF / Excel exports and the public `/q/<token>` acceptance page.
`/estimates` lists them; `/estimates/:id` is the editor (lines, percentages, assumptions, send).

Other things MAX does: revise an estimate by chat, save a rate the builder states ("my skim rate
is £22 a metre"), search their rates and the library, report on drawings jobs with the team and
take-off credits, find and read stored drawings/BOQs, and hand a job to Submit Drawings.
**Sending an estimate to a customer and deleting wait for a tap on an approval card** — a
typed or spoken "yes" is never approval. Every action, approval and refusal is written to
`activity_log` (`max_*` events); each builder sees their own at `GET /api/max/activity`.

**The packages (`server/maxPlans.js`).** MAX is sold as two subscriptions, bought on the website's
Plans page (`/upgrade`) through Stripe Payment Links and managed there (switch, go yearly, cancel
at period end, resume, Stripe's billing portal — `server/billingRoutes.js`, `/api/billing/max/*`):

| Package | Monthly | Yearly (two months free) | Includes |
|---|---|---|---|
| **AI QS MAX** (`max`) | £59 | £590 | Ask MAX, estimates, Scan a room, LiDAR, AI survey, reports, voice |
| **AI QS MAX + Visualiser** (`max_visualiser`) | £79 | £790 | everything above plus finished-room renders |

The Stripe webhook writes the plan onto the user row (`max_plan`, `max_plan_status`,
`max_plan_interval`, `max_plan_renews_at`, `max_plan_cancels_at`, `max_subscription_id`) on
`checkout.session.completed` and keeps it in step on every `customer.subscription.updated` /
`deleted` and `invoice.paid`. Prices are matched by id (`STRIPE_MAX_PRICE_IDS`,
`STRIPE_MAX_VISUALISER_PRICE_IDS`) or, when those are unset, by amount and interval in GBP.
`node scripts/create-max-plans.js` creates the products, prices and payment links at Stripe and
prints the env vars (`MAX_PAYMENT_LINK_MONTHLY` / `_YEARLY`, `MAX_VISUALISER_PAYMENT_LINK_MONTHLY`
/ `_YEARLY`). Every plan starts with a **7-day free trial** (`TRIAL_DAYS` in `server/maxPlans.js`,
or `MAX_TRIAL_DAYS` on Render; `0` turns it off). The trial lives on the payment links:
`node scripts/create-max-plans.js --trial` (in the Render shell) puts it on the four existing
links in place, and the Plans page, the welcome email and the admin counts show it (status
`trialing`, with `max_plan_renews_at` the day the first payment is taken). The website's package buttons go straight
to Stripe through `/api/public/max/start?plan=&interval=` (it redirects to the payment link
set on Render). After checkout an existing account gets the "MAX is unlocked" email; an email
with no account gets a "create your account" email (`server/maxEmails.js`), and the plan attaches
itself when the account is made, by email or Google. A buyer who is not signed in lands on
`/max-welcome`, which reads the checkout (`/api/public/max/checkout?session_id=`) and says
"log in" or "create your account with you@…" — run
`node scripts/create-max-plans.js --redirect https://aiqs-portal.onrender.com` once so the links
pass the checkout id back. Entitlements come from `maxPlans.entitlements(user)`: **MAX** for an admin, a live
plan, early access or the rollout; **the Visualiser** only for an admin, the MAX + Visualiser plan
or a complimentary grant (`feature_overrides {"visualiser": true}`, Users → the client → MAX).
`/api/surveys/*` and `/api/max/*` need MAX; `POST …/render` additionally needs the Visualiser
(`403 VISUALISER_REQUIRED`). Inside the iOS app nothing is sold or priced (App Store rule 3.1.1):
the same pages show a neutral notice. Tests: `server/maxPlans.test.js`.

**AI Chat does not price.** Since the packages went live the older AI Chat (`/chat`,
`server/chat.js`) refuses any price, cost, estimate, quote, rate, budget or BOQ ask — and any
drawings uploaded to be measured — with a short reply pointing at MAX (or Submit Drawings for a
full take-off), with no model call and no message credit spent (`server/chatPricing.js`). Its
persona carries no rate library and no cost benchmarks and is told plainly never to give a
figure; the routes that priced a take-off and the Atlas pipeline answer `403 PRICING_MOVED`. The
chat page shows a MAX card under such a reply (or an "Ask MAX to price it" button for an account
that has MAX) and no longer runs Atlas on an upload. `CHAT_PRICING=1` on the server restores the
old behaviour, together with the matching flag at the top of `src/pages/ChatPage.js`. Tests:
`server/chatPricing.test.js`.

Rollout (`server/maxRollout.js`): **admins only by default**, plus any client an admin gives
early access (Users → the client → MAX) and any client with a live package. Admin → MAX switches
it on for everyone, live (the Visualiser still needs the package or a grant). The server is the
authority: `/api/max/*` answers `403 MAX_NOT_ENABLED` for anyone else. A client
MAX is on for can also use the estimator routes (`requireEstimator`), since MAX's estimates are
quotes. A per-client daily allowance (default 300 turns) is enforced and shown on
`GET /api/max/status`. Voice in, text out: inside the iOS app, talking to MAX and dictating
survey notes use the iPhone's own speech recogniser (`ios/App/App/SpeechPlugin.swift`, no key
needed); on the web a desktop browser's own recogniser is used, or the server's speech-to-text
when `OPENAI_API_KEY` or `DEEPGRAM_API_KEY` is set. MAX replies in writing only. Tests:
`server/max.test.js`.

## How-to videos

Written instructions are gone from the portal; in their place, short screen recordings of the
portal doing each thing. **How-to videos** (`/learn`, the menu entry) lists them with a progress
bar, a "watched" tick on each (a video ticks itself off when it finishes; the tick can be
undone), and **next steps** worked out from what the account has actually done — first drawings
not submitted yet, no job started, no rates, no logo — each with the page to do it on and the
video that shows it. The dashboard carries the same thing as a card (the next video to watch
and the top three steps; "Hide" puts it away), and the Jobs and Submit Drawings pages have a
**Watch how** button. The first time an account opens the portal after this went live (and a
new account's first dashboard), one card says the videos exist and offers the first; it is
recorded on the account the moment it shows (`POST /api/learn/intro/seen`), so it shows once and
never again, on any device. That card replaced the sign-in tour and the MAX showcase popup.

The catalogue and the next-step rules are `server/learn.js`; `GET /api/learn` returns the
videos with this account's ticks, the steps, the progress and the entitlements, and
`POST /api/learn/:key/watched` ticks one off (`video_views`). The files live in `videos/` at
the repo root — `<key>.mp4` (H.264, silent, captioned on screen) and `<key>.jpg` — served at
`/videos` by the server rather than bundled, so an app update stays small; drop in an mp4 with
the same name to replace one. Tests: `server/learn.test.js`.

## Jobs and room surveys — "Scan a room"

**New job** (`/jobs/new`; the **Jobs** menu entry, the dashboard chip, and where the old
`/surveys?new=1` links land) is three questions, one a screen: *where is it* (address, customer),
*what needs done* (typed or spoken; MAX prices this), and *draw up the floor plans?* The last
offers what the package allows — draw up the rooms, or draw them up **and show the finished
room** with the Visualiser (MAX + Visualiser only; a MAX-only account sees a one-line pointer to
the package on the website, nothing inside the iOS app), or no plans at all. Nothing is saved
until that answer. Plans: the job (a survey) and its first room are created, the brief goes in
as the room's *work wanted*, and the capture flow opens. No plans: `POST /api/surveys/:id/price`
has MAX price the job from the brief alone and the flow lands on the estimate, or on the
over-limit card. A job keeps its `brief`, whether the Visualiser was asked for (`visualise`),
and the estimate MAX made for the whole job (`estimate_id`). The job page shows the brief and a
**Price with MAX** button (the brief plus every measured room's quantities —
`describeJobForPricing` in `server/surveyGeometry.js`; MAX's `price_small_job` takes a
`survey_id` the same way, and `get_room_survey` returns the brief), and the survey report opens
with "What needs done".

**Scan a room** (`/surveys`, the Jobs list) is the site visit, kept. A survey is one
property; each room under it keeps everything the builder captured, for as long as the account
does: photographs (stored with thumbnails, captions and what the AI saw in each), the room's
shape and sizes with where they came from (*measured* by LiDAR, *stated* by the builder,
*estimated* from photos), doors, windows and openings on their walls, fittings and features,
finishes and their condition, hazards, condition notes, typed and spoken site notes, and what
the customer wants done. The quantities a pricer needs (floor, ceiling, net wall area,
perimeter, skirting, coving, volume, window area) are worked out live as the numbers change
and stored with the room (`server/surveyGeometry.js`, mirrored in `src/utils/surveyGeometry.js`).

On a phone the room page is a four-step capture flow — Photos, Size, Details, Work — then
Review; on a desktop it is one screen with the plan sketch, an orbitable 3D view, the
quantities and the actions pinned on the right. Everything autosaves. The photo tips, the
default door and window sizes and the quick chips are there so a room takes two minutes.

Three ways to a measured room: type the length, width and height (rectangular or L-shaped);
**Survey with AI** (`POST /api/surveys/rooms/:id/analyse`, `server/surveyVision.js`) which
reads the photos and fills in only what the builder has not already measured or typed; or
**Scan with LiDAR** in the iOS app (`ios/App/App/RoomScanPlugin.swift`, Apple RoomPlan, see
`docs/IOS_APP.md`) / **Import a scan** (a RoomPlan, Polycam or magicplan JSON export) which
locks the outline and marks it *measured*. A scanned room is drawn from the scan itself — every
wall where the scanner put it, doors and windows on the walls they were found in, the furniture
it saw — in the plan sketch, the 3D view and the report (`planFromCapture` / `sceneOf` in
`server/surveyGeometry.js`, mirrored on the client).

**Show the finished room** (`POST /api/surveys/rooms/:id/render`, `server/imageRender.js`) paints
the work the customer wants onto one of the room's photos with OpenAI's image model, keeping the
camera angle and the room's shape: new tiles, a new bath, the walls painted. The result is kept
with the room as a photo of kind `render` with a before/after slider, goes in the report marked
"AI concept, not to scale", and can be re-run with a tweak ("grey tiles, walk-in shower"). Needs
`OPENAI_API_KEY` (`OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY` optional). Each client gets a
monthly allowance (Admin → MAX, default 20; 0 switches it off), metered in `usage_log` as
`render` with a cost estimate.

**Price with MAX** hands the room to MAX's `price_small_job` tool with a quantities brief
("use these exactly … price only this"), so the estimate comes from the surveyed numbers and the
builder's rates; the same small-job limit and over-limit card apply, and the estimate is linked
back to the room. MAX can also read surveys in conversation (`list_room_surveys`,
`get_room_survey`). Exports per property: a branded **survey report PDF** (cover, a page per
room with the sketch, quantities, openings, features, finishes, notes and a photo grid), a
**schedule in Excel** (rooms, openings, features, finishes) and, for LiDAR scans, scaled
**floor plan PDFs**. **Send to the AI QS team** pre-fills Submit Drawings with the survey as the
brief.

Storage: `room_surveys`, `survey_rooms`, `survey_photos` in SQLite (every row carries
`user_id`); photo files under `<data dir>/room-surveys/`, served through signed, survey-scoped
link tokens so `<img>` tags work without a header. Routes: `server/roomSurveyRoutes.js`
(`/api/surveys/*`). Tests: `server/surveys.test.js`, `server/floorPlanGeometry.test.js`.

## Job tracking

Every job — portal submission or email enquiry — sits in one queue at one of
seven stages, with an owner, the date the enquiry actually arrived, a target
date and a permanent history. See **[JOB_TRACKING.md](JOB_TRACKING.md)** for
what each stage means, the daily routine, and how to read the queue.

## Countries (UK, Ireland, South Africa)

Every account has a country (`users.country` / `users.region`), asked at signup, on the
first onboarding screen, or by a one-off prompt for accounts that pre-date it. It drives
currency, VAT, the rate library and what the AI assumes. The rules live in
`server/lib/countries.js`.

- **South Africa** prices in ZAR at 15% VAT from the AI QS South Africa Rates Library
  (`server/rate-libraries/`). 109 UK rate keys map directly to SA library items
  (`za-map.json`). Every other key is the UK rate × a cost-parity factor (6.6, the median
  SA/UK ratio of the mapped pairs, checked by `countries.test.js`). Both are then × the
  region factor from the library's Regions sheet.
- **The job's address wins.** A South African place name prices in Rand for any
  account. A UK postcode prices in £ even for a South African account.
- **New library edition:** drop the `.xlsx` into `server/rate-libraries/` and run
  `node scripts/import-sa-rates.js server/rate-libraries/<file>.xlsx`.
- **Redo onboarding:** admins use *Users → Country & onboarding → Reset onboarding*. It
  can also set the country. Clients use the country button in the sidebar → *Redo
  onboarding*. Onboarding answers, and any personal rates in a different currency from
  the account's, are set aside (`is_active = 0`), not deleted.

## Onboarding and the trade rate sheet

New accounts go through a five-step onboarding (`/onboarding`, `src/pages/OnboardingPage.js`):
country and trade, **About your business**, **How you price**, **Your rate sheet**, then notes.
Everything the screens ask is defined once, server-side, in `server/tradeCatalog.js`, so the
screen, the stored submission (`onboarding_submissions`) and the admin download agree.

- **Questions** carry a `section`: `business` (experience, team, area, travel radius, who they
  work for, job size, quotes a month, specialisms, certifications) or `pricing` (day rate, how
  they price, who supplies materials, markup on materials, OH&P, contingency, payment terms,
  deposit, what a quote includes, quote validity, guarantee). Percentages are never prefilled:
  blank means nothing is added, which is what the pricer assumes.
- **The rate sheet** is grouped like a price list. Every trade, custom ones included, gets a
  *Labour* group derived from its day rate (hourly, half-day minimum, labourer, apprentice,
  weekend, call-out) and site trades get *Preliminaries & extras* (skip, waste, tower hire,
  travel). The 40 catalogue trades add their own groups — the jobs that trade prices every week,
  12–30 rows each, with a typical UK figure as a placeholder and a hint saying what the row
  covers (supply & fit vs labour only). Office trades (QS, architect) bill time and fees instead
  of prelims. Nothing is prefilled: a figure typed becomes the client's rate; a blank is not saved.
- **Where answers go.** Filled rows land in `client_rate_library` — universal rows under
  `labour` / `prelims`, trade rows under the trade's slug — so the chat prompt, the estimator and
  My Rates read them like any other client rate. Rows whose key matches the pricer's base library
  (`skip_hire_8yd`, `plasterboard_skim_walls`, `gas_boiler_combi`, …) are read straight by the
  deterministic pricer; keys are only reused where unit and scope match, because a client rate
  outside 0.1x–5x of the base is rejected as corrupt (`tradeCatalog.test.js` checks). Day rate,
  hourly rate and materials markup go to the playbook (`playbooks.setHouseRates`); OH&P and
  contingency to `setPricingPrefs`; every other answer becomes an onboarding memory.
- **Countries.** `server/onboardingLocale.js` asks a South African account in Rand with SA
  schemes: the day rate and the Labour group derive from the SA rates library, £ rows are
  converted at the parity factor, percentages are left alone, distances are in km.
- **Admin.** Completing onboarding raises a bell and email and the profile is downloadable from
  *Admin → Onboarding* as a spreadsheet, rate rows labelled by group in the account's currency.

## Rate alerts to the admin

The admin hears about a client's rates twice over, both as a bell notification and an
email to `ADMIN_EMAIL`:

- **First time** a client puts their own rates in (`server/rateOnboarding.js`,
  `markOwnRatesAdded`) — instant, so the rates can be pulled into the pricing brain.
- **Every change after that** (`server/rateChanges.js`) — a rate edited or added on My
  Rates, a rate deleted, an Excel or BOQ import, corrections made in chat, supplier quotes
  fed back, a rate sheet redone in onboarding. Changes are rolled up per client and sent
  once they have been quiet for 5 minutes (or 20 minutes after the first change), so a
  40-row import is one message: *"Jo Builder updated their rates — 3 rates updated · 1 rate
  added, via the My Rates page and an Excel import"*. Pending roll-ups live in
  `rate_change_digests`, so a deploy mid-edit loses nothing. Admin-side imports on a
  client's behalf never alert. Tests: `server/rateChanges.test.js`.

Both alerts link to **what actually changed**: the bell entry and the email button open
`/admin/users?user=<id>&show=rates` — user management with that client expanded and their
rate library open on a **Recent changes** list (`server/rateHistory.js`, served as `recent`
by `GET /api/admin/users/:id/rates`): every rate added, changed or removed in the last 30
days, newest first, with the value it replaced (from the correction log, else the seeded
default it overrides), how it was changed and what the client said. Tests:
`server/rateHistory.test.js`. Notifications carry an optional `link` column for this.

## Markup by trade, trade packages and canonical sections

Every priced BOQ line carries a **trade** (Electrical, Plumbing & Heating, Groundworks,
Brickwork & Blockwork, Carpentry & Joinery, Roofing, …) as well as its elemental section.
The trade is assigned deterministically by a keyword ladder in `server/deterministicPricer.js`
(`tradeForItem`: item key first, then description, then section; `TRADES` is the canonical
list). It drives three things:

- **Markup by trade.** `ohp_pct` (AI Memory → *Pricing margins*) is the default markup on
  every line; `trade_markup` (`{ 'Electrical': 10, 'Plumbing & Heating': 10 }`) overrides it
  for those packages only. Both live in the client playbook (`playbooks.getPricingPrefs`)
  and reach the pricer through `options.trade_markup` at every call site. OH&P becomes the
  sum over the lines; contingency stays on the construction total and VAT on the lot.
  `summary.markup_by_trade`, `summary.ohp_effective_pct`, `summary.trades` and each
  section's `markup` / `total_with_markup` describe the result. API: `GET/PUT /api/pricing-prefs`
  (`trade_markup` is the whole map, or `null` to clear; the GET also returns `trades`).
- **Live BOQ.** Under the bare-cost lines, `BoqTable` shows *Totals with markup & trade
  packages*: each section's total once markup is on (titles only), then the same lines grouped
  by trade with an editable markup % per trade. Edits save to the pricing preferences and
  re-price on the spot, so they apply to every later BOQ and export too.
- **Excel BOQ.** `boqGenerator` prints the OH&P row as the summed figure with the blended
  rate in the label when markup varies by trade, then a reference-only *Section totals with
  markup* block and a *Trade packages* block (labour / materials / bare cost / markup / with
  markup per trade). Reference rows carry no unit/qty/rate, so `recalcGate` and
  `preIssueGate` ignore them and `parseBOQ` stops at the "shown for reference" wording.

**Builder Pack.** A parsed bill (the Builder Pack's data source) gets the same treatment
in `server/boqTrades.js`: every line is tagged by description + section title, each section
named by its dominant trade, and `GET /projects/:id/builder-breakdown` returns `trade` per
section/line, `by_trade`, the owner's `pricing_prefs` and a `trade_seed` (the per-section
uplift the markup-by-trade implies). The page pre-fills *Per-trade uplift override* from it on
a first visit (a saved state wins afterwards; "Fill from my trade markups" re-applies it), shows
each section's trade, and the Builder tab and the Builder Pack xlsx's Trade Summary carry a
*By trade package* table. The "Update this bill" assistant accepts `controls.trade_markup`
("10% on the electrician and plumber"), `section_uplift` and `remember_trade_markup`, which the
page saves to the pricing preferences on Apply.

**Provisional sums and optional extras: below the total, never in it.** `parseBOQ` reads a
provisional-sums block wherever the bill prints it — including after the summary, under a heading
such as *L PROVISIONAL SUMS (at cost, excluded from the total above)* — as its own section
(`provisional: true`). Every bill on the Builder Pack page also carries an *Optional extras*
section (`optional: true`, number `OE`): empty until the builder adds the work the client can
choose to take, and printed only when it has lines. Both kinds are carried at face value — no
OH&P, contingency, prelims % or builder margin — and sit **below** the total as their own
elements, so the figure the client reads as the total is the construction cost alone. The client
copy (xlsx, on-screen preview and the shared quote's totals) reads *Net construction cost → Total
(excl. VAT) → VAT → Total (incl. VAT)*, then a *Not included in the total above* block: *Provisional
sums*, its own VAT line and incl.-VAT figure, then *Optional extras* the same way; the masthead
says what is not in the headline. The Builder Pack's Trade Summary prints the priced sections and
*GRAND TOTAL — net construction*, then each block at cost closed by its own total (*TOTAL
PROVISIONAL SUMS*, *TOTAL OPTIONAL EXTRAS*); the by-trade table carries them as memo rows after
*ALL TRADES* (which equals the grand total); every line is on its own *Provisional Sums* / *Optional
Extras* tab, and nothing from either reaches the materials or labour schedules. Only the block's
own closing total (*Total provisional sums*, *Provisional sums total …*) ends a parsed PS block,
and that row is never a document total; a block that cannot be itemised falls back to the flat
`provisional_sum` lump, shown the same way. The "Update this bill" assistant adds to the optional
section by its `section_number`, can create one with `new_sections[].optional`, and refuses to
uplift either kind. A Builder Pack working state saved before the block was read gets it back on
the next open (`addMissingProvisionalSections`), the user's own edits untouched.

**Same layout every time.** Section titles from the model ("1. Substructure & Foundations",
"SUBSTRUCTURE", "Substructure") normalise to one canonical name (`canonicalSectionName`,
16 names ending with Provisional Sums) and print in the standard elemental order
(`orderSections`). A title that matches nothing keeps its own name and stays where it
arrived, so room-by-room reinstatement bills keep their running order. Tests:
`server/tradePackages.test.js`, `server/pricingPrefs.test.js`, `server/boqGenerator.test.js`.

## Deployed on Render

### Environment Variables
- `JWT_SECRET` — Any random secret string
- `NODE_ENV` — `production`
- `PORT` — `5000`
- `VOYAGE_API_KEY` — optional; enables semantic memory retrieval (falls back to FTS keyword search if unset).
- `ENABLE_WEB_SEARCH` — optional; the chat uses Anthropic's live `web_search` tool by default. Set to `0` to disable it (e.g. to avoid per-search billing).
- `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` — optional; enable the native "Connect with Xero" button on the Money page (see **Native Xero connection** below). Unset = the button is hidden and only the CSV export shows.
- `XERO_REDIRECT_URI` — optional; defaults to `${PORTAL_BASE_URL}/api/xero/callback`. Must match the redirect URI registered on the Xero app exactly.

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

### Stripe wiring

Office in a Box is sold as the AI Trades Pilot **Unlimited** plan
(£199/month, unlimited AI QS jobs; the £249 Bundle also unlocks it — legacy
£100/month subscribers are grandfathered). The paywall opens the Payment Link
in `REACT_APP_OFFICE_PAYMENT_LINK`; the webhook flips `has_estimator` on any
subscription matching `STRIPE_OFFICE_PRICE_IDS` (or the £100/£199/£249 amount
fallback). See PRICING_RESTRUCTURE.md in the aitradespilot repo for the full
runbook.

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

> **Retired from the portal UI** (November 2026): the Variations button on the project page, the
> `/variations` hub and `/project/:id/variations` are gone (old links redirect). The customer
> approval page `/v/:token` and the API below still work for variations already sent.

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

## Native Xero connection

Alongside the CSV export (`server/accountingExport.js`), builders can connect
their own Xero organisation with one button and push invoices straight in over
the Xero API — no file to import. It reuses the same OAuth2 pattern as the Google
sign-in flow.

- **Server:** `server/xeroClient.js` (OAuth2, token storage/refresh, tax mapping,
  invoice push) and `server/xeroRoutes.js` (mounted at `/api/xero`).
  - `POST /api/xero/connect` → returns the Xero authorize URL. The builder's
    identity is carried in a signed `state` JWT so the public callback can trust
    it (the callback has no Bearer token — it's a browser redirect from Xero).
  - `GET  /api/xero/callback` → swaps the code for tokens, records which org
    (tenant) was shared, redirects back to `/money?xero=connected`.
  - `GET  /api/xero/status` → `{ configured, connected, tenant_name }`.
  - `POST /api/xero/push` (or `/push/:invoiceId`) → creates `AUTHORISED` sales
    invoices for every `sent`/`paid` invoice not yet in Xero. Idempotent: the
    created Xero `InvoiceID` is stored on `invoices.xero_invoice_id`, so tapping
    again never duplicates.
  - `POST /api/xero/disconnect` → clears the stored tokens.
- **Tokens** live per-builder in `oib_settings` (`xero_access_token`,
  `xero_refresh_token`, `xero_token_expiry`, `xero_tenant_id`,
  `xero_tenant_name`, `xero_connected_at`). Access tokens last 30 min and the
  refresh token **rotates on every refresh** — both are re-saved each time.
- **VAT / CIS:** tax types are never hard-coded. On push we read the connected
  org's own `TaxRates` and match by rate (20% / 5% / zero-rated) or by name for
  the CIS domestic reverse charge, then fall back to the account's default tax
  rate if the org has no matching rate. This keeps VAT correct across orgs where
  custom rates are numbered `TAX001`, `TAX002`…
- **Setup:** register a Xero app (free) → set `XERO_CLIENT_ID` /
  `XERO_CLIENT_SECRET`, add `${PORTAL_BASE_URL}/api/xero/callback` as the app's
  redirect URI. With the env vars unset the button is hidden and only the CSV
  export shows.
- **Scope of v1:** pushes sales invoices (builder → Xero). Payment
  reconciliation and contact matching against existing Xero contacts are natural
  follow-ups. The payments CSV still covers reconciliation in the meantime.

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

- Client login / approval portal for issued quotes (will be revisited in Wave 4).
- Bulk import of historical rates per user (`client_rate_library` is already there
  but isn't yet consulted by the estimator — easy follow-up).

## Retired

- **3D Builder** (`/builder3d`, `server/builder3d*.js`) and **Super Brain** (`/super-brain`,
  `server/superBrain*.js`) were removed in November 2026. The shared-key account link with
  AI Trades Pilot (`server/partnerRoutes.js`, `SUPER_BRAIN_KEY`) stays.

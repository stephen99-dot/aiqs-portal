# App Store listing copy — AI QS Quantity Surveying

Paste-ready text for App Store Connect → iOS App → 1.0. Character limits
are Apple's. Edit freely; keep claims to what the app does today.

| Field | Limit | Text |
|---|---|---|
| Name | 30 | AI QS Quantity Surveying |
| Subtitle | 30 | BOQs from your drawings |
| Promotional text | 170 | Send drawings from site, track every job and get a QS-checked Bill of Quantities back in your pocket — typically within 24 hours. |
| Keywords | 100 | quantity surveyor,BOQ,bill of quantities,estimating,builder,construction,takeoff,tender,pricing,QS |
| Support URL | | https://theaiqs.co.uk/contact |
| Marketing URL | | https://theaiqs.co.uk |
| Privacy Policy URL | | https://theaiqs.co.uk/privacy (page must exist) |
| Copyright | | 2026 The AI QS |
| Primary category | | Business |
| Secondary category | | Productivity |
| Age rating | | 4+ (answer "None" throughout) |

## Description (4000 max)

AI QS is the customer portal for The AI QS, the quantity surveying service for
builders, developers and trades across the UK, Ireland and South Africa.

SUBMIT DRAWINGS FROM ANYWHERE
Photograph plans on site or upload PDFs, DWG/DXF and spreadsheets straight from
your phone. Add a brief, pick the project type and send. Your submission goes
directly to our QS team — no email chains.

GET A PROFESSIONAL BILL OF QUANTITIES
A fully priced BOQ and a Findings Report land back in the app, typically within
24 hours, priced with current rates for your region and, once you add them,
with your own rates.

TRACK EVERY JOB
See where each job is — received, in progress, delivered — with the documents
attached. Open, save or share BOQs, findings and client copies from the app.

MAKE IT YOURS
Add your own rates, your logo and your brand colours. Produce a Builder Pack
with your margins applied and a Client Copy ready to send on.

ASK THE AI
Sense-check costs, extract quantities, flag risks or ask a building regulations
question in the AI chat, which learns how you price as you go.

AI QS works with your existing AI QS account. New here? Create an account in
the app and start with your first project.

## App Review notes

Apple's first response to 1.0 was the standard "we need additional information"
letter: a screen recording from a physical device plus six written items. The
text below answers it; fill in the video link and demo credentials, paste the
whole thing into App Review Information → Notes, and resubmit.

```
1. SCREEN RECORDING
<link> — recorded on an iPhone 17 Pro Max on the current iOS. It shows: launching
the app, creating a new account, the onboarding questions, the dashboard, deleting
that account (menu → Delete account), then signing in with the demo account,
submitting drawings from the photo library with a brief, the project list, opening
a project and saving a BOQ through the share sheet, and asking the AI chat a question.

2. PURPOSE AND AUDIENCE
AI QS is the customer app for The AI QS, a UK quantity surveying service
(theaiqs.co.uk). Builders, developers, tradespeople and homeowners send construction
drawings and get back a priced Bill of Quantities and a Findings Report, prepared by
our quantity surveyors with AI assistance, typically within 24 hours. The app lets
customers submit drawings from site, track each job, read and share the documents,
keep their own rates, logo and branding, and ask construction-costing questions in an
AI chat. Anyone can register: it is a public, self-serve service, not an internal or
enterprise tool, and the same account works on our website.

3. SETUP AND ACCESS
Demo account (customer): <email> / <password>. It already holds a completed project:
My Projects → open the project → Documents. Nothing needs generating during review.
To try a submission: Submit Drawings → add any PDF or photo → Submit. Submissions go
to our QS team and are priced by people, so no document is produced during the review
session. Account deletion: main menu (☰) → Delete account → confirm with the password.
There is one account type for customers; admin accounts are staff-only and not needed
for review. This version has no in-app purchases; credits already on an account are
shown and used.

4. EXTERNAL SERVICES
- Our own API and database, hosted on Render (aiqs-portal.onrender.com)
- Anthropic (Claude API) and Voyage AI: the AI chat, drawing analysis, memory retrieval
- SendGrid / SMTP: transactional email (job updates, magic links, receipts)
- Stripe: payments on our website only; nothing in the app links to it
- Google Sign-In: offered on the website only; the app uses email/password and magic links
- Xero: optional accounting connection, website only
- Trustpilot: our public reviews, shown on the sign-in page
- postcodes.io and PlanIt: UK postcode lookup and public planning-application data
- Public builders' merchant websites (Travis Perkins, Screwfix, Wickes, Jewson,
  Toolstation, Selco, B&Q, MKM): current material prices read on a schedule by our server
- Pipedream: internal workflow automation (webhooks)
- WhatsApp: a contact button that opens the WhatsApp app with our business number

5. REGIONAL DIFFERENCES
The app functions identically in every region. The account's country (UK, Ireland or
South Africa) sets the currency (£, €, R), the VAT rate and the rate library used for
pricing; the features and screens are the same everywhere.

6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
Quantity surveying is not a licensed or regulated activity in the UK, Ireland or South
Africa, and the app contains no protected third-party material. All content is produced
by us or uploaded by the account holder for their own use.
```

### Recording the video (on the phone)

Install the build from TestFlight first (not the Xcode debug build). Settings →
Control Centre → add Screen Recording if it is not there. Swipe down, tap the
record button, go to the home screen, then:

1. Launch AI QS → Create one → register a throwaway account → onboarding (a few
   answers, Skip the rest) → dashboard.
2. Menu (☰) → Delete account → password → confirm → back at sign-in.
3. Sign in with the demo account → Submit Drawings → add a photo from the library
   and a one-line brief → Submit → My Projects shows it.
4. Open the finished project → Documents → tap a BOQ → share sheet → Save to Files.
5. AI Chat → ask one question → wait for the reply.
6. Stop recording. Trim nothing; 3–5 minutes is fine.

Upload the video to Google Drive, Dropbox or YouTube (unlisted), set it to
"anyone with the link", and paste the link into item 1. The Attachment field on
the same page also accepts the file directly.

## Screenshots

Mandatory slot: "iPhone with Dynamic Island (medium display)", 1206 × 2622
portrait. Xcode Simulator → iPhone 17 Pro → ⌘S saves at exactly this size
(Pro Max screenshots are rejected). Take, in order:

1. My Projects (signed in, a few jobs with "docs ready" badges)
2. Submit Drawings
3. A project page with documents
4. Builder Pack line items
5. AI Chat
6. Sign-in

Optional: the same six on an iPhone Duo simulator, once your Xcode has one, for
the "made for iPhone Duo" badge.

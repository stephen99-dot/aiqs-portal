# AI QS Portal — Product Spec

A short, opinionated spec for what this portal is and isn't. Future changes
should be measured against it. If a feature doesn't fit one of these jobs,
it doesn't ship to the main flow — it lives behind "More" or gets cut.

## Who it's for

Two people, two views of the same data:

- **Builder / customer.** Submits drawings, gets a priced BOQ back, generates
  client copies for their own client. They don't want to think about the
  portal's structure — they want to drop files and get docs.
- **QS team / admin.** Sees every submission, prices the job, sends documents
  back. They don't want to hunt for things — every customer action should
  surface as a single inbox row that takes them through the next step.

That's it. No third persona. Anything aimed at "future API consumers",
"sub-contractors with their own login", etc. is out of scope until those
two views are clean.

## Canonical job lifecycle

Every piece of work in the portal is a **Job**, and every job is in exactly
one of these states. The state is the source of truth for what the user
sees and what action is available next.

```
1. NEW BRIEF        Customer has submitted drawings + brief.        (Customer-side: "Submitted, awaiting QS")
                    Admin needs to read it.                          (Admin-side: shows in inbox, top of list)

2. IN REVIEW        Admin has opened it; not yet priced.             (Customer: "Your QS is reviewing")
                                                                    (Admin: "Continue review" CTA)

3. PRICING          Admin is producing the BOQ / Findings.           (Customer: "Being priced")
                                                                    (Admin: "Upload priced docs" CTA)

4. DELIVERED        Priced docs uploaded to the customer's portal.   (Customer: "Documents ready" + downloads)
                                                                    (Admin: greyed out — done)

5. CLOSED           Customer has acknowledged / job finished.        (Hidden from the main flow.)
```

Variations and revisions don't create new states — they create new versions
of the deliverables on an existing job. A v2 BOQ moves the job back to
PRICING in the admin view, then forward to DELIVERED, and the customer
sees both versions.

## Routing rule: "auto-take to next step"

The portal should never make the user pick between five sidebar entries.
After login it routes them based on their role and where the work is:

- **Customer login** → home page lists their jobs, each row showing the
  current state and the *one* button that matters at this state. Clicking
  a job goes straight to the relevant page (the deliverables on a
  DELIVERED job; the submission tracker on NEW BRIEF, etc.).
- **Admin login** → home page is the inbox. Each unactioned submission
  is a row. Clicking a row takes them to whichever step is next:
  NEW BRIEF → review page; IN REVIEW → review page (resume); PRICING →
  upload page. After upload, they're routed back to the inbox with
  the row marked done.

A floating "What's next" CTA sits at the top of every other page so they
can jump back into the flow from rate libraries, AI memory etc.

## Pages — what earns one

A feature gets its own page only if it's a **destination** in the
job lifecycle, or it's a **library** the user opens by choice. Everything
else is a panel inside one of those pages.

### Destination pages (tied to the lifecycle)

- `/` — Home. Inbox for admins, jobs list for customers. The whole flow
  starts and returns here.
- `/job/:id/brief` — Read-the-brief page. Full message, files (with Drive
  link), customer contact, "Mark as in review" / "Mark as priced" actions,
  private notes. Admin only.
- `/job/:id/upload` — Upload priced documents. Drag-drop, kind picker,
  customer-visible note. Versioned. Admin only. Replaces the current
  embedded deliverables uploader.
- `/job/:id` — Customer-side job page. Shows the brief they submitted,
  current state, downloads of any delivered docs, link to Builder Pack
  if available. The same URL admins land on in read-only when reviewing.
- `/job/:id/builder-pack` — Builder Pack & Client Copy workspace.
  Customer-only (or admin-as-customer when previewing).
- `/submit` — New job intake. Replaces the "Submit Drawings" page name.

### Library pages (opened by choice)

- `/rates` — My Rates. Reference data, edited rarely.
- `/memory` — AI Memory. Same.
- `/chat` — Chat with the QS AI for one-off questions outside the
  job flow.

### Behind a "More" menu (rarely needed; flat sidebar lists 3-4 items)

- Variations hub
- Notetaker
- Admin: users, activity log
- Settings, billing, sign out

The current "Pipeline", "Clients", standalone "Variations" page,
"Submissions Inbox" tab, "Completed Projects" tab — these are *all*
collapsed into the home page.

## Vocabulary cleanup

Pick one word and use it everywhere:

| Use            | Don't use                                          |
| -------------- | -------------------------------------------------- |
| **Job**        | project, submission, drawing submission, BOQ order |
| **Brief**      | description, message, project details              |
| **Deliverable**| document, output, BOQ pack, client copy            |
| **Customer**   | client, builder, user                              |
| **Admin / QS** | quantity surveyor, surveyor, staff, you            |

`projects`, `drawing_submissions`, and `project_deliverables` stay as
DB tables — but the UI never says "submission" or "project". It says "job".

## What's currently TESTING / BETA

The Builder Pack workspace, the Client Copy Pro generator, and the
deliverables upload flow are still test surfaces. Everything else
(brief intake, projects table, chat, rates, memory) is production.

The TESTING strip stays on every page until a human ships v1 sign-off.

## What's *not* in scope

- A separate sub-contractor login.
- In-portal payment for variations.
- Project messaging / comments threads (use the brief notes + email).
- Invoice / accounting integration.
- Multi-tenant / white-label.

If one of these becomes important, it gets a new spec — not bolted on.

## How to use this spec

When making any change to the portal:

1. **Does it fit one of the lifecycle states above?** If not, push back
   on the change before writing code.
2. **Does it earn a new page?** Only if it's a destination or a library.
   Otherwise it's a panel inside an existing page.
3. **Does it use the canonical vocabulary?** If a PR introduces "BOQ
   order" or "submission" in a UI string, fix it.
4. **Is the next action obvious without reading the sidebar?** If the
   user has to think "where do I click", the routing is wrong.

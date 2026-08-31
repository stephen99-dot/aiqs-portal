# Job tracking

How work gets tracked from the moment an enquiry lands to the moment documents
go back out, whichever door it came in through.

Everything lives on one page: **Job Queue** (`/submissions`, admin only). There
is no second list, no spreadsheet, and no "email jobs are handled differently".

## The problem this replaces

The queue used to have one flag: actioned, or not. That could not answer either
question the office actually asks.

- **Email jobs were invisible.** A job added by hand was written straight to
  "actioned", so it never appeared in anybody's to-do list. Half the work was
  off the board.
- **The clock was wrong.** Waiting time was measured from when a job was typed
  into the portal, not when the enquiry arrived — so a week-old email showed as
  new. Exactly the figure that hides a backlog.
- **There was no middle.** A job was untouched or finished. Nothing recorded
  that a take-off was half done, or who was doing it.
- **Nothing was remembered.** The notes field was overwritten each time, so a
  job could say what somebody thought now but never what had happened.

## Stages

Defined once in `server/jobStages.js` and sent to the page with the data, so
renaming a stage changes it everywhere. Each one is a thing somebody does:

| Stage | Means |
| --- | --- |
| **New** | Arrived. Nobody has picked it up. |
| **Checking drawings** | Confirming the drawings are readable, scaled and complete. Chase the customer here. |
| **Take-off** | Quantities being measured. |
| **Pricing** | Rates applied, BOQ built. |
| **Final check** | Priced BOQ checked before it goes out. |
| **Delivered** | Documents sent. Nothing left to do. |
| **On hold** | Waiting on the customer. Still ours, but the clock is not on us. |

Moving a job off **New** marks it as picked up and assigns it to whoever moved
it, unless somebody already owns it. Nothing extra to remember.

## For whoever is running jobs

**Every morning, work the queue top down.** It is ordered by how long each job
has been waiting, so the top of the list is the most overdue customer.

1. **Open** — everything not yet delivered. This is the real to-do list.
2. **Mine** — the jobs assigned to you.
3. **Late** — past the target date. These come first.

**When an email enquiry comes in, log it straight away** with **+ Log a job**.
Two fields matter:

- **Came in by** — email or phone.
- **Enquiry arrived on** — *the date the email actually landed, not today.*
  Every waiting time and late flag is measured from this. If you are catching
  up on a week's backlog, set the real dates or the queue will look healthy
  when it is not.

It then joins the same queue at the same stage as a portal submission. There is
nowhere else to record it.

**Move the stage as you go, not at the end.** One click. It is the only way the
job is truthful between started and finished, and it is what lets somebody else
pick the job up if you are off.

**Put anything worth remembering in History**, not just the working notes box.
Working notes get overwritten; History is dated, attributed and permanent —
"chased for the section drawing", "customer says hold until survey". That is
what makes a hand-over possible without a phone call.

**Use On hold when you are waiting on the customer** rather than leaving it in
Take-off. On-hold jobs never show as late, because the delay is not ours.

## For the owner

The six tiles at the top of the Job Queue are the whole picture:

- **Not started** — arrived, nobody has touched it. Should be near zero by the
  end of each day.
- **In progress** — actively being worked.
- **Past target date** — late. The number to act on.
- **On hold** — parked on the customer. Worth scanning weekly; jobs die here.
- **Longest wait** — the worst-served customer right now, in days. This is the
  single most useful number on the page.
- **Nobody assigned** — open work with no owner. Anything above zero is work
  that will not get done by itself.

Click any stage tab to see exactly which jobs sit there. Open a job and the
History pane shows everything that has happened to it, in order, with who did
it — no need to ask.

## Turnaround target

Every job gets a target date set automatically: **3 days from when the enquiry
arrived**. Change it with the `JOB_TURNAROUND_DAYS` environment variable, or
per job on the job itself. A job with no target date can never be reported as
late, which is why every job gets one.

## Where the code lives

| File | Does |
| --- | --- |
| `server/jobStages.js` | The stage and source vocabularies, and the turnaround rule. Single source of truth. |
| `server/jobTracker.js` | The event trail, the waiting/overdue maths, and the queue summary. |
| `server/jobTracker.test.js` | Covers the ageing and summary maths, including the timezone trap in SQLite timestamps. |
| `server/submissionRoutes.js` | The API: intake, stage moves, hand-overs, history. |
| `src/pages/SubmissionsInboxPage.js` | The Job Queue page. |

Existing jobs are migrated on first boot: delivered ones land in **Delivered**,
everything else in **New**, with waiting time backfilled from the date the row
was created.

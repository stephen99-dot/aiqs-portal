/**
 * qualifications.js — the risk & qualifications pass (brief §7, and §5.2).
 *
 * The brief calls this "the highest-value single addition to the product", and
 * nothing in the pipeline attempted it. Three things happen here:
 *
 * 1. DEFERRAL COUNT (§5.2). Every "refer to structural engineer", "to be
 *    confirmed", "assumed", "check on site". One three-sheet domestic pack
 *    deferred nine times. The COUNT ITSELF is the argument for a provisional-sum
 *    schedule, and it is the single most persuasive paragraph in the report.
 *
 * 2. NAMED PROVISIONAL SUMS (§7.1). An engineer's assumptions panel is a
 *    provisional sum schedule, not a disclaimer: "existing foundations ASSUMED,
 *    to be verified, ALLOW FOR underpinning" is an instruction to price.
 *
 * 3. THE QUALIFICATIONS BLOCK (§7.3), which belongs on the FACE OF THE BILL. A
 *    covering letter does not travel with the spreadsheet into the main
 *    contractor's cost plan.
 */

// Language that defers a decision to someone else, later. Each carries what it
// implies commercially, because a bare count is less useful than a reason.
const DEFERRAL_PATTERNS = [
  { re: /refer to (the )?(structural )?engineer/gi, kind: 'referred to the engineer' },
  { re: /\bto be confirmed\b|\bTBC\b/g, kind: 'to be confirmed' },
  { re: /\bassumed\b|\bassumption\b/gi, kind: 'assumed' },
  { re: /check on site|verify on site|subject to survey/gi, kind: 'to be verified on site' },
  { re: /\bsubject to\b/gi, kind: 'subject to a later event' },
  { re: /by others\b/gi, kind: 'by others' },
  { re: /\bif required\b|\bwhere required\b/gi, kind: 'conditional' },
  { re: /provisional(ly)?\b/gi, kind: 'provisional' },
];

// Phrases in a calculation that state, on its face, that something was not
// checked. On one job the highest-utilised beam in the pack carried this.
const UNCHECKED_PATTERNS = [
  /has not been checked/gi,
  /not been checked/gi,
  /\bnot checked\b/gi,
  /no check (has been )?(carried out|made)/gi,
];

// An assumption panel that is really an instruction to price.
const PRICEABLE_ASSUMPTION = /\b(assum\w+|presum\w+)\b[^.]{0,120}?\b(allow(ing|ance)? for|allow\b|verify|to be verified|if not|otherwise)\b/gi;

function countMatches(text, re) {
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

/**
 * Scan the drawing/spec text for deferrals and unchecked statements.
 * @param {string|string[]} documentText
 */
function scanDeferrals(documentText) {
  const text = Array.isArray(documentText) ? documentText.join('\n') : String(documentText || '');
  const byKind = [];
  let total = 0;
  for (const p of DEFERRAL_PATTERNS) {
    const n = countMatches(text, p.re);
    if (n > 0) { byKind.push({ kind: p.kind, count: n }); total += n; }
  }
  const unchecked = UNCHECKED_PATTERNS.reduce((a, re) => a + countMatches(text, re), 0);

  const priceable = [];
  let m;
  const re = new RegExp(PRICEABLE_ASSUMPTION.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    priceable.push(m[0].replace(/\s+/g, ' ').trim().slice(0, 180));
    if (priceable.length >= 20) break;
  }

  byKind.sort((a, b) => b.count - a.count);

  const argument = total === 0 ? null
    : `The information deferred ${total} decision${total === 1 ? '' : 's'} to a later date or another party`
      + (byKind.length ? ` (${byKind.slice(0, 4).map((k) => `${k.count} ${k.kind}`).join(', ')})` : '')
      + '. Each of those is a cost that cannot be measured at tender, which is what a provisional-sum schedule is for.';

  return { total, byKind, unchecked, priceableAssumptions: priceable, argument };
}

// The nine qualifications that cover a stage-3 sub-contract offer (§7.3).
// Number 5 is the one most often left out and the most valuable.
function buildQualifications(job = {}) {
  const rev = job.informationRevision || '[revision]';
  const date = job.informationDate || '[date]';
  const validityDays = job.validityDays || 30;
  const weeks = job.programmeWeeks;
  const ohpPct = job.ohpPct;

  return [
    `STATUS. This is a budget offer prepared on the information listed above at revision ${rev} dated ${date}, and is subject to re-measurement at construction issue.`,
    'ASSUMPTIONS. The items listed in the Assumptions schedule are priced on stated assumptions. Each will move when the assumption is settled, and the schedule states in which direction.',
    `VALIDITY. This offer is open for ${validityDays} days.${job.volatileMaterials ? ` Prices are fixed except for ${job.volatileMaterials}, which are the materials most exposed to movement.` : ''}`,
    weeks
      ? `PROGRAMME. The offer is built on a ${weeks}-week programme derived from the priced labour. Time-related preliminaries adjust at the weekly rate stated in the Preliminaries section if that duration changes.`
      : 'PROGRAMME. Time-related preliminaries adjust at the weekly rate stated in the Preliminaries section if the programme changes.',
    'SUB-CONTRACT TERMS. Where no form of sub-contract has been issued, this offer assumes: payment 30 days from the date of application; retention capped at 3% with half released at practical completion; no liquidated damages; and design liability limited to the level of professional indemnity insurance stated, which is what drives that premium.',
    ohpPct != null
      ? `OVERHEADS AND PROFIT are recovered in one line at ${ohpPct}% with no margin carried in any rate. Contingency is excluded.`
      : 'OVERHEADS AND PROFIT are recovered in one line with no margin carried in any rate. Contingency is excluded.',
    `VAT. ${job.vatBasis || 'The VAT position is stated in the summary'} and is to be confirmed in writing before the first application.`,
    'ATTENDANCES. Every attendance not ticked to the main contractor in the Schedule of Attendances has been priced within the Preliminaries, and the Schedule itself is returned at NIL.',
    job.excludedSections && job.excludedSections.length
      ? `EXCLUSIONS. The following are excluded from the tender sum: ${job.excludedSections.join('; ')}.`
      : 'EXCLUSIONS. Sections marked NIL in the bill are excluded from the tender sum for the reason stated against each.',
  ];
}

/**
 * An exclusion is only a statement if it is VISIBLE (§7.2). A group that
 * returns NIL with a note under it is a statement; a group that is simply
 * absent is a gap — and a competitor who priced it looks dearer for no reason.
 */
function buildNilExclusions(exclusions = []) {
  return exclusions.map((e) => ({
    ref: e.ref || '', description: e.description || e.item || '',
    total: 0,
    note: e.reason || 'Excluded — see qualifications.',
  }));
}

module.exports = { scanDeferrals, buildQualifications, buildNilExclusions, DEFERRAL_PATTERNS };

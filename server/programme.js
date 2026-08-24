/**
 * programme.js — derive the programme from the priced labour (brief §8).
 *
 * Programme, prelims and crew were not derived from the priced labour, so
 * time-related costs went stale after every correction. This runs from the
 * labour figures and must be RE-RUN AS THE LAST STEP after any change, scope
 * or rate — it is the item most often left stale.
 *
 * Two rules do most of the work, and both come from jobs where the arithmetic
 * answer was unbuildable:
 *
 *   - Strip site management out before computing the crew. On one job 1,167
 *     operative-days at £249 included 62 days of management; stripping it gave
 *     exactly the 44 weeks the prelims were priced over. Publishing the strip is
 *     what makes the crew figure believable.
 *   - Cap the crew by the PHYSICAL constraint, not by arithmetic. Two rooms of
 *     10.6 and 2.8 m2 will not take more than about three trades at once, so a
 *     crew of 4.1 is unbuildable and the time-related prelims are simply
 *     missing. A single front door on a 91.5 m2 house caps it near 3.7.
 */

// Work that cannot be accelerated by adding people: the cure and sequence rules
// set the duration, and the only honest answer is to say so.
const SEQUENCE_BOUND = [
  {
    id: 'underpinning',
    re: /underpin/i,
    // Two pits open, 24 hr cure, 48 hr before the adjacent bay = 2 bays per 4
    // working days.
    baysPerWorkingDay: 2 / 4,
    note: 'Underpinning runs at two pits open, 24 hr cure and 48 hr before the adjacent bay — about 2 bays per 4 working days. Adding men cannot shorten it.',
  },
  {
    id: 'party_wall_foundation',
    re: /hit[- ]and[- ]miss|party wall foundation/i,
    baysPerWorkingDay: 1 / 2,
    note: 'Hit-and-miss party wall foundations run on a Day 1/3/5 cycle. Adding men cannot shorten it.',
  },
];

// Site management / supervision is a time-related cost, not productive labour,
// and must come out before the crew is derived.
const MANAGEMENT_RE = /site manage|supervis|project manage|general attendance|non[- ]working/i;

const WORKING_DAYS_PER_WEEK = 5;

// CDM: over 500 person-days the project is notifiable and an F10 must be filed
// before construction starts. The count is free once the programme is derived.
const CDM_NOTIFIABLE_PERSON_DAYS = 500;

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

/**
 * @param {Array}  sections priced sections
 * @param {object} opts
 *   dayRate           blended single-operative day rate (default 250)
 *   crewCap           physical maximum trades on site at once — pass it when
 *                     the job's geometry constrains it (a single access, two
 *                     small rooms). Without it the crew is arithmetic only.
 *   crewCapReason     why the cap applies, published alongside the figure
 *   domesticClient    true for a domestic-client project (CDM duties note)
 */
function deriveProgramme(sections, opts = {}) {
  const dayRate = num(opts.dayRate) > 0 ? num(opts.dayRate) : 250;

  let productiveLabour = 0;
  let managementLabour = 0;
  const sequenceNotes = [];
  let sequenceBoundDays = 0;

  for (const section of sections || []) {
    for (const item of (section.items || [])) {
      const labour = num(item.labour);
      if (!labour) continue;
      const desc = String(item.description || '');
      if (MANAGEMENT_RE.test(desc)) { managementLabour += labour; continue; }
      productiveLabour += labour;

      for (const rule of SEQUENCE_BOUND) {
        if (!rule.re.test(desc)) continue;
        const bays = num(item.qty) || 0;
        if (bays <= 0) continue;
        const days = bays / rule.baysPerWorkingDay;
        if (days > sequenceBoundDays) sequenceBoundDays = days;
        if (!sequenceNotes.some((n) => n.id === rule.id)) {
          sequenceNotes.push({
            id: rule.id, note: rule.note,
            bays, workingDays: Math.ceil(days),
            weeks: Math.ceil(days / WORKING_DAYS_PER_WEEK),
          });
        }
      }
    }
  }

  const operativeDays = productiveLabour / dayRate;
  const managementDays = managementLabour / dayRate;

  // Arithmetic crew: whatever number of operatives clears the work in the
  // duration implied by the labour alone.
  const cap = num(opts.crewCap) > 0 ? num(opts.crewCap) : null;
  const arithmeticCrew = operativeDays > 0 ? Math.max(1, Math.round((operativeDays / 20) * 10) / 10) : 0;
  const crew = cap ? Math.min(arithmeticCrew, cap) : arithmeticCrew;
  const crewLimitedByAccess = !!(cap && arithmeticCrew > cap);

  const labourWorkingDays = crew > 0 ? operativeDays / crew : 0;
  // A sequence-bound operation sets the floor: it cannot be compressed.
  const workingDays = Math.max(labourWorkingDays, sequenceBoundDays);
  const weeks = Math.ceil(workingDays / WORKING_DAYS_PER_WEEK);

  const personDays = operativeDays + managementDays;
  const cdmNotifiable = personDays > CDM_NOTIFIABLE_PERSON_DAYS;

  const notes = [];
  if (managementDays > 0) {
    notes.push(`Site management stripped out before deriving the crew: ${Math.round(managementDays)} of ${Math.round(personDays)} person-days are management, leaving ${Math.round(operativeDays)} productive operative-days.`);
  }
  if (crewLimitedByAccess) {
    notes.push(`Crew capped at ${cap} by the physical constraint${opts.crewCapReason ? ` (${opts.crewCapReason})` : ''}, not by arithmetic — the unconstrained figure of ${arithmeticCrew} is unbuildable, and the time-related prelims must be priced over the longer duration that follows.`);
  }
  for (const s of sequenceNotes) {
    notes.push(`${s.note} ${s.bays} bays is ${s.weeks} week${s.weeks === 1 ? '' : 's'} before anything else starts.`);
  }
  if (cdmNotifiable) {
    notes.push(`CDM: ${Math.round(personDays)} person-days exceeds the ${CDM_NOTIFIABLE_PERSON_DAYS}-day threshold — the project is NOTIFIABLE and an F10 must be filed before construction starts.`);
  }
  if (opts.domesticClient) {
    notes.push("Domestic client: the client's CDM duties pass to the contractor unless a written agreement places them with the Principal Designer.");
  }

  return {
    operativeDays: Math.round(operativeDays * 10) / 10,
    managementDays: Math.round(managementDays * 10) / 10,
    personDays: Math.round(personDays * 10) / 10,
    crew, arithmeticCrew, crewLimitedByAccess,
    workingDays: Math.ceil(workingDays),
    weeks,
    sequenceBound: sequenceNotes,
    cdmNotifiable,
    notes,
  };
}

module.exports = { deriveProgramme, CDM_NOTIFIABLE_PERSON_DAYS, SEQUENCE_BOUND };

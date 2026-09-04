// revisionScope.js — "is this a revision, and a revision of WHAT?"
//
// One included revision per BOQ is a promise about A JOB. The chat used to test it
// against the account's most recently generated document instead:
//
//     SELECT detail FROM usage_log WHERE user_id=? AND action='doc_generated'
//       ORDER BY created_at DESC LIMIT 1
//
// so uploading revised drawings for one job was checked against — and charged
// against — whatever job happened to be priced last. A builder who had already
// revised that other job was told "revision limit reached for this project" about a
// project that was not the one in front of them, and the generation was blocked. The
// same mix-up logged the free revision under the other job's name, quietly spending
// its allowance too.
//
// Two rules hold everything here together:
//
//   1. IT IS THE JOB THAT MATCHES, NOT THE ACCOUNT. Every lookup takes the job being
//      priced now and compares names.
//   2. THE ORIGINAL COUNTS WHEREVER IT CAME FROM. A job's first BOQ is just as often
//      bought through Submit Drawings as generated in the chat, and the customer was
//      promised revisions either way — so drawing_submissions is searched alongside
//      usage_log. Missing that is what makes a revision of a submitted job look like
//      a brand-new BOQ.

// Jobs are known by their site: "The Mount", "The Mount, Harrogate", "the mount
// (barn)". Fold to compare them — case, punctuation and the definite article are
// noise, and a leading "the" is exactly the sort of thing one screen adds and
// another leaves off.
function foldJobName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Below this many letters a name is too thin to identify anything — "Flat 2" is
// half a builder's book — and matching the wrong job is what this module exists to
// stop. Five is deliberate: it is what "The Mount" folds down to.
const MIN_LETTERS = 5;

// Words that name a KIND of job rather than a job. A take-off falls back to the
// project type when the drawings carry no address (benchmarkStore.saveTakeoff:
// `parsed.location || parsed.project_type || 'Project'`), so without this two
// unrelated loft conversions both called "Loft Conversion" would count as one job
// and share a revision allowance.
const GENERIC = new Set([
  'project', 'projects', 'job', 'works', 'boq', 'drawings', 'quote', 'estimate',
  'residential', 'commercial', 'extension', 'loft', 'conversion', 'refurbishment',
  'refurb', 'new', 'build', 'newbuild', 'fit', 'out', 'fitout', 'demolition',
  'enabling', 'heritage', 'listed', 'building', 'structural', 'steelwork',
  'metalwork', 'fabrication', 'other', 'full', 'internal', 'external',
]);

function letterCount(folded) {
  return (folded.match(/[a-z]/g) || []).length;
}

/** Is this name only a category — "Loft Conversion", "Project" — rather than a job? */
function isGenericName(folded) {
  const words = folded.split(' ').filter(Boolean);
  return words.length === 0 || words.every(w => GENERIC.has(w) || !/[a-z]/.test(w));
}

/**
 * Do these two names refer to the same job?
 *
 * Exact once folded, or one wholly inside the other — "The Mount" against "The
 * Mount, Harrogate" is the same site written twice, and both screens will produce
 * both forms. Containment is checked on whole words so "mount" cannot match
 * "mountain view".
 *
 * Refuses rather than guesses on anything that does not name a particular job: too
 * few letters, or nothing but category words. A refusal costs a credit that might
 * have been free; a wrong match blocks a customer's revision over someone else's
 * job, which is what happened.
 */
function sameJob(a, b) {
  const fa = foldJobName(a);
  const fb = foldJobName(b);
  if (!fa || !fb) return false;
  if (letterCount(fa) < MIN_LETTERS || letterCount(fb) < MIN_LETTERS) return false;
  if (isGenericName(fa) || isGenericName(fb)) return false;
  if (fa === fb) return true;
  const [shortW, longW] = fa.length <= fb.length ? [fa.split(' '), fb.split(' ')] : [fb.split(' '), fa.split(' ')];
  if (letterCount(shortW.join('')) < MIN_LETTERS) return false;
  for (let i = 0; i + shortW.length <= longW.length; i++) {
    if (shortW.every((w, j) => longW[i + j] === w)) return true;
  }
  return false;
}

// How far back to look for a job's original. Generous — a revision can arrive weeks
// after the bill — but bounded, because this runs on the interactive path.
const LOOKBACK = 200;

/**
 * The original BOQ for this job, wherever it was produced, or null.
 *
 * @returns {{ name: string, source: 'chat'|'submission', when: string }|null}
 */
function findOriginalBoq(db, { userId, projectName }) {
  if (!userId || !foldJobName(projectName)) return null;

  try {
    const docs = db.prepare(
      `SELECT detail, created_at FROM usage_log
        WHERE user_id = ? AND action = 'doc_generated' AND detail IS NOT NULL
        ORDER BY created_at DESC LIMIT ?`
    ).all(userId, LOOKBACK);
    for (const d of docs) {
      if (sameJob(d.detail, projectName)) return { name: d.detail, source: 'chat', when: d.created_at };
    }
  } catch (e) { /* usage_log may not exist in some envs */ }

  try {
    const subs = db.prepare(
      `SELECT site_address, created_at FROM drawing_submissions
        WHERE user_id = ? AND site_address IS NOT NULL
        ORDER BY created_at DESC LIMIT ?`
    ).all(userId, LOOKBACK);
    for (const s of subs) {
      if (sameJob(s.site_address, projectName)) return { name: s.site_address, source: 'submission', when: s.created_at };
    }
  } catch (e) { /* table may not exist yet */ }

  return null;
}

/** How many revisions this job has already had. */
function countRevisions(db, { userId, projectName }) {
  if (!userId || !foldJobName(projectName)) return 0;
  try {
    const rows = db.prepare(
      `SELECT detail FROM usage_log
        WHERE user_id = ? AND action = 'doc_revision' AND detail IS NOT NULL
        ORDER BY created_at DESC LIMIT ?`
    ).all(userId, LOOKBACK);
    return rows.filter(r => sameJob(r.detail, projectName)).length;
  } catch (e) { return 0; }
}

module.exports = { foldJobName, sameJob, isGenericName, findOriginalBoq, countRevisions, MIN_LETTERS };

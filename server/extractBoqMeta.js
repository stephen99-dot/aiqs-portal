// extractBoqMeta.js — pull labelled contract / insurance metadata out of a
// project brief so the BOQ header can read like a real tender front sheet
// (Employer, Contract Administrator, CA Ref, Contract form, Loss Adjuster,
// Type of loss, Claim/Policy No.).
//
// This is deliberately DETERMINISTIC (no model call): it only lifts fields that
// are explicitly labelled "Label: value" in the brief — exactly the shape the
// insurance/CA instructions these jobs come from use. If the brief is loose
// prose it simply returns nothing and the header falls back to the base rows.
// Zero cost, zero latency, fully testable, and it can never invent a value.

// Canonical label → alias matcher. Order matters: more specific labels first so
// e.g. "Contract Administrator" / "CA Ref" win before the looser "Contract".
const FIELDS = [
  ['CA Ref',                 /(?:c\.?a\.?|contract administrator['’]?s?)\s*(?:ref(?:erence)?|file)(?:\s*(?:no|number|#))?/i],
  ['Contract Administrator', /contract\s*administrator|employer['’]?s?\s*agent/i],
  ['Employer',               /employer|policy\s*holder|policyholder|the\s*insured|insured\s*party/i],
  ['Loss Adjuster',          /loss\s*adjuster|claims?\s*adjuster|adjuster/i],
  ['Type of loss',           /type\s*of\s*loss|cause\s*of\s*loss|nature\s*of\s*(?:loss|claim)|peril/i],
  ['Claim No',               /claim\s*(?:no|number|ref(?:erence)?|#)/i],
  ['Policy No',              /policy\s*(?:no|number|ref(?:erence)?|#)/i],
  ['Contract',               /contract(?:\s*form)?|form\s*of\s*contract/i],
];

// Things that are clearly not a usable value.
function looksLikeValue(v) {
  if (!v) return false;
  const s = v.trim();
  if (s.length < 2 || s.length > 90) return false;
  if (!/[A-Za-z0-9]/.test(s)) return false;          // must have an alphanumeric
  if (/^(n\/?a|tbc|tbd|none|unknown|see\s)/i.test(s)) return false;
  return true;
}

// Break the brief into one-field-per-entry segments. Briefs pack several fields
// onto a line with pipes / semicolons ("Employer: X | CA: Y | Loss: Z"), so we
// split on those as well as newlines.
function segmentize(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split(/\n+|\s\|\s|\s•\s|;\s|\t+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract contract metadata from brief text.
 *
 * LAST statement of a label wins. The text handed in is usually a stretch of
 * conversation rather than a single document, and in a conversation the latest
 * thing said about the employer is the true one — a correction typed after the
 * first brief must not lose to the brief it corrects. Within a single pasted
 * front sheet a label appears once, so the rule costs nothing there.
 *
 * @param {string} text - the combined brief / conversation text
 * @param {object} [opts]
 * @param {number} [opts.max=8] - cap on number of fields returned
 * @returns {Array<[string,string]>} ordered [label, value] pairs (may be empty)
 */
function extractContractMeta(text, opts = {}) {
  const max = Number.isFinite(opts.max) ? opts.max : 8;
  const found = new Map(); // canonical label -> value (last win)

  for (const seg of segmentize(text)) {
    // Only consider "Label <sep> Value" shapes.
    const m = seg.match(/^([^:–—-]{2,40})\s*[:–—-]\s*(.+)$/);
    if (!m) continue;
    const labelText = m[1].trim();
    let value = m[2].trim();
    // A trailing parenthetical contact like "Gateley Vinden (T. Walker-Smith)"
    // is useful — keep it. But drop a stray trailing separator.
    value = value.replace(/\s*[|•;]\s*$/, '').trim();

    for (const [canonical, alias] of FIELDS) {
      // The label portion must BE the alias (anchored), not merely contain it,
      // so a sentence like "We will administer the contract: ..." doesn't match.
      if (new RegExp('^(?:the\\s+)?' + alias.source + '$', 'i').test(labelText)) {
        // Overwriting keeps the label in its original position in the Map, so
        // the header rows stay in the order the brief first introduced them
        // while carrying the latest value for each.
        if (looksLikeValue(value)) found.set(canonical, value);
        break;
      }
    }
  }

  return Array.from(found.entries()).slice(0, max);
}

// ── which turns brief THIS job ────────────────────────────────────────────────

/**
 * Milliseconds for a timestamp written by either side of the wire, or null.
 *
 * The browser sends ISO strings with a zone; SQLite's CURRENT_TIMESTAMP is UTC
 * with no marker at all, and Date.parse reads that bare form as LOCAL time —
 * which on a server an hour off UTC silently moves the job boundary by an hour.
 * So the bare form is given its missing 'T' and 'Z' before parsing.
 */
function toMillis(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  const s = String(v).trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)
    ? s.replace(' ', 'T') + 'Z'
    : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Narrow a conversation down to the turns that brief the CURRENT job.
 *
 * Builders work one long thread across several jobs. The header fields above are
 * lifted from labelled lines that were typed once, at the top of whichever job
 * was being discussed then — so scanning the whole thread stamps the PREVIOUS
 * job's Employer, CA and claim number on today's bill, and the bill looks like
 * it belongs to someone else entirely.
 *
 * The boundary is the take-off: a new set of drawings is measured into a new
 * take-off row, so the turn that started this job is the last one sent at or
 * before that row was written (the drawings and the brief arrive together, and
 * the row is saved once that turn has been read).
 *
 * @param {Array<{text?: string, ts?: string|Date}>} turns - oldest first
 * @param {string|Date|null} jobStartedAt - when this job's take-off was created
 * @returns {Array} the turns from the one that started this job onwards
 */
function currentJobTurns(turns, jobStartedAt) {
  const list = Array.isArray(turns) ? turns : [];
  const startedAt = toMillis(jobStartedAt);
  // Nothing to place a boundary with — an older client that sends no timestamps,
  // or a thread with no take-off yet. Hand back everything and let the last-wins
  // rule above do what it can.
  if (startedAt === null) return list;
  if (!list.some((t) => toMillis(t && t.ts) !== null)) return list;

  let startIdx = -1;
  for (let i = 0; i < list.length; i++) {
    const ts = toMillis(list[i] && list[i].ts);
    if (ts !== null && ts <= startedAt) startIdx = i;
  }
  // Every stamped turn is newer than the take-off (a re-measure of a thread that
  // was already under way): none of them predate this job, so keep them all.
  if (startIdx === -1) startIdx = 0;

  // An unstamped turn cannot be placed on either side of the boundary, and
  // guessing "this job" is the mistake being fixed, so it is left out.
  return list.slice(startIdx).filter((t) => toMillis(t && t.ts) !== null);
}

module.exports = { extractContractMeta, currentJobTurns };

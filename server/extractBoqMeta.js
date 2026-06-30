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
 * @param {string} text - the combined brief / conversation text
 * @param {object} [opts]
 * @param {number} [opts.max=8] - cap on number of fields returned
 * @returns {Array<[string,string]>} ordered [label, value] pairs (may be empty)
 */
function extractContractMeta(text, opts = {}) {
  const max = Number.isFinite(opts.max) ? opts.max : 8;
  const found = new Map(); // canonical label -> value (first win)

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
        if (!found.has(canonical) && looksLikeValue(value)) found.set(canonical, value);
        break;
      }
    }
    if (found.size >= max) break;
  }

  return Array.from(found.entries()).slice(0, max);
}

module.exports = { extractContractMeta };

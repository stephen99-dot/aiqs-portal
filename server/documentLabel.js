// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT LABEL — server/documentLabel.js
//
// Some builders issue quotes; others issue estimates — and the two are not the
// same promise in law, so the word on the document matters to them. The wording
// is a per-account branding setting (user_branding.document_label) resolved at
// RENDER time, so switching it re-words documents that were already sent: the
// client's live /q/<token> page and its PDF follow the setting immediately.
//
// Every client-facing surface (quote PDF, public acceptance page, the emails
// that carry the link) asks for its nouns here rather than hard-coding "quote".
// ═══════════════════════════════════════════════════════════════════════════════

const LABELS = {
  quote: {
    key: 'quote',
    noun: 'quote',        // "your quote"
    Noun: 'Quote',        // "Quote Q-20260828-1234"
    formal: 'quotation',  // "This quotation is valid for 30 days"
    Formal: 'Quotation',  // document title fallback
  },
  estimate: {
    key: 'estimate',
    noun: 'estimate',
    Noun: 'Estimate',
    formal: 'estimate',
    Formal: 'Estimate',
  },
};

const DOCUMENT_LABELS = Object.keys(LABELS);

// branding may be a user_branding row, a plain string ('estimate'), or null.
function docLabel(branding) {
  const key = typeof branding === 'string' ? branding : (branding && branding.document_label);
  return LABELS[String(key || '').toLowerCase()] || LABELS.quote;
}

module.exports = { docLabel, DOCUMENT_LABELS, LABELS };

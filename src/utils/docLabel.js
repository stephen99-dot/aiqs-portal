// The word this account's client-facing documents call themselves — "quote" or
// "estimate" (Branding → Document wording). Mirrors server/documentLabel.js so
// the portal's own screens use the same noun the client will read on the PDF
// and the acceptance page.

const LABELS = {
  quote:    { key: 'quote',    noun: 'quote',    Noun: 'Quote',    formal: 'quotation', Formal: 'Quotation' },
  estimate: { key: 'estimate', noun: 'estimate', Noun: 'Estimate', formal: 'estimate',  Formal: 'Estimate'  },
};

export const DOCUMENT_LABELS = Object.keys(LABELS);

// branding may be a branding object, a plain string, or null/undefined.
export function docLabel(branding) {
  const key = typeof branding === 'string' ? branding : (branding && branding.document_label);
  return LABELS[String(key || '').toLowerCase()] || LABELS.quote;
}

// "a quote" / "an estimate"
export function withArticle(label) {
  return (/^[aeiou]/i.test(label.noun) ? 'an ' : 'a ') + label.noun;
}

export default docLabel;

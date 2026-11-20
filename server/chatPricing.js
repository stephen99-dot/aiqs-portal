// ═══════════════════════════════════════════════════════════════════════════════
// AI Chat — server/chatPricing.js
//
// AI Chat no longer prices work. Pricing is MAX's job (the AI QS MAX package:
// small jobs priced from the builder's own rates) and the QS team's (Submit
// Drawings). The chat stays for specs, methods, regulations and questions
// about a job — anything but money.
//
// So, unless CHAT_PRICING=1 is set on the server (the old behaviour, kept for
// a rainy day), a chat turn that asks for a price, a cost, an estimate, a
// quote, a rate, a budget or a bill of quantities — or that uploads drawings
// to be measured — gets a short reply pointing at MAX, with no model call and
// no message credit spent. The chat's own persona carries no rate library and
// no cost benchmarks, so it has nothing to quote even when a question slips
// past the pattern, and it is told plainly not to.
// ═══════════════════════════════════════════════════════════════════════════════

function enabled() {
  return process.env.CHAT_PRICING === '1';
}

// What counts as asking for money. Deliberately broad: "how much", "£",
// "per m²", "budget", "quote", "estimate", "BOQ", "tender", "rate"…
const ASK_RE = /pric|cost|\bquot(e|es|ed|ing|ation)\b|estimat|\brates?\b|budget|how much|what would .{0,20}(be|come to)|\bboq\b|bill of quant|take-?off|tender|valuation|per\s*(m2|m²|sqm|metre|meter|square)|[£€$R]\s*\d|expensive|cheap|afford|allowance|conting|oh&p|\bohp\b|mark-?up|\bmargin\b|\bspend\b|\bfee\b|day rate|labour rate|material cost|generate\s*(the\s*)?(document|boq|report|excel)/i;

function asksForPrice(message) {
  return ASK_RE.test(String(message || ''));
}

// The reply, which the chat page follows with a MAX card (or, inside the iOS
// app, a plain notice). `hasMax` is whether MAX is already on for the account.
function reply({ hasMax, hasFiles }) {
  if (hasFiles) {
    return (hasMax
      ? "I don't measure or price drawings in this chat any more. For a priced bill of quantities from drawings, use **Submit Drawings** — the AI QS team measures and prices it and it comes back to your portal, usually within 24 hours. For a small job, **Ask MAX** and it prices from your rates in minutes."
      : "I don't measure or price drawings in this chat any more. For a priced bill of quantities from drawings, use **Submit Drawings** — the AI QS team measures and prices it and it comes back to your portal, usually within 24 hours. For small jobs there is **MAX**, the AI estimator in the AI QS MAX package, which prices from your own rates in minutes.")
      + '\n\nDescribe what is on the drawings in words and I can still help with the specification, the method or the regulations.';
  }
  return (hasMax
    ? "I don't price work in this chat any more — that's **MAX**'s job. Open **Ask MAX** from the menu (or the button at the bottom right) and say the same thing there: MAX prices small jobs from your own rates in minutes, with every quantity, rate and assumption shown, and the estimate is yours to edit and send."
    : "I don't price work in this chat any more. Pricing is done by **MAX**, the AI estimator in the AI QS MAX package: describe a small job and MAX prices it from your own rates in minutes, with every quantity, rate and assumption shown, and the estimate is yours to edit and send.")
    + '\n\nFor a full take-off from drawings, use **Submit Drawings** and the AI QS team prices it. I can still help with specifications, methods, building regulations and what a job involves — just not the money.';
}

// A 403 for the routes that price or re-price a take-off.
function refuse(res) {
  return res.status(403).json({
    error: 'Pricing has moved to MAX. Ask MAX to price a small job from your rates, or use Submit Drawings for a priced bill of quantities.',
    code: 'PRICING_MOVED',
  });
}

module.exports = { enabled, asksForPrice, reply, refuse, ASK_RE };

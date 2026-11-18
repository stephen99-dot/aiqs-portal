// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxSpeech.js
//
// The spoken version of a written reply. MAX reads aloud only a short form:
// numbers as words, no lists, "the details are on screen" when the written
// reply has more.
//
// What MAX says is the written reply's OWN opening sentences. It used to be
// rewritten by a second model pass, which meant the voice could say something
// the screen did not — different wording, and on a tool that sends estimates
// to customers, potentially a different name or figure. The rewrite is now
// opt-in (MAX_SPOKEN_REWRITE=1); by default the two always agree.
// ═══════════════════════════════════════════════════════════════════════════════

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
  if (n < 1000000) return words(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? (n % 1000 < 100 ? ' and ' : ' ') + words(n % 1000) : '');
  return words(Math.floor(n / 1000000)) + ' million' + (n % 1000000 ? ' ' + words(n % 1000000) : '');
}
function poundsInWords(numStr) {
  const n = parseFloat(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return '£' + numStr;
  const pounds = Math.floor(n); const pence = Math.round((n - pounds) * 100);
  let out = pounds === 0 ? 'zero pounds' : words(pounds) + (pounds === 1 ? ' pound' : ' pounds');
  if (pence) out += ' ' + words(pence) + (pence === 1 ? ' penny' : ' pence');
  return out;
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[#>]+\s*/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    // A line that ends without punctuation (a list item, a heading) is its own
    // sentence when spoken, so the shortener can stop at it.
    .replace(/([^.!?:\s])\s*\n+/g, '$1. ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Deterministic: first two sentences, pounds and percentages as words.
function shorten(text) {
  const hadList = /\n\s*[-*•\d][.)]?\s/.test(text || '');
  const s = stripMarkdown(text);
  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = '';
  for (const sent of sentences) {
    if (out && (out + ' ' + sent).length > 260) break;
    out = (out + ' ' + sent).trim();
    if (out.split(/(?<=[.!?])\s+/).length >= 2) break;
  }
  if (!out) out = s.slice(0, 260);
  if (sentences.length > 2 || hadList) out += ' The details are on screen.';
  return out
    .replace(/£\s?([\d,]+(?:\.\d{1,2})?)\s*(k|K)\b/g, (m, n) => poundsInWords(parseFloat(n.replace(/,/g, '')) * 1000))
    .replace(/£\s?([\d,]+(?:\.\d{1,2})?)/g, (m, n) => poundsInWords(n))
    .replace(/(\d+(?:\.\d+)?)\s?%/g, '$1 per cent')
    .replace(/\bex VAT\b/g, 'ex VAT').replace(/\binc VAT\b/g, 'including VAT');
}

const SPOKEN_SYSTEM = 'Rewrite the assistant reply below as what MAX, a UK builder\'s estimating assistant, would SAY out loud: at most forty-five words, plain spoken British English, the key number or outcome first, no lists, no headings, no markdown. Write every money amount and percentage in words ("four thousand two hundred and fifty pounds ex VAT", "twenty per cent"). If the written reply has more than you can say, end with "The details are on screen." Output only the spoken words.';

// spokenVersion(text, { userId, timeoutMs }) → string. Never throws.
async function spokenVersion(text, { userId, timeoutMs = 3500 } = {}) {
  const fallback = shorten(text);
  if (process.env.MAX_SPOKEN_REWRITE !== '1') return fallback;
  if (!process.env.ANTHROPIC_API_KEY || !String(text || '').trim()) return fallback;
  try {
    const { callModel, MODELS } = require('./anthropicClient');
    const call = callModel({ model: MODELS.FAST, system: SPOKEN_SYSTEM, cacheSystem: true, messages: [{ role: 'user', content: String(text).slice(0, 4000) }], maxTokens: 160, userId, action: 'max', detail: 'spoken' });
    const r = await Promise.race([call, new Promise((res) => setTimeout(() => res(null), timeoutMs))]);
    const out = r && r.ok ? String(r.text || '').trim() : '';
    return out && out.length < 600 ? out : fallback;
  } catch (e) { return fallback; }
}

module.exports = { spokenVersion, shorten, poundsInWords, stripMarkdown };

// Embedding helper: Voyage AI primary, graceful fallback to null.
// When embeddings are unavailable, memoryStore falls back to FTS5 keyword search.

const VOYAGE_MODEL = process.env.VOYAGE_MODEL || 'voyage-3-lite';
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

function isEnabled() {
  return Boolean(VOYAGE_API_KEY);
}

async function embed(text, { inputType = 'document' } = {}) {
  if (!VOYAGE_API_KEY) return null;
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) return null;
  try {
    const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [trimmed],
        input_type: inputType,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[Embeddings] Voyage error', resp.status, body.slice(0, 300));
      return null;
    }
    const data = await resp.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return null;
    return vec;
  } catch (err) {
    console.error('[Embeddings] request failed:', err.message);
    return null;
  }
}

// Pack/unpack Float32Array to/from a SQLite BLOB
function vectorToBlob(vec) {
  if (!vec || !Array.isArray(vec)) return null;
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function blobToVector(blob) {
  if (!blob || !Buffer.isBuffer(blob) || blob.length === 0) return null;
  const bytes = blob.length - (blob.length % 4);
  if (bytes === 0) return null;
  const f32 = new Float32Array(blob.buffer, blob.byteOffset, bytes / 4);
  return Array.from(f32);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = {
  isEnabled,
  embed,
  vectorToBlob,
  blobToVector,
  cosineSimilarity,
  VOYAGE_MODEL,
};

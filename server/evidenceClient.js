/**
 * evidenceClient.js — Node client for the evidence sidecar (brief §3, §4).
 *
 * The geometry lives in a Python service because the tools that matter —
 * vector primitive census, page rotation, level ladders, pixel tone counts —
 * are PyMuPDF work with no credible Node equivalent. See evidence/README.md.
 *
 * ALWAYS OPTIONAL. If the sidecar is not running, every call resolves to
 * { available: false } and the caller carries on without it. A missing
 * evidence layer must degrade the confidence of a takeoff, never break the
 * portal — and it must never silently substitute a guess for a measurement.
 */
const EVIDENCE_URL = process.env.EVIDENCE_URL || 'http://127.0.0.1:8021';
const TIMEOUT_MS = Number(process.env.EVIDENCE_TIMEOUT_MS) || 20000;

async function call(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${EVIDENCE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { available: true, ok: false, error: `evidence ${endpoint} ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { available: true, ok: true, data: await res.json() };
  } catch (err) {
    // Unreachable, timed out, or not deployed — all the same to the caller.
    return { available: false, ok: false, error: err.name === 'AbortError' ? 'evidence sidecar timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function isAvailable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${EVIDENCE_URL}/health`, { signal: controller.signal });
    return res.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

/** Step one on every sheet: size, /Rotate, md5, primitive count, text length. */
const pageInventory = (path) => call('/page_inventory', { path });

/** Vector census by (type, stroke, fill, width) — a CAD layer, once in a PDF. */
const harvestLayers = (path, page = 0, minCluster = 1) =>
  call('/harvest_layers', { path, page, min_cluster: minCluster });

/** Returns a PROOF TABLE, never a single number. */
const proveScale = (payload) => call('/prove_scale', payload);

/**
 * Turn an evidence result into the confidence statement a QS needs. Without the
 * sidecar a takeoff is measured visually, and the report must say so rather
 * than presenting an eyeballed figure as a proven one.
 */
function evidenceConfidence(inventory, scaleTable) {
  if (!inventory || !inventory.available) {
    return {
      level: 'visual_only',
      note: 'Measured visually — the evidence layer was not available, so no vector geometry was harvested '
        + 'and the scale was not independently proven. Quantities are estimates, not proven measurements.',
    };
  }
  if (!scaleTable || !scaleTable.usable) {
    return {
      level: 'unproven_scale',
      note: (scaleTable && scaleTable.verdict)
        || 'The scale was not proven twice from independent evidence. Quantities are provisional.',
    };
  }
  return { level: 'proven', note: scaleTable.verdict };
}

module.exports = { isAvailable, pageInventory, harvestLayers, proveScale, evidenceConfidence, EVIDENCE_URL };

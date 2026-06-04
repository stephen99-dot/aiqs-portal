// Deterministic geometry extraction from DXF (CAD) files. When a user exports
// their drawing to DXF, we can read exact line lengths, closed-polyline areas
// and block (door/window) counts straight from the vector data — far more
// accurate than measuring a rasterised image. Best-effort: any failure returns
// null so the caller falls back to the normal vision pipeline.

let DxfParser;
try { DxfParser = require('dxf-parser'); } catch (e) { DxfParser = null; }

function isEnabled() { return !!DxfParser; }

// DXF $INSUNITS → metres-per-unit. 1=inch, 2=feet, 4=mm, 5=cm, 6=m.
const UNIT_TO_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };

function dist(a, b) {
  const dx = (b.x || 0) - (a.x || 0);
  const dy = (b.y || 0) - (a.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function polylineLength(verts, closed) {
  let len = 0;
  for (let i = 1; i < verts.length; i++) len += dist(verts[i - 1], verts[i]);
  if (closed && verts.length > 2) len += dist(verts[verts.length - 1], verts[0]);
  return len;
}

function polygonArea(verts) {
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i + 1) % verts.length];
    a += (p.x || 0) * (q.y || 0) - (q.x || 0) * (p.y || 0);
  }
  return Math.abs(a) / 2;
}

function extractDxf(text) {
  if (!DxfParser || !text) return null;
  let dxf;
  try { dxf = new DxfParser().parseSync(text); } catch (e) { return null; }
  if (!dxf || !Array.isArray(dxf.entities)) return null;

  const insunits = dxf.header && dxf.header.$INSUNITS;
  const m = UNIT_TO_M[insunits] != null ? UNIT_TO_M[insunits] : 0.001; // default mm
  const unitsKnown = UNIT_TO_M[insunits] != null;

  const lengthByLayer = {};
  const areas = [];
  const blockCounts = {};
  const texts = [];
  let lineCount = 0, polyCount = 0, blockRefs = 0;

  for (const e of dxf.entities) {
    const layer = e.layer || '0';
    if (e.type === 'LINE' && e.vertices && e.vertices.length >= 2) {
      lengthByLayer[layer] = (lengthByLayer[layer] || 0) + dist(e.vertices[0], e.vertices[1]) * m;
      lineCount++;
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && Array.isArray(e.vertices)) {
      const closed = !!(e.shape || e.closed);
      lengthByLayer[layer] = (lengthByLayer[layer] || 0) + polylineLength(e.vertices, closed) * m;
      polyCount++;
      if (closed && e.vertices.length >= 3) {
        const area = polygonArea(e.vertices) * m * m;
        if (area > 0.5 && area < 5000) areas.push({ layer, area: Math.round(area * 100) / 100 });
      }
    } else if (e.type === 'INSERT' && e.name) {
      blockCounts[e.name] = (blockCounts[e.name] || 0) + 1;
      blockRefs++;
    } else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text) {
      texts.push(String(e.text));
    }
  }

  // Heuristically classify blocks that look like doors/windows by name.
  const doorBlocks = {}, windowBlocks = {};
  for (const [name, count] of Object.entries(blockCounts)) {
    const n = name.toLowerCase();
    if (/door|\bdr\b|^d\d/.test(n)) doorBlocks[name] = count;
    else if (/window|\bwin\b|glaz|^w\d/.test(n)) windowBlocks[name] = count;
  }

  const layerSummary = Object.entries(lengthByLayer)
    .map(([layer, len]) => ({ layer, length_m: Math.round(len * 100) / 100 }))
    .filter(l => l.length_m > 0.1)
    .sort((a, b) => b.length_m - a.length_m);

  return {
    unitsKnown, unit_metres: m,
    entityCounts: { lines: lineCount, polylines: polyCount, blockRefs },
    lengthByLayer: layerSummary,
    closedAreas: areas.sort((a, b) => b.area - a.area).slice(0, 40),
    blockCounts,
    doorBlocks, windowBlocks,
    scaleText: texts.find(t => /1\s*[:/]\s*\d{1,4}/.test(t)) || null,
  };
}

function formatForPrompt(result, filename) {
  if (!result) return '';
  const lines = [];
  lines.push(`File: ${filename || 'drawing.dxf'} (parsed from CAD vector geometry)`);
  if (!result.unitsKnown) lines.push(`WARNING: DXF units not specified — assumed millimetres. Sanity-check the magnitudes below.`);
  if (result.lengthByLayer.length) {
    lines.push(`Total line length by layer (metres) — use for wall runs, skirting, services etc.:`);
    for (const l of result.lengthByLayer.slice(0, 14)) lines.push(`  • ${l.layer}: ${l.length_m} m`);
  }
  if (result.closedAreas.length) {
    const total = result.closedAreas.reduce((s, a) => s + a.area, 0);
    lines.push(`Closed polygon areas (m²): ${result.closedAreas.slice(0, 12).map(a => a.area).join(', ')}${result.closedAreas.length > 12 ? ' …' : ''} (sum of listed: ${Math.round(total)} m²).`);
  }
  const doors = Object.values(result.doorBlocks).reduce((s, n) => s + n, 0);
  const windows = Object.values(result.windowBlocks).reduce((s, n) => s + n, 0);
  if (doors || windows) lines.push(`Block instances: ${doors} door(s), ${windows} window(s) placed.`);
  if (result.scaleText) lines.push(`Scale annotation in file: ${result.scaleText}`);
  return `\n=== MEASURED FROM CAD (DXF) — authoritative geometry ===\n` +
    `These lengths, areas and counts are computed directly from the CAD vector data. Use them as exact quantities where they apply; do not re-estimate from images.\n\n` +
    lines.join('\n') +
    `\n===\n`;
}

module.exports = { isEnabled, extractDxf, formatForPrompt };

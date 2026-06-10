// Server-side BOQ agent — one Claude conversation with tools.
//
// Unlike the deleted Deep BOQ (which chained 8 one-shot prompts and couldn't
// iterate), this runs a single Claude conversation that can call tools:
//   - view_pdf_page        (look at a specific drawing page closely)
//   - set_project_metadata (record project type / location / floor area)
//   - record_takeoff_item  (add items to the BOQ)
//   - update_takeoff_item  (correct a quantity after sanity checks)
//   - remove_takeoff_item  (double-counts, mis-categorised items)
//   - run_pricer           (apply deterministic pricer, see result + warnings)
//   - finalize_boq         (trigger Excel + Word generation)
//
// The agent can loop — run the pricer, see it's way off, adjust quantities,
// run again. Same architectural shape claude.ai uses for QS work.
//
// Streaming is honoured: every token (text + thinking) and every tool call
// is emitted as an SSE event so the frontend can show live activity.

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('./database');
let sharp; try { sharp = require('sharp'); } catch (e) { sharp = null; }
let pdfGeometry; try { pdfGeometry = require('./pdfGeometry'); } catch (e) { pdfGeometry = null; }

// ── Schema ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT DEFAULT 'queued',
    scope_text TEXT,
    intake_json TEXT,
    file_names TEXT,
    tmp_dir TEXT,
    project_type TEXT,
    location TEXT,
    floor_area_m2 REAL,
    spec_level TEXT,
    takeoff_json TEXT,
    priced_json TEXT,
    iteration_count INTEGER DEFAULT 0,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    construction_total REAL,
    grand_total REAL,
    currency TEXT,
    download_files TEXT,
    current_activity TEXT,
    error_message TEXT,
    findings_notes TEXT,
    review_summary TEXT,
    sanity_warnings TEXT,
    variance_note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id);

  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    iteration INTEGER NOT NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_messages_run ON agent_messages(run_id, iteration, id);
`);

// Lazy migrations for existing deployments
try {
  const cols = db.prepare("PRAGMA table_info(agent_runs)").all().map(c => c.name);
  if (!cols.includes('findings_notes')) db.exec(`ALTER TABLE agent_runs ADD COLUMN findings_notes TEXT`);
  if (!cols.includes('review_summary')) db.exec(`ALTER TABLE agent_runs ADD COLUMN review_summary TEXT`);
  if (!cols.includes('sanity_warnings')) db.exec(`ALTER TABLE agent_runs ADD COLUMN sanity_warnings TEXT`);
  if (!cols.includes('variance_note')) db.exec(`ALTER TABLE agent_runs ADD COLUMN variance_note TEXT`);
  if (!cols.includes('findings_structured')) db.exec(`ALTER TABLE agent_runs ADD COLUMN findings_structured TEXT`);
} catch (e) { console.error('[Agent] migration error:', e.message); }

// ── Event buses ──────────────────────────────────────────────────────
// One EventEmitter per active run. Subscribers receive all deltas, tool
// calls, and status transitions live via SSE. Cleaned up 5 min after no
// listeners.
const buses = new Map();
function getBus(runId) {
  if (!buses.has(runId)) {
    const em = new EventEmitter();
    em.setMaxListeners(50);
    buses.set(runId, { em, refCount: 0, cleanup: null });
  }
  return buses.get(runId);
}
function subscribe(runId, onEvent) {
  const b = getBus(runId);
  b.refCount++;
  if (b.cleanup) { clearTimeout(b.cleanup); b.cleanup = null; }
  b.em.on('event', onEvent);
  return () => {
    b.em.off('event', onEvent);
    b.refCount = Math.max(0, b.refCount - 1);
    if (b.refCount === 0) {
      b.cleanup = setTimeout(() => buses.delete(runId), 5 * 60 * 1000);
    }
  };
}
function emit(runId, evt) {
  const b = buses.get(runId);
  if (b) b.em.emit('event', evt);
}

// ── Persistence helpers ──────────────────────────────────────────────
function updateRun(runId, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const pairs = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => patch[k]);
  db.prepare(`UPDATE agent_runs SET ${pairs}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, runId);
}
function getRun(runId) {
  return db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId);
}
function appendMessage(runId, iteration, role, content) {
  db.prepare('INSERT INTO agent_messages (id, run_id, iteration, role, content_json) VALUES (?, ?, ?, ?, ?)').run(
    'am_' + uuidv4().slice(0, 10), runId, iteration, role, JSON.stringify(content)
  );
}
function getMessages(runId) {
  return db.prepare('SELECT * FROM agent_messages WHERE run_id = ? ORDER BY iteration ASC, id ASC').all(runId);
}

// Tracks the current activity string surface-able to the UI.
function setActivity(runId, activity) {
  updateRun(runId, { current_activity: activity });
  emit(runId, { type: 'activity', activity });
}

// ── Tool definitions (JSON schema for Anthropic tool use) ─────────────

const TOOL_DEFINITIONS = [
  {
    name: 'view_pdf_page',
    description: 'View a specific page of one of the uploaded PDFs at high resolution. Use this to inspect floor plans, elevations, sections, schedules and other drawings closely. The file is rendered at 200 DPI and returned as an image. Typically use this early in the run to understand the drawings, then again whenever you need to verify a dimension, count openings, or read a spec note.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename of the PDF to view (exactly as listed in the initial file summary).' },
        page: { type: 'integer', description: '1-based page number to render.' },
      },
      required: ['filename', 'page'],
    },
  },
  {
    name: 'zoom_region',
    description: 'Magnify a rectangular REGION of a PDF page and view it at high effective resolution — like a surveyor zooming in with a loupe. Use this to read small dimension strings, the scale bar, hatching keys, schedule tables, or to count openings on a busy elevation when view_pdf_page is too coarse. Coordinates are fractions of the page from the TOP-LEFT: x and y are the top-left corner of the region (0=left/top, 1=right/bottom) and w/h are its width/height as fractions. Example: the bottom-right quarter is {x:0.5,y:0.5,w:0.5,h:0.5}. Keep regions reasonably small (w and h around 0.3-0.5) for maximum detail.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename of the PDF (exactly as listed in the file summary).' },
        page: { type: 'integer', description: '1-based page number.' },
        x: { type: 'number', description: 'Left edge of region, 0-1 fraction of page width.' },
        y: { type: 'number', description: 'Top edge of region, 0-1 fraction of page height.' },
        w: { type: 'number', description: 'Region width, 0-1 fraction of page width.' },
        h: { type: 'number', description: 'Region height, 0-1 fraction of page height.' },
      },
      required: ['filename', 'page', 'x', 'y', 'w', 'h'],
    },
  },
  {
    name: 'set_project_metadata',
    description: 'Record the essential project metadata. Call this EARLY once you have identified the project type and floor area from the drawings. CRITICAL: floor_area_m2 should be the TOTAL gross internal floor area (all floors, new + altered), not just the extension footprint — this drives the pricer sizing.',
    input_schema: {
      type: 'object',
      properties: {
        project_type: { type: 'string', description: 'Precise description — e.g. "Two-storey rear extension", "Barn conversion with new 1.5-storey block", "Full house refurbishment with porch extension".' },
        location: { type: 'string', description: 'Town, county, country. Used for regional cost uplift.' },
        floor_area_m2: { type: 'number', description: 'Total gross internal floor area in m² (ALL floors of ALL affected areas).' },
        spec_level: {
          type: 'string',
          enum: ['budget', 'standard', 'mid-range', 'premium', 'heritage'],
          description: 'Finishes / overall spec level — informs rate selection.',
        },
      },
      required: ['project_type', 'location', 'floor_area_m2', 'spec_level'],
    },
  },
  {
    name: 'record_takeoff_item',
    description: 'Add a line item to the BOQ. Include the actual measurement working in the description so the client can audit it. Use standard item keys from the rate library where possible — e.g. concrete_slab_150mm, brick_outer_leaf, plasterboard_skim_walls, lvt_karndean, kitchen_fitout_high. For items not in the library, pass assumed_rate with a realistic GBP rate (pre-location uplift).',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'snake_case key — prefer standard library keys.' },
        description: { type: 'string', description: 'Description INCLUDING measurement working (e.g. "External wall 8.2m × 2.7m = 22.1m² less 1 window 1.2m² = 20.9m²").' },
        qty: { type: 'number' },
        unit: { type: 'string', description: 'e.g. m2, m3, m, Nr, Item' },
        section: { type: 'string', description: 'e.g. Preliminaries, Substructure, Superstructure, Roof, Windows & Doors, Internal Finishes, Floor Finishes, Fit-Out, Mechanical, Electrical, Decoration, External Works' },
        assumed_rate: { type: 'number', description: 'Optional — GBP per-unit rate. Only set when the key is not in the base library (the agent can check with run_pricer and see warnings).' },
      },
      required: ['key', 'description', 'qty', 'unit', 'section'],
    },
  },
  {
    name: 'update_takeoff_item',
    description: 'Correct a previously-recorded quantity (e.g. after a sanity check reveals it was too high or too low). Pass the reason so it appears in the audit trail.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        new_qty: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['key', 'new_qty', 'reason'],
    },
  },
  {
    name: 'remove_takeoff_item',
    description: 'Remove a previously-recorded item (double-count, wrong category). Pass the reason.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['key', 'reason'],
    },
  },
  {
    name: 'run_pricer',
    description: 'Apply the deterministic pricer to the current takeoff. Returns priced sections, warnings (e.g. caps applied, rates looked too high, items auto-corrected), and grand total. Call this MID-RUN to sanity-check — if the cost per m² looks wrong or a cap fires that scales prices way down, adjust quantities and run again. Call a final time right before finalize_boq.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'submit_for_review',
    description: 'Submit the completed takeoff + pricer result to the USER for review. Call this INSTEAD of finalize_boq when you are ready. The user will then review the items in the panel, adjust any quantities or rates if needed, and click Generate to produce the Excel + Word deliverables themselves. Your work on the run finishes here — do not call more tools after this. Provide the structured findings fields so the Word findings report reads like real QS work, not a single blob of text.',
    input_schema: {
      type: 'object',
      properties: {
        review_summary: { type: 'string', description: 'A 2-3 sentence plain-English summary shown to the user at the top of the review panel. Explain what you did and any items they should pay special attention to.' },
        scope_summary: { type: 'string', description: 'One to two paragraphs describing what is included in this BOQ — the physical scope of works, the floors/rooms/elements affected, and any notable design intent.' },
        project_description: { type: 'string', description: 'A short description of the project itself (one paragraph). What kind of building, what is being done, any heritage/structural context.' },
        key_findings: {
          type: 'array',
          description: '3-6 grouped observations. Each finding has a title, a detail paragraph, and optional bullet items. Examples of titles: "Headline cost", "Spec assumptions", "Buildability risks", "Items the client should price-check", "Significant variations from typical".',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              detail: { type: 'string' },
              items: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'detail'],
          },
        },
        assumptions: { type: 'array', items: { type: 'string' }, description: 'Bulleted list of assumptions made (one short sentence each). Cover spec levels, drainage routing, structural takes, finishes, services, etc.' },
        exclusions: { type: 'array', items: { type: 'string' }, description: 'Standard exclusions. Cover at minimum: VAT (if applicable), professional fees, statutory fees & approvals, party-wall costs, surveys, FF&E, items outside the curtilage, abnormals not visible from drawings.' },
        recommendations: { type: 'array', items: { type: 'string' }, description: 'Practical next steps for the client — e.g. "obtain a structural engineer\'s report before tender", "confirm window schedule reflects revised mullion spacing", etc.' },
        findings_notes: { type: 'string', description: 'OPTIONAL — legacy single-blob notes field, kept for fallback when the structured fields aren\'t available. Prefer the structured fields above.' },
      },
      required: ['review_summary', 'scope_summary', 'key_findings', 'assumptions', 'exclusions', 'recommendations'],
    },
  },
  {
    name: 'finalize_boq',
    description: 'DEPRECATED — use submit_for_review instead. Kept only for backward compatibility. If called, behaves like submit_for_review (pauses for user approval, does not auto-generate documents).',
    input_schema: {
      type: 'object',
      properties: {
        findings_notes: { type: 'string', description: 'Short professional QS prose for the findings report.' },
      },
      required: ['findings_notes'],
    },
  },
];

// ── Tool executors ───────────────────────────────────────────────────

async function renderPdfPage(tmpDir, filename, page) {
  const srcPath = path.join(tmpDir, filename);
  if (!fs.existsSync(srcPath)) {
    // Try a case-insensitive / basename lookup — AI sometimes paraphrases
    const alt = fs.readdirSync(tmpDir).find(f => f.toLowerCase() === filename.toLowerCase() || path.basename(f, path.extname(f)).toLowerCase() === filename.toLowerCase());
    if (alt) return renderPdfPage(tmpDir, alt, page);
    return { ok: false, reason: `file ${filename} not found in upload` };
  }
  const outDir = path.join(tmpDir, 'rendered_' + Date.now());
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const result = spawnSync('pdftoppm', [
      '-r', '200', '-jpeg', '-jpegopt', 'quality=85',
      '-f', String(page), '-l', String(page),
      srcPath, path.join(outDir, 'page'),
    ], { timeout: 60000, encoding: 'buffer' });
    if (result.status !== 0 && result.status !== null) {
      return { ok: false, reason: 'pdftoppm failed: ' + (result.stderr ? result.stderr.toString().substring(0, 200) : '') };
    }
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'));
    if (files.length === 0) return { ok: false, reason: `page ${page} not rendered — maybe out of range` };
    let buf = fs.readFileSync(path.join(outDir, files[0]));
    if (buf.length > 4.5 * 1024 * 1024) {
      // First try recompressing at the same resolution with sharp — keeps detail
      // far better than dropping DPI.
      if (sharp) {
        try {
          const recompressed = await sharp(buf).jpeg({ quality: 78 }).toBuffer();
          if (recompressed.length <= 4.5 * 1024 * 1024) {
            return { ok: true, base64: recompressed.toString('base64'), mediaType: 'image/jpeg' };
          }
        } catch (e) {}
      }
      // Otherwise re-render at a moderately lower DPI (still legible).
      const outDir2 = path.join(tmpDir, 'rendered2_' + Date.now());
      fs.mkdirSync(outDir2, { recursive: true });
      const r2 = spawnSync('pdftoppm', [
        '-r', '150', '-jpeg', '-jpegopt', 'quality=75',
        '-f', String(page), '-l', String(page),
        srcPath, path.join(outDir2, 'page'),
      ], { timeout: 60000, encoding: 'buffer' });
      if (r2.status !== 0 && r2.status !== null) {
        try { fs.rmSync(outDir2, { recursive: true, force: true }); } catch (e) {}
        return { ok: false, reason: 'retry render failed' };
      }
      const files2 = fs.readdirSync(outDir2).filter(f => f.endsWith('.jpg'));
      const buf2 = fs.readFileSync(path.join(outDir2, files2[0]));
      try { fs.rmSync(outDir2, { recursive: true, force: true }); } catch (e) {}
      return { ok: true, base64: buf2.toString('base64'), mediaType: 'image/jpeg' };
    }
    return { ok: true, base64: buf.toString('base64'), mediaType: 'image/jpeg' };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {}
  }
}

// Render a magnified region of a PDF page. The region (normalised 0-1 from the
// top-left) is rendered at a DPI chosen so the crop comes out ~1900px wide,
// giving the model far more effective resolution than a whole-page view.
async function renderPdfRegion(tmpDir, filename, page, region) {
  let srcPath = path.join(tmpDir, filename);
  if (!fs.existsSync(srcPath)) {
    const alt = fs.readdirSync(tmpDir).find(f => f.toLowerCase() === filename.toLowerCase() || path.basename(f, path.extname(f)).toLowerCase() === filename.toLowerCase());
    if (!alt) return { ok: false, reason: `file ${filename} not found in upload` };
    srcPath = path.join(tmpDir, alt);
  }
  // Clamp the region to sane bounds.
  const x = Math.min(Math.max(region.x || 0, 0), 0.98);
  const y = Math.min(Math.max(region.y || 0, 0), 0.98);
  const w = Math.min(Math.max(region.w || 0.5, 0.05), 1 - x);
  const h = Math.min(Math.max(region.h || 0.5, 0.05), 1 - y);

  // Look up the page's point size to compute the pixel crop box.
  let wPt = 0, hPt = 0;
  if (pdfGeometry) {
    try {
      const sizes = await pdfGeometry.getPageSizes(fs.readFileSync(srcPath), page);
      const ps = sizes && sizes.sizes.find(s => s.index === page);
      if (ps) { wPt = ps.wPt; hPt = ps.hPt; }
    } catch (e) {}
  }
  if (!wPt || !hPt) { wPt = 1684; hPt = 2384; } // A1 portrait fallback

  const TARGET_PX = 1900;
  const cropWInches = (w * wPt) / 72;
  let dpi = Math.round(TARGET_PX / Math.max(cropWInches, 0.1));
  dpi = Math.min(Math.max(dpi, 150), 600);
  const pageWpx = (wPt / 72) * dpi, pageHpx = (hPt / 72) * dpi;
  const X = Math.round(x * pageWpx), Y = Math.round(y * pageHpx);
  const W = Math.round(w * pageWpx), H = Math.round(h * pageHpx);

  const outDir = path.join(tmpDir, 'zoom_' + Date.now());
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const result = spawnSync('pdftoppm', [
      '-r', String(dpi), '-jpeg', '-jpegopt', 'quality=88',
      '-f', String(page), '-l', String(page),
      '-x', String(X), '-y', String(Y), '-W', String(W), '-H', String(H),
      srcPath, path.join(outDir, 'crop'),
    ], { timeout: 60000, encoding: 'buffer' });
    if (result.status !== 0 && result.status !== null) {
      return { ok: false, reason: 'pdftoppm failed: ' + (result.stderr ? result.stderr.toString().substring(0, 200) : '') };
    }
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg') || f.endsWith('.jpeg'));
    if (files.length === 0) return { ok: false, reason: `region of page ${page} not rendered — page may be out of range` };
    let buf = fs.readFileSync(path.join(outDir, files[0]));
    // Keep under Anthropic's 5MB image cap by recompressing/resizing with sharp.
    if (buf.length > 4.5 * 1024 * 1024 && sharp) {
      try {
        buf = await sharp(buf).resize({ width: 2200, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      } catch (e) {}
    }
    return { ok: true, base64: buf.toString('base64'), mediaType: 'image/jpeg', dpi };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {}
  }
}

// Synchronous tool execution — mutates the run state and returns a tool_result
// content block to send back to Claude in the next turn.
async function executeTool(runId, toolName, toolInput, runState) {
  switch (toolName) {
    case 'view_pdf_page': {
      setActivity(runId, `Viewing ${toolInput.filename} page ${toolInput.page}`);
      const rendered = await renderPdfPage(runState.tmpDir, toolInput.filename, toolInput.page);
      if (!rendered.ok) {
        return { type: 'tool_result', content: `Could not render ${toolInput.filename} page ${toolInput.page}: ${rendered.reason}`, is_error: true };
      }
      return {
        type: 'tool_result',
        content: [
          { type: 'image', source: { type: 'base64', media_type: rendered.mediaType, data: rendered.base64 } },
          { type: 'text', text: `(${toolInput.filename} page ${toolInput.page} rendered at 200 DPI)` },
        ],
      };
    }

    case 'zoom_region': {
      setActivity(runId, `Zooming into ${toolInput.filename} page ${toolInput.page}`);
      const rendered = await renderPdfRegion(runState.tmpDir, toolInput.filename, toolInput.page, {
        x: toolInput.x, y: toolInput.y, w: toolInput.w, h: toolInput.h,
      });
      if (!rendered.ok) {
        return { type: 'tool_result', content: `Could not zoom ${toolInput.filename} page ${toolInput.page}: ${rendered.reason}`, is_error: true };
      }
      return {
        type: 'tool_result',
        content: [
          { type: 'image', source: { type: 'base64', media_type: rendered.mediaType, data: rendered.base64 } },
          { type: 'text', text: `(Zoomed region of ${toolInput.filename} page ${toolInput.page} — rendered at ${rendered.dpi} DPI. Read any dimensions/scale here as ground truth.)` },
        ],
      };
    }

    case 'set_project_metadata': {
      setActivity(runId, `Recording project: ${toolInput.project_type} · ${toolInput.floor_area_m2}m²`);
      runState.metadata = { ...runState.metadata, ...toolInput };
      updateRun(runId, {
        project_type: toolInput.project_type,
        location: toolInput.location,
        floor_area_m2: toolInput.floor_area_m2,
        spec_level: toolInput.spec_level,
      });
      emit(runId, { type: 'metadata', metadata: runState.metadata });
      return { type: 'tool_result', content: `Recorded. Project: ${toolInput.project_type}, ${toolInput.floor_area_m2}m², ${toolInput.location}, ${toolInput.spec_level} spec.` };
    }

    case 'record_takeoff_item': {
      setActivity(runId, `Recording ${toolInput.key} — ${toolInput.qty} ${toolInput.unit}`);
      // Dedupe: if same key already exists, replace
      const existingIdx = runState.items.findIndex(i => i.key === toolInput.key);
      const item = {
        key: toolInput.key,
        description: toolInput.description,
        qty: toolInput.qty,
        unit: toolInput.unit,
        section: toolInput.section,
        assumed_rate: toolInput.assumed_rate || null,
      };
      if (existingIdx >= 0) {
        runState.items[existingIdx] = item;
      } else {
        runState.items.push(item);
      }
      updateRun(runId, { takeoff_json: JSON.stringify(runState.items) });
      emit(runId, { type: 'takeoff_item', action: existingIdx >= 0 ? 'updated' : 'added', item, total: runState.items.length });
      return { type: 'tool_result', content: `Recorded. Takeoff now has ${runState.items.length} items.` };
    }

    case 'update_takeoff_item': {
      const item = runState.items.find(i => i.key === toolInput.key);
      if (!item) return { type: 'tool_result', content: `No item with key ${toolInput.key}.`, is_error: true };
      setActivity(runId, `Updating ${toolInput.key} → ${toolInput.new_qty}`);
      const oldQty = item.qty;
      item.qty = toolInput.new_qty;
      item.update_reason = toolInput.reason;
      updateRun(runId, { takeoff_json: JSON.stringify(runState.items) });
      emit(runId, { type: 'takeoff_item', action: 'updated', item, oldQty, reason: toolInput.reason });
      return { type: 'tool_result', content: `Updated ${toolInput.key} from ${oldQty} to ${toolInput.new_qty}. Reason: ${toolInput.reason}` };
    }

    case 'remove_takeoff_item': {
      const idx = runState.items.findIndex(i => i.key === toolInput.key);
      if (idx < 0) return { type: 'tool_result', content: `No item with key ${toolInput.key}.`, is_error: true };
      setActivity(runId, `Removing ${toolInput.key}`);
      const removed = runState.items.splice(idx, 1)[0];
      updateRun(runId, { takeoff_json: JSON.stringify(runState.items) });
      emit(runId, { type: 'takeoff_item', action: 'removed', item: removed, reason: toolInput.reason });
      return { type: 'tool_result', content: `Removed ${toolInput.key}. Reason: ${toolInput.reason}` };
    }

    case 'run_pricer': {
      setActivity(runId, 'Running deterministic pricer');
      const pricer = require('./deterministicPricer');
      if (runState.items.length === 0) {
        return { type: 'tool_result', content: 'No items to price yet. Call record_takeoff_item first.', is_error: true };
      }
      // Build clientRates from user's rate library
      const clientRates = {};
      try {
        const rates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(runState.userId);
        for (const r of rates) clientRates[r.item_key] = r.value;
      } catch (e) {}

      const meta = runState.metadata || {};
      // Fold the intake's Ireland hint into the location string if the agent
      // set a UK-only location (e.g. just "Dublin") so the pricer's Ireland
      // detection fires. Also pass explicit currency as a last-resort override.
      let effectiveLocation = meta.location || '';
      if (runState.intakeCurrency === 'EUR' && !/ireland|ir$|\.ie|€/i.test(effectiveLocation)) {
        effectiveLocation = effectiveLocation ? `${effectiveLocation}, Ireland` : 'Ireland';
      }
      let priced;
      try {
        priced = pricer.priceLockedQuantities(runState.items, effectiveLocation, clientRates, {
          project_type: meta.project_type || '',
          floor_area: meta.floor_area_m2 || null,
          contingency_pct: 7.5,
          ohp_pct: 12,
          ...(runState.intakeCurrency ? { currency: runState.intakeCurrency } : {}),
        });
      } catch (err) {
        return { type: 'tool_result', content: 'Pricer error: ' + err.message, is_error: true };
      }
      // Quantity sanity check — compare each recorded item against the
      // user's historical quantity ranges for this project type. Surfaces
      // "you recorded only 40m² of plasterboard for a 100m² extension,
      // typical is 280-350m²" type warnings back to the agent.
      let sanityWarnings = [];
      try {
        const memoryEngine = require('./memoryEngine');
        sanityWarnings = memoryEngine.sanityCheckWithMemory(db, {
          items: runState.items,
          projectType: meta.project_type || '',
          floorAreaM2: meta.floor_area_m2 || null,
        }) || [];
      } catch (e) {}

      // Variance note — compare cost/m² against the user's past projects.
      let varianceNote = null;
      try {
        const memoryEngine = require('./memoryEngine');
        const region = memoryEngine.detectRegion(effectiveLocation);
        const benchmarks = memoryEngine.getProjectBenchmarks(db, { projectType: meta.project_type || '', region });
        if (benchmarks && benchmarks.cost_per_m2 && benchmarks.cost_per_m2.avg && meta.floor_area_m2) {
          const thisCpm2 = priced.summary.construction_total / meta.floor_area_m2;
          const avg = benchmarks.cost_per_m2.avg;
          const deviation = (thisCpm2 - avg) / avg;
          const sym2 = priced.summary.currency === 'EUR' ? '€' : '£';
          if (Math.abs(deviation) >= 0.3) {
            varianceNote = `${deviation > 0 ? 'HIGH' : 'LOW'}: ${sym2}${Math.round(thisCpm2)}/m² is ${Math.round(Math.abs(deviation) * 100)}% ${deviation > 0 ? 'above' : 'below'} your typical ${sym2}${Math.round(avg)}/m² (range ${sym2}${Math.round(benchmarks.cost_per_m2.min)}–${sym2}${Math.round(benchmarks.cost_per_m2.max)}/m² over ${benchmarks.sample_count} past projects)`;
          }
        }
      } catch (e) {}

      updateRun(runId, {
        priced_json: JSON.stringify(priced),
        construction_total: priced.summary.construction_total || null,
        grand_total: priced.summary.grand_total || null,
        currency: priced.summary.currency || null,
        sanity_warnings: sanityWarnings.length > 0 ? JSON.stringify(sanityWarnings) : null,
        variance_note: varianceNote,
      });
      emit(runId, { type: 'priced', priced, sanity_warnings: sanityWarnings, variance_note: varianceNote });

      const sym = priced.summary.currency === 'EUR' ? '€' : '£';
      const costPerM2 = meta.floor_area_m2 ? Math.round(priced.summary.construction_total / meta.floor_area_m2) : null;
      const summaryLines = [
        `Construction total: ${sym}${Math.round(priced.summary.construction_total).toLocaleString('en-GB')}`,
        `Grand total (inc VAT): ${sym}${Math.round(priced.summary.grand_total).toLocaleString('en-GB')}`,
        costPerM2 ? `Cost per m²: ${sym}${costPerM2} (over ${meta.floor_area_m2}m²)` : null,
        varianceNote ? `⚠️ Variance vs past projects: ${varianceNote}` : null,
        sanityWarnings.length > 0 ? `⚠️ ${sanityWarnings.length} quantity sanity warning(s) — review before finalising` : null,
        `Sections: ${priced.sections.length}`,
        `Warnings: ${(priced.warnings || []).length}`,
      ].filter(Boolean);

      const warningsText = (priced.warnings || []).length > 0
        ? '\n\nWarnings from the pricer (review carefully — caps, auto-corrections, and rate clips are flagged here):\n' + priced.warnings.map(w => '- ' + w).join('\n')
        : '';

      // Append the memory-based sanity warnings so the agent can investigate
      // and fix any quantities that look off vs the user's historical jobs.
      const sanityText = sanityWarnings.length > 0
        ? '\n\nQUANTITY SANITY WARNINGS (vs user\'s past projects — consider fixing before submit_for_review):\n' + sanityWarnings.map(w => '- ' + w.message).join('\n')
        : '';
      const varianceText = varianceNote
        ? `\n\nCOST VARIANCE vs past jobs: ${varianceNote}\nIf this is LOW, you may have missed items — prelims, M&E, external works, scaffolding. If HIGH, check for double-counts.`
        : '';

      const sectionLines = priced.sections.map(s => `  - ${s.name}: ${sym}${Math.round(s.subtotal).toLocaleString('en-GB')}`).join('\n');

      return {
        type: 'tool_result',
        content: summaryLines.join('\n') + '\n\nSections:\n' + sectionLines + warningsText + sanityText + varianceText,
      };
    }

    case 'submit_for_review':
    case 'finalize_boq': {
      // Both tool names now route here — finalize_boq kept as legacy alias.
      // Rather than generating docs, we hand the takeoff to the USER for
      // review. Docs are produced when the user clicks Generate (triggers
      // runGenerationForRun below via POST /api/agent/:id/generate).
      setActivity(runId, 'Ready for your review — tweak quantities if needed, then click Generate');
      const summary = toolInput.review_summary || 'Takeoff complete. Please review items below, adjust any quantities if needed, then click Generate to produce the Excel and Word deliverables.';

      // Capture structured findings if the agent provided them (preferred);
      // fall back to the legacy single-blob notes. Persist as one JSON object
      // so runGenerationForRun can rebuild a proper findings report rather
      // than dumping the same string into every section.
      const structured = {
        review_summary: summary,
        scope_summary: toolInput.scope_summary || '',
        project_description: toolInput.project_description || '',
        key_findings: Array.isArray(toolInput.key_findings) ? toolInput.key_findings : [],
        assumptions: Array.isArray(toolInput.assumptions) ? toolInput.assumptions : [],
        exclusions: Array.isArray(toolInput.exclusions) ? toolInput.exclusions : [],
        recommendations: Array.isArray(toolInput.recommendations) ? toolInput.recommendations : [],
      };
      // Build a human-readable notes blob from the structured fields so
      // legacy consumers (and any saved findings prompts) still get sensible
      // text. If the agent ONLY supplied findings_notes, keep that text too.
      const noteLines = [];
      if (structured.scope_summary) noteLines.push(structured.scope_summary);
      if (structured.key_findings.length) {
        for (const kf of structured.key_findings) {
          if (!kf || typeof kf !== 'object') continue;
          if (kf.title) noteLines.push('\n' + kf.title);
          if (kf.detail) noteLines.push(kf.detail);
          if (Array.isArray(kf.items)) noteLines.push(kf.items.map(x => '• ' + x).join('\n'));
        }
      }
      if (structured.assumptions.length) noteLines.push('\nAssumptions:\n' + structured.assumptions.map(x => '• ' + x).join('\n'));
      if (structured.exclusions.length)  noteLines.push('\nExclusions:\n'  + structured.exclusions.map(x => '• ' + x).join('\n'));
      if (structured.recommendations.length) noteLines.push('\nRecommendations:\n' + structured.recommendations.map(x => '• ' + x).join('\n'));
      const composed = noteLines.join('\n').trim();
      const notes = composed || toolInput.findings_notes || '';
      structured.findings_notes_text = notes;

      // Make sure we have a current priced snapshot so the review panel
      // can show headline totals even if the model hasn't just re-run.
      if (!runState.lastPriced || !runState.lastPriced.summary) {
        try {
          const meta = runState.metadata || {};
          const pricer = require('./deterministicPricer');
          const clientRates = {};
          try {
            const rates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(runState.userId);
            for (const r of rates) clientRates[r.item_key] = r.value;
          } catch (e) {}
          let effectiveLocation = meta.location || '';
          if (runState.intakeCurrency === 'EUR' && !/ireland|ir$|\.ie|€/i.test(effectiveLocation)) {
            effectiveLocation = effectiveLocation ? `${effectiveLocation}, Ireland` : 'Ireland';
          }
          runState.lastPriced = pricer.priceLockedQuantities(runState.items, effectiveLocation, clientRates, {
            project_type: meta.project_type || '',
            floor_area: meta.floor_area_m2 || null,
            contingency_pct: 7.5, ohp_pct: 12,
            ...(runState.intakeCurrency ? { currency: runState.intakeCurrency } : {}),
          });
        } catch (e) { console.error(`[Agent ${runId}] review pre-price error:`, e.message); }
      }
      const priced = runState.lastPriced;

      // Recompute sanity + variance at review time using current items so
      // the user sees fresh warnings even if record/update happened after
      // the last run_pricer call.
      let sanityWarnings = [];
      let varianceNote = null;
      try {
        const memoryEngine = require('./memoryEngine');
        sanityWarnings = memoryEngine.sanityCheckWithMemory(db, {
          items: runState.items,
          projectType: runState.metadata?.project_type || '',
          floorAreaM2: runState.metadata?.floor_area_m2 || null,
        }) || [];
        if (priced?.summary && runState.metadata?.floor_area_m2) {
          const region = memoryEngine.detectRegion(runState.metadata?.location || '');
          const bench = memoryEngine.getProjectBenchmarks(db, { projectType: runState.metadata.project_type || '', region });
          if (bench?.cost_per_m2?.avg) {
            const thisCpm2 = priced.summary.construction_total / runState.metadata.floor_area_m2;
            const dev = (thisCpm2 - bench.cost_per_m2.avg) / bench.cost_per_m2.avg;
            const sym2 = priced.summary.currency === 'EUR' ? '€' : '£';
            if (Math.abs(dev) >= 0.3) {
              varianceNote = `${dev > 0 ? 'HIGH' : 'LOW'}: ${sym2}${Math.round(thisCpm2)}/m² is ${Math.round(Math.abs(dev) * 100)}% ${dev > 0 ? 'above' : 'below'} your typical ${sym2}${Math.round(bench.cost_per_m2.avg)}/m² (range ${sym2}${Math.round(bench.cost_per_m2.min)}–${sym2}${Math.round(bench.cost_per_m2.max)}/m² over ${bench.sample_count} past projects)`;
            }
          }
        }
      } catch (e) {}

      updateRun(runId, {
        status: 'awaiting_review',
        findings_notes: notes,
        findings_structured: JSON.stringify(structured),
        review_summary: summary,
        priced_json: priced ? JSON.stringify(priced) : null,
        construction_total: priced?.summary?.construction_total || null,
        grand_total: priced?.summary?.grand_total || null,
        currency: priced?.summary?.currency || null,
        sanity_warnings: sanityWarnings.length > 0 ? JSON.stringify(sanityWarnings) : null,
        variance_note: varianceNote,
      });

      // Mirror the takeoff into quantity_takeoffs so the chat session sees a
      // locked takeoff and "generate documents" works in the chat flow. The
      // run is session-scoped — without this row chat.js says "I can't find
      // the locked quantities for this session" and asks the user to upload
      // their drawings again.
      try {
        const run = getRun(runId);
        if (run && run.session_id) {
          const benchmarkStore = require('./benchmarkStore');
          const existing = benchmarkStore.getTakeoffBySession(db, run.session_id);
          const meta = runState.metadata || {};
          const projectName = meta.project_type || run.project_type || 'Atlas project';
          if (existing) {
            benchmarkStore.updateTakeoff(db, existing.id, {
              items: runState.items,
              status: 'confirmed',
            });
          } else {
            benchmarkStore.saveTakeoff(db, {
              userId: run.user_id,
              sessionId: run.session_id,
              projectName,
              projectType: meta.project_type || run.project_type || null,
              location: meta.location || run.location || '',
              items: runState.items,
              status: 'confirmed',
            });
          }
        }
      } catch (mirrorErr) { console.error(`[Agent ${runId}] takeoff mirror error:`, mirrorErr.message); }

      runState.finalized = true;  // signals runner to exit the tool-use loop
      emit(runId, { type: 'submitted_for_review', summary, findings_notes: notes, structured, priced: priced?.summary, sanity_warnings: sanityWarnings, variance_note: varianceNote });
      return { type: 'tool_result', content: `Submitted to user for review. ${runState.items.length} items, ${priced?.summary ? (priced.summary.currency === 'EUR' ? '€' : '£') + Math.round(priced.summary.grand_total).toLocaleString('en-GB') : '(no total)'} grand total. The user will now review and approve generation — your work is complete.` };
    }

    default:
      return { type: 'tool_result', content: `Unknown tool: ${toolName}`, is_error: true };
  }
}

// Run the actual Excel + Word generation for a run that's been through the
// review flow. Called either by a user-triggered POST /api/agent/:id/generate
// or by the auto-finalise safety net when a run times out without review.
async function runGenerationForRun(runId, opts = {}) {
  const run = getRun(runId);
  if (!run) throw new Error('Run not found');

  let items = [];
  try { items = run.takeoff_json ? JSON.parse(run.takeoff_json) : []; } catch (e) {}
  if (items.length === 0) throw new Error('No items to generate from');

  // The agent stores the readable narrative in findings_notes and the
  // structured object (assumptions / exclusions / etc.) in
  // findings_structured. The user can override the narrative through the
  // review-panel textarea; in that case we use their text but keep the
  // structured sections as the agent supplied them.
  let structuredNotes = null;
  try {
    if (run.findings_structured) structuredNotes = JSON.parse(run.findings_structured);
  } catch (e) { structuredNotes = null; }
  const notesText = (opts.findings_notes != null ? opts.findings_notes : (run.findings_notes || '')).toString();

  const pricer = require('./deterministicPricer');
  const boqGen = require('./boqGenerator');
  const findingsGen = require('./findingsGenerator');

  // Re-price with current items so any user edits are reflected
  const clientRates = {};
  try {
    const rates = db.prepare('SELECT item_key, value FROM client_rate_library WHERE user_id = ? AND is_active = 1').all(run.user_id);
    for (const r of rates) clientRates[r.item_key] = r.value;
  } catch (e) {}

  let location = run.location || '';
  const intakeIsIreland = run.currency === 'EUR' || /ireland/i.test(location);
  if (intakeIsIreland && !/ireland|ir$|\.ie|€/i.test(location)) {
    location = location ? `${location}, Ireland` : 'Ireland';
  }
  const priced = pricer.priceLockedQuantities(items, location, clientRates, {
    project_type: run.project_type || '',
    floor_area: run.floor_area_m2 || null,
    contingency_pct: 7.5, ohp_pct: 12,
    ...(intakeIsIreland ? { currency: 'EUR' } : {}),
  });

  // Phase 9 verifier (ported to the Atlas path): a final deterministic gate over
  // the takeoff. We don't block generation here (the agent already self-corrected
  // and the user reviewed), but error-level failures are surfaced into the
  // findings report and emitted so the QS sees them rather than shipping silently.
  let verification = null;
  try {
    const { verifyTakeoff } = require('./verifyTakeoff');
    verification = verifyTakeoff({
      items,
      floorAreaM2: run.floor_area_m2 || null,
      projectType: run.project_type || '',
      pricedResult: priced,
    });
    const errs = verification.failures.filter((f) => f.severity === 'error');
    if (errs.length) {
      console.warn(`[Agent ${runId}] verifier flagged ${errs.length} issue(s): ${errs.map((e) => e.code).join(', ')}`);
      emit(runId, { type: 'activity', activity: `Verification flagged ${errs.length} issue(s) for review` });
    }
  } catch (e) { console.error(`[Agent ${runId}] verify error:`, e.message); }

  const projectName = run.project_type || 'Project';
  const safeName = projectName.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 50);
  const ts = Date.now();
  const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
  const outputsDir = path.join(DATA_DIR, 'outputs');
  if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

  setActivity(runId, 'Generating Excel + Word deliverables');

  const sym = priced.summary.currency === 'EUR' ? '€' : '£';
  const downloads = [];
  const genErrors = [];
  let _branding = null;
  try { _branding = require('./brandingRoutes').getBrandingForUser(run.user_id); } catch (e) { /* optional */ }

  try {
    const boqSections = pricer.toPricedSections ? pricer.toPricedSections(priced) : priced.sections;
    const excelBuf = await boqGen.generateBOQExcel(boqSections, projectName, '', {
      contingency_pct: priced.summary.contingency_pct,
      ohp_pct: priced.summary.ohp_pct,
      vat_rate: priced.summary.vat_rate,
      currency: sym,
      branding: _branding,
      project_type: run.project_type || '',
      location: run.location || '',
      spec_level: run.spec_level || '',
      floor_area_m2: run.floor_area_m2 || null,
    });
    if (excelBuf && excelBuf.length > 100) {
      // Phase 9 recalc gate (ported to the Atlas path): the workbook's summed
      // line totals must reconcile to the pricer's construction total to the
      // penny. Warns by default; STRICT_RECALC=1 hard-fails generation.
      try {
        const { assertBOQMatches } = require('./recalcGate');
        const rc = await assertBOQMatches(excelBuf, priced.summary.construction_total);
        if (!rc.ok) {
          console.error(`[Agent ${runId}] RECALC MISMATCH: sheet ${rc.lineSum} vs pricer ${rc.expected} (diff ${rc.diff})`);
          if (process.env.STRICT_RECALC === '1') throw new Error(`BOQ recalc mismatch (diff ${rc.diff})`);
        } else {
          console.log(`[Agent ${runId}] Recalc OK — ${rc.rows} lines reconcile to ${rc.expected}`);
        }
      } catch (recErr) {
        if (process.env.STRICT_RECALC === '1') throw recErr;
        console.error(`[Agent ${runId}] recalc gate:`, recErr.message);
      }
      const fname = `BOQ-${safeName}-${ts}.xlsx`;
      fs.writeFileSync(path.join(outputsDir, fname), excelBuf);
      downloads.push({ name: fname, type: 'xlsx', url: `/api/downloads/${fname}`, size: excelBuf.length });
    } else {
      genErrors.push('Excel BOQ buffer was empty.');
    }
  } catch (excelErr) {
    console.error(`[Agent ${runId}] Excel gen error:`, excelErr.stack || excelErr.message);
    genErrors.push('Excel BOQ failed: ' + excelErr.message);
  }

  // Build the structured findings object the docx renderer expects.
  // Prefer the agent's structured fields. If only the legacy single-blob
  // text is available, fall back to one rolled-up finding and a sensible
  // default exclusions list rather than three duplicate notes blobs.
  const findingsObj = {
    reference: runId.slice(-8).toUpperCase(),
    project_type: projectName,
    location: run.location || '',
    description: structuredNotes?.project_description || projectName,
    scope_summary: structuredNotes?.scope_summary || notesText || '',
    key_findings: Array.isArray(structuredNotes?.key_findings) && structuredNotes.key_findings.length
      ? structuredNotes.key_findings
      : (notesText ? [{ title: 'Atlas working notes', detail: notesText, items: [] }] : []),
    assumptions: Array.isArray(structuredNotes?.assumptions) && structuredNotes.assumptions.length
      ? structuredNotes.assumptions
      : [
          'Quantities are taken from the drawings supplied; subject to verification on site.',
          'Specifications follow the floor plan / elevation notes provided, with standard finishes where unspecified.',
        ],
    exclusions: Array.isArray(structuredNotes?.exclusions) && structuredNotes.exclusions.length
      ? structuredNotes.exclusions
      : [
          'Professional fees (architect, engineer, planning).',
          'Statutory fees and approvals.',
          'Surveys and site investigations.',
          'FF&E, white goods and loose furnishings.',
          'Abnormal ground conditions or other items not visible from the drawings.',
        ],
    recommendations: Array.isArray(structuredNotes?.recommendations) ? structuredNotes.recommendations : [],
    cost_summary: {
      sections: priced.sections.map(s => ({ name: s.name, total: s.subtotal })),
      net_total: priced.summary.net_total,
      contingency_pct: priced.summary.contingency_pct,
      contingency: priced.summary.contingency,
      ohp_pct: priced.summary.ohp_pct,
      ohp: priced.summary.ohp,
      vat_rate: priced.summary.vat_rate,
      vat: priced.summary.vat,
      grand_total: priced.summary.grand_total,
      currency: sym,
    },
  };

  // Surface verifier error flags into the findings so the QS sees them before
  // issuing — never ship silently with deterministic failures.
  if (verification && !verification.ok) {
    const errs = verification.failures.filter((f) => f.severity === 'error');
    if (errs.length) {
      findingsObj.key_findings = [
        ...(findingsObj.key_findings || []),
        { title: 'Automated verification flags — review before issue', detail: 'The deterministic verifier flagged the following; confirm or correct each:', items: errs.map((e) => e.message) },
      ];
    }
  }

  try {
    const wordBuf = await findingsGen.generateFindingsReport(findingsObj, '', projectName, _branding);
    if (wordBuf && wordBuf.length > 100) {
      const fname = `Findings-${safeName}-${ts}.docx`;
      fs.writeFileSync(path.join(outputsDir, fname), wordBuf);
      downloads.push({ name: fname, type: 'docx', url: `/api/downloads/${fname}`, size: wordBuf.length });
    } else {
      genErrors.push('Findings Word buffer was empty.');
    }
  } catch (wordErr) {
    console.error(`[Agent ${runId}] Word gen error:`, wordErr.stack || wordErr.message);
    genErrors.push('Findings Word failed: ' + wordErr.message);
  }

  // Persist structured findings against the run's project (if it has one)
  // so the customer can edit and re-export.
  try {
    if (run.project_id) {
      db.prepare(
        'INSERT OR REPLACE INTO project_data (project_id, data_type, data) VALUES (?, ?, ?)'
      ).run(run.project_id, 'findings_json', JSON.stringify(findingsObj));
    }
  } catch (pdErr) { /* best-effort */ }

  // If BOTH outputs failed, mark the run failed instead of pretending
  // it completed — the user has no deliverables, so saying "Complete"
  // would be a lie.
  if (downloads.length === 0) {
    const msg = genErrors.length ? genErrors.join(' ') : 'No deliverables were produced.';
    updateRun(runId, {
      status: 'failed',
      error_message: msg,
      completed_at: new Date().toISOString(),
      priced_json: JSON.stringify(priced),
    });
    emit(runId, { type: 'error', message: msg });
    return { downloads, priced, errors: genErrors };
  }

  updateRun(runId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    download_files: JSON.stringify(downloads),
    priced_json: JSON.stringify(priced),
    construction_total: priced.summary.construction_total || null,
    grand_total: priced.summary.grand_total || null,
    currency: priced.summary.currency || null,
    error_message: genErrors.length ? genErrors.join(' ') : null,
  });
  emit(runId, { type: 'finalized', downloads, priced: priced.summary, errors: genErrors });
  emit(runId, { type: 'run_complete', reason: 'user_generated' });
  return { downloads, priced, errors: genErrors };
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  runGenerationForRun,
  updateRun,
  getRun,
  appendMessage,
  getMessages,
  setActivity,
  subscribe,
  emit,
};

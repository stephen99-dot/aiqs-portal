/**
 * evidenceSupervisor.js — starts the evidence sidecar inside this process's
 * container and keeps it alive.
 *
 * WHY IN-PROCESS AND NOT A SEPARATE SERVICE. The sidecar reads uploaded
 * drawings BY PATH. On Render (and any similar host) a second web service gets
 * its own filesystem, so it would never see the uploads. Running it as a child
 * of the Node server keeps one container, one disk, one deploy — and the
 * lifecycle is automatic: it starts when the portal starts and dies with it.
 *
 * It is ALWAYS OPTIONAL. If Python or PyMuPDF is missing the portal logs one
 * clear line and carries on; every evidence call then resolves to
 * { available: false } and takeoffs are reported as visual-only. Never let a
 * missing evidence layer stop the portal from running.
 *
 * Disable entirely with EVIDENCE_DISABLED=1 (e.g. to point at a sidecar you are
 * running yourself via EVIDENCE_URL).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EVIDENCE_DIR = path.join(__dirname, '..', 'evidence');
const PORT = Number(process.env.EVIDENCE_PORT) || 8021;
const HOST = process.env.EVIDENCE_HOST || '127.0.0.1';
// Restart with backoff, but give up rather than thrash if it cannot start at all.
const MAX_RESTARTS = 5;
const RESTART_BASE_MS = 2000;

let child = null;
let restarts = 0;
let stopped = false;

function pythonCandidates() {
  const explicit = process.env.PYTHON_BIN;
  return explicit ? [explicit] : ['python3', 'python'];
}

/** Does this interpreter have the one dependency that actually matters? */
function hasPyMuPDF(bin) {
  const { spawnSync } = require('child_process');
  try {
    const r = spawnSync(bin, ['-c', 'import pymupdf'], { timeout: 15000 });
    return r.status === 0;
  } catch { return false; }
}

function findPython() {
  for (const bin of pythonCandidates()) {
    if (hasPyMuPDF(bin)) return bin;
  }
  return null;
}

function start() {
  if (stopped || child) return;
  if (process.env.EVIDENCE_DISABLED === '1') {
    console.log('[Evidence] disabled by EVIDENCE_DISABLED=1 — takeoffs will be reported as visual-only unless EVIDENCE_URL points elsewhere.');
    return;
  }
  if (!fs.existsSync(path.join(EVIDENCE_DIR, 'app.py'))) {
    console.log('[Evidence] evidence/app.py not found — evidence layer off.');
    return;
  }

  const python = findPython();
  if (!python) {
    console.log(
      '[Evidence] OFF — no Python interpreter with PyMuPDF was found. Takeoffs will be measured '
      + 'visually and reported as estimates rather than proven measurements. To turn it on, add '
      + '"pip install -r evidence/requirements.txt" to the build command.'
    );
    return;
  }

  child = spawn(python, ['-m', 'uvicorn', 'app:app', '--host', HOST, '--port', String(PORT), '--log-level', 'warning'], {
    cwd: EVIDENCE_DIR,
    env: { ...process.env, EVIDENCE_ROOT: process.env.EVIDENCE_ROOT || '/' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => process.stdout.write('[Evidence] ' + d));
  child.stderr.on('data', (d) => process.stderr.write('[Evidence] ' + d));

  child.on('exit', (code, signal) => {
    child = null;
    if (stopped) return;
    if (restarts >= MAX_RESTARTS) {
      console.error(`[Evidence] gave up after ${MAX_RESTARTS} restarts — the portal continues without it.`);
      return;
    }
    const delay = RESTART_BASE_MS * Math.pow(2, restarts);
    restarts++;
    console.error(`[Evidence] exited (code ${code}, signal ${signal}) — restarting in ${delay}ms (${restarts}/${MAX_RESTARTS}).`);
    setTimeout(start, delay).unref?.();
  });

  console.log(`[Evidence] starting on http://${HOST}:${PORT} using ${python}`);

  // Confirm it actually came up, so the log says what is true rather than what
  // was attempted.
  setTimeout(async () => {
    try {
      const { isAvailable } = require('./evidenceClient');
      const ok = await isAvailable();
      console.log(ok
        ? '[Evidence] ready — scale proofs and vector harvesting are available to Atlas.'
        : '[Evidence] started but not answering yet; it may still be warming up.');
    } catch { /* never let a health probe break boot */ }
  }, 4000).unref?.();
}

function stop() {
  stopped = true;
  if (child) { try { child.kill('SIGTERM'); } catch {} child = null; }
}

process.on('exit', stop);
process.on('SIGTERM', () => { stop(); });
process.on('SIGINT', () => { stop(); });

module.exports = { start, stop, PORT, HOST };

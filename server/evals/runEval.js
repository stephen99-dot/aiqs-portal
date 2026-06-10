#!/usr/bin/env node
// Takeoff eval harness (Phase 7) — the regression "measuring stick".
//
// For each fixture (a folder under fixtures/), it compares a captured takeoff
// (actual.json) against the agreed golden takeoff (expected.json): item-count
// delta, total construction-value delta %, and missing/extra items. It exits
// non-zero if any job drifts past the thresholds — so it can gate CI on changes
// to prompts, models, or the takeoff pipeline (Phase 11).
//
// Usage:
//   node server/evals/runEval.js [--fixtures <dir>] [--value-threshold 5]
//
// Fixture folder layout (see README.md):
//   fixtures/<job-name>/expected.json   { items:[...], location?, project_type?, options? }
//   fixtures/<job-name>/actual.json     { items:[...] }   (the captured run; optional)
//
// If actual.json is absent the job is reported PENDING (not a failure) — capture
// a run through the live pipeline and drop its items in as actual.json.

const fs = require('fs');
const path = require('path');
const { compareJob } = require('./diff');

function parseArgs(argv) {
  const args = { fixtures: path.join(__dirname, 'fixtures'), valueThreshold: 5 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--fixtures') args.fixtures = path.resolve(argv[++i]);
    else if (argv[i] === '--value-threshold') args.valueThreshold = Number(argv[++i]);
  }
  return args;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.fixtures)) {
    console.error(`No fixtures directory at ${args.fixtures}. See server/evals/README.md.`);
    process.exit(2);
  }
  const dirs = fs.readdirSync(args.fixtures, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (dirs.length === 0) {
    console.log('No fixtures yet. Drop a golden job under server/evals/fixtures/<name>/. See README.md.');
    process.exit(0);
  }

  console.log(`\nTakeoff eval — ${dirs.length} fixture(s), value threshold ±${args.valueThreshold}%\n`);
  console.log(`${pad('JOB', 24)} ${padL('ITEMS e/a', 11)} ${padL('Δitems', 7)} ${padL('VALUE e/a', 22)} ${padL('Δ%', 8)}  RESULT`);
  console.log('-'.repeat(92));

  let failures = 0, pending = 0;
  for (const name of dirs) {
    const dir = path.join(args.fixtures, name);
    const expected = readJson(path.join(dir, 'expected.json'));
    if (!expected || !Array.isArray(expected.items)) {
      console.log(`${pad(name, 24)} ${padL('—', 11)} ${padL('—', 7)} ${padL('—', 22)} ${padL('—', 8)}  SKIP (no/invalid expected.json)`);
      continue;
    }
    const actual = readJson(path.join(dir, 'actual.json'));
    if (!actual || !Array.isArray(actual.items)) {
      pending++;
      console.log(`${pad(name, 24)} ${padL('—', 11)} ${padL('—', 7)} ${padL('—', 22)} ${padL('—', 8)}  PENDING (no actual.json)`);
      continue;
    }

    const r = compareJob(expected, actual);
    const overValue = Math.abs(r.valueDeltaPct) > args.valueThreshold;
    const hasMissing = r.missing.length > 0;
    const fail = overValue || hasMissing;
    if (fail) failures++;

    const itemsCol = `${r.expectedCount}/${r.actualCount}`;
    const valueCol = `${r.expectedTotal}/${r.actualTotal}`;
    const result = fail
      ? `FAIL${hasMissing ? ' -' + r.missing.length + ' missing' : ''}${overValue ? ' value' : ''}`
      : 'ok';
    console.log(`${pad(name, 24)} ${padL(itemsCol, 11)} ${padL(r.countDelta, 7)} ${padL(valueCol, 22)} ${padL(r.valueDeltaPct, 8)}  ${result}`);

    if (r.missing.length) console.log(`    missing: ${r.missing.map((i) => i.description || i.key).slice(0, 6).join(' | ')}`);
    if (r.extra.length) console.log(`    extra:   ${r.extra.map((i) => i.description || i.key).slice(0, 6).join(' | ')}`);
  }

  console.log('-'.repeat(92));
  console.log(`${failures} failing, ${pending} pending, ${dirs.length - failures - pending} ok\n`);
  // Pending jobs don't fail the run; only real regressions do.
  process.exit(failures > 0 ? 1 : 0);
}

main();

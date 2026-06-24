#!/usr/bin/env node
// Parity report — how closely the automated takeoff reproduces a job done by
// hand in the Claude front end. Same comparison engine as runEval.js
// (diff.compareJob), but framed as a positive "how close are we to the
// human-blessed answer" report rather than a pass/fail CI gate. This is the
// artifact to show when someone asks "is the automated pipeline as accurate as
// doing the job manually?".
//
// Fixture layout (identical to the regression harness — see README.md):
//   fixtures/<job>/expected.json  = the hand-run / human-blessed takeoff (golden)
//   fixtures/<job>/actual.json    = the takeoff the upgraded pipeline produced
//
// Usage:
//   node server/evals/parity.js [--fixtures <dir>] [--threshold 5] [--json]
//
// Unlike runEval.js this never fails the build (exit 0 unless the fixtures dir is
// missing) — it reports, it doesn't gate. Use runEval.js for the CI gate.

const fs = require('fs');
const path = require('path');
const { compareJob } = require('./diff');

function parseArgs(argv) {
  const args = { fixtures: path.join(__dirname, 'fixtures'), threshold: 5, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--fixtures') args.fixtures = path.resolve(argv[++i]);
    else if (argv[i] === '--threshold') args.threshold = Number(argv[++i]);
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function curSym(opts) { const c = (opts && opts.currency) || 'GBP'; return c === 'EUR' ? '€' : c === 'USD' ? '$' : '£'; }
function money(sym, n) { return sym + Math.round(Number(n || 0)).toLocaleString('en-GB'); }
function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function round1(n) { return Math.round(Number(n || 0) * 10) / 10; }
function signed(n) { return (n > 0 ? '+' : '') + n + '%'; }

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.fixtures)) {
    console.error(`No fixtures directory at ${args.fixtures}. See server/evals/README.md.`);
    process.exit(2);
  }
  const dirs = fs.readdirSync(args.fixtures, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();

  const rows = [];
  let pending = 0;
  for (const name of dirs) {
    const dir = path.join(args.fixtures, name);
    const expected = readJson(path.join(dir, 'expected.json'));
    if (!expected || !Array.isArray(expected.items)) continue;
    const actual = readJson(path.join(dir, 'actual.json'));
    if (!actual || !Array.isArray(actual.items)) { pending++; rows.push({ name, pending: true }); continue; }
    rows.push({ name, pending: false, sym: curSym(expected.options), ...compareJob(expected, actual) });
  }

  const compared = rows.filter((r) => !r.pending);
  const absDeltas = compared.map((r) => Math.abs(r.valueDeltaPct));
  const summary = {
    jobsCompared: compared.length,
    jobsPending: pending,
    medianAbsDeltaPct: round1(median(absDeltas)),
    meanAbsDeltaPct: round1(absDeltas.reduce((a, b) => a + b, 0) / (absDeltas.length || 1)),
    worstAbsDeltaPct: round1(absDeltas.length ? Math.max(...absDeltas) : 0),
    withinThreshold: compared.filter((r) => Math.abs(r.valueDeltaPct) <= args.threshold).length,
    threshold: args.threshold,
    totalMissingItems: compared.reduce((a, r) => a + r.missing.length, 0),
  };

  if (args.json) { console.log(JSON.stringify({ summary, jobs: compared }, null, 2)); process.exit(0); }

  console.log(`\nAI QS — automated pipeline vs hand-run parity`);
  console.log(`Fixtures: ${args.fixtures}   ·   ${compared.length} job(s) compared${pending ? `, ${pending} not yet captured` : ''}\n`);
  if (!compared.length) {
    console.log('No captured jobs yet. For each job you ran by hand, save its blessed items as');
    console.log('expected.json and the upgraded pipeline\'s items as actual.json, then re-run.');
    console.log('See server/evals/README.md → "Parity report".\n');
    process.exit(0);
  }
  console.log(`${pad('JOB', 26)} ${padL('VALUE hand-run / auto', 30)} ${padL('Δ%', 8)} ${padL('items h/a', 11)} ${padL('missing', 8)}`);
  console.log('-'.repeat(88));
  for (const r of compared) {
    const val = `${money(r.sym, r.expectedTotal)} / ${money(r.sym, r.actualTotal)}`;
    const clean = Math.abs(r.valueDeltaPct) <= args.threshold && r.missing.length === 0;
    console.log(`${pad(r.name, 26)} ${padL(val, 30)} ${padL(signed(r.valueDeltaPct), 8)} ${padL(r.expectedCount + '/' + r.actualCount, 11)} ${padL(r.missing.length, 8)}${clean ? '' : '  <-- review'}`);
    if (r.missing.length) console.log(`    missing: ${r.missing.map((i) => i.description || i.key).slice(0, 6).join(' | ')}`);
  }
  for (const r of rows.filter((x) => x.pending)) {
    console.log(`${pad(r.name, 26)} ${padL('— not captured yet —', 30)}`);
  }
  console.log('-'.repeat(88));
  console.log(`\nAcross ${summary.jobsCompared} hand-run job(s):`);
  console.log(`  • Value vs hand-run:        median ${summary.medianAbsDeltaPct}%  ·  mean ${summary.meanAbsDeltaPct}%  ·  worst ${summary.worstAbsDeltaPct}%`);
  console.log(`  • Within ±${summary.threshold}% of hand-run:    ${summary.withinThreshold} / ${summary.jobsCompared} jobs`);
  console.log(`  • Missing line items:       ${summary.totalMissingItems} total across all jobs`);
  console.log(`\n  Verdict: the automated pipeline reproduces hand-run BOQ value within a median`);
  console.log(`  of ${summary.medianAbsDeltaPct}% (worst ${summary.worstAbsDeltaPct}%), with ${summary.totalMissingItems} missing line item(s) across ${summary.jobsCompared} job(s).\n`);
  process.exit(0);
}

main();

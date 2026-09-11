#!/usr/bin/env node
// Verify every delivered bill in the portal against its own printed total and
// list the ones that fail. Run on the server (it opens the live database):
//   node scripts/audit-boqs.js          # reuse stored results
//   node scripts/audit-boqs.js --force  # re-check every file now
// Failing bills are already locked for their customers; this is how you see
// how many there are and why, in one go.
const { auditAll } = require('../server/boqVerify');

(async () => {
  const force = process.argv.includes('--force');
  const rows = await auditAll({ force });
  const bad = rows.filter((r) => !r.ok);
  console.log(`${rows.length} project(s) with a BOQ, ${bad.length} failing verification${force ? ' (fresh check)' : ''}.`);
  for (const r of rows) {
    const d = r.detail || {};
    console.log(
      (r.ok ? '  OK    ' : '  LOCKED') + '  ' + String(r.status).padEnd(17) + (r.title || r.project_id).slice(0, 40).padEnd(42)
      + ' read £' + String(d.parsed_total ?? '—').padStart(12) + '  printed £' + String(d.printed_total ?? '—').padStart(12)
      + '  ' + (r.boq_filename || '')
    );
    if (!r.ok) console.log('          ' + r.message);
  }
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

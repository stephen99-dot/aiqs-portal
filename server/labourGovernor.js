/**
 * labourGovernor.js — plausibility gate on labour, run before a bill is issued.
 *
 * The pricer is deterministic on arithmetic and completely unguarded on
 * plausibility, and both failure directions have reached issue:
 *
 *   - Rates assembled component by component drift LIGHT, in one direction,
 *     every time, because each component allowance looks generous on its own
 *     and the sum does not.
 *   - Gang-scale constants multiplied by a single-trade day rate produce a
 *     bill roughly double the work's worth.
 *
 * The test is deliberately crude and hard to argue with:
 *
 *     convert every labour figure back to UNITS PER TRADE-DAY
 *     and ask whether one operative does that in a day.
 *
 * This never edits a price. It returns findings for a human to settle —
 * a rate outside the band is a question, not proof of an error.
 */

// One operative, one day. Sources: corrected new-build and fit-out packages
// where a component-built set was measured against the delivered programme.
// `min`/`max` bound the plausible band; outside it the line is flagged.
const BENCHMARKS = [
  // key            match on description        unit   min    max    note
  { key: 'brickwork_facing', re: /facing brick|brickwork|brick facework/i, unit: 'm2', min: 4, max: 10,
    note: 'bricklayer: 6-7 m2/day of half-brick wall' },
  { key: 'blockwork', re: /block\s?work|aerated block|concrete block/i, unit: 'm2', min: 6, max: 16,
    note: 'blocklayer: 215 aerated ~0.135 trade-days/m2' },
  { key: 'drylining', re: /dry\s?lin|plasterboard|stud partition|boarding/i, unit: 'm2', min: 20, max: 55,
    note: 'dry liner: 30-40 m2/day boarding' },
  { key: 'plaster_skim', re: /skim|plaster(?!board)|render/i, unit: 'm2', min: 25, max: 70,
    note: 'plasterer: 40-60 m2/day skim' },
  { key: 'roof_single_ply', re: /single ply|adhered membrane|epdm|tpo/i, unit: 'm2', min: 15, max: 45,
    note: 'roofer: 25-35 m2/day adhered single ply' },
  { key: 'rainscreen', re: /rainscreen|larch clad|timber clad/i, unit: 'm2', min: 5, max: 14,
    note: 'joiner: 8-10 m2/day open rainscreen larch' },
  { key: 'painting', re: /emulsion|paint|decorat/i, unit: 'm2', min: 25, max: 70,
    note: 'two-coat emulsion ~0.020-0.024 trade-days/m2' },
  { key: 'floor_tiling', re: /floor tile|tiling|gres|ceramic floor/i, unit: 'm2', min: 5, max: 18,
    note: 'tiling: derive from tiles/m2 and setting-out difficulty' },
  { key: 'excavation_machine', re: /machine excavat|excavate.*(trench|reduce)/i, unit: 'm3', min: 8, max: 30,
    note: 'machine trench excavation ~0.075 trade-days/m3' },
  { key: 'concrete_trench', re: /concrete.*(trench|foundation)|c\d{2}\b.*concrete/i, unit: 'm3', min: 2, max: 8,
    note: 'concrete to trench ~0.28 trade-days/m3' },
  { key: 'windows', re: /window|doorset|glazed unit/i, unit: 'nr', min: 1, max: 6,
    note: 'window installation ~0.22 trade-days/m2' },
  { key: 'sockets', re: /socket outlet|lighting point|switch(?:ed)? socket/i, unit: 'nr', min: 4, max: 12,
    note: 'socket outlet ~0.15 trade-days each' },
  { key: 'fencing', re: /fenc|line post|mesh panel/i, unit: 'm', min: 12, max: 25,
    note: '30-45 m/day of completed fence per TWO-MAN gang = 15-22 per operative' },
];

// Units where a "per day" test is meaningless — a lump sum, a provisional
// sum, a week of supervision. Skipped rather than flagged.
const NON_MEASURED_UNITS = /^(item|sum|nr\s*sum|ls|lump|wk|week|day|month|visit|%|prov|p\.?sum)$/i;

/** Combined output for a two-operation rate: 1/(1/a + 1/b), never the slower.
 *  Rake out at 4 m2/day and point at 6 gives 2.40, not 4. */
function combinedOutput(a, b) {
  const x = Number(a), y = Number(b);
  if (!(x > 0) || !(y > 0)) return null;
  return 1 / (1 / x + 1 / y);
}

function matchBenchmark(description) {
  const d = String(description || '');
  for (const b of BENCHMARKS) if (b.re.test(d)) return b;
  return null;
}

/**
 * @param {Array} sections  priced sections ({ title, items:[{description, unit, qty, labour, ...}] })
 * @param {object} opts
 *   dayRate      blended single-operative day rate (default 250)
 *   toleranceX   how far outside the band before flagging (default 1.0 = the band itself)
 * @returns {{findings:Array, stats:object, summary:string}}
 */
function runLabourGovernor(sections, opts = {}) {
  const dayRate = Number(opts.dayRate) > 0 ? Number(opts.dayRate) : 250;
  const findings = [];
  const stats = { itemsTested: 0, itemsSkipped: 0, tooFast: 0, tooSlow: 0, totalLabour: 0 };

  for (const section of sections || []) {
    for (const item of (section.items || [])) {
      const labour = Number(item.labour) || 0;
      const qty = Number(item.qty) || 0;
      stats.totalLabour += labour;

      const unit = String(item.unit || '').trim();
      if (!labour || !qty || NON_MEASURED_UNITS.test(unit)) { stats.itemsSkipped++; continue; }

      const bench = matchBenchmark(item.description);
      if (!bench || bench.unit.toLowerCase() !== unit.toLowerCase()) { stats.itemsSkipped++; continue; }

      // Labour money -> operative-days -> units per operative-day.
      const tradeDays = labour / dayRate;
      if (tradeDays <= 0) { stats.itemsSkipped++; continue; }
      const unitsPerDay = qty / tradeDays;
      stats.itemsTested++;

      const tol = Number(opts.toleranceX) > 0 ? Number(opts.toleranceX) : 1.0;
      const lo = bench.min / tol;
      const hi = bench.max * tol;

      if (unitsPerDay > hi) {
        // More units per day than a person can do => the labour is too LIGHT.
        stats.tooFast++;
        findings.push({
          severity: unitsPerDay > hi * 2 ? 'high' : 'medium',
          direction: 'labour_light',
          item: item.item || '', section: section.title || '',
          description: String(item.description || '').slice(0, 90),
          unitsPerDay: Math.round(unitsPerDay * 100) / 100,
          band: `${bench.min}-${bench.max} ${bench.unit}/day`,
          note: bench.note,
          message: `implies ${unitsPerDay.toFixed(1)} ${unit}/operative-day against a plausible ${bench.min}-${bench.max}; labour looks light`,
        });
      } else if (unitsPerDay < lo) {
        // Fewer units per day than plausible => labour too HEAVY. The classic
        // cause is a gang-scale constant multiplied by a single-trade day rate.
        stats.tooSlow++;
        findings.push({
          severity: unitsPerDay < lo / 2 ? 'high' : 'medium',
          direction: 'labour_heavy',
          item: item.item || '', section: section.title || '',
          description: String(item.description || '').slice(0, 90),
          unitsPerDay: Math.round(unitsPerDay * 100) / 100,
          band: `${bench.min}-${bench.max} ${bench.unit}/day`,
          note: bench.note,
          message: `implies ${unitsPerDay.toFixed(2)} ${unit}/operative-day against a plausible ${bench.min}-${bench.max}; check for a gang-scale constant priced at a single-trade day rate`,
        });
      }
    }
  }

  // Whole-bill cross-check: operative-days over the bill, for the programme.
  const operativeDays = stats.totalLabour / dayRate;
  stats.operativeDays = Math.round(operativeDays * 10) / 10;

  const high = findings.filter((f) => f.severity === 'high').length;
  const summary = findings.length === 0
    ? `Labour governor: ${stats.itemsTested} measured lines all within benchmark bands (${stats.operativeDays} operative-days).`
    : `Labour governor: ${findings.length} line(s) outside benchmark (${high} high) of ${stats.itemsTested} tested; ${stats.operativeDays} operative-days.`;

  return { findings, stats, summary };
}

module.exports = { runLabourGovernor, combinedOutput, BENCHMARKS };

// recalcGate.js — Phase 9 recalc gate for generated BOQ workbooks.
//
// After builderExports/boqGenerator produces the Excel BOQ, re-open it with
// exceljs and recompute the line-item chain in JS, then assert the workbook's
// summed line totals equal the deterministic pricer's construction total to the
// penny. This is the recalc.py equivalent: a generated document must reconcile
// to the authoritative numbers, not just look right.
//
// The data rows in boqGenerator put: col3 = unit, col4 = qty, col5 = rate,
// col8 = line total. We recompute qty*rate per data row and also read the stored
// total, and sum across the sheet.
//
// Hard-gate behaviour is ON by default: a bill whose line items do not sum to
// the pricer's construction total is not issued. Set STRICT_RECALC=0 to fall
// back to warn-and-flag.
//
// This was warn-only until a real job proved the cost of that: a whole-house
// remodel was delivered where the chat reported £1,170,875 and the spreadsheet's
// line items summed to £141,123. This gate detected the £1,029,752 gap exactly
// (ok:false, diff -1029752.16) and the bill shipped anyway, because nothing
// acted on the result. Verified before flipping: a legitimate bill reconciles
// to the penny (diff 0) with contingency and OH&P at 0/0, 5/0, 5/15 and 0/15,
// so markups do not false-positive.

const ExcelJS = require('exceljs');

const PENNY = 0.01;

async function recomputeBOQ(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // The BOQ line items live on the 'BOQ' sheet (the first sheet is the cover).
  const ws = wb.getWorksheet('BOQ') || wb.worksheets[wb.worksheets.length - 1];

  let lineSum = 0;          // sum of stored line totals (col 8)
  let recomputedSum = 0;    // sum of qty*rate recomputed in JS
  let rows = 0;
  const mismatches = [];

  ws.eachRow((row) => {
    const unit = cellNum(row, 3) === null ? cellStr(row, 3) : cellStr(row, 3);
    const qty = cellNum(row, 4);
    const rate = cellNum(row, 5);
    const total = cellNum(row, 8);
    // A data row has a numeric qty AND rate AND a non-empty unit string.
    if (qty === null || rate === null || !unit) return;
    rows++;
    const recomputed = round2(qty * rate);
    recomputedSum = round2(recomputedSum + recomputed);
    if (total !== null) {
      lineSum = round2(lineSum + total);
      if (Math.abs(recomputed - total) > PENNY) {
        mismatches.push({ row: row.number, qty, rate, stored: total, recomputed });
      }
    } else {
      lineSum = round2(lineSum + recomputed);
    }
  });

  return { lineSum, recomputedSum, rows, mismatches };
}

// True unless the operator has explicitly opted out. Exported so the call
// sites share one definition of "strict" rather than each testing the env var.
function isStrictRecalc() { return process.env.STRICT_RECALC !== '0'; }

// Assert the workbook reconciles to the deterministic construction total.
// Returns { ok, lineSum, expected, diff, mismatches }. Throws unless
// STRICT_RECALC=0; the thrown error carries `.recalc` with the same figures so
// a caller can still report them.
async function assertBOQMatches(buffer, expectedConstructionTotal) {
  const r = await recomputeBOQ(buffer);
  const expected = round2(expectedConstructionTotal);
  const diff = round2(r.lineSum - expected);
  const cellChainOk = r.mismatches.length === 0;
  const totalOk = Math.abs(diff) <= PENNY;
  const ok = cellChainOk && totalOk;

  if (!ok) {
    const msg = `[recalc] BOQ does not reconcile: sheet line-sum ${r.lineSum} vs pricer construction total ${expected} (diff ${diff}); ${r.mismatches.length} per-row qty*rate mismatches.`;
    if (isStrictRecalc()) {
      const err = new Error(msg);
      err.recalc = { ...r, expected, diff };
      throw err;
    }
    console.error(msg);
  }
  return { ok, lineSum: r.lineSum, expected, diff, rows: r.rows, mismatches: r.mismatches };
}

function cellNum(row, c) {
  const v = row.getCell(c).value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result; // formula cell
  return null;
}
function cellStr(row, c) {
  const v = row.getCell(c).value;
  if (v == null) return '';
  if (typeof v === 'object' && v.text) return String(v.text);
  return String(v).trim();
}
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

module.exports = { recomputeBOQ, assertBOQMatches, isStrictRecalc };

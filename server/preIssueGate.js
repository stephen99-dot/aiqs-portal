/**
 * preIssueGate.js — deterministic, blocking checks on the ISSUED workbook.
 *
 * Runs against the actual buffer we are about to send, not the in-memory
 * workbook, because the defects this catches are introduced by serialisation
 * and are invisible on our own screen.
 *
 * The governing principle: a `data_only` read (cached values, no
 * recalculation) IS the previewer's view. Google Drive/Sheets, Apple Numbers,
 * Outlook preview, SharePoint preview, Excel mobile and iOS Quick Look all
 * render the cache. Most clients open an emailed BOQ in a previewer before
 * they ever open Excel, so a bill with uncached formulas reads as broken —
 * "all the totals are at zero" — while being perfect for us.
 *
 * Usage:
 *   const { runPreIssueGate } = require('./preIssueGate');
 *   const report = await runPreIssueGate(buffer, { sheet: 'BOQ' });
 *   if (report.blocking) throw new Error(report.summary);
 */
const ExcelJS = require('exceljs');

// Money comparisons tolerate half a penny of float noise.
const MONEY_EPS = 0.005;

// Strings that must never reach a client-facing cell. `%%` is the classic —
// a literal "Contingency at 5.0%%" survived a full arithmetic audit and
// reached a client on one of the two most-read rows of the bill.
const TEXT_DEFECTS = [
  { re: /%%/, label: 'literal %% (broken format string)' },
  { re: /%[ds]\b/, label: 'unresolved %d / %s placeholder' },
  { re: /\bundefined\b/i, label: 'literal "undefined"' },
  { re: /\bNaN\b/, label: 'literal NaN' },
  { re: /\bnull\b/i, label: 'literal "null"' },
  { re: /\[object Object\]/, label: 'stringified object' },
];

// Checked only inside priced-line descriptions — elsewhere run-on spacing is
// deliberate typography (section headings, the hero strip).
const DESCRIPTION_DEFECTS = [
  { re: /\S {2,}\S/, label: 'doubled spaces mid-description' },
];

// Words that betray internal process in a client-facing document. Findings are
// findings in their own right and are never presented as a movement against a
// previous figure (house rule: no second passes, re-checks or revisions in
// anything client-facing).
const FORBIDDEN_NARRATIVE = [
  'first pass', 'second pass', 're-check', 'recheck', 'earlier draft',
  'was wrong', 'previously priced', 'audit found', 'correction applied',
];

function isFormulaCell(cell) {
  return cell && cell.value && typeof cell.value === 'object' && 'formula' in cell.value;
}

function cachedValue(cell) {
  if (!isFormulaCell(cell)) return cell ? cell.value : null;
  return cell.value.result;
}

// Only genuine numbers count. Never coerce strings: a date cell reading
// "24/08/2026" stripped of punctuation becomes 24082026, and a header row
// then parses as a priced line.
function numeric(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return numeric(v.result);
  return null;
}

function cellText(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v && typeof v.result === 'string') return v.result;
    if (v.text) return String(v.text);
    return '';
  }
  return String(v);
}

/**
 * @param {Buffer} buffer  the .xlsx bytes we are about to issue
 * @param {object} opts
 *   sheet         name of the priced sheet (default 'BOQ')
 *   qtyCol/rateCol/labourCol/materialsCol/totalCol  1-based column indexes
 *   expectedMaxColumn  assert the bill ends at this column (omit to skip)
 * @returns {Promise<{blocking:boolean, errors:string[], warnings:string[], summary:string, stats:object}>}
 */
async function runPreIssueGate(buffer, opts = {}) {
  const sheetName = opts.sheet || 'BOQ';
  const QTY = opts.qtyCol || 4;
  const RATE = opts.rateCol || 5;
  const LAB = opts.labourCol || 6;
  const MAT = opts.materialsCol || 7;
  const TOT = opts.totalCol || 8;

  const errors = [];
  const warnings = [];
  const stats = { formulaCells: 0, uncachedFormulas: 0, pricedLines: 0, textDefects: 0 };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    return {
      blocking: true,
      errors: [`Sheet "${sheetName}" not found in the issued workbook.`],
      warnings: [], stats,
      summary: `Pre-issue gate FAILED: sheet "${sheetName}" missing.`,
    };
  }

  // ── 1. The empty-cache defect. Highest priority: silent, and client-facing.
  ws.eachRow((row, rn) => {
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      if (!isFormulaCell(cell)) return;
      stats.formulaCells++;
      const res = cell.value.result;
      if (res === undefined || res === null || res === '') {
        stats.uncachedFormulas++;
        errors.push(`Row ${rn} col ${cn}: formula has no cached value — renders blank/0 in every previewer.`);
      }
    });
  });

  // ── 2. Priced lines: no zero/blank totals, and the two identities hold.
  ws.eachRow((row, rn) => {
    const qty = numeric(cachedValue(row.getCell(QTY)));
    const rate = numeric(cachedValue(row.getCell(RATE)));
    const total = numeric(cachedValue(row.getCell(TOT)));
    // A priced line is one carrying both a quantity and a rate. Recap and
    // narrative rows deliberately leave those blank.
    if (qty == null || rate == null || qty === 0) return;
    stats.pricedLines++;

    if (total == null || total === 0) {
      errors.push(`Row ${rn}: priced line has a blank or zero Total.`);
      return;
    }
    const expected = qty * rate;
    if (Math.abs(expected - total) > Math.max(MONEY_EPS, Math.abs(expected) * 0.02)) {
      warnings.push(`Row ${rn}: Qty x Rate (${expected.toFixed(2)}) does not reconcile to Total (${total.toFixed(2)}).`);
    }
    const lab = numeric(cachedValue(row.getCell(LAB)));
    const mat = numeric(cachedValue(row.getCell(MAT)));
    if (lab != null && mat != null) {
      const sum = lab + mat;
      if (Math.abs(sum - total) > MONEY_EPS) {
        errors.push(`Row ${rn}: Labour + Materials (${sum.toFixed(2)}) does not equal Total (${total.toFixed(2)}).`);
      }
    }
  });

  // ── 3. Merged-cell label loss. mergeCells destroys the value of every cell
  // that is not the top-left anchor, so a whole cascade can carry correct
  // figures and no labels — and an arithmetic audit passes clean.
  ws.eachRow((row, rn) => {
    const total = numeric(cachedValue(row.getCell(TOT)));
    if (total == null) return;
    const qty = numeric(cachedValue(row.getCell(QTY)));
    if (qty != null) return; // priced line, label lives in the description
    // A summary/cascade row: carries a total but no quantity. It must be labelled.
    let label = '';
    for (let c = 1; c <= 3 && !label; c++) label = cellText(row.getCell(c)).trim();
    if (!label) {
      errors.push(`Row ${rn}: summary row carries a value (${total}) with no label — merged-cell text loss.`);
    }
  });

  // ── 4. Text defects across every string cell in the issued file.
  const seenText = new Set();
  ws.eachRow((row, rn) => {
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      // A merged range reports the same text on every covered cell; check the
      // anchor only so one defect is reported once, not nine times.
      if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
      const text = cellText(cell);
      if (!text) return;
      const key = rn + '|' + text;
      if (seenText.has(key)) return;
      seenText.add(key);
      const isPricedDesc = cn === 2 && numeric(cachedValue(row.getCell(QTY))) != null;
      const rules = isPricedDesc ? TEXT_DEFECTS.concat(DESCRIPTION_DEFECTS) : TEXT_DEFECTS;
      for (const d of rules) {
        if (d.re.test(text)) {
          stats.textDefects++;
          errors.push(`Row ${rn} col ${cn}: ${d.label} — "${text.slice(0, 60)}"`);
        }
      }
      const lower = text.toLowerCase();
      for (const phrase of FORBIDDEN_NARRATIVE) {
        if (lower.includes(phrase)) {
          errors.push(`Row ${rn} col ${cn}: internal-process wording "${phrase}" in a client-facing cell.`);
        }
      }
    });
  });

  // ── 5. Print set-up. fitToHeight must be 0 ("as many pages tall as it
  // takes"); 1 collapses the whole bill onto one page and renders it at an
  // unreadable scale.
  const ps = ws.pageSetup || {};
  if (ps.fitToPage && ps.fitToHeight !== 0) {
    errors.push(`pageSetup.fitToHeight is ${ps.fitToHeight} — must be 0, or the bill prints at a collapsed scale.`);
  }
  if (!ps.printTitlesRow) {
    warnings.push('pageSetup.printTitlesRow is not set — the header row will not repeat on later printed pages.');
  }

  // ── 6. House format rules.
  const frozen = (ws.views || []).some((v) => v && (v.state === 'frozen' || v.state === 'split'));
  if (frozen) errors.push('Workbook has frozen panes or a split — house format forbids both.');

  if (opts.expectedMaxColumn && ws.columnCount > opts.expectedMaxColumn) {
    warnings.push(`Sheet runs to column ${ws.columnCount}; house format expects ${opts.expectedMaxColumn}.`);
  }

  const blocking = errors.length > 0;
  const summary = blocking
    ? `Pre-issue gate FAILED: ${errors.length} blocking defect(s), ${warnings.length} warning(s).`
    : `Pre-issue gate passed: ${stats.formulaCells} formulas cached, ${stats.pricedLines} priced lines reconciled, ${warnings.length} warning(s).`;

  return { blocking, errors, warnings, stats, summary };
}

module.exports = { runPreIssueGate };

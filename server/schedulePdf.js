// schedulePdf.js — branded build-programme PDF (landscape Gantt-style table).
// Kept in its own module so a route just streams it, mirroring quotePdf.js.

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

function fmtDate(iso, withYear) {
  if (!iso) return '—';
  const parts = String(iso).slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  });
}

function dayIndex(iso) {
  const p = String(iso).slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}

const STATUS_LABEL = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
};

// Stream a programme PDF to an Express response.
function streamSchedulePdf(res, plan, tasks, branding, userInfo) {
  const primary = (branding && branding.primary_colour) || '#1B2A4A';
  const accent = (branding && branding.accent_colour) || '#F59E0B';
  const companyName = (branding && branding.company_name) || (userInfo && (userInfo.company || userInfo.full_name)) || 'Build programme';

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
  const filename = (plan.title || 'build-programme').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const pageBottom = doc.page.height - doc.page.margins.bottom;

  // ── Header band ──
  let logoShown = false;
  if (branding && branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, pageLeft, 36, { fit: [120, 40] }); logoShown = true; } catch (e) {}
    }
  }
  doc.fillColor(primary).fontSize(18).font('Helvetica-Bold')
    .text(companyName, logoShown ? pageLeft + 132 : pageLeft, 38, { width: 400 });
  doc.fillColor('#475569').fontSize(11).font('Helvetica')
    .text(plan.title || 'Build programme', logoShown ? pageLeft + 132 : pageLeft, 60, { width: 400 });

  const win = programmeWindow(tasks);
  doc.fontSize(9).fillColor('#64748B').text(
    (win.start ? fmtDate(win.start, true) + '  →  ' + fmtDate(win.end, true) : 'No dated tasks yet')
    + '   ·   ' + tasks.length + ' task' + (tasks.length === 1 ? '' : 's'),
    pageRight - 320, 44, { width: 320, align: 'right' }
  );

  doc.moveTo(pageLeft, 80).lineTo(pageRight, 80).strokeColor(accent).lineWidth(2).stroke();

  // ── Layout geometry ──
  const nameColW = 210;
  const metaColW = 150;                       // start–end + days, drawn under name area
  const barLeft = pageLeft + nameColW + metaColW + 12;
  const barRight = pageRight;
  const barAreaW = Math.max(60, barRight - barLeft);

  const win0 = win.start ? dayIndex(win.start) : 0;
  const win1 = win.end ? dayIndex(win.end) : 0;
  const span = Math.max(1, win1 - win0 + 1);   // total calendar days, inclusive
  const xForDay = (di) => barLeft + ((di - win0) / span) * barAreaW;

  // Month gridlines + labels across the bar area, drawn from a given top down to
  // the page bottom. Re-run on every page so the date axis is never lost.
  const drawMonthGrid = (topY) => {
    if (!win.start || !win.end) return;
    doc.fontSize(7.5).font('Helvetica').fillColor('#94A3B8');
    const start = new Date(win0 * 86400000);
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    let guard = 0;
    while (dayIndex(cur.toISOString()) <= win1 && guard++ < 60) {
      const di = dayIndex(cur.toISOString());
      if (di >= win0) {
        const x = xForDay(di);
        doc.moveTo(x, topY).lineTo(x, pageBottom).strokeColor('#EEF2F7').lineWidth(1).stroke();
        doc.fillColor('#94A3B8').text(
          cur.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
          x + 2, topY - 10, { width: 60, lineBreak: false }
        );
      }
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  };

  let y = 96;
  drawMonthGrid(y);

  // ── Rows, grouped by phase ──
  const rowH = 20;
  let lastPhase = null;

  const ensureSpace = (needed) => {
    if (y + needed <= pageBottom) return;
    doc.addPage();
    y = doc.page.margins.top + 14; // leave room for the month labels
    drawMonthGrid(y);
    lastPhase = null;
  };

  const phaseColour = (s) => s === 'done' ? '#16A34A'
    : s === 'in_progress' ? accent
    : s === 'blocked' ? '#DC2626'
    : primary;

  for (const t of tasks) {
    if ((t.phase || '') !== (lastPhase || '') ) {
      ensureSpace(rowH + 6);
      lastPhase = t.phase || '';
      if (lastPhase) {
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor(primary)
          .text(lastPhase, pageLeft, y + 4, { width: nameColW + metaColW });
        y += rowH;
      }
    }

    ensureSpace(rowH);

    doc.fontSize(8.5).font('Helvetica').fillColor('#1E293B')
      .text(t.name || '(unnamed)', pageLeft + 8, y + 5, { width: nameColW - 8, lineBreak: false, ellipsis: true });

    const days = parseInt(t.duration_days, 10) || 1;
    doc.fontSize(7.5).fillColor('#64748B').text(
      fmtDate(t.planned_start) + '–' + fmtDate(t.planned_end) + '  (' + days + 'd)',
      pageLeft + nameColW, y + 5, { width: metaColW, lineBreak: false }
    );

    // Bar
    if (t.planned_start && t.planned_end && win.start) {
      const x0 = xForDay(dayIndex(t.planned_start));
      const x1 = xForDay(dayIndex(t.planned_end) + 1); // +1 so a 1-day task has width
      const w = Math.max(3, x1 - x0);
      const col = phaseColour(t.status);
      doc.roundedRect(x0, y + 3, w, rowH - 8, 2).fillColor(col).fillOpacity(0.85).fill();
      doc.fillOpacity(1);
      const pct = Math.max(0, Math.min(100, parseInt(t.percent_complete, 10) || 0));
      if (pct > 0 && pct < 100) {
        doc.roundedRect(x0, y + 3, Math.max(2, w * pct / 100), rowH - 8, 2).fillColor(col).fill();
      }
    }

    y += rowH;
  }

  // Footer note
  ensureSpace(28);
  doc.fontSize(7).font('Helvetica').fillColor('#94A3B8').text(
    'Indicative programme generated by AI QS — verify durations and sequencing against site conditions before relying on dates.',
    pageLeft, pageBottom - 4, { width: pageRight - pageLeft }
  );

  doc.end();
}

// Local copy so the module is self-contained (mirrors scheduleEngine).
function programmeWindow(tasks) {
  let start = null;
  let end = null;
  for (const t of tasks || []) {
    if (t.planned_start && (!start || t.planned_start < start)) start = t.planned_start;
    if (t.planned_end && (!end || t.planned_end > end)) end = t.planned_end;
  }
  return { start, end };
}

module.exports = { streamSchedulePdf };

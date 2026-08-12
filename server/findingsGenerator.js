// ═══════════════════════════════════════════════════════════════════════════════
// FINDINGS REPORT GENERATOR — server/findingsGenerator.js
//
// Renders the structured findings JSON as a branded .docx in the house report
// style (modelled on the delivered tender findings reports): Arial, a navy
// masthead band with the company name over a tinted "FINDINGS REPORT" band,
// numbered section headings ruled in the accent colour, real bulleted lists,
// a bordered cost table with a navy header row, and a running page header /
// "Page X of Y" footer.
//
// The section headings keep the wording the deliverable seeder recognises
// (Project description / Scope summary / Key findings / Assumptions /
// Exclusions / Recommendations), so a delivered report round-trips back into
// the Findings editor.
// ═══════════════════════════════════════════════════════════════════════════════

const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType, PageNumber,
  Header, Footer, LevelFormat, VerticalAlign,
} = require('docx');

// Mix a hex colour towards white — used to derive the tinted title band and
// total-row fill from the brand's primary colour.
function tint(hex6, amount) {
  const n = parseInt(hex6, 16);
  const mix = (v) => Math.round(v + (255 - v) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), bl = mix(n & 255);
  return ((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0').toUpperCase();
}

async function generateFindingsReport(findings, clientName, projectName, branding) {
  const ref = findings.reference || ('AI-QS-' + Date.now().toString(36).toUpperCase().slice(-6));

  const b = branding || {};
  function hex(s, fallback) {
    if (typeof s !== 'string') return fallback;
    const m = s.replace('#', '').toUpperCase();
    return /^[0-9A-F]{6}$/.test(m) ? m : fallback;
  }
  const navy = hex(b.primary_colour, '1F3864');
  const gold = hex(b.accent_colour, 'C9A227');
  const band = tint(navy, 0.85);
  const totalFill = tint(navy, 0.90);
  const GREY = '595959';
  const docFont = (b.template === 'professional' || b.template === 'heritage') ? 'Cambria' : 'Arial';
  const company = b.company_name || 'The AI QS';
  const footerLine = b.footer_text || 'theaiqs.co.uk';
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const run = (text, opts = {}) => new TextRun({ text, font: docFont, ...opts });
  const body = (text, opts = {}) => new Paragraph({
    children: [run(text, { size: 20, ...opts })], spacing: { after: 120 },
  });
  const bullet = (text) => new Paragraph({
    children: [run(text, { size: 20 })],
    numbering: { reference: 'findings-bullets', level: 0 },
    spacing: { after: 70 },
  });

  // Numbered section headings, ruled in the accent colour like the delivered
  // reports. Numbering is sequential over the sections actually present.
  let sectionNo = 0;
  const heading = (title) => {
    sectionNo += 1;
    return new Paragraph({
      children: [run(sectionNo + '.  ' + title, { bold: true, size: 26, color: navy })],
      border: { bottom: { color: gold, size: 8, style: BorderStyle.SINGLE } },
      spacing: { before: 280, after: 140 },
    });
  };

  const children = [];

  // ── Masthead: navy company band over a tinted report band ────────────────
  // With a logo the band becomes a borderless two-cell table (name left, logo
  // right) so the logo sits INSIDE the navy band rather than floating above it.
  let logo = null;
  try { logo = await require('./docTemplates').resolveLogo(b); } catch (e) { /* logo optional */ }
  const companyRun = run('  ' + String(company).toUpperCase(), { bold: true, size: 34, color: 'FFFFFF' });
  if (logo && logo.buffer) {
    const maxW = 150, maxH = 44;
    let w = maxW, h = maxH;
    if (logo.naturalWidth && logo.naturalHeight) {
      const scale = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight);
      w = Math.max(1, Math.round(logo.naturalWidth * scale));
      h = Math.max(1, Math.round(logo.naturalHeight * scale));
    }
    const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };
    const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
    children.push(new Table({
      rows: [new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [companyRun], spacing: { before: 40, after: 40 } })],
            width: { size: 6800, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: navy },
            verticalAlign: VerticalAlign.CENTER,
            borders: noBorders,
          }),
          new TableCell({
            children: [new Paragraph({
              children: [new ImageRun({ data: logo.buffer, type: logo.extension || 'png', transformation: { width: w, height: h } })],
              alignment: AlignmentType.RIGHT,
              spacing: { before: 40, after: 40 },
            })],
            width: { size: 2658, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: navy },
            verticalAlign: VerticalAlign.CENTER,
            borders: noBorders,
            margins: { right: 100 },
          }),
        ],
      })],
      width: { size: 9458, type: WidthType.DXA },
      columnWidths: [6800, 2658],
      borders: {
        top: NONE, bottom: NONE, left: NONE, right: NONE,
        insideHorizontal: NONE, insideVertical: NONE,
      },
    }));
  } else {
    children.push(new Paragraph({
      children: [companyRun],
      shading: { type: ShadingType.CLEAR, fill: navy },
      spacing: { after: 0 },
    }));
  }
  children.push(new Paragraph({
    children: [run('  FINDINGS REPORT', { bold: true, size: 24, color: navy })],
    shading: { type: ShadingType.CLEAR, fill: band },
    spacing: { after: 240 },
  }));

  // ── Title block ──────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [run(projectName, { bold: true, size: 28, color: navy })],
    spacing: { after: 60 },
  }));
  const subtitleBits = [];
  if (findings.project_type) subtitleBits.push(findings.project_type);
  if (findings.location) subtitleBits.push(findings.location);
  if (subtitleBits.length) {
    children.push(new Paragraph({
      children: [run(subtitleBits.join(' — '), { size: 22 })],
      spacing: { after: 60 },
    }));
  }
  children.push(new Paragraph({
    children: [run(
      'Prepared for ' + (clientName || 'Client') + '   |   Reference ' + ref + '   |   ' + dateStr,
      { size: 19, color: GREY }
    )],
    spacing: { after: 240 },
  }));

  // ── 1. Project description ───────────────────────────────────────────────
  if (findings.description) {
    children.push(heading('Project description'));
    children.push(body(findings.description));
  }

  // ── 2. Scope summary ─────────────────────────────────────────────────────
  if (findings.scope_summary) {
    children.push(heading('Scope summary'));
    children.push(body(findings.scope_summary));
  }

  // ── 3. Key findings ──────────────────────────────────────────────────────
  if (findings.key_findings && findings.key_findings.length > 0) {
    children.push(heading('Key findings'));
    for (const kf of findings.key_findings) {
      children.push(new Paragraph({
        children: [run(kf.title || 'Finding', { bold: true, size: 20, color: navy })],
        spacing: { before: 120, after: 60 },
      }));
      if (kf.detail) children.push(body(kf.detail));
      for (const bi of (kf.items || [])) children.push(bullet(bi));
    }
  }

  // ── 4. Cost summary ──────────────────────────────────────────────────────
  if (findings.cost_summary) {
    const cs = findings.cost_summary;
    const cur = (typeof cs.currency === 'string' && cs.currency) ? cs.currency : '£';
    const money = (v) => cur + (v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    children.push(heading('Cost summary'));

    const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 };
    const cell = (text, { w, bold = false, right = false, fill = null, white = false } = {}) => new TableCell({
      children: [new Paragraph({
        children: [run(text, { size: 19, bold, color: white ? 'FFFFFF' : undefined })],
        alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      })],
      width: { size: w, type: WidthType.DXA },
      margins: CELL_MARGINS,
      shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    });

    const rows = [new TableRow({
      children: [
        cell('Section', { w: 7400, bold: true, fill: navy, white: true }),
        cell('Net cost', { w: 1800, bold: true, right: true, fill: navy, white: true }),
      ],
    })];
    for (const sec of (cs.sections || [])) {
      rows.push(new TableRow({
        children: [
          cell(sec.name || 'Section', { w: 7400 }),
          cell(money(sec.total), { w: 1800, right: true }),
        ],
      }));
    }
    const totalRow = (label, value, { bold = false, fill = null } = {}) => rows.push(new TableRow({
      children: [
        cell(label, { w: 7400, bold, fill }),
        cell(money(value), { w: 1800, bold, right: true, fill }),
      ],
    }));
    totalRow('Net total', cs.net_total, { bold: true });
    if (cs.contingency) totalRow('Contingency at ' + (cs.contingency_pct != null ? cs.contingency_pct : 7.5) + '%', cs.contingency);
    if (cs.ohp) totalRow('Overheads & profit at ' + (cs.ohp_pct != null ? cs.ohp_pct : 12) + '%', cs.ohp);
    if (cs.vat) totalRow('VAT at ' + (cs.vat_rate != null ? cs.vat_rate : 20) + '%', cs.vat);
    totalRow('TENDER TOTAL', cs.grand_total, { bold: true, fill: totalFill });

    const border = { style: BorderStyle.SINGLE, size: 4, color: 'auto' };
    children.push(new Table({
      rows,
      width: { size: 9200, type: WidthType.DXA },
      columnWidths: [7400, 1800],
      borders: {
        top: border, bottom: border, left: border, right: border,
        insideHorizontal: border, insideVertical: border,
      },
    }));
  }

  // ── 5–7. Assumptions / Exclusions / Recommendations ─────────────────────
  const bulletSection = (title, arr) => {
    if (!arr || arr.length === 0) return;
    children.push(heading(title));
    for (const item of arr) children.push(bullet(item));
  };
  bulletSection('Assumptions', findings.assumptions);
  bulletSection('Exclusions', findings.exclusions);
  bulletSection('Recommendations', findings.recommendations);

  // ── Closing note ─────────────────────────────────────────────────────────
  // Keep the leading "Issued by" wording — the deliverable seeder uses it to
  // stop parsing at the boilerplate.
  children.push(new Paragraph({
    children: [run(
      'Issued by ' + company + (footerLine ? ' · ' + footerLine : '')
        + '. Estimates are approximate, based on information provided and current market rates. Subject to detailed measurement and site survey.',
      { size: 16, italics: true, color: GREY }
    )],
    border: { top: { color: 'C9CDD4', size: 4, style: BorderStyle.SINGLE } },
    spacing: { before: 360 },
  }));

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'findings-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '●',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 620, hanging: 260 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1224, bottom: 1224, left: 1224, right: 1224, header: 708, footer: 708 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [run(company + '  |  ' + projectName + '  |  Findings Report', { size: 16, color: GREY })],
            alignment: AlignmentType.RIGHT,
            border: { bottom: { color: navy, size: 4, style: BorderStyle.SINGLE } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              run(ref + '  |  Page ', { size: 16, color: GREY }),
              new TextRun({ children: [PageNumber.CURRENT], font: docFont, size: 16, bold: true, color: GREY }),
              run(' of ', { size: 16, color: GREY }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: docFont, size: 16, color: GREY }),
            ],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  return buf;
}

module.exports = { generateFindingsReport };

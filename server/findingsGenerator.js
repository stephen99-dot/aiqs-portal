/**
 * Findings Report Generator
 * Produces a formatted .docx findings report from structured JSON data.
 * Uses docx library. Install: npm install docx
 */
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat,
        HeadingLevel, BorderStyle, WidthType, ShadingType,
        PageNumber } = require('docx');

const NAVY = '1B2A4A';
const BLUE = '2563EB';
const LIGHT_BLUE = 'D6E4F0';
const GOLD = 'D4A853';
const GREY = 'F8FAFC';
const BCOL = 'CBD5E1';
const TXT = '1E293B';
const MUT = '64748B';
const GREEN = '059669';
const AMBER = 'D97706';
const TW = 9026; // A4 content width in DXA

const bdr = { style: BorderStyle.SINGLE, size: 1, color: BCOL };
const bds = { top: bdr, bottom: bdr, left: bdr, right: bdr };
const cm = { top: 80, bottom: 80, left: 120, right: 120 };

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 276 }, ...opts.para,
    children: [new TextRun({ font: 'Arial', size: 22, color: TXT, ...opts.run, text })]
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80, line: 276 },
    children: [new TextRun({ font: 'Arial', size: 22, color: TXT, text })]
  });
}
function hc(text, w) {
  return new TableCell({
    borders: bds, width: { size: w, type: WidthType.DXA },
    shading: { fill: NAVY, type: ShadingType.CLEAR }, margins: cm,
    children: [new Paragraph({ children: [new TextRun({ text, font: 'Arial', size: 20, bold: true, color: 'FFFFFF' })] })]
  });
}
function tc(text, w, opts = {}) {
  return new TableCell({
    borders: bds, width: { size: w, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined, margins: cm,
    children: [new Paragraph({
      alignment: opts.align,
      children: [new TextRun({ text: String(text), font: 'Arial', size: 20, color: TXT, ...opts.run })]
    })]
  });
}

async function generateFindingsReport(data, clientName, projectName, currency) {
  currency = currency || '\u00A3';
  const d = data || {};

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22, color: TXT } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial', color: NAVY },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial', color: BLUE },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      ]
    },
    numbering: {
      config: [{
        reference: 'bullets', levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }]
    },
    sections: [
      // ── COVER PAGE ──
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: [
          new Paragraph({ spacing: { before: 2400 } }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: 'THE AI QS', font: 'Arial', size: 48, bold: true, color: NAVY })] }),
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { after: 80 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 12 } },
            children: [new TextRun({ text: 'Findings Report', font: 'Arial', size: 32, color: BLUE })]
          }),
          new Paragraph({ spacing: { before: 600 } }),
          new Table({
            width: { size: 6000, type: WidthType.DXA }, columnWidths: [2200, 3800],
            rows: [
              ['Project:', projectName], ['Client:', clientName],
              ['Reference:', d.reference || 'AI-QS-' + Date.now().toString(36).toUpperCase()],
              ['Type:', d.project_type || 'N/A'], ['Location:', d.location || 'N/A'],
              ['Date:', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
            ].map(([label, val]) => new TableRow({ children: [
              tc(label, 2200, { fill: GREY, run: { bold: true } }), tc(val, 3800)
            ]}))
          }),
          new Paragraph({ spacing: { before: 1200 } }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Prepared by The AI QS \u2014 AI-Powered Quantity Surveying', font: 'Arial', size: 18, color: MUT, italics: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: [new TextRun({ text: 'theaiqs.co.uk', font: 'Arial', size: 18, color: MUT })] }),
        ]
      },
      // ── MAIN CONTENT ──
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `The AI QS  |  ${projectName}`, font: 'Arial', size: 16, color: MUT, italics: true })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', font: 'Arial', size: 16, color: MUT }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: MUT })] })] }) },
        children: [
          // 1. Description
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. Project Description')] }),
          p(d.description || `This report presents findings from the AI quantity surveying analysis of ${projectName} for ${clientName}.`),

          // 2. Scope
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('2. Scope of Works')] }),
          p(d.scope_summary || 'The scope of works has been assessed from the drawings and information provided.'),

          // Drawings list
          ...(d.drawings && d.drawings.length > 0 ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.1 Drawings Received')] }),
            new Table({
              width: { size: TW, type: WidthType.DXA }, columnWidths: [2500, 4526, 2000],
              rows: [
                new TableRow({ children: [hc('Drawing Ref', 2500), hc('Title', 4526), hc('Rev', 2000)] }),
                ...d.drawings.map((dr, i) => new TableRow({ children: [
                  tc(dr.ref || `DRG-${String(i+1).padStart(2,'0')}`, 2500, i%2?{fill:GREY}:{}),
                  tc(dr.title || '', 4526, i%2?{fill:GREY}:{}),
                  tc(dr.revision || '-', 2000, i%2?{fill:GREY}:{}),
                ]}))
              ]
            }), new Paragraph({ spacing: { before: 120 } }),
          ] : []),

          // 3. Key Findings
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('3. Key Findings')] }),
          ...(d.key_findings && d.key_findings.length > 0
            ? d.key_findings.flatMap(f => [
                new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(f.title || 'Finding')] }),
                p(f.detail || ''),
                ...(f.items ? f.items.map(i => bullet(i)) : []),
              ])
            : [p('Detailed findings are reflected in the accompanying Bill of Quantities.')]
          ),

          // 4. Assumptions
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('4. Assumptions')] }),
          p('The following assumptions have been made:'),
          ...(d.assumptions && d.assumptions.length > 0
            ? d.assumptions.map(a => bullet(a))
            : ['Normal working hours.', 'Normal ground conditions.', 'All permissions in place.', 'Unrestricted site access.', 'Quantities measured from drawings only.'].map(a => bullet(a))
          ),

          // 5. Exclusions
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('5. Exclusions')] }),
          ...(d.exclusions && d.exclusions.length > 0
            ? d.exclusions.map(e => bullet(e))
            : ['VAT (shown separately).', 'Professional fees.', 'Party wall costs.', 'Works not shown on drawings.', 'FF&E unless noted.'].map(e => bullet(e))
          ),

          // 6. Cost Summary
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('6. Cost Summary')] }),
          ...(d.cost_summary && d.cost_summary.sections ? [
            new Table({
              width: { size: TW, type: WidthType.DXA }, columnWidths: [5500, 3526],
              rows: [
                new TableRow({ children: [hc('Section', 5500), hc(`Amount (${currency})`, 3526)] }),
                ...d.cost_summary.sections.map((s, i) => new TableRow({ children: [
                  tc(s.name, 5500, i%2?{fill:GREY}:{}),
                  tc(`${currency}${Number(s.total).toLocaleString('en-GB',{minimumFractionDigits:2})}`, 3526, { fill: i%2?GREY:undefined, align: AlignmentType.RIGHT }),
                ]})),
                new TableRow({ children: [tc('Net Construction Cost', 5500, { fill: LIGHT_BLUE, run: { bold: true } }), tc(`${currency}${Number(d.cost_summary.net_total).toLocaleString('en-GB',{minimumFractionDigits:2})}`, 3526, { fill: LIGHT_BLUE, run: { bold: true }, align: AlignmentType.RIGHT })] }),
                new TableRow({ children: [tc(`Contingency (${d.cost_summary.contingency_pct||7.5}%)`, 5500), tc(`${currency}${Number(d.cost_summary.contingency).toLocaleString('en-GB',{minimumFractionDigits:2})}`, 3526, { align: AlignmentType.RIGHT })] }),
                new TableRow({ children: [tc(`Overheads & Profit (${d.cost_summary.ohp_pct||12}%)`, 5500, {fill:GREY}), tc(`${currency}${Number(d.cost_summary.ohp).toLocaleString('en-GB',{minimumFractionDigits:2})}`, 3526, { fill: GREY, align: AlignmentType.RIGHT })] }),
                new TableRow({ children: [tc('GRAND TOTAL (Excl. VAT)', 5500, { fill: 'FFF2CC', run: { bold: true } }), tc(`${currency}${Number(d.cost_summary.grand_total).toLocaleString('en-GB',{minimumFractionDigits:2})}`, 3526, { fill: 'FFF2CC', run: { bold: true }, align: AlignmentType.RIGHT })] }),
              ]
            }), new Paragraph({ spacing: { before: 120 } }),
          ] : [p('See accompanying Bill of Quantities for full cost breakdown.')]),

          // 7. Recommendations
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('7. Recommendations')] }),
          ...(d.recommendations && d.recommendations.length > 0
            ? d.recommendations.map(r => bullet(r))
            : [
                bullet('Review the BOQ and provide corrections on any rates that don\'t reflect your current costs.'),
                bullet('Obtain competitive quotes for specialist items marked with generic rates.'),
                bullet('A site visit is recommended to confirm ground conditions and access.'),
              ]
          ),

          // Disclaimer
          new Paragraph({ spacing: { before: 400 } }),
          new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: BCOL, space: 8 } }, spacing: { before: 200 },
            children: [new TextRun({ text: 'Disclaimer', font: 'Arial', size: 18, bold: true, color: MUT })]
          }),
          new Paragraph({ children: [new TextRun({
            text: 'This report has been prepared using AI-assisted quantity surveying analysis. Quantities and costs are estimates based on the drawings provided and should be verified by a qualified professional. The AI QS accepts no liability for errors arising from incomplete or inaccurate source information.',
            font: 'Arial', size: 17, color: MUT, italics: true
          })] }),
        ]
      }
    ]
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateFindingsReport };

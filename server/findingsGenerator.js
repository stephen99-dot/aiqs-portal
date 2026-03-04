const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel, ShadingType, PageNumber, NumberFormat } = require('docx');

async function generateFindingsReport(findings, clientName, projectName) {
  const ref = findings.reference || ('AI-QS-' + Date.now().toString(36).toUpperCase().slice(-6));
  const navy = '1B2A4A';
  const amber = 'D97706';

  const children = [];

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: 'FINDINGS REPORT', bold: true, size: 36, color: navy, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: projectName, bold: true, size: 28, color: navy, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 100 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Reference: ' + ref + '  |  Date: ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }), size: 20, color: '666666', font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 200 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Prepared for: ' + clientName, size: 20, color: '666666', font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 400 }
  }));

  // Divider
  children.push(new Paragraph({ border: { bottom: { color: navy, size: 2, style: BorderStyle.SINGLE } }, spacing: { after: 300 } }));

  // Project Description
  if (findings.description) {
    children.push(new Paragraph({ text: '1. PROJECT DESCRIPTION', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    children.push(new Paragraph({
      children: [new TextRun({ text: findings.description, size: 22, font: 'Arial' })],
      spacing: { after: 200 }
    }));
  }
  if (findings.project_type) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Project Type: ', bold: true, size: 22, font: 'Arial' }), new TextRun({ text: findings.project_type, size: 22, font: 'Arial' })],
      spacing: { after: 100 }
    }));
  }
  if (findings.location) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Location: ', bold: true, size: 22, font: 'Arial' }), new TextRun({ text: findings.location, size: 22, font: 'Arial' })],
      spacing: { after: 200 }
    }));
  }

  // Scope Summary
  if (findings.scope_summary) {
    children.push(new Paragraph({ text: '2. SCOPE SUMMARY', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    children.push(new Paragraph({
      children: [new TextRun({ text: findings.scope_summary, size: 22, font: 'Arial' })],
      spacing: { after: 200 }
    }));
  }

  // Key Findings
  if (findings.key_findings && findings.key_findings.length > 0) {
    children.push(new Paragraph({ text: '3. KEY FINDINGS', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    for (var kf of findings.key_findings) {
      children.push(new Paragraph({
        children: [new TextRun({ text: kf.title || 'Finding', bold: true, size: 22, font: 'Arial', color: navy })],
        spacing: { before: 100, after: 50 }
      }));
      if (kf.detail) {
        children.push(new Paragraph({
          children: [new TextRun({ text: kf.detail, size: 22, font: 'Arial' })],
          spacing: { after: 50 }
        }));
      }
      if (kf.items) {
        for (var bi of kf.items) {
          children.push(new Paragraph({
            children: [new TextRun({ text: '\u2022 ' + bi, size: 22, font: 'Arial' })],
            indent: { left: 400 }, spacing: { after: 30 }
          }));
        }
      }
    }
  }

  // Cost Summary Table
  if (findings.cost_summary) {
    var cs = findings.cost_summary;
    children.push(new Paragraph({ text: '4. COST SUMMARY', heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 } }));

    var tableRows = [];
    // Header
    tableRows.push(new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Section', bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })], alignment: AlignmentType.LEFT })], shading: { type: ShadingType.SOLID, color: navy }, width: { size: 65, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Total', bold: true, size: 20, color: 'FFFFFF', font: 'Arial' })], alignment: AlignmentType.RIGHT })], shading: { type: ShadingType.SOLID, color: navy }, width: { size: 35, type: WidthType.PERCENTAGE } })
      ]
    }));

    // Section rows
    if (cs.sections) {
      for (var i = 0; i < cs.sections.length; i++) {
        var sec = cs.sections[i];
        var bg = i % 2 === 0 ? 'F5F5F5' : 'FFFFFF';
        tableRows.push(new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: sec.name || 'Section', size: 20, font: 'Arial' })], alignment: AlignmentType.LEFT })], shading: { type: ShadingType.SOLID, color: bg } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '\u00a3' + (sec.total || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 }), size: 20, font: 'Arial' })], alignment: AlignmentType.RIGHT })], shading: { type: ShadingType.SOLID, color: bg } })
          ]
        }));
      }
    }

    // Totals
    var addSummaryRow = function(label, value, bold, bg) {
      tableRows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: bold, size: 20, font: 'Arial' })], alignment: AlignmentType.LEFT })], shading: bg ? { type: ShadingType.SOLID, color: bg } : undefined }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '\u00a3' + (value || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 }), bold: bold, size: 20, font: 'Arial' })], alignment: AlignmentType.RIGHT })], shading: bg ? { type: ShadingType.SOLID, color: bg } : undefined })
        ]
      }));
    };

    addSummaryRow('Net Total', cs.net_total, true, 'E8E8E8');
    if (cs.contingency) addSummaryRow('Contingency (' + (cs.contingency_pct || 7.5) + '%)', cs.contingency, false);
    if (cs.ohp) addSummaryRow('Overheads & Profit (' + (cs.ohp_pct || 12) + '%)', cs.ohp, false);
    addSummaryRow('GRAND TOTAL', cs.grand_total, true, navy.replace('1B2A4A', 'D6E4F0'));

    children.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE }
    }));
  }

  // Assumptions
  if (findings.assumptions && findings.assumptions.length > 0) {
    children.push(new Paragraph({ text: '5. ASSUMPTIONS', heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 } }));
    for (var a of findings.assumptions) {
      children.push(new Paragraph({
        children: [new TextRun({ text: '\u2022 ' + a, size: 22, font: 'Arial' })],
        indent: { left: 200 }, spacing: { after: 50 }
      }));
    }
  }

  // Exclusions
  if (findings.exclusions && findings.exclusions.length > 0) {
    children.push(new Paragraph({ text: '6. EXCLUSIONS', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    for (var ex of findings.exclusions) {
      children.push(new Paragraph({
        children: [new TextRun({ text: '\u2022 ' + ex, size: 22, font: 'Arial' })],
        indent: { left: 200 }, spacing: { after: 50 }
      }));
    }
  }

  // Recommendations
  if (findings.recommendations && findings.recommendations.length > 0) {
    children.push(new Paragraph({ text: '7. RECOMMENDATIONS', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    for (var rec of findings.recommendations) {
      children.push(new Paragraph({
        children: [new TextRun({ text: '\u2022 ' + rec, size: 22, font: 'Arial' })],
        indent: { left: 200 }, spacing: { after: 50 }
      }));
    }
  }

  // Footer
  children.push(new Paragraph({ border: { top: { color: navy, size: 1, style: BorderStyle.SINGLE } }, spacing: { before: 400, after: 100 } }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'This report was generated by The AI QS (theaiqs.co.uk). Estimates are approximate, based on information provided and current UK market rates. Subject to detailed measurement and site survey.', size: 18, italic: true, color: '999999', font: 'Arial' })],
    alignment: AlignmentType.CENTER
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 800, left: 1000, right: 1000 } } },
      children: children
    }],
    styles: {
      paragraphStyles: [{
        id: 'Heading2', name: 'Heading 2', run: { font: 'Arial', size: 26, bold: true, color: navy }
      }]
    }
  });

  const buf = await Packer.toBuffer(doc);
  return buf;
}

module.exports = { generateFindingsReport };

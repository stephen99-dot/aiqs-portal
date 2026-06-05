import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

// Read-only spreadsheet-style render of the priced BOQ — mirrors the generated
// Excel (THE AI QS header band, project meta, Ref/Element/Qty/Unit/Rate/Total
// grid, totals). Rendered document-style (always on white) so it reads like the
// actual deliverable, the way Claude shows a spreadsheet artifact.

function money(n, sym) {
  if (n == null || isNaN(n)) return '';
  return sym + Math.round(n).toLocaleString('en-GB');
}
function qtyFmt(n) {
  if (n == null || isNaN(n)) return '';
  return (Math.round(n * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

const NAVY = '#15233B', TEAL = '#1F9E8E', LABELBG = '#EAF0F8', LINE = '#D8DEE8', INK = '#1B2433', SUB = '#5B6678';

export default function BoqSheet({ sessionId, meta = {} }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    let alive = true;
    apiFetch('/takeoff/' + sessionId + '/priced')
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setErr(e.message || 'Could not load the BOQ'); });
    return () => { alive = false; };
  }, [sessionId]);

  if (err) return <div style={{ padding: 24, color: '#B91C1C', fontSize: 13 }}>{err}</div>;
  if (!data || !data.priced) return <div style={{ padding: 24, color: '#64748B', fontSize: 13 }}>Loading the BOQ…</div>;

  const { sections = [], summary = {} } = data.priced;
  const tk = data.takeoff || {};
  const sym = summary.currency === 'EUR' ? '€' : '£';

  const metaRows = [
    ['Project', meta.projectType || tk.project_type || '—'],
    ['Client', meta.client || '—'],
    ['Property', meta.property || tk.location || '—'],
    ['Prepared by', meta.preparedBy || 'The AI QS · pre-tender estimate'],
    ['Date', meta.date || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })],
    ['Location basis', tk.location || '—'],
    ['Status', 'Order-of-cost estimate for budgeting — not a fixed-price tender'],
  ];

  const cell = { border: `1px solid ${LINE}`, padding: '7px 10px', fontSize: 12.5, color: INK, verticalAlign: 'top', lineHeight: 1.45 };
  const rightCell = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const blank = { border: 'none' };

  return (
    <div style={{ background: '#fff', color: INK, fontFamily: '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif' }}>
      <div style={{ background: NAVY, color: '#fff', padding: '14px 16px', fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>THE AI QS</div>
      <div style={{ background: TEAL, color: '#fff', padding: '7px 16px', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.02em' }}>BILL OF QUANTITIES — Pre-Tender Cost Estimate</div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          {metaRows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ ...cell, width: 140, background: LABELBG, fontWeight: 700, color: '#23406B' }}>{k}</td>
              <td style={cell} colSpan={5}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 12 }}>
        <colgroup>
          <col style={{ width: 46 }} /><col /><col style={{ width: 58 }} /><col style={{ width: 46 }} /><col style={{ width: 86 }} /><col style={{ width: 96 }} />
        </colgroup>
        <thead>
          <tr style={{ background: NAVY }}>
            {['Ref', 'Element', 'Qty', 'Unit', 'Rate', 'Total'].map((h, i) => (
              <th key={h} style={{ ...cell, color: '#fff', fontWeight: 700, textAlign: i >= 2 ? 'right' : 'left', borderColor: '#2A3A55' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, si) => (
            <React.Fragment key={sec.name}>
              <tr style={{ background: LABELBG }}>
                <td style={{ ...cell, fontWeight: 800 }}>{si + 1}</td>
                <td style={{ ...cell, fontWeight: 800 }} colSpan={4}>{sec.name}</td>
                <td style={{ ...rightCell, fontWeight: 800 }}>{money(sec.subtotal, sym)}</td>
              </tr>
              {(sec.items || []).map((it, ii) => (
                <tr key={it.key + '-' + ii} style={{ background: ii % 2 ? '#F7F9FC' : '#fff' }}>
                  <td style={{ ...cell, color: SUB }}>{it.item_ref || `${si + 1}.${ii + 1}`}</td>
                  <td style={cell}>{it.description || it.key}</td>
                  <td style={rightCell}>{qtyFmt(it.qty)}</td>
                  <td style={{ ...cell, color: SUB }}>{it.unit}</td>
                  <td style={rightCell}>{money(it.rate, sym)}</td>
                  <td style={rightCell}>{money(it.total, sym)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
          <tr><td colSpan={4} style={blank} /><td style={{ ...cell, fontWeight: 700, background: LABELBG }}>Net construction</td><td style={{ ...rightCell, fontWeight: 700, background: LABELBG }}>{money(summary.construction_total, sym)}</td></tr>
          {summary.contingency_pct != null && <tr><td colSpan={4} style={blank} /><td style={cell}>Contingency ({summary.contingency_pct}%)</td><td style={rightCell}>{money(summary.contingency, sym)}</td></tr>}
          {summary.ohp_pct != null && <tr><td colSpan={4} style={blank} /><td style={cell}>OH&amp;P ({summary.ohp_pct}%)</td><td style={rightCell}>{money(summary.ohp, sym)}</td></tr>}
          {summary.vat_rate != null && <tr><td colSpan={4} style={blank} /><td style={cell}>VAT ({summary.vat_rate}%)</td><td style={rightCell}>{money(summary.vat, sym)}</td></tr>}
          <tr><td colSpan={4} style={blank} /><td style={{ ...cell, fontWeight: 800, background: NAVY, color: '#fff' }}>Grand total</td><td style={{ ...rightCell, fontWeight: 800, background: NAVY, color: '#fff' }}>{money(summary.grand_total, sym)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

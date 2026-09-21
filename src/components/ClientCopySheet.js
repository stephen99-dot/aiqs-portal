import React, { useEffect, useState } from 'react';
import {
  safeHex, idealTextOn, accentText, tradeTint, heroFontPx, titleFontPx, tint, luminance, detectLightLogo,
} from '../utils/brandColours';

/**
 * ClientCopySheet — the on-screen twin of the Client Copy XLSX
 * (server/builderExports.js › generateClientCopyPro). Same layout, same
 * adaptive rules: split masthead with the logo on white and the total on the
 * brand colour, who it's for and from, where the money goes by trade, then the
 * summary. Used by the Builder Pack page (live figures) and the Branding page
 * (sample figures) so both previews show what will actually be downloaded.
 *
 * rows: [{ number, title, provisional, item_count, subtotal }]
 * summaryLines: [{ key, label, value }] — the lines between net and total ex-VAT
 */
const DEFAULT_PRIMARY = '#1B2A4A';
const DEFAULT_ACCENT = '#F59E0B';
const INK = '#14161A';
const MUTED = '#5B6470';
const HAIRLINE = '#E3E6EA';

// Trade titles never carry margin words on the client copy, even when the
// source bill's own heading does ("… (CSA 5; outside OH&P)"). Mirrors the
// server's clientSafeTitle so the Excel copy and this sheet agree.
const MARGIN_WORDS_RE = /OH\s*&\s*P|\bO\s*&\s*P\b|OVERHEADS?\b|\bPROFITS?\b/i;
function clientSafeTitle(title) {
  const src = String(title || '');
  let t = src.replace(/\s*[(\[][^()\[\]]*[)\]]/g, (m) => (MARGIN_WORDS_RE.test(m) ? '' : m));
  t = t.replace(/\s*[;,–—-]\s*[^;,–—-]*$/, (m) => (MARGIN_WORDS_RE.test(m) ? '' : m));
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t || src;
}

function money(sym, v) {
  return sym + (Math.round((v || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const label = { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED };
const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

export default function ClientCopySheet({
  branding, logoUrl, projectName, projectType, clientName,
  sym = '£', rows = [], summaryLines = [], exVat = 0, vat = 0, vatVal = 0, inclVat = 0, ohpApplied = true,
}) {
  const b = branding || {};
  const primary = safeHex(b.primary_colour, DEFAULT_PRIMARY);
  const accent = safeHex(b.accent_colour, DEFAULT_ACCENT);
  const onPrimary = idealTextOn(primary);
  const accentTxt = accentText(accent);
  const tintBg = tint(primary, 0.9);
  const company = b.company_name || '';
  const serif = b.template === 'professional' || b.template === 'heritage';
  const displayFont = serif ? "Georgia, 'Times New Roman', serif" : 'inherit';
  const displayWeight = b.template === 'minimalist' ? 600 : 800;

  // A white logo gets a dark plate so it shows on paper — the same rule the
  // XLSX applies. Detected from the image itself, never from a setting.
  const [lightLogo, setLightLogo] = useState(false);
  useEffect(() => {
    let live = true;
    detectLightLogo(logoUrl).then((v) => { if (live) setLightLogo(v); });
    return () => { live = false; };
  }, [logoUrl]);
  const plateBg = lightLogo ? (luminance(primary) > 150 ? INK : primary) : 'transparent';

  const heroIsIncl = vat > 0;
  const heroText = money(sym, heroIsIncl ? inclVat : exVat);
  const allTotal = rows.reduce((a, r) => a + (r.subtotal || 0), 0);
  const itemCount = rows.reduce((a, r) => a + (r.item_count || 0), 0);
  const trades = rows.map((r, i) => {
    const pct = allTotal > 0 ? (r.subtotal || 0) / allTotal * 100 : 0;
    const bg = tradeTint(primary, i);
    return { ...r, title: clientSafeTitle(r.title), pct, bg, fg: idealTextOn(bg), barLabel: pct >= 8 ? Math.round(pct) + '%' : '' };
  });
  const twoCol = trades.length > 9;
  const title = projectName || 'Project';

  return (
    <div style={{
      background: '#FFFFFF', color: INK, borderRadius: 10, padding: 18,
      boxShadow: '0 4px 18px rgba(0,0,0,0.10)', fontSize: 12, lineHeight: 1.4,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {/* Split masthead: logo and project on white, the total on the brand colour */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(190px, 1fr)', border: '1px solid #DDE1E6', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', minHeight: 56 }}>
            {logoUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', boxSizing: 'border-box', background: plateBg, padding: plateBg === 'transparent' ? 0 : '8px 12px', borderRadius: 6 }}>
                <img src={logoUrl} alt="Your logo" style={{ maxWidth: 'min(220px, 100%)', maxHeight: 56, width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
              </div>
            ) : (
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.01em', color: primary, lineHeight: 1.1 }}>{company || 'Your company'}</div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ ...label, color: accentTxt, fontSize: 10 }}>Bill of Quantities · Client copy</div>
            <div style={{
              fontFamily: displayFont, fontSize: titleFontPx(title), fontWeight: displayWeight, letterSpacing: '-0.01em', lineHeight: 1.12,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{title}</div>
            {(clientName || projectType) && (
              <div style={{ fontSize: 11.5, color: MUTED }}>
                {clientName && <span>Prepared for <span style={{ color: INK, fontWeight: 600 }}>{clientName}</span></span>}
                {clientName && projectType && ' · '}
                {projectType}
              </div>
            )}
          </div>
        </div>
        <div style={{ background: primary, color: onPrimary, padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8, minWidth: 0, borderBottom: '6px solid ' + accent }}>
          <div style={{ ...label, color: onPrimary, opacity: 0.85 }}>{heroIsIncl ? 'Total incl. VAT' : 'Total (excl. VAT)'}</div>
          <div style={{ ...num, fontFamily: displayFont, fontSize: heroFontPx(heroText), fontWeight: displayWeight, lineHeight: 1, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'clip' }}>{heroText}</div>
          <div style={{ fontSize: 11, opacity: 0.9 }}>
            {heroIsIncl ? `${money(sym, exVat)} excl. VAT · VAT @ ${vat}% ${money(sym, vatVal)}` : 'VAT not applied to this copy'}
          </div>
        </div>
      </div>

      {/* Who it's for and from */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, paddingBottom: 12, borderBottom: '1px solid ' + HAIRLINE }}>
        <div style={{ minWidth: 0 }}>
          <div style={label}>Prepared for</div>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientName || 'Your client'}</div>
          <div style={{ fontSize: 11, color: MUTED }}>{itemCount} item{itemCount === 1 ? '' : 's'} in {rows.length} trade{rows.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={label}>Prepared by</div>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{company || 'The AI QS'}</div>
          {(b.company_address || b.footer_text) && (
            <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(b.company_address || b.footer_text).replace(/\s+/g, ' ').trim()}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={label}>Issued</div>
          <div style={{ fontWeight: 600 }}>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          <div style={{ fontSize: 11, color: MUTED }}>Valid 30 days</div>
        </div>
      </div>

      {/* Where the money goes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ ...label, color: primary, fontSize: 10.5 }}>Where the money goes</div>
          <div style={{ fontSize: 11, color: MUTED }}>{ohpApplied ? 'Rates are fixed and fully inclusive' : 'Rates as tendered'}</div>
        </div>
        {trades.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: MUTED }}>No priced sections in this bill yet.</div>
        ) : (
          <>
            <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
              {trades.map((t, i) => (
                <div key={'bar-' + i} style={{ width: t.pct + '%', background: t.bg, color: t.fg, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{t.barLabel}</div>
              ))}
            </div>
            <div style={{
              display: 'grid', columnGap: 24,
              gridTemplateColumns: twoCol ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
              gridTemplateRows: `repeat(${twoCol ? Math.ceil(trades.length / 2) : trades.length}, auto)`,
              gridAutoFlow: 'column',
            }}>
              {trades.map((t, i) => (
                <div key={String(t.number) + '-' + i} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 44px auto', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid ' + HAIRLINE }}>
                  <div style={{ height: 16, borderRadius: 3, background: t.bg, color: t.fg, fontSize: 8.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.provisional ? 'PS' : (i + 1)}</div>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}{t.provisional && !/provisional/i.test(t.title) && <span style={{ fontSize: 10, color: MUTED, marginLeft: 6 }}>provisional</span>}
                  </div>
                  <div style={{ ...num, textAlign: 'right', color: MUTED }}>{t.pct.toFixed(1)}%</div>
                  <div style={{ ...num, textAlign: 'right', fontWeight: 600 }}>{money(sym, t.subtotal)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Summary: only the lines that carry a value */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', ...num, whiteSpace: 'normal' }}>
          {summaryLines.map((l) => (
            <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 10px', borderBottom: '1px solid ' + HAIRLINE }}>
              <span style={{ color: '#3D4552' }}>{l.label}</span>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(sym, l.value)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 10px', fontWeight: 700, background: heroIsIncl ? tintBg : primary, color: heroIsIncl ? primary : onPrimary, borderRadius: heroIsIncl ? 0 : '0 0 4px 4px' }}>
            <span>Total (excl. VAT)</span>
            <span style={{ whiteSpace: 'nowrap', fontSize: heroIsIncl ? 12 : 15 }}>{money(sym, exVat)}</span>
          </div>
          {heroIsIncl ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 10px', borderBottom: '1px solid ' + HAIRLINE }}>
                <span style={{ color: '#3D4552' }}>VAT @ {vat}%</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(sym, vatVal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 10px', background: primary, color: onPrimary, borderRadius: '0 0 4px 4px', fontWeight: 800 }}>
                <span>Total (incl. VAT)</span>
                <span style={{ fontSize: 15, whiteSpace: 'nowrap' }}>{money(sym, inclVat)}</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 10.5, color: MUTED, fontStyle: 'italic', padding: '6px 10px 0', textAlign: 'right' }}>VAT not applied to this copy.</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 10, color: MUTED, borderTop: '1px solid ' + HAIRLINE, paddingTop: 8 }}>
        <div style={{ minWidth: 0 }}>
          {[company, b.footer_text].filter(Boolean).join(' · ') || 'The AI QS'}
          {' · '}{ohpApplied ? 'Rates are fixed and fully inclusive.' : 'Rates as tendered.'}
        </div>
        <div style={{ whiteSpace: 'nowrap' }}>Client copy</div>
      </div>
    </div>
  );
}

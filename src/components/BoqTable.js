import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useTheme } from '../context/ThemeContext';
import useIsMobile from '../utils/useIsMobile';
import AsyncButton from './AsyncButton';
import { currencySymbol } from '../utils/money';

// Plain-English labels for provenance badges on rates and quantities.
// These map to the rate_source / qty_source values emitted by server/deterministicPricer.js
// and server/chat.js (PUT /takeoff/:id).
const RATE_SOURCE_LABELS = {
  override:             { label: 'Override',          color: '#7C3AED', bg: 'rgba(124,58,237,0.12)', desc: 'Rate manually overridden on this line' },
  client_verified:      { label: 'Your rate',         color: '#10B981', bg: 'rgba(16,185,129,0.12)', desc: 'From your rate library' },
  base_library:         { label: "SPON's / base",     color: '#64748B', bg: 'rgba(100,116,139,0.12)', desc: 'Standard rate from the base library' },
  ai_estimated:         { label: 'AI estimated',      color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'AI estimated — no base rate for this key' },
  fallback_estimated:   { label: 'Fallback estimate', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'Conservative fallback based on unit type' },
  fallback_corrected:   { label: 'Auto-corrected',    color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'Rate looked too high; auto-corrected to fallback' },
};

const QTY_SOURCE_LABELS = {
  ai_extracted: { label: 'AI',     color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', desc: 'Extracted by AI from drawings' },
  user_edited:  { label: 'Edited', color: '#10B981', bg: 'rgba(16,185,129,0.12)', desc: 'You edited this quantity' },
  intake:       { label: 'Intake', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'From your project intake answers' },
};

function Badge({ spec }) {
  if (!spec) return null;
  return (
    <span
      title={spec.desc}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        background: spec.bg,
        color: spec.color,
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}
    >
      {spec.label}
    </span>
  );
}

function fmtMoney(n, currency) {
  const sym = currencySymbol(currency);
  if (n == null || isNaN(n)) return sym + '0';
  return sym + Math.round(n).toLocaleString('en-GB');
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '0%';
  return (Math.round(n * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + '%';
}

// Local edit buffer for the markup controls, seeded from the pricer summary.
function markupDraftFrom(summary) {
  const s = summary || {};
  const trades = {};
  for (const [k, v] of Object.entries(s.trade_markup || {})) trades[k] = String(v);
  return { default: String(s.ohp_pct ?? 0), trades };
}

function fmtQty(n) {
  if (n == null || isNaN(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

export default function BoqTable({ sessionId, takeoffId, onChange, onRegenerate, compact = false }) {
  const { mode, t } = useTheme();
  const isDark = mode === 'dark';
  const isMobile = useIsMobile();
  const [loading, setLoading]   = useState(true);
  const [data, setData]         = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editingVal, setEditingVal] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [expanded, setExpanded] = useState({});
  // Markup controls: the default % and the per-trade overrides, saved to the
  // user's pricing preferences (so they apply to every BOQ and export) and
  // re-priced here straight away.
  const [markupDraft, setMarkupDraft] = useState({ default: '0', trades: {} });
  const [markupSaving, setMarkupSaving] = useState(false);
  const [markupError, setMarkupError] = useState(null);
  const [markupOpen, setMarkupOpen] = useState(true);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch('/takeoff/' + sessionId + '/priced');
      setData(d);
      setMarkupDraft(markupDraftFrom(d.priced && d.priced.summary));
      // Expand all sections by default in non-compact mode
      if (!compact) {
        const all = {};
        (d.priced?.sections || []).forEach(s => { all[s.name] = true; });
        setExpanded(all);
      }
    } catch (e) {
      if (e.status === 404) setData(null); // No takeoff yet — render nothing
      else setError(e.message || 'Failed to load BOQ');
    } finally {
      setLoading(false);
    }
  }, [sessionId, compact]);

  useEffect(() => { load(); }, [load]);

  async function saveEdit(itemKey) {
    if (!data || !takeoffId) return;
    // Guard against re-entry: pressing Enter clears editingKey and unmounts the
    // still-focused input, firing onBlur -> saveEdit a second time. Bail if we're
    // already saving or this cell is no longer the one being edited.
    if (saving || editingKey !== itemKey) return;
    const num = parseFloat(editingVal);
    if (!Number.isFinite(num) || num < 0) { setEditingKey(null); return; }

    // Build new items array from existing raw items, replacing qty for the edited key
    const next = (data.items_raw || []).map(it => it.key === itemKey ? { ...it, qty: num, qty_source: 'user_edited' } : it);

    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/takeoff/' + takeoffId, {
        method: 'PUT',
        body: JSON.stringify({ items: next }),
      });
      setData(prev => ({
        ...prev,
        items_raw: res.items_raw || next,
        priced: res.priced || prev.priced,
      }));
      if (onChange) onChange(res);
      setEditingKey(null);
    } catch (e) {
      // Keep the cell in edit mode with the typed value so the user can retry.
      setSaveError(e.message || 'Failed to save edit');
    } finally {
      setSaving(false);
    }
  }

  // Persist a markup change (default or one trade) and re-price. A trade set
  // to '' drops its override so it falls back to the default again.
  async function saveMarkup(next) {
    const applied = data && data.priced ? data.priced.summary : {};
    const def = parseFloat(next.default);
    const tradeMap = {};
    for (const [k, v] of Object.entries(next.trades)) {
      if (v === '' || v == null) continue;
      const n = parseFloat(v);
      if (Number.isFinite(n) && n >= 0 && n <= 100) tradeMap[k] = n;
    }
    const sameDefault = Number.isFinite(def) && Math.abs(def - Number(applied.ohp_pct || 0)) < 1e-9;
    const sameTrades = JSON.stringify(tradeMap) === JSON.stringify(applied.trade_markup || {});
    if (sameDefault && sameTrades) return;
    if (!Number.isFinite(def) || def < 0 || def > 100) { setMarkupError('Markup must be between 0 and 100%'); return; }
    setMarkupSaving(true);
    setMarkupError(null);
    try {
      await apiFetch('/pricing-prefs', { method: 'PUT', body: JSON.stringify({ ohp_pct: def, trade_markup: tradeMap }) });
      await load();
      if (onChange) onChange({ markup: true });
    } catch (e) {
      setMarkupError(e.message || 'Failed to save markup');
    } finally {
      setMarkupSaving(false);
    }
  }

  if (!sessionId) return null;
  if (loading) return (
    <div style={{ padding: 16, fontSize: 12, color: isDark ? '#64748B' : '#94A3B8' }}>Loading BOQ...</div>
  );
  if (error) return (
    <div style={{ padding: 12, fontSize: 12, color: '#EF4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
      {error}
    </div>
  );
  if (!data || !data.priced) return null;

  // Palette derived from theme tokens so the BOQ table matches the chosen theme.
  const c = {
    border: t.border,
    bg: t.surface,
    rowBg: 'transparent',
    rowHover: t.surfaceHover,
    text: t.text, textMuted: t.textSecondary, textSub: t.textMuted,
    accent: t.accent,
    sectionBg: t.surfaceHover,
    totalBg: isDark ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.05)',
    editBg: t.surfaceHover,
  };

  const { sections = [], summary = {} } = data.priced || {};
  const currency = summary.currency || 'GBP';

  return (
    <div style={{
      background: c.bg,
      border: '1px solid ' + c.border,
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: compact ? 8 : 14,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid ' + c.border,
        display: 'flex', alignItems: 'center', gap: 10,
        background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Bill of Quantities</span>
        <span style={{ fontSize: 11, color: c.textMuted }}>
          {sections.reduce((s, sec) => s + (sec.items?.length || 0), 0)} items in {sections.length} sections · click a quantity to edit
        </span>
        {saving ? (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: c.accent, fontWeight: 600 }}>Saving...</span>
        ) : (
          <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: c.text, fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(summary.grand_total, currency)}
            <span style={{ fontSize: 10, fontWeight: 500, color: c.textMuted, marginLeft: 5 }}>{summary.vat_rate != null ? 'incl VAT' : 'total'}</span>
          </span>
        )}
      </div>

      {/* Sections */}
      <div style={{ maxHeight: compact ? 360 : 600, overflowY: 'auto', overflowX: 'auto' }}>
        {sections.map((sec, si) => {
          const isOpen = expanded[sec.name];
          return (
            <div key={sec.name}>
              <div
                onClick={() => setExpanded(p => ({ ...p, [sec.name]: !p[sec.name] }))}
                style={{
                  padding: '9px 14px',
                  background: c.sectionBg,
                  borderBottom: '1px solid ' + c.border,
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, color: c.text,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
              >
                <span style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', fontSize: 9, color: c.textMuted }}>▶</span>
                <span>{sec.name}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: c.text, fontSize: 12 }}>
                  {fmtMoney(sec.subtotal, currency)}
                </span>
                <span style={{ fontSize: 10, fontWeight: 500, color: c.textMuted, width: 40, textAlign: 'right' }}>
                  {sec.items?.length || 0} items
                </span>
              </div>

              {isOpen && (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="sticky-first-col" style={{ width: '100%', minWidth: isMobile ? 420 : undefined, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }}>
                      <th style={{ textAlign: 'left',  padding: '6px 10px', color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Item</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px',  color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 90 }}>Qty</th>
                      <th style={{ textAlign: 'left',  padding: '6px 8px',  color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 50 }}>Unit</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px',  color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 80 }}>Rate</th>
                      <th style={{ textAlign: 'right', padding: '6px 10px', color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 90 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.items.map((item, ii) => {
                      // South African lines name the SA-RL rate that priced them, or
                      // say they were converted from the UK library for want of one.
                      const rateSpec = item.rate_source === 'base_library' && item.library_ref
                        ? { label: 'SA-RL ' + item.library_ref, color: '#64748B', bg: 'rgba(100,116,139,0.12)', desc: 'AI QS South Africa Rates Library, region-adjusted — see My Rates for the build-up' }
                        : item.rate_source === 'base_library' && item.converted_from_uk
                          ? { label: 'Converted', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'No SA library equivalent — UK rate converted at the SA cost-parity factor. Confirm locally.' }
                          : RATE_SOURCE_LABELS[item.rate_source];
                      const qtySpec  = QTY_SOURCE_LABELS[item.qty_source];
                      const isEditing = editingKey === item.key;
                      const ref = item.item_ref || `${si + 1}.${String(ii + 1).padStart(2, '0')}`;
                      return (
                        <tr key={item.key + '-' + (item.item_ref || ii)} style={{ borderBottom: '1px solid ' + c.border }}>
                          <td style={{ padding: '7px 10px', color: c.text, lineHeight: 1.4, verticalAlign: 'top' }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <span style={{ color: c.textSub, fontVariantNumeric: 'tabular-nums', fontSize: 11, flexShrink: 0, minWidth: 28 }}>{ref}</span>
                              <span>{item.description || item.key}</span>
                            </div>
                          </td>
                          <td
                            style={{
                              textAlign: 'right', padding: '7px 8px', color: c.text,
                              fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
                              background: isEditing ? c.editBg : undefined,
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => {
                              if (isEditing) return;
                              setSaveError(null);
                              setEditingKey(item.key);
                              setEditingVal(String(item.qty));
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="number" inputMode="decimal"
                                step="0.01"
                                min="0"
                                autoFocus
                                value={editingVal}
                                onChange={e => setEditingVal(e.target.value)}
                                onBlur={() => saveEdit(item.key)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveEdit(item.key);
                                  else if (e.key === 'Escape') { setSaveError(null); setEditingKey(null); }
                                }}
                                style={{
                                  width: 72, textAlign: 'right',
                                  background: 'transparent',
                                  border: '1px solid ' + c.accent,
                                  borderRadius: 4,
                                  color: c.text, fontSize: 12,
                                  padding: '2px 5px', outline: 'none',
                                  fontFamily: 'inherit',
                                }}
                              />
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                                {qtySpec && <Badge spec={qtySpec} />}
                                <span>{fmtQty(item.qty)}</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '7px 8px', color: c.textMuted, fontSize: 11 }}>{item.unit}</td>
                          <td style={{ textAlign: 'right', padding: '7px 8px', color: c.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                              {rateSpec && <Badge spec={rateSpec} />}
                              <span>{fmtMoney(item.rate, currency)}</span>
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '7px 10px', color: c.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fmtMoney(item.total, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {saveError && (
        <div style={{ padding: '8px 14px', fontSize: 11, color: '#EF4444', background: 'rgba(239,68,68,0.06)', borderTop: '1px solid rgba(239,68,68,0.2)' }}>
          {saveError} · edit the quantity and press Enter to retry.
        </div>
      )}

      {/* ── Totals with markup + trade packages ──────────────────────────
          The bare-cost lines above are what the QS measured. This block is
          the builder's view of the same figures: each section's total once
          markup is on (titles only), then the bill regrouped by trade so
          subcontract packages can be split off and each given its own
          markup. Changing a % here saves it to the pricing preferences, so
          it applies to every BOQ, the Excel export and the findings report. */}
      {(() => {
        const trades = summary.trades || [];
        const defaultPct = Number(summary.ohp_pct || 0);
        const byTrade = !!summary.markup_by_trade;
        const anyMarkup = summary.ohp > 0;
        const cellTh = { textAlign: 'right', padding: '5px 8px', color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' };
        const cellTd = { textAlign: 'right', padding: '6px 8px', color: c.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
        const pctInput = (value, onCommit, { overridden = false, placeholder = '' } = {}) => (
          <input
            type="number" inputMode="decimal" min="0" max="100" step="0.5"
            value={value}
            placeholder={placeholder}
            disabled={markupSaving}
            onChange={e => onCommit(e.target.value, false)}
            onBlur={e => onCommit(e.target.value, true)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            title={overridden ? 'Override for this trade — clear to use the default' : 'Markup on cost for this trade (blank = default)'}
            style={{
              width: 58, textAlign: 'right', fontFamily: 'inherit', fontSize: 12,
              padding: '3px 6px', borderRadius: 5, outline: 'none',
              background: overridden ? 'rgba(124,58,237,0.10)' : 'transparent',
              border: '1px solid ' + (overridden ? '#7C3AED' : c.border),
              color: c.text,
            }}
          />
        );
        return (
          <div style={{ borderTop: '1px solid ' + c.border }}>
            <div
              onClick={() => setMarkupOpen(o => !o)}
              style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: c.sectionBg, borderBottom: '1px solid ' + c.border }}
            >
              <span style={{ transform: markupOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', fontSize: 9, color: c.textMuted }}>▶</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.text, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Totals with markup &amp; trade packages</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: c.textMuted }}>
                {markupSaving ? 'Re-pricing…' : anyMarkup
                  ? (byTrade ? 'Markup by trade · avg ' + fmtPct(summary.ohp_effective_pct) : 'Markup ' + fmtPct(defaultPct) + ' on every line')
                  : 'No markup set — bare cost'}
              </span>
            </div>

            {markupOpen && (
              <div style={{ padding: '10px 14px 12px' }}>
                {/* Default markup */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: c.text, fontWeight: 600 }}>Default markup on cost</span>
                  {pctInput(markupDraft.default, (v, commit) => {
                    const next = { ...markupDraft, default: v };
                    setMarkupDraft(next);
                    if (commit) saveMarkup(next);
                  })}
                  <span style={{ fontSize: 11, color: c.textMuted }}>
                    applies to every trade without its own figure below
                    {Number.isFinite(parseFloat(markupDraft.default)) && parseFloat(markupDraft.default) > 0
                      ? ' · ' + fmtPct(parseFloat(markupDraft.default) / (1 + parseFloat(markupDraft.default) / 100)) + ' margin on price'
                      : ''}
                  </span>
                </div>

                {/* Section totals — titles only */}
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: isMobile ? 360 : undefined }}>
                    <thead>
                      <tr>
                        <th style={{ ...cellTh, textAlign: 'left', padding: '5px 10px' }}>Section</th>
                        <th style={cellTh}>Bare cost</th>
                        <th style={cellTh}>Markup</th>
                        <th style={{ ...cellTh, padding: '5px 10px' }}>With markup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sections.map((sec, si) => (
                        <tr key={'m-' + sec.name} style={{ borderTop: '1px solid ' + c.border }}>
                          <td style={{ padding: '6px 10px', color: c.text }}>
                            <span style={{ color: c.textSub, fontSize: 11, marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>{si + 1}.</span>{sec.name}
                          </td>
                          <td style={cellTd}>{fmtMoney(sec.subtotal, currency)}</td>
                          <td style={{ ...cellTd, color: c.textMuted }}>{fmtPct(sec.markup_pct)}</td>
                          <td style={{ ...cellTd, fontWeight: 600, padding: '6px 10px' }}>{fmtMoney(sec.total_with_markup != null ? sec.total_with_markup : sec.subtotal, currency)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '1px solid ' + c.border, background: c.totalBg }}>
                        <td style={{ padding: '7px 10px', color: c.text, fontWeight: 700 }}>Construction total with markup</td>
                        <td style={{ ...cellTd, fontWeight: 700 }}>{fmtMoney(summary.construction_total, currency)}</td>
                        <td style={{ ...cellTd, color: c.textMuted, fontWeight: 600 }}>{fmtPct(summary.ohp_effective_pct != null ? summary.ohp_effective_pct : defaultPct)}</td>
                        <td style={{ ...cellTd, fontWeight: 700, padding: '7px 10px' }}>{fmtMoney(summary.construction_total_with_markup != null ? summary.construction_total_with_markup : summary.construction_total + (summary.ohp || 0), currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* By trade — subcontractor packages, each with its own markup */}
                {trades.length > 0 && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>By trade</span>
                      <span style={{ fontSize: 11, color: c.textMuted }}>the same lines grouped as subcontractor packages · set a markup per trade, blank = default</span>
                    </div>
                    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: isMobile ? 460 : undefined }}>
                        <thead>
                          <tr>
                            <th style={{ ...cellTh, textAlign: 'left', padding: '5px 10px' }}>Trade package</th>
                            <th style={cellTh}>Lines</th>
                            {!isMobile && <th style={cellTh}>Labour</th>}
                            {!isMobile && <th style={cellTh}>Materials</th>}
                            <th style={cellTh}>Bare cost</th>
                            <th style={cellTh}>Markup %</th>
                            <th style={{ ...cellTh, padding: '5px 10px' }}>With markup</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trades.map((t) => {
                            const overridden = Object.prototype.hasOwnProperty.call(markupDraft.trades, t.trade) && markupDraft.trades[t.trade] !== '';
                            return (
                              <tr key={'t-' + t.trade} style={{ borderTop: '1px solid ' + c.border }}>
                                <td style={{ padding: '6px 10px', color: c.text }} title={(t.sections || []).join(', ')}>
                                  {t.trade}
                                  {t.sections && t.sections.length > 0 && (
                                    <span style={{ display: 'block', fontSize: 10, color: c.textSub, marginTop: 1 }}>{t.sections.slice(0, 3).join(' · ')}{t.sections.length > 3 ? ' · …' : ''}</span>
                                  )}
                                </td>
                                <td style={{ ...cellTd, color: c.textMuted }}>{t.item_count}</td>
                                {!isMobile && <td style={{ ...cellTd, color: c.textMuted }}>{fmtMoney(t.labour, currency)}</td>}
                                {!isMobile && <td style={{ ...cellTd, color: c.textMuted }}>{fmtMoney(t.materials, currency)}</td>}
                                <td style={cellTd}>{fmtMoney(t.subtotal, currency)}</td>
                                <td style={{ ...cellTd, padding: '3px 8px' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    {pctInput(overridden ? markupDraft.trades[t.trade] : '', (v, commit) => {
                                      const nextTrades = { ...markupDraft.trades };
                                      if (v === '' || v == null) delete nextTrades[t.trade]; else nextTrades[t.trade] = v;
                                      const next = { ...markupDraft, trades: nextTrades };
                                      setMarkupDraft(next);
                                      if (commit) saveMarkup(next);
                                    }, { overridden, placeholder: String(defaultPct) })}
                                    {overridden && (
                                      <button
                                        type="button"
                                        aria-label={'Use default markup for ' + t.trade}
                                        title="Back to the default"
                                        disabled={markupSaving}
                                        onClick={() => {
                                          const nextTrades = { ...markupDraft.trades };
                                          delete nextTrades[t.trade];
                                          const next = { ...markupDraft, trades: nextTrades };
                                          setMarkupDraft(next);
                                          saveMarkup(next);
                                        }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textMuted, fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                                      >×</button>
                                    )}
                                  </span>
                                </td>
                                <td style={{ ...cellTd, fontWeight: 600, padding: '6px 10px' }}>{fmtMoney(t.total_with_markup, currency)}</td>
                              </tr>
                            );
                          })}
                          <tr style={{ borderTop: '1px solid ' + c.border, background: c.totalBg }}>
                            <td style={{ padding: '7px 10px', color: c.text, fontWeight: 700 }}>All trades</td>
                            <td style={{ ...cellTd, color: c.textMuted, fontWeight: 600 }}>{trades.reduce((s, t) => s + (t.item_count || 0), 0)}</td>
                            {!isMobile && <td style={{ ...cellTd, fontWeight: 600 }}>{fmtMoney(trades.reduce((s, t) => s + (t.labour || 0), 0), currency)}</td>}
                            {!isMobile && <td style={{ ...cellTd, fontWeight: 600 }}>{fmtMoney(trades.reduce((s, t) => s + (t.materials || 0), 0), currency)}</td>}
                            <td style={{ ...cellTd, fontWeight: 700 }}>{fmtMoney(summary.construction_total, currency)}</td>
                            <td style={{ ...cellTd, color: c.textMuted, fontWeight: 600 }}>{fmtPct(summary.ohp_effective_pct != null ? summary.ohp_effective_pct : defaultPct)}</td>
                            <td style={{ ...cellTd, fontWeight: 700, padding: '7px 10px' }}>{fmtMoney(summary.construction_total_with_markup != null ? summary.construction_total_with_markup : summary.construction_total + (summary.ohp || 0), currency)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10, color: c.textSub, lineHeight: 1.5 }}>
                      Trades are assigned line by line from the item, its description and its section — a starting point for splitting packages, not a rule. Markup is on cost; the margin on price is markup ÷ (100 + markup).
                    </div>
                  </>
                )}

                {markupError && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#EF4444' }}>{markupError}</div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Summary */}
      <div style={{ padding: '12px 14px', background: c.totalBg, borderTop: '1px solid ' + c.border, fontSize: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, columnGap: 12 }}>
          <span style={{ color: c.textMuted }}>Construction total</span>
          <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.construction_total, currency)}</span>

          {/* Margin rows only appear when a playbook actually adds them —
              default is 0 (rates are all-in), so most users never see these. */}
          {summary.contingency > 0 && (
            <>
              <span style={{ color: c.textMuted }}>Contingency ({summary.contingency_pct}%)</span>
              <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.contingency, currency)}</span>
            </>
          )}
          {summary.ohp > 0 && (
            <>
              <span style={{ color: c.textMuted }}>
                Overheads &amp; profit ({summary.markup_by_trade ? 'by trade, avg ' + fmtPct(summary.ohp_effective_pct) : summary.ohp_pct + '%'})
              </span>
              <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.ohp, currency)}</span>
            </>
          )}
          {summary.vat_rate != null && (
            <>
              <span style={{ color: c.textMuted }}>VAT ({summary.vat_rate}%)</span>
              <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.vat, currency)}</span>
            </>
          )}

          <span style={{ color: c.text, fontWeight: 700, fontSize: 13, paddingTop: 4, borderTop: '1px solid ' + c.border, marginTop: 2 }}>
            Grand total
          </span>
          <span style={{ color: c.text, fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right', paddingTop: 4, borderTop: '1px solid ' + c.border, marginTop: 2 }}>
            {fmtMoney(summary.grand_total, currency)}
          </span>
        </div>

        {/* Provenance legend */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + c.border, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Sources:</span>
          {Object.values({ ...QTY_SOURCE_LABELS, ...RATE_SOURCE_LABELS }).map((spec, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Badge spec={spec} />
            </span>
          ))}
        </div>

        {/* Audit panel — exactly what fed the pricer, so the user can see
            why this total is what it is. Deterministic given these inputs. */}
        <details style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + c.border, fontSize: 11 }}>
          <summary style={{ cursor: 'pointer', color: c.textSub, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10, userSelect: 'none' }}>
            How this total was calculated
          </summary>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 4, columnGap: 10, fontSize: 11, color: c.textMuted }}>
            <span>Takeoff ID</span>
            <span style={{ color: c.text, fontFamily: 'ui-monospace, monospace' }}>{data.takeoff?.id || '—'}</span>
            <span>Project type</span>
            <span style={{ color: c.text }}>{data.takeoff?.project_type || summary.project_label || '—'}</span>
            <span>Location</span>
            <span style={{ color: c.text }}>{data.takeoff?.location || '—'}{summary.location_factor != null ? ` · factor ${(summary.location_factor * 100).toFixed(0)}%` : ''}</span>
            <span>Currency</span>
            <span style={{ color: c.text }}>{currency}{summary.vat_rate != null ? ` · VAT ${summary.vat_rate}%` : ''}</span>
            <span>Items</span>
            <span style={{ color: c.text }}>{(data.items_raw || []).length} raw · {sections.reduce((s, sec) => s + (sec.items?.length || 0), 0)} priced</span>
            <span>Margins</span>
            <span style={{ color: c.text }}>
              {(summary.contingency > 0 || summary.ohp > 0)
                ? <>Contingency {summary.contingency_pct}% · OH&amp;P {summary.markup_by_trade ? 'by trade (default ' + summary.ohp_pct + '%, avg ' + fmtPct(summary.ohp_effective_pct) + ')' : summary.ohp_pct + '%'}</>
                : 'None added — rates are all-in'}
            </span>
          </div>
          {data.priced?.warnings && data.priced.warnings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>
                Auto-corrections & caps ({data.priced.warnings.length})
              </div>
              <div style={{ fontSize: 11, color: c.textMuted, lineHeight: 1.5, maxHeight: 140, overflowY: 'auto' }}>
                {data.priced.warnings.map((w, i) => (
                  <div key={i} style={{ padding: '3px 0', borderBottom: i < data.priced.warnings.length - 1 ? '1px solid ' + c.border : 'none' }}>· {w}</div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 10, color: c.textSub, lineHeight: 1.5 }}>
            Pricing is deterministic — given the same items, location, and intake answers, the total will always be identical. AI extraction is pinned to temperature 0 so re-running on the same drawings should give the same quantities.
          </div>
        </details>

        {onRegenerate && (() => {
          // Status-aware button. For DRAFT takeoffs, make it explicit that
          // clicking will lock the quantities and you can't edit after.
          // For CONFIRMED takeoffs, allow a no-dialog regenerate.
          const status = data?.takeoff?.status || 'draft';
          const isDraft = status === 'draft';
          return (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              {isDraft && (
                <span style={{ fontSize: 11, color: c.textMuted, marginRight: 4 }}>
                  Draft · edit any quantity above first
                </span>
              )}
              <AsyncButton
                busyLabel="Generating…"
                onClick={async () => {
                  if (isDraft) {
                    const ok = window.confirm(
                      'This will LOCK your quantities and generate the BOQ & findings report.\n\n'
                      + 'Once locked you cannot edit quantities for this takeoff — you would need to start a new chat to re-measure.\n\n'
                      + 'Lock quantities and generate documents now?'
                    );
                    if (!ok) return;
                  }
                  await onRegenerate();
                }}
                style={{
                  padding: '7px 14px', borderRadius: 7,
                  background: 'linear-gradient(135deg,#F59E0B,#D97706)',
                  border: 'none', color: '#0A0F1C',
                  fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {isDraft ? 'Lock & generate documents' : 'Regenerate documents'}
              </AsyncButton>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

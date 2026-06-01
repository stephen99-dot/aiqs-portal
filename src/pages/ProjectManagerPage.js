import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import { EditIcon, PoundIcon, BarChartIcon, AlertTriangleIcon, CheckIcon, SettingsIcon, RefreshIcon, ClockIcon } from '../components/Icons';

// AI Project Manager — Part A
// Deterministic "needs attention this week" panel. Cards come from
// /api/pm/alerts; thresholds editable via /api/pm/thresholds.
//
// Part B (LLM grounded chat) will mount inside this same page.

const RULE_LABELS = {
  variation_stale: 'Variations awaiting approval',
  payment_due: 'Payments due / overdue',
  budget_overrun: 'Budget overruns',
  quote_stale: 'Quotes with no response',
  day_rate_below_breakeven: 'Day-rate below break-even',
};

const RULE_ICONS = {
  variation_stale: EditIcon,
  payment_due: PoundIcon,
  budget_overrun: BarChartIcon,
  quote_stale: ClockIcon,
  day_rate_below_breakeven: AlertTriangleIcon,
};

export default function ProjectManagerPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showThresholds, setShowThresholds] = useState(false);
  const [thresholds, setThresholds] = useState(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/pm/alerts');
      setData(r);
      setThresholds(r.thresholds);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const saveThresholds = async () => {
    if (!thresholds) return;
    setSaving(true);
    try {
      await apiFetch('/pm/thresholds', {
        method: 'PATCH',
        body: JSON.stringify({
          variation_stale_days: parseInt(thresholds.variation_stale_days, 10),
          quote_stale_days: parseInt(thresholds.quote_stale_days, 10),
          budget_overrun_pct: parseFloat(thresholds.budget_overrun_pct),
          payment_due_horizon_days: parseInt(thresholds.payment_due_horizon_days, 10),
        }),
      });
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  const cards = data?.cards || [];
  // Group by rule.
  const byRule = cards.reduce((acc, c) => { (acc[c.rule] = acc[c.rule] || []).push(c); return acc; }, {});
  const ruleKeys = Object.keys(RULE_LABELS).filter(k => byRule[k] && byRule[k].length > 0);

  const highCount = cards.filter(c => c.severity === 'high').length;
  const totalValue = cards.reduce((s, c) => s + (Number(c.meta?.value) || 0), 0);

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>Project Manager</h1>
        <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
          Things across your jobs that need attention this week. Updated live from your data.
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, margin: '12px 0' }}>{error}</div>}

      {/* Headline strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
        margin: '20px 0',
      }}>
        <Stat t={t} label="Items needing attention" value={cards.length} tone={cards.length > 0 ? (highCount > 0 ? 'danger' : 'warning') : 'success'} />
        <Stat t={t} label="High priority" value={highCount} tone={highCount > 0 ? 'danger' : 'success'} />
        <Stat t={t} label="Combined value at stake" value={totalValue > 0 ? '£' + Math.round(totalValue).toLocaleString('en-GB') : '—'} />
        <Stat t={t} label="Generated" value={data?.generated_at ? new Date(data.generated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'} hint="Refresh to update" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <button onClick={refresh} style={{ ...btnSecondary(t), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshIcon size={14} /> Refresh
        </button>
        <button onClick={() => setShowThresholds(v => !v)} style={{ ...btnSecondary(t), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {showThresholds ? 'Hide thresholds' : <><SettingsIcon size={14} /> Adjust thresholds</>}
        </button>
      </div>

      {/* Thresholds */}
      {showThresholds && thresholds && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>Alert thresholds</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <ThresholdField t={t} label="Variations stale after (days)" value={thresholds.variation_stale_days}
              onChange={v => setThresholds({ ...thresholds, variation_stale_days: v })} />
            <ThresholdField t={t} label="Quotes stale after (days)" value={thresholds.quote_stale_days}
              onChange={v => setThresholds({ ...thresholds, quote_stale_days: v })} />
            <ThresholdField t={t} label="Budget overrun alert (%)" value={thresholds.budget_overrun_pct}
              onChange={v => setThresholds({ ...thresholds, budget_overrun_pct: v })} />
            <ThresholdField t={t} label="Payments due horizon (days)" value={thresholds.payment_due_horizon_days}
              onChange={v => setThresholds({ ...thresholds, payment_due_horizon_days: v })} />
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={saveThresholds} disabled={saving} style={btnPrimary(t, saving)}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* No alerts state */}
      {cards.length === 0 && (
        <div style={{
          background: t.successBg || 'rgba(16,185,129,0.08)',
          border: '1px solid ' + (t.success || '#10B981') + '44',
          borderRadius: 12, padding: 40, textAlign: 'center',
        }}>
          <div style={{ marginBottom: 8, color: t.success || '#10B981' }}><CheckIcon size={40} /></div>
          <div style={{ color: t.success || '#10B981', fontWeight: 700, fontSize: 18 }}>All clear</div>
          <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 6 }}>
            Nothing across your jobs needs attention right now.
          </div>
        </div>
      )}

      {/* Card groups by rule */}
      {ruleKeys.map(rk => (
        <div key={rk} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {(() => { const Ico = RULE_ICONS[rk]; return Ico && <Ico size={18} />; })()}
            <div style={{ color: t.textSecondary, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {RULE_LABELS[rk]}
            </div>
            <div style={{
              background: t.surface, border: '1px solid ' + t.border,
              borderRadius: 999, padding: '0 8px', fontSize: 11, color: t.textSecondary,
            }}>{byRule[rk].length}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {byRule[rk].map(c => <Card key={c.id} t={t} card={c} onClick={() => c.link && nav(c.link)} />)}
          </div>
        </div>
      ))}

      <div style={{
        marginTop: 24, padding: '12px 14px',
        background: t.surface, border: '1px solid ' + t.border,
        borderRadius: 8, fontSize: 12, color: t.textMuted,
      }}>
        These alerts come from plain SQL over your live data — no AI involved. The "Ask anything" assistant (coming next) will use the same data, but it can't take actions on your behalf.
      </div>
    </div>
  );
}

function Stat({ t, label, value, tone, hint }) {
  const accent = tone === 'danger' ? (t.danger || '#EF4444')
    : tone === 'warning' ? (t.warning || '#F59E0B')
    : tone === 'success' ? (t.success || '#10B981')
    : t.text;
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16 }}>
      <div style={{ color: t.textSecondary, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ color: accent, fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 4, letterSpacing: -0.5 }}>{value}</div>
      {hint && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Card({ t, card, onClick }) {
  const sevColours = {
    high: { bg: t.dangerBg || 'rgba(239,68,68,0.08)', border: (t.danger || '#EF4444') + '55', text: t.danger || '#EF4444', label: 'High' },
    medium: { bg: t.warningBg || 'rgba(245,158,11,0.08)', border: (t.warning || '#F59E0B') + '55', text: t.warning || '#F59E0B', label: 'Medium' },
    low: { bg: 'rgba(148,163,184,0.06)', border: t.border, text: t.textSecondary, label: 'Low' },
  };
  const s = sevColours[card.severity] || sevColours.low;
  return (
    <button onClick={onClick} style={{
      background: t.card,
      border: '1px solid ' + s.border,
      borderRadius: 10,
      padding: '14px 16px',
      textAlign: 'left',
      cursor: card.link ? 'pointer' : 'default',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      width: '100%',
      transition: 'transform 0.08s ease, box-shadow 0.12s ease',
      position: 'relative',
      overflow: 'hidden',
    }}
      onMouseEnter={e => { if (card.link) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; } }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: s.text, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            background: s.bg, color: s.text,
            padding: '2px 8px', borderRadius: 4,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
          }}>{s.label}</span>
          <div style={{ color: t.text, fontWeight: 600, fontSize: 14 }}>{card.title}</div>
        </div>
        <div style={{ color: t.textSecondary, fontSize: 12, marginTop: 4 }}>{card.body}</div>
      </div>
      {card.link && (
        <div style={{ color: t.textMuted, fontSize: 18, alignSelf: 'center' }}>›</div>
      )}
    </button>
  );
}

function ThresholdField({ t, label, value, onChange }) {
  return (
    <div>
      <label style={{ display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</label>
      <input
        type="number" min="0" step="any"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: t.bg, border: '1px solid ' + t.border, color: t.text,
          borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none',
        }}
      />
    </div>
  );
}

function btnPrimary(t, disabled) { return { background: disabled ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.7 : 1 }; }
function btnSecondary(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }; }

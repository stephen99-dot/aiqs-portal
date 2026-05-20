import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { apiFetch } from '../../utils/api';
import EstimatorGate from '../../components/EstimatorGate';

// Office Dashboard — what needs your attention this week + one big New Job
// button. The brief calls this "Dashboard" but it's specifically the Office
// in a Box dashboard. The AI PM alerts you already built power this.

export default function OfficeDashboardPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', client_name: '', location: '' });

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch('/pm/alerts');
      setAlerts(r);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const createJob = async () => {
    if (!draft.name.trim()) return;
    try {
      const r = await apiFetch('/finance/jobs', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
      nav('/office/jobs/' + r.id + '/estimate');
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  const cards = alerts?.cards || [];
  const high = cards.filter(c => c.severity === 'high').length;

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
          <h1 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>Dashboard</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Across all your jobs — what needs attention today.
          </div>
        </div>
        <button onClick={() => setCreating(v => !v)} style={{
          background: t.accent, color: '#fff', border: 'none', borderRadius: 10,
          padding: '12px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(245,158,11,0.25)',
        }}>{creating ? 'Cancel' : '+ New Job'}</button>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {creating && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 18 }}>
          <div style={{ color: t.textSecondary, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Start a new job</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Field t={t} label="Job name *" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="e.g. Smith kitchen extension" />
            <Field t={t} label="Client" value={draft.client_name} onChange={v => setDraft({ ...draft, client_name: v })} placeholder="Mr & Mrs Smith" />
            <Field t={t} label="Location" value={draft.location} onChange={v => setDraft({ ...draft, location: v })} placeholder="Bristol" />
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={createJob} disabled={!draft.name.trim()} style={{
              background: draft.name.trim() ? t.accent : t.surface, color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600,
              cursor: draft.name.trim() ? 'pointer' : 'not-allowed',
            }}>Create job & start estimate →</button>
          </div>
        </div>
      )}

      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Stat t={t} label="Items to action" value={cards.length} tone={cards.length > 0 ? (high > 0 ? 'danger' : 'warning') : 'success'} />
        <Stat t={t} label="High priority" value={high} tone={high > 0 ? 'danger' : 'success'} />
        <Stat t={t} label="Generated" value={alerts?.generated_at ? new Date(alerts.generated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'} />
      </div>

      {/* Alerts list */}
      {cards.length === 0 ? (
        <div style={{
          background: t.successBg || 'rgba(16,185,129,0.08)',
          border: '1px solid ' + (t.success || '#10B981') + '44',
          borderRadius: 12, padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
          <div style={{ color: t.success || '#10B981', fontWeight: 700, fontSize: 18 }}>All clear</div>
          <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 6 }}>
            Nothing across your jobs needs attention right now.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cards.map(c => <AlertCard key={c.id} t={t} card={c} onClick={() => c.link && nav(c.link)} />)}
        </div>
      )}
    </div>
  );
}

function Field({ t, label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{ display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: t.bg, border: '1px solid ' + t.border, color: t.text,
          borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none',
        }}
      />
    </div>
  );
}

function Stat({ t, label, value, tone }) {
  const accent = tone === 'danger' ? (t.danger || '#EF4444')
    : tone === 'warning' ? (t.warning || '#F59E0B')
    : tone === 'success' ? (t.success || '#10B981') : t.text;
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 14 }}>
      <div style={{ color: t.textSecondary, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ color: accent, fontSize: 22, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4 }}>{value}</div>
    </div>
  );
}

function AlertCard({ t, card, onClick }) {
  const sev = card.severity === 'high'
    ? { border: (t.danger || '#EF4444') + '55', stripe: t.danger || '#EF4444', chip: { bg: t.dangerBg, fg: t.danger } }
    : card.severity === 'medium'
    ? { border: (t.warning || '#F59E0B') + '55', stripe: t.warning || '#F59E0B', chip: { bg: t.warningBg, fg: t.warning } }
    : { border: t.border, stripe: t.textSecondary, chip: { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary } };
  return (
    <button onClick={onClick} style={{
      background: t.card, border: '1px solid ' + sev.border, borderRadius: 10,
      padding: '12px 14px', textAlign: 'left', cursor: card.link ? 'pointer' : 'default',
      display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', position: 'relative',
    }}>
      <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: sev.stripe, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            background: sev.chip.bg, color: sev.chip.fg,
            padding: '2px 7px', borderRadius: 4,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
          }}>{card.severity}</span>
          <div style={{ color: t.text, fontWeight: 600, fontSize: 14 }}>{card.title}</div>
        </div>
        <div style={{ color: t.textSecondary, fontSize: 12, marginTop: 3 }}>{card.body}</div>
      </div>
      {card.link && <div style={{ color: t.textMuted, fontSize: 18, alignSelf: 'center' }}>›</div>}
    </button>
  );
}

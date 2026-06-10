import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

// Alert settings — when the Today screen should start nagging. Moved here
// from the old Project Manager page; same /api/pm/thresholds API underneath.

const card = {
  padding: 18, borderRadius: 12,
  background: 'var(--bg-card)', border: '1px solid var(--border)',
};
const h3 = { fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' };
const lblStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 };
const hint = { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 };
const inputStyle = {
  width: '100%', maxWidth: 140, padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
};

export default function AlertSettings() {
  const { user } = useAuth();
  const [thresholds, setThresholds] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const isOib = user?.hasEstimator || user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/pm/thresholds');
      setThresholds(r.thresholds);
    } catch (e) { /* gated — section doesn't render */ }
  }, []);
  useEffect(() => { if (isOib) load(); }, [isOib, load]);

  if (!isOib || !thresholds) return null;

  const save = async (key, value) => {
    setError('');
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 0) return;
    setThresholds({ ...thresholds, [key]: n });
    try {
      await apiFetch('/pm/thresholds', { method: 'PATCH', body: JSON.stringify({ [key]: n }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) { setError(e.message); }
  };

  const fields = [
    {
      key: 'quote_stale_days',
      label: 'Tell me a quote has gone quiet after (days)',
      help: "No answer for this many days and it shows up on Today with a nudge button.",
    },
    {
      key: 'variation_stale_days',
      label: 'Tell me a change is unanswered after (days)',
      help: 'Changes you sent for approval that nobody has signed off.',
    },
    {
      key: 'budget_overrun_pct',
      label: 'Warn me when job costs go over plan by (%)',
      help: "Costs creep — this is how far past the budget before you hear about it.",
    },
    {
      key: 'payment_due_horizon_days',
      label: 'Show payments coming up within (days)',
      help: 'Invoices and payment stages due soon, so nothing lands on you by surprise.',
    },
  ];

  return (
    <div style={card}>
      <h3 style={h3}>Alerts {saved && <span style={{ color: '#10B981', textTransform: 'none' }}>· saved</span>}</h3>
      {error && <div style={{ color: '#EF4444', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
      {fields.map(f => (
        <div key={f.key} style={{ marginBottom: 16 }}>
          <label style={lblStyle}>{f.label}</label>
          <input
            type="number" min="0" step="any"
            defaultValue={thresholds[f.key] ?? ''}
            onBlur={e => save(f.key, e.target.value)}
            style={inputStyle}
          />
          <div style={hint}>{f.help}</div>
        </div>
      ))}
    </div>
  );
}

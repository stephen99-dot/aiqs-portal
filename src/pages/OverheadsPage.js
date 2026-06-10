import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

// Starter examples to seed an empty form. Users can edit / delete freely.
const STARTER_LINES = [
  'Van / vehicle finance',
  'Vehicle insurance',
  'Fuel',
  'Phone',
  'Software subscriptions',
  'Tools & equipment',
  'Public liability insurance',
  'Accountant',
  'Office / yard rent',
  'Admin / bookkeeping',
];

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmt(n) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OverheadsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [month, setMonth] = useState('');
  const [lines, setLines] = useState([]);
  const [workingDays, setWorkingDays] = useState(20);
  const [workingHours, setWorkingHours] = useState(8);
  const [targetMargin, setTargetMargin] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [cur, hist] = await Promise.all([
        apiFetch('/finance/overheads/current'),
        apiFetch('/finance/overheads/history'),
      ]);
      setMonth(cur.month);
      if (cur.line_items && cur.line_items.length > 0) {
        setLines(cur.line_items.map(li => ({ name: li.name, amount: li.amount, id: Math.random().toString(36).slice(2) })));
      } else {
        setLines(STARTER_LINES.map(n => ({ name: n, amount: '', id: Math.random().toString(36).slice(2) })));
      }
      setWorkingDays(cur.working_days || 20);
      setWorkingHours(cur.working_hours_per_day || 8);
      setTargetMargin(cur.target_margin_pct == null ? '' : cur.target_margin_pct);
      setNotes(cur.notes || '');
      setHistory(hist.months || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const total = lines.reduce((s, li) => s + num(li.amount), 0);
    const d = num(workingDays);
    const h = num(workingHours);
    const breakDay = d > 0 ? total / d : 0;
    const breakHr = (d > 0 && h > 0) ? total / (d * h) : 0;
    return { total, breakDay, breakHr };
  }, [lines, workingDays, workingHours]);

  const addLine = () => setLines(prev => [...prev, { name: '', amount: '', id: Math.random().toString(36).slice(2) }]);
  const removeLine = (id) => setLines(prev => prev.filter(l => l.id !== id));
  const updateLine = (id, patch) => setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        line_items: lines.filter(l => l.name || l.amount).map(l => ({ name: l.name, amount: num(l.amount) })),
        working_days: num(workingDays),
        working_hours_per_day: num(workingHours),
        target_margin_pct: targetMargin === '' ? null : num(targetMargin),
        notes,
      };
      await apiFetch('/finance/overheads/current', { method: 'PUT', body: JSON.stringify(payload) });
      setSavedAt(new Date());
      const hist = await apiFetch('/finance/overheads/history');
      setHistory(hist.months || []);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1000, margin: '0 auto' }}>
      <button onClick={() => nav('/money')} style={{ background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← Money</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Monthly running costs</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Snapshot for <strong>{month}</strong>. We use this to compute your true break-even rate and to flag under-priced quotes.
          </div>
        </div>
        <button onClick={save} disabled={saving} style={{ background: saving ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save snapshot'}</button>
      </div>
      {savedAt && <div style={{ color: t.success, fontSize: 12, marginBottom: 12 }}>Saved at {savedAt.toLocaleTimeString('en-GB')}</div>}
      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <div style={{ color: t.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>What the business costs each month</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lines.map(l => (
              <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 40px', gap: 8, alignItems: 'center' }}>
                <input
                  value={l.name}
                  onChange={e => updateLine(l.id, { name: e.target.value })}
                  placeholder="Line item (e.g. Van finance)"
                  style={fld(t)}
                />
                <input
                  type="number" step="any" inputMode="decimal"
                  value={l.amount}
                  onChange={e => updateLine(l.id, { amount: e.target.value })}
                  placeholder="£/month"
                  style={{ ...fld(t), textAlign: 'right' }}
                />
                <button onClick={() => removeLine(l.id)} title="Remove" style={{ background: 'transparent', color: t.danger, border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
              </div>
            ))}
          </div>
          <button onClick={addLine} style={{ marginTop: 10, background: 'transparent', color: t.accent, border: '1px dashed ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>+ Add line</button>

          <label style={lbl(t, 16)}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Anything that's changed this month — new tools, seasonal costs, etc." style={ta(t)} />
        </div>

        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <div style={{ color: t.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Days you can work</div>
          <label style={lbl(t)}>Working days / month</label>
          <input type="number" step="any" value={workingDays} onChange={e => setWorkingDays(e.target.value)} style={fld(t)} />
          <label style={lbl(t, 12)}>Hours / day</label>
          <input type="number" step="any" value={workingHours} onChange={e => setWorkingHours(e.target.value)} style={fld(t)} />
          <label style={lbl(t, 12)}>Target margin %</label>
          <input type="number" step="any" value={targetMargin} onChange={e => setTargetMargin(e.target.value)} placeholder="e.g. 15" style={fld(t)} />

          <div style={{ borderTop: '1px solid ' + t.border, marginTop: 16, paddingTop: 14 }}>
            <BigStat t={t} label="Total monthly overhead" value={fmt(totals.total)} />
            <BigStat t={t} label="Break-even day rate" value={fmt(totals.breakDay)} accent />
            <BigStat t={t} label="Break-even hour rate" value={fmt(totals.breakHr)} accent />
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 24, background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16 }}>
          <div style={{ color: t.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Past months</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: t.textSecondary }}>
                <th style={{ textAlign: 'left', padding: '6px 0' }}>Month</th>
                <th style={{ textAlign: 'right', padding: '6px 0' }}>Total</th>
                <th style={{ textAlign: 'right', padding: '6px 0' }}>Working days</th>
                <th style={{ textAlign: 'right', padding: '6px 0' }}>£/day</th>
                <th style={{ textAlign: 'right', padding: '6px 0' }}>£/hr</th>
              </tr>
            </thead>
            <tbody>
              {history.map(h => (
                <tr key={h.month} style={{ borderTop: '1px solid ' + t.border }}>
                  <td style={{ padding: '8px 0' }}>{h.month}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>{fmt(h.total)}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>{h.working_days}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>{fmt(h.break_even_day)}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right' }}>{fmt(h.break_even_hour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BigStat({ t, label, value, accent }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: t.textSecondary, fontSize: 12 }}>{label}</div>
      <div style={{ color: accent ? t.accent : t.text, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function fld(t) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }; }
function ta(t)  { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }; }
function lbl(t, mt) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4, marginTop: mt || 0 }; }

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

function fmtMoney(n) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function FinanceDashboardPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [invoiceAgg, setInvoiceAgg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const d = await apiFetch('/finance/dashboard');
      setData(d);
      try { setInvoiceAgg(await apiFetch('/invoices/_aggregates/dashboard')); } catch (e) {}
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  const oh = data?.overheads;
  const plannedMargin = data && data.planned_revenue > 0
    ? Math.round(((data.planned_revenue - data.planned_cost) / data.planned_revenue) * 100)
    : null;
  const actualVariance = data ? data.actual_cost - data.planned_cost : 0;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Finance dashboard</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Live snapshot — quotes, jobs, overheads, planned vs actual.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => nav('/finance/overheads')} style={btn(t)}>Overheads</button>
          <button onClick={() => nav('/finance/jobs')} style={btn(t)}>Jobs</button>
          <button onClick={() => nav('/invoices')} style={btn(t)}>Invoices</button>
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Card t={t} label="Quotes this month" value={data?.quotes_this_month ?? 0} sub={fmtMoney(data?.quoted_value || 0) + ' quoted'} />
        <Card t={t} label="Win rate" value={data?.win_rate != null ? data.win_rate + '%' : '—'} sub={(data?.won || 0) + ' won / ' + (data?.lost || 0) + ' lost'} />
        <Card
          t={t}
          label="Break-even day rate"
          value={oh ? fmtMoney(oh.break_even_day) : '—'}
          sub={oh ? oh.month + ' · ' + fmtMoney(oh.break_even_hour) + '/hr' : 'Set overheads to compute'}
          highlight={!oh}
          onClick={() => nav('/finance/overheads')}
        />
        <Card
          t={t}
          label="Planned vs actual"
          value={data ? fmtMoney(actualVariance) : '—'}
          sub={(data?.actual_cost != null ? fmtMoney(data.actual_cost) : fmtMoney(0)) + ' of ' + (data?.planned_cost != null ? fmtMoney(data.planned_cost) : fmtMoney(0)) + ' planned'}
          tone={actualVariance > 0 ? 'danger' : 'success'}
        />
      </div>

      {/* Invoice cards */}
      {invoiceAgg && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Card t={t} label="Outstanding" value={fmtMoney(invoiceAgg.outstanding.value)} sub={invoiceAgg.outstanding.count + ' invoice(s)'} onClick={() => nav('/invoices')} />
          <Card t={t} label="Paid this month" value={fmtMoney(invoiceAgg.paid_this_month.value)} sub={invoiceAgg.paid_this_month.count + ' paid'} tone="success" onClick={() => nav('/invoices')} />
          <Card t={t} label="Overdue" value={fmtMoney(invoiceAgg.overdue.value)} sub={invoiceAgg.overdue.count + ' overdue'} tone={invoiceAgg.overdue.count > 0 ? 'danger' : undefined} onClick={() => nav('/invoices')} highlight={invoiceAgg.overdue.count > 0} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Block t={t} title="Jobs">
          <RowKv t={t} k="Planned" v={data?.jobs?.planned || 0} />
          <RowKv t={t} k="Active" v={data?.jobs?.active || 0} />
          <RowKv t={t} k="Completed" v={data?.jobs?.completed || 0} />
          <RowKv t={t} k="Cancelled" v={data?.jobs?.cancelled || 0} />
          <button onClick={() => nav('/finance/jobs')} style={{ ...btn(t), marginTop: 12 }}>Open jobs</button>
        </Block>
        <Block t={t} title="Planned profit">
          <RowKv t={t} k="Planned revenue" v={fmtMoney(data?.planned_revenue)} />
          <RowKv t={t} k="Planned cost" v={fmtMoney(data?.planned_cost)} />
          <RowKv t={t} k="Margin %" v={plannedMargin != null ? plannedMargin + '%' : '—'} />
          <RowKv t={t} k="Actual cost so far" v={fmtMoney(data?.actual_cost)} />
        </Block>
      </div>

      {data?.margin_creep?.length > 0 && (
        <Block t={t} title="Margin creep — jobs where actual cost is closing in on or above planned">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: t.textSecondary }}>
                  <th style={{ textAlign: 'left', padding: '6px 0' }}>Job</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Planned</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Actual</th>
                  <th style={{ textAlign: 'right', padding: '6px 0' }}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {data.margin_creep.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid ' + t.border }}>
                    <td style={{ padding: '8px 0' }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); nav('/finance/jobs/' + r.id); }} style={{ color: t.accent, textDecoration: 'none' }}>{r.name}</a>
                    </td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.planned_cost)}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.actual_cost)}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.variance > 0 ? t.danger : t.warning }}>
                      {fmtMoney(r.variance)} ({r.variance_pct > 0 ? '+' : ''}{r.variance_pct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}
    </div>
  );
}

function Card({ t, label, value, sub, highlight, tone, onClick }) {
  const toneColor = tone === 'danger' ? t.danger : tone === 'success' ? t.success : t.text;
  return (
    <div
      onClick={onClick}
      style={{
        background: t.card, border: '1px solid ' + (highlight ? t.warning + '66' : t.border),
        borderRadius: 12, padding: '14px 16px', cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ color: toneColor, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: t.textMuted, fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Block({ t, title, children }) {
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16 }}>
      <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function RowKv({ t, k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid ' + t.border }}>
      <div style={{ color: t.textSecondary, fontSize: 13 }}>{k}</div>
      <div style={{ color: t.text, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    </div>
  );
}

function btn(t) {
  return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer' };
}

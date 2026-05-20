import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken } from '../utils/api';

// Quotes dashboard — list + stats strip. The "build a new quote" flow lives in
// EstimatorBuilderPage. Both are gated on user.hasEstimator.

const STATUS_OPTIONS = ['draft', 'sent', 'won', 'lost'];

function statusColour(s, t) {
  switch (s) {
    case 'won':   return { bg: t.successBg, fg: t.success };
    case 'lost':  return { bg: t.dangerBg,  fg: t.danger };
    case 'sent':  return { bg: t.warningBg, fg: t.warning };
    default:      return { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  }
}

function fmtMoney(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  const v = Number(n) || 0;
  return sym + v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function EstimatorPage() {
  const { t } = useTheme();
  const { user } = useAuth();
  const nav = useNavigate();

  const [quotes, setQuotes] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [q, s] = await Promise.all([
        apiFetch('/estimator/quotes'),
        apiFetch('/estimator/stats'),
      ]);
      setQuotes(q.quotes || []);
      setStats(s || null);
    } catch (e) {
      setError(e.message || 'Failed to load quotes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleStatus = async (id, status) => {
    try {
      await apiFetch('/estimator/quotes/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
      refresh();
    } catch (e) { alert(e.message); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm('Delete "' + (name || 'this quote') + '"? This cannot be undone.')) return;
    try {
      await apiFetch('/estimator/quotes/' + id, { method: 'DELETE' });
      refresh();
    } catch (e) { alert(e.message); }
  };

  const handleDuplicate = async (id) => {
    try {
      const r = await apiFetch('/estimator/quotes/' + id + '/duplicate', { method: 'POST' });
      nav('/estimator/quote/' + r.id);
    } catch (e) { alert(e.message); }
  };

  const downloadPdf = (id) => {
    const tok = getToken();
    fetch('/api/estimator/quotes/' + id + '/pdf', { headers: { Authorization: 'Bearer ' + tok } })
      .then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'quote.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(e => alert(e.message));
  };

  if (!user?.hasEstimator && user?.role !== 'admin') {
    return (
      <div style={{ padding: 32, color: t.text }}>
        <div style={{
          maxWidth: 560, margin: '60px auto', padding: 32, borderRadius: 12,
          background: t.card, border: '1px solid ' + t.border, textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <h2 style={{ margin: 0, fontSize: 22, color: t.text }}>Estimator add-on</h2>
          <p style={{ color: t.textSecondary, marginTop: 12 }}>
            The fast quote generator is available as a £50/month add-on. It turns a one-line
            job description into a branded, itemised quote in seconds.
          </p>
          <p style={{ color: t.textMuted, fontSize: 13 }}>
            Contact support to enable it on your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, color: t.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, color: t.text }}>Quotes</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Fast itemised quotes — describe a job, get a branded PDF.
          </div>
        </div>
        <button
          onClick={() => nav('/estimator/new')}
          style={{
            background: t.accent, color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >+ New Quote</button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard t={t} label="Quotes this month" value={stats ? stats.this_month_count : '—'} />
        <StatCard t={t} label="Total quoted" value={stats ? fmtMoney(stats.this_month_value, 'GBP') : '—'} />
        <StatCard t={t} label="Win rate" value={stats && stats.win_rate != null ? stats.win_rate + '%' : '—'} />
        <StatCard t={t} label="Won / Lost" value={stats ? (stats.won + ' / ' + stats.lost) : '—'} />
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ color: t.textSecondary, padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : quotes.length === 0 ? (
        <div style={{
          background: t.card, border: '1px dashed ' + t.border, borderRadius: 12,
          padding: 40, textAlign: 'center', color: t.textSecondary,
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
          <div style={{ color: t.text, fontWeight: 600, marginBottom: 6 }}>No quotes yet</div>
          <div style={{ marginBottom: 16 }}>Describe a job and we'll draft an itemised quote in seconds.</div>
          <button
            onClick={() => nav('/estimator/new')}
            style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}
          >Create your first quote</button>
        </div>
      ) : (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: t.surface, color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <th style={th}>Quote</th>
                <th style={th}>Client</th>
                <th style={th}>Project</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={th}>Status</th>
                <th style={th}>Date</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => {
                const sc = statusColour(q.status, t);
                return (
                  <tr key={q.id} style={{ borderTop: '1px solid ' + t.border }}>
                    <td style={td}>
                      <a
                        onClick={(e) => { e.preventDefault(); nav('/estimator/quote/' + q.id); }}
                        href="#"
                        style={{ color: t.accent, textDecoration: 'none', fontWeight: 600 }}
                      >{q.quote_number || q.id.slice(0, 8)}</a>
                    </td>
                    <td style={td}>{q.client_name || <span style={{ color: t.textMuted }}>—</span>}</td>
                    <td style={td}>{q.project_name || <span style={{ color: t.textMuted }}>—</span>}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(q.grand_total, q.currency)}</td>
                    <td style={td}>
                      <select
                        value={q.status || 'draft'}
                        onChange={e => handleStatus(q.id, e.target.value)}
                        style={{
                          background: sc.bg, color: sc.fg, border: '1px solid ' + sc.fg + '33',
                          borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 600,
                          textTransform: 'capitalize', cursor: 'pointer',
                        }}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ ...td, color: t.textSecondary, fontSize: 13 }}>{new Date(q.created_at).toLocaleDateString('en-GB')}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => nav('/estimator/quote/' + q.id)} style={btnGhost(t)}>Open</button>
                      <button onClick={() => downloadPdf(q.id)} style={btnGhost(t)}>PDF</button>
                      <button onClick={() => handleDuplicate(q.id)} style={btnGhost(t)}>Duplicate</button>
                      <button onClick={() => handleDelete(q.id, q.project_name)} style={{ ...btnGhost(t), color: t.danger }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const td = { padding: '12px 14px', fontSize: 14 };
function btnGhost(t) {
  return {
    background: 'transparent', color: t.text, border: '1px solid ' + t.border,
    borderRadius: 6, padding: '4px 10px', fontSize: 12, marginLeft: 6, cursor: 'pointer',
  };
}

function StatCard({ t, label, value }) {
  return (
    <div style={{
      background: t.card, border: '1px solid ' + t.border, borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{ color: t.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ color: t.text, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

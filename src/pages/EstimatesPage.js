import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import useDataChanged from '../hooks/useDataChanged';
import { openMax, fmtMoney2 } from '../utils/max';
import { Button, Card, Badge, PageHeader, EmptyState, SkeletonRows } from '../ui';
import { PoundIcon, MicIcon, SparklesIcon } from '../components/Icons';

// ═══ Estimates — everything MAX has priced for the builder (and any quote
// made by hand), with status and totals. Open one to edit, export or send.

const STATUS_TONE = { draft: 'neutral', sent: 'info', accepted: 'success', won: 'success', lost: 'danger', declined: 'danger', expired: 'warning' };
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
];

function fmtDate(raw) {
  if (!raw) return '';
  const d = new Date(String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EstimatesPage() {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(() => {
    return apiFetch('/estimator/quotes')
      .then((r) => { setQuotes(r.quotes || []); setError(''); })
      .catch((e) => setError(e.message || 'Could not load your estimates.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load, ['estimates']);

  const shown = quotes.filter((q) => filter === 'all' || (filter === 'accepted' ? (q.status === 'accepted' || q.status === 'won') : q.status === filter));
  const exVat = (q) => Number(q.net_total || 0) * (1 + 0) + 0; // net is ex VAT; OH&P/contingency live on the detail page
  const limits = user && user.maxLimits;

  return (
    <div className="page">
      <PageHeader
        title="Estimates"
        subtitle={limits ? `Small jobs MAX has priced from your rates — up to ${'£' + Math.round(limits.limitGbp).toLocaleString('en-GB')} ex VAT. Open one to check the lines, edit, download or send it.` : 'Open an estimate to check the lines, edit, download or send it.'}
        actions={(
          <Button onClick={() => openMax({ prompt: 'Price a job: ', keyboard: true })} data-tour="estimates-ask">
            <MicIcon size={15} color="currentColor" /> Price a job with MAX
          </Button>
        )}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const n = f.key === 'all' ? quotes.length : quotes.filter((q) => f.key === 'accepted' ? (q.status === 'accepted' || q.status === 'won') : q.status === f.key).length;
          return (
            <button key={f.key} type="button" className="max-chip" onClick={() => setFilter(f.key)}
              style={filter === f.key ? { background: 'var(--text-primary)', color: 'var(--bg-card)', borderColor: 'var(--text-primary)' } : undefined}>
              {f.label} <span style={{ opacity: 0.7, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{n}</span>
            </button>
          );
        })}
      </div>

      <Card>
        {loading ? <SkeletonRows rows={4} /> : error ? (
          <EmptyState icon={PoundIcon} title="Could not load estimates" body={error} action={<Button onClick={load}>Try again</Button>} />
        ) : shown.length === 0 ? (
          <EmptyState icon={SparklesIcon} title={quotes.length ? 'Nothing here' : 'No estimates yet'}
            body={quotes.length ? 'No estimates match that filter.' : 'Describe a small job to MAX — "a 20 m² patio, taking up the old slabs" — and the priced estimate appears here, built from your own rates.'}
            action={<Button onClick={() => openMax({ prompt: 'Price a job: ', keyboard: true })}><MicIcon size={14} color="currentColor" /> Ask MAX to price a job</Button>} />
        ) : (
          <div>
            {shown.map((q) => (
              <Link key={q.id} to={'/estimates/' + q.id} className="ui-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="ui-row__main">
                  <div className="ui-row__title" style={{ fontSize: '0.95rem', fontWeight: 700 }}>{q.project_name || q.quote_number}</div>
                  <div className="ui-row__meta">
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{q.quote_number}</span>
                    {q.client_name && <span>{q.client_name}</span>}
                    {q.location && <span>{q.location}</span>}
                    {q.source === 'max' && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Priced by MAX</span>}
                  </div>
                </div>
                <div className="ui-row__side">
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{fmtMoney2(q.grand_total, q.currency)}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>inc VAT · {fmtMoney2(exVat(q), q.currency)} net</div>
                  </div>
                  <Badge tone={STATUS_TONE[q.status] || 'neutral'}>{q.status === 'won' ? 'accepted' : q.status}</Badge>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtDate(q.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

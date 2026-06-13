import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';

/**
 * Variations hub — top-level entry that lists every project with at least
 * one variation, then deep-links into the existing per-project variations
 * page. Without this, variations were buried inside individual projects
 * with no way to scan across the portfolio.
 */
export default function VariationsHubPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/variations-hub')
      .then((data) => { if (!cancelled) setProjects(data.projects || []); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load variations'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function fmt(p) {
    const sym = p.currency === 'EUR' ? '€' : '£';
    const v = p.total_net_change || 0;
    const sign = v >= 0 ? '+' : '−';
    return sign + sym + Math.abs(Math.round(v)).toLocaleString('en-GB');
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em',
        }}>
          Variations
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '4px 0 0' }}>
          Every project with variation orders. Click a row to manage that project's variations.
        </p>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#EF4444', fontSize: 13,
        }}>{error}</div>
      )}

      {loading && <div style={{ padding: 28, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}

      {!loading && projects.length === 0 && !error && (
        <div style={{
          padding: 36, textAlign: 'center', borderRadius: 12,
          background: 'var(--card-bg)', border: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>No variations yet</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            Open a project and add a variation order from its variations tab.
          </p>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div style={{
          borderRadius: 12, border: '1px solid var(--border)',
          background: 'var(--card-bg)', overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 130px 100px 100px 130px 70px',
            minWidth: 560,
            gap: 8, padding: '11px 16px',
            background: 'rgba(27,42,74,0.06)',
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
            color: 'var(--text-muted)', textTransform: 'uppercase',
          }}>
            <div>Project</div>
            <div>Owner</div>
            <div style={{ textAlign: 'center' }}>Total</div>
            <div style={{ textAlign: 'center' }}>Approved</div>
            <div style={{ textAlign: 'right' }}>Net change</div>
            <div></div>
          </div>
          {projects.map((p) => (
            <Link
              key={p.project_id}
              to={`/project/${p.project_id}/variations`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 130px 100px 100px 130px 70px',
                minWidth: 560,
                gap: 8, padding: '14px 16px',
                borderTop: '1px solid var(--border)',
                fontSize: 13, color: 'inherit', textDecoration: 'none',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.project_title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {p.project_type}
                  {p.last_change_at ? ' · last update ' + new Date(p.last_change_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.owner_name || p.owner_email || '—'}
              </div>
              <div style={{ textAlign: 'center', fontWeight: 700 }}>
                {p.variation_count}
                {p.draft_count > 0 && (
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#F59E0B' }}>{p.draft_count} draft</div>
                )}
              </div>
              <div style={{ textAlign: 'center', fontWeight: 700, color: '#10B981' }}>
                {p.approved_count || 0}
              </div>
              <div style={{
                textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                color: (p.total_net_change || 0) >= 0 ? '#10B981' : '#EF4444',
              }}>
                {fmt(p)}
              </div>
              <div style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 16 }}>→</div>
            </Link>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

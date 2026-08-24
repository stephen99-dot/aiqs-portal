import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import useIsMobile from '../utils/useIsMobile';
import { Card, Banner, PageHeader, EmptyState, SkeletonRows } from '../ui';
import { LayersIcon } from '../components/Icons';

/**
 * Variations hub — top-level entry that lists every project with at least
 * one variation, then deep-links into the existing per-project variations
 * page. Without this, variations were buried inside individual projects
 * with no way to scan across the portfolio.
 */
export default function VariationsHubPage() {
  const isMobile = useIsMobile();
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
      <PageHeader
        title="Variations"
        subtitle="Every project with variation orders. Click a row to manage that project's variations."
      />

      {error && (
        <Banner tone="danger" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</Banner>
      )}

      {loading && (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      )}

      {!loading && projects.length === 0 && !error && (
        <Card>
          <EmptyState
            icon={LayersIcon}
            title="No variations yet"
            body="Open a project and add a variation order from its variations tab."
          />
        </Card>
      )}

      {!loading && projects.length > 0 && (
        <Card>
          <div style={{ overflowX: isMobile ? 'visible' : 'auto', WebkitOverflowScrolling: 'touch' }}>
          {!isMobile && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 130px 100px 100px 130px 70px',
            minWidth: 560,
            gap: 8, padding: '11px 16px',
            background: 'var(--surface-hover)',
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
          )}
          {projects.map((p) => (
            isMobile ? (
            <Link
              key={p.project_id}
              to={`/project/${p.project_id}/variations`}
              style={{
                display: 'block',
                padding: '14px 16px',
                borderTop: '1px solid var(--border)',
                fontSize: 13, color: 'inherit', textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.project_title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {p.project_type}
                    {p.last_change_at ? ' · last update ' + new Date(p.last_change_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </div>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 16 }}>→</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Owner: {p.owner_name || p.owner_email || '—'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6, alignItems: 'baseline' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Total: <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.variation_count}</span>
                  {p.draft_count > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)' }}> · {p.draft_count} draft</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Approved: <span style={{ fontWeight: 700, color: 'var(--success)' }}>{p.approved_count || 0}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Net change: <span style={{
                    fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                    color: (p.total_net_change || 0) >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}>{fmt(p)}</span>
                </div>
              </div>
            </Link>
            ) : (
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
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--warning)' }}>{p.draft_count} draft</div>
                )}
              </div>
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--success)' }}>
                {p.approved_count || 0}
              </div>
              <div style={{
                textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                color: (p.total_net_change || 0) >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>
                {fmt(p)}
              </div>
              <div style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 16 }}>→</div>
            </Link>
            )
          ))}
          </div>
        </Card>
      )}
    </div>
  );
}

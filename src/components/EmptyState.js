import React from 'react';
import { Link } from 'react-router-dom';

// Shared empty/loading state for lists and tables — branded, helpful, with
// the one relevant CTA (e.g. empty jobs list → "Submit your first drawings").
export default function EmptyState({ loading, loadingText, icon, title, message, ctaLabel, ctaTo, onCta }) {
  if (loading) {
    return (
      <div className="empty-state">
        <div className="loading-spinner" />
        <p>{loadingText || 'Loading…'}</p>
      </div>
    );
  }
  return (
    <div className="empty-state">
      {icon && (
        <div style={{
          width: 52, height: 52, borderRadius: 14, margin: '0 auto var(--space-3)',
          background: 'rgba(245,158,11,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)',
        }}>
          {icon}
        </div>
      )}
      {title && <h3>{title}</h3>}
      {message && <p>{message}</p>}
      {ctaLabel && ctaTo && (
        <Link to={ctaTo} className="btn-primary" style={{ marginTop: 'var(--space-4)' }}>
          {ctaLabel}
        </Link>
      )}
      {ctaLabel && !ctaTo && onCta && (
        <button type="button" onClick={onCta} className="btn-primary" style={{ marginTop: 'var(--space-4)' }}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';

// Standard page header: optional back link, kicker (section eyebrow),
// display title, muted subtitle, and right-aligned actions that stack on
// mobile.
//
//   <PageHeader back={{ to: '/dashboard', label: 'All Projects' }}
//     title="12 Hill St" subtitle="…" actions={<Button>…</Button>} />
export default function PageHeader({ back, kicker, title, subtitle, actions, titleExtra, className = '', ...rest }) {
  return (
    <div className={`ui-page-header ${className}`.trim()} {...rest}>
      <div style={{ minWidth: 0 }}>
        {back && (
          <Link to={back.to} className="back-link">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
            {back.label || 'Back'}
          </Link>
        )}
        {kicker && <div className="ui-page-header__kicker">{kicker}</div>}
        <h1 className="ui-page-header__title">{title}{titleExtra}</h1>
        {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </div>
  );
}

import React from 'react';

// Standard page header: optional kicker (section eyebrow), display title,
// muted subtitle, and right-aligned actions that stack on mobile.
//
//   <PageHeader kicker="Office in a Box" title="Jobs" subtitle="…"
//     actions={<Button to="/estimator/new">New quote</Button>} />
export default function PageHeader({ kicker, title, subtitle, actions, titleExtra, className = '', ...rest }) {
  return (
    <div className={`ui-page-header ${className}`.trim()} {...rest}>
      <div style={{ minWidth: 0 }}>
        {kicker && <div className="ui-page-header__kicker">{kicker}</div>}
        <h1 className="ui-page-header__title">{title}{titleExtra}</h1>
        {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </div>
  );
}

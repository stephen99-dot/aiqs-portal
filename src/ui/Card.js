import React from 'react';

// Card + Card.Header + Card.Body — the standard content container.
//
//   <Card>
//     <Card.Header title="Your Projects" extra={<span>12 total</span>} />
//     <Card.Body flush>…rows…</Card.Body>
//   </Card>
export default function Card({ flat = false, className = '', style, children, ...rest }) {
  const cls = ['ui-card', flat ? 'ui-card--flat' : '', className].filter(Boolean).join(' ');
  return <div className={cls} style={style} {...rest}>{children}</div>;
}

function Header({ title, extra, children, className = '', ...rest }) {
  return (
    <div className={`ui-card__header ${className}`.trim()} {...rest}>
      {title != null && <h2 className="ui-card__title">{title}</h2>}
      {children}
      {extra != null && <div className="header-hint">{extra}</div>}
    </div>
  );
}

function Body({ flush = false, className = '', children, ...rest }) {
  const cls = ['ui-card__body', flush ? 'ui-card__body--flush' : '', className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}

Card.Header = Header;
Card.Body = Body;

// Banner — a left-accented notice card (onboarding prompts, admin messages).
export function Banner({ tone = 'accent', className = '', style, children, ...rest }) {
  return (
    <div className={`ui-banner ui-banner--${tone} ${className}`.trim()} style={style} {...rest}>
      {children}
    </div>
  );
}

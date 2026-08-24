import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

// The one button. Renders a <button>, a router <Link> (`to`), or an <a>
// (`href`) with identical styling. An async onClick automatically disables
// the button and swaps in `busyLabel` until it settles, so double-submits
// can't happen (this folds in what AsyncButton did).
//
//   <Button onClick={save} busyLabel="Saving…">Save</Button>
//   <Button variant="secondary" size="sm" to="/jobs">All jobs</Button>
export default function Button({
  variant = 'primary', size = 'md', full = false,
  to, href, onClick, busyLabel, disabled = false,
  className = '', children, type = 'button', ...rest
}) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const cls = [
    'ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`,
    full ? 'ui-btn--full' : '', busy ? 'ui-btn--busy' : '', className,
  ].filter(Boolean).join(' ');

  if (to) {
    return <Link to={to} className={cls} onClick={onClick} {...rest}>{children}</Link>;
  }
  if (href) {
    return <a href={href} className={cls} onClick={onClick} {...rest}>{children}</a>;
  }

  const handleClick = async (e) => {
    if (busy || disabled || !onClick) return;
    const result = onClick(e);
    if (result && typeof result.then === 'function') {
      setBusy(true);
      try { await result; } finally { if (mounted.current) setBusy(false); }
    }
  };

  return (
    <button type={type} className={cls} disabled={disabled || busy} onClick={handleClick} {...rest}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

// Icon-only button for row actions (rename, delete, close).
export function IconButton({ danger = false, className = '', children, ...rest }) {
  const cls = ['ui-icon-btn', danger ? 'ui-icon-btn--danger' : '', className].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

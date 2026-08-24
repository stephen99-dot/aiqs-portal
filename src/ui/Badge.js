import React from 'react';

// Badge — the one way to render a chip. Tones map to the semantic palette,
// so the same tone is the same colour on every page, in both themes.
//
//   <Badge tone="success">Delivered</Badge>
//   <Badge tone="accent" size="sm" outlined>Beta</Badge>
export default function Badge({
  tone = 'neutral', size = 'md', pill = false, outlined = false,
  className = '', children, ...rest
}) {
  const cls = [
    'ui-badge', `ui-badge--${tone}`,
    size === 'sm' ? 'ui-badge--sm' : '',
    pill ? 'ui-badge--pill' : '',
    outlined ? 'ui-badge--outlined' : '',
    className,
  ].filter(Boolean).join(' ');
  return <span className={cls} {...rest}>{children}</span>;
}

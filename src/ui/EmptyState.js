import React from 'react';

// Designed empty state: icon chip, serif title, short body, and the primary
// action right there — an empty screen should always say what to do next.
//
//   <EmptyState icon={FolderIcon} title="No projects yet"
//     body="Submit your drawings and your BOQ appears here."
//     action={<Button to="/submit-drawings">Submit Your Drawings</Button>} />
export default function EmptyState({ icon: Icon, title, body, action, children, className = '', ...rest }) {
  return (
    <div className={`ui-empty ${className}`.trim()} {...rest}>
      {Icon && <div className="ui-empty__icon"><Icon size={24} color="currentColor" /></div>}
      {title && <h3 className="ui-empty__title">{title}</h3>}
      {(body || children) && <p className="ui-empty__body">{body || children}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

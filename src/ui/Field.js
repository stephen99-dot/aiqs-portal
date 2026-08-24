import React from 'react';

// Form primitives. Use bare <Input>/<Select>/<Textarea> inline, or wrap in
// <Field label="…"> for the standard labelled layout.
//
//   <Field label="Customer name" hint="Autocompletes from your clients">
//     <Input value={v} onChange={…} />
//   </Field>

export function Input({ className = '', ...rest }) {
  return <input className={`ui-input ${className}`.trim()} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return <select className={`ui-select ${className}`.trim()} {...rest}>{children}</select>;
}

export function Textarea({ className = '', ...rest }) {
  return <textarea className={`ui-textarea ${className}`.trim()} {...rest} />;
}

export function Field({ label, hint, error, children, className = '', ...rest }) {
  return (
    <label className={`ui-field ${className}`.trim()} {...rest}>
      {label && <span className="ui-field__label">{label}</span>}
      {children}
      {error
        ? <span className="ui-field__error">{error}</span>
        : hint ? <span className="ui-field__hint">{hint}</span> : null}
    </label>
  );
}

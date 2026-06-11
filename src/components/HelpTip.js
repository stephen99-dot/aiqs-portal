import React, { useState } from 'react';
import { HelpCircleIcon } from './Icons';

// D — the Help affordance: one short, static, plain-English explainer per
// OiB page, written for someone who has never used software like this.
// A "?" next to the page title opens a bottom sheet; no AI, no links out.

export default function HelpTip({ t, title, text }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="What is this page?"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: t.textMuted, minWidth: 44, minHeight: 44,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          verticalAlign: 'middle', padding: 0,
        }}
      >
        <HelpCircleIcon size={18} />
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1100,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: t.card, color: t.text, width: '100%', maxWidth: 480,
            borderRadius: '16px 16px 0 0', padding: '20px 20px calc(24px + env(safe-area-inset-bottom))',
            border: '1px solid ' + t.border, borderBottom: 'none', boxSizing: 'border-box',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</div>
            <div style={{ color: t.textSecondary, fontSize: 14.5, lineHeight: 1.55, whiteSpace: 'pre-line' }}>{text}</div>
            <button onClick={() => setOpen(false)} style={{
              width: '100%', minHeight: 48, marginTop: 16, borderRadius: 10, border: 'none',
              background: t.accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

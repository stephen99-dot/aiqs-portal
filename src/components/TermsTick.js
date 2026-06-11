import React from 'react';
import { useTheme } from '../context/ThemeContext';

// Mandatory T&Cs tick shown on every job-submission form. The server enforces
// it too (and records when + which version was accepted), so the tick is an
// audit trail, not decoration. Keep TERMS_VERSION in server code in step with
// the "Last updated" date on theaiqs.co.uk/terms.html.

export const TERMS_URL = 'https://theaiqs.co.uk/terms.html';
export const PRIVACY_URL = 'https://theaiqs.co.uk/privacy.html';

export default function TermsTick({ checked, onChange }) {
  const { t } = useTheme();
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
      background: t.card, border: '1px solid ' + (checked ? t.border : (t.warning || '#F59E0B') + '66'),
      borderRadius: 10, padding: '12px 14px', margin: '14px 0',
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        required
        style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: t.accent }}
      />
      <span style={{ fontSize: 13, color: t.textSecondary, lineHeight: 1.55 }}>
        I've read and agree to the{' '}
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" style={{ color: t.accent }}>Terms &amp; Conditions</a>
        {' '}and{' '}
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" style={{ color: t.accent }}>Privacy Policy</a>
        {' '}— including that AI-generated documents are estimates which I must check and verify before relying on them.
      </span>
    </label>
  );
}

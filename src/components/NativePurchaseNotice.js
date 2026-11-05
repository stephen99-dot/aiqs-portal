import React from 'react';
import { CreditCardIcon } from './Icons';

// Shown inside the iOS app where the website shows Stripe buy buttons. No
// link, no price, no "go to our website and pay" — Apple's reviewers reject
// all three under guideline 3.1.1. The wording is deliberately the one Apple
// accepts for "reader"-style apps.
export default function NativePurchaseNotice({ compact = false, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: compact ? '10px 12px' : '14px 16px',
      background: 'var(--surface-hover)', border: '1px solid var(--border)',
      borderRadius: 10, color: 'var(--text-secondary)',
      fontSize: compact ? '0.8rem' : '0.86rem', lineHeight: 1.5, ...style,
    }}>
      <CreditCardIcon size={16} color="var(--text-muted)" />
      <div>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>BOQ credits</div>
        Credits and plans are managed in your AI QS account outside the app. Credits you add there appear here straight away.
      </div>
    </div>
  );
}

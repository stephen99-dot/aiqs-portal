import React from 'react';
import { CreditCardIcon } from './Icons';

// Shown inside the iOS app where the website shows Stripe buy buttons. No
// link, no price, and no mention of buying anywhere else — Apple's reviewers
// reject all three under guideline 3.1.1. It states a fact about the balance
// and nothing more.
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
        Your balance updates automatically whenever credits are added to your AI QS account.
      </div>
    </div>
  );
}

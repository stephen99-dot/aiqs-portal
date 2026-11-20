import React from 'react';
import { Link } from 'react-router-dom';

// Public page describing how to delete an AI QS account. Google Play's Data
// safety form and Apple's review both ask for a web address where a person can
// find out how to delete their account; the deletion itself happens from the
// signed-in menu (web and app) and is immediate.
export default function DeleteAccountInfoPage() {
  return (
    <div className="auth-page full-height-page">
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo-mark">AI <span>QS</span></div>
            <h1>Delete your AI QS account</h1>
            <p>You can delete your account yourself at any time. It takes effect immediately.</p>
          </div>
          <ol style={{ paddingLeft: 20, color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li><Link to="/login">Sign in</Link> to AI QS on the website or in the app.</li>
            <li>Open the menu (the ☰ button on a phone, the left-hand sidebar on a computer).</li>
            <li>Choose <strong>Delete account</strong> at the bottom of the menu.</li>
            <li>Confirm with your password (or type DELETE if you sign in with Google).</li>
          </ol>
          <p style={{ marginTop: 18, fontSize: '0.86rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>What is deleted:</strong> your account, projects, uploaded drawings, chat
            history, rates, branding and memory. Any subscription is cancelled. Documents already emailed to you are unaffected.
            Invoices and payment records are kept for as long as UK tax law requires, then removed.
          </p>
          <p style={{ marginTop: 12, fontSize: '0.86rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Can't sign in? Email <a href="mailto:hello@theaiqs.com?subject=Delete%20my%20AI%20QS%20account" style={{ color: 'var(--accent)' }}>hello@theaiqs.com</a> from
            the address on the account and we'll delete it for you within 7 days.
          </p>
          <div className="auth-footer"><Link to="/login">Back to sign in</Link></div>
        </div>
      </div>
    </div>
  );
}

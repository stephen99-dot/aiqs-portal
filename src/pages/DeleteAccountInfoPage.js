import React from 'react';
import { Link } from 'react-router-dom';

// Public page: how to delete an AI QS account and what is removed.
//
// Google Play (Data safety → "Delete account URL") and Apple both require a
// web address, reachable without the app, where a user can find out how to
// have their account and data deleted. The deletion itself is the "Delete
// account" button in the menu (DELETE /api/auth/me); this page explains it
// and gives a route for someone who can no longer sign in.
const SUPPORT_URL = 'https://theaiqs.co.uk/contact';

const wrap = {
  minHeight: '100dvh', background: 'var(--bg-primary)', color: 'var(--text-primary)',
  padding: 'calc(32px + var(--safe-top)) 20px calc(48px + var(--safe-bottom))',
};
const card = { maxWidth: 680, margin: '0 auto', lineHeight: 1.6, fontSize: 15 };
const h2 = { fontSize: 17, fontWeight: 700, margin: '28px 0 8px' };

export default function DeleteAccountInfoPage() {
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>
          AI <span style={{ color: 'var(--accent)' }}>QS</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '12px 0 8px' }}>Delete your AI QS account</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          AI QS Quantity Surveying is provided by THEAIQS LTD. This page explains how to delete
          your account and the data held with it.
        </p>

        <h2 style={h2}>Delete it yourself</h2>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          <li>Sign in to the AI QS app, or to the portal in a web browser.</li>
          <li>Open the menu.</li>
          <li>Choose <strong>Delete account</strong> at the bottom and confirm.</li>
        </ol>
        <p>Deletion is immediate and cannot be undone.</p>
        <p><Link to="/login" style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in to the portal</Link></p>

        <h2 style={h2}>If you cannot sign in</h2>
        <p>
          Contact us from the email address registered on the account and ask for it to be deleted.
          We will confirm it is you and delete the account within 30 days.
        </p>
        <p><a href={SUPPORT_URL} style={{ color: 'var(--accent)', fontWeight: 600 }}>Contact THEAIQS LTD</a></p>

        <h2 style={h2}>What is deleted</h2>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Your account and profile: name, email address, phone number and company details.</li>
          <li>Your projects, and the drawings, photos and other files you uploaded.</li>
          <li>The documents delivered to you, your rates, and your chat history.</li>
          <li>The notification token for any phone signed in to the account.</li>
          <li>Any active subscription is cancelled.</li>
        </ul>

        <h2 style={h2}>What may be kept</h2>
        <p style={{ marginBottom: 0 }}>
          Records we are required by law to keep, such as invoices and payment records for tax
          purposes, are retained for the period the law requires (normally six years) and then
          deleted. Payment card details are held by our payment provider, not by us.
        </p>
      </div>
    </div>
  );
}

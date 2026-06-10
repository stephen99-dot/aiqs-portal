import React, { useState } from 'react';
import { CopyIcon, CheckIcon, XIcon } from './Icons';

// Share sheet shown after "Send the quote" (and reusable for any public link).
// Builders send links by WhatsApp/text far more than email, so copy + native
// share are always front and centre. Mobile-first: bottom sheet under 480px.

export default function ShareLinkModal({ url, title, message, onClose, t }) {
  const [copied, setCopied] = useState(false);
  const shareText = message || 'Here’s your quote — you can view and accept it here:';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      // Clipboard can be unavailable (http, permissions) — select-able URL below is the fallback.
      window.prompt('Copy this link:', url);
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: title || 'Quote', text: shareText, url });
    } catch (e) { /* user cancelled — nothing to do */ }
  };

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
  const whatsappHref = 'https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + url);

  const btn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', minHeight: 48, borderRadius: 10, fontSize: 15, fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: t.card, color: t.text, width: '100%', maxWidth: 480,
          borderRadius: '16px 16px 0 0', padding: '20px 20px 28px',
          border: '1px solid ' + t.border, borderBottom: 'none', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{title || 'Send this link to your client'}</div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: t.textSecondary, cursor: 'pointer',
            minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><XIcon size={20} /></button>
        </div>
        <div style={{ color: t.textSecondary, fontSize: 14, marginBottom: 16 }}>
          WhatsApp or text works best — your client taps the link, sees the quote, and accepts it on their phone.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {canNativeShare && (
            <button onClick={nativeShare} style={{ ...btn, background: t.accent, color: '#fff', border: 'none' }}>
              Share…
            </button>
          )}
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer"
            style={{ ...btn, background: '#25D366', color: '#fff', border: 'none' }}>
            Send on WhatsApp
          </a>
          <button onClick={copy} style={{
            ...btn, background: 'transparent', color: t.text, border: '1px solid ' + t.border,
          }}>
            {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
            {copied ? 'Copied — paste it anywhere' : 'Copy the link'}
          </button>
        </div>

        <div style={{
          marginTop: 14, padding: '10px 12px', background: t.surface, border: '1px solid ' + t.border,
          borderRadius: 8, fontSize: 12, color: t.textSecondary, wordBreak: 'break-all', userSelect: 'all',
        }}>{url}</div>
      </div>
    </div>
  );
}

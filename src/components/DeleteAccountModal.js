import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Field, Input } from '../ui';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/AuthContext';

// Self-service account deletion (App Store guideline 5.1.1(v), and simply the
// right thing). Password accounts confirm with their password; Google-only
// accounts type DELETE. The server removes every row and uploaded drawing
// that belongs to the account and cancels any Stripe subscription.
export default function DeleteAccountModal({ onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  // Which confirmation applies comes from the server, not from whatever the
  // sign-in reply happened to include: a password account asked to "type
  // DELETE" would be refused by the server.
  const [hasPassword, setHasPassword] = useState(user && typeof user.hasPassword === 'boolean' ? user.hasPassword : null);
  useEffect(() => {
    let live = true;
    apiFetch('/auth/me')
      .then((me) => { if (live) setHasPassword(!!me.hasPassword); })
      .catch(() => { if (live && hasPassword === null) setHasPassword(true); });
    return () => { live = false; };
  }, []);
  const needsPassword = hasPassword !== false;
  const ready = hasPassword !== null && (needsPassword ? password.length > 0 : confirm.trim() === 'DELETE');

  const remove = async () => {
    setError('');
    try {
      await apiFetch('/auth/me', {
        method: 'DELETE',
        body: JSON.stringify(needsPassword ? { password } : { confirm: confirm.trim() }),
      });
      logout();
      navigate('/login', { replace: true });
    } catch (e) {
      setError(e.message || 'Could not delete the account');
    }
  };

  return (
    <Modal title="Delete my account" onClose={onClose} maxWidth={460}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Keep my account</Button>
        <Button variant="danger" onClick={remove} disabled={!ready} busyLabel="Deleting…">Delete permanently</Button>
      </>}>
      <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 14 }}>
        This removes your account, your projects, uploaded drawings, chat history, rates and
        memory from AI QS. Documents already sent to you by email are unaffected. Any
        subscription is cancelled. <strong style={{ color: 'var(--text-primary)' }}>This cannot be undone.</strong>
      </p>
      {needsPassword ? (
        <Field label="Confirm with your password">
          <Input type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
        </Field>
      ) : (
        <Field label='Type DELETE to confirm' hint="Your account signs in with Google, so there is no password to check.">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoCapitalize="characters" />
        </Field>
      )}
      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}

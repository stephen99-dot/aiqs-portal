import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Browser } from '@capacitor/browser';
import { apiFetch, portalOrigin } from '../utils/api';
import { isNative } from '../native/platform';
import { openExternal } from '../native/openExternal';
import { Button, Card, Banner, Badge, useToast } from '../ui';
import { MailIcon } from './Icons';

/**
 * "Send from your own email" — connect Gmail / Google Workspace or Outlook /
 * Microsoft 365 so quotes, invoices, variations and reminders go out from the
 * builder's own address (server/emailConnection.js). Without a connection the
 * shared AI QS account sends them in the builder's name, as before.
 *
 * Inside the iOS / Android app the connect buttons open the website instead:
 * Google refuses sign-in inside an app's web view, and the connect has to
 * finish in the same browser that started it.
 */

const RESULT_MESSAGES = {
  connected: (label) => ['success', label + ' connected. Your quotes now go out from your own email address.'],
  denied: (label) => ['danger', 'The ' + label + ' connection was cancelled. Nothing was changed.'],
  scope_missing: () => ['danger', 'Please tick the box that lets AI QS send email for you. Without it, emails cannot go out from your address.'],
  badstate: () => ['danger', 'That connection link expired or was opened in a different browser. Please start again from this page.'],
  failed: (label) => ['danger', 'Something went wrong connecting ' + label + '. Please try again.'],
};

const PROVIDER_ORDER = ['google', 'microsoft'];

function loadStatus() {
  return apiFetch('/email-connection/status');
}

export default function EmailSenderCard() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [st, setSt] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const native = isNative();

  const load = useCallback(() => {
    return loadStatus()
      .then((d) => { setSt(d); setLoadError(''); })
      .catch((err) => {
        // No estimator / MAX on this account: it never sends client email.
        if (err.status === 403) setHidden(true);
        else setLoadError(err.message || 'Could not check your email connection.');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Back from Google / Microsoft: /branding?email=<result>&provider=<p>
  useEffect(() => {
    const result = searchParams.get('email');
    if (!result) return;
    const label = searchParams.get('provider') === 'microsoft' ? 'Outlook' : 'Gmail';
    const make = RESULT_MESSAGES[result] || RESULT_MESSAGES.failed;
    const [tone, text] = make(label);
    setNotice({ tone, text });
    const next = new URLSearchParams(searchParams);
    next.delete('email');
    next.delete('provider');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // In the app the connect happens in the in-app browser; re-check when it closes.
  useEffect(() => {
    if (!native) return undefined;
    let handle = null;
    Browser.addListener('browserFinished', () => { load(); }).then((h) => { handle = h; }).catch(() => {});
    return () => { if (handle) handle.remove(); };
  }, [native, load]);

  async function connect(provider) {
    if (native) {
      await openExternal(portalOrigin() + '/branding');
      return;
    }
    setBusy(provider);
    try {
      const r = await apiFetch('/email-connection/connect', {
        method: 'POST',
        body: JSON.stringify({ provider, return_to: '/branding' }),
      });
      window.location.href = r.url;
    } catch (err) {
      toast.error(err.message || 'Could not start the connection.');
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy('test');
    try {
      const r = await apiFetch('/email-connection/test', { method: 'POST' });
      toast.success('Test email sent to ' + r.to + '. Check your inbox.');
    } catch (err) {
      toast.error(err.message || 'The test email could not be sent.');
    } finally {
      setBusy(null);
      load();
    }
  }

  async function disconnect() {
    const c = st && st.connection;
    if (!c) return;
    if (!window.confirm('Stop sending from ' + c.email + '? Emails will go out from AI QS with your company name instead.')) return;
    setBusy('disconnect');
    try {
      await apiFetch('/email-connection/disconnect', { method: 'POST' });
      setNotice(null);
      toast.success('Disconnected ' + c.email);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  }

  if (hidden) return null;

  const c = st && st.connection;
  const providers = (st && st.providers) || {};
  const available = PROVIDER_ORDER.filter((p) => providers[p] && providers[p].configured);
  const shared = (st && st.shared_sender) || 'AI QS';
  const broken = c && c.status !== 'active';

  let badge = null;
  if (c && !broken) badge = <Badge tone="success" size="sm">Connected</Badge>;
  else if (broken) badge = <Badge tone="danger" size="sm">Needs reconnecting</Badge>;

  const muted = { fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 };
  const body = { fontSize: '0.84rem', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.55 };

  // Reconnecting offers the same provider; a fresh connect offers every one
  // that is set up on the server.
  const connectButtons = (verb, only) => {
    const list = only ? available.filter((p) => p === only) : available;
    if (!list.length) return null;
    if (native) {
      return <Button size="sm" onClick={() => connect(null)}>{verb} on the website</Button>;
    }
    return list.map((p) => (
      <Button key={p} size="sm" onClick={() => connect(p)} disabled={!!busy} busyLabel="Opening…">
        {verb + ' ' + providers[p].label}
      </Button>
    ));
  };

  return (
    <Card>
      <Card.Header title="Sending email" extra={badge} />
      <Card.Body>
        {notice && (
          <Banner tone={notice.tone} style={{ marginBottom: 12 }}>
            <span style={{ fontSize: '0.8rem', color: notice.tone === 'success' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
              {notice.text}
            </span>
          </Banner>
        )}

        {!st && !loadError && <p style={muted}>Checking…</p>}
        {loadError && <p style={{ ...muted, color: 'var(--danger)' }}>{loadError}</p>}

        {st && c && !broken && (
          <>
            <p style={body}>
              Your quotes, invoices, variations and payment reminders go out from{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{c.email}</strong>. Clients see your
              address, replies come straight to you, and a copy of each one is in your {c.label} Sent folder.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={sendTest} disabled={!!busy && busy !== 'test'} busyLabel="Sending…">
                Send a test email
              </Button>
              <Button size="sm" variant="secondary" onClick={disconnect} disabled={!!busy}>Disconnect</Button>
            </div>
          </>
        )}

        {st && broken && (
          <>
            <Banner tone="danger" style={{ marginBottom: 12 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--danger)', lineHeight: 1.5 }}>
                {c.label} stopped accepting emails from AI QS for <strong>{c.email}</strong>
                {c.last_error ? ' (' + c.last_error.replace(/[.\s]+$/, '') + ')' : ''}. Until you reconnect, your emails go out
                from {shared} with your company name.
              </span>
            </Banner>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {connectButtons('Reconnect', c.provider)}
              <Button size="sm" variant="secondary" onClick={disconnect} disabled={!!busy}>Disconnect</Button>
            </div>
          </>
        )}

        {st && !c && (
          <>
            <p style={body}>
              Right now your emails go out from <strong style={{ color: 'var(--text-primary)' }}>{shared}</strong> with
              your company name on them{st.account_email ? <>, and replies come to {st.account_email}</> : null}.
              Connect your own email and they come from your address instead, with a copy in your Sent folder.
            </p>
            {available.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{connectButtons('Connect')}</div>
            ) : (
              <p style={muted}>Sending from your own email isn't switched on for this portal yet.</p>
            )}
          </>
        )}

        {st && (!c || broken) && available.length > 0 && (
          <p style={{ ...muted, marginTop: 10 }}>
            AI QS can only send email for you. It can't read your inbox.
            Works with Gmail, Google Workspace, Outlook.com and Microsoft 365.
            {native ? " Google doesn't allow connecting inside apps, so this opens the website." : ''}
          </p>
        )}
      </Card.Body>
    </Card>
  );
}

/**
 * One line for send dialogs: which address this email will come from, with a
 * nudge to connect when it's the shared account.
 */
export function SendingFromNote({ style }) {
  const [st, setSt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadStatus().then((d) => { if (!cancelled) setSt(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!st) return null;
  const c = st.connection;
  const line = { display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.45, ...style };
  const icon = <MailIcon size={13} color="currentColor" style={{ flexShrink: 0, marginTop: 2 }} />;

  if (c && c.status === 'active') {
    return <div style={line}>{icon}<span>Sends from <strong>{c.email}</strong></span></div>;
  }
  const shared = st.shared_sender || 'AI QS';
  if (c) {
    return (
      <div style={line}>{icon}<span>
        Your {c.label} needs reconnecting, so this sends from {shared} with your company name.{' '}
        <Link to="/branding">Reconnect</Link>
      </span></div>
    );
  }
  return (
    <div style={line}>{icon}<span>
      Sends from {shared} with your company name.{' '}
      <Link to="/branding">Send from your own email</Link>
    </span></div>
  );
}

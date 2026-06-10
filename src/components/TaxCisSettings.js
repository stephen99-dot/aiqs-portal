import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

// A4 — "Tax & CIS" + "Getting paid" settings, rendered inside the Settings
// (Branding) page for Office-in-a-Box users. Every field has one sentence of
// plain English under it. Saves on change.

const card = {
  padding: 18, borderRadius: 12,
  background: 'var(--bg-card)', border: '1px solid var(--border)',
};
const h3 = { fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' };
const lblStyle = { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 };
const hint = { fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 };
const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
};
const rowGap = { marginBottom: 16 };

export default function TaxCisSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const isOib = user?.hasEstimator || user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/finance/settings');
      setSettings(r.settings);
    } catch (e) { /* gated or locked — section simply doesn't render */ }
  }, []);
  useEffect(() => { if (isOib) load(); }, [isOib, load]);

  if (!isOib || !settings) return null;

  const save = async (patch) => {
    setError('');
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const r = await apiFetch('/finance/settings', { method: 'PUT', body: JSON.stringify(patch) });
      setSettings(r.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <h3 style={h3}>Set-up</h3>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
          The two-minute set-up walks through your name, logo, trade, tax and day rates again.
        </div>
        <a href="/office/setup" style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 44, padding: '0 18px', borderRadius: 10, textDecoration: 'none',
          background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)',
          fontSize: 13.5, fontWeight: 600,
        }}>Run the set-up again</a>
      </div>

      <div style={card}>
        <h3 style={h3}>Tax & CIS {saved && <span style={{ color: '#10B981', textTransform: 'none' }}>· saved</span>}</h3>
        {error && <div style={{ color: '#EF4444', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

        <div style={rowGap}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!settings.vat_registered} onChange={e => save({ vat_registered: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>I'm VAT registered</span>
          </label>
          <div style={hint}>If you're registered, your invoices add VAT and show your VAT number.</div>
        </div>

        {!!settings.vat_registered && (
          <div style={rowGap}>
            <label style={lblStyle}>VAT number</label>
            <input style={inputStyle} defaultValue={settings.vat_number || ''} onBlur={e => save({ vat_number: e.target.value })} placeholder="e.g. GB123456789" />
            <div style={hint}>It's on your VAT registration certificate from HMRC.</div>
          </div>
        )}

        <div style={rowGap}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!settings.cis_subcontractor} onChange={e => save({ cis_subcontractor: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>I work for other builders under CIS</span>
          </label>
          <div style={hint}>They take a deduction off your labour before paying you — your invoices can show the split.</div>
        </div>

        {!!settings.cis_subcontractor && (
          <div style={rowGap}>
            <label style={lblStyle}>Your usual deduction rate</label>
            <select style={inputStyle} value={settings.cis_default_rate || 20} onChange={e => save({ cis_default_rate: Number(e.target.value) })}>
              <option value={20}>20% — I'm verified with HMRC</option>
              <option value={30}>30% — not verified yet</option>
            </select>
            <div style={hint}>Not sure? Ask the contractor paying you, or call the CIS helpline — verified means 20%.</div>
          </div>
        )}

        <div style={rowGap}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!settings.cis_contractor} onChange={e => save({ cis_contractor: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>I pay subcontractors under CIS</span>
          </label>
          <div style={hint}>You take the deduction off their labour and pay it to HMRC each month.</div>
        </div>

        <div style={{ marginBottom: 0 }}>
          <label style={lblStyle}>Your accountant's email</label>
          <input style={inputStyle} defaultValue={settings.accountant_email || ''} onBlur={e => save({ accountant_email: e.target.value })} placeholder="e.g. sam@yourbooks.co.uk" />
          <div style={hint}>So "Send to your accountant" on the Invoices page works in one tap.</div>
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>Card payments</h3>
        <div style={rowGap}>
          <label style={lblStyle}>Who pays the card fee when a client pays online?</label>
          <select style={inputStyle} value={settings.card_fee_mode || 'absorb'} onChange={e => save({ card_fee_mode: e.target.value })}>
            <option value="absorb">I'll cover it — the client pays the invoice amount exactly</option>
            <option value="add">Add it to the payment — the client covers the card fee</option>
          </select>
          <div style={hint}>
            Card payments cost about {Number(settings.card_fee_pct || 1.5)}% + £{Number(settings.card_fee_fixed || 0.2).toFixed(2)} per payment.
          </div>
        </div>
      </div>
    </div>
  );
}

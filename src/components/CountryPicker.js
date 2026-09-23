import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Modal, Button, Field, Select, Input } from '../ui';

// Which country a builder works in drives their currency, VAT, the rate
// library their jobs are priced from and what the AI assumes (see
// server/lib/countries.js). Three pieces live here:
//   CountryFields       — the picker itself (country, region, "other" name)
//   CountryPromptModal  — asked once of anyone whose country isn't set yet
//   CountrySettingsModal— change it later, or redo onboarding

let _cache = null;
export function useCountries() {
  const [countries, setCountries] = useState(_cache || []);
  useEffect(() => {
    if (_cache) return;
    apiFetch('/countries').then(r => { _cache = r.countries || []; setCountries(_cache); }).catch(() => {});
  }, []);
  return countries;
}

export function CountryFields({ value, onChange, compact = false }) {
  const countries = useCountries();
  const selected = countries.find(c => c.code === value.country);
  const regions = (selected && selected.regions) || [];
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div style={{ display: 'grid', gap: compact ? 10 : 14 }}>
      <Field label="Country you work in">
        <Select value={value.country || ''} onChange={e => set({ country: e.target.value, region: '', countryName: '' })} required>
          <option value="">Choose your country…</option>
          {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </Select>
      </Field>
      {regions.length > 0 && (
        <Field label="Region / province" hint="Sets the regional price factor. A job's own address still wins.">
          <Select value={value.region || ''} onChange={e => set({ region: e.target.value })}>
            <option value="">Choose your main region…</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
      )}
      {value.country === 'OTHER' && (
        <Field label="Which country?" hint="We don't hold a local rates library for your country yet — prices will be UK benchmarks in £ until we do, and we'll flag that on every figure.">
          <Input value={value.countryName || ''} onChange={e => set({ countryName: e.target.value })} placeholder="e.g. Kenya" />
        </Field>
      )}
      {selected && selected.code !== 'OTHER' && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted, #64748B)', lineHeight: 1.5 }}>
          Quotes and BOQs will be priced in <strong>{selected.currency} ({selected.symbol})</strong> with VAT at <strong>{selected.vatRate}%</strong>
          {selected.code === 'ZA' ? ', using the AI QS South Africa rates library.' : '.'}
        </div>
      )}
    </div>
  );
}

function valid(v) {
  if (!v.country) return false;
  if (v.country === 'OTHER' && !String(v.countryName || '').trim()) return false;
  return true;
}

async function saveCountry(v, setUser) {
  const res = await apiFetch('/auth/me/country', { method: 'PUT', body: JSON.stringify(v) });
  setUser(u => ({ ...u, ...res }));
  return res;
}

// Shown over the portal until the user has told us their country. Existing
// accounts from before countries existed see it once on their next visit.
export function CountryPromptModal() {
  const { setUser } = useAuth();
  const [v, setV] = useState({ country: '', region: '', countryName: '' });
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try { await saveCountry(v, setUser); } catch (e) { setError(e.message || 'Could not save'); }
  };
  return (
    <Modal title="Which country are you in?" maxWidth={480}
      footer={<Button onClick={save} disabled={!valid(v)} busyLabel="Saving…">Continue</Button>}>
      <p style={{ marginTop: 0, fontSize: 14, lineHeight: 1.55 }}>
        We now price for builders worldwide. Tell us where you work and we'll set your currency, VAT, rates and building regulations to match.
      </p>
      <CountryFields value={v} onChange={setV} />
      {error && <div style={{ color: '#EF4444', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}

// Change country later, or start onboarding again (e.g. a client who
// onboarded while their account was still UK-adapted).
export function CountrySettingsModal({ onClose }) {
  const { user, setUser } = useAuth();
  const [v, setV] = useState({ country: user?.country || '', region: user?.region || '', countryName: user?.country && user.country === 'OTHER' ? user.countryName : '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const save = async () => {
    setError(''); setDone('');
    try {
      const res = await saveCountry(v, setUser);
      setDone('Saved — new quotes will be priced in ' + res.currency + '.');
    } catch (e) { setError(e.message || 'Could not save'); }
  };

  const redoOnboarding = async () => {
    if (!window.confirm('Start onboarding again?\n\nYour previous onboarding answers, and any saved rates in a different currency from your account, will be set aside so you can enter them again.')) return;
    setError('');
    try {
      if (valid(v) && (v.country !== user?.country || (v.region || '') !== (user?.region || ''))) await saveCountry(v, setUser);
      await apiFetch('/onboarding/reset', { method: 'POST' });
      window.location.assign('/onboarding');
    } catch (e) { setError(e.message || 'Could not reset onboarding'); }
  };

  return (
    <Modal title="Country & onboarding" onClose={onClose} maxWidth={500}
      footer={<>
        <Button variant="secondary" onClick={redoOnboarding} busyLabel="Resetting…">Redo onboarding</Button>
        <Button onClick={save} disabled={!valid(v)} busyLabel="Saving…">Save</Button>
      </>}>
      <CountryFields value={v} onChange={setV} />
      <p style={{ fontSize: 12.5, color: 'var(--text-muted, #64748B)', lineHeight: 1.5, marginBottom: 0 }}>
        Documents you've already produced keep the currency they were priced in.
      </p>
      {done && <div style={{ color: '#10B981', fontSize: 13, marginTop: 10 }}>{done}</div>}
      {error && <div style={{ color: '#EF4444', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}

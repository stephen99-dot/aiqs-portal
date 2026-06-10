import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import { CheckCircleIcon } from '../components/Icons';

// B2 — first-run set-up. Five screens, one question per screen, big inputs.
// Skippable at every step; re-runnable from Settings. Everything it collects
// feeds something real: branding -> every PDF, VAT/CIS -> invoices, day
// rates -> quote drafting, colour -> every client-facing page.

const TRADES = [
  'General builder', 'Extensions & renovations', 'Electrician',
  'Plumber / heating', 'Carpenter / joiner', 'Roofer',
  'Plasterer', 'Landscaper', 'Other',
];

// Sensible UK day-rate starting points — every figure editable on screen 4.
const DEFAULT_DAY_RATES = {
  'Labourer': 160,
  'General builder': 280,
  'Bricklayer': 300,
  'Carpenter / joiner': 280,
  'Electrician': 360,
  'Plumber / heating': 340,
  'Plasterer': 280,
  'Roofer': 300,
};

const COLOURS = [
  { hex: '#1B2A4A', name: 'Navy' },
  { hex: '#111827', name: 'Black' },
  { hex: '#14532D', name: 'Racing green' },
  { hex: '#7F1D1D', name: 'Brick red' },
  { hex: '#1E40AF', name: 'Royal blue' },
  { hex: '#C2410C', name: 'Burnt orange' },
];

export default function SetupWizardPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();

  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [logoUploaded, setLogoUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [trade, setTrade] = useState('');
  const [vatRegistered, setVatRegistered] = useState(false);
  const [vatNumber, setVatNumber] = useState('');
  const [cisSub, setCisSub] = useState(false);
  const [cisRate, setCisRate] = useState(20);
  const [dayRates, setDayRates] = useState({ ...DEFAULT_DAY_RATES });
  const [colour, setColour] = useState('#1B2A4A');

  // Pre-fill from whatever exists already (re-runs keep their answers).
  useEffect(() => {
    (async () => {
      try {
        const b = await apiFetch('/branding');
        if (b.branding?.company_name) setCompanyName(b.branding.company_name);
        if (b.branding?.primary_colour) setColour(b.branding.primary_colour);
        if (b.branding?.logo_filename) setLogoUploaded(true);
      } catch (e) {}
      try {
        const s = await apiFetch('/finance/settings');
        const st = s.settings || {};
        if (st.trade_type) setTrade(st.trade_type);
        setVatRegistered(!!st.vat_registered);
        if (st.vat_number) setVatNumber(st.vat_number);
        setCisSub(!!st.cis_subcontractor);
        if (st.cis_default_rate) setCisRate(st.cis_default_rate);
        if (st.day_rates) {
          try { setDayRates({ ...DEFAULT_DAY_RATES, ...JSON.parse(st.day_rates) }); } catch (e) {}
        }
      } catch (e) {}
    })();
  }, []);

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file, file.name);
      const resp = await fetch('/api/branding/logo', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken() },
        body: fd,
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Upload failed');
      setLogoUploaded(true);
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  };

  const finish = async (skipped) => {
    setSaving(true); setError('');
    try {
      if (!skipped) {
        await apiFetch('/branding', { method: 'PATCH', body: JSON.stringify({
          company_name: companyName || undefined,
          primary_colour: colour,
        }) });
        await apiFetch('/finance/settings', { method: 'PUT', body: JSON.stringify({
          trade_type: trade || null,
          vat_registered: vatRegistered,
          vat_number: vatNumber || null,
          cis_subcontractor: cisSub,
          cis_default_rate: cisRate,
          day_rates: dayRates,
          setup_completed: true,
        }) });
        setStep(5); // the "you're set up" screen
      } else {
        await apiFetch('/finance/settings', { method: 'PUT', body: JSON.stringify({ setup_completed: true }) });
        nav('/office');
      }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const input = {
    width: '100%', boxSizing: 'border-box', minHeight: 52, padding: '14px 16px',
    background: t.bg, border: '1px solid ' + t.border, color: t.text,
    borderRadius: 12, fontSize: 17, outline: 'none',
  };
  const bigBtn = (primary) => ({
    width: '100%', minHeight: 54, borderRadius: 12, cursor: 'pointer',
    background: primary ? t.accent : 'transparent',
    color: primary ? '#fff' : t.textSecondary,
    border: primary ? 'none' : '1px solid ' + t.border,
    fontSize: 16, fontWeight: 700,
  });
  const chipBtn = (active) => ({
    minHeight: 52, padding: '0 16px', borderRadius: 12, cursor: 'pointer',
    background: active ? t.accent : t.card,
    color: active ? '#fff' : t.text,
    border: '1px solid ' + (active ? t.accent : t.border),
    fontSize: 15, fontWeight: 600, textAlign: 'left',
  });

  const steps = [
    // 0 — name + logo
    {
      title: "What's the business called?",
      sub: 'It goes on every quote and invoice you send.',
      body: (
        <>
          <input style={input} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Smith & Sons Builders" autoFocus />
          <label style={{ ...bigBtn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 12, color: logoUploaded ? t.success : t.textSecondary }}>
            {uploading ? 'Uploading…' : logoUploaded ? '✓ Logo added — tap to change it' : 'Add your logo (optional)'}
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files && e.target.files[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
          </label>
        </>
      ),
    },
    // 1 — trade
    {
      title: 'What kind of work do you do?',
      sub: 'Helps the quoting tool talk your language.',
      body: (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {TRADES.map(tr => (
            <button key={tr} onClick={() => setTrade(tr)} style={chipBtn(trade === tr)}>{tr}</button>
          ))}
        </div>
      ),
    },
    // 2 — VAT / CIS
    {
      title: 'Two quick tax questions',
      sub: 'So your invoices come out right first time.',
      body: (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: t.card, border: '1px solid ' + t.border, borderRadius: 12, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={vatRegistered} onChange={e => setVatRegistered(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>I'm VAT registered</span>
          </label>
          {vatRegistered && (
            <input style={{ ...input, marginBottom: 10 }} value={vatNumber} onChange={e => setVatNumber(e.target.value)} placeholder="VAT number — e.g. GB123456789" />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: t.card, border: '1px solid ' + t.border, borderRadius: 12, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={cisSub} onChange={e => setCisSub(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>I work for other builders under CIS</span>
          </label>
          {cisSub && (
            <select style={input} value={cisRate} onChange={e => setCisRate(Number(e.target.value))}>
              <option value={20}>They take 20% off my labour — I'm verified</option>
              <option value={30}>They take 30% — not verified yet</option>
            </select>
          )}
        </>
      ),
    },
    // 3 — day rates
    {
      title: 'What are the day rates round your way?',
      sub: "We've started you off with typical figures — change any that look wrong. They feed your quotes.",
      body: (
        <div>
          {Object.entries(dayRates).map(([name, rate]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{name}</div>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: t.textMuted }}>£</span>
                <input type="number" step="5" value={rate}
                  onChange={e => setDayRates({ ...dayRates, [name]: e.target.value })}
                  style={{ ...input, width: 120, paddingLeft: 26, minHeight: 48, fontSize: 16 }} />
              </div>
            </div>
          ))}
        </div>
      ),
    },
    // 4 — colour
    {
      title: 'Pick your colour',
      sub: 'It tops every quote, invoice and letter you send.',
      body: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {COLOURS.map(c => (
              <button key={c.hex} onClick={() => setColour(c.hex)} style={{
                minHeight: 72, borderRadius: 12, cursor: 'pointer',
                background: c.hex, color: '#fff', fontWeight: 700, fontSize: 13,
                border: colour === c.hex ? '3px solid ' + t.accent : '3px solid transparent',
              }}>{colour === c.hex ? '✓ ' : ''}{c.name}</button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, color: t.textSecondary, fontSize: 14 }}>
            Or pick your own:
            <input type="color" value={colour} onChange={e => setColour(e.target.value)} style={{ width: 52, height: 44, border: 'none', background: 'transparent', cursor: 'pointer' }} />
          </label>
        </>
      ),
    },
  ];

  // Done screen
  if (step === 5) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, color: t.text }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ color: t.success, marginBottom: 12 }}><CheckCircleIcon size={52} /></div>
          <h1 style={{ fontSize: 24, margin: '0 0 10px' }}>You're set up</h1>
          <p style={{ color: t.textSecondary, fontSize: 16, lineHeight: 1.5, marginBottom: 24 }}>
            Every quote and invoice now carries your name{logoUploaded ? ', your logo' : ''} and your colour.
            You can change any of it in Settings.
          </p>
          <button onClick={() => nav('/office')} style={bigBtn(true)}>Take me to Today</button>
        </div>
      </div>
    );
  }

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div style={{ padding: '24px 16px 40px', color: t.text, maxWidth: 520, margin: '0 auto', minHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 28 }}>
        {steps.map((_, i) => (
          <div key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 999, background: i <= step ? t.accent : t.border, transition: 'all 0.2s' }} />
        ))}
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px' }}>{current.title}</h1>
      <p style={{ color: t.textSecondary, fontSize: 14.5, margin: '0 0 20px' }}>{current.sub}</p>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 14 }}>{error}</div>}

      <div style={{ flex: 1 }}>{current.body}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 28 }}>
        <button onClick={() => last ? finish(false) : setStep(step + 1)} disabled={saving} style={{ ...bigBtn(true), opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : last ? 'Finish set-up' : 'Next'}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} style={{ background: 'none', border: 'none', color: t.textSecondary, fontSize: 14, cursor: 'pointer', minHeight: 44 }}>← Back</button>
          ) : <span />}
          <button onClick={() => finish(true)} disabled={saving} style={{ background: 'none', border: 'none', color: t.textMuted, fontSize: 14, cursor: 'pointer', minHeight: 44 }}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

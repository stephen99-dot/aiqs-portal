import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

// Three short steps, plain language, one theme per screen:
//   1. Who you are (role, company, region, project types)
//   2. Day rates per trade — prefilled UK figures, all editable. These land in
//      the rate library so every BOQ prices labour from them.
//   3. Optional pricing defaults (contingency, OH&P, exclusions)
// Answers become high-confidence user_memories; trade rates go to
// client_rate_library via the same POST. The old 12-field form with the
// "Advanced (for QS firms)" accordion lives on only in the AI Memory page,
// where every one of these is still editable afterwards.

const PROJECT_TYPE_OPTIONS = [
  'Residential extensions',
  'Loft conversions',
  'Whole-house refurbishment',
  'Commercial fit-out',
  'Industrial',
  'Civil / infrastructure',
  'Heritage / listed',
  'Insurance reinstatement',
  'New build',
];

// Typical UK figures, every one editable on screen. Keep in step with
// DEFAULT_TRADE_DAY_RATES in server/tradeRates.js.
const DEFAULT_TRADE_DAY_RATES = {
  'Labourer': 160,
  'General builder': 280,
  'Bricklayer': 300,
  'Carpenter / joiner': 280,
  'Electrician': 360,
  'Plumber / heating': 340,
  'Plasterer': 280,
  'Roofer': 300,
};

// Defined OUTSIDE the component so React doesn't treat it as a new component type
// on every render — that was causing the input to lose focus after every keystroke.
function Field({ label, desc, children, colors }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 4 }}>{label}</div>
      {desc && <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>{desc}</div>}
      {children}
    </div>
  );
}

export default function OnboardingPage() {
  const { t } = useTheme();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(0);

  const [answers, setAnswers] = useState({
    role: '',
    company_name: '',
    project_types: [],
    regions: '',
    contingency_pct: '',
    ohp_pct: '',
    standard_exclusions: '',
  });

  // Trade day rates as an editable list: rename, change, remove, add your own.
  const [tradeRates, setTradeRates] = useState(
    Object.entries(DEFAULT_TRADE_DAY_RATES).map(([name, rate], i) => ({ id: i, name, rate }))
  );
  const [nextRowId, setNextRowId] = useState(Object.keys(DEFAULT_TRADE_DAY_RATES).length);
  // Whether the user actually edited the rates (vs accepting the defaults) —
  // the server uses this to decide if the "client added their rates" admin
  // alert is worth sending.
  const [ratesTouched, setRatesTouched] = useState(false);

  useEffect(() => {
    apiFetch('/onboarding')
      .then(d => { setStatus(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleMulti = (key, val) => {
    setAnswers(a => {
      const cur = a[key] || [];
      return { ...a, [key]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
    });
  };
  const setSingle = (key, val) => setAnswers(a => ({ ...a, [key]: val }));

  const setRate = (id, patch) => {
    setRatesTouched(true);
    setTradeRates(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRate = (id) => {
    setRatesTouched(true);
    setTradeRates(rows => rows.filter(r => r.id !== id));
  };
  const addRate = () => {
    setRatesTouched(true);
    setTradeRates(rows => [...rows, { id: nextRowId, name: '', rate: '' }]);
    setNextRowId(n => n + 1);
  };

  async function save() {
    setSaving(true);
    try {
      const trade_rates = {};
      for (const r of tradeRates) {
        const name = String(r.name || '').trim();
        const rate = parseFloat(r.rate);
        if (name && rate > 0) trade_rates[name] = rate;
      }
      await apiFetch('/onboarding', {
        method: 'POST',
        body: JSON.stringify({ answers, trade_rates, trade_rates_touched: ratesTouched }),
      });
      navigate('/ai-memory');
    } catch (e) {
      alert(e.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    if (!window.confirm('Skip for now? You can always complete this later from the AI Memory page.')) return;
    setSaving(true);
    try {
      await apiFetch('/onboarding', { method: 'POST', body: JSON.stringify({ skipped: true }) });
      navigate('/dashboard');
    } catch (e) {
      alert(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  // Palette derived from theme tokens so onboarding matches the chosen theme.
  const c = {
    page: t.bg, card: t.card, border: t.border,
    text: t.text, textMuted: t.textSecondary, accent: t.accent,
    accentBg: t.surfaceHover, accentBorder: t.accent,
    input: t.inputBg, inputBorder: t.border, pill: t.surfaceHover,
    pillActive: t.surfaceHover,
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    background: c.input, border: `1px solid ${c.inputBorder}`,
    color: c.text, fontSize: 14, outline: 'none', fontFamily: 'inherit',
  };

  const textInput = (key, placeholder) => (
    <input
      type="text"
      value={answers[key] || ''}
      placeholder={placeholder}
      onChange={e => setSingle(key, e.target.value)}
      style={inputStyle}
    />
  );

  const numberInput = (key, placeholder) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="number" inputMode="decimal"
        min="0" max="100" step="0.5"
        value={answers[key] || ''}
        placeholder={placeholder}
        onChange={e => setSingle(key, e.target.value)}
        style={{ ...inputStyle, width: 140 }}
      />
      <span style={{ fontSize: 13, color: c.textMuted }}>%</span>
    </div>
  );

  const pillSelect = (key, options, multi = false) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const active = multi
          ? (answers[key] || []).includes(opt)
          : answers[key] === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => multi ? toggleMulti(key, opt) : setSingle(key, answers[key] === opt ? '' : opt)}
            style={{
              padding: '8px 14px', borderRadius: 999,
              background: active ? c.pillActive : c.pill,
              border: `1px solid ${active ? c.accentBorder : c.inputBorder}`,
              color: active ? c.accent : c.text,
              fontSize: 13, fontWeight: active ? 600 : 500,
              cursor: 'pointer', transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: c.textMuted }}>Loading...</div>;

  const steps = [
    {
      title: 'A bit about you',
      sub: 'So the AI talks your language from day one.',
      body: (
        <>
          <Field colors={c} label="Your role" desc="Are you solo, a firm, or in-house?">
            {pillSelect('role', ['Solo QS', 'QS Firm', 'In-house / client-side', 'Contractor', 'Developer'])}
          </Field>
          <Field colors={c} label="Company name (optional)">
            {textInput('company_name', 'e.g. Smith & Co Quantity Surveyors')}
          </Field>
          <Field colors={c} label="Where do you mostly work?" desc="A county, city, or region — rates vary by area.">
            {textInput('regions', 'e.g. London, South East, Home Counties')}
          </Field>
          <Field colors={c} label="Project types you typically work on" desc="Select all that apply.">
            {pillSelect('project_types', PROJECT_TYPE_OPTIONS, true)}
          </Field>
        </>
      ),
    },
    {
      title: 'Day rates, trade by trade',
      sub: "Different trades charge different rates. We've started you off with typical UK figures — change any that look wrong, remove trades you don't use, add your own. Every estimate prices labour from these.",
      body: (
        <>
          {tradeRates.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={r.name}
                placeholder="Trade — e.g. Tiler"
                onChange={e => setRate(r.id, { name: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              />
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: c.textMuted, fontSize: 13 }}>£</span>
                <input
                  type="number" inputMode="decimal" min="0" step="5"
                  value={r.rate}
                  placeholder="0"
                  onChange={e => setRate(r.id, { rate: e.target.value })}
                  style={{ ...inputStyle, width: 110, paddingLeft: 24 }}
                />
              </div>
              <span style={{ fontSize: 12, color: c.textMuted, width: 34 }}>/day</span>
              <button
                type="button"
                onClick={() => removeRate(r.id)}
                aria-label={`Remove ${r.name || 'trade'}`}
                title="Remove this trade"
                style={{
                  background: 'none', border: `1px solid ${c.border}`, borderRadius: 8,
                  color: c.textMuted, cursor: 'pointer', width: 32, height: 32,
                  fontSize: 15, lineHeight: 1, fontFamily: 'inherit',
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRate}
            style={{
              marginTop: 4, padding: '8px 14px', borderRadius: 8,
              background: 'none', border: `1px dashed ${c.accentBorder}`,
              color: c.accent, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            + Add another trade
          </button>
          <div style={{ fontSize: 12, color: c.textMuted, marginTop: 12 }}>
            These are saved to My Rates, where you can fine-tune them (or import a full rate spreadsheet) any time.
          </div>
        </>
      ),
    },
    {
      title: 'Pricing defaults',
      sub: 'All optional. Rates are already all-in competitive prices, like a real builder\'s quote — leave these at 0 unless you add your own buffer or margin on top.',
      body: (
        <>
          <Field colors={c} label="Default contingency %" desc="Optional buffer shown on top of every BOQ.">
            {numberInput('contingency_pct', '0')}
          </Field>
          <Field colors={c} label="Default markup / overhead %" desc="Optional OH&P (overheads & profit) line shown on top of every BOQ.">
            {numberInput('ohp_pct', '0')}
          </Field>
          <Field colors={c} label="Standard exclusions" desc="Things you always leave out of estimates (VAT, planning fees, surveys, etc).">
            <textarea
              value={answers.standard_exclusions || ''}
              onChange={e => setSingle('standard_exclusions', e.target.value)}
              placeholder="e.g. VAT, planning fees, building control, CDM, asbestos survey"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          <div style={{ fontSize: 12, color: c.textMuted }}>
            Method of measurement, spec level and other preferences can be added later from the AI Memory page.
          </div>
        </>
      ),
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div style={{ padding: '24px 32px 60px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Onboarding · step {step + 1} of {steps.length}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>
          {current.title}
        </h1>
        <p style={{ fontSize: 13.5, color: c.textMuted, marginTop: 6, lineHeight: 1.55 }}>
          {current.sub}
        </p>
        {status && status.completed_at && step === 0 && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: c.accentBg, border: `1px solid ${c.accentBorder}`,
            fontSize: 12.5, color: c.accent,
          }}>
            You've completed this before. Updating answers will refresh the AI's memory.
          </div>
        )}
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {steps.map((_, i) => (
          <div key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 999, background: i <= step ? c.accent : c.border, transition: 'all 0.2s' }} />
        ))}
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 24 }}>
        {current.body}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 20, alignItems: 'center' }}>
        <button
          onClick={skip}
          disabled={saving}
          style={{
            padding: '10px 18px', borderRadius: 8,
            background: 'transparent', border: 'none',
            color: c.textMuted, fontSize: 13, fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}
        >
          Skip for now
        </button>
        <div style={{ flex: 1 }} />
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={saving}
            style={{
              padding: '10px 18px', borderRadius: 8,
              background: 'transparent', border: `1px solid ${c.border}`,
              color: c.textMuted, fontSize: 13.5, fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        )}
        <button
          onClick={() => last ? save() : setStep(s => s + 1)}
          disabled={saving}
          style={{
            padding: '10px 22px', borderRadius: 8,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            border: 'none', color: '#0A0F1C',
            fontSize: 13.5, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1, fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving...' : last ? 'Save & finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}

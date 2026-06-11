import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

// 7 core questions + advanced accordion. Each answer becomes a high-confidence
// user_memory and is injected into the system prompt on every future chat.
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

const MOM_OPTIONS = ['NRM1', 'NRM2', 'SMM7', 'POMI', 'CESMM', 'Other / flexible'];
const SPEC_OPTIONS = ['Budget', 'Mid-range', 'Premium', 'Mixed — varies per project'];
const RATE_SOURCE_OPTIONS = ['My own rate library', "SPON's", 'BCIS', 'Client-supplied rates', 'Subcontractor quotes'];
const SIZE_OPTIONS = ['< £50k', '£50k – £250k', '£250k – £1m', '£1m – £5m', '£5m+'];

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState(null);

  const [answers, setAnswers] = useState({
    role: '',
    company_name: '',
    project_types: [],
    regions: '',
    method_of_measurement: '',
    contingency_pct: '',
    ohp_pct: '',
    standard_exclusions: '',
    // advanced
    spec_level: '',
    rate_sources: [],
    team: '',
    typical_project_size: '',
  });

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

  async function save() {
    setSaving(true);
    try {
      await apiFetch('/onboarding', {
        method: 'POST',
        body: JSON.stringify({ answers }),
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

  const textInput = (key, placeholder) => (
    <input
      type="text"
      value={answers[key] || ''}
      placeholder={placeholder}
      onChange={e => setSingle(key, e.target.value)}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 8,
        background: c.input, border: `1px solid ${c.inputBorder}`,
        color: c.text, fontSize: 14, outline: 'none', fontFamily: 'inherit',
      }}
    />
  );

  const numberInput = (key, placeholder) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="number"
        min="0" max="100" step="0.5"
        value={answers[key] || ''}
        placeholder={placeholder}
        onChange={e => setSingle(key, e.target.value)}
        style={{
          width: 140, padding: '10px 12px', borderRadius: 8,
          background: c.input, border: `1px solid ${c.inputBorder}`,
          color: c.text, fontSize: 14, outline: 'none', fontFamily: 'inherit',
        }}
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

  return (
    <div style={{ padding: '24px 32px 60px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Onboarding · 2 min
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>
          Teach the AI how you work
        </h1>
        <p style={{ fontSize: 13.5, color: c.textMuted, marginTop: 6, lineHeight: 1.55 }}>
          Answer a few fundamentals and the AI QS will apply them to every project — your contingency, your standard exclusions, your typical project types. You can edit or delete any of these later from the AI Memory page.
        </p>
        {status && status.completed_at && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: c.accentBg, border: `1px solid ${c.accentBorder}`,
            fontSize: 12.5, color: c.accent,
          }}>
            You've completed this before. Updating answers will refresh the AI's memory.
          </div>
        )}
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: '24px 24px 8px' }}>

        <Field colors={c} label="1. Your role" desc="Are you solo, a firm, or in-house?">
          {pillSelect('role', ['Solo QS', 'QS Firm', 'In-house / client-side', 'Contractor', 'Developer'])}
        </Field>

        <Field colors={c} label="2. Company name (optional)">
          {textInput('company_name', 'e.g. Smith & Co Quantity Surveyors')}
        </Field>

        <Field colors={c} label="3. Project types you typically work on" desc="Select all that apply.">
          {pillSelect('project_types', PROJECT_TYPE_OPTIONS, true)}
        </Field>

        <Field colors={c} label="4. Primary region(s)" desc="Where do you mostly operate? A county, city, or region.">
          {textInput('regions', 'e.g. London, South East, Home Counties')}
        </Field>

        <Field colors={c} label="5. Default contingency %" desc="Optional buffer shown on top of every BOQ. Leave blank for 0 — rates are already all-in competitive prices, like a real builder's quote. You can change this any time from the AI Memory page.">
          {numberInput('contingency_pct', '0')}
        </Field>

        <Field colors={c} label="6. Default markup / overhead %" desc="Optional margin line (OH&P — overheads & profit) shown on top of every BOQ. Leave blank for 0 — the builder's overhead and profit is already inside each rate.">
          {numberInput('ohp_pct', '0')}
        </Field>

        <Field colors={c} label="7. Standard exclusions" desc="Things you always leave out of estimates (VAT, planning fees, surveys, etc).">
          <textarea
            value={answers.standard_exclusions || ''}
            onChange={e => setSingle('standard_exclusions', e.target.value)}
            placeholder="e.g. VAT, planning fees, building control, CDM, asbestos survey"
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: c.input, border: `1px solid ${c.inputBorder}`,
              color: c.text, fontSize: 14, outline: 'none', resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </Field>

        {/* Advanced */}
        <div style={{ borderTop: `1px solid ${c.border}`, margin: '8px -24px 0', padding: '16px 24px 0' }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: c.textMuted, fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
            Advanced (for QS firms)
          </button>

          {showAdvanced && (
            <div style={{ paddingTop: 12 }}>
              <Field colors={c} label="Method of measurement" desc="RICS standard you follow. Leave blank if you don't follow a formal standard.">
                {pillSelect('method_of_measurement', MOM_OPTIONS)}
              </Field>

              <Field colors={c} label="Preferred spec level">
                {pillSelect('spec_level', SPEC_OPTIONS)}
              </Field>

              <Field colors={c} label="Rate sources" desc="Where do your rates come from? Select all that apply.">
                {pillSelect('rate_sources', RATE_SOURCE_OPTIONS, true)}
              </Field>

              <Field colors={c} label="Team / day-rate setup (optional)" desc="Short description — used for prelims and labour sanity-checks.">
                {textInput('team', 'e.g. 4 QS + 1 admin, site visits at £120/day')}
              </Field>

              <Field colors={c} label="Typical project size">
                {pillSelect('typical_project_size', SIZE_OPTIONS)}
              </Field>
            </div>
          )}
        </div>

      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
        <button
          onClick={skip}
          disabled={saving}
          style={{
            padding: '10px 18px', borderRadius: 8,
            background: 'transparent', border: `1px solid ${c.border}`,
            color: c.textMuted, fontSize: 13.5, fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}
        >
          Skip for now
        </button>
        <button
          onClick={save}
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
          {saving ? 'Saving...' : 'Save & continue'}
        </button>
      </div>
    </div>
  );
}

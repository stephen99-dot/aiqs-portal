import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

// Shown when the user attaches files to a new (unsaved) chat.
// Collects scope + floor area + project type + location so the BOQ output
// is grounded in user-confirmed answers rather than inferred from drawings alone.
// The user can skip; if skipped we just don't show it again for this set of files.

const PROJECT_TYPE_OPTIONS = [
  'Single-storey extension',
  'Two-storey extension',
  'Loft conversion',
  'Whole-house refurbishment',
  'Kitchen / bathroom refurb',
  'Insurance reinstatement',
  'Heritage / listed refurb',
  'New build',
  'Commercial fit-out',
  'Other',
];

const SPEC_OPTIONS = ['Budget', 'Mid-range', 'Premium'];

export default function ProjectIntakeModal({ open, fileNames = [], onSubmit, onSkip, onClose }) {
  const { t } = useTheme();
  const [data, setData] = useState({
    scope: '',
    floor_area_m2: '',
    project_type: '',
    location: '',
    spec_level: '',
    budget_range: '',
    timeline: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const c = {
    overlay: 'rgba(0,0,0,0.55)',
    card: t.card, border: t.border,
    text: t.text, textMuted: t.textSecondary, accent: t.accent,
    accentBg: t.surfaceHover, accentBorder: t.accent,
    input: t.inputBg, inputBorder: t.border,
    pill: t.surfaceHover, pillActive: t.surfaceHover,
  };

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const pill = (key, options) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => {
        const active = data[key] === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => set(key, active ? '' : opt)}
            style={{
              padding: '6px 12px', borderRadius: 999,
              background: active ? c.pillActive : c.pill,
              border: `1px solid ${active ? c.accentBorder : c.inputBorder}`,
              color: active ? c.accent : c.text,
              fontSize: 12.5, fontWeight: active ? 600 : 500,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );

  async function handleSubmit() {
    // Minimum: at least scope OR floor area OR project type
    const hasAny = (data.scope && data.scope.trim()) || data.floor_area_m2 || data.project_type;
    if (!hasAny) {
      alert('Please fill in at least the scope, floor area, or project type so the BOQ is accurate.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: c.overlay, backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
          background: c.card, border: `1px solid ${c.border}`, borderRadius: 14,
          padding: '22px 24px',
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
            Quick questions · 30 sec
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.01em' }}>
            Tell us about this project
          </h3>
          <p style={{ fontSize: 12.5, color: c.textMuted, marginTop: 5, lineHeight: 1.55 }}>
            Confirming these upfront makes the BOQ much more accurate. You can skip any field — the AI will estimate from the drawings if you do.
          </p>
          {fileNames.length > 0 && (
            <div style={{
              marginTop: 10, padding: '6px 10px', borderRadius: 6,
              background: c.accentBg, border: `1px solid ${c.accentBorder}`,
              fontSize: 11.5, color: c.accent,
            }}>
              {fileNames.length} file{fileNames.length !== 1 ? 's' : ''} attached: {fileNames.slice(0, 3).join(', ')}{fileNames.length > 3 ? `, +${fileNames.length - 3} more` : ''}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 4 }}>
              Scope of works
            </label>
            <textarea
              value={data.scope}
              onChange={e => set('scope', e.target.value)}
              placeholder="e.g. Rear single-storey extension, new kitchen, utility room, bi-fold doors. Strip out existing conservatory."
              rows={3}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: 7,
                background: c.input, border: `1px solid ${c.inputBorder}`,
                color: c.text, fontSize: 13, outline: 'none', resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 4 }}>
                Floor area (m²)
              </label>
              <input
                type="number" min="0" step="0.1"
                value={data.floor_area_m2}
                onChange={e => set('floor_area_m2', e.target.value)}
                placeholder="e.g. 32"
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 7,
                  background: c.input, border: `1px solid ${c.inputBorder}`,
                  color: c.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 4 }}>
                Location
              </label>
              <input
                type="text"
                value={data.location}
                onChange={e => set('location', e.target.value)}
                placeholder="e.g. Richmond, SW London"
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 7,
                  background: c.input, border: `1px solid ${c.inputBorder}`,
                  color: c.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 6 }}>
              Project type
            </label>
            {pill('project_type', PROJECT_TYPE_OPTIONS)}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 6 }}>
              Spec level
            </label>
            {pill('spec_level', SPEC_OPTIONS)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 4 }}>
                Budget range (optional)
              </label>
              <input
                type="text"
                value={data.budget_range}
                onChange={e => set('budget_range', e.target.value)}
                placeholder="e.g. £80k – £120k"
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 7,
                  background: c.input, border: `1px solid ${c.inputBorder}`,
                  color: c.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 4 }}>
                Timeline (optional)
              </label>
              <input
                type="text"
                value={data.timeline}
                onChange={e => set('timeline', e.target.value)}
                placeholder="e.g. Start Q2 2026"
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 7,
                  background: c.input, border: `1px solid ${c.inputBorder}`,
                  color: c.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: c.text, display: 'block', marginBottom: 4 }}>
              Anything else we should know?
            </label>
            <textarea
              value={data.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="e.g. Client wants exclusions, existing drawings aren't to scale, planning conditions..."
              rows={2}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: 7,
                background: c.input, border: `1px solid ${c.inputBorder}`,
                color: c.text, fontSize: 13, outline: 'none', resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button
            onClick={onSkip}
            disabled={submitting}
            style={{
              padding: '8px 16px', borderRadius: 7,
              background: 'transparent', border: `1px solid ${c.inputBorder}`,
              color: c.textMuted, fontSize: 13, fontWeight: 500,
              cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            Skip — let AI estimate
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: '8px 18px', borderRadius: 7,
              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
              border: 'none', color: '#0A0F1C',
              fontSize: 13, fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1, fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Saving...' : 'Save & continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

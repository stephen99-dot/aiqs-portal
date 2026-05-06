import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, getToken } from '../utils/api';

/**
 * Branding settings — applied automatically to every Client Copy / Findings
 * doc the customer generates. Logo + two brand colours + a template picker.
 *
 * The preview pane on the right shows what their docs will look like, so they
 * can see the result before generating anything.
 */

const TEMPLATES = [
  { key: 'modern',       label: 'Modern',       desc: 'Gradient headers, big numerics. The default.' },
  { key: 'professional', label: 'Professional', desc: 'Black & white, hairlines, serif headings.' },
  { key: 'heritage',     label: 'Heritage',     desc: 'Warm beige & charcoal, classic feel.' },
  { key: 'minimalist',   label: 'Minimalist',   desc: 'No chrome — pure typography.' },
];

const DEFAULT_BRANDING = {
  primary_colour: '#1B2A4A',
  accent_colour: '#F59E0B',
  company_name: '',
  company_address: '',
  footer_text: '',
  template: 'modern',
};

export default function BrandingPage() {
  const [branding, setBranding] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);          // blob URL for <img>
  const [logoServerPath, setLogoServerPath] = useState(null); // /api/branding/logo/:id (for cache-busting)
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // The logo endpoint requires an Authorization header — <img src> doesn't
  // send one, so we fetch the logo as a blob and use createObjectURL.
  const loadLogoBlob = useCallback(async (urlPath) => {
    if (!urlPath) { setLogoUrl(null); return; }
    try {
      const token = getToken();
      const resp = await fetch(urlPath, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!resp.ok) { setLogoUrl(null); return; }
      const blob = await resp.blob();
      setLogoUrl((prev) => {
        if (prev && prev.startsWith('blob:')) {
          try { URL.revokeObjectURL(prev); } catch (e) {}
        }
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setLogoUrl(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/branding')
      .then((data) => {
        if (cancelled) return;
        setBranding({ ...DEFAULT_BRANDING, ...(data.branding || {}) });
        setLogoServerPath(data.logo_url || null);
        if (data.logo_url) loadLogoBlob(data.logo_url);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load branding'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadLogoBlob]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      setLogoUrl((prev) => {
        if (prev && prev.startsWith('blob:')) { try { URL.revokeObjectURL(prev); } catch (e) {} }
        return null;
      });
    };
  }, []);

  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 2200);
    return () => clearTimeout(t);
  }, [statusMsg]);

  function setField(field, value) {
    setBranding((b) => ({ ...b, [field]: value }));
  }

  async function saveField(field) {
    if (!branding) return;
    setSavingField(field);
    setError('');
    try {
      const data = await apiFetch('/branding', {
        method: 'PATCH',
        body: JSON.stringify({ [field]: branding[field] }),
      });
      if (data && data.branding) {
        setBranding({ ...DEFAULT_BRANDING, ...data.branding });
      }
      setStatusMsg('Saved');
    } catch (err) {
      setError(err.message || 'Save failed');
      setStatusMsg(null);
    } finally {
      setSavingField(null);
    }
  }

  async function uploadLogo(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file, file.name);
      const token = getToken();
      const resp = await fetch('/api/branding/logo', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd,
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Upload failed');
      }
      const data = await resp.json();
      if (data.branding) setBranding({ ...DEFAULT_BRANDING, ...data.branding });
      const path = (data.logo_url || '/api/branding/logo/me') + '?t=' + Date.now();
      setLogoServerPath(path);
      await loadLogoBlob(path);
      setStatusMsg('Logo updated');
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function deleteLogo() {
    if (!window.confirm('Remove your logo? Documents will use a text header instead.')) return;
    setUploading(true);
    setError('');
    try {
      const token = getToken();
      const resp = await fetch('/api/branding/logo', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!resp.ok) throw new Error('Delete failed');
      setLogoUrl((prev) => {
        if (prev && prev.startsWith('blob:')) { try { URL.revokeObjectURL(prev); } catch (e) {} }
        return null;
      });
      setLogoServerPath(null);
      setStatusMsg('Logo removed');
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>
        Loading branding…
      </div>
    );
  }

  if (!branding) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#EF4444' }}>
        {error || 'Could not load branding.'}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em',
        }}>
          Branding
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '4px 0 0' }}>
          Your logo and brand colours, applied automatically to every Client Copy and Findings document you generate.
        </p>
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#EF4444', fontSize: 13,
        }}>{error}</div>
      )}
      {statusMsg && (
        <div style={{
          padding: '8px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
          color: '#10B981', fontSize: 12.5, fontWeight: 600,
        }}>✓ {statusMsg}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 460px) 1fr', gap: 18, alignItems: 'flex-start' }}>
        {/* Settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Logo */}
          <Card title="Logo">
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: 14, borderRadius: 10,
              background: 'var(--bg)', border: '1px solid var(--border)',
            }}>
              <div style={{
                width: 80, height: 80, borderRadius: 9, flexShrink: 0,
                background: '#fff', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {logoUrl ? (
                  <img src={logoUrl} alt="Your logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No logo</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <button
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  disabled={uploading}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none',
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#0A0F1C', fontWeight: 700, fontSize: 13,
                    cursor: uploading ? 'wait' : 'pointer', marginRight: 8,
                  }}
                >{uploading ? 'Uploading…' : (logoUrl ? 'Replace' : 'Upload')}</button>
                {logoUrl && (
                  <button
                    onClick={deleteLogo}
                    disabled={uploading}
                    style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: 'transparent', color: 'var(--text-muted)',
                      border: '1px solid var(--border)', fontSize: 12.5, cursor: 'pointer',
                    }}
                  >Remove</button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg,image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) uploadLogo(f); e.target.value = ''; }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  PNG, JPG, WebP or SVG. Square or landscape works best — max 5MB.
                </div>
              </div>
            </div>
          </Card>

          {/* Colours */}
          <Card title="Brand colours">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ColourField
                label="Primary"
                hint="Section headers, totals"
                value={branding.primary_colour}
                onChange={(v) => setField('primary_colour', v)}
                onSave={() => saveField('primary_colour')}
                saving={savingField === 'primary_colour'}
              />
              <ColourField
                label="Accent"
                hint="Highlights, totals callout"
                value={branding.accent_colour}
                onChange={(v) => setField('accent_colour', v)}
                onSave={() => saveField('accent_colour')}
                saving={savingField === 'accent_colour'}
              />
            </div>
          </Card>

          {/* Company info */}
          <Card title="Company details">
            <Field label="Company name">
              <input
                type="text"
                value={branding.company_name || ''}
                onChange={(e) => setField('company_name', e.target.value)}
                onBlur={() => saveField('company_name')}
                placeholder="e.g. Smith & Co. Construction"
                style={inputStyle}
              />
            </Field>
            <Field label="Address (shown on cover sheet)">
              <textarea
                rows={3}
                value={branding.company_address || ''}
                onChange={(e) => setField('company_address', e.target.value)}
                onBlur={() => saveField('company_address')}
                placeholder="Street, town, county, postcode"
                style={{ ...inputStyle, resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
              />
            </Field>
            <Field label="Footer line (shown on every page)">
              <input
                type="text"
                value={branding.footer_text || ''}
                onChange={(e) => setField('footer_text', e.target.value)}
                onBlur={() => saveField('footer_text')}
                placeholder="e.g. www.smithco.uk · 020 1234 5678"
                style={inputStyle}
              />
            </Field>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Fields save automatically when you click outside the box.
            </div>
          </Card>

          {/* Template */}
          <Card title="Document template">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {TEMPLATES.map((t) => {
                const active = branding.template === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => { setField('template', t.key); setTimeout(() => saveField('template'), 50); }}
                    style={{
                      padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                      background: active ? 'rgba(245,158,11,0.08)' : 'var(--bg)',
                      border: '1px solid ' + (active ? '#F59E0B' : 'var(--border)'),
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t.label}</span>
                      {active && <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700 }}>✓ Selected</span>}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Live document preview */}
        <div style={{
          position: 'sticky', top: 12,
          padding: 18, borderRadius: 12,
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Live preview · Cover sheet
          </div>
          <DocPreview branding={branding} logoUrl={logoUrl} />
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
};

function Card({ title, children }) {
  return (
    <div style={{
      padding: 18, borderRadius: 12,
      background: 'var(--card-bg)', border: '1px solid var(--border)',
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function ColourField({ label, hint, value, onChange, onSave, saving }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onSave}
          style={{
            width: 42, height: 36, borderRadius: 7, padding: 0,
            border: '1px solid var(--border)', cursor: 'pointer',
            background: 'transparent',
          }}
        />
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onSave}
          placeholder="#1B2A4A"
          style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
        />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
        {saving ? 'Saving…' : hint}
      </div>
    </div>
  );
}

function DocPreview({ branding, logoUrl }) {
  const primary = branding.primary_colour || '#1B2A4A';
  const accent = branding.accent_colour || '#F59E0B';
  const company = branding.company_name || 'Your Company';
  const tmpl = branding.template || 'modern';

  // Slight visual variants per template — full fidelity comes from the XLSX/DOCX,
  // this is just an indicator so the user can compare.
  const variants = {
    modern:       { headerBg: `linear-gradient(135deg, ${primary}, ${shade(primary, -12)})`, headerColor: '#fff', accentBar: accent, font: 'system-ui, sans-serif', heading: 'system-ui, sans-serif' },
    professional: { headerBg: '#fff',     headerColor: '#000',  accentBar: '#000',  font: 'Georgia, serif',           heading: 'Georgia, serif' },
    heritage:     { headerBg: '#F5EFE3',  headerColor: '#3A2E1F', accentBar: '#8C6F3D', font: 'Georgia, serif',         heading: "'Playfair Display', Georgia, serif" },
    minimalist:   { headerBg: 'transparent', headerColor: '#111', accentBar: primary,  font: 'system-ui, sans-serif',   heading: 'system-ui, sans-serif' },
  };
  const v = variants[tmpl] || variants.modern;

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      background: '#fff', color: '#0A0F1C',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      fontFamily: v.font,
    }}>
      <div style={{
        background: v.headerBg, color: v.headerColor,
        padding: '32px 28px 28px',
        borderBottom: '4px solid ' + v.accentBar,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 9, flexShrink: 0,
            background: '#fff', border: '1px solid rgba(0,0,0,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 9, color: '#888' }}>No logo</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{tmpl}</div>
            <div style={{ fontFamily: v.heading, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{company}</div>
          </div>
        </div>
        <div style={{ fontFamily: v.heading, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          Bill of Quantities
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          Project: 14 Elm Mount Avenue · Single Storey Rear Extension
        </div>
      </div>

      <div style={{ padding: '20px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total value</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: primary, fontFamily: 'JetBrains Mono, monospace' }}>£141,520</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Issued</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      <div style={{ padding: '0 28px 24px' }}>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1, background: '#eee' }}>
          <div style={{ width: '52%', background: primary }} />
          <div style={{ width: '48%', background: accent }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#666' }}>
          <span><span style={{ color: primary, fontWeight: 800 }}>■</span> Labour 52%</span>
          <span><span style={{ color: accent, fontWeight: 800 }}>■</span> Materials 48%</span>
        </div>
      </div>

      {branding.footer_text && (
        <div style={{
          padding: '12px 28px', borderTop: '1px solid #eee',
          fontSize: 11, color: '#666', textAlign: 'center',
        }}>
          {branding.footer_text}
        </div>
      )}
    </div>
  );
}

// Helper: shade a hex colour by N% (positive = lighter, negative = darker).
function shade(hex, percent) {
  const c = hex.replace('#', '');
  if (c.length !== 6) return hex;
  const num = parseInt(c, 16);
  let r = (num >> 16) + Math.round(2.55 * percent);
  let g = ((num >> 8) & 0xff) + Math.round(2.55 * percent);
  let b = (num & 0xff) + Math.round(2.55 * percent);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

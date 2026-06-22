import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';
import { CheckIcon } from '../components/Icons';

/**
 * Findings editor — every narrative section of the Findings Report is
 * editable here. Save persists to project_data, "Download branded .docx"
 * re-renders the Word doc with the customer's logo / colours / footer.
 */

const SECTION_FIELDS = [
  { key: 'description',   label: 'Project description',  type: 'textarea', placeholder: 'High-level summary of the project, its scope, and objectives.' },
  { key: 'project_type',  label: 'Project type',         type: 'text',     placeholder: 'e.g. Single Storey Rear Extension' },
  { key: 'location',      label: 'Location',             type: 'text',     placeholder: 'Town / postcode' },
  { key: 'scope_summary', label: 'Scope summary',        type: 'textarea', placeholder: 'What is included in this BOQ — substructure, frame, fit-out, externals, etc.' },
];

export default function FindingsEditorPage() {
  const { id } = useParams();
  const [findings, setFindings] = useState(null);
  const [projectTitle, setProjectTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingField, setSavingField] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/projects/${id}/findings`);
      setFindings(normalise(data.findings || {}));
      setProjectTitle(data.project_title || '');
    } catch (err) {
      setError(err.message || 'Failed to load findings');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 2000);
    return () => clearTimeout(t);
  }, [statusMsg]);

  function setField(field, value) {
    setFindings((prev) => ({ ...prev, [field]: value }));
  }

  async function saveField(field) {
    if (!findings) return;
    setSavingField(field);
    setError('');
    try {
      const body = { [field]: findings[field] };
      const data = await apiFetch(`/projects/${id}/findings`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (data && data.findings) setFindings(normalise(data.findings));
      setStatusMsg('Saved');
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSavingField(null);
    }
  }

  async function saveAll() {
    if (!findings) return;
    setSavingField('all');
    setError('');
    try {
      const editable = ['description', 'project_type', 'location', 'scope_summary',
        'key_findings', 'assumptions', 'exclusions', 'recommendations', 'reference'];
      const body = {};
      for (const f of editable) body[f] = findings[f];
      await apiFetch(`/projects/${id}/findings`, { method: 'PATCH', body: JSON.stringify(body) });
      setStatusMsg('Everything saved');
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSavingField(null);
    }
  }

  async function downloadDocx() {
    setDownloading(true);
    setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${id}/findings/export`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ findings }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Export failed');
      }
      const blob = await resp.blob();
      const disp = resp.headers.get('content-disposition') || '';
      const m = disp.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : 'Findings.docx';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>Loading findings…</div>;
  }
  if (!findings) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>{error || "No findings stored for this project. Generate the BOQ first."}</p>
        <Link to={`/project/${id}`} className="btn-secondary" style={{ marginTop: 12, display: 'inline-block' }}>← Back to project</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <Link to={`/project/${id}`} style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to project
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em',
            }}>
              Findings Report
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '4px 0 0' }}>
              {projectTitle ? projectTitle + ' · ' : ''}Edit any section, then download the branded .docx.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={saveAll}
              disabled={savingField === 'all'}
              style={{
                padding: '10px 16px', borderRadius: 9, border: '1px solid var(--border)',
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >{savingField === 'all' ? 'Saving…' : 'Save all'}</button>
            <button
              onClick={downloadDocx}
              disabled={downloading}
              style={{
                padding: '10px 16px', borderRadius: 9, border: 'none',
                background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
                color: '#fff', fontSize: 13.5, fontWeight: 700,
                cursor: downloading ? 'wait' : 'pointer',
                boxShadow: '0 2px 10px rgba(59,130,246,0.25)',
              }}
            >{downloading ? 'Generating…' : 'Download branded .docx'}</button>
          </div>
        </div>
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
        }}><CheckIcon size={14} style={{ verticalAlign: 'middle' }} /> {statusMsg}</div>
      )}

      {/* Top fields */}
      <Card title="Project details">
        {SECTION_FIELDS.map(({ key, label, type, placeholder }) => (
          <Field key={key} label={label} saving={savingField === key}>
            {type === 'textarea' ? (
              <textarea
                rows={3}
                value={findings[key] || ''}
                onChange={(e) => setField(key, e.target.value)}
                onBlur={() => saveField(key)}
                placeholder={placeholder}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 70, fontFamily: 'inherit' }}
              />
            ) : (
              <input
                type="text"
                value={findings[key] || ''}
                onChange={(e) => setField(key, e.target.value)}
                onBlur={() => saveField(key)}
                placeholder={placeholder}
                style={inputStyle}
              />
            )}
          </Field>
        ))}
      </Card>

      {/* Key findings — array of {title, detail, items[]} */}
      <Card title="Key findings"
        action={<AddButton onClick={() => setField('key_findings', [...(findings.key_findings || []), { title: 'New finding', detail: '', items: [] }])} label="+ Add finding" />}
      >
        {(findings.key_findings || []).length === 0 && <Empty hint="No findings yet — add one." />}
        {(findings.key_findings || []).map((kf, idx) => (
          <div key={idx} style={cardRowStyle}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input
                type="text"
                value={kf.title || ''}
                onChange={(e) => updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, title: e.target.value })}
                onBlur={() => saveField('key_findings')}
                placeholder="Finding title (e.g. 'Structural assumptions')"
                style={{ ...inputStyle, flex: 1, fontWeight: 600 }}
              />
              <button onClick={() => removeAtIndex(setField, findings, 'key_findings', idx, () => saveField('key_findings'))} style={removeBtnStyle} title="Remove finding">×</button>
            </div>
            <textarea
              rows={2}
              value={kf.detail || ''}
              onChange={(e) => updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, detail: e.target.value })}
              onBlur={() => saveField('key_findings')}
              placeholder="Detail / explanation"
              style={{ ...inputStyle, marginBottom: 8, resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Bullet points</div>
            {(kf.items || []).map((it, j) => (
              <div key={j} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input
                  type="text"
                  value={it || ''}
                  onChange={(e) => {
                    const items = (kf.items || []).slice();
                    items[j] = e.target.value;
                    updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, items });
                  }}
                  onBlur={() => saveField('key_findings')}
                  placeholder="Bullet point"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => {
                    const items = (kf.items || []).filter((_, k) => k !== j);
                    updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, items }, () => saveField('key_findings'));
                  }}
                  style={removeBtnStyle} title="Remove bullet">×</button>
              </div>
            ))}
            <button
              onClick={() => updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, items: [...(kf.items || []), ''] })}
              style={addLinkStyle}
            >+ Add bullet</button>
          </div>
        ))}
      </Card>

      {/* Simple list sections */}
      <BulletListCard title="Assumptions"     field="assumptions"     findings={findings} setField={setField} saveField={saveField} savingField={savingField} />
      <BulletListCard title="Exclusions"      field="exclusions"      findings={findings} setField={setField} saveField={saveField} savingField={savingField} />
      <BulletListCard title="Recommendations" field="recommendations" findings={findings} setField={setField} saveField={saveField} savingField={savingField} />

      {/* Cost summary — read-only callout (driven by the priced BOQ) */}
      {findings.cost_summary && findings.cost_summary.grand_total > 0 && (
        <Card title="Cost summary (read-only)" subtitle="Pulled from the priced BOQ — edit the BOQ on the Builder Pack page if these need to change.">
          <div style={{ display: 'grid', gridTemplateColumns: findings.cost_summary.ohp > 0 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 10 }}>
            <Stat label="Net total"        value={findings.cost_summary.net_total} />
            {findings.cost_summary.ohp > 0 && <Stat label="OH&P" value={findings.cost_summary.ohp} />}
            <Stat label="Grand total"      value={findings.cost_summary.grand_total} accent />
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function normalise(f) {
  return {
    description: f.description || '',
    project_type: f.project_type || '',
    location: f.location || '',
    scope_summary: f.scope_summary || '',
    key_findings: Array.isArray(f.key_findings) ? f.key_findings.map((kf) => ({
      title: kf.title || '',
      detail: kf.detail || '',
      items: Array.isArray(kf.items) ? kf.items.slice() : [],
    })) : [],
    assumptions: Array.isArray(f.assumptions) ? f.assumptions.slice() : [],
    exclusions: Array.isArray(f.exclusions) ? f.exclusions.slice() : [],
    recommendations: Array.isArray(f.recommendations) ? f.recommendations.slice() : [],
    reference: f.reference || '',
    cost_summary: f.cost_summary || null,
  };
}
function updateAtIndex(setField, findings, key, idx, value, after) {
  const arr = (findings[key] || []).slice();
  arr[idx] = value;
  setField(key, arr);
  if (after) setTimeout(after, 0);
}
function removeAtIndex(setField, findings, key, idx, after) {
  const arr = (findings[key] || []).filter((_, i) => i !== idx);
  setField(key, arr);
  if (after) setTimeout(after, 0);
}

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
};
const cardRowStyle = {
  padding: 12, borderRadius: 9, marginBottom: 8,
  background: 'var(--bg-primary)', border: '1px solid var(--border)',
};
const removeBtnStyle = {
  width: 30, flexShrink: 0,
  background: 'none', border: '1px solid var(--border)', borderRadius: 7,
  color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
};
const addLinkStyle = {
  background: 'none', border: '1px dashed var(--border)', borderRadius: 6,
  padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
  color: 'var(--text-muted)', cursor: 'pointer', marginTop: 4,
};

function Card({ title, subtitle, action, children }) {
  return (
    <div style={{ padding: 18, borderRadius: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 0', fontStyle: 'italic' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, saving, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        {saving && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Saving…</span>}
      </div>
      {children}
    </div>
  );
}

function AddButton({ onClick, label }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
      fontSize: 12, fontWeight: 600, cursor: 'pointer',
    }}>{label}</button>
  );
}

function Empty({ hint }) {
  return <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{hint}</div>;
}

function BulletListCard({ title, field, findings, setField, saveField, savingField }) {
  const list = findings[field] || [];
  return (
    <Card title={title}
      action={<AddButton onClick={() => setField(field, [...(findings[field] || []), ''])} label="+ Add" />}
    >
      {list.length === 0 && <Empty hint={`No ${title.toLowerCase()} yet — add one.`} />}
      {list.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            type="text"
            value={it || ''}
            onChange={(e) => updateAtIndex(setField, findings, field, idx, e.target.value)}
            onBlur={() => saveField(field)}
            placeholder={'Add a ' + title.toLowerCase().replace(/s$/, '')}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => removeAtIndex(setField, findings, field, idx, () => saveField(field))}
            style={removeBtnStyle} title="Remove">×</button>
        </div>
      ))}
      {savingField === field && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>Saving…</div>}
    </Card>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--bg-primary)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace',
        color: accent ? '#F59E0B' : 'var(--text-primary)',
      }}>£{Math.round(value || 0).toLocaleString('en-GB')}</div>
    </div>
  );
}

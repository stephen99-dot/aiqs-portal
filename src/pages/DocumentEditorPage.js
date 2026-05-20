import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

export default function DocumentEditorPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const { id } = useParams();
  const nav = useNavigate();

  const [doc, setDoc] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [fields, setFields] = useState({});
  const [title, setTitle] = useState('');
  const [jobId, setJobId] = useState('');
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, j] = await Promise.all([
        apiFetch('/documents/' + id),
        apiFetch('/finance/jobs'),
      ]);
      setDoc(r.document);
      setTpl(r.template);
      setFields(r.document.fields || {});
      setTitle(r.document.title || '');
      setJobId(r.document.job_id || '');
      setJobs(j.jobs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const update = (key, value) => { setFields(prev => ({ ...prev, [key]: value })); setDirty(true); };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await apiFetch('/documents/' + id, {
        method: 'PATCH',
        body: JSON.stringify({ title, fields, job_id: jobId || null }),
      });
      setSavedAt(new Date());
      setDirty(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const downloadPdf = async () => {
    if (dirty) await save();
    fetch('/api/documents/' + id + '/pdf', {
      headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() },
    }).then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (title || tpl?.label || 'document') + '.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      }).catch(e => alert(e.message));
  };

  const duplicate = async () => {
    if (dirty) await save();
    try {
      const r = await apiFetch('/documents/' + id + '/duplicate', { method: 'POST' });
      nav('/documents/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const remove = async () => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await apiFetch('/documents/' + id, { method: 'DELETE' });
      nav('/documents');
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  if (!doc || !tpl) return <div style={{ padding: 40, color: t.danger }}>{error || 'Document not found.'}</div>;

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 880, margin: '0 auto' }}>
      <button onClick={() => nav('/documents')} style={btnLink(t)}>← Documents</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <input value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }} placeholder={tpl.label} style={{ margin: '6px 0 4px 0', fontSize: 22, fontWeight: 700, color: t.text, background: 'transparent', border: 'none', outline: 'none', minWidth: 360 }} />
          <div style={{ color: t.textSecondary, fontSize: 13 }}>
            {tpl.label} {savedAt && <span style={{ color: t.success, marginLeft: 8 }}>Saved {savedAt.toLocaleTimeString('en-GB')}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving || !dirty} style={btnPrimary(t, saving || !dirty)}>{saving ? 'Saving…' : (dirty ? 'Save changes' : 'Saved')}</button>
          <button onClick={downloadPdf} style={btnSecondary(t)}>Download PDF</button>
          <button onClick={duplicate} style={btnSecondary(t)}>Duplicate</button>
          <button onClick={remove} style={{ ...btnSecondary(t), color: t.danger }}>Delete</button>
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {/* Attach to job */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <label style={lbl(t)}>Linked job</label>
        <select value={jobId} onChange={e => { setJobId(e.target.value); setDirty(true); }} style={{ width: 380, maxWidth: '100%', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }}>
          <option value="">— None —</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}{j.client_name ? ' · ' + j.client_name : ''}</option>)}
        </select>
      </div>

      {/* Field form */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
        {tpl.fields.map(f => (
          <Field key={f.key} t={t} field={f} value={fields[f.key]} onChange={(v) => update(f.key, v)} />
        ))}
      </div>
    </div>
  );
}

function Field({ t, field, value, onChange }) {
  const v = value == null ? '' : value;
  const required = field.required;
  if (field.type === 'textarea' || field.type === 'list') {
    return (
      <div style={row}>
        <FieldLabel t={t} field={field} required={required} />
        <textarea
          value={v}
          onChange={e => onChange(e.target.value)}
          rows={field.type === 'list' ? 5 : 4}
          placeholder={field.type === 'list' ? 'One per line' : ''}
          style={ta(t)}
        />
        {field.help && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 4 }}>{field.help}</div>}
      </div>
    );
  }
  if (field.type === 'date') {
    return (
      <div style={row}>
        <FieldLabel t={t} field={field} required={required} />
        <input type="date" value={v} onChange={e => onChange(e.target.value)} style={fld(t)} />
      </div>
    );
  }
  if (field.type === 'number') {
    return (
      <div style={row}>
        <FieldLabel t={t} field={field} required={required} />
        <input type="number" step="any" value={v} onChange={e => onChange(e.target.value)} style={fld(t)} />
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <div style={row}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.text, fontSize: 14 }}>
          <input type="checkbox" checked={!!v} onChange={e => onChange(e.target.checked)} />
          {field.label}
        </label>
        {field.help && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 4 }}>{field.help}</div>}
      </div>
    );
  }
  // default: text
  return (
    <div style={row}>
      <FieldLabel t={t} field={field} required={required} />
      <input value={v} onChange={e => onChange(e.target.value)} style={fld(t)} />
      {field.help && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 4 }}>{field.help}</div>}
    </div>
  );
}

function FieldLabel({ t, field, required }) {
  return (
    <label style={lbl(t)}>
      {field.label}{required && <span style={{ color: t.danger, marginLeft: 4 }}>*</span>}
    </label>
  );
}

const row = { marginBottom: 14 };
function lbl(t) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }; }
function fld(t) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }; }
function ta(t)  { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }; }
function btnLink(t)     { return { background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer' }; }
function btnPrimary(t, disabled) { return { background: disabled ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.7 : 1 }; }
function btnSecondary(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }; }

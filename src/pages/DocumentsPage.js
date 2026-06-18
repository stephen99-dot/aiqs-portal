import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import { FileTextIcon, ScaleIcon, ClipboardIcon, PoundIcon, AlertTriangleIcon } from '../components/Icons';
import HelpTip from '../components/HelpTip';

const TEMPLATE_ICONS = {
  'contract': FileTextIcon,
  'terms-conditions': ScaleIcon,
  'scope-of-work': ClipboardIcon,
  'payment-terms': PoundIcon,
  'health-safety-rams': AlertTriangleIcon,
  'letter': FileTextIcon,
};

export default function DocumentsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickJobId, setPickJobId] = useState('');
  // C3 — "Describe what you need" -> AI drafts a letter into the editor.
  const [draftText, setDraftText] = useState('');
  const [draftJobId, setDraftJobId] = useState('');
  const [drafting, setDrafting] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [tpl, docs, j] = await Promise.all([
        apiFetch('/documents/templates'),
        apiFetch('/documents'),
        apiFetch('/finance/jobs'),
      ]);
      setTemplates(tpl.templates || []);
      setDocuments(docs.documents || []);
      setJobs(j.jobs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async (templateId) => {
    try {
      const body = { template_id: templateId };
      if (pickJobId) body.job_id = pickJobId;
      const r = await apiFetch('/documents', { method: 'POST', body: JSON.stringify(body) });
      nav('/documents/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const draftLetter = async () => {
    if (!draftText.trim() || drafting) return;
    setDrafting(true); setError('');
    try {
      const r = await apiFetch('/documents/draft', {
        method: 'POST',
        body: JSON.stringify({ description: draftText.trim(), job_id: draftJobId || null }),
      });
      nav('/documents/' + r.id);
    } catch (e) { setError(e.message); }
    finally { setDrafting(false); }
  };

  const downloadPdf = (id) => {
    fetch('/api/documents/' + id + '/pdf', {
      headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() },
    }).then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'document.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      }).catch(e => alert(e.message));
  };

  const remove = async (id, title) => {
    if (!window.confirm('Delete "' + (title || 'this document') + '"?')) return;
    try {
      await apiFetch('/documents/' + id, { method: 'DELETE' });
      refresh();
    } catch (e) { setError(e.message); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Documents <HelpTip t={t} title="Documents" text={"Branded paperwork from fill-in templates — contract, terms, scope of work, payment terms, RAMS, letters.\n\nOr just say what letter you need ('polite letter about the two-week delay') and read the draft before you do anything with it."} /></h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Fillable, branded templates — contracts, T&Cs, scope of work, payment terms, RAMS.
          </div>
        </div>
        <button onClick={() => setPicking(v => !v)} style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>
          {picking ? 'Cancel' : '+ New document'}
        </button>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {/* C3 — describe what you need, get a letter to review */}
      <div style={{ background: t.card, border: '1px solid ' + t.accent + '55', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Need a letter? Just say what for</div>
        <div style={{ color: t.textMuted, fontSize: 12.5, marginBottom: 10 }}>
          e.g. "A polite letter to Mrs Patel explaining the job will finish two weeks late because of the steel delay." You'll see the draft before anything goes anywhere.
        </div>
        <textarea
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
          rows={2}
          placeholder="What do you need to say, and to whom?"
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 64, padding: '10px 12px', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 10, fontSize: 14.5, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <select value={draftJobId} onChange={e => setDraftJobId(e.target.value)} style={{ flex: 1, minWidth: 180, minHeight: 44, padding: '8px 10px', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 10, fontSize: 13.5 }}>
            <option value="">Not about a particular job</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{[j.client_name, j.name].filter(Boolean).join(' — ')}</option>)}
          </select>
          <button onClick={draftLetter} disabled={drafting || !draftText.trim()} style={{
            minHeight: 44, padding: '0 18px', borderRadius: 10, border: 'none',
            background: t.accent, color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', opacity: (drafting || !draftText.trim()) ? 0.5 : 1,
          }}>{drafting ? 'Writing it…' : 'Draft the letter'}</button>
        </div>
      </div>

      {picking && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ color: t.text, fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Pick a template</div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }}>Attach to job (optional)</label>
            <select value={pickJobId} onChange={e => setPickJobId(e.target.value)} style={{ width: 360, maxWidth: '100%', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }}>
              <option value="">— No job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}{j.client_name ? ' · ' + j.client_name : ''}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {templates.map(tpl => {
              const Ico = TEMPLATE_ICONS[tpl.id] || FileTextIcon;
              return (
              <button key={tpl.id} onClick={() => create(tpl.id)} style={{
                background: t.surface, border: '1px solid ' + t.border, borderRadius: 12,
                padding: 16, textAlign: 'left', cursor: 'pointer', color: t.text,
              }}>
                <div style={{ marginBottom: 8 }}>{Ico && <Ico size={28} />}</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{tpl.label}</div>
                <div style={{ color: t.textSecondary, fontSize: 12, marginTop: 4 }}>{tpl.description}</div>
              </button>
              );
            })}
          </div>
        </div>
      )}

      {documents.length === 0 ? (
        <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 40, textAlign: 'center', color: t.textSecondary }}>
          No documents yet. Click "+ New document" to start.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {documents.map(d => (
            <div key={d.id} style={{ background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); nav('/documents/' + d.id); }} style={{ color: t.text, textDecoration: 'none', fontWeight: 700, fontSize: 15 }}>{d.title}</a>
                  <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2 }}>
                    {(d.template_label || d.template_id)}{d.job_name ? ' · ' + d.job_name : ''} · {(d.updated_at || d.created_at || '').slice(0, 10)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => nav('/documents/' + d.id)} style={{ ...btnGhost(t), minHeight: 40 }}>Open</button>
                <button onClick={() => downloadPdf(d.id)} style={{ ...btnGhost(t), minHeight: 40 }}>PDF</button>
                <button onClick={() => remove(d.id, d.title)} style={{ ...btnGhost(t), minHeight: 40, color: t.danger }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const td = { padding: '12px 14px', fontSize: 14 };
function btnGhost(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 6, padding: '4px 10px', fontSize: 12, marginLeft: 6, cursor: 'pointer' }; }

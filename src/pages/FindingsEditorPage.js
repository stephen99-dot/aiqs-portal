import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';
import { CheckIcon } from '../components/Icons';
import {
  Button, IconButton, Card, Banner, PageHeader, EmptyState,
  Input, Textarea, Field, Skeleton, SkeletonCard, Stat,
} from '../ui';

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

  async function saveField(field, value) {
    if (!findings) return;
    setSavingField(field);
    setError('');
    try {
      // An explicit value wins over state: a remove handler saves the array it
      // just computed. Reading findings[field] here after a removal PATCHed the
      // stale pre-delete array — the server then echoed the old list back and
      // the "deleted" row reappeared.
      const body = { [field]: value !== undefined ? value : findings[field] };
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
    return (
      <div style={{ padding: '24px 28px 60px', maxWidth: 1080, margin: '0 auto' }}>
        <Skeleton width={140} height={12} style={{ marginBottom: 12 }} />
        <Skeleton width={240} height={28} style={{ marginBottom: 8 }} />
        <Skeleton width={340} height={13} style={{ marginBottom: 24 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SkeletonCard height={140} />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }
  if (!findings) {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState
          title="No findings available"
          body={error || 'No findings stored for this project. Generate the BOQ first.'}
          action={<Button variant="secondary" to={`/project/${id}`}>← Back to project</Button>}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1080, margin: '0 auto' }}>
      <Link to={`/project/${id}`} style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 4 }}>
        ← Back to project
      </Link>
      <PageHeader
        title="Findings Report"
        subtitle={`${projectTitle ? projectTitle + ' · ' : ''}Edit any section, then download the branded .docx.`}
        actions={
          <>
            <Button variant="secondary" onClick={saveAll} disabled={savingField === 'all'}>
              {savingField === 'all' ? 'Saving…' : 'Save all'}
            </Button>
            <Button onClick={downloadDocx} disabled={downloading}>
              {downloading ? 'Generating…' : 'Download branded .docx'}
            </Button>
          </>
        }
      />

      {error && (
        <Banner tone="danger" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</Banner>
      )}
      {statusMsg && (
        <Banner tone="success" style={{ color: 'var(--success)', fontSize: 12.5, fontWeight: 600 }}>
          <CheckIcon size={14} style={{ verticalAlign: 'middle' }} /> {statusMsg}
        </Banner>
      )}

      {/* Top fields */}
      <Section title="Project details">
        {SECTION_FIELDS.map(({ key, label, type, placeholder }) => (
          <Field key={key} label={label} hint={savingField === key ? 'Saving…' : undefined} style={{ marginBottom: 10 }}>
            {type === 'textarea' ? (
              <Textarea
                rows={3}
                value={findings[key] || ''}
                onChange={(e) => setField(key, e.target.value)}
                onBlur={() => saveField(key)}
                placeholder={placeholder}
                style={{ minHeight: 70 }}
              />
            ) : (
              <Input
                type="text"
                value={findings[key] || ''}
                onChange={(e) => setField(key, e.target.value)}
                onBlur={() => saveField(key)}
                placeholder={placeholder}
              />
            )}
          </Field>
        ))}
      </Section>

      {/* Key findings — array of {title, detail, items[]} */}
      <Section title="Key findings"
        action={
          <Button variant="secondary" size="sm"
            onClick={() => setField('key_findings', [...(findings.key_findings || []), { title: 'New finding', detail: '', items: [] }])}
          >+ Add finding</Button>
        }
      >
        {(findings.key_findings || []).length === 0 && <Empty hint="No findings yet — add one." />}
        {(findings.key_findings || []).map((kf, idx) => (
          <div key={idx} style={cardRowStyle}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <Input
                type="text"
                value={kf.title || ''}
                onChange={(e) => updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, title: e.target.value })}
                onBlur={() => saveField('key_findings')}
                placeholder="Finding title (e.g. 'Structural assumptions')"
                style={{ flex: 1, fontWeight: 600 }}
              />
              <IconButton danger onClick={() => removeAtIndex(setField, findings, 'key_findings', idx, (arr) => saveField('key_findings', arr))} title="Remove finding" aria-label="Remove finding">×</IconButton>
            </div>
            <Textarea
              rows={2}
              value={kf.detail || ''}
              onChange={(e) => updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, detail: e.target.value })}
              onBlur={() => saveField('key_findings')}
              placeholder="Detail / explanation"
              style={{ marginBottom: 8, minHeight: 56 }}
            />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>Bullet points</div>
            {(kf.items || []).map((it, j) => (
              <div key={j} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                <Input
                  type="text"
                  value={it || ''}
                  onChange={(e) => {
                    const items = (kf.items || []).slice();
                    items[j] = e.target.value;
                    updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, items });
                  }}
                  onBlur={() => saveField('key_findings')}
                  placeholder="Bullet point"
                  style={{ flex: 1 }}
                />
                <IconButton danger
                  onClick={() => {
                    const items = (kf.items || []).filter((_, k) => k !== j);
                    updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, items }, (arr) => saveField('key_findings', arr));
                  }}
                  title="Remove bullet" aria-label="Remove bullet">×</IconButton>
              </div>
            ))}
            <Button variant="ghost" size="sm" style={{ marginTop: 4 }}
              onClick={() => updateAtIndex(setField, findings, 'key_findings', idx, { ...kf, items: [...(kf.items || []), ''] })}
            >+ Add bullet</Button>
          </div>
        ))}
      </Section>

      {/* Simple list sections */}
      <BulletListCard title="Assumptions"     field="assumptions"     findings={findings} setField={setField} saveField={saveField} savingField={savingField} />
      <BulletListCard title="Exclusions"      field="exclusions"      findings={findings} setField={setField} saveField={saveField} savingField={savingField} />
      <BulletListCard title="Recommendations" field="recommendations" findings={findings} setField={setField} saveField={saveField} savingField={savingField} />

      {/* Cost summary — read-only callout (driven by the priced BOQ) */}
      {findings.cost_summary && findings.cost_summary.grand_total > 0 && (
        <Section title="Cost summary (read-only)" subtitle="Pulled from the priced BOQ — edit the BOQ on the Builder Pack page if these need to change.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Stat label="Net total"   value={money(findings.cost_summary.net_total)} />
            {findings.cost_summary.ohp > 0 && <Stat label="OH&P" value={money(findings.cost_summary.ohp)} />}
            <Stat label="Grand total" value={money(findings.cost_summary.grand_total)} accent />
          </div>
        </Section>
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
  if (after) setTimeout(() => after(arr), 0);
}
function removeAtIndex(setField, findings, key, idx, after) {
  const arr = (findings[key] || []).filter((_, i) => i !== idx);
  setField(key, arr);
  if (after) setTimeout(() => after(arr), 0);
}

function money(v) {
  return '£' + Math.round(v || 0).toLocaleString('en-GB');
}

const cardRowStyle = {
  padding: 12, borderRadius: 9, marginBottom: 8,
  background: 'var(--bg-primary)', border: '1px solid var(--border)',
};

// Section — a kit Card with the editor's compact header (title, optional
// italic subtitle, right-aligned action).
function Section({ title, subtitle, action, children }) {
  return (
    <Card style={{ marginBottom: 14 }}>
      <Card.Header title={title} extra={action} />
      <Card.Body>
        {subtitle && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px', fontStyle: 'italic' }}>{subtitle}</p>}
        {children}
      </Card.Body>
    </Card>
  );
}

function Empty({ hint }) {
  return <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{hint}</div>;
}

function BulletListCard({ title, field, findings, setField, saveField, savingField }) {
  const list = findings[field] || [];
  return (
    <Section title={title}
      action={
        <Button variant="secondary" size="sm"
          onClick={() => setField(field, [...(findings[field] || []), ''])}
        >+ Add</Button>
      }
    >
      {list.length === 0 && <Empty hint={`No ${title.toLowerCase()} yet — add one.`} />}
      {list.map((it, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <Input
            type="text"
            value={it || ''}
            onChange={(e) => updateAtIndex(setField, findings, field, idx, e.target.value)}
            onBlur={() => saveField(field)}
            placeholder={'Add a ' + title.toLowerCase().replace(/s$/, '')}
            style={{ flex: 1 }}
          />
          <IconButton danger
            onClick={() => removeAtIndex(setField, findings, field, idx, (arr) => saveField(field, arr))}
            title="Remove" aria-label="Remove">×</IconButton>
        </div>
      ))}
      {savingField === field && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>Saving…</div>}
    </Section>
  );
}

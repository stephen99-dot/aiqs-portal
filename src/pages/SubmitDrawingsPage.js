import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import {
  UploadIcon, XIcon, PaperclipIcon, FileTextIcon, FileImageIcon,
  FileSpreadsheetIcon, FileArchiveIcon, ZapIcon, ArrowRightIcon,
} from '../components/Icons';

const PROJECT_TYPES = [
  'Residential Extension',
  'Loft Conversion',
  'Full Refurbishment',
  'New Build',
  'Commercial Fit-Out',
  'Demolition / Enabling Works',
  'Heritage / Listed Building',
  'Structural Steelwork',
  'Metalwork / Fabrication',
  'Other',
];

const MIN_SUBMIT_CHARS = 20;

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    pdf: FileTextIcon, dwg: FileTextIcon, dxf: FileTextIcon,
    png: FileImageIcon, jpg: FileImageIcon, jpeg: FileImageIcon,
    xlsx: FileSpreadsheetIcon, xls: FileSpreadsheetIcon, csv: FileSpreadsheetIcon,
    docx: FileTextIcon, doc: FileTextIcon,
    zip: FileArchiveIcon, rar: FileArchiveIcon,
  };
  return map[ext] || PaperclipIcon;
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export default function SubmitDrawingsPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [credits, setCredits] = useState(null);
  const [projectType, setProjectType] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [status, setStatus] = useState(null); // { type: 'success'|'error', msg: string }

  useEffect(() => {
    apiFetch('/credits').then(setCredits).catch(() => {});
  }, []);

  const canSubmit = !!projectType && message.trim().length >= MIN_SUBMIT_CHARS && files.length > 0 && !submitting;
  const noCredits = credits && !credits.is_admin && credits.free_credits <= 0;

  function addFiles(newFiles) {
    setFiles(prev => [...prev, ...Array.from(newFiles)]);
  }
  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus(null);

    if (noCredits) {
      setStatus({ type: 'error', msg: "You're out of BOQ credits. Please upgrade to submit more drawings." });
      return;
    }
    if (!projectType) return setStatus({ type: 'error', msg: 'Please select a project type.' });
    if (message.trim().length < MIN_SUBMIT_CHARS) {
      return setStatus({ type: 'error', msg: 'Please describe your project (min ' + MIN_SUBMIT_CHARS + ' characters).' });
    }
    if (files.length === 0) return setStatus({ type: 'error', msg: 'Please upload at least one drawing or document.' });

    setSubmitting(true);
    setProgressLabel('Uploading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');

    try {
      const fd = new FormData();
      fd.append('project_type', projectType);
      fd.append('message', message.trim());
      for (const f of files) fd.append('files', f, f.name);

      const data = await apiFetch('/submissions', { method: 'POST', body: fd });

      setStatus({
        type: 'success',
        msg: "Submitted! We'll be in touch within 24 hours with your professional BOQ and Findings Report. Submission ID: " + data.submission_id,
      });
      setProjectType('');
      setMessage('');
      setFiles([]);
      setCredits(c => c ? { ...c, free_credits: data.credits_remaining, can_submit: data.credits_remaining > 0 } : c);
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Submission failed — please try again.' });
    } finally {
      setSubmitting(false);
      setProgressLabel('');
    }
  }

  return (
    <div style={{ padding: '32px 28px', maxWidth: 880, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 30, fontWeight: 700, color: t.text,
          margin: '0 0 6px', letterSpacing: '-0.02em',
        }}>
          Submit Drawings for BOQ
        </h1>
        <p style={{ color: t.textMuted, fontSize: 14, margin: 0, lineHeight: 1.6 }}>
          Upload your plans, elevations, and specs. We'll produce a professional Bill of Quantities and Findings Report — typically within 24 hours.
        </p>
      </div>

      {/* Credit banner */}
      {credits && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 18px', marginBottom: 22, borderRadius: 12,
          background: noCredits
            ? 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.03))'
            : 'rgba(245,158,11,0.06)',
          border: '1px solid ' + (noCredits ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.2)'),
        }}>
          <ZapIcon size={16} color={noCredits ? '#EF4444' : '#F59E0B'} />
          <div style={{ flex: 1, fontSize: 13.5, color: t.text }}>
            {credits.is_admin ? (
              <strong>Admin — unlimited submissions</strong>
            ) : noCredits ? (
              <span>You have <strong style={{ color: '#EF4444' }}>0 BOQ credits</strong> remaining. Top up to keep submitting.</span>
            ) : (
              <span><strong style={{ color: t.text }}>{credits.free_credits} BOQ credit{credits.free_credits === 1 ? '' : 's'}</strong> remaining {credits.total_projects > 0 ? '(used ' + credits.total_projects + ')' : ''}</span>
            )}
          </div>
          {noCredits && (
            <button onClick={() => navigate('/pricing')} style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: '#F59E0B', color: '#0A0F1C',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>Buy more <ArrowRightIcon size={13} color="#0A0F1C" /></button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{
        background: t.card, border: '1px solid ' + t.border,
        borderRadius: 16, padding: '28px 26px',
      }}>

        {/* Project Type */}
        <label style={{ display: 'block', marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 6, letterSpacing: '0.02em' }}>
            Project Type <span style={{ color: '#F59E0B' }}>*</span>
          </div>
          <select
            value={projectType}
            onChange={e => setProjectType(e.target.value)}
            disabled={submitting}
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 9,
              background: t.surface, color: t.text,
              border: '1px solid ' + t.border, fontSize: 14,
              outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">Select a project type…</option>
            {PROJECT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        {/* Drawings / Files */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 6, letterSpacing: '0.02em' }}>
            Drawings &amp; Documents <span style={{ color: '#F59E0B' }}>*</span>
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            style={{
              position: 'relative',
              border: '2px dashed ' + (dragOver ? '#F59E0B' : t.border),
              background: dragOver ? 'rgba(245,158,11,0.04)' : t.surface,
              borderRadius: 12, padding: '28px 20px',
              textAlign: 'center', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 12, margin: '0 auto 10px',
              background: 'rgba(245,158,11,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <UploadIcon size={20} color="#F59E0B" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 3, pointerEvents: 'none' }}>
              Drag &amp; drop or <span style={{ color: '#F59E0B', textDecoration: 'underline' }}>browse</span>
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, pointerEvents: 'none' }}>
              PDF, DWG, images, Word, Excel — any file type accepted
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
                fontSize: 0,
              }}
            />
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => {
                const Icon = getFileIcon(f.name);
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 9,
                    background: t.surface, border: '1px solid ' + t.border,
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: 'rgba(245,158,11,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={14} color="#F59E0B" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: t.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{fmtSize(f.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 5, borderRadius: 6, color: t.textMuted,
                        display: 'flex',
                      }}
                      aria-label="Remove file"
                    >
                      <XIcon size={14} color={t.textMuted} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Project details */}
        <label style={{ display: 'block', marginBottom: 18 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 6, letterSpacing: '0.02em',
          }}>
            <span>Project Details <span style={{ color: '#F59E0B' }}>*</span></span>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              color: message.trim().length >= MIN_SUBMIT_CHARS ? '#10B981' : t.textMuted,
            }}>
              {message.trim().length}
            </span>
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={submitting}
            rows={6}
            placeholder="Describe your project: rooms, dimensions, materials, specifications, location, anything on the drawings. The more detail you add, the more accurate your BOQ will be."
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 9,
              background: t.surface, color: t.text,
              border: '1px solid ' + t.border, fontSize: 14,
              outline: 'none', resize: 'vertical', minHeight: 120,
              fontFamily: 'inherit', lineHeight: 1.6,
            }}
          />
        </label>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit || noCredits}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '14px 28px', borderRadius: 10,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            color: '#0A0F1C',
            fontWeight: 700, fontSize: 15, border: 'none',
            cursor: (!canSubmit || noCredits) ? 'not-allowed' : 'pointer',
            opacity: (!canSubmit || noCredits) ? 0.5 : 1,
            boxShadow: '0 2px 16px rgba(245,158,11,0.2)',
            transition: 'transform 0.15s',
          }}
        >
          {submitting ? (
            <>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                border: '2.5px solid rgba(10,15,28,0.2)',
                borderTopColor: '#0A0F1C',
                animation: 'spin 0.6s linear infinite',
              }} />
              {progressLabel || 'Submitting…'}
            </>
          ) : (
            <>Submit Enquiry <ArrowRightIcon size={15} color="#0A0F1C" /></>
          )}
        </button>

        {status && (
          <div style={{
            marginTop: 14, padding: '12px 16px', borderRadius: 10,
            background: status.type === 'success' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: '1px solid ' + (status.type === 'success' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'),
            color: status.type === 'success' ? '#10B981' : '#F87171',
            fontSize: 13.5, lineHeight: 1.6,
          }}>
            {status.msg}
          </div>
        )}
      </form>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

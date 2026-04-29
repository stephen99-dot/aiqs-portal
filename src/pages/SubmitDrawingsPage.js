import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import {
  UploadIcon, XIcon, PaperclipIcon, FileTextIcon, FileImageIcon,
  FileSpreadsheetIcon, FileArchiveIcon, ZapIcon, ArrowRightIcon, SparklesIcon,
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
  const [credits, setCredits] = useState(null);
  const [projectType, setProjectType] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [status, setStatus] = useState(null); // { type: 'success'|'error', msg: string }
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState(null);
  const [enhanceElapsed, setEnhanceElapsed] = useState(0);

  const ENHANCE_ESTIMATE_S = 9; // typical polish-mode latency
  const enhanceRemaining = Math.max(0, ENHANCE_ESTIMATE_S - enhanceElapsed);

  useEffect(() => {
    apiFetch('/credits').then(setCredits).catch(() => {});
  }, []);

  const canSubmit = !!projectType && message.trim().length >= MIN_SUBMIT_CHARS && files.length > 0 && !submitting;
  const noCredits = credits && !credits.is_admin && credits.free_credits <= 0;

  function addFiles(newFiles) {
    setFiles(prev => [...prev, ...Array.from(newFiles || [])]);
  }
  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  useEffect(() => {
    if (!enhancing) return;
    setEnhanceElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      setEnhanceElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [enhancing]);

  async function enhanceWriting() {
    if (message.trim().length < 10) {
      setEnhanceError('Write a few words first (min 10 characters) and I can polish it.');
      return;
    }
    setEnhanceError(null);
    setEnhancing(true);
    try {
      const data = await apiFetch('/enhance-brief', {
        method: 'POST',
        body: JSON.stringify({ mode: 'polish', brief: message.trim(), project_type: projectType }),
      });
      if (data.enhanced) setMessage(data.enhanced);
      else setEnhanceError('AI returned an empty response — please try again.');
    } catch (err) {
      setEnhanceError(err.message || 'Could not enhance — please try again.');
    } finally {
      setEnhancing(false);
    }
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

          {/* Recreate the EXACT pattern that worked in the user's console diagnostic:
              create a fresh <input>, append to body, click it, read files from the change
              event, then remove it. No React refs, no portals, no styled inputs. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '14px 16px', borderRadius: 12,
            background: t.surface, border: '1px solid ' + t.border,
            marginBottom: 8,
          }}>
            <PaperclipIcon size={18} color="#F59E0B" />
            <button
              type="button"
              onClick={() => {
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.multiple = true;
                inp.style.position = 'fixed';
                inp.style.left = '0';
                inp.style.top = '0';
                inp.onchange = (e) => {
                  const fl = e.target.files;
                  if (fl && fl.length) addFiles(fl);
                  setTimeout(() => inp.remove(), 0);
                };
                document.body.appendChild(inp);
                inp.click();
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 22px', borderRadius: 9,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C',
                fontWeight: 700, fontSize: 13.5,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 2px 10px rgba(245,158,11,0.25)',
              }}
            >
              Choose files
            </button>
            <span style={{ fontSize: 11.5, color: t.textMuted, marginLeft: 'auto' }}>
              PDF, DWG, images, Word, Excel
            </span>
          </div>

          {/* Drag-and-drop area — separate sibling, no nested input */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            style={{
              borderRadius: 12,
              border: '2px dashed ' + (dragOver ? '#F59E0B' : t.border),
              background: dragOver ? 'rgba(245,158,11,0.08)' : 'transparent',
              padding: '18px 18px',
              textAlign: 'center',
              transition: 'background 0.15s, border-color 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            <UploadIcon size={16} color="#F59E0B" />
            <span style={{ fontSize: 13, color: t.textMuted }}>
              …or drag &amp; drop drawings here
            </span>
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
        <div style={{ marginBottom: 18 }}>
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
          {/* Animated multi-coloured gradient border around the textarea */}
          <div style={{
            padding: enhancing ? 3 : 2,
            borderRadius: 12,
            background: 'linear-gradient(120deg, #F59E0B, #EC4899, #8B5CF6, #3B82F6, #10B981, #F59E0B)',
            backgroundSize: '300% 300%',
            animation: enhancing ? 'aiqs-rainbow 3s linear infinite' : 'aiqs-rainbow 12s linear infinite',
          }}>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              disabled={submitting || enhancing}
              rows={6}
              placeholder="Describe your project: rooms, dimensions, materials, specifications, location, anything on the drawings. The more detail you add, the more accurate your BOQ will be."
              style={{
                display: 'block',
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: t.surface, color: t.text,
                border: 'none', fontSize: 14,
                outline: 'none', resize: 'vertical', minHeight: 120,
                fontFamily: 'inherit', lineHeight: 1.6,
                boxSizing: 'border-box',
              }}
            />
          </div>
          {enhanceError && (
            <div style={{
              marginTop: 6, fontSize: 12, color: '#F87171',
            }}>
              {enhanceError}
            </div>
          )}
        </div>

        {/* AI Enhance — prominent, sits above Submit Enquiry */}
        <button
          type="button"
          onClick={enhanceWriting}
          disabled={enhancing || submitting || message.trim().length < 10}
          title="Polish your description with AI — grammar, punctuation and structure only. Adds no new project information."
          style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            width: '100%', padding: '14px 22px', borderRadius: 12,
            background: enhancing
              ? 'linear-gradient(120deg, #4338CA, #7C3AED, #DB2777, #EA580C)'
              : 'linear-gradient(120deg, #6366F1, #8B5CF6, #EC4899, #F59E0B)',
            backgroundSize: enhancing ? '300% 100%' : '200% 100%',
            animation: enhancing ? 'aiqs-rainbow 2.5s linear infinite' : 'none',
            color: '#FFFFFF',
            fontWeight: 700, fontSize: 14.5, border: 'none',
            cursor: (enhancing || submitting || message.trim().length < 10) ? 'not-allowed' : 'pointer',
            opacity: (submitting || message.trim().length < 10) && !enhancing ? 0.45 : 1,
            boxShadow: enhancing
              ? '0 4px 24px rgba(139,92,246,0.35), 0 0 0 1px rgba(255,255,255,0.12) inset'
              : '0 2px 14px rgba(139,92,246,0.25)',
            textShadow: '0 1px 2px rgba(0,0,0,0.2)',
            overflow: 'hidden',
            marginBottom: 12,
            transition: 'box-shadow 0.2s, opacity 0.2s',
          }}
        >
          {enhancing ? (
            <>
              <div style={{
                width: 16, height: 16, borderRadius: '50%',
                border: '2.5px solid rgba(255,255,255,0.3)',
                borderTopColor: '#FFFFFF',
                animation: 'spin 0.6s linear infinite',
                flexShrink: 0,
              }} />
              <span>Polishing your brief…</span>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12.5, fontWeight: 600,
                background: 'rgba(0,0,0,0.25)',
                padding: '3px 9px', borderRadius: 999,
                marginLeft: 4,
              }}>
                {enhanceRemaining > 0
                  ? '~' + enhanceRemaining + 's left'
                  : enhanceElapsed + 's elapsed'}
              </span>
              {/* progress bar */}
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0,
                height: 3, background: 'rgba(0,0,0,0.2)',
              }}>
                <div style={{
                  height: '100%',
                  width: Math.min(100, (enhanceElapsed / ENHANCE_ESTIMATE_S) * 100) + '%',
                  background: '#FFFFFF',
                  transition: 'width 0.25s linear',
                }} />
              </div>
            </>
          ) : (
            <>
              <SparklesIcon size={17} color="#FFFFFF" />
              <span>Enhance my writing with AI</span>
              <span style={{
                fontSize: 11, fontWeight: 600,
                background: 'rgba(255,255,255,0.18)',
                padding: '3px 8px', borderRadius: 999,
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>
                Free
              </span>
            </>
          )}
        </button>

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

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes aiqs-rainbow {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        /* No CSS on the file input — the native browser button is what works in this env. */
      `}</style>
    </div>
  );
}

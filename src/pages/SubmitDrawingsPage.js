import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { withUserRef } from '../utils/stripeLinks';

const BOQ_5_PACK_LINK = 'https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h';
import {
  UploadIcon, XIcon, PaperclipIcon, FileTextIcon, FileImageIcon,
  FileSpreadsheetIcon, FileArchiveIcon, ZapIcon, ArrowRightIcon, SparklesIcon,
} from '../components/Icons';
import TermsTick from '../components/TermsTick';

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
  const { user } = useAuth();
  const [credits, setCredits] = useState(null);
  const [projectType, setProjectType] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [status, setStatus] = useState(null); // { type: 'success'|'error', msg: string }
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState(null);
  const [enhanceElapsed, setEnhanceElapsed] = useState(0);
  const [submitElapsed, setSubmitElapsed] = useState(0);
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  const ENHANCE_ESTIMATE_S = 9; // typical polish-mode latency
  const enhanceRemaining = Math.max(0, ENHANCE_ESTIMATE_S - enhanceElapsed);
  const SUBMIT_ESTIMATE_S = 30;

  useEffect(() => {
    apiFetch('/credits').then(setCredits).catch(() => {});
  }, []);

  const canSubmit = !!projectType && siteAddress.trim().length > 0 && message.trim().length >= MIN_SUBMIT_CHARS && files.length > 0 && termsAccepted && !submitting;
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

  // Tick a submission elapsed timer and warn before unload while submitting,
  // so accidental back/close clicks don't kill an in-flight upload.
  useEffect(() => {
    if (!submitting) return;
    setSubmitElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      setSubmitElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', guard);
    };
  }, [submitting]);

  // Auto-open the top-up modal when the user runs out of credits, and re-open it
  // when their balance hits zero after a successful submission.
  useEffect(() => {
    if (noCredits) setShowTopUpModal(true);
  }, [noCredits]);

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
      setShowTopUpModal(true);
      return;
    }
    if (!projectType) return setStatus({ type: 'error', msg: 'Please select a project type.' });
    if (!siteAddress.trim()) return setStatus({ type: 'error', msg: 'Please enter the site address.' });
    if (message.trim().length < MIN_SUBMIT_CHARS) {
      return setStatus({ type: 'error', msg: 'Please describe your project (min ' + MIN_SUBMIT_CHARS + ' characters).' });
    }
    if (files.length === 0) return setStatus({ type: 'error', msg: 'Please upload at least one drawing or document.' });

    setSubmitting(true);
    setProgressLabel('Uploading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');

    // Step the progress label so the user keeps seeing progress and doesn't
    // assume it's hung. The actual API call drives completion.
    const stepTimers = [
      setTimeout(() => setProgressLabel('Sending to our QS team…'), 4000),
      setTimeout(() => setProgressLabel('Almost there — finalising your submission…'), 12000),
      setTimeout(() => setProgressLabel('Just a moment, large files take a little longer…'), 25000),
    ];

    try {
      const fd = new FormData();
      fd.append('project_type', projectType);
      fd.append('site_address', siteAddress.trim());
      fd.append('message', message.trim());
      fd.append('terms_accepted', 'true');
      for (const f of files) fd.append('files', f, f.name);

      const data = await apiFetch('/submissions', { method: 'POST', body: fd });
      stepTimers.forEach(clearTimeout);

      setStatus({
        type: 'success',
        msg: "Submitted! Your BOQ and Findings Report will be delivered to My Projects, typically within 24 hours. Once it arrives you can amend the numbers and produce a Client Copy with your own logo and colours. Submission ID: " + data.submission_id,
      });
      setProjectType('');
      setMessage('');
      setFiles([]);
      setCredits(c => c ? { ...c, free_credits: data.credits_remaining, can_submit: data.credits_remaining > 0 } : c);
    } catch (err) {
      stepTimers.forEach(clearTimeout);
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

      {/* What happens next — sets the expectation that everything comes back here */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap',
      }}>
        {[
          ['1', 'You submit', 'Drawings go straight to our QS team — no email chains needed.'],
          ['2', 'Delivered to your portal', 'Your BOQ and Findings Report arrive under My Projects, typically within 24 hours.'],
          ['3', 'Make it yours', 'Amend the numbers and produce a Client Copy with your own logo and colour scheme, ready to send on.'],
        ].map(([n, title, desc]) => (
          <div key={n} style={{
            flex: '1 1 220px', display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '12px 14px', borderRadius: 12,
            background: t.card, border: '1px solid ' + t.border,
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(245,158,11,0.12)', color: '#F59E0B',
              fontSize: 11.5, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{n}</div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, marginBottom: 2 }}>{title}</div>
              <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5 }}>{desc}</div>
            </div>
          </div>
        ))}
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

        {/* Site Address */}
        <label style={{ display: 'block', marginBottom: 18 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, marginBottom: 6, letterSpacing: '0.02em' }}>
            Site Address <span style={{ color: '#F59E0B' }}>*</span>
          </div>
          <input
            type="text"
            value={siteAddress}
            onChange={e => setSiteAddress(e.target.value)}
            disabled={submitting}
            placeholder="e.g. 14 Mill Lane, Harrogate, HG1 2AB"
            style={{
              width: '100%', padding: '11px 14px', borderRadius: 9,
              background: t.surface, color: t.text,
              border: '1px solid ' + t.border, fontSize: 14,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
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

        <TermsTick checked={termsAccepted} onChange={setTermsAccepted} />

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

      {/* Blocking submission overlay — keeps the user on the page during the upload
          so they can't accidentally click back, and gives them lots of feedback. */}
      {submitting && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(10,15,28,0.55)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: t.card, border: '1px solid ' + t.border,
            borderRadius: 16, padding: '28px 28px 22px',
            width: '100%', maxWidth: 460,
            boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
            textAlign: 'center',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(236,72,153,0.18))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '3px solid rgba(245,158,11,0.25)',
                borderTopColor: '#F59E0B',
                animation: 'spin 0.7s linear infinite',
              }} />
            </div>
            <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 22, fontWeight: 700, color: t.text, marginBottom: 6 }}>
              Submitting your drawings
            </div>
            <div style={{ fontSize: 13.5, color: t.textMuted, marginBottom: 18, lineHeight: 1.55 }}>
              {progressLabel || 'Uploading…'}
            </div>
            <div style={{
              width: '100%', height: 6, borderRadius: 6, background: t.surface, overflow: 'hidden',
              marginBottom: 10,
            }}>
              <div style={{
                height: '100%', borderRadius: 6,
                width: Math.min(95, (submitElapsed / SUBMIT_ESTIMATE_S) * 95) + '%',
                background: 'linear-gradient(90deg, #F59E0B, #EC4899, #8B5CF6, #3B82F6)',
                transition: 'width 0.25s linear',
              }} />
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
              {submitElapsed}s elapsed · please don't close this tab
            </div>
          </div>
        </div>
      )}

      {/* Sticky 'buy 5 BOQs' offer — shown automatically on no credits, dismissible
          but always reachable via the floating button at bottom-right. */}
      {showTopUpModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(10,15,28,0.55)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            position: 'relative',
            background: t.card, border: '1px solid ' + t.border,
            borderRadius: 18, padding: '32px 30px 26px',
            width: '100%', maxWidth: 480,
            boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          }}>
            <button
              type="button"
              onClick={() => setShowTopUpModal(false)}
              aria-label="Close"
              style={{
                position: 'absolute', top: 12, right: 12,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 6, borderRadius: 7, color: t.textMuted,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <XIcon size={16} color={t.textMuted} />
            </button>

            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 11px', borderRadius: 999,
              background: 'rgba(245,158,11,0.1)', color: '#F59E0B',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              marginBottom: 14,
            }}>
              <ZapIcon size={11} color="#F59E0B" /> One-off top-up
            </div>

            <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 26, fontWeight: 700, color: t.text, lineHeight: 1.2, marginBottom: 8 }}>
              Need more BOQs?
            </div>
            <div style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.55, marginBottom: 18 }}>
              You're out of BOQ credits. Top up with a one-off pack — no subscription, no commitment.
            </div>

            <div style={{
              padding: '18px 18px 16px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
              border: '1px solid rgba(245,158,11,0.25)',
              marginBottom: 18,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.text }}>
                  5 BOQ pack
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#F59E0B', fontFamily: "'DM Serif Display', Georgia, serif" }}>
                  £349
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 4 }}>
                That's just <strong style={{ color: t.text }}>£69.80 per BOQ</strong> — saves you £146 vs. PAYG.
              </div>
              <div style={{ fontSize: 12, color: t.textMuted }}>
                Credits never expire. Use them whenever you like.
              </div>
            </div>

            <a
              href={withUserRef(BOQ_5_PACK_LINK, user)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '13px 22px', borderRadius: 11,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C',
                fontWeight: 700, fontSize: 14.5,
                textDecoration: 'none',
                boxShadow: '0 4px 18px rgba(245,158,11,0.35)',
              }}
            >
              <ZapIcon size={15} color="#0A0F1C" />
              Buy 5 BOQs — £349
              <ArrowRightIcon size={15} color="#0A0F1C" />
            </a>

            <button
              type="button"
              onClick={() => setShowTopUpModal(false)}
              style={{
                marginTop: 10, width: '100%', padding: '9px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: t.textMuted,
              }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* Persistent floating offer — always reachable when credits are out */}
      {noCredits && !showTopUpModal && !submitting && (
        <button
          type="button"
          onClick={() => setShowTopUpModal(true)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9990,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 18px', borderRadius: 999,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            color: '#0A0F1C',
            fontWeight: 700, fontSize: 13.5,
            border: 'none', cursor: 'pointer',
            boxShadow: '0 6px 24px rgba(245,158,11,0.45)',
            animation: 'aiqs-pulse 2.4s ease-in-out infinite',
          }}
        >
          <ZapIcon size={14} color="#0A0F1C" />
          Buy 5 BOQs — £349
        </button>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes aiqs-rainbow {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes aiqs-pulse {
          0%, 100% { box-shadow: 0 6px 24px rgba(245,158,11,0.45); transform: scale(1); }
          50%      { box-shadow: 0 8px 32px rgba(245,158,11,0.7);  transform: scale(1.04); }
        }

        /* No CSS on the file input — the native browser button is what works in this env. */
      `}</style>
    </div>
  );
}

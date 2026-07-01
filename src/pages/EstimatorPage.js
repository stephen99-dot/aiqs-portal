import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import ShareLinkModal from '../components/ShareLinkModal';
import { FileTextIcon } from '../components/Icons';
import HelpTip from '../components/HelpTip';

// All quotes — reached from Jobs ("All quotes"). Cards, not a table: the
// customer is the headline, "Quote · 20 May" the subtitle, the reference in
// small print for paperwork. Most quote work happens on the job page; this
// is the full list for anything not tied to a job yet.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt0(n) { return '£' + Math.round(num(n)).toLocaleString('en-GB'); }
function shortDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return iso; }
}

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', won: 'Won', lost: 'Lost' };

function statusColour(s, t) {
  switch (s) {
    case 'won':
    case 'accepted': return { bg: t.successBg, fg: t.success };
    case 'lost':  return { bg: t.dangerBg,  fg: t.danger };
    case 'sent':  return { bg: t.warningBg, fg: t.warning };
    default:      return { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  }
}

export default function EstimatorPage() {
  return <EstimatorGate><EstimatorPageInner /></EstimatorGate>;
}

function EstimatorPageInner() {
  const { t } = useTheme();
  const nav = useNavigate();

  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [share, setShare] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [pdfId, setPdfId] = useState(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const q = await apiFetch('/estimator/quotes');
      setQuotes(q.quotes || []);
    } catch (e) {
      setError(e.message || 'Failed to load quotes');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const handleSend = async (id) => {
    if (sendingId) return;
    setSendingId(id);
    setError('');
    try {
      const r = await apiFetch('/estimator/quotes/' + id + '/send', { method: 'POST' });
      setShare({ url: window.location.origin + r.path });
      refresh();
    } catch (e) {
      setError(e.message || "Couldn't send the quote — please try again.");
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (id, name) => {
    if (deletingId) return;
    if (!window.confirm('Delete the quote for "' + (name || 'this job') + '"? This cannot be undone.')) return;
    setDeletingId(id);
    setError('');
    try {
      await apiFetch('/estimator/quotes/' + id, { method: 'DELETE' });
      refresh();
    } catch (e) {
      setError(e.message || "Couldn't delete the quote — please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const downloadPdf = (id) => {
    if (pdfId) return;
    setPdfId(id);
    setError('');
    fetch('/api/estimator/quotes/' + id + '/pdf', { headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() } })
      .then(r => {
        if (r.status === 401) {
          window.location.href = '/login';
          throw new Error('Session expired');
        }
        if (!r.ok) throw new Error('Download failed');
        return r.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'quote.pdf';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      })
      .catch(e => { setError(e.message || "Couldn't download the PDF — please try again."); })
      .finally(() => { setPdfId(null); });
  };

  const ghostBtn = {
    minHeight: 40, padding: '0 12px', borderRadius: 10, cursor: 'pointer',
    background: 'transparent', color: t.text, border: '1px solid ' + t.border,
    fontSize: 13, fontWeight: 600,
  };

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <button onClick={() => nav('/jobs')} style={{ background: 'transparent', color: t.textSecondary, border: 'none', padding: '0 0 8px', fontSize: 13, cursor: 'pointer' }}>← Jobs</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Office in a Box</div>
          <h1 style={{ margin: 0, fontSize: 26, color: t.text }}>All quotes <HelpTip t={t} title="All quotes" text={"Every quote you've made, newest first.\n\nDay to day you'll mostly work from the job page — this list catches anything not tied to a job yet.\n\n'Send the quote' gives you a link your client opens on their phone, where they can accept it with a typed signature."} /></h1>
        </div>
        <button
          onClick={() => nav('/estimator/new')}
          style={{
            background: t.accent, color: '#fff', border: 'none', borderRadius: 10,
            minHeight: 48, padding: '0 18px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}
        >+ New quote</button>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ color: t.textSecondary, padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : quotes.length === 0 ? (
        <div style={{
          background: t.card, border: '1px dashed ' + t.border, borderRadius: 12,
          padding: 36, textAlign: 'center', color: t.textSecondary,
        }}>
          <div style={{ marginBottom: 8 }}><FileTextIcon size={28} /></div>
          <div style={{ color: t.text, fontWeight: 700, marginBottom: 6 }}>No quotes yet</div>
          <div style={{ marginBottom: 16 }}>Describe the job and we'll draft a priced quote in seconds.</div>
          <button
            onClick={() => nav('/estimator/new')}
            style={{ background: t.accent, color: '#fff', border: 'none', borderRadius: 10, minHeight: 48, padding: '0 22px', fontWeight: 700, cursor: 'pointer' }}
          >Make your first quote</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {quotes.map(q => {
            const sc = statusColour(q.status, t);
            return (
              <div key={q.id} style={{ background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <button onClick={() => nav('/estimator/quote/' + q.id)} style={{ background: 'none', border: 'none', padding: 0, color: t.text, fontWeight: 700, fontSize: 16, cursor: 'pointer', textAlign: 'left' }}>
                      {q.client_name || q.project_name || 'Quote'}
                    </button>
                    <div style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2 }}>
                      Quote · {shortDate(q.created_at)}{q.client_name && q.project_name ? ' · ' + q.project_name : ''}{q.quote_number ? ' · ' + q.quote_number : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{fmt0(q.grand_total)}</div>
                    <span style={{ background: sc.bg, color: sc.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                      {STATUS_LABELS[q.status] || 'Draft'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => nav('/estimator/quote/' + q.id)} style={ghostBtn}>Open</button>
                  {q.status !== 'accepted' && (
                    <button onClick={() => handleSend(q.id)} disabled={sendingId === q.id} style={{ ...ghostBtn, color: t.accent, borderColor: t.accent + '66', opacity: sendingId === q.id ? 0.6 : 1, cursor: sendingId === q.id ? 'default' : 'pointer' }}>
                      {sendingId === q.id ? 'Sending…' : (q.public_token ? 'Share the link' : 'Send the quote')}
                    </button>
                  )}
                  <button onClick={() => downloadPdf(q.id)} disabled={pdfId === q.id} style={{ ...ghostBtn, opacity: pdfId === q.id ? 0.6 : 1, cursor: pdfId === q.id ? 'default' : 'pointer' }}>{pdfId === q.id ? 'Downloading…' : 'PDF'}</button>
                  {q.status !== 'accepted' && (
                    <button onClick={() => handleDelete(q.id, q.project_name)} disabled={deletingId === q.id} style={{ ...ghostBtn, color: t.danger, opacity: deletingId === q.id ? 0.6 : 1, cursor: deletingId === q.id ? 'default' : 'pointer' }}>{deletingId === q.id ? 'Deleting…' : 'Delete'}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {share && (
        <ShareLinkModal
          t={t}
          url={share.url}
          title="Send the quote to your client"
          message="Here’s your quote — you can view and accept it here:"
          onClose={() => setShare(null)}
        />
      )}
    </div>
  );
}

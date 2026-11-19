import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/api';
import { openMax, fmtMoney0 } from '../../utils/max';
import MaxCharacter from './MaxCharacter';
import MaxUpsell from './MaxUpsell';
import { MicIcon, ArrowRightIcon, CameraIcon } from '../Icons';

// ═══ Ask MAX — the box at the top of the dashboard ══════════════════════════
// Type a job and press go (or tap the mic) and the MAX panel opens with it
// already sent. The chips are the page's stock suggestions from the server.

const FALLBACK_CHIPS = [
  'Price a 20 m² patio using my usual rates, taking up the old slabs',
  'Where are my drawings jobs up to?',
  'What\'s my rate for plasterboard and skim?',
];

export default function AskMaxBox() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [chips, setChips] = useState(FALLBACK_CHIPS);
  const limits = user && user.maxLimits;

  useEffect(() => {
    let gone = false;
    apiFetch('/max/suggestions?path=/dashboard').then((r) => { if (!gone && r && Array.isArray(r.suggestions) && r.suggestions.length) setChips(r.suggestions.slice(0, 3)); }).catch(() => {});
    return () => { gone = true; };
  }, []);

  if (!user) return null;
  // Without MAX the box is the package itself: what it is and where to get it
  // (and, inside the app, nothing — see MaxUpsell).
  if (!user.maxEnabled) return user.role === 'admin' ? null : <MaxUpsell variant="max" />;

  const go = (e) => {
    if (e) e.preventDefault();
    const t = text.trim();
    if (!t) { openMax({ open: true, keyboard: true }); return; }
    openMax({ prompt: t, send: true });
    setText('');
  };

  return (
    <form className="askmax" onSubmit={go} data-tour="ask-max">
      <div className="askmax__head">
        <MaxCharacter size={44} />
        <div style={{ minWidth: 0 }}>
          <h2 className="askmax__title">Ask MAX</h2>
          <p className="askmax__sub">Describe a small job and MAX prices it from your rates — or ask about your jobs, rates and files.</p>
        </div>
      </div>
      <div className="askmax__row">
        <input className="askmax__input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Price a 20 m² patio, taking up the old slabs…" aria-label="Ask MAX" />
        <button type="button" className="askmax__btn" onClick={() => openMax({ open: true, voice: true })} aria-label="Talk to MAX" title="Talk to MAX"><MicIcon size={18} /></button>
        <button type="submit" className="askmax__btn askmax__btn--go" aria-label="Ask MAX"><span>Ask MAX</span><ArrowRightIcon size={16} /></button>
      </div>
      <div className="askmax__chips">
        {chips.map((c) => <button key={c} type="button" className="max-chip" onClick={() => openMax({ prompt: c, send: true })}>{c}</button>)}
        <Link to="/surveys?new=1" className="max-chip" style={{ textDecoration: 'none', borderColor: 'var(--border-accent)' }}><CameraIcon size={14} /> Scan a room</Link>
      </div>
      {limits && <div className="askmax__limit">Small jobs up to {fmtMoney0(limits.limitGbp)} ex VAT. Bigger jobs go to the AI QS team for a full take-off.</div>}
    </form>
  );
}

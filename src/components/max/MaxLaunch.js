import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canShowPurchases } from '../../utils/purchases';
import { openMax } from '../../utils/max';
import MaxCharacter from './MaxCharacter';
import RoomPlanSketch from '../survey/RoomPlanSketch';
import { IconButton } from '../../ui';
import { SparklesIcon, CameraIcon, ScanIcon, MicIcon, PoundIcon, FileTextIcon, ImageIcon, ArrowRightIcon, CheckIcon } from '../Icons';

// ═══ MAX has arrived — the launch showcase ═══════════════════════════════════
// Shown once per account on the website (and in the app) the first time a
// client signs in after the MAX packages went live: four short pages on what
// MAX does — pricing small jobs, Scan a room with LiDAR, the finished-room
// Visualiser, talking to MAX — ending on the plans. Dismissing it, on any
// page, is remembered per account. `?launch=1` on any address opens it
// again, for a look or a screenshot.
//
// Prices and the "See the plans" button appear only where things can be
// sold (utils/purchases.js): inside the iOS app the last page says what the
// packages contain and no more, per App Store rule 3.1.1.

export const LAUNCH_VERSION = 1;
const keyFor = (uid) => 'aiqs_max_launch_v' + LAUNCH_VERSION + '_' + (uid || 'default');

const SAMPLE_ROOM = { name: 'Kitchen', shape: 'l_shape', length_m: 5.2, width_m: 3.6, notch_length_m: 2.1, notch_width_m: 1.4, openings: [{ kind: 'door', width_m: 0.84, height_m: 2, wall: 'C' }, { kind: 'window', width_m: 1.5, height_m: 1.2, wall: 'A' }, { kind: 'window', width_m: 0.9, height_m: 1.2, wall: 'B' }] };

function EstimateMock() {
  return (
    <div className="mxl-est" aria-hidden="true">
      <div className="mxl-est__ask"><span className="mxl-est__mic"><MicIcon size={12} color="#fff" /></span>"Price a 20 m² patio, taking up the old slabs"</div>
      <div className="mxl-est__card">
        <div className="mxl-est__head"><span>Patio — 20 m²</span><span className="mxl-est__tag">From your rates</span></div>
        {[['Take up and cart away old slabs', '20 m²', '£260'], ['Excavate and MOT sub-base, 150 mm', '20 m²', '£540'], ['Lay 600 × 600 porcelain on mortar bed', '20 m²', '£1,380'], ['Point and clean down', '20 m²', '£160']].map(([d, q, p]) => (
          <div key={d} className="mxl-est__row"><span>{d}</span><span className="mxl-est__q">{q}</span><b>{p}</b></div>
        ))}
        <div className="mxl-est__total"><span>Total ex VAT</span><b>£2,340</b></div>
      </div>
    </div>
  );
}

// A bathroom wall, before and after: the same drawing twice, the "after" one
// wiped across by an animation so the change reads without a word.
function Bathroom({ done }) {
  const tile = done ? '#EEF1EA' : '#C9CDD1';
  const grout = done ? '#D7DCD2' : '#AEB3B8';
  const tiles = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) tiles.push(<rect key={r + '-' + c} x={10 + c * 32} y={10 + r * 22} width={30} height={20} rx={done ? 1 : 0} fill={tile} stroke={grout} strokeWidth={1} />);
  return (
    <svg viewBox="0 0 300 200" className="mxl-ba__svg" aria-hidden="true">
      <rect x="0" y="0" width="300" height="200" fill={done ? '#F6F3EC' : '#DDD8CF'} />
      {tiles}
      {!done && <><path d="M60 40 l18 26 l-10 14" stroke="#8F959B" strokeWidth="1.5" fill="none" /><rect x="150" y="60" width="60" height="24" fill="#B9BDC1" opacity="0.7" /><circle cx="236" cy="52" r="9" fill="#A5A9AD" /></>}
      <rect x="20" y="120" width="260" height="56" rx="10" fill={done ? '#FFFFFF' : '#E4E1DA'} stroke={done ? '#C9CFC4' : '#B8B3A9'} strokeWidth="2" />
      <rect x="20" y="176" width="260" height="14" fill={done ? '#DADFD3' : '#B7B2A8'} />
      <rect x="228" y="92" width="6" height="30" rx="3" fill={done ? '#7A8C7E' : '#8E8A82'} />
      <rect x="214" y="104" width="34" height="5" rx="2" fill={done ? '#7A8C7E' : '#8E8A82'} />
      {done && <>
        <rect x="246" y="126" width="22" height="34" rx="3" fill="#D8B48C" />
        <path d="M44 118 c-6 -22 6 -34 14 -40 c2 14 10 18 8 40 z" fill="#6B9A6E" />
        <path d="M58 118 c0 -20 12 -26 20 -30 c-2 14 -2 22 -8 30 z" fill="#8DBA86" />
        <rect x="36" y="118" width="40" height="8" rx="2" fill="#B98A62" />
        <rect x="120" y="128" width="60" height="10" rx="2" fill="#B7C9D6" />
      </>}
      <rect x="0" y="190" width="300" height="10" fill={done ? '#C9CFC4' : '#9D9A92'} />
    </svg>
  );
}

function BeforeAfterMock() {
  return (
    <div className="mxl-ba" aria-hidden="true">
      <Bathroom done={false} />
      <div className="mxl-ba__after"><Bathroom done /></div>
      <div className="mxl-ba__bar" />
      <span className="mxl-ba__tag mxl-ba__tag--before">Now</span>
      <span className="mxl-ba__tag mxl-ba__tag--after">Done</span>
    </div>
  );
}

const SLIDES = [
  {
    key: 'max', kicker: 'New in AI QS', title: 'Meet MAX, your AI estimator',
    body: 'Say what the job is and MAX prices it in minutes, from your own rates. Every quantity, rate and assumption is shown, and the estimate is yours to edit and send.',
    points: [[PoundIcon, 'Small jobs priced from your rates'], [FileTextIcon, 'An editable estimate, sent as a quote'], [SparklesIcon, 'Bigger jobs go to the AI QS team']],
    art: <EstimateMock />,
  },
  {
    key: 'scan', kicker: 'On site', title: 'Scan a room',
    body: 'Walk the room with your phone. Photos, sizes, doors and windows, finishes and notes are kept per room, the quantities are worked out, and MAX prices it.',
    points: [[CameraIcon, 'Two photos from opposite corners'], [ScanIcon, 'LiDAR on iPhone Pro: the plan draws itself'], [FileTextIcon, 'A branded survey report and Excel schedule']],
    art: <div className="mxl-plan"><RoomPlanSketch room={SAMPLE_ROOM} width={280} height={190} /></div>,
  },
  {
    key: 'vis', kicker: 'The Visualiser', title: 'Show the customer the finished room',
    body: 'Take a photo, say what they want, and MAX paints it in: new tiles, a new bath, the walls done. The before and after goes in the report.',
    points: [[ImageIcon, 'Painted onto your own photo'], [SparklesIcon, 'Before and after, in the app and the PDF'], [CheckIcon, 'Marked as an AI concept, not to scale']],
    art: <BeforeAfterMock />,
  },
  {
    key: 'plans', kicker: 'Talk to MAX', title: 'Say it, don\'t type it',
    body: 'Dictate the job or a site note with the mic, in the app or on the web. MAX answers in writing, so nothing is lost on a noisy site.',
    points: [[MicIcon, 'Your phone\'s own speech recognition'], [SparklesIcon, 'Everything MAX does, from your voice']],
    art: null,
  },
];

export default function MaxLaunch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const sell = canShowPurchases();
  const forced = /[?&]launch=1/.test(location.search);

  useEffect(() => {
    if (!user) return;
    if (forced) { setOpen(true); setStep(0); return; }
    if (user.role === 'admin') return;
    if (['/onboarding', '/upgrade', '/payment-success', '/login', '/register'].some((p) => location.pathname.startsWith(p))) return;
    try { if (!localStorage.getItem(keyFor(user.id))) setOpen(true); } catch (e) { /* storage blocked: show nothing rather than every time */ }
  }, [user, forced, location.pathname]);

  const close = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(keyFor(user && user.id), 'true'); } catch (e) { /* fine */ }
  }, [user]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, close]);

  if (!open || !user) return null;
  const s = SLIDES[step];
  const last = step === SLIDES.length - 1;
  const hasMax = !!user.maxEnabled;
  const finish = () => {
    close();
    if (hasMax) openMax({ open: true });
    else if (sell) navigate('/upgrade');
  };

  return (
    <div className="ui-modal-overlay" onClick={close}>
      <div className="ui-modal mxl" style={{ maxWidth: 760 }} role="dialog" aria-modal="true" aria-label="What MAX can do" onClick={(e) => e.stopPropagation()}>
        <div className="mxl__hero">
          <MaxCharacter size={64} className="mxl__max" />
          <div className="mxl__hero-text">
            <div className="mxl__kicker">{s.kicker}</div>
            <h2 className="mxl__title">{s.title}</h2>
          </div>
          <IconButton onClick={close} aria-label="Close" className="mxl__close">✕</IconButton>
        </div>
        <div className={'mxl__body' + (s.art ? '' : ' mxl__body--text')} key={s.key}>
          <div className="mxl__copy">
            <p className="mxl__p">{s.body}</p>
            <ul className="mxl__points">
              {s.points.map(([Icon, text]) => <li key={text}><span className="mxl__pt"><Icon size={13} color="var(--accent)" /></span>{text}</li>)}
            </ul>
            {last && (
              <div className="mxl__plans">
                {hasMax ? (
                  <div className="mxl__plan-note"><CheckIcon size={14} color="var(--success)" /> MAX is already on for your account. Open it from the menu or the button at the bottom right.</div>
                ) : sell ? (
                  <>
                    <div className="mxl__plan-row"><span className="mxl__plan-name">AI QS MAX</span><span className="mxl__plan-price">£59<small>/month</small></span></div>
                    <div className="mxl__plan-row"><span className="mxl__plan-name">AI QS MAX + Visualiser</span><span className="mxl__plan-price">£79<small>/month</small></span></div>
                    <div className="mxl__plan-foot">Two months free paid yearly. Cancel any time.</div>
                  </>
                ) : (
                  <div className="mxl__plan-note">MAX, Scan a room and the Visualiser are part of the AI QS MAX packages. They switch on here as soon as a package is on your account.</div>
                )}
              </div>
            )}
          </div>
          {s.art && <div className="mxl__art">{s.art}</div>}
        </div>
        <div className="mxl__foot">
          <div className="mxl__dots" role="tablist" aria-label="Pages">
            {SLIDES.map((x, i) => <button key={x.key} type="button" role="tab" aria-selected={i === step} className={'mxl__dot' + (i === step ? ' mxl__dot--on' : '')} onClick={() => setStep(i)} aria-label={'Page ' + (i + 1)} />)}
          </div>
          <div className="mxl__btns">
            {step > 0 ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--md" onClick={() => setStep(step - 1)}>Back</button> : <button type="button" className="ui-btn ui-btn--ghost ui-btn--md" onClick={close}>Not now</button>}
            {last
              ? <button type="button" className="ui-btn ui-btn--primary ui-btn--md" onClick={finish}>{hasMax ? 'Ask MAX' : sell ? 'See the plans' : 'Got it'}{(hasMax || sell) && <ArrowRightIcon size={15} />}</button>
              : <button type="button" className="ui-btn ui-btn--primary ui-btn--md" onClick={() => setStep(step + 1)}>Next <ArrowRightIcon size={15} /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import useMaxVoice from '../hooks/useMaxVoice';
import { lidarStatus } from '../native/roomScan';
import { canShowPurchases } from '../utils/purchases';
import { fmtMoney2 } from '../utils/max';
import { Button, Input, Field, PageHeader, useToast } from '../ui';
import MaxUpsell from '../components/max/MaxUpsell';
import { ROOM_TYPES } from '../utils/surveyGeometry';
import { MicIcon, MicOffIcon, ArrowRightIcon, ArrowLeftIcon, ScanIcon, ImageIcon, PoundIcon, CheckIcon, UploadIcon, CameraIcon, LayersIcon, AlertTriangleIcon } from '../components/Icons';

// ═══ New job — three questions, then the work starts ═════════════════════════
// Where is it, what needs done, and do you want the rooms drawn up — with the
// Visualiser when the package has it? Nothing is saved until the last answer,
// so going back costs nothing. The answers become the job (a survey) with its
// brief, then either the first room's capture page or a MAX estimate.

const STEPS = [['where', 'Where'], ['what', "What's needed"], ['plans', 'Plans']];
const JOB_IDEAS = [
  'Full bathroom refit: strip out, new suite, tile the floor and walls',
  'Skim the walls and ceiling, two coats throughout, new skirting',
  'Rear patio in porcelain, taking up the old slabs',
  'Rip out the kitchen, fit the new units, tile the splashback',
  'Replace the windows with uPVC and make good',
];
const FIRST_ROOMS = ['Kitchen', 'Bathroom', 'Living room', 'Bedroom', 'Hallway', 'En-suite', 'Office', 'Loft'];
const PRICING_LINES = ['Reading what needs done…', 'Taking off the quantities…', 'Pricing every line from your rates…', 'Adding your margins and VAT…'];

export default function NewJobPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('where');
  const [address, setAddress] = useState('');
  const [customer, setCustomer] = useState('');
  const [brief, setBrief] = useState('');
  const [choice, setChoice] = useState(null);     // 'plans_vis' | 'plans' | 'price'
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(null);         // { title, line }
  const [result, setResult] = useState(null);     // an over-limit card or a failure, with the job to open
  const [lidar, setLidar] = useState({ available: false, reason: '' });
  const briefRef = useRef(null);
  const voice = useMaxVoice({ onFinal: (t) => setBrief((b) => (b.trim() ? b.trim() + ' ' + t : t)), onError: (m) => toast.error(m) });

  useEffect(() => { lidarStatus().then(setLidar).catch(() => {}); }, []);
  useEffect(() => { if (step === 'what' && briefRef.current) briefRef.current.focus(); }, [step]);
  // The support bubble would sit on the pinned bar on a phone (styles.css hides it for this class).
  useEffect(() => { document.body.classList.add('sr-capturing'); return () => document.body.classList.remove('sr-capturing'); }, []);

  const visualiser = !!(user && user.visualiserEnabled);
  useEffect(() => { if (choice === null) setChoice(visualiser ? 'plans_vis' : 'plans'); }, [visualiser, choice]);

  if (!user) return null;
  if (!user.maxEnabled) {
    return (
      <div className="page nj">
        <PageHeader title="New job" subtitle="Say where it is and what needs done, draw up the rooms if you want to, and MAX prices it from your rates." />
        <MaxUpsell variant="max" />
      </div>
    );
  }

  const wantsPlans = choice === 'plans' || choice === 'plans_vis';
  const stepIdx = STEPS.findIndex(([k]) => k === step);
  const options = [
    visualiser ? { key: 'plans_vis', Icon: ImageIcon, badge: 'Visualiser', title: 'Draw up the rooms and show the finished room', sub: 'Scan or measure each room, then the Visualiser paints what the customer wants onto your photo of it — before and after, in the app and in the report.' } : null,
    { key: 'plans', Icon: LayersIcon, title: visualiser ? 'Draw up the rooms' : 'Yes — draw up the rooms', sub: 'Scan with LiDAR or type the sizes. The plan draws itself, the quantities come off it, and MAX prices from those.' },
    { key: 'price', Icon: PoundIcon, title: 'No plans — price it now', sub: 'MAX prices the job from what you\'ve said, using your rates. You can add rooms to it later.' },
  ].filter(Boolean);

  const createJob = () => apiFetch('/surveys', { method: 'POST', body: JSON.stringify({ title: address.trim(), address: address.trim(), customer_name: customer.trim(), brief: brief.trim(), visualise: choice === 'plans_vis' ? 1 : 0 }) });

  // Plans: the job, its first room (the brief already in as the work wanted),
  // then straight into the capture flow.
  const startRooms = async () => {
    const name = room.trim() || 'Room 1';
    setBusy({ title: 'Starting the job', line: 'Setting up ' + name + '…' });
    try {
      const s = await createJob();
      const r = await apiFetch('/surveys/' + s.id + '/rooms', { method: 'POST', body: JSON.stringify({ name, room_type: ROOM_TYPES.includes(name) ? name : '', work_wanted: brief.trim() }) });
      navigate('/surveys/' + s.id + '/rooms/' + r.room.id, { replace: true });
    } catch (e) { setBusy(null); toast.error(e.message || 'Could not start the job.'); }
  };
  // No plans: the job, then MAX prices the brief and lands on the estimate.
  const priceNow = async () => {
    let n = 0;
    setBusy({ title: 'MAX is pricing the job', line: PRICING_LINES[0] });
    const tick = setInterval(() => { n = (n + 1) % PRICING_LINES.length; setBusy((b) => (b ? { ...b, line: PRICING_LINES[n] } : b)); }, 2600);
    let s = null;
    try {
      s = await createJob();
      const r = await apiFetch('/surveys/' + s.id + '/price', { method: 'POST', body: JSON.stringify({}) });
      const res = r.result || {};
      if (res.estimate_created && res.estimate_id) {
        toast.success('Priced at ' + fmtMoney2(res.price_ex_vat) + ' ex VAT — every line is yours to edit');
        navigate('/estimates/' + res.estimate_id, { replace: true });
        return;
      }
      setResult({ ...res, card: (r.cards && r.cards[0]) || null, survey: s });
    } catch (e) { setResult({ error: e.message || 'MAX could not price it just now.', survey: s }); }
    finally { clearInterval(tick); setBusy(null); }
  };

  return (
    <div className="page nj">
      <div className="nj__head">
        <Link to="/surveys" className="nj__back"><ArrowLeftIcon size={13} /> Jobs</Link>
        <ol className="nj__steps">
          {STEPS.map(([k, l], i) => <li key={k} className={'nj__step' + (i === stepIdx ? ' nj__step--on' : i < stepIdx ? ' nj__step--done' : '')}><i>{i < stepIdx ? <CheckIcon size={11} color="currentColor" /> : i + 1}</i>{l}</li>)}
        </ol>
      </div>

      {step === 'where' && (
        <section className="nj__card">
          <h1 className="nj__q">Where's the job?</h1>
          <p className="nj__sub">The address — or a name for it if you don't have the address yet.</p>
          <Field label="Address or job name"><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 Hill Street, Leeds" autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && address.trim()) { e.preventDefault(); setStep('what'); } }} /></Field>
          <Field label="Customer" hint="Optional — it goes on the estimate and the report"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Mrs Patel" /></Field>
          <div className="nj__bar nj__bar--end"><Button onClick={() => setStep('what')} disabled={!address.trim()}>Next <ArrowRightIcon size={14} color="currentColor" /></Button></div>
        </section>
      )}

      {step === 'what' && (
        <section className="nj__card">
          <h1 className="nj__q">What needs done?</h1>
          <p className="nj__sub">Say it like you'd say it to a mate — the rooms, the work, anything that affects the price. This is what MAX prices, from your rates.</p>
          <div className="sr-compose" style={{ gridTemplateColumns: '1fr auto' }}>
            <textarea ref={briefRef} className="ui-textarea nj__brief" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Strip the bathroom back, new suite, tile the floor and walls to the ceiling, two coats to the ceiling." />
            {voice.supported && <button type="button" className={'sr-mic' + (voice.listening ? ' sr-mic--on' : '') + (voice.transcribing ? ' sr-mic--busy' : '')} onClick={() => (voice.listening ? voice.stopListening() : voice.startListening())} aria-label="Say what needs done" title="Say it">{voice.listening ? <MicOffIcon size={18} /> : <MicIcon size={18} />}</button>}
          </div>
          {voice.listening && <div className="sr-interim">{voice.interim || 'Listening…'}</div>}
          {voice.transcribing && <div className="sr-interim">Writing that down…</div>}
          <div className="nj__ideas">
            <span>Or start from one of these</span>
            <div className="sr-chips">{JOB_IDEAS.map((t) => <button key={t} type="button" className="sr-chip" onClick={() => { setBrief((b) => (b.trim() ? b.trim() + '\n' + t : t)); if (briefRef.current) briefRef.current.focus(); }}>{t}</button>)}</div>
          </div>
          <div className="nj__bar">
            <Button variant="secondary" onClick={() => setStep('where')}><ArrowLeftIcon size={14} color="currentColor" /> Back</Button>
            <Button onClick={() => setStep('plans')} disabled={brief.trim().length < 8}>Next <ArrowRightIcon size={14} color="currentColor" /></Button>
          </div>
        </section>
      )}

      {step === 'plans' && (
        <section className="nj__card">
          <h1 className="nj__q">Draw up the floor plans?</h1>
          <p className="nj__sub">{visualiser ? 'Scan or measure each room and MAX prices from the real quantities — and the Visualiser can show the customer the finished room. Or skip the plans and price from what you\'ve said.' : 'Scan or measure each room and MAX prices from the real quantities. Or skip the plans and price from what you\'ve said.'}</p>
          <div className="nj-opts" role="radiogroup" aria-label="Floor plans">
            {options.map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={choice === o.key} className={'nj-opt' + (choice === o.key ? ' nj-opt--on' : '')} onClick={() => { setChoice(o.key); setResult(null); }}>
                <span className="nj-opt__ic"><o.Icon size={22} /></span>
                <span className="nj-opt__body"><span className="nj-opt__title">{o.title}{o.badge && <em>{o.badge}</em>}</span><span className="nj-opt__sub">{o.sub}</span></span>
                <span className="nj-opt__tick"><CheckIcon size={14} color="currentColor" /></span>
              </button>
            ))}
          </div>
          {!visualiser && canShowPurchases() && <p className="nj__note"><ImageIcon size={14} /><span>Want to show the customer the finished room before you start? That's the Visualiser, in <Link to="/upgrade?plan=max_visualiser">MAX + Visualiser</Link>.</span></p>}
          {wantsPlans && (
            <div className="nj__rooms">
              <div className="ui-field__label">Which room first?</div>
              <div className="sr-chips">{FIRST_ROOMS.map((r) => <button key={r} type="button" className={'sr-chip' + (room === r ? ' sr-chip--on' : '')} onClick={() => setRoom(r)}>{r}</button>)}</div>
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Or type a name — Back bedroom" list="nj-room-types" />
              <datalist id="nj-room-types">{ROOM_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              <p className="nj__hint"><ScanIcon size={13} /> {lidar.available ? 'Your phone can scan the room with LiDAR — it\'s the first button on the next screen.' : 'Scan it with LiDAR in the iPhone app, or type the length and width and the plan draws itself.'}</p>
            </div>
          )}
          {result && (
            <div className="sr-price sr-price--warn">
              {result.over_limit ? (
                <>
                  <div className="sr-price__eyebrow">Over the small-job limit</div>
                  <div className="sr-price__big">{fmtMoney2(result.rough_price_ex_vat)}<small>rough, ex VAT</small></div>
                  <div className="sr-price__text">MAX prices jobs up to {fmtMoney2(result.limit_gbp)}. The job is saved — send it to the AI QS team for a full take-off from drawings.</div>
                  <div className="sr-price__row">
                    {result.card && result.card.submit_path && <Button size="sm" to={result.card.submit_path}><UploadIcon size={13} color="currentColor" /> Send to the AI QS team</Button>}
                    {result.survey && <Button size="sm" variant="secondary" to={'/surveys/' + result.survey.id}>Open the job</Button>}
                  </div>
                </>
              ) : (
                <>
                  <div className="sr-price__eyebrow"><AlertTriangleIcon size={12} /> Not priced</div>
                  <div className="sr-price__text">{result.error || 'MAX could not price it just now.'}{result.survey ? ' The job is saved — open it to add rooms or try again.' : ''}</div>
                  <div className="sr-price__row">
                    {result.survey && <Button size="sm" variant="secondary" to={'/surveys/' + result.survey.id}>Open the job</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Dismiss</Button>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="nj__bar">
            <Button variant="secondary" onClick={() => setStep('what')}><ArrowLeftIcon size={14} color="currentColor" /> Back</Button>
            {wantsPlans
              ? <Button onClick={startRooms}><CameraIcon size={14} color="currentColor" /> Start with {room.trim() || 'the first room'}</Button>
              : <Button onClick={priceNow} disabled={!!(result && result.survey)}><PoundIcon size={14} color="currentColor" /> Price it with MAX</Button>}
          </div>
        </section>
      )}

      {busy && <div className="sr-busy" role="status" aria-live="polite"><div className="sr-busy__card"><div className="sr-busy__ring" /><div className="sr-busy__title">{busy.title}</div><div className="sr-busy__sub">{busy.line}</div></div></div>}
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { withUserRef } from '../utils/stripeLinks';
import { canShowPurchases } from '../utils/purchases';
import { Button, Badge, PageHeader, Modal, useToast } from '../ui';
import MaxCharacter from '../components/max/MaxCharacter';
import { CheckIcon, SparklesIcon, ImageIcon, ExternalLinkIcon, AlertTriangleIcon, LockIcon } from '../components/Icons';

// ═══ Plans — the MAX packages ═════════════════════════════════════════════════
// Two tiers from the server (server/maxPlans.js): AI QS MAX at £59 a month and
// MAX + Visualiser at £79, each two months free paid yearly. Buying is a
// Stripe Payment Link stamped with the account; the webhook switches the plan
// on and /payment-success?plan=max brings the builder back here.
//
// With a plan already on the account the page is where it is managed:
// add or drop the Visualiser, go yearly, cancel at the period end, undo
// that, and open Stripe's billing page for invoices and the card.
//
// Inside the iOS app nothing is for sale (App Store rule 3.1.1): the page
// shows the current plan and what the packages contain, with no prices and
// no links out.

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
const gbp = (n) => '£' + Number(n).toLocaleString('en-GB');

export default function UpgradePage() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [yearly, setYearly] = useState(params.get('interval') === 'year');
  const [confirm, setConfirm] = useState(null); // { plan, interval } | 'cancel'
  const [busy, setBusy] = useState('');
  const sell = canShowPurchases();
  const wanted = params.get('plan');

  const load = useCallback(() => apiFetch('/billing/max').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message || 'Could not load the plans.')), []);
  useEffect(() => { load(); }, [load]);
  // No plan on the account but Stripe is wired up: ask once whether a package
  // was bought under this email (from the website, before the account existed).
  const checked = useRef(false);
  useEffect(() => {
    if (!data || checked.current || !data.stripe || !data.stripe.configured) return;
    if (data.current && (data.current.max || data.current.visualiser)) return;
    checked.current = true;
    apiFetch('/billing/max/verify', { method: 'POST' }).then((r) => { if (r && r.activated) { setData((d) => ({ ...d, current: r.current })); refreshUser(); } }).catch(() => {});
  }, [data, refreshUser]);

  const cur = data && data.current;
  const subscribed = !!(cur && cur.source === 'subscription' && cur.plan);
  const plans = (data && data.plans) || [];
  const links = (data && data.links) || {};

  const act = async (path, body, okMsg) => {
    setBusy(path);
    try {
      const r = await apiFetch('/billing/max/' + path, { method: 'POST', body: JSON.stringify(body || {}) });
      if (r && r.current) setData((d) => ({ ...d, current: r.current }));
      await refreshUser();
      if (okMsg) toast.success(okMsg);
      setConfirm(null);
      return r;
    } catch (e) { toast.error(e.message || 'That did not work. Nothing has changed.'); return null; }
    finally { setBusy(''); }
  };
  const openPortal = async () => {
    const r = await act('portal');
    if (r && r.url) window.location.assign(r.url);
  };

  const intervalKey = yearly ? 'year' : 'month';
  const priceOf = (p) => (yearly ? p.yearly_gbp : p.monthly_gbp);
  const planName = (k) => (plans.find((p) => p.key === k) || {}).name || k;

  return (
    <div className="page plans">
      <PageHeader kicker="AI QS MAX" title={subscribed ? 'Your plan' : 'Plans'} subtitle={subscribed ? 'Change your package, go yearly, or cancel — your account updates straight away.' : 'Price small jobs in minutes, survey rooms on site, and show customers the finished room.'} />

      {error && <div className="plans__err"><AlertTriangleIcon size={16} /> {error} <Button size="sm" variant="secondary" onClick={load}>Try again</Button></div>}

      {/* What the account has now */}
      {cur && (cur.max || cur.visualiser) && (
        <div className="plans__current">
          <MaxCharacter size={44} />
          <div className="plans__current-text">
            {subscribed ? (
              <>
                <div className="plans__current-title">{cur.plan_name} <Badge tone="success" size="sm">On</Badge> {cur.status === 'past_due' && <Badge tone="warning" size="sm">Payment due</Badge>}</div>
                <div className="plans__current-sub">
                  {cur.cancels_at
                    ? 'Cancelled — everything stays on until ' + fmtDate(cur.cancels_at) + '.'
                    : 'Paid ' + (cur.interval === 'year' ? 'yearly' : 'monthly') + (cur.renews_at ? ', renews on ' + fmtDate(cur.renews_at) : '') + '.'}
                  {cur.status === 'past_due' && ' The last payment did not go through — update the card from Manage billing.'}
                  {cur.renders && cur.renders.enabled && !cur.renders.unlimited && ' ' + cur.renders.remaining + ' of ' + cur.renders.monthly + ' finished-room renders left this month.'}
                </div>
                {sell && (
                  <div className="plans__current-row">
                    {cur.cancels_at
                      ? <Button size="sm" onClick={() => act('resume', null, 'Your plan carries on — nothing ends.')} busyLabel="One moment…">Keep my plan</Button>
                      : <Button size="sm" variant="secondary" onClick={() => setConfirm('cancel')}>Cancel plan</Button>}
                    <Button size="sm" variant="secondary" onClick={openPortal}><ExternalLinkIcon size={13} color="currentColor" /> Manage billing</Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="plans__current-title">{cur.source === 'admin' ? 'Admin account' : cur.source === 'early_access' ? 'MAX early access' : cur.source === 'rollout' ? 'MAX is on for every account' : 'Visualiser'} <Badge tone="success" size="sm">On</Badge></div>
                <div className="plans__current-sub">
                  {cur.source === 'admin' ? 'Every MAX feature, including the Visualiser, is on for admins.'
                    : cur.max ? 'MAX is switched on for your account without a plan.' + (cur.visualiser ? ' The Visualiser is on too.' : sell ? ' Add the Visualiser below to show customers the finished room.' : '')
                      : 'The Visualiser is on for your account.'}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Inside the app: the packages described, nothing sold. */}
      {!sell && (
        <div className="plans__native">
          <LockIcon size={16} color="var(--text-muted)" />
          <div>
            <div className="plans__native-title">Plans are managed in your AI QS account</div>
            <div className="plans__native-body">{subscribed ? 'Your plan and billing are looked after in your account outside the app. The app shows what is on.' : 'MAX, Scan a room and the Visualiser switch on in the app as soon as a package is on your account.'}</div>
          </div>
        </div>
      )}

      {/* The two packages */}
      {sell && (
        <div className="plans__toggle" role="tablist" aria-label="Billing period">
          <button type="button" role="tab" aria-selected={!yearly} className={'plans__tab' + (!yearly ? ' plans__tab--on' : '')} onClick={() => setYearly(false)}>Monthly</button>
          <button type="button" role="tab" aria-selected={yearly} className={'plans__tab' + (yearly ? ' plans__tab--on' : '')} onClick={() => setYearly(true)}>Yearly <span className="plans__save">2 months free</span></button>
        </div>
      )}

      <div className="plans__grid">
        {plans.map((p) => {
          const onIt = subscribed && cur.plan === p.key;
          const onItInterval = onIt && cur.interval === intervalKey;
          const link = links[p.key] && links[p.key][intervalKey];
          const featured = p.visualiser;
          return (
            <div key={p.key} className={'plan' + (featured ? ' plan--featured' : '') + (onIt ? ' plan--current' : '')}>
              {featured && <div className="plan__ribbon"><SparklesIcon size={12} color="currentColor" /> Most popular</div>}
              <div className="plan__name">{p.name}</div>
              <div className="plan__tag">{p.tagline}</div>
              {sell && (
                <div className="plan__price">
                  <span className="plan__amount">{gbp(priceOf(p))}</span>
                  <span className="plan__per">{yearly ? '/year' : '/month'}</span>
                  {yearly && <div className="plan__was">{gbp(p.monthly_gbp * 12)} paid monthly — save {gbp(p.monthly_gbp * 2)}</div>}
                </div>
              )}
              <ul className="plan__features">
                {p.features.map((f) => <li key={f}><CheckIcon size={14} color="var(--success)" /> <span>{f}</span></li>)}
              </ul>
              {sell && (
                <div className="plan__cta">
                  {onItInterval ? (
                    <Button variant="secondary" full disabled><CheckIcon size={14} color="currentColor" /> Your plan</Button>
                  ) : subscribed ? (
                    <Button variant={featured ? 'primary' : 'secondary'} full onClick={() => setConfirm({ plan: p.key, interval: intervalKey })}>
                      {onIt ? (yearly ? 'Switch to yearly' : 'Switch to monthly') : p.visualiser ? 'Add the Visualiser' : 'Switch to MAX'}
                    </Button>
                  ) : link ? (
                    <a className={'ui-btn ui-btn--md ui-btn--full ' + (featured ? 'ui-btn--primary' : 'ui-btn--secondary')} href={withUserRef(link, user)}>
                      {p.visualiser ? <ImageIcon size={15} color="currentColor" /> : <SparklesIcon size={15} color="currentColor" />} Choose {p.short || p.name}
                    </a>
                  ) : (
                    <Button variant="secondary" full disabled title="Not available to buy online yet">Coming soon</Button>
                  )}
                  {!subscribed && link && <div className="plan__fine">Secure checkout by Stripe. Cancel any time from this page.</div>}
                </div>
              )}
            </div>
          );
        })}
        {!data && !error && [0, 1].map((i) => <div key={i} className="plan plan--skeleton" />)}
      </div>

      {sell && !subscribed && data && !data.stripe.links && (
        <div className="plans__note"><AlertTriangleIcon size={14} /> Online checkout is not switched on yet — <a href="mailto:hello@theaiqs.co.uk">email us</a> and we will set your plan up.</div>
      )}

      {sell && (
        <div className="plans__faq">
          <div><strong>Two months free paid yearly.</strong> {gbp(590)} a year for MAX and {gbp(790)} for MAX + Visualiser — twelve months for the price of ten.</div>
          <div><strong>Switching.</strong> Add or drop the Visualiser, or go yearly, whenever you like. Stripe charges or credits the difference for the rest of the period.</div>
          <div><strong>Cancelling.</strong> Cancel from this page. Everything stays on until the end of the period you have paid for, and your surveys and estimates are kept.</div>
          {wanted === 'max_visualiser' && !subscribed && <div><strong>The Visualiser</strong> is in MAX + Visualiser: a monthly allowance of finished-room renders, painted onto your own photos.</div>}
        </div>
      )}

      {confirm && confirm !== 'cancel' && (
        <Modal title={'Switch to ' + planName(confirm.plan) + (confirm.interval === 'year' ? ', yearly' : ', monthly')} onClose={() => setConfirm(null)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Not now</Button><Button onClick={() => act('change', confirm, 'Done — your plan is now ' + planName(confirm.plan) + '.')} busyLabel="Switching…">Switch plan</Button></>}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
            Your plan becomes <strong>{planName(confirm.plan)}</strong> at <strong>{gbp((plans.find((p) => p.key === confirm.plan) || {})[confirm.interval === 'year' ? 'yearly_gbp' : 'monthly_gbp'])}</strong> {confirm.interval === 'year' ? 'a year' : 'a month'}, starting now. Stripe works out the difference for the rest of your current period and charges or credits it on your next invoice.
          </p>
        </Modal>
      )}
      {confirm === 'cancel' && (
        <Modal title="Cancel your plan?" onClose={() => setConfirm(null)}
          footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Keep my plan</Button><Button variant="danger" onClick={() => act('cancel', null, 'Cancelled. Everything stays on until the end of the paid period.')} busyLabel="Cancelling…">Cancel at period end</Button></>}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
            MAX{cur && cur.visualiser ? ', the Visualiser' : ''}, Scan a room and LiDAR scanning stay on until <strong>{fmtDate(cur && cur.renews_at) || 'the end of the paid period'}</strong>, then switch off. Nothing is charged after that. Your surveys, estimates and photos are kept, and you can come back any time.
          </p>
        </Modal>
      )}

      {busy === 'portal' && <div className="plans__busy">Opening Stripe…</div>}
      <p className="plans__back"><Link to="/dashboard">Back to the dashboard</Link></p>
    </div>
  );
}

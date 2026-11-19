import React from 'react';
import { Link } from 'react-router-dom';
import { canShowPurchases } from '../../utils/purchases';
import MaxCharacter from './MaxCharacter';
import { SparklesIcon, ArrowRightIcon, CameraIcon, ScanIcon, PoundIcon, ImageIcon, LockIcon } from '../Icons';

// ═══ The MAX packages, where a feature is locked ═════════════════════════════
// Two tiers (server/maxPlans.js): AI QS MAX, and MAX + Visualiser. This is the
// card shown in place of a locked feature — on the dashboard, on Scan a room,
// and on the room page where "Show the finished room" would be.
//
// On the website it says what the package is and links to the Plans page.
// Inside the iOS app it states the fact and nothing more: no price, no link,
// no "buy it on the website" — App Store rule 3.1.1 (see utils/purchases.js).

const COPY = {
  max: {
    title: 'Meet MAX — the AI estimator',
    sub: 'Describe a small job and MAX prices it from your own rates in minutes. Scan a room on site, measure it with LiDAR, and send a branded survey report.',
    points: [[PoundIcon, 'Small jobs priced from your rates'], [CameraIcon, 'Scan a room: photos, sizes and notes'], [ScanIcon, 'LiDAR measuring on iPhone Pro'], [SparklesIcon, 'AI room survey and quantities']],
    cta: 'See the MAX plans',
    to: '/upgrade',
    native: { title: 'AI QS MAX', body: 'MAX, Scan a room and LiDAR measuring are part of the AI QS MAX package. They switch on here as soon as MAX is on your account.' },
  },
  visualiser: {
    title: 'Show the customer the finished room',
    sub: 'The Visualiser paints the work they want onto your photo — new tiles, a new bath, the walls done — and puts the before and after in the report.',
    points: [[ImageIcon, 'Painted onto your own photo'], [SparklesIcon, 'Before and after, in the app and the PDF']],
    cta: 'Add the Visualiser',
    to: '/upgrade?plan=max_visualiser',
    native: { title: 'The Visualiser', body: 'Showing the finished room is part of the MAX + Visualiser package. It switches on here as soon as it is on your account.' },
  },
};

export default function MaxUpsell({ variant = 'max', compact = false, thumb = null, style }) {
  const c = COPY[variant] || COPY.max;
  if (!canShowPurchases()) {
    return (
      <div className={'max-upsell max-upsell--native' + (compact ? ' max-upsell--compact' : '')} style={style}>
        <LockIcon size={16} color="var(--text-muted)" />
        <div>
          <div className="max-upsell__ntitle">{c.native.title}</div>
          <div className="max-upsell__nbody">{c.native.body}</div>
        </div>
      </div>
    );
  }
  if (compact) {
    return (
      <Link to={c.to} className="max-upsell max-upsell--compact" style={style} aria-label={c.cta}>
        {thumb ? <span className="max-upsell__thumb"><img src={thumb} alt="" /><span className="max-upsell__spark"><SparklesIcon size={14} color="#fff" /></span></span> : <span className="max-upsell__icon"><SparklesIcon size={18} color="var(--accent-text)" /></span>}
        <span className="max-upsell__text">
          <span className="max-upsell__title">{c.title}</span>
          <span className="max-upsell__sub">{c.sub}</span>
          <span className="max-upsell__cta">{c.cta} <ArrowRightIcon size={13} /></span>
        </span>
      </Link>
    );
  }
  return (
    <div className="max-upsell" style={style}>
      <div className="max-upsell__head">
        <MaxCharacter size={48} />
        <div style={{ minWidth: 0 }}>
          <h2 className="max-upsell__title">{c.title}</h2>
          <p className="max-upsell__sub">{c.sub}</p>
        </div>
      </div>
      <ul className="max-upsell__points">
        {c.points.map(([Icon, text]) => <li key={text}><Icon size={14} color="var(--accent)" /> {text}</li>)}
      </ul>
      <div className="max-upsell__row">
        <Link to={c.to} className="ui-btn ui-btn--primary ui-btn--md">{c.cta} <ArrowRightIcon size={15} /></Link>
        <span className="max-upsell__meta">From £59 a month · two months free paid yearly</span>
      </div>
    </div>
  );
}

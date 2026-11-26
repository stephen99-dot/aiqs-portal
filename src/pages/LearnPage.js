import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import useLearn from '../hooks/useLearn';
import { setWatched, videoUrl, packageLabel } from '../utils/learn';
import { canShowPurchases } from '../utils/purchases';
import { Button, PageHeader, ProgressBar, EmptyState, SkeletonCard, Badge, useToast } from '../ui';
import { PlayIcon, CheckIcon, ArrowRightIcon, AlertCircleIcon } from '../components/Icons';
import VideoModal from '../components/learn/VideoModal';

// ═══ How-to videos — every video, ticked off as they are watched ════════════
// Short screen recordings of the portal doing each thing, in place of written
// instructions. The next steps at the top come from what the account has
// actually done (server/learn.js).

const FILTERS = [['all', 'All'], ['todo', 'To watch'], ['done', 'Watched']];

export default function LearnPage() {
  const toast = useToast();
  const { data, error, refresh } = useLearn();
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('all');

  if (error) return <div className="page"><PageHeader title="How-to videos" /><EmptyState icon={AlertCircleIcon} title="Could not load the videos" body={error} action={<Button onClick={() => refresh(true)}>Try again</Button>} /></div>;
  if (!data) return <div className="page"><PageHeader title="How-to videos" /><div className="learn-grid"><SkeletonCard height={260} /><SkeletonCard height={260} /><SkeletonCard height={260} /></div></div>;

  const videos = data.videos || [];
  const p = data.progress || { watched: 0, total: videos.length };
  const steps = (data.next || []).filter((s) => !s.done && !(s.web_only && !canShowPurchases())).slice(0, 3);
  const shown = videos.filter((v) => filter === 'all' || (filter === 'done' ? !!v.watched_at : !v.watched_at));
  const videoFor = (key) => videos.find((v) => v.key === key) || null;
  const tick = async (v, e) => {
    e.stopPropagation();
    try { await setWatched(v.key, !v.watched_at); } catch (err) { toast.error(err.message || 'Could not save that.'); }
  };

  return (
    <div className="page">
      <PageHeader title="How-to videos" subtitle="Short videos of the portal doing each thing. Tick them off as you go, or let them tick themselves off when they finish." />

      <div className="learn-progress">
        <div className="learn-progress__row">
          <strong>{p.watched} of {p.total} watched</strong>
          <span>{p.watched === p.total ? 'All done — nice one.' : p.watched === 0 ? 'Start with "Around the portal".' : (p.total - p.watched) + ' to go'}</span>
        </div>
        <ProgressBar value={p.total ? (p.watched / p.total) * 100 : 0} tone="gradient" height={5} />
      </div>

      {steps.length > 0 && (
        <section className="learn-next">
          <div className="learn-next__head"><h2>Next steps</h2><span>From what you've done so far</span></div>
          <div className="learn-steps">
            {steps.map((s) => {
              const v = videoFor(s.video);
              return (
                <div key={s.key} className="learn-step">
                  <span className="learn-step__dot" />
                  <div className="learn-step__main"><div className="learn-step__title">{s.title}</div><div className="learn-step__body">{s.body}</div></div>
                  <div className="learn-step__actions">
                    {v && <button type="button" className="learn-step__watch" onClick={() => setOpen(v)}><PlayIcon size={11} color="currentColor" /> Watch</button>}
                    <Link to={s.path} className="learn-step__go">Do it <ArrowRightIcon size={12} /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="learn-filters">
        {FILTERS.map(([k, l]) => <button key={k} type="button" className={'sr-chip' + (filter === k ? ' sr-chip--on' : '')} onClick={() => setFilter(k)}>{l}{k === 'todo' && p.total - p.watched > 0 ? ' · ' + (p.total - p.watched) : k === 'done' && p.watched > 0 ? ' · ' + p.watched : ''}</button>)}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={CheckIcon} title={filter === 'todo' ? 'Nothing left to watch' : 'Nothing watched yet'} body={filter === 'todo' ? 'Every video is ticked off.' : 'Play a video and it ticks itself off when it finishes.'} />
      ) : (
        <div className="learn-grid">
          {shown.map((v, i) => {
            const pkg = packageLabel(v);
            const done = !!v.watched_at;
            return (
              <div key={v.key} className={'learn-video' + (done ? ' learn-video--done' : '')}>
                <button type="button" className="learn-video__poster" onClick={() => setOpen(v)} aria-label={'Play: ' + v.title}>
                  <img src={videoUrl(v.poster)} alt="" loading="lazy" />
                  <span className="learn-play"><PlayIcon size={22} color="currentColor" /></span>
                  <span className="learn-video__num">{videos.indexOf(v) + 1}</span>
                  {v.seconds ? <span className="learn-video__len">{Math.round(v.seconds)} s</span> : null}
                </button>
                <div className="learn-video__body">
                  <div className="learn-video__top">
                    <h3 className="learn-video__title">{v.title}</h3>
                    {pkg && <Badge tone={v.package === 'visualiser' ? 'info' : 'accent'} size="sm" outlined>{pkg}</Badge>}
                  </div>
                  <p className="learn-video__blurb">{v.blurb}</p>
                  <div className="learn-video__foot">
                    <button type="button" className={'learn-tick' + (done ? ' learn-tick--on' : '')} onClick={(e) => tick(v, e)} aria-pressed={done}><span className="learn-tick__box"><CheckIcon size={12} color="currentColor" /></span>{done ? 'Watched' : 'Mark as watched'}</button>
                    {v.page && <Link to={v.page} className="learn-video__go">Try it <ArrowRightIcon size={12} /></Link>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <VideoModal video={open} videos={videos} onClose={() => setOpen(null)} />}
    </div>
  );
}

import React, { useState } from 'react';
import { Button, useToast } from '../../ui';
import { loadLearn } from '../../utils/learn';
import { PlayIcon } from '../Icons';
import VideoModal from './VideoModal';

// ═══ "Watch how" — a button on a page that plays the video about it ═════════
//   <WatchHow video="job" />            on the Jobs page
//   <WatchHow video="submit" label="Watch how it works" />

export default function WatchHow({ video, label = 'Watch how', variant = 'secondary', size = 'md' }) {
  const toast = useToast();
  const [open, setOpen] = useState(null);   // { video, videos }
  const play = async () => {
    try {
      const d = await loadLearn(false);
      const v = (d.videos || []).find((x) => x.key === video);
      if (!v) { toast.error('That video is not here yet.'); return; }
      setOpen({ video: v, videos: d.videos });
    } catch (e) { toast.error(e.message || 'Could not load the video.'); }
  };
  return (
    <>
      <Button variant={variant} size={size} onClick={play}><PlayIcon size={13} color="currentColor" /> {label}</Button>
      {open && <VideoModal video={open.video} videos={open.videos} onClose={() => setOpen(null)} />}
    </>
  );
}

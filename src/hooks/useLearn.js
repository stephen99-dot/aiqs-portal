import { useState, useEffect, useCallback } from 'react';
import { loadLearn, LEARN_EVENT } from '../utils/learn';

// The how-to videos, watched flags and next steps for this account; refreshes
// itself whenever a video is ticked off anywhere on the page.
export default function useLearn() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const refresh = useCallback((force) => loadLearn(force).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message || 'Could not load the videos.')), []);
  useEffect(() => {
    refresh(false);
    const on = () => refresh(false);
    window.addEventListener(LEARN_EVENT, on);
    return () => window.removeEventListener(LEARN_EVENT, on);
  }, [refresh]);
  return { data, error, refresh };
}

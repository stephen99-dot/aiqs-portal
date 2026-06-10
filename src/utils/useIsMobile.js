import { useState, useEffect } from 'react';

// Shared "are we on a phone?" hook (lifted from the ChatPage pattern).
// Default breakpoint 640px — below it the OiB editors swap tables for cards
// and pin the primary action to the bottom of the screen.
export default function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

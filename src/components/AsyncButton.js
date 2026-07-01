import React, { useState, useRef, useEffect } from 'react';

// AsyncButton — a drop-in <button> for async click handlers. While the promise
// returned by onClick is in flight it disables itself and (optionally) swaps its
// label to `busyLabel`, so a second tap can't fire the action twice. This is the
// one place the "double-submit" guarding on the money path lives.
//
//   <AsyncButton onClick={save} busyLabel="Saving…" style={primaryBtn}>Save</AsyncButton>
//
// onClick may be sync or async; its return value is awaited. If the click
// navigates away and unmounts the button, a mounted-ref stops the setState.
export default function AsyncButton({
  onClick, busyLabel, children, disabled = false,
  style, busyStyle, ...rest
}) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const handle = async (e) => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await (onClick ? onClick(e) : undefined);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <button
      {...rest}
      disabled={busy || disabled}
      onClick={handle}
      style={{
        ...style,
        ...(disabled && !busy ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
        ...(busy ? { opacity: 0.65, cursor: 'progress', ...busyStyle } : {}),
      }}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

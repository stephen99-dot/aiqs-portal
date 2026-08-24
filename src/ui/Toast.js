import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// Toast notifications — the replacement for alert() on non-blocking feedback.
//
//   const toast = useToast();
//   toast.success('Project renamed');
//   toast.error("Couldn't delete project: " + err.message);
//
// ToastProvider is mounted once in App.js. Toasts auto-dismiss after 4.5s.

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((message, tone = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const api = useRef({
    show: (msg) => push(msg, 'info'),
    success: (msg) => push(msg, 'success'),
    error: (msg) => push(msg, 'danger'),
  });
  // Keep the stable ref pointing at the latest push.
  api.current.show = (msg) => push(msg, 'info');
  api.current.success = (msg) => push(msg, 'success');
  api.current.error = (msg) => push(msg, 'danger');

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {toasts.length > 0 && (
        <div className="ui-toast-stack" role="status" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`ui-toast ui-toast--${t.tone}`}>
              <span>{t.message}</span>
              <button className="ui-toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // Pages render outside the provider in a few legacy tests/entrypoints —
  // fall back to a console warning rather than crashing.
  return ctx || {
    show: (m) => console.warn('[toast]', m),
    success: (m) => console.warn('[toast]', m),
    error: (m) => console.error('[toast]', m),
  };
}

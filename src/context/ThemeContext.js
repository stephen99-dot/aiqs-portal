import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { light, dark, themeObject, cssVars } from '../theme/tokens';

// Theme state + distribution. The palettes themselves live in theme/tokens.js —
// this file only picks the mode, writes the CSS variables onto :root, and
// serves the legacy `t` object to inline-styled components.

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try {
      // One-time migration onto the refreshed light look (v2): everyone lands on
      // the clean light theme once, then their own toggle choice is respected.
      if (localStorage.getItem('aiqs-ui-v') !== '2') { localStorage.setItem('aiqs-ui-v', '2'); return 'light'; }
      // Users who had a removed novelty skin keep their light/dark preference —
      // mode was always stored separately from the retired brand key.
      localStorage.removeItem('aiqs-brand');
      return localStorage.getItem('aiqs-theme') === 'dark' ? 'dark' : 'light';
    } catch { return 'light'; }
  });

  const palette = mode === 'dark' ? dark : light;
  const t = useMemo(() => themeObject(palette), [palette]);

  useEffect(() => {
    try { localStorage.setItem('aiqs-theme', mode); } catch {}
    const root = document.documentElement;
    const vars = cssVars(palette);
    Object.keys(vars).forEach(key => root.style.setProperty(key, vars[key]));
    document.body.style.background = palette.bg;
    document.body.style.color = palette.text;
    document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
  }, [mode, palette]);

  const toggle = () => setMode(m => (m === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ t, mode, isDark: mode === 'dark', toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

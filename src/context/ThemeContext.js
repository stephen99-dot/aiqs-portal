import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

// ── AI QS palettes — the portal's two themes: light (default) and dark. ──
const aiqsDark = {
  name: 'dark',
  '--bg-primary': '#141C2E', '--bg-secondary': '#1A2438', '--bg-card': '#1E2A40',
  '--bg-card-hover': '#243050', '--bg-input': '#16203A',
  '--accent': '#F59E0B', '--accent-bright': '#FBBF24', '--accent-dim': '#D97706',
  '--text-primary': '#F8FAFC', '--text-secondary': '#94A3B8', '--text-muted': '#64748B',
  '--border': 'rgba(248,250,252,0.08)', '--border-accent': 'rgba(245,158,11,0.3)', '--border-input': 'rgba(248,250,252,0.12)',
  '--danger': '#EF4444', '--success': '#10B981',
  '--gradient-amber': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', '--shadow-glow': '0 0 60px rgba(245,158,11,0.06)',
  bg: '#111827', bgAlt: '#16202E', surface: '#1A2438', surfaceHover: '#203050', card: '#1E2A40', cardHover: '#243050',
  border: '#263348', borderLight: '#2E3D58', text: '#E8EDF5', textSecondary: '#94A3B8', textMuted: '#5A6E87', textDim: '#3B4D66',
  accent: '#2563EB', accentHover: '#3B7BF7', accentLight: '#60A5FA', accentGlow: 'rgba(37,99,235,0.12)',
  success: '#10B981', successBg: 'rgba(16,185,129,0.1)', warning: '#F59E0B', warningBg: 'rgba(245,158,11,0.1)',
  danger: '#EF4444', dangerBg: 'rgba(239,68,68,0.1)', info: '#8B5CF6', infoBg: 'rgba(139,92,246,0.1)',
  gold: '#D4A853', goldBg: 'rgba(212,168,83,0.08)', inputBg: '#16203A',
  shadow: '0 4px 24px rgba(0,0,0,0.3)', shadowSm: '0 2px 8px rgba(0,0,0,0.2)',
  // newer tokens used by the themable shell
  accentText: '#0A0F1C', userBubble: '#1B3557', userText: '#F1F5F9', sidebar: '#0A0D16', sidebarBorder: '#161E2E',
  gradientAccent: 'linear-gradient(135deg, #F59E0B, #D97706)',
};
// Refreshed light palette — clean, high-contrast, site-friendly, amber accent.
// This is now the default look across the whole portal.
const aiqsLight = {
  name: 'light',
  '--bg-primary': '#F5F7FA', '--bg-secondary': '#FFFFFF', '--bg-card': '#FFFFFF',
  '--bg-card-hover': '#F7F9FC', '--bg-input': '#FFFFFF',
  '--accent': '#D97706', '--accent-bright': '#F59E0B', '--accent-dim': '#B45309',
  '--text-primary': '#14181F', '--text-secondary': '#5A6577', '--text-muted': '#8A94A6',
  '--border': '#E3E8EF', '--border-accent': 'rgba(217,119,6,0.3)', '--border-input': '#D6DCE5',
  '--danger': '#DC2626', '--success': '#16A34A',
  '--gradient-amber': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', '--shadow-glow': '0 0 60px rgba(245,158,11,0.04)',
  bg: '#F5F7FA', bgAlt: '#EEF2F7', surface: '#FFFFFF', surfaceHover: '#F5F8FC', card: '#FFFFFF', cardHover: '#F7F9FC',
  border: '#E3E8EF', borderLight: '#D6DCE5', text: '#14181F', textSecondary: '#5A6577', textMuted: '#8A94A6', textDim: '#C2CAD6',
  accent: '#D97706', accentHover: '#B45309', accentLight: '#F59E0B', accentGlow: 'rgba(217,119,6,0.10)',
  success: '#16A34A', successBg: 'rgba(22,163,74,0.10)', warning: '#D97706', warningBg: 'rgba(217,119,6,0.10)',
  danger: '#DC2626', dangerBg: 'rgba(220,38,38,0.08)', info: '#2563EB', infoBg: 'rgba(37,99,235,0.08)',
  gold: '#B8860B', goldBg: 'rgba(184,134,11,0.08)', inputBg: '#FFFFFF',
  shadow: '0 6px 24px rgba(15,23,42,0.08)', shadowSm: '0 2px 8px rgba(15,23,42,0.05)',
  accentText: '#FFFFFF', userBubble: '#D97706', userText: '#FFFFFF', sidebar: '#FFFFFF', sidebarBorder: '#E3E8EF',
  gradientAccent: 'linear-gradient(135deg, #F59E0B, #D97706)',
};

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

  const t = mode === 'dark' ? aiqsDark : aiqsLight;

  useEffect(() => {
    try { localStorage.setItem('aiqs-theme', mode); } catch {}
    const root = document.documentElement;
    Object.keys(t).forEach(key => { if (key.startsWith('--')) root.style.setProperty(key, t[key]); });
    document.body.style.background = t['--bg-primary'];
    document.body.style.color = t['--text-primary'];
    document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
  }, [mode, t]);

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

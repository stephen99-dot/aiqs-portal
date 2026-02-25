import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

const themes = {
  dark: {
    name: 'dark',
    // CSS variable overrides
    '--bg-primary': '#0A0F1C',
    '--bg-secondary': '#111827',
    '--bg-card': '#161E2E',
    '--bg-card-hover': '#1C2640',
    '--bg-input': '#0D1323',
    '--accent': '#F59E0B',
    '--accent-bright': '#FBBF24',
    '--accent-dim': '#D97706',
    '--text-primary': '#F8FAFC',
    '--text-secondary': '#94A3B8',
    '--text-muted': '#64748B',
    '--border': 'rgba(248,250,252,0.08)',
    '--border-accent': 'rgba(245,158,11,0.3)',
    '--border-input': 'rgba(248,250,252,0.12)',
    '--danger': '#EF4444',
    '--success': '#10B981',
    '--gradient-amber': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    '--shadow-glow': '0 0 60px rgba(245,158,11,0.06)',
    // Sidebar theme tokens (used by Layout.js inline styles)
    bg: '#06080F',
    bgAlt: '#0C1019',
    surface: '#111827',
    surfaceHover: '#182036',
    card: '#131B2E',
    cardHover: '#1A2540',
    border: '#1C2A44',
    borderLight: '#253558',
    text: '#E8EDF5',
    textSecondary: '#94A3B8',
    textMuted: '#5A6E87',
    textDim: '#3B4D66',
    accent: '#2563EB',
    accentHover: '#3B7BF7',
    accentLight: '#60A5FA',
    accentGlow: 'rgba(37,99,235,0.12)',
    success: '#10B981',
    successBg: 'rgba(16,185,129,0.1)',
    warning: '#F59E0B',
    warningBg: 'rgba(245,158,11,0.1)',
    danger: '#EF4444',
    dangerBg: 'rgba(239,68,68,0.1)',
    info: '#8B5CF6',
    infoBg: 'rgba(139,92,246,0.1)',
    gold: '#D4A853',
    goldBg: 'rgba(212,168,83,0.08)',
    inputBg: '#0D1320',
    shadow: '0 4px 24px rgba(0,0,0,0.4)',
    shadowSm: '0 2px 8px rgba(0,0,0,0.3)',
  },
  light: {
    name: 'light',
    // CSS variable overrides
    '--bg-primary': '#F4F6FA',
    '--bg-secondary': '#FFFFFF',
    '--bg-card': '#FFFFFF',
    '--bg-card-hover': '#F8FAFD',
    '--bg-input': '#F1F5F9',
    '--accent': '#D97706',
    '--accent-bright': '#F59E0B',
    '--accent-dim': '#B45309',
    '--text-primary': '#0F172A',
    '--text-secondary': '#475569',
    '--text-muted': '#94A3B8',
    '--border': 'rgba(15,23,42,0.08)',
    '--border-accent': 'rgba(217,119,6,0.3)',
    '--border-input': 'rgba(15,23,42,0.12)',
    '--danger': '#DC2626',
    '--success': '#059669',
    '--gradient-amber': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    '--shadow-glow': '0 0 60px rgba(245,158,11,0.04)',
    // Sidebar theme tokens
    bg: '#F4F6FA',
    bgAlt: '#EDF0F7',
    surface: '#FFFFFF',
    surfaceHover: '#F8F9FC',
    card: '#FFFFFF',
    cardHover: '#F8FAFD',
    border: '#E2E8F0',
    borderLight: '#CBD5E1',
    text: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    textDim: '#CBD5E1',
    accent: '#2563EB',
    accentHover: '#1D4FD7',
    accentLight: '#3B82F6',
    accentGlow: 'rgba(37,99,235,0.08)',
    success: '#059669',
    successBg: 'rgba(5,150,105,0.08)',
    warning: '#D97706',
    warningBg: 'rgba(217,119,6,0.08)',
    danger: '#DC2626',
    dangerBg: 'rgba(220,38,38,0.08)',
    info: '#7C3AED',
    infoBg: 'rgba(124,58,237,0.08)',
    gold: '#B8860B',
    goldBg: 'rgba(184,134,11,0.06)',
    inputBg: '#F8FAFC',
    shadow: '0 4px 24px rgba(0,0,0,0.06)',
    shadowSm: '0 2px 8px rgba(0,0,0,0.04)',
  }
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('aiqs-theme') || 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    try { localStorage.setItem('aiqs-theme', mode); } catch {}

    const theme = themes[mode];
    const root = document.documentElement;

    // Inject all CSS variables onto :root so styles.css picks them up
    Object.keys(theme).forEach(key => {
      if (key.startsWith('--')) {
        root.style.setProperty(key, theme[key]);
      }
    });

    // Also set body background/color directly for immediate feedback
    document.body.style.background = theme['--bg-primary'];
    document.body.style.color = theme['--text-primary'];
    document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
  }, [mode]);

  const toggle = () => setMode(m => m === 'dark' ? 'light' : 'dark');
  const t = themes[mode];

  return (
    <ThemeContext.Provider value={{ t, mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

const themes = {
  dark: {
    name: 'dark',
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
    document.body.style.background = themes[mode].bg;
    document.body.style.color = themes[mode].text;
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

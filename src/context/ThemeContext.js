import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

// ── AI QS palettes (the existing look — preserved verbatim so the default
// theme is a zero-regression baseline). New themes are layered on top. ──
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

// Build a complete palette for a new theme by overlaying a small colour spec on
// top of the AI QS base (guarantees every token key the app reads still exists).
function overlay(base, s) {
  const grad = s.gradient || `linear-gradient(135deg, ${s.accent}, ${s.accentHover || s.accent})`;
  return {
    ...base,
    name: s.name,
    bg: s.bg, bgAlt: s.bgAlt || s.bg, surface: s.surface, surfaceHover: s.surfaceHover || s.card,
    card: s.card, cardHover: s.cardHover || s.surface, border: s.border, borderLight: s.borderLight || s.border,
    text: s.text, textSecondary: s.textSec, textMuted: s.textMuted, textDim: s.textDim || s.textMuted,
    accent: s.accent, accentHover: s.accentHover || s.accent, accentLight: s.accentLight || s.accent,
    accentGlow: s.accentGlow || 'rgba(0,0,0,0.06)', accentText: s.accentText,
    inputBg: s.inputBg || s.surface, userBubble: s.userBubble, userText: s.userText || s.text,
    sidebar: s.sidebar, sidebarBorder: s.border, gradientAccent: grad,
    success: s.success || base.success, successBg: s.successBg || base.successBg,
    warning: s.accent, warningBg: base.warningBg, danger: s.danger || base.danger, dangerBg: base.dangerBg,
    shadow: s.isDark ? '0 4px 24px rgba(0,0,0,0.35)' : '0 4px 24px rgba(0,0,0,0.07)',
    shadowSm: s.isDark ? '0 2px 8px rgba(0,0,0,0.25)' : '0 2px 8px rgba(0,0,0,0.05)',
    // CSS variables consumed by styles.css
    '--bg-primary': s.bg, '--bg-secondary': s.surface, '--bg-card': s.card, '--bg-card-hover': s.cardHover || s.surface,
    '--bg-input': s.inputBg || s.surface, '--accent': s.accent, '--accent-bright': s.accentLight || s.accent, '--accent-dim': s.accentHover || s.accent,
    '--text-primary': s.text, '--text-secondary': s.textSec, '--text-muted': s.textMuted,
    '--border': s.border, '--border-accent': s.accentGlow || s.border, '--border-input': s.borderLight || s.border,
    '--danger': s.danger || base.danger, '--success': s.success || base.success,
    '--gradient-amber': grad, '--shadow-glow': 'none',
  };
}

const SPECS = {
  chatgpt: {
    label: 'ChatGPT',
    dark:  { name:'dark', isDark:true, bg:'#212121', surface:'#171717', card:'#2A2A2A', cardHover:'#2F2F2F', border:'#2F2F2F', borderLight:'#3A3A3A', text:'#ECECEC', textSec:'#B4B4B4', textMuted:'#8E8E8E', inputBg:'#2A2A2A', accent:'#FFFFFF', accentHover:'#D9D9D9', accentLight:'#19C37D', accentText:'#0D0D0D', userBubble:'#303030', userText:'#ECECEC', sidebar:'#171717', gradient:'linear-gradient(135deg,#FFFFFF,#E6E6E6)' },
    light: { name:'light', isDark:false, bg:'#FFFFFF', surface:'#F9F9F9', card:'#FFFFFF', cardHover:'#F4F4F4', border:'#E6E6E6', borderLight:'#D9D9D9', text:'#0D0D0D', textSec:'#4D4D4D', textMuted:'#9A9A9A', inputBg:'#FFFFFF', accent:'#0D0D0D', accentHover:'#000000', accentLight:'#10A37F', accentText:'#FFFFFF', userBubble:'#F4F4F4', userText:'#0D0D0D', sidebar:'#F9F9F9', gradient:'linear-gradient(135deg,#0D0D0D,#000000)' },
  },
  claude: {
    label: 'Claude',
    dark:  { name:'dark', isDark:true, bg:'#262624', surface:'#1F1E1D', card:'#2F2E2B', cardHover:'#34322E', border:'#3A3935', borderLight:'#45433E', text:'#ECEAE3', textSec:'#B7B4AB', textMuted:'#8F8C83', inputBg:'#2C2B28', accent:'#C96442', accentHover:'#B5573A', accentLight:'#D7855F', accentText:'#FFFFFF', userBubble:'#34322E', userText:'#ECEAE3', sidebar:'#1F1E1D', gradient:'linear-gradient(135deg,#C96442,#B5573A)' },
    light: { name:'light', isDark:false, bg:'#FAF9F5', surface:'#F0EEE6', card:'#FFFFFF', cardHover:'#F7F5EF', border:'#E4E1D8', borderLight:'#D9D5C9', text:'#211F1B', textSec:'#56544E', textMuted:'#76746C', inputBg:'#FFFFFF', accent:'#C96442', accentHover:'#B5573A', accentLight:'#D7855F', accentText:'#FFFFFF', userBubble:'#F1EFE8', userText:'#211F1B', sidebar:'#EFEDE5', gradient:'linear-gradient(135deg,#C96442,#B5573A)' },
  },
  copilot: {
    label: 'Copilot',
    dark:  { name:'dark', isDark:true, bg:'#1B1A19', surface:'#242322', card:'#222B36', cardHover:'#2A2B2E', border:'#34322F', borderLight:'#403E3A', text:'#F3F2F1', textSec:'#C8C6C4', textMuted:'#9A9794', inputBg:'#242322', accent:'#4DA8E0', accentHover:'#2AA5F4', accentLight:'#2AD4A8', accentText:'#0B1620', userBubble:'#243447', userText:'#F3F2F1', sidebar:'#242322', gradient:'linear-gradient(135deg,#2AA5F4,#2AD4A8,#8B5CF6)' },
    light: { name:'light', isDark:false, bg:'#FFFFFF', surface:'#F3F6FB', card:'#FFFFFF', cardHover:'#F5F9FE', border:'#E1E7F0', borderLight:'#D2DBE8', text:'#1B1A19', textSec:'#444341', textMuted:'#616160', inputBg:'#FFFFFF', accent:'#0F6CBD', accentHover:'#0C5A9E', accentLight:'#2AA5F4', accentText:'#FFFFFF', userBubble:'#EAF1FB', userText:'#1B1A19', sidebar:'#F3F6FB', gradient:'linear-gradient(135deg,#2AA5F4,#2AD4A8,#8B5CF6)' },
  },
};

// Assemble the full theme registry: aiqs (verbatim) + the three new brands.
const THEMES = {
  aiqs:    { label: 'AI QS', dark: aiqsDark, light: aiqsLight },
  chatgpt: { label: SPECS.chatgpt.label, dark: overlay(aiqsDark, SPECS.chatgpt.dark), light: overlay(aiqsLight, SPECS.chatgpt.light) },
  claude:  { label: SPECS.claude.label,  dark: overlay(aiqsDark, SPECS.claude.dark),  light: overlay(aiqsLight, SPECS.claude.light) },
  copilot: { label: SPECS.copilot.label, dark: overlay(aiqsDark, SPECS.copilot.dark), light: overlay(aiqsLight, SPECS.copilot.light) },
};

export const THEME_LIST = Object.keys(THEMES).map(key => ({ key, label: THEMES[key].label }));

function resolve(theme, mode) {
  const fam = THEMES[theme] || THEMES.aiqs;
  return fam[mode] || fam.dark;
}

export function ThemeProvider({ children }) {
  // One-time migration onto the refreshed light look (v2): everyone lands on the
  // clean light theme once, then their own toggle choice is respected from there.
  const [theme, setThemeState] = useState(() => {
    try {
      if (localStorage.getItem('aiqs-ui-v') !== '2') return 'aiqs';
      return localStorage.getItem('aiqs-brand') || 'aiqs';
    } catch { return 'aiqs'; }
  });
  const [mode, setMode] = useState(() => {
    try {
      if (localStorage.getItem('aiqs-ui-v') !== '2') { localStorage.setItem('aiqs-ui-v', '2'); return 'light'; }
      return localStorage.getItem('aiqs-theme') || 'light';
    } catch { return 'light'; }
  });

  useEffect(() => {
    try { localStorage.setItem('aiqs-theme', mode); localStorage.setItem('aiqs-brand', theme); } catch {}
    const palette = resolve(theme, mode);
    const root = document.documentElement;
    Object.keys(palette).forEach(key => { if (key.startsWith('--')) root.style.setProperty(key, palette[key]); });
    document.body.style.background = palette['--bg-primary'];
    document.body.style.color = palette['--text-primary'];
    document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
  }, [mode, theme]);

  const toggle = () => setMode(m => (m === 'dark' ? 'light' : 'dark'));
  const setTheme = (name) => { if (THEMES[name]) setThemeState(name); };
  const t = resolve(theme, mode);

  return (
    <ThemeContext.Provider value={{ t, mode, theme, themes: THEME_LIST, toggle, setMode, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

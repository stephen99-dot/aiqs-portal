// ── AI QS design tokens — the single source of truth for both themes. ──
//
// Everything the UI colours itself with comes from here, exactly once per
// mode. Two consumers are generated from these palettes:
//
//   1. CSS custom properties (via cssVars) — written onto :root by
//      ThemeContext, read by styles.css / ui.css and any className-styled
//      component.
//   2. The legacy `t` theme object (via themeObject) — the same values under
//      the property names the older inline-styled pages already use, so they
//      keep working unchanged while they migrate to the src/ui kit.
//
// Historically these two systems were defined separately and disagreed (the
// dark theme's `--accent` was amber while `t.accent` was blue). Keeping one
// palette per mode makes that class of drift impossible.

const gradientAccent = 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)';

export const light = {
  name: 'light',
  // Surfaces
  bg: '#F5F7FA', bgAlt: '#EEF2F7',
  surface: '#FFFFFF', surfaceHover: '#F5F8FC',
  card: '#FFFFFF', cardHover: '#F7F9FC',
  inputBg: '#FFFFFF',
  sidebar: '#FFFFFF', sidebarBorder: '#E3E8EF',
  // Lines
  border: '#E3E8EF', borderLight: '#D6DCE5', borderInput: '#D6DCE5',
  borderAccent: 'rgba(217,119,6,0.30)',
  // Text
  text: '#14181F', textSecondary: '#5A6577', textMuted: '#8A94A6', textDim: '#C2CAD6',
  // Accent (amber — the brand colour in both modes)
  accent: '#D97706', accentHover: '#B45309', accentLight: '#F59E0B',
  accentGlow: 'rgba(217,119,6,0.10)', accentText: '#FFFFFF',
  // Semantic
  success: '#16A34A', successBg: 'rgba(22,163,74,0.10)',
  warning: '#D97706', warningBg: 'rgba(217,119,6,0.10)',
  danger: '#DC2626', dangerBg: 'rgba(220,38,38,0.08)',
  info: '#2563EB', infoBg: 'rgba(37,99,235,0.08)',
  violet: '#7C3AED', violetBg: 'rgba(124,58,237,0.08)',
  gold: '#B8860B', goldBg: 'rgba(184,134,11,0.08)',
  // Effects
  shadow: '0 6px 24px rgba(15,23,42,0.08)', shadowSm: '0 2px 8px rgba(15,23,42,0.05)',
  shadowGlow: '0 0 60px rgba(245,158,11,0.04)',
  navHover: 'rgba(0,0,0,0.03)', navActive: 'rgba(0,0,0,0.045)',
  // Chat
  userBubble: '#D97706', userText: '#FFFFFF',
  gradientAccent,
};

export const dark = {
  name: 'dark',
  // Surfaces
  bg: '#141C2E', bgAlt: '#16202E',
  surface: '#1A2438', surfaceHover: '#203050',
  card: '#1E2A40', cardHover: '#243050',
  inputBg: '#16203A',
  sidebar: '#0A0F1C', sidebarBorder: '#161E2E',
  // Lines
  border: '#263348', borderLight: '#2E3D58', borderInput: 'rgba(248,250,252,0.14)',
  borderAccent: 'rgba(245,158,11,0.30)',
  // Text
  text: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#64748B', textDim: '#3B4D66',
  // Accent (amber here too — was blue in the old JS palette, which made the
  // same button render blue or amber depending on how it was styled)
  accent: '#F59E0B', accentHover: '#FBBF24', accentLight: '#FBBF24',
  accentGlow: 'rgba(245,158,11,0.12)', accentText: '#0A0F1C',
  // Semantic
  success: '#10B981', successBg: 'rgba(16,185,129,0.10)',
  warning: '#F59E0B', warningBg: 'rgba(245,158,11,0.10)',
  danger: '#EF4444', dangerBg: 'rgba(239,68,68,0.10)',
  info: '#60A5FA', infoBg: 'rgba(96,165,250,0.10)',
  violet: '#A78BFA', violetBg: 'rgba(167,139,250,0.10)',
  gold: '#D4A853', goldBg: 'rgba(212,168,83,0.08)',
  // Effects
  shadow: '0 4px 24px rgba(0,0,0,0.30)', shadowSm: '0 2px 8px rgba(0,0,0,0.20)',
  shadowGlow: '0 0 60px rgba(245,158,11,0.06)',
  navHover: 'rgba(255,255,255,0.04)', navActive: 'rgba(255,255,255,0.06)',
  // Chat
  userBubble: '#1B3557', userText: '#F1F5F9',
  gradientAccent,
};

// The CSS custom properties written onto :root. styles.css declares the same
// names with the light values as its static fallback.
export function cssVars(p) {
  return {
    '--bg-primary': p.bg, '--bg-secondary': p.surface, '--bg-card': p.card,
    '--bg-card-hover': p.cardHover, '--bg-input': p.inputBg,
    '--surface-hover': p.surfaceHover,
    '--sidebar': p.sidebar, '--sidebar-border': p.sidebarBorder,
    '--border': p.border, '--border-light': p.borderLight,
    '--border-input': p.borderInput, '--border-accent': p.borderAccent,
    '--text-primary': p.text, '--text-secondary': p.textSecondary,
    '--text-muted': p.textMuted, '--text-dim': p.textDim,
    '--accent': p.accent, '--accent-bright': p.accentLight, '--accent-dim': p.accentHover,
    '--accent-glow': p.accentGlow, '--accent-text': p.accentText,
    '--success': p.success, '--success-bg': p.successBg,
    '--warning': p.warning, '--warning-bg': p.warningBg,
    '--danger': p.danger, '--danger-bg': p.dangerBg,
    '--info': p.info, '--info-bg': p.infoBg,
    '--violet': p.violet, '--violet-bg': p.violetBg,
    '--gold': p.gold, '--gold-bg': p.goldBg,
    '--shadow': p.shadow, '--shadow-sm': p.shadowSm, '--shadow-glow': p.shadowGlow,
    '--nav-hover': p.navHover, '--nav-active': p.navActive,
    '--gradient-amber': p.gradientAccent,
  };
}

// The legacy `t` object: the palette's own keys plus the CSS-var spellings,
// because a handful of older components read e.g. t['--bg-primary'] directly.
export function themeObject(p) {
  return { ...p, ...cssVars(p) };
}

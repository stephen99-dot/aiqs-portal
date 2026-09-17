// Brand colour helpers shared by the client-copy previews (Builder Pack page,
// Branding page). They mirror the guards the XLSX generator applies server-side
// (server/docTemplates.js), so what the customer sees on screen is what the
// downloaded sheet does with the same colours.

const HEX = /^#[0-9a-fA-F]{6}$/;

export function safeHex(hex, fallback) {
  return typeof hex === 'string' && HEX.test(hex) ? hex : fallback;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(c) {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// Perceived brightness 0–255.
export function luminance(hex) {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function tint(hex, p) {
  return toHex(rgb(hex).map((v) => v + (255 - v) * p));
}
export function shade(hex, p) {
  return toHex(rgb(hex).map((v) => v * (1 - p)));
}

// Black or white text so copy on the brand colour is always legible.
export function idealTextOn(hex) {
  return luminance(hex) > 150 ? '#14161A' : '#FFFFFF';
}

// The accent as text on white paper: darkened when it is too pale to read.
export function accentText(hex) {
  return luminance(hex) > 150 ? shade(hex, 0.45) : hex;
}

// The accent as text on the brand block: falls back to the block's own text
// colour when the two are too close in brightness to separate.
export function accentOnPrimary(accent, primary) {
  return Math.abs(luminance(accent) - luminance(primary)) < 70 ? idealTextOn(primary) : accent;
}

// Trade swatches: tints of the brand colour, cycling so neighbours differ.
const TINT_STEPS = [0, 0.2, 0.4, 0.6, 0.75];
export function tradeTint(primary, i) {
  return tint(primary, TINT_STEPS[i % TINT_STEPS.length]);
}

// Headline money figure size (px) by character count, so £9,760 and
// £9,760,000.00 both fit the brand block without wrapping.
export function heroFontPx(text) {
  const len = String(text || '').length;
  if (len <= 8) return 32;
  if (len <= 10) return 28;
  if (len <= 12) return 25;
  if (len <= 14) return 22;
  return 19;
}

// Project title size (px) by length; the title is also clamped to two lines.
export function titleFontPx(text) {
  const len = String(text || '').length;
  if (len <= 36) return 22;
  if (len <= 70) return 18;
  return 15;
}

// Is the logo's visible ink light (a white/pale wordmark)? Sampled from a tiny
// canvas so a white logo gets a dark plate instead of vanishing on paper.
// Resolves false whenever it cannot tell (no canvas, tainted image, error).
export function detectLightLogo(url) {
  return new Promise((resolve) => {
    if (!url || typeof document === 'undefined') return resolve(false);
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = 48, h = Math.max(1, Math.round(48 * img.naturalHeight / (img.naturalWidth || 1)));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, 0, w, h).data;
          let sum = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 40) continue;
            sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            n++;
          }
          resolve(n > 0 && sum / n > 190);
        } catch (e) { resolve(false); }
      };
      img.onerror = () => resolve(false);
      img.src = url;
    } catch (e) { resolve(false); }
  });
}

#!/usr/bin/env node
// Renders the app icon and launch-screen artwork from one SVG definition.
//
//   node scripts/build-app-icons.js
//
// Writes:
//   resources/icon-only.png      1024×1024  — source for @capacitor/assets (iOS app icon)
//   resources/splash.png         2732×2732  — launch screen, light
//   resources/splash-dark.png    2732×2732  — launch screen, dark
//   public/icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png
//
// Then `npx capacitor-assets generate --ios` fills every size Xcode needs.
// The mark is the portal's loading tile: amber gradient, faint drawing-sheet
// grid, "QS" in a bold serif. Icons are opaque squares — iOS applies the
// rounded mask itself and rejects transparency.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const AMBER_A = '#F59E0B', AMBER_B = '#D97706', INK = '#0A0F1C';
const LIGHT_BG = '#F5F7FA', DARK_BG = '#141C2E';

// The tile itself. `size` is the full square; the artwork is drawn in a
// 1000-unit coordinate space.
function tileSvg({ radius = 0, grid = true } = {}) {
  const lines = [];
  if (grid) {
    for (let i = 1; i < 6; i++) {
      const p = (i * 1000) / 6;
      lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="1000"/>`);
      lines.push(`<line x1="0" y1="${p}" x2="1000" y2="${p}"/>`);
    }
  }
  return `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${AMBER_A}"/>
      <stop offset="1" stop-color="${AMBER_B}"/>
    </linearGradient>
  </defs>
  <rect width="1000" height="1000" rx="${radius}" fill="url(#g)"/>
  <g stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="3">${lines.join('')}</g>
  <line x1="120" y1="880" x2="880" y2="120" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="6" stroke-linecap="round"/>
  <text x="500" y="640" text-anchor="middle" font-family="DM Serif Display, DejaVu Serif, Liberation Serif, Georgia, serif"
        font-weight="700" font-size="470" letter-spacing="-18" fill="${INK}">QS</text>`;
}

function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">${tileSvg()}</svg>`;
}

// Maskable / PWA icons keep the artwork inside the safe zone (80%).
function maskableSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">
    <rect width="1000" height="1000" fill="${AMBER_B}"/>
    <g transform="translate(100 100) scale(0.8)">${tileSvg({ radius: 0 })}</g>
  </svg>`;
}

// Launch screen: solid background, the tile centred with iOS-style corner
// radius, the wordmark beneath. @capacitor/assets crops this square to each
// device, so everything important stays within the central third.
function splashSvg(size, dark) {
  const bg = dark ? DARK_BG : LIGHT_BG;
  const text = dark ? '#F1F5F9' : '#14181F';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 2732 2732">
    <rect width="2732" height="2732" fill="${bg}"/>
    <g transform="translate(1166 1086) scale(0.4)">${tileSvg({ radius: 220 })}</g>
    <text x="1366" y="1660" text-anchor="middle" font-family="Instrument Sans, DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif"
          font-weight="800" font-size="110" letter-spacing="2" fill="${text}">AI <tspan fill="${AMBER_A}">QS</tspan></text>
    <text x="1366" y="1740" text-anchor="middle" font-family="Instrument Sans, DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif"
          font-weight="600" font-size="40" letter-spacing="12" fill="${dark ? '#94A3B8' : '#8A94A6'}">QUANTITY SURVEYING</text>
  </svg>`;
}

async function png(svg, out, size) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
  console.log('wrote', path.relative(ROOT, out));
}

(async () => {
  await png(iconSvg(1024), path.join(ROOT, 'resources/icon-only.png'), 1024);
  await png(splashSvg(2732, false), path.join(ROOT, 'resources/splash.png'), 2732);
  await png(splashSvg(2732, true), path.join(ROOT, 'resources/splash-dark.png'), 2732);
  await png(iconSvg(512), path.join(ROOT, 'public/icons/icon-512.png'), 512);
  await png(iconSvg(192), path.join(ROOT, 'public/icons/icon-192.png'), 192);
  await png(iconSvg(180), path.join(ROOT, 'public/icons/apple-touch-icon.png'), 180);
  await png(maskableSvg(512), path.join(ROOT, 'public/icons/maskable-512.png'), 512);
})().catch((e) => { console.error(e); process.exit(1); });

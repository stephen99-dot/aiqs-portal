#!/usr/bin/env node
// Render the email icons from their SVG sources to PNG.
//
// Email clients cannot be trusted with SVG: Gmail strips inline <svg> and
// refuses SVG in <img>, Outlook on Windows drops both. So the SVGs in
// public/email-icons/ are the source of truth and the PNGs beside them are
// what the emails actually reference (served from the portal's public
// folder). Re-run after editing an SVG, and commit the PNGs — Render only
// runs the React build, not this.
//
//   node scripts/build-email-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.join(__dirname, '..', 'public', 'email-icons');
const SIZE = 80; // rendered at 2x for a 40px box in the email

(async () => {
  const svgs = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));
  for (const f of svgs) {
    const out = path.join(dir, f.replace(/\.svg$/, '.png'));
    await sharp(path.join(dir, f), { density: 300 }).resize(SIZE, SIZE).png().toFile(out);
    console.log('wrote', path.relative(process.cwd(), out));
  }
})().catch((e) => { console.error(e); process.exit(1); });

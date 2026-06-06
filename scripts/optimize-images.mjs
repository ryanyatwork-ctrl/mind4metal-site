#!/usr/bin/env node
// Image optimizer for mind4metal-site (non-destructive).
//
// WHY: several loaded images are far larger than their displayed size, hurting
// page-load (esp. mobile). This script writes optimized copies to ./optimized/
// at sensible dimensions + WebP. It does NOT overwrite originals or change any
// references — review the output, then swap references yourself.
//
// RUN (from repo root, needs Node 18+):
//   npm init -y >/dev/null 2>&1 || true
//   npm i sharp
//   node scripts/optimize-images.mjs
//
// After reviewing ./optimized/*, update references (examples in OPTIMIZE_IMAGES.md):
//   - CSS  background-image: Mind4Metal_Background.png  -> optimized/Mind4Metal_Background.webp
//   - footer/nav dragon <img src>                        -> optimized/Mind4Metal_Dragon-256.webp
//   - OG image (Mind4Metal_Banner.png)                   -> optimized/Mind4Metal_Banner-og.jpg
//   - art-manifest Chrome_Viper_cover.png                -> optimized/Chrome_Viper_cover-600.webp

import { mkdir, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

let sharp;
try { sharp = (await import('sharp')).default; }
catch { console.error('Missing dependency. Run:  npm i sharp'); process.exit(1); }

const OUT = 'optimized';
await mkdir(OUT, { recursive: true });

// [source, [ {suffix, width, format, options} ... ]]
const JOBS = [
  // Full-page CSS background — rendered at ~6-8% opacity, very forgiving.
  ['Mind4Metal_Background.png', [
    { name: 'Mind4Metal_Background.webp', width: 1600, format: 'webp', opts: { quality: 70 } },
  ]],
  // Dragon mark — shown at 28px (footer) / 44px (nav) / 120px (admin login).
  ['Mind4Metal_Dragon.png', [
    { name: 'Mind4Metal_Dragon-256.webp', width: 256, format: 'webp', opts: { quality: 82 } },
    { name: 'Mind4Metal_Dragon-256.png',  width: 256, format: 'png',  opts: { compressionLevel: 9, palette: true } },
  ]],
  // Social/OG preview — should be ~1200x630, well under 1MB.
  ['Mind4Metal_Banner.png', [
    { name: 'Mind4Metal_Banner-og.jpg', width: 1200, format: 'jpeg', opts: { quality: 82, mozjpeg: true } },
  ]],
  // Curated album cover — displayed at 220px; 600px covers retina.
  ['Chrome_Viper_cover.png', [
    { name: 'Chrome_Viper_cover-600.webp', width: 600, format: 'webp', opts: { quality: 85 } },
    { name: 'Chrome_Viper_cover-600.jpg',  width: 600, format: 'jpeg', opts: { quality: 85, mozjpeg: true } },
  ]],
];

const kb = n => (n / 1024).toFixed(0) + ' KB';
async function size(p) { try { return (await stat(p)).size; } catch { return 0; } }

let savedTotal = 0;
for (const [src, outputs] of JOBS) {
  const srcSize = await size(src);
  if (!srcSize) { console.log(`skip (missing): ${src}`); continue; }
  for (const o of outputs) {
    const dest = path.join(OUT, o.name);
    let img = sharp(src).resize({ width: o.width, withoutEnlargement: true });
    img = o.format === 'webp' ? img.webp(o.opts)
        : o.format === 'jpeg' ? img.jpeg(o.opts)
        : img.png(o.opts);
    await img.toFile(dest);
    const outSize = await size(dest);
    savedTotal += Math.max(0, srcSize - outSize);
    console.log(`${src} (${kb(srcSize)})  ->  ${dest} (${kb(outSize)})`);
  }
}
console.log(`\nApprox per-asset savings vs original: ~${kb(savedTotal)} (before reference swaps).`);
console.log('Originals are untouched. Review ./optimized/ then update references.');

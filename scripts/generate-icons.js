// scripts/generate-icons.js — generate PWA icon files from public/logo.png
// Run once: node scripts/generate-icons.js
// devDependency: sharp

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const logoBuf = readFileSync(resolve(root, 'public/logo.png'));

const BG = { r: 13, g: 13, b: 26, alpha: 1 }; // #0d0d1a

const sizes = [
  { name: 'logo-192.png',         size: 192 },
  { name: 'logo-512.png',         size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  const logoSize = Math.round(size * 0.7);

  const resizedLogo = await sharp(logoBuf)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: resizedLogo, gravity: 'center' }])
    .png()
    .toFile(resolve(root, 'public', name));

  console.log(`✓ public/${name}  (${size}×${size})`);
}

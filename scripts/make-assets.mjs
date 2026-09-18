// Resizes the root brand PNGs into web-sized assets under assets/brand/.
// Run: npm run assets  (outputs are committed so the build does not need sharp).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('assets/brand', { recursive: true });
const jobs = [
  ['LT26-logo.png', 'assets/brand/logo-512.webp', { width: 512 }],
  ['LT26-logo.png', 'assets/brand/logo-160.webp', { width: 160 }],
  ['LT26-mascot.png', 'assets/brand/talilei-1024.webp', { height: 1024 }],
  ['LT26-mascot.png', 'assets/brand/talilei-512.webp', { height: 512 }],
];
for (const [src, out, size] of jobs) {
  await sharp(src).resize(size).webp({ quality: 88, alphaQuality: 100 }).toFile(out);
  console.log('wrote', out);
}

// PWA icons from the logo. "any" icons keep transparency; maskable ones sit on navy with 12% padding.
mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512]) {
  await sharp('LT26-logo.png')
    .resize(s, s)
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toFile(`public/icons/icon-${s}.png`);
  const inner = Math.round(s * 0.72);
  const logo = await sharp('LT26-logo.png').resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: s, height: s, channels: 4, background: '#000E29' } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(`public/icons/maskable-${s}.png`);
}
{
  const logo = await sharp('LT26-logo.png').resize(152, 152).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: '#000E29' } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile('public/icons/apple-touch-icon.png');
}
console.log('wrote public/icons');

// Captures docs/screenshots/render-<cam>-<mode>.png from the render harness and logs getStats() per view.
// Usage: start `npx vite --port 5174 --strictPort` in the repo root, then `node tests/harness/shoot.mjs [outDir] [--extra]`.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.HARNESS_URL ?? 'http://localhost:5174/tests/harness/render.html';
const outDir = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'docs/screenshots');
const extra = process.argv.includes('--extra');
mkdirSync(outDir, { recursive: true });

const views = [
  ['kick', 'freeKick'],
  ['kick', 'penalty'],
  ['kick', 'longShot'],
  ['replay', 'freeKick'],
  ['replay', 'penalty'],
  ['title', 'freeKick'],
];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

async function grab(query, file) {
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.__harness && window.__harness.ready && window.__harness.frames > 3, null, {
    timeout: 60_000,
  });
  const frames0 = await page.evaluate(() => window.__harness.frames);
  await page.waitForFunction((f) => window.__harness.frames > f + 2, frames0, { timeout: 60_000 });
  const h = await page.evaluate(() => window.__harness);
  if (file) await page.screenshot({ path: resolve(outDir, file) });
  return h;
}

for (const [cam, mode] of views) {
  const h = await grab(`cam=${cam}&mode=${mode}`, `render-${cam}-${mode}.png`);
  const s = await grab(`cam=${cam}&mode=${mode}&static=1`, null);
  console.log(
    `${cam.padEnd(6)} ${mode.padEnd(9)} total ${h.stats.drawCalls} calls / ${h.stats.triangles} tris | static ${s.stats.drawCalls} calls / ${s.stats.triangles} tris | ball ${JSON.stringify(h.ball)} | goal-plane round trip ${JSON.stringify(h.roundTrip)}`,
  );
}
if (extra) {
  await grab('cam=kick&mode=freeKick&markers=1', 'debug-markers.png');
  await page.goto(`${BASE}?view=mascot`);
  await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 30_000 });
  await page.screenshot({ path: resolve(outDir, 'debug-mascot.png') });
}
console.log(errors.length ? `console:\n${errors.join('\n')}` : 'console: clean');
await browser.close();

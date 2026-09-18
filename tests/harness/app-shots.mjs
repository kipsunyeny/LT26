// Captures the §7.4 review screenshots of the production build into docs/screenshots/.
// Usage: npx vite build --outDir dist-shots && npx vite preview --outDir dist-shots --port 4190 --strictPort &
//        node tests/harness/app-shots.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:4190/';
const sizes = [
  [1280, 800],
  [2560, 1600],
];
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

async function frames(page, n = 3) {
  for (let i = 0; i < n; i += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

async function kick(page) {
  await page.evaluate(() => {
    const sim = window.__lt26.sim;
    sim.applyIntent({
      kind: 'strike',
      scheme: 'dial',
      aim: { kind: 'target', x: -3.3, y: 2.2 },
      power: 35 / 75,
      sideSpin: 9,
      topSpin: 0,
      atMs: sim.state.time * 1000,
    });
    for (let t = 0; t < 12 && sim.state.phase !== 'result'; t += 0.1) sim.update(0.1);
    for (let i = 0; i < 10; i += 1) sim.update(0.1);
  });
  await page.getByTestId('shot-card').waitFor();
}

for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    Date.now = () => 1_750_000_000_000;
    localStorage.setItem(
      'lt26.settings.v1',
      JSON.stringify({ controlScheme: 'dial', altitude: 'nairobi', sound: false, footed: 'right' }),
    );
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300_000);
  page.on('console', (m) => m.type() === 'error' && errors.push(`${w}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${w}: ${e}`));
  const shot = async (name) => {
    await frames(page);
    await page.screenshot({ path: `docs/screenshots/app-${name}-${w}x${h}.png` });
    console.log('wrote', name, w, h);
  };
  await page.goto(base);
  await page.waitForFunction(() => '__lt26' in window);
  await page.waitForTimeout(1500);
  await shot('title');
  for (const mode of ['penalty', 'longShot', 'freeKick']) {
    await page.getByTestId(`btn-mode-${mode}`).click();
    await page.getByTestId('hud').waitFor();
    await frames(page, 6);
    await shot(`play-${mode}`);
    await page
      .getByTestId('btn-back')
      .click()
      .catch(() => page.goto(base));
    await page.waitForTimeout(300);
  }
  await page.getByTestId('btn-mode-freeKick').click();
  await page.getByTestId('hud').waitFor();
  await frames(page, 6);
  await kick(page);
  await shot('shot-card');
  await page.getByTestId('btn-replay').click();
  await page.waitForTimeout(2500);
  await shot('replay');
  await page.goto(base);
  await page.waitForFunction(() => '__lt26' in window);
  await page.getByTestId('btn-stats').click();
  await shot('stats');
  await ctx.close();
}
await browser.close();
if (errors.length) {
  console.error('console errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('no console errors');

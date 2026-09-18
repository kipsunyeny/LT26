import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { DebugHook } from '../../src/contracts';

// Brief §7 item 2: the service worker serves the whole app offline after the first load — both at the
// server root (vite preview, the Playwright webServer) and under a GitHub-Pages-like sub-path (/LT26/).

const OUT = resolve(process.env.PW_OUT ?? 'dist');
const SUB_PATH = '/LT26/';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Minimal static server that serves the build folder only under SUB_PATH (everything else is 404). */
function serveUnderSubPath(): Promise<Server> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!path.startsWith(SUB_PATH)) {
      res.writeHead(404).end();
      return;
    }
    let file = normalize(join(OUT, path.slice(SUB_PATH.length)));
    if (file !== OUT && !file.startsWith(OUT + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function expectBootsOffline(page: Page, context: BrowserContext, url: string, chromium: boolean): Promise<void> {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText ?? '?'})`));

  const title = page.locator('[data-testid="btn-mode-freeKick"]');
  await page.goto(url);
  await expect(title).toBeVisible({ timeout: 30_000 });
  expect(await title.count()).toBeGreaterThan(0);

  // Wait until the precaching worker is active, then make sure it controls this page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter((k) => k.startsWith('lt26-'));
    const urls = keys.length ? (await (await caches.open(keys[0])).keys()).map((r) => r.url) : [];
    return { keys, urls };
  });
  expect(cached.keys).toHaveLength(1);
  expect(cached.urls.some((u) => u.endsWith('/index.html'))).toBe(true);
  expect(cached.urls.some((u) => u.endsWith('/manifest.webmanifest'))).toBe(true);
  expect(cached.urls.some((u) => /\/assets\/[^/]+\.js$/.test(u))).toBe(true);
  expect(cached.urls.every((u) => u.startsWith(new URL('./', page.url()).href))).toBe(true);

  await context.setOffline(true);
  const notFromWorker: string[] = [];
  page.on('response', (r) => {
    if (!r.fromServiceWorker()) notFromWorker.push(r.url());
  });
  await page.reload();
  await expect(title).toBeVisible({ timeout: 30_000 });
  // The 3D scene (title camera) renders from cached code and assets.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const hook = (window as unknown as { __lt26?: DebugHook }).__lt26;
          return hook?.scene?.getStats().drawCalls ?? 0;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(1000);

  expect(failed).toEqual([]);
  // Response.fromServiceWorker() is only reported by Chromium; on WebKit/Firefox a successful
  // offline boot with no failed requests is itself the proof that the worker served the files.
  if (chromium) expect(notFromWorker).toEqual([]);
  expect(errors).toEqual([]);
  await context.setOffline(false);
}

test.describe('offline (service worker)', () => {
  test.slow();

  test('boots offline at the server root after the first load', async ({ page, context, browserName }) => {
    await expectBootsOffline(page, context, './', browserName === 'chromium');
  });

  test('boots offline under the /LT26/ sub-path after the first load', async ({ page, context, browserName }) => {
    expect(existsSync(join(OUT, 'index.html')), `build folder ${OUT}`).toBe(true);
    const server = await serveUnderSubPath();
    try {
      const { port } = server.address() as AddressInfo;
      await expectBootsOffline(page, context, `http://127.0.0.1:${port}${SUB_PATH}`, browserName === 'chromium');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});

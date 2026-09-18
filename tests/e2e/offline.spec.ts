import { expect, test } from '@playwright/test';

// Brief §7 item 2: the service worker serves the whole app offline after the first load.
test('app boots offline from the service worker after the first load', async ({ page, context, browserName }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure()?.errorText ?? '?'})`));

  await page.goto('./');
  await page.waitForFunction(() => '__lt26' in window);
  const titleButtons = page.locator('[data-testid="btn-mode-freeKick"]');
  const onlineTitleCount = await titleButtons.count();

  // Wait until the precaching worker is active, then make sure it controls this page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
  }
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const lt = keys.filter((k) => k.startsWith('lt26-'));
    const urls = lt.length ? (await (await caches.open(lt[0])).keys()).map((r) => r.url) : [];
    return { caches: lt, urls };
  });
  expect(cached.caches).toHaveLength(1);
  expect(cached.urls.some((u) => u.endsWith('/index.html'))).toBe(true);
  expect(cached.urls.some((u) => u.endsWith('/manifest.webmanifest'))).toBe(true);
  expect(cached.urls.some((u) => /\/assets\/[^/]+\.js$/.test(u))).toBe(true);

  await context.setOffline(true);
  const notFromWorker: string[] = [];
  page.on('response', (r) => {
    if (!r.fromServiceWorker()) notFromWorker.push(r.url());
  });
  await page.reload();
  await page.waitForFunction(() => '__lt26' in window);
  await expect(page.locator('#ui')).not.toBeEmpty();
  // Whatever the title screen showed online, it shows offline too.
  await expect(titleButtons).toHaveCount(onlineTitleCount);
  if (onlineTitleCount > 0) await expect(titleButtons.first()).toBeVisible();
  await page.waitForTimeout(1000);

  expect(failed).toEqual([]);
  // Response.fromServiceWorker() is only reported by Chromium; on WebKit/Firefox a successful
  // offline boot with no failed requests is itself the proof that the worker served the files.
  if (browserName === 'chromium') expect(notFromWorker).toEqual([]);
  expect(errors).toEqual([]);
  await context.setOffline(false);
});

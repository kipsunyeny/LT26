import { expect, test } from '@playwright/test';

test('app boots without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./');
  await expect(page.locator('#ui')).toBeVisible();
  expect(errors).toEqual([]);
});

// UI E2E: navigation, settings persistence, reset confirm, HUD layout (Talilei's corner stays
// free of controls), rotate prompt, spot selection. Independent of the sim's kick outcome.
import { expect, test, type Page } from '@playwright/test';

// Headless WebGL (SwiftShader) is very slow on the high-DPR tablet profile: triple time.
test.beforeEach(() => test.slow());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    errors.push(`unexpected dialog: ${d.type()}`);
    void d.dismiss();
  });
  return errors;
}

const screen = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __lt26: { screen(): string } }).__lt26.screen());

const simMode = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __lt26: { sim: { state: { mode: string } } } }).__lt26.sim.state.mode);

test('navigates between all screens without console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByTestId('talilei')).toBeVisible();
  await expect(page.getByTestId('title-logo')).toBeVisible();
  expect(await screen(page)).toBe('title');

  for (const mode of ['freeKick', 'penalty', 'longShot'] as const) {
    await page.getByTestId(`btn-mode-${mode}`).click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('hud-logo')).toBeVisible();
    expect(await screen(page)).toBe('play');
    expect(await simMode(page)).toBe(mode);
    await expect(page.getByTestId(`tab-${mode}`)).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('btn-back').click();
    expect(await screen(page)).toBe('title');
  }

  await page.getByTestId('btn-mode-freeKick').click();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('spot-fk-centre')).toBeVisible();
  await page.getByTestId('tab-penalty').click();
  await expect(page.getByTestId('toggle-disguise')).toBeVisible();
  await expect(page.getByTestId('minimap')).toHaveCount(0);
  await page.getByTestId('tab-longShot').click();
  await expect(page.getByTestId('spot-ls-left')).toBeVisible();
  await page.getByTestId('btn-back').click();

  await page.getByTestId('btn-stats').click();
  await expect(page.getByTestId('stats-table')).toBeVisible();
  expect(await screen(page)).toBe('stats');
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('setting-scheme')).toBeVisible();
  expect(await screen(page)).toBe('settings');
  await page.getByTestId('btn-back').click();
  expect(await screen(page)).toBe('title');
  expect(errors).toEqual([]);
});

test('settings persist across reload and reach the sim', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('setting-scheme').selectOption('dial');
  await page.getByTestId('setting-altitude').selectOption('sea');
  await page.getByTestId('setting-footed').selectOption('left');
  await page.getByTestId('setting-sound').uncheck();
  await page.reload();
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('setting-scheme')).toHaveValue('dial');
  await expect(page.getByTestId('setting-altitude')).toHaveValue('sea');
  await expect(page.getByTestId('setting-footed')).toHaveValue('left');
  await expect(page.getByTestId('setting-sound')).not.toBeChecked();
  const s = await page.evaluate(
    () => (window as unknown as { __lt26: { sim: { state: { settings: unknown } } } }).__lt26.sim.state.settings,
  );
  expect(s).toEqual({ controlScheme: 'dial', altitude: 'sea', sound: false, footed: 'left' });
  // The play screen uses the chosen scheme, and left-footed labels mirror.
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-mode-freeKick').click();
  await expect(page.getByTestId('input-layer')).toHaveAttribute('data-scheme', 'dial');
  await page.getByTestId('knob-curve').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('knob-curve')).toContainText('inside · curls right');
  expect(errors).toEqual([]);
});

test('reset data uses an inline confirmation', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('btn-reset-data').click();
  await expect(page.getByTestId('btn-reset-confirm')).toBeVisible();
  await page.getByTestId('btn-reset-cancel').click();
  await expect(page.getByTestId('btn-reset-confirm')).toBeHidden();
  await page.getByTestId('btn-reset-data').click();
  await page.getByTestId('btn-reset-confirm').click();
  await expect(page.getByTestId('reset-status')).toHaveText(/deleted/);
  expect(errors).toEqual([]);
});

test('free kick spot presets and mini-map drag call the sim', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('btn-mode-freeKick').click();
  await page.evaluate(() => {
    const w = window as unknown as { __spots: unknown[]; __lt26: { sim: { setSpot(s: unknown): void } } };
    w.__spots = [];
    const sim = w.__lt26.sim;
    const orig = sim.setSpot.bind(sim);
    sim.setSpot = (s: unknown) => {
      w.__spots.push(s);
      orig(s);
    };
  });
  await page.getByTestId('spot-fk-left-d').click();
  const mm = (await page.getByTestId('minimap').boundingBox())!;
  await page.mouse.move(mm.x + mm.width * 0.7, mm.y + mm.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(mm.x + mm.width * 0.75, mm.y + mm.height * 0.75, { steps: 3 });
  await page.mouse.up();
  const spots = await page.evaluate(() => (window as unknown as { __spots: unknown[] }).__spots);
  expect(spots[0]).toBe('fk-left-d');
  const placed = spots[1] as { x: number; z: number };
  const d = Math.hypot(placed.x, placed.z);
  expect(d).toBeGreaterThanOrEqual(15.5);
  expect(d).toBeLessThanOrEqual(35.5);
  expect(placed.x).toBeGreaterThan(0);
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1200 },
]) {
  test(`HUD controls keep Talilei's bottom-left corner free at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const scheme of ['dial', 'swipe'] as const) {
      await page.goto('./');
      await page.evaluate((s) => {
        localStorage.setItem(
          'lt26.settings.v1',
          JSON.stringify({ controlScheme: s, altitude: 'nairobi', sound: false, footed: 'right' }),
        );
      }, scheme);
      await page.reload();
      for (const mode of ['freeKick', 'penalty', 'longShot'] as const) {
        await page.getByTestId(`btn-mode-${mode}`).click();
        await expect(page.getByTestId('input-layer')).toHaveAttribute('data-scheme', scheme);
        const zone = { x: 0, y: size.height * 0.55, w: size.width * 0.3, h: size.height * 0.45 };
        const boxes = await page.evaluate(() => {
          const sel = [
            '[data-testid="hud"] button',
            '[data-testid="hud"] [role="slider"]',
            '[data-testid="hud"] .hud-side',
            '[data-testid="hud"] .hint',
            '[data-testid="hud"] .dial-box',
            '[data-testid="hud"] .dial-aim',
            '[data-testid="hud-logo"]',
          ].join(', ');
          return [...document.querySelectorAll<HTMLElement>(sel)]
            .filter((e) => e.offsetParent !== null)
            .map((e) => {
              const r = e.getBoundingClientRect();
              const interactive = e.tagName === 'BUTTON' || e.getAttribute('role') === 'slider';
              return { id: e.dataset.testid ?? e.className, interactive, x: r.x, y: r.y, w: r.width, h: r.height };
            });
        });
        expect(boxes.length).toBeGreaterThan(3);
        const overlapping = boxes.filter(
          (b) => b.w > 0 && b.x < zone.x + zone.w && b.x + b.w > zone.x && b.y < zone.y + zone.h && b.y + b.h > zone.y,
        );
        expect(overlapping, `${scheme}/${mode}`).toEqual([]);
        const small = boxes.filter((b) => b.interactive && (b.w < 44 || b.h < 44));
        expect(small, `${scheme}/${mode} small targets`).toEqual([]);
        await page.getByTestId('btn-back').click();
      }
    }
  });
}

test('rotate prompt shows in portrait only', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
});

// Visual baselines (brief §7.2 / §7.4) at 1280×800: title, each mode's play screen (swipe and dial HUD),
// a shot card, replay, stats and settings. The 3D canvas is hidden only where it animates on its own
// (title and replay orbit cameras, post-result ball roll); the kick camera is still and is compared.
// A deterministic seed (Date.now frozen before boot) makes the scripted kick and its card repeatable.
// Unmasked copies are written to the test output folder for human review.
// Screenshots use CSS-pixel scale, so the tablet (DPR 2.25) baselines are 1280×800 too.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { freezeSeed, openMode, seedSettings, stableBall, watchErrors, type Mode, type Scheme } from './helpers/qa';

test.use({ viewport: { width: 1280, height: 800 } });
// A stable screenshot of the live WebGL page at the tablet's DPR 2.25 takes minutes under SwiftShader.
test.describe.configure({ timeout: 600_000 });

/**
 * Hides the self-animating 3D canvas for a screenshot (the body's navy background shows instead). Not a `mask`:
 * Playwright paints a mask box on top of everything, and the full-screen canvas box would cover the whole UI.
 */
async function hideScene(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((on) => {
    const w = window as unknown as {
      __qaRender?: (world: unknown, dt: number) => void;
      __lt26: { scene: { render(world: unknown, dt: number): void } | null };
    };
    const sc = w.__lt26.scene;
    document.getElementById('qa-hide-scene')?.remove();
    if (on) {
      // Pause WebGL drawing too: headless screenshots wait for frames, and SwiftShader frames of a hidden
      // canvas stall the capture for minutes.
      if (sc && !w.__qaRender) {
        w.__qaRender = sc.render.bind(sc);
        sc.render = () => undefined;
      }
      const st = document.createElement('style');
      st.id = 'qa-hide-scene';
      st.textContent = '#scene { display: none !important; }';
      document.head.append(st);
    } else if (sc && w.__qaRender) {
      sc.render = w.__qaRender;
      delete w.__qaRender;
    }
  }, hidden);
}

async function review(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`review-${name}.png`) });
}

/** Scripted, seeded free kick from fk-centre, flown to the result + 1 s on the sim clock. */
async function scriptedKick(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sim = (
      window as unknown as {
        __lt26: {
          sim: { state: { time: number; phase: string }; applyIntent(i: unknown): void; update(dt: number): void };
        };
      }
    ).__lt26.sim;
    sim.applyIntent({
      kind: 'strike',
      scheme: 'dial',
      aim: { kind: 'target', x: -3.3, y: 2.2 },
      power: (75 - 40) / 75,
      sideSpin: 9,
      topSpin: 0,
      atMs: sim.state.time * 1000,
    });
    for (let t = 0; t < 12 && sim.state.phase !== 'result'; t += 0.1) sim.update(0.1);
    for (let i = 0; i < 10; i += 1) sim.update(0.1);
  });
  await expect(page.getByTestId('shot-card')).toBeVisible();
}

test('title screen', async ({ page }, info) => {
  const errors = watchErrors(page);
  await seedSettings(page);
  await page.goto('./');
  await expect(page.getByTestId('talilei')).toBeVisible();
  await expect(page.getByTestId('title-logo')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await review(page, info, 'title');
  await hideScene(page, true);
  await expect(page).toHaveScreenshot('title.png', { scale: 'css', timeout: 150_000 });
  await hideScene(page, false);
  expect(errors).toEqual([]);
});

for (const [mode, scheme] of [
  ['freeKick', 'swipe'],
  ['penalty', 'swipe'],
  ['longShot', 'swipe'],
  ['freeKick', 'dial'],
] as [Mode, Scheme][]) {
  test(`play screen: ${mode} (${scheme})`, async ({ page }, info) => {
    const errors = watchErrors(page);
    await seedSettings(page, { controlScheme: scheme });
    await openMode(page, mode, scheme);
    await stableBall(page);
    await review(page, info, `play-${mode}-${scheme}`);
    await expect(page).toHaveScreenshot(`play-${mode}-${scheme}.png`, { scale: 'css', timeout: 150_000 });
    expect(errors).toEqual([]);
  });
}

test('shot card, replay and stats after a scripted kick', async ({ page }, info) => {
  const errors = watchErrors(page);
  await freezeSeed(page);
  await seedSettings(page, { controlScheme: 'dial' });
  await openMode(page, 'freeKick', 'dial');
  await stableBall(page);
  await scriptedKick(page);
  await review(page, info, 'shot-card');
  await hideScene(page, true);
  await expect(page).toHaveScreenshot('shot-card.png', { scale: 'css', timeout: 150_000 });
  await hideScene(page, false);

  await page.getByTestId('btn-replay').click();
  await expect(page.getByTestId('replay')).toBeVisible();
  await page.waitForTimeout(1500);
  await review(page, info, 'replay');
  await hideScene(page, true);
  await expect(page).toHaveScreenshot('replay.png', {
    scale: 'css',
    timeout: 150_000,
    mask: [page.locator('.replay-progress')],
  });
  await hideScene(page, false);

  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-back').click();
  await page.getByTestId('btn-stats').click();
  await expect(page.getByTestId('stats-table')).toBeVisible();
  await review(page, info, 'stats');
  await hideScene(page, true);
  await expect(page).toHaveScreenshot('stats.png', { scale: 'css', timeout: 150_000 });
  await hideScene(page, false);
  expect(errors).toEqual([]);
});

test('settings screen', async ({ page }, info) => {
  const errors = watchErrors(page);
  await seedSettings(page);
  await page.goto('./');
  await page.getByTestId('btn-settings').click();
  await expect(page.getByTestId('setting-scheme')).toBeVisible();
  await review(page, info, 'settings');
  await hideScene(page, true);
  await expect(page).toHaveScreenshot('settings.png', { scale: 'css', timeout: 150_000 });
  await hideScene(page, false);
  expect(errors).toEqual([]);
});

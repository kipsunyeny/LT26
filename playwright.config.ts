import { defineConfig, devices } from '@playwright/test';

// PW_PORT / PW_OUT let several agents run E2E concurrently without sharing a server or a dist folder.
const PORT = Number(process.env.PW_PORT ?? 4173);
const OUT = process.env.PW_OUT ?? 'dist';
const chromiumGl = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

// E2E runs against the production build served by `vite preview`.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.03 } },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `npx vite build --outDir ${OUT} --emptyOutDir && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions: chromiumGl },
    },
    {
      name: 'tablet-android',
      use: { ...devices['Galaxy Tab S4 landscape'], browserName: 'chromium', launchOptions: chromiumGl },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
  ],
});

// Static-folder check (brief §7 item 5). Builds nothing: serves an existing build with a plain
// `python3 -m http.server`, once under a sub-path (/LT26/, like GitHub Pages) and once at the root,
// then loads both in headless Chromium and fails on any HTTP error, failed request, console error or
// page error, or if the title screen does not appear. Also enforces the total download budget
// (brief §2: ≤ 6 MB for the whole build, service worker included).
//
// Usage: node scripts/static-check.mjs [buildDir=dist] [--allow-stub-ui]
//   --allow-stub-ui  accept a non-empty #ui instead of the title-screen mode button (early phases only).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const allowStub = args.includes('--allow-stub-ui');
const buildDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist');
const TITLE_SELECTOR = '[data-testid="btn-mode-freeKick"]';
const SUB_PATH = 'LT26';

if (!existsSync(join(buildDir, 'index.html'))) {
  console.error(`static-check: ${buildDir}/index.html not found — run \`npm run build\` first.`);
  process.exit(1);
}

const BUDGET_BYTES = 6_000_000;

function buildSize(dir) {
  const files = [];
  const walk = (p) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else files.push({ path: relative(dir, full), bytes: st.size });
    }
  };
  walk(dir);
  files.sort((a, b) => b.bytes - a.bytes);
  return { total: files.reduce((s, f) => s + f.bytes, 0), files };
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function serve(dir) {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], {
    stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.status < 500) return { port, stop: () => proc.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  proc.kill();
  throw new Error(`python3 http.server did not start on port ${port}`);
}

async function checkUrl(browser, url) {
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${String(e)}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? '?'})`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  let screen = 'none';
  try {
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.locator(TITLE_SELECTOR).waitFor({ state: 'visible', timeout: 20_000 });
      screen = 'title (btn-mode-freeKick visible)';
    } catch {
      const uiText = (await page.locator('#ui').innerHTML()).trim();
      if (allowStub && uiText.length > 0) screen = '#ui non-empty (title button not present; --allow-stub-ui)';
      else problems.push(`title screen not shown: ${TITLE_SELECTOR} not visible`);
    }
    // Give the service worker registration and any late asset requests a moment to surface errors.
    await page.waitForTimeout(1500);
  } finally {
    await context.close();
  }
  return { url, screen, problems };
}

const size = buildSize(buildDir);
const mb = (b) => (b / 1e6).toFixed(3) + ' MB';
console.log(`size ${mb(size.total)} in ${size.files.length} files (budget ${mb(BUDGET_BYTES)}); largest:`);
for (const f of size.files.slice(0, 5)) console.log(`       ${mb(f.bytes).padStart(10)}  ${f.path}`);
let failed = size.total > BUDGET_BYTES;
if (failed) console.error(`FAIL total download ${mb(size.total)} exceeds the ${mb(BUDGET_BYTES)} budget`);

const tmp = mkdtempSync(join(tmpdir(), 'lt26-static-'));
symlinkSync(buildDir, join(tmp, SUB_PATH), 'dir');
const servers = [];
let browser;
try {
  const sub = await serve(tmp);
  servers.push(sub);
  const root = await serve(buildDir);
  servers.push(root);
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  for (const url of [`http://127.0.0.1:${sub.port}/${SUB_PATH}/`, `http://127.0.0.1:${root.port}/`]) {
    const r = await checkUrl(browser, url);
    if (r.problems.length) {
      failed = true;
      console.error(`FAIL ${r.url}\n  ${r.problems.join('\n  ')}`);
    } else {
      console.log(`ok   ${r.url} — ${r.screen}, no 4xx/5xx, no failed requests, no console errors`);
    }
  }
} finally {
  await browser?.close();
  for (const s of servers) s.stop();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

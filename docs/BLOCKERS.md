# Blockers

Environment limits that prevented a step from being completed here. Everything else was finished; each entry says
exactly what the owner (or CI) has to do.

## B-1 — No GitHub account is linked, so the repository cannot be pushed and GitHub Pages cannot be deployed from here

**What is blocked.** This build environment has no GitHub credentials or linked account. The repository exists
locally with its full history, but it cannot be pushed, and the Pages deployment workflow cannot be run, so no live
URL exists yet.

**What is done.** `.github/workflows/pages.yml` builds with `npm ci && npm run build` and deploys `dist/` using
`actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`, with
`permissions: contents: read, pages: write, id-token: write` and a non-cancelling `pages` concurrency group. It
passes `@action-validator/cli` schema validation. The build it deploys has been served from a `/LT26/` sub-path with
a plain static server and boots without 404s (`npm run static-check`), so the GitHub Pages sub-path works.

**What the owner does (about 5 minutes).**

1. Create an empty repository on GitHub, e.g. `https://github.com/<user>/LT26` (no README, no licence, so the
   histories do not conflict).
2. In the project folder:
   ```sh
   git remote add origin https://github.com/<user>/LT26.git
   git push -u origin main --tags
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Deploy to GitHub Pages → Run workflow** (or push any commit to `main`). When the run is green the
   game is at `https://<user>.github.io/LT26/`.
5. Optional check: open that URL in Chrome on the tablet, install it (⋮ → Install app), switch on flight mode and
   start it from the home screen — it should boot to the title screen.

## B-2 — Playwright WebKit and Firefox cannot be downloaded here, so those E2E projects run only in CI

**What is blocked.** Browser downloads from `cdn.playwright.dev` are refused by this environment's network
allowlist. Only the pre-installed Chromium build is available, so the `webkit`, `ipad` and `firefox` Playwright
projects cannot be run locally.

**What is done.** All E2E specs run here on the `chromium` and `tablet-android` (Chromium with touch) projects. The
CI workflow (`.github/workflows/ci.yml`) runs one E2E job per Playwright project, each installing its own browser
with `npx playwright install --with-deps`, so WebKit, iPad and Firefox results come from the first CI run on GitHub
(which itself depends on B-1).

**What the owner does.** After pushing (B-1), open **Actions → CI** and check the `e2e (webkit)`, `e2e (ipad)` and `e2e (firefox)` jobs;
failures upload a `playwright-results-<project>` artifact. Record the WebKit/Firefox results in [TESTING.md](TESTING.md).

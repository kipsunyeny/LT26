# Testing record

Every verification the brief requires (§7) is recorded here with the command, the result as printed, and the commit
it was run at. A row that says _pending_ has not been run yet; nothing here is estimated or copied from elsewhere.
When the working tree had uncommitted changes at the time of a run, the commit is marked `+wip` (the base commit
the changes sit on).

## How to run everything

```sh
npm ci
npm run lint
npm test
npx playwright install --with-deps chromium webkit firefox
npm run e2e                     # all projects: chromium, tablet-android, webkit, ipad, firefox
                                # (CI runs one job per project; webkit/ipad/firefox with --grep-invert 'visual\.spec\.ts')
npm run build
npm run static-check            # after the build
```

Concurrent local runs can use their own port and output folder: `PW_PORT=4177 PW_OUT=dist-x npx playwright test …`.

## Results

| Check | Command | Result | Commit |
| --- | --- | --- | --- |
| Unit: physics acceptance tests (§4), keeper/wall/rules, input mapping | `npm test` | pending — run by orchestrator in Phase 3 | — |
| Lint (ESLint, Prettier, no TODO / disabled tests) | `npm run lint` | pending — run by orchestrator in Phase 3 | — |
| E2E Chromium (desktop + Android tablet emulation) | `npm run e2e -- --project=chromium --project=tablet-android` | pending — run by orchestrator in Phase 3 | — |
| E2E WebKit (desktop Safari + iPad), visual.spec.ts excluded (no WebKit baselines) | `npx playwright test --project=webkit --project=ipad --grep-invert 'visual\.spec\.ts'` | pending — runs in CI only, see [BLOCKERS.md](BLOCKERS.md) | — |
| E2E Firefox, visual.spec.ts excluded | `npx playwright test --project=firefox --grep-invert 'visual\.spec\.ts'` | pending — runs in CI only, see [BLOCKERS.md](BLOCKERS.md) | — |
| Offline (service worker serves the app with the network off), Chromium — server root and `/LT26/` sub-path | `PW_PORT=4177 PW_OUT=dist-release npx playwright test tests/e2e/offline.spec.ts --project=chromium` | **pass** — `2 passed (28.3s)`. For each URL: title button visible online (count > 0), worker active and controlling, one `lt26-<version>` cache holding index.html, manifest and hashed JS (all under the page's own path); offline reload shows the title button and `__lt26.scene.getStats().drawCalls > 0`, 0 failed requests, every response from the service worker, 0 console errors. | `a5361bb+wip` |
| Offline, all projects | `npm run e2e` (includes offline.spec.ts) | pending — run by orchestrator in Phase 3 (WebKit/Firefox in CI) | — |
| Performance: 300 frames of the free-kick scene (draw calls ≤ 40, triangles ≤ 80 k) | `npm run e2e -- --project=chromium` (perf spec) | pending — run by orchestrator in Phase 3 | — |
| Visual check at 1280×800 and 2560×1600, screenshots read by a person/agent | screenshots in `docs/screenshots/` | pending — run by orchestrator in Phase 3 | — |
| Build | `npm run build` | pending — run by orchestrator in Phase 3 | — |
| Static folder: build served by `python3 -m http.server` at `/LT26/` and at `/` | `npm run static-check` | Release engineer's run on a build of the fix-round tree (strict mode): **pass** on both URLs — title (`btn-mode-freeKick`) visible, no 4xx/5xx, no failed requests, no console errors. Negative control (Phase 0): a build made with `--base=/` fails under `/LT26/` with HTTP 404 on its JS/CSS. Final run pending — orchestrator in Phase 3. | `a5361bb+wip` |
| Download budget ≤ 6 MB | printed by `npm run static-check` (sum of every file in the build, `sw.js` included) | Fix-round tree: **1.274 MB** in 14 files; largest `assets/index-*.js` 0.648 MB, `icons/maskable-512.png` 0.179 MB, `assets/talilei-1024-*.webp` 0.106 MB, `icons/icon-512.png` 0.102 MB, `assets/logo-512-*.webp` 0.067 MB. Final figure pending — orchestrator in Phase 3. | `a5361bb+wip` |
| Workflow files valid | `npx --yes @action-validator/cli .github/workflows/ci.yml` (and `pages.yml`); `python3 -c "import yaml; yaml.safe_load(…)"` | **pass** — action-validator 0.6.0 exit 0 for both files after the fix round (CI split into a check job + per-project E2E matrix; Pages runs lint + unit before build); a deliberately broken workflow exits 1; both parse as YAML. `npx playwright test --list --project=firefox --grep-invert 'visual\.spec\.ts'` lists 58 tests with no visual.spec.ts entries. | `a5361bb+wip` |
| GitHub Pages deploy (real run) | push to `main`, Actions → "Deploy to GitHub Pages" | not runnable from this environment — see [BLOCKERS.md](BLOCKERS.md) | — |
| Fresh-clone check: clone, `npm ci`, whole suite, build | `git clone . /tmp/x && cd /tmp/x && npm ci && npm run lint && npm test && npm run e2e && npm run build` | pending — run by orchestrator in Phase 3 | — |

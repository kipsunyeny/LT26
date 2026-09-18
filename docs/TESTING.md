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
| E2E WebKit (desktop Safari + iPad) | `npm run e2e -- --project=webkit --project=ipad` | pending — runs in CI only, see [BLOCKERS.md](BLOCKERS.md) | — |
| E2E Firefox | `npm run e2e -- --project=firefox` | pending — runs in CI only, see [BLOCKERS.md](BLOCKERS.md) | — |
| Offline (service worker serves the app with the network off), Chromium | `PW_PORT=4177 PW_OUT=dist-release npx playwright test tests/e2e/offline.spec.ts --project=chromium` | **pass** — `1 passed (4.4s)`. Worker active and controlling, one `lt26-<version>` cache holding index.html, manifest and hashed JS; offline reload boots (`window.__lt26` defined, `#ui` non-empty), 0 failed requests, every response from the service worker, 0 console errors. Run against the Phase-0 UI stub (title screen not built yet). | `69fbc65+wip` |
| Offline, Android tablet emulation | same, `--project=tablet-android` | **pass** — `1 passed (4.1s)`, same assertions, Phase-0 UI stub | `69fbc65+wip` |
| Offline, full app with title screen | `npx playwright test tests/e2e/offline.spec.ts` | pending — run by orchestrator in Phase 3 | — |
| Performance: 300 frames of the free-kick scene (draw calls ≤ 40, triangles ≤ 80 k) | `npm run e2e -- --project=chromium` (perf spec) | pending — run by orchestrator in Phase 3 | — |
| Visual check at 1280×800 and 2560×1600, screenshots read by a person/agent | screenshots in `docs/screenshots/` | pending — run by orchestrator in Phase 3 | — |
| Build | `npm run build` | pending — run by orchestrator in Phase 3 | — |
| Static folder: build served by `python3 -m http.server` at `/LT26/` and at `/` | `npm run static-check` | Partial, Phase-0 stub build: with `--allow-stub-ui` **pass** on both URLs (no 4xx/5xx, no failed requests, no console errors, `#ui` non-empty); strict mode **fails** as expected because `[data-testid="btn-mode-freeKick"]` does not exist yet. Negative control: a build made with `--base=/` fails under `/LT26/` with HTTP 404 on its JS/CSS, so the check catches absolute paths. Full run pending — orchestrator in Phase 3. | `69fbc65+wip` |
| Download budget ≤ 6 MB | `npx vite build --outDir dist-release` + sum (also printed by `npm run static-check`) | Phase-0 stub build: **0.666 MB** in 10 files; largest `icons/icon-512.png` 0.324 MB, `icons/maskable-512.png` 0.194 MB. Not representative until three.js and the scene are in; re-measure in Phase 3. | `69fbc65+wip` |
| Workflow files valid | `npx --yes @action-validator/cli .github/workflows/pages.yml` (and `ci.yml`); `python3 -c "import yaml; yaml.safe_load(…)"` | **pass** — action-validator 0.6.0 exit 0 for both files (a deliberately broken workflow exits 1 with schema errors); both parse as YAML | `69fbc65+wip` |
| GitHub Pages deploy (real run) | push to `main`, Actions → "Deploy to GitHub Pages" | not runnable from this environment — see [BLOCKERS.md](BLOCKERS.md) | — |
| Fresh-clone check: clone, `npm ci`, whole suite, build | `git clone . /tmp/x && cd /tmp/x && npm ci && npm run lint && npm test && npm run e2e && npm run build` | pending — run by orchestrator in Phase 3 | — |

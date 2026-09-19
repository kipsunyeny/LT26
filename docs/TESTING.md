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

All rows below were run by the orchestrator in this environment (except where a row names the release engineer) (headless Chromium 141 with SwiftShader, 2 vCPU).
The **fresh-clone run** is the authoritative one: `git clone` of the repository at `96868f1` into an empty temp
folder, then `npm ci`, lint, unit, E2E on both locally available projects, build and static check, with no files
from the working tree.

| Check | Command | Result | Commit |
| --- | --- | --- | --- |
| Fresh-clone check (§7.6) | `git clone … && npm ci && npm run lint && npx vitest run && npx playwright test --project=chromium --project=tablet-android && npm run build && npm run static-check` | **pass** — `npm ci` 0 vulnerabilities; lint exit 0; **197/197** unit tests (24 files); **136/136** E2E (68 per project) in 53.0 min; build ok (13 files precached by `sw.js`); static check ok at `/LT26/` and `/` | `96868f1` |
| Lint (ESLint, Prettier, no TODO / disabled tests) | `npm run lint` | **pass** (exit 0, `no-todo: clean`) | `96868f1` |
| Unit: §4 physics acceptance rows | `npx vitest run tests/unit/physics.acceptance.test.ts` | **9/9 pass** (free flight, seed 2026): penalty 0.4203 s / 89.55 km/h · FK 8 rev/s dev 2.4957 m, 1.0455 s, 79.65 km/h · no spin dev 0.0070 m, t ×0.9924, v ×1.0006 · FK 90 km/h 10° 10 rev/s dev 3.1424 m · long shot top spin 1.7358 m lower · wall 2.3017 m at 9.15 m (back spin 10 rev/s, D-19) and proof the spinless case is impossible (vacuum 1.9297 m) · Nairobi 18.69 % less bend · energy worst error 3.19e-13 m | `96868f1` |
| Unit: everything (physics model/collisions/solver, keeper/wall/rules/outcomes, session log, input mapping swipe→KickIntent, UI brand colours, camera/projection, trail, audio) | `npm test` | **197/197 pass**, 24 files | `96868f1` |
| E2E Chromium desktop (1280×800) | `npx playwright test --project=chromium` | **68/68 pass** (16.5 min at `d2765c3`; again 68/68 in the fresh clone at `96868f1`) | `96868f1` |
| E2E Android tablet profile (Galaxy Tab S4 landscape, touch, DPR 2.25) | `npx playwright test --project=tablet-android` | **68/68 pass** in the fresh clone. Earlier run at `d2765c3`: 67/68 — the D-1 test after `perf.spec.ts` could not open a browser context (SwiftShader wedged after 300 frames at DPR 2.25); fixed by rendering the perf spec at DPR 1 (D-27), then verified | `96868f1` |
| Real touch swipe → kick → trajectory → result in each mode; dial + mouse; replay shows the recorded path; stats persist across reload; no console errors | `qa.integration.spec.ts`, `input.spec.ts`, `ui.spec.ts` (in the rows above) | **pass** on both projects | `96868f1` |
| Screenshot baselines (title, 3 play screens, dial HUD, shot card, replay, stats, settings) | `visual.spec.ts` (`toHaveScreenshot`, ratio tolerance 0.03) | **pass** on both projects | `96868f1` |
| Outcome distributions through the running app (§6 Phase 2) | `qa.distribution.spec.ts` | **pass** — penalties low corner 85 %: 20/20 goals; central mid-height: 3/20 goals; a repeatable curling free-kick goal found by `solveAim` at all 5 preset spots (curl 1.54–3.14 m); long shots: 10 well-placed corners 10/10, all 20: 10 goals / 3 caught / 2 saved / 3 blocked / 1 bar / 1 miss; timing 0 ms → 106.5 km/h, ±250 ms → 87.8–89.1 km/h | `96868f1` |
| Performance: 300 frames of the free-kick scene (§7.3, gate draw calls ≤ 40, triangles ≤ 80 k) | `perf.spec.ts` | **pass** — max 18 draw calls (mean 17.8), max 16,298 triangles (mean 16,100) — chromium figures from the run at `d2765c3`, tablet-android from the fresh clone (its chromium line was cut from the captured log tail); static scene alone 10 calls / 2.7 k triangles (render harness). Headless frame times are indicative only | `96868f1` |
| Offline (service worker), root and `/LT26/` sub-path | `offline.spec.ts` | **pass** on both projects — worker controls the page, one `lt26-*` cache, offline reload boots to the title, `drawCalls > 0`, 0 failed requests, 0 console errors | `96868f1` |
| Visual check by eye (§7.4) at 1280×800 and 2560×1600 | `node tests/harness/app-shots.mjs` → `docs/screenshots/app-*.png` (16 images) | **looked at**: title, free kick / penalty / long shot play screens, shot card, replay, stats at both sizes. No overlap of controls with Talilei or the ball, text legible, logo on title and HUD, UI colours only sky blue / navy / white, no console errors. Note: at 2560×1600 CSS px (DPR 1) the HUD is small but legible (D-28). Additional small-screen and left-footed layouts are gated by `ui.spec.ts` | `96868f1` |
| Build (§7.5) | `npm run build` | **pass** — 13 files precached; bundle `index-*.js` 0.65 MB (0.17 MB gzip) | `96868f1` |
| Static folder with `python3 -m http.server`, at `/LT26/` and `/` | `npm run static-check` | **pass** both URLs, no 4xx/5xx, no failed requests, no console errors; negative control by the release engineer (build with `--base=/`) fails under `/LT26/` with 404s | `96868f1` |
| Download budget ≤ 6 MB | printed by `npm run static-check` | **1.276 MB** in 14 files | `96868f1` |
| Workflow files valid | `npx --yes @action-validator/cli .github/workflows/{ci,pages}.yml` | **pass**, run by the release engineer (exit 0 both; a deliberately broken file exits 1) | `a5361bb+wip` (committed as `94ab89a`, unchanged since) |
| E2E WebKit (desktop Safari + iPad) and Firefox | CI jobs `e2e (webkit)`, `e2e (ipad)`, `e2e (firefox)` | **not run** — browser downloads are blocked here ([BLOCKERS.md](BLOCKERS.md) B-2); first CI run after pushing | — |
| GitHub Pages deploy (real run) | push to `main` → "Deploy to GitHub Pages" | **not run** — no GitHub account linked ([BLOCKERS.md](BLOCKERS.md) B-1) | — |
| Real device (Android tablet / iPad GPU) | manual | **not run** — no device available to this environment | — |

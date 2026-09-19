# LT26 v0.1.0 — Handover

## What was built

LT26 (Luther Talilei 26) is a football shooting trainer that runs in the browser, built with Three.js 0.186, TypeScript and Vite. It has its own ball physics and no physics engine.

- **Three modes.**
  - **Free kick:** five preset spots, or place the ball anywhere 16–35 m out on the mini-map. A red wall of 3–5 men stands 9.15 m away and jumps 0.4 m, 0.15 s after the strike. A green keeper covers the far side.
  - **Penalty:** hold to start the run-up and release at the ball. The keeper reacts after 0.20–0.25 s and reads your body shape 65 % of the time. You can disguise the shot.
  - **Long shot:** 20–30 m out. You push the ball a short way, then strike it as Talilei reaches it. A defender closes in, and timing the strike badly costs 10–25 % of ball speed.
- **Two control schemes**, switched in Settings:
  - **Swipe** (the default on touch devices): direction sets the aim, finger speed sets power, how the swipe bends sets curl, and where you start on the ball sets lift and spin.
  - **Dial:** a reticle on the goal face, a power bar you hold and release, curve and dip knobs, and a Shoot button.
  - Mouse and keyboard work too.
- **Physics** (`src/physics`, full details in [PHYSICS.md](PHYSICS.md)):
  - Runs at a fixed 240 Hz with the RK4 method.
  - Includes gravity, drag with the drag crisis, Magnus lift, spin decay (τ = 10 s) and a small knuckle wobble on spinless shots.
  - Collides with the ground (bounce with friction coupling, rolling resistance), posts and bar, net, wall players and the keeper's hands. The keeper catches balls slower than 60 km/h and parries faster ones.
  - Air is either Nairobi (1,800 m, the default) or sea level.
  - The game uses the same `stepBall`/`simulate` functions that the tests check.
- **After every kick:**
  - A shot card: speed, spin, curl, apex, time, crossing point and result.
  - A 0.35× replay played back from the recorded states, from an orbiting camera, with the flight path drawn.
  - A per-spot log in `localStorage`.
  - A ghost of your best kick from that spot.
- **Screens:** title, play, replay, stats and settings. Settings cover controls, altitude, sound, foot and reset. The UI uses only the brand colours `#3FC9FC`, `#000E29` and `#FFFFFF`. The logo appears on the title screen and as a badge in the HUD, and Talilei stands beside the ball in every mode.
- **PWA and hosting:**
  - Manifest, and icons made from the logo.
  - A service worker, generated at build time, precaches the whole game for offline play.
  - `base: './'`, so the same build runs on GitHub Pages under a sub-path or from any static folder.
- **Build size:** 1.28 MB in total, against a 6 MB budget.

## How it was verified

Every result, with the commit it ran at, is in [TESTING.md](TESTING.md).

- **Unit tests (Vitest):** 197.
  - They include all eight §4 acceptance rows, which were written before any tuning.
  - They also cover the keeper, wall and rules, outcome distributions, input mapping, brand colours, camera and projection maths, and audio.
- **End-to-end tests (Playwright, headless Chromium on SwiftShader):** 68, run on both the desktop Chromium project and the Android-tablet touch profile. They cover:
  - real CDP touch swipes in every mode, the dial and mouse, run-up and push/strike;
  - replay integrity, stats kept across a reload, and the layout at 740×360 up to 1920×1200 for both feet;
  - scripted outcome distributions, the performance gate, visual baselines, and offline boot at the root and under `/LT26/`.
- **Performance** over 300 frames of the free-kick scene: at most 18 draw calls and 16.3 k triangles. The gate is 40 calls and 80 k triangles.
- **Screenshots** at 1280×800 and 2560×1600 are in `docs/screenshots/app-*`. I looked at every one.
- **Static and fresh-clone checks:** the build was served by `python3 -m http.server` at `/LT26/` and at `/`. A fresh clone ran `npm ci`, lint, unit, E2E and build.
- **Reviews:** three independent reviewers (physics+sim, input+UI, render+PWA) and a QA engineer reviewed the work. Every finding was fixed or recorded as a decision (see [DECISIONS.md](DECISIONS.md), D-17 to D-28, and [qa/DEFECTS.md](qa/DEFECTS.md)).

**Not verified here** ([BLOCKERS.md](BLOCKERS.md)):

- The real GitHub Pages deployment, because no GitHub account is linked in this environment.
- The WebKit/iPad and Firefox E2E runs, because their browser downloads are blocked here. CI runs them after the first push.
- A real Android tablet or iPad GPU. All rendering numbers come from SwiftShader.

## Run it

```sh
npm ci
npm run dev          # http://localhost:5173 — or: npm run build && npm run preview
npm run lint && npm test && npm run e2e && npm run build && npm run static-check
```

## Deploy

1. Push the repository to GitHub: `git remote add origin https://github.com/<user>/LT26.git && git push -u origin main --tags`.
2. Go to **Settings → Pages → Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow publishes the game at:

**`https://<user>.github.io/<repo>/`** (e.g. `https://<user>.github.io/LT26/`)

To install on an Android tablet, open that URL in Chrome, then go to ⋮ → **Install app**. After the first load it works offline.

## What I would do next

1. Push the repo and read the first CI run for WebKit, iPad and Firefox. Then play-test on the real tablet, especially finger-speed calibration (150 CSS px/in, decision D-24) and frame rate on its GPU.
2. **Wall-row spec contradiction (D-19):** decide between two fixes: widen the dip range to −10 rev/s, or change the §4 wall-clearance row to about 17°.
3. **Knuckle wobble (D-20):** the brief's bounds make spinless power shots wobble only a few centimetres. If you want a visible knuckleball, the no-spin acceptance row has to be relaxed.
4. Add a keeper that can misread curl, a follow-through animation for Talilei, and separate crowd murmur and cheer sounds.
5. Add an "update available — reload" prompt for new service-worker versions (D-26).

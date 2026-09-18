# LT26 · Luther Talilei 26

A realistic football **shooting trainer** that runs in the browser on an Android tablet or phone, an iPad, or a
desktop. Practise free kicks, penalties and long shots with a ball that follows real aerodynamics — drag with the
drag crisis, Magnus curve from side spin, dip from top spin, knuckling on spinless power shots — computed by our own
physics engine at 240 Hz and drawn with Three.js. Talilei (shirt number 10) is the taker in every mode.

It is a static web app: no server, no account, no tracking. Installed as an app (PWA) it works fully offline.

## How to play

Pick a mode on the title screen. After every kick you get a slow-motion replay with the flight path drawn, a
shot-data card (speed, spin, curve, apex, time to goal, where it crossed the line, result), a per-spot session log
and a "best kick" ghost for the same spot. Stats persist on the device.

| Mode           | Set-up                                                                                                                          | What to do                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free kick**  | Ball 16–35 m out (drag it on the mini-map or pick a preset: centre of the D, left/right edge of the D, wide left/right). A 3–5 man wall (red) stands at 9.15 m and jumps after the strike; the keeper (green) covers the far side. | Get the ball over or round the wall, away from the keeper, and under the bar. Side spin bends it, top spin makes it dip, back spin makes it float.                            |
| **Penalty**    | Ball on the spot (11 m), keeper on the line. The keeper reacts after ~0.2 s and reads your body shape.                         | Hold to start the run-up, release as Talilei reaches the ball. Release timing decides how much of your power you keep. Placement wins; hard central shots at mid height get saved. |
| **Long shot**  | Ball 20–30 m out, optionally with a defender closing you down.                                                                   | First swipe (or tap) pushes the ball forward; strike it with the second swipe as you arrive. Striking early or late costs power and accuracy. Near-zero spin at high speed = knuckle ball. |

### Control schemes (switch in Settings)

**A — Swipe** (default on touch devices). Put one finger on or near the ball and swipe towards the goal.

- **Direction** of the swipe → aim left/right.
- **Speed** of the swipe → power (≈ 40–115 km/h).
- **Curvature** of the swipe path → side spin: a path bowed to one side bends the ball the other way round the wall.
- **Where you start on the ball** → height and top/back spin: start near the top for a driven, dipping shot, near the
  bottom for a lofted shot with back spin.
- A ghost arrow shows the gesture while you swipe. With a mouse, click-drag does exactly the same.

**B — Dial** (default with a mouse). Every value is numeric and repeatable.

- Drag the **reticle** anywhere on (or off) the goal face to aim.
- Hold the **power bar**: it fills and empties; release to set power.
- Turn the **curve** knob (−10…+10 rev/s side spin) and the **dip** knob (−6…+6 rev/s top/back spin).
- Press **Shoot**. In penalty and long-shot mode the run-up timing still applies.

**Both schemes:** power above 90 % adds random aim scatter (more at 100 %). In penalties and long shots, a strike
within ±80 ms of the ideal contact keeps full power; outside that window you lose up to 25 % power and gain scatter.

### Settings

Control scheme · Altitude (**Nairobi**, ~1,800 m, thinner air, less bend — the default — or sea level) · Sound ·
Left/right-footed (mirrors the "inside/outside of the foot" labels) · Reset data.

The game is landscape only; on a phone held upright it shows a rotate prompt.

## Run locally

Requires Node.js 20 or newer (CI uses 22).

```sh
npm ci            # install exact, locked dependencies
npm run dev       # dev server with hot reload on http://localhost:5173 (also on your LAN, to try it on a tablet)
```

## Test

```sh
npm run lint      # ESLint + Prettier check + no TODO markers / disabled tests
npm test          # Vitest unit tests (physics acceptance tests, keeper/wall/rules, input mapping)
npx playwright install chromium   # once, to get the browser (add webkit firefox for the full matrix)
npm run e2e       # Playwright E2E against the production build (Chromium, Android tablet, WebKit, iPad, Firefox)
npm run e2e -- --project=chromium # a single browser
```

Test results with the commit they were run at are recorded in [`docs/TESTING.md`](docs/TESTING.md).

## Build

```sh
npm run build          # type-check, then build the static site into dist/ (includes the generated service worker)
npm run preview        # serve dist/ on http://localhost:4173
npm run static-check   # serve dist/ with python3 -m http.server at /LT26/ and at /, check it boots cleanly
                       # (no 404s, no console errors, title screen shown) and that dist/ is within the 6 MB budget
```

The build uses relative URLs (`base: './'`), so `dist/` works on any host and in any sub-folder — you can copy it
to any static web server or open it with `cd dist && python3 -m http.server`.

## Deploy to GitHub Pages

The workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds and deploys on every push to
`main` and on manual dispatch.

1. Create a repository on GitHub (for example `LT26`) and push this project to its `main` branch:
   ```sh
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main --tags
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Open the **Actions** tab: the "Deploy to GitHub Pages" run starts on the next push (or run it with **Run
   workflow**). When it finishes the game is live at

   **`https://<user>.github.io/<repo>/`**

The separate CI workflow (`ci.yml`) runs lint, unit tests, E2E on Chromium/WebKit/Firefox and the build on every
push and pull request.

## Install on a tablet

The game is a Progressive Web App. After the first visit everything (code, textures, icons) is cached on the
device, so it then starts and plays **with no internet connection**.

**Android tablet or phone (Chrome):** open `https://<user>.github.io/<repo>/`, wait for the title screen, then tap
**⋮ → Install app** (or **Add to Home screen**). Launch LT26 from the home screen: it opens full screen in
landscape. To update, open it while online; the new version is used the next time the app is started.

**iPad / iPhone (Safari):** open the same URL, tap **Share → Add to Home Screen**, then launch it from the home
screen.

## Browser support

- Chrome on Android 10+ (WebGL 2) — primary target, tuned for 60 fps on a mid-range tablet.
- Safari on iPad and iPhone (iPadOS/iOS 16+).
- Desktop Chrome, Edge, Safari and Firefox (current versions).

WebGL is required for the 3D scene. The total download is kept under 6 MB.

## Project layout

```
index.html              Vite entry
public/                 manifest.webmanifest, icons/ (generated from the logo by `npm run assets`)
src/
  contracts.ts          shared TypeScript interfaces (the contract between modules)
  main.ts               boot: settings → sim → scene → audio → session log → UI app; registers the service worker
  physics/              pure ball model (drag, Magnus, spin decay, collisions), solver — no rendering imports
  sim/                  free kick / penalty / long shot state machines, keeper, wall, rules, replay recording
  render/               Three.js scene: pitch, goal and net, stadium, ball, players, Talilei sprite, cameras, trail
  input/                swipe and dial schemes, run-up timing, unified touch/mouse pointer
  ui/                   screens (title, play HUD, replay, stats, settings) in plain DOM + CSS
  data/                 settings, session log (localStorage), spot presets
  audio/                WebAudio-synthesised sounds
assets/brand/           logo and Talilei art, resized from the root PNGs
scripts/                make-assets (icons, brand images), sw-plugin (service worker generator), static-check, no-todo
tests/unit/             Vitest: physics acceptance tests and module tests
tests/e2e/              Playwright: boot, screens, touch kicks, performance, offline
docs/                   ARCHITECTURE, DECISIONS, PHYSICS, TESTING, BLOCKERS, screenshots/
.github/workflows/      ci.yml (lint, unit, E2E, build), pages.yml (deploy)
```

How it fits together is described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); every design choice made
during the build is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Credits

- Game, code and physics: the LT26 project, built with [Three.js](https://threejs.org/) (MIT),
  [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), [Vitest](https://vitest.dev/) and
  [Playwright](https://playwright.dev/).
- Logo and the Talilei mascot artwork: © the LT26 owner; not covered by any open-source licence.
- Sounds are synthesised at runtime with the Web Audio API (no audio files).

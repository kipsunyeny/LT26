# LT26 · Luther Talilei 26

A realistic football **shooting trainer** that runs in the browser on an Android tablet or phone, an iPad, or a
desktop. Practise free kicks, penalties and long shots with a ball that follows real aerodynamics — drag with the
drag crisis, Magnus curve from side spin, dip from top spin, knuckling on spinless power shots — computed by our own
physics engine at 240 Hz and drawn with Three.js. Talilei (shirt number 10) is the taker in every mode.

It is a static web app: no server, no account, no tracking. Installed as an app (PWA) it works fully offline.

## How to play

On the title screen pick **Free kick**, **Penalty** or **Long shot** (or **My stats** / **Settings**; **Install app**
appears when the browser offers installation). In the game, the panel at the top picks the spot, a hint line at the
bottom says what to do next, and **Back** returns to the title.

After every kick a shot card shows the result, ball speed, spin (labelled inside/outside of the foot for your
kicking foot), curve, apex, time to goal and where the ball crossed the line. **Replay** plays the kick in slow
motion (0.35×) from a side/high camera with the flight path, a side-view profile and the best earlier kick from the
same spot as a ghost; **Next** sets up the next kick. **My stats** lists kicks, goals, goal % and average miss
distance per spot; they are saved on the device.

| Mode          | Set-up                                                                                                                                                                                                                                                                        | What to do                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Free kick** | Spot buttons: Centre of the D, Left/Right edge of the D, Wide left/right — or drag the ball on the mini-map anywhere 16–35 m out (snaps to the metre). A red wall of 3–5 players stands at 9.15 m and jumps just after the strike; the green keeper covers the far side. | One strike. Get it over or round the wall, away from the keeper and under the bar.                                                                                                                                                                           |
| **Penalty**   | Ball on the spot (11 m), keeper on the line. The keeper reads your body shape.                                                                                                                                                                                                | The press starts Talilei's run-up; the release strikes — release as he reaches the ball. The **Disguise** toggle (Body shape panel) opens the body but strikes across it, to fool the keeper's read.                                                         |
| **Long shot** | Spots Centre, Left, Right (20–30 m out). A defender closes you down after the push.                                                                                                                                                                                          | First gesture pushes the ball forward and it rolls; Talilei runs onto it. The second gesture strikes it — release as he reaches the ball. Swipe scheme: a tap on the rolling ball also strikes it (straight at goal, no spin, the dial's current power). |

**Strike timing** (penalty, long shot): releasing within ±80 ms of the ideal contact keeps full power; earlier or
later costs up to 25 % power and adds aim scatter. The Strike timing panel shows the window. In every mode, power
above 90 % adds random aim scatter (more at 100 %).

### Control schemes (Settings → Controls)

**Swipe — "touch the ball and flick"** (default on touch devices). Start the swipe on or near the ball (within
about four ball-widths) and flick towards the goal. A mouse click-drag does the same.

- **Direction** of the swipe → aim. Straight up the screen aims at the centre of the goal.
- **Speed at release** (the last moment of the flick, not the whole swipe) → power, about 40–115 km/h. A gentle
  swipe is a soft shot; full power needs a real flick.
- **Hook** the swipe (bow it to one side of the straight line) → side spin up to ±10 rev/s; the ball bends the way
  the swipe hooks at the end.
- **Where you start on the ball** → height and spin: start near the **top** for a low, driven, dipping shot (top
  spin), the **centre** for a normal lift, near the **bottom** for a high shot with back spin — enough to clear the
  wall.
- Very short swipes, backwards swipes and swipes far off the goal direction are ignored.

**Dial — "reticle, power, knobs"** (default with a mouse). Every value is shown as a number and can be repeated
exactly.

- **Reticle:** drag it, or tap anywhere in the play area, to aim anywhere on the goal face — or wide/over (up to
  12 m either side and 6 m high).
- **Power bar:** hold it and it fills and empties (1.6 s cycle); release to set the power. A quick tap sets the
  tapped value exactly.
- **Curve** knob (−10…+10 rev/s side spin) and **Dip** knob (−6…+6 rev/s: top spin dips, back spin floats): drag
  up/right to increase, steps of 0.5; double-click resets.
- **Shoot:** press to strike (free kick). In penalty and long shot, **hold Shoot** to run up and **release** at the
  ball; in long shot the first Shoot pushes the ball.
- **Keyboard:** Space = Shoot (hold for the run-up); arrow keys move the reticle (Shift for 0.5 m steps) or change
  a focused knob or the power bar.

### Settings

- **Controls:** Swipe or Dial.
- **Altitude:** Nairobi, 1,800 m (thinner air: less bend, less drag — the default) or Sea level.
- **Sound:** on/off.
- **Kicking foot:** Right- or Left-footed. Mirrors the HUD layout and Talilei's side of the ball, and swaps the
  "inside/outside of the foot" labels (the physics is the same).
- **Reset data:** deletes all kick stats and best-kick ghosts (asks for confirmation).

The game is landscape only; held upright it shows a rotate prompt. On a touch device it goes full screen and locks
landscape on the first tap where the browser allows it.

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

The deploy workflow runs `npm run lint` and `npm test` before building, so a red tree never deploys. The separate
CI workflow (`ci.yml`) runs on every push and pull request: a fast job (lint, unit tests, build, static check) and
one E2E job per Playwright project (chromium, tablet-android, webkit, ipad, firefox) in parallel.

## Install on a tablet

The game is a Progressive Web App. After the first visit everything (code, textures, icons) is cached on the
device, so it then starts and plays **with no internet connection**.

**Android tablet or phone (Chrome):** open `https://<user>.github.io/<repo>/`, wait for the title screen, then tap
**⋮ → Install app** (or **Add to Home screen**). Launch LT26 from the home screen: it opens full screen in
landscape.

**Updates.** When the app is opened while online it checks for a new version and downloads it in the background.
The new version applies only after **all LT26 windows and tabs are closed and the app is opened again** (on
Android, swipe LT26 away in the recent-apps view, then relaunch). A game in progress is never switched mid-session.

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

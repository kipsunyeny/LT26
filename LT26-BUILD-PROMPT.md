# LT26 — Autonomous build brief for Claude Opus

You are the lead engineer and orchestrator for **LT26 (Luther Talilei 26)**, a realistic football shooting trainer that runs in a browser on an Android tablet/phone and on a desktop. You will build it end to end **without asking the owner anything**. The owner (Mike) will not be available; every decision you would normally ask about, you make yourself, record in `docs/DECISIONS.md`, and move on. Stop only when the Definition of Done at the end of this brief is met and verified, or when you hit a hard blocker you have exhausted (record it in `docs/BLOCKERS.md` and finish everything else).

Work in the current repository folder (`LT26/`). It already contains:

- `LT26-logo.png`, `LT26-mascot.png` — the brand assets (sky blue `#3FC9FC`, navy `#000E29`, white; the mascot "Talilei", shirt number 10, striped sky-blue/white kit, drawn from behind).
- `concept/` — a throw-away visual prototype (`index.html`, `assets/`, `screenshots/`). It is a **reference for look, camera angle, HUD layout and a first physics model**, not a codebase to extend. Read it once, take what is useful, then build the real thing cleanly.

---

## 1. Product: what must exist at the end

A single-page web game, installable as a PWA, hosted on GitHub Pages, that lets the player practise three kinds of shot with a ball that behaves like a real ball.

### 1.1 Modes

| Mode | Set-up | Player controls | Outcome logic |
| --- | --- | --- | --- |
| **Free kick** | Ball placeable anywhere 16–35 m from goal (mini-map drag or presets: centre of D, left/right edge of D, wide left/right). Wall of 3–5 defenders at 9.15 m covering the near post; wall jumps ~0.4 m with a 0.15 s delay after the strike. Goalkeeper covers the far side. | Aim, power, side spin (curve), top/back spin (dip/float). Both control schemes (§3). | Ball must clear or pass the wall, beat the keeper's reach, and cross the line inside the frame. |
| **Penalty** | Ball on the spot (11 m). Keeper on the line, reacts after 0.20–0.25 s, dives with a reach of ~2.9 m either side and ~2.2 m high; reads the run-up angle (open body → guesses that side 65 % of the time). | Run-up (hold to start, release at the ball to strike; release timing sets power accuracy), aim, power, spin. Optional "disguise" (open body but strike across). | Placement beats the keeper; power above ~90 % widens the scatter; central shots at medium height get saved. |
| **Long shot** | Ball 20–30 m out. First swipe pushes the ball forward (it rolls, decelerating with rolling friction); the taker runs onto it; second swipe (or tap) is the strike. Optional defender closing at 6 m/s. | Timing of the strike relative to the ball position, aim, power, spin (knuckle = near-zero spin at high speed; dip = top spin). | Early/late strike costs 10–25 % power and adds scatter; moving-ball velocity adds to the kick; distance drop-off from drag. |

### 1.2 After every kick

Slow-motion replay from a side/high orbit camera with the flight path drawn; a shot-data card (ball speed km/h, spin rev/s, lateral curve m, apex m, time to goal s, where it crossed the line, result); a per-spot session log (attempts, goals, average miss distance) persisted in `localStorage`; a "best kick ghost" overlay for the same spot.

### 1.3 Screens

Title (logo left, mode buttons centre in sky blue, Talilei full-height right, dimmed stadium behind), Play (HUD per §3), Replay, Stats, Settings (control scheme, altitude, sound, left/right-footed, reset data).

---

## 2. Decisions already made (do not re-open)

- **Engine:** Three.js (latest stable, pinned) + **our own ball physics**. No third-party physics engine.
- **Language/tooling:** TypeScript, Vite, ES modules, no framework for the HUD (plain DOM + CSS), Vitest for unit tests, Playwright for browser/E2E tests, ESLint + Prettier.
- **Camera during the kick:** slightly raised behind the ball (≈2.3 m high, 4–5 m behind the ball, looking at the goal, vertical FOV ≈ 46°). Replay: orbiting side/high camera.
- **Controls:** both schemes, switchable in Settings (§3).
- **Hosting:** GitHub Pages via a GitHub Actions workflow; the built site must also run from a plain static folder. Provide a PWA manifest, icons generated from the logo, and a service worker that caches the whole game for offline play.
- **Brand:** only the three brand colours in the UI. Logo on title and as a HUD badge (top-right). Talilei is the taker in every mode as a camera-facing sprite beside the ball (his art is a back view, which matches the camera). Ball is white with navy panels. Wall in red, keeper in green.
- **Physics reference:** real ball (mass 0.43 kg, diameter 0.22 m), air density 1.20 kg/m³ at sea level and 0.99 kg/m³ for the Nairobi setting (~1,800 m); an "Altitude" toggle in Settings, default Nairobi.
- **Orientation:** landscape only; lock where the browser allows, otherwise show a rotate prompt.
- **Targets:** Chrome on Android 10+ (WebGL 2), Safari on iPad/iPhone, Chrome/Safari/Firefox on desktop. 60 fps on a mid-range tablet: ≤ 60 k triangles in view, ≤ 20 draw calls for the static scene, textures ≤ 2048², total download ≤ 6 MB.

---

## 3. Controls specification

**Scheme A — Swipe (default on touch).** One finger on or near the ball. Swipe direction → aim in azimuth; swipe speed → power (map 0.3–2.5 m/s of finger speed to 40–115 km/h, with an ease-in curve); the curvature of the swipe path (signed area of the path relative to its chord) → side spin (−10…+10 rev/s); the vertical position of the swipe start on the ball (top/centre/bottom) → launch elevation and top/back spin (top = driven/dipping, bottom = lofted with back spin). Show a ghost arrow while swiping.

**Scheme B — Dial.** Drag a reticle anywhere on the goal face (and beyond it — a mis-aim must be possible); a power bar that fills and empties on hold, released to set power; two knobs (curve −10…+10 rev/s, dip −6…+6 rev/s); a Shoot button. Everything numeric, repeatable, shown in the HUD.

**Shared.** Mouse maps to the same gestures on desktop; keyboard optional. Power above 90 % adds Gaussian scatter to aim (σ = 1.5° at 90 %, 3.5° at 100 %). Run-up (penalty, long shot): a timing window of ±80 ms around the ideal contact gives full power; outside it, power drops linearly to 75 % and scatter σ adds up to 3°. Left/right-footed setting mirrors the curve sign for "inside/outside of the foot" labels.

---

## 4. Physics specification (the heart of the product)

Integrate at a fixed 240 Hz (sub-step the render frame), semi-implicit Euler or RK4, and render with interpolation. State: position, velocity, angular velocity (spin vector, rad/s). Forces per step on the ball of mass m, radius r, area A = πr²:

1. **Gravity:** 9.81 m/s² down.
2. **Drag:** F = −½ ρ Cd A |v| v. Cd follows the drag crisis: Cd = 0.20 + 0.30 / (1 + e^((|v| − 13) / 2)) (≈0.5 below ~10 m/s, ≈0.2 above ~17 m/s). For near-zero spin above 20 m/s add a small pseudo-random lateral "knuckle" force (bounded ±0.25 m/s² at 60 Hz Perlin-like noise) so spinless power shots wander.
3. **Magnus:** F = ½ ρ Cl A |v|² (ω × v) / (|ω||v|), with spin parameter S = r|ω| / |v| and Cl = 1 / (2 + 1/S), zero when |ω| < 0.5 rad/s.
4. **Spin decay:** ω decays exponentially with time constant 10 s in flight; on ground contact, spin and velocity couple through friction (rolling/sliding, μ = 0.4).
5. **Collisions:** ground (restitution 0.6, rolling resistance so a 4 m/s roll stops in ~10 m), posts and crossbar (cylinders, restitution 0.7), net (absorbs, ball drops), wall players (capsules; jumping raises them), keeper (a reach envelope with hands as spheres; a save is "caught" if the ball speed at contact < 60 km/h, else a parry with a deflection).

**Acceptance targets (write these as unit tests before tuning; all must pass):**

| Case | Expected (at sea level, ρ = 1.20) |
| --- | --- |
| Penalty, 11 m, 100 km/h, launch 2° up, no spin | Reaches the line in 0.40–0.45 s; arrival speed 88–92 km/h |
| Free kick, 25 m, 100 km/h, launch 6° up, side spin 8 rev/s | Lateral deviation from the launch line at the goal line 2.3–3.0 m; time of flight 1.0–1.15 s; arrival speed 74–80 km/h |
| Same, no spin | Lateral deviation < 0.05 m; same time and speed as above ±3 % |
| Free kick, 25 m, 90 km/h, launch 10° up, side spin 10 rev/s | Lateral deviation 2.9–3.6 m |
| Long shot, 28 m, 110 km/h, launch 8° up, top spin 4 rev/s vs no spin | The top-spin ball crosses the line ≥ 1.5 m lower than the spinless ball |
| Wall clearance | A ball launched at 15° from 22 m at 95 km/h is ≥ 2.3 m high at 9.15 m from the kick |
| Nairobi vs sea level | Same free kick bends 12–20 % less in Nairobi air |
| Energy sanity | With ρ = 0 and no spin the trajectory matches the closed-form parabola to 1 mm over 1 s |

Every trajectory used by the game must come from the same function the tests call (no separate "gameplay approximation").

---

## 5. Architecture and repository layout

```
LT26/
  index.html            Vite entry
  public/               manifest.webmanifest, icons/, sw.js (or generated by vite-plugin-pwa)
  src/
    main.ts             boot, screen router
    physics/            ball.ts (pure, no Three.js imports), collisions.ts, constants.ts, solver.ts (aim-assist: launch angles that reach a target for a given speed/spin)
    sim/                match state machines: freeKick.ts, penalty.ts, longShot.ts, keeper.ts, wall.ts, rules.ts (goal/miss/save detection)
    render/             scene.ts, pitch.ts, goal.ts, stadium.ts, ball.ts, players.ts, mascot.ts, cameras.ts, trail.ts
    input/              swipe.ts, dial.ts, runUp.ts, pointer.ts (unified touch/mouse)
    ui/                 hud.ts, title.ts, replay.ts, stats.ts, settings.ts, styles.css
    data/               sessionLog.ts (localStorage), presets.ts
    audio/              kick, post, net, crowd (short, generated or CC0 files ≤ 300 KB total)
  assets/               brand (resized from the root PNGs), textures, models
  tests/
    unit/               physics acceptance tests (Vitest)
    e2e/                Playwright: smoke, screenshot, touch-emulated kick, performance
  docs/
    DECISIONS.md  ARCHITECTURE.md  PHYSICS.md  TESTING.md  BLOCKERS.md  CHANGELOG.md
  .github/workflows/    ci.yml (lint, unit, e2e, build), pages.yml (deploy)
  README.md
```

Rules: physics has zero rendering dependencies and is deterministic given a seed; sim depends on physics only; render reads sim state; ui/input write intents into sim. One "GameState" object drives everything; the replay is a recording of physics states, not a re-simulation.

---

## 6. How to work: the agent swarm

Use your subagent / team capability to parallelise, but keep **one orchestrator (you)** who owns the plan, the interfaces and integration. Never let two agents edit the same file in the same phase.

**Phase 0 — Foundations (orchestrator alone, ~1 hour of work).** Scaffold the repo (Vite + TS + Vitest + Playwright + ESLint + Prettier, CI workflow), write `docs/ARCHITECTURE.md` with the module boundaries and the **TypeScript interfaces** every agent will code against (`BallState`, `KickIntent`, `SimEvent`, `SceneApi`, `InputScheme`, `Recording`), commit. This contract is what makes parallel work safe.

**Phase 1 — Parallel build (spawn these agents at once, each with a narrow brief, the interfaces file, and the acceptance criteria that concern them):**

1. **Physics engineer** — `src/physics/*` and `tests/unit/physics.*`. Writes the acceptance tests first (§4 table), then the model, then tunes Cd/Cl only within the physical ranges given until all tests pass. Delivers `docs/PHYSICS.md` with the equations and the final constants.
2. **Scene & rendering engineer** — `src/render/*` and `assets/`. Pitch, lines, goal with net, stands with crowd texture, floodlights, ball texture (white/navy), capsule players, Talilei sprite, cameras (kick, replay orbit, title), flight-path trail. Must hit the performance budget; delivers a headless screenshot of each camera.
3. **Gameplay/sim engineer** — `src/sim/*`. The three mode state machines, wall placement and jump, keeper model (reaction, dive, reach, read of run-up), goal/save/miss rules, session recording for replay. Unit tests for keeper reach envelopes and rules.
4. **Input & UI engineer** — `src/input/*`, `src/ui/*`. Both control schemes, run-up timing, title/HUD/replay/stats/settings screens, brand styling, landscape handling, PWA install prompt. Playwright tests with touch emulation that perform a real swipe and assert a `KickIntent` was produced with the expected sign of spin and a power in range.
5. **QA & verification engineer** — starts when the first three deliver. Writes the integration E2E tests (§7), runs them, files defects as tasks with reproduction steps, re-runs after fixes. Also owns the performance test and the device matrix (Playwright: Pixel tablet and iPad viewports with touch, desktop Chromium/Firefox/WebKit).
6. **Docs & release engineer** — README (how to play, how to run locally, how to deploy, how to install on a tablet), `docs/TESTING.md`, CHANGELOG, GitHub Pages workflow, PWA manifest and icons from the logo, offline check.

**Coordination rules**

- Maintain a task list with owner, status and blocking links. Every agent reports back with: files changed, tests added/passing, open questions **resolved by them** (they decide and log, they do not ask), and anything that violates the contract.
- Integrate after each agent returns: run `npm run lint && npm test && npm run e2e && npm run build`. Nothing merges red.
- If an interface must change, the orchestrator changes it in `ARCHITECTURE.md` first, then dispatches the fix to every affected owner.
- Use an independent **reviewer agent** for every significant piece: it reads the code and the tests without the author's summary and answers "does this do what §1–§4 say, and how would it fail?" Findings become tasks. Do not skip review because tests are green.
- Keep commits small and messages descriptive; tag `v0.1.0` at Definition of Done.

**Phase 2 — Integration & tuning (orchestrator + QA + physics).** Wire the modes end to end; play each mode 20 times via scripted E2E with varied inputs and assert the outcome distribution is sane (e.g. penalties: a well-placed low-corner shot at 85 % power scores ≥ 80 % of the time; a central mid-height shot ≤ 20 %; free kicks: at least one repeatable curling goal from each preset spot exists and the aim-assist can find it).

**Phase 3 — Hardening & release.** Performance pass, offline install test, device matrix, accessibility basics (font sizes, contrast on the navy panels, hit targets ≥ 44 px), final docs, deploy workflow verified with a dry run.

---

## 7. Verification you must perform yourself (not just trust)

1. **Unit:** all physics acceptance tests (§4), keeper/wall/rules tests, input mapping tests (swipe path → KickIntent).
2. **E2E (Playwright, headless Chromium with SwiftShader, plus WebKit):** the app boots without console errors; each screen renders (screenshot diff against a stored baseline with a tolerance); a real touch swipe in each mode produces a kick, a trajectory and a result; the replay shows the recorded path; stats persist across reload; the service worker serves the app offline (simulate offline after first load).
3. **Performance:** 300 frames of the free-kick scene in headless Chromium — record draw calls, triangles and mean frame time; fail the test if draw calls > 40 or triangles > 80 k (headless timing is only indicative, so gate on geometry, not ms).
4. **Visual check:** capture screenshots of title, each mode, replay and stats at 1280×800 and 2560×1600 and **look at them** (read the images) for layout breakage, overlap with the mascot, illegible text, or missing brand colours. Store them in `docs/screenshots/`.
5. **Build check:** `npm run build` output runs from a plain `python -m http.server` in `dist/` with no absolute-path issues (Vite `base` must be correct for the GitHub Pages sub-path).
6. **Fresh-clone check:** clone into a temp folder, `npm ci`, run the whole test suite, build. If anything depends on your environment, fix it.

Record the results of every one of these in `docs/TESTING.md` with the commit hash they were run at.

---

## 8. Definition of Done

- All three modes are playable on a touch device and with a mouse, with both control schemes, and every kick produces a physically sensible outcome, replay and stat entry.
- Every acceptance test in §4 passes; the E2E suite passes on Chromium and WebKit; the build deploys to GitHub Pages by workflow and installs as a PWA that works offline.
- The UI uses only the brand palette, shows the logo on the title and HUD, and Talilei stands beside the ball in every mode without overlapping the controls at 1280×800 and at a 10-inch tablet's 1920×1200.
- `docs/` is complete: DECISIONS (every choice you made instead of asking), ARCHITECTURE, PHYSICS, TESTING (with results), CHANGELOG; README explains how to play, run, test, deploy and install on the tablet.
- No TODOs, no placeholder numbers, no disabled tests, no console errors, no lint errors.

---

## 9. Behavioural rules for this run

- Do not ask the owner anything. Choose, log in `docs/DECISIONS.md`, continue.
- Prefer boring, verifiable solutions over clever ones. Realism comes from the equations in §4, not from visual tricks.
- When a test fails, fix the cause, not the assertion — unless the assertion contradicts §4, in which case log why in DECISIONS.md.
- Never fabricate a test result, a screenshot or a benchmark. If you cannot run something, say so in TESTING.md.
- Budget your effort: a working, tested, deployable v0.1.0 with modest visuals beats a beautiful build that fails offline or on touch.
- Finish with a short `docs/HANDOVER.md`: what was built, what was verified and how, what you would do next, and the exact command to run and the URL pattern for the deployed game.

# Decisions log

Every choice made instead of asking the owner. Newest at the bottom of each phase. Format: **D-nn — decision.** Why.

## Phase 0 (orchestrator)

- **D-01 — Build in a persistent cloud workspace and sync the repository into `DevEnv/LT26` on the owner's Mac.** The Mac-side shell has a 3-minute call limit and cannot delete files; a long multi-agent build with Playwright needs a persistent machine. The owner's folder receives the full repo (including `.git`) at checkpoints and at the end.
- **D-02 — Toolchain pinned:** three 0.186.0, TypeScript 5.9.3 (TS 7 is too new for typescript-eslint 8.70), Vite 8.3.0, Vitest 5.0.1, Playwright 1.56.1 (matches the preinstalled Chromium 141 build), ESLint 10 + typescript-eslint 8.70, Prettier 3.9.8. Exact versions (`-E`) so `npm ci` is reproducible.
- **D-03 — Vite `base: './'`.** Relative asset URLs work on the GitHub Pages sub-path and from any plain static folder (`python -m http.server` in `dist/`), with no repo-name coupling.
- **D-04 — World frame:** goal line z = 0, pitch z > 0, kicker looks down −z, +x = kicker's right, y up. Matches Three.js camera defaults so no axis flips between physics and render.
- **D-05 — Spin sign convention:** `sideSpin > 0` ⇒ curves right (+x); `topSpin > 0` ⇒ dips. The UI translates to "inside/outside of the foot" labels depending on footedness; physics never sees footedness.
- **D-06 — `KickIntent.power` ∈ [0,1] maps linearly to 40–115 km/h;** the swipe scheme applies its ease-in curve before producing `power`, so the dial and swipe share one mapping.
- **D-07 — Timing penalty shape:** outside ±80 ms the power multiplier falls linearly to 0.75 and extra scatter rises linearly to σ = 3° at ±400 ms, clamped beyond. The brief gives the end points but not the width; 400 ms is roughly one running stride.
- **D-08 — Intent timestamps use the sim clock** (`state.time·1000` ms), not wall-clock, so scripted E2E and unit tests are deterministic and pausing/throttled tabs do not create phantom timing errors.
- **D-09 — Brand images are pre-resized into `assets/brand/*.webp` and committed** (`npm run assets`, uses sharp as a dev dependency). The build never needs sharp; total image weight ≈ 230 KB. PWA icons (any + maskable on navy + apple-touch) are generated from the logo the same way.
- **D-10 — `npm run lint` = ESLint + Prettier check + `scripts/no-todo.mjs`,** which fails on TO-DO/FIX-ME markers and on skipped/only tests, enforcing the "no TODOs, no disabled tests" rule mechanically.
- **D-11 — E2E runs against the production build** (`vite preview`), not the dev server, so the tested artefact is the shipped one.
- **D-12 — WebGL in headless Chromium uses SwiftShader** (`--use-angle=swiftshader --enable-unsafe-swiftshader`).
- **D-13 — `main.ts` exposes `window.__lt26` (DebugHook) in production too.** It is read-only plumbing (sim, scene, recent intents/events) that the E2E suite needs against the production build; it exposes nothing sensitive.
- **D-14 — Separate `src/contracts.ts` holds all shared interfaces** (the brief's `BallState`, `KickIntent`, `SimEvent`, `SceneApi`, `InputScheme`, `Recording` plus supporting types). Agents import types from there only.
- **D-15 — Audio is owned by the rendering engineer** (presentation layer) and is synthesised with WebAudio at runtime (0 KB of files), which trivially meets the ≤ 300 KB audio budget and avoids licensing questions.
- **D-16 — Settings persistence (`src/data/settings.ts`) is orchestrator-owned** because both sim and UI read it. Default scheme: swipe on touch devices, dial on mouse-only devices (brief: swipe is default on touch).

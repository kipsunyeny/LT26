# Changelog

All notable changes to LT26 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-09-19

First complete, tested release (tag `v0.1.0`).

### Added

- Three practice modes: free kick (preset or free ball placement, jumping wall, keeper), penalty (run-up timing,
  keeper that reads the body shape) and long shot (push-and-strike on a moving ball, optional closing defender).
- Own ball physics at 240 Hz: gravity, drag with the drag crisis, Magnus lift, knuckle wander on spinless power
  shots, spin decay, ground/post/crossbar/net/wall/keeper collisions; sea-level and Nairobi (~1,800 m) air.
- Two control schemes, switchable in Settings: swipe (direction, speed, curvature and contact point) and dial
  (reticle, power bar, curve and dip knobs, Shoot button); mouse, touch and keyboard.
- Slow-motion replay with the flight path, shot-data card, per-spot session log in `localStorage` and a best-kick
  ghost.
- Title, play, replay, stats and settings screens in the LT26 brand colours; landscape lock or rotate prompt.
- Installable PWA: web app manifest, icons generated from the logo, and a build-time generated service worker that
  precaches the whole game for offline play.
- GitHub Pages deployment workflow and CI workflow (lint, unit tests, E2E on Chromium/WebKit/Firefox, build).
- `npm run static-check`: serves the build from a sub-path and from the root with a plain static server and checks
  it boots cleanly within the 6 MB download budget.
- Documentation: README (play, run, test, deploy, install), architecture, decisions, physics, testing record,
  blockers.

### Verified

- 197 unit tests (all §4 physics acceptance rows), 68 E2E tests on Chromium desktop and on the Android-tablet touch
  profile, performance gate (18 draw calls, 16.3 k triangles), offline boot at the root and under `/LT26/`, static
  build check. See [docs/TESTING.md](docs/TESTING.md).

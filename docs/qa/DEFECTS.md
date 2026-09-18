# QA defects

Found by the QA agent (`qa`) at commit `a5361bb` + working tree (Phase 2; re-run round 2 after the owners' fixes).
Each defect has a test in `tests/e2e/qa.defects.spec.ts` that fails while the defect is open and passes once it is
fixed (closed defects keep their test as a regression guard). Severity: **high** = blocks a Definition-of-Done item,
**medium** = visibly wrong behaviour, **low** = cosmetic / wording.

| ID | Severity | Title | Status | Test |
| --- | --- | --- | --- | --- |
| D-1 | low | Free-kick spot buttons "Right D" and "Wide R" wrap onto two lines | **closed** (round 2) | `qa.defects.spec.ts` › D-1 |
| D-2 | low | A long shot blocked by the closing defender is reported as "Blocked by the wall" | **closed** (round 2) | `qa.defects.spec.ts` › D-2 |
| D-3 | medium | Long shots are nearly unwinnable: the closing defender blocks one half of the goal, the keeper the rest | open | `qa.defects.spec.ts` › D-3 |
| D-4 | low | QA's own visual baselines for 5 screens were blank (mask covered the page) in round 1 | **closed** (fixed in QA specs) | `visual.spec.ts` |

## D-1 — Free-kick spot buttons "Right D" and "Wide R" wrap onto two lines

- **Status:** closed in round 2 — D-1 passes on chromium; the new baselines show every label on one line.
- **Severity:** low (cosmetic; the buttons still work).
- **Steps:** 1280×800, title → Free kick (either control scheme). Look at the spot buttons under the mini-map.
- **Expected:** every spot label on one line, like "Centre", "Left D" and "Wide L".
- **Actual:** "Right D" is rendered as "Right / D" and "Wide R" as "Wide / R" (two lines inside a 44 px tall
  button), so the grid looks broken and the text is cramped.
- **Evidence:** `tests/e2e/visual.spec.ts-snapshots/play-freeKick-swipe-chromium-linux.png`,
  `play-freeKick-dial-chromium-linux.png` and `shot-card-chromium-linux.png` (left panel);
  on `chromium` and `tablet-android` `qa.defects.spec.ts` › D-1 fails with `['Centre: 1', 'Left D: 1', 'Right D: 2', 'Wide L: 1', 'Wide R: 2']`.
- **Suspected file:** `src/ui/styles.css` (`.spot-grid` / `.spot`: three columns too narrow for the label at the
  button's padding and font size — `white-space: nowrap`, a smaller padding, or two columns would fix it).

## D-2 — A long shot blocked by the closing defender is reported as "Blocked by the wall"

- **Status:** closed in round 2 — the card now reads "Blocked by the defender" (`resultLabel(result, mode)`);
  D-2 passes on chromium. The test now searches push power × target for a defender block, because the shorter
  push changed which shots he blocks.
- **Severity:** low (wrong wording on the shot card and in the result; the physics is right).
- **Steps:** Long shot, centre spot. Push at 50 % power, strike at the ideal contact at 80 % power towards the
  right post (x = 3.3 m, y = 0.3 m). The defender, closed to 2.4 m from the ball, blocks it.
- **Expected:** the result names the defender (e.g. "Blocked by the defender") — long shot has no wall.
- **Actual:** `summary.result === 'wall'` and the card reads "Blocked by the wall"; the only contact was
  `tag: 'defender'`. In a 20-kick probe (centre spot, push 0.5, target x = +3.3) all 10 right-post shots ended
  as `wall`.
- **Evidence:** reproduced on `chromium` and `tablet-android`; `qa.defects.spec.ts` › D-2 (contacts `['defender', …]`, card text "Blocked by the wall").
- **Suspected files:** `src/sim/rules.ts:87,130` (defender contacts set `wallTouched` → `'wall'`) and
  `src/ui/shotCard.ts` `resultLabel()` (does not look at `summary.mode`). The `ShotResult` union in
  `src/contracts.ts` has no `'blocked'`/`'defender'` value, so the least invasive fix is in the UI: label
  `'wall'` as "Blocked by the defender" when `summary.mode === 'longShot'`.

## D-3 — Long shots are nearly unwinnable: the defender blocks one half of the goal, the keeper the rest

- **Severity:** medium (a whole mode is frustrating; nothing crashes).
- **Steps:** Long shot, any spot. Push at 50 % (the new short 2–5 m touch), strike at the ideal contact at 80 %
  power (≈ 94 km/h) with no spin at a corner area (x = ±3.0 or ±3.3 m, y = 0.3 or 2.1 m).
- **Expected:** a well-placed, perfectly timed strike into a corner area scores a fair share of the time (the
  test uses ≥ 1 in 4 as the bar; the brief asks for "a sane mix" and says the defender is *optional*).
- **Actual:** 2 goals in 24 (`{"caught":1,"saved":9,"wall":12,"goal":2}`). A 252-kick probe (3 spots × push
  0/0.5/1 × 7 targets × 3 heights × 2, perfect timing, 94 km/h) scored 0–9 of 42 per spot/push: every shot on the
  defender's side — high (y = 2.1) ones included — is blocked (`wall`), and the keeper saves everything within
  3.0 m of the centre on the other side. Only |x| = 3.3 m on the far side with the longest push scores reliably.
  With the old 3–6 m/s push the defender was 2.3–5 m away and blocked far less.
- **Evidence:** `qa.defects.spec.ts` › D-3 (fails, chromium). Probe grid in this report's round-2 notes:
  e.g. `ls-centre push 0: {"saved":18,"caught":6,"wall":18}` (0 goals of 42).
- **Suspected files:** `src/sim/longShot.ts` (`DEFENDER.stopDistance` 2.4 m and `startAhead`/`startSide` — at
  the strike he stands 2.4–5.5 m in front of the ball on the kicker's right, so he covers that entire half of the
  goal at every height), the missing "defender on/off" option in the UI (brief §1.1 calls him optional), and the
  keeper's reach from 25–27 m (`src/sim/keeper.ts`, see O-1).

## D-4 — (QA) Round-1 visual baselines for title, shot card, replay, stats and settings were blank

- **Severity:** low, QA's own test defect — recorded so nobody relies on the round-1 visual results.
- **What happened:** round 1 masked the full-screen WebGL canvas with `mask: [#scene]`. Playwright paints a mask
  box *on top of* the page, so those five baselines were a single magenta rectangle (4.7 kB PNGs) and compared
  nothing. The round-1 review of those screens was done on the unmasked review copies, not on the baselines.
  Also, `--update-snapshots` only rewrites a baseline that fails the 3 % tolerance, so the round-1 swipe baseline
  still showed D-1 after the fix.
- **Fix (round 2):** the canvas is hidden (`display: none`, WebGL drawing paused) around those screenshots
  instead of masked, all baselines were deleted and regenerated, and every baseline PNG was opened.

## Observations (not defects — behaviour within the brief, noted for tuning)

- **O-1 Long-shot keeper covers ±3.0 m from 25–27 m** (still true in round 2; part of D-3). With ideal timing, shots at |x| ≤ 3.0 m (any height)
  from the long-shot spots were saved in every probe (≈ 100 km/h), while shots at |x| = 3.3 m scored 10/10.
  The keeper has ~0.75 s to reach a 2.9 m dive envelope, so this follows from the brief's keeper model; the
  resulting "only the last 0.3 m of each corner scores" band is narrow for a trainer.
- **O-2 Free-kick keeper mostly hidden by the wall from the centre spot.** At `fk-centre` only the keeper's head
  shows behind the right end of the wall in the kick camera (baseline `play-freeKick-*-chromium-linux.png`).
  Realistic, but the player cannot see where the keeper stands.
- **O-3 Aim-assist free kicks that score need a soft (75 km/h) curler or the far corner.** From the D edges, the
  first repeatable curling goals the search found were 75 km/h with 9 rev/s into the near top corner
  (x = ±3.3, y = 2.2) or 105 km/h to the far post; 85–95 km/h curlers were blocked by the wall or saved.
- **O-4 (round 2) A swipe released after an aborted run-up is silently ignored.** If the finger is held more than
  1 s past the ideal contact, the sim aborts the penalty run-up (phase back to `aiming`). The UI still emits the
  strike intent on release (it appears in `__lt26.intents`) and the sim ignores it — nothing happens on screen.
  Harmless on a real device, but it caught the round-2 integration test, whose CDP gesture took ~3 s of sim time
  in headless Chromium. The QA test now holds the sim clock during the gesture.
- **O-5 (round 2) The 3 % screenshot tolerance hides small layout regressions.** D-1 (two labels wrapping)
  changed < 3 % of the pixels and passed the old baseline. Consider a tighter `maxDiffPixelRatio` for screens
  without the 3D view.

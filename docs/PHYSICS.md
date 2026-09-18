# LT26 ball physics

Source: `src/physics/` (pure TypeScript, imports only `../contracts`, no Three.js, no DOM, deterministic for a given seed). Tests: `tests/unit/physics.*.test.ts`. The game (`sim`) calls `stepBall` every 1/240 s with its live colliders. `simulate` is a loop over the same `stepBall`, and the tests and the aim solver call it, so there is one code path.

## 1. Frame and sign conventions

- SI units. `y` up, ground `y = 0`, goal line `z = 0`, pitch `z > 0`, net `z < 0`. The kicker looks along −z, and +x is the kicker's right.
- Launch direction: `v = speed·(cos el·sin az, sin el, −cos el·cos az)`. Azimuth 0 points at the goal, and positive azimuth points to +x.
- Spin vector (rad/s): `ω = 2π(−sideSpin·ŷ − topSpin·r̂)`, with `r̂ = (cos az, 0, sin az)`.
  - `sideSpin > 0` ⇒ ω × v points to +x, so the ball curves right.
  - `topSpin > 0` ⇒ ω × v points down, so the ball dips. Back spin (< 0) floats.
  - Tests check both signs end to end.
- `launchState` sets `t = 0`. `BallState.t` is used only as the time base of the knuckle noise.

## 2. Forces (`acceleration`)

Mass m = 0.43 kg, r = 0.11 m, A = πr² = 0.03801 m².

| Term | Equation |
| --- | --- |
| Gravity | `(0, −g, 0)`, g = 9.81 (or `env.g`) |
| Drag | `−½ρ Cd A |v| v / m`, with `Cd = 0.20 + 0.30/(1 + e^((|v|−13)/2))` |
| Magnus | `½ρ Cl A |v|² (ω×v)/(|ω||v|) / m`, with `S = r|ω|/|v|`, `Cl = 1/(2 + 1/S)`; zero when `|ω| < 0.5 rad/s` |
| Knuckle | `(ρ/1.20)·k⊥`: the noise sample k with its component along v removed; `|k| ≤ 0.25 m/s²` |

Spin decay in flight: `ω(t) = ω₀·e^(−t/10 s)`. It is applied exactly, including inside the RK4 stages. On the ground, spin and velocity couple through friction (§4).

## 3. Integrator

Classical RK4 on (p, v) at the fixed step `DT = 1/240 s`. Each stage uses the spin decayed to that stage's time and the knuckle noise sampled at that stage's time. RK4 is exact for constant acceleration: the energy row measures **3.2 × 10⁻¹³ m** error after 1 s, where semi-implicit Euler would give ≈ 2 cm. Contacts are resolved after the flight step: each collider in list order, then the ground plane.

## 4. Collisions (`collisions.ts`)

**Ground (`collideGround`).** This runs when the centre ends a step below r.
- **Bounce** (approaching faster than 0.35 m/s):
  - `v_y → −0.6·v_y`, and the penetration is reflected.
  - A Coulomb friction impulse at the contact point, capped at `μ(1+e)|v_y|` with μ = 0.4, acts against the slip velocity `u = (v_x + rω_z, 0, v_z − rω_x)`.
  - Removing all slip needs `Δv = −u/(1 + 1/k)` with `I = k·m·r²`, k = 2/3 (thin shell). The spin responds with `Δω = (c × Δv)/(k r²)`, where `c = (0, −r, 0)`.
  - Back spin therefore loses forward speed and strong top spin gains it (tested).
- **Resting contact:**
  - `v_y → 0`, and the same friction, capped at μ·|Δv_y| of the step (the normal impulse).
  - While rolling, a rolling resistance of `0.06·g` scales v and the rolling spin together, so there is no slip.
  - Below 0.05 m/s the ball stops. A skidding spinless ball settles to 0.6·v₀ (angular momentum about the contact point).
  - Only bounces emit a `ContactEvent` (tag `ground`, index −1).

**Capsules and spheres (`collideCollider`).**
- The closest point on the segment (capsule) or the centre (sphere) gives the contact normal.
- The step is swept in sub-samples of at most half of (collider radius + r), so the ball cannot tunnel.
- The response uses velocity relative to the collider's `velocity` field: `v_rel' = v_rel − (1+e)(v_rel·n)n`. Tangential velocity and spin are unchanged.
- The ball is pushed out to the surface. Separating contacts are ignored.
- The event carries the tag, the collider index, `speedBefore = |v|` before the response, and the contact point on the collider surface.

**Goal frame (`goalFrameColliders`).**
- Posts are capsules on x = ±3.72, from y = 0 to 2.50. The bar is a capsule at y = 2.50 between the posts. Radius 0.06, restitution 0.7.
- The net is an `absorbBox` with x ±3.78, y 0…2.56, z −2…0, open at the front.
- Inside the bag:
  - Linear damping of 1.5/s.
  - The side netting, roof and back netting keep the centre r inside.
  - On contact the net returns 10 % of the normal speed and keeps 30 % of the tangential speed and spin, so the ball is absorbed and drops.
- From outside, the same faces (grown by r) stop the ball, so side-netting misses stay outside.
- A `net` event fires for normal approach speeds above 0.5 m/s.

## 5. Knuckle noise (`rng.ts`)

- `mulberry32(seed)` is the PRNG. `gaussian(rng)` uses Box–Muller.
- `createKnuckleNoise(seed)` is smooth value noise on a **60 Hz** lattice:
  - Each lattice value is a hash of (seed, index, channel), uniform in [−1, 1].
  - Values are interpolated with the quintic fade 6u⁵−15u⁴+10u³, so each channel stays in [−1, 1].
  - Two independent channels give (x, y). The result is scaled by 0.25 and its magnitude clamped to **0.25 m/s²**.
- It is non-zero only when **speed > 20 m/s and |ω| < 2π rad/s** (1 rev/s).
- `acceleration` scales it by ρ/1.20 and removes the component along v, so it is purely lateral.
- Because it is zero-mean and fast, its double integral is small: the 25 m spinless free kick drifts **7 mm**, which satisfies the brief's < 0.05 m while staying seeded and active.
- Different seeds change only knuckle-eligible kicks (tested).

## 6. Constants (`constants.ts`)

| Constant | Value |
| --- | --- |
| Ball | BALL_MASS 0.43, BALL_RADIUS 0.11, BALL_AREA πr², BALL_INERTIA_FACTOR 2/3 |
| Environment | G 9.81, RHO_SEA 1.20, RHO_NAIROBI 0.99, DT 1/240 |
| Aerodynamics | Cd 0.20 + 0.30/(1+e^((v−13)/2)); MAGNUS_MIN_SPIN 0.5 rad/s; SPIN_DECAY_TAU 10 s |
| Knuckle | KNUCKLE_MIN_SPEED 20, KNUCKLE_MAX_SPIN 2π, KNUCKLE_MAX_ACCEL 0.25, KNUCKLE_NOISE_HZ 60 |
| Ground | GROUND_RESTITUTION 0.6, GROUND_MU 0.4, GROUND_ROLLING_RESISTANCE 0.06 (tuned), GROUND_SETTLE_SPEED 0.35, REST_SPEED 0.05, REST_TIME 0.25 |
| Goal frame | POST_RESTITUTION 0.7, GOAL_HALF_WIDTH 3.66, GOAL_HEIGHT 2.44, POST_RADIUS 0.06 |
| Net | NET_DEPTH 2.0, NET_RESTITUTION 0.1, NET_TANGENT_KEEP 0.3, NET_DAMPING 1.5 |

## 7. Acceptance table (values measured by `tests/unit/physics.acceptance.test.ts`)

Setup for every row:
- Origin (0, 0.11, d), azimuth 0.
- The crossing is `Trajectory.lineCrossing`; deviation is |x| there.
- No colliders, and the ground plane is off (`ground: false`), because the brief's launches pass below y = 0 before the line (crossing heights are shown).
- Seed 2026.

| Row | Brief | Measured | |
| --- | --- | --- | --- |
| Penalty 11 m, 100 km/h, 2°, no spin | t 0.40–0.45 s; 88–92 km/h | t 0.4203 s; 89.55 km/h (y −0.33) | pass |
| FK 25 m, 100 km/h, 6°, side 8 rev/s | dev 2.3–3.0 m; t 1.0–1.15 s; 74–80 km/h | dev 2.4957 m; t 1.0455 s; 79.65 km/h | pass |
| Same, no spin (knuckle active) | dev < 0.05 m; t, v ±3 % | dev 0.0070 m; t ratio 0.9924; v ratio 1.0006 | pass |
| FK 25 m, 90 km/h, 10°, side 10 rev/s | dev 2.9–3.6 m | dev 3.1424 m (t 1.1806 s, 71.52 km/h) | pass |
| Long shot 28 m, 110 km/h, 8°, top 4 vs 0 | ≥ 1.5 m lower | 1.7358 m lower (y −2.853 vs −1.117) | pass |
| Wall 22 m, 95 km/h, 15° | ≥ 2.3 m at 9.15 m | 2.3017 m **with back spin 10 rev/s** (see below) | pass |
| Wall, same without spin (documenting test) | — | 1.8900 m; vacuum parabola 1.9297 m | impossible under §4 |
| Nairobi vs sea, FK 25 m / 100 km/h / 6° / 8 rev/s | 12–20 % less bend | 2.4957 → 2.0293 m = 18.69 % less | pass |
| Energy ρ = 0, 1 s | ≤ 1 mm | 3.19 × 10⁻¹³ m | pass |

Wall row: at 15° and 95 km/h even the vacuum parabola is 1.93 m high at 9.15 m, and drag only lowers it. The row cannot pass for any spinless ball. The row leaves spin unstated, so the test uses the lofted, bottom-of-ball strike of §3 with back spin at the brief's largest spin magnitude, 10 rev/s. The margin is thin (1.7 mm) but deterministic, because a spinning ball has no knuckle noise. Practical consequence: clearing a wall about 2.3 m high needs roughly 17–18° of elevation, or heavy back spin. See `docs/decisions/physics.md`.

Other measured behaviour (`physics.collisions.test.ts`):
- A 4 m/s roll stops in **9.915 m** (5.6 s).
- A dropped ball rebounds to 0.36× its drop height.
- Post and bar hits return 0.7 of the normal speed (20 → 14 m/s, 25 → 17.5 m/s).
- A net shot ends at rest inside the bag.
- A moving hand at 3 m/s gives a resting ball 4.5 m/s (e = 0.5).

## 8. Aim solver (`solveLaunch`)

- Unknowns are (azimuth, elevation). The residual is the crossing (x, y) minus the target, computed by `simulate` with no colliders and the ground off.
  - A direct flight to a centre height ≥ r never meets the ground before the line, and free flight keeps the residual smooth.
  - Solved launches are verified with the ground on.
- Start point: the vacuum low-trajectory solution.
- Iteration: Newton with a forward-difference Jacobian (1e-4 rad), then Broyden rank-1 updates, refreshed by finite differences on failure. Steps are capped at 0.25 rad and halved until the miss shrinks. Tolerance is 5 mm.
- Returns `null` if it does not converge (unreachable target) or if target.y < r.
- Measured:
  - 4 targets × 3 speeds (90/100/110 km/h) × 3 side spins (−8/0/+8) from 22 m: worst miss **0.16 cm** at ρ = 1.20 and **0.07 cm** at ρ = 0.99.
  - Solve time: median **1.5 ms**, max 2.0 ms (40 solves on this shared 2-CPU machine). The target is < 3 ms.
  - Unreachable cases (40 km/h to the top corner from 35 m; y = 30 m) return null.

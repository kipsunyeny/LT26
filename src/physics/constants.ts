/** LT26 physics constants (SI units). Values from LT26-BUILD-PROMPT.md §4 unless marked "LT26 choice". */

/** Ball mass, kg. */
export const BALL_MASS = 0.43;
/** Ball radius, m (diameter 0.22 m). */
export const BALL_RADIUS = 0.11;
/** Cross-sectional area πr², m². */
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
/**
 * Moment of inertia factor I = k·m·r². A football is a pressurised thin shell: k = 2/3 (LT26 choice;
 * a solid sphere would be 2/5). Used only by the ground friction coupling.
 */
export const BALL_INERTIA_FACTOR = 2 / 3;

/** Gravity, m/s². */
export const G = 9.81;
/** Air density at sea level, kg/m³. */
export const RHO_SEA = 1.2;
/** Air density in Nairobi (~1,800 m), kg/m³. */
export const RHO_NAIROBI = 0.99;

/** Fixed physics step, s (240 Hz). */
export const DT = 1 / 240;

/** Drag crisis: Cd = CD_MIN + CD_RISE / (1 + exp((|v| − CD_CRISIS_SPEED) / CD_CRISIS_WIDTH)). */
export const CD_MIN = 0.2;
export const CD_RISE = 0.3;
export const CD_CRISIS_SPEED = 13;
export const CD_CRISIS_WIDTH = 2;

/** Magnus is zero below this spin rate, rad/s. */
export const MAGNUS_MIN_SPIN = 0.5;

/** Exponential spin decay time constant in flight, s. */
export const SPIN_DECAY_TAU = 10;

/** Knuckle force: only above this speed, m/s. */
export const KNUCKLE_MIN_SPEED = 20;
/** Knuckle force: only while |ω| is below this, rad/s (LT26 choice: 1 rev/s = "near-zero spin"). */
export const KNUCKLE_MAX_SPIN = 2 * Math.PI;
/** Knuckle force bound at sea-level density, m/s² (scaled by ρ/RHO_SEA — it is an aerodynamic force). */
export const KNUCKLE_MAX_ACCEL = 0.25;
/** Knuckle noise lattice frequency, Hz. */
export const KNUCKLE_NOISE_HZ = 60;

/** Ground normal restitution. */
export const GROUND_RESTITUTION = 0.6;
/** Ground Coulomb friction coefficient (sliding ↔ rolling coupling). */
export const GROUND_MU = 0.4;
/**
 * Rolling-resistance coefficient: constant deceleration GROUND_ROLLING_RESISTANCE·g while rolling.
 * LT26 choice, derived so that a ball rolling at 4 m/s at sea level stops in ≈ 10 m together with air drag
 * (see docs/PHYSICS.md).
 */
export const GROUND_ROLLING_RESISTANCE = 0.06;
/** Below this downward normal speed the ball settles on the ground instead of bouncing, m/s. */
export const GROUND_SETTLE_SPEED = 0.35;
/** A ball on the ground slower than this is stopped, m/s. */
export const REST_SPEED = 0.05;
/** simulate(): the ball counts as at rest after this long below REST_SPEED, s. */
export const REST_TIME = 0.25;

/** Posts and crossbar. */
export const POST_RESTITUTION = 0.7;
export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;
export const POST_RADIUS = 0.06;

/** Net volume depth behind the line, m. */
export const NET_DEPTH = 2.0;
/** Net surface: fraction of the normal velocity returned (LT26 choice: nets absorb). */
export const NET_RESTITUTION = 0.1;
/** Net surface: fraction of the tangential velocity and spin kept on contact (LT26 choice). */
export const NET_TANGENT_KEEP = 0.3;
/** Linear damping rate of the ball inside the net bag, 1/s (LT26 choice). */
export const NET_DAMPING = 1.5;

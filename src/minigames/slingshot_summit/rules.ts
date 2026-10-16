/**
 * SLINGSHOT SUMMIT — the pure rules (no three.js, no rng, no DOM).
 *
 * Lane geometry is relative to the player's slingshot: the slingshot is at
 * the origin, a lane runs away along -z, +x is to the player's right. Every
 * lane has the same three targets that sway in step, so the game is fair
 * whichever seat you sit in.
 *
 *   pull time (0..HOLD_MAX s)  ->  charge 0..1  ->  landing distance
 *   aim -1..1                  ->  angle off straight ahead (+-MAX_AIM rad)
 *
 * An acorn flies a fixed arc and lands where the aim and the charge say. It
 * scores the ring of the target it lands on, measured against where that
 * target is at the instant of landing.
 */
import { cpuChargeTime } from "../cpuControls";

/** Longest pull the hold pad reports, in seconds. */
export const HOLD_MAX = 1.2;
/** Length of the round on the game clock, in seconds. */
export const ROUND_SECONDS = 45;
/** From here the wind picks up: the targets sway faster. */
export const WIND_AT = 30;
/** Extra sway speed reached at the end of the round (0.3 = 30% faster). */
export const WIND_BOOST = 0.3;

/** Landing distance (from the slingshot) at zero charge and at full charge. */
export const DIST_MIN = 3.0;
export const DIST_MAX = 9.6;
/** Largest aim angle, in radians, at |aim| = 1. */
export const MAX_AIM = 0.3;

/** Ring values, outermost first, and each ring's outer edge as a share of the target radius. */
export const RINGS: readonly { value: 1 | 3 | 5; edge: number }[] = [
  { value: 1, edge: 1 },
  { value: 3, edge: 0.62 },
  { value: 5, edge: 0.3 },
];

export interface TargetSpec {
  /** Distance down the lane (the target centre is at z = -dist). */
  dist: number;
  /** Outer radius of the scoring disc. */
  radius: number;
  /** Sway half-width and speed (rad/s). */
  amp: number;
  omega: number;
}

/**
 * Near targets are quick and small, far targets are big and lazy: the near
 * one costs the least pulling time, the far one the most.
 */
export const TARGETS: readonly TargetSpec[] = [
  { dist: 4.6, radius: 0.75, amp: 0.4, omega: 2.1 },
  { dist: 6.8, radius: 0.95, amp: 0.62, omega: 1.4 },
  { dist: 9.0, radius: 1.15, amp: 0.85, omega: 0.95 },
];

/** Seconds the slingshot needs to reload after a shot (the CPU honours it too). */
export const RELOAD = 0.42;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Pull share 0..1 for a hold of `heldSec`. */
export function chargeOf(heldSec: number): number {
  return clamp(heldSec / HOLD_MAX, 0, 1);
}

/** Landing distance for a charge 0..1. */
export function landDistance(charge: number): number {
  return DIST_MIN + clamp(charge, 0, 1) * (DIST_MAX - DIST_MIN);
}

/** Charge 0..1 that lands at `dist`. */
export function chargeForDistance(dist: number): number {
  return clamp((dist - DIST_MIN) / (DIST_MAX - DIST_MIN), 0, 1);
}

/** Seconds an acorn spends in the air. */
export function flightTime(charge: number): number {
  return 0.42 + 0.3 * clamp(charge, 0, 1);
}

/** Height of the arc's top above the launch height. */
export function apexHeight(charge: number): number {
  return 1.0 + 1.8 * clamp(charge, 0, 1);
}

/** Angle in radians for an aim value -1..1. */
export function aimAngle(aim: number): number {
  return clamp(aim, -1, 1) * MAX_AIM;
}

/** Where an acorn lands, in lane coordinates (slingshot at the origin). */
export function landPoint(aim: number, charge: number): { x: number; z: number } {
  const a = aimAngle(aim);
  const d = landDistance(charge);
  return { x: Math.sin(a) * d, z: -Math.cos(a) * d };
}

/**
 * Sway clock. It runs at game speed until WIND_AT, then speeds up smoothly
 * (the integral of a rate that climbs to 1 + WIND_BOOST at ROUND_SECONDS), so
 * a target never jumps when the wind rises.
 */
export function swayTime(t: number): number {
  if (t <= WIND_AT) return t;
  const span = ROUND_SECONDS - WIND_AT;
  if (t <= ROUND_SECONDS) {
    const u = t - WIND_AT;
    return t + (WIND_BOOST * u * u) / (2 * span);
  }
  return t + (WIND_BOOST * span) / 2 + WIND_BOOST * (t - ROUND_SECONDS);
}

/** 0 before the wind, up to 1 at the end of the round. */
export function windLevel(t: number): number {
  return clamp((t - WIND_AT) / (ROUND_SECONDS - WIND_AT), 0, 1);
}

/** Lateral offset of target `i` from its lane centre at game time `t`. */
export function targetOffset(spec: TargetSpec, phase: number, t: number): number {
  return spec.amp * Math.sin(spec.omega * swayTime(t) + phase);
}

/** Sideways speed of the target (for its tilt), in units per second. */
export function targetSpeed(spec: TargetSpec, phase: number, t: number): number {
  return spec.amp * spec.omega * Math.cos(spec.omega * swayTime(t) + phase);
}

/**
 * The ring value (1, 3 or 5) an acorn at lane point (x, z) earns on target
 * `spec` at game time `t`, or 0 for a miss.
 */
export function ringAt(x: number, z: number, spec: TargetSpec, phase: number, t: number): 0 | 1 | 3 | 5 {
  const dx = x - targetOffset(spec, phase, t);
  const dz = z + spec.dist;
  const r = Math.hypot(dx, dz) / spec.radius;
  let value: 0 | 1 | 3 | 5 = 0;
  for (const ring of RINGS) if (r <= ring.edge) value = ring.value;
  return value;
}

/** The best ring over a lane's targets for an acorn landing at (x, z) at time t. */
export function scoreLanding(
  x: number,
  z: number,
  phases: readonly number[],
  t: number,
): { ring: 0 | 1 | 3 | 5; target: number } {
  for (let i = 0; i < TARGETS.length; i++) {
    const ring = ringAt(x, z, TARGETS[i], phases[i], t);
    if (ring > 0) return { ring, target: i };
  }
  return { ring: 0, target: -1 };
}

/** Where a CPU should aim, and with how much pull, to land at a point on a target. */
export interface ShotSolution {
  aim: number;
  charge: number;
}

/**
 * Lead the target: the aim and charge that put an acorn released at
 * `releaseAt` on the point `offset` (lane units, along +x then +z) from the
 * centre of target `i` when it lands.
 */
export function solveShot(
  i: number,
  phase: number,
  releaseAt: number,
  offsetX: number,
  offsetZ: number,
): ShotSolution {
  const spec = TARGETS[i];
  let charge = chargeForDistance(spec.dist);
  let px = 0;
  const pz = -spec.dist + offsetZ;
  for (let k = 0; k < 3; k++) {
    px = targetOffset(spec, phase, releaseAt + flightTime(charge)) + offsetX;
    charge = chargeForDistance(Math.hypot(px, pz));
  }
  const angle = Math.atan2(px, -pz);
  return { aim: clamp(angle / MAX_AIM, -1, 1), charge };
}

/* ------------------------------------------------------------------ */
/*  CPU                                                                */
/* ------------------------------------------------------------------ */

/** A CPU seat fires every CPU_PERIOD / skill seconds. */
export const CPU_PERIOD = 1.4;
/** Aim error sd in radians at skill 1 (divided by skill). */
export const CPU_AIM_SD = 0.075;
/** rng draws in one planned shot: ring, target, side, charge (2), aim error (2). */
export const CPU_PLAN_DRAWS = 7;

/** A standard normal from exactly 2 draws (Box-Muller; the pair's second value is dropped). */
function normal(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
}

export interface CpuShotPlan {
  /** The ring the CPU is going for, and the target it picked. */
  ring: 1 | 3 | 5;
  target: number;
  /** Game-clock time the pull starts and the acorn is released, and the pull length. */
  pullStart: number;
  releaseAt: number;
  holdSec: number;
  /** Aim to swing the slingshot to by the release. */
  aim: number;
}

/**
 * One CPU shot. Picks a ring (the bullseye at skill 1 and up, a weighted pick
 * below) and a target, leads the target's sway, then adds the human-sized
 * error: the pull time through cpuChargeTime and a small aim wobble. The
 * release lands CPU_PERIOD / skill after the previous one, never sooner than
 * RELOAD after it. Always CPU_PLAN_DRAWS rng draws, at every skill.
 */
export function planCpuShot(
  rng: () => number,
  skill: number,
  phases: readonly number[],
  afterT: number,
): CpuShotPlan {
  const ringRoll = rng();
  const targetRoll = rng();
  const sideRoll = rng();
  const ring: 1 | 3 | 5 = skill >= 1 ? 5 : ringRoll < 0.45 ? 5 : ringRoll < 0.8 ? 3 : 1;
  const target = targetRoll < 0.3 ? 0 : targetRoll < 0.7 ? 1 : 2;
  const spec = TARGETS[target];
  // Aim at the middle of the chosen ring's band.
  const band = ring === 5 ? 0 : ring === 3 ? (0.3 + 0.62) / 2 : (0.62 + 1) / 2;
  const offsetX = (sideRoll < 0.5 ? -1 : 1) * band * spec.radius;

  const wanted = afterT + CPU_PERIOD / skill;
  const first = solveShot(target, phases[target], wanted, offsetX, 0);
  const holdSec = cpuChargeTime(first.charge * HOLD_MAX, HOLD_MAX, skill, rng);
  const aimErr = normal(rng) * (CPU_AIM_SD / skill) / MAX_AIM;

  const pullStart = Math.max(afterT + RELOAD, wanted - holdSec);
  const releaseAt = pullStart + holdSec;
  // The release may have slipped past the wish: lead the target for when it really lands.
  const lead = solveShot(target, phases[target], releaseAt, offsetX, 0);
  return { ring, target, pullStart, releaseAt, holdSec, aim: clamp(lead.aim + aimErr, -1, 1) };
}

/** Ranking: points, then 5s, then 3s, then the per-round coin each player carries. */
export interface Tally {
  id: number;
  points: number;
  fives: number;
  threes: number;
  coin: number;
}

export function rankPlayers(tallies: readonly Tally[]): number[] {
  return [...tallies]
    .sort((a, b) => b.points - a.points || b.fives - a.fives || b.threes - a.threes || b.coin - a.coin || a.id - b.id)
    .map((t) => t.id);
}

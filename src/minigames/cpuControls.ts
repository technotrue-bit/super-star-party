/**
 * SUPER STAR PARTY — CPU helpers for the hold / swipe / twin / dial / draw controls.
 *
 * Pure and seeded: every helper takes `skill` (from `cpuSkill()`: 0.7 / 1 / 1.3)
 * and an `rng` (`ctx.rng`). Each helper consumes the SAME number of rng draws at
 * every skill, so seeded replays and online peers stay in step.
 *
 * Draw counts (each normal sample is one Box–Muller pair = exactly 2 draws; the
 * second value of the pair is never cached):
 *   cpuChargeTime 2 · cpuSwipe 4 · cpuDialRate 2 · cpuTwinPeriod 2 ·
 *   cpuDrawPath 2 × points.length
 */

type Rng = () => number;

/** One Box–Muller pair from exactly 2 draws. `1 - u` keeps log() away from 0. */
function normalPair(rng: Rng): [number, number] {
  const u1 = rng();
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(1 - u1));
  const a = 2 * Math.PI * u2;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** A standard normal sample. Costs exactly 2 draws; the pair's second value is dropped. */
function normal(rng: Rng): number {
  return normalPair(rng)[0];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Seconds to hold. Error sd = 0.12 * holdMax / skill. 2 draws. */
export function cpuChargeTime(target: number, holdMax: number, skill: number, rng: Rng): number {
  const t = target + normal(rng) * ((0.12 * holdMax) / skill);
  return clamp(t, 0, holdMax);
}

/**
 * A swipe toward (aimX, aimY). Angle error sd 0.18 / skill rad, power error sd
 * 0.1 / skill. Returns a unit direction. 4 draws (angle, then power).
 */
export function cpuSwipe(
  aimX: number,
  aimY: number,
  power: number,
  skill: number,
  rng: Rng,
): { dx: number; dy: number; power: number } {
  const angle = Math.atan2(aimY, aimX) + normal(rng) * (0.18 / skill);
  const p = clamp(power + normal(rng) * (0.1 / skill), 0, 1);
  return { dx: Math.cos(angle), dy: Math.sin(angle), power: p };
}

/**
 * Dial rate in rad/s around ideal * min(1.15, 0.75 + 0.25 * skill). The brief
 * gives no jitter sd; this uses 0.08 * |ideal| / skill. 2 draws.
 */
export function cpuDialRate(ideal: number, skill: number, rng: Rng): number {
  const centre = ideal * Math.min(1.15, 0.75 + 0.25 * skill);
  return centre + normal(rng) * ((0.08 * Math.abs(ideal)) / skill);
}

/** Seconds between alternating presses. Jitter sd 0.08 / skill; never below 0.04 s. 2 draws. */
export function cpuTwinPeriod(ideal: number, skill: number, rng: Rng): number {
  return Math.max(0.04, ideal + normal(rng) * (0.08 / skill));
}

/**
 * The path with a per-point wobble, sd 0.02 / skill on each axis. One
 * Box–Muller pair per point supplies both axes, so 2 draws per point.
 */
export function cpuDrawPath(points: Array<[number, number]>, skill: number, rng: Rng): Array<[number, number]> {
  const sd = 0.02 / skill;
  return points.map(([x, y]) => {
    const [wx, wy] = normalPair(rng);
    return [x + wx * sd, y + wy * sd];
  });
}

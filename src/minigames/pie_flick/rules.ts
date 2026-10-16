/**
 * PIE FLICK — the pure rules (no three.js, no DOM, no rng of its own).
 *
 * Lane geometry is relative to the player's end of the counter: the launch spot
 * is the origin, the counter runs away along -z, +x is to the player's right.
 * The counter is a long wedge: narrow where you stand, wide at the far end,
 * where three customers sit on stools, each with a plate in front of them.
 *
 *   swipe angle (off straight up)   ->  the direction the pie slides
 *   swipe power 0..1                ->  how far it slides before it stops
 *
 * A pie slides with constant friction and stops where the swipe said. If that
 * point is on a plate it is served (right order +1, wrong order -1). A pie that
 * would slide off the far end of the counter falls and scores nothing, and one
 * that stops anywhere else is just a pie on a counter. Chrome rails keep a wide
 * pie on the counter.
 */
import { cpuSwipe } from "../cpuControls";

/** Length of the round on the game clock, in seconds. */
export const ROUND_SECONDS = 50;

/** Pie flavors: cherry, blueberry, lemon, key lime. */
export const FLAVOR_COUNT = 4;

/** The counter is a wedge: half width 0.55 at the launch spot, +0.11 per unit of length. */
export const COUNTER_HALF_NEAR = 0.55;
export const COUNTER_HALF_SLOPE = 0.11;
/** The far end of the counter (z = -COUNTER_END). A pie sliding past it falls off. */
export const COUNTER_END = 8.6;
/** A pie's centre stays this far inside the counter edge: the chrome bumper rail stops it. */
export const RAIL_MARGIN = 0.3;

/** Slide distance at power 0 and at power 1. */
export const DIST_MIN = 2.0;
export const DIST_MAX = 9.6;
/** Friction (units/s^2): a pie decelerates steadily, so the slide time is sqrt(2 d / FRICTION). */
export const FRICTION = 10;

/** The screen angle of a swipe is clamped to this (radians off straight up)... */
export const MAX_SWIPE_ANGLE = 0.7;
/** ...and scaled by this onto the counter, so a thumb's 20 degrees is a pie's 10. */
export const ANGLE_GAIN = 0.5;
/** A swipe pointing down more than this (dy, unit vector) is a retreat, not a throw. */
export const MAX_DOWNWARD = 0.2;

/** Seconds before the next pie is ready after a throw. */
export const RELOAD = 0.45;
/** Seconds a served customer eats before ordering again. */
export const EAT_SECONDS = 1.0;
/** Seconds a customer glares after being handed the wrong pie. */
export const GRUMP_SECONDS = 0.9;

/** Where each customer's plate is (lane coordinates): left, centre-far, right. */
export interface Seat {
  x: number;
  z: number;
}
export const SEATS: readonly Seat[] = [
  { x: -0.85, z: -5.8 },
  { x: 0, z: -7.1 },
  { x: 0.85, z: -5.8 },
];
/** A pie counts as "in front of" a customer inside this ellipse around the plate. */
export const ZONE_RX = 0.62;
export const ZONE_RZ = 0.95;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Half width of the counter at depth z (z <= 0). */
export function counterHalfWidth(z: number): number {
  return COUNTER_HALF_NEAR + COUNTER_HALF_SLOPE * Math.abs(z);
}

/* ------------------------------------------------------------------ */
/*  Swipe -> throw                                                     */
/* ------------------------------------------------------------------ */

export interface Throw {
  /** Direction off straight up the counter, in radians (+ is to the player's right). */
  angle: number;
  /** The swipe power, 0..1. */
  power: number;
}

/**
 * Turn a swipe (unit screen direction, +y down) into a throw. Null for a
 * swipe that points down the screen or has no direction. A keyboard's lone
 * Left or Right arrow (dy 0) throws as far sideways as a swipe may.
 */
export function swipeToThrow(dx: number, dy: number, power: number): Throw | null {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6) || !Number.isFinite(power)) return null;
  const ux = dx / len;
  const uy = dy / len;
  if (uy > MAX_DOWNWARD) return null;
  const screen = clamp(Math.atan2(ux, -uy), -MAX_SWIPE_ANGLE, MAX_SWIPE_ANGLE);
  return { angle: screen * ANGLE_GAIN, power: clamp(power, 0, 1) };
}

/** How far a pie slides at a power 0..1. */
export function slideDistance(power: number): number {
  return DIST_MIN + clamp(power, 0, 1) * (DIST_MAX - DIST_MIN);
}

/** The power 0..1 that slides `dist`. */
export function powerForDistance(dist: number): number {
  return clamp((dist - DIST_MIN) / (DIST_MAX - DIST_MIN), 0, 1);
}

/** Seconds a slide of `dist` takes (constant deceleration to a stop). */
export function slideTime(dist: number): number {
  return Math.sqrt((2 * Math.max(0, dist)) / FRICTION);
}

/** How far along the slide a pie is after `t` seconds, from 0 to `dist`. */
export function slidePosition(dist: number, t: number): number {
  const total = slideTime(dist);
  if (total <= 0) return 0;
  const u = clamp(1 - t / total, 0, 1);
  return dist * (1 - u * u);
}

/** Seconds into a slide of `dist` when the pie has covered `s` of it. */
export function timeAtDistance(dist: number, s: number): number {
  if (dist <= 0) return 0;
  return slideTime(dist) * (1 - Math.sqrt(Math.max(0, 1 - clamp(s / dist, 0, 1))));
}

/** The point `s` along a throw at `angle`, in lane coordinates. */
export function pointAlong(angle: number, s: number): { x: number; z: number } {
  return { x: Math.sin(angle) * s, z: -Math.cos(angle) * s };
}

/**
 * The pie's position `s` along a throw at `angle`. The counter has a chrome
 * bumper rail down each side: a pie thrown wide slides along the rail instead
 * of leaving the counter.
 */
export function pathAt(angle: number, s: number): { x: number; z: number; rail: boolean } {
  const p = pointAlong(angle, s);
  const limit = counterHalfWidth(p.z) - RAIL_MARGIN;
  const rail = Math.abs(p.x) > limit;
  return { x: rail ? Math.sign(p.x) * limit : p.x, z: p.z, rail };
}

export type Fate =
  | { kind: "rest"; x: number; z: number; rail: boolean }
  | { kind: "off"; at: number; x: number; z: number };

/**
 * Where a throw ends up: at rest on the counter, or falling off its far end.
 * `at` is how far along the slide the pie goes over the end.
 */
export function fateOf(angle: number, dist: number): Fate {
  const along = Math.cos(angle);
  if (along <= 1e-6) return { kind: "rest", ...pathAt(angle, 0) };
  const at = COUNTER_END / along;
  if (dist > at) {
    const p = pathAt(angle, at);
    return { kind: "off", at, x: p.x, z: p.z };
  }
  return { kind: "rest", ...pathAt(angle, dist) };
}

/** The seat whose plate zone holds (x, z), nearest first, else -1. */
export function seatAt(x: number, z: number): number {
  let best = -1;
  let bestD = 1;
  SEATS.forEach((seat, i) => {
    const dx = (x - seat.x) / ZONE_RX;
    const dz = (z - seat.z) / ZONE_RZ;
    const d = dx * dx + dz * dz;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** What a pie earns at a customer: +1 for their order, -1 for another, 0 if they are busy eating. */
export function judge(pie: number, order: number | null): 1 | 0 | -1 {
  if (order === null) return 0;
  return pie === order ? 1 : -1;
}

/* ------------------------------------------------------------------ */
/*  Orders                                                             */
/* ------------------------------------------------------------------ */

export interface RoundStreams {
  /** orders[seat][k] is that seat's k-th order. Never the same flavor twice in a row. */
  orders: number[][];
  /** picks[n] chooses which waiting customer the n-th pie is baked for. */
  picks: number[];
}

/** Orders drawn per seat and pies per lane. A 50 s round needs far fewer. */
export const STREAM_LENGTH = 80;

/**
 * Every lane in a round reads the same streams, so no seat gets an easier
 * counter. Exactly STREAM_LENGTH * (SEATS.length + 1) draws.
 */
export function makeStreams(rng: () => number): RoundStreams {
  const orders: number[][] = SEATS.map(() => {
    const seq: number[] = [];
    for (let k = 0; k < STREAM_LENGTH; k++) {
      const r = rng();
      if (k === 0) seq.push(Math.floor(r * FLAVOR_COUNT) % FLAVOR_COUNT);
      else seq.push((seq[k - 1] + 1 + Math.floor(r * (FLAVOR_COUNT - 1))) % FLAVOR_COUNT);
    }
    return seq;
  });
  const picks: number[] = [];
  for (let n = 0; n < STREAM_LENGTH; n++) picks.push(Math.floor(rng() * SEATS.length) % SEATS.length);
  return { orders, picks };
}

/**
 * The flavor of the next pie: it is always baked for somebody who is waiting.
 * `orders[i]` is seat i's flavor, or null while they eat. Returns -1 if
 * nobody is waiting.
 */
export function bakeFlavor(orders: readonly (number | null)[], pick: number): number {
  const n = orders.length;
  for (let k = 0; k < n; k++) {
    const o = orders[(pick + k) % n];
    if (o !== null && o !== undefined) return o;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/*  CPU                                                                */
/* ------------------------------------------------------------------ */

/** A CPU seat throws every CPU_PERIOD / skill seconds. */
export const CPU_PERIOD = 1.6;
/** Chance (at skill 1, divided by skill) that the CPU feeds the wrong customer. */
export const CPU_MISTAKE = 0.07;
/** rng draws in one planned throw: seat, mistake roll, mistake seat, then cpuSwipe's 4. */
export const CPU_PLAN_DRAWS = 7;

export interface CpuThrowPlan {
  /** The seat the CPU is feeding. */
  seat: number;
  /** The swipe it makes (already noisy). */
  swipe: { dx: number; dy: number; power: number };
}

/**
 * One CPU throw. Picks a customer waiting for the pie in hand (a mistake now
 * and then, more at low skill), aims a swipe at their plate and lets
 * cpuSwipe add the human-sized error. Always CPU_PLAN_DRAWS draws, at every skill.
 */
export function planCpuThrow(
  rng: () => number,
  skill: number,
  held: number,
  orders: readonly (number | null)[],
): CpuThrowPlan {
  const seatRoll = rng();
  const mistakeRoll = rng();
  const wrongRoll = rng();
  const wanting: number[] = [];
  orders.forEach((o, i) => {
    if (o === held) wanting.push(i);
  });
  let seat = wanting.length > 0 ? wanting[Math.floor(seatRoll * wanting.length) % wanting.length] : Math.floor(wrongRoll * SEATS.length) % SEATS.length;
  if (mistakeRoll < CPU_MISTAKE / skill) seat = Math.floor(wrongRoll * SEATS.length) % SEATS.length;
  const target = SEATS[seat];
  const world = Math.atan2(target.x, -target.z);
  const screen = world / ANGLE_GAIN;
  const power = powerForDistance(Math.hypot(target.x, target.z));
  const swipe = cpuSwipe(Math.sin(screen), -Math.cos(screen), power, skill, rng);
  return { seat, swipe };
}

/* ------------------------------------------------------------------ */
/*  Ranking                                                            */
/* ------------------------------------------------------------------ */

export interface Tally {
  id: number;
  score: number;
  served: number;
  wrong: number;
  coin: number;
}

/** Most pies served (net of wrong ones); a tie goes to the most served, then the fewest wrong, then a coin. */
export function rankPlayers(tallies: readonly Tally[]): number[] {
  return [...tallies]
    .sort((a, b) => b.score - a.score || b.served - a.served || a.wrong - b.wrong || b.coin - a.coin || a.id - b.id)
    .map((t) => t.id);
}

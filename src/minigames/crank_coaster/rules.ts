/**
 * CRANK COASTER — pure rules (no three.js, no DOM, no Math.random).
 *
 * Four carts sit at the foot of a lift hill, each with its own crank. Turning the
 * crank CLOCKWISE hauls the cart up the chain: the height is the total clockwise
 * angle turned, in a straight line from the bottom (0) to the top (TOP_ANGLE).
 * Turning back does nothing (the pawl holds the cart) and costs nothing.
 *
 * HEAT. Cranking faster than HEAT_TURNS (2.2 turns/s) builds heat on the crank in
 * proportion to how far over the line you are; at or under it the crank cools. The
 * speed is a short running average (RATE_TAU) so one quick flick is not a red line.
 * At full heat the chain JAMS for JAM_TIME (1.5 s): no progress, the crank cools
 * down to JAM_RELIEF, and cranking harder meanwhile is wasted.
 *
 * The round ends when the first cart tops the hill, or at TIME_CAP by height.
 *
 * Every function is a function of its arguments. The only randomness is the rng
 * handed to cpuCrank / makeCoins, always the same number of draws at every skill.
 */
import { cpuDialRate } from "../cpuControls";

type Rng = () => number;

/* ------------------------------------------------------------------ */
/*  Tuning                                                             */
/* ------------------------------------------------------------------ */

export const TURN = Math.PI * 2;
/** Clockwise turns of the crank for the whole climb. */
export const TOP_TURNS = 62;
export const TOP_ANGLE = TOP_TURNS * TURN;
/** The round is called by height at this game time if nobody has topped the hill (s). */
export const TIME_CAP = 50;

/** Cranking faster than this builds heat (turns per second, and rad/s). */
export const HEAT_TURNS = 2.2;
export const HEAT_RATE = HEAT_TURNS * TURN;
/** Heat per second at double the line speed (heat is 0..1). */
export const HEAT_GAIN = 2.0;
/** Heat lost per second while at or under the line. */
export const HEAT_COOL = 0.3;
/** Time constant of the crank-speed running average (s). */
export const RATE_TAU = 0.15;
/** How long a full-heat jam holds the chain (s), and the heat left when it frees. */
export const JAM_TIME = 1.5;
export const JAM_RELIEF = 0.25;
/** The gauge goes amber at this heat and red at the next. */
export const HEAT_WARM = 0.5;
export const HEAT_HOT = 0.8;

/* ------------------------------------------------------------------ */
/*  A cart and its crank                                               */
/* ------------------------------------------------------------------ */

export interface Cart {
  /** Total clockwise angle turned (rad). Not capped: the overshoot breaks a tie. */
  angle: number;
  /** Crank heat, 0..1. */
  heat: number;
  /** Seconds of jam left, 0 when the chain runs free. */
  jam: number;
  /** Running average of the clockwise crank speed (rad/s). */
  rate: number;
  /** How many times the chain has jammed. */
  jams: number;
  /** Highest heat this round. */
  peak: number;
  /** Angle turned the wrong way (rad), for the readout only. */
  back: number;
  /** Angle thrown away against a jammed chain (rad), for the readout only. */
  wasted: number;
}

export function newCart(): Cart {
  return { angle: 0, heat: 0, jam: 0, rate: 0, jams: 0, peak: 0, back: 0, wasted: 0 };
}

export type CartEvent = "jam" | "free" | null;

/** 0..1 up the hill. */
export function climbOf(angle: number): number {
  return angle <= 0 ? 0 : angle >= TOP_ANGLE ? 1 : angle / TOP_ANGLE;
}

/** True once the cart has reached the top. */
export function atTop(c: Pick<Cart, "angle">): boolean {
  return c.angle >= TOP_ANGLE;
}

/**
 * Advance one cart by one step. `delta` is the signed angle turned since the last
 * step (clockwise positive). Returns "jam" on the step the chain seizes and "free"
 * on the step it lets go.
 */
export function stepCart(c: Cart, delta: number, dt: number): CartEvent {
  if (c.jam > 0) {
    c.jam = Math.max(0, c.jam - dt);
    c.rate = 0;
    if (delta > 0) c.wasted += delta;
    else c.back -= delta;
    if (c.jam === 0) {
      c.heat = JAM_RELIEF;
      return "free";
    }
    c.heat = JAM_RELIEF + (1 - JAM_RELIEF) * (c.jam / JAM_TIME);
    return null;
  }
  const fwd = delta > 0 ? delta : 0;
  if (delta < 0) c.back -= delta;
  c.angle += fwd;
  // The running average only ever hears forward turning.
  c.rate += (fwd / dt - c.rate) * (1 - Math.exp(-dt / RATE_TAU));
  if (c.rate > HEAT_RATE) c.heat += HEAT_GAIN * ((c.rate - HEAT_RATE) / HEAT_RATE) * dt;
  else c.heat -= HEAT_COOL * dt;
  if (c.heat < 0) c.heat = 0;
  c.peak = Math.max(c.peak, Math.min(1, c.heat));
  if (c.heat >= 1) {
    c.heat = 1;
    c.jam = JAM_TIME;
    c.jams++;
    c.rate = 0;
    return "jam";
  }
  return null;
}

/** The colour band of the gauge: 0 cool, 1 warm, 2 hot, 3 jammed. */
export function heatBand(c: Pick<Cart, "heat" | "jam">): 0 | 1 | 2 | 3 {
  if (c.jam > 0) return 3;
  return c.heat >= HEAT_HOT ? 2 : c.heat >= HEAT_WARM ? 1 : 0;
}

/** Crank speed in turns per second. */
export function turnsPerSec(rate: number): number {
  return rate / TURN;
}

/* ------------------------------------------------------------------ */
/*  Ranking                                                            */
/* ------------------------------------------------------------------ */

export interface Tally {
  id: number;
  angle: number;
  jams: number;
  coin: number;
}

/** Highest cart first; a tie goes to the fewest jams, then a per-round coin drawn at setup. */
export function rankCarts(tallies: readonly Tally[]): number[] {
  return [...tallies]
    .sort((a, b) => b.angle - a.angle || a.jams - b.jams || b.coin - a.coin || a.id - b.id)
    .map((t) => t.id);
}

/** One draw per seat: the per-round coin that breaks a dead heat. */
export function makeCoins(rng: Rng, seats: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seats; i++) out.push(rng());
  return out;
}

/* ------------------------------------------------------------------ */
/*  CPU                                                                */
/* ------------------------------------------------------------------ */

/**
 * What a Normal CPU cranks at when it is in its stride (rad/s). Tuned so its mean pace
 * (greedy stretches included) is the keyboard dial's 1.5 turns/s: a keyboard player can
 * stay with Normal CPUs, and a touch player riding just under the heat line beats them.
 */
export const CPU_IDEAL = 1.395 * TURN;
/**
 * How much the ideal speed moves per unit of skill away from 1, sharper (Challenge) and
 * duller (Relaxed), on top of cpuDialRate's own tilt. Mean paces: about 1.3, 1.5, 1.75 turns/s.
 */
export const CPU_SKILL_TILT_UP = 0.25;
export const CPU_SKILL_TILT_DOWN = 0.06;

/** The stride speed at this skill (rad/s). */
export function cpuIdeal(skill: number): number {
  return CPU_IDEAL * (1 + (skill >= 1 ? CPU_SKILL_TILT_UP : CPU_SKILL_TILT_DOWN) * (skill - 1));
}
/** A CPU picks a new crank speed this often (s). */
export const CPU_SEGMENT = 0.6;
/** A greedy segment (chance CPU_GREED * skill) cranks this much faster. */
export const CPU_GREED = 0.15;
export const CPU_GREED_MUL = 1.5;
/** Eases off above this heat, once it has noticed (CPU_REACT), and resumes below CPU_RESUME. */
export const CPU_EASE_AT = 0.8;
export const CPU_RESUME = 0.5;
export const CPU_REACT = 0.25;
export const CPU_EASE_MUL = 0.6;
/** rng draws at each new segment: cpuDialRate's 2, then the greed roll. */
export const CPU_SEGMENT_DRAWS = 3;

export interface CpuBrain {
  /** Sim time the current segment ends (s). */
  until: number;
  /** The segment's crank speed (rad/s). */
  rate: number;
  greedy: boolean;
  easing: boolean;
  /** Sim time the heat first went past the easing line, else -1. */
  hotSince: number;
}

export function newCpuBrain(): CpuBrain {
  return { until: 0, rate: CPU_IDEAL, greedy: false, easing: false, hotSince: -1 };
}

/**
 * The crank speed (rad/s) a CPU seat turns at on this step. Draws from `rng` only at
 * the start of a segment, CPU_SEGMENT_DRAWS values at every skill.
 */
export function cpuCrank(brain: CpuBrain, cart: Pick<Cart, "heat" | "jam">, t: number, skill: number, rng: Rng): number {
  if (t >= brain.until) {
    brain.rate = cpuDialRate(cpuIdeal(skill), skill, rng);
    brain.greedy = rng() < CPU_GREED * skill;
    brain.until = t + CPU_SEGMENT;
  }
  // Watch the gauge: past the line for CPU_REACT seconds means ease off until it is cool.
  if (cart.heat > CPU_EASE_AT) {
    if (brain.hotSince < 0) brain.hotSince = t;
    if (t - brain.hotSince >= CPU_REACT) brain.easing = true;
  } else {
    brain.hotSince = -1;
  }
  if (brain.easing && cart.heat < CPU_RESUME) brain.easing = false;
  const base = brain.rate * (brain.greedy ? CPU_GREED_MUL : 1);
  return brain.easing ? Math.min(base, brain.rate * CPU_EASE_MUL) : base;
}

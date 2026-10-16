/**
 * ROW ROW RUMBLE — pure rules (no three.js, no DOM, no Math.random).
 *
 * Two canoes race down a jungle river, two paddlers each. Every paddler has two
 * buttons, LEFT (a) and RIGHT (b), and paddles by alternating them:
 *
 *   - a press on the OTHER side than last time, 0.25 to 0.7 s after it, is a STROKE.
 *     The nearer the gap is to the sweet spot (0.40 s) the stronger the stroke;
 *     the canoe is driven by the sum of both paddlers' strokes.
 *   - the SAME side again is a yaw kick toward that side's rocks and no stroke;
 *   - the other side but faster than 0.25 s is RUSHED (nothing);
 *   - the other side after more than 0.7 s is a LATE restart (a weak first stroke).
 *
 * Every function is a function of its arguments. The only randomness is the rng handed
 * to makeCourse / assignTeams / the CPU helpers, always the same number of draws per
 * call at every CPU skill.
 */
import { cpuTwinPeriod } from "../cpuControls";

type Rng = () => number;

/* ------------------------------------------------------------------ */
/*  Tuning                                                             */
/* ------------------------------------------------------------------ */

/** Distance from the start line to the flag, in metres. */
export const COURSE_LEN = 208;
/** The round is called for the leader at this game time if nobody has crossed. */
export const TIME_CAP = 47;

/** A stroke needs a gap in this window (s). */
export const GAP_MIN = 0.25;
export const GAP_MAX = 0.7;
/** Float slack so a gap of exactly 0.25 or 0.7 s counts as inside the window. */
const EDGE_EPS = 1e-6;
/** The gap with the strongest stroke. */
export const GAP_IDEAL = 0.4;
/** CPU paddlers aim for this gap (the brief's value; humans find their own). */
export const CPU_GAP = 0.42;
/** Judging bands around the ideal gap. */
export const PERFECT_BAND = 0.06;
export const GOOD_BAND = 0.13;

/** Speed added to the canoe by one ideal stroke (m/s) and how fast speed bleeds off (1/s). */
export const IMPULSE = 2.0;
export const DRAG = 1.6;
/** A restart (first press, or one after a pause) is worth this much of a stroke. */
export const RESTART_IMPULSE = 0.5;

/** Yaw (radians, + is bow to the right) from one stroke, and from one same-side press. */
export const STROKE_YAW = 0.035;
export const SAME_YAW = 0.19;
export const YAW_MAX = 0.5;
/** Yaw bleeds back to straight with this time constant (s). */
export const YAW_TAU = 0.8;
/** The CPU strokes the correcting side when the canoe is turned more than 10 degrees. */
export const YAW_CORRECT = (10 * Math.PI) / 180;
/** A CPU correction is not repeated for this long (s). */
export const CPU_CORRECT_COOLDOWN = 1.0;
/** Sideways speed per unit of forward speed and radian of yaw. */
export const LATERAL_GAIN = 0.95;

/** Where the two canoes ride, the river banks, and the canoe's size. */
export const LANE_X = 2.15;
export const BANK_X = 4.65;
export const HALF_WIDTH = 0.46;
/** The canoe is a capsule this long on each side of its centre. */
export const HALF_LENGTH = 1.05;
/** Rock columns: left bank, mid-river, right bank. */
export const ROCK_X = [-4.25, 0, 4.25] as const;

/** A collision: how long it slows (s), how much, and the grace before the next one. */
export const SLOW_TIME = 1.0;
export const SLOW_FACTOR = 0.35;
export const BUMP_GRACE = 0.5;

/** Cross-current in the rapids (m/s) and the pull back toward the lane in calm water. */
export const CURRENT_AMP = 0.68;
export const LANE_PULL = 0.3;

/* ------------------------------------------------------------------ */
/*  The river                                                          */
/* ------------------------------------------------------------------ */

export interface Fall {
  /** Where the lip is, and how long the drop is (m along the river). */
  s: number;
  len: number;
  /** Height lost (m). */
  drop: number;
}

export const RAPIDS: ReadonlyArray<readonly [number, number]> = [
  [22, 60],
  [88, 128],
  [150, 176],
];
export const FALLS: readonly Fall[] = [
  { s: 66, len: 4, drop: 1.6 },
  { s: 134, len: 4, drop: 1.8 },
  { s: 182, len: 4, drop: 2.0 },
];
/** River height at the start line and the gentle slope between the drops. */
export const RIVER_START_Y = 8;
export const RIVER_SLOPE = 0.012;

const smooth = (u: number): number => {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
};

/** 0..1: how deep inside a stretch of rapids this point is (soft edges). */
export function rapidsAt(s: number): number {
  let m = 0;
  for (const [a, b] of RAPIDS) {
    m = Math.max(m, smooth((s - (a - 4)) / 4) * (1 - smooth((s - b) / 4)));
  }
  return m;
}

/** 0..1: how much of a waterfall's drop this point is on. */
export function fallsAt(s: number): number {
  let m = 0;
  for (const f of FALLS) {
    m = Math.max(m, smooth((s - (f.s - 1.5)) / 2) * (1 - smooth((s - (f.s + f.len + 1.5)) / 2)));
  }
  return m;
}

/** River surface height at distance s. */
export function riverY(s: number): number {
  let y = RIVER_START_Y - RIVER_SLOPE * s;
  for (const f of FALLS) y -= f.drop * smooth((s - f.s) / f.len);
  return y;
}

/** d(riverY)/ds, negative downstream. */
export function riverSlope(s: number): number {
  let d = -RIVER_SLOPE;
  for (const f of FALLS) {
    const u = (s - f.s) / f.len;
    if (u > 0 && u < 1) d -= ((f.drop / f.len) * 6 * u * (1 - u));
  }
  return d;
}

/** How much faster than still water the river carries a canoe here. */
export function flowAt(s: number): number {
  return 1 + 0.08 * rapidsAt(s) + 0.38 * fallsAt(s);
}

/** Sideways push of the river (m/s, + toward the right bank). Same for both lanes. */
export function currentAt(s: number): number {
  return rapidsAt(s) * CURRENT_AMP * Math.sin(s * 0.21 + 1.1);
}

export interface Rock {
  s: number;
  x: number;
  r: number;
}

export interface Course {
  /** Rocks in order of s. */
  rocks: Rock[];
}

/**
 * The rocks, drawn once per round (3 draws per row, so it is the same course for both
 * canoes and for every CPU level). Rows sit in the rapids every 5 to 7.5 m and, thinly,
 * in calm water. A row is a rock at the left bank, mid-river, the right bank, or both banks.
 */
export function makeCourse(rng: Rng): Course {
  const rocks: Rock[] = [];
  let s = 24;
  while (s < 192) {
    const gap = rng();
    const kind = rng();
    const size = rng();
    // The falls and the lagoon after the last one stay clear.
    const clear = FALLS.some((f) => s > f.s - 6 && s < f.s + f.len + 6);
    if (!clear) {
      const r = 0.62 + size * 0.28;
      if (kind < 0.28) rocks.push({ s, x: ROCK_X[0], r });
      else if (kind < 0.56) rocks.push({ s, x: ROCK_X[2], r });
      else if (kind < 0.8) rocks.push({ s, x: ROCK_X[1], r: r + 0.1 });
      else {
        rocks.push({ s, x: ROCK_X[0], r });
        rocks.push({ s, x: ROCK_X[2], r });
      }
    }
    s += rapidsAt(s) > 0.5 ? 5 + gap * 2.5 : 11 + gap * 4;
  }
  rocks.sort((p, q) => p.s - q.s);
  return { rocks };
}

/* ------------------------------------------------------------------ */
/*  A paddler's strokes                                                */
/* ------------------------------------------------------------------ */

export type Side = "a" | "b";
export type PressKind = "start" | "stroke" | "rushed" | "same";
export type StrokeGrade = "perfect" | "good" | "ok";

export interface Paddler {
  last: Side | null;
  lastT: number;
  /** Clean strokes in a row. */
  streak: number;
  strokes: number;
  same: number;
  rushed: number;
  late: number;
  presses: number;
}

export function newPaddler(): Paddler {
  return { last: null, lastT: -Infinity, streak: 0, strokes: 0, same: 0, rushed: 0, late: 0, presses: 0 };
}

export interface PressResult {
  kind: PressKind;
  side: Side;
  /** Seconds since this paddler's previous press (Infinity on the first). */
  gap: number;
  grade: StrokeGrade | null;
  /** Speed added to the canoe (m/s). */
  impulse: number;
  /** Yaw added to the canoe (rad, + is bow to the right). */
  yaw: number;
  /** True when the gap was past GAP_MAX and the rhythm began again. */
  late: boolean;
}

/** Pressing LEFT puts the blade in on the left and swings the bow to the right. */
export const yawSign = (side: Side): number => (side === "a" ? 1 : -1);

/** 0.3..1: how well a gap suits the canoe. Sharp around the sweet spot. */
export function cadenceQuality(gap: number): number {
  const z = (gap - GAP_IDEAL) / 0.14;
  return 0.3 + 0.7 * Math.exp(-z * z);
}

/** Speed one stroke at this gap adds (m/s). A faster beat is a smaller push each, a slower one a bigger. */
export function strokeImpulse(gap: number): number {
  return IMPULSE * (gap / GAP_IDEAL) * cadenceQuality(gap);
}

export function gradeOf(gap: number): StrokeGrade {
  const dev = Math.abs(gap - GAP_IDEAL);
  return dev <= PERFECT_BAND ? "perfect" : dev <= GOOD_BAND ? "good" : "ok";
}

/**
 * Judge one button press at game time t and update the paddler. Each press is one attempt:
 * holding a button does nothing, and nothing here reads input every frame.
 */
export function judgePress(p: Paddler, side: Side, t: number): PressResult {
  const gap = t - p.lastT;
  const prev = p.last;
  p.presses++;
  p.last = side;
  p.lastT = t;
  if (prev === null || gap > GAP_MAX + EDGE_EPS) {
    const late = prev !== null;
    if (late) p.late++;
    p.streak = 0;
    return { kind: "start", side, gap, grade: null, impulse: IMPULSE * RESTART_IMPULSE, yaw: yawSign(side) * STROKE_YAW, late };
  }
  if (side === prev) {
    p.same++;
    p.streak = 0;
    return { kind: "same", side, gap, grade: null, impulse: 0, yaw: yawSign(side) * SAME_YAW, late: false };
  }
  if (gap < GAP_MIN - EDGE_EPS) {
    p.rushed++;
    p.streak = 0;
    return { kind: "rushed", side, gap, grade: null, impulse: 0, yaw: 0, late: false };
  }
  p.strokes++;
  p.streak++;
  return { kind: "stroke", side, gap, grade: gradeOf(gap), impulse: strokeImpulse(gap), yaw: yawSign(side) * STROKE_YAW, late: false };
}

/* ------------------------------------------------------------------ */
/*  The canoe                                                          */
/* ------------------------------------------------------------------ */

export interface Canoe {
  /** Distance down the river (m). */
  s: number;
  /** Across the river; the lane centre is +-LANE_X. */
  x: number;
  /** Speed from strokes (m/s), before the river and any bump. */
  v: number;
  yaw: number;
  slowT: number;
  bumpCd: number;
  bumps: number;
  /** Game time the flag was crossed, else null. */
  finishT: number | null;
}

export function newCanoe(x: number): Canoe {
  return { s: 0, x, v: 0, yaw: 0, slowT: 0, bumpCd: 0, bumps: 0, finishT: null };
}

/** 1 in full flow, SLOW_FACTOR just after a bump, easing back over the last 0.3 s. */
export function slowFactor(slowT: number): number {
  if (slowT <= 0) return 1;
  const u = Math.min(1, slowT / 0.3);
  return 1 - (1 - SLOW_FACTOR) * (u * u * (3 - 2 * u));
}

export type BumpKind = "rock" | "bank";

export interface Bump {
  kind: BumpKind;
  x: number;
  s: number;
  /** Which way it threw the canoe (-1 left, +1 right). */
  dir: number;
}

/** Index of the first rock whose s is at or after `s` (rocks are sorted). */
function firstRockFrom(rocks: readonly Rock[], s: number): number {
  let lo = 0;
  let hi = rocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rocks[mid].s < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Advance one canoe by dt. `strokeV` and `strokeYaw` are what this step's presses added.
 * Returns a bump if one happened this step.
 */
export function stepCanoe(
  c: Canoe,
  dt: number,
  course: Course,
  laneX: number,
  strokeV: number,
  strokeYaw: number,
): Bump | null {
  c.v += strokeV;
  c.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, c.yaw + strokeYaw));
  c.v *= Math.exp(-DRAG * dt);
  c.yaw *= Math.exp(-dt / YAW_TAU);
  if (c.slowT > 0) c.slowT = Math.max(0, c.slowT - dt);
  if (c.bumpCd > 0) c.bumpCd = Math.max(0, c.bumpCd - dt);

  const speed = c.v * flowAt(c.s) * slowFactor(c.slowT);
  c.s += speed * dt;
  const rapids = rapidsAt(c.s);
  const pull = LANE_PULL * (1 - rapids * 0.7);
  c.x += (speed * Math.sin(c.yaw) * LATERAL_GAIN + currentAt(c.s) - pull * (c.x - laneX)) * dt;

  if (c.bumpCd > 0) return null;
  // Banks.
  if (Math.abs(c.x) > BANK_X) {
    const dir = c.x > 0 ? -1 : 1;
    c.x = Math.sign(c.x) * (BANK_X - 0.1);
    return bump(c, "bank", dir);
  }
  // Rocks within reach of the hull.
  const reach = HALF_LENGTH + 1.2;
  for (let i = firstRockFrom(course.rocks, c.s - reach); i < course.rocks.length; i++) {
    const rock = course.rocks[i];
    if (rock.s > c.s + reach) break;
    const dz = Math.max(0, Math.abs(rock.s - c.s) - HALF_LENGTH);
    const dx = c.x - rock.x;
    if (Math.hypot(dx, dz) < rock.r + HALF_WIDTH) {
      const dir = dx === 0 ? (laneX < 0 ? -1 : 1) : Math.sign(dx);
      c.x = rock.x + dir * (rock.r + HALF_WIDTH + 0.3);
      return bump(c, "rock", dir);
    }
  }
  return null;
}

function bump(c: Canoe, kind: BumpKind, dir: number): Bump {
  c.bumps++;
  c.slowT = SLOW_TIME;
  c.bumpCd = BUMP_GRACE;
  c.v *= 0.8;
  c.yaw = dir * 0.14;
  return { kind, x: c.x, s: c.s, dir };
}

/* ------------------------------------------------------------------ */
/*  CPU paddlers                                                       */
/* ------------------------------------------------------------------ */

export interface CpuSeat {
  /** Game time of the next press. */
  nextAt: number;
  /** Presses already decided (a correction). */
  queue: Side[];
}

/** First press 0.25 to 0.6 s in. 1 draw. */
export function newCpuSeat(rng: Rng): CpuSeat {
  return { nextAt: 0.25 + rng() * 0.35, queue: [] };
}

/**
 * Should this CPU paddler press now, and which side? Alternates LEFT / RIGHT at
 * cpuTwinPeriod(0.42, skill, rng) (2 draws per press, whatever the skill). When the canoe
 * is yawed more than 10 degrees it strokes the correcting side twice (once if it was
 * already on that side), then goes back to alternating. `corrUntil` is the canoe's shared
 * correction cooldown, returned updated so two CPUs in one canoe do not both correct.
 */
export function cpuStep(
  seat: CpuSeat,
  paddler: Paddler,
  yaw: number,
  t: number,
  corrUntil: number,
  skill: number,
  rng: Rng,
): { side: Side | null; corrUntil: number } {
  if (t + 1e-9 < seat.nextAt) return { side: null, corrUntil };
  let side: Side;
  if (seat.queue.length > 0) {
    side = seat.queue.shift() as Side;
  } else if (Math.abs(yaw) > YAW_CORRECT && t >= corrUntil) {
    // A positive yaw (bow right) is turned back by paddling the RIGHT side.
    const fix: Side = yaw > 0 ? "b" : "a";
    if (paddler.last !== fix) seat.queue.push(fix);
    side = fix;
    corrUntil = t + CPU_CORRECT_COOLDOWN;
  } else {
    side = paddler.last === "a" ? "b" : "a";
  }
  seat.nextAt += cpuTwinPeriod(CPU_GAP, skill, rng);
  return { side, corrUntil };
}

/* ------------------------------------------------------------------ */
/*  Teams and the result                                               */
/* ------------------------------------------------------------------ */

/**
 * Two canoes of two. The local player's canoe is team 0 (the left lane) and its partner is
 * drawn from the other three seats (1 draw). Each team lists the stern paddler first (the
 * one nearest the camera), then the bow.
 */
export function assignTeams(ids: readonly number[], localId: number, rng: Rng): [number[], number[]] {
  const me = ids.includes(localId) ? localId : ids[0];
  const others = ids.filter((id) => id !== me);
  const pick = Math.min(others.length - 1, Math.floor(rng() * others.length));
  const partner = others[pick];
  const rest = others.filter((id) => id !== partner);
  return [[me, partner], rest];
}

/** Winner by who got furthest (a tie goes to `coin`: 0 or 1). */
export function leaderTeam(dist: readonly [number, number], coin: 0 | 1): 0 | 1 {
  if (dist[0] === dist[1]) return coin;
  return dist[0] > dist[1] ? 0 : 1;
}

/**
 * The whole ranking: the winning team first, the other team after, each ordered by clean
 * strokes (then by seat id, so it never depends on array order).
 */
export function rankPlayers(
  teams: readonly [readonly number[], readonly number[]],
  winner: 0 | 1,
  strokes: ReadonlyMap<number, number> | readonly number[],
): number[] {
  const got = (id: number): number => (Array.isArray(strokes) ? ((strokes as readonly number[])[id] ?? 0) : ((strokes as ReadonlyMap<number, number>).get(id) ?? 0));
  const order = (ids: readonly number[]): number[] => [...ids].sort((p, q) => got(q) - got(p) || p - q);
  return [...order(teams[winner]), ...order(teams[winner === 0 ? 1 : 0])];
}

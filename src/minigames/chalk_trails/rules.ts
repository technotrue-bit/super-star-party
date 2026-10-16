/**
 * CHALK TRAILS — pure rules (no three.js, no DOM, no Math.random).
 *
 * A sidewalk park cut into four corner quadrants, one per seat. Each seat owns a snail
 * and the quadrant it sits in. A player DRAWS a path in chalk; the snail follows the
 * latest path at a fixed speed and picks up every gem it passes. Every RAIN_EVERY
 * seconds a rain band sweeps across, washes every chalk path away and holds the snails
 * (no drawing while it sweeps); a snail stays put until a new path is drawn.
 * 45 s, most gems wins.
 *
 * FAIR LAYOUTS. Every quadrant reads the same gem stream, mirrored into its own corner
 * (one template drawn once, up front), so nobody has a luckier corner. A respawn takes the
 * next template spot that is clear of the snail and the other gems.
 *
 * Coordinates are ground units (x right, z toward the camera). Strokes are clamped into
 * the seat's own quadrant, so a finger anywhere on the screen still draws.
 *
 * Every function is a function of its arguments. The only randomness is the rng handed to
 * makeSpawnTemplate (once, at setup) and cpuStep (always CPU_PLAN_DRAWS values per plan, at
 * every skill, on a clock that does not depend on the skill).
 */
import { cpuDrawPath } from "../cpuControls";

type Rng = () => number;

/* ------------------------------------------------------------------ */
/*  Tuning                                                             */
/* ------------------------------------------------------------------ */

export const SEATS = 4;
/** The park runs from -HALF_W..HALF_W in x and -HALF_D..HALF_D in z. */
export const HALF_W = 6.6;
export const HALF_D = 8.0;
/** Quadrants stop this far short of the centre cross, so a path never crosses it. */
export const INNER = 0.4;
export const ROUND_SECONDS = 45;
/** The rain starts at these game times (s) and sweeps for RAIN_SWEEP seconds each. */
export const RAIN_EVERY = 10;
export const RAIN_SWEEP = 1.6;
export const RAIN_TIMES: readonly number[] = [10, 20, 30, 40];
/** Snail speed (units/s): fixed, whatever the path. */
export const SNAIL_SPEED = 1.8;
/** A gem is picked up when the snail is this close (units). */
export const PICK_R = 1.05;
/** Gems standing in each quadrant, and the wait before a taken one comes back (s). */
export const GEMS_ACTIVE = 5;
export const RESPAWN_DELAY = 1.0;
/** A respawn keeps this far from the snail and from the other gems (units). */
export const SPAWN_CLEAR_SNAIL = 1.6;
export const SPAWN_CLEAR_GEM = 1.5;
/** Template spots drawn up front (a respawn walks through them in order). */
export const TEMPLATE_SIZE = 120;
/** A stroke adds a point when the pen has moved this far (units); a path holds this many points. */
export const MIN_GAP = 0.12;
export const MAX_POINTS = 600;

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

export interface Pt {
  x: number;
  z: number;
}

export interface Quad {
  sx: -1 | 1;
  sz: -1 | 1;
}

/** Seat 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right (z toward the camera is down). */
export function quadOf(seat: number): Quad {
  return { sx: seat % 2 === 0 ? -1 : 1, sz: seat < 2 ? -1 : 1 };
}

/** A spot in quadrant space (u, v each 0..1, 0 at the centre cross) as a ground point. */
export function toWorld(q: Quad, u: number, v: number): Pt {
  return { x: q.sx * (INNER + u * (HALF_W - INNER)), z: q.sz * (INNER + v * (HALF_D - INNER)) };
}

export function homeOf(seat: number): Pt {
  return toWorld(quadOf(seat), 0.5, 0.5);
}

/** The nearest point of the quadrant to (x, z). */
export function clampToQuad(q: Quad, x: number, z: number): Pt {
  const ax = Math.min(HALF_W, Math.max(INNER, q.sx * x));
  const az = Math.min(HALF_D, Math.max(INNER, q.sz * z));
  return { x: q.sx * ax, z: q.sz * az };
}

/* ------------------------------------------------------------------ */
/*  The rain                                                           */
/* ------------------------------------------------------------------ */

/** True while a rain band is sweeping at time t. */
export function isSweeping(t: number): boolean {
  for (const r of RAIN_TIMES) if (t >= r - 1e-9 && t < r + RAIN_SWEEP - 1e-9) return true;
  return false;
}

/** Seconds until the next rain starts (Infinity once the last has come). */
export function rainIn(t: number): number {
  for (const r of RAIN_TIMES) if (t < r - 1e-9) return r - t;
  return Infinity;
}

/* ------------------------------------------------------------------ */
/*  The world                                                          */
/* ------------------------------------------------------------------ */

export interface Snail {
  seat: number;
  q: Quad;
  x: number;
  z: number;
  /** The latest path; the snail is heading for path[next]. */
  path: Pt[];
  next: number;
  gems: number;
  /** Game time of the last gem picked up (breaks a tie: the earlier finish wins). */
  lastGemT: number;
  /** Distance walked (units), for the readout and the tests. */
  walked: number;
  /** Direction of travel (rad, 0 along +z), for the art. */
  heading: number;
  moving: boolean;
  /** Strokes accepted this round. */
  strokes: number;
}

export interface Gem {
  x: number;
  z: number;
  alive: boolean;
  respawnAt: number;
  /** Which template spot it stands on. */
  k: number;
}

export interface World {
  t: number;
  snails: Snail[];
  gems: Gem[][];
  /** The mirrored gem spots in quadrant space. */
  template: Array<{ u: number; v: number }>;
  /** Next template spot each seat will respawn on. */
  nextK: number[];
  rainsDone: number;
  /** Sim time the current sweep ends, else -1. */
  sweepUntil: number;
}

export type WorldEvent =
  | { type: "gem"; seat: number; slot: number; x: number; z: number }
  | { type: "respawn"; seat: number; slot: number; x: number; z: number }
  | { type: "rain"; k: number; erased: number }
  | { type: "dry"; k: number };

const NONE: readonly WorldEvent[] = Object.freeze([]);

/**
 * The gem spots for a round: TEMPLATE_SIZE points in quadrant space, each at least
 * SPAWN_CLEAR_GEM from the five before it and (for the first five) from the snail's home.
 */
export function makeSpawnTemplate(rng: Rng, n: number = TEMPLATE_SIZE): Array<{ u: number; v: number }> {
  const out: Array<{ u: number; v: number }> = [];
  const home = { u: 0.5, v: 0.5 };
  const dist = (a: { u: number; v: number }, b: { u: number; v: number }): number =>
    Math.hypot((a.u - b.u) * (HALF_W - INNER), (a.v - b.v) * (HALF_D - INNER));
  for (let i = 0; i < n; i++) {
    let pick = { u: 0.5, v: 0.5 };
    for (let tries = 0; tries < 12; tries++) {
      pick = { u: 0.07 + 0.86 * rng(), v: 0.07 + 0.86 * rng() };
      const near = out.slice(Math.max(0, i - 5));
      if (near.every((p) => dist(p, pick) >= SPAWN_CLEAR_GEM) && (i >= GEMS_ACTIVE || dist(home, pick) >= SPAWN_CLEAR_SNAIL)) break;
    }
    out.push(pick);
  }
  return out;
}

export function newWorld(template: Array<{ u: number; v: number }>, seats: number = SEATS): World {
  const snails: Snail[] = [];
  const gems: Gem[][] = [];
  for (let seat = 0; seat < seats; seat++) {
    const q = quadOf(seat);
    const home = homeOf(seat);
    snails.push({ seat, q, x: home.x, z: home.z, path: [], next: 0, gems: 0, lastGemT: 0, walked: 0, heading: 0, moving: false, strokes: 0 });
    gems.push(
      Array.from({ length: GEMS_ACTIVE }, (_, k) => {
        const p = toWorld(q, template[k].u, template[k].v);
        return { x: p.x, z: p.z, alive: true, respawnAt: 0, k };
      }),
    );
  }
  return { t: 0, snails, gems, template, nextK: new Array<number>(seats).fill(GEMS_ACTIVE), rainsDone: 0, sweepUntil: -1 };
}

/* ------------------------------------------------------------------ */
/*  Drawing                                                            */
/* ------------------------------------------------------------------ */

/** True while a rain band is sweeping and no chalk can be drawn. */
export const raining = (w: World): boolean => w.t < w.sweepUntil - 1e-9;

/** How much path the snail still has to walk (units). */
export function pathLeft(sn: Snail): number {
  let d = 0;
  let x = sn.x;
  let z = sn.z;
  for (let i = sn.next; i < sn.path.length; i++) {
    d += Math.hypot(sn.path[i].x - x, sn.path[i].z - z);
    x = sn.path[i].x;
    z = sn.path[i].z;
  }
  return d;
}

/** A new stroke begins at (x, z): it replaces the path. False while the rain sweeps. */
export function penDown(w: World, seat: number, x: number, z: number): boolean {
  if (raining(w)) return false;
  const sn = w.snails[seat];
  const p = clampToQuad(sn.q, x, z);
  sn.path = [p];
  sn.next = 0;
  sn.strokes++;
  return true;
}

/**
 * The pen moved to (x, z). A point is added once it is MIN_GAP from the last one. With no
 * path (the rain wiped it while the finger stayed down) the move starts a fresh path.
 * False while the rain sweeps.
 */
export function penMove(w: World, seat: number, x: number, z: number): boolean {
  if (raining(w)) return false;
  const sn = w.snails[seat];
  const p = clampToQuad(sn.q, x, z);
  const last = sn.path[sn.path.length - 1];
  if (!last) {
    sn.path = [p];
    sn.next = 0;
    sn.strokes++;
    return true;
  }
  if (sn.path.length >= MAX_POINTS) return false;
  if (Math.hypot(p.x - last.x, p.z - last.z) < MIN_GAP) return false;
  sn.path.push(p);
  return true;
}

/** A whole path at once (a CPU stroke). Replaces the path; false while the rain sweeps. */
export function offerPath(w: World, seat: number, pts: readonly Pt[]): boolean {
  if (raining(w) || pts.length === 0) return false;
  const sn = w.snails[seat];
  sn.path = pts.slice(0, MAX_POINTS).map((p) => clampToQuad(sn.q, p.x, p.z));
  sn.next = 0;
  sn.strokes++;
  return true;
}

/* ------------------------------------------------------------------ */
/*  The step                                                           */
/* ------------------------------------------------------------------ */

function walk(sn: Snail, dt: number): void {
  let budget = SNAIL_SPEED * dt;
  sn.moving = false;
  while (budget > 1e-9 && sn.next < sn.path.length) {
    const p = sn.path[sn.next];
    const dx = p.x - sn.x;
    const dz = p.z - sn.z;
    const d = Math.hypot(dx, dz);
    if (d <= budget) {
      sn.x = p.x;
      sn.z = p.z;
      sn.walked += d;
      budget -= d;
      sn.next++;
      if (d > 1e-6) {
        sn.heading = Math.atan2(dx, dz);
        sn.moving = true;
      }
    } else {
      sn.x += (dx / d) * budget;
      sn.z += (dz / d) * budget;
      sn.walked += budget;
      sn.heading = Math.atan2(dx, dz);
      sn.moving = true;
      budget = 0;
    }
  }
}

/** Put a gem back: the next template spot clear of the snail and the other gems. */
function respawn(w: World, seat: number, slot: number): void {
  const sn = w.snails[seat];
  const row = w.gems[seat];
  const n = w.template.length;
  const spotAt = (k: number): Pt => toWorld(sn.q, w.template[k % n].u, w.template[k % n].v);
  let chosen = w.nextK[seat];
  let at = spotAt(chosen);
  for (let k = chosen, tries = 0; tries < n; tries++, k++) {
    const p = spotAt(k);
    const clear =
      Math.hypot(p.x - sn.x, p.z - sn.z) >= SPAWN_CLEAR_SNAIL &&
      row.every((g, i) => i === slot || !g.alive || Math.hypot(p.x - g.x, p.z - g.z) >= SPAWN_CLEAR_GEM);
    if (clear) {
      chosen = k;
      at = p;
      break;
    }
  }
  w.nextK[seat] = chosen + 1;
  const g = row[slot];
  g.x = at.x;
  g.z = at.z;
  g.k = chosen % n;
  g.alive = true;
}

/** Advance the world by dt seconds. Returns what happened (a shared empty list when nothing did). */
export function stepWorld(w: World, dt: number): readonly WorldEvent[] {
  let events: WorldEvent[] | null = null;
  const add = (e: WorldEvent): void => {
    (events ??= []).push(e);
  };

  // The rain comes: every path is washed away and the snails stop.
  if (w.rainsDone < RAIN_TIMES.length && w.t >= RAIN_TIMES[w.rainsDone] - 1e-9) {
    let erased = 0;
    for (const sn of w.snails) {
      if (sn.path.length > 0) erased++;
      sn.path = [];
      sn.next = 0;
      sn.moving = false;
    }
    w.sweepUntil = RAIN_TIMES[w.rainsDone] + RAIN_SWEEP;
    add({ type: "rain", k: w.rainsDone, erased });
    w.rainsDone++;
  }
  if (w.sweepUntil >= 0 && w.t >= w.sweepUntil - 1e-9) {
    w.sweepUntil = -1;
    add({ type: "dry", k: w.rainsDone - 1 });
  }

  for (let seat = 0; seat < w.snails.length; seat++) {
    const row = w.gems[seat];
    for (let slot = 0; slot < row.length; slot++) {
      const g = row[slot];
      if (!g.alive && w.t >= g.respawnAt - 1e-9) {
        respawn(w, seat, slot);
        add({ type: "respawn", seat, slot, x: g.x, z: g.z });
      }
    }
    const sn = w.snails[seat];
    if (!raining(w)) walk(sn, dt);
    for (let slot = 0; slot < row.length; slot++) {
      const g = row[slot];
      if (g.alive && Math.hypot(g.x - sn.x, g.z - sn.z) <= PICK_R) {
        g.alive = false;
        g.respawnAt = w.t + RESPAWN_DELAY;
        sn.gems++;
        sn.lastGemT = w.t;
        add({ type: "gem", seat, slot, x: g.x, z: g.z });
      }
    }
  }
  w.t += dt;
  return events ?? NONE;
}

/** True once the round clock has run out. */
export const roundOver = (w: World): boolean => w.t >= ROUND_SECONDS - 1e-9;

/* ------------------------------------------------------------------ */
/*  Ranking                                                            */
/* ------------------------------------------------------------------ */

export interface Tally {
  id: number;
  gems: number;
  lastGemT: number;
  coin: number;
}

/** Most gems first; a tie goes to who got there first, then a per-round coin drawn at setup. */
export function rankSnails(tallies: readonly Tally[]): number[] {
  return [...tallies]
    .sort((a, b) => b.gems - a.gems || a.lastGemT - b.lastGemT || b.coin - a.coin || a.id - b.id)
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

/** A CPU tour has up to this many gems, one chalk point each. */
export const CPU_TOUR = 4;
/** rng draws per plan: cpuDrawPath's 2 per point. */
export const CPU_PLAN_DRAWS = 2 * CPU_TOUR;
/** A CPU plans this often within a rain-free stretch (s), and not in the last CPU_TAIL of it. */
export const CPU_PLAN_GAP = 2.4;
export const CPU_TAIL = 2.4;
/** The CPU takes this long (divided by skill squared) to notice the rain has passed and start drawing (s). */
export const CPU_REACT = 1.25;

/** Seconds the CPU waits after a plan slot comes up. */
export const cpuReact = (skill: number): number => CPU_REACT / (skill * skill);

/** Game times of every plan slot: a constant list, so the number of plans never depends on skill. */
export const CPU_PLAN_TIMES: readonly number[] = (() => {
  const starts = [0, ...RAIN_TIMES.map((r) => r + RAIN_SWEEP)];
  const ends = [...RAIN_TIMES, ROUND_SECONDS];
  const out: number[] = [];
  starts.forEach((s, i) => {
    const len = ends[i] - s;
    for (let j = 0; s + j * CPU_PLAN_GAP <= s + len - CPU_TAIL + 1e-9; j++) out.push(s + j * CPU_PLAN_GAP);
  });
  return out;
})();

export interface CpuBrain {
  /** Index of the next plan slot. */
  next: number;
}

export const newCpuBrain = (): CpuBrain => ({ next: 0 });

/** The nearest-gem tour of up to `max` gems from (x, z), over the gems standing now. */
export function nearestTour(from: Pt, gems: readonly Pick<Gem, "x" | "z" | "alive">[], max: number): Pt[] {
  const left = gems.filter((g) => g.alive).map((g) => ({ x: g.x, z: g.z }));
  const out: Pt[] = [];
  let cur = from;
  while (out.length < max && left.length > 0) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = Math.hypot(left[i].x - cur.x, left[i].z - cur.z);
      if (d < bd - 1e-9) {
        bd = d;
        bi = i;
      }
    }
    cur = left.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

/**
 * The 0..1 square cpuDrawPath wobbles in spans PEN_SPAN ground units, so a CPU's hand at
 * Normal (sd 0.02) is off by about 0.8 units, a Relaxed hand (0.7) by 1.1 and a Challenge
 * hand (1.3) by 0.6. Tuned so a Normal CPU gathers about what a keyboard pen does.
 */
export const PEN_SPAN = 40;
const toUnit = (p: Pt): [number, number] => [p.x / PEN_SPAN + 0.5, p.z / PEN_SPAN + 0.5];
const fromUnit = (u: [number, number]): Pt => ({ x: (u[0] - 0.5) * PEN_SPAN, z: (u[1] - 0.5) * PEN_SPAN });

/**
 * The path a CPU draws now: the nearest-gem tour, one chalk point per gem, padded to
 * CPU_TOUR points by standing on the last gem, then wobbled by cpuDrawPath. Always
 * CPU_PLAN_DRAWS rng draws, at every skill.
 */
export function cpuPlanPath(w: World, seat: number, skill: number, rng: Rng): Pt[] {
  const sn = w.snails[seat];
  const tour = nearestTour({ x: sn.x, z: sn.z }, w.gems[seat], CPU_TOUR);
  const pts: Array<[number, number]> = [];
  let cur: Pt = { x: sn.x, z: sn.z };
  for (let i = 0; i < CPU_TOUR; i++) {
    cur = tour[i] ?? cur;
    pts.push(toUnit(cur));
  }
  return cpuDrawPath(pts, skill, rng).map(fromUnit);
}

/**
 * One CPU decision for this step: when a plan slot is due (its time plus the reaction),
 * draw a path and hand it to the snail. Returns true on the step a plan was made.
 */
export function cpuStep(brain: CpuBrain, w: World, seat: number, skill: number, rng: Rng): boolean {
  if (brain.next >= CPU_PLAN_TIMES.length) return false;
  if (w.t < CPU_PLAN_TIMES[brain.next] + cpuReact(skill) - 1e-9) return false;
  brain.next++;
  const pts = cpuPlanPath(w, seat, skill, rng);
  offerPath(w, seat, pts);
  return true;
}

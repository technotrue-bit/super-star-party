import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../core/rng";
import {
  CPU_PLAN_DRAWS,
  CPU_TOUR,
  CPU_PLAN_TIMES,
  CPU_TAIL,
  GEMS_ACTIVE,
  HALF_D,
  HALF_W,
  INNER,
  MAX_POINTS,
  MIN_GAP,
  PICK_R,
  RAIN_SWEEP,
  RAIN_TIMES,
  RESPAWN_DELAY,
  ROUND_SECONDS,
  SEATS,
  SNAIL_SPEED,
  SPAWN_CLEAR_GEM,
  clampToQuad,
  cpuPlanPath,
  cpuReact,
  cpuStep,
  homeOf,
  isSweeping,
  makeCoins,
  makeSpawnTemplate,
  nearestTour,
  newCpuBrain,
  newWorld,
  offerPath,
  pathLeft,
  penDown,
  penMove,
  quadOf,
  rainIn,
  raining,
  rankSnails,
  roundOver,
  stepWorld,
  type CpuBrain,
  type Pt,
  type World,
} from "./rules";

const DT = 1 / 60;

function freshWorld(seed = 1): World {
  return newWorld(makeSpawnTemplate(mulberry32(seed)));
}

/** Step the world for `secs`, returning every event. */
function run(w: World, secs: number): ReturnType<typeof stepWorld>[number][] {
  const out: ReturnType<typeof stepWorld>[number][] = [];
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) out.push(...stepWorld(w, DT));
  return out;
}

/** Remove every gem from a seat's quadrant so a test can walk freely. */
function clearGems(w: World, seat: number): void {
  for (const g of w.gems[seat]) {
    g.alive = false;
    g.respawnAt = 1e9;
  }
}

describe("layout", () => {
  it("four quadrants, one per seat, around the centre cross", () => {
    expect(SEATS).toBe(4);
    expect([0, 1, 2, 3].map((s) => quadOf(s))).toEqual([
      { sx: -1, sz: -1 },
      { sx: 1, sz: -1 },
      { sx: -1, sz: 1 },
      { sx: 1, sz: 1 },
    ]);
    for (let seat = 0; seat < 4; seat++) {
      const home = homeOf(seat);
      const q = quadOf(seat);
      expect(Math.sign(home.x)).toBe(q.sx);
      expect(Math.sign(home.z)).toBe(q.sz);
      // the home spot is already inside the seat's own quadrant
      expect(clampToQuad(q, home.x, home.z)).toEqual(home);
    }
  });

  it("clamps a point into the seat's quadrant, wherever the finger is", () => {
    const q = quadOf(0);
    expect(clampToQuad(q, 3, 3)).toEqual({ x: -INNER, z: -INNER });
    expect(clampToQuad(q, -50, -50)).toEqual({ x: -HALF_W, z: -HALF_D });
    expect(clampToQuad(q, -2, -3)).toEqual({ x: -2, z: -3 });
    const br = quadOf(3);
    expect(clampToQuad(br, -1, -1)).toEqual({ x: INNER, z: INNER });
  });

  it("every quadrant sees the same gem layout, mirrored into its own corner", () => {
    const w = freshWorld(5);
    for (let slot = 0; slot < GEMS_ACTIVE; slot++) {
      const a = w.gems[0][slot];
      for (let seat = 1; seat < 4; seat++) {
        const b = w.gems[seat][slot];
        expect(Math.abs(b.x)).toBeCloseTo(Math.abs(a.x), 9);
        expect(Math.abs(b.z)).toBeCloseTo(Math.abs(a.z), 9);
        expect(Math.sign(b.x)).toBe(quadOf(seat).sx);
        expect(Math.sign(b.z)).toBe(quadOf(seat).sz);
      }
    }
  });

  it("the spawn template is the same for the same seed and keeps its gems apart", () => {
    const a = makeSpawnTemplate(mulberry32(9));
    const b = makeSpawnTemplate(mulberry32(9));
    expect(a).toEqual(b);
    expect(makeSpawnTemplate(mulberry32(10))).not.toEqual(a);
    // The five that stand together are clear of each other and of the snail's start.
    const w = newWorld(a);
    for (const row of w.gems) {
      for (let i = 0; i < row.length; i++) {
        for (let j = i + 1; j < row.length; j++) expect(Math.hypot(row[i].x - row[j].x, row[i].z - row[j].z)).toBeGreaterThanOrEqual(SPAWN_CLEAR_GEM - 1e-9);
      }
    }
    for (let seat = 0; seat < 4; seat++) {
      for (const g of w.gems[seat]) {
        expect(Math.hypot(g.x - w.snails[seat].x, g.z - w.snails[seat].z)).toBeGreaterThan(PICK_R * 1.5);
      }
    }
  });
});

describe("the rain", () => {
  it("comes at 10, 20, 30 and 40 s and sweeps for a moment", () => {
    expect(RAIN_TIMES).toEqual([10, 20, 30, 40]);
    expect(isSweeping(9.99)).toBe(false);
    expect(isSweeping(10)).toBe(true);
    expect(isSweeping(10 + RAIN_SWEEP - 0.01)).toBe(true);
    expect(isSweeping(10 + RAIN_SWEEP)).toBe(false);
    expect(isSweeping(40.5)).toBe(true);
    expect(isSweeping(44)).toBe(false);
    expect(rainIn(0)).toBe(10);
    expect(rainIn(10.5)).toBeCloseTo(9.5, 9); // the next one is the 20 s rain
    expect(rainIn(41)).toBe(Infinity);
  });

  it("washes every path away and holds the snails until a new path is drawn", () => {
    const w = freshWorld();
    clearGems(w, 0);
    penDown(w, 0, -3, -3);
    penMove(w, 0, -3, -7);
    run(w, 9.9);
    expect(w.snails[0].path.length).toBeGreaterThan(0);
    const events = run(w, 0.2);
    expect(events.filter((e) => e.type === "rain")).toHaveLength(1);
    for (const sn of w.snails) {
      expect(sn.path).toEqual([]);
      expect(sn.moving).toBe(false);
    }
    // the snails stay put through the whole sweep and after, until a stroke comes
    const at = { x: w.snails[0].x, z: w.snails[0].z };
    run(w, RAIN_SWEEP + 3);
    expect(w.snails[0]).toMatchObject(at);
  });

  it("reports how many paths it erased", () => {
    const w = freshWorld();
    offerPath(w, 0, [{ x: -3, z: -3 }, { x: -3, z: -7 }]);
    offerPath(w, 2, [{ x: -3, z: 3 }, { x: -3, z: 7 }]);
    const events = run(w, 10.1);
    expect(events.find((e) => e.type === "rain")).toMatchObject({ type: "rain", k: 0, erased: 2 });
  });

  it("ignores drawing while it sweeps, and takes it again once it has passed", () => {
    const w = freshWorld();
    run(w, 10.2);
    expect(raining(w)).toBe(true);
    expect(penDown(w, 0, -3, -3)).toBe(false);
    expect(penMove(w, 0, -3, -4)).toBe(false);
    expect(offerPath(w, 0, [{ x: -3, z: -3 }])).toBe(false);
    expect(w.snails[0].path).toEqual([]);
    run(w, RAIN_SWEEP);
    expect(raining(w)).toBe(false);
    expect(penDown(w, 0, -3, -3)).toBe(true);
    expect(w.snails[0].path).toHaveLength(1);
  });

  it("a finger that stays down through the rain starts a new path when it moves again", () => {
    const w = freshWorld();
    penDown(w, 0, -3, -3);
    run(w, 10 + RAIN_SWEEP + 0.1);
    expect(w.snails[0].path).toEqual([]);
    expect(penMove(w, 0, -4, -5)).toBe(true);
    expect(w.snails[0].path).toEqual([{ x: -4, z: -5 }]);
  });

  it("emits dry when the band has gone", () => {
    const w = freshWorld();
    const events = run(w, 10 + RAIN_SWEEP + 0.1);
    expect(events.filter((e) => e.type === "dry")).toHaveLength(1);
  });
});

describe("drawing and walking", () => {
  it("a snail with no path stands still", () => {
    const w = freshWorld();
    const sn = w.snails[1];
    const at = { x: sn.x, z: sn.z };
    run(w, 5);
    expect(sn).toMatchObject(at);
    expect(sn.moving).toBe(false);
  });

  it("follows the path at the fixed speed and stops at its end", () => {
    const w = freshWorld();
    clearGems(w, 0);
    const sn = w.snails[0];
    const start = { x: sn.x, z: sn.z };
    const goal = { x: start.x, z: start.z - 3 };
    offerPath(w, 0, [goal]);
    run(w, 1);
    expect(Math.hypot(sn.x - start.x, sn.z - start.z)).toBeCloseTo(SNAIL_SPEED, 1);
    expect(sn.moving).toBe(true);
    run(w, 3);
    expect(sn).toMatchObject(goal);
    expect(sn.moving).toBe(false);
    expect(sn.walked).toBeCloseTo(3, 6);
  });

  it("walks a bent path corner by corner at the same speed", () => {
    const w = freshWorld();
    clearGems(w, 0);
    const sn = w.snails[0];
    const a = { x: sn.x, z: sn.z - 2 };
    const b = { x: sn.x - 2, z: sn.z - 2 };
    offerPath(w, 0, [a, b]);
    run(w, 4 / SNAIL_SPEED + 0.05);
    expect(sn).toMatchObject(b);
    expect(sn.walked).toBeCloseTo(4, 6);
  });

  it("is the same speed whatever the step size", () => {
    const a = freshWorld();
    const b = freshWorld();
    clearGems(a, 0);
    clearGems(b, 0);
    offerPath(a, 0, [{ x: -3.5, z: -2 }]);
    offerPath(b, 0, [{ x: -3.5, z: -2 }]);
    for (let i = 0; i < 60; i++) stepWorld(a, DT);
    for (let i = 0; i < 15; i++) stepWorld(b, DT * 4);
    expect(a.snails[0].x).toBeCloseTo(b.snails[0].x, 6);
    expect(a.snails[0].z).toBeCloseTo(b.snails[0].z, 6);
  });

  it("a new stroke replaces the path and the snail turns to it", () => {
    const w = freshWorld();
    clearGems(w, 0);
    const sn = w.snails[0];
    offerPath(w, 0, [{ x: sn.x, z: sn.z - 3 }]);
    run(w, 0.5);
    penDown(w, 0, sn.x + 2, sn.z + 2);
    expect(sn.path).toEqual([{ x: sn.x + 2, z: sn.z + 2 }]);
    expect(sn.next).toBe(0);
    expect(sn.strokes).toBe(2);
  });

  it("a stroke is clamped into the seat's own quadrant", () => {
    const w = freshWorld();
    penDown(w, 3, -5, -5);
    expect(w.snails[3].path[0]).toEqual({ x: INNER, z: INNER });
    penMove(w, 3, 99, 99);
    expect(w.snails[3].path[1]).toEqual({ x: HALF_W, z: HALF_D });
  });

  it("adds a point only when the pen has moved MIN_GAP, and caps the path", () => {
    const w = freshWorld();
    penDown(w, 0, -3, -3);
    expect(penMove(w, 0, -3, -3 - MIN_GAP / 2)).toBe(false);
    expect(penMove(w, 0, -3, -3 - MIN_GAP * 1.01)).toBe(true);
    expect(w.snails[0].path).toHaveLength(2);
    // a long scribble stops growing at MAX_POINTS
    let z = -3;
    for (let i = 0; i < MAX_POINTS * 2; i++) {
      z = -3 - ((i + 2) % 40) * 0.1 * (i % 2 === 0 ? 1 : -1);
      penMove(w, 0, -3 + ((i * 0.37) % 3), z);
    }
    expect(w.snails[0].path.length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("tells how much path is left to walk", () => {
    const w = freshWorld();
    clearGems(w, 0);
    const sn = w.snails[0];
    offerPath(w, 0, [{ x: sn.x, z: sn.z - 2 }, { x: sn.x - 2, z: sn.z - 2 }]);
    expect(pathLeft(sn)).toBeCloseTo(4, 9);
    run(w, 1);
    expect(pathLeft(sn)).toBeCloseTo(4 - SNAIL_SPEED, 1);
  });
});

describe("gems", () => {
  it("picks one up when the snail walks within reach, and counts it", () => {
    const w = freshWorld();
    const sn = w.snails[0];
    const gem = w.gems[0][0];
    offerPath(w, 0, [{ x: gem.x, z: gem.z }]);
    const events = run(w, 6);
    expect(sn.gems).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === "gem" && e.seat === 0 && e.slot === 0)).toBe(true);
    // the other snails did nothing
    expect(w.snails[1].gems).toBe(0);
  });

  it("walks past a gem it never gets near", () => {
    const w = freshWorld();
    clearGems(w, 0);
    const sn = w.snails[0];
    w.gems[0][0] = { x: sn.x, z: sn.z - 3, alive: true, respawnAt: 0, k: 0 };
    offerPath(w, 0, [{ x: sn.x + PICK_R * 1.5, z: sn.z - 3 }]);
    run(w, 4);
    expect(sn.gems).toBe(0);
    expect(w.gems[0][0].alive).toBe(true);
  });

  it("a gem comes back after the respawn delay at a clear spot, and the quadrant stays full", () => {
    const w = freshWorld(3);
    const sn = w.snails[0];
    const first = w.gems[0][0];
    offerPath(w, 0, [{ x: first.x, z: first.z }]);
    let tTaken = -1;
    let tBack = -1;
    for (let i = 0; i < 60 * 12; i++) {
      for (const e of stepWorld(w, DT)) {
        if (e.type === "gem" && e.seat === 0 && e.slot === 0 && tTaken < 0) tTaken = w.t;
        if (e.type === "respawn" && e.seat === 0 && e.slot === 0 && tBack < 0) tBack = w.t;
      }
      if (tBack > 0) break;
    }
    expect(tTaken).toBeGreaterThan(0);
    expect(tBack - tTaken).toBeGreaterThanOrEqual(RESPAWN_DELAY - 0.05);
    expect(tBack - tTaken).toBeLessThan(RESPAWN_DELAY + 0.1);
    const back = w.gems[0][0];
    expect(back.alive).toBe(true);
    // not on top of the snail, and a different spot
    expect(Math.hypot(back.x - sn.x, back.z - sn.z)).toBeGreaterThanOrEqual(1.6 - 1e-9);
    expect(back.k).not.toBe(0);
    expect(w.gems[0].filter((g) => g.alive).length).toBeGreaterThanOrEqual(GEMS_ACTIVE - 1);
  });

  it("respawns the same way on a replay of the same seed", () => {
    const play = (): string => {
      const w = freshWorld(4);
      const rng = mulberry32(99);
      const brains = Array.from({ length: SEATS }, newCpuBrain);
      while (!roundOver(w)) {
        for (let s = 0; s < SEATS; s++) cpuStep(brains[s], w, s, 1, rng);
        stepWorld(w, DT);
      }
      return JSON.stringify([w.snails.map((s) => [s.gems, s.walked.toFixed(6)]), w.gems.map((r) => r.map((g) => [g.k, g.alive]))]);
    };
    expect(play()).toBe(play());
  });
});

describe("ranking", () => {
  it("most gems first", () => {
    expect(
      rankSnails([
        { id: 0, gems: 4, lastGemT: 10, coin: 0.1 },
        { id: 1, gems: 9, lastGemT: 40, coin: 0.2 },
        { id: 2, gems: 6, lastGemT: 20, coin: 0.3 },
        { id: 3, gems: 1, lastGemT: 5, coin: 0.4 },
      ]),
    ).toEqual([1, 2, 0, 3]);
  });

  it("a tie goes to whoever got there first, then the coin", () => {
    expect(
      rankSnails([
        { id: 0, gems: 5, lastGemT: 30, coin: 0.9 },
        { id: 1, gems: 5, lastGemT: 20, coin: 0.1 },
        { id: 2, gems: 5, lastGemT: 20, coin: 0.8 },
        { id: 3, gems: 5, lastGemT: 44, coin: 0.5 },
      ]),
    ).toEqual([2, 1, 0, 3]);
  });

  it("draws exactly one value per seat for the coins", () => {
    let n = 0;
    const rng = mulberry32(5);
    makeCoins(() => (n++, rng()), 4);
    expect(n).toBe(4);
  });

  it("the round, rain included, stays under a minute", () => {
    expect(ROUND_SECONDS).toBeGreaterThanOrEqual(30);
    expect(ROUND_SECONDS).toBeLessThanOrEqual(60 - 3);
    const w = freshWorld();
    expect(roundOver(w)).toBe(false);
    run(w, ROUND_SECONDS + 0.1);
    expect(roundOver(w)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  CPU                                                                */
/* ------------------------------------------------------------------ */

describe("CPU", () => {
  it("plans a nearest-gem tour of up to four gems", () => {
    const gems = [
      { x: 0, z: 5, alive: true },
      { x: 0, z: 1, alive: true },
      { x: 0, z: 2, alive: true },
      { x: 0, z: 9, alive: false },
      { x: 0, z: 3.5, alive: true },
      { x: 0, z: 20, alive: true },
    ];
    const tour = nearestTour({ x: 0, z: 0 }, gems, 4);
    expect(tour.map((p) => p.z)).toEqual([1, 2, 3.5, 5]);
    expect(nearestTour({ x: 0, z: 0 }, gems.slice(0, 2), 4)).toHaveLength(2);
    expect(nearestTour({ x: 0, z: 0 }, [], 4)).toEqual([]);
  });

  it("always draws CPU_PLAN_DRAWS values for a plan, at every skill, however many gems are standing", () => {
    for (const standing of [GEMS_ACTIVE, 2, 0]) {
      const counts = [0.7, 1, 1.3].map((skill) => {
        const w = freshWorld(2);
        for (let i = standing; i < GEMS_ACTIVE; i++) w.gems[1][i].alive = false;
        let n = 0;
        const rng0 = mulberry32(8);
        const path = cpuPlanPath(w, 1, skill, () => (n++, rng0()));
        expect(path).toHaveLength(CPU_TOUR);
        return n;
      });
      expect(counts).toEqual([CPU_PLAN_DRAWS, CPU_PLAN_DRAWS, CPU_PLAN_DRAWS]);
    }
  });

  it("draws the same number of values over a whole round at every skill", () => {
    const counts = [0.7, 1, 1.3].map((skill) => {
      const w = freshWorld(6);
      let n = 0;
      const rng0 = mulberry32(21);
      const rng = () => (n++, rng0());
      const brains: CpuBrain[] = Array.from({ length: SEATS }, newCpuBrain);
      while (!roundOver(w)) {
        for (let s = 0; s < SEATS; s++) cpuStep(brains[s], w, s, skill, rng);
        stepWorld(w, DT);
      }
      return n;
    });
    expect(counts[0]).toBe(counts[1]);
    expect(counts[1]).toBe(counts[2]);
    expect(counts[0]).toBe(CPU_PLAN_TIMES.length * SEATS * CPU_PLAN_DRAWS);
  });

  it("plans on a clock the skill cannot move across a rain: every plan lands in a dry stretch", () => {
    for (const skill of [0.7, 1, 1.3]) {
      for (const base of CPU_PLAN_TIMES) {
        const at = base + cpuReact(skill);
        expect(isSweeping(at), `${base} @${skill}`).toBe(false);
        // and before the next rain, with room to spare
        expect(rainIn(base)).toBeGreaterThanOrEqual(CPU_TAIL - 1e-9);
      }
    }
  });

  it("redraws after each rain", () => {
    const w = freshWorld(2);
    const brain = newCpuBrain();
    const rng = mulberry32(3);
    const stamps: number[] = [];
    while (!roundOver(w)) {
      const strokes = w.snails[0].strokes;
      cpuStep(brain, w, 0, 1, rng);
      if (w.snails[0].strokes > strokes) stamps.push(Math.round(w.t * 100) / 100);
      stepWorld(w, DT);
    }
    for (const r of RAIN_TIMES) {
      const after = stamps.filter((t) => t >= r + RAIN_SWEEP && t < r + RAIN_SWEEP + 3);
      expect(after.length, `after the ${r} s rain`).toBeGreaterThanOrEqual(1);
    }
    // never while the band sweeps
    for (const t of stamps) expect(isSweeping(t)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Rounds                                                             */
/* ------------------------------------------------------------------ */

interface Style {
  name: string;
  /** Pen speed over the ground (units/s). */
  speed: number;
  /** Aim error on each target (units, one sd per axis). */
  aimSd: number;
  /** Pause on each target before the next leg (s). */
  settle: number;
  /** Time to notice the rain has passed and start (s). */
  react: number;
  /** Thinking time between strokes (s). */
  think: number;
  /** Gems in a tour. */
  tour: number;
  /** A finger starts on the snail; a keyboard pen starts where the cursor was left. */
  fromSnail: boolean;
  /** Plan the next stroke once this little path is left (units). */
  replanLeft: number;
}

/** A phone player who plans a 5-gem tour and draws it fast and neatly. */
const TOUCH_SKILLED: Style = { name: "touch (skilled)", speed: 14, aimSd: 0.3, settle: 0, react: 0.5, think: 0.25, tour: 5, fromSnail: true, replanLeft: 1.0 };
/** A phone player who aims loosely, draws short tours and is slow to restart. */
const TOUCH_CASUAL: Style = { name: "touch (casual)", speed: 10, aimSd: 0.5, settle: 0, react: 1.0, think: 0.45, tour: 3, fromSnail: true, replanLeft: 0.6 };
/** Space + arrows: a cursor in 8 directions, off the snail at the start of each stroke, aimed by eye. */
const KEYBOARD: Style = { name: "keyboard", speed: 9, aimSd: 0.4, settle: 0.2, react: 0.5, think: 0.3, tour: 4, fromSnail: false, replanLeft: 1.2 };

interface Human {
  style: Style;
  rng: () => number;
  /** The pen: where the cursor stands between strokes. */
  pen: Pt;
  waypoints: Pt[];
  wi: number;
  wait: number;
  drawing: boolean;
  readyAt: number;
}

function newHuman(style: Style, seed: number, seat: number): Human {
  // A keyboard cursor starts at the middle of the screen, which is the inner corner of every quadrant.
  const q = quadOf(seat);
  return { style, rng: mulberry32(seed * 7919 + 13), pen: clampToQuad(q, 0, 0), waypoints: [], wi: 0, wait: 0, drawing: false, readyAt: style.react };
}

function gauss(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

function humanStep(h: Human, w: World, seat: number): void {
  const st = h.style;
  const sn = w.snails[seat];
  if (raining(w)) {
    h.drawing = false;
    h.waypoints = [];
    h.readyAt = w.sweepUntil + st.react;
    return;
  }
  if (!h.drawing) {
    const free = sn.next >= sn.path.length || pathLeft(sn) < st.replanLeft;
    if (w.t < h.readyAt || !free) return;
    const start = st.fromSnail ? { x: sn.x + gauss(h.rng) * 0.1, z: sn.z + gauss(h.rng) * 0.1 } : h.pen;
    const tour = nearestTour(start, w.gems[seat], st.tour);
    if (tour.length === 0) return;
    h.waypoints = tour.map((p) => ({ x: p.x + gauss(h.rng) * st.aimSd, z: p.z + gauss(h.rng) * st.aimSd }));
    h.wi = 0;
    h.wait = 0;
    h.drawing = true;
    h.pen = start;
    penDown(w, seat, start.x, start.z);
    return;
  }
  if (h.wait > 0) {
    h.wait -= DT;
    return;
  }
  const target = h.waypoints[h.wi];
  const d = Math.hypot(target.x - h.pen.x, target.z - h.pen.z);
  const reach = st.speed * DT;
  if (d <= reach) {
    h.pen = target;
    h.wi++;
    h.wait = st.settle;
  } else {
    h.pen = { x: h.pen.x + ((target.x - h.pen.x) / d) * reach, z: h.pen.z + ((target.z - h.pen.z) / d) * reach };
  }
  penMove(w, seat, h.pen.x, h.pen.z);
  if (h.wi >= h.waypoints.length) {
    h.drawing = false;
    h.pen = clampToQuad(sn.q, h.pen.x, h.pen.z);
    h.readyAt = w.t + st.think;
  }
}

/** One round: seat 0 is `style` (or a CPU), the other three are CPUs at `skill`. */
function playRound(seed: number, skill: number, style: Style | null): { gems: number[]; draws: number; world: World } {
  const rng0 = mulberry32(seed);
  let draws = 0;
  const rng = () => (draws++, rng0());
  const w = newWorld(makeSpawnTemplate(rng));
  const brains = Array.from({ length: SEATS }, newCpuBrain);
  const human = style ? newHuman(style, seed, 0) : null;
  while (!roundOver(w)) {
    for (let s = 0; s < SEATS; s++) {
      if (s === 0 && human) humanStep(human, w, 0);
      else cpuStep(brains[s], w, s, skill, rng);
    }
    stepWorld(w, DT);
  }
  return { gems: w.snails.map((s) => s.gems), draws, world: w };
}

const N = 60;

interface Standing {
  /** Share of rounds seat 0 gathered strictly more than every other seat. */
  win: number;
  /** Share of rounds seat 0 finished first or second (ties against it). */
  top2: number;
  mean: number;
  cpuMean: number;
}

const memo = new Map<string, Standing>();

/** Seat 0 as `style` (or a CPU when null) against three CPUs at `skill`, over N seeded rounds. */
function standing(style: Style | null, skill: number): Standing {
  const key = `${style?.name ?? "cpu"}@${skill}`;
  const hit = memo.get(key);
  if (hit) return hit;
  let win = 0;
  let top2 = 0;
  let sum = 0;
  let cpu = 0;
  for (let seed = 1; seed <= N; seed++) {
    const { gems } = playRound(seed, skill, style);
    const others = gems.slice(1);
    if (gems[0] > Math.max(...others)) win++;
    if (others.filter((g) => g >= gems[0]).length <= 1) top2++;
    sum += gems[0];
    cpu += others.reduce((a, b) => a + b, 0) / others.length;
  }
  const s = { win: win / N, top2: top2 / N, mean: sum / N, cpuMean: cpu / N };
  memo.set(key, s);
  return s;
}

describe("CPU skill levels", () => {
  it("Relaxed gathers clearly less than Normal, Challenge clearly more", () => {
    const relaxed = standing(null, 0.7).mean;
    const normal = standing(null, 1).mean;
    const challenge = standing(null, 1.3).mean;
    expect(relaxed).toBeLessThan(normal * 0.85);
    expect(challenge).toBeGreaterThan(normal * 1.08);
    // a Normal CPU gathers a gem every couple of seconds
    expect(normal).toBeGreaterThan(18);
    expect(normal).toBeLessThan(27);
  });

  it("a whole CPU round is the same on a replay of the same seed", () => {
    const a = playRound(11, 1, null);
    const b = playRound(11, 1, null);
    expect(a.gems).toEqual(b.gems);
    expect(a.draws).toBe(b.draws);
  });
});

describe("every input can win", () => {
  it("a keyboard pen (Space + arrows, a cursor left where it stopped) beats Relaxed CPUs in most rounds", () => {
    expect(standing(KEYBOARD, 0.7).win).toBeGreaterThan(0.6);
  });

  it("a keyboard pen keeps pace with Normal CPUs: close on gems, a real share of the wins", () => {
    const k = standing(KEYBOARD, 1);
    expect(k.mean).toBeGreaterThan(k.cpuMean * 0.9);
    expect(k.win).toBeGreaterThanOrEqual(0.12);
    expect(k.top2).toBeGreaterThanOrEqual(0.3);
  });

  it("a casual finger wins most rounds against Normal CPUs, a skilled one nearly all", () => {
    expect(standing(TOUCH_CASUAL, 1).win).toBeGreaterThan(0.5);
    expect(standing(TOUCH_SKILLED, 1).win).toBeGreaterThan(0.8);
  });

  it("a skilled finger still has a real chance against Challenge CPUs", () => {
    const s = standing(TOUCH_SKILLED, 1.3);
    expect(s.win).toBeGreaterThanOrEqual(0.3);
    expect(s.win).toBeLessThan(0.9);
  });

  it("Relaxed is easier than Normal and Challenge is harder, for every input", () => {
    for (const style of [KEYBOARD, TOUCH_CASUAL, TOUCH_SKILLED]) {
      const r = standing(style, 0.7);
      const n = standing(style, 1);
      const c = standing(style, 1.3);
      expect(r.win, `${style.name} relaxed vs normal`).toBeGreaterThan(n.win);
      expect(n.win, `${style.name} normal vs challenge`).toBeGreaterThan(c.win);
    }
  });

  it("a player who never draws gathers nothing", () => {
    const w = freshWorld();
    run(w, ROUND_SECONDS);
    expect(w.snails[0].gems).toBe(0);
    expect(w.snails[0].walked).toBe(0);
  });
});

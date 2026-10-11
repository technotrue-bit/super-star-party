/**
 * SUPER STAR PARTY — pipe_puzzle: pure puzzle logic (no THREE, no DOM).
 *
 * A 4x4 board of pipe tiles. Water enters the left edge of row ENTRY_ROW and
 * must leave the right edge of the puzzle's exit row, where the star sits.
 *
 * ONE source of truth for a pipe's openings: KIND_SIDES. The art (art.ts)
 * draws one arm per entry of that list and the logic builds its masks from
 * the same list. A quarter turn is CLOCKWISE seen from above, both in the
 * logic (side s moves to s+1: N->E->S->W) and on screen (tileYaw).
 *
 * Flow is strict two-sided: water passes from a tile to its neighbour only
 * when both open toward each other, and the first tile is wet only if it
 * opens toward the spout.
 *
 * Also here, so the game and the headless balance sim share one copy: the
 * exact minimum-press solver, the puzzle generator and the per-seat race
 * model (CPU timing + press choice). Every random draw comes from the rng
 * passed in (ctx.rng in the game).
 *
 * Imported by a Node sim (`node --experimental-strip-types`), so this file
 * must stay free of runtime imports and of TS-only runtime syntax.
 */

/* ------------------------------------------------------------------ */
/*  Board geometry and sides                                           */
/* ------------------------------------------------------------------ */

export const SIZE = 4;
export const CELLS = SIZE * SIZE;
/** Water always enters the left edge of this row. */
export const ENTRY_ROW = 1;

/** Sides: 0 = N (screen up, -z), 1 = E (+x), 2 = S (+z), 3 = W (-x). */
export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;
export const DR = [-1, 0, 1, 0] as const;
export const DC = [0, 1, 0, -1] as const;

export type PipeKind = "straight" | "elbow" | "tee";
export const PIPE_KINDS: readonly PipeKind[] = ["straight", "elbow", "tee"];

/**
 * THE openings of each kind at rot 0. art.ts draws exactly these arms;
 * maskOf() builds the logic from exactly these sides.
 */
export const KIND_SIDES: Readonly<Record<PipeKind, readonly number[]>> = {
  straight: [W, E],
  elbow: [N, E],
  tee: [W, N, E],
};

export function opposite(side: number): number {
  return (side + 2) % 4;
}

/** Open sides after `rot` clockwise quarter turns (side s -> s + rot). */
export function openSides(kind: PipeKind, rot: number): number[] {
  return KIND_SIDES[kind].map((s) => (s + rot) % 4);
}

export function maskOf(kind: PipeKind, rot: number): number {
  let m = 0;
  for (const s of openSides(kind, rot)) m |= 1 << s;
  return m;
}

export function opens(kind: PipeKind, rot: number, side: number): boolean {
  return (maskOf(kind, rot) & (1 << side)) !== 0;
}

/**
 * Clockwise presses that make this tile open both `a` and `b`, or -1 when
 * the kind never can (a straight cannot bend, an elbow cannot go straight).
 * Straights and tees have symmetric turns, so this is the true minimum.
 */
export function turnsToFit(kind: PipeKind, rot: number, a: number, b: number): number {
  const need = (1 << a) | (1 << b);
  for (let k = 0; k < 4; k++) {
    if ((maskOf(kind, rot + k) & need) === need) return k;
  }
  return -1;
}

export function cellIndex(r: number, c: number): number {
  return r * SIZE + c;
}

/* ------------------------------------------------------------------ */
/*  Flow                                                               */
/* ------------------------------------------------------------------ */

export interface Puzzle {
  kinds: PipeKind[];
  /** Scrambled starting rotations (every player starts from these). */
  start: number[];
  exitRow: number;
  /** Cheapest route at the start: cells in water order, with in/out sides. */
  route: number[];
  routeIn: number[];
  routeOut: number[];
  /** Fewest presses that solve the start position (5..8). */
  minPresses: number;
}

export interface Flow {
  wet: boolean[];
  solved: boolean;
}

/** Strict two-sided flood from the spout. */
export function computeFlow(kinds: readonly PipeKind[], rots: readonly number[], exitRow: number): Flow {
  const wet = new Array<boolean>(CELLS).fill(false);
  const first = cellIndex(ENTRY_ROW, 0);
  if (opens(kinds[first], rots[first], W)) {
    wet[first] = true;
    const queue = [first];
    while (queue.length > 0) {
      const cell = queue.shift() as number;
      const r = Math.floor(cell / SIZE);
      const c = cell % SIZE;
      for (const s of openSides(kinds[cell], rots[cell])) {
        const nr = r + DR[s];
        const nc = c + DC[s];
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
        const next = cellIndex(nr, nc);
        if (wet[next] || !opens(kinds[next], rots[next], opposite(s))) continue;
        wet[next] = true;
        queue.push(next);
      }
    }
  }
  const last = cellIndex(exitRow, SIZE - 1);
  return { wet, solved: wet[last] && opens(kinds[last], rots[last], E) };
}

/* ------------------------------------------------------------------ */
/*  Exact minimum-press solver                                         */
/* ------------------------------------------------------------------ */

export interface Route {
  cells: number[];
  ins: number[];
  outs: number[];
  cost: number;
}

/**
 * Fewest clockwise presses that connect spout to star, over EVERY simple
 * route (only tiles on the route need turning, each independently).
 */
export function solveMin(kinds: readonly PipeKind[], rots: readonly number[], exitRow: number): Route | null {
  const goal = cellIndex(exitRow, SIZE - 1);
  let best: Route | null = null;
  const cells: number[] = [];
  const ins: number[] = [];
  const outs: number[] = [];
  const visit = (cell: number, inSide: number, acc: number, seen: number): void => {
    const r = Math.floor(cell / SIZE);
    const c = cell % SIZE;
    for (let out = 0; out < 4; out++) {
      if (out === inSide) continue;
      if (cell === goal && out !== E) continue;
      const k = turnsToFit(kinds[cell], rots[cell], inSide, out);
      if (k < 0) continue;
      const cost = acc + k;
      if (best && cost >= best.cost) continue;
      cells.push(cell);
      ins.push(inSide);
      outs.push(out);
      if (cell === goal) {
        best = { cells: cells.slice(), ins: ins.slice(), outs: outs.slice(), cost };
      } else {
        const nr = r + DR[out];
        const nc = c + DC[out];
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
          const next = cellIndex(nr, nc);
          if (!(seen & (1 << next))) visit(next, opposite(out), cost, seen | (1 << next));
        }
      }
      cells.pop();
      ins.pop();
      outs.pop();
    }
  };
  const first = cellIndex(ENTRY_ROW, 0);
  visit(first, W, 0, 1 << first);
  return best;
}

/** Route tiles that already fit: the "how far along" stat for ties and bars. */
export function routeProgress(p: Puzzle, rots: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < p.route.length; i++) {
    const cell = p.route[i];
    if (turnsToFit(p.kinds[cell], rots[cell], p.routeIn[i], p.routeOut[i]) === 0) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/*  Generator                                                          */
/* ------------------------------------------------------------------ */

export const MIN_PRESSES = 5;
export const MAX_PRESSES = 8;

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

/** Random self-avoiding walk from the spout cell to the star cell. */
function randomPath(rng: () => number, exitRow: number): number[] | null {
  const goal = cellIndex(exitRow, SIZE - 1);
  let cell = cellIndex(ENTRY_ROW, 0);
  const path = [cell];
  let seen = 1 << cell;
  while (cell !== goal) {
    const r = Math.floor(cell / SIZE);
    const c = cell % SIZE;
    const options: number[] = [];
    for (let s = 0; s < 4; s++) {
      const nr = r + DR[s];
      const nc = c + DC[s];
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const next = cellIndex(nr, nc);
      if (seen & (1 << next)) continue;
      options.push(next);
      if (s === E) options.push(next); // drift toward the star
    }
    if (options.length === 0 || path.length > 9) return null;
    cell = pick(rng, options);
    seen |= 1 << cell;
    path.push(cell);
  }
  return path;
}

function sideToward(from: number, to: number): number {
  const d = to - from;
  if (d === -SIZE) return N;
  if (d === SIZE) return S;
  if (d === 1) return E;
  return W;
}

function randomKind(rng: () => number): PipeKind {
  const roll = rng();
  if (roll < 0.35) return "straight";
  if (roll < 0.75) return "elbow";
  return "tee";
}

/**
 * A fresh puzzle: a random route of straights/elbows (sometimes a tee) plus
 * distractor pipes, every tile scrambled. Accepted only when the exact
 * minimum is MIN_PRESSES..MAX_PRESSES and every tile on that cheapest
 * route needs at least one press (so nothing starts half-done).
 */
export function generatePuzzle(rng: () => number): Puzzle {
  let fallback: Puzzle | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const exitRow = Math.floor(rng() * SIZE) % SIZE;
    const path = randomPath(rng, exitRow);
    if (!path || path.length < 4 || path.length > 8) continue;
    const kinds: PipeKind[] = [];
    const rots: number[] = [];
    for (let i = 0; i < CELLS; i++) {
      kinds.push(randomKind(rng));
      rots.push(Math.floor(rng() * 4) % 4);
    }
    for (let i = 0; i < path.length; i++) {
      const cell = path[i];
      const a = i === 0 ? W : sideToward(cell, path[i - 1]);
      const b = i === path.length - 1 ? E : sideToward(cell, path[i + 1]);
      const bend = a !== opposite(b);
      const kind: PipeKind = rng() < 0.15 ? "tee" : bend ? "elbow" : "straight";
      const wrong = [0, 1, 2, 3].filter((r) => turnsToFit(kind, r, a, b) > 0);
      kinds[cell] = kind;
      rots[cell] = pick(rng, wrong);
    }
    const best = solveMin(kinds, rots, exitRow);
    if (!best) continue;
    const scrambled = best.cells.every((cell, i) => turnsToFit(kinds[cell], rots[cell], best.ins[i], best.outs[i]) > 0);
    const puzzle: Puzzle = {
      kinds,
      start: rots,
      exitRow,
      route: best.cells,
      routeIn: best.ins,
      routeOut: best.outs,
      minPresses: best.cost,
    };
    if (scrambled && best.cost >= MIN_PRESSES && best.cost <= MAX_PRESSES) return puzzle;
    if (best.cost >= 1 && (!fallback || Math.abs(best.cost - 6) < Math.abs(fallback.minPresses - 6))) fallback = puzzle;
  }
  // Practically unreachable (acceptance is common); still never 0 presses.
  return fallback as Puzzle;
}

/* ------------------------------------------------------------------ */
/*  Race model (shared by the game and the balance sim)                */
/* ------------------------------------------------------------------ */

export const ROUND_TIME = 26;
/** Solved board stays up this long, then the next puzzle appears. */
export const SOLVE_BEAT = 0.45;
export const CPU_READ = 1.4;
export const CPU_MISS = 0.12;
/**
 * CPU skill = its average seconds per press, drawn once per round. Most CPUs
 * are steady (PACE_STEADY range); about one in ACE_P is a whiz (PACE_ACE).
 * Each press then waits pace x U[0.85, 1.15]. Tuned in a headless sim so an
 * average phone player (1 s/press, 2 s reading, 10% mis-taps) wins about a
 * third of rounds and a sharp one (0.7 s/press) about 60%.
 */
export const TUNE = {
  aceP: 0.2,
  aceMin: 0.55,
  aceMax: 0.72,
  steadyMin: 0.88,
  steadyMax: 1.45,
};

export function drawCpuPace(rng: () => number): number {
  const u = rng();
  if (u < TUNE.aceP) return TUNE.aceMin + (TUNE.aceMax - TUNE.aceMin) * (u / TUNE.aceP);
  return TUNE.steadyMin + (TUNE.steadyMax - TUNE.steadyMin) * ((u - TUNE.aceP) / (1 - TUNE.aceP));
}

export type SeatPhase = "read" | "press" | "beat";

export interface Seat {
  /** Index into the shared puzzle list (puzzle k is identical for all). */
  puzzle: number;
  rots: number[];
  solved: number;
  /** Route tiles of the current puzzle that already fit. */
  progress: number;
  /** Sim time the current (solved, progress) pair was reached. */
  progressAt: number;
  phase: SeatPhase;
  /** Seconds left in the current phase step (read pause, next press, beat). */
  wait: number;
  /** CPU only: average seconds per press (its skill, see drawCpuPace). */
  pace: number;
  presses: number;
}

export function newSeat(first: Puzzle, pace: number): Seat {
  return {
    puzzle: 0,
    rots: first.start.slice(),
    solved: 0,
    progress: routeProgress(first, first.start),
    progressAt: 0,
    phase: "read",
    wait: CPU_READ,
    pace,
    presses: 0,
  };
}

export type PressResult = "turned" | "solved" | "ignored";

/** One clockwise press on `cell`. Logic changes at once. */
export function pressTile(seat: Seat, p: Puzzle, cell: number, time: number): PressResult {
  if (seat.phase === "beat") return "ignored";
  seat.rots[cell] = (seat.rots[cell] + 1) % 4;
  seat.presses++;
  const flow = computeFlow(p.kinds, seat.rots, p.exitRow);
  if (flow.solved) {
    seat.solved++;
    seat.progress = p.route.length;
    seat.progressAt = time;
    seat.phase = "beat";
    seat.wait = SOLVE_BEAT;
    return "solved";
  }
  const prog = routeProgress(p, seat.rots);
  if (prog !== seat.progress) {
    seat.progress = prog;
    seat.progressAt = time;
  }
  return "turned";
}

/** After the solve beat: load puzzle k+1 (same for everyone). */
export function advanceSeat(seat: Seat, next: Puzzle, time: number): void {
  seat.puzzle++;
  seat.rots = next.start.slice();
  seat.progress = routeProgress(next, next.start);
  seat.progressAt = time;
  seat.phase = "read";
  seat.wait = CPU_READ;
}

/**
 * CPU choice: the first tile, in water order along the cheapest route from
 * the CURRENT board, that still needs a press. With CPU_MISS it fumbles a
 * different tile instead. No lookahead beyond that one plan.
 */
export function cpuPickTile(p: Puzzle, rots: readonly number[], rng: () => number): number {
  const plan = solveMin(p.kinds, rots, p.exitRow);
  let want = plan ? plan.cells[0] : 0;
  if (plan) {
    for (let i = 0; i < plan.cells.length; i++) {
      const cell = plan.cells[i];
      if (turnsToFit(p.kinds[cell], rots[cell], plan.ins[i], plan.outs[i]) > 0) {
        want = cell;
        break;
      }
    }
  }
  if (rng() < CPU_MISS) {
    const other = Math.floor(rng() * (CELLS - 1)) % (CELLS - 1);
    return other >= want ? other + 1 : other;
  }
  return want;
}

export function cpuInterval(seat: Seat, rng: () => number): number {
  return seat.pace * (0.85 + 0.3 * rng());
}

export interface SeatEvent {
  kind: "press" | "advance";
  cell?: number;
  result?: PressResult;
}

/**
 * Advance one seat by a fixed step. CPU seats (`auto`) read, then press on
 * their own clock; a human seat only runs the solve beat. Returns what
 * happened so the game can animate it.
 */
export function tickSeat(
  seat: Seat,
  dt: number,
  time: number,
  auto: boolean,
  puzzleAt: (k: number) => Puzzle,
  rng: () => number,
): SeatEvent | null {
  if (seat.phase === "beat") {
    seat.wait -= dt;
    if (seat.wait <= 0) {
      advanceSeat(seat, puzzleAt(seat.puzzle + 1), time);
      return { kind: "advance" };
    }
    return null;
  }
  if (!auto) return null;
  seat.wait -= dt;
  if (seat.wait > 0) return null;
  if (seat.phase === "read") {
    seat.phase = "press";
    seat.wait = cpuInterval(seat, rng);
    return null;
  }
  const p = puzzleAt(seat.puzzle);
  const cell = cpuPickTile(p, seat.rots, rng);
  const result = pressTile(seat, p, cell, time);
  if (result !== "solved") seat.wait = cpuInterval(seat, rng);
  return { kind: "press", cell, result };
}

/**
 * Final order: most solved, then most fitted route tiles on the current
 * puzzle, then whoever got there first, then a fair draw (`luck`).
 */
export function rankSeats(seats: readonly Seat[], ids: readonly number[], luck: readonly number[]): number[] {
  const order = ids.map((_, i) => i);
  order.sort(
    (a, b) =>
      seats[b].solved - seats[a].solved ||
      seats[b].progress - seats[a].progress ||
      seats[a].progressAt - seats[b].progressAt ||
      luck[a] - luck[b],
  );
  return order.map((i) => ids[i]);
}

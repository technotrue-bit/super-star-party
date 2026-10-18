/**
 * SUPER STAR PARTY — board definitions.
 * Owned by the board builder. SpaceDef comes from src/core/game.ts (do not
 * redefine). Space x/y are GROUND-PLANE coordinates (three.js: x and z).
 * The Fizzy Fairground lays its loops out along smooth hand-placed curves
 * (anchoredLoop) and raises Starlight Rise under the inner loop (terrain).
 * Deterministic, no rng: a board is fixed design data, not a random roll.
 */
import type { SpaceDef, SpaceType, StampKind } from "../core/game";

export interface BoardDef {
  id: string;
  name: string;
  spaces: SpaceDef[];
  /** Ordered paths through `spaces`; loops[0] is the main lap order. */
  loops: number[][];
  /** Optional one-way cut that skips the main loop between two spaces. */
  shortcut?: { from: number; to: number; label: string };
  /** Branch points. `from` is on one loop; `to` is the first space of the other. */
  junctions?: Array<{ from: number; to: number; label: string }>;
  startIndex: number;
  /** Camera framing hint: center on the board, fit = distance multiplier. */
  cam: { center: [number, number]; fit: number };
  /**
   * Normalized move graph: next[i] is [stay] or [stay, branch]. Derived from
   * loops/shortcut/junctions on the carnival (see deriveNext).
   */
  next: number[][];
  /**
   * How ahead()/hopsBetween() count spaces. "index" is the carnival's
   * wrap(space + k) arithmetic (kept for hash parity: it walks from the inner
   * loop into the outer one); "graph" walks the stay edges of `next`.
   */
  walk: "index" | "graph";
  /** Grand Prize Balloon spots in rng.pick order. The order is gameplay data. */
  prizeSpots: number[];
  /** Space the Grand Prize Balloon starts on (unless prizeStartRandom). */
  prizeStart: number;
  /**
   * Start the balloon on a random prize spot (match rng at match start, never
   * the start space) instead of prizeStart.
   */
  prizeStartRandom?: boolean;
  /** Scenery theme key; boardScene builds the carnival look for "carnival". */
  theme: "carnival" | "downtown" | "cruise";
  /**
   * Open fork lanes on "graph" boards: `from` forks into `path`, whose last
   * tile steps onto `to`. Read by the fork popup label and the lane decal
   * (the carnival uses junctions/shortcut instead).
   */
  branches?: Array<{ from: number; path: number[]; to: number; label: string }>;
  /** Display names for the shared mechanics. Absent: the carnival's names. */
  skin?: BoardSkin;
  /** Ground shape (hills). Absent: flat. Presentation only; never read by rules. */
  terrain?: TerrainDef;
  /**
   * A gate on a stay edge that flips every round (match.gateOpen). Open: the
   * mover on `from` steps to `open`; closed: to `closed`. `next` holds the
   * open edge, so code that ignores the gate sees the board as it starts.
   */
  gate?: { from: number; open: number; closed: number; label: string };
}

/** Board-flavoured display text. Text only: types, ids and rules never change. */
export interface BoardSkin {
  /** The Grumpus NPC: full name and the short form used in banners. */
  npc: { name: string; short: string };
  /** Shop awning title (carnival: "GRUMPUS'S GUMBOOTH"). */
  shopTitle: string;
  /** Stamp display names by kind (carnival: Fizz / Crumb / Taffy). */
  stamps: Record<StampKind, string>;
  /** Full-set banner word (carnival: "CARNIVAL"). */
  jackpot: string;
  /** Lower-case place word in happening text (carnival: "carnival"). */
  place: string;
  /** Shop name in help text and the shop popup (carnival: "Shop" / "GUMBALL SHOP"). */
  shopName?: string;
  /**
   * Item display overrides by item key (keys, prices and rules never change).
   * Absent fields keep the carnival's ITEM_DEFS text.
   */
  items?: Partial<Record<string, ItemSkin>>;
  /** The last-place free-item giver (carnival: Fizzy Barker). */
  giver?: GiverSkin;
}

export interface ItemSkin {
  name?: string;
  desc?: string;
  icon?: string;
}

export interface GiverSkin {
  /** Full name, for help text ("Penny the Paperboy"). */
  name: string;
  /** Banner when the gift lands (carnival: "FIZZY BARKER!"). */
  banner: string;
  /** Gift toast; `{item}` is replaced by the item's display name. */
  gift: string;
  /** Toast when the bag is already full. */
  full: string;
}

// ---- Fizzy Fairground layout -------------------------------------------------
// Party-board paths wind; they are not rectangles. Each loop is a closed
// centripetal Catmull-Rom curve through hand-placed control points (world
// x/z). Some control points pin a space index (`at`): the spaces between two
// pins are spread at equal arc length along the curve between them, so a
// junction tile can sit exactly beside the lane it branches to while the rest
// of the loop flows freely. Pure math, no rng: the board is fixed design data.

export interface Ctrl {
  x: number;
  z: number;
  /** Space index pinned to this control point. */
  at?: number;
}

/** Centripetal Catmull-Rom point between p1 and p2 (t in [0, 1]). */
export function crPoint(p0: Ctrl, p1: Ctrl, p2: Ctrl, p3: Ctrl, t: number): { x: number; z: number } {
  const knot = (a: Ctrl, b: Ctrl): number => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: { x: number; z: number }, b: { x: number; z: number }, ta: number, tb: number) => {
    const w = (u - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * Place `count` spaces (local indices 0..count-1) on the closed curve through
 * `ctrl`. ctrl[0] must pin index 0; pins must increase around the loop.
 */
export function anchoredLoop(ctrl: Ctrl[], count: number): { x: number; y: number }[] {
  const n = ctrl.length;
  const STEPS = 48;
  // Dense polyline with the arc length at every control point.
  const pts: { x: number; z: number; s: number }[] = [];
  const ctrlS: number[] = [];
  let s = 0;
  let prev: { x: number; z: number } | null = null;
  for (let k = 0; k < n; k++) {
    const p0 = ctrl[(k - 1 + n) % n];
    const p1 = ctrl[k];
    const p2 = ctrl[(k + 1) % n];
    const p3 = ctrl[(k + 2) % n];
    for (let j = 0; j < STEPS; j++) {
      const q = crPoint(p0, p1, p2, p3, j / STEPS);
      if (prev) s += Math.hypot(q.x - prev.x, q.z - prev.z);
      if (j === 0) ctrlS[k] = s;
      pts.push({ ...q, s });
      prev = q;
    }
  }
  const total = s + Math.hypot(ctrl[0].x - prev!.x, ctrl[0].z - prev!.z);
  const at = (target: number): { x: number; z: number } => {
    const t = ((target % total) + total) % total;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].s <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = pts[lo];
    const b = lo + 1 < pts.length ? pts[lo + 1] : { x: ctrl[0].x, z: ctrl[0].z, s: total };
    const w = b.s > a.s ? (t - a.s) / (b.s - a.s) : 0;
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };
  const pins = ctrl.map((c, k) => ({ at: c.at, s: ctrlS[k] })).filter((p): p is { at: number; s: number } => p.at !== undefined);
  const out: { x: number; y: number }[] = new Array(count);
  for (let k = 0; k < pins.length; k++) {
    const a = pins[k];
    const b = pins[(k + 1) % pins.length];
    const ia = a.at;
    const ib = k + 1 < pins.length ? b.at : count;
    const sb = k + 1 < pins.length ? b.s : total;
    for (let i = ia; i < ib; i++) {
      const p = at(a.s + ((sb - a.s) * (i - ia)) / (ib - ia));
      out[i] = { x: round2(p.x), y: round2(p.z) };
    }
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Main midway (outer loop, 28 spaces). Clockwise from the start on the west
 * side: a wavy north row, the east bend, the south row, then Funhouse Row
 * (20-25), a detour that swings out to the south-west and folds back, so the
 * Funhouse Cut (19 -> 26) is a short hop across its mouth.
 */
const OUTER_CTRL: Ctrl[] = [
  { x: -13.8, z: -0.6, at: 0 },
  { x: -12.7, z: -5.8 },
  { x: -9.2, z: -9.2 },
  { x: -5.1, z: -9.9 },
  { x: -1.3, z: -9.7 },
  { x: 2.9, z: -10.4, at: 6 },
  { x: 6.6, z: -10.9 },
  { x: 10.6, z: -9.6 },
  { x: 13.8, z: -6.5 },
  { x: 14.7, z: -2.2 },
  { x: 13.4, z: 1.8 },
  { x: 14.2, z: 5.4 },
  { x: 11.9, z: 8.8 },
  { x: 8.1, z: 10.0 },
  { x: 5.1, z: 9.3 },
  { x: 2.0, z: 9.7, at: 18 },
  { x: -1.8, z: 9.4, at: 19 },
  { x: -4.6, z: 11.9 },
  { x: -8.6, z: 12.8 },
  { x: -12.8, z: 11.9 },
  { x: -16.1, z: 9.4 },
  { x: -16.5, z: 6.3 },
  { x: -13.6, z: 6.0 },
  { x: -9.7, z: 5.8, at: 26 },
  { x: -12.5, z: 2.2 },
];

/**
 * Starlight Rise (inner loop, 16 spaces) on the hill around the fountain. A
 * bean that leans east, so the Inner Lane (6 -> 32) and the Rejoin (38 -> 18)
 * are each one short ramp down to the midway.
 */
const INNER_CTRL: Ctrl[] = [
  { x: -7.0, z: -2.3, at: 0 },
  { x: -4.9, z: -4.7 },
  { x: -1.1, z: -5.2 },
  { x: 2.8, z: -5.1, at: 4 },
  { x: 5.9, z: -3.8 },
  { x: 7.2, z: -0.6 },
  { x: 5.9, z: 3.0 },
  { x: 1.9, z: 5.0, at: 10 },
  { x: -1.7, z: 4.9 },
  { x: -5.1, z: 3.8 },
  { x: -7.3, z: 1.1 },
];

// ---- terrain ----------------------------------------------------------------
/** A raised plateau: flat on top inside the superellipse, easing down over `slope`. */
export interface HillDef {
  x: number;
  z: number;
  hx: number;
  hz: number;
  power: number;
  height: number;
  slope: number;
}

/**
 * A flat deck with vertical sides (the cruise ship's decks): a rounded
 * rectangle centred on (x, z) at height `h`. A negative `h` is a sunken floor.
 */
export interface DeckLayer {
  kind: "deck";
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Corner radius (world units). */
  r: number;
  h: number;
}

/**
 * Stairs or a ramp between two decks: an oriented strip from (x0, z0) at
 * height h0 to (x1, z1) at h1, `w` wide, rising evenly along its length.
 */
export interface RampLayer {
  kind: "ramp";
  x0: number;
  z0: number;
  h0: number;
  x1: number;
  z1: number;
  h1: number;
  w: number;
}

export type TerrainLayer = DeckLayer | RampLayer;

/** Board ground shape. Absent: flat ground at y = 0. */
export interface TerrainDef {
  hills: HillDef[];
  /**
   * Decks and ramps in painter's order: the last layer that contains a point
   * sets its height. Hills (and flat ground) count only where no layer does.
   */
  layers?: TerrainLayer[];
}

/** Height of `layer` at (x, z), or null when the point is outside it. */
export function layerHeight(layer: TerrainLayer, x: number, z: number): number | null {
  if (layer.kind === "deck") {
    const ix = Math.max(0, Math.abs(x - layer.x) - (layer.hx - layer.r));
    const iz = Math.max(0, Math.abs(z - layer.z) - (layer.hz - layer.r));
    return ix * ix + iz * iz <= layer.r * layer.r ? layer.h : null;
  }
  const dx = layer.x1 - layer.x0;
  const dz = layer.z1 - layer.z0;
  const len2 = dx * dx + dz * dz || 1;
  const u = ((x - layer.x0) * dx + (z - layer.z0) * dz) / len2;
  if (u < 0 || u > 1) return null;
  const side = Math.abs((x - layer.x0) * dz - (z - layer.z0) * dx) / Math.sqrt(len2);
  if (side > layer.w / 2) return null;
  return layer.h0 + (layer.h1 - layer.h0) * u;
}

/** Ground height at world (x, z). Pure: no state, no rng. */
export function groundHeight(def: Pick<BoardDef, "terrain">, x: number, z: number): number {
  const layers = def.terrain?.layers;
  if (layers) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const lh = layerHeight(layers[i], x, z);
      if (lh !== null) return lh;
    }
  }
  const hills = def.terrain?.hills;
  if (!hills) return 0;
  let h = 0;
  for (const k of hills) {
    const nx = Math.abs(x - k.x) / k.hx;
    const nz = Math.abs(z - k.z) / k.hz;
    const d = Math.pow(Math.pow(nx, k.power) + Math.pow(nz, k.power), 1 / k.power);
    // Distance past the rim in world units (approximately: the rim radius
    // along this heading times how far past 1 the norm is).
    const len = Math.hypot(x - k.x, z - k.z);
    const past = d > 1 && d > 0 ? (len * (d - 1)) / d : 0;
    const u = Math.min(1, past / k.slope);
    const e = 1 - u * u * (3 - 2 * u);
    h = Math.max(h, k.height * e);
  }
  return h;
}

/** Ground height under space `i`. */
export function spaceHeight(def: BoardDef, i: number): number {
  const sp = def.spaces[i];
  return sp ? groundHeight(def, sp.x, sp.y) : 0;
}

/** Starlight Rise: hugs the inner loop, its foot clear of the midway disks. */
const CARNIVAL_TERRAIN: TerrainDef = {
  hills: [{ x: 0.0, z: -0.1, hx: 8.6, hz: 6.4, power: 3.2, height: 1.3, slope: 1.6 }],
};

// ---- Fizzy Fairground space data ---------------------------------------------
// 28 outer spaces — MP7 + our carnival touches.
// 9 blue, 6 red, 4 green (happenings), 2 shop, 2 grumpus, 3 stamp
// (one each of Fizz / Crumb / Taffy), 2 minigame balloons (5 and 10 coins).
// The Grand Prize Balloon is not a space type. It starts on space 4 and
// moves (match.starBalloonPos) after a purchase.
//
// The Funhouse Cut (stepOn) jumps from the space before 20 straight to 26, so
// indices 20–25 are not on the walked lap. Stamps and minigame balloons live
// on spaces the dice actually hops: shy at 3 (one hop before the balloon's
// starting spot, so a jackpot can fund that purchase the same move), goomba
// at 11, koopa at 27, balloons at 5 (5 coins) and 16 (10 coins).
const TYPES: SpaceType[] = [
  "blue", "blue", "green", "stamp", "blue", "minigame_balloon", "red",
  "green", "blue", "red", "shop", "stamp", "green", "red",
  "blue", "blue", "minigame_balloon", "grumpus", "blue", "red", "green",
  "shop", "blue", "red", "grumpus", "blue", "red", "stamp",
];

/** Stamp kind granted by an outer-loop index. */
const STAMP_KIND: Partial<Record<number, StampKind>> = {
  3: "shy",
  11: "goomba",
  27: "koopa",
};

/** Coin price on a minigame balloon, by outer-loop index. */
const BALLOON_COINS: Partial<Record<number, 5 | 10>> = {
  5: 5,
  16: 10,
};

const INNER_TYPES: SpaceType[] = [
  "blue", "red", "blue", "green", "blue", "red", "blue", "blue",
  "red", "blue", "green", "blue", "red", "blue", "blue", "red",
];

const NAMES: string[] = [
  "Fizzy Fountain", // 0 start, bottom-left corner
  "Gumball Alley",
  "Whimsy Whirl",
  "Fizz Stamp Stand", // fizz stamp — one hop before the star
  "Starlight Stage", // Grand Prize Balloon starts here
  "Fizzy Five Balloon", // 5-coin minigame balloon
  "Dunk Tank Drop",
  "Fortune Teller's Twist",
  "Popcorn Promenade",
  "Ring Toss Rage",
  "Gumball Emporium", // shop
  "Crumb Gallery", // crumb stamp
  "Mirror Maze Mischief",
  "Lava Pop Pit",
  "Lemonade Landing",
  "Golden Gazebo",
  "Grand Ten Balloon", // 10-coin minigame balloon
  "Grumpus Grove", // grumpus
  "Ferris Fling Way",
  "Fire-Eater's Fury",
  "Funhouse Fandango", // shortcut entrance (green happening)
  "Prize Booth Bazaar", // shop
  "Bumper Car Boulevard",
  "Swinging Sledge Slam",
  "Grumpus Gulch", // grumpus
  "Waffle Wharf",
  "Hot Pepper Plunge", // shortcut exit (red)
  "Taffy Kiosk", // taffy stamp
];

const INNER_NAMES: string[] = [
  "Inner Gate",
  "Ribbon Run",
  "Marble Mile",
  "Whisper Well",
  "Lantern Lane",
  "Pepper Path",
  "Coin Court",
  "Bunting Bend",
  "Sour Stretch",
  "Glimmer Gap",
  "Secret Stall",
  "Midway Cut",
  "Hot Hinge",
  "Rejoin Ramp",
  "Quiet Quarter",
  "Last Loop",
];

function buildSpaces(): SpaceDef[] {
  const outer = anchoredLoop(OUTER_CTRL, TYPES.length);
  const inner = anchoredLoop(INNER_CTRL, INNER_TYPES.length);
  const outerSpaces = TYPES.map((type, i) => {
    const space: SpaceDef = {
      index: i,
      type,
      name: NAMES[i] ?? `Space ${i + 1}`,
      x: outer[i].x,
      y: outer[i].y,
    };
    const stamp = STAMP_KIND[i];
    if (stamp) space.stamp = stamp;
    const balloonCoins = BALLOON_COINS[i];
    if (balloonCoins) space.balloonCoins = balloonCoins;
    return space;
  });
  const innerSpaces = INNER_TYPES.map((type, i) => ({
    index: TYPES.length + i,
    type,
    name: INNER_NAMES[i] ?? `Inner ${i + 1}`,
    x: inner[i].x,
    y: inner[i].y,
  }));
  return [...outerSpaces, ...innerSpaces];
}

/** BoardDef before the derived graph fields are filled in. */
type BoardBase = Omit<BoardDef, "next" | "prizeSpots">;

/**
 * Carnival move graph, matching the turn loop's old stepOn + junctions:
 * stay = next space on the first loop holding i (loops[0] when none), with the
 * shortcut applied; branch = the first junction leaving i.
 */
function deriveNext(def: BoardBase): number[][] {
  const sc = def.shortcut;
  const next: number[][] = [];
  for (let i = 0; i < def.spaces.length; i++) {
    const loop = def.loops.find((l) => l.includes(i)) ?? def.loops[0];
    const at = loop.indexOf(i);
    let stay = loop[(at + 1) % loop.length];
    if (sc && stay === sc.from) stay = sc.to;
    const j = (def.junctions ?? []).find((jj) => jj.from === i);
    next.push(j ? [stay, j.to] : [stay]);
  }
  return next;
}

/**
 * Carnival prize spots: the blue and red spaces on every loop, in loop order
 * (rng.pick reads the order). The balloon never parks on a happening, shop,
 * stamp stand, minigame balloon or Grumpus space. Funhouse Row counts: the
 * Funhouse Gate opens it every other round.
 */
function derivePrizeSpots(def: BoardBase): number[] {
  const spots: number[] = [];
  for (const loop of def.loops) {
    for (const index of loop) {
      const type = def.spaces[index]?.type;
      if (type === "blue" || type === "red") spots.push(index);
    }
  }
  return spots;
}

const fizzyBase: BoardBase = {
  id: "fizzy-fairground",
  name: "Fizzy Fairground",
  spaces: buildSpaces(),
  loops: [
    Array.from({ length: TYPES.length }, (_, i) => i),
    Array.from({ length: INNER_TYPES.length }, (_, i) => TYPES.length + i),
  ],
  shortcut: { from: 20, to: 26, label: "Funhouse Cut" },
  junctions: [
    { from: 6, to: 32, label: "Inner Lane" },
    { from: 38, to: 18, label: "Rejoin" },
  ],
  startIndex: 0,
  cam: { center: [0, 0], fit: 1.35 },
  walk: "index",
  // The Grand Prize Balloon starts on a random blue or red space each match
  // (prizeStartRandom); 4 is only the fallback.
  prizeStart: 4,
  prizeStartRandom: true,
  theme: "carnival",
  terrain: CARNIVAL_TERRAIN,
  // The Funhouse Gate: open, the Cut (19 -> 26) skips Funhouse Row; closed,
  // movers walk the Row (20-25) past its shop and Grumpus Gulch.
  gate: { from: 19, open: 26, closed: 20, label: "Funhouse Gate" },
};

/** Fizzy Fairground — the carnival midway. Start = space 0 (Fizzy Fountain). */
export const fizzyFairground: BoardDef = {
  ...fizzyBase,
  next: deriveNext(fizzyBase),
  prizeSpots: derivePrizeSpots(fizzyBase),
};

// ---- Graph helpers ------------------------------------------------------------

function wrapIndex(def: BoardDef, i: number): number {
  const n = def.spaces.length;
  return ((i % n) + n) % n;
}

/** The stay edge out of `space` (off-board indices go to the start, as before). */
export function stayOf(def: BoardDef, space: number): number {
  return def.next[space]?.[0] ?? def.startIndex;
}

/** The stay edge with the gate applied (match.gateOpen on boards that have one). */
export function liveStayOf(def: BoardDef, space: number, gateOpen: boolean): number {
  const g = def.gate;
  if (g && space === g.from) return gateOpen ? g.open : g.closed;
  return stayOf(def, space);
}

/** `next` with the gate applied, for graph walks (BFS hints, distance). */
export function liveNext(def: BoardDef, gateOpen: boolean): number[][] {
  const g = def.gate;
  if (!g) return def.next;
  return def.next.map((edges, i) => (i === g.from ? [gateOpen ? g.open : g.closed, ...edges.slice(1)] : edges));
}

/** The branch edge out of `space`, or undefined when it is not a fork. */
export function branchOf(def: BoardDef, space: number): number | undefined {
  return def.next[space]?.[1];
}

/** Label for the lane-choice popup at the fork on `space`. */
export function forkLabel(def: BoardDef, space: number): string {
  return (
    def.junctions?.find((j) => j.from === space)?.label ??
    def.branches?.find((b) => b.from === space)?.label ??
    ""
  );
}

/**
 * The space `k` steps ahead of `from` (k < 0 steps back). On "index" boards
 * this is wrap(from + k), exactly the carnival's old arithmetic. On "graph"
 * boards it follows stay edges (a back step takes the first stay predecessor,
 * or the fork itself from a branch's first tile).
 */
export function ahead(def: BoardDef, from: number, k: number): number {
  if (def.walk === "index") return wrapIndex(def, from + k);
  let cur = wrapIndex(def, from);
  for (let i = 0; i < k; i++) cur = stayOf(def, cur);
  for (let i = 0; i > k; i--) {
    let prev = def.next.findIndex((e) => e[0] === cur);
    if (prev < 0) prev = def.next.findIndex((e) => e.includes(cur));
    if (prev >= 0) cur = prev;
  }
  return cur;
}

/**
 * Forward distance from `from` to `to`. On "index" boards this is
 * (to - from + n) % n, the carnival's old forwardDist. On "graph" boards it is
 * the fewest hops over every edge (Infinity when unreachable).
 */
export function hopsBetween(def: BoardDef, from: number, to: number): number {
  if (def.walk === "index") {
    const n = def.spaces.length;
    return (to - from + n) % n;
  }
  if (from === to) return 0;
  const seen = new Set<number>([from]);
  let frontier = [from];
  for (let d = 1; frontier.length > 0; d++) {
    const nextFrontier: number[] = [];
    for (const s of frontier) {
      for (const c of def.next[s] ?? []) {
        if (c === to) return d;
        if (!seen.has(c)) {
          seen.add(c);
          nextFrontier.push(c);
        }
      }
    }
    frontier = nextFrontier;
  }
  return Infinity;
}

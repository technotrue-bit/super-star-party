/**
 * SUPER STAR PARTY — board definitions.
 * Owned by the board builder. SpaceDef comes from src/core/game.ts (do not
 * redefine). Space x/y are GROUND-PLANE coordinates (three.js: x and z).
 * The Fizzy Fairground loop is a rounded-rectangle: 28 spaces laid out by
 * equal arc-length along the perimeter (deterministic, no rng — a board is
 * fixed design data, not a random roll).
 */
import type { SpaceDef, SpaceType, StampKind } from "../core/game";
import { settings } from "../config/settings";

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
  /** Space the Grand Prize Balloon starts on. */
  prizeStart: number;
  /** Scenery theme key; boardScene builds the carnival look for "carnival". */
  theme: "carnival" | "downtown";
  /**
   * Open fork lanes on "graph" boards: `from` forks into `path`, whose last
   * tile steps onto `to`. Read by the fork popup label and the lane decal
   * (the carnival uses junctions/shortcut instead).
   */
  branches?: Array<{ from: number; path: number[]; to: number; label: string }>;
  /** Display names for the shared mechanics. Absent: the carnival's names. */
  skin?: BoardSkin;
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
}

// ---- Fizzy Fairground layout -------------------------------------------------
// Rounded rectangle in TILE units (multiplied by settings.tileSpacing below):
//   half width a, half height b, corner radius r.
// The side segments run BETWEEN the corner tangent points, so the perimeter
// is 4(a-r) + 4(b-r) + 2*pi*r. With a=4.4, b=3.2, r=1.4 that is exactly
// 28.0 tiles -> 28 spaces at exactly 1 tile = settings.tileSpacing apart.
const LOOP_A = 4.4;
const LOOP_B = 3.2;
const LOOP_R = 1.4;

interface LoopSeg {
  len: number; // tile units
  at: (t: number) => { x: number; y: number }; // t in tile units along the seg
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Sample `count` points at equal arc length along a clockwise rounded
 * rectangle starting at the bottom-left corner (classic party-game start
 * spot). Returns ground-plane {x, z} in world units.
 */
function roundedRectLoop(
  count: number,
  a: number,
  b: number,
  r: number,
  spacing: number
): { x: number; y: number }[] {
  const arcLen = (Math.PI / 2) * r;
  const segs: LoopSeg[] = [
    // bottom-left corner arc: center (-(a-r), -(b-r)), angle pi -> 3pi/2
    { len: arcLen, at: (t) => ({ x: -(a - r) + r * Math.cos(Math.PI + t / r), y: -(b - r) + r * Math.sin(Math.PI + t / r) }) },
    // bottom side, left -> right (between tangent points)
    { len: 2 * (a - r), at: (t) => ({ x: -(a - r) + t, y: -b }) },
    // bottom-right corner arc: 3pi/2 -> 2pi
    { len: arcLen, at: (t) => ({ x: a - r + r * Math.cos((3 * Math.PI) / 2 + t / r), y: -(b - r) + r * Math.sin((3 * Math.PI) / 2 + t / r) }) },
    // right side, bottom -> top
    { len: 2 * (b - r), at: (t) => ({ x: a, y: -(b - r) + t }) },
    // top-right corner arc: 0 -> pi/2
    { len: arcLen, at: (t) => ({ x: a - r + r * Math.cos(t / r), y: b - r + r * Math.sin(t / r) }) },
    // top side, right -> left
    { len: 2 * (a - r), at: (t) => ({ x: a - r - t, y: b }) },
    // top-left corner arc: pi/2 -> pi
    { len: arcLen, at: (t) => ({ x: -(a - r) + r * Math.cos(Math.PI / 2 + t / r), y: b - r + r * Math.sin(Math.PI / 2 + t / r) }) },
    // left side, top -> bottom
    { len: 2 * (b - r), at: (t) => ({ x: -a, y: b - r - t }) },
  ];
  const total = segs.reduce((s, g) => s + g.len, 0);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    let c = (i * total) / count;
    for (const g of segs) {
      if (c <= g.len) {
        const p = g.at(c);
        out.push({ x: round2(p.x * spacing), y: round2(p.y * spacing) });
        break;
      }
      c -= g.len;
    }
  }
  return out;
}

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
  const outer = roundedRectLoop(TYPES.length, LOOP_A, LOOP_B, LOOP_R, settings.tileSpacing);
  const inner = roundedRectLoop(INNER_TYPES.length, 2.4, 1.6, 0.7, settings.tileSpacing);
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
 * Carnival prize spots: every loop space in loop order, minus the tiles the
 * shortcut skips on the main loop ([shortcut.from, shortcut.to)).
 */
function derivePrizeSpots(def: BoardBase): number[] {
  const sc = def.shortcut;
  const main = def.loops[0];
  const spots: number[] = [];
  for (const loop of def.loops) {
    for (const index of loop) {
      if (loop === main && sc && index >= sc.from && index < sc.to) continue;
      spots.push(index);
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
  // Grand Prize Balloon starts one hop after the Fizz Stamp Stand, so a
  // jackpot collected on the way in can fund a purchase the same move.
  prizeStart: 4,
  theme: "carnival",
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

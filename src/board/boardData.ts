/**
 * SUPER STAR PARTY — board definitions.
 * Owned by the board builder. SpaceDef comes from src/core/game.ts (do not
 * redefine). Space x/y are GROUND-PLANE coordinates (three.js: x and z).
 * The Fizzy Fairground loop is a rounded-rectangle: 28 spaces laid out by
 * equal arc-length along the perimeter (deterministic, no rng — a board is
 * fixed design data, not a random roll).
 */
import type { SpaceDef, SpaceType } from "../core/game";
import { settings } from "../config/settings";

export interface BoardDef {
  id: string;
  name: string;
  spaces: SpaceDef[];
  /** Ordered paths through `spaces`; loops[0] is the main lap order. */
  loops: number[][];
  /** Optional one-way cut that skips the main loop between two spaces. */
  shortcut?: { from: number; to: number; label: string };
  startIndex: number;
  /** Camera framing hint: center on the board, fit = distance multiplier. */
  cam: { center: [number, number]; fit: number };
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
// 28 spaces: 12 blue, 6 red, 4 green, 2 star, 2 shop, 2 grumpus.
// Specials (star/shop/grumpus) are interleaved so no two are adjacent.
const TYPES: SpaceType[] = [
  "blue", "blue", "green", "blue", "star", "blue", "red",
  "green", "blue", "red", "shop", "blue", "green", "red",
  "blue", "star", "blue", "grumpus", "blue", "red", "green",
  "shop", "blue", "red", "grumpus", "blue", "red", "blue",
];

const NAMES: string[] = [
  "Fizzy Fountain", // 0 start, bottom-left corner
  "Gumball Alley",
  "Whimsy Whirl",
  "Caramel Cove",
  "Starlight Stage", // star
  "Cotton Cloud Corner",
  "Dunk Tank Drop",
  "Fortune Teller's Twist",
  "Popcorn Promenade",
  "Ring Toss Rage",
  "Gumball Emporium", // shop
  "Taffy Twist Trail",
  "Mirror Maze Mischief",
  "Lava Pop Pit",
  "Lemonade Landing",
  "Golden Gazebo", // star
  "Candy Cart Crawl",
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
  "Ticket Ticker Turn",
];

function buildSpaces(): SpaceDef[] {
  const pts = roundedRectLoop(TYPES.length, LOOP_A, LOOP_B, LOOP_R, settings.tileSpacing);
  return TYPES.map((type, i) => ({
    index: i,
    type,
    name: NAMES[i] ?? `Space ${i + 1}`,
    x: pts[i].x,
    y: pts[i].y,
  }));
}

/** Fizzy Fairground — the carnival midway. Start = space 0 (Fizzy Fountain). */
export const fizzyFairground: BoardDef = {
  id: "fizzy-fairground",
  name: "Fizzy Fairground",
  spaces: buildSpaces(),
  loops: [Array.from({ length: TYPES.length }, (_, i) => i)],
  shortcut: { from: 20, to: 26, label: "Funhouse Cut" },
  startIndex: 0,
  cam: { center: [0, 0], fit: 1.35 },
};

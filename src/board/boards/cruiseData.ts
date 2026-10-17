/**
 * SUPER STAR PARTY — The Cruise Ship (the S.S. Super Star), 132 spaces.
 *
 * World x/z ground plane, bow to the north (-z), starboard to the east (+x).
 * Decks (heights come from terrain layers, presentation only):
 * - Promenade Deck (y 0): the main loop P (0-63) round the hull rail,
 *   counter-clockwise from above: north up the starboard rail from the
 *   Boarding Deck (start), round the bow, south down the port rail, round
 *   the stern. The lifeboat sponsons and the forecastle are deck level too.
 * - Lido Deck (y 1.6): the Lido ring L (64-85) round the pool, walked the
 *   OTHER way (clockwise), so climbing up lets you double back.
 * Branches (open forks; each ends back on a loop):
 * - four stairways between the decks, one at each Lido corner: two up
 *   (Lido Stairs) and two down (Promenade Stairs), 86-89;
 * - the Pool Bridge across the pool, a Lido U-turn (90-93);
 * - the Captain's Walk across the forecastle, a bow shortcut (94-104);
 * - the Grand Ballroom, a stern shortcut through the dance hall (105-115);
 * - the two Lifeboat Decks out on the sponsons (116-123, 124-131).
 * Same space types and rules as the other boards; only names differ.
 * Fixed design data, no rng.
 */
import type { SpaceDef, SpaceType, StampKind } from "../../core/game";
import { anchoredLoop, crPoint, type BoardDef, type Ctrl, type TerrainLayer } from "../boardData";

interface Tile {
  type: SpaceType;
  name: string;
  stamp?: StampKind;
  balloonCoins?: 5 | 10;
}

const t = (type: SpaceType, name: string, extra?: Partial<Tile>): Tile => ({ type, name, ...extra });

// ---- deck geometry (shared with the scene builder) ----------------------------------
/** Deck heights (world units). */
export const CRUISE_H = { promenade: 0, lido: 1.6, bridge: 2.6, funnel: 2.6, ballroom: 0.1 } as const;

/** Rounded rectangle: centre, half sizes, corner radius. */
export interface RoundRect {
  x: number;
  z: number;
  hx: number;
  hz: number;
  r: number;
}

/** A stairway between the Promenade and the Lido deck, running along x. */
export interface Stairway {
  /** Bottom (Promenade side) and top (Lido side) of the flight, world x. */
  x0: number;
  x1: number;
  z: number;
  w: number;
}

export const CRUISE_SHIP = {
  /** Hull deck edge: straight sides at +-halfX from bowStart to sternStart. */
  hull: { halfX: 17.5, bowStart: -16, bowTip: -40.5, sternStart: 22, sternTip: 34.5 },
  /** Lifeboat sponsons: deck-level platforms outboard of each rail (z ranges). */
  sponson: { x0: 17.2, x1: 21.4, starboard: [-10.4, 4.6], port: [-5.6, 9.6] },
  lido: { x: 0, z: -0.5, hx: 9.5, hz: 11.5, r: 3 } as RoundRect,
  bridge: { x: 0, z: -14.6, hx: 7.2, hz: 2.9, r: 2 } as RoundRect,
  funnelDeck: { x: 0, z: 15.3, hx: 6, hz: 3.4, r: 2 } as RoundRect,
  ballroom: { x: 0, z: 23.6, hx: 8.6, hz: 3.9, r: 2.4 } as RoundRect,
  pool: { x: 0, z: -1.5, hx: 2.9, hz: 4.7, r: 1.2 } as RoundRect,
  /** Footbridge over the pool (the Pool Bridge lane), along x at this z. */
  poolBridge: { z: -0.5, w: 2.3 },
  /** Two flights per Lido corner: one up and one down (see LANES). */
  stairs: [
    { x0: 10.9, x1: 8.3, z: -5.7, w: 2.4 }, // 0 NE up
    { x0: 10.9, x1: 8.3, z: -3.1, w: 2.4 }, // 1 NE down
    { x0: 10.9, x1: 8.3, z: 4.7, w: 2.4 }, // 2 SE down
    { x0: 10.9, x1: 8.3, z: 7.3, w: 2.4 }, // 3 SE up
    { x0: -10.9, x1: -8.3, z: 4.7, w: 2.4 }, // 4 SW up
    { x0: -10.9, x1: -8.3, z: 2.1, w: 2.4 }, // 5 SW down
    { x0: -10.9, x1: -8.3, z: -5.7, w: 2.4 }, // 6 NW down
    { x0: -10.9, x1: -8.3, z: -8.3, w: 2.4 }, // 7 NW up
  ] as Stairway[],
} as const;

// ---- Promenade loop P (64) ------------------------------------------------------------
const PX = 14.5;
const P_CTRL: Ctrl[] = [
  { x: PX, z: 6.2, at: 0 }, // Boarding Deck (start); Promenade Stairs land
  { x: PX, z: 3.6, at: 1 }, // fork: Starboard Lifeboat Deck
  { x: PX, z: -1.6, at: 3 }, // Promenade Stairs land
  { x: PX, z: -4.2, at: 4 }, // fork: Lido Stairs (up)
  { x: PX, z: -9.4, at: 6 }, // Starboard Lifeboat Deck rejoins
  { x: PX, z: -17.2, at: 9 }, // fork: Captain's Walk
  { x: 13.4, z: -23.2 },
  { x: 10.8, z: -28.6 },
  { x: 6.3, z: -32.8 },
  { x: 0, z: -34.6 },
  { x: -6.3, z: -32.8 },
  { x: -10.8, z: -28.6 },
  { x: -13.4, z: -23.2 },
  { x: -PX, z: -17.2, at: 28 }, // Captain's Walk rejoins
  { x: -PX, z: -9.8, at: 31 }, // fork: Lido Stairs (up)
  { x: -PX, z: -7.2, at: 32 }, // Promenade Stairs land
  { x: -PX, z: -4.6, at: 33 }, // fork: Port Lifeboat Deck
  { x: -PX, z: 0.6, at: 35 }, // Promenade Stairs land
  { x: -PX, z: 3.2, at: 36 }, // fork: Lido Stairs (up)
  { x: -PX, z: 8.4, at: 38 }, // Port Lifeboat Deck rejoins
  { x: -PX, z: 19.2, at: 42 }, // fork: Grand Ballroom
  { x: -13.6, z: 24.6 },
  { x: -9.4, z: 29.2 },
  { x: -3.4, z: 31.1 },
  { x: 3.4, z: 31.1 },
  { x: 9.4, z: 29.2 },
  { x: 13.6, z: 24.6 },
  { x: PX, z: 19.2, at: 59 }, // Grand Ballroom rejoins
  { x: PX, z: 8.8, at: 63 }, // fork: Lido Stairs (up)
];

const P_TILES: Tile[] = [
  // starboard rail, heading for the bow
  t("blue", "Boarding Deck"), // 0 start (Promenade Stairs land here too)
  t("blue", "Lifeboat Launch"), // 1 fork: Lifeboat Deck
  t("green", "Shuffleboard Court"),
  t("blue", "Purser's Desk"), // 3 Promenade Stairs land
  t("blue", "Starboard Stairs"), // 4 fork: Lido Stairs
  t("shop", "Duty-Free Boutique"),
  t("blue", "Deck Chair Row"), // 6 Lifeboat Deck rejoins
  t("red", "Slippery Deck"),
  t("stamp", "Coconut Cart", { stamp: "shy" }),
  t("blue", "Forecastle Gate"), // 9 fork: Captain's Walk
  // round the bow
  t("red", "Mooring Lines"),
  t("blue", "Anchor Chain"),
  t("green", "Foghorn"),
  t("minigame_balloon", "Bow Balloon", { balloonCoins: 5 }),
  t("blue", "Starboard Bow"),
  t("red", "Spray Zone"),
  t("blue", "Figurehead"),
  t("grumpus", "Gull's Perch"),
  t("blue", "Bow Lookout"), // 18 the bow tip
  t("red", "Sea Spray"),
  t("green", "Dolphin Watch"),
  t("blue", "Port Bow"),
  t("stamp", "Shrimp Shack", { stamp: "goomba" }),
  t("red", "Rogue Wave"),
  t("blue", "Ship's Bell"),
  t("green", "Message in a Bottle"),
  t("blue", "Capstan"),
  t("red", "Rope Locker"),
  t("blue", "Port Gate"), // 28 Captain's Walk rejoins
  // port rail, heading for the stern
  t("red", "Wet Paint"),
  t("blue", "Port Promenade"),
  t("blue", "Port Stairs"), // 31 fork: Lido Stairs
  t("blue", "Port Landing"), // 32 Promenade Stairs land
  t("blue", "Davit Row"), // 33 fork: Lifeboat Deck
  t("green", "Porthole Peek"),
  t("blue", "Lounge Doors"), // 35 Promenade Stairs land
  t("blue", "Spa Stairs"), // 36 fork: Lido Stairs
  t("red", "Splash Zone"),
  t("blue", "Quoits Court"), // 38 Lifeboat Deck rejoins
  t("shop", "Seashell Shop"),
  t("red", "Rolling Deck"),
  t("blue", "Aft Promenade"),
  t("blue", "Ballroom Doors"), // 42 fork: Grand Ballroom
  // round the stern
  t("red", "Engine Rumble"),
  t("blue", "Quarterdeck"),
  t("green", "Ship's Cat"),
  t("minigame_balloon", "Stern Balloon", { balloonCoins: 5 }),
  t("blue", "Port Quarter"),
  t("red", "Propeller Wash"),
  t("grumpus", "Gull's Roost"),
  t("blue", "Stern Rail"), // 50 the stern
  t("blue", "Flagpole"),
  t("red", "Wake Watch"),
  t("stamp", "Sundae Stand", { stamp: "koopa" }),
  t("blue", "Starboard Quarter"),
  t("green", "Fishing Line"),
  t("red", "Choppy Water"),
  t("blue", "Sun Lounger"),
  t("red", "Seasick Spot"),
  t("blue", "Ballroom Exit"), // 59 Grand Ballroom rejoins
  // starboard rail, back to the start
  t("red", "Life Ring"),
  t("blue", "Hammock Nook"),
  t("green", "Photo Booth"),
  t("blue", "Aft Stairs"), // 63 fork: Lido Stairs
];

// ---- Lido ring L (22), clockwise from above ------------------------------------------
const LX = 7;
const L_CTRL: Ctrl[] = [
  { x: LX, z: -5.7, at: 0 }, // Lido Stairs (starboard fore) land
  { x: LX, z: -3.1, at: 1 }, // fork: Promenade Stairs (down)
  { x: LX, z: -0.5, at: 2 }, // fork: Pool Bridge
  { x: LX, z: 4.7, at: 4 }, // fork: Promenade Stairs (down)
  { x: 6.3, z: 7.3, at: 5 }, // Lido Stairs (starboard aft) land
  { x: 3.6, z: 8.5 },
  { x: -3.6, z: 8.5 },
  { x: -6.2, z: 7.4 },
  { x: -LX, z: 4.7, at: 11 }, // Lido Stairs (port aft) land
  { x: -LX, z: 2.1, at: 12 }, // fork: Promenade Stairs (down)
  { x: -LX, z: -0.5, at: 13 }, // Pool Bridge lands
  { x: -LX, z: -5.7, at: 15 }, // fork: Promenade Stairs (down)
  { x: -6.3, z: -8.3, at: 16 }, // Lido Stairs (port fore) land
  { x: -3.6, z: -9.5 },
  { x: 3.6, z: -9.5 },
  { x: 6.2, z: -8.4 },
];

const L_TILES: Tile[] = [
  t("blue", "Lido Landing"), // 64 Lido Stairs land
  t("blue", "Sunbed Row"), // 65 fork: Promenade Stairs
  t("blue", "Poolside"), // 66 fork: Pool Bridge
  t("green", "Cannonball Corner"),
  t("blue", "Towel Hut"), // 68 fork: Promenade Stairs
  t("blue", "Aft Landing"), // 69 Lido Stairs land
  t("red", "Slip 'n' Slide"),
  t("shop", "Tiki Hut"),
  t("blue", "Lido Buffet"),
  t("minigame_balloon", "Buffet Balloon", { balloonCoins: 5 }),
  t("red", "Spilled Smoothie"),
  t("blue", "Lido West"), // 75 Lido Stairs land
  t("blue", "Deck Shower"), // 76 fork: Promenade Stairs
  t("blue", "Pool Steps"), // 77 Pool Bridge lands
  t("red", "Belly Flop"),
  t("blue", "Sunscreen Station"), // 79 fork: Promenade Stairs
  t("blue", "Fore Landing"), // 80 Lido Stairs land
  t("grumpus", "Gull Raid"),
  t("blue", "Waterslide Tower"),
  t("stamp", "Coconut Cabana", { stamp: "shy" }),
  t("red", "Splash Down"),
  t("green", "Lifeguard Chair"),
];

// ---- branch lanes ----------------------------------------------------------------------
interface Lane {
  label: string;
  /** Fork and rejoin: [loop, local index]. */
  from: ["P" | "L", number];
  to: ["P" | "L", number];
  /** Tile centres (world x, z), in walking order. */
  at: Array<[number, number]>;
  tiles: Tile[];
}

/**
 * `count` points at equal arc length strictly between the first and last
 * control points of an open centripetal Catmull-Rom curve.
 */
function between(ctrl: Array<[number, number]>, count: number): Array<[number, number]> {
  const pts = ctrl.map(([x, z]) => ({ x, z }));
  const n = pts.length;
  const dense: { x: number; z: number; s: number }[] = [];
  let s = 0;
  for (let k = 0; k < n - 1; k++) {
    const p0 = pts[Math.max(0, k - 1)];
    const p3 = pts[Math.min(n - 1, k + 2)];
    for (let j = 0; j < 64; j++) {
      const q = crPoint(p0, pts[k], pts[k + 1], p3, j / 64);
      if (dense.length) s += Math.hypot(q.x - dense[dense.length - 1].x, q.z - dense[dense.length - 1].z);
      dense.push({ ...q, s });
    }
  }
  const last = pts[n - 1];
  s += Math.hypot(last.x - dense[dense.length - 1].x, last.z - dense[dense.length - 1].z);
  dense.push({ ...last, s });
  const out: Array<[number, number]> = [];
  for (let i = 1; i <= count; i++) {
    const target = (s * i) / (count + 1);
    let k = 1;
    while (k < dense.length - 1 && dense[k].s < target) k++;
    const a = dense[k - 1];
    const b = dense[k];
    const w = b.s > a.s ? (target - a.s) / (b.s - a.s) : 0;
    out.push([Math.round((a.x + (b.x - a.x) * w) * 100) / 100, Math.round((a.z + (b.z - a.z) * w) * 100) / 100]);
  }
  return out;
}

const STAIR = CRUISE_SHIP.stairs;

const stairLane = (label: string, from: Lane["from"], to: Lane["to"], k: number, tile: Tile): Lane => ({
  label,
  from,
  to,
  at: [[STAIR[k].x0 > 0 ? 12.0 : -12.0, STAIR[k].z]],
  tiles: [tile],
});

const LANES: Lane[] = [
  stairLane("Lido Stairs", ["P", 4], ["L", 0], 0, t("blue", "Grand Staircase")),
  stairLane("Promenade Stairs", ["L", 1], ["P", 3], 1, t("red", "Brass Banister")),
  stairLane("Promenade Stairs", ["L", 4], ["P", 0], 2, t("green", "Spiral Stairs")),
  stairLane("Lido Stairs", ["P", 63], ["L", 5], 3, t("blue", "Aft Staircase")),
  stairLane("Lido Stairs", ["P", 36], ["L", 11], 4, t("red", "Banister Slide")),
  stairLane("Promenade Stairs", ["L", 12], ["P", 35], 5, t("blue", "Port Steps")),
  stairLane("Promenade Stairs", ["L", 15], ["P", 32], 6, t("blue", "Crew Stairs")),
  stairLane("Lido Stairs", ["P", 31], ["L", 16], 7, t("green", "Fore Staircase")),
  {
    label: "Pool Bridge",
    from: ["L", 2],
    to: ["L", 13],
    at: [
      [3.9, CRUISE_SHIP.poolBridge.z],
      [1.3, CRUISE_SHIP.poolBridge.z],
      [-1.3, CRUISE_SHIP.poolBridge.z],
      [-3.9, CRUISE_SHIP.poolBridge.z],
    ],
    tiles: [t("blue", "Footbridge"), t("red", "Cannonball Drop"), t("green", "Mid-Pool"), t("blue", "Diving Board")],
  },
  {
    label: "Captain's Walk",
    from: ["P", 9],
    to: ["P", 28],
    at: between([[PX, -17.2], [11.9, -17.5], [8.2, -20.3], [3.6, -21.6], [-3.6, -21.6], [-8.2, -20.3], [-11.9, -17.5], [-PX, -17.2]], 11),
    tiles: [
      t("blue", "Bridge Wing"),
      t("red", "Coiled Rope"),
      t("blue", "Ship's Wheel"),
      t("minigame_balloon", "Captain's Balloon", { balloonCoins: 10 }),
      t("green", "Radar Mast"),
      t("blue", "Captain's Deck"),
      t("shop", "Captain's Store"),
      t("red", "Fog Bank"),
      t("blue", "Compass Rose"),
      t("grumpus", "Crow's Nest"),
      t("blue", "Port Wing"),
    ],
  },
  {
    label: "Grand Ballroom",
    from: ["P", 42],
    to: ["P", 59],
    at: between([[-PX, 19.2], [-11.9, 19.5], [-8.4, 22.4], [-3.8, 23.7], [3.8, 23.7], [8.4, 22.4], [11.9, 19.5], [PX, 19.2]], 11),
    tiles: [
      t("blue", "Ballroom Foyer"),
      t("red", "Cloakroom"),
      t("green", "Jukebox"),
      t("blue", "Dance Floor"),
      t("stamp", "Sundae Bar", { stamp: "koopa" }),
      t("minigame_balloon", "Disco Balloon", { balloonCoins: 10 }),
      t("blue", "Disco Ball"),
      t("red", "Conga Line"),
      t("green", "Spotlight"),
      t("blue", "Grand Piano"),
      t("red", "Stage Door"),
    ],
  },
  {
    label: "Lifeboat Deck",
    from: ["P", 1],
    to: ["P", 6],
    at: between([[PX, 3.6], [18.6, 1.6], [19.4, -2.9], [18.6, -7.4], [PX, -9.4]], 6),
    tiles: [
      t("blue", "Lifeboat Deck"),
      t("red", "Davit Crank"),
      t("blue", "Lifeboat One"),
      t("stamp", "Shrimp Bucket", { stamp: "goomba" }),
      t("green", "Rescue Drill"),
      t("blue", "Rope Ladder"),
    ],
  },
  {
    label: "Lifeboat Deck",
    from: ["P", 33],
    to: ["P", 38],
    at: between([[-PX, -4.6], [-18.6, -2.6], [-19.4, 1.9], [-18.6, 6.4], [-PX, 8.4]], 6),
    tiles: [
      t("blue", "Port Lifeboats"),
      t("red", "Rusty Davit"),
      t("grumpus", "Gull Ambush"),
      t("blue", "Lifeboat Two"),
      t("green", "Signal Flags"),
      t("blue", "Lifeboat Ladder"),
    ],
  },
];

const P_N = P_TILES.length; // 64
const L_N = L_TILES.length; // 22
const globalOf = (ref: ["P" | "L", number]): number => (ref[0] === "P" ? ref[1] : P_N + ref[1]);

/** Terrain: the ballroom floor, the Lido Deck, and a ramp for each stairway flight. */
const TERRAIN_LAYERS: TerrainLayer[] = [
  { kind: "deck", ...CRUISE_SHIP.ballroom, h: CRUISE_H.ballroom },
  { kind: "deck", ...CRUISE_SHIP.lido, h: CRUISE_H.lido },
  ...STAIR.map((s): TerrainLayer => ({
    kind: "ramp",
    x0: s.x0,
    z0: s.z,
    h0: CRUISE_H.promenade,
    x1: s.x1,
    z1: s.z,
    h1: CRUISE_H.lido,
    w: s.w,
  })),
];

function buildSpaces(): { spaces: SpaceDef[]; next: number[][]; branches: NonNullable<BoardDef["branches"]> } {
  const pPts = anchoredLoop(P_CTRL, P_N);
  const lPts = anchoredLoop(L_CTRL, L_N);
  const spaces: SpaceDef[] = [];
  const next: number[][] = [];
  const push = (tile: Tile, x: number, y: number): number => {
    const index = spaces.length;
    const sp: SpaceDef = { index, type: tile.type, name: tile.name, x, y };
    if (tile.stamp) sp.stamp = tile.stamp;
    if (tile.balloonCoins) sp.balloonCoins = tile.balloonCoins;
    spaces.push(sp);
    next.push([]);
    return index;
  };
  P_TILES.forEach((tile, i) => push(tile, pPts[i].x, pPts[i].y));
  L_TILES.forEach((tile, i) => push(tile, lPts[i].x, lPts[i].y));
  for (let i = 0; i < P_N; i++) next[i].push((i + 1) % P_N);
  for (let i = 0; i < L_N; i++) next[P_N + i].push(P_N + ((i + 1) % L_N));
  const branches: NonNullable<BoardDef["branches"]> = [];
  for (const lane of LANES) {
    if (lane.at.length !== lane.tiles.length) throw new Error(`[SSP] cruise lane ${lane.label}: ${lane.at.length} spots, ${lane.tiles.length} tiles`);
    const path = lane.tiles.map((tile, k) => push(tile, lane.at[k][0], lane.at[k][1]));
    path.forEach((p, k) => next[p].push(path[k + 1] ?? globalOf(lane.to)));
    const from = globalOf(lane.from);
    if (next[from].length !== 1) throw new Error(`[SSP] cruise fork ${from} forks twice`);
    next[from].push(path[0]);
    branches.push({ from, path, to: globalOf(lane.to), label: lane.label });
  }
  return { spaces, next, branches };
}

const built = buildSpaces();

/** Index helpers for the scene builder and the guide. */
export const CRUISE_INDEX = {
  promenade: Array.from({ length: P_N }, (_, i) => i),
  lido: Array.from({ length: L_N }, (_, i) => P_N + i),
  /** Space index by name (names are unique on this board). */
  byName(name: string): number {
    return built.spaces.findIndex((s) => s.name === name);
  },
};

const PRIZE_NAMES = [
  "Port Promenade",
  "Lido Buffet",
  "Bow Lookout",
  "Aft Promenade",
  "Dance Floor",
  "Lifeboat One",
  "Captain's Deck",
  "Waterslide Tower",
  "Hammock Nook",
  "Lifeboat Two",
  "Belly Flop",
  "Slippery Deck",
];

/** The Cruise Ship — the S.S. Super Star. Start = space 0 (Boarding Deck). */
export const cruiseShip: BoardDef = {
  id: "cruise-ship",
  name: "The Cruise Ship",
  spaces: built.spaces,
  // Two closed loops (lane decal + guide); the stay edges walk each one.
  loops: [CRUISE_INDEX.promenade, CRUISE_INDEX.lido],
  branches: built.branches,
  startIndex: 0,
  cam: { center: [0, 0], fit: 1.04 },
  next: built.next,
  walk: "graph",
  // rng.pick reads this order (blue spaces spread over every deck).
  prizeSpots: PRIZE_NAMES.map((name) => CRUISE_INDEX.byName(name)),
  prizeStart: CRUISE_INDEX.byName("Slippery Deck"),
  theme: "cruise",
  terrain: { hills: [], layers: TERRAIN_LAYERS },
  skin: {
    npc: { name: "Gus the Grumpy Gull", short: "Gus" },
    shopTitle: "GUS'S GIFT SHOP",
    stamps: { shy: "Coconut", goomba: "Shrimp", koopa: "Sundae" },
    jackpot: "CRUISE",
    place: "ship",
  },
};

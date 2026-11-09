/**
 * SUPER STAR PARTY — Downtown (city board), slice 1 graph.
 * 46 spaces: the Ring Road (0-31) plus two forks inside it.
 * - Ring Road: Central Station (0) in the south-west, east along Main St
 *   (0-8), north up Harbor Ave (8-16), west along Canal Row (16-24, the
 *   Grand Bridge deck on 18-19), south down City Hall Ave (24-31).
 * - F1 Market Street (32-39): forks at 5, rejoins at 14 (9 hops, same as the ring).
 * - F2 Riverside Walk (40-45): forks at 20, rejoins at 27 (7 hops, same as the ring).
 * Same space types and rules as the carnival; only the display names differ.
 * Fixed design data, no rng. Tile units have north = +ty; downtownWorld()
 * negates it because the party camera sits on the +z side (data +y is the
 * bottom of the screen, as on the carnival), so the board reads like the plan
 * map: Central Station bottom-left, Main St along the bottom, Canal Row and
 * the Grand Bridge on the top row, the canal entering from the top edge.
 */
import type { SpaceDef, SpaceType, StampKind } from "../../core/game";
import { settings } from "../../config/settings";
import type { BoardDef, BoardSkin } from "../boardData";

interface Tile {
  type: SpaceType;
  name: string;
  /** Ground position in TILE units, south-west corner of the ring = (0, 0). */
  at: [number, number];
  stamp?: StampKind;
  balloonCoins?: 5 | 10;
}

/** Ring Road position for ring index i (an 8 x 8 tile square). */
function ringAt(i: number): [number, number] {
  if (i <= 8) return [i, 0];
  if (i <= 16) return [8, i - 8];
  if (i <= 24) return [24 - i, 8];
  return [0, 32 - i];
}

const RING: Array<Omit<Tile, "at">> = [
  { type: "blue", name: "Central Station" }, // 0 start
  { type: "blue", name: "Ticket Hall" },
  { type: "stamp", name: "Soda Fountain", stamp: "shy" }, // one hop before the balloon's start
  { type: "blue", name: "Bakery Corner" }, // Grand Prize Balloon starts here
  { type: "red", name: "Pothole Plaza" },
  { type: "blue", name: "Market Gate" }, // fork: Market Street
  { type: "blue", name: "Bus Stop" },
  { type: "green", name: "Hot Dog Cart" },
  { type: "blue", name: "Clock Tower" }, // south-east corner
  { type: "blue", name: "Harbor Corner" },
  { type: "minigame_balloon", name: "Pier Balloon", balloonCoins: 5 },
  { type: "blue", name: "Fish Market" },
  { type: "blue", name: "Harbor Avenue" },
  { type: "red", name: "Lighthouse Lane" },
  { type: "blue", name: "Ferry Landing" }, // Market Street rejoins
  { type: "stamp", name: "Bagel Bakery", stamp: "goomba" },
  { type: "green", name: "Harbor Point" }, // north-east corner
  { type: "red", name: "Canal Steps" },
  { type: "blue", name: "Bridge East" }, // Grand Bridge deck
  { type: "blue", name: "Grand Bridge" }, // Grand Bridge deck
  { type: "blue", name: "Riverside Gate" }, // fork: Riverside Walk
  { type: "shop", name: "Corner Bodega" },
  { type: "red", name: "Taxi Rank" },
  { type: "blue", name: "Theater Marquee" },
  { type: "green", name: "Museum Corner" }, // north-west corner
  { type: "grumpus", name: "Meter Maid Booth" },
  { type: "blue", name: "Library Steps" },
  { type: "red", name: "Old Mill Square" }, // Riverside Walk rejoins
  { type: "blue", name: "City Hall Steps" },
  { type: "red", name: "Fire Station" },
  { type: "green", name: "Pigeon Park" },
  { type: "blue", name: "Station Approach" },
];

// F1 Market Street, 32-39: Shops Row, the Plaza fountain, then up to Ferry Landing.
const MARKET: Tile[] = [
  { type: "blue", name: "Shops Row", at: [5.0, 1.0] },
  { type: "shop", name: "Market Hall", at: [4.4, 1.8] },
  { type: "red", name: "Flower Stall", at: [4.4, 2.8] },
  { type: "blue", name: "Plaza Fountain", at: [5.1, 3.5] },
  { type: "red", name: "Food Trucks", at: [6.1, 3.5] },
  { type: "grumpus", name: "Meter Maid Corner", at: [6.6, 4.35] },
  { type: "blue", name: "Cheese Shop", at: [6.6, 5.35] },
  { type: "blue", name: "Market Arcade", at: [7.1, 6.2] },
];

// F2 Riverside Walk, 40-45: down the canal bank, past the basin quay, west to Old Mill Square.
const RIVERSIDE: Tile[] = [
  { type: "blue", name: "Canal Bank", at: [4.2, 7.0] },
  { type: "stamp", name: "Pretzel Cart", at: [4.5, 6.05], stamp: "koopa" },
  { type: "blue", name: "The Quay", at: [4.1, 5.15] },
  { type: "minigame_balloon", name: "Riverboat Balloon", at: [3.1, 5.0], balloonCoins: 10 },
  { type: "green", name: "Willow Walk", at: [2.1, 5.0] },
  { type: "blue", name: "Boathouse", at: [1.05, 5.0] },
];

const RING_N = RING.length; // 32
const MARKET_FROM = 5;
const MARKET_TO = 14;
const RIVER_FROM = 20;
const RIVER_TO = 27;
const marketIdx = MARKET.map((_, k) => RING_N + k); // 32..39
const riverIdx = RIVERSIDE.map((_, k) => RING_N + MARKET.length + k); // 40..45

/** Tile-unit centre of the ring; world = (tile - centre) * tileSpacing. */
const CENTER: [number, number] = [4, 4];

/**
 * Tile units -> world ground plane (x, y), rounded like the carnival's.
 * Tile north (+ty) becomes data -y: the far side of the board, screen top.
 */
export function downtownWorld(tx: number, ty: number): { x: number; y: number } {
  const s = settings.tileSpacing;
  return {
    x: Math.round((tx - CENTER[0]) * s * 100) / 100,
    y: Math.round((CENTER[1] - ty) * s * 100) / 100 || 0,
  };
}

/** Placeholder scenery spots in tile units (canal + basin + Grand Bridge). */
export const DOWNTOWN_WATER = {
  /** Canal strip: centre x, from y0 (basin) north past the ring to y1 (off the top of the frame). */
  canal: { x: 5.5, y0: 6.5, y1: 16, width: 0.42 },
  /** Harbor Basin inside the loop. */
  basin: { x: 5.5, y: 6.5, r: 0.55 },
  /** Grand Bridge deck, between spaces 19 (x 5) and 18 (x 6). */
  bridge: { x: 5.5, y: 8, len: 1.9, width: 1.15 },
} as const;

function buildSpaces(): SpaceDef[] {
  const tiles: Tile[] = [...RING.map((t, i) => ({ ...t, at: ringAt(i) })), ...MARKET, ...RIVERSIDE];
  return tiles.map((t, index) => {
    const p = downtownWorld(t.at[0], t.at[1]);
    const space: SpaceDef = { index, type: t.type, name: t.name, x: p.x, y: p.y };
    if (t.stamp) space.stamp = t.stamp;
    if (t.balloonCoins) space.balloonCoins = t.balloonCoins;
    return space;
  });
}

/** next[i] = [stay] or [stay, branch]; a fork's last tile steps onto its rejoin. */
function buildNext(): number[][] {
  const next: number[][] = [];
  for (let i = 0; i < RING_N; i++) next.push([(i + 1) % RING_N]);
  next[MARKET_FROM].push(marketIdx[0]);
  next[RIVER_FROM].push(riverIdx[0]);
  marketIdx.forEach((_, k) => next.push([marketIdx[k + 1] ?? MARKET_TO]));
  riverIdx.forEach((_, k) => next.push([riverIdx[k + 1] ?? RIVER_TO]));
  return next;
}

/**
 * City names for the shared items (ssp-downtown-names.md). Display only: the
 * item keys, prices and rules are the carnival's. Items that keep their name
 * and help text (Double Dice, Zappy, Dueling Glove, Swap Card, Star Snatch,
 * Snagbag, Swap Orb) are absent.
 */
const DOWNTOWN_ITEMS: NonNullable<BoardSkin["items"]> = {
  mushroom: { name: "Espresso", desc: "Roll TWICE and move the total!", icon: "☕" },
  dash_mushroom: { name: "Bus Pass", desc: "The die stays honest. Your move is +3.", icon: "🚌" },
  golden_dash: { name: "Express Pass", desc: "The die stays honest. Your move is +5.", icon: "🚄" },
  poison_mushroom: { name: "Traffic Cone", desc: "After a rival rolls, their move is −2.", icon: "🚧" },
  warp_whistle: { name: "Taxi Whistle", desc: "Hail a cab to a random happening space ahead!", icon: "🚕" },
  warp_pipe: { name: "Subway Hatch", desc: "Swap places with a rival you choose, then roll.", icon: "🚇" },
  lucky_card: { name: "Lotto Ticket", desc: "A lucky ticket: triple roulette odds, and +1 on your next blue." },
  mecha_fly: { name: "Pickpocket", desc: "Steal one item from a rival you choose.", icon: "🤏" },
  boo_bell: { name: "Alley Cat", desc: "Steal one star from a rival you choose.", icon: "🐈" },
  genie_lamp: { name: "Limo Call", desc: "Ride straight to the Grand Prize Balloon.", icon: "🚘" },
  chomp_call: { name: "Tow Truck", desc: "A tow truck hauls the Grand Prize Balloon to you.", icon: "🛻" },
  bowser_suit: { name: "Grumbles Coat", desc: "Take a rival's stars. If they have not moved, they lose the turn." },
  orb_coin10: { name: "Parking Fine 10", desc: "Drop on a space. The next player pays you 10 coins." },
  orb_coin20: { name: "Parking Fine 20", desc: "Drop on a space. The next player pays you 20 coins." },
  orb_wreck: { name: "Wrecking Ball", desc: "Drop on a space. The victim loses a star and 10 coins." },
  orb_duel: { name: "Showdown", desc: "Drop on a space. Land on it and fight the placer 1v1." },
  star_cannon: { name: "Sky Elevator", desc: "Zoom straight to the star. Only in the last 5 turns.", icon: "🛗" },
  orb_tree: { name: "Piggy Bank", desc: "Grows 3 coins a round. Land on it yourself to collect.", icon: "🐷" },
  orb_circus: { name: "Toll Booth", desc: "Pass through and pay 1 coin a space for 3 turns.", icon: "🛑" },
  orb_starshift: { desc: "Land on it and the Grand Prize Balloon floats to a new spot." },
};

/** Downtown — the city board. Start = space 0 (Central Station). */
export const downtown: BoardDef = {
  id: "downtown",
  name: "Downtown",
  spaces: buildSpaces(),
  // Only the Ring Road is a closed loop; the forks are open branches.
  loops: [Array.from({ length: RING_N }, (_, i) => i)],
  branches: [
    { from: MARKET_FROM, path: marketIdx, to: MARKET_TO, label: "Market Street" },
    { from: RIVER_FROM, path: riverIdx, to: RIVER_TO, label: "Riverside Walk" },
  ],
  startIndex: 0,
  // fit = margin over the exact whole-board fit (boardScreenPlaceholder).
  cam: { center: [0, 0], fit: 1.08 },
  next: buildNext(),
  walk: "graph",
  // rng.pick reads this order: Bakery Corner, Clock Tower, Harbor Avenue,
  // Grand Bridge, Theater Marquee, City Hall Steps, Plaza Fountain, The Quay.
  prizeSpots: [3, 8, 12, 19, 23, 28, marketIdx[3], riverIdx[2]],
  prizeStart: 3,
  theme: "downtown",
  skin: {
    npc: { name: "Grumbles the Meter Maid", short: "Grumbles" },
    shopTitle: "GRUMBLES'S BODEGA",
    stamps: { shy: "Soda", goomba: "Bagel", koopa: "Pretzel" },
    jackpot: "CITY",
    place: "city",
    shopName: "Bodega",
    items: DOWNTOWN_ITEMS,
    giver: {
      name: "Penny the Paperboy",
      banner: "PENNY THE PAPERBOY!",
      gift: "Extra! Extra! Penny slips you a freebie off the paper stack: {item}!",
      full: "Extra! Extra! Penny has a freebie, but your bag's already full!",
    },
  },
};

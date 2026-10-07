/**
 * SUPER STAR PARTY — items: definitions, buying, inventory, use.
 * Wave 2 (items + shop). Owned by the items builder.
 *
 * The gumball machine stock: Mushroom (roll twice), Warp Whistle (teleport
 * to a happening space ahead), Zappy (zap 5 coins from the nearest rival).
 * All coin changes go through economy.addCoins; all randomness through rng;
 * the turn loop imports the pinned shapes below.
 */
import { match } from "../core/game";
import type { PlayerState } from "../core/game";
import { rng } from "../core/rng";
import { audio } from "../audio/audioEngine";
import { fizzyFairground } from "../board/boardData";
import { addCoins } from "./economy";
import { canPlaceTrap, placeTrap } from "./traps";
import type { TrapKind } from "../core/game";

export interface ItemDef {
  key: string;
  name: string;
  desc: string;
  price: number;
  icon: string;
  /** Set when buying this item throws an orb onto a space instead of holding it. */
  places?: TrapKind;
  /** Hidden in the shop until this many turns remain. */
  lateGame?: boolean;
}

/** The gumball machine stock. */
export const ITEM_DEFS: Record<string, ItemDef> = {
  mushroom: {
    key: "mushroom",
    name: "Mushroom",
    desc: "Roll TWICE and move the total!",
    price: 5,
    icon: "🍄",
  },
  warp_whistle: {
    key: "warp_whistle",
    name: "Warp Whistle",
    desc: "Teleport to a random happening space ahead!",
    price: 8,
    icon: "🌀",
  },
  zappy: {
    key: "zappy",
    name: "Zappy",
    desc: "Zap 5 coins from the nearest rival ahead!",
    price: 10,
    icon: "⚡",
  },
  orb_coin10: {
    key: "orb_coin10",
    name: "Coin Snatch 10",
    desc: "Throw on a space. The next player loses 10 coins to you.",
    price: 8,
    icon: "🟡",
    places: "coin10",
  },
  orb_coin20: {
    key: "orb_coin20",
    name: "Coin Snatch 20",
    desc: "Throw on a space. The next player loses 20 coins to you.",
    price: 15,
    icon: "🟠",
    places: "coin20",
  },
  orb_star: {
    key: "orb_star",
    name: "Star Snatch",
    desc: "Throw on a space. Steal one star from whoever lands there.",
    price: 25,
    icon: "⭐",
    places: "star_steal",
  },
  orb_wreck: {
    key: "orb_wreck",
    name: "Wreck Orb",
    desc: "Throw on a space. The victim loses a star and 10 coins.",
    price: 18,
    icon: "💥",
    places: "wreck",
  },
  orb_duel: {
    key: "orb_duel",
    name: "Duel Orb",
    desc: "Throw on a space. Land on it and fight the placer 1v1.",
    price: 12,
    icon: "🥊",
    places: "duel",
  },
  orb_snag: {
    key: "orb_snag",
    name: "Snagbag",
    desc: "Throw on a space. Steal one item from whoever lands there.",
    price: 10,
    icon: "👜",
    places: "snag",
  },
  orb_swap: {
    key: "orb_swap",
    name: "Swap Orb",
    desc: "Throw on a space. Swap places with whoever lands there.",
    price: 12,
    icon: "🔄",
    places: "swap",
  },
  star_cannon: {
    key: "star_cannon",
    name: "Star Cannon",
    desc: "Blast yourself straight to the star. Only in the last 5 turns.",
    price: 20,
    icon: "🚀",
    lateGame: true,
  },
  orb_tree: {
    key: "orb_tree",
    name: "Money Tree",
    desc: "Grows 3 coins a round. Land on it yourself to collect.",
    price: 12,
    icon: "🌳",
    places: "tree",
  },
  orb_circus: {
    key: "orb_circus",
    name: "Mini Circus",
    desc: "Pass through and pay 1 coin a space for 3 turns.",
    price: 14,
    icon: "🎪",
    places: "circus",
  },
  orb_starshift: {
    key: "orb_starshift",
    name: "Star Shift",
    desc: "Land on it and the Grand Prize Balloon pops over to a new spot.",
    price: 16,
    icon: "🌠",
    places: "star_shift",
  },
};

/** Display order for the shop (mushroom -> warp whistle -> zappy). */
export const ITEM_ORDER: string[] = [
  "mushroom",
  "warp_whistle",
  "zappy",
  "orb_coin10",
  "orb_coin20",
  "orb_star",
  "orb_wreck",
  "orb_duel",
  "orb_snag",
  "orb_swap",
  "orb_tree",
  "orb_circus",
  "orb_starshift",
  "star_cannon",
];

/** Turns still to play, including the current one. */
export function turnsLeft(): number {
  return Math.max(0, match.totalTurns - match.turn + 1);
}

export function starCannonAvailable(): boolean {
  return turnsLeft() <= 5;
}

/* ------------------------------------------------------------------ */
/*  Board helpers                                                      */
/* ------------------------------------------------------------------ */

const boardSize = (): number => fizzyFairground.spaces.length;

/** Forward wrap distance from `from` to `to`. */
function forwardDist(from: number, to: number): number {
  return (to - from + boardSize()) % boardSize();
}

/** Indices of green happening spaces strictly ahead of `from` (wrap). */
function greenSpacesAhead(from: number): number[] {
  return fizzyFairground.spaces
    .filter((s) => s.type === "green" && forwardDist(from, s.index) > 0)
    .map((s) => s.index);
}

/** Nearest green space by forward distance (fallback when none ahead). */
function nearestGreen(from: number): number {
  let best = fizzyFairground.spaces[0]?.index ?? 0;
  let bestD = Infinity;
  for (const s of fizzyFairground.spaces) {
    if (s.type !== "green") continue;
    const d = forwardDist(from, s.index);
    if (d < bestD) {
      bestD = d;
      best = s.index;
    }
  }
  return best;
}

/** Nearest rival measured by forward wrap distance (any other active player). */
function zappyTarget(playerId: number): PlayerState | null {
  const me = match.players[playerId];
  if (!me) return null;
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of match.players) {
    if (p.id === playerId || !p.active) continue;
    const d = forwardDist(me.space, p.space);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Buying                                                             */
/* ------------------------------------------------------------------ */

/**
 * Buy an item for a player. Spends coins through economy.addCoins and
 * pushes the key into the player's inventory. Returns false when the
 * player can't afford it (or the key is unknown). Plays the shop sting.
 */
export function buyItem(playerId: number, key: string): boolean {
  const def = ITEM_DEFS[key];
  const player = match.players[playerId];
  if (!def || !player) return false;
  if (player.coins < def.price) return false; // can't afford
  addCoins(playerId, -def.price); // spend through the economy
  player.items.push(key);
  audio.sfx.play("shop.buy");
  return true;
}

export interface ShopDecision {
  key: string;
  /** Set when the purchase was an orb and it was thrown onto this space. */
  placedOn?: number;
}

/**
 * One automatic shop visit for a CPU or an autoplay human.
 * Buys a single affordable item the player does not already hold, chosen
 * with rng (so the visit is a real decision and a seeded run replays).
 * Orb items are included only when a legal space exists, and are thrown
 * immediately — the same placement rules as the stall's picker — so the
 * visit never opens a modal. No candidate means they leave without buying
 * and without drawing from rng.
 */
export function decideShopPurchase(playerId: number): ShopDecision | null {
  const player = match.players[playerId];
  if (!player) return null;
  const shopSpaces = fizzyFairground.spaces.filter((s) => s.type === "shop").map((s) => s.index);
  const legal = fizzyFairground.spaces
    .filter((s) => canPlaceTrap(playerId, s.index, match.starBalloonPos, shopSpaces))
    .map((s) => s.index);
  const candidates: string[] = [];
  for (const key of ITEM_ORDER) {
    const def = ITEM_DEFS[key];
    if (!def) continue;
    if (def.lateGame && !starCannonAvailable()) continue;
    if (player.items.includes(key)) continue;
    if (player.coins < def.price) continue;
    if (def.places && legal.length === 0) continue;
    candidates.push(key);
  }
  if (candidates.length === 0) return null;
  const key = rng.pick(candidates);
  const def = ITEM_DEFS[key];
  if (!def || !buyItem(playerId, key)) return null;
  if (!def.places) return { key };
  const held = match.players[playerId]?.items;
  const at = held?.lastIndexOf(key) ?? -1;
  if (held && at >= 0) held.splice(at, 1);
  const spot = rng.pick(legal);
  if (!placeTrap(playerId, spot, def.places)) {
    addCoins(playerId, def.price);
    return null;
  }
  return { key, placedOn: spot };
}

/**
 * Bag items Fizzy Barker may hand over. Orbs are thrown, not held, so they
 * are not consolation gifts. The shop treats a held key as owned (one of
 * each); the Barker follows that same rule. There is no numeric bag size.
 * Returns the keys this player can still receive. Does not draw from rng.
 */
export function pityPool(playerId: number): string[] {
  const player = match.players[playerId];
  if (!player) return [];
  const pool: string[] = [];
  for (const key of ITEM_ORDER) {
    const def = ITEM_DEFS[key];
    if (!def || def.places) continue;
    if (def.lateGame && !starCannonAvailable()) continue;
    if (player.items.includes(key)) continue;
    pool.push(key);
  }
  return pool;
}

/**
 * Give one random bag item the player does not already hold.
 * Returns the key, or null when every bag item is already held (no rng draw).
 */
export function grantFizzyPity(playerId: number): string | null {
  const player = match.players[playerId];
  const pool = pityPool(playerId);
  if (!player || pool.length === 0) return null;
  const key = rng.pick(pool);
  player.items.push(key);
  return key;
}

/* ------------------------------------------------------------------ */
/*  Use                                                                */
/* ------------------------------------------------------------------ */

export interface UseItemResult {
  label: string;
  message: string;
  /** mushroom: turn loop rolls twice and moves the total. */
  extraDice?: boolean;
  /** warp whistle: board space index to teleport to. */
  moveTo?: number;
}

/**
 * Can the player use this item right now? Requires it in the inventory and
 * a valid target: mushroom always; warp whistle needs a green space ahead;
 * zappy needs a rival on the board.
 */
export function canUseItem(playerId: number, key: string): boolean {
  const player = match.players[playerId];
  if (!player || !player.items.includes(key)) return false;
  if (key === "mushroom") return true;
  if (key === "warp_whistle") return greenSpacesAhead(player.space).length > 0;
  if (key === "zappy") return zappyTarget(playerId) !== null;
  if (key === "star_cannon") return starCannonAvailable();
  return false;
}

/**
 * Use (consume) an item: removes one instance from the inventory and
 * applies its effect. Returns the label/message for the turn loop banner,
 * plus extraDice (mushroom) or moveTo (warp whistle). Coin theft (zappy)
 * goes through economy.addCoins.
 */
export function useItem(playerId: number, key: string): UseItemResult {
  const player = match.players[playerId];
  if (!player) return { label: "ITEM!", message: "..." };

  const idx = player.items.indexOf(key);
  if (idx >= 0) player.items.splice(idx, 1);

  if (key === "mushroom") {
    return { label: "MUSHROOM!", message: "Roll twice and move the total!", extraDice: true };
  }

  if (key === "warp_whistle") {
    const ahead = greenSpacesAhead(player.space);
    const moveTo = ahead.length > 0 ? rng.pick(ahead) : nearestGreen(player.space);
    audio.sfx.play("whoosh");
    return { label: "WARP WHISTLE!", message: "Whoosh!", moveTo };
  }

  if (key === "zappy") {
    const rival = zappyTarget(playerId);
    if (rival) {
      const stolen = Math.min(5, rival.coins);
      if (stolen > 0) {
        addCoins(rival.id, -stolen);
        addCoins(playerId, stolen);
      }
      audio.sfx.play("happening.magic");
      return { label: "ZAPPY!", message: `Zap! -${stolen} from ${rival.name}` };
    }
    return { label: "ZAPPY!", message: "Zap! ...no rival in sight." };
  }

  if (key === "star_cannon") {
    if (!starCannonAvailable()) {
      player.items.push(key);
      return { label: "STAR CANNON!", message: "Not yet — last 5 turns only." };
    }
    audio.sfx.play("whoosh");
    return { label: "STAR CANNON!", message: "Blast off to the star!", moveTo: match.starBalloonPos };
  }

  return { label: "ITEM!", message: "..." };
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

/** Copy of a player's item inventory. */
export function playerItemList(playerId: number): string[] {
  const player = match.players[playerId];
  return player ? [...player.items] : [];
}

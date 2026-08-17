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

export interface ItemDef {
  key: string;
  name: string;
  desc: string;
  price: number;
  icon: string;
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
};

/** Display order for the shop (mushroom -> warp whistle -> zappy). */
export const ITEM_ORDER: string[] = ["mushroom", "warp_whistle", "zappy"];

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

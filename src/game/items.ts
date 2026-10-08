/**
 * SUPER STAR PARTY — items: definitions, buying, inventory, use.
 * Wave 2 (items + shop). Owned by the items builder.
 *
 * Gumball stock is the original carnival bag (Mushroom, Midway Whistle, Zappy,
 * orbs, late-game Star Cannon) plus the fairground list: Zip Mushroom,
 * Golden Zip Mushroom, Sour Mushroom, double dice, Funhouse Hatch, dueling
 * glove, Lucky Card, Cogfly, swap card, Wisp Bell, genie lamp, Balloon Tug,
 * and Grumpus Coat.
 * All coin changes go through economy.addCoins; all randomness through rng.
 * Dice stay outcome-first: dash and poison edit the movement total after
 * the face is chosen. The turn loop imports the pinned shapes below.
 */
import { match, type PlayerState } from "../core/game";
import { rng } from "../core/rng";
import { audio } from "../audio/audioEngine";
import { bus } from "../core/events";
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

/** Added to a roll after the face is chosen. The die itself is unchanged. */
export const DASH_BONUS = 3;
export const GOLDEN_DASH_BONUS = 5;
/** Subtracted from a rival's movement total after they roll. Floor is 1. */
export const POISON_PENALTY = 2;
/** Coins the dueling-glove winner takes from the loser (never minted). */
export const DUEL_STAKE = 10;
/** Lucky Card's extra coin on the next blue space. */
export const LUCKY_BLUE_BONUS = 1;

/** The gumball machine stock. */
export const ITEM_DEFS: Record<string, ItemDef> = {
  mushroom: {
    key: "mushroom",
    name: "Mushroom",
    desc: "Roll TWICE and move the total!",
    price: 5,
    icon: "🍄",
  },
  dash_mushroom: {
    key: "dash_mushroom",
    name: "Zip Mushroom",
    desc: "The die stays honest. Your move is +3.",
    price: 5,
    icon: "💨",
  },
  golden_dash: {
    key: "golden_dash",
    name: "Golden Zip Mushroom",
    desc: "The die stays honest. Your move is +5.",
    price: 10,
    icon: "✨",
  },
  poison_mushroom: {
    key: "poison_mushroom",
    name: "Sour Mushroom",
    desc: "After a rival rolls, their move is −2.",
    price: 5,
    icon: "🍋",
  },
  double_dice: {
    key: "double_dice",
    name: "Double Dice",
    desc: "Roll two dice and move the total!",
    price: 8,
    icon: "🎲",
  },
  warp_whistle: {
    key: "warp_whistle",
    name: "Midway Whistle",
    desc: "Teleport to a random happening space ahead!",
    price: 8,
    icon: "🎺",
  },
  warp_pipe: {
    key: "warp_pipe",
    name: "Funhouse Hatch",
    desc: "Swap places with a rival you choose, then roll.",
    price: 10,
    icon: "🪞",
  },
  zappy: {
    key: "zappy",
    name: "Zappy",
    desc: "Zap 5 coins from the nearest rival ahead!",
    price: 10,
    icon: "⚡",
  },
  dueling_glove: {
    key: "dueling_glove",
    name: "Dueling Glove",
    desc: "Challenge a rival. High roll takes 10 coins.",
    price: 12,
    icon: "🥊",
  },
  lucky_card: {
    key: "lucky_card",
    name: "Lucky Card",
    desc: "A golden ticket: triple roulette odds, and +1 on your next blue.",
    price: 8,
    icon: "🎫",
  },
  mecha_fly: {
    key: "mecha_fly",
    name: "Cogfly",
    desc: "Steal one item from a rival you choose.",
    price: 12,
    icon: "⚙️",
  },
  swap_card: {
    key: "swap_card",
    name: "Swap Card",
    desc: "Trade one of your items for one of a rival's.",
    price: 8,
    icon: "🃏",
  },
  boo_bell: {
    key: "boo_bell",
    name: "Wisp Bell",
    desc: "Steal one star from a rival you choose.",
    price: 20,
    icon: "🔔",
  },
  genie_lamp: {
    key: "genie_lamp",
    name: "Genie Lamp",
    desc: "Warp onto the Grand Prize Balloon.",
    price: 15,
    icon: "🪔",
  },
  chomp_call: {
    key: "chomp_call",
    name: "Balloon Tug",
    desc: "The midway tug drags the Grand Prize Balloon to you.",
    price: 15,
    icon: "🪝",
  },
  bowser_suit: {
    key: "bowser_suit",
    name: "Grumpus Coat",
    desc: "Take a rival's stars. If they have not moved, they lose the turn.",
    price: 25,
    icon: "🧥",
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

/** Display order for the shop. Bag items first, orbs after, Star Cannon last. */
export const ITEM_ORDER: string[] = [
  "mushroom",
  "dash_mushroom",
  "golden_dash",
  "poison_mushroom",
  "double_dice",
  "warp_whistle",
  "warp_pipe",
  "zappy",
  "dueling_glove",
  "lucky_card",
  "mecha_fly",
  "swap_card",
  "boo_bell",
  "genie_lamp",
  "chomp_call",
  "bowser_suit",
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

/** MP7 bag items added on top of the original carnival stock. */
export const NEW_ITEM_KEYS: readonly string[] = [
  "dash_mushroom",
  "golden_dash",
  "poison_mushroom",
  "double_dice",
  "warp_pipe",
  "dueling_glove",
  "lucky_card",
  "mecha_fly",
  "swap_card",
  "boo_bell",
  "genie_lamp",
  "chomp_call",
  "bowser_suit",
];

const TARGET_ITEMS = new Set([
  "warp_pipe",
  "dueling_glove",
  "mecha_fly",
  "swap_card",
  "boo_bell",
  "bowser_suit",
  "poison_mushroom",
]);

/** Turns still to play, including the current one. */
export function turnsLeft(): number {
  return Math.max(0, match.totalTurns - match.turn + 1);
}

export function starCannonAvailable(): boolean {
  return turnsLeft() <= 5;
}

export function itemNeedsTarget(key: string): boolean {
  return TARGET_ITEMS.has(key);
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

function activeOthers(playerId: number): PlayerState[] {
  return match.players.filter((p) => p.active && p.id !== playerId);
}

/** Item keys still in the bag after removing one copy of `exceptKey`. */
function uniqueOthers(player: PlayerState, exceptKey: string): string[] {
  const copy = [...player.items];
  const at = copy.indexOf(exceptKey);
  if (at >= 0) copy.splice(at, 1);
  return Array.from(new Set(copy));
}

/**
 * Rivals a targeted item can hit. Empty when the item cannot be used.
 * Poison lists every other active player; the caller passes the roller.
 */
export function itemTargets(playerId: number, key: string): number[] {
  const me = match.players[playerId];
  if (!me) return [];
  const others = activeOthers(playerId);
  if (key === "warp_pipe" || key === "dueling_glove" || key === "bowser_suit" || key === "poison_mushroom") {
    return others.map((p) => p.id);
  }
  if (key === "boo_bell") return others.filter((p) => p.stars > 0).map((p) => p.id);
  if (key === "mecha_fly") return others.filter((p) => p.items.length > 0).map((p) => p.id);
  if (key === "swap_card") {
    if (uniqueOthers(me, "swap_card").length === 0) return [];
    return others.filter((p) => p.items.length > 0).map((p) => p.id);
  }
  return [];
}

/** Your other items, for the Swap Card picker. */
export function swapGiveChoices(playerId: number): string[] {
  const player = match.players[playerId];
  return player ? uniqueOthers(player, "swap_card") : [];
}

/** Items a rival can hand over. */
export function swapTakeChoices(targetId: number): string[] {
  const rival = match.players[targetId];
  return rival ? Array.from(new Set(rival.items)) : [];
}

/**
 * True when this player has already taken their turn in the current round.
 * The acting player has not finished, so they count as not-yet-moved.
 */
function hasMovedThisRound(playerId: number): boolean {
  const order = match.turnOrder.length > 0 ? match.turnOrder : match.players.map((p) => p.id);
  const cur = order.indexOf(match.currentPlayer);
  const idx = order.indexOf(playerId);
  if (cur < 0 || idx < 0) return false;
  return idx < cur;
}

function stealStars(fromId: number, toId: number, count: number): number {
  const from = match.players[fromId];
  const to = match.players[toId];
  if (!from || !to || count <= 0) return 0;
  const n = Math.min(count, from.stars);
  if (n <= 0) return 0;
  from.stars -= n;
  to.stars += n;
  return n;
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

/** Award a bag item with no coin cost (Barker-style, or a probe setup). */
export function grantItem(playerId: number, key: string): boolean {
  const def = ITEM_DEFS[key];
  const player = match.players[playerId];
  if (!def || !player) return false;
  player.items.push(key);
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
 * The pool is every bag item, including the MP7 list. Star Cannon joins
 * only while it is in season. Returns the keys this player can still
 * receive. Does not draw from rng.
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

export interface ItemTrade {
  give?: string;
  take?: string;
}

export interface UseItemResult {
  ok: boolean;
  label: string;
  message: string;
  /** mushroom / double dice: turn loop rolls twice and moves the total. */
  extraDice?: boolean;
  /** warp whistle / genie / star cannon: board space index to teleport to. */
  moveTo?: number;
  /** Resolve the destination space (buy a star) instead of ending the turn. */
  landEffect?: boolean;
  /** Grand Prize Balloon was dragged onto the user. Offer a purchase, then roll. */
  chomp?: boolean;
  /** Spaces were swapped with this rival. */
  swappedWith?: number;
  targetId?: number;
}

const failItem = (message: string): UseItemResult => ({ ok: false, label: "ITEM!", message });

/**
 * Can the player use this item right now? Requires it in the inventory and
 * a valid target: movement items always; warp whistle needs a green space
 * ahead; zappy needs a rival; targeted items need a legal rival.
 */
export function canUseItem(playerId: number, key: string): boolean {
  const player = match.players[playerId];
  if (!player || !player.items.includes(key) || !ITEM_DEFS[key]) return false;
  if (
    key === "mushroom" ||
    key === "dash_mushroom" ||
    key === "golden_dash" ||
    key === "double_dice" ||
    key === "lucky_card" ||
    key === "poison_mushroom" ||
    key === "genie_lamp" ||
    key === "chomp_call"
  ) {
    return true;
  }
  if (key === "warp_whistle") return greenSpacesAhead(player.space).length > 0;
  if (key === "zappy") return zappyTarget(playerId) !== null;
  if (key === "star_cannon") return starCannonAvailable();
  if (TARGET_ITEMS.has(key)) return itemTargets(playerId, key).length > 0;
  return false;
}

/**
 * One pre-roll item for a CPU or an autoplay human.
 * Poison is excluded: it is spent after a rival rolls.
 * No held item means no rng draw.
 */
export function pickAutoItem(playerId: number): string | null {
  const choices: string[] = [];
  for (const key of ITEM_ORDER) {
    if (key === "poison_mushroom") continue;
    if (!canUseItem(playerId, key)) continue;
    choices.push(key);
  }
  if (choices.length === 0) return null;
  return rng.pick(choices);
}

/**
 * Movement total after an outcome-first face (or a sum of faces).
 * Never below 1, so a poisoned 1 still steps onto the next space.
 */
export function movementTotal(raw: number, bonus: number, penalty: number): number {
  return Math.max(1, raw + bonus - penalty);
}

/** Read and clear dash / poison waiting on this player's next move. */
export function consumeRollAdjust(playerId: number): { bonus: number; penalty: number } {
  const fx = match.players[playerId]?.itemFx;
  if (!fx) return { bonus: 0, penalty: 0 };
  const bonus = fx.rollBonus;
  const penalty = fx.rollPenalty;
  fx.rollBonus = 0;
  fx.rollPenalty = 0;
  return { bonus, penalty };
}

/**
 * Lucky Card holders for this roulette, then the flag clears.
 * Call only when a minigame is actually being dealt.
 */
export function takeLuckyPlayers(): number[] {
  const ids = match.players.filter((p) => p.itemFx?.lucky).map((p) => p.id);
  for (const p of match.players) {
    if (p.itemFx) p.itemFx.lucky = false;
  }
  return ids;
}

/**
 * +1 coin on the next blue, from the Lucky Card. Returns the coins added
 * (0 when the ticket is not armed). The coin goes through addCoins.
 */
export function collectLuckyBlue(playerId: number): number {
  const fx = match.players[playerId]?.itemFx;
  if (!fx?.luckyBlue) return 0;
  fx.luckyBlue = false;
  addCoins(playerId, LUCKY_BLUE_BONUS);
  return LUCKY_BLUE_BONUS;
}

export interface ItemDebugSnapshot {
  order: string[];
  catalog: Array<{
    key: string;
    name: string;
    price: number;
    desc: string;
    icon: string;
    places: string | null;
    lateGame: boolean;
    bag: boolean;
  }>;
  players: Array<{
    id: number;
    items: string[];
    itemFx: PlayerState["itemFx"];
  }>;
  luckyPlayers: number[];
}

/** Item catalog and live bags for window.__SSP__.state().items. */
export function itemDebugSnapshot(): ItemDebugSnapshot {
  return {
    order: [...ITEM_ORDER],
    catalog: ITEM_ORDER.filter((key) => ITEM_DEFS[key]).map((key) => {
      const def = ITEM_DEFS[key];
      return {
        key,
        name: def.name,
        price: def.price,
        desc: def.desc,
        icon: def.icon,
        places: def.places ?? null,
        lateGame: !!def.lateGame,
        bag: !def.places,
      };
    }),
    players: match.players.map((p) => ({
      id: p.id,
      items: [...p.items],
      itemFx: { ...p.itemFx },
    })),
    luckyPlayers: match.players.filter((p) => p.itemFx?.lucky).map((p) => p.id),
  };
}

function consumeOne(player: PlayerState, key: string): void {
  const idx = player.items.indexOf(key);
  if (idx >= 0) player.items.splice(idx, 1);
}

/**
 * Use (consume) an item. Targeted items take `targetId`; when it is omitted
 * a legal rival is chosen with rng (CPU and autoplay). Swap Card may also
 * name the two keys; otherwise those are chosen with rng.
 * Coin and star changes go through the same helpers as the rest of the match.
 */
export function useItem(
  playerId: number,
  key: string,
  targetId?: number,
  trade?: ItemTrade,
): UseItemResult {
  const player = match.players[playerId];
  const def = ITEM_DEFS[key];
  if (!player || !def) return failItem("No such item.");
  if (!player.items.includes(key)) return failItem("Not in the bag.");

  if (key === "poison_mushroom") {
    const targets = itemTargets(playerId, key);
    if (targetId === undefined || !targets.includes(targetId)) return failItem("Nobody to sour.");
    const rival = match.players[targetId];
    if (!rival) return failItem("Nobody to sour.");
    consumeOne(player, key);
    rival.itemFx.rollPenalty += POISON_PENALTY;
    audio.sfx.play("sad");
    return {
      ok: true,
      label: "SOUR!",
      message: `${rival.name}'s move is −${POISON_PENALTY}!`,
      targetId,
    };
  }

  if (!canUseItem(playerId, key)) return failItem("Can't use that yet.");

  let target = targetId;
  if (TARGET_ITEMS.has(key) && key !== "poison_mushroom") {
    const targets = itemTargets(playerId, key);
    if (target === undefined) target = rng.pick(targets);
    if (!targets.includes(target)) return failItem("Nobody to aim at.");
  }

  if (key === "swap_card") {
    const givePool = swapGiveChoices(playerId);
    const takePool = swapTakeChoices(target as number);
    if (givePool.length === 0 || takePool.length === 0) return failItem("Nothing to trade.");
    const give = trade?.give && givePool.includes(trade.give) ? trade.give : rng.pick(givePool);
    const take = trade?.take && takePool.includes(trade.take) ? trade.take : rng.pick(takePool);
    const rival = match.players[target as number];
    if (!rival) return failItem("Nothing to trade.");
    consumeOne(player, key);
    consumeOne(player, give);
    consumeOne(rival, take);
    player.items.push(take);
    rival.items.push(give);
    audio.sfx.play("whoosh");
    const giveName = ITEM_DEFS[give]?.name ?? give;
    const takeName = ITEM_DEFS[take]?.name ?? take;
    return {
      ok: true,
      label: "SWAP CARD!",
      message: `Traded ${giveName} for ${rival.name}'s ${takeName}!`,
      targetId: target,
    };
  }

  consumeOne(player, key);

  if (key === "mushroom" || key === "double_dice") {
    player.itemFx.doubleDice = true;
    const name = key === "mushroom" ? "MUSHROOM!" : "DOUBLE DICE!";
    return { ok: true, label: name, message: "Roll twice and move the total!", extraDice: true };
  }

  if (key === "dash_mushroom" || key === "golden_dash") {
    const bonus = key === "dash_mushroom" ? DASH_BONUS : GOLDEN_DASH_BONUS;
    player.itemFx.rollBonus += bonus;
    const label = key === "dash_mushroom" ? "ZIP MUSHROOM!" : "GOLDEN ZIP!";
    return { ok: true, label, message: `Your move is +${bonus} after the roll!` };
  }

  if (key === "warp_whistle") {
    const ahead = greenSpacesAhead(player.space);
    const moveTo = ahead.length > 0 ? rng.pick(ahead) : nearestGreen(player.space);
    audio.sfx.play("whoosh");
    return { ok: true, label: "MIDWAY WHISTLE!", message: "Whoosh!", moveTo };
  }

  if (key === "warp_pipe") {
    const rival = match.players[target as number];
    if (!rival) return { ok: true, label: "FUNHOUSE HATCH!", message: "The hatch echoes." };
    const mine = player.space;
    player.space = rival.space;
    rival.space = mine;
    audio.sfx.play("whoosh");
    return {
      ok: true,
      label: "FUNHOUSE HATCH!",
      message: `Swapped places with ${rival.name}!`,
      swappedWith: rival.id,
      targetId: rival.id,
    };
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
      return { ok: true, label: "ZAPPY!", message: `Zap! -${stolen} from ${rival.name}` };
    }
    return { ok: true, label: "ZAPPY!", message: "Zap! ...no rival in sight." };
  }

  if (key === "dueling_glove") {
    const rival = match.players[target as number];
    if (!rival) return { ok: true, label: "DUEL!", message: "Nobody answered." };
    const mine = rng.int(1, 6);
    const theirs = rng.int(1, 6);
    const winnerId = mine >= theirs ? playerId : rival.id;
    const loserId = winnerId === playerId ? rival.id : playerId;
    const taken = Math.min(DUEL_STAKE, match.players[loserId]?.coins ?? 0);
    if (taken > 0) {
      addCoins(loserId, -taken);
      addCoins(winnerId, taken);
    }
    const winner = match.players[winnerId];
    audio.sfx.play("happening.magic");
    return {
      ok: true,
      label: "DUEL!",
      message: `Duel! ${winner?.name ?? "Someone"} wins ${mine}-${theirs} and takes ${taken} coins!`,
      targetId: rival.id,
    };
  }

  if (key === "lucky_card") {
    player.itemFx.lucky = true;
    player.itemFx.luckyBlue = true;
    audio.sfx.play("happening.magic");
    return {
      ok: true,
      label: "LUCKY CARD!",
      message: "Golden ticket! Triple roulette odds, and +1 on your next blue.",
    };
  }

  if (key === "mecha_fly") {
    const rival = match.players[target as number];
    if (!rival || rival.items.length === 0) {
      return { ok: true, label: "COGFLY!", message: "The cogfly buzzes home empty." };
    }
    const stolen = rng.pick(rival.items);
    consumeOne(rival, stolen);
    player.items.push(stolen);
    audio.sfx.play("happening.magic");
    const name = ITEM_DEFS[stolen]?.name ?? stolen;
    return {
      ok: true,
      label: "COGFLY!",
      message: `Snatched ${rival.name}'s ${name}!`,
      targetId: rival.id,
    };
  }

  if (key === "boo_bell") {
    const rival = match.players[target as number];
    const n = rival ? stealStars(rival.id, playerId, 1) : 0;
    audio.sfx.play(n > 0 ? "happening.magic" : "sad");
    return {
      ok: true,
      label: "WISP BELL!",
      message: n > 0 ? `A wisp steals a star from ${rival?.name ?? "them"}!` : "The wisp finds no star.",
      targetId: rival?.id,
    };
  }

  if (key === "genie_lamp") {
    audio.sfx.play("whoosh");
    return {
      ok: true,
      label: "GENIE LAMP!",
      message: "Wish granted — straight to the Grand Prize Balloon!",
      moveTo: match.starBalloonPos,
      landEffect: true,
    };
  }

  if (key === "chomp_call") {
    const from = match.starBalloonPos;
    const to = player.space;
    if (from !== to) {
      match.starBalloonPos = to;
      bus.emit("star:balloon_moved", { from, to, by: playerId });
      audio.sfx.play("whoosh");
    } else {
      audio.sfx.play("pop");
    }
    return {
      ok: true,
      label: "BALLOON TUG!",
      message: "The tug hauls the Grand Prize Balloon to you!",
      chomp: true,
    };
  }

  if (key === "bowser_suit") {
    const rival = match.players[target as number];
    if (!rival) return { ok: true, label: "GRUMPUS COAT!", message: "The coat roars at nobody." };
    const stolen = stealStars(rival.id, playerId, rival.stars);
    const skipped = !hasMovedThisRound(rival.id);
    if (skipped) rival.itemFx.skipTurn = true;
    audio.sfx.play("grumpus.laugh");
    const starBit = stolen > 0 ? `Stole ${stolen} star${stolen === 1 ? "" : "s"}` : "No stars to take";
    const turnBit = skipped ? `${rival.name} loses the turn!` : `${rival.name} already moved.`;
    return {
      ok: true,
      label: "GRUMPUS COAT!",
      message: `${starBit}. ${turnBit}`,
      targetId: rival.id,
    };
  }

  if (key === "star_cannon") {
    if (!starCannonAvailable()) {
      player.items.push(key);
      return { ok: false, label: "STAR CANNON!", message: "Not yet — last 5 turns only." };
    }
    audio.sfx.play("whoosh");
    return {
      ok: true,
      label: "STAR CANNON!",
      message: "Blast off to the star!",
      moveTo: match.starBalloonPos,
      landEffect: true,
    };
  }

  return failItem("...");
}

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */

/** Copy of a player's item inventory. */
export function playerItemList(playerId: number): string[] {
  const player = match.players[playerId];
  return player ? [...player.items] : [];
}

/** Debug setup: add coins through the economy. Returns the new total. */
export function debugFund(playerId: number, coins: number): number {
  const n = Math.floor(coins);
  if (!match.players[playerId] || n === 0) return match.players[playerId]?.coins ?? 0;
  return addCoins(playerId, n);
}

/** Debug setup: add stars (not a purchase, so the balloon stays put). */
export function debugGiveStars(playerId: number, count: number): number {
  const player = match.players[playerId];
  if (!player) return 0;
  player.stars = Math.max(0, player.stars + Math.floor(count));
  return player.stars;
}

/** Debug setup: put a player on a board space. Gameplay still reads p.space. */
export function debugPlace(playerId: number, space: number): number {
  const player = match.players[playerId];
  if (!player) return -1;
  const n = boardSize();
  const s = Math.floor(space);
  player.space = ((s % n) + n) % n;
  return player.space;
}

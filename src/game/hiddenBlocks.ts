/**
 * SUPER STAR PARTY — Hidden Blocks.
 *
 * Landing on a blue space can pop a Hidden Block out of thin air above the
 * player (`settings.hiddenBlockChance`). The player bonks it and gets one of:
 *
 *   star  — a free star
 *   item  — a random bag item they do not hold (coins if their bag is full)
 *   coins — a coin prize from `settings.hiddenBlockCoins`
 *   dice  — the Coin Dice Block: hit it as many times as you can before it
 *           vanishes; every hit pays a coin (up to `coinBlockMaxHits`)
 *
 * Every draw here goes through the match rng, so every peer spawns and opens
 * the same block. The only input is a human's hit count on the Coin Dice
 * Block, which the turn loop relays like any other board choice.
 */
import { match } from "../core/game";
import { rng } from "../core/rng";
import { settings } from "../config/settings";
import { addCoins } from "./economy";
import { grantFizzyPity } from "./items";

export type HiddenBlockKind = "star" | "item" | "coins" | "dice";
export const HIDDEN_BLOCK_KINDS: readonly HiddenBlockKind[] = ["star", "item", "coins", "dice"];

export interface HiddenBlockPrize {
  kind: HiddenBlockKind;
  /** Coins paid (coins prize, a full bag's fallback, or the dice block's hits). */
  coins: number;
  /** Item granted, when the prize was an item. */
  item: string | null;
}

function isKind(v: unknown): v is HiddenBlockKind {
  return typeof v === "string" && (HIDDEN_BLOCK_KINDS as readonly string[]).includes(v);
}

/**
 * Does a Hidden Block appear for this blue landing, and what is inside?
 * Draws the chance from rng, then (on a hit) the prize kind. Debug:
 * `window.__forcedBlock = "star" | "item" | "coins" | "dice"` forces the next
 * blue landing's block (consumed once), skipping both draws.
 */
export function rollHiddenBlock(): HiddenBlockKind | null {
  const w = globalThis as unknown as { __forcedBlock?: unknown };
  if (w.__forcedBlock !== undefined) {
    const forced = w.__forcedBlock;
    delete w.__forcedBlock;
    if (isKind(forced)) return forced;
  }
  if (rng.next() >= settings.hiddenBlockChance) return null;
  const odds = settings.hiddenBlockOdds;
  const total = HIDDEN_BLOCK_KINDS.reduce((s, k) => s + odds[k], 0);
  let r = rng.next() * total;
  for (const k of HIDDEN_BLOCK_KINDS) {
    r -= odds[k];
    if (r < 0) return k;
  }
  return "coins";
}

/**
 * Pay out a star, item or coins block. The dice block pays per hit through
 * `payCoinBlock` instead, so this returns zero coins for it.
 */
export function openHiddenBlock(playerId: number, kind: HiddenBlockKind): HiddenBlockPrize {
  const player = match.players[playerId];
  if (!player) return { kind, coins: 0, item: null };
  switch (kind) {
    case "star":
      player.stars += 1;
      return { kind, coins: 0, item: null };
    case "item": {
      const item = grantFizzyPity(playerId);
      if (item) return { kind, coins: 0, item };
      // A full bag still gets something: the smallest coin prize.
      const coins = settings.hiddenBlockCoins[0] ?? 5;
      addCoins(playerId, coins);
      return { kind, coins, item: null };
    }
    case "coins": {
      const coins = rng.pick(settings.hiddenBlockCoins);
      addCoins(playerId, coins);
      return { kind, coins, item: null };
    }
    case "dice":
      return { kind, coins: 0, item: null };
  }
}

/** Hits a CPU (or autoplay seat) lands on the Coin Dice Block. One rng draw. */
export function cpuCoinBlockHits(): number {
  const [lo, hi] = settings.coinBlockCpuHits;
  return rng.int(lo, hi);
}

/** Clamp a hit count to what the block can hold. Relayed counts go through this too. */
export function clampCoinBlockHits(hits: number): number {
  if (!Number.isFinite(hits)) return 0;
  return Math.max(0, Math.min(settings.coinBlockMaxHits, Math.floor(hits)));
}

/** Pay the Coin Dice Block: one coin per hit. Returns the coins paid. */
export function payCoinBlock(playerId: number, hits: number): number {
  const coins = clampCoinBlockHits(hits);
  if (coins > 0) addCoins(playerId, coins);
  return coins;
}

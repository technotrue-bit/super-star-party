/**
 * SUPER STAR PARTY — Gumball Shop rotating stock.
 *
 * Each shop space shows 3 items drawn on the core rng. The draw runs at
 * match start and at every round rollover (match.turn += 1) while rounds
 * remain, on every peer at the same point. Each restock draws exactly
 * 3 × SHOP_SPACES.length times: weighted picks without replacement, so no
 * shop repeats an item. If a shop's set would equal its previous round's
 * set, the 3rd pick moves to the next pool key without another draw.
 * The stock lives on MatchState, so snapshot() and the net hash cover it.
 * The pool never depends on coins or bags, so the draw count is fixed.
 */
import { match, type MatchState } from "../core/game";
import { rng } from "../core/rng";
import { activeBoard } from "../board/registry";
import { ITEM_ORDER } from "./items";

/** Items shown per shop. */
export const STOCK_SIZE = 3;

/** Integer weights [early, mid, late]. 0 means not stocked in that phase. */
export const STOCK_WEIGHTS: Record<string, readonly [number, number, number]> = {
  mushroom: [6, 4, 2],
  dash_mushroom: [6, 4, 2],
  poison_mushroom: [6, 4, 2],
  double_dice: [6, 4, 2],
  warp_whistle: [6, 4, 2],
  lucky_card: [6, 4, 2],
  swap_card: [6, 4, 2],
  golden_dash: [3, 4, 3],
  zappy: [3, 4, 3],
  warp_pipe: [3, 4, 3],
  dueling_glove: [3, 4, 3],
  mecha_fly: [3, 4, 3],
  boo_bell: [0, 2, 5],
  genie_lamp: [0, 2, 5],
  chomp_call: [0, 2, 5],
  bowser_suit: [0, 1, 4],
  orb_coin10: [1, 3, 3],
  orb_snag: [1, 3, 3],
  orb_duel: [1, 3, 3],
  orb_swap: [1, 3, 3],
  orb_tree: [2, 3, 1],
  orb_coin20: [0, 2, 4],
  orb_wreck: [0, 2, 4],
  orb_star: [0, 2, 4],
  orb_circus: [0, 2, 4],
  orb_starshift: [0, 2, 4],
  star_cannon: [0, 0, 6],
};

export interface RestockLogEntry {
  turn: number;
  stock: Record<string, string[]>;
  /** rng.draws around the restock. Debug only. */
  drawsBefore: number;
  drawsAfter: number;
}

export interface ShopVisitLogEntry {
  turn: number;
  pid: number;
  space: number;
  stock: string[];
  bought: string | null;
}

/** Debug-only logs for probes. Gameplay never reads them. */
export const restockLog: RestockLogEntry[] = [];
export const shopVisitLog: ShopVisitLogEntry[] = [];

/** Cached per board def id, so a match on another board rebuilds it. */
let shopSpaces: { id: string; list: number[] } | null = null;

/** Shop space indices of the active board, ascending. */
export function shopSpaceList(): number[] {
  const def = activeBoard();
  if (!shopSpaces || shopSpaces.id !== def.id) {
    shopSpaces = {
      id: def.id,
      list: def.spaces
        .filter((s) => s.type === "shop")
        .map((s) => s.index)
        .sort((a, b) => a - b),
    };
  }
  return shopSpaces.list;
}

/** 0 early, 1 mid, 2 late, from the round being stocked. */
function stockPhase(state: MatchState): 0 | 1 | 2 {
  const p = (state.turn - 1) / Math.max(1, state.totalTurns - 1);
  if (p < 1 / 3) return 0;
  if (p < 2 / 3) return 1;
  return 2;
}

/** Same rule as items.starCannonAvailable, read from `state`. */
function cannonInSeason(state: MatchState): boolean {
  return Math.max(0, state.totalTurns - state.turn + 1) <= 5;
}

/** Eligible keys and weights in ITEM_ORDER. */
function stockPool(state: MatchState): { keys: string[]; weights: number[] } {
  const phase = stockPhase(state);
  const keys: string[] = [];
  const weights: number[] = [];
  for (const key of ITEM_ORDER) {
    let w = STOCK_WEIGHTS[key]?.[phase] ?? 0;
    if (key === "star_cannon" && !cannonInSeason(state)) w = 0;
    if (w <= 0) continue;
    keys.push(key);
    weights.push(w);
  }
  return { keys, weights };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((k, i) => k === sb[i]);
};

/** One shop's stock: exactly STOCK_SIZE rng draws. */
function drawShop(pool: { keys: string[]; weights: number[] }, prev: readonly string[] | undefined): string[] {
  const keys = [...pool.keys];
  const weights = [...pool.weights];
  const picks: string[] = [];
  for (let n = 0; n < STOCK_SIZE; n++) {
    const sum = weights.reduce((a, w) => a + w, 0);
    const r = Math.floor(rng.next() * sum);
    let acc = 0;
    let at = keys.length - 1;
    for (let i = 0; i < keys.length; i++) {
      acc += weights[i];
      if (r < acc) {
        at = i;
        break;
      }
    }
    picks.push(keys[at]);
    keys.splice(at, 1);
    weights.splice(at, 1);
  }
  if (prev && sameSet(picks, prev)) {
    // Swap the 3rd pick for the next pool key not already shown. No draw.
    const last = picks[STOCK_SIZE - 1];
    const from = pool.keys.indexOf(last);
    for (let step = 1; step < pool.keys.length; step++) {
      const key = pool.keys[(from + step) % pool.keys.length];
      if (!picks.includes(key)) {
        picks[STOCK_SIZE - 1] = key;
        break;
      }
    }
  }
  return picks;
}

/**
 * Draw fresh stock for every shop for `state.turn`. Does nothing after the
 * final round. Builds a new object in ascending shop order so the JSON key
 * order (and the hash) is stable.
 */
export function restockShops(state: MatchState): void {
  if (state.turn > state.totalTurns) return;
  if (state.turn === 1) {
    restockLog.length = 0;
    shopVisitLog.length = 0;
  }
  const drawsBefore = rng.draws;
  const pool = stockPool(state);
  const next: Record<string, string[]> = {};
  for (const space of shopSpaceList()) {
    next[String(space)] = drawShop(pool, state.shopStock[String(space)]);
  }
  state.shopStock = next;
  state.shopStockRound = state.turn;
  restockLog.push({
    turn: state.turn,
    stock: JSON.parse(JSON.stringify(next)) as Record<string, string[]>,
    drawsBefore,
    drawsAfter: rng.draws,
  });
}

/** The 3 keys on sale at `space`. A non-shop space reads the first shop. */
export function shopStockAt(space: number): string[] {
  const stock = match.shopStock[String(space)] ?? match.shopStock[String(shopSpaceList()[0])] ?? [];
  return [...stock];
}

/** The shop space a player is standing on (first shop when not on one). */
export function shopSpaceFor(pid: number): number {
  const space = match.players[pid]?.space;
  if (space !== undefined && shopSpaceList().includes(space)) return space;
  return shopSpaceList()[0] ?? 0;
}

/**
 * SUPER STAR PARTY — canonical game state + match flow skeleton.
 * Wave 2 (turn-loop) owns the full orchestration; this module defines the
 * data model every system reads/writes. Keep fields stable.
 */
import { rng } from "./rng";
import { defaultSeatController, type SeatController } from "./seat";
import { resetMinigameTracking } from "../minigames/registry";
import { assignPlayerPacks, blankPlayedByPack, readPersistedRules, syncPersistedRules } from "../minigames/packRules";
import { bindLiveRules } from "../minigames/liveRules";
import { restockShops } from "../game/shopStock";
import type { CoinMultiplier, MinigamePackId } from "../minigames/packRules";

export type SpaceType =
  | "blue"
  | "red"
  | "green"
  | "star"              // disk style only; the balloon lives on match.starBalloonPos
  | "shop"
  | "grumpus"
  | "stamp"             // collect a Fizz, Crumb, or Taffy stamp
  | "minigame_balloon"; // passing/landing pays 5 or 10 and flags a minigame

/** The three carnival stamps. A full set pays the Carnival Jackpot. */
export type StampKind = "shy" | "goomba" | "koopa";

export const STAMP_KINDS: readonly StampKind[] = ["shy", "goomba", "koopa"];

export const STAMP_LABEL: Record<StampKind, string> = {
  shy: "Fizz",
  goomba: "Crumb",
  koopa: "Taffy",
};

export interface SpaceDef {
  index: number;
  type: SpaceType;
  name: string; // e.g. "Fizzy Fountain", "Gumball Shop"
  x: number;
  y: number;
  /** Which stamp this space grants. Set on stamp spaces. */
  stamp?: StampKind;
  /** Coin price shown on a minigame balloon (5 or 10). Paid on pass and land. */
  balloonCoins?: 5 | 10;
}

/**
 * Pending item effects. Dice faces stay outcome-first; rollBonus and
 * rollPenalty change the movement total after the face is chosen.
 */
export interface PlayerItemFx {
  rollBonus: number;
  rollPenalty: number;
  /** Next dice phase rolls two dice. */
  doubleDice: boolean;
  /** Triple this player's pack weight on the next minigame roulette. */
  lucky: boolean;
  /** Next blue space pays one extra coin. */
  luckyBlue: boolean;
  /** Grumpus Coat: skip this player's upcoming turn. */
  skipTurn: boolean;
}

export function blankItemFx(): PlayerItemFx {
  return {
    rollBonus: 0,
    rollPenalty: 0,
    doubleDice: false,
    lucky: false,
    luckyBlue: false,
    skipTurn: false,
  };
}

export interface PlayerState {
  id: number;
  kind: string; // character key
  name: string;
  coins: number;
  stars: number;
  space: number; // board space index
  minigameWins: number;
  items: string[]; // item keys
  /** Effects waiting on the next roll, blue space, roulette, or turn. */
  itemFx: PlayerItemFx;
  active: boolean;
  /** Minigame pack chosen by this player (for roulette weighting). */
  pack?: string;
  /**
   * Who supplies this seat's choices. Solo matches use one "local"
   * seat and the rest "cpu". "remote" waits for a session that does
   * not exist yet.
   */
  controller: SeatController;
  /**
   * Stamps currently held toward the next Carnival Jackpot.
   * Cleared when the three-stamp set pays out.
   */
  stamps: StampKind[];
  /**
   * Lifetime new stamps gained, including sets cashed in.
   * Stamp Star reads this so a jackpot does not wipe the bonus tally.
   */
  stampsCollected: number;
}

export type Phase =
  | "idle"
  | "dice"
  | "moving"
  | "space-effect"
  | "minigame"
  | "results"
  | "ended";

export type TrapKind =
  | "coin10"
  | "coin20"
  | "star_steal"
  | "wreck"
  | "duel"
  | "snag"
  | "swap"
  | "tree"
  | "circus"
  | "star_shift";

export interface SpaceTrap {
  space: number;
  kind: TrapKind;
  ownerId: number;
  /** Coins grown on a Money Tree. Paid to the owner when they land. */
  grown?: number;
  /** Turns a Mini Circus has left. Counts down once per full round. */
  turnsLeft?: number;
}

export interface DuelState {
  challengerId: number;
  victimId: number;
}

export interface MatchState {
  seed: number;
  turn: number; // 1-based
  totalTurns: number;
  phase: Phase;
  currentPlayer: number; // who is acting
  players: PlayerState[];
  lastDice: number[];
  events: string[]; // happening event ids fired this match (no repeats)
  /** Current position of the movable Prize Balloon (Star Balloon). */
  starBalloonPos: number;
  /** True if any player popped a Minigame Balloon this round (triggers minigame after all moves). */
  minigameTriggeredThisRound: boolean;
  /** Player IDs in the order they take turns this round. Set by initial dice roll. */
  turnOrder: number[];
  /** The dice rolls used to determine turn order (for display). */
  orderRolls: number[];
  /** Orbs sitting on spaces, waiting for someone else to land. */
  traps: SpaceTrap[];
  /** Set when a Duel Orb fires. Cleared when the 1v1 minigame returns. */
  duel?: DuelState;
  /** Minigame the roulette just dealt. The coin payout reads its pack. */
  lastMinigameId: string | null;
  lastMinigamePack: string | null;
  /**
   * Minigame ids that have drawn a die on `turn`, in deal order.
   * The die index is the id's place in `ids`. A repeat visit keeps that
   * place. Cleared when a match starts, so the first minigame of a turn
   * stays the seed-and-turn stream.
   */
  minigameDice: { turn: number; ids: string[] } | null;
  /** Packs the host left in the roulette. Copied from storage at match start. */
  enabledPacks: MinigamePackId[];
  /** Host coin scale, ×1–×4. Payouts read this, and snapshot() includes it. */
  coinMultiplier: CoinMultiplier;
  /** Pack owned by each local seat. */
  humanPack: MinigamePackId;
  /**
   * Minigame ids already dealt from each pack, in deal order.
   * A pack opens again once every game in it has been dealt.
   */
  playedByPack: Record<string, string[]>;
  /** Gumball stock per shop space index ("10", "21"): 3 item keys in draw order. */
  shopStock: Record<string, string[]>;
  /** match.turn the current stock was drawn for. */
  shopStockRound: number;
}

function makePlayer(id: number, kind: string, name: string, controller: SeatController): PlayerState {
  return {
    id,
    kind,
    name,
    coins: 10, // everyone starts with 10 coins, MP-style
    stars: 0,
    space: 0,
    minigameWins: 0,
    items: [],
    itemFx: blankItemFx(),
    active: true,
    pack: undefined,
    controller,
    stamps: [],
    stampsCollected: 0,
  };
}

/** Who drives this seat. Missing data keeps the solo default (seat 0 local). */
export function playerController(playerId: number): SeatController {
  const controller = match.players[playerId]?.controller;
  if (controller === "local" || controller === "cpu" || controller === "remote") return controller;
  return defaultSeatController(playerId);
}

const persistedRules = readPersistedRules();

/** The one live match. Screens read it; the turn-loop mutates it. */
export const match: MatchState = {
  seed: 1,
  turn: 1,
  totalTurns: 10,
  phase: "idle",
  currentPlayer: 0,
  players: [],
  lastDice: [],
  events: [],
  starBalloonPos: 0,
  minigameTriggeredThisRound: false,
  turnOrder: [0, 1, 2, 3],
  orderRolls: [],
  traps: [],
  lastMinigameId: null,
  lastMinigamePack: null,
  minigameDice: null,
  enabledPacks: persistedRules.enabledPacks,
  coinMultiplier: persistedRules.coinMultiplier,
  humanPack: persistedRules.humanPack,
  playedByPack: blankPlayedByPack(),
  shopStock: {},
  shopStockRound: 0,
};

bindLiveRules(match);

/**
 * Start a fresh match. Kinds = character keys, e.g. ["pip","bounce",...].
 * `controllers` assigns each seat. Omit it for one local human at seat 0
 * and CPUs in the rest, which is the current solo screen.
 */
export function startMatch(
  kinds: string[],
  names: string[],
  totalTurns = 10,
  seed?: number,
  controllers?: SeatController[],
): void {
  // A provided seed is preserved (critic replays, debug API); otherwise a
  // fresh random seed starts a new match.
  const used = seed === undefined ? rng.reset(Math.floor(Math.random() * 2 ** 31)) : rng.reset(seed);
  match.seed = used;
  match.turn = 1;
  match.totalTurns = totalTurns;
  match.phase = "idle";
  match.currentPlayer = 0;
  match.lastDice = [];
  match.events = [];
  match.players = kinds.map((k, i) =>
    makePlayer(i, k, names[i] ?? `P${i + 1}`, controllers?.[i] ?? defaultSeatController(i)),
  );
  // Grand Prize Balloon starts one hop after the Fizz Stamp Stand, so a
  // jackpot collected on the way in can fund a purchase the same move.
  match.starBalloonPos = 4;
  match.minigameTriggeredThisRound = false;
  match.turnOrder = [0, 1, 2, 3];
  match.orderRolls = [];
  match.traps = [];
  match.duel = undefined;
  match.lastMinigameId = null;
  match.lastMinigamePack = null;
  match.minigameDice = null;
  match.shopStock = {};
  match.shopStockRound = 0;

  // Pull the host's saved rotation onto this match, then deal packs.
  // Local seats keep the human pack; CPU and remote seats draw.
  syncPersistedRules(match);
  assignPlayerPacks(match.seed, match.players);

  // Reset minigame pack tracking for a fresh match (MP7 no-repeat within pack)
  resetMinigameTracking();

  // Round 1 gumball stock. Fixed draw count, same point on every peer.
  restockShops(match);
}

/** Deep snapshot for the debug API / critics. */
export function snapshot(): MatchState {
  return JSON.parse(JSON.stringify(match)) as MatchState;
}

/** Rank players: stars desc, coins desc, minigame wins desc. Returns ids. */
export function ranking(): number[] {
  const copy = [...match.players];
  copy.sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (b.coins !== a.coins) return b.coins - a.coins;
    return b.minigameWins - a.minigameWins;
  });
  return copy.map((p) => p.id);
}

/**
 * Mario Party style: All players roll one die at the start of the match.
 * Highest roll goes first. Ties trigger rerolls among the tied players only.
 * This is fully deterministic via the match rng.
 * Sets match.turnOrder and match.currentPlayer.
 */
export function rollForTurnOrder(): void {
  const n = match.players.length;
  if (n === 0) return;

  const rolls: number[] = new Array(n).fill(0);
  let order = Array.from({ length: n }, (_, i) => i);

  // Initial rolls
  for (let i = 0; i < n; i++) {
    rolls[i] = rng.int(1, 6);
  }

  // Resolve ties by rerolling only the tied group (repeat until unique max)
  let maxRoll = Math.max(...rolls);
  let leaders = order.filter((i) => rolls[i] === maxRoll);

  while (leaders.length > 1) {
    // Reroll only the leaders
    for (const i of leaders) {
      rolls[i] = rng.int(1, 6);
    }
    maxRoll = Math.max(...rolls);
    leaders = order.filter((i) => rolls[i] === maxRoll);
  }

  // Sort the order so the winner is first, then the rest in their original relative order
  // (or we can just put winner first and keep the others stable)
  const winner = leaders[0];
  order = [winner, ...order.filter((i) => i !== winner)];

  match.orderRolls = rolls;
  match.turnOrder = order;
  match.currentPlayer = winner;
}

/**
 * SUPER STAR PARTY — canonical game state + match flow skeleton.
 * Wave 2 (turn-loop) owns the full orchestration; this module defines the
 * data model every system reads/writes. Keep fields stable.
 */
import { rng } from "./rng";
import { resetMinigameTracking } from "../minigames/registry";

export type SpaceType =
  | "blue"
  | "red"
  | "green"
  | "star"              // disk style only; the balloon lives on match.starBalloonPos
  | "shop"
  | "grumpus"
  | "stamp"             // collect Shy Guy / Goomba / Koopa stamp
  | "minigame_balloon"; // passing/landing pays 5 or 10 and flags a minigame

/** The three carnival stamps. A full set pays the Carnival Jackpot. */
export type StampKind = "shy" | "goomba" | "koopa";

export const STAMP_KINDS: readonly StampKind[] = ["shy", "goomba", "koopa"];

export const STAMP_LABEL: Record<StampKind, string> = {
  shy: "Shy Guy",
  goomba: "Goomba",
  koopa: "Koopa",
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

export interface PlayerState {
  id: number;
  kind: string; // character key
  name: string;
  coins: number;
  stars: number;
  space: number; // board space index
  minigameWins: number;
  items: string[]; // item keys
  active: boolean;
  /** Minigame pack chosen by this player (for roulette weighting). */
  pack?: string;
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
}

function makePlayer(id: number, kind: string, name: string): PlayerState {
  return {
    id,
    kind,
    name,
    coins: 10, // everyone starts with 10 coins, MP-style
    stars: 0,
    space: 0,
    minigameWins: 0,
    items: [],
    active: true,
    pack: undefined,
    stamps: [],
    stampsCollected: 0,
  };
}

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
};

/** Start a fresh match. Kinds = character keys, e.g. ["pip","bounce",...]. */
export function startMatch(kinds: string[], names: string[], totalTurns = 10, seed?: number): void {
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
  match.players = kinds.map((k, i) => makePlayer(i, k, names[i] ?? `P${i + 1}`));
  // Grand Prize Balloon starts one hop after the Shy Stamp Stand, so a
  // jackpot collected on the way in can fund a purchase the same move.
  match.starBalloonPos = 4;
  match.minigameTriggeredThisRound = false;
  match.turnOrder = [0, 1, 2, 3];
  match.orderRolls = [];
  match.traps = [];
  match.duel = undefined;

  // Reset minigame pack tracking for a fresh match (MP7 no-repeat within pack)
  resetMinigameTracking();
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

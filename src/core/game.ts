/**
 * SUPER STAR PARTY — canonical game state + match flow skeleton.
 * Wave 2 (turn-loop) owns the full orchestration; this module defines the
 * data model every system reads/writes. Keep fields stable.
 */
import { rng } from "./rng";

export type SpaceType = "blue" | "red" | "green" | "star" | "shop" | "grumpus";

export interface SpaceDef {
  index: number;
  type: SpaceType;
  name: string; // e.g. "Fizzy Fountain", "Gumball Shop"
  x: number;
  y: number;
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
}

export type Phase =
  | "idle"
  | "dice"
  | "moving"
  | "space-effect"
  | "minigame"
  | "results"
  | "ended";

export interface MatchState {
  seed: number;
  turn: number; // 1-based
  totalTurns: number;
  phase: Phase;
  currentPlayer: number; // who is acting
  players: PlayerState[];
  lastDice: number[];
  events: string[]; // happening event ids fired this match (no repeats)
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

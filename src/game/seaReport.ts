/**
 * SUPER STAR PARTY — the Cruise Ship's Sea Report: one sea condition per round.
 *
 * Each round on the Cruise Ship the Captain calls the weather, and it changes
 * a rule for that round:
 *   calm      Smooth sailing. No change.
 *   tailwind  Everyone moves 1 extra space.
 *   choppy    Red spaces take double.
 *   treasure  Blue spaces pay double.
 *   dinner    The Captain's Dinner: everyone gets coins at the start of the round.
 *
 * The condition comes from an integer hash of (match.seed, match.turn), not an
 * rng draw, so it adds no match state and every peer agrees on it, like the
 * Funhouse Gate's flip. The same condition never runs two rounds in a row.
 * Other boards always read "calm" (no Sea Report).
 */
import { match } from "../core/game";
import { activeBoard } from "../board/registry";

export type SeaKind = "calm" | "tailwind" | "choppy" | "treasure" | "dinner";

export interface SeaReport {
  kind: SeaKind;
  /** Big banner text. */
  banner: string;
  /** One-line explainer toast. */
  toast: string;
  /** Short chip for the round ("TAILWIND +1"). */
  short: string;
}

/** Coins each player gets at the Captain's Dinner. */
export const DINNER_COINS = 3;

const REPORTS: Record<SeaKind, Omit<SeaReport, "kind">> = {
  calm: {
    banner: "CALM SEAS",
    toast: "⚓ Calm seas! Smooth sailing this round.",
    short: "⚓ CALM SEAS",
  },
  tailwind: {
    banner: "TAILWIND!",
    toast: "💨 A tailwind fills the sails: everyone moves 1 extra space this round!",
    short: "💨 MOVE +1",
  },
  choppy: {
    banner: "CHOPPY SEAS!",
    toast: "🌊 Choppy seas! The deck rocks and red spaces take DOUBLE this round!",
    short: "🌊 RED x2",
  },
  treasure: {
    banner: "TREASURE WATERS!",
    toast: "💰 Treasure waters! Blue spaces pay DOUBLE this round!",
    short: "💰 BLUE x2",
  },
  dinner: {
    banner: "CAPTAIN'S DINNER!",
    toast: `🍽️ The Captain's Dinner! Everyone gets ${DINNER_COINS} coins!`,
    short: "🍽️ DINNER",
  },
};

/** Weighted table (order matters: the hash indexes into it). */
const TABLE: ReadonlyArray<[SeaKind, number]> = [
  ["calm", 2],
  ["tailwind", 3],
  ["choppy", 3],
  ["treasure", 3],
  ["dinner", 2],
];
const TOTAL = TABLE.reduce((s, [, w]) => s + w, 0);

function mix(seed: number, turn: number): number {
  let h = Math.imul((Math.floor(seed) | 0) ^ Math.imul(turn | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function rawKind(seed: number, turn: number): SeaKind {
  let roll = mix(seed, turn) % TOTAL;
  for (const [kind, w] of TABLE) {
    if (roll < w) return kind;
    roll -= w;
  }
  return "calm";
}

/**
 * The sea condition for round `turn` of a match with `seed`. Pure: the same
 * inputs always give the same answer, and a condition never repeats on the
 * next round (a repeat steps to the next entry of the table).
 */
export function seaKindFor(seed: number, turn: number): SeaKind {
  let prev: SeaKind | null = null;
  let kind: SeaKind = "calm";
  for (let t = 1; t <= Math.max(1, turn); t++) {
    kind = rawKind(seed, t);
    if (kind === prev) {
      const i = TABLE.findIndex(([k]) => k === kind);
      kind = TABLE[(i + 1) % TABLE.length][0];
    }
    prev = kind;
  }
  return kind;
}

/** True when the active board runs the Sea Report (the Cruise Ship). */
export function seaReportActive(): boolean {
  return activeBoard().theme === "cruise";
}

/** This round's condition on the active board ("calm" off the Cruise Ship). */
export function currentSea(): SeaKind {
  if (!seaReportActive()) return "calm";
  return seaKindFor(match.seed, Math.min(match.turn, match.totalTurns));
}

/** Display text for a condition. */
export function seaReport(kind: SeaKind): SeaReport {
  return { kind, ...REPORTS[kind] };
}

/** Extra spaces every roll moves this round. */
export function seaMoveBonus(): number {
  return currentSea() === "tailwind" ? 1 : 0;
}

/** Multiplier for blue-space coins this round. */
export function seaBlueMultiplier(): number {
  return currentSea() === "treasure" ? 2 : 1;
}

/** Multiplier for red-space coin losses this round. */
export function seaRedMultiplier(): number {
  return currentSea() === "choppy" ? 2 : 1;
}

/** match.events sentinel: the Captain's Dinner for `turn` has been served. */
export function dinnerKey(turn: number): string {
  return `seaDinner:${turn}`;
}

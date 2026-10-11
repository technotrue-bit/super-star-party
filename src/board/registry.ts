/**
 * SUPER STAR PARTY — board registry.
 * Every board the game can play, keyed by BoardId. Gameplay and screens read
 * the board through activeBoard() at call time, never by importing a def
 * directly, so a match can run on any registered board. The defs are small
 * and load with the main bundle (the sim, hash and net code need them
 * synchronously); heavy scenery goes behind loadScene().
 */
import { fizzyFairground, type BoardDef } from "./boardData";
import { downtown } from "./boards/downtownData";

/** Registered board ids. Adding a board = one union member + one BOARDS entry. */
export type BoardId = "fizzy-fairground" | "downtown";

export interface BoardEntry {
  /** Graph and gameplay data. */
  def: BoardDef;
  /** Picker title. */
  name: string;
  /** Picker one-liner. */
  blurb: string;
  /** Bumped whenever def or movement rules change in a way peers must agree on (net checks). */
  rev: number;
  /** Lazy scenery chunk. Absent: boardScene builds the theme in the main bundle. */
  loadScene?: () => Promise<unknown>;
}

export const BOARDS: Record<BoardId, BoardEntry> = {
  "fizzy-fairground": {
    def: fizzyFairground,
    name: "Fizzy Fairground",
    blurb: "A carnival midway with an inner lane and the Funhouse Cut.",
    // rev 3: PR F seeded/moving Grand Prize (PR G's rev 2 may ship alone).
    rev: 3,
  },
  downtown: {
    def: downtown,
    name: "Downtown",
    blurb: "A city Ring Road with Market Street and the Riverside Walk.",
    // rev 3: PR F seeded/moving Grand Prize (PR G's rev 2 may ship alone).
    rev: 3,
  },
};

export const DEFAULT_BOARD: BoardId = "fizzy-fairground";

/** True when `id` names a registered board. */
export function isBoardId(id: unknown): id is BoardId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(BOARDS, id);
}

/** The def for `id` (the carnival for unknown ids). */
export function boardDef(id: BoardId): BoardDef {
  return (BOARDS[id] ?? BOARDS[DEFAULT_BOARD]).def;
}

/** A board choice as saved in the rules: one board, or "random" (resolved at match start). */
export type BoardRule = BoardId | "random";

/** URL / short aliases. A target that is not registered yet falls back with a warning. */
const BOARD_ALIASES: Record<string, string> = {
  carnival: "fizzy-fairground",
  fairground: "fizzy-fairground",
  downtown: "downtown",
  city: "downtown",
};

/** Registered ids in BOARDS order. "random" and the seeded pick index into this. */
export function boardIds(): BoardId[] {
  return Object.keys(BOARDS) as BoardId[];
}

export function boardTag(id: BoardId): string {
  return `${id}@${BOARDS[id]?.rev ?? 0}`;
}

/** `id@rev` for every registered board. A guest's join carries this list. */
export function boardTags(): string[] {
  return boardIds().map((id) => boardTag(id));
}

/**
 * Parse a saved or URL board value. Aliases ("carnival", "downtown") map to
 * ids. Unknown or not-yet-registered boards fall back to the carnival with a
 * console warning, never an error. Empty input returns null.
 */
export function parseBoardRule(raw: string | null | undefined, source = "board"): BoardRule | null {
  if (raw === null || raw === undefined) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (key === "random") return "random";
  const id = BOARD_ALIASES[key] ?? key;
  if (isBoardId(id)) return id;
  console.warn(`[SSP] ${source} "${raw}" is not a registered board; using ${DEFAULT_BOARD}.`);
  return DEFAULT_BOARD;
}

let urlRuleRead = false;
let urlRule: BoardRule | null = null;

/** `?board=` for this page load (read once). Null when absent. Never persisted. */
export function urlBoardRule(): BoardRule | null {
  if (urlRuleRead) return urlRule;
  urlRuleRead = true;
  try {
    if (typeof location === "undefined") return null;
    urlRule = parseBoardRule(new URLSearchParams(location.search).get("board"), "?board=");
  } catch {
    urlRule = null;
  }
  return urlRule;
}

/** Drop the `?board=` override for the rest of this page load (a picker tap replaces it). */
export function clearUrlBoardRule(): void {
  urlRuleRead = true;
  urlRule = null;
}

/**
 * Turn a rule into a board, once, before the match starts. "random" with a
 * fixed seed picks from the seed (an integer hash, not an rng draw), so
 * seeded test runs are reproducible; without a seed it uses Math.random.
 * The core gameplay rng is never touched. The result lands in
 * match.boardId, so every peer and the hash agree from then on.
 */
export function resolveBoardRule(rule: BoardRule | null | undefined, seed?: number): BoardId {
  if (rule !== "random") return isBoardId(rule) ? rule : DEFAULT_BOARD;
  const ids = boardIds();
  if (ids.length <= 1) return ids[0] ?? DEFAULT_BOARD;
  let pick: number;
  if (seed !== undefined && Number.isFinite(seed)) {
    let h = Math.imul(Math.floor(seed) ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    pick = (h >>> 0) % ids.length;
  } else {
    pick = Math.floor(Math.random() * ids.length) % ids.length;
  }
  return ids[pick];
}

// game.ts binds match.boardId here, so every activeBoard() read during a
// match agrees with match.boardId. Unbound (or no match yet): the carnival.
let readMatchBoard: (() => unknown) | null = null;

/** game.ts binds match.boardId once at boot. */
export function bindActiveBoard(read: () => unknown): void {
  readMatchBoard = read;
}

/** The current match's board id (match.boardId). */
export function activeBoardId(): BoardId {
  const id = readMatchBoard?.();
  return isBoardId(id) ? id : DEFAULT_BOARD;
}

/** The board the current match plays. */
export function activeBoard(): BoardDef {
  return boardDef(activeBoardId());
}

/** Registry entry for the current match's board. */
export function activeBoardEntry(): BoardEntry {
  return BOARDS[activeBoardId()];
}

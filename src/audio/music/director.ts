/**
 * SUPER STAR PARTY — music director.
 *
 * Game code asks for "board", "minigame_a" or "minigame_b"; the director
 * turns that into a theme for the current board or minigame genre, and owns
 * the final-turns lift: a board theme plays 6% faster, a semitone up, with
 * its lift layer on. Lift applies to board themes only.
 *
 * Pure: no Web Audio, no window, safe to import in node.
 */

import type { ClockChange } from "./clock";
import type { SetId } from "../samples/types";

const BOARD_THEMES = new Map<string, string>([
  ["fizzy-fairground", "board.fairground"],
  ["cruise-ship", "board.cruise"],
  ["downtown", "board.downtown"],
]);

const BOARD_SETS = new Map<string, SetId>([
  ["fizzy-fairground", "fairground"],
  ["cruise-ship", "cruise"],
  ["downtown", "downtown"],
]);

const DEFAULT_BOARD_THEME = "board.fairground";

const GENRE_THEMES = new Map<string, string>([
  ["survival", "mg.action"],
  ["race", "mg.action"],
  ["timing", "mg.action"],
  ["target", "mg.action"],
  ["collect", "mg.action"],
  ["puzzle", "mg.puzzle"],
  ["memory", "mg.puzzle"],
  ["rhythm", "mg.rhythm"],
]);

/** The theme each minigame alias plays when no genre is given. */
const MINIGAME_ALIASES = new Map<string, string>([
  ["minigame_a", "mg.action"],
  ["minigame_b", "mg.puzzle"],
]);

/** Plan 1 interim: themes not written yet play a written one. */
export const THEME_FALLBACK: Record<string, string> = {
  "board.cruise": "board.fairground",
  "board.downtown": "board.fairground",
  "mg.rhythm": "mg.puzzle",
};

const LIFT_TEMPO = 1.06;
const LIFT_TRANSPOSE = 1;

/** The theme for a requested track: board and minigame aliases resolve by board and genre, every other id is itself. */
export function resolveTheme(id: string, ctx: { board?: string; genre?: string }): string {
  if (id === "board") return BOARD_THEMES.get(ctx.board ?? "") ?? DEFAULT_BOARD_THEME;
  const alias = MINIGAME_ALIASES.get(id);
  if (alias) return GENRE_THEMES.get(ctx.genre ?? "") ?? alias;
  return id;
}

/** The track id that plays `theme`: the theme itself, else its interim fallback, else null. */
export function playableId(theme: string, tracks: Record<string, unknown>): string | null {
  if (Object.hasOwn(tracks, theme)) return theme;
  const fallback = Object.hasOwn(THEME_FALLBACK, theme) ? THEME_FALLBACK[theme] : undefined;
  return fallback !== undefined && Object.hasOwn(tracks, fallback) ? fallback : null;
}

/** The sample set a board's theme needs, or null for an unknown board. */
export function boardSet(boardId: string): SetId | null {
  return BOARD_SETS.get(boardId) ?? null;
}

function isBoardTheme(theme: string | null): boolean {
  return theme !== null && theme.startsWith("board.");
}

/** What the director needs from the playing sequencer. */
export interface SequencerControl {
  /** The theme playing, or null when nothing plays. */
  readonly theme: string | null;
  /** The theme's own tempo, before any lift. */
  readonly baseBpm: number;
  queueChange(c: ClockChange): void;
}

export class Director {
  private _board: string | undefined;
  private _lifted = false;

  /** `seq` returns the main sequencer, or null when nothing plays. */
  constructor(private readonly seq: () => SequencerControl | null) {}

  setBoard(id: string): void {
    this._board = id;
  }

  get board(): string | undefined {
    return this._board;
  }

  get lifted(): boolean {
    return this._lifted;
  }

  /**
   * Turn the final-turns lift on or off. A call that does not change the state does nothing.
   * A playing board theme changes at its next bar line (turning on plays the fill first);
   * any other theme is left alone, and the next board theme starts lifted.
   */
  lift(on: boolean): void {
    if (on === this._lifted) return;
    this._lifted = on;
    const s = this.seq();
    if (!s || !isBoardTheme(s.theme)) return;
    s.queueChange(
      on
        ? { bpm: s.baseBpm * LIFT_TEMPO, transpose: LIFT_TRANSPOSE, lift: true, fill: true }
        : { bpm: s.baseBpm, transpose: 0, lift: false },
    );
  }

  /** How a theme starts: a board theme started while lifted starts lifted from its first bar, with no fill. */
  startOptions(theme: string, baseBpm: number): { bpm: number; transpose: number; lift: boolean } {
    if (this._lifted && isBoardTheme(theme)) return { bpm: baseBpm * LIFT_TEMPO, transpose: LIFT_TRANSPOSE, lift: true };
    return { bpm: baseBpm, transpose: 0, lift: false };
  }
}

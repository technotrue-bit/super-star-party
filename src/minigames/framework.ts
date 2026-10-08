/**
 * SUPER STAR PARTY — minigame framework (Wave 3a).
 *
 * THE CONTRACT every minigame implements (read this before writing one):
 *
 *   interface Minigame {
 *     id: string;  name: string;  genre: MinigameGenre;
 *     howTo: string;         // one or two sentences: touch controls + how to win
 *     setup(ctx): void;      // build your arena ONCE per round
 *     update(dt): void;      // advance the game; call ctx.finish(ranking) when done
 *     teardown(): void;      // remove + dispose EVERYTHING you added to ctx.scene
 *   }
 *
 *   - The framework spawns the 4 player avatars (ctx.characters) and the
 *     minigame screen owns countdown/run/results; you position and animate
 *     the characters, you never create them.
 *   - ctx.scene is the live render scene: add your arena objects there and
 *     remove them in teardown(). The screen also sweeps any leftovers, so
 *     leaks are contained — but teardown() is your contract.
 *   - ctx.camera is the live camera: reposition it freely for your arena.
 *   - DETERMINISM (hard project contract): use ONLY ctx.rng for gameplay
 *     randomness (raw 0..1 — Math.floor(rng()*n) for ints, rng() < p for
 *     chances). NEVER Math.random / Date.now / performance.now in gameplay
 *     decisions. Animation timing via dt is fine. Seeded runs must replay
 *     byte-identically.
 *   - CPU players: run them inside update() with the same ctx.rng. Win
 *     sometimes, lose sometimes, act credibly — never psychic.
 *   - Call ctx.finish(ranking) EXACTLY once: ranking = player ids, best
 *     first. Pass coinWinners for a team result so every teammate is paid
 *     the full pot; omit it for a free-for-all (first place only). The
 *     screen shows the podium and returns to the board on its own.
 *   - Input: install your handlers in setup() by ASSIGNING
 *     ctx.input.pointer / ctx.input.key (the defaults are no-ops). The
 *     screen routes DOM pointer events (normalized 0..1 screen coords) and
 *     keyboard (actions: 'up'|'down'|'left'|'right'|'confirm') into them
 *     while the minigame is live.
 *   - Round lifecycle: setup() is called once per round on the SAME
 *     Minigame instance (loaded once and cached) — keep per-round state in
 *     setup/local closures, not module scope.
 *
 * Pending-entry mechanism: the turn loop picks a minigame from the
 * registry, calls setPendingMinigame(entry) and goto('minigame'); the
 * screen consumes the entry and resolves the actual Minigame via
 * loadMinigame(). Registry wiring: src/minigames/index.ts lists lazy
 * module loaders; registerAllMinigames() (auto-run at load) registers
 * their ids/names with the registry.
 */
import type * as THREE from "three";
import type { Character } from "../characters/characterFactory";
import { assertMinigameHowTos, registerMinigame, type MinigameEntry } from "./registry";
import { MINIGAME_MODULES } from "./index";

export type { MinigameEntry }; // pending-entry hand-off uses registry entries

export type MinigameGenre =
  | "survival"
  | "race"
  | "timing"
  | "memory"
  | "rhythm"
  | "target"
  | "collect"
  | "puzzle";

/** Static per-player info the framework hands to every minigame. */
export interface MinigamePlayerInfo {
  id: number; // playerId (0 = human)
  kind: string; // character key
  name: string;
  color: string;
}

/** Input entry points — minigames assign handlers in setup(). */
export interface MinigameInput {
  /** Human pointer, screen coords normalized 0..1, down = press/release. */
  pointer(x: number, y: number, down: boolean): void;
  /** Human keyboard action: 'up' | 'down' | 'left' | 'right' | 'confirm'. */
  key(action: string): void;
}

export interface MinigameContext {
  /** The 4 players, id = playerId (index 0 = human). */
  players: MinigamePlayerInfo[];
  /** The 4 live avatars, by player id — the framework spawned them. */
  characters: Character[];
  /** The live render scene — add your arena objects here. */
  scene: THREE.Scene;
  /** The live camera — reposition it freely for your arena. */
  camera: THREE.PerspectiveCamera;
  /** Gameplay RNG (deterministic) — the ONLY randomness you may use. */
  rng: () => number;
  /** Seconds since the minigame started (after GO). */
  time: number;
  /** Big center banner (defaults silent, ~1.8s). */
  announce(text: string, opts?: { durationMs?: number; sound?: string | null }): void;
  /** One-shot sound effect (names: coin.gain, pop, boing, whoosh, ...). */
  playSfx(name: string, opts?: { volume?: number; pitch?: number }): void;
  /**
   * Call ONCE when the minigame ends: player ids, best first.
   * `coinWinners` is every player who earned the coin pot (a winning team).
   * Omit it for a free-for-all so only ranking[0] is paid.
   */
  finish(ranking: number[], coinWinners?: number[]): void;
  input: MinigameInput;
}

export interface Minigame {
  id: string;
  name: string;
  genre: MinigameGenre;
  /**
   * Shown on the START MINI GAME card. One or two short sentences:
   * how to touch, tap, or hold, and how to win. Required — a new game
   * does not typecheck without it, and registration refuses a blank one.
   */
  howTo: string;
  setup(ctx: MinigameContext): void;
  update(dt: number): void;
  teardown(): void;
}

/* ------------------------------------------------------------------ */
/*  Pending entry: turn loop -> minigame screen hand-off               */
/* ------------------------------------------------------------------ */

let pendingEntry: MinigameEntry | null = null;

/** The turn loop sets the picked entry BEFORE goto('minigame'). */
export function setPendingMinigame(entry: MinigameEntry | null): void {
  pendingEntry = entry;
}

/** The minigame screen reads (and clears) the pending entry on enter. */
export function consumePendingMinigame(): MinigameEntry | null {
  const entry = pendingEntry;
  pendingEntry = null;
  return entry;
}

/* ------------------------------------------------------------------ */
/*  Registry wiring                                                    */
/* ------------------------------------------------------------------ */

/** Resolved Minigame instances, cached per id across rounds. */
const loaded = new Map<string, Minigame>();

/**
 * Resolve a registry entry to its Minigame instance. Loads every module
 * listed in src/minigames/index.ts until the id matches. Returns null when
 * the id is not registered (the screen then aborts back to the board).
 */
export async function loadMinigame(id: string): Promise<Minigame | null> {
  const hit = loaded.get(id);
  if (hit) return hit;
  for (const load of MINIGAME_MODULES) {
    try {
      const mg = await load();
      if (mg.id === id) {
        loaded.set(id, mg);
        return mg;
      }
    } catch (err) {
      console.error(`[minigames] failed to load module for '${id}'`, err);
    }
  }
  return null;
}

/**
 * Register every minigame module listed in src/minigames/index.ts with the
 * registry. Minigame batches append loaders to MINIGAME_MODULES as they
 * land; modules may also call registerMinigame themselves (the registry
 * dedupes by id). Auto-run once at framework load.
 */
export async function registerAllMinigames(): Promise<void> {
  for (const load of MINIGAME_MODULES) {
    let mg: Minigame;
    try {
      mg = await load();
    } catch (err) {
      console.error("[minigames] failed to register module", err);
      continue;
    }
    const howTo = mg.howTo?.trim() ?? "";
    if (!howTo) {
      throw new Error(`[minigames] '${mg.id}' is missing howTo (controls and how to win)`);
    }
    registerMinigame({ id: mg.id, name: mg.name, description: howTo });
  }
  assertMinigameHowTos();
}

void registerAllMinigames();

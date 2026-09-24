/**
 * SUPER STAR PARTY — debug API. window.__SSP__ is the critic's window into
 * the RUNNING game: deep state snapshots, deterministic stepping, autoplay.
 * Must always exist, even with audio off. Never remove fields; add freely.
 */
import { match, snapshot, startMatch } from "./game";
import { rng } from "./rng";
import { audio } from "../audio/audioEngine";
import { screens } from "../screens/screenManager";
import { world } from "../main";
import { openShop } from "../screens/shopScreen";
import { resetWipeRotation } from "../ui/transitions";

export interface SSPDebug {
  state(): Record<string, unknown>;
  goto(screen: string): void;
  advance(n?: number): void;
  autoplay(on: boolean): void;
  rollDice(face: number): void;
  seed(n: number): void;
  reset(): void;
  audioLevels(): { rms: number; peak: number };
  perf(): { fps: number; ms: number };
  startMatch(kinds: string[], names?: string[]): void;
  /** Debug-only: jump to end-of-match (set phase='ended' for finale wiring). */
  endMatch(): void;
  resetWipeRotation(): void;
  /**
   * Open the Gumball Shop for `playerId` (default 0 = human) on demand for
   * visual inspection. Resolves when the player closes or buys. This is the
   * critic's deterministic entry point — the shop stays open indefinitely
   * (no auto-resolve) so it can be inspected.
   */
  openShop(playerId?: number): Promise<{ bought: string[] }>;
}

let autoplayOn = false;
let fps = 0;
let frameMs = 0;
let autoplayHook: (() => void) | null = null;

/** Turn loop registers its driver here (Wave 2). */
export function setAutoplayHook(fn: (() => void) | null): void {
  autoplayHook = fn;
}

/** Called by the main loop each frame. */
export function tickFrame(deltaMs: number): void {
  frameMs = deltaMs;
  fps = deltaMs > 0 ? 1000 / deltaMs : 60;
}

/** Called by the main loop while autoplay is on. */
export function autoplayTick(): void {
  autoplayHook?.();
}

export function setAutoplay(on: boolean): void {
  autoplayOn = on;
}

export function isAutoplay(): boolean {
  return autoplayOn;
}

export function installDebugAPI(): void {
  const api: SSPDebug = {
    state() {
      const cam = world.camera;
      return {
        version: "0.1.0",
        screen: screens.current,
        nextWipe: screens.nextWipe,
        isWiping: screens.isWiping,
        camera: cam
          ? {
              pos: [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(2)),
              fov: cam.fov,
            }
          : null,
        match: snapshot(),
        audio: {
          track: audio.music.track(),
          levels: audio.levels(),
          master: audio.master.gain,
        },
        rngSeed: rng.seed,
        autoplay: autoplayOn,
        fps: Math.round(fps),
        frameMs: Math.round(frameMs),
      };
    },
    goto(screen: string) {
      screens.goto(screen);
    },
    advance(n = 1) {
      for (let i = 0; i < n; i++) screens.update(1 / 60);
    },
    autoplay(on: boolean) {
      setAutoplay(on);
    },
    rollDice(face: number) {
      // Wave 2: route to the turn-loop's forced-dice hook.
      (window as unknown as { __forcedDice?: number }).__forcedDice = face;
    },
    seed(n: number) {
      rng.reset(n);
      match.seed = n;
    },
    reset() {
      screens.goto("title");
    },
    audioLevels() {
      return audio.levels();
    },
    perf() {
      return { fps: Math.round(fps), ms: Math.round(frameMs) };
    },
    startMatch(kinds: string[], names?: string[]) {
      // Preserve the current seed (set via __SSP__.seed(n)) so critic
      // replays are byte-identical; plain startMatch still reseeds randomly.
      startMatch(kinds, names ?? [], 10, match.seed);
      screens.goto("board");
    },
    /** Debug-only: start a match with varied data and jump to finale. */
    endMatch() {
      if (match.players.length === 0) {
        startMatch(["pip", "bounce", "glimmer", "tusk"], ["Pip", "Bounce", "Glimmer", "Tusk"], 10, 12345);
      }
      match.players.forEach((p, i) => {
        p.coins = 10 + i * 5;
        p.stars = i;
        p.minigameWins = i;
      });
      match.phase = "ended";
      match.turn = match.totalTurns;
      screens.goto("finale");
    },
    openShop(playerId = 0) {
      // Open the shop directly for inspection — no auto-resolve timer.
      return openShop(playerId);
    },
    resetWipeRotation() {
      // Re-export so headless probes can reset the deterministic wipe cycle.
      resetWipeRotation();
    },
  };
  (window as unknown as { __SSP__: SSPDebug }).__SSP__ = api;
  console.log("[SSP] debug API installed — window.__SSP__");
}

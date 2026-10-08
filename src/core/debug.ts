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
import { minigameCoinAward, minigamePayout, playerCoins } from "../game/economy";
import { minigameCatalog, minigameCount, resetMinigameTracking, tryPickMinigame } from "../minigames/registry";
import {
  getEnabledPacks,
  getHumanPack,
  getMinigameCoinMultiplier,
  setEnabledPacks as saveEnabledPacks,
  setHumanPack as saveHumanPack,
  setMinigameCoinMultiplier as saveCoinMultiplier,
} from "../minigames/packRules";
import { effectsPassCount, getEffectsQuality, setEffectsQuality as applyEffectsQuality } from "../render/postFx";

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
  /** Host rotation. Returns the packs actually left on (at least one). */
  setMinigamePacks(ids: string[]): string[];
  /** Persisted coin scale, 1–4. */
  setMinigameCoinMultiplier(n: number): number;
  /** Human's pack. Must be one of the packs in rotation. */
  setHumanPack(id: string): string;
  /**
   * Deal `n` minigames with the live roulette (enabled packs, player packs,
   * match rng). Resets the no-repeat lists first. Debug only — it consumes
   * the match rng.
   */
  sampleMinigames(n?: number): { id: string; pack: string }[];
  /** Coins a win would pay for `pack` (or the last dealt minigame). */
  minigameRewardPreview(pack?: string): number;
  /** Pay the winner the scaled minigame pot. Returns the coins actually added. */
  grantMinigamePayout(winnerId?: number, pack?: string): number;
  /** Current post look: "off", "low", or "high". */
  effectsQuality(): string;
  /**
   * Switch the post look. Does not write localStorage (the pause menu does).
   * Unknown values are ignored. Returns the quality now in effect.
   */
  setEffectsQuality(quality: string): string;
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
          duck: audio.music.duckLevel(),
          levels: audio.levels(),
          master: audio.master.gain,
        },
        rngSeed: rng.seed,
        autoplay: autoplayOn,
        minigameRules: {
          enabledPacks: getEnabledPacks(),
          coinMultiplier: getMinigameCoinMultiplier(),
          humanPack: getHumanPack(),
          count: minigameCount(),
          catalog: minigameCatalog(),
        },
        fps: Math.round(fps),
        frameMs: Math.round(frameMs),
        effectsQuality: getEffectsQuality(),
        effectsPasses: effectsPassCount(),
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
    setMinigamePacks(ids: string[]) {
      return saveEnabledPacks(ids);
    },
    setMinigameCoinMultiplier(n: number) {
      return saveCoinMultiplier(n);
    },
    setHumanPack(id: string) {
      return saveHumanPack(id);
    },
    sampleMinigames(n = 12) {
      resetMinigameTracking();
      const packs: Record<number, string> = {};
      for (const p of match.players) {
        if (p.pack) packs[p.id] = p.pack;
      }
      const out: { id: string; pack: string }[] = [];
      const count = Math.max(0, Math.floor(n));
      for (let i = 0; i < count; i++) {
        const mg = tryPickMinigame(packs);
        if (!mg) break;
        out.push({ id: mg.id, pack: mg.pack ?? "midway" });
      }
      return out;
    },
    minigameRewardPreview(pack?: string) {
      return minigameCoinAward(pack);
    },
    grantMinigamePayout(winnerId = 0, pack?: string) {
      if (pack) match.lastMinigamePack = pack;
      const before = playerCoins(winnerId);
      minigamePayout(winnerId);
      return playerCoins(winnerId) - before;
    },
    effectsQuality() {
      return getEffectsQuality();
    },
    setEffectsQuality(quality: string) {
      return applyEffectsQuality(quality, false);
    },
  };
  (window as unknown as { __SSP__: SSPDebug }).__SSP__ = api;
  console.log("[SSP] debug API installed — window.__SSP__");
}

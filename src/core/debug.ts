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
import { awardMinigameResult, minigameCoinAward, minigamePayout, playerCoins, type MinigameAward } from "../game/economy";
import {
  buyItem,
  collectLuckyBlue,
  debugFund,
  debugGiveStars,
  debugPlace,
  grantItem,
  itemDebugSnapshot,
  pityPool,
  takeLuckyPlayers,
  useItem,
  type UseItemResult,
} from "../game/items";
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
import { rapierStatus, runContactScenario as runRapierContactScenario } from "../physics/contact";
import { setOnlineMatch, setPartyAssist } from "../net/mode";
import { dropOut, partyView } from "../net/session";

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
  /**
   * Pay a minigame the way the results screen does. Omit coinWinners for a
   * free-for-all (first place only). A team list pays each id the full pot
   * and one minigame win. `pack` selects the pack-owner multiplier.
   */
  settleMinigamePayout(ranking: number[], coinWinners?: number[], pack?: string): MinigameAward[];
  /** Current post look: "off", "low", or "high". */
  effectsQuality(): string;
  /**
   * Switch the post look. Does not write localStorage (the pause menu does).
   * Unknown values are ignored. Returns the quality now in effect.
   */
  setEffectsQuality(quality: string): string;
  /** Live item catalog, bags, and pending effects. */
  itemState(): ReturnType<typeof itemDebugSnapshot>;
  /** Add coins through the economy. */
  fundPlayer(playerId: number, coins: number): number;
  /** Add stars without moving the Grand Prize Balloon. */
  giveStars(playerId: number, count: number): number;
  /** Put a player on a space. Position stays `p.space`. */
  placePlayer(playerId: number, space: number): number;
  /** Award an item with no coin cost. */
  grantItem(playerId: number, key: string): boolean;
  /** Buy an item through the shop path. */
  buyItem(playerId: number, key: string): boolean;
  /** Use a held item. Omit targetId to let rng choose a rival. */
  useHeldItem(playerId: number, key: string, targetId?: number): UseItemResult;
  /** Bag keys Fizzy Barker can still give this player. */
  pityPool(playerId: number): string[];
  /** Lucky Card +1 on the next blue. Returns coins added. */
  collectLuckyBlue(playerId: number): number;
  /** Lucky Card holders for the next roulette, then the flag clears. */
  takeLuckyPlayers(): number[];
  /** Rapier chunk status and how many bodies the live contact world holds. */
  rapier(): { loaded: boolean; failed: boolean; contactBodies: number; contactsSeen: number };
  /**
   * Two balls on a throwaway world. Loads the chunk if a contact minigame
   * has not already. Returns whether they met and bounced apart.
   */
  runContactScenario(): Promise<{ contacted: boolean; separated: boolean; minGap: number }>;
  /** Open one minigame directly. Starts a match first when the board is empty. */
  openMinigame(id: string): void;
  /** Friends-room status. Offline until a room starts. */
  party(): ReturnType<typeof partyView>;
  /** Playtest: local humans publish the CPU choice over the relay. */
  partyAssist(on: boolean): void;
  /** Leave the room. A guest's seat becomes a CPU. The host ends the room. */
  partyDrop(): void;
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
        items: itemDebugSnapshot(),
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
        rapier: rapierStatus(),
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
      setOnlineMatch(false);
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
      if (new URLSearchParams(window.location.search).get("stamps") === "1" && match.players[0]) {
        match.players[0].stampsCollected = 3;
      }
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
      const lucky = match.players.filter((p) => p.itemFx?.lucky).map((p) => p.id);
      const out: { id: string; pack: string }[] = [];
      const count = Math.max(0, Math.floor(n));
      for (let i = 0; i < count; i++) {
        const mg = tryPickMinigame(packs, lucky);
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
    settleMinigamePayout(ranking: number[], coinWinners?: number[], pack?: string) {
      if (pack !== undefined) match.lastMinigamePack = pack;
      return awardMinigameResult(ranking, coinWinners);
    },
    effectsQuality() {
      return getEffectsQuality();
    },
    setEffectsQuality(quality: string) {
      return applyEffectsQuality(quality, false);
    },
    itemState() {
      return itemDebugSnapshot();
    },
    fundPlayer(playerId: number, coins: number) {
      return debugFund(playerId, coins);
    },
    giveStars(playerId: number, count: number) {
      return debugGiveStars(playerId, count);
    },
    placePlayer(playerId: number, space: number) {
      return debugPlace(playerId, space);
    },
    grantItem(playerId: number, key: string) {
      return grantItem(playerId, key);
    },
    buyItem(playerId: number, key: string) {
      return buyItem(playerId, key);
    },
    useHeldItem(playerId: number, key: string, targetId?: number) {
      return useItem(playerId, key, targetId);
    },
    pityPool(playerId: number) {
      return pityPool(playerId);
    },
    collectLuckyBlue(playerId: number) {
      return collectLuckyBlue(playerId);
    },
    takeLuckyPlayers() {
      return takeLuckyPlayers();
    },
    rapier() {
      return rapierStatus();
    },
    runContactScenario() {
      return runRapierContactScenario();
    },
    openMinigame(id: string) {
      void import("../screens/minigameScreen").then((mod) => mod.launchMinigame(id));
    },
    party() {
      return partyView();
    },
    partyAssist(on: boolean) {
      setPartyAssist(on);
    },
    partyDrop() {
      dropOut();
    },
  };
  (window as unknown as { __SSP__: SSPDebug }).__SSP__ = api;
  console.log("[SSP] debug API installed — window.__SSP__");
}

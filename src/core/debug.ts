/**
 * SUPER STAR PARTY — debug API. window.__SSP__ is the critic's window into
 * the RUNNING game: deep state snapshots, deterministic stepping, autoplay.
 * Must always exist, even with audio off. Never remove fields; add freely.
 */
import { match, snapshot, startMatch } from "./game";
import { rng } from "./rng";
import { bus, type SSPEventMap } from "./events";
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
import {
  STOCK_WEIGHTS,
  restockLog,
  shopSpaceList,
  shopVisitLog,
  type RestockLogEntry,
  type ShopVisitLogEntry,
} from "../game/shopStock";
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
import { seatLabels, youGrammar, type SeatLabel } from "../ui/labels";
import { readSeatTags, type SeatTagReading } from "../minigames/seatTags";

/** Same gate as framework.contactProbeLive (not imported: avoids a minigame-graph cycle). */
function seatTagsLive(): boolean {
  if (import.meta.env.DEV) return true;
  const flag = import.meta.env.VITE_SSP_TEST;
  return flag === "1" || flag === "true";
}
export interface SelectRect { x: number; y: number; w: number; h: number }
/** Pick a Hero layout as last drawn: screen boxes in CSS px. */
export interface SelectBounds {
  viewport: { w: number; h: number };
  hero: { selected: string; box: SelectRect | null };
  slot: SelectRect | null;
  cards: SelectRect[];
  settings: SelectRect | null;
  start: SelectRect | null;
  arrows: SelectRect[];
  plate: SelectRect | null;
}
let selectBoundsReader: (() => SelectBounds | null) | null = null;
/** Character select registers its reader on enter and clears it on exit. */
export function setSelectBoundsReader(fn: (() => SelectBounds | null) | null): void {
  selectBoundsReader = fn;
}
import { rapierStatus, runContactScenario as runRapierContactScenario } from "../physics/contact";
import { setOnlineMatch, setPartyAssist } from "../net/mode";
import { dropOut, partyView } from "../net/session";
import { activeBoard, activeBoardEntry, activeBoardId } from "../board/registry";
import { livelyDebug, livelyReact } from "../board/lively/landFx";
import { livelyShotsDebug } from "../board/lively/shots";
import { crowdDebug } from "../board/lively/crowd";
import type { nightDebug } from "../board/lively/night";
import { Color, Light, HemisphereLight, type Fog, type WebGLRenderer } from "three";

export interface SSPDebug {
  state(): Record<string, unknown>;
  goto(screen: string): void;
  advance(n?: number): void;
  autoplay(on: boolean): void;
  rollDice(face: number): void;
  seed(n: number): void;
  reset(): void;
  audioLevels(): { rms: number; peak: number };
  /**
   * Frame cost. `ms` is the last frame, `avgMs` the mean of the last 120.
   * `calls`/`triangles`/`points`/`lines` are renderer.info summed over every
   * render() in the last frame (shadow map, scene, post passes).
   */
  perf(): PerfSample;
  /** Gameplay rng draws since the last reseed (isolation probe). */
  rngDraws(): number;
  /**
   * Gameplay rng draw count captured synchronously at each turn:start,
   * minigame:start, and minigame:end of the current match, so two runs can
   * be compared draw-for-draw without frame-timing noise.
   */
  rngTurnLog(): RngMark[];
  /** Lively board counters and worst-case cost. Inactive with ?lively=0. */
  lively(): ReturnType<typeof livelyDebug>;
  /** Fire a lively reaction on a space ("hop" or a space type). False when lively is off. */
  livelyReact(space: number, kind: string): boolean;
  /** Lively camera shot counters (fired per trigger kind, dropped, stale...). */
  livelyShots(): ReturnType<typeof livelyShotsDebug>;
  /** Lively crowd reactions and worst-case cost. Inactive with ?lively=0. */
  livelyCrowd(): ReturnType<typeof crowdDebug>;
  /**
   * Lively time of day: phase, the applied hemi/key/fog/background, lamp
   * glow, the LAST 5 marquee, the fireworks chunk (imports, loaded) and the
   * night group's worst-case cost. Inactive with ?lively=0. Async: the
   * module rides in the board chunk, not the boot bundle.
   */
  livelyNight(): Promise<ReturnType<typeof nightDebug>>;
  /**
   * Probe aid: light the board as if it were `turn` (null: follow the match).
   * Cosmetic only; match.turn and every gameplay path are untouched.
   */
  livelyNightTurn(turn: number | null): Promise<ReturnType<typeof nightDebug>>;
  /** Top-level lights, fog, and background of the shared scene (rig comparisons). */
  sceneRig(): SceneRig;
  /**
   * Frame-stamped turn-loop beats: every turn:start, dice:roll, dice:land,
   * player:land, and match.phase change, with the frame index and summed
   * game time. With `?fixedstep=1` every frame is the same game dt, so two
   * runs of one seed can be compared frame for frame.
   */
  phaseLog(): PhaseMark[];
  /** Emit a bus event (probe aid for presentation listeners). */
  emit(event: string, payload: unknown): void;
  startMatch(kinds: string[], names?: string[]): void;
  /** Debug-only: jump to end-of-match (set phase='ended' for finale wiring). */
  endMatch(): void;
  resetWipeRotation(): void;
  /**
   * Open the Gumball Shop for `playerId` (default 0 = human) on demand for
   * visual inspection. Resolves when the player closes or buys. This is the
   * critic's deterministic entry point — the shop stays open indefinitely
   * (no auto-resolve) so it can be inspected. `shopSpace` picks whose
   * stock to show (default: the player's shop, else the first shop).
   */
  openShop(playerId?: number, shopSpace?: number): Promise<{ bought: string[] }>;
  /** Gumball stock now, every restock this match (with rng.draws around it), and CPU visits. */
  shopStock(): {
    round: number;
    stock: Record<string, string[]>;
    restockLog: RestockLogEntry[];
    visits: ShopVisitLogEntry[];
  };
  /** Stock weights [early, mid, late] per item key. */
  shopWeights(): Record<string, readonly [number, number, number]>;
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
  /** Dev/CI only: minigame seat tags as last positioned (empty in prod builds). */
  seatTags(): SeatTagReading[];
  /** Dev/CI only: seatLabels() for synthetic players Pip/Bounce/Glimmer/Tusk; controllers are L(ocal)/R(emote)/C(pu). */
  labelRules(controllers: string[], online?: boolean): { labels: SeatLabel[]; grammar: Record<string, string> } | null;
  /** Dev/CI only: Pick a Hero boxes (projected hero mesh, slot, cards, settings, START, arrows, plate); null elsewhere. */
  selectBounds(): SelectBounds | null;
  /** Open one minigame directly. Starts a match first when the board is empty. */
  openMinigame(id: string): void;
  /** Friends-room status. Offline until a room starts. */
  party(): ReturnType<typeof partyView>;
  /** The board the current match plays (match.boardId), for graph probes. */
  board(): {
    id: string;
    rev: number;
    size: number;
    startIndex: number;
    prizeSpots: number[];
    next: number[][];
    spaces: Array<{ index: number; type: string; name: string }>;
  };
  /** Playtest: local humans publish the CPU choice over the relay. */
  partyAssist(on: boolean): void;
  /** Leave the room. A guest's seat becomes a CPU. The host ends the room. */
  partyDrop(): void;
}

export interface PerfSample {
  fps: number;
  ms: number;
  avgMs: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

export interface SceneRig {
  lights: { type: string; name: string; color: string; ground: string | null; intensity: number; castShadow: boolean; position: number[] }[];
  fog: { type: string; color: string; near?: number; far?: number; density?: number } | null;
  background: string | null;
}

function sceneRig(): SceneRig {
  const scene = world.scene;
  if (!scene) return { lights: [], fog: null, background: null };
  const lights: SceneRig["lights"] = [];
  for (const c of scene.children) {
    if (!(c instanceof Light)) continue;
    lights.push({
      type: c.type,
      name: c.name,
      color: c.color.getHexString(),
      ground: c instanceof HemisphereLight ? c.groundColor.getHexString() : null,
      intensity: +c.intensity.toFixed(4),
      castShadow: c.castShadow,
      position: [c.position.x, c.position.y, c.position.z].map((v) => +v.toFixed(3)),
    });
  }
  // Flags, not instanceof: keeps FogExp2 out of the boot bundle.
  const f = scene.fog as (Fog & { isFogExp2?: boolean; density?: number }) | null;
  const fog = !f
    ? null
    : f.isFogExp2
      ? { type: "FogExp2", color: f.color.getHexString(), density: f.density }
      : { type: "Fog", color: f.color.getHexString(), near: f.near, far: f.far };
  const bg = scene.background instanceof Color ? scene.background.getHexString() : scene.background ? "non-color" : null;
  return { lights, fog, background: bg };
}

export interface RngMark {
  event: string;
  turn: number;
  draws: number;
}

export interface PhaseMark {
  frame: number;
  /** Summed game dt (s) since boot. */
  t: number;
  event: string;
  turn: number;
  player: number;
  phase: string;
}

const phaseMarks: PhaseMark[] = [];
const PHASE_MARKS_MAX = 5000;
let frameCount = 0;
let gameTime = 0;
let lastPhase = "";

function markPhase(event: string): void {
  if (phaseMarks.length >= PHASE_MARKS_MAX) return;
  phaseMarks.push({
    frame: frameCount,
    t: +gameTime.toFixed(4),
    event,
    turn: match.turn,
    player: match.currentPlayer,
    phase: match.phase,
  });
}

const rngMarks: RngMark[] = [];
const RNG_MARKS_MAX = 2000;

function markRng(event: string): void {
  // A reseed (new match) restarts the count; drop the old match's marks.
  const prev = rngMarks[rngMarks.length - 1];
  if (prev && rng.draws < prev.draws) rngMarks.length = 0;
  if (rngMarks.length >= RNG_MARKS_MAX) return;
  rngMarks.push({ event, turn: match.turn, draws: rng.draws });
}

let autoplayOn = false;
let fps = 0;
let frameMs = 0;
const FRAME_WINDOW = 120;
const frameRing = new Float32Array(FRAME_WINDOW);
let frameRingLen = 0;
let frameRingAt = 0;
let frameRingSum = 0;
const renderTally = { calls: 0, triangles: 0, points: 0, lines: 0 };
const lastRender = { calls: 0, triangles: 0, points: 0, lines: 0 };
let tallyRenderer: WebGLRenderer | null = null;
let tallyBanked = false;
let autoplayHook: (() => void) | null = null;

/** Turn loop registers its driver here (Wave 2). */
export function setAutoplayHook(fn: (() => void) | null): void {
  autoplayHook = fn;
}

/** Called by the main loop each frame. */
export function tickFrame(deltaMs: number, gameDt = 0): void {
  frameCount++;
  gameTime += gameDt;
  frameMs = deltaMs;
  fps = deltaMs > 0 ? 1000 / deltaMs : 60;
  if (frameRingLen === FRAME_WINDOW) frameRingSum -= frameRing[frameRingAt];
  else frameRingLen++;
  frameRing[frameRingAt] = deltaMs;
  frameRingSum += deltaMs;
  frameRingAt = (frameRingAt + 1) % FRAME_WINDOW;
}

/**
 * Sum renderer.info across every render() in a frame. Three resets info at
 * the start of each render() (autoReset stays on), so the reset is wrapped
 * to bank the previous render's numbers first. Rendering is unchanged.
 */
export function instrumentRenderer(renderer: WebGLRenderer): void {
  tallyRenderer = renderer;
  const info = renderer.info;
  const reset = info.reset.bind(info);
  info.reset = () => {
    // tickRender() already counted the render that ended the last frame.
    if (!tallyBanked) {
      renderTally.calls += info.render.calls;
      renderTally.triangles += info.render.triangles;
      renderTally.points += info.render.points;
      renderTally.lines += info.render.lines;
    }
    tallyBanked = false;
    reset();
  };
}

/** Called by the main loop after the frame's last render. */
export function tickRender(): void {
  if (match.phase !== lastPhase) {
    lastPhase = match.phase;
    markPhase(`phase:${match.phase}`);
  }
  if (!tallyRenderer) return;
  const r = tallyRenderer.info.render;
  lastRender.calls = renderTally.calls + (tallyBanked ? 0 : r.calls);
  lastRender.triangles = renderTally.triangles + (tallyBanked ? 0 : r.triangles);
  lastRender.points = renderTally.points + (tallyBanked ? 0 : r.points);
  lastRender.lines = renderTally.lines + (tallyBanked ? 0 : r.lines);
  renderTally.calls = 0;
  renderTally.triangles = 0;
  renderTally.points = 0;
  renderTally.lines = 0;
  tallyBanked = true;
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
        rngDraws: rng.draws,
        autoplay: autoplayOn,
        items: itemDebugSnapshot(),
        shop: {
          stock: JSON.parse(JSON.stringify(match.shopStock)) as Record<string, string[]>,
          round: match.shopStockRound,
          spaces: [...shopSpaceList()],
        },
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
      return {
        fps: Math.round(fps),
        ms: Math.round(frameMs),
        avgMs: frameRingLen ? +(frameRingSum / frameRingLen).toFixed(2) : 0,
        calls: lastRender.calls,
        triangles: lastRender.triangles,
        points: lastRender.points,
        lines: lastRender.lines,
      };
    },
    rngDraws() {
      return rng.draws;
    },
    rngTurnLog() {
      return rngMarks.map((m) => ({ ...m }));
    },
    lively() {
      return livelyDebug();
    },
    livelyReact(space: number, kind: string) {
      return livelyReact(space, kind);
    },
    livelyShots() {
      return livelyShotsDebug();
    },
    livelyCrowd() {
      return crowdDebug();
    },
    livelyNight() {
      return import("../board/lively/night").then((m) => m.nightDebug());
    },
    livelyNightTurn(turn: number | null) {
      return import("../board/lively/night").then((m) => {
        m.setNightTurnOverride(turn);
        return m.nightDebug();
      });
    },
    sceneRig() {
      return sceneRig();
    },
    phaseLog() {
      return phaseMarks.map((m) => ({ ...m }));
    },
    emit(event: string, payload: unknown) {
      bus.emit(event as keyof SSPEventMap, payload as never);
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
    openShop(playerId = 0, shopSpace?: number) {
      // Open the shop directly for inspection — no auto-resolve timer.
      return openShop(playerId, { shopSpace });
    },
    shopStock() {
      const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      return {
        round: match.shopStockRound,
        stock: copy(match.shopStock),
        restockLog: copy(restockLog),
        visits: copy(shopVisitLog),
      };
    },
    shopWeights() {
      return JSON.parse(JSON.stringify(STOCK_WEIGHTS)) as typeof STOCK_WEIGHTS;
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
    seatTags() {
      return seatTagsLive() ? readSeatTags() : [];
    },
    labelRules(controllers: string[], online = false) {
      if (!seatTagsLive()) return null;
      const names = ["Pip", "Bounce", "Glimmer", "Tusk"];
      const full: Record<string, string> = { L: "local", R: "remote", C: "cpu" };
      const players = controllers.map((c, id) => ({ id, name: names[id] ?? `P${id}`, controller: full[c] ?? c }));
      const grammar: Record<string, string> = {};
      for (const t of ["YOU WINS THE ROUND", "You's turn", "YOU IS NEXT", "YOU PASS"]) grammar[t] = youGrammar(t);
      return { labels: seatLabels(players, online), grammar };
    },
    selectBounds() {
      return seatTagsLive() && selectBoundsReader ? selectBoundsReader() : null;
    },
    openMinigame(id: string) {
      void import("../screens/minigameScreen").then((mod) => mod.launchMinigame(id));
    },
    party() {
      return partyView();
    },
    board() {
      const def = activeBoard();
      return {
        id: activeBoardId(),
        rev: activeBoardEntry().rev,
        size: def.spaces.length,
        startIndex: def.startIndex,
        prizeSpots: [...def.prizeSpots],
        next: def.next.map((row) => [...row]),
        spaces: def.spaces.map((sp) => ({ index: sp.index, type: sp.type, name: sp.name })),
      };
    },
    partyAssist(on: boolean) {
      setPartyAssist(on);
    },
    partyDrop() {
      dropOut();
    },
  };
  // Read-only listeners for rngTurnLog(). They never draw or write state.
  bus.on("match:start", () => markRng("match:start"));
  bus.on("turn:start", () => markRng("turn:start"));
  bus.on("minigame:start", () => markRng("minigame:start"));
  bus.on("minigame:end", () => markRng("minigame:end"));
  // Read-only listeners for phaseLog().
  // match:start also fires when the board returns from a minigame; only a
  // fresh match (turn 1) restarts the log.
  bus.on("match:start", () => {
    if (match.turn <= 1) phaseMarks.length = 0;
    markPhase("match:start");
  });
  for (const ev of ["turn:start", "dice:roll", "dice:land", "player:land", "minigame:start", "minigame:end"] as const) {
    bus.on(ev, () => markPhase(ev));
  }
  (window as unknown as { __SSP__: SSPDebug }).__SSP__ = api;
  console.log("[SSP] debug API installed — window.__SSP__");
}

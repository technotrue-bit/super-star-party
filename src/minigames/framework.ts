/**
 * SUPER STAR PARTY — minigame framework (Wave 3a).
 *
 * THE CONTRACT every minigame implements (read this before writing one):
 *
 *   interface Minigame {
 *     id: string;  name: string;  genre: MinigameGenre;
 *     howTo: string;         // one or two sentences: touch controls + how to win
 *     goal: string;          // one line shown in practice and the opening seconds
 *     tap: string | null;    // TAP verb (DASH, PUSH). Null hides a dead button
 *     steer: boolean;        // false hides the MOVE stick
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
 *     while the minigame is live. Contact arenas can also assign
 *     ctx.input.stick for the analog thumb stick (screen +x right, +y down).
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
import type { SeatController } from "../core/seat";
import { assertMinigameHowTos, registerMinigame, type MinigameEntry } from "./registry";
import { match } from "../core/game";
import { cpuSkillOf } from "../config/cpuLevel";
import { MINIGAME_MODULES } from "./index";

export type { MinigameEntry }; // pending-entry hand-off uses registry entries

/**
 * How sharp the computer players are this match (1 = the tuned Normal game,
 * above 1 faster and more accurate, below 1 slower). Minigames scale their
 * CPU tuning by this. It only reads the match, so it is the same on every
 * peer of an online room.
 */
export function cpuSkill(): number {
  return cpuSkillOf(match.cpuLevel ?? "normal");
}

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
  id: number;
  kind: string; // character key
  name: string;
  color: string;
  /** Who drives this seat. Local input belongs to "local" seats only. */
  controller: SeatController;
}

/** True when this seat is played on this device. */
export function isLocalPlayer(
  players: readonly Pick<MinigamePlayerInfo, "id" | "controller">[],
  playerId: number,
): boolean {
  for (const player of players) {
    if (player.id === playerId) return player.controller === "local";
  }
  return playerId === 0;
}

/** Index of the first local seat. Solo matches keep that at 0. */
export function localPlayerIndex(players: readonly Pick<MinigamePlayerInfo, "controller">[]): number {
  const index = players.findIndex((player) => player.controller === "local");
  return index >= 0 ? index : 0;
}

/**
 * Seats a minigame should drive itself. Autoplay adds the local seats
 * and keeps roster order, so the rng stream does not move.
 */
export function automatedSeatIds(
  players: readonly Pick<MinigamePlayerInfo, "id" | "controller">[],
  automateLocal: boolean,
): number[] {
  const ids: number[] = [];
  for (const player of players) {
    if (automateLocal || player.controller !== "local") ids.push(player.id);
  }
  return ids;
}

/** Thumb-stick deflection below this is no input. Full throw is about 1. */
export const STICK_DEADZONE = 0.15;

/**
 * Camera-relative ground direction from a thumb stick.
 * `x` is screen-right, `y` is screen-down, each about -1..1.
 * Returns a ground vector whose length is the stick magnitude (analog speed),
 * or null inside the deadzone. Does not draw from any rng.
 */
export function stickGround(
  camera: THREE.Camera,
  x: number,
  y: number,
): { x: number; z: number; mag: number } | null {
  const mag = Math.min(1, Math.hypot(x, y));
  if (mag < STICK_DEADZONE) return null;
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  // Camera matrix columns: X right, Y up, Z backward.
  let rx = e[0];
  let rz = e[2];
  let ux = e[4];
  let uz = e[6];
  const rl = Math.hypot(rx, rz);
  const ul = Math.hypot(ux, uz);
  if (rl < 1e-6 || ul < 1e-6) return null;
  rx /= rl;
  rz /= rl;
  ux /= ul;
  uz /= ul;
  // Screen up is -y on the stick.
  const wx = rx * x - ux * y;
  const wz = rz * x - uz * y;
  const len = Math.hypot(wx, wz);
  if (len < 1e-6) return null;
  const scale = mag / len;
  return { x: wx * scale, z: wz * scale, mag };
}

/**
 * Probe-only controls on `window.__SSP_CONTACT__`.
 * Dev and CI (`npm run dev`, or a build with VITE_SSP_TEST=1) honor it.
 * A production build ignores the object, so a page cannot park seats.
 * Absent during normal play, so the CPU branch and the rng stream stay as they are.
 */
interface ContactProbeHook {
  freezeCpu?: boolean;
  /** Taken on the next sim step, then cleared. */
  placeLocal?: { x: number; z: number } | null;
}

export { mountSeatTags, type SeatTags, type SeatTagSeat } from "./seatTags";

/** True when this build may honor the contact probe hook. */
export function contactProbeLive(): boolean {
  if (import.meta.env.DEV) return true;
  const flag = import.meta.env.VITE_SSP_TEST;
  return flag === "1" || flag === "true";
}

function contactHook(): ContactProbeHook | null {
  if (typeof window === "undefined" || !contactProbeLive()) return null;
  const hook = (window as unknown as { __SSP_CONTACT__?: ContactProbeHook }).__SSP_CONTACT__;
  return hook ?? null;
}

/**
 * Practice beat. The screen sets this while the local player tries the
 * controls. Sim steps must return before any rng draw, CPU choice, score,
 * knockout, or timer advance. Autoplay and online rooms never set it.
 */
let practiceBeat = false;

export function setPracticeBeat(on: boolean): void {
  practiceBeat = on;
}

export function isPracticeBeat(): boolean {
  return practiceBeat;
}

/** How long a contact dash stays at burst speed, then the wait before the next. */
export const DASH_BURST = 0.18;
export const DASH_COOLDOWN = 0.9;
/** Modest bump above a walk (bumper 4.5, coin grab 5). One short burst, then the cap returns. */
export const DASH_SPEED = 8.2;

let tapCd = 0;
let tapCdMax = 0;
/** True once a game ticks the TAP cooldown from its own fixed step. */
let tapSimClock = false;

export function armTapCooldown(seconds: number): void {
  const s = Math.max(0, seconds);
  tapCdMax = s;
  tapCd = s;
}

export function tapReady(): boolean {
  return tapCd <= 0;
}

/** 1 just fired, 0 ready. The TAP ring uses this. */
export function tapCooldownRatio(): number {
  if (tapCdMax <= 0 || tapCd <= 0) return 0;
  return tapCd / tapCdMax;
}

export function tickTapCooldown(dt: number): void {
  if (tapCd > 0) tapCd = Math.max(0, tapCd - dt);
}

/**
 * A game with a sim-time TAP cooldown calls this in setup, then calls
 * tickTapCooldown(FIXED_DT) once per fixed step. The screen then stops
 * ticking it during play, so the ring and gate follow the same clock as
 * the game's dash (dropped steps and a stalled sim hold the cooldown too).
 */
export function useSimTapClock(): void {
  tapSimClock = true;
}

export function tapClockIsSim(): boolean {
  return tapSimClock;
}

export function resetTapCooldown(): void {
  tapCd = 0;
  tapCdMax = 0;
  tapSimClock = false;
}

/**
 * Unit ground direction for a human dash.
 * Stick wins, then a pointer aim, then a held key, then the way the avatar faces.
 * No rng.
 */
export function dashDirection(
  camera: THREE.Camera,
  stickX: number,
  stickY: number,
  facingYaw: number,
  keyDir: { x: number; z: number } | null,
  pointerDir: { x: number; z: number } | null,
): { x: number; z: number } {
  const analog = stickGround(camera, stickX, stickY);
  const raw = analog
    ? { x: analog.x, z: analog.z }
    : pointerDir
      ? pointerDir
      : keyDir && (keyDir.x !== 0 || keyDir.z !== 0)
        ? keyDir
        : { x: Math.sin(facingYaw), z: Math.cos(facingYaw) };
  const len = Math.hypot(raw.x, raw.z);
  if (len < 1e-6) return { x: Math.sin(facingYaw), z: Math.cos(facingYaw) };
  return { x: raw.x / len, z: raw.z / len };
}

/** True only when a probe has asked CPU seats to hold still. */
export function contactCpuFrozen(): boolean {
  return contactHook()?.freezeCpu === true;
}

/** One-shot park for the local seat. Null when no probe has asked. */
export function takeContactPlace(): { x: number; z: number } | null {
  const hook = contactHook();
  const spot = hook?.placeLocal;
  if (!spot || typeof spot.x !== "number" || typeof spot.z !== "number") return null;
  hook.placeLocal = null;
  return { x: spot.x, z: spot.z };
}

/** Input entry points — minigames assign handlers in setup(). */
export interface MinigameInput {
  /**
   * Human pointer, screen coords normalized 0..1. Called once with
   * down=true when a finger/button goes DOWN (a real press), and once with
   * down=false when it lifts. Moving a held finger never calls this, so a
   * press is always one tap.
   */
  pointer(x: number, y: number, down: boolean): void;
  /** A held finger/button moved (drag steering). Optional. */
  drag?(x: number, y: number): void;
  /** Human keyboard action: 'up' | 'down' | 'left' | 'right' | 'confirm'. */
  key(action: string): void;
  /**
   * Analog thumb stick, fed every frame while it is held.
   * +x screen-right, +y screen-down, magnitude about 0..1.
   * Minigames that only listen for the 4-direction key actions can omit it.
   */
  stick?(x: number, y: number): void;
  /**
   * Hold-and-release pad (`pad: "hold"`). down=true when the press starts
   * (heldSec 0), down=false when it ends (heldSec = how long it was held,
   * capped at the game's holdMax, default 1.5 s).
   * A lost window or a cancelled touch also ends the hold with down=false.
   */
  hold?(down: boolean, heldSec: number): void;
  /**
   * Swipe pad (`pad: "swipe"`). (dx, dy) is the unit swipe direction in
   * screen space (+x right, +y down). power is screen speed / 3 screens per
   * second, clamped 0..1. On a keyboard, power is the Space hold / 1 s.
   */
  swipe?(dx: number, dy: number, power: number): void;
  /** Two-button pad (`pad: "twin"`). Called on every press and release of A or B. */
  button?(which: "a" | "b", down: boolean): void;
  /**
   * Dial pad (`pad: "dial"`). A turn since the last call, in radians
   * (positive is clockwise on screen). A keyboard sends one per frame at
   * 1.5 turns per second.
   */
  dial?(deltaRad: number): void;
  /**
   * Draw pad (`pad: "draw"`). One stroke is start, move..., end, in
   * normalized 0..1 screen coords. move is capped at 60 events per second.
   */
  draw?(phase: "start" | "move" | "end", x: number, y: number): void;
}

/**
 * Shared on-screen scoreboard: one chip per player across the top (name,
 * score, YOU outline) plus an optional countdown. Games feed it; the screen
 * draws it the same way in every game, shows the scores on the results card,
 * and uses them if a game ever has to be force-finished. Display only.
 */
export interface MinigameHud {
  /** Score (or any short text) for a player id, e.g. 12 or "3/5". */
  score(id: number, value: number | string): void;
  /** Small tag on a player's chip ("OUT", "SOLO", "TEAM A", "DONE"), null clears. */
  tag(id: number, text: string | null): void;
  /** Countdown: seconds left of `total`. Null hides it. */
  timer(remaining: number | null, total?: number): void;
  /** Word after scores on the results card ("pops", "pts", "pairs"). */
  unit(text: string): void;
}

/**
 * What the START card shows (and the board's mini-game card). Short lines;
 * a phone shows `touch`, a keyboard player sees `keys`.
 */
export interface MinigameRules {
  /**
   * "ffa" free-for-all, "1v3", "2v2", or "1v1" (a duel: two of the four
   * play, the other two watch; free play only, never dealt by the roulette).
   */
  format: "ffa" | "1v3" | "2v2" | "1v1";
  /** How long / how it ends: "30 seconds", "Race to the cake", "Last one standing". */
  length: string;
  /** How you win, one line. */
  win: string;
  /** Phone controls, one short line each ("Tap a balloon to pop it"). */
  touch: string[];
  /** Keyboard/mouse controls, one short line each ("Space: jump"). */
  keys: string[];
}

export interface MinigameContext {
  /** The 4 players. A local seat is this device's human; the rest are CPU or remote. */
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
  /** Shared scoreboard + countdown (see MinigameHud). */
  hud: MinigameHud;
}

/**
 * The on-screen control a minigame uses besides tap and the stick.
 * hold: press and hold, release to act. swipe: flick in a direction.
 * twin: two buttons, A and B. dial: turn a wheel. draw: trace with a finger.
 * Unset keeps the classic TAP button and MOVE stick.
 */
export type MinigamePad = "hold" | "swipe" | "twin" | "dial" | "draw";

export interface Minigame {
  id: string;
  name: string;
  genre: MinigameGenre;
  /** The control pad this game uses. Unset means the classic TAP and MOVE. */
  pad?: MinigamePad;
  /** Button words for the `twin` pad. */
  padLabels?: { a: string; b: string };
  /** Longest useful hold for the `hold` pad, in seconds. Default 1.5. */
  holdMax?: number;
  /**
   * Safety net: the screen force-finishes a round that is still running after
   * this many seconds of play. Default `settings.minigameTimeLimit` (30 s).
   * A game that runs longer sets it a little past its own clock.
   */
  timeLimit?: number;
  /**
   * Kept out of the MINIGAMES menu and the roulette. Reachable only by
   * `?minigame=<id>` (test rigs such as control_lab).
   */
  hidden?: boolean;
  /**
   * Shown on the START MINI GAME card. One or two short sentences:
   * how to touch, tap, or hold, and how to win. Required — a new game
   * does not typecheck without it, and registration refuses a blank one.
   */
  howTo: string;
  /**
   * One line during the practice beat and the first seconds of play.
   * The win condition, short enough to read while holding the phone.
   */
  goal: string;
  /**
   * Verb on the TAP button (DASH, PUSH, JUMP). Null hides the button
   * because TAP does nothing in this game.
   */
  tap: string | null;
  /** False hides the MOVE stick. The game never reads a direction. */
  steer: boolean;
  /** Seconds TAP must wait after a fire. 0 means mash. Omit for 0. */
  tapCooldown?: number;
  /** Sound for a practice TAP. A live round keeps the game's own sound. */
  tapSfx?: string;
  /**
   * False hides the TAP button on phones (the game is played by tapping the
   * world directly) while Space still does `tap` on a keyboard. Default true.
   */
  tapOnTouch?: boolean;
  /** Holding TAP re-fires every 140ms. Off by default: one press, one action. */
  tapRepeat?: boolean;
  /** The MOVE stick steps a cursor (grid games) instead of steering analog. */
  steerGrid?: boolean;
  /** START card content: format, length, win line, controls. */
  rules: MinigameRules;
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
    registerMinigame({ id: mg.id, name: mg.name, description: howTo, rules: mg.rules, hidden: mg.hidden, pad: mg.pad });
  }
  assertMinigameHowTos();
}

void registerAllMinigames();

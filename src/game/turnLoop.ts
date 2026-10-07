/**
 * SUPER STAR PARTY — turn loop: the match phase machine.
 *
 *   announce -> dice -> moving -> space-effect -> (next player)
 *            -> minigame-round -> ... -> results -> ended
 *
 * Owns ALL match-flow logic: dice (deterministic rng + forced-dice debug
 * hook), per-tile hop movement with the Funhouse Cut shortcut, space effects
 * (blue / red / Grand Prize Balloon / shop / green / grumpus), item use before rolling,
 * minigame-round gating, bonus stars and the final podium. Every beat plays
 * its SFX, the music intensity follows the phase, and bus events keep the
 * crowd reactions + debug API live.
 *
 * Determinism contract: every random decision goes through rng; the debug
 * API can force a face via window.__forcedDice (consumed once) and drive the
 * human's roll via the autoplay hook.
 */
import * as THREE from "three";
import { match } from "../core/game";
import { rng, ease } from "../core/rng";
import { settings } from "../config/settings";
import { palette } from "../config/palette";
import { bus } from "../core/events";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { setAutoplayHook, isAutoplay } from "../core/debug";
import { characterDice, characterColor } from "../characters/roster";
import type { BoardScene } from "../board/boardScene";
import { fizzyFairground } from "../board/boardData";
import type { Character } from "../characters/characterFactory";
import type { HudHandle } from "../ui/hud";
import type { ButtonHandle } from "../ui/button";
import type { PopupHandle } from "../ui/popup";
import { addCoins, tryBuyStars, sensibleStarCount, movePrizeBalloon, computeBonusStars, finalRanking, grantStamp, popMinigameBalloon, type BonusStarKind } from "./economy";
import { STAMP_LABEL } from "../core/game";
import { resolveGreen, resolveGrumpus, consumeFreeStar, consumeDoubleBlue } from "./happenings";
import { ITEM_DEFS, canUseItem, useItem } from "./items";
import { openShop } from "../screens/shopScreen";
import { tryPickMinigame } from "../minigames/registry";
import { setPendingMinigame } from "../minigames/framework";
import { getMinigameDescription, showMinigamePreview, skipNextMinigamePreScreen } from "../screens/minigameScreen";
import { screens } from "../screens/screenManager";
import { consumeTrap, resolveTrap, trapAt, payCircusToll, growTrees, ageCircuses } from "./traps";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Player 0 is the human; CPU players auto-roll. */
const HUMAN = 0;

/** Board constants (Fizzy Fairground). */
const N = fizzyFairground.spaces.length;
const SC = fizzyFairground.shortcut;
const JUNCTIONS = fizzyFairground.junctions ?? [];

function loopOf(space: number): number[] {
  return fizzyFairground.loops.find((loop) => loop.includes(space)) ?? fizzyFairground.loops[0];
}

/** Next space on the same lane, with the Funhouse Cut still applied. */
function stepOn(space: number): number {
  const loop = loopOf(space);
  const i = loop.indexOf(space);
  const next = loop[(i + 1) % loop.length];
  if (SC && next === SC.from) return SC.to;
  return next;
}

/** Per-player stand offsets on a shared space (MP7-style 2x2 grid). */
export const PLAYER_OFFSETS: ReadonlyArray<[number, number]> = [
  [0.0, 0.0],
  [0.6, 0.0],
  [0.0, 0.6],
  [0.6, 0.6],
];

const wrap = (i: number): number => ((i % N) + N) % N;

function bonusStarLabel(star: BonusStarKind): string {
  if (star === "mini") return "MINI STAR";
  if (star === "stamp") return "STAMP STAR";
  return "COIN STAR";
}

function bonusStarTag(star: BonusStarKind): string {
  if (star === "mini") return "★mini";
  if (star === "stamp") return "★stamp";
  return "★coin";
}

/** Fewest hops from `from` to the star, honouring junctions (BFS over the graph). */
function hopsToStar(from: number): number {
  const star = match.starBalloonPos;
  if (from === star) return 0;
  const seen = new Set<number>([from]);
  let frontier: number[] = [from];
  let d = 0;
  while (frontier.length > 0 && d < 200) {
    d += 1;
    const next: number[] = [];
    for (const s of frontier) {
      const cands = [stepOn(s)];
      const j = JUNCTIONS.find((jj) => jj.from === s);
      if (j) cands.push(j.to);
      for (const c of cands) {
        if (c === star) return d;
        if (!seen.has(c)) {
          seen.add(c);
          next.push(c);
        }
      }
    }
    frontier = next;
  }
  return 99;
}

export type LoopPhase =
  | "announce"
  | "dice"
  | "moving"
  | "space-effect"
  | "minigame-round"
  | "results"
  | "ended";

/* ------------------------------------------------------------------ */
/*  Public contracts                                                   */
/* ------------------------------------------------------------------ */

/** The big DOM die — owned by the board screen, driven by the loop. */
export interface DiceView {
  show(): void;
  hide(): void;
  tumble(): void;
  setFace(face: number): void;
  /** Show the die floating above the given player, slowly spinning while waiting for ROLL. */
  hover(pid: number): void;
}



export interface TurnLoop {
  start(): void;
  update(dt: number): void;
  /** ROLL button / autoplay hook entry. */
  rollPressed(): void;
  /** True when the human is expected to press ROLL right now. */
  isWaitingForRoll(): boolean;
  readonly phase: LoopPhase;
  dispose(): void;
}

/**
 * Presentation hooks for the staged ceremonies (star buy, red-space sting,
 * Grumpus gag). Each fires callbacks at fixed delays so the board screen can
 * drive camera, shake, overlay flashes, sparkles — all presentation-only,
 * zero gameplay-rng draws.
 */
export interface CeremonyDeps {
  /** Camera push toward a target world position, eased over ~0.6s. */
  focusCamera(target: THREE.Vector3, intensity: number): void;
  /** World pos -> CSS pixel coords (confetti / sparkles at a space). */
  projectToScreen(pos: THREE.Vector3): { x: number; y: number } | null;
  /** Quick full-screen color flash (red sting / Grumpus lava). */
  flashOverlay(color: string): void;
  /** Screen shake: amp in px, decays over ~duration. */
  shakeScreen(amp: number, duration: number): void;
  /** Sparkle burst at a screen position (purely cosmetic). */
  sparkle(x: number, y: number, count: number, color: string): void;
  /** Launch a 3D star that arcs from startPos to endPos with a sparkle trail. */
  starTravel(startPos: THREE.Vector3, endPos: THREE.Vector3, duration: number): void;
  /** Gold vignette pulse for background reaction (MP7 ceremony spectacle). */
  vignettePulse(color: string, intensity: number, duration: number): void;
  /** Lock camera to a sustained closer position for cinematic moments. */
  holdCamera(pos: THREE.Vector3, look: THREE.Vector3, fov: number): void;
  /** Restore the camera to its default position after a holdCamera. */
  releaseCamera(): void;
}

export interface TurnLoopDeps {
  board: BoardScene;
  /** Characters by player id (index === player id). */
  chars: Character[];
  hud: HudHandle;
  rollButton: ButtonHandle;
  dice: DiceView;
  /** Container the loop fills with pre-roll item buttons. */
  itemBar: HTMLElement;
  /** Punch the party camera toward a world position (roll moment). */
  punchCamera(target: THREE.Vector3): void;
  /** Presentation ceremony hooks (camera, shake, sparkles). */
  ceremony: CeremonyDeps;
  /** World pos -> CSS pixel coords (confetti at a space). */
  projectToScreen(pos: THREE.Vector3): { x: number; y: number } | null;
  /** Quick full-screen color flash (Grumpus lava). */
  flashOverlay(color: string): void;
}

/* ------------------------------------------------------------------ */
/*  Autoplay hook (drives the human's roll)                            */
/* ------------------------------------------------------------------ */

let liveLoop: TurnLoop | null = null;

/**
 * Set right before handing off to the minigame screen (a minigame round is
 * in flight and the loop is about to be disposed). The NEXT loop instance —
 * created when the board screen re-enters after the minigame — checks this
 * in start() to continue the round's bookkeeping (results vs next turn)
 * instead of beginning a fresh turn.
 */
let resumeFromMinigame = false;

setAutoplayHook(() => {
  const l = liveLoop;
  if (l && l.isWaitingForRoll() && match.currentPlayer === HUMAN) l.rollPressed();
});

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createTurnLoop(deps: TurnLoopDeps): TurnLoop {
  const { board, chars, hud, rollButton, dice, itemBar, punchCamera, ceremony, projectToScreen, flashOverlay } = deps;

  interface LoopState {
    phase: LoopPhase;
    disposed: boolean;
    // generic pause chain
    pauseT: number;
    pauseFn: (() => void) | null;
    // dice
    diceFaces: number[];
    rollsNeeded: number;
    rolling: boolean;
    diceT: number;
    betweenRolls: number;
    cpuTimer: number;
    // movement
    moveQueue: number[];
    moveIdx: number;
    hopFrom: number;
    hopTo: number;
    hopT: number;
    hopActive: boolean;
    afterMove: "effect" | "done";
    moveFromOverride: number | null;
    // blocking UI
    shopOpen: boolean;
    starPopup: PopupHandle | null;
    // star ceremony state machine
    starCeremony: boolean;
    starCeremonyT: number;
    starCeremonyPid: number;
    starCeremonyStepped0: boolean;
    starCeremonyStepped1: boolean;
    starCeremonyStepped2: boolean;
    starCeremonyStepped3: boolean;
    starCeremonyStepped4: boolean;
    starCeremonyStepped5: boolean;
    starCeremonyStepped6: boolean;
    starCeremonyCount: number;
    starCeremonyThen: (() => void) | null;
    /** If autoplay flips on while the human bundle popup is up, buy this. */
    starAutoCommit: (() => void) | null;
    // results
    resultSteps: Array<() => void>;
    resultTimer: number;
    /** Set when a player passes a Mini Circus. Tolls 1 coin per later land. */
    circusToll: { ownerId: number; turnsLeft: number } | null;
  }

  const S: LoopState = {
    phase: "ended",
    disposed: false,
    pauseT: 0,
    pauseFn: null,
    diceFaces: [],
    rollsNeeded: 1,
    rolling: false,
    diceT: 0,
    betweenRolls: 0,
    cpuTimer: 0,
    moveQueue: [],
    moveIdx: 0,
    hopFrom: 0,
    hopTo: 0,
    hopT: 0,
    hopActive: false,
    afterMove: "effect",
    moveFromOverride: null,
    shopOpen: false,
    starPopup: null,
    starCeremony: false,
    starCeremonyT: 0,
    starCeremonyPid: 0,
    starCeremonyStepped0: false,
    starCeremonyStepped1: false,
    starCeremonyStepped2: false,
    starCeremonyStepped3: false,
    starCeremonyStepped4: false,
    starCeremonyStepped5: false,
    starCeremonyStepped6: false,
    starCeremonyCount: 1,
    starCeremonyThen: null,
    starAutoCommit: null,
    resultSteps: [],
    resultTimer: 0,
    circusToll: null,
  };

  let stingerTO: number | null = null;

  /* ---------------- helpers ---------------- */

  const pause = (seconds: number, fn: () => void): void => {
    S.pauseT = seconds;
    S.pauseFn = fn;
  };

  const boardIntensity = (): number => (S.phase === "moving" ? 0.65 : 0.5);

  /** One-shot music stinger that restores the board track. */
  const stinger = (track: string, ms: number, duckTo = 0.316): void => {
    const stopFn = audio.music.stinger(track, { duckTo, duckAttack: 0.08, duckRelease: 0.5 });
    if (stingerTO !== null) window.clearTimeout(stingerTO);
    stingerTO = window.setTimeout(() => {
      stingerTO = null;
      if (!S.disposed && S.phase !== "results" && S.phase !== "ended") {
        // Stop the looping stinger (non-looping ones auto-ended) and
        // restore the board track at full level.
        if (stopFn) stopFn();
        audio.music.play("board", { intensity: boardIntensity() });
      }
    }, ms);
  };

  const refreshHud = (): void => {
    hud.update(
      match.players.map((p) => ({
        id: p.id,
        kind: p.kind,
        name: p.name,
        coins: p.coins,
        stars: p.stars,
        minigameWins: p.minigameWins,
        stamps: p.stamps,
        active: S.phase !== "results" && S.phase !== "ended" && p.id === match.currentPlayer,
        color: characterColor(p.kind),
      }))
    );
  };

  const charPos = (pid: number): THREE.Vector3 => {
    const off = PLAYER_OFFSETS[pid] ?? [0, 0];
    const v = board.spaceWorldPos(match.players[pid]?.space ?? 0);
    v.x += off[0];
    v.z += off[1];
    return v;
  };

  const placeCharAt = (pid: number, space: number): void => {
    const ch = chars[pid];
    if (!ch) return;
    const off = PLAYER_OFFSETS[pid] ?? [0, 0];
    const v = board.spaceWorldPos(space);
    ch.group.position.set(v.x + off[0], 0, v.z + off[1]);
  };

  /** Snap every character mesh to its match-state space (teleports/swaps). */
  const syncCharPositions = (): void => {
    for (let i = 0; i < chars.length; i++) placeCharAt(i, match.players[i]?.space ?? 0);
  };

  /* ---------------- phase transitions ---------------- */

  const beginTurn = (): void => {
    S.phase = "announce";
    match.phase = "dice";
    const pid = match.currentPlayer;
    const player = match.players[pid];
    if (!player) return;
    bus.emit("turn:start", { turn: match.turn, player: pid });
    audio.sfx.play("whistle");
    board.clearHighlights();
    board.setHighlight(player.space, true);
    refreshHud();
    hud.showBanner(`TURN ${match.turn}`, { durationMs: 900 });
    pause(0.95, () => {
      hud.showBanner(`${player.name}'S TURN!`, { durationMs: 1150 });
      pause(0.75, beginDice);
    });
  };

  const beginDice = (): void => {
    S.phase = "dice";
    match.phase = "dice";
    audio.music.intensity(0.5);
    const pid = match.currentPlayer;
    S.diceFaces = [];
    S.rollsNeeded = 1;
    S.rolling = false;
    S.betweenRolls = 0;
    // Die appears floating above the current player's token, slowly spinning
    // until the player (or CPU timer) presses ROLL.
    dice.hover(pid);
    rebuildItemBar(pid);
    rollButton.setVisible(true);
    if (pid === HUMAN) {
      rollButton.setEnabled(true);
      S.cpuTimer = 0;
    } else {
      rollButton.setEnabled(false);
      S.cpuTimer = 0.9 + rng.next() * 0.6;
    }
  };

  const startMoving = (queued: number[], after: "effect" | "done", total = 0): void => {
    const pid = match.currentPlayer;
    const player = match.players[pid];
    if (!player) return;
    S.phase = "moving";
    match.phase = "moving";
    audio.music.intensity(0.65);
    S.afterMove = after;
    S.moveQueue = [];
    S.moveIdx = 0;
    if (queued.length > 0) {
      for (const t of queued) S.moveQueue.push(wrap(t));
    } else {
      // Standing ON a junction: the first hop is a lane choice, not automatic.
      const standing = JUNCTIONS.find((j) => j.from === player.space);
      if (standing && total > 0) {
        offerJunction(pid, total, after);
        return;
      }
      let cur = player.space;
      for (let i = 0; i < total; i++) {
        const nxt = stepOn(cur);
        S.moveQueue.push(nxt);
        cur = nxt;
        if (JUNCTIONS.some((j) => j.from === nxt) && i < total - 1) break;
      }
    }
    if (S.moveQueue.length === 0) {
      if (after === "effect") enterSpaceEffect(pid);
      else finishTurn();
      return;
    }
    startHop(pid);
  };

  const startHop = (pid: number): void => {
    const q = S.moveQueue;
    if (S.moveIdx >= q.length) return;
    const player = match.players[pid];
    const from = S.moveIdx === 0 ? (S.moveFromOverride ?? player.space) : S.hopTo;
    S.moveFromOverride = null;
    S.hopFrom = from;
    S.hopTo = q[S.moveIdx];
    S.moveIdx += 1;
    S.hopT = 0;
    S.hopActive = true;
    const ch = chars[pid];
    ch.anim.walk();
    const a = board.spacePos(S.hopFrom);
    const b = board.spacePos(S.hopTo);
    ch.setFacing(Math.atan2(b.x - a.x, b.z - a.z));
    audio.sfx.play("hop", { volume: 0.7 });
    bus.emit("player:move", { player: pid, from: S.hopFrom, to: S.hopTo });
    if (SC && S.hopTo === SC.to && wrap(S.hopFrom + 1) === SC.from) {
      audio.sfx.play("whoosh");
      ui.toast("Funhouse Cut!", { durationMs: 1500 });
    }
  };

  const offerJunction = (pid: number, hopsLeft = 0, after: "effect" | "done" = "effect"): void => {
    const here = match.players[pid]?.space ?? 0;
    const branch = JUNCTIONS.find((j) => j.from === here);
    if (!branch || hopsLeft <= 0) {
      finishTurn();
      return;
    }
    const stay = stepOn(here);
    const pick = (to: number): void => {
      startMoving([to], after, 0);
      if (hopsLeft > 1) {
        const rest: number[] = [];
        let cur = to;
        for (let i = 1; i < hopsLeft; i++) {
          cur = stepOn(cur);
          rest.push(cur);
        }
        S.moveQueue.push(...rest);
      }
    };
    if (pid !== HUMAN || isAutoplay()) {
      pick(hopsToStar(branch.to) < hopsToStar(stay) ? branch.to : stay);
      return;
    }
    const content = document.createElement("div");
    content.style.cssText = "display:flex;flex-direction:column;gap:10px;";
    const pop = ui.popup({
      title: "WHICH LANE?",
      body: branch.label,
      content,
      closeOnEsc: false,
      sound: null,
      buttons: [
        { label: "STAY", kind: "ghost", onClick: () => { pop.destroy(); pick(stay); } },
        { label: "BRANCH", kind: "gold", onClick: () => { pop.destroy(); pick(branch.to); } },
      ],
    });
  };

  /**
   * Stamp spaces and minigame balloons resolve the moment a hop arrives,
   * whether the player is passing through or landing. Other space types
   * still resolve only on the final tile.
   * Returns true when this space was one of those two.
   */
  const arriveCarnival = (pid: number, space: number, landed: boolean): boolean => {
    const sp = fizzyFairground.spaces[wrap(space)];
    if (!sp) return false;
    if (sp.type === "stamp" && sp.stamp) {
      const label = STAMP_LABEL[sp.stamp];
      const res = grantStamp(pid, sp.stamp);
      if (res.jackpot) {
        hud.showBanner(`CARNIVAL JACKPOT! +${settings.stampJackpot}`, { durationMs: 1600 });
        if (landed) chars[pid]?.anim.cheer();
      } else if (res.added) {
        hud.showBanner(`${label.toUpperCase()} STAMP!`, { durationMs: 1200 });
        audio.sfx.play("pop", { pitch: 3 });
      } else {
        ui.toast(`Already stamped: ${label}`, { durationMs: 1000 });
      }
      refreshHud();
      return true;
    }
    if (sp.type === "minigame_balloon") {
      const listed = sp.balloonCoins === 10 ? 10 : 5;
      const paid = popMinigameBalloon(pid, listed);
      hud.showBanner(
        paid > 0 ? `BALLOON −${paid}! MINIGAME SET` : "BALLOON POP! MINIGAME SET",
        { durationMs: 1300 }
      );
      if (landed) chars[pid]?.anim.cheer();
      refreshHud();
      return true;
    }
    return false;
  };

  const enterSpaceEffect = (pid: number): void => {
    S.phase = "space-effect";
    match.phase = "space-effect";
    audio.music.intensity(0.5);
    const player = match.players[pid];
    if (!player) {
      finishTurn();
      return;
    }
    const type = board.spaceType(player.space);
    const pos = board.spaceWorldPos(player.space);
    const onPrize = player.space === match.starBalloonPos;
    const trap = trapAt(player.space);
    if (trap) {
      if (trap.kind === "circus" && trap.ownerId !== pid) {
        S.circusToll = { ownerId: trap.ownerId, turnsLeft: trap.turnsLeft ?? 3 };
        hud.showBanner("Circus toll! 1 coin a space.", { durationMs: 1400 });
      } else if (trap.kind === "tree" && trap.ownerId === pid && (trap.grown ?? 0) > 0) {
        const result = resolveTrap(pid, trap);
        consumeTrap(player.space);
        hud.showBanner(result.message, { durationMs: 1600 });
        refreshHud();
      } else if (trap.kind !== "tree" && trap.kind !== "circus" && trap.ownerId !== pid) {
        const result = resolveTrap(pid, trap);
        consumeTrap(player.space);
        hud.showBanner(result.message, { durationMs: 1600 });
        if (result.swapped) {
          const owner = match.players[trap.ownerId];
          const victim = match.players[pid];
          if (owner && victim) {
            const op = board.spaceWorldPos(owner.space);
            const vp = board.spaceWorldPos(victim.space);
            chars[trap.ownerId]?.group.position.set(op.x, 0, op.z);
            chars[pid]?.group.position.set(vp.x, 0, vp.z);
          }
        }
        refreshHud();
      }
    }
    if (S.circusToll && S.circusToll.ownerId !== pid) {
      if (payCircusToll(pid, S.circusToll.ownerId)) refreshHud();
    }
    // Stamps and minigame balloons resolve before the prize balloon so a
    // Carnival Jackpot paid on this tile is in hand for the star bundle.
    if (type === "stamp" || type === "minigame_balloon") {
      arriveCarnival(pid, player.space, true);
    }
    const afterPrize = (): void => {
      landRemainder(pid, type, pos);
    };
    if (onPrize) {
      offerPrizeBalloon(pid, afterPrize);
      return;
    }
    afterPrize();
  };

  /**
   * Space effect that is not the Grand Prize Balloon. Stamp and minigame
   * balloon tiles are already resolved by the caller.
   */
  const landRemainder = (pid: number, type: string, pos: THREE.Vector3): void => {
    switch (type) {
      case "blue": {
        let gained = settings.blueCoin;
        addCoins(pid, gained);
        if (consumeDoubleBlue(pid)) {
          addCoins(pid, gained);
          gained *= 2;
        }
        hud.showBanner(`+${gained} COINS!`, { durationMs: 1400 });
        const sc = projectToScreen(pos);
        if (sc) ui.confettiBurst(sc.x, sc.y, { count: 36, sound: null });
        break;
      }
      case "red": {
        addCoins(pid, -settings.redCoin);
        // Real sting: camera punch toward the victim, screen shake, red flash,
        // punchy banner, ouch sfx, and a comedic trombone-fall stinger on the
        // lose track (MP7-style: losing coins hard is a comedy beat).
        // Presentation-only — the economy change (the only gameplay effect)
        // is the single addCoins call above.
        const rp = charPos(pid);
        ceremony.focusCamera(rp, 0.25);
        ceremony.shakeScreen(7, 0.35);
        ceremony.flashOverlay("rgba(255,90,60,0.30)");
        hud.showBanner(`-${settings.redCoin}!`, { durationMs: 1500 });
        chars[pid]?.anim.sad();
        audio.sfx.play("coin.lose", { volume: 0.9 });
        audio.music.stinger("lose", { duckTo: 0.316, duckAttack: 0.04, duckRelease: 0.6 });
        const rp2 = ceremony.projectToScreen(rp);
        if (rp2) {
          ceremony.sparkle(rp2.x, rp2.y - 20, 8, palette.lava);
        }
        break;
      }
      case "shop": {
        shopSpace(pid);
        return; // async
      }
      case "green": {
        happeningSpace(pid, "green");
        return; // may move
      }
      case "grumpus": {
        happeningSpace(pid, "grumpus");
        return; // may move
      }
      case "stamp":
      case "minigame_balloon":
      case "star":
        break;
      default:
        break;
    }
    finishEffect();
  };

  const finishEffect = (): void => {
    refreshHud();
    pause(0.9, nextTurn);
  };

  const finishTurn = (): void => {
    S.phase = "space-effect";
    match.phase = "space-effect";
    pause(0.9, nextTurn);
  };

  const nextTurn = (): void => {
    if (match.players.length === 0) return;

    const order = match.turnOrder.length === match.players.length ? match.turnOrder : [0,1,2,3];
    const idx = order.indexOf(match.currentPlayer);
    const nextIdx = (idx + 1) % order.length;
    match.currentPlayer = order[nextIdx];

    // After a full lap of the turn order, do the minigame round
    if (nextIdx === 0) {
      minigameRound();
    } else {
      beginTurn();
    }
  };

  /* ---------------- dice ---------------- */

  const rollPressed = (): void => {
    if (S.disposed || S.phase !== "dice" || S.rolling || S.betweenRolls > 0 || S.shopOpen) return;
    const pid = match.currentPlayer;
    const player = match.players[pid];
    if (!player) return;
    const w = window as unknown as { __forcedDice?: number };
    let face: number;
    if (typeof w.__forcedDice === "number" && Number.isFinite(w.__forcedDice)) {
      face = Math.max(1, Math.min(6, Math.round(w.__forcedDice)));
      delete w.__forcedDice; // consume the forced face — once
    } else {
      face = rng.pick(characterDice(player.kind));
    }
    S.diceFaces.push(face);
    S.rolling = true;
    S.diceT = settings.diceSuspense;
    // Position (or re-position) the die above the player so the "roll on the board"
    // animation starts from the floating hover spot.
    dice.hover(pid);
    dice.tumble();
    audio.sfx.play("dice.roll");
    bus.emit("dice:roll", { player: pid, face });
    punchCamera(charPos(pid));
    rollButton.setEnabled(false);
  };

  const diceLand = (): void => {
    const pid = match.currentPlayer;
    const face = S.diceFaces[S.diceFaces.length - 1];
    dice.setFace(face);
    audio.sfx.play("dice.land");
    bus.emit("dice:land", { player: pid, face });
    hud.showBanner(`${match.players[pid].name} rolled ${face}!`, { durationMs: 1300 });
    S.rolling = false;
    if (S.diceFaces.length < S.rollsNeeded) {
      S.betweenRolls = 0.85;
      if (pid === HUMAN) rollButton.setEnabled(true);
    } else {
      match.lastDice = [...S.diceFaces];
      const total = S.diceFaces.reduce((s, f) => s + f, 0);
      // Lock the roll through the post-land pause so the autoplay hook can't
      // fire a phantom second roll (rng + bus determinism).
      S.rolling = true;
      pause(1.0, () => {
        S.rolling = false;
        if (!(window as any).__SSP_HOLD_DIE) { dice.hide(); startMoving([], "effect", total); }
      });
    }
  };

  /* ---------------- items (pre-roll) ---------------- */

  const rebuildItemBar = (pid: number): void => {
    itemBar.innerHTML = "";
    if (pid !== HUMAN) return;
    const keys = Array.from(new Set(match.players[pid]?.items ?? []));
    for (const key of keys) {
      if (!canUseItem(pid, key)) continue;
      const def = ITEM_DEFS[key];
      const btn = ui.button({
        label: `${def.icon} ${def.name}`,
        kind: "primary",
        size: "sm",
        sound: "ui.click",
      });
      btn.el.addEventListener("click", () => useItemPressed(pid, key));
      itemBar.appendChild(btn.el);
    }
  };

  const useItemPressed = (pid: number, key: string): void => {
    if (S.phase !== "dice" || S.rolling) return;
    const res = useItem(pid, key);
    ui.toast(res.message, { durationMs: 2200 });
    audio.sfx.play("boing");
    refreshHud();
    if (res.extraDice) {
      S.rollsNeeded = 2;
      rebuildItemBar(pid);
    } else if (res.moveTo !== undefined) {
      dice.hide();
      rollButton.setEnabled(false);
      itemBar.innerHTML = "";
      pause(0.35, () => startMoving([res.moveTo as number], "done"));
    } else {
      rebuildItemBar(pid);
    }
  };

  /* ---------------- space effects ---------------- */

  /* ---------------- staged ceremonies (presentation only) ---------------- */
  /*
   * MP7-style "star moment": the board's biggest beat. Timeline (3.2s):
   *   0.0  Fanfare stinger fires, star space lights up, camera pushes to buyer.
   *   0.3  Space sparkles, STAR! banner slams in.
   *   0.6  Character cheer pose + confetti burst at the space.
   *   1.0  Second sparkle wave.
   *   1.5  Coin counter ticks, fanfare resolves.
   *   2.0  Star count HUD pops, confetti finale.
   *   3.0  Resume turn flow.
   *
   * Determinism: ceremony draws nothing from gameplay rng. Randomness for
   * sparkles uses a fixed-seed mulberry32 (same as resultsCeremony).
   */

  const presRng = (() => {
    let a = 0x5eed42 >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  const STAR_CEREMONY_DUR = 3.8;

  const celebrateStar = (pid: number, count: number, then: () => void): void => {
    S.starCeremony = true;
    S.starCeremonyT = 0;
    S.starCeremonyPid = pid;
    S.starCeremonyCount = count;
    S.starCeremonyThen = then;
    S.starCeremonyStepped0 = false;
    S.starCeremonyStepped1 = false;
    S.starCeremonyStepped2 = false;
    S.starCeremonyStepped3 = false;
    S.starCeremonyStepped4 = false;
    S.starCeremonyStepped5 = false;
    S.starCeremonyStepped6 = false;
    stinger("star_fanfare", 4500);
    // Camera commits to the STAR SPACE first — the ceremony's anchor
    // (MP7: the camera locks onto the star, then follows it to the buyer).
    const spaceIdx = match.players[pid]?.space ?? 0;
    const starPos = board.spaceWorldPos(spaceIdx);
    // Camera commits to the STAR SPACE — closer, tighter framing so the
    // 3D star arc and player reactions are visible (MP7: camera locks on star).
    const buyerPos = charPos(pid);
    const midPoint = starPos.clone().lerp(buyerPos, 0.5);
    ceremony.holdCamera(
      starPos.clone().setY(12).add(new THREE.Vector3(0, 0, 14)),
      midPoint,
      42
    );
    ceremony.focusCamera(starPos, 0.45);
    // Background reaction: gold vignette pulse swells under the fanfare.
    ceremony.vignettePulse(palette.sun, 0.45, 3.6);
    // The star physically travels from its space to the buying player's token.
    ceremony.starTravel(starPos, buyerPos, 1.6);
    (globalThis as any).__SSP_STAR_CEREMONY = { active: true, pid, t: 0 };
  };

  /** Star ceremony update driven from the main update() while starCeremony is set. */
  const updateStarCeremony = (dt: number): void => {
    S.starCeremonyT += dt;
    const t = S.starCeremonyT;
    const pid = S.starCeremonyPid;
    const spaceIdx = match.players[pid]?.space ?? 0;
    const pos = board.spaceWorldPos(spaceIdx);
    (globalThis as any).__SSP_STAR_CEREMONY = { active: true, pid, t: Math.round(t * 100) / 100 };

    // t=0.05: star materializes, lift-off SFX, space disk pulses (physical change)
    if (t >= 0.05 && !S.starCeremonyStepped0) {
      S.starCeremonyStepped0 = true;
      audio.sfx.play("star.get", { volume: 1.0 });
      board.highlight(spaceIdx);
    }
    // t=0.25: STAR! banner slams in (gold, large), cheer pose, confetti + sparkle at the space
    if (t >= 0.25 && !S.starCeremonyStepped1) {
      S.starCeremonyStepped1 = true;
      const sc = ceremony.projectToScreen(pos);
      if (sc) {
        ceremony.sparkle(sc.x, sc.y, 30 + Math.floor(presRng() * 10), palette.sun);
        ui.confettiBurst(sc.x, sc.y, { count: 80 + Math.floor(presRng() * 20), sound: null });
      }
      // HUD star count ticks 0 -> 1.
      refreshHud();
      // Gold banner: clear any active turn banner first so the ceremony owns the screen.
      // clear() starts the CSS exit fade (~120ms) which would briefly overlap with the
      // gold banner — violating the 1-banner rule. Force-remove exiting elements instead.
      ui.clearFeedback();
      document.querySelectorAll(".ssp-fb-banner").forEach(function(el) {
        if ((el as HTMLElement).classList.contains("ssp-fb-banner--out"))
          (el as HTMLElement).remove();
      });
      const count = S.starCeremonyCount;
      const label = count === 1 ? "★ STAR! ★" : `★ ${count} STARS! ★`;
      ui.queue.banner(label, { durationMs: 2000, style: "gold", priority: "critical" });
      chars[pid]?.anim.cheer();
    }
    // t=0.6: crowd cheer, sparkle at the buyer as the star arcs past
    if (t >= 0.6 && !S.starCeremonyStepped2) {
      S.starCeremonyStepped2 = true;
      const sc = ceremony.projectToScreen(charPos(pid));
      if (sc) ceremony.sparkle(sc.x, sc.y - 20, 24 + Math.floor(presRng() * 8), palette.sun);
      audio.sfx.play("crowd.cheer", { volume: 0.6 });
    }
    // t=1.0: mid-travel sparkle wave back at the star space
    if (t >= 1.0 && !S.starCeremonyStepped3) {
      S.starCeremonyStepped3 = true;
      const sc = ceremony.projectToScreen(pos);
      if (sc) ceremony.sparkle(sc.x, sc.y, 20 + Math.floor(presRng() * 6), palette.candy);
    }
    // t=1.6: star ARRIVES at the buyer — big burst, camera punch to buyer
    if (t >= 1.6 && !S.starCeremonyStepped4) {
      S.starCeremonyStepped4 = true;
      const buyerSc = ceremony.projectToScreen(charPos(pid));
      if (buyerSc) {
        ceremony.sparkle(buyerSc.x, buyerSc.y, 50 + Math.floor(presRng() * 10), palette.sun);
        ui.confettiBurst(buyerSc.x, buyerSc.y, { count: 100 + Math.floor(presRng() * 20), sound: null });
      }
      audio.sfx.play("star.get", { volume: 1.0 });
      // Camera commits to the buyer as the star lands in their hands.
      ceremony.focusCamera(charPos(pid), 0.3);
    }
    // t=2.2: second confetti wave at the buyer
    if (t >= 2.2 && !S.starCeremonyStepped5) {
      S.starCeremonyStepped5 = true;
      const buyerSc = ceremony.projectToScreen(charPos(pid));
      if (buyerSc) {
        ceremony.sparkle(buyerSc.x, buyerSc.y - 20, 30 + Math.floor(presRng() * 8), palette.sun);
        ui.confettiBurst(buyerSc.x, buyerSc.y, { count: 60 + Math.floor(presRng() * 10), sound: null });
      }
    }
    // t=3.0: final resolve — sparkle at the space, character returns to idle
    if (t >= 3.0 && !S.starCeremonyStepped6) {
      S.starCeremonyStepped6 = true;
      const sc = ceremony.projectToScreen(pos);
      if (sc) ceremony.sparkle(sc.x, sc.y, 25 + Math.floor(presRng() * 6), palette.sun);
      chars[pid]?.anim.idle();
    }
    if (t >= STAR_CEREMONY_DUR) {
      S.starCeremony = false;
      ceremony.releaseCamera();
      const next = S.starCeremonyThen;
      S.starCeremonyThen = null;
      (globalThis as any).__SSP_STAR_CEREMONY = { active: false, pid: 0, t: 0 };
      if (next) next();
    }
  };

  /**
   * The player just reached the Grand Prize Balloon (pass or land).
   * A free-star magnet takes one star and moves the balloon. Otherwise the
   * human picks a bundle of 1–5; CPUs and autoplay buy every star they can
   * pay for, up to 5, so a smoke run never waits on the popup.
   * `then` continues the move or the rest of the landing effect.
   */
  const offerPrizeBalloon = (pid: number, then: () => void): void => {
    const player = match.players[pid];
    if (!player) {
      then();
      return;
    }
    if (consumeFreeStar(pid)) {
      player.stars += 1;
      bus.emit("star:buy", {
        player: pid,
        star: player.stars,
        total: player.coins,
        bought: 1,
        spent: 0,
      });
      audio.sfx.play("star.get");
      movePrizeBalloon(pid);
      celebrateStar(pid, 1, then);
      return;
    }
    const affordable = sensibleStarCount(pid);
    if (affordable <= 0) {
      if (pid === HUMAN) {
        ui.toast(`A star costs ${settings.starCost} coins!`, { durationMs: 1600 });
      }
      then();
      return;
    }
    const commit = (requested: number): void => {
      const res = tryBuyStars(pid, requested);
      if (res.bought <= 0) {
        ui.toast("Not enough coins!", { durationMs: 1400 });
        then();
        return;
      }
      celebrateStar(pid, res.bought, () => {
        if (res.discarded > 0) {
          const word = res.discarded === 1 ? "star" : "stars";
          ui.toast(`${res.discarded} unpaid ${word} popped away!`, { durationMs: 1600 });
        }
        then();
      });
    };
    if (pid !== HUMAN || isAutoplay()) {
      commit(affordable);
      return;
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center;";
    let settled = false;
    const close = (): void => {
      S.starAutoCommit = null;
      S.starPopup?.destroy();
      S.starPopup = null;
    };
    const choose = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      close();
      fn();
    };
    S.starAutoCommit = () => choose(() => commit(sensibleStarCount(pid)));
    for (let n = 1; n <= settings.starBundleMax; n++) {
      const count = n;
      const btn = ui.button({
        label: `★${count}`,
        kind: "gold",
        size: "sm",
        ariaLabel: `Buy ${count} star${count === 1 ? "" : "s"} for ${count * settings.starCost} coins`,
        onClick: () => choose(() => commit(count)),
      });
      row.appendChild(btn.el);
    }
    const pass = ui.button({
      label: "PASS",
      kind: "ghost",
      size: "sm",
      onClick: () => choose(() => {
        ui.toast("Maybe next time!", { durationMs: 1200 });
        then();
      }),
    });
    row.appendChild(pass.el);
    S.starPopup = ui.popup({
      title: "GRAND PRIZE BALLOON",
      body: `${player.name}, stars are ${settings.starCost} coins each, up to ${settings.starBundleMax}. You have ${player.coins} coins. If you can't pay for the whole bundle, you get what you can afford and the rest pops away.`,
      content: row,
      sound: null,
      closeOnEsc: false,
    });
  };

  const shopSpace = (pid: number): void => {
    S.shopOpen = true;
    rollButton.setEnabled(false);
    // Autoplay runs must never stall on the modal shop. The real shop opens
    // (so the economy moment is live) but auto-resolves after a real beat so
    // the flow keeps moving.
    const shopPromise: Promise<{ bought: string[] }> = openShop(pid, {
      autoCloseMs: isAutoplay() ? 1200 : undefined,
    });
    // MP7-style: the shop has its own cheerful music-box jingle while open.
    // It replaces the board track for the duration of the shop visit, then
    // restores it when the popup resolves.
    audio.music.play("shop", { intensity: 0.35 });
    shopPromise
      .then((res) => {
        if (S.disposed) return;
        S.shopOpen = false;
        audio.music.play("board", { intensity: boardIntensity() });
        for (const key of res.bought) {
          const def = ITEM_DEFS[key];
          ui.toast(`Bought ${def?.name ?? key}!`, { durationMs: 1600 });
        }
        if (res.bought.length > 0) audio.sfx.play("shop.buy");
        refreshHud();
        finishEffect();
      })
      .catch(() => {
        if (S.disposed) return;
        S.shopOpen = false;
        finishEffect();
      });
  };

  const happeningSpace = (pid: number, kind: "green" | "grumpus"): void => {
    const player = match.players[pid];
    if (!player) {
      finishTurn();
      return;
    }
    const myOld = player.space;
    const outcome =
      kind === "green" ? resolveGreen(pid, player.space) : resolveGrumpus(pid, player.space);

    stinger(kind === "green" ? "happening" : "grumpus", 2800);
    if (kind === "grumpus") {
      // Grumpus gag: dramatic beat. Screen wobble, camera push toward the
      // victim, a bigger lava flash, grumpus laugh SFX, and a telegraph
      // sparkle at the swapped leader's position so the swap/gag reads clearly.
      ceremony.shakeScreen(5, 0.5);
      ceremony.focusCamera(charPos(pid), 0.2);
      ceremony.flashOverlay("rgba(255,90,60,0.45)");
      chars[pid]?.anim.sad();
      audio.sfx.play("grumpus.laugh", { volume: 0.8 });
      // Telegraph: if a swap/shove is coming, sparkle the destination.
      if (outcome.moveTo !== undefined || outcome.moveBy !== undefined || outcome.moveOtherTo !== undefined) {
        const dest = outcome.moveTo !== undefined
          ? outcome.moveTo
          : outcome.moveBy !== undefined
            ? wrap(player.space + outcome.moveBy)
            : myOld;
        const destPos = board.spaceWorldPos(dest);
        const sc = ceremony.projectToScreen(destPos);
        if (sc) ceremony.sparkle(sc.x, sc.y, 14, palette.lava);
      }
    }
    // ---- Green happening staged beat (MP7 theatricality) ----
    // The board reacts, characters react, something physically changes,
    // then it resolves. Presentation randomness goes through presRng only.
    if (kind === "green") {
      // Character reaction based on the outcome's emotional valence.
      if (outcome.coinsDelta > 0) {
        chars[pid]?.anim.cheer();
        audio.sfx.play("crowd.ohh", { volume: 0.4 });
      } else if (outcome.coinsDelta < 0) {
        chars[pid]?.anim.sad();
      } else {
        chars[pid]?.anim.idle();
      }
      // Physical board change: pulse the space + sparkle at the character.
      const sc = ceremony.projectToScreen(charPos(pid));
      if (sc) {
        board.highlight(player.space);
        ceremony.sparkle(sc.x, sc.y, 12 + Math.floor(presRng() * 6), palette.bubble);
      }
      // Background reaction: bubble vignette nudge.
      ceremony.vignettePulse(palette.bubble, 0.3, 1.2);
    }
    hud.showBanner(outcome.banner, { durationMs: 1900 });
    if (outcome.message && outcome.message !== outcome.banner) {
      ui.toast(outcome.message, { durationMs: 2600 });
    }
    refreshHud();

    // Swap events moved ANOTHER player in match state — snap their mesh.
    if (outcome.moveOtherTo !== undefined) {
      for (const p of match.players) {
        if (p.id !== pid && p.space === myOld) {
          placeCharAt(p.id, p.space);
          chars[p.id]?.anim.squash();
        }
      }
      S.moveFromOverride = myOld; // I hop from my OLD spot to the swapped-in one
    }

    if (outcome.moveTo !== undefined) {
      startMoving([outcome.moveTo], "done");
    } else if (outcome.moveBy !== undefined) {
      startMoving([wrap(player.space + outcome.moveBy)], "done");
    } else if (kind === "green") {
      // Green happening with no movement: brief reaction beat, then resolve.
      pause(0.45, () => {
        chars[pid]?.anim.idle();
        finishTurn();
      });
    } else {
      finishTurn();
    }
  };

  /* ---------------- minigame round ---------------- */

  const minigameRound = (): void => {
    growTrees();
    ageCircuses();
    if (S.circusToll) {
      S.circusToll.turnsLeft -= 1;
      if (S.circusToll.turnsLeft <= 0) S.circusToll = null;
    }
    const popped = match.minigameTriggeredThisRound;
    match.minigameTriggeredThisRound = false;
    if (!popped) {
      ui.toast("No balloon popped — the midway stays quiet.", { durationMs: 1500 });
      match.turn += 1;
      if (match.turn > match.totalTurns) {
        results();
      } else {
        pause(0.7, beginTurn);
      }
      return;
    }
    S.phase = "minigame-round";
    match.phase = "minigame";
    rollButton.setVisible(false);
    refreshHud();
    // Pass player packs (MP7). For now default everyone to "midway" so existing minigames still work.
    // Real pack choice will come from character select / startMatch.
    const defaultPacks: Record<number, string> = {};
    match.players.forEach((_, i) => { defaultPacks[i] = "midway"; });
    const mg = tryPickMinigame(defaultPacks);
    if (!mg) {
      // No minigames registered yet — toast and carry on.
      ui.toast("Minigames arrive in Wave 3!", { durationMs: 2200 });
      match.turn += 1;
      if (match.turn > match.totalTurns) {
        results();
      } else {
        pause(0.9, beginTurn);
      }
      return;
    }
    // A minigame is available.
    // Show the pre-screen overlay *while the board is still the active screen*
    // so the slow graceful camera pan (phase "minigame") continues underneath
    // the "MINI GAME TIME!" card exactly as requested. Only after the user
    // clicks START do we switch screens and let the players "jump in".
    console.log('[turnLoop] minigameRound triggered for turn', match.turn, 'mg=', mg.id);
    match.turn += 1;
    resumeFromMinigame = true;
    setPendingMinigame(mg);

    const desc = (mg as any).description || getMinigameDescription(mg.id, mg.name);
    showMinigamePreview(mg.name, desc).then((started) => {
      console.log('[turnLoop] pre-screen resolved started=', started);
      if (!started) {
        // User cancelled (click outside / Escape) — clear flags and resume turns.
        resumeFromMinigame = false;
        setPendingMinigame(null);
        pause(0.2, beginTurn);
        return;
      }
      // User clicked START while the board was panning.
      // Mark so minigame.enter() skips the preview card (already understood)
      // and goes straight to buildArenaAndStart().
      skipNextMinigamePreScreen();
      console.log('[turnLoop] calling goto minigame after START');
      screens.goto("minigame");
    });
  };

  /* ---------------- results ---------------- */

  const results = (): void => {
    S.phase = "results";
    match.phase = "results";
    rollButton.setVisible(false);
    refreshHud();

    const bonuses = computeBonusStars();
    const steps: Array<() => void> = [];
    for (const b of bonuses) {
      steps.push(() => {
        const p = match.players[b.playerId];
        audio.sfx.play("fanfare.win");
        ui.confettiBurst(undefined, undefined, { count: 90, sound: null });
        hud.showBanner(`★ ${bonusStarLabel(b.star)} → ${p.name}!`, { durationMs: 1900 });
      });
    }
    steps.push(() => {
      const entries = finalRanking();
      const winner = match.players[entries[0]?.playerId ?? 0];
      audio.music.play("results", { intensity: 0.85 });
      audio.sfx.play("fanfare.win");
      ui.confettiBurst(undefined, undefined, { count: 140, sound: null });
      hud.showBanner(`WINNER: ${winner?.name ?? "?"}!`, { durationMs: 2600 });
      chars[entries[0]?.playerId ?? 0]?.anim.cheer();
      bus.emit("results:show", { ranking: entries.map((r) => r.playerId) });
      bus.emit("match:end", { ranking: entries.map((r) => r.playerId) });

      const content = document.createElement("div");
      content.className = "ssp-podium";
      entries.forEach((r, i) => {
        const p = match.players[r.playerId];
        const row = document.createElement("div");
        row.className = `ssp-podium__row${i === 0 ? " ssp-podium__row--win" : ""}`;
        const tags = r.bonus.map((b) => bonusStarTag(b)).join(" ");
        row.textContent = `${i + 1}. ${p?.name ?? "?"}  ★${r.stars} · ${r.coins}c${tags ? `  ${tags}` : ""}`;
        content.appendChild(row);
      });
      ui.popup({
        title: "FINAL RESULTS",
        content,
        sound: "fanfare.win",
        buttons: [
          {
            label: "PLAY AGAIN",
            kind: "gold",
            onClick: () => {
              audio.music.stop(0.4);
              screens.goto("title");
            },
          },
        ],
      });
      S.phase = "ended";
      match.phase = "ended";
    });
    S.resultSteps = steps;
    S.resultTimer = 0.55;
  };

  /* ---------------- per-frame ---------------- */

  const update = (dt: number): void => {
    if (S.disposed) return;

    // Autoplay turned on while the human was choosing a bundle: buy the
    // sensible amount so a smoke run cannot sit on the popup.
    if (isAutoplay() && S.starPopup && S.starAutoCommit) {
      const fn = S.starAutoCommit;
      S.starAutoCommit = null;
      fn();
      return;
    }

    // Star ceremony runs INSTEAD of the pause chain — it's a staged presentation
    // beat. It draws no gameplay rng, so the seeded simulation stays identical.
    if (S.starCeremony) {
      updateStarCeremony(dt);
      return;
    }

    if (S.pauseT > 0) {
      S.pauseT -= dt;
      if (S.pauseT <= 0) {
        const fn = S.pauseFn;
        S.pauseFn = null;
        if (fn) fn();
      }
      return;
    }

    switch (S.phase) {
      case "dice": {
        if (S.cpuTimer > 0) {
          S.cpuTimer -= dt;
          if (S.cpuTimer <= 0) rollPressed();
        } else if (S.betweenRolls > 0) {
          S.betweenRolls -= dt;
          if (S.betweenRolls <= 0) rollPressed();
        } else if (S.rolling) {
          S.diceT -= dt;
          if (S.diceT <= 0) diceLand();
        }
        break;
      }
      case "moving": {
        if (!S.hopActive) break;
        const pid = match.currentPlayer;
        const ch = chars[pid];
        if (!ch) break;
        S.hopT += dt;
        const p = Math.min(1, S.hopT / settings.hopDuration);
        const e = ease.outCubic(p);
        const a = board.spaceWorldPos(S.hopFrom);
        const b = board.spaceWorldPos(S.hopTo);
        const off = PLAYER_OFFSETS[pid] ?? [0, 0];
        ch.group.position.set(
          a.x + (b.x - a.x) * e + off[0],
          0,
          a.z + (b.z - a.z) * e + off[1]
        );
        if (p >= 1) {
          S.hopActive = false;
          match.players[pid].space = S.hopTo;
          if (S.moveIdx >= S.moveQueue.length) {
            // final tile
            ch.anim.squash();
            audio.sfx.play("land");
            bus.emit("player:land", {
              player: pid,
              space: S.hopTo,
              type: board.spaceType(S.hopTo),
            });
            board.clearHighlights();
            board.setHighlight(S.hopTo, true);
            refreshHud();
            if (S.afterMove === "effect") enterSpaceEffect(pid);
            else finishTurn();
          } else {
            // Passing a stamp or minigame balloon pays out on the hop,
            // before the rest of the move (so a jackpot can fund a star
            // landed later in the same roll). The Grand Prize Balloon is
            // the same kind of pass: buy, then keep hopping.
            arriveCarnival(pid, S.hopTo, false);
            const resumeMove = (): void => {
              const branch = JUNCTIONS.find((j) => j.from === S.hopTo);
              const hopsLeft = S.moveQueue.length - S.moveIdx;
              if (branch && hopsLeft > 0) offerJunction(pid, hopsLeft);
              else startHop(pid);
            };
            if (S.hopTo === match.starBalloonPos) offerPrizeBalloon(pid, resumeMove);
            else resumeMove();
          }
        }
        break;
      }
      case "results": {
        if (S.resultSteps.length > 0) {
          S.resultTimer -= dt;
          if (S.resultTimer <= 0) {
            const fn = S.resultSteps.shift();
            S.resultTimer = 1.0;
            if (fn) fn();
          }
        }
        break;
      }
      default:
        break;
    }
  };

  /* ---------------- lifecycle ---------------- */

  const start = (): void => {
    S.disposed = false;
    audio.music.play("board", { intensity: 0.6 });
    rollButton.setVisible(false);
    dice.hide();
    syncCharPositions();
    refreshHud();
    if (match.players.length === 0) {
      S.phase = "ended";
      return;
    }
    if (resumeFromMinigame) {
      // Back from a minigame round: finish the round's bookkeeping. The
      // turn++ already happened before the screen switch, so it's just the
      // results-vs-next-turn decision here.
      resumeFromMinigame = false;
      if (match.turn > match.totalTurns) results();
      else beginTurn();
      return;
    }
    beginTurn();
  };

  const dispose = (): void => {
    S.disposed = true;
    if (stingerTO !== null) {
      window.clearTimeout(stingerTO);
      stingerTO = null;
    }
    S.starPopup?.destroy();
    S.starPopup = null;
    S.starAutoCommit = null;
    liveLoop = null;
  };

  const loop: TurnLoop = {
    start,
    update,
    rollPressed,
    isWaitingForRoll: (): boolean =>
      S.phase === "dice" && !S.rolling && S.betweenRolls <= 0 && !S.shopOpen && !S.starPopup && !S.starCeremony,
    get phase(): LoopPhase {
      return S.phase;
    },
    dispose,
  };

  liveLoop = loop;
  return loop;
}

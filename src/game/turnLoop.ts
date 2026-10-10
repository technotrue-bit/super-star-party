/**
 * SUPER STAR PARTY — turn loop: the match phase machine.
 *
 *   announce -> dice -> moving -> space-effect -> (next player)
 *            -> minigame-round -> ... -> results -> ended
 *
 * Owns ALL match-flow logic: dice (deterministic rng + forced-dice debug
 * hook), per-tile hop movement with the Funhouse Cut shortcut, space effects
 * (blue / red / Grand Prize Balloon / shop / green / grumpus), shops on pass,
 * Carnival Squeeze when a move ends on a shared space, Fizzy Barker pity
 * in the last 5 turns, item use before rolling (and poison after the roll),
 * minigame-round gating, bonus stars and the final podium. Every beat plays
 * its SFX, the music intensity follows the phase, and bus events keep the
 * crowd reactions + debug API live.
 *
 * Determinism contract: every random decision goes through rng; the debug
 * API can force a face via window.__forcedDice (consumed once) and drive the
 * human's roll via the autoplay hook.
 */
import * as THREE from "three";
import { match, playerController, ranking, type TrapKind } from "../core/game";
import { decisions, isPending } from "./decisions";
import { rng, ease } from "../core/rng";
import { settings } from "../config/settings";
import { palette } from "../config/palette";
import { bus } from "../core/events";
import { audio } from "../audio/audioEngine";
import { ui } from "../ui/kit";
import { setAutoplayHook, isAutoplay } from "../core/debug";
import { characterDice, characterColor } from "../characters/roster";
import type { BoardScene } from "../board/boardScene";
import { stayOf, branchOf, forkLabel, ahead } from "../board/boardData";
import { activeBoard } from "../board/registry";
import { stampLabel, jackpotWord } from "../board/boardText";
import type { Character } from "../characters/characterFactory";
import type { HudHandle } from "../ui/hud";
import type { ButtonHandle } from "../ui/button";
import type { PopupHandle } from "../ui/popup";
import { addCoins, awardMinigameResult, tryBuyStars, sensibleStarCount, movePrizeBalloon, computeBonusStars, finalRanking, grantStamp, popMinigameBalloon, carnivalSqueeze, minigameCoinAward, type BonusStarKind } from "./economy";
import { resolveGreen, resolveGrumpus, consumeFreeStar, consumeDoubleBlue } from "./happenings";
import {
  ITEM_DEFS,
  buyItem,
  canUseItem,
  decideShopPurchase,
  pickAutoItem,
  useItem,
  turnsLeft,
  grantFizzyPity,
  itemTargets,
  swapGiveChoices,
  swapTakeChoices,
  consumeRollAdjust,
  movementTotal,
  takeLuckyPlayers,
  collectLuckyBlue,
  type ShopDecision,
  type UseItemResult,
} from "./items";
import { openShop } from "../screens/shopScreen";
import { restockShops } from "./shopStock";
import { tryPickMinigame } from "../minigames/registry";
import { setPendingMinigame } from "../minigames/framework";
import { getMinigameDescription, showMinigamePreview, skipNextMinigamePreScreen } from "../screens/minigameScreen";
import { screens } from "../screens/screenManager";
import { consumeTrap, resolveTrap, trapAt, payCircusToll, growTrees, ageCircuses, placeTrap } from "./traps";
import { onlineMatch, partyAssist, setCpuPlayout } from "../net/mode";
import { playerLabel, isYou, labelPossessive, labelDoes } from "../ui/labels";
import {
  checkpoint,
  isHost,
  onOfficialMinigame,
  peekChoice,
  publishChoice,
  shiftChoice,
} from "../net/session";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Next space on the same lane (the stay edge, Funhouse Cut applied). */
function stepOn(space: number): number {
  return stayOf(activeBoard(), space);
}

/** The branch edge when `space` is a fork, else undefined. */
function forkAt(space: number): number | undefined {
  return branchOf(activeBoard(), space);
}

/** Per-player stand offsets on a shared space (MP7-style 2x2 grid). */
export const PLAYER_OFFSETS: ReadonlyArray<[number, number]> = [
  [0.0, 0.0],
  [0.6, 0.0],
  [0.0, 0.6],
  [0.6, 0.6],
];

const wrap = (i: number): number => {
  const n = activeBoard().spaces.length;
  return ((i % n) + n) % n;
};

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
      const j = forkAt(s);
      if (j !== undefined) cands.push(j);
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
  /** Display only: hops still to walk in the current rolled walk, or null (teleports, landed, ceremonies). */
  readonly moveCountdown: { pid: number; left: number } | null;
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
  // Local seats keep the ROLL button under autoplay. CPUs use their timer,
  // which is a different rng draw, so the hook must not press for them.
  if (l && l.isWaitingForRoll() && decisions.usesRollButton(match.currentPlayer)) l.rollPressed();
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
    /** If autoplay flips on while the human shop is open, close it and decide. */
    shopAutoCommit: (() => void) | null;
    /** Human closed the shop because autoplay started; buy if they bought nothing. */
    shopDecideOnClose: boolean;
    /** Item picker or warp pause: do not also roll. */
    itemResolving: boolean;
    itemPopup: PopupHandle | null;
    itemAutoCommit: (() => void) | null;
    poisonPopup: PopupHandle | null;
    poisonAutoCommit: (() => void) | null;
    netDice: boolean;
    netShop: { pid: number; space: number; done: () => void } | null;
    netStar: { pid: number; commit: (count: number) => void; pass: () => void } | null;
    netPoison: { holderId: number; finish: (use: boolean) => void } | null;
    netPath: {
      pid: number;
      stay: number;
      branch: number;
      pick: (to: number) => void;
      hops: (space: number) => number;
    } | null;
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
    shopAutoCommit: null,
    shopDecideOnClose: false,
    itemResolving: false,
    itemPopup: null,
    itemAutoCommit: null,
    poisonPopup: null,
    poisonAutoCommit: null,
    netDice: false,
    netShop: null,
    netStar: null,
    netPoison: null,
    netPath: null,
    resultSteps: [],
    resultTimer: 0,
    circusToll: null,
  };

  let stingerTO: number | null = null;
  /** Display only (not in S/MatchState): true while a rolled walk is in progress. */
  let countedWalk = false;

  /* ---------------- helpers ---------------- */

  const pause = (seconds: number, fn: () => void): void => {
    S.pauseT = seconds;
    S.pauseFn = fn;
  };

  /**
   * Offline (including solo autoplay) stays on decisions.ts.
   * Online humans are "human" or "assist". Remote seats wait.
   * CPU is the local AI on every peer.
   */
  const netGate = (pid: number): "cpu" | "assist" | "remote" | "human" => {
    if (!onlineMatch()) return "cpu";
    const seat = playerController(pid);
    if (seat === "cpu") return "cpu";
    if (seat === "remote") return "remote";
    if (partyAssist()) return "assist";
    return "human";
  };

  const publishLocal = (pid: number, choice: Parameters<typeof publishChoice>[0]): void => {
    if (onlineMatch() && playerController(pid) === "local") publishChoice(choice);
  };

  const replayShop = (
    pid: number,
    bought: string[],
    traps: { space: number; kind: string }[],
  ): void => {
    let trapAtIndex = 0;
    for (const key of bought) {
      const def = ITEM_DEFS[key];
      if (!buyItem(pid, key)) continue;
      if (!def?.places) {
        ui.toast(`Bought ${def?.name ?? key}!`, { durationMs: 1200 });
        continue;
      }
      const held = match.players[pid]?.items;
      const at = held?.lastIndexOf(key) ?? -1;
      if (held && at >= 0) held.splice(at, 1);
      const trap = traps[trapAtIndex];
      trapAtIndex += 1;
      if (trap) placeTrap(pid, trap.space, trap.kind as TrapKind);
      ui.toast(`Set ${def.name}!`, { durationMs: 1200 });
    }
  };

  let pumping = false;
  /** Apply one queued remote choice. True when the caller should look again. */
  const stepNet = (): boolean => {
    if (S.netPoison) {
      const wait = S.netPoison;
      if (playerController(wait.holderId) === "cpu") {
        S.netPoison = null;
        wait.finish(true);
        return true;
      }
      const msg = peekChoice();
      if (!msg || msg.kind !== "poison" || msg.playerId !== wait.holderId) return false;
      shiftChoice();
      S.netPoison = null;
      wait.finish(msg.auto ? true : msg.use);
      return true;
    }
    if (S.netStar) {
      const wait = S.netStar;
      if (playerController(wait.pid) === "cpu") {
        S.netStar = null;
        wait.commit(sensibleStarCount(wait.pid));
        return true;
      }
      const msg = peekChoice();
      if (!msg || msg.kind !== "star" || msg.playerId !== wait.pid) return false;
      shiftChoice();
      S.netStar = null;
      if (msg.auto) wait.commit(sensibleStarCount(wait.pid));
      else if (msg.pass) wait.pass();
      else wait.commit(msg.count);
      return true;
    }
    if (S.netShop) {
      const wait = S.netShop;
      if (playerController(wait.pid) === "cpu") {
        S.netShop = null;
        const decision = decideShopPurchase(wait.pid, wait.space);
        if (decision) toastShop(decision);
        else ui.toast("Just looking!", { durationMs: 900 });
        wait.done();
        return true;
      }
      const msg = peekChoice();
      if (!msg || msg.kind !== "shop" || msg.playerId !== wait.pid) return false;
      shiftChoice();
      S.netShop = null;
      if (msg.auto) {
        const decision = decideShopPurchase(wait.pid, wait.space);
        if (decision) toastShop(decision);
        else ui.toast("Just looking!", { durationMs: 900 });
      } else if ((msg.bought ?? []).length === 0) {
        ui.toast("Just looking!", { durationMs: 900 });
      } else {
        replayShop(wait.pid, msg.bought ?? [], msg.traps ?? []);
      }
      wait.done();
      return true;
    }
    if (S.netPath) {
      const wait = S.netPath;
      const autoTo = (): number => (wait.hops(wait.branch) < wait.hops(wait.stay) ? wait.branch : wait.stay);
      if (playerController(wait.pid) === "cpu") {
        S.netPath = null;
        wait.pick(autoTo());
        return true;
      }
      const msg = peekChoice();
      if (!msg || msg.kind !== "path" || msg.playerId !== wait.pid) return false;
      shiftChoice();
      S.netPath = null;
      wait.pick(msg.auto ? autoTo() : (msg.to ?? wait.stay));
      return true;
    }
    if (S.netDice) {
      const pid = match.currentPlayer;
      if (playerController(pid) === "cpu") {
        S.netDice = false;
        const key = pickAutoItem(pid);
        if (key) {
          const res = useItem(pid, key);
          if (applyAutoItem(pid, res)) return S.phase === "dice";
        }
        armDice(pid);
        return false;
      }
      const msg = peekChoice();
      if (!msg || msg.playerId !== pid) return false;
      if (msg.kind === "preitem") {
        shiftChoice();
        const key = pickAutoItem(pid);
        if (key) {
          const res = useItem(pid, key);
          if (applyAutoItem(pid, res)) {
            if (S.phase !== "dice") S.netDice = false;
            return true;
          }
        }
        return true;
      }
      if (msg.kind === "item") {
        shiftChoice();
        const trade = msg.give || msg.take ? { give: msg.give, take: msg.take } : undefined;
        finishBarUse(pid, useItem(pid, msg.key, msg.target, trade));
        if (S.phase !== "dice") S.netDice = false;
        return true;
      }
      if (msg.kind === "roll") {
        shiftChoice();
        S.netDice = false;
        rollPressed(true);
        return false;
      }
    }
    return false;
  };

  const pumpNet = (): void => {
    if (pumping || S.disposed || !onlineMatch()) return;
    pumping = true;
    try {
      for (let i = 0; i < 8; i++) {
        if (!stepNet()) break;
      }
    } finally {
      pumping = false;
    }
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
        name: playerLabel(p.id, "short"),
        you: isYou(p.id),
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
    checkpoint("turn");
    S.phase = "announce";
    match.phase = "dice";
    const pid = match.currentPlayer;
    const player = match.players[pid];
    if (!player) return;
    if (player.itemFx.skipTurn) {
      player.itemFx.skipTurn = false;
      bus.emit("turn:start", { turn: match.turn, player: pid });
      hud.showBanner(`${labelDoes(pid, "LOSE", "LOSES")} A TURN!`, { durationMs: 1400 });
      ui.toast("The Grumpus Coat ate their turn!", { durationMs: 1800 });
      chars[pid]?.anim.sad();
      audio.sfx.play("sad");
      refreshHud();
      pause(1.1, nextTurn);
      return;
    }
    bus.emit("turn:start", { turn: match.turn, player: pid });
    audio.sfx.play("whistle");
    board.clearHighlights();
    board.setHighlight(player.space, true);
    refreshHud();
    hud.showBanner(`TURN ${match.turn}`, { durationMs: 900 });
    pause(0.95, () => {
      hud.showBanner(`${labelPossessive(pid)} TURN!`, { durationMs: 1150 });
      pause(0.75, () => offerFizzyPity(pid, beginDice));
    });
  };

  /**
   * Fizzy Barker pity. Once, at the start of a player's turn (before the die),
   * during the last `settings.pityLastTurns` turns: if `ranking()` currently
   * lists them last, they receive one bag item they do not already hold.
   * Start-of-turn (not once per round) so the gift is in the bag before they
   * roll, and so a player who climbs out of last place mid-round is not paid
   * for a lead they no longer have. The rng draw happens here, before dice,
   * and only when a gift is actually given.
   */
  const offerFizzyPity = (pid: number, then: () => void): void => {
    if (turnsLeft() > settings.pityLastTurns) {
      then();
      return;
    }
    const order = ranking();
    const last = order[order.length - 1];
    if (last !== pid) {
      then();
      return;
    }
    const key = grantFizzyPity(pid);
    if (!key) {
      ui.toast("Aw, tough luck kid, your bag's already full!", { durationMs: 2000 });
      audio.sfx.play("sad");
      pause(1.1, then);
      return;
    }
    const name = ITEM_DEFS[key]?.name ?? key;
    bus.emit("pity:gift", { player: pid, item: key });
    audio.sfx.play("happening.magic");
    hud.showBanner("FIZZY BARKER!", { durationMs: 1500 });
    ui.toast(`Aw, tough luck kid, here's a ${name} on the house!`, { durationMs: 2400 });
    chars[pid]?.anim.cheer();
    refreshHud();
    pause(1.2, then);
  };

  const armDice = (pid: number): void => {
    if (S.disposed || S.phase !== "dice") return;
    S.itemResolving = false;
    // Die appears floating above the current player's token, slowly spinning
    // until the player (or CPU timer) presses ROLL.
    dice.hover(pid);
    rebuildItemBar(pid);
    rollButton.setVisible(true);
    const roll = decisions.roll(pid);
    if (roll.mode === "button") {
      rollButton.setEnabled(true);
      S.cpuTimer = 0;
    } else if (roll.mode === "timer") {
      rollButton.setEnabled(false);
      S.cpuTimer = roll.delay;
    } else {
      rollButton.setEnabled(false);
      S.cpuTimer = 0;
    }
  };

  /**
   * CPU and autoplay use one held item before the roll. Returns true when
   * that item left the dice phase (warp) or will arm the die itself (chomp).
   */
  const applyAutoItem = (pid: number, res: UseItemResult): boolean => {
    if (!res.ok) return false;
    ui.toast(res.message, { durationMs: 1600 });
    audio.sfx.play("boing");
    refreshHud();
    if (res.extraDice) {
      S.rollsNeeded = 2;
      const p = match.players[pid];
      if (p) p.itemFx.doubleDice = false;
    }
    if (res.swappedWith !== undefined) syncCharPositions();
    if (res.moveTo !== undefined) {
      S.itemResolving = true;
      rollButton.setEnabled(false);
      itemBar.innerHTML = "";
      dice.hide();
      const after = res.landEffect ? "effect" : "done";
      pause(0.35, () => {
        S.itemResolving = false;
        startMoving([res.moveTo as number], after);
      });
      return true;
    }
    if (res.chomp) {
      S.itemResolving = true;
      offerPrizeBalloon(pid, () => {
        S.itemResolving = false;
        if (S.disposed || S.phase !== "dice") return;
        armDice(pid);
        if (partyAssist() && playerController(pid) === "local") rollPressed();
      });
      return true;
    }
    return false;
  };

  const beginDice = (): void => {
    S.phase = "dice";
    match.phase = "dice";
    audio.music.intensity(0.5);
    const pid = match.currentPlayer;
    const player = match.players[pid];
    S.diceFaces = [];
    S.rollsNeeded = 1;
    S.rolling = false;
    S.betweenRolls = 0;
    S.itemResolving = false;
    if (player?.itemFx.doubleDice) {
      S.rollsNeeded = 2;
      player.itemFx.doubleDice = false;
    }
    dice.hover(pid);
    const gate = netGate(pid);
    if (gate === "assist") {
      publishChoice({ kind: "preitem", playerId: pid, auto: true });
      const key = pickAutoItem(pid);
      if (key) {
        const res = useItem(pid, key);
        if (applyAutoItem(pid, res)) return;
      }
      armDice(pid);
      rollPressed();
      return;
    }
    if (gate === "remote") {
      S.netDice = true;
      pumpNet();
      return;
    }
    const autoItem = decisions.preRollItem(pid);
    if (!isPending(autoItem) && autoItem.key && decisions.aim(pid) === "rng") {
      const res = useItem(pid, autoItem.key);
      if (applyAutoItem(pid, res)) return;
    }
    armDice(pid);
  };

  const startMoving = (queued: number[], after: "effect" | "done", total = 0): void => {
    const pid = match.currentPlayer;
    const player = match.players[pid];
    if (!player) return;
    countedWalk = queued.length === 0;
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
      const standing = forkAt(player.space);
      if (standing !== undefined && total > 0) {
        offerJunction(pid, total, after);
        return;
      }
      let cur = player.space;
      for (let i = 0; i < total; i++) {
        const nxt = stepOn(cur);
        S.moveQueue.push(nxt);
        cur = nxt;
        if (forkAt(nxt) !== undefined && i < total - 1) break;
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
    const sc = activeBoard().shortcut;
    if (sc && S.hopTo === sc.to && wrap(S.hopFrom + 1) === sc.from) {
      audio.sfx.play("whoosh");
      ui.toast("Funhouse Cut!", { durationMs: 1500 });
    }
  };

  const offerJunction = (pid: number, hopsLeft = 0, after: "effect" | "done" = "effect"): void => {
    const here = match.players[pid]?.space ?? 0;
    const branchTo = forkAt(here);
    if (branchTo === undefined || hopsLeft <= 0) {
      finishTurn();
      return;
    }
    const stay = stepOn(here);
    const pick = (to: number): void => {
      startMoving([to], after, 0);
      countedWalk = true;
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
    const gate = netGate(pid);
    if (gate === "assist") {
      publishChoice({ kind: "path", playerId: pid, auto: true });
      pick(hopsToStar(branchTo) < hopsToStar(stay) ? branchTo : stay);
      return;
    }
    if (gate === "remote") {
      S.netPath = { pid, stay, branch: branchTo, pick, hops: hopsToStar };
      pumpNet();
      return;
    }
    const lane = decisions.path(pid, stay, branchTo, hopsToStar);
    if (!isPending(lane)) {
      pick(lane.to);
      return;
    }
    const content = document.createElement("div");
    content.style.cssText = "display:flex;flex-direction:column;gap:10px;";
    const pop = ui.popup({
      title: "WHICH LANE?",
      body: forkLabel(activeBoard(), here),
      content,
      closeOnEsc: false,
      sound: null,
      buttons: [
        {
          label: "STAY",
          kind: "ghost",
          onClick: () => {
            pop.destroy();
            publishLocal(pid, { kind: "path", playerId: pid, to: stay });
            pick(stay);
          },
        },
        {
          label: "BRANCH",
          kind: "gold",
          onClick: () => {
            pop.destroy();
            publishLocal(pid, { kind: "path", playerId: pid, to: branchTo });
            pick(branchTo);
          },
        },
      ],
    });
  };

  /**
   * Stamp spaces and minigame balloons resolve the moment a hop arrives,
   * whether the player is passing through or landing.
   * Shops are offered separately, on pass and on land.
   * Red, blue, green, and grumpus still resolve only on the final tile.
   * Returns true when this space was a stamp or a minigame balloon.
   */
  const arriveCarnival = (pid: number, space: number, landed: boolean): boolean => {
    const sp = activeBoard().spaces[wrap(space)];
    if (!sp) return false;
    if (sp.type === "stamp" && sp.stamp) {
      const label = stampLabel(sp.stamp);
      const res = grantStamp(pid, sp.stamp);
      if (res.jackpot) {
        hud.showBanner(`${jackpotWord()} JACKPOT! +${settings.stampJackpot}`, { durationMs: 1600 });
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
        gained += collectLuckyBlue(pid);
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
        offerShop(pid, finishEffect);
        return; // async for the human; CPUs and autoplay decide and continue
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

  /**
   * Group hug when this move ended on a space another player already occupies.
   * Everyone on the tile is paid, including a third or fourth. Passing through
   * does not call this — only the final hop.
   */
  const playCarnivalSqueeze = (pid: number): void => {
    const ids = carnivalSqueeze(pid);
    if (ids.length < 2) return;
    audio.sfx.play("hug");
    for (const id of ids) chars[id]?.anim.squash();
    hud.showBanner("GROUP HUG!", { durationMs: 1200 });
    ui.toast(`GROUP HUG! +${settings.squeezeCoins} coins each`, { durationMs: 1800 });
    refreshHud();
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

  const rollPressed = (fromNet = false): void => {
    if (S.disposed || S.phase !== "dice" || S.rolling || S.betweenRolls > 0 || S.shopOpen || S.itemResolving) return;
    const pid = match.currentPlayer;
    const player = match.players[pid];
    if (!player) return;
    if (!fromNet && S.diceFaces.length === 0) {
      publishLocal(pid, { kind: "roll", playerId: pid });
    }
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
    hud.showBanner(`${playerLabel(pid)} rolled ${face}!`, { durationMs: 1300 });
    S.rolling = false;
    if (S.diceFaces.length < S.rollsNeeded) {
      S.betweenRolls = 0.85;
      if (decisions.usesRollButton(pid)) rollButton.setEnabled(true);
    } else {
      match.lastDice = [...S.diceFaces];
      const raw = S.diceFaces.reduce((s, f) => s + f, 0);
      // Lock the roll through the post-land pause so the autoplay hook can't
      // fire a phantom second roll (rng + bus determinism).
      S.rolling = true;
      offerPoison(pid, raw);
    }
  };

  const launchMove = (pid: number, raw: number): void => {
    // Keep the roll locked while the adjusted total is on screen. The face
    // was already chosen; this only blocks a second roll.
    S.rolling = true;
    const adj = consumeRollAdjust(pid);
    const total = movementTotal(raw, adj.bonus, adj.penalty);
    if (adj.bonus !== 0 || adj.penalty !== 0) {
      const bits = [`rolled ${raw}`];
      if (adj.bonus) bits.push(`+${adj.bonus}`);
      if (adj.penalty) bits.push(`−${adj.penalty}`);
      ui.toast(`${bits.join(" ")} → move ${total}`, { durationMs: 1600 });
    }
    pause(adj.bonus || adj.penalty ? 0.7 : 1.0, () => {
      S.rolling = false;
      if (!(window as any).__SSP_HOLD_DIE) {
        dice.hide();
        startMoving([], "effect", total);
      }
    });
  };

  const spendPoison = (holderId: number, rollerId: number): void => {
    const res = useItem(holderId, "poison_mushroom", rollerId);
    if (!res.ok) return;
    ui.toast(res.message, { durationMs: 1400 });
    refreshHud();
  };

  /**
   * Poison is a post-roll item. CPUs and solo autoplay always spend one.
   * A manual human gets a touch prompt and the move waits on that choice.
   * Online, each human holder is asked in seat order and the choice is relayed.
   */
  const offerPoison = (rollerId: number, raw: number): void => {
    const holders = match.players
      .filter((p) => p.active && p.id !== rollerId && p.items.includes("poison_mushroom"))
      .map((p) => p.id);
    const waiting: number[] = [];
    for (const id of holders) {
      if (netGate(id) === "cpu") {
        const choice = decisions.poison(id);
        if (isPending(choice)) waiting.push(id);
        else if (choice.use) spendPoison(id, rollerId);
      } else {
        waiting.push(id);
      }
    }
    const ask = (index: number): void => {
      if (index >= waiting.length) {
        launchMove(rollerId, raw);
        return;
      }
      const chooser = waiting[index];
      const after = (use: boolean): void => {
        if (use) spendPoison(chooser, rollerId);
        ask(index + 1);
      };
      const gate = netGate(chooser);
      if (gate === "assist") {
        publishChoice({ kind: "poison", playerId: chooser, auto: true, use: true });
        after(true);
        return;
      }
      if (gate === "remote") {
        S.rolling = false;
        S.itemResolving = true;
        S.netPoison = {
          holderId: chooser,
          finish: (use) => {
            S.itemResolving = false;
            after(use);
          },
        };
        pumpNet();
        return;
      }
      // diceT is already spent. Drop `rolling` so the dice phase does not
      // call diceLand again while the touch prompt is up.
      S.rolling = false;
      S.itemResolving = true;
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-direction:column;gap:8px;width:min(82vw,320px);";
      let settled = false;
      const close = (): void => {
        S.poisonPopup?.destroy();
        S.poisonPopup = null;
        S.poisonAutoCommit = null;
      };
      const finish = (use: boolean): void => {
        if (settled) return;
        settled = true;
        close();
        S.itemResolving = false;
        publishLocal(chooser, { kind: "poison", playerId: chooser, use });
        after(use);
      };
      S.poisonAutoCommit = () => finish(true);
      const useBtn = ui.button({
        label: "🍋 SOUR −2",
        kind: "danger",
        size: "md",
        ariaLabel: "Use Sour Mushroom to subtract 2 from this roll",
        onClick: () => finish(true),
      });
      useBtn.el.setAttribute("data-poison", "use");
      const skipBtn = ui.button({
        label: "LET IT RIDE",
        kind: "ghost",
        size: "md",
        ariaLabel: "Let the roll stand",
        onClick: () => finish(false),
      });
      skipBtn.el.setAttribute("data-poison", "skip");
      row.append(useBtn.el, skipBtn.el);
      const roller = match.players[rollerId];
      S.poisonPopup = ui.popup({
        title: "SOUR MUSHROOM",
        body: `${roller?.name ?? "They"} rolled ${raw}. Subtract 2 before they move?`,
        content: row,
        sound: null,
        closeOnEsc: false,
      });
    };
    ask(0);
  };

  /* ---------------- items (pre-roll) ---------------- */

  const TARGET_PICK = new Set(["warp_pipe", "dueling_glove", "mecha_fly", "swap_card", "boo_bell", "bowser_suit"]);

  const rebuildItemBar = (pid: number): void => {
    itemBar.innerHTML = "";
    if (!decisions.choosesLocally(pid)) return;
    const keys = Array.from(new Set(match.players[pid]?.items ?? []));
    for (const key of keys) {
      if (key === "poison_mushroom") continue;
      if (!canUseItem(pid, key)) continue;
      const def = ITEM_DEFS[key];
      const btn = ui.button({
        label: `${def.icon} ${def.name}`,
        kind: "primary",
        size: "sm",
        sound: "ui.click",
        ariaLabel: `Use ${def.name}`,
      });
      btn.el.setAttribute("data-item-use", key);
      btn.el.addEventListener("click", () => useItemPressed(pid, key));
      itemBar.appendChild(btn.el);
    }
  };

  const finishBarUse = (pid: number, res: UseItemResult): void => {
    if (!res.ok) {
      ui.toast(res.message, { durationMs: 1400 });
      rebuildItemBar(pid);
      if (decisions.usesRollButton(pid)) rollButton.setEnabled(true);
      return;
    }
    ui.toast(res.message, { durationMs: 2200 });
    audio.sfx.play("boing");
    refreshHud();
    if (res.swappedWith !== undefined) syncCharPositions();
    if (res.extraDice) {
      S.rollsNeeded = 2;
      const p = match.players[pid];
      if (p) p.itemFx.doubleDice = false;
      rebuildItemBar(pid);
      if (decisions.usesRollButton(pid)) rollButton.setEnabled(true);
      return;
    }
    if (res.moveTo !== undefined) {
      S.itemResolving = true;
      dice.hide();
      rollButton.setEnabled(false);
      itemBar.innerHTML = "";
      const after = res.landEffect ? "effect" : "done";
      pause(0.35, () => {
        S.itemResolving = false;
        startMoving([res.moveTo as number], after);
      });
      return;
    }
    if (res.chomp) {
      S.itemResolving = true;
      rollButton.setEnabled(false);
      offerPrizeBalloon(pid, () => {
        S.itemResolving = false;
        if (S.disposed || S.phase !== "dice") return;
        if (decisions.usesRollButton(pid)) rollButton.setEnabled(true);
        rebuildItemBar(pid);
      });
      return;
    }
    rebuildItemBar(pid);
    if (decisions.usesRollButton(pid)) rollButton.setEnabled(true);
  };

  const openTargetPicker = (pid: number, key: string): void => {
    const def = ITEM_DEFS[key];
    S.itemResolving = true;
    rollButton.setEnabled(false);
    const sheet = document.createElement("div");
    sheet.style.cssText = "display:flex;flex-direction:column;gap:8px;width:min(82vw,340px);";
    let settled = false;
    const close = (): void => {
      S.itemPopup?.destroy();
      S.itemPopup = null;
      S.itemAutoCommit = null;
    };
    const cancel = (): void => {
      if (settled) return;
      settled = true;
      close();
      S.itemResolving = false;
      if (decisions.usesRollButton(pid)) rollButton.setEnabled(true);
      rebuildItemBar(pid);
    };
    const commit = (target?: number, trade?: { give?: string; take?: string }): void => {
      if (settled) return;
      settled = true;
      close();
      S.itemResolving = false;
      publishLocal(pid, {
        kind: "item",
        playerId: pid,
        key,
        target,
        give: trade?.give,
        take: trade?.take,
      });
      finishBarUse(pid, useItem(pid, key, target, trade));
    };
    // Autoplay that flips on mid-picker chooses with rng and never waits.
    S.itemAutoCommit = () => {
      if (decisions.aim(pid) === "wait") return;
      commit();
    };
    const showPlayers = (): void => {
      sheet.replaceChildren();
      for (const id of itemTargets(pid, key)) {
        const rival = match.players[id];
        const btn = ui.button({
          label: `${rival?.name ?? "Rival"} · space ${(rival?.space ?? 0) + 1}`,
          kind: "primary",
          size: "sm",
          ariaLabel: `Choose ${rival?.name ?? "rival"}`,
          onClick: () => {
            if (key === "swap_card") showGive(id);
            else commit(id);
          },
        });
        btn.el.setAttribute("data-item-target", String(id));
        sheet.appendChild(btn.el);
      }
    };
    const showGive = (targetId: number): void => {
      sheet.replaceChildren();
      for (const give of swapGiveChoices(pid)) {
        const gdef = ITEM_DEFS[give];
        const btn = ui.button({
          label: `Give ${gdef?.icon ?? ""} ${gdef?.name ?? give}`,
          kind: "primary",
          size: "sm",
          ariaLabel: `Give ${gdef?.name ?? give}`,
          onClick: () => showTake(targetId, give),
        });
        btn.el.setAttribute("data-swap-give", give);
        sheet.appendChild(btn.el);
      }
    };
    const showTake = (targetId: number, give: string): void => {
      sheet.replaceChildren();
      for (const take of swapTakeChoices(targetId)) {
        const tdef = ITEM_DEFS[take];
        const btn = ui.button({
          label: `Take ${tdef?.icon ?? ""} ${tdef?.name ?? take}`,
          kind: "gold",
          size: "sm",
          ariaLabel: `Take ${tdef?.name ?? take}`,
          onClick: () => commit(targetId, { give, take }),
        });
        btn.el.setAttribute("data-swap-take", take);
        sheet.appendChild(btn.el);
      }
    };
    showPlayers();
    S.itemPopup = ui.popup({
      title: def?.name ?? "ITEM",
      body: def?.desc ?? "Choose a rival.",
      content: sheet,
      sound: null,
      closeOnEsc: false,
      buttons: [{ label: "CANCEL", kind: "ghost", onClick: cancel }],
    });
  };

  const useItemPressed = (pid: number, key: string): void => {
    if (S.phase !== "dice" || S.rolling || S.itemResolving) return;
    if (TARGET_PICK.has(key)) {
      const aim = decisions.aim(pid);
      if (aim === "picker") {
        openTargetPicker(pid, key);
        return;
      }
      if (aim === "wait") return;
      publishLocal(pid, { kind: "item", playerId: pid, key });
      finishBarUse(pid, useItem(pid, key));
      return;
    }
    publishLocal(pid, { kind: "item", playerId: pid, key });
    finishBarUse(pid, useItem(pid, key));
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
      if (decisions.usesRollButton(pid)) {
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
    const gate = netGate(pid);
    if (gate === "assist") {
      publishChoice({ kind: "star", playerId: pid, auto: true, count: 0 });
      commit(sensibleStarCount(pid));
      return;
    }
    if (gate === "remote") {
      S.netStar = {
        pid,
        commit,
        pass: () => {
          ui.toast("Maybe next time!", { durationMs: 1200 });
          then();
        },
      };
      pumpNet();
      return;
    }
    const bundle = decisions.starBundle(pid);
    if (!isPending(bundle)) {
      commit(bundle.count);
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
    S.starAutoCommit = () => choose(() => {
      const again = decisions.starBundle(pid);
      commit(isPending(again) ? sensibleStarCount(pid) : again.count);
    });
    for (let n = 1; n <= settings.starBundleMax; n++) {
      const count = n;
      const btn = ui.button({
        label: `★${count}`,
        kind: "gold",
        size: "sm",
        ariaLabel: `Buy ${count} star${count === 1 ? "" : "s"} for ${count * settings.starCost} coins`,
        onClick: () => choose(() => {
          publishLocal(pid, { kind: "star", playerId: pid, count });
          commit(count);
        }),
      });
      row.appendChild(btn.el);
    }
    const pass = ui.button({
      label: "PASS",
      kind: "ghost",
      size: "sm",
      onClick: () => choose(() => {
        publishLocal(pid, { kind: "star", playerId: pid, count: 0, pass: true });
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

  const toastShop = (decision: ShopDecision): void => {
    const def = ITEM_DEFS[decision.key];
    const label = def?.name ?? decision.key;
    ui.toast(decision.placedOn !== undefined ? `Set ${label}!` : `Bought ${label}!`, { durationMs: 1500 });
  };

  /**
   * Offer the gumball shop, then continue (finish the landing, or keep hopping).
   * The human gets the stall and chooses. CPUs, and the human while
   * `__SSP__.autoplay(true)` is on, buy one affordable item or leave — no modal,
   * so a pass never waits on a click. If autoplay flips on mid-visit, the stall
   * closes and that same decision runs when they bought nothing yet.
   */
  const offerShop = (pid: number, then: () => void): void => {
    const done = (): void => {
      if (S.disposed) return;
      refreshHud();
      then();
    };
    // The player already stands on the shop (land and pass), so this picks its stock.
    const space = match.players[pid].space;
    const gate = netGate(pid);
    if (gate === "assist") {
      publishChoice({ kind: "shop", playerId: pid, auto: true });
      const decision = decideShopPurchase(pid, space);
      if (decision) toastShop(decision);
      else ui.toast("Just looking!", { durationMs: 900 });
      done();
      return;
    }
    if (gate === "remote") {
      S.netShop = { pid, space, done };
      pumpNet();
      return;
    }
    const trapsBefore = match.traps.length;
    const autoShop = decisions.shop(pid);
    if (!isPending(autoShop)) {
      if (autoShop.decision) toastShop(autoShop.decision);
      else ui.toast("Just looking!", { durationMs: 900 });
      done();
      return;
    }
    S.shopOpen = true;
    S.shopDecideOnClose = false;
    rollButton.setEnabled(false);
    S.shopAutoCommit = () => {
      S.shopDecideOnClose = true;
      const btn = document.querySelector<HTMLElement>("[data-shop-close]");
      if (btn) {
        btn.click();
        return;
      }
      S.shopOpen = false;
      S.shopAutoCommit = null;
      const choice = decisions.shop(pid);
      if (!isPending(choice) && choice.decision) toastShop(choice.decision);
      else if (!isPending(choice)) ui.toast("Just looking!", { durationMs: 900 });
      audio.music.play("board", { intensity: boardIntensity() });
      done();
    };
    // The stall has its own cheerful music-box jingle while the human is choosing.
    audio.music.play("shop", { intensity: 0.35 });
    openShop(pid, { shopSpace: space })
      .then((res) => {
        if (S.disposed) return;
        S.shopOpen = false;
        S.shopAutoCommit = null;
        audio.music.play("board", { intensity: boardIntensity() });
        if (gate === "human") {
          const traps = match.traps.slice(trapsBefore).map((t) => ({ space: t.space, kind: t.kind }));
          publishChoice({ kind: "shop", playerId: pid, bought: res.bought, traps });
        }
        const force = S.shopDecideOnClose;
        S.shopDecideOnClose = false;
        if (force && res.bought.length === 0) {
          const choice = decisions.shop(pid);
          if (!isPending(choice) && choice.decision) toastShop(choice.decision);
          else ui.toast("Just looking!", { durationMs: 900 });
        } else {
          for (const key of res.bought) {
            const def = ITEM_DEFS[key];
            ui.toast(`Bought ${def?.name ?? key}!`, { durationMs: 1600 });
          }
        }
        done();
      })
      .catch(() => {
        if (S.disposed) return;
        S.shopOpen = false;
        S.shopAutoCommit = null;
        S.shopDecideOnClose = false;
        audio.music.play("board", { intensity: boardIntensity() });
        done();
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
            ? ahead(activeBoard(), player.space, outcome.moveBy)
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
      startMoving([ahead(activeBoard(), player.space, outcome.moveBy)], "done");
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

  /** Round rollover: next turn, then fresh gumball stock (fixed rng draws, every peer). */
  const advanceRound = (): void => {
    match.turn += 1;
    restockShops(match);
  };

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
      advanceRound();
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
    // Roulette uses the packs players actually own. Disabled packs never deal
    // (the registry reads the host's saved rotation).
    const playerPacks: Record<number, string> = {};
    for (const p of match.players) {
      if (p.pack) playerPacks[p.id] = p.pack;
    }
    const luckyPlayers = takeLuckyPlayers();
    const mg = tryPickMinigame(playerPacks, luckyPlayers);
    if (!mg) {
      // No minigames registered yet — toast and carry on.
      ui.toast("Minigames arrive in Wave 3!", { durationMs: 2200 });
      advanceRound();
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
    advanceRound();
    match.lastMinigameId = mg.id;
    match.lastMinigamePack = mg.pack ?? "midway";
    if (onlineMatch()) {
      checkpoint("minigame");
      if (isHost()) {
        resumeFromMinigame = true;
        setPendingMinigame(mg);
        skipNextMinigamePreScreen();
        setCpuPlayout(true);
        screens.goto("minigame");
      } else {
        ui.toast("CPUs are playing this one. The host's ranking counts.", { durationMs: 2600 });
        onOfficialMinigame((result) => {
          match.minigameDice = result.minigameDice
            ? { turn: result.minigameDice.turn, ids: [...result.minigameDice.ids] }
            : null;
          awardMinigameResult(result.ranking, result.coinWinners);
          if (match.turn > match.totalTurns) results();
          else beginTurn();
        });
      }
      return;
    }
    resumeFromMinigame = true;
    setPendingMinigame(mg);

    const coins = minigameCoinAward(mg.pack);
    const baseDesc = (mg as { description?: string }).description || getMinigameDescription(mg.id, mg.name);
    const desc = `${baseDesc} Winner takes ${coins} coins.`;
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
    checkpoint("end");
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
        hud.showBanner(`★ ${bonusStarLabel(b.star)} → ${playerLabel(b.playerId)}!`, { durationMs: 1900 });
      });
    }
    steps.push(() => {
      const entries = finalRanking();
      const winner = match.players[entries[0]?.playerId ?? 0];
      audio.music.play("results", { intensity: 0.85 });
      audio.sfx.play("fanfare.win");
      ui.confettiBurst(undefined, undefined, { count: 140, sound: null });
      hud.showBanner(`WINNER: ${winner ? playerLabel(winner.id) : "?"}!`, { durationMs: 2600 });
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
        row.textContent = `${i + 1}. ${p ? playerLabel(p.id) : "?"}  ★${r.stars} · ${r.coins}c${tags ? `  ${tags}` : ""}`;
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
    // Same for the stall: close it and let the automatic visit decide.
    if (isAutoplay() && S.shopOpen && S.shopAutoCommit) {
      const fn = S.shopAutoCommit;
      S.shopAutoCommit = null;
      fn();
      return;
    }
    if (isAutoplay() && S.poisonAutoCommit) {
      const fn = S.poisonAutoCommit;
      S.poisonAutoCommit = null;
      fn();
      return;
    }
    if (isAutoplay() && S.itemAutoCommit) {
      const fn = S.itemAutoCommit;
      S.itemAutoCommit = null;
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
            // Ending the move on someone else's space: everyone there gets the hug.
            // Coins land before the space effect, so they can fund a star or a shop.
            playCarnivalSqueeze(pid);
            if (S.afterMove === "effect") enterSpaceEffect(pid);
            else finishTurn();
          } else {
            // Pass fires stamps, minigame balloons, the Grand Prize Balloon, and shops.
            // Red, blue, green, and grumpus stay land-only.
            const resumeMove = (): void => {
              const branch = forkAt(S.hopTo);
              const hopsLeft = S.moveQueue.length - S.moveIdx;
              if (branch !== undefined && hopsLeft > 0) offerJunction(pid, hopsLeft);
              else startHop(pid);
            };
            arriveCarnival(pid, S.hopTo, false);
            const afterPrize = (): void => {
              if (board.spaceType(S.hopTo) === "shop") offerShop(pid, resumeMove);
              else resumeMove();
            };
            if (S.hopTo === match.starBalloonPos) offerPrizeBalloon(pid, afterPrize);
            else afterPrize();
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
    pumpNet();
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
    S.shopAutoCommit = null;
    S.shopDecideOnClose = false;
    S.itemPopup?.destroy();
    S.itemPopup = null;
    S.itemAutoCommit = null;
    S.poisonPopup?.destroy();
    S.poisonPopup = null;
    S.poisonAutoCommit = null;
    liveLoop = null;
  };

  const loop: TurnLoop = {
    start,
    update,
    rollPressed,
    isWaitingForRoll: (): boolean =>
      S.phase === "dice" &&
      !S.rolling &&
      S.betweenRolls <= 0 &&
      !S.shopOpen &&
      !S.starPopup &&
      !S.starCeremony &&
      !S.itemResolving &&
      !S.itemPopup &&
      !S.poisonPopup,
    get phase(): LoopPhase {
      return S.phase;
    },
    get moveCountdown() {
      if (S.phase !== "moving" || !countedWalk || S.shopOpen || S.starCeremony || S.starPopup) return null;
      const left = S.moveQueue.length - S.moveIdx + (S.hopActive ? 1 : 0);
      return left > 0 ? { pid: match.currentPlayer, left } : null;
    },
    dispose,
  };

  liveLoop = loop;
  return loop;
}

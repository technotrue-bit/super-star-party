/**
 * SUPER STAR PARTY — turn loop: the match phase machine.
 *
 *   announce -> dice -> moving -> space-effect -> (next player)
 *            -> minigame-round -> ... -> results -> ended
 *
 * Owns ALL match-flow logic: dice (deterministic rng + forced-dice debug
 * hook), per-tile hop movement with the Funhouse Cut shortcut, space effects
 * (blue / red / star / shop / green / grumpus), item use before rolling,
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
import { addCoins, tryBuyStar, computeBonusStars, finalRanking } from "./economy";
import { resolveGreen, resolveGrumpus, consumeFreeStar, consumeDoubleBlue } from "./happenings";
import { ITEM_DEFS, canUseItem, useItem } from "./items";
import { openShop } from "../screens/shopScreen";
import { tryPickMinigame } from "../minigames/registry";
import { screens } from "../screens/screenManager";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Player 0 is the human; CPU players auto-roll. */
const HUMAN = 0;

/** Board constants (Fizzy Fairground). */
const N = fizzyFairground.spaces.length;
const SC = fizzyFairground.shortcut;

/** Per-player stand offsets on a shared space (MP7-style 2x2 grid). */
export const PLAYER_OFFSETS: ReadonlyArray<[number, number]> = [
  [0.0, 0.0],
  [0.6, 0.0],
  [0.0, 0.6],
  [0.6, 0.6],
];

const wrap = (i: number): number => ((i % N) + N) % N;

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
  /** World pos -> CSS pixel coords (confetti at a space). */
  projectToScreen(pos: THREE.Vector3): { x: number; y: number } | null;
  /** Quick full-screen color flash (Grumpus lava). */
  flashOverlay(color: string): void;
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

/* ------------------------------------------------------------------ */
/*  Autoplay hook (drives the human's roll)                            */
/* ------------------------------------------------------------------ */

let liveLoop: TurnLoop | null = null;

setAutoplayHook(() => {
  const l = liveLoop;
  if (l && l.isWaitingForRoll() && match.currentPlayer === HUMAN) l.rollPressed();
});

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createTurnLoop(deps: TurnLoopDeps): TurnLoop {
  const { board, chars, hud, rollButton, dice, itemBar, punchCamera, projectToScreen, flashOverlay } = deps;

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
    // results
    resultSteps: Array<() => void>;
    resultTimer: number;
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
    resultSteps: [],
    resultTimer: 0,
  };

  let stingerTO: number | null = null;

  /* ---------------- helpers ---------------- */

  const pause = (seconds: number, fn: () => void): void => {
    S.pauseT = seconds;
    S.pauseFn = fn;
  };

  const boardIntensity = (): number => (S.phase === "moving" ? 0.65 : 0.5);

  /** One-shot music stinger that restores the board track. */
  const stinger = (track: string, ms: number): void => {
    audio.music.play(track, { intensity: 0.75 });
    if (stingerTO !== null) window.clearTimeout(stingerTO);
    stingerTO = window.setTimeout(() => {
      stingerTO = null;
      if (!S.disposed && S.phase !== "results" && S.phase !== "ended") {
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
    dice.hide();
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
      let cur = player.space;
      for (let i = 0; i < total; i++) {
        let nxt = wrap(cur + 1);
        if (SC && nxt === SC.from) nxt = SC.to; // Funhouse Cut!
        S.moveQueue.push(nxt);
        cur = nxt;
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
        hud.showBanner("-3!", { durationMs: 1400 });
        chars[pid]?.anim.sad();
        break;
      }
      case "star": {
        starSpace(pid);
        return; // popup / async path finishes itself
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
    match.currentPlayer = (match.currentPlayer + 1) % match.players.length;
    if (match.currentPlayer === 0) minigameRound();
    else beginTurn();
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
    dice.show();
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
      pause(0.5, () => {
        S.rolling = false;
        dice.hide();
        startMoving([], "effect", total);
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

  const celebrateStar = (pid: number): void => {
    stinger("star_fanfare", 2800);
    ui.confettiBurst(undefined, undefined, { count: 120, sound: null });
    hud.showBanner("STAR!", { durationMs: 1900 });
    chars[pid]?.anim.cheer();
    refreshHud();
  };

  const starSpace = (pid: number): void => {
    const player = match.players[pid];
    if (!player) {
      finishEffect();
      return;
    }
    // star_magnet happening: next star is free
    if (consumeFreeStar(pid)) {
      player.stars += 1;
      bus.emit("star:buy", { player: pid, star: player.stars, total: player.coins });
      audio.sfx.play("star.get");
      celebrateStar(pid);
      finishEffect();
      return;
    }
    if (player.coins < settings.starCost) {
      ui.toast("A star costs 20 coins!", { durationMs: 2000 });
      finishEffect();
      return;
    }
    if (pid === HUMAN && !isAutoplay()) {
      S.starPopup = ui.popup({
        title: "BUY A STAR?",
        body: `${player.name}, a star costs ${settings.starCost} coins. Buy it?`,
        sound: null,
        buttons: [
          {
            label: `BUY ★ ${settings.starCost}`,
            kind: "gold",
            onClick: () => {
              S.starPopup?.destroy();
              S.starPopup = null;
              doStarBuy(pid);
            },
          },
          {
            label: "NO",
            kind: "ghost",
            onClick: () => {
              S.starPopup?.destroy();
              S.starPopup = null;
              ui.toast("Maybe next time!", { durationMs: 1200 });
              finishEffect();
            },
          },
        ],
      });
    } else {
      doStarBuy(pid);
    }
  };

  const doStarBuy = (pid: number): void => {
    if (tryBuyStar(pid)) celebrateStar(pid);
    else ui.toast("Not enough coins!", { durationMs: 1600 });
    finishEffect();
  };

  const shopSpace = (pid: number): void => {
    S.shopOpen = true;
    rollButton.setEnabled(false);
    // Autoplay runs must never stall on the modal shop.
    const shopPromise: Promise<{ bought: string[] }> = isAutoplay()
      ? new Promise((res) => window.setTimeout(() => res({ bought: [] }), 900))
      : openShop(pid);
    shopPromise
      .then((res) => {
        if (S.disposed) return;
        S.shopOpen = false;
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
      flashOverlay("#FF5A3C"); // lava flash
      chars[pid]?.anim.sad();
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
    } else {
      finishTurn();
    }
  };

  /* ---------------- minigame round ---------------- */

  const minigameRound = (): void => {
    S.phase = "minigame-round";
    match.phase = "minigame";
    rollButton.setVisible(false);
    refreshHud();
    const mg = tryPickMinigame();
    if (!mg) {
      ui.toast("Minigames arrive in Wave 3!", { durationMs: 2200 });
    } else {
      ui.toast(`Minigame: ${mg.name} — Wave 3 incoming`, { durationMs: 2600 });
      bus.emit("minigame:start", { id: mg.id, name: mg.name });
      stinger("minigame_intro", 2400);
    }
    match.turn += 1;
    if (match.turn > match.totalTurns) {
      results();
    } else {
      pause(0.9, beginTurn);
    }
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
        hud.showBanner(
          b.star === "mini" ? `★ MINI STAR → ${p.name}!` : `★ COIN STAR → ${p.name}!`,
          { durationMs: 1900 }
        );
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
        const tags = r.bonus.map((b) => (b === "mini" ? "★mini" : "★coin")).join(" ");
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
            startHop(pid);
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
    if (match.players.length > 0) beginTurn();
    else S.phase = "ended";
  };

  const dispose = (): void => {
    S.disposed = true;
    if (stingerTO !== null) {
      window.clearTimeout(stingerTO);
      stingerTO = null;
    }
    S.starPopup?.destroy();
    S.starPopup = null;
    liveLoop = null;
  };

  const loop: TurnLoop = {
    start,
    update,
    rollPressed,
    isWaitingForRoll: (): boolean =>
      S.phase === "dice" && !S.rolling && S.betweenRolls <= 0 && !S.shopOpen,
    get phase(): LoopPhase {
      return S.phase;
    },
    dispose,
  };

  liveLoop = loop;
  return loop;
}

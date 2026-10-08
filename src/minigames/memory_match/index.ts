/**
 * SUPER STAR PARTY — MEMORY MATCH (memory).
 *
 * MP7 reference: Mushroom Mix-Up (memorize and match). Turn-based 4x4
 * pairs on a wooden table: players act in order 0,1,2,3 — a turn is two
 * card flips. Match -> pair stays up, +1 pair, same player goes again.
 * Mismatch -> cards flip back, turn passes. First to 4 pairs wins; at the
 * time cap the leaderboard is pairs (desc), flips (asc), playerId (asc).
 *
 * CPU model (players 1-3, and player 0 under autoplay): each CPU keeps a
 * memory map; every revealed card is remembered with probability p=0.78
 * (ctx.rng). On its turn it flips a known pair when it has one, else a
 * remembered card + a random unknown, else two random unknowns — credible,
 * never psychic, wins sometimes.
 *
 * Determinism: deck shuffle, CPU memory rolls, CPU picks, AFK fallback and
 * particle spawns all consume ONLY ctx.rng. No Math.random / Date.now.
 * Play advances in fixed 1/60 steps so a fat frame cannot finish a phase
 * and throw away the leftover. The time cap then lands on the same turn
 * on every client (a tied scoreboard was splitting on flip count).
 *
 * Self-registration: the framework blesses module-side registration
 * ("modules may also call registerMinigame themselves"). This module
 * pushes its own loader + registry entry at import time, so it is playable
 * the moment it is loaded; the orchestrator's index.ts wiring (if any) is
 * deduped by id and by the loader guard below.
 */
import * as THREE from "three";
import type { Minigame, MinigameContext } from "../framework";
import { MINIGAME_MODULES } from "../index";
import { registerMinigame } from "../registry";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import {
  CARD_H,
  GRID_COLS,
  GRID_ROWS,
  TABLE_TOP_Y,
  gridPos,
  ICON_IDS,
  createCardMesh,
  buildTable,
  createStarBurst,
  starSpriteTexture,
} from "./cards";

/* ------------------------------------------------------------------ */
/*  Tunables                                                           */
/* ------------------------------------------------------------------ */

const PAIRS = 8; // 8 pairs / 16 cards
const WIN_PAIRS = 4; // first to 4 pairs wins
const CPU_MEMORY_P = 0.78; // chance a revealed card sticks in a CPU's memory
const TIME_CAP = 27; // framework hard-stops at settings.minigameTimeLimit (30s) —
// finish on our own ranking before then. (Design doc said 90s; that is
// unreachable under the live screen's 30s safety net, which would force
// an id-order ranking — see REPORT.) Worst-case finish = CAP + 1.54s of
// in-flight turn + 0.95s beat = 29.49s < 30s. A hard floor guard at 29.2s
// below catches any drift.
const INTRO_TIME = 1.5; // staggered grid pop-in
const TURN_START_BEAT = 0.55;
const FLIP_TIME = 0.22;
const MISMATCH_HOLD = 0.7; // face-up reveal hold before a mismatch flips back
const CPU_THINK1 = 0.0; // pick is computed instantly at turnStart expiry
const CPU_THINK2 = 0.0;
const RESOLVE_TIME = 0.55;
const TURN_END_TIME = 0.55; // flip-back overlaps this beat
const WIN_TIME = 1.15;
const TIMEUP_TIME = 0.95;
const HARD_FINISH = 29.2; // absolute floor: finish before the screen's 30s net
const HUMAN_AFK = 8; // safety: auto-flip if the human idles this long
const SIM_STEP = 1 / 60;
// maxDelta (1/20) × critic speed 4 = 0.2s, exactly 12 steps. Dropping the
// leftover keeps a stalled frame from banking time past the screen limit.
const MAX_SIM_STEPS = 12;

const CARD_BASE_Y = TABLE_TOP_Y + CARD_H / 2;
const CHARS_Z = -5.1; // characters stand behind the table

type Phase =
  | "intro"
  | "turnStart"
  | "awaitFirst"
  | "flip1"
  | "awaitSecond"
  | "flip2"
  | "resolve"
  | "turnEnd"
  | "win"
  | "timeup";

type FlipPhase =
  | "idle"
  | "flipping" // tween flipFrom -> targetRotY; runs to completion + exact snap
  | "revealed"; // face-up, holding; flips back when holdT expires (mismatch)

interface Card {
  index: number;
  pair: number;
  mesh: THREE.Mesh;
  state: "down" | "up" | "matched";
  rotY: number;
  /** Per-card flip state machine — driven by its OWN timer in update(),
   *  NEVER cancelled by phase/turn changes, always ends snapped to 0/PI. */
  flipPhase: FlipPhase;
  flipFrom: number;
  targetRotY: number;
  flipT: number; // seconds into the current "flipping" segment
  holdT: number; // seconds left in the "revealed" hold (0 when not holding)
  pendingDown: boolean; // flip-up landing should hold, then flip back down
  wobbleT: number; // mismatch shake 1 -> 0
  pulseT: number; // match pop 1 -> 0
  popT: number; // grid pop-in clock (starts negative = stagger)
}

interface Pip {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
}

interface MemoryMatchState {
  ctx: MinigameContext;
  root: THREE.Group;
  cards: Card[];
  phase: Phase;
  phaseT: number;
  turn: number; // active player id
  scores: number[]; // pairs per player
  flips: number[]; // flips per player
  known: Set<number>[]; // per-player remembered card indices
  flipped: number[]; // card indices flipped this turn
  winRanking: number[] | null;
  finished: boolean;
  humanCpu: boolean; // autoplay: player 0 is CPU-driven
  afkT: number; // human idle timer
  cursorR: number;
  cursorC: number;
  time: number; // stepped play clock (the time cap reads this, not frame dt)
  accum: number; // leftover frame time waiting for the next 1/60 step
  stepping: boolean; // true while update() is inside a 1/60 slice
  raycaster: THREE.Raycaster;
  ndc: THREE.Vector2;
  cursorRing: THREE.Mesh;
  activeRing: THREE.Mesh;
  pips: Pip[][];
  burst: ReturnType<typeof createStarBurst>;
  table: ReturnType<typeof buildTable>;
  introDone: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function playerColorHex(ctx: MinigameContext, id: number): number {
  return hex(ctx.players[id]?.color ?? palette.sun);
}

function makeRing(inner: number, outer: number, color: number): THREE.Mesh {
  const mat = new THREE.MeshToonMaterial({ color });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  The minigame                                                       */
/* ------------------------------------------------------------------ */

const memoryMatch: Minigame = {
  id: "memory_match",
  name: "Memory Match",
  genre: "memory",
  howTo: "Tap two cards to flip them. Whoever finds the most pairs wins.",

  setup(ctx: MinigameContext) {
    const st: MemoryMatchState = {
      ctx,
      root: new THREE.Group(),
      cards: [],
      phase: "intro",
      phaseT: 0,
      turn: 0,
      scores: [0, 0, 0, 0],
      flips: [0, 0, 0, 0],
      known: [new Set(), new Set(), new Set(), new Set()],
      flipped: [],
      winRanking: null,
      finished: false,
      humanCpu: isAutoplay(),
      afkT: 0,
      cursorR: 1,
      cursorC: 1,
      time: 0,
      accum: 0,
      stepping: false,
      raycaster: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      cursorRing: makeRing(0.4, 0.52, hex(palette.sun)),
      activeRing: makeRing(0.46, 0.58, hex(palette.sun)),
      pips: [],
      burst: createStarBurst(ctx.scene, 64, ctx.rng),
      table: buildTable(),
      introDone: false,
    };
    ctx.scene.add(st.root);
    st.root.add(st.table.group);

    /* ---- table felt + cursor/active rings ---- */
    st.cursorRing.position.set(0, TABLE_TOP_Y + 0.02, 0);
    st.cursorRing.visible = false;
    st.root.add(st.cursorRing);
    st.activeRing.position.set(0, 0.03, CHARS_Z);
    st.activeRing.visible = false;
    st.root.add(st.activeRing);

    /* ---- deterministic deck: 8 pairs, Fisher-Yates via ctx.rng ---- */
    const deck: number[] = [];
    for (let p = 0; p < PAIRS; p++) deck.push(p, p);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    st.cards = deck.map((pair, index) => {
      const { x, z } = gridPos(Math.floor(index / GRID_COLS), index % GRID_COLS);
      const cm = createCardMesh(ICON_IDS[pair]);
      cm.mesh.position.set(x, CARD_BASE_Y, z);
      cm.mesh.scale.setScalar(0.001);
      st.root.add(cm.mesh);
      return {
        index,
        pair,
        mesh: cm.mesh,
        state: "down" as const,
        rotY: 0,
        flipPhase: "idle" as const,
        flipFrom: 0,
        targetRotY: 0,
        flipT: 0,
        holdT: 0,
        pendingDown: false,
        wobbleT: 0,
        pulseT: 0,
        popT: -index * 0.07, // staggered pop-in
      };
    });

    /* ---- characters: row behind the table, facing the grid ---- */
    for (let i = 0; i < 4; i++) {
      const ch = ctx.characters[i];
      if (!ch) continue;
      ch.group.position.set((i - 1.5) * 2.0, 0, CHARS_Z);
      ch.setFacing(0); // front is +Z -> faces the table
      ch.anim.idle();
    }

    /* ---- per-player pair pips (4 gold stars above each head) ---- */
    for (let p = 0; p < 4; p++) {
      const row: Pip[] = [];
      for (let s = 0; s < 4; s++) {
        const mat = new THREE.SpriteMaterial({
          map: starSpriteTexture,
          color: hex(palette.inkSoft),
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.setScalar(0.22);
        sprite.position.set((p - 1.5) * 2.0 + (s - 1.5) * 0.28, 1.62, CHARS_Z + 0.42);
        st.root.add(sprite);
        row.push({ sprite, mat });
      }
      st.pips.push(row);
    }

    /* ---- fixed 3/4 party camera over the table ---- */
    const portrait = window.innerWidth / window.innerHeight < 1;
    const cam = ctx.camera;
    cam.position.set(0, portrait ? 8.8 : 7.4, portrait ? 10.9 : 8.8);
    cam.lookAt(0, 1.0, 0);

    /* ---- intro banner + input handlers ---- */
    ctx.announce("MATCH THE PAIRS!", { durationMs: 1500, sound: null });

    ctx.input.pointer = (x: number, y: number, down: boolean): void => {
      if (!down) return;
      if (st.phase !== "awaitFirst" && st.phase !== "awaitSecond") return;
      if (st.turn !== 0) return;
      if (!st.introDone) return;
      const hit = cardUnderPointer(st, x, y);
      if (hit !== null && hit.state === "down") {
        doHumanFlip(st, hit.index);
      }
    };

    ctx.input.key = (action: string): void => {
      if (st.phase !== "awaitFirst" && st.phase !== "awaitSecond") return;
      if (st.turn !== 0) return;
      if (!st.introDone) return;
      if (action === "left") st.cursorC = (st.cursorC + GRID_COLS - 1) % GRID_COLS;
      else if (action === "right") st.cursorC = (st.cursorC + 1) % GRID_COLS;
      else if (action === "up") st.cursorR = (st.cursorR + GRID_ROWS - 1) % GRID_ROWS;
      else if (action === "down") st.cursorR = (st.cursorR + 1) % GRID_ROWS;
      else if (action === "confirm") {
        const idx = st.cursorR * GRID_COLS + st.cursorC;
        if (st.cards[idx] && st.cards[idx].state === "down") doHumanFlip(st, idx);
        return;
      } else return;
      ctx.playSfx("ui.click", { volume: 0.35, pitch: 3 });
      placeCursorRing(st);
    };

    // The framework keeps this instance cached; per-round state lives in
    // the closure above. Store it for update()/teardown().
    (memoryMatch as unknown as { _st?: MemoryMatchState })._st = st;

    /* ---- critic probe: live card-rotation audit (read-only) ---- */
    const ssp = (window as unknown as { __SSP__?: { auditMemoryCards?: () => unknown } }).__SSP__;
    if (ssp) {
      ssp.auditMemoryCards = () =>
        st.cards.map((c) => ({
          index: c.index,
          pair: c.pair,
          state: c.state,
          flipPhase: c.flipPhase,
          rotY: +c.mesh.rotation.y.toFixed(4), // the LIVE mesh value
        }));
    }
  },

  update(dt: number) {
    const st = (memoryMatch as unknown as { _st?: MemoryMatchState })._st;
    if (!st || st.finished) return;
    // Substep a variable frame into 1/60 slices. The recursive call runs the
    // body once; the flag stops it from slicing again.
    if (!st.stepping) {
      st.accum += dt;
      let steps = 0;
      st.stepping = true;
      try {
        while (st.accum + 1e-6 >= SIM_STEP && steps < MAX_SIM_STEPS && !st.finished) {
          st.accum -= SIM_STEP;
          steps += 1;
          this.update(SIM_STEP);
        }
        if (steps >= MAX_SIM_STEPS && st.accum >= SIM_STEP) st.accum = 0;
      } finally {
        st.stepping = false;
      }
      return;
    }
    const ctx = st.ctx;
    st.time += dt;
    st.phaseT += dt;

    /* ---- card animation pass ---- */
    for (const card of st.cards) {
      if (st.phase === "intro" && card.popT < 1) card.popT += dt / 0.35;
      const popK = Math.min(1, Math.max(0, card.popT));
      const popScale = easeOutBack(popK);

      // Per-card flip machine: driven by its OWN timer, runs in EVERY phase
      // (play, timeup, win alike) and CANNOT be cancelled by turn changes.
      // Every flip ends with an exact snap to 0 (face-down) or PI (face-up).
      if (card.flipPhase === "flipping") {
        card.flipT += dt;
        if (card.flipT >= FLIP_TIME) {
          card.rotY = card.targetRotY; // final snap — no accumulation drift
          if (card.targetRotY === Math.PI && card.pendingDown) {
            card.pendingDown = false;
            card.flipPhase = "revealed";
            card.holdT = MISMATCH_HOLD;
          } else {
            card.flipPhase = "idle";
          }
        } else {
          const k = easeOutBack(card.flipT / FLIP_TIME);
          card.rotY = card.flipFrom + (card.targetRotY - card.flipFrom) * k;
        }
      } else if (card.flipPhase === "revealed") {
        card.holdT -= dt;
        if (card.holdT <= 0) {
          // Uninterruptible flip-back from exactly PI.
          card.flipFrom = Math.PI;
          card.targetRotY = 0;
          card.flipT = 0;
          card.flipPhase = "flipping";
        }
      }
      if (card.wobbleT > 0) card.wobbleT = Math.max(0, card.wobbleT - dt / 0.3);
      if (card.pulseT > 0) card.pulseT = Math.max(0, card.pulseT - dt / 0.3);

      const flipK =
        card.flipPhase === "flipping"
          ? Math.min(1, card.flipT / FLIP_TIME)
          : card.flipPhase === "revealed"
            ? 1
            : 0;
      const flipPop = flipK > 0 ? 1 + 0.1 * Math.sin(Math.PI * flipK) : 1;
      const pulse = card.pulseT > 0 ? 1 + 0.16 * card.pulseT : 1;
      const wobble = card.wobbleT > 0 ? Math.sin(card.wobbleT * Math.PI * 6) * 0.08 * card.wobbleT : 0;
      card.mesh.rotation.y = card.rotY;
      card.mesh.rotation.z = wobble;
      card.mesh.scale.setScalar(Math.max(0.0001, popScale * flipPop * pulse));
    }

    /* ---- ring pulse + cursor bob (idle life) ---- */
    const pulse = 1 + 0.1 * Math.sin(st.time * 5);
    st.activeRing.scale.setScalar(pulse);
    st.cursorRing.scale.setScalar(1 + 0.12 * Math.sin(st.time * 6));
    const curIdx = st.cursorR * GRID_COLS + st.cursorC;
    const curCard = st.cards[curIdx];
    if (st.cursorRing.visible && st.phase === "awaitFirst" && curCard) {
      curCard.mesh.position.y = CARD_BASE_Y + 0.05 * Math.sin(st.time * 7);
    } else if (curCard && curCard.mesh.position.y !== CARD_BASE_Y) {
      curCard.mesh.position.y = CARD_BASE_Y;
    }

    /* ---- time cap: interrupt cleanly on our own ranking ---- */
    if (
      st.time >= TIME_CAP &&
      st.phase !== "win" &&
      st.phase !== "timeup" &&
      st.phase !== "intro"
    ) {
      maybeTimeUp(st);
    }

    /* ---- phase machine ---- */
    switch (st.phase) {
      case "intro": {
        if (st.phaseT >= INTRO_TIME) {
          st.introDone = true;
          st.phase = "turnStart";
          st.phaseT = 0;
          startTurn(st);
        }
        break;
      }
      case "turnStart": {
        if (st.phaseT >= TURN_START_BEAT) {
          st.phaseT = 0;
          if (isCpuTurn(st)) {
            const pick = cpuPickFirst(st);
            if (pick !== null) {
              flipUp(st, pick);
              if (st.flipped.length === 1) st.phase = "flip1";
            }
          } else {
            st.phase = "awaitFirst";
            st.afkT = 0;
          }
        }
        break;
      }
      case "awaitFirst": {
        if (st.phaseT >= st.afkT + HUMAN_AFK) {
          // Idle human: deterministic AFK auto-flip so play never stalls.
          const down = faceDownCards(st);
          if (down.length > 0) {
            const pick = down[Math.floor(ctx.rng() * down.length)].index;
            flipUp(st, pick);
            st.phase = "flip1";
            st.phaseT = 0;
          }
        }
        break;
      }
      case "flip1": {
        if (st.phaseT >= FLIP_TIME) {
          st.phaseT = 0;
          rememberReveal(st, st.flipped[0]);
          if (isCpuTurn(st)) {
            const pick = cpuPickSecond(st, st.cards[st.flipped[0]]);
            if (pick !== null) {
              flipUp(st, pick);
              st.phase = "flip2";
            }
          } else {
            st.phase = "awaitSecond";
            st.afkT = 0;
          }
        }
        break;
      }
      case "awaitSecond": {
        if (st.phaseT >= st.afkT + HUMAN_AFK) {
          const down = faceDownCards(st);
          if (down.length > 0) {
            const pick = down[Math.floor(ctx.rng() * down.length)].index;
            flipUp(st, pick);
            st.phase = "flip2";
            st.phaseT = 0;
          }
        }
        break;
      }
      case "flip2": {
        if (st.phaseT >= FLIP_TIME) {
          st.phaseT = 0;
          rememberReveal(st, st.flipped[1]);
          st.phase = "resolve";
          resolveTurn(st);
        }
        break;
      }
      case "resolve": {
        if (st.phaseT >= RESOLVE_TIME) {
          st.phaseT = 0;
          const matched = st.cards[st.flipped[0]]?.state === "matched";
          if (matched) {
            if (st.scores[st.turn] >= WIN_PAIRS) {
              st.winRanking = computeRanking(st);
              startWin(st);
            } else {
              st.flipped = [];
              st.phase = "turnStart";
              startTurn(st);
            }
          } else {
            // flip-backs were already scheduled in resolveTurn; just pass.
            st.flipped = [];
            st.phase = "turnEnd";
          }
        }
        break;
      }
      case "turnEnd": {
        if (st.phaseT >= TURN_END_TIME) {
          st.phaseT = 0;
          if (st.time >= TIME_CAP) {
            maybeTimeUp(st);
          } else {
            st.turn = (st.turn + 1) % 4;
            st.phase = "turnStart";
            startTurn(st);
          }
        }
        break;
      }
      case "win": {
        // Finish only once every card is settled at exactly 0/PI — the
        // freeze frame the critic sees must never contain a half-turned card.
        if (
          (st.phaseT >= WIN_TIME || st.time >= HARD_FINISH) &&
          tableSettled(st) &&
          st.winRanking
        ) {
          st.finished = true;
          ctx.finish(st.winRanking);
        }
        break;
      }
      case "timeup": {
        if (
          (st.phaseT >= TIMEUP_TIME || st.time >= HARD_FINISH) &&
          tableSettled(st) &&
          st.winRanking
        ) {
          st.finished = true;
          ctx.finish(st.winRanking);
        }
        break;
      }
      default:
        break;
    }
  },

  teardown() {
    const st = (memoryMatch as unknown as { _st?: MemoryMatchState })._st;
    if (!st) return;
    const ctx = st.ctx;
    st.root.removeFromParent();
    st.table.dispose();
    st.cursorRing.geometry.dispose();
    (st.cursorRing.material as THREE.Material).dispose();
    st.activeRing.geometry.dispose();
    (st.activeRing.material as THREE.Material).dispose();
    for (const row of st.pips) {
      for (const pip of row) {
        pip.sprite.removeFromParent();
        pip.mat.dispose();
      }
    }
    st.burst.clear();
    for (const ch of ctx.characters) ch.anim.idle();
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};
    const ssp = (window as unknown as { __SSP__?: Record<string, unknown> }).__SSP__;
    if (ssp) delete ssp.auditMemoryCards;
    (memoryMatch as unknown as { _st?: MemoryMatchState })._st = undefined;
  },
};

/* ------------------------------------------------------------------ */
/*  Turn logic                                                         */
/* ------------------------------------------------------------------ */

function isCpuTurn(st: MemoryMatchState): boolean {
  return st.turn !== 0 || st.humanCpu;
}

function faceDownCards(st: MemoryMatchState): Card[] {
  return st.cards.filter((c) => c.state === "down");
}

function startTurn(st: MemoryMatchState): void {
  const ctx = st.ctx;
  ctx.announce(`${ctx.players[st.turn]?.name ?? "?"}'s turn`, { durationMs: 900, sound: null });
  ctx.playSfx("hop", { volume: 0.3, pitch: 2 });
  // move the active-player highlight ring + color it for this player
  const ch = ctx.characters[st.turn];
  st.activeRing.visible = true;
  st.activeRing.position.x = ch ? ch.group.position.x : (st.turn - 1.5) * 2.0;
  (st.activeRing.material as THREE.MeshToonMaterial).color.setHex(playerColorHex(ctx, st.turn));
  ctx.characters[st.turn]?.anim.jump();
  if (st.turn === 0 && !st.humanCpu) {
    placeCursorRing(st);
  } else {
    st.cursorRing.visible = false;
  }
}

function placeCursorRing(st: MemoryMatchState): void {
  const { x, z } = gridPos(st.cursorR, st.cursorC);
  st.cursorRing.position.set(x, TABLE_TOP_Y + 0.02, z);
  st.cursorRing.visible = true;
}

/**
 * Begin (or retarget) a card flip. The per-card machine always runs the
 * tween to completion and snaps the final value, so retargeting mid-flight
 * (e.g. a CPU re-pick) can NEVER leave a card half-turned.
 */
function startFlip(st: MemoryMatchState, index: number, faceUp: boolean): void {
  const card = st.cards[index];
  if (!card || card.state === "matched") return;
  card.flipFrom = card.rotY;
  card.targetRotY = faceUp ? Math.PI : 0;
  card.flipT = 0;
  card.holdT = 0;
  card.pendingDown = false;
  card.flipPhase = "flipping";
}

function flipUp(st: MemoryMatchState, index: number): void {
  const card = st.cards[index];
  if (!card || card.state !== "down") return;
  startFlip(st, index, true);
  card.state = "up";
  st.flipped.push(index);
  st.flips[st.turn] += 1;
  st.ctx.playSfx("whoosh", { volume: 0.45, pitch: 1.15 });
}

/**
 * Schedule a mismatch flip-back: the card holds face-up for MISMATCH_HOLD,
 * then flips back on its own per-card timer. If it is still mid flip-up it
 * holds as soon as it lands. state flips to "down" immediately so rules and
 * picks treat it as unavailable — the VISUAL flip-back is owned by the card
 * machine and cannot be interrupted by phase/turn changes or the time cap.
 */
function flipDown(st: MemoryMatchState, index: number): void {
  const card = st.cards[index];
  if (!card || card.state !== "up") return;
  card.state = "down";
  if (card.flipPhase === "flipping" && card.targetRotY === Math.PI) {
    card.pendingDown = true; // hold once the flip-up lands
    return;
  }
  card.rotY = Math.PI; // snap to exactly face-up before the hold
  card.flipPhase = "revealed";
  card.holdT = MISMATCH_HOLD;
}

/** Every CPU rolls p=0.78 memory on a reveal (including its own flips). */
function rememberReveal(st: MemoryMatchState, index: number): void {
  const cpus = st.humanCpu ? [0, 1, 2, 3] : [1, 2, 3];
  for (const p of cpus) {
    if (!st.known[p].has(index) && st.ctx.rng() < CPU_MEMORY_P) {
      st.known[p].add(index);
    }
  }
}

function knownPair(st: MemoryMatchState, cpu: number): Card[] | null {
  const down = faceDownCards(st);
  const knownDown = down.filter((c) => st.known[cpu].has(c.index));
  for (const c of knownDown) {
    const partner = st.cards.find((x) => x.pair === c.pair && x.index !== c.index);
    if (partner && partner.state === "down" && st.known[cpu].has(partner.index)) {
      return st.ctx.rng() < 0.5 ? [c, partner] : [partner, c];
    }
  }
  return null;
}

function cpuPickFirst(st: MemoryMatchState): number | null {
  const down = faceDownCards(st);
  if (down.length === 0) return null;
  const pair = knownPair(st, st.turn);
  if (pair) return pair[0].index;
  const knownDown = down.filter((c) => st.known[st.turn].has(c.index));
  if (knownDown.length > 0) {
    return knownDown[Math.floor(st.ctx.rng() * knownDown.length)].index;
  }
  const unknown = down.filter((c) => !st.known[st.turn].has(c.index));
  if (unknown.length > 0) {
    return unknown[Math.floor(st.ctx.rng() * unknown.length)].index;
  }
  return down[Math.floor(st.ctx.rng() * down.length)].index;
}

function cpuPickSecond(st: MemoryMatchState, first: Card): number | null {
  const down = faceDownCards(st);
  if (down.length === 0) return null;
  // remembered partner of the card just revealed
  const partner = st.cards.find((x) => x.pair === first.pair && x.index !== first.index);
  if (partner && partner.state === "down" && st.known[st.turn].has(partner.index)) {
    return partner.index;
  }
  // any other known pair among the remaining face-down cards
  const pair = knownPair(st, st.turn);
  if (pair) return pair[0].index;
  const unknown = down.filter((c) => !st.known[st.turn].has(c.index));
  if (unknown.length > 0) {
    return unknown[Math.floor(st.ctx.rng() * unknown.length)].index;
  }
  return down[Math.floor(st.ctx.rng() * down.length)].index;
}

function resolveTurn(st: MemoryMatchState): void {
  const ctx = st.ctx;
  const a = st.cards[st.flipped[0]];
  const b = st.cards[st.flipped[1]];
  if (!a || !b) {
    st.flipped = [];
    st.phase = "turnEnd";
    return;
  }
  if (a.pair === b.pair) {
    a.state = "matched";
    b.state = "matched";
    a.pulseT = 1;
    b.pulseT = 1;
    st.scores[st.turn] += 1;
    refreshPips(st);
    ctx.playSfx("coin.gain", { volume: 0.7, pitch: 1.4 });
    ctx.playSfx("crowd.cheer", { volume: 0.35 });
    ctx.characters[st.turn]?.anim.cheer();
    st.burst.spawn(
      [
        { x: a.mesh.position.x, y: CARD_BASE_Y + 0.35, z: a.mesh.position.z },
        { x: b.mesh.position.x, y: CARD_BASE_Y + 0.35, z: b.mesh.position.z },
      ],
      { colors: [palette.sun, palette.white, palette.candy], countPerPoint: 7, speed: 1.1, life: 0.8, upBias: 1.2 }
    );
  } else {
    a.wobbleT = 1;
    b.wobbleT = 1;
    ctx.playSfx("ui.click", { volume: 0.4, pitch: -6 });
    // The 0.7s reveal hold starts NOW (mismatch resolution); the flip-back
    // completes on each card's own timer, independent of the phase machine.
    for (const idx of st.flipped) flipDown(st, idx);
  }
}

function refreshPips(st: MemoryMatchState): void {
  for (let p = 0; p < 4; p++) {
    for (let s = 0; s < 4; s++) {
      const pip = st.pips[p]?.[s];
      if (!pip) continue;
      const filled = s < st.scores[p];
      pip.mat.color.setHex(filled ? hex(palette.sun) : hex(palette.inkSoft));
      pip.mat.opacity = filled ? 1 : 0.35;
    }
  }
}

function computeRanking(st: MemoryMatchState): number[] {
  return [0, 1, 2, 3].sort(
    (a, b) => st.scores[b] - st.scores[a] || st.flips[a] - st.flips[b] || a - b
  );
}

function startWin(st: MemoryMatchState): void {
  const ctx = st.ctx;
  const winner = st.winRanking?.[0] ?? st.turn;
  const name = ctx.players[winner]?.name ?? "?";
  ctx.announce(`${name} WINS MEMORY MATCH!`, { durationMs: 2000, sound: null });
  ctx.playSfx("crowd.cheer", { volume: 0.9 });
  ctx.playSfx("whistle", { volume: 0.6, pitch: 2 });
  // confetti over the whole grid
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 9; i++) {
    points.push({
      x: (ctx.rng() * 2 - 1) * 1.9,
      y: CARD_BASE_Y + 0.2 + ctx.rng() * 0.5,
      z: (ctx.rng() * 2 - 1) * 1.9,
    });
  }
  st.burst.spawn(points, {
    colors: [palette.sun, palette.candy, palette.bubble, palette.mint, palette.white],
    countPerPoint: 4,
    speed: 1.6,
    life: 1.35,
    upBias: 2.2,
  });
  for (const ch of ctx.characters) ch.anim.idle();
  ctx.characters[winner]?.anim.cheer();
  st.phase = "win";
  st.phaseT = 0;
}

/** Every card's flip machine is idle (no tween / reveal hold in flight). */
function tableSettled(st: MemoryMatchState): boolean {
  return st.cards.every((c) => c.flipPhase === "idle");
}

/**
 * TIME'S UP sweep: every non-matched face-up card goes back down through
 * the same uninterruptible per-card machine — no zombie cards at the cap.
 * Cards already mid flip-down / mid hold are left to their own timers.
 */
function settleFlippedCards(st: MemoryMatchState): void {
  for (const card of st.cards) {
    if (card.state === "matched") continue;
    if (card.state === "up") flipDown(st, card.index);
    else if (card.flipPhase === "flipping" && card.targetRotY === Math.PI) {
      card.pendingDown = true; // hold once the flip-up lands, then flip back
    }
  }
}

function maybeTimeUp(st: MemoryMatchState): void {
  if (st.phase === "win" || st.phase === "timeup" || st.winRanking) return;
  settleFlippedCards(st);
  st.winRanking = computeRanking(st);
  st.ctx.announce("TIME'S UP!", { durationMs: 1200, sound: null });
  st.ctx.playSfx("crowd.aah", { volume: 0.7 });
  for (const ch of st.ctx.characters) ch.anim.idle();
  st.phase = "timeup";
  st.phaseT = 0;
}

function doHumanFlip(st: MemoryMatchState, index: number): void {
  const card = st.cards[index];
  if (!card || card.state !== "down") return;
  flipUp(st, index);
  st.afkT = 0;
  st.phaseT = 0;
  st.phase = st.flipped.length === 1 ? "flip1" : "flip2";
}

function cardUnderPointer(st: MemoryMatchState, nx: number, ny: number): Card | null {
  st.ndc.set(nx * 2 - 1, -(ny * 2 - 1));
  st.raycaster.setFromCamera(st.ndc, st.ctx.camera);
  const targets: THREE.Mesh[] = [];
  for (const card of st.cards) {
    if (card.state !== "down") continue;
    card.mesh.updateMatrixWorld();
    targets.push(card.mesh);
  }
  if (targets.length === 0) return null;
  const hits = st.raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const idx = st.cards.findIndex((c) => c.mesh === hits[0].object);
  return idx >= 0 ? st.cards[idx] : null;
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

export function loadMemoryMatch(): Promise<Minigame> {
  return Promise.resolve(memoryMatch);
}

export default memoryMatch;

// Self-registration (framework-documented pattern): make this module
// playable the moment it is loaded, independent of index.ts wiring.
registerMinigame({ id: memoryMatch.id, name: memoryMatch.name });
if (!MINIGAME_MODULES.some((l) => l === loadMemoryMatch)) {
  MINIGAME_MODULES.push(loadMemoryMatch);
}

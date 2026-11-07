/**
 * SUPER STAR PARTY — PIPE PUZZLE (puzzle).
 *
 * Simultaneous race. Everyone solves an identical copy of the same 4x4 pipe
 * puzzle (puzzle k is the same for all players, generated once from ctx.rng).
 * Tap a tile to turn it a quarter clockwise; water from the spout lights the
 * connected pipes cyan; link it to the star and your next puzzle appears.
 * 26 seconds. Most puzzles solved wins; ties go to the most fitted pipes on
 * the current puzzle, then whoever got there first, then a fair rng draw.
 *
 * Your board is big and centred; each rival's board is a live mini-board in
 * their colour with a progress bar.
 *
 * CPU model (grid.ts, shared with the balance sim): 1.4 s read per puzzle,
 * then one press every pace x U[0.85, 1.15] s, where pace is that CPU's skill
 * drawn from ctx.rng; 12% of presses turn a wrong tile. It follows the
 * cheapest route from its current board, one press at a time. Under autoplay
 * the local seat runs the same model.
 *
 * Determinism: puzzles, CPU skills, CPU presses and the final tie draw use
 * ctx.rng only, on a fixed 1/60 s step. Confetti uses a separate cosmetic
 * stream seeded from one ctx.rng draw at setup.
 */
import * as THREE from "three";
import {
  automatedSeatIds,
  isPracticeBeat,
  localPlayerIndex,
  type Minigame,
  type MinigameContext,
} from "../framework";
import { box as frameBox, frameMinigame, type FrameSpec } from "../framing";
import { palette } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import { mulberry32 } from "../../core/rng";
import { viewportSize } from "../../ui/viewport";
import {
  ENTRY_ROW,
  ROUND_TIME,
  SIZE,
  computeFlow,
  drawCpuPace,
  generatePuzzle,
  newSeat,
  pressTile,
  rankSeats,
  tickSeat,
  type Puzzle,
  type Seat,
} from "./grid";
import {
  MAIN_TOP_Y,
  MINI_H,
  MINI_W,
  createConfetti,
  createMainBoard,
  createMiniBoard,
  plusOneTexture,
  type Confetti,
  type MainBoard,
  type MiniBoard,
} from "./art";

/* ------------------------------------------------------------------ */
/*  Tunables                                                           */
/* ------------------------------------------------------------------ */

const SIM_STEP = 1 / 60;
const MAX_SIM_STEPS = 12;
/** Puzzles made at setup; more are made on demand (never reached in play). */
const PREMADE = 16;
const TIME_UP_BEAT = 0.8;
const CHAR_SCALE = 0.78;
const CHEER_TIME = 1.1;

interface Rival {
  index: number;
  board: MiniBoard;
}

interface PlusOne {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  origin: THREE.Vector3;
  life: number;
}

interface PipeState {
  ctx: MinigameContext;
  root: THREE.Group;
  puzzles: Puzzle[];
  seats: Seat[];
  ids: number[];
  auto: boolean[];
  local: number;
  main: MainBoard;
  rivals: Rival[];
  confetti: Confetti;
  plus: PlusOne;
  cursor: number;
  /** Sim clock (fixed steps). */
  t: number;
  acc: number;
  /** Real-time clock for animation only. */
  anim: number;
  cheer: number[];
  timeUp: boolean;
  endT: number;
  ranking: number[] | null;
  finished: boolean;
  raycaster: THREE.Raycaster;
  ndc: THREE.Vector2;
  plane: THREE.Plane;
  hit: THREE.Vector3;
}

let st: PipeState | null = null;

/* ------------------------------------------------------------------ */
/*  The minigame                                                       */
/* ------------------------------------------------------------------ */

const pipePuzzle: Minigame = {
  id: "pipe_puzzle",
  name: "Pipe Puzzle",
  genre: "puzzle",
  howTo:
    "Everyone gets the same pipe puzzle. Tap a pipe to turn it. Link the water to the star to score, then a new puzzle appears. Most puzzles solved wins!",
  goal: "Turn pipes to link water to the star!",
  tap: "TURN",
  steer: true,
  steerGrid: true,
  tapSfx: "pop",
  rules: {
    format: "ffa",
    length: "26 seconds",
    win: "Solve the most pipe puzzles",
    touch: ["Tap a pipe to turn it", "Connect the water to the star"],
    keys: ["Arrows: move the cursor", "Space: turn the pipe", "Or click a pipe"],
  },

  setup(ctx: MinigameContext) {
    const players = ctx.players;
    const ids = players.map((p) => p.id);
    const local = localPlayerIndex(players);
    const autoIds = automatedSeatIds(players, isAutoplay());
    const auto = ids.map((id) => autoIds.includes(id));

    // Gameplay draws, in a fixed order: puzzles, then each CPU's skill.
    const puzzles: Puzzle[] = [];
    for (let i = 0; i < PREMADE; i++) puzzles.push(generatePuzzle(ctx.rng));
    const seats = ids.map((_, i) => newSeat(puzzles[0], auto[i] ? drawCpuPace(ctx.rng) : 1));
    const cosmetic = mulberry32(Math.floor(ctx.rng() * 0x7fffffff));

    const root = new THREE.Group();
    ctx.scene.add(root);
    const main = createMainBoard(players[local]?.color ?? palette.sun);
    root.add(main.group);
    const rivals: Rival[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (i === local) continue;
      const board = createMiniBoard(players[i]?.color ?? palette.berry);
      root.add(board.group);
      rivals.push({ index: i, board });
    }
    const confetti = createConfetti(root, 40, cosmetic);
    const plusMat = new THREE.SpriteMaterial({ map: plusOneTexture, transparent: true, opacity: 0, depthWrite: false });
    const plusSprite = new THREE.Sprite(plusMat);
    plusSprite.visible = false;
    plusSprite.renderOrder = 10;
    root.add(plusSprite);

    const state: PipeState = {
      ctx,
      root,
      puzzles,
      seats,
      ids,
      auto,
      local,
      main,
      rivals,
      confetti,
      plus: { sprite: plusSprite, mat: plusMat, origin: new THREE.Vector3(), life: 0 },
      cursor: ENTRY_ROW * SIZE,
      t: 0,
      acc: 0,
      anim: 0,
      cheer: ids.map(() => 0),
      timeUp: false,
      endT: 0,
      ranking: null,
      finished: false,
      raycaster: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -MAIN_TOP_Y),
      hit: new THREE.Vector3(),
    };
    st = state;
    // Dev probe for browser checks (read-only); absent from production builds.
    if (import.meta.env.DEV) (globalThis as { __SSP_PIPE__?: unknown }).__SSP_PIPE__ = state;

    for (let i = 0; i < ids.length; i++) showPuzzle(state, i);
    main.setCursor(auto[local] ? null : state.cursor);

    for (const ch of ctx.characters) {
      ch.group.scale.setScalar(CHAR_SCALE);
      ch.setFacing(0);
      ch.anim.idle();
    }
    frameMinigame(ctx.camera, () => layout(state));

    for (const id of ids) ctx.hud.score(id, 0);
    ctx.hud.unit("solved");
    ctx.hud.timer(ROUND_TIME, ROUND_TIME);

    ctx.input.pointer = (x: number, y: number, down: boolean): void => {
      if (!down || !canPlay(state)) return;
      state.ndc.set(x * 2 - 1, -(y * 2 - 1));
      state.raycaster.setFromCamera(state.ndc, ctx.camera);
      if (!state.raycaster.ray.intersectPlane(state.plane, state.hit)) return;
      const cell = main.cellAt(state.hit.x - main.group.position.x, state.hit.z - main.group.position.z);
      if (cell < 0) return;
      state.cursor = cell;
      main.setCursor(cell);
      humanPress(state, cell);
    };

    ctx.input.key = (action: string): void => {
      if (!canPlay(state)) return;
      if (action === "confirm") {
        humanPress(state, state.cursor);
        return;
      }
      let r = Math.floor(state.cursor / SIZE);
      let c = state.cursor % SIZE;
      if (action === "left") c = Math.max(0, c - 1);
      else if (action === "right") c = Math.min(SIZE - 1, c + 1);
      else if (action === "up") r = Math.max(0, r - 1);
      else if (action === "down") r = Math.min(SIZE - 1, r + 1);
      else return;
      const next = r * SIZE + c;
      if (next === state.cursor) return;
      state.cursor = next;
      main.setCursor(next);
      ctx.playSfx("ui.click", { volume: 0.3, rate: 2.2 });
    };
  },

  update(dt: number) {
    const s = st;
    if (!s || s.finished || isPracticeBeat()) return;
    s.acc += dt;
    let steps = 0;
    while (s.acc >= SIM_STEP && steps < MAX_SIM_STEPS && !s.finished) {
      s.acc -= SIM_STEP;
      steps++;
      step(s);
    }
    if (steps >= MAX_SIM_STEPS) s.acc = 0;
    if (!s.timeUp) s.ctx.hud.timer(Math.max(0, ROUND_TIME - s.t), ROUND_TIME);
    animate(s, dt);
  },

  teardown() {
    const s = st;
    if (!s) return;
    s.main.dispose();
    for (const rv of s.rivals) rv.board.dispose();
    s.confetti.dispose();
    s.plus.mat.dispose();
    s.root.removeFromParent();
    for (const ch of s.ctx.characters) {
      ch.group.scale.setScalar(1);
      ch.anim.idle();
    }
    s.ctx.hud.timer(null);
    s.ctx.input.pointer = () => {};
    s.ctx.input.key = () => {};
    if (import.meta.env.DEV) delete (globalThis as { __SSP_PIPE__?: unknown }).__SSP_PIPE__;
    st = null;
  },
};

/* ------------------------------------------------------------------ */
/*  Layout: portrait stacks rivals above your board, landscape beside  */
/* ------------------------------------------------------------------ */

function layout(s: PipeState): FrameSpec {
  const { w, h } = viewportSize();
  const portrait = w / h < 1;
  const chars = s.ctx.characters;
  const rivalChar = (rv: Rival, x: number, z: number): void => {
    chars[s.ids[rv.index]]?.group.position.set(x, 0, z);
  };
  const localChar = chars[s.ids[s.local]];
  if (portrait) {
    const zc = -2.2 - 0.3 - MINI_H / 2;
    s.rivals.forEach((rv, j) => {
      const x = (j - 1) * (MINI_W + 0.2);
      rv.board.group.position.set(x, 0, zc);
      rv.board.setBaseScale(1);
      rivalChar(rv, x, zc - MINI_H / 2 - 0.42);
    });
    localChar?.group.position.set(-2.1, 0, 2.7);
    return frameSpec([-2.7, 0, zc - MINI_H / 2 - 0.85], [2.7, 1.1, 2.9], true);
  }
  const scale = 0.8;
  const gap = MINI_H * scale + 0.12;
  s.rivals.forEach((rv, j) => {
    const z = (j - 1) * gap;
    const x = 2.2 + 0.35 + (MINI_W * scale) / 2;
    rv.board.group.position.set(x, 0, z);
    rv.board.setBaseScale(scale);
    rivalChar(rv, x + (MINI_W * scale) / 2 + 0.55, z);
  });
  localChar?.group.position.set(-3.15, 0, 1.25);
  const right = 2.55 + MINI_W * scale + 1.0;
  return frameSpec([-3.6, 0, -gap - (MINI_H * scale) / 2 - 0.05], [right, 1.1, gap + (MINI_H * scale) / 2 + 0.05], false);
}

function frameSpec(min: [number, number, number], max: [number, number, number], portrait: boolean): FrameSpec {
  return {
    box: frameBox(min, max),
    dir: new THREE.Vector3(0, 10, 2.4),
    fov: 30,
    insets: { top: portrait ? 96 : 84 },
  };
}

/* ------------------------------------------------------------------ */
/*  Sim                                                                */
/* ------------------------------------------------------------------ */

function canPlay(s: PipeState): boolean {
  return !s.finished && !s.timeUp && !s.auto[s.local] && !isPracticeBeat();
}

function puzzleAt(s: PipeState, k: number): Puzzle {
  while (s.puzzles.length <= k) s.puzzles.push(generatePuzzle(s.ctx.rng));
  return s.puzzles[k];
}

function step(s: PipeState): void {
  if (s.timeUp) {
    s.endT += SIM_STEP;
    if (s.endT >= TIME_UP_BEAT && s.ranking) {
      s.finished = true;
      s.ctx.finish(s.ranking);
    }
    return;
  }
  s.t += SIM_STEP;
  const at = (k: number): Puzzle => puzzleAt(s, k);
  for (let i = 0; i < s.seats.length; i++) {
    const ev = tickSeat(s.seats[i], SIM_STEP, s.t, s.auto[i], at, s.ctx.rng);
    if (!ev) continue;
    if (ev.kind === "advance") {
      showPuzzle(s, i);
      if (i === s.local) s.ctx.playSfx("whoosh", { volume: 0.35, rate: 1.4 });
      continue;
    }
    if (ev.cell === undefined) continue;
    viewTurn(s, i, ev.cell);
    if (i === s.local) s.ctx.playSfx("pop", { volume: 0.4, rate: 1.3 });
    refreshWater(s, i);
    if (ev.result === "solved") onSolved(s, i);
  }
  if (s.t >= ROUND_TIME) timeUp(s);
}

function humanPress(s: PipeState, cell: number): void {
  const seat = s.seats[s.local];
  const result = pressTile(seat, puzzleAt(s, seat.puzzle), cell, s.t);
  if (result === "ignored") return;
  viewTurn(s, s.local, cell);
  s.ctx.playSfx("pop", { volume: 0.45, rate: 1.3 });
  refreshWater(s, s.local);
  if (result === "solved") onSolved(s, s.local);
}

function viewTurn(s: PipeState, i: number, cell: number): void {
  if (i === s.local) s.main.turn(cell);
  else s.rivals.find((rv) => rv.index === i)?.board.turn(cell);
}

function showPuzzle(s: PipeState, i: number): void {
  const seat = s.seats[i];
  const p = puzzleAt(s, seat.puzzle);
  if (i === s.local) s.main.setPuzzle(p.kinds, seat.rots, p.exitRow);
  else s.rivals.find((rv) => rv.index === i)?.board.setPuzzle(p.kinds, seat.rots, p.exitRow);
  refreshWater(s, i);
}

function refreshWater(s: PipeState, i: number): void {
  const seat = s.seats[i];
  const p = puzzleAt(s, seat.puzzle);
  const flow = computeFlow(p.kinds, seat.rots, p.exitRow);
  if (i === s.local) {
    s.main.setWet(flow.wet, flow.solved);
    return;
  }
  const rv = s.rivals.find((r) => r.index === i);
  if (!rv) return;
  rv.board.setWet(flow.wet);
  rv.board.setProgress(seat.progress / Math.max(1, p.route.length));
}

const splashAt = new THREE.Vector3();

function onSolved(s: PipeState, i: number): void {
  const ctx = s.ctx;
  ctx.hud.score(s.ids[i], s.seats[i].solved);
  ctx.characters[s.ids[i]]?.anim.cheer();
  s.cheer[i] = CHEER_TIME;
  if (i !== s.local) {
    s.rivals.find((rv) => rv.index === i)?.board.flash();
    ctx.playSfx("pop", { volume: 0.25, rate: 0.8 });
    return;
  }
  s.main.pulseStar();
  s.main.starWorld(splashAt);
  s.root.worldToLocal(splashAt);
  s.confetti.spawn(splashAt, {
    colors: [palette.bubble, palette.white, palette.sun, palette.mint],
    count: 22,
    speed: 1.6,
    life: 0.9,
    upBias: 1.6,
  });
  s.plus.origin.copy(splashAt);
  s.plus.life = 1;
  s.plus.sprite.visible = true;
  ctx.playSfx("coin.gain", { volume: 0.7, rate: 1.2 });
  ctx.playSfx("whoosh", { volume: 0.35, rate: 0.9 });
}

function timeUp(s: PipeState): void {
  s.timeUp = true;
  s.endT = 0;
  const luck = s.ids.map(() => s.ctx.rng());
  s.ranking = rankSeats(s.seats, s.ids, luck);
  s.ctx.hud.timer(0, ROUND_TIME);
  s.main.setCursor(null);
  s.ctx.announce("TIME!", { durationMs: 900, sound: "whistle" });
  for (const ch of s.ctx.characters) ch.anim.idle();
  s.ctx.characters[s.ranking[0]]?.anim.cheer();
}

/* ------------------------------------------------------------------ */
/*  Animation (real dt, presentation only)                             */
/* ------------------------------------------------------------------ */

function animate(s: PipeState, dt: number): void {
  s.anim += dt;
  s.main.update(dt, s.anim);
  for (const rv of s.rivals) rv.board.update(dt);
  s.confetti.update(dt);
  const plus = s.plus;
  if (plus.life > 0) {
    plus.life = Math.max(0, plus.life - dt / 0.9);
    const k = 1 - plus.life;
    plus.sprite.position.set(plus.origin.x - 0.2, plus.origin.y + 0.6 + k * 0.6, plus.origin.z - 0.3 - k * 0.8);
    const pop = k < 0.2 ? 0.6 + 2.4 * k : 1.1;
    plus.sprite.scale.set(1.3 * pop, 0.81 * pop, 1);
    plus.mat.opacity = Math.min(1, plus.life * 3);
    if (plus.life <= 0) plus.sprite.visible = false;
  }
  if (s.timeUp) return;
  for (let i = 0; i < s.cheer.length; i++) {
    if (s.cheer[i] <= 0) continue;
    s.cheer[i] -= dt;
    if (s.cheer[i] <= 0) s.ctx.characters[s.ids[i]]?.anim.idle();
  }
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

export function loadPipePuzzle(): Promise<Minigame> {
  return Promise.resolve(pipePuzzle);
}

export default pipePuzzle;

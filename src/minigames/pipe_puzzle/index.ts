/**
 * SUPER STAR PARTY — PIPE PUZZLE (puzzle).
 *
 * MP7 reference: Water Whirled. Turn-based 5x5 rotating-pipe grid on a
 * tilted wood podium with mint felt. Rotate tiles (tap, or cursor+confirm)
 * to connect the bubbling SOURCE spout (west) to the gold star basin
 * (east). 3 rounds, each a fresh rng-seeded solvable layout; players act
 * in order 0,1,2,3, one rotation per turn; whoever completes the flow on
 * their turn scores the round. After 3 rounds: most completions wins,
 * then fewest rotations used, then playerId.
 *
 * CPU model (players 1-3, and player 0 under autoplay): with p=0.85 a
 * greedy one-step solver rotates the tile that maximizes the flood-fill
 * reach from the source (solving instantly when it sees the winning move);
 * otherwise a random tile. Credible — wins rounds, never psychic.
 *
 * Determinism: round generation, scramble, CPU rolls/picks, AFK fallback
 * and confetti spawns consume ONLY ctx.rng. No Math.random / Date.now /
 * performance.now anywhere in gameplay.
 *
 * Self-registration (framework-documented pattern): this module pushes
 * its own loader + registry entry at import time, so it is playable the
 * moment it loads — no edits to src/minigames/index.ts required.
 */
import * as THREE from "three";
import { isLocalPlayer, type Minigame, type MinigameContext } from "../framework";
import { MINIGAME_MODULES } from "../index";
import { registerMinigame } from "../registry";
import { palette, hex } from "../../config/palette";
import { isAutoplay } from "../../core/debug";
import {
  GRID_ROWS,
  GRID_COLS,
  GRID_STEP,
  TILE_CENTER_Y,
  TABLE_TOP_Y,
  WATER_Y,
  computeFlow,
  generateRound,
  createTileMesh,
  placeTile,
  setTileWater,
  isDecor,
  rotateClockwise,
  buildPodium,
  buildSource,
  buildGoal,
  createFlowFx,
  createConfetti,
  starSpriteTexture,
  gridX,
  gridZ,
} from "./grid";
import type { TileDef, TileMesh } from "./grid";

/* ------------------------------------------------------------------ */
/*  Tunables                                                           */
/* ------------------------------------------------------------------ */

const ROUNDS = 3;
const ROUND_TURNS = 6; // max rotations per round (players cycle 0..3)
const POPIN_TIME = 0.55; // staggered grid pop-in
const TURN_BEAT = 0.5; // turn banner + CPU think beat
const ROTATE_TIME = 0.3;
const SETTLE_TIME = 0.32;
const CELEBRATE_TIME = 1.25;
const FINALE_TIME = 1.3;
const HARD_FINISH = 28.2; // finish on our own ranking before the 30s net
const HUMAN_AFK = 6; // auto-rotate if the human idles this long
const CPU_GREEDY_P = 0.8; // chance a CPU uses the greedy solver
const CHARS_Z = -4.85;

type Phase = "popIn" | "turn" | "celebrate" | "finale";
type TurnStep = "start" | "rotate" | "settle";

interface Pip {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
}

interface PipeState {
  ctx: MinigameContext;
  root: THREE.Group;
  defs: TileDef[][];
  meshes: TileMesh[][];
  phase: Phase;
  phaseT: number;
  round: number; // 0-based
  turn: number; // active player id
  turnCount: number; // rotations performed this round
  turnStep: TurnStep;
  rotating: { r: number; c: number } | null;
  rotateFromY: number;
  rotateTargetY: number;
  rotateDelta: number; // quarter turns clockwise (1..3)
  scores: number[]; // round completions per player
  rotations: number[]; // total rotations used per player
  humanCpu: boolean;
  afkT: number;
  cursorR: number;
  cursorC: number;
  cursorRing: THREE.Mesh;
  time: number; // local clock (animations only)
  pips: Pip[][];
  water: ReturnType<typeof createFlowFx>;
  confetti: ReturnType<typeof createConfetti>;
  podium: ReturnType<typeof buildPodium>;
  source: ReturnType<typeof buildSource>;
  goal: ReturnType<typeof buildGoal>;
  flowPts: THREE.Vector3[];
  winRanking: number[] | null;
  finished: boolean;
  raycaster: THREE.Raycaster;
  ndc: THREE.Vector2;
  shakeT: number;
  /** Connected-tile percentage HUD. */
  hudMesh: THREE.Mesh;
  hudMat: THREE.MeshBasicMaterial;
  hudCanvas: HTMLCanvasElement;
  hudCtx: CanvasRenderingContext2D;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function playerColorHex(ctx: MinigameContext, id: number): number {
  return hex(ctx.players[id]?.color ?? palette.sun);
}

function makeRing(inner: number, outer: number, color: number): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function tileIndex(r: number, c: number): number {
  return r * GRID_COLS + c;
}

/* ------------------------------------------------------------------ */
/*  The minigame                                                       */
/* ------------------------------------------------------------------ */

const pipePuzzle: Minigame = {
  id: "pipe_puzzle",
  name: "Pipe Puzzle",
  genre: "puzzle",
  howTo: "Tap a pipe to turn it. Connect the water to the star more times than the others to win.",

  setup(ctx: MinigameContext) {
    const st: PipeState = {
      ctx,
      root: new THREE.Group(),
      defs: [],
      meshes: [],
      phase: "popIn",
      phaseT: 0,
      round: 0,
      turn: 0,
      turnCount: 0,
      turnStep: "start",
      rotating: null,
      rotateFromY: 0,
      rotateTargetY: 0,
      rotateDelta: 1,
      scores: [0, 0, 0, 0],
      rotations: [0, 0, 0, 0],
      humanCpu: isAutoplay(),
      afkT: 0,
      cursorR: 2,
      cursorC: 2,
      cursorRing: makeRing(0.46, 0.58, hex(palette.sun)),
      time: 0,
      pips: [],
      water: createFlowFx(),
      confetti: createConfetti(ctx.scene, 48, ctx.rng),
      podium: buildPodium(),
      source: buildSource(),
      goal: buildGoal(),
      flowPts: [],
      winRanking: null,
      finished: false,
      raycaster: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      shakeT: 0,
      hudMesh: null as unknown as THREE.Mesh,
      hudMat: null as unknown as THREE.MeshBasicMaterial,
      hudCanvas: null as unknown as HTMLCanvasElement,
      hudCtx: null as unknown as CanvasRenderingContext2D,
    };
    ctx.scene.add(st.root);
    st.root.add(st.podium.group);
    st.root.add(st.source.group);
    st.root.add(st.goal.group);
    st.root.add(st.water.group);
    st.cursorRing.position.set(0, TILE_CENTER_Y + 0.06, 0);
    st.cursorRing.visible = false;
    st.root.add(st.cursorRing);

    /* ---- characters: row behind the podium, facing the grid ---- */
    for (let i = 0; i < 4; i++) {
      const ch = ctx.characters[i];
      if (!ch) continue;
      ch.group.position.set((i - 1.5) * 2.2, 0, CHARS_Z);
      ch.setFacing(0); // front is +Z -> faces the camera/grid
      ch.anim.idle();
    }

    /* ---- connected-tile % HUD (canvas-texture plane) ---- */
    const hudCanvas = document.createElement("canvas");
    hudCanvas.width = 128;
    hudCanvas.height = 64;
    const hudCtx = hudCanvas.getContext("2d");
    if (!hudCtx) throw new Error("HUD 2D context unavailable");
    const hudTex = new THREE.CanvasTexture(hudCanvas);
    hudTex.colorSpace = THREE.SRGBColorSpace;
    const hudMat = new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthWrite: false });
    const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), hudMat);
    hudMesh.position.set(0, TABLE_TOP_Y + 1.1, 0);
    hudMesh.rotation.x = -0.35;
    st.root.add(hudMesh);
    st.hudMesh = hudMesh;
    st.hudMat = hudMat;
    st.hudCanvas = hudCanvas;
    st.hudCtx = hudCtx;

    /* ---- per-player completion pips (3 gold stars above each head) ---- */
    for (let p = 0; p < 4; p++) {
      const row: Pip[] = [];
      for (let s = 0; s < 3; s++) {
        const mat = new THREE.SpriteMaterial({
          map: starSpriteTexture,
          color: hex(palette.inkSoft),
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.setScalar(0.2);
        sprite.position.set((p - 1.5) * 2.2 + (s - 1) * 0.3, 1.72, CHARS_Z + 0.42);
        st.root.add(sprite);
        row.push({ sprite, mat });
      }
      st.pips.push(row);
    }

    /* ---- fixed 3/4 party camera (slight +X so the source reads) ---- */
    const portrait = window.innerWidth / window.innerHeight < 1;
    const cam = ctx.camera;
    if (portrait) {
      cam.position.set(1.2, 9.6, 12.8);
      cam.lookAt(0.1, 0.9, 0);
    } else {
      cam.position.set(1.0, 7.1, 9.9);
      cam.lookAt(0.1, 0.85, 0);
    }

    /* ---- round 1 grid ---- */
    st.defs = generateRound(ctx.rng);
    buildTiles(st);
    refreshWater(st); // initial flood so water state is visible immediately
    ctx.announce("CONNECT THE PIPES!", { durationMs: 1500, sound: null });

    /* ---- input handlers ---- */
    ctx.input.pointer = (x: number, y: number, down: boolean): void => {
      if (!down) return;
      if (st.phase !== "turn" || st.turnStep !== "start" || !isLocalPlayer(st.ctx.players, st.turn) || st.humanCpu) return;
      const hit = tileUnderPointer(st, x, y);
      if (hit && !isDecor(st.defs[hit.r][hit.c])) {
        doRotate(st, hit.r, hit.c, 1);
      }
    };

    ctx.input.key = (action: string): void => {
      if (st.phase !== "turn" || st.turnStep !== "start" || !isLocalPlayer(st.ctx.players, st.turn) || st.humanCpu) return;
      if (action === "left") st.cursorC = (st.cursorC + GRID_COLS - 1) % GRID_COLS;
      else if (action === "right") st.cursorC = (st.cursorC + 1) % GRID_COLS;
      else if (action === "up") st.cursorR = (st.cursorR + GRID_ROWS - 1) % GRID_ROWS;
      else if (action === "down") st.cursorR = (st.cursorR + 1) % GRID_ROWS;
      else if (action === "confirm") {
        if (!isDecor(st.defs[st.cursorR][st.cursorC])) {
          doRotate(st, st.cursorR, st.cursorC, 1);
        }
        return;
      } else return;
      ctx.playSfx("ui.click", { volume: 0.35, pitch: 3 });
      placeCursorRing(st);
    };

    // Framework keeps this instance cached; per-round state lives in the
    // closure above. Store it for update()/teardown().
    (pipePuzzle as unknown as { _st?: PipeState })._st = st;
  },

  update(dt: number) {
    const st = (pipePuzzle as unknown as { _st?: PipeState })._st;
    if (!st || st.finished) return;
    const ctx = st.ctx;
    st.time += dt;
    st.phaseT += dt;

    /* ---- ambient animation ---- */
    st.water.update(dt, st.time);
    st.confetti.update(dt);
    st.cursorRing.scale.setScalar(1 + 0.1 * Math.sin(st.time * 6));
    if (st.goal.star) {
      st.goal.star.scale.setScalar(0.42 + 0.06 * Math.sin(st.time * 4));
    }
    for (const b of st.source.bubbles) {
      const k = (st.time * 0.55 + b.phase) % 1;
      b.sprite.position.y = b.baseY + k * 0.85;
      b.mat.opacity = 0.85 * (1 - k);
    }
    if (st.shakeT > 0) {
      st.shakeT = Math.max(0, st.shakeT - dt);
      const s = st.shakeT * 0.035;
      st.root.position.x = Math.sin(st.time * 42) * s;
      st.root.position.z = Math.cos(st.time * 37) * s;
    } else if (st.root.position.x !== 0 || st.root.position.z !== 0) {
      st.root.position.set(0, 0, 0);
    }

    /* ---- tile animation pass (pop-in + rotation + cursor bob) ---- */
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const tm = st.meshes[r][c];
        const t = st.defs[r][c];
        const idx = tileIndex(r, c);
        let popK = 1;
        if (st.phase === "popIn") {
          popK = Math.min(1, Math.max(0, (st.phaseT - idx * 0.018) / 0.32));
        }
        const popScale = popK <= 0 ? 0.001 : easeOutBack(popK);
        tm.mesh.scale.setScalar(Math.max(0.0001, popScale));

        // rotation tween
        if (st.rotating && st.rotating.r === r && st.rotating.c === c && st.turnStep === "rotate") {
          const k = Math.min(1, st.phaseT / ROTATE_TIME);
          const e = easeOutCubic(k);
          tm.mesh.rotation.y = st.rotateFromY + (st.rotateTargetY - st.rotateFromY) * e;
          tm.mesh.position.y = TILE_CENTER_Y + Math.sin(Math.PI * k) * 0.09;
          tm.mesh.scale.setScalar(Math.max(0.0001, popScale * (1 + 0.07 * Math.sin(Math.PI * k))));
        } else {
          tm.mesh.position.y = TILE_CENTER_Y;
          const wantY = t.rot * (Math.PI / 2);
          // snap any leftover float
          if (Math.abs(tm.mesh.rotation.y - wantY) > 0.001) tm.mesh.rotation.y = wantY;
        }
      }
    }

    // cursor tile idle bob on the human's turn
    if (st.phase === "turn" && st.turnStep === "start" && isLocalPlayer(st.ctx.players, st.turn) && !st.humanCpu) {
      const tm = st.meshes[st.cursorR][st.cursorC];
      if (tm) tm.mesh.position.y = TILE_CENTER_Y + 0.05 * Math.sin(st.time * 7);
    }

    /* ---- hard finish guard (own ranking, before the 30s net) ---- */
    if (ctx.time >= HARD_FINISH) {
      st.winRanking = computeRanking(st);
      st.finished = true;
      ctx.finish(st.winRanking);
      return;
    }

    /* ---- phase machine ---- */
    switch (st.phase) {
      case "popIn": {
        if (st.phaseT >= POPIN_TIME) {
          st.phase = "turn";
          st.phaseT = 0;
          st.turn = 0;
          st.turnCount = 0;
          startTurn(st);
        }
        break;
      }
      case "turn": {
        tickTurn(st, dt);
        break;
      }
      case "celebrate": {
        if (st.phaseT >= CELEBRATE_TIME) {
          st.water.hide();
          advanceRound(st);
        }
        break;
      }
      case "finale": {
        if (st.phaseT >= FINALE_TIME && st.winRanking) {
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
    const st = (pipePuzzle as unknown as { _st?: PipeState })._st;
    if (!st) return;
    const ctx = st.ctx;
    st.root.removeFromParent();
    for (const row of st.meshes) {
      for (const tm of row) tm.topMat.dispose();
    }
    st.cursorRing.geometry.dispose();
    (st.cursorRing.material as THREE.Material).dispose();
    st.water.dispose();
    st.confetti.clear();
    st.podium.materials.forEach((m) => m.dispose());
    st.podium.geometries.forEach((g) => g.dispose());
    st.source.materials.forEach((m) => m.dispose());
    st.source.geometries.forEach((g) => g.dispose());
    st.goal.materials.forEach((m) => m.dispose());
    st.goal.geometries.forEach((g) => g.dispose());
    for (const row of st.pips) {
      for (const pip of row) {
        pip.sprite.removeFromParent();
        pip.mat.dispose();
      }
    }
    for (const ch of ctx.characters) ch.anim.idle();
    ctx.input.pointer = () => {};
    ctx.input.key = () => {};
    (pipePuzzle as unknown as { _st?: PipeState })._st = undefined;
  },
};

/* ------------------------------------------------------------------ */
/*  Round / turn logic                                                 */
/* ------------------------------------------------------------------ */

/** (Re)build tile meshes for the current st.defs (per-round materials). */
function buildTiles(st: PipeState): void {
  for (const row of st.meshes) {
    for (const tm of row) {
      tm.mesh.removeFromParent();
      tm.underlay.removeFromParent();
      tm.topMat.dispose();
    }
  }
  st.meshes = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row: TileMesh[] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      const tm = createTileMesh(st.defs[r][c]);
      placeTile(tm, r, c);
      tm.mesh.scale.setScalar(0.001);
      st.root.add(tm.mesh);
      st.root.add(tm.underlay);
      row.push(tm);
    }
    st.meshes.push(row);
  }
}

function startTurn(st: PipeState): void {
  const ctx = st.ctx;
  ctx.announce(`${ctx.players[st.turn]?.name ?? "?"}'s turn`, { durationMs: 900, sound: null });
  ctx.playSfx("hop", { volume: 0.3, pitch: 2 });
  ctx.characters[st.turn]?.anim.jump();
  st.turnStep = "start";
  st.phaseT = 0;
  st.afkT = 0;
  if (isLocalPlayer(ctx.players, st.turn) && !st.humanCpu) {
    st.cursorR = 2;
    st.cursorC = 2;
    placeCursorRing(st);
  } else {
    st.cursorRing.visible = false;
  }
}

function placeCursorRing(st: PipeState): void {
  st.cursorRing.position.set(gridX(st.cursorC), TILE_CENTER_Y + 0.06, gridZ(st.cursorR));
  st.cursorRing.visible = true;
}

function isCpuTurn(st: PipeState): boolean {
  return !isLocalPlayer(st.ctx.players, st.turn) || st.humanCpu;
}

function tickTurn(st: PipeState, dt: number): void {
  switch (st.turnStep) {
    case "start": {
      if (isCpuTurn(st)) {
        if (st.phaseT >= TURN_BEAT) {
          st.phaseT = 0;
          const pick = cpuPick(st);
          if (pick) doRotate(st, pick.r, pick.c, pick.delta);
          else endRotation(st); // no rotatable tiles: skip
        }
      } else {
        // human: wait for input; AFK fallback so play never stalls
        st.afkT += dt;
        if (st.afkT >= HUMAN_AFK) {
          st.phaseT = 0;
          const pick = randomRotatable(st);
          if (pick) doRotate(st, pick.r, pick.c, 1);
          else endRotation(st);
        }
      }
      break;
    }
    case "rotate": {
      if (st.phaseT >= ROTATE_TIME) {
        st.phaseT = 0;
        endRotation(st);
      }
      break;
    }
    case "settle": {
      // Re-flood immediately so the player sees water state change.
      refreshWater(st);
      if (st.phaseT >= SETTLE_TIME) {
        st.phaseT = 0;
        const flow = computeFlow(st.defs);
        if (flow.solved && flow.path) {
          startCelebrate(st, flow.path);
        } else {
          st.turnCount += 1;
          if (st.turnCount >= ROUND_TURNS) {
            advanceRound(st);
          } else {
            st.turn = (st.turn + 1) % 4;
            startTurn(st);
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

/** Begin a clockwise rotation of tile (r,c) by `delta` quarter turns. */
function doRotate(st: PipeState, r: number, c: number, delta: number): void {
  const tm = st.meshes[r][c];
  if (!tm) return;
  st.rotating = { r, c };
  st.rotateFromY = tm.mesh.rotation.y;
  st.rotateTargetY = st.rotateFromY - delta * (Math.PI / 2);
  st.rotateDelta = delta;
  st.turnStep = "rotate";
  st.phaseT = 0;
  st.ctx.playSfx("pop", { volume: 0.5, pitch: 1.25 });
}

/** Commit the rotation: update the logical def, count it, settle. */
function endRotation(st: PipeState): void {
  const rot = st.rotating;
  st.rotating = null;
  if (rot) {
    const t = st.defs[rot.r][rot.c];
    for (let i = 0; i < st.rotateDelta; i++) rotateClockwise(t);
    st.rotations[st.turn] += 1;
    st.meshes[rot.r][rot.c].mesh.rotation.y = t.rot * (Math.PI / 2);
  }
  st.turnStep = "settle";
  st.phaseT = 0;
}

/**
 * Recompute the flood-fill from source and update every tile's water
 * visual state immediately. Uses the SAME computeFlow the solver uses.
 */
function refreshWater(st: PipeState): void {
  const flow = computeFlow(st.defs);
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const tm = st.meshes[r][c];
      const t = st.defs[r][c];
      const connected = flow.reachedGrid[r]?.[c] ?? false;
      setTileWater(tm, t, connected, st.time);
    }
  }
  // Update HUD readout.
  const total = GRID_ROWS * GRID_COLS;
  const pct = Math.round((flow.reached / total) * 100);
  drawHud(st, pct, flow.solved);
}

/** Draw the connected-% HUD onto the canvas texture. */
function drawHud(st: PipeState, pct: number, solved: boolean): void {
  const ctx = st.hudCtx;
  const w = st.hudCanvas.width;
  const h = st.hudCanvas.height;
  ctx.clearRect(0, 0, w, h);
  // Background pill
  ctx.fillStyle = solved ? palette.bubble : palette.ink;
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 16);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Text
  ctx.fillStyle = palette.white;
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = solved ? "SOLVED!" : `${pct}% FLOW`;
  ctx.fillText(label, w / 2, h / 2 + 2);
  // Mark texture for re-upload
  st.hudMat.map!.needsUpdate = true;
}

/**
 * CPU move: with p=0.85 the greedy one-step solver — the (tile, rotation)
 * that maximizes flood-fill reach from the source (huge bonus when it
 * completes the path). Otherwise a random rotatable tile. Deterministic
 * tie-breaks; rng only for the p-roll and random fallback.
 */
function cpuPick(st: PipeState): { r: number; c: number; delta: number } | null {
  const ctx = st.ctx;
  const rotatable: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!isDecor(st.defs[r][c])) rotatable.push({ r, c });
    }
  }
  if (rotatable.length === 0) return null;

  if (ctx.rng() >= CPU_GREEDY_P) {
    const pick = rotatable[Math.floor(ctx.rng() * rotatable.length)];
    return { r: pick.r, c: pick.c, delta: 1 + Math.floor(ctx.rng() * 3) };
  }

  let best: { r: number; c: number; delta: number } | null = null;
  let bestScore = -1;
  for (const cell of rotatable) {
    const orig = st.defs[cell.r][cell.c].rot;
    for (let d = 1; d <= 3; d++) {
      st.defs[cell.r][cell.c].rot = (orig + 3 * d) % 4;
      const flow = computeFlow(st.defs);
      const score = flow.reached + (flow.solved ? 10000 : 0);
      st.defs[cell.r][cell.c].rot = orig;
      if (
        score > bestScore ||
        (score === bestScore &&
          best &&
          (tileIndex(cell.r, cell.c) < tileIndex(best.r, best.c) ||
            (tileIndex(cell.r, cell.c) === tileIndex(best.r, best.c) && d < best.delta)))
      ) {
        bestScore = score;
        best = { r: cell.r, c: cell.c, delta: d };
      }
    }
  }
  return best;
}

function randomRotatable(st: PipeState): { r: number; c: number } | null {
  const rotatable: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!isDecor(st.defs[r][c])) rotatable.push({ r, c });
    }
  }
  if (rotatable.length === 0) return null;
  return rotatable[Math.floor(st.ctx.rng() * rotatable.length)];
}

/* ------------------------------------------------------------------ */
/*  Celebration, round flow, ranking                                   */
/* ------------------------------------------------------------------ */

function startCelebrate(st: PipeState, path: Array<{ r: number; c: number }>): void {
  const ctx = st.ctx;
  st.scores[st.turn] += 1;
  refreshPips(st);
  st.shakeT = 0.35;
  ctx.playSfx("whoosh", { volume: 0.7, pitch: 1 });
  ctx.playSfx("coin.gain", { volume: 0.7, pitch: 1.4 });
  ctx.playSfx("crowd.cheer", { volume: 0.4 });
  ctx.announce(`${ctx.players[st.turn]?.name ?? "?"} FIXED THE FLOW!`, {
    durationMs: 1500,
    sound: null,
  });
  ctx.characters[st.turn]?.anim.cheer();

  // water polyline: source edge -> path tile centers -> basin edge
  const pts: THREE.Vector3[] = [
    new THREE.Vector3(gridX(0) - GRID_STEP / 2, WATER_Y, gridZ(2)),
  ];
  for (const cell of path) {
    pts.push(new THREE.Vector3(gridX(cell.c), WATER_Y, gridZ(cell.r)));
  }
  pts.push(new THREE.Vector3(gridX(GRID_COLS - 1) + GRID_STEP / 2, WATER_Y, gridZ(2)));
  st.flowPts = pts;
  st.water.show(pts);

  // confetti over the grid + a splash at the basin
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 8; i++) {
    points.push({
      x: (ctx.rng() * 2 - 1) * 2.3,
      y: TILE_CENTER_Y + 0.15 + ctx.rng() * 0.5,
      z: (ctx.rng() * 2 - 1) * 2.3,
    });
  }
  points.push({ x: gridX(4) + 0.6, y: TILE_CENTER_Y + 0.3, z: 0 });
  st.confetti.spawn(points, {
    colors: [palette.sun, palette.candy, palette.bubble, palette.mint, palette.white],
    countPerPoint: 3,
    speed: 1.5,
    life: 1.0,
    upBias: 1.8,
  });

  st.phase = "celebrate";
  st.phaseT = 0;
}

function advanceRound(st: PipeState): void {
  st.round += 1;
  if (st.round >= ROUNDS) {
    startFinale(st);
    return;
  }
  // regenerate the grid
  st.defs = generateRound(st.ctx.rng);
  buildTiles(st);
  refreshWater(st); // re-flood the new grid
  st.phase = "popIn";
  st.phaseT = 0;
  st.ctx.announce(`ROUND ${st.round + 1}`, { durationMs: 800, sound: null });
  st.ctx.playSfx("pop", { volume: 0.5, pitch: 1.1 });
  for (const ch of st.ctx.characters) ch.anim.idle();
}

function computeRanking(st: PipeState): number[] {
  return [0, 1, 2, 3].sort(
    (a, b) => st.scores[b] - st.scores[a] || st.rotations[a] - st.rotations[b] || a - b
  );
}

function startFinale(st: PipeState): void {
  const ctx = st.ctx;
  st.winRanking = computeRanking(st);
  const winner = st.winRanking[0];
  const name = ctx.players[winner]?.name ?? "?";
  ctx.announce(`${name} MASTER PLUMBER!`, { durationMs: 2000, sound: null });
  ctx.playSfx("fanfare.win", { volume: 0.8 });
  ctx.playSfx("whistle", { volume: 0.6, pitch: 2 });
  ctx.playSfx("crowd.cheer", { volume: 0.9 });
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < 12; i++) {
    points.push({
      x: (ctx.rng() * 2 - 1) * 2.4,
      y: TILE_CENTER_Y + 0.2 + ctx.rng() * 0.7,
      z: (ctx.rng() * 2 - 1) * 2.4,
    });
  }
  st.confetti.spawn(points, {
    colors: [palette.sun, palette.candy, palette.bubble, palette.mint, palette.white],
    countPerPoint: 4,
    speed: 1.7,
    life: 1.4,
    upBias: 2.2,
  });
  for (const ch of ctx.characters) ch.anim.idle();
  ctx.characters[winner]?.anim.cheer();
  st.phase = "finale";
  st.phaseT = 0;
}

function refreshPips(st: PipeState): void {
  for (let p = 0; p < 4; p++) {
    for (let s = 0; s < 3; s++) {
      const pip = st.pips[p]?.[s];
      if (!pip) continue;
      const filled = s < st.scores[p];
      pip.mat.color.setHex(filled ? hex(palette.sun) : hex(palette.inkSoft));
      pip.mat.opacity = filled ? 1 : 0.35;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Pointer picking                                                    */
/* ------------------------------------------------------------------ */

function tileUnderPointer(
  st: PipeState,
  nx: number,
  ny: number
): { r: number; c: number } | null {
  st.ndc.set(nx * 2 - 1, -(ny * 2 - 1));
  st.raycaster.setFromCamera(st.ndc, st.ctx.camera);
  const targets: THREE.Mesh[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const mesh = st.meshes[r][c].mesh;
      mesh.updateMatrixWorld();
      targets.push(mesh);
    }
  }
  const hits = st.raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  const hit = hits[0].object;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (st.meshes[r][c].mesh === hit) return { r, c };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Registration                                                       */
/* ------------------------------------------------------------------ */

export function loadPipePuzzle(): Promise<Minigame> {
  return Promise.resolve(pipePuzzle);
}

export default pipePuzzle;

// Self-registration (framework-documented pattern): playable the moment
// this module loads, independent of index.ts wiring.
registerMinigame({ id: pipePuzzle.id, name: pipePuzzle.name });
if (!MINIGAME_MODULES.some((l) => l === loadPipePuzzle)) {
  MINIGAME_MODULES.push(loadPipePuzzle);
}

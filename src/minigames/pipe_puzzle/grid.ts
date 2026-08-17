/**
 * SUPER STAR PARTY — pipe_puzzle: grid logic + visual kit.
 *
 * Pure-logic half: 5x5 pipe grid, side-based connectivity (N/E/S/W bit
 * masks), deterministic rng-seeded round generation (solution path drawn
 * first, filler randomized, light scramble that guarantees the round is
 * solvable and NOT already solved), BFS flow computation (also extracts
 * the winning path for the celebration animation).
 *
 * Visual half: procedural pipe-face textures (cream tile + mint channel +
 * ink outline, per kind: straight / elbow / tee / decor-star / decor-dot),
 * tile meshes (printed top face, toon sides, ink underlay), the wood+mint
 * felt podium, source spout + goal basin, water-flow celebration kit and
 * a star confetti burst. Shared textures/geometry are module-level and
 * intentionally never disposed (same convention as characters/cel.ts);
 * teardown() disposes only per-instance materials.
 *
 * Determinism: round generation and every gameplay roll use ONLY the
 * ctx.rng passed in. No Math.random / Date.now / performance.now.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/* ------------------------------------------------------------------ */
/*  Grid model                                                         */
/* ------------------------------------------------------------------ */

export const GRID_ROWS = 5;
export const GRID_COLS = 5;
export const GRID_STEP = 1.05;
export const TILE_W = 0.92;
export const TILE_H = 0.15;
/** Y of the felt surface the tiles sit on. */
export const TABLE_TOP_Y = 0.9;
/** Y of a tile center. */
export const TILE_CENTER_Y = TABLE_TOP_Y + TILE_H / 2;
/** Y of the water flow (just above tile tops). */
export const WATER_Y = TILE_CENTER_Y + TILE_H / 2 + 0.045;

/** Side indices: 0 = N (-z), 1 = E (+x), 2 = S (+z), 3 = W (-x). */
export const SIDE_N = 0;
export const SIDE_E = 1;
export const SIDE_S = 2;
export const SIDE_W = 3;
const BIT = [1, 2, 4, 8] as const;

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

export type PipeKind = "straight" | "elbow" | "tee" | "decor";
export type DecorStyle = "star" | "dot";

export interface TileDef {
  kind: PipeKind;
  decor?: DecorStyle;
  /** Quarter turns (mod 4); increments are CLOCKWISE seen from above. */
  rot: number;
}

export function gridX(c: number): number {
  return (c - (GRID_COLS - 1) / 2) * GRID_STEP;
}
export function gridZ(r: number): number {
  return (r - (GRID_ROWS - 1) / 2) * GRID_STEP;
}

/** Base (rot 0) side mask per kind. */
export function baseMask(kind: PipeKind): number {
  switch (kind) {
    case "straight":
      return BIT[SIDE_E] | BIT[SIDE_W]; // H
    case "elbow":
      return BIT[SIDE_N] | BIT[SIDE_E]; // NE corner
    case "tee":
      return BIT[SIDE_N] | BIT[SIDE_E] | BIT[SIDE_S];
    default:
      return 0;
  }
}

/** Mask after `rot` clockwise quarter turns (bit t moves to (t+rot)%4). */
export function rotatedMask(mask: number, rot: number): number {
  let out = 0;
  for (let s = 0; s < 4; s++) {
    if (mask & BIT[s]) out |= BIT[(s + rot) % 4];
  }
  return out;
}

export function tileMask(t: TileDef): number {
  if (t.kind === "decor") return 0;
  return rotatedMask(baseMask(t.kind), t.rot);
}

/** Rotate a def one quarter turn clockwise. */
export function rotateClockwise(t: TileDef): void {
  t.rot = (t.rot + 3) % 4;
}

export function isDecor(t: TileDef): boolean {
  return t.kind === "decor";
}

/* ------------------------------------------------------------------ */
/*  Flow computation                                                   */
/* ------------------------------------------------------------------ */

export interface FlowResult {
  solved: boolean;
  /** Distinct grid cells reached from the source. */
  reached: number;
  /** Winning cell chain (2,0)..(2,4) when solved, else null. */
  path: Array<{ r: number; c: number }> | null;
}

/**
 * BFS the water from the west edge of (2,0). Solved when water exits the
 * east edge of (2,4). Tiles are visited per (cell, entrySide) so loops
 * through T-pipes terminate.
 */
export function computeFlow(tiles: TileDef[][]): FlowResult {
  const visited = new Set<string>();
  const parent = new Map<string, { r: number; c: number; entry: number } | null>();
  const reachedCells = new Set<string>();
  const key = (r: number, c: number, e: number): string => `${r},${c},${e}`;
  const queue: Array<{ r: number; c: number; entry: number }> = [
    { r: 2, c: 0, entry: SIDE_W },
  ];
  visited.add(key(2, 0, SIDE_W));
  parent.set(key(2, 0, SIDE_W), null);

  let solved = false;
  let goal: { r: number; c: number; entry: number } | null = null;

  while (queue.length > 0) {
    const cur = queue.shift() as { r: number; c: number; entry: number };
    reachedCells.add(`${cur.r},${cur.c}`);
    const mask = tileMask(tiles[cur.r][cur.c]);
    if (cur.r === 2 && cur.c === 4 && cur.entry !== SIDE_E && mask & BIT[SIDE_E]) {
      solved = true;
      goal = cur;
      break;
    }
    for (let s = 0; s < 4; s++) {
      if (s === cur.entry || !(mask & BIT[s])) continue;
      const nr = cur.r + DR[s];
      const nc = cur.c + DC[s];
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      const nk = key(nr, nc, (s + 2) % 4);
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, cur);
      queue.push({ r: nr, c: nc, entry: (s + 2) % 4 });
    }
  }

  let path: Array<{ r: number; c: number }> | null = null;
  if (solved && goal) {
    const cells: Array<{ r: number; c: number }> = [];
    let cur: { r: number; c: number; entry: number } | null = goal;
    while (cur) {
      cells.push({ r: cur.r, c: cur.c });
      cur = parent.get(key(cur.r, cur.c, cur.entry)) ?? null;
    }
    path = cells.reverse();
  }
  return { solved, reached: reachedCells.size, path };
}

/* ------------------------------------------------------------------ */
/*  Round generation (deterministic via rng)                           */
/* ------------------------------------------------------------------ */

/** Side of `from` that faces `to` (adjacent cells). */
function sideTo(from: { r: number; c: number }, to: { r: number; c: number }): number {
  if (to.r === from.r - 1) return SIDE_N;
  if (to.r === from.r + 1) return SIDE_S;
  if (to.c === from.c + 1) return SIDE_E;
  return SIDE_W;
}

/** The pipe def connecting inSide -> outSide (straight or elbow). */
function pipeFor(inSide: number, outSide: number): TileDef {
  if ((inSide + 2) % 4 === outSide) {
    const vertical = inSide === SIDE_N || inSide === SIDE_S;
    return { kind: "straight", rot: vertical ? 1 : 0 };
  }
  for (let r = 0; r < 4; r++) {
    const m = rotatedMask(baseMask("elbow"), r);
    if (m & BIT[inSide] && m & BIT[outSide]) return { kind: "elbow", rot: r };
  }
  return { kind: "straight", rot: 0 }; // unreachable
}

function randomPipe(rng: () => number): TileDef {
  const roll = rng();
  if (roll < 0.4) return { kind: "straight", rot: Math.floor(rng() * 2) };
  if (roll < 0.75) return { kind: "elbow", rot: Math.floor(rng() * 4) };
  return { kind: "tee", rot: Math.floor(rng() * 4) };
}

function randomDecor(rng: () => number): TileDef {
  return { kind: "decor", decor: rng() < 0.5 ? "star" : "dot", rot: 0 };
}

/**
 * Build a fresh round grid. Guarantees:
 *  - a solution EXISTS (the drawn path tiles, rotated back, always solve);
 *  - the initial grid is NOT already solved (bounded deterministic retry);
 *  - at most MAX_PATH_ERRORS path tiles are scrambled, so a light scramble
 *    keeps the round finishable within the turn budget.
 */
export function generateRound(rng: () => number): TileDef[][] {
  const tiles: TileDef[][] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row: TileDef[] = [];
    for (let c = 0; c < GRID_COLS; c++) row.push(randomPipe(rng));
    tiles.push(row);
  }

  // 1. solution path: monotone-in-c random walk (2,0) -> (2,4), no revisits.
  const path: Array<{ r: number; c: number }> = [{ r: 2, c: 0 }];
  let r = 2;
  let c = 0;
  let detours = 0;
  while (c < GRID_COLS - 1) {
    if (rng() < 0.62 || detours >= 4) {
      c += 1;
    } else {
      detours += 1;
      const opts: number[] = [];
      if (r > 0) opts.push(-1);
      if (r < GRID_ROWS - 1) opts.push(1);
      r += opts[Math.floor(rng() * opts.length)];
    }
    path.push({ r, c });
  }

  // 2. solution pipes on the path cells.
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const inSide = i === 0 ? SIDE_W : sideTo(path[i - 1], cell);
    const outSide = i === path.length - 1 ? SIDE_E : sideTo(cell, path[i + 1]);
    tiles[cell.r][cell.c] = pipeFor(inSide, outSide);
  }

  // 3. decor on 26% of the filler cells (rest are random pipes).
  for (let rr = 0; rr < GRID_ROWS; rr++) {
    for (let cc = 0; cc < GRID_COLS; cc++) {
      const onPath = path.some((p) => p.r === rr && p.c === cc);
      if (!onPath && rng() < 0.26) tiles[rr][cc] = randomDecor(rng);
    }
  }

  // 4. light scramble of path tiles (1-2 clockwise turns, <= 4 errors).
  const MAX_PATH_ERRORS = 4;
  let errors = 0;
  const scrambled: Array<{ r: number; c: number; delta: number }> = [];
  for (const cell of path) {
    if (errors >= MAX_PATH_ERRORS) break;
    if (rng() < 0.55) {
      const delta = 1 + Math.floor(rng() * 2);
      tiles[cell.r][cell.c].rot = (tiles[cell.r][cell.c].rot + delta) % 4;
      errors += 1;
      scrambled.push({ r: cell.r, c: cell.c, delta });
    }
  }

  // 5. must not start solved (bounded deterministic re-scramble).
  let tries = 0;
  while (computeFlow(tiles).solved && tries < 8) {
    tries += 1;
    const cell = scrambled[Math.floor(rng() * scrambled.length)] ?? path[0];
    tiles[cell.r][cell.c].rot = (tiles[cell.r][cell.c].rot + 1 + Math.floor(rng() * 2)) % 4;
  }

  return tiles;
}

/* ------------------------------------------------------------------ */
/*  Textures & shared geometry (module-level, never disposed)          */
/* ------------------------------------------------------------------ */

const TEX = 128;

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : R * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const INK = palette.ink;
const CREAM = palette.cream;

/** Cream tile face + ink rounded border (the tile chrome). */
function drawChrome(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, TEX, TEX);
  roundRectPath(ctx, 5, 5, TEX - 10, TEX - 10, 14);
  ctx.lineWidth = 10;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/**
 * Draws the pipe channel as a rounded stroke path: ink outline, then mint
 * body, then a white gloss line down the middle.
 */
function drawChannel(ctx: CanvasRenderingContext2D, path: (c: CanvasRenderingContext2D) => void): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  path(ctx);
  ctx.lineWidth = 34;
  ctx.strokeStyle = INK;
  ctx.stroke();
  path(ctx);
  ctx.lineWidth = 26;
  ctx.strokeStyle = palette.mint;
  ctx.stroke();
  path(ctx);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.restore();
}

function hPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(14, 64);
  ctx.lineTo(114, 64);
}
function vPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(64, 14);
  ctx.lineTo(64, 114);
}
function elbowPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(14, 64);
  ctx.lineTo(64, 64);
  ctx.lineTo(64, 14);
}
function teePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(14, 64);
  ctx.lineTo(114, 64);
  ctx.moveTo(64, 64);
  ctx.lineTo(64, 14);
}

function drawDecorStar(ctx: CanvasRenderingContext2D): void {
  starPath(ctx, 64, 66, 22);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(56, 56, 6, 0, Math.PI * 2);
  ctx.fillStyle = palette.white;
  ctx.fill();
}
function drawDecorDot(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(64, 64, 24, 0, Math.PI * 2);
  ctx.fillStyle = palette.candy;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(55, 54, 7, 0, Math.PI * 2);
  ctx.fillStyle = palette.white;
  ctx.fill();
}

function makePipeTexture(drawer: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX);
  drawChrome(ctx);
  drawer(ctx);
  return toTexture(canvas);
}

const straightTexture = makePipeTexture((ctx) => drawChannel(ctx, hPath));
const elbowTexture = makePipeTexture((ctx) => drawChannel(ctx, elbowPath));
const teeTexture = makePipeTexture((ctx) => drawChannel(ctx, teePath));
const decorStarTexture = makePipeTexture(drawDecorStar);
const decorDotTexture = makePipeTexture(drawDecorDot);

const pipeTextureFor = new Map<string, THREE.CanvasTexture>([
  ["straight", straightTexture],
  ["elbow", elbowTexture],
  ["tee", teeTexture],
  ["decorStar", decorStarTexture],
  ["decorDot", decorDotTexture],
]);

/** Small white/gold star used by pips, confetti and the goal basin. */
function makeStarSpriteTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64);
  starPath(ctx, 32, 34, 26);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  starPath(ctx, 32, 34, 22);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  return toTexture(canvas);
}
export const starSpriteTexture = makeStarSpriteTexture();

const tileGeom = new THREE.BoxGeometry(TILE_W, TILE_H, TILE_W);
const underlayGeom = new THREE.BoxGeometry(TILE_W * 1.08, 0.09, TILE_W * 1.08);
const sideMat = new THREE.MeshToonMaterial({ color: hex(palette.cream), gradientMap: celGradient });
const underlayMat = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
const beadGeom = new THREE.SphereGeometry(0.17, 20, 14);
const segGeom = new THREE.CylinderGeometry(0.085, 0.085, 1, 12);
const flashGeom = new THREE.PlaneGeometry(6.4, 4.4);

function toon(mat: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ ...mat, gradientMap: celGradient });
}

/* ------------------------------------------------------------------ */
/*  Tile meshes                                                        */
/* ------------------------------------------------------------------ */

export interface TileMesh {
  mesh: THREE.Mesh;
  topMat: THREE.MeshBasicMaterial;
  underlay: THREE.Mesh;
}

export function textureKeyFor(t: TileDef): string {
  if (t.kind === "decor") return t.decor === "dot" ? "decorDot" : "decorStar";
  return t.kind;
}

export function createTileMesh(t: TileDef): TileMesh {
  const key = textureKeyFor(t);
  const topMat = new THREE.MeshBasicMaterial({ map: pipeTextureFor.get(key) });
  const mesh = new THREE.Mesh(tileGeom, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  mesh.castShadow = true;
  const underlay = new THREE.Mesh(underlayGeom, underlayMat);
  underlay.position.y = -TILE_H / 2 - 0.05;
  return { mesh, topMat, underlay };
}

export function placeTile(tm: TileMesh, r: number, c: number): void {
  tm.mesh.position.set(gridX(c), TILE_CENTER_Y, gridZ(r));
  tm.mesh.rotation.y = 0;
  tm.underlay.position.x = gridX(c);
  tm.underlay.position.z = gridZ(r);
}

/* ------------------------------------------------------------------ */
/*  Podium, source spout, goal basin                                   */
/* ------------------------------------------------------------------ */

export interface Podium {
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export function buildPodium(): Podium {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const woodTop = toon({ color: hex(palette.wood) });
  const woodSide = toon({ color: hex(palette.woodDark) });
  const felt = toon({ color: hex(palette.mintDeep) });
  materials.push(woodTop, woodSide, felt);

  const boxGeom = new THREE.BoxGeometry(6.3, 0.62, 6.3);
  geometries.push(boxGeom);
  const box = new THREE.Mesh(boxGeom, [woodSide, woodSide, woodTop, woodSide, woodSide, woodSide]);
  box.position.y = TABLE_TOP_Y - 0.31;
  group.add(box);

  const feltGeom = new THREE.BoxGeometry(5.78, 0.1, 5.78);
  geometries.push(feltGeom);
  const feltMesh = new THREE.Mesh(feltGeom, felt);
  feltMesh.position.y = TABLE_TOP_Y - 0.05;
  group.add(feltMesh);

  const inkRimGeom = new THREE.BoxGeometry(5.84, 0.05, 5.84);
  geometries.push(inkRimGeom);
  const inkRimMat = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
  materials.push(inkRimMat);
  const rim = new THREE.Mesh(inkRimGeom, inkRimMat);
  rim.position.y = TABLE_TOP_Y - 0.09;
  group.add(rim);

  const legGeom = new THREE.BoxGeometry(0.4, 0.62, 0.4);
  geometries.push(legGeom);
  for (const [lx, lz] of [
    [-2.85, -2.85],
    [2.85, -2.85],
    [-2.85, 2.85],
    [2.85, 2.85],
  ]) {
    const leg = new THREE.Mesh(legGeom, woodSide);
    leg.position.set(lx, 0.31, lz);
    group.add(leg);
  }

  return { group, materials, geometries };
}

export interface SourceGoal {
  group: THREE.Group;
  bubbles: Array<{ sprite: THREE.Sprite; mat: THREE.SpriteMaterial; phase: number; baseY: number }>;
  star?: THREE.Sprite;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

/** Mint bubbling spout on the west edge. */
export function buildSource(): SourceGoal {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const baseGeom = new THREE.CylinderGeometry(0.34, 0.4, 0.16, 20);
  geometries.push(baseGeom);
  const baseMat = toon({ color: hex(palette.mintDeep) });
  materials.push(baseMat);
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.set(-3.5, TABLE_TOP_Y + 0.08, 0);
  group.add(base);

  const stemGeom = new THREE.CylinderGeometry(0.17, 0.2, 0.52, 20);
  geometries.push(stemGeom);
  const stemMat = toon({ color: hex(palette.mint) });
  materials.push(stemMat);
  const stem = new THREE.Mesh(stemGeom, stemMat);
  stem.position.set(-3.5, TABLE_TOP_Y + 0.42, 0);
  group.add(stem);

  const rimGeom = new THREE.TorusGeometry(0.17, 0.055, 10, 22);
  geometries.push(rimGeom);
  const rimMat = toon({ color: hex(palette.sun) });
  materials.push(rimMat);
  const rim = new THREE.Mesh(rimGeom, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-3.5, TABLE_TOP_Y + 0.69, 0);
  group.add(rim);

  // rising bubbles
  const bubbles: SourceGoal["bubbles"] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.SpriteMaterial({
      map: starSpriteTexture,
      color: hex(palette.bubble),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    materials.push(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.16);
    sprite.position.set(-3.5 + (i - 1) * 0.13, TABLE_TOP_Y + 0.72, (i - 1) * 0.1);
    group.add(sprite);
    bubbles.push({ sprite, mat, phase: i * 0.37, baseY: TABLE_TOP_Y + 0.7 });
  }

  return { group, bubbles, materials, geometries };
}

/** Gold star basin on the east edge. */
export function buildGoal(): SourceGoal {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const bowlGeom = new THREE.CylinderGeometry(0.46, 0.5, 0.14, 22);
  geometries.push(bowlGeom);
  const bowlMat = toon({ color: hex(palette.sunDeep) });
  materials.push(bowlMat);
  const bowl = new THREE.Mesh(bowlGeom, bowlMat);
  bowl.position.set(3.5, TABLE_TOP_Y + 0.07, 0);
  group.add(bowl);

  const innerGeom = new THREE.CylinderGeometry(0.38, 0.38, 0.03, 22);
  geometries.push(innerGeom);
  const innerMat = toon({ color: hex(palette.sun) });
  materials.push(innerMat);
  const inner = new THREE.Mesh(innerGeom, innerMat);
  inner.position.set(3.5, TABLE_TOP_Y + 0.13, 0);
  group.add(inner);

  const starMat = new THREE.SpriteMaterial({
    map: starSpriteTexture,
    color: hex(palette.white),
    transparent: true,
    depthWrite: false,
  });
  materials.push(starMat);
  const star = new THREE.Sprite(starMat);
  star.scale.setScalar(0.42);
  star.position.set(3.5, TABLE_TOP_Y + 0.28, 0);
  group.add(star);

  return { group, bubbles: [], star, materials, geometries };
}

/* ------------------------------------------------------------------ */
/*  Water flow celebration kit                                         */
/* ------------------------------------------------------------------ */

const MAX_SEGMENTS = 10;

export interface FlowFx {
  group: THREE.Group;
  /** Show a run along the given polyline (Vector3 points, world space). */
  show(points: THREE.Vector3[]): void;
  /** Advance the run; returns true while animating (hidden at end). */
  update(dt: number, t: number): boolean;
  hide(): void;
  dispose(): void;
}

interface WaterSeg {
  mesh: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
  delay: number;
  shown: boolean;
}

export function createFlowFx(): FlowFx {
  const group = new THREE.Group();
  const segments: WaterSeg[] = [];
  const segMats: THREE.MeshToonMaterial[] = [];

  const beadMat = new THREE.MeshToonMaterial({ color: hex(palette.bubble), gradientMap: celGradient });
  const bead = new THREE.Mesh(beadGeom, beadMat);
  bead.visible = false;
  group.add(bead);

  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const mat = toon({ color: hex(palette.mint) });
    segMats.push(mat);
    const mesh = new THREE.Mesh(segGeom, mat);
    mesh.visible = false;
    mesh.scale.setScalar(0.001);
    group.add(mesh);
    segments.push({ mesh, mat, delay: 0, shown: false });
  }

  const flashMat = new THREE.MeshBasicMaterial({
    color: hex(palette.mint),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(flashGeom, flashMat);
  flash.position.y = WATER_Y + 0.5;
  flash.rotation.x = -Math.PI / 2;
  flash.visible = false;
  group.add(flash);

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  let pts: THREE.Vector3[] = [];
  let t = 0;
  let active = false;
  let pathLen = 0;

  const fx: FlowFx = {
    group,
    show(points: THREE.Vector3[]) {
      pts = points;
      t = 0;
      active = true;
      pathLen = 0;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        s.shown = false;
        s.mesh.visible = false;
        s.mesh.scale.setScalar(0.001);
        if (i < points.length - 1) {
          const a = points[i];
          const b = points[i + 1];
          const len = a.distanceTo(b);
          pathLen += len;
          s.delay = 0.06 + i * 0.055;
          s.mesh.position.copy(a).add(b).multiplyScalar(0.5);
          s.mesh.scale.set(1, len, 1);
          dir.copy(b).sub(a).normalize();
          s.mesh.quaternion.setFromUnitVectors(up, dir);
          s.mesh.visible = true;
        }
      }
      bead.visible = true;
      bead.position.copy(points[0]);
      flash.visible = true;
      flashMat.opacity = 0.55;
    },
    update(dt: number, now: number): boolean {
      if (!active) return false;
      t += dt;
      const travel = 0.6;
      const p = Math.min(1, Math.max(0, (t - 0.05) / travel));
      // bead along the polyline
      const total = pts.length - 1;
      const fp = p * total;
      const i = Math.min(total - 1, Math.floor(fp));
      const k = fp - i;
      const a = pts[i];
      const b = pts[i + 1];
      bead.position.lerpVectors(a, b, k);
      bead.position.y += Math.sin(now * 18) * 0.02;
      const pulse = 1 + 0.16 * Math.sin(now * 26);
      bead.scale.setScalar(pulse);
      // segments pop in behind the bead
      for (const s of segments) {
        if (s.shown || !s.mesh.visible) continue;
        if (t >= s.delay) {
          s.shown = true;
        } else {
          const kk = Math.min(1, t / s.delay);
          s.mesh.scale.set(0.001 + kk * 0.001, s.mesh.scale.y, 0.001 + kk * 0.001);
        }
      }
      // flash fade
      flashMat.opacity = Math.max(0, 0.55 * (1 - t / 0.32));
      if (p >= 1) {
        active = false;
        bead.visible = false;
        flash.visible = false;
        for (const s of segments) s.mesh.visible = false;
        return false;
      }
      return true;
    },
    hide() {
      active = false;
      bead.visible = false;
      flash.visible = false;
      for (const s of segments) s.mesh.visible = false;
    },
    dispose() {
      beadGeom; // shared, never disposed
      beadMat.dispose();
      segGeom; // shared
      for (const m of segMats) m.dispose();
      flashMat.dispose();
    },
  };
  return fx;
}

/* ------------------------------------------------------------------ */
/*  Star confetti burst                                                */
/* ------------------------------------------------------------------ */

export interface Confetti {
  spawn(
    points: Array<{ x: number; y: number; z: number }>,
    opts: { colors: string[]; countPerPoint: number; speed: number; life: number; upBias: number }
  ): void;
  update(dt: number): void;
  clear(): void;
}

interface BurstParticle {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

export function createConfetti(scene: THREE.Scene, poolSize: number, rng: () => number): Confetti {
  const pool: BurstParticle[] = [];
  for (let i = 0; i < poolSize; i++) {
    const mat = new THREE.SpriteMaterial({
      map: starSpriteTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.001);
    scene.add(sprite);
    pool.push({ sprite, mat, vel: new THREE.Vector3(), life: 0, maxLife: 1, baseScale: 0.2 });
  }
  let cursor = 0;

  return {
    spawn(points, opts) {
      const colors = opts.colors.map((c) => hex(c));
      for (const pt of points) {
        for (let n = 0; n < opts.countPerPoint; n++) {
          const p = pool[cursor % pool.length];
          cursor += 1;
          p.sprite.position.set(
            pt.x + (rng() * 2 - 1) * 0.24,
            pt.y + rng() * 0.3,
            pt.z + (rng() * 2 - 1) * 0.24
          );
          const a = rng() * Math.PI * 2;
          const sp = opts.speed * (0.5 + rng() * 0.9);
          p.vel.set(Math.cos(a) * sp, opts.upBias * sp * (0.4 + rng() * 0.6), Math.sin(a) * sp);
          p.life = opts.life * (0.7 + rng() * 0.6);
          p.maxLife = p.life;
          p.baseScale = 0.14 + rng() * 0.14;
          p.mat.color.setHex(colors[Math.floor(rng() * colors.length)]);
          p.mat.opacity = 1;
        }
      }
    },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mat.opacity = 0;
          p.sprite.scale.setScalar(0.001);
          continue;
        }
        p.vel.y -= 2.4 * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
        const k = p.life / p.maxLife;
        p.mat.opacity = Math.min(1, k * 2);
        p.sprite.scale.setScalar(p.baseScale * (0.7 + 0.3 * Math.sin(p.life * 9)));
      }
    },
    clear() {
      for (const p of pool) {
        p.life = 0;
        p.mat.opacity = 0;
        p.sprite.scale.setScalar(0.001);
      }
    },
  };
}

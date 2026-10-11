/**
 * SUPER STAR PARTY — pipe_puzzle: the visual kit.
 *
 * Pipe faces are drawn from KIND_SIDES (grid.ts): one arm per listed side,
 * the very list the logic builds its masks from. A tile turns with
 * tileYaw(rot), clockwise seen from the top-down camera, matching the logic
 * (side s -> s + 1). In dev a self-check at load maps every drawn arm through
 * the face UVs and the yaw and asserts it lands on a side the logic opens.
 *
 * Boards: one big board for the local player (tray, spout, star basin,
 * cursor) and small mini-boards in each rival's colour with a progress bar.
 * Shared textures and geometry are module-level and never disposed (same
 * convention as characters/cel.ts); per-board materials are disposed by the
 * board's dispose().
 *
 * Presentation only: no gameplay rng in here.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import {
  CELLS,
  E,
  ENTRY_ROW,
  KIND_SIDES,
  N,
  PIPE_KINDS,
  S,
  SIZE,
  W,
  openSides,
  type PipeKind,
} from "./grid";

/* ------------------------------------------------------------------ */
/*  Orientation: one convention for art and logic                      */
/* ------------------------------------------------------------------ */

/** Yaw for `turns` clockwise quarter turns seen from above (+y down). */
export function tileYaw(turns: number): number {
  return -turns * (Math.PI / 2);
}

const TEX = 128;
/** Canvas point where the arm toward each side ends (canvas top = north). */
const ARM_END: ReadonlyArray<readonly [number, number]> = [
  [64, 0], // N
  [128, 64], // E
  [64, 128], // S
  [0, 64], // W
];

/** Unit face, lying flat, facing up: canvas top -> -z (north), left -> -x. */
const faceGeom = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
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

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number): void {
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

/** One arm per side in KIND_SIDES, centre to edge. */
function armsPath(ctx: CanvasRenderingContext2D, kind: PipeKind): void {
  ctx.beginPath();
  for (const side of KIND_SIDES[kind]) {
    ctx.moveTo(64, 64);
    ctx.lineTo(ARM_END[side][0], ARM_END[side][1]);
  }
}

const DRY_PIPE = palette.rock;
const WET_PIPE = palette.bubble;

function drawPipeFace(ctx: CanvasRenderingContext2D, kind: PipeKind, wet: boolean): void {
  ctx.fillStyle = wet ? palette.white : palette.cream;
  ctx.fillRect(0, 0, TEX, TEX);
  roundRectPath(ctx, 5, 5, TEX - 10, TEX - 10, 16);
  ctx.lineWidth = 8;
  ctx.strokeStyle = wet ? palette.bubbleDeep : palette.creamShadow;
  ctx.stroke();
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  armsPath(ctx, kind);
  ctx.lineWidth = 46;
  ctx.strokeStyle = palette.ink;
  ctx.stroke();
  armsPath(ctx, kind);
  ctx.lineWidth = 32;
  ctx.strokeStyle = wet ? WET_PIPE : DRY_PIPE;
  ctx.stroke();
  // round hub so bends and tees read as one pipe
  ctx.beginPath();
  ctx.arc(64, 64, 23, 0, Math.PI * 2);
  ctx.fillStyle = palette.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 64, 16, 0, Math.PI * 2);
  ctx.fillStyle = wet ? WET_PIPE : DRY_PIPE;
  ctx.fill();
  if (wet) {
    armsPath(ctx, kind);
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.stroke();
  }
  ctx.restore();
}

function makePipeTexture(kind: PipeKind, wet: boolean): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX, TEX);
  drawPipeFace(ctx, kind, wet);
  return toTexture(canvas);
}

const dryTex = new Map<PipeKind, THREE.CanvasTexture>();
const wetTex = new Map<PipeKind, THREE.CanvasTexture>();
for (const kind of PIPE_KINDS) {
  dryTex.set(kind, makePipeTexture(kind, false));
  wetTex.set(kind, makePipeTexture(kind, true));
}

export function pipeTexture(kind: PipeKind, wet: boolean): THREE.CanvasTexture {
  return (wet ? wetTex : dryTex).get(kind) as THREE.CanvasTexture;
}

function makeStarSpriteTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  starPath(ctx, 32, 34, 28);
  ctx.fillStyle = palette.ink;
  ctx.fill();
  starPath(ctx, 32, 34, 22);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  return toTexture(canvas);
}
export const starSpriteTexture = makeStarSpriteTexture();

function makePlusOneTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 80);
  ctx.font = "bold 64px Fredoka, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = palette.ink;
  ctx.strokeText("+1", 64, 42);
  ctx.fillStyle = palette.sun;
  ctx.fillText("+1", 64, 42);
  return toTexture(canvas);
}
export const plusOneTexture = makePlusOneTexture();

/* ------------------------------------------------------------------ */
/*  Dev self-check: drawn arms == logic openings, every kind/rotation  */
/* ------------------------------------------------------------------ */

function sideOfDir(x: number, z: number): number {
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? E : W;
  return z < 0 ? N : S;
}

/** Throws when the art would show a pipe the logic does not have. */
export function checkArtMatchesLogic(): void {
  const pos = faceGeom.getAttribute("position");
  const uv = faceGeom.getAttribute("uv");
  const corner = (u: number, v: number): THREE.Vector3 => {
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(uv.getX(i) - u) < 1e-6 && Math.abs(uv.getY(i) - v) < 1e-6) {
        return new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
    throw new Error("[pipe_puzzle] face geometry has no uv corner");
  };
  const p00 = corner(0, 0);
  const du = corner(1, 0).sub(p00);
  const dv = corner(0, 1).sub(p00);
  const euler = new THREE.Euler();
  for (const kind of PIPE_KINDS) {
    for (let rot = 0; rot < 4; rot++) {
      euler.set(0, tileYaw(rot), 0);
      const drawn = KIND_SIDES[kind]
        .map((side) => {
          // canvas px -> uv (CanvasTexture flipY: canvas top is v = 1)
          const u = ARM_END[side][0] / TEX;
          const v = 1 - ARM_END[side][1] / TEX;
          const p = p00.clone().addScaledVector(du, u).addScaledVector(dv, v).applyEuler(euler);
          return sideOfDir(p.x, p.z);
        })
        .sort();
      const logic = openSides(kind, rot).sort();
      if (drawn.join() !== logic.join()) {
        throw new Error(`[pipe_puzzle] art/logic mismatch: ${kind} rot ${rot} draws ${drawn} but opens ${logic}`);
      }
    }
  }
}

if (import.meta.env?.DEV) checkArtMatchesLogic();

/* ------------------------------------------------------------------ */
/*  Shared geometry / materials                                        */
/* ------------------------------------------------------------------ */

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const tileSideMat = toon(palette.cream);
const cylGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/* ------------------------------------------------------------------ */
/*  Board view (main and mini share the tile logic)                    */
/* ------------------------------------------------------------------ */

export const MAIN_STEP = 1;
export const MAIN_TILE = 0.92;
const MAIN_TILE_H = 0.18;
export const TRAY_H = 0.3;
/** Height of a main tile's top face above the board origin. */
export const MAIN_TOP_Y = TRAY_H + MAIN_TILE_H;
export const TURN_TIME = 0.12;

interface TileView {
  pivot: THREE.Group;
  face: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  kind: PipeKind;
  wet: boolean;
  /** Unwrapped quarter turns shown (tweens toward `to`). */
  shown: number;
  from: number;
  to: number;
  tween: number;
  lift: number;
  pop: number;
}

function cellX(c: number, step: number): number {
  return (c - (SIZE - 1) / 2) * step;
}
function cellZ(r: number, step: number): number {
  return (r - (SIZE - 1) / 2) * step;
}

interface TileSet {
  tiles: TileView[];
  materials: THREE.Material[];
}

function buildTiles(parent: THREE.Group, step: number, size: number, topY: number, body: boolean): TileSet {
  const tiles: TileView[] = [];
  const materials: THREE.Material[] = [];
  for (let i = 0; i < CELLS; i++) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    const pivot = new THREE.Group();
    pivot.position.set(cellX(c, step), topY, cellZ(r, step));
    const mat = new THREE.MeshBasicMaterial({ map: pipeTexture("straight", false) });
    materials.push(mat);
    const face = new THREE.Mesh(faceGeom, mat);
    face.scale.set(size, 1, size);
    face.position.y = 0.002;
    pivot.add(face);
    if (body) {
      const block = new THREE.Mesh(unitBox, tileSideMat);
      block.scale.set(size, MAIN_TILE_H, size);
      block.position.y = -MAIN_TILE_H / 2;
      block.castShadow = true;
      pivot.add(block);
    }
    parent.add(pivot);
    tiles.push({ pivot, face, mat, kind: "straight", wet: false, shown: 0, from: 0, to: 0, tween: 1, lift: 0, pop: 1 });
  }
  return { tiles, materials };
}

function paintTile(t: TileView): void {
  t.mat.map = pipeTexture(t.kind, t.wet);
  t.mat.color.setScalar(t.wet ? 1 : 0.86);
  t.mat.needsUpdate = true;
}

function setTiles(tiles: TileView[], kinds: readonly PipeKind[], rots: readonly number[], pop: boolean): void {
  for (let i = 0; i < CELLS; i++) {
    const t = tiles[i];
    t.kind = kinds[i];
    t.wet = false;
    t.shown = rots[i];
    t.from = rots[i];
    t.to = rots[i];
    t.tween = 1;
    t.pop = pop ? -0.03 * ((i % SIZE) + Math.floor(i / SIZE)) : 1;
    paintTile(t);
  }
}

function setTilesWet(tiles: TileView[], wet: readonly boolean[]): void {
  for (let i = 0; i < CELLS; i++) {
    if (tiles[i].wet === wet[i]) continue;
    tiles[i].wet = wet[i];
    paintTile(tiles[i]);
  }
}

function turnTile(t: TileView): void {
  t.from = t.shown;
  t.to += 1;
  t.tween = 0;
}

function animateTiles(tiles: TileView[], dt: number, lift: number): void {
  for (const t of tiles) {
    if (t.tween < 1) {
      t.tween = Math.min(1, t.tween + dt / TURN_TIME);
      t.shown = t.from + (t.to - t.from) * easeOutCubic(t.tween);
      t.lift = Math.sin(Math.PI * t.tween) * lift;
    } else {
      t.shown = t.to;
      t.lift = 0;
    }
    t.pivot.rotation.y = tileYaw(t.shown);
    if (t.pop < 1) t.pop = Math.min(1, t.pop + dt / 0.22);
    const k = Math.max(0, t.pop);
    t.pivot.scale.setScalar(k >= 1 ? 1 : Math.max(0.001, easeOutBack(k)));
  }
}

/* ------------------------------------------------------------------ */
/*  Main board                                                         */
/* ------------------------------------------------------------------ */

export interface MainBoard {
  group: THREE.Group;
  setPuzzle(kinds: readonly PipeKind[], rots: readonly number[], exitRow: number): void;
  setWet(wet: readonly boolean[], solved: boolean): void;
  turn(cell: number): void;
  setCursor(cell: number | null): void;
  /** World position of the star (for the splash). */
  starWorld(out: THREE.Vector3): THREE.Vector3;
  /** Board-local cell under a board-local x/z, or -1. */
  cellAt(x: number, z: number): number;
  pulseStar(): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

/** `color` is the owner's colour: the tray frame marks whose board it is. */
export function createMainBoard(color: string): MainBoard {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const half = (SIZE * MAIN_STEP) / 2;

  // tray: ink rim, frame in the owner's colour, mint felt
  const wood = toon(color);
  const felt = toon(palette.mintDeep);
  const ink = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
  materials.push(wood, felt, ink);
  const rim = new THREE.Mesh(unitBox, ink);
  rim.scale.set(2 * half + 0.34, TRAY_H - 0.04, 2 * half + 0.34);
  rim.position.y = (TRAY_H - 0.04) / 2;
  group.add(rim);
  const frame = new THREE.Mesh(unitBox, wood);
  frame.scale.set(2 * half + 0.26, TRAY_H, 2 * half + 0.26);
  frame.position.y = TRAY_H / 2;
  group.add(frame);
  const feltMesh = new THREE.Mesh(unitBox, felt);
  feltMesh.scale.set(2 * half + 0.02, 0.02, 2 * half + 0.02);
  feltMesh.position.y = TRAY_H + 0.005;
  group.add(feltMesh);

  const { tiles, materials: tileMats } = buildTiles(group, MAIN_STEP, MAIN_TILE, MAIN_TOP_Y, true);
  materials.push(...tileMats);

  // water in: spout on the left of the entry row, with a short wet stub
  const waterMat = toon(palette.bubble);
  const dryMat = toon(DRY_PIPE);
  const stubInk = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
  materials.push(waterMat, dryMat, stubInk);
  const spout = new THREE.Group();
  const spoutBase = new THREE.Mesh(cylGeom, toon(palette.mintDeep));
  materials.push(spoutBase.material as THREE.Material);
  spoutBase.scale.set(0.5, 0.5, 0.5);
  spoutBase.position.y = 0.25;
  spout.add(spoutBase);
  const spoutTop = new THREE.Mesh(cylGeom, waterMat);
  spoutTop.scale.set(0.38, 0.06, 0.38);
  spoutTop.position.y = 0.52;
  spout.add(spoutTop);
  spout.position.set(-half - 0.32, 0, cellZ(ENTRY_ROW, MAIN_STEP));
  group.add(spout);
  const inStub = new THREE.Mesh(unitBox, waterMat);
  inStub.scale.set(0.4, 0.12, 0.26);
  inStub.position.set(-half - 0.1, MAIN_TOP_Y - 0.04, cellZ(ENTRY_ROW, MAIN_STEP));
  group.add(inStub);
  const bubbles: THREE.Sprite[] = [];
  const bubbleMat = new THREE.SpriteMaterial({ color: hex(palette.white), transparent: true, opacity: 0.85, depthWrite: false });
  materials.push(bubbleMat);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Sprite(bubbleMat);
    b.scale.setScalar(0.1);
    spout.add(b);
    bubbles.push(b);
  }

  // water out: a stub toward the star basin (dry until solved)
  const outStub = new THREE.Mesh(unitBox, dryMat);
  outStub.scale.set(0.4, 0.12, 0.26);
  group.add(outStub);
  const basin = new THREE.Group();
  const bowl = new THREE.Mesh(cylGeom, toon(palette.sunDeep));
  materials.push(bowl.material as THREE.Material);
  bowl.scale.set(0.56, 0.3, 0.56);
  bowl.position.y = 0.15;
  basin.add(bowl);
  const bowlIn = new THREE.Mesh(cylGeom, toon(palette.sun));
  materials.push(bowlIn.material as THREE.Material);
  bowlIn.scale.set(0.44, 0.04, 0.44);
  bowlIn.position.y = 0.31;
  basin.add(bowlIn);
  const starMat = new THREE.SpriteMaterial({ map: starSpriteTexture, transparent: true, depthWrite: false });
  materials.push(starMat);
  const star = new THREE.Sprite(starMat);
  star.scale.setScalar(0.62);
  star.position.y = 0.62;
  basin.add(star);
  group.add(basin);
  let starPulse = 0;

  // keyboard cursor: a raised glowing frame over a tile
  const cursor = new THREE.Group();
  const glowMat = new THREE.MeshBasicMaterial({ color: hex(palette.sun), transparent: true, opacity: 0.5, depthWrite: false });
  const barMat = new THREE.MeshBasicMaterial({ color: hex(palette.sun) });
  const barInk = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
  materials.push(glowMat, barMat, barInk);
  // halo on the felt, around (not over) the lifted tile, so the pipe stays readable
  const glow = new THREE.Mesh(faceGeom, glowMat);
  glow.scale.set(1.22, 1, 1.22);
  glow.position.y = -MAIN_TILE_H - 0.06;
  cursor.add(glow);
  const L = 1.04;
  const T = 0.1;
  for (let k = 0; k < 4; k++) {
    const horiz = k < 2;
    const sign = k % 2 === 0 ? -1 : 1;
    const bar = new THREE.Mesh(unitBox, barMat);
    bar.scale.set(horiz ? L + T : T, 0.08, horiz ? T : L + T);
    bar.position.set(horiz ? 0 : (sign * L) / 2, 0.1, horiz ? (sign * L) / 2 : 0);
    cursor.add(bar);
    const edge = new THREE.Mesh(unitBox, barInk);
    edge.scale.set(horiz ? L + T + 0.06 : T + 0.06, 0.05, horiz ? T + 0.06 : L + T + 0.06);
    edge.position.copy(bar.position);
    edge.position.y = 0.06;
    cursor.add(edge);
  }
  cursor.visible = false;
  group.add(cursor);
  let cursorCell: number | null = null;

  const placeExit = (row: number): void => {
    const z = cellZ(row, MAIN_STEP);
    outStub.position.set(half + 0.1, MAIN_TOP_Y - 0.04, z);
    basin.position.set(half + 0.34, 0, z);
  };
  placeExit(0);

  const view: MainBoard = {
    group,
    setPuzzle(kinds, rots, exitRow) {
      setTiles(tiles, kinds, rots, true);
      placeExit(exitRow);
      outStub.material = dryMat;
    },
    setWet(wet, solved) {
      setTilesWet(tiles, wet);
      outStub.material = solved ? waterMat : dryMat;
    },
    turn(cell) {
      turnTile(tiles[cell]);
    },
    setCursor(cell) {
      cursorCell = cell;
      cursor.visible = cell !== null;
    },
    starWorld(out) {
      return star.getWorldPosition(out);
    },
    cellAt(x, z) {
      const c = Math.floor(x / MAIN_STEP + SIZE / 2);
      const r = Math.floor(z / MAIN_STEP + SIZE / 2);
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1;
      return r * SIZE + c;
    },
    pulseStar() {
      starPulse = 1;
    },
    update(dt, time) {
      animateTiles(tiles, dt, 0.14);
      if (cursorCell !== null) {
        const t = tiles[cursorCell];
        const bob = 0.04 * Math.sin(time * 6);
        t.pivot.position.y = MAIN_TOP_Y + 0.08 + t.lift;
        cursor.position.set(t.pivot.position.x, MAIN_TOP_Y + 0.1 + bob, t.pivot.position.z);
        glowMat.opacity = 0.55 + 0.25 * Math.sin(time * 6);
      }
      for (let i = 0; i < CELLS; i++) {
        if (i === cursorCell) continue;
        tiles[i].pivot.position.y = MAIN_TOP_Y + tiles[i].lift;
      }
      starPulse = Math.max(0, starPulse - dt * 2.2);
      star.scale.setScalar(0.62 * (1 + 0.06 * Math.sin(time * 4) + 0.6 * starPulse));
      for (let i = 0; i < bubbles.length; i++) {
        const k = (time * 0.7 + i / bubbles.length) % 1;
        bubbles[i].position.set((i - 1) * 0.1, 0.56 + k * 0.6, 0);
        bubbles[i].material.opacity = 0.85 * (1 - k);
      }
    },
    dispose() {
      for (const m of materials) m.dispose();
      group.removeFromParent();
    },
  };
  return view;
}

/* ------------------------------------------------------------------ */
/*  Mini board (a rival's live copy)                                   */
/* ------------------------------------------------------------------ */

export const MINI_STEP = 0.34;
const MINI_TILE = 0.31;
const MINI_TOP_Y = 0.12;
/** Panel footprint (x by z), centred on the group origin. */
export const MINI_W = SIZE * MINI_STEP + 0.3;
export const MINI_H = SIZE * MINI_STEP + 0.62;

export interface MiniBoard {
  group: THREE.Group;
  setPuzzle(kinds: readonly PipeKind[], rots: readonly number[], exitRow: number): void;
  setWet(wet: readonly boolean[]): void;
  setProgress(k: number): void;
  turn(cell: number): void;
  flash(): void;
  setBaseScale(s: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createMiniBoard(color: string): MiniBoard {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const gridZ0 = -0.14; // grid sits in the upper part, bar below
  const plateInk = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
  const plateMat = toon(color);
  const well = new THREE.MeshBasicMaterial({ color: hex(palette.ink) });
  materials.push(plateInk, plateMat, well);
  const inkPlate = new THREE.Mesh(unitBox, plateInk);
  inkPlate.scale.set(MINI_W + 0.08, 0.08, MINI_H + 0.08);
  inkPlate.position.y = 0.03;
  group.add(inkPlate);
  const plate = new THREE.Mesh(unitBox, plateMat);
  plate.scale.set(MINI_W, 0.1, MINI_H);
  plate.position.y = 0.05;
  group.add(plate);
  const wellMesh = new THREE.Mesh(unitBox, well);
  wellMesh.scale.set(SIZE * MINI_STEP + 0.04, 0.02, SIZE * MINI_STEP + 0.04);
  wellMesh.position.set(0, 0.105, gridZ0);
  group.add(wellMesh);

  const tileRoot = new THREE.Group();
  tileRoot.position.z = gridZ0;
  group.add(tileRoot);
  const { tiles, materials: tileMats } = buildTiles(tileRoot, MINI_STEP, MINI_TILE, MINI_TOP_Y, false);
  materials.push(...tileMats);

  // entry dot and exit star
  const dotMat = new THREE.MeshBasicMaterial({ color: hex(palette.bubble) });
  materials.push(dotMat);
  const dot = new THREE.Mesh(faceGeom, dotMat);
  dot.scale.set(0.1, 1, 0.1);
  dot.position.set(-(SIZE * MINI_STEP) / 2 - 0.06, 0.12, gridZ0 + cellZ(ENTRY_ROW, MINI_STEP));
  group.add(dot);
  const starMat = new THREE.SpriteMaterial({ map: starSpriteTexture, transparent: true, depthWrite: false });
  materials.push(starMat);
  const star = new THREE.Sprite(starMat);
  star.scale.setScalar(0.26);
  group.add(star);

  // progress bar
  const barY = 0.12;
  const barZ = (MINI_H / 2) - 0.17;
  const barW = SIZE * MINI_STEP;
  const barBg = new THREE.Mesh(faceGeom, new THREE.MeshBasicMaterial({ color: hex(palette.ink) }));
  materials.push(barBg.material as THREE.Material);
  barBg.scale.set(barW + 0.04, 1, 0.16);
  barBg.position.set(0, barY, barZ);
  group.add(barBg);
  const barFillMat = new THREE.MeshBasicMaterial({ color: hex(palette.bubble) });
  materials.push(barFillMat);
  const barFill = new THREE.Mesh(faceGeom, barFillMat);
  barFill.position.set(0, barY + 0.003, barZ);
  group.add(barFill);
  let progress = 0;
  let shownProgress = 0;
  let flashT = 0;
  let baseScale = 1;

  const view: MiniBoard = {
    group,
    setPuzzle(kinds, rots, exitRow) {
      setTiles(tiles, kinds, rots, true);
      star.position.set((SIZE * MINI_STEP) / 2 + 0.07, 0.24, gridZ0 + cellZ(exitRow, MINI_STEP));
    },
    setWet(wet) {
      setTilesWet(tiles, wet);
    },
    setProgress(k) {
      progress = Math.max(0, Math.min(1, k));
      if (progress < shownProgress) shownProgress = progress;
    },
    turn(cell) {
      turnTile(tiles[cell]);
    },
    setBaseScale(s) {
      baseScale = s;
      group.scale.setScalar(s);
    },
    flash() {
      flashT = 1;
      shownProgress = 1;
      progress = 1;
    },
    update(dt) {
      animateTiles(tiles, dt, 0);
      shownProgress += (progress - shownProgress) * Math.min(1, dt * 10);
      const w = Math.max(0.001, barW * shownProgress);
      barFill.scale.set(w, 1, 0.1);
      barFill.position.x = -barW / 2 + w / 2;
      flashT = Math.max(0, flashT - dt * 2.5);
      group.scale.setScalar(baseScale * (1 + 0.1 * flashT));
      barFillMat.color.setHex(flashT > 0 ? hex(palette.sun) : hex(palette.bubble));
    },
    dispose() {
      for (const m of materials) m.dispose();
      group.removeFromParent();
    },
  };
  return view;
}

/* ------------------------------------------------------------------ */
/*  Star confetti burst                                                */
/* ------------------------------------------------------------------ */

export interface Confetti {
  spawn(at: THREE.Vector3, opts: { colors: string[]; count: number; speed: number; life: number; upBias: number }): void;
  update(dt: number): void;
  dispose(): void;
}

interface BurstParticle {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

/** Cosmetic only: `rng` is a separate stream, never ctx.rng. */
export function createConfetti(parent: THREE.Object3D, poolSize: number, rng: () => number): Confetti {
  const pool: BurstParticle[] = [];
  for (let i = 0; i < poolSize; i++) {
    const mat = new THREE.SpriteMaterial({ map: starSpriteTexture, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.001);
    sprite.visible = false;
    parent.add(sprite);
    pool.push({ sprite, mat, vel: new THREE.Vector3(), life: 0, maxLife: 1, baseScale: 0.2 });
  }
  let cursor = 0;
  return {
    spawn(at, opts) {
      const colors = opts.colors.map((c) => hex(c));
      for (let n = 0; n < opts.count; n++) {
        const p = pool[cursor % pool.length];
        cursor += 1;
        p.sprite.position.set(at.x + (rng() * 2 - 1) * 0.2, at.y + rng() * 0.2, at.z + (rng() * 2 - 1) * 0.2);
        const a = rng() * Math.PI * 2;
        const sp = opts.speed * (0.5 + rng() * 0.9);
        p.vel.set(Math.cos(a) * sp, opts.upBias * sp * (0.4 + rng() * 0.6), Math.sin(a) * sp);
        p.life = opts.life * (0.7 + rng() * 0.6);
        p.maxLife = p.life;
        p.baseScale = 0.16 + rng() * 0.14;
        p.mat.color.setHex(colors[Math.floor(rng() * colors.length) % colors.length]);
        p.mat.opacity = 1;
        p.sprite.visible = true;
      }
    },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.sprite.visible = false;
          continue;
        }
        p.vel.y -= 3 * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
        const k = p.life / p.maxLife;
        p.mat.opacity = Math.min(1, k * 2);
        p.sprite.scale.setScalar(p.baseScale * (0.7 + 0.3 * Math.sin(p.life * 9)));
      }
    },
    dispose() {
      for (const p of pool) {
        p.sprite.removeFromParent();
        p.mat.dispose();
      }
    },
  };
}

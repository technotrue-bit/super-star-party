/**
 * SUPER STAR PARTY — memory_match: card + texture + particle kit.
 *
 * Everything here is PROPORTIONAL to the palette and 100% procedural
 * (canvas drawing, no assets). Shared module-level textures/geometry are
 * created once and intentionally NEVER disposed (same convention as
 * characters/cel.ts) — teardown() only removes scene objects and disposes
 * per-instance materials/geometries.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/* ------------------------------------------------------------------ */
/*  Card dimensions / layout constants                                 */
/* ------------------------------------------------------------------ */

export const CARD_W = 0.7;
export const CARD_H = 0.92;
export const CARD_T = 0.06;
export const GRID_ROWS = 4;
export const GRID_COLS = 4;
export const GRID_STEP = 1.08;
/** Y of the tabletop surface cards stand on. */
export const TABLE_TOP_Y = 0.82;

/** World position of a grid cell (row 0 = far row, z negative). */
export function gridPos(row: number, col: number): { x: number; z: number } {
  return {
    x: (col - (GRID_COLS - 1) / 2) * GRID_STEP,
    z: (row - (GRID_ROWS - 1) / 2) * GRID_STEP,
  };
}

/* ------------------------------------------------------------------ */
/*  Canvas helpers                                                     */
/* ------------------------------------------------------------------ */

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

/** Rounded rectangle path (card faces). */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 5-point star path centered at (cx, cy), outer radius R. */
function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  points = 5
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? R : R * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const INK = palette.ink;
const CREAM = palette.cream;

/** Card face chrome: cream ground + thick ink rounded border. */
function drawCardChrome(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = CREAM;
  roundRect(ctx, 2, 2, size - 4, size - 4, 14);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  roundRect(ctx, 7, 7, size - 14, size - 14, 11);
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/*  The 8 procedural pair icons                                        */
/* ------------------------------------------------------------------ */

export const ICON_IDS = [
  "star",
  "coin",
  "mushroom",
  "balloon",
  "cake",
  "cherry",
  "heart",
  "gem",
] as const;

export type IconId = (typeof ICON_IDS)[number];

function drawIconStar(ctx: CanvasRenderingContext2D, s: number): void {
  // gold star with ink outline + white glint
  starPath(ctx, s / 2, s / 2 - 4, 42);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  starPath(ctx, s / 2 - 12, s / 2 - 16, 9);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
}

function drawIconCoin(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  const cy = s / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fillStyle = palette.sunDeep;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = palette.sun;
  ctx.stroke();
  starPath(ctx, cx, cy, 20);
  ctx.fillStyle = palette.sun;
  ctx.fill();
}

function drawIconMushroom(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  // cap
  ctx.beginPath();
  ctx.arc(cx, 56, 40, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = palette.lava;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // cap dots
  for (const [dx, dy] of [
    [-16, 38],
    [14, 42],
    [2, 22],
  ]) {
    ctx.beginPath();
    ctx.arc(cx + dx, dy, 8, 0, Math.PI * 2);
    ctx.fillStyle = palette.white;
    ctx.fill();
  }
  // stem
  roundRect(ctx, cx - 24, 76, 48, 40, 12);
  ctx.fillStyle = palette.cream;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawIconBalloon(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  ctx.beginPath();
  ctx.arc(cx, 50, 38, 0, Math.PI * 2);
  ctx.fillStyle = palette.candy;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // knot
  ctx.beginPath();
  ctx.moveTo(cx - 8, 84);
  ctx.lineTo(cx, 92);
  ctx.lineTo(cx + 8, 84);
  ctx.closePath();
  ctx.fillStyle = palette.candyDeep;
  ctx.fill();
  ctx.stroke();
  // string
  ctx.beginPath();
  ctx.moveTo(cx, 92);
  ctx.quadraticCurveTo(cx - 16, 104, cx - 4, 114);
  ctx.quadraticCurveTo(cx + 10, 122, cx + 2, 128);
  ctx.lineWidth = 5;
  ctx.strokeStyle = palette.bubbleDeep;
  ctx.stroke();
  // glint
  ctx.beginPath();
  ctx.arc(cx - 13, 36, 9, 0, Math.PI * 2);
  ctx.fillStyle = palette.white;
  ctx.fill();
}

function drawIconCake(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  // bottom tier
  roundRect(ctx, cx - 44, 78, 88, 34, 8);
  ctx.fillStyle = palette.sunDeep;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // top tier
  roundRect(ctx, cx - 32, 44, 64, 36, 8);
  ctx.fillStyle = palette.cream;
  ctx.fill();
  ctx.stroke();
  // frosting scallops
  ctx.fillStyle = palette.candy;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(cx - 28 + i * 14, 44, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  // candle
  roundRect(ctx, cx - 4, 18, 8, 22, 3);
  ctx.fillStyle = palette.bubble;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // flame
  starPath(ctx, cx, 10, 9);
  ctx.fillStyle = palette.lava;
  ctx.fill();
}

function drawIconCherry(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  // stems
  ctx.beginPath();
  ctx.moveTo(cx - 16, 88);
  ctx.quadraticCurveTo(cx - 30, 44, cx + 2, 22);
  ctx.moveTo(cx + 16, 88);
  ctx.quadraticCurveTo(cx + 30, 44, cx + 2, 22);
  ctx.lineWidth = 6;
  ctx.strokeStyle = palette.mintDeep;
  ctx.stroke();
  // cherries
  for (const dx of [-16, 16]) {
    ctx.beginPath();
    ctx.arc(cx + dx, 92, 24, 0, Math.PI * 2);
    ctx.fillStyle = palette.lava;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + dx - 8, 84, 6, 0, Math.PI * 2);
    ctx.fillStyle = palette.white;
    ctx.fill();
  }
  // leaf
  ctx.beginPath();
  ctx.ellipse(cx + 18, 18, 14, 8, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = palette.mint;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawIconHeart(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  ctx.beginPath();
  ctx.moveTo(cx, 96);
  ctx.bezierCurveTo(cx - 62, 52, cx - 34, 16, cx, 46);
  ctx.bezierCurveTo(cx + 34, 16, cx + 62, 52, cx, 96);
  ctx.closePath();
  ctx.fillStyle = palette.candy;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - 22, 38, 10, 0, Math.PI * 2);
  ctx.fillStyle = palette.white;
  ctx.fill();
}

function drawIconGem(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  const top = 26;
  const mid = 66;
  const bot = 96;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + 34, mid);
  ctx.lineTo(cx + 24, bot);
  ctx.lineTo(cx, 108);
  ctx.lineTo(cx - 24, bot);
  ctx.lineTo(cx - 34, mid);
  ctx.closePath();
  ctx.fillStyle = palette.bubble;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // facet lines
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, 108);
  ctx.moveTo(cx - 34, mid);
  ctx.lineTo(cx, mid);
  ctx.moveTo(cx + 34, mid);
  ctx.lineTo(cx, mid);
  ctx.moveTo(cx - 24, bot);
  ctx.lineTo(cx, mid);
  ctx.moveTo(cx + 24, bot);
  ctx.lineTo(cx, mid);
  ctx.lineWidth = 4;
  ctx.strokeStyle = palette.bubbleDeep;
  ctx.stroke();
  // glint
  ctx.beginPath();
  ctx.arc(cx - 10, 40, 6, 0, Math.PI * 2);
  ctx.fillStyle = palette.white;
  ctx.fill();
}

const ICON_DRAWERS: Record<IconId, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  star: drawIconStar,
  coin: drawIconCoin,
  mushroom: drawIconMushroom,
  balloon: drawIconBalloon,
  cake: drawIconCake,
  cherry: drawIconCherry,
  heart: drawIconHeart,
  gem: drawIconGem,
};

/* ------------------------------------------------------------------ */
/*  Shared textures & geometry (module-level, never disposed)          */
/* ------------------------------------------------------------------ */

const TEX_SIZE = 128;

const iconTextures = new Map<IconId, THREE.CanvasTexture>();
for (const id of ICON_IDS) {
  const [canvas, ctx] = makeCanvas(TEX_SIZE);
  drawCardChrome(ctx, TEX_SIZE);
  ICON_DRAWERS[id](ctx, TEX_SIZE);
  iconTextures.set(id, toTexture(canvas));
}

/** Face-down back: candy stripes + gold star, same chrome border. */
function makeBackTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX_SIZE);
  drawCardChrome(ctx, TEX_SIZE);
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, 10, 10, TEX_SIZE - 20, TEX_SIZE - 20, 9);
  ctx.clip();
  ctx.translate(TEX_SIZE / 2, TEX_SIZE / 2);
  ctx.rotate(Math.PI / 4);
  const stripeW = 16;
  for (let x = -TEX_SIZE * 1.5; x < TEX_SIZE * 1.5; x += stripeW * 2) {
    ctx.fillStyle = palette.mint;
    ctx.fillRect(x, -TEX_SIZE, stripeW, TEX_SIZE * 2);
    ctx.fillStyle = palette.candy;
    ctx.fillRect(x + stripeW, -TEX_SIZE, stripeW, TEX_SIZE * 2);
  }
  ctx.restore();
  // center gold star over the stripes
  starPath(ctx, TEX_SIZE / 2, TEX_SIZE / 2, 34);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  return toTexture(canvas);
}
const backTexture = makeBackTexture();

/** Small gold star used by confetti + per-player pair pips. */
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

const cardGeom = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_T);

function toon(mat: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ ...mat, gradientMap: celGradient });
}

/**
 * Card faces are "printed" flat canvas art (chrome border + icon): unlit
 * MeshBasicMaterial keeps them crisp at any camera angle. Cel shading
 * would drop them into the toon mid band (faces point away from the key
 * light) and turn cream into murky gray. The table/arena stays cel.
 */
function printed(mat: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(mat);
}

/** Edge + back materials shared by every card. */
const edgeMat = printed({ color: hex(palette.woodDark) });
const backMat = printed({ map: backTexture });

/** One shared icon-face material per pair. */
const iconMats = new Map<IconId, THREE.MeshBasicMaterial>();
for (const id of ICON_IDS) {
  iconMats.set(id, printed({ map: iconTextures.get(id) }));
}

/* ------------------------------------------------------------------ */
/*  Card mesh                                                          */
/* ------------------------------------------------------------------ */

export interface CardMesh {
  mesh: THREE.Mesh;
  iconId: IconId;
}

/**
 * Build one standing card tile. +Z face = patterned back (visible while
 * face-down), -Z face = icon (visible after a 180deg flip).
 */
export function createCardMesh(iconId: IconId): CardMesh {
  const mesh = new THREE.Mesh(cardGeom, [
    edgeMat,
    edgeMat,
    edgeMat,
    edgeMat,
    backMat,
    iconMats.get(iconId) as THREE.MeshBasicMaterial,
  ]);
  mesh.castShadow = true;
  return { mesh, iconId };
}

/* ------------------------------------------------------------------ */
/*  Star sprite particles (confetti, match sparkles)                   */
/* ------------------------------------------------------------------ */

export interface StarBurst {
  spawn(
    points: Array<{ x: number; y: number; z: number }>,
    opts: { colors: string[]; countPerPoint: number; speed: number; life: number; upBias: number }
  ): void;
  update(dt: number): void;
  clear(): void;
}

interface BurstParticle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

export function createStarBurst(scene: THREE.Scene, poolSize: number, rng: () => number): StarBurst {
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
    sprite.visible = false;
    scene.add(sprite);
    pool.push({
      sprite,
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      baseScale: 0.3,
    });
  }
  let cursor = 0;

  const burst: StarBurst = {
    spawn(points, opts) {
      for (const p of points) {
        for (let k = 0; k < opts.countPerPoint; k++) {
          const part = pool[cursor % pool.length];
          cursor++;
          const mat = part.sprite.material as THREE.SpriteMaterial;
          mat.color.set(opts.colors[Math.floor(rng() * opts.colors.length)]);
          part.sprite.position.set(p.x, p.y, p.z);
          part.baseScale = 0.22 + rng() * 0.2;
          part.sprite.scale.setScalar(part.baseScale);
          part.maxLife = opts.life * (0.7 + rng() * 0.6);
          part.life = part.maxLife;
          // spherical-ish burst biased upward
          const a = rng() * Math.PI * 2;
          const r = rng();
          part.vel.set(
            Math.cos(a) * r * opts.speed,
            opts.upBias + rng() * opts.speed * 0.9,
            Math.sin(a) * r * opts.speed
          );
          mat.opacity = 1;
          part.sprite.visible = true;
        }
      }
    },
    update(dt) {
      for (const part of pool) {
        if (part.life <= 0) continue;
        part.life -= dt;
        if (part.life <= 0) {
          part.sprite.visible = false;
          continue;
        }
        const k = part.life / part.maxLife;
        part.sprite.position.addScaledVector(part.vel, dt);
        part.vel.y -= dt * 3.2; // gravity
        const s = part.baseScale * (0.6 + 0.4 * k);
        part.sprite.scale.setScalar(s);
        (part.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.6);
      }
    },
    clear() {
      for (const part of pool) {
        part.life = 0;
        part.sprite.visible = false;
        part.sprite.removeFromParent();
        (part.sprite.material as THREE.SpriteMaterial).dispose();
      }
    },
  };
  return burst;
}

/* ------------------------------------------------------------------ */
/*  Table                                                              */
/* ------------------------------------------------------------------ */

/** Build the wooden table + mint felt top. Returns per-instance root. */
export function buildTable(): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const woodMat = toon({ color: hex(palette.wood) });
  const woodDarkMat = toon({ color: hex(palette.woodDark) });
  const feltMat = toon({ color: hex(palette.mint) });

  const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.14, 4.6), woodDarkMat);
  base.position.y = 0.66;
  base.receiveShadow = true;
  group.add(base);

  const top = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.16, 4.4), woodMat);
  top.position.y = 0.74;
  top.receiveShadow = true;
  group.add(top);

  const felt = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.05, 3.8), feltMat);
  felt.position.y = 0.85;
  felt.receiveShadow = true;
  group.add(felt);

  const legMat = woodDarkMat;
  for (const [lx, lz] of [
    [-2.4, -1.95],
    [2.4, -1.95],
    [-2.4, 1.95],
    [2.4, 1.95],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.2), legMat);
    leg.position.set(lx, 0.33, lz);
    leg.castShadow = true;
    group.add(leg);
  }

  return {
    group,
    dispose() {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      });
    },
  };
}

/**
 * SUPER STAR PARTY — memory_match: card art, textures and particle kit.
 *
 * Everything is procedural canvas drawing (no assets). Shared module-level
 * textures and geometry are created once and never disposed (same convention
 * as characters/cel.ts); teardown only disposes per-instance materials.
 *
 * Cards lie FLAT on the table. A card is a thin box: its +Y face is the
 * patterned back, its -Y face the icon. rotation.x = 0 shows the back
 * (face-down); rotation.x = PI shows the icon upright to a camera looking
 * down from +Z (face-up).
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/* ------------------------------------------------------------------ */
/*  Card dimensions / layout                                           */
/* ------------------------------------------------------------------ */

/** Card width (x), depth (z) and thickness, in world units. */
export const CARD_W = 1.0;
export const CARD_D = 1.25;
export const CARD_T = 0.05;
export const GRID_COLS = 4;
export const GRID_ROWS = 3;
export const STEP_X = 1.13;
export const STEP_Z = 1.38;
/** Felt surface height; cards rest on it. */
export const TABLE_Y = 0.3;
export const CARD_Y = TABLE_Y + CARD_T / 2;

/** World x/z of a grid cell (row 0 = far row, toward -z). */
export function gridPos(row: number, col: number): { x: number; z: number } {
  return {
    x: (col - (GRID_COLS - 1) / 2) * STEP_X,
    z: (row - (GRID_ROWS - 1) / 2) * STEP_Z,
  };
}

/* ------------------------------------------------------------------ */
/*  Canvas helpers                                                     */
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

/** Face texture size: the icon art is drawn in a 128 box, centred in a 128x160 card. */
const TEX_W = 128;
const TEX_H = 160;
const ICON_Y = (TEX_H - TEX_W) / 2;

/** Card chrome: cream ground + thick ink rounded border. */
function drawCardChrome(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CREAM;
  roundRect(ctx, 2, 2, TEX_W - 4, TEX_H - 4, 14);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  roundRect(ctx, 7, 7, TEX_W - 14, TEX_H - 14, 11);
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
/*  Shared textures, geometry and materials (never disposed)           */
/* ------------------------------------------------------------------ */

const iconTextures = new Map<IconId, THREE.CanvasTexture>();
for (const id of ICON_IDS) {
  const [canvas, ctx] = makeCanvas(TEX_W, TEX_H);
  drawCardChrome(ctx);
  ctx.save();
  ctx.translate(0, ICON_Y);
  ICON_DRAWERS[id](ctx, TEX_W);
  ctx.restore();
  iconTextures.set(id, toTexture(canvas));
}

/** Face-down back: candy stripes + a round gold seal (looks the same at any turn). */
function makeBackTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX_W, TEX_H);
  drawCardChrome(ctx);
  ctx.save();
  roundRect(ctx, 10, 10, TEX_W - 20, TEX_H - 20, 9);
  ctx.clip();
  ctx.translate(TEX_W / 2, TEX_H / 2);
  ctx.rotate(Math.PI / 4);
  const stripeW = 16;
  for (let x = -TEX_H * 1.5; x < TEX_H * 1.5; x += stripeW * 2) {
    ctx.fillStyle = palette.berry;
    ctx.fillRect(x, -TEX_H, stripeW, TEX_H * 2);
    ctx.fillStyle = palette.berryDeep;
    ctx.fillRect(x + stripeW, -TEX_H, stripeW, TEX_H * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(TEX_W / 2, TEX_H / 2, 34, 0, Math.PI * 2);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  starPath(ctx, TEX_W / 2, TEX_H / 2 + 2, 22);
  ctx.fillStyle = palette.white;
  ctx.fill();
  return toTexture(canvas);
}
const backTexture = makeBackTexture();

/** Small white-edged gold star for the sparkle bursts. */
function makeStarSpriteTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  starPath(ctx, 32, 34, 26);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  starPath(ctx, 32, 34, 22);
  ctx.fillStyle = palette.sun;
  ctx.fill();
  return toTexture(canvas);
}
const starSpriteTexture = makeStarSpriteTexture();

/**
 * Rounded-rect outline (ink rim around a white band, clear middle) for the
 * target frame, the keyboard cursor and the player's own pick. Tinted by
 * the material colour: the white band takes the tint, the ink rim stays dark.
 */
function makeFrameTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(TEX_W + 32, TEX_H + 32);
  ctx.lineJoin = "round";
  ctx.lineWidth = 22;
  ctx.strokeStyle = INK;
  roundRect(ctx, 12, 12, TEX_W + 8, TEX_H + 8, 20);
  ctx.stroke();
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#FFFFFF";
  roundRect(ctx, 12, 12, TEX_W + 8, TEX_H + 8, 20);
  ctx.stroke();
  return toTexture(canvas);
}
export const frameTexture = makeFrameTexture();

/** Keyboard cursor: four thick corner brackets (a different shape from the frames). */
function makeCursorTexture(): THREE.CanvasTexture {
  const W = TEX_W + 32;
  const H = TEX_H + 32;
  const [canvas, ctx] = makeCanvas(W, H);
  const arm = 44;
  const m = 12;
  const corners: Array<[number, number, number, number]> = [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [m, H - m, 1, -1],
    [W - m, H - m, -1, -1],
  ];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [width, color] of [
    [24, INK],
    [13, "#FFFFFF"],
  ] as const) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * arm, y);
      ctx.stroke();
    }
  }
  return toTexture(canvas);
}
export const cursorTexture = makeCursorTexture();
/** Frame plane size for a card scaled by `pad` (the canvas has a 16 px margin each side). */
export function frameSize(pad = 1): { w: number; d: number } {
  return { w: CARD_W * ((TEX_W + 32) / TEX_W) * pad, d: CARD_D * ((TEX_H + 32) / TEX_H) * pad };
}

const cardGeom = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_D);

function toon(mat: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ ...mat, gradientMap: celGradient });
}

/**
 * Card faces are "printed" flat canvas art: unlit MeshBasicMaterial keeps
 * them crisp. The table stays cel shaded.
 */
const edgeMat = new THREE.MeshBasicMaterial({ color: hex(palette.cream) });

/* ------------------------------------------------------------------ */
/*  Card mesh                                                          */
/* ------------------------------------------------------------------ */

export interface CardMesh {
  mesh: THREE.Mesh;
  /** Per-card materials (tinted to dim a solved pair); dispose in teardown. */
  faceMat: THREE.MeshBasicMaterial;
  backMat: THREE.MeshBasicMaterial;
}

/** One flat card: back on +Y, icon on -Y. */
export function createCardMesh(iconId: IconId): CardMesh {
  const faceMat = new THREE.MeshBasicMaterial({ map: iconTextures.get(iconId) });
  const backMat = new THREE.MeshBasicMaterial({ map: backTexture });
  const mesh = new THREE.Mesh(cardGeom, [edgeMat, edgeMat, backMat, faceMat, edgeMat, edgeMat]);
  mesh.castShadow = true;
  return { mesh, faceMat, backMat };
}

/* ------------------------------------------------------------------ */
/*  Star sprite particles (match sparkles, finale confetti)            */
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

/** `rng` here is cosmetic only (a seeded side stream, never ctx.rng). */
export function createStarBurst(parent: THREE.Object3D, poolSize: number, rng: () => number): StarBurst {
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
    sprite.renderOrder = 12;
    parent.add(sprite);
    pool.push({ sprite, vel: new THREE.Vector3(), life: 0, maxLife: 1, baseScale: 0.3 });
  }
  let cursor = 0;

  return {
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
        part.vel.y -= dt * 3.2;
        part.sprite.scale.setScalar(part.baseScale * (0.6 + 0.4 * k));
        (part.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 1.6);
      }
    },
    clear() {
      for (const part of pool) {
        part.life = 0;
        part.sprite.removeFromParent();
        (part.sprite.material as THREE.SpriteMaterial).dispose();
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Table                                                              */
/* ------------------------------------------------------------------ */

/** Felt extents (x half-width, z min/max). The sign strip sits at the far end. */
export const FELT = { hx: 2.35, z0: -2.9, z1: 2.2 };

/** Low wooden card table with a felt top, sitting on the lawn. */
export function buildTable(): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const woodMat = toon({ color: hex(palette.wood) });
  const woodDarkMat = toon({ color: hex(palette.woodDark) });
  const feltMat = toon({ color: hex(palette.mintDeep) });
  const w = FELT.hx * 2;
  const d = FELT.z1 - FELT.z0;
  const cz = (FELT.z0 + FELT.z1) / 2;

  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.18, d + 0.5), woodDarkMat);
  base.position.set(0, 0.09, cz);
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.1, d + 0.4), woodMat);
  rim.position.set(0, 0.23, cz);
  rim.receiveShadow = true;
  group.add(rim);

  const felt = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), feltMat);
  felt.position.set(0, TABLE_Y - 0.02, cz);
  felt.receiveShadow = true;
  group.add(felt);

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

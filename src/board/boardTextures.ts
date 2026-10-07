/**
 * SUPER STAR PARTY — procedural canvas textures for the board.
 * All textures are drawn with Canvas 2D at 64x64 and sampled with
 * NearestFilter for the crisp retro-cartoon look. Palette-only colors.
 */
import * as THREE from "three";
import { palette, hex } from "../config/palette";
import type { SpaceType, StampKind } from "../core/game";

const SIZE = 64;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, opts?: { repeat?: boolean }): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts?.repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.needsUpdate = true;
  return t;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Star polygon path (canvas coords). points=4 gives the sparkle twinkle. */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points: number, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---- shared base pattern for space disks --------------------------------------
function drawDiskBase(ctx: CanvasRenderingContext2D, base: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // subtle radial rings (white + black so they read on light and dark bases)
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  for (const r of [12, 21]) {
    circle(ctx, 32, 32, r);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  circle(ctx, 32, 32, 9);
  ctx.stroke();
  // printed rim ring
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 3;
  circle(ctx, 32, 32, 29.5);
  ctx.stroke();
}

// ---- icons (drawn upright in the canvas; see orientation note in boardScene) --
function drawCoin(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = palette.sun;
  circle(ctx, 32, 32, 12);
  ctx.fill();
  ctx.strokeStyle = palette.sunDeep;
  ctx.lineWidth = 2.5;
  circle(ctx, 32, 32, 12);
  ctx.stroke();
  circle(ctx, 32, 32, 7);
  ctx.stroke();
  ctx.fillStyle = palette.white;
  circle(ctx, 28, 28, 2.6);
  ctx.fill();
}

function drawMinus(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = palette.cream;
  roundRectPath(ctx, 21, 28.5, 22, 7, 3.5);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function drawQuestion(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = palette.cream;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // hook: open at lower-right, closed at upper-left
  ctx.beginPath();
  ctx.arc(32, 27, 10, Math.PI * 0.42, Math.PI * 1.58, true);
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(32.9, 17.2);
  ctx.quadraticCurveTo(39.5, 18.8, 40.5, 27);
  ctx.stroke();
  // dot
  ctx.fillStyle = palette.cream;
  circle(ctx, 36.5, 40.5, 2.9);
  ctx.fill();
}

function drawStarIcon(ctx: CanvasRenderingContext2D): void {
  starPath(ctx, 32, 32, 13, 5.5, 5);
  ctx.fillStyle = palette.white;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function drawBag(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(32, 29, 6.5, Math.PI, 0, false);
  ctx.stroke();
  ctx.fillStyle = palette.white;
  roundRectPath(ctx, 23, 29, 18, 15, 3);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.fillStyle = palette.ink;
  circle(ctx, 32, 36.5, 1.6);
  ctx.fill();
}

/** Grumpy face, parameterized so it can serve as disk icon and 3D face disc. */
function drawGrumpyFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, stroke: number): void {
  ctx.fillStyle = palette.cream;
  circle(ctx, cx, cy, 13 * s);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = stroke;
  ctx.stroke();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3.6 * s;
  ctx.lineCap = "round";
  // angry brows slanting down toward the center
  ctx.beginPath();
  ctx.moveTo(cx - 8 * s, cy - 5.5 * s);
  ctx.lineTo(cx - 2.5 * s, cy - 2.5 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 8 * s, cy - 5.5 * s);
  ctx.lineTo(cx + 2.5 * s, cy - 2.5 * s);
  ctx.stroke();
  // eyes
  ctx.fillStyle = palette.ink;
  circle(ctx, cx - 4.5 * s, cy + 1 * s, 2 * s);
  ctx.fill();
  circle(ctx, cx + 4.5 * s, cy + 1 * s, 2 * s);
  ctx.fill();
  // frown (curve bulging down)
  ctx.beginPath();
  ctx.arc(cx, cy + 7.5 * s, 5 * s, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

// ---- per-type disk textures ----------------------------------------------------
const DISK_BASE: Record<SpaceType, string> = {
  blue: palette.mint,
  red: palette.lava,
  green: palette.berry,
  star: palette.sun,
  shop: palette.bubble,
  grumpus: palette.lavaDeep,
  stamp: palette.heroPip,          // carnival stamp
  minigame_balloon: palette.candy, // balloon pop
};

const STAMP_SEAL: Record<StampKind, string> = {
  shy: palette.lava,
  goomba: palette.wood,
  koopa: palette.mint,
};

function diskTexture(type: SpaceType): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, SIZE);
  drawDiskBase(ctx, DISK_BASE[type]);
  switch (type) {
    case "blue":
      drawCoin(ctx);
      break;
    case "red":
      drawMinus(ctx);
      break;
    case "green":
      drawQuestion(ctx);
      break;
    case "star":
      drawStarIcon(ctx);
      break;
    case "shop":
      drawBag(ctx);
      break;
    case "grumpus":
      drawGrumpyFace(ctx, 32, 32, 1, 2);
      break;
    case "stamp":
      drawStamp(ctx);
      break;
    case "minigame_balloon":
      drawBalloon(ctx);
      break;
  }
  return toTexture(c);
}

/** Ticket punched with a gold seal — reads as a stamp from above. */
function drawStamp(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = palette.cream;
  roundRectPath(ctx, 16, 18, 32, 28, 5);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.fillStyle = palette.sun;
  circle(ctx, 32, 32, 7);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.6;
  circle(ctx, 32, 32, 7);
  ctx.stroke();
}

/** Cream balloon with a knot and string. The price lives on the 3D prop. */
function drawBalloon(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = palette.cream;
  circle(ctx, 32, 26, 12);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(29, 36.5);
  ctx.lineTo(32, 42);
  ctx.lineTo(35, 36.5);
  ctx.closePath();
  ctx.fillStyle = palette.cream;
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(32, 42);
  ctx.quadraticCurveTo(38, 50, 30, 56);
  ctx.stroke();
}

/** Colored seal with the stamp's initial, laid on the space as a 3D disc. */
function stampSealTexture(kind: StampKind): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, SIZE);
  ctx.fillStyle = STAMP_SEAL[kind];
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = palette.cream;
  circle(ctx, 32, 32, 18);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  circle(ctx, 32, 32, 18);
  ctx.stroke();
  ctx.fillStyle = palette.ink;
  ctx.font = "700 28px Fredoka, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const letter = kind === "shy" ? "S" : kind === "goomba" ? "G" : "K";
  ctx.fillText(letter, 32, 34);
  return toTexture(c);
}

/** Cream price tag for a 5- or 10-coin minigame balloon. */
function balloonBadgeTexture(coins: 5 | 10): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, SIZE);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = palette.cream;
  circle(ctx, 32, 32, 22);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 4;
  circle(ctx, 32, 32, 22);
  ctx.stroke();
  ctx.fillStyle = palette.ink;
  ctx.font = "700 26px Fredoka, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(coins), 32, 34);
  return toTexture(c);
}

/** Grumpy face disc that sits on top of grumpus space disks (transparent bg). */
function faceDiscTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, SIZE);
  ctx.clearRect(0, 0, SIZE, SIZE);
  drawGrumpyFace(ctx, 32, 36, 2, 3);
  return toTexture(c);
}

// ---- scenery textures -----------------------------------------------------------
/** 3-band cel ramp sampled along U: dark (left) -> light (right). */
function toonGradientTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, 4);
  const bands: [number, string][] = [
    [0, "#737373"], // shadow band
    [Math.floor(SIZE / 3), "#B8B8B8"], // mid band
    [Math.floor((2 * SIZE) / 3), "#FFFFFF"], // lit band
  ];
  for (let i = 0; i < bands.length; i++) {
    const [start, color] = bands[i];
    const end = i + 1 < bands.length ? bands[i + 1][0] : SIZE;
    ctx.fillStyle = color;
    ctx.fillRect(start, 0, end - start, 4);
  }
  return toTexture(c);
}

/** Vertical candy stripes for tents: 8 stripes of a/b. */
function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, SIZE);
  const w = SIZE / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.fillRect(i * w, 0, w, SIZE);
  }
  return toTexture(c);
}

/** 2x2 grass checker; one texture tile = two `groundTile` squares. */
function grassTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(SIZE, SIZE);
  const h = SIZE / 2;
  ctx.fillStyle = palette.grassA;
  ctx.fillRect(0, 0, h, h);
  ctx.fillRect(h, h, h, h);
  ctx.fillStyle = palette.grassB;
  ctx.fillRect(h, 0, h, h);
  ctx.fillRect(0, h, h, h);
  return toTexture(c, { repeat: true });
}

// ---- kit ------------------------------------------------------------------------
export interface BoardTextures {
  grad: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
  face: THREE.CanvasTexture;
  disks: Record<SpaceType, THREE.CanvasTexture>;
  stampSeal: Record<StampKind, THREE.CanvasTexture>;
  balloonBadge: Record<5 | 10, THREE.CanvasTexture>;
  /** Get (and cache) a candy-stripe texture for a color pair. */
  stripe: (a: string, b: string) => THREE.CanvasTexture;
  dispose: () => void;
}

const stripeCache = new Map<string, THREE.CanvasTexture>();

/** Build every texture the board needs. Dispose with kit.dispose(). */
export function buildKit(): BoardTextures {
  const disks = {} as Record<SpaceType, THREE.CanvasTexture>;
  const spaceTypes: SpaceType[] = [
    "blue", "red", "green", "star", "shop", "grumpus", "stamp", "minigame_balloon",
  ];
  for (const t of spaceTypes) {
    disks[t] = diskTexture(t);
  }
  const stampSeal = {
    shy: stampSealTexture("shy"),
    goomba: stampSealTexture("goomba"),
    koopa: stampSealTexture("koopa"),
  };
  const balloonBadge = {
    5: balloonBadgeTexture(5),
    10: balloonBadgeTexture(10),
  };
  const stripe = (a: string, b: string): THREE.CanvasTexture => {
    const key = `${hex(a)}|${hex(b)}`;
    let t = stripeCache.get(key);
    if (!t) {
      t = stripeTexture(a, b);
      stripeCache.set(key, t);
    }
    return t;
  };
  return {
    grad: toonGradientTexture(),
    grass: grassTexture(),
    face: faceDiscTexture(),
    disks,
    stampSeal,
    balloonBadge,
    stripe,
    dispose() {
      this.grad.dispose();
      this.grass.dispose();
      this.face.dispose();
      for (const t of Object.values(this.disks)) t.dispose();
      for (const t of Object.values(this.stampSeal)) t.dispose();
      for (const t of Object.values(this.balloonBadge)) t.dispose();
      for (const t of stripeCache.values()) t.dispose();
      stripeCache.clear();
    },
  };
}

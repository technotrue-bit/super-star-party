/**
 * SUPER STAR PARTY — procedural canvas textures for the board.
 * Scenery textures are drawn with Canvas 2D at 64x64 and sampled with
 * NearestFilter for the crisp retro-cartoon look; space disks are drawn in the
 * same 64-unit coordinates at a higher resolution (see DISK_RES) and sampled
 * smoothly so their icons read from the party camera. Palette-only colors.
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

function toTexture(c: HTMLCanvasElement, opts?: { repeat?: boolean; smooth?: boolean }): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts?.smooth) {
    // Hi-res disk faces: mipmapped so the bold icons stay clean when small.
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
  } else {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
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

// ---- space disks ----------------------------------------------------------------
// Disks are drawn in the same 64-unit coordinate space as everything else but
// rasterized at DISK_RES and sampled smoothly, so icons stay crisp from the
// high party camera. Each type gets its own base color, its own background
// pattern and a bold, ink-outlined icon so it reads at a glance (and for
// color-blind players, by shape alone).
const DISK_RES = 256;

/** Fill-then-ink-outline helper: thick ink under, colored fill on top. */
function inked(ctx: CanvasRenderingContext2D, path: () => void, fill: string, ink = 3.2): void {
  path();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = ink;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

type DiskPattern = "plain" | "rays" | "dots" | "stripes" | "checks";

function drawDiskBase(ctx: CanvasRenderingContext2D, base: string, deep: string, pattern: DiskPattern): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Background pattern, clipped to the face so the bevel ring stays clean.
  ctx.save();
  circle(ctx, 32, 32, 27);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  switch (pattern) {
    case "rays":
      for (let i = 0; i < 12; i += 2) {
        const a0 = (i * Math.PI) / 6;
        const a1 = ((i + 1) * Math.PI) / 6;
        ctx.beginPath();
        ctx.moveTo(32, 32);
        ctx.arc(32, 32, 40, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case "dots":
      for (let y = 6; y < SIZE; y += 10) {
        for (let x = (y / 10) % 2 < 1 ? 6 : 11; x < SIZE; x += 10) {
          circle(ctx, x, y, 2.2);
          ctx.fill();
        }
      }
      break;
    case "stripes":
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(-Math.PI / 4);
      for (let x = -48; x < 48; x += 12) ctx.fillRect(x, -48, 6, 96);
      ctx.restore();
      break;
    case "checks":
      for (let y = 0; y < SIZE; y += 8) {
        for (let x = (y / 8) % 2 === 0 ? 0 : 8; x < SIZE; x += 16) ctx.fillRect(x, y, 8, 8);
      }
      break;
    case "plain":
      // soft top-left sheen so plain disks don't look flat
      ctx.beginPath();
      ctx.arc(32, 32, 24, Math.PI * 0.95, Math.PI * 1.55);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.stroke();
      break;
  }
  ctx.restore();
  // Deep-tone bevel band + ink keyline: separates the face from the rim and
  // from the grass/path around it.
  ctx.strokeStyle = deep;
  ctx.lineWidth = 5;
  circle(ctx, 32, 32, 29.5);
  ctx.stroke();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.6;
  circle(ctx, 32, 32, 27);
  ctx.stroke();
}

// ---- icons (drawn upright in the canvas; see orientation note in boardScene) --
/** Big chunky plus: "you gain coins" (the twin of red's minus). */
function drawPlus(ctx: CanvasRenderingContext2D): void {
  inked(ctx, () => plusPath(ctx, 32, 32, 16, 5.5), palette.cream, 3.6);
}

function plusPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, arm: number, half: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - arm);
  ctx.lineTo(cx + half, cy - arm);
  ctx.lineTo(cx + half, cy - half);
  ctx.lineTo(cx + arm, cy - half);
  ctx.lineTo(cx + arm, cy + half);
  ctx.lineTo(cx + half, cy + half);
  ctx.lineTo(cx + half, cy + arm);
  ctx.lineTo(cx - half, cy + arm);
  ctx.lineTo(cx - half, cy + half);
  ctx.lineTo(cx - arm, cy + half);
  ctx.lineTo(cx - arm, cy - half);
  ctx.lineTo(cx - half, cy - half);
  ctx.closePath();
}

/** Big chunky minus: "you lose coins". */
function drawMinus(ctx: CanvasRenderingContext2D): void {
  inked(ctx, () => roundRectPath(ctx, 15, 26.5, 34, 11, 5.5), palette.cream, 3.6);
}

/** Bold question mark: "something happens". */
function drawQuestion(ctx: CanvasRenderingContext2D): void {
  const hook = (): void => {
    ctx.beginPath();
    ctx.moveTo(23.5, 24);
    ctx.bezierCurveTo(23.5, 15, 40.5, 14, 40.5, 23.5);
    ctx.bezierCurveTo(40.5, 30, 32, 29.5, 32, 37);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 11;
  hook();
  ctx.stroke();
  ctx.strokeStyle = palette.cream;
  ctx.lineWidth = 7;
  hook();
  ctx.stroke();
  inked(ctx, () => circle(ctx, 32, 45.5, 4), palette.cream, 3);
}

function drawStarIcon(ctx: CanvasRenderingContext2D): void {
  inked(ctx, () => starPath(ctx, 32, 33, 17, 7.5, 5), palette.white, 3.4);
}

function drawBag(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(32, 27, 7.5, Math.PI, 0, false);
  ctx.stroke();
  ctx.strokeStyle = palette.cream;
  ctx.lineWidth = 3;
  ctx.stroke();
  inked(ctx, () => roundRectPath(ctx, 19, 26, 26, 21, 4), palette.cream, 3.2);
  inked(ctx, () => circle(ctx, 32, 36.5, 4), palette.sun, 2);
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
interface DiskStyle {
  base: string;
  /** Bevel band; also the 3D rim color in boardScene. */
  deep: string;
  pattern: DiskPattern;
}

/**
 * Party-board convention (blue gives, red takes, green is a happening), with
 * every special space pushed far enough apart in hue AND pattern that no two
 * types read alike against the lawn or the sandy path.
 */
export const DISK_STYLE: Record<SpaceType, DiskStyle> = {
  blue: { base: palette.spaceBlue, deep: palette.spaceBlueDeep, pattern: "plain" },
  red: { base: palette.spaceRed, deep: palette.spaceRedDeep, pattern: "plain" },
  green: { base: palette.spaceGreen, deep: palette.spaceGreenDeep, pattern: "dots" },
  star: { base: palette.sun, deep: palette.sunDeep, pattern: "rays" },
  shop: { base: palette.berry, deep: palette.berryDeep, pattern: "stripes" },
  grumpus: { base: palette.ink, deep: palette.lava, pattern: "checks" },
  stamp: { base: palette.heroPip, deep: palette.woodDark, pattern: "stripes" },
  minigame_balloon: { base: palette.candy, deep: palette.candyDeep, pattern: "dots" },
};

const STAMP_SEAL: Record<StampKind, string> = {
  shy: palette.lava,
  goomba: palette.wood,
  koopa: palette.mint,
};

function diskTexture(type: SpaceType): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(DISK_RES, DISK_RES);
  ctx.scale(DISK_RES / SIZE, DISK_RES / SIZE);
  const st = DISK_STYLE[type];
  drawDiskBase(ctx, st.base, st.deep, st.pattern);
  switch (type) {
    case "blue":
      drawPlus(ctx);
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
      drawGrumpyFace(ctx, 32, 32, 1.15, 3);
      break;
    case "stamp":
      drawStamp(ctx);
      break;
    case "minigame_balloon":
      drawBalloon(ctx);
      break;
  }
  return toTexture(c, { smooth: true });
}

/** Ticket punched with a gold seal — reads as a stamp from above. */
function drawStamp(ctx: CanvasRenderingContext2D): void {
  const ticket = (): void => {
    // ticket with notched sides
    ctx.beginPath();
    ctx.moveTo(17, 19);
    ctx.lineTo(47, 19);
    ctx.lineTo(47, 28);
    ctx.arc(47, 32, 4, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(47, 45);
    ctx.lineTo(17, 45);
    ctx.lineTo(17, 36);
    ctx.arc(17, 32, 4, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
  };
  inked(ctx, ticket, palette.cream, 3.2);
  inked(ctx, () => circle(ctx, 32, 32, 7.5), palette.sun, 2.4);
}

/** Cream balloon with a knot and string. The price lives on the 3D prop. */
function drawBalloon(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(32, 42);
  ctx.quadraticCurveTo(39, 50, 30, 57);
  ctx.stroke();
  inked(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(28.5, 44);
    ctx.lineTo(32, 38);
    ctx.lineTo(35.5, 44);
    ctx.closePath();
  }, palette.cream, 2.6);
  inked(ctx, () => {
    ctx.beginPath();
    ctx.ellipse(32, 26, 12.5, 14, 0, 0, Math.PI * 2);
  }, palette.cream, 3.2);
  ctx.fillStyle = palette.white;
  ctx.beginPath();
  ctx.ellipse(27.5, 21, 2.6, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
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
  const letter = kind === "shy" ? "F" : kind === "goomba" ? "C" : "T";
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

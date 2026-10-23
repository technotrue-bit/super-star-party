import * as THREE from 'three';
import { palette } from '../config/palette';

export interface FaceSpec {
  smile: 'grin' | 'open' | 'half' | 'wide';
  eyeSize: number;
  /** A little white fang poking down from the smile (Rumble). */
  fang?: boolean;
  /** Mouth height on the face card. Default SMILE_Y; lower it to clear big eyes. */
  smileY?: number;
  /**
   * A skull face (Rattle): dark eye sockets with glowing pupils in this
   * color, a nose hole and a row of upper teeth instead of eyes and a smile.
   */
  skullGlow?: string;
  /**
   * Pops' own face, from Devin's drawing: one big shiny eye and a wink,
   * kissy "3" lips and a little purple heart on the cheek (blowing a kiss).
   */
  popsicle?: boolean;
}

const FACE_WIDTH = 256;
const FACE_HEIGHT = 128;

const EYE_Y = 52;
const EYE_RADIUS = 26;
const PUPIL_RADIUS = 11;
const PUPIL_OFFSET_X = 5;
const PUPIL_OFFSET_Y = 5;

const LEFT_EYE_X = 78;
const RIGHT_EYE_X = 178;

const CHEEK_Y = 70;
const CHEEK_RADIUS = 12;
const CHEEK_COLOR = 'rgba(255, 120, 160, 0.55)';

const SMILE_Y = 58; // sit under the eyes, inside the face card
const SMILE_STROKE = 8;

function drawSmile(ctx: CanvasRenderingContext2D, smile: FaceSpec['smile'], mouthY = SMILE_Y): void {
  if (smile === 'open') {
    // Filled half-ellipse: open mouth with darker fill, spanning x 52-76.
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.ellipse(128, mouthY, 24, 14, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    return;
  }

  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = SMILE_STROKE;
  ctx.lineCap = 'round';

  let centerX = 128;
  let radius = 22; // grin
  if (smile === 'half') {
    centerX = 136;
    radius = 14;
  } else if (smile === 'wide') {
    radius = 30;
  }

  ctx.beginPath();
  ctx.arc(centerX, mouthY, radius, 0, Math.PI);
  ctx.stroke();
}

function drawFang(ctx: CanvasRenderingContext2D, mouthY = SMILE_Y): void {
  ctx.fillStyle = palette.white;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(140, mouthY + 17);
  ctx.lineTo(152, mouthY + 13);
  ctx.lineTo(147, mouthY + 27);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Face states the animations switch between. */
export type Expression = 'normal' | 'blink' | 'happy' | 'sad' | 'surprised';
export const EXPRESSIONS: readonly Expression[] = ['normal', 'blink', 'happy', 'sad', 'surprised'];

function eyeWhite(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = palette.white;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function pupil(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = palette.ink;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.white;
  const glint = Math.max(2, r * 0.42);
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.4, glint, 0, Math.PI * 2);
  ctx.fill();
}

/** A thick ink arc used for closed / squinting eyes. `up` bows the arc upward (^). */
function eyeArc(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, up: boolean): void {
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (up) ctx.arc(x, y + w * 0.45, w, Math.PI * 1.15, Math.PI * 1.85);
  else ctx.arc(x, y - w * 0.55, w, Math.PI * 0.18, Math.PI * 0.82);
  ctx.stroke();
}

/**
 * Draw one character face in one expression. Eyes and mouth change with the
 * expression; cheeks always stay. Smooth (linear, mipmapped) so the face
 * stays clean when the camera is close.
 */
export function makeFaceTexture(spec: FaceSpec, expr: Expression = 'normal'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_WIDTH;
  canvas.height = FACE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }

  if (spec.skullGlow) {
    drawSkullFace(ctx, spec, expr, spec.skullGlow);
    return faceTexture(canvas);
  }
  if (spec.popsicle) {
    drawPopsFace(ctx, spec, expr);
    return faceTexture(canvas);
  }

  const eyeR = EYE_RADIUS * spec.eyeSize;
  const pupilR = PUPIL_RADIUS * spec.eyeSize;
  const lpx = LEFT_EYE_X + PUPIL_OFFSET_X * spec.eyeSize;
  const rpx = RIGHT_EYE_X - PUPIL_OFFSET_X * spec.eyeSize;
  const py = EYE_Y + PUPIL_OFFSET_Y * spec.eyeSize;
  const my = spec.smileY ?? SMILE_Y;

  // Rosy cheeks first, so eyes and mouth sit on top.
  ctx.fillStyle = CHEEK_COLOR;
  const cheekR = CHEEK_RADIUS * (expr === 'happy' ? 1.25 : 1);
  ctx.beginPath();
  ctx.arc(LEFT_EYE_X - 8, CHEEK_Y + 4, cheekR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(RIGHT_EYE_X + 8, CHEEK_Y + 4, cheekR, 0, Math.PI * 2);
  ctx.fill();

  switch (expr) {
    case 'blink':
      eyeArc(ctx, LEFT_EYE_X, EYE_Y + 6, eyeR * 0.75, false);
      eyeArc(ctx, RIGHT_EYE_X, EYE_Y + 6, eyeR * 0.75, false);
      drawSmile(ctx, spec.smile, my);
      break;
    case 'happy':
      // ^ ^ eyes and a big open grin with a tongue.
      eyeArc(ctx, LEFT_EYE_X, EYE_Y, eyeR * 0.8, true);
      eyeArc(ctx, RIGHT_EYE_X, EYE_Y, eyeR * 0.8, true);
      ctx.fillStyle = palette.ink;
      ctx.beginPath();
      ctx.ellipse(128, my + 2, 30, 22, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.candy;
      ctx.beginPath();
      ctx.ellipse(128, my + 15, 14, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sad': {
      // Pupils look down, brows tilt up in the middle, a wobbly frown.
      eyeWhite(ctx, LEFT_EYE_X, EYE_Y, eyeR, eyeR * 0.92);
      eyeWhite(ctx, RIGHT_EYE_X, EYE_Y, eyeR, eyeR * 0.92);
      pupil(ctx, lpx, py + 6, pupilR);
      pupil(ctx, rpx, py + 6, pupilR);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(LEFT_EYE_X - eyeR, EYE_Y - eyeR - 2);
      ctx.lineTo(LEFT_EYE_X + eyeR * 0.6, EYE_Y - eyeR - 12);
      ctx.moveTo(RIGHT_EYE_X + eyeR, EYE_Y - eyeR - 2);
      ctx.lineTo(RIGHT_EYE_X - eyeR * 0.6, EYE_Y - eyeR - 12);
      ctx.stroke();
      ctx.lineWidth = SMILE_STROKE;
      ctx.beginPath();
      ctx.arc(128, my + 30, 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    }
    case 'surprised':
      // Wide eyes, small pupils, a little "o".
      eyeWhite(ctx, LEFT_EYE_X, EYE_Y, eyeR * 1.12, eyeR * 1.18);
      eyeWhite(ctx, RIGHT_EYE_X, EYE_Y, eyeR * 1.12, eyeR * 1.18);
      pupil(ctx, LEFT_EYE_X, EYE_Y, pupilR * 0.75);
      pupil(ctx, RIGHT_EYE_X, EYE_Y, pupilR * 0.75);
      ctx.fillStyle = palette.ink;
      ctx.beginPath();
      ctx.ellipse(128, my + 10, 11, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      eyeWhite(ctx, LEFT_EYE_X, EYE_Y, eyeR, eyeR);
      eyeWhite(ctx, RIGHT_EYE_X, EYE_Y, eyeR, eyeR);
      pupil(ctx, lpx, py, pupilR);
      pupil(ctx, rpx, py, pupilR);
      drawSmile(ctx, spec.smile, my);
      break;
  }
  if (spec.fang && (expr === 'normal' || expr === 'blink')) drawFang(ctx, my);

  return faceTexture(canvas);
}

function faceTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Rattle's skull: deep eye sockets lit by glowing pupils, a little upside-down
 * heart of a nose, and a row of upper teeth along the bottom edge (his jaw is
 * a separate piece in the model, so the bite closes on it). Cheeks keep a
 * faint blush, because he's cute, not scary.
 */
function drawSkullFace(ctx: CanvasRenderingContext2D, spec: FaceSpec, expr: Expression, glow: string): void {
  const sx = 46 * spec.eyeSize * 0.5; // socket half-width
  const sy = 44 * spec.eyeSize * 0.5; // socket half-height
  const ey = 50;
  const eyes: [number, number][] = [
    [LEFT_EYE_X + 4, ey],
    [RIGHT_EYE_X - 4, ey],
  ];

  ctx.fillStyle = 'rgba(255, 120, 160, 0.38)';
  for (const [x] of eyes) {
    ctx.beginPath();
    ctx.ellipse(x + (x < 128 ? -14 : 14), ey + sy + 6, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sockets: egg shapes, a touch wider on top, in deep ink.
  const socket = (x: number, y: number, k = 1): void => {
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.ellipse(x, y, sx * k, sy * k, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // A glowing pupil with a soft halo and a white glint.
  const ember = (x: number, y: number, r: number): void => {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = r * 2.2;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.4, Math.max(2, r * 0.38), 0, Math.PI * 2);
    ctx.fill();
  };
  // A glowing stroke (closed or ^ eyes).
  const glowArc = (x: number, y: number, up: boolean): void => {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = glow;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (up) ctx.arc(x, y + 8, 12, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(x, y - 6, 12, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    ctx.restore();
  };

  switch (expr) {
    case 'blink':
      for (const [x, y] of eyes) {
        socket(x, y);
        glowArc(x, y + 2, false);
      }
      break;
    case 'happy':
      for (const [x, y] of eyes) {
        socket(x, y);
        glowArc(x, y, true);
      }
      break;
    case 'sad':
      for (const [x, y] of eyes) {
        socket(x, y);
        ember(x, y + 8, 8);
      }
      // Worried brow ridges.
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyes[0][0] - sx, ey - sy - 3);
      ctx.lineTo(eyes[0][0] + sx * 0.6, ey - sy - 12);
      ctx.moveTo(eyes[1][0] + sx, ey - sy - 3);
      ctx.lineTo(eyes[1][0] - sx * 0.6, ey - sy - 12);
      ctx.stroke();
      break;
    case 'surprised':
      for (const [x, y] of eyes) {
        socket(x, y, 1.12);
        ember(x, y, 6);
      }
      break;
    default:
      for (const [x, y] of eyes) {
        socket(x, y);
        ember(x + (x < 128 ? 3 : -3), y + 3, 10);
      }
      break;
  }

  // Nose: a little upside-down heart.
  ctx.fillStyle = palette.ink;
  ctx.beginPath();
  ctx.moveTo(128, 92);
  ctx.bezierCurveTo(116, 84, 118, 72, 124, 74);
  ctx.bezierCurveTo(126, 75, 127, 77, 128, 79);
  ctx.bezierCurveTo(129, 77, 130, 75, 132, 74);
  ctx.bezierCurveTo(138, 72, 140, 84, 128, 92);
  ctx.fill();

  // Upper teeth along the bottom edge: rounded tiles with ink seams.
  const teeth = 5;
  const tw = 15;
  const tx0 = 128 - (teeth * tw) / 2;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < teeth; i++) {
    const x = tx0 + i * tw;
    ctx.beginPath();
    ctx.roundRect(x + 1, 104, tw - 2, 20, [2, 2, 6, 6]);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Pops (the popsicle), drawn from Devin's sketch: a big solid-black eye with
 * a shine and a winking eye, puckered "3" lips and a purple heart under the
 * wink, so Pops is always blowing you a kiss. No sclera and no blush: the
 * heart is the cheek. The features sit lower on the card than the others'
 * (the face lives in the blue half of the bar, near the stick).
 */
function drawPopsFace(ctx: CanvasRenderingContext2D, spec: FaceSpec, expr: Expression): void {
  const r = 22 * spec.eyeSize;
  const L: [number, number] = [76, 44];
  const R: [number, number] = [178, 46];
  const mouth: [number, number] = [130, 100];

  // A solid ink eye with a big shine up and right and a small one down and left.
  const eye = (x: number, y: number, k = 1, lookY = 0): void => {
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.arc(x, y, r * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.white;
    ctx.beginPath();
    ctx.arc(x + r * k * 0.32, y - r * k * 0.34 + lookY, r * k * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * k * 0.38, y + r * k * 0.36 + lookY, r * k * 0.14, 0, Math.PI * 2);
    ctx.fill();
  };
  // The wink: a happy ^ with a little lash flicking out at the outer corner.
  const wink = (x: number, y: number): void => {
    eyeArc(ctx, x, y, r * 0.85, true);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + r * 0.78, y - 2);
    ctx.lineTo(x + r * 1.12, y - 10);
    ctx.stroke();
  };
  // Puckered lips: a little "3", like a kiss on its way.
  const kissLips = (x: number, y: number): void => {
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y - 7, 7, Math.PI * 1.1, Math.PI * 2.5);
    ctx.arc(x, y + 7, 7, Math.PI * 1.5, Math.PI * 2.9);
    ctx.stroke();
  };
  const heart = (x: number, y: number, s: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.25);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.bezierCurveTo(-14, 1, -12, -11, -5, -11);
    ctx.bezierCurveTo(-2, -11, -1, -8, 0, -6);
    ctx.bezierCurveTo(1, -8, 2, -11, 5, -11);
    ctx.bezierCurveTo(12, -11, 14, 1, 0, 10);
    ctx.closePath();
    ctx.fillStyle = palette.berry;
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 2.5 / s;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  };

  switch (expr) {
    case 'blink':
      eyeArc(ctx, L[0], L[1] + 6, r * 0.85, false);
      eyeArc(ctx, R[0], R[1] + 6, r * 0.85, false);
      kissLips(mouth[0], mouth[1]);
      heart(184, 84, 1);
      break;
    case 'happy':
      // ^ ^ and a big open grin with a tongue; the heart swells.
      eyeArc(ctx, L[0], L[1], r * 0.85, true);
      eyeArc(ctx, R[0], R[1], r * 0.85, true);
      ctx.fillStyle = palette.ink;
      ctx.beginPath();
      ctx.ellipse(128, 92, 24, 18, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.candy;
      ctx.beginPath();
      ctx.ellipse(128, 102, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      heart(188, 82, 1.25);
      break;
    case 'sad': {
      // Both eyes open and looking down, worried brows, a wobbly frown.
      eye(L[0], L[1] + 2, 0.9, 4);
      eye(R[0], R[1] + 2, 0.9, 4);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(L[0] - r, L[1] - r - 4);
      ctx.lineTo(L[0] + r * 0.6, L[1] - r - 13);
      ctx.moveTo(R[0] + r, R[1] - r - 4);
      ctx.lineTo(R[0] - r * 0.6, R[1] - r - 13);
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(128, 120, 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      heart(186, 86, 0.8);
      break;
    }
    case 'surprised':
      // Both eyes wide open and a little "o".
      eye(L[0], L[1], 1.1);
      eye(R[0], R[1], 1.1);
      ctx.fillStyle = palette.ink;
      ctx.beginPath();
      ctx.ellipse(128, 100, 9, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      heart(186, 84, 1);
      break;
    default:
      eye(L[0], L[1]);
      wink(R[0], R[1]);
      kissLips(mouth[0], mouth[1]);
      heart(184, 84, 1);
      break;
  }
}

export const faceSpecs: Record<string, FaceSpec> = {
  pip: { smile: 'grin', eyeSize: 1.1, smileY: 74 },
  bounce: { smile: 'open', eyeSize: 1.15 },
  glimmer: { smile: 'half', eyeSize: 0.95 },
  tusk: { smile: 'wide', eyeSize: 1.05 },
  mallow: { smile: 'wide', eyeSize: 0.9 },
  rumble: { smile: 'grin', eyeSize: 1.05, fang: true },
  // The grin sits low so its ends clear the big eyes.
  jack: { smile: 'grin', eyeSize: 1.0, smileY: 72 },
  wisp: { smile: 'open', eyeSize: 1.25 },
  rattle: { smile: 'grin', eyeSize: 1.15, skullGlow: palette.heroRattle },
  pops: { smile: 'grin', eyeSize: 1.0, popsicle: true },
};

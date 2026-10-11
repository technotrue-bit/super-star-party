import * as THREE from 'three';
import { palette } from '../config/palette';

export interface FaceSpec {
  smile: 'grin' | 'open' | 'half' | 'wide';
  eyeSize: number;
  /** A little white fang poking down from the smile (Rumble). */
  fang?: boolean;
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

function drawSmile(ctx: CanvasRenderingContext2D, smile: FaceSpec['smile']): void {
  if (smile === 'open') {
    // Filled half-ellipse: open mouth with darker fill, spanning x 52-76.
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.ellipse(128, SMILE_Y, 24, 14, 0, 0, Math.PI);
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
  ctx.arc(centerX, SMILE_Y, radius, 0, Math.PI);
  ctx.stroke();
}

function drawFang(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = palette.white;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(140, SMILE_Y + 17);
  ctx.lineTo(152, SMILE_Y + 13);
  ctx.lineTo(147, SMILE_Y + 27);
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

  const eyeR = EYE_RADIUS * spec.eyeSize;
  const pupilR = PUPIL_RADIUS * spec.eyeSize;
  const lpx = LEFT_EYE_X + PUPIL_OFFSET_X * spec.eyeSize;
  const rpx = RIGHT_EYE_X - PUPIL_OFFSET_X * spec.eyeSize;
  const py = EYE_Y + PUPIL_OFFSET_Y * spec.eyeSize;

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
      drawSmile(ctx, spec.smile);
      break;
    case 'happy':
      // ^ ^ eyes and a big open grin with a tongue.
      eyeArc(ctx, LEFT_EYE_X, EYE_Y, eyeR * 0.8, true);
      eyeArc(ctx, RIGHT_EYE_X, EYE_Y, eyeR * 0.8, true);
      ctx.fillStyle = palette.ink;
      ctx.beginPath();
      ctx.ellipse(128, SMILE_Y + 2, 30, 22, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.candy;
      ctx.beginPath();
      ctx.ellipse(128, SMILE_Y + 15, 14, 7, 0, 0, Math.PI * 2);
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
      ctx.arc(128, SMILE_Y + 30, 18, Math.PI * 1.15, Math.PI * 1.85);
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
      ctx.ellipse(128, SMILE_Y + 10, 11, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      eyeWhite(ctx, LEFT_EYE_X, EYE_Y, eyeR, eyeR);
      eyeWhite(ctx, RIGHT_EYE_X, EYE_Y, eyeR, eyeR);
      pupil(ctx, lpx, py, pupilR);
      pupil(ctx, rpx, py, pupilR);
      drawSmile(ctx, spec.smile);
      break;
  }
  if (spec.fang && (expr === 'normal' || expr === 'blink')) drawFang(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const faceSpecs: Record<string, FaceSpec> = {
  pip: { smile: 'grin', eyeSize: 1 },
  bounce: { smile: 'open', eyeSize: 1.15 },
  glimmer: { smile: 'half', eyeSize: 0.95 },
  tusk: { smile: 'wide', eyeSize: 1.05 },
  mallow: { smile: 'wide', eyeSize: 0.9 },
  rumble: { smile: 'grin', eyeSize: 1.05, fang: true },
  jack: { smile: 'wide', eyeSize: 1.1 },
  wisp: { smile: 'open', eyeSize: 1.25 },
};

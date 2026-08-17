import * as THREE from 'three';
import { palette } from '../config/palette';

export interface FaceSpec {
  smile: 'grin' | 'open' | 'half' | 'wide';
  eyeSize: number;
}

const FACE_WIDTH = 128;
const FACE_HEIGHT = 64;

const EYE_Y = 30;
const EYE_RADIUS = 14;
const PUPIL_RADIUS = 5;
const PUPIL_OFFSET_X = 3; // inward, toward the face center
const PUPIL_OFFSET_Y = 3; // downward

const LEFT_EYE_X = 38;
const RIGHT_EYE_X = 90;

const CHEEK_Y = 44;
const CHEEK_RADIUS = 6;
const CHEEK_COLOR = 'rgba(255, 120, 160, 0.55)';

const SMILE_Y = 42; // arc center y
const SMILE_STROKE = 5;

function drawSmile(ctx: CanvasRenderingContext2D, smile: FaceSpec['smile']): void {
  if (smile === 'open') {
    // Filled half-ellipse: open mouth with darker fill, spanning x 52-76.
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    ctx.ellipse(64, SMILE_Y, 12, 8, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    return;
  }

  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = SMILE_STROKE;
  ctx.lineCap = 'round';

  let centerX = 64;
  let radius = 12; // grin: centered arc, x 52-76
  if (smile === 'half') {
    centerX = 68; // smaller arc on the right side, x 60-76
    radius = 8;
  } else if (smile === 'wide') {
    radius = 16; // big arc, x 48-80
  }

  ctx.beginPath();
  ctx.arc(centerX, SMILE_Y, radius, 0, Math.PI);
  ctx.stroke();
}

export function makeFaceTexture(spec: FaceSpec): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_WIDTH;
  canvas.height = FACE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }

  const eyeR = EYE_RADIUS * spec.eyeSize;
  const pupilR = PUPIL_RADIUS * spec.eyeSize;

  // Two big white eyes.
  ctx.fillStyle = palette.white;
  ctx.beginPath();
  ctx.arc(LEFT_EYE_X, EYE_Y, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(RIGHT_EYE_X, EYE_Y, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Dark ink pupils, slightly inner-bottom.
  ctx.fillStyle = palette.ink;
  const leftPupilX = LEFT_EYE_X + PUPIL_OFFSET_X * spec.eyeSize;
  const rightPupilX = RIGHT_EYE_X - PUPIL_OFFSET_X * spec.eyeSize;
  const pupilY = EYE_Y + PUPIL_OFFSET_Y * spec.eyeSize;
  ctx.beginPath();
  ctx.arc(leftPupilX, pupilY, pupilR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightPupilX, pupilY, pupilR, 0, Math.PI * 2);
  ctx.fill();

  // Rosy cheeks, soft pink circles under each eye.
  ctx.fillStyle = CHEEK_COLOR;
  ctx.beginPath();
  ctx.arc(LEFT_EYE_X, CHEEK_Y, CHEEK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(RIGHT_EYE_X, CHEEK_Y, CHEEK_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Smile arc in ink.
  drawSmile(ctx, spec.smile);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const faceSpecs: Record<string, FaceSpec> = {
  pip: { smile: 'grin', eyeSize: 1 },
  bounce: { smile: 'open', eyeSize: 1.15 },
  glimmer: { smile: 'half', eyeSize: 0.95 },
  tusk: { smile: 'wide', eyeSize: 1.05 },
};

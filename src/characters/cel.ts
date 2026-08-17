import * as THREE from 'three';

const CEL_WIDTH = 64;
const CEL_HEIGHT = 1;

// Band boundaries along x (pixels), hard edges between bands.
const LIGHT_END = 21;
const MID_END = 42;

const BAND_LIGHT = '#ffffff';
const BAND_MID = '#b8b8c8';
const BAND_SHADOW = '#6e6e88';

export function makeCelGradient(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CEL_WIDTH;
  canvas.height = CEL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }

  ctx.fillStyle = BAND_LIGHT;
  ctx.fillRect(0, 0, LIGHT_END, CEL_HEIGHT);
  ctx.fillStyle = BAND_MID;
  ctx.fillRect(LIGHT_END, 0, MID_END - LIGHT_END, CEL_HEIGHT);
  ctx.fillStyle = BAND_SHADOW;
  ctx.fillRect(MID_END, 0, CEL_WIDTH - MID_END, CEL_HEIGHT);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const celGradient: THREE.Texture = makeCelGradient();

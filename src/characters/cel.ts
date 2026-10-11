import * as THREE from 'three';

const CEL_WIDTH = 64;
const CEL_HEIGHT = 1;

// Band boundaries along x (pixels), hard edges between bands. The lit band is
// the widest so characters read bright, with a crisp shadow terminator.
const SHADOW_END = 22;
const MID_END = 36;

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

  // three.js samples a toon gradientMap at u = dot(N, L) * 0.5 + 0.5, so the
  // ramp must run dark (u = 0, facing away from the light) to light (u = 1).
  // It used to run light-to-dark, which lit every toon surface inside out.
  ctx.fillStyle = BAND_SHADOW;
  ctx.fillRect(0, 0, SHADOW_END, CEL_HEIGHT);
  ctx.fillStyle = BAND_MID;
  ctx.fillRect(SHADOW_END, 0, MID_END - SHADOW_END, CEL_HEIGHT);
  ctx.fillStyle = BAND_LIGHT;
  ctx.fillRect(MID_END, 0, CEL_WIDTH - MID_END, CEL_HEIGHT);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // Lighting data, not a color: sample the band values as-is.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Toon ramp for MeshToonMaterial.gradientMap (never a color map). */
export const celGradient: THREE.Texture = makeCelGradient();

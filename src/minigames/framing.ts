/**
 * SUPER STAR PARTY — portrait-safe minigame camera framing.
 *
 * A minigame says what must be on screen (a world box: play area plus the
 * characters and their pads) and the direction it wants to look from. The
 * helper keeps that direction (so stick mapping stays camera-relative the same
 * way) and only picks the distance and a sideways/vertical look shift so the
 * box fills the free part of the screen: below the HUD chips, above the touch
 * pads. A tall portrait phone gets a farther camera, a wide desktop a closer one.
 *
 * frameMinigame() remembers the spec; the minigame screen calls reframe() on a
 * viewport change and clearFraming() on exit. Presentation only: no rng, and
 * nothing here is read by a simulation step.
 */
import * as THREE from "three";
import { palette } from "../config/palette";
import { viewportSize } from "../ui/viewport";

export interface FrameInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FrameSpec {
  /** World box that must be fully on screen. */
  box: THREE.Box3;
  /** Direction from the look target toward the camera (any length). */
  dir: THREE.Vector3;
  /** Vertical fov in degrees. Set explicitly so nothing is inherited. */
  fov: number;
  /** Screen pixels kept clear of the box (HUD, touch pads). */
  insets?: Partial<FrameInsets>;
}

export interface Framed {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/** HUD chips on top, touch pads at the bottom. Portrait phones need the most. */
export function defaultInsets(pads = true): FrameInsets {
  const { w, h } = viewportSize();
  const portrait = w / h < 1;
  return {
    top: portrait ? 76 : 64,
    bottom: pads ? (portrait ? Math.min(170, h * 0.2) : Math.min(120, h * 0.18)) : 16,
    left: 6,
    right: 6,
  };
}

const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const scratch = new THREE.Vector3();

function boxCorners(box: THREE.Box3): THREE.Vector3[] {
  const { min, max } = box;
  for (let i = 0; i < 8; i++) {
    corners[i].set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
  }
  return corners;
}

/** Projected NDC bounds of the box with the camera at look + dir*dist. */
function project(
  cam: THREE.PerspectiveCamera,
  pts: THREE.Vector3[],
  look: THREE.Vector3,
  dir: THREE.Vector3,
  dist: number,
): { minX: number; maxX: number; minY: number; maxY: number; behind: boolean } {
  cam.position.copy(look).addScaledVector(dir, dist);
  cam.lookAt(look);
  cam.updateMatrixWorld();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let behind = false;
  for (const p of pts) {
    scratch.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (-scratch.z < cam.near * 2) behind = true;
    scratch.applyMatrix4(cam.projectionMatrix);
    minX = Math.min(minX, scratch.x);
    maxX = Math.max(maxX, scratch.x);
    minY = Math.min(minY, scratch.y);
    maxY = Math.max(maxY, scratch.y);
  }
  return { minX, maxX, minY, maxY, behind };
}

/**
 * Fit `spec.box` into the free screen area. Sets the camera's fov, aspect,
 * position and orientation, and returns the pose so a game can keep it as its
 * shake/follow base.
 */
export function fitCamera(cam: THREE.PerspectiveCamera, spec: FrameSpec): Framed {
  const { w, h } = viewportSize();
  const ins = { ...defaultInsets(), ...spec.insets };
  cam.fov = spec.fov;
  cam.aspect = w / h;
  cam.updateProjectionMatrix();

  const dir = spec.dir.clone().normalize();
  const pts = boxCorners(spec.box);
  const look = spec.box.getCenter(new THREE.Vector3());
  // Free area in NDC (y up).
  const L = -1 + (2 * ins.left) / w;
  const R = 1 - (2 * ins.right) / w;
  const T = 1 - (2 * ins.top) / h;
  const B = -1 + (2 * ins.bottom) / h;
  const fits = (d: number): boolean => {
    const p = project(cam, pts, look, dir, d);
    return !p.behind && p.minX >= L && p.maxX <= R && p.minY >= B && p.maxY <= T;
  };

  let dist = 10;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (let pass = 0; pass < 4; pass++) {
    let lo = 0.5;
    let hi = 600;
    if (!fits(hi)) {
      dist = hi;
    } else {
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      dist = hi;
    }
    // Centre the projected box in the free area: slide the look target
    // across the view plane (same direction, so the angle never changes).
    const p = project(cam, pts, look, dir, dist);
    const ox = (p.minX + p.maxX) / 2 - (L + R) / 2;
    const oy = (p.minY + p.maxY) / 2 - (T + B) / 2;
    if (Math.abs(ox) < 1e-3 && Math.abs(oy) < 1e-3) break;
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    look.addScaledVector(right, ox * tanV * cam.aspect * dist).addScaledVector(up, oy * tanV * dist);
  }
  const pos = look.clone().addScaledVector(dir, dist);
  cam.position.copy(pos);
  cam.lookAt(look);
  cam.updateMatrixWorld();
  return { pos, look };
}

/* ------------------------------------------------------------------ */
/*  Active minigame framing (re-applied on resize / rotation)          */
/* ------------------------------------------------------------------ */

let active: {
  cam: THREE.PerspectiveCamera;
  spec: FrameSpec | (() => FrameSpec);
  apply?: (f: Framed) => void;
} | null = null;

/**
 * Frame the minigame camera now and again on every viewport change.
 * `spec` may be a function so a game can rebuild its box for the new aspect.
 * `apply` lets the game copy the pose into its own camBase/camLook.
 */
export function frameMinigame(
  cam: THREE.PerspectiveCamera,
  spec: FrameSpec | (() => FrameSpec),
  apply?: (f: Framed) => void,
): Framed {
  active = { cam, spec, apply };
  const f = fitCamera(cam, typeof spec === "function" ? spec() : spec);
  apply?.(f);
  return f;
}

export function reframe(): void {
  if (!active) return;
  const { cam, spec, apply } = active;
  const f = fitCamera(cam, typeof spec === "function" ? spec() : spec);
  apply?.(f);
}

export function clearFraming(): void {
  active = null;
}

/** Box helper: min/max corners as arrays. */
export function box(min: [number, number, number], max: [number, number, number]): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
}

/* ------------------------------------------------------------------ */
/*  Backdrop: a sky gradient instead of the flat ink clear colour      */
/* ------------------------------------------------------------------ */

/**
 * Two-tone lawn checker (one texel per tile), for a big floor disc: with
 * `repeat` tiles across, a far portrait camera sees a patterned lawn rather
 * than one flat green. Nearest filtering up close, mip blending far away.
 */
export function makeLawnTexture(repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const c = canvas.getContext("2d")!;
  c.fillStyle = palette.grassA;
  c.fillRect(0, 0, 2, 2);
  c.fillStyle = palette.grassB;
  c.fillRect(1, 0, 1, 1);
  c.fillRect(0, 1, 1, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Vertical gradient texture for scene.background (screen-space). */
export function makeSkyTexture(top: string = palette.bubble, horizon: string = palette.cream): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.7, horizon);
  g.addColorStop(1, horizon);
  c.fillStyle = g;
  c.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * SUPER STAR PARTY — the title screen's board orbit. The menu sits over a
 * high, slow turn around the whole first board, looking down at it.
 *
 * Presentation only: a pure pose from elapsed seconds and the viewport
 * aspect. It never touches match state or the rng.
 */
import * as THREE from "three";
import type { BoardDef } from "./boardData";

/** Seconds for one full turn around the board (slow, but the circling reads). */
export const TITLE_ORBIT_PERIOD = 100;
/**
 * Camera elevation above the ground plane (radians, ~66deg): a top-down
 * overview of the whole island that still keeps enough angle for the tents
 * and trees to read as 3D while it circles.
 */
export const TITLE_ORBIT_ELEV = 1.15;
/** Landmarks reach ~5u past the space loop; keep them in frame. */
const SCENERY_PAD = 5.2;

export interface OrbitPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Camera pose `t` seconds into the orbit around `def`, for a camera with
 * vertical field of view `fovDeg` and the given aspect (w / h). The distance
 * fits the board's radius to the narrower half-angle, so a portrait phone
 * pulls back until the island still spans the screen width.
 */
export function titleOrbitPose(
  def: BoardDef,
  t: number,
  aspect: number,
  fovDeg: number,
  out: OrbitPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
): OrbitPose {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of def.spaces) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.y);
    maxZ = Math.max(maxZ, s.y);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // The orbit sees every side, so fit the circle around the board.
  const R = Math.hypot(maxX - minX, maxZ - minZ) / 2 + SCENERY_PAD;

  const halfV = THREE.MathUtils.degToRad(fovDeg) / 2;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(0.1, aspect));
  // Portrait is width-bound; a little crop at the edges is fine (the menu
  // covers the middle), so don't pull back all the way.
  const half = Math.min(halfV, halfH);
  const dist = (R / Math.sin(half)) * (aspect < 1 ? 0.92 : 0.95);

  const yaw = (t / TITLE_ORBIT_PERIOD) * Math.PI * 2;
  const flat = dist * Math.cos(TITLE_ORBIT_ELEV);
  out.pos.set(cx + Math.sin(yaw) * flat, dist * Math.sin(TITLE_ORBIT_ELEV), cz + Math.cos(yaw) * flat);
  out.look.set(cx, 0, cz);
  return out;
}

/**
 * Near plane for the orbit camera: a quarter of the way to the board centre.
 * Everything on the island is at least the board radius closer than the
 * centre, which is far less than that, so nothing is clipped, and the depth
 * buffer keeps enough precision to separate the lanes from the space disks.
 */
export function titleOrbitNear(pose: OrbitPose): number {
  return Math.max(0.1, pose.pos.distanceTo(pose.look) * 0.25);
}

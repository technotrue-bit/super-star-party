/**
 * SUPER STAR PARTY — three-mesh-bvh for mesh raycasts.
 *
 * Mesh.prototype.raycast is patched with acceleratedRaycast. A geometry
 * with no boundsTree uses Three's original raycast, so today's picks stay
 * on that path. A bounds tree is built once, in indirect mode (the index
 * buffer is not reordered, so material groups keep drawing), and only for
 * rigid static geometry at or above STATIC_BVH_MIN_TRIANGLES.
 *
 * Measured with tools/probe-bvh.mjs (indirect trees, hit results retained):
 * - One ray that hits: the tree is faster at every size tried, from a
 *   12-triangle box (~5.3 µs → ~2.8 µs) up to a 6016-triangle sphere
 *   (~240 µs → ~3.1 µs). Closest hit matched.
 * - The picks the game actually does — 16 card boxes, 25 tile boxes, most
 *   of them misses — got slower (~2.8 µs → ~4.9 µs, ~2.3 µs → ~4.8 µs).
 *   Closest object matched. Those boxes stay under the cutoff.
 * - A ray that misses is already a bounds test (~0.1–1.4 µs). A tree makes
 *   that miss slower. Plane aims (bumper balls, coin grab) are not mesh
 *   raycasts; shapecast is not used.
 *
 * Skinned meshes and morph targets are skipped. Their vertices move, and a
 * static tree would answer for the bind pose.
 */
import { BufferGeometry, Mesh, Object3D, SkinnedMesh } from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

/**
 * Smallest triangle count where a static tree is worth its bytes.
 * 816 (the densest procedural mesh today, a character body) measured
 * slower on a miss and is not a pick target. 1024 is the first step
 * past that, where a hit against one mesh is already many times cheaper
 * with a tree (~10× at 816, ~78× at 6016) and a glTF prop would notice.
 */
export const STATIC_BVH_MIN_TRIANGLES = 1024;

let installed = false;

/** Patch Mesh.raycast once. Safe to call more than once. */
export function installAcceleratedRaycast(): void {
  if (installed) return;
  installed = true;
  BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  Mesh.prototype.raycast = acceleratedRaycast;
}

/** Triangles in the indexed draw range, or the position buffer when unindexed. */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const pos = geometry.getAttribute("position");
  return pos ? Math.floor(pos.count / 3) : 0;
}

/**
 * Build one indirect bounds tree if this rigid static geometry is dense
 * enough. Returns true only when this call created the tree. A second
 * call, or a mesh under the cutoff, returns false and allocates nothing.
 */
export function attachStaticBoundsTree(geometry: BufferGeometry): boolean {
  installAcceleratedRaycast();
  if (geometry.boundsTree) return false;
  if (triangleCount(geometry) < STATIC_BVH_MIN_TRIANGLES) return false;
  geometry.computeBoundsTree({ indirect: true, verbose: false });
  return true;
}

/** Drop the tree so the geometry can be disposed without keeping the BVH alive. */
export function releaseStaticBoundsTree(geometry: BufferGeometry): void {
  if (!geometry.boundsTree) return;
  installAcceleratedRaycast();
  geometry.disposeBoundsTree();
}

/**
 * Build trees for rigid static meshes under root. Shared geometries are
 * built once. SkinnedMesh and morph targets are left alone.
 * Returns how many geometries received a new tree.
 */
export function attachStaticBoundsIn(root: Object3D): number {
  const seen = new Set<BufferGeometry>();
  let built = 0;
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || obj instanceof SkinnedMesh) return;
    if (obj.morphTargetInfluences && obj.morphTargetInfluences.length > 0) return;
    const geo = obj.geometry;
    if (seen.has(geo)) return;
    seen.add(geo);
    if (attachStaticBoundsTree(geo)) built += 1;
  });
  return built;
}

/** Release every bounds tree on meshes under root. Shared geometries once. */
export function releaseStaticBoundsIn(root: Object3D): void {
  const seen = new Set<BufferGeometry>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const geo = obj.geometry;
    if (seen.has(geo)) return;
    seen.add(geo);
    releaseStaticBoundsTree(geo);
  });
}

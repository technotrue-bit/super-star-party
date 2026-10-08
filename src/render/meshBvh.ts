/**
 * SUPER STAR PARTY — three-mesh-bvh for mesh raycasts.
 *
 * The library is not in the boot bundle. Mesh.raycast stays Three's own
 * function until the first rigid static mesh at or above
 * STATIC_BVH_MIN_TRIANGLES is registered. That registration dynamic-imports
 * ./meshBvhLazy, which patches Mesh.raycast and builds one indirect bounds
 * tree (the index buffer is not reordered, so material groups keep drawing).
 * A geometry with no boundsTree still uses Three's original raycast.
 *
 * Measured with tools/probe-bvh.mjs (indirect trees, hit results retained):
 * - One ray that hits: the tree is faster at every size tried, from a
 *   12-triangle box (~5.3 µs → ~2.8 µs) up to a 6016-triangle sphere
 *   (~240 µs → ~3.1 µs). Closest hit matched.
 * - The picks the game actually does — 16 card boxes, 25 tile boxes, most
 *   of them misses — got slower (~2.8 µs → ~4.9 µs, ~2.3 µs → ~4.8 µs).
 *   Closest object matched. Those boxes stay under the cutoff, so the
 *   lazy chunk is never fetched during a match today.
 * - A ray that misses is already a bounds test (~0.1–1.4 µs). A tree makes
 *   that miss slower. Plane aims (bumper balls, coin grab) are not mesh
 *   raycasts; shapecast is not used.
 *
 * Skinned meshes and morph targets are skipped. Their vertices move, and a
 * static tree would answer for the bind pose.
 */
import { BufferGeometry, Mesh, Object3D } from "three";

/**
 * Smallest triangle count where a static tree is worth its bytes.
 * 816 (the densest procedural mesh today, a character body) measured
 * slower on a miss and is not a pick target. 1024 is the first step
 * past that, where a hit against one mesh is already many times cheaper
 * with a tree (~10× at 816, ~78× at 6016) and a glTF prop would notice.
 */
export const STATIC_BVH_MIN_TRIANGLES = 1024;

/** SkinnedMesh sets this flag. Checking it avoids importing the class. */
function isSkinned(obj: Object3D): boolean {
  return (obj as { isSkinnedMesh?: boolean }).isSkinnedMesh === true;
}

type BvhApi = typeof import("./meshBvhLazy");

let loading: Promise<BvhApi> | null = null;
let warnedLoadFailure = false;
const inflight = new WeakMap<BufferGeometry, Promise<boolean>>();
const generation = new WeakMap<BufferGeometry, number>();

function warnLoadFailure(err: unknown): void {
  if (warnedLoadFailure) return;
  warnedLoadFailure = true;
  console.warn("[SSP] three-mesh-bvh failed to load; dense meshes keep Three's raycast.", err);
}

function loadBvh(): Promise<BvhApi> {
  if (!loading) {
    loading = import("./meshBvhLazy")
      .then((mod) => {
        mod.activate();
        return mod;
      })
      .catch((err: unknown) => {
        loading = null;
        throw err;
      });
  }
  return loading;
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
 * enough. Resolves true only when this call created the tree. Under the
 * cutoff, resolves false and does not load three-mesh-bvh.
 */
export function attachStaticBoundsTree(geometry: BufferGeometry): Promise<boolean> {
  if (geometry.boundsTree) return Promise.resolve(false);
  if (triangleCount(geometry) < STATIC_BVH_MIN_TRIANGLES) return Promise.resolve(false);
  const existing = inflight.get(geometry);
  if (existing) return existing.then(() => false);
  const token = generation.get(geometry) ?? 0;
  let job!: Promise<boolean>;
  job = loadBvh()
    .then((api) => {
      if ((generation.get(geometry) ?? 0) !== token) return false;
      if (geometry.boundsTree) return false;
      if (triangleCount(geometry) < STATIC_BVH_MIN_TRIANGLES) return false;
      api.buildIndirectTree(geometry);
      return true;
    })
    .catch((err: unknown) => {
      warnLoadFailure(err);
      return false;
    })
    .finally(() => {
      if (inflight.get(geometry) === job) inflight.delete(geometry);
    });
  inflight.set(geometry, job);
  return job;
}

/** Drop the tree so the geometry can be disposed without keeping the BVH alive. */
export function releaseStaticBoundsTree(geometry: BufferGeometry): void {
  generation.set(geometry, (generation.get(geometry) ?? 0) + 1);
  inflight.delete(geometry);
  if (!geometry.boundsTree) return;
  geometry.disposeBoundsTree();
}

/**
 * Build trees for rigid static meshes under root. Shared geometries are
 * built once. SkinnedMesh and morph targets are left alone.
 * Resolves with how many geometries received a new tree.
 */
export async function attachStaticBoundsIn(root: Object3D): Promise<number> {
  const geos: BufferGeometry[] = [];
  const seen = new Set<BufferGeometry>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || isSkinned(obj)) return;
    if (obj.morphTargetInfluences && obj.morphTargetInfluences.length > 0) return;
    const geo = obj.geometry;
    if (seen.has(geo)) return;
    seen.add(geo);
    geos.push(geo);
  });
  let built = 0;
  for (const geo of geos) {
    if (await attachStaticBoundsTree(geo)) built += 1;
  }
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

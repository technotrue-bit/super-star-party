/**
 * Loaded only after a rigid static mesh clears STATIC_BVH_MIN_TRIANGLES.
 * The mesh entry point, not the package barrel: shaders, workers, and
 * line/point/batched helpers stay out of the graph. Vite serves this
 * package's `three` import from ./bvhThreeFacade.
 */
import { BufferGeometry, Mesh } from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh/src/utils/ExtensionUtilities.js";

/** Patch Mesh.raycast. Geometries without a tree keep Three's original test. */
export function activate(): void {
  BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  Mesh.prototype.raycast = acceleratedRaycast;
}

/** Indirect tree: the index buffer stays put, so material groups still draw. */
export function buildIndirectTree(geometry: BufferGeometry): void {
  geometry.computeBoundsTree({ indirect: true, verbose: false });
}

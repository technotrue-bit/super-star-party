/**
 * Bounds-tree fields used by the lazy mesh helper. Declared here so the
 * game does not import the three-mesh-bvh barrel (that import pulls the
 * whole library into the module graph).
 */
export interface StaticBoundsTree {
  raycastObject3D(object: unknown, raycaster: unknown, intersects: unknown[]): void;
}

declare module "three" {
  interface BufferGeometry {
    boundsTree?: StaticBoundsTree;
    computeBoundsTree(options?: { indirect?: boolean; verbose?: boolean }): StaticBoundsTree;
    disposeBoundsTree(): void;
  }
}

declare module "three-mesh-bvh/src/utils/ExtensionUtilities.js" {
  import type { BufferGeometry, Intersection, Raycaster } from "three";
  import type { StaticBoundsTree } from "./bvhGeometry";

  export function acceleratedRaycast(
    raycaster: Raycaster,
    intersects: Array<Intersection>,
  ): void;

  export function computeBoundsTree(options?: {
    indirect?: boolean;
    verbose?: boolean;
  }): StaticBoundsTree;

  export function disposeBoundsTree(): void;
}

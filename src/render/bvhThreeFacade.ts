/**
 * Stand-in for `three` when three-mesh-bvh imports it.
 *
 * Mesh and the math types are the game's own Three classes, so a patched
 * Mesh.raycast is the same prototype the game calls. Line, Points, and
 * BatchedMesh are captured at library init and never used for a Mesh, so
 * they are empty classes instead of the real ones (those real classes are
 * what was inflating the boot bundle). Line3 is not otherwise in the game,
 * so a small local segment keeps that code in the lazy chunk.
 */
import {
  BackSide,
  Box3,
  BufferAttribute,
  DoubleSide,
  FrontSide,
  Matrix4,
  Mesh,
  Plane,
  Ray,
  REVISION,
  Sphere,
  Triangle,
  Vector2,
  Vector3,
} from "three";

export {
  BackSide,
  Box3,
  BufferAttribute,
  DoubleSide,
  FrontSide,
  Matrix4,
  Mesh,
  Plane,
  Ray,
  REVISION,
  Sphere,
  Triangle,
  Vector2,
  Vector3,
};

/** Prototype is read once at init. Mesh raycasts never call it. */
class UnusedRaycastTarget {}

export const Points = UnusedRaycastTarget;
export const Line = UnusedRaycastTarget;
export const LineLoop = UnusedRaycastTarget;
export const LineSegments = UnusedRaycastTarget;
export const BatchedMesh = UnusedRaycastTarget;

const _startP = new Vector3();
const _startEnd = new Vector3();

/** Segment the bounds-tree math actually uses (set, at, closest point, center). */
export class Line3 {
  start: Vector3;
  end: Vector3;

  constructor(start = new Vector3(), end = new Vector3()) {
    this.start = start;
    this.end = end;
  }

  set(start: Vector3, end: Vector3): this {
    this.start.copy(start);
    this.end.copy(end);
    return this;
  }

  delta(target: Vector3): Vector3 {
    return target.subVectors(this.end, this.start);
  }

  at(t: number, target: Vector3): Vector3 {
    return this.delta(target).multiplyScalar(t).add(this.start);
  }

  closestPointToPointParameter(point: Vector3, clampToLine: boolean): number {
    _startP.subVectors(point, this.start);
    _startEnd.subVectors(this.end, this.start);
    const startEnd2 = _startEnd.dot(_startEnd);
    let t = _startEnd.dot(_startP) / startEnd2;
    if (clampToLine) t = Math.min(Math.max(t, 0), 1);
    return t;
  }

  closestPointToPoint(point: Vector3, clampToLine: boolean, target: Vector3): Vector3 {
    const t = this.closestPointToPointParameter(point, clampToLine);
    return this.delta(target).multiplyScalar(t).add(this.start);
  }

  getCenter(target: Vector3): Vector3 {
    return target.addVectors(this.start, this.end).multiplyScalar(0.5);
  }
}

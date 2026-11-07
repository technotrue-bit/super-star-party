/**
 * SUPER STAR PARTY — Cruise Ship building kit: outline maths, merged
 * vertex-coloured parts, walls and caps over outlines, and canvas textures.
 * Shared by the ship (cruiseShip.ts), its split levels (levels.ts) and its
 * glass rooms (rooms.ts). Presentation only.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RoundRect } from "../boards/cruiseData";

export type P2 = { x: number; z: number };

// ---- outlines ---------------------------------------------------------------------------

/** Closed rounded rectangle, counter-clockwise in (x, z), about `step` apart. */
export function roundRectPts(r: RoundRect, step = 0.35): P2[] {
  const out: P2[] = [];
  const cx = [r.x + r.hx - r.r, r.x - r.hx + r.r, r.x - r.hx + r.r, r.x + r.hx - r.r];
  const cz = [r.z + r.hz - r.r, r.z + r.hz - r.r, r.z - r.hz + r.r, r.z - r.hz + r.r];
  const start = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const arcN = Math.max(3, Math.ceil(((Math.PI / 2) * r.r) / step));
  for (let c = 0; c < 4; c++) {
    for (let k = 0; k <= arcN; k++) {
      const a = start[c] + (k / arcN) * (Math.PI / 2);
      out.push({ x: cx[c] + Math.cos(a) * r.r, z: cz[c] + Math.sin(a) * r.r });
    }
    // straight edge to the next corner
    const nx = (c + 1) % 4;
    const ax = cx[c] + Math.cos(start[c] + Math.PI / 2) * r.r;
    const az = cz[c] + Math.sin(start[c] + Math.PI / 2) * r.r;
    const bx = cx[nx] + Math.cos(start[nx]) * r.r;
    const bz = cz[nx] + Math.sin(start[nx]) * r.r;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(len / step);
    for (let k = 1; k < n; k++) out.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
  }
  return out;
}

export function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Outward unit normal of segment i -> i+1 (counter-clockwise outlines). */
export function segNormal(pts: P2[], i: number, ccw: boolean): P2 {
  const p = pts[i];
  const q = pts[(i + 1) % pts.length];
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  return ccw ? { x: dz / l, z: -dx / l } : { x: -dz / l, z: dx / l };
}

/** Each point pushed `d` along its averaged outward normal. */
export function offsetPts(pts: P2[], d: number): P2[] {
  const ccw = signedArea(pts) > 0;
  return pts.map((p, i) => {
    const a = segNormal(pts, (i - 1 + pts.length) % pts.length, ccw);
    const b = segNormal(pts, i, ccw);
    const nx = a.x + b.x;
    const nz = a.z + b.z;
    const l = Math.hypot(nx, nz) || 1;
    return { x: p.x + (nx / l) * d, z: p.z + (nz / l) * d };
  });
}

// ---- merged geometry --------------------------------------------------------------------

/** Collects painted parts for one merged vertex-coloured mesh. */
export class Parts {
  readonly list: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: string | THREE.Color, m?: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.deleteAttribute("uv");
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.list.push(g);
  }

  /** A box from its centre and size, optionally turned about y. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, yaw = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    this.add(new THREE.BoxGeometry(w, h, d), color, m);
  }

  /** A cylinder between y0 and y1 at (x, z). */
  post(r0: number, r1: number, x: number, y0: number, y1: number, z: number, color: string, seg = 8): void {
    this.add(new THREE.CylinderGeometry(r1, r0, y1 - y0, seg), color, new THREE.Matrix4().makeTranslation(x, (y0 + y1) / 2, z));
  }

  /** A thin bar from a to b. */
  bar(a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): void {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.add(g, color, m);
  }

  build(mat: THREE.Material, name: string, shadows = true): THREE.Mesh {
    const merged = mergeGeometries(this.list, false);
    for (const p of this.list) p.dispose();
    this.list.length = 0;
    if (!merged) throw new Error(`[SSP] cruise merge failed: ${name}`);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * Vertical wall along a closed outline from y0 up to y1, painted in
 * horizontal bands. `skip(p)` leaves a segment out (doorways, stairways).
 */
export function wall(parts: Parts, pts: P2[], bands: Array<{ y0: number; y1: number; color: string }>, skip?: (mid: P2) => boolean, inward = false): void {
  const ccw = signedArea(pts) > 0;
  for (const band of bands) {
    const pos: number[] = [];
    const nrm: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if (skip?.({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 })) continue;
      let n = segNormal(pts, i, ccw);
      if (inward) n = { x: -n.x, z: -n.z };
      const a0 = [p.x, band.y0, p.z];
      const a1 = [q.x, band.y0, q.z];
      const b0 = [p.x, band.y1, p.z];
      const b1 = [q.x, band.y1, q.z];
      const tri = inward ? [a0, a1, b0, a1, b1, b0] : [a0, b0, a1, a1, b0, b1];
      for (const v of tri) {
        pos.push(v[0], v[1], v[2]);
        nrm.push(n.x, 0, n.z);
      }
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    parts.add(g, band.color);
  }
}

/** Flat cap over a closed outline (with holes) at height y, facing up. */
export function cap(pts: P2[], y: number, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** World-space UVs (x, z) / tile on a flat geometry. */
export function worldUv(g: THREE.BufferGeometry, tile: number, rot = false): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / tile;
    const z = pos.getZ(i) / tile;
    uv[i * 2] = rot ? z : x;
    uv[i * 2 + 1] = rot ? x : -z;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---- textures ---------------------------------------------------------------------------

export function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, nearest = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else {
    t.anisotropy = 4;
  }
  t.needsUpdate = true;
  return t;
}

export function starShape(r: number, inner = 0.42): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return s;
}

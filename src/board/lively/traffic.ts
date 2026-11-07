/**
 * SUPER STAR PARTY — street traffic (lively board, Downtown slice 3).
 *
 * Boxy toon sedans, taxis, vans and a bus loop on fixed routes the board
 * hands in (Downtown: the streets running off the map past the Ring Road's
 * corners; they never cross a space). One InstancedMesh per vehicle kind,
 * instance colour for the paint; at most 4 draw calls, about 2.5k triangles.
 * Procedural geometry, no shadows, no textures.
 *
 * Each vehicle steers by its axles: the front and rear axle points ride the
 * route a little apart, so long vehicles swing wide through a turn. Speed
 * eases off in the turns. Spacing, paint and speed jitter come from a
 * private fxMulberry32 stream. Driven only by update(dt); never writes
 * `match`, never emits on the bus. update() allocates nothing.
 */
import * as THREE from "three";
import { palette } from "../../config/palette";
import { fxMulberry32 } from "./fxRng";
import { RouteWalker, box, mergeParts, painted, tintedToonMaterial, triangleCount, type StreetRoute } from "./streetKit";

export type VehicleKind = "sedan" | "taxi" | "van" | "bus";

export interface TrafficHost {
  /** Board-local parent for the vehicle meshes. */
  root: THREE.Object3D;
  /** Closed driving loops (board-local), already in their lanes. */
  routes: ReadonlyArray<StreetRoute>;
  /** Vehicles: which kind on which route. Spread evenly per route. */
  vehicles: ReadonlyArray<{ kind: VehicleKind; route: number }>;
  /** Toon gradient for the shared look. */
  gradientMap: THREE.Texture | null;
  /** Cruising speed, world units per second. Default 2.4. */
  speed?: number;
}

export interface Traffic {
  update(dt: number): void;
  dispose(): void;
  /** Probe view: cost and how many vehicles are moving. */
  debug(): { drawCalls: number; triangles: number; vehicles: number; perKind: Record<string, number> };
}

const KINDS: readonly VehicleKind[] = ["sedan", "taxi", "van", "bus"];
const GLASS = palette.glass;
const TYRE = palette.ink;
const PAINT: Record<VehicleKind, readonly string[]> = {
  sedan: [palette.candy, palette.bubble, palette.mint, palette.berry, palette.cream, palette.lava],
  taxi: [palette.sun],
  van: [palette.cream, palette.mint, palette.citySky],
  bus: [palette.lava, palette.spaceBlue],
};

/** Four (or six) tyres: 8-sided cylinders along z. */
function wheels(xs: readonly number[], halfW: number, r: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  for (const x of xs) {
    for (const z of [-halfW, halfW]) {
      m.makeTranslation(x, r, z).multiply(rot);
      out.push(painted(new THREE.CylinderGeometry(r, r, 0.07, 8), TYRE, m));
    }
  }
  return out;
}

/** Head and tail lamps at the two ends. */
function lights(half: number, y: number, z: number): THREE.BufferGeometry[] {
  return [
    box(0.03, 0.05, 0.09, half, y, z, palette.lampHot),
    box(0.03, 0.05, 0.09, half, y, -z, palette.lampHot),
    box(0.03, 0.05, 0.09, -half, y, z, palette.candyDeep),
    box(0.03, 0.05, 0.09, -half, y, -z, palette.candyDeep),
  ];
}

/** Vehicle geometry, nose toward +x, wheels on y = 0. White parts take the paint. */
function vehicleGeometry(kind: VehicleKind): { geo: THREE.BufferGeometry; length: number } {
  const W = palette.white;
  if (kind === "bus") {
    const L = 1.6;
    return {
      length: L,
      geo: mergeParts([
        box(L, 0.6, 0.6, 0, 0.4, 0, W),
        box(L - 0.3, 0.2, 0.62, -0.05, 0.52, 0, GLASS), // window band
        box(0.03, 0.28, 0.5, L / 2, 0.48, 0, GLASS), // windscreen
        box(0.03, 0.07, 0.36, L / 2 + 0.005, 0.66, 0, palette.lampHot), // destination sign
        box(L - 0.1, 0.04, 0.5, 0, 0.72, 0, palette.creamShadow), // roof
        ...wheels([0.5, -0.38, -0.56], 0.27, 0.1),
        ...lights(L / 2 + 0.005, 0.2, 0.2),
      ]),
    };
  }
  if (kind === "van") {
    const L = 1.15;
    return {
      length: L,
      geo: mergeParts([
        box(L, 0.42, 0.52, 0, 0.3, 0, W),
        box(0.03, 0.17, 0.44, L / 2, 0.4, 0, GLASS), // windscreen
        box(0.32, 0.13, 0.54, 0.32, 0.41, 0, GLASS), // cab side windows
        box(0.3, 0.05, 0.54, -0.2, 0.25, 0, palette.creamShadow), // side stripe
        ...wheels([0.36, -0.36], 0.24, 0.09),
        ...lights(L / 2 + 0.005, 0.18, 0.17),
      ]),
    };
  }
  const L = 1.0;
  const parts = [
    box(L, 0.2, 0.48, 0, 0.17, 0, W), // body
    box(0.52, 0.17, 0.42, -0.05, 0.355, 0, GLASS), // cabin glass
    box(0.46, 0.04, 0.44, -0.06, 0.455, 0, W), // roof
    ...wheels([0.31, -0.31], 0.22, 0.085),
    ...lights(L / 2 + 0.005, 0.19, 0.15),
  ];
  if (kind === "taxi") {
    parts.push(box(0.14, 0.07, 0.28, -0.06, 0.51, 0, palette.cream)); // roof sign
    parts.push(box(0.5, 0.04, 0.49, 0.02, 0.2, 0, palette.ink)); // checker band
  }
  return { length: L, geo: mergeParts(parts) };
}

export function createTraffic(host: TrafficHost): Traffic {
  const draw = fxMulberry32(0x7a4f1c);
  const walkers = host.routes.map((r) => new RouteWalker(r));
  const speed = host.speed ?? 2.4;

  // ---- one instanced mesh per kind in use -----------------------------------------
  const meshes = new Map<VehicleKind, { mesh: THREE.InstancedMesh; length: number; used: number }>();
  const count: Record<VehicleKind, number> = { sedan: 0, taxi: 0, van: 0, bus: 0 };
  for (const v of host.vehicles) if (walkers[v.route]) count[v.kind]++;
  for (const kind of KINDS) {
    if (!count[kind]) continue;
    const { geo, length } = vehicleGeometry(kind);
    const mesh = new THREE.InstancedMesh(geo, tintedToonMaterial(host.gradientMap, "traffic"), count[kind]);
    mesh.name = `lively:traffic-${kind}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Routes reach far off the map: no culling (it would be one sphere for the lot).
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    meshes.set(kind, { mesh, length, used: 0 });
    host.root.add(mesh);
  }

  // ---- vehicles: route, distance, slot in their kind's mesh -----------------------
  const perRoute = walkers.map(() => 0);
  for (const v of host.vehicles) if (walkers[v.route]) perRoute[v.route]++;
  const seen = walkers.map(() => 0);
  const list = host.vehicles.filter((v) => walkers[v.route]);
  const n = list.length;
  const route = new Int16Array(n);
  const dist = new Float32Array(n);
  const pace = new Float32Array(n);
  const axle = new Float32Array(n);
  const slot = new Int16Array(n);
  const mesh: THREE.InstancedMesh[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const v = list[i];
    const k = meshes.get(v.kind)!;
    const w = walkers[v.route];
    route[i] = v.route;
    // Evenly spaced round their loop, nudged a little.
    dist[i] = w.length * ((seen[v.route]++ + draw() * 0.3) / perRoute[v.route]);
    pace[i] = 0.9 + draw() * 0.2;
    // Long vehicles steer from nearer their middle, so a U-turn keeps them on the road.
    axle[i] = Math.min(k.length * 0.32, 0.36);
    slot[i] = k.used++;
    mesh.push(k.mesh);
    const paints = PAINT[v.kind];
    k.mesh.setColorAt(slot[i], color.set(paints[Math.floor(draw() * paints.length) % paints.length]));
  }

  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  const c = { x: 0, z: 0 };
  const dummy = new THREE.Object3D();
  let disposed = false;

  const place = (i: number): void => {
    const w = walkers[route[i]];
    w.at(dist[i] + axle[i], a);
    w.at(dist[i] - axle[i], b);
    dummy.position.set((a.x + b.x) / 2, host.routes[route[i]].y, (a.z + b.z) / 2);
    dummy.rotation.set(0, Math.atan2(-(a.z - b.z), a.x - b.x), 0);
    dummy.updateMatrix();
    mesh[i].setMatrixAt(slot[i], dummy.matrix);
  };

  const traffic: Traffic = {
    update(dt: number): void {
      if (disposed) return;
      const step = Math.min(dt, 0.1);
      for (let i = 0; i < n; i++) {
        const w = walkers[route[i]];
        // Ease off through the turns (looked at a little ahead).
        const bend = w.bend(dist[i] + 0.6, 0.6, a, b, c);
        dist[i] = w.wrap(dist[i] + speed * pace[i] * (1 - 0.55 * bend) * step);
        place(i);
      }
      for (const k of meshes.values()) k.mesh.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const k of meshes.values()) {
        host.root.remove(k.mesh);
        k.mesh.geometry.dispose();
        (k.mesh.material as THREE.Material).dispose();
        k.mesh.dispose();
      }
      meshes.clear();
    },

    debug() {
      let triangles = 0;
      const perKind: Record<string, number> = {};
      for (const [kind, k] of meshes) {
        triangles += triangleCount(k.mesh.geometry) * k.mesh.count;
        perKind[kind] = triangleCount(k.mesh.geometry);
      }
      return { drawCalls: meshes.size, triangles, vehicles: n, perKind };
    },
  };

  for (let i = 0; i < n; i++) place(i);
  for (const k of meshes.values()) {
    k.mesh.instanceMatrix.needsUpdate = true;
    if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
  }
  return traffic;
}

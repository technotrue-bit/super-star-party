/**
 * SUPER STAR PARTY — sidewalk pedestrians (lively board, Downtown slice 3).
 *
 * About 16 low-poly walkers (56 triangles each) in ONE InstancedMesh. Each
 * loops a fixed sidewalk route the board hands in and stops at the kerb of
 * every crosswalk on it until that crossing's walk signal comes round. The
 * shirt (the white parts) takes the instance colour. No shadows.
 *
 * Spacing, pace, shirt colours and signal timing come from a private
 * fxMulberry32 stream. Driven only by update(dt); never writes `match`,
 * never emits on the bus. update() allocates nothing.
 */
import * as THREE from "three";
import { palette } from "../../config/palette";
import { fxMulberry32 } from "./fxRng";
import { RouteWalker, box, mergeParts, painted, tintedToonMaterial, triangleCount, type StreetRoute } from "./streetKit";

/** A sidewalk loop with its crosswalk kerbs (point indices into pts) and their signals. */
export interface WalkRoute extends StreetRoute {
  stops: ReadonlyArray<{ point: number; signal: number }>;
}

export interface PedestriansHost {
  root: THREE.Object3D;
  routes: ReadonlyArray<WalkRoute>;
  /** Walkers in all; spread round the routes in turn. */
  count: number;
  gradientMap: THREE.Texture | null;
}

export interface Pedestrians {
  update(dt: number): void;
  dispose(): void;
  /** Probe view: cost, and how many are waiting at a kerb right now. */
  debug(): { drawCalls: number; triangles: number; walkers: number; waiting: number };
}

const SHIRTS = [palette.candy, palette.bubble, palette.mint, palette.sun, palette.berry, palette.lava, palette.heroTusk, palette.cream];
/** Crossing signal: a walk window every PERIOD seconds. */
const PERIOD = 9;
const WALK = 3.6;

/** One walker, feet at the origin, facing +x. */
function walkerGeometry(): THREE.BufferGeometry {
  const head = new THREE.Matrix4().makeTranslation(0, 0.6, 0);
  const hair = new THREE.Matrix4().makeTranslation(-0.012, 0.67, 0);
  return mergeParts([
    box(0.11, 0.27, 0.17, 0, 0.135, 0, palette.inkSoft), // legs
    box(0.14, 0.25, 0.23, 0, 0.395, 0, palette.white), // shirt
    painted(new THREE.IcosahedronGeometry(0.088, 0), palette.creamShadow, head),
    painted(new THREE.ConeGeometry(0.092, 0.07, 6), palette.bark, hair),
  ]);
}

export function createPedestrians(host: PedestriansHost): Pedestrians {
  const draw = fxMulberry32(0x9ed5);
  const walkers = host.routes.map((r) => new RouteWalker(r));
  // Kerb distances per route, in order along the loop.
  const stopAt = host.routes.map((r, k) => r.stops.map((s) => walkers[k].distOf(s.point)));
  const stopSignal = host.routes.map((r) => r.stops.map((s) => s.signal));
  const order = stopAt.map((d) => d.map((_, i) => i).sort((x, y) => d[x] - d[y]));
  let signals = 0;
  for (const r of host.routes) for (const s of r.stops) signals = Math.max(signals, s.signal + 1);
  const signalPhase = new Float32Array(signals);
  for (let s = 0; s < signals; s++) signalPhase[s] = draw() * PERIOD;

  const n = host.routes.length ? Math.max(0, Math.floor(host.count)) : 0;
  const geo = walkerGeometry();
  const mat = tintedToonMaterial(host.gradientMap, "pedestrians");
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  mesh.count = n;
  mesh.name = "lively:pedestrians";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  host.root.add(mesh);

  // ---- per-walker state ------------------------------------------------------------
  const route = new Int16Array(n);
  const dist = new Float32Array(n);
  const pace = new Float32Array(n);
  const side = new Float32Array(n); // small sideways offset, so two never overlap
  const phase = new Float32Array(n);
  const next = new Int16Array(n); // index into order[route]
  const waiting = new Uint8Array(n);
  const perRoute = walkers.map((_, k) => Math.ceil((n - k) / Math.max(1, walkers.length)));
  const seen = walkers.map(() => 0);
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const r = i % walkers.length;
    const w = walkers[r];
    route[i] = r;
    dist[i] = w.length * ((seen[r]++ + 0.15 + draw() * 0.2) / perRoute[r]);
    pace[i] = 0.95 + draw() * 0.3;
    side[i] = (draw() - 0.5) * 0.16;
    phase[i] = draw() * Math.PI * 2;
    // First kerb ahead of the start.
    const o = order[r];
    let k = 0;
    while (k < o.length && stopAt[r][o[k]] < dist[i]) k++;
    next[i] = o.length ? k % o.length : 0;
    mesh.setColorAt(i, color.set(SHIRTS[Math.floor(draw() * SHIRTS.length) % SHIRTS.length]));
  }

  let t = 0;
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  const dummy = new THREE.Object3D();
  dummy.rotation.order = "YXZ";
  let disposed = false;
  const walkOn = (s: number): boolean => (t + signalPhase[s]) % PERIOD < WALK;

  const peds: Pedestrians = {
    update(dt: number): void {
      if (disposed) return;
      const step = Math.min(dt, 0.1);
      t += step;
      for (let i = 0; i < n; i++) {
        const r = route[i];
        const w = walkers[r];
        const o = order[r];
        const move = pace[i] * step;
        if (o.length) {
          const k = o[next[i]];
          const ahead = w.wrap(stopAt[r][k] - dist[i]);
          if (ahead <= move + 1e-4 || waiting[i]) {
            if (walkOn(stopSignal[r][k])) {
              waiting[i] = 0;
              next[i] = (next[i] + 1) % o.length;
              dist[i] = w.wrap(dist[i] + move);
            } else {
              waiting[i] = 1;
              dist[i] = stopAt[r][k];
            }
          } else {
            dist[i] = w.wrap(dist[i] + move);
          }
        } else {
          dist[i] = w.wrap(dist[i] + move);
        }
        // Face where the route goes next (turns the corner onto the crossing).
        w.at(dist[i], a);
        w.at(dist[i] + 0.3, b);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const ph = t * 7.5 * pace[i] + phase[i];
        const still = waiting[i] === 1;
        const bob = still ? 0.006 * Math.sin(t * 2 + phase[i]) : 0.028 * Math.abs(Math.sin(ph));
        dummy.position.set(a.x - (dz / len) * side[i], host.routes[r].y + bob, a.z + (dx / len) * side[i]);
        // A side-to-side waddle about the walking direction (local +x).
        dummy.rotation.set(still ? 0 : 0.07 * Math.sin(ph), Math.atan2(-dz, dx), 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      host.root.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },

    debug() {
      let w = 0;
      for (let i = 0; i < n; i++) w += waiting[i];
      return { drawCalls: 1, triangles: triangleCount(geo) * n, walkers: n, waiting: w };
    },
  };

  peds.update(0);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return peds;
}

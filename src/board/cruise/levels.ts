/**
 * SUPER STAR PARTY — the Cruise Ship's split levels, drawn from the terrain.
 *
 * The board's terrain layers (boards/cruiseData.ts) decide how high every
 * point of deck is; spaces, lanes and players all read those heights. This
 * module traces each level's outline straight from them (marching squares,
 * with every edge point refined by bisection), then builds the level's floor,
 * the risers where it steps to its neighbour (each riser drawn once, by the
 * side it faces), and the outlines the main deck must leave open over sunken
 * floors. So what you see is exactly where the disks and the players stand.
 *
 * Presentation only: pure geometry, no state, no rng.
 */
import * as THREE from "three";
import type { P2 } from "./shipKit";

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

type Height = (x: number, z: number) => number;

/** Heights closer than this are the same level. */
const EPS = 1e-4;

/**
 * Closed outlines of the region where `inside` holds, with the region on the
 * left of every loop: outer loops run counter-clockwise in (x, z), holes
 * clockwise. Nodes on the box border count as outside, so every loop closes.
 */
export function contours(inside: (x: number, z: number) => boolean, box: Box, cell = 0.1): P2[][] {
  const nx = Math.max(2, Math.ceil((box.x1 - box.x0) / cell));
  const nz = Math.max(2, Math.ceil((box.z1 - box.z0) / cell));
  const dx = (box.x1 - box.x0) / nx;
  const dz = (box.z1 - box.z0) / nz;
  const X = (i: number): number => box.x0 + i * dx;
  const Z = (j: number): number => box.z0 + j * dz;
  const at = (i: number, j: number): number => j * (nx + 1) + i;
  const v = new Uint8Array((nx + 1) * (nz + 1));
  for (let j = 1; j < nz; j++) for (let i = 1; i < nx; i++) v[at(i, j)] = inside(X(i), Z(j)) ? 1 : 0;

  const pts = new Map<string, P2>();
  // The boundary point on a grid edge, refined by bisection on the predicate. Both cells
  // that share the edge ask with the same end first, so they get the same point.
  const edge = (key: string, xa: number, za: number, xb: number, zb: number, aIn: boolean): string => {
    if (!pts.has(key)) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 16; k++) {
        const m = (lo + hi) / 2;
        if (inside(xa + (xb - xa) * m, za + (zb - za) * m) === aIn) lo = m;
        else hi = m;
      }
      const m = (lo + hi) / 2;
      pts.set(key, { x: xa + (xb - xa) * m, z: za + (zb - za) * m });
    }
    return key;
  };
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    let la = adj.get(a);
    if (!la) adj.set(a, (la = []));
    la.push(b);
    let lb = adj.get(b);
    if (!lb) adj.set(b, (lb = []));
    lb.push(a);
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      // Corners: a (i,j), b (i+1,j), c (i+1,j+1), d (i,j+1).
      const a = v[at(i, j)];
      const b = v[at(i + 1, j)];
      const c = v[at(i + 1, j + 1)];
      const d = v[at(i, j + 1)];
      const idx = a | (b << 1) | (c << 2) | (d << 3);
      if (idx === 0 || idx === 15) continue;
      const e0 = (): string => edge(`h${i},${j}`, X(i), Z(j), X(i + 1), Z(j), a === 1);
      const e1 = (): string => edge(`v${i + 1},${j}`, X(i + 1), Z(j), X(i + 1), Z(j + 1), b === 1);
      const e2 = (): string => edge(`h${i},${j + 1}`, X(i), Z(j + 1), X(i + 1), Z(j + 1), d === 1);
      const e3 = (): string => edge(`v${i},${j}`, X(i), Z(j), X(i), Z(j + 1), a === 1);
      const mid = (): boolean => inside(X(i) + dx / 2, Z(j) + dz / 2);
      switch (idx) {
        case 1:
        case 14:
          link(e3(), e0());
          break;
        case 2:
        case 13:
          link(e0(), e1());
          break;
        case 3:
        case 12:
          link(e3(), e1());
          break;
        case 4:
        case 11:
          link(e1(), e2());
          break;
        case 6:
        case 9:
          link(e0(), e2());
          break;
        case 7:
        case 8:
          link(e3(), e2());
          break;
        case 5: // a and c inside
          if (mid()) {
            link(e0(), e1());
            link(e2(), e3());
          } else {
            link(e3(), e0());
            link(e1(), e2());
          }
          break;
        case 10: // b and d inside
          if (mid()) {
            link(e3(), e0());
            link(e1(), e2());
          } else {
            link(e0(), e1());
            link(e2(), e3());
          }
          break;
      }
    }
  }

  const loops: P2[][] = [];
  const seen = new Set<string>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: P2[] = [];
    let prev = "";
    let cur: string | undefined = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pts.get(cur)!);
      const nb: string[] = adj.get(cur) ?? [];
      const nxt: string | undefined = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = nxt;
    }
    if (loop.length >= 3) loops.push(orient(loop, inside, Math.min(dx, dz) * 0.35));
  }
  return loops;
}

/** Turn `loop` so the region lies on its left (a vote over a few of its segments). */
function orient(loop: P2[], inside: (x: number, z: number) => boolean, s: number): P2[] {
  let votes = 0;
  const n = loop.length;
  const stride = Math.max(1, Math.floor(n / 11));
  for (let k = 0; k < n; k += stride) {
    const p = loop[k];
    const q = loop[(k + 1) % n];
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const l = Math.hypot(ex, ez) || 1;
    // Left of the direction (ex, ez) is (-ez, ex).
    votes += inside((p.x + q.x) / 2 - (ez / l) * s, (p.z + q.z) / 2 + (ex / l) * s) ? 1 : -1;
  }
  return votes >= 0 ? loop : loop.reverse();
}

/**
 * Drop points that sit within `tol` of the chord between their neighbours,
 * keeping every segment under `maxLen` (walls and glass want some subdivision).
 */
export function simplify(loop: P2[], tol = 0.006, maxLen = 1.2): P2[] {
  let pts = loop;
  for (let pass = 0; pass < 8 && pts.length > 8; pass++) {
    const out: P2[] = [];
    let dropped = false;
    for (let k = 0; k < pts.length; k++) {
      const a = out.length ? out[out.length - 1] : pts[pts.length - 1];
      const p = pts[k];
      const b = pts[(k + 1) % pts.length];
      const cx = b.x - a.x;
      const cz = b.z - a.z;
      const len = Math.hypot(cx, cz);
      const dist = len > 1e-9 ? Math.abs((p.x - a.x) * cz - (p.z - a.z) * cx) / len : 0;
      if (dist < tol && len < maxLen && k > 0) {
        dropped = true;
        continue;
      }
      out.push(p);
    }
    pts = out;
    if (!dropped) break;
  }
  return pts;
}

/** Outlines of the floor at height `h` inside `box`. */
export function levelLoops(height: Height, box: Box, h: number, cell = 0.1): P2[][] {
  return contours((x, z) => Math.abs(height(x, z) - h) < EPS, box, cell).map((l) => simplify(l));
}

/** Outlines of everything below the main deck inside `box` (holes for the deck). */
export function sunkenLoops(height: Height, box: Box, cell = 0.1): P2[][] {
  return contours((x, z) => height(x, z) < -EPS, box, cell).map((l) => simplify(l));
}

function area(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

function contains(pts: P2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (pts[i].z > z !== pts[j].z > z && x < ((pts[j].x - pts[i].x) * (z - pts[i].z)) / (pts[j].z - pts[i].z) + pts[i].x) inside = !inside;
  }
  return inside;
}

/** Flat, upward-facing floor over `loops` at height `y` (holes go into the loop around them). */
export function floorGeometry(loops: P2[][], y: number): THREE.BufferGeometry | null {
  const outers = loops.filter((l) => area(l) > 0);
  const holes = loops.filter((l) => area(l) <= 0);
  if (!outers.length) return null;
  const shapes = outers.map((o) => {
    const s = new THREE.Shape(o.map((p) => new THREE.Vector2(p.x, -p.z)));
    for (const h of holes) {
      if (contains(o, h[0].x, h[0].z)) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
    }
    return s;
  });
  const g = new THREE.ShapeGeometry(shapes);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** One riser: a vertical strip along a→b from y0 up to y1, facing (nx, nz). */
export interface Riser {
  a: P2;
  b: P2;
  y0: number;
  y1: number;
  nx: number;
  nz: number;
}

/**
 * The risers round the floor at height `h`: where a raised floor (h > 0)
 * drops to a lower neighbour, a wall from the neighbour up to h facing out;
 * where a sunken floor (h < 0) meets a higher neighbour, a wall from h up to
 * the neighbour facing in. Every step is drawn exactly once. Each loop
 * segment is split where its neighbour's height changes.
 */
export function risers(height: Height, loops: P2[][], h: number): Riser[] {
  const out: Riser[] = [];
  for (const loop of loops) {
    for (let k = 0; k < loop.length; k++) {
      const p = loop[k];
      const q = loop[(k + 1) % loop.length];
      const ex = q.x - p.x;
      const ez = q.z - p.z;
      const l = Math.hypot(ex, ez);
      if (l < 1e-6) continue;
      // The region is on the left; out is the right normal.
      const nx = ez / l;
      const nz = -ex / l;
      const n = Math.max(1, Math.ceil(l / 0.08));
      let runStart = 0;
      let runH = NaN;
      const flush = (from: number, to: number, hn: number): void => {
        if (!(Math.abs(hn - h) > EPS)) return;
        const a = { x: p.x + ex * from, z: p.z + ez * from };
        const b = { x: p.x + ex * to, z: p.z + ez * to };
        if (h > 0 && hn < h) out.push({ a, b, y0: hn, y1: h, nx, nz });
        else if (h < 0 && hn > h) out.push({ a, b, y0: h, y1: hn, nx: -nx, nz: -nz });
      };
      for (let s = 0; s < n; s++) {
        const u = (s + 0.5) / n;
        const hn = Math.round(height(p.x + ex * u + nx * 0.05, p.z + ez * u + nz * 0.05) * 1e4) / 1e4;
        if (s === 0) runH = hn;
        else if (Math.abs(hn - runH) > EPS) {
          flush(runStart, s / n, runH);
          runStart = s / n;
          runH = hn;
        }
      }
      flush(runStart, 1, runH);
    }
  }
  return out;
}

/**
 * Riser geometry: the body, and a thin trim band along the top edge (the
 * cartoon outline on a step's lip). Normals face each riser's way.
 */
export function riserGeometry(rs: Riser[], trim = 0.06): { body: THREE.BufferGeometry; lip: THREE.BufferGeometry } {
  const body: number[] = [];
  const bodyN: number[] = [];
  const lip: number[] = [];
  const lipN: number[] = [];
  const quad = (pos: number[], nrm: number[], r: Riser, y0: number, y1: number): void => {
    if (y1 - y0 < 1e-4) return;
    const a0 = [r.a.x, y0, r.a.z];
    const a1 = [r.b.x, y0, r.b.z];
    const b0 = [r.a.x, y1, r.a.z];
    const b1 = [r.b.x, y1, r.b.z];
    // (a0, a1, b0) faces the left of a→b; flip it when the riser faces right.
    const leftX = -(r.b.z - r.a.z);
    const leftZ = r.b.x - r.a.x;
    const tri = leftX * r.nx + leftZ * r.nz > 0 ? [a0, a1, b0, a1, b1, b0] : [a0, b0, a1, a1, b0, b1];
    for (const v of tri) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(r.nx, 0, r.nz);
    }
  };
  for (const r of rs) {
    const t = Math.min(trim, (r.y1 - r.y0) * 0.3);
    quad(body, bodyN, r, r.y0, r.y1 - t);
    quad(lip, lipN, r, r.y1 - t, r.y1);
  }
  const mk = (pos: number[], nrm: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    return g;
  };
  return { body: mk(body, bodyN), lip: mk(lip, lipN) };
}

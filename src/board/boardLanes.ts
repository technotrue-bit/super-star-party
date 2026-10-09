/**
 * Board lanes: the sandy paths between spaces, drawn as ONE flat ground decal
 * (2 tris, 1 draw call) whose texture is baked once from a distance field of
 * every lane centreline.
 *
 * Why a decal and not strips: overlapping strips at junction roots and along
 * the shortcut double up their transparent feathers and seam where layers
 * meet. A distance field is a union by construction (min over all lanes), so
 * there is exactly one soft edge everywhere. Junction and shortcut roots join
 * the loops with a smooth-min, which turns the T into a round fillet instead
 * of a notched corner; the smooth-min is faded out away from the roots so the
 * shortcut never bridges to the loop it runs beside.
 *
 * Bake cost: centrelines are simplified (Douglas-Peucker, well under a texel),
 * then each segment stamps only its exact band and each vertex only its wedge,
 * row span by row span, so a texel is visited about once. The wide fillet
 * radius is only stamped inside discs around the roots. Hot loops live in
 * module-level functions over typed arrays so V8 optimizes them early.
 *
 * Pure geometry from the BoardDef: no rng of any kind (cosmetic, deterministic).
 * The baked pixels are memoized per board id, so re-entering the board only
 * wraps the cached bytes in a new DataTexture. That texture is freed with its
 * material (see the dispose listener below), so the board's dispose()
 * traversal covers it; the cached bytes are never mutated.
 */
import * as THREE from "three";
import { settings } from "../config/settings";
import { palette } from "../config/palette";
import type { BoardDef } from "./boardData";
import type { BoardTextures } from "./boardTextures";

type Pt = { x: number; z: number };
type Polyline = Pt[];

/** Baked decal: RGBA bytes (row j <-> z) plus the plane they cover. */
interface LaneBake {
  data: Uint8Array;
  W: number;
  H: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Texel grid plus a distance^2 layer and its touched span per row
 * (lo[j] > hi[j] means row j is untouched), so later passes skip empty texels.
 */
interface Layer {
  W: number;
  H: number;
  minX: number;
  minZ: number;
  ts: number;
  tz: number;
  d2: Float32Array;
  lo: Int32Array;
  hi: Int32Array;
}

const bakes = new Map<string, LaneBake>();

/** Max centreline deviation when simplifying, world units (a texel is ~0.028u). */
const SIMPLIFY_TOL = 0.006;
const FAR2 = 1e6;
/** Shading lookup entries across the soft band (distance from core to grass). */
const LUT_SIZE = 1024;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const sample = (fn: (t: number) => THREE.Vector3, t0: number, t1: number, n: number): Polyline => {
  const out: Polyline = [];
  for (let i = 0; i <= n; i++) {
    const p = fn(t0 + ((t1 - t0) * i) / n);
    out.push({ x: p.x, z: p.z });
  }
  return out;
};

/** Squared distance from (x, z) to segment p-q. */
const segDist2 = (x: number, z: number, p: Pt, q: Pt): number => {
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const ll = dx * dx + dz * dz || 1;
  const u = Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / ll));
  const ex = x - p.x - u * dx;
  const ez = z - p.z - u * dz;
  return ex * ex + ez * ez;
};

/** Douglas-Peucker: drop points whose removal moves the line less than `tol`. */
const simplify = (line: Polyline, tol: number): Polyline => {
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wd = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(line[i].x, line[i].z, line[a], line[b]);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return line.filter((_, i) => keep[i]);
};

const rgb = (hex: string): [number, number, number] => {
  const v = new THREE.Color(hex).getHex(THREE.SRGBColorSpace);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const newLayer = (W: number, H: number, minX: number, minZ: number, ts: number, tz: number): Layer => ({
  W,
  H,
  minX,
  minZ,
  ts,
  tz,
  d2: new Float32Array(W * H).fill(FAR2),
  lo: new Int32Array(H).fill(W),
  hi: new Int32Array(H).fill(-1),
});

/**
 * Hard-min squared distances into `L` over one convex region around (ox, oz),
 * row span by row span. The region is the intersection of the half-planes
 * pl[a] <= pl[c]*X + pl[kz]*e <= pl[b] (X = x - ox, e = z - oz, 4 numbers per
 * plane), the disc of radius^2 R2 around o when R2 > 0, and the clip disc
 * (cx, cz, cr) when cr > 0. Distance is |ax*X + az*e| for a segment band, or
 * |(X, e)| for a vertex.
 */
function stampRegion(
  L: Layer,
  ox: number,
  oz: number,
  zlo: number,
  zhi: number,
  pl: number[],
  R2: number,
  cx: number,
  cz: number,
  cr: number,
  band: boolean,
  ax: number,
  az: number
): void {
  const { W, H, minX, minZ, ts, tz, d2: dst, lo: rlo, hi: rhi } = L;
  if (cr > 0) {
    zlo = Math.max(zlo, cz - cr);
    zhi = Math.min(zhi, cz + cr);
  }
  const j0 = Math.max(0, Math.ceil((zlo - minZ) / tz - 0.5));
  const j1 = Math.min(H - 1, Math.floor((zhi - minZ) / tz - 0.5));
  const np = pl.length;
  for (let j = j0; j <= j1; j++) {
    const z = minZ + (j + 0.5) * tz;
    const e = z - oz;
    let lo = -Infinity;
    let hi = Infinity;
    if (R2 > 0) {
      if (e * e > R2) continue;
      const w = Math.sqrt(R2 - e * e);
      lo = -w;
      hi = w;
    }
    for (let p = 0; p < np; p += 4) {
      const c = pl[p];
      const k = pl[p + 1] * e;
      if (Math.abs(c) < 1e-12) {
        if (k < pl[p + 2] || k > pl[p + 3]) hi = -Infinity;
        continue;
      }
      const t1 = (pl[p + 2] - k) / c;
      const t2 = (pl[p + 3] - k) / c;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    }
    if (cr > 0) {
      const ec = z - cz;
      const r2 = cr * cr - ec * ec;
      if (r2 < 0) continue;
      const w = Math.sqrt(r2);
      lo = Math.max(lo, cx - ox - w);
      hi = Math.min(hi, cx - ox + w);
    }
    if (!(lo <= hi)) continue;
    const i0 = Math.max(0, Math.ceil((ox + lo - minX) / ts - 0.5));
    const i1 = Math.min(W - 1, Math.floor((ox + hi - minX) / ts - 0.5));
    if (i0 > i1) continue;
    if (i0 < rlo[j]) rlo[j] = i0;
    if (i1 > rhi[j]) rhi[j] = i1;
    const row = j * W;
    const X0 = minX + 0.5 * ts - ox;
    if (band) {
      const ke = az * e;
      for (let i = i0; i <= i1; i++) {
        const d = ax * (X0 + i * ts) + ke;
        const v = d * d;
        if (v < dst[row + i]) dst[row + i] = v;
      }
    } else {
      const e2 = e * e;
      for (let i = i0; i <= i1; i++) {
        const X = X0 + i * ts;
        const v = X * X + e2;
        if (v < dst[row + i]) dst[row + i] = v;
      }
    }
  }
}

/**
 * Stamp a polyline out to radius R (only inside the clip disc when cr > 0).
 * Each texel's nearest centreline point is inside a segment (its band) or at
 * a vertex (the wedge on the convex side of the turn, or a half disc at an
 * open end), so bands + wedges give the exact distance while visiting each
 * texel about once instead of once per overlapping capsule. A line whose last
 * point repeats its first is closed.
 */
function stampLine(L: Layer, line: Polyline, R: number, cx = 0, cz = 0, cr = 0): void {
  const pts = line.filter((p, i) => i === 0 || Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z) > 1e-9);
  const end = pts[pts.length - 1];
  const closed = pts.length > 2 && Math.hypot(end.x - pts[0].x, end.z - pts[0].z) < 1e-6;
  if (closed) pts.pop();
  const n = pts.length;
  const nSeg = closed ? n : n - 1;
  const reach2 = (cr + R) ** 2;
  const near = (p: Pt, q: Pt): boolean => cr <= 0 || segDist2(cx, cz, p, q) < reach2;
  const ux = new Float64Array(nSeg);
  const uz = new Float64Array(nSeg);
  for (let s = 0; s < nSeg; s++) {
    const p = pts[s];
    const q = pts[(s + 1) % n];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    ux[s] = (q.x - p.x) / len;
    uz[s] = (q.z - p.z) / len;
    if (!near(p, q)) continue;
    const planes = [ux[s], uz[s], 0, len, -uz[s], ux[s], -R, R];
    // The band's corners are p, q +- R * (-uz, ux), so its rows span R * |ux| past p and q.
    const rz = R * Math.abs(ux[s]);
    stampRegion(L, p.x, p.z, Math.min(p.z, q.z) - rz, Math.max(p.z, q.z) + rz, planes, 0, cx, cz, cr, true, -uz[s], ux[s]);
  }
  for (let v = 0; v < n; v++) {
    const p = pts[v];
    if (!near(p, p)) continue;
    const hasPrev = closed || v > 0;
    const hasNext = closed || v < n - 1;
    const planes: number[] = [];
    let zlo = -R;
    let zhi = R;
    if (hasPrev) {
      const s = (v - 1 + nSeg) % nSeg;
      planes.push(ux[s], uz[s], 0, Infinity); // past the end of the previous segment
    }
    if (hasNext) planes.push(ux[v], uz[v], -Infinity, 0); // before the next one starts
    if (hasPrev && hasNext) {
      // The wedge is the sector of directions d with d.u1 >= 0 and d.u2 <= 0,
      // as wide as the turn: only scan the rows it covers.
      const s = (v - 1 + nSeg) % nSeg;
      const [ax, az, bx, bz] = [ux[s], uz[s], ux[v], uz[v]];
      if (Math.abs(ax * bz - az * bx) < 1e-9 && ax * bx + az * bz > 0) continue; // straight: bands meet exactly
      // Boundary rays: perpendicular to u1 (on the d.u2 <= 0 side) and to u2 (on the d.u1 >= 0 side).
      const sa = -az * bx + ax * bz <= 0 ? 1 : -1;
      const sb = -bz * ax + bx * az >= 0 ? 1 : -1;
      const za = sa * ax * R;
      const zb = sb * bx * R;
      zlo = az <= 0 && bz >= 0 ? -R : Math.min(0, za, zb);
      zhi = az >= 0 && bz <= 0 ? R : Math.max(0, za, zb);
    }
    stampRegion(L, p.x, p.z, p.z + zlo, p.z + zhi, planes, R * R, cx, cz, cr, false, 0, 0);
  }
}

/**
 * Fold an open lane (`T`) into the union (`F`): smooth-min with radius k
 * fading from k0 at r0 to 0 at r1 around the lane's roots, plain min
 * elsewhere. Resets `T` (values and spans) for the next lane.
 */
function foldOpen(F: Layer, T: Layer, roots: Pt[], k0: number, r0: number, r1: number): void {
  const { W, H, minX, minZ, ts, tz } = F;
  const fd = F.d2;
  const td = T.d2;
  const r1sq = r1 * r1;
  const rx = roots.map((r) => r.x);
  const rz = roots.map((r) => r.z);
  const nr = roots.length;
  for (let j = 0; j < H; j++) {
    const i0 = T.lo[j];
    const i1 = T.hi[j];
    if (i0 > i1) continue;
    T.lo[j] = W;
    T.hi[j] = -1;
    if (i0 < F.lo[j]) F.lo[j] = i0;
    if (i1 > F.hi[j]) F.hi[j] = i1;
    const z = minZ + (j + 0.5) * tz;
    const row = j * W;
    for (let i = i0; i <= i1; i++) {
      const idx = row + i;
      const b2 = td[idx];
      if (b2 >= FAR2) continue;
      td[idx] = FAR2;
      const a2 = fd[idx];
      const x = minX + (i + 0.5) * ts;
      let rd2 = Infinity;
      for (let r = 0; r < nr; r++) {
        const ddx = x - rx[r];
        const ddz = z - rz[r];
        const q = ddx * ddx + ddz * ddz;
        if (q < rd2) rd2 = q;
      }
      if (rd2 >= r1sq) {
        if (b2 < a2) fd[idx] = b2;
        continue;
      }
      const a = Math.sqrt(a2);
      const b = Math.sqrt(b2);
      const k = k0 * (1 - smooth(r0, r1, Math.sqrt(rd2)));
      let res = a < b ? a : b;
      if (k > 0) {
        const g = Math.max(k - Math.abs(a - b), 0) / k;
        res -= (g * g * k) / 4;
      }
      // Below 0 is the centreline either way (sand, opaque); keep it squarable.
      if (res < 0) res = 0;
      fd[idx] = res * res;
    }
  }
}

/**
 * Shade the full-res RGBA decal (W x H) from the half-res distance^2 layer F:
 * F's texel k sits midway between full texels 2k and 2k+1, so every full
 * texel is a fixed 0.75/0.25 bilinear blend of distance (not distance^2,
 * which is not linear across an edge). Outside the feather and inside the
 * core the pixel is constant, so the buffer is pre-filled, cells are
 * classified on distance^2 and only cells across the soft band blend,
 * through a lookup table on distance. RGB is the trim colour wherever the
 * sand fades out, so linear filtering and mipmaps never pull a dark fringe
 * in from transparent texels.
 */
function shade(F: Layer, W: number, H: number, h: number, trim: number, edge: number): Uint8Array {
  const W2 = F.W;
  const H2 = F.H;
  const fd = F.d2;
  const sand = rgb(palette.path);
  // Full pathEdge reads muddy once it is half-blended over the grass; stop partway.
  const trimC = rgb(palette.pathEdge).map((v, i) => sand[i] + (v - sand[i]) * 0.6);
  const data = new Uint8Array(W * H * 4);
  const px = new Uint32Array(data.buffer);
  // Pixels are written as one Uint32 each, in the platform's byte order.
  const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const pack = (r: number, g: number, b: number, a: number): number =>
    le ? (r | (g << 8) | (b << 16) | (a << 24)) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  px.fill(pack(Math.round(trimC[0]), Math.round(trimC[1]), Math.round(trimC[2]), 0));
  const IN = pack(sand[0], sand[1], sand[2], 255);
  const c0 = h - 0.1;
  const c1 = h + trim;
  const a0 = h + trim * 0.4;
  const N = LUT_SIZE;
  const lut = new Uint32Array(N + 1);
  for (let n = 0; n <= N; n++) {
    const d = c0 + ((edge - c0) * n) / N;
    const c = smooth(c0, c1, d);
    const al = 1 - smooth(a0, edge, d);
    lut[n] = pack(
      Math.round(sand[0] + (trimC[0] - sand[0]) * c),
      Math.round(sand[1] + (trimC[1] - sand[1]) * c),
      Math.round(sand[2] + (trimC[2] - sand[2]) * c),
      Math.round(al * 255)
    );
  }
  const inv = N / (edge - c0);
  const edge2 = edge * edge;
  const c02 = c0 * c0;
  // Walk half-res cells (k..k+1) x (m..m+1); each holds full texels
  // i = 2k+1, 2k+2 and j = 2m+1, 2m+2 at blend weights 3/4 and 1/4. The blend
  // never leaves the corners' range, so all-far cells are skipped and
  // all-core cells are filled flat; only cells across the soft band blend.
  const put = (j: number, i: number, d: number): void => {
    if (d < edge && j < H && i < W) px[j * W + i] = d <= c0 ? IN : lut[((d - c0) * inv + 0.5) | 0];
  };
  for (let m = 0; m + 1 < H2; m++) {
    const lo = Math.min(F.lo[m], F.lo[m + 1]);
    const hi = Math.min(W2 - 2, Math.max(F.hi[m], F.hi[m + 1]));
    const ra = m * W2;
    const rb = ra + W2;
    for (let k = Math.max(0, lo - 1); k <= hi; k++) {
      // Classify on distance^2; take roots only for cells that blend.
      let p00 = fd[ra + k];
      let p01 = fd[ra + k + 1];
      let p10 = fd[rb + k];
      let p11 = fd[rb + k + 1];
      if (p00 >= edge2 && p01 >= edge2 && p10 >= edge2 && p11 >= edge2) continue;
      const j = 2 * m + 1;
      const i = 2 * k + 1;
      if (p00 <= c02 && p01 <= c02 && p10 <= c02 && p11 <= c02) {
        if (j + 1 < H && i + 1 < W) {
          px[j * W + i] = IN;
          px[j * W + i + 1] = IN;
          px[(j + 1) * W + i] = IN;
          px[(j + 1) * W + i + 1] = IN;
        } else {
          put(j, i, 0);
          put(j, i + 1, 0);
          put(j + 1, i, 0);
          put(j + 1, i + 1, 0);
        }
        continue;
      }
      p00 = Math.sqrt(p00);
      p01 = Math.sqrt(p01);
      p10 = Math.sqrt(p10);
      p11 = Math.sqrt(p11);
      const a0r = 0.75 * p00 + 0.25 * p01; // row m, near k
      const a1r = 0.25 * p00 + 0.75 * p01; // row m, near k+1
      const b0r = 0.75 * p10 + 0.25 * p11;
      const b1r = 0.25 * p10 + 0.75 * p11;
      put(j, i, 0.75 * a0r + 0.25 * b0r);
      put(j, i + 1, 0.75 * a1r + 0.25 * b1r);
      put(j + 1, i, 0.25 * a0r + 0.75 * b0r);
      put(j + 1, i + 1, 0.25 * a1r + 0.75 * b1r);
    }
  }
  return data;
}

function bakeLanes(def: BoardDef): LaneBake {
  const B = settings.board;
  const space = (i: number): THREE.Vector3 => {
    const s = def.spaces[((i % def.spaces.length) + def.spaces.length) % def.spaces.length];
    return new THREE.Vector3(s.x, 0, s.y);
  };
  const lenOf = (pts: THREE.Vector3[], closed: boolean): number => {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += pts[i].distanceTo(pts[i - 1]);
    return closed ? l + pts[0].distanceTo(pts[pts.length - 1]) : l;
  };
  // Dense samples, simplified below before stamping.
  const segs = (len: number): number => Math.max(2, Math.ceil(len / B.laneStep));

  // Closed loops: centripetal Catmull-Rom through the space centres. The
  // sample at t=1 repeats t=0, which is how stampLine spots a closed line.
  const loops: Polyline[] = def.loops.map((loop) => {
    const pts = loop.map(space);
    const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    return sample((t) => curve.getPoint(t), 0, 1, segs(lenOf(pts, true)));
  });

  // Open lanes join a loop at both ends; `roots` are where they get filleted.
  const open: { line: Polyline; roots: Pt[] }[] = [];
  for (const j of def.junctions ?? []) {
    const a = space(j.from);
    const b = space(j.to);
    open.push({ line: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], roots: [a, b] });
  }

  // Shortcut: open centripetal CR through [from, bend, to] with phantom end
  // points so it leaves/enters each disk along chord + 0.5 * loop tangent.
  // The bend (chord midpoint + 0.8 * inward perpendicular) keeps it clear of
  // the spaces it skips.
  if (def.shortcut) {
    const a = space(def.shortcut.from);
    const b = space(def.shortcut.to);
    const d = b.clone().sub(a);
    const perp = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const bend = a.clone().add(d.clone().multiplyScalar(0.5)).add(perp.multiplyScalar(0.8));
    const chord = d.clone().normalize();
    const blend = (idx: number): THREE.Vector3 => {
      const loop = def.loops.find((l) => l.includes(idx)) ?? def.loops[0];
      const k = loop.indexOf(idx);
      const lt = space(loop[(k + 1) % loop.length]).sub(space(loop[(k - 1 + loop.length) % loop.length])).normalize();
      if (lt.dot(chord) < 0) lt.negate();
      return chord.clone().add(lt.multiplyScalar(0.5)).normalize();
    };
    const lead = 1.6;
    const p0 = a.clone().sub(blend(def.shortcut.from).multiplyScalar(lead));
    const p4 = b.clone().add(blend(def.shortcut.to).multiplyScalar(lead));
    const curve = new THREE.CatmullRomCurve3([p0, a, bend, b, p4], false, "centripetal");
    // three maps t uniformly over point indices: a..b is t in [0.25, 0.75].
    const line = sample((t) => curve.getPoint(t), 0.25, 0.75, segs(lenOf([a, bend, b], false)));
    open.push({ line, roots: [a, b] });
  }

  // ---- texel grid ----------------------------------------------------------------
  const h = B.pathWidth / 2;
  const edge = h + B.laneTrim + B.laneFeather; // alpha reaches 0 here
  const reach = edge + B.laneFillet; // field is only needed this far out
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const line of [...loops, ...open.map((o) => o.line)]) {
    for (const p of line) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  minX -= reach;
  maxX += reach;
  minZ -= reach;
  maxZ += reach;
  const ppu = Math.min(B.laneTexelsPerUnit, B.laneTexMax / Math.max(maxX - minX, maxZ - minZ));
  const W = Math.ceil((maxX - minX) * ppu);
  const H = Math.ceil((maxZ - minZ) * ppu);
  const ts = (maxX - minX) / W; // texel size along x
  const tz = (maxZ - minZ) / H; // texel size along z
  // The distance field is computed at half resolution (its texel k centred
  // between full texels 2k and 2k+1) and blended up in shade(): distance is
  // near-linear over a texel pair, so this costs well under one 8-bit step.
  const W2 = (W >> 1) + 1;
  const H2 = (H >> 1) + 1;
  const field = newLayer(W2, H2, minX, minZ, 2 * ts, 2 * tz);
  const tmp = newLayer(W2, H2, minX, minZ, 2 * ts, 2 * tz);
  // Stamp a little past `edge` so texels blended at the very edge have real neighbours.
  const outer = edge + 4 * Math.max(ts, tz);

  // ---- distance field --------------------------------------------------------------
  // Smooth-min fillets need the field out to `reach`, but only within r1 of a
  // root; everywhere else nothing past `edge` is visible, so stamp just past it.
  const k0 = B.laneFillet;
  const r0 = settings.tileRadius + 0.8;
  const r1 = r0 + 1.4;
  const roots = open.flatMap((o) => o.roots);
  for (const loop of loops) {
    const line = simplify(loop, SIMPLIFY_TOL);
    stampLine(field, line, outer);
    for (const r of roots) stampLine(field, line, reach, r.x, r.z, r1);
  }
  for (const o of open) {
    const line = simplify(o.line, SIMPLIFY_TOL);
    stampLine(tmp, line, outer);
    for (const r of o.roots) stampLine(tmp, line, reach, r.x, r.z, r1);
    foldOpen(field, tmp, o.roots, k0, r0, r1);
  }

  const data = shade(field, W, H, h, B.laneTrim, edge);
  return { data, W, H, minX, maxX, minZ, maxZ };
}

/** Builds the lane decal mesh (one mesh, one draw call). */
export function buildBoardLanes(def: BoardDef, kit: BoardTextures): THREE.Object3D[] {
  const B = settings.board;
  let bake = bakes.get(def.id);
  if (!bake) {
    const t0 = performance.now();
    bake = bakeLanes(def);
    bakes.set(def.id, bake);
    // Dev-only probe hook: how long the (uncached) bake took.
    if (import.meta.env.DEV) (globalThis as { __laneBakeMs?: number }).__laneBakeMs = performance.now() - t0;
  }
  const { data, W, H, minX, maxX, minZ, maxZ } = bake;
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  // ---- decal quad: texel row j <-> v = (z - minZ) / depth --------------------------
  const geo = new THREE.BufferGeometry();
  const y = B.laneY;
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ], 3)
  );
  geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);

  const mat = new THREE.MeshToonMaterial({
    map: tex,
    gradientMap: kit.grad,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  // The board's dispose() frees materials but not their maps; the lane texture
  // is not part of the kit, so it goes with its material.
  mat.addEventListener("dispose", () => tex.dispose());

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "lanes:decal";
  // First among transparents: it is ground, everything else sits on top of it.
  mesh.renderOrder = -1;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.lane = true;
  return [mesh];
}

/**
 * SUPER STAR PARTY — shared pieces for the street life (traffic.ts,
 * pedestrians.ts): closed routes sampled by distance, flat-painted parts
 * merged into one geometry, and a toon material where only the pure-white
 * parts take the instance colour (car bodies, shirts), so glass, tyres and
 * faces keep theirs.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** A closed loop on the ground (board-local x/z pairs), at height y. */
export interface StreetRoute {
  /** x0, z0, x1, z1, ... The last point joins back to the first. */
  pts: ReadonlyArray<number>;
  y: number;
}

/** Distance sampler over a closed route. */
export class RouteWalker {
  readonly length: number;
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  /** cum[i] = distance from point 0 to point i; cum[n] = length. */
  private readonly cum: Float32Array;
  private readonly n: number;

  constructor(route: StreetRoute) {
    const n = Math.floor(route.pts.length / 2);
    this.n = n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.cum = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.x[i] = route.pts[i * 2];
      this.z[i] = route.pts[i * 2 + 1];
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.cum[i + 1] = this.cum[i] + Math.hypot(this.x[j] - this.x[i], this.z[j] - this.z[i]);
    }
    this.length = this.cum[n] || 1;
  }

  /** Wrap a distance into [0, length). */
  wrap(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Point at distance s along the loop (wrapped), into out.x / out.z. */
  at(s: number, out: { x: number; z: number }): void {
    const d = this.wrap(s);
    // Binary search for the segment holding d.
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const j = (lo + 1) % this.n;
    const seg = this.cum[lo + 1] - this.cum[lo] || 1;
    const u = (d - this.cum[lo]) / seg;
    out.x = this.x[lo] + (this.x[j] - this.x[lo]) * u;
    out.z = this.z[lo] + (this.z[j] - this.z[lo]) * u;
  }

  /** Distance along the loop of point i. */
  distOf(i: number): number {
    return this.cum[Math.max(0, Math.min(this.n, i))];
  }

  /** Turn sharpness near distance s: 0 on a straight, toward 1 in a tight turn. */
  bend(s: number, span: number, a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): number {
    this.at(s - span, a);
    this.at(s, b);
    this.at(s + span, c);
    const h1 = Math.atan2(b.z - a.z, b.x - a.x);
    const h2 = Math.atan2(c.z - b.z, c.x - b.x);
    let d = Math.abs(h2 - h1);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return Math.min(1, d / (Math.PI / 2));
  }
}

/** Box in world-ish units centred at (x, y, z), painted one colour, non-indexed. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  return painted(new THREE.BoxGeometry(w, h, d), color, new THREE.Matrix4().makeTranslation(x, y, z));
}

/** A three primitive moved by `m` and painted one colour (position + color only, non-indexed). */
export function painted(geo: THREE.BufferGeometry, color: string, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.getAttribute("position").count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return g;
}

/** Merge painted parts into one geometry (faceted: flat shading needs no normals). */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("[SSP] street kit: parts did not merge");
  merged.computeVertexNormals();
  return merged;
}

/** Triangles in a geometry. */
export function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  return Math.floor((index ? index.count : geo.getAttribute("position").count) / 3);
}

/**
 * Faceted toon material over vertex colours where only the pure-white
 * vertices take the instance colour.
 */
export function tintedToonMaterial(gradientMap: THREE.Texture | null, key: string): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap });
  // three's FLAT_SHADED path works for any lit material, though only some declare the flag in their types.
  Object.assign(mat, { flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <color_vertex>",
      [
        "vColor = vec3(1.0);",
        "#ifdef USE_COLOR",
        "  vColor *= color;",
        "#endif",
        "#ifdef USE_INSTANCING_COLOR",
        "  if (min(color.r, min(color.g, color.b)) > 0.99) vColor = instanceColor.rgb;",
        "#endif",
      ].join("\n")
    );
  };
  mat.customProgramCacheKey = () => `street-tint:${key}`;
  return mat;
}

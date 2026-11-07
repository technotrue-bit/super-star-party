/**
 * SUPER STAR PARTY — Downtown's city, built from the Downtown graph
 * (boards/downtownData.ts) and the packed Kenney pieces (cityModels.ts).
 *
 * Draws in ONE call: every static piece (ground, Kenney roads with their
 * sidewalks and crosswalks, storefronts, lamps, the Grand Bridge, the canal
 * walls and water, fork arrows, plaza props) is merged into one
 * vertex-coloured toon mesh; the water's glints are in its shader. The mesh
 * is never culled, so all of it counts at rest: keep it near 63k triangles
 * (the board itself is about 47k of the 120k budget). Nothing casts shadows
 * (the merged mesh would redraw whole in the shadow pass); the city receives
 * them like the placeholder asphalt did.
 *
 * Layout rules, in tile units (downtownData: north = +ty, world -z):
 * - The Ring Road (tx 0/8, ty 0/8) is Kenney road; its corners are 4-way
 *   crossroads whose streets run off the map, each with a crosswalk on the
 *   first tile out.
 * - The follow camera sits north of the player looking south (about 53
 *   degrees down), and the whole-board view looks north from the south. So
 *   nothing tall stands just north or just south of a path: the Canal Row
 *   frontage is set back behind a promenade, Main Street's behind the
 *   station plaza, and inside the loop only low shops, stalls and trees.
 *   East and west of the ring the storefronts stand right at the sidewalk.
 * - Fork arrows sit in the free corners between three spaces' rims.
 * All variety comes from a fixed fxRng stream: the same city every time,
 * and never the gameplay generator.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { settings } from "../../config/settings";
import { palette } from "../../config/palette";
import { DOWNTOWN_WATER } from "../boards/downtownData";
import { THEME_SCENERY_NAME, type BoardThemeHost, type BuiltBoardTheme } from "../boardTheme";
import { fxMulberry32 } from "../lively/fxRng";
import type { CityModels } from "./cityModels";

const S = settings.tileSpacing;
/** Tile units -> world (downtownData.downtownWorld without its rounding). */
const wx = (tx: number): number => (tx - 4) * S;
const wz = (ty: number): number => (4 - ty) * S;
/** Yaw turning a Kenney model's +z (building fronts) toward tile direction (dtx, dty). */
const facing = (dtx: number, dty: number): number => Math.atan2(dtx, -dty);
/** Yaw turning a Kenney model's -z (lamp arms) toward tile direction (dtx, dty). */
const reaching = (dtx: number, dty: number): number => Math.atan2(-dtx, dty);

/**
 * World heights. The lane decal is at settings.board.laneY (0.01) and must
 * stay on top of the road; the disks and their rims sit at 0 to 0.06.
 */
const Y_GROUND = -0.03; // pavement everywhere the roads are not
const Y_ROAD = -0.016; // Kenney road base: asphalt +0.01 above it, sidewalks +0.02
const Y_WALK = Y_ROAD + 0.02; // sidewalk top: lamps stand here
const Y_WATER = -0.3;
const Y_COPING = 0.02;
const Y_PAINT = 0.022; // fork arrows, over the lane decal

/** Ring corners (tile units). Every corner is a crossroad; its streets run off the map. */
const RING_MIN = 0;
const RING_MAX = 8;
const STUB = 9; // road tiles beyond each corner
/** Water (tile units): the data's canal line and basin; the city's own width. */
const W = DOWNTOWN_WATER;
const CANAL_HALF = 0.25;
const CANAL_END = 26;
const BASIN_R = 0.6;
const FOUNTAIN = { tx: 6.4, ty: 1.95, r: 1.15 }; // r in world units

const UP = new THREE.Vector3(0, 1, 0);

/** Strip a three primitive to position + index and paint it one colour. */
function paint(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (!geo.index) geo.setIndex(Array.from({ length: n }, (_, i) => i));
  return geo;
}

/**
 * Multiply a paint into a Kenney building's light neutral vertices (its white
 * and pale grey walls), leaving windows, roofs, doors and trim alone.
 */
function paintWalls(geo: THREE.BufferGeometry, tint: THREE.Color): void {
  const col = geo.getAttribute("color");
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i);
    const g = col.getY(i);
    const b = col.getZ(i);
    const lo = Math.min(r, g, b);
    if (lo < 0.4 || Math.max(r, g, b) - lo > 0.25) continue;
    col.setXYZ(i, r * tint.r, g * tint.g, b * tint.b);
  }
}

/** Free-form triangles in one colour, each wound to face `want`. */
class Tris {
  private pos: number[] = [];
  private readonly ab = new THREE.Vector3();
  private readonly ac = new THREE.Vector3();

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, want: THREE.Vector3): void {
    this.ab.subVectors(b, a);
    this.ac.subVectors(c, a);
    const flip = this.ab.cross(this.ac).dot(want) < 0;
    const [p, q] = flip ? [c, b] : [b, c];
    this.pos.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, want: THREE.Vector3): void {
    this.tri(a, b, c, want);
    this.tri(a, c, d, want);
  }

  geometry(color: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    return paint(g, color);
  }
}

/** Everything static, collected in world space, merged once at the end. */
class Parts {
  readonly geos: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly sizes = new Map<string, THREE.Vector3>();

  constructor(private readonly models: CityModels) {}

  /** Footprint/height of a model in Kenney units (x = width, z = depth). */
  size(name: string): THREE.Vector3 {
    let s = this.sizes.get(name);
    if (!s) {
      const g = this.models.get(name);
      if (g && !g.boundingBox) g.computeBoundingBox();
      s = g?.boundingBox ? g.boundingBox.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
      this.sizes.set(name, s);
    }
    return s;
  }

  /**
   * Kenney model on tile spot (tx, ty) at height y, turned `yaw`. `k` scales
   * the tile footprint (1 Kenney unit = 1 tile); `ky` is world units per
   * Kenney unit of height (roads stay flat with ky = 1). `walls` paints a
   * building's light walls.
   */
  model(name: string, tx: number, ty: number, yaw: number, y: number, k = 1, ky = S * k, walls: THREE.Color | null = null): void {
    const src = this.models.get(name);
    if (!src) return;
    const g = src.clone();
    if (walls) paintWalls(g, walls);
    this.q.setFromAxisAngle(UP, yaw);
    this.m.compose(this.at.set(wx(tx), y, wz(ty)), this.q, this.sc.set(S * k, ky, S * k));
    g.applyMatrix4(this.m);
    this.geos.push(g);
  }

  /** A three primitive (world units) painted one colour, placed at world (x, y, z). */
  shape(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, yaw = 0): void {
    if (yaw) geo.rotateY(yaw);
    geo.translate(x, y, z);
    this.geos.push(paint(geo, color));
  }

  add(geo: THREE.BufferGeometry): void {
    this.geos.push(geo);
  }

  merge(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    if (!merged) throw new Error("[SSP] Downtown city: pieces did not merge");
    // Shading uses face normals (flatShading); these smooth ones only feed the
    // shadow lookup's normal offset, which would be NaN without any.
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Canal + Harbor Basin outline (tile units): down the east bank, round the basin, up the west bank. */
function canalOutline(): Array<[number, number]> {
  const x0 = W.canal.x - CANAL_HALF;
  const x1 = W.canal.x + CANAL_HALF;
  const h = Math.sqrt(BASIN_R * BASIN_R - CANAL_HALF * CANAL_HALF);
  const a1 = Math.atan2(h, CANAL_HALF);
  // Banks break at Canal Row's edges so the bridge span can skip its coping.
  const pts: Array<[number, number]> = [[x1, CANAL_END], [x1, RING_MAX + 0.5], [x1, RING_MAX - 0.5]];
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const a = a1 - (k / steps) * (Math.PI + 2 * a1);
    pts.push([W.basin.x + Math.cos(a) * BASIN_R, W.basin.y + Math.sin(a) * BASIN_R]);
  }
  pts.push([x0, RING_MAX - 0.5], [x0, RING_MAX + 0.5], [x0, CANAL_END]);
  return pts;
}

/** Shape-space point for a tile spot: shape (X, Y) lies flat as world (X, -Y) after rotateX(-90deg). */
const shapePt = (tx: number, ty: number): THREE.Vector2 => new THREE.Vector2(wx(tx), -wz(ty));

function insidePolygon(pts: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ground with the canal cut out, the canal walls and their stone coping. */
function buildGroundAndCanal(parts: Parts, outline: Array<[number, number]>): void {
  const ground = new THREE.Shape([
    new THREE.Vector2(-75, -70),
    new THREE.Vector2(75, -70),
    new THREE.Vector2(75, 64),
    new THREE.Vector2(-75, 64),
  ]);
  ground.holes.push(new THREE.Path(outline.map(([tx, ty]) => shapePt(tx, ty))));
  const g = new THREE.ShapeGeometry(ground, 4);
  g.rotateX(-Math.PI / 2);
  parts.shape(g, palette.cityPavement, 0, Y_GROUND, 0);

  const walls = new Tris();
  const coping = new Tris();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const COPE = 0.2; // world units of coping beyond the water's edge
  for (let i = 0; i < outline.length - 1; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[i + 1];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    // Unit normal in tile units, flipped to point into the water.
    let nx = -(by - ay);
    let ny = bx - ax;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (!insidePolygon(outline, mx + nx * 0.01, my + ny * 0.01)) {
      nx = -nx;
      ny = -ny;
    }
    inward.set(nx, 0, -ny); // tile +y is world -z
    // Under the Grand Bridge the road deck is the top: walls stop below it, no coping.
    const underDeck = my > RING_MAX - 0.5 && my < RING_MAX + 0.5;
    const top = underDeck ? Y_ROAD - 0.004 : Y_COPING;
    a.set(wx(ax), top, wz(ay));
    b.set(wx(bx), top, wz(by));
    c.set(wx(bx), Y_WATER - 0.05, wz(by));
    d.set(wx(ax), Y_WATER - 0.05, wz(ay));
    walls.quad(a, b, c, d, inward);
    if (underDeck) continue;
    const ox = -nx * (COPE / S);
    const oy = -ny * (COPE / S);
    c.set(wx(bx + ox), Y_COPING, wz(by + oy));
    d.set(wx(ax + ox), Y_COPING, wz(ay + oy));
    coping.quad(a, b, c, d, UP);
  }
  parts.add(walls.geometry(palette.cityStone));
  parts.add(coping.geometry(palette.cityStone));
  // The canal and basin water, below the coping.
  const water = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([tx, ty]) => shapePt(tx, ty))), 4);
  water.rotateX(-Math.PI / 2);
  parts.shape(water, palette.cityCanal, 0, Y_WATER, 0);
}

/**
 * The city's one material: toon-lit vertex colours, faceted like the Kenney
 * originals. Water is the one surface painted exactly cityCanal; it gets soft
 * drifting glints (two crossing sine fields, brightened where they peak), so
 * the canal needs no mesh or draw call of its own.
 */
function cityMaterial(kit: BoardThemeHost["kit"], time: { value: number }): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: kit.grad });
  // three's FLAT_SHADED path works for any lit material, though only some declare the flag in their types.
  Object.assign(mat, { flatShading: true });
  const water = new THREE.Color(palette.cityCanal);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCityTime = time;
    shader.uniforms.uCityWater = { value: water };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCityWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCityWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uCityTime;\nuniform vec3 uCityWater;\nvarying vec3 vCityWorld;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" +
          "if (distance(vColor.rgb, uCityWater) < 0.004) {\n" +
          "  float rip = sin(vCityWorld.x * 2.3 + uCityTime * 1.1) * sin(vCityWorld.z * 1.9 - uCityTime * 0.8)\n" +
          "    + 0.5 * sin((vCityWorld.x + vCityWorld.z) * 3.7 - uCityTime * 1.6);\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), smoothstep(0.95, 1.35, rip) * 0.4);\n" +
          "}"
      );
  };
  mat.customProgramCacheKey = () => "downtown-city";
  return mat;
}

/** Ring Road, its corner crossroads, and the streets running off the map. */
function buildRoads(parts: Parts): void {
  const flat = (name: string, tx: number, ty: number, yaw: number) => parts.model(name, tx, ty, yaw, Y_ROAD, 1, 1);
  const alongX = 0;
  const alongY = Math.PI / 2;
  for (let t = RING_MIN + 1; t < RING_MAX; t++) {
    flat("road-straight", t, RING_MIN, alongX); // Main Street
    flat("road-straight", t, RING_MAX, alongX); // Canal Row (the Grand Bridge deck too)
    flat("road-straight", RING_MIN, t, alongY); // City Hall Avenue
    flat("road-straight", RING_MAX, t, alongY); // Harbor Avenue
  }
  for (const cx of [RING_MIN, RING_MAX]) {
    for (const cy of [RING_MIN, RING_MAX]) {
      flat("road-crossroad-path", cx, cy, 0);
      const ox = cx === RING_MIN ? -1 : 1;
      const oy = cy === RING_MIN ? -1 : 1;
      for (let k = 1; k <= STUB; k++) {
        // A zebra on the first tile out of every corner, then plain road.
        const piece = k === 1 ? "road-crossing" : "road-straight";
        flat(piece, cx + ox * k, cy, alongX);
        flat(piece, cx, cy + oy * k, alongY);
      }
    }
  }
}

/** The Grand Bridge over the canal on Canal Row (spaces 18-19 stand on its deck). */
function buildBridge(parts: Parts): void {
  const B = W.bridge;
  const len = B.len * S;
  const x = wx(B.x);
  for (const side of [-1, 1]) {
    const z = wz(B.y + side * 0.53);
    parts.shape(new THREE.BoxGeometry(len, 0.3, 0.16), palette.cityStone, x, Y_WALK + 0.15, z);
    // Squat end posts with caps.
    for (const end of [-1, 1]) {
      const px = x + (end * len) / 2;
      parts.shape(new THREE.BoxGeometry(0.3, 0.5, 0.3), palette.cityStone, px, Y_WALK + 0.25, z);
      parts.shape(new THREE.BoxGeometry(0.36, 0.06, 0.36), palette.creamShadow, px, Y_WALK + 0.53, z);
    }
    // Stone face under the deck edge, across the water.
    parts.shape(
      new THREE.BoxGeometry(CANAL_HALF * 2 * S + 0.3, -Y_WATER + 0.02, 0.12),
      palette.cityStone,
      wx(W.canal.x),
      (Y_WATER + Y_ROAD) / 2,
      wz(B.y + side * 0.47)
    );
  }
}

/** A tall clock tower for the Clock Tower corner (space 8), outside the ring's south-east. */
function buildClockTower(parts: Parts, tx: number, ty: number): void {
  const x = wx(tx);
  const z = wz(ty);
  parts.shape(new THREE.BoxGeometry(1.5, 4.6, 1.5), palette.cityStone, x, Y_GROUND + 2.3, z);
  parts.shape(new THREE.BoxGeometry(1.8, 0.3, 1.8), palette.creamShadow, x, Y_GROUND + 4.75, z);
  parts.shape(new THREE.ConeGeometry(1.3, 1.5, 4), palette.spaceRedDeep, x, Y_GROUND + 5.65, z, Math.PI / 4);
  // Clock faces on the south and west sides (the board's two camera directions).
  for (const [dx, dz, yaw] of [
    [0, 1, 0],
    [-1, 0, -Math.PI / 2],
    [0, -1, Math.PI],
  ] as const) {
    const fx = x + dx * 0.76;
    const fz = z + dz * 0.76;
    parts.shape(new THREE.CircleGeometry(0.52, 14), palette.cream, fx, Y_GROUND + 3.7, fz, yaw);
    const hand = new THREE.BoxGeometry(0.06, 0.38, 0.02);
    hand.translate(0, 0.16, 0);
    hand.rotateZ(0.6);
    parts.shape(hand, palette.ink, fx + dx * 0.01, Y_GROUND + 3.7, fz + dz * 0.01, yaw);
    const hand2 = new THREE.BoxGeometry(0.06, 0.26, 0.02);
    hand2.translate(0, 0.11, 0);
    hand2.rotateZ(-1.9);
    parts.shape(hand2, palette.ink, fx + dx * 0.01, Y_GROUND + 3.7, fz + dz * 0.01, yaw);
  }
}

/** Plaza fountain: a stone basin (its pool is part of the water mesh) and a two-tier spout. */
function buildFountain(parts: Parts): void {
  const x = wx(FOUNTAIN.tx);
  const z = wz(FOUNTAIN.ty);
  const r = FOUNTAIN.r;
  parts.shape(new THREE.CylinderGeometry(r, r * 1.04, 0.34, 18, 1, true), palette.cityStone, x, Y_GROUND + 0.17, z);
  const rim = new THREE.RingGeometry(r * 0.86, r, 18);
  rim.rotateX(-Math.PI / 2);
  parts.shape(rim, palette.creamShadow, x, Y_GROUND + 0.34, z);
  const inner = new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.12, 18, 1, true);
  inner.scale(-1, 1, 1); // faces inward
  parts.shape(inner, palette.cityStone, x, Y_GROUND + 0.28, z);
  const pool = new THREE.CircleGeometry(r * 0.86, 18);
  pool.rotateX(-Math.PI / 2);
  parts.shape(pool, palette.cityCanal, x, Y_GROUND + 0.24, z);
  parts.shape(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 8), palette.cityStone, x, Y_GROUND + 0.6, z);
  parts.shape(new THREE.CylinderGeometry(0.46, 0.14, 0.2, 10), palette.creamShadow, x, Y_GROUND + 1.1, z);
  parts.shape(new THREE.CylinderGeometry(0.08, 0.11, 0.42, 6), palette.cityStone, x, Y_GROUND + 1.38, z);
  parts.shape(new THREE.SphereGeometry(0.17, 8, 5), palette.bubble, x, Y_GROUND + 1.66, z);
}

/** Low-poly tree: a trunk and a faceted crown. */
function tree(parts: Parts, tx: number, ty: number, size: number, leaf: string): void {
  const x = wx(tx);
  const z = wz(ty);
  parts.shape(new THREE.CylinderGeometry(0.07 * size, 0.1 * size, 0.7 * size, 5), palette.bark, x, Y_GROUND + 0.35 * size, z);
  const crown = new THREE.IcosahedronGeometry(0.55 * size, 0);
  crown.scale(1, 1.15, 1);
  parts.shape(crown, leaf, x, Y_GROUND + 1.15 * size, z);
}

/** Painted arrow at tile spot (tx, ty) pointing along tile direction (dtx, dty): ink border, coloured core. */
function arrow(parts: Parts, tx: number, ty: number, dtx: number, dty: number, color: string): void {
  const yaw = Math.atan2(dty, dtx); // shape +x -> world (dtx, -dty)
  const make = (len: number, half: number, head: number, shaft: number): THREE.ShapeGeometry => {
    const s = new THREE.Shape();
    s.moveTo(-len / 2, -shaft);
    s.lineTo(len / 2 - head, -shaft);
    s.lineTo(len / 2 - head, -half);
    s.lineTo(len / 2, 0);
    s.lineTo(len / 2 - head, half);
    s.lineTo(len / 2 - head, shaft);
    s.lineTo(-len / 2, shaft);
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  };
  const L = 0.4 * S;
  parts.shape(make(L + 0.16, 0.25, 0.42, 0.11), palette.ink, wx(tx), Y_PAINT, wz(ty), yaw);
  parts.shape(make(L, 0.19, 0.34, 0.06), color, wx(tx), Y_PAINT + 0.008, wz(ty), yaw);
}

/** Street lamp on a sidewalk spot, arm reaching along (dtx, dty). */
const lamp = (parts: Parts, tx: number, ty: number, dtx: number, dty: number): void =>
  parts.model("light-curved", tx, ty, reaching(dtx, dty), Y_WALK, 1.3);

/** Yaw turning a model at tile spot (tx, ty) to face the middle of the ring, along its nearer axis. */
const faceRing = (tx: number, ty: number): number => {
  const dx = 4 - tx;
  const dy = 4 - ty;
  return Math.abs(dx) > Math.abs(dy) ? facing(Math.sign(dx), 0) : facing(0, Math.sign(dy));
};

/** A storefront row: models packed side by side along a street, fronts facing (dtx, dty). */
function frontage(
  parts: Parts,
  walls: () => THREE.Color,
  names: readonly string[],
  axis: "x" | "y",
  from: number,
  to: number,
  front: number,
  dtx: number,
  dty: number,
  gap = 0.1
): void {
  let at = from;
  for (const name of names) {
    const sz = parts.size(name);
    if (at + sz.x > to + 1e-6) break;
    const mid = at + sz.x / 2;
    const depth = sz.z / 2;
    if (axis === "x") parts.model(name, mid, front - dty * depth, facing(dtx, dty), Y_GROUND, 1, S, walls());
    else parts.model(name, front - dtx * depth, mid, facing(dtx, dty), Y_GROUND, 1, S, walls());
    at += sz.x + gap;
  }
}

/** The cheaper low-detail towers (86 to 188 triangles) for the back lots. */
const LOW = "acdefikl".split("").map((c) => `low-detail-building-${c}`);

/**
 * Back-lot fill: low-detail towers on a loose grid, skipping `skip` spots and
 * a few at random; every tower faces the ring.
 */
function fill(
  parts: Parts,
  rand: () => number,
  walls: () => THREE.Color,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  skip: (tx: number, ty: number) => boolean
): void {
  const step = 1.35;
  for (let ty = y0; ty <= y1 + 1e-6; ty += step) {
    for (let tx = x0; tx <= x1 + 1e-6; tx += step) {
      if (skip(tx, ty) || rand() < 0.2) continue;
      const name = LOW[Math.floor(rand() * LOW.length)];
      const k = 1.6 + rand() * 0.5;
      const x = tx + (rand() - 0.5) * 0.3;
      const y = ty + (rand() - 0.5) * 0.3;
      parts.model(name, x, y, faceRing(tx, ty), Y_GROUND, k, S * (0.9 + rand() * 0.5), walls());
    }
  }
}

export function buildDowntownCity(host: BoardThemeHost, models: CityModels): BuiltBoardTheme {
  const parts = new Parts(models);
  const rand = fxMulberry32(0xd0e7c17e);
  const outline = canalOutline();
  // Wall paints, never the same twice in a row.
  const paints = [palette.cityPeach, palette.cityMint, palette.citySky, palette.cityLilac, palette.cityButter, palette.cream].map(
    (c) => new THREE.Color(c)
  );
  let lastPaint = -1;
  const walls = (): THREE.Color => {
    let i = Math.floor(rand() * paints.length);
    if (i === lastPaint) i = (i + 1) % paints.length;
    lastPaint = i;
    return paints[i];
  };

  buildGroundAndCanal(parts, outline);
  buildRoads(parts);
  buildBridge(parts);

  // ---- storefronts round the ring ------------------------------------------------
  // East of Harbor Avenue and west of City Hall Avenue: right at the sidewalk.
  frontage(parts, walls, ["building-g", "building-a", "building-f", "building-b", "building-h", "building-d", "building-a"], "y", 0.62, 7.4, 8.56, -1, 0);
  frontage(parts, walls, ["building-h", "building-a", "building-e", "building-f", "building-b", "building-d"], "y", 0.62, 7.4, -0.56, 1, 0);
  // North of Canal Row: behind a promenade, either side of the canal.
  frontage(parts, walls, ["building-a", "building-b", "building-h", "building-c"], "x", 0.6, 4.85, 9.45, 0, -1);
  frontage(parts, walls, ["building-d"], "x", 6.2, 7.45, 9.45, 0, -1);
  // South of Main Street: behind the station plaza. Central Station is the wide one.
  frontage(parts, walls, ["building-e", "building-c", "building-a", "building-h", "building-c", "building-d"], "x", 0.62, 7.45, -1.55, 0, 1);

  // Skyline: a few glass towers well behind the frontages.
  const towers: Array<[string, number, number]> = [
    ["building-skyscraper-b", 2.0, 13.0],
    ["building-skyscraper-c", 7.3, 12.6],
    ["building-skyscraper-e", 11.3, 10.7],
    ["building-skyscraper-a", -3.1, 5.2],
    ["building-skyscraper-e", 11.6, -3.4],
  ];
  for (const [name, tx, ty] of towers) parts.model(name, tx, ty, faceRing(tx, ty), Y_GROUND);
  const clock = { tx: 9.35, ty: -1.25 };
  buildClockTower(parts, clock.tx, clock.ty);

  // Back lots: low-detail towers, clear of the streets, the canal, the towers and the frontages above.
  const onStreet = (tx: number, ty: number): boolean =>
    [RING_MIN, RING_MAX].some((s) => Math.abs(tx - s) < 0.95 || Math.abs(ty - s) < 0.95);
  const taken = (tx: number, ty: number): boolean =>
    towers.some(([, x, y]) => Math.hypot(tx - x, ty - y) < 1.2) || Math.hypot(tx - clock.tx, ty - clock.ty) < 1.2;
  const nearCanal = (tx: number, ty: number): boolean => ty > 6 && Math.abs(tx - W.canal.x) < 1.0;
  const skip = (tx: number, ty: number): boolean => onStreet(tx, ty) || taken(tx, ty) || nearCanal(tx, ty);
  const besideRing = (ty: number): boolean => ty > RING_MIN && ty < RING_MAX;
  fill(parts, rand, walls, 9.9, 14.0, -6.0, 14.0, (tx, ty) => skip(tx, ty) || (besideRing(ty) && tx < 10.1));
  fill(parts, rand, walls, -6.0, -1.9, -6.0, 14.0, (tx, ty) => skip(tx, ty) || (besideRing(ty) && tx > -2.1));
  fill(parts, rand, walls, 0.6, 7.6, 10.7, 14.0, skip);
  fill(parts, rand, walls, 0.6, 7.6, -6.0, -2.8, skip);

  // ---- inside the ring: Shops Row, the fountain plaza, the basin quay, Willow Walk ----
  parts.model("building-e", 1.55, 1.62, facing(0, -1), Y_GROUND, 1, S, walls()); // faces Main Street
  parts.model("building-c", 3.24, 1.86, facing(1, 0), Y_GROUND, 1, S, walls()); // Market Hall, faces Market Street
  parts.model("building-c", 3.24, 3.0, facing(1, 0), Y_GROUND, 1, S, walls());
  parts.model("building-c", 1.26, 3.1, facing(-1, 0), Y_GROUND, 1, S, walls()); // faces City Hall Avenue
  parts.model("detail-awning-wide", 3.24, 1.86, facing(1, 0), Y_GROUND);
  parts.model("detail-awning", 3.24, 3.0, facing(1, 0), Y_GROUND);
  buildFountain(parts);
  // Cafe terrace round the fountain, a flower stall and a food cart along Market Street.
  for (const [tx, ty, name] of [
    [5.72, 1.62, "detail-parasol-a"],
    [7.12, 1.35, "detail-parasol-b"],
    [7.1, 2.62, "detail-parasol-a"],
    [6.95, 3.25, "detail-parasol-b"],
  ] as const) {
    parts.model(name, tx, ty, 0, Y_GROUND, 1.2);
  }
  parts.model("detail-awning-wide", 5.25, 2.55, facing(-1, 0), Y_GROUND, 1, S * 0.9);
  parts.shape(new THREE.BoxGeometry(0.42, 0.5, 1.5), palette.wood, wx(5.12), Y_GROUND + 0.25, wz(2.55));
  // Willow Walk: a lawn north of the Riverside path, and trees.
  const lawn = new THREE.PlaneGeometry(3.0 * S, 1.75 * S);
  lawn.rotateX(-Math.PI / 2);
  parts.shape(lawn, palette.grassB, wx(2.1), Y_GROUND + 0.012, wz(6.52));
  for (const [tx, ty, size] of [
    [1.15, 6.45, 1.0],
    [2.15, 6.7, 1.15],
    [3.1, 6.35, 0.95],
    [1.65, 7.15, 0.85],
    [6.75, 7.05, 0.9],
    [0.95, 4.2, 0.8],
    [7.2, 4.95, 0.7],
  ] as const) {
    tree(parts, tx, ty, size, rand() < 0.5 ? palette.leaf : palette.leafDeep);
  }
  // Promenade north of Canal Row and the station plaza south of Main Street: trees between the lamps.
  for (const tx of [1.0, 3.0, 7.0]) tree(parts, tx, 9.0, 0.8, palette.leafDeep);
  for (const tx of [1.0, 3.0, 5.0, 7.0]) tree(parts, tx, -1.05, 0.85, palette.leaf);
  // Pothole Plaza: cones and a barrier round the pothole.
  parts.model("construction-cone", 3.78, -0.64, 0, Y_WALK, 1.4);
  parts.model("construction-cone", 4.22, -0.64, 0.4, Y_WALK, 1.4);
  parts.model("construction-barrier", 4.0, -0.72, Math.PI / 2, Y_WALK, 1.4);

  // ---- lamps, traffic lights ----------------------------------------------------------
  for (const t of [1.5, 3.5, 6.5]) lamp(parts, t, RING_MIN - 0.45, 0, 1); // Main Street, south curb
  for (const t of [1.5, 6.5]) lamp(parts, t, RING_MAX + 0.45, 0, -1); // Canal Row, north curb
  for (const t of [1.5, 3.5, 5.5]) lamp(parts, RING_MAX + 0.45, t, -1, 0); // Harbor Avenue, east curb
  for (const t of [1.5, 3.5, 5.5]) lamp(parts, RING_MIN - 0.45, t, 1, 0); // City Hall Avenue, west curb
  for (const [tx, ty] of [
    [5.0, 5.85],
    [6.2, 5.6],
  ] as const) {
    lamp(parts, tx, ty, 0, 1); // basin quay
  }
  for (const [cx, cy] of [
    [RING_MIN, RING_MIN],
    [RING_MAX, RING_MIN],
    [RING_MAX, RING_MAX],
    [RING_MIN, RING_MAX],
  ] as const) {
    const ox = cx === RING_MIN ? -1 : 1;
    const oy = cy === RING_MIN ? -1 : 1;
    parts.model("traffic-light", cx + ox * 0.45, cy + oy * 0.45, facing(-ox, -oy), Y_WALK, 1.3);
  }

  // ---- fork arrows: stay and branch, in the free corners between three rims ----------
  const def = host.def;
  const branches = def.branches ?? [];
  for (const br of branches) {
    const from = def.spaces[br.from];
    const stay = def.spaces[def.next[br.from][0]];
    const first = def.spaces[br.path[0]];
    if (!from || !stay || !first) continue;
    const spots = forkSpots(br.from);
    if (!spots) continue;
    arrow(parts, spots.stay[0], spots.stay[1], (stay.x - from.x) / S, -(stay.y - from.y) / S, palette.cream);
    arrow(parts, spots.branch[0], spots.branch[1], (first.x - from.x) / S, -(first.y - from.y) / S, palette.sun);
  }

  // ---- one mesh, one material -----------------------------------------------------------
  const geo = parts.merge();
  const time = { value: 0 };
  const mat = cityMaterial(host.kit, time);
  const city = new THREE.Mesh(geo, mat);
  city.name = "downtown:city";
  city.receiveShadow = true;
  city.castShadow = false;

  const root = new THREE.Group();
  root.name = THEME_SCENERY_NAME;
  root.add(city);
  return {
    root,
    update(t: number) {
      time.value = t;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Where a fork's two arrows sit (tile units): each in a free corner between
 * the fork's rim, the next space's rim, and a third space or the curb.
 */
function forkSpots(from: number): { stay: [number, number]; branch: [number, number] } | null {
  // Market Gate (5): stay east on Main Street, branch north up Market Street.
  if (from === 5) return { stay: [5.5, -0.5], branch: [4.5, 0.5] };
  // Riverside Gate (20): stay west on Canal Row, branch south down the canal bank.
  if (from === 20) return { stay: [3.5, 8.5], branch: [3.6, 7.4] };
  return null;
}

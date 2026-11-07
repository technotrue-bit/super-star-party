/**
 * SUPER STAR PARTY — The Cruise Ship diorama: the S.S. Super Star under way
 * on open sea. A white hull with a red boot stripe over a navy bottom, teak
 * decks, the raised Lido Deck with its pool and footbridge, two stairways at
 * each Lido corner, the bridge and wheelhouse, two raked funnels, a cutaway
 * Grand Ballroom with a light-up dance floor, lifeboats on davits beside the
 * sponsons, deck chairs, the forecastle mast and the stern flag. Around it:
 * a scrolling sea, a wake and bow foam, a sky dome and a few far islands.
 *
 * Under way: the sea, wake, foam and everything afloat sit on one "sea rig"
 * that rolls and heaves against the ship, so the ship reads as riding the
 * swell. Islands, buoys and sailboats drift past aft, whitecaps stream by,
 * gulls circle the funnels. The Sea Report (board:sea) sets the mood: a
 * tailwind speeds the ship up, choppy seas roll it hard, treasure waters
 * turn the whitecaps gold.
 *
 * Deck geometry comes from boards/cruiseData.ts (the same numbers the space
 * layout and terrain layers use), so every disk sits on its deck. Static
 * parts are merged into a few vertex-coloured meshes. Animation runs from the
 * board clock; any jitter comes from a private fx stream, never the match
 * generator. Presentation only: never reads or writes match state.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { palette } from "../../config/palette";
import type { BoardDef } from "../boardData";
import type { BoardTextures } from "../boardTextures";
import type { Prop } from "../boardScenery";
import { rippleTexture, buildSkyDome } from "../boardIsland";
import { CRUISE_H, CRUISE_SHIP, type RoundRect } from "../boards/cruiseData";
import { fxMulberry32 } from "../lively/fxRng";
import { bus, type SSPEventMap } from "../../core/events";

type SeaMoodKind = SSPEventMap["board:sea"]["kind"];

/** Cruising speed: how fast the sea runs aft beneath the ship (world units / s). */
const SHIP_SPEED = 2.6;
/** One tile of the sea ripple texture, in world units (SEA_RADIUS * 2 / repeat). */
const SEA_TILE = 12;

interface SeaMood {
  /** Ship speed multiplier. */
  speed: number;
  /** Roll / heave multiplier. */
  roll: number;
  /** Whitecap size and strength. */
  cap: number;
  /** Gold tint on the whitecaps (0..1). */
  gold: number;
}

const SEA_MOODS: Record<SeaMoodKind, SeaMood> = {
  calm: { speed: 1, roll: 0.6, cap: 0.75, gold: 0 },
  tailwind: { speed: 1.8, roll: 1, cap: 1.25, gold: 0 },
  choppy: { speed: 1.1, roll: 2.6, cap: 1.7, gold: 0 },
  treasure: { speed: 1, roll: 0.9, cap: 1.05, gold: 1 },
  dinner: { speed: 0.85, roll: 0.7, cap: 0.9, gold: 0.35 },
};

/** v wrapped into [-r, r). */
const wrapRange = (v: number, r: number): number => ((((v + r) % (2 * r)) + 2 * r) % (2 * r)) - r;
const smooth = (a: number, b: number, v: number): number => {
  const u = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Sea level under the ship (world y). */
export const CRUISE_SEA_Y = -3.4;
const HULL_BOTTOM = -4.3;
const SEA_RADIUS = 320;
const SKY_RADIUS = 380;

type P2 = { x: number; z: number };

export interface CruiseShip {
  /** Static diorama plus the animated pieces (add to the board's decor). */
  root: THREE.Group;
  /** Animated pieces, already parented under root. */
  props: Prop[];
  /** Deck lamp glows for the night rig. */
  lamps: { glow: THREE.Mesh; halo: THREE.Mesh }[];
  /** Signal-flag lines ("dressed overall"), for the bunting and string lights. */
  strands: Array<[THREE.Vector3, THREE.Vector3]>;
  /** Crowd bleacher spots on the forecastle (deck level). */
  bleachers: P2[];
  setSky(top: number, horizon: number): void;
  update(t: number, dt: number): void;
  dispose(): void;
}

// ---- outlines ---------------------------------------------------------------------------

/** Closed rounded rectangle, counter-clockwise in (x, z), about `step` apart. */
function roundRectPts(r: RoundRect, step = 0.35): P2[] {
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

/** The hull's deck edge: straight sides, an ogive bow, a rounded stern. */
function hullPts(): P2[] {
  const H = CRUISE_SHIP.hull;
  const out: P2[] = [];
  const BOW = 60;
  const STERN = 44;
  // starboard side, stern -> bow
  for (let z = H.sternStart; z > H.bowStart; z -= 0.6) out.push({ x: H.halfX, z });
  for (let k = 0; k <= BOW; k++) {
    const u = k / BOW;
    out.push({ x: H.halfX * Math.pow(1 - Math.pow(u, 1.8), 0.7), z: H.bowStart + (H.bowTip - H.bowStart) * u });
  }
  for (let k = BOW - 1; k >= 0; k--) {
    const u = k / BOW;
    out.push({ x: -H.halfX * Math.pow(1 - Math.pow(u, 1.8), 0.7), z: H.bowStart + (H.bowTip - H.bowStart) * u });
  }
  for (let z = H.bowStart + 0.6; z < H.sternStart; z += 0.6) out.push({ x: -H.halfX, z });
  for (let k = 0; k < STERN; k++) {
    const th = Math.PI - (k / STERN) * Math.PI; // port (pi) -> starboard (0)
    const c = Math.cos(th);
    const s = Math.sin(th);
    out.push({
      x: H.halfX * Math.sign(c) * Math.pow(Math.abs(c), 2 / 3),
      z: H.sternStart + (H.sternTip - H.sternStart) * Math.pow(Math.abs(s), 2 / 3),
    });
  }
  // The loop above runs clockwise in (x, z); flip to counter-clockwise.
  return out.reverse();
}

function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Outward unit normal of segment i -> i+1 (counter-clockwise outlines). */
function segNormal(pts: P2[], i: number, ccw: boolean): P2 {
  const p = pts[i];
  const q = pts[(i + 1) % pts.length];
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  return ccw ? { x: dz / l, z: -dx / l } : { x: -dz / l, z: dx / l };
}

/** Each point pushed `d` along its averaged outward normal. */
function offsetPts(pts: P2[], d: number): P2[] {
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

/** Pull outline points inside a stairway notch in to the notch's inner edge. */
function notch(pts: P2[], side: 1 | -1, inner: number, z0: number, z1: number): P2[] {
  return pts.map((p) => (Math.sign(p.x) === side && Math.abs(p.x) > inner && p.z > z0 && p.z < z1 ? { x: side * inner, z: p.z } : p));
}

// ---- merged geometry --------------------------------------------------------------------

/** Collects painted parts for one merged vertex-coloured mesh. */
class Parts {
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
function wall(parts: Parts, pts: P2[], bands: Array<{ y0: number; y1: number; color: string }>, skip?: (mid: P2) => boolean, inward = false): void {
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
function cap(pts: P2[], y: number, holes: P2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** World-space UVs (x, z) / tile on a flat geometry. */
function worldUv(g: THREE.BufferGeometry, tile: number, rot = false): THREE.BufferGeometry {
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

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, nearest = false): THREE.CanvasTexture {
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

/** Teak planks running fore and aft, with staggered butt joints. */
function teakTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = palette.teak;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = palette.teakDark;
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(i * 16, 0, 2, 128);
      const j = ((i * 53) % 128) | 0;
      ctx.fillRect(i * 16, j, 16, 2);
    }
  });
}

/** Pool-deck tiles: pale blue and white, thin grout. */
function lidoTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (ctx) => {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? palette.lidoTile : palette.white;
        ctx.fillRect(i * 16, j * 16, 16, 16);
      }
    }
    ctx.fillStyle = palette.bubble;
    ctx.globalAlpha = 0.25;
    for (let i = 0; i <= 4; i++) {
      ctx.fillRect(i * 16 - 0.5, 0, 1, 64);
      ctx.fillRect(0, i * 16 - 0.5, 64, 1);
    }
  });
}

/** Name board: "S.S. SUPER STAR" in ink on white, with a gold star each side. */
function nameTexture(): THREE.CanvasTexture {
  const t = canvasTex(512, 96, (ctx) => {
    ctx.fillStyle = palette.white;
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = palette.ink;
    ctx.font = "bold 58px Fredoka, 'Comic Sans MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S.S. SUPER STAR", 256, 52);
    ctx.fillStyle = palette.sun;
    for (const x of [24, 488]) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 9 : 22;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(x + Math.cos(a) * r, 50 + Math.sin(a) * r);
      }
      ctx.fill();
    }
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function starShape(r: number, inner = 0.42): THREE.Shape {
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

// ---- the ship ---------------------------------------------------------------------------

export function buildCruiseShip(def: BoardDef, kit: BoardTextures): CruiseShip {
  const S = CRUISE_SHIP;
  const root = new THREE.Group();
  root.name = "cruise-ship";
  const props: Prop[] = [];
  const lamps: { glow: THREE.Mesh; halo: THREE.Mesh }[] = [];
  const textures: THREE.Texture[] = [];
  const fx = fxMulberry32(0xc401);
  const toon = (opts: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial =>
    new THREE.MeshToonMaterial({ color: palette.white, gradientMap: kit.grad, ...opts });
  const solid = new Parts();
  const lidoH = CRUISE_H.lido;
  // Everything afloat rides this group; it rolls and heaves against the ship.
  const seaRig = new THREE.Group();
  seaRig.name = "cruise:sea-rig";
  root.add(seaRig);

  // ---- sea, sky, far islands ------------------------------------------------------------
  const rip = rippleTexture();
  textures.push(rip);
  rip.repeat.set(SEA_RADIUS / 6, SEA_RADIUS / 6);
  const seaGeo = new THREE.CircleGeometry(SEA_RADIUS, 72);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, toon({ map: rip }));
  sea.position.set(0, CRUISE_SEA_Y, 0);
  sea.name = "cruise:sea";
  seaRig.add(sea);

  const sky = buildSkyDome();
  sky.mesh.scale.setScalar(SKY_RADIUS / 300);
  // The dome rides with the camera, so the far plane never clips its horizon.
  sky.mesh.onBeforeRender = (_r, _s, cam) => {
    sky.mesh.position.set(cam.position.x, 0, cam.position.z);
    sky.mesh.updateMatrixWorld();
  };
  root.add(sky.mesh);

  // Tropical islets on the horizon: sand, a green cap, palms; one lighthouse.
  // Each drifts aft as the ship steams on, sinks below the horizon at the far
  // end and comes back up ahead of the bow.
  const islets: { mesh: THREE.Mesh; x: number; z0: number; s: number }[] = [];
  {
    const isletMat = toon({ vertexColors: true });
    const spots: [number, number, number][] = [
      [-2.4, 150, 1.4],
      [-1.1, 190, 1.0],
      [0.5, 165, 1.7],
      [2.1, 200, 1.2],
      [2.9, 140, 1.1],
      [-0.4, 230, 2.2],
    ];
    spots.forEach(([a, d, s], k) => {
      const isl = new Parts();
      const at = (dx: number, dy: number, dz: number) => new THREE.Matrix4().makeTranslation(dx * s, dy * s, dz * s);
      const sc = (m: THREE.Matrix4) => m.multiply(new THREE.Matrix4().makeScale(s, s, s));
      isl.add(new THREE.CylinderGeometry(3.6, 4.4, 1.0, 14), palette.sand, sc(at(0, 0.2, 0)));
      isl.add(new THREE.CylinderGeometry(2.4, 3.2, 0.6, 12), palette.grassA, sc(at(0.4, 0.9, -0.3)));
      for (const [px, pz, h] of [[-1, 0.6, 3.2], [1.2, -0.4, 2.6], [0.2, 1.4, 2.2]] as const) {
        isl.add(new THREE.CylinderGeometry(0.14, 0.2, h, 6), palette.bark, sc(at(px, 1.0 + h / 2, pz)));
        isl.add(new THREE.ConeGeometry(1.3, 0.7, 6), palette.leaf, sc(at(px, 1.1 + h, pz)));
      }
      if (k === 2) {
        isl.add(new THREE.CylinderGeometry(0.5, 0.8, 5, 10), palette.white, sc(at(-1.4, 3.5, -0.6)));
        isl.add(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 10), palette.spaceRed, sc(at(-1.4, 4.4, -0.6)));
        isl.add(new THREE.ConeGeometry(0.7, 0.8, 10), palette.spaceRed, sc(at(-1.4, 6.4, -0.6)));
      }
      const mesh = isl.build(isletMat, "cruise:islet", false);
      mesh.position.set(Math.cos(a) * d, CRUISE_SEA_Y, Math.sin(a) * d);
      seaRig.add(mesh);
      islets.push({ mesh, x: Math.cos(a) * d, z0: Math.sin(a) * d, s });
    });
  }

  // ---- hull -------------------------------------------------------------------------------
  const hull = hullPts();
  {
    // Hull side in printed bands, tucked in a little toward the keel.
    const rows: Array<{ y: number; inset: number }> = [
      { y: 0, inset: 0 },
      { y: -2.25, inset: 0.25 },
      { y: -2.6, inset: 0.3 },
      { y: HULL_BOTTOM, inset: 0.75 },
    ];
    const colors = [palette.white, palette.spaceRed, palette.hullNavy];
    const rings = rows.map((r) => offsetPts(hull, -r.inset));
    for (let b = 0; b < colors.length; b++) {
      const top = rings[b];
      const bot = rings[b + 1];
      const pos: number[] = [];
      for (let i = 0; i < hull.length; i++) {
        const j = (i + 1) % hull.length;
        const a0 = [bot[i].x, rows[b + 1].y, bot[i].z];
        const a1 = [bot[j].x, rows[b + 1].y, bot[j].z];
        const b0 = [top[i].x, rows[b].y, top[i].z];
        const b1 = [top[j].x, rows[b].y, top[j].z];
        for (const v of [a0, b0, a1, a1, b0, b1]) pos.push(v[0], v[1], v[2]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      solid.add(g, colors[b]);
    }
    // Bulwark: a low white wall on the deck edge, open where the sponsons join.
    const bulwarkIn = offsetPts(hull, -0.22);
    const open = (p: P2): boolean => {
      const sp = S.sponson;
      return (p.x > 0 && p.z > sp.starboard[0] && p.z < sp.starboard[1]) || (p.x < 0 && p.z > sp.port[0] && p.z < sp.port[1]);
    };
    wall(solid, hull, [{ y0: 0, y1: 0.42, color: palette.white }], (m) => open(m) && Math.abs(m.x) > 15);
    wall(solid, bulwarkIn, [{ y0: 0, y1: 0.42, color: palette.white }], (m) => open(m) && Math.abs(m.x) > 15, true);
    // Rail cap: teak strip on top of the bulwark, inked on the outside.
    const capPos: number[] = [];
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      const mid = { x: (hull[i].x + hull[j].x) / 2, z: (hull[i].z + hull[j].z) / 2 };
      if (open(mid) && Math.abs(mid.x) > 15) continue;
      const a = hull[i];
      const b = hull[j];
      const c = bulwarkIn[j];
      const d = bulwarkIn[i];
      for (const v of [a, d, b, b, d, c]) capPos.push(v.x, 0.44, v.z);
    }
    const capG = new THREE.BufferGeometry();
    capG.setAttribute("position", new THREE.Float32BufferAttribute(capPos, 3));
    capG.computeVertexNormals();
    solid.add(capG, palette.teakDark);
    wall(solid, offsetPts(hull, 0.02), [{ y0: 0.32, y1: 0.46, color: palette.ink }], (m) => open(m) && Math.abs(m.x) > 15);

    // Portholes: a row of navy dots along the white topsides.
    const port = new THREE.CircleGeometry(0.2, 10);
    const ccw = signedArea(hull) > 0;
    let acc = 0;
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      acc += Math.hypot(hull[j].x - hull[i].x, hull[j].z - hull[i].z);
      if (acc < 1.7) continue;
      acc = 0;
      const n = segNormal(hull, i, ccw);
      for (const y of [-0.75, -1.55]) {
        const out = 0.03 - (0.25 * -y) / 2.25;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(hull[i].x + n.x * out, y, hull[i].z + n.z * out),
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, 0, n.z)),
          new THREE.Vector3(1, 1, 1)
        );
        solid.add(port.clone(), palette.hullNavy, m);
      }
    }
    port.dispose();

    // Ship's name on each side of the bow, and across the stern.
    const nameTex = nameTexture();
    textures.push(nameTex);
    const nameMat = toon({ map: nameTex });
    // Bow plates follow the hull's flare: placed on the side at the plate's
    // middle, turned to the local tangent, short enough to stay on the curve.
    const bowAt = (u: number): P2 => ({
      x: S.hull.halfX * Math.pow(1 - Math.pow(u, 1.8), 0.7),
      z: S.hull.bowStart + (S.hull.bowTip - S.hull.bowStart) * u,
    });
    for (const side of [1, -1]) {
      const a = bowAt(0.16);
      const b = bowAt(0.26);
      const mid = bowAt(0.21);
      const tx = (b.x - a.x) * side;
      const tz = b.z - a.z;
      const len = Math.hypot(tx, tz);
      const nx = (side * Math.abs(tz)) / len;
      const nz = side > 0 ? tx / len : -tx / len;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.85), nameMat);
      plate.position.set(side * mid.x + nx * 0.12, -1.0, mid.z + nz * 0.12);
      plate.lookAt(plate.position.x + nx, plate.position.y, plate.position.z + nz);
      plate.name = "cruise:name";
      root.add(plate);
    }
    const stern = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.35), nameMat);
    stern.position.set(0, -1.1, S.hull.sternTip + 0.05);
    stern.name = "cruise:name";
    root.add(stern);
  }

  // ---- main deck (teak) ---------------------------------------------------------------------
  const teak = teakTexture();
  textures.push(teak);
  const teakMat = toon({ map: teak });
  {
    const deck = new THREE.Mesh(worldUv(cap(offsetPts(hull, -0.2), 0), 2.6, true), teakMat);
    deck.name = "cruise:deck";
    deck.receiveShadow = true;
    root.add(deck);
    // Lifeboat sponsons: deck-level platforms on brackets outboard of each rail.
    const sp = S.sponson;
    for (const [side, zr] of [[1, sp.starboard], [-1, sp.port]] as const) {
      const x0 = side * (sp.x0 - 0.4);
      const x1 = side * sp.x1;
      const pts: P2[] = [
        { x: Math.min(x0, x1), z: zr[0] },
        { x: Math.max(x0, x1), z: zr[0] },
        { x: Math.max(x0, x1), z: zr[1] },
        { x: Math.min(x0, x1), z: zr[1] },
      ];
      const top = new THREE.Mesh(worldUv(cap(pts, 0), 2.6, true), teakMat);
      top.receiveShadow = true;
      top.name = "cruise:sponson";
      root.add(top);
      // White platform sides under the teak.
      solid.box(Math.abs(x1 - x0), 0.5, zr[1] - zr[0], (x0 + x1) / 2, -0.28, (zr[0] + zr[1]) / 2, palette.white);
      for (let z = zr[0] + 0.6; z < zr[1]; z += 2.4) {
        solid.add(new THREE.CylinderGeometry(0.16, 0.16, 2.6, 6), palette.white, new THREE.Matrix4().makeRotationZ(side * 0.75).setPosition(side * (S.hull.halfX + 1.6), -1.4, z));
      }
      // Outboard rail: posts and a top bar.
      for (let z = zr[0] + 0.2; z <= zr[1] - 0.1; z += 0.9) solid.post(0.05, 0.05, x1 - side * 0.12, 0, 0.75, z, palette.white, 5);
      solid.bar(new THREE.Vector3(x1 - side * 0.12, 0.78, zr[0] + 0.2), new THREE.Vector3(x1 - side * 0.12, 0.78, zr[1] - 0.1), 0.06, palette.white);
      for (const z of [zr[0], zr[1]]) solid.bar(new THREE.Vector3(side * S.hull.halfX, 0.78, z), new THREE.Vector3(x1 - side * 0.12, 0.78, z), 0.06, palette.white);
    }
  }

  // ---- superstructure blocks ----------------------------------------------------------------
  const windowBands = (h: number, y0 = 0) => [
    { y0, y1: y0 + h * 0.32, color: palette.white },
    { y0: y0 + h * 0.32, y1: y0 + h * 0.66, color: palette.glass },
    { y0: y0 + h * 0.66, y1: y0 + h - 0.12, color: palette.white },
    { y0: y0 + h - 0.12, y1: y0 + h, color: palette.ink },
  ];

  // Lido Deck: notched for the stairways, a hole for the pool.
  const st = S.stairs;
  let lidoPts = roundRectPts(S.lido, 0.25);
  const inner = Math.abs(st[0].x1);
  const notchZ = (a: number, b: number): [number, number] => [Math.min(st[a].z, st[b].z) - st[a].w / 2, Math.max(st[a].z, st[b].z) + st[a].w / 2];
  const notches: Array<[1 | -1, [number, number]]> = [
    [1, notchZ(0, 1)],
    [1, notchZ(2, 3)],
    [-1, notchZ(4, 5)],
    [-1, notchZ(6, 7)],
  ];
  for (const [side, [z0, z1]] of notches) lidoPts = notch(lidoPts, side, inner, z0, z1);
  const poolPts = roundRectPts(S.pool, 0.2);
  const lidoTex = lidoTexture();
  textures.push(lidoTex);
  {
    const top = new THREE.Mesh(worldUv(cap(lidoPts, lidoH, [poolPts]), 2), toon({ map: lidoTex }));
    top.name = "cruise:lido";
    top.receiveShadow = true;
    root.add(top);
    const inNotch = (m: P2): boolean => notches.some(([side, [z0, z1]]) => Math.sign(m.x) === side && Math.abs(m.x) < inner + 0.6 && m.z > z0 - 0.05 && m.z < z1 + 0.05);
    wall(solid, lidoPts, windowBands(lidoH), inNotch);
    // Pool: tiled walls down to the water.
    wall(solid, poolPts, [{ y0: lidoH - 0.45, y1: lidoH, color: palette.lidoTile }], undefined, true);
    // Lido rail along the deck edge, open at the stairways.
    const nearStairs = (v: P2): boolean =>
      notches.some(([side, [z0, z1]]) => Math.sign(v.x) === side && Math.abs(v.x) > inner - 0.5 && v.z > z0 - 0.4 && v.z < z1 + 0.4);
    let acc = 0;
    const edge = offsetPts(lidoPts, -0.15);
    for (let i = 0; i < edge.length; i++) {
      const j = (i + 1) % edge.length;
      const p = edge[i];
      const q = edge[j];
      acc += Math.hypot(q.x - p.x, q.z - p.z);
      if (nearStairs(p)) continue;
      if (acc >= 0.9) {
        acc = 0;
        solid.post(0.045, 0.045, p.x, lidoH, lidoH + 0.7, p.z, palette.white, 5);
      }
      if (!nearStairs(q)) solid.bar(new THREE.Vector3(p.x, lidoH + 0.72, p.z), new THREE.Vector3(q.x, lidoH + 0.72, q.z), 0.05, palette.white);
    }
  }
  // Pool water + footbridge.
  const poolRip = rippleTexture();
  textures.push(poolRip);
  poolRip.repeat.set(1.4, 2);
  const poolWater = new THREE.Mesh(worldUv(cap(poolPts, lidoH - 0.32), 4), toon({ map: poolRip, color: palette.lidoTile }));
  poolWater.name = "cruise:pool";
  root.add(poolWater);
  {
    const bz = S.poolBridge.z;
    const bw = S.poolBridge.w;
    const span = S.pool.hx + 0.6;
    const bridge = new THREE.Mesh(
      worldUv(cap([{ x: -span, z: bz - bw / 2 }, { x: span, z: bz - bw / 2 }, { x: span, z: bz + bw / 2 }, { x: -span, z: bz + bw / 2 }], lidoH + 0.002), 2.6, true),
      teakMat
    );
    bridge.receiveShadow = true;
    bridge.name = "cruise:pool-bridge";
    root.add(bridge);
    solid.box(span * 2, 0.22, bw, 0, lidoH - 0.11, bz, palette.white);
    for (const side of [-1, 1]) {
      const z = bz + side * (bw / 2 - 0.06);
      for (let x = -span + 0.3; x <= span; x += 1.1) solid.post(0.04, 0.04, x, lidoH, lidoH + 0.6, z, palette.white, 5);
      solid.bar(new THREE.Vector3(-span + 0.3, lidoH + 0.62, z), new THREE.Vector3(span - 0.3, lidoH + 0.62, z), 0.05, palette.lifeboat);
    }
  }

  // Stairways: teak treads between white stringers, brass handrails.
  for (let k = 0; k < st.length; k += 2) {
    const a = st[k];
    const b = st[k + 1];
    const z0 = Math.min(a.z, b.z) - a.w / 2;
    const z1 = Math.max(a.z, b.z) + a.w / 2;
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      const u0 = i / steps;
      const u1 = (i + 1) / steps;
      const xa = a.x0 + (a.x1 - a.x0) * u0;
      const xb = a.x0 + (a.x1 - a.x0) * u1;
      const h = (lidoH * (i + 1)) / steps;
      solid.box(Math.abs(xb - xa) + 0.02, h, z1 - z0 - 0.2, (xa + xb) / 2, h / 2, (z0 + z1) / 2, i % 2 ? palette.teak : palette.teakDark);
    }
    for (const z of [z0 + 0.06, (z0 + z1) / 2, z1 - 0.06]) {
      solid.bar(new THREE.Vector3(a.x0, 0.85, z), new THREE.Vector3(a.x1, lidoH + 0.85, z), 0.055, palette.sunDeep);
      solid.post(0.05, 0.05, a.x0, 0, 0.85, z, palette.sunDeep, 5);
    }
    for (const z of [z0, z1]) solid.bar(new THREE.Vector3(a.x0, 0.12, z), new THREE.Vector3(a.x1, lidoH + 0.12, z), 0.12, palette.white);
  }

  // Bridge: a raised block with the wheelhouse and wings, the radar mast on top.
  const BH = CRUISE_H.bridge;
  {
    const pts = roundRectPts(S.bridge, 0.3);
    wall(solid, pts, windowBands(BH));
    solid.add(cap(pts, BH), palette.white);
    const wh: RoundRect = { x: 0, z: S.bridge.z + 0.6, hx: 4.6, hz: 1.4, r: 0.7 };
    const whPts = roundRectPts(wh, 0.2);
    wall(solid, whPts, [
      { y0: BH, y1: BH + 0.5, color: palette.white },
      { y0: BH + 0.5, y1: BH + 1.35, color: palette.glass },
      { y0: BH + 1.35, y1: BH + 1.8, color: palette.white },
    ]);
    solid.add(cap(offsetPts(whPts, 0.25), BH + 1.8), palette.white);
    solid.add(cap(offsetPts(whPts, 0.3), BH + 1.78), palette.ink);
    for (const side of [-1, 1]) solid.box(1.6, 0.9, 1.6, side * 6.2, BH + 0.45, S.bridge.z - 0.4, palette.white);
    // Bridge rail
    const edge = offsetPts(pts, -0.15);
    for (let i = 0; i < edge.length; i += 3) solid.post(0.04, 0.04, edge[i].x, BH, BH + 0.6, edge[i].z, palette.white, 5);
    // Radar mast + horn
    solid.post(0.12, 0.08, 0, BH + 1.8, BH + 4.4, wh.z, palette.white);
    solid.box(1.2, 0.08, 0.08, 0, BH + 3.5, wh.z, palette.white);
    solid.post(0.2, 0.32, 1.6, BH + 1.8, BH + 2.5, wh.z, palette.sunDeep);
  }
  const radar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.3), toon({ color: palette.ink }));
  radar.position.set(0, BH + 4.5, S.bridge.z + 0.6);
  radar.name = "cruise:radar";
  root.add(radar);
  props.push({ root: radar, update: (t) => (radar.rotation.y = t * 1.4) });

  // Funnel deck and the two raked funnels.
  const FH = CRUISE_H.funnel;
  const funnels: THREE.Vector3[] = [];
  {
    const pts = roundRectPts(S.funnelDeck, 0.3);
    wall(solid, pts, windowBands(FH));
    solid.add(cap(pts, FH), palette.white);
    const funnelGeo = (): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(1.15, 1.45, 4.0, 18, 4);
      g.scale(1, 1, 1.35);
      g.translate(0, 2.0, 0);
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + p.getY(i) * 0.16); // rake aft
      g.computeVertexNormals();
      return g;
    };
    for (const z of [S.funnelDeck.z - 1.6, S.funnelDeck.z + 1.7]) {
      const base = new THREE.Matrix4().makeTranslation(0, FH, z);
      solid.add(funnelGeo(), palette.spaceRed, base);
      // white band and black top
      const band = new THREE.CylinderGeometry(1.2, 1.24, 0.5, 18);
      band.scale(1.02, 1, 1.38);
      solid.add(band, palette.white, new THREE.Matrix4().makeTranslation(0, FH + 3.0, z + 3.0 * 0.16));
      const top = new THREE.CylinderGeometry(1.16, 1.17, 0.35, 18);
      top.scale(1.02, 1, 1.38);
      solid.add(top, palette.ink, new THREE.Matrix4().makeTranslation(0, FH + 3.85, z + 3.85 * 0.16));
      // gold star emblem on each side
      for (const side of [-1, 1]) {
        const star = new THREE.ShapeGeometry(starShape(0.55));
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(side * 1.36, FH + 1.9, z + 1.9 * 0.16),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * (Math.PI / 2), 0)),
          new THREE.Vector3(1, 1, 1)
        );
        solid.add(star, palette.sun, m);
      }
      funnels.push(new THREE.Vector3(0, FH + 4.1, z + 4.1 * 0.16));
    }
  }

  // Grand Ballroom: a cutaway hall with a light-up dance floor and a disco ball.
  {
    const B = S.ballroom;
    const pts = roundRectPts(B, 0.25);
    const floorH = CRUISE_H.ballroom;
    const N = 6;
    const M = 3;
    const tile = 1.15;
    const dfz = B.z + 0.35;
    const dance: P2[] = [
      { x: (-N / 2) * tile, z: dfz - (M / 2) * tile },
      { x: (N / 2) * tile, z: dfz - (M / 2) * tile },
      { x: (N / 2) * tile, z: dfz + (M / 2) * tile },
      { x: (-N / 2) * tile, z: dfz + (M / 2) * tile },
    ];
    const carpet = new THREE.Mesh(cap(pts, floorH, [dance]), toon({ color: palette.carpet }));
    carpet.name = "cruise:ballroom-floor";
    carpet.receiveShadow = true;
    root.add(carpet);
    // Doorways where the Grand Ballroom lane crosses the wall.
    const lane = def.branches?.find((b) => b.label === "Grand Ballroom");
    const laneSpaces = lane ? [lane.from, ...lane.path, lane.to].map((i) => def.spaces[i]) : [];
    const door = (m: P2): boolean => {
      for (let i = 0; i + 1 < laneSpaces.length; i++) {
        const a = laneSpaces[i];
        const b = laneSpaces[i + 1];
        const dx = b.x - a.x;
        const dz = b.y - a.y;
        const u = Math.max(0, Math.min(1, ((m.x - a.x) * dx + (m.z - a.y) * dz) / (dx * dx + dz * dz)));
        if (Math.hypot(a.x + dx * u - m.x, a.y + dz * u - m.z) < 1.7) return true;
      }
      return false;
    };
    wall(solid, pts, [
      { y0: 0, y1: 0.9, color: palette.inkSoft },
      { y0: 0.9, y1: 1.05, color: palette.sun },
    ], door);
    wall(solid, offsetPts(pts, -0.18), [{ y0: floorH, y1: 1.05, color: palette.berryDeep }], door, true);
    // Stage, piano and footlights along the stern wall.
    solid.box(6.4, 0.42, 1.5, 0, 0.21, B.z + B.hz - 0.95, palette.wood);
    solid.box(1.4, 0.55, 1.0, -1.8, 0.7, B.z + B.hz - 0.95, palette.ink);
    solid.box(0.7, 0.3, 0.6, 1.6, 0.6, B.z + B.hz - 0.95, palette.berry);
    for (let x = -2.8; x <= 2.81; x += 0.8) solid.post(0.08, 0.08, x, 0.42, 0.55, B.z + B.hz - 0.22, palette.sun, 6);
    // Round tables with little lamps along the north wall.
    for (const x of [-6.2, -3.6, 3.6, 6.2]) {
      solid.post(0.5, 0.5, x, 0, 0.5, B.z - B.hz + 1.0, palette.white, 12);
      solid.post(0.08, 0.08, x, 0.5, 0.8, B.z - B.hz + 1.0, palette.sunDeep, 6);
    }
    // Truss for the disco ball.
    for (const side of [-1, 1]) solid.post(0.09, 0.09, side * 2.6, floorH, 4.6, B.z + B.hz - 0.4, palette.metal, 6);
    solid.bar(new THREE.Vector3(-2.6, 4.6, B.z + B.hz - 0.4), new THREE.Vector3(2.6, 4.6, B.z + B.hz - 0.4), 0.09, palette.metal);

    // Dance floor: tiles that cycle colour (one instanced mesh), tops flush with the carpet.
    solid.add(cap(dance, floorH - 0.03), palette.ink);
    const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(tile - 0.1, 0.04, tile - 0.1), new THREE.MeshBasicMaterial({ color: palette.white }), N * M);
    floor.name = "cruise:dance-floor";
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) floor.setMatrixAt(i * M + j, m4.makeTranslation((i - (N - 1) / 2) * tile, floorH - 0.02, dfz + (j - (M - 1) / 2) * tile));
    const lights = [palette.candy, palette.bubble, palette.mint, palette.sun, palette.berry].map((c) => new THREE.Color(c));
    const col = new THREE.Color();
    let beat = -1;
    const paintFloor = (k: number): void => {
      for (let i = 0; i < N * M; i++) floor.setColorAt(i, col.copy(lights[(i * 7 + k * 3 + ((i / M) | 0)) % lights.length]));
      if (floor.instanceColor) floor.instanceColor.needsUpdate = true;
    };
    paintFloor(0);
    root.add(floor);
    props.push({
      root: floor,
      update: (t) => {
        const k = Math.floor(t * 2.2);
        if (k !== beat) {
          beat = k;
          paintFloor(k);
        }
      },
    });
    // Disco ball: faceted, spinning, twinkling.
    // Non-indexed facets: each face keeps its own normal, so the ball glints.
    const ballGeo = new THREE.IcosahedronGeometry(0.62, 1).toNonIndexed();
    ballGeo.computeVertexNormals();
    const ball = new THREE.Mesh(ballGeo, toon({ color: palette.metal }));
    ball.position.set(0, 3.9, B.z + B.hz - 0.4);
    ball.name = "cruise:disco-ball";
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), toon({ color: palette.ink }));
    wire.position.set(0, 4.3, B.z + B.hz - 0.4);
    root.add(ball, wire);
    props.push({ root: ball, update: (t) => (ball.rotation.y = t * 0.9) });
  }

  // ---- forecastle and stern fittings ---------------------------------------------------
  {
    // Foremast with a crow's nest and a yard.
    const mz = -30.6;
    solid.post(0.2, 0.12, 0, 0, 8.6, mz, palette.white);
    solid.post(0.55, 0.55, 0, 6.2, 6.7, mz, palette.wood, 10);
    solid.box(3.6, 0.1, 0.1, 0, 7.6, mz, palette.white);
    // Capstans and the anchor chains running to the hawse pipes.
    for (const side of [-1, 1]) {
      solid.post(0.42, 0.34, side * 2.2, 0, 0.6, -31.4, palette.ink, 12);
      solid.post(0.46, 0.46, side * 2.2, 0.6, 0.72, -31.4, palette.sunDeep, 12);
      // Anchor on the hull side.
      const az = -27;
      const u = (az - S.hull.bowStart) / (S.hull.bowTip - S.hull.bowStart);
      const ax = side * S.hull.halfX * Math.pow(1 - Math.pow(u, 1.8), 0.7);
      solid.box(0.18, 1.5, 0.18, ax + side * 0.1, -1.0, az, palette.ink);
      solid.add(new THREE.TorusGeometry(0.55, 0.11, 6, 12, Math.PI), palette.ink, new THREE.Matrix4().makeRotationZ(Math.PI).setPosition(ax + side * 0.1, -1.6, az));
    }
    // Jackstaff at the bow tip.
    solid.post(0.06, 0.05, 0, 0.4, 3.2, S.hull.bowTip + 0.9, palette.white, 6);
    // Stern flagpole.
    solid.post(0.08, 0.06, 0, 0.4, 4.6, S.hull.sternTip - 0.9, palette.white, 6);
    // Life rings on the rails.
    for (const [x, z] of [[16.9, -14.6], [-16.9, -14.6], [16.9, 15.6], [-16.9, 15.6], [9, 32.6], [-9, 32.6]] as const) {
      const ring = new THREE.TorusGeometry(0.36, 0.12, 6, 14);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.55, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.abs(x) > 12 ? Math.PI / 2 : 0, 0)), new THREE.Vector3(1, 1, 1));
      solid.add(ring, palette.lifeboat, m);
    }
  }
  // Flags: the stern ensign and a pennant on the jackstaff, gently waving.
  {
    const flagGeo = new THREE.PlaneGeometry(1.6, 1.0, 8, 1);
    flagGeo.translate(0.8, 0, 0);
    const flagTex = canvasTex(64, 40, (ctx) => {
      ctx.fillStyle = palette.glass;
      ctx.fillRect(0, 0, 64, 40);
      ctx.fillStyle = palette.sun;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 6 : 14;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(32 + Math.cos(a) * r, 21 + Math.sin(a) * r);
      }
      ctx.fill();
    });
    textures.push(flagTex);
    const flagMat = toon({ map: flagTex, side: THREE.DoubleSide });
    const base = flagGeo.getAttribute("position").array.slice();
    for (const [z, y, s] of [[S.hull.sternTip - 0.9, 4.1, 1], [S.hull.bowTip + 0.9, 2.85, 0.6]] as const) {
      const flag = new THREE.Mesh(flagGeo.clone(), flagMat);
      flag.position.set(0.06, y, z);
      flag.rotation.y = Math.PI / 2;
      flag.scale.setScalar(s);
      flag.name = "cruise:flag";
      root.add(flag);
      const pos = flag.geometry.getAttribute("position");
      const ph = z * 0.3;
      props.push({
        root: flag,
        update: (t) => {
          for (let i = 0; i < pos.count; i++) {
            const x = base[i * 3];
            pos.setZ(i, Math.sin(t * 5 + x * 3 + ph) * 0.12 * x);
          }
          pos.needsUpdate = true;
        },
      });
    }
    flagGeo.dispose();
  }

  // ---- lifeboats on davits ------------------------------------------------------------
  {
    const sp = S.sponson;
    const boatBody = (): THREE.BufferGeometry => {
      const g = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      g.scale(0.85, 0.75, 1.7);
      return g;
    };
    for (const [side, zr] of [[1, sp.starboard], [-1, sp.port]] as const) {
      const count = 4;
      for (let k = 0; k < count; k++) {
        const z = zr[0] + 1.9 + ((zr[1] - zr[0] - 3.8) * k) / (count - 1);
        const x = side * (sp.x1 + 1.35);
        const y = 0.5;
        const flip = new THREE.Matrix4().makeRotationX(Math.PI).setPosition(x, y, z);
        solid.add(boatBody(), palette.lifeboat, flip);
        const canopy = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        canopy.scale(0.78, 0.42, 1.55);
        solid.add(canopy, palette.white, new THREE.Matrix4().makeTranslation(x, y + 0.02, z));
        solid.box(1.72, 0.12, 3.3, x, y, z, palette.white);
        // Davit arms: up from the sponson edge and over the boat.
        for (const dz of [-1.1, 1.1]) {
          const foot = new THREE.Vector3(side * (sp.x1 - 0.2), 0, z + dz);
          const knee = new THREE.Vector3(side * (sp.x1 + 0.2), 1.9, z + dz);
          const tip = new THREE.Vector3(x, 1.75, z + dz);
          solid.bar(foot, knee, 0.09, palette.metal);
          solid.bar(knee, tip, 0.08, palette.metal);
          solid.bar(tip, new THREE.Vector3(x, y + 0.35, z + dz), 0.025, palette.ink);
        }
      }
    }
  }

  // ---- deck chairs, parasols, buffet, waterslide, hot tub -------------------------------
  {
    const occupied = (x: number, z: number, r: number): boolean =>
      def.spaces.some((s) => Math.hypot(s.x - x, s.y - z) < r + 1.25);
    const lounger = (x: number, y: number, z: number, yaw: number, color: string): void => {
      const m = (dx: number, dy: number, dz: number, rx = 0) =>
        new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeTranslation(dx, dy, dz)).multiply(new THREE.Matrix4().makeRotationX(rx)).premultiply(new THREE.Matrix4().makeTranslation(x, y, z));
      solid.add(new THREE.BoxGeometry(0.62, 0.1, 1.25), color, m(0, 0.32, 0.2));
      solid.add(new THREE.BoxGeometry(0.62, 0.1, 0.7), color, m(0, 0.55, -0.62, -0.75));
      solid.add(new THREE.BoxGeometry(0.66, 0.24, 1.9), palette.white, m(0, 0.14, -0.05));
    };
    const colors = [palette.candy, palette.bubble, palette.sun, palette.mint];
    let c = 0;
    // Promenade loungers in rows along the superstructure walls, facing the sea.
    for (const side of [1, -1]) {
      for (let z = -16.5; z <= 18; z += 1.05) {
        const wallX = z < S.lido.z - S.lido.hz ? S.bridge.hx : z > S.lido.z + S.lido.hz ? S.funnelDeck.hx : S.lido.hx;
        const x = side * (wallX + 1.25);
        if (occupied(x, z, 0.75) || st.some((s) => Math.sign(s.x0) === side && Math.abs(s.z - z) < 1.9)) continue;
        lounger(x, 0, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, colors[c++ % colors.length]);
      }
    }
    // Parasols at the lido corners, inside the rail.
    for (const [x, z] of [[8.2, -11], [-8.2, -11], [8.3, 9.9], [-8.3, 9.9]] as const) {
      if (occupied(x, z, 0.8)) continue;
      solid.post(0.05, 0.05, x, lidoH, lidoH + 2.0, z, palette.white, 5);
      solid.add(new THREE.ConeGeometry(1.0, 0.45, 8), c++ % 2 ? palette.candy : palette.bubble, new THREE.Matrix4().makeTranslation(x, lidoH + 2.1, z));
    }
    // Lido Buffet: a long counter under a striped awning, aft of the pool.
    const bz = S.pool.z + S.pool.hz + 1.35;
    solid.box(6.0, 0.8, 0.9, 0, lidoH + 0.4, bz, palette.white);
    solid.box(6.2, 0.1, 1.1, 0, lidoH + 0.85, bz, palette.teakDark);
    for (let i = 0; i < 6; i++) {
      const x = -2.5 + i;
      solid.add(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? palette.metal : palette.creamShadow, new THREE.Matrix4().makeTranslation(x, lidoH + 0.9, bz));
    }
    solid.post(0.28, 0.28, 2.9, lidoH + 0.9, lidoH + 1.25, bz, palette.candy, 12);
    solid.post(0.2, 0.2, 2.9, lidoH + 1.25, lidoH + 1.5, bz, palette.cream, 12);
    for (const x of [-3, 3]) solid.post(0.05, 0.05, x, lidoH, lidoH + 2.2, bz + 0.6, palette.white, 5);
    for (let i = 0; i < 6; i++) solid.box(1.0, 0.08, 1.6, -2.5 + i, lidoH + 2.25, bz + 0.1, i % 2 ? palette.spaceRed : palette.white);
    // Waterslide: a ladder tower at the pool's bow end and a tube curling into the water.
    const tx = 2.7;
    const tz = S.pool.z - S.pool.hz - 1.1;
    for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) solid.post(0.06, 0.06, tx + dx, lidoH, lidoH + 3.0, tz + dz, palette.white, 5);
    solid.box(1.1, 0.12, 1.1, tx, lidoH + 3.0, tz, palette.lifeboat);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(tx, lidoH + 3.05, tz),
      new THREE.Vector3(tx - 1.4, lidoH + 2.6, tz + 0.4),
      new THREE.Vector3(tx - 1.6, lidoH + 1.8, tz + 1.9),
      new THREE.Vector3(tx - 0.2, lidoH + 1.1, tz + 2.4),
      new THREE.Vector3(tx - 0.4, lidoH - 0.2, tz + 3.4),
    ]);
    solid.add(new THREE.TubeGeometry(curve, 32, 0.28, 8, false), palette.bubbleDeep);
  }

  // ---- deck lamps (the night rig lights them) --------------------------------------------
  {
    const glowGeo = new THREE.SphereGeometry(0.22, 10, 8);
    const haloGeo = new THREE.SphereGeometry(0.4, 10, 8);
    const spots: Array<[number, number, number]> = [
      [9.9, lidoH, -11.6],
      [-9.9, lidoH, -11.6],
      [9.9, lidoH, 10.6],
      [-9.9, lidoH, 10.6],
      [7.4, BH, -17.2],
      [-7.4, BH, -17.2],
      [6.3, FH, 18.5],
      [-6.3, FH, 18.5],
    ];
    for (const [x, y, z] of spots) {
      solid.post(0.05, 0.06, x, y, y + 1.6, z, palette.white, 6);
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: palette.sun }));
      glow.position.set(x, y + 1.75, z);
      glow.name = "lamp-glow";
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: palette.sun, transparent: true, opacity: 0.22 }));
      halo.position.copy(glow.position);
      halo.name = "lamp-halo";
      root.add(glow, halo);
      lamps.push({ glow, halo });
    }
  }

  root.add(solid.build(toon({ vertexColors: true }), "cruise:ship"));

  // ---- water life: wake, bow foam, funnel smoke, dolphins -------------------------------
  // Hull foam: a breathing white band where the hull meets the sea.
  {
    const water = offsetPts(hull, 0.1);
    const n = water.length;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
    }
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pa);
    g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    const foam = new THREE.Color(palette.foam);
    const ccw = signedArea(water) > 0;
    const norms = water.map((_, i) => {
      const a = segNormal(water, (i - 1 + n) % n, ccw);
      const b = segNormal(water, i, ccw);
      const l = Math.hypot(a.x + b.x, a.z + b.z) || 1;
      return { x: (a.x + b.x) / l, z: (a.z + b.z) / l };
    });
    // Wider at the bow, where the ship pushes the water.
    const width = water.map((p) => 0.5 + Math.max(0, -p.z - 14) * 0.05);
    for (let i = 0; i < n; i++) {
      col.set([foam.r, foam.g, foam.b, 0.95], i * 8);
      col.set([foam.r, foam.g, foam.b, 0], i * 8 + 4);
    }
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    mesh.position.y = CRUISE_SEA_Y + 0.04;
    mesh.name = "cruise:hull-foam";
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    const place = (t: number): void => {
      for (let i = 0; i < n; i++) {
        const w = width[i] * (1 + 0.25 * Math.sin(t * 2.1 + i * 0.21));
        const p = water[i];
        pos.set([p.x - norms[i].x * 0.3, 0, p.z - norms[i].z * 0.3], i * 6);
        pos.set([p.x + norms[i].x * w, 0, p.z + norms[i].z * w], i * 6 + 3);
      }
      pa.needsUpdate = true;
    };
    place(0);
    seaRig.add(mesh);
    props.push({ root: mesh, update: (t) => place(t) });
  }
  // Wake: two foam trails fanning out behind the stern, scrolling away.
  {
    const wakeTex = canvasTex(64, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, "rgba(244,252,255,0)");
      g.addColorStop(0.35, "rgba(244,252,255,0.85)");
      g.addColorStop(0.65, "rgba(244,252,255,0.85)");
      g.addColorStop(1, "rgba(244,252,255,0)");
      ctx.fillStyle = g;
      for (let y = 0; y < 256; y += 32) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(y * 0.05) ** 2;
        ctx.fillRect(0, y, 64, 22);
      }
    });
    textures.push(wakeTex);
    wakeTex.wrapS = THREE.ClampToEdgeWrapping;
    const len = 70;
    const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, color: palette.white });
    const wakes: THREE.Mesh[] = [];
    const geo = new THREE.BufferGeometry();
    // A strip that widens with distance, faded at the far end by vertex alpha.
    const SEG = 24;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const w = 2.2 + u * 9;
      const z = u * len;
      pos.push(-w / 2, 0, z, w / 2, 0, z);
      uv.push(0, u * 6, 1, u * 6);
      const a = 1 - u;
      col.push(1, 1, 1, a, 1, 1, 1, a);
      if (i < SEG) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx);
    wakeMat.vertexColors = true;
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(geo, wakeMat);
      w.position.set(side * 5.5, CRUISE_SEA_Y + 0.03, S.hull.sternTip - 2);
      w.rotation.y = -side * 0.22;
      w.renderOrder = 2;
      w.name = "cruise:wake";
      seaRig.add(w);
      wakes.push(w);
    }
    const churn = new THREE.Mesh(geo, wakeMat);
    churn.position.set(0, CRUISE_SEA_Y + 0.035, S.hull.sternTip - 1);
    churn.scale.set(1.1, 1, 0.55);
    churn.renderOrder = 2;
    seaRig.add(churn);
    props.push({ root: churn, update: (t) => wakeTex.offset.set(0, -t * 0.35) });
  }
  // Funnel smoke: soft puffs that rise and drift aft, then fade (one instanced mesh).
  {
    const PUFFS = 14;
    const smoke = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.7, 1),
      new THREE.MeshToonMaterial({ color: palette.white, gradientMap: kit.grad, transparent: true, opacity: 0.85 }),
      PUFFS * funnels.length
    );
    smoke.name = "cruise:smoke";
    smoke.frustumCulled = false;
    smoke.castShadow = false;
    const seeds = Array.from({ length: PUFFS * funnels.length }, () => ({ ph: fx(), sx: fx() - 0.5 }));
    const dummy = new THREE.Object3D();
    const place = (t: number): void => {
      for (let i = 0; i < seeds.length; i++) {
        const f = funnels[Math.floor(i / PUFFS)];
        const u = (t * 0.16 + seeds[i].ph) % 1;
        dummy.position.set(f.x + seeds[i].sx * 0.8 + u * 0.6, f.y + 0.4 + u * 4.2, f.z + u * 6.5);
        dummy.scale.setScalar(Math.max(0.001, (0.45 + u * 1.1) * Math.min(1, (1 - u) * 3) * Math.min(1, u * 8)));
        dummy.updateMatrix();
        smoke.setMatrixAt(i, dummy.matrix);
      }
      smoke.instanceMatrix.needsUpdate = true;
    };
    place(0);
    root.add(smoke);
    props.push({ root: smoke, update: (t) => place(t) });
  }
  // Dolphins: three leaping alongside the hull, each on its own clock.
  {
    const body = new THREE.SphereGeometry(1, 12, 8);
    body.scale(0.35, 0.32, 1.25);
    const fin = new THREE.ConeGeometry(0.22, 0.45, 4);
    fin.translate(0, 0.42, -0.1);
    const tail = new THREE.ConeGeometry(0.3, 0.5, 4);
    tail.rotateX(Math.PI / 2);
    tail.translate(0, 0, 1.35);
    const parts = new Parts();
    parts.add(body, palette.metal);
    parts.add(fin, palette.metal);
    parts.add(tail, palette.metal);
    const proto = parts.build(toon({ vertexColors: true }), "cruise:dolphin", false);
    const pod = [
      { x: 25.5, z0: -30, ph: 0 },
      { x: 27.5, z0: -24, ph: 0.37 },
      { x: -26, z0: -18, ph: 0.71 },
    ];
    for (const d of pod) {
      const m = new THREE.Mesh(proto.geometry, proto.material);
      m.name = "cruise:dolphin";
      seaRig.add(m);
      props.push({
        root: m,
        update: (t) => {
          // A leap every few seconds; under water (hidden) between leaps.
          const u = (t * 0.22 + d.ph) % 1;
          const leap = Math.min(1, u / 0.3);
          const air = u < 0.3;
          m.visible = air;
          if (!air) return;
          const z = d.z0 - leap * 7;
          const y = CRUISE_SEA_Y - 0.4 + Math.sin(leap * Math.PI) * 2.4;
          m.position.set(d.x, y, z);
          m.rotation.set(-Math.cos(leap * Math.PI) * 0.9, Math.PI, 0);
        },
      });
    }
  }

  // ---- under way: whitecaps, buoys, sailboats, gulls ----------------------------------
  // Whitecaps: short foam streaks that stream aft past the ship and fade in and out.
  const CAPS = 170;
  const CAP_X = 100;
  const CAP_Z = 120;
  const capMat = new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0.6, depthWrite: false });
  const capGeo = new THREE.CircleGeometry(1, 10);
  capGeo.rotateX(-Math.PI / 2);
  const caps = new THREE.InstancedMesh(capGeo, capMat, CAPS);
  caps.name = "cruise:whitecaps";
  caps.frustumCulled = false;
  caps.renderOrder = 1;
  const capSeeds = Array.from({ length: CAPS }, () => {
    const side = fx() < 0.5 ? -1 : 1;
    return {
      x: side * (21 + fx() * (CAP_X - 21)),
      z: (fx() * 2 - 1) * CAP_Z,
      len: 0.55 + fx() * 1.0,
      wid: 0.12 + fx() * 0.18,
      ph: fx(),
      rate: 0.18 + fx() * 0.2,
    };
  });
  seaRig.add(caps);

  // Channel buoys: red and white, bobbing, with a blinking lamp.
  const buoys: { g: THREE.Group; lamp: THREE.Mesh; x: number; z0: number; ph: number }[] = [];
  {
    const bp = new Parts();
    bp.post(0.9, 0.9, 0, -0.6, 0.2, 0, palette.spaceRed, 12);
    bp.post(0.75, 0.55, 0, 0.2, 1.1, 0, palette.white, 12);
    bp.post(0.55, 0.35, 0, 1.1, 1.9, 0, palette.spaceRed, 12);
    bp.post(0.06, 0.06, 0, 1.9, 2.6, 0, palette.metal, 6);
    const proto = bp.build(toon({ vertexColors: true }), "cruise:buoy", false);
    const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
    const spots = [
      { x: 34, z0: -60, ph: 0 },
      { x: -40, z0: 10, ph: 0.4 },
      { x: 48, z0: 95, ph: 0.7 },
      { x: -55, z0: -140, ph: 0.2 },
    ];
    for (const b of spots) {
      const g = new THREE.Group();
      g.name = "cruise:buoy";
      g.add(new THREE.Mesh(proto.geometry, proto.material));
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: palette.sun }));
      lamp.position.y = 2.75;
      g.add(lamp);
      seaRig.add(g);
      buoys.push({ g, lamp, x: b.x, z0: b.z0, ph: b.ph });
    }
  }

  // Sailboats: two little yachts heading the same way, slower, so the liner overtakes them.
  const boats: { g: THREE.Group; x: number; z0: number; ph: number; rel: number }[] = [];
  {
    const hullGeo = new THREE.CylinderGeometry(0.9, 0.5, 6, 10, 1);
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.scale(1, 0.55, 1);
    const sp = new Parts();
    sp.add(hullGeo, palette.white, new THREE.Matrix4().makeTranslation(0, 0.2, 0));
    sp.box(1.5, 0.12, 4.6, 0, 0.55, 0.2, palette.teak);
    sp.post(0.07, 0.07, 0, 0.5, 7.2, -0.5, palette.metal, 6);
    const hullMesh = sp.build(toon({ vertexColors: true }), "cruise:sailboat", false);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 6.2);
    sailShape.lineTo(3.4, 0);
    sailShape.closePath();
    const mainGeo = new THREE.ShapeGeometry(sailShape);
    mainGeo.rotateY(Math.PI / 2); // in the boat's centre plane, trailing aft
    const jibShape = new THREE.Shape();
    jibShape.moveTo(0, 0);
    jibShape.lineTo(0, 5.2);
    jibShape.lineTo(-2.4, 0);
    jibShape.closePath();
    const jibGeo = new THREE.ShapeGeometry(jibShape);
    jibGeo.rotateY(Math.PI / 2);
    const sailMats = [palette.white, palette.sun].map((c) => toon({ color: c, side: THREE.DoubleSide }));
    const spots = [
      { x: -62, z0: -90, ph: 0.1, rel: 0.45, sail: 0 },
      { x: 78, z0: 60, ph: 0.6, rel: 0.6, sail: 1 },
    ];
    for (const b of spots) {
      const g = new THREE.Group();
      g.name = "cruise:sailboat";
      g.add(new THREE.Mesh(hullMesh.geometry, hullMesh.material));
      const main = new THREE.Mesh(mainGeo, sailMats[b.sail]);
      main.position.set(0, 0.9, -0.4);
      main.rotation.y = 0.25;
      const jib = new THREE.Mesh(jibGeo, sailMats[1 - b.sail]);
      jib.position.set(0, 0.9, -0.7);
      jib.rotation.y = -0.15;
      g.add(main, jib);
      g.scale.setScalar(1.3);
      seaRig.add(g);
      boats.push({ g, x: b.x, z0: b.z0, ph: b.ph, rel: b.rel });
    }
  }

  // Gulls: a few circling over the funnels and the Lido, wings flapping (Gus's friends).
  const gulls: { g: THREE.Group; wl: THREE.Object3D; wr: THREE.Object3D; cx: number; cz: number; r: number; h: number; w: number; ph: number }[] = [];
  {
    const gp = new Parts();
    const body = new THREE.SphereGeometry(1, 10, 8);
    body.scale(0.2, 0.18, 0.55);
    gp.add(body, palette.white);
    gp.add(new THREE.SphereGeometry(0.15, 8, 6), palette.white, new THREE.Matrix4().makeTranslation(0, 0.1, -0.5));
    const beak = new THREE.ConeGeometry(0.06, 0.22, 5);
    beak.rotateX(-Math.PI / 2);
    gp.add(beak, palette.sunDeep, new THREE.Matrix4().makeTranslation(0, 0.08, -0.72));
    const tail = new THREE.ConeGeometry(0.16, 0.35, 4);
    tail.rotateX(Math.PI / 2);
    gp.add(tail, palette.metal, new THREE.Matrix4().makeTranslation(0, 0.02, 0.6));
    const bodyMesh = gp.build(toon({ vertexColors: true }), "cruise:gull", false);
    const wp = new Parts();
    wp.box(0.8, 0.04, 0.34, 0.42, 0, 0, palette.white);
    wp.box(0.32, 0.045, 0.3, 0.98, 0, 0.02, palette.inkSoft);
    const wingMesh = wp.build(toon({ vertexColors: true }), "cruise:gull-wing", false);
    const flock = [
      { cx: 0, cz: 14, r: 9, h: 12.5, w: 0.42 },
      { cx: 0, cz: 12, r: 13, h: 14.5, w: -0.33 },
      { cx: 2, cz: -4, r: 16, h: 11, w: 0.27 },
      { cx: -1, cz: -2, r: 21, h: 13.5, w: -0.22 },
      { cx: 0, cz: -24, r: 11, h: 10, w: 0.36 },
      { cx: 0, cz: 26, r: 7, h: 9.5, w: -0.48 },
    ];
    for (const f of flock) {
      const g = new THREE.Group();
      g.name = "cruise:gull";
      const b = new THREE.Mesh(bodyMesh.geometry, bodyMesh.material);
      b.castShadow = true;
      const wr = new THREE.Mesh(wingMesh.geometry, wingMesh.material);
      const wl = new THREE.Mesh(wingMesh.geometry, wingMesh.material);
      wl.scale.x = -1;
      wr.position.set(0.12, 0.06, -0.05);
      wl.position.set(-0.12, 0.06, -0.05);
      g.add(b, wr, wl);
      g.scale.setScalar(1.35);
      root.add(g);
      gulls.push({ g, wl, wr, ...f, ph: fx() * Math.PI * 2 });
    }
  }

  // The Sea Report sets the mood; the values ease toward it.
  const mood: SeaMood = { ...SEA_MOODS.calm };
  let moodTarget: SeaMood = SEA_MOODS.calm;
  const offSea = bus.on("board:sea", ({ kind }) => {
    moodTarget = SEA_MOODS[kind] ?? SEA_MOODS.calm;
  });
  /** Distance sailed (world units): drives the sea scroll and everything drifting past. */
  let sailed = 0;
  let lastT = 0;
  const capColor = new THREE.Color();
  const white = new THREE.Color(palette.white);
  const gold = new THREE.Color(palette.sun);
  const capDummy = new THREE.Object3D();
  const sailOn = (t: number, dtIn: number): void => {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(dtIn) ? dtIn : t - lastT));
    lastT = t;
    const k = 1 - Math.exp(-dt * 0.8);
    mood.speed += (moodTarget.speed - mood.speed) * k;
    mood.roll += (moodTarget.roll - mood.roll) * k;
    mood.cap += (moodTarget.cap - mood.cap) * k;
    mood.gold += (moodTarget.gold - mood.gold) * k;
    sailed += SHIP_SPEED * mood.speed * dt;

    // Swell: the world rolls and heaves against the ship.
    const R = mood.roll;
    seaRig.rotation.z = 0.0105 * R * Math.sin(t * 0.84) + 0.003 * R * Math.sin(t * 2.1 + 0.6);
    seaRig.rotation.x = 0.0055 * R * Math.sin(t * 0.63 + 1.2);
    seaRig.position.y = 0.13 * R * Math.sin(t * 1.17 + 0.4);

    // The sea runs aft (+z) beneath the ship: v grows toward the bow, so the offset grows.
    rip.offset.set(t * 0.004, sailed / SEA_TILE);

    for (const isl of islets) {
      const z = wrapRange(isl.z0 + sailed * 0.9, 260);
      isl.mesh.position.set(isl.x, CRUISE_SEA_Y - smooth(195, 255, Math.abs(z)) * 14 * isl.s, z);
    }

    capColor.copy(white).lerp(gold, mood.gold * 0.85);
    capMat.color.copy(capColor);
    capMat.opacity = Math.min(0.95, 0.5 + 0.22 * mood.cap);
    for (let i = 0; i < CAPS; i++) {
      const c = capSeeds[i];
      const z = wrapRange(c.z + sailed, CAP_Z);
      const u = (t * c.rate + c.ph) % 1;
      const life = Math.sin(u * Math.PI);
      const edge = 1 - smooth(CAP_Z - 25, CAP_Z, Math.abs(z));
      const sz = Math.max(0.001, life * edge * mood.cap);
      capDummy.position.set(c.x, CRUISE_SEA_Y + 0.05, z);
      capDummy.scale.set(c.wid * sz * 2, 1, c.len * sz * (1 + 0.15 * mood.speed));
      capDummy.updateMatrix();
      caps.setMatrixAt(i, capDummy.matrix);
    }
    caps.instanceMatrix.needsUpdate = true;

    for (const b of buoys) {
      const z = wrapRange(b.z0 + sailed, 180);
      const fade = 1 - smooth(150, 180, Math.abs(z));
      b.g.position.set(b.x, CRUISE_SEA_Y + 0.15 * Math.sin(t * 1.6 + b.ph * 6) * (0.6 + 0.5 * R), z);
      b.g.rotation.set(0.12 * Math.sin(t * 1.3 + b.ph * 5) * R, 0, 0.1 * Math.sin(t * 1.1 + b.ph * 3) * R);
      b.g.scale.setScalar(Math.max(0.001, fade));
      b.lamp.visible = (t + b.ph * 2) % 2 < 0.45;
    }

    for (const b of boats) {
      const z = wrapRange(b.z0 + sailed * b.rel, 200);
      const fade = 1 - smooth(165, 200, Math.abs(z));
      b.g.position.set(b.x, CRUISE_SEA_Y + 0.2 * Math.sin(t * 1.25 + b.ph * 6), z);
      b.g.rotation.set(0.05 * Math.sin(t * 0.9 + b.ph * 4) * R, 0, (b.x > 0 ? -1 : 1) * (0.12 + 0.04 * Math.sin(t * 0.7 + b.ph)) * (0.7 + 0.3 * mood.speed));
      b.g.scale.setScalar(1.3 * Math.max(0.001, fade));
    }

    for (const gl of gulls) {
      const a = gl.ph + t * gl.w;
      const x = gl.cx + Math.cos(a) * gl.r;
      const z = gl.cz + Math.sin(a) * gl.r;
      gl.g.position.set(x, gl.h + 0.6 * Math.sin(t * 0.9 + gl.ph), z);
      // Face along the circle (the model looks down -z), banked into the turn.
      const dir = Math.sign(gl.w);
      gl.g.rotation.set(0, Math.atan2(Math.sin(a) * dir, -Math.cos(a) * dir), dir * 0.32, "YXZ");
      // Flap in bursts, then glide.
      const glide = Math.sin(t * 0.5 + gl.ph) > 0.2;
      const flap = glide ? 0.12 + 0.05 * Math.sin(t * 2 + gl.ph) : 0.55 * Math.sin(t * 11 + gl.ph);
      gl.wr.rotation.z = flap;
      gl.wl.rotation.z = -flap;
    }
  };

  // ---- signal-flag lines and the crowd's forecastle bleachers ---------------------------
  const strands: Array<[THREE.Vector3, THREE.Vector3]> = [
    [new THREE.Vector3(0, 3.0, S.hull.bowTip + 0.9), new THREE.Vector3(0, 8.4, -30.6)],
    [new THREE.Vector3(0, 8.4, -30.6), new THREE.Vector3(0, BH + 4.3, S.bridge.z + 0.6)],
    [new THREE.Vector3(0, BH + 4.3, S.bridge.z + 0.6), new THREE.Vector3(0, funnels[0].y + 0.2, funnels[0].z)],
    [new THREE.Vector3(0, funnels[1].y + 0.2, funnels[1].z), new THREE.Vector3(0, 4.5, S.hull.sternTip - 0.9)],
  ];

  return {
    root,
    props,
    lamps,
    strands,
    bleachers: [
      { x: -3.4, z: -27.4 },
      { x: 3.4, z: -27.4 },
    ],
    setSky(top: number, horizon: number) {
      sky.set(top, horizon);
    },
    update(t: number, dt: number) {
      // The ship steams north: the sea, and everything afloat, runs aft beneath it.
      sailOn(t, dt);
      poolRip.offset.set(t * 0.02, t * 0.015);
    },
    dispose() {
      offSea();
      for (const tex of textures) tex.dispose();
    },
  };
}

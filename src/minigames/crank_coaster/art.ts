/**
 * CRANK COASTER — the shared art kit (presentation only).
 *
 * One material cache and one geometry list per round, everything disposed by
 * `kit.dispose()`. Builders for the cart, the winch with its thermometer, the
 * timber trestle, the summit hoop and the lantern live here, plus the particle
 * pools (steam, soot, sparks, nuggets, rings). No gameplay rng: the few "random"
 * looks come from a fixed local generator.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import { HILL_LEN, RAIL_X, trackAt, WINCH } from "./layout";

/* ------------------------------------------------------------------ */
/*  The kit                                                            */
/* ------------------------------------------------------------------ */

export interface Kit {
  toon(color: string): THREE.MeshToonMaterial;
  basic(color: string): THREE.MeshBasicMaterial;
  /** A flat, see-through basic material shared by colour + opacity. */
  ghost(color: string, opacity: number): THREE.MeshBasicMaterial;
  /** One toon material that reads vertex colours (merged timber). */
  vertex(): THREE.MeshToonMaterial;
  geo<T extends THREE.BufferGeometry>(g: T): T;
  tex<T extends THREE.Texture>(t: T): T;
  mat<T extends THREE.Material>(m: T): T;
  dispose(): void;
}

export function createKit(): Kit {
  const toons = new Map<string, THREE.MeshToonMaterial>();
  const basics = new Map<string, THREE.MeshBasicMaterial>();
  const ghosts = new Map<string, THREE.MeshBasicMaterial>();
  const geos: THREE.BufferGeometry[] = [];
  const texs: THREE.Texture[] = [];
  const mats: THREE.Material[] = [];
  let vertexMat: THREE.MeshToonMaterial | null = null;
  return {
    toon(color) {
      let m = toons.get(color);
      if (!m) {
        m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
        toons.set(color, m);
      }
      return m;
    },
    basic(color) {
      let m = basics.get(color);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: hex(color) });
        basics.set(color, m);
      }
      return m;
    },
    ghost(color, opacity) {
      const key = `${color}@${opacity}`;
      let m = ghosts.get(key);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: hex(color), transparent: true, opacity, depthWrite: false });
        ghosts.set(key, m);
      }
      return m;
    },
    vertex() {
      if (!vertexMat) vertexMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: celGradient });
      return vertexMat;
    },
    geo(g) {
      geos.push(g);
      return g;
    },
    tex(t) {
      texs.push(t);
      return t;
    },
    mat(m) {
      mats.push(m);
      return m;
    },
    dispose() {
      for (const m of toons.values()) m.dispose();
      for (const m of basics.values()) m.dispose();
      for (const m of ghosts.values()) m.dispose();
      vertexMat?.dispose();
      for (const m of mats) m.dispose();
      for (const g of geos) g.dispose();
      for (const t of texs) t.dispose();
      toons.clear();
      basics.clear();
      ghosts.clear();
      vertexMat = null;
      geos.length = 0;
      texs.length = 0;
      mats.length = 0;
    },
  };
}

/** Fixed local generator for looks (never a gameplay draw). */
export function lookRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** A box w x h x d centred at (x, y, z), turned by the given Euler angles. */
export function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

/** A square-section beam of thickness t from point a to point b. */
export function beam(a: THREE.Vector3, b: THREE.Vector3, t: number, t2 = t): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t2);
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d.divideScalar(len));
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Merge a handful of geometries that carry a colour each into one with vertex colours. */
export function mergeColored(parts: Array<{ geo: THREE.BufferGeometry; color: string }>): THREE.BufferGeometry {
  const prepared = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const n = g.attributes.position.count;
    const c = new THREE.Color(hex(color));
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error("crank_coaster: could not merge geometry");
  return merged;
}

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  return { c, g };
}

/** Links of chain running up the strip; one tile is two links. Tiles along v. */
export function makeChainTexture(): THREE.CanvasTexture {
  const { c, g } = canvasOf(64, 128);
  g.fillStyle = palette.ink;
  g.fillRect(0, 0, 64, 128);
  g.lineWidth = 9;
  g.strokeStyle = palette.metal;
  // A flat link (seen face on) and one turned edge on.
  g.beginPath();
  g.ellipse(32, 32, 16, 26, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = palette.metal;
  g.fillRect(25, 76, 14, 44);
  g.strokeStyle = palette.inkSoft;
  g.lineWidth = 3;
  g.strokeRect(25, 76, 14, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A soft round glow, white in the middle: tint it with the material colour. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const { c, g } = canvasOf(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A four-point glint, white. */
export function makeSparkleTexture(): THREE.CanvasTexture {
  const { c, g } = canvasOf(64, 64);
  g.translate(32, 32);
  g.fillStyle = "rgba(255,255,255,1)";
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 30 : 5;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 12);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(-16, -16, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Chunky outlined word on a transparent card (popups, signs). */
export function makeWordTexture(text: string, fill: string, w = 192, h = 112, size = 80): THREE.CanvasTexture {
  const { c, g } = canvasOf(w, h);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.font = `700 ${size}px Fredoka, sans-serif`;
  g.lineWidth = Math.round(size / 5);
  g.strokeStyle = palette.ink;
  g.strokeText(text, w / 2, h / 2 + 3);
  g.fillStyle = fill;
  g.fillText(text, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  The track and its trestle                                          */
/* ------------------------------------------------------------------ */

/** Spacing of the bents (timber frames) along the hill, in metres of track. */
export const BENT_GAP = 2.3;
/** Half width of a bent (post to centre line). */
const BENT_X = 0.72;

/**
 * The timber trestle under one lane, in lane space (x from the lane centre, y/z world).
 * A bent every BENT_GAP of track: two posts to the floor, a cap, braces to the next bent
 * and cross bracing at every third of the height.
 */
export function buildTrestleGeometry(): THREE.BufferGeometry {
  const parts: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const bents = Math.floor(HILL_LEN / BENT_GAP);
  const top = (i: number): { y: number; z: number } => trackAt(Math.min(HILL_LEN, i * BENT_GAP + 0.6));
  for (let i = 0; i <= bents; i++) {
    const p = top(i);
    const color = i % 2 ? palette.wood : palette.woodDark;
    for (const s of [-1, 1]) {
      // Posts stand a little out of true toward the back, like a real trestle.
      parts.push({ geo: beam(v(s * (BENT_X + 0.1), 0, p.z + 0.35), v(s * BENT_X, p.y - 0.3, p.z), 0.2), color });
    }
    parts.push({ geo: boxAt(BENT_X * 2 + 0.5, 0.22, 0.32, 0, p.y - 0.26, p.z), color: palette.woodDark });
    // Cross bracing at thirds of the height.
    const levels = Math.max(1, Math.round(p.y / 3.4));
    for (let l = 1; l <= levels; l++) {
      const y0 = (p.y * (l - 0.5)) / levels;
      const y1 = (p.y * l) / levels - 0.3;
      if (y1 - y0 < 0.4) continue;
      parts.push({ geo: boxAt(BENT_X * 2 + 0.1, 0.14, 0.18, 0, y1, p.z + 0.1), color: palette.wood });
      parts.push({ geo: beam(v(-BENT_X, y0, p.z + 0.12), v(BENT_X, y1, p.z + 0.12), 0.1), color: palette.wood });
      parts.push({ geo: beam(v(BENT_X, y0, p.z + 0.12), v(-BENT_X, y1, p.z + 0.12), 0.1), color: palette.wood });
    }
    // Brace to the next bent down the slope, both sides.
    if (i < bents) {
      const q = top(i + 1);
      for (const s of [-1, 1]) {
        parts.push({ geo: beam(v(s * BENT_X, Math.max(0.2, q.y - 3.2), q.z), v(s * BENT_X, p.y - 0.5, p.z), 0.12), color: palette.wood });
      }
    }
  }
  return mergeColored(parts);
}

/** Track pieces in the track frame (long axis Y): the rails, the chain bed, a summit stop. */
export function buildRailGeometry(): THREE.BufferGeometry {
  const parts: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  for (const s of [-1, 1]) {
    parts.push({ geo: boxAt(0.13, HILL_LEN + 0.6, 0.16, s * RAIL_X, HILL_LEN / 2, 0), color: palette.metal });
    parts.push({ geo: boxAt(0.2, HILL_LEN + 0.6, 0.06, s * RAIL_X, HILL_LEN / 2, -0.08), color: palette.inkSoft });
  }
  return mergeColored(parts);
}

/** One sleeper (cross-tie) in the track frame, instanced up the hill. */
export function buildSleeperGeometry(): THREE.BufferGeometry {
  return boxAt(RAIL_X * 2 + 0.55, 0.13, 0.11, 0, 0, -0.1);
}

/** The chain bed: a narrow strip between the rails whose texture scrolls with the crank. */
export function buildChainStrip(kit: Kit): { mesh: THREE.Mesh; tex: THREE.CanvasTexture } {
  const tex = kit.tex(makeChainTexture());
  tex.repeat.set(1, HILL_LEN / 0.8);
  const mat = kit.mat(new THREE.MeshBasicMaterial({ map: tex }));
  const geo = kit.geo(new THREE.PlaneGeometry(0.3, HILL_LEN));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, HILL_LEN / 2, 0.015);
  return { mesh, tex };
}

/* ------------------------------------------------------------------ */
/*  The cart                                                           */
/* ------------------------------------------------------------------ */

/** Where the level body hangs from the bogie (body centre relative to the bogie). */
export const CART_HANG = new THREE.Vector3(0, 0.98, 0.2);

export interface CartView {
  /** The level mine-cart body (and the rider's seat). */
  body: THREE.Group;
  /** The little truck that rides the rails, in the track frame. */
  bogie: THREE.Group;
  wheels: THREE.Mesh[];
  /** Where the rider sits, in the body's own space. */
  seat: THREE.Vector3;
}

/** Cart body: a tapered open box of plank panels in the seat colour with an iron rim. */
export function buildCart(kit: Kit, color: string): CartView {
  const body = new THREE.Group();
  body.name = "crank_coaster:cart";
  const wall = kit.toon(color);
  const iron = kit.toon(palette.inkSoft);
  const wood = kit.toon(palette.woodDark);
  const gold = kit.toon(palette.sun);

  // Tapered shell: a four-sided cone, square in plan, stretched to a cart's proportions.
  const shellGeo = kit.geo(new THREE.CylinderGeometry(1.0, 0.76, 0.78, 4, 1, true));
  shellGeo.rotateY(Math.PI / 4);
  const shellMat = kit.mat(new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient, side: THREE.DoubleSide }));
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.set(1.13, 1, 0.735);
  body.add(shell);
  // Floor and the plank belt round the middle.
  const floor = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(1.2, 0.08, 0.8)), wood);
  floor.position.y = -0.36;
  body.add(floor);
  const rimGeo = kit.geo(new THREE.BoxGeometry(1.7, 0.1, 0.1));
  const rimSide = kit.geo(new THREE.BoxGeometry(0.1, 0.1, 1.04));
  for (const z of [-1, 1]) {
    const r = new THREE.Mesh(rimGeo, iron);
    r.position.set(0, 0.4, z * 0.52);
    body.add(r);
  }
  for (const x of [-1, 1]) {
    const r = new THREE.Mesh(rimSide, iron);
    r.position.set(x * 0.8, 0.4, 0);
    body.add(r);
  }
  const bandGeo = kit.geo(new THREE.BoxGeometry(1.5, 0.1, 0.05));
  const band = new THREE.Mesh(bandGeo, wood);
  band.position.set(0, -0.02, 0.5);
  body.add(band);
  // A few gold nuggets heaped at the front, a nod to the mine.
  const nuggetGeo = kit.geo(new THREE.IcosahedronGeometry(0.11, 0));
  const spots: Array<[number, number, number, number]> = [
    [-0.4, 0.5, 0.5, 1],
    [-0.22, 0.54, 0.52, 0.8],
    [0.3, 0.51, 0.5, 0.95],
    [0.5, 0.49, 0.46, 0.7],
  ];
  for (const [x, y, z, s] of spots) {
    const n = new THREE.Mesh(nuggetGeo, gold);
    n.position.set(x, y, z);
    n.scale.setScalar(s);
    body.add(n);
  }
  // Struts down to the truck.
  const strutGeo = kit.geo(beam(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.07));
  for (const x of [-1, 1]) {
    const a = new THREE.Vector3(x * 0.4, -0.34, 0);
    const b = new THREE.Vector3(x * RAIL_X, -CART_HANG.y, -CART_HANG.z);
    const s = new THREE.Mesh(strutGeo, iron);
    const d = new THREE.Vector3().subVectors(b, a);
    s.position.copy(a);
    s.scale.set(1, d.length(), 1);
    s.quaternion.setFromUnitVectors(Y_AXIS, d.normalize());
    body.add(s);
  }

  // The truck: two side bars over the rails and a cross bar, four wheels, a chain hook.
  const bogie = new THREE.Group();
  const barGeo = kit.geo(new THREE.BoxGeometry(0.16, 0.9, 0.12));
  for (const x of [-1, 1]) {
    const bar = new THREE.Mesh(barGeo, iron);
    bar.position.set(x * RAIL_X, 0, 0.06);
    bogie.add(bar);
  }
  const cross = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(RAIL_X * 2, 0.14, 0.12)), iron);
  cross.position.set(0, 0, 0.08);
  bogie.add(cross);
  const wheelGeo = kit.geo(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10));
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-0.32, 0.32]) {
      const w = new THREE.Mesh(wheelGeo, kit.toon(palette.metal));
      w.position.set(x * RAIL_X, y, 0.04);
      bogie.add(w);
      wheels.push(w);
    }
  }
  // A hook that grips the chain.
  const hook = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.2, 0.3, 0.14)), kit.toon(palette.sunDeep));
  hook.position.set(0, 0, 0.0);
  bogie.add(hook);
  return { body, bogie, wheels, seat: new THREE.Vector3(0, -0.3, 0.02) };
}

/* ------------------------------------------------------------------ */
/*  The winch and its thermometer                                      */
/* ------------------------------------------------------------------ */

/** Length of the thermometer tube (heat 1 = full). */
export const TUBE_LEN = 1.7;
/** The thermometer stands this far to the right of the wheel's middle. */
export const THERMO_X = 1.02;
export const WHEEL_R = 0.8;

export interface WinchView {
  root: THREE.Group;
  /** The crank wheel: turn it about Z. */
  wheel: THREE.Group;
  /** The liquid column (scale Y by heat) and its colour. */
  liquid: THREE.Mesh;
  liquidMat: THREE.MeshBasicMaterial;
  bulb: THREE.Mesh;
  /** The warning lamp on the thermometer: red when hot, flashing when jammed. */
  lamp: THREE.Mesh;
  lampMat: THREE.MeshBasicMaterial;
  /** World-ish anchor of the wheel and of the lamp, in root space, for fx. */
  wheelAt: THREE.Vector3;
  lampAt: THREE.Vector3;
  /** A soft halo behind the wheel that glows with heat. */
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
}

export function buildWinch(kit: Kit, color: string, glowTex: THREE.Texture): WinchView {
  const root = new THREE.Group();
  root.name = "crank_coaster:winch";
  const wood = kit.toon(palette.wood);
  const dark = kit.toon(palette.woodDark);
  const own = kit.toon(color);

  // A plank deck and the two posts the axle turns in.
  const deck = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(2.4, 0.16, 1.5)), dark);
  deck.position.set(0.18, 0.08, 0);
  root.add(deck);
  const postGeo = kit.geo(new THREE.BoxGeometry(0.2, WINCH.y, 0.22));
  for (const x of [-0.62, 0.62]) {
    const p = new THREE.Mesh(postGeo, wood);
    p.position.set(x, WINCH.y / 2 + 0.1, -0.32);
    root.add(p);
  }
  const axle = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8)), kit.toon(palette.metal));
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, WINCH.y, -0.32);
  root.add(axle);

  // The wheel: rim, six spokes, a hub in the seat colour, a handle peg and knob.
  const wheel = new THREE.Group();
  wheel.position.set(0, WINCH.y, -0.1);
  const rim = new THREE.Mesh(kit.geo(new THREE.TorusGeometry(WHEEL_R, 0.09, 8, 28)), wood);
  wheel.add(rim);
  const spokeGeo = kit.geo(new THREE.BoxGeometry(0.11, WHEEL_R * 2, 0.09));
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(spokeGeo, dark);
    s.rotation.z = (i * Math.PI) / 3;
    wheel.add(s);
  }
  const hub = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 14)), own);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const peg = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6)), kit.toon(palette.metal));
  peg.rotation.x = Math.PI / 2;
  peg.position.set(0, WHEEL_R - 0.02, 0.15);
  wheel.add(peg);
  const knob = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.15, 10, 8)), kit.toon(palette.sun));
  knob.position.set(0, WHEEL_R - 0.02, 0.32);
  wheel.add(knob);
  // A seat-coloured arrow painted on the rim shows which way is up.
  const tick = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.12, 0.22, 0.12)), own);
  tick.position.set(0, -WHEEL_R, 0.02);
  wheel.add(tick);
  root.add(wheel);

  // Heat halo behind the wheel.
  const haloMat = kit.mat(new THREE.MeshBasicMaterial({ map: glowTex, color: hex(palette.lava), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  const halo = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(3.2, 3.2)), haloMat);
  halo.position.set(0, WINCH.y, -0.5);
  halo.renderOrder = 2;
  root.add(halo);

  // The thermometer: a backboard with the cool, warm and hot bands, a glass tube, the column.
  const board = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.5, TUBE_LEN + 0.8, 0.1)), wood);
  board.position.set(THERMO_X, (TUBE_LEN + 0.8) / 2 + 0.16, -0.2);
  root.add(board);
  const y0 = 0.5;
  // Cool, warm and hot lines run down either side of the tube.
  const bands: Array<[number, number, string]> = [
    [0, 0.5, palette.bubble],
    [0.5, 0.8, palette.sun],
    [0.8, 1, palette.lava],
  ];
  for (const [a, b, c] of bands) {
    const h = (b - a) * TUBE_LEN - 0.03;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.06, h, 0.04)), kit.basic(c));
      m.position.set(THERMO_X + side * 0.19, y0 + (a + b) * 0.5 * TUBE_LEN, -0.13);
      root.add(m);
    }
  }
  // A dark glass tube, so the bright column stands out in it.
  const tube = new THREE.Mesh(kit.geo(new THREE.CapsuleGeometry(0.105, TUBE_LEN - 0.2, 4, 10)), kit.basic(palette.ink));
  tube.position.set(THERMO_X, y0 + TUBE_LEN / 2, -0.09);
  root.add(tube);
  const liquidMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.bubble) }));
  const liqGeo = kit.geo(new THREE.CylinderGeometry(0.065, 0.065, TUBE_LEN, 8));
  liqGeo.translate(0, TUBE_LEN / 2, 0);
  const liquid = new THREE.Mesh(liqGeo, liquidMat);
  liquid.position.set(THERMO_X, y0, -0.04);
  liquid.scale.y = 0.001;
  root.add(liquid);
  const bulb = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.2, 12, 10)), liquidMat);
  bulb.position.set(THERMO_X, y0 - 0.04, -0.04);
  root.add(bulb);
  // Tick marks at the amber and red lines.
  for (const f of [0.5, 0.8]) {
    const t = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.38, 0.035, 0.05)), kit.basic(palette.ink));
    t.position.set(THERMO_X, y0 + f * TUBE_LEN, -0.1);
    root.add(t);
  }
  // The warning lamp on top.
  const lampMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.inkSoft) }));
  const lamp = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.17, 12, 10)), lampMat);
  lamp.position.set(THERMO_X, y0 + TUBE_LEN + 0.36, -0.1);
  root.add(lamp);
  const cap = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.1, 0.2, 0.1, 8)), kit.toon(palette.metal));
  cap.position.set(THERMO_X, y0 + TUBE_LEN + 0.2, -0.1);
  root.add(cap);

  return {
    root,
    wheel,
    liquid,
    liquidMat,
    bulb,
    lamp,
    lampMat,
    wheelAt: new THREE.Vector3(0, WINCH.y, 0),
    lampAt: new THREE.Vector3(THERMO_X, y0 + TUBE_LEN + 0.36, -0.1),
    halo,
    haloMat,
  };
}

/* ------------------------------------------------------------------ */
/*  Summit hoop, lantern, crystal                                      */
/* ------------------------------------------------------------------ */

export interface HoopView {
  root: THREE.Group;
  ring: THREE.Mesh;
  mat: THREE.MeshToonMaterial;
}

/** The golden hoop at the top of a lane: ride through it to win. */
export function buildHoop(kit: Kit): HoopView {
  const root = new THREE.Group();
  const mat = kit.mat(new THREE.MeshToonMaterial({ color: hex(palette.sun), gradientMap: celGradient, emissive: hex(palette.sunDeep), emissiveIntensity: 0.25 }));
  const ring = new THREE.Mesh(kit.geo(new THREE.TorusGeometry(1.0, 0.11, 8, 28)), mat);
  root.add(ring);
  // Two little finials either side, in the same gold.
  const post = kit.geo(new THREE.CylinderGeometry(0.06, 0.09, 0.5, 6));
  for (const x of [-1, 1]) {
    const p = new THREE.Mesh(post, mat);
    p.position.set(x * 1.0, -1.05, 0);
    root.add(p);
  }
  return { root, ring, mat };
}

export interface LanternView {
  root: THREE.Group;
  /** The glowing core. */
  core: THREE.Mesh;
  glow: THREE.Sprite;
}

/** A hanging mine lantern: iron cap and base, a warm core, a glow sprite. */
export function buildLantern(kit: Kit, glowMat: THREE.SpriteMaterial): LanternView {
  const root = new THREE.Group();
  const iron = kit.toon(palette.inkSoft);
  const core = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 6)), kit.basic(palette.lampHot));
  root.add(core);
  const capGeo = kit.geo(new THREE.ConeGeometry(0.28, 0.22, 6));
  const cap = new THREE.Mesh(capGeo, iron);
  cap.position.y = 0.32;
  root.add(cap);
  const base = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.22, 0.2, 0.08, 6)), iron);
  base.position.y = -0.25;
  root.add(base);
  const ring = new THREE.Mesh(kit.geo(new THREE.TorusGeometry(0.08, 0.02, 5, 10)), iron);
  ring.position.y = 0.5;
  root.add(ring);
  // Four thin bars round the core.
  const bar = kit.geo(new THREE.BoxGeometry(0.03, 0.44, 0.03));
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(bar, iron);
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    root.add(b);
  }
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(2.6, 2.6, 1);
  glow.renderOrder = 4;
  root.add(glow);
  return { root, core, glow };
}

/** A gold or gem crystal cluster of a few shards, merged with vertex colours. */
export function buildCrystalGeometry(rand: () => number, colors: readonly string[], shards: number): THREE.BufferGeometry {
  const parts: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  for (let i = 0; i < shards; i++) {
    const h = 0.5 + rand() * 0.8;
    const g = new THREE.ConeGeometry(0.14 + rand() * 0.08, h, 5);
    g.translate(0, h / 2, 0);
    const lean = (rand() - 0.5) * 0.9;
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(lean, rand() * 6.28, (rand() - 0.5) * 0.9)));
    g.translate((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.3);
    parts.push({ geo: g, color: colors[i % colors.length] });
  }
  return mergeColored(parts);
}

/* ------------------------------------------------------------------ */
/*  Particles                                                          */
/* ------------------------------------------------------------------ */

export interface Fx {
  /** A puff of white steam that rises and thins. */
  steam(x: number, y: number, z: number, size: number): void;
  /** Dark soot puffs from a jam. */
  soot(x: number, y: number, z: number, count: number): void;
  /** Orange sparks flung out. */
  sparks(x: number, y: number, z: number, count: number): void;
  /** Gold nuggets and confetti thrown up. */
  nuggets(x: number, y: number, z: number, count: number): void;
  /** A ring that opens facing the camera. */
  ring(x: number, y: number, z: number, size: number, color: string): void;
  update(dt: number): void;
  dispose(): void;
}

interface Bit {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  grav: number;
  spin: number;
  rot: number;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  bits: Bit[];
  next: number;
  shrink: boolean;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  size: number;
  grow: number;
  alive: boolean;
}

const SPARK_CAP = 140;
const PUFF_CAP = 90;
const SOOT_CAP = 40;
const NUGGET_CAP = 120;
const RING_CAP = 10;
const NUGGET_COLORS = [palette.sun, palette.sunDeep, palette.cream, palette.candy, palette.mint, palette.bubble, palette.sun];

export function createFx(kit: Kit, parent: THREE.Object3D): Fx {
  const root = new THREE.Group();
  root.name = "crank_coaster:fx";
  parent.add(root);
  const rand = lookRng(0xc0a5);

  const makePool = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shrink: boolean): Pool => {
    const mesh = new THREE.InstancedMesh(kit.geo(geo), mat, cap);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
    root.add(mesh);
    const bits: Bit[] = [];
    for (let i = 0; i < cap; i++) bits.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, grav: 0, spin: 0, rot: 0 });
    return { mesh, bits, next: 0, shrink };
  };
  const sparks = makePool(new THREE.IcosahedronGeometry(1, 0), kit.basic(palette.sun), SPARK_CAP, true);
  const puffs = makePool(new THREE.IcosahedronGeometry(1, 1), kit.ghost(palette.white, 0.5), PUFF_CAP, false);
  const soots = makePool(new THREE.IcosahedronGeometry(1, 1), kit.ghost(palette.ink, 0.55), SOOT_CAP, false);
  const nuggets = makePool(new THREE.PlaneGeometry(1, 0.6), kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })), NUGGET_CAP, true);
  for (let i = 0; i < NUGGET_CAP; i++) nuggets.mesh.setColorAt(i, new THREE.Color(hex(NUGGET_COLORS[i % NUGGET_COLORS.length])));

  const emit = (pool: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grav: number, spin = 0): void => {
    const b = pool.bits[pool.next];
    pool.next = (pool.next + 1) % pool.bits.length;
    b.alive = true;
    b.x = x;
    b.y = y;
    b.z = z;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.age = 0;
    b.life = life;
    b.size = size;
    b.grav = grav;
    b.spin = spin;
    b.rot = rand() * 6.28;
  };

  const ringGeo = kit.geo(new THREE.RingGeometry(0.82, 1, 40));
  const rings: Ring[] = [];
  for (let i = 0; i < RING_CAP; i++) {
    const mat = kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 5;
    root.add(mesh);
    rings.push({ mesh, mat, age: 0, life: 1, size: 1, grow: 1, alive: false });
  }
  let nextRing = 0;

  const dummy = new THREE.Object3D();
  const stepPool = (pool: Pool, dt: number): void => {
    let any = false;
    for (let i = 0; i < pool.bits.length; i++) {
      const b = pool.bits[i];
      if (!b.alive) continue;
      any = true;
      b.age += dt;
      if (b.age >= b.life) {
        b.alive = false;
        dummy.position.set(0, -50, 0);
        dummy.scale.setScalar(0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        pool.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      b.vy -= b.grav * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.rot += b.spin * dt;
      const u = b.age / b.life;
      const s = pool.shrink ? b.size * (1 - u * u) : b.size * (0.5 + u) * (1 - u * u * u);
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(Math.max(0, s));
      dummy.rotation.set(b.rot * 0.7, b.rot, b.rot * 0.4);
      dummy.updateMatrix();
      pool.mesh.setMatrixAt(i, dummy.matrix);
    }
    if (any) pool.mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    steam(x, y, z, size) {
      emit(puffs, x + (rand() - 0.5) * 0.2, y, z, (rand() - 0.5) * 0.5, 1.1 + rand() * 0.7, 0.3, 0.8 + rand() * 0.5, size, 0);
    },
    soot(x, y, z, count) {
      for (let i = 0; i < count; i++) emit(soots, x + (rand() - 0.5) * 0.7, y + rand() * 0.3, z + 0.2, (rand() - 0.5) * 1.2, 0.8 + rand() * 1.2, 0.4, 0.9 + rand() * 0.5, 0.28 + rand() * 0.2, 0);
    },
    sparks(x, y, z, count) {
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        emit(sparks, x, y, z, Math.cos(a) * (1.4 + rand() * 2.4), 1.6 + rand() * 3.2, 0.6 + rand() * 1.2, 0.45 + rand() * 0.35, 0.05 + rand() * 0.05, 9);
      }
    },
    nuggets(x, y, z, count) {
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        emit(nuggets, x, y, z, Math.cos(a) * (1.2 + rand() * 2.8), 4 + rand() * 5, 1 + rand() * 2.2, 1.5 + rand() * 0.8, 0.2 + rand() * 0.16, 7.5, (rand() - 0.5) * 12);
      }
    },
    ring(x, y, z, size, color) {
      const r = rings[nextRing];
      nextRing = (nextRing + 1) % RING_CAP;
      r.alive = true;
      r.age = 0;
      r.life = 0.7;
      r.size = size;
      r.grow = 2.4;
      r.mat.color.set(hex(color));
      r.mesh.position.set(x, y, z);
      r.mesh.visible = true;
    },
    update(dt) {
      stepPool(sparks, dt);
      stepPool(puffs, dt);
      stepPool(soots, dt);
      stepPool(nuggets, dt);
      for (const r of rings) {
        if (!r.alive) continue;
        r.age += dt;
        const u = r.age / r.life;
        if (u >= 1) {
          r.alive = false;
          r.mesh.visible = false;
          continue;
        }
        r.mesh.scale.setScalar(r.size * (0.4 + r.grow * u));
        r.mat.opacity = 0.9 * (1 - u) * (1 - u);
      }
    },
    dispose() {
      for (const pool of [sparks, puffs, soots, nuggets]) pool.mesh.dispose();
      root.removeFromParent();
    },
  };
}


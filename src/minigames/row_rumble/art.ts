/**
 * ROW ROW RUMBLE — the shared art kit (presentation only).
 *
 * One material cache and one geometry list per round, everything disposed by
 * `kit.dispose()`. Builders for the canoe, the paddle and the parrot live here, plus
 * the particle pools (paddle drops, mist, rings, confetti). No gameplay rng: the few
 * "random" looks come from a fixed local generator.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/* ------------------------------------------------------------------ */
/*  The kit                                                            */
/* ------------------------------------------------------------------ */

export interface Kit {
  toon(color: string): THREE.MeshToonMaterial;
  basic(color: string): THREE.MeshBasicMaterial;
  /** A flat, see-through basic material shared by colour + opacity. */
  ghost(color: string, opacity: number): THREE.MeshBasicMaterial;
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
      for (const m of mats) m.dispose();
      for (const g of geos) g.dispose();
      for (const t of texs) t.dispose();
      toons.clear();
      basics.clear();
      ghosts.clear();
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

function repeating(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Lengthwise streaks of lighter water on a blue base. Tiles along v. */
export function makeWaterTexture(): THREE.CanvasTexture {
  const { c, g } = canvasOf(128, 256);
  g.fillStyle = palette.bubble;
  g.fillRect(0, 0, 128, 256);
  const r = lookRng(0x77a73);
  // Soft darker bands.
  g.fillStyle = palette.bubbleDeep;
  for (let i = 0; i < 9; i++) {
    const x = r() * 128;
    const y = r() * 256;
    g.globalAlpha = 0.28;
    g.fillRect(x - 12, y - 30, 24 + r() * 14, 60 + r() * 70);
  }
  g.globalAlpha = 1;
  // Light streaks that wrap at the edges so the tile is seamless.
  g.strokeStyle = palette.foam;
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const x = r() * 128;
    const y = r() * 256;
    const len = 18 + r() * 42;
    g.globalAlpha = 0.35 + r() * 0.35;
    g.lineWidth = 2 + r() * 2.2;
    for (const oy of [-256, 0, 256]) {
      g.beginPath();
      g.moveTo(x, y + oy);
      g.quadraticCurveTo(x + (r() - 0.5) * 10, y + oy + len / 2, x + (r() - 0.5) * 6, y + oy + len);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  return repeating(c);
}

/** White-water: foam blobs and streaks on transparent. */
export function makeFoamTexture(): THREE.CanvasTexture {
  const { c, g } = canvasOf(128, 256);
  const r = lookRng(0xf0a3);
  g.fillStyle = palette.white;
  g.strokeStyle = palette.white;
  g.lineCap = "round";
  for (let i = 0; i < 34; i++) {
    const x = r() * 128;
    const y = r() * 256;
    g.globalAlpha = 0.45 + r() * 0.45;
    if (i % 3) {
      g.lineWidth = 3 + r() * 4;
      const len = 22 + r() * 50;
      for (const oy of [-256, 0, 256]) {
        g.beginPath();
        g.moveTo(x, y + oy);
        g.lineTo(x + (r() - 0.5) * 8, y + oy + len);
        g.stroke();
      }
    } else {
      const rad = 5 + r() * 9;
      for (const oy of [-256, 0, 256]) {
        g.beginPath();
        g.arc(x, y + oy, rad, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.globalAlpha = 1;
  return repeating(c);
}

/** Falling water: long vertical white and pale-blue ribbons. */
export function makeFallTexture(): THREE.CanvasTexture {
  const { c, g } = canvasOf(128, 128);
  g.fillStyle = palette.bubble;
  g.fillRect(0, 0, 128, 128);
  const r = lookRng(0xfa11);
  for (let i = 0; i < 22; i++) {
    const x = r() * 128;
    g.fillStyle = i % 2 ? palette.foam : palette.white;
    g.globalAlpha = 0.55 + r() * 0.4;
    const w = 3 + r() * 9;
    const y = r() * 128;
    const len = 40 + r() * 70;
    for (const oy of [-128, 0, 128]) g.fillRect(x - w / 2, y + oy, w, len);
  }
  g.globalAlpha = 1;
  return repeating(c);
}

/** A hanging banner: bold text on a coloured board with a checker edge. */
export function makeBannerTexture(text: string, fill: string, ink: string): THREE.CanvasTexture {
  const { c, g } = canvasOf(512, 160);
  g.fillStyle = fill;
  g.fillRect(0, 0, 512, 160);
  const cell = 16;
  for (let x = 0; x < 512; x += cell) {
    for (const [row, y] of [[0, 0], [1, 144]] as const) {
      g.fillStyle = ((x / cell + row) & 1) === 0 ? palette.ink : palette.cream;
      g.fillRect(x, y, cell, cell);
    }
  }
  g.font = "700 96px Fredoka, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 12;
  g.strokeStyle = palette.ink;
  g.strokeText(text, 256, 84);
  g.fillStyle = ink;
  g.fillText(text, 256, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  The canoe                                                          */
/* ------------------------------------------------------------------ */

/** Half-length and half-beam of the hull, and where the paddlers sit (z, forward is -z). */
export const HULL_L = 1.95;
export const HULL_B = 0.6;
export const SEAT_Z = [1.02, -0.9] as const;
const HULL_H = 0.36;
const HULL_LIFT = 0.42;

function hullPath<T extends THREE.Path>(p: T, L: number, B: number): T {
  p.moveTo(0, L);
  p.bezierCurveTo(B * 0.55, L * 0.62, B, L * 0.25, B, 0);
  p.bezierCurveTo(B, -L * 0.3, B * 0.55, -L * 0.66, 0, -L);
  p.bezierCurveTo(-B * 0.55, -L * 0.66, -B, -L * 0.3, -B, 0);
  p.bezierCurveTo(-B, L * 0.25, -B * 0.55, L * 0.62, 0, L);
  return p;
}

/** Stand a shape-built geometry up (shape y becomes -z, extrusion becomes +y) and curl the ends up. */
function uprightHull(g: THREE.BufferGeometry, lift: number): THREE.BufferGeometry {
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = Math.abs(pos.getZ(i)) / HULL_L;
    pos.setY(i, pos.getY(i) + lift * Math.pow(z, 2.4));
  }
  g.computeVertexNormals();
  return g;
}

function hullWall(inner: number, height: number, lift: number): THREE.BufferGeometry {
  const outer = hullPath(new THREE.Shape(), HULL_L, HULL_B);
  outer.holes.push(hullPath(new THREE.Path(), HULL_L * 0.94, HULL_B * inner));
  const g = new THREE.ExtrudeGeometry(outer, { depth: height, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 14 });
  return uprightHull(g, lift);
}

export interface PaddleView {
  /** Hangs from the paddler's hands; tilt (z) swings the blade out to a side. */
  root: THREE.Group;
  /** Fore-aft swing. */
  swing: THREE.Group;
  blade: THREE.Object3D;
  side: -1 | 1;
  tilt: number;
  sweep: number;
  /** Seconds since the last press on this paddle. */
  t: number;
  /** Set when the next water entry still needs its splash. */
  dip: boolean;
}

export interface CanoeView {
  /** Placed on the water and turned to the heading. */
  root: THREE.Group;
  /** Hull, paddles and flag: pitches, rolls and bobs inside `root`. */
  body: THREE.Group;
  paddles: PaddleView[];
  wake: THREE.Mesh;
  flagCloth: THREE.Mesh;
  /** Local hand positions of the paddlers (stern first). */
  hands: THREE.Vector3[];
}

export function buildPaddle(kit: Kit, shaft: string, bladeColor: string): PaddleView {
  const root = new THREE.Group();
  const swing = new THREE.Group();
  root.add(swing);
  const shaftGeo = kit.geo(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 6));
  const bladeGeo = kit.geo(new THREE.BoxGeometry(0.34, 0.62, 0.06));
  const knobGeo = kit.geo(new THREE.SphereGeometry(0.08, 8, 6));
  const s = new THREE.Mesh(shaftGeo, kit.toon(shaft));
  s.position.y = -0.7;
  const blade = new THREE.Mesh(bladeGeo, kit.toon(bladeColor));
  blade.position.y = -1.5;
  const knob = new THREE.Mesh(knobGeo, kit.toon(shaft));
  knob.position.y = 0.05;
  swing.add(s, blade, knob);
  return { root, swing, blade, side: 1, tilt: 0.7, sweep: 0, t: 9, dip: false };
}

export function buildCanoe(kit: Kit, hull: string, trim: string): CanoeView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const wall = new THREE.Mesh(kit.geo(hullWall(0.74, HULL_H, HULL_LIFT)), kit.toon(hull));
  body.add(wall);
  // A pale rim along the top edge.
  const rimOuter = hullPath(new THREE.Shape(), HULL_L, HULL_B);
  rimOuter.holes.push(hullPath(new THREE.Path(), HULL_L * 0.94, HULL_B * 0.8));
  const rimGeo = kit.geo(uprightHull(new THREE.ExtrudeGeometry(rimOuter, { depth: 0.05, bevelEnabled: false, curveSegments: 14 }), HULL_LIFT));
  const rim = new THREE.Mesh(rimGeo, kit.toon(trim));
  rim.position.y = HULL_H + 0.03;
  body.add(rim);
  // The floor, a little inside the bottom.
  const floorGeo = kit.geo(uprightHull(new THREE.ShapeGeometry(hullPath(new THREE.Shape(), HULL_L * 0.94, HULL_B * 0.74), 14), HULL_LIFT * 0.9));
  const floor = new THREE.Mesh(floorGeo, kit.toon(palette.woodDark));
  floor.position.y = 0.09;
  body.add(floor);
  // Thwarts across the hull, and bow and stern caps.
  const thwartGeo = kit.geo(new THREE.BoxGeometry(HULL_B * 1.7, 0.07, 0.14));
  for (const z of [0.05, 1.45, -1.3]) {
    const t = new THREE.Mesh(thwartGeo, kit.toon(palette.wood));
    t.position.set(0, 0.3 + Math.pow(Math.abs(z) / HULL_L, 2.4) * HULL_LIFT, z);
    body.add(t);
  }
  const capGeo = kit.geo(new THREE.ConeGeometry(0.17, 0.45, 8));
  for (const dir of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, kit.toon(trim));
    cap.rotation.x = dir * (Math.PI / 2 + 0.25);
    cap.position.set(0, HULL_LIFT + 0.2, dir * (HULL_L + 0.12));
    body.add(cap);
  }
  // A pennant on a pole at the bow in the team's colour.
  const pole = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5)), kit.toon(palette.woodDark));
  pole.position.set(0, HULL_LIFT + 0.75, -HULL_L + 0.1);
  body.add(pole);
  const clothGeo = kit.geo(new THREE.PlaneGeometry(0.6, 0.34));
  clothGeo.translate(0.3, 0, 0);
  const flagCloth = new THREE.Mesh(clothGeo, kit.mat(new THREE.MeshBasicMaterial({ color: hex(hull), side: THREE.DoubleSide })));
  flagCloth.position.set(0, HULL_LIFT + 1.12, -HULL_L + 0.1);
  body.add(flagCloth);

  // Foam V behind the bow, flat on the water. Scaled by speed.
  const wakeGeo = kit.geo(new THREE.BufferGeometry());
  wakeGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        // left arm
        -0.35, 0, -1.7, -0.7, 0, -1.7, -2.1, 0, 2.6, -1.6, 0, 2.6,
        // right arm
        0.35, 0, -1.7, 0.7, 0, -1.7, 2.1, 0, 2.6, 1.6, 0, 2.6,
      ],
      3,
    ),
  );
  wakeGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  const wake = new THREE.Mesh(wakeGeo, kit.ghost(palette.white, 0.55));
  wake.position.y = 0.04;
  wake.renderOrder = 2;
  root.add(wake);

  const hands = SEAT_Z.map((z) => new THREE.Vector3(0, 1.0, z));
  const paddles = [0, 1].map(() => {
    const p = buildPaddle(kit, palette.bark, trim);
    body.add(p.root);
    return p;
  });
  return { root, body, paddles, wake, flagCloth, hands };
}

/* ------------------------------------------------------------------ */
/*  Parrots                                                            */
/* ------------------------------------------------------------------ */

export interface ParrotView {
  root: THREE.Group;
  wings: [THREE.Group, THREE.Group];
  tail: THREE.Object3D;
}

const PARROT_COLORS: ReadonlyArray<readonly [string, string, string]> = [
  [palette.lava, palette.bubble, palette.sun],
  [palette.mint, palette.sun, palette.lava],
  [palette.sun, palette.berry, palette.lava],
  [palette.candy, palette.bubble, palette.sun],
  [palette.bubble, palette.sun, palette.mint],
];

export function buildParrot(kit: Kit, variant: number): ParrotView {
  const [body, wing, tailC] = PARROT_COLORS[variant % PARROT_COLORS.length];
  const root = new THREE.Group();
  const bodyGeo = kit.geo(new THREE.SphereGeometry(1, 10, 8));
  const b = new THREE.Mesh(bodyGeo, kit.toon(body));
  b.scale.set(0.2, 0.22, 0.36);
  root.add(b);
  const head = new THREE.Mesh(bodyGeo, kit.toon(body));
  head.scale.setScalar(0.15);
  head.position.set(0, 0.17, -0.3);
  root.add(head);
  const beak = new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.06, 0.16, 6)), kit.toon(palette.cream));
  beak.rotation.x = -Math.PI / 2 - 0.5;
  beak.position.set(0, 0.15, -0.44);
  root.add(beak);
  const eyeGeo = kit.geo(new THREE.SphereGeometry(0.03, 6, 5));
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, kit.basic(palette.ink));
    eye.position.set(sx * 0.1, 0.2, -0.38);
    root.add(eye);
  }
  const tail = new THREE.Mesh(kit.geo(new THREE.ConeGeometry(0.09, 0.62, 5)), kit.toon(tailC));
  tail.rotation.x = Math.PI / 2 + 0.2;
  tail.position.set(0, -0.06, 0.62);
  root.add(tail);
  const wingGeo = kit.geo(new THREE.BoxGeometry(0.62, 0.04, 0.34));
  wingGeo.translate(0.31, 0, 0);
  const wings = [-1, 1].map((sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.12, 0.08, -0.04);
    const w = new THREE.Mesh(wingGeo, kit.toon(wing));
    w.scale.x = sx;
    pivot.add(w);
    root.add(pivot);
    return pivot;
  }) as [THREE.Group, THREE.Group];
  return { root, wings, tail };
}

/* ------------------------------------------------------------------ */
/*  Particles                                                          */
/* ------------------------------------------------------------------ */

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
  /** 1: shrink over life. 0: grow then shrink (mist). */
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

export interface Fx {
  /** Water droplets thrown up and out of a paddle stroke. */
  splash(x: number, y: number, z: number, power: number, side: number): void;
  /** A ring that opens on the water. */
  ring(x: number, y: number, z: number, size: number, color: string): void;
  /** A burst of droplets and foam for a collision. */
  crash(x: number, y: number, z: number, dir: number): void;
  /** A few puffs that rise and fade (waterfall mist, bow spray). */
  mist(x: number, y: number, z: number, size: number, rise: number): void;
  /** A little spray off the bow. */
  spray(x: number, y: number, z: number, vz: number): void;
  confetti(x: number, y: number, z: number, count: number): void;
  update(dt: number): void;
  dispose(): void;
}

const DROP_CAP = 180;
const MIST_CAP = 70;
const CONFETTI_CAP = 90;
const RING_CAP = 14;
const CONFETTI_COLORS = [palette.sun, palette.candy, palette.mint, palette.bubble, palette.berry, palette.lava, palette.cream];

export function createFx(kit: Kit, parent: THREE.Object3D): Fx {
  const root = new THREE.Group();
  root.name = "row_rumble:fx";
  parent.add(root);
  const rand = lookRng(0x5a1a);

  const makePool = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shrink: boolean): Pool => {
    const mesh = new THREE.InstancedMesh(kit.geo(geo), mat, cap);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, zero);
    root.add(mesh);
    const bits: Bit[] = [];
    for (let i = 0; i < cap; i++) {
      bits.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, grav: 0, spin: 0, rot: 0 });
    }
    return { mesh, bits, next: 0, shrink };
  };
  const drops = makePool(new THREE.IcosahedronGeometry(1, 0), kit.basic(palette.white), DROP_CAP, true);
  const mists = makePool(new THREE.IcosahedronGeometry(1, 1), kit.ghost(palette.white, 0.5), MIST_CAP, false);
  const confetti = makePool(new THREE.PlaneGeometry(1, 0.6), kit.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })), CONFETTI_CAP, true);
  for (let i = 0; i < CONFETTI_CAP; i++) confetti.mesh.setColorAt(i, new THREE.Color(hex(CONFETTI_COLORS[i % CONFETTI_COLORS.length])));

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

  const ringGeo = kit.geo(new THREE.RingGeometry(0.82, 1, 36));
  ringGeo.rotateX(-Math.PI / 2);
  const rings: Ring[] = [];
  for (let i = 0; i < RING_CAP; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    kit.mat(mat);
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 3;
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
    splash(x, y, z, power, side) {
      const n = 5 + Math.round(power * 5);
      for (let i = 0; i < n; i++) {
        emit(drops, x + (rand() - 0.5) * 0.3, y, z + (rand() - 0.5) * 0.4, side * (0.5 + rand() * 1.5), 2.2 + rand() * 2.4 * (0.6 + power), (rand() - 0.5) * 1.6, 0.5 + rand() * 0.3, 0.07 + rand() * 0.06, 11);
      }
      emit(mists, x, y + 0.1, z, side * 0.3, 0.8, 0, 0.55, 0.28 + power * 0.14, 0);
    },
    ring(x, y, z, size, color) {
      const r = rings[nextRing];
      nextRing = (nextRing + 1) % RING_CAP;
      r.alive = true;
      r.age = 0;
      r.life = 0.6;
      r.size = size;
      r.grow = 2.3;
      r.mat.color.set(hex(color));
      r.mesh.position.set(x, y, z);
      r.mesh.visible = true;
    },
    crash(x, y, z, dir) {
      for (let i = 0; i < 22; i++) {
        const a = rand() * Math.PI * 2;
        emit(drops, x, y + 0.2, z, Math.cos(a) * 2.4 + dir * 1.8, 3 + rand() * 3.6, Math.sin(a) * 2.4, 0.6 + rand() * 0.4, 0.09 + rand() * 0.08, 10);
      }
      for (let i = 0; i < 5; i++) emit(mists, x + (rand() - 0.5) * 0.8, y + 0.2, z + (rand() - 0.5) * 0.8, dir * 0.8, 1 + rand(), 0, 0.7, 0.4 + rand() * 0.25, 0);
    },
    mist(x, y, z, size, rise) {
      emit(mists, x, y, z, (rand() - 0.5) * 0.6, rise, (rand() - 0.5) * 0.6, 0.9 + rand() * 0.5, size, 0);
    },
    spray(x, y, z, vz) {
      for (let i = 0; i < 2; i++) {
        emit(drops, x + (rand() - 0.5) * 0.4, y, z, (rand() - 0.5) * 2.6, 1.4 + rand() * 1.4, vz * 0.3 + (rand() - 0.5), 0.35 + rand() * 0.2, 0.05 + rand() * 0.05, 9);
      }
    },
    confetti(x, y, z, count) {
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        emit(confetti, x, y, z, Math.cos(a) * (1.5 + rand() * 3), 4 + rand() * 5, Math.sin(a) * (1.5 + rand() * 3), 1.6 + rand() * 0.8, 0.22 + rand() * 0.16, 7, (rand() - 0.5) * 12);
      }
    },
    update(dt) {
      stepPool(drops, dt);
      stepPool(mists, dt);
      stepPool(confetti, dt);
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
        r.mat.opacity = 0.85 * (1 - u) * (1 - u);
      }
    },
    dispose() {
      for (const pool of [drops, mists, confetti]) pool.mesh.dispose();
      for (const r of rings) r.mat.dispose();
      root.removeFromParent();
    },
  };
}

/** Merge a handful of geometries that carry vertex colours into one. */
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
  if (!merged) throw new Error("row_rumble: could not merge geometry");
  return merged;
}

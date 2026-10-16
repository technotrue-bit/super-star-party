/**
 * ROW ROW RUMBLE — the jungle river (presentation only).
 *
 * A winding-free but lively river runs down the -z axis: calm reaches, three
 * stretches of white-water rapids studded with mossy boulders, and three
 * waterfalls the canoes ride down. Steep jungle banks rise on both sides with
 * palms, broadleaf trees, bamboo, ferns, flowers, lily pads and swaying vines;
 * parrots perch on branches over the water and take off as the leader nears.
 * A bamboo start gate and a banner-and-flag finish arch frame the course.
 *
 * No gameplay rng: every placement comes from a fixed local generator and
 * everything that moves is a function of the clocks handed to `update`.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { makeSkyTexture } from "../framing";
import { celGradient } from "../../characters/cel";
import {
  FALLS,
  RAPIDS,
  COURSE_LEN,
  riverY,
  rapidsAt,
  type Course,
} from "./rules";
import {
  buildParrot,
  lookRng,
  makeBannerTexture,
  makeFallTexture,
  makeFoamTexture,
  makeWaterTexture,
  mergeColored,
  type Fx,
  type Kit,
  type ParrotView,
} from "./art";

/** The river is this wide (x from -WATER_HALF to +WATER_HALF). */
export const WATER_HALF = 5.7;
/** Rows of the world, in metres down the river. */
export const WORLD_START = -34;
export const WORLD_END = COURSE_LEN + 70;

/** Terrain columns: distance from the river's middle, height above the water, and noise. */
const COL_X = [5.3, 6.2, 8, 11, 16, 24, 36, 55, 80];
const COL_H = [-0.12, 0.5, 0.95, 1.9, 3.3, 5.4, 8.6, 12.2, 17];
const COL_AMP = [0, 0.05, 0.25, 0.5, 0.9, 1.3, 1.8, 2.2, 2.6];
const COL_COLOR = [palette.sand, palette.cliffDirt, palette.leaf, palette.leafDeep, palette.leafPine, palette.leafDeep, palette.leafPine, palette.leafDeep, palette.leafPine];

const noiseAt = (s: number, side: number, c: number): number =>
  Math.sin(s * 0.29 + side * 1.7 + c * 2.1) * 0.6 + Math.sin(s * 0.11 + c * 0.9 + side) * 0.4;

/** Ground height at distance `ax` from the river's middle on side -1 or +1. */
export function terrainY(s: number, ax: number, side: number): number {
  let c = 0;
  while (c < COL_X.length - 2 && ax > COL_X[c + 1]) c++;
  const u = Math.max(0, Math.min(1, (ax - COL_X[c]) / (COL_X[c + 1] - COL_X[c])));
  const h0 = COL_H[c] + COL_AMP[c] * noiseAt(s, side, c);
  const h1 = COL_H[c + 1] + COL_AMP[c + 1] * noiseAt(s, side, c + 1);
  return riverY(s) + h0 + (h1 - h0) * u;
}

/** Distance down the river for every row of the world: fine through the falls. */
function rowList(): number[] {
  const rows: number[] = [];
  let s = WORLD_START;
  while (s <= WORLD_END) {
    rows.push(s);
    const nearFall = FALLS.some((f) => s > f.s - 3 && s < f.s + f.len + 3);
    s += nearFall ? 0.5 : 2;
  }
  return rows;
}

export interface JungleEnvironment {
  /** Presentation clock t, frame dt, and how far down the river the leader is. */
  update(t: number, dt: number, leaderS: number): void;
  /** The winner crossed the line: parrots take off in a party and the arch flares. */
  celebrate(): void;
  dispose(): void;
}

interface Parrot {
  view: ParrotView;
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** s at which the leader sets it off. */
  triggerS: number;
  /** Presentation time of take-off, else -1. */
  flewAt: number;
  dur: number;
  phase: number;
  /** Time the finish party began for this bird, else -1. */
  partyAt: number;
  from: THREE.Vector3;
}

export function buildJungle(
  scene: THREE.Scene,
  parent: THREE.Object3D,
  kit: Kit,
  fx: Fx,
  course: Course,
): JungleEnvironment {
  const root = new THREE.Group();
  root.name = "row_rumble:environment";
  parent.add(root);
  const rand = lookRng(0x6a61);
  const rows = rowList();

  // Sky and haze.
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  const sky = kit.tex(makeSkyTexture(palette.skyTop, palette.skyHorizon));
  scene.background = sky;
  scene.fog = new THREE.Fog(hex(palette.skyHorizon), 46, 150);

  /* ---------------- water ---------------- */
  const waterTex = kit.tex(makeWaterTexture());
  const foamTex = kit.tex(makeFoamTexture());
  const fallTex = kit.tex(makeFallTexture());
  foamTex.repeat.set(1, 1);

  /** A ribbon over [s0, s1] at the given x columns, y following the river. */
  const ribbon = (s0: number, s1: number, xs: number[], yOff: number, uScale: number, vScale: number, step = 1): THREE.BufferGeometry => {
    const list: number[] = [];
    for (let s = s0; s < s1; s += step) list.push(s);
    list.push(s1);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < xs.length; j++) {
        pos.push(xs[j], riverY(list[i]) + yOff, -list[i]);
        uv.push(xs[j] / uScale, list[i] / vScale);
      }
    }
    const w = xs.length;
    for (let i = 0; i < list.length - 1; i++) {
      for (let j = 0; j < w - 1; j++) {
        const a = i * w + j;
        idx.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
      }
    }
    const g = kit.geo(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  waterTex.repeat.set(1, 1);
  const waterMat = kit.mat(new THREE.MeshBasicMaterial({ map: waterTex }));
  const waterGeo = kit.geo(new THREE.BufferGeometry());
  {
    // One continuous sheet through all rows (fine steps through the falls).
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const xs = [-WATER_HALF, 0, WATER_HALF];
    for (const s of rows) for (const x of xs) {
      pos.push(x, riverY(s), -s);
      uv.push(x / 6, s / 12);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < 2; j++) {
        const a = i * 3 + j;
        idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
    waterGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    waterGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    waterGeo.setIndex(idx);
    waterGeo.computeVertexNormals();
  }
  const water = new THREE.Mesh(waterGeo, waterMat);
  root.add(water);

  // White water over the rapids.
  const rapidMat = kit.mat(new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.8, depthWrite: false }));
  for (const [a, b] of RAPIDS) {
    const m = new THREE.Mesh(ribbon(a - 3, b + 3, [-WATER_HALF + 0.4, 0, WATER_HALF - 0.4], 0.05, 5, 12, 2), rapidMat);
    m.renderOrder = 1;
    root.add(m);
  }
  // The falls: a fast white-and-blue sheet down each drop.
  const fallMat = kit.mat(new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.92, depthWrite: false }));
  const lipMat = kit.mat(new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.95, depthWrite: false }));
  const fallBases: THREE.Vector3[] = [];
  for (const f of FALLS) {
    const sheet = new THREE.Mesh(ribbon(f.s - 0.6, f.s + f.len + 0.8, [-WATER_HALF + 0.2, 0, WATER_HALF - 0.2], 0.08, 3, 6, 0.5), fallMat);
    sheet.renderOrder = 2;
    root.add(sheet);
    const foot = new THREE.Mesh(ribbon(f.s + f.len - 1, f.s + f.len + 7, [-WATER_HALF + 0.2, 0, WATER_HALF - 0.2], 0.07, 5, 12, 1), lipMat);
    foot.renderOrder = 2;
    root.add(foot);
    fallBases.push(new THREE.Vector3(0, riverY(f.s + f.len), -(f.s + f.len + 0.8)));
  }

  /* ---------------- banks ---------------- */
  {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const tmp = new THREE.Color();
    const stone = new THREE.Color(hex(palette.cliffStone));
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (const s of rows) {
        const fall = FALLS.reduce((m, f) => Math.max(m, 1 - Math.min(1, Math.max(0, Math.abs(s - (f.s + f.len / 2)) - 4) / 7)), 0);
        for (let c = 0; c < COL_X.length; c++) {
          pos.push(side * COL_X[c], terrainY(s, COL_X[c], side), -s);
          tmp.set(hex(COL_COLOR[c]));
          if (c >= 1 && c <= 4) tmp.lerp(stone, fall * 0.8);
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
      const w = COL_X.length;
      for (let i = 0; i < rows.length - 1; i++) {
        for (let c = 0; c < w - 1; c++) {
          const a = base + i * w + c;
          if (side > 0) idx.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
          else idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
        }
      }
    }
    const g = kit.geo(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const banks = new THREE.Mesh(g, kit.mat(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: celGradient, side: THREE.DoubleSide })));
    root.add(banks);
  }

  /* ---------------- instanced greenery ---------------- */
  const dummy = new THREE.Object3D();
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh => {
    const m = new THREE.InstancedMesh(kit.geo(geo), mat, count);
    m.frustumCulled = false;
    root.add(m);
    return m;
  };
  const tint = new THREE.Color();
  const setAt = (m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0, color?: string): void => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(rx, ry, rz);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    if (color) m.setColorAt(i, tint.set(hex(color)));
  };
  const vcolorToon = kit.mat(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: celGradient }));
  const greens = [palette.leaf, palette.leafDeep, palette.leafPine, palette.grassB, palette.mint];

  // Placements along both banks.
  interface Spot { s: number; side: number; ax: number; y: number }
  const spot = (s: number, side: number, ax: number): Spot => ({ s, side, ax, y: terrainY(s, ax, side) });
  const palms: Spot[] = [];
  const trees: Spot[] = [];
  const bushes: Spot[] = [];
  const bamboo: Spot[] = [];
  for (let s = WORLD_START + 2; s < WORLD_END; s += 3.2) {
    for (const side of [-1, 1]) {
      const r = rand();
      if (r < 0.38) palms.push(spot(s + rand() * 2, side, 7 + rand() * 10));
      else if (r < 0.62) trees.push(spot(s + rand() * 2, side, 8 + rand() * 13));
      if (rand() < 0.5) bushes.push(spot(s + rand() * 3, side, 5.9 + rand() * 3.6));
      if (rand() < 0.2) bamboo.push(spot(s + rand() * 3, side, 7 + rand() * 6));
      if (rand() < 0.3) trees.push(spot(s + rand() * 3, side, 20 + rand() * 30));
    }
  }

  // Palms: a leaning trunk and a crown of drooping fronds.
  {
    const trunkGeo = new THREE.CylinderGeometry(0.17, 0.3, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = instanced(trunkGeo, kit.toon(palette.bark), palms.length);
    const frondGeo = new THREE.PlaneGeometry(0.62, 2.5, 1, 5);
    frondGeo.translate(0, 1.25, 0);
    const fp = frondGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const y = fp.getY(i);
      fp.setZ(i, 0.2 * y * y);
      const k = 1 - Math.abs(y - 1.25) / 1.25;
      fp.setX(i, fp.getX(i) * (0.35 + 0.65 * Math.sin(Math.min(1, Math.max(0, y / 2.5)) * Math.PI)) * (0.7 + 0.3 * k));
    }
    frondGeo.computeVertexNormals();
    const FRONDS = 7;
    const fronds = instanced(frondGeo, new THREE.MeshToonMaterial({ gradientMap: celGradient, side: THREE.DoubleSide }), palms.length * FRONDS);
    kit.mat(fronds.material as THREE.Material);
    palms.forEach((p, i) => {
      const h = 3.6 + rand() * 3.4;
      const lean = (rand() - 0.5) * 0.3 - p.side * 0.1;
      setAt(trunks, i, p.side * p.ax, p.y - 0.2, -p.s, 1, h, 1, 0, 0, lean);
      const top = new THREE.Vector3(p.side * p.ax - Math.sin(lean) * h, p.y - 0.2 + Math.cos(lean) * h, -p.s);
      for (let k = 0; k < FRONDS; k++) {
        const yaw = (k / FRONDS) * Math.PI * 2 + rand() * 0.4;
        dummy.position.copy(top);
        dummy.rotation.set(0, 0, 0);
        dummy.rotateY(yaw);
        dummy.rotateX(1.05 + rand() * 0.35);
        dummy.scale.setScalar(0.85 + rand() * 0.5);
        dummy.updateMatrix();
        fronds.setMatrixAt(i * FRONDS + k, dummy.matrix);
        fronds.setColorAt(i * FRONDS + k, tint.set(hex(greens[(i + k) % 3])));
      }
    });
  }

  // Broadleaf trees: a trunk and two or three round crowns.
  {
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.5, 1, 7);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = instanced(trunkGeo, kit.toon(palette.bark), trees.length);
    const crowns = instanced(new THREE.IcosahedronGeometry(1, 1), kit.toon(palette.leaf), trees.length * 3);
    trees.forEach((p, i) => {
      const h = 3.5 + rand() * 4.5 + (p.ax > 18 ? 4 : 0);
      setAt(trunks, i, p.side * p.ax, p.y - 0.3, -p.s, 1, h, 1);
      const R = 1.7 + rand() * 1.4;
      for (let k = 0; k < 3; k++) {
        const a = rand() * Math.PI * 2;
        const off = k === 0 ? 0 : 0.9 + rand() * 0.8;
        setAt(crowns, i * 3 + k, p.side * p.ax + Math.cos(a) * off, p.y + h + (k === 0 ? 0.6 : 0.1 + rand() * 0.6), -p.s + Math.sin(a) * off, R * 1.1, R * (0.8 + rand() * 0.2), R * 1.1, 0, rand() * 3, 0, greens[(i + k) % greens.length]);
      }
    });
  }

  // Bushes, ferns and flowers at the water's edge.
  {
    const bushGeo = new THREE.IcosahedronGeometry(1, 1);
    const bush = instanced(bushGeo, kit.toon(palette.leaf), bushes.length);
    const flowerGeo = new THREE.IcosahedronGeometry(1, 0);
    const flowers = instanced(flowerGeo, kit.toon(palette.candy), bushes.length * 2);
    const flowerColors = [palette.candy, palette.sun, palette.white, palette.bubble, palette.lava];
    bushes.forEach((p, i) => {
      const r = 0.45 + rand() * 0.6;
      const x = p.side * p.ax;
      setAt(bush, i, x, p.y + r * 0.35, -p.s, r * 1.2, r * 0.8, r * 1.1, 0, rand() * 3, 0, greens[i % greens.length]);
      for (let k = 0; k < 2; k++) {
        const a = rand() * Math.PI * 2;
        const fr = 0.11 + rand() * 0.06;
        setAt(flowers, i * 2 + k, x + Math.cos(a) * r * 0.9, p.y + r * (0.5 + rand() * 0.4), -p.s + Math.sin(a) * r * 0.9, fr, fr, fr, 0, 0, 0, flowerColors[(i + k) % flowerColors.length]);
      }
    });
  }

  // Bamboo clumps.
  {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 1, 5);
    poleGeo.translate(0, 0.5, 0);
    const poles = instanced(poleGeo, kit.toon(palette.leaf), bamboo.length * 5);
    bamboo.forEach((p, i) => {
      for (let k = 0; k < 5; k++) {
        const h = 5 + rand() * 4;
        setAt(poles, i * 5 + k, p.side * p.ax + (rand() - 0.5) * 1.1, p.y - 0.1, -p.s + (rand() - 0.5) * 1.1, 1, h, 1, (rand() - 0.5) * 0.14, 0, (rand() - 0.5) * 0.14, k % 2 ? palette.mint : palette.leaf);
      }
    });
  }

  /* ---------------- gameplay boulders ---------------- */
  const rockBody = instanced(new THREE.DodecahedronGeometry(1, 0), kit.toon(palette.rock), course.rocks.length + 40);
  const rockMoss = instanced(new THREE.SphereGeometry(1, 8, 6), kit.toon(palette.leaf), course.rocks.length);
  const rockFoam = instanced(new THREE.RingGeometry(0.9, 1.3, 20).rotateX(-Math.PI / 2), kit.ghost(palette.white, 0.7), course.rocks.length);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, 0, 1], 3));
  trailGeo.setIndex([0, 2, 1]);
  const rockTrail = instanced(trailGeo, kit.ghost(palette.white, 0.38), course.rocks.length);
  course.rocks.forEach((rk, i) => {
    const y = riverY(rk.s);
    const squash = 0.8 + ((i * 37) % 10) / 40;
    setAt(rockBody, i, rk.x, y + rk.r * 0.1, -rk.s, rk.r * 1.05, rk.r * squash, rk.r * 1.05, 0.2 * (i % 3), i * 1.3, 0.15 * (i % 2), i % 3 === 0 ? palette.cliffStone : palette.rock);
    setAt(rockMoss, i, rk.x, y + rk.r * (0.1 + squash * 0.62), -rk.s, rk.r * 0.8, rk.r * 0.35, rk.r * 0.8);
    setAt(rockFoam, i, rk.x, y + 0.06, -rk.s, rk.r * 1.15, 1, rk.r * 1.15);
    setAt(rockTrail, i, rk.x, y + 0.06, -rk.s, rk.r * 1.5, 1, 1.8 + rk.r * 1.6, 0, Math.PI);
  });
  // Scenery boulders by the falls and along the banks.
  {
    let n = course.rocks.length;
    const put = (s: number, side: number, ax: number, r: number): void => {
      if (n >= course.rocks.length + 40) return;
      setAt(rockBody, n, side * ax, terrainY(s, ax, side) + r * 0.2, -s, r * 1.2, r * 0.9, r, rand(), rand() * 3, 0, rand() < 0.5 ? palette.cliffStone : palette.rock);
      n++;
    };
    for (const f of FALLS) {
      for (const side of [-1, 1]) {
        put(f.s - 1, side, 5.5 + rand(), 1 + rand() * 0.5);
        put(f.s + f.len * 0.5, side, 5.4 + rand() * 0.5, 1.3 + rand() * 0.6);
        put(f.s + f.len + 2, side, 5.8 + rand(), 0.9 + rand() * 0.5);
      }
    }
    // Hide any unused slots.
    for (; n < course.rocks.length + 40; n++) setAt(rockBody, n, 0, -80, 0, 0, 0, 0);
  }

  // Standing waves in the rapids: low white humps that pulse.
  const humps: { mesh: THREE.InstancedMesh; base: Array<[number, number, number, number]> } = (() => {
    const base: Array<[number, number, number, number]> = [];
    for (const [a, b] of RAPIDS) {
      for (let s = a; s < b; s += 2.2) {
        base.push([(rand() - 0.5) * 8.4, s + rand() * 1.5, 0.35 + rand() * 0.35, rand() * 6.28]);
      }
    }
    const mesh = instanced(new THREE.SphereGeometry(1, 8, 5), kit.ghost(palette.white, 0.7), base.length);
    return { mesh, base };
  })();

  // Lily pads and flowers on the calm water by the banks.
  {
    const pads: Array<[number, number]> = [];
    for (let s = 6; s < COURSE_LEN; s += 3.1) {
      if (rapidsAt(s) > 0.05 || FALLS.some((f) => s > f.s - 8 && s < f.s + f.len + 8)) continue;
      if (rand() < 0.55) pads.push([(rand() < 0.5 ? -1 : 1) * (3.9 + rand() * 1.1), s + rand() * 2]);
    }
    const padGeo = new THREE.CircleGeometry(0.55, 10).rotateX(-Math.PI / 2);
    const padMesh = instanced(padGeo, kit.basic(palette.leafDeep), pads.length);
    const bloom = instanced(new THREE.IcosahedronGeometry(0.15, 0), kit.toon(palette.candy), pads.length);
    pads.forEach(([x, s], i) => {
      setAt(padMesh, i, x, riverY(s) + 0.04, -s, 1 + rand() * 0.5, 1, 1 + rand() * 0.5, 0, rand() * 6);
      setAt(bloom, i, x + 0.1, riverY(s) + 0.14, -s, 1, 1, 1, 0, 0, 0, i % 3 === 0 ? palette.sun : i % 3 === 1 ? palette.candy : palette.white);
    });
  }

  /* ---------------- vines and branches ---------------- */
  interface Vine { x: number; y: number; z: number; len: number; phase: number }
  const vines: Vine[] = [];
  const branches: Array<{ x: number; y: number; s: number; side: number }> = [];
  for (let s = 2; s < COURSE_LEN + 12; s += 5.5) {
    for (const side of [-1, 1]) {
      if (rand() < 0.62) {
        const x = side * (5.1 + rand() * 1.3);
        const y = riverY(s) + 4.1 + rand() * 1.2;
        branches.push({ x, y, s, side });
        const n = 1 + (rand() < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) vines.push({ x: x + (rand() - 0.5) * 0.9, y: y - 0.1, z: -(s + (rand() - 0.5) * 1.6), len: 1.8 + rand() * 1.8, phase: rand() * 6.28 });
      }
    }
  }
  // Each branch: a limb from the bank and a small leafy tuft.
  {
    const limbGeo = new THREE.CylinderGeometry(0.1, 0.17, 1, 5);
    limbGeo.rotateZ(Math.PI / 2);
    limbGeo.translate(0.5, 0, 0);
    const limbs = instanced(limbGeo, kit.toon(palette.bark), branches.length);
    const tufts = instanced(new THREE.IcosahedronGeometry(1, 1), kit.toon(palette.leafDeep), branches.length);
    branches.forEach((b, i) => {
      // The limb runs from deep in the bank out toward the river, ending at the tuft.
      const reach = 4.6;
      const x0 = b.side * (b.x * b.side + reach);
      setAt(limbs, i, x0, b.y, -b.s, reach, 1, 1, 0, b.side > 0 ? Math.PI : 0, 0);
      setAt(tufts, i, b.x, b.y + 0.15, -b.s, 0.7, 0.55, 0.7, 0, 0, 0, greens[i % greens.length]);
    });
  }
  const vineGeo = (() => {
    // A drooping tube with a few leaves, top at the origin, hanging down -y.
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, -0.35, 0.03), new THREE.Vector3(-0.06, -0.7, -0.02), new THREE.Vector3(0.05, -1, 0.02)]);
    const parts: Array<{ geo: THREE.BufferGeometry; color: string }> = [{ geo: new THREE.TubeGeometry(curve, 6, 0.045, 5, false), color: palette.leafDeep }];
    for (let k = 0; k < 4; k++) {
      const leaf = new THREE.IcosahedronGeometry(0.12, 0);
      leaf.scale(1.4, 0.55, 1);
      leaf.rotateZ(k % 2 ? 0.6 : -0.6);
      leaf.translate((k % 2 ? 0.1 : -0.1) + 0.02 * k, -0.2 - k * 0.22, 0);
      parts.push({ geo: leaf, color: k % 2 ? palette.leaf : palette.mint });
    }
    return mergeColored(parts);
  })();
  const vineMesh = instanced(vineGeo, vcolorToon, vines.length);

  /* ---------------- gates ---------------- */
  const gate = (s: number, text: string, fill: string, ink: string): THREE.Group => {
    const g = new THREE.Group();
    const y = riverY(s);
    g.position.set(0, y, -s);
    const postGeo = kit.geo(new THREE.CylinderGeometry(0.2, 0.26, 7.2, 8));
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, kit.toon(palette.bark));
      post.position.set(sx * 5.9, 2.8, 0);
      g.add(post);
      const cap = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.42, 10, 8)), kit.toon(fill));
      cap.position.set(sx * 5.9, 6.5, 0);
      g.add(cap);
    }
    const bar = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.14, 0.14, 12, 6).rotateZ(Math.PI / 2)), kit.toon(palette.wood));
    bar.position.set(0, 6.1, 0);
    g.add(bar);
    const banner = new THREE.Mesh(
      kit.geo(new THREE.PlaneGeometry(7.4, 2.3)),
      kit.mat(new THREE.MeshBasicMaterial({ map: kit.tex(makeBannerTexture(text, fill, ink)), side: THREE.DoubleSide })),
    );
    banner.position.set(0, 4.85, 0.05);
    g.add(banner);
    // Pennants strung along the bar.
    const pennantGeo = kit.geo(new THREE.ConeGeometry(0.22, 0.55, 3));
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(pennantGeo, kit.toon([palette.candy, palette.sun, palette.mint, palette.bubble][i % 4]));
      p.rotation.z = Math.PI;
      p.position.set(-5.5 + i * 0.85, 5.75, 0.1);
      g.add(p);
    }
    root.add(g);
    return g;
  };
  gate(4, "ROW!", palette.sun, palette.ink);
  const finish = gate(COURSE_LEN, "FINISH", palette.cream, palette.lava);
  // Checker tape on the water at the line.
  {
    const cells = 14;
    const tapeGeo = kit.geo(new THREE.PlaneGeometry(WATER_HALF * 2 - 0.2, 0.9, cells, 2));
    const tapeCanvas = document.createElement("canvas");
    tapeCanvas.width = cells * 4;
    tapeCanvas.height = 8;
    const tg = tapeCanvas.getContext("2d");
    if (tg) {
      for (let i = 0; i < cells * 2; i++) {
        for (let j = 0; j < 2; j++) {
          tg.fillStyle = (i + j) % 2 ? palette.ink : palette.white;
          tg.fillRect(i * 2, j * 4, 2, 4);
        }
      }
    }
    const tapeTex = kit.tex(new THREE.CanvasTexture(tapeCanvas));
    tapeTex.magFilter = THREE.NearestFilter;
    tapeTex.colorSpace = THREE.SRGBColorSpace;
    const tape = new THREE.Mesh(tapeGeo, kit.mat(new THREE.MeshBasicMaterial({ map: tapeTex, transparent: true, opacity: 0.92, depthWrite: false })));
    tape.rotation.x = -Math.PI / 2;
    tape.position.set(0, riverY(COURSE_LEN) + 0.07, -COURSE_LEN);
    tape.renderOrder = 3;
    root.add(tape);
  }
  // Tiki lanterns along the start and finish banks.
  {
    const lampPost = kit.geo(new THREE.CylinderGeometry(0.06, 0.08, 1.8, 5));
    const lampGlow = kit.geo(new THREE.IcosahedronGeometry(0.2, 0));
    for (const s of [-6, 2, 10, COURSE_LEN - 10, COURSE_LEN - 2, COURSE_LEN + 6]) {
      for (const side of [-1, 1]) {
        const x = side * 5.5;
        const y = terrainY(s, 5.5, side);
        const post = new THREE.Mesh(lampPost, kit.toon(palette.woodDark));
        post.position.set(x, y + 0.8, -s);
        const glow = new THREE.Mesh(lampGlow, kit.basic(palette.sun));
        glow.position.set(x, y + 1.8, -s);
        root.add(post, glow);
      }
    }
  }

  /* ---------------- parrots ---------------- */
  const parrots: Parrot[] = [];
  const perchOf = (b: (typeof branches)[number]): THREE.Vector3 => new THREE.Vector3(b.x, b.y + 0.42, -b.s);
  const eligible = branches.filter((b) => b.s > 12 && b.s < COURSE_LEN - 14);
  for (let i = 0; i < 12 && eligible.length > 6; i++) {
    const from = eligible[Math.floor((i + 0.5) * (eligible.length / 12))];
    const to = eligible[Math.min(eligible.length - 1, eligible.indexOf(from) + 6)];
    const view = buildParrot(kit, i);
    view.root.scale.setScalar(1.25);
    root.add(view.root);
    parrots.push({
      view,
      a: perchOf(from),
      b: perchOf(to),
      triggerS: from.s - 15,
      flewAt: -1,
      dur: 4.6 + rand() * 1.4,
      phase: rand() * 6.28,
      partyAt: -1,
      from: new THREE.Vector3(),
    });
  }

  /* ---------------- update ---------------- */
  const tmp = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const fallEmit = FALLS.map(() => 0);
  let partyT = -1;
  let clock = 0;

  const faceMotion = (view: ParrotView, from: THREE.Vector3, to: THREE.Vector3): void => {
    // The model's beak points to -z. Face along the motion.
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-5) return;
    view.root.rotation.y = Math.atan2(-dx, -dz);
    view.root.rotation.x = Math.max(-0.5, Math.min(0.5, -(to.y - from.y) * 8));
  };

  return {
    update(t, dt, leaderS) {
      clock = t;
      // Water slides downstream; the white water and the falls run faster.
      waterTex.offset.y = -t * 0.45;
      foamTex.offset.y = -t * 1.1;
      fallTex.offset.y = -t * 2.6;

      // Waves pulse.
      let hi = 0;
      for (const [x, s, size, ph] of humps.base) {
        const k = 0.65 + 0.35 * Math.sin(t * 3.2 + ph);
        setAt(humps.mesh, hi++, x, riverY(s) + 0.02, -s, size * (1.2 + 0.3 * k), size * 0.34 * k, size * 1.6);
      }
      humps.mesh.instanceMatrix.needsUpdate = true;

      // Rock foam breathes.
      for (let i = 0; i < course.rocks.length; i++) {
        const rk = course.rocks[i];
        const k = 1.1 + 0.1 * Math.sin(t * 2.6 + i);
        setAt(rockFoam, i, rk.x, riverY(rk.s) + 0.06, -rk.s, rk.r * k, 1, rk.r * k);
      }
      rockFoam.instanceMatrix.needsUpdate = true;

      // Vines sway; the wind is a little stronger in the rapids.
      for (let i = 0; i < vines.length; i++) {
        const v = vines[i];
        const gust = 0.12 + 0.1 * rapidsAt(-v.z);
        const sw = Math.sin(t * 1.6 + v.phase) * gust;
        setAt(vineMesh, i, v.x, v.y, v.z, v.len, v.len, v.len, Math.cos(t * 1.1 + v.phase) * gust * 0.7, 0, sw);
      }
      vineMesh.instanceMatrix.needsUpdate = true;

      // Waterfall mist, only near the leader.
      FALLS.forEach((f, i) => {
        const near = Math.abs(leaderS - (f.s + f.len / 2)) < 42;
        if (!near) return;
        fallEmit[i] += dt * 18;
        while (fallEmit[i] >= 1) {
          fallEmit[i] -= 1;
          const b = fallBases[i];
          fx.mist(b.x + (rand() - 0.5) * 9.6, b.y + 0.2, b.z - rand() * 2, 0.5 + rand() * 0.5, 1 + rand() * 1.2);
        }
      });

      // Parrots.
      for (const p of parrots) {
        const view = p.view;
        prev.copy(view.root.position);
        if (partyT >= 0) {
          if (p.partyAt < 0) {
            p.partyAt = t;
            p.from.copy(view.root.position);
            if (p.flewAt < 0) p.from.copy(p.a);
          }
          const blend = Math.min(1, (t - p.partyAt) / 1.4);
          const w = 0.9 + 0.1 * Math.sin(p.phase);
          const ang = (t - partyT) * w + p.phase;
          tmp.set(Math.cos(ang) * 5.2, riverY(COURSE_LEN) + 6.2 + Math.sin(ang * 2 + p.phase) * 0.9, -COURSE_LEN - 6 + Math.sin(ang) * 4.4);
          view.root.position.copy(p.from).lerp(tmp, blend * blend * (3 - 2 * blend));
          faceMotion(view, prev, view.root.position);
          const flap = Math.sin(t * 20 + p.phase) * 0.9;
          view.wings[0].rotation.z = flap;
          view.wings[1].rotation.z = -flap;
          view.root.rotation.z = Math.sin(ang) * 0.35;
          continue;
        }
        if (p.flewAt < 0 && leaderS > p.triggerS) p.flewAt = t;
        if (p.flewAt < 0) {
          // Perched: a gentle bob and a look around.
          view.root.position.copy(p.a);
          view.root.rotation.set(0, (p.a.x > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(t * 0.7 + p.phase) * 0.45, 0);
          view.root.position.y += Math.abs(Math.sin(t * 1.3 + p.phase)) * 0.03;
          view.wings[0].rotation.z = 0.5;
          view.wings[1].rotation.z = -0.5;
          continue;
        }
        const u = Math.min(1, (t - p.flewAt) / p.dur);
        if (u >= 1) {
          view.root.position.copy(p.b);
          view.root.rotation.set(0, p.b.x > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
          view.wings[0].rotation.z = 0.5;
          view.wings[1].rotation.z = -0.5;
          continue;
        }
        const e = u * u * (3 - 2 * u);
        view.root.position.lerpVectors(p.a, p.b, e);
        view.root.position.y += Math.sin(Math.PI * e) * 5.5;
        view.root.position.x += Math.sin(e * 9 + p.phase) * 1.2;
        faceMotion(view, prev, view.root.position);
        const flap = Math.sin(t * 22 + p.phase) * (u > 0.9 ? 0.5 : 0.95);
        view.wings[0].rotation.z = flap;
        view.wings[1].rotation.z = -flap;
        view.root.rotation.z = Math.sin(e * 9 + p.phase) * 0.3;
      }

      // The finish arch flutters when the party starts.
      if (partyT >= 0) finish.position.y = riverY(COURSE_LEN) + Math.abs(Math.sin((t - partyT) * 9)) * 0.06 * Math.max(0, 1 - (t - partyT) / 1.5);
    },

    celebrate() {
      if (partyT >= 0) return;
      partyT = clock;
      fx.confetti(-5.9, riverY(COURSE_LEN) + 6.6, -COURSE_LEN, 40);
      fx.confetti(5.9, riverY(COURSE_LEN) + 6.6, -COURSE_LEN, 40);
    },

    dispose() {
      scene.background = prevBackground;
      scene.fog = prevFog;
      root.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      root.removeFromParent();
    },
  };
}


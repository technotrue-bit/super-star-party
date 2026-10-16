/**
 * SLINGSHOT SUMMIT — the treetop canopy village (presentation only).
 *
 * Four slingshot stations stand on one long plank deck built on stilts above
 * a sea of leaf-mounds. Rope railings and lantern poles ring the deck; giant
 * trees rise around it, each with a round tree-house platform and a little
 * hut, joined to the deck and to each other by sagging rope bridges hung with
 * lanterns. Leaves tumble down through the light, clouds drift past, and a
 * far-off summit closes the view. `setWind` makes the leaves and lanterns
 * stir harder when the targets speed up, and `flare` lights the lanterns on
 * a big hit.
 *
 * No gameplay rng: every placement comes from a fixed local generator, and
 * everything that moves is a function of the clock handed to `update`.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/** Height of the deck's walking surface. */
export const DECK_Y = 0.9;
/** Deck extents (x is symmetric, z runs from the front edge to the back edge). */
export const DECK_HALF_W = 7.4;
export const DECK_FRONT_Z = 3.7;
export const DECK_BACK_Z = -11.8;
/** Where each player's round pad sits on the deck. */
export const PAD_Z = 1.9;

export interface CanopyEnvironment {
  /** Idle animation on the presentation clock `t` (seconds). */
  update(t: number, dt: number): void;
  /** 0..1: how hard the wind blows (leaves drift, lanterns swing). */
  setWind(level: number): void;
  /** The lanterns flare for a moment (a big hit). */
  flare(): void;
  dispose(): void;
}

export interface LaneInfo {
  x: number;
  color: string;
}

/** Fixed generator for placements (presentation only; never a gameplay draw). */
function placement(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

export function buildCanopyEnvironment(parent: THREE.Object3D, lanes: readonly LaneInfo[]): CanopyEnvironment {
  const root = new THREE.Group();
  root.name = "slingshot:environment";
  parent.add(root);
  const rand = placement(0x5ca1ab1e);

  const toonCache = new Map<string, THREE.MeshToonMaterial>();
  const toon = (color: string): THREE.MeshToonMaterial => {
    let m = toonCache.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
      toonCache.set(color, m);
    }
    return m;
  };
  const basicCache = new Map<string, THREE.MeshBasicMaterial>();
  const basic = (color: string): THREE.MeshBasicMaterial => {
    let m = basicCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: hex(color) });
      basicCache.set(color, m);
    }
    return m;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  /** A unit-height cylinder stretched between two points. */
  const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(strutGeo, mat);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(r, len, r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };

  // ---- the canopy sea: a dark base and a field of leaf mounds ----
  const sea = mesh(new THREE.CircleGeometry(130, 48), toon(palette.leafDeep), 0, -0.01, 0);
  sea.rotation.x = -Math.PI / 2;
  root.add(sea);
  const moundGeo = new THREE.SphereGeometry(1, 14, 9);
  const berryGeo = new THREE.SphereGeometry(0.11, 6, 5);
  const moundColors = [palette.leaf, palette.leafDeep, palette.leafPine, palette.grassB, palette.leafDeep];
  for (let i = 0; i < 150; i++) {
    const a = rand() * Math.PI * 2;
    const r = 6 + Math.sqrt(rand()) * 70;
    const x = Math.cos(a) * r * 1.35;
    const z = Math.sin(a) * r - 6;
    // Keep the deck and its stilts clear.
    if (Math.abs(x) < DECK_HALF_W + 2.2 && z < DECK_FRONT_Z + 1.6 && z > DECK_BACK_Z - 2.2) continue;
    const near = z > DECK_FRONT_Z - 2;
    const s = (near ? 0.8 : 1.2) + rand() * (near ? 1.3 : 2.4);
    const m = mesh(moundGeo, toon(moundColors[i % moundColors.length]), x, -0.15, z);
    m.scale.set(s * 1.3, s * (near ? 0.55 + rand() * 0.35 : 0.32 + rand() * 0.22), s * 1.2);
    root.add(m);
    // Berries and blossoms dotted on the mound tops.
    if (near || i % 3 === 0) {
      const berryMat = toon([palette.candy, palette.sun, palette.white, palette.bubble][i % 4]);
      for (let b = 0; b < 4; b++) {
        const ba = rand() * Math.PI * 2;
        const br = rand() * s * 0.8;
        const berry = mesh(berryGeo, berryMat, x + Math.cos(ba) * br, -0.15 + s * 0.3 * (1 - (br / (s * 1.2)) ** 2) + 0.05, z + Math.sin(ba) * br);
        root.add(berry);
      }
    }
  }

  // ---- the deck: planks on stilts ----
  const deckLen = DECK_FRONT_Z - DECK_BACK_Z;
  const deckMidZ = (DECK_FRONT_Z + DECK_BACK_Z) / 2;
  const plankN = 24;
  const plankW = (DECK_HALF_W * 2) / plankN;
  const planks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(plankW - 0.05, 0.2, deckLen),
    new THREE.MeshToonMaterial({ gradientMap: celGradient }),
    plankN,
  );
  const tint = new THREE.Color();
  const PLANK_LIGHT = new THREE.Color(palette.sand);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < plankN; i++) {
    m4.makeTranslation(-DECK_HALF_W + plankW * (i + 0.5), DECK_Y - 0.1, deckMidZ);
    planks.setMatrixAt(i, m4);
    planks.setColorAt(i, tint.set(palette.wood).lerp(PLANK_LIGHT, i % 2 === 0 ? 0 : 0.28));
  }
  planks.receiveShadow = true;
  root.add(planks);
  // Edge beams.
  const beamMat = toon(palette.woodDark);
  root.add(mesh(new THREE.BoxGeometry(DECK_HALF_W * 2 + 0.5, 0.36, 0.4), beamMat, 0, DECK_Y - 0.28, DECK_FRONT_Z + 0.1));
  root.add(mesh(new THREE.BoxGeometry(DECK_HALF_W * 2 + 0.5, 0.36, 0.4), beamMat, 0, DECK_Y - 0.28, DECK_BACK_Z - 0.1));
  for (const sx of [-1, 1]) {
    root.add(mesh(new THREE.BoxGeometry(0.4, 0.36, deckLen + 0.4), beamMat, sx * (DECK_HALF_W + 0.1), DECK_Y - 0.28, deckMidZ));
  }
  // Stilts with cross-braces, down into the leaves.
  const stiltGeo = new THREE.CylinderGeometry(0.2, 0.28, DECK_Y + 0.5, 8);
  const stiltMat = toon(palette.bark);
  const stiltXs = [-6.6, -2.2, 2.2, 6.6];
  const stiltZs = [DECK_FRONT_Z - 0.2, -1.2, -6, DECK_BACK_Z + 0.2];
  for (const x of stiltXs) {
    for (const z of stiltZs) root.add(mesh(stiltGeo, stiltMat, x, (DECK_Y - 0.5) / 2 - 0.05, z));
  }
  for (const z of [DECK_FRONT_Z - 0.2, DECK_BACK_Z + 0.2]) {
    for (let i = 0; i < stiltXs.length - 1; i++) {
      const a = new THREE.Vector3(stiltXs[i], -0.1, z);
      const b = new THREE.Vector3(stiltXs[i + 1], DECK_Y - 0.35, z);
      const c = new THREE.Vector3(stiltXs[i], DECK_Y - 0.35, z);
      const d = new THREE.Vector3(stiltXs[i + 1], -0.1, z);
      root.add(strut(a, b, 0.07, beamMat), strut(c, d, 0.07, beamMat));
    }
  }

  // ---- lane runners and player pads ----
  for (const lane of lanes) {
    const c = new THREE.Color(lane.color).lerp(new THREE.Color(palette.cream), 0.55);
    const runner = mesh(new THREE.BoxGeometry(1.0, 0.03, deckLen - 1.6), new THREE.MeshToonMaterial({ color: c, gradientMap: celGradient }), lane.x, DECK_Y + 0.015, DECK_BACK_Z + (deckLen - 1.6) / 2 + 0.7);
    root.add(runner);
    for (const s of [-1, 1]) {
      root.add(mesh(new THREE.BoxGeometry(0.06, 0.035, deckLen - 1.6), toon(lane.color), lane.x + s * 0.53, DECK_Y + 0.018, runner.position.z));
    }
    const pad = mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.1, 28), toon(lane.color), lane.x, DECK_Y + 0.05, PAD_Z);
    const rim = mesh(new THREE.TorusGeometry(0.97, 0.05, 6, 28), toon(palette.ink), lane.x, DECK_Y + 0.1, PAD_Z);
    rim.rotation.x = Math.PI / 2;
    root.add(pad, rim);
  }

  // ---- rope railings and lantern poles ----
  const postMat = toon(palette.woodDark);
  const capMats = [palette.candy, palette.sun, palette.mint, palette.bubble].map((c) => toon(c));
  const ropeMat = toon(palette.cream);
  const railPts: [number, number][] = [];
  for (let z = DECK_BACK_Z; z <= DECK_FRONT_Z - 2.5; z += 2.5) {
    railPts.push([-DECK_HALF_W, z], [DECK_HALF_W, z]);
  }
  for (let x = -DECK_HALF_W + 2.35; x < DECK_HALF_W - 1; x += 2.35) railPts.push([x, DECK_BACK_Z]);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.0, 8);
  const capGeo = new THREE.SphereGeometry(0.13, 8, 6);
  railPts.forEach(([x, z], i) => {
    root.add(mesh(postGeo, postMat, x, DECK_Y + 0.5, z));
    root.add(mesh(capGeo, capMats[i % capMats.length], x, DECK_Y + 1.05, z));
  });
  const rope = (a: THREE.Vector3, b: THREE.Vector3, sag: number, r = 0.035, mat: THREE.Material = ropeMat): void => {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    root.add(mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 10, r, 5), mat));
  };
  for (const sx of [-1, 1]) {
    for (let z = DECK_BACK_Z; z < DECK_FRONT_Z - 5; z += 2.5) {
      rope(new THREE.Vector3(sx * DECK_HALF_W, DECK_Y + 0.85, z), new THREE.Vector3(sx * DECK_HALF_W, DECK_Y + 0.85, z + 2.5), 0.12);
    }
  }
  const backXs = [-DECK_HALF_W];
  for (let x = -DECK_HALF_W + 2.35; x < DECK_HALF_W - 1; x += 2.35) backXs.push(x);
  backXs.push(DECK_HALF_W);
  for (let i = 0; i < backXs.length - 1; i++) {
    rope(new THREE.Vector3(backXs[i], DECK_Y + 0.85, DECK_BACK_Z), new THREE.Vector3(backXs[i + 1], DECK_Y + 0.85, DECK_BACK_Z), 0.12);
  }

  // ---- lanterns ----
  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = haloCanvas.height = 64;
  const hc = haloCanvas.getContext("2d");
  if (hc) {
    const g = hc.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(255,226,150,0.95)");
    g.addColorStop(0.35, "rgba(255,181,71,0.45)");
    g.addColorStop(1, "rgba(255,181,71,0)");
    hc.fillStyle = g;
    hc.fillRect(0, 0, 64, 64);
  }
  const haloTex = new THREE.CanvasTexture(haloCanvas);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  const lanternBodyGeo = new THREE.SphereGeometry(0.2, 12, 9);
  lanternBodyGeo.scale(1, 1.2, 1);
  const lanternCapGeo = new THREE.ConeGeometry(0.17, 0.16, 8);
  const lanternKnobGeo = new THREE.SphereGeometry(0.05, 6, 5);
  const lanternColors = [palette.lampWarm, palette.candy, palette.sun, palette.bubble];
  interface Lantern {
    group: THREE.Group;
    halo: THREE.Sprite;
    haloMat: THREE.SpriteMaterial;
    phase: number;
    base: number;
  }
  const lanterns: Lantern[] = [];
  /** A lantern hanging from `from` on a short cord. */
  const lantern = (parentGroup: THREE.Object3D, x: number, y: number, z: number, scale: number, color: string, cord = 0.35): void => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const swing = new THREE.Group();
    g.add(swing);
    swing.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, cord, 4), basic(palette.ink), 0, -cord / 2, 0));
    const body = mesh(lanternBodyGeo, basic(color), 0, -cord - 0.22, 0);
    swing.add(body);
    swing.add(mesh(lanternCapGeo, toon(palette.ink), 0, -cord - 0.02, 0));
    swing.add(mesh(lanternKnobGeo, toon(palette.ink), 0, -cord - 0.46, 0));
    const haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(1.5);
    halo.position.set(0, -cord - 0.22, 0);
    swing.add(halo);
    g.scale.setScalar(scale);
    parentGroup.add(g);
    lanterns.push({ group: swing, halo, haloMat, phase: x * 0.9 + z * 0.5, base: 0.55 });
  };
  // Lamp poles at the deck corners and the middle of each side, an arm over the deck.
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 3.0, 8);
  const polePlaces: [number, number][] = [
    [-DECK_HALF_W, DECK_FRONT_Z - 0.3],
    [DECK_HALF_W, DECK_FRONT_Z - 0.3],
    [-DECK_HALF_W, -4.2],
    [DECK_HALF_W, -4.2],
    [-DECK_HALF_W, DECK_BACK_Z],
    [DECK_HALF_W, DECK_BACK_Z],
  ];
  polePlaces.forEach(([x, z], i) => {
    root.add(mesh(poleGeo, postMat, x, DECK_Y + 1.5, z));
    const dir = x < 0 ? 1 : -1;
    root.add(strut(new THREE.Vector3(x, DECK_Y + 2.95, z), new THREE.Vector3(x + dir * 0.7, DECK_Y + 3.05, z), 0.05, postMat));
    lantern(root, x + dir * 0.7, DECK_Y + 3.05, z, 1.15, lanternColors[i % 2 === 0 ? 0 : 2]);
  });
  // A string of small lanterns across the back of the deck.
  {
    const a = new THREE.Vector3(-DECK_HALF_W, DECK_Y + 2.9, DECK_BACK_Z);
    const b = new THREE.Vector3(DECK_HALF_W, DECK_Y + 2.9, DECK_BACK_Z);
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(0, DECK_Y + 2.1, DECK_BACK_Z), b);
    root.add(mesh(new THREE.TubeGeometry(curve, 24, 0.02, 4), basic(palette.ink)));
    for (let i = 1; i < 9; i++) {
      const p = curve.getPoint(i / 9);
      lantern(root, p.x, p.y, p.z, 0.8, lanternColors[i % lanternColors.length], 0.12);
    }
  }

  // ---- giant trees, tree-houses and rope bridges ----
  const trunkMat = toon(palette.bark);
  const crownColors = [palette.leaf, palette.leafDeep, palette.leafPine];
  const crownGeo = new THREE.SphereGeometry(1, 14, 10);
  interface TreeSpec {
    x: number;
    z: number;
    r: number;
    h: number;
    house?: { y: number; roof: string; wall: string; face: number };
  }
  const trees: TreeSpec[] = [
    { x: -11.2, z: -2.5, r: 1.15, h: 9.5, house: { y: 4.3, roof: palette.tentRed, wall: palette.tentCream, face: 0.9 } },
    { x: 11.6, z: -5.5, r: 1.25, h: 10.5, house: { y: 5.0, roof: palette.berry, wall: palette.cream, face: -0.9 } },
    { x: -8.2, z: -17.5, r: 1.3, h: 11.5, house: { y: 4.8, roof: palette.mintDeep, wall: palette.sand, face: 0.4 } },
    { x: 9.0, z: -19.5, r: 1.4, h: 12.5, house: { y: 5.2, roof: palette.candy, wall: palette.tentCream, face: -0.4 } },
    { x: 0.5, z: -28, r: 1.7, h: 14 },
    { x: -19.5, z: -11, r: 1.4, h: 11 },
    { x: 20.5, z: -13, r: 1.5, h: 12 },
    { x: -15.5, z: 4.5, r: 1.1, h: 8 },
    { x: 15.8, z: 3.5, r: 1.1, h: 8.5 },
  ];
  const platforms: THREE.Vector3[] = [];
  trees.forEach((t, ti) => {
    const trunk = mesh(new THREE.CylinderGeometry(t.r * 0.78, t.r * 1.12, t.h + 0.6, 12), trunkMat, t.x, t.h / 2 - 0.3, t.z);
    root.add(trunk);
    // A crown of clumped leaf blobs on top, a few lower tufts.
    const crownY = t.h + 0.2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + ti;
      const rr = k === 0 ? 0 : t.r * 1.9;
      const s = t.r * (k === 0 ? 2.8 : 2.1) + rand() * 0.4;
      const blob = mesh(crownGeo, toon(crownColors[(ti + k) % 3]), t.x + Math.cos(a) * rr, crownY + (k === 0 ? 0.9 : rand() * 0.8 - 0.2), t.z + Math.sin(a) * rr);
      blob.scale.set(s, s * 0.78, s);
      root.add(blob);
    }
    if (t.house) {
      const h = t.house;
      const py = h.y;
      const plat = mesh(new THREE.CylinderGeometry(t.r + 1.35, t.r + 1.45, 0.22, 20), toon(palette.wood), t.x, py, t.z);
      root.add(plat);
      root.add(mesh(new THREE.CylinderGeometry(t.r + 1.45, t.r + 1.0, 0.3, 20), beamMat, t.x, py - 0.25, t.z));
      // Railing posts round the platform.
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        root.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 5), postMat, t.x + Math.cos(a) * (t.r + 1.3), py + 0.4, t.z + Math.sin(a) * (t.r + 1.3)));
      }
      const hut = new THREE.Group();
      hut.position.set(t.x + Math.cos(h.face) * (t.r + 0.1), py + 0.11, t.z + Math.sin(h.face) * (t.r + 0.1));
      hut.rotation.y = -h.face + Math.PI / 2;
      hut.add(mesh(new THREE.BoxGeometry(1.8, 1.25, 1.5), toon(h.wall), 0, 0.62, 1.3));
      const roof = mesh(new THREE.ConeGeometry(1.55, 1.0, 4), toon(h.roof), 0, 1.75, 1.3);
      roof.rotation.y = Math.PI / 4;
      hut.add(roof);
      hut.add(mesh(new THREE.BoxGeometry(0.4, 0.75, 0.06), toon(palette.woodDark), 0, 0.4, 2.07));
      hut.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.06), basic(palette.lampHot), 0.55, 0.75, 2.07));
      hut.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.06), basic(palette.lampHot), -0.55, 0.75, 2.07));
      root.add(hut);
      lantern(root, t.x + Math.cos(h.face + 0.7) * (t.r + 1.3), py + 1.4, t.z + Math.sin(h.face + 0.7) * (t.r + 1.3), 0.9, lanternColors[ti % lanternColors.length]);
      platforms.push(new THREE.Vector3(t.x, py + 0.1, t.z));
    }
  });
  const bridge = (a: THREE.Vector3, b: THREE.Vector3, sag: number, lanternEvery = 0): void => {
    const len = a.distanceTo(b);
    const n = Math.max(6, Math.round(len / 0.42));
    const plankGeo = new THREE.BoxGeometry(0.95, 0.07, 0.34);
    const side = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize().multiplyScalar(0.48);
    const point = (u: number): THREE.Vector3 => {
      const p = a.clone().lerp(b, u);
      p.y -= sag * 4 * u * (1 - u);
      return p;
    };
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (let i = 0; i <= n; i++) {
      const p = point(i / n);
      const ahead = point(Math.min(1, i / n + 0.01));
      const pl = mesh(plankGeo, toon(i % 2 === 0 ? palette.wood : palette.woodDark), p.x, p.y, p.z);
      pl.rotation.y = yaw;
      pl.rotation.x = -Math.atan2(ahead.y - p.y, Math.hypot(ahead.x - p.x, ahead.z - p.z)) || 0;
      root.add(pl);
    }
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const p = point(i / 12).addScaledVector(side, s);
        p.y += 0.75;
        pts.push(p);
      }
      root.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 5), ropeMat));
      for (let i = 0; i <= 12; i += 3) {
        const base = point(i / 12).addScaledVector(side, s);
        root.add(strut(base, pts[i], 0.025, ropeMat));
      }
    }
    if (lanternEvery > 0) {
      for (let i = lanternEvery; i < n; i += lanternEvery) {
        const p = point(i / n);
        lantern(root, p.x, p.y + 1.15, p.z, 0.7, lanternColors[i % lanternColors.length], 0.2);
      }
    }
  };
  // Side trees down to the deck rail, and the long span across the back.
  bridge(new THREE.Vector3(-11.2 + 2.1, platforms[0].y, -2.5), new THREE.Vector3(-DECK_HALF_W + 0.2, DECK_Y + 0.1, -2.5), 0.15);
  bridge(new THREE.Vector3(11.6 - 2.3, platforms[1].y, -5.5), new THREE.Vector3(DECK_HALF_W - 0.2, DECK_Y + 0.1, -5.5), 0.15);
  bridge(new THREE.Vector3(-8.2 + 2.6, platforms[2].y, -17.5), new THREE.Vector3(9.0 - 2.7, platforms[3].y, -19.5), 1.1, 5);
  bridge(new THREE.Vector3(-11.2, platforms[0].y, -2.5 - 2.4), new THREE.Vector3(-8.2 - 1.5, platforms[2].y, -17.5 + 2.1), 0.9, 6);

  // ---- distant summit and hills ----
  const hillGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const hills: [number, number, number, number, string][] = [
    [-40, -75, 26, 0.45, palette.leafPine],
    [-8, -85, 34, 0.5, palette.leafDeep],
    [34, -78, 28, 0.42, palette.leaf],
    [64, -50, 22, 0.4, palette.leafDeep],
    [-70, -52, 24, 0.42, palette.leafPine],
  ];
  for (const [x, z, r, sy, c] of hills) {
    const hill = mesh(hillGeo, toon(c), x, -0.4, z);
    hill.scale.set(r, r * sy, r);
    root.add(hill);
  }
  const peak = mesh(new THREE.ConeGeometry(17, 30, 7), toon(palette.rock), 14, 14, -105);
  const snow = mesh(new THREE.ConeGeometry(7.2, 12.5, 7), toon(palette.white), 14, 24.8, -105);
  root.add(peak, snow);
  const peak2 = mesh(new THREE.ConeGeometry(13, 22, 7), toon(palette.cliffStone), -30, 10, -100);
  root.add(peak2);

  // ---- clouds ----
  const cloudMat = new THREE.MeshBasicMaterial({ color: hex(palette.white) });
  const puffGeo = new THREE.SphereGeometry(1, 12, 8);
  const clouds: { g: THREE.Group; x0: number; speed: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const s = 1.2 + rand() * 1.1;
    for (const [px, py, pz, ps] of [
      [0, 0, 0, 1.25],
      [-1.3, -0.25, 0.1, 0.85],
      [1.25, -0.2, -0.05, 0.95],
      [0.2, 0.35, 0.1, 0.8],
    ] as const) {
      const p = mesh(puffGeo, cloudMat, px * s, py * s, pz * s);
      p.scale.set(ps * s * 1.2, ps * s * 0.72, ps * s);
      g.add(p);
    }
    g.position.set(0, 9 + rand() * 9, -22 - rand() * 36);
    root.add(g);
    clouds.push({ g, x0: rand() * 100, speed: 0.25 + rand() * 0.35 });
  }

  // ---- falling leaves ----
  const LEAVES = 70;
  const leafGeo = new THREE.PlaneGeometry(0.22, 0.14);
  const leafMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES);
  leaves.frustumCulled = false;
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const leafColors = [palette.leaf, palette.mint, palette.sun, palette.sunDeep, palette.leafDeep];
  const leafSeed = Array.from({ length: LEAVES }, (_, i) => {
    leaves.setColorAt(i, tint.set(leafColors[i % leafColors.length]));
    return { x: rand() * 30 - 15, z: rand() * 20 - 14, fall: 0.35 + rand() * 0.45, phase: rand() * 6.28, y0: rand() * 8, spin: 1 + rand() * 2.2 };
  });
  root.add(leaves);
  const dummy = new THREE.Object3D();

  // ---- the clock ----
  let wind = 0;
  let windSmooth = 0;
  let drift = 0;
  let flareT = 0;
  const FALL_SPAN = 8.5;

  const placeLeaves = (t: number): void => {
    for (let i = 0; i < LEAVES; i++) {
      const s = leafSeed[i];
      const u = mod(s.y0 / FALL_SPAN + (t * s.fall) / FALL_SPAN, 1);
      const y = DECK_Y + 0.15 + (1 - u) * FALL_SPAN;
      const x = mod(s.x + Math.sin(t * 0.8 + s.phase) * 1.1 + drift * (0.6 + s.fall) + 15, 30) - 15;
      const fade = Math.min(1, u * 6, (1 - u) * 6);
      dummy.position.set(x, y, s.z + Math.cos(t * 0.6 + s.phase) * 0.8);
      dummy.rotation.set(t * s.spin + s.phase, t * s.spin * 0.7, Math.sin(t * 1.7 + s.phase) * 1.2);
      dummy.scale.setScalar(Math.max(0.001, fade));
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
  };
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  placeLeaves(0);

  return {
    update(t, dt) {
      windSmooth += (wind - windSmooth) * Math.min(1, dt * 1.5);
      drift += dt * (0.25 + windSmooth * 2.4);
      if (flareT > 0) flareT = Math.max(0, flareT - dt);
      const flare = Math.min(1, flareT / 0.35);
      for (const l of lanterns) {
        const amp = 0.05 + windSmooth * 0.14;
        l.group.rotation.z = Math.sin(t * (1.3 + windSmooth) + l.phase) * amp;
        l.group.rotation.x = Math.cos(t * (1.0 + windSmooth * 0.8) + l.phase * 1.3) * amp * 0.7;
        l.haloMat.opacity = l.base + 0.08 * Math.sin(t * 3.1 + l.phase) + 0.4 * flare;
        l.halo.scale.setScalar(1.5 + 0.9 * flare);
      }
      for (const c of clouds) c.g.position.x = mod(c.x0 + t * c.speed + 55, 110) - 55;
      placeLeaves(t);
    },
    setWind(level) {
      wind = Math.min(1, Math.max(0, level));
    },
    flare() {
      flareT = 1.1;
    },
    dispose() {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!(m as { isMesh?: boolean }).isMesh) return;
        if (m.geometry !== strutGeo) m.geometry?.dispose();
      });
      strutGeo.dispose();
      for (const m of toonCache.values()) m.dispose();
      for (const m of basicCache.values()) m.dispose();
      for (const l of lanterns) l.haloMat.dispose();
      leafMat.dispose();
      cloudMat.dispose();
      haloTex.dispose();
      planks.material instanceof THREE.Material && planks.material.dispose();
      planks.dispose();
      leaves.dispose();
      root.removeFromParent();
    },
  };
}

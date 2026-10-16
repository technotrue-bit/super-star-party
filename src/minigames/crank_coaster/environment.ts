/**
 * CRANK COASTER — the abandoned gold mine (presentation only).
 *
 * A jagged cavern wall closes the scene behind four lift hills; the timber headframe
 * over the summits carries a plank sign and a row of swinging lanterns. Gold veins and
 * gem clusters in the wall glint; crates, barrels, rail stubs and a plank walkway fill
 * the floor; dust drifts through the lantern light.
 *
 * No gameplay rng: every placement comes from a fixed local generator and everything
 * that moves is a function of the clocks handed to `update`.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { makeSkyTexture } from "../framing";
import {
  beam,
  boxAt,
  buildCrystalGeometry,
  buildLantern,
  lookRng,
  makeSparkleTexture,
  makeWordTexture,
  mergeColored,
  type Kit,
  type LanternView,
} from "./art";
import { TOP, laneX } from "./layout";

/** The cavern wall stands this far behind the hills. */
const WALL_Z = -12;
/** The headframe beam and the lanterns under it. */
export const BEAM_Y = 17.2;
const BEAM_Z = -5.6;

export interface MineEnvironment {
  update(t: number, dt: number): void;
  /** Someone topped the hill: the lanterns flare and the glints burst. */
  celebrate(): void;
  dispose(): void;
}

interface Swinger {
  group: THREE.Group;
  phase: number;
  amp: number;
}

export function buildMine(scene: THREE.Scene, parent: THREE.Object3D, kit: Kit, glowTex: THREE.Texture): MineEnvironment {
  const root = new THREE.Group();
  root.name = "crank_coaster:environment";
  parent.add(root);
  const rand = lookRng(0x6d1e);
  const vertexMat = kit.vertex();

  // A dim cavern behind everything.
  const prevBackground = scene.background;
  const prevFog = scene.fog;
  scene.background = kit.tex(makeSkyTexture(palette.ink, palette.inkSoft));
  scene.fog = null;

  /* ---------------- floor ---------------- */
  const floorGeo = kit.geo(new THREE.CircleGeometry(95, 48));
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, kit.toon(palette.cliffDirtDark));
  floor.position.y = 0.02;
  root.add(floor);

  // Flat stones scattered on the floor, merged.
  const stones: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  for (let i = 0; i < 70; i++) {
    const x = (rand() - 0.5) * 34;
    const z = -10 + rand() * 24;
    if (Math.abs(x) < 6.6 && z > -4.5 && z < 7.5) continue;
    const s = 0.25 + rand() * 0.6;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1.3, 0.5, 1);
    g.rotateY(rand() * 6.28);
    g.translate(x, s * 0.2, z);
    stones.push({ geo: g, color: rand() < 0.5 ? palette.cliffStone : palette.rock });
  }
  root.add(new THREE.Mesh(kit.geo(mergeColored(stones)), vertexMat));

  /* ---------------- the cavern wall ---------------- */
  const wallSrc = new THREE.PlaneGeometry(130, 56, 64, 28);
  const pos = wallSrc.attributes.position;
  const noise = (x: number, y: number): number =>
    Math.sin(x * 0.31 + y * 0.17) * 0.5 + Math.sin(x * 0.73 - y * 0.41 + 1.3) * 0.3 + Math.sin(x * 0.12 + y * 0.9) * 0.2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + 28;
    pos.setZ(i, noise(x, y) * 1.6 + (rand() - 0.5) * 0.8);
    pos.setX(i, x + (rand() - 0.5) * 0.7);
    pos.setY(i, pos.getY(i) + (rand() - 0.5) * 0.7);
  }
  const wall = wallSrc.toNonIndexed();
  wallSrc.dispose();
  wall.computeVertexNormals();
  const wallCol = new Float32Array(wall.attributes.position.count * 3);
  const base = [new THREE.Color(hex(palette.cliffDirtDark)), new THREE.Color(hex(palette.cliffStone)), new THREE.Color(hex(palette.inkSoft))];
  const ink = new THREE.Color(hex(palette.ink));
  const tmp = new THREE.Color();
  for (let f = 0; f < wall.attributes.position.count; f += 3) {
    const y = (wall.attributes.position.getY(f) + wall.attributes.position.getY(f + 1) + wall.attributes.position.getY(f + 2)) / 3 + 28;
    const x = wall.attributes.position.getX(f);
    const n = noise(x * 1.7, y * 1.3 + 4) * 0.5 + 0.5;
    const a = n < 0.4 ? base[0] : n < 0.7 ? base[1] : base[2];
    tmp.copy(a).lerp(ink, Math.min(0.85, Math.max(0, (y - 14) / 30)));
    // Cave shadow low down too, so the hills stand out from the floor line.
    for (let k = 0; k < 3; k++) {
      wallCol[(f + k) * 3] = tmp.r;
      wallCol[(f + k) * 3 + 1] = tmp.g;
      wallCol[(f + k) * 3 + 2] = tmp.b;
    }
  }
  wall.setAttribute("color", new THREE.BufferAttribute(wallCol, 3));
  const wallMesh = new THREE.Mesh(kit.geo(wall), vertexMat);
  wallMesh.position.set(0, 28, WALL_Z);
  root.add(wallMesh);

  // Boulders heaped at the foot of the wall and down both sides.
  const boulders: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (7.5 + rand() * 14);
    const z = WALL_Z + 1.5 + rand() * 6;
    const s = 0.9 + rand() * 2.2;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1, 0.8 + rand() * 0.6, 1);
    g.rotateY(rand() * 6.28);
    g.translate(x, s * 0.45, z);
    boulders.push({ geo: g, color: [palette.cliffStone, palette.cliffDirtDark, palette.rock][i % 3] });
  }
  root.add(new THREE.Mesh(kit.geo(mergeColored(boulders)), vertexMat));

  /* ---------------- gold veins and gems ---------------- */
  const goldGeo = kit.geo(buildCrystalGeometry(rand, [palette.sun, palette.sunDeep, palette.sun], 5));
  const gemGeo = kit.geo(buildCrystalGeometry(rand, [palette.bubble, palette.berry, palette.bubble, palette.candy], 6));
  const glints: Array<{ x: number; y: number; z: number; phase: number; speed: number; size: number }> = [];
  const placeCluster = (geo: THREE.BufferGeometry, x: number, y: number, z: number, scale: number, rot: number): void => {
    const m = new THREE.Mesh(geo, vertexMat);
    m.position.set(x, y, z);
    m.scale.setScalar(scale);
    m.rotation.set(-0.3 - rand() * 0.3, rot, 0);
    root.add(m);
    glints.push({ x, y: y + scale * 0.7, z: z + 0.4, phase: rand() * 6.28, speed: 0.7 + rand() * 0.9, size: 0.7 + scale * 0.35 });
  };
  const spots: Array<[number, number, number, number]> = [
    [-8.2, 0.1, -9.6, 1.5],
    [-5.6, 0.1, -10.4, 1.1],
    [6.4, 0.1, -9.8, 1.4],
    [9.2, 0.1, -9.2, 1.0],
    [-10.5, 5.5, -10.6, 1.4],
    [10.8, 7.5, -10.8, 1.3],
    [-3.4, 9.8, -10.9, 1.1],
    [3.8, 11.6, -11, 1.2],
    [-7.2, 12.6, -11, 1.0],
    [8.6, 15.2, -11, 1.1],
    [-1.4, 20.5, -11.3, 1.3],
    [-9.8, 18.4, -11, 1.1],
  ];
  spots.forEach(([x, y, z, s], i) => placeCluster(i % 3 === 1 ? gemGeo : goldGeo, x, y, z, s, rand() * 6.28));
  // Gold veins: thin glowing seams across the wall.
  const veinMat = kit.basic(palette.sun);
  const vein = (pts: Array<[number, number]>): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = new THREE.Vector3(pts[i][0], pts[i][1], WALL_Z + 1.6);
      const b = new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], WALL_Z + 1.6);
      root.add(new THREE.Mesh(kit.geo(beam(a, b, 0.22, 0.12)), veinMat));
    }
  };
  vein([[-11, 6], [-8.5, 8.2], [-6.5, 7.6], [-3.6, 10.4], [-1, 9.8]]);
  vein([[12, 10], [9.2, 12.4], [7, 11.2], [4.6, 14]]);
  vein([[-12, 14], [-9.6, 16.4], [-7.4, 15.4]]);
  // Sparkle glints on the seams too.
  for (const [x, y] of [[-8.5, 8.2], [-3.6, 10.4], [9.2, 12.4], [-9.6, 16.4], [4.6, 14]]) {
    glints.push({ x, y, z: WALL_Z + 2.2, phase: rand() * 6.28, speed: 0.9 + rand(), size: 0.9 });
  }

  const sparkleMat = kit.mat(new THREE.MeshBasicMaterial({ map: kit.tex(makeSparkleTexture()), color: hex(palette.cream), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const sparkleMesh = new THREE.InstancedMesh(kit.geo(new THREE.PlaneGeometry(1, 1)), sparkleMat, glints.length);
  sparkleMesh.frustumCulled = false;
  sparkleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkleMesh.renderOrder = 4;
  root.add(sparkleMesh);

  /* ---------------- timber headframe over the summits ---------------- */
  const timber: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const span = 7.4;
  for (const s of [-1, 1]) {
    timber.push({ geo: beam(v(s * span, 0, BEAM_Z), v(s * span, BEAM_Y, BEAM_Z), 0.55), color: palette.woodDark });
    timber.push({ geo: beam(v(s * (span + 1.4), 0, BEAM_Z + 0.6), v(s * span, BEAM_Y - 3.4, BEAM_Z), 0.3), color: palette.wood });
    timber.push({ geo: beam(v(s * span, BEAM_Y - 3.6, BEAM_Z), v(s * (span - 2.4), BEAM_Y - 0.1, BEAM_Z), 0.28), color: palette.wood });
  }
  timber.push({ geo: boxAt(span * 2 + 1.4, 0.6, 0.6, 0, BEAM_Y, BEAM_Z), color: palette.wood });
  timber.push({ geo: boxAt(span * 2 + 0.6, 0.34, 0.4, 0, BEAM_Y - 3.6, BEAM_Z), color: palette.woodDark });
  // Tie beams back to the summit of each lane (a gantry the hills lean on).
  for (let i = 0; i < 4; i++) {
    timber.push({ geo: beam(v(laneX(i), TOP.y + 1.2, TOP.z - 0.6), v(laneX(i), BEAM_Y - 3.5, BEAM_Z), 0.22), color: palette.woodDark });
  }
  root.add(new THREE.Mesh(kit.geo(mergeColored(timber)), vertexMat));

  // The sign.
  const signTex = kit.tex(makeWordTexture("CRANK COASTER", palette.sun, 640, 120, 74));
  const signMat = kit.mat(new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  const sign = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(9.4, 1.76)), signMat);
  sign.position.set(0, BEAM_Y + 1.5, BEAM_Z + 0.34);
  const plank = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(9.8, 1.9, 0.3)), kit.toon(palette.woodDark));
  plank.position.set(0, BEAM_Y + 1.5, BEAM_Z + 0.1);
  root.add(plank, sign);

  /* ---------------- lanterns ---------------- */
  const glowMats = [0, 1, 2].map(() => kit.mat(new THREE.SpriteMaterial({ map: glowTex, color: hex(palette.lampWarm), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })));
  const lanterns: Array<{ view: LanternView; mat: THREE.SpriteMaterial; phase: number; base: THREE.Vector3 }> = [];
  const swingers: Swinger[] = [];
  const hang = (x: number, y: number, z: number, drop: number, k: number): void => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const chain = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.03, 0.03, drop, 4)), kit.toon(palette.inkSoft));
    chain.position.y = -drop / 2;
    const view = buildLantern(kit, glowMats[k % glowMats.length]);
    view.root.position.y = -drop - 0.3;
    pivot.add(chain, view.root);
    root.add(pivot);
    swingers.push({ group: pivot, phase: rand() * 6.28, amp: 0.03 + rand() * 0.03 });
    lanterns.push({ view, mat: glowMats[k % glowMats.length], phase: rand() * 6.28, base: new THREE.Vector3(x, y - drop - 0.3, z) });
  };
  [-5.4, -2.7, 0, 2.7, 5.4].forEach((x, i) => hang(x, BEAM_Y - 0.3, BEAM_Z + 0.6, 1.1 + (i % 2) * 0.5, i));
  // Posts at the sides with lanterns on arms.
  for (const s of [-1, 1]) {
    const post: Array<{ geo: THREE.BufferGeometry; color: string }> = [
      { geo: beam(v(s * 6.4, 0, 6), v(s * 6.4, 5.2, 6), 0.26), color: palette.woodDark },
      { geo: beam(v(s * 6.4, 5.0, 6), v(s * 5.5, 5.2, 6), 0.16), color: palette.wood },
    ];
    root.add(new THREE.Mesh(kit.geo(mergeColored(post)), vertexMat));
    hang(s * 5.5, 5.15, 6, 0.6, s > 0 ? 1 : 2);
  }

  /* ---------------- props ---------------- */
  const props: Array<{ geo: THREE.BufferGeometry; color: string }> = [];
  // A plank walkway across the front.
  for (let i = 0; i < 18; i++) {
    props.push({ geo: boxAt(0.62, 0.1, 2.2, -5.6 + i * 0.66, 0.08, 6.9), color: i % 2 ? palette.wood : palette.woodDark });
  }
  props.push({ geo: boxAt(12.4, 0.1, 0.14, 0, 0.16, 5.9), color: palette.woodDark });
  props.push({ geo: boxAt(12.4, 0.1, 0.14, 0, 0.16, 7.9), color: palette.woodDark });
  // Crates stacked at the sides.
  const crate = (x: number, y: number, z: number, s: number, turn: number): void => {
    props.push({ geo: boxAt(s, s, s, x, y + s / 2, z, 0, turn, 0), color: palette.wood });
    props.push({ geo: boxAt(s * 1.04, s * 0.14, s * 1.04, x, y + s * 0.12, z, 0, turn, 0), color: palette.woodDark });
    props.push({ geo: boxAt(s * 1.04, s * 0.14, s * 1.04, x, y + s * 0.88, z, 0, turn, 0), color: palette.woodDark });
  };
  crate(-7.6, 0, 3.4, 1.2, 0.2);
  crate(-8.9, 0, 2.6, 1.0, -0.3);
  crate(-8.2, 1.2, 3.1, 0.9, 0.5);
  crate(7.8, 0, 3.1, 1.15, -0.25);
  crate(9.1, 0, 4.0, 1.0, 0.35);
  // Rail stubs running off to the dark.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      props.push({ geo: boxAt(1.4, 0.1, 0.22, s * 11, 0.1, -7 + i * 0.9, 0, 0.05 * s, 0), color: palette.woodDark });
    }
    props.push({ geo: boxAt(0.1, 0.1, 6.4, s * 10.5, 0.2, -4, 0, 0.05 * s, 0), color: palette.metal });
    props.push({ geo: boxAt(0.1, 0.1, 6.4, s * 11.5, 0.2, -4, 0, 0.05 * s, 0), color: palette.metal });
  }
  // A pickaxe leaning on the left crates.
  props.push({ geo: beam(v(-6.9, 0.1, 4.4), v(-7.5, 1.7, 3.9), 0.09), color: palette.wood });
  props.push({ geo: beam(v(-7.9, 1.72, 3.9), v(-7.1, 1.7, 3.9), 0.09, 0.14), color: palette.metal });
  root.add(new THREE.Mesh(kit.geo(mergeColored(props)), vertexMat));
  // Barrels (round props): shared geometry, a few instances.
  const barrelGeo = kit.geo(new THREE.CylinderGeometry(0.46, 0.4, 0.95, 12));
  const hoopGeo = kit.geo(new THREE.TorusGeometry(0.44, 0.04, 5, 14));
  hoopGeo.rotateX(Math.PI / 2);
  for (const [x, z] of [[-6.9, 5.3], [-6.1, 5.9], [7.0, 5.5], [8.2, 2.2]] as const) {
    const b = new THREE.Mesh(barrelGeo, kit.toon(palette.wood));
    b.position.set(x, 0.48, z);
    root.add(b);
    for (const h of [-0.25, 0.25]) {
      const r = new THREE.Mesh(hoopGeo, kit.toon(palette.inkSoft));
      r.position.set(x, 0.48 + h, z);
      r.scale.setScalar(1 + (h < 0 ? 0 : 0.04));
      root.add(r);
    }
  }
  // An ore wagon at the foot of the right-hand boulders, heaped with gold.
  const wagon = new THREE.Group();
  const wagonBody = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(2.4, 0.9, 1.4)), kit.toon(palette.woodDark));
  wagonBody.position.y = 0.75;
  const pile = new THREE.Mesh(kit.geo(new THREE.DodecahedronGeometry(0.85, 0)), kit.toon(palette.sun));
  pile.scale.set(1.2, 0.6, 0.8);
  pile.position.y = 1.3;
  wagon.add(wagonBody, pile);
  for (const x of [-0.8, 0.8]) {
    const w = new THREE.Mesh(kit.geo(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10)), kit.toon(palette.inkSoft));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.3, 0.75);
    wagon.add(w);
  }
  wagon.position.set(10.6, 0, -2.8);
  wagon.rotation.y = -0.4;
  root.add(wagon);

  /* ---------------- dust in the lantern light ---------------- */
  const motes = 36;
  const moteMesh = new THREE.InstancedMesh(kit.geo(new THREE.PlaneGeometry(0.1, 0.1)), kit.ghost(palette.lampHot, 0.6), motes);
  moteMesh.frustumCulled = false;
  moteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(moteMesh);
  const moteSeed = Array.from({ length: motes }, () => ({ x: (rand() - 0.5) * 18, y: 1 + rand() * 18, z: -6 + rand() * 12, p: rand() * 6.28, s: 0.2 + rand() * 0.5 }));

  const dummy = new THREE.Object3D();
  let flare = 0;
  let burst = 0;
  return {
    update(t, dt) {
      flare = Math.max(0, flare - dt * 0.7);
      burst = Math.max(0, burst - dt * 0.9);
      for (const s of swingers) s.group.rotation.z = Math.sin(t * 1.3 + s.phase) * s.amp;
      for (let i = 0; i < lanterns.length; i++) {
        const l = lanterns[i];
        const fl = 0.78 + Math.sin(t * 7.3 + l.phase) * 0.08 + Math.sin(t * 17.1 + l.phase * 2) * 0.05 + flare * 0.4;
        l.mat.opacity = Math.min(1, fl);
        l.view.glow.scale.setScalar(2.6 + flare * 1.6 + Math.sin(t * 5 + l.phase) * 0.12);
      }
      for (let i = 0; i < glints.length; i++) {
        const g = glints[i];
        const k = Math.max(0, Math.sin(t * g.speed + g.phase));
        const s = g.size * Math.pow(k, 4) * (1 + burst * 1.2);
        dummy.position.set(g.x, g.y, g.z);
        dummy.rotation.set(0, 0, t * 0.4 + g.phase);
        dummy.scale.setScalar(Math.max(0.0001, s));
        dummy.updateMatrix();
        sparkleMesh.setMatrixAt(i, dummy.matrix);
      }
      sparkleMesh.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < motes; i++) {
        const m = moteSeed[i];
        dummy.position.set(m.x + Math.sin(t * 0.3 * m.s + m.p) * 0.8, m.y + Math.sin(t * 0.22 + m.p) * 0.6, m.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.7 + Math.sin(t * 1.4 + m.p) * 0.3);
        dummy.updateMatrix();
        moteMesh.setMatrixAt(i, dummy.matrix);
      }
      moteMesh.instanceMatrix.needsUpdate = true;
    },
    celebrate() {
      flare = 1;
      burst = 1;
    },
    dispose() {
      sparkleMesh.dispose();
      moteMesh.dispose();
      root.removeFromParent();
      scene.background = prevBackground;
      scene.fog = prevFog;
    },
  };
}

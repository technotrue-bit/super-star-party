/**
 * CORK QUICK-DRAW — the fairground around the duel stage (presentation only).
 *
 * The stage sits in the middle of the Fizzy Fairground midway: a sandy path
 * rings it, two bleachers full of cheering fans flank it, a rope barrier and
 * flower beds line the front, string lights and lamp posts glow, and behind
 * it the board's own carnival pieces (tents, carousel, ferris wheel, big top,
 * helter-skelter) stand against rolling hills, a tree line and drifting
 * clouds. The crowd bounces, and jumps up on every pop (`cheer`).
 *
 * Built from the board's scenery builders and texture kit so the minigame
 * looks like the same fairground. No gameplay rng: every placement is fixed,
 * and the crowd's bounce is a function of time and seat index.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";
import { buildKit, type BoardTextures } from "../../board/boardTextures";
import {
  buildBalloons,
  buildCarousel,
  buildFerrisWheel,
  buildLampPost,
  buildSky,
  buildTent,
  type Prop,
} from "../../board/boardScenery";
import { buildBigTop, buildHelterSkelter } from "../../board/boardLandmarks";

export interface DuelEnvironment {
  /** Idle animation: rides turn, flags flutter, the crowd bounces. */
  update(t: number, dt: number): void;
  /** The crowd jumps and waves (a pop, a win). `big` for the match winner. */
  cheer(big?: boolean): void;
  dispose(): void;
}

const CROWD_COLORS = [palette.candy, palette.bubble, palette.mint, palette.sun, palette.berry, palette.heroTusk, palette.lava, palette.heroMallow];

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
}

/** One bleacher: three stepped benches and a row of fans on each, facing `face`. */
function buildBleacher(
  x: number,
  z: number,
  face: number,
  seats: { pos: THREE.Vector3; color: string; phase: number }[],
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = face;
  const wood = toon(palette.wood);
  const dark = toon(palette.woodDark);
  for (let r = 0; r < 3; r++) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.7), r % 2 === 0 ? wood : toon(palette.tentCream));
    bench.position.set(0, 0.45 + r * 0.5, -r * 0.72);
    bench.castShadow = true;
    bench.receiveShadow = true;
    g.add(bench);
    const riser = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.45 + r * 0.5, 0.08), dark);
    riser.position.set(0, (0.45 + r * 0.5) / 2, -r * 0.72 + 0.33);
    g.add(riser);
    for (let s = 0; s < 6; s++) {
      const local = new THREE.Vector3(-1.95 + s * 0.78 + (r % 2) * 0.3, 0.54 + r * 0.5, -r * 0.72);
      seats.push({ pos: local, color: CROWD_COLORS[(s * 3 + r * 5) % CROWD_COLORS.length], phase: s * 0.9 + r * 1.7 });
    }
  }
  // Candy-striped awning posts at the ends.
  for (const sx of [-2.4, 2.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), toon(palette.cream));
    post.position.set(sx, 1.3, -1.6);
    g.add(post);
  }
  const awning = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 1.2), toon(palette.candy));
  awning.position.set(0, 2.6, -1.25);
  awning.rotation.x = 0.25;
  g.add(awning);
  return g;
}

export function buildDuelEnvironment(scene: THREE.Object3D): DuelEnvironment {
  const kit: BoardTextures = buildKit();
  const root = new THREE.Group();
  root.name = "quickdraw:environment";
  scene.add(root);
  const props: Prop[] = [];
  const add = (p: Prop): void => {
    props.push(p);
    root.add(p.root);
  };

  // ---- ground: the board's grass checker, a sandy midway, hills ----
  const grassTex = kit.grass.clone();
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(30, 30);
  grassTex.needsUpdate = true;
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshToonMaterial({ map: grassTex, gradientMap: celGradient }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.32;
  lawn.receiveShadow = true;
  root.add(lawn);
  const path = new THREE.Mesh(new THREE.RingGeometry(4.75, 6.6, 48), toon(palette.path));
  path.rotation.x = -Math.PI / 2;
  path.position.y = -0.3;
  path.receiveShadow = true;
  root.add(path);
  const pathEdge = new THREE.Mesh(new THREE.RingGeometry(6.6, 6.85, 48), toon(palette.pathEdge));
  pathEdge.rotation.x = -Math.PI / 2;
  pathEdge.position.y = -0.3;
  root.add(pathEdge);
  // The midway runs off behind the stage toward the rides.
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 14), toon(palette.path));
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, -0.305, -12.5);
  root.add(lane);
  // Rolling hills close off the horizon.
  const hillMat = toon(palette.leaf);
  const hillMatDeep = toon(palette.leafDeep);
  const hills: [number, number, number, number][] = [
    [-30, -46, 16, 0],
    [-8, -50, 20, 1],
    [16, -48, 17, 0],
    [36, -40, 14, 1],
    [-44, -30, 13, 1],
    [46, -22, 12, 0],
  ];
  for (const [x, z, r, deep] of hills) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), deep ? hillMatDeep : hillMat);
    hill.scale.y = 0.42;
    hill.position.set(x, -0.35, z);
    root.add(hill);
  }

  // ---- the rides behind the stage (the board's own builders) ----
  add(buildCarousel(kit, 0, -10.5));
  add(buildTent(kit, -6.6, -8.4, palette.tentRed, palette.tentCream, 0.4));
  add(buildTent(kit, 6.6, -8.4, palette.bubble, palette.cream, 1.3));
  add(buildTent(kit, -11.5, -6, palette.berry, palette.cream, 2.1));
  add(buildTent(kit, 11.5, -6, palette.mint, palette.cream, 2.9));
  add(buildFerrisWheel(kit, -9.5, -16));
  add(buildBigTop(kit, 10.5, -17, 0.4));
  add(buildHelterSkelter(kit, 17, -11.5));
  add(buildBalloons(kit, -5.2, -4.4, 0.7));
  add(buildBalloons(kit, 5.2, -4.4, 2.2));
  add(buildBalloons(kit, -7.6, 2.2, 3.1));
  add(buildBalloons(kit, 7.6, 2.2, 1.6));
  for (const [x, z] of [
    [-5.4, 3.6],
    [5.4, 3.6],
    [-6.9, -3.3],
    [6.9, -3.3],
  ] as const) {
    const lamp = buildLampPost(kit, x, z);
    lamp.root.rotation.y = Math.atan2(-x, -z) - Math.PI / 2;
    add(lamp);
  }
  add(
    buildSky(kit, {
      minX: -18,
      maxX: 18,
      minY: -26,
      maxY: -6,
    }),
  );

  // ---- a tree line around the fairground ----
  const trunkMat = toon(palette.bark);
  const leafMats = [toon(palette.leaf), toon(palette.leafDeep), toon(palette.leafPine)];
  const treeGeo = new THREE.SphereGeometry(1, 12, 9);
  const pineGeo = new THREE.ConeGeometry(1, 2.4, 9);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 7);
  for (let i = 0; i < 26; i++) {
    const a = Math.PI * (0.08 + (i / 25) * 0.84) + Math.PI; // the back half, left to right
    const r = 28 + (i % 3) * 3.5;
    const x = Math.cos(a) * r * 1.25;
    const z = Math.sin(a) * r * 0.8 - 8;
    const s = 1.3 + ((i * 7) % 5) * 0.22;
    const tree = new THREE.Group();
    tree.position.set(x, -0.3, z);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.6 * s;
    trunk.scale.setScalar(s);
    const pine = i % 3 === 1;
    const top = new THREE.Mesh(pine ? pineGeo : treeGeo, leafMats[i % 3]);
    top.position.y = (pine ? 2.2 : 1.9) * s;
    top.scale.setScalar(s * (pine ? 1 : 1.25));
    tree.add(trunk, top);
    root.add(tree);
  }
  // Bushes along the front edge, either side of the camera.
  for (const [x, z, s] of [
    [-7.8, 6.5, 1.1],
    [-9.4, 4.2, 1.3],
    [7.8, 6.5, 1.1],
    [9.4, 4.2, 1.3],
    [-11.5, 1, 1.5],
    [11.5, 1, 1.5],
  ] as const) {
    const bush = new THREE.Mesh(treeGeo, leafMats[0]);
    bush.scale.set(s, s * 0.75, s);
    bush.position.set(x, -0.1, z);
    root.add(bush);
  }

  // ---- bleachers + fans, angled toward the stage ----
  const seats: { pos: THREE.Vector3; color: string; phase: number }[] = [];
  const bleachers: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const start = seats.length;
    const b = buildBleacher(side * 7.6, -3.4, -side * 0.85, seats);
    root.add(b);
    bleachers.push(b);
    // World positions of this bleacher's fans.
    b.updateMatrixWorld(true);
    for (let k = start; k < seats.length; k++) seats[k].pos.applyMatrix4(b.matrixWorld);
  }
  const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.32, 4, 8);
  const headGeo = new THREE.SphereGeometry(0.17, 10, 8);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshToonMaterial({ gradientMap: celGradient }), seats.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshToonMaterial({ color: hex(palette.cream), gradientMap: celGradient }), seats.length);
  // Two dot eyes and two waving arms per fan, so they read as people, not pegs.
  const eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: hex(palette.ink) }), seats.length * 2);
  const arms = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.06, 0.24, 3, 6), new THREE.MeshToonMaterial({ gradientMap: celGradient }), seats.length * 2);
  const col = new THREE.Color();
  seats.forEach((s, k) => {
    bodies.setColorAt(k, col.set(s.color));
    arms.setColorAt(k * 2, col.set(s.color));
    arms.setColorAt(k * 2 + 1, col.set(s.color));
  });
  bodies.castShadow = true;
  root.add(bodies, heads, eyes, arms);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  // Fans face the stage (origin).
  const yawOf = seats.map((s) => Math.atan2(-s.pos.x, -s.pos.z));

  // ---- rope barrier with flower beds along the front ----
  const postMat = toon(palette.sun);
  const ropeMat = toon(palette.candy);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8);
  const knobGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const ropePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = -6.4 + i * 1.6;
    const z = 6.6 - Math.abs(x) * 0.12;
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 0.15, z);
    const knob = new THREE.Mesh(knobGeo, postMat);
    knob.position.set(x, 0.62, z);
    root.add(post, knob);
    ropePts.push(new THREE.Vector3(x, 0.52, z));
  }
  for (let i = 0; i < ropePts.length - 1; i++) {
    const a = ropePts[i];
    const b = ropePts[i + 1];
    const curve = new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.18, 0)), b);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.035, 5), ropeMat));
  }
  const flowerColors = [palette.candy, palette.sun, palette.white, palette.heroTusk, palette.bubble];
  const flowerGeo = new THREE.SphereGeometry(0.12, 6, 5);
  const flowerMats = flowerColors.map((c) => toon(c));
  for (let i = 0; i < 40; i++) {
    const x = -6.6 + (i / 39) * 13.2;
    const z = 6.05 - Math.abs(x) * 0.12 + ((i * 7) % 3) * 0.12;
    const f = new THREE.Mesh(flowerGeo, flowerMats[i % flowerMats.length]);
    f.position.set(x, -0.2, z);
    root.add(f);
  }

  // ---- string lights: from the bunting poles out to the lamp posts ----
  const bulbGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const bulbMats = [palette.lampWarm, palette.lampHot, palette.candy, palette.bubble].map((c) => new THREE.MeshBasicMaterial({ color: hex(c) }));
  const strands: [THREE.Vector3, THREE.Vector3][] = [
    [new THREE.Vector3(-5.1, 4.0, -2.9), new THREE.Vector3(-6.3, 3.0, 3.6)],
    [new THREE.Vector3(5.1, 4.0, -2.9), new THREE.Vector3(6.3, 3.0, 3.6)],
    [new THREE.Vector3(-5.1, 4.0, -2.9), new THREE.Vector3(-6.6, 3.0, -8.4)],
    [new THREE.Vector3(5.1, 4.0, -2.9), new THREE.Vector3(6.6, 3.0, -8.4)],
  ];
  let bulbIdx = 0;
  for (const [a, b] of strands) {
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.55, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.015, 4), toon(palette.ink)));
    for (let i = 1; i < 10; i++) {
      const bulb = new THREE.Mesh(bulbGeo, bulbMats[bulbIdx++ % bulbMats.length]);
      bulb.position.copy(curve.getPoint(i / 10));
      root.add(bulb);
    }
  }

  // ---- crowd animation ----
  let cheerT = 0;
  let cheerBig = false;
  const placeCrowd = (t: number): void => {
    const hype = cheerT > 0 ? (cheerBig ? 1 : 0.7) * Math.min(1, cheerT / 0.4) : 0;
    seats.forEach((s, k) => {
      const calm = Math.max(0, Math.sin(t * 2.2 + s.phase)) * 0.04;
      const jump = hype * Math.abs(Math.sin(t * (9 + (k % 3)) + s.phase)) * 0.35;
      const y = s.pos.y + 0.36 + calm + jump;
      m.makeTranslation(s.pos.x, y, s.pos.z);
      bodies.setMatrixAt(k, m);
      m.makeTranslation(s.pos.x, y + 0.42, s.pos.z);
      heads.setMatrixAt(k, m);
      const yaw = yawOf[k];
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      for (const side of [-1, 1]) {
        p.set(s.pos.x + fx * 0.15 + rx * 0.065 * side, y + 0.45, s.pos.z + fz * 0.15 + rz * 0.065 * side);
        m.makeTranslation(p.x, p.y, p.z);
        eyes.setMatrixAt(k * 2 + (side > 0 ? 1 : 0), m);
        // Arms hang at rest and wave overhead when the crowd cheers.
        const up = hype > 0 ? 2.4 + Math.sin(t * 12 + s.phase + side) * 0.5 : 0.25 + calm * 2;
        e.set(0, yaw, side * up);
        q.setFromEuler(e);
        p.set(s.pos.x + rx * 0.24 * side, y + 0.12 + (hype > 0 ? 0.22 : 0), s.pos.z + rz * 0.24 * side);
        m.compose(p, q, one);
        arms.setMatrixAt(k * 2 + (side > 0 ? 1 : 0), m);
      }
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    eyes.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
  };
  placeCrowd(0);
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  if (arms.instanceColor) arms.instanceColor.needsUpdate = true;

  return {
    update(t, dt) {
      for (const p of props) p.update?.(t, dt);
      if (cheerT > 0) cheerT = Math.max(0, cheerT - dt);
      placeCrowd(t);
    },
    cheer(big = false) {
      cheerT = big ? 3 : 1.4;
      cheerBig = big;
    },
    dispose() {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) mat?.dispose();
      });
      grassTex.dispose();
      kit.dispose();
      root.removeFromParent();
    },
  };
}

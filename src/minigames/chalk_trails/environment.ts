/**
 * CHALK TRAILS — the sidewalk park after school (presentation only).
 *
 * A paved slab with the four quadrants chalked out in each player's colour, a hopscotch
 * court along the bottom edge and a chalk doodle with two buckets of chalk along the top,
 * a hedge, trees and a bench around the slab, and the rain: a cloud that drifts in from the
 * left, a curtain of rain that sweeps across the park and washes the chalk away, and the
 * puddles it leaves behind.
 *
 * No gameplay rng: every placement comes from a fixed local generator and everything that
 * moves is a function of the clocks handed to `update`.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { makeLawnTexture, makeSkyTexture } from "../framing";
import { canvasOf, lookRng, type Kit } from "./art";
import { HALF_D, HALF_W, INNER, RAIN_SWEEP, RAIN_TIMES, SEATS } from "./rules";

/** The slab reaches this far past the quadrants: the sides a little, the ends enough to stand on. */
export const SLAB_HALF_W = HALF_W + 0.8;
export const SLAB_HALF_D = HALF_D + 2.6;
/** Where each player's character stands (the bottom pair face the camera too). */
export const STAND_X = 5.2;
export const STAND_Z = HALF_D + 1.35;

/** The rain is seen coming this long before it sweeps, and lingers this long after (s). */
const WARN = 3;
const AFTER = 2;
/** The cloud starts and ends off the sides of the park (ground x). */
const CLOUD_FAR = 17;
const BAND_EDGE = HALF_W + 1.6;
const BAND_WIDTH = 3.2;
const DROPS = 150;
const CLOUD_Z = -HALF_D - 1.35;
const CLOUD_Y = 3.4;

/** Where the rain is at game time t: `s` seconds from the start of rain `k`, or null when none is near. */
export function rainPhase(t: number): { k: number; s: number } | null {
  for (let k = 0; k < RAIN_TIMES.length; k++) {
    const s = t - RAIN_TIMES[k];
    if (s >= -WARN && s <= RAIN_SWEEP + AFTER) return { k, s };
  }
  return null;
}

/** Ground x of the cloud and curtain at `s` seconds from the start of a rain. */
export function cloudX(s: number): number {
  if (s <= 0) return -CLOUD_FAR + (CLOUD_FAR - BAND_EDGE) * Math.min(1, (s + WARN) / WARN);
  if (s <= RAIN_SWEEP) return -BAND_EDGE + 2 * BAND_EDGE * (s / RAIN_SWEEP);
  return BAND_EDGE + (CLOUD_FAR - BAND_EDGE) * Math.min(1, (s - RAIN_SWEEP) / AFTER);
}

export interface ParkEnvironment {
  /** `t` is the presentation clock, `simT` the game clock (the rain follows the game). */
  update(t: number, dt: number, simT: number): void;
  /** Someone won: the sun comes out. */
  celebrate(): void;
  dispose(): void;
}

export function buildPark(scene: THREE.Scene, parent: THREE.Object3D, kit: Kit, colors: readonly string[]): ParkEnvironment {
  const root = new THREE.Group();
  root.name = "chalk_trails:environment";
  parent.add(root);
  const rand = lookRng(0x5a1d);

  const prevBackground = scene.background;
  const prevFog = scene.fog;
  scene.background = kit.tex(makeSkyTexture(palette.skyTop, palette.skyHorizon));
  scene.fog = null;

  /* ---------------- grass and slab ---------------- */
  const grassGeo = kit.geo(new THREE.CircleGeometry(80, 40));
  grassGeo.rotateX(-Math.PI / 2);
  const grass = new THREE.Mesh(grassGeo, kit.mat(new THREE.MeshBasicMaterial({ map: kit.tex(makeLawnTexture(50)) })));
  grass.position.y = -0.25;
  root.add(grass);

  const curbGeo = kit.geo(new THREE.BoxGeometry(2 * SLAB_HALF_W + 0.5, 0.3, 2 * SLAB_HALF_D + 0.5));
  const curb = new THREE.Mesh(curbGeo, kit.toon(palette.rock));
  curb.position.y = -0.17;
  root.add(curb);

  const tex = kit.tex(makeGroundTexture(colors));
  const slabGeo = kit.geo(new THREE.PlaneGeometry(2 * SLAB_HALF_W, 2 * SLAB_HALF_D));
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, kit.mat(new THREE.MeshBasicMaterial({ map: tex })));
  slab.position.y = 0.0;
  root.add(slab);

  /* ---------------- chalk buckets ---------------- */
  const bucketGeo = kit.geo(new THREE.CylinderGeometry(0.4, 0.3, 0.55, 14));
  const stickGeo = kit.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6));
  const stickColors = [palette.candy, palette.bubble, palette.sun, palette.mint, palette.white];
  [-2.5, 2.5].forEach((x, bi) => {
    const g = new THREE.Group();
    const bucket = new THREE.Mesh(bucketGeo, kit.toon(bi === 0 ? palette.berry : palette.tentRed));
    bucket.position.y = 0.28;
    g.add(bucket);
    for (let i = 0; i < 5; i++) {
      const stick = new THREE.Mesh(stickGeo, kit.toon(stickColors[(i + bi * 2) % stickColors.length]));
      const a = (i / 5) * Math.PI * 2;
      stick.position.set(Math.cos(a) * 0.14, 0.7, Math.sin(a) * 0.14);
      stick.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      g.add(stick);
    }
    // a couple of sticks lying on the pavement
    const lying = new THREE.Mesh(stickGeo, kit.toon(stickColors[(bi + 3) % stickColors.length]));
    lying.rotation.set(0, 0.7 + bi, Math.PI / 2);
    lying.position.set(0.7 * (bi === 0 ? 1 : -1), 0.06, 0.35);
    g.add(lying);
    g.position.set(x, 0, -HALF_D - 1.3);
    root.add(g);
  });

  /* ---------------- hedge, trees, bench ---------------- */
  const hedgeGeo = kit.geo(new THREE.BoxGeometry(0.9, 0.8, 2 * SLAB_HALF_D + 1));
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(hedgeGeo, kit.toon(palette.leafDeep));
    h.position.set(sx * (SLAB_HALF_W + 0.85), 0.4, 0);
    root.add(h);
  }
  const trunkGeo = kit.geo(new THREE.CylinderGeometry(0.22, 0.3, 1.8, 8));
  const crownGeo = kit.geo(new THREE.IcosahedronGeometry(1.5, 1));
  [
    [-11, -7],
    [11.5, -2],
    [-10.5, 6.5],
    [12, 8],
    [-13, -1],
  ].forEach(([x, z], i) => {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, kit.toon(palette.bark));
    trunk.position.y = 0.9;
    const crown = new THREE.Mesh(crownGeo, kit.toon(i % 2 === 0 ? palette.leaf : palette.leafPine));
    crown.position.y = 2.6 + rand() * 0.3;
    crown.scale.set(1, 0.9 + rand() * 0.2, 1);
    t.add(trunk, crown);
    t.position.set(x, 0, z);
    root.add(t);
  });
  const bench = new THREE.Group();
  const seat = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(2.2, 0.12, 0.6)), kit.toon(palette.wood));
  seat.position.y = 0.55;
  const back = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(2.2, 0.5, 0.1)), kit.toon(palette.woodDark));
  back.position.set(0, 0.95, -0.28);
  bench.add(seat, back);
  for (const lx of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(kit.geo(new THREE.BoxGeometry(0.1, 0.55, 0.5)), kit.toon(palette.metal));
    leg.position.set(lx, 0.27, 0);
    bench.add(leg);
  }
  bench.position.set(-SLAB_HALF_W - 2.6, 0, 2.5);
  bench.rotation.y = Math.PI / 2;
  root.add(bench);

  /* ---------------- puddles ---------------- */
  const puddleGeo = kit.geo(new THREE.CircleGeometry(1, 24));
  puddleGeo.rotateX(-Math.PI / 2);
  const puddleMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.bubble), transparent: true, opacity: 0, depthWrite: false }));
  const shineMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.white), transparent: true, opacity: 0, depthWrite: false }));
  const puddles: Array<{ mesh: THREE.Mesh; shine: THREE.Mesh; base: number }> = [];
  [
    [-3.6, -9.5, 1.1, 0.55],
    [4.4, -9.2, 0.9, 0.45],
    [-6.5, 9.7, 1.0, 0.5],
    [1.2, 9.9, 1.3, 0.6],
    [6.85, -4.3, 0.35, 0.8],
    [-6.9, 5.6, 0.32, 0.7],
    [5.9, 9.4, 0.9, 0.5],
    [-5.3, -8.8, 0.6, 0.4],
  ].forEach(([x, z, rx, rz], i) => {
    const m = new THREE.Mesh(puddleGeo, puddleMat);
    m.position.set(x, 0.03, z);
    m.scale.set(rx, 1, rz);
    m.renderOrder = 1;
    root.add(m);
    const s = new THREE.Mesh(puddleGeo, shineMat);
    s.position.set(x - rx * 0.25, 0.035, z - rz * 0.25);
    s.scale.set(rx * 0.35, 1, rz * 0.22);
    s.renderOrder = 1;
    root.add(s);
    puddles.push({ mesh: m, shine: s, base: i });
  });

  /* ---------------- the cloud and the rain ---------------- */
  const cloud = new THREE.Group();
  [
    [0, 0, 0, 1.25],
    [1.2, -0.15, 0.1, 0.95],
    [-1.2, -0.15, 0, 1.0],
    [0.45, 0.55, 0, 0.85],
    [-0.55, 0.5, 0.2, 0.75],
    [1.95, -0.3, 0, 0.65],
    [-1.95, -0.3, 0, 0.6],
  ].forEach(([x, y, z, r], i) => {
    const puff = new THREE.Mesh(kit.geo(new THREE.IcosahedronGeometry(r, 1)), kit.toon(i % 3 === 0 ? palette.rock : palette.creamShadow));
    puff.position.set(x, y, z);
    cloud.add(puff);
  });
  cloud.position.set(-CLOUD_FAR, CLOUD_Y, CLOUD_Z);
  cloud.scale.setScalar(1.15);
  root.add(cloud);

  const veilGeo = kit.geo(new THREE.PlaneGeometry(BAND_WIDTH, 2 * HALF_D + 5));
  veilGeo.rotateX(-Math.PI / 2);
  const veilMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.bubbleDeep), transparent: true, opacity: 0, depthWrite: false }));
  const veil = new THREE.Mesh(veilGeo, veilMat);
  veil.position.y = 0.08;
  veil.renderOrder = 3;
  veil.visible = false;
  root.add(veil);

  const dropGeo = kit.geo(new THREE.BoxGeometry(0.035, 1.0, 0.035));
  const dropMesh = new THREE.InstancedMesh(dropGeo, kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.white), transparent: true, opacity: 0.8 })), DROPS);
  dropMesh.frustumCulled = false;
  dropMesh.visible = false;
  dropMesh.renderOrder = 6;
  root.add(dropMesh);
  const dropAt = Array.from({ length: DROPS }, () => ({ x: (rand() - 0.5) * BAND_WIDTH, z: (rand() - 0.5) * (2 * HALF_D + 4), phase: rand() * 4, speed: 9 + rand() * 5 }));
  const dummy = new THREE.Object3D();

  // A dim wash over the whole park while the rain is near.
  const dimGeo = kit.geo(new THREE.PlaneGeometry(2 * SLAB_HALF_W, 2 * SLAB_HALF_D));
  dimGeo.rotateX(-Math.PI / 2);
  const dimMat = kit.mat(new THREE.MeshBasicMaterial({ color: hex(palette.ink), transparent: true, opacity: 0, depthWrite: false }));
  const dim = new THREE.Mesh(dimGeo, dimMat);
  dim.position.y = 0.1;
  dim.renderOrder = 7;
  dim.visible = false;
  root.add(dim);

  let sunny = 0;

  return {
    update(t, _dt, simT) {
      const ph = rainPhase(simT);
      // the cloud and the curtain
      if (ph) {
        const x = cloudX(ph.s);
        cloud.visible = true;
        cloud.position.x = x;
        cloud.position.y = CLOUD_Y + Math.sin(t * 1.3) * 0.08;
        const sweeping = ph.s >= 0 && ph.s <= RAIN_SWEEP;
        veil.visible = sweeping;
        dropMesh.visible = sweeping;
        if (sweeping) {
          veil.position.x = x;
          veilMat.opacity = 0.34;
          for (let i = 0; i < DROPS; i++) {
            const d = dropAt[i];
            const fall = (t * d.speed + d.phase) % 4;
            dummy.position.set(x + d.x, 4 - fall, d.z);
            dummy.updateMatrix();
            dropMesh.setMatrixAt(i, dummy.matrix);
          }
          dropMesh.instanceMatrix.needsUpdate = true;
        }
        // dim in the warning, hold through the sweep, clear after it
        const dimU = ph.s < 0 ? (ph.s + WARN) / WARN : ph.s <= RAIN_SWEEP ? 1 : Math.max(0, 1 - (ph.s - RAIN_SWEEP) / 1.2);
        dimMat.opacity = 0.2 * dimU;
        dim.visible = dimU > 0;
      } else {
        cloud.visible = false;
        veil.visible = false;
        dropMesh.visible = false;
        dim.visible = false;
      }

      // puddles: they appear when the first rain has passed and dry slowly
      let level = 0;
      for (const r of RAIN_TIMES) {
        const since = simT - (r + RAIN_SWEEP);
        if (since >= 0) level = Math.max(level, 0.6 * Math.min(1, since * 1.5) * (1 - Math.min(0.6, since * 0.05)));
      }
      puddleMat.opacity = level * (1 - sunny * 0.5);
      shineMat.opacity = level * 0.55 * (0.6 + 0.4 * Math.sin(t * 2.2));
    },
    celebrate() {
      sunny = 1;
    },
    dispose() {
      scene.background = prevBackground;
      scene.fog = prevFog;
      dropMesh.dispose();
      root.removeFromParent();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  The ground picture                                                 */
/* ------------------------------------------------------------------ */

const GROUND_PX = 36;

function makeGroundTexture(colors: readonly string[]): THREE.CanvasTexture {
  const w = Math.round(2 * SLAB_HALF_W * GROUND_PX);
  const h = Math.round(2 * SLAB_HALF_D * GROUND_PX);
  const { c, g } = canvasOf(w, h);
  const X = (x: number): number => (x + SLAB_HALF_W) * GROUND_PX;
  const Z = (z: number): number => (z + SLAB_HALF_D) * GROUND_PX;

  g.fillStyle = palette.cream;
  g.fillRect(0, 0, w, h);

  // paving slabs
  g.strokeStyle = palette.creamShadow;
  g.lineWidth = 3;
  for (let x = -SLAB_HALF_W; x <= SLAB_HALF_W + 0.01; x += 2.2) {
    g.beginPath();
    g.moveTo(X(x), 0);
    g.lineTo(X(x), h);
    g.stroke();
  }
  for (let z = -SLAB_HALF_D; z <= SLAB_HALF_D + 0.01; z += 2.6) {
    g.beginPath();
    g.moveTo(0, Z(z));
    g.lineTo(w, Z(z));
    g.stroke();
  }

  // the four quadrants, tinted in each player's colour, with a chalk outline
  for (let seat = 0; seat < SEATS; seat++) {
    const sx = seat % 2 === 0 ? -1 : 1;
    const sz = seat < 2 ? -1 : 1;
    const x0 = Math.min(sx * INNER, sx * HALF_W);
    const x1 = Math.max(sx * INNER, sx * HALF_W);
    const z0 = Math.min(sz * INNER, sz * HALF_D);
    const z1 = Math.max(sz * INNER, sz * HALF_D);
    g.globalAlpha = 0.22;
    g.fillStyle = colors[seat] ?? palette.cream;
    g.fillRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    g.globalAlpha = 0.55;
    g.strokeStyle = colors[seat] ?? palette.inkSoft;
    g.lineWidth = 5;
    g.setLineDash([16, 12]);
    g.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    g.setLineDash([]);
  }
  g.globalAlpha = 1;

  // hopscotch along the bottom edge: 1 to 5, in chalk
  g.strokeStyle = palette.white;
  g.fillStyle = palette.white;
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.font = `700 ${Math.round(GROUND_PX * 0.8)}px Fredoka, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const sq = 1.4;
  for (let i = 0; i < 5; i++) {
    const cx = (i - 2) * sq;
    const cz = HALF_D + 1.35;
    g.globalAlpha = 0.9;
    g.strokeRect(X(cx - sq / 2), Z(cz - sq / 2), sq * GROUND_PX, sq * GROUND_PX);
    g.globalAlpha = 0.7;
    g.fillText(String(i + 1), X(cx), Z(cz) + 2);
  }
  g.globalAlpha = 1;

  // a chalk sun in the top corner of the court, and a few flowers on the side
  g.strokeStyle = palette.sunDeep;
  g.lineWidth = 5;
  g.lineCap = "round";
  const sunX = X(0);
  const sunZ = Z(-HALF_D - 1.3);
  g.beginPath();
  g.arc(sunX, sunZ, GROUND_PX * 0.5, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.beginPath();
    g.moveTo(sunX + Math.cos(a) * GROUND_PX * 0.72, sunZ + Math.sin(a) * GROUND_PX * 0.72);
    g.lineTo(sunX + Math.cos(a) * GROUND_PX * 1.0, sunZ + Math.sin(a) * GROUND_PX * 1.0);
    g.stroke();
  }
  g.strokeStyle = palette.candy;
  for (const [fx, fz] of [
    [-SLAB_HALF_W + 0.4, -3],
    [SLAB_HALF_W - 0.4, 3.5],
  ]) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(X(fx) + Math.cos(a) * 7, Z(fz) + Math.sin(a) * 7, 5, 0, Math.PI * 2);
      g.stroke();
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

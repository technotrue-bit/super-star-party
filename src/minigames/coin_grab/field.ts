/**
 * COIN GRAB — arena visuals.
 *
 * Bright circular park: grass checker disc with a sandy path ring, a
 * candy-striped rim wall with a gold cap, and a little bobbing fountain
 * in the middle. Everything palette-only MeshToonMaterial + the shared
 * cel gradient. The field is fully static (zero rng) so gameplay draws
 * stay untouched; dispose() releases every geometry/material we made.
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

/** Rim wall inner radius (world units). */
export const ARENA_R = 7.2;

const WALL_SEGMENTS = 18;
const WALL_H = 0.8;
const CHECKER_WEDGES = 16;

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
}

function basic(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: hex(color),
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

export interface FieldHandle {
  /** Advance per-frame decorative animation (fountain). */
  update(t: number): void;
  /** Remove from the scene and release every geometry/material we created. */
  dispose(): void;
}

export function buildCoinField(scene: THREE.Scene, spawnColors: string[]): FieldHandle {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const droplets: THREE.Mesh[] = [];
  const waterMat = basic(palette.bubble, 0.85);

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number]
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
    return m;
  };

  // ---- park floor: dark base + grass checker wedges + sandy path ring ----
  geos.push(new THREE.CircleGeometry(ARENA_R + 0.05, 48));
  mats.push(toon(palette.grassB));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.004, 0], [-Math.PI / 2, 0, 0]);

  for (let i = 0; i < CHECKER_WEDGES; i++) {
    const a0 = (i / CHECKER_WEDGES) * Math.PI * 2;
    geos.push(new THREE.CircleGeometry(6.9, 3, a0, (Math.PI * 2) / CHECKER_WEDGES));
    mats.push(toon(i % 2 === 0 ? palette.grassA : palette.grassB));
    add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.012, 0], [-Math.PI / 2, 0, 0]);
  }

  // Sandy path ring around the fountain (with thin edge lines).
  geos.push(new THREE.RingGeometry(3.4, 4.6, 48));
  mats.push(toon(palette.path));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.016, 0], [-Math.PI / 2, 0, 0]);
  for (const r of [3.4, 4.6]) {
    geos.push(new THREE.TorusGeometry(r, 0.045, 6, 48));
    mats.push(toon(palette.pathEdge));
    add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.024, 0], [-Math.PI / 2, 0, 0]);
  }

  // ---- fountain (decorative centrepiece) ----
  // Pool rim + water + spout + orbiting droplets.
  geos.push(new THREE.TorusGeometry(0.82, 0.14, 10, 28));
  mats.push(toon(palette.woodDark));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.05, 0], [-Math.PI / 2, 0, 0]);
  geos.push(new THREE.CylinderGeometry(0.78, 0.78, 0.14, 24));
  add(geos[geos.length - 1], waterMat, [0, 0.1, 0]);
  geos.push(new THREE.CylinderGeometry(0.09, 0.14, 0.55, 12));
  mats.push(toon(palette.metal));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.42, 0]);
  geos.push(new THREE.SphereGeometry(0.11, 10, 8));
  mats.push(toon(palette.bubbleDeep));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.72, 0]);
  geos.push(new THREE.SphereGeometry(1, 8, 6));
  mats.push(toon(palette.sun));
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(geos[geos.length - 1], mats[mats.length - 1]);
    d.scale.setScalar(0.07);
    d.castShadow = false;
    d.receiveShadow = false;
    group.add(d);
    droplets.push(d);
  }
  geos.push(new THREE.TorusGeometry(0.86, 0.05, 6, 24));
  mats.push(toon(palette.ink));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.035, 0], [-Math.PI / 2, 0, 0]);

  // ---- player-coloured spawn markers on the path ring ----
  const SPAWN_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  geos.push(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 20));
  for (let i = 0; i < 4; i++) {
    const a = SPAWN_ANGLES[i] ?? 0;
    mats.push(toon(spawnColors[i] ?? palette.bubble));
    add(
      geos[geos.length - 1],
      mats[mats.length - 1],
      [Math.cos(a) * 4.0, 0.035, Math.sin(a) * 4.0]
    );
  }

  // ---- candy-striped rim wall + gold cap + ink base ring ----
  const segW = (Math.PI * 2 * (ARENA_R + 0.2)) / WALL_SEGMENTS;
  geos.push(new THREE.BoxGeometry(segW + 0.02, WALL_H, 0.5));
  for (let i = 0; i < WALL_SEGMENTS; i++) {
    const a = (i / WALL_SEGMENTS) * Math.PI * 2;
    mats.push(toon(i % 2 === 0 ? palette.candy : palette.tentCream));
    const box = new THREE.Mesh(geos[geos.length - 1], mats[mats.length - 1]);
    box.position.set(Math.sin(a) * (ARENA_R + 0.2), WALL_H / 2 - 0.02, Math.cos(a) * (ARENA_R + 0.2));
    box.rotation.y = a;
    box.castShadow = false;
    box.receiveShadow = false;
    group.add(box);
  }
  geos.push(new THREE.TorusGeometry(ARENA_R + 0.2, 0.13, 10, 48));
  mats.push(toon(palette.sun));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, WALL_H - 0.04, 0], [Math.PI / 2, 0, 0]);
  geos.push(new THREE.TorusGeometry(ARENA_R, 0.06, 8, 48));
  mats.push(toon(palette.ink));
  add(geos[geos.length - 1], mats[mats.length - 1], [0, 0.05, 0], [Math.PI / 2, 0, 0]);

  // ---- bright fills keep every surface in the cel light band ----
  const fill = new THREE.DirectionalLight(0xffffff, 1.15);
  fill.position.set(2, 10, 16);
  group.add(fill);
  const fillBack = new THREE.DirectionalLight(0xffffff, 0.9);
  fillBack.position.set(0, 12, -16);
  group.add(fillBack);

  scene.add(group);

  return {
    update(t: number): void {
      // Fountain droplets orbit + bob; the water shimmers subtly.
      for (let i = 0; i < droplets.length; i++) {
        const d = droplets[i];
        const a = t * 1.9 + (i / droplets.length) * Math.PI * 2;
        d.position.set(Math.cos(a) * 0.42, 0.62 + 0.24 * Math.sin(t * 2.6 + i * 1.7), Math.sin(a) * 0.42);
        d.scale.setScalar(0.06 + 0.02 * Math.sin(t * 5 + i * 2.1));
      }
      waterMat.opacity = 0.78 + 0.1 * Math.sin(t * 2.2);
    },
    dispose(): void {
      group.parent?.remove(group);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

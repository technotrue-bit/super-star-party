/**
 * Bumper Balls — arena visuals.
 *
 * Bright carnival stage: concentric wood target floor, candy-striped rim
 * wall with a gold cap, a shrinking sun ring (danger-glow floor ring), and
 * player-colored spawn markers. Everything palette-only, MeshToonMaterial +
 * the shared cel gradient. Fully disposable via dispose().
 */
import * as THREE from "three";
import { palette, hex } from "../../config/palette";
import { celGradient } from "../../characters/cel";

export const ARENA_R = 6.0; // rim wall inner radius (world units)

const RIM_SEGMENTS = 20;
const RIM_H = 0.78;

function toon(color: string): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: hex(color), gradientMap: celGradient });
}

export interface ArenaHandle {
  /** Advance per-frame visuals. t = play time, ringR = current ring radius,
   *  danger = 0..1 (0 calm, 1 someone is about to be popped). */
  update(t: number, ringR: number, danger: number): void;
  /** Remove from the scene and release every geometry/material we created. */
  dispose(): void;
}

export function buildArena(scene: THREE.Scene, spawnPoints: { x: number; z: number }[], spawnColors: string[]): ArenaHandle {
  const group = new THREE.Group();

  // ---- concentric target floor (wood / woodDark / wood) ----
  const floorRings: Array<[number, number, string]> = [
    [0, 2.05, palette.wood],
    [2.05, 4.1, palette.woodDark],
    [4.1, ARENA_R, palette.wood],
  ];
  for (const [r0, r1, color] of floorRings) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 64), toon(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0;
    group.add(mesh);
  }

  // ---- centre medallion (sun disc + ink ring) ----
  const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 32), toon(palette.sun));
  medallion.position.y = 0.02;
  group.add(medallion);
  const medRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 32), toon(palette.ink));
  medRing.rotation.x = Math.PI / 2;
  medRing.position.y = 0.05;
  group.add(medRing);

  // ---- player-colored spawn markers ----
  spawnPoints.forEach((p, i) => {
    const color = spawnColors[i] ?? palette.bubble;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 20), toon(color));
    disc.position.set(p.x, 0.03, p.z);
    group.add(disc);
  });

  // ---- candy-striped rim wall ----
  const segW = (Math.PI * 2 * (ARENA_R + 0.2)) / RIM_SEGMENTS;
  for (let i = 0; i < RIM_SEGMENTS; i++) {
    const a = (i / RIM_SEGMENTS) * Math.PI * 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(segW + 0.02, RIM_H, 0.5), toon(i % 2 === 0 ? palette.candy : palette.tentCream));
    box.position.set(Math.sin(a) * (ARENA_R + 0.2), RIM_H / 2 - 0.02, Math.cos(a) * (ARENA_R + 0.2));
    box.rotation.y = a;
    group.add(box);
  }
  // Gold cap on the wall + ink outline at the wall base.
  const cap = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 0.2, 0.13, 10, 48), toon(palette.sun));
  cap.rotation.x = Math.PI / 2;
  cap.position.y = RIM_H - 0.04;
  group.add(cap);
  const base = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R, 0.06, 8, 48), toon(palette.ink));
  base.rotation.x = Math.PI / 2;
  base.position.y = 0.05;
  group.add(base);

  // ---- the shrinking ring (sun torus; pulses, turns lava in danger,
  // thickens/brightens when a player is pinned against it) ----
  const ringMat = toon(palette.sun);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.17, 12, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  group.add(ring);

  // Bright overlay ring that appears when a player is pinned against the rim
  const pinMat = new THREE.MeshBasicMaterial({
    color: hex(palette.lava),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const pinRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 64), pinMat);
  pinRing.rotation.x = -Math.PI / 2;
  pinRing.position.y = 0.16;
  group.add(pinRing);

  // ---- danger glow ring painted on the floor at the ring edge ----
  const dangerMat = new THREE.MeshBasicMaterial({
    color: hex(palette.lava),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const dangerRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64), dangerMat);
  dangerRing.rotation.x = -Math.PI / 2;
  dangerRing.position.y = 0.045;
  group.add(dangerRing);

  scene.add(group);

  // Palette refs for color lerps (avoid re-parse each frame).
  const sunC = new THREE.Color(hex(palette.sun));
  const lavaC = new THREE.Color(hex(palette.lava));
  const sunDeepC = new THREE.Color(hex(palette.sunDeep));
  const tmp = new THREE.Color();
  let lastDangerGeo: THREE.RingGeometry | null = null;

  return {
    update(t: number, ringR: number, danger: number): void {
      // Ring pulses harder as it shrinks; turns lava as danger rises.
      // (progress derived from ARENA_R so it tracks any ring schedule.)
      const progress = Math.min(1, Math.max(0, 1 - ringR / ARENA_R));
      const pulse = 1 + 0.13 * Math.sin(t * 6.5) * (0.35 + 0.65 * progress);
      // Thicken the rim as danger rises (visual "pin" signal).
      // TorusGeometry sits in local XY with the tube along local Z.
      // rotation.x = -PI/2 lays it on the floor, so local Z is world up.
      // Scale both radius axes by ringR and keep the tube scale free of
      // ringR — otherwise the ring is a flat vertical oval and the edge
      // toward the top and bottom of the screen disappears.
      const rimThick = 0.17 + danger * 0.12;
      const thickness = (pulse * rimThick) / 0.17;
      ring.scale.set(ringR, ringR, thickness);
      // Hot color: lerp sun -> lava, then push toward sunDeep at high danger
      const hotLerp = Math.min(1, danger * 1.15);
      tmp.copy(sunC).lerp(lavaC, hotLerp);
      if (danger > 0.6) tmp.lerp(sunDeepC, (danger - 0.6) * 0.8);
      ringMat.color.copy(tmp);

      // Pin overlay: bright red rim when a player is pinned against it
      const pinPulse = 0.5 + 0.5 * Math.sin(t * 14);
      pinRing.scale.set(ringR, ringR, pulse);
      pinMat.opacity = danger > 0.25 ? (danger - 0.25) * 0.55 * pinPulse : 0;

      // Danger glow: rebuild the annulus geometry for a constant 0.3u width.
      if (lastDangerGeo) lastDangerGeo.dispose();
      lastDangerGeo = new THREE.RingGeometry(Math.max(0.05, ringR - 0.3), ringR, 64);
      dangerRing.geometry = lastDangerGeo;
      dangerMat.opacity = danger <= 0.001 ? 0 : 0.1 + 0.22 * danger * (0.6 + 0.4 * Math.sin(t * 10));
    },
    dispose(): void {
      if (lastDangerGeo) lastDangerGeo.dispose();
      group.parent?.remove(group);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      });
    },
  };
}

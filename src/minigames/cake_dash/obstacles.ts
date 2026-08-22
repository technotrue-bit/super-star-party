/**
 * CAKE DASH — obstacles.
 *
 * Four readable kinds, all clearly jumpable at the game's jump arc:
 *   cake tower  — stacked cylinder cake (tall-ish, must jump)
 *   pudding     — low mint dome (very generous)
 *   fork        — TALL candy-handled fork, thick lava-tipped tines (must
 *                 jump, mis-timing punishes; biggest + loudest obstacle so
 *                 it reads at 6 u/s in a 390px portrait view)
 *   confetti puddle — flat splat: run through it and you slip (slow 40%
 *                 for 1s). Bright cream rim + shine glints so it reads as
 *                 a hazard, not a decal.
 *
 * Every solid part gets an ink silhouette shell (project cel convention:
 * geometry cloned at OUTLINE_SCALE in the opaque ink material) so hazards
 * pop against the grass at speed.
 *
 * CPU reaction plans are drawn HERE at spawn time (one rng pass per
 * obstacle, fixed lane order) so the seeded stream stays byte-identical:
 *   attempt     — the CPU tries the jump at all
 *   mistimed    — the CPU jumps late (lands on the obstacle)
 *   lateBy      — how late the mistimed jump fires (s)
 *   triggerDist — distance ahead at which a clean jump fires (u)
 */
import * as THREE from "three";
import { palette } from "../../config/palette";
import { Assets, shadowMat } from "./course";

export type ObstacleKind = "cake" | "pudding" | "fork" | "puddle";

export interface CpuPlan {
  attempt: boolean;
  mistimed: boolean;
  lateBy: number;
  triggerDist: number;
}

export interface Obstacle {
  kind: ObstacleKind;
  lane: number;
  x: number; // center x
  h: number; // hit height (generous: below the visual top)
  w: number; // hit width
  group: THREE.Group;
  plan: CpuPlan | null;
  planUsed: boolean;
  consumed: boolean;
}

export const OBSTACLE_H: Record<ObstacleKind, number> = {
  cake: 0.72,
  pudding: 0.5,
  fork: 0.95,
  puddle: 0.12,
};

export const OBSTACLE_W: Record<ObstacleKind, number> = {
  cake: 0.85,
  pudding: 1.0,
  fork: 0.5,
  puddle: 1.3,
};

/** Ink silhouette shell scale — same convention as the characters. */
const OUTLINE_SCALE = 1.06;

function shadow(a: Assets, parent: THREE.Group, r: number): void {
  const m = new THREE.Mesh(a.geo(new THREE.CylinderGeometry(r, r, 0.02, 18)), shadowMat(a));
  m.position.y = 0.012;
  parent.add(m);
}

function box(
  a: Assets,
  parent: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  color: string
): THREE.Mesh {
  const m = new THREE.Mesh(a.geo(new THREE.BoxGeometry(w, h, d)), a.toon(color));
  m.position.set(x, y, 0);
  parent.add(m);
  return m;
}

/** Ink silhouette shell cloned around a mesh (see models.ts / coin_cannon). */
function outline(a: Assets, src: THREE.Mesh): void {
  const g = a.geo(src.geometry.clone());
  g.scale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);
  const shell = new THREE.Mesh(g, a.inkOutline());
  shell.position.copy(src.position);
  shell.rotation.copy(src.rotation);
  shell.scale.copy(src.scale);
  src.parent?.add(shell);
}

/** Small stacked cake: plate, two tiers, cherry. Visual top ~0.95, hit 0.72. */
function buildCakeTower(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.55);
  const cyl = (r: number, h: number, y: number, color: string): THREE.Mesh => {
    const m = new THREE.Mesh(a.geo(new THREE.CylinderGeometry(r, r, h, 18)), a.toon(color));
    m.position.y = y;
    g.add(m);
    return m;
  };
  outline(a, cyl(0.5, 0.1, 0.05, palette.cream)); // plate
  outline(a, cyl(0.36, 0.32, 0.26, palette.sun)); // tier 1
  outline(a, cyl(0.26, 0.3, 0.57, palette.berry)); // tier 2
  const cherry = new THREE.Mesh(a.geo(new THREE.SphereGeometry(0.11, 14, 10)), a.toon(palette.lava));
  cherry.position.y = 0.87;
  g.add(cherry);
  outline(a, cherry);
  return g;
}

/** Low mint pudding dome with sprinkles. Visual top ~0.58, hit 0.5. */
function buildPudding(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.6);
  const dome = new THREE.Mesh(a.geo(new THREE.SphereGeometry(0.5, 18, 12)), a.toon(palette.mint));
  dome.scale.set(1, 0.58, 1);
  dome.position.y = 0.29;
  g.add(dome);
  outline(a, dome);
  const rim = new THREE.Mesh(
    a.geo(new THREE.CylinderGeometry(0.46, 0.5, 0.09, 18)),
    a.toon(palette.mintDeep)
  );
  rim.position.y = 0.045;
  g.add(rim);
  outline(a, rim);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(a.geo(new THREE.SphereGeometry(0.07, 10, 8)), a.toon(palette.sun));
    s.position.set(-0.15 + i * 0.15, 0.52 + (i % 2) * 0.06, 0.05);
    g.add(s);
  }
  return g;
}

/**
 * Tall upright fork — the loudest obstacle in the set so it reads at speed:
 * candy-red handle with a cream band, metal neck, THREE THICK tines with
 * lava tips, ink outlines everywhere. Visual top ~1.26, hit 0.95 (generous).
 */
function buildFork(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.45);
  const candy = box(a, g, 0.18, 0.38, 0.12, 0, 0.19, palette.candyDeep); // candy handle
  outline(a, candy);
  const band = box(a, g, 0.19, 0.08, 0.13, 0, 0.1, palette.cream); // cream candy band
  outline(a, band);
  const neck = box(a, g, 0.16, 0.1, 0.12, 0, 0.43, palette.metal);
  outline(a, neck);
  for (const tx of [-0.16, 0, 0.16]) {
    const tine = box(a, g, 0.07, 0.74, 0.12, tx, 0.85, palette.metal); // thick tines
    outline(a, tine);
    const tip = box(a, g, 0.09, 0.14, 0.12, tx, 1.19, palette.lava); // lava tips
    outline(a, tip);
  }
  return g;
}

/**
 * Confetti splat: layered discs with a bright cream rim ring + wet-shine
 * glints so it reads as a slippery hazard. Visual top ~0.14, hit 0.12.
 */
function buildPuddle(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.75);
  const disc = (r: number, h: number, y: number, color: string): THREE.Mesh => {
    const m = new THREE.Mesh(a.geo(new THREE.CylinderGeometry(r, r, h, 20)), a.toon(color));
    m.position.y = y;
    g.add(m);
    return m;
  };
  const base = disc(0.72, 0.05, 0.025, palette.candy);
  outline(a, base);
  // Bright cream rim ring — the hazard edge that reads from across the lane.
  const ring = new THREE.Mesh(a.geo(new THREE.TorusGeometry(0.66, 0.05, 8, 26)), a.toon(palette.cream));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.075;
  g.add(ring);
  const mid = disc(0.5, 0.06, 0.055, palette.bubble);
  outline(a, mid);
  disc(0.3, 0.07, 0.095, palette.lava);
  // Wet-shine glints: thin highlight bands across the splat.
  for (const [rot, color] of [
    [0.4, palette.cream],
    [-0.55, palette.sun],
  ] as const) {
    const shine = new THREE.Mesh(a.geo(new THREE.BoxGeometry(0.56, 0.018, 0.07)), a.toon(color));
    shine.position.y = 0.135;
    shine.rotation.z = rot;
    g.add(shine);
  }
  return g;
}

export function buildObstacle(kind: ObstacleKind, a: Assets): THREE.Group {
  switch (kind) {
    case "cake":
      return buildCakeTower(a);
    case "pudding":
      return buildPudding(a);
    case "fork":
      return buildFork(a);
    case "puddle":
      return buildPuddle(a);
  }
}

/** Roll the obstacle kind from a raw rng draw (0..1). */
export function rollKind(r: number): ObstacleKind {
  if (r < 0.34) return "cake";
  if (r < 0.58) return "pudding";
  if (r < 0.78) return "fork";
  return "puddle";
}

/**
 * Draw a CPU reaction plan for an obstacle in `lane`. Lane 0 is the human
 * (nearest the camera) and gets no plan. Skill gates both the attempt
 * chance and the mis-time chance (low skill ≈ 20% failure, high ≈ 14%).
 */
export function cpuPlanFor(
  lane: number,
  skill: number,
  rng: () => number
): CpuPlan | null {
  if (lane === 0) return null;
  const attempt = rng() < 0.7 + 0.24 * skill;
  if (!attempt) return { attempt: false, mistimed: false, lateBy: 0, triggerDist: 0 };
  const mistimed = rng() < 0.22 - 0.13 * skill;
  const lateBy = mistimed ? 0.26 + rng() * 0.22 : 0;
  // Clean-jump window is ~2.2..2.55u; low skill may draw a slightly late
  // trigger but the clamp keeps clean jumps reliable.
  const triggerDist = Math.min(2.55, Math.max(2.2, 2.5 + (skill - 0.9) * 0.6 + (rng() - 0.5) * 0.4));
  return { attempt: true, mistimed, lateBy, triggerDist };
}

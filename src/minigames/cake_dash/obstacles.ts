/**
 * CAKE DASH — obstacles.
 *
 * Four readable kinds, all clearly jumpable at the game's jump arc:
 *   cake tower  — stacked cylinder cake (tall-ish, must jump)
 *   pudding     — low mint dome (very generous)
 *   fork        — tall metal fork, tines up (must jump, mis-timing punishes)
 *   confetti puddle — flat splat: run through it and you slip (slow 40% for 1s)
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
): void {
  const m = new THREE.Mesh(a.geo(new THREE.BoxGeometry(w, h, d)), a.toon(color));
  m.position.set(x, y, 0);
  parent.add(m);
}

/** Small stacked cake: plate, two tiers, cherry. Visual top ~0.95, hit 0.72. */
function buildCakeTower(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.55);
  const cyl = (r: number, h: number, y: number, color: string): void => {
    const m = new THREE.Mesh(a.geo(new THREE.CylinderGeometry(r, r, h, 18)), a.toon(color));
    m.position.y = y;
    g.add(m);
  };
  cyl(0.5, 0.1, 0.05, palette.cream); // plate
  cyl(0.36, 0.32, 0.26, palette.sun); // tier 1
  cyl(0.26, 0.3, 0.57, palette.berry); // tier 2
  const cherry = new THREE.Mesh(a.geo(new THREE.SphereGeometry(0.11, 14, 10)), a.toon(palette.lava));
  cherry.position.y = 0.87;
  g.add(cherry);
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
  const rim = new THREE.Mesh(
    a.geo(new THREE.CylinderGeometry(0.46, 0.5, 0.09, 18)),
    a.toon(palette.mintDeep)
  );
  rim.position.y = 0.045;
  g.add(rim);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(a.geo(new THREE.SphereGeometry(0.07, 10, 8)), a.toon(palette.sun));
    s.position.set(-0.15 + i * 0.15, 0.52 + (i % 2) * 0.06, 0.05);
    g.add(s);
  }
  return g;
}

/** Tall upright fork. Visual top ~1.05, hit 0.95. */
function buildFork(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.4);
  box(a, g, 0.16, 0.34, 0.1, 0, 0.17, palette.woodDark); // handle
  box(a, g, 0.16, 0.08, 0.1, 0, 0.38, palette.metal); // neck
  for (const tx of [-0.11, 0, 0.11]) {
    box(a, g, 0.05, 0.62, 0.1, tx, 0.72, palette.metal); // tines
  }
  return g;
}

/** Confetti splat: three flat discs. Visual top ~0.1, hit 0.12. */
function buildPuddle(a: Assets): THREE.Group {
  const g = new THREE.Group();
  shadow(a, g, 0.7);
  const disc = (r: number, h: number, y: number, color: string): void => {
    const m = new THREE.Mesh(a.geo(new THREE.CylinderGeometry(r, r, h, 20)), a.toon(color));
    m.position.y = y;
    g.add(m);
  };
  disc(0.62, 0.05, 0.025, palette.candy);
  disc(0.44, 0.06, 0.055, palette.bubble);
  disc(0.28, 0.07, 0.095, palette.lava);
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

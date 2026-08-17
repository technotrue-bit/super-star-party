/**
 * Bumper Balls — CPU brains.
 *
 * Deterministic: every decision consumes ctx.rng() (the framework's seeded
 * stream) at strategy-pick time only. Per-frame steering is pure math over
 * live positions — no per-frame randomness, so seeded replays are stable.
 */
import type { MinigameContext } from "../framework";

export type CpuStrategy = "chase" | "center" | "flee";

export interface CpuBrain {
  /** Seconds until the next strategy re-pick. */
  pickT: number;
  strategy: CpuStrategy;
  /** Fraction of the human top speed (0.65–0.95). */
  speedMul: number;
  /** Flavor roll (0..1) — orbit side / wander angle, fixed per pick. */
  flavor: number;
}

export interface CpuRival {
  id: number;
  x: number;
  z: number;
}

/** Strategy weights: 40% chase nearest rival, 35% drift to center, 25% flee. */
const CHASE_P = 0.4;
const CENTER_P = 0.75;

/** Fresh brain for a CPU player (picks on the first frame of play). */
export function freshBrain(): CpuBrain {
  return { pickT: 0, strategy: "chase", speedMul: 0.85, flavor: 0.5 };
}

/**
 * Full strategy re-pick (4 rng draws, fixed order):
 * strategy roll, speed roll, next-pick timer, flavor roll.
 */
export function repick(brain: CpuBrain, ctx: Pick<MinigameContext, "rng">): void {
  const roll = ctx.rng();
  brain.strategy = roll < CHASE_P ? "chase" : roll < CENTER_P ? "center" : "flee";
  brain.speedMul = 0.65 + ctx.rng() * 0.3;
  brain.pickT = 0.6 + ctx.rng() * 0.6;
  brain.flavor = ctx.rng();
}

/**
 * Desired movement direction (unit vector, or null to drift).
 * Pure function of current positions + brain — no rng, no hidden state.
 */
export function cpuDesiredDir(
  pos: { x: number; z: number },
  rivals: CpuRival[],
  ringR: number,
  brain: CpuBrain
): { x: number; z: number } | null {
  const d = Math.hypot(pos.x, pos.z);
  const side = brain.flavor < 0.5 ? -1 : 1;

  switch (brain.strategy) {
    case "chase": {
      // Nearest alive rival — recomputed every frame (never psychic: it is
      // the closest body, not the one about to be hit).
      let best: CpuRival | null = null;
      let bestD = Infinity;
      for (const o of rivals) {
        const dd = Math.hypot(o.x - pos.x, o.z - pos.z);
        if (dd < bestD) {
          bestD = dd;
          best = o;
        }
      }
      if (!best) return null;
      return norm(best.x - pos.x, best.z - pos.z);
    }
    case "center": {
      if (d < 0.35) {
        // Already home: wander a little so the CPU never freezes.
        const a = brain.flavor * Math.PI * 2;
        return { x: Math.cos(a) * 0.7, z: Math.sin(a) * 0.7 };
      }
      return { x: -pos.x / d, z: -pos.z / d };
    }
    case "flee": {
      // Run inward hard when the ring is close...
      const margin = ringR - d;
      if (margin < 1.4) {
        const tx = -pos.x / d;
        const tz = -pos.z / d;
        // Slight tangential lean so fleers arc instead of beelining.
        return norm(tx - tz * 0.45 * side, tz + tx * 0.45 * side);
      }
      // ...orbit the centre when safe, so the CPU keeps hunting angles.
      return { x: (-pos.z / Math.max(d, 0.001)) * side, z: (pos.x / Math.max(d, 0.001)) * side };
    }
  }
}

function norm(x: number, z: number): { x: number; z: number } {
  const l = Math.hypot(x, z);
  if (l < 1e-6) return { x: 0, z: 0 };
  return { x: x / l, z: z / l };
}
